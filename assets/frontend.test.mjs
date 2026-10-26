import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("./app.js", import.meta.url), "utf8");
const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8");
const apiDocs = await readFile(new URL("../api-docs.html", import.meta.url), "utf8");
const serviceWorker = await readFile(new URL("../sw.js", import.meta.url), "utf8");

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
  assert.match(app, /returnTo\.hash = location\.hash \|\| "#inbox"/);
  assert.match(app, /searchParams\.set\("return_to", returnTo\.toString\(\)\)/);
  assert.match(app, /credentials:\s*"include"/);
  assert.match(app, /request\("\/api\/me"\)/);
  assert.match(app, /meta\[name="helixcer-api-base"\]/);
  assert.match(app, /authParams\.get\("auth_error"\)/);
  assert.match(app, /authParams\.delete\("auth_error_code"\)/);
  assert.doesNotMatch(app, /STORAGE_KEY|LEGACY_API_BASES/);
});

test("refresh starts on a neutral session splash without flashing Google sign-in", () => {
  assert.match(html, /class="session-splash" id="sessionSplash" role="status"/);
  assert.match(html, /class="auth-gate" id="authGate"[^>]*hidden/);
  assert.doesNotMatch(html, /id="authChecking"/);
  assert.match(app, /showAuthChecking\(\)[\s\S]*?sessionSplash"\)\.hidden = false;[\s\S]*?authGate"\)\.hidden = true/);
  assert.match(app, /showApplication\(auth\)[\s\S]*?sessionSplash"\)\.hidden = true;[\s\S]*?authGate"\)\.hidden = true/);
  assert.match(styles, /\.session-splash \{/);
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
  assert.match(html, /data-route="developer" data-admin-only/);
  assert.match(html, /id="teamTableBody"/);
  assert.match(html, /id="inviteForm"/);
  assert.doesNotMatch(html, /id="inviteRole"[^>]*>[\s\S]*?<option value="owner"/);
  assert.doesNotMatch(html, /data-route="billing"/i);
});

