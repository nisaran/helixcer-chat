export const SESSION_COOKIE = '__Host-helixcer_session';
export const OAUTH_COOKIE = '__Host-helixcer_oauth';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const jwksCache = new Map();
const MOBILE_DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;
const MOBILE_CHALLENGE_TTL_SECONDS = 5 * 60;

export async function startGoogleOAuth(request, env) {
  requireOAuthConfig(env);
  const url = new URL(request.url);
  const returnTo = validateReturnTo(url.searchParams.get('return_to') || url.searchParams.get('returnTo') || '/', env);
  const previousState = readCookie(request, OAUTH_COOKIE);
  if (previousState) {
    await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash=?1').bind(await hashToken(previousState)).run();
  }
  const state = randomToken(32);
  const nonce = randomToken(32);
  const codeVerifier = randomToken(48);
  const invitationToken = url.searchParams.get('invite') || '';
  if (invitationToken.length > 256) throw authError(400, 'Invitation token is invalid.');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
  await env.DB.prepare(`INSERT INTO oauth_states
      (state_hash,nonce_hash,code_verifier,return_to,invitation_token_hash,expires_at,created_at)
    VALUES (?1,?2,?3,?4,?5,?6,?7)`)
    .bind(await hashToken(state), await hashToken(nonce), codeVerifier, returnTo,
      invitationToken ? await hashToken(invitationToken) : null, expiresAt, now.toISOString()).run();

  const authorize = new URL(GOOGLE_AUTH_URL);
  authorize.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', googleRedirectUri(request, env));
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('scope', 'openid email profile');
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('nonce', nonce);
  authorize.searchParams.set('code_challenge', await pkceChallenge(codeVerifier));
  authorize.searchParams.set('code_challenge_method', 'S256');
  authorize.searchParams.set('prompt', 'select_account');
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Set-Cookie': cookieHeader(OAUTH_COOKIE, state, 10 * 60)
    }
  });
}

export async function finishGoogleOAuth(request, env, fetchImpl = fetch) {
  requireOAuthConfig(env);
  const url = new URL(request.url);
  if (url.searchParams.get('error')) throw authError(401, 'Google sign-in was cancelled or denied.');
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const cookieState = readCookie(request, OAUTH_COOKIE) || '';
  if (!code || !state || !cookieState || !timingSafeEqual(state, cookieState)) throw authError(400, 'Invalid OAuth state.');
  const stateHash = await hashToken(state);
  const stored = await env.DB.prepare(`SELECT state_hash,nonce_hash,code_verifier,return_to,invitation_token_hash,expires_at
    FROM oauth_states WHERE state_hash=?1`).bind(stateHash).first();
  if (!stored || stored.expires_at <= new Date().toISOString()) throw authError(400, 'OAuth state expired.');
  await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash=?1').bind(stateHash).run();

  const tokenResponse = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: googleRedirectUri(request, env),
      grant_type: 'authorization_code',
      code_verifier: stored.code_verifier
    })
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenPayload.id_token) throw authError(401, 'Google token exchange failed.');
  const identity = await verifyGoogleIdToken(tokenPayload.id_token, {
    clientId: env.GOOGLE_CLIENT_ID,
    nonceHash: stored.nonce_hash,
    jwksUrl: env.GOOGLE_JWKS_URL || GOOGLE_JWKS_URL
  }, fetchImpl);
  const principal = await provisionVerifiedIdentity(env, identity, stored.invitation_token_hash);
  const session = await createSession(env, principal);
  await auditAuthAction(env, principal, 'login', 'session', session.sessionId, { authProvider: 'google' });
  const headers = new Headers({ Location: stored.return_to, 'Referrer-Policy': 'no-referrer' });
  headers.append('Set-Cookie', cookieHeader(SESSION_COOKIE, session.token, session.maxAge));
  headers.append('Set-Cookie', clearCookieHeader(OAUTH_COOKIE));
  return new Response(null, {
    status: 302,
    headers
  });
}

/**
 * Browser-facing OAuth callback wrapper.
 *
 * The core finishGoogleOAuth function intentionally continues to throw typed
 * errors so it remains useful to tests and other callers. The HTTP route should
 * call this wrapper instead: OAuth failures are converted into a safe redirect
 * back to the app, preventing rejected promises from surfacing as a raw
 * Cloudflare Worker exception page.
 */
export async function finishGoogleOAuthResponse(request, env, fetchImpl = fetch) {
  try {
    return await finishGoogleOAuth(request, env, fetchImpl);
  } catch (error) {
    const failure = oauthFailureView(error);
    if (failure.status >= 500) {
      console.error('oauth_callback_failed', { status: failure.status, message: error?.message || 'Unknown OAuth callback error' });
    }
    const target = oauthFailureTarget(env);
    if (!target) return oauthFailurePage(failure, clearCookieHeader(OAUTH_COOKIE));
    target.searchParams.set('auth_error', failure.message);
    target.searchParams.set('auth_error_code', failure.code);
    const headers = new Headers({
      Location: target.toString(),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer'
    });
    headers.append('Set-Cookie', clearCookieHeader(OAUTH_COOKIE));
    return new Response(null, { status: 302, headers });
  }
}

export async function authenticateRequest(request, env) {
  const recovery = await recoveryPrincipal(request, env);
  if (recovery) return recovery;
  const credential = sessionCredential(request);
  const rawToken = credential.token;
  if (!rawToken) return null;
  const row = await env.DB.prepare(`SELECT s.session_id,s.expires_at,s.session_type,s.device_id,
      u.user_id,u.email,u.display_name,u.avatar_url,u.phone,u.address_line1,u.address_line2,
      u.city,u.state,u.postal_code,u.country,u.password_hash,
      m.membership_id,m.role,m.status,m.allowed_channel_ids_json,
      w.workspace_id,w.name AS workspace_name,w.slug AS workspace_slug
    FROM sessions s JOIN users u ON u.user_id=s.user_id
      JOIN memberships m ON m.user_id=s.user_id AND m.workspace_id=s.workspace_id
      JOIN workspaces w ON w.workspace_id=s.workspace_id
    WHERE s.token_hash=?1 AND s.revoked_at IS NULL AND s.expires_at>?2 AND m.status='active'
      AND w.status='active'`)
    .bind(await hashToken(rawToken), new Date().toISOString()).first();
  if (!row) return null;
  const expectedSource = row.session_type === 'mobile' ? 'bearer' : 'cookie';
  if (credential.source !== expectedSource) return null;
  return principalFromRow(row, row.session_type === 'mobile' ? 'mobile_session' : 'session');
}

export async function logout(request, env) {
  const token = sessionCredential(request).token;
  const principal = token ? await authenticateRequest(request, env) : null;
  if (token && (principal?.authType === 'session' || principal?.authType === 'mobile_session')) {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM mobile_push_devices WHERE session_id=?1').bind(principal.sessionId),
      env.DB.prepare('UPDATE sessions SET revoked_at=?2 WHERE token_hash=?1 AND revoked_at IS NULL')
        .bind(await hashToken(token), now)
    ]);
  }
  if (principal && (principal.authType === 'session' || principal.authType === 'mobile_session')) {
    await auditAuthAction(env, principal, 'logout', 'session', principal.sessionId || '', {
      client: principal.authType === 'mobile_session' ? 'android' : 'browser'
    });
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': clearCookieHeader(SESSION_COOKIE) }
  });
}

export function mobileAuthConfiguration(env) {
  return {
    enabled: Boolean(env.GOOGLE_CLIENT_ID),
    googleWebClientId: String(env.GOOGLE_CLIENT_ID || ''),
    packageName: 'com.helixcer.chat'
  };
}

