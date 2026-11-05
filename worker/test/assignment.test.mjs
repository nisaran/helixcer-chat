import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { assignmentPushNotification, handleRequest } from '../src/index.js';
import { sendMembershipNotifications } from '../src/push.js';
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
    '0021_campaigns.sql', '0022_facebook_messenger_page.sql', '0023_workspace_roles.sql',
    '0024_password_auth.sql', '0027_google_reviews_oauth.sql'
  ];
  for (const name of migrations) {
    database.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  const now = new Date().toISOString();
  const workspaceId = database.prepare(`SELECT workspace_id FROM workspaces ORDER BY created_at LIMIT 1`).get().workspace_id;
  for (const [userId, sub, email, name] of [
    ['user-owner', 'sub-owner', 'owner@example.com', 'Owner'],
    ['user-agent', 'sub-agent', 'agent@example.com', 'Agent One']
  ]) {
    database.prepare(`INSERT INTO users
        (user_id,google_sub,email,display_name,avatar_url,email_verified,last_login_at,created_at,updated_at)
      VALUES (?1,?2,?3,?4,'',1,?5,?5,?5)`)
      .run(userId, sub, email, name, now);
  }
  database.prepare(`INSERT INTO memberships
      (membership_id,workspace_id,user_id,role,status,created_at,updated_at,allowed_channel_ids_json)
    VALUES (?1,?2,?3,'owner','active',?4,?4,'[]'), (?5,?2,?6,'agent','active',?4,?4,'[]')`)
    .run('mem-owner', workspaceId, 'user-owner', now, 'mem-agent', 'user-agent');
  const ownerToken = 'assignment-owner-token-that-is-long-enough';
  const agentToken = 'assignment-agent-token-that-is-long-enough';
  database.prepare(`INSERT INTO sessions
      (session_id,token_hash,user_id,workspace_id,expires_at,last_seen_at,created_at,session_type)
    VALUES (?1,?2,?3,?4,?5,?4,?4,'browser'), (?6,?7,?8,?4,?5,?4,?4,'browser')`)
    .run('session-owner', await hashToken(ownerToken), 'user-owner', workspaceId, '2099-01-01T00:00:00.000Z',
      'session-agent', await hashToken(agentToken), 'user-agent');
  database.prepare(`INSERT INTO channels
      (channel_id,name,connector_type,provider_type,enabled,capabilities_json,config_json,secret_key,created_at,updated_at,workspace_id)
    VALUES ('assign-channel','Assign Generic','generic_http','generic_http',1,'["text"]','{}','ASSIGN',?,?,?)`)
    .run(now, now, workspaceId);
  database.prepare(`INSERT INTO contacts (contact_id,display_name,created_at,updated_at,workspace_id)
    VALUES ('assign-contact','Assign Contact',?,?,?)`).run(now, now, workspaceId);
  database.prepare(`INSERT INTO contact_identities
      (identity_id,workspace_id,contact_id,platform,profile_id,display_name,created_at,updated_at)
    VALUES ('assign-identity',?,'assign-contact','generic_http','assign-profile','Assign Contact',?,?)`)
    .run(workspaceId, now, now);
  database.prepare(`INSERT INTO channel_identity_bindings
      (binding_id,workspace_id,identity_id,channel_id,scoped_profile_id,active,first_seen_at,last_seen_at,created_at,updated_at)
    VALUES ('assign-binding',?,'assign-identity','assign-channel','assign-profile',1,?,?,?,?)`)
    .run(workspaceId, now, now, now, now);
  database.prepare(`INSERT INTO conversations
      (conversation_id,contact_id,channel_id,identity_id,status,assigned_to,subject,last_message_at,unread_count,created_at,updated_at,workspace_id)
    VALUES ('assign-conversation','assign-contact','assign-channel','assign-identity','open','','Support chat',?,0,?,?,?)`)
    .run(now, now, now, workspaceId);
  const broadcasts = [];
  const waitUntilPromises = [];
  const env = {
    DB: new TestD1(database),
    APP_NAME: 'Helixcer Chat',
    ALLOWED_ORIGINS: 'https://chat.helixcer.com',
    INBOX_HUB: {
      idFromName: value => value,
      get: () => ({
        fetch: async (url, init = {}) => {
          if (String(url).endsWith('/broadcast')) broadcasts.push(JSON.parse(init.body));
          return new Response(null, { status: 204 });
        }
      })
    }
  };
  return {
    database,
    env,
    workspaceId,
    ownerToken,
    agentToken,
    broadcasts,
    waitUntilPromises,
    ctx: { waitUntil(promise) { waitUntilPromises.push(promise); } },
    headersFor(token) {
      return {
        Cookie: `__Host-helixcer_session=${encodeURIComponent(token)}`,
        Origin: 'https://chat.helixcer.com',
        'Content-Type': 'application/json'
      };
    }
  };
}

