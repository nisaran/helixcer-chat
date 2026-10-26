# Helixcer Developer API

Connect external applications to the Helixcer inbox through the Helixcer Messaging API. The currently available channel module is WhatsApp.

## WhatsApp

### Template messages

Send approved WhatsApp templates from your server while keeping every outbound message, delivery update, and reply in the Helixcer inbox.

> **Available now:** The external Messaging API currently supports WhatsApp template messages. Telegram and Instagram external-send endpoints are not enabled yet.

> **Delivery readiness:** Live delivery requires an enabled WhatsApp channel, a valid Meta access token, and an approved template whose name, language, components, and parameters match the request.

## At a glance

| | |
|---|---|
| Base URL | `https://api.chat.helixcer.com` |
| Send a template | `POST /api/v1/whatsapp/template-messages` |
| Read message status | `GET /api/v1/messages/{messageId}` |
| Authentication | `Authorization: Bearer hxc_live_...` |
| Request format | `application/json` |

Your application supplies a Helixcer channel ID and a Meta-native template object. Helixcer selects the saved WhatsApp connection, writes the outbound message to the chatbox, sends it to Meta, and applies Meta status webhooks to the same message.

Your application must **not** send a Meta access token, WhatsApp Business Account ID, phone-number ID, Graph API URL, `messaging_product`, or `recipient_type`. Those belong to the selected Helixcer channel.

## Authentication and key safety

Create a workspace API key in Helixcer and send it as a Bearer token:

```http
Authorization: Bearer hxc_live_REPLACE_WITH_YOUR_KEY
```

An API key is shown once. Store it in a server-side secret manager or environment variable. Never place it in browser JavaScript, a mobile app, logs, screenshots, support messages, or a Git repository. A Helixcer API key is not a Meta access token.

Keys are bound to one workspace and apply to its WhatsApp connections. Sending requires the `whatsapp:template:send` scope; reading status requires `messages:read`. Every send still selects the required workspace connection with `channelId`. Revoke and replace a key immediately if it may have leaked; rotate production keys periodically.

## Send a template message

```http
POST https://api.chat.helixcer.com/api/v1/whatsapp/template-messages
Authorization: Bearer hxc_live_REPLACE_WITH_YOUR_KEY
Content-Type: application/json
```

```json
{
  "channelId": "66d66f0c-0ca2-4c79-96b9-d182d5a481b4",
  "to": "919999999999",
  "contact": {
    "displayName": "Asha"
  },
  "clientReference": "order-1001",
  "previewText": "Order ORD-1001 confirmed",
  "template": {
    "name": "order_confirmation",
    "language": {
      "code": "en_US"
    },
    "components": [
      {
        "type": "body",
        "parameters": [
          { "type": "text", "text": "Asha" },
          { "type": "text", "text": "ORD-1001" }
        ]
      }
    ]
  }
}
```

### Top-level fields

| Field | Required | Description |
|---|---:|---|
| `channelId` | Yes | Helixcer ID of the saved WhatsApp channel that sends the message. |
| `to` | Yes | Recipient's WhatsApp number in international format, using digits only. Example: `919999999999`. |
| `contact.displayName` | No | Name used to save or update to the contact list |
| `clientReference` | No | Your order, ticket, campaign, or transaction identifier. It is stored with and returned on the message for reconciliation. |
| `previewText` | No | Optional inbox-text override. When omitted, Helixcer renders the approved Meta template with the supplied variables, media, footer, and action labels. This does not change the WhatsApp payload. |
| `template` | Yes | Meta-native template object. `name` and `language.code` are required; `components` is included when the approved template expects parameters. |

`template.name`, language, component order, button indexes, and parameter types must match the template approved for the selected WhatsApp Business Account.

### cURL

