import { beforeEach, describe, expect, it, vi } from 'vitest';
const {signed,from}=vi.hoisted(()=>({signed:vi.fn(),from:vi.fn()}));
vi.mock('@/lib/ai/admin-client',()=>({supabaseAdmin:()=>({storage:{from}})}));
import { mediaUrlForDelivery } from './sign-media';
import { mediaReferenceUrl } from './media-reference';
beforeEach(()=>{from.mockReset().mockReturnValue({createSignedUrl:signed});signed.mockReset().mockResolvedValue({data:{signedUrl:'https://test.supabase.co/temporary'},error:null});});
describe('Meta media capabilities',()=>{
  it('signs own account object for five minutes',async()=>{
    expect(await mediaUrlForDelivery(mediaReferenceUrl('chat-media','account-a/file.jpg'),'a')).toBe('https://test.supabase.co/temporary');
    expect(from).toHaveBeenCalledWith('chat-media');expect(signed).toHaveBeenCalledWith('account-a/file.jpg',300);
  });
  it('rejects cross-account, no account, avatars and legacy paths before service access',async()=>{
    for(const [ref,account] of [[mediaReferenceUrl('flow-media','account-b/a.jpg'),'a'],[mediaReferenceUrl('flow-media','account-a/a.jpg'),undefined],[mediaReferenceUrl('avatars','a/avatar.jpg'),'a'],[mediaReferenceUrl('flow-media','a/legacy.jpg'),'a']] as const){await expect(mediaUrlForDelivery(ref,account)).rejects.toThrow();}
    expect(from).not.toHaveBeenCalled();
  });
  it('never returns original private object after signing error',async()=>{signed.mockResolvedValue({data:null,error:{message:'denied'}});await expect(mediaUrlForDelivery(mediaReferenceUrl('chat-media','account-a/file.jpg'),'a')).rejects.toThrow('Unable to authorize');});
  it('rejects malformed internal references',async()=>{await expect(mediaUrlForDelivery('/api/storage/media?path=../file','a')).rejects.toThrow();});
});
