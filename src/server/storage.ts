import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import { AppError, invalid } from "./errors.ts";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Media bytes live in Neon Object Storage; Postgres keeps the key. */
export interface Storage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Read a bounded prefix, metadata and ETag from the same S3 object version. */
  inspectUpload(key: string): Promise<UploadSnapshot | null>;
  copyUpload(source: string, destination: string, snapshot: UploadSnapshot): Promise<void>;
  list(prefix: string): Promise<string[]>;
  delete(keys: string[]): Promise<void>;
  /** A URL the holder can PUT the object's bytes to, with this exact content type. */
  presignPut(key: string, contentType: string): Promise<string>;
  /** A URL the holder can GET the object from (supports Range, so videos stream). */
  presignGet(key: string): Promise<string>;
}

export interface UploadSnapshot {
  size: number;
  contentType: string;
  etag: string;
  prefix: Uint8Array;
}
export const PREFIX_BYTES = 512;
export const PRESIGN_SECONDS = 60 * 60;

/** Credentials, endpoint and region come from the AWS_* variables Neon provisions. */
export function s3Storage(bucket: string, s3 = new S3Client({ forcePathStyle: true, requestChecksumCalculation: "WHEN_REQUIRED" })): Storage {
  return {
    async put(key, body, contentType) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async inspectUpload(key) {
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${PREFIX_BYTES - 1}` }));
        const match = res.ContentRange?.match(/^bytes 0-(\d+)\/(\d+)$/);
        const size = Number(match?.[2]);
        const length = Math.min(size, PREFIX_BYTES);
        if (!res.Body || !res.ETag || !Number.isSafeInteger(size) || size <= 0 ||
            Number(match?.[1]) !== length - 1 || res.ContentLength !== length) {
          (res.Body as Readable | undefined)?.destroy();
          throw invalid("storage did not return a bounded, versioned media header");
        }
        const prefix = await res.Body.transformToByteArray();
        if (prefix.length !== length) throw invalid("incomplete media header");
        return { size, contentType: res.ContentType ?? "", etag: res.ETag, prefix };
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404) return null;
        if (status === 416) throw invalid("the uploaded file is empty");
        throw error;
      }
    },
    async copyUpload(source, destination, snapshot) {
      try {
        await s3.send(new CopyObjectCommand({
          Bucket: bucket, Key: destination,
          CopySource: [bucket, ...source.split("/")].map(encodeURIComponent).join("/"),
          CopySourceIfMatch: snapshot.etag, IfNoneMatch: "*",
          MetadataDirective: "REPLACE", ContentType: snapshot.contentType,
        }));
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 412 || status === 409 || status === 404) {
          throw new AppError(409, "upload_changed", "the upload changed during promotion");
        }
        throw error;
      }
    },
    async list(prefix) {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
        for (const object of res.Contents ?? []) if (object.Key) keys.push(object.Key);
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
      return keys;
    },
    async delete(keys) {
      for (let i = 0; i < keys.length; i += 1000) {
        const batch = keys.slice(i, i + 1000);
        const res = await s3.send(
          new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }),
        );
        if (res.Errors?.length) throw new Error(`could not delete ${res.Errors.map((e) => `${e.Key}: ${e.Message}`).join(", ")}`);
      }
    },
    presignPut(key, contentType) {
      return getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), {
        expiresIn: PRESIGN_SECONDS,
        signableHeaders: new Set(["content-type"]),
      });
    },
    presignGet(key) {
      return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: PRESIGN_SECONDS });
    },
  };
}
