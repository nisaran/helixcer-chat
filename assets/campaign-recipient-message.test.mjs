import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
test('recipient info shows selected full message in an anchored tooltip as plain text', () => {
  let opened = 0;
  const body = {id:'campaignRecipientMessageTooltip', style:{}, matches:()=>false, showPopover(){opened++;}, getBoundingClientRect:()=>({width:420,height:200})};
  const anchor = {setAttribute(){},getBoundingClientRect:()=>({right:900,top:300,bottom:324})};
  const context = vm.createContext({anchor,document:{querySelectorAll:()=>[]},window:{innerWidth:1000,innerHeight:700},state:{campaigns:{recipientsByCampaign:new Map([['c1', [{recipientId:'r1',messageText:'Hello\n<script>literal</script>'},{recipientId:'r2',messageText:'Other message'}]]])}}, $: () => body});
  const start = app.indexOf('  function hideCampaignRecipientMessage(');
  const end = app.indexOf('  function campaignFullDetailsMarkup(', start);
  vm.runInContext(app.slice(start, end), context);
  vm.runInContext('showCampaignRecipientMessage("c1", "r1", anchor)', context);
  assert.equal(body.textContent, 'Hello\n<script>literal</script>');
  assert.equal(opened, 1);
  vm.runInContext('showCampaignRecipientMessage("c1", "missing", anchor)', context);
  assert.equal(opened, 1);
});
