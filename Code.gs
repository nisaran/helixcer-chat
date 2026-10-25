const TABLES = {
  Channels: ['channelId','name','connectorType','enabled','capabilitiesJson','configJson','secretKey','createdAt','updatedAt'],
  Contacts: ['contactId','displayName','createdAt','updatedAt','attributesJson'],
  ChannelIdentities: ['identityId','contactId','channelId','channelProfileId','displayName','metadataJson','createdAt'],
  Conversations: ['conversationId','contactId','channelId','status','assignedTo','subject','lastMessageAt','unreadCount','tagsJson','customFieldsJson','createdAt','updatedAt'],
  Messages: ['messageId','conversationId','contactId','channelId','direction','messageType','text','providerMessageId','status','timestamp','payloadJson','error'],
  Templates: ['templateId','channelId','name','language','category','schemaJson','providerTemplateName','enabled'],
  Agents: ['agentId','email','displayName','role','enabled'],
  AuditLog: ['auditId','actor','action','targetType','targetId','detailsJson','timestamp']
};

function doGet(e) {
  // WhatsApp webhook verification handshake. The configured verify token is stored in Script Properties.
  if (e && e.parameter && e.parameter['hub.mode'] === 'subscribe') {
    const channelId = String(e.parameter.channelId || '');
    const channel = listChannels_().find(c => c.channelId === channelId && c.connectorType === 'whatsapp_cloud');
    const expected = PropertiesService.getScriptProperties().getProperty('CHANNEL_' + channelId.toUpperCase() + '_VERIFY_TOKEN');
    if (channel && expected && e.parameter['hub.verify_token'] === expected) {
      return ContentService.createTextOutput(String(e.parameter['hub.challenge'] || ''));
    }
    return ContentService.createTextOutput('Forbidden');
  }
  const email = Session.getActiveUser().getEmail();
  if (!isAllowed_(email)) {
    return HtmlService.createHtmlOutput('<h2>Access denied</h2><p>Your account is not authorized to use Helixcer Chat.</p>');
  }
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Helixcer Chat')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Provider webhooks use ?channelId=<configured-channel-id>. This endpoint normalizes supported
// inbound events into the shared contact / identity / conversation / message tables.
function doPost(e) {
  try {
    const channelId = String((e && e.parameter && e.parameter.channelId) || '');
    if (!channelId) return jsonOutput_({ ok:false, error:'Missing channelId query parameter.' });
    const channel = listChannels_().find(c => c.channelId === channelId && c.enabled);
    if (!channel) return jsonOutput_({ ok:false, error:'Unknown or disabled channel.' });
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const payload = JSON.parse(raw);
    let normalized;
    if (channel.connectorType === 'whatsapp_cloud') {
      normalized = ConnectorWhatsAppCloud_normalizeInbound_(payload);
    } else {
      normalized = ConnectorGeneric_normalizeInbound_(channel, payload);
    }
    (normalized || []).forEach(msg => storeInbound_(channel, msg, payload));
    return jsonOutput_({ ok:true, received:(normalized || []).length });
  } catch (err) {
    return jsonOutput_({ ok:false, error:String(err && err.message || err) });
  }
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function storeInbound_(channel, msg, rawPayload) {
  if (!msg || !msg.channelProfileId || (!msg.text && !msg.providerMessageId)) return;
  const now = new Date().toISOString();
  const profileId = String(msg.channelProfileId);
  let identity = rows_('ChannelIdentities').find(i => String(i.channelId) === channel.channelId && String(i.channelProfileId) === profileId);
  let contactId;
  if (identity) {
    contactId = String(identity.contactId);
  } else {
    contactId = Utilities.getUuid();
    append_('Contacts', { contactId, displayName:String(msg.displayName || profileId), createdAt:now, updatedAt:now, attributesJson:'{}' });
    append_('ChannelIdentities', { identityId:Utilities.getUuid(), contactId, channelId:channel.channelId, channelProfileId:profileId, displayName:String(msg.displayName || profileId), metadataJson:'{}', createdAt:now });
  }
  let conversation = rows_('Conversations').find(c => String(c.contactId) === contactId && String(c.channelId) === channel.channelId && String(c.status) !== 'closed');
  if (!conversation) {
    const conversationId = Utilities.getUuid();
    append_('Conversations', { conversationId, contactId, channelId:channel.channelId, status:'open', assignedTo:'', subject:String(msg.displayName || profileId), lastMessageAt:now, unreadCount:1, tagsJson:'[]', customFieldsJson:'{}', createdAt:now, updatedAt:now });
    conversation = { conversationId, contactId, channelId:channel.channelId };
  } else {
    const sh = db_().getSheetByName('Conversations');
    const data = sh.getDataRange().getValues();
    const rowIndex = data.findIndex((r,i) => i > 0 && String(r[0]) === String(conversation.conversationId));
    if (rowIndex > 0) {
      const headers = data[0], row = data[rowIndex], obj = {};
      headers.forEach((h,i)=>obj[h]=row[i]);
      obj.lastMessageAt = now; obj.updatedAt = now; obj.unreadCount = Number(obj.unreadCount || 0) + 1;
      sh.getRange(rowIndex + 1, 1, 1, headers.length).setValues([headers.map(h => obj[h] === undefined ? '' : obj[h])]);
    }
  }
  append_('Messages', { messageId:Utilities.getUuid(), conversationId:String(conversation.conversationId), contactId,
    channelId:channel.channelId, direction:'inbound', messageType:String(msg.messageType || 'text'),
    text:String(msg.text || ''), providerMessageId:String(msg.providerMessageId || ''), status:'received',
    timestamp:String(msg.timestamp || now), payloadJson:JSON.stringify(rawPayload), error:'' });
}


function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function setupDatabase() {
  const id = PropertiesService.getScriptProperties().getProperty('DATABASE_SPREADSHEET_ID');
  if (!id) throw new Error('Set DATABASE_SPREADSHEET_ID in Script Properties first.');
  const ss = SpreadsheetApp.openById(id);
  Object.keys(TABLES).forEach(name => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(TABLES[name]);
      sheet.setFrozenRows(1);
    } else {
      const existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      if (existing.join('|') !== TABLES[name].join('|')) {
        throw new Error('Schema mismatch in sheet "' + name + '". Back up and reconcile its header row manually.');
      }
    }
  });
  return 'Database tables created.';
}

