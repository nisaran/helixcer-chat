import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { encryptChannelCredential, handleRequest } from '../src/index.js';

class TestD1Statement {
  constructor(statement, values = []) {
    this.statement = statement;
    this.values = values;
  }

  bind(...values) {
    return new TestD1Statement(this.statement, values);
  }

  async run() {
    const result = this.statement.run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  async first() {
    return this.statement.get(...this.values) || null;
  }

  async all() {
    return { success: true, results: this.statement.all(...this.values) };
  }
}

class TestD1 {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new TestD1Statement(this.database.prepare(sql));
  }

  async batch(statements) {
    this.database.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

async function fixture() {
  const database = new DatabaseSync(':memory:');
  for (const name of ['0001_initial.sql', '0002_identity_and_workspaces.sql', '0003_whatsapp_channel.sql',
    '0004_multichannel_credentials.sql', '0005_external_template_api.sql']) {
    database.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  const now = new Date().toISOString();
  database.prepare(`INSERT INTO channels
      (channel_id,name,connector_type,provider_type,enabled,capabilities_json,config_json,secret_key,created_at,updated_at,workspace_id)
    VALUES ('wa-sales','WhatsApp Sales','whatsapp_cloud','whatsapp_cloud',1,'["text","template"]',?,'WA_SALES',?,?, 'ws_default')`)
    .run(JSON.stringify({ phoneNumberId: '103698172469545', apiVersion: 'v26.0' }), now, now);
  const encryptionKey = 'unit-test-channel-credential-key-material-1234567890';
  const encryptedToken = await encryptChannelCredential('EAAtest-access-token-123456789', encryptionKey,
    'ws_default', 'wa-sales', 'accessToken');
  const encryptedAppSecret = await encryptChannelCredential('0123456789abcdef0123456789abcdef', encryptionKey,
    'ws_default', 'wa-sales', 'appSecret');
  database.prepare(`INSERT INTO channel_credentials
      (workspace_id,channel_id,credential_key,encrypted_value,created_at,updated_at,updated_by_user_id)
    VALUES ('ws_default','wa-sales','accessToken',?,?,?,'user-owner')`).run(encryptedToken, now, now);
  database.prepare(`INSERT INTO channel_credentials
      (workspace_id,channel_id,credential_key,encrypted_value,created_at,updated_at,updated_by_user_id)
    VALUES ('ws_default','wa-sales','appSecret',?,?,?,'user-owner')`).run(encryptedAppSecret, now, now);
  const DB = new TestD1(database);
  const INBOX_HUB = {
    idFromName: value => value,
    get: () => ({ fetch: async () => new Response(null, { status: 204 }) })
  };
  return { database, env: { DB, INBOX_HUB, CHANNEL_CREDENTIALS_KEY: encryptionKey } };
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Buffer.from(digest).toString('hex');
}

async function metaSignature(raw, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  return `sha256=${Buffer.from(signature).toString('hex')}`;
}

async function insertKey(database, token, apiKeyId, prefix) {
  const now = new Date().toISOString();
  database.prepare(`INSERT INTO api_keys
      (api_key_id,workspace_id,name,key_prefix,secret_hash,scopes_json,allowed_channel_ids_json,status,created_at,updated_at)
    VALUES (?, 'ws_default', 'Integration key', ?, ?, '["whatsapp:template:send","messages:read"]', '[]', 'active', ?, ?)`)
    .run(apiKeyId, prefix, await sha256(token), now, now);
}

function postTemplate(token, idempotencyKey, body, headers = {}) {
  return new Request('https://api.chat.helixcer.com/api/v1/whatsapp/template-messages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': idempotencyKey,
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body)
  });
}

test('external template API persists once, dispatches, replays safely, and scopes status to its key', async () => {
  const { database, env } = await fixture();
  const token = `hxc_live_public123.${'s'.repeat(43)}`;
  await insertKey(database, token, 'key-one', 'hxc_live_public123');
  database.prepare('UPDATE api_keys SET allowed_channel_ids_json=? WHERE api_key_id=?')
    .run('["legacy-restricted-channel"]', 'key-one');
  const waits = [];
  let releaseMeta;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => new Promise(resolve => {
    assert.equal(String(url), 'https://graph.facebook.com/v26.0/103698172469545/messages');
    const providerBody = JSON.parse(init.body);
    assert.equal(providerBody.messaging_product, 'whatsapp');
    assert.equal(providerBody.to, '919876543210');
    assert.equal(providerBody.type, 'template');
    assert.equal(providerBody.template.name, 'order_update');
    assert.equal(providerBody.template.components[0].parameters[0].text, 'Asha');
    assert.match(providerBody.biz_opaque_callback_data, /^[a-f0-9-]{36}$/);
    releaseMeta = () => resolve(new Response(JSON.stringify({ messages: [{ id: 'wamid.template-1' }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    }));
  });
  try {
    const body = {
      channelId: 'wa-sales', to: '+91 98765 43210', contact: { displayName: 'Asha' },
      clientReference: 'order-1001',
      template: {
        name: 'order_update', language: { code: 'en_US' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Asha' }] }]
      }
    };
    const response = await handleRequest(postTemplate(token, 'order-1001-send', body), env, {
      waitUntil(promise) { waits.push(promise); }
    });
    assert.equal(response.status, 202);
    const accepted = await response.json();
    assert.equal(accepted.ok, true);
    assert.equal(accepted.status, 'pending');
    assert.equal(database.prepare('SELECT count(*) AS count FROM messages').get().count, 1);
    assert.equal(database.prepare('SELECT count(*) AS count FROM external_api_requests').get().count, 1);
    assert.equal(database.prepare('SELECT count(*) AS count FROM outbox').get().count, 1);
    const storedPayload = database.prepare('SELECT encrypted_payload FROM outbound_payloads').get();
    assert.ok(storedPayload);
    assert.equal(storedPayload.encrypted_payload.includes('order_update'), false);

    while (!releaseMeta) await new Promise(resolve => setImmediate(resolve));
    const statusPayload = JSON.stringify({ entry: [{ changes: [{ value: {
      metadata: { phone_number_id: '103698172469545' },
      statuses: [{
        id: 'wamid.template-1', status: 'delivered', timestamp: '1761360001',
        biz_opaque_callback_data: accepted.messageId
      }]
    } }] }] });
    const fastStatus = await handleRequest(new Request('https://api.chat.helixcer.com/webhooks/whatsapp/wa-sales', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': await metaSignature(statusPayload, '0123456789abcdef0123456789abcdef')
      },
      body: statusPayload
    }), env);
    assert.equal(fastStatus.status, 200);
    assert.equal(database.prepare('SELECT status FROM messages').get().status, 'delivered');
    const stalePayload = statusPayload.replace('"delivered"', '"sent"').replace('1761360001', '1761360002');
    const staleStatus = await handleRequest(new Request('https://api.chat.helixcer.com/webhooks/whatsapp/wa-sales', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': await metaSignature(stalePayload, '0123456789abcdef0123456789abcdef')
      },
      body: stalePayload
    }), env);
    assert.equal(staleStatus.status, 200);
    assert.equal(database.prepare('SELECT status FROM messages').get().status, 'delivered');

    releaseMeta();
    await Promise.all(waits);
    assert.equal(database.prepare('SELECT count(*) AS count FROM outbound_payloads').get().count, 0);
    assert.equal(database.prepare('SELECT count(*) AS count FROM outbox').get().count, 0);
    const sent = database.prepare('SELECT status,provider_message_id FROM messages').get();
    assert.equal(sent.status, 'delivered');
    assert.equal(sent.provider_message_id, 'wamid.template-1');

    const replay = await handleRequest(postTemplate(token, 'order-1001-send', body), env, { waitUntil() {} });
    assert.equal(replay.status, 202);
    assert.equal(replay.headers.get('Idempotent-Replayed'), 'true');
    assert.equal((await replay.json()).messageId, accepted.messageId);
    assert.equal(database.prepare('SELECT count(*) AS count FROM messages').get().count, 1);

    const changed = structuredClone(body);
    changed.template.components[0].parameters[0].text = 'Different';
    const conflict = await handleRequest(postTemplate(token, 'order-1001-send', changed), env, { waitUntil() {} });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error.code, 'idempotency_conflict');

    const statusUrl = `https://api.chat.helixcer.com/api/v1/messages/${accepted.messageId}`;
    const status = await handleRequest(new Request(statusUrl, {
      headers: { Authorization: `Bearer ${token}` }
    }), env);
    assert.equal(status.status, 200);
    const statusBody = await status.json();
    assert.equal(statusBody.providerMessageId, 'wamid.template-1');
    assert.equal(statusBody.status, 'delivered');

    const otherToken = `hxc_live_otherkey1.${'t'.repeat(43)}`;
    await insertKey(database, otherToken, 'key-two', 'hxc_live_otherkey1');
    const hidden = await handleRequest(new Request(statusUrl, {
      headers: { Authorization: `Bearer ${otherToken}` }
    }), env);
    assert.equal(hidden.status, 404);

    const browser = await handleRequest(postTemplate(token, 'order-1002-send', body, {
      Origin: 'https://chat.helixcer.com'
    }), env);
    assert.equal(browser.status, 403);
    assert.equal((await browser.json()).error.code, 'server_to_server_only');
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('API key management reveals a secret once, stores only its hash, lists metadata, and revokes it', async () => {
  const { database, env } = await fixture();
  Object.assign(env, {
    RECOVERY_MODE: 'true', ADMIN_TOKEN: 'recovery-secret', DEFAULT_WORKSPACE_ID: 'ws_default',
    APP_NAME: 'Helixcer Chat'
  });
  try {
    const createdResponse = await handleRequest(new Request('https://api.chat.helixcer.com/api/developer/api-keys', {
      method: 'POST',
      headers: { Authorization: 'Bearer recovery-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Order system' })
    }), env);
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.match(created.apiKey, /^hxc_live_[A-Za-z0-9_-]{8,32}\.[A-Za-z0-9_-]{32,128}$/);
    assert.equal(created.item.name, 'Order system');
    assert.equal(Object.hasOwn(created.item, 'allowedChannelIds'), false);
    const stored = database.prepare('SELECT key_prefix,secret_hash,allowed_channel_ids_json FROM api_keys WHERE api_key_id=?').get(created.item.apiKeyId);
    assert.equal(stored.key_prefix, created.item.keyPrefix);
    assert.equal(stored.secret_hash, await sha256(created.apiKey));
    assert.equal(stored.allowed_channel_ids_json, '[]');
    assert.equal(JSON.stringify(stored).includes(created.apiKey), false);

    const legacyResponse = await handleRequest(new Request('https://api.chat.helixcer.com/api/developer/api-keys', {
      method: 'POST',
      headers: { Authorization: 'Bearer recovery-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Legacy client key', allowedChannelIds: ['wa-sales'] })
    }), env);
    assert.equal(legacyResponse.status, 201);
    const legacyCreated = await legacyResponse.json();
    assert.equal(Object.hasOwn(legacyCreated.item, 'allowedChannelIds'), false);
    assert.equal(database.prepare('SELECT allowed_channel_ids_json FROM api_keys WHERE api_key_id=?')
      .get(legacyCreated.item.apiKeyId).allowed_channel_ids_json, '[]');

    const listedResponse = await handleRequest(new Request('https://api.chat.helixcer.com/api/developer/api-keys', {
      headers: { Authorization: 'Bearer recovery-secret' }
    }), env);
    assert.equal(listedResponse.status, 200);
    const listed = await listedResponse.json();
    assert.equal(listed.items.length, 2);
    for (const item of listed.items) {
      assert.equal(Object.hasOwn(item, 'apiKey'), false);
      assert.equal(Object.hasOwn(item, 'secretHash'), false);
      assert.equal(Object.hasOwn(item, 'allowedChannelIds'), false);
    }

    const revokedResponse = await handleRequest(new Request(
      `https://api.chat.helixcer.com/api/developer/api-keys/${created.item.apiKeyId}`,
      { method: 'DELETE', headers: { Authorization: 'Bearer recovery-secret' } }
    ), env);
    assert.equal(revokedResponse.status, 200);
    assert.equal(database.prepare('SELECT status FROM api_keys WHERE api_key_id=?').get(created.item.apiKeyId).status, 'revoked');

    const rejected = await handleRequest(new Request('https://api.chat.helixcer.com/api/v1/messages/not-found', {
      headers: { Authorization: `Bearer ${created.apiKey}` }
    }), env);
    assert.equal(rejected.status, 401);
    assert.equal((await rejected.json()).error.code, 'invalid_api_key');
  } finally {
    database.close();
  }
});
