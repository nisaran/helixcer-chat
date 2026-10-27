import { buildPushPayload } from '@block65/webcrypto-web-push';

const MAX_ENDPOINT_LENGTH = 2048;
const MAX_USER_AGENT_LENGTH = 300;
// Cloudflare's free plan permits 50 external subrequests per invocation. Keep
// the two delivery backends at 23 sends each so an FCM OAuth exchange and the
// realtime Durable Object broadcast still fit with a small safety margin.
const MAX_DELIVERIES_PER_PUSH_BACKEND = 23;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;
const KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
const ANDROID_APP_ID = 'com.helixcer.chat';
const MAX_FCM_TOKEN_LENGTH = 4096;
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const fcmAccessTokenCache = new Map();

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

function configuredFirebase(env) {
  const projectId = String(env.FIREBASE_PROJECT_ID || '').trim();
  const clientEmail = String(env.FIREBASE_CLIENT_EMAIL || '').trim().toLowerCase();
  const privateKey = String(env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  if (!/^[a-z0-9][a-z0-9-]{4,62}$/.test(projectId) ||
      !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(clientEmail) ||
      !/^-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----$/.test(privateKey)) {
    return null;
  }
  return { projectId, clientEmail, privateKey };
}

export function pushConfiguration(env) {
  const vapid = configuredVapid(env);
  return vapid ? { available: true, publicKey: vapid.publicKey } : { available: false, publicKey: '' };
}

export function mobilePushConfiguration(env) {
  return { available: Boolean(configuredFirebase(env)), appId: ANDROID_APP_ID };
}

export async function mobilePushStatus(env, principal, deviceIdValue = '') {
  if (principal?.authType !== 'mobile_session' || !principal.membership?.membershipId || !principal.sessionId) {
    throw pushError(403, 'A verified mobile session is required for native push notifications.');
  }
  const configuration = mobilePushConfiguration(env);
  const deviceId = String(deviceIdValue || '').trim();
  if (!deviceId) return { ...configuration, subscribed: false, deviceId: '' };
  if (!DEVICE_ID_PATTERN.test(deviceId)) throw pushError(400, 'Push device ID is invalid.');
  if (deviceId !== principal.deviceId) throw pushError(403, 'Push device ID does not match this mobile session.');
  if (!configuration.available) return { ...configuration, subscribed: false, deviceId };
  const row = await env.DB.prepare(`SELECT 1 AS subscribed FROM mobile_push_devices
    WHERE workspace_id=?1 AND membership_id=?2 AND session_id=?3 AND device_id=?4 AND app_id=?5 LIMIT 1`)
    .bind(principal.workspace.workspaceId, principal.membership.membershipId, principal.sessionId,
      deviceId, ANDROID_APP_ID).first();
  return { ...configuration, subscribed: Boolean(row), deviceId };
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

export function validateMobilePushDeviceInput(input) {
  const deviceId = String(input?.deviceId || '').trim();
  const appId = String(input?.appId || '').trim();
  const token = String(input?.token || '').trim();
  if (!DEVICE_ID_PATTERN.test(deviceId)) throw pushError(400, 'Push device ID is invalid.');
  if (appId !== ANDROID_APP_ID) throw pushError(400, 'Android app ID is invalid.');
  if (token.length < 20 || token.length > MAX_FCM_TOKEN_LENGTH || !/^[A-Za-z0-9:_-]+$/.test(token)) {
    throw pushError(400, 'FCM registration token is invalid.');
  }
  return { deviceId, appId, token };
}

export async function saveMobilePushDevice(env, principal, input) {
  if (principal?.authType !== 'mobile_session' || !principal.membership?.membershipId || !principal.sessionId) {
    throw pushError(403, 'A verified mobile session is required for native push notifications.');
  }
  if (!configuredFirebase(env)) throw pushError(503, 'Native Android push is not configured.');
  const value = validateMobilePushDeviceInput(input);
  if (value.deviceId !== principal.deviceId) throw pushError(403, 'Push device ID does not match this mobile session.');
  const now = new Date().toISOString();
  const pushDeviceId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM mobile_push_devices
      WHERE registration_token=?1 OR (workspace_id=?2 AND membership_id=?3 AND device_id=?4)`)
      .bind(value.token, principal.workspace.workspaceId, principal.membership.membershipId, value.deviceId),
    env.DB.prepare(`INSERT INTO mobile_push_devices
        (push_device_id,workspace_id,membership_id,session_id,device_id,app_id,platform,registration_token,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,'android',?7,?8,?8)`)
      .bind(pushDeviceId, principal.workspace.workspaceId, principal.membership.membershipId,
        principal.sessionId, value.deviceId, value.appId, value.token, now)
  ]);
  return { available: true, subscribed: true, deviceId: value.deviceId, appId: value.appId };
}

export async function removeMobilePushDevice(env, principal, input) {
  if (principal?.authType !== 'mobile_session' || !principal.membership?.membershipId || !principal.sessionId) {
    throw pushError(403, 'A verified mobile session is required for native push notifications.');
  }
  const deviceId = String(input?.deviceId || '').trim();
  const appId = String(input?.appId || ANDROID_APP_ID).trim();
  if (!DEVICE_ID_PATTERN.test(deviceId)) throw pushError(400, 'Push device ID is invalid.');
  if (appId !== ANDROID_APP_ID) throw pushError(400, 'Android app ID is invalid.');
  if (deviceId !== principal.deviceId) throw pushError(403, 'Push device ID does not match this mobile session.');
  await env.DB.prepare(`DELETE FROM mobile_push_devices
    WHERE workspace_id=?1 AND membership_id=?2 AND session_id=?3 AND device_id=?4 AND app_id=?5`)
    .bind(principal.workspace.workspaceId, principal.membership.membershipId, principal.sessionId, deviceId, appId).run();
  return { available: Boolean(configuredFirebase(env)), subscribed: false, deviceId, appId };
}

export function safePushTarget(value) {
  const candidate = String(value || '').trim();
  return /^\/#inbox(?:\/[A-Za-z0-9_-]{1,100})?$/.test(candidate) ? candidate : '/#inbox';
}

function safeNotification(value) {
  const source = value && typeof value === 'object' ? value : {};
  const unreadCount = safeBadgeCount(source.unreadCount);
  const conversationUnreadCount = safeBadgeCount(source.conversationUnreadCount);
  const eventTimestamp = safeEventTimestamp(source.eventTimestamp);
  return {
    title: String(source.title || 'New customer message').slice(0, 120),
    body: String(source.body || 'Open Helixcer Chat to reply.').slice(0, 500),
    tag: String(source.tag || 'helixcer-inbox').slice(0, 128),
    url: safePushTarget(source.url),
    unreadCount: String(unreadCount),
    conversationUnreadCount: String(conversationUnreadCount),
    ...(eventTimestamp ? { eventTimestamp } : {})
  };
}

function safeEventTimestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function safeBadgeCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(9999, Math.floor(count));
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

async function recordMobilePushSuccess(env, pushDeviceId, now) {
  await env.DB.prepare(`UPDATE mobile_push_devices
    SET last_success_at=?2,last_error_at=NULL,updated_at=?2 WHERE push_device_id=?1`)
    .bind(pushDeviceId, now).run();
}

async function recordMobilePushFailure(env, pushDeviceId, now) {
  await env.DB.prepare(`UPDATE mobile_push_devices
    SET last_error_at=?2,updated_at=?2 WHERE push_device_id=?1`)
    .bind(pushDeviceId, now).run();
}

export async function sendWorkspacePush(env, workspaceId, notification = {}) {
  const vapid = configuredVapid(env);
  if (!vapid || !workspaceId) return { sent: 0, removed: 0, failed: 0, unavailable: true };
  const result = await env.DB.prepare(`SELECT p.subscription_id,p.endpoint,p.p256dh,p.auth,p.expiration_time
    FROM push_subscriptions p
    JOIN memberships m ON m.membership_id=p.membership_id AND m.workspace_id=p.workspace_id AND m.status='active'
    WHERE p.workspace_id=?1 ORDER BY p.updated_at DESC LIMIT ?2`)
    .bind(workspaceId, MAX_DELIVERIES_PER_PUSH_BACKEND).all();
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

export async function sendWorkspaceMobilePush(env, workspaceId, notification = {}, fetchImpl = fetch) {
  const safe = safeNotification(notification);
  const conversationId = notificationConversationId(safe.url);
  return sendWorkspaceMobileData(env, workspaceId, {
    title: safe.title,
    body: safe.body,
    tag: safe.tag,
    conversationId,
    unreadCount: safe.unreadCount,
    conversationUnreadCount: safe.conversationUnreadCount,
    ...(safe.eventTimestamp ? { eventTimestamp: safe.eventTimestamp } : {}),
    target: conversationId ? `helixcer://conversation/${conversationId}` : 'helixcer://inbox'
  }, fetchImpl);
}

