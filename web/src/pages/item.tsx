import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeftIcon, ExternalLinkIcon, Loader2Icon, RotateCwIcon, Trash2Icon } from "lucide-react";
import { ErrorMessage, StatusBadge, timeAgo } from "@/components/common";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useItem, useLibraryMutation } from "@/lib/queries";
import type { Asset, ItemDetail } from "@/lib/types";

function Media({ asset, poster }: { asset: Asset; poster?: string }) {
  if (asset.content_type.startsWith("video/")) {
    return <video src={asset.url} poster={poster} controls playsInline preload="metadata" className="w-full rounded-lg border bg-black" />;
  }
  return (
    <a href={asset.url} target="_blank" rel="noreferrer">
      <img src={asset.url} alt={asset.caption} className="w-full rounded-lg border" />
    </a>
  );
}

function Gallery({ item }: { item: ItemDetail }) {
  // A thumbnail is the poster of the video it belongs to; show it as its own image only without a video.
  const videos = item.assets.filter((a) => a.role === "video");
  const thumbnails = item.assets.filter((a) => a.role === "thumbnail");
  const shown = item.assets.filter((a) => a.role !== "thumbnail" || videos.length === 0);
  return (
    <div className="space-y-4">
      {shown.map((asset) => (
        <figure key={asset.id} className="space-y-1.5">
          <Media asset={asset} poster={asset.role === "video" ? thumbnails[videos.indexOf(asset)]?.url : undefined} />
          {asset.caption && <figcaption className="text-xs text-muted-foreground">{asset.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}

function DeleteButton({ item }: { item: ItemDetail }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  // Leave the page before the library refreshes, so the deleted item is never refetched.
  const remove = useLibraryMutation(async () => {
    await api(`/items/${item.id}`, { method: "DELETE" });
    navigate(item.status === "done" ? "/" : "/queue", { replace: true });
  }, "Deleted");
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Trash2Icon /> Delete
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this item?</DialogTitle>
            <DialogDescription>
              {item.title || item.url || "This item"} and its {item.assets.length} {item.assets.length === 1 ? "file" : "files"} are deleted for good.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate(undefined)}
            >
              {remove.isPending && <Loader2Icon className="animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ItemPage() {
  const id = Number(useParams().id);
  const item = useItem(id);
  const retry = useLibraryMutation(() => api(`/items/${id}/retry`, { method: "POST" }), "Queued again");

  if (item.error) return <ErrorMessage error={item.error} title="Could not load this item" />;
  if (item.isPending) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="aspect-video w-full rounded-lg" />
      </div>
    );
  }
  const data = item.data;
  const busy = data.status === "queued" || data.status === "processing";

  return (
    <article className="mx-auto max-w-3xl space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => history.back()}>
        <ArrowLeftIcon /> Back
      </Button>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {data.status !== "done" && <StatusBadge status={data.status} />}
          <span className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
            {data.kind === "upload" ? "upload" : data.site}
            {data.author && ` · ${data.author}`} · saved {timeAgo(data.created_at)}
          </span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-balance">{data.title || data.url || "Waiting for the worker"}</h1>
      </header>

      {data.status === "failed" && (
        <Alert variant="destructive">
          <AlertTitle>The worker could not pull this</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">{data.last_error}</AlertDescription>
        </Alert>
      )}
      {busy && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          {data.status === "queued" ? "Queued. The worker on your Mac checks every 5 minutes." : "The worker is pulling this now."}
        </p>
      )}

      {data.assets.length > 0 && <Gallery item={data} />}

      {data.note && (
        <section className="space-y-1">
          <p className="eyebrow">Your note</p>
          <p className="text-sm whitespace-pre-wrap">{data.note}</p>
        </section>
      )}
      {data.description && (
        <section className="space-y-1">
          <p className="eyebrow">Description</p>
          <p className="text-sm text-muted-foreground">{data.description}</p>
        </section>
      )}
      {data.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {data.tags.map((t) => (
            <Link key={t} to={`/?tag=${encodeURIComponent(t)}`} className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground">
              #{t}
            </Link>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t pt-4">
        {data.url && (
          <Button variant="outline" asChild>
            <a href={data.url} target="_blank" rel="noreferrer">
              <ExternalLinkIcon /> Open source
            </a>
          </Button>
        )}
        {data.status === "failed" && (
          <Button variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(undefined)}>
            <RotateCwIcon /> Retry
          </Button>
        )}
        <DeleteButton item={data} />
      </div>

      {data.extracted_text && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Text from the source</summary>
          <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{data.extracted_text}</p>
        </details>
      )}
    </article>
  );
}
