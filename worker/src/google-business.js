export const GOOGLE_BUSINESS_OAUTH_COOKIE = '__Host-helixcer_gbp_oauth';
export const GOOGLE_BUSINESS_SCOPE = 'https://www.googleapis.com/auth/business.manage';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const ACCOUNT_MANAGEMENT_URL = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts';
const BUSINESS_INFORMATION_URL = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const MY_BUSINESS_V4_URL = 'https://mybusiness.googleapis.com/v4';
const encoder = new TextEncoder();

export function googleBusinessRedirectUri(request, env) {
  return env.GOOGLE_BUSINESS_REDIRECT_URI
    || env.GOOGLE_REDIRECT_URI?.replace(/\/auth\/google\/callback\/?$/, '/auth/google-business/callback')
    || new URL('/auth/google-business/callback', request.url).toString();
}

export function requireGoogleBusinessOAuthConfig(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    const error = new Error('Google OAuth is not configured.');
    error.status = 503;
    throw error;
  }
}

export async function buildGoogleBusinessAuthorizeUrl({
  request, env, state, codeVerifier
}) {
  requireGoogleBusinessOAuthConfig(env);
  const authorize = new URL(GOOGLE_AUTH_URL);
  authorize.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', googleBusinessRedirectUri(request, env));
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('scope', GOOGLE_BUSINESS_SCOPE);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', await pkceChallenge(codeVerifier));
  authorize.searchParams.set('code_challenge_method', 'S256');
  authorize.searchParams.set('access_type', 'offline');
  authorize.searchParams.set('include_granted_scopes', 'true');
  authorize.searchParams.set('prompt', 'consent select_account');
  return authorize.toString();
}

export async function exchangeGoogleBusinessCode({
  request, env, code, codeVerifier, fetchImpl = fetch
}) {
  requireGoogleBusinessOAuthConfig(env);
  const tokenResponse = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: googleBusinessRedirectUri(request, env),
      grant_type: 'authorization_code',
      code_verifier: codeVerifier
    })
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    const error = new Error('Google Business token exchange failed.');
    error.status = 401;
    throw error;
  }
  return {
    accessToken: String(tokenPayload.access_token || ''),
    refreshToken: String(tokenPayload.refresh_token || ''),
    expiresIn: Number(tokenPayload.expires_in) || 0,
    scope: String(tokenPayload.scope || '')
  };
}

export async function refreshGoogleBusinessToken(env, refreshToken, fetchImpl = fetch) {
  requireGoogleBusinessOAuthConfig(env);
  const token = String(refreshToken || '').trim();
  if (!token) {
    const error = new Error('Google Business refresh token is missing.');
    error.status = 409;
    throw error;
  }
  const tokenResponse = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: token,
      grant_type: 'refresh_token'
    })
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    const error = new Error('Google Business access token could not be refreshed.');
    error.status = 422;
    throw error;
  }
  return {
    accessToken: String(tokenPayload.access_token || ''),
    refreshToken: String(tokenPayload.refresh_token || token),
    expiresIn: Number(tokenPayload.expires_in) || 0
  };
}

