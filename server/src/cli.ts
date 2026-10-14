import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { createInterface } from "node:readline/promises";
import { AppError } from "./agents.js";
import type { InputFile } from "./evidence.js";
import { attachmentFor, createJob, jobView, resumeJob, type Mode } from "./jobs.js";
import { defaultProvider, type Provider } from "./llm.js";
import type { A4Graph, Issue, TraceEntry } from "./schemas.js";

// Usage: npm run demo -- <file...> [--mode chat] [--provider qwen]
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const mode = (flag("mode") ?? "api") as Mode;
const provider = (flag("provider") ?? defaultProvider()) as Provider;
if (!args.length) {
  console.error("Usage: npm run demo -- <file.txt|.pdf|.png|.jpg ...> [--mode chat] [--provider gemini|qwen|mistral|kimi|llama]");
  process.exit(1);
}

const MIME: Record<string, string> = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".txt": "text/plain", ".md": "text/plain" };
const files: InputFile[] = args.map((p) => ({ name: basename(p), mime: MIME[extname(p).toLowerCase()] ?? "application/octet-stream", data: readFileSync(p) }));
const name = basename(args[0], extname(args[0]));
mkdirSync("out", { recursive: true });

const c = { dim: "\x1b[2m", bold: "\x1b[1m", red: "\x1b[31m", yellow: "\x1b[33m", green: "\x1b[32m", cyan: "\x1b[36m", reset: "\x1b[0m" };
const printTrace = (trace: TraceEntry[]) => {
  console.log(`\n${c.bold}Agent trace${c.reset}`);
  for (const t of trace) {
    const who = t.role === "system" ? "code" : t.role;
    const via = t.role === "system" ? "" : ` ${c.dim}[${t.provider}${t.model ? `/${t.model}` : ""}]${c.reset}`;
    const time = t.ms ? ` ${(t.ms / 1000).toFixed(1)}s` : "";
    console.log(`  ${t.ok ? c.green + "✓" : c.red + "✗"}${c.reset} ${c.cyan}${who.padEnd(5)}${c.reset} ${t.step.padEnd(18)}${via}${c.dim}${time}${t.note ? ` · ${t.note}` : ""}${c.reset}`);
  }
};
const sevColor = (s: Issue["severity"]) => (s === "blocking" ? c.red : s === "review" ? c.yellow : c.dim);

console.log(`${c.bold}Process flow agents${c.reset} · mode=${mode} · provider=${mode === "chat" ? "copilot_chat" : provider} · input=${args.join(", ")}`);
const { job, done } = createJob({ files }, mode, provider);
await done;

const rl = createInterface({ input: process.stdin, output: process.stdout });
while (job.status === "awaiting_chat" && job.pending) {
  const p = job.pending;
  const tag = p.schema === "A4_PATCH" ? `${p.role}.repair` : p.role;
  const promptFile = `out/${name}.${tag}.prompt.txt`;
  const responseFile = `out/${name}.${tag}.response.json`;
  writeFileSync(promptFile, p.prompt);
  console.log(`\n${c.bold}⏸  Copilot Chat handoff: ${p.role} ${p.roleName}${c.reset}`);
  console.log(`  1. Open ${promptFile} and paste it into a NEW Copilot Chat conversation.`);
  const size = `${p.chars.toLocaleString()} / ${p.maxChars.toLocaleString()} characters`;
  console.log(p.cutChars ? `${c.yellow}     ${size}: ${p.cutChars.toLocaleString()} characters of source text cut to fit.${c.reset}` : `     ${size}`);
  if (p.attachments.length) {
    const saved: string[] = [];
    for (const a of p.attachments) {
      const file = await attachmentFor(job.id, a.split(":")[0]);
      if (!file) continue;
      writeFileSync(`out/${name}.${file.name}`, file.data);
      saved.push(`out/${name}.${file.name}`);
    }
    console.log(`  2. Attach: ${saved.length ? saved.join(", ") : p.attachments.join("; ")}`);
  }
  console.log(`  ${p.attachments.length ? 3 : 2}. Save Copilot's JSON reply to ${responseFile}`);
  await rl.question(`  Press Enter when the response file is saved… `);
  let raw: string;
  try {
    raw = readFileSync(responseFile, "utf8");
  } catch {
    console.log(`${c.red}  Could not read ${responseFile}${c.reset}`);
    continue;
  }
  try {
    await resumeJob(job, raw);
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    console.log(`${c.red}  Rejected: ${e.message}${c.reset}`);
    for (const err of (e.details as string[] | undefined) ?? []) console.log(`    - ${err}`);
    console.log(`  The graph did not advance. Fix the response (or ask Copilot to correct it) and try again.`);
  }
}
rl.close();

const view = await jobView(job);
printTrace(view.trace);

if (job.status === "failed") {
  console.log(`\n${c.red}${c.bold}Job failed: ${job.error?.code}${c.reset} ${job.error?.message}`);
  if (job.error?.details) console.log(job.error.details);
  console.log(`Tip: completed agents are kept. Over HTTP, POST /v1/jobs/<id>/mode {"mode":"chat"} continues in Copilot Chat.`);
  process.exit(1);
}

const changes = view.stages.a3?.changes ?? [];
if (changes.length) {
  console.log(`\n${c.bold}A3 Extraction Refiner changes (${changes.length})${c.reset}`);
  for (const ch of changes) console.log(`  ${c.cyan}${ch.type.padEnd(13)}${c.reset} ${ch.upstream_ids.join(", ")} → ${ch.result_id ?? "-"} ${c.dim}${ch.reason}${c.reset}`);
}

const g: A4Graph | null = view.result?.graph ?? null;
if (g) {
  console.log(`\n${c.bold}Graph: "${g.title}"${c.reset} · ${g.lanes.length} lanes · ${g.nodes.length} nodes · ${g.edges.length} edges · ${g.annotations.length} notes`);
  for (const lane of g.lanes) {
    console.log(`  ${c.bold}${lane.name}${c.reset}`);
    for (const n of g.nodes.filter((x) => x.lane_id === lane.id)) {
      console.log(`    ${n.type.padEnd(17)} ${n.label} ${c.dim}[${n.evidence_refs.join(",")}]${n.origin === "inferred" ? " inferred" : ""}${c.reset}`);
    }
  }
}

const issues = view.result?.issues ?? [];
console.log(`\n${c.bold}Issues for human review (${issues.length})${c.reset}`);
for (const i of issues) console.log(`  ${sevColor(i.severity)}${i.severity.padEnd(8)}${c.reset} ${i.code.padEnd(24)} ${i.message}`);

writeFileSync(`out/${name}.result.json`, JSON.stringify(view, null, 2));
console.log(`\nSaved out/${name}.result.json`);
if (view.result?.bpmnXml) {
  writeFileSync(`out/${name}.bpmn`, view.result.bpmnXml);
  console.log(`Saved out/${name}.bpmn → open it at https://demo.bpmn.io (drag and drop)`);
} else {
  console.log(`${c.yellow}No BPMN produced: fix the structural issues above first.${c.reset}`);
}