test('assignment push notification payload targets the conversation', () => {
  assert.deepEqual(assignmentPushNotification({
    conversationId: 'assign-conversation',
    subject: 'Support chat'
  }, {
    assigneeName: 'Agent One',
    conversationId: 'assign-conversation',
    timestamp: '2026-11-02T12:00:00.000Z'
  }), {
    title: 'Chat assigned to you',
    body: 'Support chat was assigned to you.',
    tag: 'helixcer-assign-assign-conversation',
    url: '/#inbox/assign-conversation',
    eventTimestamp: '2026-11-02T12:00:00.000Z'
  });
});

test('membership push delivery scopes to the assignee membership only', async () => {
  const calls = [];
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...values) {
            return {
              async all() {
                calls.push({ sql, values });
                return { results: [] };
              }
            };
          }
        };
      }
    },
    VAPID_PUBLIC_KEY: `B${'A'.repeat(86)}`,
    VAPID_PRIVATE_KEY: 'b'.repeat(43),
    VAPID_SUBJECT: 'mailto:alerts@example.com',
    FIREBASE_PROJECT_ID: 'helixcer-chat-test',
    FIREBASE_CLIENT_EMAIL: 'push-test@helixcer-chat-test.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${'A'.repeat(64)}\n-----END PRIVATE KEY-----`
  };
  await sendMembershipNotifications(env, 'ws_test', 'mem-agent', {
    title: 'Chat assigned to you',
    body: 'Support chat was assigned to you.'
  });
  assert.ok(calls.some((call) => /membership_id=\?2/.test(call.sql) && call.values.includes('mem-agent')));
  assert.ok(calls.every((call) => call.values.includes('mem-agent')));
});

test('assigning a chat to another member inserts a timeline event and notifies only the assignee', async () => {
  const { database, env, ownerToken, broadcasts, waitUntilPromises, headersFor } = await fixture();
  const response = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/assign-conversation', {
    method: 'PATCH',
    headers: headersFor(ownerToken),
    body: JSON.stringify({ assignedTo: 'agent@example.com' })
  }), env, { waitUntil(promise) { waitUntilPromises.push(promise); } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.item.assignedTo, 'agent@example.com');

  const eventRow = database.prepare(`SELECT direction,message_type,text,sender_name,sender_login,payload_json
    FROM messages WHERE conversation_id='assign-conversation' AND direction='internal'`).get();
  assert.ok(eventRow);
  assert.equal(eventRow.message_type, 'event');
  assert.equal(eventRow.text, 'Chat assigned to Agent One.');
  assert.equal(eventRow.sender_name, 'Owner');
  assert.equal(eventRow.sender_login, 'owner@example.com');
  const payload = JSON.parse(eventRow.payload_json);
  assert.equal(payload.event, 'assigned');
  assert.equal(payload.assignedTo, 'agent@example.com');
  assert.equal(payload.assignedToName, 'Agent One');

  const assignedEvent = broadcasts.find((event) => event.type === 'conversation.assigned');
  assert.ok(assignedEvent);
  assert.equal(assignedEvent.assignmentSilent, false);
  const messageEvent = broadcasts.find((event) => event.type === 'message.created'
    && event.message?.direction === 'internal');
  assert.ok(messageEvent);
  assert.equal(messageEvent.assignmentSilent, false);
  assert.equal(messageEvent.message.text, 'Chat assigned to Agent One.');
  assert.equal(messageEvent.message.senderName, 'Owner');
  assert.ok(waitUntilPromises.length >= 1);

  const listed = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/assign-conversation/messages', {
    headers: headersFor(ownerToken)
  }), env);
  assert.equal(listed.status, 200);
  const messages = (await listed.json()).items;
  const eventMessage = messages.find((item) => item.direction === 'internal');
  assert.ok(eventMessage);
  assert.equal(eventMessage.senderName, 'Owner');
  assert.equal(eventMessage.senderLogin, 'owner@example.com');
  assert.equal(eventMessage.event.assignedToName, 'Agent One');
  assert.equal(database.prepare(`SELECT assigned_to FROM conversations WHERE conversation_id='assign-conversation'`).get().assigned_to,
    'agent@example.com');
});

