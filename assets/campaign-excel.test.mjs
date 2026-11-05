import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), XLSX=require('./vendor/xlsx-0.20.3.full.min.js');
const app=await readFile(new URL('./app.js',import.meta.url),'utf8');
for(const [extension,bookType] of [['xlsx','xlsx'],['xls','biff8']]) test('imports '+extension+' using first sheet and preserves text IDs',async()=>{
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Name','Phone'],['Customer','001234567890']] ),'Contacts');
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Wrong'],['ignored']]),'Other');
 const bytes=XLSX.write(book,{type:'array',bookType});let loaded;
 const context=vm.createContext({XLSX,applyCampaignCsvText:async(text,name)=>{loaded={text,name};}});
 const start=app.indexOf('  async function applyCampaignUploadFile('),end=app.indexOf('  async function applyCampaignCsvText(',start);vm.runInContext(app.slice(start,end),context);
 await context.applyCampaignUploadFile({name:'contacts.'+extension,size:bytes.byteLength,arrayBuffer:async()=>bytes});
 assert.match(loaded.text,/001234567890/);assert.doesNotMatch(loaded.text,/ignored/);
 await assert.rejects(()=>context.applyCampaignUploadFile({name:'contacts.xlsx',size:11*1024*1024}),/10 MB/);
});
test('exports all recipients with full message and literal formula-like names',()=>{
 const context=vm.createContext({campaignStatusLabel:s=>s,formatCampaignTime:s=>s});
 const start=app.indexOf('  function campaignRecipientExportRows('),end=app.indexOf('  function exportCampaignRecipients(',start);vm.runInContext(app.slice(start,end),context);
 const data=Array.from({length:25},(_,i)=>({displayName:'=SUM(1,2)',profileId:'001234',status:'sent',messageText:'Full\nmessage '+i,updatedAt:'2026-11-05'}));
 const rows=context.campaignRecipientExportRows(data);assert.equal(rows.length,26);assert.equal(rows[25][4],'Full\nmessage 24');
 const sheet=XLSX.utils.aoa_to_sheet(rows);assert.equal(sheet.A2.t,'s');assert.equal(sheet.A2.f,undefined);assert.equal(sheet.B2.v,'001234');
});

test('Excel campaign import retains rows beyond the old 500-contact limit',async()=>{
 const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['Name','Phone'],...Array.from({length:1200},(_,i)=>['Contact '+i,'001'+i])]),'Contacts');
 const bytes=XLSX.write(workbook,{type:'array',bookType:'xlsx'});let rows;
 const context=vm.createContext({XLSX,applyCampaignCsvText:async text=>{rows=text.trim().split('\n');}});
 const start=app.indexOf('  async function applyCampaignUploadFile('),end=app.indexOf('  async function applyCampaignCsvText(',start);vm.runInContext(app.slice(start,end),context);
 await context.applyCampaignUploadFile({name:'large.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes});
 assert.equal(rows.length,1201);assert.match(rows[1200],/Contact 1199/);
});
