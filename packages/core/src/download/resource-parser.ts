import path from "node:path";

import { load, type CheerioAPI } from "cheerio";
import type { ResourceLink } from "@monash-moodle-downloader/shared";

export interface SectionPage {
  title: string;
  url: string;
  depth: number;
}

const DOWNLOADABLE_EXTENSIONS = [
  ".pdf",
  ".ppt",
  ".pptx",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".zip",
  ".rar",
  ".txt",
  ".csv",
  ".vtt",
  ".srt",
  ".m4a",
  ".mov",
  ".webm",
  ".m3u8",
  ".mp4",
  ".mp3"
];

const SUBTITLE_EXTENSIONS = [".vtt", ".srt"];
const DIRECT_VIDEO_EXTENSIONS = [".mp4", ".m4a", ".mov", ".webm", ".m3u8", ".mp3"];
const KNOWN_VIDEO_HOST_PATTERNS = [
  "panopto",
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "echo360",
  "mediacore",
  "media.monash",
  "edstem",
  "kaltura"
];

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function slugify(text: string, maxLength = 80): string {
  const value = normalizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const result = value.slice(0, maxLength).replace(/-+$/g, "");
  return result || "item";
}

export function safeFsName(text: string, fallback = "item", maxLength = 120): string {
  const value = normalizeText(text)
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\.+$/g, "")
    .trim();
  const result = value.slice(0, maxLength).trim();
  return result || fallback;
}

export function normalizeUrl(url: string, baseUrl: string): string {
  if (!url) {
    return "";
  }
  return new URL(url.replace(/&amp;/gi, "&").trim(), baseUrl).toString();
}

export function getSectionLabelFromUrl(url: string): string | null {
  return new URL(url).searchParams.get("section");
}

export function extractCourseCode(courseTitle: string): string | null {
  const match = /\b([A-Z]{3,}\d{4,})\b/.exec(courseTitle.toUpperCase());
  return match?.[1] ?? null;
}

export function extractCourseTitle(htmlText: string, fallback: string): string {
  const $ = load(htmlText);
  for (const selector of ["header .page-context-header h1", "title"]) {
    const text = normalizeText($(selector).first().text());
    if (text) {
      return text;
    }
  }
  return fallback;
}

export function extractPageHeading(htmlText: string, fallback: string): string {
  const $ = load(htmlText);
  for (const selector of [
    "div.breadcrumb li.breadcrumb-item:last-child span",
    "li.section.main h1.sectionname",
    "li.section.main h1.sectionname a",
    "title"
  ]) {
    const text = normalizeText($(selector).first().text());
    if (text) {
      return text;
    }
  }
  return fallback;
}

export function extractSectionFolderName(
  sectionTitle: string,
  sectionUrl: string,
  htmlText?: string
): string {
  const candidates: string[] = [];
  if (htmlText) {
    const $ = load(htmlText);
    for (const selector of [
      ".course-section-header h3",
      "div.breadcrumb li.breadcrumb-item:last-child span"
    ]) {
      const text = normalizeText($(selector).first().text());
      if (text) {
        candidates.push(text);
      }
    }
  }
  candidates.push(sectionTitle);

  for (const candidate of candidates) {
    const match = /\bweek\s*(\d+)\b/i.exec(candidate);
    if (match) {
      return `week_${Number(match[1]).toString().padStart(2, "0")}`;
    }
  }

  const sectionId = getSectionLabelFromUrl(sectionUrl);
  if (sectionId) {
    return `section_${Number(sectionId).toString().padStart(2, "0")}`;
  }
  return slugify(sectionTitle, 24);
}

