/**
 * WhatsApp Cloud API adapter, isolated from the core application.
 * This basic adapter supports text messages only. Add template/media/interactive payloads
 * as explicit capabilities in this module, not in the shared inbox.
 */
function ConnectorWhatsAppCloud_send_(channel, identity, message, conversation) {
  const props = PropertiesService.getScriptProperties();
  const prefix = 'CHANNEL_' + channel.channelId.toUpperCase();
  const token = props.getProperty(prefix + '_ACCESS_TOKEN');
  const phoneNumberId = props.getProperty(prefix + '_PHONE_NUMBER_ID');
  if (!token || !phoneNumberId) throw new Error('Missing WhatsApp Cloud API Script Properties for channel ' + channel.channelId + '.');

  const version = String((channel.config || {}).apiVersion || 'v23.0');
  const url = 'https://graph.facebook.com/' + version + '/' + encodeURIComponent(phoneNumberId) + '/messages';
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: identity.channelProfileId,
    type: 'text',
    text: { preview_url: false, body: message.text }
  };
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  const raw = response.getContentText();
  let data = {};
  try { data = JSON.parse(raw); } catch (e) {}
  if (code < 200 || code >= 300) throw new Error('WhatsApp API returned HTTP ' + code + ': ' + raw.slice(0, 500));
  const providerId = data.messages && data.messages[0] ? data.messages[0].id : '';
  return { status: 'submitted', providerMessageId: providerId, httpStatus: code };
}


/**
 * Normalize common WhatsApp Cloud API inbound text messages.
 * Status-only webhook notifications are ignored by this first version.
 * Signature verification with X-Hub-Signature-256 must be added before production.
 */
function ConnectorWhatsAppCloud_normalizeInbound_(payload) {
  const out = [];
  const entries = payload.entry || [];
  entries.forEach(entry => (entry.changes || []).forEach(change => {
    const value = change.value || {};
    const contacts = value.contacts || [];
    (value.messages || []).forEach(message => {
      const contact = contacts.find(c => String(c.wa_id) === String(message.from)) || {};
      out.push({
        channelProfileId: message.from,
        displayName: contact.profile ? contact.profile.name : message.from,
        text: message.text ? message.text.body : '',
        providerMessageId: message.id || '',
        timestamp: message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : '',
        messageType: message.type || 'text'
      });
    });
  }));
  return out;
}
