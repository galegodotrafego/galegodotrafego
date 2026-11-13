-- Replace public reads and legacy per-user flow writes with tenant-scoped access.
-- Existing account-prefixed objects and stored public URLs remain readable through
-- the authenticated application resolver. Legacy user-prefixed flow objects need
-- an explicitly audited copy to an account prefix; never infer historical tenancy.
UPDATE storage.buckets SET public = false WHERE id IN ('chat-media','flow-media','avatars');

DROP POLICY IF EXISTS "Chat media is publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Flow media is publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Avatars are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Members can upload chat media" ON storage.objects;
DROP POLICY IF EXISTS "Members can update chat media" ON storage.objects;
DROP POLICY IF EXISTS "Members can delete chat media" ON storage.objects;
DROP POLICY IF EXISTS "Members can upload flow media" ON storage.objects;
DROP POLICY IF EXISTS "Members can update flow media" ON storage.objects;
DROP POLICY IF EXISTS "Members can delete flow media" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own flow media" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own flow media" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own flow media" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;

CREATE POLICY account_media_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id IN ('chat-media','flow-media') AND EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid()
    AND (storage.foldername(name))[1]='account-'||p.account_id::text
    AND public.is_account_member(p.account_id)
));
CREATE POLICY account_media_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id IN ('chat-media','flow-media') AND EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid()
    AND (storage.foldername(name))[1]='account-'||p.account_id::text
    AND public.is_account_member(p.account_id,'agent')
));
CREATE POLICY account_media_update ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id IN ('chat-media','flow-media') AND EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid()
    AND (storage.foldername(name))[1]='account-'||p.account_id::text
    AND public.is_account_member(p.account_id,'agent')
)) WITH CHECK (bucket_id IN ('chat-media','flow-media') AND EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid()
    AND (storage.foldername(name))[1]='account-'||p.account_id::text
    AND public.is_account_member(p.account_id,'agent')
));
CREATE POLICY account_media_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id IN ('chat-media','flow-media') AND EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid()
    AND (storage.foldername(name))[1]='account-'||p.account_id::text
    AND public.is_account_member(p.account_id,'agent')
));
CREATE POLICY avatar_tenant_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='avatars' AND EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.user_id::text=(storage.foldername(name))[1]
    AND public.is_account_member(p.account_id)
));
CREATE POLICY avatar_owner_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='avatars' AND auth.uid()::text=(storage.foldername(name))[1]);
CREATE POLICY avatar_owner_update ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id='avatars' AND auth.uid()::text=(storage.foldername(name))[1])
WITH CHECK (bucket_id='avatars' AND auth.uid()::text=(storage.foldername(name))[1]);
CREATE POLICY avatar_owner_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='avatars' AND auth.uid()::text=(storage.foldername(name))[1]);
