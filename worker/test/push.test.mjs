import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mobilePushConfiguration,
  mobilePushStatus,
  removeMobilePushDevice,
  pushConfiguration,
  removePushSubscription,
  safePushTarget,
  saveMobilePushDevice,
  savePushSubscription,
  sendWorkspaceMobileConversationRead,
  sendWorkspaceMobilePush,
  sendWorkspaceNotifications,
  sendWorkspacePush,
  validateMobilePushDeviceInput,
  validatePushSubscriptionInput
} from '../src/push.js';

const PUBLIC_KEY = `B${'A'.repeat(86)}`;
const PRIVATE_KEY = 'b'.repeat(43);

function subscriptionInput(endpoint = 'https://fcm.googleapis.com/fcm/send/example-capability') {
  return {
    deviceId: 'device_1234567890abcdef',
    subscription: {
      endpoint,
      expirationTime: null,
      keys: { p256dh: `B${'c'.repeat(86)}`, auth: 'd'.repeat(22) }
    }
  };
}

function principal() {
  return {
    authType: 'session',
    workspace: { workspaceId: 'ws_test' },
    membership: { membershipId: 'member_test' }
  };
}

function mobilePrincipal() {
  return {
    ...principal(),
    authType: 'mobile_session',
    sessionId: 'mobile-session-test',
    deviceId: 'android_1234567890abcdef'
  };
}

const FIREBASE_PLACEHOLDER = {
  FIREBASE_PROJECT_ID: 'helixcer-chat-test',
  FIREBASE_CLIENT_EMAIL: 'push-test@helixcer-chat-test.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${'A'.repeat(64)}\n-----END PRIVATE KEY-----`
};

function recordingDb() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            sql,
            values,
            async run() { calls.push({ sql, values }); return { meta: { changes: 1 } }; }
          };
        }
      };
    },
    async batch(statements) {
      for (const statement of statements) await statement.run();
      return statements.map(() => ({ meta: { changes: 1 } }));
    }
  };
}

test('push configuration exposes only the public VAPID key', () => {
  assert.deepEqual(pushConfiguration({}), { available: false, publicKey: '' });
  assert.deepEqual(pushConfiguration({
    VAPID_PUBLIC_KEY: PUBLIC_KEY,
    VAPID_PRIVATE_KEY: PRIVATE_KEY,
    VAPID_SUBJECT: 'mailto:alerts@example.com'
  }), { available: true, publicKey: PUBLIC_KEY });
});

