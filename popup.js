const AppState = {
  LOADING: "loading",
  READY: "ready",
  DOWNLOAD: "download",
  DOWNLOADING: "downloading",
  ERROR: "error",
};

const STORAGE_KEYS = {
  CONFIG: "sts_config",
  MODEL_DOWNLOADED: "sts_model_downloaded",
};

const storage = {
  get: (keys) =>
    new Promise((resolve) => chrome.storage.sync.get(keys, resolve)),
  set: (items) =>
    new Promise((resolve) => chrome.storage.sync.set(items, resolve)),
};

// Track original settings to determine if there are unsaved changes
let initialMinWords = null;

const elements = {
  container: document.getElementById("container"),
  downloadBtn: document.getElementById("download-btn"),
  downloadProgressBar: document.getElementById("download-progress-bar"),
  downloadProgressText: document.getElementById("download-progress-text"),
  errorMessage: document.getElementById("error-message"),
  minWordsInput: document.getElementById("minWords"),
  saveSettingsBtn: document.getElementById("save-settings-btn"),
  saveStatus: document.getElementById("save-status"),
  statuses: {
    loading: document.getElementById("status-loading"),
    ready: document.getElementById("status-ready"),
    download: document.getElementById("status-download"),
    downloading: document.getElementById("status-downloading"),
    error: document.getElementById("status-error"),
  },
};

function normalizeMinWords(val) {
  const num = Number(val);
  return Math.max(1, isFinite(num) ? num : 40);
}

function updateSaveAccent() {
  if (!elements.saveSettingsBtn) return;
  const current = normalizeMinWords(elements.minWordsInput?.value);
  const changed = initialMinWords == null ? false : current !== initialMinWords;
  elements.saveSettingsBtn.classList.toggle("primary", !!changed);
}

function showStatus(state, msg = "") {
  for (const s in elements.statuses) {
    elements.statuses[s]?.classList.toggle("hidden", s !== state);
  }
  if (state === AppState.ERROR && msg) {
    elements.errorMessage.textContent = msg;
  }
}

async function checkSummarizer() {
  const stored = await storage.get([STORAGE_KEYS.MODEL_DOWNLOADED]);
  if (stored[STORAGE_KEYS.MODEL_DOWNLOADED]) {
    showStatus(AppState.READY);
    return;
  }

  if (!self.Summarizer) {
    showStatus(
      AppState.ERROR,
      "Summarizer API is not supported in this browser.",
    );
    return;
  }

  try {
    const availability = await self.Summarizer.availability();
    if (availability === "ready") {
      await storage.set({ [STORAGE_KEYS.MODEL_DOWNLOADED]: true });
      showStatus(AppState.READY);
    } else if (availability === "not-ready" || availability === "available") {
      showStatus(AppState.DOWNLOAD);
    } else {
      showStatus(
        AppState.ERROR,
        `Summarizer is unavailable. Status: ${availability}`,
      );
    }
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "An unknown error occurred.";
    showStatus(
      AppState.ERROR,
      `Failed to check summarizer availability. ${msg}`,
    );
  }
}

async function downloadModel() {
  showStatus(AppState.DOWNLOADING);
  elements.downloadBtn.disabled = true;
  elements.downloadBtn.textContent = "Downloading...";

  try {
    await self.Summarizer.create({
      monitor: (monitor) => {
        monitor.addEventListener("downloadprogress", (e) => {
          const progress = Math.round(e.loaded * 100);
          elements.downloadProgressBar.style.width = `${progress}%`;
          elements.downloadProgressText.textContent = `Downloaded ${progress}%`;
        });
      },
    });
    await storage.set({ [STORAGE_KEYS.MODEL_DOWNLOADED]: true });
    showStatus(AppState.READY);
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "An unknown error occurred.";
    showStatus(AppState.ERROR, `Failed to download model. ${msg}`);
  } finally {
    elements.downloadBtn.disabled = false;
    elements.downloadBtn.textContent = "Download Model";
  }
}

async function loadSettings() {
  const res = await storage.get([STORAGE_KEYS.CONFIG]);
  const cfg = res?.[STORAGE_KEYS.CONFIG];
  const minWords = normalizeMinWords(cfg?.minWords ?? 40);
  elements.minWordsInput.value = String(minWords);
  initialMinWords = minWords;
  updateSaveAccent();

  // React to input changes
  elements.minWordsInput?.addEventListener("input", updateSaveAccent);
  elements.minWordsInput?.addEventListener("change", updateSaveAccent);
}

async function saveSettings() {
  const minWords = normalizeMinWords(elements.minWordsInput.value || 40);
  await storage.set({ [STORAGE_KEYS.CONFIG]: { minWords } });
  elements.saveStatus.textContent = "Saved!";
  setTimeout(() => (elements.saveStatus.textContent = ""), 1200);
  // Saved state becomes baseline; remove accent highlight
  initialMinWords = minWords;
  updateSaveAccent();
}

function init() {
  if (!elements.container) return;

  elements.downloadBtn?.addEventListener("click", downloadModel);
  elements.saveSettingsBtn?.addEventListener("click", saveSettings);

  showStatus(AppState.LOADING);
  checkSummarizer();
  loadSettings();
}

document.addEventListener("DOMContentLoaded", init);
