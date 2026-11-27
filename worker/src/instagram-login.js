import { metaGraphApiVersion } from './meta-embedded-signup.js';

export const INSTAGRAM_OAUTH_COOKIE = '__Host-helixcer_ig_oauth';
/** @deprecated Kept for older Instagram Business Login tests/docs; Unified Login uses config_id. */
export const INSTAGRAM_LOGIN_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages'
];
const FACEBOOK_AUTHORIZE_URL = 'https://www.facebook.com/dialog/oauth';
const FACEBOOK_GRAPH_HOST = 'https://graph.facebook.com';
const INSTAGRAM_GRAPH_HOST = 'https://graph.instagram.com';

export function instagramMetaAppId(env) {
  return String(env.META_APP_ID || env.INSTAGRAM_APP_ID || '').trim();
}

export function instagramMetaAppSecret(env) {
  return String(env.META_APP_SECRET || env.INSTAGRAM_APP_SECRET || '').trim();
}

export function instagramLoginConfigId(env) {
  return String(env.META_INSTAGRAM_LOGIN_CONFIG_ID || env.INSTAGRAM_LOGIN_CONFIG_ID || '').trim();
}

/** @deprecated Prefer instagramMetaAppId for Unified Login. */
export function instagramAppId(env) {
  return instagramMetaAppId(env);
}

/** @deprecated Prefer instagramMetaAppSecret for Unified Login. */
export function instagramAppSecret(env) {
  return instagramMetaAppSecret(env);
}

export function instagramLoginConfigured(env) {
  return Boolean(instagramMetaAppId(env) && instagramMetaAppSecret(env) && instagramLoginConfigId(env));
}

export function instagramLoginPublicConfig(env) {
  if (!instagramLoginConfigured(env)) {
    return { available: false, provider: 'instagram' };
  }
  return {
    available: true,
    provider: 'instagram',
    appId: instagramMetaAppId(env),
    configId: instagramLoginConfigId(env),
    graphVersion: metaGraphApiVersion(env),
    authMode: 'unified_login'
  };
}

export function requireInstagramLoginConfig(env) {
  if (!instagramLoginConfigured(env)) {
    const error = new Error('Login with Instagram is not configured.');
    error.status = 503;
    throw error;
  }
}

export function instagramOAuthRedirectUri(request, env) {
  const explicit = String(
    env.META_INSTAGRAM_OAUTH_REDIRECT_URI
    || env.INSTAGRAM_OAUTH_REDIRECT_URI
    || ''
  ).trim();
  if (explicit) return explicit;
  return new URL('/auth/meta/callback', request.url).toString();
}

export function buildInstagramAuthorizeUrl({ request, env, state }) {
  requireInstagramLoginConfig(env);
  const authorize = new URL(FACEBOOK_AUTHORIZE_URL);
  authorize.searchParams.set('client_id', instagramMetaAppId(env));
  authorize.searchParams.set('config_id', instagramLoginConfigId(env));
  authorize.searchParams.set('redirect_uri', instagramOAuthRedirectUri(request, env));
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('override_default_response_type', 'true');
  authorize.searchParams.set('display', 'popup');
  authorize.searchParams.set('prompt', 'login');
  authorize.searchParams.set('state', state);
  return authorize.toString();
}

