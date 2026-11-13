import { describe, expect, it } from 'vitest';
import { mediaReferenceUrl, parseMediaReference, privateMediaViewUrl } from './media-reference';
const project = 'https://test.supabase.co';
describe('private media references', () => {
  it('round trips without storing a bearer token', () => {
    const value=mediaReferenceUrl('chat-media','account-a/foto a.jpg');
    expect(parseMediaReference(value)).toEqual({bucket:'chat-media',path:'account-a/foto a.jpg'});
    expect(value).not.toContain('token=');
  });
  it('upgrades only this project legacy public/signed URLs', () => {
    for (const visibility of ['public','sign','authenticated']) {
      expect(parseMediaReference(`${project}/storage/v1/object/${visibility}/flow-media/account-a/a.jpg?token=old`,project)).toEqual({bucket:'flow-media',path:'account-a/a.jpg'});
    }
    expect(parseMediaReference('https://evil.test/storage/v1/object/public/chat-media/account-a/a.jpg',project)).toBeNull();
    expect(parseMediaReference('https://user:pass@test.supabase.co/storage/v1/object/public/chat-media/account-a/a.jpg',project)).toBeNull();
  });
  it('rejects malformed buckets, traversal, control characters and empty segments', () => {
    for (const path of ['../secret','a/../secret','a//secret','a/./secret','a\\secret','a/\nsecret','']) {
      expect(()=>mediaReferenceUrl('chat-media',path)).toThrow();
      expect(parseMediaReference(`/api/storage/media?bucket=chat-media&path=${encodeURIComponent(path)}`)).toBeNull();
    }
    expect(()=>mediaReferenceUrl('unknown','a/file')).toThrow();
    expect(parseMediaReference('/api/storage/media?bucket=unknown&path=a/file')).toBeNull();
  });
  it('keeps external media and local previews unchanged',()=>{
    expect(privateMediaViewUrl('https://external.test/image.jpg')).toBe('https://external.test/image.jpg');
    expect(privateMediaViewUrl('blob:local-preview')).toBe('blob:local-preview');
  });
});
