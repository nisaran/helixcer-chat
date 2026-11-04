import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
const start = source.indexOf('async function streamMessageAttachment(');
const end = source.indexOf('function isMetaMediaHost(', start);
function setup(direction, html = false) {
  const attachment = { type: 'image', filename: 'image.jpg', mimeType: direction === 'outbound' ? 'image/jpeg' : '', externalUrl: 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=test' };
  const row = { message_type: 'image', payload_json: JSON.stringify({ attachment }), channel_id: 'instagram', connector_type: 'generic_http', provider_type: 'instagram', config_json: '{}', workspace_id: 'ws' };
  let forwarded;
  const context = vm.createContext({ Response, Request, URL, Headers,
    safeJsonParse: (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } },
    logicalConnectorType: value => value.provider_type || value.connector_type,
    safeStoredExternalMediaUrl: value => value,
    safeAttachmentFilename: value => value,
    safeInlineAttachmentMime: (type, stored, received) => received === 'image/jpeg' ? received : '',
    assertPrincipalChannelAccess() {},
    responseFromAttachmentPreviewBase64: () => null,
    httpError: (status, message) => Object.assign(new Error(message), { status }),
    fetch: async (url, options) => { forwarded = options.headers; return new Response(html ? '<html>Update Your Browser</html>' : new Uint8Array([255,216,255,217]), { headers: { 'Content-Type': html ? 'text/html' : 'image/jpeg' } }); },
  });
  vm.runInContext(source.slice(start, end), context);
  context.env = { DB: { prepare: () => ({ bind: () => ({ first: async () => row }) }) } };
  context.request = new Request('https://api.chat.helixcer.com/api/messages/test/attachment', { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/130.0.0.0', Cookie: 'private-session', Authorization: 'private-token' } });
  context.url = new URL(context.request.url);
  return { context, forwarded: () => forwarded };
}
for (const direction of ['inbound', 'outbound']) {
  test('Instagram ' + direction + ' preview forwards browser identity without session credentials', async () => {
    const h = setup(direction);
    const response = await vm.runInContext("streamMessageAttachment(env, 'ws', 'test', request, url)", h.context);
    assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
    assert.match(response.headers.get('Content-Disposition'), /^inline;/);
    assert.equal(h.forwarded()['User-Agent'], 'Mozilla/5.0 Chrome/130.0.0.0');
    assert.equal(h.forwarded().Cookie, undefined);
    assert.equal(h.forwarded().Authorization, undefined);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [255,216,255,217]);
  });
}
test('Meta HTML interstitial is rejected even when the stored attachment says image/jpeg', async () => {
  const h = setup('outbound', true);
  await assert.rejects(vm.runInContext("streamMessageAttachment(env, 'ws', 'test', request, url)", h.context), error => error.status === 502 && /web page/.test(error.message));
});
