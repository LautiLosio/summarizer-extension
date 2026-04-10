import { GenerativeTextSurface } from "./lib/generative-text.js"

(() => {
  // Inject font-face rules for Atkinson Hyperlegible
  const fontFaceStyle = document.createElement('style');
  const fontBaseUrl = chrome.runtime.getURL('fonts/');
  fontFaceStyle.textContent = `
    @font-face {
      font-family: 'Atkinson Hyperlegible';
      src: url('${fontBaseUrl}AtkinsonHyperlegible-Regular.ttf') format('truetype');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Atkinson Hyperlegible';
      src: url('${fontBaseUrl}AtkinsonHyperlegible-Bold.ttf') format('truetype');
      font-weight: 700;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Atkinson Hyperlegible';
      src: url('${fontBaseUrl}AtkinsonHyperlegible-Italic.ttf') format('truetype');
      font-weight: 400;
      font-style: italic;
      font-display: swap;
    }
    @font-face {
      font-family: 'Atkinson Hyperlegible';
      src: url('${fontBaseUrl}AtkinsonHyperlegible-BoldItalic.ttf') format('truetype');
      font-weight: 700;
      font-style: italic;
      font-display: swap;
    }
  `;
  document.head.appendChild(fontFaceStyle);

  const CONFIG_KEY = "sts_config";
  const PERFORMANCE_KEY = "sts_performance";
  const DEFAULT_MIN_WORDS = 40;

  const state = {
    tooltipEl: null,
    popupEl: null,
    selectionText: "",
    lastSummary: "",
    minWords: DEFAULT_MIN_WORDS,
    summarizer: null,
    isSummarizing: false,
    generativeSurface: null,
    performanceMetrics: {
      avgCharsPerSecond: 15,
      runCount: 0,
    },
    lastMouseX: 0,
    lastMouseY: 0,
  };

  function loadConfig() {
    if (!chrome?.storage?.sync) return;

    chrome.storage.sync.get([CONFIG_KEY, PERFORMANCE_KEY], (res) => {
      const cfg = res?.[CONFIG_KEY];
      state.minWords = cfg?.minWords > 0 ? cfg.minWords : DEFAULT_MIN_WORDS;

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
    });
  }

  function savePerformanceMetrics(cps) {
    const { avgCharsPerSecond: avg, runCount } = state.performanceMetrics;
    const newRunCount = runCount + 1;
    const newAvg = avg + (cps - avg) / newRunCount;

    state.performanceMetrics = {
      avgCharsPerSecond: newAvg,
      runCount: newRunCount,
    };
    if (chrome?.storage?.sync) {
      chrome.storage.sync.set({ [PERFORMANCE_KEY]: state.performanceMetrics });
    }
  }

  function ensureTooltip() {
    if (state.tooltipEl) return state.tooltipEl;

    const el = document.createElement("div");
    el.className = "sts-tooltip";
    el.innerHTML = `<div class="sts-tooltip-btn" aria-label="Summarize selection" title="Summarize selection">
      Summarize
    </div>`;

    el.addEventListener("transitionend", (e) => {
      if (e.target === el && !el.classList.contains("sts-visible")) {
        el.style.display = "none";
      }
    });
    const btn = el.querySelector(".sts-tooltip-btn");
    if (btn) {
      btn.addEventListener(
        "mousedown",
        (e) => e.preventDefault() || e.stopPropagation(),
      );
      btn.addEventListener("click", onTooltipClick);
    }
    document.body.appendChild(el);

    return (state.tooltipEl = el);
  }

  function ensurePopup() {
    if (state.popupEl) return state.popupEl;

    const el = document.createElement("div");
    el.className = "sts-popup";
    el.innerHTML = `
      <div class="sts-popup-inner">
        <div class="sts-popup-header">
          <div class="title">Summary <span id="sts-download" class="sts-download" aria-live="polite"></span></div>
          <div class="actions">
            <button class="sts-btn sts-btn--tinted sts-copy">Copy</button>
            <button class="sts-btn sts-btn--ghost sts-btn--icon sts-close" aria-label="Close summary" title="Close summary">×</button>
          </div>
        </div>
        <div class="sts-content" id="sts-content">
          <div class="sts-loading"><span class="sts-spinner" aria-hidden="true"></span> Preparing summarizer...</div>
        </div>
      </div>
    `;

    el.addEventListener("transitionend", (e) => {
      if (e.target === el && !el.classList.contains("sts-visible")) {
        el.style.display = "none";
      }
    });
    el.querySelector(".sts-close")?.addEventListener("click", hidePopup);
    el.querySelector(".sts-copy")?.addEventListener("click", copySummary);
    document.body.appendChild(el);

    return (state.popupEl = el);
  }

  function showTooltipAt(rect) {
    const el = ensureTooltip();
    const btn = el.querySelector(".sts-tooltip-btn");
    if (!btn) return;
    el.style.display = "block";

    const tooltipRect = btn.getBoundingClientRect();
    const pos = calculateOptimalPosition(rect, tooltipRect, state.lastMouseX);

    btn.style.top = `${pos.top}px`;
    btn.style.left = `${pos.left}px`;
    setTimeout(() => el.classList.add("sts-visible"), 10);
  }

  function calculateOptimalPosition(selectionRect, tooltipRect, mouseX) {
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    const margin = 12;
    const tooltipWidth = tooltipRect.width || 120;
    const tooltipHeight = tooltipRect.height || 32;

    let top = state.lastMouseY + margin;
    let left = state.lastMouseX + margin;

    if (left + tooltipWidth > viewport.width - margin) {
      left = state.lastMouseX - tooltipWidth - margin;
    }

    if (top + tooltipHeight > viewport.height - margin) {
      top = state.lastMouseY - tooltipHeight - margin;
    }

    top = Math.max(margin, top);
    left = Math.max(margin, left);

    return { top, left };
  }

  const hideTooltip = () => state.tooltipEl?.classList.remove("sts-visible");

  function showPopup() {
    const el = ensurePopup();
    el.style.display = "block";
    setTimeout(() => el.classList.add("sts-visible"), 10);
  }

  const hidePopup = () => state.popupEl?.classList.remove("sts-visible");

  function destroyGenerativeSurface() {
    try {
      state.generativeSurface?.stop?.();
    } catch (_) {}
    state.generativeSurface = null;
  }

  function setPopupContent(html) {
    const content = ensurePopup().querySelector("#sts-content");
    if (content) content.innerHTML = html;
  }

  // Lightweight status line in header for download progress
  function setDownloadStatus(msg) {
    const status = ensurePopup().querySelector("#sts-download");
    if (status) status.textContent = msg || "";
  }

  async function copySummary() {
    const text =
      state.lastSummary ||
      state.popupEl?.querySelector("#sts-content")?.innerText ||
      "";
    const copyBtn = state.popupEl?.querySelector(".sts-copy");
    if (!copyBtn) return;

    const resetCopyState = () => {
      copyBtn.textContent = "Copy";
      copyBtn.classList.remove("sts-btn--success", "sts-btn--danger");
      copyBtn.classList.add("sts-btn--tinted");
    };

    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = "Copied";
      copyBtn.classList.remove("sts-btn--tinted", "sts-btn--danger");
      copyBtn.classList.add("sts-btn--success");
    } catch (_) {
      copyBtn.textContent = "Retry";
      copyBtn.classList.remove("sts-btn--tinted", "sts-btn--success");
      copyBtn.classList.add("sts-btn--danger");
    } finally {
      setTimeout(resetCopyState, 1300);
    }
  }

  const countWords = (text) => (text.trim().match(/\b\w+\b/g) || []).length;
  const normalizeSelectionText = (text) => String(text || "").trim();

  function getSelectionText() {
    const sel = window.getSelection();
    return !sel || sel.rangeCount === 0 ? "" : sel.toString();
  }

  function triggerSummary(text) {
    const normalizedText = normalizeSelectionText(text);
    if (!normalizedText) return false;

    state.selectionText = normalizedText;
    hideTooltip();
    summarizeSelection();
    return true;
  }

  function onSelectionChange() {
    const text = getSelectionText();
    if (!text || countWords(text) < state.minWords) return hideTooltip();

    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();

    if (rect && rect.width >= 0 && rect.height >= 0) {
      state.selectionText = text;
      showTooltipAt(rect);
    } else {
      hideTooltip();
    }
  }

  async function ensureSummarizer() {
    if (state.summarizer) return state.summarizer;

    if (!("Summarizer" in self))
      throw new Error("Summarizer API not supported in this browser.");
    if ((await Summarizer.availability()) === "unavailable")
      throw new Error("Summarizer is unavailable.");

    const summarizer = await Summarizer.create({
      type: "tldr",
      format: "plain-text",
      length: "short",
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          setDownloadStatus(
            `Downloading model… ${Math.round(e.loaded * 100)}%`,
          );
        });
      },
    });

    setDownloadStatus("");
    return (state.summarizer = summarizer);
  }

  async function summarizeSelection() {
    if (state.isSummarizing) return;
    state.isSummarizing = true;
    state.lastSummary = "";
    destroyGenerativeSurface();

    showPopup();
    state.popupEl?.classList.add("is-loading");
    const copyBtn = state.popupEl?.querySelector(".sts-copy");
    copyBtn?.setAttribute("disabled", "true");
    if (copyBtn) {
      copyBtn.textContent = "Copy";
      copyBtn.classList.remove("sts-btn--success", "sts-btn--danger");
      copyBtn.classList.add("sts-btn--tinted");
    }

    const CONTEXT = "Provide a concise TL;DR oriented to a general audience.";
    setPopupContent(`
      <div class="sts-generative-shell">
        <div class="sts-content-md sts-generative-text" id="sts-generative-text" aria-live="polite"></div>
      </div>
    `);

    const tStartAll = performance.now();
    let outCharCount = 0;

    try {
      const generativeContainer = state.popupEl?.querySelector("#sts-generative-text");
      if (generativeContainer instanceof HTMLElement) {
        state.generativeSurface = new GenerativeTextSurface(generativeContainer, {
          charsPerSecond: state.performanceMetrics.avgCharsPerSecond,
          sourceText: state.selectionText,
        });
        await state.generativeSurface.start();
      }

      const summarizer = await ensureSummarizer();
      const text = state.selectionText;
      if (!text) throw new Error("Nothing selected.");

      let out = "";
      let firstChunk = true;

      const stream = summarizer.summarizeStreaming(text, { context: CONTEXT });
      for await (const chunk of stream) {
        const str = String(chunk || "");
        out += str;
        outCharCount += str.length;
        if (firstChunk) {
          firstChunk = false;
          setDownloadStatus("");
        }
      }

      if (!out) {
        const res = await summarizer.summarize(text, { context: CONTEXT });
        const str = String(res || "");
        outCharCount = str.length;
        out = str;
      }

      const elapsedSecs = Math.max(
        0.05,
        (performance.now() - tStartAll) / 1000,
      );
      const cps = outCharCount / elapsedSecs;
      if (isFinite(cps) && cps > 0) savePerformanceMetrics(cps);

      state.lastSummary = out;
      setDownloadStatus("");
      await state.generativeSurface?.reveal(out);
    } catch (err) {
      state.lastSummary = "";
      destroyGenerativeSurface();
      setPopupContent(
        `<div class="sts-error">${err instanceof Error ? err.message : "Failed to summarize."}</div>`,
      );
    } finally {
      state.isSummarizing = false;
      state.popupEl?.classList.remove("is-loading");
      state.popupEl?.querySelector(".sts-copy")?.removeAttribute("disabled");
      setDownloadStatus("");
    }
  }

  function onTooltipClick() {
    window.getSelection()?.removeAllRanges();
    triggerSummary(state.selectionText);
  }

  function isSelectionInView(rect) {
    const vx = window.scrollX,
      vy = window.scrollY;
    const vw = window.innerWidth,
      vh = window.innerHeight;
    const rTop = vy + rect.top;
    const rBottom = vy + rect.bottom;
    const rLeft = vx + rect.left;
    const rRight = vx + rect.right;
    return rBottom >= vy && rTop <= vy + vh && rRight >= vx && rLeft <= vx + vw;
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

  function onGlobalClick(e) {
    const t = e.target;
    if (state.popupEl && !state.popupEl.contains(t)) hidePopup();
  }

  document.addEventListener("selectionchange", () =>
    setTimeout(onSelectionChange, 10),
  );

  document.addEventListener("mousedown", (e) => {
    state.lastMouseX = e?.clientX ?? state.lastMouseX;
    state.lastMouseY = e?.clientY ?? state.lastMouseY;
    hideTooltip();
  });

  // Track current mouse X position continuously so we can align tooltip horizontally
  document.addEventListener(
    "mousemove",
    (e) => {
      state.lastMouseX = e?.clientX ?? state.lastMouseX;
      state.lastMouseY = e?.clientY ?? state.lastMouseY;
    },
    true,
  );

  // Ensure we capture the final cursor X at the end of selection
  document.addEventListener(
    "mouseup",
    (e) => {
      state.lastMouseX = e?.clientX ?? state.lastMouseX;
      state.lastMouseY = e?.clientY ?? state.lastMouseY;
    },
    true,
  );
  // document.addEventListener('click', onGlobalClick, true);

  document.addEventListener(
    "scroll",
    () => updateTooltipPositionIfNeeded(),
    true,
  );
  window.addEventListener("resize", updateTooltipPositionIfNeeded);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "sts-manual-summarize") return;
    sendResponse({ ok: triggerSummary(message.selectionText) });
  });

  loadConfig();
})();
