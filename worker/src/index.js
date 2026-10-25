import {
  authenticateRequest,
  createInvitation,
  DEFAULT_WORKSPACE_ID,
  finishGoogleOAuthResponse,
  listTeam,
  logout,
  principalView,
  requireRole,
  startGoogleOAuth,
  updateInvitation,
  updateMembership
} from './auth.js';
import {
  pushConfiguration,
  removePushSubscription,
  savePushSubscription,
  sendWorkspacePush
} from './push.js';

const API_VERSION = '2026-10-26-push-receipts';
const MAX_TEXT_LENGTH = 4096;
const MAX_RAW_PAYLOAD = 64000;
const MAX_JSON_BODY = 32768;
const MAX_EXTERNAL_JSON_BODY = 131072;
const MAX_CREDENTIAL_LENGTH = 4096;
const WHATSAPP_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;
const MAX_ATTACHMENT_CAPTION_LENGTH = 1024;
const EXTERNAL_API_OPERATION = 'whatsapp.template.send';
const EXTERNAL_API_IDEMPOTENCY_DAYS = 7;
const MANAGED_CONNECTORS = new Set(['whatsapp_cloud', 'telegram', 'instagram']);
const CONNECTOR_DEFINITIONS = {
  whatsapp_cloud: {
    label: 'WhatsApp Cloud API', webhookPath: 'whatsapp',
    configFields: ['wabaId', 'phoneNumberId', 'apiVersion'],
    requiredConfig: ['wabaId', 'phoneNumberId'], requiredCredentials: ['accessToken', 'verifyToken', 'appSecret']
  },
  telegram: {
    label: 'Telegram Bot', webhookPath: 'telegram',
    configFields: [],
    requiredConfig: [], requiredCredentials: ['botToken', 'webhookSecret']
  },
  instagram: {
    label: 'Instagram Messaging', webhookPath: 'instagram',
    configFields: ['instagramAccountId', 'username', 'appId', 'apiVersion', 'authMode'],
    requiredConfig: ['instagramAccountId'], requiredCredentials: ['accessToken', 'verifyToken', 'appSecret']
  }
};

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
  scheduled(_event, env, ctx) {
    ctx.waitUntil(Promise.all([retryDueMessages(env), cleanupExpiredAuth(env), cleanupExpiredExternalRequests(env)]));
  }
};

export class InboxHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/external-api-rate-limit') {
      if (!this.state.storage) return json({ ok: false, error: 'Rate limiter unavailable.' }, 503);
      const input = await request.json().catch(() => ({}));
      const keyHash = String(input.keyHash || '');
      if (!/^[a-f0-9]{64}$/.test(keyHash)) return json({ ok: false, error: 'Invalid rate-limit key.' }, 400);
      const windowSeconds = clampInt(this.env.EXTERNAL_API_RATE_LIMIT_WINDOW_SECONDS, 1, 3600, 60);
      const perKeyLimit = clampInt(this.env.EXTERNAL_API_RATE_LIMIT_PER_KEY, 1, 10000, 60);
      const workspaceLimit = clampInt(this.env.EXTERNAL_API_RATE_LIMIT_PER_WORKSPACE, perKeyLimit, 100000, 300);
      const now = Date.now();
      const windowMs = windowSeconds * 1000;
      const windowStart = Math.floor(now / windowMs) * windowMs;
      const result = await this.state.storage.transaction(async storage => {
        const stored = await storage.get('external-api-rate-window');
        const record = stored?.windowStart === windowStart ? stored : { windowStart, total: 0, keys: {} };
        const keyCount = Number(record.keys?.[keyHash] || 0);
        const retryAfter = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
        if (record.total >= workspaceLimit || keyCount >= perKeyLimit) {
          return { allowed: false, retryAfter, remaining: 0, perKeyLimit };
        }
        record.total++;
        record.keys[keyHash] = keyCount + 1;
        await storage.put('external-api-rate-window', record);
        return { allowed: true, retryAfter, remaining: Math.max(0, perKeyLimit - keyCount - 1), perKeyLimit };
      });
      return new Response(null, {
        status: result.allowed ? 204 : 429,
        headers: {
          'Cache-Control': 'no-store',
          'X-RateLimit-Limit': String(result.perKeyLimit),
          'X-RateLimit-Remaining': String(result.remaining),
          ...(result.allowed ? {} : { 'Retry-After': String(result.retryAfter) })
        }
      });
    }
    if (request.method === 'POST' && url.pathname === '/oauth-rate-limit') {
      if (!this.state.storage) return json({ ok: false, error: 'Rate limiter unavailable.' }, 503);
      const clientHash = (await request.text()).trim();
      if (!/^[a-f0-9]{64}$/.test(clientHash)) return json({ ok: false, error: 'Invalid rate-limit key.' }, 400);
      const windowSeconds = clampInt(this.env.OAUTH_RATE_LIMIT_WINDOW_SECONDS, 60, 3600, 600);
      const perClientLimit = clampInt(this.env.OAUTH_RATE_LIMIT_PER_CLIENT, 1, 100, 10);
      const globalLimit = clampInt(this.env.OAUTH_RATE_LIMIT_GLOBAL, perClientLimit, 5000, 500);
      const now = Date.now();
      const windowMs = windowSeconds * 1000;
      const windowStart = Math.floor(now / windowMs) * windowMs;
      const result = await this.state.storage.transaction(async storage => {
        const stored = await storage.get('oauth-rate-window');
        const record = stored?.windowStart === windowStart
          ? stored
          : { windowStart, total: 0, clients: {} };
        const clientCount = Number(record.clients?.[clientHash] || 0);
        const retryAfter = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
        if (record.total >= globalLimit || clientCount >= perClientLimit) return { allowed: false, retryAfter };
        record.total++;
        if (clientCount > 0 || Object.keys(record.clients).length < 512) record.clients[clientHash] = clientCount + 1;
        await storage.put('oauth-rate-window', record);
        return { allowed: true, retryAfter };
      });
      return new Response(null, {
        status: result.allowed ? 204 : 429,
        headers: {
          'Cache-Control': 'no-store',
          ...(result.allowed ? {} : { 'Retry-After': String(result.retryAfter) })
        }
      });
    }
    if (request.method === 'POST' && url.pathname === '/broadcast') {
      const body = await request.text();
      for (const socket of this.state.getWebSockets()) {
        try {
          if (await this.socketAuthorized(socket)) socket.send(body);
          else socket.close(1008, 'Session expired or access changed');
        } catch { /* stale socket */ }
      }
      return new Response(null, { status: 204 });
    }
    if (request.method === 'POST' && url.pathname === '/disconnect') {
      const target = await request.json().catch(() => ({}));
      for (const socket of this.state.getWebSockets()) {
        const attachment = socket.deserializeAttachment?.() || {};
        if ((target.sessionId && attachment.sessionId === target.sessionId) ||
            (target.membershipId && attachment.membershipId === target.membershipId)) {
          try { socket.close(1008, 'Session ended or access changed'); } catch { /* stale socket */ }
        }
      }
      return new Response(null, { status: 204 });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return json({ ok: false, error: 'WebSocket upgrade required.' }, 426);
    }
    const attachment = {
      sessionId: request.headers.get('X-Helixcer-Session-Id') || '',
      membershipId: request.headers.get('X-Helixcer-Membership-Id') || '',
      expiresAt: request.headers.get('X-Helixcer-Session-Expires-At') || ''
    };
    if (!attachment.sessionId || !attachment.membershipId || !attachment.expiresAt) {
      return json({ ok: false, error: 'A verified session is required.' }, 401);
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment?.(attachment);
    this.state.acceptWebSocket(server);
    server.send(JSON.stringify({ type: 'connected', at: new Date().toISOString() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, message) {
    if (!await this.socketAuthorized(socket)) {
      try { socket.close(1008, 'Session expired or access changed'); } catch { /* closed */ }
      return;
    }
    if (message === 'ping') socket.send('pong');
  }

  webSocketError(socket) {
    try { socket.close(1011, 'Realtime connection error'); } catch { /* closed */ }
  }

  async socketAuthorized(socket) {
    const attachment = socket.deserializeAttachment?.() || {};
    if (!attachment.sessionId || !attachment.membershipId || !attachment.expiresAt ||
        attachment.expiresAt <= new Date().toISOString()) return false;
    const active = await this.env.DB.prepare(`SELECT 1 FROM sessions s
      JOIN memberships m ON m.membership_id=?2 AND m.user_id=s.user_id AND m.workspace_id=s.workspace_id
      WHERE s.session_id=?1 AND s.revoked_at IS NULL AND s.expires_at>?3 AND m.status='active'`)
      .bind(attachment.sessionId, attachment.membershipId, new Date().toISOString()).first();
    return Boolean(active);
  }
}

export async function handleRequest(request, env, ctx = { waitUntil() {} }) {
  const url = new URL(request.url);
  const cors = corsHeaders(request.headers.get('Origin') || '', env.ALLOWED_ORIGINS || '');
  if (request.method === 'OPTIONS') {
    if (url.pathname.startsWith('/api/v1/')) {
      return json({ status: false, error: { code: 'server_to_server_only', message: 'This API does not accept browser CORS requests.' } }, 405);
    }
    if (!cors['Access-Control-Allow-Origin']) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: cors });
  }
  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      return withCors(json({ ok: true, service: 'helixcer-chat-api', version: API_VERSION }), cors);
    }
    if (request.method === 'GET' && url.pathname === '/auth/google/start') {
      const limited = await enforceOAuthRateLimit(request, env);
      if (limited) return limited;
      return await startGoogleOAuth(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/auth/google/callback') return await finishGoogleOAuthResponse(request, env);
    if (request.method === 'POST' && (url.pathname === '/auth/logout' || url.pathname === '/api/logout')) {
      if (!cors['Access-Control-Allow-Origin']) return json({ ok: false, error: 'Origin not allowed.' }, 403);
      const logoutPrincipal = await authenticateRequest(request, env);
      const response = await logout(request, env);
      if (logoutPrincipal?.authType === 'session') {
        await disconnectRealtime(env, logoutPrincipal.workspace.workspaceId, { sessionId: logoutPrincipal.sessionId });
      }
      return withCors(response, cors);
    }
    const whatsappMatch = url.pathname.match(/^\/webhooks\/whatsapp\/([^/]+)$/);
    if (whatsappMatch) return await handleWhatsAppWebhook(request, env, decodeURIComponent(whatsappMatch[1]), ctx);
    const telegramMatch = url.pathname.match(/^\/webhooks\/telegram\/([^/]+)$/);
    if (telegramMatch && request.method === 'POST') return await handleTelegramWebhook(request, env, decodeURIComponent(telegramMatch[1]), ctx);
    const instagramAppMatch = url.pathname.match(/^\/webhooks\/instagram-app\/([^/]+)$/);
    if (instagramAppMatch) return await handleInstagramAppWebhook(request, env, decodeURIComponent(instagramAppMatch[1]), ctx);
    const instagramMatch = url.pathname.match(/^\/webhooks\/instagram\/([^/]+)$/);
    if (instagramMatch) return await handleInstagramWebhook(request, env, decodeURIComponent(instagramMatch[1]), ctx);
    const genericMatch = url.pathname.match(/^\/webhooks\/generic\/([^/]+)$/);
    if (genericMatch && request.method === 'POST') return await handleGenericWebhook(request, env, decodeURIComponent(genericMatch[1]), ctx);

    if (url.pathname.startsWith('/api/v1/')) return await handleExternalApi(request, env, ctx, url);

    if (!url.pathname.startsWith('/api/')) return withCors(json({ ok: false, error: 'Not found.' }, 404), cors);
    const mutation = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method);
    if (mutation && request.headers.get('Origin') && !cors['Access-Control-Allow-Origin']) {
      return json({ ok: false, error: 'Origin not allowed.' }, 403);
    }
    const principal = await authenticateRequest(request, env);
    if (!principal) return withCors(json({ ok: false, error: 'Unauthorized.' }, 401), cors);
    if (mutation && principal.authType === 'session' && !cors['Access-Control-Allow-Origin']) {
      return json({ ok: false, error: 'Origin not allowed.' }, 403);
    }
    const workspaceId = principal.workspace.workspaceId;
    if (url.pathname === '/api/me' && request.method === 'GET') {
      return withCors(json(principalView(principal)), cors);
    }
    if (url.pathname === '/api/push/config' && request.method === 'GET') {
      if (principal.authType !== 'session') return withCors(json({ ok: false, error: 'A verified browser session is required.' }, 403), cors);
      return withCors(json(pushConfiguration(env)), cors);
    }
    if (url.pathname === '/api/push/subscriptions' && request.method === 'POST') {
      const result = await savePushSubscription(env, principal, await readJson(request), request.headers.get('User-Agent') || '');
      return withCors(json(result, 201), cors);
    }
    if (url.pathname === '/api/push/subscriptions' && request.method === 'DELETE') {
      return withCors(json(await removePushSubscription(env, principal, await readJson(request))), cors);
    }
    if (url.pathname === '/api/realtime' && request.method === 'GET') {
      if (!cors['Access-Control-Allow-Origin']) return json({ ok: false, error: 'Origin not allowed.' }, 403);
      if (principal.authType !== 'session') return json({ ok: false, error: 'A verified session is required for realtime.' }, 403);
      const headers = new Headers({
        Upgrade: 'websocket',
        'X-Helixcer-Session-Id': principal.sessionId,
        'X-Helixcer-Membership-Id': principal.membership.membershipId,
        'X-Helixcer-Session-Expires-At': principal.sessionExpiresAt
      });
      return inboxHub(env, workspaceId).fetch('https://hub.internal/connect', { headers });
    }
    if (url.pathname === '/api/bootstrap' && request.method === 'GET') {
      const [channels, conversations, contacts] = await Promise.all([
        listChannels(env, workspaceId, principal.membership.role !== 'agent'),
        listConversations(env, workspaceId, url), listContacts(env, workspaceId, url)
      ]);
      return withCors(json({
        appName: env.APP_NAME || 'Helixcer Chat', channels, conversations, contacts, me: principalView(principal),
        connectorTypes: [
          { value: 'whatsapp_cloud', label: 'WhatsApp Cloud API', capabilities: ['text'] },
          { value: 'telegram', label: 'Telegram Bot', capabilities: ['text'] },
          { value: 'instagram', label: 'Instagram Messaging', capabilities: ['text'] }
        ]
      }), cors);
    }
    if (url.pathname === '/api/channels' && request.method === 'GET') {
      requireRole(principal, 'admin');
      return withCors(json({ items: await listChannels(env, workspaceId, true) }), cors);
    }
    if (url.pathname === '/api/channels' && request.method === 'POST') {
      requireRole(principal, 'admin');
      const result = await saveChannel(env, workspaceId, await readJson(request), principal, '');
      await broadcast(env, workspaceId, { type: 'channel.updated', channelId: result.channelId });
      return withCors(json(result, 201), cors);
    }
    const channelMatch = url.pathname.match(/^\/api\/channels\/([^/]+)$/);
    if (channelMatch && request.method === 'PATCH') {
      requireRole(principal, 'admin');
      const channelId = decodeURIComponent(channelMatch[1]);
      const result = await saveChannel(env, workspaceId, await readJson(request), principal, channelId);
      await broadcast(env, workspaceId, { type: 'channel.updated', channelId });
      return withCors(json(result), cors);
    }
    if (channelMatch && request.method === 'DELETE') {
      requireRole(principal, 'admin');
      const channelId = decodeURIComponent(channelMatch[1]);
      const result = await deleteChannel(env, workspaceId, channelId, principal);
      await broadcast(env, workspaceId, { type: 'channel.deleted', channelId });
      return withCors(json(result), cors);
    }
    const channelVerifyMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/verify$/);
    if (channelVerifyMatch && request.method === 'POST') {
      requireRole(principal, 'admin');
      const channelId = decodeURIComponent(channelVerifyMatch[1]);
      const result = await verifyChannel(env, workspaceId, channelId, request);
      await broadcast(env, workspaceId, { type: 'channel.updated', channelId });
      return withCors(json(result), cors);
    }
    const channelVerifyTokenMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/verify-token$/);
    if (channelVerifyTokenMatch && request.method === 'GET') {
      requireRole(principal, 'admin');
      const channelId = decodeURIComponent(channelVerifyTokenMatch[1]);
      return withCors(json(await getChannelVerifyToken(env, workspaceId, channelId, principal)), cors);
    }
    if (url.pathname === '/api/conversations' && request.method === 'GET') {
      return withCors(json({ items: await listConversations(env, workspaceId, url) }), cors);
    }
    const conversationMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
    if (conversationMatch && request.method === 'PATCH') {
      const id = decodeURIComponent(conversationMatch[1]);
      const item = await updateConversation(env, workspaceId, id, await readJson(request), principal);
      await broadcast(env, workspaceId, { type: 'conversation.updated', conversationId: id });
      return withCors(json({ ok: true, item }), cors);
    }
    const messagesMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (messagesMatch && request.method === 'GET') {
      const id = decodeURIComponent(messagesMatch[1]);
      const [items, replyWindow] = await Promise.all([
        listMessages(env, workspaceId, id, url),
        getConversationReplyWindow(env, workspaceId, id)
      ]);
      return withCors(json({ items, ...replyWindow }), cors);
    }
    if (messagesMatch && request.method === 'POST') {
      const id = decodeURIComponent(messagesMatch[1]);
      const result = await createOutboundMessage(env, workspaceId, id, await readJson(request), principal);
      await broadcast(env, workspaceId, { type: 'message.created', conversationId: id, messageId: result.message.messageId });
      ctx.waitUntil(sendOrQueue(env, result.message.messageId));
      return withCors(json({ ok: true, item: result.message }, 202), cors);
    }
    const conversationTemplatesMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/templates$/);
    if (conversationTemplatesMatch && request.method === 'GET') {
      const id = decodeURIComponent(conversationTemplatesMatch[1]);
      return withCors(json({ items: await listConversationTemplates(env, workspaceId, id) }), cors);
    }
    const templateMessageMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/template$/);
    if (templateMessageMatch && request.method === 'POST') {
      const id = decodeURIComponent(templateMessageMatch[1]);
      const result = await createConversationTemplateMessage(env, workspaceId, id, await readJson(request), principal);
      await broadcast(env, workspaceId, { type: 'message.created', conversationId: id, messageId: result.message.messageId });
      ctx.waitUntil(sendOrQueue(env, result.message.messageId));
      return withCors(json({ ok: true, item: result.message }, 202), cors);
    }
    const attachmentMessageMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/attachments$/);
    if (attachmentMessageMatch && request.method === 'POST') {
      const id = decodeURIComponent(attachmentMessageMatch[1]);
      const result = await createConversationAttachmentMessage(env, workspaceId, id, request, principal);
      await broadcast(env, workspaceId, { type: 'message.created', conversationId: id, messageId: result.message.messageId });
      ctx.waitUntil(sendOrQueue(env, result.message.messageId));
      return withCors(json({ ok: true, item: result.message }, 202), cors);
    }
    if (url.pathname === '/api/contacts' && request.method === 'POST') {
      const result = await createContact(env, workspaceId, await readJson(request), principal);
      await broadcast(env, workspaceId, { type: 'conversation.created', conversationId: result.conversationId });
      return withCors(json(result, 201), cors);
    }
    if (url.pathname === '/api/contacts' && request.method === 'GET') {
      return withCors(json({ items: await listContacts(env, workspaceId, url) }), cors);
    }
    const contactMatch = url.pathname.match(/^\/api\/contacts\/([^/]+)$/);
    if (contactMatch && request.method === 'GET') {
      const id = decodeURIComponent(contactMatch[1]);
      return withCors(json({ item: await getContactDetail(env, workspaceId, id) }), cors);
    }
    if (contactMatch && request.method === 'PATCH') {
      const id = decodeURIComponent(contactMatch[1]);
      const item = await updateContact(env, workspaceId, id, await readJson(request), principal);
      await broadcast(env, workspaceId, { type: 'contact.updated', contactId: id });
      return withCors(json({ ok: true, item }), cors);
    }
    if (url.pathname === '/api/demo/seed' && request.method === 'POST') {
      requireRole(principal, 'admin');
      const result = await seedDemo(env, workspaceId, principal);
      await broadcast(env, workspaceId, { type: 'bootstrap.changed' });
      return withCors(json(result, 201), cors);
    }
    if (url.pathname === '/api/developer/api-keys' && request.method === 'GET') {
      requireRole(principal, 'admin');
      return withCors(json({ items: await listApiKeys(env, workspaceId) }), cors);
    }
    if (url.pathname === '/api/developer/api-keys' && request.method === 'POST') {
      requireRole(principal, 'admin');
      return withCors(json(await createApiKey(env, workspaceId, principal, await readJson(request)), 201), cors);
    }
    const apiKeyMatch = url.pathname.match(/^\/api\/developer\/api-keys\/([^/]+)$/);
    if (apiKeyMatch && request.method === 'DELETE') {
      requireRole(principal, 'admin');
      return withCors(json(await revokeApiKey(env, workspaceId, principal, decodeURIComponent(apiKeyMatch[1]))), cors);
    }
    if (url.pathname === '/api/team' && request.method === 'GET') {
      return withCors(json(await listTeam(env, principal)), cors);
    }
    if (url.pathname === '/api/team/invitations' && request.method === 'POST') {
      const result = await createInvitation(request, env, principal, await readJson(request));
      await broadcast(env, workspaceId, { type: 'team.updated' });
      return withCors(json(result, 201), cors);
    }
    const memberMatch = url.pathname.match(/^\/api\/team\/members\/([^/]+)$/);
    if (memberMatch && request.method === 'PATCH') {
      const result = await updateMembership(env, principal, decodeURIComponent(memberMatch[1]), await readJson(request));
      await broadcast(env, workspaceId, { type: 'team.updated' });
      await disconnectRealtime(env, workspaceId, { membershipId: decodeURIComponent(memberMatch[1]) });
      return withCors(json(result), cors);
    }
    const invitationMatch = url.pathname.match(/^\/api\/team\/invitations\/([^/]+)$/);
    if (invitationMatch && request.method === 'PATCH') {
      const result = await updateInvitation(env, principal, decodeURIComponent(invitationMatch[1]), await readJson(request));
      await broadcast(env, workspaceId, { type: 'team.updated' });
      return withCors(json(result), cors);
    }
    return withCors(json({ ok: false, error: 'API route not found.' }, 404), cors);
  } catch (error) {
    const status = Number(error.status) || 500;
    if (status >= 500) console.error('request_failed', { path: url.pathname, status, message: error.message });
    return withCors(json({ ok: false, error: status >= 500 ? 'The service could not complete the request.' : error.message }, status), cors);
  }
}

