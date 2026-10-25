import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import {
  assertAllowedHttpsEndpoint,
  handleRequest,
  normalizeGeneric,
  normalizeTelegram,
  normalizeWhatsApp,
  resolveTemplate,
  timingSafeEqual,
  verifyMetaSignature
} from '../src/index.js';

test('normalizes inbound WhatsApp messages and statuses', () => {
  const result = normalizeWhatsApp({ entry: [{ changes: [{ value: {
    contacts: [{ wa_id: '919999999999', profile: { name: 'Asha' } }],
    messages: [{ id: 'wamid.1', from: '919999999999', timestamp: '1761360000', type: 'text', text: { body: 'Hello' } }],
    statuses: [{ id: 'wamid.out', status: 'delivered', timestamp: '1761360001' }]
  } }] }] });
  assert.equal(result.messages[0].displayName, 'Asha');
  assert.equal(result.messages[0].text, 'Hello');
  assert.equal(result.statuses[0].status, 'delivered');
});

test('normalizes a configured generic event list', () => {
  const result = normalizeGeneric({ events: [{ user: { id: '42', name: 'Nia' }, body: 'Hi', messageId: 'm1' }] }, {
    eventsPath: 'events', senderIdPath: 'user.id', senderNamePath: 'user.name', textPath: 'body', messageIdPath: 'messageId'
  });
  assert.deepEqual(result[0], {
    channelProfileId: '42', displayName: 'Nia', text: 'Hi', providerMessageId: 'm1', timestamp: '', messageType: 'text'
  });
});

test('normalizes Telegram bot updates', () => {
  const result = normalizeTelegram({ update_id: 7, message: {
    message_id: 44, date: 1761360000, chat: { id: 12345 }, from: { first_name: 'Ravi', last_name: 'K' }, text: 'Need help'
  } });
  assert.equal(result.channelProfileId, '12345');
  assert.equal(result.displayName, 'Ravi K');
  assert.equal(result.text, 'Need help');
  assert.equal(result.providerMessageId, '44');
});

test('resolves data and secret templates recursively', () => {
  const result = resolveTemplate({ Authorization: 'Bearer {{secret:TOKEN}}', body: '{{message.text}}' },
    { message: { text: 'hello' } }, name => name === 'TOKEN' ? 'abc' : undefined);
  assert.deepEqual(result, { Authorization: 'Bearer abc', body: 'hello' });
});

test('requires HTTPS and an explicit hostname allowlist', () => {
  assert.equal(assertAllowedHttpsEndpoint('https://api.example.com/messages', ['api.example.com']), true);
  assert.throws(() => assertAllowedHttpsEndpoint('http://api.example.com/messages', ['api.example.com']), /HTTPS/);
  assert.throws(() => assertAllowedHttpsEndpoint('https://127.0.0.1/messages', ['127.0.0.1']), /blocked/);
  assert.throws(() => assertAllowedHttpsEndpoint('https://other.example.com/messages', ['api.example.com']), /allowlisted/);
});

test('constant-time comparison handles equal and unequal strings', () => {
  assert.equal(timingSafeEqual('same', 'same'), true);
  assert.equal(timingSafeEqual('same', 'different'), false);
});

test('verifies Meta sha256 webhook signatures', async () => {
  const body = '{"hello":"world"}';
  const secret = 'app-secret';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const signature = `sha256=${Buffer.from(digest).toString('hex')}`;
  assert.equal(await verifyMetaSignature(body, signature, secret), true);
  assert.equal(await verifyMetaSignature(`${body}x`, signature, secret), false);
});

test('D1 migration is valid SQLite and creates the required tables', async () => {
  const sql = await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8');
  const database = new DatabaseSync(':memory:');
  database.exec(sql);
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
  for (const name of ['channels', 'contacts', 'channel_identities', 'conversations', 'messages', 'webhook_events', 'outbox', 'audit_log']) {
    assert.ok(tables.includes(name), `missing table ${name}`);
  }
  database.close();
});

test('health is public with configured CORS and API routes reject missing auth', async () => {
  const env = { ALLOWED_ORIGINS: 'https://chat.helixcer.com', ADMIN_TOKEN: 'secret' };
  const health = await handleRequest(new Request('https://api.example.com/health', {
    headers: { Origin: 'https://chat.helixcer.com' }
  }), env);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('Access-Control-Allow-Origin'), 'https://chat.helixcer.com');
  const denied = await handleRequest(new Request('https://api.example.com/api/bootstrap'), env);
  assert.equal(denied.status, 401);
});

