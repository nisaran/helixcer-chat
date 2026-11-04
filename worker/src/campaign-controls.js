export const campaignActionEligible = (action, status) => ({
  pause: ['queued', 'sending'], resume: ['paused', 'queued', 'sending'],
  cancel: ['paused', 'queued', 'sending']
}[action] || []).includes(status);

export async function applyCampaignActions(env, workspaceId, ids, action, principal, authorize) {
  if (!['pause', 'resume', 'cancel'].includes(action) || !Array.isArray(ids) || !ids.length || ids.length > 100
    || ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id))) {
    throw Object.assign(new Error('Select 1–100 campaigns and a valid action.'), { status: 400 });
  }
  const rows = [];
  for (const id of [...new Set(ids)]) {
    // Authorize the entire selection before changing anything.
    const row = await env.DB.prepare('SELECT campaign_id,channel_id,status FROM campaigns WHERE workspace_id=?1 AND campaign_id=?2')
      .bind(workspaceId, id).first();
    if (!row) throw Object.assign(new Error('Campaign not found.'), { status: 404 });
    authorize(principal, row.channel_id);
    if (campaignActionEligible(action, row.status)) rows.push(row);
  }
  const now = new Date().toISOString();
  const snapshot = JSON.stringify({ user: { userId: principal?.user?.userId, email: principal?.user?.email, displayName: principal?.user?.displayName },
    membership: principal?.membership, workspace: principal?.workspace, permissions: principal?.permissions, authType: principal?.authType });
  const statements = [];
  for (const row of rows) {
    const id = row.campaign_id;
    statements.push(env.DB.prepare(`UPDATE campaigns SET status=?3,updated_at=?4,
      completed_at=CASE WHEN ?3='cancelled' THEN ?4 ELSE completed_at END
      WHERE workspace_id=?1 AND campaign_id=?2 AND status IN ('queued','sending','paused')`)
      .bind(workspaceId, id, action === 'cancel' ? 'cancelled' : action === 'pause' ? 'paused' : 'queued', now));
    if (action === 'resume') {
      statements.push(env.DB.prepare(`INSERT INTO campaign_jobs (campaign_id,workspace_id,principal_json,state,lease_until,created_at)
        SELECT campaign_id,workspace_id,?3,'active','',?4 FROM campaigns
        WHERE workspace_id=?1 AND campaign_id=?2 AND status IN ('queued','sending')
        ON CONFLICT(campaign_id) DO UPDATE SET state='active',principal_json=excluded.principal_json`)
        .bind(workspaceId, id, snapshot, now));
    } else {
      statements.push(env.DB.prepare('UPDATE campaign_jobs SET state=?3 WHERE workspace_id=?1 AND campaign_id=?2')
        .bind(workspaceId, id, action === 'pause' ? 'paused' : 'done'));
    }
    if (action === 'cancel') {
      statements.push(env.DB.prepare(`UPDATE messages SET status='cancelled' WHERE workspace_id=?1
        AND status IN ('pending','queued','retrying') AND provider_message_id=''
        AND message_id IN (SELECT message_id FROM campaign_recipients WHERE workspace_id=?1 AND campaign_id=?2)`)
        .bind(workspaceId, id));
      statements.push(env.DB.prepare(`DELETE FROM outbox WHERE workspace_id=?1 AND message_id IN
        (SELECT message_id FROM campaign_recipients WHERE workspace_id=?1 AND campaign_id=?2)`)
        .bind(workspaceId, id));
      statements.push(env.DB.prepare(`DELETE FROM outbound_payloads WHERE workspace_id=?1 AND message_id IN
        (SELECT message_id FROM campaign_recipients WHERE workspace_id=?1 AND campaign_id=?2)`)
        .bind(workspaceId, id));
      statements.push(env.DB.prepare(`UPDATE campaign_recipients SET status='cancelled',updated_at=?3
        WHERE workspace_id=?1 AND campaign_id=?2 AND status IN ('pending','queued')`)
        .bind(workspaceId, id, now));
      statements.push(env.DB.prepare('UPDATE campaigns SET pending_count=0 WHERE workspace_id=?1 AND campaign_id=?2')
        .bind(workspaceId, id));
    }
  }
  if (statements.length) await env.DB.batch(statements);
  return { affectedIds: rows.map(row => row.campaign_id), skipped: new Set(ids).size - rows.length };
}

export async function campaignDispatchState(env, messageId) {
  try {
    return (await env.DB.prepare(`SELECT c.status FROM campaign_recipients r JOIN campaigns c
      ON c.workspace_id=r.workspace_id AND c.campaign_id=r.campaign_id WHERE r.message_id=?1 LIMIT 1`)
      .bind(messageId).first())?.status || '';
  } catch (error) {
    if (/no such table/.test(String(error.message))) return '';
    throw error;
  }
}
