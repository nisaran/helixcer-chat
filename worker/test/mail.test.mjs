import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMimeMessage, extractEmailAddress, passwordResetEmailContent } from '../src/mail.js';

test('extractEmailAddress supports bare and named From values', () => {
  assert.equal(extractEmailAddress('noreply@helixcer.com'), 'noreply@helixcer.com');
  assert.equal(extractEmailAddress('Helixcer Chat <noreply@helixcer.com>'), 'noreply@helixcer.com');
});

test('buildMimeMessage includes text and html parts', () => {
  const message = buildMimeMessage({
    from: 'Helixcer Chat <noreply@helixcer.com>',
    to: 'owner@example.com',
    subject: 'Reset your Helixcer Chat password',
    text: 'plain body',
    html: '<p>html body</p>'
  });
  assert.match(message, /^From: Helixcer Chat <noreply@helixcer.com>\r\n/);
  assert.match(message, /To: owner@example.com\r\n/);
  assert.match(message, /Subject: Reset your Helixcer Chat password\r\n/);
  assert.match(message, /Content-Type: multipart\/alternative;/);
  assert.match(message, /plain body/);
  assert.match(message, /<p>html body<\/p>/);
});

test('passwordResetEmailContent includes the reset URL', () => {
  const content = passwordResetEmailContent('https://chat.helixcer.com/?reset=abc');
  assert.match(content.subject, /password/i);
  assert.match(content.text, /https:\/\/chat\.helixcer\.com\/\?reset=abc/);
  assert.match(content.html, /https:\/\/chat\.helixcer\.com\/\?reset=abc/);
});