function isActivityLink(url: string): boolean {
  const pathname = new URL(url).pathname.toLowerCase();
  return [
    "/mod/",
    "/pluginfile.php",
    "/mod/resource/",
    "/mod/url/",
    "/mod/folder/",
    "/mod/page/",
    "/mod/book/",
    "/mod/quiz/",
    "/mod/assign/",
    "/mod/forum/",
    "/course/view.php"
  ].some((token) => pathname.includes(token));
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

function isKnownVideoProviderUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return KNOWN_VIDEO_HOST_PATTERNS.some((pattern) => lower.includes(pattern));
}

function isFollowableCoursePage(url: string, baseNetloc: string): boolean {
  const target = new URL(url);
  if (!["http:", "https:"].includes(target.protocol)) {
    return false;
  }
  if (target.host !== baseNetloc) {
    return false;
  }

  const pathname = target.pathname.toLowerCase();
  return [
    "/course/view.php",
    "/mod/page/view.php",
    "/mod/book/view.php",
    "/mod/folder/view.php",
    "/mod/forum/view.php",
    "/mod/forum/discuss.php"
  ].some((token) => pathname.includes(token));
}

export { isDirectVideoUrl, isSubtitleUrl };

export function isDownloadableResource(url: string): boolean {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.includes("pluginfile.php") || pathname.includes("/mod/resource/view.php")) {
    return true;
  }
  return DOWNLOADABLE_EXTENSIONS.some((extension) => pathname.endsWith(extension));
}

function classifyUrl(url: string): Pick<ResourceLink, "resourceType" | "delivery"> | null {
  if (isSubtitleUrl(url)) {
    return { resourceType: "subtitle", delivery: "download" };
  }
  if (isDirectVideoUrl(url)) {
    return { resourceType: "video", delivery: "download" };
  }
  if (isDownloadableResource(url)) {
    return { resourceType: "file", delivery: "download" };
  }
  if (isKnownVideoProviderUrl(url)) {
    return { resourceType: "video", delivery: "reference" };
  }
  return null;
}

export function dedupeLinks(links: ResourceLink[]): ResourceLink[] {
  const seen = new Set<string>();
  const results: ResourceLink[] = [];
  for (const link of links) {
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
    results.push(link);
  }
  return results;
}

export function extractNavigationSections(htmlText: string, baseUrl: string): SectionPage[] {
  const $ = load(htmlText);
  const nav = $("#mst-navigation").first();
  if (!nav.length) {
    return [];
  }

  const anchors = nav.find("li.hasdropdown .second-level-nav a[href]").length
    ? nav.find("li.hasdropdown .second-level-nav a[href]")
    : nav.find("a[href]");

  const seen = new Set<string>();
  const results: SectionPage[] = [];
  anchors.each((_, element) => {
    const href = normalizeUrl($(element).attr("href") ?? "", baseUrl);
    const title = normalizeText($(element).text()) || normalizeText($(element).attr("title") ?? "");
    const sectionId = href ? getSectionLabelFromUrl(href) : null;
    if (!href || !title || !sectionId || seen.has(href)) {
      return;
    }
    seen.add(href);
    results.push({ title, url: href, depth: 0 });
  });
  return results;
}

function extractSectionTitle(htmlText: string, fallback: string): string {
  const $ = load(htmlText);
  for (const selector of [
    "#mst-navigation a.currentsection",
    "li.section.main h1.sectionname a",
    "li.section.main h1.sectionname",
    "header .page-context-header h1"
  ]) {
    const text = normalizeText($(selector).first().text());
    if (text) {
      return text;
    }
  }
  return fallback;
}

function extractSubsectionTitle(
  $: CheerioAPI,
  subsectionNode: Parameters<CheerioAPI["html"]>[0]
): string {
  const subsection = $(subsectionNode);
  for (const selector of [
    ".course-section-header h3",
    ".course-section-header h2",
    ".course-section-header h1"
  ]) {
    const text = normalizeText(subsection.find(selector).first().text());
    if (text) {
      return text;
    }
  }
  return "General";
}

