function ConnectorGeneric_send_(channel, identity, message, conversation) {
  const cfg = channel.config || {};
  if (!cfg.endpoint) throw new Error('Generic connector endpoint is not configured.');
  const method = String(cfg.method || 'POST').toUpperCase();
  if (!['POST','PUT','PATCH'].includes(method)) throw new Error('Only POST, PUT, and PATCH are enabled in this starter.');
  validateEndpoint_(cfg.endpoint);

  const props = PropertiesService.getScriptProperties();
  const secretPrefix = channel.secretKey || ('CHANNEL_' + channel.channelId.toUpperCase());
  const context = {
    recipient: { channelProfileId: identity.channelProfileId, displayName: identity.displayName },
    message: message,
    conversation: { conversationId: conversation.conversationId, contactId: conversation.contactId },
    channel: { channelId: channel.channelId, name: channel.name }
  };
  const headers = resolveTemplate_(cfg.headers || { 'Content-Type':'application/json' }, context, props, secretPrefix);
  const body = resolveTemplate_(cfg.bodyTemplate || {
    to: '{{recipient.channelProfileId}}', text: '{{message.text}}'
  }, context, props, secretPrefix);
  const response = UrlFetchApp.fetch(cfg.endpoint, {
    method: method.toLowerCase(), contentType: 'application/json',
    headers: headers, payload: JSON.stringify(body), muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  const raw = response.getContentText();
  if (code < 200 || code >= 300) throw new Error('Provider API returned HTTP ' + code + ': ' + raw.slice(0, 500));
  let parsed = {};
  try { parsed = JSON.parse(raw); } catch (e) {}
  const mapping = cfg.responseMapping || {};
  return {
    status: mapping.status ? getPath_(parsed, mapping.status) || 'submitted' : 'submitted',
    providerMessageId: mapping.providerMessageId ? getPath_(parsed, mapping.providerMessageId) || '' : '',
    httpStatus: code
  };
}

function resolveTemplate_(value, context, props, secretPrefix) {
  if (Array.isArray(value)) return value.map(v => resolveTemplate_(v, context, props, secretPrefix));
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach(k => out[k] = resolveTemplate_(value[k], context, props, secretPrefix));
    return out;
  }
  if (typeof value !== 'string') return value;
  return value.replace(/\{\{([^}]+)\}\}/g, function(_, expr) {
    expr = expr.trim();
    if (expr.indexOf('secret:') === 0) {
      const name = expr.slice(7).trim();
      const key = name.indexOf('CHANNEL_') === 0 ? name : secretPrefix + '_' + name;
      const secret = props.getProperty(key);
      if (secret === null) throw new Error('Missing Script Property secret: ' + key);
      return secret;
    }
    const v = getPath_(context, expr);
    return v === undefined || v === null ? '' : String(v);
  });
}

function getPath_(obj, path) {
  return String(path || '').split('.').reduce((v, k) => v == null ? undefined : v[k], obj);
}

function validateEndpoint_(endpoint) {
  const url = String(endpoint);
  if (!/^https:\/\/[^/]+/i.test(url)) throw new Error('Endpoint must use HTTPS.');
  const host = url.match(/^https:\/\/([^/:?#]+)/i);
  if (!host) throw new Error('Invalid endpoint URL.');
  const hostname = host[1].toLowerCase();
  const blocked = ['localhost','127.0.0.1','0.0.0.0','169.254.169.254'];
  if (blocked.indexOf(hostname) >= 0 || hostname.endsWith('.local')) throw new Error('Endpoint host is not allowed.');
  // Production hardening required: use an explicit administrator-managed hostname allowlist.
}


/**
 * Generic inbound mapping. Configure config.inboundMapping with dot paths:
 * { "eventsPath":"events", "senderIdPath":"sender.id", "senderNamePath":"sender.name",
 *   "textPath":"message.text", "messageIdPath":"message.id", "timestampPath":"timestamp" }
 * If eventsPath is omitted, the root object is treated as one event.
 */
function ConnectorGeneric_normalizeInbound_(channel, payload) {
  const m = (channel.config || {}).inboundMapping || {};
  const events = m.eventsPath ? getPath_(payload, m.eventsPath) : [payload];
  const list = Array.isArray(events) ? events : (events ? [events] : []);
  return list.map(event => ({
    channelProfileId: getPath_(event, m.senderIdPath || 'from'),
    displayName: getPath_(event, m.senderNamePath || 'senderName') || '',
    text: getPath_(event, m.textPath || 'text') || '',
    providerMessageId: getPath_(event, m.messageIdPath || 'id') || '',
    timestamp: getPath_(event, m.timestampPath || 'timestamp') || '',
    messageType: getPath_(event, m.messageTypePath || 'type') || 'text'
  })).filter(x => x.channelProfileId);
}
