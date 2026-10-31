import {
  authenticateRequest,
  createMobileAuthChallenge,
  createGoogleMobileSession,
  createInvitation,
  finishGoogleOAuthResponse,
  listTeam,
  logout,
  mobileAuthConfiguration,
  principalView,
  requireRole,
  restrictedChannelIds,
  startGoogleOAuth,
  updateInvitation,
  updateMembership
} from './auth.js';
import {
  mobilePushStatus,
  pushConfiguration,
  removeMobilePushDevice,
  removePushSubscription,
  saveMobilePushDevice,
  savePushSubscription,
  sendWorkspaceMobileConversationRead,
  sendWorkspaceNotifications
} from './push.js';
import {
  addPlatformAdmin,
  assertPlatformAdmin,
  cancelWorkspaceInvitation,
  createClientWorkspace,
  deleteClientWorkspace,
  getClientWorkspace,
  inviteWorkspaceMember,
  listClientWorkspaces,
  listPlatformAdmins,
  platformOverview,
  platformProfile,
  removePlatformAdmin,
  removeWorkspaceMember,
  updateClientWorkspace,
  updateWorkspaceMember
} from './platform.js';
import {
  INTERAKT_SOURCE,
  extractInteraktCustomer,
  mapInteraktMessage,
  normalizeFieldMapping,
  validateInteraktBatch
} from './imports/interakt.js';

