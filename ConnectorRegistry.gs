/**
 * Connector dispatch is isolated from core conversation storage.
 * Add provider-specific modules here only when a provider needs behavior not expressible
 * by the generic connector. Keep UI and common data model unchanged.
 */
function ConnectorRegistry_send_(channel, identity, message, conversation) {
  if (channel.connectorType === 'generic_http') {
    return ConnectorGeneric_send_(channel, identity, message, conversation);
  }
  if (channel.connectorType === 'whatsapp_cloud') {
    return ConnectorWhatsAppCloud_send_(channel, identity, message, conversation);
  }
  throw new Error('No adapter registered for connector type: ' + channel.connectorType);
}
