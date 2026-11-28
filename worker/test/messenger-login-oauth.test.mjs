import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { handleRequest } from '../src/index.js';
import { MESSENGER_OAUTH_COOKIE } from '../src/messenger-login.js';

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
    '0027_google_reviews_oauth.sql', '0028_campaign_scheduled_at.sql', '0029_workspace_automation.sql',
    '0030_whatsapp_template_variable_mappings.sql', '0031_platform_notifications.sql',
    '0032_instagram_login_oauth.sql', '0033_google_contact_platform.sql',
    '0034_automation_channel_ids.sql', '0035_messenger_login_oauth.sql'
  ]) {
    database.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  return { database, DB: new TestD1(database) };
}

function envFor(DB, overrides = {}) {
  const env = {
    DB,
    APP_NAME: 'Helixcer Chat',
    APP_ORIGIN: 'https://app.chat.helixcer.com',
    ALLOWED_ORIGINS: 'https://app.chat.helixcer.com,https://chat.helixcer.com',
    META_APP_ID: '1051245721347219',
    META_APP_SECRET: 'meta-app-secret-value-1234567890ab',
    META_MESSENGER_LOGIN_CONFIG_ID: '9988776655443322',
    META_MESSENGER_OAUTH_REDIRECT_URI: 'https://api.chat.helixcer.com/auth/messenger/callback',
    META_WEBHOOK_VERIFY_TOKEN: 'test-meta-webhook-verify-token',
    META_GRAPH_API_VERSION: 'v26.0',
    BOOTSTRAP_OWNER_EMAIL: 'owner@example.com',
    DEFAULT_WORKSPACE_ID: 'ws_default',
    SESSION_TTL_SECONDS: '3600',
    ADMIN_TOKEN: 'recovery-secret',
    RECOVERY_MODE: 'true',
    CHANNEL_CREDENTIALS_KEY: 'test-channel-master-key-material-'.repeat(2),
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

function cookieValue(response, name) {
  const values = response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''];
  const joined = values.join('; ');
  const match = joined.match(new RegExp(`${name}=([^;,]+)`));
  return match ? decodeURIComponent(match[1]) : '';
}

function mockMessengerFetch() {
  return async (input) => {
    const url = String(input);
    if (url.includes('graph.facebook.com') && url.includes('/oauth/access_token')) {
      return Response.json({
        access_token: 'EAAG-user-token-value-123456',
        token_type: 'bearer',
        expires_in: 5184000
      });
    }
    if (url.includes('/me/accounts')) {
      return Response.json({
        data: [{
          id: '109876543210987',
          name: 'Helixcer Page',
          access_token: 'EAAG-page-token-value-abcdef'
        }]
      });
    }
    if (url.includes('/subscribed_apps')) {
      return Response.json({ success: true });
    }
    return new Response(`unexpected fetch ${url}`, { status: 500 });
  };
}

test('Messenger Login config reports Facebook Login availability', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const response = await handleRequest(new Request(
    'https://api.chat.helixcer.com/api/channels/oauth/messenger/config',
    { headers: { Authorization: 'Bearer recovery-secret' } }
  ), env);
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.available, true);
  assert.equal(body.appId, '1051245721347219');
  assert.equal(body.configId, '9988776655443322');
  assert.equal(body.authMode, 'facebook_login');

  const missing = await handleRequest(new Request(
    'https://api.chat.helixcer.com/api/channels/oauth/messenger/config',
    { headers: { Authorization: 'Bearer recovery-secret' } }
  ), envFor(DB, { META_MESSENGER_LOGIN_CONFIG_ID: '' }));
  assert.equal(missing.status, 200);
  assert.equal((await missing.json()).available, false);
  database.close();
});

test('Messenger Login OAuth start redirects to Facebook Login for Business', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const start = await handleRequest(new Request(
    'https://api.chat.helixcer.com/api/channels/oauth/messenger/start?name=Page%20Support&return_to=https://app.chat.helixcer.com/%23channels',
    { headers: { Authorization: 'Bearer recovery-secret' } }
  ), env);
  assert.equal(start.status, 302, await start.clone().text());
  const location = new URL(start.headers.get('Location'));
  assert.equal(location.origin, 'https://www.facebook.com');
  assert.equal(location.pathname, '/dialog/oauth');
  assert.equal(location.searchParams.get('client_id'), env.META_APP_ID);
  assert.equal(location.searchParams.get('config_id'), env.META_MESSENGER_LOGIN_CONFIG_ID);
  assert.equal(location.searchParams.get('redirect_uri'), env.META_MESSENGER_OAUTH_REDIRECT_URI);
  assert.equal(location.searchParams.get('response_type'), 'code');
  assert.ok(cookieValue(start, MESSENGER_OAUTH_COOKIE));
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM messenger_login_oauth_states').get().count, 1);
  database.close();
});

test('Messenger Login OAuth callback creates a facebook_login Messenger channel', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const start = await handleRequest(new Request(
    'https://api.chat.helixcer.com/api/channels/oauth/messenger/start?name=Page%20Support&return_to=https://app.chat.helixcer.com/%23channels',
    { headers: { Authorization: 'Bearer recovery-secret' } }
  ), env);
  assert.equal(start.status, 302, await start.clone().text());
  const state = cookieValue(start, MESSENGER_OAUTH_COOKIE);

  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockMessengerFetch();
  let callbackResponse;
  try {
    callbackResponse = await handleRequest(new Request(
      `https://api.chat.helixcer.com/auth/messenger/callback?code=AQBx-auth-code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: `${MESSENGER_OAUTH_COOKIE}=${encodeURIComponent(state)}` } }
    ), env);
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.equal(callbackResponse.status, 302, await callbackResponse.clone().text());
  const location = new URL(callbackResponse.headers.get('Location'));
  assert.equal(location.searchParams.get('messenger_connected'), '1');
  assert.ok(location.searchParams.get('messenger_channel'));
  assert.equal(location.searchParams.get('messenger_page'), 'Helixcer Page');

  const channel = database.prepare(`SELECT * FROM channels WHERE provider_type='facebook_messenger'`).get();
  assert.ok(channel);
  const config = JSON.parse(channel.config_json);
  assert.equal(config.pageId, '109876543210987');
  assert.equal(config.pageName, 'Helixcer Page');
  assert.equal(config.appId, env.META_APP_ID);
  assert.equal(config.authMode, 'facebook_login');
  assert.ok(config.credentialsVerifiedAt);
  assert.ok(config.subscribedAppsAt);
  database.close();
});
