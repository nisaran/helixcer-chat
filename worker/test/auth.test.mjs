import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import {
  authenticateRequest,
  createGoogleMobileSession,
  createMobileAuthChallenge,
  createInvitation,
  hashToken,
  mobileAuthConfiguration,
  requireRole,
  startGoogleOAuth,
  finishGoogleOAuth,
  finishGoogleOAuthResponse,
  updateMembership,
  validateReturnTo,
  verifyGoogleIdToken
} from '../src/auth.js';
import worker, { encryptChannelCredential, handleRequest } from '../src/index.js';

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

  prepare(sql) {
    return new TestD1Statement(this.database.prepare(sql));
  }

  async batch(statements) {
    this.database.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function withRunFailures(DB, patterns) {
  const wrap = (statement, shouldFail) => ({
    bind(...values) { return wrap(statement.bind(...values), shouldFail); },
    async run() {
      if (shouldFail) throw new Error('Simulated D1 write failure');
      return statement.run();
    },
    first() { return statement.first(); },
    all() { return statement.all(); }
  });
  return {
    prepare(sql) {
      return wrap(DB.prepare(sql), patterns.some(pattern => pattern.test(sql)));
    },
    batch(statements) { return DB.batch(statements); }
  };
}

function withConcurrentConversationMutation(DB, mutate) {
  let injected = false;
  const wrap = (statement, isConversationPatch) => ({
    bind(...values) { return wrap(statement.bind(...values), isConversationPatch); },
    async run() {
      if (isConversationPatch && !injected) {
        injected = true;
        mutate();
      }
      return statement.run();
    },
    first() { return statement.first(); },
    all() { return statement.all(); }
  });
  return {
    prepare(sql) {
      return wrap(DB.prepare(sql), /^UPDATE conversations SET[\s\S]*status=CASE/i.test(sql.trim()));
    },
    batch(statements) { return DB.batch(statements); }
  };
}

function withConcurrentUnreadIncrement(DB, database, conversationId) {
  return withConcurrentConversationMutation(DB, () => {
    database.prepare('UPDATE conversations SET unread_count=unread_count+1 WHERE conversation_id=?').run(conversationId);
  });
}

async function testDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  database.exec(await readFile(new URL('../migrations/0002_identity_and_workspaces.sql', import.meta.url), 'utf8'));
  database.exec(await readFile(new URL('../migrations/0003_whatsapp_channel.sql', import.meta.url), 'utf8'));
  database.exec(await readFile(new URL('../migrations/0004_multichannel_credentials.sql', import.meta.url), 'utf8'));
  database.exec(await readFile(new URL('../migrations/0005_external_template_api.sql', import.meta.url), 'utf8'));
  database.exec(await readFile(new URL('../migrations/0006_contact_profiles.sql', import.meta.url), 'utf8'));
  database.exec(await readFile(new URL('../migrations/0007_conversation_uniqueness.sql', import.meta.url), 'utf8'));
  database.exec(await readFile(new URL('../migrations/0008_push_subscriptions.sql', import.meta.url), 'utf8'));
  database.exec(await readFile(new URL('../migrations/0009_workspace_profile.sql', import.meta.url), 'utf8'));
  database.exec(await readFile(new URL('../migrations/0011_mobile_push_devices.sql', import.meta.url), 'utf8'));
  database.exec(await readFile(new URL('../migrations/0012_contact_identities.sql', import.meta.url), 'utf8'));
  database.exec(await readFile(new URL('../migrations/0013_flat_contact_platform_ids.sql', import.meta.url), 'utf8'));
  database.exec(await readFile(new URL('../migrations/0014_unified_contact_conversations.sql', import.meta.url), 'utf8'));
  database.exec(await readFile(new URL('../migrations/0015_saas_clients.sql', import.meta.url), 'utf8'));
  database.exec(await readFile(new URL('../migrations/0016_internal_slug.sql', import.meta.url), 'utf8'));
  database.exec(await readFile(new URL('../migrations/0017_agent_channel_access.sql', import.meta.url), 'utf8'));
  return { database, DB: new TestD1(database) };
}

function base64Url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return Buffer.from(bytes).toString('base64url');
}

async function signingFixture() {
  const keyPair = await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'
  }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  Object.assign(jwk, { kid: crypto.randomUUID(), alg: 'RS256', use: 'sig' });
  async function sign(payload) {
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: jwk.kid }));
    const body = base64Url(JSON.stringify(payload));
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(`${header}.${body}`));
    return `${header}.${body}.${base64Url(new Uint8Array(signature))}`;
  }
  return { jwk, sign };
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
    BOOTSTRAP_OWNER_EMAIL: 'owner@example.com',
    DEFAULT_WORKSPACE_ID: 'ws_default',
    SESSION_TTL_SECONDS: '3600',
    ...overrides
  };
}

function cookieValue(response, name) {
  const values = response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''];
  const joined = values.join('; ');
  const match = joined.match(new RegExp(`${name}=([^;,]+)`));
  return match ? decodeURIComponent(match[1]) : '';
}

test('return_to accepts only exact configured origins', () => {
  const env = envFor(null);
  assert.equal(validateReturnTo('/inbox', env), 'https://chat.helixcer.com/inbox');
  assert.equal(validateReturnTo('https://chat.helixcer.com/settings', env), 'https://chat.helixcer.com/settings');
  assert.throws(() => validateReturnTo('https://evil.example/inbox', env), /not allowed/);
  assert.throws(() => validateReturnTo('javascript:alert(1)', env), /not allowed|protocol/);
});

test('role hierarchy rejects an agent and accepts admins and owners', () => {
  assert.throws(() => requireRole({ membership: { role: 'agent' } }, 'admin'), /Insufficient/);
  assert.doesNotThrow(() => requireRole({ membership: { role: 'admin' } }, 'admin'));
  assert.doesNotThrow(() => requireRole({ membership: { role: 'owner' } }, 'admin'));
});

test('mobile auth configuration exposes only the public client identity', () => {
  const configured = mobileAuthConfiguration(envFor(null));
  assert.deepEqual(configured, {
    enabled: true,
    googleWebClientId: 'client-id.apps.googleusercontent.com',
    packageName: 'com.helixcer.chat'
  });
  assert.equal(JSON.stringify(configured).includes('client-secret'), false);
});

test('mobile auth configuration route is public and non-cacheable', async () => {
  const response = await handleRequest(new Request('https://api.chat.helixcer.com/auth/mobile/config'), envFor(null));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), {
    enabled: true,
    googleWebClientId: 'client-id.apps.googleusercontent.com',
    packageName: 'com.helixcer.chat'
  });
});

test('Google ID token verification checks signature, issuer, audience, expiry, email and nonce', async () => {
  const fixture = await signingFixture();
  const nonce = 'nonce-value';
  const now = Math.floor(Date.now() / 1000);
  const jwksUrl = `https://jwks.example/${crypto.randomUUID()}`;
  const fetchJwks = async () => new Response(JSON.stringify({ keys: [fixture.jwk] }), {
    status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60' }
  });
  const basePayload = {
    iss: 'https://accounts.google.com', aud: 'client-id.apps.googleusercontent.com',
    sub: 'google-subject', email: 'Owner@Example.com', email_verified: true,
    name: 'Owner', picture: 'https://example.com/avatar.png', nonce, iat: now - 5, exp: now + 300
  };
  const valid = await fixture.sign(basePayload);
  const nonceHash = await hashToken(nonce);
  const identity = await verifyGoogleIdToken(valid, {
    clientId: basePayload.aud, nonceHash, nowSeconds: now, jwksUrl
  }, fetchJwks);
  assert.equal(identity.sub, 'google-subject');
  assert.equal(identity.email, 'owner@example.com');

  const androidPresenter = 'android-client.apps.googleusercontent.com';
  const androidToken = await fixture.sign({ ...basePayload, azp: androidPresenter });
  const androidIdentity = await verifyGoogleIdToken(androidToken, {
    clientId: basePayload.aud,
    authorizedParties: [basePayload.aud, androidPresenter],
    nonceHash, nowSeconds: now, jwksUrl
  }, fetchJwks);
  assert.equal(androidIdentity.sub, 'google-subject');

  const wrongAudience = await fixture.sign({ ...basePayload, aud: 'wrong-client' });
  await assert.rejects(() => verifyGoogleIdToken(wrongAudience, {
    clientId: basePayload.aud, nonceHash, nowSeconds: now, jwksUrl
  }, fetchJwks), /audience/);
  const differentNonceHash = await hashToken('different');
  await assert.rejects(() => verifyGoogleIdToken(valid, {
    clientId: basePayload.aud, nonceHash: differentNonceHash, nowSeconds: now, jwksUrl
  }, fetchJwks), /nonce/);
  const tampered = `${valid.slice(0, valid.lastIndexOf('.') + 1)}${base64Url(new Uint8Array(256))}`;
  await assert.rejects(() => verifyGoogleIdToken(tampered, {
    clientId: basePayload.aud, nonceHash, nowSeconds: now, jwksUrl
  }, fetchJwks), /signature/);

  for (const [changes, expected] of [
    [{ iss: 'https://issuer.example' }, /issuer/],
    [{ exp: now - 60 }, /expired/],
    [{ email_verified: false }, /not verified/],
    [{ iat: now + 301 }, /future/],
    [{ azp: 'another-client' }, /authorized-party/],
    [{ nbf: now + 31 }, /not active/]
  ]) {
    const token = await fixture.sign({ ...basePayload, ...changes });
    await assert.rejects(() => verifyGoogleIdToken(token, {
      clientId: basePayload.aud, nonceHash, nowSeconds: now, jwksUrl
    }, fetchJwks), expected);
  }
});

test('Google signing keys refresh immediately when a new kid appears', async () => {
  const first = await signingFixture();
  const rotated = await signingFixture();
  const nonce = 'rotating-nonce';
  const now = Math.floor(Date.now() / 1000);
  const jwksUrl = `https://jwks.example/${crypto.randomUUID()}`;
  let keys = [first.jwk];
  let fetches = 0;
  const fetchJwks = async () => {
    fetches++;
    return new Response(JSON.stringify({ keys }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=21600' }
    });
  };
  const payload = {
    iss: 'https://accounts.google.com', aud: 'client-id.apps.googleusercontent.com',
    sub: 'google-subject', email: 'owner@example.com', email_verified: true,
    nonce, iat: now - 2, exp: now + 300
  };
  const options = { clientId: payload.aud, nonceHash: await hashToken(nonce), nowSeconds: now, jwksUrl };
  await verifyGoogleIdToken(await first.sign(payload), options, fetchJwks);
  keys = [rotated.jwk];
  await verifyGoogleIdToken(await rotated.sign(payload), options, fetchJwks);
  assert.equal(fetches, 2);
});

