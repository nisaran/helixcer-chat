import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import {
  assertAllowedHttpsEndpoint,
  buildWhatsAppTemplatePayload,
  decryptOutboundPayload,
  decryptChannelCredential,
  encryptChannelCredential,
  encryptOutboundPayload,
  handleRequest,
  inboundPushNotification,
  InboxHub,
  isRetryableWhatsAppStatus,
  normalizeGeneric,
  normalizeGenericStatuses,
  normalizeInstagram,
  normalizeTelegram,
  normalizeWhatsApp,
  normalizeWhatsAppRecipient,
  resolveTemplate,
  sanitizeWhatsAppTemplateDefinition,
  searchMessages,
  timingSafeEqual,
  validateWhatsAppTemplateRequest,
  whatsappReplyWindowState,
  verifyMetaSignature
} from '../src/index.js';

test('message search is bounded and explicitly scoped to the authenticated workspace', async () => {
  let sql = '';
  let bindings = [];
  const env = {
    DB: {
      prepare(statement) {
        sql = statement;
        return {
          bind(...values) {
            bindings = values;
            return {
              async all() {
                return { results: [{
                  message_id: 'message-1', conversation_id: 'conversation-1', contact_id: 'contact-1',
                  display_name: 'Asha Rao', company: 'Helixcer', channel_id: 'channel-1', channel_name: 'Sales',
                  connector_type: 'whatsapp_cloud', provider_type: '', channel_profile_id: '919999999999',
                  text: 'Need the invoice', message_type: 'text', direction: 'inbound',
                  timestamp: '2026-10-27T12:00:00.000Z', conversation_status: 'open', assigned_to: '', unread_count: 2
                }] };
              }
            };
          }
        };
      }
    }
  };

  const items = await searchMessages(
    env,
    'workspace-a',
    new URL('https://api.chat.helixcer.com/api/search/messages?q=invoice&limit=500')
  );

  assert.deepEqual(bindings, ['workspace-a', 'invoice', 100]);
  assert.match(sql, /WHERE m\.workspace_id=\?1/);
  assert.match(sql, /ct\.workspace_id=m\.workspace_id/);
  assert.match(sql, /ch\.workspace_id=m\.workspace_id/);
  assert.deepEqual(items, [{
    messageId: 'message-1', conversationId: 'conversation-1', contactId: 'contact-1',
    contactIdentityId: '', identityId: '',
    contactName: 'Asha Rao', company: 'Helixcer', channelId: 'channel-1', channelName: 'Sales',
    connectorType: 'whatsapp_cloud', channelProfileId: '919999999999', text: 'Need the invoice',
    messageType: 'text', direction: 'inbound', timestamp: '2026-10-27T12:00:00.000Z',
    conversationStatus: 'open', assignedTo: '', unreadCount: 2
  }]);

  const untouchedEnv = { DB: { prepare() { throw new Error('blank queries must not reach D1'); } } };
  assert.deepEqual(await searchMessages(
    untouchedEnv,
    'workspace-a',
    new URL('https://api.chat.helixcer.com/api/search/messages?q=%20%20')
  ), []);
});

test('inbound push notifications use the saved sender name and a bounded message preview', () => {
  const notification = inboundPushNotification({ channelId: 'wa-sales' }, {
    conversationId: 'conversation-123',
    senderName: '  Asha   Rao  ',
    preview: `  Hello\nthere ${'x'.repeat(300)}  `,
    messageType: 'text'
  });
  assert.equal(notification.title, 'Asha Rao');
  assert.match(notification.body, /^Hello there /);
  assert.equal(notification.body.length, 240);
  assert.equal(notification.tag, 'helixcer-conversation-123');
  assert.equal(notification.url, '/#inbox/conversation-123');

  const counted = inboundPushNotification({ channelId: 'wa-sales' }, {
    conversationId: 'conversation-123', senderName: 'Asha', preview: 'Hi', messageType: 'text',
    unreadCount: 12, conversation: { unreadCount: 4 },
    message: { timestamp: '2026-10-27T12:00:00.000Z' }
  });
  assert.equal(counted.unreadCount, 12);
  assert.equal(counted.conversationUnreadCount, 4);
  assert.equal(counted.eventTimestamp, '2026-10-27T12:00:00.000Z');

  assert.deepEqual(inboundPushNotification({ channelId: 'telegram-support' }, {
    conversationId: 'conversation-media', senderName: '', preview: '', messageType: 'image'
  }), {
    title: 'Customer', body: 'Sent a photo', tag: 'helixcer-conversation-media',
    url: '/#inbox/conversation-media'
  });
  assert.equal(inboundPushNotification({ channelId: 'wa-sales' }, {
    senderName: 'Nisar', preview: '[WhatsApp document received]', messageType: 'document'
  }).body, 'Sent a document');
  assert.equal(inboundPushNotification({ channelId: 'wa-sales' }, {
    conversationId: '../settings', senderName: 'Nisar', preview: 'Hi', messageType: 'text'
  }).url, '/#inbox');
});

