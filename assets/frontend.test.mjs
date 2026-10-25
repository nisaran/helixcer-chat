import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("./app.js", import.meta.url), "utf8");

test("all JavaScript DOM id references exist exactly once", () => {
  const htmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = htmlIds.filter((id, index) => htmlIds.indexOf(id) !== index);
  assert.deepEqual(duplicates, []);

  const referencedIds = [...app.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]);
  const missing = [...new Set(referencedIds)].filter((id) => !htmlIds.includes(id));
  assert.deepEqual(missing, []);
});

test("normal authentication uses a top-level link and cookie credentials", () => {
  assert.match(html, /<a[^>]+id="googleSignInLink"/);
  assert.match(html, /name="helixcer-api-base" content="https:\/\/api\.chat\.helixcer\.com"/);
  assert.match(app, /searchParams\.set\("return_to", location\.origin\)/);
  assert.match(app, /credentials:\s*"include"/);
  assert.match(app, /request\("\/api\/me"\)/);
  assert.match(app, /meta\[name="helixcer-api-base"\]/);
  assert.doesNotMatch(app, /STORAGE_KEY|LEGACY_API_BASES/);
});

test("technical connection and recovery controls are not exposed in the UI", () => {
  assert.match(app, /sessionStorage\.getItem\(RECOVERY_TOKEN_KEY\)/);
  assert.doesNotMatch(html, /id="settingsDialog"|Connection settings|Worker API URL/i);
  assert.doesNotMatch(html, /Emergency recovery|recoveryTokenInput|authRecoveryToken/i);
  assert.doesNotMatch(html, /data-action="(?:open-settings|preview-demo|apply-auth-recovery|use-demo)"/i);
  assert.doesNotMatch(app, /localStorage\.getItem\([^)]*admin_token/i);
  assert.doesNotMatch(app, /url\.searchParams\.set\([^,]*token/i);
});

test("role-aware single-workspace UI includes team management and no billing surface", () => {
  assert.match(html, /data-route="team"/);
  assert.match(html, /id="teamTableBody"/);
  assert.match(html, /id="inviteForm"/);
  assert.doesNotMatch(html, /id="inviteRole"[^>]*>[\s\S]*?<option value="owner"/);
  assert.doesNotMatch(html, /data-route="billing"/i);
});

test("production channel UI is WhatsApp-only and hides provider internals", () => {
  assert.match(html, /<h2 id="channelsTitle">WhatsApp<\/h2>/);
  assert.match(html, />WhatsApp number<input/);
  assert.match(app, /channelId:\s*"wa-main"/);
  assert.match(app, /\/api\/channels\/\$\{encodeURIComponent\(channelId\)\}\/verify/);
  assert.match(app, /webhooks\/whatsapp\/\$\{encodeURIComponent\(channelId\)\}/);
  assert.doesNotMatch(html, /channelConnectorType|Secret prefix|Generic API endpoint|Telegram Bot API|Website chat/);
  assert.doesNotMatch(html, /id="channelDialog"|id="channelForm"/);
  assert.doesNotMatch(app, /apiVersion:\s*"v23\.0"/);
});