async function performGoogleLogin(env, options = {}) {
  const email = options.email || 'owner@example.com';
  const subject = options.subject || 'owner-google-sub';
  const returnTo = options.returnTo || 'https://chat.helixcer.com/inbox';
  const startUrl = new URL('https://api.chat.helixcer.com/auth/google/start');
  startUrl.searchParams.set('return_to', returnTo);
  if (options.invite) startUrl.searchParams.set('invite', options.invite);
  const start = await startGoogleOAuth(new Request(
    startUrl
  ), env);
  assert.equal(start.status, 302);
  const authorize = new URL(start.headers.get('location'));
  assert.equal(authorize.hostname, 'accounts.google.com');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  const state = authorize.searchParams.get('state');
  const nonce = authorize.searchParams.get('nonce');
  assert.equal(cookieValue(start, '__Host-helixcer_oauth'), state);

  const fixture = await signingFixture();
  const now = Math.floor(Date.now() / 1000);
  const idToken = await fixture.sign({
    iss: 'https://accounts.google.com', aud: env.GOOGLE_CLIENT_ID, sub: subject,
    email, email_verified: true, name: options.name || 'Workspace member',
    picture: 'https://example.com/avatar.png', nonce, iat: now - 2, exp: now + 300
  });
  const jwksUrl = `https://jwks.example/${crypto.randomUUID()}`;
  env.GOOGLE_JWKS_URL = jwksUrl;
  const fetchImpl = async input => {
    const target = String(input);
    if (target === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ id_token: idToken }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (target === jwksUrl) {
      return new Response(JSON.stringify({ keys: [fixture.jwk] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };
  const callback = await finishGoogleOAuth(new Request(
    `https://api.chat.helixcer.com/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`,
    { headers: { Cookie: `__Host-helixcer_oauth=${encodeURIComponent(state)}` } }
  ), env, fetchImpl);
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), returnTo);
  const sessionToken = cookieValue(callback, '__Host-helixcer_session');
  assert.ok(sessionToken.length > 30);
  const setCookies = callback.headers.getSetCookie?.().join(' ') || callback.headers.get('set-cookie');
  assert.match(setCookies, /HttpOnly/);
  assert.match(setCookies, /Secure/);
  assert.match(setCookies, /SameSite=Lax/);
  const principal = await authenticateRequest(new Request('https://api.chat.helixcer.com/api/me', {
    headers: { Cookie: `__Host-helixcer_session=${encodeURIComponent(sessionToken)}` }
  }), env);
  return { principal, sessionToken };
}

test('browser OAuth callback redirects failures to the app without exposing provider details', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const start = await startGoogleOAuth(new Request(
    'https://api.chat.helixcer.com/auth/google/start?return_to=https%3A%2F%2Fchat.helixcer.com%2Finbox'
  ), env);
  const authorize = new URL(start.headers.get('location'));
  const state = authorize.searchParams.get('state');
  const callback = await finishGoogleOAuthResponse(new Request(
    `https://api.chat.helixcer.com/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`,
    { headers: { Cookie: `__Host-helixcer_oauth=${encodeURIComponent(state)}` } }
  ), env, async () => {
    throw new Error('upstream-secret-diagnostic');
  });

  assert.equal(callback.status, 302);
  const target = new URL(callback.headers.get('location'));
  assert.equal(target.origin, 'https://chat.helixcer.com');
  assert.equal(target.searchParams.get('auth_error_code'), 'google_sign_in_unavailable');
  assert.match(target.searchParams.get('auth_error'), /temporarily unavailable/i);
  assert.doesNotMatch(target.toString(), /upstream-secret-diagnostic/);
  assert.match(callback.headers.get('set-cookie'), /__Host-helixcer_oauth=;/);
  assert.match(callback.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(database.prepare('SELECT count(*) AS count FROM oauth_states').get().count, 0);
  database.close();
});

test('browser OAuth callback turns invalid state into a retryable sign-in redirect', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const callback = await finishGoogleOAuthResponse(new Request(
    'https://api.chat.helixcer.com/auth/google/callback?code=test-code&state=wrong',
    { headers: { Cookie: '__Host-helixcer_oauth=different' } }
  ), env);

  assert.equal(callback.status, 302);
  const target = new URL(callback.headers.get('location'));
  assert.equal(target.searchParams.get('auth_error_code'), 'invalid_or_expired_sign_in');
  assert.match(target.searchParams.get('auth_error'), /start Google sign-in again/i);
  database.close();
});

function performOwnerLogin(env) {
  return performGoogleLogin(env, { name: 'Primary owner' });
}

async function performGoogleMobileLogin(env, options = {}) {
  const fixture = await signingFixture();
  const now = Math.floor(Date.now() / 1000);
  const deviceId = options.deviceId || 'android_1234567890abcdef';
  const challenge = await createMobileAuthChallenge(env, { deviceId });
  const nonce = challenge.nonce;
  const jwksUrl = `https://jwks.example/${crypto.randomUUID()}`;
  env.GOOGLE_JWKS_URL = jwksUrl;
  const idToken = await fixture.sign({
    iss: 'https://accounts.google.com', aud: env.GOOGLE_CLIENT_ID,
    sub: options.subject || 'owner-google-mobile-sub',
    email: options.email || 'owner@example.com', email_verified: true,
    name: options.name || 'Mobile owner', picture: 'https://example.com/mobile-avatar.png',
    nonce, iat: now - 2, exp: now + 300,
    ...(options.azp ? { azp: options.azp } : {})
  });
  const result = await createGoogleMobileSession(env, {
    idToken, nonce, deviceId, deviceName: options.deviceName || 'Pixel test device',
    ...(options.invite ? { invitationToken: options.invite } : {})
  }, async input => {
    assert.equal(String(input), jwksUrl);
    return new Response(JSON.stringify({ keys: [fixture.jwk] }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60' }
    });
  });
  return { result, idToken, nonce, deviceId };
}

test('mobile Google exchange validates nonce and returns a revocable bearer session', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const { result, idToken, nonce, deviceId } = await performGoogleMobileLogin(env);
  assert.equal(result.ok, true);
  assert.equal(result.tokenType, 'Bearer');
  assert.ok(result.token.length > 30);
  assert.ok(Date.parse(result.expiresAt) > Date.now());
  assert.equal(result.me.user.email, 'owner@example.com');
  assert.equal(result.me.membership.role, 'owner');

  const bearerRequest = new Request('https://api.chat.helixcer.com/api/me', {
    headers: { Authorization: `Bearer ${result.token}` }
  });
  const principal = await authenticateRequest(bearerRequest, env);
  assert.equal(principal.authType, 'mobile_session');
  assert.equal(principal.user.email, 'owner@example.com');
  assert.equal(principal.deviceId, deviceId);
  assert.equal(database.prepare('SELECT session_type FROM sessions WHERE session_id=?').get(principal.sessionId).session_type, 'mobile');

  const mutation = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST',
    headers: { Authorization: `Bearer ${result.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Mobile support', connectorType: 'web_chat', channelId: 'mobile-support' })
  }), env);
  assert.equal(mutation.status, 201);

  Object.assign(env, {
    FIREBASE_PROJECT_ID: 'helixcer-chat-test',
    FIREBASE_CLIENT_EMAIL: 'push-test@helixcer-chat-test.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${'A'.repeat(64)}\n-----END PRIVATE KEY-----`
  });
  const deviceInput = {
    deviceId: 'android_1234567890abcdef', appId: 'com.helixcer.chat',
    token: `fcm:test_${'a'.repeat(64)}`
  };
  const pushRegistration = await handleRequest(new Request('https://api.chat.helixcer.com/api/push/mobile-devices', {
    method: 'POST',
    headers: { Authorization: `Bearer ${result.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(deviceInput)
  }), env);
  assert.equal(pushRegistration.status, 201);
  assert.deepEqual(await pushRegistration.json(), {
    available: true,
    subscribed: true,
    deviceId: deviceInput.deviceId,
    appId: deviceInput.appId
  });
  assert.equal(database.prepare('SELECT count(*) AS count FROM mobile_push_devices').get().count, 1);
  const pushStatus = await handleRequest(new Request(
    `https://api.chat.helixcer.com/api/push/mobile-config?deviceId=${encodeURIComponent(deviceInput.deviceId)}`,
    { headers: { Authorization: `Bearer ${result.token}` } }
  ), env);
  assert.equal(pushStatus.status, 200);
  assert.deepEqual(await pushStatus.json(), {
    available: true,
    appId: deviceInput.appId,
    subscribed: true,
    deviceId: deviceInput.deviceId
  });
  const pushRemoval = await handleRequest(new Request('https://api.chat.helixcer.com/api/push/mobile-devices', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${result.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: deviceInput.deviceId, appId: deviceInput.appId })
  }), env);
  assert.equal(pushRemoval.status, 200);
  assert.deepEqual(await pushRemoval.json(), {
    available: true,
    subscribed: false,
    deviceId: deviceInput.deviceId,
    appId: deviceInput.appId
  });
  assert.equal(database.prepare('SELECT count(*) AS count FROM mobile_push_devices').get().count, 0);
  const disabledStatus = await handleRequest(new Request(
    `https://api.chat.helixcer.com/api/push/mobile-config?deviceId=${encodeURIComponent(deviceInput.deviceId)}`,
    { headers: { Authorization: `Bearer ${result.token}` } }
  ), env);
  assert.equal(disabledStatus.status, 200);
  assert.deepEqual(await disabledStatus.json(), {
    available: true,
    appId: deviceInput.appId,
    subscribed: false,
    deviceId: deviceInput.deviceId
  });

  await assert.rejects(() => createGoogleMobileSession(env, {
    idToken, nonce, deviceId
  }), /challenge|already used/i);

  const pushRegistrationAgain = await handleRequest(new Request('https://api.chat.helixcer.com/api/push/mobile-devices', {
    method: 'POST',
    headers: { Authorization: `Bearer ${result.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(deviceInput)
  }), env);
  assert.equal(pushRegistrationAgain.status, 201);
  assert.equal(database.prepare('SELECT count(*) AS count FROM mobile_push_devices').get().count, 1);

  const logoutResponse = await handleRequest(new Request('https://api.chat.helixcer.com/api/logout', {
    method: 'POST', headers: { Authorization: `Bearer ${result.token}` }
  }), env);
  assert.equal(logoutResponse.status, 200);
  assert.equal(await authenticateRequest(bearerRequest, env), null);
  assert.equal(database.prepare('SELECT count(*) AS count FROM mobile_push_devices').get().count, 0);
  assert.equal(database.prepare("SELECT count(*) AS count FROM audit_log WHERE action='login' AND details_json LIKE '%google_mobile%'").get().count, 1);
  database.close();
});

test('mobile Google exchange rejects missing or malformed nonces before token verification', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  await assert.rejects(() => createGoogleMobileSession(env, { idToken: 'token' }), /nonce/i);
  await assert.rejects(() => createGoogleMobileSession(env, {
    idToken: 'token', nonce: 'short', deviceId: 'android_1234567890abcdef'
  }), /nonce/i);
  database.close();
});

test('OAuth code flow bootstraps only the configured verified owner and creates a server session', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const { principal } = await performOwnerLogin(env);
  assert.equal(principal.user.email, 'owner@example.com');
  assert.equal(principal.membership.role, 'owner');
  assert.equal(principal.workspace.workspaceId, 'ws_default');
  assert.equal(database.prepare('SELECT count(*) AS count FROM memberships').get().count, 1);
  assert.equal(database.prepare('SELECT count(*) AS count FROM sessions WHERE revoked_at IS NULL').get().count, 1);
  const browserSession = database.prepare('SELECT session_type,device_id FROM sessions WHERE revoked_at IS NULL').get();
  assert.equal(browserSession.session_type, 'browser');
  assert.equal(browserSession.device_id, null);
  assert.equal(database.prepare('SELECT count(*) AS count FROM oauth_states').get().count, 0);
  database.close();
});

test('a verified but unconfigured first user is not made owner', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB, { BOOTSTRAP_OWNER_EMAIL: 'someone-else@example.com' });
  await assert.rejects(() => performOwnerLogin(env), /not been invited/);
  assert.equal(database.prepare('SELECT count(*) AS count FROM memberships').get().count, 0);
  assert.equal(database.prepare('SELECT count(*) AS count FROM users').get().count, 0);
  database.close();
});

test('team invitations are hashed and role changes protect the last owner', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const { principal } = await performOwnerLogin(env);
  const invitation = await createInvitation(
    new Request('https://api.chat.helixcer.com/api/team/invitations'), env, principal,
    { email: 'agent@example.com', role: 'agent', return_to: 'https://chat.helixcer.com/team' }
  );
  assert.equal(invitation.invitation.email, 'agent@example.com');
  const rawToken = new URL(invitation.inviteUrl).searchParams.get('invite');
  const stored = database.prepare('SELECT token_hash FROM invitations WHERE invitation_id=?').get(invitation.invitation.invitationId);
  assert.notEqual(stored.token_hash, rawToken);
  assert.equal(stored.token_hash, await hashToken(rawToken));

  await assert.rejects(() => updateMembership(env, principal, principal.membership.membershipId, { role: 'admin' }), /at least one active owner/);

  const now = new Date().toISOString();
  database.prepare(`INSERT INTO users
      (user_id,google_sub,email,display_name,email_verified,last_login_at,created_at,updated_at)
    VALUES ('agent-user','agent-sub','agent@example.com','Agent',1,?,?,?)`).run(now, now, now);
  database.prepare(`INSERT INTO memberships
      (membership_id,workspace_id,user_id,role,status,created_at,updated_at)
    VALUES ('agent-membership','ws_default','agent-user','agent','active',?,?)`).run(now, now);
  const changed = await updateMembership(env, principal, 'agent-membership', { role: 'admin', status: 'active' });
  assert.equal(changed.item.role, 'admin');

  const adminPrincipal = {
    ...principal,
    user: { userId: 'agent-user', email: 'agent@example.com', displayName: 'Agent', avatarUrl: '' },
    membership: { membershipId: 'agent-membership', role: 'admin', status: 'active' }
  };
  await assert.rejects(() => createInvitation(
    new Request('https://api.chat.helixcer.com/api/team/invitations'), env, adminPrincipal,
    { email: 'another@example.com', role: 'admin' }
  ), /Only an owner/);
  await assert.rejects(() => updateMembership(
    env, adminPrincipal, principal.membership.membershipId, { role: 'agent' }
  ), /only enable or disable agents/i);

  database.prepare(`INSERT INTO users
      (user_id,google_sub,email,display_name,email_verified,last_login_at,created_at,updated_at)
    VALUES ('second-agent','second-agent-sub','second@example.com','Second agent',1,?,?,?)`).run(now, now, now);
  database.prepare(`INSERT INTO memberships
      (membership_id,workspace_id,user_id,role,status,created_at,updated_at)
    VALUES ('second-agent-membership','ws_default','second-agent','agent','active',?,?)`).run(now, now);
  const disabled = await updateMembership(env, adminPrincipal, 'second-agent-membership', { status: 'disabled' });
  assert.equal(disabled.item.status, 'disabled');
  await assert.rejects(() => updateMembership(
    env, adminPrincipal, 'second-agent-membership', { role: 'admin', status: 'active' }
  ), /only enable or disable agents/i);

  const promoted = await updateMembership(env, principal, 'agent-membership', { role: 'owner' });
  assert.equal(promoted.item.role, 'owner');
  const demotedOriginal = await updateMembership(env, principal, principal.membership.membershipId, { role: 'admin' });
  assert.equal(demotedOriginal.item.role, 'admin');
  const remainingOwner = { ...adminPrincipal, membership: { ...adminPrincipal.membership, role: 'owner' } };
  await assert.rejects(() => updateMembership(
    env, remainingOwner, 'agent-membership', { role: 'admin' }
  ), /at least one active owner/);
  database.close();
});

test('email-bound invitations accept once, reject invalid states, and can reactivate a disabled member', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const { principal: owner, sessionToken: ownerSession } = await performOwnerLogin(env);

  const channel = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST',
    headers: {
      Cookie: `__Host-helixcer_session=${encodeURIComponent(ownerSession)}`,
      Origin: 'https://chat.helixcer.com',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name: 'Private config', connectorType: 'web_chat', channelId: 'private-config', secretKey: 'PRIVATE' })
  }), env);
  assert.equal(channel.status, 201);

  const created = await createInvitation(
    new Request('https://api.chat.helixcer.com/api/team/invitations'), env, owner,
    { email: 'agent@example.com', role: 'agent', return_to: 'https://chat.helixcer.com/team' }
  );
  const token = new URL(created.inviteUrl).searchParams.get('invite');
  const accepted = await performGoogleLogin(env, {
    email: 'agent@example.com', subject: 'agent-google-sub', invite: token,
    returnTo: 'https://chat.helixcer.com/team'
  });
  assert.equal(accepted.principal.membership.role, 'agent');
  assert.equal(database.prepare('SELECT status FROM invitations WHERE invitation_id=?').get(created.invitation.invitationId).status, 'accepted');
  const agentBootstrap = await handleRequest(new Request('https://api.chat.helixcer.com/api/bootstrap', {
    headers: {
      Cookie: `__Host-helixcer_session=${encodeURIComponent(accepted.sessionToken)}`,
      Origin: 'https://chat.helixcer.com'
    }
  }), env);
  const agentData = await agentBootstrap.json();
  assert.equal(agentData.channels[0].channelId, 'private-config');
  assert.equal(Object.hasOwn(agentData.channels[0], 'config'), false);
  assert.equal(Object.hasOwn(agentData.channels[0], 'secretKey'), false);
  const agentChannels = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    headers: {
      Cookie: `__Host-helixcer_session=${encodeURIComponent(accepted.sessionToken)}`,
      Origin: 'https://chat.helixcer.com'
    }
  }), env);
  assert.equal(agentChannels.status, 403);
  await assert.rejects(() => performGoogleLogin(env, {
    email: 'agent@example.com', subject: 'agent-google-sub', invite: token
  }), /invalid or expired/);

  const wrongEmailInvite = await createInvitation(
    new Request('https://api.chat.helixcer.com/api/team/invitations'), env, owner,
    { email: 'target@example.com', role: 'agent' }
  );
  await assert.rejects(() => performGoogleLogin(env, {
    email: 'wrong@example.com', subject: 'wrong-google-sub',
    invite: new URL(wrongEmailInvite.inviteUrl).searchParams.get('invite')
  }), /invalid or expired/);
  assert.equal(database.prepare("SELECT count(*) AS count FROM users WHERE email='wrong@example.com'").get().count, 0);

  const expiredInvite = await createInvitation(
    new Request('https://api.chat.helixcer.com/api/team/invitations'), env, owner,
    { email: 'late@example.com', role: 'agent' }
  );
  database.prepare("UPDATE invitations SET expires_at='2020-01-01T00:00:00.000Z' WHERE invitation_id=?")
    .run(expiredInvite.invitation.invitationId);
  await assert.rejects(() => performGoogleLogin(env, {
    email: 'late@example.com', subject: 'late-google-sub',
    invite: new URL(expiredInvite.inviteUrl).searchParams.get('invite')
  }), /invalid or expired/);

  const cancelledInvite = await createInvitation(
    new Request('https://api.chat.helixcer.com/api/team/invitations'), env, owner,
    { email: 'cancelled@example.com', role: 'agent' }
  );
  database.prepare("UPDATE invitations SET status='cancelled' WHERE invitation_id=?")
    .run(cancelledInvite.invitation.invitationId);
  await assert.rejects(() => performGoogleLogin(env, {
    email: 'cancelled@example.com', subject: 'cancelled-google-sub',
    invite: new URL(cancelledInvite.inviteUrl).searchParams.get('invite')
  }), /invalid or expired/);

  await updateMembership(env, owner, accepted.principal.membership.membershipId, { status: 'disabled' });
  assert.equal(database.prepare("SELECT count(*) AS count FROM sessions WHERE user_id=? AND revoked_at IS NOT NULL")
    .get(accepted.principal.user.userId).count, 1);
  assert.equal(await authenticateRequest(new Request('https://api.chat.helixcer.com/api/me', {
    headers: { Cookie: `__Host-helixcer_session=${encodeURIComponent(accepted.sessionToken)}` }
  }), env), null);
  const reactivation = await createInvitation(
    new Request('https://api.chat.helixcer.com/api/team/invitations'), env, owner,
    { email: 'agent@example.com', role: 'admin' }
  );
  const reactivated = await performGoogleLogin(env, {
    email: 'agent@example.com', subject: 'agent-google-sub',
    invite: new URL(reactivation.inviteUrl).searchParams.get('invite')
  });
  assert.equal(reactivated.principal.membership.role, 'admin');
  assert.equal(reactivated.principal.membership.status, 'active');
  database.close();
});

test('session-authenticated bootstrap is workspace scoped and returns verified identity', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const { sessionToken } = await performOwnerLogin(env);
  const now = new Date().toISOString();
  database.prepare("INSERT INTO workspaces (workspace_id,slug,name,created_at,updated_at) VALUES ('ws_other','other','Other',?,?)").run(now, now);
  database.prepare(`INSERT INTO channels
      (channel_id,name,connector_type,enabled,capabilities_json,config_json,secret_key,created_at,updated_at,workspace_id)
    VALUES ('default-channel','Default channel','web_chat',1,'["text"]','{}','DEFAULT',?,?, 'ws_default')`).run(now, now);
  database.prepare(`INSERT INTO channels
      (channel_id,name,connector_type,enabled,capabilities_json,config_json,secret_key,created_at,updated_at,workspace_id)
    VALUES ('other-channel','Other channel','web_chat',1,'["text"]','{}','OTHER',?,?, 'ws_other')`).run(now, now);

  const response = await handleRequest(new Request('https://api.chat.helixcer.com/api/bootstrap', {
    headers: {
      Cookie: `__Host-helixcer_session=${encodeURIComponent(sessionToken)}`,
      Origin: 'https://chat.helixcer.com'
    }
  }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), 'true');
  const body = await response.json();
  assert.deepEqual(body.channels.map(channel => channel.channelId), ['default-channel']);
  assert.equal(body.me.user.email, 'owner@example.com');
  assert.equal(body.me.workspace.workspaceId, 'ws_default');
  database.close();
});

test('single workspace profile is readable by members and writable only by admins', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  database.exec(await readFile(new URL('../migrations/0010_workspace_uuid.sql', import.meta.url), 'utf8'));
  const migratedWorkspaceId = database.prepare("SELECT workspace_id FROM workspaces WHERE kind='internal'").get().workspace_id;
  assert.match(migratedWorkspaceId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const { sessionToken } = await performOwnerLogin(env);
  const headers = {
    Cookie: `__Host-helixcer_session=${encodeURIComponent(sessionToken)}`,
    Origin: 'https://chat.helixcer.com'
  };

  const initial = await handleRequest(new Request('https://api.chat.helixcer.com/api/workspace', { headers }), env);
  assert.equal(initial.status, 200);
  const initialBody = await initial.json();
  assert.deepEqual(initialBody, { item: {
    workspaceId: migratedWorkspaceId, displayName: 'Helixcer Chat', registeredName: '', addressLine1: '', addressLine2: '',
    city: '', state: '', postalCode: '', country: '', gstin: '', taxDetails: ''
  } });

  database.prepare("UPDATE memberships SET role='agent' WHERE workspace_id=?").run(migratedWorkspaceId);
  const memberRead = await handleRequest(new Request('https://api.chat.helixcer.com/api/workspace', { headers }), env);
  assert.equal(memberRead.status, 200);
  const memberWrite = await handleRequest(new Request('https://api.chat.helixcer.com/api/workspace', {
    method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: 'Not allowed' })
  }), env);
  assert.equal(memberWrite.status, 403);

  database.prepare("UPDATE memberships SET role='owner' WHERE workspace_id=?").run(migratedWorkspaceId);
  const immutableId = await handleRequest(new Request('https://api.chat.helixcer.com/api/workspace', {
    method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId: crypto.randomUUID() })
  }), env);
  assert.equal(immutableId.status, 400);
  assert.equal(database.prepare("SELECT workspace_id FROM workspaces WHERE kind='internal'").get().workspace_id,
    migratedWorkspaceId);
  const update = await handleRequest(new Request('https://api.chat.helixcer.com/api/workspace', {
    method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: 'Helixcer Operations', registeredName: 'Helixcer Private Limited',
      addressLine1: '42 Market Road', addressLine2: 'Second Floor', city: 'Kochi', state: 'Kerala',
      postalCode: '682001', country: 'India', gstin: '32abcde1234f1z5',
      taxDetails: 'Registered under regular GST scheme.\nInvoices use the registered address.'
    })
  }), env);
  assert.equal(update.status, 200);
  const updated = await update.json();
  assert.equal(updated.item.displayName, 'Helixcer Operations');
  assert.equal(updated.item.workspaceId, migratedWorkspaceId);
  assert.equal(updated.item.registeredName, 'Helixcer Private Limited');
  assert.equal(updated.item.gstin, '32ABCDE1234F1Z5');
  assert.match(updated.item.taxDetails, /\nInvoices/);

  const partial = await handleRequest(new Request('https://api.chat.helixcer.com/api/workspace', {
    method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ city: 'Ernakulam' })
  }), env);
  assert.equal(partial.status, 200);
  const partialBody = await partial.json();
  assert.equal(partialBody.item.city, 'Ernakulam');
  assert.equal(partialBody.item.displayName, 'Helixcer Operations');
  assert.equal(partialBody.item.gstin, '32ABCDE1234F1Z5');
  assert.equal(partialBody.item.workspaceId, migratedWorkspaceId);
  assert.equal(database.prepare("SELECT workspace_id FROM workspaces WHERE kind='internal'").get().workspace_id,
    migratedWorkspaceId);

  const bootstrap = await handleRequest(new Request('https://api.chat.helixcer.com/api/bootstrap', { headers }), env);
  assert.equal(bootstrap.status, 200);
  const bootstrapBody = await bootstrap.json();
  assert.equal(bootstrapBody.workspace.registeredName, 'Helixcer Private Limited');
  assert.equal(bootstrapBody.workspace.workspaceId, migratedWorkspaceId);
  const recovery = await handleRequest(new Request('https://api.chat.helixcer.com/api/workspace', {
    headers: { Authorization: 'Bearer recovery-secret' }
  }), { ...env, RECOVERY_MODE: 'true', ADMIN_TOKEN: 'recovery-secret' });
  assert.equal(recovery.status, 200);
  assert.equal((await recovery.json()).item.workspaceId, migratedWorkspaceId);
  assert.equal(database.prepare("SELECT action FROM audit_log WHERE target_type='workspace'").get().action, 'update');

  const invalidGstin = await handleRequest(new Request('https://api.chat.helixcer.com/api/workspace', {
    method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ gstin: 'invalid' })
  }), env);
  assert.equal(invalidGstin.status, 400);
  database.close();
});

test('cookie writes, logout, and realtime require the exact browser origin', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB, { ADMIN_TOKEN: 'recovery-secret', RECOVERY_MODE: 'true' });
  const { sessionToken } = await performOwnerLogin(env);
  const cookie = `__Host-helixcer_session=${encodeURIComponent(sessionToken)}`;
  const channelBody = JSON.stringify({ name: 'Support', connectorType: 'web_chat', channelId: 'support' });

  for (const origin of [null, 'https://evil.example']) {
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    if (origin) headers.Origin = origin;
    const denied = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
      method: 'POST', headers, body: channelBody
    }), env);
    assert.equal(denied.status, 403);
  }

  const recovery = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST',
    headers: { Authorization: 'Bearer recovery-secret', 'Content-Type': 'application/json' },
    body: channelBody
  }), env);
  assert.equal(recovery.status, 201);
  assert.equal(database.prepare("SELECT secret_key FROM channels WHERE channel_id='support'").get().secret_key, 'CHANNEL_SUPPORT');
  const recoveryInvite = await handleRequest(new Request('https://api.chat.helixcer.com/api/team/invitations', {
    method: 'POST',
    headers: { Authorization: 'Bearer recovery-secret', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'replacement@example.com', role: 'admin' })
  }), env);
  assert.equal(recoveryInvite.status, 201);
  assert.equal(database.prepare("SELECT invited_by_user_id FROM invitations WHERE email='replacement@example.com'").get().invited_by_user_id, null);

  const allowed = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: 'https://chat.helixcer.com', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Sales', connectorType: 'web_chat', channelId: 'sales' })
  }), env);
  assert.equal(allowed.status, 201);

  let forwardedHeaders = null;
  env.INBOX_HUB = {
    idFromName: value => value,
    get: () => ({ fetch: async (_url, init) => {
      forwardedHeaders = new Headers(init.headers);
      return new Response(null, { status: 200 });
    } })
  };
  const missingSocketOrigin = await handleRequest(new Request('https://api.chat.helixcer.com/api/realtime', {
    headers: { Cookie: cookie, Upgrade: 'websocket' }
  }), env);
  assert.equal(missingSocketOrigin.status, 403);
  const socket = await handleRequest(new Request('https://api.chat.helixcer.com/api/realtime', {
    headers: { Cookie: cookie, Origin: 'https://chat.helixcer.com', Upgrade: 'websocket' }
  }), env);
  assert.equal(socket.status, 200);
  assert.ok(forwardedHeaders.get('X-Helixcer-Session-Id'));
  assert.ok(forwardedHeaders.get('X-Helixcer-Membership-Id'));
  assert.ok(forwardedHeaders.get('X-Helixcer-Session-Expires-At'));

  const mobileSocket = await handleRequest(new Request('https://api.chat.helixcer.com/api/realtime', {
    headers: { Authorization: `Bearer ${sessionToken}`, Upgrade: 'websocket' }
  }), env);
  assert.equal(mobileSocket.status, 401);
  const rejectedMobileBrowserOrigin = await handleRequest(new Request('https://api.chat.helixcer.com/api/realtime', {
    headers: { Authorization: `Bearer ${sessionToken}`, Origin: 'https://evil.example', Upgrade: 'websocket' }
  }), env);
  assert.equal(rejectedMobileBrowserOrigin.status, 403);

  const missingLogoutOrigin = await handleRequest(new Request('https://api.chat.helixcer.com/api/logout', {
    method: 'POST', headers: { Cookie: cookie }
  }), env);
  assert.equal(missingLogoutOrigin.status, 403);
  const logoutResponse = await handleRequest(new Request('https://api.chat.helixcer.com/api/logout', {
    method: 'POST', headers: { Cookie: cookie, Origin: 'https://chat.helixcer.com' }
  }), env);
  assert.equal(logoutResponse.status, 200);
  database.close();
});

test('managed channel CRUD encrypts credentials, preserves blank secrets, and keeps responses secret-free', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB, {
    ADMIN_TOKEN: 'recovery-secret', RECOVERY_MODE: 'true',
    CHANNEL_CREDENTIALS_KEY: 'test-channel-master-key-material-'.repeat(2)
  });
  const headers = { Authorization: 'Bearer recovery-secret', 'Content-Type': 'application/json' };
  const accessToken = 'whatsapp-access-token-value-1234567890';
  const created = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST', headers,
    body: JSON.stringify({
      channelId: 'wa-sales', name: 'Sales WhatsApp', connectorType: 'whatsapp_cloud', enabled: true,
      config: { wabaId: '123456789012345', phoneNumberId: '123456789012346', apiVersion: 'v26.0' },
      credentials: { accessToken, appSecret: '1234567890abcdef1234567890abcdef', verifyToken: 'verify-token-value' }
    })
  }), env);
  assert.equal(created.status, 201);
  const channelRow = database.prepare("SELECT connector_type,provider_type,secret_key FROM channels WHERE channel_id='wa-sales'").get();
  assert.equal(channelRow.connector_type, 'whatsapp_cloud');
  assert.equal(channelRow.provider_type, 'whatsapp_cloud');
  assert.equal(channelRow.secret_key, 'DATABASE');
  const storedAccessToken = database.prepare(`SELECT encrypted_value FROM channel_credentials
    WHERE channel_id='wa-sales' AND credential_key='accessToken'`).get().encrypted_value;
  assert.match(storedAccessToken, /^v1\./);
  assert.equal(storedAccessToken.includes(accessToken), false);

  const listedResponse = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    headers: { Authorization: 'Bearer recovery-secret' }
  }), env);
  assert.equal(listedResponse.status, 200);
  const listedRaw = await listedResponse.text();
  assert.equal(listedRaw.includes(accessToken), false);
  const listed = JSON.parse(listedRaw).items.find(item => item.channelId === 'wa-sales');
  assert.equal(listed.config.wabaId, '123456789012345');
  assert.equal(listed.setup.credentialsPresent, true);
  assert.deepEqual(listed.setup.credentialFields, { accessToken: true, verifyToken: true, appSecret: true });

  const verifyTokenResponse = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels/wa-sales/verify-token', {
    headers: { Authorization: 'Bearer recovery-secret' }
  }), env);
  assert.equal(verifyTokenResponse.status, 200);
  assert.equal(verifyTokenResponse.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await verifyTokenResponse.json(), {
    ok: true, channelId: 'wa-sales', verifyToken: 'verify-token-value'
  });
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_log
    WHERE action='read_verify_token' AND target_id='wa-sales'`).get().count, 1);

  const agentSessionToken = 'agent-session-token-that-is-long-enough-for-testing';
  const agentNow = new Date().toISOString();
  database.prepare(`INSERT INTO users
      (user_id,google_sub,email,display_name,email_verified,last_login_at,created_at,updated_at)
    VALUES ('channel-agent','channel-agent-sub','channel-agent@example.com','Channel agent',1,?,?,?)`)
    .run(agentNow, agentNow, agentNow);
  database.prepare(`INSERT INTO memberships
      (membership_id,workspace_id,user_id,role,status,created_at,updated_at)
    VALUES ('channel-agent-membership','ws_default','channel-agent','agent','active',?,?)`)
    .run(agentNow, agentNow);
  database.prepare(`INSERT INTO sessions
      (session_id,token_hash,user_id,workspace_id,expires_at,last_seen_at,created_at)
    VALUES ('channel-agent-session',?,'channel-agent','ws_default',?,?,?)`)
    .run(await hashToken(agentSessionToken), new Date(Date.now() + 3600000).toISOString(), agentNow, agentNow);
  const agentDenied = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels/wa-sales/verify-token', {
    headers: { Cookie: `__Host-helixcer_session=${agentSessionToken}` }
  }), env);
  assert.equal(agentDenied.status, 403);
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_log
    WHERE action='read_verify_token' AND target_id='wa-sales'`).get().count, 1);

  const duplicateWhatsApp = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST', headers,
    body: JSON.stringify({ channelId: 'wa-duplicate', name: 'Duplicate WhatsApp', connectorType: 'whatsapp_cloud',
      config: { wabaId: '999999999999999', phoneNumberId: '123456789012346', apiVersion: 'v26.0' } })
  }), env);
  assert.equal(duplicateWhatsApp.status, 409);

  const unverifiedContact = await handleRequest(new Request('https://api.chat.helixcer.com/api/contacts', {
    method: 'POST', headers,
    body: JSON.stringify({ displayName: 'Not yet', channelId: 'wa-sales', channelProfileId: '+91 98765 43210' })
  }), env);
  assert.equal(unverifiedContact.status, 409);

  const patched = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels/wa-sales', {
    method: 'PATCH', headers,
    body: JSON.stringify({ name: 'Sales WhatsApp updated', connectorType: 'whatsapp_cloud',
      config: { wabaId: '123456789012345', phoneNumberId: '123456789012346', apiVersion: 'v26.0' },
      credentials: { accessToken: '' } })
  }), env);
  assert.equal(patched.status, 200);
  assert.equal(database.prepare(`SELECT encrypted_value FROM channel_credentials
    WHERE channel_id='wa-sales' AND credential_key='accessToken'`).get().encrypted_value, storedAccessToken);

  const instagram = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST', headers,
    body: JSON.stringify({
      channelId: 'instagram-main', name: 'Instagram', connectorType: 'instagram',
      config: { instagramAccountId: '17841400000000000', username: 'helixcer', appId: '123456789012345',
        apiVersion: 'v26.0', authMode: 'instagram_login' },
      credentials: { accessToken: 'instagram-access-token-value-123456',
        appSecret: 'abcdef1234567890abcdef1234567890', verifyToken: 'instagram-verify-token' }
    })
  }), env);
  assert.equal(instagram.status, 201);
  const instagramRow = database.prepare("SELECT connector_type,provider_type FROM channels WHERE channel_id='instagram-main'").get();
  assert.equal(instagramRow.connector_type, 'generic_http');
  assert.equal(instagramRow.provider_type, 'instagram');
  const duplicateInstagram = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST', headers,
    body: JSON.stringify({ channelId: 'instagram-duplicate', name: 'Duplicate Instagram', connectorType: 'instagram',
      config: { instagramAccountId: '17841400000000000', apiVersion: 'v26.0' } })
  }), env);
  assert.equal(duplicateInstagram.status, 409);
  const removed = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels/instagram-main', {
    method: 'DELETE', headers
  }), env);
  assert.equal(removed.status, 200);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM channel_credentials WHERE channel_id='instagram-main'").get().count, 0);
  database.close();
});

test('Meta App Secret rejects access-token-shaped values on save and before provider verification', async () => {
  const { database, DB } = await testDatabase();
  const credentialKey = 'test-channel-master-key-material-'.repeat(2);
  const env = envFor(DB, {
    ADMIN_TOKEN: 'recovery-secret', RECOVERY_MODE: 'true', CHANNEL_CREDENTIALS_KEY: credentialKey
  });
  const headers = { Authorization: 'Bearer recovery-secret', 'Content-Type': 'application/json' };
  const accessTokenShapedSecret = `EAA${'x'.repeat(180)}`;
  const validAppSecret = '1234567890abcdef1234567890abcdef';

  const rejectedWhatsApp = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST', headers,
    body: JSON.stringify({ channelId: 'wa-bad-app-secret', name: 'Bad WhatsApp secret', connectorType: 'whatsapp_cloud',
      config: { wabaId: '223456789012345', phoneNumberId: '223456789012346', apiVersion: 'v26.0' },
      credentials: { accessToken: 'valid-access-token-value-1234567890',
        appSecret: accessTokenShapedSecret, verifyToken: 'verify-token-value' } })
  }), env);
  assert.equal(rejectedWhatsApp.status, 400);
  const rejectedWhatsAppText = await rejectedWhatsApp.text();
  assert.match(JSON.parse(rejectedWhatsAppText).error, /App Settings .+ Basic .+ App Secret/i);
  assert.equal(rejectedWhatsAppText.includes(accessTokenShapedSecret), false);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM channels WHERE channel_id='wa-bad-app-secret'").get().count, 0);

  const rejectedInstagram = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST', headers,
    body: JSON.stringify({ channelId: 'ig-bad-app-secret', name: 'Bad Instagram secret', connectorType: 'instagram',
      config: { instagramAccountId: '27841400000000001', apiVersion: 'v26.0', authMode: 'instagram_login' },
      credentials: { accessToken: 'valid-instagram-access-token-123456',
        appSecret: 's'.repeat(129), verifyToken: 'instagram-verify-token' } })
  }), env);
  assert.equal(rejectedInstagram.status, 400);
  assert.match((await rejectedInstagram.json()).error, /not an access token or Client Token/i);

  const shortEaaSecret = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST', headers,
    body: JSON.stringify({ channelId: 'wa-short-eaa-secret', name: 'Valid short Meta secret', connectorType: 'whatsapp_cloud',
      config: { wabaId: '223456789012347', phoneNumberId: '223456789012348', apiVersion: 'v26.0' },
      credentials: { accessToken: 'valid-access-token-value-1234567890',
        appSecret: `eaa${'1'.repeat(29)}`, verifyToken: 'verify-token-value' } })
  }), env);
  assert.equal(shortEaaSecret.status, 201);

  for (const channel of [
    { channelId: 'wa-stored-bad-secret', connectorType: 'whatsapp_cloud',
      config: { wabaId: '323456789012345', phoneNumberId: '323456789012346', apiVersion: 'v26.0' },
      accessToken: 'valid-access-token-value-1234567890', verifyToken: 'verify-token-value' },
    { channelId: 'ig-stored-bad-secret', connectorType: 'instagram',
      config: { instagramAccountId: '37841400000000001', apiVersion: 'v26.0', authMode: 'instagram_login' },
      accessToken: 'valid-instagram-access-token-123456', verifyToken: 'instagram-verify-token' }
  ]) {
    const created = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
      method: 'POST', headers,
      body: JSON.stringify({ channelId: channel.channelId, name: channel.channelId,
        connectorType: channel.connectorType, config: channel.config,
        credentials: { accessToken: channel.accessToken, appSecret: validAppSecret, verifyToken: channel.verifyToken } })
    }), env);
    assert.equal(created.status, 201);
    const encrypted = await encryptChannelCredential(accessTokenShapedSecret, credentialKey,
      'ws_default', channel.channelId, 'appSecret');
    database.prepare(`UPDATE channel_credentials SET encrypted_value=?1
      WHERE workspace_id='ws_default' AND channel_id=?2 AND credential_key='appSecret'`)
      .run(encrypted, channel.channelId);
  }

  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls++;
    return new Response('{}', { status: 500 });
  };
  try {
    for (const channelId of ['wa-stored-bad-secret', 'ig-stored-bad-secret']) {
      const verified = await handleRequest(new Request(`https://api.chat.helixcer.com/api/channels/${channelId}/verify`, {
        method: 'POST', headers: { Authorization: 'Bearer recovery-secret' }
      }), env);
      assert.equal(verified.status, 422);
      const verifiedText = await verified.text();
      assert.match(JSON.parse(verifiedText).error, /App Settings .+ Basic .+ App Secret/i);
      assert.equal(verifiedText.includes(accessTokenShapedSecret), false);
    }
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('WhatsApp credential patches preserve an independent webhook handshake', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB, {
    ADMIN_TOKEN: 'recovery-secret', RECOVERY_MODE: 'true',
    CHANNEL_CREDENTIALS_KEY: 'test-channel-master-key-material-'.repeat(2)
  });
  const headers = { Authorization: 'Bearer recovery-secret', 'Content-Type': 'application/json' };
  const created = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST', headers,
    body: JSON.stringify({ channelId: 'wa-state', name: 'WhatsApp state', connectorType: 'whatsapp_cloud',
      config: { wabaId: '123456789012345', phoneNumberId: '123456789012346', apiVersion: 'v26.0' },
      credentials: { accessToken: 'original-access-token-value-1234567890',
        appSecret: '1234567890abcdef1234567890abcdef', verifyToken: 'original-verify-token' } })
  }), env);
  assert.equal(created.status, 201);

  const verifiedAt = '2026-10-25T10:00:00.000Z';
  const webhookVerifiedAt = '2026-10-25T10:01:00.000Z';
  const lastWebhookAt = '2026-10-25T10:02:00.000Z';
  const readConfig = () => JSON.parse(database.prepare("SELECT config_json FROM channels WHERE channel_id='wa-state'").get().config_json);
  const seedVerificationState = () => {
    const config = { ...readConfig(), credentialsVerifiedAt: verifiedAt, subscribedAppsAt: verifiedAt,
      webhookVerifiedAt, lastWebhookAt, verifiedPhoneNumber: '+91 98765 43210',
      verifiedName: 'Helixcer', verifiedProviderId: '123456789012346' };
    database.prepare("UPDATE channels SET config_json=? WHERE channel_id='wa-state'").run(JSON.stringify(config));
  };
  seedVerificationState();

  const credentialsPatched = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels/wa-state', {
    method: 'PATCH', headers,
    body: JSON.stringify({ credentials: { accessToken: 'replacement-access-token-value-1234567890',
      appSecret: 'abcdef1234567890abcdef1234567890' } })
  }), env);
  assert.equal(credentialsPatched.status, 200);
  const afterCredentialPatch = readConfig();
  assert.equal(afterCredentialPatch.credentialsVerifiedAt, undefined);
  assert.equal(afterCredentialPatch.subscribedAppsAt, undefined);
  assert.equal(afterCredentialPatch.verifiedProviderId, undefined);
  assert.equal(afterCredentialPatch.webhookVerifiedAt, webhookVerifiedAt);
  assert.equal(afterCredentialPatch.lastWebhookAt, lastWebhookAt);

  seedVerificationState();
  const verifyTokenPatched = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels/wa-state', {
    method: 'PATCH', headers, body: JSON.stringify({ credentials: { verifyToken: 'replacement-verify-token' } })
  }), env);
  assert.equal(verifyTokenPatched.status, 200);
  const afterVerifyTokenPatch = readConfig();
  assert.equal(afterVerifyTokenPatch.webhookVerifiedAt, undefined);
  assert.equal(afterVerifyTokenPatch.credentialsVerifiedAt, verifiedAt);
  assert.equal(afterVerifyTokenPatch.subscribedAppsAt, verifiedAt);
  assert.equal(afterVerifyTokenPatch.verifiedProviderId, '123456789012346');
  assert.equal(afterVerifyTokenPatch.verifiedPhoneNumber, '+91 98765 43210');
  assert.equal(afterVerifyTokenPatch.verifiedName, 'Helixcer');
  assert.equal(afterVerifyTokenPatch.lastWebhookAt, lastWebhookAt);

  seedVerificationState();
  const providerPatched = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels/wa-state', {
    method: 'PATCH', headers, body: JSON.stringify({ config: { phoneNumberId: '123456789012347' } })
  }), env);
  assert.equal(providerPatched.status, 200);
  const afterProviderPatch = readConfig();
  assert.equal(afterProviderPatch.webhookVerifiedAt, undefined);
  assert.equal(afterProviderPatch.lastWebhookAt, undefined);
  database.close();
});