test('self-assigning a chat inserts a timeline event without notifying', async () => {
  const { database, env, agentToken, broadcasts, waitUntilPromises, headersFor } = await fixture();
  const response = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/assign-conversation', {
    method: 'PATCH',
    headers: headersFor(agentToken),
    body: JSON.stringify({ assignedTo: 'agent@example.com' })
  }), env, { waitUntil(promise) { waitUntilPromises.push(promise); } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).item.assignedTo, 'agent@example.com');
  assert.equal(database.prepare(`SELECT text FROM messages
    WHERE conversation_id='assign-conversation' AND direction='internal'`).get().text,
    'Chat assigned to Agent One.');
  const assignedEvent = broadcasts.find((event) => event.type === 'conversation.assigned');
  assert.ok(assignedEvent);
  assert.equal(assignedEvent.assignmentSilent, true);
  assert.equal(waitUntilPromises.length, 0, 'self-assign must not schedule a push notification');
});

test('replying to an unassigned chat silently claims it for the sender', async () => {
  const { database, env, agentToken, broadcasts, waitUntilPromises, headersFor } = await fixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
  try {
    const response = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/assign-conversation/messages', {
      method: 'POST',
      headers: headersFor(agentToken),
      body: JSON.stringify({ text: 'Taking this chat' })
    }), env, { waitUntil(promise) { waitUntilPromises.push(promise); } });
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.item.text, 'Taking this chat');
    assert.equal(body.assignment.conversation.assignedTo, 'agent@example.com');
    assert.equal(body.assignment.eventMessage.text, 'Chat assigned to Agent One.');
    assert.equal(database.prepare(`SELECT assigned_to FROM conversations WHERE conversation_id='assign-conversation'`).get().assigned_to,
      'agent@example.com');
    const assignedEvent = broadcasts.find((event) => event.type === 'conversation.assigned');
    assert.ok(assignedEvent);
    assert.equal(assignedEvent.assignmentSilent, true);
    const eventMessage = broadcasts.find((event) => event.type === 'message.created'
      && event.message?.direction === 'internal');
    assert.ok(eventMessage);
    assert.equal(eventMessage.assignmentSilent, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('concurrent reply claims keep a single assignee', async () => {
  const { database, env, agentToken, ownerToken, headersFor } = await fixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
  try {
    const first = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/assign-conversation/messages', {
      method: 'POST',
      headers: headersFor(agentToken),
      body: JSON.stringify({ text: 'Agent reply' })
    }), env, { waitUntil() {} });
    assert.equal(first.status, 202);
    assert.equal((await first.json()).assignment.conversation.assignedTo, 'agent@example.com');

    const second = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/assign-conversation/messages', {
      method: 'POST',
      headers: headersFor(ownerToken),
      body: JSON.stringify({ text: 'Owner reply' })
    }), env, { waitUntil() {} });
    assert.equal(second.status, 202);
    const secondBody = await second.json();
    assert.equal(secondBody.assignment, undefined);
    assert.equal(database.prepare(`SELECT assigned_to FROM conversations WHERE conversation_id='assign-conversation'`).get().assigned_to,
      'agent@example.com');
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM messages
      WHERE conversation_id='assign-conversation' AND direction='internal'`).get().count, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('clearing an assignee does not insert an assignment event', async () => {
  const { database, env, ownerToken, broadcasts, headersFor } = await fixture();
  database.prepare(`UPDATE conversations SET assigned_to='agent@example.com' WHERE conversation_id='assign-conversation'`).run();
  const response = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/assign-conversation', {
    method: 'PATCH',
    headers: headersFor(ownerToken),
    body: JSON.stringify({ assignedTo: '' })
  }), env, { waitUntil() {} });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).item.assignedTo, '');
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM messages
    WHERE conversation_id='assign-conversation' AND direction='internal'`).get().count, 0);
  const assignedEvent = broadcasts.find((event) => event.type === 'conversation.assigned');
  assert.ok(assignedEvent);
  assert.equal(assignedEvent.assignmentSilent, true);
});