export async function exchangeInstagramAuthorizationCode({
  request, env, code, fetchImpl = fetch
}) {
  requireInstagramLoginConfig(env);
  const authorizationCode = String(code || '').replace(/#_+$/, '').trim();
  if (!authorizationCode || authorizationCode.length < 8 || authorizationCode.length > 4096) {
    const error = new Error('Instagram authorization code is invalid.');
    error.status = 400;
    throw error;
  }
  const version = metaGraphApiVersion(env);
  const endpoint = new URL(`${FACEBOOK_GRAPH_HOST}/${encodeURIComponent(version)}/oauth/access_token`);
  endpoint.searchParams.set('client_id', instagramMetaAppId(env));
  endpoint.searchParams.set('client_secret', instagramMetaAppSecret(env));
  endpoint.searchParams.set('redirect_uri', instagramOAuthRedirectUri(request, env));
  endpoint.searchParams.set('code', authorizationCode);
  const response = await fetchImpl(endpoint.toString(), { method: 'GET' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const error = new Error(instagramLoginErrorMessage(payload, response.status,
      'Meta could not exchange the Instagram login code.'));
    error.status = 422;
    throw error;
  }
  return {
    accessToken: String(payload.access_token || ''),
    tokenType: String(payload.token_type || 'bearer'),
    expiresIn: Number(payload.expires_in) || 0
  };
}

export async function fetchUnifiedInstagramAccounts(env, accessToken, fetchImpl = fetch) {
  const token = String(accessToken || '').trim();
  if (!token) {
    const error = new Error('Instagram access token is missing.');
    error.status = 400;
    throw error;
  }
  const version = metaGraphApiVersion(env);
  const endpoint = new URL(
    `${FACEBOOK_GRAPH_HOST}/${encodeURIComponent(version)}/me/assigned_instagram_accounts`
  );
  endpoint.searchParams.set('fields', 'id,username,name');
  const response = await fetchImpl(endpoint.toString(), {
    headers: { Authorization: `Bearer ${token}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(instagramLoginErrorMessage(payload, response.status,
      'Meta could not list Instagram accounts for this login.'));
    error.status = 422;
    throw error;
  }
  const accounts = (Array.isArray(payload.data) ? payload.data : [])
    .map((row) => ({
      userId: String(row?.id || '').trim(),
      username: String(row?.username || '').trim(),
      name: String(row?.name || '').trim()
    }))
    .filter((row) => /^\d{5,40}$/.test(row.userId));
  return accounts;
}

export async function fetchUnifiedInstagramClientBusinessId(env, accessToken, fetchImpl = fetch) {
  const token = String(accessToken || '').trim();
  if (!token) return '';
  const version = metaGraphApiVersion(env);
  const endpoint = new URL(`${FACEBOOK_GRAPH_HOST}/${encodeURIComponent(version)}/me`);
  endpoint.searchParams.set('fields', 'client_business_id');
  const response = await fetchImpl(endpoint.toString(), {
    headers: { Authorization: `Bearer ${token}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return '';
  return String(payload.client_business_id || '').trim();
}

export function instagramGraphApiHost(channelOrAuthMode = '') {
  const authMode = typeof channelOrAuthMode === 'string'
    ? channelOrAuthMode
    : String(channelOrAuthMode?.config?.authMode || channelOrAuthMode?.authMode || '');
  return authMode === 'unified_login' ? FACEBOOK_GRAPH_HOST : INSTAGRAM_GRAPH_HOST;
}

export async function fetchInstagramLoginProfile(env, accessToken, fetchImpl = fetch) {
  const accounts = await fetchUnifiedInstagramAccounts(env, accessToken, fetchImpl);
  if (!accounts.length) {
    const error = new Error('No Instagram professional account was shared with Helixcer.');
    error.status = 422;
    throw error;
  }
  const primary = accounts[0];
  const clientBusinessId = await fetchUnifiedInstagramClientBusinessId(env, accessToken, fetchImpl);
  return {
    userId: primary.userId,
    username: primary.username,
    name: primary.name,
    accountType: '',
    clientBusinessId,
    accounts
  };
}

export function instagramOAuthCookieHeader(state, maxAgeSeconds = 600) {
  return `${INSTAGRAM_OAUTH_COOKIE}=${encodeURIComponent(state)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearInstagramOAuthCookieHeader() {
  return `${INSTAGRAM_OAUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function readInstagramOAuthCookie(request) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== INSTAGRAM_OAUTH_COOKIE) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return ''; }
  }
  return '';
}

function instagramLoginErrorMessage(payload, status, fallback) {
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
