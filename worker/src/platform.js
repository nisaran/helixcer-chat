import { auditAuthAction, hashToken, normalizeEmail } from './auth.js';

const RESERVED_SLUGS = new Set(['default', 'admin', 'api', 'www', 'app', 'helixcer', 'chat', 'mail', 'support', 'billing']);
const CLIENT_KIND = 'client';
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const CLIENT_SELECT = `SELECT w.workspace_id,w.slug,w.name,w.status,w.kind,w.notes,w.created_at,w.updated_at,
    w.registered_name,w.address_line1,w.address_line2,w.city,w.state,w.postal_code,w.country,w.gstin,w.tax_details,
    COALESCE(
      (SELECT u.email FROM memberships m JOIN users u ON u.user_id=m.user_id
        WHERE m.workspace_id=w.workspace_id AND m.role='owner' ORDER BY m.created_at LIMIT 1),
      (SELECT i.email FROM invitations i WHERE i.workspace_id=w.workspace_id
        AND i.role='owner' AND i.status='pending' ORDER BY i.created_at DESC LIMIT 1)
    ) AS owner_email,
    (SELECT u.display_name FROM memberships m JOIN users u ON u.user_id=m.user_id
      WHERE m.workspace_id=w.workspace_id AND m.role='owner' ORDER BY m.created_at LIMIT 1) AS owner_name,
    (SELECT count(*) FROM memberships m WHERE m.workspace_id=w.workspace_id AND m.status='active') AS member_count,
    (SELECT count(*) FROM channels c WHERE c.workspace_id=w.workspace_id) AS channel_count,
    (SELECT count(*) FROM conversations c WHERE c.workspace_id=w.workspace_id) AS conversation_count,
    (SELECT count(*) FROM contacts c WHERE c.workspace_id=w.workspace_id) AS contact_count,
    (SELECT max(c.last_message_at) FROM conversations c WHERE c.workspace_id=w.workspace_id) AS last_activity
  FROM workspaces w`;

export async function assertPlatformAdmin(env, principal) {
  const email = normalizeEmail(principal?.user?.email);
  if (!email) throw platformError(403, 'Platform administrator access is required.');
  const bootstrap = normalizeEmail(env.BOOTSTRAP_OWNER_EMAIL || '');
  if (bootstrap && email === bootstrap) return;
  const row = await env.DB.prepare(`SELECT admin_id FROM platform_admins
    WHERE lower(email)=?1 AND status='active'`).bind(email).first();
  if (!row) throw platformError(403, 'Platform administrator access is required.');
}

export async function platformProfile(env, principal) {
  const email = normalizeEmail(principal.user.email);
  const bootstrap = normalizeEmail(env.BOOTSTRAP_OWNER_EMAIL || '');
  return {
    ok: true,
    role: 'platform_admin',
    isBootstrap: Boolean(bootstrap) && email === bootstrap,
    user: { email: principal.user.email, displayName: principal.user.displayName || principal.user.email },
    clientSignInUrl: env.APP_ORIGIN || 'https://chat.helixcer.com'
  };
}

export async function platformOverview(env) {
  const counts = await env.DB.prepare(`SELECT
      (SELECT count(*) FROM workspaces WHERE kind='client') AS clients,
      (SELECT count(*) FROM workspaces WHERE kind='client' AND status='active') AS active_clients,
      (SELECT count(*) FROM workspaces WHERE kind='client' AND status='suspended') AS suspended_clients,
      (SELECT count(*) FROM memberships m JOIN workspaces w ON w.workspace_id=m.workspace_id
        WHERE w.kind='client' AND m.status='active') AS members,
      (SELECT count(*) FROM channels c JOIN workspaces w ON w.workspace_id=c.workspace_id
        WHERE w.kind='client') AS channels,
      (SELECT count(*) FROM conversations c JOIN workspaces w ON w.workspace_id=c.workspace_id
        WHERE w.kind='client') AS conversations,
      (SELECT count(*) FROM workspaces WHERE kind='client' AND created_at>=?1) AS new_clients`).bind(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()).first();
  const recent = await env.DB.prepare(`${CLIENT_SELECT} WHERE w.kind='client'
    ORDER BY w.created_at DESC LIMIT 5`).all();
  return {
    ok: true,
    stats: {
      clients: Number(counts?.clients || 0),
      activeClients: Number(counts?.active_clients || 0),
      suspendedClients: Number(counts?.suspended_clients || 0),
      members: Number(counts?.members || 0),
      channels: Number(counts?.channels || 0),
      conversations: Number(counts?.conversations || 0),
      newClients: Number(counts?.new_clients || 0)
    },
    recent: (recent.results || []).map(clientView)
  };
}