async function listApiKeys(env, workspaceId) {
  const result = await env.DB.prepare(`SELECT api_key_id,name,key_prefix,scopes_json,status,
      expires_at,last_used_at,created_at,updated_at,revoked_at
    FROM api_keys WHERE workspace_id=?1 ORDER BY created_at DESC`).bind(workspaceId).all();
  return (result.results || []).map(publicApiKeyView);
}

async function createApiKey(env, workspaceId, principal, payload) {
  const name = cleanRequired(payload?.name, 'API key name', 120);
  let expiresAt = null;
  if (payload?.expiresAt) {
    const expires = new Date(String(payload.expiresAt));
    if (Number.isNaN(expires.valueOf()) || expires <= new Date()) throw httpError(400, 'API key expiry must be a future date.');
    expiresAt = expires.toISOString();
  }
  const apiKeyId = crypto.randomUUID();
  const publicId = base64UrlEncode(crypto.getRandomValues(new Uint8Array(9)));
  const secret = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const keyPrefix = `hxc_live_${publicId}`;
  const apiKey = `${keyPrefix}.${secret}`;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO api_keys
      (api_key_id,workspace_id,name,key_prefix,secret_hash,scopes_json,allowed_channel_ids_json,status,
       expires_at,created_by_user_id,created_at,updated_at)
    VALUES (?1,?2,?3,?4,?5,?6,?7,'active',?8,?9,?10,?10)`)
    .bind(apiKeyId, workspaceId, name, keyPrefix, await hashText(apiKey),
      JSON.stringify(['whatsapp:template:send', 'messages:read']), '[]',
      expiresAt, principal.user.userId || '', now).run();
  await audit(env, principal, 'create', 'api_key', apiKeyId, { keyPrefix });
  return {
    ok: true,
    apiKey,
    item: publicApiKeyView({
      api_key_id: apiKeyId, name, key_prefix: keyPrefix,
      scopes_json: JSON.stringify(['whatsapp:template:send', 'messages:read']),
      status: 'active', expires_at: expiresAt,
      last_used_at: null, created_at: now, updated_at: now, revoked_at: null
    })
  };
}

async function revokeApiKey(env, workspaceId, principal, apiKeyId) {
  const id = cleanId(apiKeyId, 'API key ID');
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`UPDATE api_keys SET status='revoked',revoked_at=?3,updated_at=?3
    WHERE api_key_id=?1 AND workspace_id=?2 AND status='active'`).bind(id, workspaceId, now).run();
  if (!result.meta?.changes) throw httpError(404, 'Active API key not found.');
  await audit(env, principal, 'revoke', 'api_key', id, {});
  return { ok: true, apiKeyId: id, status: 'revoked', revokedAt: now };
}

function publicApiKeyView(row) {
  return {
    apiKeyId: row.api_key_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: safeJsonParse(row.scopes_json, []),
    status: row.status,
    expiresAt: row.expires_at || '',
    lastUsedAt: row.last_used_at || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revokedAt: row.revoked_at || ''
  };
}

async function handleExternalApi(request, env, ctx, url) {
  const requestId = crypto.randomUUID();
  try {
    if (request.headers.get('Origin')) {
      throw apiError(403, 'server_to_server_only', 'This API is for server-to-server requests and does not accept browser Origin headers.');
    }
    const apiPrincipal = await authenticateApiKey(request, env);
    const rateLimited = await enforceExternalApiRateLimit(env, apiPrincipal, requestId);
    if (rateLimited) return rateLimited;

    if (url.pathname === '/api/v1/whatsapp/template-messages' && request.method === 'POST') {
      requireApiScope(apiPrincipal, 'whatsapp:template:send');
      const response = await createExternalTemplateMessage(request, env, ctx, url, apiPrincipal, requestId);
      response.headers.set('X-Request-Id', requestId);
      return response;
    }
    const statusMatch = url.pathname.match(/^\/api\/v1\/messages\/([^/]+)$/);
    if (statusMatch && request.method === 'GET') {
      requireApiScope(apiPrincipal, 'messages:read');
      const item = await getExternalMessageStatus(env, apiPrincipal, decodeURIComponent(statusMatch[1]), url);
      const response = json({ status: true, ...item, requestId });
      response.headers.set('X-Request-Id', requestId);
      return response;
    }
    throw apiError(404, 'route_not_found', 'API route not found.');
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error('external_api_request_failed', { requestId, path: url.pathname, status, message: cleanError(error) });
    const response = json({
      status: false,
      error: {
        code: error?.code || (status >= 500 ? 'internal_error' : 'invalid_request'),
        message: status >= 500 ? 'The service could not complete the request.' : cleanError(error),
        requestId
      }
    }, status);
    response.headers.set('X-Request-Id', requestId);
    if (error?.retryAfter) response.headers.set('Retry-After', String(error.retryAfter));
    return response;
  }
}

async function authenticateApiKey(request, env) {
  const authorization = request.headers.get('Authorization') || '';
  const match = authorization.match(/^Bearer (hxc_live_([A-Za-z0-9_-]{8,32})\.([A-Za-z0-9_-]{32,128}))$/);
  if (!match) throw apiError(401, 'invalid_api_key', 'A valid Bearer API key is required.');
  const token = match[1];
  const keyPrefix = `hxc_live_${match[2]}`;
  const row = await env.DB.prepare(`SELECT api_key_id,workspace_id,key_prefix,secret_hash,scopes_json,
      status,expires_at
    FROM api_keys WHERE key_prefix=?1 LIMIT 1`).bind(keyPrefix).first();
  const suppliedHash = await hashText(token);
  if (!row || !timingSafeEqual(row.secret_hash || '', suppliedHash) || row.status !== 'active' ||
      (row.expires_at && row.expires_at <= new Date().toISOString())) {
    throw apiError(401, 'invalid_api_key', 'The API key is invalid, expired, or revoked.');
  }
  await env.DB.prepare('UPDATE api_keys SET last_used_at=?2,updated_at=?2 WHERE api_key_id=?1')
    .bind(row.api_key_id, new Date().toISOString()).run();
  return {
    apiKeyId: row.api_key_id,
    workspaceId: row.workspace_id,
    keyPrefix: row.key_prefix,
    keyHash: suppliedHash,
    scopes: new Set(safeJsonParse(row.scopes_json, []))
  };
}

function requireApiScope(principal, scope) {
  if (!principal.scopes.has(scope)) throw apiError(403, 'insufficient_scope', `The API key requires the ${scope} scope.`);
}

async function enforceExternalApiRateLimit(env, principal, requestId) {
  if (!env.INBOX_HUB) throw apiError(503, 'rate_limiter_unavailable', 'The API rate limiter is temporarily unavailable.');
  let response;
  try {
    response = await inboxHub(env, principal.workspaceId).fetch('https://hub.internal/external-api-rate-limit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyHash: principal.keyHash })
    });
  } catch {
    throw apiError(503, 'rate_limiter_unavailable', 'The API rate limiter is temporarily unavailable.');
  }
  if (response.status === 204) return null;
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After') || '60';
    const limited = json({ status: false, error: {
      code: 'rate_limited', message: 'Too many API requests. Retry after the indicated delay.', requestId
    } }, 429);
    limited.headers.set('X-Request-Id', requestId);
    limited.headers.set('Retry-After', retryAfter);
    limited.headers.set('X-RateLimit-Limit', response.headers.get('X-RateLimit-Limit') || '60');
    limited.headers.set('X-RateLimit-Remaining', '0');
    return limited;
  }
  throw apiError(503, 'rate_limiter_unavailable', 'The API rate limiter is temporarily unavailable.');
}

async function createExternalTemplateMessage(request, env, ctx, url, principal, requestId) {
  const suppliedIdempotencyKey = request.headers.get('Idempotency-Key');
  if (suppliedIdempotencyKey !== null && !/^[A-Za-z0-9._:-]{8,128}$/.test(suppliedIdempotencyKey)) {
    throw apiError(400, 'invalid_idempotency_key', 'When provided, Idempotency-Key must contain 8 to 128 safe ASCII characters.');
  }
  const idempotencyKey = suppliedIdempotencyKey || `automatic-${crypto.randomUUID()}`;
  const raw = await readExternalJson(request);
  const input = validateWhatsAppTemplateRequest(raw);
  const requestHash = await hashText(stableStringify(input));
  const idempotencyHash = await hashText(idempotencyKey);
  const existing = await findExternalRequest(env, principal.apiKeyId, idempotencyHash);
  if (existing) {
    if (!timingSafeEqual(existing.request_hash, requestHash)) {
      throw apiError(409, 'idempotency_conflict', 'This Idempotency-Key was already used with a different request.');
    }
    return externalMessageResponse(await getExternalMessageStatus(env, principal, existing.message_id, url), requestId, true, suppliedIdempotencyKey !== null);
  }
  await env.DB.prepare(`DELETE FROM external_api_requests
    WHERE api_key_id=?1 AND operation=?2 AND idempotency_key_hash=?3 AND expires_at<=?4`)
    .bind(principal.apiKeyId, EXTERNAL_API_OPERATION, idempotencyHash, new Date().toISOString()).run();

  const channel = await getChannel(env, input.channelId, 'whatsapp_cloud', principal.workspaceId);
  if (!channel) throw apiError(404, 'channel_not_found', 'WhatsApp channel not found.');
  if (!channel.config?.phoneNumberId) throw apiError(409, 'channel_not_ready', 'The WhatsApp channel is missing its Phone Number ID.');
  const accessToken = await env.DB.prepare(`SELECT 1 FROM channel_credentials
    WHERE workspace_id=?1 AND channel_id=?2 AND credential_key='accessToken'`).bind(principal.workspaceId, channel.channelId).first();
  if (!accessToken) throw apiError(409, 'channel_not_ready', 'The WhatsApp channel is missing its access token.');

  const now = new Date().toISOString();
  const identity = await ensureWhatsAppConversation(env, principal.workspaceId, channel, input.to, input.contact?.displayName || '', now);
  const messageId = crypto.randomUUID();
  const externalRequestId = crypto.randomUUID();
  const templateLanguage = input.template.language.code;
  const preview = input.previewText || `Template: ${input.template.name} (${templateLanguage})`;
  const encryptedPayload = await encryptOutboundPayload({ template: input.template }, env.CHANNEL_CREDENTIALS_KEY,
    principal.workspaceId, messageId);
  const expiresAt = new Date(Date.now() + EXTERNAL_API_IDEMPOTENCY_DAYS * 86400000).toISOString();
  const firstRetryAt = new Date(Date.now() + 30000).toISOString();
  const statements = [
    ...(input.contact?.displayName ? [
      env.DB.prepare(`UPDATE contacts SET display_name=?3,updated_at=?4
        WHERE contact_id=?1 AND workspace_id=?2`)
        .bind(identity.contactId, principal.workspaceId, input.contact.displayName, now),
      env.DB.prepare(`UPDATE channel_identities SET display_name=?4
        WHERE contact_id=?1 AND workspace_id=?2 AND channel_id=?3`)
        .bind(identity.contactId, principal.workspaceId, channel.channelId, input.contact.displayName)
    ] : []),
    env.DB.prepare(`INSERT INTO messages (message_id,conversation_id,contact_id,channel_id,direction,message_type,text,
        status,timestamp,payload_json,workspace_id)
      VALUES (?1,?2,?3,?4,'outbound','template',?5,'pending',?6,'{}',?7)`)
      .bind(messageId, identity.conversationId, identity.contactId, channel.channelId, preview, now, principal.workspaceId),
    env.DB.prepare(`INSERT INTO outbound_payloads (message_id,workspace_id,encrypted_payload,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?4)`).bind(messageId, principal.workspaceId, encryptedPayload, now),
    env.DB.prepare(`INSERT INTO outbox (outbox_id,message_id,attempts,max_attempts,next_attempt_at,status,last_error,created_at,updated_at,workspace_id)
      VALUES (?1,?2,0,6,?3,'pending','',?4,?4,?5)`).bind(crypto.randomUUID(), messageId, firstRetryAt, now, principal.workspaceId),
    env.DB.prepare(`INSERT INTO external_api_requests
        (request_id,workspace_id,api_key_id,operation,idempotency_key_hash,request_hash,message_id,client_reference,created_at,expires_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`)
      .bind(externalRequestId, principal.workspaceId, principal.apiKeyId, EXTERNAL_API_OPERATION,
        idempotencyHash, requestHash, messageId, input.clientReference, now, expiresAt),
    env.DB.prepare(`UPDATE conversations SET status='open',last_message_at=?3,updated_at=?3
      WHERE conversation_id=?1 AND workspace_id=?2`).bind(identity.conversationId, principal.workspaceId, now)
  ];
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const winner = await findExternalRequest(env, principal.apiKeyId, idempotencyHash);
      if (winner && timingSafeEqual(winner.request_hash, requestHash)) {
        return externalMessageResponse(await getExternalMessageStatus(env, principal, winner.message_id, url), requestId, true, suppliedIdempotencyKey !== null);
      }
      if (winner) throw apiError(409, 'idempotency_conflict', 'This Idempotency-Key was already used with a different request.');
    }
    throw error;
  }
  await auditApiKey(env, principal, 'send_template', 'message', messageId, {
    channelId: channel.channelId, templateName: input.template.name
  });
  await broadcast(env, principal.workspaceId, {
    type: 'message.created', conversationId: identity.conversationId, messageId
  });
  ctx.waitUntil(sendOrQueue(env, messageId));
  return externalMessageResponse({
    messageId, conversationId: identity.conversationId, contactId: identity.contactId,
    channelId: channel.channelId, messageStatus: 'pending', providerMessageId: '', error: '',
    clientReference: input.clientReference, createdAt: now,
    statusUrl: new URL(`/api/v1/messages/${encodeURIComponent(messageId)}`, url.origin).toString()
  }, requestId, false, suppliedIdempotencyKey !== null);
}

async function findExternalRequest(env, apiKeyId, idempotencyHash) {
  return env.DB.prepare(`SELECT request_hash,message_id FROM external_api_requests
    WHERE api_key_id=?1 AND operation=?2 AND idempotency_key_hash=?3 AND expires_at>?4 LIMIT 1`)
    .bind(apiKeyId, EXTERNAL_API_OPERATION, idempotencyHash, new Date().toISOString()).first();
}

async function getExternalMessageStatus(env, principal, messageId, url) {
  const id = cleanId(messageId, 'Message ID');
  const row = await env.DB.prepare(`SELECT m.message_id,m.conversation_id,m.contact_id,m.channel_id,m.status,
      m.provider_message_id,m.error,m.timestamp,r.client_reference
    FROM external_api_requests r JOIN messages m ON m.message_id=r.message_id AND m.workspace_id=r.workspace_id
    WHERE r.api_key_id=?1 AND r.workspace_id=?2 AND r.message_id=?3 LIMIT 1`)
    .bind(principal.apiKeyId, principal.workspaceId, id).first();
  if (!row) throw apiError(404, 'message_not_found', 'Message not found.');
  return {
    messageId: row.message_id,
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    channelId: row.channel_id,
    messageStatus: row.status,
    providerMessageId: row.provider_message_id || '',
    error: row.error || '',
    clientReference: row.client_reference || '',
    createdAt: row.timestamp,
    statusUrl: new URL(`/api/v1/messages/${encodeURIComponent(row.message_id)}`, url.origin).toString()
  };
}

function externalMessageResponse(item, requestId, replayed, includeReplayHeader) {
  const response = json({ status: true, ...item, requestId }, 202);
  if (includeReplayHeader) response.headers.set('Idempotent-Replayed', replayed ? 'true' : 'false');
  return response;
}

async function ensureWhatsAppConversation(env, workspaceId, channel, recipient, displayName, now) {
  let identity = await env.DB.prepare(`SELECT identity_id,contact_id FROM channel_identities
    WHERE workspace_id=?1 AND channel_id=?2 AND channel_profile_id=?3 LIMIT 1`)
    .bind(workspaceId, channel.channelId, recipient).first();
  if (!identity) {
    const contactId = crypto.randomUUID();
    const identityId = crypto.randomUUID();
    const name = String(displayName || recipient).slice(0, 120);
    try {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO contacts (contact_id,display_name,created_at,updated_at,workspace_id)
          VALUES (?1,?2,?3,?3,?4)`).bind(contactId, name, now, workspaceId),
        env.DB.prepare(`INSERT INTO channel_identities
            (identity_id,contact_id,channel_id,channel_profile_id,display_name,created_at,workspace_id)
          VALUES (?1,?2,?3,?4,?5,?6,?7)`)
          .bind(identityId, contactId, channel.channelId, recipient, name, now, workspaceId)
      ]);
      identity = { identity_id: identityId, contact_id: contactId };
    } catch (error) {
      identity = await env.DB.prepare(`SELECT identity_id,contact_id FROM channel_identities
        WHERE workspace_id=?1 AND channel_id=?2 AND channel_profile_id=?3 LIMIT 1`)
        .bind(workspaceId, channel.channelId, recipient).first();
      if (!identity) throw error;
    }
  }
  let conversation = await env.DB.prepare(`SELECT conversation_id FROM conversations
    WHERE workspace_id=?1 AND contact_id=?2 AND channel_id=?3
    ORDER BY last_message_at DESC,created_at DESC LIMIT 1`).bind(workspaceId, identity.contact_id, channel.channelId).first();
  if (!conversation) {
    const conversationId = crypto.randomUUID();
    const subject = String(displayName || recipient).slice(0, 120);
    try {
      await env.DB.prepare(`INSERT INTO conversations
          (conversation_id,contact_id,channel_id,status,assigned_to,subject,last_message_at,unread_count,created_at,updated_at,workspace_id)
        VALUES (?1,?2,?3,'open','',?4,?5,0,?5,?5,?6)`)
        .bind(conversationId, identity.contact_id, channel.channelId, subject, now, workspaceId).run();
      conversation = { conversation_id: conversationId };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      conversation = await env.DB.prepare(`SELECT conversation_id FROM conversations
        WHERE workspace_id=?1 AND contact_id=?2 AND channel_id=?3 LIMIT 1`)
        .bind(workspaceId, identity.contact_id, channel.channelId).first();
      if (!conversation) throw error;
    }
  }
  return { contactId: identity.contact_id, conversationId: conversation.conversation_id };
}

export function validateWhatsAppTemplateRequest(payload) {
  if (!isPlainObject(payload)) throw httpError(400, 'Request body must be a JSON object.');
  rejectUnknownKeys(payload, new Set(['channelId', 'to', 'contact', 'template', 'clientReference', 'previewText']), 'request');
  const channelId = cleanId(payload.channelId, 'Channel ID');
  const to = normalizeWhatsAppRecipient(payload.to);
  let contact = null;
  if (payload.contact !== undefined && payload.contact !== null) {
    if (!isPlainObject(payload.contact)) throw httpError(400, 'Contact must be an object.');
    rejectUnknownKeys(payload.contact, new Set(['displayName']), 'contact');
    const displayName = cleanRequired(payload.contact.displayName, 'Contact display name', 120);
    contact = { displayName };
  }
  const clientReference = payload.clientReference === undefined ? '' : cleanOptionalText(payload.clientReference, 'Client reference', 200);
  const previewText = payload.previewText === undefined ? '' : cleanOptionalText(payload.previewText, 'Preview text', MAX_TEXT_LENGTH);
  const template = validateWhatsAppTemplate(payload.template);
  return { channelId, to, contact, template, clientReference, previewText };
}

export function validateWhatsAppTemplate(value) {
  if (!isPlainObject(value)) throw httpError(400, 'Template must be an object.');
  rejectUnknownKeys(value, new Set(['name', 'language', 'components']), 'template');
  const name = cleanRequired(value.name, 'Template name', 512);
  if (!/^[a-z0-9_]+$/.test(name)) throw httpError(400, 'Template name may contain only lowercase letters, numbers, and underscores.');
  if (!isPlainObject(value.language)) throw httpError(400, 'Template language must be an object.');
  rejectUnknownKeys(value.language, new Set(['code', 'policy']), 'template language');
  const code = cleanRequired(value.language.code, 'Template language code', 35);
  if (!/^[A-Za-z]{2,3}(?:_[A-Za-z]{2})?$/.test(code)) throw httpError(400, 'Template language code is invalid.');
  const language = { code };
  if (value.language.policy !== undefined) language.policy = cleanRequired(value.language.policy, 'Template language policy', 40);
  const components = value.components === undefined ? [] : value.components;
  if (!Array.isArray(components) || components.length > 50) throw httpError(400, 'Template components must be an array with no more than 50 items.');
  const state = { nodes: 0 };
  const normalizedComponents = components.map((component, index) => {
    if (!isPlainObject(component)) throw httpError(400, `Template component ${index} must be an object.`);
    const normalized = normalizeBoundedJson(component, state, 0, `template.components[${index}]`);
    const type = String(normalized.type || '').trim().toLowerCase();
    if (!type || type.length > 40 || !/^[a-z_]+$/.test(type)) throw httpError(400, `Template component ${index} has an invalid type.`);
    normalized.type = type;
    return normalized;
  });
  return { name, language, components: normalizedComponents };
}

export function buildWhatsAppTemplatePayload(recipient, template, messageId = '') {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizeWhatsAppRecipient(recipient),
    type: 'template',
    template: validateWhatsAppTemplate(template)
  };
  if (messageId) payload.biz_opaque_callback_data = String(messageId).slice(0, 512);
  return payload;
}

function normalizeBoundedJson(value, state, depth, path) {
  state.nodes++;
  if (state.nodes > 1500) throw httpError(400, 'Template payload has too many values.');
  if (depth > 12) throw httpError(400, 'Template payload is nested too deeply.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw httpError(400, `${path} contains an invalid number.`);
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 4096) throw httpError(400, `${path} contains text longer than 4096 characters.`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) throw httpError(400, `${path} contains too many items.`);
    return value.map((item, index) => normalizeBoundedJson(item, state, depth + 1, `${path}[${index}]`));
  }
  if (!isPlainObject(value)) throw httpError(400, `${path} contains an unsupported value.`);
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw httpError(400, `${path} contains a forbidden key.`);
    if (key.length > 100) throw httpError(400, `${path} contains a key that is too long.`);
    const normalized = normalizeBoundedJson(item, state, depth + 1, `${path}.${key}`);
    if (key === 'link') validatePublicHttpsMediaUrl(normalized, path);
    result[key] = normalized;
  }
  return result;
}