test('routed managed channels lock provider identity and unverified retries fail closed', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB, {
    ADMIN_TOKEN: 'recovery-secret', RECOVERY_MODE: 'true',
    CHANNEL_CREDENTIALS_KEY: 'test-channel-master-key-material-'.repeat(2)
  });
  const headers = { Authorization: 'Bearer recovery-secret', 'Content-Type': 'application/json' };
  const channelId = 'ig-routed-lock';
  const accountId = '17841400000000901';
  const appId = '123456789000901';
  const created = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST', headers,
    body: JSON.stringify({ channelId, name: 'Routed Instagram', connectorType: 'instagram',
      config: { instagramAccountId: accountId, appId, apiVersion: 'v26.0', authMode: 'instagram_login' },
      credentials: { accessToken: 'instagram-original-access-token-123456',
        appSecret: 'abcdef1234567890abcdef1234567890', verifyToken: 'instagram-verify-token' } })
  }), env);
  assert.equal(created.status, 201);
  const now = new Date().toISOString();
  const verifiedConfig = {
    ...JSON.parse(database.prepare('SELECT config_json FROM channels WHERE channel_id=?').get(channelId).config_json),
    credentialsVerifiedAt: now,
    verifiedProviderId: accountId
  };
  database.prepare('UPDATE channels SET config_json=? WHERE channel_id=?').run(JSON.stringify(verifiedConfig), channelId);
  const originalEncryptedToken = database.prepare(`SELECT encrypted_value FROM channel_credentials
    WHERE workspace_id='ws_default' AND channel_id=? AND credential_key='accessToken'`).get(channelId).encrypted_value;
  database.prepare(`INSERT INTO contacts
      (contact_id,display_name,created_at,updated_at,workspace_id)
    VALUES ('ig-routed-contact','Instagram routed contact',?,?,'ws_default')`).run(now, now);
  database.prepare(`INSERT INTO contact_identities
      (identity_id,workspace_id,contact_id,platform,profile_id,display_name,created_at,updated_at)
    VALUES ('ig-routed-identity','ws_default','ig-routed-contact','instagram','ig-canonical-profile',
      'Instagram routed contact',?,?)`).run(now, now);
  database.prepare(`INSERT INTO channel_identity_bindings
      (binding_id,workspace_id,identity_id,channel_id,scoped_profile_id,active,first_seen_at,last_seen_at,created_at,updated_at)
    VALUES ('ig-routed-binding','ws_default','ig-routed-identity',?,'ig-account-scoped-profile',1,?,?,?,?)`)
    .run(channelId, now, now, now, now);
  database.prepare(`INSERT INTO conversations
      (conversation_id,contact_id,channel_id,identity_id,status,subject,last_message_at,unread_count,created_at,updated_at,workspace_id)
    VALUES ('ig-routed-conversation','ig-routed-contact',?,'ig-routed-identity','open','Instagram routed contact',
      ?,0,?,?,'ws_default')`).run(channelId, now, now, now);

  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ id: 'must-not-send' }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    const replacedAccount = await handleRequest(new Request(
      `https://api.chat.helixcer.com/api/channels/${channelId}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ config: { instagramAccountId: '17841400000000902', appId: '123456789000902' },
          credentials: { accessToken: 'instagram-replacement-access-token-123456' } })
      }
    ), env);
    assert.equal(replacedAccount.status, 409);
    assert.match((await replacedAccount.json()).error, /new channel/i);
    const afterRejectedConfig = JSON.parse(database.prepare('SELECT config_json FROM channels WHERE channel_id=?')
      .get(channelId).config_json);
    assert.equal(afterRejectedConfig.instagramAccountId, accountId);
    assert.equal(afterRejectedConfig.appId, appId);
    assert.equal(afterRejectedConfig.verifiedProviderId, accountId);
    assert.equal(database.prepare(`SELECT encrypted_value FROM channel_credentials
      WHERE workspace_id='ws_default' AND channel_id=? AND credential_key='accessToken'`).get(channelId).encrypted_value,
    originalEncryptedToken);

    const credentialOnly = await handleRequest(new Request(
      `https://api.chat.helixcer.com/api/channels/${channelId}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ credentials: { accessToken: 'instagram-rotated-access-token-123456' } })
      }
    ), env);
    assert.equal(credentialOnly.status, 200);
    const afterCredentialChange = JSON.parse(database.prepare('SELECT config_json FROM channels WHERE channel_id=?')
      .get(channelId).config_json);
    assert.equal(afterCredentialChange.credentialsVerifiedAt, undefined);
    assert.equal(afterCredentialChange.verifiedProviderId, undefined);

    database.prepare(`INSERT INTO messages
        (message_id,conversation_id,contact_id,channel_id,identity_id,direction,message_type,text,status,timestamp,workspace_id)
      VALUES ('ig-unverified-retry','ig-routed-conversation','ig-routed-contact',?,'ig-routed-identity',
        'outbound','text','Never send without verification','retrying',?,'ws_default')`).run(channelId, now);
    database.prepare(`INSERT INTO outbox
        (outbox_id,message_id,attempts,max_attempts,next_attempt_at,status,created_at,updated_at,workspace_id)
      VALUES ('ig-unverified-outbox','ig-unverified-retry',0,6,?,'pending',?,?,'ws_default')`)
      .run(new Date(Date.now() - 1000).toISOString(), now, now);
    const scheduled = [];
    worker.scheduled({}, env, { waitUntil(promise) { scheduled.push(promise); } });
    await Promise.all(scheduled);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(providerCalls, 0);
  const failedRetry = database.prepare("SELECT status,error FROM messages WHERE message_id='ig-unverified-retry'").get();
  assert.equal(failedRetry.status, 'failed');
  assert.match(failedRetry.error, /credentials must be verified/i);
  assert.deepEqual({ ...database.prepare(`SELECT status,attempts FROM outbox
    WHERE outbox_id='ig-unverified-outbox'`).get() }, { status: 'failed', attempts: 1 });
  database.close();
});

test('signed WhatsApp webhooks reach the Inbox before Meta API verification', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB, {
    ADMIN_TOKEN: 'recovery-secret', RECOVERY_MODE: 'true',
    CHANNEL_CREDENTIALS_KEY: 'test-channel-master-key-material-'.repeat(2)
  });
  const headers = { Authorization: 'Bearer recovery-secret', 'Content-Type': 'application/json' };
  const channelId = 'wa-inbound-first';
  const phoneNumberId = '123456789012346';
  const appSecret = '1234567890abcdef1234567890abcdef';
  const created = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST', headers,
    body: JSON.stringify({ channelId, name: 'Inbound-first WhatsApp', connectorType: 'whatsapp_cloud', enabled: true,
      config: { wabaId: '123456789012345', phoneNumberId, apiVersion: 'v26.0' },
      credentials: { accessToken: 'unverified-access-token-value-1234567890', appSecret, verifyToken: 'verify-token-value' } })
  }), env);
  assert.equal(created.status, 201);
  const broadcasts = [];
  env.INBOX_HUB = {
    idFromName: value => value,
    get: () => ({ fetch: async (url, init = {}) => {
      if (String(url).endsWith('/broadcast')) broadcasts.push(JSON.parse(init.body));
      return new Response(null, { status: 204 });
    } })
  };
  const before = JSON.parse(database.prepare('SELECT config_json FROM channels WHERE channel_id=?').get(channelId).config_json);
  assert.equal(before.credentialsVerifiedAt, undefined);
  assert.equal(before.webhookVerifiedAt, undefined);

  const payload = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { display_phone_number: '916282010794', phone_number_id: phoneNumberId },
    contacts: [{ profile: { name: 'Asha' }, wa_id: '919999999999' }],
    messages: [{ from: '919999999999', id: 'wamid.inbound-first', timestamp: '1761360000', type: 'text', text: { body: 'Hello Helixcer' } }]
  } }] }] };
  const sign = async value => {
    const raw = JSON.stringify(value);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
    return { raw, signature: `sha256=${Buffer.from(digest).toString('hex')}` };
  };
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls++;
    throw new Error('Webhook delivery must not call the Meta Graph API.');
  };
  try {
    const signed = await sign(payload);
    const delivered = await handleRequest(new Request(`https://api.chat.helixcer.com/webhooks/whatsapp/${channelId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signed.signature }, body: signed.raw
    }), env);
    assert.equal(delivered.status, 200);
    assert.deepEqual(await delivered.json(), { ok: true, received: 1, statuses: 0 });
    assert.equal(providerCalls, 0);

    const conversation = database.prepare(`SELECT conversation_id,status,subject,unread_count FROM conversations
      WHERE channel_id=?`).get(channelId);
    assert.equal(conversation.status, 'open');
    assert.equal(conversation.subject, 'Asha');
    assert.equal(conversation.unread_count, 1);
    const message = database.prepare(`SELECT message_id,identity_id,direction,text,status,provider_message_id FROM messages
      WHERE channel_id=?`).get(channelId);
    assert.ok(message.identity_id);
    assert.equal(message.direction, 'inbound');
    assert.equal(message.text, 'Hello Helixcer');
    assert.equal(message.status, 'received');
    assert.equal(message.provider_message_id, 'wamid.inbound-first');
    const inboundEvent = broadcasts.find(event => event.type === 'message.created' && event.messageId === message.message_id);
    assert.ok(inboundEvent);
    assert.equal(inboundEvent.conversationId, conversation.conversation_id);
    assert.equal(inboundEvent.source, 'webhook');
    assert.deepEqual(inboundEvent.message, {
      messageId: message.message_id,
      conversationId: conversation.conversation_id,
      channelId,
      contactIdentityId: message.identity_id,
      identityId: message.identity_id,
      direction: 'inbound',
      messageType: 'text',
      text: 'Hello Helixcer',
      status: 'received',
      timestamp: new Date(1761360000 * 1000).toISOString(),
      channelMessageId: 'wamid.inbound-first',
      error: '',
      senderName: 'Asha',
      connectorType: 'whatsapp_cloud',
      channelName: 'Inbound-first WhatsApp',
      channelProfileId: '919999999999',
      attachment: null,
      reply: null
    });
    assert.equal(inboundEvent.conversation.conversationId, conversation.conversation_id);
    assert.equal(inboundEvent.conversation.subject, 'Asha');
    assert.equal(inboundEvent.conversation.unreadCount, 1);
    assert.equal(inboundEvent.conversation.lastMessage, 'Hello Helixcer');
    assert.equal(inboundEvent.conversation.connectorType, 'whatsapp_cloud');
    assert.equal(inboundEvent.conversation.channelProfileId, '919999999999');
    const aggregateEvent = broadcasts.find(event => event.type === 'webhook.received');
    assert.ok(aggregateEvent);
    assert.equal(aggregateEvent.granular, true);
    assert.equal(aggregateEvent.received, 1);
    assert.equal(aggregateEvent.statuses, 0);
    assert.ok(broadcasts.indexOf(inboundEvent) < broadcasts.indexOf(aggregateEvent));
    const bootstrapAfterInbound = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/bootstrap', {
        headers: { Authorization: 'Bearer recovery-secret' }
      }), env);
    assert.equal(bootstrapAfterInbound.status, 200);
    const bootstrappedConversation = (await bootstrapAfterInbound.json()).conversations
      .find(item => item.conversationId === conversation.conversation_id);
    assert.equal(bootstrappedConversation.unreadCount, 1);
    const after = JSON.parse(database.prepare('SELECT config_json FROM channels WHERE channel_id=?').get(channelId).config_json);
    assert.ok(after.webhookVerifiedAt);
    assert.ok(after.lastWebhookAt);
    assert.equal(after.credentialsVerifiedAt, undefined);

    const listed = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
      headers: { Authorization: 'Bearer recovery-secret' }
    }), env);
    const listedChannel = (await listed.json()).items.find(item => item.channelId === channelId);
    assert.equal(listedChannel.health, 'receiving');

    const replay = await handleRequest(new Request(`https://api.chat.helixcer.com/webhooks/whatsapp/${channelId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signed.signature }, body: signed.raw
    }), env);
    assert.equal((await replay.json()).received, 0);
    assert.equal(broadcasts.filter(event => event.type === 'message.created').length, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM messages WHERE channel_id=?').get(channelId).count, 1);
    assert.equal(database.prepare('SELECT unread_count FROM conversations WHERE conversation_id=?').get(conversation.conversation_id).unread_count, 1);

    database.prepare("UPDATE conversations SET status='closed',unread_count=0 WHERE conversation_id=?")
      .run(conversation.conversation_id);
    const reopenedPayload = structuredClone(payload);
    reopenedPayload.entry[0].changes[0].value.messages[0] = {
      from: '919999999999', id: 'wamid.inbound-reopens', timestamp: '1761360060', type: 'text',
      context: { id: 'wamid.inbound-first' },
      text: { body: 'I have another question' }
    };
    const reopenedSigned = await sign(reopenedPayload);
    const reopened = await handleRequest(new Request(`https://api.chat.helixcer.com/webhooks/whatsapp/${channelId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': reopenedSigned.signature }, body: reopenedSigned.raw
    }), env);
    assert.deepEqual(await reopened.json(), { ok: true, received: 1, statuses: 0 });
    const conversationMessages = await handleRequest(new Request(
      `https://api.chat.helixcer.com/api/conversations/${conversation.conversation_id}/messages`, {
        headers: { Authorization: 'Bearer recovery-secret' }
      }), env);
    const reopenedMessage = (await conversationMessages.json()).items.find(item => item.channelMessageId === 'wamid.inbound-reopens');
    assert.deepEqual(reopenedMessage.reply, {
      messageId: message.message_id, channelMessageId: 'wamid.inbound-first', direction: 'inbound',
      text: 'Hello Helixcer', messageType: 'text'
    });
    const reopenedEvent = broadcasts.find(event => event.type === 'message.created' &&
      event.message?.channelMessageId === 'wamid.inbound-reopens');
    assert.ok(reopenedEvent);
    assert.deepEqual(reopenedEvent.message.reply, reopenedMessage.reply);
    assert.equal(reopenedEvent.conversation.conversationId, conversation.conversation_id);
    assert.equal(reopenedEvent.conversation.status, 'open');
    assert.equal(reopenedEvent.conversation.unreadCount, 1);
    assert.equal(reopenedEvent.conversation.lastMessage, 'I have another question');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM conversations WHERE channel_id=?').get(channelId).count, 1);
    assert.deepEqual({ ...database.prepare(`SELECT conversation_id,status,unread_count FROM conversations
      WHERE channel_id=?`).get(channelId) }, {
      conversation_id: conversation.conversation_id, status: 'open', unread_count: 1
    });
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM messages WHERE channel_id=?').get(channelId).count, 2);

    const mismatched = structuredClone(payload);
    mismatched.entry[0].changes[0].value.metadata.phone_number_id = '999999999999999';
    const mismatchedSigned = await sign(mismatched);
    const rejected = await handleRequest(new Request(`https://api.chat.helixcer.com/webhooks/whatsapp/${channelId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': mismatchedSigned.signature }, body: mismatchedSigned.raw
    }), env);
    assert.equal(rejected.status, 403);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM messages WHERE channel_id=?').get(channelId).count, 2);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('Telegram and generic webhooks publish normalized granular message events', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB, {
    ADMIN_TOKEN: 'recovery-secret', RECOVERY_MODE: 'true',
    CHANNEL_CREDENTIALS_KEY: 'test-channel-master-key-material-'.repeat(2),
    GENERIC_REALTIME_WEBHOOK_TOKEN: 'generic-webhook-secret'
  });
  const headers = { Authorization: 'Bearer recovery-secret', 'Content-Type': 'application/json' };
  const telegramCreated = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST', headers,
    body: JSON.stringify({
      channelId: 'telegram-realtime', name: 'Telegram realtime', connectorType: 'telegram',
      credentials: {
        botToken: '123456789:abcdefghijklmnopqrstuvwxyz',
        webhookSecret: 'telegram-realtime-secret'
      }
    })
  }), env);
  assert.equal(telegramCreated.status, 201);
  const genericCreated = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST', headers,
    body: JSON.stringify({
      channelId: 'generic-realtime', name: 'Generic realtime', connectorType: 'generic_http',
      secretKey: 'GENERIC_REALTIME'
    })
  }), env);
  assert.equal(genericCreated.status, 201);

  const broadcasts = [];
  env.INBOX_HUB = {
    idFromName: value => value,
    get: () => ({ fetch: async (url, init = {}) => {
      if (String(url).endsWith('/broadcast')) broadcasts.push(JSON.parse(init.body));
      return new Response(null, { status: 204 });
    } })
  };
  const pending = [];
  const ctx = { waitUntil(promise) { pending.push(promise); } };
  try {
    const telegram = await handleRequest(new Request(
      'https://api.chat.helixcer.com/webhooks/telegram/telegram-realtime', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': 'telegram-realtime-secret'
        },
        body: JSON.stringify({
          update_id: 7001,
          message: {
            message_id: 81,
            date: 1761360100,
            chat: { id: 91910001 },
            from: { first_name: 'Telegram', last_name: 'Customer' },
            text: 'Telegram inbound'
          }
        })
      }), env, ctx);
    assert.deepEqual(await telegram.json(), { ok: true, received: 1 });

    const generic = await handleRequest(new Request(
      'https://api.chat.helixcer.com/webhooks/generic/generic-realtime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Webhook-Token': 'generic-webhook-secret' },
        body: JSON.stringify({
          id: 'generic-message-1', from: 'generic-user-1', senderName: 'Generic Customer',
          text: 'Generic inbound', timestamp: '2026-10-25T02:43:00.000Z', type: 'text'
        })
      }), env, ctx);
    assert.deepEqual(await generic.json(), { ok: true, received: 1 });
    await Promise.all(pending);

    const telegramEvent = broadcasts.find(event => event.type === 'message.created' &&
      event.message?.channelMessageId === '81');
    assert.ok(telegramEvent);
    assert.equal(telegramEvent.message.direction, 'inbound');
    assert.equal(telegramEvent.message.text, 'Telegram inbound');
    assert.equal(telegramEvent.message.senderName, 'Telegram Customer');
    assert.equal(telegramEvent.conversation.connectorType, 'telegram');
    assert.equal(telegramEvent.conversation.channelProfileId, '91910001');
    assert.equal(telegramEvent.conversation.lastMessage, 'Telegram inbound');
    assert.equal(telegramEvent.conversation.unreadCount, 1);

    const genericEvent = broadcasts.find(event => event.type === 'message.created' &&
      event.message?.channelMessageId === 'generic-message-1');
    assert.ok(genericEvent);
    assert.equal(genericEvent.message.direction, 'inbound');
    assert.equal(genericEvent.message.text, 'Generic inbound');
    assert.equal(genericEvent.message.senderName, 'Generic Customer');
    assert.equal(genericEvent.conversation.connectorType, 'generic_http');
    assert.equal(genericEvent.conversation.channelProfileId, 'generic-user-1');
    assert.equal(genericEvent.conversation.lastMessage, 'Generic inbound');
    assert.equal(genericEvent.conversation.unreadCount, 1);

    const refreshed = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations', {
      headers: { Authorization: 'Bearer recovery-secret' }
    }), env);
    const refreshedItems = (await refreshed.json()).items;
    assert.equal(refreshedItems.find(item => item.conversationId === telegramEvent.conversationId).unreadCount, 1);
    assert.equal(refreshedItems.find(item => item.conversationId === genericEvent.conversationId).unreadCount, 1);

    const aggregates = broadcasts.filter(event => event.type === 'webhook.received');
    assert.equal(aggregates.length, 2);
    assert.ok(aggregates.every(event => event.granular === true && event.received === 1 && event.statuses === 0));
  } finally {
    database.close();
  }
});

test('Instagram verification uses /me and exposes sanitized credential errors', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB, {
    ADMIN_TOKEN: 'recovery-secret', RECOVERY_MODE: 'true',
    CHANNEL_CREDENTIALS_KEY: 'test-channel-master-key-material-'.repeat(2)
  });
  const headers = { Authorization: 'Bearer recovery-secret', 'Content-Type': 'application/json' };
  const createInstagram = (channelId, accountId, accessToken) => handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST', headers,
    body: JSON.stringify({ channelId, name: channelId, connectorType: 'instagram',
      config: { instagramAccountId: accountId, apiVersion: 'v26.0', authMode: 'instagram_login' },
      credentials: { accessToken, appSecret: 'abcdef1234567890abcdef1234567890', verifyToken: 'instagram-verify-token' } })
  }), env);
  assert.equal((await createInstagram('ig-valid', '17841400000000001', 'valid-instagram-access-token-123456')).status, 201);
  assert.equal((await createInstagram('ig-invalid', '17841400000000002', 'invalid-instagram-access-token-123')).status, 201);
  const originalFetch = globalThis.fetch;
  const providerCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    providerCalls.push(url);
    if (url.pathname !== '/v26.0/me') return new Response('{}', { status: 404 });
    if (url.searchParams.get('fields') !== 'user_id,username') return new Response('{}', { status: 400 });
    const authorization = new Headers(init.headers).get('Authorization') || '';
    if (authorization.includes('invalid-instagram')) {
      return new Response(JSON.stringify({ error: { message: 'Invalid OAuth access token.' } }), {
        status: 401, headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ user_id: '17841400000000001', username: 'helixcer' }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    const verified = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels/ig-valid/verify', {
      method: 'POST', headers: { Authorization: 'Bearer recovery-secret' }
    }), env);
    assert.equal(verified.status, 200);
    assert.equal(providerCalls[0].origin, 'https://graph.instagram.com');
    assert.equal(providerCalls[0].pathname, '/v26.0/me');
    assert.equal(database.prepare("SELECT json_extract(config_json,'$.verifiedProviderId') AS id FROM channels WHERE channel_id='ig-valid'").get().id,
      '17841400000000001');

    const rejected = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels/ig-invalid/verify', {
      method: 'POST', headers: { Authorization: 'Bearer recovery-secret' }
    }), env);
    assert.equal(rejected.status, 422);
    assert.match((await rejected.json()).error, /Invalid OAuth access token/);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('shared Instagram app webhook verifies all matches and routes each account fail-closed', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB, {
    ADMIN_TOKEN: 'recovery-secret', RECOVERY_MODE: 'true',
    CHANNEL_CREDENTIALS_KEY: 'test-channel-master-key-material-'.repeat(2)
  });
  const headers = { Authorization: 'Bearer recovery-secret', 'Content-Type': 'application/json' };
  const appId = '123456789012345';
  const appSecret = 'abcdef1234567890abcdef1234567890';
  const verifyToken = 'shared-instagram-verify-token';
  for (const [channelId, accountId] of [['ig-account-one', '17841400000000011'], ['ig-account-two', '17841400000000012']]) {
    const created = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
      method: 'POST', headers,
      body: JSON.stringify({ channelId, name: channelId, connectorType: 'instagram',
        config: { instagramAccountId: accountId, appId, apiVersion: 'v26.0', authMode: 'instagram_login' },
        credentials: { accessToken: `instagram-access-token-${channelId}`, appSecret, verifyToken } })
    }), env);
    assert.equal(created.status, 201);
  }

  const listed = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    headers: { Authorization: 'Bearer recovery-secret' }
  }), env);
  for (const item of (await listed.json()).items.filter(item => item.connectorType === 'instagram')) {
    assert.equal(item.setup.callbackPath, `/webhooks/instagram-app/${appId}`);
  }

  const handshake = await handleRequest(new Request(`https://api.chat.helixcer.com/webhooks/instagram-app/${appId}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=challenge-123`), env);
  assert.equal(handshake.status, 200);
  assert.equal(await handshake.text(), 'challenge-123');
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM channels
    WHERE provider_type='instagram' AND json_extract(config_json,'$.webhookVerifiedAt')<>''`).get().count, 2);
  const broadcasts = [];
  env.INBOX_HUB = {
    idFromName: value => value,
    get: () => ({ fetch: async (url, init = {}) => {
      if (String(url).endsWith('/broadcast')) broadcasts.push(JSON.parse(init.body));
      return new Response(null, { status: 204 });
    } })
  };

  const payload = { object: 'instagram', entry: [
    { id: '17841400000000011', messaging: [{ sender: { id: '5550001' }, recipient: { id: '17841400000000011' },
      timestamp: 1761360000000, message: { mid: 'ig-app-message-one', text: 'First account' } }] },
    // Instagram sender ids are account scoped. Deliberately reuse the same
    // numeric value on another account to prove it does not merge contacts.
    { id: '17841400000000012', messaging: [{ sender: { id: '5550001' }, recipient: { id: '17841400000000012' },
      timestamp: 1761360001000, message: { mid: 'ig-app-message-two', text: 'Second account' } }] }
  ] };
  const raw = JSON.stringify(payload);
  const hmacKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(raw));
  const signature = `sha256=${Buffer.from(digest).toString('hex')}`;
  const delivered = await handleRequest(new Request(`https://api.chat.helixcer.com/webhooks/instagram-app/${appId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature }, body: raw
  }), env);
  assert.equal(delivered.status, 200);
  assert.deepEqual(await delivered.json(), { ok: true, received: 2, channels: 2 });
  const routed = database.prepare(`SELECT channel_id,COUNT(*) AS count FROM messages
    WHERE provider_message_id LIKE 'ig-app-message-%' GROUP BY channel_id ORDER BY channel_id`).all();
  assert.equal(routed.length, 2);
  assert.equal(routed[0].channel_id, 'ig-account-one');
  assert.equal(routed[1].channel_id, 'ig-account-two');
  const scopedRoutes = database.prepare(`SELECT b.channel_id,b.identity_id,ci.contact_id
    FROM channel_identity_bindings b JOIN contact_identities ci ON ci.identity_id=b.identity_id
    WHERE b.scoped_profile_id='5550001' AND b.active=1 ORDER BY b.channel_id`).all();
  assert.equal(scopedRoutes.length, 2);
  assert.notEqual(scopedRoutes[0].identity_id, scopedRoutes[1].identity_id);
  assert.notEqual(scopedRoutes[0].contact_id, scopedRoutes[1].contact_id,
    'the same Instagram-scoped id on two accounts must create separate contacts');
  const createdEvents = broadcasts.filter(event => event.type === 'message.created');
  assert.equal(createdEvents.length, 2);
  const firstCreated = createdEvents.find(event => event.message.channelMessageId === 'ig-app-message-one');
  const secondCreated = createdEvents.find(event => event.message.channelMessageId === 'ig-app-message-two');
  assert.ok(firstCreated);
  assert.ok(secondCreated);
  assert.equal(firstCreated.message.text, 'First account');
  assert.equal(firstCreated.message.direction, 'inbound');
  assert.equal(firstCreated.conversation.channelId, 'ig-account-one');
  assert.equal(firstCreated.conversation.channelProfileId, '5550001');
  assert.equal(secondCreated.message.text, 'Second account');
  assert.equal(secondCreated.conversation.channelId, 'ig-account-two');
  assert.equal(secondCreated.conversation.channelProfileId, '5550001');
  const deliveryAggregates = broadcasts.filter(event => event.type === 'webhook.received');
  assert.equal(deliveryAggregates.length, 2);
  assert.ok(deliveryAggregates.every(event => event.granular === true && event.received === 1));

  const firstConversation = database.prepare(`SELECT conversation_id,contact_id FROM conversations
    WHERE channel_id='ig-account-one'`).get();
  database.prepare(`INSERT INTO messages
      (message_id,conversation_id,contact_id,channel_id,direction,message_type,text,provider_message_id,status,timestamp,workspace_id)
    VALUES ('ig-outbound-internal',?1,?2,'ig-account-one','outbound','text','Reply','ig-provider-outbound','sent',
      '2025-10-25T02:40:01.000Z','ws_default')`)
    .run(firstConversation.conversation_id, firstConversation.contact_id);
  database.prepare(`INSERT INTO messages
      (message_id,conversation_id,contact_id,channel_id,direction,message_type,text,provider_message_id,status,timestamp,workspace_id)
    VALUES ('ig-outbound-pending',?1,?2,'ig-account-one','outbound','text','Still queued','ig-provider-pending','pending',
      '2025-10-25T02:40:01.500Z','ws_default')`)
    .run(firstConversation.conversation_id, firstConversation.contact_id);
  const receiptPayload = { object: 'instagram', entry: [{ id: '17841400000000011', messaging: [
    { sender: { id: '5550001' }, recipient: { id: '17841400000000011' }, timestamp: 1761360002000,
      delivery: { mids: ['ig-provider-outbound'], watermark: 1761360002000 } },
    { sender: { id: '5550001' }, recipient: { id: '17841400000000011' }, timestamp: 1761360003000,
      read: { watermark: 1761360003000 } }
  ] }] };
  const receiptRaw = JSON.stringify(receiptPayload);
  const receiptDigest = await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(receiptRaw));
  const receiptSignature = `sha256=${Buffer.from(receiptDigest).toString('hex')}`;
  const receipt = await handleRequest(new Request(`https://api.chat.helixcer.com/webhooks/instagram-app/${appId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': receiptSignature }, body: receiptRaw
  }), env);
  assert.equal(receipt.status, 200);
  assert.deepEqual(await receipt.json(), { ok: true, received: 0, channels: 1 });
  assert.equal(database.prepare("SELECT status FROM messages WHERE message_id='ig-outbound-internal'").get().status, 'read');
  assert.equal(database.prepare("SELECT status FROM messages WHERE message_id='ig-outbound-pending'").get().status, 'pending');

  const now = new Date().toISOString();
  database.prepare("INSERT INTO workspaces (workspace_id,slug,name,created_at,updated_at) VALUES ('ws_ambiguous','ambiguous','Ambiguous',?,?)").run(now, now);
  database.prepare(`INSERT INTO channels
      (channel_id,name,connector_type,provider_type,enabled,capabilities_json,config_json,secret_key,created_at,updated_at,workspace_id)
    VALUES ('ig-ambiguous','Ambiguous','generic_http','instagram',1,'["text"]',?,'DATABASE',?,?, 'ws_ambiguous')`)
    .run(JSON.stringify({ instagramAccountId: '17841400000000011', appId, apiVersion: 'v26.0', authMode: 'instagram_login' }), now, now);
  const singlePayload = JSON.stringify({ object: 'instagram', entry: [payload.entry[0]] });
  const ambiguous = await handleRequest(new Request(`https://api.chat.helixcer.com/webhooks/instagram-app/${appId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature }, body: singlePayload
  }), env);
  assert.equal(ambiguous.status, 409);
  database.close();
});

