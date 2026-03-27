import fs from "node:fs";
import type { Browser, BrowserType } from "playwright";

const KNOWN_CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
];

function findLocalChromeExecutable(): string | null {
  for (const candidate of KNOWN_CHROME_PATHS) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function launchPreferredBrowser(
  chromium: BrowserType,
  headless: boolean
): Promise<Browser> {
  if (headless) {
    return await chromium.launch({ headless: true });
  }

  try {
    return await chromium.launch({ channel: "chrome", headless });
  } catch {
    const executablePath = findLocalChromeExecutable();
    if (executablePath) {
      return await chromium.launch({ executablePath, headless });
    }
    return await chromium.launch({ headless });
  }
}
