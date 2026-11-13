import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/ai/admin-client', () => ({ supabaseAdmin: () => ({ rpc }) }));
import { checkDistributedRateLimit } from './distributed-rate-limit';

describe('distributed administrative limits', () => {
  beforeEach(() => rpc.mockReset());
  it('stores only a digest and trusts the atomic database decision', async () => {
    rpc.mockResolvedValue({ data: [{ allowed: false, remaining: 0, reset_at: '2030-01-01T00:00:00Z' }], error: null });
    expect((await checkDistributedRateLimit('admin:user-private-id', { limit: 10, windowMs: 60000 })).success).toBe(false);
    expect(rpc).toHaveBeenCalledWith('consume_admin_rate_limit', {
      p_key_hash: expect.stringMatching(/^[a-f0-9]{64}$/), p_limit: 10, p_window_ms: 60000,
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('user-private-id');
  });
  it.each([
    { data: null, error: { message: 'database credentials must never surface' } },
    { data: [{ allowed: true, remaining: 99, reset_at: 'invalid' }], error: null },
  ])('fails closed without a local counter when unavailable', async response => {
    rpc.mockResolvedValue(response);
    await expect(checkDistributedRateLimit('admin:1', { limit: 10, windowMs: 60000 })).rejects.toThrow('Rate limit service unavailable');
  });
  it('rejects invalid budgets before querying', async () => {
    await expect(checkDistributedRateLimit('x', { limit: 0, windowMs: 60000 })).rejects.toThrow('Invalid rate limit');
    expect(rpc).not.toHaveBeenCalled();
  });
});