```bash
curl --request POST \
  --url https://api.chat.helixcer.com/api/v1/whatsapp/template-messages \
  --header 'Authorization: Bearer hxc_live_REPLACE_WITH_YOUR_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "channelId": "66d66f0c-0ca2-4c79-96b9-d182d5a481b4",
    "to": "919999999999",
    "contact": { "displayName": "Asha" },
    "clientReference": "order-1001",
    "previewText": "Order ORD-1001 confirmed",
    "template": {
      "name": "order_confirmation",
      "language": { "code": "en_US" },
      "components": [
        {
          "type": "body",
          "parameters": [
            { "type": "text", "text": "Asha" },
            { "type": "text", "text": "ORD-1001" }
          ]
        }
      ]
    }
  }'
```

## Template examples

The examples below show only the request body. Every send request also needs the authentication and content-type headers shown above.

### Simple template with no variables

Omit `components` when the approved template has no runtime values.

```json
{
  "channelId": "66d66f0c-0ca2-4c79-96b9-d182d5a481b4",
  "to": "919999999999",
  "previewText": "Hello from Helixcer",
  "template": {
    "name": "hello_world",
    "language": { "code": "en_US" }
  }
}
```

### Positional body variables

Values are matched to `{{1}}`, `{{2}}`, and so on in their array order.

```json
{
  "channelId": "66d66f0c-0ca2-4c79-96b9-d182d5a481b4",
  "to": "919999999999",
  "previewText": "Order ORD-1001 ships on 28 October",
  "template": {
    "name": "order_update",
    "language": { "code": "en_US" },
    "components": [
      {
        "type": "body",
        "parameters": [
          { "type": "text", "text": "ORD-1001" },
          { "type": "text", "text": "28 October" }
        ]
      }
    ]
  }
}
```

### Named body variables

For a template created with named variables, include the approved `parameter_name` on each value.

```json
{
  "channelId": "66d66f0c-0ca2-4c79-96b9-d182d5a481b4",
  "to": "919999999999",
  "previewText": "Asha, order ORD-1001 is confirmed",
  "template": {
    "name": "named_order_confirmation",
    "language": { "code": "en_US" },
    "components": [
      {
        "type": "body",
        "parameters": [
          {
            "type": "text",
            "parameter_name": "customer_name",
            "text": "Asha"
          },
          {
            "type": "text",
            "parameter_name": "order_number",
            "text": "ORD-1001"
          }
        ]
      }
    ]
  }
}
```

Do not mix named and positional parameters in one component. Use the parameter style with which the template was approved.

### Text header

Use a `header` component when the approved header contains a text variable.

```json
{
  "channelId": "66d66f0c-0ca2-4c79-96b9-d182d5a481b4",
  "to": "919999999999",
  "previewText": "Order ORD-1001",
  "template": {
    "name": "order_with_text_header",
    "language": { "code": "en_US" },
    "components": [
      {
        "type": "header",
        "parameters": [
          { "type": "text", "text": "ORD-1001" }
        ]
      },
      {
        "type": "body",
        "parameters": [
          { "type": "text", "text": "Asha" }
        ]
      }
    ]
  }
}
```

### Image header

```json
{
  "channelId": "66d66f0c-0ca2-4c79-96b9-d182d5a481b4",
  "to": "919999999999",
  "previewText": "Your product is ready",
  "template": {
    "name": "product_ready_image",
    "language": { "code": "en_US" },
    "components": [
      {
        "type": "header",
        "parameters": [
          {
            "type": "image",
            "image": {
              "link": "https://cdn.example.com/products/item-1001.jpg"
            }
          }
        ]
      }
    ]
  }
}
```

### Video header

```json
{
  "channelId": "66d66f0c-0ca2-4c79-96b9-d182d5a481b4",
  "to": "919999999999",
  "previewText": "Watch your installation guide",
  "template": {
    "name": "installation_video",
    "language": { "code": "en_US" },
    "components": [
      {
        "type": "header",
        "parameters": [
          {
            "type": "video",
            "video": {
              "id": "META_MEDIA_ID"
            }
          }
        ]
      }
    ]
  }
}
```

### Document header

