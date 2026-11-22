import assert from 'node:assert/strict';
import test from 'node:test';
import { handleRequest } from '../src/index.js';

const OBJECT_KEY = 'integrations/tallyprime/Helixcer-TallyPrime-Connector.zip';
const DOWNLOAD_URL = `https://api.chat.helixcer.com/downloads/${OBJECT_KEY}`;

function mockDownloadsBucket({ missing = false } = {}) {
  const payload = new TextEncoder().encode('zip-bytes');
  const object = {
    body: payload,
    size: payload.byteLength,
    httpEtag: '"etag-downloads-1"',
    writeHttpMetadata(headers) {
      headers.set('Content-Type', 'application/zip');
    }
  };
  return {
    async get(key) {
      assert.equal(key, OBJECT_KEY);
      return missing ? null : object;
    },
    async head(key) {
      assert.equal(key, OBJECT_KEY);
      if (missing) return null;
      const { body, ...meta } = object;
      return meta;
    }
  };
}

test('public downloads are served from the Helixcer API domain', async () => {
  const env = { PUBLIC_DOWNLOADS: mockDownloadsBucket(), ALLOWED_ORIGINS: '' };
  const response = await handleRequest(new Request(DOWNLOAD_URL), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/zip');
  assert.match(response.headers.get('Content-Disposition') || '', /Helixcer-TallyPrime-Connector\.zip/);
  assert.equal(await response.text(), 'zip-bytes');

  const head = await handleRequest(new Request(DOWNLOAD_URL, { method: 'HEAD' }), env);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Length'), '9');
  assert.equal(await head.text(), '');
});

test('public downloads reject path traversal and missing objects', async () => {
  const env = { PUBLIC_DOWNLOADS: mockDownloadsBucket({ missing: true }), ALLOWED_ORIGINS: '' };
  const missing = await handleRequest(new Request(DOWNLOAD_URL), env);
  assert.equal(missing.status, 404);

  const traversal = await handleRequest(new Request('https://api.chat.helixcer.com/downloads/../wrangler.toml'), env);
  assert.equal(traversal.status, 404);
});
