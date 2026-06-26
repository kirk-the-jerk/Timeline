import { getTimelineSchemaWarnings, normalizeTimeline } from "./timeline.js";

export function createTimelineLoadController({
  dialog,
  closeButton,
  openButton,
  fileInput,
  dropTargets = [],
  dragClassTarget,
  progressBar,
  log,
  onTimelineLoaded,
  onStatus
}) {
  openButton?.addEventListener("click", () => {
    fileInput.click();
  });

  closeButton?.addEventListener("click", () => {
    dialog.close();
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    await loadFile(file);
    fileInput.value = "";
  });

  for (const dropTarget of dropTargets) {
    dropTarget.addEventListener("dragover", (event) => {
      event.preventDefault();
      dragClassTarget?.classList.add("dragging");
    });

    dropTarget.addEventListener("dragleave", (event) => {
      if (!dropTarget.contains(event.relatedTarget)) {
        dragClassTarget?.classList.remove("dragging");
      }
    });

    dropTarget.addEventListener("drop", async (event) => {
      event.preventDefault();
      dragClassTarget?.classList.remove("dragging");
      const file = event.dataTransfer.files?.[0];
      if (!file) return;
      await loadFile(file);
    });
  }

  async function loadFile(file) {
    showDialog(dialog);
    resetLoadProgress({ progressBar, log });
    appendLoadLog(log, `Selected ${file.name || "unnamed file"} (${formatBytes(file.size)}).`);

    try {
      if (isZipFile(file)) {
        setLoadProgress(progressBar, 100);
        throw new Error("ZIP loading is not implemented yet.");
      }

      appendLoadLog(log, "Reading file...");
      const text = await readFileText(file, (progress) => {
        setLoadProgress(progressBar, Math.min(70, Math.round(progress * 70)));
      });

      appendLoadLog(log, "Parsing timeline data...");
      setLoadProgress(progressBar, 82);
      const parsedTimeline = parseTimelineFile(file, text);

      appendLoadLog(log, "Normalizing schema...");
      setLoadProgress(progressBar, 92);
      const timeline = normalizeTimeline(parsedTimeline);
      const warnings = getTimelineSchemaWarnings(timeline);

      for (const warning of warnings) {
        appendLoadLog(log, `Warning: ${warning}`);
      }
      if (warnings.length > 0) console.warn("Timeline schema warnings", warnings);

      const customMessage = await onTimelineLoaded(timeline, { file, warnings });
      setLoadProgress(progressBar, 100);
      appendLoadLog(log, "Load complete.");
      onStatus?.(customMessage || loadedMessage(file, warnings));
    } catch (error) {
      setLoadProgress(progressBar, 100);
      appendLoadLog(log, `Error: ${error.message}`);
      onStatus?.(`Import failed: ${error.message}`);
    }
  }

  return { loadFile };
}

export function showDialog(dialog) {
  if (dialog.open) return;
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

function resetLoadProgress({ progressBar, log }) {
  log.innerHTML = "";
  setLoadProgress(progressBar, 0);
}

function setLoadProgress(progressBar, percent) {
  progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function appendLoadLog(log, message) {
  const line = document.createElement("div");
  line.textContent = message;
  log.append(line);
  log.scrollTop = log.scrollHeight;
}

async function readFileText(file, onProgress) {
  if (typeof file.stream === "function" && typeof TextDecoder !== "undefined") {
    const reader = file.stream().getReader();
    const decoder = new TextDecoder();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      chunks.push(decoder.decode(value, { stream: true }));
      onProgress(file.size > 0 ? received / file.size : 1);
    }

    chunks.push(decoder.decode());
    return chunks.join("");
  }

  const text = await file.text();
  onProgress(1);
  return text;
}

function parseTimelineFile(file, text) {
  const kind = getFileKind(file);
  if (kind === "html") return extractTimelineFromHtml(text);
  if (kind === "json") return JSON.parse(text);

  try {
    return JSON.parse(text);
  } catch (jsonError) {
    try {
      return extractTimelineFromHtml(text);
    } catch (htmlError) {
      throw new Error(`Could not parse as JSON (${jsonError.message}) or standalone HTML (${htmlError.message}).`);
    }
  }
}

function extractTimelineFromHtml(text) {
  const document = new DOMParser().parseFromString(text, "text/html");
  const dataScript = document.querySelector("#timeline-data");
  if (!dataScript) {
    throw new Error("No #timeline-data script tag found.");
  }
  return JSON.parse(dataScript.textContent);
}

function getFileKind(file) {
  const name = String(file.name || "").toLowerCase();
  const type = String(file.type || "").toLowerCase();
  if (name.endsWith(".zip") || type.includes("zip")) return "zip";
  if (name.endsWith(".html") || name.endsWith(".htm") || type === "text/html") return "html";
  if (name.endsWith(".json") || type === "application/json") return "json";
  return "unknown";
}

function isZipFile(file) {
  return getFileKind(file) === "zip";
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** exponent);
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function loadedMessage(file, warnings) {
  return warnings.length > 0
    ? `Loaded ${file.name} with ${warnings.length} schema warning${warnings.length === 1 ? "" : "s"}.`
    : `Loaded ${file.name}.`;
}
