import { buildPushPayload } from '@block65/webcrypto-web-push';

const MAX_ENDPOINT_LENGTH = 2048;
const MAX_USER_AGENT_LENGTH = 300;
const MAX_SUBSCRIPTIONS_PER_WORKSPACE = 250;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;
const KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

function pushError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function configuredVapid(env) {
  const publicKey = String(env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(env.VAPID_PRIVATE_KEY || '').trim();
  const subject = String(env.VAPID_SUBJECT || '').trim();
  const subjectValid = subject.startsWith('mailto:') || subject.startsWith('https://');
  if (!KEY_PATTERN.test(publicKey) || publicKey.length < 80 || publicKey.length > 140 ||
      !KEY_PATTERN.test(privateKey) || privateKey.length < 40 || privateKey.length > 100 || !subjectValid) {
    return null;
  }
  return { publicKey, privateKey, subject };
}

export function pushConfiguration(env) {
  const vapid = configuredVapid(env);
  return vapid ? { available: true, publicKey: vapid.publicKey } : { available: false, publicKey: '' };
}

function endpointAllowed(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
  const host = url.hostname.toLowerCase();
  return host === 'fcm.googleapis.com' ||
    host === 'updates.push.services.mozilla.com' ||
    host === 'web.push.apple.com' ||
    host.endsWith('.notify.windows.com');
}

export function validatePushSubscriptionInput(input) {
  const deviceId = String(input?.deviceId || '').trim();
  const subscription = input?.subscription && typeof input.subscription === 'object' ? input.subscription : {};
  const endpoint = String(subscription.endpoint || '').trim();
  const p256dh = String(subscription.keys?.p256dh || '').trim();
  const auth = String(subscription.keys?.auth || '').trim();
  const expirationValue = subscription.expirationTime;
  if (!DEVICE_ID_PATTERN.test(deviceId)) throw pushError(400, 'Push device ID is invalid.');
  if (!endpoint || endpoint.length > MAX_ENDPOINT_LENGTH || !endpointAllowed(endpoint)) {
    throw pushError(400, 'Push subscription endpoint is invalid.');
  }
  if (!KEY_PATTERN.test(p256dh) || p256dh.length < 80 || p256dh.length > 140) {
    throw pushError(400, 'Push subscription public key is invalid.');
  }
  if (!KEY_PATTERN.test(auth) || auth.length < 16 || auth.length > 128) {
    throw pushError(400, 'Push subscription authentication key is invalid.');
  }
  const expirationTime = expirationValue === null || expirationValue === undefined
    ? null
    : Number(expirationValue);
  if (expirationTime !== null && (!Number.isFinite(expirationTime) || expirationTime < 0)) {
    throw pushError(400, 'Push subscription expiry is invalid.');
  }
  return { deviceId, endpoint, p256dh, auth, expirationTime };
}

export async function savePushSubscription(env, principal, input, userAgent = '') {
  if (principal?.authType !== 'session' || !principal.membership?.membershipId) {
    throw pushError(403, 'A verified browser session is required for push notifications.');
  }
  if (!configuredVapid(env)) throw pushError(503, 'Web Push is not configured.');
  const value = validatePushSubscriptionInput(input);
  const now = new Date().toISOString();
  const subscriptionId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM push_subscriptions
      WHERE endpoint=?1 OR (workspace_id=?2 AND membership_id=?3 AND device_id=?4)`)
      .bind(value.endpoint, principal.workspace.workspaceId, principal.membership.membershipId, value.deviceId),
    env.DB.prepare(`INSERT INTO push_subscriptions
        (subscription_id,workspace_id,membership_id,device_id,endpoint,p256dh,auth,expiration_time,user_agent,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)`)
      .bind(subscriptionId, principal.workspace.workspaceId, principal.membership.membershipId,
        value.deviceId, value.endpoint, value.p256dh, value.auth, value.expirationTime,
        String(userAgent || '').slice(0, MAX_USER_AGENT_LENGTH), now)
  ]);
  return { subscribed: true, deviceId: value.deviceId };
}

export async function removePushSubscription(env, principal, input) {
  if (principal?.authType !== 'session' || !principal.membership?.membershipId) {
    throw pushError(403, 'A verified browser session is required for push notifications.');
  }
  const deviceId = String(input?.deviceId || '').trim();
  if (!DEVICE_ID_PATTERN.test(deviceId)) throw pushError(400, 'Push device ID is invalid.');
  await env.DB.prepare(`DELETE FROM push_subscriptions
    WHERE workspace_id=?1 AND membership_id=?2 AND device_id=?3`)
    .bind(principal.workspace.workspaceId, principal.membership.membershipId, deviceId).run();
  return { subscribed: false, deviceId };
}

export function safePushTarget(value) {
  const candidate = String(value || '').trim();
  return /^\/#inbox(?:\/[A-Za-z0-9_-]{1,100})?$/.test(candidate) ? candidate : '/#inbox';
}

function safeNotification(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    title: String(source.title || 'New customer message').slice(0, 120),
    body: String(source.body || 'Open Helixcer Chat to reply.').slice(0, 500),
    tag: String(source.tag || 'helixcer-inbox').slice(0, 128),
    url: safePushTarget(source.url)
  };
}

async function recordPushSuccess(env, subscriptionId, now) {
  await env.DB.prepare(`UPDATE push_subscriptions
    SET last_success_at=?2,last_error_at=NULL,updated_at=?2 WHERE subscription_id=?1`)
    .bind(subscriptionId, now).run();
}

async function recordPushFailure(env, subscriptionId, now) {
  await env.DB.prepare(`UPDATE push_subscriptions
    SET last_error_at=?2,updated_at=?2 WHERE subscription_id=?1`)
    .bind(subscriptionId, now).run();
}

export async function sendWorkspacePush(env, workspaceId, notification = {}) {
  const vapid = configuredVapid(env);
  if (!vapid || !workspaceId) return { sent: 0, removed: 0, failed: 0, unavailable: true };
  const result = await env.DB.prepare(`SELECT p.subscription_id,p.endpoint,p.p256dh,p.auth,p.expiration_time
    FROM push_subscriptions p
    JOIN memberships m ON m.membership_id=p.membership_id AND m.workspace_id=p.workspace_id AND m.status='active'
    WHERE p.workspace_id=?1 ORDER BY p.updated_at DESC LIMIT ?2`)
    .bind(workspaceId, MAX_SUBSCRIPTIONS_PER_WORKSPACE).all();
  const rows = result.results || [];
  const message = { data: safeNotification(notification), options: { ttl: 120, urgency: 'high' } };
  const totals = { sent: 0, removed: 0, failed: 0, unavailable: false };
  await Promise.all(rows.map(async row => {
    const now = new Date().toISOString();
    try {
      const request = await buildPushPayload(message, {
        endpoint: row.endpoint,
        expirationTime: row.expiration_time === null ? null : Number(row.expiration_time),
        keys: { p256dh: row.p256dh, auth: row.auth }
      }, vapid);
      const response = await fetch(row.endpoint, request);
      if (response.ok) {
        totals.sent++;
        await recordPushSuccess(env, row.subscription_id, now);
      } else if (response.status === 404 || response.status === 410) {
        totals.removed++;
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE subscription_id=?1').bind(row.subscription_id).run();
      } else {
        totals.failed++;
        await recordPushFailure(env, row.subscription_id, now);
      }
    } catch {
      totals.failed++;
      await recordPushFailure(env, row.subscription_id, now).catch(() => {});
    }
  }));
  return totals;
}