function validatePublicHttpsMediaUrl(value, path) {
  if (typeof value !== 'string' || value.length > 4096) throw httpError(400, `${path}.link must be an HTTPS URL.`);
  let url;
  try { url = new URL(value); } catch { throw httpError(400, `${path}.link must be an HTTPS URL.`); }
  if (url.protocol !== 'https:' || url.username || url.password) throw httpError(400, `${path}.link must be a public HTTPS URL without credentials.`);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isPrivateHostname(host)) throw httpError(400, `${path}.link must not use a local or private host.`);
}

function isPrivateHostname(host) {
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '0.0.0.0' || host === '::1') return true;
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (match) {
    const octets = match.slice(1).map(Number);
    if (octets.some(value => value > 255)) return true;
    return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168);
  }
  return /^(fc|fd|fe8|fe9|fea|feb)/i.test(host);
}

function rejectUnknownKeys(value, allowed, label) {
  const unknown = Object.keys(value).find(key => !allowed.has(key));
  if (unknown) throw httpError(400, `Unsupported ${label} field: ${unknown}.`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function cleanOptionalText(value, label, maximum) {
  if (typeof value !== 'string') throw httpError(400, `${label} must be text.`);
  const text = value.trim();
  if (text.length > maximum) throw httpError(400, `${label} is too long.`);
  if (/[\u0000-\u001f\u007f]/.test(text)) throw httpError(400, `${label} contains invalid characters.`);
  return text;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function readExternalJson(request) {
  if (!(request.headers.get('Content-Type') || '').toLowerCase().includes('application/json')) {
    throw apiError(415, 'unsupported_media_type', 'Content-Type must be application/json.');
  }
  const raw = await readBoundedText(request, MAX_EXTERNAL_JSON_BODY);
  try { return JSON.parse(raw); } catch { throw apiError(400, 'invalid_json', 'Invalid JSON body.'); }
}

async function auditApiKey(env, principal, action, targetType, targetId, details) {
  await env.DB.prepare(`INSERT INTO audit_log
      (audit_id,actor,action,target_type,target_id,details_json,timestamp,workspace_id,actor_user_id,actor_email)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'',?2)`)
    .bind(crypto.randomUUID(), `api-key:${principal.keyPrefix}`, action, targetType, targetId,
      JSON.stringify(details || {}), new Date().toISOString(), principal.workspaceId).run();
}

function apiError(status, code, message) {
  const error = httpError(status, message);
  error.code = code;
  return error;
}

async function handleWhatsAppWebhook(request, env, channelId, ctx) {
  const channel = await getChannel(env, channelId, 'whatsapp_cloud');
  if (!channel) return json({ ok: false, error: 'Unknown or disabled channel.' }, 404);
  const credentials = await readChannelCredentials(env, channel);
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const expected = credentials.verifyToken;
    if (url.searchParams.get('hub.mode') === 'subscribe' && expected && timingSafeEqual(url.searchParams.get('hub.verify_token') || '', expected)) {
      await updateChannelRuntimeConfig(env, channel, { webhookVerifiedAt: new Date().toISOString() });
      await broadcast(env, channel.workspaceId, { type: 'channel.updated', channelId });
      return new Response(url.searchParams.get('hub.challenge') || '', { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  const raw = await readBoundedText(request, MAX_RAW_PAYLOAD);
  const appSecret = credentials.appSecret;
  if (!appSecret) return json({ ok: false, error: 'Webhook secret is not configured.' }, 503);
  if (!await verifyMetaSignature(raw, request.headers.get('X-Hub-Signature-256') || '', appSecret)) {
    return json({ ok: false, error: 'Invalid signature.' }, 401);
  }
  const payload = safeJsonParse(raw, null);
  if (!payload) return json({ ok: false, error: 'Invalid JSON.' }, 400);
  const normalized = normalizeWhatsApp(payload);
  const expectedPhoneNumberId = String(channel.config?.phoneNumberId || '');
  const hasEvents = normalized.messages.length > 0 || normalized.statuses.length > 0;
  if (hasEvents && (!expectedPhoneNumberId || normalized.phoneNumberIds.length === 0 ||
      normalized.phoneNumberIds.some(id => id !== expectedPhoneNumberId))) {
    return json({ ok: false, error: 'Webhook phone number does not match this channel.' }, 403);
  }
  let received = 0;
  for (const event of normalized.messages) if (await storeInbound(env, channel, event, payload)) received++;
  for (const status of normalized.statuses) await applyProviderStatus(env, channel.workspaceId, channel.channelId, status, payload);
  const receivedAt = new Date().toISOString();
  await updateChannelRuntimeConfig(env, channel, {
    lastWebhookAt: receivedAt,
    webhookVerifiedAt: channel.config?.webhookVerifiedAt || receivedAt
  });
  if (received || normalized.statuses.length) await broadcast(env, channel.workspaceId, { type: 'webhook.received', channelId, received, statuses: normalized.statuses.length });
  if (received) scheduleInboundPush(ctx, env, channel);
  return json({ ok: true, received, statuses: normalized.statuses.length });
}

async function handleGenericWebhook(request, env, channelId, ctx) {
  const channel = await getChannel(env, channelId, 'generic_http');
  if (!channel) return json({ ok: false, error: 'Unknown or disabled channel.' }, 404);
  const expected = env[`${secretPrefix(channel.secretKey)}_WEBHOOK_TOKEN`];
  if (!expected || !timingSafeEqual(request.headers.get('X-Webhook-Token') || '', expected)) return json({ ok: false, error: 'Invalid webhook token.' }, 401);
  const payload = safeJsonParse(await readBoundedText(request, MAX_RAW_PAYLOAD), null);
  if (!payload) return json({ ok: false, error: 'Invalid JSON.' }, 400);
  const mapping = channel.config?.inboundMapping || {};
  const events = normalizeGeneric(payload, mapping);
  const statuses = normalizeGenericStatuses(payload, mapping);
  let received = 0;
  for (const event of events) if (await storeInbound(env, channel, event, payload)) received++;
  let updatedStatuses = 0;
  for (const status of statuses) {
    if (await applyProviderStatus(env, channel.workspaceId, channel.channelId, status, payload)) updatedStatuses++;
  }
  if (received || updatedStatuses) {
    await broadcast(env, channel.workspaceId, { type: 'webhook.received', channelId, received, statuses: updatedStatuses });
  }
  if (received) scheduleInboundPush(ctx, env, channel);
  return json({ ok: true, received });
}

async function handleTelegramWebhook(request, env, channelId, ctx) {
  const channel = await getChannel(env, channelId, 'telegram');
  if (!channel) return json({ ok: false, error: 'Unknown or disabled channel.' }, 404);
  const credentials = await readChannelCredentials(env, channel);
  const expected = credentials.webhookSecret;
  if (!expected || !timingSafeEqual(request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '', expected)) {
    return json({ ok: false, error: 'Invalid webhook token.' }, 401);
  }
  const payload = safeJsonParse(await readBoundedText(request, MAX_RAW_PAYLOAD), null);
  if (!payload) return json({ ok: false, error: 'Invalid JSON.' }, 400);
  const event = normalizeTelegram(payload);
  const received = event && await storeInbound(env, channel, event, payload) ? 1 : 0;
  await updateChannelRuntimeConfig(env, channel, { lastWebhookAt: new Date().toISOString() });
  if (received) await broadcast(env, channel.workspaceId, { type: 'webhook.received', channelId, received });
  if (received) scheduleInboundPush(ctx, env, channel);
  return json({ ok: true, received });
}

async function handleInstagramWebhook(request, env, channelId, ctx) {
  const channel = await getChannel(env, channelId, 'instagram');
  if (!channel) return json({ ok: false, error: 'Unknown or disabled channel.' }, 404);
  const credentials = await readChannelCredentials(env, channel);
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const expected = credentials.verifyToken;
    if (url.searchParams.get('hub.mode') === 'subscribe' && expected &&
        timingSafeEqual(url.searchParams.get('hub.verify_token') || '', expected)) {
      await updateChannelRuntimeConfig(env, channel, { webhookVerifiedAt: new Date().toISOString() });
      await broadcast(env, channel.workspaceId, { type: 'channel.updated', channelId });
      return new Response(url.searchParams.get('hub.challenge') || '', { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  const raw = await readBoundedText(request, MAX_RAW_PAYLOAD);
  if (!credentials.appSecret) return json({ ok: false, error: 'Webhook secret is not configured.' }, 503);
  if (!await verifyMetaSignature(raw, request.headers.get('X-Hub-Signature-256') || '', credentials.appSecret)) {
    return json({ ok: false, error: 'Invalid signature.' }, 401);
  }
  const payload = safeJsonParse(raw, null);
  if (!payload) return json({ ok: false, error: 'Invalid JSON.' }, 400);
  const normalized = normalizeInstagram(payload);
  const expectedAccountId = String(channel.config?.instagramAccountId || '');
  const hasEvents = normalized.messages.length || normalized.statuses.length || normalized.watermarkStatuses.length;
  if (hasEvents && (!expectedAccountId || normalized.recipientIds.length === 0 ||
      normalized.recipientIds.some(id => id !== expectedAccountId))) {
    return json({ ok: false, error: 'Webhook Instagram account does not match this channel.' }, 403);
  }
  let received = 0;
  for (const event of normalized.messages) if (await storeInbound(env, channel, event, payload)) received++;
  let updatedStatuses = 0;
  for (const status of normalized.statuses) {
    if (await applyProviderStatus(env, channel.workspaceId, channel.channelId, status, payload)) updatedStatuses++;
  }
  for (const status of normalized.watermarkStatuses) {
    if (await applyProviderWatermarkStatus(env, channel.workspaceId, channel.channelId, status, payload)) updatedStatuses++;
  }
  await updateChannelRuntimeConfig(env, channel, { lastWebhookAt: new Date().toISOString() });
  if (received || updatedStatuses) {
    await broadcast(env, channel.workspaceId, { type: 'webhook.received', channelId, received, statuses: updatedStatuses });
  }
  if (received) scheduleInboundPush(ctx, env, channel);
  return json({ ok: true, received });
}

async function handleInstagramAppWebhook(request, env, requestedAppId, ctx) {
  const appId = cleanMetaIdentifier(requestedAppId, 'Meta App ID');
  const channels = await findInstagramAppChannels(env, appId);
  if (!channels.length) return json({ ok: false, error: 'Unknown Instagram app webhook.' }, 404);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    if (url.searchParams.get('hub.mode') !== 'subscribe') return new Response('Forbidden', { status: 403 });
    const supplied = url.searchParams.get('hub.verify_token') || '';
    const matches = [];
    for (const channel of channels) {
      const credentials = await readChannelCredentials(env, channel);
      if (credentials.verifyToken && timingSafeEqual(supplied, credentials.verifyToken)) matches.push(channel);
    }
    if (!matches.length) return new Response('Forbidden', { status: 403 });
    const verifiedAt = new Date().toISOString();
    for (const channel of matches) {
      await updateChannelRuntimeConfig(env, channel, { webhookVerifiedAt: verifiedAt });
      await broadcast(env, channel.workspaceId, { type: 'channel.updated', channelId: channel.channelId });
    }
    return new Response(url.searchParams.get('hub.challenge') || '', { status: 200 });
  }

  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  const raw = await readBoundedText(request, MAX_RAW_PAYLOAD);
  const payload = safeJsonParse(raw, null);
  if (!payload) return json({ ok: false, error: 'Invalid JSON.' }, 400);
  const groups = partitionInstagramAppPayload(payload);
  const channelsByAccount = new Map();
  for (const channel of channels) {
    const accountId = String(channel.config?.instagramAccountId || '');
    if (!channelsByAccount.has(accountId)) channelsByAccount.set(accountId, []);
    channelsByAccount.get(accountId).push(channel);
  }
  const routes = [];
  for (const [accountId, groupedPayload] of groups) {
    const matches = channelsByAccount.get(accountId) || [];
    if (!matches.length) throw httpError(404, 'No enabled Instagram connection matches this app webhook.');
    if (matches.length !== 1) throw httpError(409, 'Instagram app webhook routing is ambiguous.');
    routes.push({ accountId, payload: groupedPayload, channel: matches[0] });
  }

  const suppliedSignature = request.headers.get('X-Hub-Signature-256') || '';
  for (const route of routes) {
    const credentials = await readChannelCredentials(env, route.channel);
    if (!credentials.appSecret || !await verifyMetaSignature(raw, suppliedSignature, credentials.appSecret)) {
      return json({ ok: false, error: 'Invalid signature.' }, 401);
    }
  }

  let received = 0;
  const now = new Date().toISOString();
  for (const route of routes) {
    const normalized = normalizeInstagram(route.payload);
    if (normalized.recipientIds.some(id => id !== route.accountId)) {
      throw httpError(400, 'Instagram app webhook account routing is inconsistent.');
    }
    let channelReceived = 0;
    for (const event of normalized.messages) {
      if (await storeInbound(env, route.channel, event, route.payload)) {
        received++;
        channelReceived++;
      }
    }
    let channelStatuses = 0;
    for (const status of normalized.statuses) {
      if (await applyProviderStatus(env, route.channel.workspaceId, route.channel.channelId, status, route.payload)) {
        channelStatuses++;
      }
    }
    for (const status of normalized.watermarkStatuses) {
      if (await applyProviderWatermarkStatus(env, route.channel.workspaceId, route.channel.channelId, status, route.payload)) {
        channelStatuses++;
      }
    }
    await updateChannelRuntimeConfig(env, route.channel, { lastWebhookAt: now });
    if (channelReceived || channelStatuses) {
      await broadcast(env, route.channel.workspaceId, {
        type: 'webhook.received', channelId: route.channel.channelId, received: channelReceived, statuses: channelStatuses
      });
    }
    if (channelReceived) scheduleInboundPush(ctx, env, route.channel);
  }
  return json({ ok: true, received, channels: routes.length });
}

function scheduleInboundPush(ctx, env, channel) {
  const delivery = sendWorkspacePush(env, channel.workspaceId, {
    title: 'New customer message',
    body: 'Open Helixcer Chat to reply.',
    tag: `helixcer-${channel.channelId}`
  }).catch(error => console.error('push_delivery_failed', {
    workspaceId: channel.workspaceId,
    channelId: channel.channelId,
    message: cleanError(error)
  }));
  if (typeof ctx?.waitUntil === 'function') ctx.waitUntil(delivery);
}

async function findInstagramAppChannels(env, appId) {
  const result = await env.DB.prepare(`SELECT channel_id,name,connector_type,provider_type,enabled,
      capabilities_json,config_json,secret_key,workspace_id
    FROM channels
    WHERE enabled=1 AND provider_type='instagram' AND json_extract(config_json,'$.appId')=?1
    ORDER BY workspace_id,channel_id`).bind(appId).all();
  return (result.results || []).map(row => ({
    channelId: row.channel_id,
    name: row.name,
    connectorType: logicalConnectorType(row),
    capabilities: safeJsonParse(row.capabilities_json, []),
    config: safeJsonParse(row.config_json, {}),
    secretKey: row.secret_key,
    workspaceId: row.workspace_id
  }));
}

function partitionInstagramAppPayload(payload) {
  if (payload?.object && payload.object !== 'instagram') throw httpError(400, 'Unexpected Instagram webhook object.');
  if (!Array.isArray(payload?.entry) || !payload.entry.length) throw httpError(400, 'Instagram webhook has no entries.');
  const groups = new Map();
  const addEntry = (accountId, entry, messaging) => {
    if (!groups.has(accountId)) groups.set(accountId, { ...payload, entry: [] });
    groups.get(accountId).entry.push({ ...entry, id: accountId, messaging });
  };
  for (const entry of payload.entry) {
    const entryId = entry?.id ? cleanMetaIdentifier(entry.id, 'Instagram entry account ID') : '';
    const events = Array.isArray(entry?.messaging) ? entry.messaging : [];
    if (!events.length) {
      if (!entryId) throw httpError(400, 'Instagram webhook entry has no account ID.');
      addEntry(entryId, entry, []);
      continue;
    }
    const eventsByAccount = new Map();
    for (const event of events) {
      const recipientId = event?.recipient?.id ? cleanMetaIdentifier(event.recipient.id, 'Instagram recipient account ID') : '';
      const isEcho = Boolean(event?.message?.is_echo);
      if (!isEcho && entryId && recipientId && entryId !== recipientId) {
        throw httpError(400, 'Instagram webhook entry and recipient accounts do not match.');
      }
      const accountId = entryId || recipientId;
      if (!accountId) throw httpError(400, 'Instagram webhook event has no account ID.');
      if (!eventsByAccount.has(accountId)) eventsByAccount.set(accountId, []);
      eventsByAccount.get(accountId).push(event);
    }
    for (const [accountId, groupedEvents] of eventsByAccount) addEntry(accountId, entry, groupedEvents);
  }
  if (!groups.size) throw httpError(400, 'Instagram webhook could not be routed.');
  return groups;
}

async function listChannels(env, workspaceId, includeConfiguration = false) {
  const [result, storedCredentials] = await Promise.all([
    env.DB.prepare(`SELECT channel_id,name,connector_type,provider_type,enabled,capabilities_json,config_json,secret_key
    FROM channels WHERE workspace_id=?1 ORDER BY name COLLATE NOCASE`).bind(workspaceId).all(),
    env.DB.prepare('SELECT channel_id,credential_key FROM channel_credentials WHERE workspace_id=?1').bind(workspaceId).all()
  ]);
  const fieldsByChannel = new Map();
  for (const item of storedCredentials.results || []) {
    if (!fieldsByChannel.has(item.channel_id)) fieldsByChannel.set(item.channel_id, new Set());
    fieldsByChannel.get(item.channel_id).add(item.credential_key);
  }
  return result.results.map(row => {
    const config = safeJsonParse(row.config_json, {});
    const connectorType = logicalConnectorType(row);
    const credentialFields = fieldsByChannel.get(row.channel_id) || new Set();
    return {
      channelId: row.channel_id, name: row.name, connectorType,
      enabled: Boolean(row.enabled), capabilities: safeJsonParse(row.capabilities_json, []),
      health: channelHealth(row, config, credentialFields),
      ...(includeConfiguration ? { config: publicChannelConfig(connectorType, config), setup: channelSetupView(row, config, credentialFields) } : {})
    };
  });
}

function channelHealth(row, config = safeJsonParse(row.config_json, {}), credentialFields = new Set()) {
  if (!row.enabled) return 'disconnected';
  const connectorType = logicalConnectorType(row);
  const definition = CONNECTOR_DEFINITIONS[connectorType];
  if (!definition) return 'connected';
  const configured = definition.requiredConfig.every(key => Boolean(config[key])) &&
    definition.requiredCredentials.every(key => credentialFields.has(key));
  if (!configured) return 'setup_required';
  if (!config.credentialsVerifiedAt) return config.webhookVerifiedAt ? 'receiving' : 'configured';
  if (!config.webhookVerifiedAt) return 'webhook_required';
  return 'connected';
}

function channelSetupView(row, config = safeJsonParse(row.config_json, {}), credentialFields = new Set()) {
  const connectorType = logicalConnectorType(row);
  const definition = CONNECTOR_DEFINITIONS[connectorType];
  if (!definition) return {};
  const presence = Object.fromEntries(definition.requiredCredentials.map(key => [key, credentialFields.has(key)]));
  const callbackPath = connectorType === 'instagram' && config.appId
    ? `/webhooks/instagram-app/${encodeURIComponent(config.appId)}`
    : `/webhooks/${definition.webhookPath}/${encodeURIComponent(row.channel_id)}`;
  return {
    credentialsPresent: definition.requiredConfig.every(key => Boolean(config[key])) && Object.values(presence).every(Boolean),
    credentialFields: presence,
    callbackPath,
    credentialsVerifiedAt: config.credentialsVerifiedAt || '',
    subscribedAppsAt: config.subscribedAppsAt || '',
    webhookVerifiedAt: config.webhookVerifiedAt || '',
    lastWebhookAt: config.lastWebhookAt || '',
    verifiedPhoneNumber: config.verifiedPhoneNumber || '',
    verifiedName: config.verifiedName || '',
    verifiedUsername: config.verifiedUsername || '',
    verifiedProviderId: config.verifiedProviderId || ''
  };
}

async function getChannel(env, id, connectorType = '', workspaceId = '') {
  const row = await env.DB.prepare(`SELECT channel_id,name,connector_type,provider_type,enabled,capabilities_json,config_json,secret_key,workspace_id
    FROM channels WHERE channel_id=?1 AND enabled=1 AND (?2='' OR workspace_id=?2)`).bind(id, workspaceId).first();
  const logicalType = row ? logicalConnectorType(row) : '';
  if (!row || (connectorType && logicalType !== connectorType)) return null;
  return {
    channelId: row.channel_id, name: row.name, connectorType: logicalType,
    capabilities: safeJsonParse(row.capabilities_json, []), config: safeJsonParse(row.config_json, {}),
    secretKey: row.secret_key, workspaceId: row.workspace_id
  };
}

async function verifyChannel(env, workspaceId, channelId, request) {
  const channel = await getChannel(env, channelId, '', workspaceId);
  if (!channel) throw httpError(404, 'Channel not found.');
  if (channel.connectorType === 'whatsapp_cloud') return verifyWhatsAppChannel(env, channel);
  if (channel.connectorType === 'telegram') return verifyTelegramChannel(env, channel, request);
  if (channel.connectorType === 'instagram') return verifyInstagramChannel(env, channel);
  throw httpError(400, 'This connector cannot be verified automatically.');
}

async function getChannelVerifyToken(env, workspaceId, channelId, principal) {
  const id = cleanId(channelId, 'Channel ID');
  const row = await env.DB.prepare(`SELECT channel_id,name,connector_type,provider_type,config_json,secret_key,workspace_id
    FROM channels WHERE channel_id=?1 AND workspace_id=?2`).bind(id, workspaceId).first();
  if (!row) throw httpError(404, 'Channel not found.');
  const connectorType = logicalConnectorType(row);
  if (!['whatsapp_cloud', 'instagram'].includes(connectorType)) {
    throw httpError(400, 'This channel does not use a webhook verify token.');
  }
  const channel = {
    channelId: row.channel_id,
    name: row.name,
    connectorType,
    config: safeJsonParse(row.config_json, {}),
    secretKey: row.secret_key,
    workspaceId: row.workspace_id
  };
  const verifyToken = (await readChannelCredentials(env, channel)).verifyToken || '';
  if (!verifyToken) throw httpError(404, 'No webhook verify token is saved for this channel.');
  await audit(env, principal, 'read_verify_token', 'channel', id, {});
  return { ok: true, channelId: id, verifyToken };
}

async function verifyWhatsAppChannel(env, channel) {
  const channelId = channel.channelId;
  const credentials = await readChannelCredentials(env, channel);
  const token = credentials.accessToken;
  const wabaId = String(channel.config?.wabaId || '');
  const phoneNumberId = String(channel.config?.phoneNumberId || '');
  const verifyToken = credentials.verifyToken;
  const appSecret = credentials.appSecret;
  if (!token || !wabaId || !phoneNumberId || !verifyToken || !appSecret) {
    throw httpError(409, 'Secure WhatsApp credentials have not been fully configured.');
  }
  assertMetaAppSecret(appSecret, 422);
  const version = metaApiVersion(channel.config?.apiVersion);
  const endpoint = new URL(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(wabaId)}/phone_numbers`);
  endpoint.searchParams.set('fields', 'id,display_phone_number,verified_name');
  endpoint.searchParams.set('limit', '100');
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  const raw = await response.text();
  const data = safeJsonParse(raw, {});
  if (!response.ok) {
    if (isMetaObjectVisibilityError(data)) {
      throw httpError(422, 'The saved access token cannot access this Messaging/WhatsApp Business Account. Assign the token user or System User to this exact WhatsApp account, then regenerate the token with whatsapp_business_management.');
    }
    throw httpError(422, `Meta could not verify this WhatsApp number: ${providerError(data, response.status)}`);
  }
  const phone = Array.isArray(data.data) ? data.data.find(item => String(item?.id || '') === phoneNumberId) : null;
  if (!phone) throw httpError(422, 'The WhatsApp phone number does not belong to the configured WABA.');
  const subscriptionEndpoint = new URL(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(wabaId)}/subscribed_apps`);
  const subscriptionResponse = await fetch(subscriptionEndpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  const subscriptionData = safeJsonParse(await subscriptionResponse.text(), {});
  if (!subscriptionResponse.ok || subscriptionData.success === false) {
    throw httpError(422, `Meta could not subscribe this app to the WhatsApp Business Account: ${providerError(subscriptionData, subscriptionResponse.status)}`);
  }
  const now = new Date().toISOString();
  const config = await updateChannelRuntimeConfig(env, channel, {
    apiVersion: version,
    credentialsVerifiedAt: now,
    subscribedAppsAt: now,
    verifiedProviderId: phoneNumberId,
    verifiedPhoneNumber: String(phone.display_phone_number || ''),
    verifiedName: String(phone.verified_name || '')
  });
  return {
    ok: true,
    channelId,
    health: config.webhookVerifiedAt ? 'connected' : 'webhook_required',
    verifiedPhoneNumber: config.verifiedPhoneNumber,
    verifiedName: config.verifiedName,
    credentialsVerifiedAt: config.credentialsVerifiedAt,
    subscribedToWaba: true,
    subscribedAppsAt: config.subscribedAppsAt,
    webhookVerifiedAt: config.webhookVerifiedAt || ''
  };
}

async function verifyTelegramChannel(env, channel, request) {
  const credentials = await readChannelCredentials(env, channel);
  if (!credentials.botToken || !credentials.webhookSecret) {
    throw httpError(409, 'Secure Telegram credentials have not been fully configured.');
  }
  const base = `https://api.telegram.org/bot${credentials.botToken}`;
  const identityResponse = await fetch(`${base}/getMe`);
  const identityData = safeJsonParse(await identityResponse.text(), {});
  if (!identityResponse.ok || identityData.ok === false) {
    throw httpError(422, `Telegram could not verify this bot: ${providerError(identityData, identityResponse.status)}`);
  }
  const now = new Date().toISOString();
  const user = identityData.result || {};
  const botId = String(user.id || '');
  if (!botId) throw httpError(422, 'Telegram did not return a bot identity.');
  await assertUniqueVerifiedProviderId(env, channel.workspaceId, 'telegram', channel.channelId, botId);
  let config = await updateChannelRuntimeConfig(env, channel, {
    credentialsVerifiedAt: now, verifiedProviderId: botId, verifiedName: String(user.first_name || ''),
    verifiedUsername: String(user.username || '')
  });
  const callbackUrl = `${new URL(request.url).origin}/webhooks/telegram/${encodeURIComponent(channel.channelId)}`;
  const webhookResponse = await fetch(`${base}/setWebhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: callbackUrl, secret_token: credentials.webhookSecret, allowed_updates: ['message', 'edited_message', 'channel_post'] })
  });
  const webhookData = safeJsonParse(await webhookResponse.text(), {});
  if (!webhookResponse.ok || webhookData.ok === false) {
    throw httpError(422, `Telegram could not set the webhook: ${providerError(webhookData, webhookResponse.status)}`);
  }
  config = await updateChannelRuntimeConfig(env, channel, { webhookVerifiedAt: now });
  return { ok: true, channelId: channel.channelId, health: 'connected', verifiedName: config.verifiedName,
    verifiedUsername: config.verifiedUsername, credentialsVerifiedAt: now, webhookVerifiedAt: now };
}

async function verifyInstagramChannel(env, channel) {
  const credentials = await readChannelCredentials(env, channel);
  const accountId = String(channel.config?.instagramAccountId || '');
  if (!credentials.accessToken || !credentials.verifyToken || !credentials.appSecret || !accountId) {
    throw httpError(409, 'Secure Instagram credentials have not been fully configured.');
  }
  assertMetaAppSecret(credentials.appSecret, 422);
  const version = metaApiVersion(channel.config?.apiVersion);
  const endpoint = new URL(`https://graph.instagram.com/${encodeURIComponent(version)}/me`);
  endpoint.searchParams.set('fields', 'user_id,username');
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
  const data = safeJsonParse(await response.text(), {});
  if (!response.ok) throw httpError(422, `Meta could not verify this Instagram account: ${providerError(data, response.status)}`);
  if (String(data.user_id || '') !== accountId) throw httpError(422, 'Meta returned a different Instagram account.');
  const now = new Date().toISOString();
  const config = await updateChannelRuntimeConfig(env, channel, {
    apiVersion: version, credentialsVerifiedAt: now, verifiedProviderId: accountId,
    verifiedName: String(data.username || ''), verifiedUsername: String(data.username || '')
  });
  return { ok: true, channelId: channel.channelId, health: config.webhookVerifiedAt ? 'connected' : 'webhook_required',
    verifiedName: config.verifiedName, verifiedUsername: config.verifiedUsername,
    credentialsVerifiedAt: now, webhookVerifiedAt: config.webhookVerifiedAt || '' };
}

async function updateChannelRuntimeConfig(env, channel, patch) {
  const config = { ...(channel.config || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === undefined || value === null || value === '') delete config[key];
    else config[key] = value;
  }
  const now = new Date().toISOString();
  try {
    await env.DB.prepare('UPDATE channels SET config_json=?3,updated_at=?4 WHERE channel_id=?1 AND workspace_id=?2')
      .bind(channel.channelId, channel.workspaceId, JSON.stringify(config), now).run();
  } catch (error) {
    if (isUniqueConstraintError(error)) throw httpError(409, 'This provider identity is already connected in the workspace.');
    throw error;
  }
  channel.config = config;
  return config;
}

async function saveChannel(env, workspaceId, payload, principal, forcedChannelId = '') {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw httpError(400, 'Channel payload is invalid.');
  const channelId = cleanId(forcedChannelId || payload.channelId || crypto.randomUUID(), 'Channel ID');
  const existing = await env.DB.prepare('SELECT * FROM channels WHERE channel_id=?1 AND workspace_id=?2')
    .bind(channelId, workspaceId).first();
  if (forcedChannelId && !existing) throw httpError(404, 'Channel not found.');
  if (!forcedChannelId && existing) throw httpError(409, 'Channel ID already exists.');
  const existingType = existing ? logicalConnectorType(existing) : '';
  const connectorType = cleanRequired(payload.connectorType || existingType, 'Connector type', 40);
  if (!MANAGED_CONNECTORS.has(connectorType) && !['generic_http', 'web_chat'].includes(connectorType)) {
    throw httpError(400, 'Unsupported connector type.');
  }
  if (existingType && connectorType !== existingType) throw httpError(400, 'A channel provider cannot be changed after creation.');
  const name = cleanRequired(payload.name || existing?.name, 'Channel name', 80);
  if (!MANAGED_CONNECTORS.has(connectorType)) {
    return saveLegacyChannel(env, workspaceId, payload, principal, existing, channelId, name, connectorType);
  }
  const now = new Date().toISOString();
  const previousConfig = safeJsonParse(existing?.config_json, {});
  const config = mergeChannelConfig(connectorType, previousConfig, payload.config);
  await assertUniqueManagedConfig(env, workspaceId, connectorType, channelId, config);
  const credentialUpdates = validateCredentialPayload(connectorType, payload.credentials);
  if (Object.keys(credentialUpdates).length) await importChannelCredentialKey(env.CHANNEL_CREDENTIALS_KEY);
  const changedConfigFields = editableConfigChanges(connectorType, previousConfig, config);
  invalidateChannelVerification(connectorType, config, changedConfigFields, Object.keys(credentialUpdates));
  const collision = await env.DB.prepare('SELECT workspace_id FROM channels WHERE channel_id=?1').bind(channelId).first();
  if (collision && collision.workspace_id !== workspaceId) throw httpError(409, 'Channel ID is already used by another workspace.');
  const storageType = connectorType === 'instagram' ? 'generic_http' : connectorType;
  const enabled = payload.enabled === undefined ? (existing ? Boolean(existing.enabled) : true) : payload.enabled !== false;
  let saved;
  try {
    saved = await env.DB.prepare(`INSERT INTO channels
        (channel_id,name,connector_type,provider_type,enabled,capabilities_json,config_json,secret_key,created_at,updated_at,workspace_id)
      VALUES (?1,?2,?3,?4,?5,?6,?7,'DATABASE',?8,?8,?9)
      ON CONFLICT(channel_id) DO UPDATE SET name=excluded.name,connector_type=excluded.connector_type,
        provider_type=excluded.provider_type,enabled=excluded.enabled,capabilities_json=excluded.capabilities_json,
        config_json=excluded.config_json,secret_key='DATABASE',updated_at=excluded.updated_at
        WHERE channels.workspace_id=excluded.workspace_id`)
      .bind(channelId, name, storageType, connectorType, enabled ? 1 : 0, JSON.stringify(['text']), JSON.stringify(config), now, workspaceId).run();
  } catch (error) {
    if (isUniqueConstraintError(error)) throw httpError(409, 'This provider identity is already connected in the workspace.');
    throw error;
  }
  if (!saved.meta?.changes) throw httpError(409, 'Channel ID is already used by another workspace.');
  if (Object.keys(credentialUpdates).length) {
    await storeChannelCredentials(env, { workspaceId, channelId, connectorType }, credentialUpdates, principal.user.userId || '');
  }
  await audit(env, principal, existing ? 'update' : 'create', 'channel', channelId, {
    name, connectorType, enabled, updatedCredentialFields: Object.keys(credentialUpdates).sort()
  });
  return { ok: true, channelId };
}

async function saveLegacyChannel(env, workspaceId, payload, principal, existing, channelId, name, connectorType) {
  const hasConfig = Object.hasOwn(payload, 'config');
  if (hasConfig && (payload.config === null || typeof payload.config !== 'object' || Array.isArray(payload.config))) {
    throw httpError(400, 'Channel configuration must be an object.');
  }
  const config = hasConfig ? payload.config : safeJsonParse(existing?.config_json, {});
  if (JSON.stringify(config).length > MAX_JSON_BODY) throw httpError(400, 'Channel configuration is too large.');
  if (connectorType === 'generic_http' && config.endpoint) assertAllowedHttpsEndpoint(config.endpoint, config.allowedHosts || []);
  const hasExplicitSecretKey = typeof payload.secretKey === 'string' && payload.secretKey.trim() !== '';
  const requestedPrefix = secretPrefix(cleanRequired(payload.secretKey || existing?.secret_key || `CHANNEL_${channelId}`, 'Secret key', 64));
  const collision = await env.DB.prepare('SELECT workspace_id,secret_key FROM channels WHERE channel_id=?1').bind(channelId).first();
  if (collision && collision.workspace_id !== workspaceId) throw httpError(409, 'Channel ID is already used by another workspace.');
  const prefix = collision && (!hasExplicitSecretKey || secretPrefix(collision.secret_key) === requestedPrefix)
    ? collision.secret_key
    : workspaceSecretPrefix(workspaceId, requestedPrefix);
  const enabled = payload.enabled === undefined ? (existing ? Boolean(existing.enabled) : true) : payload.enabled !== false;
  const now = new Date().toISOString();
  const saved = await env.DB.prepare(`INSERT INTO channels
      (channel_id,name,connector_type,provider_type,enabled,capabilities_json,config_json,secret_key,created_at,updated_at,workspace_id)
    VALUES (?1,?2,?3,?3,?4,?5,?6,?7,?8,?8,?9)
    ON CONFLICT(channel_id) DO UPDATE SET name=excluded.name,connector_type=excluded.connector_type,
      provider_type=excluded.provider_type,enabled=excluded.enabled,capabilities_json=excluded.capabilities_json,
      config_json=excluded.config_json,secret_key=excluded.secret_key,updated_at=excluded.updated_at
      WHERE channels.workspace_id=excluded.workspace_id`)
    .bind(channelId, name, connectorType, enabled ? 1 : 0, JSON.stringify(['text']), JSON.stringify(config), prefix, now, workspaceId).run();
  if (!saved.meta?.changes) throw httpError(409, 'Channel ID is already used by another workspace.');
  await audit(env, principal, existing ? 'update' : 'create', 'channel', channelId, { name, connectorType, enabled });
  return { ok: true, channelId };
}

async function deleteChannel(env, workspaceId, channelId, principal) {
  const id = cleanId(channelId, 'Channel ID');
  const channel = await env.DB.prepare('SELECT name FROM channels WHERE channel_id=?1 AND workspace_id=?2').bind(id, workspaceId).first();
  if (!channel) throw httpError(404, 'Channel not found.');
  const linked = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM channel_identities WHERE channel_id=?1 AND workspace_id=?2) +
      (SELECT COUNT(*) FROM conversations WHERE channel_id=?1 AND workspace_id=?2) +
      (SELECT COUNT(*) FROM messages WHERE channel_id=?1 AND workspace_id=?2) AS count`)
    .bind(id, workspaceId).first();
  if (Number(linked?.count || 0) > 0) throw httpError(409, 'Disable this channel instead; it already has conversation history.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM channel_credentials WHERE channel_id=?1 AND workspace_id=?2').bind(id, workspaceId),
    env.DB.prepare('DELETE FROM webhook_events WHERE channel_id=?1 AND workspace_id=?2').bind(id, workspaceId),
    env.DB.prepare('DELETE FROM channels WHERE channel_id=?1 AND workspace_id=?2').bind(id, workspaceId)
  ]);
  await audit(env, principal, 'delete', 'channel', id, { name: channel.name });
  return { ok: true, channelId: id };
}

function logicalConnectorType(row) {
  return String(row?.provider_type || row?.providerType || row?.connector_type || row?.connectorType || '').trim();
}

function publicChannelConfig(connectorType, config = {}) {
  const definition = CONNECTOR_DEFINITIONS[connectorType];
  if (!definition) return {};
  return Object.fromEntries(definition.configFields
    .filter(key => config[key] !== undefined && config[key] !== null && config[key] !== '')
    .map(key => [key, config[key]]));
}

function mergeChannelConfig(connectorType, previous = {}, supplied) {
  const definition = CONNECTOR_DEFINITIONS[connectorType];
  if (!definition) throw httpError(400, 'Unsupported connector type.');
  if (supplied !== undefined && (supplied === null || typeof supplied !== 'object' || Array.isArray(supplied))) {
    throw httpError(400, 'Channel configuration must be an object.');
  }
  const config = { ...(previous || {}) };
  if (supplied) {
    const unknown = Object.keys(supplied).filter(key => !definition.configFields.includes(key));
    if (unknown.length) throw httpError(400, `Unsupported channel configuration field: ${unknown[0]}.`);
    for (const key of definition.configFields) {
      if (!Object.hasOwn(supplied, key)) continue;
      const value = normalizeChannelConfigValue(key, supplied[key]);
      if (value) config[key] = value;
      else delete config[key];
    }
  }
  if ((connectorType === 'whatsapp_cloud' || connectorType === 'instagram') && !config.apiVersion) config.apiVersion = 'v26.0';
  if (connectorType === 'instagram' && !config.authMode) config.authMode = 'instagram_login';
  if (JSON.stringify(publicChannelConfig(connectorType, config)).length > 4096) throw httpError(400, 'Channel configuration is too large.');
  return config;
}

function normalizeChannelConfigValue(key, value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' && typeof value !== 'number') throw httpError(400, `${key} must be text.`);
  const text = String(value).trim();
  if (!text) return '';
  if (key === 'apiVersion') return metaApiVersion(text);
  if (key === 'username') {
    if (!/^[A-Za-z0-9._]{1,30}$/.test(text)) throw httpError(400, 'Instagram username is invalid.');
    return text;
  }
  if (key === 'authMode') {
    if (text !== 'instagram_login') throw httpError(400, 'Instagram authentication mode is invalid.');
    return text;
  }
  return cleanMetaIdentifier(text, key);
}

function editableConfigChanges(connectorType, before = {}, after = {}) {
  const fields = CONNECTOR_DEFINITIONS[connectorType]?.configFields || [];
  return fields.filter(key => String(before[key] || '') !== String(after[key] || ''));
}

function invalidateChannelVerification(connectorType, config, changedConfigFields = [], changedCredentialFields = []) {
  const providerCredentialChanged = connectorType === 'whatsapp_cloud' || connectorType === 'instagram'
    ? changedCredentialFields.some(key => key !== 'verifyToken')
    : changedCredentialFields.length > 0;
  if (changedConfigFields.length || providerCredentialChanged) {
    for (const key of ['credentialsVerifiedAt', 'subscribedAppsAt', 'verifiedPhoneNumber',
      'verifiedName', 'verifiedUsername', 'verifiedProviderId']) delete config[key];
  }

  const webhookCredentialChanged = connectorType === 'telegram'
    ? changedCredentialFields.some(key => key === 'botToken' || key === 'webhookSecret')
    : changedCredentialFields.includes('verifyToken');
  if (changedConfigFields.length || webhookCredentialChanged) delete config.webhookVerifiedAt;

  const providerIdentityFields = connectorType === 'whatsapp_cloud'
    ? new Set(['wabaId', 'phoneNumberId'])
    : connectorType === 'instagram'
      ? new Set(['instagramAccountId', 'appId'])
      : new Set();
  if (changedConfigFields.some(key => providerIdentityFields.has(key))) delete config.lastWebhookAt;
}

async function assertUniqueManagedConfig(env, workspaceId, connectorType, channelId, config) {
  const field = connectorType === 'whatsapp_cloud' ? 'phoneNumberId'
    : connectorType === 'instagram' ? 'instagramAccountId' : '';
  const value = field ? String(config[field] || '') : '';
  if (!value) return;
  const jsonPath = field === 'phoneNumberId' ? '$.phoneNumberId' : '$.instagramAccountId';
  const duplicate = await env.DB.prepare(`SELECT channel_id FROM channels
    WHERE workspace_id=?1 AND channel_id<>?2 AND provider_type=?3
      AND json_extract(config_json,?4)=?5 LIMIT 1`)
    .bind(workspaceId, channelId, connectorType, jsonPath, value).first();
  if (duplicate) throw httpError(409, `This ${connectorType === 'whatsapp_cloud' ? 'WhatsApp phone number' : 'Instagram account'} is already connected in the workspace.`);
}

async function assertUniqueVerifiedProviderId(env, workspaceId, connectorType, channelId, providerId) {
  const duplicate = await env.DB.prepare(`SELECT channel_id FROM channels
    WHERE workspace_id=?1 AND channel_id<>?2 AND provider_type=?3
      AND json_extract(config_json,'$.verifiedProviderId')=?4 LIMIT 1`)
    .bind(workspaceId, channelId, connectorType, providerId).first();
  if (duplicate) throw httpError(409, 'This Telegram bot is already connected in the workspace.');
}

function isUniqueConstraintError(error) {
  return /unique constraint/i.test(String(error?.message || error || ''));
}

function validateCredentialPayload(connectorType, supplied) {
  if (supplied === undefined || supplied === null) return {};
  if (typeof supplied !== 'object' || Array.isArray(supplied)) throw httpError(400, 'Credentials must be an object.');
  const allowed = CONNECTOR_DEFINITIONS[connectorType]?.requiredCredentials || [];
  const unknown = Object.keys(supplied).filter(key => !allowed.includes(key));
  if (unknown.length) throw httpError(400, `Unsupported credential field: ${unknown[0]}.`);
  const credentials = {};
  for (const key of allowed) {
    if (!Object.hasOwn(supplied, key)) continue;
    if (typeof supplied[key] !== 'string') throw httpError(400, `${credentialLabel(key)} must be text.`);
    const value = supplied[key].trim();
    if (!value) continue;
    if (value.length > MAX_CREDENTIAL_LENGTH) throw httpError(400, `${credentialLabel(key)} is too long.`);
    if (/[\u0000-\u001f\u007f]/.test(value)) throw httpError(400, `${credentialLabel(key)} contains invalid characters.`);
    if (key === 'accessToken' && value.length < 16) throw httpError(400, 'Access token is too short.');
    if (key === 'appSecret') {
      if (value.length < 16) throw httpError(400, 'App secret is too short.');
      assertMetaAppSecret(value);
    }
    if (key === 'verifyToken' && value.length > 256) throw httpError(400, 'Verify token is too long.');
    if (key === 'botToken' && !/^\d{5,15}:[A-Za-z0-9_-]{20,}$/.test(value)) throw httpError(400, 'Telegram bot token format is invalid.');
    if (key === 'webhookSecret' && !/^[A-Za-z0-9_-]{1,256}$/.test(value)) {
      throw httpError(400, 'Telegram webhook secret may contain only letters, numbers, underscores, and hyphens.');
    }
    credentials[key] = value;
  }
  return credentials;
}

function assertMetaAppSecret(value, status = 400) {
  const secret = String(value || '');
  if ((/^EAA/i.test(secret) && secret.length > 64) || secret.length > 128) {
    throw httpError(status, 'Meta App Secret is invalid. Use App Settings → Basic → App Secret, not an access token or Client Token.');
  }
}

function credentialLabel(key) {
  return ({ accessToken: 'Access token', appSecret: 'App secret', verifyToken: 'Verify token',
    botToken: 'Telegram bot token', webhookSecret: 'Telegram webhook secret' })[key] || 'Credential';
}

async function storeChannelCredentials(env, channel, credentials, updatedByUserId = '') {
  const entries = Object.entries(credentials || {});
  if (!entries.length) return;
  const now = new Date().toISOString();
  const statements = [];
  for (const [credentialKey, value] of entries) {
    const encryptedValue = await encryptChannelCredential(value, env.CHANNEL_CREDENTIALS_KEY,
      channel.workspaceId, channel.channelId, credentialKey);
    statements.push(env.DB.prepare(`INSERT INTO channel_credentials
        (workspace_id,channel_id,credential_key,encrypted_value,created_at,updated_at,updated_by_user_id)
      SELECT ?1,?2,?3,?4,?5,?5,?6
      WHERE EXISTS (SELECT 1 FROM channels WHERE channel_id=?2 AND workspace_id=?1)
      ON CONFLICT(workspace_id,channel_id,credential_key) DO UPDATE SET
        encrypted_value=excluded.encrypted_value,updated_at=excluded.updated_at,
        updated_by_user_id=excluded.updated_by_user_id`)
      .bind(channel.workspaceId, channel.channelId, credentialKey, encryptedValue, now, String(updatedByUserId || '').slice(0, 100)));
  }
  const results = await env.DB.batch(statements);
  if (results.some(result => !result.meta?.changes)) throw httpError(409, 'Channel credentials could not be saved.');
}

async function readChannelCredentials(env, channel) {
  const result = await env.DB.prepare(`SELECT credential_key,encrypted_value FROM channel_credentials
    WHERE workspace_id=?1 AND channel_id=?2`).bind(channel.workspaceId, channel.channelId).all();
  if (!result.results?.length) return {};
  const allowed = new Set(CONNECTOR_DEFINITIONS[channel.connectorType]?.requiredCredentials || []);
  const credentials = {};
  try {
    for (const row of result.results) {
      if (!allowed.has(row.credential_key)) continue;
      credentials[row.credential_key] = await decryptChannelCredential(row.encrypted_value,
        env.CHANNEL_CREDENTIALS_KEY, channel.workspaceId, channel.channelId, row.credential_key);
    }
  } catch (error) {
    if (error?.status === 503) throw error;
    throw httpError(503, 'Stored channel credentials could not be decrypted.');
  }
  return credentials;
}

export async function encryptChannelCredential(value, masterSecret, workspaceId, channelId, credentialKey) {
  const plaintext = String(value || '');
  if (!plaintext || plaintext.length > MAX_CREDENTIAL_LENGTH) throw httpError(400, 'Credential value is invalid.');
  const key = await importChannelCredentialKey(masterSecret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = channelCredentialAad(workspaceId, channelId, credentialKey);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key,
    new TextEncoder().encode(plaintext));
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(encrypted))}`;
}

export async function decryptChannelCredential(packed, masterSecret, workspaceId, channelId, credentialKey) {
  const parts = String(packed || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('Unsupported encrypted credential format.');
  const iv = base64UrlDecode(parts[1]);
  const ciphertext = base64UrlDecode(parts[2]);
  if (iv.length !== 12 || !ciphertext.length) throw new Error('Encrypted credential is invalid.');
  const key = await importChannelCredentialKey(masterSecret);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv,
    additionalData: channelCredentialAad(workspaceId, channelId, credentialKey) }, key, ciphertext);
  const plaintext = new TextDecoder().decode(decrypted);
  if (!plaintext || plaintext.length > MAX_CREDENTIAL_LENGTH) throw new Error('Decrypted credential is invalid.');
  return plaintext;
}

export async function encryptOutboundPayload(value, masterSecret, workspaceId, messageId) {
  const plaintext = typeof value === 'string' ? value : JSON.stringify(value);
  if (!plaintext || new TextEncoder().encode(plaintext).byteLength > MAX_EXTERNAL_JSON_BODY) {
    throw httpError(400, 'Outbound template payload is invalid or too large.');
  }
  const key = await importChannelCredentialKey(masterSecret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = outboundPayloadAad(workspaceId, messageId);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key,
    new TextEncoder().encode(plaintext));
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(encrypted))}`;
}

export async function decryptOutboundPayload(packed, masterSecret, workspaceId, messageId) {
  const parts = String(packed || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('Unsupported encrypted outbound payload format.');
  const iv = base64UrlDecode(parts[1]);
  const ciphertext = base64UrlDecode(parts[2]);
  if (iv.length !== 12 || !ciphertext.length) throw new Error('Encrypted outbound payload is invalid.');
  const key = await importChannelCredentialKey(masterSecret);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv,
    additionalData: outboundPayloadAad(workspaceId, messageId) }, key, ciphertext);
  const plaintext = new TextDecoder().decode(decrypted);
  if (!plaintext || new TextEncoder().encode(plaintext).byteLength > MAX_EXTERNAL_JSON_BODY) {
    throw new Error('Decrypted outbound payload is invalid.');
  }
  return JSON.parse(plaintext);
}

async function importChannelCredentialKey(masterSecret) {
  const bytes = new TextEncoder().encode(String(masterSecret || ''));
  if (bytes.length < 32) throw httpError(503, 'Channel credential encryption is not configured.');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function channelCredentialAad(workspaceId, channelId, credentialKey) {
  return new TextEncoder().encode(`helixcer-channel-v1\n${workspaceId}\n${channelId}\n${credentialKey}`);
}

function outboundPayloadAad(workspaceId, messageId) {
  return new TextEncoder().encode(`helixcer-outbound-v1\n${workspaceId}\n${messageId}`);
}

function base64UrlEncode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const input = String(value || '');
  if (!/^[A-Za-z0-9_-]+$/.test(input)) throw new Error('Encrypted credential encoding is invalid.');
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - input.length % 4) % 4);
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}

async function listConversations(env, workspaceId, url) {
  const limit = clampInt(url.searchParams.get('limit'), 1, 100, 50);
  const status = url.searchParams.get('status') || '';
  const channelId = url.searchParams.get('channelId') || '';
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const cursor = url.searchParams.get('cursor') || '';
  const result = await env.DB.prepare(`SELECT c.conversation_id,c.contact_id,c.channel_id,c.status,c.assigned_to,
      c.subject,c.last_message_at,c.unread_count,c.tags_json,ch.name AS channel_name,ch.connector_type,ch.provider_type,
      (SELECT text FROM messages m WHERE m.workspace_id=c.workspace_id AND m.conversation_id=c.conversation_id ORDER BY timestamp DESC LIMIT 1) AS last_message,
      (SELECT MAX(timestamp) FROM messages inbound WHERE inbound.workspace_id=c.workspace_id
        AND inbound.conversation_id=c.conversation_id AND inbound.direction='inbound') AS last_inbound_at
    FROM conversations c JOIN channels ch ON ch.channel_id=c.channel_id
    WHERE c.workspace_id=?1 AND ch.workspace_id=?1 AND (?2='' OR c.status=?2) AND (?3='' OR c.channel_id=?3)
      AND (?4='' OR c.subject LIKE '%'||?4||'%' OR c.conversation_id LIKE '%'||?4||'%')
      AND (?5='' OR c.last_message_at<?5)
    ORDER BY c.last_message_at DESC LIMIT ?6`).bind(workspaceId, status, channelId, q, cursor, limit).all();
  return result.results.map(row => {
    const connectorType = logicalConnectorType(row);
    return {
      conversationId: row.conversation_id, contactId: row.contact_id, channelId: row.channel_id,
      channelName: row.channel_name, connectorType, status: row.status, assignedTo: row.assigned_to,
      subject: row.subject, lastMessageAt: row.last_message_at, unreadCount: row.unread_count,
      tags: safeJsonParse(row.tags_json, []), lastMessage: row.last_message || '',
      ...whatsappReplyWindowState(connectorType, row.last_inbound_at)
    };
  });
}

async function getConversationReplyWindow(env, workspaceId, conversationId) {
  const row = await env.DB.prepare(`SELECT ch.connector_type,ch.provider_type,
      (SELECT MAX(timestamp) FROM messages m WHERE m.workspace_id=c.workspace_id
        AND m.conversation_id=c.conversation_id AND m.direction='inbound') AS last_inbound_at
    FROM conversations c JOIN channels ch ON ch.channel_id=c.channel_id AND ch.workspace_id=c.workspace_id
    WHERE c.conversation_id=?1 AND c.workspace_id=?2`).bind(conversationId, workspaceId).first();
  if (!row) throw httpError(404, 'Conversation not found.');
  return whatsappReplyWindowState(logicalConnectorType(row), row.last_inbound_at);
}

export function whatsappReplyWindowState(connectorType, lastInboundAt, now = Date.now()) {
  if (connectorType !== 'whatsapp_cloud') {
    return { freeformAllowed: true, replyWindowExpiresAt: '', replyWindowReason: '' };
  }
  const inboundTime = new Date(String(lastInboundAt || '')).valueOf();
  if (!Number.isFinite(inboundTime)) {
    return {
      freeformAllowed: false,
      replyWindowExpiresAt: '',
      replyWindowReason: 'No customer message has opened the WhatsApp 24-hour service window. Send an approved template.'
    };
  }
  const expiresAt = inboundTime + WHATSAPP_REPLY_WINDOW_MS;
  const freeformAllowed = Number(now) <= expiresAt;
  return {
    freeformAllowed,
    replyWindowExpiresAt: new Date(expiresAt).toISOString(),
    replyWindowReason: freeformAllowed
      ? ''
      : 'The WhatsApp 24-hour service window has closed. Send an approved template to continue.'
  };
}

async function listContacts(env, workspaceId, url) {
  const limit = clampInt(url.searchParams.get('contactLimit'), 1, 200, 100);
  const result = await env.DB.prepare(`SELECT c.contact_id,c.display_name,c.company,c.tags_json,c.attributes_json,c.updated_at,
      i.identity_id,i.channel_id,i.channel_profile_id,ch.name AS channel_name,ch.connector_type,ch.provider_type,
      cv.status AS conversation_status,cv.last_message_at
    FROM contacts c
    LEFT JOIN channel_identities i ON i.identity_id=(SELECT identity_id FROM channel_identities
      WHERE workspace_id=c.workspace_id AND contact_id=c.contact_id ORDER BY created_at LIMIT 1)
    LEFT JOIN channels ch ON ch.workspace_id=c.workspace_id AND ch.channel_id=i.channel_id
    LEFT JOIN conversations cv ON cv.conversation_id=(SELECT conversation_id FROM conversations
      WHERE workspace_id=c.workspace_id AND contact_id=c.contact_id ORDER BY last_message_at DESC LIMIT 1)
    WHERE c.workspace_id=?1
    ORDER BY COALESCE(cv.last_message_at,c.updated_at) DESC LIMIT ?2`).bind(workspaceId, limit).all();
  return (result.results || []).map(contactView);
}

async function loadContactRow(env, workspaceId, contactId) {
  return env.DB.prepare(`SELECT c.contact_id,c.display_name,c.company,c.tags_json,c.attributes_json,c.updated_at,
      i.identity_id,i.channel_id,i.channel_profile_id,ch.name AS channel_name,ch.connector_type,ch.provider_type,
      cv.status AS conversation_status,cv.last_message_at,
      (SELECT COUNT(*) FROM channel_identities identities
        WHERE identities.workspace_id=c.workspace_id AND identities.contact_id=c.contact_id) AS identity_count,
      (SELECT COUNT(*) FROM conversations conversations
        WHERE conversations.workspace_id=c.workspace_id AND conversations.contact_id=c.contact_id) AS conversation_count,
      (SELECT COUNT(*) FROM messages messages
        JOIN conversations message_conversations
          ON message_conversations.workspace_id=messages.workspace_id
          AND message_conversations.conversation_id=messages.conversation_id
        WHERE messages.workspace_id=c.workspace_id
          AND message_conversations.contact_id=c.contact_id) AS message_count
    FROM contacts c
    LEFT JOIN channel_identities i ON i.identity_id=(SELECT identity_id FROM channel_identities
      WHERE workspace_id=c.workspace_id AND contact_id=c.contact_id ORDER BY created_at LIMIT 1)
    LEFT JOIN channels ch ON ch.workspace_id=c.workspace_id AND ch.channel_id=i.channel_id
    LEFT JOIN conversations cv ON cv.conversation_id=(SELECT conversation_id FROM conversations
      WHERE workspace_id=c.workspace_id AND contact_id=c.contact_id ORDER BY last_message_at DESC LIMIT 1)
    WHERE c.workspace_id=?1 AND c.contact_id=?2`).bind(workspaceId, contactId).first();
}

async function getContactDetail(env, workspaceId, contactId) {
  const row = await loadContactRow(env, workspaceId, cleanId(contactId, 'Contact ID'));
  if (!row) throw httpError(404, 'Contact not found.');
  return contactView(row);
}

function contactView(row) {
  const attributes = safeJsonParse(row.attributes_json, {});
  const displayName = String(row.display_name || '').slice(0, 120);
  const tags = storedContactTags(row.tags_json);
  return {
    contactId: row.contact_id,
    displayName,
    name: displayName,
    company: String(row.company || '').slice(0, 160),
    tags,
    channelId: row.channel_id || '',
    channelName: row.channel_name || '',
    connectorType: logicalConnectorType(row),
    channelProfileId: row.channel_profile_id || '',
    email: typeof attributes.email === 'string' ? attributes.email.slice(0, 254) : '',
    phone: typeof attributes.phone === 'string' ? attributes.phone.slice(0, 80) : '',
    status: row.conversation_status === 'closed' ? 'inactive' : 'active',
    conversationStatus: row.conversation_status || '',
    channelEditable: Number(row.identity_count ?? 1) === 1 && Number(row.message_count || 0) === 0,
    lastMessageAt: row.last_message_at || row.updated_at
  };
}

function storedContactTags(value) {
  const tags = safeJsonParse(value, []);
  if (!Array.isArray(tags)) return [];
  return tags.filter(tag => typeof tag === 'string').map(tag => tag.trim()).filter(Boolean).slice(0, 20);
}

function validateContactTags(value) {
  if (!Array.isArray(value)) throw httpError(400, 'Tags must be an array of text values.');
  if (value.length > 20) throw httpError(400, 'A contact may have no more than 20 tags.');
  const tags = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string') throw httpError(400, 'Each tag must be text.');
    const tag = cleanRequired(item, 'Tag', 40);
    const key = tag.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

async function updateContact(env, workspaceId, contactId, payload, principal) {
  if (!isPlainObject(payload)) throw httpError(400, 'Contact update must be a JSON object.');
  rejectUnknownKeys(payload, new Set(['displayName', 'name', 'company', 'tags', 'channelId', 'channelProfileId']), 'contact');
  if (!Object.keys(payload).length) throw httpError(400, 'Provide at least one contact field to update.');
  if (payload.displayName !== undefined && payload.name !== undefined &&
      String(payload.displayName).trim() !== String(payload.name).trim()) {
    throw httpError(400, 'Display name and name must match when both are supplied.');
  }
  const id = cleanId(contactId, 'Contact ID');
  const existing = await loadContactRow(env, workspaceId, id);
  if (!existing) throw httpError(404, 'Contact not found.');
  const suppliedName = payload.displayName === undefined ? payload.name : payload.displayName;
  if (suppliedName !== undefined && typeof suppliedName !== 'string') throw httpError(400, 'Display name must be text.');
  const displayName = suppliedName === undefined
    ? existing.display_name
    : cleanRequired(suppliedName, 'Display name', 120);
  const company = payload.company === undefined
    ? String(existing.company || '')
    : cleanOptionalText(payload.company, 'Company', 160);
  const tags = payload.tags === undefined ? storedContactTags(existing.tags_json) : validateContactTags(payload.tags);

  let channelId = existing.channel_id || '';
  const channelProfileId = existing.channel_profile_id || '';
  if (payload.channelProfileId !== undefined) {
    if (typeof payload.channelProfileId !== 'string') throw httpError(400, 'Provider ID must be text.');
    const suppliedProfileId = payload.channelProfileId.trim();
    const comparableProfileId = logicalConnectorType(existing) === 'whatsapp_cloud'
      ? normalizeWhatsAppRecipient(suppliedProfileId)
      : suppliedProfileId;
    if (comparableProfileId !== channelProfileId) throw httpError(400, 'Provider ID cannot be changed.');
  }
  const identityFieldsSupplied = payload.channelId !== undefined || payload.channelProfileId !== undefined;
  if (identityFieldsSupplied) {
    channelId = payload.channelId === undefined ? channelId : cleanId(payload.channelId, 'Channel ID');
    const channel = channelId === existing.channel_id
      ? { connectorType: logicalConnectorType(existing) }
      : await getChannel(env, channelId, '', workspaceId);
    if (!channel?.connectorType) throw httpError(400, 'Unknown or disabled channel.');
  }
  const identityChangeRequested = channelId !== existing.channel_id || channelProfileId !== existing.channel_profile_id;
  if (identityChangeRequested) {
    if (!existing.identity_id) throw httpError(409, 'This contact does not have an editable channel identity.');
    if (Number(existing.identity_count) !== 1) {
      throw httpError(409, 'This contact has multiple channel identities. Edit a specific identity instead.');
    }
    if (channelId !== existing.channel_id && Number(existing.message_count) > 0) {
      throw httpError(409, 'The channel cannot be changed after messages have been sent or received.');
    }
  }

  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(`UPDATE contacts SET display_name=?3,company=?4,tags_json=?5,updated_at=?6
      WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, id, displayName, company, JSON.stringify(tags), now),
    env.DB.prepare(`UPDATE channel_identities SET display_name=?3
      WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, id, displayName),
    env.DB.prepare(`UPDATE conversations SET subject=?3,tags_json=?4,updated_at=?5
      WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, id, displayName, JSON.stringify(tags), now)
  ];
  if (identityChangeRequested) {
    statements.push(env.DB.prepare(`UPDATE channel_identities SET channel_id=?4,channel_profile_id=?5,display_name=?6
      WHERE workspace_id=?1 AND contact_id=?2 AND identity_id=?3`)
      .bind(workspaceId, id, existing.identity_id, channelId, channelProfileId, displayName));
    if (channelId !== existing.channel_id) {
      statements.push(env.DB.prepare(`UPDATE conversations SET channel_id=?3,updated_at=?4
        WHERE workspace_id=?1 AND contact_id=?2`)
        .bind(workspaceId, id, channelId, now));
    }
  }
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (isUniqueConstraintError(error)) throw httpError(409, 'This channel identity already belongs to another contact.');
    throw error;
  }
  const changedFields = [...new Set(Object.keys(payload).map(key => key === 'name' ? 'displayName' : key))];
  await audit(env, principal, 'update', 'contact', id, {
    fields: changedFields,
    identityChanged: identityChangeRequested
  });
  return getContactDetail(env, workspaceId, id);
}

async function listMessages(env, workspaceId, conversationId, url) {
  const limit = clampInt(url.searchParams.get('limit'), 1, 200, 100);
  const before = url.searchParams.get('before') || '';
  if (!await env.DB.prepare('SELECT 1 FROM conversations WHERE conversation_id=?1 AND workspace_id=?2').bind(conversationId, workspaceId).first()) throw httpError(404, 'Conversation not found.');
  const result = await env.DB.prepare(`SELECT message_id,direction,text,message_type,status,timestamp,channel_id,provider_message_id,error,payload_json
    FROM messages WHERE workspace_id=?1 AND conversation_id=?2 AND (?3='' OR timestamp<?3) ORDER BY timestamp DESC LIMIT ?4`)
    .bind(workspaceId, conversationId, before, limit).all();
  return result.results.reverse().map(row => ({
    messageId: row.message_id, direction: row.direction, text: row.text, messageType: row.message_type,
    status: row.status, timestamp: row.timestamp, channelId: row.channel_id,
    providerMessageId: row.provider_message_id, error: row.error,
    attachment: messageAttachmentView(row.message_type, safeJsonParse(row.payload_json, {}))
  }));
}

async function updateConversation(env, workspaceId, id, payload, principal) {
  const existing = await env.DB.prepare('SELECT * FROM conversations WHERE conversation_id=?1 AND workspace_id=?2').bind(id, workspaceId).first();
  if (!existing) throw httpError(404, 'Conversation not found.');
  const status = payload.status ?? existing.status;
  if (!['open', 'pending', 'closed'].includes(status)) throw httpError(400, 'Invalid conversation status.');
  let assignedTo = payload.assignedTo === undefined ? existing.assigned_to : String(payload.assignedTo).trim().slice(0, 160);
  if (payload.assignedTo !== undefined && assignedTo) {
    const assignee = await env.DB.prepare(`SELECT u.email FROM memberships m JOIN users u ON u.user_id=m.user_id
      WHERE m.workspace_id=?1 AND m.status='active' AND (lower(u.email)=lower(?2) OR u.user_id=?2)`).bind(workspaceId, assignedTo).first();
    if (!assignee) throw httpError(400, 'Assignee is not an active workspace member.');
    assignedTo = assignee.email;
  }
  const unreadCount = payload.markRead ? 0 : existing.unread_count;
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE conversations SET status=?3,assigned_to=?4,unread_count=?5,updated_at=?6 WHERE conversation_id=?1 AND workspace_id=?2')
    .bind(id, workspaceId, status, assignedTo, unreadCount, now).run();
  await audit(env, principal, 'update', 'conversation', id, { status, assignedTo, markRead: Boolean(payload.markRead) });
  return { conversationId: id, status, assignedTo, unreadCount, updatedAt: now };
}

async function createContact(env, workspaceId, payload, principal) {
  if (!isPlainObject(payload)) throw httpError(400, 'Contact must be a JSON object.');
  rejectUnknownKeys(payload, new Set(['displayName', 'name', 'company', 'tags', 'channelId', 'channelProfileId']), 'contact');
  if (payload.displayName !== undefined && payload.name !== undefined &&
      String(payload.displayName).trim() !== String(payload.name).trim()) {
    throw httpError(400, 'Display name and name must match when both are supplied.');
  }
  const suppliedName = payload.displayName === undefined ? payload.name : payload.displayName;
  if (typeof suppliedName !== 'string') throw httpError(400, 'Display name must be text.');
  const displayName = cleanRequired(suppliedName, 'Display name', 120);
  const company = payload.company === undefined ? '' : cleanOptionalText(payload.company, 'Company', 160);
  const tags = payload.tags === undefined ? [] : validateContactTags(payload.tags);
  const channelId = cleanId(payload.channelId, 'Channel ID');
  const channel = await getChannel(env, channelId, '', workspaceId);
  if (!channel) throw httpError(400, 'Unknown or disabled channel.');
  if (MANAGED_CONNECTORS.has(channel.connectorType)) {
    const stored = await env.DB.prepare(`SELECT credential_key FROM channel_credentials
      WHERE workspace_id=?1 AND channel_id=?2`).bind(workspaceId, channelId).all();
    const credentialFields = new Set((stored.results || []).map(row => row.credential_key));
    const health = channelHealth({ enabled: 1, provider_type: channel.connectorType }, channel.config, credentialFields);
    if (health !== 'connected') throw httpError(409, 'Verify the channel and its webhook before starting a conversation.');
  }
  const rawChannelProfileId = cleanRequired(payload.channelProfileId, 'Channel profile ID', 200);
  const channelProfileId = channel.connectorType === 'whatsapp_cloud'
    ? normalizeWhatsAppRecipient(rawChannelProfileId)
    : rawChannelProfileId;
  const now = new Date().toISOString();
  const contactId = crypto.randomUUID();
  const identityId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO contacts
          (contact_id,display_name,company,tags_json,created_at,updated_at,workspace_id)
        VALUES (?1,?2,?3,?4,?5,?5,?6)`)
        .bind(contactId, displayName, company, JSON.stringify(tags), now, workspaceId),
      env.DB.prepare(`INSERT INTO channel_identities (identity_id,contact_id,channel_id,channel_profile_id,display_name,created_at,workspace_id)
        VALUES (?1,?2,?3,?4,?5,?6,?7)`).bind(identityId, contactId, channelId, channelProfileId, displayName, now, workspaceId),
      env.DB.prepare(`INSERT INTO conversations
          (conversation_id,contact_id,channel_id,status,assigned_to,subject,last_message_at,tags_json,created_at,updated_at,workspace_id)
        VALUES (?1,?2,?3,'open',?4,?5,?6,?7,?6,?6,?8)`)
        .bind(conversationId, contactId, channelId, principal.user.email, displayName, now, JSON.stringify(tags), workspaceId)
    ]);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw httpError(409, 'This channel identity already exists.');
    throw error;
  }
  await audit(env, principal, 'create', 'contact', contactId, { channelId, conversationId });
  return { ok: true, contactId, conversationId, item: await getContactDetail(env, workspaceId, contactId) };
}

async function createOutboundMessage(env, workspaceId, conversationId, payload, principal) {
  const text = cleanRequired(payload.text, 'Message text', MAX_TEXT_LENGTH);
  const row = await env.DB.prepare(`SELECT c.contact_id,c.channel_id,i.channel_profile_id,ch.connector_type,ch.provider_type,
      (SELECT MAX(timestamp) FROM messages inbound WHERE inbound.workspace_id=c.workspace_id
        AND inbound.conversation_id=c.conversation_id AND inbound.direction='inbound') AS last_inbound_at
    FROM conversations c
    JOIN channel_identities i ON i.contact_id=c.contact_id AND i.channel_id=c.channel_id AND i.workspace_id=c.workspace_id
    JOIN channels ch ON ch.channel_id=c.channel_id AND ch.workspace_id=c.workspace_id
    WHERE c.conversation_id=?1 AND c.workspace_id=?2`).bind(conversationId, workspaceId).first();
  if (!row) throw httpError(404, 'Conversation or channel identity not found.');
  assertFreeformReplyAllowed(logicalConnectorType(row), row.last_inbound_at);
  const now = new Date().toISOString();
  const messageId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO messages (message_id,conversation_id,contact_id,channel_id,direction,message_type,text,status,timestamp,workspace_id)
      VALUES (?1,?2,?3,?4,'outbound','text',?5,'pending',?6,?7)`).bind(messageId, conversationId, row.contact_id, row.channel_id, text, now, workspaceId),
    env.DB.prepare('UPDATE conversations SET last_message_at=?3,updated_at=?3 WHERE conversation_id=?1 AND workspace_id=?2').bind(conversationId, workspaceId, now)
  ]);
  await audit(env, principal, 'send_message', 'conversation', conversationId, { channelId: row.channel_id, messageId });
  return { message: { messageId, conversationId, channelId: row.channel_id, direction: 'outbound', messageType: 'text', text, status: 'pending', timestamp: now } };
}

