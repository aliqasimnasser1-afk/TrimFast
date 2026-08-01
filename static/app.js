"use strict";

const supportedExtensions = new Set(["mp4", "mov", "webm", "mkv", "avi", "mp3", "wav", "m4a", "ogg", "flac"]);

const elements = {
  fileInput: document.querySelector("#fileInput"),
  dropZone: document.querySelector("#dropZone"),
  uploadView: document.querySelector("#uploadView"),
  progressView: document.querySelector("#progressView"),
  editorView: document.querySelector("#editorView"),
  resultView: document.querySelector("#resultView"),
  progressKicker: document.querySelector("#progressKicker"),
  progressTitle: document.querySelector("#progressTitle"),
  progressPercent: document.querySelector("#progressPercent"),
  progressBar: document.querySelector("#progressBar"),
  progressNote: document.querySelector("#progressNote"),
  fileType: document.querySelector("#fileType"),
  fileName: document.querySelector("#fileName"),
  fileSize: document.querySelector("#fileSize"),
  fileDuration: document.querySelector("#fileDuration"),
  replaceButton: document.querySelector("#replaceButton"),
  video: document.querySelector("#videoPreview"),
  audio: document.querySelector("#audioPreview"),
  audioArtwork: document.querySelector("#audioArtwork"),
  previewSupportNote: document.querySelector("#previewSupportNote"),
  startInput: document.querySelector("#startInput"),
  endInput: document.querySelector("#endInput"),
  startRange: document.querySelector("#startRange"),
  endRange: document.querySelector("#endRange"),
  startFormatted: document.querySelector("#startFormatted"),
  endFormatted: document.querySelector("#endFormatted"),
  selectedDuration: document.querySelector("#selectedDuration"),
  clipVisual: document.querySelector("#clipVisual"),
  previewButton: document.querySelector("#previewButton"),
  trimButton: document.querySelector("#trimButton"),
  resultType: document.querySelector("#resultType"),
  resultName: document.querySelector("#resultName"),
  resultSize: document.querySelector("#resultSize"),
  resultDuration: document.querySelector("#resultDuration"),
  downloadButton: document.querySelector("#downloadButton"),
  shareButton: document.querySelector("#shareButton"),
  newFileButton: document.querySelector("#newFileButton"),
  toast: document.querySelector("#toast"),
  themeButton: document.querySelector("#themeButton"),
  cancelOperationButton: document.querySelector("#cancelOperationButton"),
  aspectControl: document.querySelector("#aspectControl"),
  aspectOptions: [...document.querySelectorAll(".aspect-option")],
  settingsButton: document.querySelector("#settingsButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  closeSettingsButton: document.querySelector("#closeSettingsButton"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  resetShortcutsButton: document.querySelector("#resetShortcutsButton"),
  shortcutCaptureButtons: [...document.querySelectorAll(".shortcut-capture")],
  settingsStartKey: document.querySelector("#settingsStartKey"),
  settingsEndKey: document.querySelector("#settingsEndKey"),
  shortcutSettingsNote: document.querySelector("#shortcutSettingsNote"),
  startShortcutHint: document.querySelector("#startShortcutHint"),
  endShortcutHint: document.querySelector("#endShortcutHint"),
  shortcutFeedback: document.querySelector("#shortcutFeedback"),
  mobileStartMarker: document.querySelector("#mobileStartMarker"),
  mobileEndMarker: document.querySelector("#mobileEndMarker"),
  mobilePlayheadTime: document.querySelector("#mobilePlayheadTime"),
  mobileStartMarkerTime: document.querySelector("#mobileStartMarkerTime"),
  mobileEndMarkerTime: document.querySelector("#mobileEndMarkerTime"),
  steps: [...document.querySelectorAll(".step")],
  timelineContainer: document.querySelector("#timelineContainer"),
  waveformCanvas: document.querySelector("#waveformCanvas"),
  waveformStatus: document.querySelector("#waveformStatus"),
  clipSelection: document.querySelector("#clipSelection"),
  handleStart: document.querySelector("#handleStart"),
  handleEnd: document.querySelector("#handleEnd"),
  handleStartTime: document.querySelector("#handleStartTime"),
  handleEndTime: document.querySelector("#handleEndTime"),
  playheadLine: document.querySelector("#playheadLine"),
  loopPreviewButton: document.querySelector("#loopPreviewButton"),
  mobileFloatingDock: document.querySelector("#mobileFloatingDock"),
  dockStartBtn: document.querySelector("#dockStartBtn"),
  dockEndBtn: document.querySelector("#dockEndBtn"),
  dockPreviewBtn: document.querySelector("#dockPreviewBtn"),
  dockTrimBtn: document.querySelector("#dockTrimBtn"),
  expirationOverlay: document.querySelector("#expirationOverlay"),
  expiredResetBtn: document.querySelector("#expiredResetBtn"),
};

const state = {
  jobId: null,
  duration: 0,
  extension: "",
  mediaType: "",
  activeMedia: null,
  previewingClip: false,
  pollTimer: null,
  toastTimer: null,
  feedbackTimer: null,
  expirationTimer: null,
  shortcuts: null,
  pendingShortcuts: null,
  capturingShortcut: null,
  uploadRequest: null,
  statusUrl: null,
  aspectRatio: "original",
  theme: "light",
  audioPeaks: [],
  isDecodingWaveform: false,
  isLoopingPreview: false,
  isDraggingStart: false,
  isDraggingEnd: false,
  isDraggingSelection: false,
  dragStartX: 0,
  dragStartRangeStart: 0,
  dragStartRangeEnd: 0,
};

const themeStorageKey = "trimfast-theme";

function applyTheme(theme) {
  const isDark = theme === "dark";
  state.theme = isDark ? "dark" : "light";
  document.documentElement.dataset.theme = state.theme;
  if (elements.themeButton) {
    const span = elements.themeButton.querySelector("span");
    if (span) span.textContent = isDark ? "☀" : "☾";
    elements.themeButton.setAttribute("aria-label", isDark ? "تفعيل الوضع النهاري" : "تفعيل الوضع الليلي");
    elements.themeButton.title = isDark ? "الوضع النهاري" : "الوضع الليلي";
  }
}

function loadTheme() {
  let savedTheme = "dark";
  try {
    savedTheme = localStorage.getItem(themeStorageKey) || "dark";
  } catch (_error) {
    savedTheme = "dark";
  }
  applyTheme(savedTheme === "light" ? "light" : "dark");
}

function toggleTheme() {
  const nextTheme = state.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  try {
    localStorage.setItem(themeStorageKey, nextTheme);
  } catch (_error) {
    // The toggle still works for the current session.
  }
}

const shortcutStorageKey = "trimfast-shortcuts";
const defaultShortcuts = {
  start: { code: "KeyI", label: "I" },
  end: { code: "KeyO", label: "O" },
};
const blockedShortcutCodes = new Set(["Tab", "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight", "CapsLock"]);

function shortcutLabel(code) {
  if (code === "Space") return "SPACE";
  if (code.startsWith("Key")) return code.slice(3).toUpperCase();
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return "NUM " + code.slice(6).replace("Decimal", ".");
  const aliases = {
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
    Backquote: "BACKTICK", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
    Semicolon: ";", Quote: "QUOTE", Comma: ",", Period: ".", Slash: "/",
  };
  return aliases[code] || code.replace("Left", " L").replace("Right", " R").toUpperCase();
}

function cloneShortcuts(shortcuts) {
  return {
    start: { ...shortcuts.start },
    end: { ...shortcuts.end },
  };
}

function loadShortcuts() {
  state.shortcuts = cloneShortcuts(defaultShortcuts);
  try {
    const saved = JSON.parse(localStorage.getItem(shortcutStorageKey) || "{}");
    if (saved.start && typeof saved.start.code === "string" && !blockedShortcutCodes.has(saved.start.code)) {
      state.shortcuts.start = { code: saved.start.code, label: shortcutLabel(saved.start.code) };
    }
    if (saved.end && typeof saved.end.code === "string" && !blockedShortcutCodes.has(saved.end.code)) {
      state.shortcuts.end = { code: saved.end.code, label: shortcutLabel(saved.end.code) };
    }
    if (state.shortcuts.start.code === state.shortcuts.end.code) {
      state.shortcuts = cloneShortcuts(defaultShortcuts);
    }
  } catch (_error) {
    state.shortcuts = cloneShortcuts(defaultShortcuts);
  }
}

function updateShortcutBadges() {
  if (!state.shortcuts) return;
  const startLabel = state.shortcuts.start.label;
  const endLabel = state.shortcuts.end.label;
  elements.startShortcutHint.querySelector("kbd").textContent = startLabel;
  elements.endShortcutHint.querySelector("kbd").textContent = endLabel;
  elements.settingsStartKey.textContent = (state.pendingShortcuts || state.shortcuts).start.label;
  elements.settingsEndKey.textContent = (state.pendingShortcuts || state.shortcuts).end.label;
}

function showNotice(message) {
  clearTimeout(state.toastTimer);
  elements.toast.classList.add("is-success");
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  state.toastTimer = setTimeout(() => {
    elements.toast.hidden = true;
    elements.toast.classList.remove("is-success");
  }, 3500);
}

function setStep(activeStep) {
  elements.steps.forEach((step, index) => {
    const stepNumber = index + 1;
    step.classList.toggle("is-active", stepNumber === activeStep);
    step.classList.toggle("is-complete", stepNumber < activeStep);
    step.querySelector("span").textContent = stepNumber < activeStep ? "✓" : String(stepNumber);
  });
}

function showView(name) {
  elements.uploadView.hidden = name !== "upload";
  elements.progressView.hidden = name !== "progress";
  elements.editorView.hidden = name !== "editor";
  elements.resultView.hidden = name !== "result";
  if (elements.mobileFloatingDock) {
    elements.mobileFloatingDock.hidden = name !== "editor";
  }
}

function setProgress(percent, { kicker, title, note } = {}) {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent || 0)));
  elements.progressPercent.textContent = `${safePercent}%`;
  elements.progressBar.setAttribute("aria-valuenow", String(safePercent));
  elements.progressBar.querySelector("span").style.width = `${safePercent}%`;
  if (kicker) elements.progressKicker.textContent = kicker;
  if (title) elements.progressTitle.textContent = title;
  if (note) elements.progressNote.textContent = note;
}

