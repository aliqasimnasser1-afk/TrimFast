import io
import shutil
import subprocess
import time
import unittest
from pathlib import Path

import app as trimfast


class TrimFastFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.media_directory = trimfast.STORAGE_DIR / 'test-assets'
        cls.media_directory.mkdir(parents=True, exist_ok=True)
        cls.ffmpeg = trimfast.FFMPEG
        if not cls.ffmpeg:
            raise unittest.SkipTest("FFmpeg is not available")
        cls._create_samples()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.media_directory, ignore_errors=True)

    @classmethod
    def _run(cls, arguments):
        subprocess.run(
            [cls.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", *arguments],
            check=True,
            capture_output=True,
            **trimfast.process_options(),
        )

    @classmethod
    def _create_samples(cls):
        cls._run([
            "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24",
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
            "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-c:a", "aac", str(cls.media_directory / "sample.mp4"),
        ])
        cls._run([
            "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24",
            "-f", "lavfi", "-i", "sine=frequency=550:sample_rate=44100",
            "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-c:a", "aac", str(cls.media_directory / "sample.mov"),
        ])
        cls._run([
            "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=44100",
            "-t", "3", "-c:a", "libmp3lame", "-q:a", "2",
            str(cls.media_directory / "sample.mp3"),
        ])
        cls._run([
            "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24",
            "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=44100",
            "-t", "3", "-c:v", "libvpx-vp9", "-crf", "35", "-b:v", "0",
            "-c:a", "libopus", "-b:a", "96k", str(cls.media_directory / "sample.webm"),
        ])

        cls._run([
            "-f", "lavfi", "-i", "sine=frequency=770:sample_rate=44100",
            "-t", "3", "-c:a", "pcm_s16le",
            str(cls.media_directory / "sample.wav"),
        ])

    def setUp(self):
        self.client = trimfast.app.test_client()

    def test_home_page_loads(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("TrimFast".encode("utf-8"), response.data)
        self.assertIn(b'id="mobileStartMarker"', response.data)
        self.assertIn(b'id="mobileEndMarker"', response.data)
        self.assertIn(b'id="mobilePlayheadTime"', response.data)

    def test_legal_pages_and_contact_links(self):
        home = self.client.get("/").get_data(as_text=True)
        self.assertIn('href="/privacy"', home)
        self.assertIn('href="/terms"', home)

        privacy = self.client.get("/privacy")
        self.assertEqual(privacy.status_code, 200)
        privacy_text = privacy.get_data(as_text=True)
        self.assertIn("سياسة الخصوصية", privacy_text)
        self.assertIn("12 ساعة", privacy_text)
        self.assertIn("https://github.com/aliqasimnasser1-afk", privacy_text)
        self.assertIn("https://x.com/Aliqaseem71", privacy_text)

        terms = self.client.get("/terms")
        self.assertEqual(terms.status_code, 200)
        terms_text = terms.get_data(as_text=True)
        self.assertIn("شروط الاستخدام", terms_text)
        self.assertIn('href="/privacy"', terms_text)

    def test_cleanup_removes_orphan_after_retention_limit(self):
        orphan = trimfast.STORAGE_DIR / "retention-test-orphan"
        shutil.rmtree(orphan, ignore_errors=True)
        orphan.mkdir()
        (orphan / ".created-at").write_text(
            str(time.time() - trimfast.MAX_AGE_SECONDS - 5),
            encoding="ascii",
        )
        (orphan / "source.mp4").write_bytes(b"temporary")
        trimfast.cleanup_stale_jobs(force=True)
        self.assertFalse(orphan.exists())

    def test_upload_trim_and_download_supported_formats(self):
        for extension in ("mp4", "mov", "webm", "mp3", "wav"):
            with self.subTest(extension=extension):
                source = self.media_directory / f"sample.{extension}"
                with source.open("rb") as media_file:
                    response = self.client.post(
                        "/api/upload",
                        data={"file": (io.BytesIO(media_file.read()), source.name)},
                        content_type="multipart/form-data",
                    )
                self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
                upload = response.get_json()
                self.assertGreater(upload["duration"], 2.5)

                response = self.client.post(
                    f"/api/jobs/{upload['id']}/trim",
                    json={"start": 0.5, "end": 2.25},
                )
                self.assertEqual(response.status_code, 202, response.get_data(as_text=True))

                deadline = time.time() + 30
                status = None
                while time.time() < deadline:
                    status_response = self.client.get(f"/api/jobs/{upload['id']}")
                    self.assertEqual(status_response.status_code, 200)
                    status = status_response.get_json()
                    if status["status"] in {"completed", "failed"}:
                        break
                    time.sleep(0.1)

                self.assertIsNotNone(status)
                self.assertEqual(status["status"], "completed", status)
                self.assertGreater(status["output_size"], 0)
                self.assertGreater(status["output_duration"], 0)

                download = self.client.get(status["download_url"])
                self.assertEqual(download.status_code, 200)
                self.assertGreater(len(download.data), 0)
                self.assertIn("attachment", download.headers.get("Content-Disposition", ""))
                download.close()

    def test_video_aspect_ratio_and_cancel(self):
        source = self.media_directory / "sample.mp4"
        with source.open("rb") as media_file:
            upload_response = self.client.post(
                "/api/upload",
                data={"file": (io.BytesIO(media_file.read()), source.name)},
                content_type="multipart/form-data",
            )
        upload = upload_response.get_json()
        upload_id = upload["id"]
        trim_response = self.client.post(
            f"/api/jobs/{upload_id}/trim",
            json={"start": 0.2, "end": 1.8, "aspect_ratio": "vertical"},
        )
        self.assertEqual(trim_response.status_code, 202)
        deadline = time.time() + 30
        while time.time() < deadline:
            status = self.client.get(f"/api/jobs/{upload_id}").get_json()
            if status["status"] in {"completed", "failed"}:
                break
            time.sleep(0.1)
        self.assertEqual(status["status"], "completed", status)
        output_path = Path(trimfast.JOBS[upload_id]["output_path"])
        output_info = trimfast.probe_media(output_path)
        self.assertEqual(output_info["media_type"], "video")
        download = self.client.get(status["download_url"])
        self.assertEqual(download.status_code, 200)
        download.close()

    def test_cancel_uploaded_job_removes_files(self):
        source = self.media_directory / "sample.mp4"
        with source.open("rb") as media_file:
            response = self.client.post(
                "/api/upload",
                data={"file": (io.BytesIO(media_file.read()), source.name)},
                content_type="multipart/form-data",
            )
        job_id = response.get_json()["id"]
        cancel = self.client.post(f"/api/jobs/{job_id}/cancel")
        self.assertEqual(cancel.status_code, 202)
        self.assertEqual(self.client.get(f"/api/jobs/{job_id}").status_code, 404)

    def test_rejects_unsupported_extension(self):
        response = self.client.post(
            "/api/upload",
            data={"file": (io.BytesIO(b"not-media"), "notes.txt")},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
