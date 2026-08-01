from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_file, url_for, Response, stream_with_context
from werkzeug.utils import secure_filename


BASE_DIR = Path(__file__).resolve().parent
STORAGE_DIR = BASE_DIR / "storage"
LOCAL_FFMPEG = BASE_DIR / "ffmpeg" / "bin" / "ffmpeg.exe"
LOCAL_FFPROBE = BASE_DIR / "ffmpeg" / "bin" / "ffprobe.exe"

ALLOWED_EXTENSIONS = {"mp4", "mov", "webm", "mkv", "avi", "mp3", "wav", "m4a", "ogg", "flac"}
MIME_TYPES = {
    "mp4": "video/mp4",
    "mov": "video/quicktime",
    "webm": "video/webm",
    "mkv": "video/x-matroska",
    "avi": "video/x-msvideo",
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "m4a": "audio/mp4",
    "ogg": "audio/ogg",
    "flac": "audio/flac",
}
ASPECT_FILTERS = {
    "vertical": "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
    "horizontal": "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080",
    "square": "scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080",
}
MAX_AGE_SECONDS = 10 * 60
CLEANUP_INTERVAL_SECONDS = 10

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = int(
    os.environ.get("MAX_UPLOAD_BYTES", 2 * 1024 * 1024 * 1024)
)
STORAGE_DIR.mkdir(parents=True, exist_ok=True)

JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()
CLEANUP_LOCK = threading.Lock()
LAST_CLEANUP_AT = 0.0


def executable(name: str, bundled: Path) -> str | None:
    configured = os.environ.get(f"{name.upper()}_PATH")
    if configured:
        return configured
    if bundled.exists():
        return str(bundled)
    return shutil.which(name)


FFMPEG = executable("ffmpeg", LOCAL_FFMPEG)
FFPROBE = executable("ffprobe", LOCAL_FFPROBE)


def process_options() -> dict:
    if os.name == "nt":
        return {"creationflags": subprocess.CREATE_NO_WINDOW}
    return {}


def safe_original_name(filename: str) -> str:
    return filename.replace("\\", "/").rsplit("/", 1)[-1].replace("\r", "").replace("\n", "")


def extension_for(filename: str) -> str:
    return Path(filename).suffix.lower().lstrip(".")


def probe_media(path: Path) -> dict:
    if not FFPROBE:
        raise RuntimeError("تعذّر العثور على FFprobe على الخادم.")

    command = [
        FFPROBE,
        "-v",
        "error",
        "-show_entries",
        "format=duration,format_name:stream=codec_type,codec_name,duration",
        "-of",
        "json",
        str(path),
    ]
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=60,
        **process_options(),
    )
    if result.returncode != 0:
        raise ValueError("الملف غير صالح أو لا يمكن قراءة بياناته.")

    data = json.loads(result.stdout or "{}")
    format_info = data.get("format", {})
    streams = data.get("streams", [])

    duration = 0.0
    try:
        duration = float(format_info.get("duration") or 0)
    except (ValueError, TypeError):
        duration = 0.0

    if duration <= 0:
        for stream in streams:
            try:
                d = float(stream.get("duration") or 0)
                if d > duration:
                    duration = d
            except (ValueError, TypeError):
                pass

    has_video = any(stream.get("codec_type") == "video" for stream in streams)
    has_audio = any(stream.get("codec_type") == "audio" for stream in streams)

    if duration <= 0 and (has_video or has_audio):
        try:
            dur_cmd = [
                FFPROBE,
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                "-sexagesimal",
                str(path)
            ]
            dur_res = subprocess.run(dur_cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30, **process_options())
            raw_dur = dur_res.stdout.strip()
            if raw_dur and ":" in raw_dur:
                parts = raw_dur.split(":")
                if len(parts) == 3:
                    duration = float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
        except Exception:
            pass

    if not (has_video or has_audio):
        raise ValueError("لم نتمكن من العثور على فيديو أو صوت صالح داخل الملف.")

    if not math.isfinite(duration) or duration <= 0:
        duration = 60.0

    return {
        "duration": duration,
        "media_type": "video" if has_video else "audio",
        "has_audio": has_audio,
        "has_video": has_video,
        "format": format_info.get("format_name", ""),
    }


