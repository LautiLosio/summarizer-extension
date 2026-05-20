import {
  layoutWithLines,
  measureNaturalWidth,
  prepareWithSegments,
} from "@chenglou/pretext";

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SYMBOLS = "$&+";
const PUNCTUATION = ',."?!';
const DASHES = "-";
const SPACE = " ";
const ALLOWED_SOURCE_PUNCTUATION = new Set([
  ",",
  ".",
  '"',
  "?",
  "!",
  "$",
  "&",
  "+",
  "-",
]);
const LETTER_RATIO = 0.8;
const DIGIT_RATIO = 0.08;
const SPACE_RATIO = 0.08;
const PUNCTUATION_RATIO = 0.06;
const DASH_RATIO = 0.06;
const WORD_TOKEN_RATIO = 0.82;
const MAX_SOURCE_WORDS = 40;
const TARGET_LINE_COUNT = 4;
const TARGET_LAST_LINE_RATIO = 0.48;
const TARGET_LAST_LINE_SOFT_RATIO = 0.72;
const MAX_FILL_ATTEMPTS = 200;
const WIDTH_EPSILON = 0.75;
const DEFAULT_CHARS_PER_SECOND = 16;
const SPEED_MULTIPLIER = 1.18;
const RANDOM_TICK_MULTIPLIER = 4;
const REVEAL_SPEED_MULTIPLIER = 2;
const RECENT_WORD_WINDOW = 4;
const LOADING_GLYPH_PRESERVE_RATIO = 0.14;
const LOADING_FRAME_INTERVAL = 32;
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
    weight: 1,
    lastGlyph: glyph,
  })).sort((left, right) => left.width - right.width);
}

function mergeGlyphSources(primary, fallback) {
  return Array.from(new Set(`${primary || ""}${fallback || ""}`));
}

function classifyGlyph(glyph) {
  if (glyph === " ") return "spaces";
  if (/^[a-z]$/u.test(glyph)) return "letters";
  if (/^[A-Z]$/u.test(glyph)) return "uppercaseLetters";
  if (/^[0-9]$/u.test(glyph)) return "digits";
  if (PUNCTUATION.includes(glyph)) return "punctuation";
  if (DASHES.includes(glyph)) return "dashes";
  if (SYMBOLS.includes(glyph)) return "symbols";
  return null;
}

function sanitizeSourceToken(token) {
  const graphemes = toGraphemes(String(token || ""));
  const filtered = graphemes.filter((glyph) => {
    if (/[\p{L}\p{N}]/u.test(glyph)) return true;
    return ALLOWED_SOURCE_PUNCTUATION.has(glyph);
  });
  return filtered.join("");
}

function createSourceGlyphSets(sourceText) {
  const sets = {
    letters: new Set(),
    uppercaseLetters: new Set(),
    digits: new Set(),
    punctuation: new Set(),
    dashes: new Set(),
    symbols: new Set(),
    spaces: new Set(),
  };

  for (const glyph of toGraphemes(String(sourceText || ""))) {
    if (glyph === "/") continue;
    const kind = classifyGlyph(glyph);
    if (kind) sets[kind].add(glyph);
  }

  return sets;
}

