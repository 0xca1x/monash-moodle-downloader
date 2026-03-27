import readline from "node:readline/promises";
import type { BrowserContext, BrowserType, Page } from "playwright";

import { DEFAULT_COURSE_URL, DEFAULT_PANOPTO_URL } from "../config.js";
import { launchPreferredBrowser } from "./browser-launch.js";
import { clearSession, getSessionSecret, getSessionStatus, saveSession } from "./session-store.js";

interface LoginOptions {
  courseUrl?: string;
  headless?: boolean;
  allowPlaintextSession?: boolean;
  allowPartialSession?: boolean;
}

interface PlaywrightModule {
  chromium: BrowserType;
}

async function importPlaywright(): Promise<PlaywrightModule> {
  try {
    return (await import("playwright")) as unknown as PlaywrightModule;
  } catch {
    throw new Error("Playwright is not installed for the Node CLI.");
  }
}

function isPanoptoAuthenticatedUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes("panopto.com") && !lower.includes("/auth/login.aspx");
}

async function waitForLoggedInMoodle(page: Page, courseUrl: string): Promise<void> {
  try {
    await page.goto("https://learning.monash.edu/my/", {
      waitUntil: "networkidle",
      timeout: 30000
    });
  } catch {
    await page.goto(courseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  }

  const currentUrl = page.url();
  if (!currentUrl.includes("learning.monash.edu")) {
    throw new Error(`Login may not have completed. Current URL: ${currentUrl}`);
  }
}

async function establishPanoptoSessionInCurrentBrowser(page: Page): Promise<boolean> {
  const returnUrl = page.url().includes("learning.monash.edu")
    ? page.url()
    : "https://learning.monash.edu/my/";

  const tryTriggerPanoptoSso = async (): Promise<boolean> => {
    const loginSelect = page.locator("select").first();
    if (!(await loginSelect.count())) {
      return false;
    }

    const options = await loginSelect.evaluate((element) => {
      const select = element as HTMLSelectElement;
      return Array.from(select.options).map((option) => ({
        value: option.value,
        label: option.textContent?.trim() ?? ""
      }));
    });

    const bestOption =
      options.find((option) => /monash|university|sso|saml/i.test(option.label)) ??
      options.find((option) => !/^panopto$/i.test(option.label));

    if (!bestOption?.value) {
      return false;
    }

    console.log(`Panopto login page detected. Selecting identity provider: ${bestOption.label}`);
    const targetUrl = new URL(page.url());
    targetUrl.searchParams.set("instance", bestOption.value);

    await page.goto(targetUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
    return true;
  };

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.goto(DEFAULT_PANOPTO_URL, {
        waitUntil: "domcontentloaded",
        timeout: 30000
      });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);

      if (isPanoptoAuthenticatedUrl(page.url())) {
        try {
          await page.goto(returnUrl, {
            waitUntil: "domcontentloaded",
            timeout: 30000
          });
        } catch {
          // keep best-effort only
        }
        return true;
      }

      const triggered = await tryTriggerPanoptoSso();
      if (triggered) {
        await page.waitForTimeout(4000);
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
        await page.goto(DEFAULT_PANOPTO_URL, {
          waitUntil: "domcontentloaded",
          timeout: 30000
        });
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
        if (isPanoptoAuthenticatedUrl(page.url())) {
          try {
            await page.goto(returnUrl, {
              waitUntil: "domcontentloaded",
              timeout: 30000
            });
          } catch {
            // keep best-effort only
          }
          return true;
        }
      } else {
        await page.waitForTimeout(2500);
      }
    }

    try {
      await page.goto(returnUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000
      });
    } catch {
      // keep best-effort only
    }

    return false;
  } catch {
    try {
      await page.goto(returnUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000
      });
    } catch {
      // keep best-effort only
    }
    return false;
  }
}

