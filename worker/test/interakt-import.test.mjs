import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CONTACT_TARGET_FIELDS,
  defaultInteraktFieldMapping,
  discoverInteraktContactFields,
  extractInteraktCustomer,
  mapInteraktMessage,
  INTERAKT_SOURCE
} from '../src/imports/interakt.js';

const sampleConversations = [{
  id: 'chat-1',
  status: 'closed',
  customer: { name: '', phone: '' },
  raw_chat: {
    customer_id: {
      phone_number: '9876543210',
      country_code: '91',
      channel_phone_number: '919876543210',
      tags: ['vip', 'repeat'],
      traits: { name: 'Asha Rao', Company: 'Helixcer', email: 'asha@example.com' }
    }
  },
  messages: []
}];

test('discovers Interakt contact fields and suggests defaults', () => {
  const fields = discoverInteraktContactFields(sampleConversations);
  const paths = fields.map(field => field.path);
  assert.ok(paths.includes('channel_phone_number'));
  assert.ok(paths.includes('traits.name'));
  assert.ok(paths.includes('traits.Company'));
  assert.ok(paths.includes('tags'));
  const mapping = defaultInteraktFieldMapping(fields);
  assert.equal(mapping.name, 'traits.name');
  assert.equal(mapping.phone, 'channel_phone_number');
  assert.equal(mapping.company, 'traits.Company');
  assert.equal(mapping.tags, '');
  assert.deepEqual(CONTACT_TARGET_FIELDS.map(field => field.key), ['name', 'phone', 'company', 'tags']);
});

test('extracts mapped Interakt customer fields only', () => {
  const customer = extractInteraktCustomer(sampleConversations[0], {
    name: 'traits.name',
    phone: 'channel_phone_number',
    company: 'traits.Company',
    tags: ''
  });
  assert.equal(customer.externalId, 'chat-1');
  assert.equal(customer.phone, '919876543210');
  assert.equal(customer.displayName, 'Asha Rao');
  assert.equal(customer.company, 'Helixcer');
  assert.deepEqual(customer.tags, []);

  const withTags = extractInteraktCustomer(sampleConversations[0], {
    name: 'traits.name',
    phone: 'phone_number_with_country_code',
    company: '',
    tags: 'tags'
  });
  assert.equal(withTags.phone, '919876543210');
  assert.equal(withTags.company, '');
  assert.deepEqual(withTags.tags, ['vip', 'repeat']);
});

test('maps Interakt template and media messages', () => {
  const template = mapInteraktMessage({
    id: 'm1',
    channel_message_id: 'wamid.1',
    direction: 'outbound',
    content_type: 'Template',
    text: JSON.stringify([{ type: 'body', parameters: [{ type: 'text', text: 'Helixcer' }] }]),
    status: 'Read',
    timestamp: '2026-01-01T00:00:00+0000',
    raw: {
      raw_template: {
        name: 'payment_reminder_no_amt',
        language: 'en',
        category: 'UTILITY',
        wa_template_id: '1101022894926797',
        body: 'Hi {{1}},\n\nJust a quick reminder about the payment due.',
        footer: 'Thanks & Regards, Helixcer',
        buttons: '[{"type":"URL","text":"Pay now","url":"https://example.com/{{1}}"}]'
      }
    }
  });
  assert.equal(template.messageType, 'template');
  assert.equal(
    template.text,
    'Hi Helixcer,\n\nJust a quick reminder about the payment due.\nThanks & Regards, Helixcer\nActions: Pay now'
  );
  assert.equal(template.template?.name, 'payment_reminder_no_amt');
  assert.equal(template.template?.language?.code, 'en');
  assert.deepEqual(template.template?.buttons, [{ type: 'url', text: 'Pay now' }]);
  assert.equal(template.status, 'read');
  assert.equal(template.direction, 'outbound');

  const paramsOnly = mapInteraktMessage({
    id: 'm1b',
    channel_message_id: 'wamid.1b',
    direction: 'outbound',
    content_type: 'Template',
    text: JSON.stringify([
      { type: 'body', parameters: [{ type: 'text', text: 'Acme' }, { type: 'text', text: '1200' }] }
    ]),
    status: 'Read',
    timestamp: '2026-01-01T00:00:00+0000'
  });
  assert.equal(paramsOnly.text, 'Acme · 1200');

  const image = mapInteraktMessage({
    id: 'm2',
    channel_message_id: 'wamid.2',
    direction: 'inbound',
    content_type: 'Image',
    text: '',
    media_url: 'https://example.com/a.jpg',
    media_file_name: 'a.jpg',
    status: 'Delivered',
    timestamp: '2026-01-01T00:01:00+0000',
    reply_to: 'wamid.1'
  });
  assert.equal(image.messageType, 'image');
  assert.equal(image.text, 'a.jpg');
  assert.equal(image.mediaUrl, 'https://example.com/a.jpg');
  assert.equal(image.replyTo, 'wamid.1');
  assert.equal(image.status, 'delivered');
});

test('dashboard exposes Import Chat field mapping UI', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../../assets/app.js', import.meta.url), 'utf8');
  assert.match(html, /data-route="import-chat"/);
  assert.match(html, /id="importChatMapping"/);
  assert.match(html, /Map contact fields/);
  assert.match(html, /For each field in the uploaded file/);
  assert.match(app, /\/api\/channel-data\/import-chat/);
  assert.match(app, /fieldMapping/);
  assert.match(app, /sourceAssignments/);
  assert.match(app, /dataset\.importSource/);
  assert.match(app, /discoverInteraktContactFields/);
  assert.match(app, /import-chat-mapping-example/);
  assert.match(app, /formatImportFieldExample/);
  assert.match(app, /Don’t import|Don't import/);
  assert.match(app, /slimInteraktConversation/);
  assert.match(app, /raw_template/);
  assert.match(app, /parameter values joined with middots/);
  assert.equal(INTERAKT_SOURCE, 'interakt');
});
