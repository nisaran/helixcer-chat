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

async function fixture() {
  const database = new DatabaseSync(':memory:');
  for (const name of ['0001_initial.sql', '0002_identity_and_workspaces.sql', '0003_whatsapp_channel.sql',
    '0004_multichannel_credentials.sql', '0005_external_template_api.sql', '0006_contact_profiles.sql',
    '0007_conversation_uniqueness.sql', '0008_push_subscriptions.sql', '0009_workspace_profile.sql',
    '0011_mobile_push_devices.sql', '0012_contact_identities.sql', '0013_flat_contact_platform_ids.sql',
    '0014_unified_contact_conversations.sql', '0015_saas_clients.sql']) {
    database.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  const now = new Date().toISOString();
  database.prepare(`INSERT INTO users
      (user_id,google_sub,email,display_name,avatar_url,email_verified,last_login_at,created_at,updated_at)
    VALUES ('owner','google-owner','owner@example.com','Helixcer Owner','',1,?,?,?)`).run(now, now, now);
  database.prepare(`INSERT INTO memberships
      (membership_id,workspace_id,user_id,role,status,created_at,updated_at)
    VALUES ('owner-membership','ws_default','owner','owner','active',?,?)`).run(now, now);
  database.prepare(`INSERT INTO users
      (user_id,google_sub,email,display_name,avatar_url,email_verified,last_login_at,created_at,updated_at)
    VALUES ('agent','google-agent','agent@example.com','Agent','',1,?,?,?)`).run(now, now, now);
  database.prepare(`INSERT INTO memberships
      (membership_id,workspace_id,user_id,role,status,created_at,updated_at)
    VALUES ('agent-membership','ws_default','agent','agent','active',?,?)`).run(now, now);
  const adminToken = 'platform-admin-session';
  const agentToken = 'ordinary-agent-session';
  database.prepare(`INSERT INTO sessions
      (session_id,token_hash,user_id,workspace_id,expires_at,last_seen_at,created_at,session_type)
    VALUES ('admin-session',?,'owner','ws_default','2099-01-01',?,?,'browser')`).run(await hashToken(adminToken), now, now);
  database.prepare(`INSERT INTO sessions
      (session_id,token_hash,user_id,workspace_id,expires_at,last_seen_at,created_at,session_type)
    VALUES ('agent-session',?,'agent','ws_default','2099-01-01',?,?,'browser')`).run(await hashToken(agentToken), now, now);
  return { database, DB: new TestD1(database), adminToken, agentToken };
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

function cookie(response) {
  const values = response.headers.getSetCookie?.() || [];
  const match = values.join('; ').match(/__Host-helixcer_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

test('platform admin creates a client and that owner signs in with the issued password', async () => {
  const { DB, adminToken, agentToken } = await fixture();
  const env = envFor(DB);
  const page = await handleRequest(new Request('https://admin.chat.helixcer.com/'), env);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Client administration/);
  const hidden = await handleRequest(new Request('https://api.chat.helixcer.com/'), env);
  assert.equal(hidden.status, 404);

  const denied = await handleRequest(new Request('https://api.chat.helixcer.com/api/platform/clients', {
    headers: { Cookie: `__Host-helixcer_session=${agentToken}`, Origin: 'https://admin.chat.helixcer.com' }
  }), env);
  assert.equal(denied.status, 403);

  const created = await handleRequest(new Request('https://api.chat.helixcer.com/api/platform/clients', {
    method: 'POST',
    headers: {
      Cookie: `__Host-helixcer_session=${adminToken}`,
      Origin: 'https://admin.chat.helixcer.com',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      companyName: 'Northwind Retail',
      ownerName: 'Ananya Sharma',
      ownerEmail: 'ananya@northwind.example',
      password: 'northwind-pass'
    })
  }), env);
  assert.equal(created.status, 201);
  const client = await created.json();
  assert.equal(client.item.owner.email, 'ananya@northwind.example');
  assert.equal(client.item.status, 'active');
  assert.notEqual(client.item.workspaceId, 'ws_default');

  const listed = await handleRequest(new Request('https://api.chat.helixcer.com/api/platform/clients', {
    headers: { Cookie: `__Host-helixcer_session=${adminToken}`, Origin: 'https://admin.chat.helixcer.com' }
  }), env);
  assert.equal((await listed.json()).items.length, 1);

  const signedIn = await handleRequest(new Request('https://api.chat.helixcer.com/api/auth/password', {
    method: 'POST',
    headers: { Origin: 'https://chat.helixcer.com', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ananya@northwind.example', password: 'northwind-pass' })
  }), env);
  assert.equal(signedIn.status, 200);
  const session = cookie(signedIn);
  assert.ok(session);
  const me = await handleRequest(new Request('https://api.chat.helixcer.com/api/me', {
    headers: { Cookie: `__Host-helixcer_session=${session}`, Origin: 'https://chat.helixcer.com' }
  }), env);
  assert.equal(me.status, 200);
  assert.equal((await me.json()).workspace.name, 'Northwind Retail');

  const wrong = await handleRequest(new Request('https://api.chat.helixcer.com/api/auth/password', {
    method: 'POST',
    headers: { Origin: 'https://chat.helixcer.com', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ananya@northwind.example', password: 'wrong-password' })
  }), env);
  assert.equal(wrong.status, 401);

  const suspended = await handleRequest(new Request(`https://api.chat.helixcer.com/api/platform/clients/${client.item.workspaceId}`, {
    method: 'PATCH',
    headers: {
      Cookie: `__Host-helixcer_session=${adminToken}`,
      Origin: 'https://admin.chat.helixcer.com',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status: 'suspended' })
  }), env);
  assert.equal(suspended.status, 200);
  const blocked = await handleRequest(new Request('https://api.chat.helixcer.com/api/auth/password', {
    method: 'POST',
    headers: { Origin: 'https://chat.helixcer.com', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ananya@northwind.example', password: 'northwind-pass' })
  }), env);
  assert.equal(blocked.status, 403);
});