export async function listClientWorkspaces(env, url) {
  const conditions = [`w.kind='client'`];
  const params = [];
  const status = String(url.searchParams.get('status') || '');
  if (status === 'active' || status === 'suspended') {
    params.push(status);
    conditions.push(`w.status=?${params.length}`);
  }
  const query = String(url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 120);
  if (query) {
    params.push(`%${query}%`);
    const placeholder = `?${params.length}`;
    conditions.push(`(lower(w.name) LIKE ${placeholder} OR lower(w.slug) LIKE ${placeholder}
      OR EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.user_id=m.user_id
        WHERE m.workspace_id=w.workspace_id AND lower(u.email) LIKE ${placeholder}))`);
  }
  const statement = env.DB.prepare(`${CLIENT_SELECT} WHERE ${conditions.join(' AND ')}
    ORDER BY w.created_at DESC LIMIT 200`);
  const result = await (params.length ? statement.bind(...params) : statement).all();
  return { ok: true, items: (result.results || []).map(clientView) };
}

export async function getClientWorkspace(env, workspaceId) {
  const row = await env.DB.prepare(`${CLIENT_SELECT} WHERE w.workspace_id=?1 AND w.kind='client'`)
    .bind(workspaceId).first();
  if (!row) throw platformError(404, 'Client workspace not found.');
  const [members, invitations, messageCount] = await Promise.all([
    env.DB.prepare(`SELECT m.membership_id,m.user_id,m.role,m.status,m.created_at,u.email,u.display_name
      FROM memberships m JOIN users u ON u.user_id=m.user_id
      WHERE m.workspace_id=?1
      ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END,m.created_at`)
      .bind(workspaceId).all(),
    env.DB.prepare(`SELECT invitation_id,email,role,status,expires_at,created_at FROM invitations
      WHERE workspace_id=?1 AND status='pending' ORDER BY created_at DESC`).bind(workspaceId).all(),
    env.DB.prepare('SELECT count(*) AS count FROM messages WHERE workspace_id=?1').bind(workspaceId).first()
  ]);
  return {
    ok: true,
    item: clientView(row),
    members: (members.results || []).map(memberView),
    invitations: (invitations.results || []).map(invitationView),
    messageCount: Number(messageCount?.count || 0)
  };
}

export async function createClientWorkspace(env, principal, request, payload) {
  const name = cleanText(payload?.companyName ?? payload?.name, 'Company name', 2, 120);
  const email = normalizeEmail(payload?.ownerEmail ?? payload?.email);
  if (!email || !email.includes('@') || email.length > 254) throw platformError(400, 'A valid owner email is required.');
  const ownerName = optionalText(payload?.ownerName ?? payload?.owner_name, 'Owner name', 160);
  const notes = optionalText(payload?.notes, 'Notes', 2000);
  const now = new Date().toISOString();
  const workspaceId = crypto.randomUUID();
  const slug = await uniqueSlug(env, payload?.slug || name);
  const owner = await env.DB.prepare('SELECT user_id,email,display_name FROM users WHERE lower(email)=?1').bind(email).first();
  const token = randomToken();
  const invitationId = crypto.randomUUID();
  const statements = [
    env.DB.prepare(`INSERT INTO workspaces
        (workspace_id,slug,name,registered_name,status,kind,notes,created_at,updated_at)
      VALUES (?1,?2,?3,?3,'active','client',?4,?5,?5)`)
      .bind(workspaceId, slug, name, notes, now)
  ];
  if (owner) {
    statements.push(env.DB.prepare(`INSERT INTO memberships
        (membership_id,workspace_id,user_id,role,status,invited_by_user_id,created_at,updated_at)
      VALUES (?1,?2,?3,'owner','active',?4,?5,?5)`)
      .bind(crypto.randomUUID(), workspaceId, owner.user_id, principal.user.userId || null, now));
  }
  statements.push(env.DB.prepare(`INSERT INTO invitations
      (invitation_id,workspace_id,email,role,token_hash,status,invited_by_user_id,expires_at,created_at,updated_at)
    VALUES (?1,?2,?3,'owner',?4,'pending',?5,?6,?7,?7)`)
    .bind(invitationId, workspaceId, email, await hashToken(token), principal.user.userId || null,
      new Date(Date.now() + INVITATION_TTL_MS).toISOString(), now));
  const inviteUrl = inviteLink(request, env, token);
  await env.DB.batch(statements);
  await auditAuthAction(env, principal, 'create', 'client_workspace', workspaceId, { name, slug, ownerEmail: email });
  return {
    ok: true,
    item: clientView({
      workspace_id: workspaceId, slug, name, registered_name: name, status: 'active', kind: 'client',
      notes, created_at: now, updated_at: now, owner_email: owner?.email || email,
      owner_name: owner?.display_name || ownerName, member_count: owner ? 1 : 0
    }),
    inviteUrl
  };
}

