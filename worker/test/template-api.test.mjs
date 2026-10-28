import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { encryptChannelCredential, handleRequest, renderWhatsAppTemplatePreview } from '../src/index.js';

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
    '0004_multichannel_credentials.sql', '0005_external_template_api.sql', '0006_contact_profiles.sql',
    '0007_conversation_uniqueness.sql', '0008_push_subscriptions.sql', '0009_workspace_profile.sql',
    '0011_mobile_push_devices.sql', '0012_contact_identities.sql', '0013_flat_contact_platform_ids.sql']) {
    database.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  const now = new Date().toISOString();
  database.prepare(`INSERT INTO channels
      (channel_id,name,connector_type,provider_type,enabled,capabilities_json,config_json,secret_key,created_at,updated_at,workspace_id)
    VALUES ('wa-sales','WhatsApp Sales','whatsapp_cloud','whatsapp_cloud',1,'["text","template"]',?,'WA_SALES',?,?, 'ws_default')`)
    .run(JSON.stringify({
      phoneNumberId: '103698172469545', apiVersion: 'v26.0',
      credentialsVerifiedAt: now, verifiedProviderId: '103698172469545'
    }), now, now);
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
  const broadcasts = [];
  const INBOX_HUB = {
    idFromName: value => value,
    get: () => ({ fetch: async (url, init = {}) => {
      if (String(url).endsWith('/broadcast')) broadcasts.push(JSON.parse(init.body));
      return new Response(null, { status: 204 });
    } })
  };
  return { database, broadcasts, env: {
    DB, INBOX_HUB, CHANNEL_CREDENTIALS_KEY: encryptionKey,
    ADMIN_TOKEN: 'recovery-secret', RECOVERY_MODE: 'true'
  } };
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
  const requestHeaders = {
    Authorization: `Bearer ${token}`,
    'X-Workspace-Id': 'ws_default',
    'Content-Type': 'application/json',
    ...headers
  };
  if (idempotencyKey) requestHeaders['Idempotency-Key'] = idempotencyKey;
  return new Request('https://api.chat.helixcer.com/api/v1/whatsapp/template-messages', {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify(body)
  });
}

test('template inbox preview renders approved copy, runtime values, footer, and actions', () => {
  const rendered = renderWhatsAppTemplatePreview({
    components: [
      { type: 'header', format: 'text', text: 'Invoice update for {{customer}}' },
      { type: 'body', text: 'Invoice {{1}} costs {{2}} and is due {{3}}.' },
      { type: 'footer', text: 'Thank you' },
      { type: 'buttons', buttons: [{ type: 'url', text: 'View invoice' }, { type: 'quick_reply', text: 'Need help' }] }
    ]
  }, {
    components: [
      { type: 'header', parameters: [{ type: 'text', parameter_name: 'customer', text: 'Asha' }] },
      { type: 'body', parameters: [
        { type: 'text', text: 'INV-1001' },
        { type: 'currency', currency: { code: 'INR', amount_1000: 1499000, fallback_value: '₹1,499.00' } },
        { type: 'date_time', date_time: { fallback_value: '31 October 2026' } }
      ] }
    ]
  });
  assert.equal(rendered, [
    'Invoice update for Asha',
    'Invoice INV-1001 costs ₹1,499.00 and is due 31 October 2026.',
    'Thank you',
    'Actions: View invoice, Need help'
  ].join('\n'));
});

test('public Developer API preflight and rate-limit errors use the status envelope', async () => {
  const preflight = await handleRequest(new Request('https://api.chat.helixcer.com/api/v1/whatsapp/template-messages', {
    method: 'OPTIONS', headers: { Origin: 'https://chat.helixcer.com' }
  }), {});
  assert.equal(preflight.status, 405);
  const preflightBody = await preflight.json();
  assert.equal(preflightBody.status, false);
  assert.equal(Object.hasOwn(preflightBody, 'ok'), false);

  const { database, env } = await fixture();
  const token = `hxc_live_limited1.${'l'.repeat(43)}`;
  await insertKey(database, token, 'key-limited', 'hxc_live_limited1');
  env.INBOX_HUB = {
    idFromName: value => value,
    get: () => ({ fetch: async () => new Response(null, {
      status: 429, headers: { 'Retry-After': '42', 'X-RateLimit-Limit': '60' }
    }) })
  };
  try {
    const limited = await handleRequest(postTemplate(token, null, {
      channelId: 'wa-sales', to: '+91 98765 43210',
      template: { name: 'order_update', language: { code: 'en_US' } }
    }), env);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('Retry-After'), '42');
    const limitedBody = await limited.json();
    assert.equal(limitedBody.status, false);
    assert.equal(Object.hasOwn(limitedBody, 'ok'), false);
    assert.equal(limitedBody.error.code, 'rate_limited');
  } finally {
    database.close();
  }
});

