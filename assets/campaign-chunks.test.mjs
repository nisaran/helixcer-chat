import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('./app.js',import.meta.url),'utf8');
test('campaign recipient chunking preserves audiences above 500 with bounded requests',()=>{
 const context=vm.createContext({TextEncoder});const start=app.indexOf('  function campaignRecipientChunks('),end=app.indexOf('  async function applyCampaignUploadFile(',start);vm.runInContext(app.slice(start,end),context);
 const input=Array.from({length:12501},(_,i)=>({contactId:'contact-'+i}));const chunks=context.campaignRecipientChunks(input);
 assert.equal(chunks.flat().length,12501);assert.equal(chunks[0].length,50);assert.equal(chunks.at(-1)[0].contactId,'contact-12500');
 assert.ok(chunks.every(chunk=>new TextEncoder().encode(JSON.stringify(chunk)).length<130*1024));
});
