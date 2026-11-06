import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { handleRequest } from '../src/index.js';
import { GOOGLE_BUSINESS_OAUTH_COOKIE } from '../src/google-business.js';

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
    GOOGLE_BUSINESS_REDIRECT_URI: 'https://api.chat.helixcer.com/auth/google-business/callback',
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

function mockGoogleBusinessFetch() {
  return async (input) => {
    const url = String(input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return Response.json({
        access_token: 'ya29.google-business-access-token',
        refresh_token: '1//google-business-refresh-token',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/business.manage',
        token_type: 'Bearer'
      });
    }
    if (url.startsWith('https://www.googleapis.com/oauth2/v3/userinfo')) {
      return Response.json({ email: 'owner@example.com' });
    }
    if (url.startsWith('https://mybusinessaccountmanagement.googleapis.com/v1/accounts')) {
      return Response.json({
        accounts: [{ name: 'accounts/111', accountName: 'Helixcer account' }]
      });
    }
    if (url.includes('mybusinessbusinessinformation') && url.includes('/locations')) {
      return Response.json({
        locations: [{
          name: 'accounts/111/locations/222',
          title: 'Helixcer Store',
          storefrontAddress: { addressLines: ['MG Road'], locality: 'Bengaluru' }
        }]
      });
    }
    if (url.includes('/reviews')) {
      return Response.json({ totalReviewCount: 3, averageRating: 4.5, reviews: [{ reviewId: 'r1' }] });
    }
    return new Response(`unexpected fetch ${url}`, { status: 500 });
  };
}

test('Google Reviews OAuth start redirects without asking clients for API keys', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const start = await handleRequest(new Request(
    'https://api.chat.helixcer.com/api/channels/oauth/google-reviews/start?name=Store%20reviews&return_to=https://chat.helixcer.com/%23channels',
    { headers: { Authorization: 'Bearer recovery-secret' } }
  ), env);
  assert.equal(start.status, 302, await start.clone().text());
  const location = new URL(start.headers.get('Location'));
  assert.equal(location.origin, 'https://accounts.google.com');
  assert.equal(location.searchParams.get('scope'), 'https://www.googleapis.com/auth/business.manage');
  assert.equal(location.searchParams.get('access_type'), 'offline');
  assert.match(location.searchParams.get('prompt') || '', /consent/);
  assert.equal(location.searchParams.get('redirect_uri'), env.GOOGLE_BUSINESS_REDIRECT_URI);
  assert.ok(cookieValue(start, GOOGLE_BUSINESS_OAUTH_COOKIE));
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM google_business_oauth_states').get().count, 1);
  database.close();
});

test('Google Reviews OAuth callback and confirm create a connected channel from Google login', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const apiHeaders = {
    Authorization: 'Bearer recovery-secret',
    Origin: 'https://chat.helixcer.com',
    'Content-Type': 'application/json'
  };
  const start = await handleRequest(new Request(
    'https://api.chat.helixcer.com/api/channels/oauth/google-reviews/start?name=Store%20reviews&return_to=https://chat.helixcer.com/%23channels',
    { headers: { Authorization: 'Bearer recovery-secret' } }
  ), env);
  assert.equal(start.status, 302, await start.clone().text());
  const state = cookieValue(start, GOOGLE_BUSINESS_OAUTH_COOKIE);

  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockGoogleBusinessFetch();
  let callbackResponse;
  let confirmed;
  try {
    callbackResponse = await handleRequest(new Request(
      `https://api.chat.helixcer.com/auth/google-business/callback?code=auth-code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: `${GOOGLE_BUSINESS_OAUTH_COOKIE}=${encodeURIComponent(state)}` } }
    ), env);
    assert.equal(callbackResponse.status, 302, await callbackResponse.clone().text());
    const returnTo = new URL(callbackResponse.headers.get('Location'));
    const pendingToken = returnTo.searchParams.get('google_reviews_pending');
    assert.ok(pendingToken);
    assert.equal(returnTo.origin, 'https://chat.helixcer.com');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM google_business_pending').get().count, 1);

    const pending = await handleRequest(new Request(
      `https://api.chat.helixcer.com/api/channels/oauth/google-reviews/pending?token=${encodeURIComponent(pendingToken)}`,
      { headers: apiHeaders }
    ), env);
    assert.equal(pending.status, 200, await pending.clone().text());
    const pendingBody = await pending.json();
    assert.equal(pendingBody.locations.length, 1);
    assert.equal(pendingBody.locations[0].locationId, '222');

    confirmed = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels/oauth/google-reviews/confirm', {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify({
        token: pendingToken,
        name: 'Store reviews',
        accountId: '111',
        locationId: '222'
      })
    }), env);
  } finally {
    globalThis.fetch = previousFetch;
  }

  assert.equal(confirmed.status, 201, await confirmed.clone().text());
  const body = await confirmed.json();
  assert.equal(body.ok, true);
  assert.equal(body.health, 'connected');

  const row = database.prepare('SELECT connector_type,provider_type,config_json FROM channels WHERE channel_id=?')
    .get(body.channelId);
  assert.equal(row.connector_type, 'generic_http');
  assert.equal(row.provider_type, 'google_reviews');
  const config = JSON.parse(row.config_json);
  assert.equal(config.locationId, '222');
  assert.equal(config.accountId, '111');
  assert.ok(config.credentialsVerifiedAt);
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM channel_credentials
    WHERE channel_id=? AND credential_key IN ('accessToken','refreshToken')`).get(body.channelId).count, 2);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM google_business_pending').get().count, 0);

  const listed = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    headers: { Authorization: 'Bearer recovery-secret' }
  }), env);
  const item = (await listed.json()).items.find(entry => entry.channelId === body.channelId);
  assert.equal(item.health, 'connected');
  assert.equal(item.setup.authMode, 'google_oauth');
  assert.equal(item.setup.callbackPath, '');
  assert.equal(JSON.stringify(item).includes('google-business-refresh-token'), false);
  database.close();
});

test('Google Reviews rejects duplicate locations in the same workspace', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const headers = {
    Authorization: 'Bearer recovery-secret',
    'Content-Type': 'application/json',
    Origin: 'https://chat.helixcer.com'
  };
  const first = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST', headers,
    body: JSON.stringify({
      channelId: 'google-one',
      name: 'Reviews one',
      connectorType: 'google_reviews',
      config: { accountId: '111', locationId: '222', locationName: 'Store' },
      credentials: {
        accessToken: 'ya29.access-token-value-123456',
        refreshToken: '1//refresh-token-value-123456'
      }
    })
  }), env);
  assert.equal(first.status, 201, await first.clone().text());
  const duplicate = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST', headers,
    body: JSON.stringify({
      channelId: 'google-two',
      name: 'Reviews two',
      connectorType: 'google_reviews',
      config: { accountId: '111', locationId: '222' }
    })
  }), env);
  assert.equal(duplicate.status, 409);
  database.close();
});
