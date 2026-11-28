import { metaGraphApiVersion } from './meta-embedded-signup.js';

export const MESSENGER_OAUTH_COOKIE = '__Host-helixcer_msg_oauth';
export const MESSENGER_WEBHOOK_FIELDS = [
  'messages',
  'messaging_postbacks',
  'message_deliveries',
  'message_reads'
];
const FACEBOOK_AUTHORIZE_URL = 'https://www.facebook.com/dialog/oauth';
const FACEBOOK_GRAPH_HOST = 'https://graph.facebook.com';

export function messengerMetaAppId(env) {
  return String(env.META_APP_ID || env.MESSENGER_APP_ID || '').trim();
}

export function messengerMetaAppSecret(env) {
  return String(env.META_APP_SECRET || env.MESSENGER_APP_SECRET || '').trim();
}

export function messengerLoginConfigId(env) {
  return String(env.META_MESSENGER_LOGIN_CONFIG_ID || env.MESSENGER_LOGIN_CONFIG_ID || '').trim();
}

export function messengerLoginConfigured(env) {
  return Boolean(messengerMetaAppId(env) && messengerMetaAppSecret(env) && messengerLoginConfigId(env));
}

export function messengerLoginPublicConfig(env) {
  if (!messengerLoginConfigured(env)) {
    return { available: false, provider: 'facebook_messenger' };
  }
  return {
    available: true,
    provider: 'facebook_messenger',
    appId: messengerMetaAppId(env),
    configId: messengerLoginConfigId(env),
    graphVersion: metaGraphApiVersion(env),
    authMode: 'facebook_login'
  };
}

export function metaMessengerAppVerifyToken(env) {
  return String(env.META_WEBHOOK_VERIFY_TOKEN || '').trim();
}

export function metaMessengerAppWebhookPath() {
  return '/webhooks/facebook-messenger-app';
}

export function metaMessengerAppCallbackUri(origin) {
  return `${String(origin || '').replace(/\/$/, '')}${metaMessengerAppWebhookPath()}`;
}

export function usesSharedMessengerAppWebhook(env, config = {}) {
  const appId = String(config?.appId || '').trim();
  const sharedAppId = messengerMetaAppId(env);
  return Boolean(appId && sharedAppId && appId === sharedAppId);
}

export function requireMessengerLoginConfig(env) {
  if (!messengerLoginConfigured(env)) {
    const error = new Error('Login with Facebook for Messenger is not configured.');
    error.status = 503;
    throw error;
  }
}

export function messengerOAuthRedirectUri(request, env) {
  const explicit = String(
    env.META_MESSENGER_OAUTH_REDIRECT_URI
    || env.MESSENGER_OAUTH_REDIRECT_URI
    || ''
  ).trim();
  if (explicit) return explicit;
  return new URL('/auth/messenger/callback', request.url).toString();
}

export function buildMessengerAuthorizeUrl({ request, env, state }) {
  requireMessengerLoginConfig(env);
  const authorize = new URL(FACEBOOK_AUTHORIZE_URL);
  authorize.searchParams.set('client_id', messengerMetaAppId(env));
  authorize.searchParams.set('config_id', messengerLoginConfigId(env));
  authorize.searchParams.set('redirect_uri', messengerOAuthRedirectUri(request, env));
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('override_default_response_type', 'true');
  authorize.searchParams.set('display', 'popup');
  authorize.searchParams.set('prompt', 'login');
  authorize.searchParams.set('state', state);
  return authorize.toString();
}

