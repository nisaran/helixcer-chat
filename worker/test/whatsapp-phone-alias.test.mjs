import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import {
  expandWhatsAppRecipientForBusiness,
  handleRequest,
  normalizeWhatsAppRecipient,
  whatsappProfileIdsEquivalent
} from '../src/index.js';

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

async function testDatabase() {
  const database = new DatabaseSync(':memory:');
  const migrations = [
    '0001_initial.sql', '0002_identity_and_workspaces.sql', '0003_whatsapp_channel.sql',
    '0004_multichannel_credentials.sql', '0005_external_template_api.sql', '0006_contact_profiles.sql',
    '0007_conversation_uniqueness.sql', '0008_push_subscriptions.sql', '0009_workspace_profile.sql',
    '0011_mobile_push_devices.sql', '0012_contact_identities.sql', '0013_flat_contact_platform_ids.sql',
    '0014_unified_contact_conversations.sql', '0015_saas_clients.sql', '0016_internal_slug.sql',
    '0017_agent_channel_access.sql', '0019_outbound_sender.sql', '0020_user_profile.sql',
    '0021_campaigns.sql', '0022_facebook_messenger_page.sql', '0023_workspace_roles.sql',
    '0024_password_auth.sql', '0025_campaign_jobs.sql', '0026_campaign_upload_chunks.sql',
    '0027_google_reviews_oauth.sql'
  ];
  for (const name of migrations) {
    database.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  return { database, DB: new TestD1(database) };
}

function envFor(DB, overrides = {}) {
  return {
    DB,
    APP_NAME: 'Helixcer Chat',
    APP_ORIGIN: 'https://chat.helixcer.com',
    ALLOWED_ORIGINS: 'https://chat.helixcer.com',
    ADMIN_TOKEN: 'recovery-secret',
    RECOVERY_MODE: 'true',
    CHANNEL_CREDENTIALS_KEY: 'test-channel-master-key-material-'.repeat(2),
    ...overrides
  };
}

test('WhatsApp profile ids match with or without country code', () => {
  assert.equal(whatsappProfileIdsEquivalent('918129955580', '8129955580'), true);
  assert.equal(whatsappProfileIdsEquivalent('8129955580', '918129955580'), true);
  assert.equal(whatsappProfileIdsEquivalent('918129955580', '918129955580'), true);
  assert.equal(whatsappProfileIdsEquivalent('918129955580', '918129955581'), false);
  assert.equal(whatsappProfileIdsEquivalent('5580', '918129955580'), false);
  assert.equal(normalizeWhatsAppRecipient('8129955580'), '8129955580');
  assert.equal(expandWhatsAppRecipientForBusiness('8129955580', '91 62820 10794'), '918129955580');
  assert.equal(expandWhatsAppRecipientForBusiness('918129955580', '916282010794'), '918129955580');
  assert.equal(expandWhatsAppRecipientForBusiness('8129955580', ''), '8129955580');
});

test('campaign Excel local number keeps thread when WhatsApp replies with country-coded wa_id', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const headers = { Authorization: 'Bearer recovery-secret', 'Content-Type': 'application/json' };
  const channelId = 'wa-campaign-alias';
  const phoneNumberId = '123456789012399';
  const appSecret = 'abcdef1234567890abcdef1234567890';
  const created = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST', headers,
    body: JSON.stringify({
      channelId, name: 'Campaign alias WhatsApp', connectorType: 'whatsapp_cloud', enabled: true,
      config: { wabaId: '123456789012345', phoneNumberId, apiVersion: 'v26.0' },
      credentials: {
        accessToken: 'campaign-alias-access-token-1234567890', appSecret, verifyToken: 'verify-token-value'
      }
    })
  }), env);
  assert.equal(created.status, 201, await created.clone().text());
  database.prepare(`UPDATE channels SET config_json=json_set(config_json,
      '$.verifiedPhoneNumber',?, '$.credentialsVerifiedAt',?, '$.verifiedProviderId',?)
    WHERE channel_id=?`)
    .run('916282010794', '2026-01-01T00:00:00.000Z', phoneNumberId, channelId);

  const workspaceId = database.prepare('SELECT workspace_id FROM workspaces ORDER BY created_at LIMIT 1')
    .get().workspace_id;
  const now = '2026-11-07T13:03:54.000Z';
  const contactId = 'excel-contact';
  const identityId = 'excel-identity';
  const conversationId = 'excel-conversation';
  const campaignMessageId = 'campaign-template-1';
  database.prepare(`INSERT INTO contacts (contact_id,display_name,created_at,updated_at,workspace_id)
    VALUES (?,?,?,?,?)`).run(contactId, 'Muhsina', now, now, workspaceId);
  database.prepare(`INSERT INTO contact_identities
      (identity_id,workspace_id,contact_id,platform,profile_id,phone_number,display_name,created_at,updated_at)
    VALUES (?,?,?,'whatsapp','8129955580','8129955580','Muhsina',?,?)`)
    .run(identityId, workspaceId, contactId, now, now);
  database.prepare(`INSERT INTO channel_identity_bindings
      (binding_id,workspace_id,identity_id,channel_id,scoped_profile_id,active,first_seen_at,last_seen_at,created_at,updated_at)
    VALUES ('excel-binding',?,?,?,'8129955580',1,?,?,?,?)`)
    .run(workspaceId, identityId, channelId, now, now, now, now);
  database.prepare(`INSERT INTO conversations
      (conversation_id,contact_id,channel_id,identity_id,status,subject,last_message_at,unread_count,created_at,updated_at,workspace_id)
    VALUES (?,?,?,?,'closed','Muhsina',?,0,?,?,?)`)
    .run(conversationId, contactId, channelId, identityId, now, now, now, workspaceId);
  database.prepare(`INSERT INTO messages
      (message_id,conversation_id,contact_id,channel_id,identity_id,direction,message_type,text,status,timestamp,workspace_id)
    VALUES (?,?,?,?,?,'outbound','template','Recharge reminder','read',?,?)`)
    .run(campaignMessageId, conversationId, contactId, channelId, identityId, now, workspaceId);
  database.prepare(`INSERT INTO campaigns
      (campaign_id,workspace_id,name,channel_id,audience_source,message_type,template_name,template_language,
       message_body,variable_mapping_json,field_mapping_json,status,total_count,pending_count,sent_count,
       delivered_count,read_count,failed_count,created_by,created_at,updated_at,completed_at)
    VALUES ('camp-1',?,'Test',?,'upload','template','recharge','en','','{}','{}','completed',1,0,1,1,1,0,'',?,?,'')`)
    .run(workspaceId, channelId, now, now);
  database.prepare(`INSERT INTO campaign_recipients
      (recipient_id,campaign_id,workspace_id,contact_id,conversation_id,message_id,display_name,profile_id,
       row_json,status,error,created_at,updated_at)
    VALUES ('recipient-1','camp-1',?,?,?,?,'Muhsina','8129955580','{}','read','',?,?)`)
    .run(workspaceId, contactId, conversationId, campaignMessageId, now, now);

  const broadcasts = [];
  env.INBOX_HUB = {
    idFromName: value => value,
    get: () => ({
      fetch: async (url, init = {}) => {
        if (String(url).endsWith('/broadcast')) broadcasts.push(JSON.parse(init.body));
        return new Response(null, { status: 204 });
      }
    })
  };

  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '916282010794', phone_number_id: phoneNumberId },
          contacts: [{ profile: { name: 'Muhsi Nisu' }, wa_id: '918129955580' }],
          messages: [{
            from: '918129955580', id: 'wamid.reply-thumb', timestamp: '1762520659',
            type: 'text', text: { body: '👍' }
          }]
        }
      }]
    }]
  };
  const raw = JSON.stringify(payload);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  const signature = `sha256=${Buffer.from(digest).toString('hex')}`;

  const delivered = await handleRequest(new Request(
    `https://api.chat.helixcer.com/webhooks/whatsapp/${channelId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
      body: raw
    }), env);
  assert.equal(delivered.status, 200);
  assert.deepEqual(await delivered.json(), { ok: true, received: 1, statuses: 0 });

  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM contacts WHERE workspace_id=?')
    .get(workspaceId).count, 1);
  const contact = database.prepare('SELECT display_name FROM contacts WHERE contact_id=?').get(contactId);
  assert.equal(contact.display_name, 'Muhsina');

  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM conversations WHERE workspace_id=?')
    .get(workspaceId).count, 1);
  const inbound = database.prepare(`SELECT conversation_id,text,direction FROM messages
    WHERE workspace_id=? AND direction='inbound'`).get(workspaceId);
  assert.equal(inbound.conversation_id, conversationId);
  assert.equal(inbound.text, '👍');

  const campaignStillThere = database.prepare(`SELECT message_id FROM messages
    WHERE conversation_id=? AND message_id=?`).get(conversationId, campaignMessageId);
  assert.ok(campaignStillThere);

  const identity = database.prepare(`SELECT profile_id FROM contact_identities WHERE identity_id=?`)
    .get(identityId);
  const binding = database.prepare(`SELECT scoped_profile_id FROM channel_identity_bindings
    WHERE identity_id=? AND active=1`).get(identityId);
  assert.equal(identity.profile_id, '918129955580');
  assert.equal(binding.scoped_profile_id, '918129955580');

  database.close();
});

test('reply prefers campaign contact when a country-coded duplicate already exists', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const headers = { Authorization: 'Bearer recovery-secret', 'Content-Type': 'application/json' };
  const channelId = 'wa-campaign-dup';
  const phoneNumberId = '123456789012398';
  const appSecret = 'abcdef1234567890abcdef1234567891';
  const created = await handleRequest(new Request('https://api.chat.helixcer.com/api/channels', {
    method: 'POST', headers,
    body: JSON.stringify({
      channelId, name: 'Campaign dup WhatsApp', connectorType: 'whatsapp_cloud', enabled: true,
      config: { wabaId: '123456789012345', phoneNumberId, apiVersion: 'v26.0' },
      credentials: {
        accessToken: 'campaign-dup-access-token-1234567890', appSecret, verifyToken: 'verify-token-value'
      }
    })
  }), env);
  assert.equal(created.status, 201, await created.clone().text());
  database.prepare(`UPDATE channels SET config_json=json_set(config_json,
      '$.verifiedPhoneNumber',?, '$.credentialsVerifiedAt',?, '$.verifiedProviderId',?)
    WHERE channel_id=?`)
    .run('916282010794', '2026-01-01T00:00:00.000Z', phoneNumberId, channelId);

  const workspaceId = database.prepare('SELECT workspace_id FROM workspaces ORDER BY created_at LIMIT 1')
    .get().workspace_id;
  const now = '2026-11-07T13:03:54.000Z';
  database.prepare(`INSERT INTO contacts (contact_id,display_name,created_at,updated_at,workspace_id)
    VALUES ('excel-contact','Muhsina',?,?,?), ('dup-contact','Muhsi Nisu',?,?,?)`)
    .run(now, now, workspaceId, now, now, workspaceId);
  database.prepare(`INSERT INTO contact_identities
      (identity_id,workspace_id,contact_id,platform,profile_id,phone_number,display_name,created_at,updated_at)
    VALUES ('excel-identity',?,'excel-contact','whatsapp','8129955580','8129955580','Muhsina',?,?),
           ('dup-identity',?,'dup-contact','whatsapp','918129955580','918129955580','Muhsi Nisu',?,?)`)
    .run(workspaceId, now, now, workspaceId, now, now);
  database.prepare(`INSERT INTO channel_identity_bindings
      (binding_id,workspace_id,identity_id,channel_id,scoped_profile_id,active,first_seen_at,last_seen_at,created_at,updated_at)
    VALUES ('excel-binding',?,'excel-identity',?,'8129955580',1,?,?,?,?),
           ('dup-binding',?,'dup-identity',?,'918129955580',1,?,?,?,?)`)
    .run(workspaceId, channelId, now, now, now, now, workspaceId, channelId, now, now, now, now);
  database.prepare(`INSERT INTO conversations
      (conversation_id,contact_id,channel_id,identity_id,status,subject,last_message_at,unread_count,created_at,updated_at,workspace_id)
    VALUES ('excel-conversation','excel-contact',?,'excel-identity','closed','Muhsina',?,0,?,?,?),
           ('dup-conversation','dup-contact',?,'dup-identity','open','Muhsi Nisu',?,0,?,?,?)`)
    .run(channelId, now, now, now, workspaceId, channelId, now, now, now, workspaceId);
  database.prepare(`INSERT INTO messages
      (message_id,conversation_id,contact_id,channel_id,identity_id,direction,message_type,text,status,timestamp,workspace_id)
    VALUES ('campaign-template-1','excel-conversation','excel-contact',?,'excel-identity','outbound','template',
      'Recharge reminder','read',?,?)`)
    .run(channelId, now, workspaceId);
  database.prepare(`INSERT INTO campaigns
      (campaign_id,workspace_id,name,channel_id,audience_source,message_type,template_name,template_language,
       message_body,variable_mapping_json,field_mapping_json,status,total_count,pending_count,sent_count,
       delivered_count,read_count,failed_count,created_by,created_at,updated_at,completed_at)
    VALUES ('camp-dup',?,'Test',?,'upload','template','recharge','en','','{}','{}','completed',1,0,1,1,1,0,'',?,?,'')`)
    .run(workspaceId, channelId, now, now);
  database.prepare(`INSERT INTO campaign_recipients
      (recipient_id,campaign_id,workspace_id,contact_id,conversation_id,message_id,display_name,profile_id,
       row_json,status,error,created_at,updated_at)
    VALUES ('recipient-dup','camp-dup',?,'excel-contact','excel-conversation','campaign-template-1',
      'Muhsina','8129955580','{}','read','',?,?)`)
    .run(workspaceId, now, now);

  env.INBOX_HUB = {
    idFromName: value => value,
    get: () => ({ fetch: async () => new Response(null, { status: 204 }) })
  };

  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '916282010794', phone_number_id: phoneNumberId },
          contacts: [{ profile: { name: 'Muhsi Nisu' }, wa_id: '918129955580' }],
          messages: [{
            from: '918129955580', id: 'wamid.reply-after-dup', timestamp: '1762520700',
            type: 'text', text: { body: 'hello again' }
          }]
        }
      }]
    }]
  };
  const raw = JSON.stringify(payload);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  const signature = `sha256=${Buffer.from(digest).toString('hex')}`;

  const delivered = await handleRequest(new Request(
    `https://api.chat.helixcer.com/webhooks/whatsapp/${channelId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
      body: raw
    }), env);
  assert.equal(delivered.status, 200);

  const inbound = database.prepare(`SELECT conversation_id,contact_id,text FROM messages
    WHERE provider_message_id='wamid.reply-after-dup'`).get();
  assert.equal(inbound.conversation_id, 'excel-conversation');
  assert.equal(inbound.contact_id, 'excel-contact');
  assert.equal(inbound.text, 'hello again');
  assert.equal(database.prepare('SELECT display_name FROM contacts WHERE contact_id=?')
    .get('excel-contact').display_name, 'Muhsina');

  database.close();
});
