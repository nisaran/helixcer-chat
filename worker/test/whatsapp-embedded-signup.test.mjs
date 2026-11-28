import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { handleRequest } from '../src/index.js';
import {
  isWhatsAppCoexistenceSignup,
  metaEmbeddedSignupPublicConfig,
  metaWhatsAppAppVerifyToken,
  parseWhatsAppEmbeddedSignupSession,
  shouldRegisterWhatsAppPhone
} from '../src/meta-embedded-signup.js';

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

  prepare(query) {
    return new TestD1Statement(this.database.prepare(query));
  }

  async batch(statements) {
    const results = [];
    this.database.exec('BEGIN');
    try {
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return results;
  }
}

async function testDatabase() {
  const database = new DatabaseSync(':memory:');
  for (const name of [
    '0001_initial.sql', '0002_identity_and_workspaces.sql', '0003_whatsapp_channel.sql',
    '0004_multichannel_credentials.sql', '0005_external_template_api.sql', '0006_contact_profiles.sql',
    '0007_conversation_uniqueness.sql', '0008_push_subscriptions.sql', '0009_workspace_profile.sql',
    '0011_mobile_push_devices.sql', '0012_contact_identities.sql', '0013_flat_contact_platform_ids.sql',
    '0014_unified_contact_conversations.sql', '0015_saas_clients.sql', '0016_internal_slug.sql',
    '0017_agent_channel_access.sql', '0019_outbound_sender.sql', '0020_user_profile.sql',
    '0021_campaigns.sql', '0022_facebook_messenger_page.sql', '0023_workspace_roles.sql',
    '0024_password_auth.sql', '0025_campaign_jobs.sql', '0026_campaign_upload_chunks.sql',
    '0027_google_reviews_oauth.sql'
  ]) {
    database.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  return { database, DB: new TestD1(database) };
}

function envFor(DB, overrides = {}) {
  const env = {
    DB,
    APP_NAME: 'Helixcer Chat',
    APP_ORIGIN: 'https://chat.helixcer.com',
    ALLOWED_ORIGINS: 'https://chat.helixcer.com',
    GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    GOOGLE_REDIRECT_URI: 'https://api.chat.helixcer.com/auth/google/callback',
    BOOTSTRAP_OWNER_EMAIL: 'owner@example.com',
    DEFAULT_WORKSPACE_ID: 'ws_default',
    SESSION_TTL_SECONDS: '3600',
    ADMIN_TOKEN: 'recovery-secret',
    RECOVERY_MODE: 'true',
    CHANNEL_CREDENTIALS_KEY: 'test-channel-master-key-material-'.repeat(2),
    META_APP_ID: '9988776655443322',
    META_APP_SECRET: 'meta-app-secret-value-123456',
    META_EMBEDDED_SIGNUP_CONFIG_ID: '1122334455667788',
    META_WEBHOOK_VERIFY_TOKEN: 'test-meta-webhook-verify-token',
    META_GRAPH_API_VERSION: 'v22.0',
    ...overrides
  };
  env.INBOX_HUB = {
    idFromName: value => value,
    get: () => ({
      fetch: async (url) => {
        if (String(url).includes('oauth-rate-limit')) return new Response(null, { status: 204 });
        return new Response(null, { status: 200 });
      }
    })
  };
  return env;
}

function mockMetaEmbeddedFetch() {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push({
      url,
      method: init.method || 'GET',
      body: init.body || '',
      headers: init.headers || {}
    });
    if (url.includes('/oauth/access_token')) {
      return Response.json({
        access_token: 'EAAG-embedded-business-token-abcdef',
        token_type: 'bearer'
      });
    }
    if (url.includes('/subscriptions') && (init.method || 'GET') === 'POST') {
      const bodyText = String(init.body || '');
      if (!bodyText.includes('whatsapp_business_account') || !bodyText.includes('callback_url')) {
        return Response.json({
          error: { message: 'Missing app webhook subscription fields.', type: 'OAuthException', code: 100 }
        }, { status: 400 });
      }
      return Response.json({ success: true });
    }
    if (url.includes('/subscribed_apps')) {
      const bodyText = String(init.body || '');
      if (bodyText.includes('override_callback_uri') && !bodyText.includes('subscribed_fields')) {
        return Response.json({
          error: {
            message: '(#100) Before override the current callback uri, your app must be subscribed to receive messages for WhatsApp Business Account',
            type: 'OAuthException',
            code: 100
          }
        }, { status: 400 });
      }
      return Response.json({ success: true });
    }
    if (url.includes('/register')) {
      return Response.json({ success: true });
    }
    if (url.includes('/smb_app_data')) {
      const body = JSON.parse(String(init.body || '{}'));
      if (body.sync_type !== 'history' && body.sync_type !== 'smb_app_state_sync') {
        return Response.json({
          error: { message: 'Invalid sync_type', type: 'OAuthException', code: 100 }
        }, { status: 400 });
      }
      return Response.json({
        messaging_product: 'whatsapp',
        request_id: `req-${body.sync_type}-123`
      });
    }
    return new Response(`unexpected fetch ${url}`, { status: 500 });
  };
  return { fetchImpl, calls };
}

