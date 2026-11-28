import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { handleRequest } from '../src/index.js';
import { GOOGLE_BUSINESS_OAUTH_COOKIE } from '../src/google-business.js';
import {
  decodePubSubPushMessage,
  googleReviewIdFromChannelProfile,
  normalizeGoogleReviewToInbound,
  parseGoogleReviewNotification,
  updateGoogleBusinessReviewReply
} from '../src/google-business.js';

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
    '0027_google_reviews_oauth.sql', '0033_google_contact_platform.sql'
  ]) {
    database.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  return { database, DB: new TestD1(database) };
}

function envFor(DB, overrides = {}) {
  return {
    DB,
    APP_NAME: 'Helixcer Chat',
    APP_ORIGIN: 'https://chat.helixcer.com',
    ALLOWED_ORIGINS: 'https://chat.helixcer.com',
    GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    GOOGLE_REDIRECT_URI: 'https://api.chat.helixcer.com/auth/google/callback',
    GOOGLE_BUSINESS_REDIRECT_URI: 'https://api.chat.helixcer.com/auth/google-business/callback',
    GOOGLE_BUSINESS_PUBSUB_TOPIC: 'projects/demo/topics/helixcer-google-reviews',
    GOOGLE_REVIEWS_WEBHOOK_TOKEN: 'reviews-webhook-secret',
    BOOTSTRAP_OWNER_EMAIL: 'owner@example.com',
    DEFAULT_WORKSPACE_ID: 'ws_default',
    SESSION_TTL_SECONDS: '3600',
    ADMIN_TOKEN: 'recovery-secret',
    RECOVERY_MODE: 'true',
    CHANNEL_CREDENTIALS_KEY: 'test-channel-master-key-material-'.repeat(2),
    INBOX_HUB: {
      idFromName: value => value,
      get: () => ({ fetch: async () => new Response(null, { status: 204 }) })
    },
    ...overrides
  };
}

function cookieValue(response, name) {
  const values = response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''];
  const joined = values.join('; ');
  const match = joined.match(new RegExp(`${name}=([^;,]+)`));
  return match ? decodeURIComponent(match[1]) : '';
}

function mockGoogleBusinessFetch(reviews = []) {
  return async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method || 'GET').toUpperCase();
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
    if (url.startsWith('https://mybusinessnotifications.googleapis.com/') && method === 'PATCH') {
      return Response.json({
        name: 'accounts/111/notificationSetting',
        pubsubTopic: 'projects/demo/topics/helixcer-google-reviews',
        notificationTypes: ['NEW_REVIEW', 'UPDATED_REVIEW']
      });
    }
    if (url.includes('/reviews/r1') || url.endsWith('/reviews/r1')) {
      return Response.json(reviews[0] || {
        name: 'accounts/111/locations/222/reviews/r1',
        reviewId: 'r1',
        starRating: 'FIVE',
        comment: 'Great service',
        createTime: '2026-01-01T00:00:00Z',
        updateTime: '2026-01-02T00:00:00Z',
        reviewer: { displayName: 'Ada' }
      });
    }
    if (url.includes('/reviews')) {
      return Response.json({
        totalReviewCount: reviews.length || 1,
        averageRating: 5,
        reviews: reviews.length ? reviews : [{
          name: 'accounts/111/locations/222/reviews/r1',
          reviewId: 'r1',
          starRating: 'FIVE',
          comment: 'Great service',
          createTime: '2026-01-01T00:00:00Z',
          updateTime: '2026-01-02T00:00:00Z',
          reviewer: { displayName: 'Ada' }
        }]
      });
    }
    return new Response(`unexpected fetch ${method} ${url}`, { status: 500 });
  };
}

