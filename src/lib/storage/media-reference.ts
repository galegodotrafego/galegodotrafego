/** Durable app URL; never persist an expiring bearer token in CRM rows. */
export const PRIVATE_MEDIA_ROUTE = '/api/storage/media';
export const PRIVATE_BUCKETS = ['chat-media', 'flow-media', 'avatars'] as const;
export type PrivateBucket = typeof PRIVATE_BUCKETS[number];
export interface MediaReference { bucket: PrivateBucket; path: string }
export function mediaReferenceUrl(bucket: string, path: string): string {
  if (!PRIVATE_BUCKETS.includes(bucket as PrivateBucket) || !validPath(path)) throw new Error('Invalid media reference');
  return `${PRIVATE_MEDIA_ROUTE}?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
}
function validPath(path: string): boolean {
  return !!path && path.length <= 2048 && !path.includes('\\') && !/[\x00-\x1f]/.test(path)
    && path.split('/').every(p => p !== '' && p !== '.' && p !== '..');
}
export function parseMediaReference(value: string, projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL): MediaReference | null {
  let bucket: string | null = null, path: string | null = null;
  if (value.startsWith(`${PRIVATE_MEDIA_ROUTE}?`)) {
    const u = new URL(value, 'https://app.invalid');
    bucket = u.searchParams.get('bucket'); path = u.searchParams.get('path');
  } else if (projectUrl) {
    try {
      const u = new URL(value), project = new URL(projectUrl);
      if (u.origin !== project.origin || u.username || u.password) return null;
      const match = u.pathname.match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
      if (!match) return null;
      bucket = decodeURIComponent(match[1]); path = decodeURIComponent(match[2]);
    } catch { return null; }
  }
  if (!bucket || !path || !PRIVATE_BUCKETS.includes(bucket as PrivateBucket) || !validPath(path)) return null;
  return { bucket: bucket as PrivateBucket, path };
}
/** Upgrade persisted legacy public URLs at render time without rewriting customer data. */
export function privateMediaViewUrl(value: string): string {
  const ref = parseMediaReference(value);
  return ref ? mediaReferenceUrl(ref.bucket, ref.path) : value;
}