test('Embedded Signup helpers parse session and gate phone registration', () => {
  const session = parseWhatsAppEmbeddedSignupSession({
    code: 'AQBx-embedded-signup-code-value',
    waba_id: '524126980791429',
    phone_number_id: '106540352242922',
    business_id: '2729063490586005',
    event: 'FINISH'
  });
  assert.equal(session.wabaId, '524126980791429');
  assert.equal(session.phoneNumberId, '106540352242922');
  assert.equal(shouldRegisterWhatsAppPhone('FINISH'), true);
  assert.equal(shouldRegisterWhatsAppPhone('FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'), false);
  assert.equal(isWhatsAppCoexistenceSignup('FINISH'), false);
  assert.equal(isWhatsAppCoexistenceSignup('FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'), true);
  assert.equal(metaEmbeddedSignupPublicConfig({}).available, false);
  assert.equal(metaEmbeddedSignupPublicConfig({
    META_APP_ID: '1',
    META_APP_SECRET: 'secret-value-long-enough',
    META_EMBEDDED_SIGNUP_CONFIG_ID: '2'
  }).available, true);
});

test('WhatsApp Embedded Signup config is unavailable without Meta secrets', async () => {
  const { DB } = await testDatabase();
  const env = envFor(DB, {
    META_APP_ID: '',
    META_APP_SECRET: '',
    META_EMBEDDED_SIGNUP_CONFIG_ID: ''
  });
  const response = await handleRequest(new Request(
    'https://api.chat.helixcer.com/api/channels/meta/embedded-signup/config',
    { headers: { Authorization: 'Bearer recovery-secret', Origin: 'https://chat.helixcer.com' } }
  ), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.available, false);
});

