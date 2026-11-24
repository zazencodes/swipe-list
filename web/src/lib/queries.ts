import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError, qs } from "./api";
import type { ItemDetail, ItemPage, Role, Status, TagCount } from "./types";

export interface ItemFilter {
  q?: string;
  status?: Status;
  tag?: string;
  media?: Role;
  limit?: number;
}

/** Items still in the queue refresh on their own until the worker finishes them. */
const QUEUE_POLL_MS = 10_000;

export function useItems(filter: ItemFilter) {
  return useQuery({
    queryKey: ["items", filter],
    queryFn: () => api<ItemPage>(`/items${qs(filter)}`),
    placeholderData: (previous) => previous,
    refetchInterval: (query) =>
      query.state.data?.items.some((i) => i.status === "queued" || i.status === "processing") ? QUEUE_POLL_MS : false,
  });
}

/** The library, a page at a time: `fetchNextPage` loads the next `pageSize` items. */
export function useItemPages(filter: Omit<ItemFilter, "limit">, pageSize: number) {
  return useInfiniteQuery({
    queryKey: ["items", "pages", filter, pageSize],
    queryFn: ({ pageParam }) => api<ItemPage>(`/items${qs({ ...filter, limit: pageSize, offset: pageParam })}`),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, page) => n + page.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    placeholderData: (previous) => previous,
  });
}

export function useItem(id: number) {
  return useQuery({
    queryKey: ["item", id],
    queryFn: () => api<ItemDetail>(`/items/${id}`),
    refetchInterval: (query) => (query.state.data?.status === "queued" || query.state.data?.status === "processing" ? QUEUE_POLL_MS : false),
  });
}

export function useTags() {
  return useQuery({ queryKey: ["tags"], queryFn: () => api<{ tags: TagCount[] }>("/tags") });
}

export function errorText(error: unknown): string {
  return error instanceof ApiError && error.problems.length ? `${error.message}: ${error.problems.join("; ")}` : (error as Error).message;
}

/** A write that refreshes every library read on success and reports failure as a toast. */
export function useLibraryMutation<V, R = unknown>(fn: (vars: V) => Promise<R>, success?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      if (success) toast.success(success);
      await queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
    },
    onError: (error) => toast.error(errorText(error)),
  });
}