function assertFreeformReplyAllowed(connectorType, lastInboundAt) {
  const state = whatsappReplyWindowState(connectorType, lastInboundAt);
  if (!state.freeformAllowed) {
    const error = httpError(409, state.replyWindowReason);
    error.code = 'whatsapp_reply_window_closed';
    error.replyWindowExpiresAt = state.replyWindowExpiresAt;
    throw error;
  }
  return state;
}

async function conversationDeliveryTarget(env, workspaceId, conversationId) {
  const row = await env.DB.prepare(`SELECT c.contact_id,c.channel_id,i.channel_profile_id,ch.connector_type,ch.provider_type,
      ch.config_json,ch.secret_key,ch.enabled,
      (SELECT MAX(timestamp) FROM messages inbound WHERE inbound.workspace_id=c.workspace_id
        AND inbound.conversation_id=c.conversation_id AND inbound.direction='inbound') AS last_inbound_at
    FROM conversations c
    JOIN channel_identities i ON i.contact_id=c.contact_id AND i.channel_id=c.channel_id AND i.workspace_id=c.workspace_id
    JOIN channels ch ON ch.channel_id=c.channel_id AND ch.workspace_id=c.workspace_id
    WHERE c.conversation_id=?1 AND c.workspace_id=?2`).bind(conversationId, workspaceId).first();
  if (!row) throw httpError(404, 'Conversation or channel identity not found.');
  return {
    ...row,
    connectorType: logicalConnectorType(row),
    channel: {
      channelId: row.channel_id,
      workspaceId,
      connectorType: logicalConnectorType(row),
      config: safeJsonParse(row.config_json, {}),
      secretKey: row.secret_key
    }
  };
}

