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
  const presentation = messageType === 'template' ? interaktTemplatePresentation(message) : null;
  const text = presentation?.text || interaktMessageText(message);
  const externalId = String(message?.id || '').trim();
  // Prefer WhatsApp/Interakt channel ids; fall back to a stable Interakt-only key so
  // re-imports without channel_message_id still dedupe instead of inserting copies.
  const providerMessageId = String(message?.channel_message_id || '').trim()
    || (externalId ? `interakt:${externalId}` : '');
  const topMediaUrl = String(message?.media_url || message?.raw?.media_url || '').trim();
  const topMediaFileName = String(message?.media_file_name || message?.raw?.media_file_name || '').trim();
  const templateAttachment = presentation?.attachment || null;
  const mediaUrl = topMediaUrl || String(templateAttachment?.externalUrl || '').trim();
  const mediaFileName = topMediaFileName || String(templateAttachment?.filename || '').trim();
  let attachmentType = String(templateAttachment?.type || '').trim();
  if (!attachmentType && ['image', 'video', 'audio', 'document'].includes(messageType)) {
    attachmentType = messageType;
  }
  if (!attachmentType && (mediaUrl || mediaFileName)) {
    attachmentType = guessAttachmentType(mediaFileName || mediaUrl);
  }
  const replyTo = String(
    message?.reply_to
    || message?.raw?.reply_channel_message_id
    || ''
  ).trim();
  const status = mapInteraktStatus(message?.status, direction);
  const timestamp = String(message?.timestamp || message?.raw?.created_at_utc || '').trim();
  const error = interaktMessageError(message, status);
  return {
    externalId,
    providerMessageId,
    direction,
    messageType,
    text,
    status,
    error,
    timestamp,
    mediaUrl,
    mediaFileName,
    attachmentType,
    replyTo,
    contentType,
    ...(presentation?.template ? { template: presentation.template } : {}),
    ...(templateAttachment && !topMediaUrl ? { attachment: templateAttachment } : {})
  };
}

/** Build a compact provider error string for failed Interakt sends. */
export function interaktMessageError(message, status = '') {
  const normalizedStatus = String(status || mapInteraktStatus(message?.status, 'outbound') || '').toLowerCase();
  const raw = message?.raw && typeof message.raw === 'object' ? message.raw : {};
  const reason = String(
    message?.error
    || message?.failure_reason
    || raw.channel_failure_reason
    || raw.failure_reason
    || ''
  ).trim();
  const code = String(
    message?.error_code
    || message?.channel_error_code
    || raw.channel_error_code
    || raw.error_code
    || ''
  ).trim();
  if (!reason && !code) return '';
  if (normalizedStatus && normalizedStatus !== 'failed' && normalizedStatus !== 'error') {
    // Keep unexpected non-failed errors if Interakt still provided a reason.
    if (!reason) return '';
  }
  if (reason && code && !reason.includes(code)) return `${reason} (${code})`.slice(0, 500);
  if (reason) return reason.slice(0, 500);
  return `Provider error ${code}`.slice(0, 500);
}

export function interaktMessageText(message) {
  const presentation = interaktTemplatePresentation(message);
  if (presentation?.text) return presentation.text;
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

/** Render Interakt template history using embedded raw_template + send components. */
export function interaktTemplatePresentation(message) {
  const definition = parseInteraktRawTemplate(message?.raw?.raw_template);
  const components = parseTemplateComponents(message?.text || message?.raw?.message);
  if (!definition && !components) return null;

  const parts = [];
  const buttons = [];
  let attachment = null;
  if (definition) {
    const headerFormat = String(definition.header_format || '').trim().toUpperCase();
    const headerParameters = componentParameters(components, 'header');
    const bodyParameters = componentParameters(components, 'body');

    const headerTemplate = typeof definition.header === 'string' ? definition.header.trim() : '';
    if (headerTemplate) {
      const headerText = replaceTemplateVariables(headerTemplate, headerParameters);
      if (headerText) parts.push(headerText);
    } else if (headerFormat === 'DOCUMENT' || headerFormat === 'IMAGE' || headerFormat === 'VIDEO') {
      // Media headers are real attachments — never prepend filenames like "file.pdf" into body text.
      attachment = extractTemplateMediaAttachment(headerParameters[0], headerFormat);
    } else if (headerFormat === 'TEXT' && headerParameters.length) {
      const headerValue = templateParameterPreview(headerParameters[0]);
      if (headerValue) parts.push(headerValue);
    }

    const bodyTemplate = String(definition.body || '').trim();
    if (bodyTemplate) {
      const bodyText = replaceTemplateVariables(bodyTemplate, bodyParameters);
      if (bodyText) parts.push(bodyText);
    } else {
      const fallback = templateParametersText(components, { skipMedia: true });
      if (fallback) parts.push(fallback);
    }

    const footer = String(definition.footer || '').trim();
    if (footer) parts.push(footer);

    for (const button of parseInteraktButtons(definition.buttons)) {
      buttons.push(button);
    }

    if (!attachment && headerParameters.length) {
      attachment = extractTemplateMediaAttachment(headerParameters[0], headerFormat);
    }
  } else {
    const fallback = templateParametersText(components, { skipMedia: true });
    if (fallback) parts.push(fallback);
    const headerParameters = componentParameters(components, 'header');
    attachment = extractTemplateMediaAttachment(headerParameters[0], '');
  }

  if (buttons.length) {
    parts.push(`Actions: ${buttons.map(button => button.text).join(', ')}`);
  }

  const text = parts.filter(Boolean).join('\n').trim();
  if (!text && !definition && !attachment) return null;

  const name = String(definition?.name || '').trim();
  const language = String(definition?.language || '').trim();
  const category = String(definition?.category || '').trim();
  const templateId = String(definition?.wa_template_id || definition?.id || '').trim();
  const template = name && language
    ? {
      name,
      language: { code: language },
      ...(templateId ? { templateId } : {}),
      ...(category ? { category } : {}),
      ...(buttons.length ? { buttons } : {})
    }
    : null;

  return {
    text: text || (name ? `Template: ${name}${language ? ` (${language})` : ''}` : ''),
    template,
    ...(attachment ? { attachment } : {})
  };
}

function parseInteraktRawTemplate(value) {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseTemplateComponents(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray(value.components)) return value.components;
  const raw = String(value || '').trim();
  if (!raw || (!raw.startsWith('[') && !raw.startsWith('{'))) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.components)) return parsed.components;
  } catch {
    return null;
  }
  return null;
}

