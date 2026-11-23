import test from 'node:test';
import assert from 'node:assert/strict';

import gateway from './public/_worker.js';

test('gateway forwards the original request through the Worker service binding', async () => {
  const request = new Request('https://api.chat.helixcer.com/health', {
    headers: { Origin: 'https://chat.helixcer.com' }
  });
  let forwarded;
  const response = await gateway.fetch(request, {
    API: {
      async fetch(value) {
        forwarded = value;
        return new Response('ok', { status: 200, headers: { 'X-Gateway-Test': 'passed' } });
      }
    }
  });

  assert.equal(forwarded, request);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Gateway-Test'), 'passed');
  assert.equal(await response.text(), 'ok');
});

test('gateway routes public downloads through the downloads service binding', async () => {
  const request = new Request(
    'https://api.chat.helixcer.com/downloads/integrations/tallyprime/Helixcer-TallyPrime-Connector.zip'
  );
  let forwarded;
  let apiCalled = false;
  const response = await gateway.fetch(request, {
    API: {
      async fetch() {
        apiCalled = true;
        return new Response('api', { status: 500 });
      }
    },
    DOWNLOADS: {
      async fetch(value) {
        forwarded = value;
        return new Response('zip', {
          status: 200,
          headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="Helixcer-TallyPrime-Connector.zip"' }
        });
      }
    }
  });

  assert.equal(apiCalled, false);
  assert.equal(forwarded, request);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'zip');
});

test('gateway fails closed when the service binding is missing', async () => {
  const response = await gateway.fetch(new Request('https://api.chat.helixcer.com/health'), {});
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), {
    ok: false,
    error: 'API service binding is unavailable.'
  });
});

test('gateway fails closed when the downloads binding is missing', async () => {
  const response = await gateway.fetch(
    new Request('https://api.chat.helixcer.com/downloads/integrations/tallyprime/Helixcer-TallyPrime-Connector.zip'),
    {
      API: {
        async fetch() {
          return new Response('should-not-run', { status: 500 });
        }
      }
    }
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: 'Downloads are unavailable.'
  });
});