function extractGroupTitle(
  $: CheerioAPI,
  activityNode: Parameters<CheerioAPI["html"]>[0]
): string | null {
  const activity = $(activityNode);
  const classAttr = activity.attr("class") ?? "";
  if (!classAttr.includes("modtype_label") && !classAttr.includes("modtype_cms")) {
    return null;
  }
  for (const selector of [
    ".activity-altcontent h3",
    ".activity-altcontent h2",
    ".activity-altcontent strong"
  ]) {
    const nodes = activity.find(selector).toArray();
    for (const node of nodes) {
      const text = normalizeText($(node).text());
      if (text) {
        return text;
      }
    }
  }
  return null;
}

function extractActivityTitle(
  $: CheerioAPI,
  activityNode: Parameters<CheerioAPI["html"]>[0],
  fallback: string
): string {
  const activity = $(activityNode);
  const candidates = [
    activity.attr("data-activityname") ?? "",
    activity.find(".instancename").first().text(),
    activity.find("a[href]").first().text(),
    activity.find("h3, h2, strong").first().text()
  ];

  for (const candidate of candidates) {
    const text = normalizeText(candidate);
    if (text) {
      return text;
    }
  }
  return fallback;
}

function extractLinksFromActivityNodes(
  $: CheerioAPI,
  sectionTitle: string,
  subsectionTitle: string,
  activityNodes: Array<Parameters<CheerioAPI["html"]>[0]>,
  baseUrl: string
): ResourceLink[] {
  const results: ResourceLink[] = [];
  const seen = new Set<string>();
  let currentGroup = "Ungrouped";

  const addResource = (resource: ResourceLink): void => {
    const key = [
      resource.resourceType,
      resource.delivery,
      resource.group,
      resource.title,
      resource.url
    ].join("\u0000");
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    results.push(resource);
  };

  for (const activityNode of activityNodes) {
    const groupTitle = extractGroupTitle($, activityNode);
    if (groupTitle) {
      currentGroup = groupTitle;
    }

    const activity = $(activityNode);
    const activityTitle = extractActivityTitle($, activityNode, `${subsectionTitle} resource`);

    activity.find("a[href]").each((_, anchor) => {
      const href = normalizeUrl($(anchor).attr("href") ?? "", baseUrl);
      const title = normalizeText($(anchor).text()) || normalizeText($(anchor).attr("title") ?? "");
      if (!href || !title) {
        return;
      }
      if (href.startsWith("javascript:") || href.startsWith("mailto:")) {
        return;
      }
      if (href.includes("#section-") && href.includes("/course/view.php")) {
        return;
      }
      const classification = classifyUrl(href);
      if (!classification && !isActivityLink(href)) {
        return;
      }

      addResource({
        section: sectionTitle,
        subsection: subsectionTitle,
        group: currentGroup,
        title,
        url: href,
        resourceType: classification?.resourceType ?? "file",
        delivery: classification?.delivery ?? "download"
      });
    });

    activity.find("iframe[src]").each((index, iframe) => {
      const src = normalizeUrl($(iframe).attr("src") ?? "", baseUrl);
      const classification = src ? classifyUrl(src) : null;
      if (!src || !classification || classification.resourceType !== "video") {
        return;
      }
      addResource({
        section: sectionTitle,
        subsection: subsectionTitle,
        group: currentGroup,
        title: `${activityTitle}${index > 0 ? ` video ${index + 1}` : ""}`,
        url: src,
        resourceType: classification.resourceType,
        delivery: classification.delivery
      });
    });

    activity.find("video, audio").each((index, media) => {
      const mediaElement = $(media);
      const mediaSources = new Set<string>();
      const directSrc = normalizeUrl(mediaElement.attr("src") ?? "", baseUrl);
      if (directSrc) {
        mediaSources.add(directSrc);
      }
      mediaElement.find("source[src]").each((_, source) => {
        const src = normalizeUrl($(source).attr("src") ?? "", baseUrl);
        if (src) {
          mediaSources.add(src);
        }
      });

      for (const src of mediaSources) {
        const classification = classifyUrl(src);
        if (!classification || classification.resourceType !== "video") {
          continue;
        }
        addResource({
          section: sectionTitle,
          subsection: subsectionTitle,
          group: currentGroup,
          title: `${activityTitle}${index > 0 ? ` media ${index + 1}` : ""}`,
          url: src,
          resourceType: classification.resourceType,
          delivery: classification.delivery
        });
      }

      mediaElement.find("track[src]").each((trackIndex, track) => {
        const src = normalizeUrl($(track).attr("src") ?? "", baseUrl);
        const classification = src ? classifyUrl(src) : null;
        if (!src || !classification || classification.resourceType !== "subtitle") {
          return;
        }
        const label = normalizeText($(track).attr("label") ?? "") || `subtitle ${trackIndex + 1}`;
        addResource({
          section: sectionTitle,
          subsection: subsectionTitle,
          group: currentGroup,
          title: `${activityTitle} ${label}`,
          url: src,
          resourceType: "subtitle",
          delivery: classification.delivery
        });
      });
    });
  }

  return results;
}