const API_VERSION = '2026-10-26-chat-media';
const MAX_TEXT_LENGTH = 4096;
const MAX_TEMPLATE_PREVIEW_LENGTH = 16384;
const MAX_RAW_PAYLOAD = 64000;
const MAX_JSON_BODY = 32768;
const MAX_IMPORT_JSON_BODY = 1_500_000;
const MAX_EXTERNAL_JSON_BODY = 131072;
const MAX_CREDENTIAL_LENGTH = 4096;
const WHATSAPP_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;
const MAX_ATTACHMENT_CAPTION_LENGTH = 1024;
const WHATSAPP_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const TELEGRAM_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const EXTERNAL_API_OPERATION = 'whatsapp.template.send';
const EXTERNAL_API_IDEMPOTENCY_DAYS = 7;
const LEGACY_WORKSPACE_ID = 'ws_default';
const WHATSAPP_TEMPLATE_CACHE_SECONDS = 5 * 60;
const WHATSAPP_TEMPLATE_CACHE_ORIGIN = 'https://template-cache.helixcer.internal';
const MANAGED_CONNECTORS = new Set(['whatsapp_cloud', 'telegram', 'instagram']);
const CONTACT_ID_PLATFORMS = Object.freeze(['whatsapp', 'telegram', 'instagram', 'facebook', 'email']);
const CONTACT_ID_PLATFORM_SET = new Set(CONTACT_ID_PLATFORMS);
// Only these providers expose an address that is portable between connected
// accounts. Instagram/Facebook profile ids are account/app scoped, so an
// identical value observed on another channel is not evidence of one person.
const PORTABLE_IDENTITY_PLATFORMS = new Set(['whatsapp', 'telegram']);
const TEMPLATE_BUTTON_TYPES = new Set(['quick_reply', 'url', 'phone_number', 'copy_code', 'catalog', 'mpm', 'flow', 'otp']);
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
      JOIN workspaces w ON w.workspace_id=s.workspace_id AND w.status='active'
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
    if (request.method === 'GET' && url.pathname === '/auth/mobile/config') {
      return json(mobileAuthConfiguration(env));
    }
    if (request.method === 'POST' && url.pathname === '/auth/mobile/challenge') {
      const limited = await enforceOAuthRateLimit(request, env);
      if (limited) return limited;
      return json(await createMobileAuthChallenge(env, await readJson(request)), 201);
    }
    if (request.method === 'POST' && url.pathname === '/auth/mobile/google') {
      const limited = await enforceOAuthRateLimit(request, env);
      if (limited) return limited;
      return json(await createGoogleMobileSession(env, await readJson(request)));
    }
    if (request.method === 'POST' && (url.pathname === '/auth/logout' || url.pathname === '/api/logout')) {
      const logoutPrincipal = await authenticateRequest(request, env);
      if (logoutPrincipal?.authType === 'session' && !cors['Access-Control-Allow-Origin']) {
        return json({ ok: false, error: 'Origin not allowed.' }, 403);
      }
      if (!logoutPrincipal && !cors['Access-Control-Allow-Origin']) {
        return json({ ok: false, error: 'Origin not allowed.' }, 403);
      }
      const response = await logout(request, env);
      if (logoutPrincipal?.authType === 'session' || logoutPrincipal?.authType === 'mobile_session') {
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
    if (url.pathname === '/api/realtime' && request.headers.get('Origin') && !cors['Access-Control-Allow-Origin']) {
      return json({ ok: false, error: 'Origin not allowed.' }, 403);
    }
    const principal = await authenticateRequest(request, env);
    if (!principal) return withCors(json({ ok: false, error: 'Unauthorized.' }, 401), cors);
    if (mutation && principal.authType === 'session' && !cors['Access-Control-Allow-Origin']) {
      return json({ ok: false, error: 'Origin not allowed.' }, 403);
    }
    const workspaceId = principal.workspace.workspaceId;
    if (url.pathname.startsWith('/api/platform/')) {
      await assertPlatformAdmin(env, principal);
      if (request.method === 'GET' && url.pathname === '/api/platform/me') {
        return withCors(json(await platformProfile(env, principal)), cors);
      }
      if (request.method === 'GET' && url.pathname === '/api/platform/overview') {
        return withCors(json(await platformOverview(env)), cors);
      }
      if (url.pathname === '/api/platform/clients') {
        if (request.method === 'GET') return withCors(json(await listClientWorkspaces(env, url)), cors);
        if (request.method === 'POST') {
          return withCors(json(await createClientWorkspace(env, principal, request, await readJson(request)), 201), cors);
        }
      }
      const clientMatch = url.pathname.match(/^\/api\/platform\/clients\/([^/]+)$/);
      if (clientMatch) {
        const clientId = decodeURIComponent(clientMatch[1]);
        if (request.method === 'GET') return withCors(json(await getClientWorkspace(env, clientId)), cors);
        if (request.method === 'PATCH') {
          const result = await updateClientWorkspace(env, principal, clientId, await readJson(request));
          if (result.suspended) await disconnectRealtime(env, clientId, {});
          return withCors(json(result), cors);
        }
        if (request.method === 'DELETE') {
          const result = await deleteClientWorkspace(env, principal, clientId, await readJson(request));
          await disconnectRealtime(env, clientId, {});
          return withCors(json(result), cors);
        }
      }
      const memberMatch = url.pathname.match(/^\/api\/platform\/clients\/([^/]+)\/members\/([^/]+)$/);
      if (memberMatch) {
        const clientId = decodeURIComponent(memberMatch[1]);
        const membershipId = decodeURIComponent(memberMatch[2]);
        if (request.method === 'PATCH') {
          const result = await updateWorkspaceMember(env, principal, clientId, membershipId, await readJson(request));
          if (result.item?.status === 'disabled') await disconnectRealtime(env, clientId, { membershipId });
          return withCors(json(result), cors);
        }
        if (request.method === 'DELETE') {
          const result = await removeWorkspaceMember(env, principal, clientId, membershipId);
          await disconnectRealtime(env, clientId, { membershipId });
          return withCors(json(result), cors);
        }
      }
      const invitationsMatch = url.pathname.match(/^\/api\/platform\/clients\/([^/]+)\/invitations$/);
      if (invitationsMatch && request.method === 'POST') {
        const clientId = decodeURIComponent(invitationsMatch[1]);
        return withCors(json(await inviteWorkspaceMember(env, principal, request, clientId, await readJson(request)), 201), cors);
      }
      const invitationMatch = url.pathname.match(/^\/api\/platform\/clients\/([^/]+)\/invitations\/([^/]+)$/);
      if (invitationMatch && request.method === 'DELETE') {
        const clientId = decodeURIComponent(invitationMatch[1]);
        const invitationId = decodeURIComponent(invitationMatch[2]);
        return withCors(json(await cancelWorkspaceInvitation(env, principal, clientId, invitationId)), cors);
      }
      if (url.pathname === '/api/platform/admins') {
        if (request.method === 'GET') return withCors(json(await listPlatformAdmins(env, principal)), cors);
        if (request.method === 'POST') {
          return withCors(json(await addPlatformAdmin(env, principal, request, await readJson(request)), 201), cors);
        }
      }
      const adminMatch = url.pathname.match(/^\/api\/platform\/admins\/([^/]+)$/);
      if (adminMatch && request.method === 'DELETE') {
        return withCors(json(await removePlatformAdmin(env, principal, decodeURIComponent(adminMatch[1]))), cors);
      }
      return withCors(json({ ok: false, error: 'API route not found.' }, 404), cors);
    }
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
    if (url.pathname === '/api/push/mobile-config' && request.method === 'GET') {
      if (principal.authType !== 'mobile_session') {
        return withCors(json({ ok: false, error: 'A verified mobile session is required.' }, 403), cors);
      }
      return withCors(json(await mobilePushStatus(env, principal, url.searchParams.get('deviceId') || '')), cors);
    }
    if (url.pathname === '/api/push/mobile-devices' && request.method === 'POST') {
      return withCors(json(await saveMobilePushDevice(env, principal, await readJson(request)), 201), cors);
    }
    if (url.pathname === '/api/push/mobile-devices' && request.method === 'DELETE') {
      return withCors(json(await removeMobilePushDevice(env, principal, await readJson(request))), cors);
    }
    if (url.pathname === '/api/realtime' && request.method === 'GET') {
      if (principal.authType === 'session' && !cors['Access-Control-Allow-Origin']) {
        return json({ ok: false, error: 'Origin not allowed.' }, 403);
      }
      if (principal.authType !== 'session' && principal.authType !== 'mobile_session') {
        return json({ ok: false, error: 'A verified session is required for realtime.' }, 403);
      }
      const headers = new Headers({
        Upgrade: 'websocket',
        'X-Helixcer-Session-Id': principal.sessionId,
        'X-Helixcer-Membership-Id': principal.membership.membershipId,
        'X-Helixcer-Session-Expires-At': principal.sessionExpiresAt
      });
      return inboxHub(env, workspaceId).fetch('https://hub.internal/connect', { headers });
    }
    if (url.pathname === '/api/bootstrap' && request.method === 'GET') {
      const allowedChannels = restrictedChannelIds(principal);
      const [channelsRaw, conversationPage, contactPage, tags, workspace] = await Promise.all([
        listChannels(env, workspaceId, principal.membership.role !== 'agent'),
        listConversations(env, workspaceId, url, { allowedChannelIds: allowedChannels }),
        listContacts(env, workspaceId, url),
        listWorkspaceTags(env, workspaceId),
        getWorkspaceProfile(env, workspaceId)
      ]);
      const channels = allowedChannels
        ? channelsRaw.filter(channel => allowedChannels.includes(channel.channelId))
        : channelsRaw;
      return withCors(json({
        appName: env.APP_NAME || 'Helixcer Chat',
        channels,
        conversations: conversationPage.items,
        conversationNextCursor: conversationPage.nextCursor,
        contacts: contactPage.items,
        contactNextCursor: contactPage.nextCursor,
        tags,
        workspace,
        me: principalView(principal),
        connectorTypes: [
          { value: 'whatsapp_cloud', label: 'WhatsApp Cloud API', capabilities: ['text'] },
          { value: 'telegram', label: 'Telegram Bot', capabilities: ['text'] },
          { value: 'instagram', label: 'Instagram Messaging', capabilities: ['text'] }
        ]
      }), cors);
    }
    if (url.pathname === '/api/workspace' && request.method === 'GET') {
      return withCors(json({ item: await getWorkspaceProfile(env, workspaceId) }), cors);
    }
    if (url.pathname === '/api/workspace' && request.method === 'PATCH') {
      requireRole(principal, 'admin');
      const item = await updateWorkspaceProfile(env, workspaceId, await readJson(request), principal);
      await broadcast(env, workspaceId, { type: 'workspace.updated', workspace: item });
      return withCors(json({ ok: true, item }), cors);
    }
    if (url.pathname === '/api/channels' && request.method === 'GET') {
      requireRole(principal, 'admin');
      return withCors(json({ items: await listChannels(env, workspaceId, true) }), cors);
    }
    if (url.pathname === '/api/channel-data/whatsapp-templates' && request.method === 'GET') {
      requireRole(principal, 'admin');
      return withCors(json(await listWorkspaceWhatsAppTemplates(env, workspaceId, {
        forceRefresh: url.searchParams.get('refresh') === '1'
      })), cors);
    }
    if (url.pathname === '/api/channel-data/import-chat' && request.method === 'POST') {
      requireRole(principal, 'admin');
      const result = await importChatHistory(env, workspaceId, principal, await readImportJson(request));
      await broadcast(env, workspaceId, { type: 'bootstrap.changed' });
      return withCors(json(result, 201), cors);
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
      const page = await listConversations(env, workspaceId, url, {
        allowedChannelIds: restrictedChannelIds(principal)
      });
      return withCors(json({ items: page.items, nextCursor: page.nextCursor }), cors);
    }
    if (url.pathname === '/api/conversations' && request.method === 'POST') {
      const result = await openIdentityConversation(env, workspaceId, await readJson(request), principal);
      await broadcast(env, workspaceId, { type: 'conversation.created', conversationId: result.conversationId });
      return withCors(json(result, 201), cors);
    }
    if (url.pathname === '/api/search/messages' && request.method === 'GET') {
      return withCors(json({
        items: await searchMessages(env, workspaceId, url, {
          allowedChannelIds: restrictedChannelIds(principal)
        })
      }), cors);
    }
    const conversationMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
    if (conversationMatch && request.method === 'PATCH') {
      const id = decodeURIComponent(conversationMatch[1]);
      await assertConversationChannelAccess(env, workspaceId, id, principal);
      const payload = await readJson(request);
      const item = await updateConversation(env, workspaceId, id, payload, principal);
      await broadcast(env, workspaceId, { type: 'conversation.updated', conversationId: id, conversation: item });
      if (payload.markRead && Number(item.unreadCount || 0) === 0) {
        scheduleConversationReadPush(ctx, env, workspaceId, item);
      }
      return withCors(json({ ok: true, item }), cors);
    }
    if (conversationMatch && request.method === 'DELETE') {
      requireRole(principal, 'admin');
      const id = decodeURIComponent(conversationMatch[1]);
      const result = await deleteConversation(env, workspaceId, id, principal);
      await broadcast(env, workspaceId, { type: 'conversation.deleted', conversationId: id });
      return withCors(json(result), cors);
    }
    const messagesMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (messagesMatch && request.method === 'GET') {
      const id = decodeURIComponent(messagesMatch[1]);
      await assertConversationChannelAccess(env, workspaceId, id, principal);
      const [items, replyWindow] = await Promise.all([
        listMessages(env, workspaceId, id, url),
        getConversationReplyWindow(env, workspaceId, id)
      ]);
      return withCors(json({ items, ...replyWindow }), cors);
    }
    if (messagesMatch && request.method === 'POST') {
      const id = decodeURIComponent(messagesMatch[1]);
      const result = await createOutboundMessage(env, workspaceId, id, await readJson(request), principal);
      await broadcast(env, workspaceId, {
        type: 'message.created', conversationId: id, messageId: result.message.messageId, message: result.message
      });
      ctx.waitUntil(sendOrQueue(env, result.message.messageId));
      return withCors(json({ ok: true, item: result.message }, 202), cors);
    }
    const messageAttachmentMatch = url.pathname.match(/^\/api\/messages\/([^/]+)\/attachment$/);
    if (messageAttachmentMatch && request.method === 'GET') {
      const messageId = decodeURIComponent(messageAttachmentMatch[1]);
      return withCors(await streamMessageAttachment(env, workspaceId, messageId, request, url, principal), cors);
    }
    const conversationTemplatesMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/templates$/);
    if (conversationTemplatesMatch && request.method === 'GET') {
      const id = decodeURIComponent(conversationTemplatesMatch[1]);
      await assertConversationChannelAccess(env, workspaceId, id, principal);
      return withCors(json({ items: await listConversationTemplates(env, workspaceId, id, {
        forceRefresh: url.searchParams.get('refresh') === '1',
        channelId: url.searchParams.get('channelId') || '',
        identityId: url.searchParams.get('identityId') || ''
      }) }), cors);
    }
    const templateMessageMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/template$/);
    if (templateMessageMatch && request.method === 'POST') {
      const id = decodeURIComponent(templateMessageMatch[1]);
      const result = await createConversationTemplateMessage(env, workspaceId, id, await readJson(request), principal);
      await broadcast(env, workspaceId, {
        type: 'message.created', conversationId: id, messageId: result.message.messageId, message: result.message
      });
      ctx.waitUntil(sendOrQueue(env, result.message.messageId));
      return withCors(json({ ok: true, item: result.message }, 202), cors);
    }
    const templateMediaMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/template-media$/);
    if (templateMediaMatch && request.method === 'POST') {
      const id = decodeURIComponent(templateMediaMatch[1]);
      await assertConversationChannelAccess(env, workspaceId, id, principal);
      return withCors(json(await uploadConversationTemplateMedia(env, workspaceId, id, request), 201), cors);
    }
    const attachmentMessageMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/attachments$/);
    if (attachmentMessageMatch && request.method === 'POST') {
      const id = decodeURIComponent(attachmentMessageMatch[1]);
      const result = await createConversationAttachmentMessage(env, workspaceId, id, request, principal);
      await broadcast(env, workspaceId, {
        type: 'message.created', conversationId: id, messageId: result.message.messageId, message: result.message
      });
      if (result.message.status === 'pending') ctx.waitUntil(sendOrQueue(env, result.message.messageId));
      return withCors(json({ ok: true, item: result.message }, 202), cors);
    }
    if (['/api/contacts/export', '/api/contacts/export.csv'].includes(url.pathname) && request.method === 'GET') {
      return withCors(await exportContactsCsv(env, workspaceId), cors);
    }
    if (url.pathname === '/api/contacts' && request.method === 'POST') {
      const result = await createContact(env, workspaceId, await readJson(request), principal);
      if (result.conversationId) {
        await broadcast(env, workspaceId, { type: 'conversation.created', conversationId: result.conversationId });
      } else {
        await broadcast(env, workspaceId, { type: 'contact.created', contactId: result.contactId });
      }
      return withCors(json(result, 201), cors);
    }
    if (url.pathname === '/api/contacts' && request.method === 'GET') {
      const page = await listContacts(env, workspaceId, url);
      return withCors(json({ items: page.items, nextCursor: page.nextCursor }), cors);
    }
    if (url.pathname === '/api/tags' && request.method === 'GET') {
      return withCors(json({ items: await listWorkspaceTags(env, workspaceId) }), cors);
    }
    const contactIdentityCollectionMatch = url.pathname.match(/^\/api\/contacts\/([^/]+)\/identities$/);
    if (contactIdentityCollectionMatch && request.method === 'POST') {
      const contactId = decodeURIComponent(contactIdentityCollectionMatch[1]);
      const result = await createContactIdentity(env, workspaceId, contactId, await readJson(request), principal);
      await broadcast(env, workspaceId, { type: 'contact.updated', contactId });
      return withCors(json(result, 201), cors);
    }
    const contactIdentityMatch = url.pathname.match(/^\/api\/contacts\/([^/]+)\/identities\/([^/]+)$/);
    if (contactIdentityMatch && request.method === 'PATCH') {
      const contactId = decodeURIComponent(contactIdentityMatch[1]);
      const identityId = decodeURIComponent(contactIdentityMatch[2]);
      const result = await updateContactIdentity(env, workspaceId, contactId, identityId, await readJson(request), principal);
      await broadcast(env, workspaceId, { type: 'contact.updated', contactId });
      return withCors(json(result), cors);
    }
    if (contactIdentityMatch && request.method === 'DELETE') {
      const contactId = decodeURIComponent(contactIdentityMatch[1]);
      const identityId = decodeURIComponent(contactIdentityMatch[2]);
      const result = await deleteContactIdentity(env, workspaceId, contactId, identityId, principal);
      await broadcast(env, workspaceId, { type: 'contact.updated', contactId });
      return withCors(json(result), cors);
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
    if (contactMatch && request.method === 'DELETE') {
      requireRole(principal, 'admin');
      const id = decodeURIComponent(contactMatch[1]);
      const result = await deleteContact(env, workspaceId, id, principal);
      await broadcast(env, workspaceId, { type: 'contact.deleted', contactId: id, conversationIds: result.conversationIds });
      return withCors(json(result), cors);
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
      return withCors(json(await deleteApiKey(env, workspaceId, principal, decodeURIComponent(apiKeyMatch[1]))), cors);
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
    if (memberMatch && request.method === 'DELETE') {
      requireRole(principal, 'admin');
      const membershipId = decodeURIComponent(memberMatch[1]);
      const result = await deleteTeamMember(env, workspaceId, membershipId, principal);
      await broadcast(env, workspaceId, { type: 'team.updated' });
      await disconnectRealtime(env, workspaceId, { membershipId });
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

async function deleteApiKey(env, workspaceId, principal, apiKeyId) {
  const id = cleanId(apiKeyId, 'API key ID');
  const existing = await env.DB.prepare(`SELECT name,key_prefix,status FROM api_keys
    WHERE api_key_id=?1 AND workspace_id=?2`).bind(id, workspaceId).first();
  if (!existing) throw httpError(404, 'API key not found.');
  const result = await env.DB.prepare('DELETE FROM api_keys WHERE api_key_id=?1 AND workspace_id=?2')
    .bind(id, workspaceId).run();
  if (!result.meta?.changes) throw httpError(404, 'API key not found.');
  await audit(env, principal, 'delete', 'api_key', id, {
    name: existing.name, keyPrefix: existing.key_prefix, previousStatus: existing.status
  });
  return { ok: true, apiKeyId: id, deleted: true };
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

async function deleteTeamMember(env, workspaceId, membershipId, principal) {
  const id = cleanId(membershipId, 'Membership ID');
  const target = await env.DB.prepare(`SELECT m.membership_id,m.user_id,m.role,m.status,u.email,u.display_name
    FROM memberships m JOIN users u ON u.user_id=m.user_id
    WHERE m.membership_id=?1 AND m.workspace_id=?2`).bind(id, workspaceId).first();
  if (!target) throw httpError(404, 'Team member not found.');
  if (principal.membership?.role === 'admin' && target.role !== 'agent') {
    throw httpError(403, 'Administrators can only remove agents.');
  }
  if (principal.membership?.membershipId && principal.membership.membershipId === id) {
    throw httpError(409, 'You cannot remove your own workspace membership.');
  }
  if (target.role === 'owner' && target.status === 'active') {
    const owners = await env.DB.prepare(`SELECT COUNT(*) AS count FROM memberships
      WHERE workspace_id=?1 AND role='owner' AND status='active'`).bind(workspaceId).first();
    if (Number(owners?.count || 0) <= 1) throw httpError(409, 'The workspace must retain at least one active owner.');
  }
  const now = new Date().toISOString();
  const deleted = await env.DB.batch([
    env.DB.prepare(`DELETE FROM memberships WHERE membership_id=?1 AND workspace_id=?2 AND (
      role!='owner' OR status!='active' OR
      (SELECT COUNT(*) FROM memberships WHERE workspace_id=?2 AND role='owner' AND status='active')>1
    )`).bind(id, workspaceId),
    env.DB.prepare(`UPDATE conversations SET assigned_to='',updated_at=?3
      WHERE workspace_id=?1 AND lower(assigned_to)=lower(?2)
        AND NOT EXISTS (SELECT 1 FROM memberships WHERE membership_id=?4 AND workspace_id=?1)`)
      .bind(workspaceId, target.email, now, id),
    env.DB.prepare(`UPDATE sessions SET revoked_at=?3
      WHERE user_id=?1 AND workspace_id=?2 AND revoked_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM memberships WHERE membership_id=?4 AND workspace_id=?2)`)
      .bind(target.user_id, workspaceId, now, id),
    env.DB.prepare(`DELETE FROM users WHERE user_id=?1
      AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id=?1)
      AND NOT EXISTS (SELECT 1 FROM memberships WHERE membership_id=?2 AND workspace_id=?3)`)
      .bind(target.user_id, id, workspaceId)
  ]);
  if (!deleted[0]?.meta?.changes) throw httpError(409, 'The workspace must retain at least one active owner.');
  await audit(env, principal, 'delete', 'membership', id, {
    targetEmail: target.email,
    targetDisplayName: target.display_name,
    previousRole: target.role,
    previousStatus: target.status
  });
  return { ok: true, membershipId: id, userId: target.user_id, deleted: true };
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
    if (url.pathname === '/api/v1/whatsapp/templates' && request.method === 'GET') {
      requireApiScope(apiPrincipal, 'whatsapp:template:send');
      const response = await listExternalWhatsAppTemplates(env, url, apiPrincipal, requestId);
      response.headers.set('X-Request-Id', requestId);
      return response;
    }
    const templateMatch = url.pathname.match(/^\/api\/v1\/whatsapp\/templates\/([^/]+)$/);
    if (templateMatch && request.method === 'GET') {
      requireApiScope(apiPrincipal, 'whatsapp:template:send');
      const response = await fetchExternalWhatsAppTemplate(env, url, apiPrincipal, requestId,
        decodeURIComponent(templateMatch[1]));
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
  const workspaceId = String(request.headers.get('X-Workspace-Id') || '').trim();
  if (!workspaceId) {
    throw apiError(400, 'workspace_id_required', 'The X-Workspace-Id header is required.');
  }
  if (workspaceId !== String(row.workspace_id || '')) {
    throw apiError(403, 'workspace_mismatch', 'The workspace ID does not match this API key.');
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
  const messageId = crypto.randomUUID();
  const externalRequestId = crypto.randomUUID();
  const presentation = await externalTemplateInboxPresentation(env, channel, input.template, input.previewText);
  const sender = outboundSenderAttribution(principal);
  const senderName = sender.name;
  const preview = presentation.text;
  const storedPayload = { ...presentation.storedPayload, senderName };
  const encryptedPayload = await encryptOutboundPayload({ template: input.template }, env.CHANNEL_CREDENTIALS_KEY,
    principal.workspaceId, messageId);
  // Prepare everything that can fail without writing application state before
  // creating the recipient identity, binding, or conversation. In particular,
  // a missing/invalid encryption key must not leave an orphan route behind.
  const identity = await ensureWhatsAppConversation(env, principal.workspaceId, channel, input.to,
    input.contact?.displayName || '', now);
  const expiresAt = new Date(Date.now() + EXTERNAL_API_IDEMPOTENCY_DAYS * 86400000).toISOString();
  const firstRetryAt = new Date(Date.now() + 30000).toISOString();
  const contactUpdates = await externalContactUpdateStatements(env, principal.workspaceId, channel,
    identity, input.contact, now);
  const statements = [
    ...contactUpdates,
    env.DB.prepare(`INSERT INTO messages (message_id,conversation_id,contact_id,channel_id,identity_id,direction,message_type,text,
        status,timestamp,payload_json,workspace_id,sender_login,sender_name)
      VALUES (?1,?2,?3,?4,?5,'outbound','template',?6,'pending',?7,?8,?9,?10,?11)`)
      .bind(messageId, identity.conversationId, identity.contactId, channel.channelId, identity.identityId, preview, now,
        JSON.stringify(storedPayload), principal.workspaceId, sender.login, sender.name),
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
    await touchIdentityBinding(env, principal.workspaceId, identity.identityId, channel.channelId,
      'outbound', identity.conversationId, now);
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
  const realtimeAttachment = messageAttachmentView('template', storedPayload, messageId);
  const realtimeMessage = {
    messageId, conversationId: identity.conversationId, channelId: channel.channelId,
    direction: 'outbound', messageType: 'template', text: preview, status: 'pending', timestamp: now,
    channelMessageId: '', error: '', reply: null, senderName,
    template: templateMessageView(storedPayload),
    ...(realtimeAttachment ? { attachment: realtimeAttachment } : {})
  };
  const realtimeConversation = await getConversationItem(env, principal.workspaceId, identity.conversationId);
  await broadcast(env, principal.workspaceId, {
    type: 'message.created', conversationId: identity.conversationId, messageId, message: realtimeMessage,
    conversation: realtimeConversation
  });
  ctx.waitUntil(sendOrQueue(env, messageId));
  return externalMessageResponse({
    messageId, conversationId: identity.conversationId, contactId: identity.contactId,
    channelId: channel.channelId, messageStatus: 'pending', channelMessageId: '', error: '',
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
    channelMessageId: row.provider_message_id || '',
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
  let identity = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id
    FROM channel_identity_bindings b JOIN contact_identities ci ON ci.identity_id=b.identity_id
    WHERE b.workspace_id=?1 AND b.channel_id=?2 AND b.scoped_profile_id=?3 AND b.active=1 LIMIT 1`)
    .bind(workspaceId, channel.channelId, recipient).first();
  if (!identity) {
    const candidates = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id
      FROM contact_identities ci
      WHERE ci.workspace_id=?1 AND ci.platform='whatsapp' AND ci.profile_id=?2
      ORDER BY ci.created_at,ci.identity_id`).bind(workspaceId, recipient).all();
    if ((candidates.results || []).length === 1) {
      identity = candidates.results[0];
      try {
        await ensureIdentityBinding(env, workspaceId, identity.contact_id, identity.identity_id, {
          platform: 'whatsapp', profileId: recipient, phoneNumber: recipient,
          displayName: String(displayName || recipient).slice(0, 120), metadata: {},
          channelId: channel.channelId, scopedProfileId: recipient
        }, now);
      } catch (error) {
        const winner = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id
          FROM channel_identity_bindings b JOIN contact_identities ci ON ci.identity_id=b.identity_id
          WHERE b.workspace_id=?1 AND b.channel_id=?2 AND b.scoped_profile_id=?3 AND b.active=1 LIMIT 1`)
          .bind(workspaceId, channel.channelId, recipient).first();
        if (!winner) throw error;
        identity = winner;
      }
    }
  }
  if (!identity) {
    const contactId = crypto.randomUUID();
    const name = String(displayName || recipient).slice(0, 120);
    try {
      await env.DB.prepare(`INSERT INTO contacts (contact_id,display_name,created_at,updated_at,workspace_id)
        VALUES (?1,?2,?3,?3,?4)`).bind(contactId, name, now, workspaceId).run();
      const created = await ensureContactIdentity(env, workspaceId, contactId, {
        platform: 'whatsapp', profileId: recipient, phoneNumber: recipient, displayName: name,
        channelId: channel.channelId, scopedProfileId: recipient, isPrimary: true
      }, now);
      identity = { identity_id: created.identityId, contact_id: contactId };
    } catch (error) {
      await env.DB.prepare(`DELETE FROM contacts WHERE workspace_id=?1 AND contact_id=?2
        AND NOT EXISTS (SELECT 1 FROM conversations WHERE workspace_id=?1 AND contact_id=?2)`)
        .bind(workspaceId, contactId).run().catch(() => {});
      identity = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id
        FROM channel_identity_bindings b JOIN contact_identities ci ON ci.identity_id=b.identity_id
        WHERE b.workspace_id=?1 AND b.channel_id=?2 AND b.scoped_profile_id=?3 AND b.active=1 LIMIT 1`)
        .bind(workspaceId, channel.channelId, recipient).first();
      if (!identity) throw error;
    }
  }
  if (displayName) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE contacts SET display_name=?3,updated_at=?4 WHERE workspace_id=?1 AND contact_id=?2`)
        .bind(workspaceId, identity.contact_id, String(displayName).slice(0, 120), now),
      env.DB.prepare(`UPDATE contact_identities SET display_name=?3,updated_at=?4
        WHERE workspace_id=?1 AND identity_id=?2`).bind(workspaceId, identity.identity_id, String(displayName).slice(0, 120), now)
    ]);
  }
  const conversationId = await ensureIdentityConversation(env, workspaceId, identity.contact_id,
    identity.identity_id, channel.channelId, '');
  return { contactId: identity.contact_id, identityId: identity.identity_id, conversationId };
}

export function validateWhatsAppTemplateRequest(payload) {
  if (!isPlainObject(payload)) throw httpError(400, 'Request body must be a JSON object.');
  rejectUnknownKeys(payload, new Set(['channelId', 'to', 'contact', 'template', 'clientReference', 'previewText']), 'request');
  const channelId = cleanId(payload.channelId, 'Channel ID');
  const to = normalizeWhatsAppRecipient(payload.to);
  const contact = validateExternalTemplateContact(payload.contact);
  const clientReference = payload.clientReference === undefined ? '' : cleanOptionalText(payload.clientReference, 'Client reference', 200);
  const previewText = payload.previewText === undefined ? '' : cleanOptionalText(payload.previewText, 'Preview text', MAX_TEXT_LENGTH);
  const template = validateWhatsAppTemplate(payload.template);
  return { channelId, to, contact, template, clientReference, previewText };
}

export function validateExternalTemplateContact(value) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) throw httpError(400, 'Contact must be an object.');
  rejectUnknownKeys(value, new Set(['displayName', 'name', 'company', 'tags']), 'contact');
  if (!Object.keys(value).length) throw httpError(400, 'Provide at least one contact field.');
  if (value.displayName !== undefined && value.name !== undefined &&
      String(value.displayName).trim() !== String(value.name).trim()) {
    throw httpError(400, 'Display name and name must match when both are supplied.');
  }
  const contact = {};
  const suppliedName = value.displayName === undefined ? value.name : value.displayName;
  if (suppliedName !== undefined) {
    if (typeof suppliedName !== 'string') throw httpError(400, 'Contact name must be text.');
    contact.displayName = cleanRequired(suppliedName, 'Contact name', 120);
  }
  if (value.company !== undefined) {
    contact.company = cleanOptionalText(value.company, 'Company', 160);
  }
  if (value.tags !== undefined) {
    contact.tags = validateContactTags(value.tags);
  }
  return contact;
}

async function externalContactUpdateStatements(env, workspaceId, channel, identity, contact, now) {
  if (!contact) return [];
  const existing = await env.DB.prepare(`SELECT display_name,company,tags_json FROM contacts
    WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, identity.contactId).first();
  if (!existing) return [];
  const displayName = contact.displayName !== undefined ? contact.displayName : String(existing.display_name || '');
  const company = contact.company !== undefined ? contact.company : String(existing.company || '');
  const tags = contact.tags !== undefined ? contact.tags : storedContactTags(existing.tags_json);
  const statements = [
    env.DB.prepare(`UPDATE contacts SET display_name=?3,company=?4,tags_json=?5,updated_at=?6
      WHERE contact_id=?1 AND workspace_id=?2`)
      .bind(identity.contactId, workspaceId, displayName, company, JSON.stringify(tags), now)
  ];
  if (contact.displayName !== undefined) {
    statements.push(
      env.DB.prepare(`UPDATE channel_identities SET display_name=?4
        WHERE contact_id=?1 AND workspace_id=?2 AND channel_id=?3`)
        .bind(identity.contactId, workspaceId, channel.channelId, displayName),
      env.DB.prepare(`UPDATE contact_identities SET display_name=?4,updated_at=?5
        WHERE contact_id=?1 AND workspace_id=?2 AND identity_id=?3`)
        .bind(identity.contactId, workspaceId, identity.identityId, displayName, now)
    );
  }
  if (contact.displayName !== undefined || contact.tags !== undefined) {
    statements.push(
      env.DB.prepare(`UPDATE conversations SET
          subject=CASE WHEN ?4=1 THEN ?5 ELSE subject END,
          tags_json=CASE WHEN ?6=1 THEN ?7 ELSE tags_json END,
          updated_at=?8
        WHERE workspace_id=?1 AND contact_id=?2 AND channel_id=?3`)
        .bind(workspaceId, identity.contactId, channel.channelId,
          contact.displayName !== undefined ? 1 : 0, displayName,
          contact.tags !== undefined ? 1 : 0, JSON.stringify(tags), now)
    );
  }
  return statements;
}

async function resolveExternalWhatsAppChannel(env, principal, channelId) {
  const channel = await getChannel(env, channelId, 'whatsapp_cloud', principal.workspaceId);
  if (!channel) throw apiError(404, 'channel_not_found', 'WhatsApp channel not found.');
  if (!channel.config?.phoneNumberId) {
    throw apiError(409, 'channel_not_ready', 'The WhatsApp channel is missing its Phone Number ID.');
  }
  const accessToken = await env.DB.prepare(`SELECT 1 FROM channel_credentials
    WHERE workspace_id=?1 AND channel_id=?2 AND credential_key='accessToken'`)
    .bind(principal.workspaceId, channel.channelId).first();
  if (!accessToken) throw apiError(409, 'channel_not_ready', 'The WhatsApp channel is missing its access token.');
  if (!/^\d{5,40}$/.test(String(channel.config?.wabaId || '').trim())) {
    throw apiError(409, 'channel_not_ready', 'The WhatsApp channel is missing its WhatsApp Business Account ID.');
  }
  return channel;
}

function externalTemplateView(template) {
  return {
    templateId: template.templateId,
    name: template.name,
    language: template.language,
    status: template.status,
    category: template.category,
    components: template.components,
    variables: template.variables
  };
}

async function listExternalWhatsAppTemplates(env, url, principal, requestId) {
  const channelId = cleanId(url.searchParams.get('channelId'), 'Channel ID');
  const channel = await resolveExternalWhatsAppChannel(env, principal, channelId);
  let result;
  try {
    result = await listWhatsAppChannelTemplates(env, channel, {
      approvedOnly: false,
      includeMetadata: true,
      forceRefresh: url.searchParams.get('refresh') === '1'
    });
  } catch (error) {
    throw mapExternalTemplateLookupError(error);
  }
  await auditApiKey(env, principal, 'list_templates', 'channel', channel.channelId, {
    count: result.items.length, truncated: Boolean(result.truncated)
  });
  return json({
    status: true,
    channelId: channel.channelId,
    items: result.items.map(externalTemplateView),
    truncated: Boolean(result.truncated),
    requestId
  });
}

async function fetchExternalWhatsAppTemplate(env, url, principal, requestId, templateName) {
  const channelId = cleanId(url.searchParams.get('channelId'), 'Channel ID');
  const name = cleanRequired(templateName, 'Template name', 512);
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw apiError(400, 'invalid_template_name', 'Template name may contain only lowercase letters, numbers, and underscores.');
  }
  let language = '';
  if (url.searchParams.get('language') !== null) {
    language = cleanRequired(url.searchParams.get('language'), 'Template language code', 35);
    if (!/^[A-Za-z]{2,3}(?:_[A-Za-z0-9]{2,8})?$/.test(language)) {
      throw apiError(400, 'invalid_template_language', 'Template language code is invalid.');
    }
  }
  const channel = await resolveExternalWhatsAppChannel(env, principal, channelId);
  let items;
  try {
    items = await listWhatsAppTemplatesByName(env, channel, name);
  } catch (error) {
    throw mapExternalTemplateLookupError(error);
  }
  if (language) items = items.filter(item => item.language.code === language);
  if (!items.length) throw apiError(404, 'template_not_found', 'Template not found for this WhatsApp channel.');
  await auditApiKey(env, principal, 'fetch_template', 'channel', channel.channelId, {
    templateName: name, language, count: items.length
  });
  return json({
    status: true,
    channelId: channel.channelId,
    name,
    ...(language ? { language } : {}),
    items: items.map(externalTemplateView),
    requestId
  });
}

function mapExternalTemplateLookupError(error) {
  const status = Number(error?.status) || 500;
  if (status === 409) return apiError(409, 'channel_not_ready', cleanError(error));
  if (status === 422) return apiError(422, 'provider_rejected', cleanError(error));
  if (status === 502) return apiError(502, 'provider_unavailable', cleanError(error));
  if (status >= 400 && status < 500) return apiError(status, error?.code || 'invalid_request', cleanError(error));
  return error;
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

function outboundSenderAttribution(principal) {
  if (principal?.apiKeyId) return { login: 'API', name: 'API' };
  const email = String(principal?.user?.email || '').trim().slice(0, 254);
  const displayName = String(principal?.user?.displayName || '').trim().slice(0, 120);
  if (email && email !== 'emergency-recovery') {
    return { login: email, name: displayName || email.slice(0, 120) };
  }
  if (principal?.authType === 'recovery' || displayName === 'Emergency recovery') {
    return { login: 'emergency-recovery', name: displayName || 'Emergency recovery' };
  }
  if (principal?.user || principal?.authType) {
    return { login: email || 'agent', name: displayName || 'Agent' };
  }
  return { login: 'API', name: 'API' };
}

function outboundSenderLabel(principal) {
  return outboundSenderAttribution(principal).name;
}

/** Fixed attribution for history imports (Interakt now; Wati/AiSensy later). */
function importSourceSenderAttribution(source) {
  const normalized = String(source || '').trim().toLowerCase();
  if (normalized === INTERAKT_SOURCE) return { login: 'Interakt', name: 'Interakt' };
  return { login: '', name: '' };
}

function cleanPreviewText(value, maximum) {
  if (typeof value !== 'string') throw httpError(400, 'Preview text must be text.');
  const text = value.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').trim();
  if (text.length > maximum) throw httpError(400, 'Preview text is too long.');
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(text)) throw httpError(400, 'Preview text contains invalid characters.');
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
  let latestInbound = null;
  const statusChanges = [];
  for (const event of normalized.messages) {
    const stored = await storeInbound(env, channel, event, payload);
    if (stored) {
      received++;
      latestInbound = stored;
      await broadcastStoredInbound(env, channel, stored);
    }
  }
  for (const status of normalized.statuses) {
    statusChanges.push(...await applyProviderStatus(env, channel.workspaceId, channel.channelId, status, payload));
  }
  const receivedAt = new Date().toISOString();
  await updateChannelRuntimeConfig(env, channel, {
    lastWebhookAt: receivedAt,
    webhookVerifiedAt: channel.config?.webhookVerifiedAt || receivedAt
  });
  await broadcastMessageStatusChanges(env, channel.workspaceId, statusChanges);
  if (received || normalized.statuses.length) await broadcast(env, channel.workspaceId, {
    type: 'webhook.received', channelId, received, statuses: normalized.statuses.length, granular: true
  });
  if (latestInbound) scheduleInboundPush(ctx, env, channel, latestInbound);
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
  let latestInbound = null;
  for (const event of events) {
    const stored = await storeInbound(env, channel, event, payload);
    if (stored) {
      received++;
      latestInbound = stored;
      await broadcastStoredInbound(env, channel, stored);
    }
  }
  let updatedStatuses = 0;
  const statusChanges = [];
  for (const status of statuses) {
    const changes = await applyProviderStatus(env, channel.workspaceId, channel.channelId, status, payload);
    updatedStatuses += changes.length;
    statusChanges.push(...changes);
  }
  await broadcastMessageStatusChanges(env, channel.workspaceId, statusChanges);
  if (received || updatedStatuses) {
    await broadcast(env, channel.workspaceId, {
      type: 'webhook.received', channelId, received, statuses: updatedStatuses, granular: true
    });
  }
  if (latestInbound) scheduleInboundPush(ctx, env, channel, latestInbound);
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
  const storedInbound = event ? await storeInbound(env, channel, event, payload) : null;
  const received = storedInbound ? 1 : 0;
  await updateChannelRuntimeConfig(env, channel, { lastWebhookAt: new Date().toISOString() });
  if (storedInbound) await broadcastStoredInbound(env, channel, storedInbound);
  if (received) await broadcast(env, channel.workspaceId, {
    type: 'webhook.received', channelId, received, statuses: 0, granular: true
  });
  if (storedInbound) scheduleInboundPush(ctx, env, channel, storedInbound);
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
  let latestInbound = null;
  for (const event of normalized.messages) {
    const stored = await storeInbound(env, channel, event, payload);
    if (stored) {
      received++;
      latestInbound = stored;
      await broadcastStoredInbound(env, channel, stored);
    }
  }
  let updatedStatuses = 0;
  const statusChanges = [];
  for (const status of normalized.statuses) {
    const changes = await applyProviderStatus(env, channel.workspaceId, channel.channelId, status, payload);
    updatedStatuses += changes.length;
    statusChanges.push(...changes);
  }
  for (const status of normalized.watermarkStatuses) {
    const changes = await applyProviderWatermarkStatus(env, channel.workspaceId, channel.channelId, status, payload);
    updatedStatuses += changes.length;
    statusChanges.push(...changes);
  }
  await updateChannelRuntimeConfig(env, channel, { lastWebhookAt: new Date().toISOString() });
  await broadcastMessageStatusChanges(env, channel.workspaceId, statusChanges);
  if (received || updatedStatuses) {
    await broadcast(env, channel.workspaceId, {
      type: 'webhook.received', channelId, received, statuses: updatedStatuses, granular: true
    });
  }
  if (latestInbound) scheduleInboundPush(ctx, env, channel, latestInbound);
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
    let latestInbound = null;
    for (const event of normalized.messages) {
      const stored = await storeInbound(env, route.channel, event, route.payload);
      if (stored) {
        received++;
        channelReceived++;
        latestInbound = stored;
        await broadcastStoredInbound(env, route.channel, stored);
      }
    }
    let channelStatuses = 0;
    const statusChanges = [];
    for (const status of normalized.statuses) {
      const changes = await applyProviderStatus(env, route.channel.workspaceId, route.channel.channelId, status, route.payload);
      channelStatuses += changes.length;
      statusChanges.push(...changes);
    }
    for (const status of normalized.watermarkStatuses) {
      const changes = await applyProviderWatermarkStatus(env, route.channel.workspaceId, route.channel.channelId, status, route.payload);
      channelStatuses += changes.length;
      statusChanges.push(...changes);
    }
    await updateChannelRuntimeConfig(env, route.channel, { lastWebhookAt: now });
    await broadcastMessageStatusChanges(env, route.channel.workspaceId, statusChanges);
    if (channelReceived || channelStatuses) {
      await broadcast(env, route.channel.workspaceId, {
        type: 'webhook.received', channelId: route.channel.channelId, received: channelReceived,
        statuses: channelStatuses, granular: true
      });
    }
    if (latestInbound) scheduleInboundPush(ctx, env, route.channel, latestInbound);
  }
  return json({ ok: true, received, channels: routes.length });
}

function scheduleInboundPush(ctx, env, channel, inbound) {
  const delivery = (async () => {
    // Badge enrichment must never suppress the customer-message alert if the
    // aggregate query is temporarily unavailable.
    const unreadCount = await workspaceUnreadCount(env, channel.workspaceId).catch(() => 0);
    const notification = inboundPushNotification(channel, { ...inbound, unreadCount });
    return sendWorkspaceNotifications(env, channel.workspaceId, notification);
  })().catch(error => console.error('push_delivery_failed', {
    workspaceId: channel.workspaceId,
    channelId: channel.channelId,
    message: cleanError(error)
  }));
  if (typeof ctx?.waitUntil === 'function') ctx.waitUntil(delivery);
}

function scheduleConversationReadPush(ctx, env, workspaceId, conversation) {
  const delivery = (async () => {
    // Re-check after the PATCH response was assembled. A webhook can create a
    // newer unread between updateConversation() and this background task; in
    // that case no clear event may be sent for this conversation.
    const current = await env.DB.prepare(`SELECT unread_count,updated_at FROM conversations
      WHERE workspace_id=?1 AND conversation_id=?2 LIMIT 1`)
      .bind(workspaceId, conversation.conversationId).first();
    if (!current || Number(current.unread_count || 0) > 0) return { skipped: true };
    const unreadCount = await workspaceUnreadCount(env, workspaceId);
    return sendWorkspaceMobileConversationRead(env, workspaceId, {
      conversationId: conversation.conversationId,
      unreadCount,
      readAt: current.updated_at
    });
  })().catch(error => console.error('conversation_read_push_failed', {
    workspaceId,
    conversationId: conversation.conversationId,
    message: cleanError(error)
  }));
  if (typeof ctx?.waitUntil === 'function') ctx.waitUntil(delivery);
}

async function broadcastStoredInbound(env, channel, stored) {
  if (!stored?.message || !stored.conversationId || !stored.messageId) return;
  await broadcast(env, channel.workspaceId, {
    type: 'message.created',
    conversationId: stored.conversationId,
    messageId: stored.messageId,
    message: stored.message,
    conversation: stored.conversation || null,
    source: 'webhook'
  });
}

export function inboundPushNotification(channel, inbound = {}) {
  const title = compactNotificationText(inbound.senderName, 120) || 'Customer';
  const preview = compactNotificationText(inbound.preview, 240);
  const syntheticPreview = /^\[(?:WhatsApp|Instagram) .+ received\]$/i.test(preview);
  const body = preview && !syntheticPreview ? preview : inboundMessageTypeLabel(inbound.messageType);
  const rawConversationId = String(inbound.conversationId || '');
  const conversationId = /^[A-Za-z0-9_-]{1,100}$/.test(rawConversationId) ? rawConversationId : '';
  const unreadCount = boundedUnreadCount(inbound.unreadCount);
  const conversationUnreadCount = boundedUnreadCount(inbound.conversation?.unreadCount);
  return {
    title,
    body,
    tag: `helixcer-${conversationId || String(channel?.channelId || 'inbox').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 90)}`,
    url: conversationId ? `/#inbox/${conversationId}` : '/#inbox',
    ...(inbound.message?.timestamp ? { eventTimestamp: inbound.message.timestamp } : {}),
    ...(unreadCount ? { unreadCount } : {}),
    ...(conversationUnreadCount ? { conversationUnreadCount } : {})
  };
}

async function workspaceUnreadCount(env, workspaceId) {
  const row = await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN unread_count>0 THEN unread_count ELSE 0 END),0) AS unread_count
    FROM conversations WHERE workspace_id=?1`).bind(workspaceId).first();
  return boundedUnreadCount(row?.unread_count);
}

function boundedUnreadCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(9999, Math.floor(count));
}

function compactNotificationText(value, maximumLength) {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  return Array.from(compact).slice(0, maximumLength).join('');
}

function inboundMessageTypeLabel(value) {
  const type = String(value || 'message').toLowerCase();
  const labels = {
    image: 'Sent a photo', video: 'Sent a video', audio: 'Sent an audio message', voice: 'Sent a voice message',
    document: 'Sent a document', file: 'Sent a file', sticker: 'Sent a sticker', location: 'Shared a location',
    contact: 'Shared a contact', contacts: 'Shared a contact', reaction: 'Sent a reaction', interactive: 'Sent an interactive message'
  };
  return labels[type] || 'Sent a message';
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

async function getWorkspaceProfile(env, workspaceId) {
  const row = await env.DB.prepare(`SELECT workspace_id,name,registered_name,address_line1,address_line2,
      city,state,postal_code,country,gstin,tax_details
    FROM workspaces WHERE workspace_id=?1 LIMIT 1`).bind(workspaceId).first();
  if (!row) throw httpError(404, 'Workspace not found.');
  return workspaceProfileView(row);
}

function workspaceProfileView(row) {
  return {
    workspaceId: String(row.workspace_id || ''),
    displayName: String(row.name || ''),
    registeredName: String(row.registered_name || ''),
    addressLine1: String(row.address_line1 || ''),
    addressLine2: String(row.address_line2 || ''),
    city: String(row.city || ''),
    state: String(row.state || ''),
    postalCode: String(row.postal_code || ''),
    country: String(row.country || ''),
    gstin: String(row.gstin || ''),
    taxDetails: String(row.tax_details || '')
  };
}

async function updateWorkspaceProfile(env, workspaceId, payload, principal) {
  if (!isPlainObject(payload)) throw httpError(400, 'Workspace profile must be an object.');
  const fields = [
    ['displayName', 'Workspace display name', 120, false],
    ['registeredName', 'Registered company name', 200, true],
    ['addressLine1', 'Address line 1', 240, true],
    ['addressLine2', 'Address line 2', 240, true],
    ['city', 'City', 120, true],
    ['state', 'State or region', 120, true],
    ['postalCode', 'Postal code', 32, true],
    ['country', 'Country', 120, true],
    ['gstin', 'GSTIN', 15, true],
    ['taxDetails', 'Tax details', 2000, true]
  ];
  rejectUnknownKeys(payload, new Set(fields.map(([key]) => key)), 'workspace profile');
  if (!Object.keys(payload).length) throw httpError(400, 'At least one workspace field is required.');
  const values = {};
  for (const [key, label, maximum, optional] of fields) {
    if (payload[key] === undefined) continue;
    values[key] = optional
      ? (key === 'taxDetails' ? cleanWorkspaceMultiline(payload[key], label, maximum) : cleanOptionalText(payload[key], label, maximum))
      : cleanRequiredWorkspaceText(payload[key], label, maximum);
  }
  if (values.gstin) {
    values.gstin = values.gstin.toUpperCase();
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(values.gstin)) {
      throw httpError(400, 'GSTIN must be a valid 15-character Indian GST number.');
    }
  }
  const present = key => Object.prototype.hasOwnProperty.call(values, key);
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`UPDATE workspaces SET
      name=CASE WHEN ?2=1 THEN ?3 ELSE name END,
      registered_name=CASE WHEN ?4=1 THEN ?5 ELSE registered_name END,
      address_line1=CASE WHEN ?6=1 THEN ?7 ELSE address_line1 END,
      address_line2=CASE WHEN ?8=1 THEN ?9 ELSE address_line2 END,
      city=CASE WHEN ?10=1 THEN ?11 ELSE city END,
      state=CASE WHEN ?12=1 THEN ?13 ELSE state END,
      postal_code=CASE WHEN ?14=1 THEN ?15 ELSE postal_code END,
      country=CASE WHEN ?16=1 THEN ?17 ELSE country END,
      gstin=CASE WHEN ?18=1 THEN ?19 ELSE gstin END,
      tax_details=CASE WHEN ?20=1 THEN ?21 ELSE tax_details END,
      updated_at=?22
    WHERE workspace_id=?1`)
    .bind(workspaceId,
      present('displayName') ? 1 : 0, values.displayName || '',
      present('registeredName') ? 1 : 0, values.registeredName || '',
      present('addressLine1') ? 1 : 0, values.addressLine1 || '',
      present('addressLine2') ? 1 : 0, values.addressLine2 || '',
      present('city') ? 1 : 0, values.city || '',
      present('state') ? 1 : 0, values.state || '',
      present('postalCode') ? 1 : 0, values.postalCode || '',
      present('country') ? 1 : 0, values.country || '',
      present('gstin') ? 1 : 0, values.gstin || '',
      present('taxDetails') ? 1 : 0, values.taxDetails || '', now).run();
  if (!result.meta?.changes) throw httpError(404, 'Workspace not found.');
  await audit(env, principal, 'update', 'workspace', workspaceId, { fields: Object.keys(values) });
  return getWorkspaceProfile(env, workspaceId);
}

function cleanRequiredWorkspaceText(value, label, maximum) {
  if (typeof value !== 'string') throw httpError(400, `${label} must be text.`);
  const text = cleanRequired(value, label, maximum);
  if (/[\u0000-\u001f\u007f]/.test(text)) throw httpError(400, `${label} contains invalid characters.`);
  return text;
}

function cleanWorkspaceMultiline(value, label, maximum) {
  if (typeof value !== 'string') throw httpError(400, `${label} must be text.`);
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (text.length > maximum) throw httpError(400, `${label} is too long.`);
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(text)) throw httpError(400, `${label} contains invalid characters.`);
  return text;
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
  const changedConfigFields = editableConfigChanges(connectorType, previousConfig, config);
  await assertProviderIdentityConfigMutable(env, workspaceId, existing, connectorType, changedConfigFields);
  if (Object.keys(credentialUpdates).length) await importChannelCredentialKey(env.CHANNEL_CREDENTIALS_KEY);
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
  const channel = await env.DB.prepare(`SELECT name,connector_type,provider_type FROM channels
    WHERE channel_id=?1 AND workspace_id=?2`).bind(id, workspaceId).first();
  if (!channel) throw httpError(404, 'Channel not found.');
  const counts = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM channel_identity_bindings WHERE channel_id=?1 AND workspace_id=?2) AS identities,
      (SELECT COUNT(*) FROM conversations WHERE channel_id=?1 AND workspace_id=?2) AS conversations,
      (SELECT COUNT(*) FROM messages WHERE channel_id=?1 AND workspace_id=?2) AS messages`)
    .bind(id, workspaceId).first();
  if (Number(counts?.messages || 0) > 0 || Number(counts?.conversations || 0) > 0) {
    throw httpError(409, 'This channel has conversation history. Disable it instead so unified contact threads and message route history remain intact.');
  }
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM external_api_requests WHERE workspace_id=?2 AND message_id IN
      (SELECT message_id FROM messages WHERE channel_id=?1 AND workspace_id=?2)`).bind(id, workspaceId),
    env.DB.prepare(`DELETE FROM outbox WHERE workspace_id=?2 AND message_id IN
      (SELECT message_id FROM messages WHERE channel_id=?1 AND workspace_id=?2)`).bind(id, workspaceId),
    env.DB.prepare(`DELETE FROM outbound_payloads WHERE workspace_id=?2 AND message_id IN
      (SELECT message_id FROM messages WHERE channel_id=?1 AND workspace_id=?2)`).bind(id, workspaceId),
    env.DB.prepare(`DELETE FROM identity_migration_issues WHERE workspace_id=?2 AND conversation_id IN
      (SELECT conversation_id FROM conversations WHERE channel_id=?1 AND workspace_id=?2)`).bind(id, workspaceId),
    env.DB.prepare('DELETE FROM messages WHERE channel_id=?1 AND workspace_id=?2').bind(id, workspaceId),
    env.DB.prepare('DELETE FROM conversations WHERE channel_id=?1 AND workspace_id=?2').bind(id, workspaceId),
    env.DB.prepare('DELETE FROM channel_identities WHERE channel_id=?1 AND workspace_id=?2').bind(id, workspaceId),
    env.DB.prepare('DELETE FROM channel_identity_bindings WHERE channel_id=?1 AND workspace_id=?2').bind(id, workspaceId),
    env.DB.prepare('DELETE FROM channel_credentials WHERE channel_id=?1 AND workspace_id=?2').bind(id, workspaceId),
    env.DB.prepare('DELETE FROM webhook_events WHERE channel_id=?1 AND workspace_id=?2').bind(id, workspaceId),
    env.DB.prepare('DELETE FROM channels WHERE channel_id=?1 AND workspace_id=?2').bind(id, workspaceId)
  ]);
  await audit(env, principal, 'delete', 'channel', id, {
    name: channel.name,
    connectorType: logicalConnectorType(channel),
    localOnly: true,
    deletedIdentities: Number(counts?.identities || 0),
    deletedConversations: Number(counts?.conversations || 0),
    deletedMessages: Number(counts?.messages || 0)
  });
  return {
    ok: true, channelId: id, deleted: true, localOnly: true,
    deletedConversations: Number(counts?.conversations || 0),
    deletedMessages: Number(counts?.messages || 0)
  };
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

async function assertProviderIdentityConfigMutable(env, workspaceId, existing, connectorType, changedConfigFields = []) {
  if (!existing) return;
  const providerIdentityFields = connectorType === 'whatsapp_cloud'
    ? new Set(['wabaId', 'phoneNumberId'])
    : connectorType === 'instagram'
      ? new Set(['instagramAccountId', 'appId'])
      : new Set();
  if (!changedConfigFields.some(key => providerIdentityFields.has(key))) return;
  const usage = await env.DB.prepare(`SELECT
      EXISTS(SELECT 1 FROM channel_identity_bindings WHERE workspace_id=?1 AND channel_id=?2) AS has_bindings,
      EXISTS(SELECT 1 FROM channel_identities WHERE workspace_id=?1 AND channel_id=?2) AS has_legacy_identities,
      EXISTS(SELECT 1 FROM conversations WHERE workspace_id=?1 AND channel_id=?2) AS has_conversations,
      EXISTS(SELECT 1 FROM messages WHERE workspace_id=?1 AND channel_id=?2) AS has_messages`)
    .bind(workspaceId, existing.channel_id).first();
  if (Number(usage?.has_bindings || 0) || Number(usage?.has_legacy_identities || 0) ||
      Number(usage?.has_conversations || 0) || Number(usage?.has_messages || 0)) {
    throw httpError(409, 'This provider identity already has contact routes or message history. Add a new channel instead.');
  }
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

async function listConversations(env, workspaceId, url, options = {}) {
  const limit = clampInt(url.searchParams.get('limit'), 1, 100, 50);
  const status = url.searchParams.get('status') || '';
  const channelId = url.searchParams.get('channelId') || '';
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const cursor = url.searchParams.get('cursor') || '';
  const allowedChannelIds = Array.isArray(options.allowedChannelIds) ? options.allowedChannelIds : null;
  if (allowedChannelIds && channelId && !allowedChannelIds.includes(channelId)) {
    return { items: [], nextCursor: '' };
  }
  const result = await env.DB.prepare(`SELECT c.conversation_id,c.contact_id,c.channel_id,c.identity_id,c.status,c.assigned_to,
      c.subject,c.last_message_at,c.unread_count,c.tags_json,ch.name AS channel_name,ch.connector_type,ch.provider_type,
      COALESCE(b.scoped_profile_id,CASE WHEN c.identity_id='' THEN (SELECT legacy.channel_profile_id FROM channel_identities legacy
        WHERE legacy.workspace_id=c.workspace_id AND legacy.contact_id=c.contact_id AND legacy.channel_id=c.channel_id
        ORDER BY legacy.created_at LIMIT 1) ELSE '' END,'') AS channel_profile_id,
      (SELECT text FROM messages m WHERE m.workspace_id=c.workspace_id AND m.conversation_id=c.conversation_id
        ORDER BY timestamp DESC,message_id DESC LIMIT 1) AS last_message,
      (SELECT message_type FROM messages m WHERE m.workspace_id=c.workspace_id AND m.conversation_id=c.conversation_id
        ORDER BY timestamp DESC,message_id DESC LIMIT 1) AS last_message_type,
      (SELECT MAX(timestamp) FROM messages inbound WHERE inbound.workspace_id=c.workspace_id
        AND inbound.conversation_id=c.conversation_id AND inbound.direction='inbound') AS last_inbound_at
    FROM conversations c JOIN channels ch ON ch.channel_id=c.channel_id
    LEFT JOIN channel_identity_bindings b ON b.workspace_id=c.workspace_id AND b.identity_id=c.identity_id
      AND b.channel_id=c.channel_id AND b.active=1
    WHERE c.workspace_id=?1 AND ch.workspace_id=?1 AND (?2='' OR c.status=?2)
      AND (?3='' OR EXISTS (SELECT 1 FROM messages route_message
        WHERE route_message.workspace_id=c.workspace_id
          AND route_message.conversation_id=c.conversation_id
          AND route_message.channel_id=?3))
      AND (?4='' OR c.subject LIKE '%'||?4||'%' OR c.conversation_id LIKE '%'||?4||'%'
        OR EXISTS (SELECT 1 FROM contact_identities route_identity
          JOIN channel_identity_bindings route_binding
            ON route_binding.workspace_id=route_identity.workspace_id
           AND route_binding.identity_id=route_identity.identity_id
          WHERE route_identity.workspace_id=c.workspace_id
            AND route_identity.contact_id=c.contact_id
            AND (route_binding.scoped_profile_id LIKE '%'||?4||'%'
              OR route_identity.profile_id LIKE '%'||?4||'%')))
      AND (?5='' OR c.last_message_at<?5)
      AND (?7=0 OR c.channel_id IN (SELECT value FROM json_each(?8)))
    ORDER BY c.last_message_at DESC LIMIT ?6`)
    .bind(workspaceId, status, channelId, q, cursor, limit,
      allowedChannelIds ? 1 : 0, JSON.stringify(allowedChannelIds || [])).all();
  const items = result.results.map(conversationListItem);
  const contactIds = [...new Set(items.map(item => item.contactId).filter(Boolean))];
  const routes = await conversationRouteOptionsByContact(env, workspaceId, { contactIds });
  const mapped = items.map(item => {
    const next = withConversationRoutes(item, routes.get(item.contactId) || []);
    if (!allowedChannelIds) return next;
    return {
      ...next,
      routes: (Array.isArray(next.routes) ? next.routes : [])
        .filter(route => allowedChannelIds.includes(route.channelId))
    };
  });
  const lastRow = result.results[result.results.length - 1];
  return {
    items: mapped,
    nextCursor: mapped.length === limit ? String(lastRow?.last_message_at || '') : ''
  };
}

function assertPrincipalChannelAccess(principal, channelId) {
  const allowed = restrictedChannelIds(principal);
  if (allowed && !allowed.includes(channelId)) {
    throw httpError(403, 'You do not have access to this messaging channel.');
  }
}

async function assertConversationChannelAccess(env, workspaceId, conversationId, principal) {
  const allowed = restrictedChannelIds(principal);
  if (!allowed) return null;
  const row = await env.DB.prepare(`SELECT channel_id FROM conversations
    WHERE conversation_id=?1 AND workspace_id=?2`).bind(conversationId, workspaceId).first();
  if (!row) throw httpError(404, 'Conversation not found.');
  if (!allowed.includes(row.channel_id)) {
    throw httpError(403, 'You do not have access to this conversation.');
  }
  return row.channel_id;
}

/**
 * Search message history for the signed-in workspace. Bootstrap intentionally
 * contains only the latest message for each conversation, so clients use this
 * bounded endpoint when an operator enters an inbox search query.
 */
export async function searchMessages(env, workspaceId, url, options = {}) {
  const query = (url.searchParams.get('q') || '').trim().slice(0, 100);
  if (!query) return [];
  const limit = clampInt(url.searchParams.get('limit'), 1, 100, 50);
  const allowedChannelIds = Array.isArray(options.allowedChannelIds) ? options.allowedChannelIds : null;
  const result = await env.DB.prepare(`SELECT m.message_id,m.conversation_id,m.identity_id,m.text,m.message_type,m.direction,m.timestamp,
      c.contact_id,c.status AS conversation_status,c.assigned_to,c.unread_count,
      ct.display_name,ct.company,ch.channel_id,
      COALESCE(NULLIF(m.route_channel_name,''),ch.name) AS channel_name,
      COALESCE(NULLIF(m.route_connector_type,''),NULLIF(ch.provider_type,''),ch.connector_type) AS connector_type,
      '' AS provider_type,
      COALESCE(NULLIF(m.route_channel_profile_id,''),b.scoped_profile_id,ci.profile_id,'') AS channel_profile_id
    FROM messages m
    JOIN conversations c ON c.workspace_id=m.workspace_id AND c.conversation_id=m.conversation_id
    JOIN contacts ct ON ct.workspace_id=m.workspace_id AND ct.contact_id=c.contact_id
    JOIN channels ch ON ch.workspace_id=m.workspace_id AND ch.channel_id=m.channel_id
    LEFT JOIN contact_identities ci ON ci.workspace_id=m.workspace_id AND ci.identity_id=m.identity_id
    LEFT JOIN channel_identity_bindings b ON b.workspace_id=m.workspace_id AND b.identity_id=m.identity_id
      AND b.channel_id=m.channel_id AND b.active=1
    WHERE m.workspace_id=?1
      AND (instr(lower(COALESCE(m.text,'')),lower(?2))>0
        OR instr(lower(COALESCE(ct.display_name,'')),lower(?2))>0
        OR instr(lower(COALESCE(ct.company,'')),lower(?2))>0
        OR instr(lower(COALESCE(b.scoped_profile_id,ci.profile_id,'')),lower(?2))>0)
      AND (?4=0 OR m.channel_id IN (SELECT value FROM json_each(?5)))
    ORDER BY m.timestamp DESC,m.message_id DESC LIMIT ?3`)
    .bind(workspaceId, query, limit, allowedChannelIds ? 1 : 0, JSON.stringify(allowedChannelIds || [])).all();
  return (result.results || []).map(row => ({
    messageId: row.message_id,
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    contactIdentityId: row.identity_id || '',
    identityId: row.identity_id || '',
    contactName: String(row.display_name || '').slice(0, 120),
    company: String(row.company || '').slice(0, 160),
    channelId: row.channel_id,
    channelName: row.channel_name || '',
    connectorType: logicalConnectorType(row),
    channelProfileId: row.channel_profile_id || '',
    text: row.text || '',
    messageType: row.message_type || 'text',
    direction: row.direction || '',
    timestamp: row.timestamp || '',
    conversationStatus: row.conversation_status || '',
    assignedTo: row.assigned_to || '',
    unreadCount: Number(row.unread_count || 0)
  }));
}

function conversationListItem(row) {
  const connectorType = logicalConnectorType(row);
  return {
    conversationId: row.conversation_id, contactId: row.contact_id, channelId: row.channel_id,
    contactIdentityId: row.identity_id || '', identityId: row.identity_id || '',
    channelName: row.channel_name, connectorType, status: row.status, assignedTo: row.assigned_to,
    subject: row.subject, lastMessageAt: row.last_message_at, unreadCount: Number(row.unread_count || 0),
    tags: safeJsonParse(row.tags_json, []), lastMessage: row.last_message || '',
    lastMessageType: row.last_message_type || '',
    channelProfileId: row.channel_profile_id || '',
    ...whatsappReplyWindowState(connectorType, row.last_inbound_at)
  };
}

async function getConversationItem(env, workspaceId, conversationId) {
  const row = await env.DB.prepare(`SELECT c.conversation_id,c.contact_id,c.channel_id,c.identity_id,c.status,c.assigned_to,
      c.subject,c.last_message_at,c.unread_count,c.tags_json,ch.name AS channel_name,ch.connector_type,ch.provider_type,
      COALESCE(b.scoped_profile_id,CASE WHEN c.identity_id='' THEN (SELECT legacy.channel_profile_id FROM channel_identities legacy
        WHERE legacy.workspace_id=c.workspace_id AND legacy.contact_id=c.contact_id AND legacy.channel_id=c.channel_id
        ORDER BY legacy.created_at LIMIT 1) ELSE '' END,'') AS channel_profile_id,
      (SELECT text FROM messages m WHERE m.workspace_id=c.workspace_id AND m.conversation_id=c.conversation_id
        ORDER BY timestamp DESC,message_id DESC LIMIT 1) AS last_message,
      (SELECT message_type FROM messages m WHERE m.workspace_id=c.workspace_id AND m.conversation_id=c.conversation_id
        ORDER BY timestamp DESC,message_id DESC LIMIT 1) AS last_message_type,
      (SELECT MAX(timestamp) FROM messages inbound WHERE inbound.workspace_id=c.workspace_id
        AND inbound.conversation_id=c.conversation_id AND inbound.direction='inbound') AS last_inbound_at
    FROM conversations c JOIN channels ch ON ch.channel_id=c.channel_id AND ch.workspace_id=c.workspace_id
    LEFT JOIN channel_identity_bindings b ON b.workspace_id=c.workspace_id AND b.identity_id=c.identity_id
      AND b.channel_id=c.channel_id AND b.active=1
    WHERE c.workspace_id=?1 AND c.conversation_id=?2 LIMIT 1`).bind(workspaceId, conversationId).first();
  if (!row) return null;
  const item = conversationListItem(row);
  const routes = await listConversationRouteOptions(env, workspaceId, item.contactId);
  return withConversationRoutes(item, routes);
}

async function conversationRouteOptionsByContact(env, workspaceId, options = {}) {
  // Scope to contactIds when provided (inbox pages / single-contact lookups).
  // Unscoped full-workspace scans must not run correlated MAX(timestamp)
  // message subqueries — that path caused /api/bootstrap 500/504 storms.
  const contactIds = Array.isArray(options.contactIds)
    ? [...new Set(options.contactIds.map(id => String(id || '').trim()).filter(Boolean))]
    : null;
  if (contactIds && !contactIds.length) return new Map();
  const refreshFromMessages = Boolean(contactIds);
  const result = await env.DB.prepare(`SELECT ci.contact_id,b.identity_id,b.channel_id,
      b.scoped_profile_id,
      ${refreshFromMessages ? `COALESCE((SELECT MAX(inbound.timestamp) FROM messages inbound
        WHERE inbound.workspace_id=b.workspace_id AND inbound.contact_id=ci.contact_id
          AND inbound.channel_id=b.channel_id AND inbound.identity_id=b.identity_id
          AND inbound.direction='inbound'),b.last_inbound_at)` : 'b.last_inbound_at'} AS last_inbound_at,
      ${refreshFromMessages ? `COALESCE((SELECT MAX(outbound.timestamp) FROM messages outbound
        WHERE outbound.workspace_id=b.workspace_id AND outbound.contact_id=ci.contact_id
          AND outbound.channel_id=b.channel_id AND outbound.identity_id=b.identity_id
          AND outbound.direction='outbound'),b.last_outbound_at)` : 'b.last_outbound_at'} AS last_outbound_at,
      ch.name AS channel_name,ch.connector_type,ch.provider_type,ch.enabled
    FROM channel_identity_bindings b
    JOIN contact_identities ci ON ci.workspace_id=b.workspace_id AND ci.identity_id=b.identity_id
    JOIN channels ch ON ch.workspace_id=b.workspace_id AND ch.channel_id=b.channel_id
    WHERE b.workspace_id=?1 AND b.active=1
      AND (?2=0 OR ci.contact_id IN (SELECT value FROM json_each(?3)))
    ORDER BY ci.contact_id,
      CASE WHEN b.last_inbound_at='' THEN 1 ELSE 0 END,b.last_inbound_at DESC,
      b.last_seen_at DESC,ch.name COLLATE NOCASE,b.channel_id`)
    .bind(workspaceId, contactIds ? 1 : 0, JSON.stringify(contactIds || [])).all();
  const grouped = new Map();
  for (const row of result.results || []) {
    const connectorType = logicalConnectorType(row);
    const replyWindow = whatsappReplyWindowState(connectorType, row.last_inbound_at);
    const option = {
      channelId: row.channel_id,
      identityId: row.identity_id,
      contactIdentityId: row.identity_id,
      connectorType,
      channelName: row.channel_name || '',
      channelProfileId: row.scoped_profile_id || '',
      enabled: Boolean(row.enabled),
      lastInboundAt: row.last_inbound_at || '',
      lastOutboundAt: row.last_outbound_at || '',
      ...replyWindow
    };
    if (!grouped.has(row.contact_id)) grouped.set(row.contact_id, []);
    grouped.get(row.contact_id).push(option);
  }
  return grouped;
}

async function listConversationRouteOptions(env, workspaceId, contactId) {
  const grouped = await conversationRouteOptionsByContact(env, workspaceId, {
    contactIds: contactId ? [contactId] : []
  });
  return grouped.get(contactId) || [];
}

function withConversationRoutes(item, routeOptions) {
  const options = Array.isArray(routeOptions) ? routeOptions : [];
  const newestInboundRoute = routes => routes.reduce((newest, route) => {
    const timestamp = new Date(String(route.lastInboundAt || '')).valueOf();
    if (!Number.isFinite(timestamp)) return newest;
    if (!newest || timestamp > newest.timestamp) return { route, timestamp };
    return newest;
  }, null)?.route || null;
  const defaultRoute = newestInboundRoute(options.filter(route => route.enabled))
    || options.find(route => route.enabled && route.channelId === item.channelId && route.identityId === item.identityId)
    || options.find(route => route.enabled)
    || newestInboundRoute(options)
    || options.find(route => route.channelId === item.channelId && route.identityId === item.identityId)
    || options[0] || null;
  return {
    ...item,
    routeOptions: options,
    defaultChannelId: defaultRoute?.channelId || item.channelId || '',
    defaultIdentityId: defaultRoute?.identityId || item.identityId || '',
    defaultRoute: defaultRoute || null
  };
}

async function getConversationReplyWindow(env, workspaceId, conversationId) {
  const item = await getConversationItem(env, workspaceId, conversationId);
  if (!item) throw httpError(404, 'Conversation not found.');
  const route = item.defaultRoute;
  if (!route) {
    return { freeformAllowed: false, replyWindowExpiresAt: '', replyWindowReason: 'No active channel route is available.' };
  }
  return {
    freeformAllowed: Boolean(route.enabled) && Boolean(route.freeformAllowed),
    replyWindowExpiresAt: route.replyWindowExpiresAt || '',
    replyWindowReason: route.enabled ? (route.replyWindowReason || '') : 'The selected channel is disabled.'
  };
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
  const limit = clampInt(url.searchParams.get('contactLimit') || url.searchParams.get('limit'), 1, 200, 100);
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 100);
  const cursor = String(url.searchParams.get('cursor') || url.searchParams.get('contactCursor') || '').trim();
  const result = await env.DB.prepare(`SELECT c.contact_id,c.display_name,c.company,c.tags_json,c.attributes_json,c.updated_at,
      (SELECT MAX(last_message_at) FROM conversations cv
        WHERE cv.workspace_id=c.workspace_id AND cv.contact_id=c.contact_id) AS last_message_at
    FROM contacts c
    WHERE c.workspace_id=?1 AND (?2='' OR
      instr(lower(COALESCE(c.display_name,'')),lower(?2))>0 OR
      instr(lower(COALESCE(c.company,'')),lower(?2))>0 OR
      EXISTS (SELECT 1 FROM contact_platform_ids flat
        WHERE flat.workspace_id=c.workspace_id AND flat.contact_id=c.contact_id
          AND instr(lower(COALESCE(flat.profile_id,'')),lower(?2))>0) OR
      EXISTS (SELECT 1 FROM contact_identities legacy
        WHERE legacy.workspace_id=c.workspace_id AND legacy.contact_id=c.contact_id
          AND legacy.platform NOT IN ('whatsapp','telegram','instagram','facebook','email')
          AND instr(lower(COALESCE(legacy.profile_id,'')),lower(?2))>0))
      AND (?4='' OR COALESCE(
        (SELECT MAX(last_message_at) FROM conversations cv
          WHERE cv.workspace_id=c.workspace_id AND cv.contact_id=c.contact_id),
        c.updated_at) < ?4)
    ORDER BY COALESCE(last_message_at,c.updated_at) DESC LIMIT ?3`).bind(workspaceId, q, limit, cursor).all();
  const rows = result.results || [];
  const items = await hydrateContactViews(env, workspaceId, rows);
  const lastRow = rows[rows.length - 1];
  return {
    items,
    nextCursor: items.length === limit
      ? String(lastRow?.last_message_at || lastRow?.updated_at || '')
      : ''
  };
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function exportContactsCsv(env, workspaceId) {
  const result = await env.DB.prepare(`SELECT c.contact_id,c.display_name,c.company,c.tags_json,
      MAX(CASE WHEN flat.platform='whatsapp' THEN flat.profile_id ELSE '' END) AS whatsapp_id,
      MAX(CASE WHEN flat.platform='telegram' THEN flat.profile_id ELSE '' END) AS telegram_id,
      MAX(CASE WHEN flat.platform='instagram' THEN flat.profile_id ELSE '' END) AS instagram_id,
      MAX(CASE WHEN flat.platform='facebook' THEN flat.profile_id ELSE '' END) AS facebook_id,
      MAX(CASE WHEN flat.platform='email' THEN flat.profile_id ELSE '' END) AS email
    FROM contacts c
    LEFT JOIN contact_platform_ids flat
      ON flat.workspace_id=c.workspace_id AND flat.contact_id=c.contact_id
    WHERE c.workspace_id=?1
    GROUP BY c.workspace_id,c.contact_id,c.display_name,c.company,c.tags_json
    ORDER BY lower(c.display_name),c.contact_id`).bind(workspaceId).all();
  const headers = [
    'contact_id', 'display_name', 'company', 'tags',
    'whatsapp_id', 'telegram_id', 'instagram_id', 'facebook_id', 'email'
  ];
  const lines = [headers.join(',')];
  for (const row of result.results || []) {
    lines.push([
      row.contact_id,
      row.display_name,
      row.company,
      storedContactTags(row.tags_json).join(', '),
      row.whatsapp_id,
      row.telegram_id,
      row.instagram_id,
      row.facebook_id,
      row.email
    ].map(csvCell).join(','));
  }
  return new Response(`\uFEFF${lines.join('\r\n')}\r\n`, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="helixcer-contacts.csv"',
      'Cache-Control': 'no-store'
    }
  });
}

function canonicalIdentityPlatform(value) {
  const raw = String(value || '').trim().toLowerCase();
  const platform = raw === 'whatsapp_cloud' ? 'whatsapp' : raw;
  if (!/^[a-z][a-z0-9_-]{1,39}$/.test(platform)) throw httpError(400, 'Identity platform is invalid.');
  return platform;
}

function platformForChannel(channel) {
  return canonicalIdentityPlatform(channel?.connectorType || channel?.connector_type || channel?.provider_type || '');
}

function normalizeIdentityProfileValue(platform, value, label = 'Profile ID') {
  const profile = cleanRequired(value, label, 512);
  // Current WhatsApp Cloud routes are phone numbers, but the canonical model
  // also supports future username/opaque identifiers without forcing them
  // through phone normalization.
  if (platform === 'whatsapp' && /^\+?[\d\s().-]+$/.test(profile)) return normalizeWhatsAppRecipient(profile);
  return profile;
}

function validateContactPlatformIds(value, { requireOne = true } = {}) {
  if (!isPlainObject(value)) throw httpError(400, 'Platform IDs must be an object.');
  rejectUnknownKeys(value, CONTACT_ID_PLATFORM_SET, 'platform IDs');
  const result = Object.fromEntries(CONTACT_ID_PLATFORMS.map(platform => [platform, '']));
  for (const platform of CONTACT_ID_PLATFORMS) {
    const raw = value[platform];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    result[platform] = normalizeIdentityProfileValue(platform,
      cleanRequired(raw, `${platform} ID`, platform === 'email' ? 254 : 512), `${platform} ID`);
    if (platform === 'email') result[platform] = result[platform].toLowerCase();
  }
  if (requireOne && !CONTACT_ID_PLATFORMS.some(platform => result[platform])) {
    throw httpError(400, 'Provide at least one platform ID.');
  }
  return result;
}

function platformIdsFromIdentities(identities = []) {
  const result = Object.fromEntries(CONTACT_ID_PLATFORMS.map(platform => [platform, '']));
  for (const identity of identities) {
    const platform = String(identity?.platform || '').toLowerCase();
    if (CONTACT_ID_PLATFORM_SET.has(platform) && !result[platform]) {
      result[platform] = String(identity?.profileId || '');
    }
  }
  return result;
}

function validateContactIdentityInput(value, defaults = {}) {
  if (!isPlainObject(value)) throw httpError(400, 'Contact identity must be an object.');
  rejectUnknownKeys(value, new Set([
    'identityId', 'platform', 'connectorType', 'profileId', 'channelProfileId', 'scopedProfileId',
    'username', 'phoneNumber', 'email', 'displayName', 'metadata', 'isPrimary', 'channelId',
    'bindings', 'routes'
  ]), 'contact identity');
  const identityId = value.identityId === undefined ? '' : cleanId(value.identityId, 'Identity ID');
  const platformSource = value.platform ?? value.connectorType ?? defaults.platform;
  let platform = platformSource ? canonicalIdentityPlatform(platformSource) : '';
  const email = value.email === undefined ? '' : cleanOptionalText(value.email, 'Email', 254).toLowerCase();
  let rawProfileId = value.profileId ?? value.channelProfileId ?? (platform === 'email' ? email : '') ?? '';
  if (!platform && email) platform = 'email';
  if (!platform) throw httpError(400, 'Identity platform is required.');
  rawProfileId = cleanRequired(rawProfileId, 'Profile ID', 512);
  const profileId = normalizeIdentityProfileValue(platform, rawProfileId, 'Profile ID');
  const scopedRaw = value.scopedProfileId ?? value.channelProfileId ?? profileId;
  const scopedProfileId = normalizeIdentityProfileValue(platform, scopedRaw, 'Channel profile ID');
  const username = value.username === undefined ? '' : cleanOptionalText(value.username, 'Username', 200);
  const suppliedPhone = value.phoneNumber === undefined ? '' : cleanOptionalText(value.phoneNumber, 'Phone number', 80);
  const phoneNumber = suppliedPhone && /^\+?[\d\s().-]+$/.test(suppliedPhone)
    ? normalizeWhatsAppRecipient(suppliedPhone)
    : suppliedPhone;
  const displayName = value.displayName === undefined
    ? String(defaults.displayName || '').slice(0, 120)
    : cleanOptionalText(value.displayName, 'Identity display name', 120);
  if (value.metadata !== undefined && !isPlainObject(value.metadata)) {
    throw httpError(400, 'Identity metadata must be an object.');
  }
  const metadata = { ...(isPlainObject(value.metadata) ? value.metadata : {}) };
  if (value.isPrimary !== undefined) metadata.isPrimary = Boolean(value.isPrimary);
  const metadataJson = JSON.stringify(metadata);
  if (metadataJson.length > 10000) throw httpError(400, 'Identity metadata is too large.');
  const channelId = value.channelId === undefined || value.channelId === null || value.channelId === ''
    ? '' : cleanId(value.channelId, 'Channel ID');
  const routeSources = [];
  let routesProvided = false;
  for (const key of ['bindings', 'routes']) {
    if (value[key] === undefined) continue;
    routesProvided = true;
    if (!Array.isArray(value[key]) || value[key].length > 50) {
      throw httpError(400, 'Identity routes must be an array with no more than 50 items.');
    }
    routeSources.push(...value[key]);
  }
  if (channelId) routeSources.push({ channelId, scopedProfileId });
  const routes = [];
  const seenRoutes = new Set();
  const seenRouteChannels = new Set();
  for (const route of routeSources) {
    if (!isPlainObject(route)) throw httpError(400, 'Each identity route must be an object.');
    rejectUnknownKeys(route, new Set(['bindingId', 'channelId', 'scopedProfileId', 'channelProfileId', 'metadata', 'active']), 'identity route');
    if (route.active === false) continue;
    const routeChannelId = cleanId(route.channelId, 'Route channel ID');
    const scopedRawValue = route.scopedProfileId ?? route.channelProfileId ?? profileId;
    const routeProfileId = normalizeIdentityProfileValue(platform, scopedRawValue, 'Route profile ID');
    const key = `${routeChannelId}\n${routeProfileId}`;
    if (seenRoutes.has(key)) continue;
    if (seenRouteChannels.has(routeChannelId)) {
      throw httpError(400, 'An identity can have only one active route per channel.');
    }
    seenRoutes.add(key);
    seenRouteChannels.add(routeChannelId);
    if (route.metadata !== undefined && !isPlainObject(route.metadata)) {
      throw httpError(400, 'Route metadata must be an object.');
    }
    routes.push({ channelId: routeChannelId, scopedProfileId: routeProfileId,
      metadata: isPlainObject(route.metadata) ? route.metadata : {} });
  }
  return { identityId, platform, profileId, scopedProfileId, username, phoneNumber, displayName, metadata,
    channelId, routes, routesProvided };
}

async function prevalidateIdentityRoutes(env, workspaceId, identityId, normalized) {
  for (const route of normalized.routes) {
    const routeOwner = await env.DB.prepare(`SELECT b.identity_id
      FROM channel_identity_bindings b
      WHERE b.workspace_id=?1 AND b.channel_id=?2 AND b.scoped_profile_id=?3 AND b.active=1 LIMIT 1`)
      .bind(workspaceId, route.channelId, route.scopedProfileId).first();
    if (routeOwner && routeOwner.identity_id !== identityId) {
      throw httpError(409, 'This channel profile is already assigned to another contact identity.');
    }
    // An unchanged persisted route can be retained while its channel is
    // disabled. Only creating/replacing a route requires an enabled channel.
    if (!routeOwner) {
      const channel = await getChannel(env, route.channelId, '', workspaceId);
      if (!channel) throw httpError(400, 'Unknown or disabled channel.');
      if (platformForChannel(channel) !== normalized.platform) {
        throw httpError(400, 'The selected channel does not match the identity platform.');
      }
    }
    await assertIdentityRouteProfileChangeAllowed(env, workspaceId, identityId,
      route.channelId, route.scopedProfileId);
  }
}

async function assertIdentityRouteProfileChangeAllowed(env, workspaceId, identityId, channelId, scopedProfileId) {
  const previous = await env.DB.prepare(`SELECT scoped_profile_id
    FROM channel_identity_bindings
    WHERE workspace_id=?1 AND identity_id=?2 AND channel_id=?3
    ORDER BY active DESC,updated_at DESC,created_at DESC LIMIT 1`)
    .bind(workspaceId, identityId, channelId).first();
  if (!previous || previous.scoped_profile_id === scopedProfileId) return;
  if (await identityChannelHasHistory(env, workspaceId, identityId, channelId)) {
    throw httpError(409,
      'This channel route has conversation history. Its Channel Profile ID cannot be changed; add another identity instead.');
  }
}

async function identityChannelHasHistory(env, workspaceId, identityId, channelId) {
  const history = await env.DB.prepare(`SELECT
      EXISTS(SELECT 1 FROM conversations
        WHERE workspace_id=?1 AND channel_id=?3 AND (
          identity_id=?2 OR (identity_id='' AND contact_id=(SELECT contact_id FROM contact_identities
            WHERE workspace_id=?1 AND identity_id=?2 LIMIT 1))) LIMIT 1) AS has_conversation,
      EXISTS(SELECT 1 FROM messages
        WHERE workspace_id=?1 AND channel_id=?3 AND (
          identity_id=?2 OR (identity_id='' AND contact_id=(SELECT contact_id FROM contact_identities
            WHERE workspace_id=?1 AND identity_id=?2 LIMIT 1))) LIMIT 1) AS has_message,
      EXISTS(SELECT 1 FROM channel_identity_bindings
        WHERE workspace_id=?1 AND identity_id=?2 AND channel_id=?3
          AND last_conversation_id<>'') AS has_bound_conversation`)
    .bind(workspaceId, identityId, channelId).first();
  return Boolean(Number(history?.has_conversation || 0) || Number(history?.has_message || 0) ||
    Number(history?.has_bound_conversation || 0));
}

async function prevalidateIdentityRouteRemovals(env, workspaceId, identityId, normalized) {
  if (!normalized.routesProvided) return [];
  const selected = new Set(normalized.routes.map(route => `${route.channelId}\n${route.scopedProfileId}`));
  const active = await env.DB.prepare(`SELECT binding_id,channel_id,scoped_profile_id
    FROM channel_identity_bindings WHERE workspace_id=?1 AND identity_id=?2 AND active=1`)
    .bind(workspaceId, identityId).all();
  const remove = (active.results || []).filter(route => !selected.has(`${route.channel_id}\n${route.scoped_profile_id}`));
  for (const route of remove) {
    if (await identityChannelHasHistory(env, workspaceId, identityId, route.channel_id)) {
      throw httpError(409,
        'This channel route has conversation history and cannot be removed. Delete its conversations first.');
    }
  }
  return remove;
}

async function prevalidateContactIdentityBatch(env, workspaceId, contactId, values, displayName) {
  if (!Array.isArray(values) || values.length > 50) {
    throw httpError(400, 'Identities must be an array with no more than 50 items.');
  }
  const existingResult = await env.DB.prepare(`SELECT * FROM contact_identities
    WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, contactId).all();
  const existingRows = existingResult.results || [];
  const existingById = new Map(existingRows.map(row => [String(row.identity_id), row]));
  const existingByCanonical = new Map(existingRows.map(row => [`${row.platform}\n${row.profile_id}`, row]));
  const seenTargets = new Set();
  const seenCanonical = new Map();
  const seenRoutes = new Map();
  const seenFlatPlatforms = new Set();
  let primaryCount = 0;

  for (const value of values) {
    if (!isPlainObject(value)) throw httpError(400, 'Each contact identity must be an object.');
    const suppliedIdentityId = value.identityId === undefined || value.identityId === null || value.identityId === ''
      ? '' : cleanId(value.identityId, 'Identity ID');
    let existing = suppliedIdentityId ? existingById.get(suppliedIdentityId) : null;
    if (suppliedIdentityId && !existing) throw httpError(404, 'Contact identity not found.');
    const platformSource = value.platform ?? value.connectorType ?? existing?.platform;
    const profileSource = value.profileId ?? value.channelProfileId ?? existing?.profile_id;
    const preliminary = validateContactIdentityInput({
      ...value,
      ...(suppliedIdentityId ? { identityId: suppliedIdentityId } : {}),
      platform: platformSource,
      profileId: profileSource,
      username: value.username ?? existing?.username ?? '',
      phoneNumber: value.phoneNumber ?? existing?.phone_number ?? '',
      displayName: value.displayName ?? existing?.display_name ?? displayName,
      metadata: value.metadata ?? safeJsonParse(existing?.metadata_json, {})
    }, { displayName });
    const canonicalKey = `${preliminary.platform}\n${preliminary.profileId}`;
    if (CONTACT_ID_PLATFORM_SET.has(preliminary.platform)) {
      if (seenFlatPlatforms.has(preliminary.platform)) {
        throw httpError(409, `A contact can have only one ${preliminary.platform} ID.`);
      }
      seenFlatPlatforms.add(preliminary.platform);
    }
    if (!existing) existing = existingByCanonical.get(canonicalKey) || null;
    const targetKey = existing?.identity_id || suppliedIdentityId || `new:${canonicalKey}`;
    if (seenTargets.has(targetKey)) throw httpError(400, 'The same contact identity was supplied more than once.');
    seenTargets.add(targetKey);
    if (existing && (preliminary.platform !== existing.platform || preliminary.profileId !== existing.profile_id)) {
      throw httpError(400, 'Identity platform and profile ID cannot be changed. Add another identity instead.');
    }
    const canonicalOwner = seenCanonical.get(canonicalKey);
    if (canonicalOwner && canonicalOwner !== targetKey) {
      throw httpError(409, 'The same platform identity was supplied more than once.');
    }
    seenCanonical.set(canonicalKey, targetKey);
    if (preliminary.metadata.isPrimary) primaryCount += 1;
    const validationIdentityId = existing?.identity_id || suppliedIdentityId || crypto.randomUUID();
    await prevalidateIdentityRoutes(env, workspaceId, validationIdentityId, preliminary);
    if (existing) await prevalidateIdentityRouteRemovals(env, workspaceId, existing.identity_id, preliminary);
    for (const route of preliminary.routes) {
      const routeKey = `${route.channelId}\n${route.scopedProfileId}`;
      const routeOwner = seenRoutes.get(routeKey);
      if (routeOwner && routeOwner !== targetKey) {
        throw httpError(409, 'The same channel profile route was supplied for more than one identity.');
      }
      seenRoutes.set(routeKey, targetKey);
    }
  }
  if (primaryCount > 1) throw httpError(400, 'Only one contact identity can be primary.');
}

