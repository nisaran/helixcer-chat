import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
test('permission search filters visible rows and groups without changing permissions',()=>{
 const chats=[{dataset:{permissionSearch:'inbox view conversations'}},{dataset:{permissionSearch:'inbox reply to conversations'}}];
 const contacts=[{dataset:{permissionSearch:'contacts add contacts'}}];const groups=[chats,contacts].map(rows=>({querySelectorAll:()=>rows}));
 const input={value:'CONTACTS'},empty={hidden:true};const permissions={chats:{view:'assigned',reply:'assigned'},contacts:{create:true}};
 const context=vm.createContext({state:{roles:{draft:{permissions}}},$:id=>id==='rolePermissionSearch'?input:empty,document:{querySelectorAll:()=>groups}});
 const a=source.indexOf('  function applyRolePermissionSearch()'),b=source.indexOf('  function markRoleDraftDirty()',a);vm.runInContext(source.slice(a,b),context);
 context.applyRolePermissionSearch();assert.equal(groups[0].hidden,true);assert.equal(groups[1].hidden,false);assert.equal(empty.hidden,true);
 input.value='no matching permission';context.applyRolePermissionSearch();assert.equal(empty.hidden,false);
 input.value='';context.applyRolePermissionSearch();assert.ok(groups.every(group=>!group.hidden));assert.equal(permissions.chats.view,'assigned');assert.equal(permissions.contacts.create,true);
});
