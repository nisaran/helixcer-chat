export const SESSION_COOKIE = '__Host-helixcer_session';
export const OAUTH_COOKIE = '__Host-helixcer_oauth';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const jwksCache = new Map();

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
  const rawToken = readCookie(request, SESSION_COOKIE);
  if (!rawToken) return null;
  const row = await env.DB.prepare(`SELECT s.session_id,s.expires_at,u.user_id,u.email,u.display_name,u.avatar_url,
      m.membership_id,m.role,m.status,w.workspace_id,w.name AS workspace_name,w.slug AS workspace_slug
    FROM sessions s JOIN users u ON u.user_id=s.user_id
      JOIN memberships m ON m.user_id=s.user_id AND m.workspace_id=s.workspace_id
      JOIN workspaces w ON w.workspace_id=s.workspace_id
    WHERE s.token_hash=?1 AND s.revoked_at IS NULL AND s.expires_at>?2 AND m.status='active'`)
    .bind(await hashToken(rawToken), new Date().toISOString()).first();
  if (!row) return null;
  return principalFromRow(row);
}

export async function logout(request, env) {
  const token = readCookie(request, SESSION_COOKIE);
  const principal = token ? await authenticateRequest(request, env) : null;
  if (token) {
    await env.DB.prepare('UPDATE sessions SET revoked_at=?2 WHERE token_hash=?1 AND revoked_at IS NULL')
      .bind(await hashToken(token), new Date().toISOString()).run();
  }
  if (principal) await auditAuthAction(env, principal, 'logout', 'session', principal.sessionId || '', {});
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': clearCookieHeader(SESSION_COOKIE) }
  });
}

async function provisionVerifiedIdentity(env, identity, invitationTokenHash) {
  const now = new Date().toISOString();
  const email = normalizeEmail(identity.email);
  const workspaceId = (await resolveDefaultWorkspace(env)).workspace_id;
  let user = await env.DB.prepare('SELECT * FROM users WHERE google_sub=?1').bind(identity.sub).first();
  const emailOwner = await env.DB.prepare('SELECT user_id,google_sub FROM users WHERE lower(email)=?1').bind(email).first();
  if (emailOwner && emailOwner.google_sub !== identity.sub) throw authError(409, 'This email is already linked to another Google identity.');

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
    await env.DB.prepare(`UPDATE users SET email=?2,display_name=?3,avatar_url=?4,email_verified=1,last_login_at=?5,updated_at=?5
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
          (membership_id,workspace_id,user_id,role,status,invited_by_user_id,created_at,updated_at)
        SELECT ?1,i.workspace_id,?2,i.role,'active',i.invited_by_user_id,?3,?3
        FROM invitations i
        WHERE i.invitation_id=?4 AND i.token_hash=?5 AND lower(i.email)=?6
          AND i.status='pending' AND i.expires_at>?3
        ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role,status='active',
          invited_by_user_id=excluded.invited_by_user_id,updated_at=excluded.updated_at`)
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

  const row = await env.DB.prepare(`SELECT u.user_id,u.email,u.display_name,u.avatar_url,m.membership_id,m.role,m.status,
      w.workspace_id,w.name AS workspace_name,w.slug AS workspace_slug
    FROM users u JOIN memberships m ON m.user_id=u.user_id JOIN workspaces w ON w.workspace_id=m.workspace_id
    WHERE u.user_id=?1 AND m.status='active' AND (?2='' OR m.workspace_id=?2)
    ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END LIMIT 1`)
    .bind(user.user_id, selectedWorkspaceId).first();
  if (!row) {
    if (createdUser) {
      await env.DB.prepare('DELETE FROM users WHERE user_id=?1 AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id=?1)')
        .bind(user.user_id).run();
    }
    throw authError(403, 'Your account has not been invited to this workspace.');
  }
  return principalFromRow(row);
}

