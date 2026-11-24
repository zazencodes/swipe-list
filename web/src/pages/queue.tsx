import { Link } from "react-router";
import { CheckCircle2Icon, ImageIcon, LinkIcon, RotateCwIcon } from "lucide-react";
import { EmptyState, ErrorMessage, StatusBadge, timeAgo } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useItems, useLibraryMutation } from "@/lib/queries";
import type { ItemSummary, Status } from "@/lib/types";

function QueueRow({ item }: { item: ItemSummary }) {
  const retry = useLibraryMutation(() => api(`/items/${item.id}/retry`, { method: "POST" }), "Queued again");
  const Icon = item.kind === "upload" ? ImageIcon : LinkIcon;
  return (
    <li className="flex gap-3 py-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <Link to={`/items/${item.id}`} className="block truncate text-sm font-medium hover:underline">
          {item.title || item.url || "Uploaded images"}
        </Link>
        {item.note && <p className="line-clamp-2 text-xs text-muted-foreground">{item.note}</p>}
        {item.status === "failed" && item.last_error && <p className="line-clamp-3 text-xs text-critical">{item.last_error}</p>}
        <div className="flex items-center gap-2">
          <StatusBadge status={item.status} />
          <span className="text-xs text-muted-foreground">
            {timeAgo(item.created_at)}
            {item.attempts > 1 && ` · attempt ${item.attempts}`}
          </span>
        </div>
      </div>
      {item.status === "failed" && (
        <Button variant="outline" size="sm" disabled={retry.isPending} onClick={() => retry.mutate(undefined)}>
          <RotateCwIcon /> Retry
        </Button>
      )}
    </li>
  );
}

function Section({ status, title }: { status: Status; title: string }) {
  const items = useItems({ status, limit: 100 });
  if (items.error) return <ErrorMessage error={items.error} title={`Could not load ${status} items`} />;
  if (items.isPending) return <Skeleton className="h-16 w-full" />;
  if (items.data.items.length === 0) return null;
  return (
    <section>
      <p className="eyebrow">
        {title} · {items.data.total}
      </p>
      <ul className="divide-y">
        {items.data.items.map((item) => (
          <QueueRow key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}

export function QueuePage() {
  const queued = useItems({ status: "queued", limit: 1 });
  const processing = useItems({ status: "processing", limit: 1 });
  const failed = useItems({ status: "failed", limit: 1 });
  const loaded = queued.data && processing.data && failed.data;
  const empty = loaded && queued.data!.total + processing.data!.total + failed.data!.total === 0;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Queue</h1>
        <p className="text-sm text-muted-foreground">The worker on your Mac checks every 5 minutes while the Mac is awake.</p>
      </div>
      {empty ? (
        <EmptyState icon={CheckCircle2Icon} title="Nothing waiting">
          Everything you added has been pulled into the library.
        </EmptyState>
      ) : (
        <>
          <Section status="processing" title="Pulling now" />
          <Section status="queued" title="Waiting" />
          <Section status="failed" title="Failed" />
        </>
      )}
    </div>
  );
}