function createSourceWordEntries(sourceText, measureWidth) {
  const matches = String(sourceText || "")
    .split(/\s+/u)
    .map((token) => sanitizeSourceToken(token).trim())
    .filter(Boolean);
  const counts = new Map();

  for (const word of matches) {
    const normalized = word.toLowerCase();
    const visibleLength = normalized.replace(/\s+/gu, "").length;
    if (visibleLength < 3 || visibleLength > 28) continue;
    const current = counts.get(normalized);
    if (current) {
      current.count += 1;
      current.forms.set(word, (current.forms.get(word) || 0) + 1);
      continue;
    }
    counts.set(normalized, {
      normalized,
      count: 1,
      forms: new Map([[word, 1]]),
    });
  }

  return Array.from(counts.values())
    .sort((left, right) => right.count - left.count)
    .slice(0, MAX_SOURCE_WORDS)
    .flatMap((info) => {
      const display =
        Array.from(info.forms.entries()).sort(
          (left, right) => right[1] - left[1],
        )[0]?.[0] || "";
      if (!display) return [];
      const trailing = `${display} `;
      const lettersCount = (display.match(/\p{L}/gu) || []).length;
      const digitsCount = (display.match(/\p{N}/gu) || []).length;
      const isMostlyNumeric =
        digitsCount > 0 && digitsCount >= Math.max(lettersCount, 1);
      const numericPenalty = isMostlyNumeric
        ? 0.32
        : digitsCount > 0
          ? 0.62
          : 1;
      const weight = Math.min(10, (1 + info.count * 1.4) * numericPenalty);
      return [
        {
          glyph: display,
          width: measureWidth(display),
          weight,
          lastGlyph: toGraphemes(display).slice(-1)[0] || display,
          wordKey: info.normalized,
        },
        {
          glyph: ` ${display}`,
          width: measureWidth(` ${display}`),
          weight: weight * 0.95,
          lastGlyph: toGraphemes(display).slice(-1)[0] || display,
          wordKey: info.normalized,
        },
        {
          glyph: trailing,
          width: measureWidth(trailing),
          weight: weight * 1.15,
          lastGlyph: " ",
          wordKey: info.normalized,
        },
      ];
    })
    .sort((left, right) => left.width - right.width);
}

