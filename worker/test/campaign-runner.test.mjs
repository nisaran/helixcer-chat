import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {runCampaignConcurrent,serializeCampaign} from '../src/campaigns.js';
const source=await readFile(new URL('../src/index.js',import.meta.url),'utf8');
const extract=(a,b)=>source.slice(source.indexOf('async function '+a+'('),source.indexOf('async function '+b+'('));
async function harness(){
 const db=new DatabaseSync(':memory:');
 for(const file of ['0021_campaigns.sql','0025_campaign_jobs.sql','0026_campaign_upload_chunks.sql'])db.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
 db.exec('CREATE TABLE outbox (message_id TEXT,workspace_id TEXT,status TEXT,next_attempt_at TEXT)');
 let tail=Promise.resolve();
 const DB={prepare(sql){return{bind(...values){return{async first(){return db.prepare(sql).get(...values);},async all(){return{results:db.prepare(sql).all(...values)};},async run(){return{meta:{changes:db.prepare(sql).run(...values).changes}};}};}};},async batch(statements){const work=async()=>{db.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};const next=tail.then(work);tail=next.catch(()=>{});return next;}};
 const context=vm.createContext({env:{DB},Date,console,serializeCampaign,runCampaignConcurrent,hashText:async v=>createHash('sha256').update(v).digest('hex'),cleanId:v=>v,cleanError:e=>e.message,httpError:(status,message)=>Object.assign(new Error(message),{status}),rejectUnknownKeys(){},assertPrincipalChannelAccess(){},safeJsonParse:(s,f)=>{try{return JSON.parse(s);}catch{return f;}},prepareCampaignRecipientRows:async(env,ws,input)=>input.recipients.map(raw=>({contactId:raw.contactId,displayName:'Contact',profileId:'',rowJson:'{}'}))});
 db.prepare("INSERT INTO campaigns (campaign_id,workspace_id,name,channel_id,status,created_at,updated_at) VALUES ('c','ws','Campaign','channel','queued','2026-11-05','2026-11-05')").run();
 db.prepare("INSERT INTO campaign_jobs VALUES ('c','ws','{}','uploading','','2026-11-05')").run();
 return{db,context};
}
test('campaign worker pool processes all recipients with three tasks in flight and waits for siblings on error',async()=>{
 let running=0,peak=0,done=0;
 await runCampaignConcurrent(Array.from({length:100},(_,i)=>i),3,async()=>{running++;peak=Math.max(peak,running);await new Promise(resolve=>setImmediate(resolve));running--;done++;});
 assert.equal(peak,3);assert.equal(done,100);
 done=0;await assert.rejects(runCampaignConcurrent([1,2,3,4],3,async i=>{await new Promise(resolve=>setImmediate(resolve));done++;if(i===1)throw Error('retry');}),/retry/);assert.equal(done,4);
});
test('more than 500 recipients upload in replay-safe chunks and remain held until finalization',async()=>{
 const h=await harness();vm.runInContext(extract('appendCampaignRecipients','runCampaignQueue'),h.context);
 for(let n=0;n<25;n++){
  const payload={chunkId:'chunk-'+n,recipients:Array.from({length:50},(_,i)=>({contactId:'contact-'+(n*50+i)}))};
  await h.context.appendCampaignRecipients(h.context.env,'ws','c',payload,{});
  await h.context.appendCampaignRecipients(h.context.env,'ws','c',payload,{});
 }
 assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM campaign_recipients').get().n,1250);
 assert.equal(h.db.prepare('SELECT state FROM campaign_jobs').get().state,'uploading');
 await assert.rejects(h.context.appendCampaignRecipients(h.context.env,'ws','c',{chunkId:'chunk-0',recipients:[]},{}),/different content/);
 const finish={chunkId:'finalize',recipients:[],finalize:true};
 await h.context.appendCampaignRecipients(h.context.env,'ws','c',finish,{});
 await h.context.appendCampaignRecipients(h.context.env,'ws','c',finish,{});
 assert.equal(h.db.prepare('SELECT state FROM campaign_jobs').get().state,'active');
 assert.equal(h.db.prepare('SELECT total_count FROM campaigns').get().total_count,1250);
 await assert.rejects(h.context.appendCampaignRecipients(h.context.env,'other','c',{chunkId:'x',recipients:[]},{}),/not found/);
});
test('continuous alarm stops for held, paused, cancelled, and terminal campaigns',async()=>{
 const h=await harness();let prepared=0,sent=0;
 h.context.processCampaign=async()=>{prepared++;};h.context.retryDueMessages=async()=>{sent++;};h.context.finalizeCampaign=async()=>({status:'completed'});
 vm.runInContext(extract('runCampaignAlarm','appendCampaignRecipients'),h.context);
 assert.equal(await h.context.runCampaignAlarm(h.context.env,'c'),0);
 h.db.exec("UPDATE campaign_jobs SET state='active'");
 for(const status of ['paused','cancelled','completed','completed_with_errors','failed']){h.db.prepare('UPDATE campaigns SET status=?').run(status);assert.equal(await h.context.runCampaignAlarm(h.context.env,'c'),0);}
 assert.equal(prepared,0);assert.equal(sent,0);
 h.db.exec("UPDATE campaigns SET status='sending'");
 assert.equal(await h.context.runCampaignAlarm(h.context.env,'c'),0);assert.equal(prepared,1);assert.equal(sent,1);
});
test('continuous alarm schedules another pass immediately and releases lease after interruption',async()=>{
 const h=await harness();h.db.exec("UPDATE campaign_jobs SET state='active'; UPDATE campaigns SET status='sending'; INSERT INTO campaign_recipients (recipient_id,campaign_id,workspace_id,created_at,updated_at) VALUES ('r','c','ws','2026-11-05','2026-11-05')");
 h.context.processCampaign=async()=>{};h.context.retryDueMessages=async()=>{};h.context.finalizeCampaign=async()=>({status:'sending'});
 vm.runInContext(extract('runCampaignAlarm','appendCampaignRecipients'),h.context);
 const before=Date.now(),next=await h.context.runCampaignAlarm(h.context.env,'c');assert.ok(next>=before&&next<before+5000);
 assert.equal(h.db.prepare('SELECT lease_until FROM campaign_jobs').get().lease_until,'');
 h.context.processCampaign=async()=>{throw Error('temporary test failure');};
 await h.context.runCampaignAlarm(h.context.env,'c');assert.equal(h.db.prepare('SELECT lease_until FROM campaign_jobs').get().lease_until,'');
});

