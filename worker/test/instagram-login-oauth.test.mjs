import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { handleRequest } from '../src/index.js';
import { INSTAGRAM_OAUTH_COOKIE } from '../src/instagram-login.js';

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
    '0032_instagram_login_oauth.sql'
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
    META_INSTAGRAM_LOGIN_CONFIG_ID: '1191341996753713',
    META_INSTAGRAM_OAUTH_REDIRECT_URI: 'https://api.chat.helixcer.com/auth/meta/callback',
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

function mockUnifiedInstagramFetch() {
  return async (input) => {
    const url = String(input);
    if (url.includes('graph.facebook.com') && url.includes('/oauth/access_token')) {
      return Response.json({
        access_token: 'EAAG-system-user-token-value-123456',
        token_type: 'bearer',
        expires_in: 5184000
      });
    }
    if (url.includes('/me/assigned_instagram_accounts')) {
      return Response.json({
        data: [{ id: '17841448346886805', username: 'helixcer', name: 'Helixcer' }]
      });
    }
    if (url.includes('graph.facebook.com') && url.includes('/me?') && url.includes('client_business_id')) {
      return Response.json({ client_business_id: '123456789012345', id: '999' });
    }
    if (url.includes('/subscribed_apps')) {
      return Response.json({ success: true });
    }
    return new Response(`unexpected fetch ${url}`, { status: 500 });
  };
}

test('Instagram Login config reports Unified Login availability', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const response = await handleRequest(new Request(
    'https://api.chat.helixcer.com/api/channels/oauth/instagram/config',
    { headers: { Authorization: 'Bearer recovery-secret' } }
  ), env);
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.available, true);
  assert.equal(body.appId, '1051245721347219');
  assert.equal(body.configId, '1191341996753713');
  assert.equal(body.authMode, 'unified_login');

  const missing = await handleRequest(new Request(
    'https://api.chat.helixcer.com/api/channels/oauth/instagram/config',
    { headers: { Authorization: 'Bearer recovery-secret' } }
  ), envFor(DB, { META_INSTAGRAM_LOGIN_CONFIG_ID: '' }));
  assert.equal(missing.status, 200);
  assert.equal((await missing.json()).available, false);
  database.close();
});

test('Instagram Login OAuth start redirects to Facebook Login for Business', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const start = await handleRequest(new Request(
    'https://api.chat.helixcer.com/api/channels/oauth/instagram/start?name=IG%20Support&return_to=https://app.chat.helixcer.com/%23channels',
    { headers: { Authorization: 'Bearer recovery-secret' } }
  ), env);
  assert.equal(start.status, 302, await start.clone().text());
  const location = new URL(start.headers.get('Location'));
  assert.equal(location.origin, 'https://www.facebook.com');
  assert.equal(location.pathname, '/dialog/oauth');
  assert.equal(location.searchParams.get('client_id'), env.META_APP_ID);
  assert.equal(location.searchParams.get('config_id'), env.META_INSTAGRAM_LOGIN_CONFIG_ID);
  assert.equal(location.searchParams.get('redirect_uri'), env.META_INSTAGRAM_OAUTH_REDIRECT_URI);
  assert.equal(location.searchParams.get('response_type'), 'code');
  assert.equal(location.searchParams.get('override_default_response_type'), 'true');
  assert.ok(cookieValue(start, INSTAGRAM_OAUTH_COOKIE));
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM instagram_login_oauth_states').get().count, 1);
  database.close();
});

test('Instagram Login OAuth callback creates a unified-login Instagram channel', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const start = await handleRequest(new Request(
    'https://api.chat.helixcer.com/api/channels/oauth/instagram/start?name=IG%20Support&return_to=https://app.chat.helixcer.com/%23channels',
    { headers: { Authorization: 'Bearer recovery-secret' } }
  ), env);
  assert.equal(start.status, 302, await start.clone().text());
  const state = cookieValue(start, INSTAGRAM_OAUTH_COOKIE);

  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockUnifiedInstagramFetch();
  let callbackResponse;
  try {
    callbackResponse = await handleRequest(new Request(
      `https://api.chat.helixcer.com/auth/meta/callback?code=AQBx-auth-code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: `${INSTAGRAM_OAUTH_COOKIE}=${encodeURIComponent(state)}` } }
    ), env);
  } finally {
    globalThis.fetch = previousFetch;
  }

  assert.equal(callbackResponse.status, 302, await callbackResponse.clone().text());
  const returnTo = new URL(callbackResponse.headers.get('Location'));
  assert.equal(returnTo.origin, 'https://app.chat.helixcer.com');
  assert.equal(returnTo.searchParams.get('instagram_connected'), '1');
  assert.equal(returnTo.searchParams.get('instagram_username'), 'helixcer');
  const channelId = returnTo.searchParams.get('instagram_channel');
  assert.ok(channelId);

  const row = database.prepare('SELECT connector_type,provider_type,name,config_json FROM channels WHERE channel_id=?')
    .get(channelId);
  assert.equal(row.connector_type, 'generic_http');
  assert.equal(row.provider_type, 'instagram');
  assert.equal(row.name, 'IG Support');
  const config = JSON.parse(row.config_json);
  assert.equal(config.instagramAccountId, '17841448346886805');
  assert.equal(config.username, 'helixcer');
  assert.equal(config.appId, env.META_APP_ID);
  assert.equal(config.authMode, 'unified_login');
  assert.equal(config.clientBusinessId, '123456789012345');
  assert.ok(config.credentialsVerifiedAt);
  assert.ok(config.subscribedAppsAt);
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM channel_credentials
    WHERE channel_id=? AND credential_key IN ('accessToken','appSecret','verifyToken')`).get(channelId).count, 3);

  const listed = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    headers: { Authorization: 'Bearer recovery-secret' }
  }), env);
  const item = (await listed.json()).items.find(row => row.channelId === channelId);
  assert.equal(item.setup.callbackPath, '/webhooks/instagram-app');
  database.close();
});

test('Instagram Login OAuth denial redirects with an error', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const start = await handleRequest(new Request(
    'https://api.chat.helixcer.com/api/channels/oauth/instagram/start?name=IG%20Support&return_to=https://app.chat.helixcer.com/%23channels',
    { headers: { Authorization: 'Bearer recovery-secret' } }
  ), env);
  const state = cookieValue(start, INSTAGRAM_OAUTH_COOKIE);
  const denied = await handleRequest(new Request(
    `https://api.chat.helixcer.com/auth/meta/callback?error=access_denied&error_reason=user_denied&error_description=The+user+denied+your+request&state=${encodeURIComponent(state)}`,
    { headers: { Cookie: `${INSTAGRAM_OAUTH_COOKIE}=${encodeURIComponent(state)}` } }
  ), env);
  assert.equal(denied.status, 302);
  const returnTo = new URL(denied.headers.get('Location'));
  assert.match(returnTo.searchParams.get('instagram_error') || '', /denied/i);
  database.close();
});
