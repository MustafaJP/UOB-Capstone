"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { UploadIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// No file count or size limit (the server accepts any; see server/src/server.ts).
const ACCEPT = ".txt,.pdf,image/*,text/plain,application/pdf";

const isImage = (f: File) => f.type.startsWith("image/");
const accepted = (f: File) =>
  isImage(f) || f.type === "application/pdf" || f.type === "text/plain" || /\.(txt|pdf|png|jpe?g|gif|webp)$/i.test(f.name);

const formatSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

const kindLabel = (f: File) =>
  isImage(f) ? "Image" : f.type === "application/pdf" || /\.pdf$/i.test(f.name) ? "PDF" : "Text";

/** Small file-type tile: red for PDF, blue for images, grey for text. Shared with the run history. */
export function FileTypeTile({ kind, preview, className }: { kind: "PDF" | "IMG" | "TXT"; preview?: string | null; className?: string }) {
  return (
    <div
      className={cn(
        "grid size-[34px] shrink-0 place-items-center overflow-hidden rounded-lg text-[10px] font-bold",
        kind === "PDF" ? "bg-uob-red-50 text-uob-red" : kind === "IMG" ? "bg-brand-50 text-brand" : "bg-line-2 text-ink-2",
        className,
      )}
    >
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element -- local blob preview
        <img src={preview} alt="" className="size-full object-cover" />
      ) : (
        kind
      )}
    </div>
  );
}

const TILE_KIND = { PDF: "PDF", Image: "IMG", Text: "TXT" } as const;

export function FileDropzone({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  // Thumbnail URLs for image files, revoked when the list changes.
  const previews = useMemo(() => files.map((f) => (isImage(f) ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);

  const add = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (!accepted(f)) toast.error(`${f.name}: only .txt, .pdf and images are supported`);
      else if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    onChange(next);
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <button
        type="button"
        aria-label="Choose files"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-[#afc0e3] bg-brand-50 p-[26px] text-center transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          over && "border-brand bg-brand-100",
        )}
      >
        <span className="grid size-11 place-items-center rounded-xl bg-white text-brand shadow-card">
          <UploadIcon className="size-[18px]" />
        </span>
        <b className="text-[15px] text-navy">Drop SOPs, process docs or flowchart images</b>
        <small className="text-ink-3">
          or <u className="text-brand">browse files</u> · any number of files
        </small>
        <span className="mt-1.5 flex flex-wrap justify-center gap-1.5">
          {[".pdf", ".txt", ".png / .jpg"].map((ext) => (
            <span key={ext} className="rounded-full bg-line-2 px-2.5 py-0.5 text-xs font-semibold text-ink-2">
              {ext}
            </span>
          ))}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />

      {files.length > 0 && (
        <ul className="flex flex-col gap-2">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${f.size}`}
              className="flex items-center gap-2.5 rounded-[10px] border border-line bg-white px-3 py-2.5"
            >
              <FileTypeTile kind={TILE_KIND[kindLabel(f)]} preview={previews[i]} />
              <div className="min-w-0 flex-1">
                <b className="block truncate text-[13px]" title={f.name}>
                  {f.name}
                </b>
                <small className="text-ink-3">
                  {kindLabel(f)} · {formatSize(f.size)}
                </small>
              </div>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="grid size-7 place-items-center rounded-md text-ink-3 hover:bg-line-2 hover:text-ink"
              >
                <XIcon className="size-[18px]" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
