/** Bulk messaging campaign helpers. */

export const CAMPAIGN_AUDIENCE_SOURCES = Object.freeze(['contacts', 'upload']);
export const CAMPAIGN_MESSAGE_TYPES = Object.freeze(['template', 'text']);
export const CAMPAIGN_STATUSES = Object.freeze([
  'scheduled', 'queued', 'sending', 'paused', 'completed', 'completed_with_errors', 'failed', 'cancelled'
]);
export const CAMPAIGN_RECIPIENT_STATUSES = Object.freeze([
  'pending', 'queued', 'sent', 'delivered', 'read', 'failed'
]);


export const CAMPAIGN_CONTACT_FIELD_TARGETS = Object.freeze([
  { key: 'displayName', label: 'Name', required: false },
  { key: 'profileId', label: 'Messaging ID / Phone', required: true },
  { key: 'company', label: 'Company', required: false },
  { key: 'tags', label: 'Tags', required: false }
]);

export function normalizeCampaignStatusRank(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'read') return 5;
  if (value === 'delivered') return 4;
  if (value === 'sent' || value === 'submitted') return 3;
  if (value === 'failed') return 2;
  if (value === 'retrying' || value === 'pending' || value === 'queued') return 1;
  return 0;
}

export function mapMessageStatusToCampaignRecipient(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'read') return 'read';
  if (value === 'delivered') return 'delivered';
  if (value === 'failed') return 'failed';
  if (value === 'sent' || value === 'submitted') return 'sent';
  if (value === 'retrying') return 'queued';
  return 'pending';
}

export function preferCampaignRecipientStatus(current, next) {
  const currentRank = normalizeCampaignStatusRank(current);
  const nextRank = normalizeCampaignStatusRank(next);
  if (String(current || '').toLowerCase() === 'failed') return 'failed';
  if (String(next || '').toLowerCase() === 'failed') return 'failed';
  return nextRank >= currentRank ? mapMessageStatusToCampaignRecipient(next) : mapMessageStatusToCampaignRecipient(current);
}

export function campaignCountsFromRows(rows = []) {
  const counts = {
    totalCount: rows.length,
    pendingCount: 0,
    sentCount: 0,
    deliveredCount: 0,
    readCount: 0,
    failedCount: 0
  };
  for (const row of rows) {
    const status = String(row.status || row.recipient_status || 'pending').toLowerCase();
    if (status === 'cancelled') continue;
    if (status === 'failed') counts.failedCount += 1;
    else if (status === 'read') {
      counts.readCount += 1;
      counts.deliveredCount += 1;
      counts.sentCount += 1;
    } else if (status === 'delivered') {
      counts.deliveredCount += 1;
      counts.sentCount += 1;
    } else if (status === 'sent' || status === 'submitted') counts.sentCount += 1;
    else counts.pendingCount += 1;
  }
  return counts;
}

export function campaignFinalStatus(counts) {
  if (!counts.totalCount) return 'failed';
  if (counts.pendingCount > 0) return 'sending';
  if (counts.failedCount > 0 && counts.failedCount >= counts.totalCount) return 'failed';
  if (counts.failedCount > 0) return 'completed_with_errors';
  return 'completed';
}

export function resolveCampaignVariableValue(mapping, { contact = {}, row = {}, profileId = '' } = {}) {
  const source = String(mapping?.source || '').trim();
  if (!source || source === 'constant' || source === 'manual') {
    return String(mapping?.value ?? '').trim();
  }
  if (source === 'upload' || source === 'url') {
    return String(mapping?.value ?? '').trim();
  }
  if (source.startsWith('field.')) {
    const header = source.slice('field.'.length);
    return String(row?.[header] ?? '').trim();
  }
  if (source.startsWith('contact.')) {
    const key = source.slice('contact.'.length);
    if (key === 'displayName' || key === 'name') return String(contact.displayName || contact.display_name || '').trim();
    if (key === 'company') return String(contact.company || '').trim();
    if (key === 'tags') {
      const tags = Array.isArray(contact.tags) ? contact.tags : [];
      return tags.join(', ');
    }
    if (key === 'profileId' || key === 'channelProfileId') {
      return String(profileId || contact.profileId || contact.channelProfileId || '').trim();
    }
    return String(contact[key] ?? '').trim();
  }
  return String(mapping?.value ?? '').trim();
}