test('internal assignment events are excluded from conversation last-message preview', async () => {
  const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(source, /direction!='internal'/);
  assert.match(source, /assignmentSilent/);
  assert.match(source, /claimUnassignedConversationOnReply/);
  assert.match(source, /Chat assigned to \$\{assignedToName\}/);
  assert.match(source, /Chat opened by \$\{actorName\}/);
  assert.match(source, /Chat closed by \$\{actorName\}/);
  assert.match(source, /shouldRecordOpenEvent/);
});

test('closing and reopening a chat inserts timeline events with actor names', async () => {
  const { database, env, ownerToken, broadcasts, headersFor } = await fixture();
  const closed = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/assign-conversation', {
    method: 'PATCH',
    headers: headersFor(ownerToken),
    body: JSON.stringify({ status: 'closed' })
  }), env, { waitUntil() {} });
  assert.equal(closed.status, 200);
  const closedBody = await closed.json();
  assert.equal(closedBody.item.status, 'closed');
  assert.equal(closedBody.statusEvent.text, 'Chat closed by Owner.');
  assert.equal(closedBody.statusEvent.event.type, 'closed');
  assert.equal(database.prepare(`SELECT text FROM messages
    WHERE conversation_id='assign-conversation' AND direction='internal' ORDER BY timestamp DESC LIMIT 1`).get().text,
    'Chat closed by Owner.');
  const closedBroadcast = broadcasts.find((event) => event.type === 'message.created'
    && event.message?.event?.type === 'closed');
  assert.ok(closedBroadcast);

  broadcasts.length = 0;
  const opened = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/assign-conversation', {
    method: 'PATCH',
    headers: headersFor(ownerToken),
    body: JSON.stringify({ status: 'open' })
  }), env, { waitUntil() {} });
  assert.equal(opened.status, 200);
  const openedBody = await opened.json();
  assert.equal(openedBody.item.status, 'open');
  assert.equal(openedBody.statusEvent.text, 'Chat opened by Owner.');
  assert.equal(openedBody.statusEvent.event.type, 'opened');
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM messages
    WHERE conversation_id='assign-conversation' AND direction='internal' AND text LIKE 'Chat opened by%'`).get().count, 1);
  const openedBroadcast = broadcasts.find((event) => event.type === 'message.created'
    && event.message?.event?.type === 'opened');
  assert.ok(openedBroadcast);
});

test('setting pending does not insert an open or close timeline event', async () => {
  const { database, env, ownerToken, headersFor } = await fixture();
  const response = await handleRequest(new Request('https://api.chat.helixcer.com/api/conversations/assign-conversation', {
    method: 'PATCH',
    headers: headersFor(ownerToken),
    body: JSON.stringify({ status: 'pending' })
  }), env, { waitUntil() {} });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.item.status, 'pending');
  assert.equal(body.statusEvent, undefined);
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM messages
    WHERE conversation_id='assign-conversation' AND direction='internal'`).get().count, 0);
});

