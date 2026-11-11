-- Reject new cross-tenant references, including service-role writes.
-- Does not rewrite/delete historical rows; audit those in staging before release.
BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_tenant_reference()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row JSONB := to_jsonb(NEW);
  v_account UUID;
  v_parent_account UUID;
  v_reference UUID;
BEGIN
  -- Args: local FK, referenced table, [owning FK, owning table].
  -- Tables/columns are fixed by the migration, never supplied by a client.
  v_reference := (v_row ->> TG_ARGV[0])::uuid;
  IF v_reference IS NULL THEN RETURN NEW; END IF;
  IF TG_NARGS = 4 THEN
    EXECUTE format('SELECT account_id FROM public.%I WHERE id = $1', TG_ARGV[3])
      INTO v_account USING (v_row ->> TG_ARGV[2])::uuid;
  ELSE
    v_account := (v_row ->> 'account_id')::uuid;
  END IF;
  EXECUTE format('SELECT account_id FROM public.%I WHERE id = $1', TG_ARGV[1])
    INTO v_parent_account USING v_reference;
  IF v_account IS NULL OR v_parent_account IS DISTINCT FROM v_account THEN
    RAISE EXCEPTION 'Related records must belong to the same account' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.enforce_tenant_reference() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_tenant_reference() FROM PUBLIC;

CREATE TRIGGER tenant_contact_note BEFORE INSERT OR UPDATE ON public.contact_notes
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_reference('contact_id', 'contacts');
CREATE TRIGGER tenant_conversation_contact BEFORE INSERT OR UPDATE ON public.conversations
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_reference('contact_id', 'contacts');
CREATE TRIGGER tenant_deal_contact BEFORE INSERT OR UPDATE ON public.deals
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_reference('contact_id', 'contacts');
CREATE TRIGGER tenant_deal_pipeline BEFORE INSERT OR UPDATE ON public.deals
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_reference('pipeline_id', 'pipelines');
CREATE TRIGGER tenant_deal_conversation BEFORE INSERT OR UPDATE ON public.deals
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_reference('conversation_id', 'conversations');
CREATE TRIGGER tenant_contact_tag BEFORE INSERT OR UPDATE ON public.contact_tags
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_reference('tag_id', 'tags', 'contact_id', 'contacts');
CREATE TRIGGER tenant_contact_custom_value BEFORE INSERT OR UPDATE ON public.contact_custom_values
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_reference('custom_field_id', 'custom_fields', 'contact_id', 'contacts');
CREATE TRIGGER tenant_broadcast_contact BEFORE INSERT OR UPDATE ON public.broadcast_recipients
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_reference('contact_id', 'contacts', 'broadcast_id', 'broadcasts');

-- Stages inherit tenancy through pipelines rather than an account_id column.
CREATE OR REPLACE FUNCTION public.enforce_deal_stage()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.stage_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages s
    WHERE s.id = NEW.stage_id AND s.pipeline_id = NEW.pipeline_id
  ) THEN
    RAISE EXCEPTION 'Stage must belong to the deal pipeline' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.enforce_deal_stage() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_deal_stage() FROM PUBLIC;
CREATE TRIGGER tenant_deal_stage BEFORE INSERT OR UPDATE ON public.deals
FOR EACH ROW EXECUTE FUNCTION public.enforce_deal_stage();
COMMIT;