export async function updateClientWorkspace(env, principal, workspaceId, payload) {
  const allowed = ['name', 'companyName', 'status', 'notes', 'registeredName', 'addressLine1', 'addressLine2',
    'city', 'state', 'postalCode', 'country', 'gstin', 'taxDetails'];
  rejectUnknown(payload, allowed);
  const current = await env.DB.prepare(`${CLIENT_SELECT} WHERE w.workspace_id=?1 AND w.kind='client'`)
    .bind(workspaceId).first();
  if (!current) throw platformError(404, 'Client workspace not found.');

  const name = payload.name === undefined && payload.companyName === undefined
    ? current.name
    : cleanText(payload.companyName ?? payload.name, 'Company name', 2, 120);
  const status = payload.status === undefined ? current.status : String(payload.status);
  if (!['active', 'suspended'].includes(status)) throw platformError(400, 'Status must be active or suspended.');
  const notes = payload.notes === undefined ? current.notes : optionalText(payload.notes, 'Notes', 2000);
  const profile = {
    registered_name: profileField(payload, 'registeredName', current.registered_name, 200),
    address_line1: profileField(payload, 'addressLine1', current.address_line1, 200),
    address_line2: profileField(payload, 'addressLine2', current.address_line2, 200),
    city: profileField(payload, 'city', current.city, 100),
    state: profileField(payload, 'state', current.state, 100),
    postal_code: profileField(payload, 'postalCode', current.postal_code, 20),
    country: profileField(payload, 'country', current.country, 100),
    gstin: profileField(payload, 'gstin', current.gstin, 40),
    tax_details: profileField(payload, 'taxDetails', current.tax_details, 1000)
  };
  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(`UPDATE workspaces SET name=?2,status=?3,notes=?4,registered_name=?5,
        address_line1=?6,address_line2=?7,city=?8,state=?9,postal_code=?10,country=?11,gstin=?12,
        tax_details=?13,updated_at=?14
      WHERE workspace_id=?1 AND kind='client'`)
      .bind(workspaceId, name, status, notes, profile.registered_name, profile.address_line1,
        profile.address_line2, profile.city, profile.state, profile.postal_code, profile.country,
        profile.gstin, profile.tax_details, now)
  ];
  if (status === 'suspended') {
    statements.push(env.DB.prepare(`UPDATE sessions SET revoked_at=?2
      WHERE workspace_id=?1 AND revoked_at IS NULL`).bind(workspaceId, now));
  }
  await env.DB.batch(statements);
  await auditAuthAction(env, principal, 'update', 'client_workspace', workspaceId, {
    name, status, notes, profileChanged: allowed.some(key => payload[key] !== undefined && !['name', 'companyName', 'status', 'notes'].includes(key))
  });
  const updated = await env.DB.prepare(`${CLIENT_SELECT} WHERE w.workspace_id=?1`).bind(workspaceId).first();
  return { ok: true, suspended: status === 'suspended', item: clientView(updated || current) };
}

