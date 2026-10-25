import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import {
  assertAllowedHttpsEndpoint,
  decryptChannelCredential,
  encryptChannelCredential,
  handleRequest,
  InboxHub,
  isRetryableWhatsAppStatus,
  normalizeGeneric,
  normalizeInstagram,
  normalizeTelegram,
  normalizeWhatsApp,
  normalizeWhatsAppRecipient,
  resolveTemplate,
  timingSafeEqual,
  verifyMetaSignature
} from '../src/index.js';

test('normalizes inbound WhatsApp messages and statuses', () => {
  const result = normalizeWhatsApp({ entry: [{ changes: [{ value: {
    metadata: { phone_number_id: '123456789' },
    contacts: [{ wa_id: '919999999999', profile: { name: 'Asha' } }],
    messages: [
      { id: 'wamid.1', from: '919999999999', timestamp: '1761360000', type: 'text', text: { body: 'Hello' } },
      { id: 'wamid.2', from: '919999999999', timestamp: '1761360002', type: 'image', image: {} }
    ],
    statuses: [{ id: 'wamid.out', status: 'delivered', timestamp: '1761360001' }]
  } }] }] });
  assert.equal(result.messages[0].displayName, 'Asha');
  assert.equal(result.messages[0].text, 'Hello');
  assert.equal(result.messages[1].text, '[WhatsApp image received]');
  assert.equal(result.statuses[0].status, 'delivered');
  assert.deepEqual(result.phoneNumberIds, ['123456789']);
});

test('normalizes WhatsApp recipients and classifies retryable provider failures', () => {
  assert.equal(normalizeWhatsAppRecipient('+91 98765-43210'), '919876543210');
  assert.equal(normalizeWhatsAppRecipient('0091 (98765) 43210'), '919876543210');
  assert.throws(() => normalizeWhatsAppRecipient('98765'), /8 to 15 digits/);
  assert.throws(() => normalizeWhatsAppRecipient('not-a-number'), /country code/);
  assert.equal(isRetryableWhatsAppStatus(429), true);
  assert.equal(isRetryableWhatsAppStatus(503), true);
  assert.equal(isRetryableWhatsAppStatus(400), false);
  assert.equal(isRetryableWhatsAppStatus(401), false);
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
  assert.equal(result.providerMessageId, 'update:7');
  const sameMessageNumber = normalizeTelegram({ message: {
    message_id: 44, date: 1761360000, chat: { id: 99999 }, from: { first_name: 'Other' }, text: 'Different chat'
  } });
  assert.equal(sameMessageNumber.providerMessageId, 'chat:99999:message:44');
  assert.notEqual(sameMessageNumber.providerMessageId, normalizeTelegram({ message: {
    message_id: 44, chat: { id: 12345 }, text: 'Original chat'
  } }).providerMessageId);
});

test('normalizes Instagram messages and ignores outbound echoes', () => {
  const result = normalizeInstagram({ entry: [{ id: '17841400000000000', messaging: [
    { sender: { id: 'customer-1' }, recipient: { id: '17841400000000000' }, timestamp: 1761360000000,
      message: { mid: 'ig-mid-1', text: 'Hello from Instagram' } },
    { sender: { id: '17841400000000000' }, recipient: { id: 'customer-1' }, timestamp: 1761360001000,
      message: { mid: 'ig-echo', text: 'Reply', is_echo: true } }
  ] }] });
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].channelProfileId, 'customer-1');
  assert.equal(result.messages[0].providerMessageId, 'ig-mid-1');
  assert.equal(result.messages[0].text, 'Hello from Instagram');
  assert.deepEqual(result.recipientIds, ['17841400000000000']);
});

