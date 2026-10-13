import "dotenv/config";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { AppError } from "./agents.js";
import { defaultProvider, PROVIDERS } from "./llm.js";
import { bpmnFor, createJob, getJob, listRuns, removeRun, resumeJob, switchMode, viewFor } from "./jobs.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "6mb" }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 10 } });

const ModeField = z.enum(["api", "chat"]).default("api");
const ProviderField = z.enum(PROVIDERS as ["gemini", "qwen"]).optional();

const STATUS: Record<string, number> = {
  JOB_NOT_FOUND: 404,
  BAD_REQUEST: 422,
  CHAT_RESULT_INVALID: 422,
  PACKET_STALE: 409,
  MODE_SWITCH_NOT_ALLOWED: 409,
  BPMN_NOT_READY: 409,
  RUN_BUSY: 409,
};

app.get("/health", (_req, res) => {
  res.json({ ok: true, provider: defaultProvider() });
});

// Start a job: multipart (files + optional text) or JSON { text }.
app.post("/v1/jobs", upload.array("files"), (req, res) => {
  const body = z
    .object({ text: z.string().max(500_000).optional(), mode: ModeField, provider: ProviderField })
    .safeParse(req.body ?? {});
  if (!body.success) throw new AppError("BAD_REQUEST", "Invalid request", false, z.treeifyError(body.error));
  const files = ((req.files as Express.Multer.File[] | undefined) ?? []).map((f) => ({
    name: f.originalname,
    mime: f.mimetype,
    data: f.buffer,
  }));
  if (!files.length && !body.data.text?.trim()) throw new AppError("BAD_REQUEST", "Provide text or at least one file");

  const { job } = createJob({ text: body.data.text, files }, body.data.mode, body.data.provider ?? defaultProvider());
  res.status(202).json({ jobId: job.id, status: job.status });
});

// Run history: live jobs plus runs saved by earlier server sessions, newest first.
app.get("/v1/jobs", async (_req, res) => {
  res.json({ runs: await listRuns() });
});

app.get("/v1/jobs/:id", async (req, res) => {
  res.json(await viewFor(req.params.id));
});

app.delete("/v1/jobs/:id", async (req, res) => {
  await removeRun(req.params.id);
  res.status(204).end();
});

// Copilot Chat fallback: paste the JSON the chat returned for the pending agent.
app.post("/v1/jobs/:id/resume", (req, res) => {
  const body = z.object({ response: z.string().min(1) }).safeParse(req.body ?? {});
  if (!body.success) throw new AppError("BAD_REQUEST", "Body must be { response: string }");
  const job = getJob(req.params.id);
  void resumeJob(job, body.data.response);
  res.status(202).json({ jobId: job.id, status: job.status });
});

// Switch a failed/paused job between API and Copilot Chat without redoing finished agents.
app.post("/v1/jobs/:id/mode", (req, res) => {
  const body = z.object({ mode: z.enum(["api", "chat"]), provider: ProviderField }).safeParse(req.body ?? {});
  if (!body.success) throw new AppError("BAD_REQUEST", "Body must be { mode: 'api' | 'chat', provider? }");
  const job = getJob(req.params.id);
  void switchMode(job, body.data.mode, body.data.provider);
  res.status(202).json({ jobId: job.id, status: job.status, mode: job.mode });
});

app.get("/v1/jobs/:id/bpmn", async (req, res) => {
  const xml = await bpmnFor(req.params.id);
  if (!xml) throw new AppError("BPMN_NOT_READY", "No BPMN for this job yet: it is still running or it failed");
  res.type("application/xml").attachment(`process-${req.params.id.slice(0, 8)}.bpmn`).send(xml);
});

// Error contract from FSD §10: { code, message, retryable } and never a stack trace.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    res.status(STATUS[err.code] ?? 500).json({ code: err.code, message: err.message, retryable: err.retryable, details: err.details });
    return;
  }
  if (err instanceof multer.MulterError) {
    res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 422).json({ code: "FILE_TOO_LARGE", message: err.message, retryable: false });
    return;
  }
  console.error(err);
  res.status(500).json({ code: "INTERNAL", message: "Unexpected server error", retryable: false });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`agent-orchestrator listening on http://localhost:${port} (default provider: ${defaultProvider()})`));
