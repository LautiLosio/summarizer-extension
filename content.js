(() => {
  const CONFIG_KEY = "sts_config";
  const PERFORMANCE_KEY = "sts_performance";
  const DEFAULT_MIN_WORDS = 40;
  const CHARS_PER_LINE = 61;

  const state = {
    tooltipEl: null,
    popupEl: null,
    selectionText: "",
    minWords: DEFAULT_MIN_WORDS,
    summarizer: null,
    isSummarizing: false,
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
      📝 Summarize
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
            <button class="sts-btn sts-copy">Copy</button>
            <button class="sts-btn sts-close">Close</button>
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
    const text = state.popupEl?.querySelector("#sts-content")?.innerText || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {}
  }

  const countWords = (text) => (text.trim().match(/\b\w+\b/g) || []).length;

  function getSelectionText() {
    const sel = window.getSelection();
    return !sel || sel.rangeCount === 0 ? "" : sel.toString();
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

    showPopup();
    state.popupEl?.classList.add("is-loading");
    const copyBtn = state.popupEl?.querySelector(".sts-copy");
    copyBtn?.setAttribute("disabled", "true");

    const CONTEXT = "Provide a concise TL;DR oriented to a general audience.";
    setPopupContent(`
      <div class="sts-stack" id="sts-stack">
        <div class="sts-skeleton sts-layer sts-layer--skeleton" id="sts-skeleton" aria-hidden="true">
          <div class="sts-skeleton-line" style="width: 100%"></div>
          <div class="sts-skeleton-line" style="width: 100%"></div>
          <div class="sts-skeleton-line" style="width: 100%"></div>
          <div class="sts-skeleton-line" style="width: 40%"></div>
        </div>
        <div class="sts-content-md sts-fade sts-layer sts-layer--text" id="sts-stream-out" style="white-space: pre-wrap; opacity: 0;"></div>
      </div>
    `);

    // Fade out skeleton lines at a pace derived from chars/sec estimate
    function startSkeletonFade(cpsEstimate) {
      const skeleton = state.popupEl?.querySelector("#sts-skeleton");
      const lines = skeleton
        ? Array.from(skeleton.querySelectorAll(".sts-skeleton-line"))
        : [];
      if (!skeleton || !lines.length) return { stop() {} };

      const secsPerLine = CHARS_PER_LINE / Math.max(1, cpsEstimate);
      const handles = lines.map((line, idx) =>
        setTimeout(
          () => {
            line.style.transition =
              "opacity 400ms cubic-bezier(0.4, 0, 0.2, 1)";
            line.style.opacity = "0";
          },
          secsPerLine * idx * 1000,
        ),
      );

      // Remove skeleton a bit later after last line fade completes
      const cleanup = setTimeout(
        () => {
          skeleton.classList.add("fade-out");
          setTimeout(() => skeleton.remove(), 250);
        },
        secsPerLine * (lines.length - 1) * 1000 + 260,
      );
      handles.push(cleanup);

      return {
        stop() {
          handles.forEach(clearTimeout);
        },
      };
    }

    const tStartAll = performance.now();
    let outCharCount = 0;
    let fadeController = null;

    try {
      const summarizer = await ensureSummarizer();
      const text = state.selectionText;
      if (!text) throw new Error("Nothing selected.");

      const container = state.popupEl?.querySelector("#sts-stream-out");
      const skeleton = state.popupEl?.querySelector("#sts-skeleton");
      let out = "";
      let firstChunk = true;

      const stream = summarizer.summarizeStreaming(text, { context: CONTEXT });
      for await (const chunk of stream) {
        const str = String(chunk || "");
        out += str;
        outCharCount += str.length;
        if (container) container.textContent = out;
        if (firstChunk) {
          firstChunk = false;
          setDownloadStatus("");
          fadeController = startSkeletonFade(
            state.performanceMetrics.avgCharsPerSecond,
          );
          if (skeleton) container?.classList.add("is-visible");
        }
      }

      if (!out) {
        const res = await summarizer.summarize(text, { context: CONTEXT });
        const str = String(res || "");
        outCharCount = str.length;
        if (container) container.textContent = str;
        setDownloadStatus("");
        fadeController = startSkeletonFade(
          state.performanceMetrics.avgCharsPerSecond,
        );
        if (skeleton) container?.classList.add("is-visible");
      }

      const elapsedSecs = Math.max(
        0.05,
        (performance.now() - tStartAll) / 1000,
      );
      const cps = outCharCount / elapsedSecs;
      if (isFinite(cps) && cps > 0) savePerformanceMetrics(cps);

      if (skeleton) {
        skeleton.classList.add("fade-out");
        setTimeout(() => skeleton.remove(), 250);
      }
    } catch (err) {
      setPopupContent(
        `<div class="sts-error">${err instanceof Error ? err.message : "Failed to summarize."}</div>`,
      );
    } finally {
      try {
        fadeController?.stop?.();
      } catch (_) {}
      state.isSummarizing = false;
      state.popupEl?.classList.remove("is-loading");
      state.popupEl?.querySelector(".sts-copy")?.removeAttribute("disabled");
      setDownloadStatus("");
    }
  }

  function onTooltipClick() {
    window.getSelection()?.removeAllRanges();
    hideTooltip();
    summarizeSelection();
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

  loadConfig();
})();