function showError(message) {
  clearTimeout(state.toastTimer);
  elements.toast.classList.remove("is-success");
  elements.toast.textContent = message || "حدث خطأ غير متوقع. حاول مرة أخرى.";
  elements.toast.hidden = false;
  state.toastTimer = setTimeout(() => {
    elements.toast.hidden = true;
  }, 5000);
}

function formatDuration(seconds, withHundredths = false) {
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const hundredths = Math.floor((safe - Math.floor(safe)) * 100);
  const main = hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}`;
  return withHundredths ? `${main}.${String(hundredths).padStart(2, "0")}` : main;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function selectedTimes() {
  return {
    start: Number(elements.startInput.value) || 0,
    end: Number(elements.endInput.value) || state.duration,
  };
}

function updateTimeUI(source) {
  if (!state.duration) return;
  const minimumGap = Math.min(0.05, state.duration);
  let start = Number(source === "startRange" ? elements.startRange.value : elements.startInput.value);
  let end = Number(source === "endRange" ? elements.endRange.value : elements.endInput.value);

  if (!Number.isFinite(start)) start = 0;
  if (!Number.isFinite(end)) end = state.duration;
  start = Math.max(0, Math.min(start, state.duration - minimumGap));
  end = Math.max(minimumGap, Math.min(end, state.duration));

  if (source === "startRange" || source === "startInput") {
    start = Math.min(start, end - minimumGap);
  } else {
    end = Math.max(end, start + minimumGap);
  }

  elements.startInput.value = start.toFixed(2);
  elements.endInput.value = end.toFixed(2);
  elements.startRange.value = String(start);
  elements.endRange.value = String(end);
  elements.startFormatted.textContent = formatDuration(start, true);
  elements.endFormatted.textContent = formatDuration(end, true);
  elements.mobileStartMarkerTime.textContent = formatDuration(start, true);
  elements.mobileEndMarkerTime.textContent = formatDuration(end, true);
  elements.selectedDuration.textContent = `مدة المقطع: ${formatDuration(end - start, true)}`;

  const startPercent = (start / state.duration) * 100;
  const endPercent = (end / state.duration) * 100;
  elements.clipVisual.style.setProperty("--start", `${startPercent}%`);
  elements.clipVisual.style.setProperty("--end", `${endPercent}%`);
  elements.startRange.style.setProperty("--range-progress", `${startPercent}%`);
  elements.endRange.style.setProperty("--range-progress", `${endPercent}%`);

  if (elements.handleStartTime) elements.handleStartTime.textContent = formatDuration(start, true);
  if (elements.handleEndTime) elements.handleEndTime.textContent = formatDuration(end, true);
  drawWaveform();
}

async function fetchAndDecodeAudio(url) {
  if (!elements.waveformCanvas) return;

  // Skip heavy downloading/decoding for videos and large media files to prevent blocking player streaming
  if (state.mediaType === "video" || state.duration > 120) {
    elements.waveformStatus.textContent = "المخطط التفاعلي";
    state.audioPeaks = Array.from({ length: 130 }, (_, i) => 0.18 + 0.7 * Math.abs(Math.sin(i * 0.18 + (i % 5))));
    drawWaveform();
    return;
  }

  elements.waveformStatus.textContent = "جاري تحليل رسم الموجات الصوتية...";
  try {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    const rawData = audioBuffer.getChannelData(0);
    const barCount = 150;
    const samplesPerBar = Math.floor(rawData.length / barCount);
    const peaks = [];
    for (let i = 0; i < barCount; i++) {
      let sum = 0;
      const offset = i * samplesPerBar;
      for (let j = 0; j < samplesPerBar; j++) {
        sum += Math.abs(rawData[offset + j] || 0);
      }
      peaks.push(sum / samplesPerBar);
    }
    const maxPeak = Math.max(...peaks) || 1;
    state.audioPeaks = peaks.map((p) => Math.max(0.08, p / maxPeak));
    elements.waveformStatus.textContent = "تم تجهيز الموجات الصوتية ✦";
    drawWaveform();
  } catch (err) {
    console.warn("Waveform decode fallback:", err);
    elements.waveformStatus.textContent = "المخطط التفاعلي";
    state.audioPeaks = Array.from({ length: 130 }, (_, i) => 0.18 + 0.7 * Math.abs(Math.sin(i * 0.18 + (i % 5))));
    drawWaveform();
  }
}

function drawWaveform() {
  const canvas = elements.waveformCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, rect.width, rect.height);

  const peaks = state.audioPeaks.length > 0
    ? state.audioPeaks
    : Array.from({ length: 120 }, (_, i) => 0.2 + 0.6 * (Math.sin(i * 0.15) ** 2));

  const barCount = peaks.length;
  const barGap = 2.5;
  const totalGap = (barCount - 1) * barGap;
  const barWidth = Math.max(2, (rect.width - totalGap) / barCount);
  const centerY = rect.height / 2;

  const { start, end } = selectedTimes();
  const duration = state.duration || 1;
  const startRatio = start / duration;
  const endRatio = end / duration;

  for (let i = 0; i < barCount; i++) {
    const x = i * (barWidth + barGap);
    const barRatio = i / barCount;
    const isSelected = barRatio >= startRatio && barRatio <= endRatio;

    const amp = peaks[i];
    const barHeight = Math.max(6, amp * (rect.height - 22));
    const y = centerY - barHeight / 2;

    ctx.fillStyle = isSelected ? "#dfff72" : "rgba(255, 255, 255, 0.22)";
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, barWidth, barHeight, 3);
    } else {
      ctx.rect(x, y, barWidth, barHeight);
    }
    ctx.fill();
  }
}

function initTimelineDragEvents() {
  if (!elements.clipVisual || !elements.handleStart || !elements.handleEnd || !elements.clipSelection) return;

  const getPosRatio = (clientX) => {
    const rect = elements.clipVisual.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    return x / rect.width;
  };

  const onStartPointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    state.isDraggingStart = true;
    elements.handleStart.classList.add("is-dragging");
    document.addEventListener("pointermove", onStartPointerMove);
    document.addEventListener("pointerup", onStartPointerUp);
  };
  const onStartPointerMove = (e) => {
    if (!state.isDraggingStart || !state.duration) return;
    const ratio = getPosRatio(e.clientX);
    const newStart = ratio * state.duration;
    elements.startInput.value = newStart.toFixed(2);
    elements.startRange.value = String(newStart);
    updateTimeUI("startInput");
  };
  const onStartPointerUp = () => {
    state.isDraggingStart = false;
    elements.handleStart.classList.remove("is-dragging");
    document.removeEventListener("pointermove", onStartPointerMove);
    document.removeEventListener("pointerup", onStartPointerUp);
  };

  const onEndPointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    state.isDraggingEnd = true;
    elements.handleEnd.classList.add("is-dragging");
    document.addEventListener("pointermove", onEndPointerMove);
    document.addEventListener("pointerup", onEndPointerUp);
  };
  const onEndPointerMove = (e) => {
    if (!state.isDraggingEnd || !state.duration) return;
    const ratio = getPosRatio(e.clientX);
    const newEnd = ratio * state.duration;
    elements.endInput.value = newEnd.toFixed(2);
    elements.endRange.value = String(newEnd);
    updateTimeUI("endInput");
  };
  const onEndPointerUp = () => {
    state.isDraggingEnd = false;
    elements.handleEnd.classList.remove("is-dragging");
    document.removeEventListener("pointermove", onEndPointerMove);
    document.removeEventListener("pointerup", onEndPointerUp);
  };

  const onSelectionPointerDown = (e) => {
    if (e.target === elements.handleStart || e.target === elements.handleEnd || elements.handleStart.contains(e.target) || elements.handleEnd.contains(e.target)) return;
    e.preventDefault();
    state.isDraggingSelection = true;
    state.dragStartX = e.clientX;
    const { start, end } = selectedTimes();
    state.dragStartRangeStart = start;
    state.dragStartRangeEnd = end;

    document.addEventListener("pointermove", onSelectionPointerMove);
    document.addEventListener("pointerup", onSelectionPointerUp);
  };
  const onSelectionPointerMove = (e) => {
    if (!state.isDraggingSelection || !state.duration) return;
    const rect = elements.clipVisual.getBoundingClientRect();
    const deltaX = e.clientX - state.dragStartX;
    const deltaTime = (deltaX / rect.width) * state.duration;
    const clipLength = state.dragStartRangeEnd - state.dragStartRangeStart;

    let newStart = state.dragStartRangeStart + deltaTime;
    let newEnd = state.dragStartRangeEnd + deltaTime;

    if (newStart < 0) {
      newStart = 0;
      newEnd = clipLength;
    } else if (newEnd > state.duration) {
      newEnd = state.duration;
      newStart = state.duration - clipLength;
    }

    elements.startInput.value = newStart.toFixed(2);
    elements.endInput.value = newEnd.toFixed(2);
    elements.startRange.value = String(newStart);
    elements.endRange.value = String(newEnd);
    updateTimeUI("startInput");
  };
  const onSelectionPointerUp = () => {
    state.isDraggingSelection = false;
    document.removeEventListener("pointermove", onSelectionPointerMove);
    document.removeEventListener("pointerup", onSelectionPointerUp);
  };

  elements.handleStart.addEventListener("pointerdown", onStartPointerDown);
  elements.handleEnd.addEventListener("pointerdown", onEndPointerDown);
  elements.clipSelection.addEventListener("pointerdown", onSelectionPointerDown);
}

function toggleLoopPreview() {
  state.isLoopingPreview = !state.isLoopingPreview;
  if (elements.loopPreviewButton) {
    elements.loopPreviewButton.classList.toggle("is-active", state.isLoopingPreview);
  }
  if (state.isLoopingPreview) {
    showNotice("تم تفعيل تكرار المعاينة تلقائياً");
    if (state.activeMedia && state.activeMedia.paused) {
      previewClip();
    }
  } else {
    showNotice("تم إيقاف تكرار المعاينة");
  }
}

function setMarker(type) {
  if (!state.activeMedia || !state.duration) return false;
  const minimumGap = Math.min(0.05, state.duration);
  const currentTime = Math.max(0, Math.min(Number(state.activeMedia.currentTime) || 0, state.duration));
  const currentStart = Number(elements.startInput.value) || 0;
  const currentEnd = Number(elements.endInput.value) || state.duration;

  if (type === "start") {
    if (currentTime >= currentEnd - minimumGap) {
      if (currentTime <= state.duration - minimumGap) {
        elements.endInput.value = state.duration.toFixed(2);
        elements.endRange.value = String(state.duration);
      } else {
        showError("لا يمكن تثبيت البداية قرب نهاية الملف. اترك مساحة للمقطع.");
        return false;
      }
    }
    elements.startInput.value = currentTime.toFixed(2);
    elements.startRange.value = String(currentTime);
    updateTimeUI("startInput");
  } else {
    if (currentTime <= currentStart + minimumGap) {
      showError("اجعل النهاية بعد وقت البداية بقليل.");
      return false;
    }
    elements.endInput.value = currentTime.toFixed(2);
    elements.endRange.value = String(currentTime);
    updateTimeUI("endInput");
  }

  showShortcutFeedback(type, currentTime);
  return true;
}

function showShortcutFeedback(type, time) {
  clearTimeout(state.feedbackTimer);
  const label = type === "start" ? "البداية" : "النهاية";
  elements.shortcutFeedback.textContent = "تم تثبيت " + label + " عند " + formatDuration(time, true);
  elements.shortcutFeedback.hidden = false;
  elements.shortcutFeedback.classList.remove("is-visible");
  window.requestAnimationFrame(() => elements.shortcutFeedback.classList.add("is-visible"));
  state.feedbackTimer = setTimeout(() => {
    elements.shortcutFeedback.classList.remove("is-visible");
    elements.shortcutFeedback.hidden = true;
  }, 2200);
}

function updateMobilePlayhead() {
  if (!state.activeMedia) return;
  const time = Math.max(0, Math.min(Number(state.activeMedia.currentTime) || 0, state.duration || 0));
  const formatted = formatDuration(time, true);
  elements.mobilePlayheadTime.textContent = formatted;
  elements.mobileStartMarker.setAttribute("aria-label", "تحديد البداية عند " + formatted);
  elements.mobileEndMarker.setAttribute("aria-label", "تحديد النهاية عند " + formatted);
}

function setMarkerFromTouch(type, button) {
  if (!setMarker(type)) return;
  try {
    if (typeof navigator.vibrate === "function") navigator.vibrate(18);
  } catch (_error) {
    // بعض المتصفحات لا تسمح بالاهتزاز، ويظل الزر يعمل بصورة طبيعية.
  }
  button.classList.remove("is-confirmed");
  window.requestAnimationFrame(() => button.classList.add("is-confirmed"));
  window.setTimeout(() => button.classList.remove("is-confirmed"), 360);
}

function updateShortcutSettingsUI() {
  const shortcuts = state.pendingShortcuts || state.shortcuts;
  if (!shortcuts) return;
  elements.settingsStartKey.textContent = shortcuts.start.label;
  elements.settingsEndKey.textContent = shortcuts.end.label;
  elements.startShortcutHint.querySelector("kbd").textContent = state.shortcuts.start.label;
  elements.endShortcutHint.querySelector("kbd").textContent = state.shortcuts.end.label;
  elements.shortcutCaptureButtons.forEach((button) => {
    const target = button.dataset.shortcutTarget;
    const isCapturing = state.capturingShortcut === target;
    button.classList.toggle("is-recording", isCapturing);
    button.querySelector("kbd").textContent = shortcuts[target].label;
    button.querySelector("span").textContent = isCapturing ? "اضغط زرًا…" : "تغيير الزر";
  });
}

function openSettings() {
  state.pendingShortcuts = cloneShortcuts(state.shortcuts);
  state.capturingShortcut = null;
  updateShortcutSettingsUI();
  if (typeof elements.settingsDialog.showModal === "function") {
    elements.settingsDialog.showModal();
  } else {
    elements.settingsDialog.setAttribute("open", "");
  }
}

function closeSettings() {
  state.capturingShortcut = null;
  state.pendingShortcuts = null;
  elements.shortcutSettingsNote.textContent = "اختر زرًا واحدًا لكل إجراء. الإعدادات تُحفظ على هذا الجهاز.";
  updateShortcutSettingsUI();
  if (elements.settingsDialog.open && typeof elements.settingsDialog.close === "function") {
    elements.settingsDialog.close();
  } else {
    elements.settingsDialog.removeAttribute("open");
  }
}

function beginShortcutCapture(target) {
  state.capturingShortcut = state.capturingShortcut === target ? null : target;
  elements.shortcutSettingsNote.textContent = state.capturingShortcut
    ? "اضغط الزر الذي تريد استخدامه الآن، أو Escape للإلغاء."
    : "اختر زرًا واحدًا لكل إجراء. الإعدادات تُحفظ على هذا الجهاز.";
  updateShortcutSettingsUI();
}

function handleShortcutCapture(event) {
  if (!state.capturingShortcut) return false;
  event.preventDefault();
  event.stopPropagation();
  if (event.code === "Escape") {
    state.capturingShortcut = null;
    elements.shortcutSettingsNote.textContent = "تم الإلغاء. اختر زرًا واحدًا لكل إجراء.";
    updateShortcutSettingsUI();
    return true;
  }
  if (!event.code || blockedShortcutCodes.has(event.code) || event.ctrlKey || event.altKey || event.metaKey) {
    elements.shortcutSettingsNote.textContent = "استخدم زرًا واحدًا فقط من لوحة المفاتيح.";
    return true;
  }
  const otherTarget = state.capturingShortcut === "start" ? "end" : "start";
  if (state.pendingShortcuts[otherTarget].code === event.code) {
    elements.shortcutSettingsNote.textContent = "هذا الزر مستخدم للإجراء الآخر. اختر زرًا مختلفًا.";
    return true;
  }
  state.pendingShortcuts[state.capturingShortcut] = { code: event.code, label: shortcutLabel(event.code) };
  state.capturingShortcut = null;
  elements.shortcutSettingsNote.textContent = "تم اختيار الزر. اضغط حفظ الإعدادات للتأكيد.";
  updateShortcutSettingsUI();
  return true;
}

function saveShortcuts() {
  if (!state.pendingShortcuts) return;
  state.shortcuts = cloneShortcuts(state.pendingShortcuts);
  try {
    localStorage.setItem(shortcutStorageKey, JSON.stringify(state.shortcuts));
  } catch (_error) {
    // Settings still work for the current session if storage is unavailable.
  }
  closeSettings();
  showNotice("تم حفظ اختصارات TrimFast على هذا الجهاز.");
}

function resetShortcuts() {
  state.pendingShortcuts = cloneShortcuts(defaultShortcuts);
  state.capturingShortcut = null;
  elements.shortcutSettingsNote.textContent = "تمت استعادة الاختصارات الافتراضية. اضغط حفظ الإعدادات للتأكيد.";
  updateShortcutSettingsUI();
}

function shouldIgnoreShortcutTarget(target) {
  if (!target) return false;
  return ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName) || target.isContentEditable;
}

function handleGlobalKeydown(event) {
  if (handleShortcutCapture(event)) return;
  if (elements.settingsDialog.open || !state.activeMedia || !state.jobId || shouldIgnoreShortcutTarget(event.target)) return;
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.code === state.shortcuts.start.code) {
    event.preventDefault();
    setMarker("start");
  } else if (event.code === state.shortcuts.end.code) {
    event.preventDefault();
    setMarker("end");
  }
}

function setAspectRatio(aspect) {
  state.aspectRatio = aspect;
  elements.aspectOptions.forEach((button) => {
    const selected = button.dataset.aspect === aspect;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function configureEditor(data) {
  state.jobId = data.id;
  state.duration = Number(data.duration);
  state.extension = data.extension;
  state.mediaType = data.media_type;
  state.statusUrl = null;
  setAspectRatio("original");
  elements.aspectControl.hidden = data.media_type !== "video";

  if (elements.expirationOverlay) {
    elements.expirationOverlay.hidden = true;
  }

  if (state.expirationTimer) {
    clearInterval(state.expirationTimer);
    state.expirationTimer = null;
  }
  state.expirationTimer = setInterval(checkFileExpiration, 15000);

  elements.fileType.textContent = data.extension;
  elements.fileName.textContent = data.filename;
  elements.fileName.title = data.filename;
  elements.fileSize.textContent = formatBytes(data.size);
  elements.fileDuration.textContent = formatDuration(state.duration);

  elements.startInput.max = String(state.duration);
  elements.endInput.max = String(state.duration);
  elements.startRange.max = String(state.duration);
  elements.endRange.max = String(state.duration);
  elements.startInput.value = "0.00";
  elements.endInput.value = state.duration.toFixed(2);
  elements.mobilePlayheadTime.textContent = "00:00.00";
  elements.startRange.value = "0";
  elements.endRange.value = String(state.duration);
  updateTimeUI("endRange");

  elements.video.hidden = data.media_type !== "video";
  elements.audio.hidden = data.media_type !== "audio";
  elements.audioArtwork.hidden = data.media_type !== "audio";
  state.activeMedia = data.media_type === "video" ? elements.video : elements.audio;
  state.activeMedia.src = data.preview_url;
  state.activeMedia.load();

  elements.previewSupportNote.hidden = true;
  state.activeMedia.addEventListener("error", () => {
    checkFileExpiration();
    elements.previewSupportNote.hidden = false;
  }, { once: true });

  initTimelineDragEvents();
  fetchAndDecodeAudio(data.preview_url);

  showView("editor");
  setStep(2);
  window.setTimeout(() => elements.editorView.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
}

async function checkFileExpiration() {
  if (!state.jobId) return;
  try {
    const response = await fetch(`/api/jobs/${state.jobId}`, { cache: "no-store" });
    if (response.status === 404) {
      handleFileExpired();
    }
  } catch (_err) {
    // Ignore network dropouts
  }
}

function handleFileExpired() {
  if (state.expirationTimer) {
    clearInterval(state.expirationTimer);
    state.expirationTimer = null;
  }
  resetMedia();
  if (elements.expirationOverlay) {
    elements.expirationOverlay.hidden = false;
    elements.expirationOverlay.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function probeLocalMediaFast(file) {
  return new Promise((resolve) => {
    const isVideo = file.type.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(file.name);
    const mediaEl = document.createElement(isVideo ? "video" : "audio");
    mediaEl.preload = "metadata";
    const objectUrl = URL.createObjectURL(file);
    mediaEl.src = objectUrl;

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      mediaEl.removeAttribute("src");
    };

    mediaEl.onloadedmetadata = () => {
      const duration = Number(mediaEl.duration) || 0;
      cleanup();
      resolve({ duration, isVideo });
    };

    mediaEl.onerror = () => {
      cleanup();
      resolve(null);
    };

    setTimeout(() => {
      cleanup();
      resolve(null);
    }, 1200);
  });
}

async function uploadFileChunked(file) {
  let chunkSize = 16 * 1024 * 1024; // 16MB default
  if (file.size > 800 * 1024 * 1024) {
    chunkSize = 48 * 1024 * 1024; // 48MB for files > 800MB
  } else if (file.size > 300 * 1024 * 1024) {
    chunkSize = 32 * 1024 * 1024; // 32MB for files > 300MB
  }
  const totalChunks = Math.ceil(file.size / chunkSize);
  const jobId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const uploadStartTime = Date.now();

  for (let i = 0; i < totalChunks; i++) {
    if (state.uploadRequest === "cancelled") return;

    const start = i * chunkSize;
    const end = Math.min(file.size, start + chunkSize);
    const chunk = file.slice(start, end);

    const formData = new FormData();
    formData.append("chunk", chunk, file.name);
    formData.append("chunk_index", i);
    formData.append("total_chunks", totalChunks);
    formData.append("job_id", jobId);
    formData.append("filename", file.name);

    const percent = Math.round(((start + (end - start) * 0.5) / file.size) * 100);
    const currentMB = (end / (1024 * 1024)).toFixed(1);
    const totalMB = (file.size / (1024 * 1024)).toFixed(1);

    const elapsedSeconds = (Date.now() - uploadStartTime) / 1000;
    const uploadedBytesSoFar = start;
    let speedText = "جاري الحساب...";
    if (elapsedSeconds > 0.5 && uploadedBytesSoFar > 0) {
      const speedMBs = (uploadedBytesSoFar / (1024 * 1024)) / elapsedSeconds;
      if (speedMBs >= 1.0) {
        speedText = `${speedMBs.toFixed(1)} MB/ثانية`;
      } else {
        speedText = `${(speedMBs * 1024).toFixed(0)} KB/ثانية`;
      }
    }

    setProgress(percent, {
      kicker: "جاري الرفع",
      title: `جاري رفع الملف... (${currentMB} / ${totalMB} MB)`,
      note: `سرعة الرفع الحالية: ${speedText} • يرجى عدم إغلاق الصفحة.`,
    });

    let success = false;
    let attempt = 0;
    const maxAttempts = 5;
    let errorMsg = "";

    while (!success && attempt < maxAttempts) {
      if (state.uploadRequest === "cancelled") return;
      attempt++;
      try {
        const response = await fetch("/api/upload/chunk", {
          method: "POST",
          body: formData,
        });
        if (response.status === 404) {
          uploadStandardFile(file);
          return;
        }
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "خطأ غير معروف في الخادم");

        if (data.id && i === totalChunks - 1) {
          setProgress(100, { title: "تم رفع الملف بالكامل — نجهّز المعاينة…" });
          window.setTimeout(() => configureEditor(data), 200);
          return;
        }
        success = true;
      } catch (err) {
        errorMsg = err.message || "فشل الاتصال بالخادم";
        console.warn(`Chunk ${i} upload failed (attempt ${attempt}/${maxAttempts}): ${errorMsg}`);
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }

    if (!success) {
      if (errorMsg.includes("404")) {
        uploadStandardFile(file);
      } else {
        showView("upload");
        showError(`فشل رفع أجزاء الملف بعد عدة محاولات: ${errorMsg}`);
      }
      return;
    }
  }
}

function uploadStandardFile(file) {
  setProgress(0, {
    kicker: "جاري رفع الملف",
    title: `نرفع ${file.name}`,
    note: "لا تغلق الصفحة حتى يكتمل الرفع.",
  });

  const formData = new FormData();
  formData.append("file", file);
  const request = new XMLHttpRequest();
  state.uploadRequest = request;
  request.open("POST", "/api/upload");

  request.upload.addEventListener("progress", (event) => {
    if (event.lengthComputable) setProgress((event.loaded / event.total) * 100);
  });

  request.addEventListener("load", () => {
    let data = {};
    try {
      data = JSON.parse(request.responseText || "{}");
    } catch (_error) {
      data = {};
    }
    state.uploadRequest = null;
    if (request.status >= 200 && request.status < 300) {
      setProgress(100, { title: "تم رفع الملف — نجهّز المعاينة…" });
      window.setTimeout(() => configureEditor(data), 250);
    } else {
      showView("upload");
      showError(data.error || "تعذّر رفع الملف. حاول مرة أخرى.");
    }
  });

  request.addEventListener("abort", () => {
    state.uploadRequest = null;
    showView("upload");
    showNotice("تم إلغاء رفع الملف.");
  });

  request.addEventListener("error", () => {
    state.uploadRequest = null;
    showView("upload");
    showError("انقطع الاتصال أثناء رفع الملف. حاول مرة أخرى.");
  });
  request.send(formData);
}

async function uploadFile(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  if (!supportedExtensions.has(extension)) {
    showError("الصيغة غير مدعومة. استخدم MP4 أو MOV أو WEBM أو MP3 أو WAV.");
    return;
  }
  if (file.size === 0) {
    showError("هذا الملف فارغ. اختر ملفًا آخر.");
    return;
  }

  resetMedia();
  elements.cancelOperationButton.disabled = false;
  elements.cancelOperationButton.textContent = "إلغاء العملية";
  showView("progress");
  setStep(1);

  // Fast client-side metadata probe
  probeLocalMediaFast(file).then((localInfo) => {
    if (localInfo && localInfo.duration > 0) {
      state.duration = localInfo.duration;
    }
  });

  if (file.size > 100 * 1024 * 1024) {
    uploadFileChunked(file);
    return;
  }

  uploadStandardFile(file);
}async function shareResultFile() {
  if (!elements.downloadButton.href || elements.downloadButton.href === "#") return;
  const originalText = elements.shareButton.textContent;
  try {
    elements.shareButton.disabled = true;
    elements.shareButton.textContent = "⌛ جاري تجهيز المشاركة...";

    const response = await fetch(elements.downloadButton.href);
    const blob = await response.blob();
    const extension = state.extension ? state.extension.toLowerCase() : "mp4";
    const filename = `${elements.resultName.textContent || "video-trimmed"}`;
    const file = new File([blob], filename, { type: blob.type || "video/mp4" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: "TrimFast Video",
        text: "تم قص المقطع بواسطة TrimFast",
      });
    } else {
      showError("عذراً، هذا المتصفح لا يدعم مشاركة الملفات المباشرة.");
    }
  } catch (err) {
    console.error("Share failed:", err);
    showError("فشلت مشاركة وحفظ الملف. يرجى استخدام زر التحميل المباشر.");
  } finally {
    elements.shareButton.disabled = false;
    elements.shareButton.textContent = originalText;
  }
}

function previewClip() {
  if (!state.activeMedia) return;
  const { start, end } = selectedTimes();
  state.previewingClip = true;
  state.activeMedia.currentTime = start;
  const playPromise = state.activeMedia.play();
  if (playPromise) {
    playPromise.catch(() => showError("تعذّرت المعاينة في هذا المتصفح. لا يزال بإمكانك قص الملف."));
  }

  const stopAtEnd = () => {
    if (state.previewingClip && state.activeMedia.currentTime >= end - 0.03) {
      state.activeMedia.pause();
      state.previewingClip = false;
      state.activeMedia.removeEventListener("timeupdate", stopAtEnd);
    }
  };
  state.activeMedia.addEventListener("timeupdate", stopAtEnd);
}

async function startTrim() {
  if (!state.jobId) return;
  const { start, end } = selectedTimes();
  if (end <= start) {
    showError("يجب أن يكون وقت النهاية بعد وقت البداية.");
    return;
  }

  if (state.activeMedia) state.activeMedia.pause();
  showView("progress");
  setStep(2);
  const usesFastPath = state.aspectRatio === "original";
  setProgress(1, {
    kicker: "جاري قص المقطع",
    title: usesFastPath ? "نقص الملف بسرعة دون إعادة ضغط…" : "نغيّر الأبعاد مع الحفاظ على جودة عالية…",
    note: usesFastPath ? "وضع القص السريع مفعل لأن الأبعاد أصلية." : "تغيير الأبعاد يحتاج معالجة إضافية وقد يستغرق وقتًا أطول.",
  });

  try {
    const response = await fetch(`/api/jobs/${state.jobId}/trim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start, end, aspect_ratio: state.aspectRatio }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    state.statusUrl = data.status_url;
    listenJobEvents(state.jobId);
  } catch (error) {
    showView("editor");
    showError(error.message || "تعذّر بدء قص الملف.");
  }
}

function playCompletionChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const playNote = (freq, time, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, time);
      gain.gain.setValueAtTime(0.01, time);
      gain.gain.exponentialRampToValueAtTime(0.18, time + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(time);
      osc.stop(time + duration);
    };
    playNote(523.25, now, 0.35);
    playNote(783.99, now + 0.12, 0.55);
  } catch (_e) {}
}

function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

function showDesktopNotification(filename) {
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification("TrimFast — تمّ القص بنجاح! ✂️", {
        body: `تم قص ملفك (${filename}) وهو جاهز للتحميل الآن.`,
        icon: "/static/favicon.svg",
      });
    } catch (_e) {}
  }
}

function listenJobEvents(jobId) {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  requestNotificationPermission();

  if (!window.EventSource) {
    pollStatus(`/api/jobs/${jobId}`);
    return;
  }

  const es = new EventSource(`/api/jobs/${jobId}/stream`);
  state.eventSource = es;

  es.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data || "{}");
    } catch (_e) {
      return;
    }

    if (data.status === "completed") {
      es.close();
      state.eventSource = null;
      showResult(data);
      return;
    }

    if (data.status === "failed" || data.status === "cancelled") {
      es.close();
      state.eventSource = null;
      showView("editor");
      setStep(2);
      if (data.status === "cancelled") {
        elements.cancelOperationButton.disabled = false;
        elements.cancelOperationButton.textContent = "إلغاء العملية";
        showNotice("تم إلغاء العملية وحذف الملفات المؤقتة.");
      } else {
        showError(data.error || "فشلت معالجة الملف.");
      }
      return;
    }

    if (data.progress !== undefined) {
      setProgress(data.progress, {
        title: data.processing_note || "نقص المقطع بدقة وبجودة عالية…",
      });
    }
  };

  es.onerror = () => {
    es.close();
    state.eventSource = null;
    pollStatus(`/api/jobs/${jobId}`);
  };
}

