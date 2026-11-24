export type Actor = { kind: "owner"; email: string } | { kind: "credential"; id: number; name: string };

export type Status = "queued" | "processing" | "done" | "failed";
export type Role = "upload" | "image" | "video" | "thumbnail" | "screenshot";

export interface Asset {
  id: number;
  role: Role;
  content_type: string;
  size_bytes: number;
  source_url: string | null;
  caption: string;
  position: number;
  created_at: string;
  /** Presigned; valid for one hour. */
  url: string;
}

interface ItemBase {
  id: number;
  kind: "link" | "upload";
  url: string | null;
  site: string;
  note: string;
  status: Status;
  title: string;
  description: string;
  tags: string[];
  author: string;
  attempts: number;
  last_error: string | null;
  claimed_by: string | null;
  claim_expires_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
}

export interface ItemSummary extends ItemBase {
  media: Partial<Record<Role, number>>;
  preview: Asset | null;
}

export interface ItemDetail extends ItemBase {
  extracted_text: string;
  assets: Asset[];
}

export interface ItemPage {
  items: ItemSummary[];
  total: number;
}

export interface TagCount {
  tag: string;
  count: number;
}
