import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');

function extract(name, next) {
  const start = source.indexOf(name);
  const end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start, `Could not extract ${name}`);
  return source.slice(start, end);
}

function makeContext(overrides = {}) {
  const context = vm.createContext({
    Response,
    Request,
    URL,
    Headers,
    TextDecoder,
    MAX_ATTACHMENT_BYTES: 16 * 1024 * 1024,
    safeJsonParse: (value, fallback) => {
      try { return JSON.parse(value); } catch { return fallback; }
    },
    logicalConnectorType: (value) => value.provider_type || value.connector_type,
    safeStoredExternalMediaUrl: (value) => {
      try {
        const url = new URL(String(value || ''));
        return url.protocol === 'https:' ? url.toString() : '';
      } catch { return ''; }
    },
    safeAttachmentFilename: (value) => String(value || 'attachment'),
    assertPrincipalChannelAccess() {},
    responseFromAttachmentPreviewBase64: () => null,
    attachmentPreviewCacheRequest: () => new Request('https://cache.local/preview'),
    metaApiVersion: () => 'v26.0',
    providerError: () => 'unavailable',
    readChannelCredentials: async () => ({ accessToken: '' }),
    loadVoucherMediaForWorkspace: async () => null,
    httpError: (status, message) => Object.assign(new Error(message), { status }),
    caches: { default: { match: async () => null } },
    ...overrides
  });
  vm.runInContext(
    extract('function safeInlineAttachmentMime(', 'function safeAttachmentFilename(')
    + extract('function messageAttachmentView(', 'function safeStoredExternalMediaUrl(')
    + extract('async function streamMessageAttachment(', 'function safeInlineAttachmentMime('),
    context
  );
  return context;
}

test('template document attachments with public links use the Helixcer proxy URL', () => {
  const context = makeContext();
  const view = vm.runInContext(`messageAttachmentView('template', { attachment: {
    type: 'document',
    filename: 'Invoice_INV2627S060.pdf',
    mimeType: '',
    size: 0,
    caption: '',
    externalUrl: 'https://cdn.example.com/Invoice_INV2627S060.pdf'
  }}, 'msg-invoice')`, context);
  assert.equal(view.available, true);
  assert.equal(view.external, false);
  assert.equal(view.url, '/api/messages/msg-invoice/attachment');
});

test('WhatsApp template documents without media ids are fetched server-side for preview', async () => {
  let fetched;
  const context = makeContext({
    fetch: async (url, options) => {
      fetched = { url: String(url), options };
      return new Response('%PDF-1.7\ninvoice', {
        headers: { 'Content-Type': 'application/pdf', 'Content-Length': '18' }
      });
    }
  });
  context.env = {
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => ({
            message_id: 'msg-invoice',
            message_type: 'template',
            payload_json: JSON.stringify({
              attachment: {
                type: 'document',
                filename: 'Invoice_INV2627S060.pdf',
                mimeType: '',
                externalUrl: 'https://cdn.example.com/Invoice_INV2627S060.pdf'
              }
            }),
            channel_id: 'wa',
            connector_type: 'whatsapp_cloud',
            provider_type: 'whatsapp_cloud',
            config_json: '{}',
            secret_key: 'secret',
            workspace_id: 'ws'
          })
        })
      })
    }
  };
  const request = new Request('https://api.chat.helixcer.com/api/messages/msg-invoice/attachment', {
    headers: { 'User-Agent': 'Mozilla/5.0 HelixcerTest' }
  });
  context.request = request;
  context.url = new URL(request.url);
  const response = await vm.runInContext(
    "streamMessageAttachment(env, 'ws', 'msg-invoice', request, url)",
    context
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/pdf');
  assert.match(response.headers.get('Content-Disposition'), /^inline;/);
  assert.equal(fetched.url, 'https://cdn.example.com/Invoice_INV2627S060.pdf');
  assert.equal(fetched.options.headers['User-Agent'], 'Mozilla/5.0 HelixcerTest');
  assert.equal(fetched.options.headers.Authorization, undefined);
  assert.match(await response.text(), /^%PDF-1.7/);
});

test('WhatsApp voucher-media invoice links are served from R2 instead of Worker self-fetch', async () => {
  const voucherUrl = 'https://api.chat.helixcer.com/api/v1/voucher-media/download?key=ws%2F11111111-2222-3333-4444-555555555555.pdf&expires=1&signature=x';
  let httpFetches = 0;
  const context = makeContext({
    fetch: async () => {
      httpFetches += 1;
      return new Response('should-not-run', { status: 500 });
    },
    loadVoucherMediaForWorkspace: async (_env, workspaceId, value) => {
      assert.equal(workspaceId, 'ws');
      assert.equal(value, voucherUrl);
      return new Response('%PDF-1.7\nvoucher', {
        status: 200,
        headers: { 'Content-Type': 'application/pdf', 'Content-Length': '16' }
      });
    }
  });
  context.env = {
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => ({
            message_id: 'msg-voucher',
            message_type: 'template',
            payload_json: JSON.stringify({
              attachment: {
                type: 'document',
                filename: 'Invoice_INV2627S060.pdf',
                mimeType: 'application/pdf',
                externalUrl: voucherUrl
              }
            }),
            channel_id: 'wa',
            connector_type: 'whatsapp_cloud',
            provider_type: 'whatsapp_cloud',
            config_json: '{}',
            secret_key: 'secret',
            workspace_id: 'ws'
          })
        })
      })
    }
  };
  const request = new Request('https://api.chat.helixcer.com/api/messages/msg-voucher/attachment');
  context.request = request;
  context.url = new URL(request.url);
  const response = await vm.runInContext(
    "streamMessageAttachment(env, 'ws', 'msg-voucher', request, url)",
    context
  );
  assert.equal(response.status, 200);
  assert.equal(httpFetches, 0);
  assert.equal(response.headers.get('Content-Type'), 'application/pdf');
  assert.match(await response.text(), /^%PDF-1.7\nvoucher/);
});
