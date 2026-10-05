export const DIGEST_DIVIDER = "━".repeat(20);

export const PRIORITY_DOT_HIGH = "🔴";
export const PRIORITY_DOT_NORMAL = "🟡";

export type ItemPriority = "high" | "normal";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function bold(text: string): string {
  return `<b>${escapeHtml(text)}</b>`;
}

export function link(label: string, url: string | undefined): string {
  if (!url) {
    return escapeHtml(label);
  }
  return `<a href="${escapeAttribute(url)}">${escapeHtml(label)}</a>`;
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

export function preformatted(text: string): string {
  return `<pre>${escapeHtml(text)}</pre>`;
}

export function priorityDot(priority: ItemPriority): string {
  return priority === "high" ? PRIORITY_DOT_HIGH : PRIORITY_DOT_NORMAL;
}

export function normalizePriority(value: unknown): ItemPriority {
  return String(value ?? "").trim().toLowerCase() === "high" ? "high" : "normal";
}

export function toPlainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function markdownToTelegramHtml(markdown: string): string {
  const codeBlocks: string[] = [];
  const withoutBlocks = markdown.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_match, code: string) => {
    codeBlocks.push(`<pre>${escapeHtml(code.replace(/\n$/, ""))}</pre>`);
    return placeholder("B", codeBlocks.length - 1);
  });

  const html = escapeHtml(withoutBlocks)
    .split("\n")
    .map(formatMarkdownLine)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  return restorePlaceholders(html, "B", codeBlocks);
}

function placeholder(kind: "B" | "C", index: number): string {
  return `\u0000${kind}${index}\u0000`;
}

function restorePlaceholders(text: string, kind: "B" | "C", values: string[]): string {
  return text.replace(new RegExp(`\\u0000${kind}(\\d+)\\u0000`, "g"), (_match, index: string) => values[Number(index)] ?? "");
}

function formatMarkdownLine(line: string): string {
  const heading = /^\s{0,3}#{1,6}\s+(.+?)[\s#]*$/.exec(line);
  if (heading) {
    return `<b>${formatMarkdownInline(heading[1] ?? "")}</b>`;
  }
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
    return "";
  }
  const bullet = /^(\s*)[*+-]\s+(.*)$/.exec(line);
  if (bullet) {
    return `${bullet[1] ?? ""}• ${formatMarkdownInline(bullet[2] ?? "")}`;
  }
  return formatMarkdownInline(line);
}

function formatMarkdownInline(text: string): string {
  const codes: string[] = [];
  const withoutCode = text.replace(/`([^`]+)`/g, (_match, code: string) => {
    codes.push(`<code>${code}</code>`);
    return placeholder("C", codes.length - 1);
  });
  const formatted = withoutCode
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*\p{L}\p{N}])\*(?=\S)([^*]+?)(?<=\S)\*(?!\*)/gu, "$1<i>$2</i>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_match, label: string, url: string) =>
      `<a href="${url.replace(/"/g, "&quot;")}">${label}</a>`
    );
  return restorePlaceholders(formatted, "C", codes);
}

const CLIP_SENTENCE_MIN_FILL = 0.5;

export function clipText(text: string, maxLength: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  const head = trimmed.slice(0, maxLength);
  const sentenceEnd = lastSentenceEnd(head);
  if (sentenceEnd >= maxLength * CLIP_SENTENCE_MIN_FILL) {
    return head.slice(0, sentenceEnd);
  }

  const budget = head.slice(0, maxLength - 1);
  const wordEnd = budget.lastIndexOf(" ");
  const words = wordEnd > 0 ? budget.slice(0, wordEnd) : budget;
  return `${words.replace(/[\s,;:(–-]+$/u, "")}…`;
}

function lastSentenceEnd(text: string): number {
  let end = -1;
  for (const match of text.matchAll(/[.!?]["')]?(?=\s|$)/g)) {
    end = (match.index ?? 0) + match[0].length;
  }
  return end;
}
