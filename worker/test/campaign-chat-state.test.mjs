import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
const source=await readFile(new URL('../src/index.js',import.meta.url),'utf8');
const extract=(name,next)=>source.slice(source.indexOf('async function '+name+'('),source.indexOf(next,source.indexOf('async function '+name+'(')));
for(const status of ['closed','open','pending'])for(const template of [false,true])test(`campaign ${template?'template':'text'} remains in inbox and preserves ${status} chat and assignment`,async()=>{
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE conversations(conversation_id TEXT,workspace_id TEXT,status TEXT,assigned_to TEXT,channel_id TEXT,identity_id TEXT,last_message_at TEXT,updated_at TEXT);
 CREATE TABLE messages(message_id TEXT,conversation_id TEXT,contact_id TEXT,channel_id TEXT,identity_id TEXT,direction TEXT,message_type TEXT,text TEXT,status TEXT,timestamp TEXT,payload_json TEXT,workspace_id TEXT,sender_login TEXT,sender_name TEXT);
 CREATE TABLE outbound_payloads(message_id TEXT,workspace_id TEXT,encrypted_payload TEXT,created_at TEXT,updated_at TEXT);
 CREATE TABLE outbox(outbox_id TEXT,message_id TEXT,attempts INTEGER,max_attempts INTEGER,next_attempt_at TEXT,status TEXT,last_error TEXT,created_at TEXT,updated_at TEXT,workspace_id TEXT);`);
 db.prepare('INSERT INTO conversations VALUES (?,?,?,?,?,?,?,?)').run('chat','ws',status,'agent@example.com','channel','identity','','');
 const DB={prepare(sql){return{bind(...values){return{run:async()=>db.prepare(sql).run(...values)};}};},batch:async statements=>{for(const st of statements)await st.run();}};
 let claims=0;
 const ctx=vm.createContext({Date,crypto,MAX_TEXT_LENGTH:10000,MAX_TEMPLATE_PREVIEW_LENGTH:10000,isPlainObject:()=>true,rejectUnknownKeys(){},cleanRequired:v=>v,cleanPreviewText:v=>v,assertConversationChannelAccess:async()=>{},assertPrincipalChannelAccess(){},assertFreeformReplyAllowed(){},resolveReplyTarget:async()=>null,outboundSenderAttribution:()=>({name:'Sender',login:'sender'}),conversationDeliveryTarget:async()=>({contact_id:'contact',channel_id:'channel',identity_id:'identity',enabled:1,connectorType:'whatsapp_cloud',channel:{}}),touchIdentityBinding:async()=>{},audit:async()=>{},claimUnassignedConversationOnReply:async()=>{claims++;return{};},validateWhatsAppTemplate:v=>v,validateTemplateMediaPreview:()=>null,templateMediaAttachment:()=>null,externalTemplateInboxPresentation:async()=>({text:'Hi Customer',storedPayload:{}}),encryptOutboundPayload:async()=> 'encrypted',templateMessageView:()=>({}),messageAttachmentView:()=>null});
 vm.runInContext(extract('createOutboundMessage','async function resolveReplyTarget(')+extract('createConversationTemplateMessage','function validateTemplateMediaPreview('),ctx);
 const fn=template?ctx.createConversationTemplateMessage:ctx.createOutboundMessage;
 const result=await fn({DB},'ws','chat',{text:'Hi Customer',name:'reminder',language:{code:'en'},previewText:'Hi Customer'},{},'campaign-recipient');
 assert.equal(result.assignment,null);assert.equal(claims,0);
 const row=db.prepare('SELECT * FROM conversations').get();assert.equal(row.status,status);assert.equal(row.assigned_to,'agent@example.com');assert.ok(row.last_message_at);
 const message=db.prepare("SELECT * FROM messages WHERE conversation_id='chat'").get();assert.equal(message.message_id,'campaign-recipient');assert.equal(message.text,'Hi Customer');assert.equal(message.direction,'outbound');
 // Ordinary manual replies still use the existing assignment behavior.
 await fn({DB},'ws','chat',{text:'Manual reply',name:'reminder',language:{code:'en'}},{});assert.equal(claims,1);
 db.close();
});
