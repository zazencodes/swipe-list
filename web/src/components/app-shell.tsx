import { NavLink, Outlet } from "react-router";
import { ImagesIcon, ListTodoIcon, LogOutIcon, MonitorIcon, MoonIcon, PlusIcon, SunIcon } from "lucide-react";
import { useSession } from "@/components/auth-gate";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme, type ThemeChoice } from "@/hooks/use-theme";
import { useItems } from "@/lib/queries";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Library", icon: ImagesIcon, end: true },
  { to: "/add", label: "Add", icon: PlusIcon, end: false },
  { to: "/queue", label: "Queue", icon: ListTodoIcon, end: false },
];

/** Number of items waiting for or failed by the worker, shown on the Queue tab. */
function useQueueCount() {
  const queued = useItems({ status: "queued", limit: 1 });
  const processing = useItems({ status: "processing", limit: 1 });
  const failed = useItems({ status: "failed", limit: 1 });
  return {
    pending: (queued.data?.total ?? 0) + (processing.data?.total ?? 0),
    failed: failed.data?.total ?? 0,
  };
}

function QueueBadge() {
  const { pending, failed } = useQueueCount();
  if (!pending && !failed) return null;
  return (
    <span
      className={cn(
        "tabular ml-1 rounded-full px-1.5 text-[10px] font-medium leading-4",
        failed ? "bg-critical text-white" : "bg-foreground/10 text-foreground",
      )}
    >
      {failed || pending}
    </span>
  );
}

function AccountMenu() {
  const { email, signOut } = useSession();
  const { choice, setChoice } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Account and theme">
          <span className="grid size-7 place-items-center rounded-full bg-foreground/10 text-xs font-medium uppercase">{email[0]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={choice} onValueChange={(v) => setChoice(v as ThemeChoice)}>
          <DropdownMenuRadioItem value="system">
            <MonitorIcon /> System
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">
            <SunIcon /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <MoonIcon /> Dark
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOutIcon /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell() {
  return (
    <div className="min-h-svh pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
      <header className="sticky top-0 z-30 border-b bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <NavLink to="/" className="flex items-center gap-2.5">
            <BrandMark className="size-7" />
            <span className="font-semibold tracking-tight">Swipe List</span>
          </NavLink>
          <nav className="ml-6 hidden items-center gap-1 md:flex">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground",
                    isActive && "bg-accent text-foreground",
                  )
                }
              >
                <Icon className="size-4" />
                {label}
                {to === "/queue" && <QueueBadge />}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto">
            <AccountMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="grid h-16 grid-cols-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn("flex flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground", isActive && "text-foreground")
              }
            >
              <span className="flex items-center">
                <Icon className="size-5" />
                {to === "/queue" && <QueueBadge />}
              </span>
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