export async function createMobileAuthChallenge(env, payload) {
  if (!env.GOOGLE_CLIENT_ID) throw authError(503, 'Google mobile sign-in is not configured.');
  const deviceId = cleanMobileDeviceId(payload?.deviceId);
  const nonce = randomToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MOBILE_CHALLENGE_TTL_SECONDS * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM mobile_auth_challenges
      WHERE device_id=?1 OR expires_at<=?2 OR consumed_at IS NOT NULL`).bind(deviceId, now.toISOString()),
    env.DB.prepare(`INSERT INTO mobile_auth_challenges
        (challenge_hash,device_id,expires_at,consumed_at,created_at)
      VALUES (?1,?2,?3,NULL,?4)`)
      .bind(await hashToken(nonce), deviceId, expiresAt, now.toISOString())
  ]);
  return { nonce, expiresAt };
}

export async function createGoogleMobileSession(env, payload, fetchImpl = fetch) {
  if (!env.GOOGLE_CLIENT_ID) throw authError(503, 'Google mobile sign-in is not configured.');
  const idToken = String(payload?.idToken || '').trim();
  if (!idToken || idToken.length > 16384) throw authError(400, 'A valid Google ID token is required.');
  const nonce = String(payload?.nonce || '').trim();
  if (nonce.length < 16 || nonce.length > 256) throw authError(400, 'A valid sign-in nonce is required.');
  const deviceId = cleanMobileDeviceId(payload?.deviceId);
  const challengeHash = await hashToken(nonce);
  const challenge = await env.DB.prepare(`SELECT challenge_hash FROM mobile_auth_challenges
    WHERE challenge_hash=?1 AND device_id=?2 AND consumed_at IS NULL AND expires_at>?3`)
    .bind(challengeHash, deviceId, new Date().toISOString()).first();
  if (!challenge) throw authError(401, 'The mobile sign-in challenge is invalid, expired, or already used.');
  const invitationToken = String(payload?.invitationToken || payload?.invite || '').trim();
  if (invitationToken.length > 256) throw authError(400, 'Invitation token is invalid.');
  const deviceName = cleanDeviceName(payload?.deviceName);
  const identity = await verifyGoogleIdToken(idToken, {
    clientId: env.GOOGLE_CLIENT_ID,
    nonceHash: challengeHash,
    authorizedParties: googleAuthorizedParties(env),
    jwksUrl: env.GOOGLE_JWKS_URL || GOOGLE_JWKS_URL
  }, fetchImpl);
  const consumed = await env.DB.prepare(`UPDATE mobile_auth_challenges SET consumed_at=?3
    WHERE challenge_hash=?1 AND device_id=?2 AND consumed_at IS NULL AND expires_at>?3`)
    .bind(challengeHash, deviceId, new Date().toISOString()).run();
  if (!consumed?.meta?.changes) throw authError(401, 'The mobile sign-in challenge is invalid, expired, or already used.');
  const principal = await provisionVerifiedIdentity(
    env,
    identity,
    invitationToken ? await hashToken(invitationToken) : null
  );
  const session = await createSession(env, principal, { sessionType: 'mobile', deviceId });
  await auditAuthAction(env, principal, 'login', 'session', session.sessionId, {
    authProvider: 'google_mobile',
    client: 'android',
    packageName: 'com.helixcer.chat',
    deviceId,
    ...(deviceName ? { deviceName } : {})
  });
  return {
    ok: true,
    token: session.token,
    tokenType: 'Bearer',
    expiresAt: session.expiresAt,
    me: principalView(principal)
  };
}

async function provisionVerifiedIdentity(env, identity, invitationTokenHash) {
  const now = new Date().toISOString();
  const email = normalizeEmail(identity.email);
  const workspaceId = (await resolveDefaultWorkspace(env)).workspace_id;
  let user = await env.DB.prepare('SELECT * FROM users WHERE google_sub=?1').bind(identity.sub).first();
  const emailOwner = await env.DB.prepare('SELECT user_id,google_sub,password_hash FROM users WHERE lower(email)=?1').bind(email).first();
  if (emailOwner && emailOwner.google_sub !== identity.sub) {
    if (isPasswordPlaceholderSub(emailOwner.google_sub)) {
      // Link Google to an existing password-created account for the same email.
      user = await env.DB.prepare('SELECT * FROM users WHERE user_id=?1').bind(emailOwner.user_id).first();
      await env.DB.prepare('UPDATE users SET google_sub=?2,updated_at=?3 WHERE user_id=?1')
        .bind(emailOwner.user_id, identity.sub, now).run();
      if (user) user.google_sub = identity.sub;
    } else {
      throw authError(409, 'This email is already linked to another Google identity.');
    }
  }

  const existingMembership = user
    ? await env.DB.prepare(`SELECT workspace_id FROM memberships
        WHERE user_id=?1 AND status='active' ORDER BY created_at LIMIT 1`).bind(user.user_id).first()
    : null;
  const membershipCount = await env.DB.prepare('SELECT count(*) AS count FROM memberships').first();
  const canBootstrap = Number(membershipCount?.count || 0) === 0 && env.BOOTSTRAP_OWNER_EMAIL &&
    timingSafeEqual(email, normalizeEmail(env.BOOTSTRAP_OWNER_EMAIL));
  let invite = null;
  if (invitationTokenHash) {
    invite = await env.DB.prepare(`SELECT invitation_id,workspace_id FROM invitations
      WHERE token_hash=?1 AND lower(email)=?2 AND status='pending' AND expires_at>?3`)
      .bind(invitationTokenHash, email, now).first();
    if (!invite) throw authError(403, 'This invitation is invalid or expired.');
  }
  if (!existingMembership && !canBootstrap && !invite) {
    throw authError(403, 'Your account has not been invited to this workspace.');
  }

  let createdUser = false;
  if (!user) {
    const userId = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO users
        (user_id,google_sub,email,display_name,avatar_url,email_verified,last_login_at,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,1,?6,?6,?6)`)
      .bind(userId, identity.sub, email, String(identity.name || '').slice(0, 160), String(identity.picture || '').slice(0, 1000), now).run();
    user = { user_id: userId, google_sub: identity.sub };
    createdUser = true;
  } else {
    // Keep a saved profile name/avatar; only fill blanks from Google on later sign-ins.
    await env.DB.prepare(`UPDATE users SET email=?2,
        display_name=CASE WHEN trim(display_name)='' THEN ?3 ELSE display_name END,
        avatar_url=CASE WHEN trim(avatar_url)='' THEN ?4 ELSE avatar_url END,
        email_verified=1,last_login_at=?5,updated_at=?5
      WHERE user_id=?1`).bind(user.user_id, email, String(identity.name || '').slice(0, 160), String(identity.picture || '').slice(0, 1000), now).run();
  }

  let selectedWorkspaceId = existingMembership?.workspace_id || '';
  if (canBootstrap) {
    const created = await env.DB.prepare(`INSERT INTO memberships
        (membership_id,workspace_id,user_id,role,status,created_at,updated_at)
      SELECT ?1,?2,?3,'owner','active',?4,?4 WHERE NOT EXISTS (SELECT 1 FROM memberships)`)
      .bind(crypto.randomUUID(), workspaceId, user.user_id, now).run();
    if (created.meta?.changes) selectedWorkspaceId = workspaceId;
  }

  if (invite) {
    const [membershipResult, invitationResult] = await env.DB.batch([
      env.DB.prepare(`INSERT INTO memberships
          (membership_id,workspace_id,user_id,role,status,invited_by_user_id,created_at,updated_at,allowed_channel_ids_json)
        SELECT ?1,i.workspace_id,?2,i.role,'active',i.invited_by_user_id,?3,?3,i.allowed_channel_ids_json
        FROM invitations i
        WHERE i.invitation_id=?4 AND i.token_hash=?5 AND lower(i.email)=?6
          AND i.status='pending' AND i.expires_at>?3
        ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role,status='active',
          invited_by_user_id=excluded.invited_by_user_id,updated_at=excluded.updated_at,
          allowed_channel_ids_json=excluded.allowed_channel_ids_json`)
        .bind(crypto.randomUUID(), user.user_id, now, invite.invitation_id, invitationTokenHash, email),
      env.DB.prepare(`UPDATE invitations SET status='accepted',accepted_at=?4,updated_at=?4
        WHERE invitation_id=?1 AND token_hash=?2 AND lower(email)=?3
          AND status='pending' AND expires_at>?4`)
        .bind(invite.invitation_id, invitationTokenHash, email, now)
    ]);
    if (!membershipResult?.meta?.changes || !invitationResult?.meta?.changes) {
      if (createdUser) {
        await env.DB.prepare('DELETE FROM users WHERE user_id=?1 AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id=?1)')
          .bind(user.user_id).run();
      }
      throw authError(403, 'This invitation is invalid or expired.');
    }
    selectedWorkspaceId = invite.workspace_id;
  }

  const row = await env.DB.prepare(`SELECT u.user_id,u.email,u.display_name,u.avatar_url,u.phone,u.address_line1,
      u.address_line2,u.city,u.state,u.postal_code,u.country,u.password_hash,m.membership_id,m.role,m.status,
      m.allowed_channel_ids_json,w.workspace_id,w.name AS workspace_name,w.slug AS workspace_slug
    FROM users u JOIN memberships m ON m.user_id=u.user_id JOIN workspaces w ON w.workspace_id=m.workspace_id
    WHERE u.user_id=?1 AND m.status='active' AND w.status='active' AND (?2='' OR m.workspace_id=?2)
    ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END LIMIT 1`)
    .bind(user.user_id, selectedWorkspaceId).first();
  if (!row) {
    if (createdUser) {
      await env.DB.prepare('DELETE FROM users WHERE user_id=?1 AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id=?1)')
        .bind(user.user_id).run();
    }
    const suspended = await env.DB.prepare(`SELECT 1 FROM memberships m
      JOIN workspaces w ON w.workspace_id=m.workspace_id
      WHERE m.user_id=?1 AND m.status='active' AND w.status='suspended'`).bind(user.user_id).first();
    if (suspended) throw authError(403, 'This workspace has been suspended. Contact Helixcer support.');
    throw authError(403, 'Your account has not been invited to this workspace.');
  }
  return principalFromRow(row);
}

