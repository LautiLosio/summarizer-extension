const STORAGE_KEYS = {
  CONFIG: "sts_config",
};

const DEFAULT_MIN_WORDS = 12;
const DEFAULT_CONFIG = {
  minWords: DEFAULT_MIN_WORDS,
  ask: {
    style: "concise",
    format: "markdown",
  },
  summarize: {
    page: {
      type: "key-points",
      format: "markdown",
      length: "medium",
      instructions:
        "Ignore navigation, footer, cookie notices, advertisements, and unrelated links.",
    },
    selection: {
      type: "key-points",
      format: "markdown",
      length: "short",
      instructions: "Focus on the selected text. Keep the result compact.",
    },
  },
};
const ALLOWED = {
  askStyle: ["concise", "balanced", "detailed"],
  format: ["markdown", "plain-text"],
  summaryType: ["key-points", "tldr", "teaser", "headline"],
  summaryLength: ["short", "medium", "long"],
};
const FLAG_LINKS = [
  ["On-device model", "chrome://flags/#optimization-guide-on-device-model"],
  ["Prompt API", "chrome://flags/#prompt-api-for-gemini-nano"],
  ["Summaries", "chrome://flags/#summarization-api-for-gemini-nano"],
];

const API_DEFINITIONS = [
  {
    name: "LanguageModel",
    label: "Assistant model",
    group: "core",
    createOptions: {
      expectedInputs: [{ type: "text", languages: ["en", "es", "ja"] }],
      expectedOutputs: [{ type: "text", languages: ["en", "es", "ja"] }],
    },
  },
  {
    name: "Summarizer",
    label: "Summaries",
    group: "core",
    createOptions: { type: "key-points", format: "markdown", length: "medium" },
  },
];

const LANGUAGE_MODEL_OPTION_FALLBACKS = [
  API_DEFINITIONS.find((definition) => definition.name === "LanguageModel")
    .createOptions,
  {
    expectedInputs: [{ type: "text", languages: ["en"] }],
    expectedOutputs: [{ type: "text", languages: ["en"] }],
  },
  {},
];

const storage = {
  get: (keys) => new Promise((resolve) => chrome.storage.sync.get(keys, resolve)),
  set: (items) => new Promise((resolve) => chrome.storage.sync.set(items, resolve)),
};

const elements = {
  overallTitle: document.getElementById("overall-title"),
  overallPill: document.getElementById("overall-pill"),
  overallMessage: document.getElementById("overall-message"),
  checklist: document.getElementById("checklist"),
  modelList: document.getElementById("model-list"),
  refreshBtn: document.getElementById("refresh-btn"),
  downloadCoreBtn: document.getElementById("download-core-btn"),
  openModelsBtn: document.getElementById("open-models-btn"),
  progressWrap: document.getElementById("download-progress"),
  progressText: document.getElementById("download-progress-text"),
  progressBar: document.getElementById("download-progress-bar"),
  minWordsInput: document.getElementById("minWords"),
  askStyleInput: document.getElementById("askStyle"),
  askFormatInput: document.getElementById("askFormat"),
  pageSummaryTypeInput: document.getElementById("pageSummaryType"),
  pageSummaryLengthInput: document.getElementById("pageSummaryLength"),
  pageSummaryFormatInput: document.getElementById("pageSummaryFormat"),
  pageSummaryInstructionsInput: document.getElementById("pageSummaryInstructions"),
  selectionSummaryTypeInput: document.getElementById("selectionSummaryType"),
  selectionSummaryLengthInput: document.getElementById("selectionSummaryLength"),
  selectionSummaryFormatInput: document.getElementById("selectionSummaryFormat"),
  selectionSummaryInstructionsInput: document.getElementById("selectionSummaryInstructions"),
  saveSettingsBtn: document.getElementById("save-settings-btn"),
  saveStatus: document.getElementById("save-status"),
};