test('Developer API requires the API key workspace header and rejects mismatches before use', async () => {
  const { database, env } = await fixture();
  const token = `hxc_live_workspace1.${'w'.repeat(43)}`;
  await insertKey(database, token, 'key-workspace', 'hxc_live_workspace1');
  const body = {
    channelId: 'wa-sales', to: '+91 98765 43210',
    template: { name: 'order_update', language: { code: 'en_US' } }
  };
  try {
    const missing = await handleRequest(postTemplate(token, null, body, { 'X-Workspace-Id': '' }), env);
    assert.equal(missing.status, 400);
    const missingBody = await missing.json();
    assert.equal(missingBody.status, false);
    assert.equal(missingBody.error.code, 'workspace_id_required');

    const mismatch = await handleRequest(postTemplate(token, null, body, {
      'X-Workspace-Id': 'another-workspace'
    }), env);
    assert.equal(mismatch.status, 403);
    const mismatchBody = await mismatch.json();
    assert.equal(mismatchBody.status, false);
    assert.equal(mismatchBody.error.code, 'workspace_mismatch');

    assert.equal(database.prepare('SELECT count(*) AS count FROM messages').get().count, 0);
    assert.equal(database.prepare('SELECT last_used_at FROM api_keys WHERE api_key_id=?').get('key-workspace').last_used_at, null);
  } finally {
    database.close();
  }
});