async function createSession(env, principal, options = {}) {
  const token = randomToken(32);
  const maxAge = clampNumber(env.SESSION_TTL_SECONDS, 900, 2592000, 604800);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + maxAge * 1000).toISOString();
  const sessionId = crypto.randomUUID();
  const sessionType = options.sessionType === 'mobile' ? 'mobile' : 'browser';
  const deviceId = sessionType === 'mobile' ? cleanMobileDeviceId(options.deviceId) : null;
  await env.DB.prepare(`INSERT INTO sessions
      (session_id,token_hash,user_id,workspace_id,expires_at,last_seen_at,created_at,session_type,device_id)
    VALUES (?1,?2,?3,?4,?5,?6,?6,?7,?8)`)
    .bind(sessionId, await hashToken(token), principal.user.userId, principal.workspace.workspaceId,
      expiresAt, now.toISOString(), sessionType, deviceId).run();
  return { token, maxAge, sessionId, expiresAt };
}

export async function listTeam(env, principal) {
  const { requirePermission } = await import('./roles.js');
  requirePermission(principal, 'team.manage');
  const [members, invitations] = await Promise.all([
    env.DB.prepare(`SELECT m.membership_id,m.user_id,m.role,m.status,m.created_at,m.allowed_channel_ids_json,
        u.email,u.display_name,u.avatar_url
      FROM memberships m JOIN users u ON u.user_id=m.user_id
      WHERE m.workspace_id=?1 ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END,u.display_name`)
      .bind(principal.workspace.workspaceId).all(),
    env.DB.prepare(`SELECT invitation_id,email,role,status,expires_at,created_at,allowed_channel_ids_json FROM invitations
      WHERE workspace_id=?1 AND status='pending' ORDER BY created_at DESC`).bind(principal.workspace.workspaceId).all()
  ]);
  return {
    members: members.results.map(memberView),
    invitations: invitations.results.map(invitationView)
  };
}

export async function createInvitation(request, env, principal, payload) {
  const { assertAssignableRole, requirePermission } = await import('./roles.js');
  requirePermission(principal, 'team.manage');
  const email = normalizeEmail(payload.email);
  if (!email || !email.includes('@') || email.length > 254) throw authError(400, 'A valid email is required.');
  const role = String(payload.role || 'agent');
  const assignable = await assertAssignableRole(env, principal.workspace.workspaceId, role, { allowOwner: false });
  if (principal.membership.role !== 'owner' && assignable.isElevated) {
    throw authError(403, 'Only an owner can invite members with elevated workspace access.');
  }
  const allowedChannelIds = await resolveAllowedChannelIds(env, principal.workspace.workspaceId, role, payload, {
    // Chat UI always sends a selection. Omitting the field keeps legacy/API invites unrestricted.
    required: false,
    permissions: assignable.permissions
  });
  const existing = await env.DB.prepare(`SELECT m.membership_id FROM memberships m JOIN users u ON u.user_id=m.user_id
    WHERE m.workspace_id=?1 AND lower(u.email)=?2 AND m.status='active'`).bind(principal.workspace.workspaceId, email).first();
  if (existing) throw authError(409, 'This user is already a workspace member.');
  const token = randomToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const invitationId = crypto.randomUUID();
  const allowedJson = JSON.stringify(allowedChannelIds);
  await env.DB.batch([
    env.DB.prepare(`UPDATE invitations SET status='cancelled',updated_at=?3
      WHERE workspace_id=?1 AND lower(email)=?2 AND status='pending'`).bind(principal.workspace.workspaceId, email, now.toISOString()),
    env.DB.prepare(`INSERT INTO invitations
        (invitation_id,workspace_id,email,role,token_hash,status,invited_by_user_id,expires_at,created_at,updated_at,allowed_channel_ids_json)
      VALUES (?1,?2,?3,?4,?5,'pending',?6,?7,?8,?8,?9)`)
      .bind(invitationId, principal.workspace.workspaceId, email, role, await hashToken(token),
        principal.user.userId || null, expiresAt, now.toISOString(), allowedJson)
  ]);
  await auditAuthAction(env, principal, 'invite', 'invitation', invitationId, {
    email, role, allowedChannelIds
  });
  return {
    ok: true,
    invitation: {
      invitationId, email, role, status: 'pending', expiresAt, createdAt: now.toISOString(),
      allowedChannelIds
    },
    inviteUrl: appInviteUrl(env, token, payload.returnTo || payload.return_to || '/')
  };
}