export function extractFollowableLinksFromHtml(
  htmlText: string,
  pageUrl: string,
  fallbackSection: string
): SectionPage[] {
  const page = new URL(pageUrl);
  const baseUrl = `${page.protocol}//${page.host}`;
  const $ = load(htmlText);
  const seen = new Set<string>();
  const results: SectionPage[] = [];

  $("a[href]").each((_, anchor) => {
    const href = normalizeUrl($(anchor).attr("href") ?? "", baseUrl);
    if (!href || !isFollowableCoursePage(href, page.host)) {
      return;
    }
    if (href.includes("#section-") && href.includes("/course/view.php")) {
      return;
    }
    if (href === pageUrl || seen.has(href)) {
      return;
    }
    seen.add(href);
    results.push({ title: fallbackSection, url: href, depth: 0 });
  });

  return results;
}

export function extractResourceLinksFromHtml(
  htmlText: string,
  pageUrl: string,
  fallbackSection: string
): ResourceLink[] {
  const $ = load(htmlText);
  const baseUrl = `${new URL(pageUrl).protocol}//${new URL(pageUrl).host}`;
  const sectionTitle = extractSectionTitle(htmlText, fallbackSection);
  const collected: ResourceLink[] = [];
  const primaryContentRoot = $(
    "div.course-content, div[id$='-course-format'], #region-main"
  ).first();
  const subsectionNodes = primaryContentRoot.length
    ? primaryContentRoot.find("ul.mst-level-1 > li.section")
    : $.root().find("ul.mst-level-1 > li.section");

  if (subsectionNodes.length) {
    subsectionNodes.each((_, subsectionNode) => {
      const subsectionTitle = extractSubsectionTitle($, subsectionNode);
      const subsection = $(subsectionNode);
      const activityNodeCollection = subsection.find("div.content > ul.section > li.activity")
        .length
        ? subsection.find("div.content > ul.section > li.activity")
        : subsection.find("ul.section > li.activity");
      collected.push(
        ...extractLinksFromActivityNodes(
          $,
          sectionTitle,
          subsectionTitle,
          activityNodeCollection.toArray(),
          baseUrl
        )
      );
    });
  } else {
    const directActivityNodes = primaryContentRoot.length
      ? primaryContentRoot.find("ul.section > li.activity")
      : $.root().find("ul.section > li.activity");
    const activityNodes = directActivityNodes.length
      ? directActivityNodes
      : primaryContentRoot.length
        ? primaryContentRoot.find("li.activity, li.activity-wrapper, li[id^='module-']")
        : $.root().find("li.activity, li.activity-wrapper, li[id^='module-']");
    collected.push(
      ...extractLinksFromActivityNodes($, sectionTitle, "General", activityNodes.toArray(), baseUrl)
    );
  }

  return dedupeLinks(collected);
}
