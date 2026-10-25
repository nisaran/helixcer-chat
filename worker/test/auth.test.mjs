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
  updateMembership,
  validateReturnTo,
  verifyGoogleIdToken
} from '../src/auth.js';
import { handleRequest } from '../src/index.js';

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
