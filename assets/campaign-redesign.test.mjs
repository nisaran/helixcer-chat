import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const app=await readFile(new URL('./app.js',import.meta.url),'utf8');
const start=app.indexOf('  function filteredCampaignHistory()'),end=app.indexOf('  function closeCampaignHistoryFilterMenus(',start);
test('campaign search matches names templates and channel labels while preserving filters',()=>{
 const state={campaigns:{historySearch:'reminder',historyFilters:{},items:[{campaignId:'one',name:'Recharge',templateName:'payment_reminder',channelId:'wa',createdAt:'2026-11-04'}, {campaignId:'two',name:'Welcome',templateName:'hello',channelId:'tg',createdAt:'2026-11-04'}]}};
 const context=vm.createContext({state,Set,campaignHistoryPlatform:c=>c.channelId,campaignCreatedDay:date=>date,campaignHistoryChannelInfo:id=>({label:id==='wa'?'Sales WhatsApp':'Support Telegram'})});
 vm.runInContext(app.slice(start,end),context);
 const ids=()=>Array.from(vm.runInContext('filteredCampaignHistory()',context),c=>c.campaignId);
 assert.deepEqual(ids(),['one']);
 state.campaigns.historySearch='telegram';assert.deepEqual(ids(),['two']);
 state.campaigns.historySearch='';assert.deepEqual(ids(),['one','two']);
 state.campaigns.historyFilters.channels=new Set(['wa']);assert.deepEqual(ids(),['one']);
});