```json
{
  "channelId": "66d66f0c-0ca2-4c79-96b9-d182d5a481b4",
  "to": "919999999999",
  "previewText": "Invoice INV-1001",
  "template": {
    "name": "invoice_document",
    "language": { "code": "en_US" },
    "components": [
      {
        "type": "header",
        "parameters": [
          {
            "type": "document",
            "document": {
              "link": "https://cdn.example.com/invoices/INV-1001.pdf",
              "filename": "INV-1001.pdf"
            }
          }
        ]
      }
    ]
  }
}
```

Use exactly one media source: either a Meta media `id` or a publicly reachable HTTPS `link`. Media type and format must match the approved header. For linked media, keep the URL available long enough for Meta to fetch it.

### Currency and date/time values

Use Meta's native typed parameters when the approved body expects currency or date/time.

```json
{
  "channelId": "66d66f0c-0ca2-4c79-96b9-d182d5a481b4",
  "to": "919999999999",
  "previewText": "Payment of INR 1,499.00 is due 31 October 2026",
  "template": {
    "name": "payment_due",
    "language": { "code": "en_US" },
    "components": [
      {
        "type": "body",
        "parameters": [
          {
            "type": "currency",
            "currency": {
              "fallback_value": "INR 1,499.00",
              "code": "INR",
              "amount_1000": 1499000
            }
          },
          {
            "type": "date_time",
            "date_time": {
              "fallback_value": "31 October 2026"
            }
          }
        ]
      }
    ]
  }
}
```

`amount_1000` is the amount multiplied by 1,000. Always supply a readable `fallback_value`; Meta may render fallback text depending on client support and template behavior.

### Static call-to-action button

If a phone number or website URL is fully static in the approved template, **do not** include a `button` component in the send request. Meta renders the approved button automatically.

```json
{
  "channelId": "66d66f0c-0ca2-4c79-96b9-d182d5a481b4",
  "to": "919999999999",
  "previewText": "Visit our support page",
  "template": {
    "name": "support_with_static_website_button",
    "language": { "code": "en_US" }
  }
}
```

### Dynamic URL button

For a URL ending in an approved variable, send only the variable value. `index` is a string and is zero-based.

```json
{
  "channelId": "66d66f0c-0ca2-4c79-96b9-d182d5a481b4",
  "to": "919999999999",
  "previewText": "Track order ORD-1001",
  "template": {
    "name": "track_order",
    "language": { "code": "en_US" },
    "components": [
      {
        "type": "button",
        "sub_type": "url",
        "index": "0",
        "parameters": [
          { "type": "text", "text": "ORD-1001" }
        ]
      }
    ]
  }
}
```

If the approved URL is `https://example.com/orders/{{1}}`, the final URL becomes `https://example.com/orders/ORD-1001`. Do not send the complete URL as the parameter unless that is how the approved template is defined.

### Quick-reply button

```json
{
  "channelId": "66d66f0c-0ca2-4c79-96b9-d182d5a481b4",
  "to": "919999999999",
  "previewText": "Please confirm order ORD-1001",
  "template": {
    "name": "confirm_order",
    "language": { "code": "en_US" },
    "components": [
      {
        "type": "button",
        "sub_type": "quick_reply",
        "index": "0",
        "parameters": [
          {
            "type": "payload",
            "payload": "CONFIRM_ORDER_1001"
          }
        ]
      }
    ]
  }
}
```

The payload is returned with the customer's button response and can be used by your automation. Give each button the index and parameter type expected by the approved template.

### Copy-code and authentication templates

A copy-code button commonly uses a coupon code parameter:

```json
{
  "channelId": "66d66f0c-0ca2-4c79-96b9-d182d5a481b4",
  "to": "919999999999",
  "previewText": "Use code SAVE20",
  "template": {
    "name": "coupon_offer",
    "language": { "code": "en_US" },
    "components": [
      {
        "type": "button",
        "sub_type": "copy_code",
        "index": "0",
        "parameters": [
          {
            "type": "coupon_code",
            "coupon_code": "SAVE20"
          }
        ]
      }
    ]
  }
}
```

