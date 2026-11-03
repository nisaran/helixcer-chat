var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// worker/src/roles.js
var roles_exports = {};
__export(roles_exports, {
  PERMISSION_CATALOG: () => PERMISSION_CATALOG,
  assertAssignableRole: () => assertAssignableRole,
  assertChatAccess: () => assertChatAccess,
  assigneeMatchers: () => assigneeMatchers,
  attachPrincipalPermissions: () => attachPrincipalPermissions,
  chatScope: () => chatScope,
  createWorkspaceRole: () => createWorkspaceRole,
  defaultPermissionsForRole: () => defaultPermissionsForRole,
  deleteWorkspaceRole: () => deleteWorkspaceRole,
  ensureWorkspaceRoles: () => ensureWorkspaceRoles,
  hasPermission: () => hasPermission,
  isConversationAssignedToPrincipal: () => isConversationAssignedToPrincipal,
  listAssignableRoleOptions: () => listAssignableRoleOptions,
  listWorkspaceRoles: () => listWorkspaceRoles,
  normalizePermissions: () => normalizePermissions,
  permissionValue: () => permissionValue,
  requirePermission: () => requirePermission,
  resolveRolePermissions: () => resolveRolePermissions,
  updateWorkspaceRole: () => updateWorkspaceRole
});
function rolesError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
function defaultPermissionsForRole(roleKey) {
  const key = String(roleKey || "agent");
  if (key === "owner") {
    return {
      chats: { view: "all", reply: "all", assign: true, delete: true },
      contacts: { view: true, create: true, edit: true, delete: true },
      campaigns: { view: true, manage: true },
      channels: { manage: true },
      developer: { manage: true },
      team: { manage: true },
      roles: { manage: true },
      workspace: { edit: true }
    };
  }
  if (key === "admin") {
    return {
      chats: { view: "all", reply: "all", assign: true, delete: true },
      contacts: { view: true, create: true, edit: true, delete: true },
      campaigns: { view: true, manage: true },
      channels: { manage: true },
      developer: { manage: true },
      team: { manage: true },
      roles: { manage: true },
      workspace: { edit: true }
    };
  }
  return {
    chats: { view: "all", reply: "all", assign: true, delete: false },
    contacts: { view: true, create: true, edit: true, delete: false },
    campaigns: { view: true, manage: true },
    channels: { manage: false },
    developer: { manage: false },
    team: { manage: false },
    roles: { manage: false },
    workspace: { edit: false }
  };
}
function normalizePermissions(raw, roleKey = "agent") {
  const defaults = defaultPermissionsForRole(roleKey);
  const source = raw && typeof raw === "object" ? raw : {};
  const chatsSource = source.chats && typeof source.chats === "object" ? source.chats : {};
  const contactsSource = source.contacts && typeof source.contacts === "object" ? source.contacts : {};
  const campaignsSource = source.campaigns && typeof source.campaigns === "object" ? source.campaigns : {};
  const channelsSource = source.channels && typeof source.channels === "object" ? source.channels : {};
  const developerSource = source.developer && typeof source.developer === "object" ? source.developer : {};
  const teamSource = source.team && typeof source.team === "object" ? source.team : {};
  const rolesSource = source.roles && typeof source.roles === "object" ? source.roles : {};
  const workspaceSource = source.workspace && typeof source.workspace === "object" ? source.workspace : {};
  const view = CHAT_SCOPES.has(chatsSource.view) ? chatsSource.view : defaults.chats.view;
  let reply = CHAT_SCOPES.has(chatsSource.reply) ? chatsSource.reply : defaults.chats.reply;
  if (view === "none") reply = "none";
  else if (view === "assigned" && reply === "all") reply = "assigned";
  return {
    chats: {
      view,
      reply,
      assign: view === "none" ? false : bool(chatsSource.assign, defaults.chats.assign),
      delete: view === "none" ? false : bool(chatsSource.delete, defaults.chats.delete)
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
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return Boolean(fallback);
}
function permissionValue(permissions, path) {
  const [group, field] = String(path || "").split(".");
  if (!group || !field) return void 0;
  return permissions?.[group]?.[field];
}
function hasPermission(principal, path) {
  if (!principal) return false;
  if (principal.membership?.role === "owner") return true;
  const value = permissionValue(principal.permissions, path);
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value !== "none";
  if ([
    "channels.manage",
    "developer.manage",
    "team.manage",
    "roles.manage",
    "workspace.edit",
    "contacts.delete",
    "chats.delete"
  ].includes(path)) {
    return ["owner", "admin"].includes(principal.membership?.role);
  }
  return ["owner", "admin", "agent"].includes(principal.membership?.role);
}
function requirePermission(principal, path) {
  if (!hasPermission(principal, path)) {
    throw rolesError(403, "Insufficient workspace permission.");
  }
  return principal;
}
function chatScope(principal, action = "view") {
  if (principal?.membership?.role === "owner") return "all";
  const value = permissionValue(principal?.permissions, `chats.${action}`);
  return CHAT_SCOPES.has(value) ? value : "all";
}
function assigneeMatchers(principal) {
  return [
    principal?.user?.email,
    principal?.user?.displayName,
    principal?.user?.userId
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
}
function isConversationAssignedToPrincipal(conversation, principal) {
  const assigned = String(conversation?.assignedTo || conversation?.assigned_to || "").trim().toLowerCase();
  if (!assigned || assigned === "unassigned") return false;
  return assigneeMatchers(principal).includes(assigned);
}
function assertChatAccess(principal, conversation, action = "view") {
  const scope = chatScope(principal, action);
  if (scope === "none") throw rolesError(403, "You do not have permission to access chats.");
  if (scope === "assigned" && !isConversationAssignedToPrincipal(conversation, principal)) {
    throw rolesError(403, action === "reply" ? "You can only reply to conversations assigned to you." : "You can only open conversations assigned to you.");
  }
  return principal;
}
function systemRoleSeeds() {
  return [
    {
      roleKey: "owner",
      name: "Owner",
      description: "Full control of the workspace. Permissions cannot be reduced.",
      isSystem: 1,
      isLocked: 1,
      sortOrder: 1,
      permissions: defaultPermissionsForRole("owner")
    },
    {
      roleKey: "admin",
      name: "Admin",
      description: "Manage team, channels, developer access, and customer conversations.",
      isSystem: 1,
      isLocked: 0,
      sortOrder: 2,
      permissions: defaultPermissionsForRole("admin")
    },
    {
      roleKey: "agent",
      name: "Agent",
      description: "Handle assigned customer chats and contacts without admin settings.",
      isSystem: 1,
      isLocked: 0,
      sortOrder: 3,
      permissions: defaultPermissionsForRole("agent")
    }
  ];
}
async function ensureWorkspaceRoles(env, workspaceId) {
  const existing = await env.DB.prepare(`SELECT role_key FROM workspace_roles WHERE workspace_id=?1`).bind(workspaceId).all();
  const known = new Set((existing.results || []).map((row) => row.role_key));
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const inserts = [];
  for (const seed of systemRoleSeeds()) {
    if (known.has(seed.roleKey)) continue;
    inserts.push(env.DB.prepare(`INSERT INTO workspace_roles
        (role_id,workspace_id,role_key,name,description,is_system,is_locked,sort_order,permissions_json,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)`).bind(
      crypto.randomUUID(),
      workspaceId,
      seed.roleKey,
      seed.name,
      seed.description,
      seed.isSystem,
      seed.isLocked,
      seed.sortOrder,
      JSON.stringify(seed.permissions),
      now
    ));
  }
  if (inserts.length) await env.DB.batch(inserts);
}
async function resolveRolePermissions(env, workspaceId, roleKey) {
  const key = String(roleKey || "agent");
  if (key === "owner") return defaultPermissionsForRole("owner");
  try {
    await ensureWorkspaceRoles(env, workspaceId);
    const row = await env.DB.prepare(`SELECT permissions_json FROM workspace_roles
      WHERE workspace_id=?1 AND role_key=?2`).bind(workspaceId, key).first();
    if (!row) return defaultPermissionsForRole(key);
    return normalizePermissions(JSON.parse(row.permissions_json || "{}"), key);
  } catch {
    return defaultPermissionsForRole(key);
  }
}
async function attachPrincipalPermissions(env, principal) {
  if (!principal?.workspace?.workspaceId || !principal?.membership?.role) return principal;
  const permissions = await resolveRolePermissions(env, principal.workspace.workspaceId, principal.membership.role);
  principal.permissions = permissions;
  return principal;
}
function roleView(row) {
  const roleKey = row.role_key;
  let permissions;
  try {
    permissions = normalizePermissions(JSON.parse(row.permissions_json || "{}"), roleKey);
  } catch {
    permissions = defaultPermissionsForRole(roleKey);
  }
  if (roleKey === "owner" || Number(row.is_locked) === 1) {
    permissions = defaultPermissionsForRole("owner");
  }
  return {
    roleId: row.role_id,
    roleKey,
    name: row.name,
    description: row.description || "",
    isSystem: Number(row.is_system) === 1,
    isLocked: Number(row.is_locked) === 1 || roleKey === "owner",
    sortOrder: Number(row.sort_order) || 100,
    permissions,
    memberCount: Number(row.member_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
async function listWorkspaceRoles(env, principal) {
  requirePermission(principal, "roles.manage");
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
async function createWorkspaceRole(env, principal, payload = {}) {
  requirePermission(principal, "roles.manage");
  const workspaceId = principal.workspace.workspaceId;
  await ensureWorkspaceRoles(env, workspaceId);
  const name = cleanRoleName(payload.name);
  const description = cleanRoleDescription(payload.description);
  const roleKey = await allocateRoleKey(env, workspaceId, payload.roleKey || payload.key || name);
  const permissions = normalizePermissions(payload.permissions, roleKey);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const roleId = crypto.randomUUID();
  const maxSort = await env.DB.prepare(`SELECT MAX(sort_order) AS max_sort FROM workspace_roles WHERE workspace_id=?1`).bind(workspaceId).first();
  const sortOrder = Number(maxSort?.max_sort || 10) + 1;
  await env.DB.prepare(`INSERT INTO workspace_roles
      (role_id,workspace_id,role_key,name,description,is_system,is_locked,sort_order,permissions_json,created_at,updated_at)
    VALUES (?1,?2,?3,?4,?5,0,0,?6,?7,?8,?8)`).bind(roleId, workspaceId, roleKey, name, description, sortOrder, JSON.stringify(permissions), now).run();
  const row = await env.DB.prepare(`SELECT r.*, 0 AS member_count FROM workspace_roles r
    WHERE r.role_id=?1`).bind(roleId).first();
  return { ok: true, item: roleView(row) };
}
async function updateWorkspaceRole(env, principal, roleKey, payload = {}) {
  requirePermission(principal, "roles.manage");
  const workspaceId = principal.workspace.workspaceId;
  await ensureWorkspaceRoles(env, workspaceId);
  const key = String(roleKey || "").trim();
  const row = await env.DB.prepare(`SELECT * FROM workspace_roles WHERE workspace_id=?1 AND role_key=?2`).bind(workspaceId, key).first();
  if (!row) throw rolesError(404, "Role not found.");
  if (key === "owner" || Number(row.is_locked) === 1) {
    throw rolesError(403, "The owner role permissions cannot be changed.");
  }
  const name = payload.name === void 0 ? row.name : cleanRoleName(payload.name);
  const description = payload.description === void 0 ? row.description || "" : cleanRoleDescription(payload.description);
  const permissions = payload.permissions === void 0 ? normalizePermissions(JSON.parse(row.permissions_json || "{}"), key) : normalizePermissions(payload.permissions, key);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(`UPDATE workspace_roles SET name=?3,description=?4,permissions_json=?5,updated_at=?6
    WHERE workspace_id=?1 AND role_key=?2`).bind(workspaceId, key, name, description, JSON.stringify(permissions), now).run();
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
async function deleteWorkspaceRole(env, principal, roleKey) {
  requirePermission(principal, "roles.manage");
  const workspaceId = principal.workspace.workspaceId;
  const key = String(roleKey || "").trim();
  const row = await env.DB.prepare(`SELECT * FROM workspace_roles WHERE workspace_id=?1 AND role_key=?2`).bind(workspaceId, key).first();
  if (!row) throw rolesError(404, "Role not found.");
  if (Number(row.is_system) === 1 || key === "owner" || key === "admin" || key === "agent") {
    throw rolesError(403, "System roles cannot be deleted.");
  }
  const members = await env.DB.prepare(`SELECT COUNT(*) AS count FROM memberships
    WHERE workspace_id=?1 AND role=?2`).bind(workspaceId, key).first();
  if (Number(members?.count || 0) > 0) {
    throw rolesError(409, "Reassign members before deleting this role.");
  }
  const invites = await env.DB.prepare(`SELECT COUNT(*) AS count FROM invitations
    WHERE workspace_id=?1 AND role=?2 AND status='pending'`).bind(workspaceId, key).first();
  if (Number(invites?.count || 0) > 0) {
    throw rolesError(409, "Cancel pending invitations for this role before deleting it.");
  }
  await env.DB.prepare(`DELETE FROM workspace_roles WHERE workspace_id=?1 AND role_key=?2`).bind(workspaceId, key).run();
  return { ok: true, roleKey: key };
}
async function assertAssignableRole(env, workspaceId, roleKey, { allowOwner = false } = {}) {
  const key = String(roleKey || "").trim();
  if (!key) throw rolesError(400, "A role is required.");
  if (key === "owner" && !allowOwner) throw rolesError(400, "Owner access cannot be granted through invitations.");
  await ensureWorkspaceRoles(env, workspaceId);
  const row = await env.DB.prepare(`SELECT role_key,is_locked,permissions_json FROM workspace_roles
    WHERE workspace_id=?1 AND role_key=?2`).bind(workspaceId, key).first();
  if (!row && !["owner", "admin", "agent"].includes(key)) {
    throw rolesError(400, "Unknown workspace role.");
  }
  if (!row && ["owner", "admin", "agent"].includes(key)) {
    return { roleKey: key, permissions: defaultPermissionsForRole(key), isElevated: key !== "agent" };
  }
  const permissions = key === "owner" ? defaultPermissionsForRole("owner") : normalizePermissions(JSON.parse(row.permissions_json || "{}"), key);
  const isElevated = key === "owner" || key === "admin" || permissions.team.manage || permissions.roles.manage || permissions.channels.manage || permissions.developer.manage || permissions.workspace.edit;
  return { roleKey: key, permissions, isElevated };
}
async function listAssignableRoleOptions(env, workspaceId) {
  await ensureWorkspaceRoles(env, workspaceId);
  const result = await env.DB.prepare(`SELECT role_key,name,description,is_system,permissions_json
    FROM workspace_roles WHERE workspace_id=?1 AND role_key!='owner'
    ORDER BY sort_order, name`).bind(workspaceId).all();
  return (result.results || []).map((row) => ({
    roleKey: row.role_key,
    name: row.name,
    description: row.description || "",
    isSystem: Number(row.is_system) === 1,
    permissions: normalizePermissions(JSON.parse(row.permissions_json || "{}"), row.role_key)
  }));
}
function cleanRoleName(value) {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw rolesError(400, "Role name is required.");
  if (name.length > 60) throw rolesError(400, "Role name must be 60 characters or fewer.");
  return name;
}
function cleanRoleDescription(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (text.length > 240) throw rolesError(400, "Role description must be 240 characters or fewer.");
  return text;
}
async function allocateRoleKey(env, workspaceId, seed) {
  const base = String(seed || "role").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "role";
  if (["owner", "admin", "agent"].includes(base)) {
    throw rolesError(400, "That role key is reserved. Choose another name.");
  }
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(base)) {
    throw rolesError(400, "Role key must start with a letter and use letters, numbers, or underscores.");
  }
  let candidate = base;
  for (let index = 2; index < 50; index += 1) {
    const existing = await env.DB.prepare(`SELECT role_id FROM workspace_roles
      WHERE workspace_id=?1 AND role_key=?2`).bind(workspaceId, candidate).first();
    if (!existing) return candidate;
    candidate = `${base}_${index}`.slice(0, 48);
  }
  throw rolesError(409, "Could not allocate a unique role key.");
}
var CHAT_SCOPES, PERMISSION_CATALOG;
var init_roles = __esm({
  "worker/src/roles.js"() {
    CHAT_SCOPES = /* @__PURE__ */ new Set(["all", "assigned", "none"]);
    __name(rolesError, "rolesError");
    PERMISSION_CATALOG = [
      {
        key: "chats",
        label: "Chats / Inbox",
        fields: [
          { key: "view", label: "View chats", type: "scope", options: [
            { value: "all", label: "All conversations" },
            { value: "assigned", label: "Assigned to me only" },
            { value: "none", label: "No access" }
          ] },
          { key: "reply", label: "Reply to chats", type: "scope", options: [
            { value: "all", label: "Reply to all" },
            { value: "assigned", label: "Reply to assigned only" },
            { value: "none", label: "Cannot reply" }
          ] },
          { key: "assign", label: "Assign conversations", type: "boolean" },
          { key: "delete", label: "Delete conversations", type: "boolean" }
        ]
      },
      {
        key: "contacts",
        label: "Contacts",
        fields: [
          { key: "view", label: "View contacts", type: "boolean" },
          { key: "create", label: "Add contacts", type: "boolean" },
          { key: "edit", label: "Edit contacts", type: "boolean" },
          { key: "delete", label: "Delete contacts", type: "boolean" }
        ]
      },
      {
        key: "campaigns",
        label: "Campaigns",
        fields: [
          { key: "view", label: "View campaigns", type: "boolean" },
          { key: "manage", label: "Create and manage campaigns", type: "boolean" }
        ]
      },
      {
        key: "channels",
        label: "Channels",
        fields: [
          { key: "manage", label: "Manage channels, templates, and imports", type: "boolean" }
        ]
      },
      {
        key: "developer",
        label: "Developer API",
        fields: [
          { key: "manage", label: "Manage developer API keys", type: "boolean" }
        ]
      },
      {
        key: "team",
        label: "Team",
        fields: [
          { key: "manage", label: "Invite and manage team members", type: "boolean" }
        ]
      },
      {
        key: "roles",
        label: "User roles",
        fields: [
          { key: "manage", label: "Create and edit roles and permissions", type: "boolean" }
        ]
      },
      {
        key: "workspace",
        label: "Workspace",
        fields: [
          { key: "edit", label: "Edit workspace profile", type: "boolean" }
        ]
      }
    ];
    __name(defaultPermissionsForRole, "defaultPermissionsForRole");
    __name(normalizePermissions, "normalizePermissions");
    __name(bool, "bool");
    __name(permissionValue, "permissionValue");
    __name(hasPermission, "hasPermission");
    __name(requirePermission, "requirePermission");
    __name(chatScope, "chatScope");
    __name(assigneeMatchers, "assigneeMatchers");
    __name(isConversationAssignedToPrincipal, "isConversationAssignedToPrincipal");
    __name(assertChatAccess, "assertChatAccess");
    __name(systemRoleSeeds, "systemRoleSeeds");
    __name(ensureWorkspaceRoles, "ensureWorkspaceRoles");
    __name(resolveRolePermissions, "resolveRolePermissions");
    __name(attachPrincipalPermissions, "attachPrincipalPermissions");
    __name(roleView, "roleView");
    __name(listWorkspaceRoles, "listWorkspaceRoles");
    __name(createWorkspaceRole, "createWorkspaceRole");
    __name(updateWorkspaceRole, "updateWorkspaceRole");
    __name(deleteWorkspaceRole, "deleteWorkspaceRole");
    __name(assertAssignableRole, "assertAssignableRole");
    __name(listAssignableRoleOptions, "listAssignableRoleOptions");
    __name(cleanRoleName, "cleanRoleName");
    __name(cleanRoleDescription, "cleanRoleDescription");
    __name(allocateRoleKey, "allocateRoleKey");
  }
});

// worker/src/mail.js
var mail_exports = {};
__export(mail_exports, {
  passwordResetEmailContent: () => passwordResetEmailContent,
  sendTransactionalEmail: () => sendTransactionalEmail
});
async function sendTransactionalEmail(env, { to, subject, text, html }) {
  const recipient = String(to || "").trim();
  if (!recipient || !recipient.includes("@")) {
    throw new Error("A valid recipient email is required.");
  }
  const from = String(env.EMAIL_FROM || "Helixcer Chat <noreply@helixcer.com>").trim();
  if (env.RESEND_API_KEY) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [recipient],
        subject: String(subject || ""),
        text: String(text || ""),
        html: String(html || text || "")
      })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Resend email failed (${response.status}): ${detail.slice(0, 300)}`);
    }
    return { provider: "resend" };
  }
  if (env.EMAIL && typeof env.EMAIL.send === "function") {
    await env.EMAIL.send({
      from,
      to: recipient,
      subject: String(subject || ""),
      text: String(text || ""),
      html: String(html || text || "")
    });
    return { provider: "cloudflare_email" };
  }
  const error = new Error("Transactional email is not configured.");
  error.code = "email_not_configured";
  throw error;
}
function passwordResetEmailContent(resetUrl) {
  const subject = "Reset your Helixcer Chat password";
  const text = [
    "Use this link to set or reset your Helixcer Chat password:",
    resetUrl,
    "",
    "This link expires in one hour. If you did not request it, you can ignore this email."
  ].join("\n");
  const html = `<!doctype html><html><body style="font:16px/1.5 system-ui,sans-serif;color:#172321">
<p>Use this link to set or reset your Helixcer Chat password:</p>
<p><a href="${escapeHtml(resetUrl)}">${escapeHtml(resetUrl)}</a></p>
<p style="color:#596561">This link expires in one hour. If you did not request it, you can ignore this email.</p>
</body></html>`;
  return { subject, text, html };
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}
var init_mail = __esm({
  "worker/src/mail.js"() {
    __name(sendTransactionalEmail, "sendTransactionalEmail");
    __name(passwordResetEmailContent, "passwordResetEmailContent");
    __name(escapeHtml, "escapeHtml");
  }
});

// worker/src/auth.js
var SESSION_COOKIE = "__Host-helixcer_session";
var OAUTH_COOKIE = "__Host-helixcer_oauth";
var GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
var GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
var GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
var GOOGLE_ISSUERS = /* @__PURE__ */ new Set(["https://accounts.google.com", "accounts.google.com"]);
var encoder = new TextEncoder();
var decoder = new TextDecoder();
var jwksCache = /* @__PURE__ */ new Map();
var MOBILE_DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;
var MOBILE_CHALLENGE_TTL_SECONDS = 5 * 60;
async function startGoogleOAuth(request, env) {
  requireOAuthConfig(env);
  const url = new URL(request.url);
  const returnTo = validateReturnTo(url.searchParams.get("return_to") || url.searchParams.get("returnTo") || "/", env);
  const previousState = readCookie(request, OAUTH_COOKIE);
  if (previousState) {
    await env.DB.prepare("DELETE FROM oauth_states WHERE state_hash=?1").bind(await hashToken(previousState)).run();
  }
  const state = randomToken(32);
  const nonce = randomToken(32);
  const codeVerifier = randomToken(48);
  const invitationToken = url.searchParams.get("invite") || "";
  if (invitationToken.length > 256) throw authError(400, "Invitation token is invalid.");
  const now = /* @__PURE__ */ new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1e3).toISOString();
  await env.DB.prepare(`INSERT INTO oauth_states
      (state_hash,nonce_hash,code_verifier,return_to,invitation_token_hash,expires_at,created_at)
    VALUES (?1,?2,?3,?4,?5,?6,?7)`).bind(
    await hashToken(state),
    await hashToken(nonce),
    codeVerifier,
    returnTo,
    invitationToken ? await hashToken(invitationToken) : null,
    expiresAt,
    now.toISOString()
  ).run();
  const authorize = new URL(GOOGLE_AUTH_URL);
  authorize.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", googleRedirectUri(request, env));
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "openid email profile");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("nonce", nonce);
  authorize.searchParams.set("code_challenge", await pkceChallenge(codeVerifier));
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("prompt", "select_account");
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": cookieHeader(OAUTH_COOKIE, state, 10 * 60)
    }
  });
}
__name(startGoogleOAuth, "startGoogleOAuth");
async function finishGoogleOAuth(request, env, fetchImpl = fetch) {
  requireOAuthConfig(env);
  const url = new URL(request.url);
  if (url.searchParams.get("error")) throw authError(401, "Google sign-in was cancelled or denied.");
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const cookieState = readCookie(request, OAUTH_COOKIE) || "";
  if (!code || !state || !cookieState || !timingSafeEqual(state, cookieState)) throw authError(400, "Invalid OAuth state.");
  const stateHash = await hashToken(state);
  const stored = await env.DB.prepare(`SELECT state_hash,nonce_hash,code_verifier,return_to,invitation_token_hash,expires_at
    FROM oauth_states WHERE state_hash=?1`).bind(stateHash).first();
  if (!stored || stored.expires_at <= (/* @__PURE__ */ new Date()).toISOString()) throw authError(400, "OAuth state expired.");
  await env.DB.prepare("DELETE FROM oauth_states WHERE state_hash=?1").bind(stateHash).run();
  const tokenResponse = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: googleRedirectUri(request, env),
      grant_type: "authorization_code",
      code_verifier: stored.code_verifier
    })
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenPayload.id_token) throw authError(401, "Google token exchange failed.");
  const identity = await verifyGoogleIdToken(tokenPayload.id_token, {
    clientId: env.GOOGLE_CLIENT_ID,
    nonceHash: stored.nonce_hash,
    jwksUrl: env.GOOGLE_JWKS_URL || GOOGLE_JWKS_URL
  }, fetchImpl);
  const principal = await provisionVerifiedIdentity(env, identity, stored.invitation_token_hash);
  const session = await createSession(env, principal);
  await auditAuthAction(env, principal, "login", "session", session.sessionId, { authProvider: "google" });
  const headers = new Headers({ Location: stored.return_to, "Referrer-Policy": "no-referrer" });
  headers.append("Set-Cookie", cookieHeader(SESSION_COOKIE, session.token, session.maxAge));
  headers.append("Set-Cookie", clearCookieHeader(OAUTH_COOKIE));
  return new Response(null, {
    status: 302,
    headers
  });
}
__name(finishGoogleOAuth, "finishGoogleOAuth");
async function finishGoogleOAuthResponse(request, env, fetchImpl = fetch) {
  try {
    return await finishGoogleOAuth(request, env, fetchImpl);
  } catch (error) {
    const failure = oauthFailureView(error);
    if (failure.status >= 500) {
      console.error("oauth_callback_failed", { status: failure.status, message: error?.message || "Unknown OAuth callback error" });
    }
    const target = oauthFailureTarget(env);
    if (!target) return oauthFailurePage(failure, clearCookieHeader(OAUTH_COOKIE));
    target.searchParams.set("auth_error", failure.message);
    target.searchParams.set("auth_error_code", failure.code);
    const headers = new Headers({
      Location: target.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer"
    });
    headers.append("Set-Cookie", clearCookieHeader(OAUTH_COOKIE));
    return new Response(null, { status: 302, headers });
  }
}
__name(finishGoogleOAuthResponse, "finishGoogleOAuthResponse");
async function authenticateRequest(request, env) {
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
      AND w.status='active'`).bind(await hashToken(rawToken), (/* @__PURE__ */ new Date()).toISOString()).first();
  if (!row) return null;
  const expectedSource = row.session_type === "mobile" ? "bearer" : "cookie";
  if (credential.source !== expectedSource) return null;
  return principalFromRow(row, row.session_type === "mobile" ? "mobile_session" : "session");
}
__name(authenticateRequest, "authenticateRequest");
async function logout(request, env) {
  const token = sessionCredential(request).token;
  const principal = token ? await authenticateRequest(request, env) : null;
  if (token && (principal?.authType === "session" || principal?.authType === "mobile_session")) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM mobile_push_devices WHERE session_id=?1").bind(principal.sessionId),
      env.DB.prepare("UPDATE sessions SET revoked_at=?2 WHERE token_hash=?1 AND revoked_at IS NULL").bind(await hashToken(token), now)
    ]);
  }
  if (principal && (principal.authType === "session" || principal.authType === "mobile_session")) {
    await auditAuthAction(env, principal, "logout", "session", principal.sessionId || "", {
      client: principal.authType === "mobile_session" ? "android" : "browser"
    });
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Set-Cookie": clearCookieHeader(SESSION_COOKIE) }
  });
}
__name(logout, "logout");
function mobileAuthConfiguration(env) {
  return {
    enabled: Boolean(env.GOOGLE_CLIENT_ID),
    googleWebClientId: String(env.GOOGLE_CLIENT_ID || ""),
    packageName: "com.helixcer.chat"
  };
}
__name(mobileAuthConfiguration, "mobileAuthConfiguration");
async function createMobileAuthChallenge(env, payload) {
  if (!env.GOOGLE_CLIENT_ID) throw authError(503, "Google mobile sign-in is not configured.");
  const deviceId = cleanMobileDeviceId(payload?.deviceId);
  const nonce = randomToken(32);
  const now = /* @__PURE__ */ new Date();
  const expiresAt = new Date(now.getTime() + MOBILE_CHALLENGE_TTL_SECONDS * 1e3).toISOString();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM mobile_auth_challenges
      WHERE device_id=?1 OR expires_at<=?2 OR consumed_at IS NOT NULL`).bind(deviceId, now.toISOString()),
    env.DB.prepare(`INSERT INTO mobile_auth_challenges
        (challenge_hash,device_id,expires_at,consumed_at,created_at)
      VALUES (?1,?2,?3,NULL,?4)`).bind(await hashToken(nonce), deviceId, expiresAt, now.toISOString())
  ]);
  return { nonce, expiresAt };
}
__name(createMobileAuthChallenge, "createMobileAuthChallenge");
async function createGoogleMobileSession(env, payload, fetchImpl = fetch) {
  if (!env.GOOGLE_CLIENT_ID) throw authError(503, "Google mobile sign-in is not configured.");
  const idToken = String(payload?.idToken || "").trim();
  if (!idToken || idToken.length > 16384) throw authError(400, "A valid Google ID token is required.");
  const nonce = String(payload?.nonce || "").trim();
  if (nonce.length < 16 || nonce.length > 256) throw authError(400, "A valid sign-in nonce is required.");
  const deviceId = cleanMobileDeviceId(payload?.deviceId);
  const challengeHash = await hashToken(nonce);
  const challenge = await env.DB.prepare(`SELECT challenge_hash FROM mobile_auth_challenges
    WHERE challenge_hash=?1 AND device_id=?2 AND consumed_at IS NULL AND expires_at>?3`).bind(challengeHash, deviceId, (/* @__PURE__ */ new Date()).toISOString()).first();
  if (!challenge) throw authError(401, "The mobile sign-in challenge is invalid, expired, or already used.");
  const invitationToken = String(payload?.invitationToken || payload?.invite || "").trim();
  if (invitationToken.length > 256) throw authError(400, "Invitation token is invalid.");
  const deviceName = cleanDeviceName(payload?.deviceName);
  const identity = await verifyGoogleIdToken(idToken, {
    clientId: env.GOOGLE_CLIENT_ID,
    nonceHash: challengeHash,
    authorizedParties: googleAuthorizedParties(env),
    jwksUrl: env.GOOGLE_JWKS_URL || GOOGLE_JWKS_URL
  }, fetchImpl);
  const consumed = await env.DB.prepare(`UPDATE mobile_auth_challenges SET consumed_at=?3
    WHERE challenge_hash=?1 AND device_id=?2 AND consumed_at IS NULL AND expires_at>?3`).bind(challengeHash, deviceId, (/* @__PURE__ */ new Date()).toISOString()).run();
  if (!consumed?.meta?.changes) throw authError(401, "The mobile sign-in challenge is invalid, expired, or already used.");
  const principal = await provisionVerifiedIdentity(
    env,
    identity,
    invitationToken ? await hashToken(invitationToken) : null
  );
  const session = await createSession(env, principal, { sessionType: "mobile", deviceId });
  await auditAuthAction(env, principal, "login", "session", session.sessionId, {
    authProvider: "google_mobile",
    client: "android",
    packageName: "com.helixcer.chat",
    deviceId,
    ...deviceName ? { deviceName } : {}
  });
  return {
    ok: true,
    token: session.token,
    tokenType: "Bearer",
    expiresAt: session.expiresAt,
    me: principalView(principal)
  };
}
__name(createGoogleMobileSession, "createGoogleMobileSession");
async function provisionVerifiedIdentity(env, identity, invitationTokenHash) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const email = normalizeEmail(identity.email);
  const workspaceId = (await resolveDefaultWorkspace(env)).workspace_id;
  let user = await env.DB.prepare("SELECT * FROM users WHERE google_sub=?1").bind(identity.sub).first();
  const emailOwner = await env.DB.prepare("SELECT user_id,google_sub,password_hash FROM users WHERE lower(email)=?1").bind(email).first();
  if (emailOwner && emailOwner.google_sub !== identity.sub) {
    if (isPasswordPlaceholderSub(emailOwner.google_sub)) {
      user = await env.DB.prepare("SELECT * FROM users WHERE user_id=?1").bind(emailOwner.user_id).first();
      await env.DB.prepare("UPDATE users SET google_sub=?2,updated_at=?3 WHERE user_id=?1").bind(emailOwner.user_id, identity.sub, now).run();
      if (user) user.google_sub = identity.sub;
    } else {
      throw authError(409, "This email is already linked to another Google identity.");
    }
  }
  const existingMembership = user ? await env.DB.prepare(`SELECT workspace_id FROM memberships
        WHERE user_id=?1 AND status='active' ORDER BY created_at LIMIT 1`).bind(user.user_id).first() : null;
  const membershipCount = await env.DB.prepare("SELECT count(*) AS count FROM memberships").first();
  const canBootstrap = Number(membershipCount?.count || 0) === 0 && env.BOOTSTRAP_OWNER_EMAIL && timingSafeEqual(email, normalizeEmail(env.BOOTSTRAP_OWNER_EMAIL));
  let invite = null;
  if (invitationTokenHash) {
    invite = await env.DB.prepare(`SELECT invitation_id,workspace_id FROM invitations
      WHERE token_hash=?1 AND lower(email)=?2 AND status='pending' AND expires_at>?3`).bind(invitationTokenHash, email, now).first();
    if (!invite) throw authError(403, "This invitation is invalid or expired.");
  }
  if (!existingMembership && !canBootstrap && !invite) {
    throw authError(403, "Your account has not been invited to this workspace.");
  }
  let createdUser = false;
  if (!user) {
    const userId = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO users
        (user_id,google_sub,email,display_name,avatar_url,email_verified,last_login_at,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,1,?6,?6,?6)`).bind(userId, identity.sub, email, String(identity.name || "").slice(0, 160), String(identity.picture || "").slice(0, 1e3), now).run();
    user = { user_id: userId, google_sub: identity.sub };
    createdUser = true;
  } else {
    await env.DB.prepare(`UPDATE users SET email=?2,
        display_name=CASE WHEN trim(display_name)='' THEN ?3 ELSE display_name END,
        avatar_url=CASE WHEN trim(avatar_url)='' THEN ?4 ELSE avatar_url END,
        email_verified=1,last_login_at=?5,updated_at=?5
      WHERE user_id=?1`).bind(user.user_id, email, String(identity.name || "").slice(0, 160), String(identity.picture || "").slice(0, 1e3), now).run();
  }
  let selectedWorkspaceId = existingMembership?.workspace_id || "";
  if (canBootstrap) {
    const created = await env.DB.prepare(`INSERT INTO memberships
        (membership_id,workspace_id,user_id,role,status,created_at,updated_at)
      SELECT ?1,?2,?3,'owner','active',?4,?4 WHERE NOT EXISTS (SELECT 1 FROM memberships)`).bind(crypto.randomUUID(), workspaceId, user.user_id, now).run();
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
          allowed_channel_ids_json=excluded.allowed_channel_ids_json`).bind(crypto.randomUUID(), user.user_id, now, invite.invitation_id, invitationTokenHash, email),
      env.DB.prepare(`UPDATE invitations SET status='accepted',accepted_at=?4,updated_at=?4
        WHERE invitation_id=?1 AND token_hash=?2 AND lower(email)=?3
          AND status='pending' AND expires_at>?4`).bind(invite.invitation_id, invitationTokenHash, email, now)
    ]);
    if (!membershipResult?.meta?.changes || !invitationResult?.meta?.changes) {
      if (createdUser) {
        await env.DB.prepare("DELETE FROM users WHERE user_id=?1 AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id=?1)").bind(user.user_id).run();
      }
      throw authError(403, "This invitation is invalid or expired.");
    }
    selectedWorkspaceId = invite.workspace_id;
  }
  const row = await env.DB.prepare(`SELECT u.user_id,u.email,u.display_name,u.avatar_url,u.phone,u.address_line1,
      u.address_line2,u.city,u.state,u.postal_code,u.country,u.password_hash,m.membership_id,m.role,m.status,
      m.allowed_channel_ids_json,w.workspace_id,w.name AS workspace_name,w.slug AS workspace_slug
    FROM users u JOIN memberships m ON m.user_id=u.user_id JOIN workspaces w ON w.workspace_id=m.workspace_id
    WHERE u.user_id=?1 AND m.status='active' AND w.status='active' AND (?2='' OR m.workspace_id=?2)
    ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END LIMIT 1`).bind(user.user_id, selectedWorkspaceId).first();
  if (!row) {
    if (createdUser) {
      await env.DB.prepare("DELETE FROM users WHERE user_id=?1 AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id=?1)").bind(user.user_id).run();
    }
    const suspended = await env.DB.prepare(`SELECT 1 FROM memberships m
      JOIN workspaces w ON w.workspace_id=m.workspace_id
      WHERE m.user_id=?1 AND m.status='active' AND w.status='suspended'`).bind(user.user_id).first();
    if (suspended) throw authError(403, "This workspace has been suspended. Contact Helixcer support.");
    throw authError(403, "Your account has not been invited to this workspace.");
  }
  return principalFromRow(row);
}
__name(provisionVerifiedIdentity, "provisionVerifiedIdentity");
async function createSession(env, principal, options = {}) {
  const token = randomToken(32);
  const maxAge = clampNumber(env.SESSION_TTL_SECONDS, 900, 2592e3, 604800);
  const now = /* @__PURE__ */ new Date();
  const expiresAt = new Date(now.getTime() + maxAge * 1e3).toISOString();
  const sessionId = crypto.randomUUID();
  const sessionType = options.sessionType === "mobile" ? "mobile" : "browser";
  const deviceId = sessionType === "mobile" ? cleanMobileDeviceId(options.deviceId) : null;
  await env.DB.prepare(`INSERT INTO sessions
      (session_id,token_hash,user_id,workspace_id,expires_at,last_seen_at,created_at,session_type,device_id)
    VALUES (?1,?2,?3,?4,?5,?6,?6,?7,?8)`).bind(
    sessionId,
    await hashToken(token),
    principal.user.userId,
    principal.workspace.workspaceId,
    expiresAt,
    now.toISOString(),
    sessionType,
    deviceId
  ).run();
  return { token, maxAge, sessionId, expiresAt };
}
__name(createSession, "createSession");
async function listTeam(env, principal) {
  const { requirePermission: requirePermission2 } = await Promise.resolve().then(() => (init_roles(), roles_exports));
  requirePermission2(principal, "team.manage");
  const [members, invitations] = await Promise.all([
    env.DB.prepare(`SELECT m.membership_id,m.user_id,m.role,m.status,m.created_at,m.allowed_channel_ids_json,
        u.email,u.display_name,u.avatar_url
      FROM memberships m JOIN users u ON u.user_id=m.user_id
      WHERE m.workspace_id=?1 ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END,u.display_name`).bind(principal.workspace.workspaceId).all(),
    env.DB.prepare(`SELECT invitation_id,email,role,status,expires_at,created_at,allowed_channel_ids_json FROM invitations
      WHERE workspace_id=?1 AND status='pending' ORDER BY created_at DESC`).bind(principal.workspace.workspaceId).all()
  ]);
  return {
    members: members.results.map(memberView),
    invitations: invitations.results.map(invitationView)
  };
}
__name(listTeam, "listTeam");
async function createInvitation(request, env, principal, payload) {
  const { assertAssignableRole: assertAssignableRole2, requirePermission: requirePermission2 } = await Promise.resolve().then(() => (init_roles(), roles_exports));
  requirePermission2(principal, "team.manage");
  const email = normalizeEmail(payload.email);
  if (!email || !email.includes("@") || email.length > 254) throw authError(400, "A valid email is required.");
  const role = String(payload.role || "agent");
  const assignable = await assertAssignableRole2(env, principal.workspace.workspaceId, role, { allowOwner: false });
  if (principal.membership.role !== "owner" && assignable.isElevated) {
    throw authError(403, "Only an owner can invite members with elevated workspace access.");
  }
  const allowedChannelIds = await resolveAllowedChannelIds(env, principal.workspace.workspaceId, role, payload, {
    // Chat UI always sends a selection. Omitting the field keeps legacy/API invites unrestricted.
    required: false,
    permissions: assignable.permissions
  });
  const existing = await env.DB.prepare(`SELECT m.membership_id FROM memberships m JOIN users u ON u.user_id=m.user_id
    WHERE m.workspace_id=?1 AND lower(u.email)=?2 AND m.status='active'`).bind(principal.workspace.workspaceId, email).first();
  if (existing) throw authError(409, "This user is already a workspace member.");
  const token = randomToken(32);
  const now = /* @__PURE__ */ new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1e3).toISOString();
  const invitationId = crypto.randomUUID();
  const allowedJson = JSON.stringify(allowedChannelIds);
  await env.DB.batch([
    env.DB.prepare(`UPDATE invitations SET status='cancelled',updated_at=?3
      WHERE workspace_id=?1 AND lower(email)=?2 AND status='pending'`).bind(principal.workspace.workspaceId, email, now.toISOString()),
    env.DB.prepare(`INSERT INTO invitations
        (invitation_id,workspace_id,email,role,token_hash,status,invited_by_user_id,expires_at,created_at,updated_at,allowed_channel_ids_json)
      VALUES (?1,?2,?3,?4,?5,'pending',?6,?7,?8,?8,?9)`).bind(
      invitationId,
      principal.workspace.workspaceId,
      email,
      role,
      await hashToken(token),
      principal.user.userId || null,
      expiresAt,
      now.toISOString(),
      allowedJson
    )
  ]);
  await auditAuthAction(env, principal, "invite", "invitation", invitationId, {
    email,
    role,
    allowedChannelIds
  });
  return {
    ok: true,
    invitation: {
      invitationId,
      email,
      role,
      status: "pending",
      expiresAt,
      createdAt: now.toISOString(),
      allowedChannelIds
    },
    inviteUrl: appInviteUrl(env, token, payload.returnTo || payload.return_to || "/")
  };
}
__name(createInvitation, "createInvitation");
async function updateMembership(env, principal, membershipId, payload) {
  const { assertAssignableRole: assertAssignableRole2, requirePermission: requirePermission2 } = await Promise.resolve().then(() => (init_roles(), roles_exports));
  requirePermission2(principal, "team.manage");
  const target = await env.DB.prepare(`SELECT m.membership_id,m.user_id,m.role,m.status,m.created_at,m.allowed_channel_ids_json,
      u.email,u.display_name,u.avatar_url
    FROM memberships m JOIN users u ON u.user_id=m.user_id WHERE m.membership_id=?1 AND m.workspace_id=?2`).bind(membershipId, principal.workspace.workspaceId).first();
  if (!target) throw authError(404, "Team member not found.");
  const nextRole = payload.role === void 0 ? target.role : String(payload.role);
  const nextStatus = payload.status === void 0 ? target.status : String(payload.status);
  if (!["active", "disabled"].includes(nextStatus)) throw authError(400, "Invalid member status.");
  const nextAssignable = await assertAssignableRole2(env, principal.workspace.workspaceId, nextRole, {
    allowOwner: nextRole === "owner"
  });
  const targetAssignable = await assertAssignableRole2(env, principal.workspace.workspaceId, target.role, {
    allowOwner: target.role === "owner"
  });
  if (principal.membership.role !== "owner") {
    if (targetAssignable.isElevated || nextAssignable.isElevated || nextRole === "owner" || target.role === "owner") {
      throw authError(403, "Administrators can only manage non-elevated team members.");
    }
  }
  const removesOwner = target.role === "owner" && (nextRole !== "owner" || nextStatus !== "active");
  if (removesOwner) {
    const owners = await env.DB.prepare(`SELECT count(*) AS count FROM memberships
      WHERE workspace_id=?1 AND role='owner' AND status='active'`).bind(principal.workspace.workspaceId).first();
    if (Number(owners?.count || 0) <= 1) throw authError(409, "The workspace must retain at least one active owner.");
  }
  let nextAllowedJson = target.allowed_channel_ids_json || "[]";
  const usesChannelAllowList = roleUsesChannelAllowList(nextRole, nextAssignable.permissions);
  if (!usesChannelAllowList) {
    nextAllowedJson = "[]";
  } else if (payload.allowedChannelIds !== void 0 || payload.allowed_channel_ids !== void 0) {
    const allowedChannelIds = await resolveAllowedChannelIds(env, principal.workspace.workspaceId, nextRole, payload, {
      required: true,
      permissions: nextAssignable.permissions
    });
    nextAllowedJson = JSON.stringify(allowedChannelIds);
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const changed = await env.DB.prepare(`UPDATE memberships SET role=?3,status=?4,allowed_channel_ids_json=?5,updated_at=?6
    WHERE membership_id=?1 AND workspace_id=?2 AND (
      role!='owner' OR (?3='owner' AND ?4='active') OR
      (SELECT count(*) FROM memberships WHERE workspace_id=?2 AND role='owner' AND status='active')>1
    )`).bind(membershipId, principal.workspace.workspaceId, nextRole, nextStatus, nextAllowedJson, now).run();
  if (!changed.meta?.changes) throw authError(409, "The workspace must retain at least one active owner.");
  if (nextStatus === "disabled") {
    await env.DB.prepare("UPDATE sessions SET revoked_at=?3 WHERE user_id=?1 AND workspace_id=?2 AND revoked_at IS NULL").bind(target.user_id, principal.workspace.workspaceId, now).run();
  }
  await auditAuthAction(env, principal, "update", "membership", membershipId, {
    targetEmail: target.email,
    previousRole: target.role,
    role: nextRole,
    previousStatus: target.status,
    status: nextStatus,
    allowedChannelIds: parseAllowedChannelIds(nextAllowedJson)
  });
  const updated = { ...target, role: nextRole, status: nextStatus, allowed_channel_ids_json: nextAllowedJson };
  return { ok: true, item: memberView(updated) };
}
__name(updateMembership, "updateMembership");
async function updateInvitation(env, principal, invitationId, payload) {
  const { assertAssignableRole: assertAssignableRole2, requirePermission: requirePermission2 } = await Promise.resolve().then(() => (init_roles(), roles_exports));
  requirePermission2(principal, "team.manage");
  if (payload.status !== "cancelled") throw authError(400, "Only cancellation is supported for pending invitations.");
  const invitation = await env.DB.prepare(`SELECT invitation_id,role,status FROM invitations
    WHERE invitation_id=?1 AND workspace_id=?2`).bind(invitationId, principal.workspace.workspaceId).first();
  if (!invitation || invitation.status !== "pending") throw authError(404, "Pending invitation not found.");
  const inviteRole = await assertAssignableRole2(env, principal.workspace.workspaceId, invitation.role, { allowOwner: false });
  if (principal.membership.role !== "owner" && inviteRole.isElevated) {
    throw authError(403, "Only an owner can cancel an elevated invitation.");
  }
  await env.DB.prepare("UPDATE invitations SET status='cancelled',updated_at=?3 WHERE invitation_id=?1 AND workspace_id=?2").bind(invitationId, principal.workspace.workspaceId, (/* @__PURE__ */ new Date()).toISOString()).run();
  await auditAuthAction(env, principal, "cancel", "invitation", invitationId, {});
  return { ok: true, invitationId, status: "cancelled" };
}
__name(updateInvitation, "updateInvitation");
function restrictedChannelIds(principal) {
  if (!principal?.membership) return null;
  if (!roleUsesChannelAllowList(principal.membership.role, principal.permissions)) return null;
  const ids = Array.isArray(principal.membership.allowedChannelIds) ? principal.membership.allowedChannelIds : parseAllowedChannelIds(principal.membership.allowedChannelIdsJson);
  return ids.length ? ids : null;
}
__name(restrictedChannelIds, "restrictedChannelIds");
function roleUsesChannelAllowList(role, permissions = null) {
  const key = String(role || "");
  if (!key || key === "owner" || key === "admin") return false;
  if (permissions?.channels?.manage) return false;
  return true;
}
__name(roleUsesChannelAllowList, "roleUsesChannelAllowList");
function parseAllowedChannelIds(value) {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.map((item) => String(item || "").trim()).filter(Boolean))];
}
__name(parseAllowedChannelIds, "parseAllowedChannelIds");
async function resolveAllowedChannelIds(env, workspaceId, role, payload = {}, options = {}) {
  if (!roleUsesChannelAllowList(role, options.permissions)) return [];
  const raw = payload.allowedChannelIds ?? payload.allowed_channel_ids;
  if (raw === void 0 || raw === null) {
    if (options.required) throw authError(400, "Select at least one messaging channel for this agent.");
    return [];
  }
  if (!Array.isArray(raw)) throw authError(400, "allowedChannelIds must be an array of channel IDs.");
  const ids = parseAllowedChannelIds(raw);
  if (!ids.length) throw authError(400, "Select at least one messaging channel for this agent.");
  if (ids.length > 200) throw authError(400, "Too many messaging channels were selected.");
  for (const id of ids) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(id)) {
      throw authError(400, "One or more selected channel IDs are invalid.");
    }
  }
  const result = await env.DB.prepare("SELECT channel_id FROM channels WHERE workspace_id=?1").bind(workspaceId).all();
  const known = new Set((result.results || []).map((row) => row.channel_id));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length) throw authError(400, "One or more selected channels were not found in this workspace.");
  return ids;
}
__name(resolveAllowedChannelIds, "resolveAllowedChannelIds");
function principalView(principal) {
  return {
    authenticated: true,
    user: {
      ...principal.user,
      hasPassword: Boolean(principal.user?.hasPassword)
    },
    workspace: principal.workspace,
    membership: {
      ...principal.membership,
      allowedChannelIds: Array.isArray(principal.membership?.allowedChannelIds) ? principal.membership.allowedChannelIds : []
    },
    permissions: principal.permissions || null,
    hasPassword: Boolean(principal.user?.hasPassword)
  };
}
__name(principalView, "principalView");
async function verifyGoogleIdToken(idToken, options, fetchImpl = fetch) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw authError(401, "Invalid Google ID token.");
  let header;
  let payload;
  try {
    header = JSON.parse(decoder.decode(base64UrlDecode(parts[0])));
    payload = JSON.parse(decoder.decode(base64UrlDecode(parts[1])));
  } catch {
    throw authError(401, "Invalid Google ID token encoding.");
  }
  if (header.alg !== "RS256" || !header.kid) throw authError(401, "Unsupported Google ID token signature.");
  const jwksUrl = options.jwksUrl || GOOGLE_JWKS_URL;
  let keys = await getGoogleJwks(jwksUrl, fetchImpl);
  let jwk = keys.find((item) => item.kid === header.kid && item.kty === "RSA" && (!item.alg || item.alg === "RS256") && (!item.use || item.use === "sig"));
  if (!jwk) {
    keys = await getGoogleJwks(jwksUrl, fetchImpl, true);
    jwk = keys.find((item) => item.kid === header.kid && item.kty === "RSA" && (!item.alg || item.alg === "RS256") && (!item.use || item.use === "sig"));
  }
  if (!jwk) throw authError(401, "Google signing key not found.");
  const publicKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const validSignature = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, base64UrlDecode(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
  if (!validSignature) throw authError(401, "Invalid Google ID token signature.");
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1e3);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(options.clientId)) throw authError(401, "Google ID token audience mismatch.");
  const authorizedParties = new Set(options.authorizedParties || [options.clientId]);
  if (payload.azp && !authorizedParties.has(payload.azp)) throw authError(401, "Google ID token authorized-party mismatch.");
  if (!GOOGLE_ISSUERS.has(payload.iss)) throw authError(401, "Google ID token issuer mismatch.");
  if (!Number.isFinite(payload.exp) || payload.exp <= now - 30) throw authError(401, "Google ID token expired.");
  if (payload.nbf !== void 0 && (!Number.isFinite(payload.nbf) || payload.nbf > now + 30)) throw authError(401, "Google ID token is not active yet.");
  if (payload.iat !== void 0 && (!Number.isFinite(payload.iat) || payload.iat > now + 300)) throw authError(401, "Google ID token issued in the future.");
  if (options.nonceHash && (!payload.nonce || !timingSafeEqual(await hashToken(payload.nonce), options.nonceHash))) throw authError(401, "Google ID token nonce mismatch.");
  if (!(payload.email_verified === true || payload.email_verified === "true")) throw authError(403, "Google email is not verified.");
  if (!payload.sub || !payload.email) throw authError(401, "Google identity is incomplete.");
  return {
    sub: String(payload.sub),
    email: normalizeEmail(payload.email),
    name: String(payload.name || ""),
    picture: String(payload.picture || ""),
    emailVerified: true
  };
}
__name(verifyGoogleIdToken, "verifyGoogleIdToken");
async function getGoogleJwks(url, fetchImpl, forceRefresh = false) {
  const now = Date.now();
  const cached = jwksCache.get(url);
  if (!forceRefresh && cached && cached.expiresAt > now) return cached.keys;
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw authError(503, "Unable to load Google signing keys.");
  const body = await response.json();
  if (!Array.isArray(body.keys)) throw authError(503, "Google signing keys response is invalid.");
  const maxAge = parseCacheMaxAge(response.headers.get("Cache-Control")) || 3600;
  jwksCache.set(url, { keys: body.keys, expiresAt: now + Math.min(maxAge, 21600) * 1e3 });
  return body.keys;
}
__name(getGoogleJwks, "getGoogleJwks");
async function auditAuthAction(env, principal, action, targetType, targetId, details) {
  await env.DB.prepare(`INSERT INTO audit_log
      (audit_id,actor,action,target_type,target_id,details_json,timestamp,workspace_id,actor_user_id,actor_email)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?2)`).bind(
    crypto.randomUUID(),
    principal.user.email,
    action,
    targetType,
    targetId,
    JSON.stringify(details || {}),
    (/* @__PURE__ */ new Date()).toISOString(),
    principal.workspace.workspaceId,
    principal.user.userId || ""
  ).run();
}
__name(auditAuthAction, "auditAuthAction");
async function recoveryPrincipal(request, env) {
  if (String(env.RECOVERY_MODE || "").toLowerCase() !== "true" || !env.ADMIN_TOKEN) return null;
  const header = request.headers.get("Authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const direct = request.headers.get("X-Admin-Token") || "";
  if (!timingSafeEqual(bearer || direct, env.ADMIN_TOKEN)) return null;
  const workspace = await resolveDefaultWorkspace(env);
  return {
    authType: "recovery",
    user: {
      userId: "",
      email: "emergency-recovery",
      displayName: "Emergency recovery",
      avatarUrl: "",
      phone: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      state: "",
      postalCode: "",
      country: ""
    },
    workspace: { workspaceId: workspace.workspace_id, name: workspace.name, slug: workspace.slug },
    membership: { membershipId: "", role: "owner", status: "active" }
  };
}
__name(recoveryPrincipal, "recoveryPrincipal");
async function resolveDefaultWorkspace(env) {
  const configured = String(env.DEFAULT_WORKSPACE_ID || "").trim();
  let workspace = configured ? await env.DB.prepare("SELECT workspace_id,name,slug FROM workspaces WHERE workspace_id=?1 LIMIT 1").bind(configured).first() : null;
  if (!workspace) {
    workspace = await env.DB.prepare(`SELECT workspace_id,name,slug FROM workspaces
      WHERE kind='internal' ORDER BY created_at LIMIT 1`).first();
  }
  if (!workspace) {
    const result = await env.DB.prepare("SELECT workspace_id,name,slug FROM workspaces ORDER BY created_at,workspace_id LIMIT 2").all();
    if ((result.results || []).length === 1) workspace = result.results[0];
  }
  if (!workspace) throw authError(503, "The workspace is not configured.");
  return workspace;
}
__name(resolveDefaultWorkspace, "resolveDefaultWorkspace");
function principalFromRow(row, authType = "session") {
  const allowedChannelIds = parseAllowedChannelIds(row.allowed_channel_ids_json);
  return {
    authType,
    sessionId: row.session_id || "",
    sessionExpiresAt: row.expires_at || "",
    deviceId: row.device_id || "",
    user: {
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      phone: row.phone || "",
      addressLine1: row.address_line1 || "",
      addressLine2: row.address_line2 || "",
      city: row.city || "",
      state: row.state || "",
      postalCode: row.postal_code || "",
      country: row.country || "",
      hasPassword: Boolean(row.password_hash)
    },
    workspace: { workspaceId: row.workspace_id, name: row.workspace_name, slug: row.workspace_slug },
    membership: {
      membershipId: row.membership_id,
      role: row.role,
      status: row.status,
      allowedChannelIds
    }
  };
}
__name(principalFromRow, "principalFromRow");
function cleanProfileText(value, label, maxLength, { required = false } = {}) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) {
    if (required) throw authError(400, `${label} is required.`);
    return "";
  }
  if (text.length > maxLength) throw authError(400, `${label} must be ${maxLength} characters or fewer.`);
  return text;
}
__name(cleanProfileText, "cleanProfileText");
function cleanProfilePhone(value) {
  const phone = String(value ?? "").trim();
  if (!phone) return "";
  if (phone.length > 32) throw authError(400, "Phone number must be 32 characters or fewer.");
  if (!/^\+?[0-9()\s.-]{6,32}$/.test(phone)) {
    throw authError(400, "Enter a phone number with country code, for example +91 98765 43210.");
  }
  return phone.replace(/\s+/g, " ");
}
__name(cleanProfilePhone, "cleanProfilePhone");
async function updateUserProfile(env, principal, payload = {}) {
  if (!principal?.user?.userId) {
    throw authError(403, "A signed-in account is required to update your profile.");
  }
  if (!["session", "mobile_session"].includes(principal.authType)) {
    throw authError(403, "A verified session is required to update your profile.");
  }
  const body = payload && typeof payload === "object" ? payload : {};
  const displayName = cleanProfileText(body.displayName ?? body.name, "Name", 120, { required: true });
  const phone = cleanProfilePhone(body.phone ?? body.phoneNumber);
  const addressLine1 = cleanProfileText(body.addressLine1, "Address line 1", 180);
  const addressLine2 = cleanProfileText(body.addressLine2, "Address line 2", 180);
  const city = cleanProfileText(body.city, "City", 100);
  const region = cleanProfileText(body.state, "State / region", 100);
  const postalCode = cleanProfileText(body.postalCode, "Postal code", 24);
  const country = cleanProfileText(body.country, "Country", 100);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(`UPDATE users SET display_name=?2,phone=?3,address_line1=?4,address_line2=?5,
      city=?6,state=?7,postal_code=?8,country=?9,updated_at=?10
    WHERE user_id=?1`).bind(principal.user.userId, displayName, phone, addressLine1, addressLine2, city, region, postalCode, country, now).run();
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
  await auditAuthAction(env, { ...principal, user }, "profile.updated", "user", principal.user.userId, {
    fields: ["displayName", "phone", "address"]
  });
  return { ...principal, user };
}
__name(updateUserProfile, "updateUserProfile");
var PASSWORD_MIN_LENGTH = 8;
var PASSWORD_MAX_LENGTH = 128;
var PASSWORD_PBKDF2_ITERATIONS = 6e5;
var PASSWORD_RESET_TTL_SECONDS = 60 * 60;
async function previewInvitation(env, token) {
  const raw = String(token || "").trim();
  if (!raw || raw.length > 256) throw authError(400, "Invitation token is invalid.");
  const invite = await env.DB.prepare(`SELECT email,expires_at FROM invitations
    WHERE token_hash=?1 AND status='pending' AND expires_at>?2`).bind(await hashToken(raw), (/* @__PURE__ */ new Date()).toISOString()).first();
  if (!invite) throw authError(404, "This invitation is invalid or expired.");
  return { email: normalizeEmail(invite.email), expiresAt: invite.expires_at };
}
__name(previewInvitation, "previewInvitation");
async function loginWithPassword(env, payload = {}) {
  const email = normalizeEmail(payload.email);
  const password = String(payload.password ?? "");
  if (!email || !email.includes("@") || email.length > 254) throw authError(400, "A valid email is required.");
  if (!password) throw authError(400, "Password is required.");
  const user = await env.DB.prepare(`SELECT user_id,email,password_hash FROM users WHERE lower(email)=?1`).bind(email).first();
  if (!user?.password_hash) throw authError(401, "Invalid email or password.");
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) throw authError(401, "Invalid email or password.");
  const principal = await activePrincipalForUser(env, user.user_id);
  if (!principal) throw authError(403, "Your account has not been invited to this workspace.");
  const session = await createSession(env, principal);
  await env.DB.prepare("UPDATE users SET last_login_at=?2,updated_at=?2 WHERE user_id=?1").bind(user.user_id, (/* @__PURE__ */ new Date()).toISOString()).run();
  await auditAuthAction(env, principal, "login", "session", session.sessionId, { authProvider: "password" });
  return sessionResponse(session, principal);
}
__name(loginWithPassword, "loginWithPassword");
async function requestPasswordReset(env, payload = {}) {
  const email = normalizeEmail(payload.email);
  const generic = { ok: true };
  if (!email || !email.includes("@") || email.length > 254) return generic;
  const now = /* @__PURE__ */ new Date();
  const nowIso = now.toISOString();
  const user = await env.DB.prepare(`SELECT u.user_id,u.email FROM users u
      JOIN memberships m ON m.user_id=u.user_id
      JOIN workspaces w ON w.workspace_id=m.workspace_id
    WHERE lower(u.email)=?1 AND m.status='active' AND w.status='active'
    ORDER BY u.created_at LIMIT 1`).bind(email).first();
  const invite = user ? null : await env.DB.prepare(`SELECT invitation_id,email FROM invitations
        WHERE lower(email)=?1 AND status='pending' AND expires_at>?2
        ORDER BY created_at DESC LIMIT 1`).bind(email, nowIso).first();
  if (!user && !invite) return generic;
  const token = randomToken(32);
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_SECONDS * 1e3).toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE password_reset_tokens SET consumed_at=?2
      WHERE lower(email)=?1 AND consumed_at IS NULL`).bind(email, nowIso),
    env.DB.prepare(`INSERT INTO password_reset_tokens
        (token_hash,email,user_id,invitation_id,expires_at,consumed_at,created_at)
      VALUES (?1,?2,?3,?4,?5,NULL,?6)`).bind(await hashToken(token), email, user?.user_id || null, invite?.invitation_id || null, expiresAt, nowIso)
  ]);
  const resetUrl = appResetUrl(env, token);
  try {
    const { sendTransactionalEmail: sendTransactionalEmail2, passwordResetEmailContent: passwordResetEmailContent2 } = await Promise.resolve().then(() => (init_mail(), mail_exports));
    const content = passwordResetEmailContent2(resetUrl);
    await sendTransactionalEmail2(env, { to: email, ...content });
  } catch (error) {
    console.error("password_reset_email_failed", {
      code: error?.code || "",
      message: error?.message || "Unknown email failure"
    });
  }
  return generic;
}
__name(requestPasswordReset, "requestPasswordReset");
async function resetPasswordWithToken(env, payload = {}) {
  const token = String(payload.token || payload.resetToken || "").trim();
  if (!token || token.length > 256) throw authError(400, "This reset link is invalid or expired.");
  const password = cleanNewPassword(payload.password ?? payload.newPassword);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const tokenHash = await hashToken(token);
  const row = await env.DB.prepare(`SELECT token_hash,email,user_id,invitation_id,expires_at
    FROM password_reset_tokens WHERE token_hash=?1 AND consumed_at IS NULL AND expires_at>?2`).bind(tokenHash, now).first();
  if (!row) throw authError(400, "This reset link is invalid or expired.");
  const passwordHash = await hashPassword(password);
  let userId = row.user_id || "";
  if (userId) {
    await env.DB.prepare("UPDATE users SET password_hash=?2,updated_at=?3 WHERE user_id=?1").bind(userId, passwordHash, now).run();
  } else if (row.invitation_id) {
    const created = await createUserFromInvitation(env, {
      invitationId: row.invitation_id,
      email: row.email,
      passwordHash,
      now
    });
    userId = created.userId;
  } else {
    throw authError(400, "This reset link is invalid or expired.");
  }
  await env.DB.prepare("UPDATE password_reset_tokens SET consumed_at=?2 WHERE token_hash=?1").bind(tokenHash, now).run();
  await env.DB.prepare(`UPDATE password_reset_tokens SET consumed_at=?2
    WHERE lower(email)=?1 AND consumed_at IS NULL`).bind(normalizeEmail(row.email), now).run();
  const principal = await activePrincipalForUser(env, userId);
  if (!principal) throw authError(403, "Your account has not been invited to this workspace.");
  const session = await createSession(env, principal);
  await env.DB.prepare("UPDATE users SET last_login_at=?2,updated_at=?2 WHERE user_id=?1").bind(userId, now).run();
  await auditAuthAction(env, principal, "password.reset", "user", userId, { authProvider: "password_reset" });
  await auditAuthAction(env, principal, "login", "session", session.sessionId, { authProvider: "password_reset" });
  return sessionResponse(session, principal);
}
__name(resetPasswordWithToken, "resetPasswordWithToken");
async function acceptInvitationWithPassword(env, payload = {}) {
  const inviteToken = String(payload.invite || payload.invitationToken || payload.token || "").trim();
  if (!inviteToken || inviteToken.length > 256) throw authError(400, "Invitation token is invalid.");
  const password = cleanNewPassword(payload.password ?? payload.newPassword);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const invitationTokenHash = await hashToken(inviteToken);
  const invite = await env.DB.prepare(`SELECT invitation_id,email,workspace_id FROM invitations
    WHERE token_hash=?1 AND status='pending' AND expires_at>?2`).bind(invitationTokenHash, now).first();
  if (!invite) throw authError(403, "This invitation is invalid or expired.");
  const email = normalizeEmail(invite.email);
  const existing = await env.DB.prepare("SELECT user_id,password_hash,google_sub FROM users WHERE lower(email)=?1").bind(email).first();
  let userId = existing?.user_id || "";
  const passwordHash = await hashPassword(password);
  if (existing) {
    await env.DB.prepare("UPDATE users SET password_hash=?2,updated_at=?3 WHERE user_id=?1").bind(existing.user_id, passwordHash, now).run();
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
  if (!principal) throw authError(403, "Your account has not been invited to this workspace.");
  const session = await createSession(env, principal);
  await env.DB.prepare("UPDATE users SET last_login_at=?2,updated_at=?2 WHERE user_id=?1").bind(userId, now).run();
  await auditAuthAction(env, principal, "login", "session", session.sessionId, { authProvider: "password_invite" });
  return sessionResponse(session, principal);
}
__name(acceptInvitationWithPassword, "acceptInvitationWithPassword");
async function changePassword(env, principal, payload = {}) {
  if (!principal?.user?.userId) {
    throw authError(403, "A signed-in account is required to change your password.");
  }
  if (!["session", "mobile_session"].includes(principal.authType)) {
    throw authError(403, "A verified session is required to change your password.");
  }
  const row = await env.DB.prepare("SELECT password_hash FROM users WHERE user_id=?1").bind(principal.user.userId).first();
  if (!row) throw authError(404, "Account not found.");
  const hasPassword = Boolean(row.password_hash);
  const currentPassword = String(payload.currentPassword ?? payload.password ?? "");
  if (hasPassword) {
    if (!currentPassword) throw authError(400, "Current password is required.");
    const valid = await verifyPassword(currentPassword, row.password_hash);
    if (!valid) throw authError(401, "Current password is incorrect.");
  }
  const nextPassword = cleanNewPassword(payload.newPassword ?? payload.passwordNew);
  if (hasPassword && currentPassword === nextPassword) {
    throw authError(400, "Choose a different new password.");
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare("UPDATE users SET password_hash=?2,updated_at=?3 WHERE user_id=?1").bind(principal.user.userId, await hashPassword(nextPassword), now).run();
  await auditAuthAction(env, principal, hasPassword ? "password.changed" : "password.set", "user", principal.user.userId, {});
  return {
    ok: true,
    ...principalView({
      ...principal,
      user: { ...principal.user, hasPassword: true }
    })
  };
}
__name(changePassword, "changePassword");
async function createUserFromInvitation(env, {
  invitationId,
  invitationTokenHash = null,
  email,
  passwordHash,
  now
}) {
  const invite = await env.DB.prepare(`SELECT invitation_id,workspace_id,token_hash,email FROM invitations
    WHERE invitation_id=?1 AND status='pending' AND expires_at>?2`).bind(invitationId, now).first();
  if (!invite || normalizeEmail(invite.email) !== normalizeEmail(email)) {
    throw authError(403, "This invitation is invalid or expired.");
  }
  const tokenHash = invitationTokenHash || invite.token_hash;
  const userId = crypto.randomUUID();
  const googleSub = passwordPlaceholderSub(userId);
  await env.DB.prepare(`INSERT INTO users
      (user_id,google_sub,email,display_name,avatar_url,email_verified,password_hash,last_login_at,created_at,updated_at)
    VALUES (?1,?2,?3,'', '',1,?4,?5,?5,?5)`).bind(userId, googleSub, normalizeEmail(email), passwordHash, now).run();
  try {
    await acceptPendingInvitation(env, {
      invitationId: invite.invitation_id,
      invitationTokenHash: tokenHash,
      email: normalizeEmail(email),
      userId,
      now
    });
  } catch (error) {
    await env.DB.prepare("DELETE FROM users WHERE user_id=?1 AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id=?1)").bind(userId).run();
    throw error;
  }
  return { userId };
}
__name(createUserFromInvitation, "createUserFromInvitation");
async function acceptPendingInvitation(env, { invitationId, invitationTokenHash, email, userId, now }) {
  const [membershipResult, invitationResult] = await env.DB.batch([
    env.DB.prepare(`INSERT INTO memberships
        (membership_id,workspace_id,user_id,role,status,invited_by_user_id,created_at,updated_at,allowed_channel_ids_json)
      SELECT ?1,i.workspace_id,?2,i.role,'active',i.invited_by_user_id,?3,?3,i.allowed_channel_ids_json
      FROM invitations i
      WHERE i.invitation_id=?4 AND i.token_hash=?5 AND lower(i.email)=?6
        AND i.status='pending' AND i.expires_at>?3
      ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role,status='active',
        invited_by_user_id=excluded.invited_by_user_id,updated_at=excluded.updated_at,
        allowed_channel_ids_json=excluded.allowed_channel_ids_json`).bind(crypto.randomUUID(), userId, now, invitationId, invitationTokenHash, normalizeEmail(email)),
    env.DB.prepare(`UPDATE invitations SET status='accepted',accepted_at=?4,updated_at=?4
      WHERE invitation_id=?1 AND token_hash=?2 AND lower(email)=?3
        AND status='pending' AND expires_at>?4`).bind(invitationId, invitationTokenHash, normalizeEmail(email), now)
  ]);
  if (!membershipResult?.meta?.changes || !invitationResult?.meta?.changes) {
    throw authError(403, "This invitation is invalid or expired.");
  }
}
__name(acceptPendingInvitation, "acceptPendingInvitation");
async function activePrincipalForUser(env, userId, preferredWorkspaceId = "") {
  const row = await env.DB.prepare(`SELECT u.user_id,u.email,u.display_name,u.avatar_url,u.phone,u.address_line1,
      u.address_line2,u.city,u.state,u.postal_code,u.country,u.password_hash,m.membership_id,m.role,m.status,
      m.allowed_channel_ids_json,w.workspace_id,w.name AS workspace_name,w.slug AS workspace_slug
    FROM users u JOIN memberships m ON m.user_id=u.user_id JOIN workspaces w ON w.workspace_id=m.workspace_id
    WHERE u.user_id=?1 AND m.status='active' AND w.status='active' AND (?2='' OR m.workspace_id=?2)
    ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END LIMIT 1`).bind(userId, preferredWorkspaceId || "").first();
  if (!row) {
    const suspended = await env.DB.prepare(`SELECT 1 FROM memberships m
      JOIN workspaces w ON w.workspace_id=m.workspace_id
      WHERE m.user_id=?1 AND m.status='active' AND w.status='suspended'`).bind(userId).first();
    if (suspended) throw authError(403, "This workspace has been suspended. Contact Helixcer support.");
    return null;
  }
  return principalFromRow(row);
}
__name(activePrincipalForUser, "activePrincipalForUser");
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
__name(sessionResponse, "sessionResponse");
function appInviteUrl(env, token, returnTo = "/") {
  const base = String(env.APP_ORIGIN || "").trim() || "https://chat.helixcer.com";
  const url = new URL(base.endsWith("/") ? base : `${base}/`);
  url.searchParams.set("invite", token);
  try {
    const safeReturn = validateReturnTo(returnTo, env);
    const returnUrl = new URL(safeReturn);
    if (returnUrl.hash) url.hash = returnUrl.hash;
  } catch {
  }
  return url.toString();
}
__name(appInviteUrl, "appInviteUrl");
function appResetUrl(env, token) {
  const base = String(env.APP_ORIGIN || "").trim() || "https://chat.helixcer.com";
  const url = new URL(base.endsWith("/") ? base : `${base}/`);
  url.searchParams.set("reset", token);
  return url.toString();
}
__name(appResetUrl, "appResetUrl");
function cleanNewPassword(value) {
  const password = String(value ?? "");
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw authError(400, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw authError(400, `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`);
  }
  if (/\s/.test(password)) throw authError(400, "Password cannot contain spaces.");
  return password;
}
__name(cleanNewPassword, "cleanNewPassword");
function passwordPlaceholderSub(userId) {
  return `password:${userId}`;
}
__name(passwordPlaceholderSub, "passwordPlaceholderSub");
function isPasswordPlaceholderSub(value) {
  return String(value || "").startsWith("password:");
}
__name(isPasswordPlaceholderSub, "isPasswordPlaceholderSub");
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PASSWORD_PBKDF2_ITERATIONS },
    key,
    256
  );
  return `pbkdf2-sha256$${PASSWORD_PBKDF2_ITERATIONS}$${base64UrlEncode(salt)}$${base64UrlEncode(new Uint8Array(bits))}`;
}
__name(hashPassword, "hashPassword");
async function verifyPassword(password, encoded) {
  const parts = String(encoded || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;
  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 1e4 || iterations > 5e6) return false;
  let salt;
  let expected;
  try {
    salt = base64UrlDecode(parts[2]);
    expected = base64UrlDecode(parts[3]);
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    expected.length * 8
  );
  return timingSafeEqualBytes(new Uint8Array(bits), expected);
}
__name(verifyPassword, "verifyPassword");
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
__name(timingSafeEqualBytes, "timingSafeEqualBytes");
function memberView(row) {
  return {
    membershipId: row.membership_id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    allowedChannelIds: parseAllowedChannelIds(row.allowed_channel_ids_json)
  };
}
__name(memberView, "memberView");
function invitationView(row) {
  return {
    invitationId: row.invitation_id,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    allowedChannelIds: parseAllowedChannelIds(row.allowed_channel_ids_json)
  };
}
__name(invitationView, "invitationView");
function validateReturnTo(value, env) {
  const configuredOrigins = String(env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (env.APP_ORIGIN) configuredOrigins.push(new URL(env.APP_ORIGIN).origin);
  const base = env.APP_ORIGIN || configuredOrigins[0];
  if (!base) throw authError(503, "APP_ORIGIN or ALLOWED_ORIGINS must be configured.");
  const raw = String(value || "/");
  if (raw.length > 2048) throw authError(400, "Return URL is too long.");
  let target;
  try {
    target = raw.startsWith("/") ? new URL(raw, base) : new URL(raw);
  } catch {
    throw authError(400, "Invalid return URL.");
  }
  if (!configuredOrigins.includes(target.origin)) throw authError(400, "Return URL origin is not allowed.");
  if (!["http:", "https:"].includes(target.protocol)) throw authError(400, "Return URL protocol is not allowed.");
  return target.toString();
}
__name(validateReturnTo, "validateReturnTo");
function googleRedirectUri(request, env) {
  return env.GOOGLE_REDIRECT_URI || new URL("/auth/google/callback", request.url).toString();
}
__name(googleRedirectUri, "googleRedirectUri");
function requireOAuthConfig(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw authError(503, "Google OAuth is not configured.");
}
__name(requireOAuthConfig, "requireOAuthConfig");
function oauthFailureView(error) {
  const status = Number(error?.status) || 500;
  if (status === 400) {
    return {
      status,
      code: "invalid_or_expired_sign_in",
      message: "This sign-in link is invalid or expired. Please start Google sign-in again."
    };
  }
  if (status === 401) {
    return {
      status,
      code: "google_sign_in_failed",
      message: error?.message === "Google sign-in was cancelled or denied." ? "Google sign-in was cancelled or denied." : "Google sign-in could not be completed. Please try again."
    };
  }
  if (status === 403) {
    return {
      status,
      code: "workspace_access_denied",
      message: "This Google account does not have access to this workspace. Ask the workspace owner to invite it."
    };
  }
  if (status === 409) {
    return {
      status,
      code: "google_account_conflict",
      message: "This email is already linked to another Google account. Contact the workspace owner."
    };
  }
  return {
    status,
    code: "google_sign_in_unavailable",
    message: "Google sign-in is temporarily unavailable. Please try again."
  };
}
__name(oauthFailureView, "oauthFailureView");
function oauthFailureTarget(env) {
  const candidates = [env.APP_ORIGIN, ...String(env.ALLOWED_ORIGINS || "").split(",")].map((value) => String(value || "").trim()).filter(Boolean);
  for (const candidate of candidates) {
    try {
      const target = new URL(candidate);
      if (target.protocol === "https:" || target.protocol === "http:") return target;
    } catch {
    }
  }
  return null;
}
__name(oauthFailureTarget, "oauthFailureTarget");
function oauthFailurePage(failure, expiredCookie) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Helixcer sign-in</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f5f1;color:#172321;font:16px/1.5 system-ui,sans-serif}.card{width:min(520px,calc(100% - 40px));box-sizing:border-box;padding:36px;border:1px solid #d9dfdb;border-radius:24px;background:#fff;box-shadow:0 20px 55px #17232118}.mark{display:grid;place-items:center;width:52px;height:52px;border-radius:15px;background:linear-gradient(145deg,#263cff,#aa00d6 58%,#ee006a);color:#fff;font-size:28px;font-weight:800}h1{margin:22px 0 10px;font-size:30px;line-height:1.15}p{margin:0;color:#596561}</style></head><body><main class="card"><div class="mark">H</div><h1>Sign-in could not be completed</h1><p>${escapeHtml2(failure.message)}</p></main></body></html>`;
  return new Response(html, {
    status: failure.status >= 500 ? 503 : failure.status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": expiredCookie
    }
  });
}
__name(oauthFailurePage, "oauthFailurePage");
function escapeHtml2(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}
__name(escapeHtml2, "escapeHtml");
function cookieHeader(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}
__name(cookieHeader, "cookieHeader");
function clearCookieHeader(name) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
__name(clearCookieHeader, "clearCookieHeader");
function readCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return "";
      }
    }
  }
  return "";
}
__name(readCookie, "readCookie");
function sessionCredential(request) {
  const cookie = readCookie(request, SESSION_COOKIE);
  if (cookie) return { token: cookie, source: "cookie" };
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return { token: "", source: "" };
  const token = authorization.slice(7).trim();
  return token ? { token, source: "bearer" } : { token: "", source: "" };
}
__name(sessionCredential, "sessionCredential");
function cleanDeviceName(value) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}
__name(cleanDeviceName, "cleanDeviceName");
function cleanMobileDeviceId(value) {
  const deviceId = String(value || "").trim();
  if (!MOBILE_DEVICE_ID_PATTERN.test(deviceId)) throw authError(400, "A valid mobile device ID is required.");
  return deviceId;
}
__name(cleanMobileDeviceId, "cleanMobileDeviceId");
function googleAuthorizedParties(env) {
  return [env.GOOGLE_CLIENT_ID, ...String(env.GOOGLE_ANDROID_CLIENT_IDS || "").split(",").map((value) => value.trim()).filter(Boolean)];
}
__name(googleAuthorizedParties, "googleAuthorizedParties");
async function hashToken(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(hashToken, "hashToken");
async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}
__name(pkceChallenge, "pkceChallenge");
function randomToken(bytes) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64UrlEncode(value);
}
__name(randomToken, "randomToken");
function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(base64UrlEncode, "base64UrlEncode");
function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
__name(base64UrlDecode, "base64UrlDecode");
function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}
__name(normalizeEmail, "normalizeEmail");
function parseCacheMaxAge(value) {
  const match = String(value || "").match(/(?:^|,)\s*max-age=(\d+)/i);
  return match ? Number(match[1]) : 0;
}
__name(parseCacheMaxAge, "parseCacheMaxAge");
function clampNumber(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}
__name(clampNumber, "clampNumber");
function authError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
__name(authError, "authError");
function timingSafeEqual(left, right) {
  const a = encoder.encode(String(left));
  const b = encoder.encode(String(right));
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) mismatch |= (a[index % (a.length || 1)] || 0) ^ (b[index % (b.length || 1)] || 0);
  return mismatch === 0;
}
__name(timingSafeEqual, "timingSafeEqual");

// worker/src/index.js
init_roles();

// worker/node_modules/uint8array-extras/index.js
var objectToString = Object.prototype.toString;
var uint8ArrayStringified = "[object Uint8Array]";
var arrayBufferStringified = "[object ArrayBuffer]";
function isType(value, typeConstructor, typeStringified) {
  if (!value) {
    return false;
  }
  if (value.constructor === typeConstructor) {
    return true;
  }
  return objectToString.call(value) === typeStringified;
}
__name(isType, "isType");
function isUint8Array(value) {
  return isType(value, Uint8Array, uint8ArrayStringified);
}
__name(isUint8Array, "isUint8Array");
function isArrayBuffer(value) {
  return isType(value, ArrayBuffer, arrayBufferStringified);
}
__name(isArrayBuffer, "isArrayBuffer");
function isUint8ArrayOrArrayBuffer(value) {
  return isUint8Array(value) || isArrayBuffer(value);
}
__name(isUint8ArrayOrArrayBuffer, "isUint8ArrayOrArrayBuffer");
function toUint8ArrayIfArrayBuffer(value) {
  return isArrayBuffer(value) ? new Uint8Array(value) : value;
}
__name(toUint8ArrayIfArrayBuffer, "toUint8ArrayIfArrayBuffer");
function assertUint8ArrayOrArrayBuffer(value) {
  if (!isUint8ArrayOrArrayBuffer(value)) {
    throw new TypeError(`Expected \`Uint8Array\` or \`ArrayBuffer\`, got \`${typeof value}\``);
  }
}
__name(assertUint8ArrayOrArrayBuffer, "assertUint8ArrayOrArrayBuffer");
function toUint8Array(value) {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError(`Unsupported value, got \`${typeof value}\`.`);
}
__name(toUint8Array, "toUint8Array");
function concatUint8Arrays(arrays, totalLength) {
  if (arrays.length === 0) {
    return new Uint8Array(0);
  }
  totalLength ??= arrays.reduce((accumulator, currentValue) => accumulator + currentValue.byteLength, 0);
  const returnValue = new Uint8Array(totalLength);
  let offset = 0;
  for (let array of arrays) {
    assertUint8ArrayOrArrayBuffer(array);
    array = toUint8ArrayIfArrayBuffer(array);
    returnValue.set(array, offset);
    offset += array.length;
  }
  return returnValue;
}
__name(concatUint8Arrays, "concatUint8Arrays");
var cachedDecoders = {
  utf8: new globalThis.TextDecoder("utf8")
};
function assertString(value) {
  if (typeof value !== "string") {
    throw new TypeError(`Expected \`string\`, got \`${typeof value}\``);
  }
}
__name(assertString, "assertString");
var cachedEncoder = new globalThis.TextEncoder();
function stringToUint8Array(string) {
  assertString(string);
  return cachedEncoder.encode(string);
}
__name(stringToUint8Array, "stringToUint8Array");
function base64ToBase64Url(base64) {
  return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
__name(base64ToBase64Url, "base64ToBase64Url");
function base64UrlToBase64(base64url) {
  const base64 = base64url.replaceAll("-", "+").replaceAll("_", "/");
  const padding = (4 - base64.length % 4) % 4;
  return base64 + "=".repeat(padding);
}
__name(base64UrlToBase64, "base64UrlToBase64");
var MAX_BLOCK_SIZE = 65535;
function uint8ArrayToBase64(array, { urlSafe = false } = {}) {
  assertUint8ArrayOrArrayBuffer(array);
  array = toUint8ArrayIfArrayBuffer(array);
  let base64 = "";
  for (let index = 0; index < array.length; index += MAX_BLOCK_SIZE) {
    const chunk = array.subarray(index, index + MAX_BLOCK_SIZE);
    base64 += globalThis.btoa(String.fromCodePoint.apply(void 0, chunk));
  }
  return urlSafe ? base64ToBase64Url(base64) : base64;
}
__name(uint8ArrayToBase64, "uint8ArrayToBase64");
function base64ToUint8Array(base64String) {
  assertString(base64String);
  return Uint8Array.from(globalThis.atob(base64UrlToBase64(base64String)), (x) => x.codePointAt(0));
}
__name(base64ToUint8Array, "base64ToUint8Array");
var byteToHexLookupTable = Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(2, "0"));

// worker/node_modules/@block65/webcrypto-web-push/dist/lib/utils.js
function encodeRecordSize(size) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, size);
  return bytes;
}
__name(encodeRecordSize, "encodeRecordSize");
function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
__name(invariant, "invariant");

// worker/node_modules/@block65/webcrypto-web-push/dist/lib/client-keys.js
async function deriveClientKeys(sub) {
  const bytes = base64ToUint8Array(sub.keys.p256dh);
  const authSecretBytes = base64ToUint8Array(sub.keys.auth);
  invariant(bytes.byteLength === 65 && bytes[0] === 4, "Subscription p256dh is not an uncompressed P-256 point");
  invariant(authSecretBytes.byteLength === 16, "Subscription auth secret is not 16 bytes");
  return {
    publicKeyBytes: bytes,
    publicKey: await crypto.subtle.importKey("raw", bytes, {
      name: "ECDH",
      namedCurve: "P-256"
    }, false, []),
    authSecretBytes
  };
}
__name(deriveClientKeys, "deriveClientKeys");

// worker/node_modules/@block65/webcrypto-web-push/dist/lib/hkdf.js
function createHMAC(data) {
  const keyPromise = crypto.subtle.importKey("raw", data, {
    name: "HMAC",
    hash: "SHA-256"
  }, false, ["sign"]);
  return {
    hash: /* @__PURE__ */ __name(async (input) => {
      const k = await keyPromise;
      return crypto.subtle.sign("HMAC", k, input);
    }, "hash")
  };
}
__name(createHMAC, "createHMAC");
async function hkdf(salt, ikm) {
  const prkhPromise = createHMAC(salt).hash(ikm).then((prk) => createHMAC(prk));
  return {
    extract: /* @__PURE__ */ __name(async (info, len) => {
      const prkh = await prkhPromise;
      const blocks = await Array.from({ length: Math.ceil(len / 32) }, (_, i) => i).reduce(async (acc, i) => {
        const previous = await acc;
        const hash = await prkh.hash(new Uint8Array([...previous.at(-1) ?? [], ...info, i + 1]));
        return [...previous, new Uint8Array(hash)];
      }, Promise.resolve([]));
      return concatUint8Arrays(blocks).slice(0, len);
    }, "extract")
  };
}
__name(hkdf, "hkdf");

// worker/node_modules/@block65/webcrypto-web-push/dist/lib/info.js
function createKeyInfo(clientPublic, serverPublic) {
  return new Uint8Array([
    ...stringToUint8Array("WebPush: info\0"),
    ...clientPublic,
    ...serverPublic
  ]);
}
__name(createKeyInfo, "createKeyInfo");
function createInfo(type) {
  return stringToUint8Array(`Content-Encoding: ${type}\0`);
}
__name(createInfo, "createInfo");

// worker/node_modules/@block65/webcrypto-web-push/dist/lib/local-keys.js
async function generateLocalKeys() {
  const keyPair = await crypto.subtle.generateKey({
    name: "ECDH",
    namedCurve: "P-256"
  }, false, ["deriveBits"]);
  return {
    privateKey: keyPair.privateKey,
    publicKeyBytes: new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey))
  };
}
__name(generateLocalKeys, "generateLocalKeys");

// worker/node_modules/@block65/webcrypto-web-push/dist/lib/salt.js
async function getSalt() {
  return crypto.getRandomValues(new Uint8Array(16));
}
__name(getSalt, "getSalt");

// worker/node_modules/@block65/webcrypto-web-push/dist/lib/encrypt.js
var recordSize = 4096;
var headerSize = 21 + 65;
var maxPlaintextSize = recordSize - headerSize - 17;
async function encryptNotification(subscription, plaintext, options = {}) {
  invariant(plaintext.byteLength <= maxPlaintextSize, `Payload is ${plaintext.byteLength} bytes, the maximum is ${maxPlaintextSize}`);
  const clientKeys = await deriveClientKeys(subscription);
  const salt = await getSalt();
  const localKeys = await generateLocalKeys();
  const sharedSecret = await crypto.subtle.deriveBits({
    name: "ECDH",
    public: clientKeys.publicKey
  }, localKeys.privateKey, 256);
  const keyInfo = createKeyInfo(clientKeys.publicKeyBytes, localKeys.publicKeyBytes);
  const cekInfo = createInfo("aes128gcm");
  const nonceInfo = createInfo("nonce");
  const ikmHkdf = await hkdf(clientKeys.authSecretBytes, sharedSecret);
  const ikm = await ikmHkdf.extract(keyInfo, 32);
  const messageHkdf = await hkdf(salt, ikm);
  const cekBytes = await messageHkdf.extract(cekInfo, 16);
  const nonceBytes = await messageHkdf.extract(nonceInfo, 12);
  const cekCryptoKey = await crypto.subtle.importKey("raw", cekBytes, {
    name: "AES-GCM",
    length: 128
  }, false, ["encrypt"]);
  const padTo = options.pad ?? true ? maxPlaintextSize : plaintext.byteLength;
  const padded = new Uint8Array(padTo + 1);
  padded.set(plaintext);
  padded[plaintext.byteLength] = 2;
  const encrypted = await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv: nonceBytes
  }, cekCryptoKey, padded);
  return new Uint8Array([
    ...salt,
    ...encodeRecordSize(recordSize),
    localKeys.publicKeyBytes.byteLength,
    ...localKeys.publicKeyBytes,
    ...new Uint8Array(encrypted)
  ]);
}
__name(encryptNotification, "encryptNotification");

// worker/node_modules/@block65/webcrypto-web-push/dist/lib/base64.js
function encodeBase64Url(value) {
  return uint8ArrayToBase64(toUint8Array(value), { urlSafe: true });
}
__name(encodeBase64Url, "encodeBase64Url");
function objectToBase64Url(obj) {
  return encodeBase64Url(stringToUint8Array(JSON.stringify(obj)));
}
__name(objectToBase64Url, "objectToBase64Url");

// worker/node_modules/@block65/webcrypto-web-push/dist/lib/jwt.js
async function sign(payload, key) {
  const headerStr = objectToBase64Url({
    typ: "JWT",
    alg: "ES256"
  });
  const payloadStr = objectToBase64Url({
    iat: Math.floor(Date.now() / 1e3),
    ...payload
  });
  const dataStr = `${headerStr}.${payloadStr}`;
  const signature = await crypto.subtle.sign({
    name: "ECDSA",
    hash: "SHA-256"
  }, key, stringToUint8Array(dataStr));
  return `${dataStr}.${encodeBase64Url(signature)}`;
}
__name(sign, "sign");

// worker/node_modules/@block65/webcrypto-web-push/dist/lib/vapid.js
async function vapidHeaders(subscription, vapid) {
  invariant(vapid.subject, "Vapid subject is empty");
  invariant(vapid.privateKey, "Vapid private key is empty");
  invariant(vapid.publicKey, "Vapid public key is empty");
  const endpoint = new URL(subscription.endpoint);
  invariant(endpoint.protocol === "https:", `Subscription endpoint is not https: ${endpoint.protocol}`);
  const vapidPublicKeyBytes = base64ToUint8Array(vapid.publicKey);
  const publicKey = await crypto.subtle.importKey("jwk", {
    kty: "EC",
    crv: "P-256",
    x: encodeBase64Url(vapidPublicKeyBytes.slice(1, 33)),
    y: encodeBase64Url(vapidPublicKeyBytes.slice(33, 65)),
    d: vapid.privateKey
  }, {
    name: "ECDSA",
    namedCurve: "P-256"
  }, false, ["sign"]);
  const jwt = await sign({
    aud: endpoint.origin,
    exp: Math.floor(Date.now() / 1e3) + 12 * 60 * 60,
    sub: vapid.subject
  }, publicKey);
  return {
    headers: {
      authorization: `vapid t=${jwt}, k=${vapid.publicKey}`
    }
  };
}
__name(vapidHeaders, "vapidHeaders");

// worker/node_modules/@block65/webcrypto-web-push/dist/lib/payload.js
async function buildPushPayload(message, subscription, vapid) {
  const { headers } = await vapidHeaders(subscription, vapid);
  const body = await encryptNotification(subscription, stringToUint8Array(
    // if its a primitive, convert to string, otherwise stringify
    typeof message.data === "string" || typeof message.data === "number" ? message.data.toString() : JSON.stringify(message.data)
  ));
  return {
    headers: {
      ...headers,
      ttl: (message.options?.ttl || 60).toString(),
      ...message.options?.urgency && {
        urgency: message.options.urgency
      },
      ...message.options?.topic && {
        topic: message.options.topic
      },
      "content-encoding": "aes128gcm",
      "content-length": body.byteLength.toString(),
      "content-type": "application/octet-stream"
    },
    method: "post",
    body
  };
}
__name(buildPushPayload, "buildPushPayload");

// worker/src/push.js
var MAX_ENDPOINT_LENGTH = 2048;
var MAX_USER_AGENT_LENGTH = 300;
var MAX_DELIVERIES_PER_PUSH_BACKEND = 23;
var DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;
var KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
var ANDROID_APP_ID = "com.helixcer.chat";
var MAX_FCM_TOKEN_LENGTH = 4096;
var FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
var GOOGLE_TOKEN_URL2 = "https://oauth2.googleapis.com/token";
var fcmAccessTokenCache = /* @__PURE__ */ new Map();
function pushError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
__name(pushError, "pushError");
function configuredVapid(env) {
  const publicKey = String(env.VAPID_PUBLIC_KEY || "").trim();
  const privateKey = String(env.VAPID_PRIVATE_KEY || "").trim();
  const subject = String(env.VAPID_SUBJECT || "").trim();
  const subjectValid = subject.startsWith("mailto:") || subject.startsWith("https://");
  if (!KEY_PATTERN.test(publicKey) || publicKey.length < 80 || publicKey.length > 140 || !KEY_PATTERN.test(privateKey) || privateKey.length < 40 || privateKey.length > 100 || !subjectValid) {
    return null;
  }
  return { publicKey, privateKey, subject };
}
__name(configuredVapid, "configuredVapid");
function configuredFirebase(env) {
  const projectId = String(env.FIREBASE_PROJECT_ID || "").trim();
  const clientEmail = String(env.FIREBASE_CLIENT_EMAIL || "").trim().toLowerCase();
  const privateKey = String(env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
  if (!/^[a-z0-9][a-z0-9-]{4,62}$/.test(projectId) || !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(clientEmail) || !/^-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----$/.test(privateKey)) {
    return null;
  }
  return { projectId, clientEmail, privateKey };
}
__name(configuredFirebase, "configuredFirebase");
function pushConfiguration(env) {
  const vapid = configuredVapid(env);
  return vapid ? { available: true, publicKey: vapid.publicKey } : { available: false, publicKey: "" };
}
__name(pushConfiguration, "pushConfiguration");
function mobilePushConfiguration(env) {
  return { available: Boolean(configuredFirebase(env)), appId: ANDROID_APP_ID };
}
__name(mobilePushConfiguration, "mobilePushConfiguration");
async function mobilePushStatus(env, principal, deviceIdValue = "") {
  if (principal?.authType !== "mobile_session" || !principal.membership?.membershipId || !principal.sessionId) {
    throw pushError(403, "A verified mobile session is required for native push notifications.");
  }
  const configuration = mobilePushConfiguration(env);
  const deviceId = String(deviceIdValue || "").trim();
  if (!deviceId) return { ...configuration, subscribed: false, deviceId: "" };
  if (!DEVICE_ID_PATTERN.test(deviceId)) throw pushError(400, "Push device ID is invalid.");
  if (deviceId !== principal.deviceId) throw pushError(403, "Push device ID does not match this mobile session.");
  if (!configuration.available) return { ...configuration, subscribed: false, deviceId };
  const row = await env.DB.prepare(`SELECT 1 AS subscribed FROM mobile_push_devices
    WHERE workspace_id=?1 AND membership_id=?2 AND session_id=?3 AND device_id=?4 AND app_id=?5 LIMIT 1`).bind(
    principal.workspace.workspaceId,
    principal.membership.membershipId,
    principal.sessionId,
    deviceId,
    ANDROID_APP_ID
  ).first();
  return { ...configuration, subscribed: Boolean(row), deviceId };
}
__name(mobilePushStatus, "mobilePushStatus");
function endpointAllowed(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") return false;
  const host = url.hostname.toLowerCase();
  return host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" || host === "web.push.apple.com" || host.endsWith(".notify.windows.com");
}
__name(endpointAllowed, "endpointAllowed");
function validatePushSubscriptionInput(input) {
  const deviceId = String(input?.deviceId || "").trim();
  const subscription = input?.subscription && typeof input.subscription === "object" ? input.subscription : {};
  const endpoint = String(subscription.endpoint || "").trim();
  const p256dh = String(subscription.keys?.p256dh || "").trim();
  const auth = String(subscription.keys?.auth || "").trim();
  const expirationValue = subscription.expirationTime;
  if (!DEVICE_ID_PATTERN.test(deviceId)) throw pushError(400, "Push device ID is invalid.");
  if (!endpoint || endpoint.length > MAX_ENDPOINT_LENGTH || !endpointAllowed(endpoint)) {
    throw pushError(400, "Push subscription endpoint is invalid.");
  }
  if (!KEY_PATTERN.test(p256dh) || p256dh.length < 80 || p256dh.length > 140) {
    throw pushError(400, "Push subscription public key is invalid.");
  }
  if (!KEY_PATTERN.test(auth) || auth.length < 16 || auth.length > 128) {
    throw pushError(400, "Push subscription authentication key is invalid.");
  }
  const expirationTime = expirationValue === null || expirationValue === void 0 ? null : Number(expirationValue);
  if (expirationTime !== null && (!Number.isFinite(expirationTime) || expirationTime < 0)) {
    throw pushError(400, "Push subscription expiry is invalid.");
  }
  return { deviceId, endpoint, p256dh, auth, expirationTime };
}
__name(validatePushSubscriptionInput, "validatePushSubscriptionInput");
async function savePushSubscription(env, principal, input, userAgent = "") {
  if (principal?.authType !== "session" || !principal.membership?.membershipId) {
    throw pushError(403, "A verified browser session is required for push notifications.");
  }
  if (!configuredVapid(env)) throw pushError(503, "Web Push is not configured.");
  const value = validatePushSubscriptionInput(input);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const subscriptionId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM push_subscriptions
      WHERE endpoint=?1 OR (workspace_id=?2 AND membership_id=?3 AND device_id=?4)`).bind(value.endpoint, principal.workspace.workspaceId, principal.membership.membershipId, value.deviceId),
    env.DB.prepare(`INSERT INTO push_subscriptions
        (subscription_id,workspace_id,membership_id,device_id,endpoint,p256dh,auth,expiration_time,user_agent,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)`).bind(
      subscriptionId,
      principal.workspace.workspaceId,
      principal.membership.membershipId,
      value.deviceId,
      value.endpoint,
      value.p256dh,
      value.auth,
      value.expirationTime,
      String(userAgent || "").slice(0, MAX_USER_AGENT_LENGTH),
      now
    )
  ]);
  return { subscribed: true, deviceId: value.deviceId };
}
__name(savePushSubscription, "savePushSubscription");
async function removePushSubscription(env, principal, input) {
  if (principal?.authType !== "session" || !principal.membership?.membershipId) {
    throw pushError(403, "A verified browser session is required for push notifications.");
  }
  const deviceId = String(input?.deviceId || "").trim();
  if (!DEVICE_ID_PATTERN.test(deviceId)) throw pushError(400, "Push device ID is invalid.");
  await env.DB.prepare(`DELETE FROM push_subscriptions
    WHERE workspace_id=?1 AND membership_id=?2 AND device_id=?3`).bind(principal.workspace.workspaceId, principal.membership.membershipId, deviceId).run();
  return { subscribed: false, deviceId };
}
__name(removePushSubscription, "removePushSubscription");
function validateMobilePushDeviceInput(input) {
  const deviceId = String(input?.deviceId || "").trim();
  const appId = String(input?.appId || "").trim();
  const token = String(input?.token || "").trim();
  if (!DEVICE_ID_PATTERN.test(deviceId)) throw pushError(400, "Push device ID is invalid.");
  if (appId !== ANDROID_APP_ID) throw pushError(400, "Android app ID is invalid.");
  if (token.length < 20 || token.length > MAX_FCM_TOKEN_LENGTH || !/^[A-Za-z0-9:_-]+$/.test(token)) {
    throw pushError(400, "FCM registration token is invalid.");
  }
  return { deviceId, appId, token };
}
__name(validateMobilePushDeviceInput, "validateMobilePushDeviceInput");
async function saveMobilePushDevice(env, principal, input) {
  if (principal?.authType !== "mobile_session" || !principal.membership?.membershipId || !principal.sessionId) {
    throw pushError(403, "A verified mobile session is required for native push notifications.");
  }
  if (!configuredFirebase(env)) throw pushError(503, "Native Android push is not configured.");
  const value = validateMobilePushDeviceInput(input);
  if (value.deviceId !== principal.deviceId) throw pushError(403, "Push device ID does not match this mobile session.");
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const pushDeviceId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM mobile_push_devices
      WHERE registration_token=?1 OR (workspace_id=?2 AND membership_id=?3 AND device_id=?4)`).bind(value.token, principal.workspace.workspaceId, principal.membership.membershipId, value.deviceId),
    env.DB.prepare(`INSERT INTO mobile_push_devices
        (push_device_id,workspace_id,membership_id,session_id,device_id,app_id,platform,registration_token,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,'android',?7,?8,?8)`).bind(
      pushDeviceId,
      principal.workspace.workspaceId,
      principal.membership.membershipId,
      principal.sessionId,
      value.deviceId,
      value.appId,
      value.token,
      now
    )
  ]);
  return { available: true, subscribed: true, deviceId: value.deviceId, appId: value.appId };
}
__name(saveMobilePushDevice, "saveMobilePushDevice");
async function removeMobilePushDevice(env, principal, input) {
  if (principal?.authType !== "mobile_session" || !principal.membership?.membershipId || !principal.sessionId) {
    throw pushError(403, "A verified mobile session is required for native push notifications.");
  }
  const deviceId = String(input?.deviceId || "").trim();
  const appId = String(input?.appId || ANDROID_APP_ID).trim();
  if (!DEVICE_ID_PATTERN.test(deviceId)) throw pushError(400, "Push device ID is invalid.");
  if (appId !== ANDROID_APP_ID) throw pushError(400, "Android app ID is invalid.");
  if (deviceId !== principal.deviceId) throw pushError(403, "Push device ID does not match this mobile session.");
  await env.DB.prepare(`DELETE FROM mobile_push_devices
    WHERE workspace_id=?1 AND membership_id=?2 AND session_id=?3 AND device_id=?4 AND app_id=?5`).bind(principal.workspace.workspaceId, principal.membership.membershipId, principal.sessionId, deviceId, appId).run();
  return { available: Boolean(configuredFirebase(env)), subscribed: false, deviceId, appId };
}
__name(removeMobilePushDevice, "removeMobilePushDevice");
function safePushTarget(value) {
  const candidate = String(value || "").trim();
  return /^\/#inbox(?:\/[A-Za-z0-9_-]{1,100})?$/.test(candidate) ? candidate : "/#inbox";
}
__name(safePushTarget, "safePushTarget");
function safeNotification(value) {
  const source = value && typeof value === "object" ? value : {};
  const unreadCount = safeBadgeCount(source.unreadCount);
  const conversationUnreadCount = safeBadgeCount(source.conversationUnreadCount);
  const eventTimestamp = safeEventTimestamp(source.eventTimestamp);
  return {
    title: String(source.title || "New customer message").slice(0, 120),
    body: String(source.body || "Open Helixcer Chat to reply.").slice(0, 500),
    tag: String(source.tag || "helixcer-inbox").slice(0, 128),
    url: safePushTarget(source.url),
    unreadCount: String(unreadCount),
    conversationUnreadCount: String(conversationUnreadCount),
    ...eventTimestamp ? { eventTimestamp } : {}
  };
}
__name(safeNotification, "safeNotification");
function safeEventTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}
__name(safeEventTimestamp, "safeEventTimestamp");
function safeBadgeCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(9999, Math.floor(count));
}
__name(safeBadgeCount, "safeBadgeCount");
async function recordPushSuccess(env, subscriptionId, now) {
  await env.DB.prepare(`UPDATE push_subscriptions
    SET last_success_at=?2,last_error_at=NULL,updated_at=?2 WHERE subscription_id=?1`).bind(subscriptionId, now).run();
}
__name(recordPushSuccess, "recordPushSuccess");
async function recordPushFailure(env, subscriptionId, now) {
  await env.DB.prepare(`UPDATE push_subscriptions
    SET last_error_at=?2,updated_at=?2 WHERE subscription_id=?1`).bind(subscriptionId, now).run();
}
__name(recordPushFailure, "recordPushFailure");
async function recordMobilePushSuccess(env, pushDeviceId, now) {
  await env.DB.prepare(`UPDATE mobile_push_devices
    SET last_success_at=?2,last_error_at=NULL,updated_at=?2 WHERE push_device_id=?1`).bind(pushDeviceId, now).run();
}
__name(recordMobilePushSuccess, "recordMobilePushSuccess");
async function recordMobilePushFailure(env, pushDeviceId, now) {
  await env.DB.prepare(`UPDATE mobile_push_devices
    SET last_error_at=?2,updated_at=?2 WHERE push_device_id=?1`).bind(pushDeviceId, now).run();
}
__name(recordMobilePushFailure, "recordMobilePushFailure");
async function sendWorkspacePush(env, workspaceId, notification = {}, options = {}) {
  const vapid = configuredVapid(env);
  if (!vapid || !workspaceId) return { sent: 0, removed: 0, failed: 0, unavailable: true };
  const membershipId = String(options.membershipId || "").trim();
  const result = membershipId ? await env.DB.prepare(`SELECT p.subscription_id,p.endpoint,p.p256dh,p.auth,p.expiration_time
        FROM push_subscriptions p
        JOIN memberships m ON m.membership_id=p.membership_id AND m.workspace_id=p.workspace_id AND m.status='active'
        WHERE p.workspace_id=?1 AND p.membership_id=?2 ORDER BY p.updated_at DESC LIMIT ?3`).bind(workspaceId, membershipId, MAX_DELIVERIES_PER_PUSH_BACKEND).all() : await env.DB.prepare(`SELECT p.subscription_id,p.endpoint,p.p256dh,p.auth,p.expiration_time
        FROM push_subscriptions p
        JOIN memberships m ON m.membership_id=p.membership_id AND m.workspace_id=p.workspace_id AND m.status='active'
        WHERE p.workspace_id=?1 ORDER BY p.updated_at DESC LIMIT ?2`).bind(workspaceId, MAX_DELIVERIES_PER_PUSH_BACKEND).all();
  const rows = result.results || [];
  const message = { data: safeNotification(notification), options: { ttl: 120, urgency: "high" } };
  const totals = { sent: 0, removed: 0, failed: 0, unavailable: false };
  await Promise.all(rows.map(async (row) => {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    try {
      const request = await buildPushPayload(message, {
        endpoint: row.endpoint,
        expirationTime: row.expiration_time === null ? null : Number(row.expiration_time),
        keys: { p256dh: row.p256dh, auth: row.auth }
      }, vapid);
      const response = await fetch(row.endpoint, request);
      if (response.ok) {
        totals.sent++;
        await recordPushSuccess(env, row.subscription_id, now);
      } else if (response.status === 404 || response.status === 410) {
        totals.removed++;
        await env.DB.prepare("DELETE FROM push_subscriptions WHERE subscription_id=?1").bind(row.subscription_id).run();
      } else {
        totals.failed++;
        await recordPushFailure(env, row.subscription_id, now);
      }
    } catch {
      totals.failed++;
      await recordPushFailure(env, row.subscription_id, now).catch(() => {
      });
    }
  }));
  return totals;
}
__name(sendWorkspacePush, "sendWorkspacePush");
async function sendWorkspaceMobilePush(env, workspaceId, notification = {}, fetchImpl = fetch, options = {}) {
  const safe = safeNotification(notification);
  const conversationId = notificationConversationId(safe.url);
  return sendWorkspaceMobileData(env, workspaceId, {
    title: safe.title,
    body: safe.body,
    tag: safe.tag,
    conversationId,
    unreadCount: safe.unreadCount,
    conversationUnreadCount: safe.conversationUnreadCount,
    ...safe.eventTimestamp ? { eventTimestamp: safe.eventTimestamp } : {},
    target: conversationId ? `helixcer://conversation/${conversationId}` : "helixcer://inbox"
  }, fetchImpl, options);
}
__name(sendWorkspaceMobilePush, "sendWorkspaceMobilePush");
async function sendWorkspaceMobileConversationRead(env, workspaceId, state = {}, fetchImpl = fetch) {
  const conversationId = safeConversationId(state.conversationId);
  if (!conversationId) throw pushError(400, "Conversation ID is invalid.");
  const readAt = String(state.readAt || "").trim();
  return sendWorkspaceMobileData(env, workspaceId, {
    eventType: "conversation.read",
    conversationId,
    conversationUnreadCount: "0",
    unreadCount: String(safeBadgeCount(state.unreadCount)),
    readAt: readAt.slice(0, 40),
    target: `helixcer://conversation/${conversationId}`
  }, fetchImpl);
}
__name(sendWorkspaceMobileConversationRead, "sendWorkspaceMobileConversationRead");
async function sendWorkspaceMobileData(env, workspaceId, data, fetchImpl, options = {}) {
  const firebase = configuredFirebase(env);
  if (!firebase || !workspaceId) return { sent: 0, removed: 0, failed: 0, unavailable: true };
  const membershipId = String(options.membershipId || "").trim();
  const result = membershipId ? await env.DB.prepare(`SELECT p.push_device_id,p.registration_token
        FROM mobile_push_devices p
        JOIN memberships m ON m.membership_id=p.membership_id AND m.workspace_id=p.workspace_id AND m.status='active'
        JOIN sessions s ON s.session_id=p.session_id AND s.user_id=m.user_id AND s.workspace_id=p.workspace_id
          AND s.session_type='mobile' AND s.revoked_at IS NULL AND s.expires_at>?4
        WHERE p.workspace_id=?1 AND p.app_id=?2 AND p.platform='android' AND p.membership_id=?3
        ORDER BY p.updated_at DESC LIMIT ?5`).bind(workspaceId, ANDROID_APP_ID, membershipId, (/* @__PURE__ */ new Date()).toISOString(), MAX_DELIVERIES_PER_PUSH_BACKEND).all() : await env.DB.prepare(`SELECT p.push_device_id,p.registration_token
        FROM mobile_push_devices p
        JOIN memberships m ON m.membership_id=p.membership_id AND m.workspace_id=p.workspace_id AND m.status='active'
        JOIN sessions s ON s.session_id=p.session_id AND s.user_id=m.user_id AND s.workspace_id=p.workspace_id
          AND s.session_type='mobile' AND s.revoked_at IS NULL AND s.expires_at>?3
        WHERE p.workspace_id=?1 AND p.app_id=?2 AND p.platform='android'
        ORDER BY p.updated_at DESC LIMIT ?4`).bind(workspaceId, ANDROID_APP_ID, (/* @__PURE__ */ new Date()).toISOString(), MAX_DELIVERIES_PER_PUSH_BACKEND).all();
  const rows = result.results || [];
  if (!rows.length) return { sent: 0, removed: 0, failed: 0, unavailable: false };
  const accessToken = await firebaseAccessToken(firebase, fetchImpl);
  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(firebase.projectId)}/messages:send`;
  const totals = { sent: 0, removed: 0, failed: 0, unavailable: false };
  await Promise.all(rows.map(async (row) => {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ message: {
          token: row.registration_token,
          data,
          android: { priority: "high", ttl: "120s", restricted_package_name: ANDROID_APP_ID }
        } })
      });
      if (response.ok) {
        totals.sent++;
        await recordMobilePushSuccess(env, row.push_device_id, now);
        return;
      }
      const failureBody = await response.json().catch(() => ({}));
      const errorCodes = Array.isArray(failureBody?.error?.details) ? failureBody.error.details.map((detail) => detail?.errorCode).filter(Boolean) : [];
      if (errorCodes.includes("UNREGISTERED")) {
        totals.removed++;
        await env.DB.prepare("DELETE FROM mobile_push_devices WHERE push_device_id=?1").bind(row.push_device_id).run();
      } else {
        totals.failed++;
        await recordMobilePushFailure(env, row.push_device_id, now);
      }
    } catch {
      totals.failed++;
      await recordMobilePushFailure(env, row.push_device_id, now).catch(() => {
      });
    }
  }));
  return totals;
}
__name(sendWorkspaceMobileData, "sendWorkspaceMobileData");
async function sendWorkspaceNotifications(env, workspaceId, notification = {}) {
  const [webResult, mobileResult] = await Promise.allSettled([
    sendWorkspacePush(env, workspaceId, notification),
    sendWorkspaceMobilePush(env, workspaceId, notification)
  ]);
  const failed = { sent: 0, removed: 0, failed: 1, unavailable: false };
  return {
    web: webResult.status === "fulfilled" ? webResult.value : failed,
    mobile: mobileResult.status === "fulfilled" ? mobileResult.value : failed
  };
}
__name(sendWorkspaceNotifications, "sendWorkspaceNotifications");
async function sendMembershipNotifications(env, workspaceId, membershipId, notification = {}) {
  const targetMembershipId = String(membershipId || "").trim();
  if (!workspaceId || !targetMembershipId) {
    return {
      web: { sent: 0, removed: 0, failed: 0, unavailable: true },
      mobile: { sent: 0, removed: 0, failed: 0, unavailable: true }
    };
  }
  const options = { membershipId: targetMembershipId };
  const [webResult, mobileResult] = await Promise.allSettled([
    sendWorkspacePush(env, workspaceId, notification, options),
    sendWorkspaceMobilePush(env, workspaceId, notification, fetch, options)
  ]);
  const failed = { sent: 0, removed: 0, failed: 1, unavailable: false };
  return {
    web: webResult.status === "fulfilled" ? webResult.value : failed,
    mobile: mobileResult.status === "fulfilled" ? mobileResult.value : failed
  };
}
__name(sendMembershipNotifications, "sendMembershipNotifications");
async function firebaseAccessToken(firebase, fetchImpl) {
  const cacheKey = `${firebase.projectId}:${firebase.clientEmail}`;
  const cached = fcmAccessTokenCache.get(cacheKey);
  if (cached?.expiresAt > Date.now() + 6e4) return cached.token;
  const assertion = await serviceAccountAssertion(firebase);
  const response = await fetchImpl(GOOGLE_TOKEN_URL2, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const payload = await response.json().catch(() => ({}));
  const token = String(payload.access_token || "");
  const expiresIn = Number(payload.expires_in || 0);
  if (!response.ok || !token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw pushError(503, "Firebase access token exchange failed.");
  }
  fcmAccessTokenCache.set(cacheKey, {
    token,
    expiresAt: Date.now() + Math.min(expiresIn, 3600) * 1e3
  });
  return token;
}
__name(firebaseAccessToken, "firebaseAccessToken");
async function serviceAccountAssertion(firebase) {
  const now = Math.floor(Date.now() / 1e3);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const claims = base64UrlJson({
    iss: firebase.clientEmail,
    sub: firebase.clientEmail,
    scope: FCM_SCOPE,
    aud: GOOGLE_TOKEN_URL2,
    iat: now,
    exp: now + 3600
  });
  const signingInput = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemPrivateKeyBytes(firebase.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64UrlBytes(new Uint8Array(signature))}`;
}
__name(serviceAccountAssertion, "serviceAccountAssertion");
function pemPrivateKeyBytes(value) {
  const body = String(value || "").replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s+/g, "");
  if (!body || !/^[A-Za-z0-9+/=]+$/.test(body)) throw pushError(503, "Firebase private key is invalid.");
  return Uint8Array.from(atob(body), (character) => character.charCodeAt(0));
}
__name(pemPrivateKeyBytes, "pemPrivateKeyBytes");
function base64UrlJson(value) {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
}
__name(base64UrlJson, "base64UrlJson");
function base64UrlBytes(value) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(base64UrlBytes, "base64UrlBytes");
function notificationConversationId(url) {
  const match = String(url || "").match(/^\/#inbox\/([A-Za-z0-9_-]{1,100})$/);
  return match ? match[1] : "";
}
__name(notificationConversationId, "notificationConversationId");
function safeConversationId(value) {
  const candidate = String(value || "").trim();
  return /^[A-Za-z0-9_-]{1,100}$/.test(candidate) ? candidate : "";
}
__name(safeConversationId, "safeConversationId");

// worker/src/platform.js
var RESERVED_SLUGS = /* @__PURE__ */ new Set(["default", "admin", "api", "www", "app", "helixcer", "chat", "mail", "support", "billing"]);
var INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
var CLIENT_SELECT = `SELECT w.workspace_id,w.slug,w.name,w.status,w.kind,w.notes,w.created_at,w.updated_at,
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
async function assertPlatformAdmin(env, principal) {
  const email = normalizeEmail(principal?.user?.email);
  if (!email) throw platformError(403, "Platform administrator access is required.");
  const bootstrap = normalizeEmail(env.BOOTSTRAP_OWNER_EMAIL || "");
  if (bootstrap && email === bootstrap) return;
  const row = await env.DB.prepare(`SELECT admin_id FROM platform_admins
    WHERE lower(email)=?1 AND status='active'`).bind(email).first();
  if (!row) throw platformError(403, "Platform administrator access is required.");
}
__name(assertPlatformAdmin, "assertPlatformAdmin");
async function platformProfile(env, principal) {
  const email = normalizeEmail(principal.user.email);
  const bootstrap = normalizeEmail(env.BOOTSTRAP_OWNER_EMAIL || "");
  return {
    ok: true,
    role: "platform_admin",
    isBootstrap: Boolean(bootstrap) && email === bootstrap,
    user: { email: principal.user.email, displayName: principal.user.displayName || principal.user.email },
    clientSignInUrl: env.APP_ORIGIN || "https://chat.helixcer.com"
  };
}
__name(platformProfile, "platformProfile");
async function platformOverview(env) {
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
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1e3).toISOString()
  ).first();
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
__name(platformOverview, "platformOverview");
async function listClientWorkspaces(env, url) {
  const conditions = [`w.kind IN ('internal','client')`];
  const params = [];
  const status = String(url.searchParams.get("status") || "");
  if (status === "active" || status === "suspended") {
    params.push(status);
    conditions.push(`w.status=?${params.length}`);
  }
  const query = String(url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 120);
  if (query) {
    params.push(`%${query}%`);
    const placeholder = `?${params.length}`;
    conditions.push(`(lower(w.name) LIKE ${placeholder} OR lower(w.slug) LIKE ${placeholder}
      OR EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.user_id=m.user_id
        WHERE m.workspace_id=w.workspace_id AND lower(u.email) LIKE ${placeholder}))`);
  }
  const statement = env.DB.prepare(`${CLIENT_SELECT} WHERE ${conditions.join(" AND ")}
    ORDER BY w.created_at DESC LIMIT 200`);
  const result = await (params.length ? statement.bind(...params) : statement).all();
  return { ok: true, items: (result.results || []).map(clientView) };
}
__name(listClientWorkspaces, "listClientWorkspaces");
async function getClientWorkspace(env, workspaceId) {
  const row = await env.DB.prepare(`${CLIENT_SELECT} WHERE w.workspace_id=?1`).bind(workspaceId).first();
  if (!row) throw platformError(404, "Client workspace not found.");
  const [members, invitations, messageCount] = await Promise.all([
    env.DB.prepare(`SELECT m.membership_id,m.user_id,m.role,m.status,m.created_at,m.allowed_channel_ids_json,
        u.email,u.display_name
      FROM memberships m JOIN users u ON u.user_id=m.user_id
      WHERE m.workspace_id=?1
      ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END,m.created_at`).bind(workspaceId).all(),
    env.DB.prepare(`SELECT invitation_id,email,role,status,expires_at,created_at,allowed_channel_ids_json FROM invitations
      WHERE workspace_id=?1 AND status='pending' ORDER BY created_at DESC`).bind(workspaceId).all(),
    env.DB.prepare("SELECT count(*) AS count FROM messages WHERE workspace_id=?1").bind(workspaceId).first()
  ]);
  return {
    ok: true,
    item: clientView(row),
    members: (members.results || []).map(memberView2),
    invitations: (invitations.results || []).map(invitationView2),
    messageCount: Number(messageCount?.count || 0)
  };
}
__name(getClientWorkspace, "getClientWorkspace");
async function createClientWorkspace(env, principal, request, payload) {
  const name = cleanText(payload?.companyName ?? payload?.name, "Company name", 2, 120);
  const email = normalizeEmail(payload?.ownerEmail ?? payload?.email);
  if (!email || !email.includes("@") || email.length > 254) throw platformError(400, "A valid owner email is required.");
  const ownerName = optionalText(payload?.ownerName ?? payload?.owner_name, "Owner name", 160);
  const notes = optionalText(payload?.notes, "Notes", 2e3);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const workspaceId = crypto.randomUUID();
  const slug = await uniqueSlug(env, payload?.slug || name);
  const owner = await env.DB.prepare("SELECT user_id,email,display_name FROM users WHERE lower(email)=?1").bind(email).first();
  const token = randomToken2();
  const invitationId = crypto.randomUUID();
  const statements = [
    env.DB.prepare(`INSERT INTO workspaces
        (workspace_id,slug,name,registered_name,status,kind,notes,created_at,updated_at)
      VALUES (?1,?2,?3,?3,'active','client',?4,?5,?5)`).bind(workspaceId, slug, name, notes, now)
  ];
  if (owner) {
    statements.push(env.DB.prepare(`INSERT INTO memberships
        (membership_id,workspace_id,user_id,role,status,invited_by_user_id,created_at,updated_at)
      VALUES (?1,?2,?3,'owner','active',?4,?5,?5)`).bind(crypto.randomUUID(), workspaceId, owner.user_id, principal.user.userId || null, now));
  }
  statements.push(env.DB.prepare(`INSERT INTO invitations
      (invitation_id,workspace_id,email,role,token_hash,status,invited_by_user_id,expires_at,created_at,updated_at)
    VALUES (?1,?2,?3,'owner',?4,'pending',?5,?6,?7,?7)`).bind(
    invitationId,
    workspaceId,
    email,
    await hashToken(token),
    principal.user.userId || null,
    new Date(Date.now() + INVITATION_TTL_MS).toISOString(),
    now
  ));
  const inviteUrl = inviteLink(request, env, token);
  await env.DB.batch(statements);
  await auditAuthAction(env, principal, "create", "client_workspace", workspaceId, { name, slug, ownerEmail: email });
  return {
    ok: true,
    item: clientView({
      workspace_id: workspaceId,
      slug,
      name,
      registered_name: name,
      status: "active",
      kind: "client",
      notes,
      created_at: now,
      updated_at: now,
      owner_email: owner?.email || email,
      owner_name: owner?.display_name || ownerName,
      member_count: owner ? 1 : 0
    }),
    inviteUrl
  };
}
__name(createClientWorkspace, "createClientWorkspace");
async function updateClientWorkspace(env, principal, workspaceId, payload) {
  const allowed = [
    "name",
    "companyName",
    "status",
    "notes",
    "registeredName",
    "addressLine1",
    "addressLine2",
    "city",
    "state",
    "postalCode",
    "country",
    "gstin",
    "taxDetails"
  ];
  rejectUnknown(payload, allowed);
  const current = await env.DB.prepare(`${CLIENT_SELECT} WHERE w.workspace_id=?1`).bind(workspaceId).first();
  if (!current) throw platformError(404, "Client workspace not found.");
  const name = payload.name === void 0 && payload.companyName === void 0 ? current.name : cleanText(payload.companyName ?? payload.name, "Company name", 2, 120);
  const status = payload.status === void 0 ? current.status : String(payload.status);
  if (!["active", "suspended"].includes(status)) throw platformError(400, "Status must be active or suspended.");
  if (current.kind === "internal" && status !== current.status) {
    throw platformError(400, "The internal workspace status cannot be changed.");
  }
  const notes = payload.notes === void 0 ? current.notes : optionalText(payload.notes, "Notes", 2e3);
  const profile = {
    registered_name: profileField(payload, "registeredName", current.registered_name, 200),
    address_line1: profileField(payload, "addressLine1", current.address_line1, 200),
    address_line2: profileField(payload, "addressLine2", current.address_line2, 200),
    city: profileField(payload, "city", current.city, 100),
    state: profileField(payload, "state", current.state, 100),
    postal_code: profileField(payload, "postalCode", current.postal_code, 20),
    country: profileField(payload, "country", current.country, 100),
    gstin: profileField(payload, "gstin", current.gstin, 40),
    tax_details: profileField(payload, "taxDetails", current.tax_details, 1e3)
  };
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const statements = [
    env.DB.prepare(`UPDATE workspaces SET name=?2,status=?3,notes=?4,registered_name=?5,
        address_line1=?6,address_line2=?7,city=?8,state=?9,postal_code=?10,country=?11,gstin=?12,
        tax_details=?13,updated_at=?14
      WHERE workspace_id=?1`).bind(
      workspaceId,
      name,
      status,
      notes,
      profile.registered_name,
      profile.address_line1,
      profile.address_line2,
      profile.city,
      profile.state,
      profile.postal_code,
      profile.country,
      profile.gstin,
      profile.tax_details,
      now
    )
  ];
  if (status === "suspended") {
    statements.push(env.DB.prepare(`UPDATE sessions SET revoked_at=?2
      WHERE workspace_id=?1 AND revoked_at IS NULL`).bind(workspaceId, now));
  }
  await env.DB.batch(statements);
  await auditAuthAction(env, principal, "update", "client_workspace", workspaceId, {
    name,
    status,
    notes,
    profileChanged: allowed.some((key) => payload[key] !== void 0 && !["name", "companyName", "status", "notes"].includes(key))
  });
  const updated = await env.DB.prepare(`${CLIENT_SELECT} WHERE w.workspace_id=?1`).bind(workspaceId).first();
  return { ok: true, suspended: status === "suspended", item: clientView(updated || current) };
}
__name(updateClientWorkspace, "updateClientWorkspace");
async function deleteClientWorkspace(env, principal, workspaceId, payload) {
  const current = await env.DB.prepare(`SELECT workspace_id,slug,name,kind FROM workspaces
    WHERE workspace_id=?1 AND kind='client'`).bind(workspaceId).first();
  if (!current) throw platformError(404, "Client workspace not found.");
  if (workspaceId === principal.workspace.workspaceId) {
    throw platformError(409, "You cannot delete the workspace you are signed in to.");
  }
  const confirmation = String(payload?.confirmSlug || "");
  if (confirmation !== current.slug) {
    throw platformError(400, `Type the workspace slug "${current.slug}" to confirm permanent deletion.`);
  }
  const workspaceTables = [
    "external_api_requests",
    "outbound_payloads",
    "outbox",
    "messages",
    "contact_platform_ids",
    "channel_identity_bindings",
    "contact_identities",
    "identity_migration_issues",
    "conversations",
    "channel_identities",
    "contacts",
    "channel_credentials",
    "channels",
    "webhook_events",
    "agents",
    "api_keys",
    "push_subscriptions",
    "mobile_push_devices",
    "memberships",
    "sessions",
    "invitations",
    "audit_log"
  ];
  const statements = workspaceTables.map((table) => env.DB.prepare(`DELETE FROM ${table} WHERE workspace_id=?1`).bind(workspaceId));
  statements.push(env.DB.prepare(`DELETE FROM workspaces WHERE workspace_id=?1 AND kind='client'`).bind(workspaceId));
  await env.DB.batch(statements);
  await auditAuthAction(env, principal, "delete", "client_workspace", workspaceId, {
    name: current.name,
    slug: current.slug
  });
  return { ok: true, deleted: true };
}
__name(deleteClientWorkspace, "deleteClientWorkspace");
async function inviteWorkspaceMember(env, principal, request, workspaceId, payload) {
  const workspace = await env.DB.prepare(`SELECT workspace_id,name FROM workspaces
    WHERE workspace_id=?1 AND kind IN ('internal','client')`).bind(workspaceId).first();
  if (!workspace) throw platformError(404, "Client workspace not found.");
  const email = normalizeEmail(payload?.email);
  if (!email || !email.includes("@") || email.length > 254) throw platformError(400, "A valid email is required.");
  const role = String(payload?.role || "agent");
  if (!["owner", "admin", "agent"].includes(role)) throw platformError(400, "Role must be owner, admin, or agent.");
  let allowedChannelIds = [];
  try {
    allowedChannelIds = await resolveAllowedChannelIds(env, workspaceId, role, payload || {}, { required: false });
  } catch (error) {
    throw platformError(error.status || 400, error.message || "Invalid channel access selection.");
  }
  const allowedJson = JSON.stringify(allowedChannelIds);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const user = await env.DB.prepare("SELECT user_id,email FROM users WHERE lower(email)=?1").bind(email).first();
  let member = null;
  if (user) {
    const existing = await env.DB.prepare(`SELECT membership_id,status FROM memberships
      WHERE workspace_id=?1 AND user_id=?2`).bind(workspaceId, user.user_id).first();
    if (existing?.status === "active") throw platformError(409, "This person is already a workspace member.");
    if (existing) {
      await env.DB.prepare(`UPDATE memberships SET role=?3,status='active',allowed_channel_ids_json=?4,updated_at=?5
        WHERE workspace_id=?1 AND user_id=?2`).bind(workspaceId, user.user_id, role, allowedJson, now).run();
    } else {
      await env.DB.prepare(`INSERT INTO memberships
          (membership_id,workspace_id,user_id,role,status,invited_by_user_id,created_at,updated_at,allowed_channel_ids_json)
        VALUES (?1,?2,?3,?4,'active',?5,?6,?6,?7)`).bind(crypto.randomUUID(), workspaceId, user.user_id, role, principal.user.userId || null, now, allowedJson).run();
    }
    member = await env.DB.prepare(`SELECT m.membership_id,m.user_id,m.role,m.status,m.created_at,m.allowed_channel_ids_json,
        u.email,u.display_name FROM memberships m JOIN users u ON u.user_id=m.user_id
      WHERE m.workspace_id=?1 AND m.user_id=?2`).bind(workspaceId, user.user_id).first();
  }
  const token = randomToken2();
  const invitationId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS).toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE invitations SET status='cancelled',updated_at=?3
      WHERE workspace_id=?1 AND lower(email)=?2 AND status='pending'`).bind(workspaceId, email, now),
    env.DB.prepare(`INSERT INTO invitations
        (invitation_id,workspace_id,email,role,token_hash,status,invited_by_user_id,expires_at,created_at,updated_at,allowed_channel_ids_json)
      VALUES (?1,?2,?3,?4,?5,'pending',?6,?7,?8,?8,?9)`).bind(invitationId, workspaceId, email, role, await hashToken(token), principal.user.userId || null, expiresAt, now, allowedJson)
  ]);
  await auditAuthAction(
    env,
    principal,
    "invite",
    member ? "membership" : "invitation",
    member ? member.membership_id : invitationId,
    { email, role, workspaceId, allowedChannelIds }
  );
  return {
    ok: true,
    item: member ? memberView2(member) : { invitationId, email, role, status: "pending", expiresAt, createdAt: now, allowedChannelIds },
    inviteUrl: inviteLink(request, env, token)
  };
}
__name(inviteWorkspaceMember, "inviteWorkspaceMember");
async function cancelWorkspaceInvitation(env, principal, workspaceId, invitationId) {
  const invitation = await env.DB.prepare(`SELECT invitation_id,email FROM invitations
    WHERE invitation_id=?1 AND workspace_id=?2 AND status='pending'`).bind(invitationId, workspaceId).first();
  if (!invitation) throw platformError(404, "Invitation not found.");
  await env.DB.prepare(`UPDATE invitations SET status='cancelled',updated_at=?3
    WHERE invitation_id=?1 AND workspace_id=?2`).bind(invitationId, workspaceId, (/* @__PURE__ */ new Date()).toISOString()).run();
  await auditAuthAction(env, principal, "cancel_invitation", "invitation", invitationId, {
    email: invitation.email,
    workspaceId
  });
  return { ok: true };
}
__name(cancelWorkspaceInvitation, "cancelWorkspaceInvitation");
async function updateWorkspaceMember(env, principal, workspaceId, membershipId, payload) {
  const target = await env.DB.prepare(`SELECT m.membership_id,m.user_id,m.role,m.status,m.allowed_channel_ids_json,u.email,u.display_name
    FROM memberships m JOIN users u ON u.user_id=m.user_id
    WHERE m.membership_id=?1 AND m.workspace_id=?2`).bind(membershipId, workspaceId).first();
  if (!target) throw platformError(404, "Workspace member not found.");
  const nextRole = payload.role === void 0 ? target.role : String(payload.role);
  const nextStatus = payload.status === void 0 ? target.status : String(payload.status);
  if (!["owner", "admin", "agent"].includes(nextRole)) throw platformError(400, "Invalid member role.");
  if (!["active", "disabled"].includes(nextStatus)) throw platformError(400, "Invalid member status.");
  const removesOwner = target.role === "owner" && (nextRole !== "owner" || nextStatus === "disabled");
  if (removesOwner) await assertAnotherOwner(env, workspaceId);
  let nextAllowedJson = target.allowed_channel_ids_json || "[]";
  if (nextRole !== "agent") {
    nextAllowedJson = "[]";
  } else if (payload.allowedChannelIds !== void 0 || payload.allowed_channel_ids !== void 0) {
    try {
      nextAllowedJson = JSON.stringify(await resolveAllowedChannelIds(env, workspaceId, nextRole, payload, {
        required: true
      }));
    } catch (error) {
      throw platformError(error.status || 400, error.message || "Invalid channel access selection.");
    }
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const changed = await env.DB.prepare(`UPDATE memberships SET role=?3,status=?4,allowed_channel_ids_json=?5,updated_at=?6
    WHERE membership_id=?1 AND workspace_id=?2 AND (
      role!='owner' OR (?3='owner' AND ?4='active') OR
      (SELECT count(*) FROM memberships WHERE workspace_id=?2 AND role='owner' AND status='active')>1
    )`).bind(membershipId, workspaceId, nextRole, nextStatus, nextAllowedJson, now).run();
  if (!changed.meta?.changes) throw platformError(409, "The workspace must retain at least one active owner.");
  const statements = [];
  if (nextStatus === "disabled") {
    statements.push(env.DB.prepare(`UPDATE sessions SET revoked_at=?3
      WHERE user_id=?1 AND workspace_id=?2 AND revoked_at IS NULL`).bind(target.user_id, workspaceId, now));
  }
  if (statements.length) await env.DB.batch(statements);
  await auditAuthAction(env, principal, "update", "membership", membershipId, {
    email: target.email,
    role: nextRole,
    status: nextStatus,
    workspaceId,
    allowedChannelIds: parseAllowedChannelIds(nextAllowedJson)
  });
  return {
    ok: true,
    item: memberView2({
      membership_id: target.membership_id,
      user_id: target.user_id,
      email: target.email,
      display_name: target.display_name,
      role: nextRole,
      status: nextStatus,
      allowed_channel_ids_json: nextAllowedJson
    })
  };
}
__name(updateWorkspaceMember, "updateWorkspaceMember");
async function removeWorkspaceMember(env, principal, workspaceId, membershipId) {
  const target = await env.DB.prepare(`SELECT m.membership_id,m.user_id,m.role,m.status,u.email
    FROM memberships m JOIN users u ON u.user_id=m.user_id
    WHERE m.membership_id=?1 AND m.workspace_id=?2`).bind(membershipId, workspaceId).first();
  if (!target) throw platformError(404, "Workspace member not found.");
  if (target.role === "owner" && target.status === "active") await assertAnotherOwner(env, workspaceId);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM memberships WHERE membership_id=?1 AND workspace_id=?2").bind(membershipId, workspaceId),
    env.DB.prepare(`UPDATE sessions SET revoked_at=?3
      WHERE user_id=?1 AND workspace_id=?2 AND revoked_at IS NULL`).bind(target.user_id, workspaceId, now)
  ]);
  await auditAuthAction(env, principal, "remove", "membership", membershipId, {
    email: target.email,
    role: target.role,
    workspaceId
  });
  return { ok: true };
}
__name(removeWorkspaceMember, "removeWorkspaceMember");
async function listPlatformAdmins(env, principal) {
  const bootstrap = normalizeEmail(env.BOOTSTRAP_OWNER_EMAIL || "");
  const result = await env.DB.prepare(`SELECT p.admin_id,p.email,p.display_name,p.status,p.created_at,
      u.user_id
    FROM platform_admins p LEFT JOIN users u ON lower(u.email)=lower(p.email)
    ORDER BY p.created_at`).all();
  const items = (result.results || []).map((row) => ({
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
      adminId: "bootstrap",
      email: bootstrap,
      displayName: "Bootstrap owner",
      status: "active",
      createdAt: "",
      isBootstrap: true,
      hasAccount: true
    });
  }
  return { ok: true, items, me: principal.user.email };
}
__name(listPlatformAdmins, "listPlatformAdmins");
async function addPlatformAdmin(env, principal, request, payload) {
  const email = normalizeEmail(payload?.email);
  if (!email || !email.includes("@") || email.length > 254) throw platformError(400, "A valid email is required.");
  const bootstrap = normalizeEmail(env.BOOTSTRAP_OWNER_EMAIL || "");
  if (bootstrap && email === bootstrap) throw platformError(409, "That address is already the bootstrap platform administrator.");
  const displayName = optionalText(payload?.displayName, "Display name", 160);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(`INSERT INTO platform_admins
      (admin_id,email,display_name,status,created_at,updated_at)
    VALUES (?1,?2,?3,'active',?4,?4)
    ON CONFLICT(email) DO UPDATE SET status='active',display_name=excluded.display_name,updated_at=excluded.updated_at`).bind(crypto.randomUUID(), email, displayName, now).run();
  const user = await env.DB.prepare("SELECT user_id FROM users WHERE lower(email)=?1").bind(email).first();
  let inviteUrl = "";
  if (user) {
    const membership = await env.DB.prepare(`SELECT membership_id FROM memberships
      WHERE user_id=?1 AND status='active' LIMIT 1`).bind(user.user_id).first();
    if (!membership) {
      const workspace = await internalWorkspace(env);
      await env.DB.prepare(`INSERT INTO memberships
          (membership_id,workspace_id,user_id,role,status,created_at,updated_at)
        VALUES (?1,?2,?3,'agent','active',?4,?4)
        ON CONFLICT(workspace_id,user_id) DO UPDATE SET status='active',updated_at=excluded.updated_at`).bind(crypto.randomUUID(), workspace.workspace_id, user.user_id, now).run();
    }
  } else {
    const workspace = await internalWorkspace(env);
    const token = randomToken2();
    const invitationId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS).toISOString();
    await env.DB.batch([
      env.DB.prepare(`UPDATE invitations SET status='cancelled',updated_at=?3
        WHERE workspace_id=?1 AND lower(email)=?2 AND status='pending'`).bind(workspace.workspace_id, email, now),
      env.DB.prepare(`INSERT INTO invitations
          (invitation_id,workspace_id,email,role,token_hash,status,invited_by_user_id,expires_at,created_at,updated_at)
        VALUES (?1,?2,?3,'agent',?4,'pending',?5,?6,?7,?7)`).bind(
        invitationId,
        workspace.workspace_id,
        email,
        await hashToken(token),
        principal.user.userId || null,
        expiresAt,
        now
      )
    ]);
    inviteUrl = inviteLink(request, env, token);
  }
  await auditAuthAction(env, principal, "grant", "platform_admin", email, { email });
  return { ok: true, item: { email, displayName: displayName || email, hasAccount: Boolean(user) }, inviteUrl };
}
__name(addPlatformAdmin, "addPlatformAdmin");
async function removePlatformAdmin(env, principal, adminId) {
  const row = await env.DB.prepare("SELECT admin_id,email FROM platform_admins WHERE admin_id=?1").bind(adminId).first();
  if (!row) throw platformError(404, "Platform administrator not found.");
  const bootstrap = normalizeEmail(env.BOOTSTRAP_OWNER_EMAIL || "");
  if (bootstrap && normalizeEmail(row.email) === bootstrap) {
    throw platformError(409, "The bootstrap platform administrator cannot be removed.");
  }
  await env.DB.prepare("DELETE FROM platform_admins WHERE admin_id=?1").bind(adminId).run();
  await auditAuthAction(env, principal, "revoke", "platform_admin", row.email, { email: row.email });
  return { ok: true };
}
__name(removePlatformAdmin, "removePlatformAdmin");
function clientView(row) {
  return {
    workspaceId: row.workspace_id,
    slug: row.slug,
    name: row.name,
    status: row.status || "active",
    kind: row.kind || "client",
    notes: row.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    lastActivity: row.last_activity || "",
    owner: {
      email: row.owner_email || "",
      displayName: row.owner_name || ""
    },
    counts: {
      members: Number(row.member_count || 0),
      channels: Number(row.channel_count || 0),
      conversations: Number(row.conversation_count || 0),
      contacts: Number(row.contact_count || 0)
    },
    profile: {
      registeredName: row.registered_name || "",
      addressLine1: row.address_line1 || "",
      addressLine2: row.address_line2 || "",
      city: row.city || "",
      state: row.state || "",
      postalCode: row.postal_code || "",
      country: row.country || "",
      gstin: row.gstin || "",
      taxDetails: row.tax_details || ""
    }
  };
}
__name(clientView, "clientView");
function memberView2(row) {
  return {
    membershipId: row.membership_id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name || "",
    role: row.role,
    status: row.status,
    createdAt: row.created_at || "",
    allowedChannelIds: parseAllowedChannelIds(row.allowed_channel_ids_json)
  };
}
__name(memberView2, "memberView");
function invitationView2(row) {
  return {
    invitationId: row.invitation_id,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    allowedChannelIds: parseAllowedChannelIds(row.allowed_channel_ids_json)
  };
}
__name(invitationView2, "invitationView");
async function assertAnotherOwner(env, workspaceId) {
  const owners = await env.DB.prepare(`SELECT count(*) AS count FROM memberships
    WHERE workspace_id=?1 AND role='owner' AND status='active'`).bind(workspaceId).first();
  if (Number(owners?.count || 0) <= 1) {
    throw platformError(409, "The workspace must retain at least one active owner.");
  }
}
__name(assertAnotherOwner, "assertAnotherOwner");
async function internalWorkspace(env) {
  const workspace = await env.DB.prepare(`SELECT workspace_id,name,slug FROM workspaces
    WHERE kind='internal' ORDER BY created_at,workspace_id LIMIT 1`).first();
  if (workspace) return workspace;
  const fallback = await env.DB.prepare(`SELECT workspace_id,name,slug FROM workspaces
    ORDER BY created_at LIMIT 1`).first();
  if (!fallback) throw platformError(503, "No workspace is configured.");
  return fallback;
}
__name(internalWorkspace, "internalWorkspace");
function inviteLink(request, env, token) {
  const base = String(env.APP_ORIGIN || "").trim() || "https://chat.helixcer.com";
  const url = new URL(base.endsWith("/") ? base : `${base}/`);
  url.searchParams.set("invite", token);
  return url.toString();
}
__name(inviteLink, "inviteLink");
function randomToken2() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(randomToken2, "randomToken");
async function uniqueSlug(env, value) {
  const base = slugify(value);
  if (RESERVED_SLUGS.has(base)) return uniqueSlug(env, `${base}-client`);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await env.DB.prepare("SELECT 1 FROM workspaces WHERE slug=?1").bind(candidate).first();
    if (!taken && !RESERVED_SLUGS.has(candidate)) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}
__name(uniqueSlug, "uniqueSlug");
function slugify(value) {
  const slug = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return slug || "client";
}
__name(slugify, "slugify");
function cleanText(value, label, min, max) {
  const text = String(value || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (text.length < min || text.length > max) throw platformError(400, `${label} must be ${min} to ${max} characters.`);
  return text;
}
__name(cleanText, "cleanText");
function optionalText(value, label, max) {
  const text = String(value || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (text.length > max) throw platformError(400, `${label} must be at most ${max} characters.`);
  return text;
}
__name(optionalText, "optionalText");
function profileField(payload, key, current, max) {
  if (payload[key] === void 0) return current || "";
  const text = String(payload[key] || "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (text.length > max) throw platformError(400, `${key} must be at most ${max} characters.`);
  return text;
}
__name(profileField, "profileField");
function rejectUnknown(payload, allowed) {
  if (!payload || typeof payload !== "object") return;
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(payload)) {
    if (!allowedSet.has(key)) throw platformError(400, `Unknown field: ${key}.`);
  }
}
__name(rejectUnknown, "rejectUnknown");
function platformError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
__name(platformError, "platformError");

// worker/src/imports/interakt.js
var INTERAKT_SOURCE = "interakt";
var CONTACT_TARGET_FIELDS = Object.freeze([
  { key: "name", label: "Name", required: false },
  { key: "phone", label: "Phone (with country code)", required: true },
  { key: "company", label: "Company", required: false },
  { key: "tags", label: "Tags", required: false }
]);
var CONTENT_TYPE_MAP = Object.freeze({
  Text: "text",
  Template: "template",
  Image: "image",
  Video: "video",
  Audio: "audio",
  Document: "document",
  Sticker: "sticker",
  Location: "location",
  Contact: "contacts",
  InteractiveButton: "interactive",
  InteractiveButtonReply: "interactive",
  Order: "order",
  Unknown: "text"
});
var STATUS_MAP = Object.freeze({
  read: "read",
  seen: "read",
  delivered: "delivered",
  sent: "sent",
  failed: "failed",
  submitted: "sent",
  accepted: "sent"
});
var PHONE_SOURCE_FIELDS = Object.freeze([
  { path: "channel_phone_number", label: "channel_phone_number (with country code)" },
  { path: "channel_account_identifier", label: "channel_account_identifier" },
  { path: "phone_number_with_country_code", label: "phone_number + country_code" },
  { path: "phone_number", label: "phone_number (local)" },
  { path: "customer.phone", label: "customer.phone" }
]);
function discoverInteraktContactFields(conversations) {
  const list = Array.isArray(conversations) ? conversations : [];
  const counts = /* @__PURE__ */ new Map();
  const bump = /* @__PURE__ */ __name((path, label, sample = "") => {
    const current = counts.get(path) || { path, label, count: 0, sample: "" };
    current.count += 1;
    if (!current.sample && sample) current.sample = String(sample).slice(0, 80);
    counts.set(path, current);
  }, "bump");
  for (const conversation of list) {
    const { top, rawCustomer, traits, tags } = customerParts(conversation);
    if (rawCustomer.channel_phone_number) {
      bump("channel_phone_number", "channel_phone_number (with country code)", rawCustomer.channel_phone_number);
    }
    if (rawCustomer.channel_account_identifier) {
      bump("channel_account_identifier", "channel_account_identifier", rawCustomer.channel_account_identifier);
    }
    if (rawCustomer.phone_number) {
      bump("phone_number", "phone_number (local)", rawCustomer.phone_number);
      if (rawCustomer.country_code) {
        bump(
          "phone_number_with_country_code",
          "phone_number + country_code",
          `${rawCustomer.country_code}${String(rawCustomer.phone_number).replace(/\D/g, "")}`
        );
      }
    }
    if (top.phone) bump("customer.phone", "customer.phone", top.phone);
    if (top.name) bump("customer.name", "customer.name", top.name);
    if (Array.isArray(tags) && tags.length) {
      const readable = tags.filter((tag) => typeof tag === "string" && tag.trim());
      if (readable.length) bump("tags", "tags", readable.slice(0, 3).join(", "));
    }
    for (const [key, value] of Object.entries(traits)) {
      if (value === void 0 || value === null || value === "") continue;
      const sample = Array.isArray(value) ? value.slice(0, 3).join(", ") : value;
      bump(`traits.${key}`, `traits.${key}`, sample);
    }
  }
  return [...counts.values()].sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    return left.path.localeCompare(right.path);
  });
}
__name(discoverInteraktContactFields, "discoverInteraktContactFields");
function defaultInteraktFieldMapping(availableFields = []) {
  const paths = new Set(availableFields.map((field) => field.path));
  const pick = /* @__PURE__ */ __name((...candidates) => candidates.find((path) => paths.has(path)) || "", "pick");
  return {
    name: pick("traits.name", "traits.Name", "traits.full_name", "customer.name", "traits.User Name"),
    phone: pick("channel_phone_number", "phone_number_with_country_code", "channel_account_identifier", "customer.phone"),
    company: pick("traits.Company", "traits.company", "traits.company_name"),
    // Interakt tags are often opaque UUIDs — leave unmapped unless the user opts in.
    tags: ""
  };
}
__name(defaultInteraktFieldMapping, "defaultInteraktFieldMapping");
function normalizeFieldMapping(value) {
  const input = value && typeof value === "object" ? value : {};
  const mapping = {};
  for (const field of CONTACT_TARGET_FIELDS) {
    mapping[field.key] = String(input[field.key] || "").trim();
  }
  return mapping;
}
__name(normalizeFieldMapping, "normalizeFieldMapping");
function extractInteraktCustomer(conversation, fieldMapping = null) {
  const mapping = normalizeFieldMapping(fieldMapping || defaultInteraktFieldMapping(
    discoverInteraktContactFields([conversation])
  ));
  const displayName = mapping.name ? String(readSourceValue(conversation, mapping.name) || "").trim() : "";
  const phone = mapping.phone ? String(readSourceValue(conversation, mapping.phone) || "").trim() : "";
  const company = mapping.company ? String(readSourceValue(conversation, mapping.company) || "").trim() : "";
  const tags = mapping.tags ? normalizeTagValues(readSourceValue(conversation, mapping.tags)) : [];
  return {
    externalId: String(conversation?.id || conversation?.raw_chat?.id || "").trim(),
    phone,
    displayName,
    company,
    tags,
    status: normalizeConversationStatus(conversation?.status || conversation?.raw_chat?.chat_status),
    fieldMapping: mapping
  };
}
__name(extractInteraktCustomer, "extractInteraktCustomer");
function readSourceValue(conversation, path) {
  const key = String(path || "").trim();
  if (!key) return "";
  const { top, rawCustomer, traits, tags } = customerParts(conversation);
  if (key === "tags") return tags;
  if (key === "channel_phone_number") return rawCustomer.channel_phone_number || "";
  if (key === "channel_account_identifier") return rawCustomer.channel_account_identifier || "";
  if (key === "phone_number") return rawCustomer.phone_number || "";
  if (key === "phone_number_with_country_code") {
    const local = String(rawCustomer.phone_number || "").replace(/\D/g, "");
    const country = String(rawCustomer.country_code || "").replace(/\D/g, "");
    return country && local ? `${country}${local}` : local;
  }
  if (key === "customer.phone") return top.phone || "";
  if (key === "customer.name") return top.name || "";
  if (key.startsWith("traits.")) return traits[key.slice("traits.".length)] ?? "";
  return "";
}
__name(readSourceValue, "readSourceValue");
function customerParts(conversation) {
  const top = conversation?.customer && typeof conversation.customer === "object" ? conversation.customer : {};
  const rawCustomer = conversation?.raw_chat?.customer_id && typeof conversation.raw_chat.customer_id === "object" ? conversation.raw_chat.customer_id : {};
  const traits = rawCustomer.traits && typeof rawCustomer.traits === "object" ? rawCustomer.traits : {};
  const tags = Array.isArray(rawCustomer.tags) ? rawCustomer.tags : [];
  return { top, rawCustomer, traits, tags };
}
__name(customerParts, "customerParts");
function normalizeTagValues(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[|,]/);
  const tags = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of list) {
    const tag = String(item || "").trim().slice(0, 40);
    if (!tag) continue;
    const key = tag.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 20) break;
  }
  return tags;
}
__name(normalizeTagValues, "normalizeTagValues");
function mapInteraktMessage(message) {
  const direction = String(message?.direction || "").trim().toLowerCase() === "inbound" ? "inbound" : "outbound";
  const contentType = String(message?.content_type || message?.raw?.message_content_type || "Text");
  const messageType = CONTENT_TYPE_MAP[contentType] || "text";
  const presentation = messageType === "template" ? interaktTemplatePresentation(message) : null;
  const text = presentation?.text || interaktMessageText(message);
  const externalId = String(message?.id || "").trim();
  const providerMessageId = String(message?.channel_message_id || "").trim() || (externalId ? `interakt:${externalId}` : "");
  const topMediaUrl = String(message?.media_url || message?.raw?.media_url || "").trim();
  const topMediaFileName = String(message?.media_file_name || message?.raw?.media_file_name || "").trim();
  const templateAttachment = presentation?.attachment || null;
  const mediaUrl = topMediaUrl || String(templateAttachment?.externalUrl || "").trim();
  const mediaFileName = topMediaFileName || String(templateAttachment?.filename || "").trim();
  let attachmentType = String(templateAttachment?.type || "").trim();
  if (!attachmentType && ["image", "video", "audio", "document"].includes(messageType)) {
    attachmentType = messageType;
  }
  if (!attachmentType && (mediaUrl || mediaFileName)) {
    attachmentType = guessAttachmentType(mediaFileName || mediaUrl);
  }
  const replyTo = String(
    message?.reply_to || message?.raw?.reply_channel_message_id || ""
  ).trim();
  const status = mapInteraktStatus(message?.status, direction);
  const statusHistory = interaktStatusHistory(message);
  const timestamp = String(
    message?.timestamp || statusHistory.sentAt || message?.raw?.created_at_utc || ""
  ).trim();
  const error = interaktMessageError(message, status);
  return {
    externalId,
    providerMessageId,
    direction,
    messageType,
    text,
    status,
    error,
    timestamp,
    statusHistory,
    mediaUrl,
    mediaFileName,
    attachmentType,
    replyTo,
    contentType,
    ...presentation?.template ? { template: presentation.template } : {},
    ...templateAttachment && !topMediaUrl ? { attachment: templateAttachment } : {}
  };
}
__name(mapInteraktMessage, "mapInteraktMessage");
function interaktStatusHistory(message) {
  const raw = message?.raw && typeof message.raw === "object" ? message.raw : {};
  const pick = /* @__PURE__ */ __name((...values) => {
    for (const value of values) {
      const text = String(value || "").trim();
      if (text) return text;
    }
    return "";
  }, "pick");
  const status = String(message?.status || raw.message_status || "").trim().toLowerCase();
  const history = {
    sentAt: pick(message?.timestamp, raw.created_at_utc, raw.received_at_utc),
    deliveredAt: pick(raw.delivered_at_utc, message?.delivered_at_utc, message?.delivered_at),
    readAt: pick(raw.seen_at_utc, raw.read_at_utc, message?.seen_at_utc, message?.read_at),
    failedAt: pick(raw.failed_at_utc, message?.failed_at_utc, message?.failed_at),
    updatedAt: pick(raw.modified_at_utc, message?.modified_at_utc)
  };
  if (!history.failedAt && (status === "failed" || status === "error")) {
    history.failedAt = pick(raw.modified_at_utc, raw.created_at_utc, message?.timestamp);
  }
  return Object.fromEntries(Object.entries(history).filter(([, value]) => value));
}
__name(interaktStatusHistory, "interaktStatusHistory");
var PROVIDER_ERROR_LABELS = Object.freeze({
  10: "Permission denied",
  100: "Invalid parameter",
  368: "Temporarily blocked for policies",
  1013: "Recipient is not a valid WhatsApp user",
  1014: "Media URL request failed",
  2001: "Template does not exist",
  130472: "User's phone number is part of an experiment",
  131026: "Message undeliverable",
  131047: "More than 24 hours since the customer last replied",
  131049: "Not delivered to maintain healthy ecosystem engagement",
  131053: "Media download failed",
  132001: "Template does not exist",
  WA400: "Invalid parameter"
});
function normalizeInteraktFailureReason(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    const nested = value?.error && typeof value.error === "object" ? value.error : value;
    const details = nested?.error_data?.details || nested?.details || "";
    const message = nested?.message || nested?.error_user_msg || nested?.title || "";
    const parts = [String(message || "").trim(), String(details || "").trim()].filter(Boolean);
    if (parts.length) return parts.join(" \u2014 ").slice(0, 500);
    try {
      return JSON.stringify(value).slice(0, 500);
    } catch {
      return "";
    }
  }
  const text = String(value).trim();
  if (!text) return "";
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      return normalizeInteraktFailureReason(JSON.parse(text)) || text.slice(0, 500);
    } catch {
      return text.slice(0, 500);
    }
  }
  return text.slice(0, 500);
}
__name(normalizeInteraktFailureReason, "normalizeInteraktFailureReason");
function providerErrorLabel(code) {
  const key = String(code || "").trim();
  if (!key) return "";
  if (PROVIDER_ERROR_LABELS[key]) return PROVIDER_ERROR_LABELS[key];
  const numeric = key.replace(/^#/, "");
  return PROVIDER_ERROR_LABELS[numeric] || "";
}
__name(providerErrorLabel, "providerErrorLabel");
function interaktMessageError(message, status = "") {
  const normalizedStatus = String(status || mapInteraktStatus(message?.status, "outbound") || "").toLowerCase();
  const raw = message?.raw && typeof message.raw === "object" ? message.raw : {};
  let reason = normalizeInteraktFailureReason(
    message?.error || message?.failure_reason || raw.channel_failure_reason || raw.failure_reason || raw.error || ""
  );
  const code = String(
    message?.error_code || message?.channel_error_code || raw.channel_error_code || raw.error_code || ""
  ).trim();
  if (!reason && code) reason = providerErrorLabel(code);
  if (!reason && !code) return "";
  if (normalizedStatus && normalizedStatus !== "failed" && normalizedStatus !== "error") {
    if (!reason) return "";
  }
  if (reason && code && !reason.includes(code)) return `${reason} (${code})`.slice(0, 500);
  if (reason) return reason.slice(0, 500);
  return `Provider error ${code}`.slice(0, 500);
}
__name(interaktMessageError, "interaktMessageError");
function interaktMessageText(message) {
  const presentation = interaktTemplatePresentation(message);
  if (presentation?.text) return presentation.text;
  const raw = String(message?.text || message?.raw?.message || "").trim();
  if (!raw) return mediaFallbackText(message);
  if (raw.startsWith("[") || raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      const fromTemplate = templateParametersText(parsed);
      if (fromTemplate) return fromTemplate;
    } catch {
    }
  }
  return raw;
}
__name(interaktMessageText, "interaktMessageText");
function interaktTemplatePresentation(message) {
  const definition = parseInteraktRawTemplate(message?.raw?.raw_template);
  const components = parseTemplateComponents(message?.text || message?.raw?.message);
  if (!definition && !components) return null;
  const parts = [];
  const buttons = [];
  let attachment = null;
  if (definition) {
    const headerFormat = String(definition.header_format || "").trim().toUpperCase();
    const headerParameters = componentParameters(components, "header");
    const bodyParameters = componentParameters(components, "body");
    const headerTemplate = typeof definition.header === "string" ? definition.header.trim() : "";
    if (headerTemplate) {
      const headerText = replaceTemplateVariables(headerTemplate, headerParameters);
      if (headerText) parts.push(headerText);
    } else if (headerFormat === "DOCUMENT" || headerFormat === "IMAGE" || headerFormat === "VIDEO") {
      attachment = extractTemplateMediaAttachment(headerParameters[0], headerFormat);
    } else if (headerFormat === "TEXT" && headerParameters.length) {
      const headerValue = templateParameterPreview(headerParameters[0]);
      if (headerValue) parts.push(headerValue);
    }
    const bodyTemplate = String(definition.body || "").trim();
    if (bodyTemplate) {
      const bodyText = replaceTemplateVariables(bodyTemplate, bodyParameters);
      if (bodyText) parts.push(bodyText);
    } else {
      const fallback = templateParametersText(components, { skipMedia: true });
      if (fallback) parts.push(fallback);
    }
    const footer = String(definition.footer || "").trim();
    if (footer) parts.push(footer);
    for (const [buttonIndex, button] of parseInteraktButtons(definition.buttons).entries()) {
      if (button.type === "url") {
        const resolvedUrl = resolvedInteraktButtonUrl(button.url, buttonComponentParameters(components, buttonIndex));
        buttons.push(resolvedUrl ? { type: button.type, text: button.text, url: resolvedUrl } : { type: button.type, text: button.text });
        continue;
      }
      buttons.push({ type: button.type, text: button.text });
    }
    if (!attachment && headerParameters.length) {
      attachment = extractTemplateMediaAttachment(headerParameters[0], headerFormat);
    }
  } else {
    const fallback = templateParametersText(components, { skipMedia: true });
    if (fallback) parts.push(fallback);
    const headerParameters = componentParameters(components, "header");
    attachment = extractTemplateMediaAttachment(headerParameters[0], "");
  }
  if (buttons.length) {
    parts.push(`Actions: ${buttons.map((button) => button.text).join(", ")}`);
  }
  const text = parts.filter(Boolean).join("\n").trim();
  if (!text && !definition && !attachment) return null;
  const name = String(definition?.name || "").trim();
  const language = String(definition?.language || "").trim();
  const category = String(definition?.category || "").trim();
  const templateId = String(definition?.wa_template_id || definition?.id || "").trim();
  const template = name && language ? {
    name,
    language: { code: language },
    ...templateId ? { templateId } : {},
    ...category ? { category } : {},
    ...buttons.length ? { buttons } : {}
  } : null;
  return {
    text: text || (name ? `Template: ${name}${language ? ` (${language})` : ""}` : ""),
    template,
    ...attachment ? { attachment } : {}
  };
}
__name(interaktTemplatePresentation, "interaktTemplatePresentation");
function parseInteraktRawTemplate(value) {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
__name(parseInteraktRawTemplate, "parseInteraktRawTemplate");
function parseTemplateComponents(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray(value.components)) return value.components;
  const raw = String(value || "").trim();
  if (!raw || !raw.startsWith("[") && !raw.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.components)) return parsed.components;
  } catch {
    return null;
  }
  return null;
}
__name(parseTemplateComponents, "parseTemplateComponents");
function componentParameters(components, type) {
  if (!Array.isArray(components)) return [];
  const match = components.find((component) => String(component?.type || "").toLowerCase() === type);
  return Array.isArray(match?.parameters) ? match.parameters : [];
}
__name(componentParameters, "componentParameters");
function parseInteraktButtons(value) {
  let buttons = value;
  if (typeof buttons === "string") {
    const raw = buttons.trim();
    if (!raw || raw === "{}" || raw === "[]") return [];
    try {
      buttons = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(buttons)) return [];
  const out = [];
  for (const button of buttons) {
    if (!button || typeof button !== "object") continue;
    const type = String(button.type || "").trim().toLowerCase();
    const text = String(button.text || "").trim().slice(0, 100);
    if (!text) continue;
    const normalized = type === "url" || type === "phone_number" || type === "quick_reply" || type === "copy_code" || type === "catalog" || type === "mpm" || type === "flow" || type === "otp" ? type : type === "phone number" ? "phone_number" : type ? type : "quick_reply";
    const item = { type: normalized, text };
    if (normalized === "url") {
      const url = String(button.url || "").trim().slice(0, 2048);
      if (url) item.url = url;
    }
    out.push(item);
    if (out.length >= 10) break;
  }
  return out;
}
__name(parseInteraktButtons, "parseInteraktButtons");
function buttonComponentParameters(components, buttonIndex) {
  if (!Array.isArray(components)) return [];
  const match = components.find((component) => {
    if (String(component?.type || "").toLowerCase() !== "button") return false;
    return Number(component.index) === Number(buttonIndex);
  });
  return Array.isArray(match?.parameters) ? match.parameters : [];
}
__name(buttonComponentParameters, "buttonComponentParameters");
function resolvedInteraktButtonUrl(rawUrl, parameters) {
  const source = String(rawUrl || "").trim();
  if (!source) return "";
  const resolved = replaceTemplateVariables(source, parameters);
  if (!/^https:\/\//i.test(resolved) || /\{\{/.test(resolved)) return "";
  return resolved.slice(0, 2048);
}
__name(resolvedInteraktButtonUrl, "resolvedInteraktButtonUrl");
function replaceTemplateVariables(text, parameters) {
  const values = (Array.isArray(parameters) ? parameters : []).map(templateParameterPreview);
  let fallbackIndex = 0;
  return String(text || "").replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, rawKey) => {
    const key = String(rawKey || "").trim();
    let value;
    if (/^\d+$/.test(key)) value = values[Number(key) - 1];
    if (value === void 0) value = values[fallbackIndex++];
    return value === void 0 || value === "" ? match : value;
  });
}
__name(replaceTemplateVariables, "replaceTemplateVariables");
function templateParameterPreview(parameter) {
  if (!parameter || typeof parameter !== "object") return "";
  const type = String(parameter.type || "").toLowerCase();
  if (type === "text") return String(parameter.text || "").trim();
  if (type === "document") return String(parameter.document?.filename || parameter.document?.link || "Document").trim();
  if (type === "image") return "Image";
  if (type === "video") return "Video";
  if (type === "currency" && parameter.currency) {
    return String(parameter.currency.fallback_value || parameter.currency.code || "").trim();
  }
  if (type === "date_time" && parameter.date_time) {
    return String(parameter.date_time.fallback_value || "").trim();
  }
  if (type === "payload") return String(parameter.payload || "").trim();
  return "";
}
__name(templateParameterPreview, "templateParameterPreview");
function guessAttachmentType(value) {
  const lower = String(value || "").toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp)(?:\?|$)/i.test(lower)) return "image";
  if (/\.(mp4|mov|webm|m4v)(?:\?|$)/i.test(lower)) return "video";
  if (/\.(mp3|ogg|wav|m4a|aac|opus)(?:\?|$)/i.test(lower)) return "audio";
  if (/\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip|rar)(?:\?|$)/i.test(lower)) return "document";
  return value ? "document" : "";
}
__name(guessAttachmentType, "guessAttachmentType");
function extractTemplateMediaAttachment(parameter, format = "") {
  if (!parameter || typeof parameter !== "object") return null;
  const rawType = String(parameter.type || format || "").trim().toLowerCase();
  const type = rawType === "document" || format === "DOCUMENT" ? "document" : rawType === "image" || format === "IMAGE" ? "image" : rawType === "video" || format === "VIDEO" ? "video" : "";
  if (!type) return null;
  const media = parameter[type] && typeof parameter[type] === "object" ? parameter[type] : {};
  const externalUrl = String(media.link || media.url || "").trim();
  let filename = String(media.filename || "").trim();
  if (!filename && externalUrl) {
    try {
      filename = decodeURIComponent(new URL(externalUrl).pathname.split("/").filter(Boolean).at(-1) || "");
    } catch {
      filename = "";
    }
  }
  if (!externalUrl && !filename) return null;
  return {
    type,
    filename: filename || `${type}-attachment`,
    ...externalUrl ? { externalUrl } : {}
  };
}
__name(extractTemplateMediaAttachment, "extractTemplateMediaAttachment");
function isMediaParameter(parameter) {
  const type = String(parameter?.type || "").toLowerCase();
  return type === "document" || type === "image" || type === "video";
}
__name(isMediaParameter, "isMediaParameter");
function templateParametersText(value, { skipMedia = false } = {}) {
  const parts = [];
  const components = Array.isArray(value) ? value : Array.isArray(value?.components) ? value.components : null;
  if (!components) return "";
  for (const component of components) {
    for (const parameter of component?.parameters || []) {
      if (skipMedia && isMediaParameter(parameter)) continue;
      const preview = templateParameterPreview(parameter);
      if (preview) parts.push(preview);
    }
  }
  return parts.join(" \xB7 ");
}
__name(templateParametersText, "templateParametersText");
function mediaFallbackText(message) {
  const contentType = String(message?.content_type || "Text");
  const fileName = String(message?.media_file_name || "").trim();
  if (fileName) return fileName;
  if (CONTENT_TYPE_MAP[contentType] && contentType !== "Text" && contentType !== "Template") {
    return contentType;
  }
  return "";
}
__name(mediaFallbackText, "mediaFallbackText");
function mapInteraktStatus(value, direction) {
  const mapped = STATUS_MAP[String(value || "").trim().toLowerCase()];
  if (mapped) return mapped;
  return direction === "inbound" ? "received" : "sent";
}
__name(mapInteraktStatus, "mapInteraktStatus");
function normalizeConversationStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "closed" || status === "resolved") return "closed";
  if (status === "pending" || status === "waiting") return "pending";
  return "open";
}
__name(normalizeConversationStatus, "normalizeConversationStatus");
function validateInteraktBatch(conversations) {
  if (!Array.isArray(conversations)) {
    const error = new Error("Interakt import requires a conversations array.");
    error.status = 400;
    throw error;
  }
  if (conversations.length > 50) {
    const error = new Error("Send at most 50 conversations per import request.");
    error.status = 400;
    throw error;
  }
  return conversations;
}
__name(validateInteraktBatch, "validateInteraktBatch");

// worker/src/campaigns.js
var CAMPAIGN_AUDIENCE_SOURCES = Object.freeze(["contacts", "upload"]);
var CAMPAIGN_MESSAGE_TYPES = Object.freeze(["template", "text"]);
var CAMPAIGN_STATUSES = Object.freeze([
  "queued",
  "sending",
  "completed",
  "completed_with_errors",
  "failed",
  "cancelled"
]);
var CAMPAIGN_RECIPIENT_STATUSES = Object.freeze([
  "pending",
  "queued",
  "sent",
  "delivered",
  "read",
  "failed"
]);
var MAX_CAMPAIGN_RECIPIENTS = 500;
var CAMPAIGN_CONTACT_FIELD_TARGETS = Object.freeze([
  { key: "displayName", label: "Name", required: false },
  { key: "profileId", label: "Messaging ID / Phone", required: true },
  { key: "company", label: "Company", required: false },
  { key: "tags", label: "Tags", required: false }
]);
function normalizeCampaignStatusRank(status) {
  const value = String(status || "").toLowerCase();
  if (value === "read") return 5;
  if (value === "delivered") return 4;
  if (value === "sent" || value === "submitted") return 3;
  if (value === "failed") return 2;
  if (value === "retrying" || value === "pending" || value === "queued") return 1;
  return 0;
}
__name(normalizeCampaignStatusRank, "normalizeCampaignStatusRank");
function mapMessageStatusToCampaignRecipient(status) {
  const value = String(status || "").toLowerCase();
  if (value === "read") return "read";
  if (value === "delivered") return "delivered";
  if (value === "failed") return "failed";
  if (value === "sent" || value === "submitted") return "sent";
  if (value === "retrying") return "queued";
  return "pending";
}
__name(mapMessageStatusToCampaignRecipient, "mapMessageStatusToCampaignRecipient");
function preferCampaignRecipientStatus(current, next) {
  const currentRank = normalizeCampaignStatusRank(current);
  const nextRank = normalizeCampaignStatusRank(next);
  if (String(current || "").toLowerCase() === "failed") return "failed";
  if (String(next || "").toLowerCase() === "failed") return "failed";
  return nextRank >= currentRank ? mapMessageStatusToCampaignRecipient(next) : mapMessageStatusToCampaignRecipient(current);
}
__name(preferCampaignRecipientStatus, "preferCampaignRecipientStatus");
function campaignCountsFromRows(rows = []) {
  const counts = {
    totalCount: rows.length,
    pendingCount: 0,
    sentCount: 0,
    deliveredCount: 0,
    readCount: 0,
    failedCount: 0
  };
  for (const row of rows) {
    const status = String(row.status || row.recipient_status || "pending").toLowerCase();
    if (status === "failed") counts.failedCount += 1;
    else if (status === "read") {
      counts.readCount += 1;
      counts.deliveredCount += 1;
      counts.sentCount += 1;
    } else if (status === "delivered") {
      counts.deliveredCount += 1;
      counts.sentCount += 1;
    } else if (status === "sent" || status === "submitted") counts.sentCount += 1;
    else counts.pendingCount += 1;
  }
  return counts;
}
__name(campaignCountsFromRows, "campaignCountsFromRows");
function campaignFinalStatus(counts) {
  if (!counts.totalCount) return "failed";
  if (counts.pendingCount > 0) return "sending";
  if (counts.failedCount > 0 && counts.failedCount >= counts.totalCount) return "failed";
  if (counts.failedCount > 0) return "completed_with_errors";
  return "completed";
}
__name(campaignFinalStatus, "campaignFinalStatus");
function resolveCampaignVariableValue(mapping, { contact = {}, row = {}, profileId = "" } = {}) {
  const source = String(mapping?.source || "").trim();
  if (!source || source === "constant" || source === "manual") {
    return String(mapping?.value ?? "").trim();
  }
  if (source === "upload" || source === "url") {
    return String(mapping?.value ?? "").trim();
  }
  if (source.startsWith("field.")) {
    const header = source.slice("field.".length);
    return String(row?.[header] ?? "").trim();
  }
  if (source.startsWith("contact.")) {
    const key = source.slice("contact.".length);
    if (key === "displayName" || key === "name") return String(contact.displayName || contact.display_name || "").trim();
    if (key === "company") return String(contact.company || "").trim();
    if (key === "tags") {
      const tags = Array.isArray(contact.tags) ? contact.tags : [];
      return tags.join(", ");
    }
    if (key === "profileId" || key === "channelProfileId") {
      return String(profileId || contact.profileId || contact.channelProfileId || "").trim();
    }
    return String(contact[key] ?? "").trim();
  }
  return String(mapping?.value ?? "").trim();
}
__name(resolveCampaignVariableValue, "resolveCampaignVariableValue");
function applyTextVariables(template, variables, context) {
  const text = String(template || "");
  if (!text) return "";
  const map = /* @__PURE__ */ new Map();
  for (const item of Array.isArray(variables) ? variables : []) {
    const key = String(item?.key || item?.placeholder || "").trim();
    if (!key) continue;
    map.set(key, resolveCampaignVariableValue(item, context));
  }
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, rawKey) => {
    const key = String(rawKey || "").trim();
    return map.has(key) ? map.get(key) : match;
  });
}
__name(applyTextVariables, "applyTextVariables");
function buildTemplateComponentsFromMappings(mappings, context) {
  const componentMap = /* @__PURE__ */ new Map();
  for (const mapping of Array.isArray(mappings) ? mappings : []) {
    const kind = String(mapping?.kind || "text").toLowerCase();
    const componentType = String(mapping?.componentType || mapping?.component || "body").toLowerCase();
    const buttonIndex = Number(mapping?.buttonIndex ?? 0);
    let key = componentType;
    if (componentType === "button") key = `button:${buttonIndex}`;
    if (!componentMap.has(key)) {
      componentMap.set(key, componentType === "button" ? {
        type: "button",
        sub_type: String(mapping?.subType || "url"),
        index: String(buttonIndex),
        parameters: []
      } : { type: componentType, parameters: [] });
    }
    const component = componentMap.get(key);
    const value = resolveCampaignVariableValue(mapping, context);
    if (kind === "media") {
      const mediaType = String(mapping?.mediaType || "image").toLowerCase();
      const source = String(mapping?.source || "").toLowerCase();
      if (source === "url" || String(value).startsWith("https://")) {
        component.parameters.push({ type: mediaType, [mediaType]: { link: value } });
      } else {
        component.parameters.push({ type: mediaType, [mediaType]: { id: value } });
      }
    } else if (kind === "location") {
      const [coordinates, name = "", address = ""] = String(value).split("|").map((part) => part.trim());
      const [latitude, longitude] = coordinates.split(",").map((part) => Number(part.trim()));
      component.parameters.push({
        type: "location",
        location: {
          latitude,
          longitude,
          ...name ? { name } : {},
          ...address ? { address } : {}
        }
      });
    } else {
      const parameter = { type: "text", text: value };
      if (mapping?.parameterName) parameter.parameter_name = String(mapping.parameterName);
      component.parameters.push(parameter);
    }
  }
  return [...componentMap.values()];
}
__name(buildTemplateComponentsFromMappings, "buildTemplateComponentsFromMappings");
function serializeCampaign(row, counts = null) {
  const totals = counts || {
    totalCount: Number(row.total_count || 0),
    pendingCount: Number(row.pending_count || 0),
    sentCount: Number(row.sent_count || 0),
    deliveredCount: Number(row.delivered_count || 0),
    readCount: Number(row.read_count || 0),
    failedCount: Number(row.failed_count || 0)
  };
  return {
    campaignId: row.campaign_id,
    name: row.name || "",
    channelId: row.channel_id || "",
    channelName: row.channel_name || "",
    connectorType: row.connector_type || row.provider_type || "",
    audienceSource: row.audience_source || "contacts",
    messageType: row.message_type || "text",
    templateName: row.template_name || "",
    templateLanguage: row.template_language || "",
    messageBody: row.message_body || "",
    variableMapping: safeJson(row.variable_mapping_json, []),
    fieldMapping: safeJson(row.field_mapping_json, {}),
    status: row.status || "queued",
    ...totals,
    createdBy: row.created_by || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    completedAt: row.completed_at || ""
  };
}
__name(serializeCampaign, "serializeCampaign");
function serializeCampaignRecipient(row) {
  return {
    recipientId: row.recipient_id,
    campaignId: row.campaign_id,
    contactId: row.contact_id || "",
    conversationId: row.conversation_id || "",
    messageId: row.message_id || "",
    displayName: row.display_name || "",
    profileId: row.profile_id || "",
    row: safeJson(row.row_json, {}),
    status: row.status || "pending",
    error: row.error || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    messageStatus: row.message_status || "",
    messageText: row.message_text || "",
    messageTimestamp: row.message_timestamp || ""
  };
}
__name(serializeCampaignRecipient, "serializeCampaignRecipient");
function safeJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
__name(safeJson, "safeJson");

// worker/src/index.js
var API_VERSION = "2026-10-26-chat-media";
var MAX_TEXT_LENGTH = 4096;
var MAX_TEMPLATE_PREVIEW_LENGTH = 16384;
var MAX_RAW_PAYLOAD = 64e3;
var MAX_JSON_BODY = 32768;
var MAX_IMPORT_JSON_BODY = 15e5;
var MAX_EXTERNAL_JSON_BODY = 131072;
var MAX_CREDENTIAL_LENGTH = 4096;
var WHATSAPP_REPLY_WINDOW_MS = 24 * 60 * 60 * 1e3;
var MAX_CONVERSATION_LIST_LIMIT = 2e3;
var MAX_CONTACT_LIST_LIMIT = 2e3;
var BOOTSTRAP_CONVERSATION_LIMIT = 100;
var BOOTSTRAP_CONTACT_LIMIT = 100;
var DEFAULT_CONVERSATION_PAGE_SIZE = 100;
var DEFAULT_CONTACT_PAGE_SIZE = 100;
var MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;
var MAX_ATTACHMENT_CAPTION_LENGTH = 1024;
var WHATSAPP_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
var TELEGRAM_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
var EXTERNAL_API_OPERATION = "whatsapp.template.send";
var EXTERNAL_API_IDEMPOTENCY_DAYS = 7;
var LEGACY_WORKSPACE_ID = "ws_default";
var WHATSAPP_TEMPLATE_CACHE_SECONDS = 5 * 60;
var WHATSAPP_TEMPLATE_CACHE_ORIGIN = "https://template-cache.helixcer.internal";
var MANAGED_CONNECTORS = /* @__PURE__ */ new Set(["whatsapp_cloud", "telegram", "instagram", "facebook_messenger"]);
var CONTACT_ID_PLATFORMS = Object.freeze(["whatsapp", "telegram", "instagram", "facebook", "email"]);
var CONTACT_ID_PLATFORM_SET = new Set(CONTACT_ID_PLATFORMS);
var PORTABLE_IDENTITY_PLATFORMS = /* @__PURE__ */ new Set(["whatsapp", "telegram"]);
var TEMPLATE_BUTTON_TYPES = /* @__PURE__ */ new Set(["quick_reply", "url", "phone_number", "copy_code", "catalog", "mpm", "flow", "otp"]);
var CONNECTOR_DEFINITIONS = {
  whatsapp_cloud: {
    label: "WhatsApp Cloud API",
    webhookPath: "whatsapp",
    configFields: ["wabaId", "phoneNumberId", "apiVersion"],
    requiredConfig: ["wabaId", "phoneNumberId"],
    requiredCredentials: ["accessToken", "verifyToken", "appSecret"],
    capabilities: ["text", "attachments"]
  },
  telegram: {
    label: "Telegram Bot",
    webhookPath: "telegram",
    configFields: [],
    requiredConfig: [],
    requiredCredentials: ["botToken", "webhookSecret"],
    capabilities: ["text", "attachments"]
  },
  instagram: {
    label: "Instagram Messaging",
    webhookPath: "instagram",
    configFields: ["instagramAccountId", "username", "appId", "apiVersion", "authMode"],
    requiredConfig: ["instagramAccountId"],
    requiredCredentials: ["accessToken", "verifyToken", "appSecret"],
    capabilities: ["text", "attachments"]
  },
  facebook_messenger: {
    label: "Facebook Messenger",
    webhookPath: "facebook-messenger",
    configFields: ["pageId", "pageName", "appId", "apiVersion"],
    requiredConfig: ["pageId"],
    requiredCredentials: ["accessToken", "verifyToken", "appSecret"],
    capabilities: ["text", "attachments"]
  }
};
var index_default = {
  fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
  scheduled(_event, env, ctx) {
    ctx.waitUntil(Promise.all([retryDueMessages(env), cleanupExpiredAuth(env), cleanupExpiredExternalRequests(env)]));
  }
};
var InboxHub = class {
  static {
    __name(this, "InboxHub");
  }
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/external-api-rate-limit") {
      if (!this.state.storage) return json({ ok: false, error: "Rate limiter unavailable." }, 503);
      const input = await request.json().catch(() => ({}));
      const keyHash = String(input.keyHash || "");
      if (!/^[a-f0-9]{64}$/.test(keyHash)) return json({ ok: false, error: "Invalid rate-limit key." }, 400);
      const windowSeconds = clampInt(this.env.EXTERNAL_API_RATE_LIMIT_WINDOW_SECONDS, 1, 3600, 60);
      const perKeyLimit = clampInt(this.env.EXTERNAL_API_RATE_LIMIT_PER_KEY, 1, 1e4, 60);
      const workspaceLimit = clampInt(this.env.EXTERNAL_API_RATE_LIMIT_PER_WORKSPACE, perKeyLimit, 1e5, 300);
      const now = Date.now();
      const windowMs = windowSeconds * 1e3;
      const windowStart = Math.floor(now / windowMs) * windowMs;
      const result = await this.state.storage.transaction(async (storage) => {
        const stored = await storage.get("external-api-rate-window");
        const record = stored?.windowStart === windowStart ? stored : { windowStart, total: 0, keys: {} };
        const keyCount = Number(record.keys?.[keyHash] || 0);
        const retryAfter = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1e3));
        if (record.total >= workspaceLimit || keyCount >= perKeyLimit) {
          return { allowed: false, retryAfter, remaining: 0, perKeyLimit };
        }
        record.total++;
        record.keys[keyHash] = keyCount + 1;
        await storage.put("external-api-rate-window", record);
        return { allowed: true, retryAfter, remaining: Math.max(0, perKeyLimit - keyCount - 1), perKeyLimit };
      });
      return new Response(null, {
        status: result.allowed ? 204 : 429,
        headers: {
          "Cache-Control": "no-store",
          "X-RateLimit-Limit": String(result.perKeyLimit),
          "X-RateLimit-Remaining": String(result.remaining),
          ...result.allowed ? {} : { "Retry-After": String(result.retryAfter) }
        }
      });
    }
    if (request.method === "POST" && url.pathname === "/oauth-rate-limit") {
      if (!this.state.storage) return json({ ok: false, error: "Rate limiter unavailable." }, 503);
      const clientHash = (await request.text()).trim();
      if (!/^[a-f0-9]{64}$/.test(clientHash)) return json({ ok: false, error: "Invalid rate-limit key." }, 400);
      const windowSeconds = clampInt(this.env.OAUTH_RATE_LIMIT_WINDOW_SECONDS, 60, 3600, 600);
      const perClientLimit = clampInt(this.env.OAUTH_RATE_LIMIT_PER_CLIENT, 1, 100, 10);
      const globalLimit = clampInt(this.env.OAUTH_RATE_LIMIT_GLOBAL, perClientLimit, 5e3, 500);
      const now = Date.now();
      const windowMs = windowSeconds * 1e3;
      const windowStart = Math.floor(now / windowMs) * windowMs;
      const result = await this.state.storage.transaction(async (storage) => {
        const stored = await storage.get("oauth-rate-window");
        const record = stored?.windowStart === windowStart ? stored : { windowStart, total: 0, clients: {} };
        const clientCount = Number(record.clients?.[clientHash] || 0);
        const retryAfter = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1e3));
        if (record.total >= globalLimit || clientCount >= perClientLimit) return { allowed: false, retryAfter };
        record.total++;
        if (clientCount > 0 || Object.keys(record.clients).length < 512) record.clients[clientHash] = clientCount + 1;
        await storage.put("oauth-rate-window", record);
        return { allowed: true, retryAfter };
      });
      return new Response(null, {
        status: result.allowed ? 204 : 429,
        headers: {
          "Cache-Control": "no-store",
          ...result.allowed ? {} : { "Retry-After": String(result.retryAfter) }
        }
      });
    }
    if (request.method === "POST" && url.pathname === "/broadcast") {
      const body = await request.text();
      for (const socket of this.state.getWebSockets()) {
        try {
          if (await this.socketAuthorized(socket)) socket.send(body);
          else socket.close(1008, "Session expired or access changed");
        } catch {
        }
      }
      return new Response(null, { status: 204 });
    }
    if (request.method === "POST" && url.pathname === "/disconnect") {
      const target = await request.json().catch(() => ({}));
      for (const socket of this.state.getWebSockets()) {
        const attachment2 = socket.deserializeAttachment?.() || {};
        if (target.sessionId && attachment2.sessionId === target.sessionId || target.membershipId && attachment2.membershipId === target.membershipId) {
          try {
            socket.close(1008, "Session ended or access changed");
          } catch {
          }
        }
      }
      return new Response(null, { status: 204 });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ ok: false, error: "WebSocket upgrade required." }, 426);
    }
    const attachment = {
      sessionId: request.headers.get("X-Helixcer-Session-Id") || "",
      membershipId: request.headers.get("X-Helixcer-Membership-Id") || "",
      expiresAt: request.headers.get("X-Helixcer-Session-Expires-At") || ""
    };
    if (!attachment.sessionId || !attachment.membershipId || !attachment.expiresAt) {
      return json({ ok: false, error: "A verified session is required." }, 401);
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment?.(attachment);
    this.state.acceptWebSocket(server);
    server.send(JSON.stringify({ type: "connected", at: (/* @__PURE__ */ new Date()).toISOString() }));
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(socket, message) {
    if (!await this.socketAuthorized(socket)) {
      try {
        socket.close(1008, "Session expired or access changed");
      } catch {
      }
      return;
    }
    if (message === "ping") socket.send("pong");
  }
  webSocketError(socket) {
    try {
      socket.close(1011, "Realtime connection error");
    } catch {
    }
  }
  async socketAuthorized(socket) {
    const attachment = socket.deserializeAttachment?.() || {};
    if (!attachment.sessionId || !attachment.membershipId || !attachment.expiresAt || attachment.expiresAt <= (/* @__PURE__ */ new Date()).toISOString()) return false;
    const active = await this.env.DB.prepare(`SELECT 1 FROM sessions s
      JOIN memberships m ON m.membership_id=?2 AND m.user_id=s.user_id AND m.workspace_id=s.workspace_id
      JOIN workspaces w ON w.workspace_id=s.workspace_id AND w.status='active'
      WHERE s.session_id=?1 AND s.revoked_at IS NULL AND s.expires_at>?3 AND m.status='active'`).bind(attachment.sessionId, attachment.membershipId, (/* @__PURE__ */ new Date()).toISOString()).first();
    return Boolean(active);
  }
};
async function handleRequest(request, env, ctx = { waitUntil() {
} }) {
  const url = new URL(request.url);
  const cors = corsHeaders(request.headers.get("Origin") || "", env.ALLOWED_ORIGINS || "");
  if (request.method === "OPTIONS") {
    if (url.pathname.startsWith("/api/v1/")) {
      return json({ status: false, error: { code: "server_to_server_only", message: "This API does not accept browser CORS requests." } }, 405);
    }
    if (!cors["Access-Control-Allow-Origin"]) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: cors });
  }
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      return withCors(json({ ok: true, service: "helixcer-chat-api", version: API_VERSION }), cors);
    }
    if (request.method === "GET" && url.pathname === "/auth/google/start") {
      const limited = await enforceOAuthRateLimit(request, env);
      if (limited) return limited;
      return await startGoogleOAuth(request, env);
    }
    if (request.method === "GET" && url.pathname === "/auth/google/callback") return await finishGoogleOAuthResponse(request, env);
    if (request.method === "GET" && url.pathname === "/auth/mobile/config") {
      return json(mobileAuthConfiguration(env));
    }
    if (request.method === "POST" && url.pathname === "/auth/mobile/challenge") {
      const limited = await enforceOAuthRateLimit(request, env);
      if (limited) return limited;
      return json(await createMobileAuthChallenge(env, await readJson(request)), 201);
    }
    if (request.method === "POST" && url.pathname === "/auth/mobile/google") {
      const limited = await enforceOAuthRateLimit(request, env);
      if (limited) return limited;
      return json(await createGoogleMobileSession(env, await readJson(request)));
    }
    if (request.method === "POST" && (url.pathname === "/auth/logout" || url.pathname === "/api/logout")) {
      const logoutPrincipal = await authenticateRequest(request, env);
      if (logoutPrincipal?.authType === "session" && !cors["Access-Control-Allow-Origin"]) {
        return json({ ok: false, error: "Origin not allowed." }, 403);
      }
      if (!logoutPrincipal && !cors["Access-Control-Allow-Origin"]) {
        return json({ ok: false, error: "Origin not allowed." }, 403);
      }
      const response = await logout(request, env);
      if (logoutPrincipal?.authType === "session" || logoutPrincipal?.authType === "mobile_session") {
        await disconnectRealtime(env, logoutPrincipal.workspace.workspaceId, { sessionId: logoutPrincipal.sessionId });
      }
      return withCors(response, cors);
    }
    if (request.method === "GET" && url.pathname === "/auth/invite") {
      if (request.headers.get("Origin") && !cors["Access-Control-Allow-Origin"]) {
        return json({ ok: false, error: "Origin not allowed." }, 403);
      }
      return withCors(json(await previewInvitation(env, url.searchParams.get("token") || url.searchParams.get("invite") || "")), cors);
    }
    if (request.method === "POST" && url.pathname === "/auth/login") {
      if (!cors["Access-Control-Allow-Origin"]) return json({ ok: false, error: "Origin not allowed." }, 403);
      const limited = await enforceOAuthRateLimit(request, env);
      if (limited) return withCors(limited, cors);
      const result = await loginWithPassword(env, await readJson(request));
      return withCors(passwordSessionResponse(result), cors);
    }
    if (request.method === "POST" && url.pathname === "/auth/forgot-password") {
      if (!cors["Access-Control-Allow-Origin"]) return json({ ok: false, error: "Origin not allowed." }, 403);
      const limited = await enforceOAuthRateLimit(request, env);
      if (limited) return withCors(limited, cors);
      return withCors(json(await requestPasswordReset(env, await readJson(request))), cors);
    }
    if (request.method === "POST" && url.pathname === "/auth/reset-password") {
      if (!cors["Access-Control-Allow-Origin"]) return json({ ok: false, error: "Origin not allowed." }, 403);
      const limited = await enforceOAuthRateLimit(request, env);
      if (limited) return withCors(limited, cors);
      const result = await resetPasswordWithToken(env, await readJson(request));
      return withCors(passwordSessionResponse(result), cors);
    }
    if (request.method === "POST" && url.pathname === "/auth/accept-invite") {
      if (!cors["Access-Control-Allow-Origin"]) return json({ ok: false, error: "Origin not allowed." }, 403);
      const limited = await enforceOAuthRateLimit(request, env);
      if (limited) return withCors(limited, cors);
      const result = await acceptInvitationWithPassword(env, await readJson(request));
      return withCors(passwordSessionResponse(result), cors);
    }
    const whatsappMatch = url.pathname.match(/^\/webhooks\/whatsapp\/([^/]+)$/);
    if (whatsappMatch) return await handleWhatsAppWebhook(request, env, decodeURIComponent(whatsappMatch[1]), ctx);
    const telegramMatch = url.pathname.match(/^\/webhooks\/telegram\/([^/]+)$/);
    if (telegramMatch && request.method === "POST") return await handleTelegramWebhook(request, env, decodeURIComponent(telegramMatch[1]), ctx);
    const instagramAppMatch = url.pathname.match(/^\/webhooks\/instagram-app\/([^/]+)$/);
    if (instagramAppMatch) return await handleInstagramAppWebhook(request, env, decodeURIComponent(instagramAppMatch[1]), ctx);
    const instagramMatch = url.pathname.match(/^\/webhooks\/instagram\/([^/]+)$/);
    if (instagramMatch) return await handleInstagramWebhook(request, env, decodeURIComponent(instagramMatch[1]), ctx);
    const messengerAppMatch = url.pathname.match(/^\/webhooks\/facebook-messenger-app\/([^/]+)$/);
    if (messengerAppMatch) return await handleFacebookMessengerAppWebhook(request, env, decodeURIComponent(messengerAppMatch[1]), ctx);
    const messengerMatch = url.pathname.match(/^\/webhooks\/facebook-messenger\/([^/]+)$/);
    if (messengerMatch) return await handleFacebookMessengerWebhook(request, env, decodeURIComponent(messengerMatch[1]), ctx);
    const genericMatch = url.pathname.match(/^\/webhooks\/generic\/([^/]+)$/);
    if (genericMatch && request.method === "POST") return await handleGenericWebhook(request, env, decodeURIComponent(genericMatch[1]), ctx);
    if (url.pathname.startsWith("/api/v1/")) return await handleExternalApi(request, env, ctx, url);
    if (!url.pathname.startsWith("/api/")) return withCors(json({ ok: false, error: "Not found." }, 404), cors);
    const mutation = ["POST", "PATCH", "PUT", "DELETE"].includes(request.method);
    if (mutation && request.headers.get("Origin") && !cors["Access-Control-Allow-Origin"]) {
      return json({ ok: false, error: "Origin not allowed." }, 403);
    }
    if (url.pathname === "/api/realtime" && request.headers.get("Origin") && !cors["Access-Control-Allow-Origin"]) {
      return json({ ok: false, error: "Origin not allowed." }, 403);
    }
    const principal = await attachPrincipalPermissions(env, await authenticateRequest(request, env));
    if (!principal) return withCors(json({ ok: false, error: "Unauthorized." }, 401), cors);
    if (mutation && principal.authType === "session" && !cors["Access-Control-Allow-Origin"]) {
      return json({ ok: false, error: "Origin not allowed." }, 403);
    }
    const workspaceId = principal.workspace.workspaceId;
    if (url.pathname.startsWith("/api/platform/")) {
      await assertPlatformAdmin(env, principal);
      if (request.method === "GET" && url.pathname === "/api/platform/me") {
        return withCors(json(await platformProfile(env, principal)), cors);
      }
      if (request.method === "GET" && url.pathname === "/api/platform/overview") {
        return withCors(json(await platformOverview(env)), cors);
      }
      if (url.pathname === "/api/platform/clients") {
        if (request.method === "GET") return withCors(json(await listClientWorkspaces(env, url)), cors);
        if (request.method === "POST") {
          return withCors(json(await createClientWorkspace(env, principal, request, await readJson(request)), 201), cors);
        }
      }
      const clientMatch = url.pathname.match(/^\/api\/platform\/clients\/([^/]+)$/);
      if (clientMatch) {
        const clientId = decodeURIComponent(clientMatch[1]);
        if (request.method === "GET") return withCors(json(await getClientWorkspace(env, clientId)), cors);
        if (request.method === "PATCH") {
          const result = await updateClientWorkspace(env, principal, clientId, await readJson(request));
          if (result.suspended) await disconnectRealtime(env, clientId, {});
          return withCors(json(result), cors);
        }
        if (request.method === "DELETE") {
          const result = await deleteClientWorkspace(env, principal, clientId, await readJson(request));
          await disconnectRealtime(env, clientId, {});
          return withCors(json(result), cors);
        }
      }
      const memberMatch2 = url.pathname.match(/^\/api\/platform\/clients\/([^/]+)\/members\/([^/]+)$/);
      if (memberMatch2) {
        const clientId = decodeURIComponent(memberMatch2[1]);
        const membershipId = decodeURIComponent(memberMatch2[2]);
        if (request.method === "PATCH") {
          const result = await updateWorkspaceMember(env, principal, clientId, membershipId, await readJson(request));
          if (result.item?.status === "disabled") await disconnectRealtime(env, clientId, { membershipId });
          return withCors(json(result), cors);
        }
        if (request.method === "DELETE") {
          const result = await removeWorkspaceMember(env, principal, clientId, membershipId);
          await disconnectRealtime(env, clientId, { membershipId });
          return withCors(json(result), cors);
        }
      }
      const invitationsMatch = url.pathname.match(/^\/api\/platform\/clients\/([^/]+)\/invitations$/);
      if (invitationsMatch && request.method === "POST") {
        const clientId = decodeURIComponent(invitationsMatch[1]);
        return withCors(json(await inviteWorkspaceMember(env, principal, request, clientId, await readJson(request)), 201), cors);
      }
      const invitationMatch2 = url.pathname.match(/^\/api\/platform\/clients\/([^/]+)\/invitations\/([^/]+)$/);
      if (invitationMatch2 && request.method === "DELETE") {
        const clientId = decodeURIComponent(invitationMatch2[1]);
        const invitationId = decodeURIComponent(invitationMatch2[2]);
        return withCors(json(await cancelWorkspaceInvitation(env, principal, clientId, invitationId)), cors);
      }
      if (url.pathname === "/api/platform/admins") {
        if (request.method === "GET") return withCors(json(await listPlatformAdmins(env, principal)), cors);
        if (request.method === "POST") {
          return withCors(json(await addPlatformAdmin(env, principal, request, await readJson(request)), 201), cors);
        }
      }
      const adminMatch = url.pathname.match(/^\/api\/platform\/admins\/([^/]+)$/);
      if (adminMatch && request.method === "DELETE") {
        return withCors(json(await removePlatformAdmin(env, principal, decodeURIComponent(adminMatch[1]))), cors);
      }
      return withCors(json({ ok: false, error: "API route not found." }, 404), cors);
    }
    if (url.pathname === "/api/me" && request.method === "GET") {
      return withCors(json(principalView(principal)), cors);
    }
    if (url.pathname === "/api/me" && request.method === "PATCH") {
      const updated = await updateUserProfile(env, principal, await readJson(request));
      return withCors(json({ ok: true, ...principalView(updated) }), cors);
    }
    if (url.pathname === "/api/me/password" && request.method === "POST") {
      return withCors(json(await changePassword(env, principal, await readJson(request))), cors);
    }
    if (url.pathname === "/api/push/config" && request.method === "GET") {
      if (principal.authType !== "session") return withCors(json({ ok: false, error: "A verified browser session is required." }, 403), cors);
      return withCors(json(pushConfiguration(env)), cors);
    }
    if (url.pathname === "/api/push/subscriptions" && request.method === "POST") {
      const result = await savePushSubscription(env, principal, await readJson(request), request.headers.get("User-Agent") || "");
      return withCors(json(result, 201), cors);
    }
    if (url.pathname === "/api/push/subscriptions" && request.method === "DELETE") {
      return withCors(json(await removePushSubscription(env, principal, await readJson(request))), cors);
    }
    if (url.pathname === "/api/push/mobile-config" && request.method === "GET") {
      if (principal.authType !== "mobile_session") {
        return withCors(json({ ok: false, error: "A verified mobile session is required." }, 403), cors);
      }
      return withCors(json(await mobilePushStatus(env, principal, url.searchParams.get("deviceId") || "")), cors);
    }
    if (url.pathname === "/api/push/mobile-devices" && request.method === "POST") {
      return withCors(json(await saveMobilePushDevice(env, principal, await readJson(request)), 201), cors);
    }
    if (url.pathname === "/api/push/mobile-devices" && request.method === "DELETE") {
      return withCors(json(await removeMobilePushDevice(env, principal, await readJson(request))), cors);
    }
    if (url.pathname === "/api/realtime" && request.method === "GET") {
      if (principal.authType === "session" && !cors["Access-Control-Allow-Origin"]) {
        return json({ ok: false, error: "Origin not allowed." }, 403);
      }
      if (principal.authType !== "session" && principal.authType !== "mobile_session") {
        return json({ ok: false, error: "A verified session is required for realtime." }, 403);
      }
      const headers = new Headers({
        Upgrade: "websocket",
        "X-Helixcer-Session-Id": principal.sessionId,
        "X-Helixcer-Membership-Id": principal.membership.membershipId,
        "X-Helixcer-Session-Expires-At": principal.sessionExpiresAt
      });
      return inboxHub(env, workspaceId).fetch("https://hub.internal/connect", { headers });
    }
    if (url.pathname === "/api/bootstrap" && request.method === "GET") {
      const allowedChannels = restrictedChannelIds(principal);
      const assignedOnly = chatScope(principal, "view") === "assigned" ? principal : null;
      const bootstrapUrl = withSearchParams(url, {
        limit: url.searchParams.get("limit") || String(BOOTSTRAP_CONVERSATION_LIMIT),
        contactLimit: url.searchParams.get("contactLimit") || String(BOOTSTRAP_CONTACT_LIMIT),
        page: url.searchParams.get("page") || "1"
      });
      const [channelsRaw, conversationPage, contactPage, tags, workspace] = await Promise.all([
        listChannels(env, workspaceId, hasPermission(principal, "channels.manage")),
        chatScope(principal, "view") === "none" ? Promise.resolve({ items: [], nextCursor: "" }) : listConversations(env, workspaceId, bootstrapUrl, {
          allowedChannelIds: allowedChannels,
          assignedOnly
        }),
        hasPermission(principal, "contacts.view") ? listContacts(env, workspaceId, bootstrapUrl) : Promise.resolve({ items: [], total: 0, page: 1, pageSize: BOOTSTRAP_CONTACT_LIMIT, nextCursor: "" }),
        listWorkspaceTags(env, workspaceId),
        getWorkspaceProfile(env, workspaceId)
      ]);
      const channels = allowedChannels ? channelsRaw.filter((channel) => allowedChannels.includes(channel.channelId)) : channelsRaw;
      return withCors(json({
        appName: env.APP_NAME || "Helixcer Chat",
        channels,
        conversations: conversationPage.items,
        conversationNextCursor: conversationPage.nextCursor,
        contacts: contactPage.items,
        contactTotal: contactPage.total,
        contactPage: contactPage.page,
        contactPageSize: contactPage.pageSize,
        contactNextCursor: contactPage.nextCursor,
        tags,
        workspace,
        me: principalView(principal),
        connectorTypes: [
          { value: "whatsapp_cloud", label: "WhatsApp Cloud API", capabilities: CONNECTOR_DEFINITIONS.whatsapp_cloud.capabilities },
          { value: "telegram", label: "Telegram Bot", capabilities: CONNECTOR_DEFINITIONS.telegram.capabilities },
          { value: "instagram", label: "Instagram Messaging", capabilities: CONNECTOR_DEFINITIONS.instagram.capabilities },
          { value: "facebook_messenger", label: "Facebook Messenger", capabilities: CONNECTOR_DEFINITIONS.facebook_messenger.capabilities }
        ]
      }), cors);
    }
    if (url.pathname === "/api/workspace" && request.method === "GET") {
      return withCors(json({ item: await getWorkspaceProfile(env, workspaceId) }), cors);
    }
    if (url.pathname === "/api/workspace" && request.method === "PATCH") {
      requirePermission(principal, "workspace.edit");
      const item = await updateWorkspaceProfile(env, workspaceId, await readJson(request), principal);
      await broadcast(env, workspaceId, { type: "workspace.updated", workspace: item });
      return withCors(json({ ok: true, item }), cors);
    }
    if (url.pathname === "/api/roles" && request.method === "GET") {
      return withCors(json(await listWorkspaceRoles(env, principal)), cors);
    }
    if (url.pathname === "/api/roles" && request.method === "POST") {
      const result = await createWorkspaceRole(env, principal, await readJson(request));
      await broadcast(env, workspaceId, { type: "roles.updated" });
      return withCors(json(result, 201), cors);
    }
    const roleMatch = url.pathname.match(/^\/api\/roles\/([^/]+)$/);
    if (roleMatch && request.method === "PATCH") {
      const result = await updateWorkspaceRole(env, principal, decodeURIComponent(roleMatch[1]), await readJson(request));
      await broadcast(env, workspaceId, { type: "roles.updated" });
      return withCors(json(result), cors);
    }
    if (roleMatch && request.method === "DELETE") {
      const result = await deleteWorkspaceRole(env, principal, decodeURIComponent(roleMatch[1]));
      await broadcast(env, workspaceId, { type: "roles.updated" });
      return withCors(json(result), cors);
    }
    if (url.pathname === "/api/channels" && request.method === "GET") {
      requirePermission(principal, "channels.manage");
      return withCors(json({ items: await listChannels(env, workspaceId, true) }), cors);
    }
    if (url.pathname === "/api/channel-data/whatsapp-templates" && request.method === "GET") {
      requirePermission(principal, "channels.manage");
      return withCors(json(await listWorkspaceWhatsAppTemplates(env, workspaceId, {
        forceRefresh: url.searchParams.get("refresh") === "1"
      })), cors);
    }
    if (url.pathname === "/api/channel-data/import-chat" && request.method === "POST") {
      requirePermission(principal, "channels.manage");
      const result = await importChatHistory(env, workspaceId, principal, await readImportJson(request));
      await broadcast(env, workspaceId, { type: "bootstrap.changed" });
      return withCors(json(result, 201), cors);
    }
    if (url.pathname === "/api/campaigns" && request.method === "GET") {
      requirePermission(principal, "campaigns.view");
      return withCors(json({ items: await listCampaigns(env, workspaceId, principal) }), cors);
    }
    if (url.pathname === "/api/campaigns" && request.method === "POST") {
      requirePermission(principal, "campaigns.manage");
      const result = await createCampaign(env, workspaceId, await readJson(request), principal);
      await broadcast(env, workspaceId, { type: "campaign.updated", campaignId: result.campaignId, campaign: result.item });
      ctx.waitUntil(processCampaign(env, workspaceId, result.campaignId, principal));
      return withCors(json(result, 202), cors);
    }
    const campaignMediaMatch = url.pathname.match(/^\/api\/campaigns\/template-media$/);
    if (campaignMediaMatch && request.method === "POST") {
      requirePermission(principal, "campaigns.manage");
      return withCors(json(await uploadCampaignTemplateMedia(env, workspaceId, request, principal), 201), cors);
    }
    const campaignMatch = url.pathname.match(/^\/api\/campaigns\/([^/]+)$/);
    if (campaignMatch && request.method === "GET") {
      requirePermission(principal, "campaigns.view");
      const campaignId = decodeURIComponent(campaignMatch[1]);
      return withCors(json(await getCampaignDetail(env, workspaceId, campaignId, principal)), cors);
    }
    if (url.pathname === "/api/channels" && request.method === "POST") {
      requirePermission(principal, "channels.manage");
      const result = await saveChannel(env, workspaceId, await readJson(request), principal, "");
      await broadcast(env, workspaceId, { type: "channel.updated", channelId: result.channelId });
      return withCors(json(result, 201), cors);
    }
    const channelMatch = url.pathname.match(/^\/api\/channels\/([^/]+)$/);
    if (channelMatch && request.method === "PATCH") {
      requirePermission(principal, "channels.manage");
      const channelId = decodeURIComponent(channelMatch[1]);
      const result = await saveChannel(env, workspaceId, await readJson(request), principal, channelId);
      await broadcast(env, workspaceId, { type: "channel.updated", channelId });
      return withCors(json(result), cors);
    }
    if (channelMatch && request.method === "DELETE") {
      requirePermission(principal, "channels.manage");
      const channelId = decodeURIComponent(channelMatch[1]);
      const result = await deleteChannel(env, workspaceId, channelId, principal);
      await broadcast(env, workspaceId, { type: "channel.deleted", channelId });
      return withCors(json(result), cors);
    }
    const channelVerifyMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/verify$/);
    if (channelVerifyMatch && request.method === "POST") {
      requirePermission(principal, "channels.manage");
      const channelId = decodeURIComponent(channelVerifyMatch[1]);
      const result = await verifyChannel(env, workspaceId, channelId, request);
      await broadcast(env, workspaceId, { type: "channel.updated", channelId });
      return withCors(json(result), cors);
    }
    const channelVerifyTokenMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/verify-token$/);
    if (channelVerifyTokenMatch && request.method === "GET") {
      requirePermission(principal, "channels.manage");
      const channelId = decodeURIComponent(channelVerifyTokenMatch[1]);
      return withCors(json(await getChannelVerifyToken(env, workspaceId, channelId, principal)), cors);
    }
    if (url.pathname === "/api/conversations" && request.method === "GET") {
      if (chatScope(principal, "view") === "none") {
        throw httpError(403, "You do not have permission to access chats.");
      }
      const page = await listConversations(env, workspaceId, url, {
        allowedChannelIds: restrictedChannelIds(principal),
        assignedOnly: chatScope(principal, "view") === "assigned" ? principal : null
      });
      return withCors(json({ items: page.items, nextCursor: page.nextCursor }), cors);
    }
    if (url.pathname === "/api/conversations" && request.method === "POST") {
      const result = await openIdentityConversation(env, workspaceId, await readJson(request), principal);
      await broadcast(env, workspaceId, { type: "conversation.created", conversationId: result.conversationId });
      return withCors(json(result, 201), cors);
    }
    if (url.pathname === "/api/search/messages" && request.method === "GET") {
      return withCors(json({
        items: await searchMessages(env, workspaceId, url, {
          allowedChannelIds: restrictedChannelIds(principal)
        })
      }), cors);
    }
    const conversationMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
    if (conversationMatch && request.method === "PATCH") {
      const id = decodeURIComponent(conversationMatch[1]);
      await assertConversationChannelAccess(env, workspaceId, id, principal);
      const existing = await getConversation(env, workspaceId, id);
      assertChatAccess(principal, existing, "view");
      const payload = await readJson(request);
      if (payload.assignedTo !== void 0 && !hasPermission(principal, "chats.assign")) {
        throw httpError(403, "You do not have permission to assign conversations.");
      }
      const result = await updateConversation(env, workspaceId, id, payload, principal);
      const item = result.item || result;
      await broadcast(env, workspaceId, { type: "conversation.updated", conversationId: id, conversation: item });
      if (result.statusEvent) {
        await broadcast(env, workspaceId, {
          type: "message.created",
          conversationId: id,
          messageId: result.statusEvent.messageId,
          message: result.statusEvent
        });
      }
      if (result.assignmentEvent) {
        await broadcast(env, workspaceId, {
          type: "message.created",
          conversationId: id,
          messageId: result.assignmentEvent.messageId,
          message: result.assignmentEvent,
          assignmentSilent: !result.assignmentNotify
        });
      }
      if (result.assignmentChanged) {
        await broadcast(env, workspaceId, {
          type: "conversation.assigned",
          conversationId: id,
          conversation: item,
          assignedTo: item.assignedTo || "",
          assignmentSilent: !result.assignmentNotify
        });
      }
      if (result.assignmentNotify) {
        scheduleAssignmentPush(ctx, env, workspaceId, item, result.assignmentNotify);
      }
      if (payload.markRead && Number(item.unreadCount || 0) === 0) {
        scheduleConversationReadPush(ctx, env, workspaceId, item);
      }
      return withCors(json({
        ok: true,
        item,
        ...result.statusEvent ? { statusEvent: result.statusEvent } : {}
      }), cors);
    }
    if (conversationMatch && request.method === "DELETE") {
      requirePermission(principal, "chats.delete");
      const id = decodeURIComponent(conversationMatch[1]);
      const result = await deleteConversation(env, workspaceId, id, principal);
      await broadcast(env, workspaceId, { type: "conversation.deleted", conversationId: id });
      return withCors(json(result), cors);
    }
    const messagesMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (messagesMatch && request.method === "GET") {
      const id = decodeURIComponent(messagesMatch[1]);
      await assertConversationChannelAccess(env, workspaceId, id, principal);
      const existing = await getConversation(env, workspaceId, id);
      assertChatAccess(principal, existing, "view");
      const [items, replyWindow] = await Promise.all([
        listMessages(env, workspaceId, id, url),
        getConversationReplyWindow(env, workspaceId, id)
      ]);
      return withCors(json({ items, ...replyWindow }), cors);
    }
    if (messagesMatch && request.method === "POST") {
      const id = decodeURIComponent(messagesMatch[1]);
      const existing = await getConversation(env, workspaceId, id);
      assertChatAccess(principal, existing, "reply");
      const result = await createOutboundMessage(env, workspaceId, id, await readJson(request), principal);
      await broadcast(env, workspaceId, {
        type: "message.created",
        conversationId: id,
        messageId: result.message.messageId,
        message: result.message
      });
      await broadcastAssignmentSideEffects(env, workspaceId, id, result.assignment);
      ctx.waitUntil(sendOrQueue(env, result.message.messageId));
      return withCors(json(outboundSendResponse(result), 202), cors);
    }
    const messageAttachmentMatch = url.pathname.match(/^\/api\/messages\/([^/]+)\/attachment$/);
    if (messageAttachmentMatch && request.method === "GET") {
      const messageId = decodeURIComponent(messageAttachmentMatch[1]);
      return withCors(await streamMessageAttachment(env, workspaceId, messageId, request, url, principal), cors);
    }
    const conversationTemplatesMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/templates$/);
    if (conversationTemplatesMatch && request.method === "GET") {
      const id = decodeURIComponent(conversationTemplatesMatch[1]);
      await assertConversationChannelAccess(env, workspaceId, id, principal);
      return withCors(json({ items: await listConversationTemplates(env, workspaceId, id, {
        forceRefresh: url.searchParams.get("refresh") === "1",
        channelId: url.searchParams.get("channelId") || "",
        identityId: url.searchParams.get("identityId") || ""
      }) }), cors);
    }
    const templateMessageMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/template$/);
    if (templateMessageMatch && request.method === "POST") {
      const id = decodeURIComponent(templateMessageMatch[1]);
      const existing = await getConversation(env, workspaceId, id);
      assertChatAccess(principal, existing, "reply");
      const result = await createConversationTemplateMessage(env, workspaceId, id, await readJson(request), principal);
      await broadcast(env, workspaceId, {
        type: "message.created",
        conversationId: id,
        messageId: result.message.messageId,
        message: result.message
      });
      await broadcastAssignmentSideEffects(env, workspaceId, id, result.assignment);
      ctx.waitUntil(sendOrQueue(env, result.message.messageId));
      return withCors(json(outboundSendResponse(result), 202), cors);
    }
    const templateMediaMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/template-media$/);
    if (templateMediaMatch && request.method === "POST") {
      const id = decodeURIComponent(templateMediaMatch[1]);
      await assertConversationChannelAccess(env, workspaceId, id, principal);
      return withCors(json(await uploadConversationTemplateMedia(env, workspaceId, id, request), 201), cors);
    }
    const attachmentMessageMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/attachments$/);
    if (attachmentMessageMatch && request.method === "POST") {
      const id = decodeURIComponent(attachmentMessageMatch[1]);
      const existing = await getConversation(env, workspaceId, id);
      assertChatAccess(principal, existing, "reply");
      const result = await createConversationAttachmentMessage(env, workspaceId, id, request, principal);
      await broadcast(env, workspaceId, {
        type: "message.created",
        conversationId: id,
        messageId: result.message.messageId,
        message: result.message
      });
      await broadcastAssignmentSideEffects(env, workspaceId, id, result.assignment);
      if (result.message.status === "pending") ctx.waitUntil(sendOrQueue(env, result.message.messageId));
      return withCors(json(outboundSendResponse(result), 202), cors);
    }
    if (["/api/contacts/export", "/api/contacts/export.csv"].includes(url.pathname) && request.method === "GET") {
      return withCors(await exportContactsCsv(env, workspaceId), cors);
    }
    if (url.pathname === "/api/contacts" && request.method === "POST") {
      requirePermission(principal, "contacts.create");
      const result = await createContact(env, workspaceId, await readJson(request), principal);
      if (result.conversationId) {
        await broadcast(env, workspaceId, { type: "conversation.created", conversationId: result.conversationId });
      } else {
        await broadcast(env, workspaceId, { type: "contact.created", contactId: result.contactId });
      }
      return withCors(json(result, 201), cors);
    }
    if (url.pathname === "/api/contacts" && request.method === "GET") {
      requirePermission(principal, "contacts.view");
      const page = await listContacts(env, workspaceId, url);
      return withCors(json({
        items: page.items,
        nextCursor: page.nextCursor,
        total: page.total,
        page: page.page,
        pageSize: page.pageSize
      }), cors);
    }
    if (url.pathname === "/api/tags" && request.method === "GET") {
      return withCors(json({ items: await listWorkspaceTags(env, workspaceId) }), cors);
    }
    const contactIdentityCollectionMatch = url.pathname.match(/^\/api\/contacts\/([^/]+)\/identities$/);
    if (contactIdentityCollectionMatch && request.method === "POST") {
      requirePermission(principal, "contacts.edit");
      const contactId = decodeURIComponent(contactIdentityCollectionMatch[1]);
      const result = await createContactIdentity(env, workspaceId, contactId, await readJson(request), principal);
      await broadcast(env, workspaceId, { type: "contact.updated", contactId });
      return withCors(json(result, 201), cors);
    }
    const contactIdentityMatch = url.pathname.match(/^\/api\/contacts\/([^/]+)\/identities\/([^/]+)$/);
    if (contactIdentityMatch && request.method === "PATCH") {
      requirePermission(principal, "contacts.edit");
      const contactId = decodeURIComponent(contactIdentityMatch[1]);
      const identityId = decodeURIComponent(contactIdentityMatch[2]);
      const result = await updateContactIdentity(env, workspaceId, contactId, identityId, await readJson(request), principal);
      await broadcast(env, workspaceId, { type: "contact.updated", contactId });
      return withCors(json(result), cors);
    }
    if (contactIdentityMatch && request.method === "DELETE") {
      requirePermission(principal, "contacts.edit");
      const contactId = decodeURIComponent(contactIdentityMatch[1]);
      const identityId = decodeURIComponent(contactIdentityMatch[2]);
      const result = await deleteContactIdentity(env, workspaceId, contactId, identityId, principal);
      await broadcast(env, workspaceId, { type: "contact.updated", contactId });
      return withCors(json(result), cors);
    }
    const contactMatch = url.pathname.match(/^\/api\/contacts\/([^/]+)$/);
    if (contactMatch && request.method === "GET") {
      requirePermission(principal, "contacts.view");
      const id = decodeURIComponent(contactMatch[1]);
      return withCors(json({ item: await getContactDetail(env, workspaceId, id) }), cors);
    }
    if (contactMatch && request.method === "PATCH") {
      requirePermission(principal, "contacts.edit");
      const id = decodeURIComponent(contactMatch[1]);
      const item = await updateContact(env, workspaceId, id, await readJson(request), principal);
      await broadcast(env, workspaceId, { type: "contact.updated", contactId: id });
      return withCors(json({ ok: true, item }), cors);
    }
    if (contactMatch && request.method === "DELETE") {
      requirePermission(principal, "contacts.delete");
      const id = decodeURIComponent(contactMatch[1]);
      const result = await deleteContact(env, workspaceId, id, principal);
      await broadcast(env, workspaceId, { type: "contact.deleted", contactId: id, conversationIds: result.conversationIds });
      return withCors(json(result), cors);
    }
    if (url.pathname === "/api/demo/seed" && request.method === "POST") {
      requirePermission(principal, "channels.manage");
      const result = await seedDemo(env, workspaceId, principal);
      await broadcast(env, workspaceId, { type: "bootstrap.changed" });
      return withCors(json(result, 201), cors);
    }
    if (url.pathname === "/api/developer/api-keys" && request.method === "GET") {
      requirePermission(principal, "developer.manage");
      return withCors(json({ items: await listApiKeys(env, workspaceId) }), cors);
    }
    if (url.pathname === "/api/developer/api-keys" && request.method === "POST") {
      requirePermission(principal, "developer.manage");
      return withCors(json(await createApiKey(env, workspaceId, principal, await readJson(request)), 201), cors);
    }
    const apiKeyMatch = url.pathname.match(/^\/api\/developer\/api-keys\/([^/]+)$/);
    if (apiKeyMatch && request.method === "DELETE") {
      requirePermission(principal, "developer.manage");
      return withCors(json(await deleteApiKey(env, workspaceId, principal, decodeURIComponent(apiKeyMatch[1]))), cors);
    }
    if (url.pathname === "/api/team" && request.method === "GET") {
      return withCors(json(await listTeam(env, principal)), cors);
    }
    if (url.pathname === "/api/team/invitations" && request.method === "POST") {
      const result = await createInvitation(request, env, principal, await readJson(request));
      await broadcast(env, workspaceId, { type: "team.updated" });
      return withCors(json(result, 201), cors);
    }
    const memberMatch = url.pathname.match(/^\/api\/team\/members\/([^/]+)$/);
    if (memberMatch && request.method === "PATCH") {
      const result = await updateMembership(env, principal, decodeURIComponent(memberMatch[1]), await readJson(request));
      await broadcast(env, workspaceId, { type: "team.updated" });
      await disconnectRealtime(env, workspaceId, { membershipId: decodeURIComponent(memberMatch[1]) });
      return withCors(json(result), cors);
    }
    if (memberMatch && request.method === "DELETE") {
      requirePermission(principal, "team.manage");
      const membershipId = decodeURIComponent(memberMatch[1]);
      const result = await deleteTeamMember(env, workspaceId, membershipId, principal);
      await broadcast(env, workspaceId, { type: "team.updated" });
      await disconnectRealtime(env, workspaceId, { membershipId });
      return withCors(json(result), cors);
    }
    const invitationMatch = url.pathname.match(/^\/api\/team\/invitations\/([^/]+)$/);
    if (invitationMatch && request.method === "PATCH") {
      const result = await updateInvitation(env, principal, decodeURIComponent(invitationMatch[1]), await readJson(request));
      await broadcast(env, workspaceId, { type: "team.updated" });
      return withCors(json(result), cors);
    }
    return withCors(json({ ok: false, error: "API route not found." }, 404), cors);
  } catch (error) {
    const status = Number(error.status) || 500;
    if (status >= 500) console.error("request_failed", { path: url.pathname, status, message: error.message });
    return withCors(json({ ok: false, error: status >= 500 ? "The service could not complete the request." : error.message }, status), cors);
  }
}
__name(handleRequest, "handleRequest");
async function listApiKeys(env, workspaceId) {
  const result = await env.DB.prepare(`SELECT api_key_id,name,key_prefix,scopes_json,status,
      expires_at,last_used_at,created_at,updated_at,revoked_at
    FROM api_keys WHERE workspace_id=?1 ORDER BY created_at DESC`).bind(workspaceId).all();
  return (result.results || []).map(publicApiKeyView);
}
__name(listApiKeys, "listApiKeys");
async function createApiKey(env, workspaceId, principal, payload) {
  const name = cleanRequired(payload?.name, "API key name", 120);
  let expiresAt = null;
  if (payload?.expiresAt) {
    const expires = new Date(String(payload.expiresAt));
    if (Number.isNaN(expires.valueOf()) || expires <= /* @__PURE__ */ new Date()) throw httpError(400, "API key expiry must be a future date.");
    expiresAt = expires.toISOString();
  }
  const apiKeyId = crypto.randomUUID();
  const publicId = base64UrlEncode2(crypto.getRandomValues(new Uint8Array(9)));
  const secret = base64UrlEncode2(crypto.getRandomValues(new Uint8Array(32)));
  const keyPrefix = `hxc_live_${publicId}`;
  const apiKey = `${keyPrefix}.${secret}`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(`INSERT INTO api_keys
      (api_key_id,workspace_id,name,key_prefix,secret_hash,scopes_json,allowed_channel_ids_json,status,
       expires_at,created_by_user_id,created_at,updated_at)
    VALUES (?1,?2,?3,?4,?5,?6,?7,'active',?8,?9,?10,?10)`).bind(
    apiKeyId,
    workspaceId,
    name,
    keyPrefix,
    await hashText(apiKey),
    JSON.stringify(["whatsapp:template:send", "messages:read"]),
    "[]",
    expiresAt,
    principal.user.userId || "",
    now
  ).run();
  await audit(env, principal, "create", "api_key", apiKeyId, { keyPrefix });
  return {
    ok: true,
    apiKey,
    item: publicApiKeyView({
      api_key_id: apiKeyId,
      name,
      key_prefix: keyPrefix,
      scopes_json: JSON.stringify(["whatsapp:template:send", "messages:read"]),
      status: "active",
      expires_at: expiresAt,
      last_used_at: null,
      created_at: now,
      updated_at: now,
      revoked_at: null
    })
  };
}
__name(createApiKey, "createApiKey");
async function deleteApiKey(env, workspaceId, principal, apiKeyId) {
  const id = cleanId(apiKeyId, "API key ID");
  const existing = await env.DB.prepare(`SELECT name,key_prefix,status FROM api_keys
    WHERE api_key_id=?1 AND workspace_id=?2`).bind(id, workspaceId).first();
  if (!existing) throw httpError(404, "API key not found.");
  const result = await env.DB.prepare("DELETE FROM api_keys WHERE api_key_id=?1 AND workspace_id=?2").bind(id, workspaceId).run();
  if (!result.meta?.changes) throw httpError(404, "API key not found.");
  await audit(env, principal, "delete", "api_key", id, {
    name: existing.name,
    keyPrefix: existing.key_prefix,
    previousStatus: existing.status
  });
  return { ok: true, apiKeyId: id, deleted: true };
}
__name(deleteApiKey, "deleteApiKey");
function publicApiKeyView(row) {
  return {
    apiKeyId: row.api_key_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: safeJsonParse(row.scopes_json, []),
    status: row.status,
    expiresAt: row.expires_at || "",
    lastUsedAt: row.last_used_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revokedAt: row.revoked_at || ""
  };
}
__name(publicApiKeyView, "publicApiKeyView");
async function deleteTeamMember(env, workspaceId, membershipId, principal) {
  const id = cleanId(membershipId, "Membership ID");
  const target = await env.DB.prepare(`SELECT m.membership_id,m.user_id,m.role,m.status,u.email,u.display_name
    FROM memberships m JOIN users u ON u.user_id=m.user_id
    WHERE m.membership_id=?1 AND m.workspace_id=?2`).bind(id, workspaceId).first();
  if (!target) throw httpError(404, "Team member not found.");
  if (principal.membership?.role !== "owner") {
    const { assertAssignableRole: assertAssignableRole2 } = await Promise.resolve().then(() => (init_roles(), roles_exports));
    const targetRole = await assertAssignableRole2(env, workspaceId, target.role, { allowOwner: target.role === "owner" });
    if (targetRole.isElevated || target.role === "owner") {
      throw httpError(403, "Administrators can only remove non-elevated team members.");
    }
  }
  if (principal.membership?.membershipId && principal.membership.membershipId === id) {
    throw httpError(409, "You cannot remove your own workspace membership.");
  }
  if (target.role === "owner" && target.status === "active") {
    const owners = await env.DB.prepare(`SELECT COUNT(*) AS count FROM memberships
      WHERE workspace_id=?1 AND role='owner' AND status='active'`).bind(workspaceId).first();
    if (Number(owners?.count || 0) <= 1) throw httpError(409, "The workspace must retain at least one active owner.");
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const deleted = await env.DB.batch([
    env.DB.prepare(`DELETE FROM memberships WHERE membership_id=?1 AND workspace_id=?2 AND (
      role!='owner' OR status!='active' OR
      (SELECT COUNT(*) FROM memberships WHERE workspace_id=?2 AND role='owner' AND status='active')>1
    )`).bind(id, workspaceId),
    env.DB.prepare(`UPDATE conversations SET assigned_to='',updated_at=?3
      WHERE workspace_id=?1 AND lower(assigned_to)=lower(?2)
        AND NOT EXISTS (SELECT 1 FROM memberships WHERE membership_id=?4 AND workspace_id=?1)`).bind(workspaceId, target.email, now, id),
    env.DB.prepare(`UPDATE sessions SET revoked_at=?3
      WHERE user_id=?1 AND workspace_id=?2 AND revoked_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM memberships WHERE membership_id=?4 AND workspace_id=?2)`).bind(target.user_id, workspaceId, now, id),
    env.DB.prepare(`DELETE FROM users WHERE user_id=?1
      AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id=?1)
      AND NOT EXISTS (SELECT 1 FROM memberships WHERE membership_id=?2 AND workspace_id=?3)`).bind(target.user_id, id, workspaceId)
  ]);
  if (!deleted[0]?.meta?.changes) throw httpError(409, "The workspace must retain at least one active owner.");
  await audit(env, principal, "delete", "membership", id, {
    targetEmail: target.email,
    targetDisplayName: target.display_name,
    previousRole: target.role,
    previousStatus: target.status
  });
  return { ok: true, membershipId: id, userId: target.user_id, deleted: true };
}
__name(deleteTeamMember, "deleteTeamMember");
async function handleExternalApi(request, env, ctx, url) {
  const requestId = crypto.randomUUID();
  try {
    if (request.headers.get("Origin")) {
      throw apiError(403, "server_to_server_only", "This API is for server-to-server requests and does not accept browser Origin headers.");
    }
    const apiPrincipal = await authenticateApiKey(request, env);
    const rateLimited = await enforceExternalApiRateLimit(env, apiPrincipal, requestId);
    if (rateLimited) return rateLimited;
    if (url.pathname === "/api/v1/whatsapp/template-messages" && request.method === "POST") {
      requireApiScope(apiPrincipal, "whatsapp:template:send");
      const response = await createExternalTemplateMessage(request, env, ctx, url, apiPrincipal, requestId);
      response.headers.set("X-Request-Id", requestId);
      return response;
    }
    if (url.pathname === "/api/v1/whatsapp/templates" && request.method === "GET") {
      requireApiScope(apiPrincipal, "whatsapp:template:send");
      const response = await listExternalWhatsAppTemplates(env, url, apiPrincipal, requestId);
      response.headers.set("X-Request-Id", requestId);
      return response;
    }
    const templateMatch = url.pathname.match(/^\/api\/v1\/whatsapp\/templates\/([^/]+)$/);
    if (templateMatch && request.method === "GET") {
      requireApiScope(apiPrincipal, "whatsapp:template:send");
      const response = await fetchExternalWhatsAppTemplate(
        env,
        url,
        apiPrincipal,
        requestId,
        decodeURIComponent(templateMatch[1])
      );
      response.headers.set("X-Request-Id", requestId);
      return response;
    }
    const statusMatch = url.pathname.match(/^\/api\/v1\/messages\/([^/]+)$/);
    if (statusMatch && request.method === "GET") {
      requireApiScope(apiPrincipal, "messages:read");
      const item = await getExternalMessageStatus(env, apiPrincipal, decodeURIComponent(statusMatch[1]), url);
      const response = json({ status: true, ...item, requestId });
      response.headers.set("X-Request-Id", requestId);
      return response;
    }
    throw apiError(404, "route_not_found", "API route not found.");
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error("external_api_request_failed", { requestId, path: url.pathname, status, message: cleanError(error) });
    const response = json({
      status: false,
      error: {
        code: error?.code || (status >= 500 ? "internal_error" : "invalid_request"),
        message: status >= 500 ? "The service could not complete the request." : cleanError(error),
        requestId
      }
    }, status);
    response.headers.set("X-Request-Id", requestId);
    if (error?.retryAfter) response.headers.set("Retry-After", String(error.retryAfter));
    return response;
  }
}
__name(handleExternalApi, "handleExternalApi");
async function authenticateApiKey(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer (hxc_live_([A-Za-z0-9_-]{8,32})\.([A-Za-z0-9_-]{32,128}))$/);
  if (!match) throw apiError(401, "invalid_api_key", "A valid Bearer API key is required.");
  const token = match[1];
  const keyPrefix = `hxc_live_${match[2]}`;
  const row = await env.DB.prepare(`SELECT api_key_id,workspace_id,key_prefix,secret_hash,scopes_json,
      status,expires_at
    FROM api_keys WHERE key_prefix=?1 LIMIT 1`).bind(keyPrefix).first();
  const suppliedHash = await hashText(token);
  if (!row || !timingSafeEqual2(row.secret_hash || "", suppliedHash) || row.status !== "active" || row.expires_at && row.expires_at <= (/* @__PURE__ */ new Date()).toISOString()) {
    throw apiError(401, "invalid_api_key", "The API key is invalid, expired, or revoked.");
  }
  const workspaceId = String(request.headers.get("X-Workspace-Id") || "").trim();
  if (!workspaceId) {
    throw apiError(400, "workspace_id_required", "The X-Workspace-Id header is required.");
  }
  if (workspaceId !== String(row.workspace_id || "")) {
    throw apiError(403, "workspace_mismatch", "The workspace ID does not match this API key.");
  }
  await env.DB.prepare("UPDATE api_keys SET last_used_at=?2,updated_at=?2 WHERE api_key_id=?1").bind(row.api_key_id, (/* @__PURE__ */ new Date()).toISOString()).run();
  return {
    apiKeyId: row.api_key_id,
    workspaceId: row.workspace_id,
    keyPrefix: row.key_prefix,
    keyHash: suppliedHash,
    scopes: new Set(safeJsonParse(row.scopes_json, []))
  };
}
__name(authenticateApiKey, "authenticateApiKey");
function requireApiScope(principal, scope) {
  if (!principal.scopes.has(scope)) throw apiError(403, "insufficient_scope", `The API key requires the ${scope} scope.`);
}
__name(requireApiScope, "requireApiScope");
async function enforceExternalApiRateLimit(env, principal, requestId) {
  if (!env.INBOX_HUB) throw apiError(503, "rate_limiter_unavailable", "The API rate limiter is temporarily unavailable.");
  let response;
  try {
    response = await inboxHub(env, principal.workspaceId).fetch("https://hub.internal/external-api-rate-limit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyHash: principal.keyHash })
    });
  } catch {
    throw apiError(503, "rate_limiter_unavailable", "The API rate limiter is temporarily unavailable.");
  }
  if (response.status === 204) return null;
  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After") || "60";
    const limited = json({ status: false, error: {
      code: "rate_limited",
      message: "Too many API requests. Retry after the indicated delay.",
      requestId
    } }, 429);
    limited.headers.set("X-Request-Id", requestId);
    limited.headers.set("Retry-After", retryAfter);
    limited.headers.set("X-RateLimit-Limit", response.headers.get("X-RateLimit-Limit") || "60");
    limited.headers.set("X-RateLimit-Remaining", "0");
    return limited;
  }
  throw apiError(503, "rate_limiter_unavailable", "The API rate limiter is temporarily unavailable.");
}
__name(enforceExternalApiRateLimit, "enforceExternalApiRateLimit");
async function createExternalTemplateMessage(request, env, ctx, url, principal, requestId) {
  const suppliedIdempotencyKey = request.headers.get("Idempotency-Key");
  if (suppliedIdempotencyKey !== null && !/^[A-Za-z0-9._:-]{8,128}$/.test(suppliedIdempotencyKey)) {
    throw apiError(400, "invalid_idempotency_key", "When provided, Idempotency-Key must contain 8 to 128 safe ASCII characters.");
  }
  const idempotencyKey = suppliedIdempotencyKey || `automatic-${crypto.randomUUID()}`;
  const raw = await readExternalJson(request);
  const input = validateWhatsAppTemplateRequest(raw);
  const requestHash = await hashText(stableStringify(input));
  const idempotencyHash = await hashText(idempotencyKey);
  const existing = await findExternalRequest(env, principal.apiKeyId, idempotencyHash);
  if (existing) {
    if (!timingSafeEqual2(existing.request_hash, requestHash)) {
      throw apiError(409, "idempotency_conflict", "This Idempotency-Key was already used with a different request.");
    }
    return externalMessageResponse(await getExternalMessageStatus(env, principal, existing.message_id, url), requestId, true, suppliedIdempotencyKey !== null);
  }
  await env.DB.prepare(`DELETE FROM external_api_requests
    WHERE api_key_id=?1 AND operation=?2 AND idempotency_key_hash=?3 AND expires_at<=?4`).bind(principal.apiKeyId, EXTERNAL_API_OPERATION, idempotencyHash, (/* @__PURE__ */ new Date()).toISOString()).run();
  const channel = await getChannel(env, input.channelId, "whatsapp_cloud", principal.workspaceId);
  if (!channel) throw apiError(404, "channel_not_found", "WhatsApp channel not found.");
  if (!channel.config?.phoneNumberId) throw apiError(409, "channel_not_ready", "The WhatsApp channel is missing its Phone Number ID.");
  const accessToken = await env.DB.prepare(`SELECT 1 FROM channel_credentials
    WHERE workspace_id=?1 AND channel_id=?2 AND credential_key='accessToken'`).bind(principal.workspaceId, channel.channelId).first();
  if (!accessToken) throw apiError(409, "channel_not_ready", "The WhatsApp channel is missing its access token.");
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const messageId = crypto.randomUUID();
  const externalRequestId = crypto.randomUUID();
  const presentation = await externalTemplateInboxPresentation(env, channel, input.template, input.previewText);
  const sender = outboundSenderAttribution(principal);
  const senderName = sender.name;
  const preview = presentation.text;
  const storedPayload = { ...presentation.storedPayload, senderName };
  const encryptedPayload = await encryptOutboundPayload(
    { template: input.template },
    env.CHANNEL_CREDENTIALS_KEY,
    principal.workspaceId,
    messageId
  );
  const identity = await ensureWhatsAppConversation(
    env,
    principal.workspaceId,
    channel,
    input.to,
    input.contact?.displayName || "",
    now
  );
  const expiresAt = new Date(Date.now() + EXTERNAL_API_IDEMPOTENCY_DAYS * 864e5).toISOString();
  const firstRetryAt = new Date(Date.now() + 3e4).toISOString();
  const contactUpdates = await externalContactUpdateStatements(
    env,
    principal.workspaceId,
    channel,
    identity,
    input.contact,
    now
  );
  const statements = [
    ...contactUpdates,
    env.DB.prepare(`INSERT INTO messages (message_id,conversation_id,contact_id,channel_id,identity_id,direction,message_type,text,
        status,timestamp,payload_json,workspace_id,sender_login,sender_name)
      VALUES (?1,?2,?3,?4,?5,'outbound','template',?6,'pending',?7,?8,?9,?10,?11)`).bind(
      messageId,
      identity.conversationId,
      identity.contactId,
      channel.channelId,
      identity.identityId,
      preview,
      now,
      JSON.stringify(storedPayload),
      principal.workspaceId,
      sender.login,
      sender.name
    ),
    env.DB.prepare(`INSERT INTO outbound_payloads (message_id,workspace_id,encrypted_payload,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?4)`).bind(messageId, principal.workspaceId, encryptedPayload, now),
    env.DB.prepare(`INSERT INTO outbox (outbox_id,message_id,attempts,max_attempts,next_attempt_at,status,last_error,created_at,updated_at,workspace_id)
      VALUES (?1,?2,0,6,?3,'pending','',?4,?4,?5)`).bind(crypto.randomUUID(), messageId, firstRetryAt, now, principal.workspaceId),
    env.DB.prepare(`INSERT INTO external_api_requests
        (request_id,workspace_id,api_key_id,operation,idempotency_key_hash,request_hash,message_id,client_reference,created_at,expires_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`).bind(
      externalRequestId,
      principal.workspaceId,
      principal.apiKeyId,
      EXTERNAL_API_OPERATION,
      idempotencyHash,
      requestHash,
      messageId,
      input.clientReference,
      now,
      expiresAt
    ),
    // Keep open/closed/pending as-is on Developer API sends; only bump activity.
    env.DB.prepare(`UPDATE conversations SET last_message_at=?3,updated_at=?3
      WHERE conversation_id=?1 AND workspace_id=?2`).bind(identity.conversationId, principal.workspaceId, now)
  ];
  try {
    await env.DB.batch(statements);
    await touchIdentityBinding(
      env,
      principal.workspaceId,
      identity.identityId,
      channel.channelId,
      "outbound",
      identity.conversationId,
      now
    );
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const winner = await findExternalRequest(env, principal.apiKeyId, idempotencyHash);
      if (winner && timingSafeEqual2(winner.request_hash, requestHash)) {
        return externalMessageResponse(await getExternalMessageStatus(env, principal, winner.message_id, url), requestId, true, suppliedIdempotencyKey !== null);
      }
      if (winner) throw apiError(409, "idempotency_conflict", "This Idempotency-Key was already used with a different request.");
    }
    throw error;
  }
  await auditApiKey(env, principal, "send_template", "message", messageId, {
    channelId: channel.channelId,
    templateName: input.template.name
  });
  const realtimeAttachment = messageAttachmentView("template", storedPayload, messageId);
  const realtimeMessage = {
    messageId,
    conversationId: identity.conversationId,
    channelId: channel.channelId,
    direction: "outbound",
    messageType: "template",
    text: preview,
    status: "pending",
    timestamp: now,
    channelMessageId: "",
    error: "",
    reply: null,
    senderName,
    template: templateMessageView(storedPayload),
    ...realtimeAttachment ? { attachment: realtimeAttachment } : {}
  };
  const realtimeConversation = await getConversationItem(env, principal.workspaceId, identity.conversationId);
  await broadcast(env, principal.workspaceId, {
    type: "message.created",
    conversationId: identity.conversationId,
    messageId,
    message: realtimeMessage,
    conversation: realtimeConversation
  });
  ctx.waitUntil(sendOrQueue(env, messageId));
  return externalMessageResponse({
    messageId,
    conversationId: identity.conversationId,
    contactId: identity.contactId,
    channelId: channel.channelId,
    messageStatus: "pending",
    channelMessageId: "",
    error: "",
    clientReference: input.clientReference,
    createdAt: now,
    statusUrl: new URL(`/api/v1/messages/${encodeURIComponent(messageId)}`, url.origin).toString()
  }, requestId, false, suppliedIdempotencyKey !== null);
}
__name(createExternalTemplateMessage, "createExternalTemplateMessage");
async function findExternalRequest(env, apiKeyId, idempotencyHash) {
  return env.DB.prepare(`SELECT request_hash,message_id FROM external_api_requests
    WHERE api_key_id=?1 AND operation=?2 AND idempotency_key_hash=?3 AND expires_at>?4 LIMIT 1`).bind(apiKeyId, EXTERNAL_API_OPERATION, idempotencyHash, (/* @__PURE__ */ new Date()).toISOString()).first();
}
__name(findExternalRequest, "findExternalRequest");
async function getExternalMessageStatus(env, principal, messageId, url) {
  const id = cleanId(messageId, "Message ID");
  const row = await env.DB.prepare(`SELECT m.message_id,m.conversation_id,m.contact_id,m.channel_id,m.status,
      m.provider_message_id,m.error,m.timestamp,r.client_reference
    FROM external_api_requests r JOIN messages m ON m.message_id=r.message_id AND m.workspace_id=r.workspace_id
    WHERE r.api_key_id=?1 AND r.workspace_id=?2 AND r.message_id=?3 LIMIT 1`).bind(principal.apiKeyId, principal.workspaceId, id).first();
  if (!row) throw apiError(404, "message_not_found", "Message not found.");
  return {
    messageId: row.message_id,
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    channelId: row.channel_id,
    messageStatus: row.status,
    channelMessageId: row.provider_message_id || "",
    error: row.error || "",
    clientReference: row.client_reference || "",
    createdAt: row.timestamp,
    statusUrl: new URL(`/api/v1/messages/${encodeURIComponent(row.message_id)}`, url.origin).toString()
  };
}
__name(getExternalMessageStatus, "getExternalMessageStatus");
function externalMessageResponse(item, requestId, replayed, includeReplayHeader) {
  const response = json({ status: true, ...item, requestId }, 202);
  if (includeReplayHeader) response.headers.set("Idempotent-Replayed", replayed ? "true" : "false");
  return response;
}
__name(externalMessageResponse, "externalMessageResponse");
async function ensureWhatsAppConversation(env, workspaceId, channel, recipient, displayName, now) {
  let identity = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id
    FROM channel_identity_bindings b JOIN contact_identities ci ON ci.identity_id=b.identity_id
    WHERE b.workspace_id=?1 AND b.channel_id=?2 AND b.scoped_profile_id=?3 AND b.active=1 LIMIT 1`).bind(workspaceId, channel.channelId, recipient).first();
  if (!identity) {
    const candidates = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id
      FROM contact_identities ci
      WHERE ci.workspace_id=?1 AND ci.platform='whatsapp' AND ci.profile_id=?2
      ORDER BY ci.created_at,ci.identity_id`).bind(workspaceId, recipient).all();
    if ((candidates.results || []).length === 1) {
      identity = candidates.results[0];
      try {
        await ensureIdentityBinding(env, workspaceId, identity.contact_id, identity.identity_id, {
          platform: "whatsapp",
          profileId: recipient,
          phoneNumber: recipient,
          displayName: String(displayName || recipient).slice(0, 120),
          metadata: {},
          channelId: channel.channelId,
          scopedProfileId: recipient
        }, now);
      } catch (error) {
        const winner = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id
          FROM channel_identity_bindings b JOIN contact_identities ci ON ci.identity_id=b.identity_id
          WHERE b.workspace_id=?1 AND b.channel_id=?2 AND b.scoped_profile_id=?3 AND b.active=1 LIMIT 1`).bind(workspaceId, channel.channelId, recipient).first();
        if (!winner) throw error;
        identity = winner;
      }
    }
  }
  if (!identity) {
    const contactId = crypto.randomUUID();
    const name = String(displayName || recipient).slice(0, 120);
    try {
      await env.DB.prepare(`INSERT INTO contacts (contact_id,display_name,created_at,updated_at,workspace_id)
        VALUES (?1,?2,?3,?3,?4)`).bind(contactId, name, now, workspaceId).run();
      const created = await ensureContactIdentity(env, workspaceId, contactId, {
        platform: "whatsapp",
        profileId: recipient,
        phoneNumber: recipient,
        displayName: name,
        channelId: channel.channelId,
        scopedProfileId: recipient,
        isPrimary: true
      }, now);
      identity = { identity_id: created.identityId, contact_id: contactId };
    } catch (error) {
      await env.DB.prepare(`DELETE FROM contacts WHERE workspace_id=?1 AND contact_id=?2
        AND NOT EXISTS (SELECT 1 FROM conversations WHERE workspace_id=?1 AND contact_id=?2)`).bind(workspaceId, contactId).run().catch(() => {
      });
      identity = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id
        FROM channel_identity_bindings b JOIN contact_identities ci ON ci.identity_id=b.identity_id
        WHERE b.workspace_id=?1 AND b.channel_id=?2 AND b.scoped_profile_id=?3 AND b.active=1 LIMIT 1`).bind(workspaceId, channel.channelId, recipient).first();
      if (!identity) throw error;
    }
  }
  if (displayName) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE contacts SET display_name=?3,updated_at=?4 WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, identity.contact_id, String(displayName).slice(0, 120), now),
      env.DB.prepare(`UPDATE contact_identities SET display_name=?3,updated_at=?4
        WHERE workspace_id=?1 AND identity_id=?2`).bind(workspaceId, identity.identity_id, String(displayName).slice(0, 120), now)
    ]);
  }
  const conversationId = await ensureIdentityConversation(
    env,
    workspaceId,
    identity.contact_id,
    identity.identity_id,
    channel.channelId,
    ""
  );
  return { contactId: identity.contact_id, identityId: identity.identity_id, conversationId };
}
__name(ensureWhatsAppConversation, "ensureWhatsAppConversation");
function validateWhatsAppTemplateRequest(payload) {
  if (!isPlainObject(payload)) throw httpError(400, "Request body must be a JSON object.");
  rejectUnknownKeys(payload, /* @__PURE__ */ new Set(["channelId", "to", "contact", "template", "clientReference", "previewText"]), "request");
  const channelId = cleanId(payload.channelId, "Channel ID");
  const to = normalizeWhatsAppRecipient(payload.to);
  const contact = validateExternalTemplateContact(payload.contact);
  const clientReference = payload.clientReference === void 0 ? "" : cleanOptionalText(payload.clientReference, "Client reference", 200);
  const previewText = payload.previewText === void 0 ? "" : cleanOptionalText(payload.previewText, "Preview text", MAX_TEXT_LENGTH);
  const template = validateWhatsAppTemplate(payload.template);
  return { channelId, to, contact, template, clientReference, previewText };
}
__name(validateWhatsAppTemplateRequest, "validateWhatsAppTemplateRequest");
function validateExternalTemplateContact(value) {
  if (value === void 0 || value === null) return null;
  if (!isPlainObject(value)) throw httpError(400, "Contact must be an object.");
  rejectUnknownKeys(value, /* @__PURE__ */ new Set(["displayName", "name", "company", "tags"]), "contact");
  if (!Object.keys(value).length) throw httpError(400, "Provide at least one contact field.");
  if (value.displayName !== void 0 && value.name !== void 0 && String(value.displayName).trim() !== String(value.name).trim()) {
    throw httpError(400, "Display name and name must match when both are supplied.");
  }
  const contact = {};
  const suppliedName = value.displayName === void 0 ? value.name : value.displayName;
  if (suppliedName !== void 0) {
    if (typeof suppliedName !== "string") throw httpError(400, "Contact name must be text.");
    contact.displayName = cleanRequired(suppliedName, "Contact name", 120);
  }
  if (value.company !== void 0) {
    contact.company = cleanOptionalText(value.company, "Company", 160);
  }
  if (value.tags !== void 0) {
    contact.tags = validateContactTags(value.tags);
  }
  return contact;
}
__name(validateExternalTemplateContact, "validateExternalTemplateContact");
async function externalContactUpdateStatements(env, workspaceId, channel, identity, contact, now) {
  if (!contact) return [];
  const existing = await env.DB.prepare(`SELECT display_name,company,tags_json FROM contacts
    WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, identity.contactId).first();
  if (!existing) return [];
  const displayName = contact.displayName !== void 0 ? contact.displayName : String(existing.display_name || "");
  const company = contact.company !== void 0 ? contact.company : String(existing.company || "");
  const tags = contact.tags !== void 0 ? contact.tags : storedContactTags(existing.tags_json);
  const statements = [
    env.DB.prepare(`UPDATE contacts SET display_name=?3,company=?4,tags_json=?5,updated_at=?6
      WHERE contact_id=?1 AND workspace_id=?2`).bind(identity.contactId, workspaceId, displayName, company, JSON.stringify(tags), now)
  ];
  if (contact.displayName !== void 0) {
    statements.push(
      env.DB.prepare(`UPDATE channel_identities SET display_name=?4
        WHERE contact_id=?1 AND workspace_id=?2 AND channel_id=?3`).bind(identity.contactId, workspaceId, channel.channelId, displayName),
      env.DB.prepare(`UPDATE contact_identities SET display_name=?4,updated_at=?5
        WHERE contact_id=?1 AND workspace_id=?2 AND identity_id=?3`).bind(identity.contactId, workspaceId, identity.identityId, displayName, now)
    );
  }
  if (contact.displayName !== void 0 || contact.tags !== void 0) {
    statements.push(
      env.DB.prepare(`UPDATE conversations SET
          subject=CASE WHEN ?4=1 THEN ?5 ELSE subject END,
          tags_json=CASE WHEN ?6=1 THEN ?7 ELSE tags_json END,
          updated_at=?8
        WHERE workspace_id=?1 AND contact_id=?2 AND channel_id=?3`).bind(
        workspaceId,
        identity.contactId,
        channel.channelId,
        contact.displayName !== void 0 ? 1 : 0,
        displayName,
        contact.tags !== void 0 ? 1 : 0,
        JSON.stringify(tags),
        now
      )
    );
  }
  return statements;
}
__name(externalContactUpdateStatements, "externalContactUpdateStatements");
async function resolveExternalWhatsAppChannel(env, principal, channelId) {
  const channel = await getChannel(env, channelId, "whatsapp_cloud", principal.workspaceId);
  if (!channel) throw apiError(404, "channel_not_found", "WhatsApp channel not found.");
  if (!channel.config?.phoneNumberId) {
    throw apiError(409, "channel_not_ready", "The WhatsApp channel is missing its Phone Number ID.");
  }
  const accessToken = await env.DB.prepare(`SELECT 1 FROM channel_credentials
    WHERE workspace_id=?1 AND channel_id=?2 AND credential_key='accessToken'`).bind(principal.workspaceId, channel.channelId).first();
  if (!accessToken) throw apiError(409, "channel_not_ready", "The WhatsApp channel is missing its access token.");
  if (!/^\d{5,40}$/.test(String(channel.config?.wabaId || "").trim())) {
    throw apiError(409, "channel_not_ready", "The WhatsApp channel is missing its WhatsApp Business Account ID.");
  }
  return channel;
}
__name(resolveExternalWhatsAppChannel, "resolveExternalWhatsAppChannel");
function externalTemplateView(template) {
  return {
    templateId: template.templateId,
    name: template.name,
    language: template.language,
    status: template.status,
    category: template.category,
    components: template.components,
    variables: template.variables
  };
}
__name(externalTemplateView, "externalTemplateView");
async function listExternalWhatsAppTemplates(env, url, principal, requestId) {
  const channelId = cleanId(url.searchParams.get("channelId"), "Channel ID");
  const channel = await resolveExternalWhatsAppChannel(env, principal, channelId);
  let result;
  try {
    result = await listWhatsAppChannelTemplates(env, channel, {
      approvedOnly: false,
      includeMetadata: true,
      forceRefresh: url.searchParams.get("refresh") === "1"
    });
  } catch (error) {
    throw mapExternalTemplateLookupError(error);
  }
  await auditApiKey(env, principal, "list_templates", "channel", channel.channelId, {
    count: result.items.length,
    truncated: Boolean(result.truncated)
  });
  return json({
    status: true,
    channelId: channel.channelId,
    items: result.items.map(externalTemplateView),
    truncated: Boolean(result.truncated),
    requestId
  });
}
__name(listExternalWhatsAppTemplates, "listExternalWhatsAppTemplates");
async function fetchExternalWhatsAppTemplate(env, url, principal, requestId, templateName) {
  const channelId = cleanId(url.searchParams.get("channelId"), "Channel ID");
  const name = cleanRequired(templateName, "Template name", 512);
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw apiError(400, "invalid_template_name", "Template name may contain only lowercase letters, numbers, and underscores.");
  }
  let language = "";
  if (url.searchParams.get("language") !== null) {
    language = cleanRequired(url.searchParams.get("language"), "Template language code", 35);
    if (!/^[A-Za-z]{2,3}(?:_[A-Za-z0-9]{2,8})?$/.test(language)) {
      throw apiError(400, "invalid_template_language", "Template language code is invalid.");
    }
  }
  const channel = await resolveExternalWhatsAppChannel(env, principal, channelId);
  let items;
  try {
    items = await listWhatsAppTemplatesByName(env, channel, name);
  } catch (error) {
    throw mapExternalTemplateLookupError(error);
  }
  if (language) items = items.filter((item) => item.language.code === language);
  if (!items.length) throw apiError(404, "template_not_found", "Template not found for this WhatsApp channel.");
  await auditApiKey(env, principal, "fetch_template", "channel", channel.channelId, {
    templateName: name,
    language,
    count: items.length
  });
  return json({
    status: true,
    channelId: channel.channelId,
    name,
    ...language ? { language } : {},
    items: items.map(externalTemplateView),
    requestId
  });
}
__name(fetchExternalWhatsAppTemplate, "fetchExternalWhatsAppTemplate");
function mapExternalTemplateLookupError(error) {
  const status = Number(error?.status) || 500;
  if (status === 409) return apiError(409, "channel_not_ready", cleanError(error));
  if (status === 422) return apiError(422, "provider_rejected", cleanError(error));
  if (status === 502) return apiError(502, "provider_unavailable", cleanError(error));
  if (status >= 400 && status < 500) return apiError(status, error?.code || "invalid_request", cleanError(error));
  return error;
}
__name(mapExternalTemplateLookupError, "mapExternalTemplateLookupError");
function validateWhatsAppTemplate(value) {
  if (!isPlainObject(value)) throw httpError(400, "Template must be an object.");
  rejectUnknownKeys(value, /* @__PURE__ */ new Set(["name", "language", "components"]), "template");
  const name = cleanRequired(value.name, "Template name", 512);
  if (!/^[a-z0-9_]+$/.test(name)) throw httpError(400, "Template name may contain only lowercase letters, numbers, and underscores.");
  if (!isPlainObject(value.language)) throw httpError(400, "Template language must be an object.");
  rejectUnknownKeys(value.language, /* @__PURE__ */ new Set(["code", "policy"]), "template language");
  const code = cleanRequired(value.language.code, "Template language code", 35);
  if (!/^[A-Za-z]{2,3}(?:_[A-Za-z]{2})?$/.test(code)) throw httpError(400, "Template language code is invalid.");
  const language = { code };
  if (value.language.policy !== void 0) language.policy = cleanRequired(value.language.policy, "Template language policy", 40);
  const components = value.components === void 0 ? [] : value.components;
  if (!Array.isArray(components) || components.length > 50) throw httpError(400, "Template components must be an array with no more than 50 items.");
  const state = { nodes: 0 };
  const normalizedComponents = components.map((component, index) => {
    if (!isPlainObject(component)) throw httpError(400, `Template component ${index} must be an object.`);
    const normalized = normalizeBoundedJson(component, state, 0, `template.components[${index}]`);
    const type = String(normalized.type || "").trim().toLowerCase();
    if (!type || type.length > 40 || !/^[a-z_]+$/.test(type)) throw httpError(400, `Template component ${index} has an invalid type.`);
    normalized.type = type;
    return normalized;
  });
  return { name, language, components: normalizedComponents };
}
__name(validateWhatsAppTemplate, "validateWhatsAppTemplate");
function buildWhatsAppTemplatePayload(recipient, template, messageId = "") {
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizeWhatsAppRecipient(recipient),
    type: "template",
    template: validateWhatsAppTemplate(template)
  };
  if (messageId) payload.biz_opaque_callback_data = String(messageId).slice(0, 512);
  return payload;
}
__name(buildWhatsAppTemplatePayload, "buildWhatsAppTemplatePayload");
function normalizeBoundedJson(value, state, depth, path) {
  state.nodes++;
  if (state.nodes > 1500) throw httpError(400, "Template payload has too many values.");
  if (depth > 12) throw httpError(400, "Template payload is nested too deeply.");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw httpError(400, `${path} contains an invalid number.`);
    return value;
  }
  if (typeof value === "string") {
    if (value.length > 4096) throw httpError(400, `${path} contains text longer than 4096 characters.`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) throw httpError(400, `${path} contains too many items.`);
    return value.map((item, index) => normalizeBoundedJson(item, state, depth + 1, `${path}[${index}]`));
  }
  if (!isPlainObject(value)) throw httpError(400, `${path} contains an unsupported value.`);
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) throw httpError(400, `${path} contains a forbidden key.`);
    if (key.length > 100) throw httpError(400, `${path} contains a key that is too long.`);
    const normalized = normalizeBoundedJson(item, state, depth + 1, `${path}.${key}`);
    if (key === "link") validatePublicHttpsMediaUrl(normalized, path);
    result[key] = normalized;
  }
  return result;
}
__name(normalizeBoundedJson, "normalizeBoundedJson");
function validatePublicHttpsMediaUrl(value, path) {
  if (typeof value !== "string" || value.length > 4096) throw httpError(400, `${path}.link must be an HTTPS URL.`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw httpError(400, `${path}.link must be an HTTPS URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password) throw httpError(400, `${path}.link must be a public HTTPS URL without credentials.`);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isPrivateHostname(host)) throw httpError(400, `${path}.link must not use a local or private host.`);
}
__name(validatePublicHttpsMediaUrl, "validatePublicHttpsMediaUrl");
function isPrivateHostname(host) {
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "0.0.0.0" || host === "::1") return true;
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (match) {
    const octets = match.slice(1).map(Number);
    if (octets.some((value) => value > 255)) return true;
    return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || octets[0] === 169 && octets[1] === 254 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31 || octets[0] === 192 && octets[1] === 168;
  }
  return /^(fc|fd|fe8|fe9|fea|feb)/i.test(host);
}
__name(isPrivateHostname, "isPrivateHostname");
function rejectUnknownKeys(value, allowed, label) {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw httpError(400, `Unsupported ${label} field: ${unknown}.`);
}
__name(rejectUnknownKeys, "rejectUnknownKeys");
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
__name(isPlainObject, "isPlainObject");
function cleanOptionalText(value, label, maximum) {
  if (typeof value !== "string") throw httpError(400, `${label} must be text.`);
  const text = value.trim();
  if (text.length > maximum) throw httpError(400, `${label} is too long.`);
  if (/[\u0000-\u001f\u007f]/.test(text)) throw httpError(400, `${label} contains invalid characters.`);
  return text;
}
__name(cleanOptionalText, "cleanOptionalText");
function outboundSenderAttribution(principal) {
  if (principal?.apiKeyId) return { login: "API", name: "API" };
  const email = String(principal?.user?.email || "").trim().slice(0, 254);
  const displayName = String(principal?.user?.displayName || "").trim().slice(0, 120);
  if (email && email !== "emergency-recovery") {
    return { login: email, name: displayName || email.slice(0, 120) };
  }
  if (principal?.authType === "recovery" || displayName === "Emergency recovery") {
    return { login: "emergency-recovery", name: displayName || "Emergency recovery" };
  }
  if (principal?.user || principal?.authType) {
    return { login: email || "agent", name: displayName || "Agent" };
  }
  return { login: "API", name: "API" };
}
__name(outboundSenderAttribution, "outboundSenderAttribution");
function outboundSenderLabel(principal) {
  return outboundSenderAttribution(principal).name;
}
__name(outboundSenderLabel, "outboundSenderLabel");
function importSourceSenderAttribution(source) {
  const normalized = String(source || "").trim().toLowerCase();
  if (normalized === INTERAKT_SOURCE) return { login: "Interakt", name: "Interakt" };
  return { login: "", name: "" };
}
__name(importSourceSenderAttribution, "importSourceSenderAttribution");
function cleanPreviewText(value, maximum) {
  if (typeof value !== "string") throw httpError(400, "Preview text must be text.");
  const text = value.replace(/\r\n?/g, "\n").replace(/\t/g, " ").trim();
  if (text.length > maximum) throw httpError(400, "Preview text is too long.");
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(text)) throw httpError(400, "Preview text contains invalid characters.");
  return text;
}
__name(cleanPreviewText, "cleanPreviewText");
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
__name(stableStringify, "stableStringify");
async function readExternalJson(request) {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) {
    throw apiError(415, "unsupported_media_type", "Content-Type must be application/json.");
  }
  const raw = await readBoundedText(request, MAX_EXTERNAL_JSON_BODY);
  try {
    return JSON.parse(raw);
  } catch {
    throw apiError(400, "invalid_json", "Invalid JSON body.");
  }
}
__name(readExternalJson, "readExternalJson");
async function auditApiKey(env, principal, action, targetType, targetId, details) {
  await env.DB.prepare(`INSERT INTO audit_log
      (audit_id,actor,action,target_type,target_id,details_json,timestamp,workspace_id,actor_user_id,actor_email)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'',?2)`).bind(
    crypto.randomUUID(),
    `api-key:${principal.keyPrefix}`,
    action,
    targetType,
    targetId,
    JSON.stringify(details || {}),
    (/* @__PURE__ */ new Date()).toISOString(),
    principal.workspaceId
  ).run();
}
__name(auditApiKey, "auditApiKey");
function apiError(status, code, message) {
  const error = httpError(status, message);
  error.code = code;
  return error;
}
__name(apiError, "apiError");
async function handleWhatsAppWebhook(request, env, channelId, ctx) {
  const channel = await getChannel(env, channelId, "whatsapp_cloud");
  if (!channel) return json({ ok: false, error: "Unknown or disabled channel." }, 404);
  const credentials = await readChannelCredentials(env, channel);
  if (request.method === "GET") {
    const url = new URL(request.url);
    const expected = credentials.verifyToken;
    if (url.searchParams.get("hub.mode") === "subscribe" && expected && timingSafeEqual2(url.searchParams.get("hub.verify_token") || "", expected)) {
      await updateChannelRuntimeConfig(env, channel, { webhookVerifiedAt: (/* @__PURE__ */ new Date()).toISOString() });
      await broadcast(env, channel.workspaceId, { type: "channel.updated", channelId });
      return new Response(url.searchParams.get("hub.challenge") || "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  const raw = await readBoundedText(request, MAX_RAW_PAYLOAD);
  const appSecret = credentials.appSecret;
  if (!appSecret) return json({ ok: false, error: "Webhook secret is not configured." }, 503);
  if (!await verifyMetaSignature(raw, request.headers.get("X-Hub-Signature-256") || "", appSecret)) {
    return json({ ok: false, error: "Invalid signature." }, 401);
  }
  const payload = safeJsonParse(raw, null);
  if (!payload) return json({ ok: false, error: "Invalid JSON." }, 400);
  const normalized = normalizeWhatsApp(payload);
  const expectedPhoneNumberId = String(channel.config?.phoneNumberId || "");
  const hasEvents = normalized.messages.length > 0 || normalized.statuses.length > 0;
  if (hasEvents && (!expectedPhoneNumberId || normalized.phoneNumberIds.length === 0 || normalized.phoneNumberIds.some((id) => id !== expectedPhoneNumberId))) {
    return json({ ok: false, error: "Webhook phone number does not match this channel." }, 403);
  }
  let received = 0;
  let latestInbound = null;
  const statusChanges = [];
  for (const event of normalized.messages) {
    const stored = await storeInbound(env, channel, event, payload);
    if (stored) {
      received++;
      latestInbound = stored;
      await broadcastStoredInbound(env, channel, stored);
    }
  }
  for (const status of normalized.statuses) {
    statusChanges.push(...await applyProviderStatus(env, channel.workspaceId, channel.channelId, status, payload));
  }
  const receivedAt = (/* @__PURE__ */ new Date()).toISOString();
  await updateChannelRuntimeConfig(env, channel, {
    lastWebhookAt: receivedAt,
    webhookVerifiedAt: channel.config?.webhookVerifiedAt || receivedAt
  });
  await broadcastMessageStatusChanges(env, channel.workspaceId, statusChanges);
  if (received || normalized.statuses.length) await broadcast(env, channel.workspaceId, {
    type: "webhook.received",
    channelId,
    received,
    statuses: normalized.statuses.length,
    granular: true
  });
  if (latestInbound) scheduleInboundPush(ctx, env, channel, latestInbound);
  return json({ ok: true, received, statuses: normalized.statuses.length });
}
__name(handleWhatsAppWebhook, "handleWhatsAppWebhook");
async function handleGenericWebhook(request, env, channelId, ctx) {
  const channel = await getChannel(env, channelId, "generic_http");
  if (!channel) return json({ ok: false, error: "Unknown or disabled channel." }, 404);
  const expected = env[`${secretPrefix(channel.secretKey)}_WEBHOOK_TOKEN`];
  if (!expected || !timingSafeEqual2(request.headers.get("X-Webhook-Token") || "", expected)) return json({ ok: false, error: "Invalid webhook token." }, 401);
  const payload = safeJsonParse(await readBoundedText(request, MAX_RAW_PAYLOAD), null);
  if (!payload) return json({ ok: false, error: "Invalid JSON." }, 400);
  const mapping = channel.config?.inboundMapping || {};
  const events = normalizeGeneric(payload, mapping);
  const statuses = normalizeGenericStatuses(payload, mapping);
  let received = 0;
  let latestInbound = null;
  for (const event of events) {
    const stored = await storeInbound(env, channel, event, payload);
    if (stored) {
      received++;
      latestInbound = stored;
      await broadcastStoredInbound(env, channel, stored);
    }
  }
  let updatedStatuses = 0;
  const statusChanges = [];
  for (const status of statuses) {
    const changes = await applyProviderStatus(env, channel.workspaceId, channel.channelId, status, payload);
    updatedStatuses += changes.length;
    statusChanges.push(...changes);
  }
  await broadcastMessageStatusChanges(env, channel.workspaceId, statusChanges);
  if (received || updatedStatuses) {
    await broadcast(env, channel.workspaceId, {
      type: "webhook.received",
      channelId,
      received,
      statuses: updatedStatuses,
      granular: true
    });
  }
  if (latestInbound) scheduleInboundPush(ctx, env, channel, latestInbound);
  return json({ ok: true, received });
}
__name(handleGenericWebhook, "handleGenericWebhook");
async function handleTelegramWebhook(request, env, channelId, ctx) {
  const channel = await getChannel(env, channelId, "telegram");
  if (!channel) return json({ ok: false, error: "Unknown or disabled channel." }, 404);
  const credentials = await readChannelCredentials(env, channel);
  const expected = credentials.webhookSecret;
  if (!expected || !timingSafeEqual2(request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "", expected)) {
    return json({ ok: false, error: "Invalid webhook token." }, 401);
  }
  const payload = safeJsonParse(await readBoundedText(request, MAX_RAW_PAYLOAD), null);
  if (!payload) return json({ ok: false, error: "Invalid JSON." }, 400);
  const event = normalizeTelegram(payload);
  const storedInbound = event ? await storeInbound(env, channel, event, payload) : null;
  const received = storedInbound ? 1 : 0;
  await updateChannelRuntimeConfig(env, channel, { lastWebhookAt: (/* @__PURE__ */ new Date()).toISOString() });
  if (storedInbound) await broadcastStoredInbound(env, channel, storedInbound);
  if (received) await broadcast(env, channel.workspaceId, {
    type: "webhook.received",
    channelId,
    received,
    statuses: 0,
    granular: true
  });
  if (storedInbound) scheduleInboundPush(ctx, env, channel, storedInbound);
  return json({ ok: true, received });
}
__name(handleTelegramWebhook, "handleTelegramWebhook");
async function handleInstagramWebhook(request, env, channelId, ctx) {
  const channel = await getChannel(env, channelId, "instagram");
  if (!channel) return json({ ok: false, error: "Unknown or disabled channel." }, 404);
  const credentials = await readChannelCredentials(env, channel);
  if (request.method === "GET") {
    const url = new URL(request.url);
    const expected = credentials.verifyToken;
    if (url.searchParams.get("hub.mode") === "subscribe" && expected && timingSafeEqual2(url.searchParams.get("hub.verify_token") || "", expected)) {
      await updateChannelRuntimeConfig(env, channel, { webhookVerifiedAt: (/* @__PURE__ */ new Date()).toISOString() });
      await broadcast(env, channel.workspaceId, { type: "channel.updated", channelId });
      return new Response(url.searchParams.get("hub.challenge") || "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  const raw = await readBoundedText(request, MAX_RAW_PAYLOAD);
  if (!credentials.appSecret) return json({ ok: false, error: "Webhook secret is not configured." }, 503);
  if (!await verifyMetaSignature(raw, request.headers.get("X-Hub-Signature-256") || "", credentials.appSecret)) {
    return json({ ok: false, error: "Invalid signature." }, 401);
  }
  const payload = safeJsonParse(raw, null);
  if (!payload) return json({ ok: false, error: "Invalid JSON." }, 400);
  const normalized = normalizeInstagram(payload);
  const expectedAccountId = String(channel.config?.instagramAccountId || "");
  const hasEvents = normalized.messages.length || normalized.statuses.length || normalized.watermarkStatuses.length;
  if (hasEvents && (!expectedAccountId || normalized.recipientIds.length === 0 || normalized.recipientIds.some((id) => id !== expectedAccountId))) {
    return json({ ok: false, error: "Webhook Instagram account does not match this channel." }, 403);
  }
  await enrichInstagramDisplayNames(env, channel, credentials, normalized.messages);
  let received = 0;
  let latestInbound = null;
  for (const event of normalized.messages) {
    const stored = await storeInbound(env, channel, event, payload);
    if (stored) {
      received++;
      latestInbound = stored;
      await broadcastStoredInbound(env, channel, stored);
    }
  }
  let updatedStatuses = 0;
  const statusChanges = [];
  for (const status of normalized.statuses) {
    const changes = await applyProviderStatus(env, channel.workspaceId, channel.channelId, status, payload);
    updatedStatuses += changes.length;
    statusChanges.push(...changes);
  }
  for (const status of normalized.watermarkStatuses) {
    const changes = await applyProviderWatermarkStatus(env, channel.workspaceId, channel.channelId, status, payload);
    updatedStatuses += changes.length;
    statusChanges.push(...changes);
  }
  await refreshInstagramPlaceholderProfiles(
    env,
    channel,
    credentials,
    instagramCustomerIds(payload, expectedAccountId)
  ).catch(() => {
  });
  await updateChannelRuntimeConfig(env, channel, { lastWebhookAt: (/* @__PURE__ */ new Date()).toISOString() });
  await broadcastMessageStatusChanges(env, channel.workspaceId, statusChanges);
  if (received || updatedStatuses) {
    await broadcast(env, channel.workspaceId, {
      type: "webhook.received",
      channelId,
      received,
      statuses: updatedStatuses,
      granular: true
    });
  }
  if (latestInbound) scheduleInboundPush(ctx, env, channel, latestInbound);
  return json({ ok: true, received });
}
__name(handleInstagramWebhook, "handleInstagramWebhook");
async function handleInstagramAppWebhook(request, env, requestedAppId, ctx) {
  const appId = cleanMetaIdentifier(requestedAppId, "Meta App ID");
  const channels = await findInstagramAppChannels(env, appId);
  if (!channels.length) return json({ ok: false, error: "Unknown Instagram app webhook." }, 404);
  if (request.method === "GET") {
    const url = new URL(request.url);
    if (url.searchParams.get("hub.mode") !== "subscribe") return new Response("Forbidden", { status: 403 });
    const supplied = url.searchParams.get("hub.verify_token") || "";
    const matches = [];
    for (const channel of channels) {
      const credentials = await readChannelCredentials(env, channel);
      if (credentials.verifyToken && timingSafeEqual2(supplied, credentials.verifyToken)) matches.push(channel);
    }
    if (!matches.length) return new Response("Forbidden", { status: 403 });
    const verifiedAt = (/* @__PURE__ */ new Date()).toISOString();
    for (const channel of matches) {
      await updateChannelRuntimeConfig(env, channel, { webhookVerifiedAt: verifiedAt });
      await broadcast(env, channel.workspaceId, { type: "channel.updated", channelId: channel.channelId });
    }
    return new Response(url.searchParams.get("hub.challenge") || "", { status: 200 });
  }
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  const raw = await readBoundedText(request, MAX_RAW_PAYLOAD);
  const payload = safeJsonParse(raw, null);
  if (!payload) return json({ ok: false, error: "Invalid JSON." }, 400);
  const groups = partitionInstagramAppPayload(payload);
  const channelsByAccount = /* @__PURE__ */ new Map();
  for (const channel of channels) {
    const accountId = String(channel.config?.instagramAccountId || "");
    if (!channelsByAccount.has(accountId)) channelsByAccount.set(accountId, []);
    channelsByAccount.get(accountId).push(channel);
  }
  const routes = [];
  for (const [accountId, groupedPayload] of groups) {
    const matches = channelsByAccount.get(accountId) || [];
    if (!matches.length) throw httpError(404, "No enabled Instagram connection matches this app webhook.");
    if (matches.length !== 1) throw httpError(409, "Instagram app webhook routing is ambiguous.");
    routes.push({ accountId, payload: groupedPayload, channel: matches[0] });
  }
  const suppliedSignature = request.headers.get("X-Hub-Signature-256") || "";
  for (const route of routes) {
    const credentials = await readChannelCredentials(env, route.channel);
    if (!credentials.appSecret || !await verifyMetaSignature(raw, suppliedSignature, credentials.appSecret)) {
      return json({ ok: false, error: "Invalid signature." }, 401);
    }
  }
  let received = 0;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  for (const route of routes) {
    const normalized = normalizeInstagram(route.payload);
    if (normalized.recipientIds.some((id) => id !== route.accountId)) {
      throw httpError(400, "Instagram app webhook account routing is inconsistent.");
    }
    const credentials = await readChannelCredentials(env, route.channel);
    await enrichInstagramDisplayNames(env, route.channel, credentials, normalized.messages);
    let channelReceived = 0;
    let latestInbound = null;
    for (const event of normalized.messages) {
      const stored = await storeInbound(env, route.channel, event, route.payload);
      if (stored) {
        received++;
        channelReceived++;
        latestInbound = stored;
        await broadcastStoredInbound(env, route.channel, stored);
      }
    }
    let channelStatuses = 0;
    const statusChanges = [];
    for (const status of normalized.statuses) {
      const changes = await applyProviderStatus(env, route.channel.workspaceId, route.channel.channelId, status, route.payload);
      channelStatuses += changes.length;
      statusChanges.push(...changes);
    }
    for (const status of normalized.watermarkStatuses) {
      const changes = await applyProviderWatermarkStatus(env, route.channel.workspaceId, route.channel.channelId, status, route.payload);
      channelStatuses += changes.length;
      statusChanges.push(...changes);
    }
    await refreshInstagramPlaceholderProfiles(
      env,
      route.channel,
      credentials,
      instagramCustomerIds(route.payload, route.accountId)
    ).catch(() => {
    });
    await updateChannelRuntimeConfig(env, route.channel, { lastWebhookAt: now });
    await broadcastMessageStatusChanges(env, route.channel.workspaceId, statusChanges);
    if (channelReceived || channelStatuses) {
      await broadcast(env, route.channel.workspaceId, {
        type: "webhook.received",
        channelId: route.channel.channelId,
        received: channelReceived,
        statuses: channelStatuses,
        granular: true
      });
    }
    if (latestInbound) scheduleInboundPush(ctx, env, route.channel, latestInbound);
  }
  return json({ ok: true, received, channels: routes.length });
}
__name(handleInstagramAppWebhook, "handleInstagramAppWebhook");
async function handleFacebookMessengerWebhook(request, env, channelId, ctx) {
  const channel = await getChannel(env, channelId, "facebook_messenger");
  if (!channel) return json({ ok: false, error: "Unknown or disabled channel." }, 404);
  const credentials = await readChannelCredentials(env, channel);
  if (request.method === "GET") {
    const url = new URL(request.url);
    const expected = credentials.verifyToken;
    if (url.searchParams.get("hub.mode") === "subscribe" && expected && timingSafeEqual2(url.searchParams.get("hub.verify_token") || "", expected)) {
      await updateChannelRuntimeConfig(env, channel, { webhookVerifiedAt: (/* @__PURE__ */ new Date()).toISOString() });
      await broadcast(env, channel.workspaceId, { type: "channel.updated", channelId });
      return new Response(url.searchParams.get("hub.challenge") || "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  const raw = await readBoundedText(request, MAX_RAW_PAYLOAD);
  if (!credentials.appSecret) return json({ ok: false, error: "Webhook secret is not configured." }, 503);
  if (!await verifyMetaSignature(raw, request.headers.get("X-Hub-Signature-256") || "", credentials.appSecret)) {
    return json({ ok: false, error: "Invalid signature." }, 401);
  }
  const payload = safeJsonParse(raw, null);
  if (!payload) return json({ ok: false, error: "Invalid JSON." }, 400);
  const normalized = normalizeFacebookMessenger(payload);
  const expectedPageId = String(channel.config?.pageId || "");
  const hasEvents = normalized.messages.length || normalized.statuses.length || normalized.watermarkStatuses.length;
  if (hasEvents && (!expectedPageId || normalized.recipientIds.length === 0 || normalized.recipientIds.some((id) => id !== expectedPageId))) {
    return json({ ok: false, error: "Webhook Facebook Page does not match this channel." }, 403);
  }
  await enrichFacebookMessengerDisplayNames(env, channel, credentials, normalized.messages);
  let received = 0;
  let latestInbound = null;
  for (const event of normalized.messages) {
    const stored = await storeInbound(env, channel, event, payload);
    if (stored) {
      received++;
      latestInbound = stored;
      await broadcastStoredInbound(env, channel, stored);
    }
  }
  let updatedStatuses = 0;
  const statusChanges = [];
  for (const status of normalized.statuses) {
    const changes = await applyProviderStatus(env, channel.workspaceId, channel.channelId, status, payload);
    updatedStatuses += changes.length;
    statusChanges.push(...changes);
  }
  for (const status of normalized.watermarkStatuses) {
    const changes = await applyProviderWatermarkStatus(env, channel.workspaceId, channel.channelId, status, payload);
    updatedStatuses += changes.length;
    statusChanges.push(...changes);
  }
  await refreshFacebookMessengerPlaceholderProfiles(
    env,
    channel,
    credentials,
    facebookMessengerCustomerIds(payload, expectedPageId)
  ).catch(() => {
  });
  await updateChannelRuntimeConfig(env, channel, { lastWebhookAt: (/* @__PURE__ */ new Date()).toISOString() });
  await broadcastMessageStatusChanges(env, channel.workspaceId, statusChanges);
  if (received || updatedStatuses) {
    await broadcast(env, channel.workspaceId, {
      type: "webhook.received",
      channelId,
      received,
      statuses: updatedStatuses,
      granular: true
    });
  }
  if (latestInbound) scheduleInboundPush(ctx, env, channel, latestInbound);
  return json({ ok: true, received });
}
__name(handleFacebookMessengerWebhook, "handleFacebookMessengerWebhook");
async function handleFacebookMessengerAppWebhook(request, env, requestedAppId, ctx) {
  const appId = cleanMetaIdentifier(requestedAppId, "Meta App ID");
  const channels = await findFacebookMessengerAppChannels(env, appId);
  if (!channels.length) return json({ ok: false, error: "Unknown Messenger app webhook." }, 404);
  if (request.method === "GET") {
    const url = new URL(request.url);
    if (url.searchParams.get("hub.mode") !== "subscribe") return new Response("Forbidden", { status: 403 });
    const supplied = url.searchParams.get("hub.verify_token") || "";
    const matches = [];
    for (const channel of channels) {
      const credentials = await readChannelCredentials(env, channel);
      if (credentials.verifyToken && timingSafeEqual2(supplied, credentials.verifyToken)) matches.push(channel);
    }
    if (!matches.length) return new Response("Forbidden", { status: 403 });
    const verifiedAt = (/* @__PURE__ */ new Date()).toISOString();
    for (const channel of matches) {
      await updateChannelRuntimeConfig(env, channel, { webhookVerifiedAt: verifiedAt });
      await broadcast(env, channel.workspaceId, { type: "channel.updated", channelId: channel.channelId });
    }
    return new Response(url.searchParams.get("hub.challenge") || "", { status: 200 });
  }
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  const raw = await readBoundedText(request, MAX_RAW_PAYLOAD);
  const payload = safeJsonParse(raw, null);
  if (!payload) return json({ ok: false, error: "Invalid JSON." }, 400);
  const groups = partitionFacebookMessengerAppPayload(payload);
  const channelsByPage = /* @__PURE__ */ new Map();
  for (const channel of channels) {
    const pageId = String(channel.config?.pageId || "");
    if (!channelsByPage.has(pageId)) channelsByPage.set(pageId, []);
    channelsByPage.get(pageId).push(channel);
  }
  const routes = [];
  for (const [pageId, groupedPayload] of groups) {
    const matches = channelsByPage.get(pageId) || [];
    if (!matches.length) throw httpError(404, "No enabled Messenger connection matches this app webhook.");
    if (matches.length !== 1) throw httpError(409, "Messenger app webhook routing is ambiguous.");
    routes.push({ pageId, payload: groupedPayload, channel: matches[0] });
  }
  const suppliedSignature = request.headers.get("X-Hub-Signature-256") || "";
  for (const route of routes) {
    const credentials = await readChannelCredentials(env, route.channel);
    if (!credentials.appSecret || !await verifyMetaSignature(raw, suppliedSignature, credentials.appSecret)) {
      return json({ ok: false, error: "Invalid signature." }, 401);
    }
  }
  let received = 0;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  for (const route of routes) {
    const normalized = normalizeFacebookMessenger(route.payload);
    if (normalized.recipientIds.some((id) => id !== route.pageId)) {
      throw httpError(400, "Messenger app webhook page routing is inconsistent.");
    }
    const credentials = await readChannelCredentials(env, route.channel);
    await enrichFacebookMessengerDisplayNames(env, route.channel, credentials, normalized.messages);
    let channelReceived = 0;
    let latestInbound = null;
    for (const event of normalized.messages) {
      const stored = await storeInbound(env, route.channel, event, route.payload);
      if (stored) {
        received++;
        channelReceived++;
        latestInbound = stored;
        await broadcastStoredInbound(env, route.channel, stored);
      }
    }
    let channelStatuses = 0;
    const statusChanges = [];
    for (const status of normalized.statuses) {
      const changes = await applyProviderStatus(env, route.channel.workspaceId, route.channel.channelId, status, route.payload);
      channelStatuses += changes.length;
      statusChanges.push(...changes);
    }
    for (const status of normalized.watermarkStatuses) {
      const changes = await applyProviderWatermarkStatus(env, route.channel.workspaceId, route.channel.channelId, status, route.payload);
      channelStatuses += changes.length;
      statusChanges.push(...changes);
    }
    await refreshFacebookMessengerPlaceholderProfiles(
      env,
      route.channel,
      credentials,
      facebookMessengerCustomerIds(route.payload, route.pageId)
    ).catch(() => {
    });
    await updateChannelRuntimeConfig(env, route.channel, { lastWebhookAt: now });
    await broadcastMessageStatusChanges(env, route.channel.workspaceId, statusChanges);
    if (channelReceived || channelStatuses) {
      await broadcast(env, route.channel.workspaceId, {
        type: "webhook.received",
        channelId: route.channel.channelId,
        received: channelReceived,
        statuses: channelStatuses,
        granular: true
      });
    }
    if (latestInbound) scheduleInboundPush(ctx, env, route.channel, latestInbound);
  }
  return json({ ok: true, received, channels: routes.length });
}
__name(handleFacebookMessengerAppWebhook, "handleFacebookMessengerAppWebhook");
function scheduleInboundPush(ctx, env, channel, inbound) {
  const delivery = (async () => {
    const unreadCount = await workspaceUnreadCount(env, channel.workspaceId).catch(() => 0);
    const notification = inboundPushNotification(channel, { ...inbound, unreadCount });
    return sendWorkspaceNotifications(env, channel.workspaceId, notification);
  })().catch((error) => console.error("push_delivery_failed", {
    workspaceId: channel.workspaceId,
    channelId: channel.channelId,
    message: cleanError(error)
  }));
  if (typeof ctx?.waitUntil === "function") ctx.waitUntil(delivery);
}
__name(scheduleInboundPush, "scheduleInboundPush");
function scheduleAssignmentPush(ctx, env, workspaceId, conversation, notify) {
  const membershipId = String(notify?.membershipId || "").trim();
  if (!membershipId) return;
  const delivery = (async () => {
    const notification = assignmentPushNotification(conversation, notify);
    return sendMembershipNotifications(env, workspaceId, membershipId, notification);
  })().catch((error) => console.error("assignment_push_failed", {
    workspaceId,
    conversationId: conversation?.conversationId || "",
    membershipId,
    message: cleanError(error)
  }));
  if (typeof ctx?.waitUntil === "function") ctx.waitUntil(delivery);
}
__name(scheduleAssignmentPush, "scheduleAssignmentPush");
function assignmentPushNotification(conversation = {}, notify = {}) {
  const subject = compactNotificationText(conversation.subject || notify.subject, 120) || "Conversation";
  const assigneeName = compactNotificationText(notify.assigneeName, 80) || "you";
  const rawConversationId = String(conversation.conversationId || notify.conversationId || "");
  const conversationId = /^[A-Za-z0-9_-]{1,100}$/.test(rawConversationId) ? rawConversationId : "";
  return {
    title: "Chat assigned to you",
    body: subject === "Conversation" ? `A chat was assigned to ${assigneeName}.` : `${subject} was assigned to you.`,
    tag: `helixcer-assign-${conversationId || "inbox"}`,
    url: conversationId ? `/#inbox/${conversationId}` : "/#inbox",
    ...notify.timestamp ? { eventTimestamp: notify.timestamp } : {}
  };
}
__name(assignmentPushNotification, "assignmentPushNotification");
function outboundSendResponse(result = {}) {
  const payload = { ok: true, item: result.message };
  if (result.assignment?.conversation) {
    payload.assignment = {
      conversation: result.assignment.conversation,
      ...result.assignment.eventMessage ? { eventMessage: result.assignment.eventMessage } : {}
    };
  }
  return payload;
}
__name(outboundSendResponse, "outboundSendResponse");
async function broadcastAssignmentSideEffects(env, workspaceId, conversationId, assignment) {
  if (!assignment?.conversation) return;
  await broadcast(env, workspaceId, {
    type: "conversation.updated",
    conversationId,
    conversation: assignment.conversation,
    assignmentSilent: true
  });
  await broadcast(env, workspaceId, {
    type: "conversation.assigned",
    conversationId,
    conversation: assignment.conversation,
    assignedTo: assignment.conversation.assignedTo || "",
    assignmentSilent: true
  });
  if (assignment.eventMessage) {
    await broadcast(env, workspaceId, {
      type: "message.created",
      conversationId,
      messageId: assignment.eventMessage.messageId,
      message: assignment.eventMessage,
      assignmentSilent: true
    });
  }
}
__name(broadcastAssignmentSideEffects, "broadcastAssignmentSideEffects");
function scheduleConversationReadPush(ctx, env, workspaceId, conversation) {
  const delivery = (async () => {
    const current = await env.DB.prepare(`SELECT unread_count,updated_at FROM conversations
      WHERE workspace_id=?1 AND conversation_id=?2 LIMIT 1`).bind(workspaceId, conversation.conversationId).first();
    if (!current || Number(current.unread_count || 0) > 0) return { skipped: true };
    const unreadCount = await workspaceUnreadCount(env, workspaceId);
    return sendWorkspaceMobileConversationRead(env, workspaceId, {
      conversationId: conversation.conversationId,
      unreadCount,
      readAt: current.updated_at
    });
  })().catch((error) => console.error("conversation_read_push_failed", {
    workspaceId,
    conversationId: conversation.conversationId,
    message: cleanError(error)
  }));
  if (typeof ctx?.waitUntil === "function") ctx.waitUntil(delivery);
}
__name(scheduleConversationReadPush, "scheduleConversationReadPush");
async function broadcastStoredInbound(env, channel, stored) {
  if (!stored?.message || !stored.conversationId || !stored.messageId) return;
  if (stored.openEvent) {
    await broadcast(env, channel.workspaceId, {
      type: "message.created",
      conversationId: stored.conversationId,
      messageId: stored.openEvent.messageId,
      message: stored.openEvent,
      conversation: stored.conversation || null,
      source: "webhook"
    });
  }
  await broadcast(env, channel.workspaceId, {
    type: "message.created",
    conversationId: stored.conversationId,
    messageId: stored.messageId,
    message: stored.message,
    conversation: stored.conversation || null,
    source: "webhook"
  });
}
__name(broadcastStoredInbound, "broadcastStoredInbound");
function inboundPushNotification(channel, inbound = {}) {
  const title = compactNotificationText(inbound.senderName, 120) || "Customer";
  const preview = compactNotificationText(inbound.preview, 240);
  const syntheticPreview = /^\[(?:WhatsApp|Instagram|Facebook) .+ received\]$/i.test(preview);
  const body = preview && !syntheticPreview ? preview : inboundMessageTypeLabel(inbound.messageType);
  const rawConversationId = String(inbound.conversationId || "");
  const conversationId = /^[A-Za-z0-9_-]{1,100}$/.test(rawConversationId) ? rawConversationId : "";
  const unreadCount = boundedUnreadCount(inbound.unreadCount);
  const conversationUnreadCount = boundedUnreadCount(inbound.conversation?.unreadCount);
  return {
    title,
    body,
    tag: `helixcer-${conversationId || String(channel?.channelId || "inbox").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 90)}`,
    url: conversationId ? `/#inbox/${conversationId}` : "/#inbox",
    ...inbound.message?.timestamp ? { eventTimestamp: inbound.message.timestamp } : {},
    ...unreadCount ? { unreadCount } : {},
    ...conversationUnreadCount ? { conversationUnreadCount } : {}
  };
}
__name(inboundPushNotification, "inboundPushNotification");
async function workspaceUnreadCount(env, workspaceId) {
  const row = await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN unread_count>0 THEN unread_count ELSE 0 END),0) AS unread_count
    FROM conversations WHERE workspace_id=?1`).bind(workspaceId).first();
  return boundedUnreadCount(row?.unread_count);
}
__name(workspaceUnreadCount, "workspaceUnreadCount");
function boundedUnreadCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(9999, Math.floor(count));
}
__name(boundedUnreadCount, "boundedUnreadCount");
function compactNotificationText(value, maximumLength) {
  const compact = String(value || "").replace(/\s+/g, " ").trim();
  return Array.from(compact).slice(0, maximumLength).join("");
}
__name(compactNotificationText, "compactNotificationText");
function inboundMessageTypeLabel(value) {
  const type = String(value || "message").toLowerCase();
  const labels = {
    image: "Sent a photo",
    video: "Sent a video",
    audio: "Sent an audio message",
    voice: "Sent a voice message",
    document: "Sent a document",
    file: "Sent a file",
    sticker: "Sent a sticker",
    location: "Shared a location",
    contact: "Shared a contact",
    contacts: "Shared a contact",
    reaction: "Sent a reaction",
    interactive: "Sent an interactive message"
  };
  return labels[type] || "Sent a message";
}
__name(inboundMessageTypeLabel, "inboundMessageTypeLabel");
async function findInstagramAppChannels(env, appId) {
  const result = await env.DB.prepare(`SELECT channel_id,name,connector_type,provider_type,enabled,
      capabilities_json,config_json,secret_key,workspace_id
    FROM channels
    WHERE enabled=1 AND provider_type='instagram' AND json_extract(config_json,'$.appId')=?1
    ORDER BY workspace_id,channel_id`).bind(appId).all();
  return (result.results || []).map((row) => ({
    channelId: row.channel_id,
    name: row.name,
    connectorType: logicalConnectorType(row),
    capabilities: safeJsonParse(row.capabilities_json, []),
    config: safeJsonParse(row.config_json, {}),
    secretKey: row.secret_key,
    workspaceId: row.workspace_id
  }));
}
__name(findInstagramAppChannels, "findInstagramAppChannels");
async function findFacebookMessengerAppChannels(env, appId) {
  const result = await env.DB.prepare(`SELECT channel_id,name,connector_type,provider_type,enabled,
      capabilities_json,config_json,secret_key,workspace_id
    FROM channels
    WHERE enabled=1 AND provider_type='facebook_messenger' AND json_extract(config_json,'$.appId')=?1
    ORDER BY workspace_id,channel_id`).bind(appId).all();
  return (result.results || []).map((row) => ({
    channelId: row.channel_id,
    name: row.name,
    connectorType: logicalConnectorType(row),
    capabilities: safeJsonParse(row.capabilities_json, []),
    config: safeJsonParse(row.config_json, {}),
    secretKey: row.secret_key,
    workspaceId: row.workspace_id
  }));
}
__name(findFacebookMessengerAppChannels, "findFacebookMessengerAppChannels");
function partitionInstagramAppPayload(payload) {
  if (payload?.object && payload.object !== "instagram") throw httpError(400, "Unexpected Instagram webhook object.");
  if (!Array.isArray(payload?.entry) || !payload.entry.length) throw httpError(400, "Instagram webhook has no entries.");
  const groups = /* @__PURE__ */ new Map();
  const addEntry = /* @__PURE__ */ __name((accountId, entry, messaging) => {
    if (!groups.has(accountId)) groups.set(accountId, { ...payload, entry: [] });
    groups.get(accountId).entry.push({ ...entry, id: accountId, messaging });
  }, "addEntry");
  for (const entry of payload.entry) {
    const entryId = entry?.id ? cleanMetaIdentifier(entry.id, "Instagram entry account ID") : "";
    const events = Array.isArray(entry?.messaging) ? entry.messaging : [];
    if (!events.length) {
      if (!entryId) throw httpError(400, "Instagram webhook entry has no account ID.");
      addEntry(entryId, entry, []);
      continue;
    }
    const eventsByAccount = /* @__PURE__ */ new Map();
    for (const event of events) {
      const recipientId = event?.recipient?.id ? cleanMetaIdentifier(event.recipient.id, "Instagram recipient account ID") : "";
      const isEcho = Boolean(event?.message?.is_echo);
      if (!isEcho && entryId && recipientId && entryId !== recipientId) {
        throw httpError(400, "Instagram webhook entry and recipient accounts do not match.");
      }
      const accountId = entryId || recipientId;
      if (!accountId) throw httpError(400, "Instagram webhook event has no account ID.");
      if (!eventsByAccount.has(accountId)) eventsByAccount.set(accountId, []);
      eventsByAccount.get(accountId).push(event);
    }
    for (const [accountId, groupedEvents] of eventsByAccount) addEntry(accountId, entry, groupedEvents);
  }
  if (!groups.size) throw httpError(400, "Instagram webhook could not be routed.");
  return groups;
}
__name(partitionInstagramAppPayload, "partitionInstagramAppPayload");
function partitionFacebookMessengerAppPayload(payload) {
  if (payload?.object && payload.object !== "page") throw httpError(400, "Unexpected Messenger webhook object.");
  if (!Array.isArray(payload?.entry) || !payload.entry.length) throw httpError(400, "Messenger webhook has no entries.");
  const groups = /* @__PURE__ */ new Map();
  const addEntry = /* @__PURE__ */ __name((pageId, entry, messaging) => {
    if (!groups.has(pageId)) groups.set(pageId, { ...payload, entry: [] });
    groups.get(pageId).entry.push({ ...entry, id: pageId, messaging });
  }, "addEntry");
  for (const entry of payload.entry) {
    const entryId = entry?.id ? cleanMetaIdentifier(entry.id, "Messenger entry page ID") : "";
    const events = Array.isArray(entry?.messaging) ? entry.messaging : [];
    if (!events.length) {
      if (!entryId) throw httpError(400, "Messenger webhook entry has no page ID.");
      addEntry(entryId, entry, []);
      continue;
    }
    const eventsByPage = /* @__PURE__ */ new Map();
    for (const event of events) {
      const recipientId = event?.recipient?.id ? cleanMetaIdentifier(event.recipient.id, "Messenger recipient page ID") : "";
      const isEcho = Boolean(event?.message?.is_echo);
      if (!isEcho && entryId && recipientId && entryId !== recipientId) {
        throw httpError(400, "Messenger webhook entry and recipient pages do not match.");
      }
      const pageId = entryId || recipientId;
      if (!pageId) throw httpError(400, "Messenger webhook event has no page ID.");
      if (!eventsByPage.has(pageId)) eventsByPage.set(pageId, []);
      eventsByPage.get(pageId).push(event);
    }
    for (const [pageId, groupedEvents] of eventsByPage) addEntry(pageId, entry, groupedEvents);
  }
  if (!groups.size) throw httpError(400, "Messenger webhook could not be routed.");
  return groups;
}
__name(partitionFacebookMessengerAppPayload, "partitionFacebookMessengerAppPayload");
async function getWorkspaceProfile(env, workspaceId) {
  const row = await env.DB.prepare(`SELECT workspace_id,name,registered_name,address_line1,address_line2,
      city,state,postal_code,country,gstin,tax_details
    FROM workspaces WHERE workspace_id=?1 LIMIT 1`).bind(workspaceId).first();
  if (!row) throw httpError(404, "Workspace not found.");
  return workspaceProfileView(row);
}
__name(getWorkspaceProfile, "getWorkspaceProfile");
function workspaceProfileView(row) {
  return {
    workspaceId: String(row.workspace_id || ""),
    displayName: String(row.name || ""),
    registeredName: String(row.registered_name || ""),
    addressLine1: String(row.address_line1 || ""),
    addressLine2: String(row.address_line2 || ""),
    city: String(row.city || ""),
    state: String(row.state || ""),
    postalCode: String(row.postal_code || ""),
    country: String(row.country || ""),
    gstin: String(row.gstin || ""),
    taxDetails: String(row.tax_details || "")
  };
}
__name(workspaceProfileView, "workspaceProfileView");
async function updateWorkspaceProfile(env, workspaceId, payload, principal) {
  if (!isPlainObject(payload)) throw httpError(400, "Workspace profile must be an object.");
  const fields = [
    ["displayName", "Workspace display name", 120, false],
    ["registeredName", "Registered company name", 200, true],
    ["addressLine1", "Address line 1", 240, true],
    ["addressLine2", "Address line 2", 240, true],
    ["city", "City", 120, true],
    ["state", "State or region", 120, true],
    ["postalCode", "Postal code", 32, true],
    ["country", "Country", 120, true],
    ["gstin", "GSTIN", 15, true],
    ["taxDetails", "Tax details", 2e3, true]
  ];
  rejectUnknownKeys(payload, new Set(fields.map(([key]) => key)), "workspace profile");
  if (!Object.keys(payload).length) throw httpError(400, "At least one workspace field is required.");
  const values = {};
  for (const [key, label, maximum, optional] of fields) {
    if (payload[key] === void 0) continue;
    values[key] = optional ? key === "taxDetails" ? cleanWorkspaceMultiline(payload[key], label, maximum) : cleanOptionalText(payload[key], label, maximum) : cleanRequiredWorkspaceText(payload[key], label, maximum);
  }
  if (values.gstin) {
    values.gstin = values.gstin.toUpperCase();
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(values.gstin)) {
      throw httpError(400, "GSTIN must be a valid 15-character Indian GST number.");
    }
  }
  const present = /* @__PURE__ */ __name((key) => Object.prototype.hasOwnProperty.call(values, key), "present");
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const result = await env.DB.prepare(`UPDATE workspaces SET
      name=CASE WHEN ?2=1 THEN ?3 ELSE name END,
      registered_name=CASE WHEN ?4=1 THEN ?5 ELSE registered_name END,
      address_line1=CASE WHEN ?6=1 THEN ?7 ELSE address_line1 END,
      address_line2=CASE WHEN ?8=1 THEN ?9 ELSE address_line2 END,
      city=CASE WHEN ?10=1 THEN ?11 ELSE city END,
      state=CASE WHEN ?12=1 THEN ?13 ELSE state END,
      postal_code=CASE WHEN ?14=1 THEN ?15 ELSE postal_code END,
      country=CASE WHEN ?16=1 THEN ?17 ELSE country END,
      gstin=CASE WHEN ?18=1 THEN ?19 ELSE gstin END,
      tax_details=CASE WHEN ?20=1 THEN ?21 ELSE tax_details END,
      updated_at=?22
    WHERE workspace_id=?1`).bind(
    workspaceId,
    present("displayName") ? 1 : 0,
    values.displayName || "",
    present("registeredName") ? 1 : 0,
    values.registeredName || "",
    present("addressLine1") ? 1 : 0,
    values.addressLine1 || "",
    present("addressLine2") ? 1 : 0,
    values.addressLine2 || "",
    present("city") ? 1 : 0,
    values.city || "",
    present("state") ? 1 : 0,
    values.state || "",
    present("postalCode") ? 1 : 0,
    values.postalCode || "",
    present("country") ? 1 : 0,
    values.country || "",
    present("gstin") ? 1 : 0,
    values.gstin || "",
    present("taxDetails") ? 1 : 0,
    values.taxDetails || "",
    now
  ).run();
  if (!result.meta?.changes) throw httpError(404, "Workspace not found.");
  await audit(env, principal, "update", "workspace", workspaceId, { fields: Object.keys(values) });
  return getWorkspaceProfile(env, workspaceId);
}
__name(updateWorkspaceProfile, "updateWorkspaceProfile");
function cleanRequiredWorkspaceText(value, label, maximum) {
  if (typeof value !== "string") throw httpError(400, `${label} must be text.`);
  const text = cleanRequired(value, label, maximum);
  if (/[\u0000-\u001f\u007f]/.test(text)) throw httpError(400, `${label} contains invalid characters.`);
  return text;
}
__name(cleanRequiredWorkspaceText, "cleanRequiredWorkspaceText");
function cleanWorkspaceMultiline(value, label, maximum) {
  if (typeof value !== "string") throw httpError(400, `${label} must be text.`);
  const text = value.replace(/\r\n?/g, "\n").trim();
  if (text.length > maximum) throw httpError(400, `${label} is too long.`);
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(text)) throw httpError(400, `${label} contains invalid characters.`);
  return text;
}
__name(cleanWorkspaceMultiline, "cleanWorkspaceMultiline");
async function listChannels(env, workspaceId, includeConfiguration = false) {
  const [result, storedCredentials] = await Promise.all([
    env.DB.prepare(`SELECT channel_id,name,connector_type,provider_type,enabled,capabilities_json,config_json,secret_key
    FROM channels WHERE workspace_id=?1 ORDER BY name COLLATE NOCASE`).bind(workspaceId).all(),
    env.DB.prepare("SELECT channel_id,credential_key FROM channel_credentials WHERE workspace_id=?1").bind(workspaceId).all()
  ]);
  const fieldsByChannel = /* @__PURE__ */ new Map();
  for (const item of storedCredentials.results || []) {
    if (!fieldsByChannel.has(item.channel_id)) fieldsByChannel.set(item.channel_id, /* @__PURE__ */ new Set());
    fieldsByChannel.get(item.channel_id).add(item.credential_key);
  }
  return result.results.map((row) => {
    const config = safeJsonParse(row.config_json, {});
    const connectorType = logicalConnectorType(row);
    const credentialFields = fieldsByChannel.get(row.channel_id) || /* @__PURE__ */ new Set();
    return {
      channelId: row.channel_id,
      name: row.name,
      connectorType,
      enabled: Boolean(row.enabled),
      capabilities: safeJsonParse(row.capabilities_json, []),
      health: channelHealth(row, config, credentialFields),
      ...includeConfiguration ? { config: publicChannelConfig(connectorType, config), setup: channelSetupView(row, config, credentialFields) } : {}
    };
  });
}
__name(listChannels, "listChannels");
function channelHealth(row, config = safeJsonParse(row.config_json, {}), credentialFields = /* @__PURE__ */ new Set()) {
  if (!row.enabled) return "disconnected";
  const connectorType = logicalConnectorType(row);
  const definition = CONNECTOR_DEFINITIONS[connectorType];
  if (!definition) return "connected";
  const configured = definition.requiredConfig.every((key) => Boolean(config[key])) && definition.requiredCredentials.every((key) => credentialFields.has(key));
  if (!configured) return "setup_required";
  if (!config.credentialsVerifiedAt) return config.webhookVerifiedAt ? "receiving" : "configured";
  if (!config.webhookVerifiedAt) return "webhook_required";
  return "connected";
}
__name(channelHealth, "channelHealth");
function channelSetupView(row, config = safeJsonParse(row.config_json, {}), credentialFields = /* @__PURE__ */ new Set()) {
  const connectorType = logicalConnectorType(row);
  const definition = CONNECTOR_DEFINITIONS[connectorType];
  if (!definition) return {};
  const presence = Object.fromEntries(definition.requiredCredentials.map((key) => [key, credentialFields.has(key)]));
  const callbackPath = connectorType === "instagram" && config.appId ? `/webhooks/instagram-app/${encodeURIComponent(config.appId)}` : connectorType === "facebook_messenger" && config.appId ? `/webhooks/facebook-messenger-app/${encodeURIComponent(config.appId)}` : `/webhooks/${definition.webhookPath}/${encodeURIComponent(row.channel_id)}`;
  return {
    credentialsPresent: definition.requiredConfig.every((key) => Boolean(config[key])) && Object.values(presence).every(Boolean),
    credentialFields: presence,
    callbackPath,
    credentialsVerifiedAt: config.credentialsVerifiedAt || "",
    subscribedAppsAt: config.subscribedAppsAt || "",
    webhookVerifiedAt: config.webhookVerifiedAt || "",
    lastWebhookAt: config.lastWebhookAt || "",
    verifiedPhoneNumber: config.verifiedPhoneNumber || "",
    verifiedName: config.verifiedName || "",
    verifiedUsername: config.verifiedUsername || "",
    verifiedProviderId: config.verifiedProviderId || ""
  };
}
__name(channelSetupView, "channelSetupView");
async function getChannel(env, id, connectorType = "", workspaceId = "") {
  const row = await env.DB.prepare(`SELECT channel_id,name,connector_type,provider_type,enabled,capabilities_json,config_json,secret_key,workspace_id
    FROM channels WHERE channel_id=?1 AND enabled=1 AND (?2='' OR workspace_id=?2)`).bind(id, workspaceId).first();
  const logicalType = row ? logicalConnectorType(row) : "";
  if (!row || connectorType && logicalType !== connectorType) return null;
  return {
    channelId: row.channel_id,
    name: row.name,
    connectorType: logicalType,
    capabilities: safeJsonParse(row.capabilities_json, []),
    config: safeJsonParse(row.config_json, {}),
    secretKey: row.secret_key,
    workspaceId: row.workspace_id
  };
}
__name(getChannel, "getChannel");
async function verifyChannel(env, workspaceId, channelId, request) {
  const channel = await getChannel(env, channelId, "", workspaceId);
  if (!channel) throw httpError(404, "Channel not found.");
  if (channel.connectorType === "whatsapp_cloud") return verifyWhatsAppChannel(env, channel);
  if (channel.connectorType === "telegram") return verifyTelegramChannel(env, channel, request);
  if (channel.connectorType === "instagram") return verifyInstagramChannel(env, channel);
  if (channel.connectorType === "facebook_messenger") return verifyFacebookMessengerChannel(env, channel);
  throw httpError(400, "This connector cannot be verified automatically.");
}
__name(verifyChannel, "verifyChannel");
async function getChannelVerifyToken(env, workspaceId, channelId, principal) {
  const id = cleanId(channelId, "Channel ID");
  const row = await env.DB.prepare(`SELECT channel_id,name,connector_type,provider_type,config_json,secret_key,workspace_id
    FROM channels WHERE channel_id=?1 AND workspace_id=?2`).bind(id, workspaceId).first();
  if (!row) throw httpError(404, "Channel not found.");
  const connectorType = logicalConnectorType(row);
  if (!["whatsapp_cloud", "instagram", "facebook_messenger"].includes(connectorType)) {
    throw httpError(400, "This channel does not use a webhook verify token.");
  }
  const channel = {
    channelId: row.channel_id,
    name: row.name,
    connectorType,
    config: safeJsonParse(row.config_json, {}),
    secretKey: row.secret_key,
    workspaceId: row.workspace_id
  };
  const verifyToken = (await readChannelCredentials(env, channel)).verifyToken || "";
  if (!verifyToken) throw httpError(404, "No webhook verify token is saved for this channel.");
  await audit(env, principal, "read_verify_token", "channel", id, {});
  return { ok: true, channelId: id, verifyToken };
}
__name(getChannelVerifyToken, "getChannelVerifyToken");
async function verifyWhatsAppChannel(env, channel) {
  const channelId = channel.channelId;
  const credentials = await readChannelCredentials(env, channel);
  const token = credentials.accessToken;
  const wabaId = String(channel.config?.wabaId || "");
  const phoneNumberId = String(channel.config?.phoneNumberId || "");
  const verifyToken = credentials.verifyToken;
  const appSecret = credentials.appSecret;
  if (!token || !wabaId || !phoneNumberId || !verifyToken || !appSecret) {
    throw httpError(409, "Secure WhatsApp credentials have not been fully configured.");
  }
  assertMetaAppSecret(appSecret, 422);
  const version = metaApiVersion(channel.config?.apiVersion);
  const endpoint = new URL(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(wabaId)}/phone_numbers`);
  endpoint.searchParams.set("fields", "id,display_phone_number,verified_name");
  endpoint.searchParams.set("limit", "100");
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  const raw = await response.text();
  const data = safeJsonParse(raw, {});
  if (!response.ok) {
    if (isMetaObjectVisibilityError(data)) {
      throw httpError(422, "The saved access token cannot access this Messaging/WhatsApp Business Account. Assign the token user or System User to this exact WhatsApp account, then regenerate the token with whatsapp_business_management.");
    }
    throw httpError(422, `Meta could not verify this WhatsApp number: ${providerError(data, response.status)}`);
  }
  const phone = Array.isArray(data.data) ? data.data.find((item) => String(item?.id || "") === phoneNumberId) : null;
  if (!phone) throw httpError(422, "The WhatsApp phone number does not belong to the configured WABA.");
  const subscriptionEndpoint = new URL(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(wabaId)}/subscribed_apps`);
  const subscriptionResponse = await fetch(subscriptionEndpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
  const subscriptionData = safeJsonParse(await subscriptionResponse.text(), {});
  if (!subscriptionResponse.ok || subscriptionData.success === false) {
    throw httpError(422, `Meta could not subscribe this app to the WhatsApp Business Account: ${providerError(subscriptionData, subscriptionResponse.status)}`);
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const config = await updateChannelRuntimeConfig(env, channel, {
    apiVersion: version,
    credentialsVerifiedAt: now,
    subscribedAppsAt: now,
    verifiedProviderId: phoneNumberId,
    verifiedPhoneNumber: String(phone.display_phone_number || ""),
    verifiedName: String(phone.verified_name || "")
  });
  return {
    ok: true,
    channelId,
    health: config.webhookVerifiedAt ? "connected" : "webhook_required",
    verifiedPhoneNumber: config.verifiedPhoneNumber,
    verifiedName: config.verifiedName,
    credentialsVerifiedAt: config.credentialsVerifiedAt,
    subscribedToWaba: true,
    subscribedAppsAt: config.subscribedAppsAt,
    webhookVerifiedAt: config.webhookVerifiedAt || ""
  };
}
__name(verifyWhatsAppChannel, "verifyWhatsAppChannel");
async function verifyTelegramChannel(env, channel, request) {
  const credentials = await readChannelCredentials(env, channel);
  if (!credentials.botToken || !credentials.webhookSecret) {
    throw httpError(409, "Secure Telegram credentials have not been fully configured.");
  }
  const base = `https://api.telegram.org/bot${credentials.botToken}`;
  const identityResponse = await fetch(`${base}/getMe`);
  const identityData = safeJsonParse(await identityResponse.text(), {});
  if (!identityResponse.ok || identityData.ok === false) {
    throw httpError(422, `Telegram could not verify this bot: ${providerError(identityData, identityResponse.status)}`);
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const user = identityData.result || {};
  const botId = String(user.id || "");
  if (!botId) throw httpError(422, "Telegram did not return a bot identity.");
  await assertUniqueVerifiedProviderId(env, channel.workspaceId, "telegram", channel.channelId, botId);
  let config = await updateChannelRuntimeConfig(env, channel, {
    credentialsVerifiedAt: now,
    verifiedProviderId: botId,
    verifiedName: String(user.first_name || ""),
    verifiedUsername: String(user.username || "")
  });
  const callbackUrl = `${new URL(request.url).origin}/webhooks/telegram/${encodeURIComponent(channel.channelId)}`;
  const webhookResponse = await fetch(`${base}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: callbackUrl, secret_token: credentials.webhookSecret, allowed_updates: ["message", "edited_message", "channel_post"] })
  });
  const webhookData = safeJsonParse(await webhookResponse.text(), {});
  if (!webhookResponse.ok || webhookData.ok === false) {
    throw httpError(422, `Telegram could not set the webhook: ${providerError(webhookData, webhookResponse.status)}`);
  }
  config = await updateChannelRuntimeConfig(env, channel, { webhookVerifiedAt: now });
  return {
    ok: true,
    channelId: channel.channelId,
    health: "connected",
    verifiedName: config.verifiedName,
    verifiedUsername: config.verifiedUsername,
    credentialsVerifiedAt: now,
    webhookVerifiedAt: now
  };
}
__name(verifyTelegramChannel, "verifyTelegramChannel");
async function verifyInstagramChannel(env, channel) {
  const credentials = await readChannelCredentials(env, channel);
  const accountId = String(channel.config?.instagramAccountId || "");
  if (!credentials.accessToken || !credentials.verifyToken || !credentials.appSecret || !accountId) {
    throw httpError(409, "Secure Instagram credentials have not been fully configured.");
  }
  assertMetaAppSecret(credentials.appSecret, 422);
  const version = metaApiVersion(channel.config?.apiVersion);
  const endpoint = new URL(`https://graph.instagram.com/${encodeURIComponent(version)}/me`);
  endpoint.searchParams.set("fields", "user_id,username");
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
  const data = safeJsonParse(await response.text(), {});
  if (!response.ok) throw httpError(422, `Meta could not verify this Instagram account: ${providerError(data, response.status)}`);
  if (String(data.user_id || "") !== accountId) throw httpError(422, "Meta returned a different Instagram account.");
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const config = await updateChannelRuntimeConfig(env, channel, {
    apiVersion: version,
    credentialsVerifiedAt: now,
    verifiedProviderId: accountId,
    verifiedName: String(data.username || ""),
    verifiedUsername: String(data.username || "")
  });
  await refreshInstagramPlaceholderProfiles(env, channel, credentials).catch(() => {
  });
  return {
    ok: true,
    channelId: channel.channelId,
    health: config.webhookVerifiedAt ? "connected" : "webhook_required",
    verifiedName: config.verifiedName,
    verifiedUsername: config.verifiedUsername,
    credentialsVerifiedAt: now,
    webhookVerifiedAt: config.webhookVerifiedAt || ""
  };
}
__name(verifyInstagramChannel, "verifyInstagramChannel");
async function verifyFacebookMessengerChannel(env, channel) {
  const credentials = await readChannelCredentials(env, channel);
  const pageId = String(channel.config?.pageId || "");
  if (!credentials.accessToken || !credentials.verifyToken || !credentials.appSecret || !pageId) {
    throw httpError(409, "Secure Messenger credentials have not been fully configured.");
  }
  assertMetaAppSecret(credentials.appSecret, 422);
  const version = metaApiVersion(channel.config?.apiVersion);
  const endpoint = new URL(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(pageId)}`);
  endpoint.searchParams.set("fields", "id,name");
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
  const data = safeJsonParse(await response.text(), {});
  if (!response.ok) throw httpError(422, `Meta could not verify this Facebook Page: ${providerError(data, response.status)}`);
  if (String(data.id || "") !== pageId) throw httpError(422, "Meta returned a different Facebook Page.");
  const subscriptionEndpoint = new URL(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(pageId)}/subscribed_apps`);
  subscriptionEndpoint.searchParams.set("subscribed_fields", "messages,messaging_postbacks,message_deliveries,message_reads");
  const subscriptionResponse = await fetch(subscriptionEndpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${credentials.accessToken}` }
  });
  const subscriptionData = safeJsonParse(await subscriptionResponse.text(), {});
  if (!subscriptionResponse.ok || subscriptionData.success === false) {
    throw httpError(422, `Meta could not subscribe this app to the Facebook Page: ${providerError(subscriptionData, subscriptionResponse.status)}`);
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const config = await updateChannelRuntimeConfig(env, channel, {
    apiVersion: version,
    credentialsVerifiedAt: now,
    subscribedAppsAt: now,
    verifiedProviderId: pageId,
    verifiedName: String(data.name || channel.config?.pageName || "")
  });
  await refreshFacebookMessengerPlaceholderProfiles(env, channel, credentials).catch(() => {
  });
  return {
    ok: true,
    channelId: channel.channelId,
    health: config.webhookVerifiedAt ? "connected" : "webhook_required",
    verifiedName: config.verifiedName,
    credentialsVerifiedAt: now,
    subscribedAppsAt: config.subscribedAppsAt,
    webhookVerifiedAt: config.webhookVerifiedAt || ""
  };
}
__name(verifyFacebookMessengerChannel, "verifyFacebookMessengerChannel");
async function updateChannelRuntimeConfig(env, channel, patch) {
  const config = { ...channel.config || {} };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === void 0 || value === null || value === "") delete config[key];
    else config[key] = value;
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  try {
    await env.DB.prepare("UPDATE channels SET config_json=?3,updated_at=?4 WHERE channel_id=?1 AND workspace_id=?2").bind(channel.channelId, channel.workspaceId, JSON.stringify(config), now).run();
  } catch (error) {
    if (isUniqueConstraintError(error)) throw httpError(409, "This provider identity is already connected in the workspace.");
    throw error;
  }
  channel.config = config;
  return config;
}
__name(updateChannelRuntimeConfig, "updateChannelRuntimeConfig");
async function saveChannel(env, workspaceId, payload, principal, forcedChannelId = "") {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw httpError(400, "Channel payload is invalid.");
  const channelId = cleanId(forcedChannelId || payload.channelId || crypto.randomUUID(), "Channel ID");
  const existing = await env.DB.prepare("SELECT * FROM channels WHERE channel_id=?1 AND workspace_id=?2").bind(channelId, workspaceId).first();
  if (forcedChannelId && !existing) throw httpError(404, "Channel not found.");
  if (!forcedChannelId && existing) throw httpError(409, "Channel ID already exists.");
  const existingType = existing ? logicalConnectorType(existing) : "";
  const connectorType = cleanRequired(payload.connectorType || existingType, "Connector type", 40);
  if (!MANAGED_CONNECTORS.has(connectorType) && !["generic_http", "web_chat"].includes(connectorType)) {
    throw httpError(400, "Unsupported connector type.");
  }
  if (existingType && connectorType !== existingType) throw httpError(400, "A channel provider cannot be changed after creation.");
  const name = cleanRequired(payload.name || existing?.name, "Channel name", 80);
  if (!MANAGED_CONNECTORS.has(connectorType)) {
    return saveLegacyChannel(env, workspaceId, payload, principal, existing, channelId, name, connectorType);
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const previousConfig = safeJsonParse(existing?.config_json, {});
  const config = mergeChannelConfig(connectorType, previousConfig, payload.config);
  await assertUniqueManagedConfig(env, workspaceId, connectorType, channelId, config);
  const credentialUpdates = validateCredentialPayload(connectorType, payload.credentials);
  const changedConfigFields = editableConfigChanges(connectorType, previousConfig, config);
  await assertProviderIdentityConfigMutable(env, workspaceId, existing, connectorType, changedConfigFields);
  if (Object.keys(credentialUpdates).length) await importChannelCredentialKey(env.CHANNEL_CREDENTIALS_KEY);
  invalidateChannelVerification(connectorType, config, changedConfigFields, Object.keys(credentialUpdates));
  const collision = await env.DB.prepare("SELECT workspace_id FROM channels WHERE channel_id=?1").bind(channelId).first();
  if (collision && collision.workspace_id !== workspaceId) throw httpError(409, "Channel ID is already used by another workspace.");
  const storageType = ["instagram", "facebook_messenger"].includes(connectorType) ? "generic_http" : connectorType;
  const capabilities = CONNECTOR_DEFINITIONS[connectorType]?.capabilities || ["text"];
  const enabled = payload.enabled === void 0 ? existing ? Boolean(existing.enabled) : true : payload.enabled !== false;
  let saved;
  try {
    saved = await env.DB.prepare(`INSERT INTO channels
        (channel_id,name,connector_type,provider_type,enabled,capabilities_json,config_json,secret_key,created_at,updated_at,workspace_id)
      VALUES (?1,?2,?3,?4,?5,?6,?7,'DATABASE',?8,?8,?9)
      ON CONFLICT(channel_id) DO UPDATE SET name=excluded.name,connector_type=excluded.connector_type,
        provider_type=excluded.provider_type,enabled=excluded.enabled,capabilities_json=excluded.capabilities_json,
        config_json=excluded.config_json,secret_key='DATABASE',updated_at=excluded.updated_at
        WHERE channels.workspace_id=excluded.workspace_id`).bind(channelId, name, storageType, connectorType, enabled ? 1 : 0, JSON.stringify(capabilities), JSON.stringify(config), now, workspaceId).run();
  } catch (error) {
    if (isUniqueConstraintError(error)) throw httpError(409, "This provider identity is already connected in the workspace.");
    throw error;
  }
  if (!saved.meta?.changes) throw httpError(409, "Channel ID is already used by another workspace.");
  if (Object.keys(credentialUpdates).length) {
    await storeChannelCredentials(env, { workspaceId, channelId, connectorType }, credentialUpdates, principal.user.userId || "");
  }
  await audit(env, principal, existing ? "update" : "create", "channel", channelId, {
    name,
    connectorType,
    enabled,
    updatedCredentialFields: Object.keys(credentialUpdates).sort()
  });
  return { ok: true, channelId };
}
__name(saveChannel, "saveChannel");
async function saveLegacyChannel(env, workspaceId, payload, principal, existing, channelId, name, connectorType) {
  const hasConfig = Object.hasOwn(payload, "config");
  if (hasConfig && (payload.config === null || typeof payload.config !== "object" || Array.isArray(payload.config))) {
    throw httpError(400, "Channel configuration must be an object.");
  }
  const config = hasConfig ? payload.config : safeJsonParse(existing?.config_json, {});
  if (JSON.stringify(config).length > MAX_JSON_BODY) throw httpError(400, "Channel configuration is too large.");
  if (connectorType === "generic_http" && config.endpoint) assertAllowedHttpsEndpoint(config.endpoint, config.allowedHosts || []);
  const hasExplicitSecretKey = typeof payload.secretKey === "string" && payload.secretKey.trim() !== "";
  const requestedPrefix = secretPrefix(cleanRequired(payload.secretKey || existing?.secret_key || `CHANNEL_${channelId}`, "Secret key", 64));
  const collision = await env.DB.prepare("SELECT workspace_id,secret_key FROM channels WHERE channel_id=?1").bind(channelId).first();
  if (collision && collision.workspace_id !== workspaceId) throw httpError(409, "Channel ID is already used by another workspace.");
  const prefix = collision && (!hasExplicitSecretKey || secretPrefix(collision.secret_key) === requestedPrefix) ? collision.secret_key : workspaceSecretPrefix(workspaceId, requestedPrefix);
  const enabled = payload.enabled === void 0 ? existing ? Boolean(existing.enabled) : true : payload.enabled !== false;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const saved = await env.DB.prepare(`INSERT INTO channels
      (channel_id,name,connector_type,provider_type,enabled,capabilities_json,config_json,secret_key,created_at,updated_at,workspace_id)
    VALUES (?1,?2,?3,?3,?4,?5,?6,?7,?8,?8,?9)
    ON CONFLICT(channel_id) DO UPDATE SET name=excluded.name,connector_type=excluded.connector_type,
      provider_type=excluded.provider_type,enabled=excluded.enabled,capabilities_json=excluded.capabilities_json,
      config_json=excluded.config_json,secret_key=excluded.secret_key,updated_at=excluded.updated_at
      WHERE channels.workspace_id=excluded.workspace_id`).bind(channelId, name, connectorType, enabled ? 1 : 0, JSON.stringify(["text"]), JSON.stringify(config), prefix, now, workspaceId).run();
  if (!saved.meta?.changes) throw httpError(409, "Channel ID is already used by another workspace.");
  await audit(env, principal, existing ? "update" : "create", "channel", channelId, { name, connectorType, enabled });
  return { ok: true, channelId };
}
__name(saveLegacyChannel, "saveLegacyChannel");
async function deleteChannel(env, workspaceId, channelId, principal) {
  const id = cleanId(channelId, "Channel ID");
  const channel = await env.DB.prepare(`SELECT name,connector_type,provider_type FROM channels
    WHERE channel_id=?1 AND workspace_id=?2`).bind(id, workspaceId).first();
  if (!channel) throw httpError(404, "Channel not found.");
  const counts = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM channel_identity_bindings WHERE channel_id=?1 AND workspace_id=?2) AS identities,
      (SELECT COUNT(*) FROM conversations WHERE channel_id=?1 AND workspace_id=?2) AS conversations,
      (SELECT COUNT(*) FROM messages WHERE channel_id=?1 AND workspace_id=?2) AS messages`).bind(id, workspaceId).first();
  if (Number(counts?.messages || 0) > 0 || Number(counts?.conversations || 0) > 0) {
    throw httpError(409, "This channel has conversation history. Disable it instead so unified contact threads and message route history remain intact.");
  }
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM external_api_requests WHERE workspace_id=?2 AND message_id IN
      (SELECT message_id FROM messages WHERE channel_id=?1 AND workspace_id=?2)`).bind(id, workspaceId),
    env.DB.prepare(`DELETE FROM outbox WHERE workspace_id=?2 AND message_id IN
      (SELECT message_id FROM messages WHERE channel_id=?1 AND workspace_id=?2)`).bind(id, workspaceId),
    env.DB.prepare(`DELETE FROM outbound_payloads WHERE workspace_id=?2 AND message_id IN
      (SELECT message_id FROM messages WHERE channel_id=?1 AND workspace_id=?2)`).bind(id, workspaceId),
    env.DB.prepare(`DELETE FROM identity_migration_issues WHERE workspace_id=?2 AND conversation_id IN
      (SELECT conversation_id FROM conversations WHERE channel_id=?1 AND workspace_id=?2)`).bind(id, workspaceId),
    env.DB.prepare("DELETE FROM messages WHERE channel_id=?1 AND workspace_id=?2").bind(id, workspaceId),
    env.DB.prepare("DELETE FROM conversations WHERE channel_id=?1 AND workspace_id=?2").bind(id, workspaceId),
    env.DB.prepare("DELETE FROM channel_identities WHERE channel_id=?1 AND workspace_id=?2").bind(id, workspaceId),
    env.DB.prepare("DELETE FROM channel_identity_bindings WHERE channel_id=?1 AND workspace_id=?2").bind(id, workspaceId),
    env.DB.prepare("DELETE FROM channel_credentials WHERE channel_id=?1 AND workspace_id=?2").bind(id, workspaceId),
    env.DB.prepare("DELETE FROM webhook_events WHERE channel_id=?1 AND workspace_id=?2").bind(id, workspaceId),
    env.DB.prepare("DELETE FROM channels WHERE channel_id=?1 AND workspace_id=?2").bind(id, workspaceId)
  ]);
  await audit(env, principal, "delete", "channel", id, {
    name: channel.name,
    connectorType: logicalConnectorType(channel),
    localOnly: true,
    deletedIdentities: Number(counts?.identities || 0),
    deletedConversations: Number(counts?.conversations || 0),
    deletedMessages: Number(counts?.messages || 0)
  });
  return {
    ok: true,
    channelId: id,
    deleted: true,
    localOnly: true,
    deletedConversations: Number(counts?.conversations || 0),
    deletedMessages: Number(counts?.messages || 0)
  };
}
__name(deleteChannel, "deleteChannel");
function logicalConnectorType(row) {
  return String(row?.provider_type || row?.providerType || row?.connector_type || row?.connectorType || "").trim();
}
__name(logicalConnectorType, "logicalConnectorType");
function publicChannelConfig(connectorType, config = {}) {
  const definition = CONNECTOR_DEFINITIONS[connectorType];
  if (!definition) return {};
  return Object.fromEntries(definition.configFields.filter((key) => config[key] !== void 0 && config[key] !== null && config[key] !== "").map((key) => [key, config[key]]));
}
__name(publicChannelConfig, "publicChannelConfig");
function mergeChannelConfig(connectorType, previous = {}, supplied) {
  const definition = CONNECTOR_DEFINITIONS[connectorType];
  if (!definition) throw httpError(400, "Unsupported connector type.");
  if (supplied !== void 0 && (supplied === null || typeof supplied !== "object" || Array.isArray(supplied))) {
    throw httpError(400, "Channel configuration must be an object.");
  }
  const config = { ...previous || {} };
  if (supplied) {
    const unknown = Object.keys(supplied).filter((key) => !definition.configFields.includes(key));
    if (unknown.length) throw httpError(400, `Unsupported channel configuration field: ${unknown[0]}.`);
    for (const key of definition.configFields) {
      if (!Object.hasOwn(supplied, key)) continue;
      const value = normalizeChannelConfigValue(key, supplied[key]);
      if (value) config[key] = value;
      else delete config[key];
    }
  }
  if ((connectorType === "whatsapp_cloud" || connectorType === "instagram" || connectorType === "facebook_messenger") && !config.apiVersion) config.apiVersion = "v26.0";
  if (connectorType === "instagram" && !config.authMode) config.authMode = "instagram_login";
  if (JSON.stringify(publicChannelConfig(connectorType, config)).length > 4096) throw httpError(400, "Channel configuration is too large.");
  return config;
}
__name(mergeChannelConfig, "mergeChannelConfig");
function normalizeChannelConfigValue(key, value) {
  if (value === void 0 || value === null) return "";
  if (typeof value !== "string" && typeof value !== "number") throw httpError(400, `${key} must be text.`);
  const text = String(value).trim();
  if (!text) return "";
  if (key === "apiVersion") return metaApiVersion(text);
  if (key === "username") {
    if (!/^[A-Za-z0-9._]{1,30}$/.test(text)) throw httpError(400, "Instagram username is invalid.");
    return text;
  }
  if (key === "pageName") {
    if (text.length > 100 || /[\u0000-\u001f\u007f]/.test(text)) throw httpError(400, "Facebook Page name is invalid.");
    return text.slice(0, 100);
  }
  if (key === "authMode") {
    if (text !== "instagram_login") throw httpError(400, "Instagram authentication mode is invalid.");
    return text;
  }
  return cleanMetaIdentifier(text, key);
}
__name(normalizeChannelConfigValue, "normalizeChannelConfigValue");
function editableConfigChanges(connectorType, before = {}, after = {}) {
  const fields = CONNECTOR_DEFINITIONS[connectorType]?.configFields || [];
  return fields.filter((key) => String(before[key] || "") !== String(after[key] || ""));
}
__name(editableConfigChanges, "editableConfigChanges");
async function assertProviderIdentityConfigMutable(env, workspaceId, existing, connectorType, changedConfigFields = []) {
  if (!existing) return;
  const providerIdentityFields = connectorType === "whatsapp_cloud" ? /* @__PURE__ */ new Set(["wabaId", "phoneNumberId"]) : connectorType === "instagram" ? /* @__PURE__ */ new Set(["instagramAccountId", "appId"]) : connectorType === "facebook_messenger" ? /* @__PURE__ */ new Set(["pageId", "appId"]) : /* @__PURE__ */ new Set();
  if (!changedConfigFields.some((key) => providerIdentityFields.has(key))) return;
  const usage = await env.DB.prepare(`SELECT
      EXISTS(SELECT 1 FROM channel_identity_bindings WHERE workspace_id=?1 AND channel_id=?2) AS has_bindings,
      EXISTS(SELECT 1 FROM channel_identities WHERE workspace_id=?1 AND channel_id=?2) AS has_legacy_identities,
      EXISTS(SELECT 1 FROM conversations WHERE workspace_id=?1 AND channel_id=?2) AS has_conversations,
      EXISTS(SELECT 1 FROM messages WHERE workspace_id=?1 AND channel_id=?2) AS has_messages`).bind(workspaceId, existing.channel_id).first();
  if (Number(usage?.has_bindings || 0) || Number(usage?.has_legacy_identities || 0) || Number(usage?.has_conversations || 0) || Number(usage?.has_messages || 0)) {
    throw httpError(409, "This provider identity already has contact routes or message history. Add a new channel instead.");
  }
}
__name(assertProviderIdentityConfigMutable, "assertProviderIdentityConfigMutable");
function invalidateChannelVerification(connectorType, config, changedConfigFields = [], changedCredentialFields = []) {
  const providerCredentialChanged = connectorType === "whatsapp_cloud" || connectorType === "instagram" || connectorType === "facebook_messenger" ? changedCredentialFields.some((key) => key !== "verifyToken") : changedCredentialFields.length > 0;
  if (changedConfigFields.length || providerCredentialChanged) {
    for (const key of [
      "credentialsVerifiedAt",
      "subscribedAppsAt",
      "verifiedPhoneNumber",
      "verifiedName",
      "verifiedUsername",
      "verifiedProviderId"
    ]) delete config[key];
  }
  const webhookCredentialChanged = connectorType === "telegram" ? changedCredentialFields.some((key) => key === "botToken" || key === "webhookSecret") : changedCredentialFields.includes("verifyToken");
  if (changedConfigFields.length || webhookCredentialChanged) delete config.webhookVerifiedAt;
  const providerIdentityFields = connectorType === "whatsapp_cloud" ? /* @__PURE__ */ new Set(["wabaId", "phoneNumberId"]) : connectorType === "instagram" ? /* @__PURE__ */ new Set(["instagramAccountId", "appId"]) : connectorType === "facebook_messenger" ? /* @__PURE__ */ new Set(["pageId", "appId"]) : /* @__PURE__ */ new Set();
  if (changedConfigFields.some((key) => providerIdentityFields.has(key))) delete config.lastWebhookAt;
}
__name(invalidateChannelVerification, "invalidateChannelVerification");
async function assertUniqueManagedConfig(env, workspaceId, connectorType, channelId, config) {
  const field = connectorType === "whatsapp_cloud" ? "phoneNumberId" : connectorType === "instagram" ? "instagramAccountId" : connectorType === "facebook_messenger" ? "pageId" : "";
  const value = field ? String(config[field] || "") : "";
  if (!value) return;
  const jsonPath = field === "phoneNumberId" ? "$.phoneNumberId" : field === "instagramAccountId" ? "$.instagramAccountId" : "$.pageId";
  const duplicate = await env.DB.prepare(`SELECT channel_id FROM channels
    WHERE workspace_id=?1 AND channel_id<>?2 AND provider_type=?3
      AND json_extract(config_json,?4)=?5 LIMIT 1`).bind(workspaceId, channelId, connectorType, jsonPath, value).first();
  if (duplicate) {
    const label = connectorType === "whatsapp_cloud" ? "WhatsApp phone number" : connectorType === "instagram" ? "Instagram account" : "Facebook Page";
    throw httpError(409, `This ${label} is already connected in the workspace.`);
  }
}
__name(assertUniqueManagedConfig, "assertUniqueManagedConfig");
async function assertUniqueVerifiedProviderId(env, workspaceId, connectorType, channelId, providerId) {
  const duplicate = await env.DB.prepare(`SELECT channel_id FROM channels
    WHERE workspace_id=?1 AND channel_id<>?2 AND provider_type=?3
      AND json_extract(config_json,'$.verifiedProviderId')=?4 LIMIT 1`).bind(workspaceId, channelId, connectorType, providerId).first();
  if (duplicate) throw httpError(409, "This Telegram bot is already connected in the workspace.");
}
__name(assertUniqueVerifiedProviderId, "assertUniqueVerifiedProviderId");
function isUniqueConstraintError(error) {
  return /unique constraint/i.test(String(error?.message || error || ""));
}
__name(isUniqueConstraintError, "isUniqueConstraintError");
function validateCredentialPayload(connectorType, supplied) {
  if (supplied === void 0 || supplied === null) return {};
  if (typeof supplied !== "object" || Array.isArray(supplied)) throw httpError(400, "Credentials must be an object.");
  const allowed = CONNECTOR_DEFINITIONS[connectorType]?.requiredCredentials || [];
  const unknown = Object.keys(supplied).filter((key) => !allowed.includes(key));
  if (unknown.length) throw httpError(400, `Unsupported credential field: ${unknown[0]}.`);
  const credentials = {};
  for (const key of allowed) {
    if (!Object.hasOwn(supplied, key)) continue;
    if (typeof supplied[key] !== "string") throw httpError(400, `${credentialLabel(key)} must be text.`);
    const value = supplied[key].trim();
    if (!value) continue;
    if (value.length > MAX_CREDENTIAL_LENGTH) throw httpError(400, `${credentialLabel(key)} is too long.`);
    if (/[\u0000-\u001f\u007f]/.test(value)) throw httpError(400, `${credentialLabel(key)} contains invalid characters.`);
    if (key === "accessToken" && value.length < 16) throw httpError(400, "Access token is too short.");
    if (key === "appSecret") {
      if (value.length < 16) throw httpError(400, "App secret is too short.");
      assertMetaAppSecret(value);
    }
    if (key === "verifyToken" && value.length > 256) throw httpError(400, "Verify token is too long.");
    if (key === "botToken" && !/^\d{5,15}:[A-Za-z0-9_-]{20,}$/.test(value)) throw httpError(400, "Telegram bot token format is invalid.");
    if (key === "webhookSecret" && !/^[A-Za-z0-9_-]{1,256}$/.test(value)) {
      throw httpError(400, "Telegram webhook secret may contain only letters, numbers, underscores, and hyphens.");
    }
    credentials[key] = value;
  }
  return credentials;
}
__name(validateCredentialPayload, "validateCredentialPayload");
function assertMetaAppSecret(value, status = 400) {
  const secret = String(value || "");
  if (/^EAA/i.test(secret) && secret.length > 64 || secret.length > 128) {
    throw httpError(status, "Meta App Secret is invalid. Use App Settings \u2192 Basic \u2192 App Secret, not an access token or Client Token.");
  }
}
__name(assertMetaAppSecret, "assertMetaAppSecret");
function credentialLabel(key) {
  return {
    accessToken: "Access token",
    appSecret: "App secret",
    verifyToken: "Verify token",
    botToken: "Telegram bot token",
    webhookSecret: "Telegram webhook secret"
  }[key] || "Credential";
}
__name(credentialLabel, "credentialLabel");
async function storeChannelCredentials(env, channel, credentials, updatedByUserId = "") {
  const entries = Object.entries(credentials || {});
  if (!entries.length) return;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const statements = [];
  for (const [credentialKey, value] of entries) {
    const encryptedValue = await encryptChannelCredential(
      value,
      env.CHANNEL_CREDENTIALS_KEY,
      channel.workspaceId,
      channel.channelId,
      credentialKey
    );
    statements.push(env.DB.prepare(`INSERT INTO channel_credentials
        (workspace_id,channel_id,credential_key,encrypted_value,created_at,updated_at,updated_by_user_id)
      SELECT ?1,?2,?3,?4,?5,?5,?6
      WHERE EXISTS (SELECT 1 FROM channels WHERE channel_id=?2 AND workspace_id=?1)
      ON CONFLICT(workspace_id,channel_id,credential_key) DO UPDATE SET
        encrypted_value=excluded.encrypted_value,updated_at=excluded.updated_at,
        updated_by_user_id=excluded.updated_by_user_id`).bind(channel.workspaceId, channel.channelId, credentialKey, encryptedValue, now, String(updatedByUserId || "").slice(0, 100)));
  }
  const results = await env.DB.batch(statements);
  if (results.some((result) => !result.meta?.changes)) throw httpError(409, "Channel credentials could not be saved.");
}
__name(storeChannelCredentials, "storeChannelCredentials");
async function readChannelCredentials(env, channel) {
  const result = await env.DB.prepare(`SELECT credential_key,encrypted_value FROM channel_credentials
    WHERE workspace_id=?1 AND channel_id=?2`).bind(channel.workspaceId, channel.channelId).all();
  if (!result.results?.length) return {};
  const allowed = new Set(CONNECTOR_DEFINITIONS[channel.connectorType]?.requiredCredentials || []);
  const credentials = {};
  try {
    for (const row of result.results) {
      if (!allowed.has(row.credential_key)) continue;
      credentials[row.credential_key] = await decryptChannelCredential(
        row.encrypted_value,
        env.CHANNEL_CREDENTIALS_KEY,
        channel.workspaceId,
        channel.channelId,
        row.credential_key
      );
    }
  } catch (error) {
    if (error?.status === 503) throw error;
    throw httpError(503, "Stored channel credentials could not be decrypted.");
  }
  return credentials;
}
__name(readChannelCredentials, "readChannelCredentials");
async function encryptChannelCredential(value, masterSecret, workspaceId, channelId, credentialKey) {
  const plaintext = String(value || "");
  if (!plaintext || plaintext.length > MAX_CREDENTIAL_LENGTH) throw httpError(400, "Credential value is invalid.");
  const key = await importChannelCredentialKey(masterSecret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = channelCredentialAad(workspaceId, channelId, credentialKey);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData },
    key,
    new TextEncoder().encode(plaintext)
  );
  return `v1.${base64UrlEncode2(iv)}.${base64UrlEncode2(new Uint8Array(encrypted))}`;
}
__name(encryptChannelCredential, "encryptChannelCredential");
async function decryptChannelCredential(packed, masterSecret, workspaceId, channelId, credentialKey) {
  const parts = String(packed || "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("Unsupported encrypted credential format.");
  const iv = base64UrlDecode2(parts[1]);
  const ciphertext = base64UrlDecode2(parts[2]);
  if (iv.length !== 12 || !ciphertext.length) throw new Error("Encrypted credential is invalid.");
  const key = await importChannelCredentialKey(masterSecret);
  const decrypted = await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv,
    additionalData: channelCredentialAad(workspaceId, channelId, credentialKey)
  }, key, ciphertext);
  const plaintext = new TextDecoder().decode(decrypted);
  if (!plaintext || plaintext.length > MAX_CREDENTIAL_LENGTH) throw new Error("Decrypted credential is invalid.");
  return plaintext;
}
__name(decryptChannelCredential, "decryptChannelCredential");
async function encryptOutboundPayload(value, masterSecret, workspaceId, messageId) {
  const plaintext = typeof value === "string" ? value : JSON.stringify(value);
  if (!plaintext || new TextEncoder().encode(plaintext).byteLength > MAX_EXTERNAL_JSON_BODY) {
    throw httpError(400, "Outbound template payload is invalid or too large.");
  }
  const key = await importChannelCredentialKey(masterSecret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = outboundPayloadAad(workspaceId, messageId);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData },
    key,
    new TextEncoder().encode(plaintext)
  );
  return `v1.${base64UrlEncode2(iv)}.${base64UrlEncode2(new Uint8Array(encrypted))}`;
}
__name(encryptOutboundPayload, "encryptOutboundPayload");
async function decryptOutboundPayload(packed, masterSecret, workspaceId, messageId) {
  const parts = String(packed || "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("Unsupported encrypted outbound payload format.");
  const iv = base64UrlDecode2(parts[1]);
  const ciphertext = base64UrlDecode2(parts[2]);
  if (iv.length !== 12 || !ciphertext.length) throw new Error("Encrypted outbound payload is invalid.");
  const key = await importChannelCredentialKey(masterSecret);
  const decrypted = await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv,
    additionalData: outboundPayloadAad(workspaceId, messageId)
  }, key, ciphertext);
  const plaintext = new TextDecoder().decode(decrypted);
  if (!plaintext || new TextEncoder().encode(plaintext).byteLength > MAX_EXTERNAL_JSON_BODY) {
    throw new Error("Decrypted outbound payload is invalid.");
  }
  return JSON.parse(plaintext);
}
__name(decryptOutboundPayload, "decryptOutboundPayload");
async function importChannelCredentialKey(masterSecret) {
  const bytes = new TextEncoder().encode(String(masterSecret || ""));
  if (bytes.length < 32) throw httpError(503, "Channel credential encryption is not configured.");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
__name(importChannelCredentialKey, "importChannelCredentialKey");
function channelCredentialAad(workspaceId, channelId, credentialKey) {
  return new TextEncoder().encode(`helixcer-channel-v1
${workspaceId}
${channelId}
${credentialKey}`);
}
__name(channelCredentialAad, "channelCredentialAad");
function outboundPayloadAad(workspaceId, messageId) {
  return new TextEncoder().encode(`helixcer-outbound-v1
${workspaceId}
${messageId}`);
}
__name(outboundPayloadAad, "outboundPayloadAad");
function base64UrlEncode2(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(base64UrlEncode2, "base64UrlEncode");
function base64UrlDecode2(value) {
  const input = String(value || "");
  if (!/^[A-Za-z0-9_-]+$/.test(input)) throw new Error("Encrypted credential encoding is invalid.");
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - input.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
__name(base64UrlDecode2, "base64UrlDecode");
async function listConversations(env, workspaceId, url, options = {}) {
  const limit = clampInt(url.searchParams.get("limit"), 1, MAX_CONVERSATION_LIST_LIMIT, DEFAULT_CONVERSATION_PAGE_SIZE);
  const status = url.searchParams.get("status") || "";
  const channelId = url.searchParams.get("channelId") || "";
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const cursor = url.searchParams.get("cursor") || "";
  const allowedChannelIds = Array.isArray(options.allowedChannelIds) ? options.allowedChannelIds : null;
  const assignedMatchers = options.assignedOnly ? [
    options.assignedOnly.user?.email,
    options.assignedOnly.user?.displayName,
    options.assignedOnly.user?.userId
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean) : [];
  if (allowedChannelIds && channelId && !allowedChannelIds.includes(channelId)) {
    return { items: [], nextCursor: "" };
  }
  const result = await env.DB.prepare(`SELECT c.conversation_id,c.contact_id,c.channel_id,c.identity_id,c.status,c.assigned_to,
      c.subject,c.last_message_at,c.unread_count,c.tags_json,ch.name AS channel_name,ch.connector_type,ch.provider_type,
      COALESCE(b.scoped_profile_id,CASE WHEN c.identity_id='' THEN (SELECT legacy.channel_profile_id FROM channel_identities legacy
        WHERE legacy.workspace_id=c.workspace_id AND legacy.contact_id=c.contact_id AND legacy.channel_id=c.channel_id
        ORDER BY legacy.created_at LIMIT 1) ELSE '' END,'') AS channel_profile_id,
      (SELECT text FROM messages m WHERE m.workspace_id=c.workspace_id AND m.conversation_id=c.conversation_id
        AND m.direction!='internal'
        ORDER BY timestamp DESC,message_id DESC LIMIT 1) AS last_message,
      (SELECT message_type FROM messages m WHERE m.workspace_id=c.workspace_id AND m.conversation_id=c.conversation_id
        AND m.direction!='internal'
        ORDER BY timestamp DESC,message_id DESC LIMIT 1) AS last_message_type,
      (SELECT MAX(timestamp) FROM messages inbound WHERE inbound.workspace_id=c.workspace_id
        AND inbound.conversation_id=c.conversation_id AND inbound.direction='inbound') AS last_inbound_at
    FROM conversations c JOIN channels ch ON ch.channel_id=c.channel_id
    LEFT JOIN channel_identity_bindings b ON b.workspace_id=c.workspace_id AND b.identity_id=c.identity_id
      AND b.channel_id=c.channel_id AND b.active=1
    WHERE c.workspace_id=?1 AND ch.workspace_id=?1 AND (?2='' OR c.status=?2)
      AND (?3='' OR EXISTS (SELECT 1 FROM messages route_message
        WHERE route_message.workspace_id=c.workspace_id
          AND route_message.conversation_id=c.conversation_id
          AND route_message.channel_id=?3))
      AND (?4='' OR c.subject LIKE '%'||?4||'%' OR c.conversation_id LIKE '%'||?4||'%'
        OR EXISTS (SELECT 1 FROM contacts route_contact
          WHERE route_contact.workspace_id=c.workspace_id AND route_contact.contact_id=c.contact_id
            AND (instr(lower(COALESCE(route_contact.display_name,'')),lower(?4))>0
              OR instr(lower(COALESCE(route_contact.company,'')),lower(?4))>0))
        OR EXISTS (SELECT 1 FROM contact_identities route_identity
          JOIN channel_identity_bindings route_binding
            ON route_binding.workspace_id=route_identity.workspace_id
           AND route_binding.identity_id=route_identity.identity_id
          WHERE route_identity.workspace_id=c.workspace_id
            AND route_identity.contact_id=c.contact_id
            AND (route_binding.scoped_profile_id LIKE '%'||?4||'%'
              OR route_identity.profile_id LIKE '%'||?4||'%'))
        OR EXISTS (SELECT 1 FROM messages search_message
          WHERE search_message.workspace_id=c.workspace_id
            AND search_message.conversation_id=c.conversation_id
            AND instr(lower(COALESCE(search_message.text,'')),lower(?4))>0))
      AND (?5='' OR c.last_message_at<?5)
      AND (?7=0 OR c.channel_id IN (SELECT value FROM json_each(?8)))
      AND (?9=0 OR lower(c.assigned_to) IN (SELECT lower(value) FROM json_each(?10)))
    ORDER BY c.last_message_at DESC LIMIT ?6`).bind(
    workspaceId,
    status,
    channelId,
    q,
    cursor,
    limit,
    allowedChannelIds ? 1 : 0,
    JSON.stringify(allowedChannelIds || []),
    assignedMatchers.length ? 1 : 0,
    JSON.stringify(assignedMatchers)
  ).all();
  const items = result.results.map(conversationListItem);
  const contactIds = [...new Set(items.map((item) => item.contactId).filter(Boolean))];
  const routes = await conversationRouteOptionsByContact(env, workspaceId, { contactIds });
  const mapped = items.map((item) => {
    const next = withConversationRoutes(item, routes.get(item.contactId) || []);
    if (!allowedChannelIds) return next;
    return {
      ...next,
      routes: (Array.isArray(next.routes) ? next.routes : []).filter((route) => allowedChannelIds.includes(route.channelId))
    };
  });
  const lastRow = result.results[result.results.length - 1];
  return {
    items: mapped,
    nextCursor: mapped.length === limit ? String(lastRow?.last_message_at || "") : ""
  };
}
__name(listConversations, "listConversations");
function assertPrincipalChannelAccess(principal, channelId) {
  const allowed = restrictedChannelIds(principal);
  if (allowed && !allowed.includes(channelId)) {
    throw httpError(403, "You do not have access to this messaging channel.");
  }
}
__name(assertPrincipalChannelAccess, "assertPrincipalChannelAccess");
async function assertConversationChannelAccess(env, workspaceId, conversationId, principal) {
  const allowed = restrictedChannelIds(principal);
  if (!allowed) return null;
  const row = await env.DB.prepare(`SELECT channel_id FROM conversations
    WHERE conversation_id=?1 AND workspace_id=?2`).bind(conversationId, workspaceId).first();
  if (!row) throw httpError(404, "Conversation not found.");
  if (!allowed.includes(row.channel_id)) {
    throw httpError(403, "You do not have access to this conversation.");
  }
  return row.channel_id;
}
__name(assertConversationChannelAccess, "assertConversationChannelAccess");
async function searchMessages(env, workspaceId, url, options = {}) {
  const query = (url.searchParams.get("q") || "").trim().slice(0, 100);
  if (!query) return [];
  const limit = clampInt(url.searchParams.get("limit"), 1, 100, 50);
  const conversationId = String(url.searchParams.get("conversationId") || "").trim().slice(0, 100);
  const textOnly = ["1", "true", "yes"].includes(String(url.searchParams.get("textOnly") || "").toLowerCase());
  const allowedChannelIds = Array.isArray(options.allowedChannelIds) ? options.allowedChannelIds : null;
  const result = await env.DB.prepare(`SELECT m.message_id,m.conversation_id,m.identity_id,m.text,m.message_type,m.direction,m.timestamp,
      c.contact_id,c.status AS conversation_status,c.assigned_to,c.unread_count,
      ct.display_name,ct.company,ch.channel_id,
      COALESCE(NULLIF(m.route_channel_name,''),ch.name) AS channel_name,
      COALESCE(NULLIF(m.route_connector_type,''),NULLIF(ch.provider_type,''),ch.connector_type) AS connector_type,
      '' AS provider_type,
      COALESCE(NULLIF(m.route_channel_profile_id,''),b.scoped_profile_id,ci.profile_id,'') AS channel_profile_id
    FROM messages m
    JOIN conversations c ON c.workspace_id=m.workspace_id AND c.conversation_id=m.conversation_id
    JOIN contacts ct ON ct.workspace_id=m.workspace_id AND ct.contact_id=c.contact_id
    JOIN channels ch ON ch.workspace_id=m.workspace_id AND ch.channel_id=m.channel_id
    LEFT JOIN contact_identities ci ON ci.workspace_id=m.workspace_id AND ci.identity_id=m.identity_id
    LEFT JOIN channel_identity_bindings b ON b.workspace_id=m.workspace_id AND b.identity_id=m.identity_id
      AND b.channel_id=m.channel_id AND b.active=1
    WHERE m.workspace_id=?1
      AND (?6='' OR m.conversation_id=?6)
      AND (
        instr(lower(COALESCE(m.text,'')),lower(?2))>0
        OR (?7=0 AND (
          instr(lower(COALESCE(ct.display_name,'')),lower(?2))>0
          OR instr(lower(COALESCE(ct.company,'')),lower(?2))>0
          OR instr(lower(COALESCE(b.scoped_profile_id,ci.profile_id,'')),lower(?2))>0
        ))
      )
      AND (?4=0 OR m.channel_id IN (SELECT value FROM json_each(?5)))
    ORDER BY m.timestamp DESC,m.message_id DESC LIMIT ?3`).bind(
    workspaceId,
    query,
    limit,
    allowedChannelIds ? 1 : 0,
    JSON.stringify(allowedChannelIds || []),
    conversationId,
    textOnly ? 1 : 0
  ).all();
  return (result.results || []).map((row) => ({
    messageId: row.message_id,
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    contactIdentityId: row.identity_id || "",
    identityId: row.identity_id || "",
    contactName: String(row.display_name || "").slice(0, 120),
    company: String(row.company || "").slice(0, 160),
    channelId: row.channel_id,
    channelName: row.channel_name || "",
    connectorType: logicalConnectorType(row),
    channelProfileId: row.channel_profile_id || "",
    text: row.text || "",
    messageType: row.message_type || "text",
    direction: row.direction || "",
    timestamp: row.timestamp || "",
    conversationStatus: row.conversation_status || "",
    assignedTo: row.assigned_to || "",
    unreadCount: Number(row.unread_count || 0)
  }));
}
__name(searchMessages, "searchMessages");
function conversationListItem(row) {
  const connectorType = logicalConnectorType(row);
  return {
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    channelId: row.channel_id,
    contactIdentityId: row.identity_id || "",
    identityId: row.identity_id || "",
    channelName: row.channel_name,
    connectorType,
    status: row.status,
    assignedTo: row.assigned_to,
    subject: row.subject,
    lastMessageAt: row.last_message_at,
    unreadCount: Number(row.unread_count || 0),
    tags: safeJsonParse(row.tags_json, []),
    lastMessage: row.last_message || "",
    lastMessageType: row.last_message_type || "",
    channelProfileId: row.channel_profile_id || "",
    ...whatsappReplyWindowState(connectorType, row.last_inbound_at)
  };
}
__name(conversationListItem, "conversationListItem");
async function getConversation(env, workspaceId, conversationId) {
  const row = await env.DB.prepare(`SELECT conversation_id,contact_id,channel_id,identity_id,status,assigned_to,subject
    FROM conversations WHERE conversation_id=?1 AND workspace_id=?2`).bind(conversationId, workspaceId).first();
  if (!row) throw httpError(404, "Conversation not found.");
  return {
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    channelId: row.channel_id,
    identityId: row.identity_id || "",
    status: row.status,
    assignedTo: row.assigned_to || "",
    subject: row.subject || ""
  };
}
__name(getConversation, "getConversation");
async function getConversationItem(env, workspaceId, conversationId) {
  const row = await env.DB.prepare(`SELECT c.conversation_id,c.contact_id,c.channel_id,c.identity_id,c.status,c.assigned_to,
      c.subject,c.last_message_at,c.unread_count,c.tags_json,ch.name AS channel_name,ch.connector_type,ch.provider_type,
      COALESCE(b.scoped_profile_id,CASE WHEN c.identity_id='' THEN (SELECT legacy.channel_profile_id FROM channel_identities legacy
        WHERE legacy.workspace_id=c.workspace_id AND legacy.contact_id=c.contact_id AND legacy.channel_id=c.channel_id
        ORDER BY legacy.created_at LIMIT 1) ELSE '' END,'') AS channel_profile_id,
      (SELECT text FROM messages m WHERE m.workspace_id=c.workspace_id AND m.conversation_id=c.conversation_id
        AND m.direction!='internal'
        ORDER BY timestamp DESC,message_id DESC LIMIT 1) AS last_message,
      (SELECT message_type FROM messages m WHERE m.workspace_id=c.workspace_id AND m.conversation_id=c.conversation_id
        AND m.direction!='internal'
        ORDER BY timestamp DESC,message_id DESC LIMIT 1) AS last_message_type,
      (SELECT MAX(timestamp) FROM messages inbound WHERE inbound.workspace_id=c.workspace_id
        AND inbound.conversation_id=c.conversation_id AND inbound.direction='inbound') AS last_inbound_at
    FROM conversations c JOIN channels ch ON ch.channel_id=c.channel_id AND ch.workspace_id=c.workspace_id
    LEFT JOIN channel_identity_bindings b ON b.workspace_id=c.workspace_id AND b.identity_id=c.identity_id
      AND b.channel_id=c.channel_id AND b.active=1
    WHERE c.workspace_id=?1 AND c.conversation_id=?2 LIMIT 1`).bind(workspaceId, conversationId).first();
  if (!row) return null;
  const item = conversationListItem(row);
  const routes = await listConversationRouteOptions(env, workspaceId, item.contactId);
  return withConversationRoutes(item, routes);
}
__name(getConversationItem, "getConversationItem");
async function conversationRouteOptionsByContact(env, workspaceId, options = {}) {
  const contactIds = Array.isArray(options.contactIds) ? [...new Set(options.contactIds.map((id) => String(id || "").trim()).filter(Boolean))] : null;
  if (contactIds && !contactIds.length) return /* @__PURE__ */ new Map();
  const refreshFromMessages = Boolean(contactIds);
  const result = await env.DB.prepare(`SELECT ci.contact_id,b.identity_id,b.channel_id,
      b.scoped_profile_id,
      ${refreshFromMessages ? `COALESCE((SELECT MAX(inbound.timestamp) FROM messages inbound
        WHERE inbound.workspace_id=b.workspace_id AND inbound.contact_id=ci.contact_id
          AND inbound.channel_id=b.channel_id AND inbound.identity_id=b.identity_id
          AND inbound.direction='inbound'),b.last_inbound_at)` : "b.last_inbound_at"} AS last_inbound_at,
      ${refreshFromMessages ? `COALESCE((SELECT MAX(outbound.timestamp) FROM messages outbound
        WHERE outbound.workspace_id=b.workspace_id AND outbound.contact_id=ci.contact_id
          AND outbound.channel_id=b.channel_id AND outbound.identity_id=b.identity_id
          AND outbound.direction='outbound'),b.last_outbound_at)` : "b.last_outbound_at"} AS last_outbound_at,
      ch.name AS channel_name,ch.connector_type,ch.provider_type,ch.enabled
    FROM channel_identity_bindings b
    JOIN contact_identities ci ON ci.workspace_id=b.workspace_id AND ci.identity_id=b.identity_id
    JOIN channels ch ON ch.workspace_id=b.workspace_id AND ch.channel_id=b.channel_id
    WHERE b.workspace_id=?1 AND b.active=1
      AND (?2=0 OR ci.contact_id IN (SELECT value FROM json_each(?3)))
    ORDER BY ci.contact_id,
      CASE WHEN b.last_inbound_at='' THEN 1 ELSE 0 END,b.last_inbound_at DESC,
      b.last_seen_at DESC,ch.name COLLATE NOCASE,b.channel_id`).bind(workspaceId, contactIds ? 1 : 0, JSON.stringify(contactIds || [])).all();
  const grouped = /* @__PURE__ */ new Map();
  for (const row of result.results || []) {
    const connectorType = logicalConnectorType(row);
    const replyWindow = whatsappReplyWindowState(connectorType, row.last_inbound_at);
    const option = {
      channelId: row.channel_id,
      identityId: row.identity_id,
      contactIdentityId: row.identity_id,
      connectorType,
      channelName: row.channel_name || "",
      channelProfileId: row.scoped_profile_id || "",
      enabled: Boolean(row.enabled),
      lastInboundAt: row.last_inbound_at || "",
      lastOutboundAt: row.last_outbound_at || "",
      ...replyWindow
    };
    if (!grouped.has(row.contact_id)) grouped.set(row.contact_id, []);
    grouped.get(row.contact_id).push(option);
  }
  return grouped;
}
__name(conversationRouteOptionsByContact, "conversationRouteOptionsByContact");
async function listConversationRouteOptions(env, workspaceId, contactId) {
  const grouped = await conversationRouteOptionsByContact(env, workspaceId, {
    contactIds: contactId ? [contactId] : []
  });
  return grouped.get(contactId) || [];
}
__name(listConversationRouteOptions, "listConversationRouteOptions");
function withConversationRoutes(item, routeOptions) {
  const options = Array.isArray(routeOptions) ? routeOptions : [];
  const newestInboundRoute = /* @__PURE__ */ __name((routes) => routes.reduce((newest, route) => {
    const timestamp = new Date(String(route.lastInboundAt || "")).valueOf();
    if (!Number.isFinite(timestamp)) return newest;
    if (!newest || timestamp > newest.timestamp) return { route, timestamp };
    return newest;
  }, null)?.route || null, "newestInboundRoute");
  const defaultRoute = newestInboundRoute(options.filter((route) => route.enabled)) || options.find((route) => route.enabled && route.channelId === item.channelId && route.identityId === item.identityId) || options.find((route) => route.enabled) || newestInboundRoute(options) || options.find((route) => route.channelId === item.channelId && route.identityId === item.identityId) || options[0] || null;
  return {
    ...item,
    routeOptions: options,
    defaultChannelId: defaultRoute?.channelId || item.channelId || "",
    defaultIdentityId: defaultRoute?.identityId || item.identityId || "",
    defaultRoute: defaultRoute || null
  };
}
__name(withConversationRoutes, "withConversationRoutes");
async function getConversationReplyWindow(env, workspaceId, conversationId) {
  const item = await getConversationItem(env, workspaceId, conversationId);
  if (!item) throw httpError(404, "Conversation not found.");
  const route = item.defaultRoute;
  if (!route) {
    return { freeformAllowed: false, replyWindowExpiresAt: "", replyWindowReason: "No active channel route is available." };
  }
  return {
    freeformAllowed: Boolean(route.enabled) && Boolean(route.freeformAllowed),
    replyWindowExpiresAt: route.replyWindowExpiresAt || "",
    replyWindowReason: route.enabled ? route.replyWindowReason || "" : "The selected channel is disabled."
  };
}
__name(getConversationReplyWindow, "getConversationReplyWindow");
function whatsappReplyWindowState(connectorType, lastInboundAt, now = Date.now()) {
  if (connectorType !== "whatsapp_cloud" && connectorType !== "facebook_messenger" && connectorType !== "instagram") {
    return { freeformAllowed: true, replyWindowExpiresAt: "", replyWindowReason: "" };
  }
  const providerLabel = connectorType === "facebook_messenger" ? "Messenger" : connectorType === "instagram" ? "Instagram" : "WhatsApp";
  const inboundTime = new Date(String(lastInboundAt || "")).valueOf();
  if (!Number.isFinite(inboundTime)) {
    return {
      freeformAllowed: false,
      replyWindowExpiresAt: "",
      replyWindowReason: connectorType === "facebook_messenger" ? "No customer message has opened the Messenger 24-hour messaging window." : connectorType === "instagram" ? "No customer message has opened the Instagram 24-hour messaging window." : "No customer message has opened the WhatsApp 24-hour service window. Send an approved template."
    };
  }
  const expiresAt = inboundTime + WHATSAPP_REPLY_WINDOW_MS;
  const freeformAllowed = Number(now) <= expiresAt;
  return {
    freeformAllowed,
    replyWindowExpiresAt: new Date(expiresAt).toISOString(),
    replyWindowReason: freeformAllowed ? "" : connectorType === "facebook_messenger" || connectorType === "instagram" ? `The ${providerLabel} 24-hour messaging window has closed.` : "The WhatsApp 24-hour service window has closed. Send an approved template to continue."
  };
}
__name(whatsappReplyWindowState, "whatsappReplyWindowState");
function contactListWhereSql() {
  return `c.workspace_id=?1 AND (?2='' OR
      instr(lower(COALESCE(c.display_name,'')),lower(?2))>0 OR
      instr(lower(COALESCE(c.company,'')),lower(?2))>0 OR
      instr(lower(COALESCE(c.tags_json,'')),lower(?2))>0 OR
      EXISTS (SELECT 1 FROM contact_platform_ids flat
        WHERE flat.workspace_id=c.workspace_id AND flat.contact_id=c.contact_id
          AND instr(lower(COALESCE(flat.profile_id,'')),lower(?2))>0) OR
      EXISTS (SELECT 1 FROM contact_identities legacy
        WHERE legacy.workspace_id=c.workspace_id AND legacy.contact_id=c.contact_id
          AND legacy.platform NOT IN ('whatsapp','telegram','instagram','facebook','email')
          AND instr(lower(COALESCE(legacy.profile_id,'')),lower(?2))>0))`;
}
__name(contactListWhereSql, "contactListWhereSql");
async function listContacts(env, workspaceId, url) {
  const limit = clampInt(
    url.searchParams.get("contactLimit") || url.searchParams.get("limit"),
    1,
    MAX_CONTACT_LIST_LIMIT,
    DEFAULT_CONTACT_PAGE_SIZE
  );
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 100);
  const page = clampInt(url.searchParams.get("page"), 1, 1e6, 1);
  const offset = (page - 1) * limit;
  const cursor = String(url.searchParams.get("cursor") || url.searchParams.get("contactCursor") || "").trim();
  const whereSql = contactListWhereSql();
  const countRow = await env.DB.prepare(`SELECT COUNT(*) AS count FROM contacts c WHERE ${whereSql}`).bind(workspaceId, q).first();
  const total = Number(countRow?.count || 0);
  const result = cursor ? await env.DB.prepare(`SELECT c.contact_id,c.display_name,c.company,c.tags_json,c.attributes_json,c.updated_at,
      (SELECT MAX(last_message_at) FROM conversations cv
        WHERE cv.workspace_id=c.workspace_id AND cv.contact_id=c.contact_id) AS last_message_at
    FROM contacts c
    WHERE ${whereSql}
      AND COALESCE(
        (SELECT MAX(last_message_at) FROM conversations cv
          WHERE cv.workspace_id=c.workspace_id AND cv.contact_id=c.contact_id),
        c.updated_at) < ?3
    ORDER BY COALESCE(last_message_at,c.updated_at) DESC LIMIT ?4`).bind(workspaceId, q, cursor, limit).all() : await env.DB.prepare(`SELECT c.contact_id,c.display_name,c.company,c.tags_json,c.attributes_json,c.updated_at,
      (SELECT MAX(last_message_at) FROM conversations cv
        WHERE cv.workspace_id=c.workspace_id AND cv.contact_id=c.contact_id) AS last_message_at
    FROM contacts c
    WHERE ${whereSql}
    ORDER BY COALESCE(last_message_at,c.updated_at) DESC LIMIT ?3 OFFSET ?4`).bind(workspaceId, q, limit, offset).all();
  const rows = result.results || [];
  const items = await hydrateContactViews(env, workspaceId, rows);
  const lastRow = rows[rows.length - 1];
  const hasMore = cursor ? items.length === limit : offset + items.length < total;
  return {
    items,
    total,
    page,
    pageSize: limit,
    nextCursor: hasMore ? String(lastRow?.last_message_at || lastRow?.updated_at || "") : ""
  };
}
__name(listContacts, "listContacts");
function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
__name(csvCell, "csvCell");
async function exportContactsCsv(env, workspaceId) {
  const result = await env.DB.prepare(`SELECT c.contact_id,c.display_name,c.company,c.tags_json,
      MAX(CASE WHEN flat.platform='whatsapp' THEN flat.profile_id ELSE '' END) AS whatsapp_id,
      MAX(CASE WHEN flat.platform='telegram' THEN flat.profile_id ELSE '' END) AS telegram_id,
      MAX(CASE WHEN flat.platform='instagram' THEN flat.profile_id ELSE '' END) AS instagram_id,
      MAX(CASE WHEN flat.platform='facebook' THEN flat.profile_id ELSE '' END) AS facebook_id,
      MAX(CASE WHEN flat.platform='email' THEN flat.profile_id ELSE '' END) AS email
    FROM contacts c
    LEFT JOIN contact_platform_ids flat
      ON flat.workspace_id=c.workspace_id AND flat.contact_id=c.contact_id
    WHERE c.workspace_id=?1
    GROUP BY c.workspace_id,c.contact_id,c.display_name,c.company,c.tags_json
    ORDER BY lower(c.display_name),c.contact_id`).bind(workspaceId).all();
  const headers = [
    "contact_id",
    "display_name",
    "company",
    "tags",
    "whatsapp_id",
    "telegram_id",
    "instagram_id",
    "facebook_id",
    "email"
  ];
  const lines = [headers.join(",")];
  for (const row of result.results || []) {
    lines.push([
      row.contact_id,
      row.display_name,
      row.company,
      storedContactTags(row.tags_json).join(", "),
      row.whatsapp_id,
      row.telegram_id,
      row.instagram_id,
      row.facebook_id,
      row.email
    ].map(csvCell).join(","));
  }
  return new Response(`\uFEFF${lines.join("\r\n")}\r
`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="helixcer-contacts.csv"',
      "Cache-Control": "no-store"
    }
  });
}
__name(exportContactsCsv, "exportContactsCsv");
function canonicalIdentityPlatform(value) {
  const raw = String(value || "").trim().toLowerCase();
  const platform = raw === "whatsapp_cloud" ? "whatsapp" : raw === "facebook_messenger" || raw === "messenger" ? "facebook" : raw;
  if (!/^[a-z][a-z0-9_-]{1,39}$/.test(platform)) throw httpError(400, "Identity platform is invalid.");
  return platform;
}
__name(canonicalIdentityPlatform, "canonicalIdentityPlatform");
function platformForChannel(channel) {
  return canonicalIdentityPlatform(channel?.connectorType || channel?.connector_type || channel?.provider_type || "");
}
__name(platformForChannel, "platformForChannel");
function normalizeIdentityProfileValue(platform, value, label = "Profile ID") {
  const profile = cleanRequired(value, label, 512);
  if (platform === "whatsapp" && /^\+?[\d\s().-]+$/.test(profile)) return normalizeWhatsAppRecipient(profile);
  return profile;
}
__name(normalizeIdentityProfileValue, "normalizeIdentityProfileValue");
function validateContactPlatformIds(value, { requireOne = true } = {}) {
  if (!isPlainObject(value)) throw httpError(400, "Platform IDs must be an object.");
  rejectUnknownKeys(value, CONTACT_ID_PLATFORM_SET, "platform IDs");
  const result = Object.fromEntries(CONTACT_ID_PLATFORMS.map((platform) => [platform, ""]));
  for (const platform of CONTACT_ID_PLATFORMS) {
    const raw = value[platform];
    if (raw === void 0 || raw === null || String(raw).trim() === "") continue;
    result[platform] = normalizeIdentityProfileValue(
      platform,
      cleanRequired(raw, `${platform} ID`, platform === "email" ? 254 : 512),
      `${platform} ID`
    );
    if (platform === "email") result[platform] = result[platform].toLowerCase();
  }
  if (requireOne && !CONTACT_ID_PLATFORMS.some((platform) => result[platform])) {
    throw httpError(400, "Provide at least one platform ID.");
  }
  return result;
}
__name(validateContactPlatformIds, "validateContactPlatformIds");
function platformIdsFromIdentities(identities = []) {
  const result = Object.fromEntries(CONTACT_ID_PLATFORMS.map((platform) => [platform, ""]));
  for (const identity of identities) {
    const platform = String(identity?.platform || "").toLowerCase();
    if (CONTACT_ID_PLATFORM_SET.has(platform) && !result[platform]) {
      result[platform] = String(identity?.profileId || "");
    }
  }
  return result;
}
__name(platformIdsFromIdentities, "platformIdsFromIdentities");
function validateContactIdentityInput(value, defaults = {}) {
  if (!isPlainObject(value)) throw httpError(400, "Contact identity must be an object.");
  rejectUnknownKeys(value, /* @__PURE__ */ new Set([
    "identityId",
    "platform",
    "connectorType",
    "profileId",
    "channelProfileId",
    "scopedProfileId",
    "username",
    "phoneNumber",
    "email",
    "displayName",
    "metadata",
    "isPrimary",
    "channelId",
    "bindings",
    "routes"
  ]), "contact identity");
  const identityId = value.identityId === void 0 ? "" : cleanId(value.identityId, "Identity ID");
  const platformSource = value.platform ?? value.connectorType ?? defaults.platform;
  let platform = platformSource ? canonicalIdentityPlatform(platformSource) : "";
  const email = value.email === void 0 ? "" : cleanOptionalText(value.email, "Email", 254).toLowerCase();
  let rawProfileId = value.profileId ?? value.channelProfileId ?? (platform === "email" ? email : "") ?? "";
  if (!platform && email) platform = "email";
  if (!platform) throw httpError(400, "Identity platform is required.");
  rawProfileId = cleanRequired(rawProfileId, "Profile ID", 512);
  const profileId = normalizeIdentityProfileValue(platform, rawProfileId, "Profile ID");
  const scopedRaw = value.scopedProfileId ?? value.channelProfileId ?? profileId;
  const scopedProfileId = normalizeIdentityProfileValue(platform, scopedRaw, "Channel profile ID");
  const username = value.username === void 0 ? "" : cleanOptionalText(value.username, "Username", 200);
  const suppliedPhone = value.phoneNumber === void 0 ? "" : cleanOptionalText(value.phoneNumber, "Phone number", 80);
  const phoneNumber = suppliedPhone && /^\+?[\d\s().-]+$/.test(suppliedPhone) ? normalizeWhatsAppRecipient(suppliedPhone) : suppliedPhone;
  const displayName = value.displayName === void 0 ? String(defaults.displayName || "").slice(0, 120) : cleanOptionalText(value.displayName, "Identity display name", 120);
  if (value.metadata !== void 0 && !isPlainObject(value.metadata)) {
    throw httpError(400, "Identity metadata must be an object.");
  }
  const metadata = { ...isPlainObject(value.metadata) ? value.metadata : {} };
  if (value.isPrimary !== void 0) metadata.isPrimary = Boolean(value.isPrimary);
  const metadataJson = JSON.stringify(metadata);
  if (metadataJson.length > 1e4) throw httpError(400, "Identity metadata is too large.");
  const channelId = value.channelId === void 0 || value.channelId === null || value.channelId === "" ? "" : cleanId(value.channelId, "Channel ID");
  const routeSources = [];
  let routesProvided = false;
  for (const key of ["bindings", "routes"]) {
    if (value[key] === void 0) continue;
    routesProvided = true;
    if (!Array.isArray(value[key]) || value[key].length > 50) {
      throw httpError(400, "Identity routes must be an array with no more than 50 items.");
    }
    routeSources.push(...value[key]);
  }
  if (channelId) routeSources.push({ channelId, scopedProfileId });
  const routes = [];
  const seenRoutes = /* @__PURE__ */ new Set();
  const seenRouteChannels = /* @__PURE__ */ new Set();
  for (const route of routeSources) {
    if (!isPlainObject(route)) throw httpError(400, "Each identity route must be an object.");
    rejectUnknownKeys(route, /* @__PURE__ */ new Set(["bindingId", "channelId", "scopedProfileId", "channelProfileId", "metadata", "active"]), "identity route");
    if (route.active === false) continue;
    const routeChannelId = cleanId(route.channelId, "Route channel ID");
    const scopedRawValue = route.scopedProfileId ?? route.channelProfileId ?? profileId;
    const routeProfileId = normalizeIdentityProfileValue(platform, scopedRawValue, "Route profile ID");
    const key = `${routeChannelId}
${routeProfileId}`;
    if (seenRoutes.has(key)) continue;
    if (seenRouteChannels.has(routeChannelId)) {
      throw httpError(400, "An identity can have only one active route per channel.");
    }
    seenRoutes.add(key);
    seenRouteChannels.add(routeChannelId);
    if (route.metadata !== void 0 && !isPlainObject(route.metadata)) {
      throw httpError(400, "Route metadata must be an object.");
    }
    routes.push({
      channelId: routeChannelId,
      scopedProfileId: routeProfileId,
      metadata: isPlainObject(route.metadata) ? route.metadata : {}
    });
  }
  return {
    identityId,
    platform,
    profileId,
    scopedProfileId,
    username,
    phoneNumber,
    displayName,
    metadata,
    channelId,
    routes,
    routesProvided
  };
}
__name(validateContactIdentityInput, "validateContactIdentityInput");
async function prevalidateIdentityRoutes(env, workspaceId, identityId, normalized) {
  for (const route of normalized.routes) {
    const routeOwner = await env.DB.prepare(`SELECT b.identity_id
      FROM channel_identity_bindings b
      WHERE b.workspace_id=?1 AND b.channel_id=?2 AND b.scoped_profile_id=?3 AND b.active=1 LIMIT 1`).bind(workspaceId, route.channelId, route.scopedProfileId).first();
    if (routeOwner && routeOwner.identity_id !== identityId) {
      throw httpError(409, "This channel profile is already assigned to another contact identity.");
    }
    if (!routeOwner) {
      const channel = await getChannel(env, route.channelId, "", workspaceId);
      if (!channel) throw httpError(400, "Unknown or disabled channel.");
      if (platformForChannel(channel) !== normalized.platform) {
        throw httpError(400, "The selected channel does not match the identity platform.");
      }
    }
    await assertIdentityRouteProfileChangeAllowed(
      env,
      workspaceId,
      identityId,
      route.channelId,
      route.scopedProfileId
    );
  }
}
__name(prevalidateIdentityRoutes, "prevalidateIdentityRoutes");
async function assertIdentityRouteProfileChangeAllowed(env, workspaceId, identityId, channelId, scopedProfileId) {
  const previous = await env.DB.prepare(`SELECT scoped_profile_id
    FROM channel_identity_bindings
    WHERE workspace_id=?1 AND identity_id=?2 AND channel_id=?3
    ORDER BY active DESC,updated_at DESC,created_at DESC LIMIT 1`).bind(workspaceId, identityId, channelId).first();
  if (!previous || previous.scoped_profile_id === scopedProfileId) return;
  if (await identityChannelHasHistory(env, workspaceId, identityId, channelId)) {
    throw httpError(
      409,
      "This channel route has conversation history. Its Channel Profile ID cannot be changed; add another identity instead."
    );
  }
}
__name(assertIdentityRouteProfileChangeAllowed, "assertIdentityRouteProfileChangeAllowed");
async function identityChannelHasHistory(env, workspaceId, identityId, channelId) {
  const history = await env.DB.prepare(`SELECT
      EXISTS(SELECT 1 FROM conversations
        WHERE workspace_id=?1 AND channel_id=?3 AND (
          identity_id=?2 OR (identity_id='' AND contact_id=(SELECT contact_id FROM contact_identities
            WHERE workspace_id=?1 AND identity_id=?2 LIMIT 1))) LIMIT 1) AS has_conversation,
      EXISTS(SELECT 1 FROM messages
        WHERE workspace_id=?1 AND channel_id=?3 AND (
          identity_id=?2 OR (identity_id='' AND contact_id=(SELECT contact_id FROM contact_identities
            WHERE workspace_id=?1 AND identity_id=?2 LIMIT 1))) LIMIT 1) AS has_message,
      EXISTS(SELECT 1 FROM channel_identity_bindings
        WHERE workspace_id=?1 AND identity_id=?2 AND channel_id=?3
          AND last_conversation_id<>'') AS has_bound_conversation`).bind(workspaceId, identityId, channelId).first();
  return Boolean(Number(history?.has_conversation || 0) || Number(history?.has_message || 0) || Number(history?.has_bound_conversation || 0));
}
__name(identityChannelHasHistory, "identityChannelHasHistory");
async function prevalidateIdentityRouteRemovals(env, workspaceId, identityId, normalized) {
  if (!normalized.routesProvided) return [];
  const selected = new Set(normalized.routes.map((route) => `${route.channelId}
${route.scopedProfileId}`));
  const active = await env.DB.prepare(`SELECT binding_id,channel_id,scoped_profile_id
    FROM channel_identity_bindings WHERE workspace_id=?1 AND identity_id=?2 AND active=1`).bind(workspaceId, identityId).all();
  const remove = (active.results || []).filter((route) => !selected.has(`${route.channel_id}
${route.scoped_profile_id}`));
  for (const route of remove) {
    if (await identityChannelHasHistory(env, workspaceId, identityId, route.channel_id)) {
      throw httpError(
        409,
        "This channel route has conversation history and cannot be removed. Delete its conversations first."
      );
    }
  }
  return remove;
}
__name(prevalidateIdentityRouteRemovals, "prevalidateIdentityRouteRemovals");
async function prevalidateContactIdentityBatch(env, workspaceId, contactId, values, displayName) {
  if (!Array.isArray(values) || values.length > 50) {
    throw httpError(400, "Identities must be an array with no more than 50 items.");
  }
  const existingResult = await env.DB.prepare(`SELECT * FROM contact_identities
    WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, contactId).all();
  const existingRows = existingResult.results || [];
  const existingById = new Map(existingRows.map((row) => [String(row.identity_id), row]));
  const existingByCanonical = new Map(existingRows.map((row) => [`${row.platform}
${row.profile_id}`, row]));
  const seenTargets = /* @__PURE__ */ new Set();
  const seenCanonical = /* @__PURE__ */ new Map();
  const seenRoutes = /* @__PURE__ */ new Map();
  const seenFlatPlatforms = /* @__PURE__ */ new Set();
  let primaryCount = 0;
  for (const value of values) {
    if (!isPlainObject(value)) throw httpError(400, "Each contact identity must be an object.");
    const suppliedIdentityId = value.identityId === void 0 || value.identityId === null || value.identityId === "" ? "" : cleanId(value.identityId, "Identity ID");
    let existing = suppliedIdentityId ? existingById.get(suppliedIdentityId) : null;
    if (suppliedIdentityId && !existing) throw httpError(404, "Contact identity not found.");
    const platformSource = value.platform ?? value.connectorType ?? existing?.platform;
    const profileSource = value.profileId ?? value.channelProfileId ?? existing?.profile_id;
    const preliminary = validateContactIdentityInput({
      ...value,
      ...suppliedIdentityId ? { identityId: suppliedIdentityId } : {},
      platform: platformSource,
      profileId: profileSource,
      username: value.username ?? existing?.username ?? "",
      phoneNumber: value.phoneNumber ?? existing?.phone_number ?? "",
      displayName: value.displayName ?? existing?.display_name ?? displayName,
      metadata: value.metadata ?? safeJsonParse(existing?.metadata_json, {})
    }, { displayName });
    const canonicalKey = `${preliminary.platform}
${preliminary.profileId}`;
    if (CONTACT_ID_PLATFORM_SET.has(preliminary.platform)) {
      if (seenFlatPlatforms.has(preliminary.platform)) {
        throw httpError(409, `A contact can have only one ${preliminary.platform} ID.`);
      }
      seenFlatPlatforms.add(preliminary.platform);
    }
    if (!existing) existing = existingByCanonical.get(canonicalKey) || null;
    const targetKey = existing?.identity_id || suppliedIdentityId || `new:${canonicalKey}`;
    if (seenTargets.has(targetKey)) throw httpError(400, "The same contact identity was supplied more than once.");
    seenTargets.add(targetKey);
    if (existing && (preliminary.platform !== existing.platform || preliminary.profileId !== existing.profile_id)) {
      throw httpError(400, "Identity platform and profile ID cannot be changed. Add another identity instead.");
    }
    const canonicalOwner = seenCanonical.get(canonicalKey);
    if (canonicalOwner && canonicalOwner !== targetKey) {
      throw httpError(409, "The same platform identity was supplied more than once.");
    }
    seenCanonical.set(canonicalKey, targetKey);
    if (preliminary.metadata.isPrimary) primaryCount += 1;
    const validationIdentityId = existing?.identity_id || suppliedIdentityId || crypto.randomUUID();
    await prevalidateIdentityRoutes(env, workspaceId, validationIdentityId, preliminary);
    if (existing) await prevalidateIdentityRouteRemovals(env, workspaceId, existing.identity_id, preliminary);
    for (const route of preliminary.routes) {
      const routeKey = `${route.channelId}
${route.scopedProfileId}`;
      const routeOwner = seenRoutes.get(routeKey);
      if (routeOwner && routeOwner !== targetKey) {
        throw httpError(409, "The same channel profile route was supplied for more than one identity.");
      }
      seenRoutes.set(routeKey, targetKey);
    }
  }
  if (primaryCount > 1) throw httpError(400, "Only one contact identity can be primary.");
}
__name(prevalidateContactIdentityBatch, "prevalidateContactIdentityBatch");
async function contactIdentityRows(env, workspaceId, contactIds = []) {
  if (!contactIds.length) return [];
  const ids = [...new Set(contactIds.map((id) => String(id || "").trim()).filter(Boolean))].slice(0, 2e3);
  if (!ids.length) return [];
  const result = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id,ci.platform,ci.profile_id,ci.username,
      ci.phone_number,ci.display_name,ci.metadata_json,ci.created_at,ci.updated_at,
      b.binding_id,b.channel_id,b.scoped_profile_id,b.metadata_json AS binding_metadata_json,
      b.first_seen_at,b.last_seen_at,b.last_inbound_at,b.last_outbound_at,b.last_conversation_id,
      ch.name AS channel_name,ch.connector_type,ch.provider_type,ch.enabled,
      cv.conversation_id,cv.status AS conversation_status,cv.last_message_at
    FROM contact_identities ci
    LEFT JOIN contact_platform_ids flat
      ON flat.workspace_id=ci.workspace_id AND flat.contact_id=ci.contact_id
      AND flat.platform=ci.platform AND flat.identity_id=ci.identity_id
    LEFT JOIN channel_identity_bindings b
      ON b.workspace_id=ci.workspace_id AND b.identity_id=ci.identity_id AND b.active=1
    LEFT JOIN channels ch ON ch.workspace_id=ci.workspace_id AND ch.channel_id=b.channel_id
    LEFT JOIN conversations cv ON cv.workspace_id=ci.workspace_id AND cv.identity_id=ci.identity_id
      AND cv.channel_id=b.channel_id
    WHERE ci.workspace_id=?1 AND ci.contact_id IN (SELECT value FROM json_each(?2))
      AND (ci.platform NOT IN ('whatsapp','telegram','instagram','facebook','email')
        OR flat.identity_id IS NOT NULL)
    ORDER BY ci.created_at,ci.identity_id,b.last_seen_at DESC,b.created_at DESC`).bind(workspaceId, JSON.stringify(ids)).all();
  return result.results || [];
}
__name(contactIdentityRows, "contactIdentityRows");
async function hydrateContactViews(env, workspaceId, rows) {
  if (!rows.length) return [];
  const identityRows = await contactIdentityRows(env, workspaceId, rows.map((row) => row.contact_id));
  const byContact = /* @__PURE__ */ new Map();
  for (const row of identityRows) {
    if (!byContact.has(row.contact_id)) byContact.set(row.contact_id, /* @__PURE__ */ new Map());
    const identities = byContact.get(row.contact_id);
    let identity = identities.get(row.identity_id);
    if (!identity) {
      const metadata = safeJsonParse(row.metadata_json, {});
      identity = {
        identityId: row.identity_id,
        platform: row.platform || "",
        profileId: row.profile_id || "",
        username: row.username || "",
        phoneNumber: row.phone_number || "",
        email: row.platform === "email" ? row.profile_id || "" : "",
        displayName: row.display_name || "",
        metadata: isPlainObject(metadata) ? metadata : {},
        isPrimary: Boolean(metadata?.isPrimary),
        createdAt: row.created_at || "",
        updatedAt: row.updated_at || "",
        bindings: [],
        routes: []
      };
      identities.set(row.identity_id, identity);
    }
    if (row.binding_id) {
      identity.bindings.push({
        bindingId: row.binding_id,
        channelId: row.channel_id || "",
        channelName: row.channel_name || "",
        connectorType: logicalConnectorType(row),
        channelProfileId: row.scoped_profile_id || row.profile_id || "",
        scopedProfileId: row.scoped_profile_id || "",
        channelEnabled: Boolean(row.enabled),
        conversationId: row.conversation_id || "",
        conversationStatus: row.conversation_status || "",
        lastMessageAt: row.last_message_at || "",
        firstSeenAt: row.first_seen_at || "",
        lastSeenAt: row.last_seen_at || "",
        lastInboundAt: row.last_inbound_at || "",
        lastOutboundAt: row.last_outbound_at || "",
        lastConversationId: row.last_conversation_id || row.conversation_id || "",
        metadata: safeJsonParse(row.binding_metadata_json, {})
      });
    }
  }
  return rows.map((row) => {
    const identities = [...byContact.get(row.contact_id)?.values() || []];
    if (identities.length && !identities.some((identity) => identity.isPrimary)) identities[0].isPrimary = true;
    for (const identity of identities) {
      identity.bindings.sort((a, b) => String(b.lastMessageAt || b.lastSeenAt).localeCompare(String(a.lastMessageAt || a.lastSeenAt)));
      const binding = identity.bindings[0] || {};
      Object.assign(identity, {
        channelId: binding.channelId || "",
        channelName: binding.channelName || "",
        connectorType: binding.connectorType || "",
        channelProfileId: binding.channelProfileId || identity.profileId,
        channelEnabled: Boolean(binding.channelEnabled),
        conversationId: binding.conversationId || "",
        conversationStatus: binding.conversationStatus || "",
        lastMessageAt: binding.lastMessageAt || ""
      });
      identity.routes = identity.bindings;
    }
    identities.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || String(b.lastMessageAt || b.updatedAt).localeCompare(String(a.lastMessageAt || a.updatedAt)));
    return contactView(row, identities);
  });
}
__name(hydrateContactViews, "hydrateContactViews");
async function listWorkspaceTags(env, workspaceId) {
  const result = await env.DB.prepare(`SELECT MIN(trim(CAST(tag.value AS TEXT))) AS tag
    FROM contacts c
    JOIN json_each(CASE
      WHEN json_valid(c.tags_json) THEN CASE
        WHEN json_type(c.tags_json)='array' THEN c.tags_json
        ELSE '[]'
      END
      ELSE '[]'
    END) tag
    WHERE c.workspace_id=?1 AND tag.type='text'
      AND length(trim(CAST(tag.value AS TEXT))) BETWEEN 1 AND 40
    GROUP BY lower(trim(CAST(tag.value AS TEXT)))
    ORDER BY lower(tag),tag
    LIMIT 200`).bind(workspaceId).all();
  return (result.results || []).map((row) => String(row.tag || "").trim()).filter(Boolean);
}
__name(listWorkspaceTags, "listWorkspaceTags");
async function loadContactRow(env, workspaceId, contactId) {
  return env.DB.prepare(`SELECT c.contact_id,c.display_name,c.company,c.tags_json,c.attributes_json,c.updated_at,
      i.identity_id,i.channel_id,i.channel_profile_id,ch.name AS channel_name,ch.connector_type,ch.provider_type,
      cv.status AS conversation_status,cv.last_message_at,
      (SELECT COUNT(*) FROM contact_identities identities
        WHERE identities.workspace_id=c.workspace_id AND identities.contact_id=c.contact_id) AS identity_count,
      (SELECT COUNT(*) FROM conversations conversations
        WHERE conversations.workspace_id=c.workspace_id AND conversations.contact_id=c.contact_id) AS conversation_count,
      (SELECT COUNT(*) FROM messages messages
        JOIN conversations message_conversations
          ON message_conversations.workspace_id=messages.workspace_id
          AND message_conversations.conversation_id=messages.conversation_id
        WHERE messages.workspace_id=c.workspace_id
          AND message_conversations.contact_id=c.contact_id) AS message_count
    FROM contacts c
    LEFT JOIN channel_identities i ON i.identity_id=(SELECT identity_id FROM channel_identities
      WHERE workspace_id=c.workspace_id AND contact_id=c.contact_id ORDER BY created_at LIMIT 1)
    LEFT JOIN channels ch ON ch.workspace_id=c.workspace_id AND ch.channel_id=i.channel_id
    LEFT JOIN conversations cv ON cv.conversation_id=(SELECT conversation_id FROM conversations
      WHERE workspace_id=c.workspace_id AND contact_id=c.contact_id ORDER BY last_message_at DESC LIMIT 1)
    WHERE c.workspace_id=?1 AND c.contact_id=?2`).bind(workspaceId, contactId).first();
}
__name(loadContactRow, "loadContactRow");
async function getContactDetail(env, workspaceId, contactId) {
  const row = await loadContactRow(env, workspaceId, cleanId(contactId, "Contact ID"));
  if (!row) throw httpError(404, "Contact not found.");
  const items = await hydrateContactViews(env, workspaceId, [row]);
  return items[0];
}
__name(getContactDetail, "getContactDetail");
function contactView(row, identities = []) {
  const attributes = safeJsonParse(row.attributes_json, {});
  const displayName = String(row.display_name || "").slice(0, 120);
  const tags = storedContactTags(row.tags_json);
  const preferred = identities.find((identity) => identity.isPrimary) || identities[0] || null;
  const preferredBinding = preferred?.bindings?.[0] || null;
  const conversationStatus = preferredBinding?.conversationStatus || row.conversation_status || "";
  return {
    contactId: row.contact_id,
    displayName,
    name: displayName,
    company: String(row.company || "").slice(0, 160),
    tags,
    platformIds: platformIdsFromIdentities(identities),
    identities,
    identityId: preferred?.identityId || row.identity_id || "",
    channelId: preferredBinding?.channelId || row.channel_id || "",
    channelName: preferredBinding?.channelName || row.channel_name || "",
    connectorType: preferredBinding?.connectorType || logicalConnectorType(row),
    channelProfileId: preferredBinding?.channelProfileId || preferred?.profileId || row.channel_profile_id || "",
    email: typeof attributes.email === "string" ? attributes.email.slice(0, 254) : "",
    phone: typeof attributes.phone === "string" ? attributes.phone.slice(0, 80) : "",
    status: conversationStatus === "closed" ? "inactive" : "active",
    conversationStatus,
    channelEditable: false,
    lastMessageAt: preferredBinding?.lastMessageAt || row.last_message_at || row.updated_at
  };
}
__name(contactView, "contactView");
function storedContactTags(value) {
  const tags = safeJsonParse(value, []);
  if (!Array.isArray(tags)) return [];
  return tags.filter((tag) => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean).slice(0, 20);
}
__name(storedContactTags, "storedContactTags");
function validateContactTags(value) {
  if (!Array.isArray(value)) throw httpError(400, "Tags must be an array of text values.");
  if (value.length > 20) throw httpError(400, "A contact may have no more than 20 tags.");
  const tags = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of value) {
    if (typeof item !== "string") throw httpError(400, "Each tag must be text.");
    const tag = cleanRequired(item, "Tag", 40);
    const key = tag.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}
__name(validateContactTags, "validateContactTags");
async function ensureContactIdentity(env, workspaceId, contactId, input, now = (/* @__PURE__ */ new Date()).toISOString()) {
  const contact = await env.DB.prepare(`SELECT contact_id,display_name FROM contacts
    WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, contactId).first();
  if (!contact) throw httpError(404, "Contact not found.");
  const normalized = validateContactIdentityInput(input, { displayName: contact.display_name });
  let existing = normalized.identityId ? await env.DB.prepare(`SELECT * FROM contact_identities
        WHERE workspace_id=?1 AND contact_id=?2 AND identity_id=?3`).bind(workspaceId, contactId, normalized.identityId).first() : await env.DB.prepare(`SELECT * FROM contact_identities
        WHERE workspace_id=?1 AND contact_id=?2 AND platform=?3 AND profile_id=?4 LIMIT 1`).bind(workspaceId, contactId, normalized.platform, normalized.profileId).first();
  if (normalized.identityId && !existing) throw httpError(404, "Contact identity not found.");
  if (normalized.identityId && existing && (normalized.platform !== existing.platform || normalized.profileId !== existing.profile_id)) {
    throw httpError(400, "Identity platform and profile ID cannot be changed. Add another identity instead.");
  }
  const identityId = existing?.identity_id || normalized.identityId || crypto.randomUUID();
  if (CONTACT_ID_PLATFORM_SET.has(normalized.platform)) {
    const flatOwner = await env.DB.prepare(`SELECT identity_id FROM contact_platform_ids
      WHERE workspace_id=?1 AND contact_id=?2 AND platform=?3`).bind(workspaceId, contactId, normalized.platform).first();
    if (flatOwner && flatOwner.identity_id !== identityId) {
      throw httpError(409, `This contact already has a ${normalized.platform} ID.`);
    }
  }
  await prevalidateIdentityRoutes(env, workspaceId, identityId, normalized);
  const statements = [];
  if (!existing) {
    const count = await env.DB.prepare(`SELECT COUNT(*) AS count FROM contact_identities
      WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, contactId).first();
    if (normalized.metadata.isPrimary === void 0 && Number(count?.count || 0) === 0) {
      normalized.metadata.isPrimary = true;
    }
    if (normalized.metadata.isPrimary) {
      const others = await env.DB.prepare(`SELECT identity_id,metadata_json FROM contact_identities
        WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, contactId).all();
      for (const other of others.results || []) {
        const metadata = safeJsonParse(other.metadata_json, {});
        if (isPlainObject(metadata) && metadata.isPrimary) {
          delete metadata.isPrimary;
          statements.push(env.DB.prepare(`UPDATE contact_identities SET metadata_json=?4,updated_at=?5
            WHERE workspace_id=?1 AND contact_id=?2 AND identity_id=?3`).bind(workspaceId, contactId, other.identity_id, JSON.stringify(metadata), now));
        }
      }
    }
    statements.push(env.DB.prepare(`INSERT INTO contact_identities
        (identity_id,workspace_id,contact_id,platform,profile_id,username,phone_number,display_name,
         metadata_json,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)`).bind(
      identityId,
      workspaceId,
      contactId,
      normalized.platform,
      normalized.profileId,
      normalized.username,
      normalized.phoneNumber,
      normalized.displayName || contact.display_name,
      JSON.stringify(normalized.metadata),
      now
    ));
    existing = { identity_id: identityId };
  }
  if (CONTACT_ID_PLATFORM_SET.has(normalized.platform)) {
    statements.push(env.DB.prepare(`INSERT OR IGNORE INTO contact_platform_ids
        (workspace_id,contact_id,platform,profile_id,identity_id,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?6)`).bind(workspaceId, contactId, normalized.platform, normalized.profileId, existing.identity_id, now));
  }
  const bindings = [];
  for (const route of normalized.routes) {
    const mutation = await prepareIdentityBindingMutation(
      env,
      workspaceId,
      contactId,
      existing.identity_id,
      { ...normalized, ...route, channelId: route.channelId, scopedProfileId: route.scopedProfileId },
      now
    );
    statements.push(...mutation.statements);
    bindings.push(mutation.binding);
  }
  if (statements.length) await env.DB.batch(statements);
  return { identityId: existing.identity_id, binding: bindings[0] || null, bindings, normalized };
}
__name(ensureContactIdentity, "ensureContactIdentity");
async function ensureIdentityBinding(env, workspaceId, contactId, identityId, identity, now = (/* @__PURE__ */ new Date()).toISOString()) {
  const mutation = await prepareIdentityBindingMutation(env, workspaceId, contactId, identityId, identity, now);
  if (mutation.statements.length) await env.DB.batch(mutation.statements);
  return mutation.binding;
}
__name(ensureIdentityBinding, "ensureIdentityBinding");
async function prepareIdentityBindingMutation(env, workspaceId, contactId, identityId, identity, now = (/* @__PURE__ */ new Date()).toISOString()) {
  const routeOwner = await env.DB.prepare(`SELECT b.binding_id,b.identity_id,ci.contact_id
    FROM channel_identity_bindings b JOIN contact_identities ci ON ci.identity_id=b.identity_id
    WHERE b.workspace_id=?1 AND b.channel_id=?2 AND b.scoped_profile_id=?3 AND b.active=1 LIMIT 1`).bind(workspaceId, identity.channelId, identity.scopedProfileId).first();
  if (routeOwner && routeOwner.identity_id !== identityId) {
    throw httpError(409, "This channel profile is already assigned to another contact identity.");
  }
  if (routeOwner) {
    return {
      binding: {
        bindingId: routeOwner.binding_id,
        channelId: identity.channelId,
        channelProfileId: identity.scopedProfileId
      },
      statements: [env.DB.prepare(`UPDATE channel_identity_bindings SET metadata_json=?4,last_seen_at=?5,updated_at=?5
        WHERE workspace_id=?1 AND binding_id=?2 AND identity_id=?3`).bind(workspaceId, routeOwner.binding_id, identityId, JSON.stringify(identity.metadata || {}), now)]
    };
  }
  const channel = await getChannel(env, identity.channelId, "", workspaceId);
  if (!channel) throw httpError(400, "Unknown or disabled channel.");
  if (platformForChannel(channel) !== identity.platform) {
    throw httpError(400, "The selected channel does not match the identity platform.");
  }
  await assertIdentityRouteProfileChangeAllowed(
    env,
    workspaceId,
    identityId,
    identity.channelId,
    identity.scopedProfileId
  );
  let binding = await env.DB.prepare(`SELECT binding_id FROM channel_identity_bindings
    WHERE workspace_id=?1 AND identity_id=?2 AND channel_id=?3 AND scoped_profile_id=?4
    ORDER BY created_at DESC LIMIT 1`).bind(workspaceId, identityId, identity.channelId, identity.scopedProfileId).first();
  const bindingId = binding?.binding_id || crypto.randomUUID();
  const statements = [
    env.DB.prepare(`UPDATE channel_identity_bindings SET active=0,updated_at=?4
      WHERE workspace_id=?1 AND identity_id=?2 AND channel_id=?3 AND active=1`).bind(workspaceId, identityId, identity.channelId, now)
  ];
  if (binding) {
    statements.push(env.DB.prepare(`UPDATE channel_identity_bindings SET active=1,metadata_json=?3,last_seen_at=?4,updated_at=?4
      WHERE workspace_id=?1 AND binding_id=?2`).bind(workspaceId, bindingId, JSON.stringify(identity.metadata || {}), now));
  } else {
    statements.push(env.DB.prepare(`INSERT INTO channel_identity_bindings
        (binding_id,workspace_id,identity_id,channel_id,scoped_profile_id,metadata_json,active,
         first_seen_at,last_seen_at,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,1,?7,?7,?7,?7)`).bind(
      bindingId,
      workspaceId,
      identityId,
      identity.channelId,
      identity.scopedProfileId,
      JSON.stringify(identity.metadata || {}),
      now
    ));
    statements.push(env.DB.prepare(`INSERT OR IGNORE INTO channel_identities
        (identity_id,contact_id,channel_id,channel_profile_id,display_name,metadata_json,created_at,workspace_id)
      VALUES (?1,?2,?3,?4,?5,'{}',?6,?7)`).bind(
      bindingId,
      contactId,
      identity.channelId,
      identity.scopedProfileId,
      identity.displayName || "",
      now,
      workspaceId
    ));
  }
  return {
    binding: { bindingId, channelId: identity.channelId, channelProfileId: identity.scopedProfileId },
    statements
  };
}
__name(prepareIdentityBindingMutation, "prepareIdentityBindingMutation");
async function ensureIdentityConversation(env, workspaceId, contactId, identityId, channelId, assignedTo = "", initialStatus = "open") {
  const route = await env.DB.prepare(`SELECT ci.display_name,ct.display_name AS contact_name,ct.tags_json
    FROM contact_identities ci JOIN contacts ct ON ct.contact_id=ci.contact_id AND ct.workspace_id=ci.workspace_id
    JOIN channel_identity_bindings b ON b.identity_id=ci.identity_id AND b.workspace_id=ci.workspace_id
      AND b.channel_id=?4 AND b.active=1
    WHERE ci.workspace_id=?1 AND ci.contact_id=?2 AND ci.identity_id=?3 LIMIT 1`).bind(workspaceId, contactId, identityId, channelId).first();
  if (!route) throw httpError(409, "This identity is not routed through the selected channel.");
  let conversation = await env.DB.prepare(`SELECT conversation_id,status FROM conversations
    WHERE workspace_id=?1 AND contact_id=?2 LIMIT 1`).bind(workspaceId, contactId).first();
  if (conversation) {
    await touchIdentityBinding(env, workspaceId, identityId, channelId, "", conversation.conversation_id);
    return conversation.conversation_id;
  }
  const legacy = await env.DB.prepare(`SELECT conversation_id FROM conversations
    WHERE workspace_id=?1 AND contact_id=?2 AND channel_id=?3 AND identity_id='' LIMIT 1`).bind(workspaceId, contactId, channelId).first();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let legacyIsUnambiguous = false;
  if (legacy) {
    const candidates = await env.DB.prepare(`SELECT ci.identity_id
      FROM contact_identities ci
      JOIN channel_identity_bindings b ON b.workspace_id=ci.workspace_id AND b.identity_id=ci.identity_id
      WHERE ci.workspace_id=?1 AND ci.contact_id=?2 AND b.channel_id=?3 AND b.active=1
      ORDER BY ci.identity_id`).bind(workspaceId, contactId, channelId).all();
    const candidateIds = [...new Set((candidates.results || []).map((item) => String(item.identity_id || "")).filter(Boolean))];
    legacyIsUnambiguous = candidateIds.length === 1 && candidateIds[0] === identityId;
  }
  if (legacy && legacyIsUnambiguous) {
    try {
      await env.DB.batch([
        env.DB.prepare(`UPDATE conversations SET identity_id=?4,updated_at=?5
          WHERE workspace_id=?1 AND conversation_id=?2 AND contact_id=?3 AND identity_id=''`).bind(workspaceId, legacy.conversation_id, contactId, identityId, now),
        env.DB.prepare(`UPDATE messages SET identity_id=?3
          WHERE workspace_id=?1 AND conversation_id=?2 AND identity_id=''`).bind(workspaceId, legacy.conversation_id, identityId),
        env.DB.prepare(`UPDATE identity_migration_issues SET resolved_at=?3
          WHERE workspace_id=?1 AND conversation_id=?2 AND resolved_at=''`).bind(workspaceId, legacy.conversation_id, now)
      ]);
      await touchIdentityBinding(env, workspaceId, identityId, channelId, "", legacy.conversation_id, now);
      return legacy.conversation_id;
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      conversation = await env.DB.prepare(`SELECT conversation_id FROM conversations
        WHERE workspace_id=?1 AND contact_id=?2 LIMIT 1`).bind(workspaceId, contactId).first();
      if (conversation) {
        await touchIdentityBinding(env, workspaceId, identityId, channelId, "", conversation.conversation_id, now);
        return conversation.conversation_id;
      }
      throw error;
    }
  }
  const conversationId = crypto.randomUUID();
  const status = ["open", "pending", "closed"].includes(String(initialStatus || "")) ? String(initialStatus) : "open";
  try {
    await env.DB.prepare(`INSERT INTO conversations
        (conversation_id,contact_id,channel_id,identity_id,status,assigned_to,subject,last_message_at,
         unread_count,tags_json,created_at,updated_at,workspace_id)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0,?9,?8,?8,?10)`).bind(
      conversationId,
      contactId,
      channelId,
      identityId,
      status,
      assignedTo,
      route.contact_name || route.display_name || "",
      now,
      route.tags_json || "[]",
      workspaceId
    ).run();
    await touchIdentityBinding(env, workspaceId, identityId, channelId, "", conversationId, now);
    return conversationId;
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    conversation = await env.DB.prepare(`SELECT conversation_id FROM conversations
      WHERE workspace_id=?1 AND contact_id=?2 LIMIT 1`).bind(workspaceId, contactId).first();
    if (!conversation) throw error;
    await touchIdentityBinding(env, workspaceId, identityId, channelId, "", conversation.conversation_id, now);
    return conversation.conversation_id;
  }
}
__name(ensureIdentityConversation, "ensureIdentityConversation");
async function reconcileLegacyConversationIdentity(env, workspaceId, conversationId) {
  const conversation = await env.DB.prepare(`SELECT c.conversation_id,c.contact_id,c.channel_id,c.identity_id,
      ch.connector_type,ch.provider_type
    FROM conversations c JOIN channels ch ON ch.channel_id=c.channel_id AND ch.workspace_id=c.workspace_id
    WHERE c.workspace_id=?1 AND c.conversation_id=?2`).bind(workspaceId, conversationId).first();
  if (!conversation || conversation.identity_id) return conversation;
  const routes = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id
    FROM channel_identity_bindings b JOIN contact_identities ci ON ci.identity_id=b.identity_id
      AND ci.workspace_id=b.workspace_id
    WHERE b.workspace_id=?1 AND b.channel_id=?2 AND ci.contact_id=?3 AND b.active=1
    ORDER BY b.created_at,b.binding_id`).bind(workspaceId, conversation.channel_id, conversation.contact_id).all();
  let identity = (routes.results || []).length === 1 ? routes.results[0] : null;
  if (!identity && (routes.results || []).length === 0) {
    const legacy = await env.DB.prepare(`SELECT channel_profile_id,display_name,metadata_json,MIN(created_at) AS created_at
      FROM channel_identities
      WHERE workspace_id=?1 AND contact_id=?2 AND channel_id=?3
      GROUP BY channel_profile_id,display_name,metadata_json
      ORDER BY created_at,channel_profile_id`).bind(workspaceId, conversation.contact_id, conversation.channel_id).all();
    const legacyRoutes = legacy.results || [];
    const distinctProfiles = [...new Set(legacyRoutes.map((row) => String(row.channel_profile_id || "")))].filter(Boolean);
    if (distinctProfiles.length === 1) {
      const route = legacyRoutes.find((row) => String(row.channel_profile_id || "") === distinctProfiles[0]);
      const platform = platformForChannel(conversation);
      const result = await ensureContactIdentity(env, workspaceId, conversation.contact_id, {
        platform,
        profileId: distinctProfiles[0],
        username: "",
        phoneNumber: platform === "whatsapp" && /^\d{6,20}$/.test(distinctProfiles[0]) ? distinctProfiles[0] : "",
        displayName: String(route?.display_name || "").slice(0, 120),
        metadata: safeJsonParse(route?.metadata_json, {}),
        channelId: conversation.channel_id,
        scopedProfileId: distinctProfiles[0]
      });
      identity = { identity_id: result.identityId, contact_id: conversation.contact_id };
    }
  }
  if (!identity) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const candidateCount = Number((routes.results || []).length);
    await env.DB.prepare(`INSERT INTO identity_migration_issues
        (issue_id,workspace_id,conversation_id,issue_type,candidate_count,details_json,created_at,resolved_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,'')
      ON CONFLICT(issue_id) DO UPDATE SET issue_type=excluded.issue_type,
        candidate_count=excluded.candidate_count,details_json=excluded.details_json,resolved_at=''`).bind(
      `${conversationId}:runtime-identity`,
      workspaceId,
      conversationId,
      candidateCount > 1 ? "ambiguous_identity" : "missing_identity",
      candidateCount,
      JSON.stringify({ contactId: conversation.contact_id, channelId: conversation.channel_id }),
      now
    ).run();
    return conversation;
  }
  await ensureIdentityConversation(
    env,
    workspaceId,
    conversation.contact_id,
    identity.identity_id,
    conversation.channel_id,
    ""
  );
  return { ...conversation, identity_id: identity.identity_id };
}
__name(reconcileLegacyConversationIdentity, "reconcileLegacyConversationIdentity");
async function touchIdentityBinding(env, workspaceId, identityId, channelId, direction = "", conversationId = "", now = (/* @__PURE__ */ new Date()).toISOString()) {
  const inbound = direction === "inbound" ? now : "";
  const outbound = direction === "outbound" ? now : "";
  await env.DB.prepare(`UPDATE channel_identity_bindings SET
      last_seen_at=?5,
      last_inbound_at=CASE WHEN ?6<>'' THEN ?6 ELSE last_inbound_at END,
      last_outbound_at=CASE WHEN ?7<>'' THEN ?7 ELSE last_outbound_at END,
      last_conversation_id=CASE WHEN ?4<>'' THEN ?4 ELSE last_conversation_id END,
      updated_at=?5
    WHERE workspace_id=?1 AND identity_id=?2 AND channel_id=?3 AND active=1`).bind(workspaceId, identityId, channelId, conversationId, now, inbound, outbound).run();
}
__name(touchIdentityBinding, "touchIdentityBinding");
async function openIdentityConversation(env, workspaceId, payload, principal) {
  if (!isPlainObject(payload)) throw httpError(400, "Conversation request must be a JSON object.");
  rejectUnknownKeys(payload, /* @__PURE__ */ new Set(["contactId", "identityId", "channelId"]), "conversation request");
  const identityId = cleanId(payload.identityId, "Identity ID");
  const identity = await env.DB.prepare(`SELECT identity_id,contact_id,platform,profile_id,username,phone_number,
      display_name,metadata_json FROM contact_identities
    WHERE workspace_id=?1 AND identity_id=?2`).bind(workspaceId, identityId).first();
  if (!identity) throw httpError(404, "Contact identity not found.");
  const contactId = identity.contact_id;
  if (payload.contactId !== void 0 && cleanId(payload.contactId, "Contact ID") !== contactId) {
    throw httpError(409, "The identity does not belong to the supplied contact.");
  }
  let channelId = payload.channelId === void 0 || payload.channelId === null || payload.channelId === "" ? "" : cleanId(payload.channelId, "Channel ID");
  if (!channelId) {
    const routes = await env.DB.prepare(`SELECT channel_id FROM channel_identity_bindings
      WHERE workspace_id=?1 AND identity_id=?2 AND active=1 ORDER BY last_seen_at DESC`).bind(workspaceId, identityId).all();
    if ((routes.results || []).length === 1) channelId = routes.results[0].channel_id;
    else if ((routes.results || []).length > 1) throw httpError(400, "Select one connected channel for this identity.");
    else throw httpError(409, "Add a channel route to this identity before starting a conversation.");
  }
  const channel = await getChannel(env, channelId, "", workspaceId);
  if (!channel || platformForChannel(channel) !== identity.platform) {
    throw httpError(400, "The selected channel is not compatible with this identity.");
  }
  assertPrincipalChannelAccess(principal, channelId);
  await assertChannelReadyForConversation(env, workspaceId, channel);
  const currentBinding = await env.DB.prepare(`SELECT binding_id FROM channel_identity_bindings
    WHERE workspace_id=?1 AND identity_id=?2 AND channel_id=?3 AND active=1 LIMIT 1`).bind(workspaceId, identityId, channelId).first();
  let routeCreated = false;
  if (!currentBinding) {
    await ensureIdentityBinding(env, workspaceId, contactId, identityId, {
      platform: identity.platform,
      profileId: identity.profile_id,
      channelId,
      scopedProfileId: identity.profile_id,
      displayName: identity.display_name || "",
      metadata: safeJsonParse(identity.metadata_json, {})
    });
    routeCreated = true;
  }
  const conversationId = await ensureIdentityConversation(
    env,
    workspaceId,
    contactId,
    identityId,
    channelId,
    principal?.user?.email || ""
  );
  await audit(env, principal, "open", "conversation", conversationId, { contactId, identityId, channelId, routeCreated });
  return {
    ok: true,
    conversationId,
    contactId,
    identityId,
    channelId,
    item: await getConversationItem(env, workspaceId, conversationId)
  };
}
__name(openIdentityConversation, "openIdentityConversation");
async function assertChannelReadyForConversation(env, workspaceId, channel) {
  if (!MANAGED_CONNECTORS.has(channel.connectorType)) return;
  const stored = await env.DB.prepare(`SELECT credential_key FROM channel_credentials
    WHERE workspace_id=?1 AND channel_id=?2`).bind(workspaceId, channel.channelId).all();
  const credentialFields = new Set((stored.results || []).map((row) => row.credential_key));
  const health = channelHealth({ enabled: 1, provider_type: channel.connectorType }, channel.config, credentialFields);
  if (health !== "connected") throw httpError(409, "Verify the channel and its webhook before starting a conversation.");
}
__name(assertChannelReadyForConversation, "assertChannelReadyForConversation");
async function createContactIdentity(env, workspaceId, contactId, payload, principal) {
  const id = cleanId(contactId, "Contact ID");
  const result = await ensureContactIdentity(env, workspaceId, id, payload);
  await audit(env, principal, "create", "contact_identity", result.identityId, {
    contactId: id,
    platform: result.normalized.platform,
    channelIds: result.bindings.map((binding) => binding.channelId)
  });
  return {
    ok: true,
    contactId: id,
    identityId: result.identityId,
    conversationIds: [],
    conversationId: "",
    item: await getContactDetail(env, workspaceId, id)
  };
}
__name(createContactIdentity, "createContactIdentity");
async function updateContactIdentity(env, workspaceId, contactId, identityId, payload, principal) {
  if (!isPlainObject(payload)) throw httpError(400, "Contact identity update must be a JSON object.");
  const id = cleanId(contactId, "Contact ID");
  const identity = cleanId(identityId, "Identity ID");
  const existing = await env.DB.prepare(`SELECT * FROM contact_identities
    WHERE workspace_id=?1 AND contact_id=?2 AND identity_id=?3`).bind(workspaceId, id, identity).first();
  if (!existing) throw httpError(404, "Contact identity not found.");
  const merged = {
    ...payload,
    identityId: identity,
    platform: payload.platform ?? payload.connectorType ?? existing.platform,
    profileId: payload.profileId ?? payload.channelProfileId ?? existing.profile_id,
    username: payload.username ?? existing.username,
    phoneNumber: payload.phoneNumber ?? existing.phone_number,
    displayName: payload.displayName ?? existing.display_name,
    metadata: payload.metadata ?? safeJsonParse(existing.metadata_json, {})
  };
  const normalized = validateContactIdentityInput(merged, { displayName: existing.display_name });
  if (normalized.platform !== existing.platform || normalized.profileId !== existing.profile_id) {
    throw httpError(400, "Identity platform and profile ID cannot be changed. Add another identity instead.");
  }
  await prevalidateIdentityRoutes(env, workspaceId, identity, normalized);
  const routesToRemove = await prevalidateIdentityRouteRemovals(env, workspaceId, identity, normalized);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const statements = [];
  if (normalized.metadata.isPrimary) {
    const others = await env.DB.prepare(`SELECT identity_id,metadata_json FROM contact_identities
      WHERE workspace_id=?1 AND contact_id=?2 AND identity_id<>?3`).bind(workspaceId, id, identity).all();
    for (const other of others.results || []) {
      const metadata = safeJsonParse(other.metadata_json, {});
      if (isPlainObject(metadata) && metadata.isPrimary) {
        delete metadata.isPrimary;
        statements.push(env.DB.prepare(`UPDATE contact_identities SET metadata_json=?4,updated_at=?5
          WHERE workspace_id=?1 AND contact_id=?2 AND identity_id=?3`).bind(workspaceId, id, other.identity_id, JSON.stringify(metadata), now));
      }
    }
  }
  statements.push(env.DB.prepare(`UPDATE contact_identities SET username=?4,phone_number=?5,display_name=?6,
      metadata_json=?7,updated_at=?8 WHERE workspace_id=?1 AND contact_id=?2 AND identity_id=?3`).bind(
    workspaceId,
    id,
    identity,
    normalized.username,
    normalized.phoneNumber,
    normalized.displayName,
    JSON.stringify(normalized.metadata),
    now
  ));
  const bindings = [];
  for (const route of normalized.routes) {
    const mutation = await prepareIdentityBindingMutation(
      env,
      workspaceId,
      id,
      identity,
      { ...normalized, ...route, channelId: route.channelId, scopedProfileId: route.scopedProfileId },
      now
    );
    statements.push(...mutation.statements);
    bindings.push(mutation.binding);
  }
  if (routesToRemove.length) {
    statements.push(...routesToRemove.map((route) => env.DB.prepare(`UPDATE channel_identity_bindings
        SET active=0,updated_at=?3 WHERE workspace_id=?1 AND binding_id=?2`).bind(workspaceId, route.binding_id, now)));
  }
  await env.DB.batch(statements);
  await audit(
    env,
    principal,
    "update",
    "contact_identity",
    identity,
    { contactId: id, channelIds: bindings.map((binding) => binding.channelId) }
  );
  return { ok: true, contactId: id, identityId: identity, item: await getContactDetail(env, workspaceId, id) };
}
__name(updateContactIdentity, "updateContactIdentity");
async function deleteContactIdentity(env, workspaceId, contactId, identityId, principal) {
  const id = cleanId(contactId, "Contact ID");
  const identity = cleanId(identityId, "Identity ID");
  const existing = await env.DB.prepare(`SELECT identity_id,platform,profile_id,
      (SELECT COUNT(*) FROM conversations conversation WHERE conversation.workspace_id=?1 AND (
        conversation.identity_id=?3 OR (conversation.identity_id='' AND conversation.contact_id=?2
          AND EXISTS (SELECT 1 FROM channel_identity_bindings binding
            WHERE binding.workspace_id=?1 AND binding.identity_id=?3
              AND binding.channel_id=conversation.channel_id)))) AS conversation_count,
      (SELECT COUNT(*) FROM messages message WHERE message.workspace_id=?1 AND (
        message.identity_id=?3 OR (message.identity_id='' AND message.contact_id=?2
          AND EXISTS (SELECT 1 FROM channel_identity_bindings binding
            WHERE binding.workspace_id=?1 AND binding.identity_id=?3
              AND binding.channel_id=message.channel_id)))) AS message_count
    FROM contact_identities WHERE workspace_id=?1 AND contact_id=?2 AND identity_id=?3`).bind(workspaceId, id, identity).first();
  if (!existing) throw httpError(404, "Contact identity not found.");
  if (Number(existing.conversation_count || 0) || Number(existing.message_count || 0)) {
    throw httpError(409, "Delete this identity\u2019s conversations before deleting the identity.");
  }
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM channel_identities WHERE workspace_id=?1 AND identity_id IN
      (SELECT binding_id FROM channel_identity_bindings WHERE workspace_id=?1 AND identity_id=?2)`).bind(workspaceId, identity),
    env.DB.prepare(`DELETE FROM channel_identity_bindings WHERE workspace_id=?1 AND identity_id=?2`).bind(workspaceId, identity),
    env.DB.prepare(`DELETE FROM contact_identities WHERE workspace_id=?1 AND contact_id=?2 AND identity_id=?3`).bind(workspaceId, id, identity)
  ]);
  await audit(
    env,
    principal,
    "delete",
    "contact_identity",
    identity,
    { contactId: id, platform: existing.platform, profileId: existing.profile_id }
  );
  return { ok: true, contactId: id, identityId: identity, deleted: true, item: await getContactDetail(env, workspaceId, id) };
}
__name(deleteContactIdentity, "deleteContactIdentity");
async function flatIdentityHasHistory(env, workspaceId, contactId, identityId) {
  const result = await env.DB.prepare(`SELECT
      EXISTS(SELECT 1 FROM conversations conversation
        WHERE conversation.workspace_id=?1 AND conversation.contact_id=?2 AND (
          conversation.identity_id=?3 OR (conversation.identity_id='' AND EXISTS (
            SELECT 1 FROM channel_identity_bindings binding
            WHERE binding.workspace_id=?1 AND binding.identity_id=?3
              AND binding.channel_id=conversation.channel_id)))) AS has_conversation,
      EXISTS(SELECT 1 FROM messages message
        WHERE message.workspace_id=?1 AND message.contact_id=?2 AND (
          message.identity_id=?3 OR (message.identity_id='' AND EXISTS (
            SELECT 1 FROM channel_identity_bindings binding
            WHERE binding.workspace_id=?1 AND binding.identity_id=?3
              AND binding.channel_id=message.channel_id)))) AS has_message`).bind(workspaceId, contactId, identityId).first();
  return Boolean(Number(result?.has_conversation || 0) || Number(result?.has_message || 0));
}
__name(flatIdentityHasHistory, "flatIdentityHasHistory");
async function flatIdentityHasBinding(env, workspaceId, identityId) {
  const result = await env.DB.prepare(`SELECT 1 AS found FROM channel_identity_bindings
    WHERE workspace_id=?1 AND identity_id=?2 LIMIT 1`).bind(workspaceId, identityId).first();
  return Boolean(result?.found);
}
__name(flatIdentityHasBinding, "flatIdentityHasBinding");
async function prepareContactPlatformIdMutation(env, workspaceId, contactId, platformIds, displayName, now) {
  const supplied = validateContactPlatformIds(platformIds, { requireOne: false });
  const currentResult = await env.DB.prepare(`SELECT flat.platform,flat.profile_id,flat.identity_id,
      identity.created_at,identity.metadata_json
    FROM contact_platform_ids flat
    JOIN contact_identities identity ON identity.workspace_id=flat.workspace_id
      AND identity.identity_id=flat.identity_id
    WHERE flat.workspace_id=?1 AND flat.contact_id=?2`).bind(workspaceId, contactId).all();
  const current = new Map((currentResult.results || []).map((row) => [String(row.platform), row]));
  const desired = Object.fromEntries(CONTACT_ID_PLATFORMS.map((platform) => [
    platform,
    Object.prototype.hasOwnProperty.call(platformIds, platform) ? supplied[platform] : String(current.get(platform)?.profile_id || "")
  ]));
  if (!CONTACT_ID_PLATFORMS.some((platform) => desired[platform])) {
    throw httpError(400, "Provide at least one platform ID.");
  }
  const statements = [];
  const identityIds = [];
  for (const platform of CONTACT_ID_PLATFORMS) {
    const profileId = desired[platform];
    const previous = current.get(platform);
    if (previous && previous.profile_id === profileId) {
      identityIds.push(previous.identity_id);
      continue;
    }
    if (previous) {
      if (await flatIdentityHasHistory(env, workspaceId, contactId, previous.identity_id)) {
        const action = profileId ? "changed" : "removed";
        throw httpError(409, `The ${platform} ID cannot be ${action} because it has conversation history.`);
      }
      if (await flatIdentityHasBinding(env, workspaceId, previous.identity_id)) {
        const action = profileId ? "changed" : "removed";
        throw httpError(409, `The ${platform} ID cannot be ${action} because it is connected to a channel route. Remove the route first.`);
      }
      if (!profileId) {
        statements.push(
          env.DB.prepare(`DELETE FROM channel_identities WHERE workspace_id=?1 AND identity_id IN
            (SELECT binding_id FROM channel_identity_bindings WHERE workspace_id=?1 AND identity_id=?2)`).bind(workspaceId, previous.identity_id),
          env.DB.prepare(`DELETE FROM contact_platform_ids
            WHERE workspace_id=?1 AND contact_id=?2 AND platform=?3`).bind(workspaceId, contactId, platform),
          env.DB.prepare(`DELETE FROM channel_identity_bindings WHERE workspace_id=?1 AND identity_id=?2`).bind(workspaceId, previous.identity_id),
          env.DB.prepare(`DELETE FROM contact_identities
            WHERE workspace_id=?1 AND contact_id=?2 AND identity_id=?3`).bind(workspaceId, contactId, previous.identity_id)
        );
        continue;
      }
      statements.push(
        env.DB.prepare(`UPDATE contact_identities SET profile_id=?4,username='',phone_number='',display_name='',updated_at=?5
          WHERE workspace_id=?1 AND contact_id=?2 AND identity_id=?3`).bind(workspaceId, contactId, previous.identity_id, profileId, now),
        env.DB.prepare(`UPDATE contact_platform_ids SET profile_id=?4,updated_at=?5
          WHERE workspace_id=?1 AND contact_id=?2 AND platform=?3`).bind(workspaceId, contactId, platform, profileId, now)
      );
      identityIds.push(previous.identity_id);
      continue;
    }
    if (!profileId) continue;
    const identityId = crypto.randomUUID();
    const isFirst = identityIds.length === 0 && current.size === 0;
    statements.push(
      env.DB.prepare(`INSERT INTO contact_identities
          (identity_id,workspace_id,contact_id,platform,profile_id,username,phone_number,display_name,
           metadata_json,created_at,updated_at)
        VALUES (?1,?2,?3,?4,?5,'','','',?6,?7,?7)`).bind(
        identityId,
        workspaceId,
        contactId,
        platform,
        profileId,
        JSON.stringify(isFirst ? { isPrimary: true } : {}),
        now
      ),
      env.DB.prepare(`INSERT INTO contact_platform_ids
          (workspace_id,contact_id,platform,profile_id,identity_id,created_at,updated_at)
        VALUES (?1,?2,?3,?4,?5,?6,?6)`).bind(workspaceId, contactId, platform, profileId, identityId, now)
    );
    identityIds.push(identityId);
  }
  return { desired, statements, identityIds };
}
__name(prepareContactPlatformIdMutation, "prepareContactPlatformIdMutation");
async function updateContact(env, workspaceId, contactId, payload, principal) {
  if (!isPlainObject(payload)) throw httpError(400, "Contact update must be a JSON object.");
  rejectUnknownKeys(payload, /* @__PURE__ */ new Set(["displayName", "name", "company", "tags", "channelId", "channelProfileId", "platformIds", "identities"]), "contact");
  if (!Object.keys(payload).length) throw httpError(400, "Provide at least one contact field to update.");
  if (payload.displayName !== void 0 && payload.name !== void 0 && String(payload.displayName).trim() !== String(payload.name).trim()) {
    throw httpError(400, "Display name and name must match when both are supplied.");
  }
  const id = cleanId(contactId, "Contact ID");
  const existing = await env.DB.prepare(`SELECT contact_id,display_name,company,tags_json,attributes_json
    FROM contacts WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, id).first();
  if (!existing) throw httpError(404, "Contact not found.");
  const suppliedName = payload.displayName === void 0 ? payload.name : payload.displayName;
  if (suppliedName !== void 0 && typeof suppliedName !== "string") throw httpError(400, "Display name must be text.");
  const displayName = suppliedName === void 0 ? existing.display_name : cleanRequired(suppliedName, "Display name", 120);
  const company = payload.company === void 0 ? String(existing.company || "") : cleanOptionalText(payload.company, "Company", 160);
  const tags = payload.tags === void 0 ? storedContactTags(existing.tags_json) : validateContactTags(payload.tags);
  if (payload.platformIds !== void 0 && payload.identities !== void 0) {
    throw httpError(400, "Use platformIds or legacy identities, not both.");
  }
  if (payload.identities !== void 0) {
    await prevalidateContactIdentityBatch(env, workspaceId, id, payload.identities, displayName);
  }
  if (payload.channelId !== void 0 || payload.channelProfileId !== void 0) {
    const hydrated = await getContactDetail(env, workspaceId, id);
    const preferred = hydrated.identities.find((identity) => identity.isPrimary) || hydrated.identities[0];
    if (!preferred) throw httpError(409, "Add a contact identity before assigning a channel.");
    if (payload.channelProfileId !== void 0) {
      const supplied = normalizeIdentityProfileValue(preferred.platform, payload.channelProfileId, "Channel Profile ID");
      if (supplied !== preferred.profileId && supplied !== preferred.channelProfileId) {
        throw httpError(400, "Channel Profile ID cannot be changed. Add another identity instead.");
      }
    }
    if (payload.channelId !== void 0 && cleanId(payload.channelId, "Channel ID") !== preferred.channelId) {
      throw httpError(400, "Use a contact identity route to select another connected channel.");
    }
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const flatMutation = payload.platformIds === void 0 ? null : await prepareContactPlatformIdMutation(env, workspaceId, id, payload.platformIds, displayName, now);
  await env.DB.batch([
    env.DB.prepare(`UPDATE contacts SET display_name=?3,company=?4,tags_json=?5,updated_at=?6
      WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, id, displayName, company, JSON.stringify(tags), now),
    env.DB.prepare(`UPDATE channel_identities SET display_name=?3
      WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, id, displayName),
    env.DB.prepare(`UPDATE contact_identities SET display_name=CASE WHEN display_name='' OR display_name=?3 THEN ?4 ELSE display_name END,
      updated_at=?5 WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, id, existing.display_name, displayName, now),
    env.DB.prepare(`UPDATE conversations SET subject=?3,tags_json=?4,updated_at=?5
      WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, id, displayName, JSON.stringify(tags), now),
    ...flatMutation?.statements || []
  ]);
  if (payload.identities !== void 0) {
    for (const identity of payload.identities) {
      if (identity?.identityId) {
        await updateContactIdentity(env, workspaceId, id, identity.identityId, identity, principal);
      } else {
        await createContactIdentity(env, workspaceId, id, identity, principal);
      }
    }
  }
  const changedFields = [...new Set(Object.keys(payload).map((key) => key === "name" ? "displayName" : key))];
  await audit(env, principal, "update", "contact", id, {
    fields: changedFields,
    identitiesUpdated: flatMutation?.identityIds?.length || (Array.isArray(payload.identities) ? payload.identities.length : 0)
  });
  return getContactDetail(env, workspaceId, id);
}
__name(updateContact, "updateContact");
async function deleteContact(env, workspaceId, contactId, principal) {
  const id = cleanId(contactId, "Contact ID");
  const existing = await env.DB.prepare(`SELECT contact_id,display_name,company,
      (SELECT COUNT(*) FROM contact_identities WHERE workspace_id=?2 AND contact_id=?1) AS identity_count,
      (SELECT COUNT(*) FROM conversations WHERE workspace_id=?2 AND contact_id=?1) AS conversation_count,
      (SELECT COUNT(*) FROM messages WHERE workspace_id=?2 AND contact_id=?1) AS message_count
    FROM contacts WHERE contact_id=?1 AND workspace_id=?2`).bind(id, workspaceId).first();
  if (!existing) throw httpError(404, "Contact not found.");
  const conversations = await env.DB.prepare(`SELECT conversation_id FROM conversations
    WHERE workspace_id=?1 AND contact_id=?2 ORDER BY created_at`).bind(workspaceId, id).all();
  const conversationIds = (conversations.results || []).map((row) => String(row.conversation_id));
  const mediaTargets = await listWhatsAppMediaTargets(env, workspaceId, { contactId: id });
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM external_api_requests WHERE workspace_id=?2 AND message_id IN
      (SELECT message_id FROM messages WHERE contact_id=?1 AND workspace_id=?2)`).bind(id, workspaceId),
    env.DB.prepare(`DELETE FROM outbox WHERE workspace_id=?2 AND message_id IN
      (SELECT message_id FROM messages WHERE contact_id=?1 AND workspace_id=?2)`).bind(id, workspaceId),
    env.DB.prepare(`DELETE FROM outbound_payloads WHERE workspace_id=?2 AND message_id IN
      (SELECT message_id FROM messages WHERE contact_id=?1 AND workspace_id=?2)`).bind(id, workspaceId),
    env.DB.prepare(`DELETE FROM identity_migration_issues WHERE workspace_id=?2 AND conversation_id IN
      (SELECT conversation_id FROM conversations WHERE contact_id=?1 AND workspace_id=?2)`).bind(id, workspaceId),
    env.DB.prepare("DELETE FROM messages WHERE contact_id=?1 AND workspace_id=?2").bind(id, workspaceId),
    env.DB.prepare("DELETE FROM conversations WHERE contact_id=?1 AND workspace_id=?2").bind(id, workspaceId),
    env.DB.prepare("DELETE FROM channel_identities WHERE contact_id=?1 AND workspace_id=?2").bind(id, workspaceId),
    env.DB.prepare(`DELETE FROM channel_identity_bindings WHERE workspace_id=?2 AND identity_id IN
      (SELECT identity_id FROM contact_identities WHERE contact_id=?1 AND workspace_id=?2)`).bind(id, workspaceId),
    env.DB.prepare("DELETE FROM contact_identities WHERE contact_id=?1 AND workspace_id=?2").bind(id, workspaceId),
    env.DB.prepare("DELETE FROM contacts WHERE contact_id=?1 AND workspace_id=?2").bind(id, workspaceId)
  ]);
  const mediaCleanup = await deleteWhatsAppMediaTargets(env, mediaTargets);
  await audit(env, principal, "delete", "contact", id, {
    displayName: existing.display_name,
    company: existing.company || "",
    deletedIdentities: Number(existing.identity_count || 0),
    deletedConversations: Number(existing.conversation_count || 0),
    deletedMessages: Number(existing.message_count || 0),
    deletedMedia: mediaCleanup.deletedMedia,
    failedMedia: mediaCleanup.failedMedia
  });
  return {
    ok: true,
    contactId: id,
    deleted: true,
    conversationIds,
    deletedConversations: Number(existing.conversation_count || 0),
    deletedMessages: Number(existing.message_count || 0),
    deletedMedia: mediaCleanup.deletedMedia
  };
}
__name(deleteContact, "deleteContact");
async function listMessages(env, workspaceId, conversationId, url) {
  const limit = clampInt(url.searchParams.get("limit"), 1, 200, 100);
  const before = url.searchParams.get("before") || "";
  if (!await env.DB.prepare("SELECT 1 FROM conversations WHERE conversation_id=?1 AND workspace_id=?2").bind(conversationId, workspaceId).first()) throw httpError(404, "Conversation not found.");
  const result = await env.DB.prepare(`SELECT m.message_id,m.identity_id,m.direction,m.text,m.message_type,m.status,m.timestamp,
      m.channel_id,m.provider_message_id,m.error,m.payload_json,m.sender_login,m.sender_name,
      COALESCE(NULLIF(m.route_channel_name,''),ch.name) AS channel_name,
      COALESCE(NULLIF(m.route_connector_type,''),NULLIF(ch.provider_type,''),ch.connector_type) AS connector_type,
      '' AS provider_type,
      COALESCE(NULLIF(m.route_channel_profile_id,''),b.scoped_profile_id,ci.profile_id,'') AS channel_profile_id
    FROM messages m
    JOIN channels ch ON ch.workspace_id=m.workspace_id AND ch.channel_id=m.channel_id
    LEFT JOIN contact_identities ci ON ci.workspace_id=m.workspace_id AND ci.identity_id=m.identity_id
    LEFT JOIN channel_identity_bindings b ON b.workspace_id=m.workspace_id
      AND b.identity_id=m.identity_id AND b.channel_id=m.channel_id AND b.active=1
    WHERE m.workspace_id=?1 AND m.conversation_id=?2 AND (?3='' OR m.timestamp<?3)
    ORDER BY m.timestamp DESC,m.message_id DESC LIMIT ?4`).bind(workspaceId, conversationId, before, limit).all();
  return result.results.reverse().map((row) => {
    const payload = safeJsonParse(row.payload_json, {});
    const template = row.message_type === "template" ? templateMessageView(payload) : null;
    const senderName = messageSenderNameView(row, payload);
    const senderLogin = messageSenderLoginView(row, payload);
    const event = row.direction === "internal" && isPlainObject(payload) ? {
      type: String(payload.event || row.message_type || "event").slice(0, 40),
      assignedTo: String(payload.assignedTo || "").slice(0, 160),
      assignedToName: String(payload.assignedToName || "").slice(0, 120),
      assignedBy: String(payload.assignedBy || "").slice(0, 254),
      assignedByName: String(payload.assignedByName || "").slice(0, 120),
      actor: String(payload.actor || payload.assignedBy || "").slice(0, 254),
      actorName: String(payload.actorName || payload.assignedByName || payload.assignedToName || "").slice(0, 120)
    } : null;
    return {
      messageId: row.message_id,
      direction: row.direction,
      text: row.text,
      messageType: row.message_type,
      contactIdentityId: row.identity_id || "",
      identityId: row.identity_id || "",
      status: row.status,
      timestamp: row.timestamp,
      channelId: row.channel_id,
      connectorType: logicalConnectorType(row),
      channelName: row.channel_name || "",
      channelProfileId: row.channel_profile_id || "",
      channelMessageId: row.provider_message_id,
      error: row.error,
      ...senderName ? { senderName } : {},
      ...senderLogin ? { senderLogin } : {},
      attachment: messageAttachmentView(row.message_type, payload, row.message_id),
      ...template ? { template } : {},
      ...event ? { event } : {},
      ...(() => {
        const statusHistory = messageStatusHistoryView(payload);
        return statusHistory ? { statusHistory } : {};
      })(),
      reply: messageReplyView(payload)
    };
  });
}
__name(listMessages, "listMessages");
function messageSenderNameView(row, payload) {
  if (!["outbound", "internal"].includes(row?.direction)) return "";
  const fromColumn = String(row?.sender_name || "").trim();
  if (fromColumn) return fromColumn.slice(0, 120);
  if (row?.direction === "internal" && isPlainObject(payload)) {
    const assignedByName = String(payload.assignedByName || "").trim();
    if (assignedByName) return assignedByName.slice(0, 120);
  }
  const fromPayload = String(payload?.senderName || "").trim();
  return fromPayload ? fromPayload.slice(0, 120) : "";
}
__name(messageSenderNameView, "messageSenderNameView");
function messageSenderLoginView(row, payload) {
  if (!["outbound", "internal"].includes(row?.direction)) return "";
  const fromColumn = String(row?.sender_login || "").trim();
  if (fromColumn) return fromColumn.slice(0, 254);
  if (row?.direction === "internal" && isPlainObject(payload)) {
    const assignedBy = String(payload.assignedBy || "").trim();
    if (assignedBy) return assignedBy.slice(0, 254);
  }
  const name = messageSenderNameView(row, payload);
  if (name === "API") return "API";
  if (name === "Interakt") return "Interakt";
  return "";
}
__name(messageSenderLoginView, "messageSenderLoginView");
function messageStatusHistoryView(payload) {
  const history = isPlainObject(payload?.statusHistory) ? payload.statusHistory : null;
  if (!history) return null;
  const next = {};
  for (const key of ["sentAt", "deliveredAt", "readAt", "failedAt", "updatedAt"]) {
    const value = String(history[key] || "").trim();
    if (value) next[key] = value.slice(0, 64);
  }
  return Object.keys(next).length ? next : null;
}
__name(messageStatusHistoryView, "messageStatusHistoryView");
function messageReplyView(payload) {
  const reply = isPlainObject(payload?.reply) ? payload.reply : null;
  if (!reply) return null;
  const messageId = /^[A-Za-z0-9_-]{1,100}$/.test(String(reply.messageId || "")) ? String(reply.messageId) : "";
  const channelMessageId = String(reply.channelMessageId || "").trim().slice(0, 512);
  if (!messageId && !channelMessageId) return null;
  const messageType = String(reply.messageType || "text").slice(0, 40);
  const attachment = isPlainObject(reply.attachment) ? {
    type: String(reply.attachment.type || "").slice(0, 40),
    filename: safeAttachmentFilename(reply.attachment.filename || "")
  } : null;
  return {
    messageId,
    channelMessageId,
    direction: ["inbound", "outbound"].includes(reply.direction) ? reply.direction : "",
    text: String(reply.text || "").slice(0, 1e3),
    messageType,
    ...attachment?.type ? { attachment } : {}
  };
}
__name(messageReplyView, "messageReplyView");
function templateMessageView(payload) {
  const value = isPlainObject(payload?.template) ? payload.template : null;
  if (!value) return null;
  const name = providerText(value.name, 512);
  const languageCode = providerText(isPlainObject(value.language) ? value.language.code : value.language, 35);
  if (!/^[a-z0-9_]+$/.test(name) || !/^[A-Za-z]{2,3}(?:_[A-Za-z0-9]{2,8})?$/.test(languageCode)) return null;
  const templateId = providerIdentifier(value.templateId || value.id, 128);
  const category = providerEnum(value.category, 40);
  const buttons = (Array.isArray(value.buttons) ? value.buttons : []).slice(0, 10).flatMap((button) => {
    if (!isPlainObject(button)) return [];
    const type = String(button.type || "").toLowerCase();
    const text = providerText(button.text, 100);
    if (!(TEMPLATE_BUTTON_TYPES.has(type) && text)) return [];
    const item = { type, text };
    if (type === "url") {
      const url = providerText(button.url, 2048);
      if (url && /^https:\/\//i.test(url) && !/\{\{/.test(url)) item.url = url;
    }
    return [item];
  });
  return {
    name,
    language: { code: languageCode },
    ...templateId ? { templateId } : {},
    ...category ? { category } : {},
    ...buttons.length ? { buttons } : {}
  };
}
__name(templateMessageView, "templateMessageView");
async function updateConversation(env, workspaceId, id, payload, principal) {
  const existing = await env.DB.prepare("SELECT * FROM conversations WHERE conversation_id=?1 AND workspace_id=?2").bind(id, workspaceId).first();
  if (!existing) throw httpError(404, "Conversation not found.");
  const hasStatusPatch = payload.status !== void 0 && payload.status !== null;
  const status = payload.status ?? existing.status;
  if (!["open", "pending", "closed"].includes(status)) throw httpError(400, "Invalid conversation status.");
  const hasAssigneePatch = payload.assignedTo !== void 0;
  const previousAssignee = String(existing.assigned_to || "").trim();
  const previousStatus = String(existing.status || "");
  let assignedTo = payload.assignedTo === void 0 ? existing.assigned_to : String(payload.assignedTo).trim().slice(0, 160);
  let assigneeMember = null;
  if (payload.assignedTo !== void 0 && assignedTo) {
    assigneeMember = await env.DB.prepare(`SELECT u.email,u.display_name,u.user_id,m.membership_id
      FROM memberships m JOIN users u ON u.user_id=m.user_id
      WHERE m.workspace_id=?1 AND m.status='active' AND (lower(u.email)=lower(?2) OR u.user_id=?2)`).bind(workspaceId, assignedTo).first();
    if (!assigneeMember) throw httpError(400, "Assignee is not an active workspace member.");
    assignedTo = assigneeMember.email;
  }
  const markRead = Boolean(payload.markRead);
  const knownUnreadCount = Math.max(0, Number(existing.unread_count) || 0);
  const fallbackUnreadCount = markRead ? 0 : existing.unread_count;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(`UPDATE conversations SET
      status=CASE WHEN ?3=1 THEN ?4 ELSE status END,
      assigned_to=CASE WHEN ?5=1 THEN ?6 ELSE assigned_to END,
      unread_count=CASE WHEN ?7=1 THEN
        CASE WHEN unread_count>?8 THEN unread_count-?8 ELSE 0 END
        ELSE unread_count END,updated_at=?9
    WHERE conversation_id=?1 AND workspace_id=?2`).bind(
    id,
    workspaceId,
    hasStatusPatch ? 1 : 0,
    status,
    hasAssigneePatch ? 1 : 0,
    assignedTo,
    markRead ? 1 : 0,
    knownUnreadCount,
    now
  ).run();
  await audit(env, principal, "update", "conversation", id, { status, assignedTo, markRead });
  const item = await getConversationItem(env, workspaceId, id) || { conversationId: id, status, assignedTo, unreadCount: fallbackUnreadCount, updatedAt: now };
  const actor = outboundSenderAttribution(principal);
  let statusEvent = null;
  const statusChanged = hasStatusPatch && status !== previousStatus;
  if (statusChanged && status === "closed") {
    statusEvent = await insertLifecycleEventMessage(env, workspaceId, existing, {
      action: "closed",
      actorLogin: actor.login,
      actorName: actor.name,
      timestamp: now
    });
  } else if (statusChanged && status === "open" && previousStatus !== "open") {
    statusEvent = await insertLifecycleEventMessage(env, workspaceId, existing, {
      action: "opened",
      actorLogin: actor.login,
      actorName: actor.name,
      timestamp: now
    });
  }
  const assignmentChanged = hasAssigneePatch && String(assignedTo || "").trim().toLowerCase() !== previousAssignee.toLowerCase();
  let assignmentEvent = null;
  let assignmentNotify = null;
  if (assignmentChanged && String(assignedTo || "").trim()) {
    const assigneeName = String(assigneeMember?.display_name || assignedTo).trim().slice(0, 120) || assignedTo;
    assignmentEvent = await insertAssignmentEventMessage(env, workspaceId, existing, {
      assignedTo,
      assignedToName: assigneeName,
      assignedBy: actor.login,
      assignedByName: actor.name,
      timestamp: now
    });
    const actorEmail = String(principal?.user?.email || "").trim().toLowerCase();
    const actorUserId = String(principal?.user?.userId || "").trim();
    const isSelfAssign = actorEmail && actorEmail === String(assignedTo).toLowerCase() || actorUserId && actorUserId === String(assigneeMember?.user_id || "");
    if (!isSelfAssign && assigneeMember?.membership_id) {
      assignmentNotify = {
        membershipId: assigneeMember.membership_id,
        assigneeName,
        subject: item.subject || existing.subject || "",
        conversationId: id,
        timestamp: now
      };
    }
  }
  return { item, assignmentEvent, assignmentNotify, assignmentChanged, statusEvent, statusChanged };
}
__name(updateConversation, "updateConversation");
function earlierEventTimestamp(value) {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms)) return String(value || (/* @__PURE__ */ new Date()).toISOString());
  return new Date(ms - 1).toISOString();
}
__name(earlierEventTimestamp, "earlierEventTimestamp");
async function insertInternalEventMessage(env, workspaceId, conversation, details = {}) {
  const text = String(details.text || "").trim().slice(0, 1e3);
  if (!text) throw httpError(500, "Internal event text is required.");
  const now = String(details.timestamp || (/* @__PURE__ */ new Date()).toISOString());
  const messageId = crypto.randomUUID();
  const channelId = String(conversation.channel_id || conversation.channelId || "");
  const contactId = String(conversation.contact_id || conversation.contactId || "");
  const identityId = String(conversation.identity_id || conversation.identityId || "");
  if (!channelId || !contactId) throw httpError(500, "Conversation is missing channel details for the timeline event.");
  const actorLogin = String(details.actorLogin || "").slice(0, 254);
  const actorName = String(details.actorName || "").slice(0, 120);
  const eventType = String(details.event || "event").slice(0, 40);
  const payload = {
    event: eventType,
    type: eventType,
    actor: actorLogin,
    actorName,
    ...isPlainObject(details.payload) ? details.payload : {}
  };
  await env.DB.prepare(`INSERT INTO messages
      (message_id,conversation_id,contact_id,channel_id,identity_id,direction,message_type,text,status,timestamp,payload_json,workspace_id,sender_login,sender_name)
    VALUES (?1,?2,?3,?4,?5,'internal','event',?6,'recorded',?7,?8,?9,?10,?11)`).bind(
    messageId,
    conversation.conversation_id || conversation.conversationId,
    contactId,
    channelId,
    identityId,
    text,
    now,
    JSON.stringify(payload),
    workspaceId,
    actorLogin,
    actorName
  ).run();
  return {
    messageId,
    conversationId: conversation.conversation_id || conversation.conversationId,
    channelId,
    contactIdentityId: identityId,
    identityId,
    direction: "internal",
    messageType: "event",
    text,
    status: "recorded",
    timestamp: now,
    senderName: actorName,
    senderLogin: actorLogin,
    event: payload
  };
}
__name(insertInternalEventMessage, "insertInternalEventMessage");
async function insertLifecycleEventMessage(env, workspaceId, conversation, details = {}) {
  const action = details.action === "closed" ? "closed" : "opened";
  const actorName = String(details.actorName || details.actorLogin || "teammate").trim().slice(0, 120) || "teammate";
  const text = action === "closed" ? `Chat closed by ${actorName}.` : `Chat opened by ${actorName}.`;
  return insertInternalEventMessage(env, workspaceId, conversation, {
    event: action,
    text,
    actorLogin: details.actorLogin || "",
    actorName,
    timestamp: details.timestamp,
    payload: {
      actor: String(details.actorLogin || "").slice(0, 254),
      actorName
    }
  });
}
__name(insertLifecycleEventMessage, "insertLifecycleEventMessage");
async function insertAssignmentEventMessage(env, workspaceId, conversation, details = {}) {
  const assignedToName = String(details.assignedToName || details.assignedTo || " teammate").trim().slice(0, 120) || "teammate";
  const assignedBy = String(details.assignedBy || "").slice(0, 254);
  const assignedByName = String(details.assignedByName || "").slice(0, 120);
  return insertInternalEventMessage(env, workspaceId, conversation, {
    event: "assigned",
    text: `Chat assigned to ${assignedToName}.`,
    actorLogin: assignedBy,
    actorName: assignedByName,
    timestamp: details.timestamp,
    payload: {
      assignedTo: String(details.assignedTo || "").slice(0, 160),
      assignedToName,
      assignedBy,
      assignedByName
    }
  });
}
__name(insertAssignmentEventMessage, "insertAssignmentEventMessage");
async function claimUnassignedConversationOnReply(env, workspaceId, conversationId, principal) {
  const existing = await env.DB.prepare(`SELECT conversation_id,contact_id,channel_id,identity_id,assigned_to,subject
    FROM conversations WHERE conversation_id=?1 AND workspace_id=?2`).bind(conversationId, workspaceId).first();
  if (!existing || String(existing.assigned_to || "").trim()) return null;
  const actor = outboundSenderAttribution(principal);
  const email = String(principal?.user?.email || "").trim();
  if (!email || email === "emergency-recovery" || actor.login === "API") return null;
  const member = await env.DB.prepare(`SELECT u.email,u.display_name,m.membership_id FROM memberships m
    JOIN users u ON u.user_id=m.user_id
    WHERE m.workspace_id=?1 AND m.status='active' AND lower(u.email)=lower(?2) LIMIT 1`).bind(workspaceId, email).first();
  if (!member?.email) return null;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const claimed = await env.DB.prepare(`UPDATE conversations SET assigned_to=?3,updated_at=?4
    WHERE conversation_id=?1 AND workspace_id=?2 AND TRIM(COALESCE(assigned_to,''))=''`).bind(conversationId, workspaceId, member.email, now).run();
  if (!Number(claimed?.meta?.changes || 0)) return null;
  const eventMessage = await insertAssignmentEventMessage(env, workspaceId, existing, {
    assignedTo: member.email,
    assignedToName: String(member.display_name || member.email).trim().slice(0, 120) || member.email,
    assignedBy: actor.login,
    assignedByName: actor.name,
    timestamp: now
  });
  const conversation = await getConversationItem(env, workspaceId, conversationId);
  return {
    conversation: conversation || {
      conversationId,
      assignedTo: member.email,
      subject: existing.subject || "",
      updatedAt: now
    },
    eventMessage,
    // Self-claim never notifies the assignee.
    notify: null
  };
}
__name(claimUnassignedConversationOnReply, "claimUnassignedConversationOnReply");
async function listWhatsAppMediaTargets(env, workspaceId, { conversationId = "", contactId = "" } = {}) {
  const conversation = String(conversationId || "").trim();
  const contact = String(contactId || "").trim();
  if (!conversation && !contact) return [];
  const rows = conversation ? await env.DB.prepare(`SELECT m.payload_json,m.channel_id,c.connector_type,c.provider_type,c.config_json,
          c.secret_key,c.workspace_id
        FROM messages m
        JOIN channels c ON c.channel_id=m.channel_id AND c.workspace_id=m.workspace_id
        WHERE m.workspace_id=?1 AND m.conversation_id=?2`).bind(workspaceId, conversation).all() : await env.DB.prepare(`SELECT m.payload_json,m.channel_id,c.connector_type,c.provider_type,c.config_json,
          c.secret_key,c.workspace_id
        FROM messages m
        JOIN channels c ON c.channel_id=m.channel_id AND c.workspace_id=m.workspace_id
        WHERE m.workspace_id=?1 AND m.contact_id=?2`).bind(workspaceId, contact).all();
  const targets = [];
  const seen = /* @__PURE__ */ new Set();
  for (const row of rows.results || []) {
    if (logicalConnectorType(row) !== "whatsapp_cloud") continue;
    const mediaId = String(safeJsonParse(row.payload_json, {})?.attachment?.providerMediaId || "").trim();
    if (!mediaId || seen.has(`${row.channel_id}:${mediaId}`)) continue;
    seen.add(`${row.channel_id}:${mediaId}`);
    targets.push({
      mediaId,
      channel: {
        channelId: row.channel_id,
        connectorType: "whatsapp_cloud",
        config: safeJsonParse(row.config_json, {}),
        secretKey: row.secret_key,
        workspaceId: row.workspace_id
      }
    });
  }
  return targets;
}
__name(listWhatsAppMediaTargets, "listWhatsAppMediaTargets");
async function deleteWhatsAppMediaTargets(env, targets) {
  const items = Array.isArray(targets) ? targets : [];
  if (!items.length) return { deletedMedia: 0, failedMedia: 0 };
  const credentialsByChannel = /* @__PURE__ */ new Map();
  let deletedMedia = 0;
  let failedMedia = 0;
  for (const target of items) {
    const channelId = String(target?.channel?.channelId || "");
    const mediaId = String(target?.mediaId || "").trim();
    if (!channelId || !mediaId || !/^[A-Za-z0-9_-]{1,128}$/.test(mediaId)) {
      failedMedia += 1;
      continue;
    }
    try {
      let credentials = credentialsByChannel.get(channelId);
      if (!credentials) {
        credentials = await readChannelCredentials(env, target.channel);
        credentialsByChannel.set(channelId, credentials);
      }
      const token = String(credentials.accessToken || "");
      if (!token) {
        failedMedia += 1;
        continue;
      }
      const version = metaApiVersion(target.channel.config?.apiVersion);
      const response = await fetch(
        `https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(mediaId)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
      );
      if (response.ok || response.status === 404 || response.status === 410) deletedMedia += 1;
      else failedMedia += 1;
    } catch (error) {
      failedMedia += 1;
      console.error("whatsapp_media_delete_failed", {
        channelId,
        mediaId,
        error: cleanError(error)
      });
    }
  }
  return { deletedMedia, failedMedia };
}
__name(deleteWhatsAppMediaTargets, "deleteWhatsAppMediaTargets");
async function deleteConversation(env, workspaceId, conversationId, principal) {
  const id = cleanId(conversationId, "Conversation ID");
  const existing = await env.DB.prepare(`SELECT conversation_id,contact_id,channel_id,subject,status,
      (SELECT COUNT(*) FROM messages WHERE workspace_id=?2 AND conversation_id=?1) AS message_count
    FROM conversations WHERE conversation_id=?1 AND workspace_id=?2`).bind(id, workspaceId).first();
  if (!existing) throw httpError(404, "Conversation not found.");
  const mediaTargets = await listWhatsAppMediaTargets(env, workspaceId, { conversationId: id });
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM external_api_requests WHERE workspace_id=?2 AND message_id IN
      (SELECT message_id FROM messages WHERE conversation_id=?1 AND workspace_id=?2)`).bind(id, workspaceId),
    env.DB.prepare(`DELETE FROM outbox WHERE workspace_id=?2 AND message_id IN
      (SELECT message_id FROM messages WHERE conversation_id=?1 AND workspace_id=?2)`).bind(id, workspaceId),
    env.DB.prepare(`DELETE FROM outbound_payloads WHERE workspace_id=?2 AND message_id IN
      (SELECT message_id FROM messages WHERE conversation_id=?1 AND workspace_id=?2)`).bind(id, workspaceId),
    env.DB.prepare("DELETE FROM identity_migration_issues WHERE conversation_id=?1 AND workspace_id=?2").bind(id, workspaceId),
    env.DB.prepare("DELETE FROM messages WHERE conversation_id=?1 AND workspace_id=?2").bind(id, workspaceId),
    env.DB.prepare("DELETE FROM conversations WHERE conversation_id=?1 AND workspace_id=?2").bind(id, workspaceId)
  ]);
  const mediaCleanup = await deleteWhatsAppMediaTargets(env, mediaTargets);
  await audit(env, principal, "delete", "conversation", id, {
    contactId: existing.contact_id,
    channelId: existing.channel_id,
    subject: existing.subject,
    previousStatus: existing.status,
    deletedMessages: Number(existing.message_count || 0),
    deletedMedia: mediaCleanup.deletedMedia,
    failedMedia: mediaCleanup.failedMedia
  });
  return {
    ok: true,
    conversationId: id,
    contactId: existing.contact_id,
    deleted: true,
    deletedMessages: Number(existing.message_count || 0),
    deletedMedia: mediaCleanup.deletedMedia
  };
}
__name(deleteConversation, "deleteConversation");
async function createContact(env, workspaceId, payload, principal) {
  if (!isPlainObject(payload)) throw httpError(400, "Contact must be a JSON object.");
  rejectUnknownKeys(payload, /* @__PURE__ */ new Set(["displayName", "name", "company", "tags", "channelId", "channelProfileId", "platformIds", "identities"]), "contact");
  if (payload.displayName !== void 0 && payload.name !== void 0 && String(payload.displayName).trim() !== String(payload.name).trim()) {
    throw httpError(400, "Display name and name must match when both are supplied.");
  }
  const suppliedName = payload.displayName === void 0 ? payload.name : payload.displayName;
  if (typeof suppliedName !== "string") throw httpError(400, "Display name must be text.");
  const displayName = cleanRequired(suppliedName, "Display name", 120);
  const company = payload.company === void 0 ? "" : cleanOptionalText(payload.company, "Company", 160);
  const tags = payload.tags === void 0 ? [] : validateContactTags(payload.tags);
  if (payload.platformIds !== void 0 && (payload.identities !== void 0 || payload.channelId !== void 0 || payload.channelProfileId !== void 0)) {
    throw httpError(400, "Use platformIds or legacy identity/channel fields, not both.");
  }
  if (payload.identities !== void 0 && (!Array.isArray(payload.identities) || payload.identities.length > 50)) {
    throw httpError(400, "Identities must be an array with no more than 50 items.");
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const contactId = crypto.randomUUID();
  const legacyConversationRequested = payload.channelId !== void 0 || payload.channelProfileId !== void 0;
  const identityInputs = Array.isArray(payload.identities) ? [...payload.identities] : [];
  if (payload.channelId !== void 0 || payload.channelProfileId !== void 0) {
    const channelId = cleanId(payload.channelId, "Channel ID");
    const channel = await getChannel(env, channelId, "", workspaceId);
    if (!channel) throw httpError(400, "Unknown or disabled channel.");
    assertPrincipalChannelAccess(principal, channelId);
    await assertChannelReadyForConversation(env, workspaceId, channel);
    identityInputs.push({
      platform: platformForChannel(channel),
      connectorType: channel.connectorType,
      channelId,
      channelProfileId: cleanRequired(payload.channelProfileId, "Channel Profile ID", 512),
      displayName,
      isPrimary: !identityInputs.length
    });
  }
  const flatMutation = payload.platformIds === void 0 ? null : await prepareContactPlatformIdMutation(env, workspaceId, contactId, payload.platformIds, displayName, now);
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO contacts
          (contact_id,display_name,company,tags_json,created_at,updated_at,workspace_id)
        VALUES (?1,?2,?3,?4,?5,?5,?6)`).bind(contactId, displayName, company, JSON.stringify(tags), now, workspaceId),
      ...flatMutation?.statements || []
    ]);
  } catch (error) {
    if (isUniqueConstraintError(error)) throw httpError(409, "Contact ID already exists.");
    throw error;
  }
  const conversationIds = [];
  const identityIds = [...flatMutation?.identityIds || []];
  try {
    for (const identityInput of identityInputs) {
      const result = await ensureContactIdentity(env, workspaceId, contactId, identityInput, now);
      identityIds.push(result.identityId);
      for (const binding of legacyConversationRequested ? result.bindings.slice(0, 1) : []) {
        conversationIds.push(await ensureIdentityConversation(
          env,
          workspaceId,
          contactId,
          result.identityId,
          binding.channelId,
          principal?.user?.email || ""
        ));
      }
    }
  } catch (error) {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM conversations WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, contactId),
      env.DB.prepare(`DELETE FROM channel_identities WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, contactId),
      env.DB.prepare(`DELETE FROM channel_identity_bindings WHERE workspace_id=?1 AND identity_id IN
        (SELECT identity_id FROM contact_identities WHERE workspace_id=?1 AND contact_id=?2)`).bind(workspaceId, contactId),
      env.DB.prepare(`DELETE FROM contact_identities WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, contactId),
      env.DB.prepare(`DELETE FROM contacts WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, contactId)
    ]);
    throw error;
  }
  await audit(
    env,
    principal,
    "create",
    "contact",
    contactId,
    { identityIds, conversationIds, channelIndependent: identityIds.length === 0 }
  );
  return {
    ok: true,
    contactId,
    identityIds,
    conversationIds,
    conversationId: conversationIds[0] || "",
    item: await getContactDetail(env, workspaceId, contactId)
  };
}
__name(createContact, "createContact");
async function createOutboundMessage(env, workspaceId, conversationId, payload, principal) {
  if (!isPlainObject(payload)) throw httpError(400, "Message payload must be an object.");
  rejectUnknownKeys(payload, /* @__PURE__ */ new Set(["text", "replyToMessageId", "channelId", "identityId", "contactIdentityId"]), "message request");
  const sender = outboundSenderAttribution(principal);
  const senderName = sender.name;
  const text = cleanRequired(payload.text, "Message text", MAX_TEXT_LENGTH);
  await assertConversationChannelAccess(env, workspaceId, conversationId, principal);
  const row = await conversationDeliveryTarget(env, workspaceId, conversationId, payload);
  assertPrincipalChannelAccess(principal, row.channel_id);
  if (!row.enabled) throw httpError(409, "The selected channel is disabled.");
  const connectorType = row.connectorType;
  assertFreeformReplyAllowed(connectorType, row.last_inbound_at);
  const reply = await resolveReplyTarget(
    env,
    workspaceId,
    conversationId,
    row.channel_id,
    connectorType,
    payload.replyToMessageId
  );
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const messageId = crypto.randomUUID();
  const storedPayload = {
    senderName,
    ...reply ? { reply } : {}
  };
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO messages (message_id,conversation_id,contact_id,channel_id,identity_id,direction,message_type,text,status,timestamp,payload_json,workspace_id,sender_login,sender_name)
      VALUES (?1,?2,?3,?4,?5,'outbound','text',?6,'pending',?7,?8,?9,?10,?11)`).bind(
      messageId,
      conversationId,
      row.contact_id,
      row.channel_id,
      row.identity_id || "",
      text,
      now,
      JSON.stringify(storedPayload),
      workspaceId,
      sender.login,
      sender.name
    ),
    env.DB.prepare(`UPDATE conversations SET channel_id=?3,identity_id=?4,last_message_at=?5,updated_at=?5
      WHERE conversation_id=?1 AND workspace_id=?2`).bind(conversationId, workspaceId, row.channel_id, row.identity_id, now)
  ]);
  if (row.identity_id) await touchIdentityBinding(env, workspaceId, row.identity_id, row.channel_id, "outbound", conversationId, now);
  await audit(env, principal, "send_message", "conversation", conversationId, {
    channelId: row.channel_id,
    messageId,
    senderName,
    ...reply ? { replyToMessageId: reply.messageId } : {}
  });
  const assignment = await claimUnassignedConversationOnReply(env, workspaceId, conversationId, principal);
  return { message: {
    messageId,
    conversationId,
    channelId: row.channel_id,
    contactIdentityId: row.identity_id || "",
    identityId: row.identity_id || "",
    direction: "outbound",
    messageType: "text",
    text,
    status: "pending",
    timestamp: now,
    reply: reply || null,
    senderName,
    senderLogin: sender.login,
    connectorType,
    channelName: row.channel_name || "",
    channelProfileId: row.channel_profile_id || ""
  }, assignment };
}
__name(createOutboundMessage, "createOutboundMessage");
async function resolveReplyTarget(env, workspaceId, conversationId, channelId, connectorType, replyToMessageId) {
  if (replyToMessageId === void 0 || replyToMessageId === null || String(replyToMessageId).trim() === "") return null;
  if (!["whatsapp_cloud", "telegram"].includes(connectorType)) {
    throw httpError(409, "Replying to a specific message is available only for WhatsApp and Telegram conversations.");
  }
  const messageId = String(replyToMessageId).trim();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(messageId)) throw httpError(400, "Reply message ID is invalid.");
  const row = await env.DB.prepare(`SELECT message_id,provider_message_id,direction,text,message_type,payload_json
    FROM messages WHERE message_id=?1 AND workspace_id=?2 AND conversation_id=?3 AND channel_id=?4`).bind(messageId, workspaceId, conversationId, channelId).first();
  if (!row) throw httpError(404, "The message being replied to was not found in this conversation.");
  const channelMessageId = String(row.provider_message_id || "").trim();
  if (!channelMessageId) throw httpError(409, "This message cannot be replied to until the channel confirms it.");
  if (connectorType === "telegram" && !/^\d{1,20}$/.test(channelMessageId)) {
    throw httpError(409, "This older Telegram message does not have a reply-compatible channel message ID.");
  }
  return replyMetadataFromRow(row);
}
__name(resolveReplyTarget, "resolveReplyTarget");
function replyMetadataFromRow(row) {
  const payload = safeJsonParse(row.payload_json, {});
  const attachment = messageAttachmentView(row.message_type, payload, "");
  return {
    messageId: String(row.message_id || ""),
    channelMessageId: String(row.provider_message_id || ""),
    direction: ["inbound", "outbound"].includes(row.direction) ? row.direction : "",
    text: String(row.text || "").slice(0, 1e3),
    messageType: String(row.message_type || "text").slice(0, 40),
    ...attachment?.type ? { attachment: { type: attachment.type, filename: attachment.filename || "" } } : {}
  };
}
__name(replyMetadataFromRow, "replyMetadataFromRow");
function assertFreeformReplyAllowed(connectorType, lastInboundAt) {
  const state = whatsappReplyWindowState(connectorType, lastInboundAt);
  if (!state.freeformAllowed) {
    const error = httpError(409, state.replyWindowReason);
    error.code = "whatsapp_reply_window_closed";
    error.replyWindowExpiresAt = state.replyWindowExpiresAt;
    throw error;
  }
  return state;
}
__name(assertFreeformReplyAllowed, "assertFreeformReplyAllowed");
async function conversationDeliveryTarget(env, workspaceId, conversationId, selection = {}) {
  const conversation = await env.DB.prepare(`SELECT contact_id,channel_id,identity_id
    FROM conversations WHERE conversation_id=?1 AND workspace_id=?2`).bind(conversationId, workspaceId).first();
  if (!conversation) throw httpError(404, "Conversation not found.");
  if (!conversation.identity_id) {
    await reconcileLegacyConversationIdentity(env, workspaceId, conversationId);
  }
  let channelId = String(selection.channelId || "").trim();
  let identityId = String(selection.identityId || selection.contactIdentityId || "").trim();
  const replyToMessageId = String(selection.replyToMessageId || "").trim();
  if (replyToMessageId) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(replyToMessageId)) throw httpError(400, "Reply message ID is invalid.");
    const original = await env.DB.prepare(`SELECT channel_id,identity_id FROM messages
      WHERE workspace_id=?1 AND conversation_id=?2 AND message_id=?3`).bind(workspaceId, conversationId, replyToMessageId).first();
    if (!original) throw httpError(404, "The message being replied to was not found in this conversation.");
    channelId = String(original.channel_id || "");
    identityId = String(original.identity_id || "");
  }
  if (!channelId) {
    const latestInbound = await env.DB.prepare(`SELECT channel_id,identity_id FROM messages
      WHERE workspace_id=?1 AND conversation_id=?2 AND direction='inbound'
      ORDER BY timestamp DESC,message_id DESC LIMIT 1`).bind(workspaceId, conversationId).first();
    const latestMessage = latestInbound || await env.DB.prepare(`SELECT channel_id,identity_id FROM messages
      WHERE workspace_id=?1 AND conversation_id=?2
      ORDER BY timestamp DESC,message_id DESC LIMIT 1`).bind(workspaceId, conversationId).first();
    channelId = String(latestMessage?.channel_id || conversation.channel_id || "");
    identityId = String(latestMessage?.identity_id || conversation.identity_id || "");
  }
  const row = await env.DB.prepare(`SELECT c.contact_id,b.channel_id,b.identity_id,b.scoped_profile_id AS channel_profile_id,
      ch.name AS channel_name,ch.connector_type,ch.provider_type,ch.config_json,ch.secret_key,ch.enabled,
      (SELECT MAX(timestamp) FROM messages inbound WHERE inbound.workspace_id=c.workspace_id
        AND inbound.conversation_id=c.conversation_id AND inbound.direction='inbound'
        AND inbound.channel_id=b.channel_id AND inbound.identity_id=b.identity_id) AS last_inbound_at
    FROM conversations c
    JOIN contact_identities ci ON ci.workspace_id=c.workspace_id AND ci.contact_id=c.contact_id
    JOIN channel_identity_bindings b ON b.workspace_id=ci.workspace_id AND b.identity_id=ci.identity_id AND b.active=1
    JOIN channels ch ON ch.workspace_id=b.workspace_id AND ch.channel_id=b.channel_id
    WHERE c.workspace_id=?1 AND c.conversation_id=?2 AND b.channel_id=?3
      AND (?4='' OR b.identity_id=?4)
    ORDER BY CASE WHEN b.identity_id=?4 THEN 0 ELSE 1 END,b.last_inbound_at DESC,b.last_seen_at DESC
    LIMIT 1`).bind(workspaceId, conversationId, channelId, identityId).first();
  if (!row || !row.channel_profile_id) throw httpError(409, "The selected channel route is not available for this contact.");
  return {
    ...row,
    connectorType: logicalConnectorType(row),
    channel: {
      channelId: row.channel_id,
      workspaceId,
      connectorType: logicalConnectorType(row),
      config: safeJsonParse(row.config_json, {}),
      secretKey: row.secret_key
    }
  };
}
__name(conversationDeliveryTarget, "conversationDeliveryTarget");
async function listConversationTemplates(env, workspaceId, conversationId, { forceRefresh = false, channelId = "", identityId = "" } = {}) {
  const target = await conversationDeliveryTarget(env, workspaceId, conversationId, { channelId, identityId });
  if (target.connectorType !== "whatsapp_cloud") {
    throw httpError(409, "Templates are available only for WhatsApp conversations.");
  }
  if (!target.enabled) throw httpError(409, "The WhatsApp channel is disabled.");
  return listWhatsAppChannelTemplates(env, target.channel, { approvedOnly: true, forceRefresh });
}
__name(listConversationTemplates, "listConversationTemplates");
async function listWorkspaceWhatsAppTemplates(env, workspaceId, { forceRefresh = false } = {}) {
  const result = await env.DB.prepare(`SELECT channel_id,name,connector_type,provider_type,enabled,config_json,secret_key,workspace_id
    FROM channels WHERE workspace_id=?1 ORDER BY name COLLATE NOCASE,channel_id`).bind(workspaceId).all();
  const channels = (result.results || []).filter((row) => logicalConnectorType(row) === "whatsapp_cloud").map((row) => {
    const config = safeJsonParse(row.config_json, {});
    return {
      channelId: row.channel_id,
      channelName: row.name,
      channelEnabled: Boolean(row.enabled),
      providerDisplayName: providerText(config.verifiedName || config.verifiedPhoneNumber, 160),
      connectorType: "whatsapp_cloud",
      config,
      secretKey: row.secret_key,
      workspaceId: row.workspace_id
    };
  });
  const items = [];
  const errors = [];
  const truncatedChannels = [];
  const channelResults = await Promise.all(channels.map(async (channel) => {
    try {
      return { channel, templateResult: await listWhatsAppChannelTemplates(env, channel, {
        approvedOnly: false,
        includeMetadata: true,
        forceRefresh
      }) };
    } catch (error) {
      return { channel, error };
    }
  }));
  for (const result2 of channelResults) {
    const { channel } = result2;
    if (result2.error) {
      errors.push({
        channelId: channel.channelId,
        channelName: channel.channelName,
        channelEnabled: channel.channelEnabled,
        error: cleanError(result2.error)
      });
      continue;
    }
    if (result2.templateResult.truncated) {
      truncatedChannels.push({
        channelId: channel.channelId,
        channelName: channel.channelName,
        channelEnabled: channel.channelEnabled,
        limit: result2.templateResult.limit
      });
    }
    for (const template of result2.templateResult.items) {
      items.push({
        ...template,
        channelId: channel.channelId,
        channelName: channel.channelName,
        channelEnabled: channel.channelEnabled,
        providerDisplayName: channel.providerDisplayName
      });
    }
  }
  items.sort((left, right) => left.name.localeCompare(right.name) || left.language.code.localeCompare(right.language.code) || left.channelName.localeCompare(right.channelName));
  const uniqueOptions = /* @__PURE__ */ __name((values) => [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right)), "uniqueOptions");
  return {
    items,
    errors,
    truncatedChannels,
    filterOptions: {
      channels: channels.map((channel) => ({
        value: channel.channelId,
        label: channel.channelName,
        channelEnabled: channel.channelEnabled,
        providerDisplayName: channel.providerDisplayName
      })),
      categories: uniqueOptions(items.map((item) => item.category)),
      statuses: uniqueOptions(items.map((item) => item.status)),
      languages: uniqueOptions(items.map((item) => item.language.code))
    }
  };
}
__name(listWorkspaceWhatsAppTemplates, "listWorkspaceWhatsAppTemplates");
async function listWhatsAppChannelTemplates(env, channel, {
  approvedOnly = true,
  includeMetadata = false,
  forceRefresh = false
} = {}) {
  const templateLabel = approvedOnly ? "approved WhatsApp templates" : "WhatsApp templates";
  const wabaId = String(channel.config?.wabaId || "").trim();
  if (!/^\d{5,40}$/.test(wabaId)) throw httpError(409, "The WhatsApp Business Account ID is not configured.");
  const credentials = await readChannelCredentials(env, channel);
  if (!credentials.accessToken) throw httpError(409, "The WhatsApp access token is not configured.");
  const version = metaApiVersion(channel.config?.apiVersion);
  const cacheRequest = whatsAppTemplateCacheRequest(channel, wabaId, version, approvedOnly, includeMetadata);
  if (!forceRefresh) {
    const cached = await readWhatsAppTemplateCache(cacheRequest, includeMetadata);
    if (cached.hit) return cached.value;
  }
  const items = [];
  const seen = /* @__PURE__ */ new Set();
  const maximumPages = approvedOnly ? 3 : 10;
  const maximumItems = maximumPages * 100;
  let after = "";
  let moreAvailable = false;
  for (let page = 0; page < maximumPages && items.length < maximumItems; page++) {
    const endpoint = new URL(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(wabaId)}/message_templates`);
    endpoint.searchParams.set("fields", "id,name,language,status,category,components");
    if (approvedOnly) endpoint.searchParams.set("status", "APPROVED");
    endpoint.searchParams.set("limit", "100");
    if (after) endpoint.searchParams.set("after", after);
    let response;
    try {
      response = await fetch(endpoint, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
    } catch {
      throw httpError(502, `Meta could not load ${templateLabel}.`);
    }
    const data = safeJsonParse(await response.text(), {});
    if (!response.ok) {
      const detail = redactProviderSecret(providerError(data, response.status), credentials.accessToken);
      throw httpError(422, `Meta could not load ${templateLabel}: ${detail}`);
    }
    if (!Array.isArray(data.data)) {
      throw httpError(502, "Meta returned an invalid WhatsApp template response.");
    }
    let discardedCurrentPage = false;
    for (const value of data.data) {
      if (items.length >= maximumItems) {
        discardedCurrentPage = true;
        break;
      }
      const template = sanitizeWhatsAppTemplateDefinition(value);
      if (!template || approvedOnly && template.status !== "APPROVED") continue;
      const key = `${template.name}
${template.language.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(template);
    }
    const next = typeof data.paging?.cursors?.after === "string" ? data.paging.cursors.after.trim().slice(0, 1024) : "";
    const hasNext = typeof data.paging?.next === "string" && Boolean(data.paging.next.trim()) || data.data.length === 100;
    moreAvailable = discardedCurrentPage || hasNext && Boolean(next) && next !== after;
    if (!moreAvailable) break;
    after = next;
  }
  items.sort((left, right) => left.name.localeCompare(right.name) || left.language.code.localeCompare(right.language.code));
  const result = includeMetadata ? { items, truncated: moreAvailable, limit: maximumItems } : items;
  await writeWhatsAppTemplateCache(cacheRequest, result);
  return result;
}
__name(listWhatsAppChannelTemplates, "listWhatsAppChannelTemplates");
function whatsAppTemplateCacheRequest(channel, wabaId, version, approvedOnly, includeMetadata) {
  const workspaceId = String(channel?.workspaceId || "").slice(0, 100);
  const channelId = String(channel?.channelId || "").slice(0, 100);
  const url = new URL("/whatsapp/templates", WHATSAPP_TEMPLATE_CACHE_ORIGIN);
  url.searchParams.set("workspace", workspaceId);
  url.searchParams.set("channel", channelId);
  url.searchParams.set("waba", String(wabaId || "").slice(0, 40));
  url.searchParams.set("version", String(version || "").slice(0, 20));
  url.searchParams.set("approved", approvedOnly ? "1" : "0");
  url.searchParams.set("metadata", includeMetadata ? "1" : "0");
  return new Request(url.toString(), { method: "GET" });
}
__name(whatsAppTemplateCacheRequest, "whatsAppTemplateCacheRequest");
function defaultTemplateCache() {
  const cache = globalThis.caches?.default;
  return cache && typeof cache.match === "function" && typeof cache.put === "function" ? cache : null;
}
__name(defaultTemplateCache, "defaultTemplateCache");
async function readWhatsAppTemplateCache(request, includeMetadata) {
  const cache = defaultTemplateCache();
  if (!cache) return { hit: false, value: null };
  try {
    const response = await cache.match(request);
    if (!response?.ok) return { hit: false, value: null };
    const payload = safeJsonParse(await response.text(), null);
    const value = payload?.value;
    const valid = includeMetadata ? isPlainObject(value) && Array.isArray(value.items) && typeof value.truncated === "boolean" : Array.isArray(value);
    return valid ? { hit: true, value } : { hit: false, value: null };
  } catch {
    return { hit: false, value: null };
  }
}
__name(readWhatsAppTemplateCache, "readWhatsAppTemplateCache");
async function writeWhatsAppTemplateCache(request, value) {
  const cache = defaultTemplateCache();
  if (!cache) return;
  try {
    await cache.put(request, new Response(JSON.stringify({ value }), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${WHATSAPP_TEMPLATE_CACHE_SECONDS}`
      }
    }));
  } catch {
  }
}
__name(writeWhatsAppTemplateCache, "writeWhatsAppTemplateCache");
async function listWhatsAppTemplatesByName(env, channel, name) {
  const wabaId = String(channel.config?.wabaId || "").trim();
  if (!/^\d{5,40}$/.test(wabaId)) throw httpError(409, "The WhatsApp Business Account ID is not configured.");
  const credentials = await readChannelCredentials(env, channel);
  if (!credentials.accessToken) throw httpError(409, "The WhatsApp access token is not configured.");
  const endpoint = new URL(`https://graph.facebook.com/${encodeURIComponent(metaApiVersion(channel.config?.apiVersion))}/${encodeURIComponent(wabaId)}/message_templates`);
  endpoint.searchParams.set("fields", "id,name,language,status,category,components");
  endpoint.searchParams.set("name", name);
  endpoint.searchParams.set("limit", "100");
  let response;
  try {
    response = await fetch(endpoint, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
  } catch {
    throw httpError(502, "Meta could not load the WhatsApp template.");
  }
  const data = safeJsonParse(await response.text(), {});
  if (!response.ok) {
    const detail = redactProviderSecret(providerError(data, response.status), credentials.accessToken);
    throw httpError(422, `Meta could not load the WhatsApp template: ${detail}`);
  }
  if (!Array.isArray(data.data)) throw httpError(502, "Meta returned an invalid WhatsApp template response.");
  const items = [];
  const seen = /* @__PURE__ */ new Set();
  for (const value of data.data) {
    const template = sanitizeWhatsAppTemplateDefinition(value);
    if (!template || template.name !== name) continue;
    const key = `${template.name}
${template.language.code}
${template.status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(template);
  }
  items.sort((left, right) => left.language.code.localeCompare(right.language.code) || left.status.localeCompare(right.status));
  return items;
}
__name(listWhatsAppTemplatesByName, "listWhatsAppTemplatesByName");
async function findWhatsAppChannelTemplate(env, channel, name, languageCode) {
  const items = await listWhatsAppTemplatesByName(env, channel, name);
  return items.find((template) => template.status === "APPROVED" && template.language.code === languageCode) || null;
}
__name(findWhatsAppChannelTemplate, "findWhatsAppChannelTemplate");
function sanitizeWhatsAppTemplateDefinition(value) {
  if (!isPlainObject(value)) return null;
  const name = providerText(value.name, 512);
  if (!/^[a-z0-9_]+$/.test(name)) return null;
  const rawLanguage = isPlainObject(value.language) ? value.language.code : value.language;
  const languageCode = providerText(rawLanguage, 35);
  if (!/^[A-Za-z]{2,3}(?:_[A-Za-z0-9]{2,8})?$/.test(languageCode)) return null;
  const status = providerEnum(value.status, 40);
  if (!status) return null;
  const category = providerEnum(value.category, 40);
  const templateId = providerIdentifier(value.id, 128) || `${name}:${languageCode}`;
  const components = [];
  const variables = [];
  const rawComponents = Array.isArray(value.components) ? value.components.slice(0, 50) : [];
  for (let componentIndex = 0; componentIndex < rawComponents.length; componentIndex++) {
    const component = sanitizeWhatsAppTemplateComponent(rawComponents[componentIndex], componentIndex);
    if (!component) continue;
    components.push(component.definition);
    variables.push(...component.variables);
  }
  return {
    templateId,
    id: templateId,
    name,
    language: { code: languageCode },
    status,
    category,
    components,
    variables
  };
}
__name(sanitizeWhatsAppTemplateDefinition, "sanitizeWhatsAppTemplateDefinition");
function sanitizeWhatsAppTemplateComponent(value, componentIndex) {
  if (!isPlainObject(value)) return null;
  const type = providerEnum(value.type, 30).toLowerCase();
  if (!["header", "body", "footer", "buttons"].includes(type)) return null;
  const definition = { type };
  const variables = [];
  const format = providerEnum(value.format, 30).toLowerCase();
  if (type === "header" && ["text", "image", "video", "document", "location"].includes(format)) {
    definition.format = format;
  }
  const text = providerMultilineText(value.text, type === "body" ? 4096 : 1024);
  if (text) definition.text = text;
  const example = sanitizeWhatsAppTemplateExample(value.example);
  if (Object.keys(example).length) definition.example = example;
  if (type === "header" && definition.format && definition.format !== "text") {
    variables.push({
      component: "header",
      componentIndex,
      parameterIndex: 0,
      key: "media",
      kind: definition.format,
      example: ""
    });
  }
  const examples = type === "header" ? example.header_text || [] : Array.isArray(example.body_text?.[0]) ? example.body_text[0] : [];
  for (const [parameterIndex, key] of templatePlaceholders(text).entries()) {
    variables.push({
      component: type,
      componentIndex,
      parameterIndex,
      key,
      kind: "text",
      example: examples[parameterIndex] || ""
    });
  }
  if (type === "body" && Array.isArray(example.body_text_named_params)) {
    for (const named of example.body_text_named_params) {
      if (variables.some((variable) => variable.key === named.param_name)) continue;
      variables.push({
        component: "body",
        componentIndex,
        parameterIndex: variables.length,
        key: named.param_name,
        kind: "text",
        example: named.example
      });
    }
  }
  if (type === "buttons") {
    definition.buttons = [];
    const rawButtons = Array.isArray(value.buttons) ? value.buttons.slice(0, 10) : [];
    for (let buttonIndex = 0; buttonIndex < rawButtons.length; buttonIndex++) {
      const button = sanitizeWhatsAppTemplateButton(rawButtons[buttonIndex]);
      if (!button) continue;
      definition.buttons.push(button);
      if (button.type === "url") {
        for (const [buttonParameterIndex, key] of templatePlaceholders(button.url || "").entries()) {
          variables.push({
            component: "button",
            componentIndex,
            buttonIndex,
            parameterIndex: buttonParameterIndex,
            key,
            kind: "url",
            example: button.example?.[buttonParameterIndex] || ""
          });
        }
      }
    }
  }
  return { definition, variables };
}
__name(sanitizeWhatsAppTemplateComponent, "sanitizeWhatsAppTemplateComponent");
function sanitizeWhatsAppTemplateButton(value) {
  if (!isPlainObject(value)) return null;
  const type = providerEnum(value.type, 40).toLowerCase();
  if (!TEMPLATE_BUTTON_TYPES.has(type)) return null;
  const button = { type };
  const text = providerText(value.text, 100);
  if (text) button.text = text;
  const url = providerText(value.url, 2048);
  if (url && /^https:\/\//i.test(url)) button.url = url;
  const phoneNumber = providerText(value.phone_number, 40);
  if (phoneNumber) button.phoneNumber = phoneNumber;
  const example = Array.isArray(value.example) ? value.example.slice(0, 10).map((item) => providerText(item, 2048)).filter(Boolean) : [];
  if (example.length) button.example = example;
  return button;
}
__name(sanitizeWhatsAppTemplateButton, "sanitizeWhatsAppTemplateButton");
function sanitizeWhatsAppTemplateExample(value) {
  if (!isPlainObject(value)) return {};
  const result = {};
  if (Array.isArray(value.header_text)) {
    result.header_text = value.header_text.slice(0, 20).map((item) => providerText(item, 1024));
  }
  if (Array.isArray(value.body_text)) {
    result.body_text = value.body_text.slice(0, 10).map((row) => Array.isArray(row) ? row.slice(0, 50).map((item) => providerText(item, 1024)) : []);
  }
  if (Array.isArray(value.body_text_named_params)) {
    result.body_text_named_params = value.body_text_named_params.slice(0, 50).flatMap((item) => {
      if (!isPlainObject(item)) return [];
      const paramName = providerIdentifier(item.param_name, 100);
      if (!paramName) return [];
      return [{ param_name: paramName, example: providerText(item.example, 1024) }];
    });
  }
  return result;
}
__name(sanitizeWhatsAppTemplateExample, "sanitizeWhatsAppTemplateExample");
function templatePlaceholders(value) {
  const result = [];
  const seen = /* @__PURE__ */ new Set();
  for (const match of String(value || "").matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
    const key = match[1];
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}
__name(templatePlaceholders, "templatePlaceholders");
function providerText(value, maximum) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, maximum);
}
__name(providerText, "providerText");
function providerMultilineText(value, maximum) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").trim().slice(0, maximum);
}
__name(providerMultilineText, "providerMultilineText");
function providerIdentifier(value, maximum) {
  const text = providerText(value, maximum);
  return /^[A-Za-z0-9_.:-]+$/.test(text) ? text : "";
}
__name(providerIdentifier, "providerIdentifier");
function providerEnum(value, maximum) {
  const text = providerText(value, maximum).toUpperCase();
  return /^[A-Z][A-Z0-9_]*$/.test(text) ? text : "";
}
__name(providerEnum, "providerEnum");
function redactProviderSecret(message, secret) {
  const value = String(message || "");
  const needle = String(secret || "");
  return needle ? value.split(needle).join("[redacted]") : value;
}
__name(redactProviderSecret, "redactProviderSecret");
async function externalTemplateInboxPresentation(env, channel, template, explicitPreview, mediaPreview = null, maximumTextLength = MAX_TEXT_LENGTH) {
  const attachment = templateMediaAttachment(template, mediaPreview);
  let definition = null;
  if (channel.config?.wabaId) {
    try {
      definition = await findWhatsAppChannelTemplate(env, channel, template.name, template.language?.code);
    } catch {
    }
  }
  const rendered = definition ? renderWhatsAppTemplatePresentation(definition, template) : { text: "", buttons: [] };
  const languageCode = String(template.language?.code || "");
  const text = explicitPreview || rendered.text || `Template: ${template.name} (${languageCode})`;
  const templateView = {
    name: template.name,
    language: template.language,
    ...definition?.templateId ? { templateId: definition.templateId } : {},
    ...definition?.category ? { category: definition.category } : {},
    ...rendered.buttons.length ? { buttons: rendered.buttons } : {}
  };
  return {
    text: providerMultilineText(text, maximumTextLength),
    storedPayload: { template: templateView, ...attachment ? { attachment } : {} }
  };
}
__name(externalTemplateInboxPresentation, "externalTemplateInboxPresentation");
function renderWhatsAppTemplatePreview(definition, template) {
  return renderWhatsAppTemplatePresentation(definition, template).text;
}
__name(renderWhatsAppTemplatePreview, "renderWhatsAppTemplatePreview");
function renderWhatsAppTemplatePresentation(definition, template) {
  if (!isPlainObject(definition) || !isPlainObject(template)) return { text: "", buttons: [] };
  const requestComponents = Array.isArray(template.components) ? template.components : [];
  const componentParameters2 = /* @__PURE__ */ __name((type, buttonIndex = null) => {
    const match = requestComponents.find((component) => {
      if (!isPlainObject(component) || String(component.type || "").toLowerCase() !== type) return false;
      return type !== "button" || Number(component.index) === Number(buttonIndex);
    });
    return Array.isArray(match?.parameters) ? match.parameters : [];
  }, "componentParameters");
  const parts = [];
  const buttons = [];
  for (const component of Array.isArray(definition.components) ? definition.components : []) {
    if (!isPlainObject(component)) continue;
    const type = String(component.type || "").toLowerCase();
    if (type === "header") {
      const parameters = componentParameters2("header");
      if (String(component.format || "").toLowerCase() === "location") {
        const location = parameters.find((parameter) => String(parameter?.type || "").toLowerCase() === "location")?.location;
        const locationText = whatsappTemplateLocationPreview(location);
        if (locationText) parts.push(`Location: ${locationText}`);
      } else if (component.text) {
        parts.push(replaceWhatsAppTemplatePreviewVariables(component.text, parameters));
      }
    } else if (type === "body" && component.text) {
      parts.push(replaceWhatsAppTemplatePreviewVariables(component.text, componentParameters2("body")));
    } else if (type === "footer" && component.text) {
      parts.push(String(component.text));
    } else if (type === "buttons") {
      const componentButtons = Array.isArray(component.buttons) ? component.buttons : [];
      for (let buttonIndex = 0; buttonIndex < componentButtons.length; buttonIndex++) {
        const button = componentButtons[buttonIndex];
        const label = providerText(button?.text || button?.type, 100);
        const buttonType = String(button?.type || "").toLowerCase();
        if (!(label && TEMPLATE_BUTTON_TYPES.has(buttonType))) continue;
        const item = { type: buttonType, text: label };
        if (buttonType === "url") {
          const url = resolvedWhatsAppTemplateButtonUrl(button, componentParameters2("button", buttonIndex));
          if (url) item.url = url;
        }
        buttons.push(item);
      }
    }
  }
  if (buttons.length) parts.push(`Actions: ${buttons.map((button) => button.text).join(", ")}`);
  return {
    text: providerMultilineText(parts.filter(Boolean).join("\n"), MAX_TEXT_LENGTH),
    buttons
  };
}
__name(renderWhatsAppTemplatePresentation, "renderWhatsAppTemplatePresentation");
function replaceWhatsAppTemplatePreviewVariables(text, parameters) {
  const items = Array.isArray(parameters) ? parameters : [];
  const values = items.map(whatsappTemplateParameterPreview);
  const named = /* @__PURE__ */ new Map();
  for (let index = 0; index < items.length; index++) {
    const name = providerIdentifier(items[index]?.parameter_name, 100);
    if (name) named.set(name, values[index]);
  }
  let fallbackIndex = 0;
  return String(text || "").replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, rawKey) => {
    const key = String(rawKey || "").trim();
    let value = named.get(key);
    if (value === void 0 && /^\d+$/.test(key)) value = values[Number(key) - 1];
    if (value === void 0) value = values[fallbackIndex++];
    return value === void 0 || value === "" ? match : value;
  });
}
__name(replaceWhatsAppTemplatePreviewVariables, "replaceWhatsAppTemplatePreviewVariables");
function resolvedWhatsAppTemplateButtonUrl(button, parameters) {
  const rawUrl = providerText(button?.url, 2048);
  if (!rawUrl) return "";
  const resolved = replaceWhatsAppTemplatePreviewVariables(rawUrl, parameters);
  if (!/^https:\/\//i.test(resolved) || /\{\{/.test(resolved)) return "";
  return providerText(resolved, 2048);
}
__name(resolvedWhatsAppTemplateButtonUrl, "resolvedWhatsAppTemplateButtonUrl");
function whatsappTemplateParameterPreview(parameter) {
  if (!isPlainObject(parameter)) return "";
  const type = String(parameter.type || "").toLowerCase();
  if (type === "text") return providerMultilineText(parameter.text, 1024);
  if (type === "currency" && isPlainObject(parameter.currency)) {
    const fallback = providerText(parameter.currency.fallback_value, 256);
    if (fallback) return fallback;
    const code = providerText(parameter.currency.code, 12);
    const amount = Number(parameter.currency.amount_1000);
    return [code, Number.isFinite(amount) ? String(amount / 1e3) : ""].filter(Boolean).join(" ");
  }
  if (type === "date_time" && isPlainObject(parameter.date_time)) {
    return providerText(parameter.date_time.fallback_value, 256);
  }
  if (type === "coupon_code") return providerText(parameter.coupon_code, 256);
  if (type === "payload") return providerText(parameter.payload, 256);
  return "";
}
__name(whatsappTemplateParameterPreview, "whatsappTemplateParameterPreview");
function whatsappTemplateLocationPreview(location) {
  if (!isPlainObject(location)) return "";
  const name = providerText(location.name, 256);
  const address = providerText(location.address, 512);
  if (name || address) return [name, address].filter(Boolean).join(" \xB7 ");
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? `${latitude}, ${longitude}` : "";
}
__name(whatsappTemplateLocationPreview, "whatsappTemplateLocationPreview");
async function createConversationTemplateMessage(env, workspaceId, conversationId, payload, principal) {
  if (!isPlainObject(payload)) throw httpError(400, "Template payload must be an object.");
  rejectUnknownKeys(payload, /* @__PURE__ */ new Set([
    "name",
    "language",
    "components",
    "previewText",
    "mediaPreview",
    "channelId",
    "identityId",
    "contactIdentityId"
  ]), "template request");
  await assertConversationChannelAccess(env, workspaceId, conversationId, principal);
  const target = await conversationDeliveryTarget(env, workspaceId, conversationId, payload);
  assertPrincipalChannelAccess(principal, target.channel_id);
  if (target.connectorType !== "whatsapp_cloud") throw httpError(409, "Templates are available only for WhatsApp conversations.");
  if (!target.enabled) throw httpError(409, "The WhatsApp channel is disabled.");
  const template = validateWhatsAppTemplate({
    name: payload.name,
    language: payload.language,
    ...payload.components === void 0 ? {} : { components: payload.components }
  });
  const requestedPreview = payload.previewText === void 0 ? "" : cleanPreviewText(payload.previewText, MAX_TEMPLATE_PREVIEW_LENGTH);
  const mediaPreview = validateTemplateMediaPreview(payload.mediaPreview);
  const requestedAttachment = templateMediaAttachment(template, mediaPreview);
  if (mediaPreview && !requestedAttachment) throw httpError(400, "Media preview metadata requires a template media header.");
  const presentation = await externalTemplateInboxPresentation(
    env,
    target.channel,
    template,
    requestedPreview,
    mediaPreview,
    MAX_TEMPLATE_PREVIEW_LENGTH
  );
  const sender = outboundSenderAttribution(principal);
  const senderName = sender.name;
  const previewText = presentation.text;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const messageId = crypto.randomUUID();
  const storedPayload = { ...presentation.storedPayload, senderName };
  const encryptedPayload = await encryptOutboundPayload({ template }, env.CHANNEL_CREDENTIALS_KEY, workspaceId, messageId);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO messages (message_id,conversation_id,contact_id,channel_id,identity_id,direction,message_type,text,
        status,timestamp,payload_json,workspace_id,sender_login,sender_name)
      VALUES (?1,?2,?3,?4,?5,'outbound','template',?6,'pending',?7,?8,?9,?10,?11)`).bind(
      messageId,
      conversationId,
      target.contact_id,
      target.channel_id,
      target.identity_id,
      previewText,
      now,
      JSON.stringify(storedPayload),
      workspaceId,
      sender.login,
      sender.name
    ),
    env.DB.prepare(`INSERT INTO outbound_payloads (message_id,workspace_id,encrypted_payload,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?4)`).bind(messageId, workspaceId, encryptedPayload, now),
    env.DB.prepare(`INSERT INTO outbox (outbox_id,message_id,attempts,max_attempts,next_attempt_at,status,last_error,created_at,updated_at,workspace_id)
      VALUES (?1,?2,0,6,?3,'pending','',?4,?4,?5)`).bind(crypto.randomUUID(), messageId, now, now, workspaceId),
    env.DB.prepare(`UPDATE conversations SET channel_id=?3,identity_id=?4,last_message_at=?5,updated_at=?5
      WHERE conversation_id=?1 AND workspace_id=?2`).bind(conversationId, workspaceId, target.channel_id, target.identity_id, now)
  ]);
  await touchIdentityBinding(env, workspaceId, target.identity_id, target.channel_id, "outbound", conversationId, now);
  await audit(env, principal, "send_template", "conversation", conversationId, {
    channelId: target.channel_id,
    messageId,
    templateName: template.name,
    senderName
  });
  const assignment = await claimUnassignedConversationOnReply(env, workspaceId, conversationId, principal);
  return { message: {
    messageId,
    conversationId,
    channelId: target.channel_id,
    contactIdentityId: target.identity_id,
    identityId: target.identity_id,
    direction: "outbound",
    messageType: "template",
    text: previewText,
    status: "pending",
    timestamp: now,
    senderName,
    template: templateMessageView(storedPayload),
    attachment: messageAttachmentView("template", storedPayload, messageId),
    connectorType: target.connectorType,
    channelName: target.channel_name || "",
    channelProfileId: target.channel_profile_id || ""
  }, assignment };
}
__name(createConversationTemplateMessage, "createConversationTemplateMessage");
function validateTemplateMediaPreview(value) {
  if (value === void 0 || value === null) return null;
  if (!isPlainObject(value)) throw httpError(400, "Template media preview must be an object.");
  rejectUnknownKeys(value, /* @__PURE__ */ new Set(["filename", "mimeType", "size"]), "template media preview");
  const filename = value.filename === void 0 ? "" : cleanOptionalText(value.filename, "Template media filename", 240);
  const mimeType = value.mimeType === void 0 ? "" : cleanOptionalText(value.mimeType, "Template media MIME type", 160).toLowerCase();
  if (mimeType && !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(mimeType)) {
    throw httpError(400, "Template media MIME type is invalid.");
  }
  const size = value.size === void 0 ? 0 : Number(value.size);
  if (!Number.isFinite(size) || size < 0 || size > MAX_ATTACHMENT_BYTES) throw httpError(400, "Template media size is invalid.");
  return { filename, mimeType, size: Math.floor(size) };
}
__name(validateTemplateMediaPreview, "validateTemplateMediaPreview");
function templateMediaAttachment(template, preview) {
  for (const component of Array.isArray(template?.components) ? template.components : []) {
    if (String(component?.type || "").toLowerCase() !== "header") continue;
    for (const parameter of Array.isArray(component.parameters) ? component.parameters : []) {
      const type = String(parameter?.type || "").toLowerCase();
      if (!["image", "video", "document"].includes(type)) continue;
      const media = parameter?.[type];
      if (!isPlainObject(media)) continue;
      const providerMediaId = String(media.id || "").trim();
      let externalUrl = "";
      if (!providerMediaId && media.link) {
        validatePublicHttpsMediaUrl(media.link, `template ${type}`);
        externalUrl = new URL(String(media.link)).toString();
      }
      if (!providerMediaId && !externalUrl) continue;
      let filename = preview?.filename || "";
      if (!filename && externalUrl) {
        try {
          filename = decodeURIComponent(new URL(externalUrl).pathname.split("/").filter(Boolean).at(-1) || "");
        } catch {
        }
      }
      return {
        type,
        filename: safeAttachmentFilename(filename || `${type}-template-media`),
        mimeType: preview?.mimeType || "",
        size: Number(preview?.size || 0),
        caption: "",
        ...providerMediaId ? { providerMediaId } : { externalUrl }
      };
    }
  }
  return null;
}
__name(templateMediaAttachment, "templateMediaAttachment");
async function createConversationAttachmentMessage(env, workspaceId, conversationId, request, principal) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) throw httpError(415, "Content-Type must be multipart/form-data.");
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ATTACHMENT_BYTES + 1024 * 1024) {
    throw httpError(413, "Attachment request is too large.");
  }
  let form;
  try {
    form = await request.formData();
  } catch {
    throw httpError(400, "Multipart attachment data is invalid.");
  }
  await assertConversationChannelAccess(env, workspaceId, conversationId, principal);
  const target = await conversationDeliveryTarget(env, workspaceId, conversationId, {
    channelId: form.get("channelId"),
    identityId: form.get("identityId") || form.get("contactIdentityId"),
    replyToMessageId: form.get("replyToMessageId")
  });
  assertPrincipalChannelAccess(principal, target.channel_id);
  if (!["whatsapp_cloud", "telegram", "facebook_messenger", "instagram"].includes(target.connectorType)) {
    throw httpError(409, "Attachments are currently available for WhatsApp, Telegram, Messenger, and Instagram conversations.");
  }
  if (!target.enabled) throw httpError(409, "The channel is disabled.");
  assertFreeformReplyAllowed(target.connectorType, target.last_inbound_at);
  const file = form.get("file");
  if (!file || typeof file !== "object" || typeof file.arrayBuffer !== "function") throw httpError(400, "A file field is required.");
  const attachment = validateWhatsAppAttachment(file, form.get("caption"), target.connectorType);
  if (target.connectorType === "whatsapp_cloud" && attachment.type === "audio" && attachment.caption) {
    throw httpError(400, "WhatsApp audio messages do not support captions. Remove the text or send it as a separate message.");
  }
  const sender = outboundSenderAttribution(principal);
  const senderName = sender.name;
  const reply = await resolveReplyTarget(
    env,
    workspaceId,
    conversationId,
    target.channel_id,
    target.connectorType,
    form.get("replyToMessageId")
  );
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const messageId = crypto.randomUUID();
  const preview = attachment.caption || `[${attachment.type}: ${attachment.filename}]`;
  const attachmentPayload = /* @__PURE__ */ __name((safeAttachment2) => ({
    attachment: safeAttachment2,
    senderName,
    ...reply ? { reply } : {}
  }), "attachmentPayload");
  if (target.connectorType === "telegram" || target.connectorType === "facebook_messenger" || target.connectorType === "instagram") {
    let safeAttachment2 = { ...attachment };
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO messages (message_id,conversation_id,contact_id,channel_id,identity_id,direction,message_type,text,
          provider_message_id,status,timestamp,payload_json,workspace_id,sender_login,sender_name)
        VALUES (?1,?2,?3,?4,?5,'outbound',?6,?7,'','pending',?8,?9,?10,?11,?12)`).bind(
        messageId,
        conversationId,
        target.contact_id,
        target.channel_id,
        target.identity_id,
        attachment.type,
        preview,
        now,
        JSON.stringify(attachmentPayload(safeAttachment2)),
        workspaceId,
        sender.login,
        sender.name
      ),
      env.DB.prepare(`UPDATE conversations SET channel_id=?3,identity_id=?4,last_message_at=?5,updated_at=?5
        WHERE conversation_id=?1 AND workspace_id=?2`).bind(conversationId, workspaceId, target.channel_id, target.identity_id, now)
    ]);
    await touchIdentityBinding(env, workspaceId, target.identity_id, target.channel_id, "outbound", conversationId, now);
    let sent;
    try {
      if (target.connectorType === "telegram") {
        sent = await sendTelegramMedia(
          env,
          target.channel,
          target.channel_profile_id,
          file,
          attachment,
          reply?.channelMessageId || ""
        );
        safeAttachment2 = { ...attachment, providerFileId: sent.providerFileId };
      } else if (target.connectorType === "instagram" || target.connectorType === "facebook_messenger") {
        const previewBytes = await file.arrayBuffer();
        const uploadFile = new File([previewBytes], attachment.filename, {
          type: attachment.mimeType || file.type || "application/octet-stream"
        });
        sent = target.connectorType === "instagram" ? await sendInstagramMedia(env, target.channel, target.channel_profile_id, uploadFile, attachment) : await sendFacebookMessengerMedia(env, target.channel, target.channel_profile_id, uploadFile, attachment);
        const previewCached = await cacheOutboundAttachmentPreview(workspaceId, messageId, previewBytes, attachment);
        const previewBase64 = inlineAttachmentPreviewBase64(previewBytes, attachment);
        safeAttachment2 = {
          ...attachment,
          ...sent.providerAttachmentId ? { providerAttachmentId: sent.providerAttachmentId } : {},
          ...previewCached ? { previewCache: true } : {},
          ...previewBase64 ? { previewBase64 } : {}
        };
      } else {
        throw nonRetryableError("Unsupported attachment connector.");
      }
      await persistTelegramAttachmentSuccess(env, workspaceId, messageId, sent, safeAttachment2, reply, senderName);
    } catch (error) {
      const failure = cleanError(error);
      let failurePersisted = false;
      try {
        await env.DB.prepare(`UPDATE messages SET status='failed',error=?2 WHERE message_id=?1 AND workspace_id=?3`).bind(messageId, failure, workspaceId).run();
        failurePersisted = true;
      } catch (persistenceError) {
        console.error("attachment_failure_persist_failed", {
          messageId,
          workspaceId,
          connectorType: target.connectorType,
          error: cleanError(persistenceError)
        });
      }
      if (!failurePersisted) throw error;
      await auditAttachmentBestEffort(env, principal, conversationId, {
        channelId: target.channel_id,
        messageId,
        type: attachment.type,
        mimeType: attachment.mimeType,
        size: attachment.size,
        status: "failed",
        senderName
      });
      const failedAssignment = await claimUnassignedConversationOnReply(env, workspaceId, conversationId, principal);
      return { message: {
        messageId,
        conversationId,
        channelId: target.channel_id,
        direction: "outbound",
        messageType: attachment.type,
        text: preview,
        status: "failed",
        error: failure,
        timestamp: now,
        channelMessageId: "",
        senderName,
        attachment: messageAttachmentView(attachment.type, attachmentPayload(safeAttachment2), messageId),
        reply: reply || null,
        connectorType: target.connectorType,
        channelName: target.channel_name || "",
        channelProfileId: target.channel_profile_id || ""
      }, assignment: failedAssignment };
    }
    await auditAttachmentBestEffort(env, principal, conversationId, {
      channelId: target.channel_id,
      messageId,
      type: attachment.type,
      mimeType: attachment.mimeType,
      size: attachment.size,
      senderName
    });
    const sentAssignment = await claimUnassignedConversationOnReply(env, workspaceId, conversationId, principal);
    return { message: {
      messageId,
      conversationId,
      channelId: target.channel_id,
      direction: "outbound",
      messageType: attachment.type,
      text: preview,
      status: sent.status,
      timestamp: now,
      channelMessageId: sent.providerMessageId,
      senderName,
      attachment: messageAttachmentView(attachment.type, attachmentPayload(safeAttachment2), messageId),
      reply: reply || null,
      connectorType: target.connectorType,
      channelName: target.channel_name || "",
      channelProfileId: target.channel_profile_id || ""
    }, assignment: sentAssignment };
  }
  const providerMediaId = await uploadWhatsAppMedia(env, target.channel, file, attachment);
  const encryptedPayload = await encryptOutboundPayload(
    { media: { ...attachment, id: providerMediaId } },
    env.CHANNEL_CREDENTIALS_KEY,
    workspaceId,
    messageId
  );
  const safeAttachment = { ...attachment, providerMediaId };
  const statements = [
    env.DB.prepare(`INSERT INTO messages (message_id,conversation_id,contact_id,channel_id,identity_id,direction,message_type,text,
      provider_message_id,status,timestamp,payload_json,workspace_id,sender_login,sender_name)
    VALUES (?1,?2,?3,?4,?5,'outbound',?6,?7,'','pending',?8,?9,?10,?11,?12)`).bind(
      messageId,
      conversationId,
      target.contact_id,
      target.channel_id,
      target.identity_id,
      attachment.type,
      preview,
      now,
      JSON.stringify(attachmentPayload(safeAttachment)),
      workspaceId,
      sender.login,
      sender.name
    ),
    env.DB.prepare(`INSERT INTO outbound_payloads (message_id,workspace_id,encrypted_payload,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?4)`).bind(messageId, workspaceId, encryptedPayload, now),
    env.DB.prepare(`INSERT INTO outbox (outbox_id,message_id,attempts,max_attempts,next_attempt_at,status,last_error,created_at,updated_at,workspace_id)
      VALUES (?1,?2,0,6,?3,'pending','',?4,?4,?5)`).bind(crypto.randomUUID(), messageId, now, now, workspaceId),
    env.DB.prepare(`UPDATE conversations SET channel_id=?3,identity_id=?4,last_message_at=?5,updated_at=?5
      WHERE conversation_id=?1 AND workspace_id=?2`).bind(conversationId, workspaceId, target.channel_id, target.identity_id, now)
  ];
  await env.DB.batch(statements);
  await touchIdentityBinding(env, workspaceId, target.identity_id, target.channel_id, "outbound", conversationId, now);
  await auditAttachmentBestEffort(env, principal, conversationId, {
    channelId: target.channel_id,
    messageId,
    type: attachment.type,
    mimeType: attachment.mimeType,
    size: attachment.size,
    senderName
  });
  const assignment = await claimUnassignedConversationOnReply(env, workspaceId, conversationId, principal);
  return { message: {
    messageId,
    conversationId,
    channelId: target.channel_id,
    direction: "outbound",
    messageType: attachment.type,
    text: preview,
    status: "pending",
    timestamp: now,
    channelMessageId: "",
    senderName,
    attachment: messageAttachmentView(attachment.type, attachmentPayload(safeAttachment), messageId),
    reply: reply || null,
    connectorType: target.connectorType,
    channelName: target.channel_name || "",
    channelProfileId: target.channel_profile_id || ""
  }, assignment };
}
__name(createConversationAttachmentMessage, "createConversationAttachmentMessage");
async function persistTelegramAttachmentSuccess(env, workspaceId, messageId, sent, attachment, reply = null, senderName = "") {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await env.DB.prepare(`UPDATE messages SET provider_message_id=?2,status=?3,payload_json=?4,error=''
        WHERE message_id=?1 AND workspace_id=?5`).bind(
        messageId,
        sent.providerMessageId,
        sent.status,
        JSON.stringify({
          attachment,
          ...senderName ? { senderName } : {},
          ...reply ? { reply } : {}
        }),
        workspaceId
      ).run();
      return true;
    } catch (error) {
      lastError = error;
    }
  }
  console.error("telegram_attachment_success_persist_failed", {
    messageId,
    workspaceId,
    error: cleanError(lastError)
  });
  return false;
}
__name(persistTelegramAttachmentSuccess, "persistTelegramAttachmentSuccess");
async function auditAttachmentBestEffort(env, principal, conversationId, details) {
  try {
    await audit(env, principal, "send_attachment", "conversation", conversationId, details);
  } catch (error) {
    console.error("attachment_audit_failed", {
      conversationId,
      messageId: details?.messageId || "",
      error: cleanError(error)
    });
  }
}
__name(auditAttachmentBestEffort, "auditAttachmentBestEffort");
function validateWhatsAppAttachment(file, captionValue, connectorType = "whatsapp_cloud") {
  const mimeType = String(file.type || "").toLowerCase().split(";", 1)[0].trim();
  const types = /* @__PURE__ */ new Map([
    ["image/jpeg", "image"],
    ["image/png", "image"],
    ["image/webp", "image"],
    ["video/mp4", "video"],
    ["video/3gpp", "video"],
    ["audio/aac", "audio"],
    ["audio/amr", "audio"],
    ["audio/mpeg", "audio"],
    ["audio/mp4", "audio"],
    ["audio/ogg", "audio"],
    ["application/pdf", "document"],
    ["text/plain", "document"],
    ["text/csv", "document"],
    ["application/msword", "document"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "document"],
    ["application/vnd.ms-excel", "document"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "document"],
    ["application/vnd.ms-powerpoint", "document"],
    ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "document"]
  ]);
  const type = types.get(mimeType);
  if (!type) throw httpError(415, "This file type is not supported for chat attachments.");
  if (connectorType === "whatsapp_cloud" && mimeType === "image/webp") {
    throw httpError(415, "WhatsApp image attachments must be JPEG or PNG.");
  }
  const size = Number(file.size || 0);
  if (!Number.isFinite(size) || size <= 0) throw httpError(400, "The attachment is empty.");
  const maximum = connectorType === "whatsapp_cloud" && type === "image" ? WHATSAPP_IMAGE_MAX_BYTES : MAX_ATTACHMENT_BYTES;
  if (size > maximum) {
    const provider = connectorType === "telegram" ? "Telegram" : connectorType === "facebook_messenger" ? "Messenger" : connectorType === "instagram" ? "Instagram" : "WhatsApp";
    throw httpError(413, `${provider} ${type} attachments may not exceed ${Math.round(maximum / (1024 * 1024))} MB.`);
  }
  const rawName = String(file.name || `attachment.${mimeType.split("/")[1] || "bin"}`).replace(/[\u0000-\u001f\u007f\\/]+/g, " ").trim();
  const filename = (rawName || "attachment").slice(0, 240);
  const caption = captionValue === null || captionValue === void 0 || String(captionValue).trim() === "" ? "" : cleanOptionalText(String(captionValue), "Caption", MAX_ATTACHMENT_CAPTION_LENGTH);
  return { type, mimeType, size, filename, caption };
}
__name(validateWhatsAppAttachment, "validateWhatsAppAttachment");
async function uploadWhatsAppMedia(env, channel, file, attachment) {
  const credentials = await readChannelCredentials(env, channel);
  const token = credentials.accessToken;
  const phoneNumberId = channel.config?.phoneNumberId;
  if (!token || !phoneNumberId) throw httpError(409, "WhatsApp credentials are not configured.");
  const version = metaApiVersion(channel.config?.apiVersion);
  const body = new FormData();
  body.set("messaging_product", "whatsapp");
  body.set("type", attachment.mimeType);
  body.set("file", file, attachment.filename);
  const response = await fetch(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(phoneNumberId)}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body
  });
  const data = safeJsonParse(await response.text(), {});
  if (!response.ok || !data.id) {
    throw httpError(422, `WhatsApp could not accept this attachment: ${providerError(data, response.status)}`);
  }
  return String(data.id);
}
__name(uploadWhatsAppMedia, "uploadWhatsAppMedia");
async function uploadConversationTemplateMedia(env, workspaceId, conversationId, request) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) throw httpError(415, "Content-Type must be multipart/form-data.");
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ATTACHMENT_BYTES + 1024 * 1024) {
    throw httpError(413, "Template media request is too large.");
  }
  let form;
  try {
    form = await request.formData();
  } catch {
    throw httpError(400, "Multipart template media is invalid.");
  }
  const target = await conversationDeliveryTarget(env, workspaceId, conversationId, {
    channelId: form.get("channelId"),
    identityId: form.get("identityId") || form.get("contactIdentityId")
  });
  if (target.connectorType !== "whatsapp_cloud") throw httpError(409, "Template media is available only for WhatsApp conversations.");
  if (!target.enabled) throw httpError(409, "The WhatsApp channel is disabled.");
  const file = form.get("file");
  if (!file || typeof file !== "object" || typeof file.arrayBuffer !== "function") throw httpError(400, "A file field is required.");
  const expectedType = String(form.get("type") || "").toLowerCase();
  if (!["image", "video", "document"].includes(expectedType)) throw httpError(400, "Template media type must be image, video, or document.");
  const attachment = validateWhatsAppAttachment(file, "");
  if (attachment.type !== expectedType) throw httpError(415, `The selected file is not valid ${expectedType} media.`);
  const mediaId = await uploadWhatsAppMedia(env, target.channel, file, attachment);
  return {
    ok: true,
    mediaId,
    type: attachment.type,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.size
  };
}
__name(uploadConversationTemplateMedia, "uploadConversationTemplateMedia");
var INLINE_ATTACHMENT_PREVIEW_MAX_BYTES = 512 * 1024;
function attachmentPreviewCacheRequest(workspaceId, messageId) {
  return new Request(
    `https://attachment-preview.helixcer.internal/${encodeURIComponent(workspaceId)}/${encodeURIComponent(messageId)}`
  );
}
__name(attachmentPreviewCacheRequest, "attachmentPreviewCacheRequest");
function inlineAttachmentPreviewBase64(bytes, attachment) {
  try {
    if (String(attachment?.type || "") !== "image") return "";
    const body = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : null;
    if (!body || !body.byteLength || body.byteLength > INLINE_ATTACHMENT_PREVIEW_MAX_BYTES) return "";
    let binary = "";
    const chunk = 32768;
    for (let i = 0; i < body.length; i += chunk) {
      binary += String.fromCharCode(...body.subarray(i, i + chunk));
    }
    return btoa(binary);
  } catch (error) {
    console.error("attachment_inline_preview_failed", { error: cleanError(error) });
    return "";
  }
}
__name(inlineAttachmentPreviewBase64, "inlineAttachmentPreviewBase64");
function responseFromAttachmentPreviewBase64(attachment) {
  const encoded = String(attachment?.previewBase64 || "");
  if (!encoded || encoded.length > INLINE_ATTACHMENT_PREVIEW_MAX_BYTES * 2) return null;
  try {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": String(attachment?.mimeType || "application/octet-stream"),
        "Content-Length": String(bytes.byteLength)
      }
    });
  } catch {
    return null;
  }
}
__name(responseFromAttachmentPreviewBase64, "responseFromAttachmentPreviewBase64");
async function cacheOutboundAttachmentPreview(workspaceId, messageId, bytes, attachment) {
  try {
    const body = bytes instanceof ArrayBuffer ? bytes : await new Response(bytes).arrayBuffer();
    if (!body || !body.byteLength) return false;
    const response = new Response(body, {
      headers: {
        "Content-Type": String(attachment?.mimeType || "application/octet-stream"),
        "Content-Length": String(body.byteLength),
        "Cache-Control": "private, max-age=2592000",
        "X-Attachment-Filename": safeAttachmentFilename(attachment?.filename || "attachment")
      }
    });
    await caches.default.put(attachmentPreviewCacheRequest(workspaceId, messageId), response);
    return true;
  } catch (error) {
    console.error("attachment_preview_cache_failed", {
      messageId,
      workspaceId,
      error: cleanError(error)
    });
    return false;
  }
}
__name(cacheOutboundAttachmentPreview, "cacheOutboundAttachmentPreview");
async function streamMessageAttachment(env, workspaceId, messageId, request, url, principal = null) {
  const row = await env.DB.prepare(`SELECT m.message_id,m.message_type,m.payload_json,m.channel_id,c.connector_type,c.provider_type,
      c.config_json,c.secret_key,c.workspace_id
    FROM messages m JOIN channels c ON c.channel_id=m.channel_id AND c.workspace_id=m.workspace_id
    WHERE m.message_id=?1 AND m.workspace_id=?2`).bind(messageId, workspaceId).first();
  if (!row) throw httpError(404, "Attachment not found.");
  if (principal) assertPrincipalChannelAccess(principal, row.channel_id);
  const attachment = safeJsonParse(row.payload_json, {})?.attachment;
  const attachmentType = String(row.message_type || "") === "template" ? String(attachment?.type || "") : String(row.message_type || "");
  if (!attachment || !["image", "video", "audio", "document"].includes(attachmentType)) {
    throw httpError(404, "Attachment not found.");
  }
  const channel = {
    channelId: row.channel_id,
    connectorType: logicalConnectorType(row),
    config: safeJsonParse(row.config_json, {}),
    secretKey: row.secret_key,
    workspaceId: row.workspace_id
  };
  let providerResponse;
  const range = request.headers.get("Range") || "";
  if (channel.connectorType === "whatsapp_cloud") {
    const mediaId = String(attachment.providerMediaId || "");
    if (!mediaId) throw httpError(410, "This WhatsApp attachment is no longer available.");
    const credentials = await readChannelCredentials(env, channel);
    if (!credentials.accessToken) throw httpError(409, "WhatsApp credentials are not configured.");
    const version = metaApiVersion(channel.config?.apiVersion);
    const infoResponse = await fetch(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${credentials.accessToken}` }
    });
    const info = safeJsonParse(await infoResponse.text(), {});
    if (!infoResponse.ok || !info.url) throw httpError(502, `WhatsApp media is unavailable: ${providerError(info, infoResponse.status)}`);
    const mediaUrl = new URL(String(info.url));
    if (mediaUrl.protocol !== "https:" || !isMetaMediaHost(mediaUrl.hostname)) throw httpError(502, "WhatsApp returned an invalid media location.");
    providerResponse = await fetch(mediaUrl, { headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      ...range ? { Range: range } : {}
    } });
  } else if (channel.connectorType === "telegram") {
    const fileId = String(attachment.providerFileId || "");
    if (!fileId) throw httpError(410, "This Telegram attachment is no longer available.");
    const credentials = await readChannelCredentials(env, channel);
    if (!credentials.botToken) throw httpError(409, "Telegram credentials are not configured.");
    const infoResponse = await fetch(`https://api.telegram.org/bot${credentials.botToken}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const info = safeJsonParse(await infoResponse.text(), {});
    if (!infoResponse.ok || info.ok === false || !info.result?.file_path) {
      throw httpError(502, `Telegram media is unavailable: ${providerError(info, infoResponse.status)}`);
    }
    const filePath = String(info.result.file_path);
    if (!/^[A-Za-z0-9_./-]{1,500}$/.test(filePath) || filePath.includes("..")) throw httpError(502, "Telegram returned an invalid media location.");
    providerResponse = await fetch(`https://api.telegram.org/file/bot${credentials.botToken}/${filePath}`, {
      headers: range ? { Range: range } : {}
    });
  } else if (channel.connectorType === "facebook_messenger" || channel.connectorType === "instagram") {
    if (attachment.previewCache) {
      const cached = await caches.default.match(attachmentPreviewCacheRequest(workspaceId, messageId));
      if (cached?.body) providerResponse = cached;
    }
    if (!providerResponse) {
      const inline2 = responseFromAttachmentPreviewBase64(attachment);
      if (inline2?.body) providerResponse = inline2;
    }
    if (!providerResponse) {
      const externalUrl = safeStoredExternalMediaUrl(attachment.externalUrl);
      if (!externalUrl) throw httpError(410, "This attachment preview is no longer available.");
      providerResponse = await fetch(externalUrl, {
        headers: {
          ...range ? { Range: range } : {},
          Accept: "*/*"
        },
        redirect: "follow",
        referrerPolicy: "no-referrer"
      });
    }
  } else {
    throw httpError(409, "This provider does not expose protected attachment previews.");
  }
  if (!providerResponse.ok || !providerResponse.body) throw httpError(502, "The provider could not return this attachment.");
  const filename = safeAttachmentFilename(attachment.filename || `${attachmentType}-attachment`);
  const requestedDownload = url.searchParams.get("download") === "1";
  const mimeType = safeInlineAttachmentMime(attachmentType, attachment.mimeType, providerResponse.headers.get("Content-Type"));
  const inline = !requestedDownload && attachmentType !== "document" && Boolean(mimeType);
  const headers = new Headers({
    "Content-Type": mimeType || "application/octet-stream",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
    "Cache-Control": "private, max-age=300",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff"
  });
  const length = providerResponse.headers.get("Content-Length");
  if (length) headers.set("Content-Length", length);
  for (const name of ["Accept-Ranges", "Content-Range"]) {
    const value = providerResponse.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(providerResponse.body, { status: providerResponse.status, headers });
}
__name(streamMessageAttachment, "streamMessageAttachment");
function isMetaMediaHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "lookaside.fbsbx.com" || host.endsWith(".fbcdn.net") || host === "facebook.com" || host.endsWith(".facebook.com");
}
__name(isMetaMediaHost, "isMetaMediaHost");
function safeInlineAttachmentMime(messageType, storedMime, providerMime) {
  const candidate = String(storedMime || providerMime || "").toLowerCase().split(";", 1)[0].trim();
  const allowed = {
    image: /* @__PURE__ */ new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]),
    video: /* @__PURE__ */ new Set(["video/mp4", "video/3gpp", "video/webm"]),
    audio: /* @__PURE__ */ new Set(["audio/aac", "audio/amr", "audio/mpeg", "audio/mp4", "audio/ogg"])
  };
  return allowed[String(messageType || "")]?.has(candidate) ? candidate : "";
}
__name(safeInlineAttachmentMime, "safeInlineAttachmentMime");
function safeAttachmentFilename(value) {
  return String(value || "attachment").replace(/[^\x20-\x7e]+/g, "_").replace(/["\\/]+/g, "_").trim().slice(0, 180) || "attachment";
}
__name(safeAttachmentFilename, "safeAttachmentFilename");
function messageAttachmentView(messageType, payload, messageId = "") {
  const value = payload?.attachment;
  if (!value || typeof value !== "object") return null;
  const isTemplate = String(messageType || "") === "template";
  const type = isTemplate ? String(value.type || "") : String(messageType || "");
  if (!["image", "video", "audio", "document"].includes(type)) return null;
  const externalUrl = safeStoredExternalMediaUrl(value.externalUrl);
  const previewCache = value.previewCache === true;
  const hasInlinePreview = Boolean(String(value.previewBase64 || "").trim());
  const available = Boolean(
    value.providerMediaId || value.providerFileId || externalUrl || previewCache || hasInlinePreview
  );
  const useProxy = Boolean(messageId) && available && !isTemplate && (value.providerMediaId || value.providerFileId || previewCache || hasInlinePreview || Boolean(externalUrl));
  return {
    type,
    filename: String(value.filename || ""),
    mimeType: String(value.mimeType || ""),
    size: Number(value.size || 0),
    caption: String(value.caption || ""),
    available,
    external: Boolean(externalUrl) && !useProxy,
    url: useProxy ? `/api/messages/${encodeURIComponent(messageId)}/attachment` : externalUrl || (available && messageId ? `/api/messages/${encodeURIComponent(messageId)}/attachment` : "")
  };
}
__name(messageAttachmentView, "messageAttachmentView");
function safeStoredExternalMediaUrl(value) {
  if (!value) return "";
  try {
    validatePublicHttpsMediaUrl(value, "stored template media");
    return new URL(String(value)).toString();
  } catch {
    return "";
  }
}
__name(safeStoredExternalMediaUrl, "safeStoredExternalMediaUrl");
async function sendOrQueue(env, messageId) {
  const queued = await env.DB.prepare("SELECT outbox_id,status FROM outbox WHERE message_id=?1").bind(messageId).first();
  if (queued) {
    const claimed = await env.DB.prepare("UPDATE outbox SET status='processing',updated_at=?2 WHERE message_id=?1 AND status='pending'").bind(messageId, (/* @__PURE__ */ new Date()).toISOString()).run();
    if (!claimed.meta?.changes) return;
  }
  const beforeSend = await env.DB.prepare("SELECT workspace_id,status FROM messages WHERE message_id=?1").bind(messageId).first();
  if (beforeSend && isTerminalProviderStatus(beforeSend.status)) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM outbox WHERE message_id=?1").bind(messageId),
      env.DB.prepare("DELETE FROM outbound_payloads WHERE message_id=?1").bind(messageId)
    ]);
    return;
  }
  try {
    await markMessageSent(env, messageId, await dispatchOutbound(env, messageId));
  } catch (error) {
    const message = await env.DB.prepare(`SELECT workspace_id,conversation_id,status,provider_message_id
      FROM messages WHERE message_id=?1`).bind(messageId).first();
    if (!message) throw error;
    if (isTerminalProviderStatus(message.status)) {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM outbox WHERE message_id=?1").bind(messageId),
        env.DB.prepare("DELETE FROM outbound_payloads WHERE message_id=?1").bind(messageId)
      ]);
      return;
    }
    if (error?.retryable === false) {
      await env.DB.batch([
        env.DB.prepare("UPDATE messages SET status='failed',error=?2 WHERE message_id=?1").bind(messageId, cleanError(error)),
        env.DB.prepare("DELETE FROM outbox WHERE message_id=?1").bind(messageId),
        env.DB.prepare("DELETE FROM outbound_payloads WHERE message_id=?1").bind(messageId)
      ]);
      await broadcastMessageStatusChanges(env, message.workspace_id, [{
        messageId,
        conversationId: message.conversation_id,
        status: "failed",
        error: cleanError(error),
        channelMessageId: String(message.provider_message_id || "")
      }]);
      return;
    }
    const now = /* @__PURE__ */ new Date();
    const next = new Date(now.getTime() + 3e4).toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE messages SET status='retrying',error=?2 WHERE message_id=?1").bind(messageId, cleanError(error)),
      env.DB.prepare(`INSERT INTO outbox (outbox_id,message_id,attempts,next_attempt_at,last_error,created_at,updated_at,workspace_id)
        VALUES (?1,?2,0,?3,?4,?5,?5,?6)
        ON CONFLICT(message_id) DO UPDATE SET status='pending',next_attempt_at=excluded.next_attempt_at,
          last_error=excluded.last_error,updated_at=excluded.updated_at`).bind(crypto.randomUUID(), messageId, next, cleanError(error), now.toISOString(), message.workspace_id)
    ]);
    await broadcastMessageStatusChanges(env, message.workspace_id, [{
      messageId,
      conversationId: message.conversation_id,
      status: "retrying",
      error: cleanError(error),
      channelMessageId: String(message.provider_message_id || "")
    }]);
  }
}
__name(sendOrQueue, "sendOrQueue");
async function dispatchOutbound(env, messageId) {
  const row = await env.DB.prepare(`SELECT m.*,c.config_json,c.connector_type,c.provider_type,c.secret_key,c.enabled,
      COALESCE(b.scoped_profile_id,'') AS channel_profile_id,
      COALESCE(NULLIF(m.identity_id,''),NULLIF(cv.identity_id,''),'') AS delivery_identity_id,cv.contact_id
      FROM messages m JOIN channels c ON c.channel_id=m.channel_id
      AND c.workspace_id=m.workspace_id JOIN conversations cv ON cv.conversation_id=m.conversation_id AND cv.workspace_id=m.workspace_id
      LEFT JOIN channel_identity_bindings b ON b.workspace_id=m.workspace_id
        AND b.identity_id=COALESCE(NULLIF(m.identity_id,''),NULLIF(cv.identity_id,''),'')
        AND b.channel_id=m.channel_id AND b.active=1
      WHERE m.message_id=?1`).bind(messageId).first();
  if (!row) throw new Error("Outbound message not found.");
  if (!row.delivery_identity_id) throw nonRetryableError("Outbound identity is unresolved.");
  if (!row.channel_profile_id) throw nonRetryableError("Outbound channel route is unavailable.");
  if (!row.enabled) throw new Error("Channel is disabled.");
  const channel = {
    channelId: row.channel_id,
    workspaceId: row.workspace_id,
    connectorType: logicalConnectorType(row),
    config: safeJsonParse(row.config_json, {}),
    secretKey: row.secret_key
  };
  assertManagedOutboundVerified(channel);
  const messagePayload = safeJsonParse(row.payload_json, {});
  const replyChannelMessageId = String(messagePayload?.reply?.channelMessageId || "");
  let result;
  if (channel.connectorType === "whatsapp_cloud" && row.message_type === "template") {
    const stored = await env.DB.prepare(`SELECT encrypted_payload FROM outbound_payloads
      WHERE message_id=?1 AND workspace_id=?2`).bind(messageId, row.workspace_id).first();
    if (!stored?.encrypted_payload) throw nonRetryableError("The encrypted template payload is unavailable.");
    let outbound;
    try {
      outbound = await decryptOutboundPayload(stored.encrypted_payload, env.CHANNEL_CREDENTIALS_KEY, row.workspace_id, messageId);
    } catch {
      throw nonRetryableError("The encrypted template payload could not be decrypted.");
    }
    result = await sendWhatsAppTemplate(env, channel, row.channel_profile_id, outbound.template, messageId);
  } else if (channel.connectorType === "whatsapp_cloud" && ["image", "video", "audio", "document"].includes(row.message_type)) {
    const stored = await env.DB.prepare(`SELECT encrypted_payload FROM outbound_payloads
      WHERE message_id=?1 AND workspace_id=?2`).bind(messageId, row.workspace_id).first();
    if (!stored?.encrypted_payload) throw nonRetryableError("The encrypted attachment payload is unavailable.");
    let outbound;
    try {
      outbound = await decryptOutboundPayload(stored.encrypted_payload, env.CHANNEL_CREDENTIALS_KEY, row.workspace_id, messageId);
    } catch {
      throw nonRetryableError("The encrypted attachment payload could not be decrypted.");
    }
    result = await sendWhatsAppMedia(env, channel, row.channel_profile_id, outbound.media, messageId, replyChannelMessageId);
  } else if (channel.connectorType === "whatsapp_cloud") {
    result = await sendWhatsApp(env, channel, row.channel_profile_id, row.text, replyChannelMessageId, messageId);
  } else if (channel.connectorType === "telegram") {
    result = await sendTelegram(env, channel, row.channel_profile_id, row.text, replyChannelMessageId);
  } else if (channel.connectorType === "instagram") result = await sendInstagram(env, channel, row.channel_profile_id, row.text);
  else if (channel.connectorType === "facebook_messenger") {
    result = await sendFacebookMessenger(env, channel, row.channel_profile_id, row.text);
  } else if (channel.connectorType === "generic_http") result = await sendGeneric(env, channel, row);
  else if (channel.connectorType === "web_chat") result = { status: "sent", providerMessageId: row.message_id, httpStatus: 200 };
  else throw new Error(`Outbound connector ${channel.connectorType} is not implemented yet.`);
  return { ...result, workspaceId: row.workspace_id };
}
__name(dispatchOutbound, "dispatchOutbound");
function assertManagedOutboundVerified(channel) {
  if (!MANAGED_CONNECTORS.has(channel.connectorType)) return;
  const config = channel.config || {};
  const verifiedAt = String(config.credentialsVerifiedAt || "").trim();
  const verifiedProviderId = String(config.verifiedProviderId || "").trim();
  if (!verifiedAt || !verifiedProviderId) {
    throw nonRetryableError("Channel credentials must be verified before sending messages.");
  }
  const configuredProviderId = channel.connectorType === "whatsapp_cloud" ? String(config.phoneNumberId || "").trim() : channel.connectorType === "instagram" ? String(config.instagramAccountId || "").trim() : channel.connectorType === "facebook_messenger" ? String(config.pageId || "").trim() : "";
  if (configuredProviderId && configuredProviderId !== verifiedProviderId) {
    throw nonRetryableError("The verified provider identity does not match the channel configuration.");
  }
}
__name(assertManagedOutboundVerified, "assertManagedOutboundVerified");
async function sendWhatsApp(env, channel, recipient, text, replyChannelMessageId = "", messageId = "") {
  const credentials = await readChannelCredentials(env, channel);
  const token = credentials.accessToken;
  const phoneNumberId = channel.config?.phoneNumberId;
  if (!token || !phoneNumberId) throw nonRetryableError("WhatsApp credentials are not configured.");
  const normalizedRecipient = normalizeWhatsAppRecipient(recipient);
  const version = metaApiVersion(channel.config?.apiVersion);
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizedRecipient,
    type: "text",
    text: { preview_url: false, body: text },
    ...replyChannelMessageId ? { context: { message_id: String(replyChannelMessageId) } } : {},
    ...messageId ? { biz_opaque_callback_data: String(messageId).slice(0, 512) } : {}
  };
  const response = await fetch(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const raw = await response.text();
  const data = safeJsonParse(raw, {});
  if (!response.ok) {
    const code = data?.error?.code ? ` (${data.error.code})` : "";
    const providerMessage = String(data?.error?.message || `HTTP ${response.status}`).slice(0, 300);
    const error = new Error(`WhatsApp API${code}: ${providerMessage}`);
    error.retryable = isRetryableWhatsAppStatus(response.status);
    throw error;
  }
  return { status: "submitted", providerMessageId: data.messages?.[0]?.id || "", httpStatus: response.status };
}
__name(sendWhatsApp, "sendWhatsApp");
async function sendWhatsAppTemplate(env, channel, recipient, template, messageId) {
  const credentials = await readChannelCredentials(env, channel);
  const token = credentials.accessToken;
  const phoneNumberId = channel.config?.phoneNumberId;
  if (!token || !phoneNumberId) throw nonRetryableError("WhatsApp credentials are not configured.");
  const version = metaApiVersion(channel.config?.apiVersion);
  const body = buildWhatsAppTemplatePayload(recipient, template, messageId);
  const response = await fetch(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = safeJsonParse(await response.text(), {});
  if (!response.ok) {
    const code = data?.error?.code ? ` (${data.error.code})` : "";
    const providerMessage = String(data?.error?.message || `HTTP ${response.status}`).slice(0, 300);
    const error = new Error(`WhatsApp API${code}: ${providerMessage}`);
    error.retryable = isRetryableWhatsAppStatus(response.status);
    throw error;
  }
  return { status: "submitted", providerMessageId: data.messages?.[0]?.id || "", httpStatus: response.status };
}
__name(sendWhatsAppTemplate, "sendWhatsAppTemplate");
async function sendWhatsAppMedia(env, channel, recipient, media, messageId, replyChannelMessageId = "") {
  const credentials = await readChannelCredentials(env, channel);
  const token = credentials.accessToken;
  const phoneNumberId = channel.config?.phoneNumberId;
  if (!token || !phoneNumberId) throw nonRetryableError("WhatsApp credentials are not configured.");
  const type = String(media?.type || "");
  if (!["image", "video", "audio", "document"].includes(type) || !media?.id) {
    throw nonRetryableError("The WhatsApp attachment payload is invalid.");
  }
  const item = { id: String(media.id) };
  if (type !== "audio" && media.caption) item.caption = String(media.caption).slice(0, MAX_ATTACHMENT_CAPTION_LENGTH);
  if (type === "document" && media.filename) item.filename = String(media.filename).slice(0, 240);
  const version = metaApiVersion(channel.config?.apiVersion);
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizeWhatsAppRecipient(recipient),
    type,
    [type]: item,
    biz_opaque_callback_data: String(messageId).slice(0, 512),
    ...replyChannelMessageId ? { context: { message_id: String(replyChannelMessageId) } } : {}
  };
  const response = await fetch(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = safeJsonParse(await response.text(), {});
  if (!response.ok) {
    const code = data?.error?.code ? ` (${data.error.code})` : "";
    const providerMessage = String(data?.error?.message || `HTTP ${response.status}`).slice(0, 300);
    const error = new Error(`WhatsApp API${code}: ${providerMessage}`);
    error.retryable = isRetryableWhatsAppStatus(response.status);
    throw error;
  }
  return {
    status: "submitted",
    providerMessageId: data.messages?.[0]?.id || "",
    httpStatus: response.status,
    attachment: {
      type,
      filename: String(media.filename || ""),
      mimeType: String(media.mimeType || ""),
      size: Number(media.size || 0),
      caption: String(media.caption || ""),
      providerMediaId: String(media.id)
    }
  };
}
__name(sendWhatsAppMedia, "sendWhatsAppMedia");
async function sendGeneric(env, channel, row) {
  const cfg = channel.config || {};
  assertAllowedHttpsEndpoint(cfg.endpoint, cfg.allowedHosts || []);
  const method = String(cfg.method || "POST").toUpperCase();
  if (!["POST", "PUT", "PATCH"].includes(method)) throw new Error("Generic connector method is not allowed.");
  const context = {
    recipient: { channelProfileId: row.channel_profile_id },
    message: { messageId: row.message_id, text: row.text },
    conversation: { conversationId: row.conversation_id, contactId: row.contact_id },
    channel: { channelId: row.channel_id }
  };
  const prefix = secretPrefix(channel.secretKey);
  const resolver = /* @__PURE__ */ __name((name) => env[`${prefix}_${secretPrefix(name)}`], "resolver");
  const headers = resolveTemplate(cfg.headers || { "Content-Type": "application/json" }, context, resolver);
  const body = resolveTemplate(cfg.bodyTemplate || { to: "{{recipient.channelProfileId}}", text: "{{message.text}}" }, context, resolver);
  const response = await fetch(cfg.endpoint, { method, headers, body: JSON.stringify(body), redirect: "manual" });
  if (response.status >= 300 && response.status < 400) throw new Error("Provider redirects are not allowed for generic connectors.");
  const raw = await response.text();
  const data = safeJsonParse(raw, {});
  if (!response.ok) throw new Error(`Provider API HTTP ${response.status}: ${raw.slice(0, 500)}`);
  const mapping = cfg.responseMapping || {};
  return {
    status: mapping.status ? getPath(data, mapping.status) || "submitted" : "submitted",
    providerMessageId: mapping.providerMessageId ? getPath(data, mapping.providerMessageId) || "" : "",
    httpStatus: response.status
  };
}
__name(sendGeneric, "sendGeneric");
async function sendTelegram(env, channel, chatId, text, replyChannelMessageId = "") {
  const credentials = await readChannelCredentials(env, channel);
  const token = credentials.botToken;
  if (!token) throw nonRetryableError("Telegram bot token is not configured.");
  const body = { chat_id: chatId, text };
  if (replyChannelMessageId) body.reply_parameters = { message_id: Number(replyChannelMessageId) };
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const raw = await response.text();
  const data = safeJsonParse(raw, {});
  if (!response.ok || data.ok === false) {
    const error = new Error(`Telegram API: ${providerError(data, response.status)}`);
    error.retryable = isRetryableProviderStatus(response.status);
    throw error;
  }
  return { status: "sent", providerMessageId: String(data.result?.message_id || ""), httpStatus: response.status };
}
__name(sendTelegram, "sendTelegram");
async function sendTelegramMedia(env, channel, chatId, file, attachment, replyChannelMessageId = "") {
  const credentials = await readChannelCredentials(env, channel);
  const token = credentials.botToken;
  if (!token) throw nonRetryableError("Telegram bot token is not configured.");
  const telegramPhoto = attachment.type === "image" && ["image/jpeg", "image/png"].includes(attachment.mimeType) && attachment.size <= TELEGRAM_PHOTO_MAX_BYTES;
  const voice = attachment.type === "audio" && attachment.mimeType === "audio/ogg";
  const method = telegramPhoto ? "sendPhoto" : attachment.type === "video" ? "sendVideo" : voice ? "sendVoice" : attachment.type === "audio" ? "sendAudio" : "sendDocument";
  const field = telegramPhoto ? "photo" : attachment.type === "video" ? "video" : voice ? "voice" : attachment.type === "audio" ? "audio" : "document";
  const body = new FormData();
  body.set("chat_id", String(chatId));
  if (replyChannelMessageId) body.set("reply_parameters", JSON.stringify({ message_id: Number(replyChannelMessageId) }));
  body.set(field, file, attachment.filename);
  if (attachment.caption) body.set("caption", attachment.caption);
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", body });
  const data = safeJsonParse(await response.text(), {});
  if (!response.ok || data.ok === false) {
    const error = new Error(`Telegram API: ${providerError(data, response.status)}`);
    error.retryable = isRetryableProviderStatus(response.status);
    throw error;
  }
  const sent = data.result || {};
  const providerFileId = telegramPhoto ? String(sent.photo?.at?.(-1)?.file_id || "") : String((voice ? sent.voice : sent[attachment.type])?.file_id || sent.document?.file_id || "");
  return {
    status: "sent",
    providerMessageId: String(sent.message_id || ""),
    providerFileId,
    httpStatus: response.status
  };
}
__name(sendTelegramMedia, "sendTelegramMedia");
async function sendInstagram(env, channel, recipient, text) {
  const credentials = await readChannelCredentials(env, channel);
  const accountId = String(channel.config?.instagramAccountId || "");
  if (!credentials.accessToken || !accountId) throw nonRetryableError("Instagram credentials are not configured.");
  const version = metaApiVersion(channel.config?.apiVersion);
  const response = await fetch(`https://graph.instagram.com/${encodeURIComponent(version)}/${encodeURIComponent(accountId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: String(recipient) }, message: { text } })
  });
  const data = safeJsonParse(await response.text(), {});
  if (!response.ok) {
    const error = new Error(`Instagram API: ${providerError(data, response.status)}`);
    error.retryable = isRetryableProviderStatus(response.status);
    throw error;
  }
  return {
    status: "submitted",
    providerMessageId: String(data.message_id || data.id || ""),
    httpStatus: response.status
  };
}
__name(sendInstagram, "sendInstagram");
async function sendInstagramMedia(env, channel, recipient, file, attachment) {
  const credentials = await readChannelCredentials(env, channel);
  const accountId = String(channel.config?.instagramAccountId || "");
  if (!credentials.accessToken || !accountId) throw nonRetryableError("Instagram credentials are not configured.");
  const version = metaApiVersion(channel.config?.apiVersion);
  const type = attachment.type === "document" ? "file" : attachment.type;
  if (!["image", "video", "audio", "file"].includes(type)) {
    throw nonRetryableError("This attachment type is not supported for Instagram.");
  }
  const body = new FormData();
  body.set("recipient", JSON.stringify({ id: String(recipient) }));
  body.set("message", JSON.stringify({
    attachment: {
      type,
      payload: { is_reusable: true }
    }
  }));
  body.set("filedata", file, attachment.filename);
  const response = await fetch(
    `https://graph.instagram.com/${encodeURIComponent(version)}/${encodeURIComponent(accountId)}/messages`,
    { method: "POST", headers: { Authorization: `Bearer ${credentials.accessToken}` }, body }
  );
  const data = safeJsonParse(await response.text(), {});
  if (!response.ok) {
    const error = new Error(`Instagram API: ${providerError(data, response.status)}`);
    error.retryable = isRetryableProviderStatus(response.status);
    throw error;
  }
  return {
    status: "submitted",
    providerMessageId: String(data.message_id || data.id || ""),
    providerAttachmentId: String(data.attachment_id || ""),
    httpStatus: response.status
  };
}
__name(sendInstagramMedia, "sendInstagramMedia");
async function sendFacebookMessenger(env, channel, recipient, text) {
  const credentials = await readChannelCredentials(env, channel);
  const pageId = String(channel.config?.pageId || "");
  if (!credentials.accessToken || !pageId) throw nonRetryableError("Messenger credentials are not configured.");
  const version = metaApiVersion(channel.config?.apiVersion);
  const response = await fetch(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(pageId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: String(recipient) },
      messaging_type: "RESPONSE",
      message: { text }
    })
  });
  const data = safeJsonParse(await response.text(), {});
  if (!response.ok) {
    const error = new Error(`Messenger API: ${providerError(data, response.status)}`);
    error.retryable = isRetryableProviderStatus(response.status);
    throw error;
  }
  return {
    status: "submitted",
    providerMessageId: String(data.message_id || data.id || ""),
    httpStatus: response.status
  };
}
__name(sendFacebookMessenger, "sendFacebookMessenger");
async function sendFacebookMessengerMedia(env, channel, recipient, file, attachment) {
  const credentials = await readChannelCredentials(env, channel);
  const pageId = String(channel.config?.pageId || "");
  if (!credentials.accessToken || !pageId) throw nonRetryableError("Messenger credentials are not configured.");
  const version = metaApiVersion(channel.config?.apiVersion);
  const type = attachment.type === "document" ? "file" : attachment.type;
  if (!["image", "video", "audio", "file"].includes(type)) {
    throw nonRetryableError("This attachment type is not supported for Messenger.");
  }
  const body = new FormData();
  body.set("recipient", JSON.stringify({ id: String(recipient) }));
  body.set("messaging_type", "RESPONSE");
  const message = {
    attachment: {
      type,
      payload: { is_reusable: true }
    }
  };
  if (attachment.caption && type !== "audio") {
  }
  body.set("message", JSON.stringify(message));
  body.set("filedata", file, attachment.filename);
  const response = await fetch(
    `https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(pageId)}/messages`,
    { method: "POST", headers: { Authorization: `Bearer ${credentials.accessToken}` }, body }
  );
  const data = safeJsonParse(await response.text(), {});
  if (!response.ok) {
    const error = new Error(`Messenger API: ${providerError(data, response.status)}`);
    error.retryable = isRetryableProviderStatus(response.status);
    throw error;
  }
  return {
    status: "submitted",
    providerMessageId: String(data.message_id || data.id || ""),
    providerAttachmentId: String(data.attachment_id || ""),
    httpStatus: response.status
  };
}
__name(sendFacebookMessengerMedia, "sendFacebookMessengerMedia");
async function markMessageSent(env, messageId, result) {
  const deliveryStatus = result.status || "submitted";
  await env.DB.batch([
    env.DB.prepare(`UPDATE messages SET
        status=CASE WHEN status IN ('sent','delivered','read','failed') THEN status ELSE ?2 END,
        provider_message_id=CASE WHEN provider_message_id='' THEN ?3 ELSE provider_message_id END,
        error=CASE WHEN status='failed' THEN error ELSE '' END
      WHERE message_id=?1`).bind(messageId, deliveryStatus, result.providerMessageId || ""),
    env.DB.prepare("DELETE FROM outbox WHERE message_id=?1").bind(messageId),
    env.DB.prepare("DELETE FROM outbound_payloads WHERE message_id=?1").bind(messageId)
  ]);
  const stored = await env.DB.prepare(`SELECT conversation_id,status,error,provider_message_id,payload_json
    FROM messages WHERE message_id=?1`).bind(messageId).first();
  const statusHistory = await persistMessageStatusHistory(env, stored, deliveryStatus, (/* @__PURE__ */ new Date()).toISOString());
  await broadcastMessageStatusChanges(env, result.workspaceId, [{
    messageId,
    conversationId: stored?.conversation_id,
    status: stored?.status || deliveryStatus,
    error: stored?.error || "",
    channelMessageId: String(stored?.provider_message_id || result.providerMessageId || ""),
    ...statusHistory ? { statusHistory } : {}
  }]);
}
__name(markMessageSent, "markMessageSent");
async function retryDueMessages(env) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const staleBefore = new Date(Date.now() - 5 * 60 * 1e3).toISOString();
  await env.DB.prepare(`UPDATE outbox SET status='pending',next_attempt_at=?1,updated_at=?1
    WHERE status='processing' AND updated_at<=?2`).bind(now, staleBefore).run();
  const due = await env.DB.prepare(`SELECT outbox_id,message_id,attempts,max_attempts,workspace_id FROM outbox
    WHERE status='pending' AND next_attempt_at<=?1 ORDER BY next_attempt_at LIMIT 25`).bind(now).all();
  for (const job of due.results) {
    const claimed = await env.DB.prepare("UPDATE outbox SET status='processing',updated_at=?2 WHERE outbox_id=?1 AND status='pending'").bind(job.outbox_id, now).run();
    if (!claimed.meta?.changes) continue;
    const beforeSend = await env.DB.prepare("SELECT status FROM messages WHERE message_id=?1").bind(job.message_id).first();
    if (beforeSend && isTerminalProviderStatus(beforeSend.status)) {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM outbox WHERE message_id=?1").bind(job.message_id),
        env.DB.prepare("DELETE FROM outbound_payloads WHERE message_id=?1").bind(job.message_id)
      ]);
      continue;
    }
    try {
      await markMessageSent(env, job.message_id, await dispatchOutbound(env, job.message_id));
    } catch (error) {
      const latest = await env.DB.prepare(`SELECT conversation_id,status,provider_message_id
        FROM messages WHERE message_id=?1`).bind(job.message_id).first();
      if (latest && isTerminalProviderStatus(latest.status)) {
        await env.DB.batch([
          env.DB.prepare("DELETE FROM outbox WHERE message_id=?1").bind(job.message_id),
          env.DB.prepare("DELETE FROM outbound_payloads WHERE message_id=?1").bind(job.message_id)
        ]);
        continue;
      }
      const attempts = Number(job.attempts) + 1;
      const exhausted = error?.retryable === false || attempts >= Number(job.max_attempts);
      const delaySeconds = Math.min(3600, 30 * 2 ** Math.min(attempts, 7));
      const next = new Date(Date.now() + delaySeconds * 1e3).toISOString();
      const statements = [
        env.DB.prepare("UPDATE outbox SET status=?2,attempts=?3,next_attempt_at=?4,last_error=?5,updated_at=?6 WHERE outbox_id=?1").bind(job.outbox_id, exhausted ? "failed" : "pending", attempts, next, cleanError(error), now),
        env.DB.prepare("UPDATE messages SET status=?2,error=?3 WHERE message_id=?1").bind(job.message_id, exhausted ? "failed" : "retrying", cleanError(error))
      ];
      if (exhausted) statements.push(env.DB.prepare("DELETE FROM outbound_payloads WHERE message_id=?1").bind(job.message_id));
      await env.DB.batch(statements);
      await broadcastMessageStatusChanges(env, job.workspace_id, [{
        messageId: job.message_id,
        conversationId: latest?.conversation_id,
        status: exhausted ? "failed" : "retrying",
        error: cleanError(error),
        channelMessageId: String(latest?.provider_message_id || "")
      }]);
    }
  }
}
__name(retryDueMessages, "retryDueMessages");
async function storeInbound(env, channel, event, rawPayload) {
  if (!event.channelProfileId || !event.text && !event.providerMessageId) return false;
  const providerEventKey = String(event.dedupeKey || event.providerMessageId || await hashText(JSON.stringify(event)));
  const eventKey = `${channel.workspaceId}:${channel.channelId}:message:${providerEventKey}`;
  const dedupe = await env.DB.prepare(`INSERT OR IGNORE INTO webhook_events (event_key,channel_id,event_type,received_at,workspace_id)
    VALUES (?1,?2,'message',?3,?4)`).bind(eventKey, channel.channelId, (/* @__PURE__ */ new Date()).toISOString(), channel.workspaceId).run();
  if (!dedupe.meta?.changes) return false;
  try {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const timestamp = normalizeTimestamp(event.timestamp, now);
    const profileId = String(event.channelProfileId);
    const platform = platformForChannel(channel);
    let identity = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id,c.display_name AS contact_display_name
    FROM channel_identity_bindings b
    JOIN contact_identities ci ON ci.identity_id=b.identity_id AND ci.workspace_id=b.workspace_id
    JOIN contacts c ON c.contact_id=ci.contact_id AND c.workspace_id=ci.workspace_id
    WHERE b.workspace_id=?1 AND b.channel_id=?2 AND b.scoped_profile_id=?3 AND b.active=1 LIMIT 1`).bind(channel.workspaceId, channel.channelId, String(event.channelProfileId)).first();
    if (!identity) {
      const candidates = PORTABLE_IDENTITY_PLATFORMS.has(platform) ? await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id,c.display_name AS contact_display_name
          FROM contact_identities ci JOIN contacts c ON c.contact_id=ci.contact_id AND c.workspace_id=ci.workspace_id
          WHERE ci.workspace_id=?1 AND ci.platform=?2 AND ci.profile_id=?3
          ORDER BY ci.created_at,ci.identity_id`).bind(channel.workspaceId, platform, profileId).all() : { results: [] };
      if ((candidates.results || []).length === 1) {
        identity = candidates.results[0];
        try {
          await ensureIdentityBinding(env, channel.workspaceId, identity.contact_id, identity.identity_id, {
            platform,
            profileId,
            scopedProfileId: profileId,
            username: "",
            phoneNumber: platform === "whatsapp" && /^\d{6,20}$/.test(profileId) ? profileId : "",
            displayName: String(event.displayName || identity.contact_display_name || profileId).slice(0, 120),
            metadata: {},
            channelId: channel.channelId
          }, now);
        } catch (error) {
          const winner = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id,c.display_name AS contact_display_name
          FROM channel_identity_bindings b JOIN contact_identities ci ON ci.identity_id=b.identity_id
          JOIN contacts c ON c.contact_id=ci.contact_id AND c.workspace_id=ci.workspace_id
          WHERE b.workspace_id=?1 AND b.channel_id=?2 AND b.scoped_profile_id=?3 AND b.active=1 LIMIT 1`).bind(channel.workspaceId, channel.channelId, profileId).first();
          if (!winner) throw error;
          identity = winner;
        }
      } else {
        const contactId = crypto.randomUUID();
        const name = String(event.displayName || event.channelProfileId).slice(0, 120);
        try {
          await env.DB.prepare(`INSERT INTO contacts (contact_id,display_name,created_at,updated_at,workspace_id)
          VALUES (?1,?2,?3,?3,?4)`).bind(contactId, name, now, channel.workspaceId).run();
          const created = await ensureContactIdentity(env, channel.workspaceId, contactId, {
            platform,
            profileId,
            channelId: channel.channelId,
            scopedProfileId: profileId,
            phoneNumber: platform === "whatsapp" && /^\d{6,20}$/.test(profileId) ? profileId : "",
            displayName: name,
            isPrimary: true
          }, now);
          identity = { identity_id: created.identityId, contact_id: contactId, contact_display_name: name };
        } catch (error) {
          await env.DB.prepare(`DELETE FROM contacts WHERE workspace_id=?1 AND contact_id=?2
          AND NOT EXISTS (SELECT 1 FROM conversations WHERE workspace_id=?1 AND contact_id=?2)`).bind(channel.workspaceId, contactId).run().catch(() => {
          });
          const winner = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id,c.display_name AS contact_display_name
          FROM channel_identity_bindings b JOIN contact_identities ci ON ci.identity_id=b.identity_id
          JOIN contacts c ON c.contact_id=ci.contact_id AND c.workspace_id=ci.workspace_id
          WHERE b.workspace_id=?1 AND b.channel_id=?2 AND b.scoped_profile_id=?3 AND b.active=1 LIMIT 1`).bind(channel.workspaceId, channel.channelId, profileId).first();
          if (!winner) throw error;
          identity = winner;
        }
      }
    }
    identity = await upgradeInboundContactDisplayName(
      env,
      channel.workspaceId,
      identity,
      profileId,
      event.displayName,
      now
    );
    const priorConversation = await env.DB.prepare(`SELECT conversation_id,status,channel_id,contact_id,identity_id
    FROM conversations WHERE workspace_id=?1 AND contact_id=?2 LIMIT 1`).bind(channel.workspaceId, identity.contact_id).first();
    const shouldRecordOpenEvent = !priorConversation || String(priorConversation.status || "") !== "open";
    const conversationId = await ensureIdentityConversation(
      env,
      channel.workspaceId,
      identity.contact_id,
      identity.identity_id,
      channel.channelId,
      ""
    );
    const conversation = {
      conversation_id: conversationId,
      channel_id: channel.channelId,
      contact_id: identity.contact_id,
      identity_id: identity.identity_id
    };
    const messageId = crypto.randomUUID();
    const reply = await resolveInboundReply(
      env,
      channel.workspaceId,
      conversation.conversation_id,
      channel.channelId,
      event.reply
    );
    const storedPayload = event.attachment || reply ? {
      ...event.attachment ? { attachment: event.attachment } : {},
      ...reply ? { reply } : {},
      providerMessageId: String(event.providerMessageId || "")
    } : rawPayload;
    const senderName = String(identity.contact_display_name || event.displayName || event.channelProfileId);
    let openEvent = null;
    if (shouldRecordOpenEvent) {
      openEvent = await insertLifecycleEventMessage(env, channel.workspaceId, conversation, {
        action: "opened",
        actorLogin: "customer",
        actorName: senderName.slice(0, 120) || "customer",
        timestamp: earlierEventTimestamp(timestamp)
      });
    }
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO messages (message_id,conversation_id,contact_id,channel_id,identity_id,direction,message_type,text,
      provider_message_id,status,timestamp,payload_json,workspace_id) VALUES (?1,?2,?3,?4,?5,'inbound',?6,?7,?8,'received',?9,?10,?11)`).bind(
        messageId,
        conversation.conversation_id,
        identity.contact_id,
        channel.channelId,
        identity.identity_id,
        String(event.messageType || "text").slice(0, 40),
        String(event.text || "").slice(0, MAX_TEXT_LENGTH),
        String(event.providerMessageId || ""),
        timestamp,
        truncateJson(storedPayload),
        channel.workspaceId
      ),
      env.DB.prepare(`UPDATE conversations SET status='open',channel_id=?3,identity_id=?4,
        last_message_at=?5,unread_count=unread_count+1,updated_at=?6
      WHERE conversation_id=?1 AND workspace_id=?2`).bind(conversation.conversation_id, channel.workspaceId, channel.channelId, identity.identity_id, timestamp, now)
    ]);
    await touchIdentityBinding(
      env,
      channel.workspaceId,
      identity.identity_id,
      channel.channelId,
      "inbound",
      conversation.conversation_id,
      timestamp
    );
    const messageType = String(event.messageType || "text").slice(0, 40);
    const text = String(event.text || "").slice(0, MAX_TEXT_LENGTH);
    const message = {
      messageId,
      conversationId: conversation.conversation_id,
      channelId: channel.channelId,
      contactIdentityId: identity.identity_id,
      identityId: identity.identity_id,
      direction: "inbound",
      messageType,
      text,
      status: "received",
      timestamp,
      channelMessageId: String(event.providerMessageId || ""),
      error: "",
      senderName,
      connectorType: channel.connectorType,
      channelName: channel.name || "",
      channelProfileId: profileId,
      attachment: messageAttachmentView(messageType, storedPayload, messageId),
      reply: messageReplyView(storedPayload)
    };
    const conversationItem = await getConversationItem(env, channel.workspaceId, conversation.conversation_id);
    return {
      messageId,
      conversationId: conversation.conversation_id,
      senderName,
      preview: text,
      messageType,
      message,
      conversation: conversationItem,
      ...openEvent ? { openEvent } : {}
    };
  } catch (error) {
    await env.DB.prepare("DELETE FROM webhook_events WHERE event_key=?1").bind(eventKey).run();
    throw error;
  }
}
__name(storeInbound, "storeInbound");
async function resolveInboundReply(env, workspaceId, conversationId, channelId, providerReply) {
  const channelMessageId = String(providerReply?.channelMessageId || "").trim();
  if (!channelMessageId) return null;
  const row = await env.DB.prepare(`SELECT message_id,provider_message_id,direction,text,message_type,payload_json
    FROM messages WHERE workspace_id=?1 AND conversation_id=?2 AND channel_id=?3 AND provider_message_id=?4
    ORDER BY timestamp DESC LIMIT 1`).bind(workspaceId, conversationId, channelId, channelMessageId).first();
  if (row) return replyMetadataFromRow(row);
  return messageReplyView({ reply: providerReply });
}
__name(resolveInboundReply, "resolveInboundReply");
async function enrichOutboundAttachmentFromProviderEcho(env, row, attachment) {
  const externalUrl = safeStoredExternalMediaUrl(attachment?.externalUrl);
  if (!row?.message_id || !externalUrl) return null;
  const payload = safeJsonParse(row.payload_json, {});
  const existing = payload.attachment && typeof payload.attachment === "object" ? payload.attachment : null;
  if (!existing) return null;
  if (safeStoredExternalMediaUrl(existing.externalUrl) === externalUrl) {
    return messageAttachmentView(row.message_type || existing.type, payload, row.message_id);
  }
  const nextPayload = {
    ...payload,
    attachment: {
      ...existing,
      externalUrl,
      ...attachment.type && !existing.type ? { type: attachment.type } : {},
      ...attachment.filename && !existing.filename ? { filename: attachment.filename } : {},
      ...attachment.mimeType && !existing.mimeType ? { mimeType: attachment.mimeType } : {}
    }
  };
  await env.DB.prepare("UPDATE messages SET payload_json=?2 WHERE message_id=?1").bind(row.message_id, JSON.stringify(nextPayload)).run();
  return messageAttachmentView(row.message_type || nextPayload.attachment.type, nextPayload, row.message_id);
}
__name(enrichOutboundAttachmentFromProviderEcho, "enrichOutboundAttachmentFromProviderEcho");
async function applyProviderStatus(env, workspaceId, channelId, event, rawPayload) {
  const providerMessageId = String(event.providerMessageId || "");
  const internalMessageId = /^[A-Za-z0-9_-]{1,100}$/.test(String(event.internalMessageId || "")) ? String(event.internalMessageId) : "";
  const status = normalizeDeliveryStatus(event.status);
  if (!providerMessageId && !internalMessageId || !status) return [];
  const key = `${workspaceId}:${channelId}:status:${providerMessageId || internalMessageId}:${status}:${event.timestamp || ""}`;
  const dedupe = await env.DB.prepare(`INSERT OR IGNORE INTO webhook_events (event_key,channel_id,event_type,received_at,workspace_id)
    VALUES (?1,?2,'status',?3,?4)`).bind(key, channelId, (/* @__PURE__ */ new Date()).toISOString(), workspaceId).run();
  if (!dedupe.meta?.changes) return [];
  try {
    const updated = await env.DB.prepare(`UPDATE messages SET
        status=CASE
          WHEN status='failed' THEN status
          WHEN ?4='failed' THEN 'failed'
          WHEN status='read' THEN status
          WHEN status='delivered' AND ?4='sent' THEN status
          ELSE ?4
        END,
        error=CASE
          WHEN status='failed' THEN error
          WHEN ?4='failed' THEN ?5
          WHEN status='read' THEN error
          WHEN status='delivered' AND ?4='sent' THEN error
          ELSE ?5
        END,
        provider_message_id=CASE WHEN provider_message_id='' AND ?3<>'' THEN ?3 ELSE provider_message_id END
      WHERE workspace_id=?1 AND channel_id=?2
        AND ((?3<>'' AND provider_message_id=?3) OR (?6<>'' AND message_id=?6))`).bind(
      workspaceId,
      channelId,
      providerMessageId,
      status,
      String(event.error || "").slice(0, 500),
      internalMessageId
    ).run();
    if (!updated.meta?.changes) {
      await env.DB.prepare("DELETE FROM webhook_events WHERE event_key=?1").bind(key).run();
      return [];
    }
    const at = normalizeTimestamp(event.timestamp, (/* @__PURE__ */ new Date()).toISOString());
    const changed = await env.DB.prepare(`SELECT message_id,conversation_id,status,error,provider_message_id,payload_json,message_type
      FROM messages
      WHERE workspace_id=?1 AND channel_id=?2
        AND ((?3<>'' AND provider_message_id=?3) OR (?4<>'' AND message_id=?4))`).bind(workspaceId, channelId, providerMessageId, internalMessageId).all();
    const results = [];
    for (const row of changed.results || []) {
      const statusHistory = await persistMessageStatusHistory(env, row, status, at);
      let attachmentView = null;
      if (event.attachment?.externalUrl) {
        const fresh = statusHistory ? await env.DB.prepare(`SELECT message_id,conversation_id,status,error,provider_message_id,payload_json,message_type
              FROM messages WHERE message_id=?1`).bind(row.message_id).first() : row;
        attachmentView = await enrichOutboundAttachmentFromProviderEcho(env, fresh || row, event.attachment);
      }
      results.push({
        ...realtimeMessageStatus({ ...row, statusHistory }),
        ...attachmentView ? { attachment: attachmentView } : {}
      });
    }
    return results;
  } catch (error) {
    await env.DB.prepare("DELETE FROM webhook_events WHERE event_key=?1").bind(key).run();
    throw error;
  }
}
__name(applyProviderStatus, "applyProviderStatus");
async function applyProviderWatermarkStatus(env, workspaceId, channelId, event, rawPayload) {
  const channelProfileId = String(event.channelProfileId || "");
  const status = normalizeDeliveryStatus(event.status);
  const timestamp = normalizeTimestamp(event.timestamp, "");
  if (!channelProfileId || !timestamp || !["delivered", "read"].includes(status)) return [];
  const key = `${workspaceId}:${channelId}:watermark:${channelProfileId}:${status}:${timestamp}`;
  const dedupe = await env.DB.prepare(`INSERT OR IGNORE INTO webhook_events (event_key,channel_id,event_type,received_at,workspace_id)
    VALUES (?1,?2,'status',?3,?4)`).bind(key, channelId, (/* @__PURE__ */ new Date()).toISOString(), workspaceId).run();
  if (!dedupe.meta?.changes) return [];
  try {
    const updated = await env.DB.prepare(`UPDATE messages SET
        status=CASE
          WHEN status='failed' THEN status
          WHEN status='read' THEN status
          WHEN status='delivered' AND ?5='delivered' THEN status
          ELSE ?5
        END,
        error=CASE WHEN status='failed' THEN error ELSE '' END
      WHERE workspace_id=?1 AND channel_id=?2 AND direction='outbound' AND timestamp<=?4
        AND provider_message_id<>'' AND status IN ('submitted','sent','delivered','read')
        AND COALESCE(NULLIF(identity_id,''),(SELECT NULLIF(c.identity_id,'') FROM conversations c
          WHERE c.workspace_id=messages.workspace_id AND c.conversation_id=messages.conversation_id),'')
          IN (SELECT identity_id FROM channel_identity_bindings
          WHERE workspace_id=?1 AND channel_id=?2 AND scoped_profile_id=?3)`).bind(workspaceId, channelId, channelProfileId, timestamp, status).run();
    if (!updated.meta?.changes) return [];
    const changed = await env.DB.prepare(`SELECT m.message_id,m.conversation_id,m.status,m.error,m.provider_message_id,m.payload_json FROM messages m
      WHERE m.workspace_id=?1 AND m.channel_id=?2 AND m.direction='outbound' AND m.timestamp<=?4
        AND m.provider_message_id<>'' AND m.status IN ('submitted','sent','delivered','read')
        AND COALESCE(NULLIF(m.identity_id,''),(SELECT NULLIF(c.identity_id,'') FROM conversations c
          WHERE c.workspace_id=m.workspace_id AND c.conversation_id=m.conversation_id),'')
          IN (SELECT identity_id FROM channel_identity_bindings
          WHERE workspace_id=?1 AND channel_id=?2 AND scoped_profile_id=?3)`).bind(workspaceId, channelId, channelProfileId, timestamp).all();
    const results = [];
    for (const row of changed.results || []) {
      const statusHistory = await persistMessageStatusHistory(env, row, status, timestamp);
      results.push(realtimeMessageStatus({ ...row, statusHistory }));
    }
    return results;
  } catch (error) {
    await env.DB.prepare("DELETE FROM webhook_events WHERE event_key=?1").bind(key).run();
    throw error;
  }
}
__name(applyProviderWatermarkStatus, "applyProviderWatermarkStatus");
function realtimeMessageStatus(row) {
  const statusHistory = isPlainObject(row.statusHistory) ? messageStatusHistoryView({ statusHistory: row.statusHistory }) : messageStatusHistoryView(safeJsonParse(row.payload_json, {}));
  return {
    messageId: String(row.message_id || ""),
    conversationId: String(row.conversation_id || ""),
    status: String(row.status || ""),
    error: String(row.error || ""),
    channelMessageId: String(row.provider_message_id || row.channelMessageId || ""),
    ...statusHistory ? { statusHistory } : {}
  };
}
__name(realtimeMessageStatus, "realtimeMessageStatus");
function statusHistoryFieldForStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "failed" || normalized === "error") return "failedAt";
  if (normalized === "read" || normalized === "seen") return "readAt";
  if (normalized === "delivered") return "deliveredAt";
  if (["sent", "submitted", "accepted"].includes(normalized)) return "sentAt";
  return "";
}
__name(statusHistoryFieldForStatus, "statusHistoryFieldForStatus");
function mergeStatusHistoryPayload(payload, status, at) {
  const field = statusHistoryFieldForStatus(status);
  const when = String(at || "").trim().slice(0, 64);
  if (!field || !when) {
    return {
      payload: isPlainObject(payload) ? payload : {},
      history: messageStatusHistoryView(payload),
      changed: false
    };
  }
  const nextPayload = isPlainObject(payload) ? { ...payload } : {};
  const current = isPlainObject(nextPayload.statusHistory) ? { ...nextPayload.statusHistory } : {};
  let changed = false;
  if (!String(current[field] || "").trim()) {
    current[field] = when;
    changed = true;
  }
  if (String(current.updatedAt || "").trim() !== when) {
    current.updatedAt = when;
    changed = true;
  }
  if (changed) nextPayload.statusHistory = current;
  return { payload: nextPayload, history: messageStatusHistoryView(nextPayload), changed };
}
__name(mergeStatusHistoryPayload, "mergeStatusHistoryPayload");
async function persistMessageStatusHistory(env, row, status, at) {
  if (!row?.message_id) return null;
  const existingPayload = safeJsonParse(row.payload_json, {});
  const { payload, history, changed } = mergeStatusHistoryPayload(existingPayload, status, at);
  if (!changed || !history) return messageStatusHistoryView(existingPayload);
  await env.DB.prepare("UPDATE messages SET payload_json=?2 WHERE message_id=?1").bind(row.message_id, JSON.stringify(payload)).run();
  return history;
}
__name(persistMessageStatusHistory, "persistMessageStatusHistory");
function normalizeStoredStatusHistory(history) {
  if (!isPlainObject(history)) return null;
  const next = {};
  for (const key of ["sentAt", "deliveredAt", "readAt", "failedAt", "updatedAt"]) {
    const value = normalizeTimestamp(history[key], "");
    if (value) next[key] = value;
  }
  return Object.keys(next).length ? next : null;
}
__name(normalizeStoredStatusHistory, "normalizeStoredStatusHistory");
function mergeImportedStatusHistory(existingPayload, incomingHistory) {
  const incoming = normalizeStoredStatusHistory(incomingHistory);
  const current = isPlainObject(existingPayload?.statusHistory) ? { ...existingPayload.statusHistory } : {};
  if (!incoming) {
    const history2 = messageStatusHistoryView({ statusHistory: current });
    return { history: history2, changed: false, merged: history2 || null };
  }
  let changed = false;
  for (const [key, value] of Object.entries(incoming)) {
    if (!String(current[key] || "").trim()) {
      current[key] = value;
      changed = true;
    }
  }
  const history = messageStatusHistoryView({ statusHistory: current });
  return { history, changed, merged: history || null };
}
__name(mergeImportedStatusHistory, "mergeImportedStatusHistory");
async function broadcastMessageStatusChanges(env, workspaceId, changes) {
  const unique = /* @__PURE__ */ new Map();
  for (const change of changes || []) {
    if (!change?.messageId || !change?.conversationId || !change?.status) continue;
    unique.set(change.messageId, change);
  }
  for (const change of unique.values()) {
    await broadcast(env, workspaceId, {
      type: "message.updated",
      messageId: change.messageId,
      conversationId: change.conversationId,
      status: change.status,
      channelMessageId: String(change.channelMessageId || ""),
      message: change
    });
    await syncCampaignRecipientStatus(env, workspaceId, change.messageId, change.status, change.error || "");
  }
}
__name(broadcastMessageStatusChanges, "broadcastMessageStatusChanges");
async function seedDemo(env, workspaceId, principal) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const channelId = workspaceId === "ws_default" ? "demo-web" : `demo-web-${workspaceId}`;
  const contactId = crypto.randomUUID();
  const identityId = crypto.randomUUID();
  const bindingId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const profileId = `demo-${contactId}`;
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO channels (channel_id,name,connector_type,enabled,capabilities_json,config_json,secret_key,created_at,updated_at,workspace_id)
      VALUES (?1,'Website chat','web_chat',1,'["text"]','{}','DEMO_WEB',?2,?2,?3)`).bind(channelId, now, workspaceId),
    env.DB.prepare("INSERT INTO contacts (contact_id,display_name,created_at,updated_at,workspace_id) VALUES (?1,?2,?3,?3,?4)").bind(contactId, "Demo customer", now, workspaceId),
    env.DB.prepare(`INSERT INTO contact_identities
        (identity_id,workspace_id,contact_id,platform,profile_id,display_name,metadata_json,created_at,updated_at)
      VALUES (?1,?2,?3,'web_chat',?4,'Demo customer','{"isPrimary":true}',?5,?5)`).bind(identityId, workspaceId, contactId, profileId, now),
    env.DB.prepare(`INSERT INTO channel_identity_bindings
        (binding_id,workspace_id,identity_id,channel_id,scoped_profile_id,metadata_json,active,
         first_seen_at,last_seen_at,last_inbound_at,last_conversation_id,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,'{}',1,?6,?6,?6,?7,?6,?6)`).bind(bindingId, workspaceId, identityId, channelId, profileId, now, conversationId),
    env.DB.prepare(`INSERT INTO channel_identities (identity_id,contact_id,channel_id,channel_profile_id,display_name,created_at,workspace_id)
      VALUES (?1,?2,?3,?4,?5,?6,?7)`).bind(bindingId, contactId, channelId, profileId, "Demo customer", now, workspaceId),
    env.DB.prepare(`INSERT INTO conversations (conversation_id,contact_id,channel_id,identity_id,status,subject,last_message_at,unread_count,created_at,updated_at,workspace_id)
      VALUES (?1,?2,?3,?4,'open','Demo customer',?5,1,?5,?5,?6)`).bind(conversationId, contactId, channelId, identityId, now, workspaceId),
    env.DB.prepare(`INSERT INTO messages (message_id,conversation_id,contact_id,channel_id,identity_id,direction,message_type,text,status,timestamp,workspace_id)
      VALUES (?1,?2,?3,?4,?5,'inbound','text','Hello! This is a demo conversation.','received',?6,?7)`).bind(crypto.randomUUID(), conversationId, contactId, channelId, identityId, now, workspaceId)
  ]);
  await audit(env, principal, "seed", "conversation", conversationId, { channelId });
  return { ok: true, channelId, contactId, conversationId };
}
__name(seedDemo, "seedDemo");
async function listCampaigns(env, workspaceId, principal) {
  const allowed = restrictedChannelIds(principal);
  const rows = await env.DB.prepare(`SELECT c.*, ch.name AS channel_name, ch.connector_type, ch.provider_type
    FROM campaigns c
    LEFT JOIN channels ch ON ch.workspace_id=c.workspace_id AND ch.channel_id=c.channel_id
    WHERE c.workspace_id=?1
    ORDER BY c.created_at DESC
    LIMIT 100`).bind(workspaceId).all();
  return (rows.results || []).filter((row) => !allowed || allowed.includes(row.channel_id)).map((row) => serializeCampaign(row));
}
__name(listCampaigns, "listCampaigns");
async function getCampaignDetail(env, workspaceId, campaignId, principal) {
  const id = cleanId(campaignId, "Campaign ID");
  const row = await env.DB.prepare(`SELECT c.*, ch.name AS channel_name, ch.connector_type, ch.provider_type
    FROM campaigns c
    LEFT JOIN channels ch ON ch.workspace_id=c.workspace_id AND ch.channel_id=c.channel_id
    WHERE c.workspace_id=?1 AND c.campaign_id=?2`).bind(workspaceId, id).first();
  if (!row) throw httpError(404, "Campaign not found.");
  assertPrincipalChannelAccess(principal, row.channel_id);
  const recipients = await env.DB.prepare(`SELECT r.*, m.status AS message_status, m.text AS message_text, m.timestamp AS message_timestamp
    FROM campaign_recipients r
    LEFT JOIN messages m ON m.workspace_id=r.workspace_id AND m.message_id=r.message_id
    WHERE r.workspace_id=?1 AND r.campaign_id=?2
    ORDER BY r.created_at, r.recipient_id`).bind(workspaceId, id).all();
  const items = (recipients.results || []).map((item) => {
    const messageStatus = String(item.message_status || "");
    const status = messageStatus ? preferCampaignRecipientStatus(item.status, messageStatus) : item.status;
    return serializeCampaignRecipient({ ...item, status });
  });
  const counts = campaignCountsFromRows(items);
  return { item: serializeCampaign(row, counts), recipients: items };
}
__name(getCampaignDetail, "getCampaignDetail");
function validateCampaignPayload(payload) {
  if (!isPlainObject(payload)) throw httpError(400, "Campaign must be a JSON object.");
  rejectUnknownKeys(payload, /* @__PURE__ */ new Set([
    "name",
    "channelId",
    "audienceSource",
    "recipients",
    "fieldMapping",
    "messageType",
    "template",
    "variableMappings",
    "text",
    "textVariables",
    "previewText",
    "mediaPreview"
  ]), "campaign");
  const name = cleanRequired(payload.name, "Campaign name", 120);
  const channelId = cleanId(payload.channelId, "Channel ID");
  const audienceSource = String(payload.audienceSource || "contacts").trim();
  if (!CAMPAIGN_AUDIENCE_SOURCES.includes(audienceSource)) {
    throw httpError(400, "Audience source must be contacts or upload.");
  }
  const messageType = String(payload.messageType || "").trim();
  if (!CAMPAIGN_MESSAGE_TYPES.includes(messageType)) {
    throw httpError(400, "Message type must be template or text.");
  }
  if (!Array.isArray(payload.recipients) || !payload.recipients.length) {
    throw httpError(400, "Select at least one recipient.");
  }
  if (payload.recipients.length > MAX_CAMPAIGN_RECIPIENTS) {
    throw httpError(400, `Campaigns support at most ${MAX_CAMPAIGN_RECIPIENTS} recipients.`);
  }
  const fieldMapping = payload.fieldMapping === void 0 ? {} : payload.fieldMapping;
  if (!isPlainObject(fieldMapping)) throw httpError(400, "Field mapping must be an object.");
  const variableMappings = payload.variableMappings === void 0 ? [] : payload.variableMappings;
  if (!Array.isArray(variableMappings) || variableMappings.length > 100) {
    throw httpError(400, "Variable mappings must be an array with no more than 100 items.");
  }
  const textVariables = payload.textVariables === void 0 ? [] : payload.textVariables;
  if (!Array.isArray(textVariables) || textVariables.length > 100) {
    throw httpError(400, "Text variables must be an array with no more than 100 items.");
  }
  let template = null;
  let text = "";
  if (messageType === "template") {
    if (!isPlainObject(payload.template)) throw httpError(400, "WhatsApp campaigns require a template.");
    template = {
      name: cleanRequired(payload.template.name, "Template name", 512),
      language: {
        code: cleanRequired(payload.template.language?.code || payload.template.language, "Template language", 35)
      }
    };
  } else {
    text = cleanRequired(payload.text, "Message text", MAX_TEXT_LENGTH);
  }
  const previewText = payload.previewText === void 0 ? "" : cleanOptionalText(payload.previewText, "Preview text", MAX_TEMPLATE_PREVIEW_LENGTH);
  const mediaPreview = payload.mediaPreview === void 0 ? null : validateTemplateMediaPreview(payload.mediaPreview);
  return {
    name,
    channelId,
    audienceSource,
    messageType,
    recipients: payload.recipients,
    fieldMapping,
    variableMappings,
    textVariables,
    template,
    text,
    previewText,
    mediaPreview
  };
}
__name(validateCampaignPayload, "validateCampaignPayload");
async function createCampaign(env, workspaceId, payload, principal) {
  const input = validateCampaignPayload(payload);
  const channel = await getChannel(env, input.channelId, "", workspaceId);
  if (!channel) throw httpError(400, "Unknown or disabled channel.");
  assertPrincipalChannelAccess(principal, channel.channelId);
  await assertChannelReadyForConversation(env, workspaceId, channel);
  const connectorType = logicalConnectorType(channel);
  if (input.messageType === "template" && connectorType !== "whatsapp_cloud") {
    throw httpError(409, "Template campaigns are available only for WhatsApp channels.");
  }
  if (input.messageType === "text" && connectorType === "whatsapp_cloud") {
    throw httpError(409, "WhatsApp campaigns must use an approved template.");
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const campaignId = crypto.randomUUID();
  const recipientRows = [];
  for (const [index, raw] of input.recipients.entries()) {
    if (!isPlainObject(raw)) throw httpError(400, `Recipient ${index + 1} must be an object.`);
    if (input.audienceSource === "contacts") {
      rejectUnknownKeys(raw, /* @__PURE__ */ new Set(["contactId"]), `recipient ${index + 1}`);
      const contactId = cleanId(raw.contactId, "Contact ID");
      const contact = await env.DB.prepare(`SELECT contact_id,display_name,company,tags_json FROM contacts
        WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, contactId).first();
      if (!contact) throw httpError(404, `Contact not found for recipient ${index + 1}.`);
      recipientRows.push({
        recipientId: crypto.randomUUID(),
        contactId,
        displayName: contact.display_name || "",
        profileId: "",
        rowJson: "{}"
      });
    } else {
      rejectUnknownKeys(raw, /* @__PURE__ */ new Set(["row", "displayName", "profileId", "company", "tags"]), `recipient ${index + 1}`);
      const row = isPlainObject(raw.row) ? raw.row : {};
      const mapped = mapUploadRecipient(row, input.fieldMapping, index);
      recipientRows.push({
        recipientId: crypto.randomUUID(),
        contactId: "",
        displayName: mapped.displayName,
        profileId: mapped.profileId,
        rowJson: JSON.stringify({
          ...row,
          __mapped: {
            displayName: mapped.displayName,
            profileId: mapped.profileId,
            company: mapped.company,
            tags: mapped.tags
          }
        })
      });
    }
  }
  const counts = campaignCountsFromRows(recipientRows.map(() => ({ status: "pending" })));
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO campaigns
        (campaign_id,workspace_id,name,channel_id,audience_source,message_type,template_name,template_language,
         message_body,variable_mapping_json,field_mapping_json,status,total_count,pending_count,sent_count,
         delivered_count,read_count,failed_count,created_by,created_at,updated_at,completed_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'queued',?12,?13,0,0,0,0,?14,?15,?15,'')`).bind(
      campaignId,
      workspaceId,
      input.name,
      channel.channelId,
      input.audienceSource,
      input.messageType,
      input.template?.name || "",
      input.template?.language?.code || "",
      input.text || "",
      JSON.stringify({
        variableMappings: input.variableMappings,
        textVariables: input.textVariables,
        previewText: input.previewText,
        mediaPreview: input.mediaPreview
      }),
      JSON.stringify(input.fieldMapping || {}),
      counts.totalCount,
      counts.pendingCount,
      principal?.user?.email || principal?.user?.displayName || "",
      now
    ),
    ...recipientRows.map((recipient) => env.DB.prepare(`INSERT INTO campaign_recipients
        (recipient_id,campaign_id,workspace_id,contact_id,conversation_id,message_id,display_name,profile_id,
         row_json,status,error,created_at,updated_at)
      VALUES (?1,?2,?3,?4,'','',?5,?6,?7,'pending','',?8,?8)`).bind(
      recipient.recipientId,
      campaignId,
      workspaceId,
      recipient.contactId,
      recipient.displayName,
      recipient.profileId,
      recipient.rowJson,
      now
    ))
  ]);
  await audit(env, principal, "create", "campaign", campaignId, {
    channelId: channel.channelId,
    totalCount: counts.totalCount,
    messageType: input.messageType
  });
  const item = (await getCampaignDetail(env, workspaceId, campaignId, principal)).item;
  return { ok: true, campaignId, item };
}
__name(createCampaign, "createCampaign");
function mapUploadRecipient(row, fieldMapping, index) {
  if (!isPlainObject(fieldMapping)) throw httpError(400, "Upload campaigns require a field mapping.");
  const readMapped = /* @__PURE__ */ __name((key) => {
    const header = String(fieldMapping[key] || "").trim();
    if (!header || header === "__skip") return "";
    return String(row?.[header] ?? "").trim();
  }, "readMapped");
  const profileId = readMapped("profileId");
  if (!profileId) throw httpError(400, `Recipient ${index + 1} is missing a messaging ID / phone value.`);
  const displayName = readMapped("displayName") || profileId;
  const company = readMapped("company");
  const tagsRaw = readMapped("tags");
  const tags = tagsRaw ? tagsRaw.split(/[,;|]/).map((item) => item.trim()).filter(Boolean).slice(0, 20) : [];
  return { displayName: displayName.slice(0, 120), profileId: profileId.slice(0, 512), company: company.slice(0, 160), tags };
}
__name(mapUploadRecipient, "mapUploadRecipient");
async function uploadCampaignTemplateMedia(env, workspaceId, request, principal) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw httpError(415, "Content-Type must be multipart/form-data.");
  }
  let form;
  try {
    form = await request.formData();
  } catch {
    throw httpError(400, "Multipart media data is invalid.");
  }
  const channelId = cleanId(form.get("channelId"), "Channel ID");
  const channel = await getChannel(env, channelId, "whatsapp_cloud", workspaceId);
  if (!channel) throw httpError(404, "WhatsApp channel not found.");
  assertPrincipalChannelAccess(principal, channelId);
  const file = form.get("file");
  if (!file || typeof file !== "object" || typeof file.arrayBuffer !== "function") {
    throw httpError(400, "A file field is required.");
  }
  const mediaType = String(form.get("type") || "").toLowerCase();
  const attachment = validateWhatsAppAttachment(file, "", "whatsapp_cloud");
  if (mediaType && mediaType !== attachment.type) {
    throw httpError(400, `Expected a ${mediaType} file for this template header.`);
  }
  const mediaId = await uploadWhatsAppMedia(env, channel, file, attachment);
  return {
    ok: true,
    mediaId,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.size,
    type: attachment.type
  };
}
__name(uploadCampaignTemplateMedia, "uploadCampaignTemplateMedia");
async function processCampaign(env, workspaceId, campaignId, principal) {
  const detail = await getCampaignDetail(env, workspaceId, campaignId, principal);
  const campaign = detail.item;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(`UPDATE campaigns SET status='sending',updated_at=?3
    WHERE workspace_id=?1 AND campaign_id=?2`).bind(workspaceId, campaignId, now).run();
  await broadcast(env, workspaceId, { type: "campaign.updated", campaignId, campaign: { ...campaign, status: "sending" } });
  const channel = await getChannel(env, campaign.channelId, "", workspaceId);
  if (!channel) {
    await failRemainingCampaignRecipients(env, workspaceId, campaignId, "Channel is no longer available.");
    return finalizeCampaign(env, workspaceId, campaignId, principal);
  }
  const platform = platformForChannel(channel);
  const mappingPayload = campaign.variableMapping || {};
  const variableMappings = Array.isArray(mappingPayload.variableMappings) ? mappingPayload.variableMappings : [];
  const textVariables = Array.isArray(mappingPayload.textVariables) ? mappingPayload.textVariables : [];
  const previewTextBase = String(mappingPayload.previewText || "");
  const mediaPreview = mappingPayload.mediaPreview || null;
  for (const recipient of detail.recipients) {
    if (recipient.status !== "pending" && recipient.status !== "queued") continue;
    try {
      const prepared = await prepareCampaignRecipientTarget(env, workspaceId, channel, platform, campaign, recipient, principal);
      const context = {
        contact: prepared.contact,
        row: recipient.row || {},
        profileId: prepared.profileId
      };
      let sendResult;
      if (campaign.messageType === "template") {
        const components = buildTemplateComponentsFromMappings(variableMappings, context);
        const template = validateWhatsAppTemplate({
          name: campaign.templateName,
          language: { code: campaign.templateLanguage },
          ...components.length ? { components } : {}
        });
        const previewText = previewTextBase || applyTextVariables(campaign.messageBody || campaign.templateName, textVariables, context);
        sendResult = await createConversationTemplateMessage(env, workspaceId, prepared.conversationId, {
          name: template.name,
          language: template.language,
          components: template.components,
          previewText,
          ...mediaPreview ? { mediaPreview } : {},
          channelId: channel.channelId,
          identityId: prepared.identityId
        }, principal);
      } else {
        const text = applyTextVariables(campaign.messageBody, textVariables, context);
        if (!String(text || "").trim()) throw httpError(400, "Resolved message text is empty.");
        sendResult = await createOutboundMessage(env, workspaceId, prepared.conversationId, {
          text,
          channelId: channel.channelId,
          identityId: prepared.identityId
        }, principal);
      }
      const message = sendResult.message;
      const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      await env.DB.prepare(`UPDATE campaign_recipients
          SET contact_id=?4,conversation_id=?5,message_id=?6,display_name=?7,profile_id=?8,
              status='queued',error='',updated_at=?9
        WHERE workspace_id=?1 AND campaign_id=?2 AND recipient_id=?3`).bind(
        workspaceId,
        campaignId,
        recipient.recipientId,
        prepared.contactId,
        prepared.conversationId,
        message.messageId,
        prepared.contact.displayName || recipient.displayName || "",
        prepared.profileId,
        updatedAt
      ).run();
      await broadcast(env, workspaceId, {
        type: "message.created",
        conversationId: prepared.conversationId,
        messageId: message.messageId,
        message,
        conversation: await getConversationItem(env, workspaceId, prepared.conversationId)
      });
      await sendOrQueue(env, message.messageId);
    } catch (error) {
      const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      await env.DB.prepare(`UPDATE campaign_recipients
          SET status='failed',error=?4,updated_at=?5
        WHERE workspace_id=?1 AND campaign_id=?2 AND recipient_id=?3`).bind(workspaceId, campaignId, recipient.recipientId, cleanError(error), updatedAt).run();
    }
  }
  return finalizeCampaign(env, workspaceId, campaignId, principal);
}
__name(processCampaign, "processCampaign");
async function prepareCampaignRecipientTarget(env, workspaceId, channel, platform, campaign, recipient, principal) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (campaign.audienceSource === "contacts") {
    const contactId2 = cleanId(recipient.contactId, "Contact ID");
    const contact2 = await getContactDetail(env, workspaceId, contactId2);
    const identity2 = pickCampaignIdentity(contact2, platform, channel.channelId);
    if (!identity2) throw httpError(409, "This contact has no matching identity for the selected channel.");
    let binding = (identity2.bindings || []).find((item) => item.channelId === channel.channelId && item.active !== false);
    if (!binding) {
      await ensureIdentityBinding(env, workspaceId, contactId2, identity2.identityId, {
        platform,
        profileId: identity2.profileId,
        channelId: channel.channelId,
        scopedProfileId: identity2.profileId,
        displayName: contact2.displayName || identity2.displayName || "",
        metadata: {}
      }, now);
    }
    const conversationId2 = await ensureIdentityConversation(
      env,
      workspaceId,
      contactId2,
      identity2.identityId,
      channel.channelId,
      principal?.user?.email || "",
      "closed"
    );
    return {
      contactId: contactId2,
      identityId: identity2.identityId,
      conversationId: conversationId2,
      profileId: identity2.profileId || "",
      contact: {
        displayName: contact2.displayName || "",
        company: contact2.company || "",
        tags: contact2.tags || [],
        profileId: identity2.profileId || ""
      }
    };
  }
  const mapped = recipient.row?.__mapped || mapUploadRecipient(recipient.row || {}, campaign.fieldMapping, 0);
  const profileId = normalizeIdentityProfileValue(platform, mapped.profileId || recipient.profileId, "Messaging ID");
  const displayName = String(mapped.displayName || recipient.displayName || profileId).slice(0, 120);
  const company = String(mapped.company || "").slice(0, 160);
  const tags = Array.isArray(mapped.tags) ? mapped.tags : [];
  let identity = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id,ci.display_name,c.display_name AS contact_name,
      c.company,c.tags_json
    FROM contact_identities ci
    JOIN contacts c ON c.contact_id=ci.contact_id AND c.workspace_id=ci.workspace_id
    WHERE ci.workspace_id=?1 AND ci.platform=?2 AND ci.profile_id=?3
    ORDER BY ci.created_at,ci.identity_id LIMIT 1`).bind(workspaceId, platform, profileId).first();
  let contactId;
  let identityId;
  if (identity) {
    contactId = identity.contact_id;
    identityId = identity.identity_id;
    await ensureIdentityBinding(env, workspaceId, contactId, identityId, {
      platform,
      profileId,
      channelId: channel.channelId,
      scopedProfileId: profileId,
      displayName,
      metadata: {}
    }, now);
  } else {
    contactId = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO contacts
        (contact_id,display_name,company,tags_json,created_at,updated_at,workspace_id)
      VALUES (?1,?2,?3,?4,?5,?5,?6)`).bind(contactId, displayName, company, JSON.stringify(tags), now, workspaceId).run();
    const created = await ensureContactIdentity(env, workspaceId, contactId, {
      platform,
      profileId,
      channelId: channel.channelId,
      scopedProfileId: profileId,
      phoneNumber: platform === "whatsapp" ? profileId : "",
      displayName,
      isPrimary: true
    }, now);
    identityId = created.identityId;
    await broadcast(env, workspaceId, {
      type: "contact.created",
      contactId,
      contact: await getContactDetail(env, workspaceId, contactId)
    });
  }
  const conversationId = await ensureIdentityConversation(
    env,
    workspaceId,
    contactId,
    identityId,
    channel.channelId,
    "",
    "closed"
  );
  const contact = await getContactDetail(env, workspaceId, contactId);
  return {
    contactId,
    identityId,
    conversationId,
    profileId,
    contact: {
      displayName: contact.displayName || displayName,
      company: contact.company || company,
      tags: contact.tags || tags,
      profileId
    }
  };
}
__name(prepareCampaignRecipientTarget, "prepareCampaignRecipientTarget");
function pickCampaignIdentity(contact, platform, channelId) {
  const identities = Array.isArray(contact?.identities) ? contact.identities : [];
  const matching = identities.filter((identity) => String(identity.platform || "") === platform);
  if (!matching.length) return null;
  const bound = matching.find((identity) => (identity.bindings || []).some((binding) => binding.channelId === channelId));
  return bound || matching[0];
}
__name(pickCampaignIdentity, "pickCampaignIdentity");
async function failRemainingCampaignRecipients(env, workspaceId, campaignId, error) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(`UPDATE campaign_recipients SET status='failed',error=?4,updated_at=?3
    WHERE workspace_id=?1 AND campaign_id=?2 AND status IN ('pending','queued')`).bind(workspaceId, campaignId, now, String(error || "Campaign failed").slice(0, 500)).run();
}
__name(failRemainingCampaignRecipients, "failRemainingCampaignRecipients");
async function finalizeCampaign(env, workspaceId, campaignId, principal) {
  const detail = await getCampaignDetail(env, workspaceId, campaignId, principal);
  const counts = campaignCountsFromRows(detail.recipients);
  const status = campaignFinalStatus(counts);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(`UPDATE campaigns SET
      status=?3,total_count=?4,pending_count=?5,sent_count=?6,delivered_count=?7,read_count=?8,failed_count=?9,
      updated_at=?10,completed_at=CASE WHEN ?3 IN ('completed','completed_with_errors','failed','cancelled') THEN ?10 ELSE completed_at END
    WHERE workspace_id=?1 AND campaign_id=?2`).bind(
    workspaceId,
    campaignId,
    status,
    counts.totalCount,
    counts.pendingCount,
    counts.sentCount,
    counts.deliveredCount,
    counts.readCount,
    counts.failedCount,
    now
  ).run();
  const item = (await getCampaignDetail(env, workspaceId, campaignId, principal)).item;
  await broadcast(env, workspaceId, { type: "campaign.updated", campaignId, campaign: item });
  return item;
}
__name(finalizeCampaign, "finalizeCampaign");
async function syncCampaignRecipientStatus(env, workspaceId, messageId, status, error = "") {
  if (!messageId) return null;
  let recipient;
  try {
    recipient = await env.DB.prepare(`SELECT recipient_id,campaign_id,status FROM campaign_recipients
      WHERE workspace_id=?1 AND message_id=?2 LIMIT 1`).bind(workspaceId, messageId).first();
  } catch (queryError) {
    if (/no such table:\s*campaign_recipients/i.test(String(queryError?.message || queryError))) return null;
    throw queryError;
  }
  if (!recipient) return null;
  const nextStatus = preferCampaignRecipientStatus(recipient.status, status);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(`UPDATE campaign_recipients SET status=?4,error=?5,updated_at=?6
    WHERE workspace_id=?1 AND recipient_id=?2 AND campaign_id=?3`).bind(
    workspaceId,
    recipient.recipient_id,
    recipient.campaign_id,
    nextStatus,
    nextStatus === "failed" ? String(error || "").slice(0, 500) : "",
    now
  ).run();
  const rows = await env.DB.prepare(`SELECT status FROM campaign_recipients
    WHERE workspace_id=?1 AND campaign_id=?2`).bind(workspaceId, recipient.campaign_id).all();
  const counts = campaignCountsFromRows(rows.results || []);
  const finalStatus = campaignFinalStatus(counts);
  await env.DB.prepare(`UPDATE campaigns SET
      status=CASE
        WHEN status IN ('queued','sending') AND ?3 IN ('completed','completed_with_errors','failed') THEN ?3
        WHEN status IN ('queued','sending') THEN status
        ELSE ?3
      END,
      total_count=?4,pending_count=?5,sent_count=?6,delivered_count=?7,read_count=?8,failed_count=?9,
      updated_at=?10,
      completed_at=CASE
        WHEN ?3 IN ('completed','completed_with_errors','failed') AND completed_at='' THEN ?10
        ELSE completed_at
      END
    WHERE workspace_id=?1 AND campaign_id=?2`).bind(
    workspaceId,
    recipient.campaign_id,
    finalStatus,
    counts.totalCount,
    counts.pendingCount,
    counts.sentCount,
    counts.deliveredCount,
    counts.readCount,
    counts.failedCount,
    now
  ).run();
  const campaign = await env.DB.prepare(`SELECT c.*, ch.name AS channel_name, ch.connector_type, ch.provider_type
    FROM campaigns c
    LEFT JOIN channels ch ON ch.workspace_id=c.workspace_id AND ch.channel_id=c.channel_id
    WHERE c.workspace_id=?1 AND c.campaign_id=?2`).bind(workspaceId, recipient.campaign_id).first();
  if (campaign) {
    await broadcast(env, workspaceId, {
      type: "campaign.updated",
      campaignId: recipient.campaign_id,
      campaign: serializeCampaign(campaign, counts)
    });
  }
  return recipient.campaign_id;
}
__name(syncCampaignRecipientStatus, "syncCampaignRecipientStatus");
async function importChatHistory(env, workspaceId, principal, payload) {
  if (!isPlainObject(payload)) throw httpError(400, "Import payload must be a JSON object.");
  rejectUnknownKeys(payload, /* @__PURE__ */ new Set(["source", "channelId", "conversations", "fieldMapping"]), "import request");
  const source = String(payload.source || "").trim().toLowerCase();
  if (source !== INTERAKT_SOURCE) {
    throw httpError(400, "Unsupported import source. Choose Interakt for now.");
  }
  const fieldMapping = normalizeFieldMapping(payload.fieldMapping);
  if (!fieldMapping.phone) throw httpError(400, "Map a phone field before importing.");
  const channelId = cleanId(payload.channelId, "Channel ID");
  const channel = await getChannel(env, channelId, "", workspaceId);
  if (!channel) throw httpError(404, "Channel not found.");
  if (channel.connectorType !== "whatsapp_cloud") {
    throw httpError(400, "Interakt imports require a WhatsApp Cloud channel.");
  }
  assertPrincipalChannelAccess(principal, channelId);
  await assertChannelReadyForConversation(env, workspaceId, channel);
  const conversations = validateInteraktBatch(payload.conversations);
  const summary = {
    source: INTERAKT_SOURCE,
    channelId,
    fieldMapping,
    contactsCreated: 0,
    contactsReused: 0,
    conversationsCreated: 0,
    conversationsReused: 0,
    messagesImported: 0,
    messagesUpdated: 0,
    messagesSkipped: 0,
    failed: []
  };
  for (const conversation of conversations) {
    try {
      const result = await importInteraktConversation(env, workspaceId, channel, conversation, fieldMapping);
      summary.contactsCreated += result.contactsCreated;
      summary.contactsReused += result.contactsReused;
      summary.conversationsCreated += result.conversationsCreated;
      summary.conversationsReused += result.conversationsReused;
      summary.messagesImported += result.messagesImported;
      summary.messagesUpdated += result.messagesUpdated;
      summary.messagesSkipped += result.messagesSkipped;
    } catch (error) {
      const customer = extractInteraktCustomer(conversation, fieldMapping);
      summary.failed.push({
        externalId: customer.externalId || "",
        phone: customer.phone || "",
        error: cleanError(error)
      });
      if (summary.failed.length >= 25) break;
    }
  }
  await audit(env, principal, "import_chat", "channel", channelId, {
    source: INTERAKT_SOURCE,
    conversations: conversations.length,
    fieldMapping,
    messagesImported: summary.messagesImported,
    messagesUpdated: summary.messagesUpdated,
    messagesSkipped: summary.messagesSkipped,
    failed: summary.failed.length
  });
  return { ok: true, ...summary };
}
__name(importChatHistory, "importChatHistory");
async function findExistingInteraktMessage(env, workspaceId, channelId, mapped) {
  if (mapped.providerMessageId) {
    const byProvider = await env.DB.prepare(`SELECT message_id, message_type, text, payload_json, error, status,
        provider_message_id, sender_login, sender_name
      FROM messages
      WHERE workspace_id=?1 AND channel_id=?2 AND provider_message_id=?3
      LIMIT 1`).bind(workspaceId, channelId, mapped.providerMessageId).first();
    if (byProvider) return byProvider;
  }
  if (mapped.externalId) {
    return env.DB.prepare(`SELECT message_id, message_type, text, payload_json, error, status,
        provider_message_id, sender_login, sender_name
      FROM messages
      WHERE workspace_id=?1 AND channel_id=?2
        AND json_extract(payload_json, '$.source') = ?3
        AND json_extract(payload_json, '$.externalId') = ?4
      LIMIT 1`).bind(workspaceId, channelId, INTERAKT_SOURCE, mapped.externalId).first();
  }
  return null;
}
__name(findExistingInteraktMessage, "findExistingInteraktMessage");
async function importInteraktConversation(env, workspaceId, channel, conversation, fieldMapping) {
  const customer = extractInteraktCustomer(conversation, fieldMapping);
  if (!customer.phone) throw httpError(400, "Conversation is missing a WhatsApp phone number.");
  let profileId;
  try {
    profileId = normalizeWhatsAppRecipient(customer.phone);
  } catch (error) {
    throw httpError(400, error.message || "Invalid WhatsApp phone number.");
  }
  const displayName = String(customer.displayName || profileId).slice(0, 120);
  const company = String(customer.company || "").slice(0, 160);
  const tags = Array.isArray(customer.tags) ? customer.tags.slice(0, 20) : [];
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const result = {
    contactsCreated: 0,
    contactsReused: 0,
    conversationsCreated: 0,
    conversationsReused: 0,
    messagesImported: 0,
    messagesUpdated: 0,
    messagesSkipped: 0
  };
  let identity = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id,c.display_name AS contact_display_name,
      c.company AS contact_company,c.tags_json AS contact_tags_json
    FROM channel_identity_bindings b
    JOIN contact_identities ci ON ci.identity_id=b.identity_id AND ci.workspace_id=b.workspace_id
    JOIN contacts c ON c.contact_id=ci.contact_id AND c.workspace_id=ci.workspace_id
    WHERE b.workspace_id=?1 AND b.channel_id=?2 AND b.scoped_profile_id=?3 AND b.active=1 LIMIT 1`).bind(workspaceId, channel.channelId, profileId).first();
  if (!identity) {
    identity = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id,c.display_name AS contact_display_name,
        c.company AS contact_company,c.tags_json AS contact_tags_json
      FROM contact_identities ci
      JOIN contacts c ON c.contact_id=ci.contact_id AND c.workspace_id=ci.workspace_id
      WHERE ci.workspace_id=?1 AND ci.platform='whatsapp' AND ci.profile_id=?2
      ORDER BY ci.created_at,ci.identity_id LIMIT 1`).bind(workspaceId, profileId).first();
    if (identity) {
      await ensureIdentityBinding(env, workspaceId, identity.contact_id, identity.identity_id, {
        platform: "whatsapp",
        profileId,
        scopedProfileId: profileId,
        channelId: channel.channelId,
        phoneNumber: profileId,
        displayName: identity.contact_display_name || displayName,
        metadata: {}
      }, now);
      result.contactsReused += 1;
    }
  } else {
    result.contactsReused += 1;
  }
  if (!identity) {
    const contactId = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO contacts
        (contact_id,display_name,company,tags_json,created_at,updated_at,workspace_id)
      VALUES (?1,?2,?3,?4,?5,?5,?6)`).bind(contactId, displayName, company, JSON.stringify(tags), now, workspaceId).run();
    const created = await ensureContactIdentity(env, workspaceId, contactId, {
      platform: "whatsapp",
      profileId,
      channelId: channel.channelId,
      scopedProfileId: profileId,
      phoneNumber: profileId,
      displayName,
      isPrimary: true
    }, now);
    identity = { identity_id: created.identityId, contact_id: contactId, contact_display_name: displayName };
    result.contactsCreated += 1;
  } else {
    const nextName = displayName && displayName !== profileId && (!identity.contact_display_name || identity.contact_display_name === profileId) ? displayName : identity.contact_display_name || displayName;
    const nextCompany = company && !String(identity.contact_company || "").trim() ? company : String(identity.contact_company || "");
    const existingTags = storedContactTags(identity.contact_tags_json);
    const nextTags = tags.length && !existingTags.length ? tags : existingTags;
    await env.DB.prepare(`UPDATE contacts SET display_name=?3,company=?4,tags_json=?5,updated_at=?6
      WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, identity.contact_id, nextName, nextCompany, JSON.stringify(nextTags), now).run();
  }
  const existingConversation = await env.DB.prepare(`SELECT conversation_id FROM conversations
    WHERE workspace_id=?1 AND contact_id=?2 LIMIT 1`).bind(workspaceId, identity.contact_id).first();
  const conversationId = await ensureIdentityConversation(
    env,
    workspaceId,
    identity.contact_id,
    identity.identity_id,
    channel.channelId,
    ""
  );
  if (existingConversation) result.conversationsReused += 1;
  else result.conversationsCreated += 1;
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  if (messages.length > 500) throw httpError(400, "Send at most 500 messages per conversation batch.");
  let latestTimestamp = "";
  const pendingStatements = [];
  const flush = /* @__PURE__ */ __name(async () => {
    if (!pendingStatements.length) return;
    await env.DB.batch(pendingStatements.splice(0, pendingStatements.length));
  }, "flush");
  for (const rawMessage of messages) {
    const mapped = mapInteraktMessage(rawMessage);
    if (!mapped.providerMessageId && !mapped.text && !mapped.mediaUrl) {
      result.messagesSkipped += 1;
      continue;
    }
    const timestamp = normalizeTimestamp(mapped.timestamp, now);
    if (!latestTimestamp || timestamp > latestTimestamp) latestTimestamp = timestamp;
    const attachmentType = ["image", "video", "audio", "document"].includes(mapped.attachmentType) ? mapped.attachmentType : ["image", "video", "audio", "document"].includes(mapped.messageType) ? mapped.messageType : "";
    const importSender = mapped.direction === "outbound" ? importSourceSenderAttribution(INTERAKT_SOURCE) : { login: "", name: "" };
    const importedStatusHistory = normalizeStoredStatusHistory(mapped.statusHistory);
    const payload = {
      source: INTERAKT_SOURCE,
      externalId: mapped.externalId,
      contentType: mapped.contentType,
      ...importSender.name ? { senderName: importSender.name } : {},
      ...mapped.template ? { template: mapped.template } : {},
      ...mapped.replyTo ? { reply: { channelMessageId: mapped.replyTo } } : {},
      ...importedStatusHistory ? { statusHistory: importedStatusHistory } : {},
      ...mapped.mediaUrl && attachmentType ? {
        attachment: {
          type: attachmentType,
          filename: mapped.mediaFileName || "",
          externalUrl: mapped.mediaUrl
        }
      } : {}
    };
    const text = String(mapped.text || "").slice(0, MAX_TEXT_LENGTH);
    const existing = await findExistingInteraktMessage(env, workspaceId, channel.channelId, mapped);
    if (existing) {
      const existingParsed = safeJsonParse(existing.payload_json, {});
      const existingPayload = String(existing.payload_json || "");
      const refreshAttachment = Boolean(payload.attachment) && !/"attachment"\s*:/.test(existingPayload);
      const shouldRefreshTemplate = mapped.messageType === "template" && (existing.message_type === "template" || existingPayload.includes('"interakt"')) && text && (text !== String(existing.text || "") || refreshAttachment);
      const errorText = String(mapped.error || "").slice(0, 500);
      const shouldRefreshError = Boolean(errorText) && errorText !== String(existing.error || "");
      const shouldRefreshProviderId = Boolean(mapped.providerMessageId) && mapped.providerMessageId !== String(existing.provider_message_id || "");
      const statusHistoryMerge = mergeImportedStatusHistory(existingParsed, mapped.statusHistory);
      const shouldRefreshStatusHistory = statusHistoryMerge.changed;
      const shouldRefreshSender = Boolean(importSender.login && importSender.name) && (String(existing.sender_login || "").trim() !== importSender.login || String(existing.sender_name || "").trim() !== importSender.name);
      if (shouldRefreshTemplate || shouldRefreshError || shouldRefreshProviderId || shouldRefreshStatusHistory || shouldRefreshSender) {
        const nextPayload = { ...payload };
        if (statusHistoryMerge.merged) nextPayload.statusHistory = statusHistoryMerge.merged;
        else delete nextPayload.statusHistory;
        if (isPlainObject(existingParsed.attachment) && !nextPayload.attachment) {
          nextPayload.attachment = existingParsed.attachment;
        }
        if (isPlainObject(existingParsed.reply) && !nextPayload.reply) {
          nextPayload.reply = existingParsed.reply;
        }
        pendingStatements.push(env.DB.prepare(`UPDATE messages
            SET message_type=?2, text=?3, payload_json=?4, status=?5, error=?6,
                provider_message_id=CASE
                  WHEN ?8<>'' THEN ?8
                  ELSE provider_message_id
                END,
                sender_login=CASE WHEN ?9<>'' THEN ?9 ELSE sender_login END,
                sender_name=CASE WHEN ?10<>'' THEN ?10 ELSE sender_name END
          WHERE workspace_id=?7 AND message_id=?1`).bind(
          existing.message_id,
          mapped.messageType,
          text,
          truncateJson(nextPayload),
          mapped.status,
          errorText,
          workspaceId,
          mapped.providerMessageId || "",
          importSender.login,
          importSender.name
        ));
        result.messagesUpdated += 1;
        if (pendingStatements.length >= 40) await flush();
        continue;
      }
      result.messagesSkipped += 1;
      continue;
    }
    const messageId = crypto.randomUUID();
    pendingStatements.push(env.DB.prepare(`INSERT INTO messages
        (message_id,conversation_id,contact_id,channel_id,identity_id,direction,message_type,text,
         provider_message_id,status,error,timestamp,payload_json,workspace_id,sender_login,sender_name)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)`).bind(
      messageId,
      conversationId,
      identity.contact_id,
      channel.channelId,
      identity.identity_id,
      mapped.direction,
      mapped.messageType,
      text,
      mapped.providerMessageId,
      mapped.status,
      String(mapped.error || "").slice(0, 500),
      timestamp,
      truncateJson(payload),
      workspaceId,
      importSender.login,
      importSender.name
    ));
    result.messagesImported += 1;
    if (pendingStatements.length >= 40) await flush();
  }
  await flush();
  if (latestTimestamp || customer.status) {
    await env.DB.prepare(`UPDATE conversations SET
        status=CASE WHEN ?4<>'' THEN ?4 ELSE status END,
        channel_id=?3,identity_id=?5,
        last_message_at=CASE
          WHEN ?6<>'' AND (last_message_at='' OR last_message_at < ?6) THEN ?6
          ELSE last_message_at
        END,
        unread_count=0,updated_at=?7
      WHERE conversation_id=?1 AND workspace_id=?2`).bind(
      conversationId,
      workspaceId,
      channel.channelId,
      customer.status || "",
      identity.identity_id,
      latestTimestamp,
      now
    ).run();
  }
  if (latestTimestamp) {
    await touchIdentityBinding(
      env,
      workspaceId,
      identity.identity_id,
      channel.channelId,
      "",
      conversationId,
      latestTimestamp
    );
  }
  return result;
}
__name(importInteraktConversation, "importInteraktConversation");
function normalizeWhatsApp(payload) {
  const messages = [];
  const statuses = [];
  const phoneNumberIds = /* @__PURE__ */ new Set();
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      if (value.metadata?.phone_number_id) phoneNumberIds.add(String(value.metadata.phone_number_id));
      const contacts = value.contacts || [];
      for (const message of value.messages || []) {
        const contact = contacts.find((item) => String(item.wa_id) === String(message.from)) || {};
        const text = whatsappInboundText(message);
        const attachment = whatsappInboundAttachment(message);
        const reply = whatsappInboundReply(message);
        messages.push({
          channelProfileId: String(message.from || ""),
          displayName: contact.profile?.name || String(message.from || ""),
          text,
          providerMessageId: String(message.id || ""),
          timestamp: message.timestamp ? new Date(Number(message.timestamp) * 1e3).toISOString() : "",
          messageType: attachment?.type || String(message.type || "text"),
          ...attachment ? { attachment } : {},
          ...reply ? { reply } : {}
        });
      }
      for (const status of value.statuses || []) {
        statuses.push({
          providerMessageId: String(status.id || ""),
          status: String(status.status || ""),
          timestamp: status.timestamp ? new Date(Number(status.timestamp) * 1e3).toISOString() : "",
          error: status.errors?.[0]?.title || status.errors?.[0]?.message || "",
          internalMessageId: String(status.biz_opaque_callback_data || "")
        });
      }
    }
  }
  return {
    messages: messages.filter((item) => item.channelProfileId),
    statuses: statuses.filter((item) => item.providerMessageId || item.internalMessageId),
    phoneNumberIds: [...phoneNumberIds]
  };
}
__name(normalizeWhatsApp, "normalizeWhatsApp");
function whatsappInboundText(message) {
  const type = String(message?.type || "message").toLowerCase();
  if (type === "unsupported") return whatsappInboundUnsupportedText(message);
  const direct = message?.text?.body || message?.button?.text || message?.interactive?.button_reply?.title || message?.interactive?.list_reply?.title;
  if (direct) return String(direct);
  const caption = message?.image?.caption || message?.video?.caption || message?.document?.caption;
  if (caption) return String(caption);
  if (["image", "video", "audio", "document", "sticker"].includes(type)) {
    return "";
  }
  return `[WhatsApp ${type.replace(/_/g, " ")} received]`;
}
__name(whatsappInboundText, "whatsappInboundText");
function whatsappInboundUnsupportedText(message) {
  const primary = Array.isArray(message?.errors) ? message.errors[0] : null;
  const code = Number(primary?.code || 0);
  const detail = String(primary?.error_data?.details || primary?.title || primary?.message || "").trim();
  const codeLabel = code ? ` Meta error ${code}.` : "";
  const detailLabel = detail && !/^message type unknown$/i.test(detail) ? ` ${detail}` : "";
  return `Unsupported WhatsApp message \u2014 original content was not delivered.${codeLabel}${detailLabel} This often happens when another WhatsApp Business API number messages this Cloud API number.`;
}
__name(whatsappInboundUnsupportedText, "whatsappInboundUnsupportedText");
function whatsappInboundAttachment(message) {
  const providerType = String(message?.type || "").toLowerCase();
  const type = providerType === "sticker" ? "image" : providerType;
  if (!["image", "video", "audio", "document"].includes(type)) return null;
  const media = message?.[providerType];
  if (!media?.id) return null;
  const mimeType = String(media.mime_type || "");
  const extension = mimeType.split("/")[1]?.split(";")[0] || "bin";
  return {
    type,
    filename: String(media.filename || `${type}-${String(message.id || "attachment").slice(-12)}.${extension}`).slice(0, 240),
    mimeType: mimeType.slice(0, 160),
    size: Number(media.file_size || 0),
    caption: String(media.caption || message?.caption || "").slice(0, MAX_ATTACHMENT_CAPTION_LENGTH),
    providerMediaId: String(media.id)
  };
}
__name(whatsappInboundAttachment, "whatsappInboundAttachment");
function whatsappInboundReply(message) {
  const channelMessageId = String(message?.context?.id || "").trim();
  return channelMessageId ? { channelMessageId } : null;
}
__name(whatsappInboundReply, "whatsappInboundReply");
function normalizeWhatsAppRecipient(value) {
  const input = String(value || "").trim();
  if (!input || !/^[+\d\s().-]+$/.test(input)) {
    const error = httpError(400, "Enter a WhatsApp number with country code.");
    error.retryable = false;
    throw error;
  }
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    const error = httpError(400, "Enter a valid WhatsApp number with country code (8 to 15 digits).");
    error.retryable = false;
    throw error;
  }
  return digits;
}
__name(normalizeWhatsAppRecipient, "normalizeWhatsAppRecipient");
function isRetryableWhatsAppStatus(status) {
  const code = Number(status);
  return code === 408 || code === 429 || code >= 500;
}
__name(isRetryableWhatsAppStatus, "isRetryableWhatsAppStatus");
function normalizeGeneric(payload, mapping = {}) {
  const rawEvents = mapping.eventsPath ? getPath(payload, mapping.eventsPath) : [payload];
  const events = Array.isArray(rawEvents) ? rawEvents : rawEvents ? [rawEvents] : [];
  return events.map((event) => {
    const text = getPath(event, mapping.textPath || "text") || "";
    const receiptStatus = normalizeDeliveryStatus(getPath(event, mapping.statusPath || "status"));
    if (receiptStatus && !text) return null;
    return {
      channelProfileId: getPath(event, mapping.senderIdPath || "from"),
      displayName: getPath(event, mapping.senderNamePath || "senderName") || "",
      text,
      providerMessageId: getPath(event, mapping.messageIdPath || "id") || "",
      timestamp: getPath(event, mapping.timestampPath || "timestamp") || "",
      messageType: getPath(event, mapping.messageTypePath || "type") || "text"
    };
  }).filter((item) => item?.channelProfileId);
}
__name(normalizeGeneric, "normalizeGeneric");
function normalizeGenericStatuses(payload, mapping = {}) {
  const rawEvents = mapping.statusEventsPath ? getPath(payload, mapping.statusEventsPath) : mapping.eventsPath ? getPath(payload, mapping.eventsPath) : [payload];
  const events = Array.isArray(rawEvents) ? rawEvents : rawEvents ? [rawEvents] : [];
  return events.map((event) => ({
    providerMessageId: getPath(event, mapping.statusMessageIdPath || mapping.messageIdPath || "id") || "",
    internalMessageId: getPath(event, mapping.internalMessageIdPath || "messageId") || "",
    status: normalizeDeliveryStatus(getPath(event, mapping.statusPath || "status")),
    timestamp: getPath(event, mapping.statusTimestampPath || mapping.timestampPath || "timestamp") || "",
    error: getPath(event, mapping.statusErrorPath || "error") || ""
  })).filter((item) => item.status && (item.providerMessageId || item.internalMessageId));
}
__name(normalizeGenericStatuses, "normalizeGenericStatuses");
function normalizeTelegram(payload) {
  const message = payload?.message || payload?.edited_message || payload?.channel_post || null;
  if (!message?.chat?.id) return null;
  const name = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || message.chat.title || String(message.chat.id);
  const attachment = telegramInboundAttachment(message);
  const reply = telegramInboundReply(message.reply_to_message);
  return {
    channelProfileId: String(message.chat.id),
    displayName: name,
    text: message.text || message.caption || "",
    providerMessageId: String(message.message_id || ""),
    dedupeKey: payload.update_id !== void 0 && payload.update_id !== null ? `update:${payload.update_id}` : `chat:${message.chat.id}:message:${message.message_id || ""}`,
    timestamp: message.date ? new Date(Number(message.date) * 1e3).toISOString() : "",
    messageType: message.text ? "text" : attachment?.type || "message",
    ...attachment ? { attachment } : {},
    ...reply ? { reply } : {}
  };
}
__name(normalizeTelegram, "normalizeTelegram");
function telegramInboundReply(message) {
  if (!message?.message_id) return null;
  const attachment = telegramInboundAttachment(message);
  return {
    channelMessageId: String(message.message_id),
    direction: message.from?.is_bot ? "outbound" : "inbound",
    text: String(message.text || message.caption || "").slice(0, 1e3),
    messageType: message.text ? "text" : attachment?.type || "message",
    ...attachment?.type ? { attachment: { type: attachment.type, filename: attachment.filename || "" } } : {}
  };
}
__name(telegramInboundReply, "telegramInboundReply");
function telegramInboundAttachment(message) {
  let media = null;
  let type = "";
  if (Array.isArray(message?.photo) && message.photo.length) {
    media = message.photo.reduce((largest, item) => Number(item.file_size || 0) >= Number(largest?.file_size || 0) ? item : largest, null);
    type = "image";
  } else if (message?.video) {
    media = message.video;
    type = "video";
  } else if (message?.audio || message?.voice) {
    media = message.audio || message.voice;
    type = "audio";
  } else if (message?.document) {
    media = message.document;
    type = "document";
  } else if (message?.animation) {
    media = message.animation;
    type = "video";
  } else if (message?.video_note) {
    media = message.video_note;
    type = "video";
  } else if (message?.sticker) {
    media = message.sticker;
    type = String(media.mime_type || "").toLowerCase() === "video/webm" ? "video" : "image";
  }
  if (!media?.file_id || !type) return null;
  const mimeType = String(media.mime_type || (type === "image" ? "image/jpeg" : ""));
  const extension = mimeType.split("/")[1]?.split(";")[0] || "bin";
  return {
    type,
    filename: String(media.file_name || `${type}-${String(message.message_id || "attachment")}.${extension}`).slice(0, 240),
    mimeType: mimeType.slice(0, 160),
    size: Number(media.file_size || 0),
    caption: String(message.caption || "").slice(0, MAX_ATTACHMENT_CAPTION_LENGTH),
    providerFileId: String(media.file_id)
  };
}
__name(telegramInboundAttachment, "telegramInboundAttachment");
function normalizeInstagram(payload) {
  const messages = [];
  const statuses = [];
  const watermarkStatuses = [];
  const recipientIds = /* @__PURE__ */ new Set();
  for (const entry of payload?.entry || []) {
    for (const event of entry?.messaging || []) {
      const senderId = String(event?.sender?.id || "");
      const recipientId = String(event?.recipient?.id || entry?.id || "");
      const message = event?.message || null;
      const postback = event?.postback || null;
      const timestamp = providerEpochTimestamp(event?.timestamp);
      if (message?.is_echo) {
        const accountId = String(entry?.id || event?.sender?.id || "");
        if (accountId) recipientIds.add(accountId);
        if (message.mid) {
          const attachment2 = messengerInboundAttachment(message);
          statuses.push({
            providerMessageId: String(message.mid),
            status: "sent",
            timestamp,
            ...attachment2 ? { attachment: attachment2 } : {}
          });
        }
        continue;
      }
      if (event?.delivery) {
        if (recipientId) recipientIds.add(recipientId);
        const deliveryTimestamp = providerEpochTimestamp(event.delivery.watermark) || timestamp;
        const messageIds = Array.isArray(event.delivery.mids) ? event.delivery.mids : [];
        for (const messageId of messageIds) {
          if (messageId) statuses.push({ providerMessageId: String(messageId), status: "delivered", timestamp: deliveryTimestamp });
        }
        if (!messageIds.length && senderId && deliveryTimestamp) {
          watermarkStatuses.push({ channelProfileId: senderId, status: "delivered", timestamp: deliveryTimestamp });
        }
        continue;
      }
      if (event?.read) {
        if (recipientId) recipientIds.add(recipientId);
        const readTimestamp = providerEpochTimestamp(event.read.watermark) || timestamp;
        if (event.read.mid) statuses.push({ providerMessageId: String(event.read.mid), status: "read", timestamp: readTimestamp });
        else if (senderId && readTimestamp) watermarkStatuses.push({ channelProfileId: senderId, status: "read", timestamp: readTimestamp });
        continue;
      }
      if (!senderId || !message && !postback) continue;
      if (recipientId) recipientIds.add(recipientId);
      const attachment = messengerInboundAttachment(message);
      const text = String(message?.text || postback?.title || postback?.payload || (attachment ? `[Instagram ${attachment.type} received]` : `[Instagram ${String(message?.attachments?.[0]?.type || "message").replace(/_/g, " ")} received]`));
      messages.push({
        channelProfileId: senderId,
        // Instagram webhooks omit profile names; enrichInstagramDisplayNames fills this.
        displayName: senderId,
        text,
        providerMessageId: String(message?.mid || postback?.mid || `${entry?.id || recipientId}:${event?.timestamp || ""}:${senderId}`),
        timestamp,
        messageType: attachment?.type || (message?.text || postback ? "text" : String(message?.attachments?.[0]?.type || "message")),
        ...attachment ? { attachment } : {}
      });
    }
  }
  return { messages, statuses, watermarkStatuses, recipientIds: [...recipientIds] };
}
__name(normalizeInstagram, "normalizeInstagram");
function instagramProfileNameFromGraph(data) {
  const name = String(data?.name || "").trim();
  if (name) return name.slice(0, 120);
  const username = String(data?.username || "").trim().replace(/^@+/, "");
  return username.slice(0, 120);
}
__name(instagramProfileNameFromGraph, "instagramProfileNameFromGraph");
async function fetchInstagramProfileName(channel, credentials, igsid, fetchImpl = fetch) {
  const profileId = String(igsid || "").trim();
  const token = String(credentials?.accessToken || "");
  if (!profileId || !token) return "";
  const version = metaApiVersion(channel?.config?.apiVersion);
  const endpoint = new URL(`https://graph.instagram.com/${encodeURIComponent(version)}/${encodeURIComponent(profileId)}`);
  endpoint.searchParams.set("fields", "name,username");
  const response = await fetchImpl(endpoint, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = safeJsonParse(await response.text(), {});
  if (!response.ok) return "";
  return instagramProfileNameFromGraph(data);
}
__name(fetchInstagramProfileName, "fetchInstagramProfileName");
async function enrichInstagramDisplayNames(env, channel, credentials, messages, fetchImpl = fetch) {
  if (!Array.isArray(messages) || !messages.length) return messages;
  const cache = /* @__PURE__ */ new Map();
  for (const event of messages) {
    const igsid = String(event?.channelProfileId || "").trim();
    if (!igsid) continue;
    const current = String(event.displayName || "").trim();
    if (current && current !== igsid) continue;
    if (!cache.has(igsid)) {
      const name = await fetchInstagramProfileName(channel, credentials, igsid, fetchImpl).catch(() => "");
      cache.set(igsid, name);
    }
    const resolved = cache.get(igsid);
    if (resolved) event.displayName = resolved;
  }
  return messages;
}
__name(enrichInstagramDisplayNames, "enrichInstagramDisplayNames");
function instagramCustomerIds(payload, accountId) {
  const account = String(accountId || "");
  const ids = /* @__PURE__ */ new Set();
  for (const entry of payload?.entry || []) {
    for (const event of entry?.messaging || []) {
      const senderId = String(event?.sender?.id || "");
      if (senderId && senderId !== account) ids.add(senderId);
    }
  }
  return [...ids];
}
__name(instagramCustomerIds, "instagramCustomerIds");
async function refreshInstagramPlaceholderProfiles(env, channel, credentials, profileIds = null, fetchImpl = fetch) {
  const workspaceId = channel.workspaceId;
  const channelId = channel.channelId;
  let rows;
  if (Array.isArray(profileIds) && profileIds.length) {
    const unique = [...new Set(profileIds.map((id) => String(id || "").trim()).filter(Boolean))].slice(0, 50);
    rows = [];
    for (const igsid of unique) {
      const row = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id,c.display_name AS contact_display_name,
          b.scoped_profile_id AS profile_id
        FROM channel_identity_bindings b
        JOIN contact_identities ci ON ci.identity_id=b.identity_id AND ci.workspace_id=b.workspace_id
        JOIN contacts c ON c.contact_id=ci.contact_id AND c.workspace_id=ci.workspace_id
        WHERE b.workspace_id=?1 AND b.channel_id=?2 AND b.scoped_profile_id=?3 AND b.active=1
        LIMIT 1`).bind(workspaceId, channelId, igsid).first();
      if (row) rows.push(row);
    }
  } else {
    const result = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id,c.display_name AS contact_display_name,
        b.scoped_profile_id AS profile_id
      FROM channel_identity_bindings b
      JOIN contact_identities ci ON ci.identity_id=b.identity_id AND ci.workspace_id=b.workspace_id
      JOIN contacts c ON c.contact_id=ci.contact_id AND c.workspace_id=ci.workspace_id
      WHERE b.workspace_id=?1 AND b.channel_id=?2 AND b.active=1
        AND (c.display_name='' OR c.display_name=b.scoped_profile_id)
      ORDER BY c.updated_at DESC LIMIT 50`).bind(workspaceId, channelId).all();
    rows = result.results || [];
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  for (const row of rows) {
    const profileId = String(row.profile_id || "");
    const current = String(row.contact_display_name || "");
    if (!profileId || current && current !== profileId) continue;
    const name = await fetchInstagramProfileName(channel, credentials, profileId, fetchImpl).catch(() => "");
    if (!name) continue;
    await upgradeInboundContactDisplayName(env, workspaceId, {
      identity_id: row.identity_id,
      contact_id: row.contact_id,
      contact_display_name: current
    }, profileId, name, now);
  }
}
__name(refreshInstagramPlaceholderProfiles, "refreshInstagramPlaceholderProfiles");
function normalizeFacebookMessenger(payload) {
  const messages = [];
  const statuses = [];
  const watermarkStatuses = [];
  const recipientIds = /* @__PURE__ */ new Set();
  for (const entry of payload?.entry || []) {
    for (const event of entry?.messaging || []) {
      const senderId = String(event?.sender?.id || "");
      const recipientId = String(event?.recipient?.id || entry?.id || "");
      const message = event?.message || null;
      const postback = event?.postback || null;
      const timestamp = providerEpochTimestamp(event?.timestamp);
      if (message?.is_echo) {
        const pageId = String(entry?.id || event?.sender?.id || "");
        if (pageId) recipientIds.add(pageId);
        if (message.mid) {
          const attachment2 = messengerInboundAttachment(message);
          statuses.push({
            providerMessageId: String(message.mid),
            status: "sent",
            timestamp,
            ...attachment2 ? { attachment: attachment2 } : {}
          });
        }
        continue;
      }
      if (event?.delivery) {
        if (recipientId) recipientIds.add(recipientId);
        const deliveryTimestamp = providerEpochTimestamp(event.delivery.watermark) || timestamp;
        const messageIds = Array.isArray(event.delivery.mids) ? event.delivery.mids : [];
        for (const messageId of messageIds) {
          if (messageId) statuses.push({ providerMessageId: String(messageId), status: "delivered", timestamp: deliveryTimestamp });
        }
        if (!messageIds.length && senderId && deliveryTimestamp) {
          watermarkStatuses.push({ channelProfileId: senderId, status: "delivered", timestamp: deliveryTimestamp });
        }
        continue;
      }
      if (event?.read) {
        if (recipientId) recipientIds.add(recipientId);
        const readTimestamp = providerEpochTimestamp(event.read.watermark) || timestamp;
        if (event.read.mid) statuses.push({ providerMessageId: String(event.read.mid), status: "read", timestamp: readTimestamp });
        else if (senderId && readTimestamp) watermarkStatuses.push({ channelProfileId: senderId, status: "read", timestamp: readTimestamp });
        continue;
      }
      if (!senderId || !message && !postback) continue;
      if (recipientId) recipientIds.add(recipientId);
      const attachment = messengerInboundAttachment(message);
      const text = String(message?.text || postback?.title || postback?.payload || (attachment ? `[Facebook ${attachment.type} received]` : `[Facebook ${String(message?.attachments?.[0]?.type || "message").replace(/_/g, " ")} received]`));
      messages.push({
        channelProfileId: senderId,
        // Messenger webhooks omit profile names; enrichFacebookMessengerDisplayNames fills this.
        displayName: senderId,
        text,
        providerMessageId: String(message?.mid || postback?.mid || `${entry?.id || recipientId}:${event?.timestamp || ""}:${senderId}`),
        timestamp,
        messageType: attachment?.type || (message?.text || postback ? "text" : String(message?.attachments?.[0]?.type || "message")),
        ...attachment ? { attachment } : {}
      });
    }
  }
  return { messages, statuses, watermarkStatuses, recipientIds: [...recipientIds] };
}
__name(normalizeFacebookMessenger, "normalizeFacebookMessenger");
function facebookMessengerProfileNameFromGraph(data) {
  const name = String(data?.name || "").trim();
  if (name) return name.slice(0, 120);
  const composed = [data?.first_name, data?.last_name].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
  return composed.slice(0, 120);
}
__name(facebookMessengerProfileNameFromGraph, "facebookMessengerProfileNameFromGraph");
async function fetchFacebookMessengerProfileName(channel, credentials, psid, fetchImpl = fetch) {
  const profileId = String(psid || "").trim();
  const token = String(credentials?.accessToken || "");
  if (!profileId || !token) return "";
  const version = metaApiVersion(channel?.config?.apiVersion);
  const endpoint = new URL(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(profileId)}`);
  endpoint.searchParams.set("fields", "name,first_name,last_name");
  const response = await fetchImpl(endpoint, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = safeJsonParse(await response.text(), {});
  if (!response.ok) return "";
  return facebookMessengerProfileNameFromGraph(data);
}
__name(fetchFacebookMessengerProfileName, "fetchFacebookMessengerProfileName");
async function enrichFacebookMessengerDisplayNames(env, channel, credentials, messages, fetchImpl = fetch) {
  if (!Array.isArray(messages) || !messages.length) return messages;
  const cache = /* @__PURE__ */ new Map();
  for (const event of messages) {
    const psid = String(event?.channelProfileId || "").trim();
    if (!psid) continue;
    const current = String(event.displayName || "").trim();
    if (current && current !== psid) continue;
    if (!cache.has(psid)) {
      const name = await fetchFacebookMessengerProfileName(channel, credentials, psid, fetchImpl).catch(() => "");
      cache.set(psid, name);
    }
    const resolved = cache.get(psid);
    if (resolved) event.displayName = resolved;
  }
  return messages;
}
__name(enrichFacebookMessengerDisplayNames, "enrichFacebookMessengerDisplayNames");
async function upgradeInboundContactDisplayName(env, workspaceId, identity, profileId, displayName, now) {
  const name = String(displayName || "").trim().slice(0, 120);
  if (!identity?.contact_id || !identity?.identity_id || !name || name === String(profileId || "")) {
    return identity;
  }
  const current = String(identity.contact_display_name || "").trim();
  if (current && current !== String(profileId || "")) return identity;
  await env.DB.batch([
    env.DB.prepare(`UPDATE contacts SET display_name=?3,updated_at=?4
      WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, identity.contact_id, name, now),
    env.DB.prepare(`UPDATE contact_identities SET display_name=?3,updated_at=?4
      WHERE workspace_id=?1 AND identity_id=?2`).bind(workspaceId, identity.identity_id, name, now),
    env.DB.prepare(`UPDATE conversations SET subject=?3,updated_at=?4
      WHERE workspace_id=?1 AND contact_id=?2
        AND (subject='' OR subject=?5)`).bind(workspaceId, identity.contact_id, name, now, String(profileId || ""))
  ]);
  return { ...identity, contact_display_name: name };
}
__name(upgradeInboundContactDisplayName, "upgradeInboundContactDisplayName");
function facebookMessengerCustomerIds(payload, pageId) {
  const page = String(pageId || "");
  const ids = /* @__PURE__ */ new Set();
  for (const entry of payload?.entry || []) {
    for (const event of entry?.messaging || []) {
      const senderId = String(event?.sender?.id || "");
      if (senderId && senderId !== page) ids.add(senderId);
    }
  }
  return [...ids];
}
__name(facebookMessengerCustomerIds, "facebookMessengerCustomerIds");
async function refreshFacebookMessengerPlaceholderProfiles(env, channel, credentials, profileIds = null, fetchImpl = fetch) {
  const workspaceId = channel.workspaceId;
  const channelId = channel.channelId;
  let rows;
  if (Array.isArray(profileIds) && profileIds.length) {
    const unique = [...new Set(profileIds.map((id) => String(id || "").trim()).filter(Boolean))].slice(0, 50);
    rows = [];
    for (const psid of unique) {
      const row = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id,c.display_name AS contact_display_name,
          b.scoped_profile_id AS profile_id
        FROM channel_identity_bindings b
        JOIN contact_identities ci ON ci.identity_id=b.identity_id AND ci.workspace_id=b.workspace_id
        JOIN contacts c ON c.contact_id=ci.contact_id AND c.workspace_id=ci.workspace_id
        WHERE b.workspace_id=?1 AND b.channel_id=?2 AND b.scoped_profile_id=?3 AND b.active=1
        LIMIT 1`).bind(workspaceId, channelId, psid).first();
      if (row) rows.push(row);
    }
  } else {
    const result = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id,c.display_name AS contact_display_name,
        b.scoped_profile_id AS profile_id
      FROM channel_identity_bindings b
      JOIN contact_identities ci ON ci.identity_id=b.identity_id AND ci.workspace_id=b.workspace_id
      JOIN contacts c ON c.contact_id=ci.contact_id AND c.workspace_id=ci.workspace_id
      WHERE b.workspace_id=?1 AND b.channel_id=?2 AND b.active=1
        AND (c.display_name='' OR c.display_name=b.scoped_profile_id)
      ORDER BY c.updated_at DESC LIMIT 50`).bind(workspaceId, channelId).all();
    rows = result.results || [];
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  for (const row of rows) {
    const profileId = String(row.profile_id || "");
    const current = String(row.contact_display_name || "");
    if (!profileId || current && current !== profileId) continue;
    const name = await fetchFacebookMessengerProfileName(channel, credentials, profileId, fetchImpl).catch(() => "");
    if (!name) continue;
    await upgradeInboundContactDisplayName(env, workspaceId, {
      identity_id: row.identity_id,
      contact_id: row.contact_id,
      contact_display_name: current
    }, profileId, name, now);
  }
}
__name(refreshFacebookMessengerPlaceholderProfiles, "refreshFacebookMessengerPlaceholderProfiles");
function messengerInboundAttachment(message) {
  const first = Array.isArray(message?.attachments) ? message.attachments[0] : null;
  if (!first || typeof first !== "object") return null;
  const rawType = String(first.type || "").toLowerCase();
  const type = rawType === "file" ? "document" : rawType === "sticker" ? "image" : rawType;
  if (!["image", "video", "audio", "document"].includes(type)) return null;
  const url = String(first.payload?.url || "").trim();
  let externalUrl = "";
  if (url) {
    try {
      validatePublicHttpsMediaUrl(url, "messenger attachment");
      externalUrl = new URL(url).toString();
    } catch {
      externalUrl = "";
    }
  }
  const extension = type === "image" ? "jpg" : type === "video" ? "mp4" : type === "audio" ? "mp3" : "bin";
  return {
    type,
    filename: String(first.payload?.title || `${type}-${String(message?.mid || "attachment").slice(-12)}.${extension}`).slice(0, 240),
    mimeType: "",
    size: 0,
    caption: String(message?.text || "").slice(0, MAX_ATTACHMENT_CAPTION_LENGTH),
    ...externalUrl ? { externalUrl } : {}
  };
}
__name(messengerInboundAttachment, "messengerInboundAttachment");
function providerEpochTimestamp(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  const milliseconds = numeric < 1e11 ? numeric * 1e3 : numeric;
  const date = new Date(milliseconds);
  return Number.isNaN(date.valueOf()) ? "" : date.toISOString();
}
__name(providerEpochTimestamp, "providerEpochTimestamp");
function resolveTemplate(value, context, secretResolver = () => void 0) {
  if (Array.isArray(value)) return value.map((item) => resolveTemplate(item, context, secretResolver));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveTemplate(item, context, secretResolver)]));
  }
  if (typeof value !== "string") return value;
  return value.replace(/\{\{([^}]+)\}\}/g, (_match, expression) => {
    const expr = expression.trim();
    if (expr.startsWith("secret:")) {
      const name = expr.slice(7).trim();
      const secret = secretResolver(name);
      if (secret === void 0 || secret === null) throw new Error(`Missing connector secret: ${name}`);
      return String(secret);
    }
    const result = getPath(context, expr);
    return result === void 0 || result === null ? "" : String(result);
  });
}
__name(resolveTemplate, "resolveTemplate");
function assertAllowedHttpsEndpoint(endpoint, allowedHosts) {
  let url;
  try {
    url = new URL(String(endpoint));
  } catch {
    throw new Error("Connector endpoint is invalid.");
  }
  if (url.protocol !== "https:") throw new Error("Connector endpoint must use HTTPS.");
  const host = url.hostname.toLowerCase();
  const blocked = host === "localhost" || host === "0.0.0.0" || host === "127.0.0.1" || host === "169.254.169.254" || host.endsWith(".local");
  if (blocked) throw new Error("Connector endpoint host is blocked.");
  const allow = Array.isArray(allowedHosts) ? allowedHosts.map((item) => String(item).toLowerCase()) : [];
  if (!allow.includes(host)) throw new Error("Connector endpoint host is not allowlisted.");
  return true;
}
__name(assertAllowedHttpsEndpoint, "assertAllowedHttpsEndpoint");
async function verifyMetaSignature(rawBody, supplied, appSecret) {
  if (!supplied.startsWith("sha256=") || !appSecret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = `sha256=${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  return timingSafeEqual2(supplied, expected);
}
__name(verifyMetaSignature, "verifyMetaSignature");
function timingSafeEqual2(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) mismatch |= (a[index % (a.length || 1)] || 0) ^ (b[index % (b.length || 1)] || 0);
  return mismatch === 0;
}
__name(timingSafeEqual2, "timingSafeEqual");
async function audit(env, principal, action, targetType, targetId, details) {
  await env.DB.prepare(`INSERT INTO audit_log
      (audit_id,actor,action,target_type,target_id,details_json,timestamp,workspace_id,actor_user_id,actor_email)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?2)`).bind(
    crypto.randomUUID(),
    principal.user.email,
    action,
    targetType,
    targetId,
    JSON.stringify(details || {}),
    (/* @__PURE__ */ new Date()).toISOString(),
    principal.workspace.workspaceId,
    principal.user.userId || ""
  ).run();
}
__name(audit, "audit");
async function broadcast(env, workspaceId, event) {
  if (!env.INBOX_HUB || !workspaceId) return;
  const body = JSON.stringify({ ...event, at: (/* @__PURE__ */ new Date()).toISOString() });
  await inboxHub(env, workspaceId).fetch("https://hub.internal/broadcast", {
    method: "POST",
    body
  });
  if (workspaceId !== LEGACY_WORKSPACE_ID) {
    await inboxHub(env, LEGACY_WORKSPACE_ID).fetch("https://hub.internal/broadcast", {
      method: "POST",
      body
    }).catch(() => {
    });
  }
}
__name(broadcast, "broadcast");
async function disconnectRealtime(env, workspaceId, target) {
  if (!env.INBOX_HUB || !workspaceId) return;
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(target || {})
  };
  await inboxHub(env, workspaceId).fetch("https://hub.internal/disconnect", init);
  if (workspaceId !== LEGACY_WORKSPACE_ID) {
    await inboxHub(env, LEGACY_WORKSPACE_ID).fetch("https://hub.internal/disconnect", init).catch(() => {
    });
  }
}
__name(disconnectRealtime, "disconnectRealtime");
async function enforceOAuthRateLimit(request, env) {
  if (!env.INBOX_HUB) return json({ ok: false, error: "Sign-in is temporarily unavailable." }, 503);
  const address = request.headers.get("CF-Connecting-IP") || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address));
  const clientHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  try {
    const limiter = env.INBOX_HUB.get(env.INBOX_HUB.idFromName("system:oauth-rate-limit"));
    const response = await limiter.fetch("https://hub.internal/oauth-rate-limit", { method: "POST", body: clientHash });
    if (response.status === 204) return null;
    if (response.status === 429) {
      return new Response(JSON.stringify({ ok: false, error: "Too many sign-in attempts. Please try again shortly." }), {
        status: 429,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Retry-After": response.headers.get("Retry-After") || "60"
        }
      });
    }
  } catch (error) {
    console.error("oauth_rate_limit_failed", { message: error.message });
  }
  return json({ ok: false, error: "Sign-in is temporarily unavailable." }, 503);
}
__name(enforceOAuthRateLimit, "enforceOAuthRateLimit");
function inboxHub(env, workspaceId) {
  return env.INBOX_HUB.get(env.INBOX_HUB.idFromName(`workspace:${workspaceId}`));
}
__name(inboxHub, "inboxHub");
function corsHeaders(origin, configured) {
  const allowed = configured.split(",").map((item) => item.trim()).filter(Boolean);
  const permitted = Boolean(origin && allowed.includes(origin));
  return {
    ...permitted ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", Vary: "Origin" } : {},
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Admin-Token, X-Workspace-Id",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400"
  };
}
__name(corsHeaders, "corsHeaders");
async function cleanupExpiredAuth(env) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_states WHERE expires_at<=?1").bind(now),
    env.DB.prepare("DELETE FROM mobile_auth_challenges WHERE expires_at<=?1 OR consumed_at IS NOT NULL").bind(now),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at<=?1 OR revoked_at IS NOT NULL").bind(now),
    env.DB.prepare("DELETE FROM password_reset_tokens WHERE expires_at<=?1 OR consumed_at IS NOT NULL").bind(now),
    env.DB.prepare("UPDATE invitations SET status='expired',updated_at=?1 WHERE status='pending' AND expires_at<=?1").bind(now)
  ]);
}
__name(cleanupExpiredAuth, "cleanupExpiredAuth");
function passwordSessionResponse(result) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  headers.append("Set-Cookie", cookieHeaderForSession(result.token, result.maxAge));
  return new Response(JSON.stringify({
    ok: true,
    me: result.me,
    expiresAt: result.expiresAt
  }), { status: 200, headers });
}
__name(passwordSessionResponse, "passwordSessionResponse");
function cookieHeaderForSession(token, maxAge) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}
__name(cookieHeaderForSession, "cookieHeaderForSession");
async function cleanupExpiredExternalRequests(env) {
  await env.DB.prepare("DELETE FROM external_api_requests WHERE expires_at<=?1").bind((/* @__PURE__ */ new Date()).toISOString()).run();
}
__name(cleanupExpiredExternalRequests, "cleanupExpiredExternalRequests");
function withCors(response, headers) {
  const copy = new Response(response.body, response);
  for (const [key, value] of Object.entries(headers)) copy.headers.set(key, value);
  return copy;
}
__name(withCors, "withCors");
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
__name(json, "json");
async function readJson(request) {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) throw httpError(415, "Content-Type must be application/json.");
  const raw = await readBoundedText(request, MAX_JSON_BODY);
  try {
    return JSON.parse(raw);
  } catch {
    throw httpError(400, "Invalid JSON body.");
  }
}
__name(readJson, "readJson");
async function readImportJson(request) {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) {
    throw httpError(415, "Content-Type must be application/json.");
  }
  const raw = await readBoundedText(request, MAX_IMPORT_JSON_BODY);
  try {
    return JSON.parse(raw);
  } catch {
    throw httpError(400, "Invalid JSON body.");
  }
}
__name(readImportJson, "readImportJson");
async function readBoundedText(request, maximumBytes) {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maximumBytes) throw httpError(413, "Request body is too large.");
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => {
      });
      throw httpError(413, "Request body is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
__name(readBoundedText, "readBoundedText");
function safeJsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
__name(safeJsonParse, "safeJsonParse");
function getPath(object, path) {
  return String(path || "").split(".").filter(Boolean).reduce((value, key) => value == null ? void 0 : value[key], object);
}
__name(getPath, "getPath");
function cleanRequired(value, label, maximum) {
  const text = String(value || "").trim();
  if (!text) throw httpError(400, `${label} is required.`);
  if (text.length > maximum) throw httpError(400, `${label} is too long.`);
  return text;
}
__name(cleanRequired, "cleanRequired");
function cleanId(value, label) {
  const id = cleanRequired(value, label, 100);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw httpError(400, `${label} may contain only letters, numbers, underscores, and hyphens.`);
  return id;
}
__name(cleanId, "cleanId");
function cleanMetaIdentifier(value, label) {
  const id = String(value || "").trim();
  if (!/^\d{4,40}$/.test(id)) throw httpError(400, `${label} must be a numeric Meta identifier.`);
  return id;
}
__name(cleanMetaIdentifier, "cleanMetaIdentifier");
function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}
__name(clampInt, "clampInt");
function withSearchParams(url, overrides = {}) {
  const next = new URL(url);
  for (const [key, value] of Object.entries(overrides || {})) {
    if (value == null || value === "") next.searchParams.delete(key);
    else next.searchParams.set(key, String(value));
  }
  return next;
}
__name(withSearchParams, "withSearchParams");
function secretPrefix(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9_]/g, "_").replace(/^_+|_+$/g, "");
}
__name(secretPrefix, "secretPrefix");
function workspaceSecretPrefix(_workspaceId, value) {
  return secretPrefix(value);
}
__name(workspaceSecretPrefix, "workspaceSecretPrefix");
function normalizeTimestamp(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? fallback : date.toISOString();
}
__name(normalizeTimestamp, "normalizeTimestamp");
function truncateJson(value) {
  const raw = JSON.stringify(value || {});
  return raw.length > MAX_RAW_PAYLOAD ? JSON.stringify({ truncated: true, preview: raw.slice(0, MAX_RAW_PAYLOAD) }) : raw;
}
__name(truncateJson, "truncateJson");
function cleanError(error) {
  return String(error?.message || error || "Unknown provider error").slice(0, 500);
}
__name(cleanError, "cleanError");
function providerError(data, status) {
  return String(data?.error?.message || data?.description || data?.error_description || `HTTP ${status}`).replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 240);
}
__name(providerError, "providerError");
function isMetaObjectVisibilityError(data) {
  const message = String(data?.error?.message || "");
  const code = Number(data?.error?.code);
  return (code === 100 || code === 803) && /unsupported get request|cannot be loaded due to missing permissions|object with id .+ does not exist|does not support this operation/i.test(message);
}
__name(isMetaObjectVisibilityError, "isMetaObjectVisibilityError");
function metaApiVersion(value) {
  const version = String(value || "v26.0").trim();
  if (!/^v\d{1,2}\.\d{1,2}$/.test(version)) throw httpError(400, "Meta API version is invalid.");
  return version;
}
__name(metaApiVersion, "metaApiVersion");
function isRetryableProviderStatus(status) {
  const code = Number(status);
  return code === 408 || code === 425 || code === 429 || code >= 500;
}
__name(isRetryableProviderStatus, "isRetryableProviderStatus");
function normalizeDeliveryStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "seen") return "read";
  if (status === "accepted" || status === "submitted") return "sent";
  return ["sent", "delivered", "read", "failed"].includes(status) ? status : "";
}
__name(normalizeDeliveryStatus, "normalizeDeliveryStatus");
function isTerminalProviderStatus(status) {
  return ["sent", "delivered", "read", "failed"].includes(String(status || "").toLowerCase());
}
__name(isTerminalProviderStatus, "isTerminalProviderStatus");
function nonRetryableError(message) {
  const error = new Error(message);
  error.retryable = false;
  return error;
}
__name(nonRetryableError, "nonRetryableError");
function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
__name(httpError, "httpError");
async function hashText(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(hashText, "hashText");
export {
  CONTACT_TARGET_FIELDS,
  INTERAKT_SOURCE,
  InboxHub,
  assertAllowedHttpsEndpoint,
  assignmentPushNotification,
  buildWhatsAppTemplatePayload,
  decryptChannelCredential,
  decryptOutboundPayload,
  index_default as default,
  defaultInteraktFieldMapping,
  discoverInteraktContactFields,
  encryptChannelCredential,
  encryptOutboundPayload,
  extractInteraktCustomer,
  facebookMessengerProfileNameFromGraph,
  fetchFacebookMessengerProfileName,
  fetchInstagramProfileName,
  handleRequest,
  inboundPushNotification,
  instagramProfileNameFromGraph,
  isRetryableWhatsAppStatus,
  mapInteraktMessage,
  normalizeFacebookMessenger,
  normalizeFieldMapping,
  normalizeGeneric,
  normalizeGenericStatuses,
  normalizeInstagram,
  normalizeTelegram,
  normalizeWhatsApp,
  normalizeWhatsAppRecipient,
  outboundSenderAttribution,
  outboundSenderLabel,
  renderWhatsAppTemplatePreview,
  resolveTemplate,
  sanitizeWhatsAppTemplateDefinition,
  searchMessages,
  timingSafeEqual2 as timingSafeEqual,
  validateExternalTemplateContact,
  validateWhatsAppTemplate,
  validateWhatsAppTemplateRequest,
  verifyMetaSignature,
  whatsAppTemplateCacheRequest,
  whatsappReplyWindowState
};
//# sourceMappingURL=index.js.map