function createGlyphPalette(measureWidth, sourceText = "") {
  const sourceSets = createSourceGlyphSets(sourceText);
  const words = createSourceWordEntries(sourceText, measureWidth);
  const wordsOnly = words.length > 0;
  const letters = createGlyphEntries(
    wordsOnly
      ? ""
      : mergeGlyphSources(Array.from(sourceSets.letters).join(""), LETTERS),
    measureWidth,
  );
  const uppercaseLetters = createGlyphEntries(
    wordsOnly
      ? ""
      : mergeGlyphSources(
          Array.from(sourceSets.uppercaseLetters).join(""),
          UPPERCASE_LETTERS,
        ),
    measureWidth,
  );
  const digits = createGlyphEntries(
    wordsOnly
      ? ""
      : mergeGlyphSources(Array.from(sourceSets.digits).join(""), DIGITS),
    measureWidth,
  );
  const symbols = createGlyphEntries(
    Array.from(sourceSets.symbols).join(""),
    measureWidth,
  );
  const punctuation = createGlyphEntries(
    Array.from(sourceSets.punctuation).join(""),
    measureWidth,
  );
  const dashes = createGlyphEntries(
    Array.from(sourceSets.dashes).join(""),
    measureWidth,
  );
  const spaces = createGlyphEntries(
    mergeGlyphSources(Array.from(sourceSets.spaces).join(""), SPACE),
    measureWidth,
  );
  const visible = [
    ...letters,
    ...uppercaseLetters,
    ...digits,
    ...symbols,
    ...punctuation,
    ...dashes,
  ];
  const loadingGlyphs = {
    letters: Array.from(sourceSets.letters),
    uppercaseLetters: Array.from(sourceSets.uppercaseLetters),
    digits: Array.from(sourceSets.digits),
    punctuation: Array.from(sourceSets.punctuation),
    dashes: Array.from(sourceSets.dashes),
    symbols: Array.from(sourceSets.symbols),
  };
  loadingGlyphs.visible = [
    ...loadingGlyphs.letters,
    ...loadingGlyphs.uppercaseLetters,
    ...loadingGlyphs.digits,
    ...loadingGlyphs.punctuation,
    ...loadingGlyphs.dashes,
    ...loadingGlyphs.symbols,
  ];
  if (loadingGlyphs.visible.length === 0) {
    loadingGlyphs.visible = visible.map((entry) => entry.glyph).filter(Boolean);
  }
  if (loadingGlyphs.letters.length === 0) {
    loadingGlyphs.letters = letters.map((entry) => entry.glyph).filter(Boolean);
  }
  if (loadingGlyphs.uppercaseLetters.length === 0) {
    loadingGlyphs.uppercaseLetters = uppercaseLetters
      .map((entry) => entry.glyph)
      .filter(Boolean);
  }
  if (loadingGlyphs.digits.length === 0) {
    loadingGlyphs.digits = digits.map((entry) => entry.glyph).filter(Boolean);
  }
  if (loadingGlyphs.punctuation.length === 0) {
    loadingGlyphs.punctuation = punctuation
      .map((entry) => entry.glyph)
      .filter(Boolean);
  }
  if (loadingGlyphs.dashes.length === 0) {
    loadingGlyphs.dashes = dashes.map((entry) => entry.glyph).filter(Boolean);
  }
  if (loadingGlyphs.symbols.length === 0) {
    loadingGlyphs.symbols = symbols.map((entry) => entry.glyph).filter(Boolean);
  }
  const avgVisibleWidth =
    visible.reduce((sum, entry) => sum + entry.width, 0) /
    Math.max(1, visible.length);

  return {
    wordsOnly,
    letters,
    uppercaseLetters,
    digits,
    symbols,
    punctuation,
    dashes,
    spaces,
    words,
    loadingGlyphs,
    visible,
    all: [...visible, ...spaces].sort(
      (left, right) => left.width - right.width,
    ),
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

function getLastRowSoftWidth(metrics, glyphPalette) {
  return Math.min(
    metrics.width * TARGET_LAST_LINE_SOFT_RATIO,
    metrics.width * TARGET_LAST_LINE_RATIO + glyphPalette.avgVisibleWidth * 6,
  );
}

function pickRandomGlyph(glyphs, nextRandom) {
  if (!glyphs || glyphs.length === 0) return "";
  return glyphs[Math.floor(nextRandom() * glyphs.length)] || "";
}

function pickScrambleGlyph(originalGlyph, glyphPalette, nextRandom) {
  if (originalGlyph === " ") return " ";

  const loadingGlyphs = glyphPalette.loadingGlyphs;
  const kind = classifyGlyph(originalGlyph);
  const fallbackGlyph =
    pickRandomGlyph(loadingGlyphs.visible, nextRandom) || originalGlyph;

  if (nextRandom() < LOADING_GLYPH_PRESERVE_RATIO) {
    return originalGlyph;
  }

  switch (kind) {
    case "letters":
      return pickRandomGlyph(loadingGlyphs.letters, nextRandom) || fallbackGlyph;
    case "uppercaseLetters":
      return (
        pickRandomGlyph(loadingGlyphs.uppercaseLetters, nextRandom) ||
        pickRandomGlyph(loadingGlyphs.letters, nextRandom)?.toLocaleUpperCase() ||
        fallbackGlyph
      );
    case "digits":
      return pickRandomGlyph(loadingGlyphs.digits, nextRandom) || fallbackGlyph;
    case "punctuation":
      return (
        pickRandomGlyph(loadingGlyphs.punctuation, nextRandom) || fallbackGlyph
      );
    case "dashes":
      return pickRandomGlyph(loadingGlyphs.dashes, nextRandom) || fallbackGlyph;
    case "symbols":
      return pickRandomGlyph(loadingGlyphs.symbols, nextRandom) || fallbackGlyph;
    default:
      return fallbackGlyph;
  }
}

function scrambleLoadingText(text, glyphPalette, tick = 0, rowIndex = 0) {
  const nextRandom = createSeededRandom(
    ((tick + 1) * 1597334677 + (rowIndex + 1) * 3812015801) >>> 0,
  );

  return toGraphemes(text)
    .map((glyph) => pickScrambleGlyph(glyph, glyphPalette, nextRandom))
    .join("");
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

function capitalizeLeadingLetter(text) {
  const graphemes = toGraphemes(text);
  for (let index = 0; index < graphemes.length; index += 1) {
    const glyph = graphemes[index];
    if (!/\p{L}/u.test(glyph)) continue;
    graphemes[index] = glyph.toLocaleUpperCase();
    return graphemes.join("");
  }
  return text;
}

function createCapitalizedEntry(entry, measureWidth) {
  const capitalizedGlyph = capitalizeLeadingLetter(entry.glyph);
  if (capitalizedGlyph === entry.glyph) return entry;
  return {
    ...entry,
    glyph: capitalizedGlyph,
    width: measureWidth(capitalizedGlyph),
    lastGlyph: toGraphemes(capitalizedGlyph).slice(-1)[0] || entry.lastGlyph,
  };
}

function pickGlyphSet(
  palette,
  nextRandom,
  previousGlyph = "",
  allowSpace = false,
) {
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

function getEntryWeight(entry, recentWordKeys = []) {
  let weight = entry.weight || 1;
  if (!entry.wordKey || recentWordKeys.length === 0) return weight;

  const reverseIndex = recentWordKeys.lastIndexOf(entry.wordKey);
  if (reverseIndex === -1) return weight;

  const distanceFromEnd = recentWordKeys.length - 1 - reverseIndex;
  if (distanceFromEnd === 0) return weight * 0.08;
  if (distanceFromEnd === 1) return weight * 0.18;
  if (distanceFromEnd === 2) return weight * 0.35;
  return weight * 0.6;
}

function pickFittingEntry(
  entries,
  remainingWidth,
  nextRandom,
  targetWidth,
  options = {},
) {
  const recentWordKeys = options.recentWordKeys || [];
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
  const candidates = fitting.slice(0, Math.min(12, fitting.length));
  const totalWeight = candidates.reduce(
    (sum, candidate) => sum + getEntryWeight(candidate, recentWordKeys),
    0,
  );
  if (totalWeight <= 0) {
    return candidates[Math.floor(nextRandom() * candidates.length)] || null;
  }

  let threshold = nextRandom() * totalWeight;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    threshold -= getEntryWeight(candidate, recentWordKeys);
    if (threshold <= 0) return candidate;
  }
  return candidates[candidates.length - 1] || null;
}

function buildFittedLine(
  targetWidth,
  glyphPalette,
  measureWidth,
  nextRandom = Math.random,
  initialPreviousGlyph = " ",
  forceCapitalizedStart = false,
  options = {},
) {
  const preferredWidth = options.preferredWidth ?? targetWidth;
  const maxWidth = Math.max(targetWidth, options.maxWidth ?? targetWidth);
  if (targetWidth <= WIDTH_EPSILON) return "";
  if (glyphPalette.wordsOnly && glyphPalette.words.length === 0) return "";

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
  const recentWordKeys = [];

  while (
    attempts < MAX_FILL_ATTEMPTS &&
    maxWidth - currentWidth > minUnitWidth
  ) {
    attempts += 1;
    const remainingWidth = maxWidth - currentWidth;
    const baseTargetWidth =
      preferredWidth - currentWidth > glyphPalette.avgVisibleWidth * 1.8
        ? glyphPalette.avgVisibleWidth
        : Math.max(minUnitWidth, preferredWidth - currentWidth);
    const allowSpace =
      line.length > 0 &&
      previousGlyph !== " " &&
      maxWidth - currentWidth > glyphPalette.avgVisibleWidth * 2.2;
    const canUseWord =
      glyphPalette.words.length > 0 &&
      (line.length === 0 || previousGlyph === " " || glyphPalette.wordsOnly) &&
      maxWidth - currentWidth > glyphPalette.avgVisibleWidth * 2.4;
    const preferredWordEntry = canUseWord
      ? pickFittingEntry(
          glyphPalette.words,
          remainingWidth,
          nextRandom,
          Math.max(baseTargetWidth * 2.8, glyphPalette.avgVisibleWidth * 4.5),
          { recentWordKeys },
        )
      : null;
    if (glyphPalette.wordsOnly) {
      const entry =
        forceCapitalizedStart && line.length === 0
          ? createCapitalizedEntry(preferredWordEntry, measureWidth)
          : preferredWordEntry;

      if (!entry) break;

      const nextWidth = currentWidth + entry.width;
      const crossesPreferred =
        currentWidth < preferredWidth && nextWidth > preferredWidth;
      const shouldStopBeforeOverflowingPreferred =
        crossesPreferred &&
        currentWidth > 0 &&
        (entry.glyph.endsWith(" ") || entry.glyph.startsWith(" "));

      if (shouldStopBeforeOverflowingPreferred) break;

      line += entry.glyph;
      currentWidth = nextWidth;
      previousGlyph = entry.lastGlyph || previousGlyph;
      if (entry.wordKey) {
        recentWordKeys.push(entry.wordKey);
        if (recentWordKeys.length > RECENT_WORD_WINDOW) {
          recentWordKeys.shift();
        }
      }

      if (
        currentWidth >= preferredWidth &&
        currentWidth >= maxWidth - minUnitWidth
      ) {
        break;
      }

      continue;
    }
    const preferredSet = pickGlyphSet(
      glyphPalette,
      nextRandom,
      previousGlyph,
      allowSpace,
    );
    const weightedWordEntry =
      canUseWord && nextRandom() < WORD_TOKEN_RATIO
        ? pickFittingEntry(
            glyphPalette.words,
            remainingWidth,
            nextRandom,
            Math.max(baseTargetWidth * 2.8, glyphPalette.avgVisibleWidth * 4.5),
            { recentWordKeys },
          )
        : null;
    const rawEntry =
      weightedWordEntry ||
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
    const entry =
      forceCapitalizedStart && line.length === 0
        ? createCapitalizedEntry(rawEntry, measureWidth)
        : rawEntry;

    if (!entry) break;

    const nextWidth = currentWidth + entry.width;
    const crossesPreferred =
      currentWidth < preferredWidth && nextWidth > preferredWidth;
    const shouldStopBeforeOverflowingPreferred =
      crossesPreferred &&
      currentWidth > 0 &&
      (entry.glyph.endsWith(" ") || entry.glyph.includes(" "));

    if (shouldStopBeforeOverflowingPreferred) break;

    line += entry.glyph;
    currentWidth = nextWidth;
    previousGlyph = entry.lastGlyph || previousGlyph;
    if (entry.wordKey) {
      recentWordKeys.push(entry.wordKey);
      if (recentWordKeys.length > RECENT_WORD_WINDOW) {
        recentWordKeys.shift();
      }
    }

    if (
      currentWidth >= preferredWidth &&
      currentWidth >= maxWidth - minUnitWidth
    ) {
      break;
    }
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
  forceCapitalizedStart = false,
  options = {},
) {
  const nextRandom = createSeededRandom(
    ((tick + 1) * 2654435761 +
      (rowIndex + 1) * 2246822519 +
      (salt + 1) * 3266489917) >>>
      0,
  );
  return buildFittedLine(
    targetWidth,
    glyphPalette,
    measureWidth,
    nextRandom,
    previousGlyph,
    forceCapitalizedStart,
    options,
  );
}

function planPlaceholderRows(metrics, measureWidth, glyphPalette) {
  return buildPlaceholderWidthPlan(metrics).map((targetWidth) => {
    const isLastRow = targetWidth < metrics.width;
    const sample = buildFittedLine(
      targetWidth,
      glyphPalette,
      measureWidth,
      Math.random,
      " ",
      false,
      isLastRow
        ? {
            preferredWidth: targetWidth,
            maxWidth: getLastRowSoftWidth(metrics, glyphPalette),
          }
        : {},
    );
    return {
      targetWidth,
      softWidth: isLastRow
        ? getLastRowSoftWidth(metrics, glyphPalette)
        : targetWidth,
      slotCount: Math.max(1, toGraphemes(sample).length),
    };
  });
}

function planFinalRows(text, metrics) {
  if (!text) return [];
  const prepared = prepareWithSegments(text, metrics.font, {
    whiteSpace: "pre-wrap",
  });
  const { lines } = layoutWithLines(
    prepared,
    metrics.width,
    metrics.lineHeight,
  );
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
        placeholderSoftWidth:
          placeholderRow?.softWidth ??
          placeholderRow?.targetWidth ??
          metrics.width,
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
  return rows.map((row, index) => {
    const baseText = buildFittedRandomText(
      row.targetWidth,
      glyphPalette,
      measureWidth,
      " ",
      tick,
      index,
      0,
      index === 0,
      {
        preferredWidth: row.targetWidth,
        maxWidth: row.softWidth ?? row.targetWidth,
      },
    );
    const text = scrambleLoadingText(baseText, glyphPalette, tick, index);

    return {
      mode: "animated",
      width: measureWidth(text),
      text,
    };
  });
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
    const resolvedInRow = Math.min(
      row.finalGraphemes.length,
      remainingResolved,
    );
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
    const fullyResolved =
      visiblePadding === 0 && resolvedInRow === row.finalGraphemes.length;
    let currentWidth = row.finalWidth ?? row.placeholderWidth;
    if (!fullyResolved) {
      currentWidth = isOverflowRow
        ? (row.finalWidth ?? row.placeholderWidth)
        : row.finalWidth === null
          ? measureVisiblePlaceholderWidth(row, visiblePadding, resolvedWidth)
          : Math.max(
              row.finalWidth,
              measureVisiblePlaceholderWidth(
                row,
                visiblePadding,
                resolvedWidth,
              ),
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
      index === 0 && resolvedText.length === 0,
      {
        preferredWidth: Math.max(0, currentWidth - resolvedWidth),
        maxWidth: Math.max(
          0,
          (isOverflowRow ? currentWidth : row.placeholderSoftWidth) -
            resolvedWidth,
        ),
      },
    );
    const displayText = fullyResolved
      ? row.finalGraphemes.join("")
      : `${resolvedText}${unresolvedText}`;

    snapshot.push({
      mode: "animated",
      width: measureWidth(displayText),
      text: displayText,
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
    this.sourceText = String(options?.sourceText || "");
    this.loadingFrame = null;
    this.loadingLastTickAt = 0;
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

  getRevealCharsPerSecond() {
    return this.getCharsPerSecond() * REVEAL_SPEED_MULTIPLIER;
  }

  getLoadingInterval() {
    return Math.max(
      66,
      Math.min(
        180,
        (1000 / (this.getCharsPerSecond() * 0.72)) * RANDOM_TICK_MULTIPLIER,
      ),
    );
  }

  async initializeMetrics() {
    this.metrics = measureSurface(this.element);
    await ensureFontLoaded(this.metrics.font);
    this.metrics = measureSurface(this.element);
    this.measureWidth = createWidthMeasurer(this.metrics);
    this.glyphPalette = createGlyphPalette(this.measureWidth, this.sourceText);
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
    this.loadingLastTickAt = performance.now();
    const step = (now) => {
      if (now - this.loadingLastTickAt >= LOADING_FRAME_INTERVAL) {
        this.loadingLastTickAt = now;
        this.renderRows(
          buildLoadingSnapshot(
            this.placeholderRows,
            this.glyphPalette,
            this.measureWidth,
            now,
          ),
        );
      }

      this.loadingFrame = window.requestAnimationFrame(step);
    };

    this.loadingFrame = window.requestAnimationFrame(step);
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
      Math.max(
        900,
        (totalWork / (this.getRevealCharsPerSecond() * 0.9)) * 1000,
      ),
    );

    await new Promise((resolve) => {
      const startedAt = performance.now();
      const step = (now) => {
        const progress = Math.min(1, (now - startedAt) / duration);
        const resolvedTotal = Math.min(
          finalTotal,
          Math.floor(finalTotal * progress),
        );
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
    if (this.loadingFrame !== null) {
      window.cancelAnimationFrame(this.loadingFrame);
      this.loadingFrame = null;
    }
    this.loadingLastTickAt = 0;
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