Authentication templates can contain a one-time password, a copy-code button, and/or an autofill or zero-tap URL button. Their exact send-time component structure depends on the authentication template Meta approved. Pass the exact Meta-native components required for that template; never reuse an OTP as a `clientReference` or log value.

### Advanced components: pass-through

Helixcer accepts supported Meta-native `template.components` without converting them to a Helixcer-specific format. This lets the API follow Meta's evolving component shapes for catalog/product templates, Flows, carousel/card templates, limited-time offers, and authentication experiences.

```json
{
  "channelId": "66d66f0c-0ca2-4c79-96b9-d182d5a481b4",
  "to": "919999999999",
  "previewText": "Browse products selected for you",
  "template": {
    "name": "recommended_products",
    "language": { "code": "en_US" },
    "components": [
      {
        "type": "body",
        "parameters": [
          { "type": "text", "text": "Asha" }
        ]
      },
      {
        "type": "button",
        "sub_type": "catalog",
        "index": "0",
        "parameters": []
      }
    ]
  }
}
```

The example above illustrates pass-through, not a universal schema. Copy the component structure, parameter types, indexes, and values required by the approved template and the current Meta Cloud API. Helixcer validates the outer API envelope and security boundary; Meta remains the authority on whether the template payload matches the approved template and account capabilities.

## Accepted response

### `202 Accepted` — stored for asynchronous delivery

Helixcer records the message and queues provider delivery before responding. The first `messageStatus` value is normally `pending`; submission to Meta happens asynchronously after the response.

`status` reports whether the API request succeeded. `messageStatus` reports the message's delivery state.

```json
{
  "status": true,
  "messageId": "594798db-1c00-481f-adab-137d1c80b2d8",
  "conversationId": "9e9411e9-c1a7-4a66-a46f-e6e31d9577da",
  "contactId": "af4d6756-e658-4b5f-8593-f1daef0998b7",
  "channelId": "66d66f0c-0ca2-4c79-96b9-d182d5a481b4",
  "messageStatus": "pending",
  "channelMessageId": "",
  "error": "",
  "clientReference": "order-1001",
  "createdAt": "2026-10-25T10:30:12.442Z",
  "statusUrl": "https://api.chat.helixcer.com/api/v1/messages/594798db-1c00-481f-adab-137d1c80b2d8",
  "requestId": "96fe6806-a769-451e-918a-034b33d06dc1"
}
```

`202` means recorded and queued, not delivered. Use the status endpoint or the Helixcer inbox for the final outcome.

## Errors

Errors use a stable machine-readable code plus a human-readable message:

```json
{
  "status": false,
  "error": {
    "code": "channel_not_ready",
    "message": "The WhatsApp channel is missing its access token.",
    "requestId": "96fe6806-a769-451e-918a-034b33d06dc1"
  }
}
```

| HTTP status | Meaning | What to do |
|---:|---|---|
| `400` | Malformed JSON, missing or unknown field, or invalid parameter. | Correct the request; do not retry unchanged. |
| `401` | Missing, invalid, expired, or revoked API key. | Replace the key. Do not log it. |
| `403` | Browser-origin request or key lacks the required scope. | Send server-to-server and check key permissions. |
| `404` | Channel, message, or route was not found for this key. | Check the identifier and confirm the channel belongs to the key's workspace. |
| `409` | The selected channel is not ready to send. | Read `error.code` and fix the channel setup. |
| `429` | Rate limit exceeded. | Wait for `Retry-After` before trying again. |
| `5xx` | Temporary Helixcer, rate-limiter, or upstream failure. | Wait, then retry with exponential backoff. |

Do not parse `error.message` to drive application logic; use `error.code`. Include `error.requestId` or the matching `X-Request-Id` header when contacting support.

## Read message status