async function listConversationTemplates(env, workspaceId, conversationId) {
  const target = await conversationDeliveryTarget(env, workspaceId, conversationId);
  if (target.connectorType !== 'whatsapp_cloud') {
    throw httpError(409, 'Templates are available only for WhatsApp conversations.');
  }
  if (!target.enabled) throw httpError(409, 'The WhatsApp channel is disabled.');
  const wabaId = String(target.channel.config?.wabaId || '').trim();
  if (!/^\d{5,40}$/.test(wabaId)) throw httpError(409, 'The WhatsApp Business Account ID is not configured.');
  const credentials = await readChannelCredentials(env, target.channel);
  if (!credentials.accessToken) throw httpError(409, 'The WhatsApp access token is not configured.');
  const version = metaApiVersion(target.channel.config?.apiVersion);
  const items = [];
  const seen = new Set();
  let after = '';
  for (let page = 0; page < 3 && items.length < 300; page++) {
    const endpoint = new URL(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(wabaId)}/message_templates`);
    endpoint.searchParams.set('fields', 'id,name,language,status,category,components');
    endpoint.searchParams.set('status', 'APPROVED');
    endpoint.searchParams.set('limit', '100');
    if (after) endpoint.searchParams.set('after', after);
    let response;
    try {
      response = await fetch(endpoint, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
    } catch {
      throw httpError(502, 'Meta could not load approved WhatsApp templates.');
    }
    const data = safeJsonParse(await response.text(), {});
    if (!response.ok) {
      const detail = redactProviderSecret(providerError(data, response.status), credentials.accessToken);
      throw httpError(422, `Meta could not load approved WhatsApp templates: ${detail}`);
    }
    if (!Array.isArray(data.data)) {
      throw httpError(502, 'Meta returned an invalid WhatsApp template response.');
    }
    for (const value of data.data) {
      const template = sanitizeWhatsAppTemplateDefinition(value);
      if (!template || template.status !== 'APPROVED') continue;
      const key = `${template.name}\n${template.language.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(template);
      if (items.length >= 300) break;
    }
    const next = typeof data.paging?.cursors?.after === 'string'
      ? data.paging.cursors.after.trim().slice(0, 1024)
      : '';
    const hasNext = (typeof data.paging?.next === 'string' && Boolean(data.paging.next.trim())) || data.data.length === 100;
    if (!hasNext || !next || next === after) break;
    after = next;
  }
  items.sort((left, right) => left.name.localeCompare(right.name) ||
    left.language.code.localeCompare(right.language.code));
  return items;
}

