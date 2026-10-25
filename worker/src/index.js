import {
  authenticateRequest,
  createInvitation,
  DEFAULT_WORKSPACE_ID,
  finishGoogleOAuth,
  listTeam,
  logout,
  principalView,
  requireRole,
  startGoogleOAuth,
  updateInvitation,
  updateMembership
} from './auth.js';

const API_VERSION = '2026-10-25-whatsapp';
const MAX_TEXT_LENGTH = 4096;
const MAX_RAW_PAYLOAD = 64000;

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
  scheduled(_event, env, ctx) {
    ctx.waitUntil(Promise.all([retryDueMessages(env), cleanupExpiredAuth(env)]));
  }
};

export class InboxHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
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
      return startGoogleOAuth(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/auth/google/callback') return finishGoogleOAuth(request, env);
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
    if (whatsappMatch) return handleWhatsAppWebhook(request, env, decodeURIComponent(whatsappMatch[1]));
    const telegramMatch = url.pathname.match(/^\/webhooks\/telegram\/([^/]+)$/);
    if (telegramMatch && request.method === 'POST') return handleTelegramWebhook(request, env, decodeURIComponent(telegramMatch[1]));
    const genericMatch = url.pathname.match(/^\/webhooks\/generic\/([^/]+)$/);
    if (genericMatch && request.method === 'POST') return handleGenericWebhook(request, env, decodeURIComponent(genericMatch[1]));

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
          { value: 'whatsapp_cloud', label: 'WhatsApp Cloud API', capabilities: ['text'] }
        ]
      }), cors);
    }
    if (url.pathname === '/api/channels' && request.method === 'GET') {
      requireRole(principal, 'admin');
      return withCors(json({ items: await listChannels(env, workspaceId, true) }), cors);
    }
    if (url.pathname === '/api/channels' && request.method === 'POST') {
      requireRole(principal, 'admin');
      const result = await saveChannel(env, workspaceId, await readJson(request), principal);
      await broadcast(env, workspaceId, { type: 'channel.updated', channelId: result.channelId });
      return withCors(json(result, 201), cors);
    }
    const channelVerifyMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/verify$/);
    if (channelVerifyMatch && request.method === 'POST') {
      requireRole(principal, 'admin');
      const channelId = decodeURIComponent(channelVerifyMatch[1]);
      const result = await verifyWhatsAppChannel(env, workspaceId, channelId);
      await broadcast(env, workspaceId, { type: 'channel.updated', channelId });
      return withCors(json(result), cors);
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
      return withCors(json({ items: await listMessages(env, workspaceId, decodeURIComponent(messagesMatch[1]), url) }), cors);
    }
    if (messagesMatch && request.method === 'POST') {
      const id = decodeURIComponent(messagesMatch[1]);
      const result = await createOutboundMessage(env, workspaceId, id, await readJson(request), principal);
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
    if (url.pathname === '/api/demo/seed' && request.method === 'POST') {
      requireRole(principal, 'admin');
      const result = await seedDemo(env, workspaceId, principal);
      await broadcast(env, workspaceId, { type: 'bootstrap.changed' });
      return withCors(json(result, 201), cors);
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

async function handleWhatsAppWebhook(request, env, channelId) {
  const channel = await getChannel(env, channelId, 'whatsapp_cloud');
  if (!channel) return json({ ok: false, error: 'Unknown or disabled channel.' }, 404);
  const prefix = secretPrefix(channel.secretKey);
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const expected = env[`${prefix}_VERIFY_TOKEN`];
    if (url.searchParams.get('hub.mode') === 'subscribe' && expected && timingSafeEqual(url.searchParams.get('hub.verify_token') || '', expected)) {
      await updateChannelRuntimeConfig(env, channel, { webhookVerifiedAt: new Date().toISOString() });
      await broadcast(env, channel.workspaceId, { type: 'channel.updated', channelId });
      return new Response(url.searchParams.get('hub.challenge') || '', { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  const raw = await request.text();
  const appSecret = env[`${prefix}_APP_SECRET`];
  if (!appSecret) return json({ ok: false, error: 'Webhook secret is not configured.' }, 503);
  if (!await verifyMetaSignature(raw, request.headers.get('X-Hub-Signature-256') || '', appSecret)) {
    return json({ ok: false, error: 'Invalid signature.' }, 401);
  }
  const payload = safeJsonParse(raw, null);
  if (!payload) return json({ ok: false, error: 'Invalid JSON.' }, 400);
  const normalized = normalizeWhatsApp(payload);
  const expectedPhoneNumberId = String(env[`${prefix}_PHONE_NUMBER_ID`] || '');
  const hasEvents = normalized.messages.length > 0 || normalized.statuses.length > 0;
  if (hasEvents && (!expectedPhoneNumberId || normalized.phoneNumberIds.length === 0 ||
      normalized.phoneNumberIds.some(id => id !== expectedPhoneNumberId))) {
    return json({ ok: false, error: 'Webhook phone number does not match this channel.' }, 403);
  }
  let received = 0;
  for (const event of normalized.messages) if (await storeInbound(env, channel, event, payload)) received++;
  for (const status of normalized.statuses) await applyProviderStatus(env, channel.workspaceId, channel.channelId, status, payload);
  await updateChannelRuntimeConfig(env, channel, { lastWebhookAt: new Date().toISOString() });
  if (received || normalized.statuses.length) await broadcast(env, channel.workspaceId, { type: 'webhook.received', channelId, received, statuses: normalized.statuses.length });
  return json({ ok: true, received, statuses: normalized.statuses.length });
}

async function handleGenericWebhook(request, env, channelId) {
  const channel = await getChannel(env, channelId, 'generic_http');
  if (!channel) return json({ ok: false, error: 'Unknown or disabled channel.' }, 404);
  const expected = env[`${secretPrefix(channel.secretKey)}_WEBHOOK_TOKEN`];
  if (!expected || !timingSafeEqual(request.headers.get('X-Webhook-Token') || '', expected)) return json({ ok: false, error: 'Invalid webhook token.' }, 401);
  const payload = safeJsonParse(await request.text(), null);
  if (!payload) return json({ ok: false, error: 'Invalid JSON.' }, 400);
  const events = normalizeGeneric(payload, channel.config?.inboundMapping || {});
  let received = 0;
  for (const event of events) if (await storeInbound(env, channel, event, payload)) received++;
  if (received) await broadcast(env, channel.workspaceId, { type: 'webhook.received', channelId, received });
  return json({ ok: true, received });
}

async function handleTelegramWebhook(request, env, channelId) {
  const channel = await getChannel(env, channelId, 'telegram');
  if (!channel) return json({ ok: false, error: 'Unknown or disabled channel.' }, 404);
  const expected = env[`${secretPrefix(channel.secretKey)}_WEBHOOK_TOKEN`];
  if (!expected || !timingSafeEqual(request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '', expected)) {
    return json({ ok: false, error: 'Invalid webhook token.' }, 401);
  }
  const payload = safeJsonParse(await request.text(), null);
  if (!payload) return json({ ok: false, error: 'Invalid JSON.' }, 400);
  const event = normalizeTelegram(payload);
  const received = event && await storeInbound(env, channel, event, payload) ? 1 : 0;
  if (received) await broadcast(env, channel.workspaceId, { type: 'webhook.received', channelId, received });
  return json({ ok: true, received });
}

async function listChannels(env, workspaceId, includeConfiguration = false) {
  const result = await env.DB.prepare(`SELECT channel_id,name,connector_type,enabled,capabilities_json,config_json,secret_key
    FROM channels WHERE workspace_id=?1 ORDER BY name COLLATE NOCASE`).bind(workspaceId).all();
  return result.results.map(row => {
    const config = safeJsonParse(row.config_json, {});
    return {
      channelId: row.channel_id, name: row.name, connectorType: row.connector_type,
      enabled: Boolean(row.enabled), capabilities: safeJsonParse(row.capabilities_json, []),
      health: channelHealth(env, row, config),
      ...(includeConfiguration ? { config, setup: channelSetupView(env, row, config) } : {})
    };
  });
}

function channelHealth(env, row, config = safeJsonParse(row.config_json, {})) {
  if (!row.enabled) return 'disconnected';
  const prefix = secretPrefix(row.secret_key);
  if (row.connector_type === 'whatsapp_cloud') {
    const configured = env[`${prefix}_ACCESS_TOKEN`] && env[`${prefix}_PHONE_NUMBER_ID`] &&
      env[`${prefix}_VERIFY_TOKEN`] && env[`${prefix}_APP_SECRET`];
    if (!configured) return 'setup_required';
    if (!config.credentialsVerifiedAt) return 'configured';
    if (!config.webhookVerifiedAt) return 'webhook_required';
    return 'connected';
  }
  if (row.connector_type === 'telegram') {
    return env[`${prefix}_BOT_TOKEN`] && env[`${prefix}_WEBHOOK_TOKEN`] ? 'connected' : 'setup_required';
  }
  if (row.connector_type === 'generic_http') {
    return env[`${prefix}_WEBHOOK_TOKEN`] ? 'connected' : 'setup_required';
  }
  return 'connected';
}

function channelSetupView(env, row, config = safeJsonParse(row.config_json, {})) {
  if (row.connector_type !== 'whatsapp_cloud') return {};
  const prefix = secretPrefix(row.secret_key);
  return {
    credentialsPresent: Boolean(env[`${prefix}_ACCESS_TOKEN`] && env[`${prefix}_PHONE_NUMBER_ID`] &&
      env[`${prefix}_VERIFY_TOKEN`] && env[`${prefix}_APP_SECRET`]),
    credentialsVerifiedAt: config.credentialsVerifiedAt || '',
    webhookVerifiedAt: config.webhookVerifiedAt || '',
    lastWebhookAt: config.lastWebhookAt || '',
    verifiedPhoneNumber: config.verifiedPhoneNumber || '',
    verifiedName: config.verifiedName || ''
  };
}

async function getChannel(env, id, connectorType = '', workspaceId = '') {
  const row = await env.DB.prepare(`SELECT channel_id,name,connector_type,enabled,capabilities_json,config_json,secret_key,workspace_id
    FROM channels WHERE channel_id=?1 AND enabled=1 AND (?2='' OR workspace_id=?2)`).bind(id, workspaceId).first();
  if (!row || (connectorType && row.connector_type !== connectorType)) return null;
  return {
    channelId: row.channel_id, name: row.name, connectorType: row.connector_type,
    capabilities: safeJsonParse(row.capabilities_json, []), config: safeJsonParse(row.config_json, {}),
    secretKey: row.secret_key, workspaceId: row.workspace_id
  };
}

async function verifyWhatsAppChannel(env, workspaceId, channelId) {
  const channel = await getChannel(env, channelId, 'whatsapp_cloud', workspaceId);
  if (!channel) throw httpError(404, 'WhatsApp channel not found.');
  const prefix = secretPrefix(channel.secretKey);
  const token = env[`${prefix}_ACCESS_TOKEN`];
  const phoneNumberId = String(env[`${prefix}_PHONE_NUMBER_ID`] || '');
  const verifyToken = env[`${prefix}_VERIFY_TOKEN`];
  const appSecret = env[`${prefix}_APP_SECRET`];
  if (!token || !phoneNumberId || !verifyToken || !appSecret) {
    throw httpError(409, 'Secure WhatsApp credentials have not been fully configured.');
  }
  const version = String(channel.config?.apiVersion || env.WHATSAPP_API_VERSION || 'v25.0');
  const endpoint = new URL(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(phoneNumberId)}`);
  endpoint.searchParams.set('fields', 'id,display_phone_number,verified_name');
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  const raw = await response.text();
  const data = safeJsonParse(raw, {});
  if (!response.ok) {
    const providerMessage = String(data?.error?.message || `HTTP ${response.status}`).slice(0, 240);
    throw httpError(502, `Meta could not verify this WhatsApp number: ${providerMessage}`);
  }
  if (String(data.id || '') !== phoneNumberId) throw httpError(502, 'Meta returned a different WhatsApp phone number.');
  const now = new Date().toISOString();
  const config = await updateChannelRuntimeConfig(env, channel, {
    apiVersion: version,
    credentialsVerifiedAt: now,
    verifiedPhoneNumber: String(data.display_phone_number || ''),
    verifiedName: String(data.verified_name || '')
  });
  return {
    ok: true,
    channelId,
    health: config.webhookVerifiedAt ? 'connected' : 'webhook_required',
    verifiedPhoneNumber: config.verifiedPhoneNumber,
    verifiedName: config.verifiedName,
    credentialsVerifiedAt: config.credentialsVerifiedAt,
    webhookVerifiedAt: config.webhookVerifiedAt || ''
  };
}

async function updateChannelRuntimeConfig(env, channel, patch) {
  const config = { ...(channel.config || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === undefined || value === null || value === '') delete config[key];
    else config[key] = value;
  }
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE channels SET config_json=?3,updated_at=?4 WHERE channel_id=?1 AND workspace_id=?2')
    .bind(channel.channelId, channel.workspaceId, JSON.stringify(config), now).run();
  channel.config = config;
  return config;
}

async function saveChannel(env, workspaceId, payload, principal) {
  const name = cleanRequired(payload.name, 'Channel name', 80);
  const connectorType = cleanRequired(payload.connectorType, 'Connector type', 40);
  if (!new Set(['whatsapp_cloud', 'generic_http', 'web_chat', 'telegram']).has(connectorType)) throw httpError(400, 'Unsupported connector type.');
  const channelId = cleanId(payload.channelId || crypto.randomUUID(), 'Channel ID');
  const hasExplicitSecretKey = typeof payload.secretKey === 'string' && payload.secretKey.trim() !== '';
  const requestedPrefix = secretPrefix(cleanRequired(payload.secretKey || `CHANNEL_${channelId}`, 'Secret key', 64));
  const now = new Date().toISOString();
  const config = payload.config && typeof payload.config === 'object' ? payload.config : {};
  if (connectorType === 'generic_http' && config.endpoint) assertAllowedHttpsEndpoint(config.endpoint, config.allowedHosts || []);
  const collision = await env.DB.prepare('SELECT workspace_id,secret_key FROM channels WHERE channel_id=?1').bind(channelId).first();
  if (collision && collision.workspace_id !== workspaceId) throw httpError(409, 'Channel ID is already used by another workspace.');
  const prefix = collision && (!hasExplicitSecretKey || secretPrefix(collision.secret_key) === requestedPrefix)
    ? collision.secret_key
    : workspaceSecretPrefix(workspaceId, requestedPrefix);
  const saved = await env.DB.prepare(`INSERT INTO channels
      (channel_id,name,connector_type,enabled,capabilities_json,config_json,secret_key,created_at,updated_at,workspace_id)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8,?9)
    ON CONFLICT(channel_id) DO UPDATE SET name=excluded.name,connector_type=excluded.connector_type,
      enabled=excluded.enabled,capabilities_json=excluded.capabilities_json,config_json=excluded.config_json,
      secret_key=excluded.secret_key,updated_at=excluded.updated_at WHERE channels.workspace_id=excluded.workspace_id`)
    .bind(channelId, name, connectorType, payload.enabled === false ? 0 : 1,
      JSON.stringify(Array.isArray(payload.capabilities) ? payload.capabilities : ['text']), JSON.stringify(config), prefix, now, workspaceId).run();
  if (!saved.meta?.changes) throw httpError(409, 'Channel ID is already used by another workspace.');
  await audit(env, principal, 'save', 'channel', channelId, { name, connectorType });
  return { ok: true, channelId };
}

async function listConversations(env, workspaceId, url) {
  const limit = clampInt(url.searchParams.get('limit'), 1, 100, 50);
  const status = url.searchParams.get('status') || '';
  const channelId = url.searchParams.get('channelId') || '';
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const cursor = url.searchParams.get('cursor') || '';
  const result = await env.DB.prepare(`SELECT c.conversation_id,c.contact_id,c.channel_id,c.status,c.assigned_to,
      c.subject,c.last_message_at,c.unread_count,c.tags_json,ch.name AS channel_name,
      (SELECT text FROM messages m WHERE m.workspace_id=c.workspace_id AND m.conversation_id=c.conversation_id ORDER BY timestamp DESC LIMIT 1) AS last_message
    FROM conversations c JOIN channels ch ON ch.channel_id=c.channel_id
    WHERE c.workspace_id=?1 AND ch.workspace_id=?1 AND (?2='' OR c.status=?2) AND (?3='' OR c.channel_id=?3)
      AND (?4='' OR c.subject LIKE '%'||?4||'%' OR c.conversation_id LIKE '%'||?4||'%')
      AND (?5='' OR c.last_message_at<?5)
    ORDER BY c.last_message_at DESC LIMIT ?6`).bind(workspaceId, status, channelId, q, cursor, limit).all();
  return result.results.map(row => ({
    conversationId: row.conversation_id, contactId: row.contact_id, channelId: row.channel_id,
    channelName: row.channel_name, status: row.status, assignedTo: row.assigned_to,
    subject: row.subject, lastMessageAt: row.last_message_at, unreadCount: row.unread_count,
    tags: safeJsonParse(row.tags_json, []), lastMessage: row.last_message || ''
  }));
}

async function listContacts(env, workspaceId, url) {
  const limit = clampInt(url.searchParams.get('contactLimit'), 1, 200, 100);
  const result = await env.DB.prepare(`SELECT c.contact_id,c.display_name,c.attributes_json,c.updated_at,
      i.channel_id,i.channel_profile_id,cv.status,cv.tags_json,cv.last_message_at
    FROM contacts c
    LEFT JOIN channel_identities i ON i.identity_id=(SELECT identity_id FROM channel_identities
      WHERE workspace_id=c.workspace_id AND contact_id=c.contact_id ORDER BY created_at LIMIT 1)
    LEFT JOIN conversations cv ON cv.conversation_id=(SELECT conversation_id FROM conversations
      WHERE workspace_id=c.workspace_id AND contact_id=c.contact_id ORDER BY last_message_at DESC LIMIT 1)
    WHERE c.workspace_id=?1
    ORDER BY COALESCE(cv.last_message_at,c.updated_at) DESC LIMIT ?2`).bind(workspaceId, limit).all();
  return result.results.map(row => {
    const attributes = safeJsonParse(row.attributes_json, {});
    return {
      contactId: row.contact_id, displayName: row.display_name, channelId: row.channel_id || '',
      channelProfileId: row.channel_profile_id || '', email: attributes.email || '',
      phone: attributes.phone || '', tags: safeJsonParse(row.tags_json, []),
      status: row.status === 'closed' ? 'inactive' : 'active', lastMessageAt: row.last_message_at || row.updated_at
    };
  });
}

async function listMessages(env, workspaceId, conversationId, url) {
  const limit = clampInt(url.searchParams.get('limit'), 1, 200, 100);
  const before = url.searchParams.get('before') || '';
  if (!await env.DB.prepare('SELECT 1 FROM conversations WHERE conversation_id=?1 AND workspace_id=?2').bind(conversationId, workspaceId).first()) throw httpError(404, 'Conversation not found.');
  const result = await env.DB.prepare(`SELECT message_id,direction,text,message_type,status,timestamp,channel_id,provider_message_id,error
    FROM messages WHERE workspace_id=?1 AND conversation_id=?2 AND (?3='' OR timestamp<?3) ORDER BY timestamp DESC LIMIT ?4`)
    .bind(workspaceId, conversationId, before, limit).all();
  return result.results.reverse().map(row => ({
    messageId: row.message_id, direction: row.direction, text: row.text, messageType: row.message_type,
    status: row.status, timestamp: row.timestamp, channelId: row.channel_id,
    providerMessageId: row.provider_message_id, error: row.error
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
  const displayName = cleanRequired(payload.displayName, 'Display name', 120);
  const channelId = cleanId(payload.channelId, 'Channel ID');
  const channel = await getChannel(env, channelId, '', workspaceId);
  if (!channel) throw httpError(400, 'Unknown or disabled channel.');
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
      env.DB.prepare('INSERT INTO contacts (contact_id,display_name,created_at,updated_at,workspace_id) VALUES (?1,?2,?3,?3,?4)').bind(contactId, displayName, now, workspaceId),
      env.DB.prepare(`INSERT INTO channel_identities (identity_id,contact_id,channel_id,channel_profile_id,display_name,created_at,workspace_id)
        VALUES (?1,?2,?3,?4,?5,?6,?7)`).bind(identityId, contactId, channelId, channelProfileId, displayName, now, workspaceId),
      env.DB.prepare(`INSERT INTO conversations (conversation_id,contact_id,channel_id,status,assigned_to,subject,last_message_at,created_at,updated_at,workspace_id)
        VALUES (?1,?2,?3,'open',?4,?5,?6,?6,?6,?7)`).bind(conversationId, contactId, channelId, principal.user.email, displayName, now, workspaceId)
    ]);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw httpError(409, 'This channel identity already exists.');
    throw error;
  }
  await audit(env, principal, 'create', 'contact', contactId, { channelId, conversationId });
  return { ok: true, contactId, conversationId };
}

async function createOutboundMessage(env, workspaceId, conversationId, payload, principal) {
  const text = cleanRequired(payload.text, 'Message text', MAX_TEXT_LENGTH);
  const row = await env.DB.prepare(`SELECT c.contact_id,c.channel_id,i.channel_profile_id FROM conversations c
    JOIN channel_identities i ON i.contact_id=c.contact_id AND i.channel_id=c.channel_id AND i.workspace_id=c.workspace_id
    WHERE c.conversation_id=?1 AND c.workspace_id=?2`).bind(conversationId, workspaceId).first();
  if (!row) throw httpError(404, 'Conversation or channel identity not found.');
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

async function sendOrQueue(env, messageId) {
  try {
    await markMessageSent(env, messageId, await dispatchOutbound(env, messageId));
  } catch (error) {
    const message = await env.DB.prepare('SELECT workspace_id FROM messages WHERE message_id=?1').bind(messageId).first();
    if (!message) throw error;
    if (error?.retryable === false) {
      await env.DB.batch([
        env.DB.prepare("UPDATE messages SET status='failed',error=?2 WHERE message_id=?1").bind(messageId, cleanError(error)),
        env.DB.prepare('DELETE FROM outbox WHERE message_id=?1').bind(messageId)
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
  const row = await env.DB.prepare(`SELECT m.*,c.config_json,c.connector_type,c.secret_key,c.enabled,
      i.channel_profile_id,cv.contact_id FROM messages m JOIN channels c ON c.channel_id=m.channel_id
      AND c.workspace_id=m.workspace_id JOIN conversations cv ON cv.conversation_id=m.conversation_id AND cv.workspace_id=m.workspace_id
      JOIN channel_identities i ON i.contact_id=cv.contact_id AND i.channel_id=cv.channel_id AND i.workspace_id=m.workspace_id
      WHERE m.message_id=?1`).bind(messageId).first();
  if (!row) throw new Error('Outbound message not found.');
  if (!row.enabled) throw new Error('Channel is disabled.');
  const channel = { connectorType: row.connector_type, config: safeJsonParse(row.config_json, {}), secretKey: row.secret_key };
  let result;
  if (channel.connectorType === 'whatsapp_cloud') result = await sendWhatsApp(env, channel, row.channel_profile_id, row.text);
  else if (channel.connectorType === 'generic_http') result = await sendGeneric(env, channel, row);
  else if (channel.connectorType === 'telegram') result = await sendTelegram(env, channel, row.channel_profile_id, row.text);
  else if (channel.connectorType === 'web_chat') result = { status: 'sent', providerMessageId: row.message_id, httpStatus: 200 };
  else throw new Error(`Outbound connector ${channel.connectorType} is not implemented yet.`);
  return { ...result, workspaceId: row.workspace_id };
}

async function sendWhatsApp(env, channel, recipient, text) {
  const prefix = secretPrefix(channel.secretKey);
  const token = env[`${prefix}_ACCESS_TOKEN`];
  const phoneNumberId = env[`${prefix}_PHONE_NUMBER_ID`];
  if (!token || !phoneNumberId) throw new Error('WhatsApp channel secrets are not configured.');
  const normalizedRecipient = normalizeWhatsAppRecipient(recipient);
  const version = String(channel.config?.apiVersion || env.WHATSAPP_API_VERSION || 'v25.0');
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
  const token = env[`${secretPrefix(channel.secretKey)}_BOT_TOKEN`];
  if (!token) throw new Error('Telegram bot token is not configured.');
  const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  });
  const raw = await response.text();
  const data = safeJsonParse(raw, {});
  if (!response.ok || data.ok === false) throw new Error(`Telegram API HTTP ${response.status}: ${raw.slice(0, 500)}`);
  return { status: 'sent', providerMessageId: String(data.result?.message_id || ''), httpStatus: response.status };
}

async function markMessageSent(env, messageId, result) {
  await env.DB.batch([
    env.DB.prepare("UPDATE messages SET status=?2,provider_message_id=?3,payload_json=?4,error='' WHERE message_id=?1")
      .bind(messageId, result.status || 'submitted', result.providerMessageId || '', JSON.stringify(result)),
    env.DB.prepare('DELETE FROM outbox WHERE message_id=?1').bind(messageId)
  ]);
  await broadcast(env, result.workspaceId, { type: 'message.updated', messageId, status: result.status || 'submitted' });
}

async function retryDueMessages(env) {
  const now = new Date().toISOString();
  const due = await env.DB.prepare(`SELECT outbox_id,message_id,attempts,max_attempts,workspace_id FROM outbox
    WHERE status='pending' AND next_attempt_at<=?1 ORDER BY next_attempt_at LIMIT 25`).bind(now).all();
  for (const job of due.results) {
    await env.DB.prepare("UPDATE outbox SET status='processing',updated_at=?2 WHERE outbox_id=?1 AND status='pending'").bind(job.outbox_id, now).run();
    try {
      await markMessageSent(env, job.message_id, await dispatchOutbound(env, job.message_id));
    } catch (error) {
      const attempts = Number(job.attempts) + 1;
      const exhausted = attempts >= Number(job.max_attempts);
      const delaySeconds = Math.min(3600, 30 * (2 ** Math.min(attempts, 7)));
      const next = new Date(Date.now() + delaySeconds * 1000).toISOString();
      await env.DB.batch([
        env.DB.prepare('UPDATE outbox SET status=?2,attempts=?3,next_attempt_at=?4,last_error=?5,updated_at=?6 WHERE outbox_id=?1')
          .bind(job.outbox_id, exhausted ? 'failed' : 'pending', attempts, next, cleanError(error), now),
        env.DB.prepare('UPDATE messages SET status=?2,error=?3 WHERE message_id=?1')
          .bind(job.message_id, exhausted ? 'failed' : 'retrying', cleanError(error))
      ]);
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
    WHERE workspace_id=?1 AND contact_id=?2 AND channel_id=?3 AND status!='closed' ORDER BY created_at DESC LIMIT 1`)
    .bind(channel.workspaceId, identity.contact_id, channel.channelId).first();
  if (!conversation) {
    conversation = { conversation_id: crypto.randomUUID() };
    await env.DB.prepare(`INSERT INTO conversations (conversation_id,contact_id,channel_id,status,subject,last_message_at,unread_count,created_at,updated_at,workspace_id)
      VALUES (?1,?2,?3,'open',?4,?5,0,?6,?6,?7)`).bind(conversation.conversation_id, identity.contact_id, channel.channelId,
      String(event.displayName || event.channelProfileId).slice(0, 120), timestamp, now, channel.workspaceId).run();
  }
  const messageId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO messages (message_id,conversation_id,contact_id,channel_id,direction,message_type,text,
      provider_message_id,status,timestamp,payload_json,workspace_id) VALUES (?1,?2,?3,?4,'inbound',?5,?6,?7,'received',?8,?9,?10)`)
      .bind(messageId, conversation.conversation_id, identity.contact_id, channel.channelId, String(event.messageType || 'text').slice(0, 40),
        String(event.text || '').slice(0, MAX_TEXT_LENGTH), String(event.providerMessageId || ''), timestamp, truncateJson(rawPayload), channel.workspaceId),
    env.DB.prepare('UPDATE conversations SET last_message_at=?3,unread_count=unread_count+1,updated_at=?4 WHERE conversation_id=?1 AND workspace_id=?2')
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
  if (!event.providerMessageId || !event.status) return;
  const key = `${workspaceId}:${channelId}:status:${event.providerMessageId}:${event.status}:${event.timestamp || ''}`;
  const dedupe = await env.DB.prepare(`INSERT OR IGNORE INTO webhook_events (event_key,channel_id,event_type,received_at,workspace_id)
    VALUES (?1,?2,'status',?3,?4)`).bind(key, channelId, new Date().toISOString(), workspaceId).run();
  if (!dedupe.meta?.changes) return;
  try {
    const updated = await env.DB.prepare(`UPDATE messages SET status=?4,payload_json=?5,error=?6
      WHERE workspace_id=?1 AND channel_id=?2 AND provider_message_id=?3`)
      .bind(workspaceId, channelId, event.providerMessageId, event.status, truncateJson(rawPayload), String(event.error || '').slice(0, 500)).run();
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
          error: status.errors?.[0]?.title || status.errors?.[0]?.message || ''
        });
      }
    }
  }
  return {
    messages: messages.filter(item => item.channelProfileId),
    statuses: statuses.filter(item => item.providerMessageId),
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
  return events.map(event => ({
    channelProfileId: getPath(event, mapping.senderIdPath || 'from'),
    displayName: getPath(event, mapping.senderNamePath || 'senderName') || '',
    text: getPath(event, mapping.textPath || 'text') || '',
    providerMessageId: getPath(event, mapping.messageIdPath || 'id') || '',
    timestamp: getPath(event, mapping.timestampPath || 'timestamp') || '',
    messageType: getPath(event, mapping.messageTypePath || 'type') || 'text'
  })).filter(item => item.channelProfileId);
}

export function normalizeTelegram(payload) {
  const message = payload?.message || payload?.edited_message || payload?.channel_post || null;
  if (!message?.chat?.id) return null;
  const name = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || message.chat.title || String(message.chat.id);
  return {
    channelProfileId: String(message.chat.id), displayName: name,
    text: message.text || message.caption || '', providerMessageId: String(message.message_id || payload.update_id || ''),
    timestamp: message.date ? new Date(Number(message.date) * 1000).toISOString() : '',
    messageType: message.text ? 'text' : message.photo ? 'image' : message.document ? 'document' : 'message'
  };
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
  try { return await request.json(); } catch { throw httpError(400, 'Invalid JSON body.'); }
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

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function hashText(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
