const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function renderPlainText(value) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

export function renderMarkdown(value) {
  const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (/^```/.test(line.trim())) {
      const fence = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index].trim())) {
        fence.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(`<pre><code>${escapeHtml(fence.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push(`<blockquote>${renderParagraphs(quote)}</blockquote>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(renderList("ul", items));
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+[.)]\s+/, ""));
        index += 1;
      }
      blocks.push(renderList("ol", items));
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isBlockStart(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }

  return blocks.join("");
}

function renderParagraphs(lines) {
  return lines
    .join("\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${renderInline(paragraph.replace(/\n/g, " "))}</p>`)
    .join("");
}

function renderList(tag, items) {
  return `<${tag}>${items
    .map((item) => `<li>${renderInline(item)}</li>`)
    .join("")}</${tag}>`;
}

function renderInline(value) {
  const tokens = [];
  const tokenPrefix = "\u0000MD";
  const tokenSuffix = "\u0000";
  let text = String(value || "").replace(/`([^`]+)`/g, (_, code) => {
    const token = `${tokenPrefix}${tokens.length}${tokenSuffix}`;
    tokens.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  text = text.replace(
    /\[([^\]]+)\]\(((?:[^()\s]|\([^)]*\))+)\)/g,
    (_, label, href) => {
      const safeHref = normalizeSafeHref(href);
      if (!safeHref) return label;
      const token = `${tokenPrefix}${tokens.length}${tokenSuffix}`;
      tokens.push(
        `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noreferrer">${renderInline(label)}</a>`,
      );
      return token;
    },
  );

  text = escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  tokens.forEach((html, tokenIndex) => {
    text = text.replaceAll(
      `${tokenPrefix}${tokenIndex}${tokenSuffix}`,
      html,
    );
  });

  return text;
}

function isBlockStart(line) {
  return (
    /^```/.test(line.trim()) ||
    /^(#{1,3})\s+/.test(line) ||
    /^\s*>\s?/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line)
  );
}

function normalizeSafeHref(href) {
  try {
    const url = new URL(String(href || ""), location.href);
    if (!SAFE_LINK_PROTOCOLS.has(url.protocol)) return "";
    return url.href;
  } catch (_) {
    return "";
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