export function sanitizeWhatsAppTemplateDefinition(value) {
  if (!isPlainObject(value)) return null;
  const name = providerText(value.name, 512);
  if (!/^[a-z0-9_]+$/.test(name)) return null;
  const rawLanguage = isPlainObject(value.language) ? value.language.code : value.language;
  const languageCode = providerText(rawLanguage, 35);
  if (!/^[A-Za-z]{2,3}(?:_[A-Za-z0-9]{2,8})?$/.test(languageCode)) return null;
  const status = providerEnum(value.status, 40);
  if (!status) return null;
  const category = providerEnum(value.category, 40);
  const templateId = providerIdentifier(value.id, 128) || `${name}:${languageCode}`;
  const components = [];
  const variables = [];
  const rawComponents = Array.isArray(value.components) ? value.components.slice(0, 50) : [];
  for (let componentIndex = 0; componentIndex < rawComponents.length; componentIndex++) {
    const component = sanitizeWhatsAppTemplateComponent(rawComponents[componentIndex], componentIndex);
    if (!component) continue;
    components.push(component.definition);
    variables.push(...component.variables);
  }
  return {
    templateId,
    id: templateId,
    name,
    language: { code: languageCode },
    status,
    category,
    components,
    variables
  };
}

function sanitizeWhatsAppTemplateComponent(value, componentIndex) {
  if (!isPlainObject(value)) return null;
  const type = providerEnum(value.type, 30).toLowerCase();
  if (!['header', 'body', 'footer', 'buttons'].includes(type)) return null;
  const definition = { type };
  const variables = [];
  const format = providerEnum(value.format, 30).toLowerCase();
  if (type === 'header' && ['text', 'image', 'video', 'document', 'location'].includes(format)) {
    definition.format = format;
  }
  const text = providerText(value.text, type === 'body' ? 4096 : 1024);
  if (text) definition.text = text;
  const example = sanitizeWhatsAppTemplateExample(value.example);
  if (Object.keys(example).length) definition.example = example;
  if (type === 'header' && definition.format && definition.format !== 'text') {
    variables.push({ component: 'header', componentIndex, parameterIndex: 0,
      key: 'media', kind: definition.format, example: '' });
  }
  const examples = type === 'header'
    ? (example.header_text || [])
    : (Array.isArray(example.body_text?.[0]) ? example.body_text[0] : []);
  for (const [parameterIndex, key] of templatePlaceholders(text).entries()) {
    variables.push({ component: type, componentIndex, parameterIndex, key,
      kind: 'text', example: examples[parameterIndex] || '' });
  }
  if (type === 'body' && Array.isArray(example.body_text_named_params)) {
    for (const named of example.body_text_named_params) {
      if (variables.some(variable => variable.key === named.param_name)) continue;
      variables.push({ component: 'body', componentIndex, parameterIndex: variables.length,
        key: named.param_name, kind: 'text', example: named.example });
    }
  }
  if (type === 'buttons') {
    definition.buttons = [];
    const rawButtons = Array.isArray(value.buttons) ? value.buttons.slice(0, 10) : [];
    for (let buttonIndex = 0; buttonIndex < rawButtons.length; buttonIndex++) {
      const button = sanitizeWhatsAppTemplateButton(rawButtons[buttonIndex]);
      if (!button) continue;
      definition.buttons.push(button);
      if (button.type === 'url') {
        for (const [buttonParameterIndex, key] of templatePlaceholders(button.url || '').entries()) {
          variables.push({ component: 'button', componentIndex, buttonIndex,
            parameterIndex: buttonParameterIndex, key, kind: 'url', example: button.example?.[buttonParameterIndex] || '' });
        }
      }
    }
  }
  return { definition, variables };
}

function sanitizeWhatsAppTemplateButton(value) {
  if (!isPlainObject(value)) return null;
  const type = providerEnum(value.type, 40).toLowerCase();
  if (!['quick_reply', 'url', 'phone_number', 'copy_code', 'catalog', 'mpm', 'flow', 'otp'].includes(type)) return null;
  const button = { type };
  const text = providerText(value.text, 100);
  if (text) button.text = text;
  const url = providerText(value.url, 2048);
  if (url && /^https:\/\//i.test(url)) button.url = url;
  const phoneNumber = providerText(value.phone_number, 40);
  if (phoneNumber) button.phoneNumber = phoneNumber;
  const example = Array.isArray(value.example)
    ? value.example.slice(0, 10).map(item => providerText(item, 2048)).filter(Boolean)
    : [];
  if (example.length) button.example = example;
  return button;
}

function sanitizeWhatsAppTemplateExample(value) {
  if (!isPlainObject(value)) return {};
  const result = {};
  if (Array.isArray(value.header_text)) {
    result.header_text = value.header_text.slice(0, 20).map(item => providerText(item, 1024));
  }
  if (Array.isArray(value.body_text)) {
    result.body_text = value.body_text.slice(0, 10).map(row => Array.isArray(row)
      ? row.slice(0, 50).map(item => providerText(item, 1024))
      : []);
  }
  if (Array.isArray(value.body_text_named_params)) {
    result.body_text_named_params = value.body_text_named_params.slice(0, 50).flatMap(item => {
      if (!isPlainObject(item)) return [];
      const paramName = providerIdentifier(item.param_name, 100);
      if (!paramName) return [];
      return [{ param_name: paramName, example: providerText(item.example, 1024) }];
    });
  }
  return result;
}

function templatePlaceholders(value) {
  const result = [];
  const seen = new Set();
  for (const match of String(value || '').matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
    const key = match[1];
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

function providerText(value, maximum) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, maximum);
}

function providerIdentifier(value, maximum) {
  const text = providerText(value, maximum);
  return /^[A-Za-z0-9_.:-]+$/.test(text) ? text : '';
}

function providerEnum(value, maximum) {
  const text = providerText(value, maximum).toUpperCase();
  return /^[A-Z][A-Z0-9_]*$/.test(text) ? text : '';
}

function redactProviderSecret(message, secret) {
  const value = String(message || '');
  const needle = String(secret || '');
  return needle ? value.split(needle).join('[redacted]') : value;
}

async function createConversationTemplateMessage(env, workspaceId, conversationId, payload, principal) {
  if (!isPlainObject(payload)) throw httpError(400, 'Template payload must be an object.');
  rejectUnknownKeys(payload, new Set(['name', 'language', 'components', 'previewText']), 'template request');
  const target = await conversationDeliveryTarget(env, workspaceId, conversationId);
  if (target.connectorType !== 'whatsapp_cloud') throw httpError(409, 'Templates are available only for WhatsApp conversations.');
  if (!target.enabled) throw httpError(409, 'The WhatsApp channel is disabled.');
  const template = validateWhatsAppTemplate({
    name: payload.name,
    language: payload.language,
    ...(payload.components === undefined ? {} : { components: payload.components })
  });
  const previewText = payload.previewText === undefined
    ? `Template: ${template.name} (${template.language.code})`
    : cleanOptionalText(payload.previewText, 'Preview text', MAX_TEXT_LENGTH);
  const now = new Date().toISOString();
  const messageId = crypto.randomUUID();
  const encryptedPayload = await encryptOutboundPayload({ template }, env.CHANNEL_CREDENTIALS_KEY, workspaceId, messageId);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO messages (message_id,conversation_id,contact_id,channel_id,direction,message_type,text,
        status,timestamp,payload_json,workspace_id)
      VALUES (?1,?2,?3,?4,'outbound','template',?5,'pending',?6,?7,?8)`)
      .bind(messageId, conversationId, target.contact_id, target.channel_id, previewText, now,
        JSON.stringify({ template: { name: template.name, language: template.language } }), workspaceId),
    env.DB.prepare(`INSERT INTO outbound_payloads (message_id,workspace_id,encrypted_payload,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?4)`).bind(messageId, workspaceId, encryptedPayload, now),
    env.DB.prepare(`INSERT INTO outbox (outbox_id,message_id,attempts,max_attempts,next_attempt_at,status,last_error,created_at,updated_at,workspace_id)
      VALUES (?1,?2,0,6,?3,'pending','',?4,?4,?5)`)
      .bind(crypto.randomUUID(), messageId, now, now, workspaceId),
    env.DB.prepare('UPDATE conversations SET last_message_at=?3,updated_at=?3 WHERE conversation_id=?1 AND workspace_id=?2')
      .bind(conversationId, workspaceId, now)
  ]);
  await audit(env, principal, 'send_template', 'conversation', conversationId, {
    channelId: target.channel_id, messageId, templateName: template.name
  });
  return { message: {
    messageId, conversationId, channelId: target.channel_id, direction: 'outbound', messageType: 'template',
    text: previewText, status: 'pending', timestamp: now,
    template: { name: template.name, language: template.language }
  } };
}

async function createConversationAttachmentMessage(env, workspaceId, conversationId, request, principal) {
  const target = await conversationDeliveryTarget(env, workspaceId, conversationId);
  if (target.connectorType !== 'whatsapp_cloud') throw httpError(409, 'Attachments are currently available only for WhatsApp conversations.');
  if (!target.enabled) throw httpError(409, 'The WhatsApp channel is disabled.');
  assertFreeformReplyAllowed(target.connectorType, target.last_inbound_at);
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) throw httpError(415, 'Content-Type must be multipart/form-data.');
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ATTACHMENT_BYTES + 1024 * 1024) {
    throw httpError(413, 'Attachment request is too large.');
  }
  let form;
  try { form = await request.formData(); } catch { throw httpError(400, 'Multipart attachment data is invalid.'); }
  const file = form.get('file');
  if (!file || typeof file !== 'object' || typeof file.arrayBuffer !== 'function') throw httpError(400, 'A file field is required.');
  const attachment = validateWhatsAppAttachment(file, form.get('caption'));
  const providerMediaId = await uploadWhatsAppMedia(env, target.channel, file, attachment);
  const now = new Date().toISOString();
  const messageId = crypto.randomUUID();
  const encryptedPayload = await encryptOutboundPayload({ media: { ...attachment, id: providerMediaId } },
    env.CHANNEL_CREDENTIALS_KEY, workspaceId, messageId);
  const preview = attachment.caption || `[${attachment.type}: ${attachment.filename}]`;
  const safeAttachment = { type: attachment.type, filename: attachment.filename, mimeType: attachment.mimeType,
    size: attachment.size, caption: attachment.caption };
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO messages (message_id,conversation_id,contact_id,channel_id,direction,message_type,text,
        status,timestamp,payload_json,workspace_id)
      VALUES (?1,?2,?3,?4,'outbound',?5,?6,'pending',?7,?8,?9)`)
      .bind(messageId, conversationId, target.contact_id, target.channel_id, attachment.type, preview, now,
        JSON.stringify({ attachment: safeAttachment }), workspaceId),
    env.DB.prepare(`INSERT INTO outbound_payloads (message_id,workspace_id,encrypted_payload,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?4)`).bind(messageId, workspaceId, encryptedPayload, now),
    env.DB.prepare(`INSERT INTO outbox (outbox_id,message_id,attempts,max_attempts,next_attempt_at,status,last_error,created_at,updated_at,workspace_id)
      VALUES (?1,?2,0,6,?3,'pending','',?4,?4,?5)`)
      .bind(crypto.randomUUID(), messageId, now, now, workspaceId),
    env.DB.prepare('UPDATE conversations SET last_message_at=?3,updated_at=?3 WHERE conversation_id=?1 AND workspace_id=?2')
      .bind(conversationId, workspaceId, now)
  ]);
  await audit(env, principal, 'send_attachment', 'conversation', conversationId, {
    channelId: target.channel_id, messageId, type: attachment.type, mimeType: attachment.mimeType, size: attachment.size
  });
  return { message: {
    messageId, conversationId, channelId: target.channel_id, direction: 'outbound', messageType: attachment.type,
    text: preview, status: 'pending', timestamp: now, attachment: safeAttachment
  } };
}

function validateWhatsAppAttachment(file, captionValue) {
  const mimeType = String(file.type || '').toLowerCase().split(';', 1)[0].trim();
  const types = new Map([
    ['image/jpeg', 'image'], ['image/png', 'image'], ['image/webp', 'image'],
    ['video/mp4', 'video'], ['video/3gpp', 'video'],
    ['audio/aac', 'audio'], ['audio/amr', 'audio'], ['audio/mpeg', 'audio'],
    ['audio/mp4', 'audio'], ['audio/ogg', 'audio'],
    ['application/pdf', 'document'], ['text/plain', 'document'], ['text/csv', 'document'],
    ['application/msword', 'document'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document'],
    ['application/vnd.ms-excel', 'document'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'document'],
    ['application/vnd.ms-powerpoint', 'document'],
    ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'document']
  ]);
  const type = types.get(mimeType);
  if (!type) throw httpError(415, 'This file type is not supported for WhatsApp attachments.');
  const size = Number(file.size || 0);
  if (!Number.isFinite(size) || size <= 0) throw httpError(400, 'The attachment is empty.');
  if (size > MAX_ATTACHMENT_BYTES) throw httpError(413, 'Attachments may not exceed 16 MB.');
  const rawName = String(file.name || `attachment.${mimeType.split('/')[1] || 'bin'}`)
    .replace(/[\u0000-\u001f\u007f\\/]+/g, ' ').trim();
  const filename = (rawName || 'attachment').slice(0, 240);
  const caption = captionValue === null || captionValue === undefined || String(captionValue).trim() === ''
    ? ''
    : cleanOptionalText(String(captionValue), 'Caption', MAX_ATTACHMENT_CAPTION_LENGTH);
  return { type, mimeType, size, filename, caption };
}

