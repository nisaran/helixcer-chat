const CHAT_SCOPES = new Set(['all', 'assigned', 'none']);

function rolesError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export const PERMISSION_CATALOG = [
  {
    key: 'chats',
    label: 'Chats / Inbox',
    fields: [
      { key: 'view', label: 'View chats', type: 'scope', options: [
        { value: 'all', label: 'All conversations' },
        { value: 'assigned', label: 'Assigned to me only' },
        { value: 'none', label: 'No access' }
      ]},
      { key: 'reply', label: 'Reply to chats', type: 'scope', options: [
        { value: 'all', label: 'Reply to all' },
        { value: 'assigned', label: 'Reply to assigned only' },
        { value: 'none', label: 'Cannot reply' }
      ]},
      { key: 'assign', label: 'Assign conversations', type: 'boolean' },
      { key: 'delete', label: 'Delete conversations', type: 'boolean' }
    ]
  },
  {
    key: 'contacts',
    label: 'Contacts',
    fields: [
      { key: 'view', label: 'View contacts', type: 'boolean' },
      { key: 'create', label: 'Add contacts', type: 'boolean' },
      { key: 'edit', label: 'Edit contacts', type: 'boolean' },
      { key: 'delete', label: 'Delete contacts', type: 'boolean' }
    ]
  },
  {
    key: 'campaigns',
    label: 'Campaigns',
    fields: [
      { key: 'view', label: 'View campaigns', type: 'boolean' },
      { key: 'manage', label: 'Create and manage campaigns', type: 'boolean' }
    ]
  },
  {
    key: 'channels',
    label: 'Channels',
    fields: [
      { key: 'manage', label: 'Manage channels, templates, and imports', type: 'boolean' }
    ]
  },
  {
    key: 'developer',
    label: 'Developer API',
    fields: [
      { key: 'manage', label: 'Manage developer API keys', type: 'boolean' }
    ]
  },
  {
    key: 'team',
    label: 'Team',
    fields: [
      { key: 'manage', label: 'Invite and manage team members', type: 'boolean' }
    ]
  },
  {
    key: 'roles',
    label: 'User roles',
    fields: [
      { key: 'manage', label: 'Create and edit roles and permissions', type: 'boolean' }
    ]
  },
  {
    key: 'workspace',
    label: 'Workspace',
    fields: [
      { key: 'edit', label: 'Edit workspace profile', type: 'boolean' }
    ]
  }
];

export function defaultPermissionsForRole(roleKey) {
  const key = String(roleKey || 'agent');
  if (key === 'owner') {
    return {
      chats: { view: 'all', reply: 'all', assign: true, delete: true },
      contacts: { view: true, create: true, edit: true, delete: true },
      campaigns: { view: true, manage: true },
      channels: { manage: true },
      developer: { manage: true },
      team: { manage: true },
      roles: { manage: true },
      workspace: { edit: true }
    };
  }
  if (key === 'admin') {
    return {
      chats: { view: 'all', reply: 'all', assign: true, delete: true },
      contacts: { view: true, create: true, edit: true, delete: true },
      campaigns: { view: true, manage: true },
      channels: { manage: true },
      developer: { manage: true },
      team: { manage: true },
      roles: { manage: true },
      workspace: { edit: true }
    };
  }
  // agent and custom roles default to agent-level access
  return {
    chats: { view: 'all', reply: 'all', assign: true, delete: false },
    contacts: { view: true, create: true, edit: true, delete: false },
    campaigns: { view: true, manage: true },
    channels: { manage: false },
    developer: { manage: false },
    team: { manage: false },
    roles: { manage: false },
    workspace: { edit: false }
  };
}