export function applyTextVariables(template, variables, context) {
  const text = String(template || '');
  if (!text) return '';
  const map = new Map();
  for (const item of Array.isArray(variables) ? variables : []) {
    const key = String(item?.key || item?.placeholder || '').trim();
    if (!key) continue;
    map.set(key, resolveCampaignVariableValue(item, context));
  }
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, rawKey) => {
    const key = String(rawKey || '').trim();
    return map.has(key) ? map.get(key) : match;
  });
}

export function buildTemplateComponentsFromMappings(mappings, context) {
  const componentMap = new Map();
  for (const mapping of Array.isArray(mappings) ? mappings : []) {
    const kind = String(mapping?.kind || 'text').toLowerCase();
    const componentType = String(mapping?.componentType || mapping?.component || 'body').toLowerCase();
    const buttonIndex = Number(mapping?.buttonIndex ?? 0);
    let key = componentType;
    if (componentType === 'button') key = `button:${buttonIndex}`;
    if (!componentMap.has(key)) {
      componentMap.set(key, componentType === 'button'
        ? {
          type: 'button',
          sub_type: String(mapping?.subType || 'url'),
          index: String(buttonIndex),
          parameters: []
        }
        : { type: componentType, parameters: [] });
    }
    const component = componentMap.get(key);
    const value = resolveCampaignVariableValue(mapping, context);
    if (kind === 'media') {
      const mediaType = String(mapping?.mediaType || 'image').toLowerCase();
      const source = String(mapping?.source || '').toLowerCase();
      if (source === 'url' || String(value).startsWith('https://')) {
        component.parameters.push({ type: mediaType, [mediaType]: { link: value } });
      } else {
        component.parameters.push({ type: mediaType, [mediaType]: { id: value } });
      }
    } else if (kind === 'location') {
      const [coordinates, name = '', address = ''] = String(value).split('|').map((part) => part.trim());
      const [latitude, longitude] = coordinates.split(',').map((part) => Number(part.trim()));
      component.parameters.push({
        type: 'location',
        location: {
          latitude,
          longitude,
          ...(name ? { name } : {}),
          ...(address ? { address } : {})
        }
      });
    } else {
      const parameter = { type: 'text', text: value };
      if (mapping?.parameterName) parameter.parameter_name = String(mapping.parameterName);
      component.parameters.push(parameter);
    }
  }
  return [...componentMap.values()];
}

export function serializeCampaign(row, counts = null) {
  const totals = counts || {
    totalCount: Number(row.total_count || 0),
    pendingCount: Number(row.pending_count || 0),
    sentCount: Number(row.sent_count || 0),
    deliveredCount: Number(row.delivered_count || 0),
    readCount: Number(row.read_count || 0),
    failedCount: Number(row.failed_count || 0)
  };
  return {
    campaignId: row.campaign_id,
    name: row.name || '',
    channelId: row.channel_id || '',
    channelName: row.channel_name || '',
    connectorType: row.connector_type || row.provider_type || '',
    audienceSource: row.audience_source || 'contacts',
    messageType: row.message_type || 'text',
    templateName: row.template_name || '',
    templateLanguage: row.template_language || '',
    messageBody: row.message_body || '',
    variableMapping: safeJson(row.variable_mapping_json, []),
    fieldMapping: safeJson(row.field_mapping_json, {}),
    status: row.status || 'queued',
    scheduledAt: row.scheduled_at || '',
    ...totals,
    createdBy: row.created_by || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    completedAt: row.completed_at || ''
  };
}

export function serializeCampaignRecipient(row) {
  return {
    recipientId: row.recipient_id,
    campaignId: row.campaign_id,
    contactId: row.contact_id || '',
    conversationId: row.conversation_id || '',
    messageId: row.message_id || '',
    displayName: row.display_name || '',
    profileId: row.profile_id || '',
    row: safeJson(row.row_json, {}),
    status: row.status || 'pending',
    error: row.error || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    messageStatus: row.message_status || '',
    messageText: row.message_text || '',
    messageTimestamp: row.message_timestamp || ''
  };
}

function safeJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// An empty preview lets the template presentation renderer resolve approved copy
// and recipient-specific component values instead of displaying the template name.
export function campaignTemplatePreview(previewText, templateName) {
  const preview = String(previewText || '').trim();
  return preview === String(templateName || '').trim() ? '' : preview;
}

// Bound work in flight, never the number of recipients in a campaign.
export async function runCampaignConcurrent(items, concurrency, task) {
  let next = 0;
  const errors = [];
  await Promise.all(Array.from({length:Math.min(concurrency, items.length)}, async () => {
    while (next < items.length) {
      const item = items[next++];
      try { await task(item); } catch (error) { errors.push(error); }
    }
  }));
  if (errors.length) throw errors[0];
}
