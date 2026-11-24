import type { ReactNode } from "react";
import { AlertCircleIcon, type LucideIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api";
import type { Status } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ErrorMessage({ error, title, className }: { error: unknown; title?: string; className?: string }) {
  const message = error instanceof Error ? error.message : String(error);
  const problems = error instanceof ApiError ? error.problems : [];
  return (
    <Alert variant="destructive" className={className}>
      <AlertCircleIcon />
      <AlertTitle>{title ?? "Something went wrong"}</AlertTitle>
      <AlertDescription>
        <p>{message}</p>
        {problems.length > 0 && (
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function EmptyState({ icon: Icon, title, children, className }: { icon: LucideIcon; title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center", className)}>
      <Icon className="size-5 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

const STATUS_STYLE: Record<Status, string> = {
  queued: "border-foreground/20 text-muted-foreground",
  processing: "border-warning/40 text-warning",
  done: "border-foreground/20 text-muted-foreground",
  failed: "border-critical/40 text-critical",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge variant="outline" className={cn("font-mono text-[11px] uppercase tracking-wider", STATUS_STYLE[status])}>
      {status}
    </Badge>
  );
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "3 minutes ago", "yesterday", "Oct 12". */
export function timeAgo(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 60) return "just now";
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86400) return relative.format(Math.round(seconds / 86400), "day");
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric", year: abs > 300 * 86400 ? "numeric" : undefined });
}
