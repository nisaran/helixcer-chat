import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('./app.js',import.meta.url),'utf8');
test('company suggestions search all loaded contacts and avoid duplicate casing',()=>{
 const api={}; const context=vm.createContext({state:{api,contactListCatalogueApi:api,contactListCatalogue:[{company:'Helixcer'},{company:'helixcer'},{company:'DROPX LOGISTICS'},{company:''}],contacts:[]}});
 const start=app.indexOf('  function contactCompanySuggestions('),end=app.indexOf('  function bindCompanyPicker(',start);vm.runInContext(app.slice(start,end),context);
 assert.equal(context.contactCompanySuggestions().length,2);assert.equal(context.contactCompanySuggestions('LOG')[0],'DROPX LOGISTICS');
 assert.equal(context.canonicalContactCompany('  HELIXCER  '),'Helixcer');assert.equal(context.canonicalContactCompany('New Company'),'New Company');assert.equal(context.canonicalContactCompany('  '),'');
 context.state.api={};context.state.contacts=[{company:'Other workspace'}];assert.equal(context.contactCompanySuggestions()[0],'Other workspace');
});
