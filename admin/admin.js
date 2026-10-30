'use strict';

const API_BASE = (document.querySelector('meta[name="helixcer-api-base"]')?.content || '').replace(/\/$/, '');
const state = { me: null, clients: [], detail: null, tab: 'clients' };
const $ = id => document.getElementById(id);

function showGate(message) {
  $('gate').hidden = false;
  $('shell').hidden = true;
  const alertBox = $('gateAlert');
  alertBox.hidden = !message;
  alertBox.textContent = message || '';
  $('signInLink').href = loginHref();
}

function showShell(me) {
  $('gate').hidden = true;
  $('shell').hidden = false;
  $('meEmail').textContent = me.user?.email || '';
}

function loginHref() {
  const url = new URL('/auth/google/start', API_BASE || location.origin);
  url.searchParams.set('return_to', `${location.origin}/`);
  return url.toString();
}

async function api(path, options = {}) {
  const headers = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers,
    credentials: 'include',
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload.error === 'string'
      ? payload.error
      : payload.error?.message || `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function handleError(error) {
  if (error?.status === 401) {
    showGate('Your session expired. Sign in again to continue.');
    return;
  }
  toast(error?.message || 'Something went wrong.', true);
}

function toast(message, isError = false) {
  const element = document.createElement('div');
  element.className = `toast${isError ? ' is-error' : ''}`;
  element.textContent = message;
  $('toastRegion').append(element);
  setTimeout(() => element.remove(), isError ? 6000 : 3500);
}

function when(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 0) return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 7 * 86400) return `${Math.round(seconds / 86400)}d ago`;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function cell(text, className) {
  const element = document.createElement('td');
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function statusChip(status) {
  const chip = document.createElement('span');
  chip.className = `chip${status === 'suspended' ? ' is-suspended' : ''}`;
  chip.textContent = status || 'active';
  return chip;
}

async function withBusy(button, task) {
  if (button) button.disabled = true;
  try { return await task(); }
  finally { if (button) button.disabled = false; }
}

/* Navigation */
document.querySelectorAll('[data-tab]').forEach(button => {
  button.addEventListener('click', () => setTab(button.dataset.tab));
});

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('[data-tab]').forEach(button => {
    button.classList.toggle('is-active', button.dataset.tab === tab);
  });
  document.querySelectorAll('[data-panel]').forEach(panel => {
    panel.hidden = panel.dataset.panel !== tab;
  });
  if (tab === 'overview') loadOverview();
  if (tab === 'admins') loadAdmins();
  if (tab === 'clients') loadClients();
}

/* Overview */
async function loadOverview() {
  try {
    const data = await api('/api/platform/overview');
    const stats = [
      ['Clients', data.stats.clients, `${data.stats.activeClients} active · ${data.stats.suspendedClients} suspended`],
      ['New clients', data.stats.newClients, 'in the last 30 days'],
      ['Members', data.stats.members, 'across client workspaces'],
      ['Channels', data.stats.channels, 'connected by clients'],
      ['Conversations', data.stats.conversations, 'across client workspaces']
    ];
    $('stats').replaceChildren(...stats.map(([label, value, hint]) => {
      const card = document.createElement('div');
      card.className = 'stat';
      const name = document.createElement('span');
      name.textContent = label;
      const count = document.createElement('strong');
      count.textContent = String(value);
      const note = document.createElement('small');
      note.textContent = hint;
      card.append(name, count, note);
      return card;
    }));
    const rows = $('recentRows');
    rows.replaceChildren();
    (data.recent || []).forEach(item => {
      const row = document.createElement('tr');
      const company = cell(item.name, 'name');
      const slug = document.createElement('span');
      slug.className = 'sub';
      slug.textContent = item.slug;
      company.append(slug);
      const owner = cell(item.owner.email || '—');
      const status = document.createElement('td');
      status.append(statusChip(item.status));
      row.append(company, owner, status, cell(when(item.createdAt)));
      row.className = 'is-clickable';
      row.addEventListener('click', () => openClient(item.workspaceId));
      rows.append(row);
    });
  } catch (error) {
    handleError(error);
  }
}

/* Clients */
let searchTimer;
$('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadClients, 250);
});
$('statusFilter').addEventListener('change', loadClients);

async function loadClients() {
  try {
    const params = new URLSearchParams();
    const query = $('search').value.trim();
    const status = $('statusFilter').value;
    if (query) params.set('q', query);
    if (status) params.set('status', status);
    const suffix = params.toString() ? `?${params}` : '';
    const data = await api(`/api/platform/clients${suffix}`);
    state.clients = data.items || [];
    renderClients();
  } catch (error) {
    handleError(error);
  }
}

function renderClients() {
  const rows = $('clientRows');
  rows.replaceChildren();
  $('clientsEmpty').hidden = state.clients.length > 0;
  state.clients.forEach(item => {
    const row = document.createElement('tr');
    const company = cell(item.name, 'name');
    const slug = document.createElement('span');
    slug.className = 'sub';
    slug.textContent = `${item.slug} · joined ${when(item.createdAt)}`;
    company.append(slug);
    if (item.kind === 'internal') {
      const badge = document.createElement('span');
      badge.className = 'chip is-internal';
      badge.textContent = 'Internal';
      company.append(badge);
    }
    const owner = cell(item.owner.email || '—');
    if (item.owner.displayName) {
      const name = document.createElement('span');
      name.className = 'sub';
      name.textContent = item.owner.displayName;
      owner.append(name);
    }
    const status = document.createElement('td');
    status.append(statusChip(item.status));
    const members = cell(String(item.counts.members), 'num');
    const channels = cell(String(item.counts.channels), 'num');
    const chats = cell(String(item.counts.conversations), 'num');
    const activity = cell(when(item.lastActivity));
    const actions = document.createElement('td');
    actions.className = 'row-actions';
    const manage = document.createElement('button');
    manage.type = 'button';
    manage.className = 'button button-secondary mini';
    manage.textContent = 'Manage';
    manage.addEventListener('click', () => openClient(item.workspaceId));
    actions.append(manage);
    row.append(company, owner, status, members, channels, chats, activity, actions);
    rows.append(row);
  });
}

$('newClient').addEventListener('click', () => {
  $('createForm').reset();
  $('createFields').hidden = false;
  $('createResult').hidden = true;
  $('createSubmit').hidden = false;
  $('createDialog').showModal();
});

$('createForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('createSubmit');
  await withBusy(button, async () => {
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      const result = await api('/api/platform/clients', { method: 'POST', body: values });
      $('createFields').hidden = true;
      $('createResult').hidden = false;
      $('createSubmit').hidden = true;
      const message = $('createResult').querySelector('p');
      $('createResult').querySelector('.copy-row').hidden = false;
      $('createInviteUrl').value = result.inviteUrl;
      message.textContent = 'Copy this sign-in link and send it to the owner. It opens this workspace and expires in 7 days.';
      toast('Client workspace created.');
      await Promise.all([loadClients(), loadOverview()]);
    } catch (error) {
      handleError(error);
    }
  });
});

/* Client detail */
async function openClient(workspaceId) {
  try {
    const data = await api(`/api/platform/clients/${encodeURIComponent(workspaceId)}`);
    state.detail = data;
    renderDetail(data);
    $('deleteConfirm').value = '';
    $('inviteResult').hidden = true;
    $('inviteForm').reset();
    $('clientDialog').showModal();
  } catch (error) {
    handleError(error);
  }
}

async function reloadDetail() {
  if (!state.detail) return;
  const data = await api(`/api/platform/clients/${encodeURIComponent(state.detail.item.workspaceId)}`);
  state.detail = data;
  renderDetail(data);
}

function renderDetail(data) {
  const item = data.item;
  const isInternal = item.kind === 'internal';
  $('clientTitle').textContent = item.name;
  $('clientSlug').textContent = isInternal ? `${item.slug} · internal workspace` : item.slug;
  const chip = $('clientStatusChip');
  chip.textContent = item.status;
  chip.className = `chip${item.status === 'suspended' ? ' is-suspended' : ''}`;
  const form = $('clientForm');
  form.querySelector('select[name="status"]').closest('.field').hidden = isInternal;
  $('clientDialog').querySelector('.danger-zone').hidden = isInternal;
  form.name.value = item.name;
  form.status.value = item.status;
  form.registeredName.value = item.profile.registeredName;
  form.gstin.value = item.profile.gstin;
  form.addressLine1.value = item.profile.addressLine1;
  form.addressLine2.value = item.profile.addressLine2;
  form.city.value = item.profile.city;
  form.state.value = item.profile.state;
  form.postalCode.value = item.profile.postalCode;
  form.country.value = item.profile.country;
  form.taxDetails.value = item.profile.taxDetails;
  form.notes.value = item.notes;
  renderMembers(data.members || []);
  renderPendingInvites(data.invitations || []);
}

function renderMembers(members) {
  const list = $('memberRows');
  list.replaceChildren();
  if (!members.length) {
    const empty = document.createElement('li');
    empty.className = 'copy';
    empty.textContent = 'No members yet.';
    list.append(empty);
    return;
  }
  const workspaceId = state.detail.item.workspaceId;
  members.forEach(member => {
    const row = document.createElement('li');
    row.className = 'member-item';
    const identity = document.createElement('div');
    identity.className = 'member-id';
    const name = document.createElement('strong');
    name.textContent = member.displayName || member.email;
    const email = document.createElement('small');
    email.textContent = `${member.email} · ${member.status}`;
    identity.append(name, email);
    const controls = document.createElement('div');
    controls.className = 'member-controls';

    const role = document.createElement('select');
    role.className = 'input select';
    ['owner', 'admin', 'agent'].forEach(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value.charAt(0).toUpperCase() + value.slice(1);
      option.selected = member.role === value;
      role.append(option);
    });
    role.addEventListener('change', () => patchMember(workspaceId, member.membershipId, { role: role.value }));

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'button button-secondary mini';
    toggle.textContent = member.status === 'active' ? 'Disable' : 'Enable';
    toggle.addEventListener('click', () => patchMember(workspaceId, member.membershipId, {
      status: member.status === 'active' ? 'disabled' : 'active'
    }));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'button button-quiet mini';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => removeMember(workspaceId, member));

    controls.append(role, toggle, remove);
    row.append(identity, controls);
    list.append(row);
  });
}

function renderPendingInvites(invitations) {
  const container = $('pendingInvites');
  container.replaceChildren();
  const workspaceId = state.detail.item.workspaceId;
  invitations.forEach(invite => {
    const row = document.createElement('div');
    row.className = 'pending-item';
    const label = document.createElement('span');
    label.textContent = `${invite.email} · ${invite.role} · expires ${when(invite.expiresAt)}`;
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'button button-quiet mini';
    cancel.textContent = 'Cancel invite';
    cancel.addEventListener('click', async () => {
      await withBusy(cancel, async () => {
        try {
          await api(`/api/platform/clients/${encodeURIComponent(workspaceId)}/invitations/${encodeURIComponent(invite.invitationId)}`, { method: 'DELETE' });
          toast('Invitation cancelled.');
          await reloadDetail();
        } catch (error) { handleError(error); }
      });
    });
    row.append(label, cancel);
    container.append(row);
  });
}

async function patchMember(workspaceId, membershipId, body) {
  try {
    const result = await api(`/api/platform/clients/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(membershipId)}`, {
      method: 'PATCH', body
    });
    toast(result.item?.status === 'disabled' ? 'Member disabled and signed out.' : 'Member updated.');
    await reloadDetail();
    await loadClients();
  } catch (error) {
    handleError(error);
    await reloadDetail();
  }
}

async function removeMember(workspaceId, member) {
  if (!confirm(`Remove ${member.email} from this workspace?`)) return;
  try {
    await api(`/api/platform/clients/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(member.membershipId)}`, { method: 'DELETE' });
    toast('Member removed.');
    await reloadDetail();
    await loadClients();
  } catch (error) {
    handleError(error);
  }
}

$('clientForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const button = form.querySelector('button[type="submit"]');
  await withBusy(button, async () => {
    try {
      const result = await api(`/api/platform/clients/${encodeURIComponent(state.detail.item.workspaceId)}`, {
        method: 'PATCH', body: values
      });
      toast(result.suspended ? 'Client suspended. Active sessions were signed out.' : 'Changes saved.');
      await reloadDetail();
      await Promise.all([loadClients(), loadOverview()]);
    } catch (error) {
      handleError(error);
    }
  });
});

$('inviteForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const button = form.querySelector('button[type="submit"]');
  await withBusy(button, async () => {
    try {
      const result = await api(`/api/platform/clients/${encodeURIComponent(state.detail.item.workspaceId)}/invitations`, {
        method: 'POST', body: values
      });
      $('memberInviteUrl').value = result.inviteUrl;
      $('inviteResult').hidden = false;
      toast('Invitation created. Copy the link for the teammate.');
      form.reset();
      await reloadDetail();
    } catch (error) {
      handleError(error);
    }
  });
});

$('deleteClient').addEventListener('click', async () => {
  const item = state.detail?.item;
  if (!item) return;
  const confirmation = $('deleteConfirm').value.trim();
  if (confirmation !== item.slug) {
    toast(`Type "${item.slug}" to confirm deletion.`, true);
    return;
  }
  if (!confirm(`Permanently delete ${item.name}? All members, channels, conversations and messages will be removed.`)) return;
  await withBusy($('deleteClient'), async () => {
    try {
      await api(`/api/platform/clients/${encodeURIComponent(item.workspaceId)}`, {
        method: 'DELETE', body: { confirmSlug: confirmation }
      });
      $('clientDialog').close();
      state.detail = null;
      toast('Workspace permanently deleted.');
      await Promise.all([loadClients(), loadOverview()]);
    } catch (error) {
      handleError(error);
    }
  });
});

/* Platform admins */
async function loadAdmins() {
  try {
    const data = await api('/api/platform/admins');
    const rows = $('adminRows');
    rows.replaceChildren();
    (data.items || []).forEach(admin => {
      const row = document.createElement('tr');
      row.append(cell(admin.email, 'name'));
      const status = document.createElement('td');
      const chip = document.createElement('span');
      chip.className = `chip${admin.status === 'active' ? '' : ' is-muted'}`;
      chip.textContent = admin.status;
      status.append(chip);
      row.append(status);
      row.append(cell(admin.isBootstrap ? 'Bootstrap owner' : admin.hasAccount ? 'Google account' : 'Invited — no account yet'));
      const actions = document.createElement('td');
      actions.className = 'row-actions';
      if (!admin.isBootstrap) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'button button-quiet mini';
        remove.textContent = 'Remove access';
        remove.addEventListener('click', () => removeAdmin(admin));
        actions.append(remove);
      }
      row.append(actions);
      rows.append(row);
    });
  } catch (error) {
    handleError(error);
  }
}

$('adminForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const button = form.querySelector('button[type="submit"]');
  await withBusy(button, async () => {
    try {
      const result = await api('/api/platform/admins', { method: 'POST', body: values });
      $('adminInvite').hidden = !result.inviteUrl;
      if (result.inviteUrl) $('adminInviteUrl').value = result.inviteUrl;
      toast(result.inviteUrl ? 'Platform admin added. Send them the invite link.' : 'Platform admin added.');
      form.reset();
      await loadAdmins();
    } catch (error) {
      handleError(error);
    }
  });
});

async function removeAdmin(admin) {
  if (!confirm(`Remove platform administrator access for ${admin.email}?`)) return;
  try {
    await api(`/api/platform/admins/${encodeURIComponent(admin.adminId)}`, { method: 'DELETE' });
    toast('Platform administrator removed.');
    await loadAdmins();
  } catch (error) {
    handleError(error);
  }
}

/* Shared behaviour */
document.addEventListener('click', event => {
  const close = event.target.closest('[data-close]');
  if (close) {
    const dialog = document.getElementById(close.dataset.close);
    if (dialog) dialog.close();
  }
  const copy = event.target.closest('[data-copy]');
  if (copy) {
    const input = document.getElementById(copy.dataset.copy);
    if (!input) return;
    const text = input.value;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => toast('Copied.')).catch(() => fallbackCopy(input));
    } else {
      fallbackCopy(input);
    }
  }
});

function fallbackCopy(input) {
  input.focus();
  input.select();
  try {
    document.execCommand('copy');
    toast('Copied.');
  } catch {
    toast('Select the link and copy it manually.', true);
  }
}

$('signOut').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST', body: {} }); } catch { /* sign out locally anyway */ }
  showGate('You have been signed out.');
});

(async function boot() {
  $('inboxLink').href = 'https://chat.helixcer.com';
  try {
    const me = await api('/api/platform/me');
    state.me = me;
    showShell(me);
    setTab('clients');
  } catch (error) {
    if (error.status === 403) showGate('This Google account is not a Helixcer platform administrator.');
    else if (error.status === 401) showGate('');
    else showGate(error.message);
  }
})();