export async function updateMembership(env, principal, membershipId, payload) {
  const { assertAssignableRole, requirePermission } = await import('./roles.js');
  requirePermission(principal, 'team.manage');
  const target = await env.DB.prepare(`SELECT m.membership_id,m.user_id,m.role,m.status,m.created_at,m.allowed_channel_ids_json,
      u.email,u.display_name,u.avatar_url
    FROM memberships m JOIN users u ON u.user_id=m.user_id WHERE m.membership_id=?1 AND m.workspace_id=?2`)
    .bind(membershipId, principal.workspace.workspaceId).first();
  if (!target) throw authError(404, 'Team member not found.');
  const nextRole = payload.role === undefined ? target.role : String(payload.role);
  const nextStatus = payload.status === undefined ? target.status : String(payload.status);
  if (!['active', 'disabled'].includes(nextStatus)) throw authError(400, 'Invalid member status.');
  const nextAssignable = await assertAssignableRole(env, principal.workspace.workspaceId, nextRole, {
    allowOwner: nextRole === 'owner'
  });
  const targetAssignable = await assertAssignableRole(env, principal.workspace.workspaceId, target.role, {
    allowOwner: target.role === 'owner'
  });
  if (principal.membership.role !== 'owner') {
    if (targetAssignable.isElevated || nextAssignable.isElevated || nextRole === 'owner' || target.role === 'owner') {
      throw authError(403, 'Administrators can only manage non-elevated team members.');
    }
  }
  const removesOwner = target.role === 'owner' && (nextRole !== 'owner' || nextStatus !== 'active');
  if (removesOwner) {
    const owners = await env.DB.prepare(`SELECT count(*) AS count FROM memberships
      WHERE workspace_id=?1 AND role='owner' AND status='active'`).bind(principal.workspace.workspaceId).first();
    if (Number(owners?.count || 0) <= 1) throw authError(409, 'The workspace must retain at least one active owner.');
  }
  let nextAllowedJson = target.allowed_channel_ids_json || '[]';
  const usesChannelAllowList = roleUsesChannelAllowList(nextRole, nextAssignable.permissions);
  if (!usesChannelAllowList) {
    nextAllowedJson = '[]';
  } else if (payload.allowedChannelIds !== undefined || payload.allowed_channel_ids !== undefined) {
    const allowedChannelIds = await resolveAllowedChannelIds(env, principal.workspace.workspaceId, nextRole, payload, {
      required: true,
      permissions: nextAssignable.permissions
    });
    nextAllowedJson = JSON.stringify(allowedChannelIds);
  }
  const now = new Date().toISOString();
  const changed = await env.DB.prepare(`UPDATE memberships SET role=?3,status=?4,allowed_channel_ids_json=?5,updated_at=?6
    WHERE membership_id=?1 AND workspace_id=?2 AND (
      role!='owner' OR (?3='owner' AND ?4='active') OR
      (SELECT count(*) FROM memberships WHERE workspace_id=?2 AND role='owner' AND status='active')>1
    )`).bind(membershipId, principal.workspace.workspaceId, nextRole, nextStatus, nextAllowedJson, now).run();
  if (!changed.meta?.changes) throw authError(409, 'The workspace must retain at least one active owner.');
  if (nextStatus === 'disabled') {
    await env.DB.prepare('UPDATE sessions SET revoked_at=?3 WHERE user_id=?1 AND workspace_id=?2 AND revoked_at IS NULL')
      .bind(target.user_id, principal.workspace.workspaceId, now).run();
  }
  await auditAuthAction(env, principal, 'update', 'membership', membershipId, {
    targetEmail: target.email, previousRole: target.role, role: nextRole,
    previousStatus: target.status, status: nextStatus,
    allowedChannelIds: parseAllowedChannelIds(nextAllowedJson)
  });
  const updated = { ...target, role: nextRole, status: nextStatus, allowed_channel_ids_json: nextAllowedJson };
  return { ok: true, item: memberView(updated) };
}

export async function updateInvitation(env, principal, invitationId, payload) {
  const { assertAssignableRole, requirePermission } = await import('./roles.js');
  requirePermission(principal, 'team.manage');
  if (payload.status !== 'cancelled') throw authError(400, 'Only cancellation is supported for pending invitations.');
  const invitation = await env.DB.prepare(`SELECT invitation_id,role,status FROM invitations
    WHERE invitation_id=?1 AND workspace_id=?2`).bind(invitationId, principal.workspace.workspaceId).first();
  if (!invitation || invitation.status !== 'pending') throw authError(404, 'Pending invitation not found.');
  const inviteRole = await assertAssignableRole(env, principal.workspace.workspaceId, invitation.role, { allowOwner: false });
  if (principal.membership.role !== 'owner' && inviteRole.isElevated) {
    throw authError(403, 'Only an owner can cancel an elevated invitation.');
  }
  await env.DB.prepare("UPDATE invitations SET status='cancelled',updated_at=?3 WHERE invitation_id=?1 AND workspace_id=?2")
    .bind(invitationId, principal.workspace.workspaceId, new Date().toISOString()).run();
  await auditAuthAction(env, principal, 'cancel', 'invitation', invitationId, {});
  return { ok: true, invitationId, status: 'cancelled' };
}

export function requireRole(principal, minimumRole) {
  const rank = { agent: 1, admin: 2, owner: 3 };
  if (!principal || (rank[principal.membership?.role] || 0) < rank[minimumRole]) throw authError(403, 'Insufficient workspace permission.');
  return principal;
}

/**
 * Returns the channel IDs a restricted member may use, or null when access is unrestricted
 * (owners, admins, elevated roles, and legacy agents with an empty allow-list).
 */
export function restrictedChannelIds(principal) {
  if (!principal?.membership) return null;
  if (!roleUsesChannelAllowList(principal.membership.role, principal.permissions)) return null;
  const ids = Array.isArray(principal.membership.allowedChannelIds)
    ? principal.membership.allowedChannelIds
    : parseAllowedChannelIds(principal.membership.allowedChannelIdsJson);
  return ids.length ? ids : null;
}

export function roleUsesChannelAllowList(role, permissions = null) {
  const key = String(role || '');
  if (!key || key === 'owner' || key === 'admin') return false;
  if (permissions?.channels?.manage) return false;
  return true;
}

export function parseAllowedChannelIds(value) {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.map(item => String(item || '').trim()).filter(Boolean))];
}

export async function resolveAllowedChannelIds(env, workspaceId, role, payload = {}, options = {}) {
  if (!roleUsesChannelAllowList(role, options.permissions)) return [];
  const raw = payload.allowedChannelIds ?? payload.allowed_channel_ids;
  if (raw === undefined || raw === null) {
    if (options.required) throw authError(400, 'Select at least one messaging channel for this agent.');
    return [];
  }
  if (!Array.isArray(raw)) throw authError(400, 'allowedChannelIds must be an array of channel IDs.');
  const ids = parseAllowedChannelIds(raw);
  if (!ids.length) throw authError(400, 'Select at least one messaging channel for this agent.');
  if (ids.length > 200) throw authError(400, 'Too many messaging channels were selected.');
  for (const id of ids) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(id)) {
      throw authError(400, 'One or more selected channel IDs are invalid.');
    }
  }
  const result = await env.DB.prepare('SELECT channel_id FROM channels WHERE workspace_id=?1')
    .bind(workspaceId).all();
  const known = new Set((result.results || []).map(row => row.channel_id));
  const missing = ids.filter(id => !known.has(id));
  if (missing.length) throw authError(400, 'One or more selected channels were not found in this workspace.');
  return ids;
}

export function principalView(principal) {
  return {
    authenticated: true,
    user: {
      ...principal.user,
      hasPassword: Boolean(principal.user?.hasPassword)
    },
    workspace: principal.workspace,
    membership: {
      ...principal.membership,
      allowedChannelIds: Array.isArray(principal.membership?.allowedChannelIds)
        ? principal.membership.allowedChannelIds
        : []
    },
    permissions: principal.permissions || null,
    hasPassword: Boolean(principal.user?.hasPassword)
  };
}

