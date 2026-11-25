const DEFAULT_GRAPH_VERSION = 'v22.0';
const WHATSAPP_WEBHOOK_FIELDS = [
  'messages',
  'message_template_status_update',
  'account_update',
  'smb_message_echoes',
  'history',
  'smb_app_state_sync'
];

export function metaEmbeddedSignupConfigured(env) {
  return Boolean(String(env.META_APP_ID || '').trim()
    && String(env.META_APP_SECRET || '').trim()
    && String(env.META_EMBEDDED_SIGNUP_CONFIG_ID || '').trim());
}

export function metaEmbeddedSignupPublicConfig(env) {
  if (!metaEmbeddedSignupConfigured(env)) {
    return { available: false, provider: 'whatsapp_cloud' };
  }
  return {
    available: true,
    provider: 'whatsapp_cloud',
    appId: String(env.META_APP_ID).trim(),
    configId: String(env.META_EMBEDDED_SIGNUP_CONFIG_ID).trim(),
    graphVersion: metaGraphApiVersion(env)
  };
}

export function requireMetaEmbeddedSignupConfig(env) {
  if (!metaEmbeddedSignupConfigured(env)) {
    const error = new Error('WhatsApp Login with Facebook is not configured.');
    error.status = 503;
    throw error;
  }
}

export function metaGraphApiVersion(env, fallback = DEFAULT_GRAPH_VERSION) {
  const raw = String(env.META_GRAPH_API_VERSION || fallback || DEFAULT_GRAPH_VERSION).trim();
  return /^v\d{1,2}(?:\.\d{1,2})?$/.test(raw) ? raw : DEFAULT_GRAPH_VERSION;
}

export async function exchangeMetaEmbeddedSignupCode(env, code, fetchImpl = fetch) {
  requireMetaEmbeddedSignupConfig(env);
  const token = String(code || '').trim();
  if (!token || token.length < 16 || token.length > 4096) {
    const error = new Error('Meta signup code is invalid.');
    error.status = 400;
    throw error;
  }
  const version = metaGraphApiVersion(env);
  const endpoint = new URL(`https://graph.facebook.com/${encodeURIComponent(version)}/oauth/access_token`);
  endpoint.searchParams.set('client_id', String(env.META_APP_ID).trim());
  endpoint.searchParams.set('client_secret', String(env.META_APP_SECRET).trim());
  endpoint.searchParams.set('code', token);
  const response = await fetchImpl(endpoint.toString(), { method: 'GET' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const error = new Error(metaEmbeddedSignupErrorMessage(payload, response.status,
      'Meta could not exchange the Embedded Signup code.'));
    error.status = 422;
    throw error;
  }
  return {
    accessToken: String(payload.access_token || ''),
    tokenType: String(payload.token_type || 'bearer')
  };
}

export function metaWhatsAppAppVerifyToken(env) {
  const explicit = String(env.META_WEBHOOK_VERIFY_TOKEN || '').trim();
  if (explicit) return explicit;
  const appId = String(env.META_APP_ID || '').trim();
  return appId ? `helixcer-wa-app-${appId}` : '';
}

export function metaWhatsAppAppWebhookPath() {
  return '/webhooks/whatsapp-app';
}

export function metaWhatsAppAppCallbackUri(origin) {
  return `${String(origin || '').replace(/\/$/, '')}${metaWhatsAppAppWebhookPath()}`;
}

export async function ensureWhatsAppAppWebhookSubscription({
  env,
  callbackUri,
  fetchImpl = fetch
}) {
  requireMetaEmbeddedSignupConfig(env);
  const appId = String(env.META_APP_ID).trim();
  const appSecret = String(env.META_APP_SECRET).trim();
  const verifyToken = metaWhatsAppAppVerifyToken(env);
  const version = metaGraphApiVersion(env);
  const endpoint = `https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(appId)}/subscriptions`;
  const body = new URLSearchParams({
    object: 'whatsapp_business_account',
    callback_url: String(callbackUri || ''),
    verify_token: verifyToken,
    fields: WHATSAPP_WEBHOOK_FIELDS.join(','),
    access_token: `${appId}|${appSecret}`
  });
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const message = metaEmbeddedSignupErrorMessage(payload, response.status,
      'Meta could not configure the Helixcer WhatsApp app webhook.');
    const error = new Error(clarifyWhatsAppAppWebhookError(message));
    error.status = 422;
    throw error;
  }
  return { ok: true, callbackUri, verifyToken };
}

export async function subscribeWhatsAppEmbeddedSignupWebhooks({
  env,
  accessToken,
  wabaId,
  callbackUri,
  verifyToken,
  appCallbackUri,
  fetchImpl = fetch
}) {
  // Meta requires an active app-level whatsapp_business_account webhook before
  // per-WABA override_callback_uri succeeds.
  await ensureWhatsAppAppWebhookSubscription({
    env,
    callbackUri: appCallbackUri,
    fetchImpl
  });

  const version = metaGraphApiVersion(env);
  const endpoint = `https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(wabaId)}/subscribed_apps`;

  // Step 1: plain WABA subscribe. Must be a body-less POST — do not send JSON null/undefined.
  await postWhatsAppSubscribedApps({
    endpoint,
    accessToken,
    body: null,
    fetchImpl,
    fallback: 'Meta could not subscribe Helixcer to this WhatsApp account.'
  });

  // Step 2: override callback + explicitly subscribe message webhook fields.
  await postWhatsAppSubscribedApps({
    endpoint,
    accessToken,
    body: {
      override_callback_uri: callbackUri,
      verify_token: verifyToken,
      subscribed_fields: WHATSAPP_WEBHOOK_FIELDS
    },
    fetchImpl,
    fallback: 'Meta could not set Helixcer as the webhook callback for this WhatsApp account.'
  });
  return { ok: true };
}

