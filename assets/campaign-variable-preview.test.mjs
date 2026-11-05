import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('./app.js',import.meta.url),'utf8');
test('campaign preview keeps unmapped placeholders and replaces mapped sample values',()=>{
 const context=vm.createContext({});const start=app.indexOf('  function resolveCampaignPreviewValue('),end=app.indexOf('  function renderCampaignMessagePreview(',start);vm.runInContext(app.slice(start,end),context);
 assert.equal(context.fillTemplatePreviewText('Hi {{1}}, due {{2}}.',{'1':'','2':'   '}),'Hi {{1}}, due {{2}}.');
 const sample={contact:{displayName:'Nabeel',company:'Stories'},row:{Amount:'123'}};
 const values={'1':context.resolveCampaignPreviewValue({source:'contact.displayName'},sample),'2':context.resolveCampaignPreviewValue({source:'field.Amount'},sample)};
 assert.equal(context.fillTemplatePreviewText('Hi {{1}}, due {{2}}.',values),'Hi Nabeel, due 123.');
 assert.equal(context.fillTemplatePreviewText('{{name}}: {{1}} / {{2}}',{name:'Stories','1':0}),'Stories: 0 / {{2}}');
 assert.equal(context.fillTemplatePreviewText('{{1}}',{'1':context.resolveCampaignPreviewValue({source:'contact.missing'},sample)}),'{{1}}');
});