export async function deleteClientWorkspace(env, principal, workspaceId, payload) {
  const current = await env.DB.prepare(`SELECT workspace_id,slug,name,kind FROM workspaces
    WHERE workspace_id=?1 AND kind='client'`).bind(workspaceId).first();
  if (!current) throw platformError(404, 'Client workspace not found.');
  if (workspaceId === principal.workspace.workspaceId) {
    throw platformError(409, 'You cannot delete the workspace you are signed in to.');
  }
  const confirmation = String(payload?.confirmSlug || '');
  if (confirmation !== current.slug) {
    throw platformError(400, `Type the workspace slug "${current.slug}" to confirm permanent deletion.`);
  }
  const workspaceTables = [
    'external_api_requests', 'outbound_payloads', 'outbox', 'messages',
    'contact_platform_ids', 'channel_identity_bindings', 'contact_identities',
    'identity_migration_issues', 'conversations', 'channel_identities', 'contacts',
    'channel_credentials', 'channels', 'webhook_events', 'agents', 'api_keys',
    'push_subscriptions', 'mobile_push_devices', 'memberships', 'sessions',
    'invitations', 'audit_log'
  ];
  const statements = workspaceTables.map(table =>
    env.DB.prepare(`DELETE FROM ${table} WHERE workspace_id=?1`).bind(workspaceId));
  statements.push(env.DB.prepare(`DELETE FROM workspaces WHERE workspace_id=?1 AND kind='client'`).bind(workspaceId));
  await env.DB.batch(statements);
  await auditAuthAction(env, principal, 'delete', 'client_workspace', workspaceId, {
    name: current.name, slug: current.slug
  });
  return { ok: true, deleted: true };
}