async function contactIdentityRows(env, workspaceId, contactIds = []) {
  if (!contactIds.length) return [];
  // D1 allows at most 100 bound variables. Contact list pages and bootstrap can
  // hydrate hundreds of contacts, so pass ids through a single json_each(?) param
  // instead of one placeholder per contact.
  const ids = [...new Set(contactIds.map(id => String(id || '').trim()).filter(Boolean))]
    .slice(0, 2000);
  if (!ids.length) return [];
  const result = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id,ci.platform,ci.profile_id,ci.username,
      ci.phone_number,ci.display_name,ci.metadata_json,ci.created_at,ci.updated_at,
      b.binding_id,b.channel_id,b.scoped_profile_id,b.metadata_json AS binding_metadata_json,
      b.first_seen_at,b.last_seen_at,b.last_inbound_at,b.last_outbound_at,b.last_conversation_id,
      ch.name AS channel_name,ch.connector_type,ch.provider_type,ch.enabled,
      cv.conversation_id,cv.status AS conversation_status,cv.last_message_at
    FROM contact_identities ci
    LEFT JOIN contact_platform_ids flat
      ON flat.workspace_id=ci.workspace_id AND flat.contact_id=ci.contact_id
      AND flat.platform=ci.platform AND flat.identity_id=ci.identity_id
    LEFT JOIN channel_identity_bindings b
      ON b.workspace_id=ci.workspace_id AND b.identity_id=ci.identity_id AND b.active=1
    LEFT JOIN channels ch ON ch.workspace_id=ci.workspace_id AND ch.channel_id=b.channel_id
    LEFT JOIN conversations cv ON cv.workspace_id=ci.workspace_id AND cv.identity_id=ci.identity_id
      AND cv.channel_id=b.channel_id
    WHERE ci.workspace_id=?1 AND ci.contact_id IN (SELECT value FROM json_each(?2))
      AND (ci.platform NOT IN ('whatsapp','telegram','instagram','facebook','email')
        OR flat.identity_id IS NOT NULL)
    ORDER BY ci.created_at,ci.identity_id,b.last_seen_at DESC,b.created_at DESC`)
    .bind(workspaceId, JSON.stringify(ids)).all();
  return result.results || [];
}

async function hydrateContactViews(env, workspaceId, rows) {
  if (!rows.length) return [];
  const identityRows = await contactIdentityRows(env, workspaceId, rows.map(row => row.contact_id));
  const byContact = new Map();
  for (const row of identityRows) {
    if (!byContact.has(row.contact_id)) byContact.set(row.contact_id, new Map());
    const identities = byContact.get(row.contact_id);
    let identity = identities.get(row.identity_id);
    if (!identity) {
      const metadata = safeJsonParse(row.metadata_json, {});
      identity = {
        identityId: row.identity_id,
        platform: row.platform || '',
        profileId: row.profile_id || '',
        username: row.username || '',
        phoneNumber: row.phone_number || '',
        email: row.platform === 'email' ? row.profile_id || '' : '',
        displayName: row.display_name || '',
        metadata: isPlainObject(metadata) ? metadata : {},
        isPrimary: Boolean(metadata?.isPrimary),
        createdAt: row.created_at || '',
        updatedAt: row.updated_at || '',
        bindings: [], routes: []
      };
      identities.set(row.identity_id, identity);
    }
    if (row.binding_id) {
      identity.bindings.push({
        bindingId: row.binding_id,
        channelId: row.channel_id || '',
        channelName: row.channel_name || '',
        connectorType: logicalConnectorType(row),
        channelProfileId: row.scoped_profile_id || row.profile_id || '',
        scopedProfileId: row.scoped_profile_id || '',
        channelEnabled: Boolean(row.enabled),
        conversationId: row.conversation_id || '',
        conversationStatus: row.conversation_status || '',
        lastMessageAt: row.last_message_at || '',
        firstSeenAt: row.first_seen_at || '',
        lastSeenAt: row.last_seen_at || '',
        lastInboundAt: row.last_inbound_at || '',
        lastOutboundAt: row.last_outbound_at || '',
        lastConversationId: row.last_conversation_id || row.conversation_id || '',
        metadata: safeJsonParse(row.binding_metadata_json, {})
      });
    }
  }
  return rows.map(row => {
    const identities = [...(byContact.get(row.contact_id)?.values() || [])];
    if (identities.length && !identities.some(identity => identity.isPrimary)) identities[0].isPrimary = true;
    for (const identity of identities) {
      identity.bindings.sort((a, b) => String(b.lastMessageAt || b.lastSeenAt).localeCompare(String(a.lastMessageAt || a.lastSeenAt)));
      const binding = identity.bindings[0] || {};
      Object.assign(identity, {
        channelId: binding.channelId || '',
        channelName: binding.channelName || '',
        connectorType: binding.connectorType || '',
        channelProfileId: binding.channelProfileId || identity.profileId,
        channelEnabled: Boolean(binding.channelEnabled),
        conversationId: binding.conversationId || '',
        conversationStatus: binding.conversationStatus || '',
        lastMessageAt: binding.lastMessageAt || ''
      });
      identity.routes = identity.bindings;
    }
    identities.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) ||
      String(b.lastMessageAt || b.updatedAt).localeCompare(String(a.lastMessageAt || a.updatedAt)));
    return contactView(row, identities);
  });
}

async function listWorkspaceTags(env, workspaceId) {
  const result = await env.DB.prepare(`SELECT MIN(trim(CAST(tag.value AS TEXT))) AS tag
    FROM contacts c
    JOIN json_each(CASE
      WHEN json_valid(c.tags_json) THEN CASE
        WHEN json_type(c.tags_json)='array' THEN c.tags_json
        ELSE '[]'
      END
      ELSE '[]'
    END) tag
    WHERE c.workspace_id=?1 AND tag.type='text'
      AND length(trim(CAST(tag.value AS TEXT))) BETWEEN 1 AND 40
    GROUP BY lower(trim(CAST(tag.value AS TEXT)))
    ORDER BY lower(tag),tag
    LIMIT 200`).bind(workspaceId).all();
  return (result.results || []).map(row => String(row.tag || '').trim()).filter(Boolean);
}

async function loadContactRow(env, workspaceId, contactId) {
  return env.DB.prepare(`SELECT c.contact_id,c.display_name,c.company,c.tags_json,c.attributes_json,c.updated_at,
      i.identity_id,i.channel_id,i.channel_profile_id,ch.name AS channel_name,ch.connector_type,ch.provider_type,
      cv.status AS conversation_status,cv.last_message_at,
      (SELECT COUNT(*) FROM contact_identities identities
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
  const items = await hydrateContactViews(env, workspaceId, [row]);
  return items[0];
}

function contactView(row, identities = []) {
  const attributes = safeJsonParse(row.attributes_json, {});
  const displayName = String(row.display_name || '').slice(0, 120);
  const tags = storedContactTags(row.tags_json);
  const preferred = identities.find(identity => identity.isPrimary) || identities[0] || null;
  const preferredBinding = preferred?.bindings?.[0] || null;
  const conversationStatus = preferredBinding?.conversationStatus || row.conversation_status || '';
  return {
    contactId: row.contact_id,
    displayName,
    name: displayName,
    company: String(row.company || '').slice(0, 160),
    tags,
    platformIds: platformIdsFromIdentities(identities),
    identities,
    identityId: preferred?.identityId || row.identity_id || '',
    channelId: preferredBinding?.channelId || row.channel_id || '',
    channelName: preferredBinding?.channelName || row.channel_name || '',
    connectorType: preferredBinding?.connectorType || logicalConnectorType(row),
    channelProfileId: preferredBinding?.channelProfileId || preferred?.profileId || row.channel_profile_id || '',
    email: typeof attributes.email === 'string' ? attributes.email.slice(0, 254) : '',
    phone: typeof attributes.phone === 'string' ? attributes.phone.slice(0, 80) : '',
    status: conversationStatus === 'closed' ? 'inactive' : 'active',
    conversationStatus,
    channelEditable: false,
    lastMessageAt: preferredBinding?.lastMessageAt || row.last_message_at || row.updated_at
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

async function ensureContactIdentity(env, workspaceId, contactId, input, now = new Date().toISOString()) {
  const contact = await env.DB.prepare(`SELECT contact_id,display_name FROM contacts
    WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, contactId).first();
  if (!contact) throw httpError(404, 'Contact not found.');
  const normalized = validateContactIdentityInput(input, { displayName: contact.display_name });
  let existing = normalized.identityId
    ? await env.DB.prepare(`SELECT * FROM contact_identities
        WHERE workspace_id=?1 AND contact_id=?2 AND identity_id=?3`)
      .bind(workspaceId, contactId, normalized.identityId).first()
    : await env.DB.prepare(`SELECT * FROM contact_identities
        WHERE workspace_id=?1 AND contact_id=?2 AND platform=?3 AND profile_id=?4 LIMIT 1`)
      .bind(workspaceId, contactId, normalized.platform, normalized.profileId).first();
  if (normalized.identityId && !existing) throw httpError(404, 'Contact identity not found.');
  if (normalized.identityId && existing
      && (normalized.platform !== existing.platform || normalized.profileId !== existing.profile_id)) {
    throw httpError(400, 'Identity platform and profile ID cannot be changed. Add another identity instead.');
  }
  const identityId = existing?.identity_id || normalized.identityId || crypto.randomUUID();
  if (CONTACT_ID_PLATFORM_SET.has(normalized.platform)) {
    const flatOwner = await env.DB.prepare(`SELECT identity_id FROM contact_platform_ids
      WHERE workspace_id=?1 AND contact_id=?2 AND platform=?3`)
      .bind(workspaceId, contactId, normalized.platform).first();
    if (flatOwner && flatOwner.identity_id !== identityId) {
      throw httpError(409, `This contact already has a ${normalized.platform} ID.`);
    }
  }
  // Validate every requested route before changing primary flags or inserting
  // anything.  A bad/conflicting later route must not leave a ghost identity
  // or an earlier partial binding behind.
  await prevalidateIdentityRoutes(env, workspaceId, identityId, normalized);
  const statements = [];
  if (!existing) {
    const count = await env.DB.prepare(`SELECT COUNT(*) AS count FROM contact_identities
      WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, contactId).first();
    if (normalized.metadata.isPrimary === undefined && Number(count?.count || 0) === 0) {
      normalized.metadata.isPrimary = true;
    }
    if (normalized.metadata.isPrimary) {
      const others = await env.DB.prepare(`SELECT identity_id,metadata_json FROM contact_identities
        WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, contactId).all();
      for (const other of others.results || []) {
        const metadata = safeJsonParse(other.metadata_json, {});
        if (isPlainObject(metadata) && metadata.isPrimary) {
          delete metadata.isPrimary;
          statements.push(env.DB.prepare(`UPDATE contact_identities SET metadata_json=?4,updated_at=?5
            WHERE workspace_id=?1 AND contact_id=?2 AND identity_id=?3`)
            .bind(workspaceId, contactId, other.identity_id, JSON.stringify(metadata), now));
        }
      }
    }
    statements.push(env.DB.prepare(`INSERT INTO contact_identities
        (identity_id,workspace_id,contact_id,platform,profile_id,username,phone_number,display_name,
         metadata_json,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)`)
      .bind(identityId, workspaceId, contactId, normalized.platform, normalized.profileId,
        normalized.username, normalized.phoneNumber, normalized.displayName || contact.display_name,
        JSON.stringify(normalized.metadata), now));
    existing = { identity_id: identityId };
  }
  if (CONTACT_ID_PLATFORM_SET.has(normalized.platform)) {
    statements.push(env.DB.prepare(`INSERT OR IGNORE INTO contact_platform_ids
        (workspace_id,contact_id,platform,profile_id,identity_id,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?6)`)
      .bind(workspaceId, contactId, normalized.platform, normalized.profileId, existing.identity_id, now));
  }
  const bindings = [];
  for (const route of normalized.routes) {
    const mutation = await prepareIdentityBindingMutation(env, workspaceId, contactId, existing.identity_id,
      { ...normalized, ...route, channelId: route.channelId, scopedProfileId: route.scopedProfileId }, now);
    statements.push(...mutation.statements);
    bindings.push(mutation.binding);
  }
  if (statements.length) await env.DB.batch(statements);
  return { identityId: existing.identity_id, binding: bindings[0] || null, bindings, normalized };
}

async function ensureIdentityBinding(env, workspaceId, contactId, identityId, identity, now = new Date().toISOString()) {
  const mutation = await prepareIdentityBindingMutation(env, workspaceId, contactId, identityId, identity, now);
  if (mutation.statements.length) await env.DB.batch(mutation.statements);
  return mutation.binding;
}

async function prepareIdentityBindingMutation(env, workspaceId, contactId, identityId, identity,
  now = new Date().toISOString()) {
  const routeOwner = await env.DB.prepare(`SELECT b.binding_id,b.identity_id,ci.contact_id
    FROM channel_identity_bindings b JOIN contact_identities ci ON ci.identity_id=b.identity_id
    WHERE b.workspace_id=?1 AND b.channel_id=?2 AND b.scoped_profile_id=?3 AND b.active=1 LIMIT 1`)
    .bind(workspaceId, identity.channelId, identity.scopedProfileId).first();
  if (routeOwner && routeOwner.identity_id !== identityId) {
    throw httpError(409, 'This channel profile is already assigned to another contact identity.');
  }
  if (routeOwner) {
    return {
      binding: { bindingId: routeOwner.binding_id, channelId: identity.channelId,
        channelProfileId: identity.scopedProfileId },
      statements: [env.DB.prepare(`UPDATE channel_identity_bindings SET metadata_json=?4,last_seen_at=?5,updated_at=?5
        WHERE workspace_id=?1 AND binding_id=?2 AND identity_id=?3`)
        .bind(workspaceId, routeOwner.binding_id, identityId, JSON.stringify(identity.metadata || {}), now)]
    };
  }
  const channel = await getChannel(env, identity.channelId, '', workspaceId);
  if (!channel) throw httpError(400, 'Unknown or disabled channel.');
  if (platformForChannel(channel) !== identity.platform) {
    throw httpError(400, 'The selected channel does not match the identity platform.');
  }
  await assertIdentityRouteProfileChangeAllowed(env, workspaceId, identityId,
    identity.channelId, identity.scopedProfileId);
  let binding = await env.DB.prepare(`SELECT binding_id FROM channel_identity_bindings
    WHERE workspace_id=?1 AND identity_id=?2 AND channel_id=?3 AND scoped_profile_id=?4
    ORDER BY created_at DESC LIMIT 1`).bind(workspaceId, identityId, identity.channelId, identity.scopedProfileId).first();
  const bindingId = binding?.binding_id || crypto.randomUUID();
  const statements = [
    env.DB.prepare(`UPDATE channel_identity_bindings SET active=0,updated_at=?4
      WHERE workspace_id=?1 AND identity_id=?2 AND channel_id=?3 AND active=1`)
      .bind(workspaceId, identityId, identity.channelId, now)
  ];
  if (binding) {
    statements.push(env.DB.prepare(`UPDATE channel_identity_bindings SET active=1,metadata_json=?3,last_seen_at=?4,updated_at=?4
      WHERE workspace_id=?1 AND binding_id=?2`)
      .bind(workspaceId, bindingId, JSON.stringify(identity.metadata || {}), now));
  } else {
    statements.push(env.DB.prepare(`INSERT INTO channel_identity_bindings
        (binding_id,workspace_id,identity_id,channel_id,scoped_profile_id,metadata_json,active,
         first_seen_at,last_seen_at,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,1,?7,?7,?7,?7)`)
      .bind(bindingId, workspaceId, identityId, identity.channelId, identity.scopedProfileId,
        JSON.stringify(identity.metadata || {}), now));
    statements.push(env.DB.prepare(`INSERT OR IGNORE INTO channel_identities
        (identity_id,contact_id,channel_id,channel_profile_id,display_name,metadata_json,created_at,workspace_id)
      VALUES (?1,?2,?3,?4,?5,'{}',?6,?7)`)
      .bind(bindingId, contactId, identity.channelId, identity.scopedProfileId,
        identity.displayName || '', now, workspaceId));
  }
  return {
    binding: { bindingId, channelId: identity.channelId, channelProfileId: identity.scopedProfileId },
    statements
  };
}

async function ensureIdentityConversation(env, workspaceId, contactId, identityId, channelId, assignedTo = '') {
  const route = await env.DB.prepare(`SELECT ci.display_name,ct.display_name AS contact_name,ct.tags_json
    FROM contact_identities ci JOIN contacts ct ON ct.contact_id=ci.contact_id AND ct.workspace_id=ci.workspace_id
    JOIN channel_identity_bindings b ON b.identity_id=ci.identity_id AND b.workspace_id=ci.workspace_id
      AND b.channel_id=?4 AND b.active=1
    WHERE ci.workspace_id=?1 AND ci.contact_id=?2 AND ci.identity_id=?3 LIMIT 1`)
    .bind(workspaceId, contactId, identityId, channelId).first();
  if (!route) throw httpError(409, 'This identity is not routed through the selected channel.');
  let conversation = await env.DB.prepare(`SELECT conversation_id FROM conversations
    WHERE workspace_id=?1 AND contact_id=?2 LIMIT 1`)
    .bind(workspaceId, contactId).first();
  if (conversation) {
    await touchIdentityBinding(env, workspaceId, identityId, channelId, '', conversation.conversation_id);
    return conversation.conversation_id;
  }
  const legacy = await env.DB.prepare(`SELECT conversation_id FROM conversations
    WHERE workspace_id=?1 AND contact_id=?2 AND channel_id=?3 AND identity_id='' LIMIT 1`)
    .bind(workspaceId, contactId, channelId).first();
  const now = new Date().toISOString();
  let legacyIsUnambiguous = false;
  if (legacy) {
    const candidates = await env.DB.prepare(`SELECT ci.identity_id
      FROM contact_identities ci
      JOIN channel_identity_bindings b ON b.workspace_id=ci.workspace_id AND b.identity_id=ci.identity_id
      WHERE ci.workspace_id=?1 AND ci.contact_id=?2 AND b.channel_id=?3 AND b.active=1
      ORDER BY ci.identity_id`).bind(workspaceId, contactId, channelId).all();
    const candidateIds = [...new Set((candidates.results || []).map(item => String(item.identity_id || '')).filter(Boolean))];
    legacyIsUnambiguous = candidateIds.length === 1 && candidateIds[0] === identityId;
  }
  if (legacy && legacyIsUnambiguous) {
    try {
      await env.DB.batch([
        env.DB.prepare(`UPDATE conversations SET identity_id=?4,updated_at=?5
          WHERE workspace_id=?1 AND conversation_id=?2 AND contact_id=?3 AND identity_id=''`)
          .bind(workspaceId, legacy.conversation_id, contactId, identityId, now),
        env.DB.prepare(`UPDATE messages SET identity_id=?3
          WHERE workspace_id=?1 AND conversation_id=?2 AND identity_id=''`)
          .bind(workspaceId, legacy.conversation_id, identityId),
        env.DB.prepare(`UPDATE identity_migration_issues SET resolved_at=?3
          WHERE workspace_id=?1 AND conversation_id=?2 AND resolved_at=''`)
          .bind(workspaceId, legacy.conversation_id, now)
      ]);
      await touchIdentityBinding(env, workspaceId, identityId, channelId, '', legacy.conversation_id, now);
      return legacy.conversation_id;
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      conversation = await env.DB.prepare(`SELECT conversation_id FROM conversations
        WHERE workspace_id=?1 AND contact_id=?2 LIMIT 1`)
        .bind(workspaceId, contactId).first();
      if (conversation) {
        await touchIdentityBinding(env, workspaceId, identityId, channelId, '', conversation.conversation_id, now);
        return conversation.conversation_id;
      }
      throw error;
    }
  }
  const conversationId = crypto.randomUUID();
  try {
    await env.DB.prepare(`INSERT INTO conversations
        (conversation_id,contact_id,channel_id,identity_id,status,assigned_to,subject,last_message_at,
         unread_count,tags_json,created_at,updated_at,workspace_id)
      VALUES (?1,?2,?3,?4,'open',?5,?6,?7,0,?8,?7,?7,?9)`)
      .bind(conversationId, contactId, channelId, identityId, assignedTo,
        route.contact_name || route.display_name || '', now, route.tags_json || '[]', workspaceId).run();
    await touchIdentityBinding(env, workspaceId, identityId, channelId, '', conversationId, now);
    return conversationId;
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    conversation = await env.DB.prepare(`SELECT conversation_id FROM conversations
      WHERE workspace_id=?1 AND contact_id=?2 LIMIT 1`)
      .bind(workspaceId, contactId).first();
    if (!conversation) throw error;
    await touchIdentityBinding(env, workspaceId, identityId, channelId, '', conversation.conversation_id, now);
    return conversation.conversation_id;
  }
}

async function reconcileLegacyConversationIdentity(env, workspaceId, conversationId) {
  const conversation = await env.DB.prepare(`SELECT c.conversation_id,c.contact_id,c.channel_id,c.identity_id,
      ch.connector_type,ch.provider_type
    FROM conversations c JOIN channels ch ON ch.channel_id=c.channel_id AND ch.workspace_id=c.workspace_id
    WHERE c.workspace_id=?1 AND c.conversation_id=?2`).bind(workspaceId, conversationId).first();
  if (!conversation || conversation.identity_id) return conversation;

  const routes = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id
    FROM channel_identity_bindings b JOIN contact_identities ci ON ci.identity_id=b.identity_id
      AND ci.workspace_id=b.workspace_id
    WHERE b.workspace_id=?1 AND b.channel_id=?2 AND ci.contact_id=?3 AND b.active=1
    ORDER BY b.created_at,b.binding_id`).bind(workspaceId, conversation.channel_id, conversation.contact_id).all();
  let identity = (routes.results || []).length === 1 ? routes.results[0] : null;

  if (!identity && (routes.results || []).length === 0) {
    const legacy = await env.DB.prepare(`SELECT channel_profile_id,display_name,metadata_json,MIN(created_at) AS created_at
      FROM channel_identities
      WHERE workspace_id=?1 AND contact_id=?2 AND channel_id=?3
      GROUP BY channel_profile_id,display_name,metadata_json
      ORDER BY created_at,channel_profile_id`).bind(workspaceId, conversation.contact_id, conversation.channel_id).all();
    const legacyRoutes = legacy.results || [];
    const distinctProfiles = [...new Set(legacyRoutes.map(row => String(row.channel_profile_id || '')))].filter(Boolean);
    if (distinctProfiles.length === 1) {
      const route = legacyRoutes.find(row => String(row.channel_profile_id || '') === distinctProfiles[0]);
      const platform = platformForChannel(conversation);
      const result = await ensureContactIdentity(env, workspaceId, conversation.contact_id, {
        platform,
        profileId: distinctProfiles[0],
        username: '',
        phoneNumber: platform === 'whatsapp' && /^\d{6,20}$/.test(distinctProfiles[0]) ? distinctProfiles[0] : '',
        displayName: String(route?.display_name || '').slice(0, 120),
        metadata: safeJsonParse(route?.metadata_json, {}),
        channelId: conversation.channel_id,
        scopedProfileId: distinctProfiles[0]
      });
      identity = { identity_id: result.identityId, contact_id: conversation.contact_id };
    }
  }

  if (!identity) {
    const now = new Date().toISOString();
    const candidateCount = Number((routes.results || []).length);
    await env.DB.prepare(`INSERT INTO identity_migration_issues
        (issue_id,workspace_id,conversation_id,issue_type,candidate_count,details_json,created_at,resolved_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,'')
      ON CONFLICT(issue_id) DO UPDATE SET issue_type=excluded.issue_type,
        candidate_count=excluded.candidate_count,details_json=excluded.details_json,resolved_at=''`)
      .bind(`${conversationId}:runtime-identity`, workspaceId, conversationId,
        candidateCount > 1 ? 'ambiguous_identity' : 'missing_identity', candidateCount,
        JSON.stringify({ contactId: conversation.contact_id, channelId: conversation.channel_id }), now).run();
    return conversation;
  }

  await ensureIdentityConversation(env, workspaceId, conversation.contact_id, identity.identity_id,
    conversation.channel_id, '');
  return { ...conversation, identity_id: identity.identity_id };
}

async function touchIdentityBinding(env, workspaceId, identityId, channelId, direction = '', conversationId = '',
  now = new Date().toISOString()) {
  const inbound = direction === 'inbound' ? now : '';
  const outbound = direction === 'outbound' ? now : '';
  await env.DB.prepare(`UPDATE channel_identity_bindings SET
      last_seen_at=?5,
      last_inbound_at=CASE WHEN ?6<>'' THEN ?6 ELSE last_inbound_at END,
      last_outbound_at=CASE WHEN ?7<>'' THEN ?7 ELSE last_outbound_at END,
      last_conversation_id=CASE WHEN ?4<>'' THEN ?4 ELSE last_conversation_id END,
      updated_at=?5
    WHERE workspace_id=?1 AND identity_id=?2 AND channel_id=?3 AND active=1`)
    .bind(workspaceId, identityId, channelId, conversationId, now, inbound, outbound).run();
}

async function openIdentityConversation(env, workspaceId, payload, principal) {
  if (!isPlainObject(payload)) throw httpError(400, 'Conversation request must be a JSON object.');
  rejectUnknownKeys(payload, new Set(['contactId', 'identityId', 'channelId']), 'conversation request');
  const identityId = cleanId(payload.identityId, 'Identity ID');
  const identity = await env.DB.prepare(`SELECT identity_id,contact_id,platform,profile_id,username,phone_number,
      display_name,metadata_json FROM contact_identities
    WHERE workspace_id=?1 AND identity_id=?2`).bind(workspaceId, identityId).first();
  if (!identity) throw httpError(404, 'Contact identity not found.');
  const contactId = identity.contact_id;
  if (payload.contactId !== undefined && cleanId(payload.contactId, 'Contact ID') !== contactId) {
    throw httpError(409, 'The identity does not belong to the supplied contact.');
  }
  let channelId = payload.channelId === undefined || payload.channelId === null || payload.channelId === ''
    ? '' : cleanId(payload.channelId, 'Channel ID');
  if (!channelId) {
    const routes = await env.DB.prepare(`SELECT channel_id FROM channel_identity_bindings
      WHERE workspace_id=?1 AND identity_id=?2 AND active=1 ORDER BY last_seen_at DESC`).bind(workspaceId, identityId).all();
    if ((routes.results || []).length === 1) channelId = routes.results[0].channel_id;
    else if ((routes.results || []).length > 1) throw httpError(400, 'Select one connected channel for this identity.');
    else throw httpError(409, 'Add a channel route to this identity before starting a conversation.');
  }
  const channel = await getChannel(env, channelId, '', workspaceId);
  if (!channel || platformForChannel(channel) !== identity.platform) {
    throw httpError(400, 'The selected channel is not compatible with this identity.');
  }
  assertPrincipalChannelAccess(principal, channelId);
  await assertChannelReadyForConversation(env, workspaceId, channel);
  const currentBinding = await env.DB.prepare(`SELECT binding_id FROM channel_identity_bindings
    WHERE workspace_id=?1 AND identity_id=?2 AND channel_id=?3 AND active=1 LIMIT 1`)
    .bind(workspaceId, identityId, channelId).first();
  let routeCreated = false;
  if (!currentBinding) {
    await ensureIdentityBinding(env, workspaceId, contactId, identityId, {
      platform: identity.platform,
      profileId: identity.profile_id,
      channelId,
      scopedProfileId: identity.profile_id,
      displayName: identity.display_name || '',
      metadata: safeJsonParse(identity.metadata_json, {})
    });
    routeCreated = true;
  }
  const conversationId = await ensureIdentityConversation(env, workspaceId, contactId, identityId, channelId,
    principal?.user?.email || '');
  await audit(env, principal, 'open', 'conversation', conversationId, { contactId, identityId, channelId, routeCreated });
  return { ok: true, conversationId, contactId, identityId, channelId,
    item: await getConversationItem(env, workspaceId, conversationId) };
}

async function assertChannelReadyForConversation(env, workspaceId, channel) {
  if (!MANAGED_CONNECTORS.has(channel.connectorType)) return;
  const stored = await env.DB.prepare(`SELECT credential_key FROM channel_credentials
    WHERE workspace_id=?1 AND channel_id=?2`).bind(workspaceId, channel.channelId).all();
  const credentialFields = new Set((stored.results || []).map(row => row.credential_key));
  const health = channelHealth({ enabled: 1, provider_type: channel.connectorType }, channel.config, credentialFields);
  if (health !== 'connected') throw httpError(409, 'Verify the channel and its webhook before starting a conversation.');
}

async function createContactIdentity(env, workspaceId, contactId, payload, principal) {
  const id = cleanId(contactId, 'Contact ID');
  const result = await ensureContactIdentity(env, workspaceId, id, payload);
  await audit(env, principal, 'create', 'contact_identity', result.identityId, {
    contactId: id, platform: result.normalized.platform, channelIds: result.bindings.map(binding => binding.channelId)
  });
  return { ok: true, contactId: id, identityId: result.identityId,
    conversationIds: [], conversationId: '',
    item: await getContactDetail(env, workspaceId, id) };
}

async function updateContactIdentity(env, workspaceId, contactId, identityId, payload, principal) {
  if (!isPlainObject(payload)) throw httpError(400, 'Contact identity update must be a JSON object.');
  const id = cleanId(contactId, 'Contact ID');
  const identity = cleanId(identityId, 'Identity ID');
  const existing = await env.DB.prepare(`SELECT * FROM contact_identities
    WHERE workspace_id=?1 AND contact_id=?2 AND identity_id=?3`).bind(workspaceId, id, identity).first();
  if (!existing) throw httpError(404, 'Contact identity not found.');
  const merged = {
    ...payload,
    identityId: identity,
    platform: payload.platform ?? payload.connectorType ?? existing.platform,
    profileId: payload.profileId ?? payload.channelProfileId ?? existing.profile_id,
    username: payload.username ?? existing.username,
    phoneNumber: payload.phoneNumber ?? existing.phone_number,
    displayName: payload.displayName ?? existing.display_name,
    metadata: payload.metadata ?? safeJsonParse(existing.metadata_json, {})
  };
  const normalized = validateContactIdentityInput(merged, { displayName: existing.display_name });
  if (normalized.platform !== existing.platform || normalized.profileId !== existing.profile_id) {
    throw httpError(400, 'Identity platform and profile ID cannot be changed. Add another identity instead.');
  }
  // Fail the entire request before any editable fields or primary flags change
  // when even one requested route is invalid or already owned elsewhere.
  await prevalidateIdentityRoutes(env, workspaceId, identity, normalized);
  const routesToRemove = await prevalidateIdentityRouteRemovals(env, workspaceId, identity, normalized);
  const now = new Date().toISOString();
  const statements = [];
  if (normalized.metadata.isPrimary) {
    const others = await env.DB.prepare(`SELECT identity_id,metadata_json FROM contact_identities
      WHERE workspace_id=?1 AND contact_id=?2 AND identity_id<>?3`).bind(workspaceId, id, identity).all();
    for (const other of others.results || []) {
      const metadata = safeJsonParse(other.metadata_json, {});
      if (isPlainObject(metadata) && metadata.isPrimary) {
        delete metadata.isPrimary;
        statements.push(env.DB.prepare(`UPDATE contact_identities SET metadata_json=?4,updated_at=?5
          WHERE workspace_id=?1 AND contact_id=?2 AND identity_id=?3`)
          .bind(workspaceId, id, other.identity_id, JSON.stringify(metadata), now));
      }
    }
  }
  statements.push(env.DB.prepare(`UPDATE contact_identities SET username=?4,phone_number=?5,display_name=?6,
      metadata_json=?7,updated_at=?8 WHERE workspace_id=?1 AND contact_id=?2 AND identity_id=?3`)
    .bind(workspaceId, id, identity, normalized.username, normalized.phoneNumber,
      normalized.displayName, JSON.stringify(normalized.metadata), now));
  const bindings = [];
  for (const route of normalized.routes) {
    const mutation = await prepareIdentityBindingMutation(env, workspaceId, id, identity,
      { ...normalized, ...route, channelId: route.channelId, scopedProfileId: route.scopedProfileId }, now);
    statements.push(...mutation.statements);
    bindings.push(mutation.binding);
  }
  if (routesToRemove.length) {
      statements.push(...routesToRemove.map(route => env.DB.prepare(`UPDATE channel_identity_bindings
        SET active=0,updated_at=?3 WHERE workspace_id=?1 AND binding_id=?2`)
        .bind(workspaceId, route.binding_id, now)));
  }
  await env.DB.batch(statements);
  await audit(env, principal, 'update', 'contact_identity', identity,
    { contactId: id, channelIds: bindings.map(binding => binding.channelId) });
  return { ok: true, contactId: id, identityId: identity, item: await getContactDetail(env, workspaceId, id) };
}

async function deleteContactIdentity(env, workspaceId, contactId, identityId, principal) {
  const id = cleanId(contactId, 'Contact ID');
  const identity = cleanId(identityId, 'Identity ID');
  const existing = await env.DB.prepare(`SELECT identity_id,platform,profile_id,
      (SELECT COUNT(*) FROM conversations conversation WHERE conversation.workspace_id=?1 AND (
        conversation.identity_id=?3 OR (conversation.identity_id='' AND conversation.contact_id=?2
          AND EXISTS (SELECT 1 FROM channel_identity_bindings binding
            WHERE binding.workspace_id=?1 AND binding.identity_id=?3
              AND binding.channel_id=conversation.channel_id)))) AS conversation_count,
      (SELECT COUNT(*) FROM messages message WHERE message.workspace_id=?1 AND (
        message.identity_id=?3 OR (message.identity_id='' AND message.contact_id=?2
          AND EXISTS (SELECT 1 FROM channel_identity_bindings binding
            WHERE binding.workspace_id=?1 AND binding.identity_id=?3
              AND binding.channel_id=message.channel_id)))) AS message_count
    FROM contact_identities WHERE workspace_id=?1 AND contact_id=?2 AND identity_id=?3`)
    .bind(workspaceId, id, identity).first();
  if (!existing) throw httpError(404, 'Contact identity not found.');
  if (Number(existing.conversation_count || 0) || Number(existing.message_count || 0)) {
    throw httpError(409, 'Delete this identity’s conversations before deleting the identity.');
  }
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM channel_identities WHERE workspace_id=?1 AND identity_id IN
      (SELECT binding_id FROM channel_identity_bindings WHERE workspace_id=?1 AND identity_id=?2)`)
      .bind(workspaceId, identity),
    env.DB.prepare(`DELETE FROM channel_identity_bindings WHERE workspace_id=?1 AND identity_id=?2`)
      .bind(workspaceId, identity),
    env.DB.prepare(`DELETE FROM contact_identities WHERE workspace_id=?1 AND contact_id=?2 AND identity_id=?3`)
      .bind(workspaceId, id, identity)
  ]);
  await audit(env, principal, 'delete', 'contact_identity', identity,
    { contactId: id, platform: existing.platform, profileId: existing.profile_id });
  return { ok: true, contactId: id, identityId: identity, deleted: true, item: await getContactDetail(env, workspaceId, id) };
}

async function flatIdentityHasHistory(env, workspaceId, contactId, identityId) {
  const result = await env.DB.prepare(`SELECT
      EXISTS(SELECT 1 FROM conversations conversation
        WHERE conversation.workspace_id=?1 AND conversation.contact_id=?2 AND (
          conversation.identity_id=?3 OR (conversation.identity_id='' AND EXISTS (
            SELECT 1 FROM channel_identity_bindings binding
            WHERE binding.workspace_id=?1 AND binding.identity_id=?3
              AND binding.channel_id=conversation.channel_id)))) AS has_conversation,
      EXISTS(SELECT 1 FROM messages message
        WHERE message.workspace_id=?1 AND message.contact_id=?2 AND (
          message.identity_id=?3 OR (message.identity_id='' AND EXISTS (
            SELECT 1 FROM channel_identity_bindings binding
            WHERE binding.workspace_id=?1 AND binding.identity_id=?3
              AND binding.channel_id=message.channel_id)))) AS has_message`)
    .bind(workspaceId, contactId, identityId).first();
  return Boolean(Number(result?.has_conversation || 0) || Number(result?.has_message || 0));
}

async function flatIdentityHasBinding(env, workspaceId, identityId) {
  const result = await env.DB.prepare(`SELECT 1 AS found FROM channel_identity_bindings
    WHERE workspace_id=?1 AND identity_id=?2 LIMIT 1`).bind(workspaceId, identityId).first();
  return Boolean(result?.found);
}

async function prepareContactPlatformIdMutation(env, workspaceId, contactId, platformIds, displayName, now) {
  const supplied = validateContactPlatformIds(platformIds, { requireOne: false });
  const currentResult = await env.DB.prepare(`SELECT flat.platform,flat.profile_id,flat.identity_id,
      identity.created_at,identity.metadata_json
    FROM contact_platform_ids flat
    JOIN contact_identities identity ON identity.workspace_id=flat.workspace_id
      AND identity.identity_id=flat.identity_id
    WHERE flat.workspace_id=?1 AND flat.contact_id=?2`)
    .bind(workspaceId, contactId).all();
  const current = new Map((currentResult.results || []).map(row => [String(row.platform), row]));
  const desired = Object.fromEntries(CONTACT_ID_PLATFORMS.map(platform => [
    platform,
    Object.prototype.hasOwnProperty.call(platformIds, platform)
      ? supplied[platform]
      : String(current.get(platform)?.profile_id || '')
  ]));
  if (!CONTACT_ID_PLATFORMS.some(platform => desired[platform])) {
    throw httpError(400, 'Provide at least one platform ID.');
  }
  const statements = [];
  const identityIds = [];
  for (const platform of CONTACT_ID_PLATFORMS) {
    const profileId = desired[platform];
    const previous = current.get(platform);
    if (previous && previous.profile_id === profileId) {
      identityIds.push(previous.identity_id);
      continue;
    }
    if (previous) {
      if (await flatIdentityHasHistory(env, workspaceId, contactId, previous.identity_id)) {
        const action = profileId ? 'changed' : 'removed';
        throw httpError(409, `The ${platform} ID cannot be ${action} because it has conversation history.`);
      }
      if (await flatIdentityHasBinding(env, workspaceId, previous.identity_id)) {
        const action = profileId ? 'changed' : 'removed';
        throw httpError(409, `The ${platform} ID cannot be ${action} because it is connected to a channel route. Remove the route first.`);
      }
      if (!profileId) {
        statements.push(
          env.DB.prepare(`DELETE FROM channel_identities WHERE workspace_id=?1 AND identity_id IN
            (SELECT binding_id FROM channel_identity_bindings WHERE workspace_id=?1 AND identity_id=?2)`)
            .bind(workspaceId, previous.identity_id),
          env.DB.prepare(`DELETE FROM contact_platform_ids
            WHERE workspace_id=?1 AND contact_id=?2 AND platform=?3`)
            .bind(workspaceId, contactId, platform),
          env.DB.prepare(`DELETE FROM channel_identity_bindings WHERE workspace_id=?1 AND identity_id=?2`)
            .bind(workspaceId, previous.identity_id),
          env.DB.prepare(`DELETE FROM contact_identities
            WHERE workspace_id=?1 AND contact_id=?2 AND identity_id=?3`)
            .bind(workspaceId, contactId, previous.identity_id)
        );
        continue;
      }
      statements.push(
        env.DB.prepare(`UPDATE contact_identities SET profile_id=?4,username='',phone_number='',display_name='',updated_at=?5
          WHERE workspace_id=?1 AND contact_id=?2 AND identity_id=?3`)
          .bind(workspaceId, contactId, previous.identity_id, profileId, now),
        env.DB.prepare(`UPDATE contact_platform_ids SET profile_id=?4,updated_at=?5
          WHERE workspace_id=?1 AND contact_id=?2 AND platform=?3`)
          .bind(workspaceId, contactId, platform, profileId, now)
      );
      identityIds.push(previous.identity_id);
      continue;
    }
    if (!profileId) continue;
    const identityId = crypto.randomUUID();
    const isFirst = identityIds.length === 0 && current.size === 0;
    statements.push(
      env.DB.prepare(`INSERT INTO contact_identities
          (identity_id,workspace_id,contact_id,platform,profile_id,username,phone_number,display_name,
           metadata_json,created_at,updated_at)
        VALUES (?1,?2,?3,?4,?5,'','','',?6,?7,?7)`)
        .bind(identityId, workspaceId, contactId, platform, profileId,
          JSON.stringify(isFirst ? { isPrimary: true } : {}), now),
      env.DB.prepare(`INSERT INTO contact_platform_ids
          (workspace_id,contact_id,platform,profile_id,identity_id,created_at,updated_at)
        VALUES (?1,?2,?3,?4,?5,?6,?6)`)
        .bind(workspaceId, contactId, platform, profileId, identityId, now)
    );
    identityIds.push(identityId);
  }
  return { desired, statements, identityIds };
}

async function updateContact(env, workspaceId, contactId, payload, principal) {
  if (!isPlainObject(payload)) throw httpError(400, 'Contact update must be a JSON object.');
  rejectUnknownKeys(payload, new Set(['displayName', 'name', 'company', 'tags', 'channelId', 'channelProfileId', 'platformIds', 'identities']), 'contact');
  if (!Object.keys(payload).length) throw httpError(400, 'Provide at least one contact field to update.');
  if (payload.displayName !== undefined && payload.name !== undefined &&
      String(payload.displayName).trim() !== String(payload.name).trim()) {
    throw httpError(400, 'Display name and name must match when both are supplied.');
  }
  const id = cleanId(contactId, 'Contact ID');
  const existing = await env.DB.prepare(`SELECT contact_id,display_name,company,tags_json,attributes_json
    FROM contacts WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, id).first();
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
  if (payload.platformIds !== undefined && payload.identities !== undefined) {
    throw httpError(400, 'Use platformIds or legacy identities, not both.');
  }
  // Validate the complete identity graph before changing even the base contact
  // fields. This prevents a bad second identity/route from leaving the contact
  // and an earlier identity partially updated.
  if (payload.identities !== undefined) {
    await prevalidateContactIdentityBatch(env, workspaceId, id, payload.identities, displayName);
  }
  // Legacy aliases are validation-only. Validate them against the currently
  // preferred identity before any base or identity write so an invalid alias
  // cannot turn an otherwise combined PATCH into a partial save.
  if (payload.channelId !== undefined || payload.channelProfileId !== undefined) {
    const hydrated = await getContactDetail(env, workspaceId, id);
    const preferred = hydrated.identities.find(identity => identity.isPrimary) || hydrated.identities[0];
    if (!preferred) throw httpError(409, 'Add a contact identity before assigning a channel.');
    if (payload.channelProfileId !== undefined) {
      const supplied = normalizeIdentityProfileValue(preferred.platform, payload.channelProfileId, 'Channel Profile ID');
      if (supplied !== preferred.profileId && supplied !== preferred.channelProfileId) {
        throw httpError(400, 'Channel Profile ID cannot be changed. Add another identity instead.');
      }
    }
    if (payload.channelId !== undefined && cleanId(payload.channelId, 'Channel ID') !== preferred.channelId) {
      throw httpError(400, 'Use a contact identity route to select another connected channel.');
    }
  }
  const now = new Date().toISOString();
  const flatMutation = payload.platformIds === undefined
    ? null
    : await prepareContactPlatformIdMutation(env, workspaceId, id, payload.platformIds, displayName, now);
  await env.DB.batch([
    env.DB.prepare(`UPDATE contacts SET display_name=?3,company=?4,tags_json=?5,updated_at=?6
      WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, id, displayName, company, JSON.stringify(tags), now),
    env.DB.prepare(`UPDATE channel_identities SET display_name=?3
      WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, id, displayName),
    env.DB.prepare(`UPDATE contact_identities SET display_name=CASE WHEN display_name='' OR display_name=?3 THEN ?4 ELSE display_name END,
      updated_at=?5 WHERE workspace_id=?1 AND contact_id=?2`)
      .bind(workspaceId, id, existing.display_name, displayName, now),
    env.DB.prepare(`UPDATE conversations SET subject=?3,tags_json=?4,updated_at=?5
      WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, id, displayName, JSON.stringify(tags), now),
    ...(flatMutation?.statements || [])
  ]);
  if (payload.identities !== undefined) {
    for (const identity of payload.identities) {
      if (identity?.identityId) {
        await updateContactIdentity(env, workspaceId, id, identity.identityId, identity, principal);
      } else {
        await createContactIdentity(env, workspaceId, id, identity, principal);
      }
    }
  }
  const changedFields = [...new Set(Object.keys(payload).map(key => key === 'name' ? 'displayName' : key))];
  await audit(env, principal, 'update', 'contact', id, {
    fields: changedFields,
    identitiesUpdated: flatMutation?.identityIds?.length || (Array.isArray(payload.identities) ? payload.identities.length : 0)
  });
  return getContactDetail(env, workspaceId, id);
}

async function deleteContact(env, workspaceId, contactId, principal) {
  const id = cleanId(contactId, 'Contact ID');
  const existing = await env.DB.prepare(`SELECT contact_id,display_name,company,
      (SELECT COUNT(*) FROM contact_identities WHERE workspace_id=?2 AND contact_id=?1) AS identity_count,
      (SELECT COUNT(*) FROM conversations WHERE workspace_id=?2 AND contact_id=?1) AS conversation_count,
      (SELECT COUNT(*) FROM messages WHERE workspace_id=?2 AND contact_id=?1) AS message_count
    FROM contacts WHERE contact_id=?1 AND workspace_id=?2`).bind(id, workspaceId).first();
  if (!existing) throw httpError(404, 'Contact not found.');
  const conversations = await env.DB.prepare(`SELECT conversation_id FROM conversations
    WHERE workspace_id=?1 AND contact_id=?2 ORDER BY created_at`).bind(workspaceId, id).all();
  const conversationIds = (conversations.results || []).map(row => String(row.conversation_id));
  const mediaTargets = await listWhatsAppMediaTargets(env, workspaceId, { contactId: id });
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM external_api_requests WHERE workspace_id=?2 AND message_id IN
      (SELECT message_id FROM messages WHERE contact_id=?1 AND workspace_id=?2)`).bind(id, workspaceId),
    env.DB.prepare(`DELETE FROM outbox WHERE workspace_id=?2 AND message_id IN
      (SELECT message_id FROM messages WHERE contact_id=?1 AND workspace_id=?2)`).bind(id, workspaceId),
    env.DB.prepare(`DELETE FROM outbound_payloads WHERE workspace_id=?2 AND message_id IN
      (SELECT message_id FROM messages WHERE contact_id=?1 AND workspace_id=?2)`).bind(id, workspaceId),
    env.DB.prepare(`DELETE FROM identity_migration_issues WHERE workspace_id=?2 AND conversation_id IN
      (SELECT conversation_id FROM conversations WHERE contact_id=?1 AND workspace_id=?2)`).bind(id, workspaceId),
    env.DB.prepare('DELETE FROM messages WHERE contact_id=?1 AND workspace_id=?2').bind(id, workspaceId),
    env.DB.prepare('DELETE FROM conversations WHERE contact_id=?1 AND workspace_id=?2').bind(id, workspaceId),
    env.DB.prepare('DELETE FROM channel_identities WHERE contact_id=?1 AND workspace_id=?2').bind(id, workspaceId),
    env.DB.prepare(`DELETE FROM channel_identity_bindings WHERE workspace_id=?2 AND identity_id IN
      (SELECT identity_id FROM contact_identities WHERE contact_id=?1 AND workspace_id=?2)`).bind(id, workspaceId),
    env.DB.prepare('DELETE FROM contact_identities WHERE contact_id=?1 AND workspace_id=?2').bind(id, workspaceId),
    env.DB.prepare('DELETE FROM contacts WHERE contact_id=?1 AND workspace_id=?2').bind(id, workspaceId)
  ]);
  const mediaCleanup = await deleteWhatsAppMediaTargets(env, mediaTargets);
  await audit(env, principal, 'delete', 'contact', id, {
    displayName: existing.display_name,
    company: existing.company || '',
    deletedIdentities: Number(existing.identity_count || 0),
    deletedConversations: Number(existing.conversation_count || 0),
    deletedMessages: Number(existing.message_count || 0),
    deletedMedia: mediaCleanup.deletedMedia,
    failedMedia: mediaCleanup.failedMedia
  });
  return {
    ok: true, contactId: id, deleted: true, conversationIds,
    deletedConversations: Number(existing.conversation_count || 0),
    deletedMessages: Number(existing.message_count || 0),
    deletedMedia: mediaCleanup.deletedMedia
  };
}

async function listMessages(env, workspaceId, conversationId, url) {
  const limit = clampInt(url.searchParams.get('limit'), 1, 200, 100);
  const before = url.searchParams.get('before') || '';
  if (!await env.DB.prepare('SELECT 1 FROM conversations WHERE conversation_id=?1 AND workspace_id=?2').bind(conversationId, workspaceId).first()) throw httpError(404, 'Conversation not found.');
  const result = await env.DB.prepare(`SELECT m.message_id,m.identity_id,m.direction,m.text,m.message_type,m.status,m.timestamp,
      m.channel_id,m.provider_message_id,m.error,m.payload_json,m.sender_login,m.sender_name,
      COALESCE(NULLIF(m.route_channel_name,''),ch.name) AS channel_name,
      COALESCE(NULLIF(m.route_connector_type,''),NULLIF(ch.provider_type,''),ch.connector_type) AS connector_type,
      '' AS provider_type,
      COALESCE(NULLIF(m.route_channel_profile_id,''),b.scoped_profile_id,ci.profile_id,'') AS channel_profile_id
    FROM messages m
    JOIN channels ch ON ch.workspace_id=m.workspace_id AND ch.channel_id=m.channel_id
    LEFT JOIN contact_identities ci ON ci.workspace_id=m.workspace_id AND ci.identity_id=m.identity_id
    LEFT JOIN channel_identity_bindings b ON b.workspace_id=m.workspace_id
      AND b.identity_id=m.identity_id AND b.channel_id=m.channel_id AND b.active=1
    WHERE m.workspace_id=?1 AND m.conversation_id=?2 AND (?3='' OR m.timestamp<?3)
    ORDER BY m.timestamp DESC,m.message_id DESC LIMIT ?4`)
    .bind(workspaceId, conversationId, before, limit).all();
  return result.results.reverse().map(row => {
    const payload = safeJsonParse(row.payload_json, {});
    const template = row.message_type === 'template' ? templateMessageView(payload) : null;
    const senderName = messageSenderNameView(row, payload);
    const senderLogin = messageSenderLoginView(row, payload);
    return {
      messageId: row.message_id, direction: row.direction, text: row.text, messageType: row.message_type,
      contactIdentityId: row.identity_id || '', identityId: row.identity_id || '',
      status: row.status, timestamp: row.timestamp, channelId: row.channel_id,
      connectorType: logicalConnectorType(row), channelName: row.channel_name || '',
      channelProfileId: row.channel_profile_id || '',
      channelMessageId: row.provider_message_id, error: row.error,
      ...(senderName ? { senderName } : {}),
      ...(senderLogin ? { senderLogin } : {}),
      attachment: messageAttachmentView(row.message_type, payload, row.message_id),
      ...(template ? { template } : {}),
      ...((() => {
        const statusHistory = messageStatusHistoryView(payload);
        return statusHistory ? { statusHistory } : {};
      })()),
      reply: messageReplyView(payload)
    };
  });
}

function messageSenderNameView(row, payload) {
  if (row?.direction !== 'outbound') return '';
  const fromColumn = String(row?.sender_name || '').trim();
  if (fromColumn) return fromColumn.slice(0, 120);
  const fromPayload = String(payload?.senderName || '').trim();
  return fromPayload ? fromPayload.slice(0, 120) : '';
}

function messageSenderLoginView(row, payload) {
  if (row?.direction !== 'outbound') return '';
  const fromColumn = String(row?.sender_login || '').trim();
  if (fromColumn) return fromColumn.slice(0, 254);
  const name = messageSenderNameView(row, payload);
  if (name === 'API') return 'API';
  if (name === 'Interakt') return 'Interakt';
  return '';
}

function messageStatusHistoryView(payload) {
  const history = isPlainObject(payload?.statusHistory) ? payload.statusHistory : null;
  if (!history) return null;
  const next = {};
  for (const key of ['sentAt', 'deliveredAt', 'readAt', 'failedAt', 'updatedAt']) {
    const value = String(history[key] || '').trim();
    if (value) next[key] = value.slice(0, 64);
  }
  return Object.keys(next).length ? next : null;
}

function messageReplyView(payload) {
  const reply = isPlainObject(payload?.reply) ? payload.reply : null;
  if (!reply) return null;
  const messageId = /^[A-Za-z0-9_-]{1,100}$/.test(String(reply.messageId || '')) ? String(reply.messageId) : '';
  const channelMessageId = String(reply.channelMessageId || '').trim().slice(0, 512);
  if (!messageId && !channelMessageId) return null;
  const messageType = String(reply.messageType || 'text').slice(0, 40);
  const attachment = isPlainObject(reply.attachment) ? {
    type: String(reply.attachment.type || '').slice(0, 40),
    filename: safeAttachmentFilename(reply.attachment.filename || '')
  } : null;
  return {
    messageId,
    channelMessageId,
    direction: ['inbound', 'outbound'].includes(reply.direction) ? reply.direction : '',
    text: String(reply.text || '').slice(0, 1000),
    messageType,
    ...(attachment?.type ? { attachment } : {})
  };
}

function templateMessageView(payload) {
  const value = isPlainObject(payload?.template) ? payload.template : null;
  if (!value) return null;
  const name = providerText(value.name, 512);
  const languageCode = providerText(isPlainObject(value.language) ? value.language.code : value.language, 35);
  if (!/^[a-z0-9_]+$/.test(name) || !/^[A-Za-z]{2,3}(?:_[A-Za-z0-9]{2,8})?$/.test(languageCode)) return null;
  const templateId = providerIdentifier(value.templateId || value.id, 128);
  const category = providerEnum(value.category, 40);
  const buttons = (Array.isArray(value.buttons) ? value.buttons : []).slice(0, 10).flatMap(button => {
    if (!isPlainObject(button)) return [];
    const type = String(button.type || '').toLowerCase();
    const text = providerText(button.text, 100);
    return TEMPLATE_BUTTON_TYPES.has(type) && text ? [{ type, text }] : [];
  });
  return {
    name,
    language: { code: languageCode },
    ...(templateId ? { templateId } : {}),
    ...(category ? { category } : {}),
    ...(buttons.length ? { buttons } : {})
  };
}

async function updateConversation(env, workspaceId, id, payload, principal) {
  const existing = await env.DB.prepare('SELECT * FROM conversations WHERE conversation_id=?1 AND workspace_id=?2').bind(id, workspaceId).first();
  if (!existing) throw httpError(404, 'Conversation not found.');
  const hasStatusPatch = payload.status !== undefined && payload.status !== null;
  const status = payload.status ?? existing.status;
  if (!['open', 'pending', 'closed'].includes(status)) throw httpError(400, 'Invalid conversation status.');
  const hasAssigneePatch = payload.assignedTo !== undefined;
  let assignedTo = payload.assignedTo === undefined ? existing.assigned_to : String(payload.assignedTo).trim().slice(0, 160);
  if (payload.assignedTo !== undefined && assignedTo) {
    const assignee = await env.DB.prepare(`SELECT u.email FROM memberships m JOIN users u ON u.user_id=m.user_id
      WHERE m.workspace_id=?1 AND m.status='active' AND (lower(u.email)=lower(?2) OR u.user_id=?2)`).bind(workspaceId, assignedTo).first();
    if (!assignee) throw httpError(400, 'Assignee is not an active workspace member.');
    assignedTo = assignee.email;
  }
  const markRead = Boolean(payload.markRead);
  // Clear only the unread messages that existed when this request began. An
  // inbound webhook can increment the counter between the SELECT above and
  // this UPDATE; setting the counter to zero would silently mark that newer
  // message as read before any client had displayed it.
  const knownUnreadCount = Math.max(0, Number(existing.unread_count) || 0);
  const fallbackUnreadCount = markRead ? 0 : existing.unread_count;
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE conversations SET
      status=CASE WHEN ?3=1 THEN ?4 ELSE status END,
      assigned_to=CASE WHEN ?5=1 THEN ?6 ELSE assigned_to END,
      unread_count=CASE WHEN ?7=1 THEN
        CASE WHEN unread_count>?8 THEN unread_count-?8 ELSE 0 END
        ELSE unread_count END,updated_at=?9
    WHERE conversation_id=?1 AND workspace_id=?2`)
    .bind(id, workspaceId, hasStatusPatch ? 1 : 0, status, hasAssigneePatch ? 1 : 0, assignedTo,
      markRead ? 1 : 0, knownUnreadCount, now).run();
  await audit(env, principal, 'update', 'conversation', id, { status, assignedTo, markRead });
  return await getConversationItem(env, workspaceId, id) ||
    { conversationId: id, status, assignedTo, unreadCount: fallbackUnreadCount, updatedAt: now };
}

async function listWhatsAppMediaTargets(env, workspaceId, { conversationId = '', contactId = '' } = {}) {
  const conversation = String(conversationId || '').trim();
  const contact = String(contactId || '').trim();
  if (!conversation && !contact) return [];
  const rows = conversation
    ? await env.DB.prepare(`SELECT m.payload_json,m.channel_id,c.connector_type,c.provider_type,c.config_json,
          c.secret_key,c.workspace_id
        FROM messages m
        JOIN channels c ON c.channel_id=m.channel_id AND c.workspace_id=m.workspace_id
        WHERE m.workspace_id=?1 AND m.conversation_id=?2`).bind(workspaceId, conversation).all()
    : await env.DB.prepare(`SELECT m.payload_json,m.channel_id,c.connector_type,c.provider_type,c.config_json,
          c.secret_key,c.workspace_id
        FROM messages m
        JOIN channels c ON c.channel_id=m.channel_id AND c.workspace_id=m.workspace_id
        WHERE m.workspace_id=?1 AND m.contact_id=?2`).bind(workspaceId, contact).all();
  const targets = [];
  const seen = new Set();
  for (const row of rows.results || []) {
    if (logicalConnectorType(row) !== 'whatsapp_cloud') continue;
    const mediaId = String(safeJsonParse(row.payload_json, {})?.attachment?.providerMediaId || '').trim();
    if (!mediaId || seen.has(`${row.channel_id}:${mediaId}`)) continue;
    seen.add(`${row.channel_id}:${mediaId}`);
    targets.push({
      mediaId,
      channel: {
        channelId: row.channel_id,
        connectorType: 'whatsapp_cloud',
        config: safeJsonParse(row.config_json, {}),
        secretKey: row.secret_key,
        workspaceId: row.workspace_id
      }
    });
  }
  return targets;
}

async function deleteWhatsAppMediaTargets(env, targets) {
  const items = Array.isArray(targets) ? targets : [];
  if (!items.length) return { deletedMedia: 0, failedMedia: 0 };
  const credentialsByChannel = new Map();
  let deletedMedia = 0;
  let failedMedia = 0;
  for (const target of items) {
    const channelId = String(target?.channel?.channelId || '');
    const mediaId = String(target?.mediaId || '').trim();
    if (!channelId || !mediaId || !/^[A-Za-z0-9_-]{1,128}$/.test(mediaId)) {
      failedMedia += 1;
      continue;
    }
    try {
      let credentials = credentialsByChannel.get(channelId);
      if (!credentials) {
        credentials = await readChannelCredentials(env, target.channel);
        credentialsByChannel.set(channelId, credentials);
      }
      const token = String(credentials.accessToken || '');
      if (!token) {
        failedMedia += 1;
        continue;
      }
      const version = metaApiVersion(target.channel.config?.apiVersion);
      const response = await fetch(
        `https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(mediaId)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
      );
      // 404/410 means the media is already gone, which still frees reusable storage.
      if (response.ok || response.status === 404 || response.status === 410) deletedMedia += 1;
      else failedMedia += 1;
    } catch (error) {
      failedMedia += 1;
      console.error('whatsapp_media_delete_failed', {
        channelId, mediaId, error: cleanError(error)
      });
    }
  }
  return { deletedMedia, failedMedia };
}

