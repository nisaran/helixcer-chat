import { auditAuthAction, hashPasswordRecord, normalizeAuthEmail } from './auth.js';

const RESERVED_SLUGS = new Set(['default', 'admin', 'api', 'www', 'app', 'helixcer', 'chat']);

export async function assertPlatformAdmin(env, principal) {
  const email = normalizeAuthEmail(principal?.user?.email);
  if (!email) throw platformError(403, 'Platform administrator access is required.');
  const bootstrap = normalizeAuthEmail(env.BOOTSTRAP_OWNER_EMAIL);
  if (bootstrap && email === bootstrap) return;
  const row = await env.DB.prepare(`SELECT admin_id FROM platform_admins
    WHERE lower(email)=?1 AND status='active'`).bind(email).first();
  if (!row) throw platformError(403, 'Platform administrator access is required.');
}

export async function platformProfile(env, principal) {
  await assertPlatformAdmin(env, principal);
  return {
    ok: true,
    role: 'platform_admin',
    user: {
      email: principal.user.email,
      displayName: principal.user.displayName || principal.user.email
    },
    clientSignInUrl: 'https://chat.helixcer.com'
  };
}

export async function listClientWorkspaces(env) {
  const result = await env.DB.prepare(`SELECT w.workspace_id,w.slug,w.name,w.registered_name,w.status,w.kind,w.created_at,
      (
        SELECT u.email FROM memberships m JOIN users u ON u.user_id=m.user_id
        WHERE m.workspace_id=w.workspace_id AND m.role='owner'
        ORDER BY m.created_at LIMIT 1
      ) AS owner_email,
      (
        SELECT u.display_name FROM memberships m JOIN users u ON u.user_id=m.user_id
        WHERE m.workspace_id=w.workspace_id AND m.role='owner'
        ORDER BY m.created_at LIMIT 1
      ) AS owner_name
    FROM workspaces w
    WHERE w.kind='client'
    ORDER BY w.created_at DESC`).all();
  return { items: (result.results || []).map(clientView) };
}

