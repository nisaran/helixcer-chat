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
  assert.match(html, /id="contactCreatePlatformIds"/);
  assert.doesNotMatch(html, /data-action="add-contact-create-identity"/);
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
  assert.match(app, /function identityChannels\(platform, bindings = \[\]\)/);
  assert.match(app, /connectorPlatform\(channel\.connectorType\) === platform/);
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
  assert.doesNotMatch(html, /id="replyWindowNotice"|The 24-hour WhatsApp reply window is closed/);
  assert.match(html, /id="attachmentInput" type="file" multiple/);
  assert.match(html, /id="templateDialog"/);
  assert.match(app, /freeformAllowed/);
  assert.match(app, /\/api\/conversations\/\$\{encodeURIComponent\(conversationId\)\}\/templates/);
  assert.match(app, /\/api\/conversations\/\$\{encodeURIComponent\(conversationId\)\}\/template/);
  assert.match(app, /\/api\/conversations\/\$\{encodeURIComponent\(conversationId\)\}\/attachments/);
  assert.match(app, /The customer has not messaged on WhatsApp in the last 24 hours\. You can only send approved WhatsApp message templates"/);
  assert.match(app, /: "Message\.\.\."/);
  assert.match(html, /placeholder="Message\.\.\."/);
  assert.match(styles, /\.composer\.is-window-closed textarea::placeholder\s*\{[^}]*color:\s*#9a4f12[^}]*opacity:\s*1/);
  assert.match(styles, /\.composer\.is-window-closed \.composer-box[\s\S]*border-color:\s*#e7b67c;[^}]*background:\s*#f6f7f9;[^}]*box-shadow:\s*none/);
  assert.match(styles, /\.composer\.is-window-closed textarea\s*\{[^}]*background:\s*#f6f7f9/);
  assert.match(html, /id="templateSelect"/);
  assert.match(html, /id="templateVariableFields"/);
  assert.match(app, /parameter_name/);
  assert.match(app, /sub_type: descriptor\.subType/);
  assert.match(app, /\[descriptor\.mediaType\]: \{ link: value \}/);
  assert.match(app, /\[descriptor\.mediaType\]: \{ id: uploaded\.mediaId \}/);
  assert.match(app, /const request = \{ name, language: \{ code: languageCode \}, previewText \}/);
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
  assert.match(app, /const lastMessageType = String\(raw\.lastMessageType \|\| lastMessageObject\?\.messageType \|\| lastMessageObject\?\.attachment\?\.type \|\| ""\)/);
  assert.match(app, /function messagePlainText\(message, conversation\)/);
  assert.match(app, /Reply to \$\{messagePlainText\(message, conversation\)\}/);
  assert.match(app, /body: channelPlainText\(message\.text, conversation\)/);
  assert.match(app, /conversation\.lastMessageType = "template"/);
  assert.match(app, /conversation\.lastMessageType = String\(message\.messageType \|\| "text"\)/);
  const messageRenderer = app.slice(app.indexOf("function appendWhatsAppFormattedText"), app.indexOf("function messageThreadNearBottom"));
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

test("reconnect reconciliation expires stale histories and marks only an actively viewed chat read", () => {
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
  assert.match(reconcile, /selectedConversation\.unreadCount > 0 &&[\s\S]*?isConversationActivelyViewed\(activeSelectedId\)/);
  assert.match(reconcile, /if \(shouldMarkRead\) selectedConversation\.unreadCount = 0/);
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

test("background, unfocused, hidden-route, and contact-detail chats cannot acknowledge inbound messages", () => {
  const helperStart = app.indexOf("function isConversationActivelyViewed");
  const helperEnd = app.indexOf("function closeConversationActionMenu", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const source = app.slice(helperStart, helperEnd);
  const evaluate = ({ route = "inbox", selected = "chat-1", detailsOpen = false, visibility = "visible", focused = true } = {}) => {
    const state = { route, selectedConversationId: selected, detailsOpen, conversations: [] };
    const document = { visibilityState: visibility, hasFocus: () => focused };
    return Function("state", "document", `${source}\nreturn isConversationActivelyViewed;`)(state, document)("chat-1");
  };
  assert.equal(evaluate(), true);
  assert.equal(evaluate({ visibility: "hidden" }), false);
  assert.equal(evaluate({ focused: false }), false);
  assert.equal(evaluate({ route: "contacts" }), false);
  assert.equal(evaluate({ detailsOpen: true }), false);
  assert.equal(evaluate({ selected: "chat-2" }), false);

  const realtimeHandler = app.slice(app.indexOf("async function handleRealtimeEvent"), app.indexOf("function isIosDevice"));
  assert.match(realtimeHandler, /if \(isConversationActivelyViewed\(conversationId\)\)[\s\S]*?markRead: true/);
  assert.doesNotMatch(realtimeHandler, /if \(conversationId === state\.selectedConversationId\) \{\s*conversation\.unreadCount = 0/);
  assert.match(app, /window\.addEventListener\("focus", resumeLiveWorkspace\)/);
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

test("the unified inbox is person-first while route identity stays on messages and the composer", () => {
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
  assert.match(html, /id="chatChannelProfileId"[^>]*hidden/);
  assert.match(html, /id="chatChannelBadge"[^>]*hidden/);
  assert.match(html, /class="chat-contact-card"[^>]*data-action="toggle-details"/);
  assert.match(html, /id="composerRouteButton"[^>]*data-action="toggle-composer-route-menu"/);
  assert.match(html, /id="composerRouteName"/);
  assert.match(html, /id="composerRouteMenu"[^>]*role="menu"/);
  assert.match(styles, /\.chat-contact-card\s*\{/);
  assert.match(styles, /\.message-route-meta\s*\{/);
  assert.match(styles, /\.composer-route-menu\s*\{/);
  assert.match(styles, /\.template-button\s*\{[^}]*height:\s*34px;[^}]*min-height:\s*34px/);
  assert.match(styles, /\.composer-route-button\s*\{[^}]*height:\s*34px/);
  assert.match(app, /function unifiedConversations\(\)/);
  assert.match(app, /const key = conversation\.contactId \|\| `conversation:/);
  assert.match(app, /routeMeta\.append\(providerLogo\(route\.connectorType, "message-route-logo"\)\)/);
  assert.match(app, /routeMeta\.append\(element\("span", "", route\.channelName \|\| "Channel"\)\)/);
  const messageRowBody = app.slice(app.indexOf("function createMessageRow"), app.indexOf("function messageThreadNearBottom"));
  assert.doesNotMatch(messageRowBody, /route\.channelProfileId/);
  const composerRouteBody = app.slice(app.indexOf("function renderComposerRouteControl"), app.indexOf("function renderComposerState"));
  assert.match(composerRouteBody, /name\.textContent = selectedRoute\?\.channelName \|\| ""/);
  assert.match(composerRouteBody, /copy\.append\(element\("strong", "", route\.channelName \|\| "Channel"\)\)/);
  assert.match(composerRouteBody, /`Sending channel: \$\{selectedRoute\.channelName \|\| "Channel"\}`/);
  assert.doesNotMatch(composerRouteBody, /channelProfileId|No profile ID/);
  const conversationsStart = app.indexOf("function renderConversationList()");
  const conversationsEnd = app.indexOf("async function selectConversation", conversationsStart);
  const renderConversationsBody = app.slice(conversationsStart, conversationsEnd);
  assert.doesNotMatch(renderConversationsBody, /providerLogo|providerLogoPaths|channel-mini/);
  assert.match(renderConversationsBody, /conversation-time/);
  assert.match(renderConversationsBody, /unread-badge/);
  const contactsStart = app.indexOf("function renderContacts()");
  const contactsEnd = app.indexOf("function contactPlatformRoutes", contactsStart);
  const renderContactsBody = app.slice(contactsStart, contactsEnd);
  assert.match(renderContactsBody, /messaging ID/);
  assert.doesNotMatch(renderContactsBody, /providerLogo|providerLogoPaths|provider-(?:whatsapp|telegram|instagram)\.svg/);
});

test("conversation routes drive replies, templates, media, and every outbound API request", () => {
  assert.match(app, /composerRoutes: new Map\(\)/);
  assert.match(app, /function conversationRoutes\(conversation\)/);
  assert.match(app, /function defaultConversationRoute\(conversation\)/);
  assert.match(app, /sort\(\(a, b\) => new Date\(b\.lastInboundAt \|\| 0\) - new Date\(a\.lastInboundAt \|\| 0\)\)/);
  assert.match(app, /function selectedComposerRoute\(conversation = selectedConversation\(\)\)[\s\S]*?messageRoute\(replyMessage, conversation\)/);
  assert.match(app, /function promoteInboundConversationRoute\(conversation, message\)[\s\S]*?conversation\.defaultRoute = inboundRoute/);
  assert.match(app, /message\.direction === "inbound"[\s\S]*?promoteInboundConversationRoute\(conversation, message\)/);
  assert.match(app, /dataset\.action = "choose-composer-route"/);
  assert.match(app, /state\.api\.sendMessage\(conversation\.conversationId, text, replyToMessageId, route \|\| \{\}\)/);
  assert.match(app, /state\.api\.sendTemplate\(conversation\.conversationId, request, route \|\| \{\}\)/);
  assert.match(app, /formData\.append\("channelId", route\.channelId\)/);
  assert.match(app, /formData\.append\("identityId", route\.identityId\)/);
  assert.match(app, /getTemplates\(conversationId, route = \{\}\)[\s\S]*?query\.set\("channelId", route\.channelId\)[\s\S]*?query\.set\("identityId", route\.identityId\)/);
  assert.match(app, /function whatsappReplyWindow\(conversation = selectedConversation\(\), route = selectedComposerRoute\(conversation\)\)/);
  assert.match(app, /function selectRequestedComposerRoute\(conversationId, requestedRoute\)/);
  assert.match(app, /state\.composerRoutes\.set\(conversationId, conversationRouteKey\(selected\)\)/);
  assert.match(app, /The customer has not messaged on WhatsApp in the last 24 hours\. You can only send approved WhatsApp message templates"/);
  assert.doesNotMatch(app, /replyWindowNotice|replyWindowMessage/);
});

test("contacts use one flat ID per platform and open the exact saved channel route", () => {
  assert.match(html, /id="contactsWorkspace"/);
  assert.match(html, /id="contactEditor"/);
  assert.match(html, /id="contactEditName"/);
  assert.match(html, /id="contactEditPlatformIds"/);
  assert.match(html, /id="contactCreatePlatformIds"/);
  assert.doesNotMatch(html, /id="contactEditPlatformSelect"|<select[^>]+Platform to add/);
  assert.match(html, /id="contactEditPlatformAddButton"[^>]*data-action="toggle-contact-platform-menu"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/);
  assert.doesNotMatch(html, /Add identity|add-contact-(?:create|edit)-identity/);
  assert.doesNotMatch(html, /id="contactPlatformActions"|Open a conversation/);
  assert.doesNotMatch(html, /id="contactRouteDialog"|contact-route-modal/);
  assert.doesNotMatch(html, /id="contactEditChannel(?:Help|ProfileId)?"/);
  assert.match(html, /id="contactEditCompany"/);
  assert.match(html, /id="contactEditTags"/);
  assert.match(app, /request\(`\/api\/contacts\/\$\{encodeURIComponent\(contactId\)\}`\)/);
  assert.match(app, /request\(`\/api\/contacts\/\$\{encodeURIComponent\(contactId\)\}`, \{ method: "PATCH"/);
  assert.match(app, /whatsapp: \{ label: "WhatsApp", profileLabel: "WhatsApp ID", profilePlaceholder: "Phone number or WhatsApp username" \}/);
  assert.match(app, /telegram: \{ label: "Telegram", profileLabel: "Telegram ID"/);
  assert.match(app, /instagram: \{ label: "Instagram", profileLabel: "Instagram ID"/);
  assert.match(app, /facebook: \{ label: "Facebook", profileLabel: "Facebook ID"/);
  assert.match(app, /email: \{ label: "Email", profileLabel: "Email Address"/);
  const platformEditorBody = app.slice(
    app.indexOf("function renderContactPlatformIdFields"),
    app.indexOf("function contactIdentityDraftContext"),
  );
  assert.match(platformEditorBody, /Object\.entries\(identityPlatforms\)/);
  assert.match(platformEditorBody, /mode !== "edit" \|\| Boolean\(ids\[platform\]\) \|\| visiblePlatforms\.has\(platform\)/);
  assert.match(platformEditorBody, /dataset\.contactPlatformId = platform/);
  assert.match(platformEditorBody, /contact-platform-id-row/);
  assert.match(platformEditorBody, /dataset\.action = "open-contact-identity-default"/);
  assert.match(platformEditorBody, /dataset\.action = "choose-contact-identity-route"/);
  assert.doesNotMatch(platformEditorBody, /identity-platform-options|identityUsername|identityDisplayName|Username|Display name/);
  assert.match(app, /function identityHasHistory\(identity\)/);
  assert.match(platformEditorBody, /identityHasHistory\(identity\)/);
  assert.match(platformEditorBody, /Used by conversation history · locked/);
  assert.match(app, /function refreshContactPlatformAddControl\(\)/);
  assert.match(app, /filter\(\(\[platform\]\) => !shownPlatforms\.has\(platform\)\)/);
  assert.match(app, /function addContactPlatformId\(value\)/);
  assert.match(app, /visibleContactPlatformIdDraft\(host\)/);
  assert.match(app, /function showContactPlatformMenu\(trigger\)/);
  assert.match(app, /missingContactPlatforms\(\)/);
  assert.match(app, /providerLogo\(platformConnectorType\(platform\), "contact-route-provider-logo"\)/);
  assert.match(app, /profile\.profileLabel/);
  assert.match(app, /dataset\.action = "choose-contact-platform-id"/);
  assert.match(app, /showContactPlatformMenu\(actionButton\)/);
  assert.match(app, /addContactPlatformId\(actionButton\.dataset\.platform\)/);
  assert.match(app, /closeContactPlatformMenu\(\{ restoreFocus: true \}\)/);
  const platformMenuBody = app.slice(app.indexOf("function showContactPlatformMenu"),
    app.indexOf("function contactIdentityRouteContext"));
  assert.match(platformMenuBody, /document\.body\.append\(menu\)/);
  assert.match(platformMenuBody, /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"/);
  assert.match(platformMenuBody, /event\.key === "Escape"/);
  assert.match(app, /!state\.contactPlatformMenu\.menu\.contains\(event\.target\)/);
  assert.match(styles, /\.contact-platform-menu-add/);
  assert.match(app, /function validateContactPlatformIds\(ids\)/);
  assert.match(app, /Enter at least one WhatsApp, Telegram, Instagram, Facebook or Email ID/);
  assert.match(app, /row\.dataset\.contactId = contact\.contactId/);
  const saveContactBody = app.match(/async function saveContactEdits\(form\) \{([\s\S]*?)\n  \}/)?.[1] || "";
  assert.match(saveContactBody, /payload\.platformIds = platformIds/);
  assert.doesNotMatch(saveContactBody, /payload\.identities/);
  assert.match(app, /type === "contact\.updated"[\s\S]*?await reconcileWorkspace\(\)[\s\S]*?await selectContact/);
  assert.match(app, /JSON\.stringify\(\{ contactId, identityId, \.\.\.payload \}\)/);
  assert.match(app, /conversation\.channelId === channelId/);
  assert.match(app, /channelProfileId: binding\?\.scopedProfileId \|\| identity\.profileId/);
  assert.match(app, /"Default · Last used"/);
  assert.match(app, /`Last used \$\{relativeTime\(route\.lastUsedAt\)\}`/);
  const platformRoutesBody = app.slice(app.indexOf("function contactPlatformRoutes"),
    app.indexOf("async function openContactRoute"));
  assert.match(platformRoutesBody, /!identityId \|\| identity\.identityId === identityId/);
  assert.match(platformRoutesBody, /bindingByChannel\.has\(channel\.channelId\) \|\|\s*\(channel\.enabled !== false && channel\.health === "connected"\)/);
  assert.match(platformRoutesBody, /isBound: Boolean\(binding\)/);
  assert.match(platformRoutesBody, /Number\(b\.isBound\) - Number\(a\.isBound\)/);
  assert.match(app, /route\.isBound \? "Available" : "New"/);
  const openRouteBody = app.slice(app.indexOf("async function openContactRoute"),
    app.indexOf("function closeContactRouteMenu"));
  assert.match(openRouteBody, /route\.channelId \? \{ channelId: route\.channelId \} : \{\}/);
  assert.match(openRouteBody, /selectRequestedComposerRoute\(route\.conversationId, route\)/);
  assert.match(openRouteBody, /selectRequestedComposerRoute\(conversationId, route\)/);
  assert.match(app, /function openContactIdentityDefault\(contactId, identityId\)/);
  assert.match(app, /function chooseContactIdentityRoute\(contactId, identityId, trigger\)/);
  assert.match(app, /context\.routes\.find\(\(item\) => item\.eligible\)/);
  assert.match(app, /const eligibleRoutes = context\.routes\.filter\(\(route\) => route\.eligible\)/);
  assert.match(app, /showContactRouteMenu\(trigger, context\.contact, context\.identity\.platform, eligibleRoutes\)/);
  assert.match(app, /setAttribute\("aria-haspopup", "menu"\)/);
  assert.match(app, /setAttribute\("aria-expanded", "false"\)/);
  assert.match(app, /document\.body\.append\(menu\)/);
  assert.match(app, /providerLogo\(route\.connectorType, "contact-route-provider-logo"\)/);
  assert.match(app, /route\.scopedProfileId \|\| route\.profileId/);
  assert.match(app, /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(app, /!state\.contactRouteMenu\.menu\.contains\(event\.target\)/);
  assert.match(styles, /\.contact-route-menu \{ position: fixed; z-index: 90;/);
  assert.match(styles, /\.contact-route-menu-option \{ display: grid;/);
  assert.match(styles, /\.contact-route-provider-logo/);
  const createContactBody = app.match(/async function createContact\(form\) \{([\s\S]*?)\n  \}/)?.[1] || "";
  assert.match(createContactBody, /platformIds/);
  assert.doesNotMatch(createContactBody, /channelId\s*:|channelProfileId\s*:/);
  assert.match(createContactBody, /setRoute\("contacts"\);[\s\S]*?closeContactEditor\(\)/);
  assert.doesNotMatch(createContactBody, /selectContact\(/);
  assert.match(html, /data-action="export-contacts"/);
  assert.match(app, /\/api\/contacts\/export\.csv/);
  assert.match(app, /"WhatsApp ID", "Telegram ID", "Instagram ID", "Facebook ID", "Email ID"/);
  assert.match(app, /Each contact is one CSV row with a separate column for every platform ID/);
});

test("conversation and contact lists provide compact press feedback and breathing room", () => {
  assert.match(styles, /\.conversation-item\s*\{[^}]*min-height:\s*72px[^}]*padding:\s*15px 14px/s);
  assert.match(styles, /\.conversation-item:active\s*\{[^}]*background:\s*#edf0ed/s);
  assert.match(styles, /\.contact-table td\s*\{[^}]*padding:\s*15px 17px/s);
  assert.match(styles, /\.contact-table tbody tr:active\s*\{[^}]*background:\s*#edf0ed/s);
});

test("every message carries an exact local date and time without date-divider pills", () => {
  assert.doesNotMatch(html, /date-divider/);
  assert.doesNotMatch(styles, /\.date-divider/);
  assert.doesNotMatch(app, /element\("div", "date-divider"/);
  assert.match(styles, /\.message-foot time\s*\{\s*font-size:\s*9px/);
  const start = app.indexOf("function formatClock");
  const end = app.indexOf("function formatCalendarDate", start);
  const formatClock = Function(`${app.slice(start, end)}\nreturn formatClock;`)();
  const currentYear = new Date().getFullYear();
  assert.equal(formatClock(new Date(currentYear, 9, 27, 7, 5)), "27 Oct · 07:05 am");
  assert.equal(formatClock(new Date(currentYear - 2, 9, 27, 19, 5)), `27 Oct ${currentYear - 2} · 07:05 pm`);
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
  assert.match(selectHandler, /const shouldMarkRead = markRead && unreadCount > 0 && isConversationActivelyViewed\(conversationId\)/);
  assert.match(selectHandler, /conversation\.unreadCount = 0;[\s\S]*?renderCounts\(\);[\s\S]*?renderConversationList\(\)/);
  assert.ok(selectHandler.indexOf("conversation.unreadCount = 0") < selectHandler.indexOf("renderConversationList()"));
  assert.match(selectHandler, /if \(shouldMarkRead\) \{[\s\S]*?updateConversation\(conversationId, \{ markRead: true \}\)/);
  assert.ok(selectHandler.indexOf("updateConversation(conversationId, { markRead: true })") < selectHandler.indexOf("await state.api.getMessages(conversationId)"));
});

test("opening unread conversations preserves a WhatsApp-style unread divider until the chat changes or an outbound message is sent", () => {
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
  const clearAfterOutbound = app.slice(app.indexOf("function clearUnreadMarkerAfterOutbound"), app.indexOf("function upsertRenderedMessage"));
  assert.match(clearAfterOutbound, /message\?\.direction !== "outbound"/);
  assert.match(clearAfterOutbound, /state\.unreadMarker = null/);
  assert.match(clearAfterOutbound, /querySelector\("\.unread-divider"\)\?\.remove\(\)/);
  assert.match(app, /clearUnreadMarkerAfterOutbound\(message, conversationId\)/);
  const sendText = app.slice(app.indexOf("async function sendCurrentMessage"), app.indexOf("function templatePlaceholders"));
  const sendTemplate = app.slice(app.indexOf("async function sendCurrentTemplate"), app.indexOf("function attachmentSizeLimit"));
  const sendAttachments = app.slice(app.indexOf("async function sendQueuedAttachments"), app.indexOf("async function uploadCurrentAttachment"));
  [sendText, sendTemplate, sendAttachments].forEach((handler) => {
    assert.match(handler, /clearUnreadMarkerAfterOutbound\(\{ direction: "outbound" \}, conversation\.conversationId\)/);
  });
  assert.match(styles, /\.unread-divider \{/);
});

test("the chat header shows a live WhatsApp reply-window countdown only for inbound WhatsApp routes", () => {
  assert.match(html, /id="whatsappReplyCountdown"[^>]*role="timer"[^>]*hidden/);
  assert.match(html, /assets\/whatsapp-window-timer\.png/);
  assert.match(html, /id="whatsappReplyCountdownText"/);
  assert.match(styles, /\.whatsapp-reply-countdown\s*\{/);
  assert.match(styles, /\.whatsapp-reply-countdown img\s*\{/);
  assert.match(styles, /\.whatsapp-reply-countdown\s*\{[^}]*height:\s*31px;[^}]*font:\s*750 12px\/1/);
  assert.match(styles, /\.whatsapp-reply-countdown img\s*\{[^}]*width:\s*19px;[^}]*height:\s*19px/);
  assert.match(styles, /\.whatsapp-reply-countdown\[hidden\]\s*\{\s*display:\s*none/);

  const formatterStart = app.indexOf("function replyWindowCountdownText");
  const formatterEnd = app.indexOf("function latestInboundWhatsAppReplyWindow", formatterStart);
  const { replyWindowCountdownText } = Function(`${app.slice(formatterStart, formatterEnd)}\nreturn { replyWindowCountdownText };`)();
  const now = Date.parse("2026-10-29T00:00:00.000Z");
  assert.equal(replyWindowCountdownText(new Date(now + ((18 * 3600 + 45 * 60 + 23) * 1000)).toISOString(), now), "18:45:23");
  assert.equal(replyWindowCountdownText(new Date(now - 1000).toISOString(), now), "00:00:00");
  assert.equal(replyWindowCountdownText("not-a-date", now), "");

  const resolver = app.slice(app.indexOf("function latestInboundWhatsAppReplyWindow"), app.indexOf("function stopWhatsAppReplyCountdown"));
  assert.match(resolver, /conversationRoutes\(conversation\)\.filter\(isWhatsAppRoute\)/);
  assert.match(resolver, /message\.direction !== "inbound"/);
  assert.match(resolver, /route\.replyWindowExpiresAt/);
  assert.match(resolver, /inboundAt \+ WHATSAPP_REPLY_WINDOW_MS/);

  const timer = app.slice(app.indexOf("function stopWhatsAppReplyCountdown"), app.indexOf("function closeComposerRouteMenu"));
  assert.match(timer, /clearInterval\(whatsappReplyCountdownTimer\)/);
  assert.match(timer, /conversation\.conversationId}:\$\{windowState\.routeKey}:\$\{windowState\.expiresAt}/);
  assert.match(timer, /setInterval\(update, 1000\)/);
  assert.match(timer, /textHost\.textContent = remaining \|\| "00:00:00"/);
  assert.match(timer, /stopWhatsAppReplyCountdown\(\{ hide: true \}\)/);
  assert.doesNotMatch(timer, /renderSelectedConversation|renderMessages|renderComposerState/);
  assert.match(app, /renderAttachmentQueue\(\);\s*syncWhatsAppReplyCountdown\(conversation\);/);
});

test("new inbound messages below the viewport are counted on a jump-to-latest control", () => {
  assert.match(html, /id="messageJumpButton"[^>]*aria-label="Jump to latest message"[^>]*hidden/);
  assert.match(html, /id="messageJumpCount"[^>]*hidden/);
  assert.match(app, /newMessagesBelow:\s*\{\s*conversationId:\s*"",\s*count:\s*0\s*\}/);
  const upsert = app.slice(app.indexOf("function upsertRenderedMessage"), app.indexOf("function renderMessages"));
  assert.match(upsert, /const existing = host\.querySelector/);
  assert.match(upsert, /const isNewInbound = !existing && message\.direction === "inbound"/);
  assert.match(upsert, /if \(!stayAtBottom && isNewInbound\)/);
  assert.match(upsert, /count: previousCount \+ 1/);
  assert.match(app, /messageThread\.addEventListener\("scroll"[\s\S]*?messageThreadNearBottom[\s\S]*?resetNewMessagesBelow/);
  assert.match(app, /\$\("messageJumpButton"\)\.addEventListener\("click"[\s\S]*?scrollTop = messageThread\.scrollHeight[\s\S]*?resetNewMessagesBelow/);
  assert.match(styles, /\.message-jump-count\s*\{/);
  assert.match(styles, /\.message-jump-button\[hidden\]\s*\{\s*display:\s*none/);
});

test("attachment-only conversation previews use a human media type", () => {
  const start = app.indexOf("function attachmentPreviewLabel");
  const end = app.indexOf("function appendWhatsAppFormattedText", start);
  const helpers = Function(`${app.slice(start, end)}\nreturn { attachmentPreviewLabel, conversationMessagePreview };`)();
  assert.equal(helpers.conversationMessagePreview({ messageType: "image", attachment: { type: "image" } }), "Image");
  assert.equal(helpers.conversationMessagePreview({ messageType: "document", attachment: { mimeType: "application/pdf" } }), "Document");
  assert.equal(helpers.conversationMessagePreview({ messageType: "audio", attachment: { type: "voice" } }), "Audio");
  assert.equal(helpers.conversationMessagePreview({ messageType: "video", attachment: { type: "video" } }), "Video");
  assert.equal(helpers.conversationMessagePreview({ messageType: "video", attachment: { mimeType: "video\/mpeg" } }), "Video");
  assert.equal(helpers.conversationMessagePreview({ messageType: "file", attachment: { filename: "archive.bin" } }), "File");
  assert.equal(helpers.conversationMessagePreview({ messageType: "image", text: "[WhatsApp image received]", attachment: { type: "image" } }), "Image");
  assert.match(app, /conversation\.lastMessage = conversationMessagePreview\(message\)/);
  assert.match(app, /return channelPlainText\(lines\.join\("\\n"\)\.trim\(\), conversation\) \|\| attachmentPreviewLabel\(messageType\)/);
});

test("message history opens at the latest message without an animated top-to-bottom flash", () => {
  const messageRenderer = app.slice(app.indexOf("function renderMessages"), app.indexOf("function isWhatsAppConversation"));
  assert.match(messageRenderer, /host\.scrollTop = stayAtBottom \? host\.scrollHeight/);
  assert.doesNotMatch(messageRenderer, /requestAnimationFrame/);
  assert.match(styles, /\.message-thread \{[^}]*scroll-behavior: auto/);
  assert.doesNotMatch(styles, /\.message-thread \{[^}]*scroll-behavior: smooth/);
});

test("desktop and mobile chats share the Android light chat palette", () => {
  const rootTheme = styles.match(/:root\s*\{[\s\S]*?\}/)?.[0] || "";
  assert.match(rootTheme, /--chat-canvas:\s*#efeae2\s*;/i);
  assert.match(rootTheme, /--chat-incoming:\s*#fff(?:fff)?\s*;/i);
  assert.match(rootTheme, /--chat-outgoing:\s*#d9fdd3\s*;/i);

  assert.match(styles, /\.chat-panel\s*\{[^}]*background:\s*var\(--chat-canvas\)/i);
  assert.match(styles, /\.message-bubble\s*\{[^}]*background:\s*var\(--chat-incoming\)/i);
  assert.match(styles, /\.message-row\.is-outbound \.message-bubble\s*\{[^}]*background:\s*var\(--chat-outgoing\)/i);

  const mobileStart = styles.indexOf("@media (max-width: 640px)");
  const mobileEnd = styles.indexOf("@media (prefers-reduced-motion: reduce)", mobileStart);
  const mobileStyles = styles.slice(mobileStart, mobileEnd);
  assert.ok(mobileStart >= 0, "the mobile chat breakpoint must remain present");
  assert.match(mobileStyles, /\.message-stack\s*\{[^}]*max-width:\s*86%/i);
  assert.match(mobileStyles, /\.message-bubble\s*\{[^}]*max-width:\s*100%/i);
  assert.doesNotMatch(mobileStyles, /\.message-bubble\s*\{[^}]*(?:background|background-color)\s*:/i);
  assert.doesNotMatch(mobileStyles, /\.chat-panel\s*\{[^}]*(?:background|background-color)\s*:/i);
});

test("chat history fills the available viewport without covering the composer", () => {
  assert.match(styles, /\.app-shell\s*\{[^}]*height:\s*100dvh[^}]*overflow:\s*hidden/i);
  assert.match(styles, /\.main\s*\{[^}]*grid-template-rows:\s*50px minmax\(0, 1fr\)[^}]*height:\s*100%[^}]*overflow:\s*hidden/i);
  assert.match(styles, /\.route\s*\{[^}]*height:\s*100%[^}]*overflow:\s*hidden/i);
  assert.match(styles, /\.inbox-grid\s*\{[^}]*height:\s*100%[^}]*overflow:\s*hidden/i);
  assert.match(styles, /\.chat-content\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto auto auto[^}]*height:\s*100%[^}]*overflow:\s*hidden/i);
  assert.match(styles, /\.chat-header\s*\{[^}]*min-height:\s*52px[^}]*padding:\s*5px 12px/i);
  assert.match(styles, /\.chat-title\s*\{[^}]*font:\s*720 14px\/1\.2/i);
  assert.match(styles, /\.message-thread\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto[^}]*overscroll-behavior:\s*contain/i);
  assert.match(styles, /\.composer\s*\{[^}]*padding:[^;}]*env\(safe-area-inset-bottom\)/i);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.main\s*\{\s*grid-template-rows:\s*56px minmax\(0, 1fr\)[\s\S]*?\.chat-header\s*\{\s*min-height:\s*56px;\s*padding:\s*5px 8px[\s\S]*?\.chat-title\s*\{\s*font-size:\s*16px/i);
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
  assert.match(html, /rel="icon" href="\.\/assets\/helixcer-mark\.jpg\?v=fc5bb333"/);
  assert.match(html, /class="auth-brand-logo" src="\.\/assets\/helixcer-logo\.jpg" alt="Helixcer"/);
  assert.match(html, /class="brand-mark"[^>]*>[\s\S]*?src="\.\/assets\/helixcer-mark\.jpg\?v=fc5bb333"/);
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