test('WhatsApp free-form replies follow the latest inbound 24-hour window', () => {
  const now = Date.parse('2026-10-25T12:00:00.000Z');
  assert.deepEqual(whatsappReplyWindowState('telegram', '', now), {
    freeformAllowed: true, replyWindowExpiresAt: '', replyWindowReason: ''
  });
  const open = whatsappReplyWindowState('whatsapp_cloud', '2026-10-24T13:00:00.000Z', now);
  assert.equal(open.freeformAllowed, true);
  assert.equal(open.replyWindowExpiresAt, '2026-10-25T13:00:00.000Z');
  const closed = whatsappReplyWindowState('whatsapp_cloud', '2026-10-24T11:59:59.000Z', now);
  assert.equal(closed.freeformAllowed, false);
  assert.match(closed.replyWindowReason, /approved template/i);
  const unopened = whatsappReplyWindowState('whatsapp_cloud', '', now);
  assert.equal(unopened.freeformAllowed, false);
  assert.equal(unopened.replyWindowExpiresAt, '');
});

test('normalizes inbound WhatsApp messages and statuses', () => {
  const result = normalizeWhatsApp({ entry: [{ changes: [{ value: {
    metadata: { phone_number_id: '123456789' },
    contacts: [{ wa_id: '919999999999', profile: { name: 'Asha' } }],
    messages: [
      { id: 'wamid.1', from: '919999999999', timestamp: '1761360000', type: 'text', text: { body: 'Hello' } },
      { id: 'wamid.2', from: '919999999999', timestamp: '1761360002', type: 'image', context: { id: 'wamid.1' },
        image: { id: 'wa-media-2', mime_type: 'image/jpeg', caption: 'Receipt' } },
      { id: 'wamid.3', from: '919999999999', timestamp: '1761360003', type: 'document',
        document: { id: 'wa-media-3', mime_type: 'application/pdf', filename: 'invoice.pdf' } }
    ],
    statuses: [{ id: 'wamid.out', status: 'delivered', timestamp: '1761360001', biz_opaque_callback_data: 'internal-message-1' }]
  } }] }] });
  assert.equal(result.messages[0].displayName, 'Asha');
  assert.equal(result.messages[0].text, 'Hello');
  assert.equal(result.messages[1].text, 'Receipt');
  assert.deepEqual(result.messages[1].attachment, {
    type: 'image', filename: 'image-wamid.2.jpeg', mimeType: 'image/jpeg', size: 0,
    caption: 'Receipt', providerMediaId: 'wa-media-2'
  });
  assert.deepEqual(result.messages[1].reply, { channelMessageId: 'wamid.1' });
  assert.equal(result.messages[2].text, '');
  assert.equal(result.messages[2].attachment.filename, 'invoice.pdf');
  assert.equal(result.statuses[0].status, 'delivered');
  assert.equal(result.statuses[0].internalMessageId, 'internal-message-1');
  assert.deepEqual(result.phoneNumberIds, ['123456789']);
});

test('dashboard applies granular webhooks without flashing or clearing selected history', async () => {
  const appSource = await readFile(new URL('../../assets/app.js', import.meta.url), 'utf8');
  const start = appSource.indexOf('function handleRealtimeEvent(event)');
  const end = appSource.indexOf('async function refreshMessages', start);
  assert.ok(start >= 0 && end > start);
  const handler = appSource.slice(start, end);
  assert.match(handler, /type === "webhook\.received"/);
  assert.match(handler, /if \(!event\.granular\) await reconcileWorkspace\(\)/);
  assert.doesNotMatch(handler, /state\.messages\.delete\(state\.selectedConversationId\)/);
  assert.doesNotMatch(handler, /await loadAll\(\)/);
});

test('normalizes WhatsApp recipients and classifies retryable provider failures', () => {
  assert.equal(normalizeWhatsAppRecipient('+91 98765-43210'), '919876543210');
  assert.equal(normalizeWhatsAppRecipient('0091 (98765) 43210'), '919876543210');
  assert.throws(() => normalizeWhatsAppRecipient('98765'), /8 to 15 digits/);
  assert.throws(() => normalizeWhatsAppRecipient('not-a-number'), /country code/);
  assert.equal(isRetryableWhatsAppStatus(429), true);
  assert.equal(isRetryableWhatsAppStatus(503), true);
  assert.equal(isRetryableWhatsAppStatus(400), false);
  assert.equal(isRetryableWhatsAppStatus(401), false);
});

test('normalizes a configured generic event list', () => {
  const result = normalizeGeneric({ events: [{ user: { id: '42', name: 'Nia' }, body: 'Hi', messageId: 'm1' }] }, {
    eventsPath: 'events', senderIdPath: 'user.id', senderNamePath: 'user.name', textPath: 'body', messageIdPath: 'messageId'
  });
  assert.deepEqual(result[0], {
    channelProfileId: '42', displayName: 'Nia', text: 'Hi', providerMessageId: 'm1', timestamp: '', messageType: 'text'
  });
  const receiptPayload = { receipts: [{ providerId: 'm1', delivery: 'SEEN', at: '2026-10-25T12:00:00.000Z' }] };
  assert.deepEqual(normalizeGeneric(receiptPayload, {
    eventsPath: 'receipts', senderIdPath: 'user.id', textPath: 'body', messageIdPath: 'providerId', statusPath: 'delivery'
  }), []);
  assert.deepEqual(normalizeGenericStatuses(receiptPayload, {
    statusEventsPath: 'receipts', statusMessageIdPath: 'providerId', statusPath: 'delivery', statusTimestampPath: 'at'
  }), [{ providerMessageId: 'm1', internalMessageId: '', status: 'read', timestamp: '2026-10-25T12:00:00.000Z', error: '' }]);
});