function componentParameters(components, type) {
  if (!Array.isArray(components)) return [];
  const match = components.find(component => String(component?.type || '').toLowerCase() === type);
  return Array.isArray(match?.parameters) ? match.parameters : [];
}

function parseInteraktButtons(value) {
  let buttons = value;
  if (typeof buttons === 'string') {
    const raw = buttons.trim();
    if (!raw || raw === '{}' || raw === '[]') return [];
    try {
      buttons = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(buttons)) return [];
  const out = [];
  for (const button of buttons) {
    if (!button || typeof button !== 'object') continue;
    const type = String(button.type || '').trim().toLowerCase();
    const text = String(button.text || '').trim().slice(0, 100);
    if (!text) continue;
    const normalized = type === 'url' || type === 'phone_number' || type === 'quick_reply'
      || type === 'copy_code' || type === 'catalog' || type === 'mpm' || type === 'flow' || type === 'otp'
      ? type
      : (type === 'phone number' ? 'phone_number' : (type ? type : 'quick_reply'));
    out.push({ type: normalized, text });
    if (out.length >= 10) break;
  }
  return out;
}

function replaceTemplateVariables(text, parameters) {
  const values = (Array.isArray(parameters) ? parameters : []).map(templateParameterPreview);
  let fallbackIndex = 0;
  return String(text || '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, rawKey) => {
    const key = String(rawKey || '').trim();
    let value;
    if (/^\d+$/.test(key)) value = values[Number(key) - 1];
    if (value === undefined) value = values[fallbackIndex++];
    return value === undefined || value === '' ? match : value;
  });
}

function templateParameterPreview(parameter) {
  if (!parameter || typeof parameter !== 'object') return '';
  const type = String(parameter.type || '').toLowerCase();
  if (type === 'text') return String(parameter.text || '').trim();
  if (type === 'document') return String(parameter.document?.filename || parameter.document?.link || 'Document').trim();
  if (type === 'image') return 'Image';
  if (type === 'video') return 'Video';
  if (type === 'currency' && parameter.currency) {
    return String(parameter.currency.fallback_value || parameter.currency.code || '').trim();
  }
  if (type === 'date_time' && parameter.date_time) {
    return String(parameter.date_time.fallback_value || '').trim();
  }
  if (type === 'payload') return String(parameter.payload || '').trim();
  return '';
}

function guessAttachmentType(value) {
  const lower = String(value || '').toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp)(?:\?|$)/i.test(lower)) return 'image';
  if (/\.(mp4|mov|webm|m4v)(?:\?|$)/i.test(lower)) return 'video';
  if (/\.(mp3|ogg|wav|m4a|aac|opus)(?:\?|$)/i.test(lower)) return 'audio';
  if (/\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip|rar)(?:\?|$)/i.test(lower)) return 'document';
  return value ? 'document' : '';
}

function extractTemplateMediaAttachment(parameter, format = '') {
  if (!parameter || typeof parameter !== 'object') return null;
  const rawType = String(parameter.type || format || '').trim().toLowerCase();
  const type = rawType === 'document' || format === 'DOCUMENT'
    ? 'document'
    : (rawType === 'image' || format === 'IMAGE'
      ? 'image'
      : (rawType === 'video' || format === 'VIDEO' ? 'video' : ''));
  if (!type) return null;
  const media = parameter[type] && typeof parameter[type] === 'object' ? parameter[type] : {};
  const externalUrl = String(media.link || media.url || '').trim();
  let filename = String(media.filename || '').trim();
  if (!filename && externalUrl) {
    try {
      filename = decodeURIComponent(new URL(externalUrl).pathname.split('/').filter(Boolean).at(-1) || '');
    } catch {
      filename = '';
    }
  }
  if (!externalUrl && !filename) return null;
  return {
    type,
    filename: filename || `${type}-attachment`,
    ...(externalUrl ? { externalUrl } : {})
  };
}

function isMediaParameter(parameter) {
  const type = String(parameter?.type || '').toLowerCase();
  return type === 'document' || type === 'image' || type === 'video';
}

function templateParametersText(value, { skipMedia = false } = {}) {
  const parts = [];
  const components = Array.isArray(value) ? value : (Array.isArray(value?.components) ? value.components : null);
  if (!components) return '';
  for (const component of components) {
    for (const parameter of component?.parameters || []) {
      if (skipMedia && isMediaParameter(parameter)) continue;
      const preview = templateParameterPreview(parameter);
      if (preview) parts.push(preview);
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