function api(action, payload) {
  const email = Session.getActiveUser().getEmail();
  if (!isAllowed_(email)) throw new Error('Unauthorized');
  payload = payload || {};
  switch (action) {
    case 'bootstrap': return bootstrap_();
    case 'listConversations': return listConversations_();
    case 'getMessages': return getMessages_(String(payload.conversationId || ''));
    case 'sendMessage': return sendMessage_(payload, email);
    case 'saveChannel': return saveChannel_(payload, email);
    case 'deleteChannel': return deleteChannel_(String(payload.channelId || ''), email);
    case 'listChannels': return listChannels_();
    case 'createContact': return createContact_(payload, email);
    default: throw new Error('Unknown action');
  }
}

function isAllowed_(email) {
  const raw = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS') || '';
  const allowed = raw.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  return !!email && allowed.indexOf(email.toLowerCase()) !== -1;
}

function bootstrap_() {
  return {
    appName: 'Helixcer Chat',
    channels: listChannels_(),
    conversations: listConversations_(),
    connectorTypes: [
      { value: 'whatsapp_cloud', label: 'WhatsApp Cloud API', capabilities: ['text','template'] },
      { value: 'generic_http', label: 'Generic HTTP API / Webhook', capabilities: ['text'] }
    ]
  };
}

function db_() {
  const id = PropertiesService.getScriptProperties().getProperty('DATABASE_SPREADSHEET_ID');
  if (!id) throw new Error('DATABASE_SPREADSHEET_ID is not configured.');
  return SpreadsheetApp.openById(id);
}

function rows_(table) {
  const sh = db_().getSheetByName(table);
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getDataRange().getValues();
  const headers = values.shift();
  return values.filter(row => row.some(v => v !== '')).map(row => {
    const o = {};
    headers.forEach((h, i) => o[h] = row[i]);
    return o;
  });
}

function append_(table, obj) {
  const sh = db_().getSheetByName(table);
  if (!sh) throw new Error('Missing table: ' + table);
  const headers = TABLES[table];
  sh.appendRow(headers.map(h => obj[h] === undefined ? '' : obj[h]));
}

function listChannels_() {
  return rows_('Channels').map(c => ({
    channelId: String(c.channelId), name: String(c.name), connectorType: String(c.connectorType),
    enabled: String(c.enabled).toLowerCase() === 'true',
    capabilities: parseJson_(c.capabilitiesJson, []),
    config: parseJson_(c.configJson, {}),
    secretKey: String(c.secretKey || '')
  }));
}

function listConversations_() {
  return rows_('Conversations').map(c => ({
    conversationId: String(c.conversationId), contactId: String(c.contactId), channelId: String(c.channelId),
    status: String(c.status || 'open'), assignedTo: String(c.assignedTo || ''),
    subject: String(c.subject || ''), lastMessageAt: String(c.lastMessageAt || ''),
    unreadCount: Number(c.unreadCount || 0), tags: parseJson_(c.tagsJson, [])
  })).sort((a,b) => String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)));
}

function getMessages_(conversationId) {
  if (!conversationId) return [];
  return rows_('Messages').filter(m => String(m.conversationId) === conversationId)
    .sort((a,b) => String(a.timestamp).localeCompare(String(b.timestamp)))
    .map(m => ({ messageId:String(m.messageId), direction:String(m.direction), text:String(m.text || ''),
      messageType:String(m.messageType || 'text'), status:String(m.status || ''), timestamp:String(m.timestamp || ''),
      channelId:String(m.channelId), error:String(m.error || '') }));
}