let initialConfigJson = "";
let currentRows = [];

function normalizeMinWords(value) {
  const num = Number(value);
  return Math.max(1, Number.isFinite(num) ? num : DEFAULT_MIN_WORDS);
}

function pickAllowed(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return (text || fallback).slice(0, 500);
}

function normalizeConfig(config = {}) {
  return {
    minWords: normalizeMinWords(config.minWords ?? DEFAULT_MIN_WORDS),
    ask: {
      style: pickAllowed(
        config.ask?.style,
        ALLOWED.askStyle,
        DEFAULT_CONFIG.ask.style,
      ),
      format: pickAllowed(
        config.ask?.format,
        ALLOWED.format,
        DEFAULT_CONFIG.ask.format,
      ),
    },
    summarize: {
      page: normalizeSummaryConfig(config.summarize?.page, DEFAULT_CONFIG.summarize.page),
      selection: normalizeSummaryConfig(
        config.summarize?.selection,
        DEFAULT_CONFIG.summarize.selection,
      ),
    },
  };
}

function normalizeSummaryConfig(config = {}, defaults) {
  return {
    type: pickAllowed(config.type, ALLOWED.summaryType, defaults.type),
    format: pickAllowed(config.format, ALLOWED.format, defaults.format),
    length: pickAllowed(config.length, ALLOWED.summaryLength, defaults.length),
    instructions: normalizeText(config.instructions, defaults.instructions),
  };
}

function readSettingsForm() {
  return normalizeConfig({
    minWords: elements.minWordsInput?.value,
    ask: {
      style: elements.askStyleInput?.value,
      format: elements.askFormatInput?.value,
    },
    summarize: {
      page: {
        type: elements.pageSummaryTypeInput?.value,
        length: elements.pageSummaryLengthInput?.value,
        format: elements.pageSummaryFormatInput?.value,
        instructions: elements.pageSummaryInstructionsInput?.value,
      },
      selection: {
        type: elements.selectionSummaryTypeInput?.value,
        length: elements.selectionSummaryLengthInput?.value,
        format: elements.selectionSummaryFormatInput?.value,
        instructions: elements.selectionSummaryInstructionsInput?.value,
      },
    },
  });
}

function writeSettingsForm(config) {
  elements.minWordsInput.value = String(config.minWords);
  elements.askStyleInput.value = config.ask.style;
  elements.askFormatInput.value = config.ask.format;
  elements.pageSummaryTypeInput.value = config.summarize.page.type;
  elements.pageSummaryLengthInput.value = config.summarize.page.length;
  elements.pageSummaryFormatInput.value = config.summarize.page.format;
  elements.pageSummaryInstructionsInput.value = config.summarize.page.instructions;
  elements.selectionSummaryTypeInput.value = config.summarize.selection.type;
  elements.selectionSummaryLengthInput.value = config.summarize.selection.length;
  elements.selectionSummaryFormatInput.value = config.summarize.selection.format;
  elements.selectionSummaryInstructionsInput.value =
    config.summarize.selection.instructions;
}

function updateSaveAccent() {
  const current = JSON.stringify(readSettingsForm());
  const changed = initialConfigJson ? current !== initialConfigJson : false;
  elements.saveSettingsBtn?.classList.toggle("tactile-btn--primary", changed);
  elements.saveSettingsBtn?.classList.toggle("tactile-btn--ghost", !changed);
}

function normalizeStatus(status) {
  if (status === "available" || status === "ready") return "ready";
  if (status === "downloadable" || status === "not-ready") return "downloadable";
  if (status === "downloading") return "downloading";
  if (status === "unavailable" || status === "not exposed") return "blocked";
  return "unknown";
}