async function deleteConversation(env, workspaceId, conversationId, principal) {
  const id = cleanId(conversationId, 'Conversation ID');
  const existing = await env.DB.prepare(`SELECT conversation_id,contact_id,channel_id,subject,status,
      (SELECT COUNT(*) FROM messages WHERE workspace_id=?2 AND conversation_id=?1) AS message_count
    FROM conversations WHERE conversation_id=?1 AND workspace_id=?2`)
    .bind(id, workspaceId).first();
  if (!existing) throw httpError(404, 'Conversation not found.');
  const mediaTargets = await listWhatsAppMediaTargets(env, workspaceId, { conversationId: id });
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM external_api_requests WHERE workspace_id=?2 AND message_id IN
      (SELECT message_id FROM messages WHERE conversation_id=?1 AND workspace_id=?2)`).bind(id, workspaceId),
    env.DB.prepare(`DELETE FROM outbox WHERE workspace_id=?2 AND message_id IN
      (SELECT message_id FROM messages WHERE conversation_id=?1 AND workspace_id=?2)`).bind(id, workspaceId),
    env.DB.prepare(`DELETE FROM outbound_payloads WHERE workspace_id=?2 AND message_id IN
      (SELECT message_id FROM messages WHERE conversation_id=?1 AND workspace_id=?2)`).bind(id, workspaceId),
    env.DB.prepare('DELETE FROM identity_migration_issues WHERE conversation_id=?1 AND workspace_id=?2').bind(id, workspaceId),
    env.DB.prepare('DELETE FROM messages WHERE conversation_id=?1 AND workspace_id=?2').bind(id, workspaceId),
    env.DB.prepare('DELETE FROM conversations WHERE conversation_id=?1 AND workspace_id=?2').bind(id, workspaceId)
  ]);
  const mediaCleanup = await deleteWhatsAppMediaTargets(env, mediaTargets);
  await audit(env, principal, 'delete', 'conversation', id, {
    contactId: existing.contact_id,
    channelId: existing.channel_id,
    subject: existing.subject,
    previousStatus: existing.status,
    deletedMessages: Number(existing.message_count || 0),
    deletedMedia: mediaCleanup.deletedMedia,
    failedMedia: mediaCleanup.failedMedia
  });
  return {
    ok: true, conversationId: id, contactId: existing.contact_id, deleted: true,
    deletedMessages: Number(existing.message_count || 0),
    deletedMedia: mediaCleanup.deletedMedia
  };
}

async function createContact(env, workspaceId, payload, principal) {
  if (!isPlainObject(payload)) throw httpError(400, 'Contact must be a JSON object.');
  rejectUnknownKeys(payload, new Set(['displayName', 'name', 'company', 'tags', 'channelId', 'channelProfileId', 'platformIds', 'identities']), 'contact');
  if (payload.displayName !== undefined && payload.name !== undefined &&
      String(payload.displayName).trim() !== String(payload.name).trim()) {
    throw httpError(400, 'Display name and name must match when both are supplied.');
  }
  const suppliedName = payload.displayName === undefined ? payload.name : payload.displayName;
  if (typeof suppliedName !== 'string') throw httpError(400, 'Display name must be text.');
  const displayName = cleanRequired(suppliedName, 'Display name', 120);
  const company = payload.company === undefined ? '' : cleanOptionalText(payload.company, 'Company', 160);
  const tags = payload.tags === undefined ? [] : validateContactTags(payload.tags);
  if (payload.platformIds !== undefined &&
      (payload.identities !== undefined || payload.channelId !== undefined || payload.channelProfileId !== undefined)) {
    throw httpError(400, 'Use platformIds or legacy identity/channel fields, not both.');
  }
  if (payload.identities !== undefined && (!Array.isArray(payload.identities) || payload.identities.length > 50)) {
    throw httpError(400, 'Identities must be an array with no more than 50 items.');
  }
  const now = new Date().toISOString();
  const contactId = crypto.randomUUID();
  const legacyConversationRequested = payload.channelId !== undefined || payload.channelProfileId !== undefined;
  const identityInputs = Array.isArray(payload.identities) ? [...payload.identities] : [];
  if (payload.channelId !== undefined || payload.channelProfileId !== undefined) {
    const channelId = cleanId(payload.channelId, 'Channel ID');
    const channel = await getChannel(env, channelId, '', workspaceId);
    if (!channel) throw httpError(400, 'Unknown or disabled channel.');
    assertPrincipalChannelAccess(principal, channelId);
    await assertChannelReadyForConversation(env, workspaceId, channel);
    identityInputs.push({
      platform: platformForChannel(channel),
      connectorType: channel.connectorType,
      channelId,
      channelProfileId: cleanRequired(payload.channelProfileId, 'Channel Profile ID', 512),
      displayName,
      isPrimary: !identityInputs.length
    });
  }
  const flatMutation = payload.platformIds === undefined
    ? null
    : await prepareContactPlatformIdMutation(env, workspaceId, contactId, payload.platformIds, displayName, now);
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO contacts
          (contact_id,display_name,company,tags_json,created_at,updated_at,workspace_id)
        VALUES (?1,?2,?3,?4,?5,?5,?6)`)
        .bind(contactId, displayName, company, JSON.stringify(tags), now, workspaceId),
      ...(flatMutation?.statements || [])
    ]);
  } catch (error) {
    if (isUniqueConstraintError(error)) throw httpError(409, 'Contact ID already exists.');
    throw error;
  }
  const conversationIds = [];
  const identityIds = [...(flatMutation?.identityIds || [])];
  try {
    for (const identityInput of identityInputs) {
      const result = await ensureContactIdentity(env, workspaceId, contactId, identityInput, now);
      identityIds.push(result.identityId);
      for (const binding of (legacyConversationRequested ? result.bindings.slice(0, 1) : [])) {
        conversationIds.push(await ensureIdentityConversation(env, workspaceId, contactId, result.identityId,
          binding.channelId, principal?.user?.email || ''));
      }
    }
  } catch (error) {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM conversations WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, contactId),
      env.DB.prepare(`DELETE FROM channel_identities WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, contactId),
      env.DB.prepare(`DELETE FROM channel_identity_bindings WHERE workspace_id=?1 AND identity_id IN
        (SELECT identity_id FROM contact_identities WHERE workspace_id=?1 AND contact_id=?2)`).bind(workspaceId, contactId),
      env.DB.prepare(`DELETE FROM contact_identities WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, contactId),
      env.DB.prepare(`DELETE FROM contacts WHERE workspace_id=?1 AND contact_id=?2`).bind(workspaceId, contactId)
    ]);
    throw error;
  }
  await audit(env, principal, 'create', 'contact', contactId,
    { identityIds, conversationIds, channelIndependent: identityIds.length === 0 });
  return { ok: true, contactId, identityIds, conversationIds,
    conversationId: conversationIds[0] || '', item: await getContactDetail(env, workspaceId, contactId) };
}