export async function verifyGoogleIdToken(idToken, options, fetchImpl = fetch) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw authError(401, 'Invalid Google ID token.');
  let header;
  let payload;
  try {
    header = JSON.parse(decoder.decode(base64UrlDecode(parts[0])));
    payload = JSON.parse(decoder.decode(base64UrlDecode(parts[1])));
  } catch {
    throw authError(401, 'Invalid Google ID token encoding.');
  }
  if (header.alg !== 'RS256' || !header.kid) throw authError(401, 'Unsupported Google ID token signature.');
  const jwksUrl = options.jwksUrl || GOOGLE_JWKS_URL;
  let keys = await getGoogleJwks(jwksUrl, fetchImpl);
  let jwk = keys.find(item => item.kid === header.kid && item.kty === 'RSA' && (!item.alg || item.alg === 'RS256') && (!item.use || item.use === 'sig'));
  if (!jwk) {
    keys = await getGoogleJwks(jwksUrl, fetchImpl, true);
    jwk = keys.find(item => item.kid === header.kid && item.kty === 'RSA' && (!item.alg || item.alg === 'RS256') && (!item.use || item.use === 'sig'));
  }
  if (!jwk) throw authError(401, 'Google signing key not found.');
  const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const validSignature = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, base64UrlDecode(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
  if (!validSignature) throw authError(401, 'Invalid Google ID token signature.');
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(options.clientId)) throw authError(401, 'Google ID token audience mismatch.');
  const authorizedParties = new Set(options.authorizedParties || [options.clientId]);
  if (payload.azp && !authorizedParties.has(payload.azp)) throw authError(401, 'Google ID token authorized-party mismatch.');
  if (!GOOGLE_ISSUERS.has(payload.iss)) throw authError(401, 'Google ID token issuer mismatch.');
  if (!Number.isFinite(payload.exp) || payload.exp <= now - 30) throw authError(401, 'Google ID token expired.');
  if (payload.nbf !== undefined && (!Number.isFinite(payload.nbf) || payload.nbf > now + 30)) throw authError(401, 'Google ID token is not active yet.');
  if (payload.iat !== undefined && (!Number.isFinite(payload.iat) || payload.iat > now + 300)) throw authError(401, 'Google ID token issued in the future.');
  if (options.nonceHash && (!payload.nonce || !timingSafeEqual(await hashToken(payload.nonce), options.nonceHash))) throw authError(401, 'Google ID token nonce mismatch.');
  if (!(payload.email_verified === true || payload.email_verified === 'true')) throw authError(403, 'Google email is not verified.');
  if (!payload.sub || !payload.email) throw authError(401, 'Google identity is incomplete.');
  return {
    sub: String(payload.sub), email: normalizeEmail(payload.email), name: String(payload.name || ''),
    picture: String(payload.picture || ''), emailVerified: true
  };
}

async function getGoogleJwks(url, fetchImpl, forceRefresh = false) {
  const now = Date.now();
  const cached = jwksCache.get(url);
  if (!forceRefresh && cached && cached.expiresAt > now) return cached.keys;
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw authError(503, 'Unable to load Google signing keys.');
  const body = await response.json();
  if (!Array.isArray(body.keys)) throw authError(503, 'Google signing keys response is invalid.');
  const maxAge = parseCacheMaxAge(response.headers.get('Cache-Control')) || 3600;
  jwksCache.set(url, { keys: body.keys, expiresAt: now + Math.min(maxAge, 21600) * 1000 });
  return body.keys;
}

export async function auditAuthAction(env, principal, action, targetType, targetId, details) {
  await env.DB.prepare(`INSERT INTO audit_log
      (audit_id,actor,action,target_type,target_id,details_json,timestamp,workspace_id,actor_user_id,actor_email)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?2)`)
    .bind(crypto.randomUUID(), principal.user.email, action, targetType, targetId,
      JSON.stringify(details || {}), new Date().toISOString(), principal.workspace.workspaceId, principal.user.userId || '').run();
}

async function recoveryPrincipal(request, env) {
  if (String(env.RECOVERY_MODE || '').toLowerCase() !== 'true' || !env.ADMIN_TOKEN) return null;
  const header = request.headers.get('Authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const direct = request.headers.get('X-Admin-Token') || '';
  if (!timingSafeEqual(bearer || direct, env.ADMIN_TOKEN)) return null;
  const workspace = await resolveDefaultWorkspace(env);
  return {
    authType: 'recovery',
    user: {
      userId: '', email: 'emergency-recovery', displayName: 'Emergency recovery', avatarUrl: '',
      phone: '', addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '', country: ''
    },
    workspace: { workspaceId: workspace.workspace_id, name: workspace.name, slug: workspace.slug },
    membership: { membershipId: '', role: 'owner', status: 'active' }
  };
}

async function resolveDefaultWorkspace(env) {
  const configured = String(env.DEFAULT_WORKSPACE_ID || '').trim();
  let workspace = configured
    ? await env.DB.prepare('SELECT workspace_id,name,slug FROM workspaces WHERE workspace_id=?1 LIMIT 1').bind(configured).first()
    : null;
  if (!workspace) {
    workspace = await env.DB.prepare(`SELECT workspace_id,name,slug FROM workspaces
      WHERE kind='internal' ORDER BY created_at LIMIT 1`).first();
  }
  if (!workspace) {
    const result = await env.DB.prepare('SELECT workspace_id,name,slug FROM workspaces ORDER BY created_at,workspace_id LIMIT 2').all();
    if ((result.results || []).length === 1) workspace = result.results[0];
  }
  if (!workspace) throw authError(503, 'The workspace is not configured.');
  return workspace;
}

function principalFromRow(row, authType = 'session') {
  const allowedChannelIds = parseAllowedChannelIds(row.allowed_channel_ids_json);
  return {
    authType, sessionId: row.session_id || '', sessionExpiresAt: row.expires_at || '',
    deviceId: row.device_id || '',
    user: {
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      phone: row.phone || '',
      addressLine1: row.address_line1 || '',
      addressLine2: row.address_line2 || '',
      city: row.city || '',
      state: row.state || '',
      postalCode: row.postal_code || '',
      country: row.country || '',
      hasPassword: Boolean(row.password_hash)
    },
    workspace: { workspaceId: row.workspace_id, name: row.workspace_name, slug: row.workspace_slug },
    membership: {
      membershipId: row.membership_id, role: row.role, status: row.status,
      allowedChannelIds
    }
  };
}

function cleanProfileText(value, label, maxLength, { required = false } = {}) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!text) {
    if (required) throw authError(400, `${label} is required.`);
    return '';
  }
  if (text.length > maxLength) throw authError(400, `${label} must be ${maxLength} characters or fewer.`);
  return text;
}

function cleanProfilePhone(value) {
  const phone = String(value ?? '').trim();
  if (!phone) return '';
  if (phone.length > 32) throw authError(400, 'Phone number must be 32 characters or fewer.');
  if (!/^\+?[0-9()\s.-]{6,32}$/.test(phone)) {
    throw authError(400, 'Enter a phone number with country code, for example +91 98765 43210.');
  }
  return phone.replace(/\s+/g, ' ');
}

