/** WhatsApp template variable mapping helpers (inbox + campaign defaults). */

export const TEMPLATE_MAPPING_SOURCES = Object.freeze([
  { value: 'contact.displayName', label: 'Contact name' },
  { value: 'contact.company', label: 'Company' },
  { value: 'contact.tags', label: 'Tags' },
  { value: 'contact.profileId', label: 'Messaging ID' },
  { value: 'contact.email', label: 'Email' },
  { value: 'contact.phone', label: 'Phone' },
  { value: 'channel.name', label: 'Channel name' },
  { value: 'workspace.name', label: 'Workspace name' },
  { value: 'agent.displayName', label: 'Agent name' },
  { value: 'constant', label: 'Constant value' }
]);

const ALLOWED_SOURCES = new Set(TEMPLATE_MAPPING_SOURCES.map((item) => item.value));

function cleanOptionalText(value, label, max = 500) {
  const text = String(value ?? '').trim();
  if (text.length > max) throw Object.assign(new Error(`${label} is too long.`), { status: 400 });
  return text;
}

export function templateMappingKey(channelId, templateName, templateLanguage) {
  return [
    String(channelId || '').trim(),
    String(templateName || '').trim().toLowerCase(),
    String(templateLanguage || '').trim()
  ].join('::');
}

export function normalizeTemplateMappingItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw Object.assign(new Error('Each mapping must be an object.'), { status: 400 });
  }
  const id = cleanOptionalText(raw.id, 'Mapping id', 180);
  if (!id) throw Object.assign(new Error('Each mapping needs an id.'), { status: 400 });
  const source = cleanOptionalText(raw.source, 'Mapping source', 80);
  if (source && !ALLOWED_SOURCES.has(source)) {
    throw Object.assign(new Error(`Unsupported mapping source: ${source}`), { status: 400 });
  }
  const value = source === 'constant'
    ? cleanOptionalText(raw.value, 'Constant value', 1000)
    : '';
  return {
    id,
    placeholder: cleanOptionalText(raw.placeholder, 'Placeholder', 80),
    parameterName: cleanOptionalText(raw.parameterName, 'Parameter name', 80),
    componentType: cleanOptionalText(raw.componentType, 'Component type', 40).toLowerCase(),
    source,
    value
  };
}

export function validateWhatsAppTemplateMappingsUpsert(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw Object.assign(new Error('Template mapping payload must be an object.'), { status: 400 });
  }
  const channelId = cleanOptionalText(payload.channelId, 'Channel ID', 120);
  const templateName = cleanOptionalText(payload.templateName ?? payload.name, 'Template name', 512).toLowerCase();
  const templateLanguage = cleanOptionalText(
    payload.templateLanguage ?? payload.language?.code ?? payload.language,
    'Template language',
    32
  );
  if (!channelId) throw Object.assign(new Error('Channel ID is required.'), { status: 400 });
  if (!templateName) throw Object.assign(new Error('Template name is required.'), { status: 400 });
  if (!/^[a-z0-9_]+$/.test(templateName)) {
    throw Object.assign(new Error('Template name is invalid.'), { status: 400 });
  }
  if (!templateLanguage) throw Object.assign(new Error('Template language is required.'), { status: 400 });
  if (!Array.isArray(payload.mappings)) {
    throw Object.assign(new Error('mappings must be an array.'), { status: 400 });
  }
  if (payload.mappings.length > 40) {
    throw Object.assign(new Error('A template can map at most 40 variables.'), { status: 400 });
  }
  const seen = new Set();
  const mappings = [];
  for (const item of payload.mappings) {
    const normalized = normalizeTemplateMappingItem(item);
    if (seen.has(normalized.id)) {
      throw Object.assign(new Error(`Duplicate mapping id: ${normalized.id}`), { status: 400 });
    }
    seen.add(normalized.id);
    if (normalized.source) mappings.push(normalized);
  }
  return { channelId, templateName, templateLanguage, mappings };
}

export function serializeWhatsAppTemplateMappingRow(row) {
  let mappings = [];
  try {
    const parsed = JSON.parse(row?.mappings_json || '[]');
    mappings = Array.isArray(parsed) ? parsed.map((item) => normalizeTemplateMappingItem(item)).filter((item) => item.source) : [];
  } catch {
    mappings = [];
  }
  return {
    channelId: String(row?.channel_id || ''),
    templateName: String(row?.template_name || ''),
    templateLanguage: String(row?.template_language || ''),
    mappings,
    updatedAt: String(row?.updated_at || ''),
    updatedBy: String(row?.updated_by || '')
  };
}

/** Map canonical sources onto inbox template dialog source keys. */
export function inboxSourceFromMappingSource(source) {
  const value = String(source || '').trim();
  const map = {
    'contact.displayName': 'displayName',
    'contact.company': 'company',
    'contact.tags': 'tags',
    'contact.profileId': 'channelProfileId',
    'contact.email': 'email',
    'contact.phone': 'phone',
    'channel.name': 'channelName',
    'workspace.name': 'workspaceName',
    'agent.displayName': 'agentName',
    constant: 'manual'
  };
  return map[value] || '';
}
