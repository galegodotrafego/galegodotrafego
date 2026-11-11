// Isolated PostgreSQL smoke tests; no network or real customer data.
// Uses a minimal schema fixture, not a full Supabase Auth/PostgREST stack.
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
let checks = 0;
const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
const ua = '00000000-0000-4000-8000-000000000011';
const ub = '00000000-0000-4000-8000-000000000012';
async function denied(sql, code) {
  await assert.rejects(db.exec(sql), (error) => error.code === code); checks++;
}
try {
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}');
    CREATE TABLE accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, owner_user_id uuid REFERENCES auth.users);
    CREATE TABLE profiles(user_id uuid PRIMARY KEY REFERENCES auth.users, full_name text, email text,
      account_id uuid REFERENCES accounts, account_role text CHECK(account_role IN ('owner','admin','agent','viewer')));
    ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY profiles_insert ON profiles FOR INSERT WITH CHECK (true);
    GRANT USAGE ON SCHEMA public TO authenticated;
    GRANT INSERT, SELECT ON profiles TO authenticated;
    GRANT UPDATE, SELECT ON accounts TO authenticated;
    INSERT INTO auth.users(id,email) VALUES ('${ua}','a@example.test'),('${ub}','b@example.test');
    INSERT INTO accounts VALUES ('${a}','A','${ua}'),('${b}','B','${ub}');
  `);
  for (const table of ['contacts','tags','custom_fields','pipelines','broadcasts']) {
    await db.exec(`CREATE TABLE ${table}(id uuid PRIMARY KEY, account_id uuid REFERENCES accounts);
      INSERT INTO ${table} VALUES ('${a}','${a}'),('${b}','${b}');`);
  }
  await db.exec(`
    CREATE TABLE contact_notes(account_id uuid, contact_id uuid);
    CREATE TABLE conversations(id uuid PRIMARY KEY, account_id uuid, contact_id uuid);
    INSERT INTO conversations VALUES ('${a}','${a}','${a}'),('${b}','${b}','${b}');
    CREATE TABLE pipeline_stages(id uuid PRIMARY KEY, pipeline_id uuid);
    INSERT INTO pipeline_stages VALUES ('${a}','${a}'),('${b}','${b}');
    CREATE TABLE deals(account_id uuid, contact_id uuid, conversation_id uuid, pipeline_id uuid, stage_id uuid);
    CREATE TABLE contact_tags(contact_id uuid, tag_id uuid);
    CREATE TABLE contact_custom_values(contact_id uuid, custom_field_id uuid);
    CREATE TABLE broadcast_recipients(broadcast_id uuid, contact_id uuid);
  `);
  for (const name of ['040_provisioning_privilege_guards.sql','041_tenant_relationship_guards.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
  }
  checks += 2;
  await db.exec(`SET ROLE authenticated`);
  await denied(`INSERT INTO profiles(user_id,account_id,account_role) VALUES ('${ua}','${b}','owner')`, '42501');
  await denied(`UPDATE accounts SET owner_user_id='${ub}' WHERE id='${a}'`, '42501');
  await db.exec(`UPDATE accounts SET name='Renamed' WHERE id='${a}'`); checks++;
  await db.exec('RESET ROLE');
  await db.exec(`CREATE TRIGGER bootstrap AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();`);
  const fresh = '00000000-0000-4000-8000-000000000013';
  await db.exec(`INSERT INTO auth.users(id,email) VALUES ('${fresh}','fresh@example.test')`);
  const owner = await db.query(`SELECT p.account_role FROM profiles p JOIN accounts a ON a.id=p.account_id WHERE p.user_id=$1 AND a.owner_user_id=p.user_id`, [fresh]);
  assert.equal(owner.rows[0].account_role, 'owner'); checks++;
  // A bootstrap failure must roll back the Auth row as well.
  await db.exec(`ALTER TABLE profiles ADD CONSTRAINT reject_test_email CHECK(email <> 'fail@example.test')`);
  await denied(`INSERT INTO auth.users(id,email) VALUES ('00000000-0000-4000-8000-000000000014','fail@example.test')`, '23514');
  assert.equal((await db.query(`SELECT count(*)::int n FROM auth.users WHERE email='fail@example.test'`)).rows[0].n, 0); checks++;
  const pairs = [
    ['contact_notes','account_id,contact_id'],
    ['contact_tags','contact_id,tag_id'],
    ['contact_custom_values','contact_id,custom_field_id'],
    ['broadcast_recipients','broadcast_id,contact_id'],
  ];
  for (const [table, columns] of pairs) {
    await db.exec(`INSERT INTO ${table}(${columns}) VALUES ('${a}','${a}')`); checks++;
    await denied(`INSERT INTO ${table}(${columns}) VALUES ('${a}','${b}')`, '23514');
    await denied(`UPDATE ${table} SET ${columns.split(',')[1]}='${b}'`, '23514');
  }
  await denied(`INSERT INTO conversations VALUES ('00000000-0000-4000-8000-000000000099','${a}','${b}')`, '23514');
  await db.exec(`INSERT INTO deals VALUES ('${a}','${a}','${a}','${a}','${a}')`); checks++;
  for (const column of ['contact_id','conversation_id','pipeline_id','stage_id']) {
    await denied(`UPDATE deals SET ${column}='${b}'`, '23514');
  }
  // Nullable links remain compatible with ON DELETE SET NULL semantics.
  await db.exec(`UPDATE deals SET contact_id=NULL, conversation_id=NULL`); checks++;
  console.log(`${checks} PostgreSQL fixture checks passed (PGlite). Full Supabase integration remains required.`);
} finally { await db.close(); }
