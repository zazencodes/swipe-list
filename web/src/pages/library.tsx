import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ImagesIcon, ImageIcon, Loader2Icon, PlayIcon, SearchIcon, XIcon } from "lucide-react";
import { EmptyState, ErrorMessage } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useItemPages, useTags } from "@/lib/queries";
import type { ItemSummary, Role } from "@/lib/types";
import { cn } from "@/lib/utils";

const PAGE = 48;

const MEDIA_FILTERS: { value: Role | undefined; label: string }[] = [
  { value: undefined, label: "All" },
  { value: "video", label: "Video" },
  { value: "image", label: "Images" },
  { value: "screenshot", label: "Pages" },
  { value: "upload", label: "Uploads" },
];

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-3 py-1 text-xs whitespace-nowrap transition-colors",
        active ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function ItemCard({ item }: { item: ItemSummary }) {
  const preview = item.preview;
  const hasVideo = (item.media.video ?? 0) > 0;
  return (
    <Link to={`/items/${item.id}`} className="group mb-3 block break-inside-avoid">
      <div className="relative overflow-hidden rounded-lg border bg-muted">
        {preview ? (
          <img src={preview.url} alt={preview.caption || item.title} loading="lazy" className="block max-h-[26rem] w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.02]" />
        ) : (
          <div className="grid aspect-[4/3] place-items-center text-muted-foreground">
            <ImageIcon className="size-5" />
          </div>
        )}
        {hasVideo && (
          <span className="absolute bottom-2 left-2 grid size-7 place-items-center rounded-full bg-black/60 text-white backdrop-blur">
            <PlayIcon className="size-3.5 fill-current" />
          </span>
        )}
      </div>
      <div className="mt-1.5 px-0.5">
        <p className="line-clamp-2 text-sm leading-snug font-medium">{item.title || item.url || "Untitled"}</p>
        <p className="mt-0.5 truncate font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
          {item.kind === "upload" ? "upload" : item.site}
          {item.author && ` · ${item.author}`}
        </p>
      </div>
    </Link>
  );
}

export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const tag = params.get("tag") ?? undefined;
  const media = (params.get("media") as Role | null) ?? undefined;
  const [draft, setDraft] = useState(q);

  // Search as you type, a beat after the last keystroke.
  useEffect(() => {
    if (draft === q) return;
    const timer = setTimeout(() => update({ q: draft || undefined }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  function update(next: Record<string, string | undefined>) {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) merged.set(key, value);
      else merged.delete(key);
    }
    setParams(merged, { replace: true });
  }

  const pages = useItemPages({ status: "done", q: q || undefined, tag, media }, PAGE);
  const loaded = pages.data?.pages.flatMap((page) => page.items) ?? [];
  const total = pages.data?.pages[0]?.total ?? 0;
  const tags = useTags();

  return (
    <div className="space-y-4">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search titles, notes, tags, page text"
          className="h-10 pr-9 pl-9"
          enterKeyHint="search"
        />
        {pages.isFetching && <Loader2Icon className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {MEDIA_FILTERS.map((f) => (
          <Chip key={f.label} active={media === f.value} onClick={() => update({ media: f.value })}>
            {f.label}
          </Chip>
        ))}
      </div>

      {(tags.data?.tags.length ?? 0) > 0 && (
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          {tag && (
            <Chip active onClick={() => update({ tag: undefined })}>
              <span className="flex items-center gap-1">
                #{tag} <XIcon className="size-3" />
              </span>
            </Chip>
          )}
          {tags.data!.tags
            .filter((t) => t.tag !== tag)
            .map((t) => (
              <Chip key={t.tag} active={false} onClick={() => update({ tag: t.tag })}>
                #{t.tag} <span className="tabular opacity-60">{t.count}</span>
              </Chip>
            ))}
        </div>
      )}

      {pages.error ? (
        <ErrorMessage error={pages.error} title="Could not load the library" />
      ) : pages.isPending ? (
        <div className="columns-2 gap-3 sm:columns-3 lg:columns-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="mb-3 w-full rounded-lg" style={{ height: 120 + (i % 3) * 60 }} />
          ))}
        </div>
      ) : loaded.length === 0 ? (
        <EmptyState icon={ImagesIcon} title={q || tag || media ? "Nothing matches" : "Nothing saved yet"}>
          {q || tag || media ? (
            "Try fewer words or clear a filter."
          ) : (
            <>
              <Link to="/add" className="underline underline-offset-4">
                Add a link or a screenshot
              </Link>{" "}
              and it shows up here once the worker has pulled it.
            </>
          )}
        </EmptyState>
      ) : (
        <>
          <p className="eyebrow">
            {total} {total === 1 ? "item" : "items"}
          </p>
          <div className="columns-2 gap-3 sm:columns-3 lg:columns-4">
            {loaded.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
          {pages.hasNextPage && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => void pages.fetchNextPage()} disabled={pages.isFetchingNextPage}>
                {pages.isFetchingNextPage && <Loader2Icon className="animate-spin" />}
                Show more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
