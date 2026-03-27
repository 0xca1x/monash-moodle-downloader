export interface CourseSection {
  index: number;
  title: string;
  url: string;
  sectionId: string;
}

export interface ResourceLink {
  section: string;
  subsection: string;
  group: string;
  title: string;
  url: string;
  resourceType: "file" | "video" | "subtitle";
  delivery: "download" | "reference" | "inline";
  inlineText?: string;
  preferredExtension?: string;
}

export interface DownloadedFile {
  section?: string;
  subsection?: string;
  group?: string;
  title: string;
  url: string;
  relativePath: string;
  resourceType: "file" | "video" | "subtitle";
  delivery?: "download" | "reference" | "inline";
  status: "downloaded" | "updated" | "skipped" | "failed";
  reason?: string;
}

export type SessionStorageMode = "encrypted" | "plaintext";
