import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, LogOutIcon, ShieldAlertIcon } from "lucide-react";
import { ErrorMessage } from "@/components/common";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { ApiError, api, setUnauthorizedHandler } from "@/lib/api";
import { authClient, signOut } from "@/lib/auth";
import type { Actor } from "@/lib/types";
import { LoginPage } from "@/pages/login";

type AuthState = { status: "signed-out" } | { status: "unauthorized"; email: string } | { status: "ready"; email: string };

const SessionContext = createContext<{ email: string; signOut: () => Promise<void> } | null>(null);

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside AuthGate");
  return session;
}

async function loadAuth(): Promise<AuthState> {
  const { data, error } = await authClient.getSession();
  if (error) throw new Error(error.message ?? "could not check the session");
  if (!data?.user) return { status: "signed-out" };
  try {
    await api<{ actor: Actor }>("/me");
    return { status: "ready", email: data.user.email };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      return e.code === "no_session" ? { status: "signed-out" } : { status: "unauthorized", email: data.user.email };
    }
    throw e;
  }
}

export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const auth = useQuery({ queryKey: ["auth"], queryFn: loadAuth, staleTime: Infinity, retry: false });

  useEffect(() => {
    // A 401 mid-session (expired session or a revoked owner) re-checks who is signed in. Only from
    // the signed-in state: the auth check itself calls /me, and must not re-trigger itself.
    setUnauthorizedHandler(() => {
      if (queryClient.getQueryData<AuthState>(["auth"])?.status === "ready") void queryClient.invalidateQueries({ queryKey: ["auth"] });
    });
  }, [queryClient]);

  const doSignOut = async () => {
    await signOut();
    // Drop every cached library read, then re-run the auth check so the gate shows the login page.
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
    await queryClient.resetQueries({ queryKey: ["auth"] });
  };

  if (auth.isPending) {
    return (
      <div className="grid min-h-svh place-items-center">
        <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (auth.error) {
    return (
      <div className="mx-auto grid min-h-svh max-w-md place-items-center p-4">
        <div className="w-full space-y-3">
          <ErrorMessage error={auth.error} title="Could not reach the Swipe List" />
          <Button variant="outline" onClick={() => auth.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  const state = auth.data;
  if (state.status === "signed-out") return <LoginPage onSignedIn={() => queryClient.invalidateQueries({ queryKey: ["auth"] })} />;
  if (state.status === "unauthorized") {
    return (
      <div className="grid min-h-svh place-items-center bg-background p-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <BrandMark className="mx-auto" />
          <div className="space-y-2">
            <ShieldAlertIcon className="mx-auto size-6 text-critical" />
            <h1 className="text-lg font-semibold">This account is not authorized</h1>
            <p className="text-sm text-muted-foreground">
              You are signed in as <span className="font-medium text-foreground">{state.email}</span>, which is not the owner of this Swipe List.
              Sign out and use the owner email.
            </p>
          </div>
          <Button onClick={doSignOut} variant="outline" className="w-full">
            <LogOutIcon />
            Sign out
          </Button>
        </div>
      </div>
    );
  }
  return <SessionContext.Provider value={{ email: state.email, signOut: doSignOut }}>{children}</SessionContext.Provider>;
}
