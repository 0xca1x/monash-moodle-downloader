import type { Command } from "commander";

import {
  DEFAULT_COURSE_URL,
  DOWNLOADS_DIR,
  downloadCourseAttachments,
  listCourseSections
} from "@monash-moodle-downloader/core";

import {
  readCourseUrlsFromFile,
  resolveRepoPath,
  type BatchCourseReportItem,
  writeBatchReports
} from "../utils.js";

async function runSingleCourseDownload(
  options: {
    courseUrl: string;
    downloadDir: string;
    maxDepth: string;
    scanOnly?: boolean;
  },
  commandName: "scan" | "download-files"
): Promise<void> {
  const maxDepth = Number.parseInt(options.maxDepth, 10);
  if (!Number.isFinite(maxDepth) || maxDepth < 0) {
    throw new Error(`Invalid --max-depth value: ${options.maxDepth}`);
  }
  const scanOnly = commandName === "scan" || options.scanOnly === true;
  const result = await downloadCourseAttachments({
    courseUrl: options.courseUrl,
    outputDir: resolveRepoPath(options.downloadDir),
    maxDepth,
    scanOnly
  });

  console.log(`${scanOnly ? "Scanned" : "Downloaded attachments for"} ${result.courseTitle}`);
  console.log(`Output: ${result.outputDir}`);
  console.log(`Report: ${result.reportPath ?? "not written (scan-only)"}`);
  console.log(`Sections: ${result.sectionCount}`);
  console.log(`Files: ${result.fileCount}`);
  console.log(`Downloaded: ${result.downloaded}`);
  console.log(`Updated: ${result.updated}`);
  console.log(`Skipped: ${result.skipped}`);
  console.log(`Failed: ${result.failed}`);
}

async function runBatchCourseDownload(
  options: {
    input: string;
    downloadDir: string;
    maxDepth: string;
    scanOnly?: boolean;
  },
  commandName: "scan-batch" | "download-batch"
): Promise<void> {
  const resolvedInputPath = resolveRepoPath(options.input);
  const downloadDir = resolveRepoPath(options.downloadDir);
  const maxDepth = Number.parseInt(options.maxDepth, 10);
  if (!Number.isFinite(maxDepth) || maxDepth < 0) {
    throw new Error(`Invalid --max-depth value: ${options.maxDepth}`);
  }
  const scanOnly = commandName === "scan-batch" || options.scanOnly === true;
  const courseUrls = await readCourseUrlsFromFile(resolvedInputPath);
  if (courseUrls.length === 0) {
    console.log(`No course URLs found in ${resolvedInputPath}`);
    return;
  }

  console.log(`[batch] input -> ${resolvedInputPath}`);
  console.log(`[batch] courses -> ${courseUrls.length}`);
  if (scanOnly) {
    console.log("[batch] mode -> scan-only");
  }

  let successCount = 0;
  let failureCount = 0;
  const batchCourses: BatchCourseReportItem[] = [];

  for (const [courseIndex, courseUrl] of courseUrls.entries()) {
    console.log(
      `[batch] ${(courseIndex + 1).toString().padStart(2, "0")}/${courseUrls.length.toString().padStart(2, "0")} start ${courseUrl}`
    );
    try {
      const result = await downloadCourseAttachments({
        courseUrl,
        outputDir: downloadDir,
        maxDepth,
        scanOnly
      });
      successCount += 1;
      batchCourses.push({
        courseUrl,
        status: "ok",
        courseTitle: result.courseTitle,
        courseCode: result.courseCode,
        outputDir: result.outputDir,
        reportPath: result.reportPath,
        sectionCount: result.sectionCount,
        sections: result.sections,
        fileCount: result.fileCount,
        downloaded: result.downloaded,
        updated: result.updated,
        skipped: result.skipped,
        failed: result.failed
      });
      console.log(
        `[batch:OK] ${result.courseTitle} files=${result.fileCount} downloaded=${result.downloaded} updated=${result.updated} skipped=${result.skipped} failed=${result.failed}`
      );
    } catch (error) {
      failureCount += 1;
      const message = error instanceof Error ? error.message : String(error);
      batchCourses.push({
        courseUrl,
        status: "failed",
        error: message
      });
      console.log(`[batch:FAILED] ${courseUrl} -> ${message}`);
    }
  }

  console.log(`[batch] finished success=${successCount} failed=${failureCount}`);
  if (!scanOnly) {
    const batchReport = await writeBatchReports(downloadDir, batchCourses);
    console.log(`[batch] report json -> ${batchReport.jsonPath}`);
    console.log(`[batch] report md -> ${batchReport.markdownPath}`);
  } else {
    console.log("[batch] reports not written in scan-only mode");
  }

  if (failureCount > 0) {
    process.exitCode = 1;
  }
}