export async function exchangeMessengerAuthorizationCode({
  request, env, code, fetchImpl = fetch
}) {
  requireMessengerLoginConfig(env);
  const authorizationCode = String(code || '').replace(/#_+$/, '').trim();
  if (!authorizationCode || authorizationCode.length < 8 || authorizationCode.length > 4096) {
    const error = new Error('Messenger authorization code is invalid.');
    error.status = 400;
    throw error;
  }
  const version = metaGraphApiVersion(env);
  const endpoint = new URL(`${FACEBOOK_GRAPH_HOST}/${encodeURIComponent(version)}/oauth/access_token`);
  endpoint.searchParams.set('client_id', messengerMetaAppId(env));
  endpoint.searchParams.set('client_secret', messengerMetaAppSecret(env));
  endpoint.searchParams.set('redirect_uri', messengerOAuthRedirectUri(request, env));
  endpoint.searchParams.set('code', authorizationCode);
  const response = await fetchImpl(endpoint.toString(), { method: 'GET' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const error = new Error(messengerLoginErrorMessage(payload, response.status,
      'Meta could not exchange the Messenger login code.'));
    error.status = 422;
    throw error;
  }
  return {
    accessToken: String(payload.access_token || ''),
    tokenType: String(payload.token_type || 'bearer'),
    expiresIn: Number(payload.expires_in) || 0
  };
}

export async function fetchMessengerPages(env, accessToken, fetchImpl = fetch) {
  const token = String(accessToken || '').trim();
  if (!token) {
    const error = new Error('Messenger access token is missing.');
    error.status = 400;
    throw error;
  }
  const version = metaGraphApiVersion(env);
  const endpoint = new URL(`${FACEBOOK_GRAPH_HOST}/${encodeURIComponent(version)}/me/accounts`);
  endpoint.searchParams.set('fields', 'id,name,access_token');
  endpoint.searchParams.set('limit', '100');
  const response = await fetchImpl(endpoint.toString(), {
    headers: { Authorization: `Bearer ${token}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(messengerLoginErrorMessage(payload, response.status,
      'Meta could not list Facebook Pages for this login.'));
    error.status = 422;
    throw error;
  }
  return (Array.isArray(payload.data) ? payload.data : [])
    .map((row) => ({
      pageId: String(row?.id || '').trim(),
      pageName: String(row?.name || '').trim(),
      accessToken: String(row?.access_token || '').trim()
    }))
    .filter((row) => /^\d{5,40}$/.test(row.pageId) && row.accessToken);
}

export async function fetchMessengerLoginProfile(env, accessToken, {
  preferredPageId = '',
  fetchImpl = fetch
} = {}) {
  const pages = await fetchMessengerPages(env, accessToken, fetchImpl);
  if (!pages.length) {
    const error = new Error('No Facebook Page with messaging access was shared with Helixcer.');
    error.status = 422;
    throw error;
  }
  const preferred = String(preferredPageId || '').trim();
  const primary = preferred
    ? (pages.find((page) => page.pageId === preferred) || null)
    : pages[0];
  if (!primary) {
    const error = new Error('The previously connected Facebook Page was not included in this Facebook login.');
    error.status = 422;
    throw error;
  }
  return {
    pageId: primary.pageId,
    pageName: primary.pageName,
    accessToken: primary.accessToken,
    pages
  };
}

export async function subscribeMessengerPageWebhooks({
  env,
  accessToken,
  pageId,
  apiVersion = '',
  fetchImpl = fetch
}) {
  const id = String(pageId || '').trim();
  if (!/^\d{5,40}$/.test(id)) {
    const error = new Error('Facebook Page ID is invalid.');
    error.status = 400;
    throw error;
  }
  const token = String(accessToken || '').trim();
  if (!token) {
    const error = new Error('Facebook Page access token is missing.');
    error.status = 400;
    throw error;
  }
  const version = String(apiVersion || '').trim() || metaGraphApiVersion(env);
  const endpoint = new URL(
    `${FACEBOOK_GRAPH_HOST}/${encodeURIComponent(version)}/${encodeURIComponent(id)}/subscribed_apps`
  );
  endpoint.searchParams.set('subscribed_fields', MESSENGER_WEBHOOK_FIELDS.join(','));
  const response = await fetchImpl(endpoint.toString(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const error = new Error(messengerLoginErrorMessage(payload, response.status,
      'Meta could not subscribe Helixcer to this Facebook Page.'));
    error.status = 422;
    throw error;
  }
  return { ok: true };
}

export function messengerOAuthCookieHeader(state, maxAgeSeconds = 600) {
  return `${MESSENGER_OAUTH_COOKIE}=${encodeURIComponent(state)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearMessengerOAuthCookieHeader() {
  return `${MESSENGER_OAUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function readMessengerOAuthCookie(request) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== MESSENGER_OAUTH_COOKIE) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return ''; }
  }
  return '';
}

function messengerLoginErrorMessage(payload, status, fallback) {
  const message = String(
    payload?.error_message
    || payload?.error?.error_user_msg
    || payload?.error?.message
    || payload?.error_description
    || payload?.message
    || ''
  ).trim();
  if (message) return message.slice(0, 240);
  return `${fallback} (HTTP ${status}).`;
}