export async function inviteWorkspaceMember(env, principal, request, workspaceId, payload) {
  const workspace = await env.DB.prepare(`SELECT workspace_id,name FROM workspaces
    WHERE workspace_id=?1 AND kind='client'`).bind(workspaceId).first();
  if (!workspace) throw platformError(404, 'Client workspace not found.');
  const email = normalizeEmail(payload?.email);
  if (!email || !email.includes('@') || email.length > 254) throw platformError(400, 'A valid email is required.');
  const role = String(payload?.role || 'agent');
  if (!['owner', 'admin', 'agent'].includes(role)) throw platformError(400, 'Role must be owner, admin, or agent.');
  const now = new Date().toISOString();
  const user = await env.DB.prepare('SELECT user_id,email FROM users WHERE lower(email)=?1').bind(email).first();
  let member = null;
  if (user) {
    const existing = await env.DB.prepare(`SELECT membership_id,status FROM memberships
      WHERE workspace_id=?1 AND user_id=?2`).bind(workspaceId, user.user_id).first();
    if (existing?.status === 'active') throw platformError(409, 'This person is already a workspace member.');
    if (existing) {
      await env.DB.prepare(`UPDATE memberships SET role=?3,status='active',updated_at=?4
        WHERE workspace_id=?1 AND user_id=?2`).bind(workspaceId, user.user_id, role, now).run();
    } else {
      await env.DB.prepare(`INSERT INTO memberships
          (membership_id,workspace_id,user_id,role,status,invited_by_user_id,created_at,updated_at)
        VALUES (?1,?2,?3,?4,'active',?5,?6,?6)`)
        .bind(crypto.randomUUID(), workspaceId, user.user_id, role, principal.user.userId || null, now).run();
    }
    member = await env.DB.prepare(`SELECT m.membership_id,m.user_id,m.role,m.status,m.created_at,
        u.email,u.display_name FROM memberships m JOIN users u ON u.user_id=m.user_id
      WHERE m.workspace_id=?1 AND m.user_id=?2`).bind(workspaceId, user.user_id).first();
  }
  const token = randomToken();
  const invitationId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS).toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE invitations SET status='cancelled',updated_at=?3
      WHERE workspace_id=?1 AND lower(email)=?2 AND status='pending'`).bind(workspaceId, email, now),
    env.DB.prepare(`INSERT INTO invitations
        (invitation_id,workspace_id,email,role,token_hash,status,invited_by_user_id,expires_at,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,'pending',?6,?7,?8,?8)`)
      .bind(invitationId, workspaceId, email, role, await hashToken(token), principal.user.userId || null, expiresAt, now)
  ]);
  await auditAuthAction(env, principal, 'invite', member ? 'membership' : 'invitation',
    member ? member.membership_id : invitationId, { email, role, workspaceId });
  return {
    ok: true,
    item: member
      ? memberView(member)
      : { invitationId, email, role, status: 'pending', expiresAt, createdAt: now },
    inviteUrl: inviteLink(request, env, token)
  };
}

export async function cancelWorkspaceInvitation(env, principal, workspaceId, invitationId) {
  const invitation = await env.DB.prepare(`SELECT invitation_id,email FROM invitations
    WHERE invitation_id=?1 AND workspace_id=?2 AND status='pending'`).bind(invitationId, workspaceId).first();
  if (!invitation) throw platformError(404, 'Invitation not found.');
  await env.DB.prepare(`UPDATE invitations SET status='cancelled',updated_at=?3
    WHERE invitation_id=?1 AND workspace_id=?2`).bind(invitationId, workspaceId, new Date().toISOString()).run();
  await auditAuthAction(env, principal, 'cancel_invitation', 'invitation', invitationId, {
    email: invitation.email, workspaceId
  });
  return { ok: true };
}

export async function updateWorkspaceMember(env, principal, workspaceId, membershipId, payload) {
  const target = await env.DB.prepare(`SELECT m.membership_id,m.user_id,m.role,m.status,u.email,u.display_name
    FROM memberships m JOIN users u ON u.user_id=m.user_id
    WHERE m.membership_id=?1 AND m.workspace_id=?2`).bind(membershipId, workspaceId).first();
  if (!target) throw platformError(404, 'Workspace member not found.');
  const nextRole = payload.role === undefined ? target.role : String(payload.role);
  const nextStatus = payload.status === undefined ? target.status : String(payload.status);
  if (!['owner', 'admin', 'agent'].includes(nextRole)) throw platformError(400, 'Invalid member role.');
  if (!['active', 'disabled'].includes(nextStatus)) throw platformError(400, 'Invalid member status.');
  const removesOwner = target.role === 'owner' && (nextRole !== 'owner' || nextStatus === 'disabled');
  if (removesOwner) await assertAnotherOwner(env, workspaceId);
  const now = new Date().toISOString();
  const changed = await env.DB.prepare(`UPDATE memberships SET role=?3,status=?4,updated_at=?5
    WHERE membership_id=?1 AND workspace_id=?2 AND (
      role!='owner' OR (?3='owner' AND ?4='active') OR
      (SELECT count(*) FROM memberships WHERE workspace_id=?2 AND role='owner' AND status='active')>1
    )`).bind(membershipId, workspaceId, nextRole, nextStatus, now).run();
  if (!changed.meta?.changes) throw platformError(409, 'The workspace must retain at least one active owner.');
  const statements = [];
  if (nextStatus === 'disabled') {
    statements.push(env.DB.prepare(`UPDATE sessions SET revoked_at=?3
      WHERE user_id=?1 AND workspace_id=?2 AND revoked_at IS NULL`).bind(target.user_id, workspaceId, now));
  }
  if (statements.length) await env.DB.batch(statements);
  await auditAuthAction(env, principal, 'update', 'membership', membershipId, {
    email: target.email, role: nextRole, status: nextStatus, workspaceId
  });
  return {
    ok: true,
    item: memberView({
      membership_id: target.membership_id, user_id: target.user_id, email: target.email,
      display_name: target.display_name, role: nextRole, status: nextStatus
    })
  };
}

export async function removeWorkspaceMember(env, principal, workspaceId, membershipId) {
  const target = await env.DB.prepare(`SELECT m.membership_id,m.user_id,m.role,m.status,u.email
    FROM memberships m JOIN users u ON u.user_id=m.user_id
    WHERE m.membership_id=?1 AND m.workspace_id=?2`).bind(membershipId, workspaceId).first();
  if (!target) throw platformError(404, 'Workspace member not found.');
  if (target.role === 'owner' && target.status === 'active') await assertAnotherOwner(env, workspaceId);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM memberships WHERE membership_id=?1 AND workspace_id=?2').bind(membershipId, workspaceId),
    env.DB.prepare(`UPDATE sessions SET revoked_at=?3
      WHERE user_id=?1 AND workspace_id=?2 AND revoked_at IS NULL`).bind(target.user_id, workspaceId, now)
  ]);
  await auditAuthAction(env, principal, 'remove', 'membership', membershipId, {
    email: target.email, role: target.role, workspaceId
  });
  return { ok: true };
}

export async function listPlatformAdmins(env, principal) {
  const bootstrap = normalizeEmail(env.BOOTSTRAP_OWNER_EMAIL || '');
  const result = await env.DB.prepare(`SELECT p.admin_id,p.email,p.display_name,p.status,p.created_at,
      u.user_id
    FROM platform_admins p LEFT JOIN users u ON lower(u.email)=lower(p.email)
    ORDER BY p.created_at`).all();
  const items = (result.results || []).map(row => ({
    adminId: row.admin_id,
    email: row.email,
    displayName: row.display_name || row.email,
    status: row.status,
    createdAt: row.created_at,
    isBootstrap: false,
    hasAccount: Boolean(row.user_id)
  }));
  if (bootstrap) {
    items.unshift({
      adminId: 'bootstrap',
      email: bootstrap,
      displayName: 'Bootstrap owner',
      status: 'active',
      createdAt: '',
      isBootstrap: true,
      hasAccount: true
    });
  }
  return { ok: true, items, me: principal.user.email };
}

export async function addPlatformAdmin(env, principal, request, payload) {
  const email = normalizeEmail(payload?.email);
  if (!email || !email.includes('@') || email.length > 254) throw platformError(400, 'A valid email is required.');
  const bootstrap = normalizeEmail(env.BOOTSTRAP_OWNER_EMAIL || '');
  if (bootstrap && email === bootstrap) throw platformError(409, 'That address is already the bootstrap platform administrator.');
  const displayName = optionalText(payload?.displayName, 'Display name', 160);
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO platform_admins
      (admin_id,email,display_name,status,created_at,updated_at)
    VALUES (?1,?2,?3,'active',?4,?4)
    ON CONFLICT(email) DO UPDATE SET status='active',display_name=excluded.display_name,updated_at=excluded.updated_at`)
    .bind(crypto.randomUUID(), email, displayName, now).run();
  const user = await env.DB.prepare('SELECT user_id FROM users WHERE lower(email)=?1').bind(email).first();
  let inviteUrl = '';
  if (user) {
    const membership = await env.DB.prepare(`SELECT membership_id FROM memberships
      WHERE user_id=?1 AND status='active' LIMIT 1`).bind(user.user_id).first();
    if (!membership) {
      const workspace = await internalWorkspace(env);
      await env.DB.prepare(`INSERT INTO memberships
          (membership_id,workspace_id,user_id,role,status,created_at,updated_at)
        VALUES (?1,?2,?3,'agent','active',?4,?4)
        ON CONFLICT(workspace_id,user_id) DO UPDATE SET status='active',updated_at=excluded.updated_at`)
        .bind(crypto.randomUUID(), workspace.workspace_id, user.user_id, now).run();
    }
  } else {
    const workspace = await internalWorkspace(env);
    const token = randomToken();
    const invitationId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS).toISOString();
    await env.DB.batch([
      env.DB.prepare(`UPDATE invitations SET status='cancelled',updated_at=?3
        WHERE workspace_id=?1 AND lower(email)=?2 AND status='pending'`).bind(workspace.workspace_id, email, now),
      env.DB.prepare(`INSERT INTO invitations
          (invitation_id,workspace_id,email,role,token_hash,status,invited_by_user_id,expires_at,created_at,updated_at)
        VALUES (?1,?2,?3,'agent',?4,'pending',?5,?6,?7,?7)`)
        .bind(invitationId, workspace.workspace_id, email, await hashToken(token),
          principal.user.userId || null, expiresAt, now)
    ]);
    inviteUrl = inviteLink(request, env, token);
  }
  await auditAuthAction(env, principal, 'grant', 'platform_admin', email, { email });
  return { ok: true, item: { email, displayName: displayName || email, hasAccount: Boolean(user) }, inviteUrl };
}

