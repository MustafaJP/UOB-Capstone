"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileIcon, FileTextIcon, UploadIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import { cn } from "@/lib/utils";

// Mirrors the server's multer limits (server/src/server.ts).
export const MAX_FILES = 10;
export const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPT = ".txt,.pdf,image/*,text/plain,application/pdf";

const isImage = (f: File) => f.type.startsWith("image/");
const accepted = (f: File) =>
  isImage(f) || f.type === "application/pdf" || f.type === "text/plain" || /\.(txt|pdf|png|jpe?g|gif|webp)$/i.test(f.name);

const formatSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

const kindLabel = (f: File) =>
  isImage(f) ? "Image" : f.type === "application/pdf" || /\.pdf$/i.test(f.name) ? "PDF" : "Text";

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
      else if (f.size > MAX_BYTES) toast.error(`${f.name} is larger than 20 MB`);
      else if (next.length >= MAX_FILES) {
        toast.error(`At most ${MAX_FILES} files per job`);
        break;
      } else if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    onChange(next);
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Attachment
        state="idle"
        className={cn("w-full justify-center py-8", over && "border-primary bg-primary/5")}
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
      >
        <AttachmentMedia>
          <UploadIcon />
        </AttachmentMedia>
        <AttachmentContent className="flex-none">
          <AttachmentTitle>Drop SOPs, process docs or diagram photos</AttachmentTitle>
          <AttachmentDescription>
            or click to browse · .txt, .pdf, images · up to {MAX_FILES} files, 20 MB each
          </AttachmentDescription>
        </AttachmentContent>
        <AttachmentTrigger aria-label="Choose files" onClick={() => input.current?.click()} />
      </Attachment>
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
        <AttachmentGroup className="w-full">
          {files.map((f, i) => (
            <Attachment key={`${f.name}-${f.size}`} orientation="vertical">
              <AttachmentMedia variant={previews[i] ? "image" : "icon"}>
                {previews[i] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local blob preview
                  <img src={previews[i]!} alt="" />
                ) : kindLabel(f) === "PDF" ? (
                  <FileIcon />
                ) : (
                  <FileTextIcon />
                )}
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle title={f.name}>{f.name}</AttachmentTitle>
                <AttachmentDescription>
                  {kindLabel(f)} · {formatSize(f.size)}
                </AttachmentDescription>
              </AttachmentContent>
              <AttachmentActions>
                <AttachmentAction
                  aria-label={`Remove ${f.name}`}
                  variant="secondary"
                  onClick={() => onChange(files.filter((_, j) => j !== i))}
                >
                  <XIcon />
                </AttachmentAction>
              </AttachmentActions>
            </Attachment>
          ))}
        </AttachmentGroup>
      )}
    </div>
  );
}