test('WhatsApp verification requires WABA ownership and subscribes the app before marking credentials verified', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB, {
    ADMIN_TOKEN: 'recovery-secret', RECOVERY_MODE: 'true',
    CHANNEL_CREDENTIALS_KEY: 'test-channel-master-key-material-'.repeat(2)
  });
  const headers = { Authorization: 'Bearer recovery-secret', 'Content-Type': 'application/json' };
  const created = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST', headers,
    body: JSON.stringify({ channelId: 'wa-verify', name: 'WhatsApp verify', connectorType: 'whatsapp_cloud',
      config: { wabaId: '123456789012345', phoneNumberId: '123456789012346', apiVersion: 'v26.0' },
      credentials: { accessToken: 'whatsapp-access-token-value-1234567890',
        appSecret: '1234567890abcdef1234567890abcdef', verifyToken: 'verify-token-value' } })
  }), env);
  assert.equal(created.status, 201);
  const originalFetch = globalThis.fetch;
  let providerPhoneId = '999999999999999';
  let providerUrl;
  let subscriptionOk = false;
  let subscriptionCalls = 0;
  let subscriptionRequest;
  let phoneListError = null;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/phone_numbers')) {
      providerUrl = url;
      if (phoneListError) {
        return new Response(JSON.stringify(phoneListError), {
          status: 400, headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ data: [{ id: providerPhoneId, display_phone_number: '+91 98765 43210', verified_name: 'Helixcer' }] }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (url.pathname.endsWith('/subscribed_apps')) {
      subscriptionCalls++;
      subscriptionRequest = { url, init };
      return new Response(JSON.stringify(subscriptionOk
        ? { success: true }
        : { error: { message: 'Application does not have permission to subscribe this WABA.' } }), {
        status: subscriptionOk ? 200 : 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('{}', { status: 404 });
  };
  try {
    phoneListError = { error: { code: 100, message: "Unsupported get request. Object with ID '123456789012345' does not exist, cannot be loaded due to missing permissions, or does not support this operation." } };
    const inaccessible = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels/wa-verify/verify', {
      method: 'POST', headers: { Authorization: 'Bearer recovery-secret' }
    }), env);
    assert.equal(inaccessible.status, 422);
    const inaccessibleText = await inaccessible.text();
    assert.match(JSON.parse(inaccessibleText).error, /cannot access this Messaging\/WhatsApp Business Account/i);
    assert.match(inaccessibleText, /whatsapp_business_management/);
    assert.equal(inaccessibleText.includes('123456789012345'), false);
    assert.equal(subscriptionCalls, 0);

    phoneListError = { error: { code: 190, message: 'Invalid OAuth access token.' } };
    const invalidToken = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels/wa-verify/verify', {
      method: 'POST', headers: { Authorization: 'Bearer recovery-secret' }
    }), env);
    assert.equal(invalidToken.status, 422);
    assert.match((await invalidToken.json()).error, /Invalid OAuth access token/);
    phoneListError = null;

    const notOwned = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels/wa-verify/verify', {
      method: 'POST', headers: { Authorization: 'Bearer recovery-secret' }
    }), env);
    assert.equal(notOwned.status, 422);
    assert.equal(providerUrl.origin, 'https://graph.facebook.com');
    assert.equal(providerUrl.pathname, '/v26.0/123456789012345/phone_numbers');
    assert.equal(subscriptionCalls, 0);
    providerPhoneId = '123456789012346';
    const subscriptionRejected = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels/wa-verify/verify', {
      method: 'POST', headers: { Authorization: 'Bearer recovery-secret' }
    }), env);
    assert.equal(subscriptionRejected.status, 422);
    const subscriptionRejectedText = await subscriptionRejected.text();
    assert.match(JSON.parse(subscriptionRejectedText).error, /permission to subscribe/i);
    assert.equal(subscriptionRejectedText.includes('whatsapp-access-token-value-1234567890'), false);
    assert.equal(subscriptionCalls, 1);
    const rejectedSetup = JSON.parse(database.prepare("SELECT config_json FROM channels WHERE channel_id='wa-verify'").get().config_json);
    assert.equal(rejectedSetup.credentialsVerifiedAt, undefined);
    assert.equal(rejectedSetup.subscribedAppsAt, undefined);

    subscriptionOk = true;
    const verified = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels/wa-verify/verify', {
      method: 'POST', headers: { Authorization: 'Bearer recovery-secret' }
    }), env);
    assert.equal(verified.status, 200);
    const verifiedBody = await verified.json();
    assert.equal(verifiedBody.verifiedName, 'Helixcer');
    assert.equal(verifiedBody.subscribedToWaba, true);
    assert.equal(subscriptionCalls, 2);
    assert.equal(subscriptionRequest.url.pathname, '/v26.0/123456789012345/subscribed_apps');
    assert.equal(subscriptionRequest.init.method, 'POST');
    assert.equal(new Headers(subscriptionRequest.init.headers).get('Authorization'), 'Bearer whatsapp-access-token-value-1234567890');
    const storedSetup = JSON.parse(database.prepare("SELECT config_json FROM channels WHERE channel_id='wa-verify'").get().config_json);
    assert.ok(storedSetup.credentialsVerifiedAt);
    assert.ok(storedSetup.subscribedAppsAt);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('Telegram bot identity is reserved before webhook registration', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB, {
    ADMIN_TOKEN: 'recovery-secret', RECOVERY_MODE: 'true',
    CHANNEL_CREDENTIALS_KEY: 'test-channel-master-key-material-'.repeat(2)
  });
  const headers = { Authorization: 'Bearer recovery-secret', 'Content-Type': 'application/json' };
  for (const [channelId, botToken] of [['telegram-one', '123456789:abcdefghijklmnopqrstuvwxyz_123456'],
    ['telegram-two', '987654321:abcdefghijklmnopqrstuvwxyz_654321']]) {
    const created = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
      method: 'POST', headers,
      body: JSON.stringify({ channelId, name: channelId, connectorType: 'telegram', config: {},
        credentials: { botToken, webhookSecret: `secret_${channelId.replace('-', '_')}` } })
    }), env);
    assert.equal(created.status, 201);
  }
  const originalFetch = globalThis.fetch;
  let setWebhookCalls = 0;
  let telegramMediaSendCalls = 0;
  const telegramReplyBodies = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.includes('/sendMessage')) {
      const body = JSON.parse(init.body);
      telegramReplyBodies.push(body);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 80 } }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (url.pathname.includes('/sendDocument')) {
      telegramMediaSendCalls++;
      const chatId = init.body.get('chat_id');
      assert.ok(['778899', '778900'].includes(chatId));
      const filename = init.body.get('document').name;
      const retryFixture = filename === 'delivered-once.pdf';
      const webpFixture = filename === 'preview.webp';
      const failureFixture = filename === 'provider-failure.pdf';
      assert.ok(['telegram.pdf', 'preview.webp', 'delivered-once.pdf', 'provider-failure.pdf'].includes(filename));
      assert.equal(init.body.get('caption'), retryFixture ? 'Delivered once'
        : failureFixture ? 'Provider failure'
          : webpFixture ? null : 'Telegram file');
      assert.equal(init.body.get('reply_parameters'), filename === 'telegram.pdf' ? JSON.stringify({ message_id: 52 }) : null);
      if (failureFixture) {
        return new Response(JSON.stringify({ ok: false, description: 'Bad Gateway' }), {
          status: 502, headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ ok: true, result: {
        message_id: retryFixture ? 78 : webpFixture ? 79 : 77,
        document: { file_id: retryFixture ? 'telegram-file-2' : webpFixture ? 'telegram-webp-1' : 'telegram-file-1',
          file_name: filename, mime_type: webpFixture ? 'image/webp' : 'application/pdf' }
      } }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.includes('/getFile')) {
      assert.equal(url.searchParams.get('file_id'), 'telegram-file-1');
      return new Response(JSON.stringify({ ok: true, result: { file_path: 'documents/telegram.pdf' } }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (url.pathname.includes('/file/bot') && url.pathname.endsWith('/documents/telegram.pdf')) {
      return new Response('telegram document', { headers: { 'Content-Type': 'application/pdf' } });
    }
    if (url.pathname.endsWith('/getMe')) {
      return new Response(JSON.stringify({ ok: true, result: { id: 777000, first_name: 'Shared', username: 'shared_bot' } }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (url.pathname.endsWith('/setWebhook')) {
      setWebhookCalls++;
      return new Response(JSON.stringify({ ok: true, result: true }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  };
  try {
    const first = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels/telegram-one/verify', {
      method: 'POST', headers: { Authorization: 'Bearer recovery-secret' }
    }), env);
    assert.equal(first.status, 200);
    const duplicate = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels/telegram-two/verify', {
      method: 'POST', headers: { Authorization: 'Bearer recovery-secret' }
    }), env);
    assert.equal(duplicate.status, 409);
    assert.equal(setWebhookCalls, 1);
    assert.equal(database.prepare("SELECT json_extract(config_json,'$.verifiedProviderId') AS id FROM channels WHERE channel_id='telegram-one'").get().id,
      '777000');

    const now = new Date().toISOString();
    database.prepare(`INSERT INTO contacts (contact_id,display_name,created_at,updated_at,workspace_id)
      VALUES ('contact-telegram-file','Ravi',?,?, 'ws_default')`).run(now, now);
    database.prepare(`INSERT INTO channel_identities
        (identity_id,contact_id,channel_id,channel_profile_id,display_name,created_at,workspace_id)
      VALUES ('identity-telegram-file','contact-telegram-file','telegram-one','778899','Ravi',?,'ws_default')`).run(now);
    database.prepare(`INSERT INTO conversations
        (conversation_id,contact_id,channel_id,status,subject,last_message_at,created_at,updated_at,workspace_id)
      VALUES ('conversation-telegram-file','contact-telegram-file','telegram-one','open','Ravi',?,?,?,'ws_default')`).run(now, now, now);
    database.prepare(`INSERT INTO messages
        (message_id,conversation_id,contact_id,channel_id,direction,message_type,text,provider_message_id,status,timestamp,workspace_id)
      VALUES ('telegram-inbound-52','conversation-telegram-file','contact-telegram-file','telegram-one','inbound','text',
        'Please confirm','52','received',?,'ws_default')`).run(now);

    const telegramReplyPending = [];
    const telegramReplyResponse = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/conversations/conversation-telegram-file/messages', {
        method: 'POST', headers,
        body: JSON.stringify({ text: 'Confirmed', replyToMessageId: 'telegram-inbound-52' })
      }), env, { waitUntil(promise) { telegramReplyPending.push(promise); } });
    assert.equal(telegramReplyResponse.status, 202);
    const telegramReplyItem = (await telegramReplyResponse.json()).item;
    await Promise.all(telegramReplyPending);
    assert.deepEqual(telegramReplyBodies, [{
      chat_id: '778899', text: 'Confirmed', reply_parameters: { message_id: 52 }
    }]);
    const savedTelegramReply = JSON.parse(database.prepare('SELECT payload_json FROM messages WHERE message_id=?')
      .get(telegramReplyItem.messageId).payload_json);
    assert.equal(savedTelegramReply.reply.messageId, 'telegram-inbound-52');
    assert.equal(savedTelegramReply.reply.channelMessageId, '52');

    const telegramUpload = new FormData();
    telegramUpload.set('file', new Blob(['telegram file data'], { type: 'application/pdf' }), 'telegram.pdf');
    telegramUpload.set('caption', 'Telegram file');
    telegramUpload.set('replyToMessageId', 'telegram-inbound-52');
    const telegramAttachment = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/conversation-telegram-file/attachments', {
      method: 'POST', headers: { Authorization: 'Bearer recovery-secret' }, body: telegramUpload
    }), env);
    assert.equal(telegramAttachment.status, 202);
    const telegramItem = (await telegramAttachment.json()).item;
    assert.equal(telegramItem.status, 'sent');
    assert.equal(telegramItem.channelMessageId, '77');
    assert.equal(telegramItem.attachment.available, true);
    const telegramMedia = await handleRequest(new Request(`https://api.chat.helixcer.com${telegramItem.attachment.url}`, {
      headers: { Authorization: 'Bearer recovery-secret' }
    }), env);
    assert.equal(telegramMedia.status, 200);
    assert.equal(await telegramMedia.text(), 'telegram document');

    const telegramWebpBody = new FormData();
    telegramWebpBody.set('file', new Blob(['webp image'], { type: 'image/webp' }), 'preview.webp');
    const telegramWebp = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/conversation-telegram-file/attachments', {
      method: 'POST', headers: { Authorization: 'Bearer recovery-secret' }, body: telegramWebpBody
    }), env);
    assert.equal(telegramWebp.status, 202);
    const telegramWebpItem = (await telegramWebp.json()).item;
    assert.equal(telegramWebpItem.messageType, 'image');
    assert.equal(telegramWebpItem.attachment.available, true);

    database.prepare(`INSERT INTO contacts (contact_id,display_name,created_at,updated_at,workspace_id)
      VALUES ('contact-telegram-delivered','Maya',?,?, 'ws_default')`).run(now, now);
    database.prepare(`INSERT INTO channel_identities
        (identity_id,contact_id,channel_id,channel_profile_id,display_name,created_at,workspace_id)
      VALUES ('identity-telegram-delivered','contact-telegram-delivered','telegram-one','778900','Maya',?,'ws_default')`).run(now);
    database.prepare(`INSERT INTO conversations
        (conversation_id,contact_id,channel_id,status,subject,last_message_at,created_at,updated_at,workspace_id)
      VALUES ('conversation-telegram-delivered','contact-telegram-delivered','telegram-one','open','Maya',?,?,?,'ws_default')`).run(now, now, now);
    const healthyDB = env.DB;
    env.DB = withRunFailures(healthyDB, [/UPDATE messages SET provider_message_id/, /INSERT INTO audit_log/]);
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      const deliveredOnceBody = new FormData();
      deliveredOnceBody.set('file', new Blob(['already delivered'], { type: 'application/pdf' }), 'delivered-once.pdf');
      deliveredOnceBody.set('caption', 'Delivered once');
      const scheduled = [];
      const deliveredOnce = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/conversation-telegram-delivered/attachments', {
        method: 'POST', headers: { Authorization: 'Bearer recovery-secret' }, body: deliveredOnceBody
      }), env, { waitUntil(promise) { scheduled.push(promise); } });
      assert.equal(deliveredOnce.status, 202);
      const deliveredOnceItem = (await deliveredOnce.json()).item;
      assert.equal(deliveredOnceItem.status, 'sent');
      assert.equal(deliveredOnceItem.channelMessageId, '78');
      assert.equal(deliveredOnceItem.attachment.available, true);
      assert.equal(scheduled.length, 0);
      assert.equal(telegramMediaSendCalls, 3);
    } finally {
      console.error = originalConsoleError;
      env.DB = healthyDB;
    }

    const messagesBeforeProviderFailure = database.prepare('SELECT COUNT(*) AS count FROM messages').get().count;
    const providerFailureBody = new FormData();
    providerFailureBody.set('file', new Blob(['provider failure'], { type: 'application/pdf' }), 'provider-failure.pdf');
    providerFailureBody.set('caption', 'Provider failure');
    const providerFailure = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/conversations/conversation-telegram-file/attachments', {
        method: 'POST', headers: { Authorization: 'Bearer recovery-secret' }, body: providerFailureBody
      }), env);
    assert.equal(providerFailure.status, 202);
    const providerFailureItem = (await providerFailure.json()).item;
    assert.equal(providerFailureItem.status, 'failed');
    assert.match(providerFailureItem.error, /Telegram API.*Bad Gateway/);
    assert.equal(providerFailureItem.attachment.available, false);
    const storedFailure = database.prepare('SELECT status,error FROM messages WHERE message_id=?').get(providerFailureItem.messageId);
    assert.equal(storedFailure.status, 'failed');
    assert.match(storedFailure.error, /Telegram API.*Bad Gateway/);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM messages').get().count, messagesBeforeProviderFailure + 1);

    const messagesBeforeValidationFailure = database.prepare('SELECT COUNT(*) AS count FROM messages').get().count;
    const invalidTelegramBody = new FormData();
    invalidTelegramBody.set('file', new Blob(['unsafe'], { type: 'application/x-msdownload' }), 'unsafe.exe');
    const invalidTelegram = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/conversations/conversation-telegram-file/attachments', {
        method: 'POST', headers: { Authorization: 'Bearer recovery-secret' }, body: invalidTelegramBody
      }), env);
    assert.equal(invalidTelegram.status, 415);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM messages').get().count, messagesBeforeValidationFailure);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('dashboard WhatsApp replies enforce the 24-hour window while templates and attachments use Meta', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB, {
    ADMIN_TOKEN: 'recovery-secret', RECOVERY_MODE: 'true',
    CHANNEL_CREDENTIALS_KEY: 'test-channel-master-key-material-'.repeat(2)
  });
  const jsonHeaders = { Authorization: 'Bearer recovery-secret', 'Content-Type': 'application/json' };
  const created = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ channelId: 'wa-dashboard', name: 'Dashboard WhatsApp', connectorType: 'whatsapp_cloud',
      config: { wabaId: '523456789012345', phoneNumberId: '523456789012346', apiVersion: 'v26.0' },
      credentials: { accessToken: 'dashboard-access-token-value-1234567890',
        appSecret: '1234567890abcdef1234567890abcdef', verifyToken: 'dashboard-verify-token' } })
  }), env);
  assert.equal(created.status, 201);
  const verifiedAt = new Date().toISOString();
  const verifiedChannelConfig = {
    ...JSON.parse(database.prepare("SELECT config_json FROM channels WHERE channel_id='wa-dashboard'").get().config_json),
    credentialsVerifiedAt: verifiedAt,
    verifiedProviderId: '523456789012346'
  };
  database.prepare("UPDATE channels SET config_json=? WHERE channel_id='wa-dashboard'")
    .run(JSON.stringify(verifiedChannelConfig));
  const broadcasts = [];
  env.INBOX_HUB = {
    idFromName: value => value,
    get: () => ({ fetch: async (url, init = {}) => {
      if (String(url).endsWith('/broadcast')) broadcasts.push(JSON.parse(init.body));
      return new Response(null, { status: 204 });
    } })
  };

  const now = new Date().toISOString();
  database.prepare(`INSERT INTO contacts (contact_id,display_name,created_at,updated_at,workspace_id)
    VALUES ('contact-dashboard','Asha',?,?, 'ws_default')`).run(now, now);
  database.prepare(`INSERT INTO channel_identities
      (identity_id,contact_id,channel_id,channel_profile_id,display_name,created_at,workspace_id)
    VALUES ('identity-dashboard','contact-dashboard','wa-dashboard','919999999999','Asha',?,'ws_default')`).run(now);
  database.prepare(`INSERT INTO contact_identities
      (identity_id,workspace_id,contact_id,platform,profile_id,phone_number,display_name,created_at,updated_at)
    VALUES ('identity-dashboard','ws_default','contact-dashboard','whatsapp','919999999999','919999999999','Asha',?,?)`)
    .run(now, now);
  database.prepare(`INSERT INTO channel_identity_bindings
      (binding_id,workspace_id,identity_id,channel_id,scoped_profile_id,active,first_seen_at,last_seen_at,created_at,updated_at)
    VALUES ('binding-dashboard','ws_default','identity-dashboard','wa-dashboard','919999999999',1,?,?,?,?)`)
    .run(now, now, now, now);
  database.prepare(`INSERT INTO conversations
      (conversation_id,contact_id,channel_id,identity_id,status,subject,last_message_at,created_at,updated_at,workspace_id)
    VALUES ('conversation-dashboard','contact-dashboard','wa-dashboard','identity-dashboard','open','Asha',?,?,?,'ws_default')`).run(now, now, now);
  database.prepare(`INSERT INTO messages
      (message_id,conversation_id,contact_id,channel_id,identity_id,direction,message_type,text,provider_message_id,status,timestamp,workspace_id)
    VALUES ('inbound-dashboard','conversation-dashboard','contact-dashboard','wa-dashboard','identity-dashboard','inbound','text','Hello',
      'wamid.inbound-dashboard','received',?,'ws_default')`).run(now);

  const conversations = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations', {
    headers: { Authorization: 'Bearer recovery-secret' }
  }), env);
  const conversation = (await conversations.json()).items.find(item => item.conversationId === 'conversation-dashboard');
  assert.equal(conversation.connectorType, 'whatsapp_cloud');
  assert.equal(conversation.lastMessageType, 'text');
  assert.equal(conversation.freeformAllowed, true);
  assert.ok(conversation.replyWindowExpiresAt);

  const originalFetch = globalThis.fetch;
  const providerBodies = [];
  let mediaUploadCalls = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/message_templates')) {
      const name = url.searchParams.get('name');
      return new Response(JSON.stringify({ data: name === 'order_update' ? [{
        id: 'meta-dashboard-order', name: 'order_update', language: 'en_US', status: 'APPROVED', category: 'UTILITY',
        components: [
          { type: 'HEADER', format: 'DOCUMENT' },
          { type: 'BODY', text: 'Hi {{1}}, your order is ready.' },
          { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Continue' }] }
        ]
      }] : [] }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.hostname === 'lookaside.fbsbx.com') {
      assert.match(init.headers.Authorization, /^Bearer /);
      return new Response('invoice bytes', { headers: { 'Content-Type': 'application/pdf', 'Content-Length': '13' } });
    }
    if (/\/media-dashboard-\d+$/.test(url.pathname)) {
      assert.match(init.headers.Authorization, /^Bearer /);
      return new Response(JSON.stringify({ url: 'https://lookaside.fbsbx.com/invoice.pdf' }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.endsWith('/media')) {
      assert.match(init.headers.Authorization, /^Bearer /);
      const upload = init.body;
      assert.equal(upload.get('messaging_product'), 'whatsapp');
      assert.equal(upload.get('type'), 'application/pdf');
      mediaUploadCalls++;
      return new Response(JSON.stringify({ id: `media-dashboard-${mediaUploadCalls}` }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.endsWith('/messages')) {
      const body = JSON.parse(init.body);
      providerBodies.push(body);
      return new Response(JSON.stringify({ messages: [{ id: `wamid.dashboard-${providerBodies.length}` }] }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('{}', { status: 404 });
  };
  try {
    const pending = [];
    const ctx = { waitUntil(promise) { pending.push(promise); } };
    const beforeTemplateMediaCount = database.prepare('SELECT COUNT(*) AS count FROM messages').get().count;
    const templateMediaBody = new FormData();
    templateMediaBody.set('file', new Blob(['template document'], { type: 'application/pdf' }), 'template-header.pdf');
    templateMediaBody.set('type', 'document');
    const templateMedia = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/conversation-dashboard/template-media', {
      method: 'POST', headers: { Authorization: 'Bearer recovery-secret' }, body: templateMediaBody
    }), env, ctx);
    assert.equal(templateMedia.status, 201);
    assert.equal((await templateMedia.json()).mediaId, 'media-dashboard-1');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM messages').get().count, beforeTemplateMediaCount);

    const templateResponse = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/conversation-dashboard/template', {
      method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ name: 'order_update', language: { code: 'en_US' },
        components: [
          { type: 'header', parameters: [{ type: 'document', document: { id: 'media-dashboard-1' } }] },
          { type: 'body', parameters: [{ type: 'text', text: 'Asha' }] }
        ],
        mediaPreview: { filename: 'template-header.pdf', mimeType: 'application/pdf', size: 17 },
        previewText: 'Order update\nHi Asha\nTrack order' })
    }), env, ctx);
    assert.equal(templateResponse.status, 202);
    const templateItem = (await templateResponse.json()).item;
    assert.equal(templateItem.messageType, 'template');
    assert.equal(templateItem.text, 'Order update\nHi Asha\nTrack order');
    assert.equal(templateItem.senderName, 'Emergency recovery');
    assert.deepEqual(templateItem.template.buttons, [{ type: 'quick_reply', text: 'Continue' }]);
    assert.equal(templateItem.attachment.filename, 'template-header.pdf');
    assert.equal(templateItem.attachment.type, 'document');
    assert.equal(templateItem.attachment.available, true);
    const templateCreatedEvent = broadcasts.find(event => event.type === 'message.created' &&
      event.messageId === templateItem.messageId);
    assert.ok(templateCreatedEvent);
    assert.deepEqual(templateCreatedEvent.message, templateItem);
    const conversationsAfterTemplate = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations', {
      headers: { Authorization: 'Bearer recovery-secret' }
    }), env);
    const conversationAfterTemplate = (await conversationsAfterTemplate.json()).items
      .find(item => item.conversationId === 'conversation-dashboard');
    assert.equal(conversationAfterTemplate.lastMessageType, 'template');
    await Promise.all(pending.splice(0));
    assert.equal(providerBodies[0].type, 'template');
    assert.equal(providerBodies[0].template.name, 'order_update');

    const uploadBody = new FormData();
    uploadBody.set('file', new Blob(['invoice data'], { type: 'application/pdf' }), 'invoice.pdf');
    uploadBody.set('caption', 'Your invoice');
    uploadBody.set('replyToMessageId', 'inbound-dashboard');
    const attachmentResponse = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/conversation-dashboard/attachments', {
      method: 'POST', headers: { Authorization: 'Bearer recovery-secret' }, body: uploadBody
    }), env, ctx);
    assert.equal(attachmentResponse.status, 202);
    const attachmentItem = (await attachmentResponse.json()).item;
    assert.equal(attachmentItem.messageType, 'document');
    assert.equal(attachmentItem.attachment.filename, 'invoice.pdf');
    const attachmentCreatedEvent = broadcasts.find(event => event.type === 'message.created' &&
      event.messageId === attachmentItem.messageId);
    assert.ok(attachmentCreatedEvent);
    assert.deepEqual(attachmentCreatedEvent.message, attachmentItem);
    await Promise.all(pending.splice(0));
    assert.equal(mediaUploadCalls, 2);
    assert.equal(providerBodies[1].type, 'document');
    assert.equal(providerBodies[1].document.id, 'media-dashboard-2');
    assert.equal(providerBodies[1].document.filename, 'invoice.pdf');
    assert.deepEqual(providerBodies[1].context, { message_id: 'wamid.inbound-dashboard' });

    const replyResponse = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/conversations/conversation-dashboard/messages', {
        method: 'POST', headers: jsonHeaders,
        body: JSON.stringify({ text: 'Replying to your message', replyToMessageId: 'inbound-dashboard' })
      }), env, ctx);
    assert.equal(replyResponse.status, 202);
    const replyItem = (await replyResponse.json()).item;
    assert.equal(replyItem.reply.messageId, 'inbound-dashboard');
    assert.equal(replyItem.reply.channelMessageId, 'wamid.inbound-dashboard');
    const replyCreatedEvent = broadcasts.find(event => event.type === 'message.created' &&
      event.messageId === replyItem.messageId);
    assert.ok(replyCreatedEvent);
    assert.deepEqual(replyCreatedEvent.message, replyItem);
    await Promise.all(pending.splice(0));
    assert.deepEqual(providerBodies[2].context, { message_id: 'wamid.inbound-dashboard' });
    assert.equal(providerBodies[2].biz_opaque_callback_data, replyItem.messageId);
    const replyStatusEvent = broadcasts.find(event => event.type === 'message.updated' &&
      event.messageId === replyItem.messageId && event.status === 'submitted');
    assert.ok(replyStatusEvent);
    assert.equal(replyStatusEvent.channelMessageId, 'wamid.dashboard-3');
    assert.equal(replyStatusEvent.message.channelMessageId, 'wamid.dashboard-3');

    database.prepare("UPDATE conversations SET unread_count=4 WHERE conversation_id='conversation-dashboard'").run();
    const racingEnv = {
      ...env,
      DB: withConcurrentUnreadIncrement(DB, database, 'conversation-dashboard')
    };
    const ordinaryPatch = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/conversations/conversation-dashboard', {
        method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ status: 'open' })
      }), racingEnv);
    assert.equal(ordinaryPatch.status, 200);
    assert.equal((await ordinaryPatch.json()).item.unreadCount, 5);
    assert.equal(database.prepare("SELECT unread_count FROM conversations WHERE conversation_id='conversation-dashboard'").get().unread_count, 5);

    const concurrentReadPushes = [];
    const concurrentInboundDuringRead = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/conversations/conversation-dashboard', {
        method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ markRead: true })
      }), {
        ...env,
        DB: withConcurrentUnreadIncrement(DB, database, 'conversation-dashboard')
      }, {
        waitUntil(promise) { concurrentReadPushes.push(promise); }
      });
    assert.equal(concurrentInboundDuringRead.status, 200);
    assert.equal((await concurrentInboundDuringRead.json()).item.unreadCount, 1);
    assert.equal(database.prepare("SELECT unread_count FROM conversations WHERE conversation_id='conversation-dashboard'").get().unread_count, 1);
    assert.equal(concurrentReadPushes.length, 0,
      'a concurrent newer unread message must not be cleared on Android');

    const markReadRaceEnv = {
      ...env,
      DB: withConcurrentConversationMutation(DB, () => {
        database.prepare(`UPDATE conversations SET status='closed',assigned_to='concurrent@example.com'
          WHERE conversation_id='conversation-dashboard'`).run();
      })
    };
    const completedReadPushes = [];
    const markReadOnly = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/conversations/conversation-dashboard', {
        method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ markRead: true })
      }), markReadRaceEnv, {
        waitUntil(promise) { completedReadPushes.push(promise); }
      });
    assert.equal(markReadOnly.status, 200);
    const markReadItem = (await markReadOnly.json()).item;
    assert.equal(markReadItem.status, 'closed');
    assert.equal(markReadItem.assignedTo, 'concurrent@example.com');
    assert.equal(markReadItem.unreadCount, 0);
    assert.equal(completedReadPushes.length, 1,
      'a completed mark-read schedules one Android notification-clear event');
    await Promise.all(completedReadPushes);

    const patchedConversation = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/conversations/conversation-dashboard', {
        method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ status: 'pending' })
      }), env);
    assert.equal(patchedConversation.status, 200);
    const patchedItem = (await patchedConversation.json()).item;
    assert.equal(patchedItem.conversationId, 'conversation-dashboard');
    assert.equal(patchedItem.status, 'pending');
    assert.equal(patchedItem.unreadCount, 0);
    assert.equal(patchedItem.subject, 'Asha');
    assert.equal(patchedItem.connectorType, 'whatsapp_cloud');
    assert.equal(patchedItem.channelProfileId, '919999999999');
    assert.equal(patchedItem.lastMessage, 'Replying to your message');
    const conversationEvent = broadcasts.filter(event => event.type === 'conversation.updated' &&
      event.conversationId === 'conversation-dashboard').at(-1);
    assert.ok(conversationEvent);
    assert.deepEqual(conversationEvent.conversation, patchedItem);

    const messages = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/conversation-dashboard/messages', {
      headers: { Authorization: 'Bearer recovery-secret' }
    }), env);
    const messageBody = await messages.json();
    assert.equal(messageBody.freeformAllowed, true);
    const documentMessage = messageBody.items.find(item => item.messageType === 'document');
    const templateMessage = messageBody.items.find(item => item.messageType === 'template');
    assert.deepEqual(templateMessage.template.buttons, [{ type: 'quick_reply', text: 'Continue' }]);
    assert.equal(templateMessage.attachment.filename, 'template-header.pdf');
    assert.equal(templateMessage.attachment.available, true);
    assert.match(templateMessage.attachment.url, /\/api\/messages\/.+\/attachment$/);
    assert.equal(documentMessage.attachment.caption, 'Your invoice');
    assert.equal(documentMessage.senderName, 'Emergency recovery');
    assert.equal(documentMessage.attachment.available, true);
    assert.match(documentMessage.attachment.url, /\/api\/messages\/.+\/attachment$/);
    assert.equal(documentMessage.channelMessageId, 'wamid.dashboard-2');
    assert.equal(documentMessage.reply.messageId, 'inbound-dashboard');
    assert.equal(documentMessage.reply.text, 'Hello');
    assert.equal(Object.hasOwn(documentMessage, 'providerMessageId'), false);
    const listedReply = messageBody.items.find(item => item.messageId === replyItem.messageId);
    assert.equal(listedReply.status, 'submitted');
    assert.equal(listedReply.senderName, 'Emergency recovery');
    assert.equal(listedReply.reply.text, 'Hello');
    assert.equal(listedReply.reply.direction, 'inbound');

    // Plain outbound text (no reply object) used to lose senderName when
    // markMessageSent / status webhooks replaced payload_json.
    const plainPending = [];
    const plainResponse = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/conversations/conversation-dashboard/messages', {
        method: 'POST', headers: jsonHeaders,
        body: JSON.stringify({ text: 'Plain outbound without reply' })
      }), env, { waitUntil(promise) { plainPending.push(promise); } });
    assert.equal(plainResponse.status, 202);
    const plainItem = (await plainResponse.json()).item;
    assert.equal(plainItem.senderName, 'Emergency recovery');
    await Promise.all(plainPending.splice(0));
    const plainStored = JSON.parse(database.prepare('SELECT payload_json,status,provider_message_id FROM messages WHERE message_id=?')
      .get(plainItem.messageId).payload_json);
    assert.equal(plainStored.senderName, 'Emergency recovery');
    const plainRow = database.prepare('SELECT status,provider_message_id FROM messages WHERE message_id=?')
      .get(plainItem.messageId);
    assert.equal(plainRow.status, 'submitted');
    assert.match(plainRow.provider_message_id, /^wamid\.dashboard-/);

    const statusPayload = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '916282010794', phone_number_id: '523456789012346' },
      statuses: [{ id: plainRow.provider_message_id, status: 'delivered', timestamp: '1761360100',
        recipient_id: '919999999999' }]
    } }] }] };
    const statusRaw = JSON.stringify(statusPayload);
    const statusKey = await crypto.subtle.importKey('raw',
      new TextEncoder().encode('1234567890abcdef1234567890abcdef'),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const statusDigest = await crypto.subtle.sign('HMAC', statusKey, new TextEncoder().encode(statusRaw));
    const statusSignature = `sha256=${Buffer.from(statusDigest).toString('hex')}`;
    const statusResponse = await handleRequest(new Request('https://api.chat.helixcer.com/webhooks/whatsapp/wa-dashboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': statusSignature },
      body: statusRaw
    }), env, ctx);
    assert.equal(statusResponse.status, 200);
    assert.deepEqual(await statusResponse.json(), { ok: true, received: 0, statuses: 1 });
    const afterStatus = database.prepare('SELECT status,payload_json FROM messages WHERE message_id=?')
      .get(plainItem.messageId);
    assert.equal(afterStatus.status, 'delivered');
    assert.equal(JSON.parse(afterStatus.payload_json).senderName, 'Emergency recovery');
    const listedPlain = (await (await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/conversations/conversation-dashboard/messages', {
        headers: { Authorization: 'Bearer recovery-secret' }
      }), env)).json()).items.find(item => item.messageId === plainItem.messageId);
    assert.equal(listedPlain.status, 'delivered');
    assert.equal(listedPlain.senderName, 'Emergency recovery');

    const protectedTemplateMedia = await handleRequest(new Request(`https://api.chat.helixcer.com${templateMessage.attachment.url}`, {
      headers: { Authorization: 'Bearer recovery-secret' }
    }), env);
    assert.equal(protectedTemplateMedia.status, 200);
    assert.match(protectedTemplateMedia.headers.get('Content-Disposition'), /^attachment;/);
    assert.equal(await protectedTemplateMedia.text(), 'invoice bytes');

    const protectedAttachment = await handleRequest(new Request(`https://api.chat.helixcer.com${documentMessage.attachment.url}`, {
      headers: { Authorization: 'Bearer recovery-secret' }
    }), env);
    assert.equal(protectedAttachment.status, 200);
    assert.equal(protectedAttachment.headers.get('Content-Type'), 'application/octet-stream');
    assert.match(protectedAttachment.headers.get('Content-Disposition'), /^attachment;/);
    assert.equal(await protectedAttachment.text(), 'invoice bytes');

    const unsupportedBody = new FormData();
    unsupportedBody.set('file', new Blob(['binary'], { type: 'application/x-msdownload' }), 'unsafe.exe');
    const unsupported = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/conversation-dashboard/attachments', {
      method: 'POST', headers: { Authorization: 'Bearer recovery-secret' }, body: unsupportedBody
    }), env, ctx);
    assert.equal(unsupported.status, 415);
    assert.match((await unsupported.json()).error, /not supported/i);
    assert.equal(mediaUploadCalls, 2);

    const audioCaptionBody = new FormData();
    audioCaptionBody.set('file', new Blob(['audio bytes'], { type: 'audio/mpeg' }), 'voice.mp3');
    audioCaptionBody.set('caption', 'This text would not reach WhatsApp');
    const audioCaption = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/conversation-dashboard/attachments', {
      method: 'POST', headers: { Authorization: 'Bearer recovery-secret' }, body: audioCaptionBody
    }), env, ctx);
    assert.equal(audioCaption.status, 400);
    assert.match((await audioCaption.json()).error, /audio messages do not support captions/i);
    assert.equal(mediaUploadCalls, 2);

    const oversizedImageBody = new FormData();
    oversizedImageBody.set('file', new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/jpeg' }), 'oversized.jpg');
    const oversizedImage = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/conversation-dashboard/attachments', {
      method: 'POST', headers: { Authorization: 'Bearer recovery-secret' }, body: oversizedImageBody
    }), env, ctx);
    assert.equal(oversizedImage.status, 413);
    assert.match((await oversizedImage.json()).error, /WhatsApp image attachments may not exceed 5 MB/i);
    assert.equal(mediaUploadCalls, 2);

    const whatsappWebpBody = new FormData();
    whatsappWebpBody.set('file', new Blob(['webp'], { type: 'image/webp' }), 'unsupported.webp');
    const whatsappWebp = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/conversation-dashboard/attachments', {
      method: 'POST', headers: { Authorization: 'Bearer recovery-secret' }, body: whatsappWebpBody
    }), env, ctx);
    assert.equal(whatsappWebp.status, 415);
    assert.match((await whatsappWebp.json()).error, /must be JPEG or PNG/i);
    assert.equal(mediaUploadCalls, 2);

    database.prepare("UPDATE messages SET timestamp='2020-01-01T00:00:00.000Z' WHERE message_id='inbound-dashboard'").run();
    const blockedText = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/conversation-dashboard/messages', {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ text: 'Too late' })
    }), env);
    assert.equal(blockedText.status, 409);
    assert.match((await blockedText.json()).error, /24-hour service window/i);

    const closed = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/conversation-dashboard/messages', {
      headers: { Authorization: 'Bearer recovery-secret' }
    }), env);
    assert.equal((await closed.json()).freeformAllowed, false);

    const closedAttachmentBody = new FormData();
    closedAttachmentBody.set('file', new Blob(['late invoice'], { type: 'application/pdf' }), 'late.pdf');
    const blockedAttachment = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/conversation-dashboard/attachments', {
      method: 'POST', headers: { Authorization: 'Bearer recovery-secret' }, body: closedAttachmentBody
    }), env, ctx);
    assert.equal(blockedAttachment.status, 409);
    assert.match((await blockedAttachment.json()).error, /24-hour service window/i);
    assert.equal(mediaUploadCalls, 2);

    const lateTemplateMediaBody = new FormData();
    lateTemplateMediaBody.set('file', new Blob(['late template document'], { type: 'application/pdf' }), 'late-template.pdf');
    lateTemplateMediaBody.set('type', 'document');
    const lateTemplateMedia = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/conversation-dashboard/template-media', {
      method: 'POST', headers: { Authorization: 'Bearer recovery-secret' }, body: lateTemplateMediaBody
    }), env, ctx);
    assert.equal(lateTemplateMedia.status, 201);
    assert.equal((await lateTemplateMedia.json()).mediaId, 'media-dashboard-3');

    const allowedTemplate = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/conversation-dashboard/template', {
      method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ name: 'reopen_chat', language: { code: 'en_US' },
        components: [{ type: 'header', parameters: [{ type: 'image', image: { link: 'https://cdn.example.com/banner.jpg' } }] }],
        previewText: 'A'.repeat(5000) })
    }), env, ctx);
    assert.equal(allowedTemplate.status, 202);
    const allowedTemplateItem = (await allowedTemplate.clone().json()).item;
    assert.equal(allowedTemplateItem.status, 'pending');
    assert.equal(allowedTemplateItem.text, `${'A'.repeat(5000)}`);
    assert.equal(allowedTemplateItem.senderName, 'Emergency recovery');
    assert.equal(allowedTemplateItem.attachment.type, 'image');
    assert.equal(allowedTemplateItem.attachment.external, true);
    assert.equal(allowedTemplateItem.attachment.url, 'https://cdn.example.com/banner.jpg');
    assert.equal(database.prepare('SELECT message_type FROM messages WHERE message_id=?').get(allowedTemplateItem.messageId).message_type,
      'template');
    await Promise.all(pending.splice(0));
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('conversation template discovery is authenticated, workspace scoped, paginated, sanitized, and provider-safe', async () => {
  const { database, DB } = await testDatabase();
  const accessToken = 'template-discovery-access-token-value-1234567890';
  const env = envFor(DB, {
    ADMIN_TOKEN: 'recovery-secret', RECOVERY_MODE: 'true',
    CHANNEL_CREDENTIALS_KEY: 'test-channel-master-key-material-'.repeat(2)
  });
  const jsonHeaders = { Authorization: 'Bearer recovery-secret', 'Content-Type': 'application/json' };
  const denied = await handleRequest(new Request(
    'https://api.chat.helixcer.com/api/conversations/conversation-template-list/templates'
  ), env);
  assert.equal(denied.status, 401);

  const created = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ channelId: 'wa-template-list', name: 'Template WhatsApp', connectorType: 'whatsapp_cloud',
      config: { wabaId: '623456789012345', phoneNumberId: '623456789012346', apiVersion: 'v26.0' },
      credentials: { accessToken, appSecret: 'abcdef1234567890abcdef1234567890', verifyToken: 'template-verify-token' } })
  }), env);
  assert.equal(created.status, 201);
  const now = new Date().toISOString();
  database.prepare(`INSERT INTO contacts (contact_id,display_name,created_at,updated_at,workspace_id)
    VALUES ('contact-template-list','Asha',?,?, 'ws_default')`).run(now, now);
  database.prepare(`INSERT INTO channel_identities
      (identity_id,contact_id,channel_id,channel_profile_id,display_name,created_at,workspace_id)
    VALUES ('identity-template-list','contact-template-list','wa-template-list','919999999991','Asha',?,'ws_default')`).run(now);
  database.prepare(`INSERT INTO conversations
      (conversation_id,contact_id,channel_id,status,subject,last_message_at,created_at,updated_at,workspace_id)
    VALUES ('conversation-template-list','contact-template-list','wa-template-list','open','Asha',?,?,?,'ws_default')`)
    .run(now, now, now);
  const agentSessionToken = 'template-agent-session-token-that-is-long-enough';
  database.prepare(`INSERT INTO users
      (user_id,google_sub,email,display_name,email_verified,last_login_at,created_at,updated_at)
    VALUES ('template-agent','template-agent-sub','template-agent@example.com','Template agent',1,?,?,?)`)
    .run(now, now, now);
  database.prepare(`INSERT INTO memberships
      (membership_id,workspace_id,user_id,role,status,created_at,updated_at)
    VALUES ('template-agent-membership','ws_default','template-agent','agent','active',?,?)`).run(now, now);
  database.prepare(`INSERT INTO sessions
      (session_id,token_hash,user_id,workspace_id,expires_at,last_seen_at,created_at)
    VALUES ('template-agent-session',?,'template-agent','ws_default',?,?,?)`)
    .run(await hashToken(agentSessionToken), new Date(Date.now() + 3600000).toISOString(), now, now);

  const originalFetch = globalThis.fetch;
  const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const templateCache = new Map();
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {
      default: {
        async match(request) {
          return templateCache.get(request.url)?.clone();
        },
        async put(request, response) {
          templateCache.set(request.url, response.clone());
        }
      }
    }
  });
  const providerRequests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    providerRequests.push({ url, authorization: init.headers?.Authorization || '' });
    if (!url.searchParams.get('after')) {
      return new Response(JSON.stringify({
        data: [
          { id: 'template-1', name: 'order_update', language: 'en_US', status: 'APPROVED', category: 'UTILITY',
            provider_only: accessToken,
            components: [
              { type: 'BODY', text: 'Hello {{customer_name}}, order {{2}} is ready.',
                example: { body_text: [['Asha', '1001']], body_text_named_params: [
                  { param_name: 'customer_name', example: 'Asha' }
                ] } },
              { type: 'BUTTONS', buttons: [
                { type: 'URL', text: 'Track', url: 'https://shop.example/orders/{{1}}', example: ['1001'] }
              ] }
            ] },
          { id: 'template-draft', name: 'draft_only', language: 'en_US', status: 'PENDING', category: 'UTILITY' },
          { id: 'template-invalid', name: 'Bad Name', language: 'en_US', status: 'APPROVED', category: 'UTILITY' }
        ],
        paging: { cursors: { after: 'page-two-cursor' }, next: 'https://graph.facebook.com/next-page' }
      }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ data: [
      { id: 'template-2', name: 'invoice_ready', language: 'en_GB', status: 'APPROVED', category: 'UTILITY',
        components: [
          { type: 'HEADER', format: 'DOCUMENT' },
          { type: 'BODY', text: 'Invoice {{1}} is ready.', example: { body_text: [['INV-1001']] } }
        ] }
    ] }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const response = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/conversations/conversation-template-list/templates',
      { headers: { Cookie: `__Host-helixcer_session=${agentSessionToken}` } }
    ), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.items.map(item => item.name), ['invoice_ready', 'order_update']);
    assert.deepEqual(body.items[0].variables.map(item => [item.component, item.key, item.kind]), [
      ['header', 'media', 'document'], ['body', '1', 'text']
    ]);
    assert.ok(body.items[1].variables.some(item => item.key === 'customer_name'));
    assert.ok(body.items[1].variables.some(item => item.component === 'button' && item.kind === 'url'));
    assert.doesNotMatch(JSON.stringify(body), new RegExp(accessToken));
    assert.equal(providerRequests.length, 2);
    assert.equal(providerRequests[0].url.pathname, '/v26.0/623456789012345/message_templates');
    assert.equal(providerRequests[1].url.searchParams.get('after'), 'page-two-cursor');
    assert.equal(providerRequests[0].authorization, `Bearer ${accessToken}`);

    globalThis.fetch = async () => { throw new Error('Meta should not be called while the template cache is warm.'); };
    const cachedResponse = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/conversations/conversation-template-list/templates',
      { headers: { Cookie: `__Host-helixcer_session=${agentSessionToken}` } }
    ), env);
    assert.equal(cachedResponse.status, 200);
    assert.deepEqual((await cachedResponse.json()).items, body.items);
    assert.equal(providerRequests.length, 2);

    globalThis.fetch = async () => new Response(JSON.stringify({
      error: { message: `(#100) Missing permission for message templates (${accessToken})`, code: 100 }
    }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    const providerFailure = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/conversations/conversation-template-list/templates?refresh=1',
      { headers: { Authorization: 'Bearer recovery-secret' } }
    ), env);
    assert.equal(providerFailure.status, 422);
    const providerFailureBody = await providerFailure.json();
    assert.match(providerFailureBody.error, /Missing permission for message templates/);
    assert.doesNotMatch(JSON.stringify(providerFailureBody), new RegExp(accessToken));

    let crossWorkspaceFetches = 0;
    globalThis.fetch = async () => { crossWorkspaceFetches++; return new Response('{}'); };
    database.prepare(`INSERT INTO workspaces (workspace_id,slug,name,created_at,updated_at)
      VALUES ('ws_other','other','Other',?,?)`).run(now, now);
    database.prepare(`INSERT INTO channels
        (channel_id,name,connector_type,provider_type,enabled,capabilities_json,config_json,secret_key,created_at,updated_at,workspace_id)
      VALUES ('wa-other','Other WA','whatsapp_cloud','whatsapp_cloud',1,'["text"]','{"wabaId":"723456789012345","phoneNumberId":"723456789012346","apiVersion":"v26.0"}','OTHER',?,?, 'ws_other')`)
      .run(now, now);
    database.prepare(`INSERT INTO contacts (contact_id,display_name,created_at,updated_at,workspace_id)
      VALUES ('contact-other','Other',?,?, 'ws_other')`).run(now, now);
    database.prepare(`INSERT INTO channel_identities
        (identity_id,contact_id,channel_id,channel_profile_id,display_name,created_at,workspace_id)
      VALUES ('identity-other','contact-other','wa-other','911111111111','Other',?,'ws_other')`).run(now);
    database.prepare(`INSERT INTO conversations
        (conversation_id,contact_id,channel_id,status,subject,last_message_at,created_at,updated_at,workspace_id)
      VALUES ('conversation-other','contact-other','wa-other','open','Other',?,?,?,'ws_other')`).run(now, now, now);
    const scoped = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/conversations/conversation-other/templates',
      { headers: { Authorization: 'Bearer recovery-secret' } }
    ), env);
    assert.equal(scoped.status, 404);
    assert.equal(crossWorkspaceFetches, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches);
    else delete globalThis.caches;
    database.close();
  }
});

