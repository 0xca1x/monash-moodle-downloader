import type { APIRequestContext, BrowserContextOptions } from "playwright";
import type { CourseSection } from "@monash-moodle-downloader/shared";
import { loadSession, type SessionPayload } from "../auth/session-store.js";
import { DEFAULT_COURSE_URL } from "../config.js";

interface PlaywrightModule {
  request: {
    newContext(options?: BrowserContextOptions): Promise<APIRequestContext>;
  };
}

const NAV_BLOCK_PATTERN = /<ul id="mst-navigation".*?<\/ul>\s*<\/li>/is;
const LEARNING_LINK_PATTERN = /<a[^>]+href="([^"]*section=\d+[^"]*)"[^>]*title="([^"]+)"/gi;

async function importPlaywright(): Promise<PlaywrightModule> {
  try {
    return (await import("playwright")) as unknown as PlaywrightModule;
  } catch {
    throw new Error("Playwright is not installed for the Node CLI.");
  }
}

function normalizeSectionUrl(baseUrl: string, href: string): string {
  const value = href.trim().replace(/&amp;/gi, "&");
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  if (value.startsWith("/")) {
    return `${baseUrl}${value}`;
  }
  return `${baseUrl}/${value.replace(/^\/+/, "")}`;
}

function extractSectionsFast(htmlText: string, baseUrl: string): CourseSection[] {
  const navMatch = NAV_BLOCK_PATTERN.exec(htmlText);
  if (!navMatch) {
    return [];
  }

  const seen = new Set<string>();
  const sections: CourseSection[] = [];
  let match: RegExpExecArray | null;
  let index = 1;
  while ((match = LEARNING_LINK_PATTERN.exec(navMatch[0])) !== null) {
    const url = normalizeSectionUrl(baseUrl, match[1]);
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);
    const sectionIdMatch = /[?&]section=(\d+)/i.exec(url);
    sections.push({
      index,
      title: match[2].trim(),
      url,
      sectionId: sectionIdMatch?.[1] ?? "?"
    });
    index += 1;
  }
  return sections;
}

function isProbablyLoggedOut(currentUrl: string): boolean {
  const value = currentUrl.toLowerCase();
  return (
    value.includes("login") || value.includes("signin") || value.includes("accounts.google.com")
  );
}

function assertSessionPayload(payload: SessionPayload | null): SessionPayload {
  if (!payload) {
    throw new Error("No saved session found. Run `pnpm cli -- auth login` first.");
  }
  return payload;
}

export async function listCourseSections(
  courseUrl: string = DEFAULT_COURSE_URL
): Promise<CourseSection[]> {
  const stored = loadSession();
  const payload = assertSessionPayload(stored?.payload ?? null);
  const storageState = payload.storageState;
  if (!storageState) {
    throw new Error("Saved session is missing Playwright storage state.");
  }

  const target = new URL(courseUrl);
  const baseUrl = `${target.protocol}//${target.host}`;
  const { request } = await importPlaywright();
  const requestContext = await request.newContext({ storageState });

  try {
    const response = await requestContext.get(courseUrl, {
      timeout: 30000,
      failOnStatusCode: false
    });
    const finalUrl = response.url();
    if (isProbablyLoggedOut(finalUrl)) {
      throw new Error("Saved session no longer appears to be authenticated. Run login again.");
    }
    if (!response.ok()) {
      throw new Error(
        `Failed to load course page. HTTP ${response.status()} ${response.statusText()}`
      );
    }
    const htmlText = await response.text();
    return extractSectionsFast(htmlText, baseUrl);
  } finally {
    await requestContext.dispose();
  }
}