export async function createClientWorkspace(env, principal, payload) {
  const name = cleanLabel(payload?.companyName || payload?.name, 'Company name', 120);
  const ownerName = cleanLabel(payload?.ownerName || payload?.owner_name, 'Owner name', 160);
  const email = normalizeAuthEmail(payload?.ownerEmail || payload?.email);
  if (!email || !email.includes('@') || email.length > 254) throw platformError(400, 'A valid owner email is required.');
  const now = new Date().toISOString();
  const existing = await env.DB.prepare('SELECT user_id FROM users WHERE lower(email)=?1').bind(email).first();
  if (existing) throw platformError(409, 'That email is already used by another Helixcer account.');
  const passwordRecord = await hashPasswordRecord(payload?.password);
  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  const slug = await uniqueSlug(env, payload?.slug || name);
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO workspaces
          (workspace_id,slug,name,registered_name,status,kind,created_at,updated_at)
        VALUES (?1,?2,?3,?3,'active','client',?4,?4)`)
        .bind(workspaceId, slug, name, now),
      env.DB.prepare(`INSERT INTO users
          (user_id,google_sub,email,display_name,avatar_url,email_verified,last_login_at,created_at,updated_at)
        VALUES (?1,?2,?3,?4,'',1,?5,?5,?5)`)
        .bind(userId, `local:${userId}`, email, ownerName, now),
      env.DB.prepare(`INSERT INTO memberships
          (membership_id,workspace_id,user_id,role,status,created_at,updated_at)
        VALUES (?1,?2,?3,'owner','active',?4,?4)`)
        .bind(membershipId, workspaceId, userId, now),
      env.DB.prepare(`INSERT INTO user_passwords
          (user_id,password_hash,salt,iterations,updated_at)
        VALUES (?1,?2,?3,?4,?5)`)
        .bind(userId, passwordRecord.password_hash, passwordRecord.salt, passwordRecord.iterations, now)
    ]);
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) {
      throw platformError(409, 'A client with that email or address already exists.');
    }
    throw error;
  }
  await auditAuthAction(env, principal, 'create', 'client_workspace', workspaceId, { name, email, slug });
  const item = clientView({
    workspace_id: workspaceId, slug, name, registered_name: name, status: 'active', kind: 'client',
    created_at: now, owner_email: email, owner_name: ownerName
  });
  return { ok: true, item };
}

export async function updateClientWorkspace(env, principal, workspaceId, payload) {
  const current = await env.DB.prepare(`SELECT workspace_id,slug,name,registered_name,status,kind,created_at
    FROM workspaces WHERE workspace_id=?1 AND kind='client'`).bind(workspaceId).first();
  if (!current) throw platformError(404, 'Client not found.');
  const name = payload?.companyName === undefined && payload?.name === undefined
    ? current.name
    : cleanLabel(payload.companyName || payload.name, 'Company name', 120);
  const status = payload?.status === undefined ? current.status : String(payload.status);
  if (!['active', 'suspended'].includes(status)) throw platformError(400, 'Client status must be active or suspended.');
  const now = new Date().toISOString();
  const owner = await env.DB.prepare(`SELECT u.user_id,u.email,u.display_name
    FROM memberships m JOIN users u ON u.user_id=m.user_id
    WHERE m.workspace_id=?1 AND m.role='owner'
    ORDER BY m.created_at LIMIT 1`).bind(workspaceId).first();
  if (!owner) throw platformError(409, 'This client has no owner account.');
  const ownerName = payload?.ownerName === undefined && payload?.owner_name === undefined
    ? owner.display_name
    : cleanLabel(payload.ownerName || payload.owner_name, 'Owner name', 160);
  const password = payload?.password === undefined || payload?.password === ''
    ? ''
    : String(payload.password);
  const statements = [
    env.DB.prepare(`UPDATE workspaces SET name=?2,registered_name=?2,status=?3,updated_at=?4
      WHERE workspace_id=?1 AND kind='client'`).bind(workspaceId, name, status, now),
    env.DB.prepare('UPDATE users SET display_name=?2,updated_at=?3 WHERE user_id=?1')
      .bind(owner.user_id, ownerName, now)
  ];
  if (password) {
    const record = await hashPasswordRecord(password);
    statements.push(
      env.DB.prepare(`INSERT INTO user_passwords (user_id,password_hash,salt,iterations,updated_at)
        VALUES (?1,?2,?3,?4,?5)
        ON CONFLICT(user_id) DO UPDATE SET password_hash=excluded.password_hash,salt=excluded.salt,
          iterations=excluded.iterations,updated_at=excluded.updated_at`)
        .bind(owner.user_id, record.password_hash, record.salt, record.iterations, now),
      env.DB.prepare(`UPDATE sessions SET revoked_at=?2
        WHERE user_id=?1 AND workspace_id=?3 AND revoked_at IS NULL`)
        .bind(owner.user_id, now, workspaceId)
    );
  }
  if (status === 'suspended') {
    statements.push(env.DB.prepare(`UPDATE sessions SET revoked_at=?2
      WHERE workspace_id=?1 AND revoked_at IS NULL`).bind(workspaceId, now));
  }
  await env.DB.batch(statements);
  await auditAuthAction(env, principal, 'update', 'client_workspace', workspaceId, {
    name, status, passwordReset: Boolean(password)
  });
  return {
    ok: true,
    suspended: status === 'suspended',
    item: clientView({
      ...current, name, registered_name: name, status, owner_email: owner.email, owner_name: ownerName
    })
  };
}

function clientView(row) {
  return {
    workspaceId: row.workspace_id,
    slug: row.slug,
    name: row.name,
    registeredName: row.registered_name || row.name,
    status: row.status || 'active',
    kind: row.kind || 'client',
    createdAt: row.created_at,
    owner: {
      email: row.owner_email || '',
      displayName: row.owner_name || ''
    }
  };
}

async function uniqueSlug(env, value) {
  const base = slugify(value);
  if (RESERVED_SLUGS.has(base)) return uniqueSlug(env, `${base}-client`);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await env.DB.prepare('SELECT 1 FROM workspaces WHERE slug=?1').bind(candidate).first();
    if (!taken && !RESERVED_SLUGS.has(candidate)) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

function slugify(value) {
  const slug = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return slug || 'client';
}

function cleanLabel(value, label, max) {
  const text = String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length < 2 || text.length > max) throw platformError(400, `${label} must be 2 to ${max} characters.`);
  return text;
}

function platformError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
