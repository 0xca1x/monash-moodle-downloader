// Auth and session
export { loginWithBrowser, logoutSession, readSessionStatus } from "./auth/auth-service.js";
export { clearSession, getSessionStatus, loadSession, saveSession } from "./auth/session-store.js";

// Configuration and environment
export {
  DEFAULT_COURSE_URL,
  DEFAULT_PANOPTO_URL,
  DOWNLOADS_DIR,
  ENV_PATH,
  REPO_ROOT,
  SESSION_BLOB_PATH,
  SESSION_DIR,
  SESSION_META_PATH
} from "./config.js";
export { loadEnvFile } from "./env.js";

// Course inspection
export { listCourseSections } from "./course/course-service.js";

// Download and scanning
export {
  downloadCourseAttachments,
  type DownloadCourseAttachmentsOptions,
  type DownloadCourseAttachmentsResult,
  type DownloadSectionSummary
} from "./download/download-service.js";

// Subtitle translation
export {
  translateSubtitlesBatch,
  type TranslateSubtitleBatchOptions,
  type TranslateSubtitleBatchResult
} from "./subtitles/subtitle-translate-service.js";

// Re-export shared public types/constants for app convenience
export * from "@monash-moodle-downloader/shared";
