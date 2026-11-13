// Isolated PostgreSQL policy fixture; NOT a substitute for hosted Storage HTTP.
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite(); let checks=0;
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
const ua='00000000-0000-4000-8000-000000000011',ub='00000000-0000-4000-8000-000000000012',uv='00000000-0000-4000-8000-000000000013';
async function role(name,uid=''){await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${uid}',false); SET ROLE ${name}`);}
try{
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE SCHEMA storage;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE TABLE profiles(user_id uuid,account_id uuid,account_role text);
 INSERT INTO profiles VALUES('${ua}','${a}','agent'),('${ub}','${b}','agent'),('${uv}','${a}','viewer');
 CREATE FUNCTION is_account_member(target uuid, min_role text DEFAULT 'viewer') RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM profiles WHERE user_id=auth.uid() AND account_id=target AND (min_role='viewer' OR account_role='agent'))$$;
 CREATE TABLE storage.buckets(id text PRIMARY KEY, public boolean); INSERT INTO storage.buckets VALUES('chat-media',true),('flow-media',true),('avatars',true);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);
 CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$SELECT string_to_array($1,'/')$$;
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role;
 GRANT SELECT ON profiles TO authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO anon,authenticated;
 `);
 await db.exec(await readFile('supabase/migrations/20261113133124_private_account_media.sql','utf8'));
 assert.equal((await db.query('SELECT count(*)::int n FROM storage.buckets WHERE public')).rows[0].n,0); checks++;
 for(const bucket of ['chat-media','flow-media']){
  const path=`account-${a}/fixture.png`;
  await role('authenticated',ua);await db.query('INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)',[bucket,path]); checks++;
  assert.equal((await db.query('SELECT * FROM storage.objects WHERE bucket_id=$1',[bucket])).rows.length,1);checks++;
  await role('anon');assert.equal((await db.query('SELECT * FROM storage.objects WHERE bucket_id=$1',[bucket])).rows.length,0);checks++;
  await role('authenticated',ub);
  for(const sql of ['SELECT * FROM storage.objects WHERE bucket_id=$1','UPDATE storage.objects SET name=name WHERE bucket_id=$1 RETURNING id','DELETE FROM storage.objects WHERE bucket_id=$1 RETURNING id']){
   assert.equal((await db.query(sql,[bucket])).rows.length,0);checks++;
  }
  await assert.rejects(db.query('INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)',[bucket,path]),e=>e.code==='42501');checks++;
  await role('authenticated',uv);
  assert.equal((await db.query('SELECT * FROM storage.objects WHERE bucket_id=$1',[bucket])).rows.length,1);checks++;
  await assert.rejects(db.query('INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)',[bucket,`account-${a}/viewer.png`]),e=>e.code==='42501');checks++;
  assert.equal((await db.query('UPDATE storage.objects SET name=name WHERE bucket_id=$1 RETURNING id',[bucket])).rows.length,0);checks++;
  await role('authenticated',ua);
  await assert.rejects(db.query('UPDATE storage.objects SET name=$1 WHERE bucket_id=$2',[`account-${b}/moved.png`,bucket]),e=>e.code==='42501');checks++;
 }
 await role('authenticated',ua);await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('avatars',$1)",[`${ua}/avatar.png`]);checks++;
 await role('authenticated',ub);assert.equal((await db.query("SELECT * FROM storage.objects WHERE bucket_id='avatars'")).rows.length,0);checks++;
 await role('authenticated',uv);assert.equal((await db.query("SELECT * FROM storage.objects WHERE bucket_id='avatars'")).rows.length,1);checks++;
 await role('anon');assert.equal((await db.query("SELECT * FROM storage.objects WHERE bucket_id='avatars'")).rows.length,0);checks++;
 await role('service_role');await role('postgres');
 await db.exec(await readFile('supabase/migrations/20261113182010_distributed_admin_limits.sql','utf8'));
 const key='a'.repeat(64);
 await role('service_role');
 for(let i=0;i<4;i++){
  const r=(await db.query('SELECT * FROM consume_admin_rate_limit($1,2,60000)',[key])).rows[0];assert.equal(r.allowed,i<2);checks++;
 }
 await role('authenticated',ua);await assert.rejects(db.query('SELECT * FROM consume_admin_rate_limit($1,2,60000)',[key]),e=>e.code==='42501');checks++;
 console.log(`${checks} Storage/limiter PostgreSQL fixture checks passed. Hosted HTTP validation required.`);
}finally{await db.close();}
