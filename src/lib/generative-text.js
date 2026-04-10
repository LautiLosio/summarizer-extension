import {
  layoutWithLines,
  measureNaturalWidth,
  prepareWithSegments,
} from "@chenglou/pretext";

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SYMBOLS = "@#$%&*+";
const PUNCTUATION = ".,;:";
const DASHES = "-/";
const SPACE = " ";
const LETTER_RATIO = 0.8;
const DIGIT_RATIO = 0.15;
const SPACE_RATIO = 0.08;
const PUNCTUATION_RATIO = 0.03;
const DASH_RATIO = 0.02;
const TARGET_LINE_COUNT = 4;
const TARGET_LAST_LINE_RATIO = 0.48;
const MAX_FILL_ATTEMPTS = 200;
const WIDTH_EPSILON = 0.75;
const DEFAULT_CHARS_PER_SECOND = 16;
const SPEED_MULTIPLIER = 1.18;
const graphemeSegmenter =
  typeof Intl !== "undefined" && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

function toGraphemes(text) {
  if (!text) return [];
  if (!graphemeSegmenter) return Array.from(text);
  return Array.from(graphemeSegmenter.segment(text), (entry) => entry.segment);
}

function prefersReducedMotion() {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false
  );
}

function parseLineHeight(style) {
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(lineHeight)) return lineHeight;
  const fontSize = Number.parseFloat(style.fontSize);
  return Number.isFinite(fontSize) ? fontSize * 1.45 : 20;
}

function toCanvasFont(style) {
  const fontStyle =
    style.fontStyle && style.fontStyle !== "normal"
      ? `${style.fontStyle} `
      : "";
  const fontWeight = style.fontWeight ? `${style.fontWeight} ` : "";
  return `${fontStyle}${fontWeight}${style.fontSize} ${style.fontFamily}`.trim();
}

function measureSurface(element) {
  const target = element.parentElement ?? element;
  const style = getComputedStyle(element);
  return {
    font: toCanvasFont(style),
    lineHeight: parseLineHeight(style),
    width: Math.max(
      1,
      target.clientWidth || Math.round(target.getBoundingClientRect().width),
    ),
  };
}

async function ensureFontLoaded(font) {
  if (!document.fonts?.load) return;
  try {
    await Promise.all([
      document.fonts.load(font, "A"),
      document.fonts.load(font, "0"),
      document.fonts.load(font, "?"),
      document.fonts.load(font, " "),
    ]);
  } catch (_) {}
}