async function createOutboundMessage(env, workspaceId, conversationId, payload, principal) {
  if (!isPlainObject(payload)) throw httpError(400, 'Message payload must be an object.');
  rejectUnknownKeys(payload, new Set(['text', 'replyToMessageId', 'channelId', 'identityId', 'contactIdentityId']), 'message request');
  const sender = outboundSenderAttribution(principal);
  const senderName = sender.name;
  const text = cleanRequired(payload.text, 'Message text', MAX_TEXT_LENGTH);
  await assertConversationChannelAccess(env, workspaceId, conversationId, principal);
  const row = await conversationDeliveryTarget(env, workspaceId, conversationId, payload);
  assertPrincipalChannelAccess(principal, row.channel_id);
  if (!row.enabled) throw httpError(409, 'The selected channel is disabled.');
  const connectorType = row.connectorType;
  assertFreeformReplyAllowed(connectorType, row.last_inbound_at);
  const reply = await resolveReplyTarget(env, workspaceId, conversationId, row.channel_id,
    connectorType, payload.replyToMessageId);
  const now = new Date().toISOString();
  const messageId = crypto.randomUUID();
  const storedPayload = {
    senderName,
    ...(reply ? { reply } : {})
  };
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO messages (message_id,conversation_id,contact_id,channel_id,identity_id,direction,message_type,text,status,timestamp,payload_json,workspace_id,sender_login,sender_name)
      VALUES (?1,?2,?3,?4,?5,'outbound','text',?6,'pending',?7,?8,?9,?10,?11)`).bind(messageId, conversationId, row.contact_id,
        row.channel_id, row.identity_id || '', text, now, JSON.stringify(storedPayload), workspaceId, sender.login, sender.name),
    env.DB.prepare(`UPDATE conversations SET channel_id=?3,identity_id=?4,last_message_at=?5,updated_at=?5
      WHERE conversation_id=?1 AND workspace_id=?2`).bind(conversationId, workspaceId, row.channel_id, row.identity_id, now)
  ]);
  if (row.identity_id) await touchIdentityBinding(env, workspaceId, row.identity_id, row.channel_id, 'outbound', conversationId, now);
  await audit(env, principal, 'send_message', 'conversation', conversationId, {
    channelId: row.channel_id, messageId, senderName, ...(reply ? { replyToMessageId: reply.messageId } : {})
  });
  return { message: {
    messageId, conversationId, channelId: row.channel_id, contactIdentityId: row.identity_id || '',
    identityId: row.identity_id || '', direction: 'outbound', messageType: 'text',
    text, status: 'pending', timestamp: now, reply: reply || null, senderName, senderLogin: sender.login,
    connectorType, channelName: row.channel_name || '', channelProfileId: row.channel_profile_id || ''
  } };
}

async function resolveReplyTarget(env, workspaceId, conversationId, channelId, connectorType, replyToMessageId) {
  if (replyToMessageId === undefined || replyToMessageId === null || String(replyToMessageId).trim() === '') return null;
  if (!['whatsapp_cloud', 'telegram'].includes(connectorType)) {
    throw httpError(409, 'Replying to a specific message is available only for WhatsApp and Telegram conversations.');
  }
  const messageId = String(replyToMessageId).trim();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(messageId)) throw httpError(400, 'Reply message ID is invalid.');
  const row = await env.DB.prepare(`SELECT message_id,provider_message_id,direction,text,message_type,payload_json
    FROM messages WHERE message_id=?1 AND workspace_id=?2 AND conversation_id=?3 AND channel_id=?4`)
    .bind(messageId, workspaceId, conversationId, channelId).first();
  if (!row) throw httpError(404, 'The message being replied to was not found in this conversation.');
  const channelMessageId = String(row.provider_message_id || '').trim();
  if (!channelMessageId) throw httpError(409, 'This message cannot be replied to until the channel confirms it.');
  if (connectorType === 'telegram' && !/^\d{1,20}$/.test(channelMessageId)) {
    throw httpError(409, 'This older Telegram message does not have a reply-compatible channel message ID.');
  }
  return replyMetadataFromRow(row);
}

function replyMetadataFromRow(row) {
  const payload = safeJsonParse(row.payload_json, {});
  const attachment = messageAttachmentView(row.message_type, payload, '');
  return {
    messageId: String(row.message_id || ''),
    channelMessageId: String(row.provider_message_id || ''),
    direction: ['inbound', 'outbound'].includes(row.direction) ? row.direction : '',
    text: String(row.text || '').slice(0, 1000),
    messageType: String(row.message_type || 'text').slice(0, 40),
    ...(attachment?.type ? { attachment: { type: attachment.type, filename: attachment.filename || '' } } : {})
  };
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

async function conversationDeliveryTarget(env, workspaceId, conversationId, selection = {}) {
  const conversation = await env.DB.prepare(`SELECT contact_id,channel_id,identity_id
    FROM conversations WHERE conversation_id=?1 AND workspace_id=?2`)
    .bind(conversationId, workspaceId).first();
  if (!conversation) throw httpError(404, 'Conversation not found.');
  if (!conversation.identity_id) {
    await reconcileLegacyConversationIdentity(env, workspaceId, conversationId);
  }

  let channelId = String(selection.channelId || '').trim();
  let identityId = String(selection.identityId || selection.contactIdentityId || '').trim();
  const replyToMessageId = String(selection.replyToMessageId || '').trim();
  if (replyToMessageId) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(replyToMessageId)) throw httpError(400, 'Reply message ID is invalid.');
    const original = await env.DB.prepare(`SELECT channel_id,identity_id FROM messages
      WHERE workspace_id=?1 AND conversation_id=?2 AND message_id=?3`)
      .bind(workspaceId, conversationId, replyToMessageId).first();
    if (!original) throw httpError(404, 'The message being replied to was not found in this conversation.');
    // A provider reply must use the exact account/profile route of the original
    // message.  Ignore a stale client-side route selection rather than sending
    // the reply through the wrong account.
    channelId = String(original.channel_id || '');
    identityId = String(original.identity_id || '');
  }

  if (!channelId) {
    const latestInbound = await env.DB.prepare(`SELECT channel_id,identity_id FROM messages
      WHERE workspace_id=?1 AND conversation_id=?2 AND direction='inbound'
      ORDER BY timestamp DESC,message_id DESC LIMIT 1`)
      .bind(workspaceId, conversationId).first();
    const latestMessage = latestInbound || await env.DB.prepare(`SELECT channel_id,identity_id FROM messages
      WHERE workspace_id=?1 AND conversation_id=?2
      ORDER BY timestamp DESC,message_id DESC LIMIT 1`)
      .bind(workspaceId, conversationId).first();
    channelId = String(latestMessage?.channel_id || conversation.channel_id || '');
    identityId = String(latestMessage?.identity_id || conversation.identity_id || '');
  }

  const row = await env.DB.prepare(`SELECT c.contact_id,b.channel_id,b.identity_id,b.scoped_profile_id AS channel_profile_id,
      ch.name AS channel_name,ch.connector_type,ch.provider_type,ch.config_json,ch.secret_key,ch.enabled,
      (SELECT MAX(timestamp) FROM messages inbound WHERE inbound.workspace_id=c.workspace_id
        AND inbound.conversation_id=c.conversation_id AND inbound.direction='inbound'
        AND inbound.channel_id=b.channel_id AND inbound.identity_id=b.identity_id) AS last_inbound_at
    FROM conversations c
    JOIN contact_identities ci ON ci.workspace_id=c.workspace_id AND ci.contact_id=c.contact_id
    JOIN channel_identity_bindings b ON b.workspace_id=ci.workspace_id AND b.identity_id=ci.identity_id AND b.active=1
    JOIN channels ch ON ch.workspace_id=b.workspace_id AND ch.channel_id=b.channel_id
    WHERE c.workspace_id=?1 AND c.conversation_id=?2 AND b.channel_id=?3
      AND (?4='' OR b.identity_id=?4)
    ORDER BY CASE WHEN b.identity_id=?4 THEN 0 ELSE 1 END,b.last_inbound_at DESC,b.last_seen_at DESC
    LIMIT 1`).bind(workspaceId, conversationId, channelId, identityId).first();
  if (!row || !row.channel_profile_id) throw httpError(409, 'The selected channel route is not available for this contact.');
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

async function listConversationTemplates(env, workspaceId, conversationId,
  { forceRefresh = false, channelId = '', identityId = '' } = {}) {
  const target = await conversationDeliveryTarget(env, workspaceId, conversationId, { channelId, identityId });
  if (target.connectorType !== 'whatsapp_cloud') {
    throw httpError(409, 'Templates are available only for WhatsApp conversations.');
  }
  if (!target.enabled) throw httpError(409, 'The WhatsApp channel is disabled.');
  return listWhatsAppChannelTemplates(env, target.channel, { approvedOnly: true, forceRefresh });
}

async function listWorkspaceWhatsAppTemplates(env, workspaceId, { forceRefresh = false } = {}) {
  const result = await env.DB.prepare(`SELECT channel_id,name,connector_type,provider_type,enabled,config_json,secret_key,workspace_id
    FROM channels WHERE workspace_id=?1 ORDER BY name COLLATE NOCASE,channel_id`)
    .bind(workspaceId).all();
  const channels = (result.results || []).filter(row => logicalConnectorType(row) === 'whatsapp_cloud').map(row => {
    const config = safeJsonParse(row.config_json, {});
    return {
      channelId: row.channel_id,
      channelName: row.name,
      channelEnabled: Boolean(row.enabled),
      providerDisplayName: providerText(config.verifiedName || config.verifiedPhoneNumber, 160),
      connectorType: 'whatsapp_cloud',
      config,
      secretKey: row.secret_key,
      workspaceId: row.workspace_id
    };
  });
  const items = [];
  const errors = [];
  const truncatedChannels = [];
  const channelResults = await Promise.all(channels.map(async channel => {
    try {
      return { channel, templateResult: await listWhatsAppChannelTemplates(env, channel, {
        approvedOnly: false, includeMetadata: true, forceRefresh
      }) };
    } catch (error) {
      return { channel, error };
    }
  }));
  for (const result of channelResults) {
    const { channel } = result;
    if (result.error) {
      errors.push({
        channelId: channel.channelId,
        channelName: channel.channelName,
        channelEnabled: channel.channelEnabled,
        error: cleanError(result.error)
      });
      continue;
    }
    if (result.templateResult.truncated) {
      truncatedChannels.push({
        channelId: channel.channelId,
        channelName: channel.channelName,
        channelEnabled: channel.channelEnabled,
        limit: result.templateResult.limit
      });
    }
    for (const template of result.templateResult.items) {
      items.push({
        ...template,
        channelId: channel.channelId,
        channelName: channel.channelName,
        channelEnabled: channel.channelEnabled,
        providerDisplayName: channel.providerDisplayName
      });
    }
  }
  items.sort((left, right) => left.name.localeCompare(right.name) ||
    left.language.code.localeCompare(right.language.code) ||
    left.channelName.localeCompare(right.channelName));
  const uniqueOptions = values => [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
  return {
    items,
    errors,
    truncatedChannels,
    filterOptions: {
      channels: channels.map(channel => ({
        value: channel.channelId,
        label: channel.channelName,
        channelEnabled: channel.channelEnabled,
        providerDisplayName: channel.providerDisplayName
      })),
      categories: uniqueOptions(items.map(item => item.category)),
      statuses: uniqueOptions(items.map(item => item.status)),
      languages: uniqueOptions(items.map(item => item.language.code))
    }
  };
}

async function listWhatsAppChannelTemplates(env, channel, {
  approvedOnly = true,
  includeMetadata = false,
  forceRefresh = false
} = {}) {
  const templateLabel = approvedOnly ? 'approved WhatsApp templates' : 'WhatsApp templates';
  const wabaId = String(channel.config?.wabaId || '').trim();
  if (!/^\d{5,40}$/.test(wabaId)) throw httpError(409, 'The WhatsApp Business Account ID is not configured.');
  const credentials = await readChannelCredentials(env, channel);
  if (!credentials.accessToken) throw httpError(409, 'The WhatsApp access token is not configured.');
  const version = metaApiVersion(channel.config?.apiVersion);
  const cacheRequest = whatsAppTemplateCacheRequest(channel, wabaId, version, approvedOnly, includeMetadata);
  if (!forceRefresh) {
    const cached = await readWhatsAppTemplateCache(cacheRequest, includeMetadata);
    if (cached.hit) return cached.value;
  }
  const items = [];
  const seen = new Set();
  const maximumPages = approvedOnly ? 3 : 10;
  const maximumItems = maximumPages * 100;
  let after = '';
  let moreAvailable = false;
  for (let page = 0; page < maximumPages && items.length < maximumItems; page++) {
    const endpoint = new URL(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(wabaId)}/message_templates`);
    endpoint.searchParams.set('fields', 'id,name,language,status,category,components');
    if (approvedOnly) endpoint.searchParams.set('status', 'APPROVED');
    endpoint.searchParams.set('limit', '100');
    if (after) endpoint.searchParams.set('after', after);
    let response;
    try {
      response = await fetch(endpoint, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
    } catch {
      throw httpError(502, `Meta could not load ${templateLabel}.`);
    }
    const data = safeJsonParse(await response.text(), {});
    if (!response.ok) {
      const detail = redactProviderSecret(providerError(data, response.status), credentials.accessToken);
      throw httpError(422, `Meta could not load ${templateLabel}: ${detail}`);
    }
    if (!Array.isArray(data.data)) {
      throw httpError(502, 'Meta returned an invalid WhatsApp template response.');
    }
    let discardedCurrentPage = false;
    for (const value of data.data) {
      if (items.length >= maximumItems) {
        discardedCurrentPage = true;
        break;
      }
      const template = sanitizeWhatsAppTemplateDefinition(value);
      if (!template || (approvedOnly && template.status !== 'APPROVED')) continue;
      const key = `${template.name}\n${template.language.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(template);
    }
    const next = typeof data.paging?.cursors?.after === 'string'
      ? data.paging.cursors.after.trim().slice(0, 1024)
      : '';
    const hasNext = (typeof data.paging?.next === 'string' && Boolean(data.paging.next.trim())) || data.data.length === 100;
    moreAvailable = discardedCurrentPage || (hasNext && Boolean(next) && next !== after);
    if (!moreAvailable) break;
    after = next;
  }
  items.sort((left, right) => left.name.localeCompare(right.name) ||
    left.language.code.localeCompare(right.language.code));
  const result = includeMetadata ? { items, truncated: moreAvailable, limit: maximumItems } : items;
  await writeWhatsAppTemplateCache(cacheRequest, result);
  return result;
}

export function whatsAppTemplateCacheRequest(channel, wabaId, version, approvedOnly, includeMetadata) {
  const workspaceId = String(channel?.workspaceId || '').slice(0, 100);
  const channelId = String(channel?.channelId || '').slice(0, 100);
  const url = new URL('/whatsapp/templates', WHATSAPP_TEMPLATE_CACHE_ORIGIN);
  url.searchParams.set('workspace', workspaceId);
  url.searchParams.set('channel', channelId);
  url.searchParams.set('waba', String(wabaId || '').slice(0, 40));
  url.searchParams.set('version', String(version || '').slice(0, 20));
  url.searchParams.set('approved', approvedOnly ? '1' : '0');
  url.searchParams.set('metadata', includeMetadata ? '1' : '0');
  return new Request(url.toString(), { method: 'GET' });
}

function defaultTemplateCache() {
  const cache = globalThis.caches?.default;
  return cache && typeof cache.match === 'function' && typeof cache.put === 'function' ? cache : null;
}

async function readWhatsAppTemplateCache(request, includeMetadata) {
  const cache = defaultTemplateCache();
  if (!cache) return { hit: false, value: null };
  try {
    const response = await cache.match(request);
    if (!response?.ok) return { hit: false, value: null };
    const payload = safeJsonParse(await response.text(), null);
    const value = payload?.value;
    const valid = includeMetadata
      ? isPlainObject(value) && Array.isArray(value.items) && typeof value.truncated === 'boolean'
      : Array.isArray(value);
    return valid ? { hit: true, value } : { hit: false, value: null };
  } catch {
    return { hit: false, value: null };
  }
}

async function writeWhatsAppTemplateCache(request, value) {
  const cache = defaultTemplateCache();
  if (!cache) return;
  try {
    await cache.put(request, new Response(JSON.stringify({ value }), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${WHATSAPP_TEMPLATE_CACHE_SECONDS}`
      }
    }));
  } catch {
    // Cache availability must never prevent the live Meta response from returning.
  }
}