test('normalizes Telegram bot updates', () => {
  const result = normalizeTelegram({ update_id: 7, message: {
    message_id: 44, date: 1761360000, chat: { id: 12345 }, from: { first_name: 'Ravi', last_name: 'K' }, text: 'Need help'
  } });
  assert.equal(result.channelProfileId, '12345');
  assert.equal(result.displayName, 'Ravi K');
  assert.equal(result.text, 'Need help');
  assert.equal(result.providerMessageId, '44');
  assert.equal(result.dedupeKey, 'update:7');
  const sameMessageNumber = normalizeTelegram({ message: {
    message_id: 44, date: 1761360000, chat: { id: 99999 }, from: { first_name: 'Other' }, text: 'Different chat'
  } });
  assert.equal(sameMessageNumber.providerMessageId, '44');
  assert.equal(sameMessageNumber.dedupeKey, 'chat:99999:message:44');
  assert.notEqual(sameMessageNumber.dedupeKey, normalizeTelegram({ message: {
    message_id: 44, chat: { id: 12345 }, text: 'Original chat'
  } }).dedupeKey);
  const photo = normalizeTelegram({ update_id: 8, message: {
    message_id: 45, date: 1761360010, chat: { id: 12345 }, from: { first_name: 'Ravi' }, caption: 'Invoice photo',
    photo: [{ file_id: 'small', file_size: 1200 }, { file_id: 'large', file_size: 9200 }]
  } });
  assert.equal(photo.messageType, 'image');
  assert.deepEqual(photo.attachment, {
    type: 'image', filename: 'image-45.jpeg', mimeType: 'image/jpeg', size: 9200,
    caption: 'Invoice photo', providerFileId: 'large'
  });
  const voice = normalizeTelegram({ message: {
    message_id: 46, chat: { id: 12345 }, voice: { file_id: 'voice-file', file_size: 4000, mime_type: 'audio/ogg' }
  } });
  assert.equal(voice.messageType, 'audio');
  assert.equal(voice.attachment.providerFileId, 'voice-file');

  const reply = normalizeTelegram({ update_id: 9, message: {
    message_id: 47, date: 1761360020, chat: { id: 12345 }, from: { first_name: 'Ravi' }, text: 'Yes',
    reply_to_message: { message_id: 40, from: { id: 777000, is_bot: true, first_name: 'Helixcer' },
      text: 'Can you confirm?' }
  } });
  assert.deepEqual(reply.reply, {
    channelMessageId: '40', direction: 'outbound', text: 'Can you confirm?', messageType: 'text'
  });
});

test('normalizes Instagram messages, echoes, delivery receipts, and read watermarks', () => {
  const result = normalizeInstagram({ entry: [{ id: '17841400000000000', messaging: [
    { sender: { id: 'customer-1' }, recipient: { id: '17841400000000000' }, timestamp: 1761360000000,
      message: { mid: 'ig-mid-1', text: 'Hello from Instagram' } },
    { sender: { id: '17841400000000000' }, recipient: { id: 'customer-1' }, timestamp: 1761360001000,
      message: { mid: 'ig-echo', text: 'Reply', is_echo: true } },
    { sender: { id: 'customer-1' }, recipient: { id: '17841400000000000' }, timestamp: 1761360002000,
      delivery: { mids: ['ig-outbound-1'], watermark: 1761360002000 } },
    { sender: { id: 'customer-1' }, recipient: { id: '17841400000000000' }, timestamp: 1761360003000,
      read: { watermark: 1761360003000 } }
  ] }] });
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].channelProfileId, 'customer-1');
  assert.equal(result.messages[0].providerMessageId, 'ig-mid-1');
  assert.equal(result.messages[0].text, 'Hello from Instagram');
  assert.deepEqual(result.statuses, [
    { providerMessageId: 'ig-echo', status: 'sent', timestamp: '2025-10-25T02:40:01.000Z' },
    { providerMessageId: 'ig-outbound-1', status: 'delivered', timestamp: '2025-10-25T02:40:02.000Z' }
  ]);
  assert.deepEqual(result.watermarkStatuses, [
    { channelProfileId: 'customer-1', status: 'read', timestamp: '2025-10-25T02:40:03.000Z' }
  ]);
  assert.deepEqual(result.recipientIds, ['17841400000000000']);
});