test('workspace WhatsApp template library aggregates every account and contains partial provider failures', async () => {
  const { database, DB } = await testDatabase();
  const alphaToken = 'template-library-alpha-token-value-1234567890';
  const betaToken = 'template-library-beta-token-value-1234567890';
  const disabledToken = 'template-library-disabled-token-value-1234567890';
  const env = envFor(DB, {
    ADMIN_TOKEN: 'recovery-secret', RECOVERY_MODE: 'true',
    CHANNEL_CREDENTIALS_KEY: 'test-channel-master-key-material-'.repeat(2)
  });
  const jsonHeaders = { Authorization: 'Bearer recovery-secret', 'Content-Type': 'application/json' };
  const endpoint = 'https://api.chat.helixcer.com/api/channel-data/whatsapp-templates';

  const denied = await handleRequest(new Request(endpoint), env);
  assert.equal(denied.status, 401);

  const now = new Date().toISOString();
  const agentSessionToken = 'template-library-agent-session-token-long-enough';
  database.prepare(`INSERT INTO users
      (user_id,google_sub,email,display_name,email_verified,last_login_at,created_at,updated_at)
    VALUES ('template-library-agent','template-library-agent-sub','library-agent@example.com','Library agent',1,?,?,?)`)
    .run(now, now, now);
  database.prepare(`INSERT INTO memberships
      (membership_id,workspace_id,user_id,role,status,created_at,updated_at)
    VALUES ('template-library-agent-membership','ws_default','template-library-agent','agent','active',?,?)`).run(now, now);
  database.prepare(`INSERT INTO sessions
      (session_id,token_hash,user_id,workspace_id,expires_at,last_seen_at,created_at)
    VALUES ('template-library-agent-session',?,'template-library-agent','ws_default',?,?,?)`)
    .run(await hashToken(agentSessionToken), new Date(Date.now() + 3600000).toISOString(), now, now);
  const agentDenied = await handleRequest(new Request(endpoint, {
    headers: { Cookie: `__Host-helixcer_session=${agentSessionToken}` }
  }), env);
  assert.equal(agentDenied.status, 403);

  const channelDefinitions = [
    {
      channelId: 'wa-library-alpha', name: 'Alpha WhatsApp', enabled: true,
      config: { wabaId: '111111111111111', phoneNumberId: '111111111111112', apiVersion: 'v26.0' },
      credentials: { accessToken: alphaToken, appSecret: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', verifyToken: 'alpha-library-verify' }
    },
    {
      channelId: 'wa-library-beta', name: 'Beta WhatsApp', enabled: true,
      config: { wabaId: '222222222222222', phoneNumberId: '222222222222223', apiVersion: 'v25.0' },
      credentials: { accessToken: betaToken, appSecret: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', verifyToken: 'beta-library-verify' }
    },
    {
      channelId: 'wa-library-disabled', name: 'Disabled WhatsApp', enabled: false,
      config: { wabaId: '333333333333333', phoneNumberId: '333333333333334', apiVersion: 'v26.0' },
      credentials: { accessToken: disabledToken, appSecret: 'cccccccccccccccccccccccccccccccc', verifyToken: 'disabled-library-verify' }
    }
  ];
  for (const definition of channelDefinitions) {
    const created = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
      method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ ...definition, connectorType: 'whatsapp_cloud' })
    }), env);
    assert.equal(created.status, 201);
  }
  const alphaConfig = JSON.parse(database.prepare("SELECT config_json FROM channels WHERE channel_id='wa-library-alpha'").get().config_json);
  alphaConfig.verifiedName = 'Alpha Store';
  alphaConfig.verifiedPhoneNumber = '+1 555 0100';
  database.prepare("UPDATE channels SET config_json=? WHERE channel_id='wa-library-alpha'").run(JSON.stringify(alphaConfig));

  const telegram = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ channelId: 'telegram-library', name: 'Telegram Library', connectorType: 'telegram',
      credentials: { botToken: '123456789:abcdefghijklmnopqrstuvwxyz_123456', webhookSecret: 'telegram_library_secret' } })
  }), env);
  assert.equal(telegram.status, 201);

  database.prepare(`INSERT INTO workspaces (workspace_id,slug,name,created_at,updated_at)
    VALUES ('ws_library_other','library-other','Library Other',?,?)`).run(now, now);
  database.prepare(`INSERT INTO channels
      (channel_id,name,connector_type,provider_type,enabled,capabilities_json,config_json,secret_key,created_at,updated_at,workspace_id)
    VALUES ('wa-library-other','Other Workspace WhatsApp','whatsapp_cloud','whatsapp_cloud',1,'["text"]',
      '{"wabaId":"444444444444444","phoneNumberId":"444444444444445","apiVersion":"v26.0"}',
      'DATABASE',?,?, 'ws_library_other')`).run(now, now);

  const originalFetch = globalThis.fetch;
  const providerRequests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const authorization = init.headers?.Authorization || '';
    providerRequests.push({ url, authorization });
    if (url.pathname.includes('/111111111111111/message_templates')) {
      assert.equal(url.searchParams.has('status'), false);
      if (!url.searchParams.get('after')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'alpha-approved', name: 'alpha_order_update', language: 'en_US', status: 'APPROVED', category: 'UTILITY',
              components: [{ type: 'BODY', text: 'Order {{1}} is ready.' }] },
            { id: 'alpha-pending', name: 'alpha_promotion', language: 'en_US', status: 'PENDING', category: 'MARKETING',
              components: [{ type: 'BODY', text: 'Save {{1}} today.' }] }
          ],
          paging: { cursors: { after: 'alpha-page-two' }, next: 'https://graph.facebook.com/next' }
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: [
        { id: 'alpha-rejected', name: 'alpha_rejected', language: 'ml', status: 'REJECTED', category: 'AUTHENTICATION',
          components: [{ type: 'BODY', text: 'Code {{1}}.' }] }
      ] }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.includes('/222222222222222/message_templates')) {
      return new Response(JSON.stringify({
        error: { message: `Token ${betaToken} cannot read this WABA`, code: 100 }
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.includes('/333333333333333/message_templates')) {
      return new Response(JSON.stringify({ data: [
        { id: 'disabled-approved', name: 'disabled_account_template', language: 'ar', status: 'APPROVED', category: 'UTILITY',
          components: [{ type: 'BODY', text: 'Disabled account preview.' }] }
      ] }), { headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected provider request: ${url.pathname}`);
  };
  try {
    const response = await handleRequest(new Request(endpoint, { headers: { Authorization: 'Bearer recovery-secret' } }), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.items.map(item => item.name), [
      'alpha_order_update', 'alpha_promotion', 'alpha_rejected', 'disabled_account_template'
    ]);
    assert.deepEqual(body.items.map(item => item.status), ['APPROVED', 'PENDING', 'REJECTED', 'APPROVED']);
    const alphaItem = body.items.find(item => item.name === 'alpha_order_update');
    assert.equal(alphaItem.channelId, 'wa-library-alpha');
    assert.equal(alphaItem.channelName, 'Alpha WhatsApp');
    assert.equal(alphaItem.channelEnabled, true);
    assert.equal(alphaItem.providerDisplayName, 'Alpha Store');
    assert.ok(alphaItem.variables.some(variable => variable.key === '1'));
    const disabledItem = body.items.find(item => item.name === 'disabled_account_template');
    assert.equal(disabledItem.channelId, 'wa-library-disabled');
    assert.equal(disabledItem.channelEnabled, false);

    assert.deepEqual(body.errors.map(item => item.channelId), ['wa-library-beta']);
    assert.equal(body.errors[0].channelEnabled, true);
    assert.match(body.errors[0].error, /cannot read this WABA/);
    assert.doesNotMatch(JSON.stringify(body), new RegExp(betaToken));
    assert.doesNotMatch(JSON.stringify(body), new RegExp(alphaToken));
    assert.doesNotMatch(JSON.stringify(body), new RegExp(disabledToken));

    assert.deepEqual(body.filterOptions.categories, ['AUTHENTICATION', 'MARKETING', 'UTILITY']);
    assert.deepEqual(body.filterOptions.statuses, ['APPROVED', 'PENDING', 'REJECTED']);
    assert.deepEqual(body.filterOptions.languages, ['ar', 'en_US', 'ml']);
    assert.deepEqual(body.filterOptions.channels.map(item => item.value), [
      'wa-library-alpha', 'wa-library-beta', 'wa-library-disabled'
    ]);
    assert.equal(body.filterOptions.channels.find(item => item.value === 'wa-library-disabled').channelEnabled, false);
    assert.equal(providerRequests.length, 4);
    assert.equal(providerRequests.some(item => item.url.pathname.includes('444444444444444')), false);
    assert.equal(providerRequests.some(item => item.url.pathname.includes('telegram')), false);
    assert.equal(providerRequests.find(item => item.url.pathname.includes('222222222222222')).url.pathname,
      '/v25.0/222222222222222/message_templates');
    assert.equal(providerRequests.filter(item => item.url.pathname.includes('111111111111111')).length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('contact detail and update APIs preserve conversations, keep Channel Profile IDs immutable, and stay workspace scoped', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB, {
    ADMIN_TOKEN: 'recovery-secret', RECOVERY_MODE: 'true',
    CHANNEL_CREDENTIALS_KEY: 'test-channel-master-key-material-'.repeat(2)
  });
  const jsonHeaders = { Authorization: 'Bearer recovery-secret', 'Content-Type': 'application/json' };
  const createdChannel = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ channelId: 'wa-contact-api', name: 'Support WhatsApp', connectorType: 'whatsapp_cloud',
      config: { wabaId: '823456789012345', phoneNumberId: '823456789012346', apiVersion: 'v26.0' },
      credentials: { accessToken: 'contact-api-access-token-value-1234567890',
        appSecret: 'fedcba0987654321fedcba0987654321', verifyToken: 'contact-api-verify-token' } })
  }), env);
  assert.equal(createdChannel.status, 201);
  const config = JSON.parse(database.prepare("SELECT config_json FROM channels WHERE channel_id='wa-contact-api'").get().config_json);
  config.credentialsVerifiedAt = new Date().toISOString();
  config.webhookVerifiedAt = new Date().toISOString();
  database.prepare("UPDATE channels SET config_json=? WHERE channel_id='wa-contact-api'").run(JSON.stringify(config));
  const createdTelegram = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ channelId: 'telegram-contact-api', name: 'Support Telegram', connectorType: 'telegram',
      credentials: { botToken: '123456789:abcdefghijklmnopqrstuvwxyz_123456', webhookSecret: 'secret_telegram_contact_api' } })
  }), env);
  assert.equal(createdTelegram.status, 201);
  const agentNow = new Date().toISOString();
  const agentSessionToken = 'contact-agent-session-token-that-is-long-enough';
  database.prepare(`INSERT INTO users
      (user_id,google_sub,email,display_name,email_verified,last_login_at,created_at,updated_at)
    VALUES ('contact-agent','contact-agent-sub','contact-agent@example.com','Contact agent',1,?,?,?)`)
    .run(agentNow, agentNow, agentNow);
  database.prepare(`INSERT INTO memberships
      (membership_id,workspace_id,user_id,role,status,created_at,updated_at)
    VALUES ('contact-agent-membership','ws_default','contact-agent','agent','active',?,?)`).run(agentNow, agentNow);
  database.prepare(`INSERT INTO sessions
      (session_id,token_hash,user_id,workspace_id,expires_at,last_seen_at,created_at)
    VALUES ('contact-agent-session',?,'contact-agent','ws_default',?,?,?)`)
    .run(await hashToken(agentSessionToken), new Date(Date.now() + 3600000).toISOString(), agentNow, agentNow);
  const agentJsonHeaders = {
    Cookie: `__Host-helixcer_session=${agentSessionToken}`,
    Origin: 'https://chat.helixcer.com',
    'Content-Type': 'application/json'
  };

  const created = await handleRequest(new Request('https://api.chat.helixcer.com/api/contacts', {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ displayName: 'Asha Rao', company: 'Acme', tags: ['VIP', 'Retail'],
      channelId: 'wa-contact-api', channelProfileId: '+91 99999 99991' })
  }), env);
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.item.company, 'Acme');
  assert.deepEqual(createdBody.item.tags, ['VIP', 'Retail']);
  assert.equal(createdBody.item.channelName, 'Support WhatsApp');
  assert.equal(createdBody.item.connectorType, 'whatsapp_cloud');
  assert.equal(createdBody.item.channelProfileId, '919999999991');

  const contactId = createdBody.contactId;
  const conversationId = createdBody.conversationId;
  const denied = await handleRequest(new Request(`https://api.chat.helixcer.com/api/contacts/${contactId}`), env);
  assert.equal(denied.status, 401);
  const detail = await handleRequest(new Request(`https://api.chat.helixcer.com/api/contacts/${contactId}`, {
    headers: { Cookie: `__Host-helixcer_session=${agentSessionToken}` }
  }), env);
  assert.equal(detail.status, 200);
  const detailBody = await detail.json();
  assert.equal(detailBody.item.name, 'Asha Rao');
  assert.equal(detailBody.item.channelEditable, false);

  const updated = await handleRequest(new Request(`https://api.chat.helixcer.com/api/contacts/${contactId}`, {
    method: 'PATCH', headers: agentJsonHeaders,
    body: JSON.stringify({ name: 'Asha R.', company: 'Acme Retail', tags: ['Priority', 'priority', 'West'] })
  }), env);
  assert.equal(updated.status, 200);
  const updatedBody = await updated.json();
  assert.equal(updatedBody.item.displayName, 'Asha R.');
  assert.equal(updatedBody.item.company, 'Acme Retail');
  assert.deepEqual(updatedBody.item.tags, ['Priority', 'West']);
  assert.equal(updatedBody.item.channelProfileId, '919999999991');
  const preservedConversation = database.prepare(`SELECT subject,tags_json FROM conversations
    WHERE conversation_id=?`).get(conversationId);
  assert.equal(preservedConversation.subject, 'Asha R.');
  assert.deepEqual(JSON.parse(preservedConversation.tags_json), ['Priority', 'West']);

  const immutableChannelProfileId = await handleRequest(new Request(`https://api.chat.helixcer.com/api/contacts/${contactId}`, {
    method: 'PATCH', headers: jsonHeaders,
    body: JSON.stringify({ channelProfileId: '+91 99999 99992' })
  }), env);
  assert.equal(immutableChannelProfileId.status, 400);
  assert.match((await immutableChannelProfileId.json()).error, /Channel Profile ID cannot be changed/i);

  const reassigned = await handleRequest(new Request(`https://api.chat.helixcer.com/api/contacts/${contactId}`, {
    method: 'PATCH', headers: jsonHeaders,
    body: JSON.stringify({ channelId: 'telegram-contact-api' })
  }), env);
  assert.equal(reassigned.status, 400);
  assert.match((await reassigned.json()).error, /contact identity route/i);
  assert.equal(database.prepare('SELECT channel_id FROM conversations WHERE conversation_id=?').get(conversationId).channel_id,
    'wa-contact-api');

  database.prepare(`INSERT INTO messages
      (message_id,conversation_id,contact_id,channel_id,direction,message_type,text,status,timestamp,workspace_id)
    VALUES ('contact-history',?1,?2,'wa-contact-api','inbound','text','Hello','received',?3,'ws_default')`)
    .run(conversationId, contactId, new Date().toISOString());
  const lockedChannel = await handleRequest(new Request(`https://api.chat.helixcer.com/api/contacts/${contactId}`, {
    method: 'PATCH', headers: jsonHeaders,
    body: JSON.stringify({ channelId: 'wa-contact-api' })
  }), env);
  assert.equal(lockedChannel.status, 200);
  const lockedDetail = await handleRequest(new Request(`https://api.chat.helixcer.com/api/contacts/${contactId}`, {
    headers: { Authorization: 'Bearer recovery-secret' }
  }), env);
  assert.equal((await lockedDetail.json()).item.channelEditable, false);

  const now = new Date().toISOString();
  database.prepare(`INSERT INTO contacts
      (contact_id,display_name,company,tags_json,created_at,updated_at,workspace_id)
    VALUES ('contact-conflict','Conflict','','[]',?,?, 'ws_default')`).run(now, now);
  database.prepare(`INSERT INTO channel_identities
      (identity_id,contact_id,channel_id,channel_profile_id,display_name,created_at,workspace_id)
    VALUES ('identity-conflict','contact-conflict','telegram-contact-api','919999999993','Conflict',?,'ws_default')`).run(now);
  const conflict = await handleRequest(new Request(`https://api.chat.helixcer.com/api/contacts/${contactId}`, {
    method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ channelProfileId: '919999999993' })
  }), env);
  assert.equal(conflict.status, 400);
  assert.match((await conflict.json()).error, /Channel Profile ID cannot be changed/i);
  assert.equal(database.prepare('SELECT channel_profile_id FROM channel_identities WHERE contact_id=?').get(contactId).channel_profile_id,
    '919999999991');
  assert.equal(database.prepare('SELECT count(*) AS count FROM conversations WHERE conversation_id=?').get(conversationId).count, 1);

  const invalidTags = await handleRequest(new Request(`https://api.chat.helixcer.com/api/contacts/${contactId}`, {
    method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ tags: 'Priority' })
  }), env);
  assert.equal(invalidTags.status, 400);

  const list = await handleRequest(new Request('https://api.chat.helixcer.com/api/contacts', {
    headers: { Authorization: 'Bearer recovery-secret' }
  }), env);
  const listItem = (await list.json()).items.find(item => item.contactId === contactId);
  assert.equal(listItem.company, 'Acme Retail');
  assert.equal(listItem.channelName, 'Support WhatsApp');
  assert.equal(listItem.connectorType, 'whatsapp_cloud');

  database.prepare(`INSERT INTO workspaces (workspace_id,slug,name,created_at,updated_at)
    VALUES ('ws_contact_other','contact-other','Other Contacts',?,?)`).run(now, now);
  database.prepare(`INSERT INTO contacts
      (contact_id,display_name,company,tags_json,created_at,updated_at,workspace_id)
    VALUES ('contact-private','Private','Other','["Hidden"]',?,?, 'ws_contact_other')`).run(now, now);
  const privateContact = await handleRequest(new Request('https://api.chat.helixcer.com/api/contacts/contact-private', {
    headers: { Authorization: 'Bearer recovery-secret' }
  }), env);
  assert.equal(privateContact.status, 404);
  database.close();
});