async function connectGoogleReviewsChannel(env) {
  const apiHeaders = {
    Authorization: 'Bearer recovery-secret',
    Origin: 'https://chat.helixcer.com',
    'Content-Type': 'application/json'
  };
  const start = await handleRequest(new Request(
    'https://api.chat.helixcer.com/api/channels/oauth/google-reviews/start?name=Store%20reviews&return_to=https://chat.helixcer.com/%23channels',
    { headers: { Authorization: 'Bearer recovery-secret' } }
  ), env);
  const state = cookieValue(start, GOOGLE_BUSINESS_OAUTH_COOKIE);
  const callbackResponse = await handleRequest(new Request(
    `https://api.chat.helixcer.com/auth/google-business/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    { headers: { Cookie: `${GOOGLE_BUSINESS_OAUTH_COOKIE}=${encodeURIComponent(state)}` } }
  ), env);
  const pendingToken = new URL(callbackResponse.headers.get('Location')).searchParams.get('google_reviews_pending');
  const confirmed = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels/oauth/google-reviews/confirm', {
    method: 'POST',
    headers: apiHeaders,
    body: JSON.stringify({
      token: pendingToken,
      name: 'Store reviews',
      accountId: '111',
      locationId: '222'
    })
  }), env);
  assert.equal(confirmed.status, 201, await confirmed.clone().text());
  return confirmed.json();
}

test('normalizeGoogleReviewToInbound maps stars and comment', () => {
  const event = normalizeGoogleReviewToInbound({
    name: 'accounts/a/locations/l/reviews/r1',
    reviewId: 'r1',
    starRating: 'FIVE',
    comment: 'Great service',
    createTime: '2026-01-01T00:00:00Z',
    updateTime: '2026-01-02T00:00:00Z',
    reviewer: { displayName: 'Ada', isAnonymous: false }
  });
  assert.equal(event.providerMessageId, 'r1');
  assert.equal(event.channelProfileId, 'review:r1');
  assert.equal(event.displayName, 'Ada');
  assert.match(event.text, /★★★★★/);
  assert.match(event.text, /Great service/);
  assert.equal(event.messageType, 'review');
  assert.equal(event.review.starRating, 5);
});

test('googleReviewIdFromChannelProfile strips review prefix', () => {
  assert.equal(googleReviewIdFromChannelProfile('review:abc123'), 'abc123');
  assert.equal(googleReviewIdFromChannelProfile('abc123'), 'abc123');
  assert.equal(googleReviewIdFromChannelProfile(''), '');
});

test('updateGoogleBusinessReviewReply PUTs comment to Google', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body || '' });
    return new Response(JSON.stringify({
      comment: 'Thanks for visiting!',
      updateTime: '2026-11-27T19:00:00Z'
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const reply = await updateGoogleBusinessReviewReply(
    'token',
    '111',
    '222',
    'r1',
    'Thanks for visiting!',
    fetchImpl
  );
  assert.equal(reply.comment, 'Thanks for visiting!');
  assert.equal(reply.reviewName, 'accounts/111/locations/222/reviews/r1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'PUT');
  assert.match(calls[0].url, /\/accounts\/111\/locations\/222\/reviews\/r1\/reply$/);
  assert.deepEqual(JSON.parse(calls[0].body), { comment: 'Thanks for visiting!' });
});

test('parseGoogleReviewNotification accepts review_name fields', () => {
  const notice = parseGoogleReviewNotification({
    type: 'NEW_REVIEW',
    location_name: 'accounts/111/locations/222',
    review_name: 'accounts/111/locations/222/reviews/abc'
  });
  assert.equal(notice.type, 'NEW_REVIEW');
  assert.equal(notice.accountId, '111');
  assert.equal(notice.locationId, '222');
  assert.equal(notice.reviewId, 'abc');
});

test('decodePubSubPushMessage decodes base64 JSON', () => {
  const payload = {
    type: 'UPDATED_REVIEW',
    locationName: 'accounts/1/locations/2',
    reviewName: 'accounts/1/locations/2/reviews/3'
  };
  const push = decodePubSubPushMessage({
    message: {
      messageId: 'm1',
      data: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
    }
  });
  assert.equal(push.messageId, 'm1');
  assert.deepEqual(push.data, payload);
});

test('sync-reviews imports Google reviews into the inbox', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockGoogleBusinessFetch();
  let channelId = '';
  try {
    const body = await connectGoogleReviewsChannel(env);
    channelId = body.channelId;
    const synced = await handleRequest(new Request(
      `https://api.chat.helixcer.com/api/channels/${encodeURIComponent(channelId)}/sync-reviews`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer recovery-secret',
          Origin: 'https://chat.helixcer.com'
        }
      }
    ), env);
    assert.equal(synced.status, 200, await synced.clone().text());
    const syncBody = await synced.json();
    assert.equal(syncBody.ok, true);
    assert.equal(syncBody.imported, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }

  const message = database.prepare(`SELECT text,provider_message_id,message_type FROM messages
    WHERE channel_id=? AND provider_message_id='r1'`).get(channelId);
  assert.ok(message);
  assert.equal(message.message_type, 'review');
  assert.match(message.text, /Great service/);
  const identity = database.prepare(`SELECT platform,profile_id FROM contact_identities
    WHERE profile_id='review:r1'`).get();
  assert.ok(identity);
  assert.equal(identity.platform, 'google');
  const flat = database.prepare(`SELECT platform,profile_id FROM contact_platform_ids
    WHERE profile_id='review:r1'`).get();
  assert.ok(flat);
  assert.equal(flat.platform, 'google');
  database.close();
});