test('encrypts channel credentials with workspace and channel binding', async () => {
  const master = 'test-only-master-key-material-'.repeat(2);
  const encrypted = await encryptChannelCredential('provider-secret-value', master, 'ws-one', 'channel-one', 'accessToken');
  assert.match(encrypted, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(encrypted.includes('provider-secret-value'), false);
  assert.equal(await decryptChannelCredential(encrypted, master, 'ws-one', 'channel-one', 'accessToken'), 'provider-secret-value');
  await assert.rejects(() => decryptChannelCredential(encrypted, master, 'ws-two', 'channel-one', 'accessToken'));
  await assert.rejects(() => decryptChannelCredential(encrypted, `${master}different`, 'ws-one', 'channel-one', 'accessToken'));
});

test('validates Meta-native template variants without allowing provider envelope overrides', () => {
  const normalized = validateWhatsAppTemplateRequest({
    channelId: 'wa-sales',
    to: '+91 98765 43210',
    contact: { displayName: 'Asha' },
    clientReference: 'order-1001',
    template: {
      name: 'order_update',
      language: { code: 'en_US' },
      components: [
        { type: 'header', parameters: [{ type: 'image', image: { link: 'https://cdn.example.com/order.jpg' } }] },
        { type: 'body', parameters: [{ type: 'text', text: 'Asha' }, { type: 'currency', currency: { fallback_value: '₹100', code: 'INR', amount_1000: 100000 } }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'track-1001' }] },
        { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'CONFIRM_1001' }] }
      ]
    }
  });
  assert.equal(normalized.to, '919876543210');
  assert.equal(normalized.template.components[0].parameters[0].image.link, 'https://cdn.example.com/order.jpg');
  const provider = buildWhatsAppTemplatePayload(normalized.to, normalized.template, 'message-1');
  assert.equal(provider.messaging_product, 'whatsapp');
  assert.equal(provider.recipient_type, 'individual');
  assert.equal(provider.type, 'template');
  assert.equal(provider.biz_opaque_callback_data, 'message-1');
  assert.equal(provider.template.components[2].sub_type, 'url');
  assert.throws(() => validateWhatsAppTemplateRequest({ ...normalized, messaging_product: 'other' }), /Unsupported request field/);
  assert.throws(() => validateWhatsAppTemplateRequest({ ...normalized, template: { ...normalized.template, name: 'Bad Name' } }), /Template name/);
  assert.throws(() => validateWhatsAppTemplateRequest({
    ...normalized,
    template: { ...normalized.template, components: [{ type: 'header', parameters: [{ type: 'image', image: { link: 'http://localhost/private' } }] }] }
  }), /public HTTPS URL/);
});

test('sanitizes Meta template definitions while retaining positional, named, media, and button inputs', () => {
  const template = sanitizeWhatsAppTemplateDefinition({
    id: '123456789', name: 'order_update', language: 'en_US', status: 'APPROVED', category: 'UTILITY',
    ignored_secret: 'must not be copied',
    components: [
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['https://secret.example/signed'] } },
      { type: 'BODY', text: 'Hello {{customer_name}},\norder {{2}} is ready.',
        example: { body_text: [['Asha', '1001']], body_text_named_params: [
          { param_name: 'customer_name', example: 'Asha', ignored: 'no' }
        ] } },
      { type: 'BUTTONS', buttons: [
        { type: 'URL', text: 'Track', url: 'https://shop.example/orders/{{1}}', example: ['1001'], extra: 'no' },
        { type: 'QUICK_REPLY', text: 'Thanks' }
      ] }
    ]
  });
  assert.equal(template.templateId, '123456789');
  assert.deepEqual(template.language, { code: 'en_US' });
  assert.equal(template.components[0].format, 'image');
  assert.equal(template.components[1].text, 'Hello {{customer_name}},\norder {{2}} is ready.');
  assert.equal(template.components[1].example.body_text_named_params[0].param_name, 'customer_name');
  assert.deepEqual(template.variables.map(item => [item.component, item.key, item.kind]), [
    ['header', 'media', 'image'], ['body', 'customer_name', 'text'], ['body', '2', 'text'], ['button', '1', 'url']
  ]);
  assert.equal('ignored_secret' in template, false);
  assert.equal('extra' in template.components[2].buttons[0], false);
  assert.equal(sanitizeWhatsAppTemplateDefinition({ name: 'Bad Name', language: 'en_US', status: 'APPROVED' }), null);
});

