import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { hashToken } from '../src/auth.js';
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

const MIGRATIONS = [
  '0001_initial.sql', '0002_identity_and_workspaces.sql', '0003_whatsapp_channel.sql',
  '0004_multichannel_credentials.sql', '0005_external_template_api.sql', '0006_contact_profiles.sql',
  '0007_conversation_uniqueness.sql', '0008_push_subscriptions.sql', '0009_workspace_profile.sql',
  '0011_mobile_push_devices.sql', '0012_contact_identities.sql', '0013_flat_contact_platform_ids.sql',
  '0014_unified_contact_conversations.sql', '0015_saas_clients.sql',
  '0016_internal_slug.sql'
];

const ADMIN_ORIGIN = 'https://admin.chat.helixcer.com';

async function fixture() {
  const database = new DatabaseSync(':memory:');
  for (const name of MIGRATIONS) {
    database.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  const now = new Date().toISOString();
  const insertUser = database.prepare(`INSERT INTO users
      (user_id,google_sub,email,display_name,avatar_url,email_verified,last_login_at,created_at,updated_at)
    VALUES (?,?,?,?, '',1,?,?,?)`);
  insertUser.run('owner', 'google-owner', 'owner@example.com', 'Helixcer Owner', now, now, now);
  insertUser.run('agent', 'google-agent', 'agent@example.com', 'Agent Smith', now, now, now);
  insertUser.run('guest', 'google-guest', 'guest@example.com', 'Guest Admin', now, now, now);
  insertUser.run('orphan', 'google-orphan', 'orphan@example.com', 'Orphan Admin', now, now, now);
  insertUser.run('client-owner', 'google-client', 'client@example.com', 'Client Owner', now, now, now);
  const insertMembership = database.prepare(`INSERT INTO memberships
      (membership_id,workspace_id,user_id,role,status,created_at,updated_at) VALUES (?,?,?,?,'active',?,?)`);
  insertMembership.run('owner-membership', 'ws_default', 'owner', 'owner', now, now);
  insertMembership.run('agent-membership', 'ws_default', 'agent', 'agent', now, now);
  insertMembership.run('guest-membership', 'ws_default', 'guest', 'agent', now, now);

  database.prepare(`INSERT INTO workspaces
      (workspace_id,slug,name,status,kind,registered_name,created_at,updated_at)
    VALUES ('ws_client','acme','Acme Traders','active','client','Acme Traders',?,?)`).run(now, now);
  insertMembership.run('client-owner-membership', 'ws_client', 'client-owner', 'owner', now, now);

  database.prepare(`INSERT INTO channels
      (channel_id,name,connector_type,enabled,capabilities_json,config_json,secret_key,created_at,updated_at,workspace_id)
    VALUES ('ch-acme','Acme WhatsApp','whatsapp_cloud',1,'["text"]','{}','SECRET',?,?,'ws_client')`).run(now, now);
  database.prepare(`INSERT INTO contacts (contact_id,display_name,attributes_json,created_at,updated_at,workspace_id)
    VALUES ('ct-acme','Customer','{}',?,?,'ws_client')`).run(now, now);
  database.prepare(`INSERT INTO conversations
      (conversation_id,contact_id,channel_id,status,last_message_at,created_at,updated_at,workspace_id)
    VALUES ('cv-acme','ct-acme','ch-acme','open',?,?,?,'ws_client')`).run(now, now, now);
  database.prepare(`INSERT INTO messages
      (message_id,conversation_id,contact_id,channel_id,direction,status,timestamp,workspace_id)
    VALUES ('msg-acme','cv-acme','ct-acme','ch-acme','inbound','received',?,'ws_client')`).run(now);
  database.prepare(`INSERT INTO contact_identities
      (identity_id,workspace_id,contact_id,platform,profile_id,created_at,updated_at)
    VALUES ('idt-acme','ws_client','ct-acme','whatsapp','919000000001',?,?)`).run(now, now);
  database.prepare(`INSERT INTO channel_identity_bindings
      (binding_id,workspace_id,identity_id,channel_id,scoped_profile_id,first_seen_at,last_seen_at,created_at,updated_at)
    VALUES ('bind-acme','ws_client','idt-acme','ch-acme','919000000001',?,?,?,?)`).run(now, now, now, now);
  database.prepare(`INSERT INTO contact_platform_ids
      (workspace_id,contact_id,platform,profile_id,identity_id,created_at,updated_at)
    VALUES ('ws_client','ct-acme','whatsapp','919000000001','idt-acme',?,?)`).run(now, now);
  database.prepare(`INSERT INTO channel_credentials
      (workspace_id,channel_id,credential_key,encrypted_value,created_at,updated_at)
    VALUES ('ws_client','ch-acme','accessToken','encrypted',?,?)`).run(now, now);
  database.prepare(`INSERT INTO outbound_payloads
      (message_id,workspace_id,encrypted_payload,created_at,updated_at)
    VALUES ('msg-acme','ws_client','encrypted',?,?)`).run(now, now);
  database.prepare(`INSERT INTO outbox
      (outbox_id,message_id,next_attempt_at,created_at,updated_at,workspace_id)
    VALUES ('ob-acme','msg-acme',?,?,?,'ws_client')`).run(now, now, now);
  database.prepare(`INSERT INTO api_keys
      (api_key_id,workspace_id,name,key_prefix,secret_hash,created_at,updated_at)
    VALUES ('key-acme','ws_client','Acme key','helix_acme','hash-acme',?,?)`).run(now, now);
  database.prepare(`INSERT INTO external_api_requests
      (request_id,workspace_id,api_key_id,operation,idempotency_key_hash,request_hash,message_id,created_at,expires_at)
    VALUES ('req-acme','ws_client','key-acme','whatsapp.template.send','idem','hash','msg-acme',?,?)`).run(now, now);
  database.prepare(`INSERT INTO identity_migration_issues
      (issue_id,workspace_id,conversation_id,issue_type,created_at)
    VALUES ('issue-acme','ws_client','cv-acme','missing_identity',?)`).run(now);
  database.prepare(`INSERT INTO agents
      (agent_id,email,display_name,role,enabled,created_at,updated_at,workspace_id)
    VALUES ('agent-acme','legacy@acme.example','Legacy Agent','agent',1,?,?,'ws_client')`).run(now, now);
  database.prepare(`INSERT INTO push_subscriptions
      (subscription_id,workspace_id,membership_id,device_id,endpoint,p256dh,auth,created_at,updated_at)
    VALUES ('sub-acme','ws_client','client-owner-membership','dev-1','https://push.example/acme','p256dh','auth',?,?)`).run(now, now);
  database.prepare(`INSERT INTO webhook_events (event_key,channel_id,event_type,received_at,workspace_id)
    VALUES ('evt-acme','ch-acme','message',?,'ws_client')`).run(now);
  database.prepare(`INSERT INTO audit_log
      (audit_id,actor,action,target_type,target_id,details_json,timestamp,workspace_id,actor_user_id,actor_email)
    VALUES ('audit-acme','client@example.com','login','session','s1','{}',?,'ws_client','client-owner','client@example.com')`).run(now);

  const tokens = {
    owner: 'platform-admin-session',
    agent: 'ordinary-agent-session',
    guest: 'guest-admin-session',
    client: 'client-owner-session'
  };
  const insertSession = database.prepare(`INSERT INTO sessions
      (session_id,token_hash,user_id,workspace_id,expires_at,last_seen_at,created_at,session_type)
    VALUES (?,?,?,?, '2099-01-01',?,?,'browser')`);
  const sessions = [
    ['s-owner', tokens.owner, 'owner', 'ws_default'],
    ['s-agent', tokens.agent, 'agent', 'ws_default'],
    ['s-guest', tokens.guest, 'guest', 'ws_default'],
    ['s-client', tokens.client, 'client-owner', 'ws_client']
  ];
  for (const [id, token, userId, workspaceId] of sessions) {
    insertSession.run(id, await hashToken(token), userId, workspaceId, now, now);
  }
  database.prepare(`INSERT INTO mobile_push_devices
      (push_device_id,workspace_id,membership_id,session_id,device_id,app_id,platform,registration_token,created_at,updated_at)
    VALUES ('mpd-acme','ws_client','client-owner-membership','s-client','dev-1','com.helixcer.chat','android','token-acme',?,?)`).run(now, now);
  return { database, DB: new TestD1(database), tokens };
}

function envFor(DB) {
  return {
    DB,
    APP_ORIGIN: 'https://chat.helixcer.com',
    ALLOWED_ORIGINS: 'https://chat.helixcer.com,https://admin.chat.helixcer.com',
    BOOTSTRAP_OWNER_EMAIL: 'owner@example.com',
    SESSION_TTL_SECONDS: '3600',
    INBOX_HUB: {
      idFromName: value => value,
      get: () => ({ fetch: async () => new Response(null, { status: 204 }) })
    }
  };
}

function request(path, { method = 'GET', token, body } = {}) {
  const headers = { Origin: ADMIN_ORIGIN };
  if (token) headers.Cookie = `__Host-helixcer_session=${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return new Request(`https://api.chat.helixcer.com${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function call(env, path, options) {
  const response = await handleRequest(request(path, options), env);
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

test('platform gate allows only the bootstrap owner or listed admins', async () => {
  const { DB, tokens } = await fixture();
  const env = envFor(DB);
  const anonymous = await call(env, '/api/platform/me');
  assert.equal(anonymous.status, 401);

  const owner = await call(env, '/api/platform/me', { token: tokens.owner });
  assert.equal(owner.status, 200);
  assert.equal(owner.payload.isBootstrap, true);

  const agent = await call(env, '/api/platform/me', { token: tokens.agent });
  assert.equal(agent.status, 403);
});

test('creates a client workspace with an owner invitation link', async () => {
  const { DB, tokens } = await fixture();
  const env = envFor(DB);
  const created = await call(env, '/api/platform/clients', {
    method: 'POST', token: tokens.owner,
    body: { companyName: 'Blue Ocean Foods', ownerEmail: 'founder@blueocean.example' }
  });
  assert.equal(created.status, 201);
  assert.equal(created.payload.item.slug, 'blue-ocean-foods');
  assert.match(created.payload.inviteUrl, /\/auth\/google\/start\?/);
  assert.match(created.payload.inviteUrl, /invite=/);

  const workspace = DB.database.prepare(`SELECT kind,status FROM workspaces WHERE slug='blue-ocean-foods'`).get();
  assert.deepEqual({ ...workspace }, { kind: 'client', status: 'active' });
  const invitation = DB.database.prepare(`SELECT role,status FROM invitations
    WHERE workspace_id=(SELECT workspace_id FROM workspaces WHERE slug='blue-ocean-foods')`).get();
  assert.deepEqual({ ...invitation }, { role: 'owner', status: 'pending' });

  const list = await call(env, '/api/platform/clients', { token: tokens.owner });
  assert.equal(list.status, 200);
  const item = list.payload.items.find(row => row.slug === 'blue-ocean-foods');
  assert.equal(item.owner.email, 'founder@blueocean.example');
  assert.equal(item.status, 'active');

  const overview = await call(env, '/api/platform/overview', { token: tokens.owner });
  assert.equal(overview.status, 200);
  assert.equal(overview.payload.stats.clients, 2);
  assert.equal(overview.payload.stats.activeClients, 2);
});

test('adds an existing Helixcer user as owner with a workspace scoped sign-in link', async () => {
  const { DB, tokens } = await fixture();
  const env = envFor(DB);
  const created = await call(env, '/api/platform/clients', {
    method: 'POST', token: tokens.owner,
    body: { companyName: 'Existing Co', ownerEmail: 'agent@example.com' }
  });
  assert.equal(created.status, 201);
  assert.match(created.payload.inviteUrl, /invite=/);
  const workspaceId = created.payload.item.workspaceId;
  const membership = DB.database.prepare(`SELECT role FROM memberships
    WHERE workspace_id=?1 AND user_id='agent'`).get(workspaceId);
  assert.equal(membership.role, 'owner');
  const invitations = DB.database.prepare(`SELECT role,status FROM invitations WHERE workspace_id=?1`)
    .get(workspaceId);
  assert.deepEqual({ ...invitations }, { role: 'owner', status: 'pending' });
});

test('suspending a client revokes sessions and blocks sign-in until reactivated', async () => {
  const { DB, tokens } = await fixture();
  const env = envFor(DB);
  const suspended = await call(env, '/api/platform/clients/ws_client', {
    method: 'PATCH', token: tokens.owner, body: { status: 'suspended' }
  });
  assert.equal(suspended.status, 200);
  assert.equal(suspended.payload.item.status, 'suspended');
  const activeSessions = DB.database.prepare(`SELECT count(*) AS count FROM sessions
    WHERE workspace_id='ws_client' AND revoked_at IS NULL`).get();
  assert.equal(activeSessions.count, 0);

  const blocked = await call(env, '/api/me', { token: tokens.client });
  assert.equal(blocked.status, 401);

  const detail = await call(env, '/api/platform/clients/ws_client', { token: tokens.owner });
  assert.equal(detail.payload.item.status, 'suspended');

  const reactivated = await call(env, '/api/platform/clients/ws_client', {
    method: 'PATCH', token: tokens.owner, body: { status: 'active' }
  });
  assert.equal(reactivated.payload.item.status, 'active');
});

test('updates the workspace profile fields', async () => {
  const { DB, tokens } = await fixture();
  const env = envFor(DB);
  const updated = await call(env, '/api/platform/clients/ws_client', {
    method: 'PATCH', token: tokens.owner,
    body: { name: 'Acme Logistics', gstin: '27AAAAA0000A1Z5', city: 'Pune', postalCode: '411001', notes: 'Priority account' }
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.payload.item.name, 'Acme Logistics');
  assert.equal(updated.payload.item.profile.gstin, '27AAAAA0000A1Z5');
  assert.equal(updated.payload.item.profile.city, 'Pune');
  assert.equal(updated.payload.item.notes, 'Priority account');
  const unknown = await call(env, '/api/platform/clients/ws_client', {
    method: 'PATCH', token: tokens.owner, body: { billingPlan: 'gold' }
  });
  assert.equal(unknown.status, 400);
});

test('invites, updates and removes members while protecting the last owner', async () => {
  const { DB, tokens } = await fixture();
  const env = envFor(DB);

  const invited = await call(env, '/api/platform/clients/ws_client/invitations', {
    method: 'POST', token: tokens.owner, body: { email: 'new.member@example.com', role: 'admin' }
  });
  assert.equal(invited.status, 201);
  assert.match(invited.payload.inviteUrl, /invite=/);

  const detail = await call(env, '/api/platform/clients/ws_client', { token: tokens.owner });
  assert.equal(detail.payload.invitations.length, 1);
  const invitationId = detail.payload.invitations[0].invitationId;
  const cancelled = await call(env, `/api/platform/clients/ws_client/invitations/${invitationId}`, {
    method: 'DELETE', token: tokens.owner
  });
  assert.equal(cancelled.status, 200);

  const added = await call(env, '/api/platform/clients/ws_client/invitations', {
    method: 'POST', token: tokens.owner, body: { email: 'agent@example.com', role: 'agent' }
  });
  assert.equal(added.status, 201);
  assert.match(added.payload.inviteUrl, /invite=/);
  const membershipId = added.payload.item.membershipId;

  const promoted = await call(env, `/api/platform/clients/ws_client/members/${membershipId}`, {
    method: 'PATCH', token: tokens.owner, body: { role: 'admin' }
  });
  assert.equal(promoted.status, 200);
  assert.equal(promoted.payload.item.role, 'admin');

  const lastOwner = await call(env, '/api/platform/clients/ws_client/members/client-owner-membership', {
    method: 'DELETE', token: tokens.owner
  });
  assert.equal(lastOwner.status, 409);

  const removed = await call(env, `/api/platform/clients/ws_client/members/${membershipId}`, {
    method: 'DELETE', token: tokens.owner
  });
  assert.equal(removed.status, 200);
  const remaining = DB.database.prepare('SELECT count(*) AS count FROM memberships WHERE workspace_id=?1 AND user_id=?2')
    .get('ws_client', 'agent');
  assert.equal(remaining.count, 0);
});

test('deletes a client workspace permanently after slug confirmation', async () => {
  const { DB, tokens } = await fixture();
  const env = envFor(DB);
  const wrong = await call(env, '/api/platform/clients/ws_client', {
    method: 'DELETE', token: tokens.owner, body: { confirmSlug: 'nope' }
  });
  assert.equal(wrong.status, 400);
  assert.ok(DB.database.prepare(`SELECT 1 FROM workspaces WHERE workspace_id='ws_client'`).get());

  const deleted = await call(env, '/api/platform/clients/ws_client', {
    method: 'DELETE', token: tokens.owner, body: { confirmSlug: 'acme' }
  });
  assert.equal(deleted.status, 200);
  for (const table of ['workspaces', 'channels', 'contacts', 'conversations', 'messages', 'api_keys',
    'webhook_events', 'memberships', 'sessions', 'invitations', 'audit_log',
    'contact_identities', 'channel_identity_bindings', 'contact_platform_ids', 'channel_credentials',
    'outbound_payloads', 'outbox', 'external_api_requests', 'identity_migration_issues', 'agents',
    'push_subscriptions', 'mobile_push_devices']) {
    const row = DB.database.prepare(`SELECT count(*) AS count FROM ${table} WHERE workspace_id=?1`)
      .get('ws_client');
    assert.equal(row.count, 0, `${table} still has rows`);
  }
  const audit = DB.database.prepare(`SELECT count(*) AS count FROM audit_log
    WHERE workspace_id='ws_default' AND action='delete' AND target_id='ws_client'`).get();
  assert.equal(audit.count, 1);

  const internal = await call(env, '/api/platform/clients/ws_default', {
    method: 'DELETE', token: tokens.owner, body: { confirmSlug: 'helixcer' }
  });
  assert.equal(internal.status, 404);
});

test('lists the internal workspace, allows managing it, but protects it from suspension and deletion', async () => {
  const { DB, tokens } = await fixture();
  const env = envFor(DB);
  const list = await call(env, '/api/platform/clients', { token: tokens.owner });
  assert.equal(list.status, 200);
  const internal = list.payload.items.find(row => row.workspaceId === 'ws_default');
  assert.ok(internal, 'internal workspace missing from client list');
  assert.equal(internal.kind, 'internal');

  const detail = await call(env, '/api/platform/clients/ws_default', { token: tokens.owner });
  assert.equal(detail.status, 200);
  assert.equal(detail.payload.item.kind, 'internal');
  assert.ok(detail.payload.members.length >= 1);

  const renamed = await call(env, '/api/platform/clients/ws_default', {
    method: 'PATCH', token: tokens.owner, body: { companyName: 'Helixcer HQ' }
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.payload.item.name, 'Helixcer HQ');
  assert.equal(DB.database.prepare(`SELECT name FROM workspaces WHERE workspace_id='ws_default'`).get().name, 'Helixcer HQ');

  const suspended = await call(env, '/api/platform/clients/ws_default', {
    method: 'PATCH', token: tokens.owner, body: { status: 'suspended' }
  });
  assert.equal(suspended.status, 400);

  const invited = await call(env, '/api/platform/clients/ws_default/invitations', {
    method: 'POST', token: tokens.owner, body: { email: 'hq-staff@example.com', role: 'agent' }
  });
  assert.equal(invited.status, 201);
  assert.match(invited.payload.inviteUrl, /invite=/);
});

test('manages platform administrators and their workspace access', async () => {
  const { DB, tokens } = await fixture();
  const env = envFor(DB);
  const list = await call(env, '/api/platform/admins', { token: tokens.owner });
  assert.equal(list.status, 200);
  assert.equal(list.payload.items[0].isBootstrap, true);

  const bootstrapAgain = await call(env, '/api/platform/admins', {
    method: 'POST', token: tokens.owner, body: { email: 'owner@example.com' }
  });
  assert.equal(bootstrapAgain.status, 409);

  const invited = await call(env, '/api/platform/admins', {
    method: 'POST', token: tokens.owner, body: { email: 'ops@example.com' }
  });
  assert.equal(invited.status, 201);
  assert.match(invited.payload.inviteUrl, /invite=/);

  const granted = await call(env, '/api/platform/admins', {
    method: 'POST', token: tokens.owner, body: { email: 'guest@example.com' }
  });
  assert.equal(granted.status, 201);
  assert.equal(granted.payload.inviteUrl, '');

  const guestAccess = await call(env, '/api/platform/me', { token: tokens.guest });
  assert.equal(guestAccess.status, 200);

  const orphan = await call(env, '/api/platform/admins', {
    method: 'POST', token: tokens.owner, body: { email: 'orphan@example.com' }
  });
  assert.equal(orphan.status, 201);
  assert.equal(orphan.payload.inviteUrl, '');
  const orphanMembership = DB.database.prepare(`SELECT workspace_id,role,status FROM memberships
    WHERE user_id='orphan'`).get();
  assert.deepEqual({ ...orphanMembership }, { workspace_id: 'ws_default', role: 'agent', status: 'active' });

  const rows = await call(env, '/api/platform/admins', { token: tokens.owner });
  const guestRow = rows.payload.items.find(row => row.email === 'guest@example.com');
  assert.ok(guestRow);
  const revoked = await call(env, `/api/platform/admins/${guestRow.adminId}`, {
    method: 'DELETE', token: tokens.owner
  });
  assert.equal(revoked.status, 200);
  const guestDenied = await call(env, '/api/platform/me', { token: tokens.guest });
  assert.equal(guestDenied.status, 403);
});
