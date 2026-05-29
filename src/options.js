import { createFilledIcon } from "./lib/filled-icons.js";

const STORAGE_KEYS = {
  CONFIG: "sts_config",
};

const DEFAULT_MIN_WORDS = 40;
const DEFAULT_CONFIG = {
  minWords: DEFAULT_MIN_WORDS,
  ask: {
    style: "concise",
    format: "markdown",
  },
  summarize: {
    page: {
      type: "tldr",
      format: "markdown",
      length: "short",
      instructions:
        "Ignore navigation, footer, cookie notices, advertisements, and unrelated links. Don't say TL;DR literally.",
    },
    selection: {
      type: "tldr",
      format: "markdown",
      length: "short",
      instructions:
        "Focus on the selected text. Keep the result compact. Don't say TL;DR literally.",
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
const ICONS = {
  ok: "ok",
  manage: "database",
  open: "external-link",
  refresh: "refresh",
  save: "save",
  start: "start",
};

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
  get: (keys) =>
    new Promise((resolve, reject) => {
      chrome.storage.sync.get(keys, (res) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(res);
      });
    }),
  set: (items) =>
    new Promise((resolve, reject) => {
      chrome.storage.sync.set(items, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    }),
};

const elements = {
  overallTitle: document.getElementById("overall-title"),
  overallPill: document.getElementById("overall-pill"),
  overallMessage: document.getElementById("overall-message"),
  onboardingActionBtn: document.getElementById("onboarding-action-btn"),
  checklist: document.getElementById("checklist"),
  modelList: document.getElementById("model-list"),
  progressWrap: document.getElementById("download-progress"),
  progressText: document.getElementById("download-progress-text"),
  progressBar: document.getElementById("download-progress-bar"),
  minWordsInput: document.getElementById("minWords"),
  askStyleInput: document.getElementById("askStyle"),
  askFormatInput: document.getElementById("askFormat"),
  pageSummaryTypeInput: document.getElementById("pageSummaryType"),
  pageSummaryLengthInput: document.getElementById("pageSummaryLength"),
  pageSummaryFormatInput: document.getElementById("pageSummaryFormat"),
  pageSummaryInstructionsInput: document.getElementById(
    "pageSummaryInstructions",
  ),
  selectionSummaryTypeInput: document.getElementById("selectionSummaryType"),
  selectionSummaryLengthInput: document.getElementById(
    "selectionSummaryLength",
  ),
  selectionSummaryFormatInput: document.getElementById(
    "selectionSummaryFormat",
  ),
  selectionSummaryInstructionsInput: document.getElementById(
    "selectionSummaryInstructions",
  ),
  saveSettingsBtn: document.getElementById("save-settings-btn"),
};

let saveFeedbackTimer = null;
let onboardingAction = "refresh";

function setIconButton(button, iconName, label) {
  const iconNode = ICONS[iconName];
  if (!button || !iconNode) return;
  if (
    button.dataset.iconReady === iconName &&
    button.dataset.iconLabel === label
  ) {
    return;
  }
  const icon = createFilledIcon(iconNode);
  if (!icon) return;
  icon.setAttribute("aria-hidden", "true");
  icon.classList.add("option-icon");
  button.textContent = "";
  button.append(icon);
  if (label) button.append(document.createTextNode(label));
  button.dataset.iconReady = iconName;
  button.dataset.iconLabel = label;
}

function decorateStaticButtons() {
  setIconButton(elements.onboardingActionBtn, "refresh", "Check setup");
  setIconButton(elements.saveSettingsBtn, "save", "Save");
}

let initialConfigJson = "";
let currentRows = [];

function runHandled(action, onError = showOptionsError) {
  Promise.resolve().then(action).catch(onError);
}

function showOptionsError(error) {
  hideProgress();
  setOverall(
    "Settings page needs attention",
    "Check setup",
    "blocked",
    error instanceof Error
      ? error.message
      : "Chrome could not complete that action.",
  );
}

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
      page: normalizeSummaryConfig(
        config.summarize?.page,
        DEFAULT_CONFIG.summarize.page,
      ),
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
  elements.pageSummaryInstructionsInput.value =
    config.summarize.page.instructions;
  elements.selectionSummaryTypeInput.value = config.summarize.selection.type;
  elements.selectionSummaryLengthInput.value =
    config.summarize.selection.length;
  elements.selectionSummaryFormatInput.value =
    config.summarize.selection.format;
  elements.selectionSummaryInstructionsInput.value =
    config.summarize.selection.instructions;
}

function updateSaveAccent() {
  const current = JSON.stringify(readSettingsForm());
  const changed = initialConfigJson ? current !== initialConfigJson : false;
  elements.saveSettingsBtn?.classList.toggle("tactile-btn--primary", changed);
  elements.saveSettingsBtn?.classList.toggle("tactile-btn--ghost", !changed);
  updateOnboarding(currentRows);
}

function normalizeStatus(status) {
  if (status === "available" || status === "ready") return "ready";
  if (status === "downloadable" || status === "not-ready")
    return "downloadable";
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
    return {
      status: "available",
      options: definition.createOptions,
      label: "default",
    };
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
  setOnboarding("refresh", "Check setup", "refresh");
  elements.checklist.innerHTML = `<div class="check-row"><span class="check-dot pending"></span><span>Checking setup</span></div>`;
  elements.modelList.innerHTML = "";
}

function renderState(rows) {
  const ready = rows.filter((row) => row.status === "ready");
  const downloadable = rows.filter((row) => row.status === "downloadable");
  const downloading = rows.filter((row) => row.status === "downloading");
  const blocked = rows.filter((row) => row.status === "blocked");

  if (downloading.length) {
    setOverall(
      "Model download in progress",
      "Downloading",
      "pending",
      "Chrome reports that a model is still downloading. If it stays here, open Model manager and relaunch Chrome.",
    );
  } else if (ready.some((row) => row.name === "LanguageModel")) {
    setOverall(
      "Extension status",
      "Ready to use",
      "ready",
      "The in-page assistant and summaries can run.",
    );
  } else if (downloadable.length) {
    setOverall(
      "Model needs one start",
      "Start needed",
      "pending",
      "Use the setup action once. Chrome may need a few minutes.",
    );
  } else {
    setOverall(
      "Chrome AI is not enabled",
      "Needs setup",
      "blocked",
      "Open flags, enable the listed items, then relaunch Chrome.",
    );
  }

  renderChecklist(rows);
  renderModels(rows, { blocked });
  updateOnboarding(rows);
}

function setOverall(title, pill, tone, message) {
  elements.overallTitle.textContent = title;
  elements.overallPill.textContent = pill;
  elements.overallPill.className = `state-badge ${tone}`;
  elements.overallMessage.textContent = message;
}

function updateOnboarding(rows = []) {
  const core = rows.find((row) => row.name === "LanguageModel");
  const summary = rows.find((row) => row.name === "Summarizer");
  const exposed = rows.some((row) => row.rawStatus !== "not exposed");
  const hasDownloadable = rows.some(
    (row) => row.status === "downloadable" || row.status === "downloading",
  );
  const allReady = core?.status === "ready" && summary?.status === "ready";

  if (!rows.length) {
    setOnboarding("refresh", "Check setup", "refresh");
    return;
  }

  if (!exposed) {
    setOnboarding("flags", "Open flags", "open");
    return;
  }

  if (hasDownloadable) {
    const downloading = rows.some((row) => row.status === "downloading");
    setOnboarding(
      downloading ? "refresh" : "start",
      downloading ? "Check progress" : "Start model",
      downloading ? "refresh" : "start",
    );
    return;
  }

  if (!allReady) {
    setOnboarding("models", "Manage models", "manage");
    return;
  }

  setOnboarding("refresh", "Check again", "refresh");
}

function setOnboarding(action, label, iconName) {
  onboardingAction = action;
  setIconButton(elements.onboardingActionBtn, iconName, label);
}

function statusMark(status) {
  const icon = status === "ready" ? ' data-status-icon="ok"' : "";
  return `<span class="check-dot ${status}"${icon}></span>`;
}

function decorateStatusIcons(root) {
  root?.querySelectorAll("[data-status-icon='ok']").forEach((mark) => {
    if (mark.firstElementChild) return;
    const icon = createFilledIcon("ok");
    if (!icon) return;
    icon.classList.add("check-icon");
    mark.append(icon);
  });
}

function checklistItem(label, status, detail = "") {
  const dot =
    status === "ready" ? "ready" : status === "pending" ? "pending" : "blocked";
  const suffix = detail ? `<span>${detail}</span>` : "";
  return `<div class="check-row">${statusMark(dot)}<strong>${label}</strong>${suffix}</div>`;
}

function renderChecklist(rows) {
  const exposed = rows.filter((row) => row.rawStatus !== "not exposed");
  const core = rows.find((row) => row.name === "LanguageModel");
  const summary = rows.find((row) => row.name === "Summarizer");
  const anyDownload = rows.some(
    (row) =>
      row.status === "downloadable" ||
      row.status === "downloading" ||
      row.status === "ready",
  );

  const inferredRows = [
    checklistItem(
      "Chrome flags",
      exposed.length ? "ready" : "blocked",
      exposed.length ? "Detected" : "Enable and relaunch",
    ),
    checklistItem(
      "Assistant model",
      core?.status === "ready"
        ? "ready"
        : core?.status === "downloadable" || core?.status === "downloading"
          ? "pending"
          : "blocked",
      statusText(core),
    ),
    checklistItem(
      "Summaries",
      summary?.status === "ready"
        ? "ready"
        : summary?.status === "downloadable" ||
            summary?.status === "downloading"
          ? "pending"
          : "blocked",
      statusText(summary),
    ),
    checklistItem(
      "Local model",
      anyDownload ? "ready" : "blocked",
      anyDownload ? "Detected by Chrome" : "Not detected",
    ),
  ];
  const flagRows = FLAG_LINKS.map(([label, url]) =>
    flagItem(label, url, exposed.length ? "ready" : "blocked"),
  );
  elements.checklist.innerHTML = [...inferredRows, ...flagRows].join("");
  decorateStatusIcons(elements.checklist);
  elements.checklist.querySelectorAll("[data-open-flag]").forEach((button) => {
    setIconButton(button, "open", "Open");
    button.addEventListener("click", () =>
      openChromePage(button.dataset.openFlag),
    );
  });
}

function flagItem(label, url, status) {
  const dot = status === "ready" ? "ready" : "blocked";
  return `
    <div class="check-row flag-row">
      ${statusMark(dot)}
      <strong>${label}</strong>
      <span>${url.replace("chrome://flags/#", "")}</span>
      <div class="row-actions">
        <button class="quiet-button" data-open-flag="${url}" type="button">Open</button>
      </div>
    </div>
  `;
}

function renderModels(rows) {
  elements.modelList.innerHTML = rows
    .map((row) => {
      return `
        <div class="model-row">
          <div>
            <strong>${row.label}</strong>
            <span>${statusText(row)}</span>
          </div>
        </div>
      `;
    })
    .join("");
}

function summarizeRows(rows) {
  if (rows.some((row) => row.status === "ready")) return "Available";
  if (rows.some((row) => row.status === "downloading")) return "Downloading";
  if (rows.some((row) => row.status === "downloadable")) return "Start needed";
  return "Not enabled";
}

function statusText(row) {
  if (!row) return "Not enabled";
  const suffix = row.fallbackLabel ? ` (${row.fallbackLabel})` : "";
  if (row.status === "ready") return `Available${suffix}`;
  if (row.status === "downloadable") return `Start needed${suffix}`;
  if (row.status === "downloading") return `Downloading${suffix}`;
  if (row.status === "blocked") return "Not enabled";
  return "Unknown";
}

async function startCoreModel() {
  const target =
    currentRows.find(
      (row) => row.status === "downloadable" || row.status === "downloading",
    ) || currentRows.find((row) => row.name === "LanguageModel");
  await startModel(target?.name || "LanguageModel");
}

async function startModel(name) {
  const definition = API_DEFINITIONS.find((item) => item.name === name);
  if (!definition || !(definition.name in self)) {
    setOverall(
      "API is not enabled",
      "Needs setup",
      "blocked",
      "Open flags, enable Chrome AI, then relaunch Chrome.",
    );
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
      throw new Error(
        `${definition.label} is unavailable with ${check.label}.`,
      );
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
    showProgress(`${definition.label} available`, 100);
    setTimeout(hideProgress, 1200);
    await refreshApis();
  } catch (error) {
    hideProgress();
    setOverall(
      "Model did not start",
      "Check setup",
      "blocked",
      error instanceof Error
        ? error.message
        : "Chrome could not start the model.",
    );
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
  chrome.tabs.create({ url }, () => {
    void chrome.runtime.lastError;
  });
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
  setIconButton(elements.saveSettingsBtn, "ok", "Saved");
  clearTimeout(saveFeedbackTimer);
  saveFeedbackTimer = setTimeout(() => {
    setIconButton(elements.saveSettingsBtn, "save", "Save");
  }, 1200);
}

function runOnboardingAction() {
  if (onboardingAction === "flags") {
    openChromePage(FLAG_LINKS[0][1]);
    return;
  }
  if (onboardingAction === "start") {
    runHandled(startCoreModel);
    return;
  }
  if (onboardingAction === "models") {
    openChromePage("chrome://on-device-internals");
    return;
  }
  runHandled(refreshApis);
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
  decorateStaticButtons();
  elements.onboardingActionBtn?.addEventListener("click", runOnboardingAction);
  elements.saveSettingsBtn?.addEventListener("click", () =>
    runHandled(saveSettings),
  );
  bindSettingsInputs();

  runHandled(loadSettings);
  runHandled(refreshApis);
}

document.addEventListener("DOMContentLoaded", init);
