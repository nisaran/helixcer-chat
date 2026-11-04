import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const app=await readFile(new URL('./app.js',import.meta.url),'utf8');
const eligible=app.slice(app.indexOf('  function campaignBulkEligible('),app.indexOf('  function renderCampaignBulkControls('));
const action=app.slice(app.indexOf('  async function applyCampaignBulkAction('),app.indexOf('  function renderCampaignHistory('));
for(const actionName of ['pause','resume','cancel']){
 test(actionName+' requires confirmation and dismissing it never calls the API',async()=>{
  let calls=0,confirmations=0;
  const state={campaigns:{bulkBusy:false,selectedIds:new Set(['c']),items:[{campaignId:'c',name:'Campaign',status:'sending'}]}};
  const context=vm.createContext({state,$:()=>({setAttribute(){}}),hasPermission:()=>true,capitalize:s=>s,
    renderCampaignBulkControls(){},renderCampaignHistory(){},showToast(){},
    requestConfirmation:async options=>{confirmations++;assert.ok(options.title.includes(actionName));return false;}});
  state.api={campaignAction:async()=>{calls++;}};
  vm.runInContext(eligible+action,context);
  context.actionName=actionName;
  await vm.runInContext('applyCampaignBulkAction(actionName)',context);
  assert.equal(confirmations,1);assert.equal(calls,0);assert.equal(state.campaigns.bulkBusy,false);
 });
}
