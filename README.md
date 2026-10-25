# Helixcer Chat — configuration-driven starter

Starter architecture: Google Apps Script backend + Google Sheets datastore + GitHub source control.
The included UI is served by Apps Script `HtmlService` to avoid the common cross-origin issues that occur when a GitHub Pages page directly calls an Apps Script web app. GitHub remains the source repository; deploy backend changes with `clasp` or paste files into the Apps Script editor.

## Design principles
- Channel instances, capabilities, API mappings, and routing are records in the `Channels` sheet.
- Core inbox UI is channel-agnostic. It renders channel names/icons/capabilities from configuration.
- Connectors are separate modules: `ConnectorGeneric.gs` and `ConnectorWhatsAppCloud.gs`. Add other provider connectors as separate modules, not branches in core inbox logic.
- Secrets are stored in Apps Script Script Properties, never in Sheets or frontend code. `secretKey` in a channel record points to a Script Property prefix.
- Incoming provider events are normalized by separate connector functions and stored in the common message schema. Webhook URL format: `YOUR_DEPLOYED_WEB_APP_URL?channelId=<channelId>`.
- WhatsApp webhook verification handshake is scaffolded; verify-token setup and Meta webhook subscription must be configured. Signature verification is not implemented yet, so do not expose this webhook publicly in production until it is added.
- Generic inbound mapping is configured through `config.inboundMapping` dot-path fields.
- This starter is a scaffold, not production-ready. Add authentication/authorization, webhook signature verification, quotas, retry queues, audit logs, media handling, and provider-specific compliance before production use.

## Initial included connector
- Generic HTTP API connector with configurable endpoint, method, headers (secret references only), body template, and response mapping.
- WhatsApp Cloud API connector as a separate adapter. Credentials are Script Properties per channel:
  - `CHANNEL_<channelId>_ACCESS_TOKEN`
  - `CHANNEL_<channelId>_PHONE_NUMBER_ID`
  - `CHANNEL_<channelId>_VERIFY_TOKEN`
  - `CHANNEL_<channelId>_APP_SECRET` (for signature verification; verification is not implemented in this starter)

## Quick start
1. Create a Google Sheet for the database.
2. Create a standalone Google Apps Script project.
3. Copy `.gs` files into the Apps Script project. Add `Index.html`.
4. In Script Properties, set `DATABASE_SPREADSHEET_ID` to the Sheet ID.
5. Run `setupDatabase()` once and authorize it.
6. Set `ADMIN_EMAILS` in Script Properties to a comma-separated allowlist of administrator emails.
7. Deploy as a web app. For initial testing, execute as yourself and restrict access to your organization/users as appropriate. Avoid public unauthenticated deployment.
8. Add channel config records via the Admin → Channels UI, then set the required channel secrets in Script Properties.
9. Keep source in GitHub. For repeatable deployments, use `clasp` with a controlled CI workflow; never commit secrets or `.clasp.json` values containing sensitive data.

## Data model
- `Channels`: channelId, name, connectorType, enabled, capabilitiesJson, configJson, secretKey, createdAt, updatedAt
- `Contacts`: contactId, displayName, createdAt, updatedAt, attributesJson
- `ChannelIdentities`: identityId, contactId, channelId, channelProfileId, displayName, metadataJson, createdAt
- `Conversations`: conversationId, contactId, channelId, status, assignedTo, subject, lastMessageAt, unreadCount, tagsJson, customFieldsJson, createdAt, updatedAt
- `Messages`: messageId, conversationId, contactId, channelId, direction, messageType, text, providerMessageId, status, timestamp, payloadJson, error
- `Templates`: templateId, channelId, name, language, category, schemaJson, providerTemplateName, enabled
- `Agents`: agentId, email, displayName, role, enabled
- `AuditLog`: auditId, actor, action, targetType, targetId, detailsJson, timestamp

## Generic channel config example
```json
{
  "endpoint": "https://api.example.com/messages",
  "method": "POST",
  "headers": {
    "Authorization": "Bearer {{secret:API_TOKEN}}",
    "Content-Type": "application/json"
  },
  "bodyTemplate": {
    "to": "{{recipient.channelProfileId}}",
    "text": "{{message.text}}"
  },
  "responseMapping": {
    "providerMessageId": "id",
    "status": "status"
  }
}
```
Only trusted administrators should be able to edit these mappings. Generic API configuration can call arbitrary URLs, so production must include URL allowlisting/SSRF controls and admin audit logs.
