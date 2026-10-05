import type { ItemPriority } from "../format.js";
import type { RssItem } from "../types.js";
import type { NewsCategoryKey } from "./render.js";

export interface ProcessedNewsItem {
  turkishTitle: string;
  category?: NewsCategoryKey | string;
  categoryEmoji?: string;
  tags?: string;
  priority: ItemPriority;
  turkishSummary: string;
  item: RssItem;
}

export interface RecentRssResult {
  items: RssItem[];
  activeSources: number;
  totalSources: number;
  failedSources: string[];
  totalScanned: number;
}