test("single workspace profile stores organisation, address, and GST details", () => {
  assert.match(html, /data-route="workspace"/);
  assert.match(html, /id="workspaceRoute" data-route-panel="workspace"/);
  assert.match(html, /Single workspace/);
  for (const field of ["workspaceId", "workspaceDisplayName", "workspaceRegisteredName", "workspaceAddressLine1", "workspaceAddressLine2", "workspaceCity", "workspaceState", "workspacePostalCode", "workspaceCountry", "workspaceGstin", "workspaceTaxDetails"]) {
    assert.match(html, new RegExp(`id="${field}"`));
  }
  assert.match(html, /id="workspaceId"[^>]*readonly[^>]*data-workspace-immutable/);
  assert.match(html, /data-action="copy-workspace-id"/);
  assert.match(app, /workspaceId: "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"/);
  assert.match(app, /workspaceId: profile\.workspaceId/);
  assert.match(app, /field\.hasAttribute\("data-workspace-immutable"\)/);
  assert.match(app, /"copy-workspace-id": \(\) => copyDeveloperApiValue\(\$\("workspaceId"\)\.value/);
  const workspacePayload = app.slice(app.indexOf("async function saveWorkspaceProfile"), app.indexOf("function showAuthChecking"));
  assert.doesNotMatch(workspacePayload, /workspaceId\s*:/);
  assert.match(app, /getWorkspace\(\)[\s\S]*?request\("\/api\/workspace"\)/);
  assert.match(app, /updateWorkspace\(payload\)[\s\S]*?request\("\/api\/workspace", \{ method: "PATCH"/);
  assert.match(app, /loadWorkspaceProfile\(\)/);
  assert.match(app, /type === "workspace\.updated"[\s\S]*?updateWorkspaceIdentity/);
  assert.match(app, /if \(data\.workspace\)[\s\S]*?state\.workspaceProfileLoaded = true/);
  assert.match(app, /const editable = admin && state\.workspaceProfileLoaded/);
  assert.match(html, /Only workspace owners and admins can edit these details/);
  assert.match(app, /\["inbox", "contacts", "channels", "whatsapp-templates", "developer", "team", "workspace", "settings"\]/);
  assert.match(styles, /\.workspace-form-grid \{[^}]*grid-template-columns: repeat\(2/);
  assert.match(styles, /\.workspace-profile-form \.text-field\[readonly\]/);
  assert.doesNotMatch(`${html}\n${app}`, /createWorkspace|deleteWorkspace|workspaceSwitcher/i);
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

test("Channel navigation is collapsed by default and nests the WhatsApp template library", () => {
  const channelNav = html.match(/<div class="nav-group" id="channelNavGroup"[\s\S]*?<button class="nav-button" type="button" data-route="developer"/)?.[0] || "";
  assert.match(channelNav, /data-admin-only/);
  assert.match(channelNav, />Channel<\/span>/);
  assert.match(channelNav, /id="channelNavToggle"[^>]*aria-expanded="false"/);
  assert.match(channelNav, /id="channelNavChildren" hidden/);
  assert.match(channelNav, /data-route="channels"[\s\S]*?>Channels<\/span>/);
  assert.match(channelNav, />Channel Data<\/span>/);
  assert.match(channelNav, /id="channelDataNavToggle"[^>]*aria-expanded="false"/);
  assert.match(channelNav, /id="channelDataNavChildren" hidden/);
  assert.match(channelNav, /data-route="whatsapp-templates"[\s\S]*?>WhatsApp Templates<\/span>/);
  assert.match(html, /id="whatsappTemplatesRoute" data-route-panel="whatsapp-templates"/);
  assert.match(app, /"whatsapp-templates": "WhatsApp Templates"/);
  assert.match(app, /\["channels", "whatsapp-templates", "developer", "team"\]/);
  assert.match(app, /if \(channelSectionActive\)[\s\S]*?channelNavToggle"\)\.setAttribute\("aria-expanded", "true"\)/);
  assert.match(app, /if \(route === "whatsapp-templates"\)[\s\S]*?channelDataNavToggle"\)\.setAttribute\("aria-expanded", "true"\)/);
  assert.match(styles, /\.nav-submenu/);
});

test("WhatsApp template library aggregates, previews, searches, and multi-filters every account", () => {
  assert.match(app, /request\("\/api\/channel-data\/whatsapp-templates"\)/);
  assert.match(app, /async function loadWhatsAppTemplateLibrary/);
  assert.match(app, /state\.whatsappTemplateErrors = asItems\(data\?\.errors\)/);
  assert.match(app, /state\.whatsappTemplateTruncatedChannels = asItems\(data\?\.truncatedChannels\)/);
  assert.match(app, /state\.whatsappTemplateFilterOptions = data\?\.filterOptions/);
  assert.match(html, /id="whatsappTemplateSearch"[^>]*type="search"/);
  for (const type of ["channel", "category", "status", "language"]) {
    assert.match(html, new RegExp(`data-template-filter="${type}"`));
    assert.match(html, new RegExp(`data-template-filter-search="${type}"`));
    assert.match(html, new RegExp(`data-template-filter-options="${type}"`));
  }
  assert.match(app, /input\.type = "checkbox"/);
  assert.match(app, /state\.whatsappTemplateFilters\[type\]\.add\(event\.target\.value\)/);
  assert.match(app, /templateLibrarySearchText\(template\)\.includes\(search\)/);
  assert.match(app, /function renderWhatsAppTemplatePreview/);
  assert.match(app, /templateLibraryComponent\(template, "HEADER"\)/);
  assert.match(app, /Array\.isArray\(template\?\.variables\) && template\.variables\.length/);
  assert.match(app, /templateLibraryComponent\(template, "BODY"\)/);
  assert.match(app, /templateLibraryComponent\(template, "FOOTER"\)/);
  assert.match(app, /templateLibraryButtons\(template\)/);
  assert.match(app, /Templates from the remaining channels are shown/);
  assert.match(app, /providerDisplayName && providerDisplayName\.toLocaleLowerCase\(\) !== label\.toLocaleLowerCase\(\)/);
  assert.match(app, /closeTemplateFilterMenus\("", \{ restoreFocus: true \}\)/);
  assert.match(styles, /\.template-library-grid\s*\{/);
  assert.match(styles, /\.whatsapp-template-preview\s*\{/);
  assert.match(styles, /\.template-filter-menu\s*\{/);
  assert.match(styles, /\.template-filter:nth-child\(even\) \.template-filter-menu/);
});

test("channel secrets are masked, optional on edit, and never prefilled", () => {
  assert.match(html, /name="whatsappAccessToken" type="password"/);
  assert.match(html, /name="whatsappAppSecret" type="password"/);
  assert.match(html, /name="telegramBotToken" type="password"/);
  assert.match(html, /name="telegramWebhookSecret" type="password"/);
  assert.match(html, /name="instagramAccessToken" type="password"/);
  assert.match(html, /name="instagramAppSecret" type="password"/);
  assert.match(html, /data-generate-secret="telegramWebhookSecret"/);
  assert.doesNotMatch(html, /name="(?:whatsapp|instagram)VerifyToken"/);
  assert.match(html, /id="webhookTokenDialog"/);
  assert.match(html, /id="webhookTokenInput" name="verifyToken" type="password"/);
  assert.match(app, /setup\.credentialFields/);
  assert.match(app, /input\.required = active && !saved/);
  assert.match(app, /input\.dataset\.defaultPlaceholder/);
  assert.match(app, /const SAVED_SECRET_MASK/);
  assert.match(app, /input\.value = SAVED_SECRET_MASK/);
  assert.match(app, /value === SAVED_SECRET_MASK \? "" : value/);
  assert.match(app, /focusin/);
  assert.match(app, /focusout/);
  assert.match(app, /\.filter\(\(\[, value\]\) => value\)/);
  assert.doesNotMatch(html, /type="password"[^>]+value=/);
  assert.doesNotMatch(app, /channel\?\.credentials|channel\.credentials/);
});

test("Meta verify tokens live beside their callback and can be safely replaced", () => {
  assert.match(app, /callback-token-block/);
  assert.match(app, /copy-webhook-token/);
  assert.match(app, /edit-webhook-token/);
  assert.match(app, /recentVerifyTokens: new Map\(\)/);
  assert.match(app, /updateChannel\(channelId, \{ credentials: \{ verifyToken \} \}\)/);
  assert.match(app, /state\.recentVerifyTokens\.set\(channelId, verifyToken\)/);
  assert.match(app, /state\.recentVerifyTokens\.clear\(\)/);
  assert.match(app, /It will be masked again after a refresh/);
});

test("saving a channel never runs provider verification and avoids duplicate creation", () => {
  assert.match(app, /savedChannelId = channelId \|\| String\(result\.channelId \|\| ""\)/);
  assert.match(app, /\$\("channelIdInput"\)\.value = savedChannelId/);
  const saveChannelBody = app.slice(app.indexOf("async function saveChannel"), app.indexOf("async function toggleChannel"));
  assert.doesNotMatch(saveChannelBody, /verifyChannel|Verifying|verification failed/i);
  assert.match(saveChannelBody, /was saved without running provider verification/);
  assert.match(app, /savedChannelId \? "Save changes" : "Save connection"/);
});

test("WhatsApp inbox supports rendered templates, queued attachments, and reply-window blocking", () => {
  assert.match(html, /id="replyWindowNotice"/);
  assert.match(html, /id="attachmentInput" type="file" multiple/);
  assert.match(html, /id="templateDialog"/);
  assert.match(app, /freeformAllowed/);
  assert.match(app, /\/api\/conversations\/\$\{encodeURIComponent\(conversationId\)\}\/templates/);
  assert.match(app, /\/api\/conversations\/\$\{encodeURIComponent\(conversationId\)\}\/template/);
  assert.match(app, /\/api\/conversations\/\$\{encodeURIComponent\(conversationId\)\}\/attachments/);
  assert.match(app, /The 24-hour reply window is closed/);
  assert.match(html, /id="templateSelect"/);
  assert.match(html, /id="templateVariableFields"/);
  assert.match(app, /parameter_name/);
  assert.match(app, /sub_type: descriptor\.subType/);
  assert.match(app, /\[descriptor\.mediaType\]: \{ link: value \}/);
  assert.match(app, /\[descriptor\.mediaType\]: \{ id: uploaded\.mediaId \}/);
  assert.match(app, /const request = \{ name, language: \{ code: languageCode \}, previewText \}/);
  assert.match(app, /\/approved template\/i\.test\(reason\)/);
  assert.match(styles, /#templateDialog\s*\{[^}]*max-height:\s*calc\(100dvh - 24px\)[^}]*overflow-y:\s*auto/);
  assert.match(app, /\["", "Choose source"\]/);
  assert.match(app, /suggestedTemplateSource\(descriptor\)/);
  assert.match(app, /\["customer_name", "displayName"\]/);
  assert.match(app, /return sources\.get\(name\) \|\| ""/);
  assert.match(app, /refreshButton\.dataset\.action = "reload-templates"/);
});

test("chat renders WhatsApp formatting and template actions without unsafe HTML", () => {
  assert.match(app, /response\.item\.messageType = "template"/);
  assert.match(app, /function appendWhatsAppFormattedText\(host, value\)/);
  assert.match(app, /document\.createTextNode\(text\.slice\(cursor, index\)\)/);
  assert.match(app, /const tag = isCode \? "code" : match\[2\] !== undefined \? "strong"/);
  assert.match(app, /function appendChannelFormattedText\(host, value, conversation\)/);
  assert.match(app, /if \(isWhatsAppConversation\(conversation\)\) return appendWhatsAppFormattedText\(host, value\)/);
  assert.match(app, /function channelPlainText\(value, conversation\)/);
  assert.match(app, /isWhatsAppConversation\(conversation\) \? whatsAppPlainText\(text\) : text/);
  assert.match(app, /function templateMessagePresentation\(message, value\)/);
  assert.match(app, /match\(\/\^\\s\*Actions:/);
  assert.match(app, /message\?\.template\?\.buttons/);
  assert.match(app, /function renderTemplateMessageActions\(buttons\)/);
  assert.match(app, /action\.setAttribute\("aria-disabled", "true"\)/);
  assert.match(app, /function whatsAppPlainText\(value\)/);
  assert.match(app, /function conversationPreviewText\(value, messageType, conversation\)/);
  assert.match(app, /const isTemplate = String\(messageType \|\| ""\)[\s\S]*?=== "template"/);
  assert.match(app, /if \(isTemplate && last >= 0 && \/\^\\s\*Actions:/);
  assert.match(app, /conversation\.lastMessage, conversation\.lastMessageType, conversation/);
  assert.match(app, /const lastMessageType = String\(raw\.lastMessageType \|\| raw\.lastMessage\?\.messageType \|\| ""\)/);
  assert.match(app, /function messagePlainText\(message, conversation\)/);
  assert.match(app, /Reply to \$\{messagePlainText\(message, conversation\)\}/);
  assert.match(app, /body: channelPlainText\(message\.text, conversation\)/);
  assert.match(app, /conversation\.lastMessageType = "template"/);
  assert.match(app, /conversation\.lastMessageType = String\(message\.messageType \|\| "text"\)/);
  const messageRenderer = app.slice(app.indexOf("function appendWhatsAppFormattedText"), app.indexOf("function syncMessageDateDividers"));
  assert.doesNotMatch(messageRenderer, /innerHTML|insertAdjacentHTML/);
  assert.match(styles, /\.message-template-actions\s*\{/);
  assert.match(styles, /\.message-template-action\s*\{/);
  assert.match(styles, /\.message-text strong\s*\{/);
});

test("template composer searches templates and variables, previews substitutions, and uploads media", () => {
  assert.match(html, /id="templateSearch" type="search"/);
  assert.match(html, /id="templateSearch"[^>]*role="combobox"/);
  assert.match(html, /type="hidden" name="templateId" id="templateSelect"/);
  assert.doesNotMatch(html, /<select[^>]+id="templateSelect"/);
  assert.match(html, /id="templateMessagePreview"/);
  assert.match(html, /id="templatePreviewText"/);
  assert.match(app, /function renderTemplateSelectOptions\(query = "", \{ open = true \} = \{\}\)/);
  assert.match(app, /function filterTemplateSourceOptions\(row, query\)/);
  assert.match(app, /function searchableComboboxOptions/);
  assert.match(app, /function chooseTemplateSource/);
  assert.match(app, /source\.type = "hidden"/);
  assert.match(app, /comboInput\.setAttribute\("role", "combobox"\)/);
  assert.match(app, /function replaceTemplatePlaceholders/);
  assert.match(app, /function renderTemplateComposerPreview/);
  assert.match(app, /template-media/);
  assert.match(app, /\[\["upload", "Upload a file"\], \["url", "Use media URL"\]\]/);
  assert.match(app, /source\.value = descriptor\.kind === "media" \? "upload"/);
  assert.match(app, /function revokeTemplatePreviewUrl\(\)/);
  assert.match(app, /templateDialog"\)\.addEventListener\("close"[\s\S]*?revokeTemplatePreviewUrl\(\)/);
  assert.match(app, /source === "upload" \? row\?\.querySelector\("\.template-media-file"\)/);
  assert.match(app, /model\.media\.type === "image" && model\.media\.previewUrl/);
  assert.match(app, /referrerPolicy = "no-referrer"/);
  assert.match(html, /img-src 'self' data: blob: https:; media-src 'self' blob: https:/);
  assert.doesNotMatch(app, /image\/jpeg,image\/png,image\/webp/);
  assert.match(app, /searchableComboboxInputKeydown/);
  assert.match(app, /event\.key === "Enter"/);
  assert.match(styles, /\.template-composer-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1\.15fr\) minmax\(300px, \.85fr\)/);
  assert.match(styles, /@media \(max-width: 830px\)[\s\S]*?\.template-composer-layout\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(app, /if \(mediaPreview\) request\.mediaPreview = mediaPreview/);
  assert.match(app, /model\.text = textParts\.join\("\\n"\)\.trim\(\) \|\|/);
  assert.doesNotMatch(app, /model\.text = [^\n]+\.slice\(0, 4096\)/);
  const templateSelectionInvalidation = app.slice(app.indexOf("function invalidateTemplateSelection"), app.indexOf("function renderTemplateSelectOptions"));
  assert.match(templateSelectionInvalidation, /select\.value = ""/);
  assert.match(templateSelectionInvalidation, /delete input\.dataset\.selectedLabel/);
  assert.match(templateSelectionInvalidation, /templateSubmit"\)\.disabled = true/);
  const sourceSelectionInvalidation = app.slice(app.indexOf("function invalidateTemplateSourceSelection"), app.indexOf("function searchableComboboxInputKeydown"));
  assert.match(sourceSelectionInvalidation, /source\.value = ""/);
  assert.match(sourceSelectionInvalidation, /syncTemplateVariableSource\(row\)/);
  assert.match(app, /invalidateTemplateSelection\(event\.target\);\s*renderTemplateSelectOptions\(event\.target\.value\)/);
  assert.match(app, /invalidateTemplateSourceSelection\(row, event\.target\);\s*filterTemplateSourceOptions\(row, event\.target\.value\)/);
});

test("attachments queue without auto-send and render provider-backed previews for WhatsApp and Telegram", () => {
  assert.match(html, /id="attachmentQueue"/);
  assert.match(app, /pendingAttachments: new Map\(\)/);
  assert.match(app, /function queueCurrentAttachments\(fileList\)/);
  assert.match(app, /async function sendQueuedAttachments/);
  assert.match(app, /while \(queue\.length\)/);
  assert.match(app, /supportsChatAttachments/);
  assert.match(app, /"telegram", "telegram_bot"/);
  assert.match(app, /function renderMessageAttachment\(message\)/);
  assert.match(app, /image\.loading = "lazy"/);
  assert.match(app, /video\.preload = "metadata"/);
  assert.match(app, /download \? "\?download=1"/);
  assert.match(app, /function discardAttachmentQueue\(conversationId\)/);
  assert.match(app, /discardAttachmentQueue\(conversationId\);/);
  assert.match(app, /return 5 \* 1024 \* 1024/);
  assert.match(app, /WhatsApp image type not supported/);
  const attachmentRenderer = app.slice(app.indexOf("function renderMessageAttachment"), app.indexOf("function renderMessages"));
  for (const media of ["image", "video", "audio"]) {
    assert.ok(attachmentRenderer.indexOf(`${media}.crossOrigin = "use-credentials"`) >= 0);
    assert.ok(attachmentRenderer.indexOf(`${media}.crossOrigin = "use-credentials"`) < attachmentRenderer.indexOf(`${media}.src = url`));
  }
  const queueFunction = app.slice(app.indexOf("function queueCurrentAttachments"), app.indexOf("function removeQueuedAttachment"));
  assert.doesNotMatch(queueFunction, /sendAttachment\(/);
});

test("provider-native replies and in-page attachment previews are available in chat", () => {
  assert.match(html, /id="composerReply"[^>]*hidden/);
  assert.match(html, /id="attachmentPreviewDialog"/);
  assert.match(app, /replyToMessageId/);
  assert.match(app, /function startReplyToMessage\(messageId\)/);
  assert.match(app, /formData\.append\("replyToMessageId", replyToMessageId\)/);
  assert.match(app, /data\.action = "reply-to-message"|dataset\.action = "reply-to-message"/);
  assert.match(app, /offset >= 52/);
  assert.match(app, /function renderQuotedReply\(reply, conversation\)/);
  assert.match(app, /function openAttachmentPreview\(messageId\)/);
  const attachmentRenderer = app.slice(app.indexOf("function renderMessageAttachment"), app.indexOf("function messageDisplayText"));
  assert.doesNotMatch(attachmentRenderer, /target = "_blank"/);
  assert.match(styles, /\.message-quote \{/);
  assert.match(styles, /\.attachment-preview-body \{/);
  assert.match(styles, /dialog\.attachment-preview-dialog\s*\{[^}]*width:\s*min\(940px,[^}]*max-width:\s*none[^}]*overflow:\s*hidden/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?dialog\.attachment-preview-dialog\s*\{[^}]*width:\s*100vw[^}]*height:\s*100dvh[^}]*margin:\s*0/);
  assert.match(styles, /\.attachment-preview-card\s*\{[^}]*width:\s*100%[^}]*max-width:\s*100%/);
});

test("realtime messages reconcile silently across resumed browsers", () => {
  const realtimeHandler = app.slice(app.indexOf("async function handleRealtimeEvent"), app.indexOf("function isIosDevice"));
  assert.match(realtimeHandler, /type === "connected"/);
  assert.match(realtimeHandler, /upsertRenderedMessage\(message, conversationId\)/);
  assert.doesNotMatch(realtimeHandler, /renderMessages\(\{ preserveScroll: true \}\)/);
  assert.doesNotMatch(realtimeHandler, /state\.messages\.delete\(state\.selectedConversationId\)/);
  assert.match(app, /ensureRealtimeConnected\?\.\(\{ resume: true \}\)/);
  assert.match(app, /window\.addEventListener\("pagehide", \(\) => state\.disconnectRealtime\?\.\(\)\)/);
  assert.match(app, /window\.addEventListener\("pageshow", resumeLiveWorkspace\)/);
  assert.match(app, /window\.addEventListener\("online", resumeLiveWorkspace\)/);
  assert.match(app, /socket\.send\("ping"\)/);
});

test("reconnect reconciliation expires stale histories and marks a visible selected chat read", () => {
  const loadAll = app.slice(app.indexOf("async function loadAll"), app.indexOf("async function reconcileWorkspace"));
  const reconcile = app.slice(app.indexOf("async function reconcileWorkspace"), app.indexOf("function renderAll"));
  const realtimeHandler = app.slice(app.indexOf("async function handleRealtimeEvent"), app.indexOf("function isIosDevice"));
  assert.match(loadAll, /mergeConversationSnapshots\(fetchedConversations, realtimeRevisionAtStart\)/);
  assert.match(reconcile, /const realtimeRevisionAtStart = state\.realtimeRevision/);
  assert.match(reconcile, /mergeConversationSnapshots\(fetchedConversations, realtimeRevisionAtStart\)/);
  assert.match(realtimeHandler, /markConversationRealtimeMutation\(conversationId\)/);
  assert.match(realtimeHandler, /markConversationRealtimeMutation\(incoming\.conversationId\)/);
  assert.match(reconcile, /for \(const cachedConversationId of state\.messages\.keys\(\)\)/);
  assert.match(reconcile, /cachedConversationId !== activeSelectedId\) state\.messages\.delete\(cachedConversationId\)/);
  assert.match(reconcile, /selectedConversation\.unreadCount > 0 && document\.visibilityState === "visible"/);
  assert.match(reconcile, /updateConversation\(activeSelectedId, \{ markRead: true \}\)\.catch/);
  assert.match(reconcile, /\["pending", "closed"\]\.includes\(selectedConversation\.status\)[\s\S]*?clearSelectedConversation/);
  const helperStart = app.indexOf("function markConversationRealtimeMutation");
  const helperEnd = app.indexOf("function normalizeContact", helperStart);
  const localState = {
    realtimeRevision: 2,
    conversationRevisions: new Map([["changed", 2], ["new-live", 2]]),
    conversations: [
      { conversationId: "changed", lastMessage: "live", unreadCount: 2 },
      { conversationId: "new-live", lastMessage: "new", unreadCount: 1 },
    ],
  };
  const mergeConversations = Function("state", `${app.slice(helperStart, helperEnd)}\nreturn mergeConversationSnapshots;`)(localState);
  assert.deepEqual(mergeConversations([
    { conversationId: "changed", lastMessage: "stale", unreadCount: 1 },
    { conversationId: "steady", lastMessage: "stored", unreadCount: 0 },
  ], 1).map((item) => [item.conversationId, item.lastMessage]), [
    ["new-live", "new"], ["changed", "live"], ["steady", "stored"],
  ]);
});

test("realtime sockets ignore superseded close events and time out stalled handshakes", () => {
  const connect = app.slice(app.indexOf("connect(listener, onState)"), app.indexOf("ensureRealtimeConnected", app.indexOf("connect(listener, onState)")));
  assert.match(connect, /Realtime connection timed out/);
  assert.match(connect, /if \(this\.socket !== socket\) return;[\s\S]*?this\.socket = null/);
  assert.match(connect, /if \(this\.socket !== socket \|\| this\.closedByClient\) return;[\s\S]*?listener\(JSON\.parse\(event\.data\)\)/);
  assert.match(connect, /event\.code === 1008[\s\S]*?helixcer:unauthorized/);
});

test("settings expose permission-aware browser notifications", () => {
  assert.match(html, /data-route="settings"/);
  assert.match(html, /id="settingsRoute" data-route-panel="settings"/);
  assert.match(html, /id="pushNotificationsToggle"/);
  assert.match(app, /Notification\.requestPermission\(\)/);
  assert.match(app, /navigator\.serviceWorker\.register\(SERVICE_WORKER_URL, \{ scope: "\/" \}\)/);
  assert.match(app, /"serviceWorker" in navigator/);
  assert.match(app, /registration\.showNotification\(title, options\)/);
  assert.match(app, /registration\.pushManager\.subscribe\(\{ userVisibleOnly: true, applicationServerKey: expectedKey \}\)/);
  assert.match(app, /state\.api\.savePushSubscription/);
  assert.match(app, /\/api\/push\/subscriptions/);
  assert.match(app, /const enabledOnDevice = permission === "granted" && state\.notificationsEnabled && state\.pushSubscriptionReady/);
  assert.match(app, /pushNotificationsToggle"\)\.addEventListener\("click"/);
  assert.match(app, /subscription\?\.endpoint/);
  assert.match(app, /state\.notificationsEnabled = true;[\s\S]*?localStorage\.setItem\(NOTIFICATION_PREFERENCE_KEY, "true"\)/);
  assert.match(app, /state\.pushSubscriptionReady && document\.visibilityState !== "visible"/);
  assert.match(app, /Add Helixcer to your Home Screen/);
  assert.match(html, /Receive background alerts on this device/);
  assert.match(app, /site-controls icon beside the address bar/);
  assert.match(app, /Android Settings → Apps → Chrome → Notifications/);
  assert.match(app, /new Notification\(/);
  assert.match(app, /type === "webhook\.received"[\s\S]*?!event\.granular[\s\S]*?reconcileWorkspace/);
  assert.match(app, /type === "message\.created"[\s\S]*?notifyInboundMessage/);
  assert.match(app, /lastNotificationAt: new Map\(\)/);
});

test("notification clicks accept only inbox deep links and navigate an existing app window", () => {
  assert.match(serviceWorker, /function safeNotificationUrl\(value\)/);
  assert.match(serviceWorker, /safeNotificationUrl\(source\.url\)/);
  assert.match(serviceWorker, /await existing\.navigate\(targetUrl\)/);
  assert.match(serviceWorker, /self\.clients\.openWindow\(targetUrl\)/);
});

test("channel cards collapse by default and use provider artwork throughout the inbox", () => {
  assert.match(app, /expandedChannelIds: new Set\(\)/);
  assert.match(app, /data\.action = "toggle-channel-details"|dataset\.action = "toggle-channel-details"/);
  assert.match(app, /details\.hidden = !expanded/);
  assert.match(app, /"Connection name"/);
  assert.match(app, /"Provider display name"/);
  assert.match(app, /channel\.setup\?\.verifiedName \|\| channel\.setup\?\.verifiedUsername \|\| "Not available yet"/);
  assert.match(styles, /\.channel-provider-display-name/);
  assert.match(app, /provider-whatsapp\.svg/);
  assert.match(app, /provider-telegram\.svg/);
  assert.match(app, /provider-instagram\.svg/);
  assert.match(html, /id="chatProviderLogo"/);
  assert.match(html, /id="chatChannelProfileId"/);
  assert.match(html, /class="chat-contact-card"[^>]*data-action="toggle-details"/);
  assert.match(html, /class="chat-person-title-row"[\s\S]*?id="chatTitle"[\s\S]*?id="chatChannelProfileId"/);
  assert.match(styles, /\.chat-contact-card\s*\{/);
  assert.match(styles, /\.chat-person-title-row\s*\{/);
  assert.match(styles, /\.chat-profile-id \{ max-width: min\(30vw, 140px\); \}/);
  assert.match(app, /\$\("chatChannel"\)\.textContent = channel\?\.name/);
  assert.match(app, /contact\?\.channelProfileId \|\| conversation\.channelProfileId/);
});

test("contacts open in a right-side editor backed by contact detail endpoints", () => {
  assert.match(html, /id="contactsWorkspace"/);
  assert.match(html, /id="contactEditor"/);
  assert.match(html, /id="contactEditName"/);
  assert.match(html, /id="contactEditChannel"/);
  assert.match(html, /id="contactEditChannelHelp"/);
  assert.match(html, /Channel Profile ID<input[^>]*id="contactEditChannelProfileId"[^>]*readonly[^>]*aria-readonly="true"/);
  assert.match(html, /Assigned by the channel and cannot be edited/);
  assert.match(html, /id="contactEditCompany"/);
  assert.match(html, /id="contactEditTags"/);
  assert.match(app, /request\(`\/api\/contacts\/\$\{encodeURIComponent\(contactId\)\}`\)/);
  assert.match(app, /request\(`\/api\/contacts\/\$\{encodeURIComponent\(contactId\)\}`, \{ method: "PATCH"/);
  assert.match(app, /row\.dataset\.contactId = contact\.contactId/);
  assert.match(app, /Channel is locked because this contact already has message history/);
  const saveContactBody = app.match(/async function saveContactEdits\(form\) \{([\s\S]*?)\n  \}/)?.[1] || "";
  assert.doesNotMatch(saveContactBody, /channelProfileId\s*:/);
  assert.match(app, /type === "contact\.updated"[\s\S]*?await reconcileWorkspace\(\)[\s\S]*?await selectContact/);
  assert.match(app, /\["channelProfileId", "Channel Profile ID"\]/);
});

test("expanded channel cards expose the internal channel ID with a copy action", () => {
  assert.match(app, /channel-id-block/);
  assert.match(app, /"Channel ID"/);
  assert.match(app, /dataset\.action = "copy-channel-id"/);
  assert.match(app, /dataset\.copyValue = channel\.channelId/);
  assert.match(app, /setAttribute\("aria-label", "Copy Channel ID"\)/);
  assert.match(app, /copyDeveloperApiValue\(actionButton\.dataset\.copyValue, "Channel ID copied"\)/);
});

test("outbound messages expose sent, delivered, read, retry, and failure states for every provider", () => {
  assert.match(app, /function outboundDeliveryStatus\(value\)/);
  assert.match(app, /Delivered ✓✓/);
  assert.match(app, /Read ✓✓/);
  assert.match(app, /Submitted ✓/);
  assert.match(app, /Retrying/);
  assert.match(app, /Message status:/);
  assert.match(styles, /\.delivery-status\.is-delivered/);
  assert.match(styles, /\.delivery-status\.is-read/);
});

test("delivery status realtime updates patch only the existing message status", () => {
  const realtimeHandler = app.slice(app.indexOf("async function handleRealtimeEvent"), app.indexOf("function isIosDevice"));
  assert.match(app, /function updateRenderedMessageStatus\(message\)/);
  assert.match(app, /querySelector\("\.delivery-status, \.message-failed"\)/);
  assert.match(realtimeHandler, /if \(!event\.granular\) await reconcileWorkspace\(\)/);
  assert.match(realtimeHandler, /const statusOnly = type === "message\.updated"/);
  assert.match(realtimeHandler, /if \(statusOnly\)[\s\S]*?updateRenderedMessageStatus\(message\);[\s\S]*?return/);
  assert.match(realtimeHandler, /const replyBecameAvailable = Boolean\(existingMessage && !existingMessage\.channelMessageId && message\.channelMessageId\)/);
  assert.match(realtimeHandler, /if \(replyBecameAvailable\) upsertRenderedMessage\(message, conversationId\)/);
  const missingStatusFallback = realtimeHandler.slice(realtimeHandler.indexOf("if (!existingMessage"), realtimeHandler.indexOf("const statusOnly"));
  assert.doesNotMatch(missingStatusFallback, /loadAll\(\)/);
});

test("outbound status reconciliation is monotonic and permits explicit retry transitions", () => {
  const start = app.indexOf("function mergeOutboundMessageStatus");
  const end = app.indexOf("function updateRenderedMessageStatus", start);
  assert.ok(start >= 0 && end > start);
  const { mergeStatus, mergeSnapshots } = Function(`${app.slice(start, end)}\nreturn { mergeStatus: mergeOutboundMessageStatus, mergeSnapshots: mergeMessageSnapshots };`)();
  assert.equal(mergeStatus("submitted", "pending"), "submitted");
  assert.equal(mergeStatus("delivered", "sent"), "delivered");
  assert.equal(mergeStatus("read", "delivered"), "read");
  assert.equal(mergeStatus("pending", "failed"), "failed");
  assert.equal(mergeStatus("failed", "submitted"), "failed");
  assert.equal(mergeStatus("failed", "retrying"), "retrying");
  assert.equal(mergeStatus("retrying", "submitted"), "submitted");
  const merged = mergeSnapshots(
    [{ messageId: "live", direction: "outbound", status: "delivered", channelMessageId: "provider-live" }],
    [{ messageId: "stored", direction: "inbound", status: "received" }, { messageId: "live", direction: "outbound", status: "sent" }],
  );
  assert.deepEqual(merged.map((item) => item.messageId), ["stored", "live"]);
  assert.equal(merged.find((item) => item.messageId === "live").status, "delivered");
  assert.equal(merged.find((item) => item.messageId === "live").channelMessageId, "provider-live");
});

test("desktop Enter sends while mobile Enter and Shift+Enter insert a newline", () => {
  assert.match(html, /<textarea id="messageInput"[^>]*enterkeyhint="enter"/);
  assert.match(html, /<button class="send-button" id="sendButton" type="button"/);
  assert.match(html, /<span class="send-hint" id="sendHint">Use Send to send<\/span>/);
  assert.match(app, /\$\("sendButton"\)\.addEventListener\("click", sendCurrentMessage\)/);
  assert.match(app, /function usesMobileComposerKeyboard\(\)[\s\S]*?userAgentData\?\.mobile[\s\S]*?pointer: coarse/);
  assert.match(app, /function handleComposerKeydown\(event\)[\s\S]*?event\.key !== "Enter" \|\| event\.shiftKey \|\| event\.isComposing \|\| usesMobileComposerKeyboard\(\)[\s\S]*?event\.preventDefault\(\)[\s\S]*?sendCurrentMessage\(\)/);
  assert.match(app, /\$\("messageInput"\)\.addEventListener\("keydown", handleComposerKeydown\)/);
  assert.match(app, /"Enter to send · Shift\+Enter for a new line"/);
});

test("pending and closed status updates clear the selected chat only after the server accepts them", () => {
  const statusHandler = app.slice(app.indexOf('$("conversationStatus").addEventListener'), app.indexOf('$("conversationAssignee").addEventListener'));
  assert.match(statusHandler, /await state\.api\.updateConversation/);
  assert.match(statusHandler, /\["pending", "closed"\]\.includes\(next\)\) clearSelectedConversation\(\)/);
  assert.ok(statusHandler.indexOf("await state.api.updateConversation") < statusHandler.indexOf("clearSelectedConversation()"));
  assert.match(app, /state\.selectedConversationId = null;[\s\S]*?classList\.remove\("chat-open", "has-details"\)/);
  assert.match(app, /event\.conversationId \|\| rawConversation\.conversationId/);
  assert.match(app, /incoming\.conversationId === state\.selectedConversationId[\s\S]*?\["pending", "closed"\]\.includes\(incoming\.status\)[\s\S]*?clearSelectedConversation\(\)/);
});

test("opening a conversation clears its unread badge before the first list render", () => {
  const selectHandler = app.slice(app.indexOf("async function selectConversation"), app.indexOf("function renderSelectedConversation"));
  assert.match(selectHandler, /const shouldMarkRead = markRead && unreadCount > 0/);
  assert.match(selectHandler, /conversation\.unreadCount = 0;[\s\S]*?renderCounts\(\);[\s\S]*?renderConversationList\(\)/);
  assert.ok(selectHandler.indexOf("conversation.unreadCount = 0") < selectHandler.indexOf("renderConversationList()"));
  assert.match(selectHandler, /if \(shouldMarkRead\) \{[\s\S]*?updateConversation\(conversationId, \{ markRead: true \}\)/);
  assert.ok(selectHandler.indexOf("updateConversation(conversationId, { markRead: true })") < selectHandler.indexOf("await state.api.getMessages(conversationId)"));
});

test("opening unread conversations preserves a WhatsApp-style unread divider until the chat changes", () => {
  const selectHandler = app.slice(app.indexOf("async function selectConversation"), app.indexOf("function renderSelectedConversation"));
  const messageRenderer = app.slice(app.indexOf("function renderMessages"), app.indexOf("function isWhatsAppConversation"));
  const clearHandler = app.slice(app.indexOf("function clearSelectedConversation"), app.indexOf("function contactFor"));
  assert.match(app, /unreadMarker:\s*null/);
  assert.match(selectHandler, /const unreadCount = Math\.max\(0, Number\(conversation\.unreadCount\) \|\| 0\)/);
  assert.match(selectHandler, /changingConversation[\s\S]*?state\.unreadMarker = markRead && unreadCount > 0/);
  assert.match(messageRenderer, /marker\.count > inboundIndexes\.length \? 0/);
  assert.match(messageRenderer, /inboundIndexes[\s\S]*?inboundIndexes\.length - marker\.count/);
  assert.match(messageRenderer, /`\$\{marker\.count\} unread message\$\{marker\.count === 1 \? "" : "s"\}`/);
  assert.match(messageRenderer, /element\("div", "unread-divider", label\)/);
  assert.match(clearHandler, /state\.unreadMarker = null/);
  assert.match(styles, /\.unread-divider \{/);
});

test("message history opens at the latest message without an animated top-to-bottom flash", () => {
  const messageRenderer = app.slice(app.indexOf("function renderMessages"), app.indexOf("function isWhatsAppConversation"));
  assert.match(messageRenderer, /host\.scrollTop = stayAtBottom \? host\.scrollHeight/);
  assert.doesNotMatch(messageRenderer, /requestAnimationFrame/);
  assert.match(styles, /\.message-thread \{[^}]*scroll-behavior: auto/);
  assert.doesNotMatch(styles, /\.message-thread \{[^}]*scroll-behavior: smooth/);
});

test("conversation filters are multi-selectable with responsive desktop and mobile controls", () => {
  assert.match(app, /filters:\s*new Set\(\["open"\]\)/);
  assert.match(html, /id="conversationFilterToggle"[^>]*aria-controls="conversationFilterMenu"/);
  assert.match(html, /data-conversation-filter-option[^>]*value="mine"|value="mine"[^>]*data-conversation-filter-option/);
  assert.match(html, /class="filter-chip is-active"[^>]*data-filter="open"/);
  assert.match(app, /const statusFilters = \["open", "closed"\]\.filter/);
  assert.match(app, /const assignmentFilters = \["mine", "unassigned"\]\.filter/);
  assert.match(app, /selected\.has\("unread"\)/);
  assert.match(app, /toggleConversationFilter\(button\.dataset\.filter\)/);
  assert.match(styles, /\.conversation-filter-desktop \{/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.conversation-filter-desktop \{ display: none; \}[\s\S]*?\.filter-row \{ display: flex; \}/);
});

test("the inbox opens on the Open conversation filter without selecting a chat", () => {
  assert.match(app, /filters:\s*new Set\(\["open"\]\)/);
  assert.match(app, /selectedConversationId:\s*null/);
});

test("conversation URLs deep-link safely without auto-selecting plain inbox", () => {
  assert.match(app, /function conversationHash\(conversationId\)/);
  assert.match(app, /`#inbox\/\$\{encodeURIComponent\(conversationId\)\}`/);
  assert.match(app, /function parseAppHash\(value = location\.hash\)/);
  assert.match(app, /\^\[A-Za-z0-9_-\]\{1,100\}\$/);
  assert.match(app, /await applyLocationRoute\(\)/);
  assert.match(app, /selectConversation\(conversationId, \{ updateUrl: false \}\)/);
  assert.match(app, /data: \{ url: conversationUrl\(conversation\.conversationId\)/);
  assert.match(app, /const title = conversation\.subject/);
  assert.match(app, /markRead: false, updateUrl: false/);
  assert.match(app, /clearSelectedConversation\(\{ updateUrl: false \}\);[\s\S]*?replaceAppHash\("#inbox"\)/);
  assert.match(app, /mobileBack[\s\S]*?clearSelectedConversation\(\)/);
});

test("Helixcer mark brands the login, sidebar, and favicon", () => {
  assert.match(html, /rel="icon" href="\.\/assets\/helixcer-mark\.jpg"/);
  assert.match(html, /class="auth-brand-logo" src="\.\/assets\/helixcer-logo\.jpg" alt="Helixcer"/);
  assert.match(html, /class="brand-mark"[^>]*>[\s\S]*?src="\.\/assets\/helixcer-mark\.jpg"/);
});

test("Developer API keys are managed by admins and shown only once", () => {
  assert.match(html, /id="developerApiTitle">Developer API</);
  assert.match(html, /id="developerRoute" data-route-panel="developer"/);
  assert.match(html, /id="apiKeyTableBody"/);
  assert.match(html, /id="apiKeyDialog"/);
  assert.match(html, /id="apiKeyOutput"[^>]*readonly/);
  assert.match(html, /Server-to-server only/);
  assert.match(html, /complete secret is shown once/i);
  assert.match(html, /href="api-docs\.html"/);
  assert.match(app, /request\("\/api\/developer\/api-keys"\)/);
  assert.match(app, /request\("\/api\/developer\/api-keys", \{ method: "POST"/);
  assert.match(app, /`\/api\/developer\/api-keys\/\$\{encodeURIComponent\(apiKeyId\)\}`/);
  assert.match(app, /developer: "Developer API"/);
  assert.doesNotMatch(html, /Allowed WhatsApp connections|apiKeyChannelOptions/);
  assert.doesNotMatch(app, /allowedChannelIds|renderApiKeyChannelOptions/);
  const developerRoute = html.match(/<section class="route content-route" id="developerRoute"[\s\S]*?<\/section>\s*<section class="route content-route" id="teamRoute"/)?.[0] || "";
  const apiKeyDialog = html.match(/<dialog class="modal" id="apiKeyDialog"[\s\S]*?<\/dialog>/)?.[0] || "";
  assert.doesNotMatch(developerRoute, /WhatsApp/i);
  assert.doesNotMatch(apiKeyDialog, /WhatsApp/i);
  assert.match(app, /\$\("apiKeyOutput"\)\.value = ""/);
  assert.doesNotMatch(app, /localStorage\.(?:setItem|getItem)\([^)]*api.?key/i);
});

test("destructive workspace actions use one in-app confirmation dialog", () => {
  assert.match(html, /id="confirmationDialog"[^>]*aria-labelledby="confirmationTitle"/);
  assert.match(html, /id="confirmationForm"/);
  assert.match(html, /class="conversation-menu-wrap"[^>]*data-admin-only/);
  assert.match(html, /id="conversationMenuButton"[^>]*aria-controls="conversationActionMenu"/);
  assert.match(html, /id="conversationActionMenu"[^>]*role="menu"[^>]*hidden/);
  assert.match(html, /data-action="delete-conversation"/);
  assert.match(html, /id="contactDeleteButton"[^>]*data-action="delete-contact"/);
  assert.match(html, /id="channelDeleteButton"[^>]*data-action="delete-channel"[^>]*hidden/);
  assert.match(app, /function requestConfirmation\(/);
  assert.match(app, /function finishConfirmation\(/);
  assert.doesNotMatch(app, /window\.confirm\s*\(/);
  assert.match(app, /deleteConversation\(conversationId\)[\s\S]*?method: "DELETE"/);
  assert.match(app, /deleteContact\(contactId\)[\s\S]*?method: "DELETE"/);
  assert.match(app, /deleteChannel\(channelId\)[\s\S]*?method: "DELETE"/);
  assert.match(app, /deleteApiKey\(apiKeyId\)[\s\S]*?method: "DELETE"/);
  assert.match(app, /deleteMember\(membershipId\)[\s\S]*?method: "DELETE"/);
  assert.match(app, /Only Helixcer data will be deleted\.[\s\S]*?provider-side message history will not be changed/);
  assert.match(app, /clearSelectedConversation\(\);[\s\S]*?Conversation deleted/);
  assert.match(app, /type === "conversation\.deleted"[\s\S]*?state\.conversations = state\.conversations\.filter/);
  assert.match(app, /type === "contact\.deleted"[\s\S]*?state\.contacts = state\.contacts\.filter/);
  assert.match(app, /data\.deleteMember|dataset\.deleteMember/);
  assert.match(styles, /\.conversation-action-menu\s*\{/);
  assert.match(styles, /\.danger-button\s*\{/);
  assert.match(styles, /\.confirmation-modal\s*\{/);
});

test("Developer API documentation is channel-organized and keeps the send contract complete", () => {
  assert.match(apiDocs, /<h1>Connect your apps to the Helixcer inbox\.<\/h1>/);
  assert.doesNotMatch(apiDocs, /<h1>[^<]*WhatsApp/i);
  assert.match(apiDocs, /<p class="nav-label">Channels<\/p>[\s\S]*?<p class="nav-channel">WhatsApp<\/p>[\s\S]*?<a href="#send">Template messages<\/a>/);
  const sendSection = apiDocs.match(/<section id="send">[\s\S]*?<\/section>/)?.[0] || "";
  assert.match(sendSection, /<h2>Send a template message<\/h2>/);
  assert.match(sendSection, /POST<\/span><code>https:\/\/api\.chat\.helixcer\.com\/api\/v1\/whatsapp\/template-messages<\/code>/);
  assert.match(apiDocs, /X-Workspace-Id: b0963871-a454-4fb8-94eb-80464e2358b0/);
  assert.match(sendSection, /<code>contact\.displayName<\/code>[\s\S]*?Name used to save or update to the contact list/);
  assert.doesNotMatch(apiDocs, /Idempotency-Key|id="idempotency"|href="#idempotency"/i);
  assert.match(apiDocs, /"status": true/);
  assert.match(apiDocs, /"messageStatus": "pending"/);
  assert.match(apiDocs, /"messageStatus": "delivered"/);
  assert.match(apiDocs, /"channelMessageId": ""/);
  assert.match(apiDocs, /"channelMessageId": "wamid\./);
  assert.doesNotMatch(apiDocs, /"providerMessageId"/);
  assert.match(apiDocs, /"status": false/);
  assert.match(apiDocs, /status<\/code> reports whether the API request succeeded/);
  assert.doesNotMatch(apiDocs, /"ok": (?:true|false)/);
});

test("WhatsApp credential guidance distinguishes the three Meta secrets", () => {
  assert.match(html, /Paste only the token value from WhatsApp → API setup/);
  assert.match(html, /App settings → Basic → App secret/);
  assert.match(html, /not the Client Token/);
  assert.match(html, /Messaging account ID in Meta/);
  assert.match(html, /Shown directly below the selected From number/);
  assert.match(html, /After saving, copy the new token beside the callback URL/);
});

test("modal errors render inside the open dialog where the top layer cannot hide them", () => {
  assert.match(app, /document\.querySelector\("dialog\[open\]"\)/);
  assert.match(app, /modalCard\.prepend\(region\)/);
  assert.match(app, /region\.classList\.add\("is-modal-toast"\)/);
  assert.match(app, /toast\.setAttribute\("role", isError \? "alert" : "status"\)/);
  assert.match(app, /isError \? 12000 : 4500/);
});
