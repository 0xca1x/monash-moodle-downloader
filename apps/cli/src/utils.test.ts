import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readCourseUrlsFromFile, writeBatchReports } from "./utils.js";

describe("cli utils", () => {
  it("reads course URLs and removes duplicates/comments", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mmd-utils-"));
    const inputPath = path.join(tempDir, "courses.txt");
    await fs.writeFile(
      inputPath,
      [
        "# comment",
        "",
        "https://learning.monash.edu/course/view.php?id=0001",
        "https://learning.monash.edu/course/view.php?id=0001",
        "https://learning.monash.edu/course/view.php?id=0002"
      ].join("\n"),
      "utf8"
    );

    await expect(readCourseUrlsFromFile(inputPath)).resolves.toEqual([
      "https://learning.monash.edu/course/view.php?id=0001",
      "https://learning.monash.edu/course/view.php?id=0002"
    ]);
  });

  it("writes json and markdown batch reports", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mmd-report-"));
    const result = await writeBatchReports(tempDir, [
      {
        courseUrl: "https://learning.monash.edu/course/view.php?id=0001",
        status: "ok",
        courseTitle: "FIT5047 Example",
        fileCount: 3,
        downloaded: 1,
        updated: 1,
        skipped: 1,
        failed: 0
      }
    ]);

    const [jsonText, markdownText] = await Promise.all([
      fs.readFile(result.jsonPath, "utf8"),
      fs.readFile(result.markdownPath, "utf8")
    ]);

    expect(jsonText).toContain('"courseTitle": "FIT5047 Example"');
    expect(markdownText).toContain("# Batch Download Report");
    expect(markdownText).toContain("FIT5047 Example");
  });
});