def purge_job_directory(job: dict) -> None:
    try:
        resolved = Path(job["directory"]).resolve()
        if STORAGE_DIR.resolve() in resolved.parents:
            shutil.rmtree(resolved, ignore_errors=True)
    except OSError:
        pass


def remove_job_files(job_id: str) -> None:
    with JOBS_LOCK:
        job = JOBS.pop(job_id, None)
    if job:
        purge_job_directory(job)


def storage_directory_created_at(path: Path) -> float:
    marker = path / ".created-at"
    try:
        created_at = float(marker.read_text(encoding="ascii"))
        if math.isfinite(created_at) and created_at > 0:
            return created_at
    except (OSError, ValueError):
        pass
    try:
        return path.stat().st_mtime
    except OSError:
        return time.time()


def cleanup_stale_jobs(force: bool = False) -> None:
    global LAST_CLEANUP_AT
    now = time.time()
    with CLEANUP_LOCK:
        if not force and now - LAST_CLEANUP_AT < CLEANUP_INTERVAL_SECONDS:
            return
        LAST_CLEANUP_AT = now

        cutoff = now - MAX_AGE_SECONDS
        stale_ids: list[str] = []
        protected_paths: set[Path] = set()
        with JOBS_LOCK:
            for job_id, job in JOBS.items():
                created_at = float(job.get("created_at", 0))
                if job.get("status") != "processing" and created_at < cutoff:
                    stale_ids.append(job_id)
                else:
                    try:
                        protected_paths.add(Path(job["directory"]).resolve())
                    except (KeyError, OSError):
                        pass
            stale_paths = [Path(JOBS.pop(job_id)["directory"]) for job_id in stale_ids]

        for stale_path in stale_paths:
            purge_job_directory({"directory": str(stale_path)})

        try:
            candidates = list(STORAGE_DIR.iterdir())
        except OSError:
            candidates = []

        for candidate in candidates:
            if not candidate.is_dir():
                continue
            try:
                resolved = candidate.resolve()
                if resolved in protected_paths:
                    continue
                if storage_directory_created_at(candidate) >= cutoff:
                    continue
                if STORAGE_DIR.resolve() in resolved.parents:
                    shutil.rmtree(resolved, ignore_errors=True)
            except OSError:
                pass


def update_job(job_id: str, **values) -> None:
    with JOBS_LOCK:
        if job_id in JOBS:
            JOBS[job_id].update(values)


def run_ffmpeg(command: list[str], job_id: str, clip_duration: float) -> tuple[bool, str]:
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        **process_options(),
    )
    update_job(job_id, process=process)
    log_lines: list[str] = []
    cancelled = False
    assert process.stdout is not None
    with process.stdout:
        for raw_line in process.stdout:
            with JOBS_LOCK:
                cancel_requested = bool(JOBS.get(job_id, {}).get("cancel_requested"))
            if cancel_requested and process.poll() is None:
                cancelled = True
                process.terminate()
            line = raw_line.strip()
            if line:
                log_lines.append(line)
                log_lines = log_lines[-40:]
            if line.startswith("out_time_us=") or line.startswith("out_time_ms="):
                try:
                    microseconds = int(line.split("=", 1)[1])
                    percent = min(98, max(1, round((microseconds / 1_000_000) / clip_duration * 100)))
                    update_job(job_id, progress=percent)
                except (ValueError, ZeroDivisionError):
                    pass
            elif line == "progress=end":
                update_job(job_id, progress=99)

    if cancelled and process.poll() is None:
        process.kill()
    return_code = process.wait()
    update_job(job_id, process=None)
    with JOBS_LOCK:
        cancelled = cancelled or bool(JOBS.get(job_id, {}).get("cancel_requested"))
    if cancelled:
        return False, "cancelled"
    return return_code == 0, "\n".join(log_lines)