export function registerCourseCommands(program: Command): void {
  const course = program.command("course").description("Inspect and download course content");

  course
    .command("sections")
    .description("List all sections discovered on a course page")
    .option("--course-url <url>", "Course URL", DEFAULT_COURSE_URL)
    .action(async (options: { courseUrl: string }) => {
      const sections = await listCourseSections(options.courseUrl);
      if (sections.length === 0) {
        const pathname = new URL(options.courseUrl).pathname;
        if (pathname !== "/course/view.php") {
          console.log(`No sections found for ${options.courseUrl}`);
          console.log("Tip: pass a concrete Moodle course page, for example:");
          console.log(
            '  pnpm cli -- course sections --course-url "https://learning.monash.edu/course/view.php?id=0001"'
          );
          return;
        }
        console.log("No sections found.");
        return;
      }
      console.log(`Found ${sections.length} sections:`);
      for (const section of sections) {
        console.log(
          `${section.index.toString().padStart(2, "0")}. [section] ${section.title} depth=0 -> ${section.url}`
        );
        console.log(`    id=${section.sectionId}`);
      }
    });

  course
    .command("scan")
    .description("Scan a course or section without writing downloads or reports")
    .option("--course-url <url>", "Course or section URL", DEFAULT_COURSE_URL)
    .option("--download-dir <path>", "Download root used for path previews", DOWNLOADS_DIR)
    .option("--max-depth <n>", "Followable page crawl depth", "0")
    .action(async (options: { courseUrl: string; downloadDir: string; maxDepth: string }) => {
      await runSingleCourseDownload(options, "scan");
    });

  course
    .command("download-files")
    .description("Download files, video references, videos, and subtitles for a course or section")
    .option("--course-url <url>", "Course or section URL", DEFAULT_COURSE_URL)
    .option("--download-dir <path>", "Download root directory", DOWNLOADS_DIR)
    .option("--max-depth <n>", "Followable page crawl depth", "0")
    .option("--scan-only", "Scan only without writing downloads or reports", false)
    .action(
      async (options: {
        courseUrl: string;
        downloadDir: string;
        maxDepth: string;
        scanOnly: boolean;
      }) => {
        await runSingleCourseDownload(options, "download-files");
      }
    );

  course
    .command("scan-batch")
    .description("Scan multiple courses from a text file without writing downloads or reports")
    .requiredOption("--input <path>", "Text file containing one course URL per line")
    .option("--download-dir <path>", "Download root used for path previews", DOWNLOADS_DIR)
    .option("--max-depth <n>", "Followable page crawl depth", "0")
    .action(async (options: { input: string; downloadDir: string; maxDepth: string }) => {
      await runBatchCourseDownload(options, "scan-batch");
    });

  course
    .command("download-batch")
    .description("Download multiple courses from a text file")
    .requiredOption("--input <path>", "Text file containing one course URL per line")
    .option("--download-dir <path>", "Download root directory", DOWNLOADS_DIR)
    .option("--max-depth <n>", "Followable page crawl depth", "0")
    .option("--scan-only", "Scan only without writing downloads or reports", false)
    .action(
      async (options: {
        input: string;
        downloadDir: string;
        maxDepth: string;
        scanOnly: boolean;
      }) => {
        await runBatchCourseDownload(options, "download-batch");
      }
    );
}
