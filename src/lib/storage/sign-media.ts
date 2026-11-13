import { parseMediaReference, PRIVATE_MEDIA_ROUTE } from './media-reference';
import { supabaseAdmin } from '@/lib/ai/admin-client';

/** Meta gets a short-lived capability only after the caller's tenant is checked.
 * Legacy non-account paths require an explicit migration, never a guessed owner.
 */
export async function mediaUrlForDelivery(value: string, accountId?: string): Promise<string> {
  const ref = parseMediaReference(value);
  if (!ref) {
    if (value.startsWith(PRIVATE_MEDIA_ROUTE)) throw new Error('Invalid private media reference');
    return value; // Existing externally-hosted media remains supported.
  }
  if (!accountId || ref.bucket === 'avatars' || ref.path.split('/')[0] !== `account-${accountId}`) {
    throw new Error('Media does not belong to this account');
  }
  const { data, error } = await supabaseAdmin().storage.from(ref.bucket).createSignedUrl(ref.path, 300);
  if (error || !data?.signedUrl) throw new Error('Unable to authorize media delivery');
  return data.signedUrl;
}
