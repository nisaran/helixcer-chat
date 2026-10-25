import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import {
  authenticateRequest,
  createInvitation,
  hashToken,
  requireRole,
  startGoogleOAuth,
  finishGoogleOAuth,
  finishGoogleOAuthResponse,
  updateMembership,
  validateReturnTo,
  verifyGoogleIdToken
} from '../src/auth.js';
import { encryptChannelCredential, handleRequest } from '../src/index.js';

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

test('OAuth code flow bootstraps only the configured verified owner and creates a server session', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const { principal } = await performOwnerLogin(env);
  assert.equal(principal.user.email, 'owner@example.com');
  assert.equal(principal.membership.role, 'owner');
  assert.equal(principal.workspace.workspaceId, 'ws_default');
  assert.equal(database.prepare('SELECT count(*) AS count FROM memberships').get().count, 1);
  assert.equal(database.prepare('SELECT count(*) AS count FROM sessions WHERE revoked_at IS NULL').get().count, 1);
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
    const message = database.prepare(`SELECT direction,text,status,provider_message_id FROM messages
      WHERE channel_id=?`).get(channelId);
    assert.deepEqual({ ...message }, {
      direction: 'inbound', text: 'Hello Helixcer', status: 'received', provider_message_id: 'wamid.inbound-first'
    });
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
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM messages WHERE channel_id=?').get(channelId).count, 1);
    assert.equal(database.prepare('SELECT unread_count FROM conversations WHERE conversation_id=?').get(conversation.conversation_id).unread_count, 1);

    database.prepare("UPDATE conversations SET status='closed',unread_count=0 WHERE conversation_id=?")
      .run(conversation.conversation_id);
    const reopenedPayload = structuredClone(payload);
    reopenedPayload.entry[0].changes[0].value.messages[0] = {
      from: '919999999999', id: 'wamid.inbound-reopens', timestamp: '1761360060', type: 'text',
      text: { body: 'I have another question' }
    };
    const reopenedSigned = await sign(reopenedPayload);
    const reopened = await handleRequest(new Request(`https://api.chat.helixcer.com/webhooks/whatsapp/${channelId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': reopenedSigned.signature }, body: reopenedSigned.raw
    }), env);
    assert.deepEqual(await reopened.json(), { ok: true, received: 1, statuses: 0 });
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

  const payload = { object: 'instagram', entry: [
    { id: '17841400000000011', messaging: [{ sender: { id: '5550001' }, recipient: { id: '17841400000000011' },
      timestamp: 1761360000000, message: { mid: 'ig-app-message-one', text: 'First account' } }] },
    { id: '17841400000000012', messaging: [{ sender: { id: '5550002' }, recipient: { id: '17841400000000012' },
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
  globalThis.fetch = async input => {
    const url = new URL(String(input));
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

  const now = new Date().toISOString();
  database.prepare(`INSERT INTO contacts (contact_id,display_name,created_at,updated_at,workspace_id)
    VALUES ('contact-dashboard','Asha',?,?, 'ws_default')`).run(now, now);
  database.prepare(`INSERT INTO channel_identities
      (identity_id,contact_id,channel_id,channel_profile_id,display_name,created_at,workspace_id)
    VALUES ('identity-dashboard','contact-dashboard','wa-dashboard','919999999999','Asha',?,'ws_default')`).run(now);
  database.prepare(`INSERT INTO conversations
      (conversation_id,contact_id,channel_id,status,subject,last_message_at,created_at,updated_at,workspace_id)
    VALUES ('conversation-dashboard','contact-dashboard','wa-dashboard','open','Asha',?,?,?,'ws_default')`).run(now, now, now);
  database.prepare(`INSERT INTO messages
      (message_id,conversation_id,contact_id,channel_id,direction,message_type,text,status,timestamp,workspace_id)
    VALUES ('inbound-dashboard','conversation-dashboard','contact-dashboard','wa-dashboard','inbound','text','Hello','received',?,'ws_default')`).run(now);

  const conversations = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations', {
    headers: { Authorization: 'Bearer recovery-secret' }
  }), env);
  const conversation = (await conversations.json()).items.find(item => item.conversationId === 'conversation-dashboard');
  assert.equal(conversation.connectorType, 'whatsapp_cloud');
  assert.equal(conversation.freeformAllowed, true);
  assert.ok(conversation.replyWindowExpiresAt);

  const originalFetch = globalThis.fetch;
  const providerBodies = [];
  let mediaUploadCalls = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/media')) {
      assert.match(init.headers.Authorization, /^Bearer /);
      const upload = init.body;
      assert.equal(upload.get('messaging_product'), 'whatsapp');
      assert.equal(upload.get('type'), 'application/pdf');
      assert.equal(upload.get('file').name, 'invoice.pdf');
      mediaUploadCalls++;
      return new Response(JSON.stringify({ id: 'media-dashboard-1' }), { headers: { 'Content-Type': 'application/json' } });
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
    const templateResponse = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/conversation-dashboard/template', {
      method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ name: 'order_update', language: { code: 'en_US' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Asha' }] }] })
    }), env, ctx);
    assert.equal(templateResponse.status, 202);
    assert.equal((await templateResponse.json()).item.messageType, 'template');
    await Promise.all(pending.splice(0));
    assert.equal(providerBodies[0].type, 'template');
    assert.equal(providerBodies[0].template.name, 'order_update');

    const uploadBody = new FormData();
    uploadBody.set('file', new Blob(['invoice data'], { type: 'application/pdf' }), 'invoice.pdf');
    uploadBody.set('caption', 'Your invoice');
    const attachmentResponse = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/conversation-dashboard/attachments', {
      method: 'POST', headers: { Authorization: 'Bearer recovery-secret' }, body: uploadBody
    }), env, ctx);
    assert.equal(attachmentResponse.status, 202);
    const attachmentItem = (await attachmentResponse.json()).item;
    assert.equal(attachmentItem.messageType, 'document');
    assert.equal(attachmentItem.attachment.filename, 'invoice.pdf');
    await Promise.all(pending.splice(0));
    assert.equal(mediaUploadCalls, 1);
    assert.equal(providerBodies[1].type, 'document');
    assert.equal(providerBodies[1].document.id, 'media-dashboard-1');
    assert.equal(providerBodies[1].document.filename, 'invoice.pdf');

    const messages = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/conversation-dashboard/messages', {
      headers: { Authorization: 'Bearer recovery-secret' }
    }), env);
    const messageBody = await messages.json();
    assert.equal(messageBody.freeformAllowed, true);
    assert.equal(messageBody.items.find(item => item.messageType === 'document').attachment.caption, 'Your invoice');

    const unsupportedBody = new FormData();
    unsupportedBody.set('file', new Blob(['binary'], { type: 'application/x-msdownload' }), 'unsafe.exe');
    const unsupported = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/conversation-dashboard/attachments', {
      method: 'POST', headers: { Authorization: 'Bearer recovery-secret' }, body: unsupportedBody
    }), env, ctx);
    assert.equal(unsupported.status, 415);
    assert.match((await unsupported.json()).error, /not supported/i);
    assert.equal(mediaUploadCalls, 1);

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
    assert.equal(mediaUploadCalls, 1);

    const allowedTemplate = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/conversation-dashboard/template', {
      method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ name: 'reopen_chat', language: { code: 'en_US' } })
    }), env, ctx);
    assert.equal(allowedTemplate.status, 202);
    const allowedTemplateItem = (await allowedTemplate.clone().json()).item;
    assert.equal(allowedTemplateItem.status, 'pending');
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

    globalThis.fetch = async () => new Response(JSON.stringify({
      error: { message: `(#100) Missing permission for message templates (${accessToken})`, code: 100 }
    }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    const providerFailure = await handleRequest(new Request(
      'https://api.chat.helixcer.com/api/conversations/conversation-template-list/templates',
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
    database.close();
  }
});

test('contact detail and update APIs preserve conversations, keep provider IDs immutable, and stay workspace scoped', async () => {
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
  assert.equal(detailBody.item.channelEditable, true);

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

  const immutableProviderId = await handleRequest(new Request(`https://api.chat.helixcer.com/api/contacts/${contactId}`, {
    method: 'PATCH', headers: jsonHeaders,
    body: JSON.stringify({ channelProfileId: '+91 99999 99992' })
  }), env);
  assert.equal(immutableProviderId.status, 400);
  assert.match((await immutableProviderId.json()).error, /Provider ID cannot be changed/i);

  const reassigned = await handleRequest(new Request(`https://api.chat.helixcer.com/api/contacts/${contactId}`, {
    method: 'PATCH', headers: jsonHeaders,
    body: JSON.stringify({ channelId: 'telegram-contact-api' })
  }), env);
  assert.equal(reassigned.status, 200);
  const reassignedBody = await reassigned.json();
  assert.equal(reassignedBody.item.channelName, 'Support Telegram');
  assert.equal(reassignedBody.item.channelProfileId, '919999999991');
  assert.equal(database.prepare('SELECT channel_id FROM conversations WHERE conversation_id=?').get(conversationId).channel_id,
    'telegram-contact-api');

  database.prepare(`INSERT INTO messages
      (message_id,conversation_id,contact_id,channel_id,direction,message_type,text,status,timestamp,workspace_id)
    VALUES ('contact-history',?1,?2,'telegram-contact-api','inbound','text','Hello','received',?3,'ws_default')`)
    .run(conversationId, contactId, new Date().toISOString());
  const lockedChannel = await handleRequest(new Request(`https://api.chat.helixcer.com/api/contacts/${contactId}`, {
    method: 'PATCH', headers: jsonHeaders,
    body: JSON.stringify({ channelId: 'wa-contact-api' })
  }), env);
  assert.equal(lockedChannel.status, 409);
  assert.match((await lockedChannel.json()).error, /after messages/i);
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
  assert.match((await conflict.json()).error, /Provider ID cannot be changed/i);
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
  assert.equal(listItem.channelName, 'Support Telegram');
  assert.equal(listItem.connectorType, 'telegram');

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
