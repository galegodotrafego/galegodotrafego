import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import type { RateLimitOptions, RateLimitResult } from './rate-limit';

/** Shared, atomic fixed-window limit. No process-local fallback on failure. */
export async function checkDistributedRateLimit(
  key: string,
  { limit, windowMs }: RateLimitOptions,
): Promise<RateLimitResult> {
  if (!key || !Number.isInteger(limit) || limit < 1 || limit > 10000 ||
      !Number.isInteger(windowMs) || windowMs < 1000 || windowMs > 86400000) {
    throw new Error('Invalid rate limit configuration');
  }
  const { data, error } = await supabaseAdmin().rpc('consume_admin_rate_limit', {
    p_key_hash: createHash('sha256').update(key).digest('hex'),
    p_limit: limit,
    p_window_ms: windowMs,
  });
  const row = Array.isArray(data) ? data[0] : null;
  const reset = Date.parse(row?.reset_at);
  if (error || !row || typeof row.allowed !== 'boolean' || !Number.isFinite(reset) ||
      !Number.isInteger(row.remaining) || row.remaining < 0 || row.remaining >= limit) {
    throw new Error('Rate limit service unavailable');
  }
  return { success: row.allowed, remaining: row.remaining, reset, limit };
}