test('push subscription validation accepts known push services and rejects SSRF endpoints', () => {
  const valid = validatePushSubscriptionInput(subscriptionInput());
  assert.equal(valid.deviceId, 'device_1234567890abcdef');
  assert.match(valid.endpoint, /^https:\/\/fcm\.googleapis\.com\//);
  assert.throws(() => validatePushSubscriptionInput(subscriptionInput('https://example.com/internal')),
    /endpoint is invalid/i);
  assert.throws(() => validatePushSubscriptionInput({ ...subscriptionInput(), deviceId: 'short' }),
    /device ID is invalid/i);
});

test('push subscriptions are saved and removed only for a verified browser session', async () => {
  const DB = recordingDb();
  const env = {
    DB,
    VAPID_PUBLIC_KEY: PUBLIC_KEY,
    VAPID_PRIVATE_KEY: PRIVATE_KEY,
    VAPID_SUBJECT: 'mailto:alerts@example.com'
  };
  const saved = await savePushSubscription(env, principal(), subscriptionInput(), 'Chrome Android');
  assert.equal(saved.subscribed, true);
  assert.equal(DB.calls.length, 2);
  assert.match(DB.calls[1].sql, /INSERT INTO push_subscriptions/);

  const removed = await removePushSubscription(env, principal(), { deviceId: 'device_1234567890abcdef' });
  assert.equal(removed.subscribed, false);
  assert.match(DB.calls.at(-1).sql, /DELETE FROM push_subscriptions/);

  await assert.rejects(() => savePushSubscription(env, { ...principal(), authType: 'recovery' }, subscriptionInput()),
    /verified browser session/i);
});

test('native Android push registration is app-bound and mobile-session-only', async () => {
  const DB = recordingDb();
  const env = { DB, ...FIREBASE_PLACEHOLDER };
  assert.deepEqual(mobilePushConfiguration({}), { available: false, appId: 'com.helixcer.chat' });
  assert.deepEqual(mobilePushConfiguration(env), { available: true, appId: 'com.helixcer.chat' });
  const input = {
    deviceId: 'android_1234567890abcdef',
    appId: 'com.helixcer.chat',
    token: `fcm:test_${'a'.repeat(64)}`
  };
  assert.deepEqual(validateMobilePushDeviceInput(input), input);
  assert.throws(() => validateMobilePushDeviceInput({ ...input, appId: 'com.example.fake' }), /app ID/i);
  assert.throws(() => validateMobilePushDeviceInput({ ...input, token: 'bad token' }), /registration token/i);

  const saved = await saveMobilePushDevice(env, mobilePrincipal(), input);
  assert.deepEqual(saved, { available: true, subscribed: true, deviceId: input.deviceId, appId: input.appId });
  assert.match(DB.calls[1].sql, /INSERT INTO mobile_push_devices/);
  const removed = await removeMobilePushDevice(env, mobilePrincipal(), {
    deviceId: input.deviceId, appId: input.appId
  });
  assert.equal(removed.subscribed, false);
  assert.match(DB.calls.at(-1).sql, /DELETE FROM mobile_push_devices/);
  await assert.rejects(() => saveMobilePushDevice(env, principal(), input), /verified mobile session/i);
  await assert.rejects(() => saveMobilePushDevice(env, mobilePrincipal(), {
    ...input, deviceId: 'android_fedcba0987654321'
  }), /does not match/i);
});

test('native push status safely reports unavailable without Firebase secrets', async () => {
  const deviceId = 'android_1234567890abcdef';
  assert.deepEqual(await mobilePushStatus({}, mobilePrincipal(), deviceId), {
    available: false,
    appId: 'com.helixcer.chat',
    subscribed: false,
    deviceId
  });
  await assert.rejects(() => mobilePushStatus({}, principal(), deviceId), /verified mobile session/i);
});

test('push delivery is a safe no-op until VAPID is configured', async () => {
  assert.deepEqual(await sendWorkspacePush({}, 'ws_test', { title: 'Hello' }), {
    sent: 0, removed: 0, failed: 0, unavailable: true
  });
});

test('push notification targets allow only inbox conversation deep links', () => {
  assert.equal(safePushTarget('/#inbox/conversation_123-ABC'), '/#inbox/conversation_123-ABC');
  assert.equal(safePushTarget('/#inbox'), '/#inbox');
  assert.equal(safePushTarget('//evil.example/#inbox/conversation'), '/#inbox');
  assert.equal(safePushTarget('/#settings'), '/#inbox');
  assert.equal(safePushTarget('/#inbox/conversation%2Fescape'), '/#inbox');
  assert.equal(safePushTarget('/#inbox/' + 'a'.repeat(101)), '/#inbox');
});

test('FCM delivery uses a signed service-account exchange and removes unregistered devices', async () => {
  const keyPair = await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'
  }, true, ['sign', 'verify']);
  const privateDer = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
  const privateBase64 = Buffer.from(privateDer).toString('base64').match(/.{1,64}/g).join('\n');
  const env = {
    FIREBASE_PROJECT_ID: `helixcer-chat-${Date.now()}`,
    FIREBASE_CLIENT_EMAIL: `push-${Date.now()}@helixcer-chat-test.iam.gserviceaccount.com`,
    FIREBASE_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${privateBase64}\n-----END PRIVATE KEY-----`
  };
  const rows = [
    { push_device_id: 'push-1', registration_token: `fcm:one_${'a'.repeat(40)}` },
    { push_device_id: 'push-2', registration_token: `fcm:two_${'b'.repeat(40)}` },
    { push_device_id: 'push-3', registration_token: `fcm:three_${'c'.repeat(40)}` }
  ];
  const calls = [];
  env.DB = {
    prepare(sql) {
      return { bind(...values) { return {
        async all() { calls.push({ type: 'all', sql, values }); return { results: rows }; },
        async run() { calls.push({ type: 'run', sql, values }); return { meta: { changes: 1 } }; }
      }; } };
    }
  };
  let tokenExchanges = 0;
  const sentBodies = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') {
      tokenExchanges++;
      const params = new URLSearchParams(init.body);
      const assertion = params.get('assertion');
      assert.equal(assertion.split('.').length, 3);
      const claims = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString('utf8'));
      assert.equal(claims.iss, env.FIREBASE_CLIENT_EMAIL);
      assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
      assert.match(claims.scope, /firebase\.messaging/);
      return new Response(JSON.stringify({ access_token: 'firebase-access-token', expires_in: 3600 }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }
    assert.equal(url, `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`);
    assert.equal(init.headers.Authorization, 'Bearer firebase-access-token');
    const body = JSON.parse(init.body);
    sentBodies.push(body);
    if (body.message.token === rows[0].registration_token) {
      return new Response(JSON.stringify({ name: 'projects/test/messages/1' }), { status: 200 });
    }
    if (body.message.token === rows[1].registration_token) {
      return new Response(JSON.stringify({
        error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] }
      }), { status: 404 });
    }
    return new Response(JSON.stringify({ error: { status: 'NOT_FOUND', message: 'Project was not found.' } }), {
      status: 404
    });
  };
  const result = await sendWorkspaceMobilePush(env, 'ws_test', {
    title: 'Asha Rao', body: 'Hello from mobile', tag: 'helixcer-conversation-123',
    url: '/#inbox/conversation-123', unreadCount: 7, conversationUnreadCount: 3,
    eventTimestamp: '2026-10-27T12:00:00.000Z'
  }, fetchImpl);
  assert.deepEqual(result, { sent: 1, removed: 1, failed: 1, unavailable: false });
  assert.equal(tokenExchanges, 1);
  assert.equal(sentBodies.length, 3);
  const deviceQuery = calls.find(call => call.type === 'all');
  assert.match(deviceQuery.sql, /JOIN sessions/);
  assert.match(deviceQuery.sql, /revoked_at IS NULL/);
  assert.equal(deviceQuery.values.at(-1), 23,
    'native fanout must leave room under the free-plan external subrequest limit');
  assert.equal(sentBodies[0].message.data.conversationId, 'conversation-123');
  assert.equal(sentBodies[0].message.data.unreadCount, '7');
  assert.equal(sentBodies[0].message.data.conversationUnreadCount, '3');
  assert.equal(sentBodies[0].message.data.eventTimestamp, '2026-10-27T12:00:00.000Z');
  assert.equal(sentBodies[0].message.data.target, 'helixcer://conversation/conversation-123');
  assert.equal(sentBodies[0].message.notification, undefined);
  assert.deepEqual(sentBodies[0].message.android, {
    priority: 'high', ttl: '120s', restricted_package_name: 'com.helixcer.chat'
  });
  assert.ok(calls.some(call => call.type === 'run' && /last_success_at/.test(call.sql)));
  assert.ok(calls.some(call => call.type === 'run' && /last_error_at/.test(call.sql)));
  assert.equal(calls.filter(call => call.type === 'run' && /DELETE FROM mobile_push_devices/.test(call.sql)).length, 1,
    'only the explicit UNREGISTERED response should delete a registration');
  await sendWorkspaceMobilePush(env, 'ws_test', {
    title: 'Asha Rao', body: 'Follow-up', url: '/#inbox/conversation-123'
  }, fetchImpl);
  assert.equal(tokenExchanges, 1, 'the service-account access token should be reused until near expiry');
});

test('conversation-read sync is a silent mobile-only FCM event with authoritative badge counts', async () => {
  const keyPair = await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'
  }, true, ['sign', 'verify']);
  const privateDer = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
  const privateBase64 = Buffer.from(privateDer).toString('base64').match(/.{1,64}/g).join('\n');
  const suffix = crypto.randomUUID().replaceAll('-', '');
  const env = {
    FIREBASE_PROJECT_ID: `helixcer-read-${suffix}`,
    FIREBASE_CLIENT_EMAIL: `push-${suffix}@helixcer-read-test.iam.gserviceaccount.com`,
    FIREBASE_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${privateBase64}\n-----END PRIVATE KEY-----`,
    DB: {
      prepare() {
        return { bind() { return {
          async all() {
            return { results: [{ push_device_id: 'push-read', registration_token: `fcm:read_${'a'.repeat(40)}` }] };
          },
          async run() { return { meta: { changes: 1 } }; }
        }; } };
      }
    }
  };
  let sentBody;
  const fetchImpl = async (input, init = {}) => {
    if (String(input) === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'read-access-token', expires_in: 3600 }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }
    sentBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ name: 'projects/test/messages/read' }), { status: 200 });
  };

  const result = await sendWorkspaceMobileConversationRead(env, 'ws_test', {
    conversationId: 'conversation-123',
    unreadCount: 4,
    readAt: '2026-10-27T12:30:45.000Z'
  }, fetchImpl);

  assert.deepEqual(result, { sent: 1, removed: 0, failed: 0, unavailable: false });
  assert.deepEqual(sentBody.message.data, {
    eventType: 'conversation.read',
    conversationId: 'conversation-123',
    conversationUnreadCount: '0',
    unreadCount: '4',
    readAt: '2026-10-27T12:30:45.000Z',
    target: 'helixcer://conversation/conversation-123'
  });
  assert.equal(sentBody.message.notification, undefined);
  assert.equal(Object.hasOwn(sentBody.message.data, 'title'), false);
  assert.equal(Object.hasOwn(sentBody.message.data, 'body'), false);
  assert.deepEqual(sentBody.message.android, {
    priority: 'high', ttl: '120s', restricted_package_name: 'com.helixcer.chat'
  });
  await assert.rejects(() => sendWorkspaceMobileConversationRead(env, 'ws_test', {
    conversationId: '../other-workspace', unreadCount: 0
  }, fetchImpl), /conversation ID is invalid/i);
});

test('combined notification delivery waits for both backends when one rejects', async () => {
  const env = {
    DB: {
      prepare(sql) {
        if (/FROM push_subscriptions/.test(sql)) throw new Error('web database unavailable');
        return { bind() { return { async all() { throw new Error('mobile database unavailable'); } }; } };
      }
    },
    VAPID_PUBLIC_KEY: PUBLIC_KEY,
    VAPID_PRIVATE_KEY: PRIVATE_KEY,
    VAPID_SUBJECT: 'mailto:alerts@example.com',
    ...FIREBASE_PLACEHOLDER
  };
  const result = await sendWorkspaceNotifications(env, 'ws_test', { title: 'Hello' });
  assert.deepEqual(result.web, { sent: 0, removed: 0, failed: 1, unavailable: false });
  assert.deepEqual(result.mobile, { sent: 0, removed: 0, failed: 1, unavailable: false });
});