async function createSession(env, principal) {
  const token = randomToken(32);
  const maxAge = clampNumber(env.SESSION_TTL_SECONDS, 900, 2592000, 604800);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + maxAge * 1000).toISOString();
  const sessionId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO sessions
      (session_id,token_hash,user_id,workspace_id,expires_at,last_seen_at,created_at)
    VALUES (?1,?2,?3,?4,?5,?6,?6)`)
    .bind(sessionId, await hashToken(token), principal.user.userId, principal.workspace.workspaceId, expiresAt, now.toISOString()).run();
  return { token, maxAge, sessionId };
}

export async function listTeam(env, principal) {
  requireRole(principal, 'admin');
  const [members, invitations] = await Promise.all([
    env.DB.prepare(`SELECT m.membership_id,m.user_id,m.role,m.status,m.created_at,u.email,u.display_name,u.avatar_url
      FROM memberships m JOIN users u ON u.user_id=m.user_id
      WHERE m.workspace_id=?1 ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END,u.display_name`)
      .bind(principal.workspace.workspaceId).all(),
    env.DB.prepare(`SELECT invitation_id,email,role,status,expires_at,created_at FROM invitations
      WHERE workspace_id=?1 AND status='pending' ORDER BY created_at DESC`).bind(principal.workspace.workspaceId).all()
  ]);
  return {
    members: members.results.map(memberView),
    invitations: invitations.results.map(invitationView)
  };
}

export async function createInvitation(request, env, principal, payload) {
  requireRole(principal, 'admin');
  const email = normalizeEmail(payload.email);
  if (!email || !email.includes('@') || email.length > 254) throw authError(400, 'A valid email is required.');
  const role = String(payload.role || 'agent');
  if (!['admin', 'agent'].includes(role)) throw authError(400, 'Invitation role must be admin or agent.');
  if (principal.membership.role === 'admin' && role !== 'agent') throw authError(403, 'Only an owner can invite an administrator.');
  const existing = await env.DB.prepare(`SELECT m.membership_id FROM memberships m JOIN users u ON u.user_id=m.user_id
    WHERE m.workspace_id=?1 AND lower(u.email)=?2 AND m.status='active'`).bind(principal.workspace.workspaceId, email).first();
  if (existing) throw authError(409, 'This user is already a workspace member.');
  const token = randomToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const invitationId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`UPDATE invitations SET status='cancelled',updated_at=?3
      WHERE workspace_id=?1 AND lower(email)=?2 AND status='pending'`).bind(principal.workspace.workspaceId, email, now.toISOString()),
    env.DB.prepare(`INSERT INTO invitations
        (invitation_id,workspace_id,email,role,token_hash,status,invited_by_user_id,expires_at,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,'pending',?6,?7,?8,?8)`)
      .bind(invitationId, principal.workspace.workspaceId, email, role, await hashToken(token), principal.user.userId || null, expiresAt, now.toISOString())
  ]);
  await auditAuthAction(env, principal, 'invite', 'invitation', invitationId, { email, role });
  const loginUrl = new URL('/auth/google/start', request.url);
  loginUrl.searchParams.set('return_to', validateReturnTo(payload.returnTo || payload.return_to || '/', env));
  loginUrl.searchParams.set('invite', token);
  return {
    ok: true,
    invitation: { invitationId, email, role, status: 'pending', expiresAt, createdAt: now.toISOString() },
    inviteUrl: loginUrl.toString()
  };
}

export async function updateMembership(env, principal, membershipId, payload) {
  requireRole(principal, 'admin');
  const target = await env.DB.prepare(`SELECT m.membership_id,m.user_id,m.role,m.status,m.created_at,u.email,u.display_name,u.avatar_url
    FROM memberships m JOIN users u ON u.user_id=m.user_id WHERE m.membership_id=?1 AND m.workspace_id=?2`)
    .bind(membershipId, principal.workspace.workspaceId).first();
  if (!target) throw authError(404, 'Team member not found.');
  const nextRole = payload.role === undefined ? target.role : String(payload.role);
  const nextStatus = payload.status === undefined ? target.status : String(payload.status);
  if (!['owner', 'admin', 'agent'].includes(nextRole)) throw authError(400, 'Invalid member role.');
  if (!['active', 'disabled'].includes(nextStatus)) throw authError(400, 'Invalid member status.');
  if (principal.membership.role === 'admin') {
    if (target.role !== 'agent' || nextRole !== 'agent') throw authError(403, 'Administrators can only enable or disable agents.');
  }
  const removesOwner = target.role === 'owner' && (nextRole !== 'owner' || nextStatus !== 'active');
  if (removesOwner) {
    const owners = await env.DB.prepare(`SELECT count(*) AS count FROM memberships
      WHERE workspace_id=?1 AND role='owner' AND status='active'`).bind(principal.workspace.workspaceId).first();
    if (Number(owners?.count || 0) <= 1) throw authError(409, 'The workspace must retain at least one active owner.');
  }
  const now = new Date().toISOString();
  const changed = await env.DB.prepare(`UPDATE memberships SET role=?3,status=?4,updated_at=?5
    WHERE membership_id=?1 AND workspace_id=?2 AND (
      role!='owner' OR (?3='owner' AND ?4='active') OR
      (SELECT count(*) FROM memberships WHERE workspace_id=?2 AND role='owner' AND status='active')>1
    )`).bind(membershipId, principal.workspace.workspaceId, nextRole, nextStatus, now).run();
  if (!changed.meta?.changes) throw authError(409, 'The workspace must retain at least one active owner.');
  if (nextStatus === 'disabled') {
    await env.DB.prepare('UPDATE sessions SET revoked_at=?3 WHERE user_id=?1 AND workspace_id=?2 AND revoked_at IS NULL')
      .bind(target.user_id, principal.workspace.workspaceId, now).run();
  }
  await auditAuthAction(env, principal, 'update', 'membership', membershipId, {
    targetEmail: target.email, previousRole: target.role, role: nextRole,
    previousStatus: target.status, status: nextStatus
  });
  const updated = { ...target, role: nextRole, status: nextStatus };
  return { ok: true, item: memberView(updated) };
}

export async function updateInvitation(env, principal, invitationId, payload) {
  requireRole(principal, 'admin');
  if (payload.status !== 'cancelled') throw authError(400, 'Only cancellation is supported for pending invitations.');
  const invitation = await env.DB.prepare(`SELECT invitation_id,role,status FROM invitations
    WHERE invitation_id=?1 AND workspace_id=?2`).bind(invitationId, principal.workspace.workspaceId).first();
  if (!invitation || invitation.status !== 'pending') throw authError(404, 'Pending invitation not found.');
  if (principal.membership.role === 'admin' && invitation.role !== 'agent') throw authError(403, 'Only an owner can cancel an administrator invitation.');
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

export function principalView(principal) {
  return {
    authenticated: true,
    user: principal.user,
    workspace: principal.workspace,
    membership: principal.membership
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
  if (payload.azp && payload.azp !== options.clientId) throw authError(401, 'Google ID token authorized-party mismatch.');
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

async function auditAuthAction(env, principal, action, targetType, targetId, details) {
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
    user: { userId: '', email: 'emergency-recovery', displayName: 'Emergency recovery', avatarUrl: '' },
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
    workspace = await env.DB.prepare("SELECT workspace_id,name,slug FROM workspaces WHERE slug='default' LIMIT 1").first();
  }
  if (!workspace) {
    const result = await env.DB.prepare('SELECT workspace_id,name,slug FROM workspaces ORDER BY created_at,workspace_id LIMIT 2').all();
    if ((result.results || []).length === 1) workspace = result.results[0];
  }
  if (!workspace) throw authError(503, 'The workspace is not configured.');
  return workspace;
}

function principalFromRow(row) {
  return {
    authType: 'session', sessionId: row.session_id || '', sessionExpiresAt: row.expires_at || '',
    user: { userId: row.user_id, email: row.email, displayName: row.display_name, avatarUrl: row.avatar_url },
    workspace: { workspaceId: row.workspace_id, name: row.workspace_name, slug: row.workspace_slug },
    membership: { membershipId: row.membership_id, role: row.role, status: row.status }
  };
}

function memberView(row) {
  return {
    membershipId: row.membership_id, userId: row.user_id, email: row.email,
    displayName: row.display_name, avatarUrl: row.avatar_url, role: row.role,
    status: row.status, createdAt: row.created_at
  };
}

function invitationView(row) {
  return {
    invitationId: row.invitation_id, email: row.email, role: row.role,
    status: row.status, expiresAt: row.expires_at, createdAt: row.created_at
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

function normalizeEmail(value) {
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