def trim_commands(job: dict, start: float, length: float, output_path: Path) -> list[list[str]]:
    source_path = Path(job["source_path"])
    progress = ["-progress", "pipe:1", "-nostats"]
    aspect_ratio = job.get("aspect_ratio", "original")
    needs_filter = job["media_type"] == "video" and aspect_ratio in ASPECT_FILTERS

    if job["media_type"] == "video":
        mapping = ["-map", "0:v:0?", "-map", "0:a?"]
        container_flags = ["-movflags", "+faststart"] if job["extension"] in {"mp4", "mov"} else []
        filter_flags = ["-vf", ASPECT_FILTERS[aspect_ratio]] if needs_filter else []

        if job["extension"] == "webm":
            quality_codec = ["-c:v", "libvpx-vp9", "-crf", "28", "-b:v", "0", "-c:a", "libopus", "-b:a", "160k"]
        else:
            quality_codec = ["-c:v", "libx264", "-preset", "superfast", "-crf", "18", "-c:a", "aac", "-b:a", "256k"]

        precise_command = (
            [FFMPEG, "-hide_banner", "-y", "-i", str(source_path), "-ss", f"{start:.6f}", "-t", f"{length:.6f}"]
            + mapping
            + ["-map_metadata", "0"]
            + filter_flags
            + quality_codec
            + container_flags
            + progress
            + [str(output_path)]
        )

        if aspect_ratio == "original":
            fast_command = (
                [FFMPEG, "-hide_banner", "-y", "-ss", f"{start:.6f}", "-i", str(source_path), "-t", f"{length:.6f}", "-map", "0", "-c", "copy", "-map_metadata", "0"]
                + container_flags
                + progress
                + [str(output_path)]
            )
            return [fast_command, precise_command]

        return [precise_command]

    mapping = ["-map", "0:a:0?"]
    if job["extension"] == "mp3":
        codec = ["-c:a", "libmp3lame", "-q:a", "0"]
    elif job["extension"] == "wav":
        codec = ["-c:a", "pcm_s24le"]
    else:
        codec = ["-c:a", "aac", "-b:a", "256k"]

    precise_audio_command = (
        [FFMPEG, "-hide_banner", "-y", "-i", str(source_path), "-ss", f"{start:.6f}", "-t", f"{length:.6f}"]
        + mapping
        + codec
        + progress
        + [str(output_path)]
    )

    fast_audio_command = (
        [FFMPEG, "-hide_banner", "-y", "-ss", f"{start:.6f}", "-i", str(source_path), "-t", f"{length:.6f}", "-c", "copy"]
        + progress
        + [str(output_path)]
    )

    return [fast_audio_command, precise_audio_command]


def process_trim(job_id: str, start: float, end: float) -> None:
    with JOBS_LOCK:
        job = dict(JOBS[job_id])

    output_path = Path(job["output_path"])
    clip_duration = end - start
    last_log = ""

    try:
        if output_path.exists():
            output_path.unlink()

        for index, command in enumerate(trim_commands(job, start, clip_duration, output_path)):
            with JOBS_LOCK:
                cancelled_before_start = bool(JOBS.get(job_id, {}).get("cancel_requested"))
            if cancelled_before_start:
                update_job(job_id, status="cancelled", error="تم إلغاء العملية.", process=None)
                output_path.unlink(missing_ok=True)
                purge_job_directory(job)
                return
            if index:
                update_job(job_id, progress=3, processing_note="تعذّر القص السريع، نستخدم إعدادًا دقيقًا عالي الجودة")
            success, last_log = run_ffmpeg(command, job_id, clip_duration)
            with JOBS_LOCK:
                cancelled = bool(JOBS.get(job_id, {}).get("cancel_requested"))
            if cancelled:
                output_path.unlink(missing_ok=True)
                update_job(job_id, status="cancelled", progress=0, error="تم إلغاء العملية.", process=None)
                purge_job_directory(job)
                return
            if success and output_path.exists() and output_path.stat().st_size > 0:
                output_info = probe_media(output_path)
                try:
                    Path(job["source_path"]).unlink(missing_ok=True)
                except Exception:
                    pass
                update_job(
                    job_id,
                    status="completed",
                    progress=100,
                    output_size=output_path.stat().st_size,
                    output_duration=output_info["duration"],
                    completed_at=time.time(),
                    process=None,
                )
                return
            output_path.unlink(missing_ok=True)

        raise RuntimeError(last_log or "تعذّرت معالجة الملف بواسطة FFmpeg.")
    except Exception as exc:
        app.logger.error("Trim failed for %s: %s", job_id, exc)
        with JOBS_LOCK:
            cancelled = bool(JOBS.get(job_id, {}).get("cancel_requested"))
        update_job(
            job_id,
            status="cancelled" if cancelled else "failed",
            progress=0,
            error="تم إلغاء العملية." if cancelled else "تعذّر قص الملف. تأكد من أن الملف سليم ثم حاول مرة أخرى.",
            process=None,
        )
        if cancelled:
            purge_job_directory(job)


