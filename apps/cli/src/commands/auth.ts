import type { Command } from "commander";

import {
  DEFAULT_COURSE_URL,
  loginWithBrowser,
  logoutSession,
  readSessionStatus
} from "@monash-moodle-downloader/core";

import { confirmLogout } from "../utils.js";

export function registerAuthCommands(program: Command): void {
  const auth = program
    .command("auth")
    .description("Manage authenticated Moodle and Panopto sessions");

  auth
    .command("login")
    .description("Open a browser and save an authenticated session")
    .option("--course-url <url>", "Login landing URL", DEFAULT_COURSE_URL)
    .option("--headless", "Launch browser in headless mode", false)
    .option("--allow-plaintext-session", "Allow plaintext session storage", false)
    .option(
      "--allow-partial-session",
      "Allow saving a Moodle-only session when Panopto is not authenticated",
      false
    )
    .action(
      async (options: {
        courseUrl: string;
        headless: boolean;
        allowPlaintextSession: boolean;
        allowPartialSession: boolean;
      }) => {
        await loginWithBrowser({
          courseUrl: options.courseUrl,
          headless: options.headless,
          allowPlaintextSession: options.allowPlaintextSession,
          allowPartialSession: options.allowPartialSession
        });
      }
    );

  auth
    .command("status")
    .description("Print current local session status")
    .action(() => {
      console.log(JSON.stringify(readSessionStatus(), null, 2));
    });

  auth
    .command("logout")
    .description("Delete local session files")
    .option("--yes", "Skip confirmation prompt", false)
    .action(async (options: { yes: boolean }) => {
      const confirmed = await confirmLogout(options.yes);
      if (!confirmed) {
        console.log("Logout cancelled.");
        return;
      }
      const removed = logoutSession();
      if (removed.length === 0) {
        console.log("No Node session files found.");
        return;
      }
      console.log("Removed session files:");
      for (const item of removed) {
        console.log(`- ${item}`);
      }
    });
}
