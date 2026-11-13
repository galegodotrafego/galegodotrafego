import { beforeEach, describe, expect, it, vi } from 'vitest';
const { context, sign, bucket } = vi.hoisted(() => ({ context: vi.fn(), sign: vi.fn(), bucket: vi.fn() }));
vi.mock('@/lib/auth/account', () => ({ getCurrentAccount: context, toErrorResponse: () => Response.json({error:'Unauthorized'}, {status:401}) }));
import { GET } from './route';
const req = (query = 'bucket=chat-media&path=account-a%2Fphoto.jpg') => new Request(`https://crm.test/api/storage/media?${query}`);
beforeEach(() => {
  vi.resetAllMocks();
  bucket.mockReturnValue({createSignedUrl:sign});
  context.mockResolvedValue({supabase:{storage:{from:bucket}}});
  sign.mockResolvedValue({data:{signedUrl:'https://storage.test/temporary'},error:null});
});
describe('private media delivery', () => {
  it('requires authentication before any Storage access', async () => {
    context.mockRejectedValue(new Error('No session'));
    expect((await GET(req())).status).toBe(401);expect(bucket).not.toHaveBeenCalled();
  });
  it('uses the user session to sign briefly with no-store response', async () => {
    const response=await GET(req());
    expect(response.status).toBe(307);expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(sign).toHaveBeenCalledWith('account-a/photo.jpg',60);
  });
  it('does not expose a URL when object policy rejects another tenant', async () => {
    sign.mockResolvedValue({data:null,error:{message:'RLS denial'}});
    const response=await GET(req());expect(response.status).toBe(404);expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).not.toContain('RLS');
  });
  it('rejects traversal before Storage access', async () => {
    expect((await GET(req('bucket=chat-media&path=..%2Fsecret'))).status).toBe(400);
    expect(bucket).not.toHaveBeenCalled();
  });
});