```http
GET https://api.chat.helixcer.com/api/v1/messages/594798db-1c00-481f-adab-137d1c80b2d8
Authorization: Bearer hxc_live_REPLACE_WITH_YOUR_KEY
```

```json
{
  "status": true,
  "messageId": "594798db-1c00-481f-adab-137d1c80b2d8",
  "conversationId": "9e9411e9-c1a7-4a66-a46f-e6e31d9577da",
  "contactId": "af4d6756-e658-4b5f-8593-f1daef0998b7",
  "channelId": "66d66f0c-0ca2-4c79-96b9-d182d5a481b4",
  "messageStatus": "delivered",
  "channelMessageId": "wamid.HBgMOTE5OTk5OTk5OTk5FQIAERgS...",
  "error": "",
  "clientReference": "order-1001",
  "createdAt": "2026-10-25T10:30:12.442Z",
  "statusUrl": "https://api.chat.helixcer.com/api/v1/messages/594798db-1c00-481f-adab-137d1c80b2d8",
  "requestId": "f2baa47a-97e6-47c8-a200-7a235cad5d92"
}
```

Typical `messageStatus` progression is:

`pending` → `retrying` → `submitted` → `sent` → `delivered` → `read`

A message can move to `failed` instead. Status progression is not guaranteed to be synchronous, and some recipients or devices may not produce every intermediate status.

## Chatbox and webhooks

Helixcer records the outbound message in the chatbox before or as it submits the message to Meta. It resolves the contact by WhatsApp identity, creates an open conversation when necessary, and associates the record with `channelId`, `clientReference`, and Meta's message ID.

Meta sends asynchronous status webhooks to the connected Helixcer channel. Helixcer uses them to update the same chatbox record to `sent`, `delivered`, `read`, or `failed`. Replies received on WhatsApp are attached to the same contact and conversation, so agents see the complete thread even when the original template was initiated by an external application.

Poll the status endpoint for machine-to-machine updates today. When Helixcer outbound status webhooks are enabled, consumers should:

- verify the Helixcer webhook signature;
- acknowledge quickly with a `2xx` response;
- deduplicate events by event ID;
- expect retries and out-of-order status events;
- deduplicate repeated events; and
- fetch the message with `GET /api/v1/messages/{messageId}` when reconciliation is needed.

The exact outbound webhook management and signature contract will be documented when that feature is enabled. Until then, poll the status endpoint or use the chatbox.

## Meta compatibility

Helixcer deliberately keeps `template` close to Meta's Cloud API template object. Meta controls approved template names, languages, component schemas, parameter types, limits, and availability by account and region. If Meta adds or changes an advanced component, use the current Meta-native structure inside `template` and confirm it is approved for the selected channel.

Official references:

- [WhatsApp Cloud API official Postman collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api)
- [Meta's interactive template request example](https://www.postman.com/meta/whatsapp-business-platform/request/lwtlz1k/send-message-template-interactive)
- [Meta WhatsApp API examples on GitHub](https://github.com/fbsamples/whatsapp-api-examples)
- [Meta's document-header message helper](https://github.com/fbsamples/whatsapp-api-examples/blob/main/send-messages-flight-app-python/message_helper.py)
- [Meta catalog template request](https://www.postman.com/meta/whatsapp-business-platform/request/cn89g66/send-catalog-template-message)
- [Meta Flow template request](https://www.postman.com/meta/whatsapp-business-platform/request/cgamr2u/send-flow-template-message)

## Production checklist

- The WhatsApp channel is enabled and belongs to the API key's workspace.
- The template name, locale, components, button indexes, and parameters exactly match Meta's approved template.
- Recipient numbers use international digits-only format.
- The API key is stored only on your server.
- Your application treats `202` as recorded and queued, not delivered.
- Retries use exponential backoff.
- Your logs exclude keys, OTPs, customer message content, and sensitive personal data.
- Status processing safely handles duplicate provider events and can reconcile through the GET endpoint.