test('workspace tag catalogue is server-derived, canonical, bootstrap-visible, and workspace scoped', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB, { ADMIN_TOKEN: 'recovery-secret', RECOVERY_MODE: 'true' });
  const headers = { Authorization: 'Bearer recovery-secret' };
  const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };
  const now = new Date().toISOString();
  database.prepare(`INSERT INTO workspaces (workspace_id,slug,name,created_at,updated_at)
    VALUES ('ws_tag_other','tag-other','Other tag workspace',?,?)`).run(now, now);
  database.prepare(`INSERT INTO channels
      (channel_id,name,connector_type,provider_type,enabled,capabilities_json,config_json,secret_key,created_at,updated_at,workspace_id)
    VALUES ('tag-channel','Tag channel','generic_http','generic_http',1,'["text"]','{}','TAG_TEST',?,?, 'ws_default')`)
    .run(now, now);
  database.prepare(`INSERT INTO contacts
      (contact_id,display_name,company,tags_json,created_at,updated_at,workspace_id)
    VALUES ('tag-one','Tag One','','["VIP","Retail","priority"]',?,?,'ws_default'),
      ('tag-two','Tag Two','','["vip","West"," Priority ","",42]',?,?,'ws_default'),
      ('tag-invalid','Invalid','','not-json',?,?,'ws_default'),
      ('tag-private','Private','','["Hidden"]',?,?,'ws_tag_other')`)
    .run(now, now, now, now, now, now, now, now);
  database.prepare(`INSERT INTO channel_identities
      (identity_id,contact_id,channel_id,channel_profile_id,display_name,created_at,workspace_id)
    VALUES ('tag-identity','tag-one','tag-channel','tag-profile','Tag One',?,'ws_default')`).run(now);

  const unauthenticated = await handleRequest(new Request('https://api.chat.helixcer.com/api/tags'), env);
  assert.equal(unauthenticated.status, 401);

  const response = await handleRequest(new Request('https://api.chat.helixcer.com/api/tags', { headers }), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items, ['Priority', 'Retail', 'VIP', 'West']);

  const updated = await handleRequest(new Request('https://api.chat.helixcer.com/api/contacts/tag-one', {
    method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ tags: ['VIP', 'New Tag'] })
  }), env);
  const updatedBody = await updated.json();
  assert.equal(updated.status, 200, JSON.stringify(updatedBody));
  const refreshed = await handleRequest(new Request('https://api.chat.helixcer.com/api/tags', { headers }), env);
  assert.deepEqual((await refreshed.json()).items, ['New Tag', 'Priority', 'VIP', 'West']);

  const bootstrap = await handleRequest(new Request('https://api.chat.helixcer.com/api/bootstrap', { headers }), env);
  assert.equal(bootstrap.status, 200);
  assert.deepEqual((await bootstrap.json()).tags, ['New Tag', 'Priority', 'VIP', 'West']);
  database.close();
});

