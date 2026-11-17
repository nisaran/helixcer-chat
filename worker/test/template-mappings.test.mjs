import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import {
  TEMPLATE_MAPPING_SOURCES,
  inboxSourceFromMappingSource,
  normalizeTemplateMappingItem,
  serializeWhatsAppTemplateMappingRow,
  templateMappingKey,
  validateWhatsAppTemplateMappingsUpsert
} from '../src/template-mappings.js';
import { resolveCampaignVariableValue } from '../src/campaigns.js';

test('template mapping validation accepts known sources and drops empty ones', () => {
  const input = validateWhatsAppTemplateMappingsUpsert({
    channelId: 'wa-sales',
    templateName: 'order_confirmation',
    templateLanguage: 'en_US',
    mappings: [
      { id: 'body-text-0-1', placeholder: '1', componentType: 'body', source: 'contact.displayName' },
      { id: 'body-text-1-2', placeholder: '2', componentType: 'body', source: '' },
      { id: 'body-text-2-3', placeholder: '3', componentType: 'body', source: 'constant', value: 'Helixcer' }
    ]
  });
  assert.equal(input.templateName, 'order_confirmation');
  assert.equal(input.mappings.length, 2);
  assert.equal(input.mappings[0].source, 'contact.displayName');
  assert.equal(input.mappings[1].value, 'Helixcer');
});

test('template mapping validation rejects unknown sources', () => {
  assert.throws(() => validateWhatsAppTemplateMappingsUpsert({
    channelId: 'wa-sales',
    templateName: 'order_confirmation',
    templateLanguage: 'en_US',
    mappings: [{ id: 'body-1', source: 'secret.token' }]
  }), /Unsupported mapping source/i);
});

test('inbox source translation covers workspace and agent', () => {
  assert.equal(inboxSourceFromMappingSource('contact.displayName'), 'displayName');
  assert.equal(inboxSourceFromMappingSource('workspace.name'), 'workspaceName');
  assert.equal(inboxSourceFromMappingSource('agent.displayName'), 'agentName');
  assert.equal(inboxSourceFromMappingSource('constant'), 'manual');
  assert.ok(TEMPLATE_MAPPING_SOURCES.some((item) => item.value === 'channel.name'));
});

test('campaign resolver supports workspace, channel, and agent sources', () => {
  assert.equal(resolveCampaignVariableValue({ source: 'workspace.name' }, {
    workspace: { displayName: 'Helixcer workspace' }
  }), 'Helixcer workspace');
  assert.equal(resolveCampaignVariableValue({ source: 'channel.name' }, {
    channel: { name: 'Sales WhatsApp' }
  }), 'Sales WhatsApp');
  assert.equal(resolveCampaignVariableValue({ source: 'agent.displayName' }, {
    agent: { displayName: 'Asha' }
  }), 'Asha');
  assert.equal(resolveCampaignVariableValue({ source: 'contact.email' }, {
    contact: { email: 'ada@example.com' }
  }), 'ada@example.com');
});

test('serialize mapping rows and keys stay stable', () => {
  assert.equal(templateMappingKey('wa-sales', 'Order_Confirmation', 'en_US'), 'wa-sales::order_confirmation::en_US');
  const item = serializeWhatsAppTemplateMappingRow({
    channel_id: 'wa-sales',
    template_name: 'order_confirmation',
    template_language: 'en_US',
    mappings_json: JSON.stringify([
      normalizeTemplateMappingItem({ id: 'body-1', source: 'contact.company', componentType: 'body' })
    ]),
    updated_at: '2026-11-17T00:00:00.000Z',
    updated_by: 'owner@example.com'
  });
  assert.equal(item.mappings[0].source, 'contact.company');
  assert.equal(item.updatedBy, 'owner@example.com');
});

test('template mapping migration creates workspace table', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec(await readFile(new URL('../migrations/0030_whatsapp_template_variable_mappings.sql', import.meta.url), 'utf8'));
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  assert.ok(tables.includes('workspace_whatsapp_template_mappings'));
  database.prepare(`INSERT INTO workspace_whatsapp_template_mappings
    (workspace_id,channel_id,template_name,template_language,mappings_json,updated_at,updated_by)
    VALUES ('ws1','wa-sales','welcome_message','en_US','[]','2026-11-17T00:00:00.000Z','owner')`).run();
  const row = database.prepare('SELECT template_name FROM workspace_whatsapp_template_mappings').get();
  assert.equal(row.template_name, 'welcome_message');
});