function createWidthMeasurer(metrics) {
  const cache = new Map();
  return (text) => {
    if (!text) return 0;
    const key = `${metrics.font}::${text}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const prepared = prepareWithSegments(text, metrics.font, {
      whiteSpace: "pre-wrap",
    });
    const width = measureNaturalWidth(prepared);
    cache.set(key, width);
    return width;
  };
}

function createGlyphEntries(source, measureWidth) {
  return Array.from(source, (glyph) => ({
    glyph,
    width: measureWidth(glyph),
  })).sort((left, right) => left.width - right.width);
}

function createGlyphPalette(measureWidth) {
  const letters = createGlyphEntries(LETTERS, measureWidth);
  const uppercaseLetters = createGlyphEntries(UPPERCASE_LETTERS, measureWidth);
  const digits = createGlyphEntries(DIGITS, measureWidth);
  const symbols = createGlyphEntries(SYMBOLS, measureWidth);
  const punctuation = createGlyphEntries(PUNCTUATION, measureWidth);
  const dashes = createGlyphEntries(DASHES, measureWidth);
  const spaces = createGlyphEntries(SPACE, measureWidth);
  const visible = [
    ...letters,
    ...uppercaseLetters,
    ...digits,
    ...symbols,
    ...punctuation,
    ...dashes,
  ];
  const avgVisibleWidth =
    visible.reduce((sum, entry) => sum + entry.width, 0) /
    Math.max(1, visible.length);

  return {
    letters,
    uppercaseLetters,
    digits,
    symbols,
    punctuation,
    dashes,
    spaces,
    visible,
    all: [...visible, ...spaces].sort((left, right) => left.width - right.width),
    avgVisibleWidth,
    spaceWidth: spaces[0]?.width || measureWidth(" "),
  };
}

function buildPlaceholderWidthPlan(metrics) {
  return Array.from({ length: TARGET_LINE_COUNT }, (_value, index) =>
    index === TARGET_LINE_COUNT - 1
      ? metrics.width * TARGET_LAST_LINE_RATIO
      : metrics.width,
  );
}

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pickGlyphSet(palette, nextRandom, previousGlyph = "", allowSpace = false) {
  const roll = nextRandom();
  if (allowSpace && roll < SPACE_RATIO) {
    return palette.spaces;
  }

  const adjustedRoll = allowSpace
    ? (roll - SPACE_RATIO) / Math.max(0.0001, 1 - SPACE_RATIO)
    : roll;

  if (adjustedRoll < LETTER_RATIO) {
    const useUppercase = previousGlyph === " " && nextRandom() < 0.1;
    return useUppercase ? palette.uppercaseLetters : palette.letters;
  }
  if (adjustedRoll < LETTER_RATIO + DIGIT_RATIO) {
    return palette.digits;
  }
  if (adjustedRoll < LETTER_RATIO + DIGIT_RATIO + PUNCTUATION_RATIO) {
    return palette.punctuation;
  }
  if (
    adjustedRoll <
    LETTER_RATIO + DIGIT_RATIO + PUNCTUATION_RATIO + DASH_RATIO
  ) {
    return palette.dashes;
  }
  return palette.symbols;
}

function pickFittingEntry(entries, remainingWidth, nextRandom, targetWidth) {
  const fitting = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.width <= remainingWidth + WIDTH_EPSILON) {
      fitting.push(entry);
    }
  }
  if (fitting.length === 0) return null;

  const pivot = Math.max(
    0,
    Math.min(remainingWidth - WIDTH_EPSILON, targetWidth ?? remainingWidth),
  );
  fitting.sort(
    (left, right) =>
      Math.abs(left.width - pivot) - Math.abs(right.width - pivot),
  );
  const candidates = fitting.slice(0, Math.min(8, fitting.length));
  return candidates[Math.floor(nextRandom() * candidates.length)] || null;
}

function buildFittedLine(
  targetWidth,
  glyphPalette,
  measureWidth,
  nextRandom = Math.random,
  initialPreviousGlyph = " ",
) {
  if (targetWidth <= WIDTH_EPSILON) return "";

  const thinWidth = Math.min(
    measureWidth("i"),
    measureWidth("1"),
    measureWidth("."),
    measureWidth("-"),
  );
  const minUnitWidth =
    Number.isFinite(thinWidth) && thinWidth > 0 ? thinWidth : 3;

  let line = "";
  let currentWidth = 0;
  let attempts = 0;
  let previousGlyph = initialPreviousGlyph;

  while (
    attempts < MAX_FILL_ATTEMPTS &&
    targetWidth - currentWidth > minUnitWidth
  ) {
    attempts += 1;
    const remainingWidth = targetWidth - currentWidth;
    const baseTargetWidth =
      remainingWidth > glyphPalette.avgVisibleWidth * 1.8
        ? glyphPalette.avgVisibleWidth
        : remainingWidth;
    const allowSpace =
      line.length > 0 &&
      previousGlyph !== " " &&
      remainingWidth > glyphPalette.avgVisibleWidth * 2.2;
    const preferredSet = pickGlyphSet(
      glyphPalette,
      nextRandom,
      previousGlyph,
      allowSpace,
    );
    const entry =
      pickFittingEntry(
        preferredSet,
        remainingWidth,
        nextRandom,
        baseTargetWidth,
      ) ||
      pickFittingEntry(
        glyphPalette.visible,
        remainingWidth,
        nextRandom,
        baseTargetWidth,
      ) ||
      pickFittingEntry(
        glyphPalette.all,
        remainingWidth,
        nextRandom,
        baseTargetWidth,
      );

    if (!entry) break;

    line += entry.glyph;
    currentWidth += entry.width;
    previousGlyph = entry.glyph || previousGlyph;
  }

  return line.trimEnd();
}

function buildFittedRandomText(
  targetWidth,
  glyphPalette,
  measureWidth,
  previousGlyph = " ",
  tick = 0,
  rowIndex = 0,
  salt = 0,
) {
  const nextRandom = createSeededRandom(
    ((tick + 1) * 2654435761 + (rowIndex + 1) * 2246822519 + (salt + 1) * 3266489917) >>>
      0,
  );
  return buildFittedLine(
    targetWidth,
    glyphPalette,
    measureWidth,
    nextRandom,
    previousGlyph,
  );
}

function planPlaceholderRows(metrics, measureWidth, glyphPalette) {
  return buildPlaceholderWidthPlan(metrics).map((targetWidth) => {
    const sample = buildFittedLine(targetWidth, glyphPalette, measureWidth);
    return {
      targetWidth,
      slotCount: Math.max(1, toGraphemes(sample).length),
    };
  });
}

function planFinalRows(text, metrics) {
  if (!text) return [];
  const prepared = prepareWithSegments(text, metrics.font, {
    whiteSpace: "pre-wrap",
  });
  const { lines } = layoutWithLines(prepared, metrics.width, metrics.lineHeight);
  return lines.map((line) => ({
    width: line.width,
    text: line.text,
    graphemes: toGraphemes(line.text),
  }));
}

function countSlots(rows) {
  return rows.reduce((sum, row) => sum + row.slotCount, 0);
}

function countFinalGraphemes(rows) {
  return rows.reduce((sum, row) => sum + row.graphemes.length, 0);
}

function buildRevealRows(placeholderRows, finalRows, metrics) {
  const placeholderSlotTotal = countSlots(placeholderRows);
  let overflowOffset = 0;

  return Array.from(
    { length: Math.max(placeholderRows.length, finalRows.length) },
    (_value, index) => {
      const placeholderRow = placeholderRows[index] ?? null;
      const finalRow = finalRows[index] ?? null;
      const finalGraphemes = finalRow?.graphemes ?? [];
      const slotCount = placeholderRow
        ? Math.max(placeholderRow.slotCount, finalGraphemes.length)
        : finalGraphemes.length;
      const overflowWorkStart =
        index < placeholderRows.length
          ? 0
          : placeholderSlotTotal + overflowOffset;

      if (index >= placeholderRows.length) {
        overflowOffset += finalGraphemes.length;
      }

      return {
        index,
        placeholderWidth: placeholderRow?.targetWidth ?? metrics.width,
        finalWidth: finalRow?.width ?? null,
        finalGraphemes,
        slotCount,
        paddingCount: Math.max(0, slotCount - finalGraphemes.length),
        overflowWorkStart,
      };
    },
  );
}

function distributeDeletedPadding(rows, deletedPaddingTotal) {
  const visiblePaddingByRow = Array.from({ length: rows.length }, () => 0);
  let remaining = deletedPaddingTotal;

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    const removed = Math.min(row.paddingCount, remaining);
    visiblePaddingByRow[index] = row.paddingCount - removed;
    remaining -= removed;
  }

  return visiblePaddingByRow;
}

function measureVisiblePlaceholderWidth(row, visiblePadding, resolvedWidth) {
  const visibleCount = row.finalGraphemes.length + visiblePadding;
  const capacity = Math.max(1, row.slotCount);
  return Math.max(
    resolvedWidth,
    row.placeholderWidth * (visibleCount / capacity),
  );
}

function buildLoadingSnapshot(rows, glyphPalette, measureWidth, tick = 0) {
  return rows.map((row, index) => ({
    mode: "animated",
    width: row.targetWidth,
    text: buildFittedRandomText(
      row.targetWidth,
      glyphPalette,
      measureWidth,
      " ",
      tick,
      index,
      0,
    ),
  }));
}

function buildRevealSnapshot(
  revealRows,
  placeholderRowCount,
  placeholderRows,
  glyphPalette,
  measureWidth,
  resolvedTotal,
  deletedPaddingTotal,
  tick,
) {
  const visiblePaddingByRow = distributeDeletedPadding(
    revealRows,
    deletedPaddingTotal,
  );
  const snapshot = [];
  const workDone = resolvedTotal + deletedPaddingTotal;
  let remainingResolved = resolvedTotal;

  for (let index = 0; index < revealRows.length; index += 1) {
    const row = revealRows[index];
    const resolvedInRow = Math.min(row.finalGraphemes.length, remainingResolved);
    remainingResolved -= resolvedInRow;

    const visiblePadding = visiblePaddingByRow[index] || 0;
    const isOverflowRow = index >= placeholderRowCount;
    const shouldShowOverflow = workDone > row.overflowWorkStart;
    const isVisible = isOverflowRow
      ? shouldShowOverflow
      : row.finalGraphemes.length > 0 || visiblePadding > 0;

    if (!isVisible) continue;

    const resolvedText = row.finalGraphemes.slice(0, resolvedInRow).join("");
    const resolvedWidth = measureWidth(resolvedText);
    const fullyResolved = visiblePadding === 0 && resolvedInRow === row.finalGraphemes.length;
    let currentWidth = row.finalWidth ?? row.placeholderWidth;
    if (!fullyResolved) {
      currentWidth = isOverflowRow
        ? row.finalWidth ?? row.placeholderWidth
        : row.finalWidth === null
          ? measureVisiblePlaceholderWidth(row, visiblePadding, resolvedWidth)
          : Math.max(
              row.finalWidth,
              measureVisiblePlaceholderWidth(row, visiblePadding, resolvedWidth),
            );
    }
    const previousResolvedGlyph =
      toGraphemes(resolvedText).slice(-1)[0] ||
      row.finalGraphemes[resolvedInRow - 1] ||
      " ";
    const unresolvedText = buildFittedRandomText(
      Math.max(0, currentWidth - resolvedWidth),
      glyphPalette,
      measureWidth,
      previousResolvedGlyph,
      tick,
      index,
      resolvedInRow,
    );

    snapshot.push({
      mode: "animated",
      width: currentWidth,
      text: fullyResolved ? row.finalGraphemes.join("") : `${resolvedText}${unresolvedText}`,
    });
  }

  if (snapshot.length > 0) return snapshot;

  return buildLoadingSnapshot(
    placeholderRows.slice(0, placeholderRowCount),
    glyphPalette,
    measureWidth,
    tick,
  );
}

export class GenerativeTextSurface {
  constructor(element, options = {}) {
    this.element = element;
    this.shell = element.parentElement ?? element;
    this.options = options;
    this.loadingTimer = null;
    this.revealFrame = null;
    this.metrics = null;
    this.measureWidth = null;
    this.glyphPalette = null;
    this.placeholderRows = [];
  }

  getCharsPerSecond() {
    return Math.max(
      6,
      (this.options?.charsPerSecond || DEFAULT_CHARS_PER_SECOND) *
        SPEED_MULTIPLIER,
    );
  }

  getLoadingInterval() {
    return Math.max(54, Math.min(140, 1000 / (this.getCharsPerSecond() * 0.72)));
  }

  async initializeMetrics() {
    this.metrics = measureSurface(this.element);
    await ensureFontLoaded(this.metrics.font);
    this.metrics = measureSurface(this.element);
    this.measureWidth = createWidthMeasurer(this.metrics);
    this.glyphPalette = createGlyphPalette(this.measureWidth);
  }

  async start() {
    this.stop();
    await this.initializeMetrics();
    this.placeholderRows = planPlaceholderRows(
      this.metrics,
      this.measureWidth,
      this.glyphPalette,
    );

    this.setShellHeight(
      this.placeholderRows.length * this.metrics.lineHeight,
      false,
    );
    this.renderRows(
      buildLoadingSnapshot(
        this.placeholderRows,
        this.glyphPalette,
        this.measureWidth,
      ),
    );

    if (prefersReducedMotion()) return;

    this.element.classList.add("is-animating");
    this.loadingTimer = window.setInterval(() => {
      this.renderRows(
        buildLoadingSnapshot(
          this.placeholderRows,
          this.glyphPalette,
          this.measureWidth,
          performance.now(),
        ),
      );
    }, this.getLoadingInterval());
  }

  async reveal(text) {
    const finalText = String(text || "");
    if (!this.metrics) await this.start();

    this.stopLoading();
    await this.initializeMetrics();

    const finalRows = planFinalRows(finalText, this.metrics);
    const revealRows = buildRevealRows(
      this.placeholderRows,
      finalRows,
      this.metrics,
    );
    const finalTotal = countFinalGraphemes(finalRows);
    const totalPadding = revealRows.reduce(
      (sum, row) => sum + row.paddingCount,
      0,
    );
    const totalWork = finalTotal + totalPadding;
    const finalHeight =
      Math.max(1, finalRows.length || 1) * this.metrics.lineHeight;

    if (prefersReducedMotion() || totalWork === 0) {
      this.setShellHeight(finalHeight, false);
      this.renderFinalRows(finalRows);
      this.element.classList.remove("is-animating");
      return;
    }

    const duration = Math.min(
      4800,
      Math.max(1100, (totalWork / (this.getCharsPerSecond() * 0.9)) * 1000),
    );

    await new Promise((resolve) => {
      const startedAt = performance.now();
      const step = (now) => {
        const progress = Math.min(1, (now - startedAt) / duration);
        const resolvedTotal = Math.min(finalTotal, Math.floor(finalTotal * progress));
        const deletedPaddingTotal = Math.min(
          totalPadding,
          Math.floor(totalPadding * progress),
        );
        const tick = Math.floor((now - startedAt) / this.getLoadingInterval());
        const rows = buildRevealSnapshot(
          revealRows,
          this.placeholderRows.length,
          this.placeholderRows,
          this.glyphPalette,
          this.measureWidth,
          resolvedTotal,
          deletedPaddingTotal,
          tick,
        );

        this.setShellHeight(
          Math.max(1, rows.length || 1) * this.metrics.lineHeight,
          true,
        );
        this.renderRows(rows);

        if (progress < 1) {
          this.revealFrame = window.requestAnimationFrame(step);
          return;
        }

        this.setShellHeight(finalHeight, true);
        this.renderFinalRows(finalRows);
        this.element.classList.remove("is-animating");
        this.shell.classList.remove("is-height-animating");
        this.revealFrame = null;
        resolve();
      };

      this.revealFrame = window.requestAnimationFrame(step);
    });
  }

  stop() {
    this.stopLoading();
    if (this.revealFrame !== null) {
      window.cancelAnimationFrame(this.revealFrame);
      this.revealFrame = null;
    }
    this.element.classList.remove("is-animating");
  }

  stopLoading() {
    if (this.loadingTimer !== null) {
      window.clearInterval(this.loadingTimer);
      this.loadingTimer = null;
    }
  }

  setShellHeight(height, animate) {
    this.shell.classList.toggle("is-height-animating", animate);
    this.shell.style.height = `${Math.max(this.metrics?.lineHeight || 0, height)}px`;
  }

  renderRows(rows) {
    this.element.replaceChildren(
      ...rows.map((row) => {
        const line = document.createElement("div");
        line.className = `sts-generative-line ${row.mode === "animated" ? "is-animated" : "is-final"}`;
        line.style.width = `${row.width ?? row.targetWidth}px`;
        line.style.letterSpacing = "0px";
        line.textContent = row.text || "\u00A0";
        return line;
      }),
    );
  }

  renderFinalRows(rows) {
    this.renderRows(
      rows.map((row) => ({
        mode: "final",
        width: row.width,
        text: row.text,
      })),
    );
  }
}
