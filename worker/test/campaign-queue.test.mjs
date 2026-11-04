import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../migrations/0025_campaign_jobs.sql', import.meta.url), 'utf8');
function extract(name, next) { return source.slice(source.indexOf('async function '+name+'('), source.indexOf('async function '+next+'(')); }
function setup() {
 const db = new DatabaseSync(':memory:');
 db.exec("CREATE TABLE campaigns (campaign_id TEXT PRIMARY KEY,workspace_id TEXT,status TEXT); CREATE TABLE campaign_recipients (recipient_id TEXT PRIMARY KEY,campaign_id TEXT,workspace_id TEXT,status TEXT,message_id TEXT DEFAULT '',conversation_id TEXT DEFAULT '',updated_at TEXT); CREATE TABLE messages (message_id TEXT PRIMARY KEY,workspace_id TEXT,status TEXT); CREATE TABLE outbox (outbox_id TEXT PRIMARY KEY,message_id TEXT UNIQUE,attempts INTEGER,max_attempts INTEGER,next_attempt_at TEXT,status TEXT,last_error TEXT,created_at TEXT,updated_at TEXT,workspace_id TEXT);");
 const DB = { prepare(sql) { return { bind(...values) { return { async first() { return db.prepare(sql).get(...values); }, async all() { return {results:db.prepare(sql).all(...values)}; }, async run() { return {meta: { changes: db.prepare(sql).run(...values).changes }}; } }; } }; }, async batch(statements) { db.exec('BEGIN'); try { const result=[]; for(const s of statements) result.push(await s.run()); db.exec('COMMIT'); return result; } catch(e) { db.exec('ROLLBACK'); throw e; } } };
 const context=vm.createContext({ crypto, env:{DB}, Date, console:{error() {}}, safeJsonParse:(s,f)=>{try{return JSON.parse(s);}catch{return f;}}, cleanError:e=>e.message });
 return {db, context};
}
function seed(h,id,count,job) {
 h.db.prepare("INSERT INTO campaigns VALUES (?,'ws','sending')").run(id);
 for(let i=0;i<count;i++) h.db.prepare("INSERT INTO campaign_recipients (recipient_id,campaign_id,workspace_id,status) VALUES (?, ?,'ws','pending')").run(id+'-'+i,id);
 if(job) h.db.prepare("INSERT INTO campaign_jobs VALUES (?, 'ws', '{}', 'active', '', '2026-11-04')").run(id);
}
test('migration never registers legacy campaigns; 38 new recipients finish across persistent batches',async()=>{
 const h=setup();seed(h,'legacy',38,false);h.db.exec(migration);seed(h,'new',38,true);
 let calls=0;
 h.context.processCampaign=async(env,ws,id,p,limit)=>{calls++; const rows=h.db.prepare("SELECT recipient_id FROM campaign_recipients WHERE campaign_id=? AND status='pending' LIMIT ?").all(id,limit);for(const r of rows) h.db.prepare("UPDATE campaign_recipients SET status='queued',message_id=? WHERE recipient_id=?").run(r.recipient_id,r.recipient_id);};
 vm.runInContext(extract('runCampaignQueue','processCampaign'),h.context);
 for(let i=0;i<4;i++) await vm.runInContext('runCampaignQueue(env)',h.context);
 assert.equal(calls,4);
 assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM campaign_recipients WHERE campaign_id='legacy' AND status='pending'").get().n,38);
 assert.equal(h.db.prepare("SELECT state FROM campaign_jobs WHERE campaign_id='new'").get().state,'done');
});
test('queue failures release lease for retry and active leases prevent parallel preparation',async()=>{
 const h=setup();h.db.exec(migration);seed(h,'new',1,true);let calls=0;
 h.context.processCampaign=async()=>{calls++;throw Error('Temporary interruption');};
 vm.runInContext(extract('runCampaignQueue','processCampaign'),h.context);
 await vm.runInContext('runCampaignQueue(env)',h.context);
 assert.equal(h.db.prepare('SELECT lease_until FROM campaign_jobs').get().lease_until,'');
 await vm.runInContext('runCampaignQueue(env)',h.context);assert.equal(calls,2);
 h.db.prepare('UPDATE campaign_jobs SET lease_until=?').run(new Date(Date.now()+1200000).toISOString());
 await vm.runInContext('runCampaignQueue(env)',h.context);assert.equal(calls,2);
});
test('recipient message linking is idempotent and never requeues a sent message',async()=>{
 const h=setup();h.db.exec(migration);seed(h,'new',1,true);h.db.exec("INSERT INTO messages VALUES ('message','ws','pending')");
 vm.runInContext(extract('queueCampaignRecipientMessage','runCampaignQueue'),h.context);
 h.context.recipient={recipientId:'new-0'};
 for(let i=0;i<2;i++) await vm.runInContext("queueCampaignRecipientMessage(env,'ws','new',recipient,'message','conversation')",h.context);
 assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n,1);
 h.db.exec("DELETE FROM outbox; UPDATE messages SET status='sent'");
 await vm.runInContext("queueCampaignRecipientMessage(env,'ws','new',recipient,'message','conversation')",h.context);
 assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n,0);
 assert.equal(h.db.prepare('SELECT status FROM campaign_recipients').get().status,'sent');
});

test('interrupted recipient preparation reuses its persisted message across all 38 recipients',async()=>{
 const h=setup();h.db.exec(migration);seed(h,'new',38,true);
 h.db.exec("ALTER TABLE campaigns ADD COLUMN updated_at TEXT; ALTER TABLE messages ADD COLUMN conversation_id TEXT; ALTER TABLE campaign_recipients ADD COLUMN contact_id TEXT; ALTER TABLE campaign_recipients ADD COLUMN display_name TEXT; ALTER TABLE campaign_recipients ADD COLUMN profile_id TEXT;");
 const campaign={campaignId:'new',channelId:'channel',messageType:'text',messageBody:'Hello'};
 h.context.getCampaignDetail=async()=>({item:campaign,recipients:h.db.prepare("SELECT recipient_id AS recipientId,message_id AS messageId,status FROM campaign_recipients WHERE campaign_id='new'").all()});
 h.context.getChannel=async()=>({channelId:'channel'});
 h.context.platformForChannel=()=> 'telegram';
 h.context.prepareCampaignRecipientTarget=async()=>({conversationId:'conversation',contactId:'contact',contact:{displayName:'Recipient'},profileId:'123'});
 h.context.applyTextVariables=text=>text;
 h.context.broadcast=async()=>{};h.context.getConversationItem=async()=>({});h.context.finalizeCampaign=async()=>({});
 let creations=0,interrupted=false;
 h.context.createOutboundMessage=async(env,ws,conv,payload,principal,id)=>{
   creations++;h.db.prepare("INSERT INTO messages (message_id,workspace_id,status,conversation_id) VALUES (?,?,'pending',?)").run(id,ws,conv);
   if(!interrupted){interrupted=true;throw Error('Process terminated after message commit');}
   return {message:{messageId:id}};
 };
 vm.runInContext(extract('queueCampaignRecipientMessage','runCampaignQueue')+extract('processCampaign','prepareCampaignRecipientTarget'),h.context);
 await assert.rejects(vm.runInContext("processCampaign(env,'ws','new',{},10)",h.context),/terminated/);
 for(let i=0;i<4;i++) await vm.runInContext("processCampaign(env,'ws','new',{},10)",h.context);
 assert.equal(creations,38);
 assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,38);
 assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n,38);
 assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM campaign_recipients WHERE message_id='' ").get().n,0);
});