async function establishPanoptoSession({
  chromium,
  sourceContext,
  interactivePage,
  allowPartialSession
}: {
  chromium: BrowserType;
  sourceContext: BrowserContext;
  interactivePage: Page;
  allowPartialSession: boolean;
}): Promise<{
  storageState: Awaited<ReturnType<BrowserContext["storageState"]>>;
  partial: boolean;
}> {
  const seededStorageState = await sourceContext.storageState();
  const browser = await launchPreferredBrowser(chromium, true);
  let headlessFailureReason: string | null = null;

  try {
    const context = await browser.newContext({ storageState: seededStorageState });
    const page = await context.newPage();

    console.log("Establishing Panopto session in the background...");

    try {
      await page.goto(DEFAULT_PANOPTO_URL, {
        waitUntil: "domcontentloaded",
        timeout: 30000
      });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
    } catch (error) {
      headlessFailureReason = error instanceof Error ? error.message : String(error);
    }

    const panoptoUrl = page.url();
    if (headlessFailureReason === null && isPanoptoAuthenticatedUrl(panoptoUrl)) {
      console.log(`Panopto session established in background: ${panoptoUrl}`);
      return { storageState: await context.storageState(), partial: false };
    }

    console.log("Background Panopto authorization did not complete.");
    if (headlessFailureReason) {
      console.log(`Background reason: ${headlessFailureReason}`);
    } else {
      console.log(`Background current URL: ${panoptoUrl}`);
    }
    console.log("Retrying Panopto authorization automatically in the existing browser session...");

    const interactiveAuthenticated = await establishPanoptoSessionInCurrentBrowser(interactivePage);
    if (interactiveAuthenticated) {
      console.log("Panopto session established in the existing browser session.");
      return { storageState: await sourceContext.storageState(), partial: false };
    }

    if (!allowPartialSession) {
      throw new Error(
        "Panopto automatic authorization did not complete. Moodle login succeeded, but Panopto still requires manual sign-in."
      );
    }

    console.log(
      "Warning: Panopto automatic authorization did not complete. Saving a Moodle-only session by explicit opt-in."
    );
    return { storageState: await sourceContext.storageState(), partial: true };
  } finally {
    await browser.close();
  }
}

export async function loginWithBrowser({
  courseUrl = DEFAULT_COURSE_URL,
  headless = false,
  allowPlaintextSession = false,
  allowPartialSession = false
}: LoginOptions): Promise<void> {
  if (!getSessionSecret() && !allowPlaintextSession) {
    throw new Error(
      "Missing MONASH_SESSION_SECRET. Add it to .env or pass --allow-plaintext-session if you explicitly want plaintext local storage."
    );
  }

  const { chromium } = await importPlaywright();
  const browser = await launchPreferredBrowser(chromium, headless);
  const context: BrowserContext = await browser.newContext();
  const page: Page = await context.newPage();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    await page.goto("about:blank", { waitUntil: "load" });
    console.log("Browser opened.");
    console.log(
      `If the course page does not open automatically, open this URL manually: ${courseUrl}`
    );

    try {
      await page.goto(courseUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    } catch {
      console.log("Auto-open timed out. Continue in the browser manually.");
    }

    console.log("Complete Google/Monash login and 2FA in the browser.");
    console.log("Stay on Moodle. Panopto will be authorized in the background afterwards.");
    await rl.question("Press Enter after Moodle is fully visible and stable...");

    await waitForLoggedInMoodle(page, courseUrl);

    const { storageState, partial } = await establishPanoptoSession({
      chromium,
      sourceContext: context,
      interactivePage: page,
      allowPartialSession
    });

    const result = saveSession(
      {
        savedAt: new Date().toISOString(),
        courseUrl,
        storageState
      },
      { allowPlaintext: allowPlaintextSession }
    );

    console.log(`Saved session to ${result.blobPath}`);
    console.log(`Saved metadata to ${result.metaPath}`);
    if (partial) {
      console.log("Saved a Moodle-only session by explicit opt-in.");
    }
    console.log(
      result.encrypted
        ? "Session cookies/storage are encrypted at rest."
        : "Session is stored in plaintext by explicit opt-in."
    );
  } finally {
    rl.close();
    await browser.close();
  }
}

export function logoutSession(): string[] {
  return clearSession();
}

export function readSessionStatus() {
  return getSessionStatus();
}