test('encrypts channel credentials with workspace and channel binding', async () => {
  const master = 'test-only-master-key-material-'.repeat(2);
  const encrypted = await encryptChannelCredential('provider-secret-value', master, 'ws-one', 'channel-one', 'accessToken');
  assert.match(encrypted, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(encrypted.includes('provider-secret-value'), false);
  assert.equal(await decryptChannelCredential(encrypted, master, 'ws-one', 'channel-one', 'accessToken'), 'provider-secret-value');
  await assert.rejects(() => decryptChannelCredential(encrypted, master, 'ws-two', 'channel-one', 'accessToken'));
  await assert.rejects(() => decryptChannelCredential(encrypted, `${master}different`, 'ws-one', 'channel-one', 'accessToken'));
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

test('D1 migrations are valid SQLite, preserve rows, and create identity tables', async () => {
  const initial = await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8');
  const identity = await readFile(new URL('../migrations/0002_identity_and_workspaces.sql', import.meta.url), 'utf8');
  const whatsapp = await readFile(new URL('../migrations/0003_whatsapp_channel.sql', import.meta.url), 'utf8');
  const multichannel = await readFile(new URL('../migrations/0004_multichannel_credentials.sql', import.meta.url), 'utf8');
  const database = new DatabaseSync(':memory:');
  database.exec(initial);
  database.exec(`
    INSERT INTO channels (channel_id,name,connector_type,secret_key,created_at,updated_at)
      VALUES ('legacy-channel','Legacy channel','web_chat','LEGACY','2026-01-01','2026-01-01');
    INSERT INTO contacts (contact_id,display_name,created_at,updated_at)
      VALUES ('legacy-contact','Legacy contact','2026-01-01','2026-01-01');
    INSERT INTO channel_identities (identity_id,contact_id,channel_id,channel_profile_id,created_at)
      VALUES ('legacy-identity','legacy-contact','legacy-channel','profile-1','2026-01-01');
    INSERT INTO conversations (conversation_id,contact_id,channel_id,last_message_at,created_at,updated_at)
      VALUES ('legacy-conversation','legacy-contact','legacy-channel','2026-01-01','2026-01-01','2026-01-01');
    INSERT INTO messages (message_id,conversation_id,contact_id,channel_id,direction,status,timestamp)
      VALUES ('legacy-message','legacy-conversation','legacy-contact','legacy-channel','inbound','received','2026-01-01');
    INSERT INTO webhook_events (event_key,channel_id,event_type,received_at)
      VALUES ('legacy-event','legacy-channel','message','2026-01-01');
    INSERT INTO outbox (outbox_id,message_id,next_attempt_at,created_at,updated_at)
      VALUES ('legacy-outbox','legacy-message','2026-01-01','2026-01-01','2026-01-01');
    INSERT INTO agents (agent_id,email,display_name,created_at,updated_at)
      VALUES ('legacy-agent','legacy@example.com','Legacy agent','2026-01-01','2026-01-01');
    INSERT INTO audit_log (audit_id,actor,action,target_type,target_id,timestamp)
      VALUES ('legacy-audit','legacy@example.com','create','contact','legacy-contact','2026-01-01');
  `);
  database.exec(identity);
  database.exec(whatsapp);
  database.exec(multichannel);
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
  for (const name of ['workspaces', 'users', 'memberships', 'sessions', 'oauth_states', 'invitations', 'channels', 'channel_credentials', 'contacts', 'messages', 'audit_log']) {
    assert.ok(tables.includes(name), `missing table ${name}`);
  }
  for (const [table, idColumn, id] of [
    ['channels', 'channel_id', 'legacy-channel'],
    ['contacts', 'contact_id', 'legacy-contact'],
    ['channel_identities', 'identity_id', 'legacy-identity'],
    ['conversations', 'conversation_id', 'legacy-conversation'],
    ['messages', 'message_id', 'legacy-message'],
    ['webhook_events', 'event_key', 'legacy-event'],
    ['outbox', 'outbox_id', 'legacy-outbox'],
    ['agents', 'agent_id', 'legacy-agent'],
    ['audit_log', 'audit_id', 'legacy-audit']
  ]) {
    assert.equal(database.prepare(`SELECT workspace_id FROM ${table} WHERE ${idColumn}=?`).get(id).workspace_id, 'ws_default');
  }
  assert.equal(database.prepare("SELECT actor_email FROM audit_log WHERE audit_id='legacy-audit'").get().actor_email, 'legacy@example.com');
  assert.equal(database.prepare('SELECT count(*) AS count FROM memberships').get().count, 0);
  assert.equal(database.prepare("SELECT name FROM workspaces WHERE workspace_id='ws_default'").get().name, 'Helixcer Chat');
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM channels WHERE channel_id='wa-main'").get().count, 0);
  assert.equal(database.prepare("SELECT provider_type FROM channels WHERE channel_id='legacy-channel'").get().provider_type, 'web_chat');
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  const indexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(row => row.name));
  for (const name of ['idx_channels_workspace', 'idx_conversations_workspace_activity', 'idx_messages_workspace_conversation',
    'idx_outbox_workspace_due', 'idx_channel_credentials_channel', 'idx_channels_workspace_provider',
    'idx_channels_workspace_whatsapp_phone', 'idx_channels_workspace_instagram_account', 'idx_channels_workspace_telegram_bot']) {
    assert.ok(indexes.has(name), `missing index ${name}`);
  }
  database.close();

  const editedDatabase = new DatabaseSync(':memory:');
  editedDatabase.exec(initial);
  editedDatabase.exec(identity);
  editedDatabase.exec(whatsapp);
  editedDatabase.prepare("UPDATE channels SET name='Edited WhatsApp' WHERE channel_id='wa-main'").run();
  editedDatabase.exec(multichannel);
  assert.equal(editedDatabase.prepare("SELECT name FROM channels WHERE channel_id='wa-main'").get().name, 'Edited WhatsApp');
  editedDatabase.close();
});

test('health is public with configured CORS and API routes reject missing auth', async () => {
  const env = { ALLOWED_ORIGINS: 'https://chat.helixcer.com', ADMIN_TOKEN: 'secret', RECOVERY_MODE: 'true' };
  const health = await handleRequest(new Request('https://api.example.com/health', {
    headers: { Origin: 'https://chat.helixcer.com' }
  }), env);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('Access-Control-Allow-Origin'), 'https://chat.helixcer.com');
  const denied = await handleRequest(new Request('https://api.example.com/api/bootstrap'), env);
  assert.equal(denied.status, 401);
  const queryToken = await handleRequest(new Request('https://api.example.com/api/realtime?token=secret'), env);
  assert.equal(queryToken.status, 401);
  const spoofedEmail = await handleRequest(new Request('https://api.example.com/api/bootstrap', {
    headers: { 'X-Agent-Email': 'owner@example.com' }
  }), env);
  assert.equal(spoofedEmail.status, 401);
  const crossSiteSocket = await handleRequest(new Request('https://api.example.com/api/realtime', {
    headers: { Authorization: 'Bearer secret', Origin: 'https://evil.example' }
  }), env);
  assert.equal(crossSiteSocket.status, 403);
});

test('realtime hub revalidates sessions and disconnects changed memberships', async () => {
  const sent = [];
  const closed = [];
  const attachment = {
    sessionId: 'session-1', membershipId: 'membership-1',
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  };
  const socket = {
    deserializeAttachment: () => attachment,
    send: value => sent.push(value),
    close: (code, reason) => closed.push({ code, reason })
  };
  let active = true;
  const env = {
    DB: {
      prepare: () => ({
        bind: () => ({ first: async () => active ? { ok: 1 } : null })
      })
    }
  };
  const hub = new InboxHub({ getWebSockets: () => [socket] }, env);
  await hub.fetch(new Request('https://hub.internal/broadcast', { method: 'POST', body: '{"type":"changed"}' }));
  assert.deepEqual(sent, ['{"type":"changed"}']);
  active = false;
  await hub.webSocketMessage(socket, 'ping');
  assert.equal(closed.at(-1).code, 1008);
  active = true;
  await hub.fetch(new Request('https://hub.internal/disconnect', {
    method: 'POST', body: JSON.stringify({ membershipId: 'membership-1' })
  }));
  assert.equal(closed.at(-1).code, 1008);
});

test('OAuth start limiter enforces per-client and global windows before D1 work', async () => {
  const values = new Map();
  const storageApi = {
    get: async key => values.get(key),
    put: async (key, value) => values.set(key, structuredClone(value))
  };
  const state = {
    storage: { transaction: callback => callback(storageApi) },
    getWebSockets: () => []
  };
  const hub = new InboxHub(state, {
    OAUTH_RATE_LIMIT_WINDOW_SECONDS: '600',
    OAUTH_RATE_LIMIT_PER_CLIENT: '2',
    OAUTH_RATE_LIMIT_GLOBAL: '3'
  });
  const attempt = key => hub.fetch(new Request('https://hub.internal/oauth-rate-limit', {
    method: 'POST', body: key.repeat(64)
  }));
  assert.equal((await attempt('a')).status, 204);
  assert.equal((await attempt('a')).status, 204);
  const perClient = await attempt('a');
  assert.equal(perClient.status, 429);
  assert.ok(Number(perClient.headers.get('Retry-After')) > 0);
  assert.equal((await attempt('b')).status, 204);
  assert.equal((await attempt('c')).status, 429);
});

