// Helpers for the BPMN diagram page and editor.
import type { Issue, JobView } from "./types";

// Same ID cleaning as the server's compiler (server/src/bpmn.ts xid).
export const xid = (id: string) => {
  const clean = id.replace(/[^A-Za-z0-9_.-]/g, "_");
  return /^[A-Za-z_]/.test(clean) ? clean : `_${clean}`;
};

/** Save text or a data: URL as a file. */
export function download(content: string, filename: string, type: string) {
  const url = content.startsWith("data:") ? content : URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  if (url !== content) URL.revokeObjectURL(url);
}

/** Validation (V..) and draft errors: what keeps a draft from being a valid diagram. */
export const draftErrors = (result: NonNullable<JobView["result"]>): Issue[] =>
  result.draft ? result.issues.filter((i) => i.severity === "blocking" && /^(V\d\d_|DRAFT_)/.test(i.code)) : [];

export const diagramHref = (jobId: string) => `/jobs/${jobId}/diagram`;