export async function removePlatformAdmin(env, principal, adminId) {
  const row = await env.DB.prepare('SELECT admin_id,email FROM platform_admins WHERE admin_id=?1')
    .bind(adminId).first();
  if (!row) throw platformError(404, 'Platform administrator not found.');
  const bootstrap = normalizeEmail(env.BOOTSTRAP_OWNER_EMAIL || '');
  if (bootstrap && normalizeEmail(row.email) === bootstrap) {
    throw platformError(409, 'The bootstrap platform administrator cannot be removed.');
  }
  await env.DB.prepare('DELETE FROM platform_admins WHERE admin_id=?1').bind(adminId).run();
  await auditAuthAction(env, principal, 'revoke', 'platform_admin', row.email, { email: row.email });
  return { ok: true };
}

function clientView(row) {
  return {
    workspaceId: row.workspace_id,
    slug: row.slug,
    name: row.name,
    status: row.status || 'active',
    kind: row.kind || 'client',
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    lastActivity: row.last_activity || '',
    owner: {
      email: row.owner_email || '',
      displayName: row.owner_name || ''
    },
    counts: {
      members: Number(row.member_count || 0),
      channels: Number(row.channel_count || 0),
      conversations: Number(row.conversation_count || 0),
      contacts: Number(row.contact_count || 0)
    },
    profile: {
      registeredName: row.registered_name || '',
      addressLine1: row.address_line1 || '',
      addressLine2: row.address_line2 || '',
      city: row.city || '',
      state: row.state || '',
      postalCode: row.postal_code || '',
      country: row.country || '',
      gstin: row.gstin || '',
      taxDetails: row.tax_details || ''
    }
  };
}