export async function updateUserProfile(env, principal, payload = {}) {
  if (!principal?.user?.userId) {
    throw authError(403, 'A signed-in account is required to update your profile.');
  }
  if (!['session', 'mobile_session'].includes(principal.authType)) {
    throw authError(403, 'A verified session is required to update your profile.');
  }
  const body = payload && typeof payload === 'object' ? payload : {};
  const displayName = cleanProfileText(body.displayName ?? body.name, 'Name', 120, { required: true });
  const phone = cleanProfilePhone(body.phone ?? body.phoneNumber);
  const addressLine1 = cleanProfileText(body.addressLine1, 'Address line 1', 180);
  const addressLine2 = cleanProfileText(body.addressLine2, 'Address line 2', 180);
  const city = cleanProfileText(body.city, 'City', 100);
  const region = cleanProfileText(body.state, 'State / region', 100);
  const postalCode = cleanProfileText(body.postalCode, 'Postal code', 24);
  const country = cleanProfileText(body.country, 'Country', 100);
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE users SET display_name=?2,phone=?3,address_line1=?4,address_line2=?5,
      city=?6,state=?7,postal_code=?8,country=?9,updated_at=?10
    WHERE user_id=?1`)
    .bind(principal.user.userId, displayName, phone, addressLine1, addressLine2, city, region, postalCode, country, now)
    .run();
  const user = {
    ...principal.user,
    displayName,
    phone,
    addressLine1,
    addressLine2,
    city,
    state: region,
    postalCode,
    country
  };
  await auditAuthAction(env, { ...principal, user }, 'profile.updated', 'user', principal.user.userId, {
    fields: ['displayName', 'phone', 'address']
  });
  return { ...principal, user };
}

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
// Keep PBKDF2 within Cloudflare Workers CPU limits (600k exceeds standard isolate budgets).
const PASSWORD_PBKDF2_ITERATIONS = 100000;
const PASSWORD_RESET_TTL_SECONDS = 60 * 60;

export async function previewInvitation(env, token) {
  const raw = String(token || '').trim();
  if (!raw || raw.length > 256) throw authError(400, 'Invitation token is invalid.');
  const invite = await env.DB.prepare(`SELECT email,expires_at FROM invitations
    WHERE token_hash=?1 AND status='pending' AND expires_at>?2`)
    .bind(await hashToken(raw), new Date().toISOString()).first();
  if (!invite) throw authError(404, 'This invitation is invalid or expired.');
  return { email: normalizeEmail(invite.email), expiresAt: invite.expires_at };
}

export async function loginWithPassword(env, payload = {}) {
  const email = normalizeEmail(payload.email);
  const password = String(payload.password ?? '');
  if (!email || !email.includes('@') || email.length > 254) throw authError(400, 'A valid email is required.');
  if (!password) throw authError(400, 'Password is required.');
  const user = await env.DB.prepare(`SELECT user_id,email,password_hash FROM users WHERE lower(email)=?1`).bind(email).first();
  if (!user?.password_hash) throw authError(401, 'Invalid email or password.');
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) throw authError(401, 'Invalid email or password.');
  const principal = await activePrincipalForUser(env, user.user_id);
  if (!principal) throw authError(403, 'Your account has not been invited to this workspace.');
  const session = await createSession(env, principal);
  await env.DB.prepare('UPDATE users SET last_login_at=?2,updated_at=?2 WHERE user_id=?1')
    .bind(user.user_id, new Date().toISOString()).run();
  await auditAuthAction(env, principal, 'login', 'session', session.sessionId, { authProvider: 'password' });
  return sessionResponse(session, principal);
}

export async function requestPasswordReset(env, payload = {}) {
  const email = normalizeEmail(payload.email);
  const generic = { ok: true };
  if (!email || !email.includes('@') || email.length > 254) return generic;
  const now = new Date();
  const nowIso = now.toISOString();
  const user = await env.DB.prepare(`SELECT u.user_id,u.email FROM users u
      JOIN memberships m ON m.user_id=u.user_id
      JOIN workspaces w ON w.workspace_id=m.workspace_id
    WHERE lower(u.email)=?1 AND m.status='active' AND w.status='active'
    ORDER BY u.created_at LIMIT 1`).bind(email).first();
  const invite = user
    ? null
    : await env.DB.prepare(`SELECT invitation_id,email FROM invitations
        WHERE lower(email)=?1 AND status='pending' AND expires_at>?2
        ORDER BY created_at DESC LIMIT 1`).bind(email, nowIso).first();
  if (!user && !invite) return generic;

  const token = randomToken(32);
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_SECONDS * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE password_reset_tokens SET consumed_at=?2
      WHERE lower(email)=?1 AND consumed_at IS NULL`).bind(email, nowIso),
    env.DB.prepare(`INSERT INTO password_reset_tokens
        (token_hash,email,user_id,invitation_id,expires_at,consumed_at,created_at)
      VALUES (?1,?2,?3,?4,?5,NULL,?6)`)
      .bind(await hashToken(token), email, user?.user_id || null, invite?.invitation_id || null, expiresAt, nowIso)
  ]);

  const resetUrl = appResetUrl(env, token);
  try {
    const { sendTransactionalEmail, passwordResetEmailContent } = await import('./mail.js');
    const content = passwordResetEmailContent(resetUrl);
    await sendTransactionalEmail(env, { to: email, ...content });
  } catch (error) {
    console.error('password_reset_email_failed', {
      code: error?.code || '',
      message: error?.message || 'Unknown email failure'
    });
  }
  return generic;
}

export async function resetPasswordWithToken(env, payload = {}) {
  const token = String(payload.token || payload.resetToken || '').trim();
  if (!token || token.length > 256) throw authError(400, 'This reset link is invalid or expired.');
  const password = cleanNewPassword(payload.password ?? payload.newPassword);
  const now = new Date().toISOString();
  const tokenHash = await hashToken(token);
  const row = await env.DB.prepare(`SELECT token_hash,email,user_id,invitation_id,expires_at
    FROM password_reset_tokens WHERE token_hash=?1 AND consumed_at IS NULL AND expires_at>?2`)
    .bind(tokenHash, now).first();
  if (!row) throw authError(400, 'This reset link is invalid or expired.');

  const passwordHash = await hashPassword(password);
  let userId = row.user_id || '';
  if (userId) {
    await env.DB.prepare('UPDATE users SET password_hash=?2,updated_at=?3 WHERE user_id=?1')
      .bind(userId, passwordHash, now).run();
  } else if (row.invitation_id) {
    const created = await createUserFromInvitation(env, {
      invitationId: row.invitation_id,
      email: row.email,
      passwordHash,
      now
    });
    userId = created.userId;
  } else {
    throw authError(400, 'This reset link is invalid or expired.');
  }

  await env.DB.prepare('UPDATE password_reset_tokens SET consumed_at=?2 WHERE token_hash=?1')
    .bind(tokenHash, now).run();
  await env.DB.prepare(`UPDATE password_reset_tokens SET consumed_at=?2
    WHERE lower(email)=?1 AND consumed_at IS NULL`).bind(normalizeEmail(row.email), now).run();

  const principal = await activePrincipalForUser(env, userId);
  if (!principal) throw authError(403, 'Your account has not been invited to this workspace.');
  const session = await createSession(env, principal);
  await env.DB.prepare('UPDATE users SET last_login_at=?2,updated_at=?2 WHERE user_id=?1')
    .bind(userId, now).run();
  await auditAuthAction(env, principal, 'password.reset', 'user', userId, { authProvider: 'password_reset' });
  await auditAuthAction(env, principal, 'login', 'session', session.sessionId, { authProvider: 'password_reset' });
  return sessionResponse(session, principal);
}

export async function acceptInvitationWithPassword(env, payload = {}) {
  const inviteToken = String(payload.invite || payload.invitationToken || payload.token || '').trim();
  if (!inviteToken || inviteToken.length > 256) throw authError(400, 'Invitation token is invalid.');
  const password = cleanNewPassword(payload.password ?? payload.newPassword);
  const now = new Date().toISOString();
  const invitationTokenHash = await hashToken(inviteToken);
  const invite = await env.DB.prepare(`SELECT invitation_id,email,workspace_id FROM invitations
    WHERE token_hash=?1 AND status='pending' AND expires_at>?2`)
    .bind(invitationTokenHash, now).first();
  if (!invite) throw authError(403, 'This invitation is invalid or expired.');
  const email = normalizeEmail(invite.email);
  const existing = await env.DB.prepare('SELECT user_id,password_hash,google_sub FROM users WHERE lower(email)=?1')
    .bind(email).first();
  let userId = existing?.user_id || '';
  const passwordHash = await hashPassword(password);
  if (existing) {
    await env.DB.prepare('UPDATE users SET password_hash=?2,updated_at=?3 WHERE user_id=?1')
      .bind(existing.user_id, passwordHash, now).run();
    await acceptPendingInvitation(env, {
      invitationId: invite.invitation_id,
      invitationTokenHash,
      email,
      userId: existing.user_id,
      now
    });
  } else {
    const created = await createUserFromInvitation(env, {
      invitationId: invite.invitation_id,
      invitationTokenHash,
      email,
      passwordHash,
      now
    });
    userId = created.userId;
  }
  const principal = await activePrincipalForUser(env, userId, invite.workspace_id);
  if (!principal) throw authError(403, 'Your account has not been invited to this workspace.');
  const session = await createSession(env, principal);
  await env.DB.prepare('UPDATE users SET last_login_at=?2,updated_at=?2 WHERE user_id=?1')
    .bind(userId, now).run();
  await auditAuthAction(env, principal, 'login', 'session', session.sessionId, { authProvider: 'password_invite' });
  return sessionResponse(session, principal);
}