test('new chunked campaign creation holds its first page before accepting the rest',async()=>{
 const h=await harness();h.db.exec('DELETE FROM campaign_jobs; DELETE FROM campaigns');
 h.context.crypto={randomUUID:()=> 'created'};
 h.context.validateCampaignPayload=p=>p;h.context.getChannel=async()=>({channelId:'channel',connectorType:'telegram'});
 h.context.assertChannelReadyForConversation=async()=>{};h.context.logicalConnectorType=c=>c.connectorType;h.context.audit=async()=>{};
 h.context.campaignCountsFromRows=rows=>({totalCount:rows.length,pendingCount:rows.length});
 h.context.getCampaignDetail=async()=>({item:h.db.prepare("SELECT * FROM campaigns WHERE campaign_id='created'").get()});
 h.context.prepareCampaignRecipientRows=async(env,ws,input)=>input.recipients.map((raw,index)=>({recipientId:'first-'+index,contactId:raw.contactId,displayName:'Contact',profileId:'',rowJson:'{}'}));
 vm.runInContext(source.slice(source.indexOf('async function createCampaign('),source.indexOf('function mapUploadRecipient(')),h.context);
 const payload={uploading:true,name:'Large campaign',channelId:'channel',audienceSource:'contacts',messageType:'text',text:'Hello',recipients:Array.from({length:50},(_,i)=>({contactId:'contact-'+i})),variableMappings:[],textVariables:[],fieldMapping:{}};
 await h.context.createCampaign(h.context.env,'ws',payload,{});
 assert.equal(h.db.prepare('SELECT state FROM campaign_jobs').get().state,'uploading');
 assert.equal(h.db.prepare('SELECT total_count FROM campaigns').get().total_count,50);
});
