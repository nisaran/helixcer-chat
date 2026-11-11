import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const start = app.indexOf('  function isApprovedWhatsAppTemplate(');
const end = app.indexOf('  async function loadCampaignTemplates(', start);
assert.ok(start >= 0 && end > start, 'expected isApprovedWhatsAppTemplate helper');
const context = vm.createContext({});
vm.runInContext(app.slice(start, end), context);

test('campaign template picker accepts approved and blank statuses only', () => {
  assert.equal(context.isApprovedWhatsAppTemplate({ status: 'APPROVED' }), true);
  assert.equal(context.isApprovedWhatsAppTemplate({ status: 'approved' }), true);
  assert.equal(context.isApprovedWhatsAppTemplate({ status: '' }), true);
  assert.equal(context.isApprovedWhatsAppTemplate({}), true);
  assert.equal(context.isApprovedWhatsAppTemplate({ status: 'PENDING' }), false);
  assert.equal(context.isApprovedWhatsAppTemplate({ status: 'PAUSED' }), false);
  assert.equal(context.isApprovedWhatsAppTemplate({ status: 'REJECTED' }), false);
});

test('campaign channel templates keep only approved rows for the selected channel', () => {
  const channelId = 'wa-sales';
  const templates = [
    { channelId: 'wa-sales', name: 'ok', status: 'APPROVED' },
    { channelId: 'wa-sales', name: 'pending', status: 'PENDING' },
    { channelId: 'wa-sales', name: 'paused', status: 'PAUSED' },
    { channelId: 'wa-other', name: 'other', status: 'APPROVED' },
    { name: 'legacy', status: 'APPROVED' },
  ].filter((template) => !template.channelId || template.channelId === channelId)
    .filter(context.isApprovedWhatsAppTemplate)
    .map((template) => template.name);
  assert.deepEqual(templates, ['ok', 'legacy']);
});
