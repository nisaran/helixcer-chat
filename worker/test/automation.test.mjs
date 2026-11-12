import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { handleRequest } from '../src/index.js';
import {
  isWithinDailyWindow,
  parseTimeToMinutes,
  renderAutomationMessage,
  shouldSendGreeting,
  shouldSendOutOfOffice
} from '../src/automation.js';

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
    '0027_google_reviews_oauth.sql', '0028_campaign_scheduled_at.sql', '0029_workspace_automation.sql'
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

test('renderAutomationMessage replaces supported variables', () => {
  const text = renderAutomationMessage(
    'Hi {{name}} / {{first_name}} at {{company}} on {{channel}}',
    { contactName: 'Ada Lovelace', company: 'Analytical Engines', channelName: 'WhatsApp Support' }
  );
  assert.equal(text, 'Hi Ada Lovelace / Ada at Analytical Engines on WhatsApp Support');
});

test('renderAutomationMessage keeps multiline greeting templates', () => {
  const text = renderAutomationMessage(
    'Hi {{name}},\nThanks for reaching out to us. We are glad to help you.\nRegards, Helixcer',
    { contactName: 'Ada Lovelace' }
  );
  assert.equal(
    text,
    'Hi Ada Lovelace,\nThanks for reaching out to us. We are glad to help you.\nRegards, Helixcer'
  );
});

test('shouldSendGreeting respects quiet-interval hours', () => {
  const now = Date.parse('2026-11-12T12:00:00.000Z');
  assert.equal(shouldSendGreeting({
    enabled: true,
    intervalHours: 24,
    previousInboundAt: '',
    now
  }), true);
  assert.equal(shouldSendGreeting({
    enabled: true,
    intervalHours: 24,
    previousInboundAt: '2026-11-12T01:00:00.000Z',
    now
  }), false);
  assert.equal(shouldSendGreeting({
    enabled: true,
    intervalHours: 6,
    previousInboundAt: '2026-11-12T01:00:00.000Z',
    now
  }), true);
  assert.equal(shouldSendGreeting({
    enabled: false,
    intervalHours: 0,
    previousInboundAt: '',
    now
  }), false);
});

test('out-of-office window supports overnight ranges', () => {
  assert.equal(parseTimeToMinutes('18:00'), 18 * 60);
  assert.equal(parseTimeToMinutes('09:30'), 9 * 60 + 30);
  assert.equal(isWithinDailyWindow(19 * 60, 18 * 60, 9 * 60), true);
  assert.equal(isWithinDailyWindow(8 * 60, 18 * 60, 9 * 60), true);
  assert.equal(isWithinDailyWindow(12 * 60, 18 * 60, 9 * 60), false);
  assert.equal(isWithinDailyWindow(10 * 60, 9 * 60, 17 * 60), true);
  assert.equal(isWithinDailyWindow(18 * 60, 9 * 60, 17 * 60), false);
});

test('shouldSendOutOfOffice uses timezone local clock', () => {
  // 2026-11-12 20:30 IST == 15:00 UTC
  const eveningIst = new Date('2026-11-12T15:00:00.000Z');
  assert.equal(shouldSendOutOfOffice({
    enabled: true,
    timezone: 'Asia/Kolkata',
    startTime: '18:00',
    endTime: '09:00',
    now: eveningIst
  }), true);

  // 2026-11-12 12:00 IST == 06:30 UTC
  const middayIst = new Date('2026-11-12T06:30:00.000Z');
  assert.equal(shouldSendOutOfOffice({
    enabled: true,
    timezone: 'Asia/Kolkata',
    startTime: '18:00',
    endTime: '09:00',
    now: middayIst
  }), false);
});

test('PATCH /api/automation accepts multiline greeting messages', async () => {
  const { database, DB } = await testDatabase();
  const env = envFor(DB);
  const headers = {
    Authorization: 'Bearer recovery-secret',
    Origin: 'https://chat.helixcer.com',
    'Content-Type': 'application/json'
  };
  const greetingMessage = 'Hi {{name}},\nThanks for reaching out to us. We are glad to help you.\nRegards, Helixcer';
  const response = await handleRequest(new Request('https://api.chat.helixcer.com/api/automation', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      greetingEnabled: true,
      greetingMessage,
      greetingIntervalHours: 24
    })
  }), env);
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.item.greetingEnabled, true);
  assert.equal(body.item.greetingMessage, greetingMessage);

  const loaded = await handleRequest(new Request('https://api.chat.helixcer.com/api/automation', {
    headers: { Authorization: 'Bearer recovery-secret', Origin: 'https://chat.helixcer.com' }
  }), env);
  assert.equal(loaded.status, 200);
  const loadedBody = await loaded.json();
  assert.equal(loadedBody.item.greetingMessage, greetingMessage);
  database.close();
});
