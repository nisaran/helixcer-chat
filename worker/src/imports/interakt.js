/** Interakt chat-history mapping helpers (pure). */

export const INTERAKT_SOURCE = 'interakt';

const CONTENT_TYPE_MAP = Object.freeze({
  Text: 'text',
  Template: 'template',
  Image: 'image',
  Video: 'video',
  Audio: 'audio',
  Document: 'document',
  Sticker: 'sticker',
  Location: 'location',
  Contact: 'contacts',
  InteractiveButton: 'interactive',
  InteractiveButtonReply: 'interactive',
  Order: 'order',
  Unknown: 'text'
});

const STATUS_MAP = Object.freeze({
  read: 'read',
  seen: 'read',
  delivered: 'delivered',
  sent: 'sent',
  failed: 'failed',
  submitted: 'sent',
  accepted: 'sent'
});

export function extractInteraktCustomer(conversation) {
  const top = conversation?.customer && typeof conversation.customer === 'object'
    ? conversation.customer
    : {};
  const rawCustomer = conversation?.raw_chat?.customer_id && typeof conversation.raw_chat.customer_id === 'object'
    ? conversation.raw_chat.customer_id
    : {};
  const traits = rawCustomer.traits && typeof rawCustomer.traits === 'object' ? rawCustomer.traits : {};
  const channelPhone = String(
    rawCustomer.channel_phone_number
    || rawCustomer.channel_account_identifier
    || top.phone
    || ''
  ).trim();
  const localPhone = String(rawCustomer.phone_number || '').trim();
  const countryCode = String(rawCustomer.country_code || '').replace(/\D/g, '');
  const phone = channelPhone
    || (countryCode && localPhone ? `${countryCode}${localPhone.replace(/\D/g, '')}` : localPhone);
  const name = String(
    traits.name
    || traits.Name
    || traits.full_name
    || top.name
    || rawCustomer.name
    || ''
  ).trim();
  return {
    externalId: String(conversation?.id || conversation?.raw_chat?.id || '').trim(),
    phone,
    displayName: name,
    status: normalizeConversationStatus(conversation?.status || conversation?.raw_chat?.chat_status)
  };
}

export function mapInteraktMessage(message) {
  const direction = String(message?.direction || '').trim().toLowerCase() === 'inbound'
    ? 'inbound'
    : 'outbound';
  const contentType = String(message?.content_type || message?.raw?.message_content_type || 'Text');
  const messageType = CONTENT_TYPE_MAP[contentType] || 'text';
  const text = interaktMessageText(message);
  const providerMessageId = String(message?.channel_message_id || '').trim();
  const externalId = String(message?.id || '').trim();
  const mediaUrl = String(message?.media_url || message?.raw?.media_url || '').trim();
  const mediaFileName = String(message?.media_file_name || message?.raw?.media_file_name || '').trim();
  const replyTo = String(
    message?.reply_to
    || message?.raw?.reply_channel_message_id
    || ''
  ).trim();
  const status = mapInteraktStatus(message?.status, direction);
  const timestamp = String(message?.timestamp || message?.raw?.created_at_utc || '').trim();
  return {
    externalId,
    providerMessageId,
    direction,
    messageType,
    text,
    status,
    timestamp,
    mediaUrl,
    mediaFileName,
    replyTo,
    contentType
  };
}

export function interaktMessageText(message) {
  const raw = String(message?.text || message?.raw?.message || '').trim();
  if (!raw) return mediaFallbackText(message);
  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      const fromTemplate = templateParametersText(parsed);
      if (fromTemplate) return fromTemplate;
    } catch {
      // Keep original text when it is not JSON.
    }
  }
  return raw;
}

function templateParametersText(value) {
  const parts = [];
  const components = Array.isArray(value) ? value : (Array.isArray(value?.components) ? value.components : null);
  if (!components) return '';
  for (const component of components) {
    for (const parameter of component?.parameters || []) {
      if (parameter?.type === 'text' && parameter.text) parts.push(String(parameter.text));
      else if (parameter?.type === 'document' && parameter.document?.filename) {
        parts.push(String(parameter.document.filename));
      } else if (parameter?.type === 'image' && parameter.image?.link) {
        parts.push('Image');
      } else if (parameter?.type === 'video' && parameter.video?.link) {
        parts.push('Video');
      }
    }
  }
  return parts.join(' · ');
}

function mediaFallbackText(message) {
  const contentType = String(message?.content_type || 'Text');
  const fileName = String(message?.media_file_name || '').trim();
  if (fileName) return fileName;
  if (CONTENT_TYPE_MAP[contentType] && contentType !== 'Text' && contentType !== 'Template') {
    return contentType;
  }
  return '';
}

export function mapInteraktStatus(value, direction) {
  const mapped = STATUS_MAP[String(value || '').trim().toLowerCase()];
  if (mapped) return mapped;
  return direction === 'inbound' ? 'received' : 'sent';
}

function normalizeConversationStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'closed' || status === 'resolved') return 'closed';
  if (status === 'pending' || status === 'waiting') return 'pending';
  return 'open';
}

export function validateInteraktBatch(conversations) {
  if (!Array.isArray(conversations)) {
    const error = new Error('Interakt import requires a conversations array.');
    error.status = 400;
    throw error;
  }
  if (conversations.length > 50) {
    const error = new Error('Send at most 50 conversations per import request.');
    error.status = 400;
    throw error;
  }
  return conversations;
}