export function normalizePermissions(raw, roleKey = 'agent') {
  const defaults = defaultPermissionsForRole(roleKey);
  const source = raw && typeof raw === 'object' ? raw : {};
  const chatsSource = source.chats && typeof source.chats === 'object' ? source.chats : {};
  const contactsSource = source.contacts && typeof source.contacts === 'object' ? source.contacts : {};
  const campaignsSource = source.campaigns && typeof source.campaigns === 'object' ? source.campaigns : {};
  const channelsSource = source.channels && typeof source.channels === 'object' ? source.channels : {};
  const developerSource = source.developer && typeof source.developer === 'object' ? source.developer : {};
  const teamSource = source.team && typeof source.team === 'object' ? source.team : {};
  const rolesSource = source.roles && typeof source.roles === 'object' ? source.roles : {};
  const workspaceSource = source.workspace && typeof source.workspace === 'object' ? source.workspace : {};

  const view = CHAT_SCOPES.has(chatsSource.view) ? chatsSource.view : defaults.chats.view;
  let reply = CHAT_SCOPES.has(chatsSource.reply) ? chatsSource.reply : defaults.chats.reply;
  if (view === 'none') reply = 'none';
  else if (view === 'assigned' && reply === 'all') reply = 'assigned';

  return {
    chats: {
      view,
      reply,
      assign: view === 'none' ? false : bool(chatsSource.assign, defaults.chats.assign),
      delete: view === 'none' ? false : bool(chatsSource.delete, defaults.chats.delete)
    },
    contacts: {
      view: bool(contactsSource.view, defaults.contacts.view),
      create: bool(contactsSource.create, defaults.contacts.create),
      edit: bool(contactsSource.edit, defaults.contacts.edit),
      delete: bool(contactsSource.delete, defaults.contacts.delete)
    },
    campaigns: {
      view: bool(campaignsSource.view, defaults.campaigns.view),
      manage: bool(campaignsSource.manage, defaults.campaigns.manage)
    },
    channels: {
      manage: bool(channelsSource.manage, defaults.channels.manage)
    },
    developer: {
      manage: bool(developerSource.manage, defaults.developer.manage)
    },
    team: {
      manage: bool(teamSource.manage, defaults.team.manage)
    },
    roles: {
      manage: bool(rolesSource.manage, defaults.roles.manage)
    },
    workspace: {
      edit: bool(workspaceSource.edit, defaults.workspace.edit)
    }
  };
}

function bool(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return Boolean(fallback);
}

export function permissionValue(permissions, path) {
  const [group, field] = String(path || '').split('.');
  if (!group || !field) return undefined;
  return permissions?.[group]?.[field];
}

export function hasPermission(principal, path) {
  if (!principal) return false;
  if (principal.membership?.role === 'owner') return true;
  const value = permissionValue(principal.permissions, path);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value !== 'none';
  // Fall back to legacy admin/agent ranks when permissions were not attached.
  if (['channels.manage', 'developer.manage', 'team.manage', 'roles.manage', 'workspace.edit',
    'contacts.delete', 'chats.delete'].includes(path)) {
    return ['owner', 'admin'].includes(principal.membership?.role);
  }
  return ['owner', 'admin', 'agent'].includes(principal.membership?.role);
}

export function requirePermission(principal, path) {
  if (!hasPermission(principal, path)) {
    throw rolesError(403, 'Insufficient workspace permission.');
  }
  return principal;
}

export function chatScope(principal, action = 'view') {
  if (principal?.membership?.role === 'owner') return 'all';
  const value = permissionValue(principal?.permissions, `chats.${action}`);
  return CHAT_SCOPES.has(value) ? value : 'all';
}

