import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Link, Route, Routes } from "react-router";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/hooks/use-theme";
import { ApiError } from "@/lib/api";
import { AddPage } from "@/pages/add";
import { ItemPage } from "@/pages/item";
import { LibraryPage } from "@/pages/library";
import { QueuePage } from "@/pages/queue";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // Client errors (bad filter, not found, unauthorized) will not fix themselves on retry.
      retry: (failures, error) => !(error instanceof ApiError && error.status < 500) && failures < 2,
    },
  },
});

function NotFoundPage() {
  return (
    <div className="space-y-2 py-10 text-center">
      <p className="font-medium">Nothing here</p>
      <Link to="/" className="text-sm text-muted-foreground underline underline-offset-4">
        Back to the library
      </Link>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthGate>
          <ThemeProvider>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<LibraryPage />} />
                <Route path="add" element={<AddPage />} />
                <Route path="queue" element={<QueuePage />} />
                <Route path="items/:id" element={<ItemPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
            <Toaster position="top-center" />
          </ThemeProvider>
        </AuthGate>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