test('external template API accepts requests without an Idempotency-Key', async () => {
  const { database, env } = await fixture();
  const token = `hxc_live_noidem123.${'n'.repeat(43)}`;
  await insertKey(database, token, 'key-no-idempotency', 'hxc_live_noidem123');
  const waits = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.no-idempotency' }] }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
  try {
    const body = {
      channelId: 'wa-sales', to: '+91 98765 43210',
      template: { name: 'order_update', language: { code: 'en_US' } }
    };
    const response = await handleRequest(postTemplate(token, null, body), env, {
      waitUntil(promise) { waits.push(promise); }
    });
    assert.equal(response.status, 202);
    assert.equal(response.headers.get('Idempotent-Replayed'), null);
    const accepted = await response.json();
    assert.equal(accepted.status, true);
    assert.equal(accepted.messageStatus, 'pending');
    assert.equal(accepted.channelMessageId, '');
    assert.equal(Object.hasOwn(accepted, 'providerMessageId'), false);
    assert.equal(Object.hasOwn(accepted, 'ok'), false);
    assert.equal(database.prepare('SELECT count(*) AS count FROM messages').get().count, 1);
    const storedRequest = database.prepare('SELECT idempotency_key_hash FROM external_api_requests').get();
    assert.match(storedRequest.idempotency_key_hash, /^[a-f0-9]{64}$/);
    await Promise.all(waits);

    const invalid = await handleRequest(postTemplate(token, 'short', body), env, { waitUntil() {} });
    assert.equal(invalid.status, 400);
    const invalidBody = await invalid.json();
    assert.equal(invalidBody.status, false);
    assert.equal(Object.hasOwn(invalidBody, 'ok'), false);
    assert.equal(invalidBody.error.code, 'invalid_idempotency_key');
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('external template API updates a saved contact name only when displayName is supplied', async () => {
  const { database, env } = await fixture();
  const token = `hxc_live_contact1.${'c'.repeat(43)}`;
  await insertKey(database, token, 'key-contact-name', 'hxc_live_contact1');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ messages: [{ id: crypto.randomUUID() }] }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
  const baseBody = {
    channelId: 'wa-sales', to: '+91 98765 43210',
    template: { name: 'order_update', language: { code: 'en_US' } }
  };
  try {
    const send = async (body) => {
      const waits = [];
      const response = await handleRequest(postTemplate(token, null, body), env, {
        waitUntil(promise) { waits.push(promise); }
      });
      assert.equal(response.status, 202);
      await Promise.all(waits);
    };

    await send({ ...baseBody, contact: { displayName: 'Original name' } });
    const contactId = database.prepare('SELECT contact_id FROM contacts').get().contact_id;
    assert.equal(database.prepare('SELECT display_name FROM contacts WHERE contact_id=?').get(contactId).display_name, 'Original name');
    assert.equal(database.prepare('SELECT display_name FROM channel_identities WHERE contact_id=?').get(contactId).display_name, 'Original name');

    await send({ ...baseBody, contact: { displayName: 'Updated contact name' } });
    assert.equal(database.prepare('SELECT display_name FROM contacts WHERE contact_id=?').get(contactId).display_name, 'Updated contact name');
    assert.equal(database.prepare('SELECT display_name FROM channel_identities WHERE contact_id=?').get(contactId).display_name, 'Updated contact name');

    await send(baseBody);
    assert.equal(database.prepare('SELECT display_name FROM contacts WHERE contact_id=?').get(contactId).display_name, 'Updated contact name');
    assert.equal(database.prepare('SELECT display_name FROM channel_identities WHERE contact_id=?').get(contactId).display_name, 'Updated contact name');
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('external template API stores and broadcasts the rendered template and media attachment', async () => {
  const { database, env, broadcasts } = await fixture();
  const token = `hxc_live_richview1.${'r'.repeat(43)}`;
  await insertKey(database, token, 'key-rich-view', 'hxc_live_richview1');
  const config = JSON.parse(database.prepare("SELECT config_json FROM channels WHERE channel_id='wa-sales'").get().config_json);
  config.wabaId = '2053926168641345';
  database.prepare("UPDATE channels SET config_json=? WHERE channel_id='wa-sales'").run(JSON.stringify(config));
  const originalFetch = globalThis.fetch;
  const providerPaths = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    providerPaths.push(url.pathname);
    if (url.pathname.endsWith('/message_templates')) {
      assert.equal(init.headers.Authorization, 'Bearer EAAtest-access-token-123456789');
      assert.equal(url.searchParams.get('name'), 'invoice_ready');
      assert.equal(url.searchParams.get('limit'), '100');
      return new Response(JSON.stringify({ data: [{
        id: 'meta-template-invoice', name: 'invoice_ready', language: 'en_US', status: 'APPROVED', category: 'UTILITY',
        components: [
          { type: 'HEADER', format: 'DOCUMENT' },
          { type: 'BODY', text: 'Hello {{1}}, invoice {{2}} is ready.' },
          { type: 'FOOTER', text: 'Accounts team' },
          { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'View invoice', url: 'https://billing.example/{{1}}' }] }
        ]
      }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.endsWith('/messages')) {
      const sent = JSON.parse(init.body);
      assert.equal(sent.template.name, 'invoice_ready');
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.rich-template' }] }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }
    throw new Error(`Unexpected provider request: ${url.pathname}`);
  };
  try {
    const waits = [];
    const response = await handleRequest(postTemplate(token, null, {
      channelId: 'wa-sales', to: '+91 98765 43210', contact: { displayName: 'Asha' },
      template: {
        name: 'invoice_ready', language: { code: 'en_US' }, components: [
          { type: 'header', parameters: [{ type: 'document', document: { link: 'https://cdn.example.com/invoice-1001.pdf' } }] },
          { type: 'body', parameters: [{ type: 'text', text: 'Asha' }, { type: 'text', text: 'INV-1001' }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'INV-1001' }] }
        ]
      }
    }), env, { waitUntil(promise) { waits.push(promise); } });
    assert.equal(response.status, 202);
    const accepted = await response.json();
    const expectedText = 'Hello Asha, invoice INV-1001 is ready.\nAccounts team\nActions: View invoice';
    const row = database.prepare('SELECT text,payload_json FROM messages WHERE message_id=?').get(accepted.messageId);
    assert.equal(row.text, expectedText);
    const stored = JSON.parse(row.payload_json);
    assert.deepEqual(stored.template, {
      name: 'invoice_ready', language: { code: 'en_US' }, templateId: 'meta-template-invoice', category: 'UTILITY',
      buttons: [{ type: 'url', text: 'View invoice' }]
    });
    assert.deepEqual(stored.attachment, {
      type: 'document', filename: 'invoice-1001.pdf', mimeType: '', size: 0, caption: '',
      externalUrl: 'https://cdn.example.com/invoice-1001.pdf'
    });
    const created = broadcasts.find(event => event.type === 'message.created' && event.messageId === accepted.messageId);
    assert.equal(created.message.text, expectedText);
    assert.deepEqual(created.message.template, stored.template);
    assert.deepEqual(created.message.attachment, {
      type: 'document', filename: 'invoice-1001.pdf', mimeType: '', size: 0, caption: '',
      available: true, external: true, url: 'https://cdn.example.com/invoice-1001.pdf'
    });
    assert.equal(created.conversation.lastMessage, expectedText);
    const history = await handleRequest(new Request(
      `https://api.chat.helixcer.com/api/conversations/${accepted.conversationId}/messages`, {
        headers: { Authorization: 'Bearer recovery-secret' }
      }), env);
    assert.equal(history.status, 200);
    const listed = (await history.json()).items.find(item => item.messageId === accepted.messageId);
    assert.deepEqual(listed.template, stored.template);
    assert.deepEqual(listed.attachment, created.message.attachment);
    await Promise.all(waits);
    assert.deepEqual(providerPaths, [
      '/v26.0/2053926168641345/message_templates', '/v26.0/103698172469545/messages'
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('external template API persists once, dispatches, replays safely, and scopes status to its key', async () => {
  const { database, env, broadcasts } = await fixture();
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
    assert.equal(accepted.status, true);
    assert.equal(accepted.messageStatus, 'pending');
    assert.equal(Object.hasOwn(accepted, 'ok'), false);
    const createdEvent = broadcasts.find(event => event.type === 'message.created' &&
      event.messageId === accepted.messageId);
    assert.ok(createdEvent);
    assert.deepEqual(createdEvent.message, {
      messageId: accepted.messageId,
      conversationId: accepted.conversationId,
      channelId: 'wa-sales',
      direction: 'outbound',
      messageType: 'template',
      text: 'Template: order_update (en_US)',
      status: 'pending',
      timestamp: accepted.createdAt,
      channelMessageId: '',
      error: '',
      reply: null,
      template: { name: 'order_update', language: { code: 'en_US' } }
    });
    assert.ok(createdEvent.conversation);
    assert.equal(createdEvent.conversation.conversationId, accepted.conversationId);
    assert.equal(createdEvent.conversation.contactId, accepted.contactId);
    assert.equal(createdEvent.conversation.channelId, 'wa-sales');
    assert.equal(createdEvent.conversation.subject, 'Asha');
    assert.equal(createdEvent.conversation.lastMessage, 'Template: order_update (en_US)');
    assert.equal(createdEvent.conversation.unreadCount, 0);
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
    const realtimeDelivery = broadcasts.find(event => event.type === 'message.updated' && event.status === 'delivered');
    assert.ok(realtimeDelivery);
    assert.equal(realtimeDelivery.messageId, accepted.messageId);
    assert.equal(realtimeDelivery.conversationId, accepted.conversationId);
    assert.equal(realtimeDelivery.channelMessageId, 'wamid.template-1');
    assert.deepEqual(realtimeDelivery.message, {
      messageId: accepted.messageId, conversationId: accepted.conversationId,
      status: 'delivered', error: '', channelMessageId: 'wamid.template-1'
    });
    const statusAggregate = broadcasts.find(event => event.type === 'webhook.received' && event.statuses === 1);
    assert.ok(statusAggregate);
    assert.equal(statusAggregate.granular, true);
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
    const conflictBody = await conflict.json();
    assert.equal(conflictBody.status, false);
    assert.equal(Object.hasOwn(conflictBody, 'ok'), false);
    assert.equal(conflictBody.error.code, 'idempotency_conflict');

    const statusUrl = `https://api.chat.helixcer.com/api/v1/messages/${accepted.messageId}`;
    const status = await handleRequest(new Request(statusUrl, {
      headers: { Authorization: `Bearer ${token}`, 'X-Workspace-Id': 'ws_default' }
    }), env);
    assert.equal(status.status, 200);
    const statusBody = await status.json();
    assert.equal(statusBody.channelMessageId, 'wamid.template-1');
    assert.equal(Object.hasOwn(statusBody, 'providerMessageId'), false);
    assert.equal(statusBody.status, true);
    assert.equal(statusBody.messageStatus, 'delivered');
    assert.equal(Object.hasOwn(statusBody, 'ok'), false);

    const otherToken = `hxc_live_otherkey1.${'t'.repeat(43)}`;
    await insertKey(database, otherToken, 'key-two', 'hxc_live_otherkey1');
    const hidden = await handleRequest(new Request(statusUrl, {
      headers: { Authorization: `Bearer ${otherToken}`, 'X-Workspace-Id': 'ws_default' }
    }), env);
    assert.equal(hidden.status, 404);
    const hiddenBody = await hidden.json();
    assert.equal(hiddenBody.status, false);
    assert.equal(Object.hasOwn(hiddenBody, 'ok'), false);

    const browser = await handleRequest(postTemplate(token, 'order-1002-send', body, {
      Origin: 'https://chat.helixcer.com'
    }), env);
    assert.equal(browser.status, 403);
    const browserBody = await browser.json();
    assert.equal(browserBody.status, false);
    assert.equal(Object.hasOwn(browserBody, 'ok'), false);
    assert.equal(browserBody.error.code, 'server_to_server_only');
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('external template encryption failure leaves no recipient route or conversation', async () => {
  const { database, env } = await fixture();
  const token = `hxc_live_noencrypt1.${'e'.repeat(43)}`;
  await insertKey(database, token, 'key-no-encryption', 'hxc_live_noencrypt1');
  env.CHANNEL_CREDENTIALS_KEY = '';
  const before = Object.fromEntries([
    'contacts', 'contact_identities', 'channel_identity_bindings', 'channel_identities', 'conversations'
  ].map(table => [table, database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
  try {
    const response = await handleRequest(postTemplate(token, 'missing-encryption-key', {
      channelId: 'wa-sales',
      to: '+91 99999 00001',
      previewText: 'This request must fail before creating the recipient.',
      template: { name: 'order_update', language: { code: 'en_US' } }
    }), env);
    assert.equal(response.status, 503);
    const error = await response.json();
    assert.equal(error.status, false);
    for (const [table, count] of Object.entries(before)) {
      assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, count,
        `${table} must not change when outbound payload encryption is unavailable`);
    }
  } finally {
    database.close();
  }
});

test('API key management reveals a secret once, stores only its hash, lists metadata, and deletes it', async () => {
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

    const deletedResponse = await handleRequest(new Request(
      `https://api.chat.helixcer.com/api/developer/api-keys/${created.item.apiKeyId}`,
      { method: 'DELETE', headers: { Authorization: 'Bearer recovery-secret' } }
    ), env);
    assert.equal(deletedResponse.status, 200);
    assert.equal((await deletedResponse.json()).deleted, true);
    assert.equal(database.prepare('SELECT status FROM api_keys WHERE api_key_id=?').get(created.item.apiKeyId), undefined);

    const rejected = await handleRequest(new Request('https://api.chat.helixcer.com/api/v1/messages/not-found', {
      headers: { Authorization: `Bearer ${created.apiKey}` }
    }), env);
    assert.equal(rejected.status, 401);
    const rejectedBody = await rejected.json();
    assert.equal(rejectedBody.status, false);
    assert.equal(Object.hasOwn(rejectedBody, 'ok'), false);
    assert.equal(rejectedBody.error.code, 'invalid_api_key');
  } finally {
    database.close();
  }
});