async function listWhatsAppTemplatesByName(env, channel, name) {
  const wabaId = String(channel.config?.wabaId || '').trim();
  if (!/^\d{5,40}$/.test(wabaId)) throw httpError(409, 'The WhatsApp Business Account ID is not configured.');
  const credentials = await readChannelCredentials(env, channel);
  if (!credentials.accessToken) throw httpError(409, 'The WhatsApp access token is not configured.');
  const endpoint = new URL(`https://graph.facebook.com/${encodeURIComponent(metaApiVersion(channel.config?.apiVersion))}/${encodeURIComponent(wabaId)}/message_templates`);
  endpoint.searchParams.set('fields', 'id,name,language,status,category,components');
  endpoint.searchParams.set('name', name);
  endpoint.searchParams.set('limit', '100');
  let response;
  try {
    response = await fetch(endpoint, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
  } catch {
    throw httpError(502, 'Meta could not load the WhatsApp template.');
  }
  const data = safeJsonParse(await response.text(), {});
  if (!response.ok) {
    const detail = redactProviderSecret(providerError(data, response.status), credentials.accessToken);
    throw httpError(422, `Meta could not load the WhatsApp template: ${detail}`);
  }
  if (!Array.isArray(data.data)) throw httpError(502, 'Meta returned an invalid WhatsApp template response.');
  const items = [];
  const seen = new Set();
  for (const value of data.data) {
    const template = sanitizeWhatsAppTemplateDefinition(value);
    if (!template || template.name !== name) continue;
    const key = `${template.name}\n${template.language.code}\n${template.status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(template);
  }
  items.sort((left, right) => left.language.code.localeCompare(right.language.code) ||
    left.status.localeCompare(right.status));
  return items;
}

async function findWhatsAppChannelTemplate(env, channel, name, languageCode) {
  const items = await listWhatsAppTemplatesByName(env, channel, name);
  return items.find(template => template.status === 'APPROVED' && template.language.code === languageCode) || null;
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
  const text = providerMultilineText(value.text, type === 'body' ? 4096 : 1024);
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
  if (!TEMPLATE_BUTTON_TYPES.has(type)) return null;
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

function providerMultilineText(value, maximum) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/\r\n?/g, '\n').replace(/\t/g, ' ')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').trim().slice(0, maximum);
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

async function externalTemplateInboxPresentation(env, channel, template, explicitPreview, mediaPreview = null,
  maximumTextLength = MAX_TEXT_LENGTH) {
  const attachment = templateMediaAttachment(template, mediaPreview);
  let definition = null;
  if (channel.config?.wabaId) {
    try {
      definition = await findWhatsAppChannelTemplate(env, channel, template.name, template.language?.code);
    } catch {
      // Template discovery only improves the local inbox presentation. A
      // catalogue permission/outage must not prevent a valid provider send.
    }
  }
  const rendered = definition ? renderWhatsAppTemplatePresentation(definition, template) : { text: '', buttons: [] };
  const languageCode = String(template.language?.code || '');
  const text = explicitPreview || rendered.text || `Template: ${template.name} (${languageCode})`;
  const templateView = {
    name: template.name,
    language: template.language,
    ...(definition?.templateId ? { templateId: definition.templateId } : {}),
    ...(definition?.category ? { category: definition.category } : {}),
    ...(rendered.buttons.length ? { buttons: rendered.buttons } : {})
  };
  return {
    text: providerMultilineText(text, maximumTextLength),
    storedPayload: { template: templateView, ...(attachment ? { attachment } : {}) }
  };
}

export function renderWhatsAppTemplatePreview(definition, template) {
  return renderWhatsAppTemplatePresentation(definition, template).text;
}

function renderWhatsAppTemplatePresentation(definition, template) {
  if (!isPlainObject(definition) || !isPlainObject(template)) return { text: '', buttons: [] };
  const requestComponents = Array.isArray(template.components) ? template.components : [];
  const componentParameters = (type, buttonIndex = null) => {
    const match = requestComponents.find(component => {
      if (!isPlainObject(component) || String(component.type || '').toLowerCase() !== type) return false;
      return type !== 'button' || Number(component.index) === Number(buttonIndex);
    });
    return Array.isArray(match?.parameters) ? match.parameters : [];
  };
  const parts = [];
  const buttons = [];
  for (const component of Array.isArray(definition.components) ? definition.components : []) {
    if (!isPlainObject(component)) continue;
    const type = String(component.type || '').toLowerCase();
    if (type === 'header') {
      const parameters = componentParameters('header');
      if (String(component.format || '').toLowerCase() === 'location') {
        const location = parameters.find(parameter => String(parameter?.type || '').toLowerCase() === 'location')?.location;
        const locationText = whatsappTemplateLocationPreview(location);
        if (locationText) parts.push(`Location: ${locationText}`);
      } else if (component.text) {
        parts.push(replaceWhatsAppTemplatePreviewVariables(component.text, parameters));
      }
    } else if (type === 'body' && component.text) {
      parts.push(replaceWhatsAppTemplatePreviewVariables(component.text, componentParameters('body')));
    } else if (type === 'footer' && component.text) {
      parts.push(String(component.text));
    } else if (type === 'buttons') {
      const componentButtons = Array.isArray(component.buttons) ? component.buttons : [];
      for (let buttonIndex = 0; buttonIndex < componentButtons.length; buttonIndex++) {
        const button = componentButtons[buttonIndex];
        const label = providerText(button?.text || button?.type, 100);
        const buttonType = String(button?.type || '').toLowerCase();
        if (label && TEMPLATE_BUTTON_TYPES.has(buttonType)) buttons.push({ type: buttonType, text: label });
      }
    }
  }
  if (buttons.length) parts.push(`Actions: ${buttons.map(button => button.text).join(', ')}`);
  return {
    text: providerMultilineText(parts.filter(Boolean).join('\n'), MAX_TEXT_LENGTH),
    buttons
  };
}

function replaceWhatsAppTemplatePreviewVariables(text, parameters) {
  const items = Array.isArray(parameters) ? parameters : [];
  const values = items.map(whatsappTemplateParameterPreview);
  const named = new Map();
  for (let index = 0; index < items.length; index++) {
    const name = providerIdentifier(items[index]?.parameter_name, 100);
    if (name) named.set(name, values[index]);
  }
  let fallbackIndex = 0;
  return String(text || '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, rawKey) => {
    const key = String(rawKey || '').trim();
    let value = named.get(key);
    if (value === undefined && /^\d+$/.test(key)) value = values[Number(key) - 1];
    if (value === undefined) value = values[fallbackIndex++];
    return value === undefined || value === '' ? match : value;
  });
}

function whatsappTemplateParameterPreview(parameter) {
  if (!isPlainObject(parameter)) return '';
  const type = String(parameter.type || '').toLowerCase();
  if (type === 'text') return providerMultilineText(parameter.text, 1024);
  if (type === 'currency' && isPlainObject(parameter.currency)) {
    const fallback = providerText(parameter.currency.fallback_value, 256);
    if (fallback) return fallback;
    const code = providerText(parameter.currency.code, 12);
    const amount = Number(parameter.currency.amount_1000);
    return [code, Number.isFinite(amount) ? String(amount / 1000) : ''].filter(Boolean).join(' ');
  }
  if (type === 'date_time' && isPlainObject(parameter.date_time)) {
    return providerText(parameter.date_time.fallback_value, 256);
  }
  if (type === 'coupon_code') return providerText(parameter.coupon_code, 256);
  if (type === 'payload') return providerText(parameter.payload, 256);
  return '';
}

function whatsappTemplateLocationPreview(location) {
  if (!isPlainObject(location)) return '';
  const name = providerText(location.name, 256);
  const address = providerText(location.address, 512);
  if (name || address) return [name, address].filter(Boolean).join(' · ');
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? `${latitude}, ${longitude}` : '';
}

async function createConversationTemplateMessage(env, workspaceId, conversationId, payload, principal) {
  if (!isPlainObject(payload)) throw httpError(400, 'Template payload must be an object.');
  rejectUnknownKeys(payload, new Set(['name', 'language', 'components', 'previewText', 'mediaPreview',
    'channelId', 'identityId', 'contactIdentityId']), 'template request');
  await assertConversationChannelAccess(env, workspaceId, conversationId, principal);
  const target = await conversationDeliveryTarget(env, workspaceId, conversationId, payload);
  assertPrincipalChannelAccess(principal, target.channel_id);
  if (target.connectorType !== 'whatsapp_cloud') throw httpError(409, 'Templates are available only for WhatsApp conversations.');
  if (!target.enabled) throw httpError(409, 'The WhatsApp channel is disabled.');
  const template = validateWhatsAppTemplate({
    name: payload.name,
    language: payload.language,
    ...(payload.components === undefined ? {} : { components: payload.components })
  });
  const requestedPreview = payload.previewText === undefined
    ? ''
    : cleanPreviewText(payload.previewText, MAX_TEMPLATE_PREVIEW_LENGTH);
  const mediaPreview = validateTemplateMediaPreview(payload.mediaPreview);
  const requestedAttachment = templateMediaAttachment(template, mediaPreview);
  if (mediaPreview && !requestedAttachment) throw httpError(400, 'Media preview metadata requires a template media header.');
  const presentation = await externalTemplateInboxPresentation(env, target.channel, template, requestedPreview,
    mediaPreview, MAX_TEMPLATE_PREVIEW_LENGTH);
  const sender = outboundSenderAttribution(principal);
  const senderName = sender.name;
  const previewText = presentation.text;
  const now = new Date().toISOString();
  const messageId = crypto.randomUUID();
  const storedPayload = { ...presentation.storedPayload, senderName };
  const encryptedPayload = await encryptOutboundPayload({ template }, env.CHANNEL_CREDENTIALS_KEY, workspaceId, messageId);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO messages (message_id,conversation_id,contact_id,channel_id,identity_id,direction,message_type,text,
        status,timestamp,payload_json,workspace_id,sender_login,sender_name)
      VALUES (?1,?2,?3,?4,?5,'outbound','template',?6,'pending',?7,?8,?9,?10,?11)`)
      .bind(messageId, conversationId, target.contact_id, target.channel_id, target.identity_id, previewText, now,
        JSON.stringify(storedPayload), workspaceId, sender.login, sender.name),
    env.DB.prepare(`INSERT INTO outbound_payloads (message_id,workspace_id,encrypted_payload,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?4)`).bind(messageId, workspaceId, encryptedPayload, now),
    env.DB.prepare(`INSERT INTO outbox (outbox_id,message_id,attempts,max_attempts,next_attempt_at,status,last_error,created_at,updated_at,workspace_id)
      VALUES (?1,?2,0,6,?3,'pending','',?4,?4,?5)`)
      .bind(crypto.randomUUID(), messageId, now, now, workspaceId),
    env.DB.prepare(`UPDATE conversations SET channel_id=?3,identity_id=?4,last_message_at=?5,updated_at=?5
      WHERE conversation_id=?1 AND workspace_id=?2`)
      .bind(conversationId, workspaceId, target.channel_id, target.identity_id, now)
  ]);
  await touchIdentityBinding(env, workspaceId, target.identity_id, target.channel_id, 'outbound', conversationId, now);
  await audit(env, principal, 'send_template', 'conversation', conversationId, {
    channelId: target.channel_id, messageId, templateName: template.name, senderName
  });
  return { message: {
    messageId, conversationId, channelId: target.channel_id, contactIdentityId: target.identity_id,
    identityId: target.identity_id, direction: 'outbound', messageType: 'template',
    text: previewText, status: 'pending', timestamp: now, senderName,
    template: templateMessageView(storedPayload),
    attachment: messageAttachmentView('template', storedPayload, messageId),
    connectorType: target.connectorType, channelName: target.channel_name || '',
    channelProfileId: target.channel_profile_id || ''
  } };
}

function validateTemplateMediaPreview(value) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) throw httpError(400, 'Template media preview must be an object.');
  rejectUnknownKeys(value, new Set(['filename', 'mimeType', 'size']), 'template media preview');
  const filename = value.filename === undefined ? '' : cleanOptionalText(value.filename, 'Template media filename', 240);
  const mimeType = value.mimeType === undefined ? '' : cleanOptionalText(value.mimeType, 'Template media MIME type', 160).toLowerCase();
  if (mimeType && !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(mimeType)) {
    throw httpError(400, 'Template media MIME type is invalid.');
  }
  const size = value.size === undefined ? 0 : Number(value.size);
  if (!Number.isFinite(size) || size < 0 || size > MAX_ATTACHMENT_BYTES) throw httpError(400, 'Template media size is invalid.');
  return { filename, mimeType, size: Math.floor(size) };
}

function templateMediaAttachment(template, preview) {
  for (const component of Array.isArray(template?.components) ? template.components : []) {
    if (String(component?.type || '').toLowerCase() !== 'header') continue;
    for (const parameter of Array.isArray(component.parameters) ? component.parameters : []) {
      const type = String(parameter?.type || '').toLowerCase();
      if (!['image', 'video', 'document'].includes(type)) continue;
      const media = parameter?.[type];
      if (!isPlainObject(media)) continue;
      const providerMediaId = String(media.id || '').trim();
      let externalUrl = '';
      if (!providerMediaId && media.link) {
        validatePublicHttpsMediaUrl(media.link, `template ${type}`);
        externalUrl = new URL(String(media.link)).toString();
      }
      if (!providerMediaId && !externalUrl) continue;
      let filename = preview?.filename || '';
      if (!filename && externalUrl) {
        try { filename = decodeURIComponent(new URL(externalUrl).pathname.split('/').filter(Boolean).at(-1) || ''); } catch {}
      }
      return {
        type,
        filename: safeAttachmentFilename(filename || `${type}-template-media`),
        mimeType: preview?.mimeType || '',
        size: Number(preview?.size || 0),
        caption: '',
        ...(providerMediaId ? { providerMediaId } : { externalUrl })
      };
    }
  }
  return null;
}