test('encrypts outbound template payloads with workspace and message binding', async () => {
  const master = 'test-only-master-key-material-'.repeat(2);
  const value = { template: { name: 'hello_world', language: { code: 'en_US' }, components: [] } };
  const encrypted = await encryptOutboundPayload(value, master, 'ws-one', 'message-one');
  assert.match(encrypted, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(encrypted.includes('hello_world'), false);
  assert.deepEqual(await decryptOutboundPayload(encrypted, master, 'ws-one', 'message-one'), value);
  await assert.rejects(() => decryptOutboundPayload(encrypted, master, 'ws-two', 'message-one'));
  await assert.rejects(() => decryptOutboundPayload(encrypted, master, 'ws-one', 'message-two'));
});

test('resolves data and secret templates recursively', () => {
  const result = resolveTemplate({ Authorization: 'Bearer {{secret:TOKEN}}', body: '{{message.text}}' },
    { message: { text: 'hello' } }, name => name === 'TOKEN' ? 'abc' : undefined);
  assert.deepEqual(result, { Authorization: 'Bearer abc', body: 'hello' });
});

test('requires HTTPS and an explicit hostname allowlist', () => {
  assert.equal(assertAllowedHttpsEndpoint('https://api.example.com/messages', ['api.example.com']), true);
  assert.throws(() => assertAllowedHttpsEndpoint('http://api.example.com/messages', ['api.example.com']), /HTTPS/);
  assert.throws(() => assertAllowedHttpsEndpoint('https://127.0.0.1/messages', ['127.0.0.1']), /blocked/);
  assert.throws(() => assertAllowedHttpsEndpoint('https://other.example.com/messages', ['api.example.com']), /allowlisted/);
});

test('constant-time comparison handles equal and unequal strings', () => {
  assert.equal(timingSafeEqual('same', 'same'), true);
  assert.equal(timingSafeEqual('same', 'different'), false);
});

test('verifies Meta sha256 webhook signatures', async () => {
  const body = '{"hello":"world"}';
  const secret = 'app-secret';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const signature = `sha256=${Buffer.from(digest).toString('hex')}`;
  assert.equal(await verifyMetaSignature(body, signature, secret), true);
  assert.equal(await verifyMetaSignature(`${body}x`, signature, secret), false);
});

test('D1 migrations are valid SQLite, preserve rows, and create identity tables', async () => {
  const initial = await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8');
  const identity = await readFile(new URL('../migrations/0002_identity_and_workspaces.sql', import.meta.url), 'utf8');
  const whatsapp = await readFile(new URL('../migrations/0003_whatsapp_channel.sql', import.meta.url), 'utf8');
  const multichannel = await readFile(new URL('../migrations/0004_multichannel_credentials.sql', import.meta.url), 'utf8');
  const templateApi = await readFile(new URL('../migrations/0005_external_template_api.sql', import.meta.url), 'utf8');
  const contactProfiles = await readFile(new URL('../migrations/0006_contact_profiles.sql', import.meta.url), 'utf8');
  const conversationUniqueness = await readFile(new URL('../migrations/0007_conversation_uniqueness.sql', import.meta.url), 'utf8');
  const pushSubscriptions = await readFile(new URL('../migrations/0008_push_subscriptions.sql', import.meta.url), 'utf8');
  const workspaceProfile = await readFile(new URL('../migrations/0009_workspace_profile.sql', import.meta.url), 'utf8');
  const workspaceIdMigration = await readFile(new URL('../migrations/0010_workspace_uuid.sql', import.meta.url), 'utf8');
  const mobilePushDevices = await readFile(new URL('../migrations/0011_mobile_push_devices.sql', import.meta.url), 'utf8');
  const contactIdentities = await readFile(new URL('../migrations/0012_contact_identities.sql', import.meta.url), 'utf8');
  const flatContactPlatformIds = await readFile(new URL('../migrations/0013_flat_contact_platform_ids.sql', import.meta.url), 'utf8');
  const unifiedContactConversations = await readFile(new URL('../migrations/0014_unified_contact_conversations.sql', import.meta.url), 'utf8');
  const saasClients = await readFile(new URL('../migrations/0015_saas_clients.sql', import.meta.url), 'utf8');
  const database = new DatabaseSync(':memory:');
  database.exec(initial);
  database.exec(`
    INSERT INTO channels (channel_id,name,connector_type,secret_key,created_at,updated_at)
      VALUES ('legacy-channel','Legacy channel','web_chat','LEGACY','2026-01-01','2026-01-01');
    INSERT INTO contacts (contact_id,display_name,created_at,updated_at)
      VALUES ('legacy-contact','Legacy contact','2026-01-01','2026-01-01');
    INSERT INTO channel_identities (identity_id,contact_id,channel_id,channel_profile_id,created_at)
      VALUES ('legacy-identity','legacy-contact','legacy-channel','profile-1','2026-01-01');
    INSERT INTO conversations (conversation_id,contact_id,channel_id,last_message_at,created_at,updated_at)
      VALUES ('legacy-conversation','legacy-contact','legacy-channel','2026-01-01','2026-01-01','2026-01-01');
    INSERT INTO messages (message_id,conversation_id,contact_id,channel_id,direction,status,timestamp)
      VALUES ('legacy-message','legacy-conversation','legacy-contact','legacy-channel','inbound','received','2026-01-01');
    INSERT INTO webhook_events (event_key,channel_id,event_type,received_at)
      VALUES ('legacy-event','legacy-channel','message','2026-01-01');
    INSERT INTO outbox (outbox_id,message_id,next_attempt_at,created_at,updated_at)
      VALUES ('legacy-outbox','legacy-message','2026-01-01','2026-01-01','2026-01-01');
    INSERT INTO agents (agent_id,email,display_name,created_at,updated_at)
      VALUES ('legacy-agent','legacy@example.com','Legacy agent','2026-01-01','2026-01-01');
    INSERT INTO audit_log (audit_id,actor,action,target_type,target_id,timestamp)
      VALUES ('legacy-audit','legacy@example.com','create','contact','legacy-contact','2026-01-01');
  `);
  database.exec(identity);
  database.exec(whatsapp);
  database.exec(multichannel);
  database.exec(templateApi);
  database.exec(contactProfiles);
  database.exec(`
    UPDATE conversations SET status='closed',unread_count=2
      WHERE conversation_id='legacy-conversation';
    INSERT INTO conversations
        (conversation_id,contact_id,channel_id,status,subject,last_message_at,unread_count,created_at,updated_at,workspace_id)
      VALUES ('legacy-conversation-new','legacy-contact','legacy-channel','open','Latest thread','2026-02-01',3,
        '2026-02-01','2026-02-01','ws_default');
    INSERT INTO messages
        (message_id,conversation_id,contact_id,channel_id,direction,status,timestamp,workspace_id)
      VALUES ('legacy-message-new','legacy-conversation-new','legacy-contact','legacy-channel','inbound','received',
        '2026-02-01','ws_default');
  `);
  database.exec(conversationUniqueness);
  database.exec(pushSubscriptions);
  database.exec(workspaceProfile);
  database.exec(`
    INSERT INTO users (user_id,google_sub,email,display_name,email_verified,last_login_at,created_at,updated_at)
      VALUES ('migration-user','migration-sub','migration@example.com','Migration owner',1,'2026-01-01','2026-01-01','2026-01-01');
    INSERT INTO memberships (membership_id,workspace_id,user_id,role,status,created_at,updated_at)
      VALUES ('migration-membership','ws_default','migration-user','owner','active','2026-01-01','2026-01-01');
    INSERT INTO sessions (session_id,token_hash,user_id,workspace_id,expires_at,last_seen_at,created_at)
      VALUES ('migration-session','migration-token','migration-user','ws_default','2027-01-01','2026-01-01','2026-01-01');
    INSERT INTO invitations (invitation_id,workspace_id,email,role,token_hash,status,expires_at,created_at,updated_at)
      VALUES ('migration-invitation','ws_default','invite@example.com','agent','migration-invite-token','pending','2027-01-01','2026-01-01','2026-01-01');
    INSERT INTO push_subscriptions
      (subscription_id,workspace_id,membership_id,device_id,endpoint,p256dh,auth,created_at,updated_at)
      VALUES ('migration-push','ws_default','migration-membership','device','https://push.example/sub','key','auth','2026-01-01','2026-01-01');
    INSERT INTO channel_credentials
      (workspace_id,channel_id,credential_key,encrypted_value,created_at,updated_at)
      VALUES ('ws_default','legacy-channel','accessToken','encrypted-old-aad','2026-01-01','2026-01-01');
    INSERT INTO outbound_payloads (message_id,workspace_id,encrypted_payload,created_at,updated_at)
      VALUES ('legacy-message','ws_default','encrypted-old-aad','2026-01-01','2026-01-01');
    INSERT INTO api_keys
      (api_key_id,workspace_id,name,key_prefix,secret_hash,status,created_at,updated_at)
      VALUES ('migration-key','ws_default','Migration key','hxc_migrate','migration-secret-hash','active','2026-01-01','2026-01-01');
    INSERT INTO external_api_requests
      (request_id,workspace_id,api_key_id,operation,idempotency_key_hash,request_hash,message_id,created_at,expires_at)
      VALUES ('migration-request','ws_default','migration-key','send','migration-idempotency','migration-request-hash','legacy-message','2026-01-01','2027-01-01');
    UPDATE channels SET config_json='{"credentialsVerifiedAt":"2026-01-01","webhookVerifiedAt":"2026-01-01","verifiedProviderId":"provider-1","phoneNumberId":"10001"}'
      WHERE channel_id='legacy-channel';
  `);
  database.exec(workspaceIdMigration);
  database.exec(mobilePushDevices);
  database.exec(contactIdentities);
  database.exec(flatContactPlatformIds);
  database.exec(unifiedContactConversations);
  database.exec(saasClients);
  const migratedWorkspaceId = database.prepare("SELECT workspace_id FROM workspaces WHERE slug='default'").get().workspace_id;
  assert.match(migratedWorkspaceId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(database.prepare("SELECT count(*) AS count FROM workspaces WHERE workspace_id='ws_default'").get().count, 0);
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
  for (const name of ['workspaces', 'users', 'memberships', 'sessions', 'oauth_states', 'invitations', 'channels', 'channel_credentials',
    'contacts', 'messages', 'audit_log', 'api_keys', 'outbound_payloads', 'external_api_requests', 'push_subscriptions',
    'mobile_push_devices', 'mobile_auth_challenges', 'contact_identities', 'channel_identity_bindings', 'contact_platform_ids',
    'identity_migration_issues', 'user_passwords', 'platform_admins']) {
    assert.ok(tables.includes(name), `missing table ${name}`);
  }
  for (const [table, idColumn, id] of [
    ['channels', 'channel_id', 'legacy-channel'],
    ['contacts', 'contact_id', 'legacy-contact'],
    ['channel_identities', 'identity_id', 'legacy-identity'],
    ['conversations', 'conversation_id', 'legacy-conversation-new'],
    ['messages', 'message_id', 'legacy-message'],
    ['webhook_events', 'event_key', 'legacy-event'],
    ['agents', 'agent_id', 'legacy-agent'],
    ['audit_log', 'audit_id', 'legacy-audit']
  ]) {
    assert.equal(database.prepare(`SELECT workspace_id FROM ${table} WHERE ${idColumn}=?`).get(id).workspace_id, migratedWorkspaceId);
  }
  assert.equal(database.prepare("SELECT actor_email FROM audit_log WHERE audit_id='legacy-audit'").get().actor_email, 'legacy@example.com');
  assert.equal(database.prepare('SELECT count(*) AS count FROM memberships').get().count, 1);
  assert.equal(database.prepare('SELECT name FROM workspaces WHERE workspace_id=?').get(migratedWorkspaceId).name, 'Helixcer Chat');
  assert.deepEqual({ ...database.prepare(`SELECT registered_name,address_line1,address_line2,city,state,postal_code,country,gstin,tax_details
    FROM workspaces WHERE workspace_id=?`).get(migratedWorkspaceId) }, {
    registered_name: '', address_line1: '', address_line2: '', city: '', state: '', postal_code: '', country: '', gstin: '', tax_details: ''
  });
  for (const [table, idColumn, id] of [
    ['memberships', 'membership_id', 'migration-membership'],
    ['sessions', 'session_id', 'migration-session'],
    ['invitations', 'invitation_id', 'migration-invitation'],
    ['push_subscriptions', 'subscription_id', 'migration-push'],
    ['api_keys', 'api_key_id', 'migration-key'],
    ['external_api_requests', 'request_id', 'migration-request']
  ]) {
    assert.equal(database.prepare(`SELECT workspace_id FROM ${table} WHERE ${idColumn}=?`).get(id).workspace_id, migratedWorkspaceId);
  }
  assert.equal(database.prepare('SELECT count(*) AS count FROM channel_credentials').get().count, 0);
  assert.equal(database.prepare('SELECT count(*) AS count FROM outbound_payloads').get().count, 0);
  assert.equal(database.prepare('SELECT count(*) AS count FROM outbox').get().count, 0);
  assert.equal(database.prepare("SELECT status FROM messages WHERE message_id='legacy-message'").get().status, 'failed');
  const migratedChannelConfig = JSON.parse(database.prepare("SELECT config_json FROM channels WHERE channel_id='legacy-channel'").get().config_json);
  assert.equal(migratedChannelConfig.phoneNumberId, '10001');
  assert.equal(migratedChannelConfig.credentialsVerifiedAt, undefined);
  assert.equal(migratedChannelConfig.webhookVerifiedAt, undefined);
  assert.equal(migratedChannelConfig.verifiedProviderId, undefined);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM channels WHERE channel_id='wa-main'").get().count, 0);
  assert.equal(database.prepare("SELECT provider_type FROM channels WHERE channel_id='legacy-channel'").get().provider_type, 'web_chat');
  assert.equal(database.prepare("SELECT company FROM contacts WHERE contact_id='legacy-contact'").get().company, '');
  assert.equal(database.prepare("SELECT tags_json FROM contacts WHERE contact_id='legacy-contact'").get().tags_json, '[]');
  const mergedConversation = database.prepare(`SELECT conversation_id,status,unread_count,created_at,last_message_at
    FROM conversations WHERE contact_id='legacy-contact' AND channel_id='legacy-channel'`).get();
  assert.deepEqual({ ...mergedConversation }, {
    conversation_id: 'legacy-conversation-new', status: 'open', unread_count: 5,
    created_at: '2026-01-01', last_message_at: '2026-02-01'
  });
  assert.deepEqual(database.prepare(`SELECT message_id,conversation_id FROM messages
    WHERE contact_id='legacy-contact' ORDER BY message_id`).all().map(row => ({ ...row })), [
    { message_id: 'legacy-message', conversation_id: 'legacy-conversation-new' },
    { message_id: 'legacy-message-new', conversation_id: 'legacy-conversation-new' }
  ]);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  const indexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(row => row.name));
  for (const name of ['idx_channels_workspace', 'idx_conversations_workspace_activity', 'idx_messages_workspace_conversation',
    'idx_outbox_workspace_due', 'idx_channel_credentials_channel', 'idx_channels_workspace_provider',
    'idx_channels_workspace_whatsapp_phone', 'idx_channels_workspace_instagram_account', 'idx_channels_workspace_telegram_bot',
    'idx_api_keys_workspace_status', 'idx_outbound_payloads_workspace', 'idx_external_requests_message', 'idx_external_requests_expiry',
    'idx_conversations_workspace_contact_unique', 'idx_messages_workspace_conversation_route',
    'idx_push_subscriptions_workspace', 'idx_push_subscriptions_membership',
    'idx_mobile_push_devices_workspace', 'idx_mobile_push_devices_membership', 'idx_mobile_push_devices_session',
    'idx_sessions_type_expiry', 'idx_mobile_auth_challenges_expiry']) {
    assert.ok(indexes.has(name), `missing index ${name}`);
  }
  database.close();

  const editedDatabase = new DatabaseSync(':memory:');
  editedDatabase.exec(initial);
  editedDatabase.exec(identity);
  editedDatabase.exec(whatsapp);
  editedDatabase.prepare("UPDATE channels SET name='Edited WhatsApp' WHERE channel_id='wa-main'").run();
  editedDatabase.exec(multichannel);
  editedDatabase.exec(templateApi);
  editedDatabase.exec(contactProfiles);
  editedDatabase.exec(conversationUniqueness);
  editedDatabase.exec(pushSubscriptions);
  editedDatabase.exec(workspaceProfile);
  editedDatabase.exec(mobilePushDevices);
  assert.equal(editedDatabase.prepare("SELECT name FROM channels WHERE channel_id='wa-main'").get().name, 'Edited WhatsApp');
  editedDatabase.close();
});

test('health is public with configured CORS and API routes reject missing auth', async () => {
  const env = { ALLOWED_ORIGINS: 'https://chat.helixcer.com', ADMIN_TOKEN: 'secret', RECOVERY_MODE: 'true' };
  const health = await handleRequest(new Request('https://api.example.com/health', {
    headers: { Origin: 'https://chat.helixcer.com' }
  }), env);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('Access-Control-Allow-Origin'), 'https://chat.helixcer.com');
  const denied = await handleRequest(new Request('https://api.example.com/api/bootstrap'), env);
  assert.equal(denied.status, 401);
  const queryToken = await handleRequest(new Request('https://api.example.com/api/realtime?token=secret'), env);
  assert.equal(queryToken.status, 401);
  const spoofedEmail = await handleRequest(new Request('https://api.example.com/api/bootstrap', {
    headers: { 'X-Agent-Email': 'owner@example.com' }
  }), env);
  assert.equal(spoofedEmail.status, 401);
  const crossSiteSocket = await handleRequest(new Request('https://api.example.com/api/realtime', {
    headers: { Authorization: 'Bearer secret', Origin: 'https://evil.example' }
  }), env);
  assert.equal(crossSiteSocket.status, 403);
});