export function assigneeMatchers(principal) {
  return [
    principal?.user?.email,
    principal?.user?.displayName,
    principal?.user?.userId
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
}

export function isConversationAssignedToPrincipal(conversation, principal) {
  const assigned = String(conversation?.assignedTo || conversation?.assigned_to || '').trim().toLowerCase();
  if (!assigned || assigned === 'unassigned') return false;
  return assigneeMatchers(principal).includes(assigned);
}

export function assertChatAccess(principal, conversation, action = 'view') {
  const scope = chatScope(principal, action);
  if (scope === 'none') throw rolesError(403, 'You do not have permission to access chats.');
  if (scope === 'assigned' && !isConversationAssignedToPrincipal(conversation, principal)) {
    throw rolesError(403, action === 'reply'
      ? 'You can only reply to conversations assigned to you.'
      : 'You can only open conversations assigned to you.');
  }
  return principal;
}

function systemRoleSeeds() {
  return [
    {
      roleKey: 'owner',
      name: 'Owner',
      description: 'Full control of the workspace. Permissions cannot be reduced.',
      isSystem: 1,
      isLocked: 1,
      sortOrder: 1,
      permissions: defaultPermissionsForRole('owner')
    },
    {
      roleKey: 'admin',
      name: 'Admin',
      description: 'Manage team, channels, developer access, and customer conversations.',
      isSystem: 1,
      isLocked: 0,
      sortOrder: 2,
      permissions: defaultPermissionsForRole('admin')
    },
    {
      roleKey: 'agent',
      name: 'Agent',
      description: 'Handle assigned customer chats and contacts without admin settings.',
      isSystem: 1,
      isLocked: 0,
      sortOrder: 3,
      permissions: defaultPermissionsForRole('agent')
    }
  ];
}

export async function ensureWorkspaceRoles(env, workspaceId) {
  const existing = await env.DB.prepare(`SELECT role_key FROM workspace_roles WHERE workspace_id=?1`)
    .bind(workspaceId).all();
  const known = new Set((existing.results || []).map((row) => row.role_key));
  const now = new Date().toISOString();
  const inserts = [];
  for (const seed of systemRoleSeeds()) {
    if (known.has(seed.roleKey)) continue;
    inserts.push(env.DB.prepare(`INSERT INTO workspace_roles
        (role_id,workspace_id,role_key,name,description,is_system,is_locked,sort_order,permissions_json,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)`)
      .bind(crypto.randomUUID(), workspaceId, seed.roleKey, seed.name, seed.description,
        seed.isSystem, seed.isLocked, seed.sortOrder, JSON.stringify(seed.permissions), now));
  }
  if (inserts.length) await env.DB.batch(inserts);
}

export async function resolveRolePermissions(env, workspaceId, roleKey) {
  const key = String(roleKey || 'agent');
  if (key === 'owner') return defaultPermissionsForRole('owner');
  try {
    await ensureWorkspaceRoles(env, workspaceId);
    const row = await env.DB.prepare(`SELECT permissions_json FROM workspace_roles
      WHERE workspace_id=?1 AND role_key=?2`).bind(workspaceId, key).first();
    if (!row) return defaultPermissionsForRole(key);
    return normalizePermissions(JSON.parse(row.permissions_json || '{}'), key);
  } catch {
    return defaultPermissionsForRole(key);
  }
}

export async function attachPrincipalPermissions(env, principal) {
  if (!principal?.workspace?.workspaceId || !principal?.membership?.role) return principal;
  const permissions = await resolveRolePermissions(env, principal.workspace.workspaceId, principal.membership.role);
  principal.permissions = permissions;
  return principal;
}

function roleView(row) {
  const roleKey = row.role_key;
  let permissions;
  try {
    permissions = normalizePermissions(JSON.parse(row.permissions_json || '{}'), roleKey);
  } catch {
    permissions = defaultPermissionsForRole(roleKey);
  }
  if (roleKey === 'owner' || Number(row.is_locked) === 1) {
    permissions = defaultPermissionsForRole('owner');
  }
  return {
    roleId: row.role_id,
    roleKey,
    name: row.name,
    description: row.description || '',
    isSystem: Number(row.is_system) === 1,
    isLocked: Number(row.is_locked) === 1 || roleKey === 'owner',
    sortOrder: Number(row.sort_order) || 100,
    permissions,
    memberCount: Number(row.member_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listWorkspaceRoles(env, principal) {
  requirePermission(principal, 'roles.manage');
  const workspaceId = principal.workspace.workspaceId;
  await ensureWorkspaceRoles(env, workspaceId);
  const result = await env.DB.prepare(`SELECT r.*,
      (SELECT COUNT(*) FROM memberships m WHERE m.workspace_id=r.workspace_id AND m.role=r.role_key) AS member_count
    FROM workspace_roles r
    WHERE r.workspace_id=?1
    ORDER BY r.sort_order, r.name`).bind(workspaceId).all();
  return {
    items: (result.results || []).map(roleView),
    catalog: PERMISSION_CATALOG
  };
}

export async function createWorkspaceRole(env, principal, payload = {}) {
  requirePermission(principal, 'roles.manage');
  const workspaceId = principal.workspace.workspaceId;
  await ensureWorkspaceRoles(env, workspaceId);
  const name = cleanRoleName(payload.name);
  const description = cleanRoleDescription(payload.description);
  const roleKey = await allocateRoleKey(env, workspaceId, payload.roleKey || payload.key || name);
  const permissions = normalizePermissions(payload.permissions, roleKey);
  const now = new Date().toISOString();
  const roleId = crypto.randomUUID();
  const maxSort = await env.DB.prepare(`SELECT MAX(sort_order) AS max_sort FROM workspace_roles WHERE workspace_id=?1`)
    .bind(workspaceId).first();
  const sortOrder = Number(maxSort?.max_sort || 10) + 1;
  await env.DB.prepare(`INSERT INTO workspace_roles
      (role_id,workspace_id,role_key,name,description,is_system,is_locked,sort_order,permissions_json,created_at,updated_at)
    VALUES (?1,?2,?3,?4,?5,0,0,?6,?7,?8,?8)`)
    .bind(roleId, workspaceId, roleKey, name, description, sortOrder, JSON.stringify(permissions), now).run();
  const row = await env.DB.prepare(`SELECT r.*, 0 AS member_count FROM workspace_roles r
    WHERE r.role_id=?1`).bind(roleId).first();
  return { ok: true, item: roleView(row) };
}

export async function updateWorkspaceRole(env, principal, roleKey, payload = {}) {
  requirePermission(principal, 'roles.manage');
  const workspaceId = principal.workspace.workspaceId;
  await ensureWorkspaceRoles(env, workspaceId);
  const key = String(roleKey || '').trim();
  const row = await env.DB.prepare(`SELECT * FROM workspace_roles WHERE workspace_id=?1 AND role_key=?2`)
    .bind(workspaceId, key).first();
  if (!row) throw rolesError(404, 'Role not found.');
  if (key === 'owner' || Number(row.is_locked) === 1) {
    throw rolesError(403, 'The owner role permissions cannot be changed.');
  }
  const name = payload.name === undefined ? row.name : cleanRoleName(payload.name);
  const description = payload.description === undefined ? (row.description || '') : cleanRoleDescription(payload.description);
  const permissions = payload.permissions === undefined
    ? normalizePermissions(JSON.parse(row.permissions_json || '{}'), key)
    : normalizePermissions(payload.permissions, key);
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE workspace_roles SET name=?3,description=?4,permissions_json=?5,updated_at=?6
    WHERE workspace_id=?1 AND role_key=?2`)
    .bind(workspaceId, key, name, description, JSON.stringify(permissions), now).run();
  const memberCount = await env.DB.prepare(`SELECT COUNT(*) AS count FROM memberships
    WHERE workspace_id=?1 AND role=?2`).bind(workspaceId, key).first();
  return {
    ok: true,
    item: roleView({
      ...row,
      name,
      description,
      permissions_json: JSON.stringify(permissions),
      updated_at: now,
      member_count: Number(memberCount?.count || 0)
    })
  };
}

export async function deleteWorkspaceRole(env, principal, roleKey) {
  requirePermission(principal, 'roles.manage');
  const workspaceId = principal.workspace.workspaceId;
  const key = String(roleKey || '').trim();
  const row = await env.DB.prepare(`SELECT * FROM workspace_roles WHERE workspace_id=?1 AND role_key=?2`)
    .bind(workspaceId, key).first();
  if (!row) throw rolesError(404, 'Role not found.');
  if (Number(row.is_system) === 1 || key === 'owner' || key === 'admin' || key === 'agent') {
    throw rolesError(403, 'System roles cannot be deleted.');
  }
  const members = await env.DB.prepare(`SELECT COUNT(*) AS count FROM memberships
    WHERE workspace_id=?1 AND role=?2`).bind(workspaceId, key).first();
  if (Number(members?.count || 0) > 0) {
    throw rolesError(409, 'Reassign members before deleting this role.');
  }
  const invites = await env.DB.prepare(`SELECT COUNT(*) AS count FROM invitations
    WHERE workspace_id=?1 AND role=?2 AND status='pending'`).bind(workspaceId, key).first();
  if (Number(invites?.count || 0) > 0) {
    throw rolesError(409, 'Cancel pending invitations for this role before deleting it.');
  }
  await env.DB.prepare(`DELETE FROM workspace_roles WHERE workspace_id=?1 AND role_key=?2`)
    .bind(workspaceId, key).run();
  return { ok: true, roleKey: key };
}

export async function assertAssignableRole(env, workspaceId, roleKey, { allowOwner = false } = {}) {
  const key = String(roleKey || '').trim();
  if (!key) throw rolesError(400, 'A role is required.');
  if (key === 'owner' && !allowOwner) throw rolesError(400, 'Owner access cannot be granted through invitations.');
  await ensureWorkspaceRoles(env, workspaceId);
  const row = await env.DB.prepare(`SELECT role_key,is_locked,permissions_json FROM workspace_roles
    WHERE workspace_id=?1 AND role_key=?2`).bind(workspaceId, key).first();
  if (!row && !['owner', 'admin', 'agent'].includes(key)) {
    throw rolesError(400, 'Unknown workspace role.');
  }
  if (!row && ['owner', 'admin', 'agent'].includes(key)) {
    return { roleKey: key, permissions: defaultPermissionsForRole(key), isElevated: key !== 'agent' };
  }
  const permissions = key === 'owner'
    ? defaultPermissionsForRole('owner')
    : normalizePermissions(JSON.parse(row.permissions_json || '{}'), key);
  const isElevated = key === 'owner' || key === 'admin'
    || permissions.team.manage
    || permissions.roles.manage
    || permissions.channels.manage
    || permissions.developer.manage
    || permissions.workspace.edit;
  return { roleKey: key, permissions, isElevated };
}

export async function listAssignableRoleOptions(env, workspaceId) {
  await ensureWorkspaceRoles(env, workspaceId);
  const result = await env.DB.prepare(`SELECT role_key,name,description,is_system,permissions_json
    FROM workspace_roles WHERE workspace_id=?1 AND role_key!='owner'
    ORDER BY sort_order, name`).bind(workspaceId).all();
  return (result.results || []).map((row) => ({
    roleKey: row.role_key,
    name: row.name,
    description: row.description || '',
    isSystem: Number(row.is_system) === 1,
    permissions: normalizePermissions(JSON.parse(row.permissions_json || '{}'), row.role_key)
  }));
}

function cleanRoleName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw rolesError(400, 'Role name is required.');
  if (name.length > 60) throw rolesError(400, 'Role name must be 60 characters or fewer.');
  return name;
}

function cleanRoleDescription(value) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (text.length > 240) throw rolesError(400, 'Role description must be 240 characters or fewer.');
  return text;
}

async function allocateRoleKey(env, workspaceId, seed) {
  const base = String(seed || 'role')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'role';
  if (['owner', 'admin', 'agent'].includes(base)) {
    throw rolesError(400, 'That role key is reserved. Choose another name.');
  }
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(base)) {
    throw rolesError(400, 'Role key must start with a letter and use letters, numbers, or underscores.');
  }
  let candidate = base;
  for (let index = 2; index < 50; index += 1) {
    const existing = await env.DB.prepare(`SELECT role_id FROM workspace_roles
      WHERE workspace_id=?1 AND role_key=?2`).bind(workspaceId, candidate).first();
    if (!existing) return candidate;
    candidate = `${base}_${index}`.slice(0, 48);
  }
  throw rolesError(409, 'Could not allocate a unique role key.');
}