async function uploadWhatsAppMedia(env, channel, file, attachment) {
  const credentials = await readChannelCredentials(env, channel);
  const token = credentials.accessToken;
  const phoneNumberId = channel.config?.phoneNumberId;
  if (!token || !phoneNumberId) throw httpError(409, 'WhatsApp credentials are not configured.');
  const version = metaApiVersion(channel.config?.apiVersion);
  const body = new FormData();
  body.set('messaging_product', 'whatsapp');
  body.set('type', attachment.mimeType);
  body.set('file', file, attachment.filename);
  const response = await fetch(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(phoneNumberId)}/media`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body
  });
  const data = safeJsonParse(await response.text(), {});
  if (!response.ok || !data.id) {
    throw httpError(422, `WhatsApp could not accept this attachment: ${providerError(data, response.status)}`);
  }
  return String(data.id);
}

function messageAttachmentView(messageType, payload) {
  if (!['image', 'video', 'audio', 'document'].includes(String(messageType || ''))) return null;
  const value = payload?.attachment;
  if (!value || typeof value !== 'object') return null;
  return {
    type: String(value.type || messageType),
    filename: String(value.filename || ''),
    mimeType: String(value.mimeType || ''),
    size: Number(value.size || 0),
    caption: String(value.caption || '')
  };
}

async function sendOrQueue(env, messageId) {
  const queued = await env.DB.prepare('SELECT outbox_id,status FROM outbox WHERE message_id=?1').bind(messageId).first();
  if (queued) {
    const claimed = await env.DB.prepare("UPDATE outbox SET status='processing',updated_at=?2 WHERE message_id=?1 AND status='pending'")
      .bind(messageId, new Date().toISOString()).run();
    if (!claimed.meta?.changes) return;
  }
  const beforeSend = await env.DB.prepare('SELECT workspace_id,status FROM messages WHERE message_id=?1').bind(messageId).first();
  if (beforeSend && isTerminalProviderStatus(beforeSend.status)) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM outbox WHERE message_id=?1').bind(messageId),
      env.DB.prepare('DELETE FROM outbound_payloads WHERE message_id=?1').bind(messageId)
    ]);
    return;
  }
  try {
    await markMessageSent(env, messageId, await dispatchOutbound(env, messageId));
  } catch (error) {
    const message = await env.DB.prepare('SELECT workspace_id,status FROM messages WHERE message_id=?1').bind(messageId).first();
    if (!message) throw error;
    if (isTerminalProviderStatus(message.status)) {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM outbox WHERE message_id=?1').bind(messageId),
        env.DB.prepare('DELETE FROM outbound_payloads WHERE message_id=?1').bind(messageId)
      ]);
      return;
    }
    if (error?.retryable === false) {
      await env.DB.batch([
        env.DB.prepare("UPDATE messages SET status='failed',error=?2 WHERE message_id=?1").bind(messageId, cleanError(error)),
        env.DB.prepare('DELETE FROM outbox WHERE message_id=?1').bind(messageId),
        env.DB.prepare('DELETE FROM outbound_payloads WHERE message_id=?1').bind(messageId)
      ]);
      await broadcast(env, message.workspace_id, { type: 'message.updated', messageId, status: 'failed' });
      return;
    }
    const now = new Date();
    const next = new Date(now.getTime() + 30000).toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE messages SET status='retrying',error=?2 WHERE message_id=?1").bind(messageId, cleanError(error)),
      env.DB.prepare(`INSERT INTO outbox (outbox_id,message_id,attempts,next_attempt_at,last_error,created_at,updated_at,workspace_id)
        VALUES (?1,?2,0,?3,?4,?5,?5,?6)
        ON CONFLICT(message_id) DO UPDATE SET status='pending',next_attempt_at=excluded.next_attempt_at,
          last_error=excluded.last_error,updated_at=excluded.updated_at`)
        .bind(crypto.randomUUID(), messageId, next, cleanError(error), now.toISOString(), message.workspace_id)
    ]);
    await broadcast(env, message.workspace_id, { type: 'message.updated', messageId, status: 'retrying' });
  }
}

async function dispatchOutbound(env, messageId) {
  const row = await env.DB.prepare(`SELECT m.*,c.config_json,c.connector_type,c.provider_type,c.secret_key,c.enabled,
      i.channel_profile_id,cv.contact_id FROM messages m JOIN channels c ON c.channel_id=m.channel_id
      AND c.workspace_id=m.workspace_id JOIN conversations cv ON cv.conversation_id=m.conversation_id AND cv.workspace_id=m.workspace_id
      JOIN channel_identities i ON i.contact_id=cv.contact_id AND i.channel_id=cv.channel_id AND i.workspace_id=m.workspace_id
      WHERE m.message_id=?1`).bind(messageId).first();
  if (!row) throw new Error('Outbound message not found.');
  if (!row.enabled) throw new Error('Channel is disabled.');
  const channel = {
    channelId: row.channel_id,
    workspaceId: row.workspace_id,
    connectorType: logicalConnectorType(row),
    config: safeJsonParse(row.config_json, {}),
    secretKey: row.secret_key
  };
  let result;
  if (channel.connectorType === 'whatsapp_cloud' && row.message_type === 'template') {
    const stored = await env.DB.prepare(`SELECT encrypted_payload FROM outbound_payloads
      WHERE message_id=?1 AND workspace_id=?2`).bind(messageId, row.workspace_id).first();
    if (!stored?.encrypted_payload) throw nonRetryableError('The encrypted template payload is unavailable.');
    let outbound;
    try {
      outbound = await decryptOutboundPayload(stored.encrypted_payload, env.CHANNEL_CREDENTIALS_KEY, row.workspace_id, messageId);
    } catch {
      throw nonRetryableError('The encrypted template payload could not be decrypted.');
    }
    result = await sendWhatsAppTemplate(env, channel, row.channel_profile_id, outbound.template, messageId);
  } else if (channel.connectorType === 'whatsapp_cloud' && ['image', 'video', 'audio', 'document'].includes(row.message_type)) {
    const stored = await env.DB.prepare(`SELECT encrypted_payload FROM outbound_payloads
      WHERE message_id=?1 AND workspace_id=?2`).bind(messageId, row.workspace_id).first();
    if (!stored?.encrypted_payload) throw nonRetryableError('The encrypted attachment payload is unavailable.');
    let outbound;
    try {
      outbound = await decryptOutboundPayload(stored.encrypted_payload, env.CHANNEL_CREDENTIALS_KEY, row.workspace_id, messageId);
    } catch {
      throw nonRetryableError('The encrypted attachment payload could not be decrypted.');
    }
    result = await sendWhatsAppMedia(env, channel, row.channel_profile_id, outbound.media, messageId);
  } else if (channel.connectorType === 'whatsapp_cloud') result = await sendWhatsApp(env, channel, row.channel_profile_id, row.text);
  else if (channel.connectorType === 'telegram') result = await sendTelegram(env, channel, row.channel_profile_id, row.text);
  else if (channel.connectorType === 'instagram') result = await sendInstagram(env, channel, row.channel_profile_id, row.text);
  else if (channel.connectorType === 'generic_http') result = await sendGeneric(env, channel, row);
  else if (channel.connectorType === 'web_chat') result = { status: 'sent', providerMessageId: row.message_id, httpStatus: 200 };
  else throw new Error(`Outbound connector ${channel.connectorType} is not implemented yet.`);
  return { ...result, workspaceId: row.workspace_id };
}

async function sendWhatsApp(env, channel, recipient, text) {
  const credentials = await readChannelCredentials(env, channel);
  const token = credentials.accessToken;
  const phoneNumberId = channel.config?.phoneNumberId;
  if (!token || !phoneNumberId) throw nonRetryableError('WhatsApp credentials are not configured.');
  const normalizedRecipient = normalizeWhatsAppRecipient(recipient);
  const version = metaApiVersion(channel.config?.apiVersion);
  const response = await fetch(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: normalizedRecipient, type: 'text', text: { preview_url: false, body: text } })
  });
  const raw = await response.text();
  const data = safeJsonParse(raw, {});
  if (!response.ok) {
    const code = data?.error?.code ? ` (${data.error.code})` : '';
    const providerMessage = String(data?.error?.message || `HTTP ${response.status}`).slice(0, 300);
    const error = new Error(`WhatsApp API${code}: ${providerMessage}`);
    error.retryable = isRetryableWhatsAppStatus(response.status);
    throw error;
  }
  return { status: 'submitted', providerMessageId: data.messages?.[0]?.id || '', httpStatus: response.status };
}

async function sendWhatsAppTemplate(env, channel, recipient, template, messageId) {
  const credentials = await readChannelCredentials(env, channel);
  const token = credentials.accessToken;
  const phoneNumberId = channel.config?.phoneNumberId;
  if (!token || !phoneNumberId) throw nonRetryableError('WhatsApp credentials are not configured.');
  const version = metaApiVersion(channel.config?.apiVersion);
  const body = buildWhatsAppTemplatePayload(recipient, template, messageId);
  const response = await fetch(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = safeJsonParse(await response.text(), {});
  if (!response.ok) {
    const code = data?.error?.code ? ` (${data.error.code})` : '';
    const providerMessage = String(data?.error?.message || `HTTP ${response.status}`).slice(0, 300);
    const error = new Error(`WhatsApp API${code}: ${providerMessage}`);
    error.retryable = isRetryableWhatsAppStatus(response.status);
    throw error;
  }
  return { status: 'submitted', providerMessageId: data.messages?.[0]?.id || '', httpStatus: response.status };
}

async function sendWhatsAppMedia(env, channel, recipient, media, messageId) {
  const credentials = await readChannelCredentials(env, channel);
  const token = credentials.accessToken;
  const phoneNumberId = channel.config?.phoneNumberId;
  if (!token || !phoneNumberId) throw nonRetryableError('WhatsApp credentials are not configured.');
  const type = String(media?.type || '');
  if (!['image', 'video', 'audio', 'document'].includes(type) || !media?.id) {
    throw nonRetryableError('The WhatsApp attachment payload is invalid.');
  }
  const item = { id: String(media.id) };
  if (type !== 'audio' && media.caption) item.caption = String(media.caption).slice(0, MAX_ATTACHMENT_CAPTION_LENGTH);
  if (type === 'document' && media.filename) item.filename = String(media.filename).slice(0, 240);
  const version = metaApiVersion(channel.config?.apiVersion);
  const body = {
    messaging_product: 'whatsapp', recipient_type: 'individual',
    to: normalizeWhatsAppRecipient(recipient), type, [type]: item,
    biz_opaque_callback_data: String(messageId).slice(0, 512)
  };
  const response = await fetch(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = safeJsonParse(await response.text(), {});
  if (!response.ok) {
    const code = data?.error?.code ? ` (${data.error.code})` : '';
    const providerMessage = String(data?.error?.message || `HTTP ${response.status}`).slice(0, 300);
    const error = new Error(`WhatsApp API${code}: ${providerMessage}`);
    error.retryable = isRetryableWhatsAppStatus(response.status);
    throw error;
  }
  return {
    status: 'submitted', providerMessageId: data.messages?.[0]?.id || '', httpStatus: response.status,
    attachment: {
      type, filename: String(media.filename || ''), mimeType: String(media.mimeType || ''),
      size: Number(media.size || 0), caption: String(media.caption || '')
    }
  };
}

async function sendGeneric(env, channel, row) {
  const cfg = channel.config || {};
  assertAllowedHttpsEndpoint(cfg.endpoint, cfg.allowedHosts || []);
  const method = String(cfg.method || 'POST').toUpperCase();
  if (!['POST', 'PUT', 'PATCH'].includes(method)) throw new Error('Generic connector method is not allowed.');
  const context = {
    recipient: { channelProfileId: row.channel_profile_id }, message: { messageId: row.message_id, text: row.text },
    conversation: { conversationId: row.conversation_id, contactId: row.contact_id }, channel: { channelId: row.channel_id }
  };
  const prefix = secretPrefix(channel.secretKey);
  const resolver = name => env[`${prefix}_${secretPrefix(name)}`];
  const headers = resolveTemplate(cfg.headers || { 'Content-Type': 'application/json' }, context, resolver);
  const body = resolveTemplate(cfg.bodyTemplate || { to: '{{recipient.channelProfileId}}', text: '{{message.text}}' }, context, resolver);
  const response = await fetch(cfg.endpoint, { method, headers, body: JSON.stringify(body), redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) throw new Error('Provider redirects are not allowed for generic connectors.');
  const raw = await response.text();
  const data = safeJsonParse(raw, {});
  if (!response.ok) throw new Error(`Provider API HTTP ${response.status}: ${raw.slice(0, 500)}`);
  const mapping = cfg.responseMapping || {};
  return {
    status: mapping.status ? getPath(data, mapping.status) || 'submitted' : 'submitted',
    providerMessageId: mapping.providerMessageId ? getPath(data, mapping.providerMessageId) || '' : '',
    httpStatus: response.status
  };
}

async function sendTelegram(env, channel, chatId, text) {
  const credentials = await readChannelCredentials(env, channel);
  const token = credentials.botToken;
  if (!token) throw nonRetryableError('Telegram bot token is not configured.');
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  });
  const raw = await response.text();
  const data = safeJsonParse(raw, {});
  if (!response.ok || data.ok === false) {
    const error = new Error(`Telegram API: ${providerError(data, response.status)}`);
    error.retryable = isRetryableProviderStatus(response.status);
    throw error;
  }
  return { status: 'sent', providerMessageId: String(data.result?.message_id || ''), httpStatus: response.status };
}

async function sendInstagram(env, channel, recipient, text) {
  const credentials = await readChannelCredentials(env, channel);
  const accountId = String(channel.config?.instagramAccountId || '');
  if (!credentials.accessToken || !accountId) throw nonRetryableError('Instagram credentials are not configured.');
  const version = metaApiVersion(channel.config?.apiVersion);
  const response = await fetch(`https://graph.instagram.com/${encodeURIComponent(version)}/${encodeURIComponent(accountId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: String(recipient) }, message: { text } })
  });
  const data = safeJsonParse(await response.text(), {});
  if (!response.ok) {
    const error = new Error(`Instagram API: ${providerError(data, response.status)}`);
    error.retryable = isRetryableProviderStatus(response.status);
    throw error;
  }
  return {
    status: 'submitted',
    providerMessageId: String(data.message_id || data.id || ''),
    httpStatus: response.status
  };
}

async function markMessageSent(env, messageId, result) {
  await env.DB.batch([
    env.DB.prepare(`UPDATE messages SET
        status=CASE WHEN status IN ('sent','delivered','read','failed') THEN status ELSE ?2 END,
        provider_message_id=CASE WHEN provider_message_id='' THEN ?3 ELSE provider_message_id END,
        payload_json=CASE WHEN status IN ('sent','delivered','read','failed') THEN payload_json ELSE ?4 END,
        error=CASE WHEN status='failed' THEN error ELSE '' END
      WHERE message_id=?1`)
      .bind(messageId, result.status || 'submitted', result.providerMessageId || '', JSON.stringify(result)),
    env.DB.prepare('DELETE FROM outbox WHERE message_id=?1').bind(messageId),
    env.DB.prepare('DELETE FROM outbound_payloads WHERE message_id=?1').bind(messageId)
  ]);
  const stored = await env.DB.prepare('SELECT status FROM messages WHERE message_id=?1').bind(messageId).first();
  await broadcast(env, result.workspaceId, { type: 'message.updated', messageId, status: stored?.status || result.status || 'submitted' });
}

async function retryDueMessages(env) {
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await env.DB.prepare(`UPDATE outbox SET status='pending',next_attempt_at=?1,updated_at=?1
    WHERE status='processing' AND updated_at<=?2`).bind(now, staleBefore).run();
  const due = await env.DB.prepare(`SELECT outbox_id,message_id,attempts,max_attempts,workspace_id FROM outbox
    WHERE status='pending' AND next_attempt_at<=?1 ORDER BY next_attempt_at LIMIT 25`).bind(now).all();
  for (const job of due.results) {
    const claimed = await env.DB.prepare("UPDATE outbox SET status='processing',updated_at=?2 WHERE outbox_id=?1 AND status='pending'")
      .bind(job.outbox_id, now).run();
    if (!claimed.meta?.changes) continue;
    const beforeSend = await env.DB.prepare('SELECT status FROM messages WHERE message_id=?1').bind(job.message_id).first();
    if (beforeSend && isTerminalProviderStatus(beforeSend.status)) {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM outbox WHERE message_id=?1').bind(job.message_id),
        env.DB.prepare('DELETE FROM outbound_payloads WHERE message_id=?1').bind(job.message_id)
      ]);
      continue;
    }
    try {
      await markMessageSent(env, job.message_id, await dispatchOutbound(env, job.message_id));
    } catch (error) {
      const latest = await env.DB.prepare('SELECT status FROM messages WHERE message_id=?1').bind(job.message_id).first();
      if (latest && isTerminalProviderStatus(latest.status)) {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM outbox WHERE message_id=?1').bind(job.message_id),
          env.DB.prepare('DELETE FROM outbound_payloads WHERE message_id=?1').bind(job.message_id)
        ]);
        continue;
      }
      const attempts = Number(job.attempts) + 1;
      const exhausted = error?.retryable === false || attempts >= Number(job.max_attempts);
      const delaySeconds = Math.min(3600, 30 * (2 ** Math.min(attempts, 7)));
      const next = new Date(Date.now() + delaySeconds * 1000).toISOString();
      const statements = [
        env.DB.prepare('UPDATE outbox SET status=?2,attempts=?3,next_attempt_at=?4,last_error=?5,updated_at=?6 WHERE outbox_id=?1')
          .bind(job.outbox_id, exhausted ? 'failed' : 'pending', attempts, next, cleanError(error), now),
        env.DB.prepare('UPDATE messages SET status=?2,error=?3 WHERE message_id=?1')
          .bind(job.message_id, exhausted ? 'failed' : 'retrying', cleanError(error))
      ];
      if (exhausted) statements.push(env.DB.prepare('DELETE FROM outbound_payloads WHERE message_id=?1').bind(job.message_id));
      await env.DB.batch(statements);
      await broadcast(env, job.workspace_id, { type: 'message.updated', messageId: job.message_id, status: exhausted ? 'failed' : 'retrying' });
    }
  }
}