export async function fetchGoogleBusinessEmail(accessToken, fetchImpl = fetch) {
  const response = await fetchImpl(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return '';
  return String(payload.email || '').trim().toLowerCase();
}

export async function listGoogleBusinessLocations(accessToken, fetchImpl = fetch) {
  const accounts = await listGoogleBusinessAccounts(accessToken, fetchImpl);
  const locations = [];
  for (const account of accounts) {
    const accountId = account.accountId;
    const pageLocations = await listLocationsForAccount(accessToken, accountId, fetchImpl);
    for (const location of pageLocations) {
      locations.push({
        accountId,
        accountName: account.accountName,
        locationId: location.locationId,
        locationName: location.locationName,
        address: location.address,
        mapsUri: location.mapsUri
      });
    }
  }
  return locations;
}

async function listGoogleBusinessAccounts(accessToken, fetchImpl) {
  const accounts = [];
  let pageToken = '';
  do {
    const endpoint = new URL(ACCOUNT_MANAGEMENT_URL);
    endpoint.searchParams.set('pageSize', '20');
    if (pageToken) endpoint.searchParams.set('pageToken', pageToken);
    const response = await fetchImpl(endpoint, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(googleBusinessErrorMessage(payload, response.status,
        'Google could not list Business Profile accounts.'));
      error.status = 422;
      throw error;
    }
    for (const account of payload.accounts || []) {
      const resource = String(account.name || '');
      const accountId = resource.replace(/^accounts\//, '');
      if (!accountId) continue;
      accounts.push({
        accountId,
        accountName: String(account.accountName || accountId)
      });
    }
    pageToken = String(payload.nextPageToken || '');
  } while (pageToken && accounts.length < 100);
  return accounts;
}

async function listLocationsForAccount(accessToken, accountId, fetchImpl) {
  const locations = [];
  let pageToken = '';
  do {
    const endpoint = new URL(`${BUSINESS_INFORMATION_URL}/accounts/${encodeURIComponent(accountId)}/locations`);
    endpoint.searchParams.set('readMask', 'name,title,storefrontAddress,metadata');
    endpoint.searchParams.set('pageSize', '100');
    if (pageToken) endpoint.searchParams.set('pageToken', pageToken);
    const response = await fetchImpl(endpoint, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(googleBusinessErrorMessage(payload, response.status,
        'Google could not list Business Profile locations.'));
      error.status = 422;
      throw error;
    }
    for (const location of payload.locations || []) {
      const resource = String(location.name || '');
      const match = resource.match(/^accounts\/([^/]+)\/locations\/([^/]+)$/);
      const locationId = match?.[2] || resource.split('/').pop() || '';
      if (!locationId) continue;
      locations.push({
        locationId,
        locationName: String(location.title || locationId),
        address: formatGoogleBusinessAddress(location.storefrontAddress),
        mapsUri: String(location.metadata?.mapsUri || '')
      });
    }
    pageToken = String(payload.nextPageToken || '');
  } while (pageToken && locations.length < 500);
  return locations;
}

export async function verifyGoogleBusinessLocation(accessToken, accountId, locationId, fetchImpl = fetch) {
  const parent = `accounts/${encodeURIComponent(accountId)}/locations/${encodeURIComponent(locationId)}`;
  const endpoint = new URL(`${MY_BUSINESS_V4_URL}/${parent}/reviews`);
  endpoint.searchParams.set('pageSize', '1');
  endpoint.searchParams.set('orderBy', 'updateTime desc');
  const response = await fetchImpl(endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(googleBusinessErrorMessage(payload, response.status,
      'Google could not verify this Business location for reviews.'));
    error.status = 422;
    throw error;
  }
  return {
    ok: true,
    totalReviewCount: Number(payload.totalReviewCount) || (Array.isArray(payload.reviews) ? payload.reviews.length : 0),
    averageRating: Number(payload.averageRating) || 0
  };
}

export function parseGoogleBusinessLocationSelection(payload = {}) {
  const accountId = String(payload.accountId || '').trim();
  const locationId = String(payload.locationId || '').trim();
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(accountId)) {
    const error = new Error('Google Business account ID is invalid.');
    error.status = 400;
    throw error;
  }
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(locationId)) {
    const error = new Error('Google Business location ID is invalid.');
    error.status = 400;
    throw error;
  }
  return { accountId, locationId };
}

export function googleBusinessOAuthCookieHeader(state, maxAgeSeconds = 600) {
  return `${GOOGLE_BUSINESS_OAUTH_COOKIE}=${encodeURIComponent(state)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearGoogleBusinessOAuthCookieHeader() {
  return `${GOOGLE_BUSINESS_OAUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function readGoogleBusinessOAuthCookie(request) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== GOOGLE_BUSINESS_OAUTH_COOKIE) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return ''; }
  }
  return '';
}

function formatGoogleBusinessAddress(address) {
  if (!address || typeof address !== 'object') return '';
  const lines = [
    ...(Array.isArray(address.addressLines) ? address.addressLines : []),
    address.locality,
    address.administrativeArea,
    address.postalCode,
    address.regionCode
  ].map(value => String(value || '').trim()).filter(Boolean);
  return lines.join(', ').slice(0, 240);
}

function googleBusinessErrorMessage(payload, status, fallback) {
  const message = payload?.error?.message || payload?.error_description || payload?.message || '';
  const text = String(message || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  return text ? `${fallback} ${text}` : `${fallback} (HTTP ${status})`;
}

async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
