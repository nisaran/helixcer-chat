import { metaGraphApiVersion } from './meta-embedded-signup.js';

export const INSTAGRAM_OAUTH_COOKIE = '__Host-helixcer_ig_oauth';
export const INSTAGRAM_LOGIN_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages'
];
const INSTAGRAM_AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
const INSTAGRAM_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const INSTAGRAM_GRAPH_HOST = 'https://graph.instagram.com';

export function instagramAppId(env) {
  return String(env.INSTAGRAM_APP_ID || env.META_APP_ID || '').trim();
}

export function instagramAppSecret(env) {
  return String(env.INSTAGRAM_APP_SECRET || env.META_APP_SECRET || '').trim();
}

export function instagramLoginConfigured(env) {
  return Boolean(instagramAppId(env) && instagramAppSecret(env));
}

export function instagramLoginPublicConfig(env) {
  if (!instagramLoginConfigured(env)) {
    return { available: false, provider: 'instagram' };
  }
  return {
    available: true,
    provider: 'instagram',
    appId: instagramAppId(env),
    graphVersion: metaGraphApiVersion(env),
    scopes: [...INSTAGRAM_LOGIN_SCOPES]
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
  return String(env.INSTAGRAM_OAUTH_REDIRECT_URI || '').trim()
    || new URL('/auth/instagram/callback', request.url).toString();
}

export function buildInstagramAuthorizeUrl({ request, env, state }) {
  requireInstagramLoginConfig(env);
  const authorize = new URL(INSTAGRAM_AUTHORIZE_URL);
  authorize.searchParams.set('client_id', instagramAppId(env));
  authorize.searchParams.set('redirect_uri', instagramOAuthRedirectUri(request, env));
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('scope', INSTAGRAM_LOGIN_SCOPES.join(','));
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
  const body = new URLSearchParams({
    client_id: instagramAppId(env),
    client_secret: instagramAppSecret(env),
    grant_type: 'authorization_code',
    redirect_uri: instagramOAuthRedirectUri(request, env),
    code: authorizationCode
  });
  const response = await fetchImpl(INSTAGRAM_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const payload = await response.json().catch(() => ({}));
  const tokenPayload = normalizeInstagramTokenPayload(payload);
  if (!response.ok || !tokenPayload.accessToken) {
    const error = new Error(instagramLoginErrorMessage(payload, response.status,
      'Instagram could not exchange the authorization code.'));
    error.status = 422;
    throw error;
  }
  return tokenPayload;
}

export async function exchangeInstagramLongLivedToken(env, shortLivedToken, fetchImpl = fetch) {
  requireInstagramLoginConfig(env);
  const token = String(shortLivedToken || '').trim();
  if (!token) {
    const error = new Error('Instagram access token is missing.');
    error.status = 400;
    throw error;
  }
  const endpoint = new URL(`${INSTAGRAM_GRAPH_HOST}/access_token`);
  endpoint.searchParams.set('grant_type', 'ig_exchange_token');
  endpoint.searchParams.set('client_secret', instagramAppSecret(env));
  endpoint.searchParams.set('access_token', token);
  const response = await fetchImpl(endpoint.toString(), { method: 'GET' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const error = new Error(instagramLoginErrorMessage(payload, response.status,
      'Instagram could not create a long-lived access token.'));
    error.status = 422;
    throw error;
  }
  return {
    accessToken: String(payload.access_token || ''),
    tokenType: String(payload.token_type || 'bearer'),
    expiresIn: Number(payload.expires_in) || 0
  };
}

export async function fetchInstagramLoginProfile(env, accessToken, fetchImpl = fetch) {
  const token = String(accessToken || '').trim();
  if (!token) {
    const error = new Error('Instagram access token is missing.');
    error.status = 400;
    throw error;
  }
  const version = metaGraphApiVersion(env);
  const endpoint = new URL(`${INSTAGRAM_GRAPH_HOST}/${encodeURIComponent(version)}/me`);
  endpoint.searchParams.set('fields', 'user_id,username,account_type,name');
  const response = await fetchImpl(endpoint.toString(), {
    headers: { Authorization: `Bearer ${token}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(instagramLoginErrorMessage(payload, response.status,
      'Instagram could not load the professional account profile.'));
    error.status = 422;
    throw error;
  }
  const userId = String(payload.user_id || payload.id || '').trim();
  if (!/^\d{5,40}$/.test(userId)) {
    const error = new Error('Instagram did not return a professional account ID.');
    error.status = 422;
    throw error;
  }
  return {
    userId,
    username: String(payload.username || '').trim(),
    name: String(payload.name || '').trim(),
    accountType: String(payload.account_type || '').trim()
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

function normalizeInstagramTokenPayload(payload) {
  const row = Array.isArray(payload?.data) ? payload.data[0] : payload;
  if (!row || typeof row !== 'object') {
    return { accessToken: '', userId: '', permissions: [] };
  }
  const permissions = String(row.permissions || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  return {
    accessToken: String(row.access_token || ''),
    userId: String(row.user_id || row.id || ''),
    permissions
  };
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