test('WhatsApp Embedded Signup complete exchanges code, saves channel, subscribes, and registers phone', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const { fetchImpl, calls } = mockMetaEmbeddedFetch();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const response = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/channels/oauth/whatsapp-embedded/complete',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer recovery-secret',
          Origin: 'https://chat.helixcer.com',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          code: 'AQBx-embedded-signup-code-value',
          wabaId: '524126980791429',
          phoneNumberId: '106540352242922',
          businessId: '2729063490586005',
          event: 'FINISH',
          name: 'Sales WhatsApp'
        })
      }
    ), env, { waitUntil() {} });
    assert.equal(response.status, 201, await response.clone().text());
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.created, true);
    assert.equal(body.name, 'Sales WhatsApp');
    assert.equal(body.authMode, 'embedded_signup');
    assert.equal(body.coexistence, false);
    assert.equal(body.phoneRegistered, true);
    assert.ok(body.channelId);

    const channel = database.prepare('SELECT * FROM channels WHERE channel_id=?').get(body.channelId);
    assert.ok(channel);
    const config = JSON.parse(channel.config_json);
    assert.equal(config.wabaId, '524126980791429');
    assert.equal(config.phoneNumberId, '106540352242922');
    assert.equal(config.authMode, 'embedded_signup');
    assert.equal(config.coexistence, undefined);
    assert.equal(config.businessId, '2729063490586005');

    const credentials = database.prepare(
      'SELECT credential_key FROM channel_credentials WHERE channel_id=? ORDER BY credential_key'
    ).all(body.channelId).map(row => row.credential_key);
    assert.deepEqual(credentials, ['accessToken', 'appSecret', 'verifyToken']);

    assert.ok(calls.some(call => call.url.includes('/oauth/access_token')));
    assert.ok(calls.some(call => call.url.includes('/register') && call.method === 'POST'));
    const appSubscriptions = calls.filter(call => call.url.includes('/subscriptions') && call.method === 'POST');
    assert.equal(appSubscriptions.length, 1);
    assert.match(String(appSubscriptions[0].body), /whatsapp_business_account/);
    assert.match(String(appSubscriptions[0].body), /webhooks%2Fwhatsapp-app|webhooks\/whatsapp-app/);
    const subscriptions = calls.filter(call => call.url.includes('/subscribed_apps'));
    assert.deepEqual(subscriptions.map(call => call.method), ['POST', 'POST']);
    assert.equal(subscriptions[0].body, '');
    assert.doesNotMatch(String(subscriptions[0].headers?.['Content-Type'] || ''), /application\/json/);
    assert.match(subscriptions[1].body, /override_callback_uri/);
    assert.match(subscriptions[1].body, /"subscribed_fields"/);
    assert.match(subscriptions[1].body, /"messages"/);
    assert.match(subscriptions[1].body, new RegExp(`/webhooks/whatsapp/${body.channelId}`));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('WhatsApp app webhook answers Meta verification challenge', async () => {
  const { DB } = await testDatabase();
  const env = envFor(DB);
  const verifyToken = metaWhatsAppAppVerifyToken(env);
  const ok = await handleRequest(new Request(
    `https://api.chat.helixcer.com/webhooks/whatsapp-app?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=challenge-app-123`
  ), env);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'challenge-app-123');

  const rejected = await handleRequest(new Request(
    'https://api.chat.helixcer.com/webhooks/whatsapp-app?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=nope'
  ), env);
  assert.equal(rejected.status, 403);
});