async function storeInbound(env, channel, event, rawPayload) {
  if (!event.channelProfileId || (!event.text && !event.providerMessageId)) return false;
  const eventKey = `${channel.workspaceId}:${channel.channelId}:message:${event.providerMessageId || await hashText(JSON.stringify(event))}`;
  const dedupe = await env.DB.prepare(`INSERT OR IGNORE INTO webhook_events (event_key,channel_id,event_type,received_at,workspace_id)
    VALUES (?1,?2,'message',?3,?4)`).bind(eventKey, channel.channelId, new Date().toISOString(), channel.workspaceId).run();
  if (!dedupe.meta?.changes) return false;
  try {
  const now = new Date().toISOString();
  const timestamp = normalizeTimestamp(event.timestamp, now);
  let identity = await env.DB.prepare(`SELECT identity_id,contact_id FROM channel_identities
    WHERE workspace_id=?1 AND channel_id=?2 AND channel_profile_id=?3`)
    .bind(channel.workspaceId, channel.channelId, String(event.channelProfileId)).first();
  if (!identity) {
    const contactId = crypto.randomUUID();
    const identityId = crypto.randomUUID();
    const name = String(event.displayName || event.channelProfileId).slice(0, 120);
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO contacts (contact_id,display_name,created_at,updated_at,workspace_id) VALUES (?1,?2,?3,?3,?4)').bind(contactId, name, now, channel.workspaceId),
        env.DB.prepare(`INSERT INTO channel_identities (identity_id,contact_id,channel_id,channel_profile_id,display_name,created_at,workspace_id)
          VALUES (?1,?2,?3,?4,?5,?6,?7)`).bind(identityId, contactId, channel.channelId, String(event.channelProfileId), name, now, channel.workspaceId)
      ]);
      identity = { identity_id: identityId, contact_id: contactId };
    } catch (error) {
      identity = await env.DB.prepare(`SELECT identity_id,contact_id FROM channel_identities
        WHERE workspace_id=?1 AND channel_id=?2 AND channel_profile_id=?3`)
        .bind(channel.workspaceId, channel.channelId, String(event.channelProfileId)).first();
      if (!identity) throw error;
    }
  }
  let conversation = await env.DB.prepare(`SELECT conversation_id FROM conversations
    WHERE workspace_id=?1 AND contact_id=?2 AND channel_id=?3
    ORDER BY last_message_at DESC,created_at DESC LIMIT 1`)
    .bind(channel.workspaceId, identity.contact_id, channel.channelId).first();
  if (!conversation) {
    const conversationId = crypto.randomUUID();
    try {
      await env.DB.prepare(`INSERT INTO conversations (conversation_id,contact_id,channel_id,status,subject,last_message_at,unread_count,created_at,updated_at,workspace_id)
        VALUES (?1,?2,?3,'open',?4,?5,0,?6,?6,?7)`).bind(conversationId, identity.contact_id, channel.channelId,
        String(event.displayName || event.channelProfileId).slice(0, 120), timestamp, now, channel.workspaceId).run();
      conversation = { conversation_id: conversationId };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      conversation = await env.DB.prepare(`SELECT conversation_id FROM conversations
        WHERE workspace_id=?1 AND contact_id=?2 AND channel_id=?3 LIMIT 1`)
        .bind(channel.workspaceId, identity.contact_id, channel.channelId).first();
      if (!conversation) throw error;
    }
  }
  const messageId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO messages (message_id,conversation_id,contact_id,channel_id,direction,message_type,text,
      provider_message_id,status,timestamp,payload_json,workspace_id) VALUES (?1,?2,?3,?4,'inbound',?5,?6,?7,'received',?8,?9,?10)`)
      .bind(messageId, conversation.conversation_id, identity.contact_id, channel.channelId, String(event.messageType || 'text').slice(0, 40),
        String(event.text || '').slice(0, MAX_TEXT_LENGTH), String(event.providerMessageId || ''), timestamp, truncateJson(rawPayload), channel.workspaceId),
    env.DB.prepare("UPDATE conversations SET status='open',last_message_at=?3,unread_count=unread_count+1,updated_at=?4 WHERE conversation_id=?1 AND workspace_id=?2")
      .bind(conversation.conversation_id, channel.workspaceId, timestamp, now)
  ]);
  return true;
  } catch (error) {
    // Let a provider retry process the event if storage failed after claiming its dedupe key.
    await env.DB.prepare('DELETE FROM webhook_events WHERE event_key=?1').bind(eventKey).run();
    throw error;
  }
}

async function applyProviderStatus(env, workspaceId, channelId, event, rawPayload) {
  const providerMessageId = String(event.providerMessageId || '');
  const internalMessageId = /^[A-Za-z0-9_-]{1,100}$/.test(String(event.internalMessageId || ''))
    ? String(event.internalMessageId) : '';
  const status = normalizeDeliveryStatus(event.status);
  if ((!providerMessageId && !internalMessageId) || !status) return false;
  const key = `${workspaceId}:${channelId}:status:${providerMessageId || internalMessageId}:${status}:${event.timestamp || ''}`;
  const dedupe = await env.DB.prepare(`INSERT OR IGNORE INTO webhook_events (event_key,channel_id,event_type,received_at,workspace_id)
    VALUES (?1,?2,'status',?3,?4)`).bind(key, channelId, new Date().toISOString(), workspaceId).run();
  if (!dedupe.meta?.changes) return;
  try {
    const updated = await env.DB.prepare(`UPDATE messages SET
        status=CASE
          WHEN status='failed' THEN status
          WHEN ?4='failed' THEN 'failed'
          WHEN status='read' THEN status
          WHEN status='delivered' AND ?4='sent' THEN status
          ELSE ?4
        END,
        payload_json=CASE
          WHEN status='failed' THEN payload_json
          WHEN ?4='failed' THEN ?5
          WHEN status='read' THEN payload_json
          WHEN status='delivered' AND ?4='sent' THEN payload_json
          ELSE ?5
        END,
        error=CASE
          WHEN status='failed' THEN error
          WHEN ?4='failed' THEN ?6
          WHEN status='read' THEN error
          WHEN status='delivered' AND ?4='sent' THEN error
          ELSE ?6
        END,
        provider_message_id=CASE WHEN provider_message_id='' AND ?3<>'' THEN ?3 ELSE provider_message_id END
      WHERE workspace_id=?1 AND channel_id=?2
        AND ((?3<>'' AND provider_message_id=?3) OR (?7<>'' AND message_id=?7))`)
      .bind(workspaceId, channelId, providerMessageId, status, truncateJson(rawPayload),
        String(event.error || '').slice(0, 500), internalMessageId).run();
    if (!updated.meta?.changes) {
      await env.DB.prepare('DELETE FROM webhook_events WHERE event_key=?1').bind(key).run();
      return false;
    }
    return true;
  } catch (error) {
    await env.DB.prepare('DELETE FROM webhook_events WHERE event_key=?1').bind(key).run();
    throw error;
  }
}

async function applyProviderWatermarkStatus(env, workspaceId, channelId, event, rawPayload) {
  const channelProfileId = String(event.channelProfileId || '');
  const status = normalizeDeliveryStatus(event.status);
  const timestamp = normalizeTimestamp(event.timestamp, '');
  if (!channelProfileId || !timestamp || !['delivered', 'read'].includes(status)) return false;
  const key = `${workspaceId}:${channelId}:watermark:${channelProfileId}:${status}:${timestamp}`;
  const dedupe = await env.DB.prepare(`INSERT OR IGNORE INTO webhook_events (event_key,channel_id,event_type,received_at,workspace_id)
    VALUES (?1,?2,'status',?3,?4)`).bind(key, channelId, new Date().toISOString(), workspaceId).run();
  if (!dedupe.meta?.changes) return false;
  try {
    const updated = await env.DB.prepare(`UPDATE messages SET
        status=CASE
          WHEN status='failed' THEN status
          WHEN status='read' THEN status
          WHEN status='delivered' AND ?5='delivered' THEN status
          ELSE ?5
        END,
        payload_json=CASE
          WHEN status='failed' THEN payload_json
          WHEN status='read' THEN payload_json
          WHEN status='delivered' AND ?5='delivered' THEN payload_json
          ELSE ?6
        END,
        error=CASE WHEN status='failed' THEN error ELSE '' END
      WHERE workspace_id=?1 AND channel_id=?2 AND direction='outbound' AND timestamp<=?4
        AND provider_message_id<>'' AND status IN ('submitted','sent','delivered','read')
        AND contact_id IN (SELECT contact_id FROM channel_identities
          WHERE workspace_id=?1 AND channel_id=?2 AND channel_profile_id=?3)`)
      .bind(workspaceId, channelId, channelProfileId, timestamp, status, truncateJson(rawPayload)).run();
    return Boolean(updated.meta?.changes);
  } catch (error) {
    await env.DB.prepare('DELETE FROM webhook_events WHERE event_key=?1').bind(key).run();
    throw error;
  }
}

async function seedDemo(env, workspaceId, principal) {
  const now = new Date().toISOString();
  const channelId = workspaceId === 'ws_default' ? 'demo-web' : `demo-web-${workspaceId}`;
  const contactId = crypto.randomUUID();
  const identityId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO channels (channel_id,name,connector_type,enabled,capabilities_json,config_json,secret_key,created_at,updated_at,workspace_id)
      VALUES (?1,'Website chat','web_chat',1,'["text"]','{}','DEMO_WEB',?2,?2,?3)`).bind(channelId, now, workspaceId),
    env.DB.prepare('INSERT INTO contacts (contact_id,display_name,created_at,updated_at,workspace_id) VALUES (?1,?2,?3,?3,?4)').bind(contactId, 'Demo customer', now, workspaceId),
    env.DB.prepare(`INSERT INTO channel_identities (identity_id,contact_id,channel_id,channel_profile_id,display_name,created_at,workspace_id)
      VALUES (?1,?2,?3,?4,?5,?6,?7)`).bind(identityId, contactId, channelId, `demo-${contactId}`, 'Demo customer', now, workspaceId),
    env.DB.prepare(`INSERT INTO conversations (conversation_id,contact_id,channel_id,status,subject,last_message_at,unread_count,created_at,updated_at,workspace_id)
      VALUES (?1,?2,?3,'open','Demo customer',?4,1,?4,?4,?5)`).bind(conversationId, contactId, channelId, now, workspaceId),
    env.DB.prepare(`INSERT INTO messages (message_id,conversation_id,contact_id,channel_id,direction,message_type,text,status,timestamp,workspace_id)
      VALUES (?1,?2,?3,?4,'inbound','text','Hello! This is a demo conversation.','received',?5,?6)`)
      .bind(crypto.randomUUID(), conversationId, contactId, channelId, now, workspaceId)
  ]);
  await audit(env, principal, 'seed', 'conversation', conversationId, { channelId });
  return { ok: true, channelId, contactId, conversationId };
}

export function normalizeWhatsApp(payload) {
  const messages = [];
  const statuses = [];
  const phoneNumberIds = new Set();
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      if (value.metadata?.phone_number_id) phoneNumberIds.add(String(value.metadata.phone_number_id));
      const contacts = value.contacts || [];
      for (const message of value.messages || []) {
        const contact = contacts.find(item => String(item.wa_id) === String(message.from)) || {};
        const text = whatsappInboundText(message);
        messages.push({
          channelProfileId: String(message.from || ''), displayName: contact.profile?.name || String(message.from || ''),
          text, providerMessageId: String(message.id || ''),
          timestamp: message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : '',
          messageType: String(message.type || 'text')
        });
      }
      for (const status of value.statuses || []) {
        statuses.push({
          providerMessageId: String(status.id || ''), status: String(status.status || ''),
          timestamp: status.timestamp ? new Date(Number(status.timestamp) * 1000).toISOString() : '',
          error: status.errors?.[0]?.title || status.errors?.[0]?.message || '',
          internalMessageId: String(status.biz_opaque_callback_data || '')
        });
      }
    }
  }
  return {
    messages: messages.filter(item => item.channelProfileId),
    statuses: statuses.filter(item => item.providerMessageId || item.internalMessageId),
    phoneNumberIds: [...phoneNumberIds]
  };
}

function whatsappInboundText(message) {
  const direct = message?.text?.body || message?.button?.text ||
    message?.interactive?.button_reply?.title || message?.interactive?.list_reply?.title;
  if (direct) return String(direct);
  const caption = message?.image?.caption || message?.video?.caption || message?.document?.caption;
  if (caption) return String(caption);
  const type = String(message?.type || 'message').replace(/_/g, ' ');
  return `[WhatsApp ${type} received]`;
}

export function normalizeWhatsAppRecipient(value) {
  const input = String(value || '').trim();
  if (!input || !/^[+\d\s().-]+$/.test(input)) {
    const error = httpError(400, 'Enter a WhatsApp number with country code.');
    error.retryable = false;
    throw error;
  }
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    const error = httpError(400, 'Enter a valid WhatsApp number with country code (8 to 15 digits).');
    error.retryable = false;
    throw error;
  }
  return digits;
}

export function isRetryableWhatsAppStatus(status) {
  const code = Number(status);
  return code === 408 || code === 429 || code >= 500;
}

export function normalizeGeneric(payload, mapping = {}) {
  const rawEvents = mapping.eventsPath ? getPath(payload, mapping.eventsPath) : [payload];
  const events = Array.isArray(rawEvents) ? rawEvents : rawEvents ? [rawEvents] : [];
  return events.map(event => {
    const text = getPath(event, mapping.textPath || 'text') || '';
    const receiptStatus = normalizeDeliveryStatus(getPath(event, mapping.statusPath || 'status'));
    if (receiptStatus && !text) return null;
    return {
      channelProfileId: getPath(event, mapping.senderIdPath || 'from'),
      displayName: getPath(event, mapping.senderNamePath || 'senderName') || '',
      text,
      providerMessageId: getPath(event, mapping.messageIdPath || 'id') || '',
      timestamp: getPath(event, mapping.timestampPath || 'timestamp') || '',
      messageType: getPath(event, mapping.messageTypePath || 'type') || 'text'
    };
  }).filter(item => item?.channelProfileId);
}

export function normalizeGenericStatuses(payload, mapping = {}) {
  const rawEvents = mapping.statusEventsPath
    ? getPath(payload, mapping.statusEventsPath)
    : mapping.eventsPath ? getPath(payload, mapping.eventsPath) : [payload];
  const events = Array.isArray(rawEvents) ? rawEvents : rawEvents ? [rawEvents] : [];
  return events.map(event => ({
    providerMessageId: getPath(event, mapping.statusMessageIdPath || mapping.messageIdPath || 'id') || '',
    internalMessageId: getPath(event, mapping.internalMessageIdPath || 'messageId') || '',
    status: normalizeDeliveryStatus(getPath(event, mapping.statusPath || 'status')),
    timestamp: getPath(event, mapping.statusTimestampPath || mapping.timestampPath || 'timestamp') || '',
    error: getPath(event, mapping.statusErrorPath || 'error') || ''
  })).filter(item => item.status && (item.providerMessageId || item.internalMessageId));
}

export function normalizeTelegram(payload) {
  const message = payload?.message || payload?.edited_message || payload?.channel_post || null;
  if (!message?.chat?.id) return null;
  const name = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || message.chat.title || String(message.chat.id);
  return {
    channelProfileId: String(message.chat.id), displayName: name,
    text: message.text || message.caption || '',
    providerMessageId: payload.update_id !== undefined && payload.update_id !== null
      ? `update:${payload.update_id}`
      : `chat:${message.chat.id}:message:${message.message_id || ''}`,
    timestamp: message.date ? new Date(Number(message.date) * 1000).toISOString() : '',
    messageType: message.text ? 'text' : message.photo ? 'image' : message.document ? 'document' : 'message'
  };
}

export function normalizeInstagram(payload) {
  const messages = [];
  const statuses = [];
  const watermarkStatuses = [];
  const recipientIds = new Set();
  for (const entry of payload?.entry || []) {
    for (const event of entry?.messaging || []) {
      const senderId = String(event?.sender?.id || '');
      const recipientId = String(event?.recipient?.id || entry?.id || '');
      const message = event?.message || null;
      const postback = event?.postback || null;
      const timestamp = providerEpochTimestamp(event?.timestamp);
      if (message?.is_echo) {
        const accountId = String(entry?.id || event?.sender?.id || '');
        if (accountId) recipientIds.add(accountId);
        if (message.mid) statuses.push({ providerMessageId: String(message.mid), status: 'sent', timestamp });
        continue;
      }
      if (event?.delivery) {
        if (recipientId) recipientIds.add(recipientId);
        const deliveryTimestamp = providerEpochTimestamp(event.delivery.watermark) || timestamp;
        const messageIds = Array.isArray(event.delivery.mids) ? event.delivery.mids : [];
        for (const messageId of messageIds) {
          if (messageId) statuses.push({ providerMessageId: String(messageId), status: 'delivered', timestamp: deliveryTimestamp });
        }
        if (!messageIds.length && senderId && deliveryTimestamp) {
          watermarkStatuses.push({ channelProfileId: senderId, status: 'delivered', timestamp: deliveryTimestamp });
        }
        continue;
      }
      if (event?.read) {
        if (recipientId) recipientIds.add(recipientId);
        const readTimestamp = providerEpochTimestamp(event.read.watermark) || timestamp;
        if (event.read.mid) statuses.push({ providerMessageId: String(event.read.mid), status: 'read', timestamp: readTimestamp });
        else if (senderId && readTimestamp) watermarkStatuses.push({ channelProfileId: senderId, status: 'read', timestamp: readTimestamp });
        continue;
      }
      if (!senderId || (!message && !postback)) continue;
      if (recipientId) recipientIds.add(recipientId);
      const attachmentType = String(message?.attachments?.[0]?.type || 'message');
      const text = String(message?.text || postback?.title || postback?.payload ||
        `[Instagram ${attachmentType.replace(/_/g, ' ')} received]`);
      messages.push({
        channelProfileId: senderId,
        displayName: senderId,
        text,
        providerMessageId: String(message?.mid || postback?.mid || `${entry?.id || recipientId}:${event?.timestamp || ''}:${senderId}`),
        timestamp,
        messageType: message?.text || postback ? 'text' : attachmentType
      });
    }
  }
  return { messages, statuses, watermarkStatuses, recipientIds: [...recipientIds] };
}

function providerEpochTimestamp(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  const milliseconds = numeric < 100000000000 ? numeric * 1000 : numeric;
  const date = new Date(milliseconds);
  return Number.isNaN(date.valueOf()) ? '' : date.toISOString();
}

export function resolveTemplate(value, context, secretResolver = () => undefined) {
  if (Array.isArray(value)) return value.map(item => resolveTemplate(item, context, secretResolver));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveTemplate(item, context, secretResolver)]));
  }
  if (typeof value !== 'string') return value;
  return value.replace(/\{\{([^}]+)\}\}/g, (_match, expression) => {
    const expr = expression.trim();
    if (expr.startsWith('secret:')) {
      const name = expr.slice(7).trim();
      const secret = secretResolver(name);
      if (secret === undefined || secret === null) throw new Error(`Missing connector secret: ${name}`);
      return String(secret);
    }
    const result = getPath(context, expr);
    return result === undefined || result === null ? '' : String(result);
  });
}

export function assertAllowedHttpsEndpoint(endpoint, allowedHosts) {
  let url;
  try { url = new URL(String(endpoint)); } catch { throw new Error('Connector endpoint is invalid.'); }
  if (url.protocol !== 'https:') throw new Error('Connector endpoint must use HTTPS.');
  const host = url.hostname.toLowerCase();
  const blocked = host === 'localhost' || host === '0.0.0.0' || host === '127.0.0.1' || host === '169.254.169.254' || host.endsWith('.local');
  if (blocked) throw new Error('Connector endpoint host is blocked.');
  const allow = Array.isArray(allowedHosts) ? allowedHosts.map(item => String(item).toLowerCase()) : [];
  if (!allow.includes(host)) throw new Error('Connector endpoint host is not allowlisted.');
  return true;
}

export async function verifyMetaSignature(rawBody, supplied, appSecret) {
  if (!supplied.startsWith('sha256=') || !appSecret) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = `sha256=${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
  return timingSafeEqual(supplied, expected);
}

export function timingSafeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) mismatch |= (a[index % (a.length || 1)] || 0) ^ (b[index % (b.length || 1)] || 0);
  return mismatch === 0;
}

async function audit(env, principal, action, targetType, targetId, details) {
  await env.DB.prepare(`INSERT INTO audit_log
      (audit_id,actor,action,target_type,target_id,details_json,timestamp,workspace_id,actor_user_id,actor_email)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?2)`)
    .bind(crypto.randomUUID(), principal.user.email, action, targetType, targetId,
      JSON.stringify(details || {}), new Date().toISOString(), principal.workspace.workspaceId, principal.user.userId || '').run();
}

async function broadcast(env, workspaceId, event) {
  if (!env.INBOX_HUB || !workspaceId) return;
  await inboxHub(env, workspaceId).fetch('https://hub.internal/broadcast', {
    method: 'POST', body: JSON.stringify({ ...event, at: new Date().toISOString() })
  });
}

async function disconnectRealtime(env, workspaceId, target) {
  if (!env.INBOX_HUB || !workspaceId) return;
  await inboxHub(env, workspaceId).fetch('https://hub.internal/disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(target || {})
  });
}

async function enforceOAuthRateLimit(request, env) {
  if (!env.INBOX_HUB) return json({ ok: false, error: 'Sign-in is temporarily unavailable.' }, 503);
  const address = request.headers.get('CF-Connecting-IP') || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(address));
  const clientHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  try {
    const limiter = env.INBOX_HUB.get(env.INBOX_HUB.idFromName('system:oauth-rate-limit'));
    const response = await limiter.fetch('https://hub.internal/oauth-rate-limit', { method: 'POST', body: clientHash });
    if (response.status === 204) return null;
    if (response.status === 429) {
      return new Response(JSON.stringify({ ok: false, error: 'Too many sign-in attempts. Please try again shortly.' }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Retry-After': response.headers.get('Retry-After') || '60'
        }
      });
    }
  } catch (error) {
    console.error('oauth_rate_limit_failed', { message: error.message });
  }
  return json({ ok: false, error: 'Sign-in is temporarily unavailable.' }, 503);
}

function inboxHub(env, workspaceId) {
  return env.INBOX_HUB.get(env.INBOX_HUB.idFromName(`workspace:${workspaceId}`));
}

function corsHeaders(origin, configured) {
  const allowed = configured.split(',').map(item => item.trim()).filter(Boolean);
  const permitted = Boolean(origin && allowed.includes(origin));
  return {
    ...(permitted ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' } : {}),
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Admin-Token',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400'
  };
}

async function cleanupExpiredAuth(env) {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_states WHERE expires_at<=?1').bind(now),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?1 OR revoked_at IS NOT NULL').bind(now),
    env.DB.prepare("UPDATE invitations SET status='expired',updated_at=?1 WHERE status='pending' AND expires_at<=?1").bind(now)
  ]);
}

async function cleanupExpiredExternalRequests(env) {
  await env.DB.prepare('DELETE FROM external_api_requests WHERE expires_at<=?1')
    .bind(new Date().toISOString()).run();
}

function withCors(response, headers) {
  const copy = new Response(response.body, response);
  for (const [key, value] of Object.entries(headers)) copy.headers.set(key, value);
  return copy;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

async function readJson(request) {
  if (!(request.headers.get('Content-Type') || '').toLowerCase().includes('application/json')) throw httpError(415, 'Content-Type must be application/json.');
  const raw = await readBoundedText(request, MAX_JSON_BODY);
  try { return JSON.parse(raw); } catch { throw httpError(400, 'Invalid JSON body.'); }
}

async function readBoundedText(request, maximumBytes) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maximumBytes) throw httpError(413, 'Request body is too large.');
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => {});
      throw httpError(413, 'Request body is too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function safeJsonParse(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function getPath(object, path) {
  return String(path || '').split('.').filter(Boolean).reduce((value, key) => value == null ? undefined : value[key], object);
}

function cleanRequired(value, label, maximum) {
  const text = String(value || '').trim();
  if (!text) throw httpError(400, `${label} is required.`);
  if (text.length > maximum) throw httpError(400, `${label} is too long.`);
  return text;
}

function cleanId(value, label) {
  const id = cleanRequired(value, label, 100);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw httpError(400, `${label} may contain only letters, numbers, underscores, and hyphens.`);
  return id;
}

function cleanMetaIdentifier(value, label) {
  const id = String(value || '').trim();
  if (!/^\d{4,40}$/.test(id)) throw httpError(400, `${label} must be a numeric Meta identifier.`);
  return id;
}

function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function secretPrefix(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/^_+|_+$/g, '');
}

function workspaceSecretPrefix(workspaceId, value) {
  if (workspaceId === DEFAULT_WORKSPACE_ID) return secretPrefix(value);
  return `${secretPrefix(`WS_${workspaceId}`)}_${secretPrefix(value)}`;
}

function normalizeTimestamp(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? fallback : date.toISOString();
}

function truncateJson(value) {
  const raw = JSON.stringify(value || {});
  return raw.length > MAX_RAW_PAYLOAD ? JSON.stringify({ truncated: true, preview: raw.slice(0, MAX_RAW_PAYLOAD) }) : raw;
}

function cleanError(error) {
  return String(error?.message || error || 'Unknown provider error').slice(0, 500);
}

function providerError(data, status) {
  return String(data?.error?.message || data?.description || data?.error_description || `HTTP ${status}`)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 240);
}

function isMetaObjectVisibilityError(data) {
  const message = String(data?.error?.message || '');
  const code = Number(data?.error?.code);
  return (code === 100 || code === 803) &&
    /unsupported get request|cannot be loaded due to missing permissions|object with id .+ does not exist|does not support this operation/i.test(message);
}

function metaApiVersion(value) {
  const version = String(value || 'v26.0').trim();
  if (!/^v\d{1,2}\.\d{1,2}$/.test(version)) throw httpError(400, 'Meta API version is invalid.');
  return version;
}

function isRetryableProviderStatus(status) {
  const code = Number(status);
  return code === 408 || code === 425 || code === 429 || code >= 500;
}

function normalizeDeliveryStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'seen') return 'read';
  if (status === 'accepted' || status === 'submitted') return 'sent';
  return ['sent', 'delivered', 'read', 'failed'].includes(status) ? status : '';
}

function isTerminalProviderStatus(status) {
  return ['sent', 'delivered', 'read', 'failed'].includes(String(status || '').toLowerCase());
}

function nonRetryableError(message) {
  const error = new Error(message);
  error.retryable = false;
  return error;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function hashText(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