function memberView(row) {
  return {
    membershipId: row.membership_id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name || '',
    role: row.role,
    status: row.status,
    createdAt: row.created_at || ''
  };
}

function invitationView(row) {
  return {
    invitationId: row.invitation_id,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at
  };
}

async function assertAnotherOwner(env, workspaceId) {
  const owners = await env.DB.prepare(`SELECT count(*) AS count FROM memberships
    WHERE workspace_id=?1 AND role='owner' AND status='active'`).bind(workspaceId).first();
  if (Number(owners?.count || 0) <= 1) {
    throw platformError(409, 'The workspace must retain at least one active owner.');
  }
}

async function internalWorkspace(env) {
  const workspace = await env.DB.prepare(`SELECT workspace_id,name,slug FROM workspaces
    WHERE kind='internal' ORDER BY CASE WHEN slug='default' THEN 0 ELSE 1 END,created_at LIMIT 1`).first();
  if (workspace) return workspace;
  const fallback = await env.DB.prepare(`SELECT workspace_id,name,slug FROM workspaces
    ORDER BY created_at LIMIT 1`).first();
  if (!fallback) throw platformError(503, 'No workspace is configured.');
  return fallback;
}

function inviteLink(request, env, token) {
  const url = new URL('/auth/google/start', request.url);
  url.searchParams.set('return_to', env.APP_ORIGIN || 'https://chat.helixcer.com');
  url.searchParams.set('invite', token);
  return url.toString();
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
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

function cleanText(value, label, min, max) {
  const text = String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length < min || text.length > max) throw platformError(400, `${label} must be ${min} to ${max} characters.`);
  return text;
}

function optionalText(value, label, max) {
  const text = String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length > max) throw platformError(400, `${label} must be at most ${max} characters.`);
  return text;
}

function profileField(payload, key, current, max) {
  if (payload[key] === undefined) return current || '';
  const text = String(payload[key] || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (text.length > max) throw platformError(400, `${key} must be at most ${max} characters.`);
  return text;
}

function rejectUnknown(payload, allowed) {
  if (!payload || typeof payload !== 'object') return;
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(payload)) {
    if (!allowedSet.has(key)) throw platformError(400, `Unknown field: ${key}.`);
  }
}

function platformError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
