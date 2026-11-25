import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { handleRequest } from '../src/index.js';
import {
  metaEmbeddedSignupPublicConfig,
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
    calls.push({ url, method: init.method || 'GET', body: init.body || '' });
    if (url.includes('/oauth/access_token')) {
      return Response.json({
        access_token: 'EAAG-embedded-business-token-abcdef',
        token_type: 'bearer'
      });
    }
    if (url.includes('/subscribed_apps')) {
      return Response.json({ success: true });
    }
    if (url.includes('/register')) {
      return Response.json({ success: true });
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
    assert.equal(body.phoneRegistered, true);
    assert.ok(body.channelId);

    const channel = database.prepare('SELECT * FROM channels WHERE channel_id=?').get(body.channelId);
    assert.ok(channel);
    const config = JSON.parse(channel.config_json);
    assert.equal(config.wabaId, '524126980791429');
    assert.equal(config.phoneNumberId, '106540352242922');
    assert.equal(config.authMode, 'embedded_signup');
    assert.equal(config.businessId, '2729063490586005');

    const credentials = database.prepare(
      'SELECT credential_key FROM channel_credentials WHERE channel_id=? ORDER BY credential_key'
    ).all(body.channelId).map(row => row.credential_key);
    assert.deepEqual(credentials, ['accessToken', 'appSecret', 'verifyToken']);

    assert.ok(calls.some(call => call.url.includes('/oauth/access_token')));
    const subscribeCalls = calls.filter(call => call.url.includes('/subscribed_apps') && call.method === 'POST');
    assert.equal(subscribeCalls.length, 2);
    assert.equal(subscribeCalls[0].body, '');
    assert.match(subscribeCalls[1].body, /override_callback_uri/);
    assert.match(subscribeCalls[1].body, new RegExp(`/webhooks/whatsapp/${body.channelId}`));
    assert.ok(calls.some(call => call.url.includes('/register') && call.method === 'POST'));
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
    assert.equal(calls.some(call => call.url.includes('/register')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
