import fs from "node:fs/promises";
import path from "node:path";

import type { DownloadedFile, ResourceLink } from "@monash-moodle-downloader/shared";

import { loadSession, type SessionPayload } from "../auth/session-store.js";
import { DEFAULT_COURSE_URL, DOWNLOADS_DIR } from "../config.js";
import {
  downloadResource,
  saveInlineTextFile,
  saveReferenceFile,
  writeCourseDownloadReport
} from "./download-storage.js";
import {
  createPanoptoCaptureRuntime,
  dedupeEquivalentPanoptoLinks,
  dropRedundantPanoptoPlaylistLinks,
  enrichPanoptoResourceLinks,
  formatTranscriptTextAsSrt
} from "./panopto.js";
import {
  crawlSectionPages,
  createAuthenticatedRequestContext,
  fetchHtml
} from "./section-crawler.js";
import {
  dedupeLinks,
  extractCourseCode,
  extractCourseTitle,
  extractNavigationSections,
  extractPageHeading,
  extractResourceLinksFromHtml,
  extractSectionFolderName,
  getSectionLabelFromUrl,
  isDirectVideoUrl,
  isDownloadableResource,
  isSubtitleUrl,
  safeFsName,
  slugify
} from "./resource-parser.js";

export interface DownloadCourseAttachmentsOptions {
  courseUrl?: string;
  outputDir?: string;
  maxDepth?: number;
  scanOnly?: boolean;
}

export interface DownloadSectionSummary {
  title: string;
  folderName: string;
  pageCount: number;
  fileCount: number;
  downloaded: number;
  updated: number;
  skipped: number;
  failed: number;
  skippedEmpty: boolean;
}

export interface DownloadCourseAttachmentsResult {
  courseTitle: string;
  courseCode: string | null;
  outputDir: string;
  reportPath: string | null;
  sectionCount: number;
  fileCount: number;
  downloaded: number;
  updated: number;
  skipped: number;
  failed: number;
  sections: DownloadSectionSummary[];
  files: DownloadedFile[];
}

function assertSessionPayload(payload: SessionPayload | null): SessionPayload {
  if (!payload) {
    throw new Error("No saved session found. Run `pnpm cli -- auth login` first.");
  }
  return payload;
}