test('realtime hub revalidates sessions and disconnects changed memberships', async () => {
  const sent = [];
  const closed = [];
  const attachment = {
    sessionId: 'session-1', membershipId: 'membership-1',
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  };
  const socket = {
    deserializeAttachment: () => attachment,
    send: value => sent.push(value),
    close: (code, reason) => closed.push({ code, reason })
  };
  let active = true;
  const env = {
    DB: {
      prepare: () => ({
        bind: () => ({ first: async () => active ? { ok: 1 } : null })
      })
    }
  };
  const hub = new InboxHub({ getWebSockets: () => [socket] }, env);
  await hub.fetch(new Request('https://hub.internal/broadcast', { method: 'POST', body: '{"type":"changed"}' }));
  assert.deepEqual(sent, ['{"type":"changed"}']);
  active = false;
  await hub.webSocketMessage(socket, 'ping');
  assert.equal(closed.at(-1).code, 1008);
  active = true;
  await hub.fetch(new Request('https://hub.internal/disconnect', {
    method: 'POST', body: JSON.stringify({ membershipId: 'membership-1' })
  }));
  assert.equal(closed.at(-1).code, 1008);
});

test('OAuth start limiter enforces per-client and global windows before D1 work', async () => {
  const values = new Map();
  const storageApi = {
    get: async key => values.get(key),
    put: async (key, value) => values.set(key, structuredClone(value))
  };
  const state = {
    storage: { transaction: callback => callback(storageApi) },
    getWebSockets: () => []
  };
  const hub = new InboxHub(state, {
    OAUTH_RATE_LIMIT_WINDOW_SECONDS: '600',
    OAUTH_RATE_LIMIT_PER_CLIENT: '2',
    OAUTH_RATE_LIMIT_GLOBAL: '3'
  });
  const attempt = key => hub.fetch(new Request('https://hub.internal/oauth-rate-limit', {
    method: 'POST', body: key.repeat(64)
  }));
  assert.equal((await attempt('a')).status, 204);
  assert.equal((await attempt('a')).status, 204);
  const perClient = await attempt('a');
  assert.equal(perClient.status, 429);
  assert.ok(Number(perClient.headers.get('Retry-After')) > 0);
  assert.equal((await attempt('b')).status, 204);
  assert.equal((await attempt('c')).status, 429);
});

test('external API limiter enforces per-key and per-workspace windows', async () => {
  const values = new Map();
  const storageApi = {
    get: async key => values.get(key),
    put: async (key, value) => values.set(key, structuredClone(value))
  };
  const hub = new InboxHub({
    storage: { transaction: callback => callback(storageApi) },
    getWebSockets: () => []
  }, {
    EXTERNAL_API_RATE_LIMIT_WINDOW_SECONDS: '60',
    EXTERNAL_API_RATE_LIMIT_PER_KEY: '2',
    EXTERNAL_API_RATE_LIMIT_PER_WORKSPACE: '3'
  });
  const attempt = character => hub.fetch(new Request('https://hub.internal/external-api-rate-limit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyHash: character.repeat(64) })
  }));
  assert.equal((await attempt('a')).status, 204);
  assert.equal((await attempt('a')).status, 204);
  const keyLimited = await attempt('a');
  assert.equal(keyLimited.status, 429);
  assert.ok(Number(keyLimited.headers.get('Retry-After')) > 0);
  assert.equal((await attempt('b')).status, 204);
  assert.equal((await attempt('c')).status, 429);
});

