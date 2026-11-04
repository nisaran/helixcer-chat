import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { applyCampaignActions, campaignDispatchState, campaignActionEligible } from '../src/campaign-controls.js';
const source=await readFile(new URL('../src/index.js',import.meta.url),'utf8');
const migration=await readFile(new URL('../migrations/0025_campaign_jobs.sql',import.meta.url),'utf8');
function setup(){
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE campaigns (campaign_id TEXT PRIMARY KEY,workspace_id TEXT,channel_id TEXT,status TEXT,updated_at TEXT,completed_at TEXT DEFAULT '',pending_count INTEGER DEFAULT 2); CREATE TABLE campaign_recipients (recipient_id TEXT,campaign_id TEXT,workspace_id TEXT,message_id TEXT,status TEXT,updated_at TEXT); CREATE TABLE messages (message_id TEXT,workspace_id TEXT,status TEXT,provider_message_id TEXT); CREATE TABLE outbox (message_id TEXT,workspace_id TEXT); CREATE TABLE outbound_payloads (message_id TEXT,workspace_id TEXT);");db.exec(migration);
 const DB = { prepare(sql) { return { bind(...values) { return { async first() { return db.prepare(sql).get(...values); }, async all() { return {results:db.prepare(sql).all(...values)}; }, async run() { return {meta: { changes: db.prepare(sql).run(...values).changes }}; } }; } }; }, async batch(statements) { db.exec('BEGIN'); try { const result=[]; for(const s of statements) result.push(await s.run()); db.exec('COMMIT'); return result; } catch(e) { db.exec('ROLLBACK'); throw e; } } };
 db.exec("INSERT INTO campaigns (campaign_id,workspace_id,channel_id,status) VALUES ('c','ws','channel','sending'); INSERT INTO campaign_recipients VALUES ('r1','c','ws','','pending',''),('r2','c','ws','m2','queued',''),('r3','c','ws','m3','sent',''); INSERT INTO messages VALUES ('m2','ws','pending',''),('m3','ws','sent','provider3'); INSERT INTO outbox VALUES ('m2','ws'); INSERT INTO outbound_payloads VALUES ('m2','ws');");
 return {db,env:{DB}};
}
test('pause preserves unsent work; explicit resume registers legacy campaign without re-creating recipients',async()=>{
 const h=setup();let permissions=0;const auth=()=>{permissions++;};
 await applyCampaignActions(h.env,'ws',['c'],'pause',{},auth);
 assert.equal(h.db.prepare('SELECT status FROM campaigns').get().status,'paused');
 assert.equal(await campaignDispatchState(h.env,'m2'),'paused');
 assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n,1);
 assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM campaign_jobs').get().n,0);
 await applyCampaignActions(h.env,'ws',['c'],'resume',{},auth);
 assert.equal(h.db.prepare('SELECT state FROM campaign_jobs').get().state,'active');
 assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM campaign_recipients').get().n,3);
 assert.equal(h.db.prepare("SELECT status FROM campaign_recipients WHERE recipient_id='r3'").get().status,'sent');
 assert.equal(permissions,2);
});
test('cancel is permanent and removes only remaining dispatch work',async()=>{
 const h=setup();await applyCampaignActions(h.env,'ws',['c'],'cancel',{},()=>{});
 assert.equal(h.db.prepare('SELECT status FROM campaigns').get().status,'cancelled');
 assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n,0);
 assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM outbound_payloads').get().n,0);
 assert.equal(h.db.prepare("SELECT status FROM campaign_recipients WHERE recipient_id='r3'").get().status,'sent');
 assert.equal(h.db.prepare("SELECT status FROM messages WHERE message_id='m2'").get().status,'cancelled');
 const result=await applyCampaignActions(h.env,'ws',['c'],'resume',{},()=>{});
 assert.equal(result.affectedIds.length,0);
});
test('entire selection is authorized before mutation and other workspaces cannot act',async()=>{
 const h=setup();await assert.rejects(applyCampaignActions(h.env,'ws',['c','missing'],'pause',{},()=>{}),/not found/);
 assert.equal(h.db.prepare('SELECT status FROM campaigns').get().status,'sending');
 await assert.rejects(applyCampaignActions(h.env,'other',['c'],'cancel',{},()=>{}),/not found/);
 await assert.rejects(applyCampaignActions(h.env,'ws',['c'],'pause',{},()=>{throw Error('Forbidden');}),/Forbidden/);
});
test('dispatch refuses paused/cancelled campaigns before any provider call',async()=>{
 const h=setup();const start=source.indexOf('async function dispatchOutbound('),end=source.indexOf('async function ',start+20);
 const context=vm.createContext({env:h.env,campaignDispatchState});vm.runInContext(source.slice(start,end),context);
 for(const status of ['paused','cancelled']){h.db.prepare('UPDATE campaigns SET status=?').run(status);await assert.rejects(vm.runInContext("dispatchOutbound(env,'m2')",context),e=>e.campaignHeld===true);}
 assert.equal(campaignActionEligible('resume','completed'),false);
});