test('google review outbound rejects a second successful reply', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockGoogleBusinessFetch();
  const pending = [];
  const ctx = { waitUntil(promise) { pending.push(promise); } };
  try {
    const body = await connectGoogleReviewsChannel(env);
    const channelId = body.channelId;
    const synced = await handleRequest(new Request(
      `https://api.chat.helixcer.com/api/channels/${encodeURIComponent(channelId)}/sync-reviews`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer recovery-secret',
          Origin: 'https://chat.helixcer.com'
        }
      }
    ), env, ctx);
    assert.equal(synced.status, 200, await synced.clone().text());
    const conversationId = database.prepare(`SELECT conversation_id FROM messages
      WHERE channel_id=? AND provider_message_id='r1'`).get(channelId).conversation_id;

    const apiHeaders = {
      Authorization: 'Bearer recovery-secret',
      Origin: 'https://chat.helixcer.com',
      'Content-Type': 'application/json'
    };
    const failedAllowed = await handleRequest(new Request(
      `https://api.chat.helixcer.com/api/conversations/${encodeURIComponent(conversationId)}/messages`,
      { method: 'POST', headers: apiHeaders, body: JSON.stringify({ text: 'First attempt' }) }
    ), env, ctx);
    assert.equal(failedAllowed.status, 202, await failedAllowed.clone().text());
    await Promise.all(pending.splice(0));
    const first = await failedAllowed.json();
    database.prepare(`UPDATE messages SET status='failed', error='simulated'
      WHERE message_id=?`).run(first.item.messageId);

    const retry = await handleRequest(new Request(
      `https://api.chat.helixcer.com/api/conversations/${encodeURIComponent(conversationId)}/messages`,
      { method: 'POST', headers: apiHeaders, body: JSON.stringify({ text: 'Thanks for visiting' }) }
    ), env, ctx);
    assert.equal(retry.status, 202, await retry.clone().text());
    await Promise.all(pending.splice(0));
    const sent = await retry.json();
    database.prepare(`UPDATE messages SET status='sent', provider_message_id='review-reply:r1'
      WHERE message_id=?`).run(sent.item.messageId);

    const blocked = await handleRequest(new Request(
      `https://api.chat.helixcer.com/api/conversations/${encodeURIComponent(conversationId)}/messages`,
      { method: 'POST', headers: apiHeaders, body: JSON.stringify({ text: 'Second reply' }) }
    ), env, ctx);
    assert.equal(blocked.status, 409, await blocked.clone().text());
    const blockedBody = await blocked.json();
    assert.match(String(blockedBody.error || ''), /Only one reply can be sent for a Google review/i);
    assert.equal(blockedBody.code, 'google_review_reply_exists');
    await Promise.all(pending.splice(0));
  } finally {
    globalThis.fetch = previousFetch;
    database.close();
  }
});

test('google-reviews-pubsub webhook imports NEW_REVIEW events', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockGoogleBusinessFetch();
  let channelId = '';
  try {
    const body = await connectGoogleReviewsChannel(env);
    channelId = body.channelId;
    const notice = {
      type: 'NEW_REVIEW',
      locationName: 'accounts/111/locations/222',
      reviewName: 'accounts/111/locations/222/reviews/r1'
    };
    const webhook = await handleRequest(new Request(
      'https://api.chat.helixcer.com/webhooks/google-reviews-pubsub?token=reviews-webhook-secret',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            messageId: 'pubsub-1',
            data: Buffer.from(JSON.stringify(notice), 'utf8').toString('base64')
          }
        })
      }
    ), env);
    assert.equal(webhook.status, 200, await webhook.clone().text());
    const webhookBody = await webhook.json();
    assert.equal(webhookBody.ok, true);
    assert.equal(webhookBody.channelId, channelId);
    assert.equal(webhookBody.imported, true);
  } finally {
    globalThis.fetch = previousFetch;
  }

  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM messages
    WHERE channel_id=? AND provider_message_id='r1'`).get(channelId).count, 1);
  database.close();
});

test('google-reviews-pubsub rejects missing webhook token', async () => {
  const { DB } = await testDatabase();
  const env = envFor(DB);
  const response = await handleRequest(new Request(
    'https://api.chat.helixcer.com/webhooks/google-reviews-pubsub',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { data: '' } })
    }
  ), env);
  assert.equal(response.status, 401);
});
