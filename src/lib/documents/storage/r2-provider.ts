// R2Provider — the DocumentStorageProvider implementation for Cloudflare R2
// (docs/APPLICANT-DOCUMENTS-PHASE1-BRIEF.md §2). R2 is fully S3-API-compatible,
// so this is built on the standard AWS SDK v3 (@aws-sdk/client-s3 +
// @aws-sdk/s3-request-presigner) pointed at R2's S3-compatible endpoint —
// same mechanics an S3 integration would use, just a different endpoint/creds.
//
// R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME/R2_ENDPOINT
// are not provisioned yet (Cloudflare billing/bucket setup is a separate,
// deliberately deferred manual step) — getDocumentStorageProvider() throws a
// clear error if called before they exist in the environment. The class
// itself takes an injected S3Client so it can be constructed and unit-tested
// against a mock with zero real network calls, independent of env state.

import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectsCommand, CopyObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { DocumentStorageProvider } from "./provider";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  endpoint: string;
}

const REQUIRED_ENV_VARS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_ENDPOINT",
] as const;

export function readR2ConfigFromEnv(): R2Config {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `R2 storage is not configured — missing env var(s): ${missing.join(", ")}. ` +
        "Cloudflare R2 bucket/token provisioning is a separate manual step (see docs/APPLICANT-DOCUMENTS-PHASE1-BRIEF.md §2).",
    );
  }
  return {
    accountId: process.env.R2_ACCOUNT_ID!,
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    bucketName: process.env.R2_BUCKET_NAME!,
    endpoint: process.env.R2_ENDPOINT!,
  };
}

const UPLOAD_URL_EXPIRY_SECONDS = 5 * 60; // single-use, short window before the client PUTs

export class R2Provider implements DocumentStorageProvider {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async createSignedUploadUrl(key: string, contentType: string): Promise<{ url: string; headers?: Record<string, string> }> {
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType });
    const url = await getSignedUrl(this.client, command, { expiresIn: UPLOAD_URL_EXPIRY_SECONDS });
    return { url, headers: { "Content-Type": contentType } };
  }

  async createSignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async getBytes(key: string): Promise<Uint8Array> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!response.Body) {
      throw new Error(`getBytes failed for ${key}: empty response body`);
    }
    // AWS SDK v3's Node runtime decorates Body with the SdkStream mixin.
    return response.Body.transformToByteArray();
  }

  async remove(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const command = new DeleteObjectsCommand({
      Bucket: this.bucket,
      Delete: { Objects: keys.map((Key) => ({ Key })) },
    });
    const response = await this.client.send(command);
    if (response.Errors && response.Errors.length > 0) {
      const detail = response.Errors.map((e) => `${e.Key}: ${e.Message}`).join("; ");
      throw new Error(`remove failed for one or more keys in ${this.bucket}: ${detail}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      const name = (err as { name?: string } | undefined)?.name;
      const status = (err as { $metadata?: { httpStatusCode?: number } } | undefined)?.$metadata?.httpStatusCode;
      // A genuinely-missing object throws "NotFound" (404) — that's the only
      // case that means false. Anything else (network blip, auth failure,
      // 5xx) must propagate as a real error, never be silently read as
      // "doesn't exist" — that would let a transient R2 outage wrongly fail
      // a real upload.
      if (name === "NotFound" || status === 404) return false;
      throw err;
    }
  }

  async copy(fromKey: string, toKey: string): Promise<void> {
    const command = new CopyObjectCommand({
      Bucket: this.bucket,
      Key: toKey,
      CopySource: `${this.bucket}/${encodeURIComponent(fromKey)}`,
    });
    await this.client.send(command);
  }
}

let cached: DocumentStorageProvider | null = null;

export function getDocumentStorageProvider(): DocumentStorageProvider {
  if (!cached) {
    const config = readR2ConfigFromEnv();
    const client = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
    cached = new R2Provider(client, config.bucketName);
  }
  return cached;
}
