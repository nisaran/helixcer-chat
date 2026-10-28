import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const migrationsBeforeUnifiedThreads = [
  '0001_initial.sql',
  '0002_identity_and_workspaces.sql',
  '0003_whatsapp_channel.sql',
  '0004_multichannel_credentials.sql',
  '0005_external_template_api.sql',
  '0006_contact_profiles.sql',
  '0007_conversation_uniqueness.sql',
  '0008_push_subscriptions.sql',
  '0009_workspace_profile.sql',
  '0010_workspace_uuid.sql',
  '0011_mobile_push_devices.sql',
  '0012_contact_identities.sql',
  '0013_flat_contact_platform_ids.sql'
];

async function databaseBeforeUnifiedThreadMigration() {
  const database = new DatabaseSync(':memory:');
  for (const name of migrationsBeforeUnifiedThreads) {
    database.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  return database;
}

function insertChannel(database, workspaceId, channelId, connectorType, name) {
  database.prepare(`INSERT INTO channels
      (channel_id,name,connector_type,provider_type,enabled,capabilities_json,config_json,
       secret_key,created_at,updated_at,workspace_id)
    VALUES (?1,?2,?3,?3,1,'["text"]','{}','DATABASE','2026-01-01','2026-01-01',?4)`)
    .run(channelId, name, connectorType, workspaceId);
}

function insertIdentity(database, workspaceId, identityId, contactId, platform, profileId, channelId,
  lastInboundAt, conversationId) {
  database.prepare(`INSERT INTO contact_identities
      (identity_id,workspace_id,contact_id,platform,profile_id,display_name,created_at,updated_at)
    VALUES (?1,?2,?3,?4,?5,?3,'2026-01-01','2026-01-01')`)
    .run(identityId, workspaceId, contactId, platform, profileId);
  database.prepare(`INSERT INTO channel_identity_bindings
      (binding_id,workspace_id,identity_id,channel_id,scoped_profile_id,active,
       first_seen_at,last_seen_at,last_inbound_at,last_conversation_id,created_at,updated_at)
    VALUES (?1,?2,?3,?4,?5,1,'2026-01-01',?6,?6,?7,'2026-01-01',?6)`)
    .run(`binding-${identityId}`, workspaceId, identityId, channelId, profileId, lastInboundAt, conversationId);
  database.prepare(`INSERT INTO contact_platform_ids
      (workspace_id,contact_id,platform,profile_id,identity_id,created_at,updated_at)
    VALUES (?1,?2,?3,?4,?5,'2026-01-01','2026-01-01')`)
    .run(workspaceId, contactId, platform, profileId, identityId);
}

function insertConversation(database, workspaceId, conversationId, contactId, channelId, identityId,
  status, unreadCount, lastMessageAt, createdAt) {
  database.prepare(`INSERT INTO conversations
      (conversation_id,contact_id,channel_id,identity_id,status,subject,last_message_at,unread_count,
       created_at,updated_at,workspace_id)
    VALUES (?1,?2,?3,?4,?5,?2,?6,?7,?8,?6,?9)`)
    .run(conversationId, contactId, channelId, identityId, status, lastMessageAt, unreadCount, createdAt, workspaceId);
}

function insertMessage(database, workspaceId, messageId, conversationId, contactId, channelId, identityId,
  direction, text, timestamp) {
  database.prepare(`INSERT INTO messages
      (message_id,conversation_id,contact_id,channel_id,identity_id,direction,message_type,text,status,timestamp,workspace_id)
    VALUES (?1,?2,?3,?4,?5,?6,'text',?7,'received',?8,?9)`)
    .run(messageId, conversationId, contactId, channelId, identityId, direction, text, timestamp, workspaceId);
}

test('0014 merges provider threads by contact while preserving exact message routes', async () => {
  const database = await databaseBeforeUnifiedThreadMigration();
  try {
    const workspaceId = database.prepare("SELECT workspace_id FROM workspaces WHERE slug='default'").get().workspace_id;
    insertChannel(database, workspaceId, 'wa-main', 'whatsapp_cloud', 'WhatsApp Main');
    insertChannel(database, workspaceId, 'tg-main', 'telegram', 'Telegram Main');
    database.prepare(`INSERT INTO contacts
        (contact_id,display_name,company,tags_json,created_at,updated_at,workspace_id)
      VALUES ('contact-one','One customer','','[]','2026-01-01','2026-03-01',?1),
             ('contact-two','Other customer','','[]','2026-01-01','2026-03-01',?1)`)
      .run(workspaceId);

    insertIdentity(database, workspaceId, 'identity-wa', 'contact-one', 'whatsapp', '919100000001',
      'wa-main', '2026-02-01T10:00:00Z', 'conversation-wa');
    insertIdentity(database, workspaceId, 'identity-tg', 'contact-one', 'telegram', '700001',
      'tg-main', '2026-03-01T10:00:00Z', 'conversation-tg');
    insertIdentity(database, workspaceId, 'identity-other', 'contact-two', 'telegram', '700002',
      'tg-main', '2026-03-02T10:00:00Z', 'conversation-other');

    insertConversation(database, workspaceId, 'conversation-wa', 'contact-one', 'wa-main', 'identity-wa',
      'open', 2, '2026-02-01T10:00:00Z', '2026-01-01T00:00:00Z');
    insertConversation(database, workspaceId, 'conversation-tg', 'contact-one', 'tg-main', 'identity-tg',
      'closed', 3, '2026-03-01T10:00:00Z', '2026-02-01T00:00:00Z');
    insertConversation(database, workspaceId, 'conversation-other', 'contact-two', 'tg-main', 'identity-other',
      'pending', 1, '2026-03-02T10:00:00Z', '2026-02-02T00:00:00Z');

    insertMessage(database, workspaceId, 'message-wa', 'conversation-wa', 'contact-one', 'wa-main', 'identity-wa',
      'inbound', 'WhatsApp hello', '2026-02-01T10:00:00Z');
    insertMessage(database, workspaceId, 'message-tg', 'conversation-tg', 'contact-one', 'tg-main', 'identity-tg',
      'inbound', 'Telegram hello', '2026-03-01T10:00:00Z');
    insertMessage(database, workspaceId, 'message-other', 'conversation-other', 'contact-two', 'tg-main', 'identity-other',
      'inbound', 'Other hello', '2026-03-02T10:00:00Z');

    database.prepare(`INSERT INTO identity_migration_issues
        (issue_id,workspace_id,conversation_id,issue_type,candidate_count,created_at)
      VALUES ('issue-wa',?1,'conversation-wa','test',1,'2026-02-01')`).run(workspaceId);

    database.exec(await readFile(new URL('../migrations/0014_unified_contact_conversations.sql', import.meta.url), 'utf8'));

    const contactThreads = database.prepare(`SELECT conversation_id,status,unread_count,channel_id,identity_id,
        created_at,last_message_at
      FROM conversations WHERE workspace_id=? AND contact_id='contact-one'`).all(workspaceId);
    assert.equal(contactThreads.length, 1);
    const { status: mergedStatus, ...mergedThread } = contactThreads[0];
    assert.deepEqual({ ...mergedThread }, {
      conversation_id: 'conversation-tg',
      unread_count: 5,
      channel_id: 'tg-main',
      identity_id: 'identity-tg',
      created_at: '2026-01-01T00:00:00Z',
      last_message_at: '2026-03-01T10:00:00Z'
    });

    assert.deepEqual(database.prepare(`SELECT message_id,conversation_id,channel_id,identity_id,
        route_connector_type,route_channel_name,route_channel_profile_id
      FROM messages WHERE workspace_id=? AND contact_id='contact-one' ORDER BY message_id`).all(workspaceId)
      .map(row => ({ ...row })), [
      {
        message_id: 'message-tg', conversation_id: 'conversation-tg', channel_id: 'tg-main', identity_id: 'identity-tg',
        route_connector_type: 'telegram', route_channel_name: 'Telegram Main', route_channel_profile_id: '700001'
      },
      {
        message_id: 'message-wa', conversation_id: 'conversation-tg', channel_id: 'wa-main', identity_id: 'identity-wa',
        route_connector_type: 'whatsapp_cloud', route_channel_name: 'WhatsApp Main', route_channel_profile_id: '919100000001'
      }
    ]);
    assert.equal(database.prepare("SELECT last_conversation_id FROM channel_identity_bindings WHERE identity_id='identity-wa'").get().last_conversation_id,
      'conversation-tg');
    assert.equal(database.prepare("SELECT conversation_id FROM identity_migration_issues WHERE issue_id='issue-wa'").get().conversation_id,
      'conversation-tg');

    assert.deepEqual({ ...database.prepare(`SELECT conversation_id,status,unread_count
      FROM conversations WHERE workspace_id=? AND contact_id='contact-two'`).get(workspaceId) }, {
      conversation_id: 'conversation-other', status: 'pending', unread_count: 1
    });
    assert.throws(() => insertConversation(database, workspaceId, 'conversation-duplicate', 'contact-one',
      'wa-main', 'identity-wa', 'open', 0, '2026-04-01', '2026-04-01'), /UNIQUE/i);
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(mergedStatus, 'open', 'an open source thread must keep the merged contact thread open');
  } finally {
    database.close();
  }
});

test('0014 snapshots route metadata for messages inserted after migration', async () => {
  const database = await databaseBeforeUnifiedThreadMigration();
  try {
    const workspaceId = database.prepare("SELECT workspace_id FROM workspaces WHERE slug='default'").get().workspace_id;
    insertChannel(database, workspaceId, 'wa-main', 'whatsapp_cloud', 'WhatsApp Main');
    database.prepare(`INSERT INTO contacts
        (contact_id,display_name,company,tags_json,created_at,updated_at,workspace_id)
      VALUES ('contact-one','One customer','','[]','2026-01-01','2026-01-01',?1)`).run(workspaceId);
    insertIdentity(database, workspaceId, 'identity-wa', 'contact-one', 'whatsapp', '919100000001',
      'wa-main', '2026-02-01T10:00:00Z', 'conversation-wa');
    insertConversation(database, workspaceId, 'conversation-wa', 'contact-one', 'wa-main', 'identity-wa',
      'open', 0, '2026-02-01T10:00:00Z', '2026-01-01T00:00:00Z');
    database.exec(await readFile(new URL('../migrations/0014_unified_contact_conversations.sql', import.meta.url), 'utf8'));

    insertMessage(database, workspaceId, 'message-new', 'conversation-wa', 'contact-one', 'wa-main', 'identity-wa',
      'outbound', 'After migration', '2026-04-01T10:00:00Z');
    const snapshot = database.prepare(`SELECT route_connector_type,route_channel_name,route_channel_profile_id
      FROM messages WHERE message_id='message-new'`).get();
    assert.deepEqual({ ...snapshot }, {
      route_connector_type: 'whatsapp_cloud',
      route_channel_name: 'WhatsApp Main',
      route_channel_profile_id: '919100000001'
    });

    database.prepare("UPDATE channels SET name='Renamed account' WHERE channel_id='wa-main'").run();
    assert.equal(database.prepare("SELECT route_channel_name FROM messages WHERE message_id='message-new'").get().route_channel_name,
      'WhatsApp Main');
  } finally {
    database.close();
  }
});