async function pollStatus(statusUrl) {
  clearTimeout(state.pollTimer);
  try {
    const response = await fetch(statusUrl, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    if (data.status === "completed") {
      state.statusUrl = null;
      showResult(data);
      return;
    }
    if (data.status === "failed" || data.status === "cancelled") {
      state.statusUrl = null;
      showView("editor");
      setStep(2);
      if (data.status === "cancelled") {
        elements.cancelOperationButton.disabled = false;
        elements.cancelOperationButton.textContent = "إلغاء العملية";
        showNotice("تم إلغاء العملية وحذف الملفات المؤقتة.");
      } else {
        throw new Error(data.error);
      }
      return;
    }

    setProgress(data.progress, {
      title: data.processing_note || "نقص المقطع بدقة وبجودة عالية…",
    });
    state.pollTimer = setTimeout(() => pollStatus(statusUrl), 650);
  } catch (error) {
    showView("editor");
    setStep(2);
    showError(error.message || "تعذّرت معالجة الملف. حاول مرة أخرى.");
  }
}

function showResult(data) {
  const { start, end } = selectedTimes();
  elements.resultType.textContent = state.extension;
  elements.resultName.textContent = data.filename;
  elements.resultName.title = data.filename;
  elements.resultSize.textContent = formatBytes(data.output_size);
  elements.resultDuration.textContent = formatDuration(data.output_duration || (end - start));
  elements.downloadButton.href = data.download_url;
  if (elements.shareButton) {
    elements.shareButton.style.display = navigator.share ? "inline-flex" : "none";
  }
  showView("result");
  setStep(3);
  playCompletionChime();
  showDesktopNotification(data.filename);
  window.setTimeout(() => elements.resultView.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
}

function resetMedia() {
  clearTimeout(state.pollTimer);
  if (state.expirationTimer) {
    clearInterval(state.expirationTimer);
    state.expirationTimer = null;
  }
  state.previewingClip = false;
  [elements.video, elements.audio].forEach((media) => {
    media.pause();
    media.removeAttribute("src");
    media.load();
  });
  state.activeMedia = null;
}

async function cancelOperation() {
  if (state.uploadRequest) {
    state.uploadRequest.abort();
    return;
  }
  if (!state.jobId || !state.statusUrl) return;
  elements.cancelOperationButton.disabled = true;
  elements.cancelOperationButton.textContent = "جارٍ الإلغاء…";
  try {
    const response = await fetch("/api/jobs/" + state.jobId + "/cancel", { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    if (data.status === "cancelled") {
      state.statusUrl = null;
      elements.cancelOperationButton.disabled = false;
      elements.cancelOperationButton.textContent = "إلغاء العملية";
      showView("upload");
      setStep(1);
      showNotice("تم إلغاء العملية وحذف الملفات المؤقتة.");
    }
  } catch (error) {
    elements.cancelOperationButton.disabled = false;
    elements.cancelOperationButton.textContent = "إلغاء العملية";
    showError(error.message || "تعذّر إلغاء العملية.");
  }
}

function resetAll() {
  resetMedia();
  if (elements.expirationOverlay) {
    elements.expirationOverlay.hidden = true;
  }
  state.jobId = null;
  state.duration = 0;
  state.extension = "";
  state.mediaType = "";
  state.statusUrl = null;
  state.aspectRatio = "original";
  elements.fileInput.value = "";
  elements.previewSupportNote.hidden = true;
  showView("upload");
  setStep(1);
  window.setTimeout(() => elements.uploadView.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
}

loadTheme();
loadShortcuts();
updateShortcutSettingsUI();
if (elements.themeButton) {
  elements.themeButton.addEventListener("click", toggleTheme);
}
elements.cancelOperationButton.addEventListener("click", cancelOperation);
elements.aspectOptions.forEach((button) => {
  button.addEventListener("click", () => setAspectRatio(button.dataset.aspect));
});
elements.settingsButton.addEventListener("click", openSettings);
elements.closeSettingsButton.addEventListener("click", closeSettings);
elements.saveSettingsButton.addEventListener("click", saveShortcuts);
function handleMediaTimeUpdate() {
  if (!state.activeMedia || !state.duration) return;
  const time = Math.max(0, Math.min(Number(state.activeMedia.currentTime) || 0, state.duration || 0));
  const { start, end } = selectedTimes();

  if (elements.playheadLine) {
    const percent = (time / state.duration) * 100;
    elements.playheadLine.hidden = false;
    elements.playheadLine.style.left = `${percent}%`;
  }

  updateMobilePlayhead();

  if (time >= end - 0.05) {
    if (state.isLoopingPreview) {
      state.activeMedia.currentTime = start;
      state.activeMedia.play().catch(() => {});
    } else if (state.previewingClip) {
      state.activeMedia.pause();
      state.activeMedia.currentTime = start;
      state.previewingClip = false;
    }
  }
}

elements.resetShortcutsButton.addEventListener("click", resetShortcuts);
elements.shortcutCaptureButtons.forEach((button) => {
  button.addEventListener("click", () => beginShortcutCapture(button.dataset.shortcutTarget));
});
elements.mobileStartMarker.addEventListener("click", () => setMarkerFromTouch("start", elements.mobileStartMarker));
elements.mobileEndMarker.addEventListener("click", () => setMarkerFromTouch("end", elements.mobileEndMarker));
[elements.video, elements.audio].forEach((media) => {
  media.addEventListener("timeupdate", handleMediaTimeUpdate);
  media.addEventListener("seeking", handleMediaTimeUpdate);
  media.addEventListener("loadedmetadata", handleMediaTimeUpdate);
});
elements.startShortcutHint.addEventListener("click", () => setMarker("start"));
elements.endShortcutHint.addEventListener("click", () => setMarker("end"));
elements.settingsDialog.addEventListener("cancel", () => closeSettings());
elements.settingsDialog.addEventListener("close", () => {
  state.capturingShortcut = null;
  state.pendingShortcuts = null;
  updateShortcutSettingsUI();
});
window.addEventListener("keydown", handleGlobalKeydown);
window.addEventListener("resize", drawWaveform);

elements.dropZone.addEventListener("click", () => elements.fileInput.click());
elements.dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    elements.fileInput.click();
  }
});

elements.fileInput.addEventListener("change", () => {
  const file = elements.fileInput.files[0];
  if (file) {
    elements.fileInput.value = "";
    uploadFile(file);
  }
});

["dragenter", "dragover"].forEach((eventName) => {
  window.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (elements.uploadView && !elements.uploadView.hidden) {
      elements.dropZone.classList.add("is-dragging");
    }
  });
});

