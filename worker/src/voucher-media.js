export const voucherMediaPath = '/api/v1/voucher-media';

const downloadPath = voucherMediaPath + '/download';
const maxPdfBytes = 10 * 1024 * 1024;
const linkLifetimeSeconds = 24 * 60 * 60;
const encoder = new TextEncoder();

async function signingKey(env) {
  if (!env.TALLYPRIME_MEDIA || !env.VOUCHER_MEDIA_SIGNING_KEY) {
    throw Object.assign(new Error('Voucher media storage is not configured.'), { status: 503 });
  }
  return crypto.subtle.importKey('raw', encoder.encode(env.VOUCHER_MEDIA_SIGNING_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function uploadVoucherMedia(request, env, url, workspaceId, apiError) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/pdf' || !request.body) {
    throw apiError(415, 'pdf_required', 'Send one PDF as application/pdf.');
  }
  const filename = (url.searchParams.get('filename') || 'voucher.pdf').trim();
  if (!/^[^/\\\u0000-\u001f\u007f]{1,180}\.pdf$/i.test(filename)) {
    throw apiError(400, 'invalid_filename', 'Provide a valid PDF filename.');
  }
  const key = await signingKey(env);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxPdfBytes) {
        await reader.cancel();
        throw apiError(413, 'pdf_too_large', 'The PDF must be 10 MiB or smaller.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const pdf = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    pdf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (!encoder.encode('%PDF-').every((byte, index) => pdf[index] === byte)) {
    throw apiError(415, 'invalid_pdf', 'The file does not have a PDF header.');
  }
  const objectKey = encodeURIComponent(workspaceId) + '/' + crypto.randomUUID() + '.pdf';
  await env.TALLYPRIME_MEDIA.put(objectKey, pdf, { httpMetadata: { contentType: 'application/pdf' } });

  const expires = Math.floor(Date.now() / 1000) + linkLifetimeSeconds;
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(expires + '\n' + objectKey)));
  const downloadUrl = new URL(downloadPath, url.origin);
  downloadUrl.search = new URLSearchParams({ key: objectKey, expires, signature: btoa(String.fromCharCode(...bytes)) });
  return { filename, downloadUrl: downloadUrl.href, expiresAt: new Date(expires * 1000).toISOString() };
}

export async function downloadVoucherMedia(env, url) {
  const objectKey = url.searchParams.get('key') || '';
  const expires = url.searchParams.get('expires') || '';
  const signature = url.searchParams.get('signature') || '';
  if (!/^(?:TallyPrime\/)?[A-Za-z0-9_%!.~*'()-]+\/[a-f0-9-]{36}\.pdf$/.test(objectKey) ||
      !/^\d{10}$/.test(expires) || Number(expires) <= Date.now() / 1000 ||
      !/^[A-Za-z0-9+/]{43}=$/.test(signature)) {
    return new Response(null, { status: 404 });
  }
  const key = await signingKey(env);
  const valid = await crypto.subtle.verify('HMAC', key, Uint8Array.from(atob(signature), char => char.charCodeAt(0)),
    encoder.encode(expires + '\n' + objectKey));
  if (!valid) return new Response(null, { status: 404 });
  const object = await env.TALLYPRIME_MEDIA.get(objectKey);
  if (!object) return new Response(null, { status: 404 });
  return new Response(object.body, { headers: {
    'Content-Type': 'application/pdf',
    'Content-Length': String(object.size),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff'
  } });
}