async function createConversationAttachmentMessage(env, workspaceId, conversationId, request, principal) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) throw httpError(415, 'Content-Type must be multipart/form-data.');
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ATTACHMENT_BYTES + 1024 * 1024) {
    throw httpError(413, 'Attachment request is too large.');
  }
  let form;
  try { form = await request.formData(); } catch { throw httpError(400, 'Multipart attachment data is invalid.'); }
  await assertConversationChannelAccess(env, workspaceId, conversationId, principal);
  const target = await conversationDeliveryTarget(env, workspaceId, conversationId, {
    channelId: form.get('channelId'), identityId: form.get('identityId') || form.get('contactIdentityId'),
    replyToMessageId: form.get('replyToMessageId')
  });
  assertPrincipalChannelAccess(principal, target.channel_id);
  if (!['whatsapp_cloud', 'telegram'].includes(target.connectorType)) {
    throw httpError(409, 'Attachments are currently available for WhatsApp and Telegram conversations.');
  }
  if (!target.enabled) throw httpError(409, 'The channel is disabled.');
  assertFreeformReplyAllowed(target.connectorType, target.last_inbound_at);
  const file = form.get('file');
  if (!file || typeof file !== 'object' || typeof file.arrayBuffer !== 'function') throw httpError(400, 'A file field is required.');
  const attachment = validateWhatsAppAttachment(file, form.get('caption'), target.connectorType);
  if (target.connectorType === 'whatsapp_cloud' && attachment.type === 'audio' && attachment.caption) {
    throw httpError(400, 'WhatsApp audio messages do not support captions. Remove the text or send it as a separate message.');
  }
  const sender = outboundSenderAttribution(principal);
  const senderName = sender.name;
  const reply = await resolveReplyTarget(env, workspaceId, conversationId, target.channel_id,
    target.connectorType, form.get('replyToMessageId'));
  const now = new Date().toISOString();
  const messageId = crypto.randomUUID();
  const preview = attachment.caption || `[${attachment.type}: ${attachment.filename}]`;
  const attachmentPayload = (safeAttachment) => ({
    attachment: safeAttachment, senderName, ...(reply ? { reply } : {})
  });
  if (target.connectorType === 'telegram') {
    let safeAttachment = { ...attachment };
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO messages (message_id,conversation_id,contact_id,channel_id,identity_id,direction,message_type,text,
          provider_message_id,status,timestamp,payload_json,workspace_id,sender_login,sender_name)
        VALUES (?1,?2,?3,?4,?5,'outbound',?6,?7,'','pending',?8,?9,?10,?11,?12)`)
        .bind(messageId, conversationId, target.contact_id, target.channel_id, target.identity_id, attachment.type, preview, now,
          JSON.stringify(attachmentPayload(safeAttachment)), workspaceId, sender.login, sender.name),
      env.DB.prepare(`UPDATE conversations SET channel_id=?3,identity_id=?4,last_message_at=?5,updated_at=?5
        WHERE conversation_id=?1 AND workspace_id=?2`)
        .bind(conversationId, workspaceId, target.channel_id, target.identity_id, now)
    ]);
    await touchIdentityBinding(env, workspaceId, target.identity_id, target.channel_id, 'outbound', conversationId, now);
    let sent;
    try {
      sent = await sendTelegramMedia(env, target.channel, target.channel_profile_id, file, attachment,
        reply?.channelMessageId || '');
      safeAttachment = { ...attachment, providerFileId: sent.providerFileId };
      await persistTelegramAttachmentSuccess(env, workspaceId, messageId, sent, safeAttachment, reply, senderName);
    } catch (error) {
      const failure = cleanError(error);
      let failurePersisted = false;
      try {
        await env.DB.prepare(`UPDATE messages SET status='failed',error=?2 WHERE message_id=?1 AND workspace_id=?3`)
          .bind(messageId, failure, workspaceId).run();
        failurePersisted = true;
      } catch (persistenceError) {
        console.error('telegram_attachment_failure_persist_failed', {
          messageId, workspaceId, error: cleanError(persistenceError)
        });
      }
      if (!failurePersisted) throw error;
      await auditAttachmentBestEffort(env, principal, conversationId, {
        channelId: target.channel_id, messageId, type: attachment.type, mimeType: attachment.mimeType,
        size: attachment.size, status: 'failed', senderName
      });
      return { message: {
        messageId, conversationId, channelId: target.channel_id, direction: 'outbound', messageType: attachment.type,
        text: preview, status: 'failed', error: failure, timestamp: now, channelMessageId: '', senderName,
        attachment: messageAttachmentView(attachment.type, attachmentPayload(safeAttachment), messageId), reply: reply || null,
        connectorType: target.connectorType, channelName: target.channel_name || '', channelProfileId: target.channel_profile_id || ''
      } };
    }
    await auditAttachmentBestEffort(env, principal, conversationId, {
      channelId: target.channel_id, messageId, type: attachment.type, mimeType: attachment.mimeType, size: attachment.size,
      senderName
    });
    return { message: {
      messageId, conversationId, channelId: target.channel_id, direction: 'outbound', messageType: attachment.type,
      text: preview, status: sent.status, timestamp: now, channelMessageId: sent.providerMessageId, senderName,
      attachment: messageAttachmentView(attachment.type, attachmentPayload(safeAttachment), messageId), reply: reply || null,
      connectorType: target.connectorType, channelName: target.channel_name || '', channelProfileId: target.channel_profile_id || ''
    } };
  }

  const providerMediaId = await uploadWhatsAppMedia(env, target.channel, file, attachment);
  const encryptedPayload = await encryptOutboundPayload({ media: { ...attachment, id: providerMediaId } },
    env.CHANNEL_CREDENTIALS_KEY, workspaceId, messageId);
  const safeAttachment = { ...attachment, providerMediaId };
  const statements = [env.DB.prepare(`INSERT INTO messages (message_id,conversation_id,contact_id,channel_id,identity_id,direction,message_type,text,
      provider_message_id,status,timestamp,payload_json,workspace_id,sender_login,sender_name)
    VALUES (?1,?2,?3,?4,?5,'outbound',?6,?7,'','pending',?8,?9,?10,?11,?12)`)
    .bind(messageId, conversationId, target.contact_id, target.channel_id, target.identity_id, attachment.type, preview,
      now, JSON.stringify(attachmentPayload(safeAttachment)), workspaceId, sender.login, sender.name),
    env.DB.prepare(`INSERT INTO outbound_payloads (message_id,workspace_id,encrypted_payload,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?4)`).bind(messageId, workspaceId, encryptedPayload, now),
    env.DB.prepare(`INSERT INTO outbox (outbox_id,message_id,attempts,max_attempts,next_attempt_at,status,last_error,created_at,updated_at,workspace_id)
      VALUES (?1,?2,0,6,?3,'pending','',?4,?4,?5)`)
      .bind(crypto.randomUUID(), messageId, now, now, workspaceId),
    env.DB.prepare(`UPDATE conversations SET channel_id=?3,identity_id=?4,last_message_at=?5,updated_at=?5
      WHERE conversation_id=?1 AND workspace_id=?2`)
      .bind(conversationId, workspaceId, target.channel_id, target.identity_id, now)
  ];
  await env.DB.batch(statements);
  await touchIdentityBinding(env, workspaceId, target.identity_id, target.channel_id, 'outbound', conversationId, now);
  await auditAttachmentBestEffort(env, principal, conversationId, {
    channelId: target.channel_id, messageId, type: attachment.type, mimeType: attachment.mimeType, size: attachment.size,
    senderName
  });
  return { message: {
    messageId, conversationId, channelId: target.channel_id, direction: 'outbound', messageType: attachment.type,
    text: preview, status: 'pending', timestamp: now, channelMessageId: '', senderName,
    attachment: messageAttachmentView(attachment.type, attachmentPayload(safeAttachment), messageId), reply: reply || null,
    connectorType: target.connectorType, channelName: target.channel_name || '', channelProfileId: target.channel_profile_id || ''
  } };
}

async function persistTelegramAttachmentSuccess(env, workspaceId, messageId, sent, attachment, reply = null, senderName = '') {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await env.DB.prepare(`UPDATE messages SET provider_message_id=?2,status=?3,payload_json=?4,error=''
        WHERE message_id=?1 AND workspace_id=?5`).bind(messageId, sent.providerMessageId, sent.status,
          JSON.stringify({
            attachment,
            ...(senderName ? { senderName } : {}),
            ...(reply ? { reply } : {})
          }), workspaceId).run();
      return true;
    } catch (error) {
      lastError = error;
    }
  }
  console.error('telegram_attachment_success_persist_failed', {
    messageId, workspaceId, error: cleanError(lastError)
  });
  return false;
}

async function auditAttachmentBestEffort(env, principal, conversationId, details) {
  try {
    await audit(env, principal, 'send_attachment', 'conversation', conversationId, details);
  } catch (error) {
    console.error('attachment_audit_failed', {
      conversationId, messageId: details?.messageId || '', error: cleanError(error)
    });
  }
}

function validateWhatsAppAttachment(file, captionValue, connectorType = 'whatsapp_cloud') {
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
  if (!type) throw httpError(415, 'This file type is not supported for chat attachments.');
  if (connectorType === 'whatsapp_cloud' && mimeType === 'image/webp') {
    throw httpError(415, 'WhatsApp image attachments must be JPEG or PNG.');
  }
  const size = Number(file.size || 0);
  if (!Number.isFinite(size) || size <= 0) throw httpError(400, 'The attachment is empty.');
  const maximum = connectorType === 'whatsapp_cloud' && type === 'image'
    ? WHATSAPP_IMAGE_MAX_BYTES : MAX_ATTACHMENT_BYTES;
  if (size > maximum) {
    const provider = connectorType === 'telegram' ? 'Telegram' : 'WhatsApp';
    throw httpError(413, `${provider} ${type} attachments may not exceed ${Math.round(maximum / (1024 * 1024))} MB.`);
  }
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

async function uploadConversationTemplateMedia(env, workspaceId, conversationId, request) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) throw httpError(415, 'Content-Type must be multipart/form-data.');
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ATTACHMENT_BYTES + 1024 * 1024) {
    throw httpError(413, 'Template media request is too large.');
  }
  let form;
  try { form = await request.formData(); } catch { throw httpError(400, 'Multipart template media is invalid.'); }
  const target = await conversationDeliveryTarget(env, workspaceId, conversationId, {
    channelId: form.get('channelId'), identityId: form.get('identityId') || form.get('contactIdentityId')
  });
  if (target.connectorType !== 'whatsapp_cloud') throw httpError(409, 'Template media is available only for WhatsApp conversations.');
  if (!target.enabled) throw httpError(409, 'The WhatsApp channel is disabled.');
  const file = form.get('file');
  if (!file || typeof file !== 'object' || typeof file.arrayBuffer !== 'function') throw httpError(400, 'A file field is required.');
  const expectedType = String(form.get('type') || '').toLowerCase();
  if (!['image', 'video', 'document'].includes(expectedType)) throw httpError(400, 'Template media type must be image, video, or document.');
  const attachment = validateWhatsAppAttachment(file, '');
  if (attachment.type !== expectedType) throw httpError(415, `The selected file is not valid ${expectedType} media.`);
  const mediaId = await uploadWhatsAppMedia(env, target.channel, file, attachment);
  return {
    ok: true, mediaId, type: attachment.type, filename: attachment.filename,
    mimeType: attachment.mimeType, size: attachment.size
  };
}

async function streamMessageAttachment(env, workspaceId, messageId, request, url, principal = null) {
  const row = await env.DB.prepare(`SELECT m.message_id,m.message_type,m.payload_json,m.channel_id,c.connector_type,c.provider_type,
      c.config_json,c.secret_key,c.workspace_id
    FROM messages m JOIN channels c ON c.channel_id=m.channel_id AND c.workspace_id=m.workspace_id
    WHERE m.message_id=?1 AND m.workspace_id=?2`).bind(messageId, workspaceId).first();
  if (!row) throw httpError(404, 'Attachment not found.');
  if (principal) assertPrincipalChannelAccess(principal, row.channel_id);
  const attachment = safeJsonParse(row.payload_json, {})?.attachment;
  const attachmentType = String(row.message_type || '') === 'template'
    ? String(attachment?.type || '') : String(row.message_type || '');
  if (!attachment || !['image', 'video', 'audio', 'document'].includes(attachmentType)) {
    throw httpError(404, 'Attachment not found.');
  }
  const channel = {
    channelId: row.channel_id,
    connectorType: logicalConnectorType(row),
    config: safeJsonParse(row.config_json, {}),
    secretKey: row.secret_key,
    workspaceId: row.workspace_id
  };
  let providerResponse;
  const range = request.headers.get('Range') || '';
  if (channel.connectorType === 'whatsapp_cloud') {
    const mediaId = String(attachment.providerMediaId || '');
    if (!mediaId) throw httpError(410, 'This WhatsApp attachment is no longer available.');
    const credentials = await readChannelCredentials(env, channel);
    if (!credentials.accessToken) throw httpError(409, 'WhatsApp credentials are not configured.');
    const version = metaApiVersion(channel.config?.apiVersion);
    const infoResponse = await fetch(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${credentials.accessToken}` }
    });
    const info = safeJsonParse(await infoResponse.text(), {});
    if (!infoResponse.ok || !info.url) throw httpError(502, `WhatsApp media is unavailable: ${providerError(info, infoResponse.status)}`);
    const mediaUrl = new URL(String(info.url));
    if (mediaUrl.protocol !== 'https:' || !isMetaMediaHost(mediaUrl.hostname)) throw httpError(502, 'WhatsApp returned an invalid media location.');
    providerResponse = await fetch(mediaUrl, { headers: {
      Authorization: `Bearer ${credentials.accessToken}`, ...(range ? { Range: range } : {})
    } });
  } else if (channel.connectorType === 'telegram') {
    const fileId = String(attachment.providerFileId || '');
    if (!fileId) throw httpError(410, 'This Telegram attachment is no longer available.');
    const credentials = await readChannelCredentials(env, channel);
    if (!credentials.botToken) throw httpError(409, 'Telegram credentials are not configured.');
    const infoResponse = await fetch(`https://api.telegram.org/bot${credentials.botToken}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const info = safeJsonParse(await infoResponse.text(), {});
    if (!infoResponse.ok || info.ok === false || !info.result?.file_path) {
      throw httpError(502, `Telegram media is unavailable: ${providerError(info, infoResponse.status)}`);
    }
    const filePath = String(info.result.file_path);
    if (!/^[A-Za-z0-9_./-]{1,500}$/.test(filePath) || filePath.includes('..')) throw httpError(502, 'Telegram returned an invalid media location.');
    providerResponse = await fetch(`https://api.telegram.org/file/bot${credentials.botToken}/${filePath}`, {
      headers: range ? { Range: range } : {}
    });
  } else {
    throw httpError(409, 'This provider does not expose protected attachment previews.');
  }
  if (!providerResponse.ok || !providerResponse.body) throw httpError(502, 'The provider could not return this attachment.');
  const filename = safeAttachmentFilename(attachment.filename || `${attachmentType}-attachment`);
  const requestedDownload = url.searchParams.get('download') === '1';
  const mimeType = safeInlineAttachmentMime(attachmentType, attachment.mimeType, providerResponse.headers.get('Content-Type'));
  const inline = !requestedDownload && attachmentType !== 'document' && Boolean(mimeType);
  const headers = new Headers({
    'Content-Type': mimeType || 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
    'Cache-Control': 'private, max-age=300',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'X-Content-Type-Options': 'nosniff'
  });
  const length = providerResponse.headers.get('Content-Length');
  if (length) headers.set('Content-Length', length);
  for (const name of ['Accept-Ranges', 'Content-Range']) {
    const value = providerResponse.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(providerResponse.body, { status: providerResponse.status, headers });
}

function isMetaMediaHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'lookaside.fbsbx.com' || host.endsWith('.fbcdn.net') || host === 'facebook.com' || host.endsWith('.facebook.com');
}

function safeInlineAttachmentMime(messageType, storedMime, providerMime) {
  const candidate = String(storedMime || providerMime || '').toLowerCase().split(';', 1)[0].trim();
  const allowed = {
    image: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    video: new Set(['video/mp4', 'video/3gpp', 'video/webm']),
    audio: new Set(['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg'])
  };
  return allowed[String(messageType || '')]?.has(candidate) ? candidate : '';
}

function safeAttachmentFilename(value) {
  return String(value || 'attachment').replace(/[^\x20-\x7e]+/g, '_').replace(/["\\/]+/g, '_').trim().slice(0, 180) || 'attachment';
}

function messageAttachmentView(messageType, payload, messageId = '') {
  const value = payload?.attachment;
  if (!value || typeof value !== 'object') return null;
  const type = String(messageType || '') === 'template' ? String(value.type || '') : String(messageType || '');
  if (!['image', 'video', 'audio', 'document'].includes(type)) return null;
  const externalUrl = safeStoredExternalMediaUrl(value.externalUrl);
  const available = Boolean(value.providerMediaId || value.providerFileId || externalUrl);
  return {
    type,
    filename: String(value.filename || ''),
    mimeType: String(value.mimeType || ''),
    size: Number(value.size || 0),
    caption: String(value.caption || ''),
    available,
    external: Boolean(externalUrl),
    url: externalUrl || (available && messageId ? `/api/messages/${encodeURIComponent(messageId)}/attachment` : '')
  };
}

function safeStoredExternalMediaUrl(value) {
  if (!value) return '';
  try {
    validatePublicHttpsMediaUrl(value, 'stored template media');
    return new URL(String(value)).toString();
  } catch { return ''; }
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
    const message = await env.DB.prepare(`SELECT workspace_id,conversation_id,status,provider_message_id
      FROM messages WHERE message_id=?1`).bind(messageId).first();
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
      await broadcastMessageStatusChanges(env, message.workspace_id, [{
        messageId, conversationId: message.conversation_id, status: 'failed', error: cleanError(error),
        channelMessageId: String(message.provider_message_id || '')
      }]);
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
    await broadcastMessageStatusChanges(env, message.workspace_id, [{
      messageId, conversationId: message.conversation_id, status: 'retrying', error: cleanError(error),
      channelMessageId: String(message.provider_message_id || '')
    }]);
  }
}

async function dispatchOutbound(env, messageId) {
  const row = await env.DB.prepare(`SELECT m.*,c.config_json,c.connector_type,c.provider_type,c.secret_key,c.enabled,
      COALESCE(b.scoped_profile_id,'') AS channel_profile_id,
      COALESCE(NULLIF(m.identity_id,''),NULLIF(cv.identity_id,''),'') AS delivery_identity_id,cv.contact_id
      FROM messages m JOIN channels c ON c.channel_id=m.channel_id
      AND c.workspace_id=m.workspace_id JOIN conversations cv ON cv.conversation_id=m.conversation_id AND cv.workspace_id=m.workspace_id
      LEFT JOIN channel_identity_bindings b ON b.workspace_id=m.workspace_id
        AND b.identity_id=COALESCE(NULLIF(m.identity_id,''),NULLIF(cv.identity_id,''),'')
        AND b.channel_id=m.channel_id AND b.active=1
      WHERE m.message_id=?1`).bind(messageId).first();
  if (!row) throw new Error('Outbound message not found.');
  // Ambiguous legacy conversations intentionally keep an empty identity_id.
  // Never guess a destination from the first legacy channel_identity: queued
  // or retried messages must fail closed until migration resolves the identity.
  if (!row.delivery_identity_id) throw nonRetryableError('Outbound identity is unresolved.');
  if (!row.channel_profile_id) throw nonRetryableError('Outbound channel route is unavailable.');
  if (!row.enabled) throw new Error('Channel is disabled.');
  const channel = {
    channelId: row.channel_id,
    workspaceId: row.workspace_id,
    connectorType: logicalConnectorType(row),
    config: safeJsonParse(row.config_json, {}),
    secretKey: row.secret_key
  };
  assertManagedOutboundVerified(channel);
  const messagePayload = safeJsonParse(row.payload_json, {});
  const replyChannelMessageId = String(messagePayload?.reply?.channelMessageId || '');
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
    result = await sendWhatsAppMedia(env, channel, row.channel_profile_id, outbound.media, messageId, replyChannelMessageId);
  } else if (channel.connectorType === 'whatsapp_cloud') {
    result = await sendWhatsApp(env, channel, row.channel_profile_id, row.text, replyChannelMessageId, messageId);
  } else if (channel.connectorType === 'telegram') {
    result = await sendTelegram(env, channel, row.channel_profile_id, row.text, replyChannelMessageId);
  } else if (channel.connectorType === 'instagram') result = await sendInstagram(env, channel, row.channel_profile_id, row.text);
  else if (channel.connectorType === 'generic_http') result = await sendGeneric(env, channel, row);
  else if (channel.connectorType === 'web_chat') result = { status: 'sent', providerMessageId: row.message_id, httpStatus: 200 };
  else throw new Error(`Outbound connector ${channel.connectorType} is not implemented yet.`);
  return { ...result, workspaceId: row.workspace_id };
}

function assertManagedOutboundVerified(channel) {
  if (!MANAGED_CONNECTORS.has(channel.connectorType)) return;
  const config = channel.config || {};
  const verifiedAt = String(config.credentialsVerifiedAt || '').trim();
  const verifiedProviderId = String(config.verifiedProviderId || '').trim();
  if (!verifiedAt || !verifiedProviderId) {
    throw nonRetryableError('Channel credentials must be verified before sending messages.');
  }
  const configuredProviderId = channel.connectorType === 'whatsapp_cloud'
    ? String(config.phoneNumberId || '').trim()
    : channel.connectorType === 'instagram'
      ? String(config.instagramAccountId || '').trim()
      : '';
  if (configuredProviderId && configuredProviderId !== verifiedProviderId) {
    throw nonRetryableError('The verified provider identity does not match the channel configuration.');
  }
}

async function sendWhatsApp(env, channel, recipient, text, replyChannelMessageId = '', messageId = '') {
  const credentials = await readChannelCredentials(env, channel);
  const token = credentials.accessToken;
  const phoneNumberId = channel.config?.phoneNumberId;
  if (!token || !phoneNumberId) throw nonRetryableError('WhatsApp credentials are not configured.');
  const normalizedRecipient = normalizeWhatsAppRecipient(recipient);
  const version = metaApiVersion(channel.config?.apiVersion);
  const body = {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: normalizedRecipient,
    type: 'text', text: { preview_url: false, body: text },
    ...(replyChannelMessageId ? { context: { message_id: String(replyChannelMessageId) } } : {}),
    ...(messageId ? { biz_opaque_callback_data: String(messageId).slice(0, 512) } : {})
  };
  const response = await fetch(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
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

async function sendWhatsAppMedia(env, channel, recipient, media, messageId, replyChannelMessageId = '') {
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
    biz_opaque_callback_data: String(messageId).slice(0, 512),
    ...(replyChannelMessageId ? { context: { message_id: String(replyChannelMessageId) } } : {})
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
      size: Number(media.size || 0), caption: String(media.caption || ''), providerMediaId: String(media.id)
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

async function sendTelegram(env, channel, chatId, text, replyChannelMessageId = '') {
  const credentials = await readChannelCredentials(env, channel);
  const token = credentials.botToken;
  if (!token) throw nonRetryableError('Telegram bot token is not configured.');
  const body = { chat_id: chatId, text };
  if (replyChannelMessageId) body.reply_parameters = { message_id: Number(replyChannelMessageId) };
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
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

async function sendTelegramMedia(env, channel, chatId, file, attachment, replyChannelMessageId = '') {
  const credentials = await readChannelCredentials(env, channel);
  const token = credentials.botToken;
  if (!token) throw nonRetryableError('Telegram bot token is not configured.');
  const telegramPhoto = attachment.type === 'image' &&
    ['image/jpeg', 'image/png'].includes(attachment.mimeType) && attachment.size <= TELEGRAM_PHOTO_MAX_BYTES;
  const voice = attachment.type === 'audio' && attachment.mimeType === 'audio/ogg';
  const method = telegramPhoto ? 'sendPhoto'
    : attachment.type === 'video' ? 'sendVideo'
      : voice ? 'sendVoice' : attachment.type === 'audio' ? 'sendAudio' : 'sendDocument';
  const field = telegramPhoto ? 'photo'
    : attachment.type === 'video' ? 'video' : voice ? 'voice' : attachment.type === 'audio' ? 'audio' : 'document';
  const body = new FormData();
  body.set('chat_id', String(chatId));
  if (replyChannelMessageId) body.set('reply_parameters', JSON.stringify({ message_id: Number(replyChannelMessageId) }));
  body.set(field, file, attachment.filename);
  if (attachment.caption) body.set('caption', attachment.caption);
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body });
  const data = safeJsonParse(await response.text(), {});
  if (!response.ok || data.ok === false) {
    const error = new Error(`Telegram API: ${providerError(data, response.status)}`);
    error.retryable = isRetryableProviderStatus(response.status);
    throw error;
  }
  const sent = data.result || {};
  const providerFileId = telegramPhoto
    ? String(sent.photo?.at?.(-1)?.file_id || '')
    : String((voice ? sent.voice : sent[attachment.type])?.file_id || sent.document?.file_id || '');
  return {
    status: 'sent', providerMessageId: String(sent.message_id || ''), providerFileId,
    httpStatus: response.status
  };
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
  // Keep the original payload_json (senderName, reply, template, attachment).
  // Provider send results only update status / provider_message_id — never wipe
  // outbound attribution by replacing the stored presentation payload.
  const deliveryStatus = result.status || 'submitted';
  await env.DB.batch([
    env.DB.prepare(`UPDATE messages SET
        status=CASE WHEN status IN ('sent','delivered','read','failed') THEN status ELSE ?2 END,
        provider_message_id=CASE WHEN provider_message_id='' THEN ?3 ELSE provider_message_id END,
        error=CASE WHEN status='failed' THEN error ELSE '' END
      WHERE message_id=?1`)
      .bind(messageId, deliveryStatus, result.providerMessageId || ''),
    env.DB.prepare('DELETE FROM outbox WHERE message_id=?1').bind(messageId),
    env.DB.prepare('DELETE FROM outbound_payloads WHERE message_id=?1').bind(messageId)
  ]);
  const stored = await env.DB.prepare(`SELECT conversation_id,status,error,provider_message_id,payload_json
    FROM messages WHERE message_id=?1`).bind(messageId).first();
  const statusHistory = await persistMessageStatusHistory(env, stored, deliveryStatus, new Date().toISOString());
  await broadcastMessageStatusChanges(env, result.workspaceId, [{
    messageId, conversationId: stored?.conversation_id,
    status: stored?.status || deliveryStatus, error: stored?.error || '',
    channelMessageId: String(stored?.provider_message_id || result.providerMessageId || ''),
    ...(statusHistory ? { statusHistory } : {})
  }]);
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
      const latest = await env.DB.prepare(`SELECT conversation_id,status,provider_message_id
        FROM messages WHERE message_id=?1`).bind(job.message_id).first();
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
      await broadcastMessageStatusChanges(env, job.workspace_id, [{
        messageId: job.message_id, conversationId: latest?.conversation_id,
        status: exhausted ? 'failed' : 'retrying', error: cleanError(error),
        channelMessageId: String(latest?.provider_message_id || '')
      }]);
    }
  }
}