["dragleave"].forEach((eventName) => {
  window.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (!event.relatedTarget || event.relatedTarget === document.documentElement) {
      elements.dropZone.classList.remove("is-dragging");
    }
  });
});

window.addEventListener("drop", (event) => {
  event.preventDefault();
  elements.dropZone.classList.remove("is-dragging");
  if (elements.uploadView && !elements.uploadView.hidden && event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]) {
    uploadFile(event.dataTransfer.files[0]);
  }
});

elements.startRange.addEventListener("input", () => updateTimeUI("startRange"));
elements.endRange.addEventListener("input", () => updateTimeUI("endRange"));
elements.startInput.addEventListener("change", () => updateTimeUI("startInput"));
elements.endInput.addEventListener("change", () => updateTimeUI("endInput"));
elements.previewButton.addEventListener("click", previewClip);
if (elements.loopPreviewButton) {
  elements.loopPreviewButton.addEventListener("click", toggleLoopPreview);
}
elements.trimButton.addEventListener("click", startTrim);
elements.replaceButton.addEventListener("click", resetAll);
elements.newFileButton.addEventListener("click", resetAll);
if (elements.expiredResetBtn) {
  elements.expiredResetBtn.addEventListener("click", resetAll);
}
if (elements.shareButton) {
  elements.shareButton.addEventListener("click", shareResultFile);
}

if (elements.dockStartBtn) {
  elements.dockStartBtn.addEventListener("click", () => setMarkerFromTouch("start", elements.dockStartBtn));
}
if (elements.dockEndBtn) {
  elements.dockEndBtn.addEventListener("click", () => setMarkerFromTouch("end", elements.dockEndBtn));
}
if (elements.dockPreviewBtn) {
  elements.dockPreviewBtn.addEventListener("click", previewClip);
}
if (elements.dockTrimBtn) {
  elements.dockTrimBtn.addEventListener("click", startTrim);
}