export async function changePassword(env, principal, payload = {}) {
  if (!principal?.user?.userId) {
    throw authError(403, 'A signed-in account is required to change your password.');
  }
  if (!['session', 'mobile_session'].includes(principal.authType)) {
    throw authError(403, 'A verified session is required to change your password.');
  }
  const row = await env.DB.prepare('SELECT password_hash FROM users WHERE user_id=?1')
    .bind(principal.user.userId).first();
  if (!row) throw authError(404, 'Account not found.');
  const hasPassword = Boolean(row.password_hash);
  const currentPassword = String(payload.currentPassword ?? payload.password ?? '');
  if (hasPassword) {
    if (!currentPassword) throw authError(400, 'Current password is required.');
    const valid = await verifyPassword(currentPassword, row.password_hash);
    if (!valid) throw authError(401, 'Current password is incorrect.');
  }
  const nextPassword = cleanNewPassword(payload.newPassword ?? payload.passwordNew);
  if (hasPassword && currentPassword === nextPassword) {
    throw authError(400, 'Choose a different new password.');
  }
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE users SET password_hash=?2,updated_at=?3 WHERE user_id=?1')
    .bind(principal.user.userId, await hashPassword(nextPassword), now).run();
  await auditAuthAction(env, principal, hasPassword ? 'password.changed' : 'password.set', 'user', principal.user.userId, {});
  return {
    ok: true,
    ...principalView({
      ...principal,
      user: { ...principal.user, hasPassword: true }
    })
  };
}

async function createUserFromInvitation(env, {
  invitationId, invitationTokenHash = null, email, passwordHash, now
}) {
  const invite = await env.DB.prepare(`SELECT invitation_id,workspace_id,token_hash,email FROM invitations
    WHERE invitation_id=?1 AND status='pending' AND expires_at>?2`)
    .bind(invitationId, now).first();
  if (!invite || normalizeEmail(invite.email) !== normalizeEmail(email)) {
    throw authError(403, 'This invitation is invalid or expired.');
  }
  const tokenHash = invitationTokenHash || invite.token_hash;
  const userId = crypto.randomUUID();
  const googleSub = passwordPlaceholderSub(userId);
  await env.DB.prepare(`INSERT INTO users
      (user_id,google_sub,email,display_name,avatar_url,email_verified,password_hash,last_login_at,created_at,updated_at)
    VALUES (?1,?2,?3,'', '',1,?4,?5,?5,?5)`)
    .bind(userId, googleSub, normalizeEmail(email), passwordHash, now).run();
  try {
    await acceptPendingInvitation(env, {
      invitationId: invite.invitation_id,
      invitationTokenHash: tokenHash,
      email: normalizeEmail(email),
      userId,
      now
    });
  } catch (error) {
    try {
      await env.DB.prepare('DELETE FROM users WHERE user_id=?1 AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id=?1)')
        .bind(userId).run();
    } catch (cleanupError) {
      console.error('invite_user_cleanup_failed', {
        message: cleanupError?.message || 'Unknown cleanup failure',
        userId
      });
    }
    throw error;
  }
  return { userId };
}