/**
 * Sends a data-only state event to native Android clients after another client
 * has read a conversation. Android handles this event without displaying a new
 * alert and removes the matching conversation notification and badge state.
 */
export async function sendWorkspaceMobileConversationRead(env, workspaceId, state = {}, fetchImpl = fetch) {
  const conversationId = safeConversationId(state.conversationId);
  if (!conversationId) throw pushError(400, 'Conversation ID is invalid.');
  const readAt = String(state.readAt || '').trim();
  return sendWorkspaceMobileData(env, workspaceId, {
    eventType: 'conversation.read',
    conversationId,
    conversationUnreadCount: '0',
    unreadCount: String(safeBadgeCount(state.unreadCount)),
    readAt: readAt.slice(0, 40),
    target: `helixcer://conversation/${conversationId}`
  }, fetchImpl);
}

async function sendWorkspaceMobileData(env, workspaceId, data, fetchImpl) {
  const firebase = configuredFirebase(env);
  if (!firebase || !workspaceId) return { sent: 0, removed: 0, failed: 0, unavailable: true };
  const result = await env.DB.prepare(`SELECT p.push_device_id,p.registration_token
    FROM mobile_push_devices p
    JOIN memberships m ON m.membership_id=p.membership_id AND m.workspace_id=p.workspace_id AND m.status='active'
    JOIN sessions s ON s.session_id=p.session_id AND s.user_id=m.user_id AND s.workspace_id=p.workspace_id
      AND s.session_type='mobile' AND s.revoked_at IS NULL AND s.expires_at>?3
    WHERE p.workspace_id=?1 AND p.app_id=?2 AND p.platform='android'
    ORDER BY p.updated_at DESC LIMIT ?4`)
    .bind(workspaceId, ANDROID_APP_ID, new Date().toISOString(), MAX_DELIVERIES_PER_PUSH_BACKEND).all();
  const rows = result.results || [];
  if (!rows.length) return { sent: 0, removed: 0, failed: 0, unavailable: false };
  const accessToken = await firebaseAccessToken(firebase, fetchImpl);
  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(firebase.projectId)}/messages:send`;
  const totals = { sent: 0, removed: 0, failed: 0, unavailable: false };
  await Promise.all(rows.map(async row => {
    const now = new Date().toISOString();
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ message: {
          token: row.registration_token,
          data,
          android: { priority: 'high', ttl: '120s', restricted_package_name: ANDROID_APP_ID }
        } })
      });
      if (response.ok) {
        totals.sent++;
        await recordMobilePushSuccess(env, row.push_device_id, now);
        return;
      }
      const failureBody = await response.json().catch(() => ({}));
      const errorCodes = Array.isArray(failureBody?.error?.details)
        ? failureBody.error.details.map(detail => detail?.errorCode).filter(Boolean)
        : [];
      if (errorCodes.includes('UNREGISTERED')) {
        totals.removed++;
        await env.DB.prepare('DELETE FROM mobile_push_devices WHERE push_device_id=?1').bind(row.push_device_id).run();
      } else {
        totals.failed++;
        await recordMobilePushFailure(env, row.push_device_id, now);
      }
    } catch {
      totals.failed++;
      await recordMobilePushFailure(env, row.push_device_id, now).catch(() => {});
    }
  }));
  return totals;
}

export async function sendWorkspaceNotifications(env, workspaceId, notification = {}) {
  const [webResult, mobileResult] = await Promise.allSettled([
    sendWorkspacePush(env, workspaceId, notification),
    sendWorkspaceMobilePush(env, workspaceId, notification)
  ]);
  const failed = { sent: 0, removed: 0, failed: 1, unavailable: false };
  return {
    web: webResult.status === 'fulfilled' ? webResult.value : failed,
    mobile: mobileResult.status === 'fulfilled' ? mobileResult.value : failed
  };
}

async function firebaseAccessToken(firebase, fetchImpl) {
  const cacheKey = `${firebase.projectId}:${firebase.clientEmail}`;
  const cached = fcmAccessTokenCache.get(cacheKey);
  if (cached?.expiresAt > Date.now() + 60000) return cached.token;
  const assertion = await serviceAccountAssertion(firebase);
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const payload = await response.json().catch(() => ({}));
  const token = String(payload.access_token || '');
  const expiresIn = Number(payload.expires_in || 0);
  if (!response.ok || !token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw pushError(503, 'Firebase access token exchange failed.');
  }
  fcmAccessTokenCache.set(cacheKey, {
    token,
    expiresAt: Date.now() + Math.min(expiresIn, 3600) * 1000
  });
  return token;
}

async function serviceAccountAssertion(firebase) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' });
  const claims = base64UrlJson({
    iss: firebase.clientEmail,
    sub: firebase.clientEmail,
    scope: FCM_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600
  });
  const signingInput = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemPrivateKeyBytes(firebase.privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64UrlBytes(new Uint8Array(signature))}`;
}

function pemPrivateKeyBytes(value) {
  const body = String(value || '')
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  if (!body || !/^[A-Za-z0-9+/=]+$/.test(body)) throw pushError(503, 'Firebase private key is invalid.');
  return Uint8Array.from(atob(body), character => character.charCodeAt(0));
}

function base64UrlJson(value) {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlBytes(value) {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function notificationConversationId(url) {
  const match = String(url || '').match(/^\/#inbox\/([A-Za-z0-9_-]{1,100})$/);
  return match ? match[1] : '';
}

function safeConversationId(value) {
  const candidate = String(value || '').trim();
  return /^[A-Za-z0-9_-]{1,100}$/.test(candidate) ? candidate : '';
}
