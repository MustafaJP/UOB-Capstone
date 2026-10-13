import { PDFParse } from "pdf-parse";
import type { Evidence, Issue } from "./schemas.js";

export type InputFile = { name: string; mime: string; data: Buffer };
export type JobInput = { text?: string; files?: InputFile[] };

const MAX_TEXT_CHARS = 60_000; // keeps one A1 call within a sensible context size
const MAX_IMAGES = 6;
const BLOCK_CHARS = 800;
const MIN_PAGE_TEXT = 40; // pages with less text than this are treated as images
const MAX_LAYOUT_VIEWS = 6;
const TABLE_LINE_RUN = 6; // this many consecutive short lines on a text page suggests a table

/**
 * A rendered PDF text page that A1 sees only to understand table layout (which text sits in
 * which row and column). It is not evidence: agents cite the page's E blocks, never the view.
 */
export type LayoutView = { id: string; source: string; page: number; mime: "image/png"; base64: string };

/**
 * pdf-parse flattens tables: wrapped cells come out as runs of short lines with no column breaks.
 * Flag a page when it has a long run of short lines that are not list items, numbered steps or headings.
 */
function looksTabular(text: string): boolean {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < TABLE_LINE_RUN) return false;
  const maxLen = Math.max(...lines.map((l) => l.length));
  const listOrHeading = /^([•\-–]|\d+\.\s|\d+\.\d+\s|Page \d+)/;
  let run = 0;
  for (const l of lines) {
    run = !listOrHeading.test(l) && l.length < 0.55 * maxLen ? run + 1 : 0;
    if (run >= TABLE_LINE_RUN) return true;
  }
  return false;
}

// Split text into paragraph-sized blocks; each block becomes one citable evidence ID.
function toBlocks(text: string): string[] {
  const blocks: string[] = [];
  for (const para of text.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    let current = "";
    for (const line of para.split("\n")) {
      if (current && current.length + line.length > BLOCK_CHARS) {
        blocks.push(current.trim());
        current = "";
      }
      current += line + "\n";
    }
    if (current.trim()) blocks.push(current.trim());
  }
  return blocks;
}

export async function normalize(input: JobInput): Promise<{ evidence: Evidence[]; layouts: LayoutView[]; issues: Issue[] }> {
  const evidence: Evidence[] = [];
  const layouts: LayoutView[] = [];
  const skippedLayouts: string[] = [];
  const issues: Issue[] = [];
  let textCount = 0;
  let imageCount = 0;
  let textChars = 0;
  const skipped: string[] = [];

  const addText = (source: string, page: number | null, text: string) => {
    for (const block of toBlocks(text)) {
      const id = `E${++textCount}`;
      if (textChars + block.length > MAX_TEXT_CHARS) {
        skipped.push(id);
        continue;
      }
      textChars += block.length;
      evidence.push({ id, kind: "text", source, page, text: block });
    }
  };
  const addImage = (source: string, page: number | null, mime: string, data: Buffer | Uint8Array) => {
    if (imageCount >= MAX_IMAGES) {
      skipped.push(`${source}${page ? ` p${page}` : ""}`);
      return;
    }
    evidence.push({ id: `IMG${++imageCount}`, kind: "image", source, page, mime, base64: Buffer.from(data).toString("base64") });
  };

  if (input.text?.trim()) addText("pasted text", null, input.text);

  for (const file of input.files ?? []) {
    const name = file.name.toLowerCase();
    if (file.mime === "application/pdf" || name.endsWith(".pdf")) {
      const pdf = new PDFParse({ data: file.data });
      try {
        const result = await pdf.getText();
        for (const page of result.pages) {
          if (page.text.trim().length >= MIN_PAGE_TEXT) {
            addText(file.name, page.num, page.text);
            if (looksTabular(page.text)) {
              if (layouts.length >= MAX_LAYOUT_VIEWS) skippedLayouts.push(`${file.name} p${page.num}`);
              else {
                const shot = await pdf.getScreenshot({ partial: [page.num], desiredWidth: 1600, imageBuffer: true });
                const data = shot.pages[0]?.data;
                if (data) {
                  layouts.push({ id: `P${layouts.length + 1}`, source: file.name, page: page.num, mime: "image/png", base64: Buffer.from(data).toString("base64") });
                }
              }
            }
          } else {
            // No usable text layer: render the page so A2 can read it as a diagram.
            const shot = await pdf.getScreenshot({ partial: [page.num], desiredWidth: 1600, imageBuffer: true });
            const data = shot.pages[0]?.data;
            if (data) addImage(file.name, page.num, "image/png", data);
          }
        }
      } finally {
        await pdf.destroy();
      }
    } else if (/^image\/(png|jpe?g|webp)$/.test(file.mime) || /\.(png|jpe?g|webp)$/.test(name)) {
      const mime = file.mime.startsWith("image/") ? file.mime : name.endsWith(".png") ? "image/png" : "image/jpeg";
      addImage(file.name, null, mime, file.data);
    } else if (file.mime.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) {
      addText(file.name, null, file.data.toString("utf8"));
    } else {
      issues.push({
        code: "FILE_UNSUPPORTED",
        severity: "blocking",
        message: `${file.name}: unsupported type ${file.mime}. Use TXT, PDF, PNG or JPEG.`,
        element_ids: [],
        evidence_refs: [],
      });
    }
  }

  // FSD rule: never truncate silently.
  if (skipped.length) {
    issues.push({
      code: "SOURCE_INCOMPLETE",
      severity: "blocking",
      message: `Input exceeds the demo limits (${MAX_TEXT_CHARS} chars of text, ${MAX_IMAGES} images). Not processed: ${skipped.slice(0, 20).join(", ")}${skipped.length > 20 ? "…" : ""}. Narrow the scope and run again.`,
      element_ids: [],
      evidence_refs: [],
    });
  }
  if (skippedLayouts.length) {
    issues.push({
      code: "LAYOUT_LIMIT",
      severity: "info",
      message: `More than ${MAX_LAYOUT_VIEWS} pages look like tables. Their text is still evidence, but these pages had no layout view, so table columns may be misread: ${skippedLayouts.join(", ")}.`,
      element_ids: [],
      evidence_refs: [],
    });
  }
  if (!evidence.length) {
    issues.push({
      code: "SOURCE_UNREADABLE",
      severity: "blocking",
      message: "No readable text or images were found in the input.",
      element_ids: [],
      evidence_refs: [],
    });
  }
  return { evidence, layouts, issues };
}
