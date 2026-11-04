import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const app=await readFile(new URL('./app.js',import.meta.url),'utf8');
test('selected template label reopens all options and typed text still filters',()=>{
 const templates=[{name:'chat_continue',language:{code:'en'}},{name:'payment_reminder',language:{code:'en'}}];
 const search={value:'chat_continue (en)'};
 const menu={items:[],replaceChildren(){this.items=[];},append(item){this.items.push(item);}};
 const context=vm.createContext({state:{campaigns:{templates}},$:id=>id==='campaignTemplateSearch'?search:menu,selectedCampaignTemplate:()=>templates[0],document:{createElement:()=>({dataset:{},addEventListener(){}})}});
 const start=app.indexOf('  function renderCampaignTemplateOptions()'),end=app.indexOf('  function selectedCampaignTemplate()',start);
 vm.runInContext(app.slice(start,end),context);
 vm.runInContext('renderCampaignTemplateOptions()',context);
 assert.equal(menu.items.length,2);
 assert.equal(search.value,'chat_continue (en)');
 search.value='payment';vm.runInContext('renderCampaignTemplateOptions()',context);
 assert.equal(menu.items.length,1);assert.equal(menu.items[0].textContent,'payment_reminder (en)');
});
test('overview counts follow filtered campaigns rather than the complete catalogue',()=>{
 let filtered=[{status:'sending'},{status:'paused'},{status:'completed'}];
 const context=vm.createContext({filteredCampaignHistory:()=>filtered});
 const start=app.indexOf('  function campaignHistoryCounts('),end=app.indexOf('  function renderCampaignHistory(',start);
 vm.runInContext(app.slice(start,end),context);
 let counts=vm.runInContext('campaignHistoryCounts()',context);
 assert.equal(counts.total,3);assert.equal(counts.inProgress,1);assert.equal(counts.paused,1);assert.equal(counts.completed,1);
 filtered=[{status:'completed'}];counts=vm.runInContext('campaignHistoryCounts()',context);
 assert.equal(counts.total,1);assert.equal(counts.inProgress,0);assert.equal(counts.completed,1);
 filtered=[];assert.equal(vm.runInContext('campaignHistoryCounts().total',context),0);
});
