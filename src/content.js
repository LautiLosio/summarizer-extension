import { Readability } from "@mozilla/readability";
import contentStyles from "./content.css";
import { createFilledIcon } from "./lib/filled-icons.js";

(() => {
  const CONFIG_KEY = "sts_config";
  const PERFORMANCE_KEY = "sts_performance";
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
  const ICONS = {
    back: "back",
    copy: "copy",
    close: "x",
    stop: "stop",
  };
  const MAX_CONTEXT_CHARS = 18000;
  const MAX_SELECTION_CHARS = 12000;
  const MAX_CHAT_HISTORY_CHARS = 8000;
  const API_NAMES = ["LanguageModel", "Summarizer"];
  const TEXT_ENTRY_EVENT_TYPES = [
    "beforeinput",
    "compositionend",
    "compositionstart",
    "compositionupdate",
    "cut",
    "input",
    "keydown",
    "keypress",
    "keyup",
    "paste",
  ];
  const API_AVAILABILITY_OPTIONS = {
    LanguageModel: {
      expectedInputs: [{ type: "text", languages: ["en", "es", "ja"] }],
      expectedOutputs: [{ type: "text", languages: ["en", "es", "ja"] }],
    },
  };
  const LANGUAGE_MODEL_OPTION_FALLBACKS = [
    API_AVAILABILITY_OPTIONS.LanguageModel,
    {
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    },
    {},
  ];

  const state = {
    tooltipEl: null,
    panelEl: null,
    currentMode: "home",
    selectionText: "",
    pageContext: null,
    minWords: DEFAULT_MIN_WORDS,
    config: DEFAULT_CONFIG,
    activeController: null,
    languageSession: null,
    outputEl: null,
    lastAnswer: "",
    chatMessages: [],
    chatContext: null,
    isRunning: false,
    focusedTextEntryEl: null,
    performanceMetrics: {
      avgCharsPerSecond: 18,
      runCount: 0,
    },
    lastMouseX: 0,
    lastMouseY: 0,
  };

  let configReady = null;

  function loadConfig() {
    if (!chrome.storage?.sync) {
      state.config = normalizeConfig();
      state.minWords = state.config.minWords;
      configReady = Promise.resolve(state.config);
      return configReady;
    }

    configReady = new Promise((resolve) => {
      chrome.storage.sync.get([CONFIG_KEY, PERFORMANCE_KEY], (res) => {
        state.config = normalizeConfig(res?.[CONFIG_KEY]);
        state.minWords = state.config.minWords;

        const perf = res?.[PERFORMANCE_KEY];
        if (
          perf &&
          typeof perf.avgCharsPerSecond === "number" &&
          typeof perf.runCount === "number"
        ) {
          state.performanceMetrics = {
            avgCharsPerSecond: Math.max(1, perf.avgCharsPerSecond),
            runCount: Math.max(0, perf.runCount),
          };
        }
        resolve(state.config);
      });
    });
    return configReady;
  }

  async function ensureConfig() {
    if (!configReady) loadConfig();
    await configReady;
    return state.config;
  }

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes[CONFIG_KEY]) return;
    state.config = normalizeConfig(changes[CONFIG_KEY].newValue);
    state.minWords = state.config.minWords;
  });

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

  function normalizeMinWords(value) {
    const num = Number(value);
    return Math.max(1, Number.isFinite(num) ? num : DEFAULT_MIN_WORDS);
  }

  function normalizeSummaryConfig(config = {}, defaults) {
    return {
      type: pickAllowed(config.type, ALLOWED.summaryType, defaults.type),
      format: pickAllowed(config.format, ALLOWED.format, defaults.format),
      length: pickAllowed(
        config.length,
        ALLOWED.summaryLength,
        defaults.length,
      ),
      instructions: normalizeText(config.instructions, defaults.instructions),
    };
  }

  function savePerformanceMetrics(cps) {
    const { avgCharsPerSecond: avg, runCount } = state.performanceMetrics;
    const newRunCount = runCount + 1;
    const newAvg = avg + (cps - avg) / newRunCount;
    state.performanceMetrics = {
      avgCharsPerSecond: newAvg,
      runCount: newRunCount,
    };
    chrome.storage?.sync?.set({ [PERFORMANCE_KEY]: state.performanceMetrics });
  }

  const countWords = (text) =>
    (
      String(text)
        .trim()
        .match(/\b[\p{L}\p{N}'-]+\b/gu) || []
    ).length;
  const cleanText = (text) =>
    String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  function getSelectionText() {
    const sel = window.getSelection();
    return !sel || sel.rangeCount === 0 ? "" : cleanText(sel.toString());
  }

  function truncateText(text, maxChars) {
    const value = cleanText(text);
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars).trim()}\n\n[Context truncated at ${maxChars} characters.]`;
  }

  function ensureTooltip() {
    if (state.tooltipEl) return state.tooltipEl;

    const el = document.createElement("div");
    el.className = "sts-tooltip";
    el.innerHTML = `
      <div class="sts-tooltip-stack">
        <button class="sts-tooltip-btn sts-tooltip-summary" type="button">Summarize</button>
      </div>
    `;

    el.addEventListener("transitionend", (e) => {
      if (e.target === el && !el.classList.contains("sts-visible")) {
        el.style.display = "none";
      }
    });
    el.querySelector(".sts-tooltip-summary")?.addEventListener(
      "mousedown",
      consumeMouse,
    );
    el.querySelector(".sts-tooltip-summary")?.addEventListener("click", () => {
      window.getSelection()?.removeAllRanges();
      runQuickAction("summarize-selection");
    });
    createShadowUiRoot("tooltip").appendChild(el);
    return (state.tooltipEl = el);
  }

  function createShadowUiRoot(name) {
    const host = document.createElement("div");
    host.dataset.localAiRoot = name;
    setIsolatedHostStyle(host);
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = contentStyles;
    root.appendChild(style);
    (document.body || document.documentElement).appendChild(host);
    return root;
  }

  function setIsolatedHostStyle(host) {
    const importantStyles = {
      all: "initial",
      contain: "style",
      display: "block",
      height: "0",
      overflow: "visible",
      position: "static",
      width: "0",
    };
    Object.entries(importantStyles).forEach(([property, value]) => {
      host.style.setProperty(property, value, "important");
    });
  }

  function consumeMouse(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function isLocalAiEvent(event) {
    return event
      .composedPath?.()
      .some((node) => node?.dataset?.localAiRoot);
  }

  function stopLocalAiEvent(event) {
    if (!isLocalAiEvent(event)) return;
    handleContainedTextEntryShortcut(event);
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  function handleContainedTextEntryShortcut(event) {
    if (
      event.type !== "keydown" ||
      event.key !== "Enter" ||
      event.shiftKey ||
      state.focusedTextEntryEl?.id !== "sts-question"
    ) {
      return;
    }
    event.preventDefault();
    state.focusedTextEntryEl.form?.requestSubmit();
  }

  function installTextEntryFirewall() {
    TEXT_ENTRY_EVENT_TYPES.forEach((eventType) => {
      window.addEventListener(eventType, stopLocalAiEvent, true);
    });
  }

  function trackTextEntryElement(input) {
    input?.addEventListener("focus", () => {
      state.focusedTextEntryEl = input;
    });
    input?.addEventListener("blur", () => {
      if (state.focusedTextEntryEl === input) state.focusedTextEntryEl = null;
    });
  }

  function showTooltipAt(rect) {
    const el = ensureTooltip();
    const stack = el.querySelector(".sts-tooltip-stack");
    if (!stack) return;
    el.style.display = "block";

    const tooltipRect = stack.getBoundingClientRect();
    const margin = 12;
    const width = tooltipRect.width || 156;
    const height = tooltipRect.height || 36;
    let top = state.lastMouseY + margin;
    let left = state.lastMouseX + margin;

    if (left + width > window.innerWidth - margin) {
      left = state.lastMouseX - width - margin;
    }
    if (top + height > window.innerHeight - margin) {
      top = state.lastMouseY - height - margin;
    }

    stack.style.top = `${Math.max(margin, top)}px`;
    stack.style.left = `${Math.max(margin, left)}px`;
    setTimeout(() => el.classList.add("sts-visible"), 10);
  }

  const hideTooltip = () => state.tooltipEl?.classList.remove("sts-visible");

  function ensurePanel() {
    if (state.panelEl) return state.panelEl;

    const el = document.createElement("section");
    el.className = "sts-popup sts-assistant";
    el.setAttribute("aria-label", "Local AI");
    el.innerHTML = `
      <div class="sts-popup-inner">
        <div class="sts-popup-header">
          <div class="title"><button class="sts-back" type="button" title="Modes">Local AI</button></div>
          <div class="actions">
            <button class="sts-btn sts-btn--ghost sts-copy" type="button">Copy</button>
            <button class="sts-btn sts-btn--ghost sts-stop" type="button">Stop</button>
            <button class="sts-btn sts-btn--ghost sts-btn--icon sts-close" type="button" aria-label="Close assistant" title="Close assistant"></button>
          </div>
        </div>
        <div class="sts-content" id="sts-content">
          <div class="sts-empty"></div>
        </div>
        <div class="sts-compose" id="sts-compose"></div>
      </div>
    `;

    el.addEventListener("transitionend", (e) => {
      if (e.target === el && !el.classList.contains("sts-visible")) {
        el.style.display = "none";
      }
    });
    el.querySelector(".sts-close")?.addEventListener("click", hidePanel);
    el.querySelector(".sts-back")?.addEventListener("click", () =>
      renderMode("home"),
    );
    el.querySelector(".sts-copy")?.addEventListener("click", copyAnswer);
    el.querySelector(".sts-stop")?.addEventListener("click", stopCurrentRun);
    createShadowUiRoot("panel").appendChild(el);
    state.panelEl = el;
    decoratePanelIcons();
    renderMode("home");
    return state.panelEl;
  }

  function decoratePanelIcons() {
    setIconButton(state.panelEl?.querySelector(".sts-copy"), "copy", "Copy");
    setIconButton(state.panelEl?.querySelector(".sts-stop"), "stop", "Stop");
    setIconButton(state.panelEl?.querySelector(".sts-close"), "close", "");
  }

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
    icon.classList.add("sts-icon");
    button.textContent = "";
    button.append(icon);
    if (label) button.append(document.createTextNode(label));
    button.dataset.iconReady = iconName;
    button.dataset.iconLabel = label;
  }

  function showPanel() {
    const el = ensurePanel();
    el.style.display = "block";
    setTimeout(() => el.classList.add("sts-visible"), 10);
  }

  function hidePanel() {
    state.panelEl?.classList.remove("sts-visible");
  }

  function setDownloadStatus(message) {
    const status = ensurePanel().querySelector("#sts-stream-status");
    if (status) status.textContent = message || "";
  }

  function clearDownloadStatus() {
    setDownloadStatus("");
  }

  function setRunning(isRunning) {
    state.isRunning = isRunning;
    state.panelEl?.classList.toggle("is-loading", isRunning);
    state.panelEl?.querySelectorAll("[data-run]").forEach((button) => {
      button.toggleAttribute("disabled", isRunning);
    });
    state.panelEl
      ?.querySelector(".sts-stop")
      ?.toggleAttribute("disabled", !isRunning);
    if (isRunning)
      state.panelEl
        ?.querySelector(".sts-copy")
        ?.setAttribute("disabled", "true");
  }

  function renderMode(mode = "home") {
    const panel = ensurePanel();
    const content = panel.querySelector("#sts-content");
    const compose = panel.querySelector("#sts-compose");
    if (!content || !compose) return;

    state.currentMode = mode;
    state.outputEl = null;
    state.lastAnswer = "";
    panel.classList.toggle("sts-is-home", mode === "home");
    const title = panel.querySelector(".sts-back");
    if (title) {
      if (mode === "home") {
        title.textContent = "Local AI";
        delete title.dataset.iconReady;
        delete title.dataset.iconLabel;
      } else {
        setIconButton(title, "back", getModeTitle(mode));
      }
    }
    panel.querySelector(".sts-copy")?.setAttribute("disabled", "true");
    panel.querySelector(".sts-stop")?.setAttribute("disabled", "true");

    if (mode === "home") {
      content.innerHTML = `
        <div class="sts-mode-grid">
          <button class="sts-mode" type="button" data-mode="ask">Ask</button>
          <button class="sts-mode" type="button" data-mode="summarize">Summarize</button>
        </div>
      `;
      compose.innerHTML = "";
      content.querySelectorAll("[data-mode]").forEach((button) => {
        button.addEventListener("click", () => renderMode(button.dataset.mode));
      });
      return;
    }

    if (mode === "summarize") {
      compose.innerHTML = "";
      runQuickAction("summarize-page");
      return;
    }

    if (mode === "ask") {
      renderChatTranscript();
    } else {
      content.innerHTML = "";
    }
    compose.innerHTML = getModeForm(mode);
    trackTextEntryElement(compose.querySelector("textarea"));
    compose.querySelector("form")?.addEventListener("submit", onModeSubmit);
    compose
      .querySelector("textarea")
      ?.addEventListener("keydown", onTextareaKeydown);
    compose
      .querySelector("[data-run='summary-page']")
      ?.addEventListener("click", () => runQuickAction("summarize-page"));
    compose
      .querySelector("[data-run='summary-selection']")
      ?.addEventListener("click", () => runQuickAction("summarize-selection"));
    compose.querySelector("textarea")?.focus();
  }

  function getModeTitle(mode) {
    return (
      {
        ask: "Ask",
        summarize: "Summarize",
      }[mode] || "Assistant"
    );
  }

  function getModeForm(mode) {
    if (mode === "ask") {
      return `
        <form class="sts-mode-form">
          <div class="sts-ask-grid">
            <textarea id="sts-question" rows="1" placeholder="Ask..."></textarea>
          </div>
          <button class="sts-btn sts-btn--tinted" data-run="ask" type="submit">Ask</button>
        </form>
      `;
    }
    if (mode === "summarize") {
      return "";
    }
    return "";
  }

  function setOutputShell(label = "Thinking") {
    const content = ensurePanel().querySelector("#sts-content");
    if (!content) return null;
    content.innerHTML = `
      <div class="sts-turn-label">${label}</div>
      <div class="sts-stream-shell">
        <div class="sts-stream-status" id="sts-stream-status" aria-live="polite"></div>
        <div class="sts-content-md sts-stream-text" id="sts-stream-text" aria-live="polite"></div>
      </div>
    `;
    state.outputEl = content.querySelector("#sts-stream-text");
    return state.outputEl;
  }

  function setOutputText(text, label = "Result") {
    const content = ensurePanel().querySelector("#sts-content");
    if (!content) return;
    content.innerHTML = `
      <div class="sts-turn-label">${escapeHtml(label)}</div>
      <div class="sts-content-md">${escapeHtml(text).replace(/\n/g, "<br>")}</div>
    `;
  }

  function appendOutputChunk(chunk) {
    if (!state.outputEl || !chunk) return;
    clearDownloadStatus();
    state.outputEl.textContent += chunk;
    const content = ensurePanel().querySelector("#sts-content");
    if (content) content.scrollTop = content.scrollHeight;
  }

  function setError(message) {
    const help = [
      "Chrome setup checklist:",
      "1. Use Chrome/Chrome Canary on desktop.",
      "2. Enable chrome://flags/#optimization-guide-on-device-model.",
      "3. Enable chrome://flags/#prompt-api-for-gemini-nano or chrome://flags/#prompt-api-for-gemini-nano-multimodal-input when present.",
      "4. Relaunch Chrome and check chrome://on-device-internals for model status.",
      "5. Some APIs require an origin-trial token for chrome-extension://YOUR_EXTENSION_ID.",
    ].join("\n");
    const content = ensurePanel().querySelector("#sts-content");
    if (!content) return;
    content.innerHTML = `
      <div class="sts-error">${escapeHtml(message)}</div>
      <pre class="sts-help">${escapeHtml(help)}</pre>
    `;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function copyAnswer() {
    const copyBtn = state.panelEl?.querySelector(".sts-copy");
    const text =
      state.lastAnswer ||
      state.panelEl?.querySelector("#sts-content")?.innerText ||
      "";
    if (!copyBtn || !text) return;
    try {
      await navigator.clipboard.writeText(text);
      setIconButton(copyBtn, "copy", "Copied");
    } catch (_) {
      setIconButton(copyBtn, "copy", "Retry");
    } finally {
      setTimeout(() => {
        setIconButton(copyBtn, "copy", "Copy");
      }, 1300);
    }
  }

  function stopCurrentRun() {
    state.activeController?.abort();
    state.activeController = null;
    state.outputEl = null;
    setRunning(false);
    setDownloadStatus("");
  }

  function onModeSubmit(event) {
    event.preventDefault();
    const input = state.panelEl?.querySelector("#sts-question");
    const question = cleanText(input?.value || "");
    const mode = state.currentMode;
    if (mode === "ask") {
      if (!question) return;
      input.value = "";
      runAssistantQuestion(question);
      return;
    }
  }

  function onTextareaKeydown(event) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    event.currentTarget?.form?.requestSubmit();
  }

  function openAssistant({ mode = "auto", prompt = "" } = {}) {
    state.selectionText = getSelectionText() || state.selectionText;
    showPanel();
    renderMode(
      mode === "selection" || mode === "page"
        ? "ask"
        : mode === "auto"
          ? "home"
          : mode,
    );
    const input = state.panelEl?.querySelector("#sts-question");
    if (input && prompt) {
      input.value = prompt;
      input.focus();
    } else {
      input?.focus();
    }
    hideTooltip();
  }

  async function runQuickAction(action) {
    state.selectionText = getSelectionText() || state.selectionText;
    showPanel();
    prepareQuickActionMode("summarize");

    if (action === "summarize-page") {
      await runTask("Page summary", (emit) =>
        summarizeText(getPageContext().text, "page", emit),
      );
      return;
    }
    if (action === "summarize-selection") {
      const text = state.selectionText;
      if (!text)
        return setError("Select text first, then use Selection summary.");
      await runTask("Selection summary", (emit) =>
        summarizeText(
          truncateText(text, MAX_SELECTION_CHARS),
          "selection",
          emit,
        ),
      );
      return;
    }
  }

  function prepareQuickActionMode(mode) {
    const panel = ensurePanel();
    const compose = panel.querySelector("#sts-compose");
    state.currentMode = mode;
    state.outputEl = null;
    state.lastAnswer = "";
    panel.classList.toggle("sts-is-home", false);
    const title = panel.querySelector(".sts-back");
    if (title) setIconButton(title, "back", getModeTitle(mode));
    panel.querySelector(".sts-copy")?.setAttribute("disabled", "true");
    panel.querySelector(".sts-stop")?.setAttribute("disabled", "true");
    if (compose) compose.innerHTML = "";
  }

  async function runAssistantQuestion(question) {
    await ensureConfig();
    if (state.isRunning) stopCurrentRun();
    const context = getChatPageContext();
    const askConfig = state.config.ask;
    const userMessage = { role: "user", content: question };
    state.chatMessages.push(userMessage);
    const assistantMessage = { role: "assistant", content: "" };
    state.chatMessages.push(assistantMessage);
    renderChatTranscript();

    const prompt = [
      "Answer the user's latest question using the provided page context and conversation history when relevant.",
      "Be direct, note uncertainty, and do not invent facts not present in the context.",
      "Answer in the same language as the user's question.",
      "Treat conversation history as context for follow-up questions, but treat the page context as the source of truth for page facts.",
      `Answer style: ${askConfig.style}.`,
      `Output format: ${askConfig.format === "markdown" ? "Markdown" : "plain text"}.`,
      "",
      `Context source: ${context.label}`,
      context.text ? `Context:\n${context.text}` : "Context: none",
      "",
      "Conversation history:",
      buildConversationHistoryPrompt(state.chatMessages.slice(0, -2)),
      "",
      `Latest question:\n${question}`,
    ].join("\n");

    await runChatTask(assistantMessage, (emit) =>
      promptLanguageModel(prompt, emit),
    );
  }

  function renderChatTranscript() {
    const content = ensurePanel().querySelector("#sts-content");
    if (!content) return;
    if (!state.chatMessages.length) {
      content.innerHTML = `<div class="sts-empty"></div>`;
      return;
    }
    content.innerHTML = `
      <div class="sts-chat" aria-live="polite">
        ${state.chatMessages.map(renderChatMessage).join("")}
      </div>
    `;
    state.outputEl = content.querySelector(
      "[data-streaming='true'] .sts-message-text",
    );
    content.scrollTop = content.scrollHeight;
  }

  function renderChatMessage(message) {
    const isUser = message.role === "user";
    const label = isUser ? "You" : "Local AI";
    const content = message.content || "";
    const streamingAttr =
      !isUser && !message.content ? ' data-streaming="true"' : "";
    return `
      <div class="sts-message sts-message--${isUser ? "user" : "assistant"}"${streamingAttr}>
        <div class="sts-message-role">${label}</div>
        <div class="sts-content-md sts-message-text">${escapeHtml(content).replace(/\n/g, "<br>")}</div>
      </div>
    `;
  }

  async function runChatTask(assistantMessage, producer) {
    state.activeController = new AbortController();
    state.lastAnswer = "";
    setRunning(true);
    const startedAt = performance.now();
    let out = "";

    try {
      out = await producer((chunk) => {
        const text = String(chunk || "");
        out += text;
        assistantMessage.content = out;
        appendChatChunk(text);
      });
      assistantMessage.content = normalizeGeneratedOutput(out);
      state.lastAnswer = assistantMessage.content;
      renderChatTranscript();
      if (state.lastAnswer) {
        state.panelEl?.querySelector(".sts-copy")?.removeAttribute("disabled");
      }

      const seconds = Math.max(0.05, (performance.now() - startedAt) / 1000);
      const cps = state.lastAnswer.length / seconds;
      if (Number.isFinite(cps) && cps > 0) savePerformanceMetrics(cps);
    } catch (error) {
      if (error?.name === "AbortError") {
        assistantMessage.content = normalizeGeneratedOutput(out) || "Stopped.";
        state.lastAnswer = assistantMessage.content;
        renderChatTranscript();
      } else {
        state.chatMessages.pop();
        setError(
          error instanceof Error
            ? error.message
            : "The assistant could not complete that request.",
        );
      }
    } finally {
      setRunning(false);
      clearDownloadStatus();
      state.activeController = null;
    }
  }

  function appendChatChunk(chunk) {
    if (!state.outputEl || !chunk) return;
    clearDownloadStatus();
    state.outputEl.textContent += chunk;
    const content = ensurePanel().querySelector("#sts-content");
    if (content) content.scrollTop = content.scrollHeight;
  }

  function buildConversationHistoryPrompt(messages) {
    const lines = messages.map((message) => {
      const role = message.role === "user" ? "User" : "Assistant";
      return `${role}: ${message.content}`;
    });
    const history = cleanText(lines.join("\n\n"));
    return history
      ? truncateText(history, MAX_CHAT_HISTORY_CHARS)
      : "No previous messages.";
  }

  async function runTask(label, producer) {
    if (state.isRunning) stopCurrentRun();
    state.activeController = new AbortController();
    state.lastAnswer = "";
    setRunning(true);
    const surfaceEl = setOutputShell(label);
    const startedAt = performance.now();
    let out = "";

    try {
      if (surfaceEl instanceof HTMLElement) surfaceEl.textContent = "";

      out = await producer((chunk) => {
        const text = String(chunk || "");
        out += text;
        appendOutputChunk(text);
      });
      state.lastAnswer = normalizeGeneratedOutput(out);
      if (!state.outputEl || state.outputEl.textContent !== state.lastAnswer) {
        setOutputText(state.lastAnswer, label);
      }
      if (state.lastAnswer) {
        state.panelEl?.querySelector(".sts-copy")?.removeAttribute("disabled");
      }

      const seconds = Math.max(0.05, (performance.now() - startedAt) / 1000);
      const cps = state.lastAnswer.length / seconds;
      if (Number.isFinite(cps) && cps > 0) savePerformanceMetrics(cps);
    } catch (error) {
      if (error?.name === "AbortError") {
        setOutputText(normalizeGeneratedOutput(out) || "Stopped.", label);
      } else {
        setError(
          error instanceof Error
            ? error.message
            : "The assistant could not complete that request.",
        );
      }
    } finally {
      setRunning(false);
      clearDownloadStatus();
      state.activeController = null;
    }
  }

  function normalizeGeneratedOutput(text) {
    return String(text || "").trim();
  }

  function getPageContext() {
    const title = cleanText(document.title);
    const url = location.href;
    const text = extractReadablePageText();
    state.pageContext = {
      label: "page",
      text: truncateText(
        [title && `Title: ${title}`, `URL: ${url}`, text]
          .filter(Boolean)
          .join("\n\n"),
        MAX_CONTEXT_CHARS,
      ),
    };
    return state.pageContext;
  }

  function getChatPageContext() {
    if (!state.chatContext) state.chatContext = getPageContext();
    return state.chatContext;
  }

  function extractReadablePageText() {
    try {
      const article = new Readability(document.cloneNode(true), {
        keepClasses: false,
      }).parse();
      const readabilityText = cleanText(article?.textContent || "");
      if (readabilityText.length > 400) return readabilityText;
    } catch (_) {}

    const selectors = [
      "article",
      "main",
      "[role='main']",
      ".article",
      ".post",
      ".entry-content",
      ".content",
      "#content",
    ];
    const candidates = Array.from(
      document.querySelectorAll(selectors.join(",")),
    );
    candidates.push(document.body);

    let best = document.body;
    let bestScore = -Infinity;
    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLElement)) continue;
      const text = cleanText(candidate.innerText || "");
      if (text.length < 200) continue;
      const linksText = Array.from(candidate.querySelectorAll("a"))
        .map((link) => link.innerText || "")
        .join(" ");
      const linkDensity = linksText.length / Math.max(text.length, 1);
      const paragraphCount = candidate.querySelectorAll("p, li").length;
      const semanticBonus =
        /^(ARTICLE|MAIN)$/i.test(candidate.tagName) ||
        candidate.getAttribute("role") === "main"
          ? 800
          : 0;
      const score =
        text.length + paragraphCount * 80 + semanticBonus - linkDensity * 2200;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    const clone = best.cloneNode(true);
    if (!(clone instanceof HTMLElement))
      return cleanText(document.body.innerText || "");
    clone
      .querySelectorAll(
        [
          "script",
          "style",
          "noscript",
          "template",
          "svg",
          "canvas",
          "iframe",
          "nav",
          "footer",
          "header",
          "aside",
          "form",
          "button",
          "input",
          "select",
          "textarea",
          "[hidden]",
          "[aria-hidden='true']",
          "[role='navigation']",
          "[role='banner']",
          "[role='contentinfo']",
          "[class*='nav' i]",
          "[id*='nav' i]",
          "[class*='menu' i]",
          "[id*='menu' i]",
          "[class*='footer' i]",
          "[id*='footer' i]",
          "[class*='sidebar' i]",
          "[id*='sidebar' i]",
          "[class*='advert' i]",
          "[id*='advert' i]",
          "[class*='cookie' i]",
          "[id*='cookie' i]",
          "[class*='related' i]",
          "[id*='related' i]",
        ].join(","),
      )
      .forEach((node) => node.remove());

    const blocks = Array.from(
      clone.querySelectorAll("h1,h2,h3,p,li,blockquote,pre"),
    )
      .map((node) => cleanText(node.innerText || node.textContent || ""))
      .filter((text) => text.length > 24);
    const text = blocks.length
      ? blocks.join("\n\n")
      : cleanText(clone.innerText || clone.textContent || "");
    return text || cleanText(document.body.innerText || "");
  }

  async function summarizeText(text, source, emit) {
    await ensureConfig();
    const input = truncateText(
      text,
      source === "page" ? MAX_CONTEXT_CHARS : MAX_SELECTION_CHARS,
    );
    if (!input) throw new Error("There is no readable text to summarize.");
    const summaryConfig = getSummaryConfig(source);
    const summaryContext = [
      summaryConfig.instructions,
      getFormatInstruction(summaryConfig.format),
    ]
      .filter(Boolean)
      .join("\n");
    if (summaryConfig.format === "plain-text") {
      return promptLanguageModel(
        buildSummaryFallbackPrompt(input, source, summaryConfig),
        emit,
      );
    }
    if ("Summarizer" in self) {
      try {
        const summarizer = await createBuiltInApi("Summarizer", {
          type: summaryConfig.type,
          format: summaryConfig.format,
          length: summaryConfig.length,
          sharedContext:
            "Summarize web reading material for a user who wants the useful ideas, not site chrome.",
        });
        return await collectStreamOrValue(
          summarizer.summarizeStreaming?.(input, {
            context: summaryContext,
            signal: state.activeController?.signal,
          }),
          () =>
            summarizer.summarize(input, {
              context: summaryContext,
              signal: state.activeController?.signal,
            }),
          emit,
        );
      } catch (error) {
        setDownloadStatus("Using the assistant model instead.");
      }
    }

    return promptLanguageModel(
      buildSummaryFallbackPrompt(input, source, summaryConfig),
      emit,
    );
  }

  function getFormatInstruction(format) {
    if (format === "plain-text") {
      return "Use plain text only. Do not use Markdown syntax, headings, bullets, numbered lists, bold, links, tables, or code fences.";
    }
    return "Use Markdown only where it improves readability.";
  }

  function getSummaryConfig(source) {
    return source === "selection"
      ? state.config.summarize.selection
      : state.config.summarize.page;
  }

  function buildSummaryFallbackPrompt(input, source, config) {
    const typeInstruction = getTypeInstruction(config);
    const lengthInstruction = getLengthInstruction(config.length, config.type);
    return [
      `Summarize this ${source} using only the requested output.`,
      typeInstruction,
      lengthInstruction,
      `Output format: ${config.format === "markdown" ? "Markdown" : "plain text"}.`,
      getFormatInstruction(config.format),
      config.instructions,
      "Return only the final summary. Do not include analysis, drafts, alternatives, preambles, or a second summary.",
      "",
      "Source text:",
      input,
    ].join("\n");
  }

  function getTypeInstruction(config) {
    if (config.format === "plain-text" && config.type === "key-points") {
      return "Cover the key points in compact prose. Do not format the response as a list.";
    }
    return (
      {
        "key-points": "Write the key points only.",
        tldr:
          "Write one TL;DR only. It must be a compact final answer, not a longer summary followed by a TL;DR.",
        teaser: "Write one short teaser only.",
        headline: "Write one headline only.",
      }[config.type] || `Use summary type: ${config.type}.`
    );
  }

  function getLengthInstruction(length, type) {
    if (type === "headline") return "Length: one line, no more than 18 words.";
    if (type === "teaser") return "Length: one sentence, no more than 30 words.";
    if (type === "tldr") {
      return length === "long"
        ? "Length: one paragraph, no more than 90 words."
        : length === "medium"
          ? "Length: one paragraph, no more than 60 words."
          : "Length: one or two sentences, no more than 40 words.";
    }
    return (
      {
        short: "Length: no more than 60 words.",
        medium: "Length: no more than 120 words.",
        long: "Length: no more than 220 words.",
      }[length] || `Length: ${length}.`
    );
  }

  async function promptLanguageModel(prompt, emit) {
    const session = await ensureLanguageSession();
    let out = "";
    if (session.promptStreaming) {
      const stream = session.promptStreaming(prompt, {
        signal: state.activeController?.signal,
      });
      for await (const chunk of stream) {
        const text = String(chunk || "");
        out += text;
        emit?.(text);
      }
      if (out) return out;
    }
    return String(
      await session.prompt(prompt, { signal: state.activeController?.signal }),
    );
  }

  async function ensureLanguageSession() {
    if (state.languageSession) return state.languageSession;
    if (!("LanguageModel" in self)) {
      throw new Error(
        "Prompt API is not exposed as LanguageModel in this Chrome profile.",
      );
    }
    const availabilityOptions = await getFirstAvailableOptions(
      "LanguageModel",
      LANGUAGE_MODEL_OPTION_FALLBACKS,
    );
    const options = {
      ...availabilityOptions,
      initialPrompts: [
        {
          role: "system",
          content:
            "You are a compact AI assistant for web consumption. Answer questions from page context, summarize carefully, and say when the context is insufficient.",
        },
      ],
      monitor: createMonitor("Prompt"),
      signal: state.activeController?.signal,
    };
    state.languageSession = await LanguageModel.create(options);
    state.languageSession.addEventListener?.("contextoverflow", () => {
      setDownloadStatus("Context trimmed");
    });
    return state.languageSession;
  }

  async function collectStreamOrValue(stream, fallback, emit) {
    let out = "";
    if (stream) {
      for await (const chunk of stream) {
        const text = String(chunk || "");
        out += text;
        emit?.(text);
      }
    }
    if (out) return out;
    return String(await fallback());
  }

  async function createBuiltInApi(name, options = {}) {
    if (!(name in self))
      throw new Error(`${name} API is not supported in this Chrome profile.`);
    const mergedOptions = {
      ...options,
      monitor: createMonitor(name, { showInitialComplete: false }),
      signal: state.activeController?.signal,
    };
    await assertAvailable(name, options);
    return await self[name].create(mergedOptions);
  }

  function createMonitor(label, { showInitialComplete = false } = {}) {
    let hasShownProgress = false;
    return (monitor) => {
      monitor.addEventListener("downloadprogress", (event) => {
        const progress = Math.round((event.loaded || 0) * 100);
        if (progress >= 100 && !hasShownProgress && !showInitialComplete) {
          return;
        }
        hasShownProgress = true;
        setDownloadStatus(getModelLoadingMessage(label, progress));
      });
    };
  }

  function getModelLoadingMessage(label, progress) {
    const safeProgress = Math.max(0, Math.min(100, progress));
    const modelName = label === "Summarizer" ? "summarizer model" : "assistant model";
    if (safeProgress >= 100) return `Starting the local ${modelName}...`;
    return `Loading the local ${modelName} into memory... ${safeProgress}%`;
  }

  async function assertAvailable(name, options = {}) {
    const api = self[name];
    if (!api?.availability) return;
    const availability = await getAvailability(name, options);
    if (availability === "unavailable") {
      throw new Error(`${name} is unavailable on this device/profile.`);
    }
    if (availability === "downloading") {
      setDownloadStatus(`${name} downloading`);
    }
  }

  async function getFirstAvailableOptions(name, optionCandidates = [{}]) {
    const errors = [];
    for (const options of optionCandidates) {
      try {
        const availability = await getAvailability(name, options, false);
        if (availability !== "unavailable") return options;
        errors.push(`${describeOptions(options)}: unavailable`);
      } catch (error) {
        errors.push(
          `${describeOptions(options)}: ${
            error instanceof Error ? error.message : "availability failed"
          }`,
        );
      }
    }
    throw new Error(
      `${name} is unavailable with multilingual, English-only, and default options. ${errors.join("; ")}`,
    );
  }

  async function getAvailability(
    name,
    options = {},
    allowDefaultFallback = true,
  ) {
    const api = self[name];
    if (!api?.availability) return "available";
    let availability;
    try {
      availability = await api.availability(options);
    } catch (error) {
      if (!allowDefaultFallback || Object.keys(options).length === 0)
        throw error;
      availability = await api.availability();
    }
    return availability;
  }

  function describeOptions(options = {}) {
    if (!Object.keys(options).length) return "default";
    return JSON.stringify(options);
  }

  async function showApiStatus() {
    showPanel();
    const rows = await Promise.all(
      API_NAMES.map(async (name) => {
        if (!(name in self)) return { name, status: "not exposed" };
        try {
          const api = self[name];
          const status = api.availability
            ? await api.availability(API_AVAILABILITY_OPTIONS[name])
            : "exposed";
          return { name, status };
        } catch (error) {
          return {
            name,
            status: error instanceof Error ? error.message : "check failed",
          };
        }
      }),
    );

    const content = ensurePanel().querySelector("#sts-content");
    if (!content) return;
    content.innerHTML = `
      <div class="sts-turn-label">Built-in AI APIs</div>
      <div class="sts-api-grid">
        ${rows.map((row) => `<div class="sts-api-row"><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.status)}</span></div>`).join("")}
      </div>
      <pre class="sts-help">${escapeHtml("Enable flags at chrome://flags, relaunch Chrome, then use Check APIs again. For origin-trial-only APIs, register chrome-extension://YOUR_EXTENSION_ID and add the token to the manifest.")}</pre>
    `;
  }

  function onSelectionChange() {
    const text = getSelectionText();
    state.selectionText = text;
    if (!text || countWords(text) < state.minWords) return hideTooltip();
    const sel = window.getSelection();
    if (!sel?.rangeCount || sel.isCollapsed) return hideTooltip();
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect && rect.width >= 0 && rect.height >= 0) {
      state.selectionText = text;
      showTooltipAt(rect);
    } else {
      hideTooltip();
    }
  }

  function isSelectionInView(rect) {
    const vx = window.scrollX;
    const vy = window.scrollY;
    const rTop = vy + rect.top;
    const rBottom = vy + rect.bottom;
    const rLeft = vx + rect.left;
    const rRight = vx + rect.right;
    return (
      rBottom >= vy &&
      rTop <= vy + window.innerHeight &&
      rRight >= vx &&
      rLeft <= vx + window.innerWidth
    );
  }

  function updateTooltipPositionIfNeeded() {
    const text = getSelectionText();
    if (!text || countWords(text) < state.minWords) return hideTooltip();
    const sel = window.getSelection();
    if (!sel?.rangeCount || sel.isCollapsed) return hideTooltip();
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return hideTooltip();
    return isSelectionInView(rect) ? showTooltipAt(rect) : hideTooltip();
  }

  document.addEventListener("selectionchange", () =>
    setTimeout(onSelectionChange, 10),
  );
  document.addEventListener("mousedown", (event) => {
    state.lastMouseX = event?.clientX ?? state.lastMouseX;
    state.lastMouseY = event?.clientY ?? state.lastMouseY;
    if (state.panelEl?.contains(event.target)) return;
    hideTooltip();
  });
  document.addEventListener(
    "mousemove",
    (event) => {
      state.lastMouseX = event?.clientX ?? state.lastMouseX;
      state.lastMouseY = event?.clientY ?? state.lastMouseY;
    },
    true,
  );
  document.addEventListener(
    "mouseup",
    (event) => {
      state.lastMouseX = event?.clientX ?? state.lastMouseX;
      state.lastMouseY = event?.clientY ?? state.lastMouseY;
    },
    true,
  );
  document.addEventListener(
    "scroll",
    () => updateTooltipPositionIfNeeded(),
    true,
  );
  window.addEventListener("resize", updateTooltipPositionIfNeeded);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "sts-open-assistant") {
      openAssistant({
        mode: message.mode || "auto",
        prompt: message.prompt || "",
      });
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === "sts-summarize-page") {
      runQuickAction("summarize-page");
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === "sts-ask-selection") {
      state.selectionText = cleanText(
        message.selectionText || getSelectionText(),
      );
      openAssistant({ mode: "selection", prompt: message.prompt || "" });
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === "sts-summarize-selection") {
      state.selectionText = cleanText(
        message.selectionText || getSelectionText(),
      );
      runQuickAction("summarize-selection");
      sendResponse({ ok: true });
      return;
    }
  });

  installTextEntryFirewall();
  loadConfig();
})();