function saveChannel_(p, actor) {
  requireAdmin_(actor);
  const name = String(p.name || '').trim();
  const connectorType = String(p.connectorType || '').trim();
  if (!name || !connectorType) throw new Error('Channel name and connector type are required.');
  if (!['whatsapp_cloud','generic_http'].includes(connectorType)) throw new Error('Unsupported connector type.');
  const id = String(p.channelId || Utilities.getUuid());
  const existing = rows_('Channels').find(c => String(c.channelId) === id);
  const now = new Date().toISOString();
  const record = {
    channelId: id, name, connectorType, enabled: p.enabled === false ? false : true,
    capabilitiesJson: JSON.stringify(Array.isArray(p.capabilities) ? p.capabilities : ['text']),
    configJson: JSON.stringify(p.config || {}),
    secretKey: connectorType === 'generic_http' ? String(p.secretKey || 'CHANNEL_' + id.toUpperCase()) : 'CHANNEL_' + id,
    createdAt: existing ? existing.createdAt : now, updatedAt: now
  };
  if (existing) {
    const sh = db_().getSheetByName('Channels');
    const all = sh.getDataRange().getValues();
    const headers = all[0];
    const rowIndex = all.findIndex((r,i) => i > 0 && String(r[0]) === id);
    sh.getRange(rowIndex + 1, 1, 1, headers.length).setValues([headers.map(h => record[h] === undefined ? '' : record[h])]);
  } else append_('Channels', record);
  audit_(actor, existing ? 'update' : 'create', 'channel', id, { name, connectorType });
  return { ok: true, channelId: id };
}

function deleteChannel_(id, actor) {
  requireAdmin_(actor);
  const sh = db_().getSheetByName('Channels');
  const data = sh.getDataRange().getValues();
  const index = data.findIndex((r,i) => i > 0 && String(r[0]) === id);
  if (index < 1) throw new Error('Channel not found.');
  sh.deleteRow(index + 1);
  audit_(actor, 'delete', 'channel', id, {});
  return { ok: true };
}

function sendMessage_(p, actor) {
  const conversationId = String(p.conversationId || '');
  const text = String(p.text || '').trim();
  if (!conversationId || !text) throw new Error('Conversation and message text are required.');
  const conversation = rows_('Conversations').find(c => String(c.conversationId) === conversationId);
  if (!conversation) throw new Error('Conversation not found.');
  const channel = listChannels_().find(c => c.channelId === String(conversation.channelId));
  if (!channel || !channel.enabled) throw new Error('Channel is missing or disabled.');
  const identity = rows_('ChannelIdentities').find(i => String(i.contactId) === String(conversation.contactId) && String(i.channelId) === channel.channelId);
  if (!identity) throw new Error('No channel identity is linked to this contact.');
  const result = ConnectorRegistry_send_(channel, identity, { text }, conversation);
  const now = new Date().toISOString();
  append_('Messages', {
    messageId: Utilities.getUuid(), conversationId, contactId: String(conversation.contactId), channelId: channel.channelId,
    direction: 'outbound', messageType: 'text', text, providerMessageId: result.providerMessageId || '',
    status: result.status || 'submitted', timestamp: now, payloadJson: JSON.stringify(result), error: ''
  });
  audit_(actor, 'send_message', 'conversation', conversationId, { channelId: channel.channelId });
  return { ok: true, result };
}

function createContact_(p, actor) {
  const displayName = String(p.displayName || '').trim();
  const channelId = String(p.channelId || '').trim();
  const channelProfileId = String(p.channelProfileId || '').trim();
  if (!displayName || !channelId || !channelProfileId) throw new Error('Name, channel, and Channel Profile ID are required.');
  const channel = listChannels_().find(c => c.channelId === channelId);
  if (!channel) throw new Error('Unknown channel.');
  const now = new Date().toISOString();
  const contactId = Utilities.getUuid();
  const identityId = Utilities.getUuid();
  append_('Contacts', { contactId, displayName, createdAt: now, updatedAt: now, attributesJson: '{}' });
  append_('ChannelIdentities', { identityId, contactId, channelId, channelProfileId, displayName, metadataJson: '{}', createdAt: now });
  const conversationId = Utilities.getUuid();
  append_('Conversations', { conversationId, contactId, channelId, status: 'open', assignedTo: actor, subject: displayName, lastMessageAt: now, unreadCount: 0, tagsJson: '[]', customFieldsJson: '{}', createdAt: now, updatedAt: now });
  audit_(actor, 'create', 'contact', contactId, { channelId });
  return { ok: true, contactId, conversationId };
}

function requireAdmin_(actor) {
  if (!isAllowed_(actor)) throw new Error('Administrator permission required.');
}

function audit_(actor, action, targetType, targetId, details) {
  append_('AuditLog', { auditId: Utilities.getUuid(), actor, action, targetType, targetId, detailsJson: JSON.stringify(details || {}), timestamp: new Date().toISOString() });
}

function parseJson_(v, fallback) {
  try { return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
}