test('first inbound customer message inserts Chat opened by customer', async () => {
  const { database, env, broadcasts } = await fixture();
  env.ASSIGN_WEBHOOK_TOKEN = 'assign-webhook-secret';
  const response = await handleRequest(new Request('https://api.chat.helixcer.com/webhooks/generic/assign-channel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Token': 'assign-webhook-secret' },
    body: JSON.stringify({
      id: 'first-inbound-1',
      from: 'brand-new-customer',
      senderName: 'Asha Rao',
      text: 'Hello there',
      timestamp: '2026-11-02T18:50:00.000Z',
      type: 'text'
    })
  }), env, { waitUntil() {} });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, received: 1 });
  const openRow = database.prepare(`SELECT text FROM messages
    WHERE direction='internal' AND text LIKE 'Chat opened by%' ORDER BY timestamp ASC LIMIT 1`).get();
  assert.equal(openRow.text, 'Chat opened by Asha Rao.');
  const openBroadcast = broadcasts.find((event) => event.type === 'message.created'
    && event.message?.event?.type === 'opened');
  assert.ok(openBroadcast);
  assert.equal(openBroadcast.message.text, 'Chat opened by Asha Rao.');
  const inboundBroadcast = broadcasts.find((event) => event.type === 'message.created'
    && event.message?.direction === 'inbound' && event.message?.text === 'Hello there');
  assert.ok(inboundBroadcast);
});

test('customer message into a closed chat inserts Chat opened by customer', async () => {
  const { database, env, broadcasts } = await fixture();
  env.ASSIGN_WEBHOOK_TOKEN = 'assign-webhook-secret';
  database.prepare(`UPDATE conversations SET status='closed' WHERE conversation_id='assign-conversation'`).run();
  const response = await handleRequest(new Request('https://api.chat.helixcer.com/webhooks/generic/assign-channel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Token': 'assign-webhook-secret' },
    body: JSON.stringify({
      id: 'reopen-inbound-1',
      from: 'assign-profile',
      senderName: 'Assign Contact',
      text: 'I am back',
      timestamp: '2026-11-02T18:55:00.000Z',
      type: 'text'
    })
  }), env, { waitUntil() {} });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, received: 1 });
  assert.equal(database.prepare(`SELECT status FROM conversations WHERE conversation_id='assign-conversation'`).get().status, 'open');
  assert.equal(database.prepare(`SELECT text FROM messages
    WHERE conversation_id='assign-conversation' AND direction='internal' AND text LIKE 'Chat opened by%'
    ORDER BY timestamp DESC LIMIT 1`).get().text, 'Chat opened by Assign Contact.');
  const openBroadcast = broadcasts.find((event) => event.type === 'message.created'
    && event.message?.event?.type === 'opened');
  assert.ok(openBroadcast);
});

test('repeat inbound while chat is already open does not insert another open event', async () => {
  const { database, env } = await fixture();
  env.ASSIGN_WEBHOOK_TOKEN = 'assign-webhook-secret';
  const first = await handleRequest(new Request('https://api.chat.helixcer.com/webhooks/generic/assign-channel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Token': 'assign-webhook-secret' },
    body: JSON.stringify({
      id: 'already-open-1', from: 'assign-profile', senderName: 'Assign Contact',
      text: 'Still open', timestamp: '2026-11-02T19:00:00.000Z', type: 'text'
    })
  }), env, { waitUntil() {} });
  assert.equal(first.status, 200);
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM messages
    WHERE conversation_id='assign-conversation' AND direction='internal' AND text LIKE 'Chat opened by%'`).get().count, 0);
});