async function storeInbound(env, channel, event, rawPayload) {
  if (!event.channelProfileId || (!event.text && !event.providerMessageId)) return false;
  const providerEventKey = String(event.dedupeKey || event.providerMessageId || await hashText(JSON.stringify(event)));
  const eventKey = `${channel.workspaceId}:${channel.channelId}:message:${providerEventKey}`;
  const dedupe = await env.DB.prepare(`INSERT OR IGNORE INTO webhook_events (event_key,channel_id,event_type,received_at,workspace_id)
    VALUES (?1,?2,'message',?3,?4)`).bind(eventKey, channel.channelId, new Date().toISOString(), channel.workspaceId).run();
  if (!dedupe.meta?.changes) return false;
  try {
  const now = new Date().toISOString();
  const timestamp = normalizeTimestamp(event.timestamp, now);
  const profileId = String(event.channelProfileId);
  const platform = platformForChannel(channel);
  let identity = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id,c.display_name AS contact_display_name
    FROM channel_identity_bindings b
    JOIN contact_identities ci ON ci.identity_id=b.identity_id AND ci.workspace_id=b.workspace_id
    JOIN contacts c ON c.contact_id=ci.contact_id AND c.workspace_id=ci.workspace_id
    WHERE b.workspace_id=?1 AND b.channel_id=?2 AND b.scoped_profile_id=?3 AND b.active=1 LIMIT 1`)
    .bind(channel.workspaceId, channel.channelId, String(event.channelProfileId)).first();
  if (!identity) {
    const candidates = PORTABLE_IDENTITY_PLATFORMS.has(platform)
      ? await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id,c.display_name AS contact_display_name
          FROM contact_identities ci JOIN contacts c ON c.contact_id=ci.contact_id AND c.workspace_id=ci.workspace_id
          WHERE ci.workspace_id=?1 AND ci.platform=?2 AND ci.profile_id=?3
          ORDER BY ci.created_at,ci.identity_id`).bind(channel.workspaceId, platform, profileId).all()
      : { results: [] };
    if ((candidates.results || []).length === 1) {
      identity = candidates.results[0];
      try {
        await ensureIdentityBinding(env, channel.workspaceId, identity.contact_id, identity.identity_id, {
          platform, profileId, scopedProfileId: profileId, username: '',
          phoneNumber: platform === 'whatsapp' && /^\d{6,20}$/.test(profileId) ? profileId : '',
          displayName: String(event.displayName || identity.contact_display_name || profileId).slice(0, 120),
          metadata: {}, channelId: channel.channelId
        }, now);
      } catch (error) {
        const winner = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id,c.display_name AS contact_display_name
          FROM channel_identity_bindings b JOIN contact_identities ci ON ci.identity_id=b.identity_id
          JOIN contacts c ON c.contact_id=ci.contact_id AND c.workspace_id=ci.workspace_id
          WHERE b.workspace_id=?1 AND b.channel_id=?2 AND b.scoped_profile_id=?3 AND b.active=1 LIMIT 1`)
          .bind(channel.workspaceId, channel.channelId, profileId).first();
        if (!winner) throw error;
        identity = winner;
      }
    } else {
      const contactId = crypto.randomUUID();
      const name = String(event.displayName || event.channelProfileId).slice(0, 120);
      try {
        await env.DB.prepare(`INSERT INTO contacts (contact_id,display_name,created_at,updated_at,workspace_id)
          VALUES (?1,?2,?3,?3,?4)`).bind(contactId, name, now, channel.workspaceId).run();
        const created = await ensureContactIdentity(env, channel.workspaceId, contactId, {
          platform, profileId, channelId: channel.channelId, scopedProfileId: profileId,
          phoneNumber: platform === 'whatsapp' && /^\d{6,20}$/.test(profileId) ? profileId : '',
          displayName: name, isPrimary: true
        }, now);
        identity = { identity_id: created.identityId, contact_id: contactId, contact_display_name: name };
      } catch (error) {
        await env.DB.prepare(`DELETE FROM contacts WHERE workspace_id=?1 AND contact_id=?2
          AND NOT EXISTS (SELECT 1 FROM conversations WHERE workspace_id=?1 AND contact_id=?2)`)
          .bind(channel.workspaceId, contactId).run().catch(() => {});
        const winner = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id,c.display_name AS contact_display_name
          FROM channel_identity_bindings b JOIN contact_identities ci ON ci.identity_id=b.identity_id
          JOIN contacts c ON c.contact_id=ci.contact_id AND c.workspace_id=ci.workspace_id
          WHERE b.workspace_id=?1 AND b.channel_id=?2 AND b.scoped_profile_id=?3 AND b.active=1 LIMIT 1`)
          .bind(channel.workspaceId, channel.channelId, profileId).first();
        if (!winner) throw error;
        identity = winner;
      }
    }
  }
  const conversationId = await ensureIdentityConversation(env, channel.workspaceId, identity.contact_id,
    identity.identity_id, channel.channelId, '');
  const conversation = { conversation_id: conversationId };
  const messageId = crypto.randomUUID();
  const reply = await resolveInboundReply(env, channel.workspaceId, conversation.conversation_id,
    channel.channelId, event.reply);
  const storedPayload = event.attachment || reply
    ? {
        ...(event.attachment ? { attachment: event.attachment } : {}),
        ...(reply ? { reply } : {}),
        providerMessageId: String(event.providerMessageId || '')
      }
    : rawPayload;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO messages (message_id,conversation_id,contact_id,channel_id,identity_id,direction,message_type,text,
      provider_message_id,status,timestamp,payload_json,workspace_id) VALUES (?1,?2,?3,?4,?5,'inbound',?6,?7,?8,'received',?9,?10,?11)`)
      .bind(messageId, conversation.conversation_id, identity.contact_id, channel.channelId, identity.identity_id,
        String(event.messageType || 'text').slice(0, 40), String(event.text || '').slice(0, MAX_TEXT_LENGTH),
        String(event.providerMessageId || ''), timestamp, truncateJson(storedPayload), channel.workspaceId),
    env.DB.prepare(`UPDATE conversations SET status='open',channel_id=?3,identity_id=?4,
        last_message_at=?5,unread_count=unread_count+1,updated_at=?6
      WHERE conversation_id=?1 AND workspace_id=?2`)
      .bind(conversation.conversation_id, channel.workspaceId, channel.channelId, identity.identity_id, timestamp, now)
  ]);
  await touchIdentityBinding(env, channel.workspaceId, identity.identity_id, channel.channelId,
    'inbound', conversation.conversation_id, timestamp);
  const messageType = String(event.messageType || 'text').slice(0, 40);
  const text = String(event.text || '').slice(0, MAX_TEXT_LENGTH);
  const senderName = String(identity.contact_display_name || event.displayName || event.channelProfileId);
  const message = {
    messageId, conversationId: conversation.conversation_id, channelId: channel.channelId,
    contactIdentityId: identity.identity_id, identityId: identity.identity_id,
    direction: 'inbound', messageType, text, status: 'received', timestamp,
    channelMessageId: String(event.providerMessageId || ''), error: '', senderName,
    connectorType: channel.connectorType, channelName: channel.name || '', channelProfileId: profileId,
    attachment: messageAttachmentView(messageType, storedPayload, messageId),
    reply: messageReplyView(storedPayload)
  };
  const conversationItem = await getConversationItem(env, channel.workspaceId, conversation.conversation_id);
  return {
    messageId,
    conversationId: conversation.conversation_id,
    senderName,
    preview: text,
    messageType,
    message,
    conversation: conversationItem
  };
  } catch (error) {
    // Let a provider retry process the event if storage failed after claiming its dedupe key.
    await env.DB.prepare('DELETE FROM webhook_events WHERE event_key=?1').bind(eventKey).run();
    throw error;
  }
}

async function resolveInboundReply(env, workspaceId, conversationId, channelId, providerReply) {
  const channelMessageId = String(providerReply?.channelMessageId || '').trim();
  if (!channelMessageId) return null;
  const row = await env.DB.prepare(`SELECT message_id,provider_message_id,direction,text,message_type,payload_json
    FROM messages WHERE workspace_id=?1 AND conversation_id=?2 AND channel_id=?3 AND provider_message_id=?4
    ORDER BY timestamp DESC LIMIT 1`).bind(workspaceId, conversationId, channelId, channelMessageId).first();
  if (row) return replyMetadataFromRow(row);
  return messageReplyView({ reply: providerReply });
}

async function applyProviderStatus(env, workspaceId, channelId, event, rawPayload) {
  const providerMessageId = String(event.providerMessageId || '');
  const internalMessageId = /^[A-Za-z0-9_-]{1,100}$/.test(String(event.internalMessageId || ''))
    ? String(event.internalMessageId) : '';
  const status = normalizeDeliveryStatus(event.status);
  if ((!providerMessageId && !internalMessageId) || !status) return [];
  const key = `${workspaceId}:${channelId}:status:${providerMessageId || internalMessageId}:${status}:${event.timestamp || ''}`;
  const dedupe = await env.DB.prepare(`INSERT OR IGNORE INTO webhook_events (event_key,channel_id,event_type,received_at,workspace_id)
    VALUES (?1,?2,'status',?3,?4)`).bind(key, channelId, new Date().toISOString(), workspaceId).run();
  if (!dedupe.meta?.changes) return [];
  try {
    // Status webhooks must not replace payload_json. Overwriting with the raw
    // provider receipt wiped outbound senderName (and other presentation fields)
    // so listMessages lost attribution after refresh. Timestamps are merged into
    // payload_json.statusHistory via persistMessageStatusHistory instead.
    const updated = await env.DB.prepare(`UPDATE messages SET
        status=CASE
          WHEN status='failed' THEN status
          WHEN ?4='failed' THEN 'failed'
          WHEN status='read' THEN status
          WHEN status='delivered' AND ?4='sent' THEN status
          ELSE ?4
        END,
        error=CASE
          WHEN status='failed' THEN error
          WHEN ?4='failed' THEN ?5
          WHEN status='read' THEN error
          WHEN status='delivered' AND ?4='sent' THEN error
          ELSE ?5
        END,
        provider_message_id=CASE WHEN provider_message_id='' AND ?3<>'' THEN ?3 ELSE provider_message_id END
      WHERE workspace_id=?1 AND channel_id=?2
        AND ((?3<>'' AND provider_message_id=?3) OR (?6<>'' AND message_id=?6))`)
      .bind(workspaceId, channelId, providerMessageId, status,
        String(event.error || '').slice(0, 500), internalMessageId).run();
    if (!updated.meta?.changes) {
      await env.DB.prepare('DELETE FROM webhook_events WHERE event_key=?1').bind(key).run();
      return [];
    }
    const at = normalizeTimestamp(event.timestamp, new Date().toISOString());
    const changed = await env.DB.prepare(`SELECT message_id,conversation_id,status,error,provider_message_id,payload_json FROM messages
      WHERE workspace_id=?1 AND channel_id=?2
        AND ((?3<>'' AND provider_message_id=?3) OR (?4<>'' AND message_id=?4))`)
      .bind(workspaceId, channelId, providerMessageId, internalMessageId).all();
    const results = [];
    for (const row of changed.results || []) {
      const statusHistory = await persistMessageStatusHistory(env, row, status, at);
      results.push(realtimeMessageStatus({ ...row, statusHistory }));
    }
    return results;
  } catch (error) {
    await env.DB.prepare('DELETE FROM webhook_events WHERE event_key=?1').bind(key).run();
    throw error;
  }
}

async function applyProviderWatermarkStatus(env, workspaceId, channelId, event, rawPayload) {
  const channelProfileId = String(event.channelProfileId || '');
  const status = normalizeDeliveryStatus(event.status);
  const timestamp = normalizeTimestamp(event.timestamp, '');
  if (!channelProfileId || !timestamp || !['delivered', 'read'].includes(status)) return [];
  const key = `${workspaceId}:${channelId}:watermark:${channelProfileId}:${status}:${timestamp}`;
  const dedupe = await env.DB.prepare(`INSERT OR IGNORE INTO webhook_events (event_key,channel_id,event_type,received_at,workspace_id)
    VALUES (?1,?2,'status',?3,?4)`).bind(key, channelId, new Date().toISOString(), workspaceId).run();
  if (!dedupe.meta?.changes) return [];
  try {
    const updated = await env.DB.prepare(`UPDATE messages SET
        status=CASE
          WHEN status='failed' THEN status
          WHEN status='read' THEN status
          WHEN status='delivered' AND ?5='delivered' THEN status
          ELSE ?5
        END,
        error=CASE WHEN status='failed' THEN error ELSE '' END
      WHERE workspace_id=?1 AND channel_id=?2 AND direction='outbound' AND timestamp<=?4
        AND provider_message_id<>'' AND status IN ('submitted','sent','delivered','read')
        AND COALESCE(NULLIF(identity_id,''),(SELECT NULLIF(c.identity_id,'') FROM conversations c
          WHERE c.workspace_id=messages.workspace_id AND c.conversation_id=messages.conversation_id),'')
          IN (SELECT identity_id FROM channel_identity_bindings
          WHERE workspace_id=?1 AND channel_id=?2 AND scoped_profile_id=?3)`)
      .bind(workspaceId, channelId, channelProfileId, timestamp, status).run();
    if (!updated.meta?.changes) return [];
    const changed = await env.DB.prepare(`SELECT m.message_id,m.conversation_id,m.status,m.error,m.provider_message_id,m.payload_json FROM messages m
      WHERE m.workspace_id=?1 AND m.channel_id=?2 AND m.direction='outbound' AND m.timestamp<=?4
        AND m.provider_message_id<>'' AND m.status IN ('submitted','sent','delivered','read')
        AND COALESCE(NULLIF(m.identity_id,''),(SELECT NULLIF(c.identity_id,'') FROM conversations c
          WHERE c.workspace_id=m.workspace_id AND c.conversation_id=m.conversation_id),'')
          IN (SELECT identity_id FROM channel_identity_bindings
          WHERE workspace_id=?1 AND channel_id=?2 AND scoped_profile_id=?3)`)
      .bind(workspaceId, channelId, channelProfileId, timestamp).all();
    const results = [];
    for (const row of changed.results || []) {
      const statusHistory = await persistMessageStatusHistory(env, row, status, timestamp);
      results.push(realtimeMessageStatus({ ...row, statusHistory }));
    }
    return results;
  } catch (error) {
    await env.DB.prepare('DELETE FROM webhook_events WHERE event_key=?1').bind(key).run();
    throw error;
  }
}

function realtimeMessageStatus(row) {
  const statusHistory = isPlainObject(row.statusHistory)
    ? messageStatusHistoryView({ statusHistory: row.statusHistory })
    : messageStatusHistoryView(safeJsonParse(row.payload_json, {}));
  return {
    messageId: String(row.message_id || ''),
    conversationId: String(row.conversation_id || ''),
    status: String(row.status || ''),
    error: String(row.error || ''),
    channelMessageId: String(row.provider_message_id || row.channelMessageId || ''),
    ...(statusHistory ? { statusHistory } : {})
  };
}

function statusHistoryFieldForStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'failed' || normalized === 'error') return 'failedAt';
  if (normalized === 'read' || normalized === 'seen') return 'readAt';
  if (normalized === 'delivered') return 'deliveredAt';
  if (['sent', 'submitted', 'accepted'].includes(normalized)) return 'sentAt';
  return '';
}

function mergeStatusHistoryPayload(payload, status, at) {
  const field = statusHistoryFieldForStatus(status);
  const when = String(at || '').trim().slice(0, 64);
  if (!field || !when) {
    return {
      payload: isPlainObject(payload) ? payload : {},
      history: messageStatusHistoryView(payload),
      changed: false
    };
  }
  const nextPayload = isPlainObject(payload) ? { ...payload } : {};
  const current = isPlainObject(nextPayload.statusHistory) ? { ...nextPayload.statusHistory } : {};
  let changed = false;
  if (!String(current[field] || '').trim()) {
    current[field] = when;
    changed = true;
  }
  if (String(current.updatedAt || '').trim() !== when) {
    current.updatedAt = when;
    changed = true;
  }
  if (changed) nextPayload.statusHistory = current;
  return { payload: nextPayload, history: messageStatusHistoryView(nextPayload), changed };
}

async function persistMessageStatusHistory(env, row, status, at) {
  if (!row?.message_id) return null;
  const existingPayload = safeJsonParse(row.payload_json, {});
  const { payload, history, changed } = mergeStatusHistoryPayload(existingPayload, status, at);
  if (!changed || !history) return messageStatusHistoryView(existingPayload);
  // Merge only statusHistory keys; never replace the full presentation payload.
  await env.DB.prepare('UPDATE messages SET payload_json=?2 WHERE message_id=?1')
    .bind(row.message_id, JSON.stringify(payload)).run();
  return history;
}

/** Normalize Interakt/live statusHistory timestamps into the shared payload shape. */
function normalizeStoredStatusHistory(history) {
  if (!isPlainObject(history)) return null;
  const next = {};
  for (const key of ['sentAt', 'deliveredAt', 'readAt', 'failedAt', 'updatedAt']) {
    const value = normalizeTimestamp(history[key], '');
    if (value) next[key] = value;
  }
  return Object.keys(next).length ? next : null;
}

/**
 * Fill missing statusHistory keys from an import source (Interakt) without
 * overwriting times already recorded by live WhatsApp webhooks.
 */
function mergeImportedStatusHistory(existingPayload, incomingHistory) {
  const incoming = normalizeStoredStatusHistory(incomingHistory);
  const current = isPlainObject(existingPayload?.statusHistory)
    ? { ...existingPayload.statusHistory }
    : {};
  if (!incoming) {
    const history = messageStatusHistoryView({ statusHistory: current });
    return { history, changed: false, merged: history || null };
  }
  let changed = false;
  for (const [key, value] of Object.entries(incoming)) {
    if (!String(current[key] || '').trim()) {
      current[key] = value;
      changed = true;
    }
  }
  const history = messageStatusHistoryView({ statusHistory: current });
  return { history, changed, merged: history || null };
}

async function broadcastMessageStatusChanges(env, workspaceId, changes) {
  const unique = new Map();
  for (const change of changes || []) {
    if (!change?.messageId || !change?.conversationId || !change?.status) continue;
    unique.set(change.messageId, change);
  }
  for (const change of unique.values()) {
    await broadcast(env, workspaceId, {
      type: 'message.updated',
      messageId: change.messageId,
      conversationId: change.conversationId,
      status: change.status,
      channelMessageId: String(change.channelMessageId || ''),
      message: change
    });
  }
}

async function seedDemo(env, workspaceId, principal) {
  const now = new Date().toISOString();
  const channelId = workspaceId === 'ws_default' ? 'demo-web' : `demo-web-${workspaceId}`;
  const contactId = crypto.randomUUID();
  const identityId = crypto.randomUUID();
  const bindingId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const profileId = `demo-${contactId}`;
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO channels (channel_id,name,connector_type,enabled,capabilities_json,config_json,secret_key,created_at,updated_at,workspace_id)
      VALUES (?1,'Website chat','web_chat',1,'["text"]','{}','DEMO_WEB',?2,?2,?3)`).bind(channelId, now, workspaceId),
    env.DB.prepare('INSERT INTO contacts (contact_id,display_name,created_at,updated_at,workspace_id) VALUES (?1,?2,?3,?3,?4)').bind(contactId, 'Demo customer', now, workspaceId),
    env.DB.prepare(`INSERT INTO contact_identities
        (identity_id,workspace_id,contact_id,platform,profile_id,display_name,metadata_json,created_at,updated_at)
      VALUES (?1,?2,?3,'web_chat',?4,'Demo customer','{"isPrimary":true}',?5,?5)`)
      .bind(identityId, workspaceId, contactId, profileId, now),
    env.DB.prepare(`INSERT INTO channel_identity_bindings
        (binding_id,workspace_id,identity_id,channel_id,scoped_profile_id,metadata_json,active,
         first_seen_at,last_seen_at,last_inbound_at,last_conversation_id,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,'{}',1,?6,?6,?6,?7,?6,?6)`)
      .bind(bindingId, workspaceId, identityId, channelId, profileId, now, conversationId),
    env.DB.prepare(`INSERT INTO channel_identities (identity_id,contact_id,channel_id,channel_profile_id,display_name,created_at,workspace_id)
      VALUES (?1,?2,?3,?4,?5,?6,?7)`).bind(bindingId, contactId, channelId, profileId, 'Demo customer', now, workspaceId),
    env.DB.prepare(`INSERT INTO conversations (conversation_id,contact_id,channel_id,identity_id,status,subject,last_message_at,unread_count,created_at,updated_at,workspace_id)
      VALUES (?1,?2,?3,?4,'open','Demo customer',?5,1,?5,?5,?6)`).bind(conversationId, contactId, channelId, identityId, now, workspaceId),
    env.DB.prepare(`INSERT INTO messages (message_id,conversation_id,contact_id,channel_id,identity_id,direction,message_type,text,status,timestamp,workspace_id)
      VALUES (?1,?2,?3,?4,?5,'inbound','text','Hello! This is a demo conversation.','received',?6,?7)`)
      .bind(crypto.randomUUID(), conversationId, contactId, channelId, identityId, now, workspaceId)
  ]);
  await audit(env, principal, 'seed', 'conversation', conversationId, { channelId });
  return { ok: true, channelId, contactId, conversationId };
}

async function importChatHistory(env, workspaceId, principal, payload) {
  if (!isPlainObject(payload)) throw httpError(400, 'Import payload must be a JSON object.');
  rejectUnknownKeys(payload, new Set(['source', 'channelId', 'conversations', 'fieldMapping']), 'import request');
  const source = String(payload.source || '').trim().toLowerCase();
  if (source !== INTERAKT_SOURCE) {
    throw httpError(400, 'Unsupported import source. Choose Interakt for now.');
  }
  const fieldMapping = normalizeFieldMapping(payload.fieldMapping);
  if (!fieldMapping.phone) throw httpError(400, 'Map a phone field before importing.');
  const channelId = cleanId(payload.channelId, 'Channel ID');
  const channel = await getChannel(env, channelId, '', workspaceId);
  if (!channel) throw httpError(404, 'Channel not found.');
  if (channel.connectorType !== 'whatsapp_cloud') {
    throw httpError(400, 'Interakt imports require a WhatsApp Cloud channel.');
  }
  assertPrincipalChannelAccess(principal, channelId);
  await assertChannelReadyForConversation(env, workspaceId, channel);
  const conversations = validateInteraktBatch(payload.conversations);
  const summary = {
    source: INTERAKT_SOURCE,
    channelId,
    fieldMapping,
    contactsCreated: 0,
    contactsReused: 0,
    conversationsCreated: 0,
    conversationsReused: 0,
    messagesImported: 0,
    messagesUpdated: 0,
    messagesSkipped: 0,
    failed: []
  };
  for (const conversation of conversations) {
    try {
      const result = await importInteraktConversation(env, workspaceId, channel, conversation, fieldMapping);
      summary.contactsCreated += result.contactsCreated;
      summary.contactsReused += result.contactsReused;
      summary.conversationsCreated += result.conversationsCreated;
      summary.conversationsReused += result.conversationsReused;
      summary.messagesImported += result.messagesImported;
      summary.messagesUpdated += result.messagesUpdated;
      summary.messagesSkipped += result.messagesSkipped;
    } catch (error) {
      const customer = extractInteraktCustomer(conversation, fieldMapping);
      summary.failed.push({
        externalId: customer.externalId || '',
        phone: customer.phone || '',
        error: cleanError(error)
      });
      if (summary.failed.length >= 25) break;
    }
  }
  await audit(env, principal, 'import_chat', 'channel', channelId, {
    source: INTERAKT_SOURCE,
    conversations: conversations.length,
    fieldMapping,
    messagesImported: summary.messagesImported,
    messagesUpdated: summary.messagesUpdated,
    messagesSkipped: summary.messagesSkipped,
    failed: summary.failed.length
  });
  return { ok: true, ...summary };
}

async function findExistingInteraktMessage(env, workspaceId, channelId, mapped) {
  if (mapped.providerMessageId) {
    const byProvider = await env.DB.prepare(`SELECT message_id, message_type, text, payload_json, error, status,
        provider_message_id, sender_login, sender_name
      FROM messages
      WHERE workspace_id=?1 AND channel_id=?2 AND provider_message_id=?3
      LIMIT 1`)
      .bind(workspaceId, channelId, mapped.providerMessageId).first();
    if (byProvider) return byProvider;
  }
  if (mapped.externalId) {
    // Secondary key for older rows / missing channel ids: Interakt message UUID in payload.
    return env.DB.prepare(`SELECT message_id, message_type, text, payload_json, error, status,
        provider_message_id, sender_login, sender_name
      FROM messages
      WHERE workspace_id=?1 AND channel_id=?2
        AND json_extract(payload_json, '$.source') = ?3
        AND json_extract(payload_json, '$.externalId') = ?4
      LIMIT 1`)
      .bind(workspaceId, channelId, INTERAKT_SOURCE, mapped.externalId).first();
  }
  return null;
}

async function importInteraktConversation(env, workspaceId, channel, conversation, fieldMapping) {
  const customer = extractInteraktCustomer(conversation, fieldMapping);
  if (!customer.phone) throw httpError(400, 'Conversation is missing a WhatsApp phone number.');
  let profileId;
  try {
    profileId = normalizeWhatsAppRecipient(customer.phone);
  } catch (error) {
    throw httpError(400, error.message || 'Invalid WhatsApp phone number.');
  }
  const displayName = String(customer.displayName || profileId).slice(0, 120);
  const company = String(customer.company || '').slice(0, 160);
  const tags = Array.isArray(customer.tags) ? customer.tags.slice(0, 20) : [];
  const now = new Date().toISOString();
  const result = {
    contactsCreated: 0, contactsReused: 0,
    conversationsCreated: 0, conversationsReused: 0,
    messagesImported: 0, messagesUpdated: 0, messagesSkipped: 0
  };

  let identity = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id,c.display_name AS contact_display_name,
      c.company AS contact_company,c.tags_json AS contact_tags_json
    FROM channel_identity_bindings b
    JOIN contact_identities ci ON ci.identity_id=b.identity_id AND ci.workspace_id=b.workspace_id
    JOIN contacts c ON c.contact_id=ci.contact_id AND c.workspace_id=ci.workspace_id
    WHERE b.workspace_id=?1 AND b.channel_id=?2 AND b.scoped_profile_id=?3 AND b.active=1 LIMIT 1`)
    .bind(workspaceId, channel.channelId, profileId).first();
  if (!identity) {
    identity = await env.DB.prepare(`SELECT ci.identity_id,ci.contact_id,c.display_name AS contact_display_name,
        c.company AS contact_company,c.tags_json AS contact_tags_json
      FROM contact_identities ci
      JOIN contacts c ON c.contact_id=ci.contact_id AND c.workspace_id=ci.workspace_id
      WHERE ci.workspace_id=?1 AND ci.platform='whatsapp' AND ci.profile_id=?2
      ORDER BY ci.created_at,ci.identity_id LIMIT 1`).bind(workspaceId, profileId).first();
    if (identity) {
      await ensureIdentityBinding(env, workspaceId, identity.contact_id, identity.identity_id, {
        platform: 'whatsapp', profileId, scopedProfileId: profileId, channelId: channel.channelId,
        phoneNumber: profileId, displayName: identity.contact_display_name || displayName, metadata: {}
      }, now);
      result.contactsReused += 1;
    }
  } else {
    result.contactsReused += 1;
  }
  if (!identity) {
    const contactId = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO contacts
        (contact_id,display_name,company,tags_json,created_at,updated_at,workspace_id)
      VALUES (?1,?2,?3,?4,?5,?5,?6)`)
      .bind(contactId, displayName, company, JSON.stringify(tags), now, workspaceId).run();
    const created = await ensureContactIdentity(env, workspaceId, contactId, {
      platform: 'whatsapp', profileId, channelId: channel.channelId, scopedProfileId: profileId,
      phoneNumber: profileId, displayName, isPrimary: true
    }, now);
    identity = { identity_id: created.identityId, contact_id: contactId, contact_display_name: displayName };
    result.contactsCreated += 1;
  } else {
    const nextName = (displayName && displayName !== profileId
      && (!identity.contact_display_name || identity.contact_display_name === profileId))
      ? displayName : (identity.contact_display_name || displayName);
    const nextCompany = company && !String(identity.contact_company || '').trim()
      ? company : String(identity.contact_company || '');
    const existingTags = storedContactTags(identity.contact_tags_json);
    const nextTags = tags.length && !existingTags.length ? tags : existingTags;
    await env.DB.prepare(`UPDATE contacts SET display_name=?3,company=?4,tags_json=?5,updated_at=?6
      WHERE workspace_id=?1 AND contact_id=?2`)
      .bind(workspaceId, identity.contact_id, nextName, nextCompany, JSON.stringify(nextTags), now).run();
  }

  const existingConversation = await env.DB.prepare(`SELECT conversation_id FROM conversations
    WHERE workspace_id=?1 AND contact_id=?2 LIMIT 1`)
    .bind(workspaceId, identity.contact_id).first();
  const conversationId = await ensureIdentityConversation(env, workspaceId, identity.contact_id,
    identity.identity_id, channel.channelId, '');
  if (existingConversation) result.conversationsReused += 1;
  else result.conversationsCreated += 1;

  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  if (messages.length > 500) throw httpError(400, 'Send at most 500 messages per conversation batch.');
  let latestTimestamp = '';
  const pendingStatements = [];
  const flush = async () => {
    if (!pendingStatements.length) return;
    await env.DB.batch(pendingStatements.splice(0, pendingStatements.length));
  };

  for (const rawMessage of messages) {
    const mapped = mapInteraktMessage(rawMessage);
    if (!mapped.providerMessageId && !mapped.text && !mapped.mediaUrl) {
      result.messagesSkipped += 1;
      continue;
    }
    const timestamp = normalizeTimestamp(mapped.timestamp, now);
    if (!latestTimestamp || timestamp > latestTimestamp) latestTimestamp = timestamp;
    const attachmentType = ['image', 'video', 'audio', 'document'].includes(mapped.attachmentType)
      ? mapped.attachmentType
      : (['image', 'video', 'audio', 'document'].includes(mapped.messageType) ? mapped.messageType : '');
    const importSender = mapped.direction === 'outbound'
      ? importSourceSenderAttribution(INTERAKT_SOURCE)
      : { login: '', name: '' };
    const importedStatusHistory = normalizeStoredStatusHistory(mapped.statusHistory);
    const payload = {
      source: INTERAKT_SOURCE,
      externalId: mapped.externalId,
      contentType: mapped.contentType,
      ...(importSender.name ? { senderName: importSender.name } : {}),
      ...(mapped.template ? { template: mapped.template } : {}),
      ...(mapped.replyTo ? { reply: { channelMessageId: mapped.replyTo } } : {}),
      ...(importedStatusHistory ? { statusHistory: importedStatusHistory } : {}),
      ...(mapped.mediaUrl && attachmentType ? {
        attachment: {
          type: attachmentType,
          filename: mapped.mediaFileName || '',
          externalUrl: mapped.mediaUrl
        }
      } : {})
    };
    const text = String(mapped.text || '').slice(0, MAX_TEXT_LENGTH);
    const existing = await findExistingInteraktMessage(env, workspaceId, channel.channelId, mapped);
    if (existing) {
      // Same Interakt/WhatsApp message already stored — never insert a second copy.
      // Refresh template body / attachment / failure reason when the re-import improves them.
      const existingParsed = safeJsonParse(existing.payload_json, {});
      const existingPayload = String(existing.payload_json || '');
      const refreshAttachment = Boolean(payload.attachment)
        && !/"attachment"\s*:/.test(existingPayload);
      const shouldRefreshTemplate = mapped.messageType === 'template'
        && (existing.message_type === 'template' || existingPayload.includes('"interakt"'))
        && text
        && (text !== String(existing.text || '') || refreshAttachment);
      const errorText = String(mapped.error || '').slice(0, 500);
      const shouldRefreshError = Boolean(errorText)
        && errorText !== String(existing.error || '');
      const shouldRefreshProviderId = Boolean(mapped.providerMessageId)
        && mapped.providerMessageId !== String(existing.provider_message_id || '');
      const statusHistoryMerge = mergeImportedStatusHistory(existingParsed, mapped.statusHistory);
      const shouldRefreshStatusHistory = statusHistoryMerge.changed;
      const shouldRefreshSender = Boolean(importSender.login && importSender.name)
        && (String(existing.sender_login || '').trim() !== importSender.login
          || String(existing.sender_name || '').trim() !== importSender.name);
      if (shouldRefreshTemplate || shouldRefreshError || shouldRefreshProviderId
        || shouldRefreshStatusHistory || shouldRefreshSender) {
        const nextPayload = { ...payload };
        if (statusHistoryMerge.merged) nextPayload.statusHistory = statusHistoryMerge.merged;
        else delete nextPayload.statusHistory;
        // Keep non-import presentation keys (e.g. live attachment metadata) when present.
        if (isPlainObject(existingParsed.attachment) && !nextPayload.attachment) {
          nextPayload.attachment = existingParsed.attachment;
        }
        if (isPlainObject(existingParsed.reply) && !nextPayload.reply) {
          nextPayload.reply = existingParsed.reply;
        }
        pendingStatements.push(env.DB.prepare(`UPDATE messages
            SET message_type=?2, text=?3, payload_json=?4, status=?5, error=?6,
                provider_message_id=CASE
                  WHEN ?8<>'' THEN ?8
                  ELSE provider_message_id
                END,
                sender_login=CASE WHEN ?9<>'' THEN ?9 ELSE sender_login END,
                sender_name=CASE WHEN ?10<>'' THEN ?10 ELSE sender_name END
          WHERE workspace_id=?7 AND message_id=?1`)
          .bind(
            existing.message_id, mapped.messageType, text, truncateJson(nextPayload), mapped.status,
            errorText, workspaceId, mapped.providerMessageId || '',
            importSender.login, importSender.name
          ));
        result.messagesUpdated += 1;
        if (pendingStatements.length >= 40) await flush();
        continue;
      }
      result.messagesSkipped += 1;
      continue;
    }
    const messageId = crypto.randomUUID();
    pendingStatements.push(env.DB.prepare(`INSERT INTO messages
        (message_id,conversation_id,contact_id,channel_id,identity_id,direction,message_type,text,
         provider_message_id,status,error,timestamp,payload_json,workspace_id,sender_login,sender_name)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)`)
      .bind(
        messageId, conversationId, identity.contact_id, channel.channelId, identity.identity_id,
        mapped.direction, mapped.messageType, text,
        mapped.providerMessageId, mapped.status, String(mapped.error || '').slice(0, 500),
        timestamp, truncateJson(payload), workspaceId, importSender.login, importSender.name
      ));
    result.messagesImported += 1;
    if (pendingStatements.length >= 40) await flush();
  }
  await flush();

  if (latestTimestamp || customer.status) {
    await env.DB.prepare(`UPDATE conversations SET
        status=CASE WHEN ?4<>'' THEN ?4 ELSE status END,
        channel_id=?3,identity_id=?5,
        last_message_at=CASE
          WHEN ?6<>'' AND (last_message_at='' OR last_message_at < ?6) THEN ?6
          ELSE last_message_at
        END,
        unread_count=0,updated_at=?7
      WHERE conversation_id=?1 AND workspace_id=?2`)
      .bind(conversationId, workspaceId, channel.channelId, customer.status || '',
        identity.identity_id, latestTimestamp, now).run();
  }
  if (latestTimestamp) {
    await touchIdentityBinding(env, workspaceId, identity.identity_id, channel.channelId,
      '', conversationId, latestTimestamp);
  }
  return result;
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
        const attachment = whatsappInboundAttachment(message);
        const reply = whatsappInboundReply(message);
        messages.push({
          channelProfileId: String(message.from || ''), displayName: contact.profile?.name || String(message.from || ''),
          text, providerMessageId: String(message.id || ''),
          timestamp: message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : '',
          messageType: attachment?.type || String(message.type || 'text'),
          ...(attachment ? { attachment } : {}),
          ...(reply ? { reply } : {})
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
  // Media cards already describe their file type and name. Keeping a generated
  // "[WhatsApp image received]" line duplicates that UI and is especially noisy
  // in conversation previews. An attachment without a customer caption should
  // therefore remain textless, just like Telegram media.
  if (['image', 'video', 'audio', 'document', 'sticker'].includes(String(message?.type || '').toLowerCase())) {
    return '';
  }
  const type = String(message?.type || 'message').replace(/_/g, ' ');
  return `[WhatsApp ${type} received]`;
}

function whatsappInboundAttachment(message) {
  const providerType = String(message?.type || '').toLowerCase();
  const type = providerType === 'sticker' ? 'image' : providerType;
  if (!['image', 'video', 'audio', 'document'].includes(type)) return null;
  const media = message?.[providerType];
  if (!media?.id) return null;
  const mimeType = String(media.mime_type || '');
  const extension = mimeType.split('/')[1]?.split(';')[0] || 'bin';
  return {
    type,
    filename: String(media.filename || `${type}-${String(message.id || 'attachment').slice(-12)}.${extension}`).slice(0, 240),
    mimeType: mimeType.slice(0, 160),
    size: Number(media.file_size || 0),
    caption: String(media.caption || message?.caption || '').slice(0, MAX_ATTACHMENT_CAPTION_LENGTH),
    providerMediaId: String(media.id)
  };
}

function whatsappInboundReply(message) {
  const channelMessageId = String(message?.context?.id || '').trim();
  return channelMessageId ? { channelMessageId } : null;
}

export {
  INTERAKT_SOURCE,
  CONTACT_TARGET_FIELDS,
  defaultInteraktFieldMapping,
  discoverInteraktContactFields,
  extractInteraktCustomer,
  mapInteraktMessage,
  normalizeFieldMapping
} from './imports/interakt.js';

export { outboundSenderAttribution, outboundSenderLabel };

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
  const attachment = telegramInboundAttachment(message);
  const reply = telegramInboundReply(message.reply_to_message);
  return {
    channelProfileId: String(message.chat.id), displayName: name,
    text: message.text || message.caption || '',
    providerMessageId: String(message.message_id || ''),
    dedupeKey: payload.update_id !== undefined && payload.update_id !== null
      ? `update:${payload.update_id}` : `chat:${message.chat.id}:message:${message.message_id || ''}`,
    timestamp: message.date ? new Date(Number(message.date) * 1000).toISOString() : '',
    messageType: message.text ? 'text' : attachment?.type || 'message',
    ...(attachment ? { attachment } : {}),
    ...(reply ? { reply } : {})
  };
}

function telegramInboundReply(message) {
  if (!message?.message_id) return null;
  const attachment = telegramInboundAttachment(message);
  return {
    channelMessageId: String(message.message_id),
    direction: message.from?.is_bot ? 'outbound' : 'inbound',
    text: String(message.text || message.caption || '').slice(0, 1000),
    messageType: message.text ? 'text' : attachment?.type || 'message',
    ...(attachment?.type ? { attachment: { type: attachment.type, filename: attachment.filename || '' } } : {})
  };
}

function telegramInboundAttachment(message) {
  let media = null;
  let type = '';
  if (Array.isArray(message?.photo) && message.photo.length) {
    media = message.photo.reduce((largest, item) => Number(item.file_size || 0) >= Number(largest?.file_size || 0) ? item : largest, null);
    type = 'image';
  } else if (message?.video) {
    media = message.video; type = 'video';
  } else if (message?.audio || message?.voice) {
    media = message.audio || message.voice; type = 'audio';
  } else if (message?.document) {
    media = message.document; type = 'document';
  } else if (message?.animation) {
    media = message.animation; type = 'video';
  } else if (message?.video_note) {
    media = message.video_note; type = 'video';
  } else if (message?.sticker) {
    media = message.sticker;
    type = String(media.mime_type || '').toLowerCase() === 'video/webm' ? 'video' : 'image';
  }
  if (!media?.file_id || !type) return null;
  const mimeType = String(media.mime_type || (type === 'image' ? 'image/jpeg' : ''));
  const extension = mimeType.split('/')[1]?.split(';')[0] || 'bin';
  return {
    type,
    filename: String(media.file_name || `${type}-${String(message.message_id || 'attachment')}.${extension}`).slice(0, 240),
    mimeType: mimeType.slice(0, 160),
    size: Number(media.file_size || 0),
    caption: String(message.caption || '').slice(0, MAX_ATTACHMENT_CAPTION_LENGTH),
    providerFileId: String(media.file_id)
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
  const body = JSON.stringify({ ...event, at: new Date().toISOString() });
  await inboxHub(env, workspaceId).fetch('https://hub.internal/broadcast', {
    method: 'POST', body
  });
  if (workspaceId !== LEGACY_WORKSPACE_ID) {
    await inboxHub(env, LEGACY_WORKSPACE_ID).fetch('https://hub.internal/broadcast', {
      method: 'POST', body
    }).catch(() => {});
  }
}

async function disconnectRealtime(env, workspaceId, target) {
  if (!env.INBOX_HUB || !workspaceId) return;
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(target || {})
  };
  await inboxHub(env, workspaceId).fetch('https://hub.internal/disconnect', init);
  if (workspaceId !== LEGACY_WORKSPACE_ID) {
    await inboxHub(env, LEGACY_WORKSPACE_ID).fetch('https://hub.internal/disconnect', init).catch(() => {});
  }
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
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Admin-Token, X-Workspace-Id',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400'
  };
}

async function cleanupExpiredAuth(env) {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_states WHERE expires_at<=?1').bind(now),
    env.DB.prepare('DELETE FROM mobile_auth_challenges WHERE expires_at<=?1 OR consumed_at IS NOT NULL').bind(now),
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

async function readImportJson(request) {
  if (!(request.headers.get('Content-Type') || '').toLowerCase().includes('application/json')) {
    throw httpError(415, 'Content-Type must be application/json.');
  }
  const raw = await readBoundedText(request, MAX_IMPORT_JSON_BODY);
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

function workspaceSecretPrefix(_workspaceId, value) {
  return secretPrefix(value);
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
