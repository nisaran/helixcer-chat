import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import {
  applyTextVariables,
  campaignTemplatePreview,
  buildTemplateComponentsFromMappings,
  campaignCountsFromRows,
  campaignFinalStatus,
  preferCampaignRecipientStatus,
  resolveCampaignVariableValue
} from '../src/campaigns.js';

test('campaign variable resolution prefers contact fields, CSV headers, and constants', () => {
  assert.equal(resolveCampaignVariableValue({ source: 'contact.displayName' }, {
    contact: { displayName: 'Ada' }
  }), 'Ada');
  assert.equal(resolveCampaignVariableValue({ source: 'field.Phone' }, {
    row: { Phone: '919999999999' }
  }), '919999999999');
  assert.equal(resolveCampaignVariableValue({ source: 'constant', value: 'Hello' }, {}), 'Hello');
});

test('campaign text templates substitute mapped variables', () => {
  const text = applyTextVariables('Hello {{name}} from {{company}}', [
    { key: 'name', source: 'contact.displayName' },
    { key: 'company', source: 'constant', value: 'Helixcer' }
  ], { contact: { displayName: 'Ada' } });
  assert.equal(text, 'Hello Ada from Helixcer');
});

test('campaign template components build media links and text parameters', () => {
  const components = buildTemplateComponentsFromMappings([
    { kind: 'media', componentType: 'header', mediaType: 'image', source: 'url', value: 'https://cdn.example/a.jpg' },
    { kind: 'text', componentType: 'body', parameterIndex: 0, source: 'contact.displayName' }
  ], { contact: { displayName: 'Ada' } });
  assert.deepEqual(components[0], {
    type: 'header',
    parameters: [{ type: 'image', image: { link: 'https://cdn.example/a.jpg' } }]
  });
  assert.deepEqual(components[1], {
    type: 'body',
    parameters: [{ type: 'text', text: 'Ada' }]
  });
});

test('campaign counts and final status aggregate recipient delivery', () => {
  const counts = campaignCountsFromRows([
    { status: 'delivered' },
    { status: 'read' },
    { status: 'failed' },
    { status: 'pending' }
  ]);
  assert.deepEqual(counts, {
    totalCount: 4,
    pendingCount: 1,
    sentCount: 2,
    deliveredCount: 2,
    readCount: 1,
    failedCount: 1
  });
  assert.equal(campaignFinalStatus(counts), 'sending');
  assert.equal(campaignFinalStatus({ ...counts, pendingCount: 0 }), 'completed_with_errors');
  assert.equal(preferCampaignRecipientStatus('sent', 'delivered'), 'delivered');
  assert.equal(preferCampaignRecipientStatus('failed', 'read'), 'failed');
});

test('campaigns migration creates campaign tables', async () => {
  const sql = await readFile(new URL('../migrations/0021_campaigns.sql', import.meta.url), 'utf8');
  const database = new DatabaseSync(':memory:');
  database.exec(sql);
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  assert.ok(tables.includes('campaigns'));
  assert.ok(tables.includes('campaign_recipients'));
});

test('campaign template previews defer to approved copy for new and legacy name-only previews', () => {
  assert.equal(campaignTemplatePreview('', 'outstanding_reminder_amt'), '');
  assert.equal(campaignTemplatePreview('outstanding_reminder_amt', 'outstanding_reminder_amt'), '');
  assert.equal(campaignTemplatePreview('  outstanding_reminder_amt  ', 'outstanding_reminder_amt'), '');
  assert.equal(campaignTemplatePreview('Hello Ada, your payment is due.', 'outstanding_reminder_amt'), 'Hello Ada, your payment is due.');
});