test('conversation, contact, and channel deletion removes only local workspace data and never calls providers', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB, { ADMIN_TOKEN: 'recovery-secret', RECOVERY_MODE: 'true' });
  const headers = { Authorization: 'Bearer recovery-secret' };
  const now = new Date().toISOString();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls++;
    throw new Error('Channel deletion must not call a provider.');
  };
  try {
    database.prepare(`INSERT INTO channels
        (channel_id,name,connector_type,provider_type,enabled,capabilities_json,config_json,secret_key,created_at,updated_at,workspace_id)
      VALUES ('delete-channel','Delete WhatsApp','whatsapp_cloud','whatsapp_cloud',1,'["text"]','{}','DELETE_TEST',?,?, 'ws_default'),
        ('keep-channel','Keep Telegram','telegram','telegram',1,'["text"]','{}','KEEP_TEST',?,?, 'ws_default'),
        ('empty-delete-channel','Unused channel','generic_http','generic_http',1,'["text"]','{}','EMPTY_DELETE_TEST',?,?, 'ws_default')`)
      .run(now, now, now, now, now, now);
    database.prepare(`INSERT INTO contacts (contact_id,display_name,created_at,updated_at,workspace_id)
      VALUES ('delete-exclusive','Exclusive',?,?, 'ws_default'),('delete-shared','Shared',?,?, 'ws_default')`)
      .run(now, now, now, now);
    database.prepare(`INSERT INTO channel_identities
        (identity_id,contact_id,channel_id,channel_profile_id,display_name,created_at,workspace_id)
      VALUES ('identity-exclusive','delete-exclusive','delete-channel','profile-exclusive','Exclusive',?,'ws_default'),
        ('identity-shared-delete','delete-shared','delete-channel','profile-shared-a','Shared',?,'ws_default'),
        ('identity-shared-keep','delete-shared','keep-channel','profile-shared-b','Shared',?,'ws_default')`)
      .run(now, now, now);
    database.prepare(`INSERT INTO conversations
        (conversation_id,contact_id,channel_id,status,subject,last_message_at,unread_count,created_at,updated_at,workspace_id)
      VALUES ('conversation-delete','delete-exclusive','delete-channel','open','Exclusive',?,0,?,?,'ws_default'),
        ('conversation-keep','delete-shared','keep-channel','open','Shared B',?,0,?,?,'ws_default')`)
      .run(now, now, now, now, now, now);
    database.prepare(`INSERT INTO messages
        (message_id,conversation_id,contact_id,channel_id,direction,message_type,text,status,timestamp,workspace_id)
      VALUES ('message-delete','conversation-delete','delete-exclusive','delete-channel','outbound','text','Delete','pending',?,'ws_default'),
        ('message-shared-delete','conversation-keep','delete-shared','delete-channel','inbound','text','Delete shared','received',?,'ws_default'),
        ('message-keep','conversation-keep','delete-shared','keep-channel','inbound','text','Keep','received',?,'ws_default')`)
      .run(now, now, now);
    database.prepare(`INSERT INTO outbox
        (outbox_id,message_id,attempts,max_attempts,next_attempt_at,status,created_at,updated_at,workspace_id)
      VALUES ('outbox-delete','message-delete',0,6,?,'pending',?,?,'ws_default')`).run(now, now, now);
    database.prepare(`INSERT INTO outbound_payloads (message_id,workspace_id,encrypted_payload,created_at,updated_at)
      VALUES ('message-delete','ws_default','encrypted',?,?)`).run(now, now);
    database.prepare(`INSERT INTO api_keys
        (api_key_id,workspace_id,name,key_prefix,secret_hash,scopes_json,allowed_channel_ids_json,status,created_at,updated_at)
      VALUES ('delete-api-key','ws_default','Delete key','hxc_live_delete','delete-hash','[]','[]','active',?,?)`).run(now, now);
    database.prepare(`INSERT INTO external_api_requests
        (request_id,workspace_id,api_key_id,operation,idempotency_key_hash,request_hash,message_id,created_at,expires_at)
      VALUES ('external-delete','ws_default','delete-api-key','send','idem-delete','request-delete','message-delete',?,?)`)
      .run(now, new Date(Date.now() + 3600000).toISOString());
    database.prepare(`INSERT INTO channel_credentials
        (workspace_id,channel_id,credential_key,encrypted_value,created_at,updated_at)
      VALUES ('ws_default','delete-channel','accessToken','encrypted',?,?)`).run(now, now);
    database.prepare(`INSERT INTO webhook_events (event_key,channel_id,event_type,received_at,workspace_id)
      VALUES ('delete-webhook','delete-channel','message',?,'ws_default')`).run(now);

    const deletedChannelResponse = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/channels/delete-channel', { method: 'DELETE', headers }
    ), env);
    assert.equal(deletedChannelResponse.status, 409);
    assert.match((await deletedChannelResponse.json()).error, /conversation history/i);
    assert.equal(providerCalls, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM channels WHERE channel_id='delete-channel'").get().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM messages WHERE channel_id='delete-channel'").get().count, 2);

    const emptyDeletedResponse = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/channels/empty-delete-channel', { method: 'DELETE', headers }
    ), env);
    assert.equal(emptyDeletedResponse.status, 200);
    const emptyDeleted = await emptyDeletedResponse.json();
    assert.equal(emptyDeleted.localOnly, true);
    assert.equal(emptyDeleted.deletedConversations, 0);
    assert.equal(emptyDeleted.deletedMessages, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM channels WHERE channel_id='empty-delete-channel'").get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM contacts WHERE contact_id='delete-exclusive'").get().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM contacts WHERE contact_id='delete-shared'").get().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM conversations WHERE conversation_id='conversation-keep'").get().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM messages WHERE message_id='message-keep'").get().count, 1);

    const deletedConversationResponse = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/conversations/conversation-keep', { method: 'DELETE', headers }
    ), env);
    assert.equal(deletedConversationResponse.status, 200);
    assert.equal((await deletedConversationResponse.json()).deletedMessages, 2);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM conversations WHERE conversation_id='conversation-keep'").get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM messages WHERE message_id='message-keep'").get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM messages WHERE message_id='message-shared-delete'").get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM contacts WHERE contact_id='delete-shared'").get().count, 1);

    database.prepare(`INSERT INTO conversations
        (conversation_id,contact_id,channel_id,status,subject,last_message_at,unread_count,created_at,updated_at,workspace_id)
      VALUES ('contact-conversation','delete-shared','keep-channel','closed','Shared B',?,0,?,?,'ws_default')`)
      .run(now, now, now);
    database.prepare(`INSERT INTO messages
        (message_id,conversation_id,contact_id,channel_id,direction,message_type,text,status,timestamp,workspace_id)
      VALUES ('contact-message','contact-conversation','delete-shared','keep-channel','inbound','text','Delete contact','received',?,'ws_default')`)
      .run(now);
    const deletedContactResponse = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/contacts/delete-shared', { method: 'DELETE', headers }
    ), env);
    assert.equal(deletedContactResponse.status, 200);
    const deletedContact = await deletedContactResponse.json();
    assert.deepEqual(deletedContact.conversationIds, ['contact-conversation']);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM contacts WHERE contact_id='delete-shared'").get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM channel_identities WHERE contact_id='delete-shared'").get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM conversations WHERE contact_id='delete-shared'").get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM messages WHERE contact_id='delete-shared'").get().count, 0);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('conversation deletion removes WhatsApp media ids so provider storage can be reused', async () => {
  const credentialKey = 'test-channel-master-key-material-'.repeat(2);
  const { database, DB } = await testDatabase();
  const env = envFor(DB, {
    ADMIN_TOKEN: 'recovery-secret',
    RECOVERY_MODE: 'true',
    CHANNEL_CREDENTIALS_KEY: credentialKey
  });
  const headers = { Authorization: 'Bearer recovery-secret' };
  const now = new Date().toISOString();
  const encryptedToken = await encryptChannelCredential('EAAtest-delete-media-token', credentialKey,
    'ws_default', 'media-delete-channel', 'accessToken');
  const deletedMediaUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method || 'GET').toUpperCase();
    if (method === 'DELETE' && /graph\.facebook\.com\/v26\.0\/media-(keep|drop|gone)/.test(url)) {
      deletedMediaUrls.push(url);
      const status = url.includes('media-gone') ? 404 : 200;
      return new Response(JSON.stringify({ success: true }), {
        status, headers: { 'Content-Type': 'application/json' }
      });
    }
    throw new Error(`Unexpected provider call: ${method} ${url}`);
  };
  try {
    database.prepare(`INSERT INTO channels
        (channel_id,name,connector_type,provider_type,enabled,capabilities_json,config_json,secret_key,created_at,updated_at,workspace_id)
      VALUES ('media-delete-channel','Media delete','whatsapp_cloud','whatsapp_cloud',1,'["text"]',
        '{"phoneNumberId":"1234567890","apiVersion":"v26.0"}','MEDIA_DELETE',?,?, 'ws_default'),
        ('media-keep-channel','Keep Telegram','telegram','telegram',1,'["text"]','{}','MEDIA_KEEP',?,?, 'ws_default')`)
      .run(now, now, now, now);
    database.prepare(`INSERT INTO channel_credentials
        (workspace_id,channel_id,credential_key,encrypted_value,created_at,updated_at)
      VALUES ('ws_default','media-delete-channel','accessToken',?,?,?)`).run(encryptedToken, now, now);
    database.prepare(`INSERT INTO contacts (contact_id,display_name,created_at,updated_at,workspace_id)
      VALUES ('media-contact','Media Contact',?,?, 'ws_default')`).run(now, now);
    database.prepare(`INSERT INTO conversations
        (conversation_id,contact_id,channel_id,status,subject,last_message_at,unread_count,created_at,updated_at,workspace_id)
      VALUES ('media-conversation','media-contact','media-delete-channel','open','Media Contact',?,0,?,?,'ws_default')`)
      .run(now, now, now);
    database.prepare(`INSERT INTO messages
        (message_id,conversation_id,contact_id,channel_id,direction,message_type,text,status,timestamp,payload_json,workspace_id)
      VALUES ('media-image','media-conversation','media-contact','media-delete-channel','outbound','image','[image: a.jpg]','sent',?,
          '{"attachment":{"type":"image","filename":"a.jpg","providerMediaId":"media-keep"}}','ws_default'),
        ('media-doc','media-conversation','media-contact','media-delete-channel','inbound','document','[document: b.pdf]','received',?,
          '{"attachment":{"type":"document","filename":"b.pdf","providerMediaId":"media-drop"}}','ws_default'),
        ('media-gone','media-conversation','media-contact','media-delete-channel','outbound','video','[video: c.mp4]','sent',?,
          '{"attachment":{"type":"video","filename":"c.mp4","providerMediaId":"media-gone"}}','ws_default'),
        ('media-telegram','media-conversation','media-contact','media-keep-channel','outbound','image','[image: d.jpg]','sent',?,
          '{"attachment":{"type":"image","filename":"d.jpg","providerFileId":"tg-file-1"}}','ws_default'),
        ('media-text','media-conversation','media-contact','media-delete-channel','outbound','text','hello','sent',?,'{}','ws_default')`)
      .run(now, now, now, now, now);
    database.prepare(`INSERT INTO outbound_payloads (message_id,workspace_id,encrypted_payload,created_at,updated_at)
      VALUES ('media-image','ws_default','encrypted-media',?,?)`).run(now, now);

    const response = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/conversations/media-conversation', { method: 'DELETE', headers }
    ), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.deleted, true);
    assert.equal(body.deletedMessages, 5);
    assert.equal(body.deletedMedia, 3);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM conversations WHERE conversation_id='media-conversation'").get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM messages WHERE conversation_id='media-conversation'").get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM outbound_payloads WHERE message_id='media-image'").get().count, 0);
    assert.equal(deletedMediaUrls.length, 3);
    assert.ok(deletedMediaUrls.every(url => url.includes('/v26.0/media-')));
    assert.ok(deletedMediaUrls.some(url => url.endsWith('/media-keep')));
    assert.ok(deletedMediaUrls.some(url => url.endsWith('/media-drop')));
    assert.ok(deletedMediaUrls.some(url => url.endsWith('/media-gone')));
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('team member deletion follows role hierarchy, revokes access, and protects the last active owner', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB, { ADMIN_TOKEN: 'recovery-secret', RECOVERY_MODE: 'true' });
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 3600000).toISOString();
  const adminToken = 'delete-admin-session-token-that-is-long-enough';
  for (const [userId, sub, email, name] of [
    ['delete-owner', 'delete-owner-sub', 'delete-owner@example.com', 'Delete owner'],
    ['delete-admin', 'delete-admin-sub', 'delete-admin@example.com', 'Delete admin'],
    ['delete-agent-one', 'delete-agent-one-sub', 'delete-agent-one@example.com', 'Delete agent one'],
    ['delete-agent-two', 'delete-agent-two-sub', 'delete-agent-two@example.com', 'Delete agent two']
  ]) {
    database.prepare(`INSERT INTO users
        (user_id,google_sub,email,display_name,email_verified,last_login_at,created_at,updated_at)
      VALUES (?,?,?,?,1,?,?,?)`).run(userId, sub, email, name, now, now, now);
  }
  for (const [membershipId, userId, role] of [
    ['delete-owner-membership', 'delete-owner', 'owner'],
    ['delete-admin-membership', 'delete-admin', 'admin'],
    ['delete-agent-one-membership', 'delete-agent-one', 'agent'],
    ['delete-agent-two-membership', 'delete-agent-two', 'agent']
  ]) {
    database.prepare(`INSERT INTO memberships
        (membership_id,workspace_id,user_id,role,status,created_at,updated_at)
      VALUES (?,'ws_default',?,?,'active',?,?)`).run(membershipId, userId, role, now, now);
  }
  database.prepare(`INSERT INTO sessions
      (session_id,token_hash,user_id,workspace_id,expires_at,last_seen_at,created_at)
    VALUES ('delete-admin-session',?,'delete-admin','ws_default',?,?,?),
      ('delete-agent-session','agent-session-hash','delete-agent-one','ws_default',?,?,?)`)
    .run(await hashToken(adminToken), expiresAt, now, now, expiresAt, now, now);
  database.prepare(`INSERT INTO channels
      (channel_id,name,connector_type,provider_type,enabled,capabilities_json,config_json,secret_key,created_at,updated_at,workspace_id)
    VALUES ('team-delete-channel','Team','telegram','telegram',1,'["text"]','{}','TEAM',?,?, 'ws_default')`).run(now, now);
  database.prepare(`INSERT INTO contacts (contact_id,display_name,created_at,updated_at,workspace_id)
    VALUES ('team-delete-contact','Assigned contact',?,?, 'ws_default')`).run(now, now);
  database.prepare(`INSERT INTO conversations
      (conversation_id,contact_id,channel_id,status,assigned_to,subject,last_message_at,unread_count,created_at,updated_at,workspace_id)
    VALUES ('team-delete-conversation','team-delete-contact','team-delete-channel','open','delete-agent-one@example.com','Assigned',?,0,?,?,'ws_default')`)
    .run(now, now, now);

  const adminHeaders = {
    Cookie: `__Host-helixcer_session=${adminToken}`,
    Origin: 'https://chat.helixcer.com'
  };
  const deniedOwner = await handleRequest(new Request(
    'https://api.chat.helixcer.com/api/team/members/delete-owner-membership', { method: 'DELETE', headers: adminHeaders }
  ), env);
  assert.equal(deniedOwner.status, 403);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM memberships WHERE membership_id='delete-owner-membership'").get().count, 1);

  const removedAgent = await handleRequest(new Request(
    'https://api.chat.helixcer.com/api/team/members/delete-agent-one-membership', { method: 'DELETE', headers: adminHeaders }
  ), env);
  assert.equal(removedAgent.status, 200);
  assert.equal((await removedAgent.json()).deleted, true);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM memberships WHERE membership_id='delete-agent-one-membership'").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM users WHERE user_id='delete-agent-one'").get().count, 0);
  assert.equal(database.prepare("SELECT assigned_to FROM conversations WHERE conversation_id='team-delete-conversation'").get().assigned_to, '');

  const protectedOwner = await handleRequest(new Request(
    'https://api.chat.helixcer.com/api/team/members/delete-owner-membership', {
      method: 'DELETE', headers: { Authorization: 'Bearer recovery-secret' }
    }
  ), env);
  assert.equal(protectedOwner.status, 409);
  assert.match((await protectedOwner.json()).error, /at least one active owner/i);

  const removedSecondAgent = await handleRequest(new Request(
    'https://api.chat.helixcer.com/api/team/members/delete-agent-two-membership', { method: 'DELETE', headers: adminHeaders }
  ), env);
  assert.equal(removedSecondAgent.status, 200);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM memberships WHERE membership_id='delete-agent-two-membership'").get().count, 0);
  database.close();
});

test('identity routes are explicit, prevalidated, and never claim ambiguous legacy history', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB, { ADMIN_TOKEN: 'recovery-secret', RECOVERY_MODE: 'true' });
  const headers = { Authorization: 'Bearer recovery-secret', 'Content-Type': 'application/json' };
  const now = new Date().toISOString();
  database.prepare(`INSERT INTO channels
      (channel_id,name,connector_type,provider_type,enabled,capabilities_json,config_json,secret_key,created_at,updated_at,workspace_id)
    VALUES ('route-generic-a','Generic A','generic_http','generic_http',1,'["text"]','{}','ROUTE_A',?,?, 'ws_default'),
      ('route-generic-b','Generic B','generic_http','generic_http',1,'["text"]','{}','ROUTE_B',?,?, 'ws_default'),
      ('route-generic-c','Generic C','generic_http','generic_http',1,'["text"]','{}','ROUTE_C',?,?, 'ws_default'),
      ('route-wrong-platform','Wrong platform','web_chat','web_chat',1,'["text"]','{}','ROUTE_WRONG',?,?, 'ws_default')`)
    .run(now, now, now, now, now, now, now, now);
  database.prepare(`INSERT INTO channels
      (channel_id,name,connector_type,provider_type,enabled,capabilities_json,config_json,secret_key,created_at,updated_at,workspace_id)
    VALUES ('route-telegram','Telegram route','telegram','telegram',1,'["text"]','{}','ROUTE_TELEGRAM',?,?, 'ws_default')`)
    .run(now, now);

  async function createContact(displayName) {
    const response = await handleRequest(new Request('https://api.chat.helixcer.com/api/contacts', {
      method: 'POST', headers, body: JSON.stringify({ displayName })
    }), env);
    if (response.status !== 201) assert.fail(`Contact creation failed: ${response.status} ${await response.text()}`);
    return (await response.json()).contactId;
  }
  async function createIdentity(contactId, body) {
    return handleRequest(new Request(`https://api.chat.helixcer.com/api/contacts/${contactId}/identities`, {
      method: 'POST', headers, body: JSON.stringify(body)
    }), env);
  }

  const contactId = await createContact('Route safety');
  const unboundResponse = await createIdentity(contactId, {
    platform: 'generic_http', profileId: 'route-unbound'
  });
  assert.equal(unboundResponse.status, 201);
  const unboundId = (await unboundResponse.json()).identityId;
  const whatsappIdentity = await createIdentity(contactId, {
    platform: 'whatsapp', profileId: '919995761029'
  });
  assert.equal(whatsappIdentity.status, 201);
  const whatsappIdentityId = (await whatsappIdentity.json()).identityId;
  const mismatchedIdentityUpsert = await createIdentity(contactId, {
    identityId: whatsappIdentityId,
    platform: 'telegram',
    profileId: '364038997',
    bindings: [{ channelId: 'route-telegram', scopedProfileId: '364038997' }]
  });
  assert.equal(mismatchedIdentityUpsert.status, 400);
  assert.match((await mismatchedIdentityUpsert.json()).error, /cannot be changed/i);
  assert.equal(database.prepare('SELECT platform FROM contact_identities WHERE identity_id=?')
    .get(whatsappIdentityId).platform, 'whatsapp');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM channel_identity_bindings WHERE identity_id=?')
    .get(whatsappIdentityId).count, 0);

  const inferredOpen = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations', {
    method: 'POST', headers, body: JSON.stringify({ identityId: unboundId })
  }), env);
  assert.equal(inferredOpen.status, 409);
  assert.match((await inferredOpen.json()).error, /add a channel route/i);
  const autoBoundResponse = await createIdentity(contactId, {
    platform: 'generic_http', profileId: 'route-auto-bound'
  });
  assert.equal(autoBoundResponse.status, 201);
  const autoBoundId = (await autoBoundResponse.json()).identityId;
  const explicitOpen = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations', {
    method: 'POST', headers, body: JSON.stringify({ identityId: autoBoundId, channelId: 'route-generic-a' })
  }), env);
  assert.equal(explicitOpen.status, 201);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM channel_identity_bindings WHERE identity_id=?').get(autoBoundId).count, 1,
    'an explicit compatible channel safely creates the missing route');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM conversations WHERE identity_id=?').get(autoBoundId).count, 1);

  const invalidLegacyAlias = await handleRequest(new Request(
    `https://api.chat.helixcer.com/api/contacts/${contactId}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({
        displayName: 'Alias must not persist', channelId: 'route-generic-b',
        identities: [{ identityId: unboundId, platform: 'generic_http', profileId: 'route-unbound',
          username: 'alias-must-not-persist' }]
      })
    }
  ), env);
  assert.equal(invalidLegacyAlias.status, 400);
  assert.equal(database.prepare('SELECT display_name FROM contacts WHERE contact_id=?').get(contactId).display_name,
    'Route safety');
  assert.equal(database.prepare('SELECT username FROM contact_identities WHERE identity_id=?').get(unboundId).username, '');

  const partialCreate = await createIdentity(contactId, {
    platform: 'generic_http', profileId: 'route-partial-create',
    bindings: [
      { channelId: 'route-generic-a', scopedProfileId: 'route-partial-create' },
      { channelId: 'route-wrong-platform', scopedProfileId: 'route-partial-create' }
    ]
  });
  assert.equal(partialCreate.status, 400);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM contact_identities WHERE profile_id='route-partial-create'").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM channel_identity_bindings WHERE scoped_profile_id='route-partial-create'").get().count, 0);

  const failedWriteEnv = envFor(withRunFailures(DB, [/INSERT INTO channel_identity_bindings/i]), {
    ADMIN_TOKEN: 'recovery-secret', RECOVERY_MODE: 'true'
  });
  const failedWrite = await handleRequest(new Request(
    `https://api.chat.helixcer.com/api/contacts/${contactId}/identities`, {
      method: 'POST', headers,
      body: JSON.stringify({
        platform: 'generic_http', profileId: 'route-write-failure',
        bindings: [{ channelId: 'route-generic-a', scopedProfileId: 'route-write-failure' }]
      })
    }
  ), failedWriteEnv);
  assert.equal(failedWrite.status, 500);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM contact_identities WHERE profile_id='route-write-failure'").get().count, 0,
    'identity and route writes must roll back together');
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM channel_identity_bindings WHERE scoped_profile_id='route-write-failure'").get().count, 0);

  const editableResponse = await createIdentity(contactId, {
    platform: 'generic_http', profileId: 'route-editable', username: 'before',
    bindings: [{ channelId: 'route-generic-a', scopedProfileId: 'route-editable' }]
  });
  assert.equal(editableResponse.status, 201);
  const editableId = (await editableResponse.json()).identityId;
  const failedUpdateEnv = envFor(withRunFailures(DB, [/UPDATE channel_identity_bindings SET metadata_json/i]), {
    ADMIN_TOKEN: 'recovery-secret', RECOVERY_MODE: 'true'
  });
  const failedWriteUpdate = await handleRequest(new Request(
    `https://api.chat.helixcer.com/api/contacts/${contactId}/identities/${editableId}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ username: 'write-must-not-persist', bindings: [
        { channelId: 'route-generic-a', scopedProfileId: 'route-editable' }
      ] })
    }
  ), failedUpdateEnv);
  assert.equal(failedWriteUpdate.status, 500);
  assert.equal(database.prepare('SELECT username FROM contact_identities WHERE identity_id=?').get(editableId).username,
    'before', 'identity field and route updates must roll back together');
  const partialUpdate = await handleRequest(new Request(
    `https://api.chat.helixcer.com/api/contacts/${contactId}/identities/${editableId}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ username: 'after', isPrimary: true, bindings: [
        { channelId: 'route-generic-a', scopedProfileId: 'route-editable' },
        { channelId: 'route-wrong-platform', scopedProfileId: 'route-editable' }
      ] })
    }
  ), env);
  assert.equal(partialUpdate.status, 400);
  assert.equal(database.prepare('SELECT username FROM contact_identities WHERE identity_id=?').get(editableId).username, 'before');
  assert.equal(Boolean(JSON.parse(database.prepare('SELECT metadata_json FROM contact_identities WHERE identity_id=?')
    .get(editableId).metadata_json).isPrimary), false);
  assert.equal(Boolean(JSON.parse(database.prepare('SELECT metadata_json FROM contact_identities WHERE identity_id=?')
    .get(unboundId).metadata_json).isPrimary), true,
  'a failed route update must not change the contact primary identity');
  assert.deepEqual(database.prepare(`SELECT channel_id,scoped_profile_id FROM channel_identity_bindings
    WHERE identity_id=? AND active=1 ORDER BY channel_id`).all(editableId).map(row => ({ ...row })), [
    { channel_id: 'route-generic-a', scoped_profile_id: 'route-editable' }
  ]);

  const openedEditable = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations', {
    method: 'POST', headers,
    body: JSON.stringify({ identityId: editableId, channelId: 'route-generic-a' })
  }), env);
  assert.equal(openedEditable.status, 201);
  const historyRouteChange = await handleRequest(new Request(
    `https://api.chat.helixcer.com/api/contacts/${contactId}/identities/${editableId}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ username: 'must-not-persist', bindings: [
        { channelId: 'route-generic-a', scopedProfileId: 'route-replacement' }
      ] })
    }
  ), env);
  assert.equal(historyRouteChange.status, 409);
  assert.match((await historyRouteChange.json()).error, /conversation history/i);
  assert.equal(database.prepare('SELECT username FROM contact_identities WHERE identity_id=?').get(editableId).username,
    'before');
  assert.equal(database.prepare(`SELECT scoped_profile_id FROM channel_identity_bindings
    WHERE identity_id=? AND channel_id='route-generic-a' AND active=1`).get(editableId).scoped_profile_id,
    'route-editable');

  const deactivateOldRoute = await handleRequest(new Request(
    `https://api.chat.helixcer.com/api/contacts/${contactId}/identities/${editableId}`, {
      method: 'PATCH', headers, body: JSON.stringify({ bindings: [] })
    }
  ), env);
  assert.equal(deactivateOldRoute.status, 409);
  assert.match((await deactivateOldRoute.json()).error, /cannot be removed/i);
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM channel_identity_bindings
    WHERE identity_id=? AND channel_id='route-generic-a' AND active=1`).get(editableId).count, 1);
  // Simulate a route deactivated by an older deployment. History must still
  // prevent replacing its scoped recipient id.
  database.prepare(`UPDATE channel_identity_bindings SET active=0
    WHERE identity_id=? AND channel_id='route-generic-a'`).run(editableId);
  const replacementAfterDeactivate = await handleRequest(new Request(
    `https://api.chat.helixcer.com/api/contacts/${contactId}/identities/${editableId}`, {
      method: 'PATCH', headers, body: JSON.stringify({ bindings: [
        { channelId: 'route-generic-a', scopedProfileId: 'route-replacement' }
      ] })
    }
  ), env);
  assert.equal(replacementAfterDeactivate.status, 409);
  assert.match((await replacementAfterDeactivate.json()).error, /conversation history/i);

  const reactivateOldRoute = await handleRequest(new Request(
    `https://api.chat.helixcer.com/api/contacts/${contactId}/identities/${editableId}`, {
      method: 'PATCH', headers, body: JSON.stringify({ bindings: [
        { channelId: 'route-generic-a', scopedProfileId: 'route-editable' }
      ] })
    }
  ), env);
  assert.equal(reactivateOldRoute.status, 200);
  database.prepare("UPDATE channels SET enabled=0 WHERE channel_id='route-generic-a'").run();
  const preserveDisabledRoute = await handleRequest(new Request(
    `https://api.chat.helixcer.com/api/contacts/${contactId}/identities/${editableId}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ username: 'disabled-preserved', bindings: [
        { channelId: 'route-generic-a', scopedProfileId: 'route-editable' }
      ] })
    }
  ), env);
  assert.equal(preserveDisabledRoute.status, 200);
  assert.equal(database.prepare('SELECT username FROM contact_identities WHERE identity_id=?').get(editableId).username,
    'disabled-preserved');
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM channel_identity_bindings
    WHERE identity_id=? AND channel_id='route-generic-a' AND scoped_profile_id='route-editable' AND active=1`)
    .get(editableId).count, 1);

  const wholeContactFailure = await handleRequest(new Request(
    `https://api.chat.helixcer.com/api/contacts/${contactId}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({
        displayName: 'Must not persist',
        identities: [
          { identityId: editableId, platform: 'generic_http', profileId: 'route-editable',
            username: 'batch-must-not-persist',
            bindings: [{ channelId: 'route-generic-a', scopedProfileId: 'route-editable' }] },
          { identityId: unboundId, platform: 'generic_http', profileId: 'route-unbound', isPrimary: true,
            bindings: [{ channelId: 'route-wrong-platform', scopedProfileId: 'route-unbound' }] }
        ]
      })
    }
  ), env);
  assert.equal(wholeContactFailure.status, 400);
  assert.equal(database.prepare('SELECT display_name FROM contacts WHERE contact_id=?').get(contactId).display_name,
    'Route safety');
  assert.equal(database.prepare('SELECT username FROM contact_identities WHERE identity_id=?').get(editableId).username,
    'disabled-preserved', 'an invalid second identity must not partially update the first identity');

  const unboundTwoResponse = await createIdentity(contactId, {
    platform: 'generic_http', profileId: 'route-unbound-two'
  });
  assert.equal(unboundTwoResponse.status, 201);
  const unboundTwoId = (await unboundTwoResponse.json()).identityId;
  const pairwiseConflict = await handleRequest(new Request(
    `https://api.chat.helixcer.com/api/contacts/${contactId}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ identities: [
        { identityId: unboundId, platform: 'generic_http', profileId: 'route-unbound', isPrimary: true,
          bindings: [{ channelId: 'route-generic-c', scopedProfileId: 'shared-route' }] },
        { identityId: unboundTwoId, platform: 'generic_http', profileId: 'route-unbound-two',
          bindings: [{ channelId: 'route-generic-c', scopedProfileId: 'shared-route' }] }
      ] })
    }
  ), env);
  assert.equal(pairwiseConflict.status, 409);
  assert.match((await pairwiseConflict.json()).error, /more than one identity/i);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM channel_identity_bindings WHERE channel_id='route-generic-c'").get().count, 0);

  const ambiguousContactId = await createContact('Ambiguous legacy');
  const firstResponse = await createIdentity(ambiguousContactId, {
    platform: 'generic_http', profileId: 'route-ambiguous-1',
    bindings: [{ channelId: 'route-generic-b', scopedProfileId: 'route-ambiguous-1' }]
  });
  const secondResponse = await createIdentity(ambiguousContactId, {
    platform: 'generic_http', profileId: 'route-ambiguous-2',
    bindings: [{ channelId: 'route-generic-b', scopedProfileId: 'route-ambiguous-2' }]
  });
  assert.equal(firstResponse.status, 201);
  assert.equal(secondResponse.status, 201);
  const firstIdentityId = (await firstResponse.json()).identityId;
  const secondIdentityId = (await secondResponse.json()).identityId;
  const legacyConversationId = crypto.randomUUID();
  database.prepare(`INSERT INTO conversations
      (conversation_id,contact_id,channel_id,identity_id,status,subject,last_message_at,unread_count,created_at,updated_at,workspace_id)
    VALUES (?,?,'route-generic-b','','open','Legacy',?,0,?,?,'ws_default')`)
    .run(legacyConversationId, ambiguousContactId, now, now, now);
  const removeAmbiguousCandidate = await handleRequest(new Request(
    `https://api.chat.helixcer.com/api/contacts/${ambiguousContactId}/identities/${firstIdentityId}`, {
      method: 'PATCH', headers, body: JSON.stringify({ bindings: [] })
    }
  ), env);
  assert.equal(removeAmbiguousCandidate.status, 409);
  assert.match((await removeAmbiguousCandidate.json()).error, /cannot be removed/i);
  const deleteAmbiguousCandidate = await handleRequest(new Request(
    `https://api.chat.helixcer.com/api/contacts/${ambiguousContactId}/identities/${firstIdentityId}`, {
      method: 'DELETE', headers
    }
  ), env);
  assert.equal(deleteAmbiguousCandidate.status, 409);
  assert.match((await deleteAmbiguousCandidate.json()).error, /conversations/i);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM contact_identities WHERE identity_id IN (?,?)')
    .get(firstIdentityId, secondIdentityId).count, 2);
  assert.equal(database.prepare('SELECT identity_id FROM conversations WHERE conversation_id=?')
    .get(legacyConversationId).identity_id, '');
  const opened = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations', {
    method: 'POST', headers,
    body: JSON.stringify({ contactId: ambiguousContactId, identityId: firstIdentityId, channelId: 'route-generic-b' })
  }), env);
  if (opened.status !== 201) assert.fail(`Conversation open failed: ${opened.status} ${await opened.text()}`);
  const openedBody = await opened.json();
  assert.equal(openedBody.conversationId, legacyConversationId,
    'one contact reuses its existing inbox thread when an explicit route is selected');
  assert.equal(database.prepare('SELECT identity_id FROM conversations WHERE conversation_id=?').get(legacyConversationId).identity_id,
    '', 'selecting an explicit route does not falsely resolve an ambiguous legacy compatibility identity');

  // A retry created before identity migration may still point at an ambiguous
  // legacy conversation. It must fail closed rather than selecting the first
  // legacy channel_identity and delivering to an arbitrary recipient.
  database.prepare(`UPDATE channels SET config_json=? WHERE channel_id='route-generic-b'`)
    .run(JSON.stringify({ endpoint: 'https://provider.example/send', allowedHosts: ['provider.example'] }));
  database.prepare(`INSERT INTO messages
      (message_id,conversation_id,contact_id,channel_id,identity_id,direction,message_type,text,status,timestamp,workspace_id)
    VALUES ('ambiguous-legacy-retry',?,?,'route-generic-b','','outbound','text','Never send','retrying',?,'ws_default')`)
    .run(legacyConversationId, ambiguousContactId, now);
  database.prepare(`INSERT INTO outbox
      (outbox_id,message_id,attempts,max_attempts,next_attempt_at,status,created_at,updated_at,workspace_id)
    VALUES ('ambiguous-legacy-outbox','ambiguous-legacy-retry',0,6,?,'pending',?,?,'ws_default')`)
    .run(new Date(Date.now() - 1000).toISOString(), now, now);
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ id: 'must-not-send' }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    const scheduled = [];
    worker.scheduled({}, env, { waitUntil(promise) { scheduled.push(promise); } });
    await Promise.all(scheduled);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(providerCalls, 0);
  const failedRetry = database.prepare(`SELECT status,error FROM messages
    WHERE message_id='ambiguous-legacy-retry'`).get();
  assert.equal(failedRetry.status, 'failed');
  assert.match(failedRetry.error, /identity is unresolved/i);
  assert.deepEqual({ ...database.prepare(`SELECT status,attempts FROM outbox
    WHERE outbox_id='ambiguous-legacy-outbox'`).get() }, { status: 'failed', attempts: 1 });
  database.close();
});

