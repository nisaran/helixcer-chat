/** Interakt chat-history mapping helpers (pure). */

export const INTERAKT_SOURCE = 'interakt';

export const CONTACT_TARGET_FIELDS = Object.freeze([
  { key: 'name', label: 'Name', required: false },
  { key: 'phone', label: 'Phone (with country code)', required: true },
  { key: 'company', label: 'Company', required: false },
  { key: 'tags', label: 'Tags', required: false }
]);

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

const PHONE_SOURCE_FIELDS = Object.freeze([
  { path: 'channel_phone_number', label: 'channel_phone_number (with country code)' },
  { path: 'channel_account_identifier', label: 'channel_account_identifier' },
  { path: 'phone_number_with_country_code', label: 'phone_number + country_code' },
  { path: 'phone_number', label: 'phone_number (local)' },
  { path: 'customer.phone', label: 'customer.phone' }
]);

export function discoverInteraktContactFields(conversations) {
  const list = Array.isArray(conversations) ? conversations : [];
  const counts = new Map();
  const bump = (path, label, sample = '') => {
    const current = counts.get(path) || { path, label, count: 0, sample: '' };
    current.count += 1;
    if (!current.sample && sample) current.sample = String(sample).slice(0, 80);
    counts.set(path, current);
  };

  for (const conversation of list) {
    const { top, rawCustomer, traits, tags } = customerParts(conversation);
    if (rawCustomer.channel_phone_number) {
      bump('channel_phone_number', 'channel_phone_number (with country code)', rawCustomer.channel_phone_number);
    }
    if (rawCustomer.channel_account_identifier) {
      bump('channel_account_identifier', 'channel_account_identifier', rawCustomer.channel_account_identifier);
    }
    if (rawCustomer.phone_number) {
      bump('phone_number', 'phone_number (local)', rawCustomer.phone_number);
      if (rawCustomer.country_code) {
        bump('phone_number_with_country_code', 'phone_number + country_code',
          `${rawCustomer.country_code}${String(rawCustomer.phone_number).replace(/\D/g, '')}`);
      }
    }
    if (top.phone) bump('customer.phone', 'customer.phone', top.phone);
    if (top.name) bump('customer.name', 'customer.name', top.name);
    if (Array.isArray(tags) && tags.length) {
      const readable = tags.filter(tag => typeof tag === 'string' && tag.trim());
      if (readable.length) bump('tags', 'tags', readable.slice(0, 3).join(', '));
    }
    for (const [key, value] of Object.entries(traits)) {
      if (value === undefined || value === null || value === '') continue;
      const sample = Array.isArray(value) ? value.slice(0, 3).join(', ') : value;
      bump(`traits.${key}`, `traits.${key}`, sample);
    }
  }

  return [...counts.values()].sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    return left.path.localeCompare(right.path);
  });
}

export function defaultInteraktFieldMapping(availableFields = []) {
  const paths = new Set(availableFields.map(field => field.path));
  const pick = (...candidates) => candidates.find(path => paths.has(path)) || '';
  return {
    name: pick('traits.name', 'traits.Name', 'traits.full_name', 'customer.name', 'traits.User Name'),
    phone: pick('channel_phone_number', 'phone_number_with_country_code', 'channel_account_identifier', 'customer.phone'),
    company: pick('traits.Company', 'traits.company', 'traits.company_name'),
    // Interakt tags are often opaque UUIDs — leave unmapped unless the user opts in.
    tags: ''
  };
}

export function normalizeFieldMapping(value) {
  const input = value && typeof value === 'object' ? value : {};
  const mapping = {};
  for (const field of CONTACT_TARGET_FIELDS) {
    mapping[field.key] = String(input[field.key] || '').trim();
  }
  return mapping;
}

export function extractInteraktCustomer(conversation, fieldMapping = null) {
  const mapping = normalizeFieldMapping(fieldMapping || defaultInteraktFieldMapping(
    discoverInteraktContactFields([conversation])
  ));
  const displayName = mapping.name ? String(readSourceValue(conversation, mapping.name) || '').trim() : '';
  const phone = mapping.phone ? String(readSourceValue(conversation, mapping.phone) || '').trim() : '';
  const company = mapping.company ? String(readSourceValue(conversation, mapping.company) || '').trim() : '';
  const tags = mapping.tags ? normalizeTagValues(readSourceValue(conversation, mapping.tags)) : [];
  return {
    externalId: String(conversation?.id || conversation?.raw_chat?.id || '').trim(),
    phone,
    displayName,
    company,
    tags,
    status: normalizeConversationStatus(conversation?.status || conversation?.raw_chat?.chat_status),
    fieldMapping: mapping
  };
}

export function readSourceValue(conversation, path) {
  const key = String(path || '').trim();
  if (!key) return '';
  const { top, rawCustomer, traits, tags } = customerParts(conversation);
  if (key === 'tags') return tags;
  if (key === 'channel_phone_number') return rawCustomer.channel_phone_number || '';
  if (key === 'channel_account_identifier') return rawCustomer.channel_account_identifier || '';
  if (key === 'phone_number') return rawCustomer.phone_number || '';
  if (key === 'phone_number_with_country_code') {
    const local = String(rawCustomer.phone_number || '').replace(/\D/g, '');
    const country = String(rawCustomer.country_code || '').replace(/\D/g, '');
    return country && local ? `${country}${local}` : local;
  }
  if (key === 'customer.phone') return top.phone || '';
  if (key === 'customer.name') return top.name || '';
  if (key.startsWith('traits.')) return traits[key.slice('traits.'.length)] ?? '';
  return '';
}

function customerParts(conversation) {
  const top = conversation?.customer && typeof conversation.customer === 'object'
    ? conversation.customer
    : {};
  const rawCustomer = conversation?.raw_chat?.customer_id && typeof conversation.raw_chat.customer_id === 'object'
    ? conversation.raw_chat.customer_id
    : {};
  const traits = rawCustomer.traits && typeof rawCustomer.traits === 'object' ? rawCustomer.traits : {};
  const tags = Array.isArray(rawCustomer.tags) ? rawCustomer.tags : [];
  return { top, rawCustomer, traits, tags };
}

function normalizeTagValues(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[|,]/);
  const tags = [];
  const seen = new Set();
  for (const item of list) {
    const tag = String(item || '').trim().slice(0, 40);
    if (!tag) continue;
    const key = tag.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 20) break;
  }
  return tags;
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

export { PHONE_SOURCE_FIELDS };
