import { normalizeEmail } from './auth.js';

const AUDIENCES = new Set(['all', 'workspace', 'email']);
const MAX_TITLE = 160;
const MAX_BODY = 4000;
const MAX_LINK = 500;

export async function listPlatformNotifications(env) {
  const rows = await env.DB.prepare(`SELECT notification_id, title, body, link_url, audience,
      workspace_id, target_email, status, created_by_email, created_at, sent_at, recipient_count
    FROM platform_notifications
    ORDER BY created_at DESC
    LIMIT 100`).all();
  return { ok: true, items: (rows.results || []).map(notificationView) };
}

export async function createPlatformNotification(env, principal, payload = {}, options = {}) {
  const send = options.send === true;
  rejectUnknown(payload, ['title', 'body', 'linkUrl', 'audience', 'workspaceId', 'targetEmail', 'send']);
  const title = cleanText(payload.title, 'Title', 1, MAX_TITLE);
  const body = cleanText(payload.body, 'Body', 1, MAX_BODY);
  const linkUrl = optionalLink(payload.linkUrl);
  const audience = String(payload.audience || 'all').trim().toLowerCase();
  if (!AUDIENCES.has(audience)) throw notifyError(400, 'Audience must be all, workspace, or email.');
  const workspaceId = String(payload.workspaceId || '').trim();
  const targetEmail = normalizeEmail(payload.targetEmail || '');
  if (audience === 'workspace' && !workspaceId) {
    throw notifyError(400, 'Select a workspace for workspace-targeted notifications.');
  }
  if (audience === 'email' && !targetEmail) {
    throw notifyError(400, 'Enter a login email for user-targeted notifications.');
  }
  if (audience === 'workspace') await assertWorkspace(env, workspaceId);
  if (audience === 'email' && workspaceId) await assertWorkspace(env, workspaceId);

  const now = new Date().toISOString();
  const notificationId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO platform_notifications
      (notification_id, title, body, link_url, audience, workspace_id, target_email, status,
       created_by_email, created_at, sent_at, recipient_count)
    VALUES (?1,?2,?3,?4,?5,?6,?7,'draft',?8,?9,'',0)`)
    .bind(
      notificationId,
      title,
      body,
      linkUrl,
      audience,
      audience === 'all' ? '' : workspaceId,
      audience === 'email' ? targetEmail : '',
      normalizeEmail(principal?.user?.email) || '',
      now
    ).run();

  const shouldSend = send || payload.send === true;
  if (shouldSend) {
    // In-app bell only (websocket broadcast). Never browser/Android device push.
    return sendPlatformNotification(env, notificationId, {
      broadcast: options.broadcast
    });
  }
  const row = await env.DB.prepare(`SELECT * FROM platform_notifications WHERE notification_id=?1`)
    .bind(notificationId).first();
  return { ok: true, item: notificationView(row) };
}

export async function sendPlatformNotification(env, notificationId, hooks = {}) {
  const id = String(notificationId || '').trim();
  if (!id) throw notifyError(400, 'Notification id is required.');
  const row = await env.DB.prepare(`SELECT * FROM platform_notifications WHERE notification_id=?1`)
    .bind(id).first();
  if (!row) throw notifyError(404, 'Notification not found.');
  if (row.status === 'sent') throw notifyError(409, 'This notification was already sent.');

  const recipients = await resolveRecipients(env, row);
  if (!recipients.length) throw notifyError(400, 'No matching active users for this audience.');

  const now = new Date().toISOString();
  const statements = recipients.map((recipient) => env.DB.prepare(`INSERT OR IGNORE INTO platform_notification_deliveries
      (delivery_id, notification_id, workspace_id, user_id, membership_id, read_at, created_at)
    VALUES (?1,?2,?3,?4,?5,'',?6)`).bind(
    crypto.randomUUID(),
    id,
    recipient.workspaceId,
    recipient.userId,
    recipient.membershipId,
    now
  ));
  statements.push(env.DB.prepare(`UPDATE platform_notifications
    SET status='sent', sent_at=?2, recipient_count=?3 WHERE notification_id=?1`)
    .bind(id, now, recipients.length));
  await env.DB.batch(statements);

  const item = notificationView({
    ...row,
    status: 'sent',
    sent_at: now,
    recipient_count: recipients.length
  });

  const byWorkspace = new Map();
  for (const recipient of recipients) {
    if (!byWorkspace.has(recipient.workspaceId)) byWorkspace.set(recipient.workspaceId, []);
    byWorkspace.get(recipient.workspaceId).push(recipient);
  }

  // Deliver to the Helixcer Chat bell via realtime only. Do not call web push
  // or Android FCM — admin announcements must not appear as OS notifications.
  const broadcastFn = typeof hooks.broadcast === 'function' ? hooks.broadcast : null;
  for (const [workspaceId, members] of byWorkspace.entries()) {
    if (!broadcastFn) continue;
    try {
      await broadcastFn(env, workspaceId, {
        type: 'platform.notification',
        notification: {
          notificationId: item.notificationId,
          title: item.title,
          body: item.body,
          linkUrl: item.linkUrl,
          createdAt: item.sentAt || item.createdAt
        },
        membershipIds: members.map((member) => member.membershipId)
      });
    } catch { /* realtime fan-out is best-effort */ }
  }

  return { ok: true, item, recipientCount: recipients.length };
}

export async function deletePlatformNotification(env, notificationId) {
  const id = String(notificationId || '').trim();
  const row = await env.DB.prepare(`SELECT notification_id, status FROM platform_notifications WHERE notification_id=?1`)
    .bind(id).first();
  if (!row) throw notifyError(404, 'Notification not found.');
  await env.DB.prepare(`DELETE FROM platform_notification_deliveries WHERE notification_id=?1`).bind(id).run();
  await env.DB.prepare(`DELETE FROM platform_notifications WHERE notification_id=?1`).bind(id).run();
  return { ok: true, deleted: true, notificationId: id };
}

export async function listMyNotifications(env, principal, url) {
  const membershipId = principal?.membership?.membershipId;
  const userId = principal?.user?.userId;
  const workspaceId = principal?.workspace?.workspaceId;
  if (!membershipId || !userId || !workspaceId) throw notifyError(401, 'Unauthorized.');
  const unreadOnly = String(url?.searchParams?.get('unread') || '') === '1';
  const conditions = ['d.membership_id=?1'];
  const params = [membershipId];
  if (unreadOnly) conditions.push(`d.read_at=''`);
  const rows = await env.DB.prepare(`SELECT d.delivery_id, d.notification_id, d.read_at, d.created_at AS delivered_at,
      n.title, n.body, n.link_url, n.sent_at, n.created_at
    FROM platform_notification_deliveries d
    JOIN platform_notifications n ON n.notification_id=d.notification_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY d.created_at DESC
    LIMIT 50`).bind(...params).all();
  const unread = await env.DB.prepare(`SELECT count(*) AS count FROM platform_notification_deliveries
    WHERE membership_id=?1 AND read_at=''`).bind(membershipId).first();
  return {
    ok: true,
    unreadCount: Number(unread?.count || 0),
    items: (rows.results || []).map(deliveryView)
  };
}

export async function markMyNotificationRead(env, principal, notificationId) {
  const membershipId = principal?.membership?.membershipId;
  if (!membershipId) throw notifyError(401, 'Unauthorized.');
  const id = String(notificationId || '').trim();
  if (!id) throw notifyError(400, 'Notification id is required.');
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`UPDATE platform_notification_deliveries
    SET read_at=?3
    WHERE notification_id=?1 AND membership_id=?2 AND read_at=''`)
    .bind(id, membershipId, now).run();
  return { ok: true, updated: Number(result?.meta?.changes || 0) > 0 };
}

export async function markAllMyNotificationsRead(env, principal) {
  const membershipId = principal?.membership?.membershipId;
  if (!membershipId) throw notifyError(401, 'Unauthorized.');
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`UPDATE platform_notification_deliveries
    SET read_at=?2 WHERE membership_id=?1 AND read_at=''`)
    .bind(membershipId, now).run();
  return { ok: true, updated: Number(result?.meta?.changes || 0) };
}

async function resolveRecipients(env, notification) {
  const audience = String(notification.audience || 'all');
  if (audience === 'workspace') {
    const rows = await env.DB.prepare(`SELECT m.membership_id, m.user_id, m.workspace_id
      FROM memberships m
      JOIN workspaces w ON w.workspace_id=m.workspace_id
      WHERE m.workspace_id=?1 AND m.status='active' AND w.status='active'`)
      .bind(notification.workspace_id).all();
    return (rows.results || []).map(recipientRow);
  }
  if (audience === 'email') {
    const email = normalizeEmail(notification.target_email);
    const conditions = [`lower(u.email)=?1`, `m.status='active'`, `w.status='active'`];
    const params = [email];
    if (notification.workspace_id) {
      conditions.push('m.workspace_id=?2');
      params.push(notification.workspace_id);
    }
    const rows = await env.DB.prepare(`SELECT m.membership_id, m.user_id, m.workspace_id
      FROM memberships m
      JOIN users u ON u.user_id=m.user_id
      JOIN workspaces w ON w.workspace_id=m.workspace_id
      WHERE ${conditions.join(' AND ')}`).bind(...params).all();
    return (rows.results || []).map(recipientRow);
  }
  const rows = await env.DB.prepare(`SELECT m.membership_id, m.user_id, m.workspace_id
    FROM memberships m
    JOIN workspaces w ON w.workspace_id=m.workspace_id
    WHERE m.status='active' AND w.status='active'`).all();
  return (rows.results || []).map(recipientRow);
}

async function assertWorkspace(env, workspaceId) {
  const row = await env.DB.prepare(`SELECT workspace_id FROM workspaces WHERE workspace_id=?1`)
    .bind(workspaceId).first();
  if (!row) throw notifyError(404, 'Workspace not found.');
}

function recipientRow(row) {
  return {
    membershipId: row.membership_id,
    userId: row.user_id,
    workspaceId: row.workspace_id
  };
}

function notificationView(row) {
  if (!row) return null;
  return {
    notificationId: row.notification_id,
    title: row.title || '',
    body: row.body || '',
    linkUrl: row.link_url || '',
    audience: row.audience || 'all',
    workspaceId: row.workspace_id || '',
    targetEmail: row.target_email || '',
    status: row.status || 'draft',
    createdByEmail: row.created_by_email || '',
    createdAt: row.created_at || '',
    sentAt: row.sent_at || '',
    recipientCount: Number(row.recipient_count || 0)
  };
}

function deliveryView(row) {
  return {
    deliveryId: row.delivery_id,
    notificationId: row.notification_id,
    title: row.title || '',
    body: row.body || '',
    linkUrl: row.link_url || '',
    readAt: row.read_at || '',
    deliveredAt: row.delivered_at || row.created_at || '',
    sentAt: row.sent_at || row.created_at || '',
    unread: !row.read_at
  };
}

function cleanText(value, label, min, max) {
  const text = String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length < min || text.length > max) throw notifyError(400, `${label} must be ${min} to ${max} characters.`);
  return text;
}

function optionalLink(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length > MAX_LINK) throw notifyError(400, `Link must be at most ${MAX_LINK} characters.`);
  if (/^https?:\/\//i.test(text)) return text;
  if (text.startsWith('/') || text.startsWith('#')) return text;
  throw notifyError(400, 'Link must be an http(s) URL or an app path starting with / or #.');
}

function rejectUnknown(payload, allowed) {
  if (!payload || typeof payload !== 'object') return;
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(payload)) {
    if (!allowedSet.has(key)) throw notifyError(400, `Unknown field: ${key}.`);
  }
}

function notifyError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
