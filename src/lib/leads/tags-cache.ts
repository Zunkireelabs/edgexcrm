// 60 s per-instance cache for GET /api/v1/leads/tags (EDGEX-127), cleared for a tenant when bulk Add tag writes.
export type TagsBody = { tags: Array<{ tag: string; count: number | null }>; truncated: boolean };
export const TAGS_TTL_MS = 60_000;
const cache = new Map<string, { at: number; body: TagsBody }>();

export const getCachedTags = (key: string): TagsBody | null => {
  const hit = cache.get(key);
  return hit && Date.now() - hit.at < TAGS_TTL_MS ? hit.body : null;
};
export const setCachedTags = (key: string, body: TagsBody) => void cache.set(key, { at: Date.now(), body });
export const clearTagsCacheForTenant = (tenantId: string) => {
  for (const k of [...cache.keys()]) if (k.startsWith(`${tenantId}:`)) cache.delete(k);
};
