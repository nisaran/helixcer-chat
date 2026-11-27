import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadVoucherMediaForWorkspace,
  parseVoucherMediaDownloadUrl,
  uploadVoucherMedia
} from '../src/voucher-media.js';

function apiError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function memoryBucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, options = {}) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(await new Response(value).arrayBuffer());
      objects.set(key, { bytes, httpMetadata: options.httpMetadata || {} });
    },
    async get(key) {
      const item = objects.get(key);
      if (!item) return null;
      return {
        body: item.bytes,
        size: item.bytes.byteLength
      };
    }
  };
}

test('parseVoucherMediaDownloadUrl accepts Helixcer voucher download links', () => {
  const key = 'ws_client/11111111-2222-3333-4444-555555555555.pdf';
  const url = `https://api.chat.helixcer.com/api/v1/voucher-media/download?key=${encodeURIComponent(key)}&expires=1893456000&signature=${'A'.repeat(43)}=`;
  assert.deepEqual(parseVoucherMediaDownloadUrl(url), {
    objectKey: key,
    expires: '1893456000',
    signature: `${'A'.repeat(43)}=`
  });
  assert.equal(parseVoucherMediaDownloadUrl('https://cdn.example.com/invoice.pdf'), null);
});

test('authenticated inbox preview loads voucher PDFs from R2 without self-fetch', async () => {
  const bucket = memoryBucket();
  const env = {
    TALLYPRIME_MEDIA: bucket,
    VOUCHER_MEDIA_SIGNING_KEY: 'test-voucher-signing-key-material-123456'
  };
  const uploaded = await uploadVoucherMedia(
    new Request('https://api.chat.helixcer.com/api/v1/voucher-media?filename=Invoice_INV2627S060.pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: '%PDF-1.7\ninvoice-bytes'
    }),
    env,
    new URL('https://api.chat.helixcer.com/api/v1/voucher-media?filename=Invoice_INV2627S060.pdf'),
    'ws_client',
    apiError
  );
  assert.match(uploaded.downloadUrl, /\/api\/v1\/voucher-media\/download\?/);
  assert.equal(uploaded.filename, 'Invoice_INV2627S060.pdf');

  const response = await loadVoucherMediaForWorkspace(env, 'ws_client', uploaded.downloadUrl);
  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/pdf');
  assert.match(await response.text(), /^%PDF-1.7/);

  assert.equal(await loadVoucherMediaForWorkspace(env, 'other-workspace', uploaded.downloadUrl), null);
});
