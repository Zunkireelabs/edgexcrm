// StorageProvider seam (docs/ai-native-efforts/working/BRIEF-PHASE-2A-STORAGE-SEAM-SCHEMA.md,
// amendment §0.3 of docs/ai-native-efforts/02-PHASE-2-KNOWLEDGE-LAYER.md).
//
// Interface-first: SupabaseStorageProvider wraps the existing supabase-js
// service-role storage client today. An R2StorageProvider (AWS SDK v3) is
// written only when that lever is actually pulled — consumers only ever see
// the interface, so that swap touches this file alone.
//
// Storage is not tenant-RLS'd the way tables are — path prefixes carry
// tenancy. Callers stay responsible for passing tenant-prefixed paths, same
// as before this seam existed.

import { createServiceClient } from "@/lib/supabase/server";

export interface StorageProvider {
  createSignedUploadUrl(bucket: string, path: string): Promise<{ url: string; token?: string }>;
  getSignedDownloadUrl(bucket: string, path: string, expiresInSeconds: number): Promise<string>;
  // Server-side credentialed fetch — for the 2B ingestion pipeline. NEVER
  // signed URLs; signed URLs are for humans in the browser.
  getBytes(bucket: string, path: string): Promise<Uint8Array>;
  remove(bucket: string, paths: string[]): Promise<void>;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Rounds a signed-URL expiry UP to the next hour boundary (relative to `now`)
 * instead of "exactly N seconds from this call" — so repeated requests for
 * the same object within the same hour resolve to the same expiry timestamp,
 * which is what lets a future CDN cache the signed response. Floors at 60s
 * (Supabase's own minimum).
 */
export function roundExpiryToHour(expiresInSeconds: number, now: Date = new Date()): number {
  const targetMs = now.getTime() + Math.max(0, expiresInSeconds) * 1000;
  const roundedTargetMs = Math.ceil(targetMs / ONE_HOUR_MS) * ONE_HOUR_MS;
  const roundedSeconds = Math.round((roundedTargetMs - now.getTime()) / 1000);
  return Math.max(60, roundedSeconds);
}

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

export class SupabaseStorageProvider implements StorageProvider {
  constructor(private readonly getClient: () => Promise<ServiceClient> = createServiceClient) {}

  async createSignedUploadUrl(bucket: string, path: string): Promise<{ url: string; token?: string }> {
    const client = await this.getClient();
    const { data, error } = await client.storage.from(bucket).createSignedUploadUrl(path);
    if (error || !data) {
      throw new Error(`createSignedUploadUrl failed for ${bucket}/${path}: ${error?.message ?? "no data"}`);
    }
    return { url: data.signedUrl, token: data.token };
  }

  async getSignedDownloadUrl(bucket: string, path: string, expiresInSeconds: number): Promise<string> {
    const client = await this.getClient();
    const rounded = roundExpiryToHour(expiresInSeconds);
    const { data, error } = await client.storage.from(bucket).createSignedUrl(path, rounded);
    if (error || !data) {
      throw new Error(`getSignedDownloadUrl failed for ${bucket}/${path}: ${error?.message ?? "no data"}`);
    }
    return data.signedUrl;
  }

  async getBytes(bucket: string, path: string): Promise<Uint8Array> {
    const client = await this.getClient();
    const { data, error } = await client.storage.from(bucket).download(path);
    if (error || !data) {
      throw new Error(`getBytes failed for ${bucket}/${path}: ${error?.message ?? "no data"}`);
    }
    return new Uint8Array(await data.arrayBuffer());
  }

  async remove(bucket: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const client = await this.getClient();
    const { error } = await client.storage.from(bucket).remove(paths);
    if (error) {
      throw new Error(`remove failed for ${bucket}: ${error.message}`);
    }
  }
}

let cached: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (!cached) cached = new SupabaseStorageProvider();
  return cached;
}