async function checkApi(definition) {
  if (!(definition.name in self)) {
    return { ...definition, rawStatus: "not exposed", status: "blocked" };
  }

  try {
    const api = self[definition.name];
    const check = await getAvailabilityWithFallbacks(api, definition);
    return {
      ...definition,
      createOptions: check.options,
      rawStatus: check.status,
      status: normalizeStatus(check.status),
      fallbackLabel: check.label,
    };
  } catch (error) {
    return {
      ...definition,
      rawStatus: error instanceof Error ? error.message : "check failed",
      status: "blocked",
    };
  }
}

async function getAvailabilityWithFallbacks(api, definition) {
  if (!api.availability) {
    return { status: "available", options: definition.createOptions, label: "default" };
  }

  const candidates =
    definition.name === "LanguageModel"
      ? LANGUAGE_MODEL_OPTION_FALLBACKS
      : [definition.createOptions];
  const failures = [];

  for (const options of candidates) {
    try {
      const status = await api.availability(options);
      if (status !== "unavailable") {
        return { status, options, label: describeOptions(options) };
      }
      failures.push(`${describeOptions(options)}: unavailable`);
    } catch (error) {
      if (Object.keys(options || {}).length === 0) {
        failures.push(
          `${describeOptions(options)}: ${
            error instanceof Error ? error.message : "availability failed"
          }`,
        );
        continue;
      }
      try {
        const status = await api.availability();
        if (status !== "unavailable") {
          return { status, options: {}, label: "default" };
        }
        failures.push("default: unavailable");
      } catch (fallbackError) {
        failures.push(
          `${describeOptions(options)}: ${
            fallbackError instanceof Error
              ? fallbackError.message
              : "availability failed"
          }`,
        );
      }
    }
  }

  throw new Error(failures.join("; "));
}

function describeOptions(options = {}) {
  if (!Object.keys(options || {}).length) return "default";
  const inputLanguages = options.expectedInputs?.[0]?.languages?.join(", ");
  const outputLanguages = options.expectedOutputs?.[0]?.languages?.join(", ");
  if (inputLanguages || outputLanguages) {
    return `input ${inputLanguages || "default"} / output ${outputLanguages || "default"}`;
  }
  return "configured options";
}

async function refreshApis() {
  setLoadingState();
  currentRows = await Promise.all(API_DEFINITIONS.map(checkApi));
  renderState(currentRows);
}

function setLoadingState() {
  elements.overallTitle.textContent = "Checking Chrome AI";
  elements.overallPill.textContent = "...";
  elements.overallPill.className = "state-badge";
  elements.overallMessage.textContent = "";
  elements.checklist.innerHTML = `<div class="check-row"><span class="check-dot pending"></span><span>Checking setup</span></div>`;
  elements.modelList.innerHTML = "";
}

function renderState(rows) {
  const ready = rows.filter((row) => row.status === "ready");
  const downloadable = rows.filter((row) => row.status === "downloadable");
  const downloading = rows.filter((row) => row.status === "downloading");
  const blocked = rows.filter((row) => row.status === "blocked");

  if (downloading.length) {
    setOverall("Model download in progress", "Downloading", "pending", "Chrome reports that a model is still downloading. If it stays here, open Model manager and relaunch Chrome.");
  } else if (ready.some((row) => row.name === "LanguageModel")) {
    setOverall("Assistant model is ready", "Ready", "ready", "The in-page assistant can run.");
  } else if (downloadable.length) {
    setOverall("Model can be started", "Start needed", "pending", "Click Start model once. Chrome may need a few minutes.");
  } else {
    setOverall("Chrome AI is not enabled", "Needs setup", "blocked", "Open flags, enable the listed items, then relaunch Chrome.");
  }

  elements.downloadCoreBtn.disabled = !downloadable.length && !downloading.length;
  elements.downloadCoreBtn.textContent = downloading.length ? "Downloading..." : "Start model";

  renderChecklist(rows);
  renderModels(rows, { blocked });
}

