import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const BAND = 28; // label strip above each image, in points

/**
 * Combine chat attachments into one PDF (Copilot Chat takes only a few attachments per message).
 * One page per image, labelled with the ID the prompt cites (IMG1, P1, ...) so pages map back to it.
 */
export async function imagesToPdf(images: { id: string; label: string; mime: string; data: Buffer }[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const img of images) {
    const embedded = img.mime === "image/jpeg" ? await doc.embedJpg(img.data) : await doc.embedPng(img.data);
    const { width, height } = embedded;
    const page = doc.addPage([width, height + BAND]);
    page.drawImage(embedded, { x: 0, y: 0, width, height });
    // Standard fonts only encode WinAnsi, so drop anything else from the label.
    const text = `${img.id}: ${img.label}`.replace(/[^\x20-\x7e]/g, "?");
    page.drawText(text, { x: 8, y: height + 9, size: 12, font, color: rgb(0, 0, 0) });
  }
  return Buffer.from(await doc.save());
}
