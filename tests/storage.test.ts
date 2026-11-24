import { CopyObjectCommand, type CopyObjectCommandOutput, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { s3Storage, type UploadSnapshot } from "../src/server/storage.ts";
import { matchesMediaType } from "../src/server/domain/media.ts";

const snapshot: UploadSnapshot = { size: 8, prefix: new Uint8Array(8), etag: '"test-version"', contentType: "image/png" };

function client() {
  return new S3Client({
    endpoint: "https://storage.example.invalid", region: "test", forcePathStyle: true,
    credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" }, requestChecksumCalculation: "WHEN_REQUIRED",
    requestHandler: { handle() { throw new Error("storage tests use no transport"); } },
  });
}

describe("storage upload integrity", () => {
  it("signs the content type on the staging PUT", async () => {
    const storage = s3Storage("media", client());
    const key = "items/1/worker-temp/example/image.png";
    const url = new URL(await storage.presignPut(key, snapshot.contentType));
    expect(url.pathname).toBe(`/media/${key}`);
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toContain("content-type");
  });

  it("conditions the copy on the inspected source and a new destination", async () => {
    const s3 = client();
    const sender: { send(command: CopyObjectCommand): Promise<CopyObjectCommandOutput> } = s3;
    const send = vi.spyOn(sender, "send").mockResolvedValue({ $metadata: {} });
    await s3Storage("media", s3).copyUpload("items/1/worker-temp/file", "items/1/worker-media/final.png", snapshot);
    const [command] = send.mock.calls[0]!;
    expect(command).toBeInstanceOf(CopyObjectCommand);
    expect(command.input).toMatchObject({
      CopySource: "media/items/1/worker-temp/file", CopySourceIfMatch: snapshot.etag,
      Key: "items/1/worker-media/final.png", IfNoneMatch: "*", ContentType: snapshot.contentType, MetadataDirective: "REPLACE",
    });
  });

  it.each([
    ["image/jpeg", "ffd8ffe0"], ["image/png", "89504e470d0a1a0a"],
    ["image/gif", "474946383961"], ["image/webp", "524946460000000057454250"],
    ["image/avif", "00000014667479706d6966310000000061766966"],
    ["video/mp4", "000000106674797069736f6d00000000"],
    ["video/quicktime", "0000001466747970717420200000000071742020"],
    ["video/webm", "1a45dfa38b4282847765626d"],
  ])("recognizes the %s container and rejects an empty prefix", (type, hex) => {
    expect(matchesMediaType(Buffer.from(hex, "hex"), type)).toBe(true);
    expect(matchesMediaType(new Uint8Array(), type)).toBe(false);
  });
});
