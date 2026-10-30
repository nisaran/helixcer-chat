import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  extractInteraktCustomer,
  mapInteraktMessage,
  INTERAKT_SOURCE
} from '../src/imports/interakt.js';

test('extracts Interakt customer phone and name from raw_chat', () => {
  const customer = extractInteraktCustomer({
    id: 'chat-1',
    status: 'closed',
    customer: { name: '', phone: '' },
    raw_chat: {
      customer_id: {
        phone_number: '9876543210',
        country_code: '91',
        channel_phone_number: '919876543210',
        traits: { name: 'Asha Rao' }
      }
    },
    messages: []
  });
  assert.equal(customer.externalId, 'chat-1');
  assert.equal(customer.phone, '919876543210');
  assert.equal(customer.displayName, 'Asha Rao');
  assert.equal(customer.status, 'closed');
});

test('maps Interakt template and media messages', () => {
  const template = mapInteraktMessage({
    id: 'm1',
    channel_message_id: 'wamid.1',
    direction: 'outbound',
    content_type: 'Template',
    text: JSON.stringify([{ type: 'body', parameters: [{ type: 'text', text: 'Helixcer' }] }]),
    status: 'Read',
    timestamp: '2026-01-01T00:00:00+0000'
  });
  assert.equal(template.messageType, 'template');
  assert.equal(template.text, 'Helixcer');
  assert.equal(template.status, 'read');
  assert.equal(template.direction, 'outbound');

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

test('dashboard exposes Import Chat under channel data', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../../assets/app.js', import.meta.url), 'utf8');
  assert.match(html, /data-route="import-chat"/);
  assert.match(html, /Import Chat/);
  assert.match(html, /id="importChatSource"/);
  assert.match(html, /value="interakt"/);
  assert.match(app, /\/api\/channel-data\/import-chat/);
  assert.match(app, /chunkInteraktConversations/);
  assert.equal(INTERAKT_SOURCE, 'interakt');
});
