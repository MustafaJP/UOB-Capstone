import type { Health, JobStatus, JobView, Mode, Provider, RunSummary } from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

/** The server's error contract: { code, message, retryable, details? }. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryable = false,
    public details?: unknown,
  ) {
    super(message);
  }

  /** Field-level messages, e.g. from CHAT_RESULT_INVALID (details is a string[]). */
  get detailLines(): string[] {
    return Array.isArray(this.details) ? this.details.map(String) : [];
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { cache: "no-store", ...init });
  } catch {
    throw new ApiError(0, "NETWORK", `Cannot reach the server at ${API_URL}`, true);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(
      res.status,
      body?.code ?? "HTTP_" + res.status,
      body?.message ?? res.statusText,
      body?.retryable ?? false,
      body?.details,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

type Accepted = { jobId: string; status: JobStatus };

export const api = {
  health: () => request<Health>("/health"),
  createJob: (form: FormData) => request<Accepted>("/v1/jobs", { method: "POST", body: form }),
  listJobs: () => request<{ runs: RunSummary[] }>("/v1/jobs"),
  deleteJob: (id: string) => request<void>(`/v1/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getJob: (id: string) => request<JobView>(`/v1/jobs/${encodeURIComponent(id)}`),
  cancelJob: (id: string) => request<Accepted>(`/v1/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  resumeJob: (id: string, response: string) =>
    request<Accepted>(`/v1/jobs/${encodeURIComponent(id)}/resume`, json({ response })),
  switchMode: (id: string, mode: Mode, provider?: Provider) =>
    request<Accepted & { mode: Mode }>(`/v1/jobs/${encodeURIComponent(id)}/mode`, json({ mode, provider })),
  setIssueResolved: (id: string, index: number, resolved: boolean) =>
    request<{ resolved: Record<string, string> }>(`/v1/jobs/${encodeURIComponent(id)}/issues/${index}`, {
      ...json({ resolved }),
      method: "PUT",
    }),
  bpmnUrl: (id: string) => `${API_URL}/v1/jobs/${encodeURIComponent(id)}/bpmn`,
};
