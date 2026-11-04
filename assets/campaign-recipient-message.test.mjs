import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
test('recipient info opens only the selected full message as plain text', () => {
  const body = {}; let opened = 0;
  const context = vm.createContext({state:{campaigns:{recipientsByCampaign:new Map([['c1', [{recipientId:'r1',messageText:'Hello\n<script>literal</script>'},{recipientId:'r2',messageText:'Other message'}]]])}}, $: id => id === 'campaignRecipientMessageBody' ? body : {showModal(){opened++;}}});
  const start = app.indexOf('  function showCampaignRecipientMessage(');
  const end = app.indexOf('  function campaignFullDetailsMarkup(', start);
  vm.runInContext(app.slice(start, end), context);
  vm.runInContext('showCampaignRecipientMessage("c1", "r1")', context);
  assert.equal(body.textContent, 'Hello\n<script>literal</script>');
  assert.equal(opened, 1);
  vm.runInContext('showCampaignRecipientMessage("c1", "missing")', context);
  assert.equal(opened, 1);
});
