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

test("channel management supports multiple provider accounts without hardcoded credentials", () => {
  assert.match(html, /<h2 id="channelsTitle">Channels<\/h2>/);
  assert.match(html, /data-action="open-channel"/);
  assert.match(html, /id="channelDialog"/);
  assert.match(html, /id="channelForm"/);
  assert.match(html, /id="channelProvider"/);
  assert.match(html, /<option value="whatsapp_cloud">WhatsApp Cloud<\/option>/);
  assert.match(html, /<option value="telegram">Telegram Bot<\/option>/);
  assert.match(html, /<option value="instagram">Instagram<\/option>/);
  assert.match(html, /Instagram Business or Creator account/);
  assert.match(html, /Instagram User access token/);
  assert.doesNotMatch(html, /Facebook Page ID|Page access token/);
  assert.match(html, /id="contactChannelId"/);
  assert.match(html, /name="channelProfileId"/);
  assert.match(app, /request\("\/api\/channels", \{ method: "POST"/);
  assert.match(app, /request\(`\/api\/channels\/\$\{encodeURIComponent\(channelId\)\}`, \{ method: "PATCH"/);
  assert.match(app, /\/api\/channels\/\$\{encodeURIComponent\(channelId\)\}\/verify/);
  assert.match(app, /whatsapp_cloud:\s*\{/);
  assert.match(app, /telegram:\s*\{/);
  assert.match(app, /instagram:\s*\{/);
  assert.match(app, /apiVersion:\s*"v26\.0"/);
  assert.match(app, /authMode:\s*"instagram_login"/);
  assert.match(app, /data\.action = "verify-channel"|dataset\.action = "verify-channel"/);
  assert.match(app, /copy-webhook-callback/);
  assert.match(app, /\/webhooks\/instagram-app\/\$\{encodeURIComponent\(channel\.config\.appId\)\}/);
  assert.match(app, /Helixcer routes messages by account ID/);
  assert.match(app, /populateContactChannelSelect/);
  assert.match(app, /channelId:\s*String\(formData\.get\("channelId"\)/);
  assert.doesNotMatch(app, /channelId:\s*"wa-main"/);
  assert.doesNotMatch(`${html}\n${app}`, /WA_MAIN_(?:ACCESS_TOKEN|APP_SECRET|VERIFY_TOKEN|PHONE_NUMBER_ID)/);
});

test("channel secrets are masked, optional on edit, and never prefilled", () => {
  assert.match(html, /name="whatsappAccessToken" type="password"/);
  assert.match(html, /name="whatsappAppSecret" type="password"/);
  assert.match(html, /name="whatsappVerifyToken" type="password"/);
  assert.match(html, /name="telegramBotToken" type="password"/);
  assert.match(html, /name="telegramWebhookSecret" type="password"/);
  assert.match(html, /name="instagramAccessToken" type="password"/);
  assert.match(html, /name="instagramAppSecret" type="password"/);
  assert.match(html, /name="instagramVerifyToken" type="password"/);
  assert.match(html, /data-generate-secret="whatsappVerifyToken"/);
  assert.match(html, /data-copy-secret="whatsappVerifyToken"/);
  assert.match(html, /data-generate-secret="telegramWebhookSecret"/);
  assert.match(html, /data-generate-secret="instagramVerifyToken"/);
  assert.match(html, /cannot show it again/);
  assert.match(app, /setup\.credentialFields/);
  assert.match(app, /input\.required = active && !saved/);
  assert.match(app, /input\.dataset\.defaultPlaceholder/);
  assert.match(app, /\.filter\(\(\[, value\]\) => value\)/);
  assert.doesNotMatch(html, /type="password"[^>]+value=/);
  assert.doesNotMatch(app, /channel\?\.credentials|channel\.credentials/);
});