def public_job(job_id: str, job: dict) -> dict:
    payload = {
        "id": job_id,
        "status": job["status"],
        "progress": job.get("progress", 0),
        "processing_note": job.get("processing_note", "قص دقيق بأعلى إعداد جودة متوافق"),
    }
    if job["status"] == "completed":
        payload.update(
            {
                "download_url": url_for("download_result", job_id=job_id),
                "output_size": job.get("output_size", 0),
                "output_duration": job.get("output_duration", 0),
                "filename": job["download_name"],
            }
        )
    elif job["status"] in {"failed", "cancelled"}:
        payload["error"] = job.get("error", "حدث خطأ غير متوقع.")
    return payload


cleanup_stale_jobs(force=True)


@app.before_request
def run_periodic_cleanup():
    cleanup_stale_jobs()


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/favicon.ico")
def favicon():
    return send_file(BASE_DIR / "static" / "favicon.svg", mimetype="image/svg+xml")


@app.get("/developer")
def developer():
    return render_template("developer.html")


@app.get("/privacy")
def privacy():
    return render_template("privacy.html")


@app.get("/terms")
def terms():
    return render_template("terms.html")


@app.post("/api/upload")
def upload_file():
    cleanup_stale_jobs()
    if not FFMPEG or not FFPROBE:
        return jsonify(error="FFmpeg غير متوفر على الخادم حاليًا."), 503
    if "file" not in request.files:
        return jsonify(error="اختر ملفًا أولًا."), 400

    uploaded = request.files["file"]
    original_name = safe_original_name(uploaded.filename or "")
    extension = extension_for(original_name)
    if not original_name or extension not in ALLOWED_EXTENSIONS:
        return jsonify(error="الصيغة غير مدعومة. استخدم MP4 أو MOV أو WEBM أو MP3 أو WAV."), 400

    job_id = uuid.uuid4().hex
    job_directory = STORAGE_DIR / job_id
    job_directory.mkdir(parents=True, exist_ok=False)
    created_at = time.time()
    (job_directory / ".created-at").write_text(f"{created_at:.6f}", encoding="ascii")
    safe_stem = secure_filename(Path(original_name).stem) or "media"
    source_path = job_directory / f"source.{extension}"
    output_path = job_directory / f"{safe_stem}-trimmed.{extension}"

    try:
        uploaded.save(source_path)
        if source_path.stat().st_size == 0:
            raise ValueError("الملف فارغ.")
        info = probe_media(source_path)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError, json.JSONDecodeError) as exc:
        shutil.rmtree(job_directory, ignore_errors=True)
        return jsonify(error=str(exc)), 400

    download_stem = Path(original_name).stem.strip() or "media"
    job = {
        "created_at": created_at,
        "directory": str(job_directory),
        "source_path": str(source_path),
        "output_path": str(output_path),
        "original_name": original_name,
        "download_name": f"{download_stem}-مقصوص.{extension}",
        "extension": extension,
        "duration": info["duration"],
        "media_type": info["media_type"],
        "size": source_path.stat().st_size,
        "status": "uploaded",
        "progress": 0,
        "process": None,
        "cancel_requested": False,
        "aspect_ratio": "original",
    }
    with JOBS_LOCK:
        JOBS[job_id] = job

    return jsonify(
        id=job_id,
        filename=original_name,
        extension=extension.upper(),
        duration=info["duration"],
        media_type=info["media_type"],
        size=job["size"],
        preview_url=url_for("preview_source", job_id=job_id),
    )