async function postWhatsAppSubscribedApps({
  endpoint,
  accessToken,
  body,
  fetchImpl,
  fallback
}) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const init = { method: 'POST', headers };
  if (body) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetchImpl(endpoint, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const message = metaEmbeddedSignupErrorMessage(payload, response.status, fallback);
    const error = new Error(clarifyWhatsAppWebhookSubscribeError(message));
    error.status = 422;
    throw error;
  }
  return payload;
}

function clarifyWhatsAppWebhookSubscribeError(message) {
  if (/before override the current callback uri/i.test(message)) {
    return `${message} Helixcer tried to configure the app webhook first; confirm Callback URL https://api.chat.helixcer.com/webhooks/whatsapp-app is reachable, then try Register Webhook again.`;
  }
  return message;
}

function clarifyWhatsAppAppWebhookError(message) {
  if (/callback.?url|verify.?token|could not be validated|unreachable/i.test(message)) {
    return `${message} Ensure https://api.chat.helixcer.com/webhooks/whatsapp-app answers Meta's verification challenge.`;
  }
  return message;
}

export async function registerWhatsAppEmbeddedSignupPhone({
  env,
  accessToken,
  phoneNumberId,
  pin,
  fetchImpl = fetch
}) {
  const version = metaGraphApiVersion(env);
  const endpoint = new URL(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(phoneNumberId)}/register`);
  const response = await fetchImpl(endpoint.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      pin: String(pin)
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const error = new Error(metaEmbeddedSignupErrorMessage(payload, response.status,
      'Meta could not register this WhatsApp phone number.'));
    error.status = 422;
    throw error;
  }
  return { ok: true };
}

export function parseWhatsAppEmbeddedSignupSession(payload = {}) {
  const code = String(payload.code || '').trim();
  const wabaId = String(payload.wabaId || payload.waba_id || '').trim();
  const phoneNumberId = String(payload.phoneNumberId || payload.phone_number_id || '').trim();
  const businessId = String(payload.businessId || payload.business_id || '').trim();
  const event = String(payload.event || 'FINISH').trim().toUpperCase();
  if (!code || code.length < 16 || code.length > 4096) {
    const error = new Error('Meta signup code is invalid.');
    error.status = 400;
    throw error;
  }
  if (!/^\d{5,40}$/.test(wabaId)) {
    const error = new Error('WhatsApp Business Account ID from Meta signup is invalid.');
    error.status = 400;
    throw error;
  }
  if (!/^\d{5,40}$/.test(phoneNumberId)) {
    const error = new Error('WhatsApp phone number ID from Meta signup is invalid.');
    error.status = 400;
    throw error;
  }
  if (businessId && !/^\d{5,40}$/.test(businessId)) {
    const error = new Error('Meta business portfolio ID is invalid.');
    error.status = 400;
    throw error;
  }
  const allowedEvents = new Set([
    'FINISH',
    'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'
  ]);
  if (!allowedEvents.has(event)) {
    const error = new Error('Meta signup did not finish with a usable WhatsApp phone number.');
    error.status = 400;
    throw error;
  }
  return { code, wabaId, phoneNumberId, businessId, event };
}

export function shouldRegisterWhatsAppPhone(event) {
  return !isWhatsAppCoexistenceSignup(event);
}

export function isWhatsAppCoexistenceSignup(event) {
  return String(event || '').toUpperCase() === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING';
}

export async function requestWhatsAppSmbAppData({
  env,
  accessToken,
  phoneNumberId,
  syncType,
  fetchImpl = fetch
}) {
  const type = String(syncType || '').trim();
  if (type !== 'history' && type !== 'smb_app_state_sync') {
    const error = new Error('Unsupported WhatsApp coexistence sync type.');
    error.status = 400;
    throw error;
  }
  const phoneId = String(phoneNumberId || '').trim();
  if (!/^\d{5,40}$/.test(phoneId)) {
    const error = new Error('WhatsApp phone number ID is invalid.');
    error.status = 400;
    throw error;
  }
  const version = metaGraphApiVersion(env);
  const endpoint = `https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(phoneId)}/smb_app_data`;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      sync_type: type
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(metaEmbeddedSignupErrorMessage(payload, response.status,
      type === 'history'
        ? 'Meta could not start WhatsApp Business chat history sync.'
        : 'Meta could not start WhatsApp Business contacts sync.'));
    error.status = 422;
    throw error;
  }
  return {
    ok: true,
    syncType: type,
    requestId: String(payload.request_id || ''),
    messagingProduct: String(payload.messaging_product || 'whatsapp')
  };
}

export function generateWhatsAppTwoStepPin() {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  const value = ((bytes[0] << 16) | (bytes[1] << 8) | bytes[2]) % 1000000;
  return String(value).padStart(6, '0');
}

export function generateWhatsAppVerifyToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function metaEmbeddedSignupErrorMessage(payload, status, fallback) {
  const message = String(
    payload?.error?.error_user_msg
    || payload?.error?.message
    || payload?.error_message
    || payload?.message
    || ''
  ).trim();
  if (message) return message.slice(0, 240);
  return `${fallback} (HTTP ${status}).`;
}
