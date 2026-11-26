import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { hashToken } from '../src/auth.js';
import { handleRequest } from '../src/index.js';
import { sendPlatformNotification } from '../src/platform-notifications.js';

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
  '0016_internal_slug.sql', '0017_agent_channel_access.sql', '0019_outbound_sender.sql',
  '0020_user_profile.sql', '0021_campaigns.sql', '0022_facebook_messenger_page.sql',
  '0023_workspace_roles.sql', '0024_password_auth.sql', '0027_google_reviews_oauth.sql',
  '0031_platform_notifications.sql'
];

const ADMIN_ORIGIN = 'https://admin.chat.helixcer.com';
const APP_ORIGIN = 'https://app.chat.helixcer.com';

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

  database.prepare(`UPDATE workspaces SET kind='internal', status='active' WHERE workspace_id='ws_default'`).run();
  database.prepare(`INSERT INTO workspaces
      (workspace_id,slug,name,status,kind,registered_name,created_at,updated_at)
    VALUES ('ws_client','acme','Acme Traders','active','client','Acme Traders',?,?)`).run(now, now);

  const insertMembership = database.prepare(`INSERT INTO memberships
      (membership_id,workspace_id,user_id,role,status,created_at,updated_at) VALUES (?,?,?,?,'active',?,?)`);
  insertMembership.run('owner-membership', 'ws_default', 'owner', 'owner', now, now);
  insertMembership.run('agent-membership', 'ws_client', 'agent', 'agent', now, now);

  const tokens = {
    owner: 'platform-admin-session',
    agent: 'client-agent-session'
  };
  const insertSession = database.prepare(`INSERT INTO sessions
      (session_id,token_hash,user_id,workspace_id,expires_at,last_seen_at,created_at,session_type)
    VALUES (?,?,?,?, '2099-01-01',?,?,'browser')`);
  insertSession.run('s-owner', await hashToken(tokens.owner), 'owner', 'ws_default', now, now);
  insertSession.run('s-agent', await hashToken(tokens.agent), 'agent', 'ws_client', now, now);

  return {
    env: {
      DB: new TestD1(database),
      ALLOWED_ORIGINS: `${APP_ORIGIN},${ADMIN_ORIGIN}`,
      APP_ORIGIN,
      BOOTSTRAP_OWNER_EMAIL: 'owner@example.com',
      SESSION_TTL_SECONDS: '86400'
    },
    cookies: {
      owner: `__Host-helixcer_session=${tokens.owner}`,
      agent: `__Host-helixcer_session=${tokens.agent}`
    }
  };
}

async function call(env, path, { method = 'GET', cookie = '', origin = ADMIN_ORIGIN, body } = {}) {
  const headers = { Origin: origin, Cookie: cookie };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await handleRequest(new Request(`https://api.chat.helixcer.com${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }), env);
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

test('platform admin can create and push a workspace notification', async () => {
  const { env, cookies } = await fixture();
  const created = await call(env, '/api/platform/notifications', {
    method: 'POST',
    cookie: cookies.owner,
    body: {
      title: 'New connector',
      body: 'Download the updated TallyPrime connector.',
      audience: 'workspace',
      workspaceId: 'ws_client',
      send: true
    }
  });
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  assert.equal(created.payload.item.status, 'sent');
  assert.equal(created.payload.recipientCount, 1);

  const listed = await call(env, '/api/notifications', {
    cookie: cookies.agent,
    origin: APP_ORIGIN
  });
  assert.equal(listed.status, 200, JSON.stringify(listed.payload));
  assert.equal(listed.payload.unreadCount, 1);
  assert.equal(listed.payload.items[0].title, 'New connector');

  const read = await call(env, `/api/notifications/${created.payload.item.notificationId}/read`, {
    method: 'POST',
    cookie: cookies.agent,
    origin: APP_ORIGIN,
    body: {}
  });
  assert.equal(read.status, 200);
  assert.equal(read.payload.updated, true);

  const after = await call(env, '/api/notifications', {
    cookie: cookies.agent,
    origin: APP_ORIGIN
  });
  assert.equal(after.payload.unreadCount, 0);
});

test('email audience targets login users and drafts can be pushed later', async () => {
  const { env, cookies } = await fixture();
  const draft = await call(env, '/api/platform/notifications', {
    method: 'POST',
    cookie: cookies.owner,
    body: {
      title: 'Account notice',
      body: 'Please review your profile.',
      audience: 'email',
      targetEmail: 'agent@example.com'
    }
  });
  assert.equal(draft.status, 201, JSON.stringify(draft.payload));
  assert.equal(draft.payload.item.status, 'draft');

  const pushed = await call(env, `/api/platform/notifications/${draft.payload.item.notificationId}/send`, {
    method: 'POST',
    cookie: cookies.owner,
    body: {}
  });
  assert.equal(pushed.status, 200, JSON.stringify(pushed.payload));
  assert.equal(pushed.payload.recipientCount, 1);

  const mine = await call(env, '/api/notifications', {
    cookie: cookies.agent,
    origin: APP_ORIGIN
  });
  assert.equal(mine.payload.unreadCount, 1);
  assert.equal(mine.payload.items[0].title, 'Account notice');
});

test('sending a platform notification broadcasts to the in-app bell only', async () => {
  const { env, cookies } = await fixture();
  const draft = await call(env, '/api/platform/notifications', {
    method: 'POST',
    cookie: cookies.owner,
    body: {
      title: 'Bell only',
      body: 'Should not trigger OS push.',
      audience: 'workspace',
      workspaceId: 'ws_client'
    }
  });
  assert.equal(draft.status, 201, JSON.stringify(draft.payload));

  const broadcasts = [];
  const result = await sendPlatformNotification(env, draft.payload.item.notificationId, {
    broadcast: async (_env, workspaceId, event) => {
      broadcasts.push({ workspaceId, event });
    },
    // Even if a caller asks for device push, platform notifications stay bell-only.
    push: true
  });
  assert.equal(result.ok, true);
  assert.equal(result.recipientCount, 1);
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].workspaceId, 'ws_client');
  assert.equal(broadcasts[0].event.type, 'platform.notification');
  assert.equal(broadcasts[0].event.notification.title, 'Bell only');
  assert.deepEqual(broadcasts[0].event.membershipIds, ['agent-membership']);

  const source = await readFile(new URL('../src/platform-notifications.js', import.meta.url), 'utf8');
  assert.equal(source.includes('sendMembershipNotifications'), false);
  assert.equal(source.includes('sendWorkspacePush'), false);
  assert.equal(source.includes('sendWorkspaceMobilePush'), false);
});