@app.post("/api/upload/chunk")
def upload_chunk():
    cleanup_stale_jobs()
    if not FFMPEG or not FFPROBE:
        return jsonify(error="FFmpeg غير متوفر على الخادم حاليًا."), 503

    if "chunk" not in request.files:
        return jsonify(error="اختر ملفًا أولًا."), 400

    chunk = request.files["chunk"]
    chunk_index = int(request.form.get("chunk_index", 0))
    total_chunks = int(request.form.get("total_chunks", 1))
    job_id = request.form.get("job_id", "") or uuid.uuid4().hex
    original_name = safe_original_name(request.form.get("filename", "") or chunk.filename or "")
    extension = extension_for(original_name)

    if not original_name or extension not in ALLOWED_EXTENSIONS:
        return jsonify(error="الصيغة غير مدعومة. استخدم MP4 أو MOV أو WEBM أو MP3 أو WAV."), 400

    temp_dir = STORAGE_DIR / f"temp_{job_id}"
    temp_dir.mkdir(parents=True, exist_ok=True)

    chunk_path = temp_dir / f"part_{chunk_index}"
    chunk.save(chunk_path)

    all_parts = [temp_dir / f"part_{i}" for i in range(total_chunks)]
    if not all(p.exists() for p in all_parts):
        return jsonify(
            status="chunk_uploaded",
            job_id=job_id,
            chunk_index=chunk_index,
            received=sum(1 for p in all_parts if p.exists()),
            total=total_chunks,
        )

    job_directory = STORAGE_DIR / job_id
    job_directory.mkdir(parents=True, exist_ok=False)
    created_at = time.time()
    (job_directory / ".created-at").write_text(f"{created_at:.6f}", encoding="ascii")
    safe_stem = secure_filename(Path(original_name).stem) or "media"
    source_path = job_directory / f"source.{extension}"
    output_path = job_directory / f"{safe_stem}-trimmed.{extension}"

    try:
        with open(source_path, "wb") as out_file:
            for part in all_parts:
                with open(part, "rb") as pf:
                    shutil.copyfileobj(pf, out_file)
        shutil.rmtree(temp_dir, ignore_errors=True)

        if source_path.stat().st_size == 0:
            raise ValueError("الملف فارغ.")
        info = probe_media(source_path)
    except Exception as exc:
        shutil.rmtree(temp_dir, ignore_errors=True)
        shutil.rmtree(job_directory, ignore_errors=True)
        return jsonify(error=str(exc)), 400

    download_stem = Path(original_name).stem.strip() or "media"
    job = {
        "created_at": created_at,
        "directory": str(job_directory),
        "source_path": str(source_path),
        "output_path": str(output_path),
        "original_name": original_name,
        "download_name": f"{download_stem}-مقصوص.{extension}",
        "extension": extension,
        "duration": info["duration"],
        "media_type": info["media_type"],
        "size": source_path.stat().st_size,
        "status": "uploaded",
        "progress": 0,
        "process": None,
        "cancel_requested": False,
        "aspect_ratio": "original",
    }
    with JOBS_LOCK:
        JOBS[job_id] = job

    return jsonify(
        id=job_id,
        filename=original_name,
        extension=extension.upper(),
        duration=info["duration"],
        media_type=info["media_type"],
        size=job["size"],
        preview_url=url_for("preview_source", job_id=job_id),
    )


@app.get("/api/files/<job_id>/source")
def preview_source(job_id: str):
    with JOBS_LOCK:
        job = dict(JOBS.get(job_id, {}))
    if not job:
        return jsonify(error="انتهت صلاحية الملف أو لم يعد موجودًا."), 404
    return send_file(
        job["source_path"],
        mimetype=MIME_TYPES.get(job["extension"], "application/octet-stream"),
        conditional=True,
        max_age=0,
    )


