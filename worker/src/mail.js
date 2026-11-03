/**
 * Transactional email helper for password-reset links.
 *
 * Preference order:
 * 1. SMTP (SMTP_USER + SMTP_PASSWORD) — Google Workspace / Gmail app password
 * 2. Resend (RESEND_API_KEY)
 * 3. Cloudflare Email Service binding (env.EMAIL)
 */

export async function sendTransactionalEmail(env, { to, subject, text, html }) {
  const recipient = String(to || '').trim();
  if (!recipient || !recipient.includes('@')) {
    throw new Error('A valid recipient email is required.');
  }
  const from = String(env.EMAIL_FROM || 'Helixcer Chat <noreply@helixcer.com>').trim();
  const subjectText = String(subject || '');
  const textBody = String(text || '');
  const htmlBody = String(html || text || '');

  if (env.SMTP_USER && env.SMTP_PASSWORD) {
    await sendSmtpEmail(env, {
      from,
      to: recipient,
      subject: subjectText,
      text: textBody,
      html: htmlBody
    });
    return { provider: 'smtp' };
  }

  if (env.RESEND_API_KEY) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: [recipient],
        subject: subjectText,
        text: textBody,
        html: htmlBody
      })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Resend email failed (${response.status}): ${detail.slice(0, 300)}`);
    }
    return { provider: 'resend' };
  }

  if (env.EMAIL && typeof env.EMAIL.send === 'function') {
    await env.EMAIL.send({
      from,
      to: recipient,
      subject: subjectText,
      text: textBody,
      html: htmlBody
    });
    return { provider: 'cloudflare_email' };
  }

  const error = new Error('Transactional email is not configured.');
  error.code = 'email_not_configured';
  throw error;
}

export function passwordResetEmailContent(resetUrl) {
  const subject = 'Reset your Helixcer Chat password';
  const text = [
    'Use this link to set or reset your Helixcer Chat password:',
    resetUrl,
    '',
    'This link expires in one hour. If you did not request it, you can ignore this email.'
  ].join('\n');
  const html = `<!doctype html><html><body style="font:16px/1.5 system-ui,sans-serif;color:#172321">
<p>Use this link to set or reset your Helixcer Chat password:</p>
<p><a href="${escapeHtml(resetUrl)}">${escapeHtml(resetUrl)}</a></p>
<p style="color:#596561">This link expires in one hour. If you did not request it, you can ignore this email.</p>
</body></html>`;
  return { subject, text, html };
}

async function sendSmtpEmail(env, { from, to, subject, text, html }) {
  const host = String(env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = Number.parseInt(String(env.SMTP_PORT || '465'), 10) || 465;
  const username = String(env.SMTP_USER || '').trim();
  const password = String(env.SMTP_PASSWORD || '');
  if (!host || !username || !password) {
    throw new Error('SMTP_HOST, SMTP_USER, and SMTP_PASSWORD are required for SMTP delivery.');
  }
  if (port === 25) {
    throw new Error('SMTP port 25 is blocked on Cloudflare Workers. Use 465 or 587.');
  }

  const { connect } = await import('cloudflare:sockets');
  const useStartTls = port !== 465;
  let socket = connect(
    { hostname: host, port },
    { secureTransport: useStartTls ? 'starttls' : 'on' }
  );
  await socket.opened;

  const session = createSmtpSession(socket);
  const ehloHost = extractEmailAddress(from).split('@')[1] || 'helixcer.com';
  try {
    await session.expect(220);
    await session.command(`EHLO ${ehloHost}`, 250);

    if (useStartTls) {
      await session.command('STARTTLS', 220);
      await session.release();
      socket = socket.startTls();
      await socket.opened;
      session.attach(socket);
      await session.command(`EHLO ${ehloHost}`, 250);
    }

    await session.command('AUTH LOGIN', 334);
    await session.command(btoa(username), 334);
    await session.command(btoa(password), 235);

    const fromAddress = extractEmailAddress(from);
    await session.command(`MAIL FROM:<${fromAddress}>`, 250);
    await session.command(`RCPT TO:<${to}>`, 250);
    await session.command('DATA', 354);
    const message = buildMimeMessage({ from, to, subject, text, html });
    await session.writeLine(`${dotStuff(message)}\r\n.`);
    await session.expect(250);
    await session.writeLine('QUIT');
  } finally {
    await session.close();
  }
}

function createSmtpSession(initialSocket) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let socket = initialSocket;
  let reader = socket.readable.getReader();
  let writer = socket.writable.getWriter();
  let buffer = '';

  const attach = (nextSocket) => {
    socket = nextSocket;
    reader = socket.readable.getReader();
    writer = socket.writable.getWriter();
    buffer = '';
  };

  const release = async () => {
    try { reader.releaseLock(); } catch { /* ignore */ }
    try { writer.releaseLock(); } catch { /* ignore */ }
  };

  const readReply = async () => {
    for (;;) {
      const chunks = buffer.split('\r\n');
      if (chunks.length > 1) {
        const complete = chunks.slice(0, -1);
        const last = complete[complete.length - 1] || '';
        if (/^\d{3} /.test(last)) {
          buffer = chunks[chunks.length - 1] || '';
          return complete.join('\r\n');
        }
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('SMTP connection closed unexpectedly.');
      buffer += decoder.decode(value, { stream: true });
    }
  };

  const expect = async (code) => {
    const reply = await readReply();
    const firstLine = reply.split('\r\n')[0] || '';
    if (!firstLine.startsWith(String(code))) {
      throw new Error(`SMTP unexpected reply (wanted ${code}): ${reply.slice(0, 200)}`);
    }
    return reply;
  };

  const writeLine = async (line) => {
    await writer.write(encoder.encode(`${line}\r\n`));
  };

  const command = async (line, code) => {
    await writeLine(line);
    return expect(code);
  };

  const close = async () => {
    try { reader.releaseLock(); } catch { /* ignore */ }
    try { await writer.close(); } catch { /* ignore */ }
    try { await socket.close?.(); } catch { /* ignore */ }
  };

  return { attach, release, expect, writeLine, command, close };
}

export function buildMimeMessage({ from, to, subject, text, html }) {
  const boundary = `helixcer_${crypto.randomUUID().replace(/-/g, '')}`;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    'Content-Transfer-Encoding: 7bit'
  ];
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    normalizeNewlines(text || ''),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    normalizeNewlines(html || text || ''),
    `--${boundary}--`,
    ''
  ];
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
}

export function extractEmailAddress(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim();
}

function encodeHeader(value) {
  const text = String(value || '').replace(/[\r\n]+/g, ' ').trim();
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(text)))}?=`;
}

function normalizeNewlines(value) {
  return String(value || '').replace(/\r?\n/g, '\r\n');
}

function dotStuff(value) {
  return normalizeNewlines(value).replace(/^\./gm, '..');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}
