import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ClipboardPasteIcon, ImagePlusIcon, LinkIcon, Loader2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, postJson } from "@/lib/api";
import { useLibraryMutation } from "@/lib/queries";
import type { ItemDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_FILES = 10;

function NoteField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="note">Note</Label>
      <Textarea id="note" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={4} className="text-base md:text-sm" />
    </div>
  );
}

function LinkForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [url, setUrl] = useState(params.get("url") ?? "");
  const [note, setNote] = useState(params.get("note") ?? "");
  const [existing, setExisting] = useState<number | null>(null);
  const add = useLibraryMutation((body: { url: string; note: string }) => postJson<ItemDetail>("/items", body), "Queued");

  async function paste() {
    try {
      setUrl((await navigator.clipboard.readText()).trim());
    } catch {
      // Clipboard access was refused; the owner pastes by hand.
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setExisting(null);
    add.mutate(
      { url: url.trim(), note: note.trim() },
      {
        onSuccess: (item) => navigate(`/items/${item.id}`),
        onError: (error) => setExisting(error instanceof ApiError ? error.detail("item_id") : null),
      },
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="url">Link</Label>
        <div className="flex gap-2">
          <Input
            id="url"
            type="url"
            inputMode="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://x.com/..."
            className="h-10 text-base md:text-sm"
          />
          <Button type="button" variant="outline" className="h-10" onClick={() => void paste()}>
            <ClipboardPasteIcon /> Paste
          </Button>
        </div>
        {existing && (
          <p className="text-sm text-muted-foreground">
            Already saved:{" "}
            <Link to={`/items/${existing}`} className="text-foreground underline underline-offset-4">
              open it
            </Link>
          </p>
        )}
      </div>
      <NoteField value={note} onChange={setNote} placeholder="What to pull and what you like about it, e.g. the second video, the glassy edges" />
      <Button type="submit" className="h-10 w-full" disabled={add.isPending || !url.trim()}>
        {add.isPending && <Loader2Icon className="animate-spin" />}
        Add to queue
      </Button>
    </form>
  );
}

function UploadForm() {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const previews = useObjectUrls(files);
  const upload = useLibraryMutation(({ files, note }: { files: File[]; note: string }) => {
    const form = new FormData();
    for (const file of files) form.append("file", file);
    if (note) form.append("note", note);
    return api<ItemDetail>("/items/upload", { method: "POST", body: form });
  }, "Uploaded");

  function pick(list: FileList | null) {
    const chosen = [...(list ?? [])].filter((f) => IMAGE_TYPES.includes(f.type));
    setFiles((current) => [...current, ...chosen].slice(0, MAX_FILES));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        upload.mutate({ files, note: note.trim() }, { onSuccess: (item) => navigate(`/items/${item.id}`) });
      }}
      className="space-y-4"
    >
      <input ref={input} type="file" accept={IMAGE_TYPES.join(",")} multiple hidden onChange={(e) => pick(e.target.files)} />
      {files.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {files.map((file, i) => (
            <div key={`${file.name}-${i}`} className="relative">
              <img src={previews[i]} alt={file.name} className="aspect-square w-full rounded-md border object-cover" />
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => setFiles((current) => current.filter((_, j) => j !== i))}
                className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-black/60 text-white"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
          ))}
          {files.length < MAX_FILES && (
            <button type="button" onClick={() => input.current?.click()} className="grid aspect-square place-items-center rounded-md border border-dashed text-muted-foreground">
              <ImagePlusIcon className="size-5" />
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-sm text-muted-foreground"
        >
          <ImagePlusIcon className="size-6" />
          Choose screenshots or images
          <span className="text-xs">JPEG, PNG, WebP or GIF, up to {MAX_FILES}</span>
        </button>
      )}
      <NoteField value={note} onChange={setNote} placeholder="What you like about it" />
      <Button type="submit" className="h-10 w-full" disabled={upload.isPending || files.length === 0}>
        {upload.isPending && <Loader2Icon className="animate-spin" />}
        Upload
      </Button>
    </form>
  );
}

/** Object URLs for image previews, revoked when the files change. */
function useObjectUrls(files: File[]): string[] {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const next = files.map((f) => URL.createObjectURL(f));
    setUrls(next);
    return () => next.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  return urls;
}

export function AddPage() {
  const [mode, setMode] = useState<"link" | "upload">("link");
  return (
    <div className="mx-auto max-w-lg space-y-5">
      <h1 className="text-xl font-semibold tracking-tight">Add inspiration</h1>
      <div className="grid grid-cols-2 rounded-lg border p-1">
        {(
          [
            ["link", LinkIcon, "Link"],
            ["upload", ImagePlusIcon, "Upload"],
          ] as const
        ).map(([value, Icon, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={cn("flex items-center justify-center gap-2 rounded-md py-2 text-sm text-muted-foreground", mode === value && "bg-accent text-foreground")}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>
      {mode === "link" ? <LinkForm /> : <UploadForm />}
    </div>
  );
}