export async function downloadCourseAttachments({
  courseUrl = DEFAULT_COURSE_URL,
  outputDir = DOWNLOADS_DIR,
  maxDepth = 0,
  scanOnly = false
}: DownloadCourseAttachmentsOptions = {}): Promise<DownloadCourseAttachmentsResult> {
  const stored = loadSession();
  const payload = assertSessionPayload(stored?.payload ?? null);
  if (!payload.storageState) {
    throw new Error("Saved session is missing Playwright storage state.");
  }
  const requestContext = await createAuthenticatedRequestContext();
  const panoptoRuntime = createPanoptoCaptureRuntime(payload.storageState);
  try {
    const parsedCourseUrl = new URL(courseUrl);
    const baseUrl = `${parsedCourseUrl.protocol}//${parsedCourseUrl.host}`;
    console.log(`[course] loading ${courseUrl}`);
    const { finalUrl: landingUrl, htmlText: landingHtml } = await fetchHtml(
      requestContext,
      courseUrl
    );

    const courseTitle = extractCourseTitle(landingHtml, `course-${parsedCourseUrl.pathname}`);
    const courseCode = extractCourseCode(courseTitle);
    const courseDir = path.resolve(outputDir, courseCode ?? slugify(courseTitle));

    let sections = extractNavigationSections(landingHtml, baseUrl);
    const requestedSectionId = getSectionLabelFromUrl(courseUrl);
    if (requestedSectionId) {
      const directTitle = extractPageHeading(landingHtml, `Section ${requestedSectionId}`);
      sections = [{ title: directTitle, url: landingUrl, depth: 0 }];
    }

    console.log(`[course] ${courseTitle}`);
    console.log(`[course] output -> ${courseDir}`);
    if (scanOnly) {
      console.log("[course] mode -> scan-only");
    }
    console.log(`[course] sections -> ${sections.length}`);
    for (const [sectionIndex, section] of sections.entries()) {
      console.log(
        `[section-list] ${(sectionIndex + 1).toString().padStart(2, "0")}. ${section.title} -> ${section.url}`
      );
    }

    const files: DownloadedFile[] = [];
    const sectionSummaries: DownloadSectionSummary[] = [];
    const counters = {
      downloaded: 0,
      updated: 0,
      skipped: 0,
      failed: 0
    };

    for (const [sectionIndex, section] of sections.entries()) {
      console.log(
        `[section] ${(sectionIndex + 1).toString().padStart(2, "0")}/${sections.length.toString().padStart(2, "0")} start ${section.title}`
      );
      const crawledPages = await crawlSectionPages(requestContext, section, courseUrl, maxDepth);
      const firstPageHtml = crawledPages[0]?.htmlText;
      const sectionFolderName = extractSectionFolderName(section.title, section.url, firstPageHtml);
      const sectionCounters = {
        downloaded: 0,
        updated: 0,
        skipped: 0,
        failed: 0
      };

      let links: ResourceLink[] = [];
      for (const page of crawledPages) {
        links = links.concat(extractResourceLinksFromHtml(page.htmlText, page.url, page.title));
      }
      const enrichedLinks: ResourceLink[] = [];
      for (const link of dedupeLinks(links)) {
        const extraLinks = await enrichPanoptoResourceLinks(requestContext, link, panoptoRuntime);
        enrichedLinks.push(...extraLinks);
      }
      links = dropRedundantPanoptoPlaylistLinks(
        dedupeEquivalentPanoptoLinks(dedupeLinks(enrichedLinks))
      ).filter(
        (link) =>
          link.delivery === "reference" ||
          link.delivery === "inline" ||
          link.resourceType === "subtitle" ||
          isDownloadableResource(link.url) ||
          isSubtitleUrl(link.url) ||
          isDirectVideoUrl(link.url)
      );
      console.log(
        `[section] ${(sectionIndex + 1).toString().padStart(2, "0")} pages=${crawledPages.length} files=${links.length} folder=${sectionFolderName}`
      );
      if (links.length === 0) {
        console.log(
          `[section:SKIP] ${(sectionIndex + 1).toString().padStart(2, "0")} no downloadable files`
        );
        sectionSummaries.push({
          title: section.title,
          folderName: sectionFolderName,
          pageCount: crawledPages.length,
          fileCount: 0,
          downloaded: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          skippedEmpty: true
        });
        continue;
      }

      const sectionDir = path.join(courseDir, sectionFolderName);
      const filesDir = path.join(sectionDir, "files");
      if (!scanOnly) {
        await fs.mkdir(courseDir, { recursive: true });
        await fs.mkdir(filesDir, { recursive: true });
      }

      let currentSubsection: string | null = null;
      let currentGroup: string | null = null;
      const groupCounters = new Map<string, number>();
      const subsectionCounters = new Map<string, number>();
      const subsectionOrder = new Map<string, number>();
      const groupOrder = new Map<string, number>();
      const subsectionGroupSet = new Map<string, Set<string>>();
      const pairedVideoBaseNames = new Map<string, string>();
      let nextSubsectionOrder = 1;

      for (const resource of links) {
        const groupSet = subsectionGroupSet.get(resource.subsection) ?? new Set<string>();
        groupSet.add(resource.group);
        subsectionGroupSet.set(resource.subsection, groupSet);
      }

      for (const [fileIndex, resource] of links.entries()) {
        if (resource.subsection !== currentSubsection) {
          if (!subsectionOrder.has(resource.subsection)) {
            subsectionOrder.set(resource.subsection, nextSubsectionOrder);
            nextSubsectionOrder += 1;
          }
          currentSubsection = resource.subsection;
          currentGroup = null;
        }

        if (resource.group !== currentGroup) {
          const groupKey = `${resource.subsection}\u0000${resource.group}`;
          const nextGroupIndex = (subsectionCounters.get(resource.subsection) ?? 0) + 1;
          if (!groupOrder.has(groupKey)) {
            groupOrder.set(groupKey, nextGroupIndex);
            subsectionCounters.set(resource.subsection, nextGroupIndex);
          }
          currentGroup = resource.group;
        }

        const subsectionIndex = subsectionOrder.get(resource.subsection)!;
        const groupKey = `${resource.subsection}\u0000${resource.group}`;
        const groupIndex = groupOrder.get(groupKey)!;
        const subsectionDir = path.join(
          filesDir,
          `${subsectionIndex.toString().padStart(2, "0")}_${safeFsName(resource.subsection, "General")}`
        );
        const subgroupSet = subsectionGroupSet.get(resource.subsection) ?? new Set<string>();
        const useGroupDir = subgroupSet.size > 1;
        const groupDir = useGroupDir
          ? path.join(
              subsectionDir,
              `${groupIndex.toString().padStart(2, "0")}_${safeFsName(resource.group, "Ungrouped")}`
            )
          : subsectionDir;
        const nextIndex = (groupCounters.get(groupKey) ?? 0) + 1;
        groupCounters.set(groupKey, nextIndex);
        const pairKey = [resource.subsection, resource.group, resource.title].join("\u0000");

        console.log(
          `[file] ${(sectionIndex + 1).toString().padStart(2, "0")}.${(fileIndex + 1).toString().padStart(2, "0")} [${resource.resourceType}/${resource.delivery}] ${resource.subsection} / ${resource.group} -> ${resource.title}`
        );
        const result = scanOnly
          ? {
              status: "skipped" as const,
              filename:
                resource.delivery === "reference"
                  ? `${nextIndex.toString().padStart(2, "0")}_${safeFsName(resource.title, slugify(resource.title, 60))}${resource.resourceType === "subtitle" ? ".subtitle.url.txt" : ".video.url.txt"}`
                  : undefined,
              reason: "scan_only"
            }
          : resource.delivery === "reference"
            ? await saveReferenceFile(
                resource.url,
                resource.title,
                groupDir,
                resource.resourceType,
                nextIndex
              )
            : resource.delivery === "inline"
              ? await saveInlineTextFile(
                  resource.preferredExtension === ".srt"
                    ? formatTranscriptTextAsSrt(resource.inlineText ?? "")
                    : (resource.inlineText ?? ""),
                  resource.title,
                  groupDir,
                  resource.resourceType,
                  nextIndex,
                  resource.preferredExtension,
                  pairedVideoBaseNames.has(pairKey)
                    ? `${pairedVideoBaseNames.get(pairKey)!}${resource.preferredExtension ?? ".txt"}`
                    : undefined
                )
              : await downloadResource(
                  requestContext,
                  resource.url,
                  resource.title,
                  groupDir,
                  nextIndex,
                  resource.resourceType
                );
        if (
          resource.resourceType === "video" &&
          resource.delivery === "download" &&
          result.filename
        ) {
          pairedVideoBaseNames.set(pairKey, path.parse(result.filename).name);
        }
        counters[result.status] += 1;
        sectionCounters[result.status] += 1;
        const statusLabel = result.status.toUpperCase();
        const relativePath = scanOnly
          ? path
              .relative(
                courseDir,
                path.join(
                  groupDir,
                  result.filename ?? safeFsName(resource.title, slugify(resource.title, 60))
                )
              )
              .split(path.sep)
              .join("/")
          : result.absolutePath
            ? path.relative(courseDir, result.absolutePath).split(path.sep).join("/")
            : "";
        console.log(
          `[file:${statusLabel}] ${result.filename ?? resource.title}${relativePath ? ` -> ${relativePath}` : ""}${result.reason ? ` [reason=${result.reason}]` : ""}`
        );
        files.push({
          section: resource.section,
          subsection: resource.subsection,
          group: resource.group,
          title: resource.title,
          url: resource.url,
          relativePath,
          resourceType: resource.resourceType,
          delivery: resource.delivery,
          status: result.status,
          reason: result.reason
        });
      }

      sectionSummaries.push({
        title: section.title,
        folderName: sectionFolderName,
        pageCount: crawledPages.length,
        fileCount: links.length,
        downloaded: sectionCounters.downloaded,
        updated: sectionCounters.updated,
        skipped: sectionCounters.skipped,
        failed: sectionCounters.failed,
        skippedEmpty: false
      });
    }

    const resultWithoutReportPath = {
      courseTitle,
      courseCode,
      outputDir: courseDir,
      sectionCount: sections.length,
      fileCount: files.length,
      downloaded: counters.downloaded,
      updated: counters.updated,
      skipped: counters.skipped,
      failed: counters.failed,
      sections: sectionSummaries,
      files
    } satisfies Omit<DownloadCourseAttachmentsResult, "reportPath">;
    const reportPath = scanOnly
      ? null
      : await writeCourseDownloadReport(courseDir, resultWithoutReportPath);

    return {
      ...resultWithoutReportPath,
      reportPath
    };
  } finally {
    await panoptoRuntime.close();
    await requestContext.dispose();
  }
}