test('flat contact platform IDs create, extend, protect history, and export one CSV row', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB, { ADMIN_TOKEN: 'recovery-secret', RECOVERY_MODE: 'true' });
  const headers = { Authorization: 'Bearer recovery-secret', 'Content-Type': 'application/json' };

  const empty = await handleRequest(new Request('https://api.chat.helixcer.com/api/contacts', {
    method: 'POST', headers,
    body: JSON.stringify({ displayName: 'No identifier', platformIds: {} })
  }), env);
  assert.equal(empty.status, 400);
  assert.match((await empty.json()).error, /at least one platform ID/i);

  const created = await handleRequest(new Request('https://api.chat.helixcer.com/api/contacts', {
    method: 'POST', headers,
    body: JSON.stringify({
      displayName: 'Flat Contact', company: 'Example, Inc.', tags: ['VIP', 'Retail'],
      platformIds: { whatsapp: '+91 99999 11111', telegram: 'tg-flat-1' }
    })
  }), env);
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  const contactId = createdBody.contactId;
  assert.deepEqual(createdBody.item.platformIds, {
    whatsapp: '919999911111', telegram: 'tg-flat-1', instagram: '', facebook: '', email: ''
  });
  assert.equal(createdBody.item.identities.length, 2, 'legacy identity views remain available for routing clients');
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM contact_platform_ids
    WHERE workspace_id='ws_default' AND contact_id=?`).get(contactId).count, 2);

  const duplicateWhatsApp = await handleRequest(new Request(
    `https://api.chat.helixcer.com/api/contacts/${contactId}/identities`, {
      method: 'POST', headers,
      body: JSON.stringify({ platform: 'whatsapp', profileId: '919999922222' })
    }), env);
  assert.equal(duplicateWhatsApp.status, 409);
  assert.match((await duplicateWhatsApp.json()).error, /already has a whatsapp ID/i);

  const added = await handleRequest(new Request(`https://api.chat.helixcer.com/api/contacts/${contactId}`, {
    method: 'PATCH', headers,
    body: JSON.stringify({ platformIds: { instagram: 'ig-flat-1' } })
  }), env);
  assert.equal(added.status, 200);
  const addedBody = await added.json();
  assert.equal(addedBody.item.platformIds.instagram, 'ig-flat-1');
  assert.equal(addedBody.item.platformIds.whatsapp, '919999911111', 'omitted platform IDs are preserved by PATCH');

  const whatsappIdentity = database.prepare(`SELECT identity_id FROM contact_platform_ids
    WHERE workspace_id='ws_default' AND contact_id=? AND platform='whatsapp'`).get(contactId).identity_id;
  const telegramIdentity = database.prepare(`SELECT identity_id FROM contact_platform_ids
    WHERE workspace_id='ws_default' AND contact_id=? AND platform='telegram'`).get(contactId).identity_id;
  const now = new Date().toISOString();
  database.prepare(`INSERT INTO channels
      (channel_id,name,connector_type,provider_type,enabled,capabilities_json,config_json,secret_key,created_at,updated_at,workspace_id)
    VALUES ('flat-history-channel','Flat history','whatsapp_cloud','whatsapp_cloud',1,'["text"]',?,'FLAT',?,?, 'ws_default'),
      ('flat-telegram-channel','Flat Telegram','telegram','telegram',1,'["text"]','{}','FLAT_TELEGRAM',?,?, 'ws_default')`)
    .run(JSON.stringify({ wabaId: '111111111111111', phoneNumberId: '222222222222222',
      credentialsVerifiedAt: now, webhookVerifiedAt: now }), now, now, now, now);
  database.prepare(`INSERT INTO channel_credentials
      (workspace_id,channel_id,credential_key,encrypted_value,created_at,updated_at)
    VALUES ('ws_default','flat-history-channel','accessToken','test',?,?),
      ('ws_default','flat-history-channel','verifyToken','test',?,?),
      ('ws_default','flat-history-channel','appSecret','test',?,?)`)
    .run(now, now, now, now, now, now);
  database.prepare(`INSERT INTO channel_identity_bindings
      (binding_id,workspace_id,identity_id,channel_id,scoped_profile_id,active,first_seen_at,last_seen_at,created_at,updated_at)
    VALUES ('flat-telegram-binding','ws_default',?,'flat-telegram-channel','tg-flat-1',1,?,?,?,?)`)
    .run(telegramIdentity, now, now, now, now);
  const changedBound = await handleRequest(new Request(`https://api.chat.helixcer.com/api/contacts/${contactId}`, {
    method: 'PATCH', headers,
    body: JSON.stringify({ platformIds: { telegram: 'tg-flat-2' } })
  }), env);
  assert.equal(changedBound.status, 409);
  assert.match((await changedBound.json()).error, /connected to a channel route/i);

  const opened = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations', {
    method: 'POST', headers,
    body: JSON.stringify({ contactId, identityId: whatsappIdentity, channelId: 'flat-history-channel' })
  }), env);
  assert.equal(opened.status, 201);
  assert.equal(database.prepare(`SELECT scoped_profile_id FROM channel_identity_bindings
    WHERE identity_id=? AND channel_id='flat-history-channel' AND active=1`).get(whatsappIdentity).scoped_profile_id,
  '919999911111', 'opening through a selected compatible channel creates the missing route safely');
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM conversations
    WHERE contact_id=? AND identity_id=? AND channel_id='flat-history-channel'`).get(contactId, whatsappIdentity).count, 1);

  const changedHistorical = await handleRequest(new Request(`https://api.chat.helixcer.com/api/contacts/${contactId}`, {
    method: 'PATCH', headers,
    body: JSON.stringify({ platformIds: {
      whatsapp: '919999933333', telegram: 'tg-flat-1', instagram: 'ig-flat-1'
    } })
  }), env);
  assert.equal(changedHistorical.status, 409);
  assert.match((await changedHistorical.json()).error, /conversation history/i);
  assert.equal(database.prepare(`SELECT profile_id FROM contact_platform_ids
    WHERE contact_id=? AND platform='whatsapp'`).get(contactId).profile_id, '919999911111');

  const removedHistorical = await handleRequest(new Request(`https://api.chat.helixcer.com/api/contacts/${contactId}`, {
    method: 'PATCH', headers,
    body: JSON.stringify({ platformIds: { whatsapp: '' } })
  }), env);
  assert.equal(removedHistorical.status, 409);
  assert.match((await removedHistorical.json()).error, /conversation history/i);

  const exported = await handleRequest(new Request('https://api.chat.helixcer.com/api/contacts/export.csv', {
    headers: { Authorization: 'Bearer recovery-secret' }
  }), env);
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-type'), /text\/csv/);
  const csv = await exported.text();
  assert.match(csv, /contact_id,display_name,company,tags,whatsapp_id,telegram_id,instagram_id,facebook_id,email/);
  assert.match(csv, /Flat Contact,"Example, Inc\.","VIP, Retail",919999911111,tg-flat-1,ig-flat-1,,/);
  assert.equal(csv.split('\r\n').filter(line => line.includes('Flat Contact')).length, 1);
  database.close();
});

test('unified-thread retries dispatch through the message route, not the conversation compatibility route', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB, { ADMIN_TOKEN: 'recovery-secret', RECOVERY_MODE: 'true' });
  const now = new Date().toISOString();
  const due = new Date(Date.now() - 1000).toISOString();
  const channelConfig = endpoint => JSON.stringify({
    endpoint,
    allowedHosts: ['provider.example'],
    responseMapping: { providerMessageId: 'id', status: 'status' }
  });

  database.prepare(`INSERT INTO channels
      (channel_id,name,connector_type,provider_type,enabled,capabilities_json,config_json,
       secret_key,created_at,updated_at,workspace_id)
    VALUES ('route-compatibility','Compatibility route','generic_http','generic_http',1,'["text"]',?1,
        'ROUTE_COMPATIBILITY',?2,?2,'ws_default'),
      ('route-message','Exact message route','generic_http','generic_http',1,'["text"]',?3,
        'ROUTE_MESSAGE',?2,?2,'ws_default')`)
    .run(channelConfig('https://provider.example/compatibility'), now,
      channelConfig('https://provider.example/message'));
  database.prepare(`INSERT INTO contacts
      (contact_id,display_name,company,tags_json,created_at,updated_at,workspace_id)
    VALUES ('contact-unified-route','Unified route','','[]',?1,?1,'ws_default')`).run(now);
  database.prepare(`INSERT INTO contact_identities
      (identity_id,workspace_id,contact_id,platform,profile_id,display_name,created_at,updated_at)
    VALUES ('identity-unified-route','ws_default','contact-unified-route','generic_http',
      'identity-profile','Unified route',?1,?1)`).run(now);
  database.prepare(`INSERT INTO channel_identity_bindings
      (binding_id,workspace_id,identity_id,channel_id,scoped_profile_id,active,
       first_seen_at,last_seen_at,created_at,updated_at)
    VALUES ('binding-compatibility','ws_default','identity-unified-route','route-compatibility',
        'recipient-compatibility',1,?1,?1,?1,?1),
      ('binding-message','ws_default','identity-unified-route','route-message',
        'recipient-message',1,?1,?1,?1,?1)`).run(now);
  database.prepare(`INSERT INTO conversations
      (conversation_id,contact_id,channel_id,identity_id,status,subject,last_message_at,unread_count,
       created_at,updated_at,workspace_id)
    VALUES ('conversation-unified-route','contact-unified-route','route-compatibility',
      'identity-unified-route','open','Unified route',?1,0,?1,?1,'ws_default')`).run(now);
  database.prepare(`INSERT INTO messages
      (message_id,conversation_id,contact_id,channel_id,identity_id,direction,message_type,text,status,
       timestamp,workspace_id)
    VALUES ('message-exact-route','conversation-unified-route','contact-unified-route','route-message',
      'identity-unified-route','outbound','text','Use the exact route','retrying',?1,'ws_default')`).run(now);
  database.prepare(`INSERT INTO outbox
      (outbox_id,message_id,attempts,max_attempts,next_attempt_at,status,created_at,updated_at,workspace_id)
    VALUES ('outbox-exact-route','message-exact-route',0,6,?1,'pending',?2,?2,'ws_default')`)
    .run(due, now);

  const originalFetch = globalThis.fetch;
  const providerRequests = [];
  globalThis.fetch = async (input, init = {}) => {
    providerRequests.push({ url: String(input), body: JSON.parse(String(init.body || '{}')) });
    return new Response(JSON.stringify({ id: 'provider-exact-route', status: 'submitted' }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    const scheduled = [];
    worker.scheduled({}, env, { waitUntil(promise) { scheduled.push(promise); } });
    await Promise.all(scheduled);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(providerRequests, [{
    url: 'https://provider.example/message',
    body: { to: 'recipient-message', text: 'Use the exact route' }
  }]);
  assert.deepEqual({ ...database.prepare(`SELECT status,provider_message_id,channel_id,identity_id
    FROM messages WHERE message_id='message-exact-route'`).get() }, {
    status: 'submitted', provider_message_id: 'provider-exact-route',
    channel_id: 'route-message', identity_id: 'identity-unified-route'
  });
  assert.equal(database.prepare(`SELECT channel_id FROM conversations
    WHERE conversation_id='conversation-unified-route'`).get().channel_id, 'route-compatibility');

  const resolvedRequests = [];
  globalThis.fetch = async (input, init = {}) => {
    resolvedRequests.push({ url: String(input), body: JSON.parse(String(init.body || '{}')) });
    return new Response(JSON.stringify({ id: 'provider-resolved-route', status: 'submitted' }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  let resolvedItem;
  try {
    const pending = [];
    const response = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/conversations/conversation-unified-route/messages', {
        method: 'POST',
        headers: { Authorization: 'Bearer recovery-secret', 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Resolve the latest message route' })
      }
    ), env, { waitUntil(promise) { pending.push(promise); } });
    assert.equal(response.status, 202);
    resolvedItem = (await response.json()).item;
    await Promise.all(pending);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(resolvedItem.channelId, 'route-message');
  assert.equal(resolvedItem.contactIdentityId, 'identity-unified-route');
  assert.equal(resolvedItem.channelName, 'Exact message route');
  assert.equal(resolvedItem.channelProfileId, 'recipient-message');
  assert.deepEqual(resolvedRequests, [{
    url: 'https://provider.example/message',
    body: { to: 'recipient-message', text: 'Resolve the latest message route' }
  }]);
  assert.equal(database.prepare(`SELECT channel_id FROM conversations
    WHERE conversation_id='conversation-unified-route'`).get().channel_id, 'route-message');

  const listed = await handleRequest(new Request(
    'https://api.chat.helixcer.com/api/conversations/conversation-unified-route/messages', {
      headers: { Authorization: 'Bearer recovery-secret' }
    }
  ), env);
  assert.equal(listed.status, 200);
  const item = (await listed.json()).items.find(candidate => candidate.messageId === 'message-exact-route');
  assert.equal(item.channelId, 'route-message');
  assert.equal(item.contactIdentityId, 'identity-unified-route');
  assert.equal(item.channelName, 'Exact message route');
  assert.equal(item.channelProfileId, 'recipient-message');
  database.close();
});

test('unified conversation defaults to the newest exact inbound route when binding timestamps are stale', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB, { ADMIN_TOKEN: 'recovery-secret', RECOVERY_MODE: 'true' });
  const createdAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const olderInbound = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const newerInbound = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  database.prepare(`INSERT INTO channels
      (channel_id,name,connector_type,provider_type,enabled,capabilities_json,config_json,
       secret_key,created_at,updated_at,workspace_id)
    VALUES ('stale-binding-a','Older exact route','generic_http','generic_http',1,'["text"]','{}',
        'STALE_A',?1,?1,'ws_default'),
      ('stale-binding-b','Newest exact route','generic_http','generic_http',1,'["text"]','{}',
        'STALE_B',?1,?1,'ws_default')`).run(createdAt);
  database.prepare(`INSERT INTO contacts
      (contact_id,display_name,company,tags_json,created_at,updated_at,workspace_id)
    VALUES ('contact-stale-route','Stale route contact','','[]',?1,?1,'ws_default')`).run(createdAt);
  database.prepare(`INSERT INTO contact_identities
      (identity_id,workspace_id,contact_id,platform,profile_id,display_name,created_at,updated_at)
    VALUES ('identity-stale-route','ws_default','contact-stale-route','generic_http',
      'profile-stale-route','Stale route contact',?1,?1)`).run(createdAt);
  database.prepare(`INSERT INTO channel_identity_bindings
      (binding_id,workspace_id,identity_id,channel_id,scoped_profile_id,active,
       first_seen_at,last_seen_at,last_inbound_at,created_at,updated_at)
    VALUES ('binding-stale-a','ws_default','identity-stale-route','stale-binding-a',
        'recipient-a',1,?1,?1,?2,?1,?1),
      ('binding-stale-b','ws_default','identity-stale-route','stale-binding-b',
        'recipient-b',1,?1,?1,?3,?1,?1)`)
    .run(createdAt, newerInbound, olderInbound);
  database.prepare(`INSERT INTO conversations
      (conversation_id,contact_id,channel_id,identity_id,status,subject,last_message_at,unread_count,
       created_at,updated_at,workspace_id)
    VALUES ('conversation-stale-route','contact-stale-route','stale-binding-a','identity-stale-route',
      'open','Stale route contact',?1,2,?2,?1,'ws_default')`).run(newerInbound, createdAt);
  database.prepare(`INSERT INTO messages
      (message_id,conversation_id,contact_id,channel_id,identity_id,direction,message_type,text,status,
       timestamp,workspace_id)
    VALUES ('inbound-stale-a','conversation-stale-route','contact-stale-route','stale-binding-a',
        'identity-stale-route','inbound','text','Older route message','received',?1,'ws_default'),
      ('inbound-stale-b','conversation-stale-route','contact-stale-route','stale-binding-b',
        'identity-stale-route','inbound','text','Newest route message','received',?2,'ws_default')`)
    .run(olderInbound, newerInbound);

  const response = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations?limit=100', {
    headers: { Authorization: 'Bearer recovery-secret' }
  }), env);
  assert.equal(response.status, 200);
  const conversation = (await response.json()).items.find(item =>
    item.conversationId === 'conversation-stale-route');
  assert.ok(conversation);
  assert.equal(conversation.defaultRoute.channelId, 'stale-binding-b');
  assert.equal(conversation.defaultRoute.identityId, 'identity-stale-route');
  assert.equal(conversation.defaultRoute.lastInboundAt, newerInbound);
  assert.equal(conversation.routeOptions.find(route => route.channelId === 'stale-binding-a').lastInboundAt,
    olderInbound);
  database.close();
});

test('agent invitations store channel access and restrict messaging to selected channels', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const { principal: owner, sessionToken: ownerSession } = await performOwnerLogin(env);
  const ownerHeaders = {
    Cookie: `__Host-helixcer_session=${encodeURIComponent(ownerSession)}`,
    Origin: 'https://chat.helixcer.com',
    'Content-Type': 'application/json'
  };

  for (const [channelId, name] of [['wa-sales', 'Sales WhatsApp'], ['wa-service', 'Service WhatsApp']]) {
    const created = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        name, connectorType: 'web_chat', channelId, secretKey: `${channelId}-secret`
      })
    }), env);
    assert.equal(created.status, 201);
  }

  const deniedEmpty = await createInvitation(
    new Request('https://api.chat.helixcer.com/api/team/invitations'), env, owner,
    { email: 'scoped-agent@example.com', role: 'agent', allowedChannelIds: [], return_to: 'https://chat.helixcer.com/team' }
  ).then(() => null, error => error);
  assert.equal(deniedEmpty?.status, 400);

  const created = await createInvitation(
    new Request('https://api.chat.helixcer.com/api/team/invitations'), env, owner,
    {
      email: 'scoped-agent@example.com', role: 'agent', allowedChannelIds: ['wa-sales'],
      return_to: 'https://chat.helixcer.com/team'
    }
  );
  assert.deepEqual(created.invitation.allowedChannelIds, ['wa-sales']);
  assert.equal(
    database.prepare('SELECT allowed_channel_ids_json FROM invitations WHERE invitation_id=?')
      .get(created.invitation.invitationId).allowed_channel_ids_json,
    JSON.stringify(['wa-sales'])
  );

  const token = new URL(created.inviteUrl).searchParams.get('invite');
  const accepted = await performGoogleLogin(env, {
    email: 'scoped-agent@example.com', subject: 'scoped-agent-google-sub', invite: token,
    returnTo: 'https://chat.helixcer.com/team'
  });
  assert.equal(accepted.principal.membership.role, 'agent');
  assert.deepEqual(accepted.principal.membership.allowedChannelIds, ['wa-sales']);
  assert.equal(
    database.prepare(`SELECT allowed_channel_ids_json FROM memberships WHERE membership_id=?`)
      .get(accepted.principal.membership.membershipId).allowed_channel_ids_json,
    JSON.stringify(['wa-sales'])
  );

  const now = new Date().toISOString();
  database.prepare(`INSERT INTO contacts (contact_id,display_name,attributes_json,created_at,updated_at,workspace_id)
    VALUES ('ct-sales','Sales Contact','{}',?,?, 'ws_default')`).run(now, now);
  database.prepare(`INSERT INTO contacts (contact_id,display_name,attributes_json,created_at,updated_at,workspace_id)
    VALUES ('ct-service','Service Contact','{}',?,?, 'ws_default')`).run(now, now);
  database.prepare(`INSERT INTO conversations
      (conversation_id,contact_id,channel_id,status,subject,last_message_at,unread_count,created_at,updated_at,workspace_id)
    VALUES ('cv-sales','ct-sales','wa-sales','open','Sales thread',?,1,?,?, 'ws_default')`).run(now, now, now);
  database.prepare(`INSERT INTO conversations
      (conversation_id,contact_id,channel_id,status,subject,last_message_at,unread_count,created_at,updated_at,workspace_id)
    VALUES ('cv-service','ct-service','wa-service','open','Service thread',?,1,?,?, 'ws_default')`).run(now, now, now);
  database.prepare(`INSERT INTO messages
      (message_id,conversation_id,contact_id,channel_id,direction,message_type,text,status,timestamp,workspace_id)
    VALUES ('msg-sales','cv-sales','ct-sales','wa-sales','inbound','text','Hello sales','received',?,'ws_default')`).run(now);
  database.prepare(`INSERT INTO messages
      (message_id,conversation_id,contact_id,channel_id,direction,message_type,text,status,timestamp,workspace_id)
    VALUES ('msg-service','cv-service','ct-service','wa-service','inbound','text','Hello service','received',?,'ws_default')`).run(now);

  const agentHeaders = {
    Cookie: `__Host-helixcer_session=${encodeURIComponent(accepted.sessionToken)}`,
    Origin: 'https://chat.helixcer.com',
    'Content-Type': 'application/json'
  };
  const bootstrap = await handleRequest(new Request('https://api.chat.helixcer.com/api/bootstrap', {
    headers: agentHeaders
  }), env);
  assert.equal(bootstrap.status, 200);
  const bootstrapBody = await bootstrap.json();
  assert.deepEqual(bootstrapBody.channels.map(item => item.channelId), ['wa-sales']);
  assert.deepEqual(bootstrapBody.conversations.map(item => item.conversationId).sort(), ['cv-sales']);
  assert.deepEqual(bootstrapBody.me.membership.allowedChannelIds, ['wa-sales']);

  const allowedRead = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/cv-sales/messages', {
    headers: agentHeaders
  }), env);
  assert.equal(allowedRead.status, 200);
  assert.equal((await allowedRead.json()).items.length, 1);

  const deniedSend = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/cv-service/messages', {
    method: 'POST',
    headers: agentHeaders,
    body: JSON.stringify({ text: 'Reply on service' })
  }), env);
  assert.equal(deniedSend.status, 403);

  const deniedRead = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/cv-service/messages', {
    headers: agentHeaders
  }), env);
  assert.equal(deniedRead.status, 403);

  const adminInvite = await createInvitation(
    new Request('https://api.chat.helixcer.com/api/team/invitations'), env, owner,
    { email: 'full-admin@example.com', role: 'admin', return_to: 'https://chat.helixcer.com/team' }
  );
  assert.deepEqual(adminInvite.invitation.allowedChannelIds, []);
  const adminToken = new URL(adminInvite.inviteUrl).searchParams.get('invite');
  const adminAccepted = await performGoogleLogin(env, {
    email: 'full-admin@example.com', subject: 'full-admin-google-sub', invite: adminToken,
    returnTo: 'https://chat.helixcer.com/team'
  });
  const adminBootstrap = await handleRequest(new Request('https://api.chat.helixcer.com/api/bootstrap', {
    headers: {
      Cookie: `__Host-helixcer_session=${encodeURIComponent(adminAccepted.sessionToken)}`,
      Origin: 'https://chat.helixcer.com'
    }
  }), env);
  const adminBody = await adminBootstrap.json();
  assert.deepEqual(adminBody.channels.map(item => item.channelId).sort(), ['wa-sales', 'wa-service']);
  assert.equal(adminBody.conversations.length, 2);
  database.close();
});
