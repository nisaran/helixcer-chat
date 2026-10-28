import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const migrationsBeforeContactIdentities = [
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
  '0011_mobile_push_devices.sql'
];

async function databaseBeforeContactIdentityMigration() {
  const database = new DatabaseSync(':memory:');
  for (const name of migrationsBeforeContactIdentities) {
    database.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  return database;
}

function insertChannel(database, workspaceId, channelId, providerType) {
  const connectorType = providerType === 'instagram' ? 'generic_http' : providerType;
  database.prepare(`INSERT INTO channels
      (channel_id,name,connector_type,provider_type,enabled,capabilities_json,config_json,
       secret_key,created_at,updated_at,workspace_id)
    VALUES (?1,?2,?3,?4,1,'["text"]','{}','DATABASE','2026-01-01','2026-01-01',?5)`)
    .run(channelId, channelId, connectorType, providerType, workspaceId);
}

function insertContact(database, workspaceId, contactId) {
  database.prepare(`INSERT INTO contacts
      (contact_id,display_name,company,tags_json,created_at,updated_at,workspace_id)
    VALUES (?1,?1,'','[]','2026-01-01','2026-01-01',?2)`)
    .run(contactId, workspaceId);
}

function insertLegacyIdentity(database, workspaceId, identityId, contactId, channelId, profileId, createdAt) {
  database.prepare(`INSERT INTO channel_identities
      (identity_id,contact_id,channel_id,channel_profile_id,display_name,metadata_json,created_at,workspace_id)
    VALUES (?1,?2,?3,?4,?2,'{}',?5,?6)`)
    .run(identityId, contactId, channelId, profileId, createdAt, workspaceId);
}

function insertConversation(database, workspaceId, conversationId, contactId, channelId) {
  database.prepare(`INSERT INTO conversations
      (conversation_id,contact_id,channel_id,status,subject,last_message_at,unread_count,
       created_at,updated_at,workspace_id)
    VALUES (?1,?2,?3,'open',?2,'2026-02-01',0,'2026-01-01','2026-02-01',?4)`)
    .run(conversationId, contactId, channelId, workspaceId);
}

function insertMessage(database, workspaceId, messageId, conversationId, contactId, channelId) {
  database.prepare(`INSERT INTO messages
      (message_id,conversation_id,contact_id,channel_id,direction,message_type,text,status,timestamp,workspace_id)
    VALUES (?1,?2,?3,?4,'inbound','text','hello','received','2026-02-01',?5)`)
    .run(messageId, conversationId, contactId, channelId, workspaceId);
}

test('contact identity migration preserves scoped routes without auto-merging master contacts', async () => {
  const database = await databaseBeforeContactIdentityMigration();
  try {
    const workspaceId = database.prepare("SELECT workspace_id FROM workspaces WHERE slug='default'").get().workspace_id;
    for (const channelId of ['wa-one', 'wa-two', 'wa-three', 'wa-clear', 'wa-ambiguous']) {
      insertChannel(database, workspaceId, channelId, 'whatsapp_cloud');
    }
    for (const contactId of ['contact-shared', 'contact-separate', 'contact-clear', 'contact-ambiguous']) {
      insertContact(database, workspaceId, contactId);
    }

    // The same contact and provider identity was seen through two connected accounts.
    insertLegacyIdentity(database, workspaceId, 'identity-shared-old', 'contact-shared', 'wa-one', '919100000001', '2026-01-01');
    insertLegacyIdentity(database, workspaceId, 'identity-shared-new', 'contact-shared', 'wa-two', '919100000001', '2026-01-02');

    // Matching provider text on another master contact must never merge contacts automatically.
    insertLegacyIdentity(database, workspaceId, 'identity-separate', 'contact-separate', 'wa-three', '919100000001', '2026-01-03');

    // One exact route is safe to backfill to conversations and messages.
    insertLegacyIdentity(database, workspaceId, 'identity-clear', 'contact-clear', 'wa-clear', '919100000002', '2026-01-01');
    insertConversation(database, workspaceId, 'conversation-clear', 'contact-clear', 'wa-clear');
    insertMessage(database, workspaceId, 'message-clear', 'conversation-clear', 'contact-clear', 'wa-clear');

    // Two identities on one legacy contact/channel are intentionally not guessed.
    insertLegacyIdentity(database, workspaceId, 'identity-ambiguous-a', 'contact-ambiguous', 'wa-ambiguous', '919100000003', '2026-01-01');
    insertLegacyIdentity(database, workspaceId, 'identity-ambiguous-b', 'contact-ambiguous', 'wa-ambiguous', '919100000004', '2026-01-02');
    insertConversation(database, workspaceId, 'conversation-ambiguous', 'contact-ambiguous', 'wa-ambiguous');
    insertMessage(database, workspaceId, 'message-ambiguous', 'conversation-ambiguous', 'contact-ambiguous', 'wa-ambiguous');

    database.exec(await readFile(new URL('../migrations/0012_contact_identities.sql', import.meta.url), 'utf8'));
    database.exec(await readFile(new URL('../migrations/0013_flat_contact_platform_ids.sql', import.meta.url), 'utf8'));

    const sharedIdentities = database.prepare(`SELECT identity_id,contact_id,platform,profile_id
      FROM contact_identities WHERE workspace_id=? AND profile_id='919100000001'
      ORDER BY contact_id`).all(workspaceId).map(row => ({ ...row }));
    assert.deepEqual(sharedIdentities, [
      { identity_id: 'identity-separate', contact_id: 'contact-separate', platform: 'whatsapp', profile_id: '919100000001' },
      { identity_id: 'identity-shared-old', contact_id: 'contact-shared', platform: 'whatsapp', profile_id: '919100000001' }
    ]);

    assert.deepEqual(database.prepare(`SELECT channel_id,scoped_profile_id
      FROM channel_identity_bindings WHERE identity_id='identity-shared-old' ORDER BY channel_id`).all()
      .map(row => ({ ...row })), [
      { channel_id: 'wa-one', scoped_profile_id: '919100000001' },
      { channel_id: 'wa-two', scoped_profile_id: '919100000001' }
    ]);

    assert.equal(database.prepare("SELECT identity_id FROM conversations WHERE conversation_id='conversation-clear'").get().identity_id,
      'identity-clear');
    assert.equal(database.prepare("SELECT identity_id FROM messages WHERE message_id='message-clear'").get().identity_id,
      'identity-clear');
    assert.equal(database.prepare("SELECT identity_id FROM conversations WHERE conversation_id='conversation-ambiguous'").get().identity_id,
      '');
    assert.equal(database.prepare("SELECT identity_id FROM messages WHERE message_id='message-ambiguous'").get().identity_id,
      '');

    const ambiguousFlat = database.prepare(`SELECT platform,profile_id,identity_id
      FROM contact_platform_ids WHERE workspace_id=? AND contact_id='contact-ambiguous'`).all(workspaceId);
    assert.equal(ambiguousFlat.length, 1);
    assert.equal(ambiguousFlat[0].platform, 'whatsapp');
    assert.ok(['identity-ambiguous-a', 'identity-ambiguous-b'].includes(ambiguousFlat[0].identity_id));
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM contact_identities
      WHERE workspace_id=? AND contact_id='contact-ambiguous' AND platform='whatsapp'`).get(workspaceId).count, 2,
    'migration must preserve the non-selected historical identity');

    // An inactive historical route may coexist, while duplicate active routes may not.
    database.prepare(`INSERT INTO channel_identity_bindings
        (binding_id,workspace_id,identity_id,channel_id,scoped_profile_id,active,
         first_seen_at,last_seen_at,created_at,updated_at)
      VALUES ('binding-history',?1,'identity-separate','wa-three','919100000001',0,
        '2025-01-01','2025-02-01','2025-01-01','2025-02-01')`).run(workspaceId);
    assert.throws(() => database.prepare(`INSERT INTO channel_identity_bindings
        (binding_id,workspace_id,identity_id,channel_id,scoped_profile_id,active,
         first_seen_at,last_seen_at,created_at,updated_at)
      VALUES ('binding-active-conflict',?1,'identity-shared-old','wa-three','919100000001',1,
        '2026-01-01','2026-01-01','2026-01-01','2026-01-01')`).run(workspaceId), /UNIQUE/i);

    // Ambiguous legacy conversations retain their old race-protection constraint.
    assert.throws(() => database.prepare(`INSERT INTO conversations
        (conversation_id,contact_id,channel_id,status,last_message_at,created_at,updated_at,workspace_id,identity_id)
      VALUES ('conversation-ambiguous-duplicate','contact-ambiguous','wa-ambiguous','open',
        '2026-03-01','2026-03-01','2026-03-01',?1,'')`).run(workspaceId), /UNIQUE/i);

    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    database.close();
  }
});
