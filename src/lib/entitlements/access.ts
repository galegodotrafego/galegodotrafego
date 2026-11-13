import type { SupabaseClient } from '@supabase/supabase-js';

/** No cache: suspensions and period expiry take effect on the next operation. */
export async function accountHasAccess(db: SupabaseClient, accountId: string, feature?: string): Promise<boolean> {
  try {
    const { data, error } = await db.rpc('account_has_access', { p_account_id: accountId });
    if (error || data !== true) return false;
    if (feature) {
      const result = await db.rpc('account_has_feature', { p_account_id: accountId, p_feature: feature });
      return !result.error && result.data === true;
    }
    return true;
  } catch { return false; }
}

export class SubscriptionAccessError extends Error {
  readonly status = 403;
  constructor() { super('Assinatura indisponível. Contate o administrador da plataforma.'); }
}

export async function assertAccountAccess(db: SupabaseClient, accountId: string, feature?: string): Promise<void> {
  if (!(await accountHasAccess(db, accountId, feature))) throw new SubscriptionAccessError();
}