function setOverall(title, pill, tone, message) {
  elements.overallTitle.textContent = title;
  elements.overallPill.textContent = pill;
  elements.overallPill.className = `state-badge ${tone}`;
  elements.overallMessage.textContent = message;
}

function checklistItem(label, status, detail = "") {
  const dot = status === "ready" ? "ready" : status === "pending" ? "pending" : "blocked";
  const suffix = detail ? `<span>${detail}</span>` : "";
  return `<div class="check-row"><span class="check-dot ${dot}"></span><strong>${label}</strong>${suffix}</div>`;
}

function renderChecklist(rows) {
  const exposed = rows.filter((row) => row.rawStatus !== "not exposed");
  const core = rows.find((row) => row.name === "LanguageModel");
  const summary = rows.find((row) => row.name === "Summarizer");
  const anyDownload = rows.some((row) => row.status === "downloadable" || row.status === "downloading" || row.status === "ready");

  const inferredRows = [
    checklistItem("Chrome flags", exposed.length ? "ready" : "blocked", exposed.length ? "Detected" : "Enable and relaunch"),
    checklistItem("Assistant model", core?.status === "ready" ? "ready" : core?.status === "downloadable" || core?.status === "downloading" ? "pending" : "blocked", statusText(core)),
    checklistItem("Summaries", summary?.status === "ready" ? "ready" : summary?.status === "downloadable" || summary?.status === "downloading" ? "pending" : "blocked", statusText(summary)),
    checklistItem("Local model", anyDownload ? "ready" : "blocked", anyDownload ? "Detected by Chrome" : "Not detected"),
  ];
  const flagRows = FLAG_LINKS.map(([label, url]) => flagItem(label, url, exposed.length ? "ready" : "blocked"));
  elements.checklist.innerHTML = [...inferredRows, ...flagRows].join("");
  elements.checklist.querySelectorAll("[data-open-flag]").forEach((button) => {
    button.addEventListener("click", () => openChromePage(button.dataset.openFlag));
  });
  elements.checklist.querySelectorAll("[data-copy-flag]").forEach((button) => {
    button.addEventListener("click", () => copyFlag(button));
  });
}

function flagItem(label, url, status) {
  const dot = status === "ready" ? "ready" : "blocked";
  return `
    <div class="check-row flag-row">
      <span class="check-dot ${dot}"></span>
      <strong>${label}</strong>
      <span>${url.replace("chrome://flags/#", "")}</span>
      <div class="row-actions">
        <button class="quiet-button" data-open-flag="${url}" type="button">Open</button>
        <button class="quiet-button" data-copy-flag="${url}" type="button">Copy</button>
      </div>
    </div>
  `;
}

function renderModels(rows) {
  elements.modelList.innerHTML = rows
    .map((row) => {
      const canStart = row.status === "downloadable" || row.status === "downloading";
      return `
        <div class="model-row">
          <div>
            <strong>${row.label}</strong>
            <span>${statusText(row)}</span>
          </div>
          <button class="tactile-btn tactile-btn--ghost" data-start="${row.name}" type="button" ${canStart ? "" : "disabled"}>
            Start
          </button>
        </div>
      `;
    })
    .join("");

  elements.modelList.querySelectorAll("[data-start]").forEach((button) => {
    button.addEventListener("click", () => startModel(button.dataset.start));
  });
}

function summarizeRows(rows) {
  if (rows.some((row) => row.status === "ready")) return "Ready";
  if (rows.some((row) => row.status === "downloading")) return "Downloading";
  if (rows.some((row) => row.status === "downloadable")) return "Start needed";
  return "Not enabled";
}

function statusText(row) {
  if (!row) return "Not enabled";
  const suffix = row.fallbackLabel ? ` (${row.fallbackLabel})` : "";
  if (row.status === "ready") return `Ready${suffix}`;
  if (row.status === "downloadable") return `Start needed${suffix}`;
  if (row.status === "downloading") return `Downloading${suffix}`;
  if (row.status === "blocked") return "Not enabled";
  return "Unknown";
}

