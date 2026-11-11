import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { serializeCampaign, runCampaignConcurrent } from '../src/campaigns.js';

const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');

function extractBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + 1);
  if (start < 0 || end < 0) throw new Error(`Could not extract ${startMarker}`);
  return source.slice(start, end);
}

async function harness() {
  const db = new DatabaseSync(':memory:');
  for (const file of [
    '0021_campaigns.sql',
    '0025_campaign_jobs.sql',
    '0026_campaign_upload_chunks.sql',
    '0028_campaign_scheduled_at.sql'
  ]) {
    db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  db.exec("CREATE TABLE outbox (message_id TEXT, workspace_id TEXT, status TEXT, next_attempt_at TEXT)");
  let tail = Promise.resolve();
  const statement = (sql, values = []) => ({
    async first() { return db.prepare(sql).get(...values); },
    async all() { return { results: db.prepare(sql).all(...values) }; },
    async run() { return { meta: { changes: db.prepare(sql).run(...values).changes } }; }
  });
  const DB = {
    prepare(sql) {
      return {
        bind(...values) { return statement(sql, values); },
        ...statement(sql)
      };
    },
    async batch(statements) {
      const work = async () => {
        db.exec('BEGIN');
        try {
          const result = [];
          for (const item of statements) result.push(await item.run());
          db.exec('COMMIT');
          return result;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      };
      const next = tail.then(work);
      tail = next.catch(() => {});
      return next;
    }
  };
  const context = vm.createContext({
    env: { DB },
    Date,
    console,
    serializeCampaign,
    runCampaignConcurrent,
    hashText: async (value) => createHash('sha256').update(value).digest('hex'),
    cleanId: (value) => value,
    cleanError: (error) => error.message,
    httpError: (status, message) => Object.assign(new Error(message), { status }),
    rejectUnknownKeys() {},
    assertPrincipalChannelAccess() {},
    safeJsonParse: (value, fallback) => {
      try { return JSON.parse(value); } catch { return fallback; }
    },
    wakeCampaignRunner: async () => {}
  });
  return { db, context, env: { DB } };
}

test('createCampaign stores scheduled status and does not activate the job', async () => {
  const h = await harness();
  h.context.crypto = { randomUUID: () => 'scheduled-campaign' };
  h.context.validateCampaignPayload = (payload) => payload;
  h.context.getChannel = async () => ({ channelId: 'channel', connectorType: 'telegram' });
  h.context.assertChannelReadyForConversation = async () => {};
  h.context.logicalConnectorType = (channel) => channel.connectorType;
  h.context.audit = async () => {};
  h.context.campaignCountsFromRows = (rows) => ({ totalCount: rows.length, pendingCount: rows.length });
  h.context.getCampaignDetail = async () => ({
    item: serializeCampaign(h.db.prepare("SELECT * FROM campaigns WHERE campaign_id='scheduled-campaign'").get())
  });
  h.context.prepareCampaignRecipientRows = async (_env, _ws, input) => input.recipients.map((raw, index) => ({
    recipientId: `r-${index}`,
    contactId: raw.contactId,
    displayName: 'Contact',
    profileId: '',
    rowJson: '{}'
  }));
  vm.runInContext(
    extractBetween('async function createCampaign(', 'function mapUploadRecipient('),
    h.context
  );
  const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const result = await h.context.createCampaign(h.context.env, 'ws', {
    uploading: true,
    name: 'Later send',
    channelId: 'channel',
    audienceSource: 'contacts',
    messageType: 'text',
    text: 'Hello',
    recipients: [{ contactId: 'c1' }],
    variableMappings: [],
    textVariables: [],
    fieldMapping: {},
    scheduledAt
  }, {});
  assert.equal(result.scheduled, true);
  assert.equal(h.db.prepare('SELECT status, scheduled_at FROM campaigns').get().status, 'scheduled');
  assert.equal(h.db.prepare('SELECT state FROM campaign_jobs').get().state, 'uploading');
  vm.runInContext(
    extractBetween('async function appendCampaignRecipients(', 'async function runCampaignQueue('),
    h.context
  );
  await h.context.appendCampaignRecipients(h.context.env, 'ws', 'scheduled-campaign', {
    chunkId: 'finalize',
    recipients: [],
    finalize: true
  }, {});
  assert.equal(h.db.prepare('SELECT state FROM campaign_jobs').get().state, 'scheduled');
  assert.equal(h.db.prepare('SELECT status FROM campaigns').get().status, 'scheduled');
});

test('due scheduled campaigns are promoted to queued and woken', async () => {
  const h = await harness();
  const past = new Date(Date.now() - 60 * 1000).toISOString();
  h.db.prepare(`INSERT INTO campaigns
    (campaign_id,workspace_id,name,channel_id,status,created_at,updated_at,scheduled_at)
    VALUES ('due','ws','Due','channel','scheduled','2026-11-05','2026-11-05',?)`).run(past);
  h.db.prepare("INSERT INTO campaign_jobs VALUES ('due','ws','{}','scheduled','','2026-11-05')").run();
  const woken = [];
  h.context.wakeCampaignRunner = async (_env, campaignId) => { woken.push(campaignId); };
  vm.runInContext(
    extractBetween('async function promoteDueScheduledCampaigns(', 'async function runCampaignAlarm('),
    h.context
  );
  await h.context.wakeCampaignRunners(h.context.env);
  assert.equal(h.db.prepare('SELECT status FROM campaigns').get().status, 'queued');
  assert.equal(h.db.prepare('SELECT state FROM campaign_jobs').get().state, 'active');
  assert.deepEqual(woken, ['due']);
});
