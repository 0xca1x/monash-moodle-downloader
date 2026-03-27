import path from "node:path";

import { load } from "cheerio";
import type {
  APIRequestContext,
  Browser,
  BrowserContext,
  BrowserContextOptions,
  BrowserType,
  Page
} from "playwright";
import type { ResourceLink } from "@monash-moodle-downloader/shared";

import { launchPreferredBrowser } from "../auth/browser-launch.js";

interface PlaywrightModule {
  chromium: BrowserType;
}

interface PanoptoRuntimeCaptureResult {
  finalUrl: string;
  htmlText: string;
  mediaUrls: string[];
  transcriptText: string | null;
}

export interface PanoptoCaptureRuntime {
  capture(viewerUrl: string): Promise<PanoptoRuntimeCaptureResult>;
  close(): Promise<void>;
}

const SUBTITLE_EXTENSIONS = [".vtt", ".srt"];
const DIRECT_VIDEO_EXTENSIONS = [".mp4", ".m4a", ".mov", ".webm", ".m3u8", ".mp3"];
const GUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function importPlaywright(): Promise<PlaywrightModule> {
  try {
    return (await import("playwright")) as unknown as PlaywrightModule;
  } catch {
    throw new Error("Playwright is not installed for the Node CLI.");
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function getPathExtension(url: string): string {
  try {
    return path.extname(new URL(url).pathname).toLowerCase();
  } catch {
    return "";
  }
}

function isSubtitleUrl(url: string): boolean {
  return SUBTITLE_EXTENSIONS.includes(getPathExtension(url));
}

function isDirectVideoUrl(url: string): boolean {
  return DIRECT_VIDEO_EXTENSIONS.includes(getPathExtension(url));
}

function classifyUrl(url: string): Pick<ResourceLink, "resourceType" | "delivery"> | null {
  if (isSubtitleUrl(url)) {
    return { resourceType: "subtitle", delivery: "download" };
  }
  if (isDirectVideoUrl(url)) {
    return { resourceType: "video", delivery: "download" };
  }
  return null;
}

function extractGuid(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value.match(GUID_PATTERN)?.[0] ?? null;
}

function extractPanoptoSessionId(panoptoUrl: string, htmlText: string): string | null {
  try {
    const url = new URL(panoptoUrl);
    for (const key of ["id", "sessionid", "sessionId"]) {
      const candidate = extractGuid(url.searchParams.get(key));
      if (candidate) {
        return candidate;
      }
    }
  } catch {
    // ignore
  }

  const htmlMatches = [
    /\/sessions\/[0-9a-f-]{36}\/([0-9a-f-]{36})_et\//i,
    /["']SessionId["']\s*[:=]\s*["']([0-9a-f-]{36})["']/i,
    /["']DeliveryId["']\s*[:=]\s*["']([0-9a-f-]{36})["']/i,
    /[?&]id=([0-9a-f-]{36})/i
  ];

  for (const pattern of htmlMatches) {
    const match = pattern.exec(htmlText);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function extractPanoptoDirectMediaUrls(htmlText: string): string[] {
  const urls = new Set<string>();
  for (const match of htmlText.matchAll(/https?:\/\/[^"'\\s<>]+/gi)) {
    const url = match[0];
    if (isDirectVideoUrl(url)) {
      urls.add(url);
    }
  }
  return [...urls];
}

function extractPanoptoTranscriptText(htmlText: string): string | null {
  const $ = load(htmlText);
  const items = $("#transcriptTabPane li.index-event").toArray();
  if (items.length === 0) {
    return null;
  }

  const lines = items
    .map((item) => {
      const time = normalizeText($(item).find(".event-time").first().text());
      const text = normalizeText($(item).find(".event-text").first().text());
      if (!text) {
        return "";
      }
      return time ? `[${time}] ${text}` : text;
    })
    .filter(Boolean);

  return lines.length ? `${lines.join("\n")}\n` : null;
}

function buildPanoptoViewerUrl(sourceUrl: string, sessionId: string): string {
  const url = new URL(sourceUrl);
  return `${url.origin}/Panopto/Pages/Viewer.aspx?id=${sessionId}&start=0`;
}

function normalizePanoptoTitleKey(title: string): string {
  return normalizeText(title)
    .replace(/[_\s]+default_[0-9a-f]+$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/[,:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function dedupePanoptoResources(links: ResourceLink[]): ResourceLink[] {
  const pickBetterLink = (current: ResourceLink, next: ResourceLink): ResourceLink => {
    const currentLooksDefault = /default_[0-9a-f]+$/i.test(current.title);
    const nextLooksDefault = /default_[0-9a-f]+$/i.test(next.title);
    if (currentLooksDefault !== nextLooksDefault) {
      return nextLooksDefault ? current : next;
    }

    const currentViewer = current.url.toLowerCase().includes("/viewer.aspx");
    const nextViewer = next.url.toLowerCase().includes("/viewer.aspx");
    if (currentViewer !== nextViewer) {
      return nextViewer ? next : current;
    }

    const currentTitleLength = normalizePanoptoTitleKey(current.title).length;
    const nextTitleLength = normalizePanoptoTitleKey(next.title).length;
    if (currentTitleLength !== nextTitleLength) {
      return nextTitleLength < currentTitleLength ? next : current;
    }

    return current;
  };

  const bestByMarker = new Map<string, ResourceLink>();

  for (const link of links) {
    const extension =
      link.delivery === "reference" ? "reference" : getPathExtension(link.url) || "inline";
    const marker = [
      link.section,
      link.subsection,
      link.group,
      normalizePanoptoTitleKey(link.title),
      link.resourceType,
      link.delivery,
      extension
    ].join("\u0000");

    const existing = bestByMarker.get(marker);
    if (!existing) {
      bestByMarker.set(marker, link);
      continue;
    }

    bestByMarker.set(marker, pickBetterLink(existing, link));
  }

  return [...bestByMarker.values()];
}

function looksLikePanoptoLink(link: ResourceLink): boolean {
  const lower = link.url.toLowerCase();
  return (
    lower.includes("panopto.com") ||
    lower.includes(".cdn.au.panopto.com/") ||
    lower.includes(".cdn.panopto.com/")
  );
}

export function dedupeEquivalentPanoptoLinks(links: ResourceLink[]): ResourceLink[] {
  const panoptoLinks = links.filter(looksLikePanoptoLink);
  if (panoptoLinks.length === 0) {
    return links;
  }

  const nonPanoptoLinks = links.filter((link) => !looksLikePanoptoLink(link));
  return [...nonPanoptoLinks, ...dedupePanoptoResources(panoptoLinks)];
}

export function dropRedundantPanoptoPlaylistLinks(links: ResourceLink[]): ResourceLink[] {
  const mp4Keys = new Set(
    links
      .filter(
        (link) =>
          link.resourceType === "video" &&
          link.delivery === "download" &&
          getPathExtension(link.url) === ".mp4"
      )
      .map((link) => [link.section, link.subsection, link.group, link.title].join("\u0000"))
  );

  if (mp4Keys.size === 0) {
    return links;
  }

  return links.filter((link) => {
    if (
      !(
        link.resourceType === "video" &&
        link.delivery === "download" &&
        getPathExtension(link.url) === ".m3u8"
      )
    ) {
      return true;
    }
    const key = [link.section, link.subsection, link.group, link.title].join("\u0000");
    return !mp4Keys.has(key);
  });
}

export function formatTranscriptTextAsSrt(text: string): string {
  const parseTimestampToSeconds = (value: string): number | null => {
    const parts = value
      .trim()
      .split(":")
      .map((part) => Number(part));
    if (parts.some((part) => Number.isNaN(part))) {
      return null;
    }
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return null;
  };

  const formatSecondsAsSrtTimestamp = (totalSeconds: number): string => {
    const safeSeconds = Math.max(0, totalSeconds);
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const seconds = Math.floor(safeSeconds % 60);
    const milliseconds = Math.round((safeSeconds - Math.floor(safeSeconds)) * 1000);
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")},${milliseconds.toString().padStart(3, "0")}`;
  };

  const rawEntries = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^\[(.+?)\]\s*(.+)$/.exec(line);
      if (!match) {
        return null;
      }
      const start = parseTimestampToSeconds(match[1]);
      if (start === null) {
        return null;
      }
      return { start, text: match[2] };
    })
    .filter((entry): entry is { start: number; text: string } => Boolean(entry));

  if (rawEntries.length === 0) {
    return text;
  }

  const entries: Array<{ start: number; text: string }> = [];
  for (const entry of rawEntries) {
    const previous = entries[entries.length - 1];
    const gap = previous ? entry.start - previous.start : Number.POSITIVE_INFINITY;
    const previousEndsSentence = previous ? /[.!?。！？:]$/.test(previous.text) : true;
    const currentLooksContinuation = /^[a-z0-9,(]/i.test(entry.text);
    const currentIsShort = entry.text.length <= 80;

    if (
      previous &&
      gap > 0 &&
      gap <= 2.2 &&
      !previousEndsSentence &&
      currentLooksContinuation &&
      currentIsShort
    ) {
      previous.text = `${previous.text} ${entry.text}`.replace(/\s+/g, " ").trim();
      continue;
    }

    entries.push({ ...entry });
  }

  return entries
    .map((entry, index) => {
      const nextStart = entries[index + 1]?.start;
      const end =
        nextStart !== undefined
          ? Math.max(entry.start + 1.2, nextStart - 0.15)
          : entry.start + Math.min(Math.max(entry.text.length / 12, 2.5), 6);
      return [
        String(index + 1),
        `${formatSecondsAsSrtTimestamp(entry.start)} --> ${formatSecondsAsSrtTimestamp(end)}`,
        entry.text,
        ""
      ].join("\n");
    })
    .join("\n");
}

export function createPanoptoCaptureRuntime(
  storageState: BrowserContextOptions["storageState"]
): PanoptoCaptureRuntime {
  let browserPromise: Promise<Browser> | null = null;
  let contextPromise: Promise<BrowserContext> | null = null;

  const getContext = async (): Promise<BrowserContext> => {
    if (!contextPromise) {
      contextPromise = (async () => {
        const { chromium } = await importPlaywright();
        browserPromise = launchPreferredBrowser(chromium, true);
        const browser = await browserPromise;
        return browser.newContext({
          storageState,
          acceptDownloads: false
        });
      })();
    }
    return contextPromise;
  };

  return {
    async capture(viewerUrl: string): Promise<PanoptoRuntimeCaptureResult> {
      return capturePanoptoRuntimeLinks(await getContext(), viewerUrl);
    },
    async close(): Promise<void> {
      const context = contextPromise ? await contextPromise.catch(() => null) : null;
      const browser = browserPromise ? await browserPromise.catch(() => null) : null;
      if (context) {
        await context.close().catch(() => undefined);
      }
      if (browser) {
        await browser.close().catch(() => undefined);
      }
    }
  };
}

async function capturePanoptoRuntimeLinks(
  context: BrowserContext,
  viewerUrl: string
): Promise<PanoptoRuntimeCaptureResult> {
  const page: Page = await context.newPage();
  const mediaUrls = new Set<string>();

  const rememberPossibleMediaUrl = (value: string | null | undefined): void => {
    if (!value) {
      return;
    }
    const lower = value.toLowerCase();
    if (
      lower.includes("download.cdn.") ||
      lower.includes("/generatesrt") ||
      isDirectVideoUrl(value) ||
      isSubtitleUrl(value)
    ) {
      mediaUrls.add(value);
    }
  };

  page.on("response", (response) => {
    rememberPossibleMediaUrl(response.url());
  });

  page.on("request", (request) => {
    rememberPossibleMediaUrl(request.url());
  });

  try {
    await page.goto(viewerUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);

    const downloadButton = page.locator("#podcastDownload");
    if (await downloadButton.count()) {
      try {
        await downloadButton.first().click({ timeout: 5000 });
        await page.waitForTimeout(3500);
      } catch {
        // best effort only
      }
    }

    let transcriptText: string | null = null;
    const transcriptTab = page.locator("#transcriptTabHeader");
    if (await transcriptTab.count()) {
      try {
        await transcriptTab.first().click({ timeout: 5000 });
        await page.waitForTimeout(1500);
        transcriptText = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll("#transcriptTabPane li.index-event"));
          const lines = items
            .map((item) => {
              const time = item.querySelector(".event-time")?.textContent?.trim() ?? "";
              const text =
                item.querySelector(".event-text")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
              if (!text) {
                return "";
              }
              return time ? `[${time}] ${text}` : text;
            })
            .filter(Boolean);
          return lines.length ? `${lines.join("\n")}\n` : null;
        });
      } catch {
        transcriptText = null;
      }
    }

    const htmlText = await page.content();
    for (const directUrl of extractPanoptoDirectMediaUrls(htmlText)) {
      mediaUrls.add(directUrl);
    }

    return {
      finalUrl: page.url(),
      htmlText,
      mediaUrls: [...mediaUrls],
      transcriptText
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

export async function enrichPanoptoResourceLinks(
  requestContext: APIRequestContext,
  resource: ResourceLink,
  panoptoRuntime: PanoptoCaptureRuntime | null
): Promise<ResourceLink[]> {
  const results: ResourceLink[] = [];
  if (!resource.url.toLowerCase().includes("panopto")) {
    return [resource];
  }

  const pages: Array<{ finalUrl: string; htmlText: string }> = [];
  const urlsToFetch = [resource.url];
  const seenFetchUrls = new Set<string>();

  for (const fetchUrl of urlsToFetch) {
    if (seenFetchUrls.has(fetchUrl)) {
      continue;
    }
    seenFetchUrls.add(fetchUrl);
    const response = await requestContext.get(fetchUrl, {
      timeout: 30000,
      failOnStatusCode: false
    });
    if (!response.ok()) {
      continue;
    }

    const contentType = (response.headers()["content-type"] ?? "").toLowerCase();
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      continue;
    }

    const finalUrl = response.url();
    const htmlText = await response.text();
    pages.push({ finalUrl, htmlText });

    const sessionId = extractPanoptoSessionId(finalUrl, htmlText);
    if (sessionId) {
      const viewerUrl = buildPanoptoViewerUrl(finalUrl, sessionId);
      if (!seenFetchUrls.has(viewerUrl)) {
        urlsToFetch.push(viewerUrl);
      }
    }
  }

  if (pages.length === 0) {
    return [resource];
  }

  let sessionId: string | null = null;
  let transcriptText: string | null = null;
  for (const page of pages) {
    sessionId = sessionId ?? extractPanoptoSessionId(page.finalUrl, page.htmlText);
    transcriptText = transcriptText ?? extractPanoptoTranscriptText(page.htmlText);
  }

  const referenceUrl = sessionId
    ? buildPanoptoViewerUrl(resource.url, sessionId)
    : pages[0]!.finalUrl;
  sessionId = sessionId ?? extractPanoptoSessionId(referenceUrl, "");
  results.push({
    ...resource,
    url: referenceUrl,
    resourceType: "video",
    delivery: "reference"
  });

  for (const page of pages) {
    for (const directUrl of extractPanoptoDirectMediaUrls(page.htmlText)) {
      results.push({
        ...resource,
        title: resource.title,
        url: directUrl,
        resourceType: "video",
        delivery: "download"
      });
    }
  }

  if (referenceUrl.toLowerCase().includes("/viewer.aspx")) {
    try {
      if (!panoptoRuntime) {
        throw new Error("Panopto runtime capture is unavailable.");
      }
      const runtime = await panoptoRuntime.capture(referenceUrl);
      sessionId = sessionId ?? extractPanoptoSessionId(runtime.finalUrl, runtime.htmlText);
      transcriptText =
        transcriptText ?? runtime.transcriptText ?? extractPanoptoTranscriptText(runtime.htmlText);
      for (const directUrl of runtime.mediaUrls) {
        const classification = classifyUrl(directUrl);
        if (!classification) {
          continue;
        }
        results.push({
          ...resource,
          title: resource.title,
          url: directUrl,
          resourceType: classification.resourceType,
          delivery: classification.delivery
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[panopto:fallback] ${resource.title} -> ${message}`);
    }
  }

  let cleanedResults = results;
  const hasDirectMp4 = cleanedResults.some(
    (item) =>
      item.resourceType === "video" &&
      item.delivery === "download" &&
      getPathExtension(item.url) === ".mp4"
  );
  if (hasDirectMp4) {
    cleanedResults = cleanedResults.filter(
      (item) =>
        !(
          item.resourceType === "video" &&
          item.delivery === "download" &&
          getPathExtension(item.url) === ".m3u8"
        )
    );
  }

  if (transcriptText) {
    cleanedResults = cleanedResults.filter(
      (item) => !(item.resourceType === "subtitle" && item.delivery === "download")
    );
    cleanedResults.push({
      ...resource,
      title: resource.title,
      url: referenceUrl,
      resourceType: "subtitle",
      delivery: "inline",
      inlineText: transcriptText,
      preferredExtension: ".srt"
    });
  }

  const seen = new Set<string>();
  const dedupedByUrl: ResourceLink[] = [];
  for (const link of cleanedResults) {
    const marker = [
      link.section,
      link.subsection,
      link.group,
      link.title,
      link.url,
      link.resourceType,
      link.delivery
    ].join("\u0000");
    if (seen.has(marker)) {
      continue;
    }
    seen.add(marker);
    dedupedByUrl.push(link);
  }
  return dedupePanoptoResources(dedupedByUrl);
}