async function startCoreModel() {
  const target = currentRows.find((row) => row.status === "downloadable" || row.status === "downloading") || currentRows.find((row) => row.name === "LanguageModel");
  await startModel(target?.name || "LanguageModel");
}

async function startModel(name) {
  const definition = API_DEFINITIONS.find((item) => item.name === name);
  if (!definition || !(definition.name in self)) {
    setOverall("API is not enabled", "Needs setup", "blocked", "Open flags, enable Chrome AI, then relaunch Chrome.");
    return;
  }

  showProgress(`Starting ${definition.label}`);
  try {
    const api = self[definition.name];
    if (!navigator.userActivation?.isActive) {
      showProgress("Click Start again if Chrome asks for activation");
    }
    const check = await getAvailabilityWithFallbacks(api, definition);
    if (check.status === "unavailable") {
      throw new Error(`${definition.label} is unavailable with ${check.label}.`);
    }
    const instance = await api.create({
      ...check.options,
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", (event) => {
          const percent = Math.round((event.loaded || 0) * 100);
          showProgress(`${definition.label} ${percent}%`, percent);
        });
      },
    });
    instance?.destroy?.();
    showProgress(`${definition.label} ready`, 100);
    setTimeout(hideProgress, 1200);
    await refreshApis();
  } catch (error) {
    hideProgress();
    setOverall("Model did not start", "Check setup", "blocked", error instanceof Error ? error.message : "Chrome could not start the model.");
  }
}

function showProgress(text, percent = 0) {
  elements.progressWrap.classList.remove("hidden");
  elements.progressText.textContent = text;
  elements.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function hideProgress() {
  elements.progressWrap.classList.add("hidden");
  elements.progressBar.style.width = "0%";
}

function openChromePage(url) {
  chrome.tabs.create({ url });
}

async function copyFlag(button) {
  await navigator.clipboard.writeText(button.dataset.copyFlag || "");
  button.textContent = "Copied";
  setTimeout(() => {
    button.textContent = "Copy";
  }, 1200);
}

async function loadSettings() {
  const res = await storage.get([STORAGE_KEYS.CONFIG]);
  const config = normalizeConfig(res?.[STORAGE_KEYS.CONFIG]);
  writeSettingsForm(config);
  initialConfigJson = JSON.stringify(config);
  updateSaveAccent();
}

async function saveSettings() {
  const config = readSettingsForm();
  await storage.set({ [STORAGE_KEYS.CONFIG]: config });
  writeSettingsForm(config);
  initialConfigJson = JSON.stringify(config);
  updateSaveAccent();
  elements.saveStatus.textContent = "Saved";
  setTimeout(() => (elements.saveStatus.textContent = ""), 1200);
}

function bindSettingsInputs() {
  [
    elements.minWordsInput,
    elements.askStyleInput,
    elements.askFormatInput,
    elements.pageSummaryTypeInput,
    elements.pageSummaryLengthInput,
    elements.pageSummaryFormatInput,
    elements.pageSummaryInstructionsInput,
    elements.selectionSummaryTypeInput,
    elements.selectionSummaryLengthInput,
    elements.selectionSummaryFormatInput,
    elements.selectionSummaryInstructionsInput,
  ].forEach((input) => {
    input?.addEventListener("input", updateSaveAccent);
    input?.addEventListener("change", updateSaveAccent);
  });
}

function init() {
  elements.refreshBtn?.addEventListener("click", refreshApis);
  elements.downloadCoreBtn?.addEventListener("click", startCoreModel);
  elements.openModelsBtn?.addEventListener("click", () => openChromePage("chrome://on-device-internals"));
  elements.saveSettingsBtn?.addEventListener("click", saveSettings);
  bindSettingsInputs();

  loadSettings();
  refreshApis();
}

document.addEventListener("DOMContentLoaded", init);
