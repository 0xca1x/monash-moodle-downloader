import type { APIRequestContext, BrowserType, BrowserContextOptions } from "playwright";

import { loadSession, type SessionPayload } from "../auth/session-store.js";
import { extractFollowableLinksFromHtml, type SectionPage } from "./resource-parser.js";

interface PlaywrightModule {
  chromium: BrowserType;
  request: {
    newContext(options?: BrowserContextOptions): Promise<APIRequestContext>;
  };
}

function assertSessionPayload(payload: SessionPayload | null): SessionPayload {
  if (!payload) {
    throw new Error("No saved session found. Run `pnpm cli -- auth login` first.");
  }
  return payload;
}

async function importPlaywright(): Promise<PlaywrightModule> {
  try {
    return (await import("playwright")) as unknown as PlaywrightModule;
  } catch {
    throw new Error("Playwright is not installed for the Node CLI.");
  }
}

function getSectionLabelFromUrl(url: string): string | null {
  return new URL(url).searchParams.get("section");
}

function isProbablyLoggedOut(currentUrl: string, originalUrl: string): boolean {
  const current = currentUrl.toLowerCase();
  return (
    ["login", "signin", "accounts.google.com"].some((flag) => current.includes(flag)) &&
    current !== originalUrl.toLowerCase()
  );
}

export async function createAuthenticatedRequestContext(): Promise<APIRequestContext> {
  const stored = loadSession();
  const payload = assertSessionPayload(stored?.payload ?? null);
  const storageState = payload.storageState;
  if (!storageState) {
    throw new Error("Saved session is missing Playwright storage state.");
  }
  const { request } = await importPlaywright();
  return request.newContext({
    storageState,
    extraHTTPHeaders: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    }
  });
}

export async function fetchHtml(
  requestContext: APIRequestContext,
  url: string
): Promise<{ finalUrl: string; htmlText: string }> {
  const response = await requestContext.get(url, { timeout: 30000, failOnStatusCode: false });
  const finalUrl = response.url();
  if (isProbablyLoggedOut(finalUrl, url)) {
    throw new Error("Saved session is no longer valid. Please run the login command again.");
  }
  if (!response.ok()) {
    throw new Error(`Failed to load page. HTTP ${response.status()} ${response.statusText()}`);
  }
  const contentType = (response.headers()["content-type"] ?? "").toLowerCase();
  if (
    contentType &&
    !contentType.includes("text/html") &&
    !contentType.includes("application/xhtml+xml")
  ) {
    throw new Error(`Expected HTML page but received content-type: ${contentType} (${finalUrl})`);
  }
  return { finalUrl, htmlText: await response.text() };
}

export async function crawlSectionPages(
  requestContext: APIRequestContext,
  section: SectionPage,
  courseUrl: string,
  maxDepth: number
): Promise<Array<{ title: string; url: string; htmlText: string }>> {
  const rootSectionId = getSectionLabelFromUrl(section.url);
  const queue: SectionPage[] = [{ title: section.title, url: section.url, depth: 0 }];
  const visited = new Set<string>();
  const pages: Array<{ title: string; url: string; htmlText: string }> = [];
  const baseNetloc = new URL(courseUrl).host;

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.url)) {
      continue;
    }
    visited.add(current.url);

    const { finalUrl, htmlText } = await fetchHtml(requestContext, current.url);
    pages.push({ title: current.title, url: finalUrl, htmlText });
    if (current.depth >= maxDepth) {
      continue;
    }

    for (const child of extractFollowableLinksFromHtml(htmlText, finalUrl, current.title)) {
      const childUrl = new URL(child.url);
      if (childUrl.host !== baseNetloc) {
        continue;
      }
      if (childUrl.pathname.toLowerCase().includes("/course/view.php")) {
        const childSectionId = getSectionLabelFromUrl(child.url);
        if (rootSectionId && childSectionId && childSectionId !== rootSectionId) {
          continue;
        }
      }
      if (!visited.has(child.url)) {
        queue.push({ title: section.title, url: child.url, depth: current.depth + 1 });
      }
    }
  }

  return pages;
}
