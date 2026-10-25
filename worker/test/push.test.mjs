import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pushConfiguration,
  removePushSubscription,
  savePushSubscription,
  sendWorkspacePush,
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

test('push delivery is a safe no-op until VAPID is configured', async () => {
  assert.deepEqual(await sendWorkspacePush({}, 'ws_test', { title: 'Hello' }), {
    sent: 0, removed: 0, failed: 0, unavailable: true
  });
});
