import { cn } from "@/lib/utils";

/** The app mark: three fanned cards, a swipe file, drawn in the current ink. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground", className)} aria-hidden>
      <svg viewBox="0 0 20 20" className="size-4" fill="currentColor">
        <rect x="3" y="5" width="9" height="12" rx="1.5" opacity="0.45" transform="rotate(-12 7.5 11)" />
        <rect x="5.5" y="4" width="9" height="12" rx="1.5" opacity="0.7" />
        <rect x="8" y="3" width="9" height="12" rx="1.5" transform="rotate(10 12.5 9)" />
      </svg>
    </span>
  );
}
