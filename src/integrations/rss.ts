import { XMLParser } from "fast-xml-parser";
import { fetchText } from "../http.js";
import type { Logger } from "../logger.js";
import { errorMeta } from "../logger.js";
import type { RssItem, RssSource } from "../types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text"
});

export async function fetchRssItems(source: RssSource, maxItems = 12): Promise<RssItem[]> {
  const xml = await fetchText(source.url, {
    headers: {
      "User-Agent": "telegram-assistant-bot/1.0"
    },
    timeoutMs: 20_000,
    retries: 1
  });
  return parseRssItems(xml, source).slice(0, maxItems);
}

export function parseRssItems(xml: string, source: RssSource): RssItem[] {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const rawItems = extractRawItems(parsed);

  return rawItems
    .map((item) => normalizeItem(item, source))
    .filter((item): item is RssItem => Boolean(item?.title));
}

export function dedupeRssItems(items: RssItem[]): RssItem[] {
  const seen = new Set<string>();
  const output: RssItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    output.push(item);
  }
  return output;
}

export interface FetchSourceSetResult {
  items: RssItem[];
  activeSources: number;
  totalSources: number;
  failedSources: string[];
}

export async function fetchSourceSet(
  sources: RssSource[],
  perSourceLimit = 8,
  logger?: Logger
): Promise<FetchSourceSetResult> {
  const results = await Promise.allSettled(sources.map((source) => fetchRssItems(source, perSourceLimit)));
  const merged: RssItem[] = [];
  const failedSources: string[] = [];
  let activeSources = 0;

  results.forEach((result, index) => {
    const sourceName = sources[index]?.name ?? `source-${index}`;

    if (result.status === "rejected") {
      failedSources.push(sourceName);
      logger?.warn("rss source fetch failed", { source: sourceName, ...errorMeta(result.reason) });
      return;
    }

    if (result.value.length === 0) {
      failedSources.push(sourceName);
      logger?.warn("rss source returned no items", { source: sourceName });
      return;
    }

    activeSources += 1;
    merged.push(...result.value);
  });

  return {
    items: dedupeRssItems(merged),
    activeSources,
    totalSources: sources.length,
    failedSources
  };
}

function extractRawItems(parsed: Record<string, unknown>): Record<string, unknown>[] {
  const rss = asRecord(parsed.rss);
  const channel = asRecord(rss?.channel);
  const rdf = asRecord(parsed["rdf:RDF"]) ?? asRecord(parsed.RDF);
  const feed = asRecord(parsed.feed);

  const candidates = [
    channel?.item,
    rdf?.item,
    feed?.entry
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord);
    }
    if (isRecord(candidate)) {
      return [candidate];
    }
  }

  return [];
}

function normalizeItem(item: Record<string, unknown>, source: RssSource): RssItem | undefined {
  const title = textValue(item.title);
  if (!title) {
    return undefined;
  }

  const link = normalizeLink(item.link);
  const id = textValue(item.guid) ?? textValue(item.id) ?? link ?? `${source.name}:${title}`;
  return {
    id,
    source: source.name,
    title: stripHtml(title).slice(0, 250),
    link,
    publishedAt: textValue(item.pubDate) ?? textValue(item.published) ?? textValue(item.updated) ?? textValue(item["dc:date"]) ?? undefined,
    summary: stripHtml(textValue(item.description) ?? textValue(item.summary) ?? textValue(item.content) ?? "").slice(0, 500) || undefined
  };
}

function normalizeLink(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const link = normalizeLink(item);
      if (link) {
        return link;
      }
    }
  }

  if (isRecord(value)) {
    return textValue(value["@_href"]) ?? textValue(value.href) ?? textValue(value["#text"]);
  }

  return undefined;
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") {
    const normalized = String(value).trim();
    return normalized || undefined;
  }
  if (isRecord(value)) {
    const directText = textValue(value["#text"]);
    if (directText) {
      return directText;
    }
    for (const [key, nested] of Object.entries(value)) {
      if (key.startsWith("@_")) {
        continue;
      }
      const nestedText = textValue(nested);
      if (nestedText) {
        return nestedText;
      }
    }
  }
  return undefined;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
