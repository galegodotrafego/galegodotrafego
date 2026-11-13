-- Supabase grants EXECUTE directly to anon/authenticated by default.
-- Revoking PUBLIC alone does not close those grants. Internal definer
-- functions bypass RLS and must not be callable from the public REST API.
REVOKE EXECUTE ON FUNCTION public._bcast_bump(uuid, text, integer),
  public.recompute_broadcast_counts(uuid),
  public.claim_ai_reply_slot(uuid, integer),
  public.record_webhook_failure(uuid, integer),
  public.merge_duplicate_contacts(),
  public.merge_duplicate_conversations()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._bcast_bump(uuid, text, integer),
  public.recompute_broadcast_counts(uuid),
  public.claim_ai_reply_slot(uuid, integer),
  public.record_webhook_failure(uuid, integer),
  public.merge_duplicate_contacts(),
  public.merge_duplicate_conversations()
TO service_role;

-- These entry points require a user session; their existing role/tenant
-- checks remain authoritative. peek_invitation stays publicly available
-- because the invitation landing page needs it before sign-in.
REVOKE EXECUTE ON FUNCTION public.redeem_invitation(text),
  public.remove_account_member(uuid),
  public.set_member_role(uuid, public.account_role_enum),
  public.transfer_account_ownership(uuid),
  public.touch_presence(text)
FROM PUBLIC, anon;

-- Trigger execution is independent of the caller's EXECUTE privilege.
REVOKE EXECUTE ON FUNCTION public.broadcast_recipient_aggregate_trigger(),
  public.enforce_deal_stage(), public.enforce_tenant_reference(),
  public.handle_new_user(), public.notify_conversation_assigned()
FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
ALTER FUNCTION public.update_ai_configs_updated_at() SET search_path = public;
ALTER FUNCTION public.update_ai_knowledge_documents_updated_at() SET search_path = public;
ALTER FUNCTION public._bcast_cols_for_status(text) SET search_path = public;
