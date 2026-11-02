import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import {
  createWorkspaceRole,
  defaultPermissionsForRole,
  hasPermission,
  listWorkspaceRoles,
  normalizePermissions,
  updateWorkspaceRole
} from '../src/roles.js';
import { handleRequest } from '../src/index.js';
import { hashToken } from '../src/auth.js';

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

async function fixture() {
  const database = new DatabaseSync(':memory:');
  const migrations = [
    '0001_initial.sql', '0002_identity_and_workspaces.sql', '0003_whatsapp_channel.sql',
    '0004_multichannel_credentials.sql', '0005_external_template_api.sql', '0006_contact_profiles.sql',
    '0007_conversation_uniqueness.sql', '0008_push_subscriptions.sql', '0009_workspace_profile.sql',
    '0011_mobile_push_devices.sql', '0012_contact_identities.sql', '0013_flat_contact_platform_ids.sql',
    '0014_unified_contact_conversations.sql', '0015_saas_clients.sql', '0016_internal_slug.sql',
    '0017_agent_channel_access.sql', '0019_outbound_sender.sql', '0020_user_profile.sql',
    '0021_campaigns.sql', '0022_facebook_messenger_page.sql', '0023_workspace_roles.sql'
  ];
  for (const name of migrations) {
    database.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  const now = new Date().toISOString();
  const workspaceId = database.prepare(`SELECT workspace_id FROM workspaces ORDER BY created_at LIMIT 1`).get().workspace_id;
  database.prepare(`INSERT INTO users
      (user_id,google_sub,email,display_name,avatar_url,email_verified,last_login_at,created_at,updated_at)
    VALUES (?1,?2,?3,?4,'',1,?5,?5,?5)`)
    .run('user-owner', 'sub-owner', 'owner@example.com', 'Owner', now);
  database.prepare(`INSERT INTO memberships
      (membership_id,workspace_id,user_id,role,status,created_at,updated_at,allowed_channel_ids_json)
    VALUES (?1,?2,?3,'owner','active',?4,?4,'[]')`)
    .run('mem-owner', workspaceId, 'user-owner', now);
  const token = 'roles-test-token';
  database.prepare(`INSERT INTO sessions
      (session_id,token_hash,user_id,workspace_id,expires_at,last_seen_at,created_at,session_type)
    VALUES (?1,?2,?3,?4,?5,?4,?4,'browser')`)
    .run('session-owner', await hashToken(token), 'user-owner', workspaceId, '2099-01-01T00:00:00.000Z');
  return {
    database,
    DB: new TestD1(database),
    workspaceId,
    token,
    principal: {
      authType: 'session',
      user: { userId: 'user-owner', email: 'owner@example.com', displayName: 'Owner' },
      workspace: { workspaceId, name: 'Helixcer Chat', slug: 'default' },
      membership: { membershipId: 'mem-owner', role: 'owner', status: 'active', allowedChannelIds: [] },
      permissions: defaultPermissionsForRole('owner')
    }
  };
}

test('role permission defaults and assigned chat scope normalize correctly', () => {
  const agent = defaultPermissionsForRole('agent');
  assert.equal(agent.chats.view, 'all');
  assert.equal(agent.developer.manage, false);
  const assignedOnly = normalizePermissions({
    chats: { view: 'assigned', reply: 'all', assign: true, delete: false },
    contacts: { view: true, create: false, edit: false, delete: false }
  }, 'agent');
  assert.equal(assignedOnly.chats.view, 'assigned');
  assert.equal(assignedOnly.chats.reply, 'assigned');
  assert.equal(hasPermission({ membership: { role: 'agent' }, permissions: assignedOnly }, 'contacts.create'), false);
  assert.equal(hasPermission({ membership: { role: 'owner' }, permissions: assignedOnly }, 'developer.manage'), true);
});

test('workspace roles can be listed, customized, and created', async () => {
  const { DB, principal } = await fixture();
  const listed = await listWorkspaceRoles({ DB }, principal);
  assert.equal(listed.items.length, 3);
  assert.ok(listed.items.some((role) => role.roleKey === 'admin'));

  const updated = await updateWorkspaceRole({ DB }, principal, 'agent', {
    permissions: {
      ...defaultPermissionsForRole('agent'),
      chats: { view: 'assigned', reply: 'assigned', assign: false, delete: false },
      contacts: { view: true, create: true, edit: false, delete: false },
      developer: { manage: false }
    }
  });
  assert.equal(updated.item.permissions.chats.view, 'assigned');
  assert.equal(updated.item.permissions.chats.assign, false);

  const created = await createWorkspaceRole({ DB }, principal, {
    name: 'Supervisor',
    description: 'See every chat, no channel admin',
    permissions: {
      ...defaultPermissionsForRole('agent'),
      chats: { view: 'all', reply: 'all', assign: true, delete: false },
      team: { manage: false },
      channels: { manage: false }
    }
  });
  assert.equal(created.item.roleKey, 'supervisor');
  const again = await listWorkspaceRoles({ DB }, principal);
  assert.ok(again.items.some((role) => role.roleKey === 'supervisor'));
});

test('roles API returns permission catalog for signed-in owners', async () => {
  const { DB, token } = await fixture();
  const response = await handleRequest(new Request('https://api.chat.helixcer.com/api/roles', {
    headers: {
      Cookie: `__Host-helixcer_session=${encodeURIComponent(token)}`,
      Origin: 'https://chat.helixcer.com'
    }
  }), { DB, APP_NAME: 'Helixcer Chat', ALLOWED_ORIGINS: 'https://chat.helixcer.com' }, { waitUntil() {} });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(Array.isArray(payload.items));
  assert.ok(payload.items.some((role) => role.roleKey === 'owner' && role.isLocked));
  assert.ok(payload.catalog.some((group) => group.key === 'chats'));
});
