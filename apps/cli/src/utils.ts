import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";

import { REPO_ROOT } from "@monash-moodle-downloader/core";

export interface BatchCourseReportItem {
  courseUrl: string;
  status: "ok" | "failed";
  courseTitle?: string;
  courseCode?: string | null;
  outputDir?: string;
  reportPath?: string | null;
  sectionCount?: number;
  sections?: Array<{
    title: string;
    folderName: string;
    pageCount: number;
    fileCount: number;
    downloaded: number;
    updated: number;
    skipped: number;
    failed: number;
    skippedEmpty: boolean;
  }>;
  fileCount?: number;
  downloaded?: number;
  updated?: number;
  skipped?: number;
  failed?: number;
  error?: string;
}

export function resolveRepoPath(targetPath: string): string {
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(REPO_ROOT, targetPath);
}

export async function readCourseUrlsFromFile(inputPath: string): Promise<string[]> {
  const text = await fs.readFile(inputPath, "utf8");
  const urls = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  const uniqueUrls: string[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);
    uniqueUrls.push(url);
  }
  return uniqueUrls;
}

export async function writeBatchReports(
  downloadDir: string,
  courses: BatchCourseReportItem[]
): Promise<{ jsonPath: string; markdownPath: string }> {
  await fs.mkdir(downloadDir, { recursive: true });
  const jsonPath = path.join(downloadDir, "_batch-report.json");
  const markdownPath = path.join(downloadDir, "_batch-report.md");
  await fs.writeFile(
    jsonPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), courses }, null, 2)}\n`,
    "utf8"
  );

  const lines = ["# Batch Download Report", "", `Generated at: ${new Date().toISOString()}`, ""];
  for (const [index, item] of courses.entries()) {
    lines.push(
      `## ${(index + 1).toString().padStart(2, "0")} ${item.courseTitle ?? item.courseUrl}`
    );
    lines.push(`- Status: ${item.status.toUpperCase()}`);
    lines.push(`- URL: ${item.courseUrl}`);
    if (item.courseCode) {
      lines.push(`- Course code: ${item.courseCode}`);
    }
    if (item.outputDir) {
      lines.push(`- Output: ${item.outputDir}`);
    }
    if (item.reportPath) {
      lines.push(`- Course report: ${item.reportPath}`);
    }
    if (item.status === "ok") {
      lines.push(`- Sections: ${item.sectionCount ?? 0}`);
      lines.push(`- Files: ${item.fileCount ?? 0}`);
      lines.push(`- Downloaded: ${item.downloaded ?? 0}`);
      lines.push(`- Updated: ${item.updated ?? 0}`);
      lines.push(`- Skipped: ${item.skipped ?? 0}`);
      lines.push(`- Failed: ${item.failed ?? 0}`);
      if (item.sections?.length) {
        lines.push("- Section details:");
        for (const section of item.sections) {
          lines.push(
            `  - ${section.title} | folder=${section.folderName} | pages=${section.pageCount} | files=${section.fileCount} | downloaded=${section.downloaded} | updated=${section.updated} | skipped=${section.skipped} | failed=${section.failed}${section.skippedEmpty ? " | empty=true" : ""}`
          );
        }
      }
    } else if (item.error) {
      lines.push(`- Error: ${item.error}`);
    }
    lines.push("");
  }

  await fs.writeFile(markdownPath, `${lines.join("\n").trim()}\n`, "utf8");
  return { jsonPath, markdownPath };
}

export async function confirmLogout(skipPrompt: boolean): Promise<boolean> {
  if (skipPrompt || !process.stdin.isTTY) {
    return true;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("Delete local Node session files? [y/N] ");
    return ["y", "yes"].includes(answer.trim().toLowerCase());
  } finally {
    rl.close();
  }
}
