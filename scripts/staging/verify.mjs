/** Real staging integration checks. Only fixtures listed in the protected config.
 * NODE_USE_ENV_PROXY=1 STAGING_CONFIG=/private/config.json STAGING_PROJECT_REF=... node scripts/staging/verify.mjs
 * Never prints passwords, tokens, keys, response bodies or invite URLs.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
const path = process.env.STAGING_CONFIG;
if (!path || !process.env.STAGING_PROJECT_REF) throw new Error('Explicit staging config and project ref required');
const cfg = JSON.parse(await readFile(path, 'utf8'));
assert.equal(cfg.projectRef, process.env.STAGING_PROJECT_REF);
assert.equal(new URL(cfg.url).hostname, `${cfg.projectRef}.supabase.co`);
assert.equal(cfg.users.ownerA.email.endsWith('@example.test'), true);
const origin = 'http://127.0.0.1:3099';
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: cfg.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: cfg.anonKey,
  NEXT_PUBLIC_SITE_URL: origin, PLATFORM_ADMIN_EMAILS: cfg.users.operator.email,
  ENCRYPTION_KEY: cfg.encryptionKey, META_APP_SECRET: cfg.metaSecret,
  NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', NEXT_TELEMETRY_DISABLED: '1' };
// Never inherit a production privileged key from the shell.
delete env.SUPABASE_SERVICE_ROLE_KEY;
if (cfg.serviceRoleKey) env.SUPABASE_SERVICE_ROLE_KEY = cfg.serviceRoleKey;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3099'], { env, stdio: 'ignore' });
const clients = {}, jars = {}, profiles = {};
const results = [];
const report = process.env.STAGING_REPORT ?? '/tmp/crm-staging-results.json';
async function checkpoint(complete = false) {
  await writeFile(report, JSON.stringify({projectRef:cfg.projectRef,executedAt:new Date().toISOString(),complete,results},null,2));
}
await checkpoint();
async function check(name, fn) {
  try { await fn(); results.push({ name, status:'passed' }); console.log(`PASS ${name}`); await checkpoint(); }
  catch (e) { results.push({ name, status:'failed', code:e.code ?? e.name }); console.log(`FAIL ${name}: ${e.code ?? e.name}`); await checkpoint(); throw e; }
}
function ok(result) { if (result.error) { const e = new Error('Supabase operation failed'); e.code=result.error.code; throw e; } return result.data; }
async function api(role, route, method='GET', body) {
  const r=await fetch(origin+route,{ method, redirect:'manual', headers:{'Content-Type':'application/json',Cookie:(jars[role]??[]).map(c=>`${c.name}=${c.value}`).join('; ')}, body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
  return {status:r.status,body:await r.json().catch(()=>null)};
}
const suffix = randomBytes(4).toString('hex');
try {
  for (let i=0;i<60;i++) {
    try {const r=await fetch(origin+'/api/platform/me',{signal:AbortSignal.timeout(2000)}); if(r.ok)break;} catch {}
    await new Promise(r=>setTimeout(r,1000));
    if(i===59) throw new Error('Local API did not start');
  }
  for (const [role,u] of Object.entries(cfg.users)) {
    jars[role]=[];
    const client=createServerClient(cfg.url,cfg.anonKey,{cookies:{getAll:()=>jars[role],setAll:values=>{for(const c of values){jars[role]=jars[role].filter(x=>x.name!==c.name);jars[role].push(c);}}}});
    clients[role]=client;
    await check(`Auth login ${role}`,async()=>{const data=ok(await client.auth.signInWithPassword({email:u.email,password:u.password}));assert.equal(data.user.id,u.id);});
    profiles[role]=ok(await client.from('profiles').select('account_id,account_role').eq('user_id',u.id).single());
  }
  await check('Auth wrong password rejected',async()=>{const c=createClient(cfg.url,cfg.anonKey,{auth:{persistSession:false}});const r=await c.auth.signInWithPassword({email:cfg.users.ownerA.email,password:'Not-The-Password!'});assert.ok(r.error);});
  await check('Auth refresh ownerA',async()=>{assert.ok(ok(await clients.ownerA.auth.refreshSession()).session);});
  for(const [member,owner,role] of [['agentA','ownerA','agent'],['agentB','ownerB','agent'],['viewerA','ownerA','viewer']]) {
    if(profiles[member].account_id===profiles[owner].account_id) {
      results.push({name:`Invite redeem ${member}`,status:'skipped',reason:'fixture already joined in prior execution'}); continue;
    }
    await check(`Invite create/redeem/replay ${member}`,async()=>{
      const invite=await api(owner,'/api/account/invitations','POST',{role,label:`Homologacao ${suffix}`});assert.equal(invite.status,201);
      const url='/api/invitations/'+invite.body.token+'/redeem';
      assert.equal((await api(member,url,'POST',{})).status,200);
      assert.equal((await api(member,url,'POST',{})).status,400);
      profiles[member]=ok(await clients[member].from('profiles').select('account_id,account_role').eq('user_id',cfg.users[member].id).single());
      assert.equal(profiles[member].account_id,profiles[owner].account_id);assert.equal(profiles[member].account_role,role);
    });
  }
  const data={};
  for(const tenant of ['A','B']) {
    const role='owner'+tenant,c=clients[role],uid=cfg.users[role].id,account_id=profiles[role].account_id;
    const base={user_id:uid,account_id};
    await check(`Create own contacts/conversations/pipeline/deal ${tenant}`,async()=>{
      const contact=ok(await c.from('contacts').insert({...base,name:`Ficticio ${suffix}`,phone:`+5500${Date.now()}${tenant==='A'?1:2}`}).select().single());
      const conversation=ok(await c.from('conversations').insert({...base,contact_id:contact.id}).select().single());
      const message=ok(await c.from('messages').insert({conversation_id:conversation.id,sender_type:'agent',content_type:'text',content_text:'Homologacao sem envio externo'}).select().single());
      const pipeline=ok(await c.from('pipelines').insert({...base,name:`Funil ${suffix}`}).select().single());
      const stage=ok(await c.from('pipeline_stages').insert({pipeline_id:pipeline.id,name:'Inicio',position:0}).select().single());
      const deal=ok(await c.from('deals').insert({...base,contact_id:contact.id,conversation_id:conversation.id,pipeline_id:pipeline.id,stage_id:stage.id,title:'Negocio ficticio'}).select().single());
      data[tenant]={contacts:contact,conversations:conversation,messages:message,pipelines:pipeline,pipeline_stages:stage,deals:deal};
    });
  }
  for(const [tenant,victim] of [['A','B'],['B','A']]) {
    for(const who of ['owner','agent']) {
      const role=who+tenant,c=clients[role];
      for(const [table,row] of Object.entries(data[victim])) {
        await check(`${role} cannot read/update/delete ${victim}.${table}`,async()=>{
          assert.deepEqual(ok(await c.from(table).select('id').eq('id',row.id)),[]);
          // Update a harmless column that exists in every row; RLS must affect zero rows.
          assert.deepEqual(ok(await c.from(table).update({id:row.id}).eq('id',row.id).select('id')),[]);
          assert.deepEqual(ok(await c.from(table).delete().eq('id',row.id).select('id')),[]);
          const after=ok(await clients['owner'+victim].from(table).select('id').eq('id',row.id).single());assert.equal(after.id,row.id);
        });
      }
    }
  }
  await check('Agent own-contact write permitted',async()=>{const r=await clients.agentA.from('contacts').update({name:'Agent permitted'}).eq('id',data.A.contacts.id).select('id').single();assert.equal(ok(r).id,data.A.contacts.id);});
  await check('Viewer own-contact write denied',async()=>{const r=await clients.viewerA.from('contacts').update({name:'Viewer forbidden'}).eq('id',data.A.contacts.id).select('id');assert.deepEqual(ok(r),[]);});
  await check('Forged tenant insert rejected',async()=>{const r=await clients.ownerA.from('contacts').insert({account_id:profiles.ownerB.account_id,user_id:cfg.users.ownerA.id,name:'forged',phone:'+55000000001'});assert.equal(r.error?.code,'42501');});
  await check('Cross-tenant foreign reference rejected',async()=>{const r=await clients.ownerA.from('conversations').insert({account_id:profiles.ownerA.account_id,user_id:cfg.users.ownerA.id,contact_id:data.B.contacts.id});assert.equal(r.error?.code,'23514');});
  await check('Self promotion and tenant move rejected',async()=>{for(const patch of [{account_role:'owner'},{account_id:profiles.ownerB.account_id}]){const r=await clients.agentA.from('profiles').update(patch).eq('user_id',cfg.users.agentA.id);assert.equal(r.error?.code,'42501');}});
  await check('Direct owner rewrite rejected',async()=>{const r=await clients.ownerA.from('accounts').update({owner_user_id:cfg.users.ownerB.id}).eq('id',profiles.ownerA.account_id);assert.equal(r.error?.code,'42501');});
  for(const role of ['ownerA','ownerB','agentA','agentB','viewerA']) {
    await check(`${role} denied global platform GET/POST`,async()=>{
      assert.equal((await api(role,'/api/platform/companies')).status,403);
      assert.equal((await api(role,'/api/platform/companies','POST',{company_name:'forged'})).status,403);
      assert.equal((await api(role,'/api/platform/me')).body.isPlatformAdmin,false);
    });
  }
  await check('Verified platform operator recognized',async()=>{assert.equal((await api('operator','/api/platform/me')).body.isPlatformAdmin,true);});
  await check('Agent cannot create invitation/API key',async()=>{
    assert.equal((await api('agentA','/api/account/invitations','POST',{role:'admin'})).status,403);
    assert.equal((await api('agentA','/api/account/api-keys','POST',{name:'denied',scopes:[]})).status,403);
  });
  await check('Cross-tenant role/ownership RPCs rejected',async()=>{
    for(const [name,args] of [['set_member_role',{p_user_id:cfg.users.agentB.id,p_new_role:'admin'}],['remove_account_member',{p_user_id:cfg.users.agentB.id}],['transfer_account_ownership',{p_new_owner_user_id:cfg.users.ownerB.id}]]) {
      assert.equal((await clients.ownerA.rpc(name,args)).error?.code,'42501');
    }
  });
  await check('Owner API key creation and cross-tenant visibility',async()=>{
    const r=await api('ownerA','/api/account/api-keys','POST',{name:`test ${suffix}`,scopes:['contacts:read']});assert.equal(r.status,201);
    assert.deepEqual(ok(await clients.ownerB.from('api_keys').select('id').eq('account_id',profiles.ownerA.account_id)),[]);
  });
  await check('Viewer denied service-role automation create',async()=>{assert.equal((await api('viewerA','/api/automations','POST',{name:'denied',trigger_type:'new_contact'})).status,403);});
  await check('Unsigned WhatsApp webhook rejected',async()=>{assert.equal((await api(null,'/api/whatsapp/webhook','POST',{object:'whatsapp_business_account',entry:[]})).status,401);});
  await check('Authenticated password change and new login',async()=>{
    const password='Aa1!'+randomBytes(24).toString('base64url');ok(await clients.agentB.auth.updateUser({password}));
    cfg.users.agentB.password=password;await writeFile(path,JSON.stringify(cfg),{mode:0o600});
    const c=createClient(cfg.url,cfg.anonKey,{auth:{persistSession:false}});assert.ok(ok(await c.auth.signInWithPassword({email:cfg.users.agentB.email,password})).session);
  });
  for(const name of ['Platform company provisioning with service_role','API key authentication and tenant scope via service_role','Automation execution and service-role webhooks','Recovery email delivery and recovery link completion','Meta delivery, AI providers, Storage privacy']) {
    results.push({name,status:'pending',reason:'Requires privileged staging credential or external integration; not executed'});
  }
} catch {
  process.exitCode=1;
} finally {
  for (const client of Object.values(clients)) await client.auth.stopAutoRefresh();
  server.kill('SIGTERM');
  await checkpoint(process.exitCode !== 1);
  console.log(JSON.stringify({passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length,pending:results.filter(r=>r.status==='pending').length,skipped:results.filter(r=>r.status==='skipped').length}));
}