@app.post("/api/jobs/<job_id>/trim")
def start_trim(job_id: str):
    if not FFMPEG:
        return jsonify(error="FFmpeg غير متوفر على الخادم حاليًا."), 503
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return jsonify(error="انتهت صلاحية الملف أو لم يعد موجودًا."), 404
        if job["status"] == "processing":
            return jsonify(error="المعالجة جارية بالفعل."), 409

    data = request.get_json(silent=True) or {}
    try:
        start = float(data.get("start"))
        end = float(data.get("end"))
    except (TypeError, ValueError):
        return jsonify(error="وقت البداية أو النهاية غير صالح."), 400

    aspect_ratio = str(data.get("aspect_ratio") or "original")
    if aspect_ratio not in {"original", *ASPECT_FILTERS}:
        return jsonify(error="أبعاد الفيديو غير مدعومة."), 400
    if job["media_type"] != "video" and aspect_ratio != "original":
        return jsonify(error="تغيير الأبعاد متاح للفيديو فقط."), 400

    duration = float(job["duration"])
    if not all(math.isfinite(value) for value in (start, end)):
        return jsonify(error="وقت البداية أو النهاية غير صالح."), 400
    if start < 0 or end <= start or end > duration + 0.05:
        return jsonify(error="اختر بداية ونهاية صحيحتين داخل مدة الملف."), 400

    end = min(end, duration)
    note = "تغيير الأبعاد مع معالجة عالية الجودة" if aspect_ratio != "original" else "قص سريع دون إعادة ضغط"
    update_job(
        job_id,
        status="processing",
        progress=1,
        start=start,
        end=end,
        aspect_ratio=aspect_ratio,
        cancel_requested=False,
        error=None,
        processing_note=note,
    )
    worker = threading.Thread(target=process_trim, args=(job_id, start, end), daemon=True)
    worker.start()
    return jsonify(status="processing", status_url=url_for("job_status", job_id=job_id)), 202


@app.post("/api/jobs/<job_id>/cancel")
def cancel_job(job_id: str):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return jsonify(error="انتهت صلاحية الملف أو لم يعد موجودًا."), 404
        if job["status"] in {"completed", "failed", "cancelled"}:
            return jsonify(status=job["status"])
        process = job.get("process")
        job["cancel_requested"] = True
        if job["status"] == "uploaded":
            job["status"] = "cancelled"
            job["error"] = "تم إلغاء العملية."
    if process is not None and process.poll() is None:
        process.terminate()
    if job["status"] == "cancelled":
        remove_job_files(job_id)
    return jsonify(status="cancelled" if process is None else "cancelling"), 202


@app.get("/api/jobs/<job_id>")
def job_status(job_id: str):
    with JOBS_LOCK:
        job = dict(JOBS.get(job_id, {}))
    if not job:
        return jsonify(error="انتهت صلاحية الملف أو لم يعد موجودًا."), 404
    return jsonify(public_job(job_id, job))


@app.get("/api/jobs/<job_id>/stream")
def stream_job_status(job_id: str):
    def generate():
        last_payload = None
        while True:
            with JOBS_LOCK:
                job = dict(JOBS.get(job_id, {}))
            if not job:
                err_data = json.dumps({"error": "انتهت صلاحية الملف أو لم يعد موجودًا."})
                yield f"data: {err_data}\n\n"
                break

            payload = public_job(job_id, job)
            json_str = json.dumps(payload)
            if json_str != last_payload:
                yield f"data: {json_str}\n\n"
                last_payload = json_str

            if job.get("status") in {"completed", "failed", "cancelled"}:
                break
            time.sleep(0.25)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.get("/api/jobs/<job_id>/download")
def download_result(job_id: str):
    with JOBS_LOCK:
        job = dict(JOBS.get(job_id, {}))
    if not job or job.get("status") != "completed":
        return jsonify(error="الملف المقصوص غير جاهز بعد."), 404
    response = send_file(
        job["output_path"],
        mimetype=MIME_TYPES.get(job["extension"], "application/octet-stream"),
        as_attachment=True,
        download_name=job["download_name"],
        conditional=True,
    )
    response.call_on_close(lambda: remove_job_files(job_id))
    return response


@app.errorhandler(413)
def file_too_large(_error):
    return jsonify(error="حجم الملف أكبر من الحد المسموح على هذا الخادم."), 413


if __name__ == "__main__":
    app.run(
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "5000")),
        debug=os.environ.get("FLASK_DEBUG", "0") == "1",
    )