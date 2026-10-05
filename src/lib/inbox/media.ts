// Inbound WhatsApp media resolution — download Meta's media bytes and persist our own
// copy (docs/INBOX-ATTACHMENTS-BRIEF.md §2/§4-D2). Meta sends a media ID, never a URL
// or bytes inline: getting the bytes is TWO authenticated calls, both bearing the
// channel's access token, and the intermediate url expires in ~5 minutes — so this must
// run during inbound processing, never lazily at render time.
//
// Deliberately NOT in the adapter: the adapter's job is parsing a payload into a typed
// descriptor with zero network calls (provider-agnostic contract, see types.ts). This
// module does the WhatsApp-specific network+storage work the processor calls into.

import { GRAPH_API_BASE } from "./graph-api";
import { getStorageProvider } from "@/lib/storage/provider";
import { logger } from "@/lib/logger";
import type { InboundMediaDescriptor } from "./adapters/types";

export const INBOX_MEDIA_BUCKET = "inbox-media";
export const INBOX_MEDIA_MAX_BYTES = 20 * 1024 * 1024; // 20 MB — matches the bucket's file_size_limit

// Final shape written to messages.attachments once resolved. A failed resolve still
// gets an entry (never silently drops the attachment) with `error` set and no `path`.
export interface ResolvedAttachment {
  type: InboundMediaDescriptor["type"];
  provider_media_id: string;
  bucket?: string;
  path?: string;
  filename: string | null;
  mime_type: string | null;
  size?: number;
  error?: string;
}

function extensionFor(mimeType: string | null): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "video/mp4": "mp4",
  };
  return (mimeType && map[mimeType]) || "bin";
}

interface GraphMediaMeta {
  url?: string;
  mime_type?: string;
  file_size?: number;
}

type FetchFn = typeof fetch;

// Resolves + downloads + persists ONE attachment. Never throws — every failure mode
// (bad token, unreachable Graph host, over size cap, storage write failure) returns an
// error-marked ResolvedAttachment instead, per §5: a media failure must never take the
// message's text down with it.
export async function resolveAndStoreAttachment(
  params: {
    descriptor: InboundMediaDescriptor;
    accessToken: string;
    tenantId: string;
    conversationId: string;
    messageId: string;
    index: number;
  },
  fetchImpl: FetchFn = fetch
): Promise<ResolvedAttachment> {
  const { descriptor, accessToken, tenantId, conversationId, messageId, index } = params;
  const base: ResolvedAttachment = {
    type: descriptor.type,
    provider_media_id: descriptor.providerMediaId,
    filename: descriptor.filename,
    mime_type: descriptor.mimeType,
  };

  try {
    // Step 1: resolve the media id to a short-lived url (+ authoritative mime/size).
    const metaRes = await fetchImpl(`${GRAPH_API_BASE}/${descriptor.providerMediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!metaRes.ok) {
      throw new Error(`media metadata fetch failed (${metaRes.status})`);
    }
    const meta = (await metaRes.json()) as GraphMediaMeta;
    if (!meta.url) throw new Error("media metadata response had no url");

    if (typeof meta.file_size === "number" && meta.file_size > INBOX_MEDIA_MAX_BYTES) {
      throw new Error(`media exceeds ${INBOX_MEDIA_MAX_BYTES} byte cap (reported ${meta.file_size})`);
    }

    // Step 2: download the bytes — the url alone is not enough, the bearer header is required too.
    const bytesRes = await fetchImpl(meta.url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!bytesRes.ok) {
      throw new Error(`media download failed (${bytesRes.status})`);
    }
    const arrayBuffer = await bytesRes.arrayBuffer();
    if (arrayBuffer.byteLength > INBOX_MEDIA_MAX_BYTES) {
      // file_size wasn't available up front — enforce the cap after the fact too.
      throw new Error(`downloaded media exceeds ${INBOX_MEDIA_MAX_BYTES} byte cap (${arrayBuffer.byteLength} bytes)`);
    }

    const mimeType = meta.mime_type ?? descriptor.mimeType ?? "application/octet-stream";
    const ext = extensionFor(mimeType);
    const path = `${tenantId}/inbox/${conversationId}/${messageId}-${index}.${ext}`;

    await getStorageProvider().putBytes(INBOX_MEDIA_BUCKET, path, new Uint8Array(arrayBuffer), mimeType);

    return {
      ...base,
      bucket: INBOX_MEDIA_BUCKET,
      path,
      mime_type: mimeType,
      size: arrayBuffer.byteLength,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err, conversationId, messageId, providerMediaId: descriptor.providerMediaId },
      "resolveAndStoreAttachment: failed to resolve inbound media (non-fatal — message text is preserved)"
    );
    return { ...base, error: errMsg };
  }
}

export async function resolveAndStoreAttachments(
  descriptors: InboundMediaDescriptor[],
  ctx: { accessToken: string; tenantId: string; conversationId: string; messageId: string },
  fetchImpl: FetchFn = fetch
): Promise<ResolvedAttachment[]> {
  return Promise.all(
    descriptors.map((descriptor, index) =>
      resolveAndStoreAttachment({ descriptor, index, ...ctx }, fetchImpl)
    )
  );
}