test('Register Webhook re-subscribes Embedded Signup WhatsApp channels only', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const { fetchImpl, calls } = mockMetaEmbeddedFetch();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const created = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/channels/oauth/whatsapp-embedded/complete',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer recovery-secret',
          Origin: 'https://chat.helixcer.com',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          code: 'AQBx-embedded-signup-code-value',
          wabaId: '524126980791429',
          phoneNumberId: '106540352242922',
          event: 'FINISH',
          name: 'Sales WhatsApp'
        })
      }
    ), env, { waitUntil() {} });
    assert.equal(created.status, 201, await created.clone().text());
    const createdBody = await created.json();
    database.prepare(`UPDATE channels
      SET config_json=json_remove(json_remove(config_json,'$.webhookVerifiedAt'),'$.subscribedAppsAt')
      WHERE channel_id=?`).run(createdBody.channelId);
    calls.length = 0;

    const response = await handleRequest(new Request(
      `https://api.chat.helixcer.com/api/channels/${encodeURIComponent(createdBody.channelId)}/register-webhook`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer recovery-secret',
          Origin: 'https://chat.helixcer.com'
        }
      }
    ), env, { waitUntil() {} });
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.channelId, createdBody.channelId);
    assert.ok(body.webhookVerifiedAt);
    assert.equal(body.health, 'connected');

    assert.equal(calls.filter(call => call.url.includes('/subscriptions') && call.method === 'POST').length, 1);
    const subscriptions = calls.filter(call => call.url.includes('/subscribed_apps'));
    assert.equal(subscriptions.length, 2);
    assert.equal(subscriptions[0].body, '');
    assert.match(subscriptions[1].body, /override_callback_uri/);
    assert.match(subscriptions[1].body, /"subscribed_fields"/);

    const manual = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/channels',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer recovery-secret',
          Origin: 'https://chat.helixcer.com',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: 'Manual WhatsApp',
          connectorType: 'whatsapp_cloud',
          config: { wabaId: '1111222233334444', phoneNumberId: '5555666677778888', apiVersion: 'v26.0' },
          credentials: {
            accessToken: 'EAAG-manual-access-token-abcdef',
            verifyToken: 'manual-verify-token-value',
            appSecret: 'meta-app-secret-value-123456'
          }
        })
      }
    ), env, { waitUntil() {} });
    assert.equal(manual.status, 201, await manual.clone().text());
    const manualBody = await manual.json();
    const rejected = await handleRequest(new Request(
      `https://api.chat.helixcer.com/api/channels/${encodeURIComponent(manualBody.channelId)}/register-webhook`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer recovery-secret',
          Origin: 'https://chat.helixcer.com'
        }
      }
    ), env, { waitUntil() {} });
    assert.equal(rejected.status, 400, await rejected.clone().text());
    const rejectedBody = await rejected.json();
    assert.match(rejectedBody.error || '', /Login with Facebook/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Coexistence history sync can start and cancel', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const { fetchImpl, calls } = mockMetaEmbeddedFetch();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const created = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/channels/oauth/whatsapp-embedded/complete',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer recovery-secret',
          Origin: 'https://chat.helixcer.com',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          code: 'AQBx-embedded-signup-code-value',
          wabaId: '524126980791429',
          phoneNumberId: '106540352242922',
          event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
          name: 'Coexistence Sync WhatsApp'
        })
      }
    ), env, { waitUntil() {} });
    assert.equal(created.status, 201, await created.clone().text());
    const body = await created.json();

    const started = await handleRequest(new Request(
      `https://api.chat.helixcer.com/api/channels/${encodeURIComponent(body.channelId)}/sync-coexistence-history`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer recovery-secret',
          Origin: 'https://chat.helixcer.com'
        }
      }
    ), env, { waitUntil() {} });
    assert.equal(started.status, 200, await started.clone().text());
    const startedBody = await started.json();
    assert.equal(startedBody.ok, true);
    assert.equal(startedBody.coexistenceSync.status, 'running');
    assert.equal(
      calls.filter(call => call.url.includes('/smb_app_data')).length,
      2
    );

    const conflict = await handleRequest(new Request(
      `https://api.chat.helixcer.com/api/channels/${encodeURIComponent(body.channelId)}/sync-coexistence-history`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer recovery-secret',
          Origin: 'https://chat.helixcer.com'
        }
      }
    ), env, { waitUntil() {} });
    assert.equal(conflict.status, 409);

    const cancelled = await handleRequest(new Request(
      `https://api.chat.helixcer.com/api/channels/${encodeURIComponent(body.channelId)}/cancel-coexistence-sync`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer recovery-secret',
          Origin: 'https://chat.helixcer.com'
        }
      }
    ), env, { waitUntil() {} });
    assert.equal(cancelled.status, 200, await cancelled.clone().text());
    const cancelledBody = await cancelled.json();
    assert.equal(cancelledBody.coexistenceSync.status, 'cancelled');

    const listed = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/channels',
      { headers: { Authorization: 'Bearer recovery-secret', Origin: 'https://chat.helixcer.com' } }
    ), env);
    const channels = await listed.json();
    const channel = (channels.items || channels).find(item => item.channelId === body.channelId);
    assert.equal(channel.setup.coexistence, true);
    assert.equal(channel.setup.coexistenceSync.status, 'cancelled');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('WhatsApp coexistence Embedded Signup skips phone registration', async () => {
  const { DB } = await testDatabase();
  const env = envFor(DB);
  const { fetchImpl, calls } = mockMetaEmbeddedFetch();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const response = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/channels/oauth/whatsapp-embedded/complete',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer recovery-secret',
          Origin: 'https://chat.helixcer.com',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          code: 'AQBx-embedded-signup-code-value',
          wabaId: '524126980791429',
          phoneNumberId: '106540352242922',
          event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
          name: 'Coexistence WhatsApp'
        })
      }
    ), env, { waitUntil() {} });
    assert.equal(response.status, 201, await response.clone().text());
    const body = await response.json();
    assert.equal(body.phoneRegistered, false);
    assert.equal(body.coexistence, true);
    assert.equal(calls.some(call => call.url.includes('/register')), false);
    const channel = await env.DB.prepare('SELECT config_json FROM channels WHERE channel_id=?1')
      .bind(body.channelId).first();
    const config = JSON.parse(channel.config_json);
    assert.equal(config.coexistence, true);
    assert.equal(config.authMode, 'embedded_signup');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