async function acceptPendingInvitation(env, { invitationId, invitationTokenHash, email, userId, now }) {
  const normalizedEmail = normalizeEmail(email);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO memberships
        (membership_id,workspace_id,user_id,role,status,invited_by_user_id,created_at,updated_at,allowed_channel_ids_json)
      SELECT ?1,i.workspace_id,?2,i.role,'active',i.invited_by_user_id,?3,?3,i.allowed_channel_ids_json
      FROM invitations i
      WHERE i.invitation_id=?4 AND i.token_hash=?5 AND lower(i.email)=?6
        AND i.status='pending' AND i.expires_at>?3
      ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role,status='active',
        invited_by_user_id=excluded.invited_by_user_id,updated_at=excluded.updated_at,
        allowed_channel_ids_json=excluded.allowed_channel_ids_json`)
      .bind(crypto.randomUUID(), userId, now, invitationId, invitationTokenHash, normalizedEmail),
    env.DB.prepare(`UPDATE invitations SET status='accepted',accepted_at=?4,updated_at=?4
      WHERE invitation_id=?1 AND token_hash=?2 AND lower(email)=?3
        AND status='pending' AND expires_at>?4`)
      .bind(invitationId, invitationTokenHash, normalizedEmail, now)
  ]);
  // D1 batch meta.changes is not always reliable for INSERT…SELECT / ON CONFLICT.
  // Confirm acceptance by reading the resulting rows instead of trusting write meta.
  const accepted = await env.DB.prepare(`SELECT workspace_id FROM invitations
    WHERE invitation_id=?1 AND token_hash=?2 AND lower(email)=?3 AND status='accepted'`)
    .bind(invitationId, invitationTokenHash, normalizedEmail).first();
  if (!accepted) throw authError(403, 'This invitation is invalid or expired.');
  const membership = await env.DB.prepare(`SELECT membership_id FROM memberships
    WHERE workspace_id=?1 AND user_id=?2 AND status='active'`)
    .bind(accepted.workspace_id, userId).first();
  if (!membership) throw authError(403, 'This invitation is invalid or expired.');
}

async function activePrincipalForUser(env, userId, preferredWorkspaceId = '') {
  const row = await env.DB.prepare(`SELECT u.user_id,u.email,u.display_name,u.avatar_url,u.phone,u.address_line1,
      u.address_line2,u.city,u.state,u.postal_code,u.country,u.password_hash,m.membership_id,m.role,m.status,
      m.allowed_channel_ids_json,w.workspace_id,w.name AS workspace_name,w.slug AS workspace_slug
    FROM users u JOIN memberships m ON m.user_id=u.user_id JOIN workspaces w ON w.workspace_id=m.workspace_id
    WHERE u.user_id=?1 AND m.status='active' AND w.status='active' AND (?2='' OR m.workspace_id=?2)
    ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END LIMIT 1`)
    .bind(userId, preferredWorkspaceId || '').first();
  if (!row) {
    const suspended = await env.DB.prepare(`SELECT 1 FROM memberships m
      JOIN workspaces w ON w.workspace_id=m.workspace_id
      WHERE m.user_id=?1 AND m.status='active' AND w.status='suspended'`).bind(userId).first();
    if (suspended) throw authError(403, 'This workspace has been suspended. Contact Helixcer support.');
    return null;
  }
  return principalFromRow(row);
}

function sessionResponse(session, principal) {
  return {
    ok: true,
    me: principalView(principal),
    expiresAt: session.expiresAt,
    sessionId: session.sessionId,
    maxAge: session.maxAge,
    token: session.token
  };
}

function appInviteUrl(env, token, returnTo = '/') {
  const base = String(env.APP_ORIGIN || '').trim() || 'https://chat.helixcer.com';
  const url = new URL(base.endsWith('/') ? base : `${base}/`);
  url.searchParams.set('invite', token);
  try {
    const safeReturn = validateReturnTo(returnTo, env);
    const returnUrl = new URL(safeReturn);
    if (returnUrl.hash) url.hash = returnUrl.hash;
  } catch { /* Keep the default app origin invite link. */ }
  return url.toString();
}

function appResetUrl(env, token) {
  const base = String(env.APP_ORIGIN || '').trim() || 'https://chat.helixcer.com';
  const url = new URL(base.endsWith('/') ? base : `${base}/`);
  url.searchParams.set('reset', token);
  return url.toString();
}

function cleanNewPassword(value) {
  const password = String(value ?? '');
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw authError(400, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw authError(400, `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`);
  }
  if (/\s/.test(password)) throw authError(400, 'Password cannot contain spaces.');
  return password;
}

function passwordPlaceholderSub(userId) {
  return `password:${userId}`;
}

function isPasswordPlaceholderSub(value) {
  return String(value || '').startsWith('password:');
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_PBKDF2_ITERATIONS },
    key,
    256
  );
  return `pbkdf2-sha256$${PASSWORD_PBKDF2_ITERATIONS}$${base64UrlEncode(salt)}$${base64UrlEncode(new Uint8Array(bits))}`;
}

export async function verifyPassword(password, encoded) {
  const parts = String(encoded || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 10000 || iterations > 5000000) return false;
  let salt;
  let expected;
  try {
    salt = base64UrlDecode(parts[2]);
    expected = base64UrlDecode(parts[3]);
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    expected.length * 8
  );
  return timingSafeEqualBytes(new Uint8Array(bits), expected);
}

function timingSafeEqualBytes(left, right) {
  const a = left instanceof Uint8Array ? left : new Uint8Array(left || []);
  const b = right instanceof Uint8Array ? right : new Uint8Array(right || []);
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    mismatch |= (a[index % (a.length || 1)] || 0) ^ (b[index % (b.length || 1)] || 0);
  }
  return mismatch === 0;
}

function memberView(row) {
  return {
    membershipId: row.membership_id, userId: row.user_id, email: row.email,
    displayName: row.display_name, avatarUrl: row.avatar_url, role: row.role,
    status: row.status, createdAt: row.created_at,
    allowedChannelIds: parseAllowedChannelIds(row.allowed_channel_ids_json)
  };
}

function invitationView(row) {
  return {
    invitationId: row.invitation_id, email: row.email, role: row.role,
    status: row.status, expiresAt: row.expires_at, createdAt: row.created_at,
    allowedChannelIds: parseAllowedChannelIds(row.allowed_channel_ids_json)
  };
}

export function validateReturnTo(value, env) {
  const configuredOrigins = String(env.ALLOWED_ORIGINS || '').split(',').map(item => item.trim()).filter(Boolean);
  if (env.APP_ORIGIN) configuredOrigins.push(new URL(env.APP_ORIGIN).origin);
  const base = env.APP_ORIGIN || configuredOrigins[0];
  if (!base) throw authError(503, 'APP_ORIGIN or ALLOWED_ORIGINS must be configured.');
  const raw = String(value || '/');
  if (raw.length > 2048) throw authError(400, 'Return URL is too long.');
  let target;
  try { target = raw.startsWith('/') ? new URL(raw, base) : new URL(raw); }
  catch { throw authError(400, 'Invalid return URL.'); }
  if (!configuredOrigins.includes(target.origin)) throw authError(400, 'Return URL origin is not allowed.');
  if (!['http:', 'https:'].includes(target.protocol)) throw authError(400, 'Return URL protocol is not allowed.');
  return target.toString();
}

function googleRedirectUri(request, env) {
  return env.GOOGLE_REDIRECT_URI || new URL('/auth/google/callback', request.url).toString();
}

function requireOAuthConfig(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw authError(503, 'Google OAuth is not configured.');
}

function oauthFailureView(error) {
  const status = Number(error?.status) || 500;
  if (status === 400) {
    return {
      status,
      code: 'invalid_or_expired_sign_in',
      message: 'This sign-in link is invalid or expired. Please start Google sign-in again.'
    };
  }
  if (status === 401) {
    return {
      status,
      code: 'google_sign_in_failed',
      message: error?.message === 'Google sign-in was cancelled or denied.'
        ? 'Google sign-in was cancelled or denied.'
        : 'Google sign-in could not be completed. Please try again.'
    };
  }
  if (status === 403) {
    return {
      status,
      code: 'workspace_access_denied',
      message: 'This Google account does not have access to this workspace. Ask the workspace owner to invite it.'
    };
  }
  if (status === 409) {
    return {
      status,
      code: 'google_account_conflict',
      message: 'This email is already linked to another Google account. Contact the workspace owner.'
    };
  }
  return {
    status,
    code: 'google_sign_in_unavailable',
    message: 'Google sign-in is temporarily unavailable. Please try again.'
  };
}

function oauthFailureTarget(env) {
  const candidates = [env.APP_ORIGIN, ...String(env.ALLOWED_ORIGINS || '').split(',')]
    .map(value => String(value || '').trim()).filter(Boolean);
  for (const candidate of candidates) {
    try {
      const target = new URL(candidate);
      if (target.protocol === 'https:' || target.protocol === 'http:') return target;
    } catch { /* Try the next configured app origin. */ }
  }
  return null;
}

function oauthFailurePage(failure, expiredCookie) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Helixcer sign-in</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f5f1;color:#172321;font:16px/1.5 system-ui,sans-serif}.card{width:min(520px,calc(100% - 40px));box-sizing:border-box;padding:36px;border:1px solid #d9dfdb;border-radius:24px;background:#fff;box-shadow:0 20px 55px #17232118}.mark{display:grid;place-items:center;width:52px;height:52px;border-radius:15px;background:linear-gradient(145deg,#263cff,#aa00d6 58%,#ee006a);color:#fff;font-size:28px;font-weight:800}h1{margin:22px 0 10px;font-size:30px;line-height:1.15}p{margin:0;color:#596561}</style></head><body><main class="card"><div class="mark">H</div><h1>Sign-in could not be completed</h1><p>${escapeHtml(failure.message)}</p></main></body></html>`;
  return new Response(html, {
    status: failure.status >= 500 ? 503 : failure.status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Set-Cookie': expiredCookie
    }
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function cookieHeader(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function clearCookieHeader(name) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return ''; }
    }
  }
  return '';
}

function sessionCredential(request) {
  const cookie = readCookie(request, SESSION_COOKIE);
  if (cookie) return { token: cookie, source: 'cookie' };
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return { token: '', source: '' };
  const token = authorization.slice(7).trim();
  return token ? { token, source: 'bearer' } : { token: '', source: '' };
}

function cleanDeviceName(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function cleanMobileDeviceId(value) {
  const deviceId = String(value || '').trim();
  if (!MOBILE_DEVICE_ID_PATTERN.test(deviceId)) throw authError(400, 'A valid mobile device ID is required.');
  return deviceId;
}

function googleAuthorizedParties(env) {
  return [env.GOOGLE_CLIENT_ID, ...String(env.GOOGLE_ANDROID_CLIENT_IDS || '')
    .split(',').map(value => value.trim()).filter(Boolean)];
}

export async function hashToken(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

function randomToken(bytes) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64UrlEncode(value);
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function parseCacheMaxAge(value) {
  const match = String(value || '').match(/(?:^|,)\s*max-age=(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function clampNumber(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function authError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function timingSafeEqual(left, right) {
  const a = encoder.encode(String(left));
  const b = encoder.encode(String(right));
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) mismatch |= (a[index % (a.length || 1)] || 0) ^ (b[index % (b.length || 1)] || 0);
  return mismatch === 0;
}
