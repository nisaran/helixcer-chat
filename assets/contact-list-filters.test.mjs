import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('./app.js',import.meta.url),'utf8');
const makeContext=()=>vm.createContext({state:{channels:[],contactListFilters:{}},Date,Map,asItems:x=>x,normalizeContact:x=>x,contactBoundChannelIds:c=>c.channelIds||[],contactActivePlatforms:c=>Object.keys(c.platformIds||{}),contactPlatformIds:c=>c.platformIds||{}});
test('contact filters OR selected values and AND filter categories across the whole catalogue',()=>{
 const context=makeContext();const start=app.indexOf('  function filteredContactCatalogue('),end=app.indexOf('  function renderContactListFilterOptions(',start);vm.runInContext(app.slice(start,end),context);
 const pool=Array.from({length:205},(_,i)=>({contactId:String(i),displayName:'Contact '+i,company:i<100?'A':'B',tags:[i%2?'vip':'new'],channelIds:['ch1'],platformIds:{whatsapp:'001'+i}}));
 let filters={companies:new Set(['A','B']),tags:new Set(['vip']),platforms:new Set(['whatsapp']),channels:new Set(['ch1'])};
 assert.equal(context.filteredContactCatalogue(pool,filters).length,102);
 assert.equal(context.filteredContactCatalogue(pool,filters,'Contact 203')[0].contactId,'203');
 filters.channels=new Set(['other']);assert.equal(context.filteredContactCatalogue(pool,filters).length,0);
 assert.equal(context.filteredContactCatalogue(pool,{}).length,205);
});
test('filter options load all contact pages and do not reuse another API session catalogue',async()=>{
 const context=makeContext();let calls=0;const pool=Array.from({length:650},(_,i)=>({contactId:String(i)}));
 context.state.api={listContacts:async({page,limit})=>{calls++;return {items:pool.slice((page-1)*limit,page*limit),total:650,pageSize:limit};}};
 const start=app.indexOf('  async function ensureContactListCatalogue('),end=app.indexOf('  function filteredContactCatalogue(',start);vm.runInContext(app.slice(start,end),context);
 assert.equal((await context.ensureContactListCatalogue()).length,650);assert.equal(calls,2);
 await context.ensureContactListCatalogue();assert.equal(calls,2);
 context.state.api={listContacts:async()=>({items:[],total:0})};assert.equal((await context.ensureContactListCatalogue()).length,0);
});
