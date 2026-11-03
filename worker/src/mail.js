/**
 * Transactional email helper for password-reset links.
 *
 * Prefer Resend when RESEND_API_KEY is set (works without Cloudflare DNS).
 * Falls back to Cloudflare Email Service binding env.EMAIL when present.
 */

export async function sendTransactionalEmail(env, { to, subject, text, html }) {
  const recipient = String(to || '').trim();
  if (!recipient || !recipient.includes('@')) {
    throw new Error('A valid recipient email is required.');
  }
  const from = String(env.EMAIL_FROM || 'Helixcer Chat <noreply@helixcer.com>').trim();
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
        subject: String(subject || ''),
        text: String(text || ''),
        html: String(html || text || '')
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
      subject: String(subject || ''),
      text: String(text || ''),
      html: String(html || text || '')
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}
