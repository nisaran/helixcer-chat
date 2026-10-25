(() => {
  "use strict";

  const RECOVERY_TOKEN_KEY = "helixcer_recovery_token";
  const DEFAULT_WORKSPACE = "Helixcer workspace";

  const $ = (id) => document.getElementById(id);
  const state = {
    route: "inbox",
    filter: "all",
    search: "",
    contactSearch: "",
    channels: [],
    contacts: [],
    conversations: [],
    messages: new Map(),
    selectedConversationId: null,
    detailsOpen: false,
    currentUser: null,
    workspace: { name: DEFAULT_WORKSPACE, workspaceId: "default", slug: "helixcer" },
    team: { members: [], invitations: [] },
    authStatus: "checking",
    api: null,
    disconnectRealtime: null,
    loading: true,
  };

  const channelStyles = {
    whatsapp_cloud: { label: "WhatsApp", short: "WA", color: "#168f66", soft: "#e7f6ef" },
    whatsapp: { label: "WhatsApp", short: "WA", color: "#168f66", soft: "#e7f6ef" },
    telegram: { label: "Telegram", short: "TG", color: "#2d8bc0", soft: "#e8f4fa" },
    webchat: { label: "Web chat", short: "WB", color: "#9a4f37", soft: "#faeee9" },
    web_chat: { label: "Web chat", short: "WB", color: "#9a4f37", soft: "#faeee9" },
    email: { label: "Email", short: "EM", color: "#7b5ba9", soft: "#f0ebf8" },
    gmail: { label: "Gmail", short: "GM", color: "#c44d3b", soft: "#faece9" },
    instagram: { label: "Instagram", short: "IG", color: "#b6427b", soft: "#f9eaf2" },
    generic: { label: "Custom", short: "API", color: "#5e6c69", soft: "#edf0ef" },
  };

  const avatarPalettes = [
    ["#e9e1f6", "#674e93"],
    ["#e2f1ed", "#356f5e"],
    ["#f7e6de", "#974d36"],
    ["#e4edf7", "#3d6691"],
    ["#f3ead7", "#8c672e"],
  ];

  const demoSeed = () => {
    const now = Date.now();
    const ago = (minutes) => new Date(now - minutes * 60_000).toISOString();
    return {
      appName: "Helixcer Chat",
      me: {
        authenticated: true,
        user: { userId: "demo-owner", email: "owner@helixcer.example", displayName: "Nisar", avatarUrl: "" },
        workspace: { workspaceId: "demo", name: "Helixcer workspace", slug: "helixcer" },
        membership: { membershipId: "demo-membership-owner", role: "owner", status: "active" },
      },
      team: {
        members: [
          { membershipId: "demo-membership-owner", userId: "demo-owner", email: "owner@helixcer.example", displayName: "Nisar", avatarUrl: "", role: "owner", status: "active", createdAt: ago(43200) },
          { membershipId: "demo-membership-admin", userId: "demo-admin", email: "admin@helixcer.example", displayName: "Asha Rao", avatarUrl: "", role: "admin", status: "active", createdAt: ago(20160) },
          { membershipId: "demo-membership-agent", userId: "demo-agent", email: "agent@helixcer.example", displayName: "Kiran Shah", avatarUrl: "", role: "agent", status: "active", createdAt: ago(10080) },
        ],
        invitations: [
          { invitationId: "demo-invite", email: "new.agent@helixcer.example", role: "agent", status: "pending", expiresAt: ago(-10080), createdAt: ago(40) },
        ],
      },
      channels: [
        { channelId: "wa-main", name: "Main WhatsApp", connectorType: "whatsapp_cloud", enabled: true, health: "connected", messagesToday: 86 },
        { channelId: "telegram-support", name: "Telegram Support", connectorType: "telegram", enabled: true, health: "connected", messagesToday: 31 },
        { channelId: "web-main", name: "Website Chat", connectorType: "webchat", enabled: true, health: "connected", messagesToday: 18 },
      ],
      contacts: [
        { contactId: "ct-ananya", displayName: "Ananya Sharma", channelId: "wa-main", channelProfileId: "+91 98••• 1402", phone: "+91 98••• 1402", email: "ananya@example.com", tags: ["Priority", "Returning"] },
        { contactId: "ct-david", displayName: "David Miller", channelId: "telegram-support", channelProfileId: "@davidm", phone: "—", email: "david@example.com", tags: ["New lead"] },
        { contactId: "ct-meera", displayName: "Meera Iyer", channelId: "web-main", channelProfileId: "Visitor #8421", phone: "—", email: "meera@example.com", tags: ["Website"] },
        { contactId: "ct-ravi", displayName: "Ravi Menon", channelId: "wa-main", channelProfileId: "+91 97••• 7780", phone: "+91 97••• 7780", email: "ravi@example.com", tags: ["Billing"] },
        { contactId: "ct-lina", displayName: "Lina George", channelId: "telegram-support", channelProfileId: "@linag", phone: "—", email: "lina@example.com", tags: ["Resolved"] },
      ],
      conversations: [
        { conversationId: "cv-ananya", contactId: "ct-ananya", subject: "Ananya Sharma", channelId: "wa-main", status: "open", assignedTo: "Nisar", priority: "high", unreadCount: 2, lastMessage: "Could you confirm when my order will arrive?", lastMessageAt: ago(3) },
        { conversationId: "cv-david", contactId: "ct-david", subject: "David Miller", channelId: "telegram-support", status: "open", assignedTo: "Unassigned", unreadCount: 1, lastMessage: "I need help choosing the right plan.", lastMessageAt: ago(18) },
        { conversationId: "cv-meera", contactId: "ct-meera", subject: "Meera Iyer", channelId: "web-main", status: "pending", assignedTo: "Nisar", unreadCount: 0, lastMessage: "Thank you, that answers my question.", lastMessageAt: ago(57) },
        { conversationId: "cv-ravi", contactId: "ct-ravi", subject: "Ravi Menon", channelId: "wa-main", status: "open", assignedTo: "Nisar", unreadCount: 0, lastMessage: "The invoice amount looks different.", lastMessageAt: ago(145) },
        { conversationId: "cv-lina", contactId: "ct-lina", subject: "Lina George", channelId: "telegram-support", status: "closed", assignedTo: "Nisar", unreadCount: 0, lastMessage: "Perfect, everything works now!", lastMessageAt: ago(1450) },
      ],
      messages: {
        "cv-ananya": [
          { messageId: "msg-a1", direction: "inbound", text: "Hi! I placed an order yesterday and wanted to check the delivery date.", timestamp: ago(31), status: "received", senderName: "Ananya" },
          { messageId: "msg-a2", direction: "outbound", text: "Hello Ananya — happy to help. Could you share the last four digits of your order number?", timestamp: ago(27), status: "delivered", senderName: "Nisar" },
          { messageId: "msg-a3", direction: "inbound", text: "It ends in 4821.", timestamp: ago(7), status: "received", senderName: "Ananya" },
          { messageId: "msg-a4", direction: "inbound", text: "Could you confirm when my order will arrive?", timestamp: ago(3), status: "received", senderName: "Ananya" },
        ],
        "cv-david": [
          { messageId: "msg-d1", direction: "inbound", text: "Hello, I found you through your website.", timestamp: ago(24), status: "received", senderName: "David" },
          { messageId: "msg-d2", direction: "inbound", text: "I need help choosing the right plan.", timestamp: ago(18), status: "received", senderName: "David" },
        ],
        "cv-meera": [
          { messageId: "msg-m1", direction: "inbound", text: "Does the starter package include onboarding?", timestamp: ago(75), status: "received", senderName: "Meera" },
          { messageId: "msg-m2", direction: "outbound", text: "Yes, it includes a guided setup call and our onboarding checklist.", timestamp: ago(65), status: "read", senderName: "Nisar" },
          { messageId: "msg-m3", direction: "inbound", text: "Thank you, that answers my question.", timestamp: ago(57), status: "received", senderName: "Meera" },
        ],
        "cv-ravi": [
          { messageId: "msg-r1", direction: "inbound", text: "The invoice amount looks different from the quotation. Can you check?", timestamp: ago(145), status: "received", senderName: "Ravi" },
        ],
        "cv-lina": [
          { messageId: "msg-l1", direction: "outbound", text: "I have reset the connection. Please try once more.", timestamp: ago(1460), status: "read", senderName: "Nisar" },
          { messageId: "msg-l2", direction: "inbound", text: "Perfect, everything works now!", timestamp: ago(1450), status: "received", senderName: "Lina" },
        ],
      },
    };
  };

  function clone(value) {
    return typeof structuredClone === "function"
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  }

  class DemoApi {
    constructor() {
      this.data = demoSeed();
      this.listener = null;
    }

    async bootstrap() {
      await smallDelay();
      return clone({
        appName: this.data.appName,
        me: this.data.me,
        channels: this.data.channels,
        contacts: this.data.contacts,
        conversations: this.data.conversations,
      });
    }

    async me() {
      await smallDelay(120);
      return clone(this.data.me);
    }

    async logout() {
      await smallDelay(80);
      return { ok: true };
    }

    async getTeam() {
      await smallDelay(140);
      return clone(this.data.team);
    }

    async inviteMember(payload) {
      const suffix = Date.now().toString(36);
      const invitation = {
        invitationId: `invite-${suffix}`,
        email: payload.email,
        role: payload.role,
        status: "pending",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
      };
      this.data.team.invitations.unshift(invitation);
      return { ok: true, invitation: clone(invitation), inviteUrl: `${location.origin}${location.pathname}?invite=${suffix}` };
    }

    async updateMember(membershipId, patch) {
      const item = this.data.team.members.find((member) => member.membershipId === membershipId);
      if (!item) throw new Error("Member not found");
      Object.assign(item, patch);
      return { ok: true, item: clone(item) };
    }

    async cancelInvitation(invitationId) {
      const item = this.data.team.invitations.find((invitation) => invitation.invitationId === invitationId);
      if (!item) throw new Error("Invitation not found");
      item.status = "cancelled";
      return { ok: true, item: clone(item) };
    }

    async getMessages(conversationId) {
      await smallDelay(100);
      return { items: clone(this.data.messages[conversationId] || []) };
    }

    async sendMessage(conversationId, text) {
      const item = {
        messageId: `demo-${Date.now()}`,
        direction: "outbound",
        text,
        timestamp: new Date().toISOString(),
        status: "sent",
        senderName: "You",
      };
      this.data.messages[conversationId] ||= [];
      this.data.messages[conversationId].push(item);
      const conversation = this.data.conversations.find((entry) => entry.conversationId === conversationId);
      if (conversation) {
        conversation.lastMessage = text;
        conversation.lastMessageAt = item.timestamp;
      }
      await smallDelay(160);
      return { ok: true, item: clone(item) };
    }

    async updateConversation(conversationId, patch) {
      const item = this.data.conversations.find((entry) => entry.conversationId === conversationId);
      if (!item) throw new Error("Conversation not found");
      if (patch.status) item.status = patch.status;
      if (Object.prototype.hasOwnProperty.call(patch, "assignedTo")) item.assignedTo = patch.assignedTo || "Unassigned";
      if (patch.markRead) item.unreadCount = 0;
      this.emit({ type: "conversation.updated", conversation: clone(item), item: clone(item) });
      return { ok: true, item: clone(item) };
    }

    async createContact(payload) {
      const suffix = Date.now().toString(36);
      const contact = {
        contactId: `ct-${suffix}`,
        displayName: payload.displayName,
        channelId: payload.channelId,
        channelProfileId: payload.channelProfileId,
        phone: payload.channelProfileId,
        email: "—",
        tags: ["New"],
      };
      const conversation = {
        conversationId: `cv-${suffix}`,
        contactId: contact.contactId,
        subject: contact.displayName,
        channelId: contact.channelId,
        status: "open",
        assignedTo: "Unassigned",
        unreadCount: 0,
        lastMessage: "New conversation",
        lastMessageAt: new Date().toISOString(),
      };
      this.data.contacts.unshift(contact);
      this.data.conversations.unshift(conversation);
      this.data.messages[conversation.conversationId] = [];
      this.emit({ type: "conversation.created", conversation: clone(conversation), item: clone(conversation) });
      return { ok: true, contactId: contact.contactId, conversationId: conversation.conversationId, item: clone(conversation) };
    }

    async saveChannel(payload) {
      const channel = {
        ...payload,
        channelId: payload.channelId,
        enabled: payload.enabled !== false,
        health: "connected",
      };
      const index = this.data.channels.findIndex((entry) => entry.channelId === channel.channelId);
      if (index >= 0) this.data.channels[index] = channel;
      else this.data.channels.push(channel);
      this.emit({ type: "channel.updated", channelId: channel.channelId });
      await smallDelay(120);
      return { ok: true, channelId: channel.channelId };
    }

    connect(listener, onState) {
      this.listener = listener;
      onState("demo");
      return () => { this.listener = null; };
    }

    emit(event) {
      if (this.listener) this.listener(event);
    }
  }

  class ApiClient {
    constructor(base, recoveryToken = "") {
      this.base = (base || "").trim().replace(/\/+$/, "");
      this.recoveryToken = (recoveryToken || "").trim();
      this.isDemo = !this.base;
      this.demo = this.isDemo ? new DemoApi() : null;
      this.socket = null;
      this.reconnectTimer = null;
      this.closedByClient = false;
    }

    async request(path, options = {}) {
      const headers = new Headers(options.headers || {});
      headers.set("Accept", "application/json");
      if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      if (this.recoveryToken) headers.set("Authorization", `Bearer ${this.recoveryToken}`);
      const response = await fetch(`${this.base}${path}`, { ...options, headers, credentials: "include" });
      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json") ? await response.json() : await response.text();
      if (!response.ok) {
        const message = typeof payload === "object" && payload
          ? payload.error || payload.message
          : String(payload || "");
        const error = new Error(message || `Request failed (${response.status})`);
        error.status = response.status;
        if (response.status === 401 && path !== "/api/me") window.dispatchEvent(new CustomEvent("helixcer:unauthorized"));
        throw error;
      }
      return payload;
    }

    loginUrl() {
      if (this.isDemo) return "#";
      const url = new URL("/auth/google/start", this.base);
      url.searchParams.set("return_to", location.origin);
      const invite = new URLSearchParams(location.search).get("invite");
      if (invite) url.searchParams.set("invite", invite);
      return url.toString();
    }

    me() {
      return this.isDemo ? this.demo.me() : this.request("/api/me");
    }

    logout() {
      return this.isDemo ? this.demo.logout() : this.request("/api/logout", { method: "POST" });
    }

    bootstrap() {
      return this.isDemo ? this.demo.bootstrap() : this.request("/api/bootstrap");
    }

    getMessages(conversationId) {
      return this.isDemo
        ? this.demo.getMessages(conversationId)
        : this.request(`/api/conversations/${encodeURIComponent(conversationId)}/messages?limit=100`);
    }

    sendMessage(conversationId, text) {
      return this.isDemo
        ? this.demo.sendMessage(conversationId, text)
        : this.request(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
          method: "POST",
          body: JSON.stringify({ text }),
        });
    }

    updateConversation(conversationId, patch) {
      return this.isDemo
        ? this.demo.updateConversation(conversationId, patch)
        : this.request(`/api/conversations/${encodeURIComponent(conversationId)}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
    }

    createContact(payload) {
      return this.isDemo
        ? this.demo.createContact(payload)
        : this.request("/api/contacts", { method: "POST", body: JSON.stringify(payload) });
    }

    saveChannel(payload) {
      return this.isDemo
        ? this.demo.saveChannel(payload)
        : this.request("/api/channels", { method: "POST", body: JSON.stringify(payload) });
    }

    getTeam() {
      return this.isDemo ? this.demo.getTeam() : this.request("/api/team");
    }

    inviteMember(payload) {
      return this.isDemo
        ? this.demo.inviteMember(payload)
        : this.request("/api/team/invitations", { method: "POST", body: JSON.stringify(payload) });
    }

    updateMember(membershipId, patch) {
      return this.isDemo
        ? this.demo.updateMember(membershipId, patch)
        : this.request(`/api/team/members/${encodeURIComponent(membershipId)}`, { method: "PATCH", body: JSON.stringify(patch) });
    }

    cancelInvitation(invitationId) {
      return this.isDemo
        ? this.demo.cancelInvitation(invitationId)
        : this.request(`/api/team/invitations/${encodeURIComponent(invitationId)}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) });
    }

    connect(listener, onState) {
      if (this.isDemo) return this.demo.connect(listener, onState);
      if (this.recoveryToken) {
        onState("recovery");
        return () => {};
      }
      this.closedByClient = false;
      const openSocket = () => {
        const url = new URL(this.base);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.pathname = `${url.pathname.replace(/\/$/, "")}/api/realtime`;
        url.search = "";
        onState("connecting");
        const socket = new WebSocket(url);
        this.socket = socket;
        socket.addEventListener("open", () => onState("online"));
        socket.addEventListener("message", (event) => {
          try { listener(JSON.parse(event.data)); }
          catch { /* Ignore non-JSON keepalives. */ }
        });
        socket.addEventListener("error", () => onState("error"));
        socket.addEventListener("close", () => {
          this.socket = null;
          if (this.closedByClient) return;
          onState("offline");
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = setTimeout(openSocket, 3500);
        });
      };
      openSocket();
      return () => {
        this.closedByClient = true;
        clearTimeout(this.reconnectTimer);
        if (this.socket) this.socket.close();
      };
    }
  }

  function smallDelay(ms = 220) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function initialApiBase() {
    const configured = document.querySelector('meta[name="helixcer-api-base"]')?.content || "";
    if (["localhost", "127.0.0.1"].includes(location.hostname)) return "";
    return configured;
  }

  function createApi() {
    if (state.disconnectRealtime) state.disconnectRealtime();
    state.disconnectRealtime = null;
    state.api = new ApiClient(initialApiBase(), sessionStorage.getItem(RECOVERY_TOKEN_KEY) || "");
    $("sidebarMode").textContent = state.api.isDemo ? "Demo workspace" : "Live workspace";
    $("googleSignInLink").href = state.api.loginUrl();
  }

  function startRealtime() {
    if (state.disconnectRealtime) state.disconnectRealtime();
    state.disconnectRealtime = state.api.connect(handleRealtimeEvent, setConnectionState);
  }

  function normalizeAuth(payload) {
    const source = payload?.me || payload || {};
    const user = source.user || {};
    const membership = source.membership || {};
    return {
      authenticated: source.authenticated !== false,
      userId: String(user.userId || user.id || ""),
      email: String(user.email || ""),
      displayName: user.displayName || user.name || user.email?.split("@")[0] || "Team member",
      avatarUrl: user.avatarUrl || user.picture || "",
      membershipId: String(membership.membershipId || membership.id || ""),
      role: ["owner", "admin", "agent"].includes(membership.role) ? membership.role : "agent",
      status: membership.status || "active",
      workspace: source.workspace || { workspaceId: "default", name: DEFAULT_WORKSPACE, slug: "helixcer" },
    };
  }

  function canAdmin() {
    return state.currentUser && ["owner", "admin"].includes(state.currentUser.role);
  }

  function isOwner() {
    return state.currentUser?.role === "owner";
  }

  function showAuthChecking() {
    state.authStatus = "checking";
    $("authGate").hidden = false;
    $("authChecking").hidden = false;
    $("signedOutContent").hidden = true;
    $("appShell").hidden = true;
  }

  function showSignedOut(message = "") {
    state.authStatus = "signed-out";
    state.currentUser = null;
    if (state.disconnectRealtime) state.disconnectRealtime();
    state.disconnectRealtime = null;
    $("appShell").hidden = true;
    $("authGate").hidden = false;
    $("authChecking").hidden = true;
    $("signedOutContent").hidden = false;
    $("googleSignInLink").href = state.api?.loginUrl() || "#";
    const alert = $("authAlert");
    alert.hidden = !message;
    alert.textContent = message;
    closeMobileMenu();
  }

  function showApplication(auth) {
    state.authStatus = "authenticated";
    state.currentUser = auth;
    state.workspace = auth.workspace || state.workspace;
    $("authGate").hidden = true;
    $("appShell").hidden = false;
    renderCurrentUser();
    applyPermissions();
    startRealtime();
  }

  function renderCurrentUser() {
    const user = state.currentUser;
    if (!user) return;
    const displayName = user.displayName || user.email || "Team member";
    $("currentUserName").textContent = displayName;
    $("currentUserRole").textContent = user.role;
    $("userMenuName").textContent = displayName;
    $("userMenuEmail").textContent = user.email || "Recovery access";
    $("userMenuRole").textContent = user.role;
    $("currentUserInitials").textContent = initials(displayName);
    const avatarImage = $("currentUserAvatarImage");
    const safeAvatar = safeAvatarUrl(user.avatarUrl);
    avatarImage.hidden = !safeAvatar;
    $("currentUserInitials").hidden = Boolean(safeAvatar);
    if (safeAvatar) avatarImage.src = safeAvatar;
    else avatarImage.removeAttribute("src");
    $("sidebarMode").textContent = state.api.isDemo ? "Demo workspace" : `${capitalize(user.role)} access`;
  }

  function applyPermissions() {
    const admin = canAdmin();
    document.querySelectorAll("[data-admin-only]").forEach((node) => { node.hidden = !admin; });
    document.querySelectorAll("[data-owner-only]").forEach((node) => { node.hidden = !isOwner(); node.disabled = !isOwner(); });
    if (!admin && ["channels", "team"].includes(state.route)) setRoute("inbox");
  }

  async function initializeSession() {
    showAuthChecking();
    createApi();
    try {
      let authPayload;
      try {
        authPayload = await state.api.me();
      } catch (error) {
        if (!state.api.recoveryToken || ![401, 404].includes(error.status)) throw error;
        await state.api.bootstrap();
        authPayload = {
          authenticated: true,
          user: { userId: "recovery", email: "", displayName: "Recovery administrator", avatarUrl: "" },
          workspace: { workspaceId: "default", name: DEFAULT_WORKSPACE, slug: "helixcer" },
          membership: { membershipId: "recovery", role: "owner", status: "active" },
        };
      }
      const auth = normalizeAuth(authPayload);
      if (!auth.authenticated || auth.status !== "active") throw Object.assign(new Error("Your workspace access is not active."), { status: 403 });
      showApplication(auth);
      await Promise.all([loadAll({ preserveSelection: false }), canAdmin() ? loadTeam() : Promise.resolve()]);
    } catch (error) {
      const message = error.status === 403
        ? "Your account does not currently have access to this workspace."
        : error.status === 401
          ? "Sign in with an approved Google account to continue."
          : "We could not reach the secure session service. Please try again.";
      showSignedOut(message);
    }
  }

  function asItems(value) {
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.items)) return value.items;
    return [];
  }

  function normalizeChannel(raw) {
    const connectorType = raw.connectorType || raw.type || "generic";
    return {
      ...raw,
      channelId: String(raw.channelId || raw.id || "unknown"),
      name: raw.name || raw.displayName || channelStyles[connectorType]?.label || "Channel",
      connectorType,
      enabled: raw.enabled !== false,
      health: raw.health || (raw.enabled === false ? "disconnected" : "connected"),
    };
  }

  function normalizeConversation(raw) {
    return {
      ...raw,
      conversationId: String(raw.conversationId || raw.id || ""),
      contactId: String(raw.contactId || raw.contact?.contactId || raw.contact?.id || ""),
      subject: raw.subject || raw.contactName || raw.displayName || raw.contact?.displayName || "Unknown contact",
      channelId: String(raw.channelId || raw.channel?.channelId || raw.channel?.id || "unknown"),
      status: raw.status || "open",
      assignedTo: raw.assignedTo || raw.assignee || "Unassigned",
      unreadCount: Number(raw.unreadCount ?? raw.unread ?? 0),
      lastMessage: raw.lastMessage?.text || raw.lastMessageText || raw.preview || raw.lastMessage || "No messages yet",
      lastMessageAt: raw.lastMessageAt || raw.updatedAt || raw.createdAt || new Date().toISOString(),
      channelProfileId: raw.channelProfileId || raw.contact?.channelProfileId || "",
    };
  }

  function normalizeContact(raw) {
    return {
      ...raw,
      contactId: String(raw.contactId || raw.id || ""),
      displayName: raw.displayName || raw.name || "Unknown contact",
      channelId: String(raw.channelId || raw.identities?.[0]?.channelId || "unknown"),
      channelProfileId: raw.channelProfileId || raw.identity || raw.identities?.[0]?.channelProfileId || "—",
      email: raw.email || "—",
      phone: raw.phone || "—",
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      status: raw.status || "active",
    };
  }

  function normalizeMessage(raw) {
    return {
      ...raw,
      messageId: String(raw.messageId || raw.id || `message-${Date.now()}-${Math.random().toString(36).slice(2)}`),
      direction: raw.direction === "outbound" ? "outbound" : "inbound",
      text: raw.text || raw.body || raw.content || "",
      timestamp: raw.timestamp || raw.createdAt || raw.sentAt || new Date().toISOString(),
      status: raw.status || (raw.direction === "outbound" ? "sent" : "received"),
      senderName: raw.senderName || raw.sender || "",
    };
  }

  function deriveContacts(conversations) {
    const byId = new Map();
    conversations.forEach((conversation) => {
      const key = conversation.contactId || `conversation:${conversation.conversationId}`;
      if (byId.has(key)) return;
      byId.set(key, normalizeContact({
        contactId: key,
        displayName: conversation.subject,
        channelId: conversation.channelId,
        channelProfileId: conversation.channelProfileId || "—",
        email: conversation.email || "—",
        phone: conversation.phone || "—",
        tags: conversation.tags || [],
        status: conversation.status === "closed" ? "inactive" : "active",
      }));
    });
    return [...byId.values()];
  }

  async function loadAll({ preserveSelection = true } = {}) {
    state.loading = true;
    renderConversationList();
    try {
      const data = await state.api.bootstrap();
      if (data.me) {
        state.currentUser = normalizeAuth(data.me);
        state.workspace = state.currentUser.workspace || state.workspace;
        renderCurrentUser();
        applyPermissions();
      }
      state.channels = asItems(data.channels).map(normalizeChannel);
      state.conversations = asItems(data.conversations).map(normalizeConversation);
      state.contacts = asItems(data.contacts).map(normalizeContact);
      if (!state.contacts.length) state.contacts = deriveContacts(state.conversations);
      if (!preserveSelection || !state.conversations.some((item) => item.conversationId === state.selectedConversationId)) {
        state.selectedConversationId = null;
      }
      renderAll();
      if (state.selectedConversationId) await selectConversation(state.selectedConversationId, { markRead: false });
    } catch (error) {
      state.conversations = [];
      renderAll();
      setConnectionState("error");
      showToast("Unable to load the workspace", error.message, true);
    } finally {
      state.loading = false;
      renderConversationList();
    }
  }

  function renderAll() {
    renderConversationList();
    renderCounts();
    renderContacts();
    renderChannels();
    populateChannelSelect();
    populateAssigneeSelect();
    renderSelectedConversation();
  }

  function renderCounts() {
    const open = state.conversations.filter((item) => item.status !== "closed").length;
    const unread = state.conversations.filter((item) => item.unreadCount > 0).length;
    const mine = state.conversations.filter((item) => isAssignedToCurrentUser(item)).length;
    const unassigned = state.conversations.filter((item) => !item.assignedTo || item.assignedTo === "Unassigned").length;
    $("allCount").textContent = String(state.conversations.length);
    $("mineCount").textContent = String(mine);
    $("unassignedCount").textContent = String(unassigned);
    $("openCount").textContent = String(open);
    $("unreadCount").textContent = String(unread);
    $("sidebarUnread").textContent = unread ? String(unread) : "";
    $("conversationSummary").textContent = `${open} active · ${unread} unread`;
  }

  function filteredConversations() {
    const search = state.search.trim().toLocaleLowerCase();
    return [...state.conversations]
      .filter((item) => {
        if (state.filter === "open" && item.status === "closed") return false;
        if (state.filter === "closed" && item.status !== "closed") return false;
        if (state.filter === "unread" && item.unreadCount <= 0) return false;
        if (state.filter === "mine" && !isAssignedToCurrentUser(item)) return false;
        if (state.filter === "unassigned" && item.assignedTo && item.assignedTo !== "Unassigned") return false;
        if (!search) return true;
        return `${item.subject} ${item.lastMessage} ${item.channelId}`.toLocaleLowerCase().includes(search);
      })
      .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
  }

  function renderConversationList() {
    const host = $("conversationList");
    host.replaceChildren();
    if (state.loading) {
      const template = $("conversationSkeleton");
      for (let index = 0; index < 6; index += 1) host.append(template.content.cloneNode(true));
      return;
    }
    const items = filteredConversations();
    if (!items.length) {
      const empty = element("div", "empty-list");
      empty.textContent = state.search ? "No conversations match your search." : "No conversations in this view.";
      host.append(empty);
      return;
    }

    items.forEach((conversation, index) => {
      const channel = channelFor(conversation.channelId);
      const style = channelStyle(channel);
      const button = element("button", "conversation-item");
      button.type = "button";
      button.dataset.conversationId = conversation.conversationId;
      button.setAttribute("role", "listitem");
      button.classList.toggle("is-selected", conversation.conversationId === state.selectedConversationId);
      button.setAttribute("aria-label", `${conversation.subject}, ${conversation.unreadCount} unread messages`);

      const avatarWrap = element("span", "conversation-avatar");
      const avatar = element("span", "avatar", initials(conversation.subject));
      const palette = avatarPalettes[index % avatarPalettes.length];
      avatar.style.setProperty("--avatar-bg", palette[0]);
      avatar.style.setProperty("--avatar-fg", palette[1]);
      avatarWrap.append(avatar);
      const mini = element("span", "channel-mini", style.short);
      mini.style.setProperty("--channel-color", style.color);
      mini.title = style.label;
      avatarWrap.append(mini);

      const copy = element("span", "conversation-copy");
      const nameRow = element("span", "conversation-name-row");
      nameRow.append(element("strong", "", conversation.subject));
      if (conversation.priority === "high") nameRow.append(element("i", "priority-mark"));
      copy.append(nameRow, element("span", "conversation-preview", conversation.lastMessage));

      const side = element("span", "conversation-side");
      side.append(element("span", "conversation-time", relativeTime(conversation.lastMessageAt)));
      if (conversation.unreadCount > 0) side.append(element("span", "unread-badge", conversation.unreadCount > 99 ? "99+" : String(conversation.unreadCount)));
      button.append(avatarWrap, copy, side);
      host.append(button);
    });
  }

  async function selectConversation(conversationId, { markRead = true } = {}) {
    const conversation = state.conversations.find((item) => item.conversationId === conversationId);
    if (!conversation) return;
    state.selectedConversationId = conversationId;
    $("inboxGrid").classList.add("chat-open");
    renderConversationList();
    renderSelectedConversation();
    if (!state.messages.has(conversationId)) {
      renderMessageLoading();
      try {
        const data = await state.api.getMessages(conversationId);
        state.messages.set(conversationId, asItems(data).map(normalizeMessage));
      } catch (error) {
        state.messages.set(conversationId, []);
        showToast("Messages could not be loaded", error.message, true);
      }
    }
    if (markRead && conversation.unreadCount > 0) {
      conversation.unreadCount = 0;
      state.api.updateConversation(conversationId, { markRead: true }).catch(() => {});
      renderCounts();
      renderConversationList();
    }
    renderSelectedConversation();
  }

  function renderSelectedConversation() {
    const conversation = selectedConversation();
    $("emptyConversation").hidden = Boolean(conversation);
    $("chatContent").hidden = !conversation;
    if (!conversation) {
      state.detailsOpen = false;
      updateDetailsVisibility();
      return;
    }
    const contact = contactFor(conversation);
    const channel = channelFor(conversation.channelId);
    const style = channelStyle(channel);
    $("chatTitle").textContent = conversation.subject;
    $("chatAvatar").textContent = initials(conversation.subject);
    $("chatChannel").textContent = style.label;
    $("chatChannel").style.background = style.soft;
    $("chatChannel").style.color = style.color;
    $("chatPresence").textContent = `Active ${relativeTime(conversation.lastMessageAt)}`;
    $("conversationStatus").value = conversation.status;
    populateAssigneeSelect(conversation);

    $("detailsAvatar").textContent = initials(conversation.subject);
    $("detailsName").textContent = conversation.subject;
    $("detailsIdentity").textContent = contact?.channelProfileId || conversation.channelProfileId || "No saved identity";
    $("detailsEmail").textContent = contact?.email || "—";
    $("detailsPhone").textContent = contact?.phone || "—";
    $("detailsChannel").textContent = channel?.name || style.label;
    $("detailsAssignee").textContent = conversation.assignedTo || "Unassigned";
    const tagHost = $("detailsTags");
    tagHost.replaceChildren();
    const tags = contact?.tags?.length ? contact.tags : ["No tags"];
    tags.forEach((tag) => tagHost.append(element("span", "tag", tag)));
    renderMessages();
  }

  function renderMessageLoading() {
    const host = $("messageThread");
    host.replaceChildren();
    const loading = element("div", "empty-list", "Loading messages…");
    host.append(loading);
  }

  function renderMessages() {
    const conversation = selectedConversation();
    if (!conversation) return;
    const host = $("messageThread");
    host.replaceChildren();
    const messages = state.messages.get(conversation.conversationId);
    if (!messages) {
      renderMessageLoading();
      return;
    }
    if (!messages.length) {
      host.append(element("div", "empty-list", "No messages yet. Send the first reply below."));
      return;
    }
    let dateKey = "";
    messages
      .slice()
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .forEach((message) => {
        const currentDate = dateLabel(message.timestamp);
        if (currentDate !== dateKey) {
          host.append(element("div", "date-divider", currentDate));
          dateKey = currentDate;
        }
        const row = element("div", `message-row${message.direction === "outbound" ? " is-outbound" : ""}`);
        row.dataset.messageId = message.messageId;
        const bubble = element("div", "message-bubble");
        if (message.direction === "inbound" && message.senderName) bubble.append(element("p", "message-sender", message.senderName));
        bubble.append(element("p", "message-text", message.text || `[${message.messageType || "Message"}]`));
        const foot = element("div", "message-foot");
        foot.append(element("time", "", formatClock(message.timestamp)));
        if (message.direction === "outbound") {
          const status = element("span", message.status === "failed" ? "message-failed" : "delivery-check");
          status.textContent = message.status === "failed" ? "Failed" : (message.status === "read" ? "✓✓" : "✓");
          status.title = message.status;
          foot.append(status);
        }
        bubble.append(foot);
        row.append(bubble);
        host.append(row);
      });
    requestAnimationFrame(() => { host.scrollTop = host.scrollHeight; });
  }

  function renderContacts() {
    const search = state.contactSearch.trim().toLocaleLowerCase();
    const contacts = state.contacts.filter((contact) => `${contact.displayName} ${contact.email} ${contact.phone} ${contact.channelProfileId}`.toLocaleLowerCase().includes(search));
    $("contactCount").textContent = `${contacts.length} contact${contacts.length === 1 ? "" : "s"}`;
    const tbody = $("contactTableBody");
    tbody.replaceChildren();
    if (!contacts.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.className = "empty-list";
      cell.textContent = "No contacts match your search.";
      row.append(cell);
      tbody.append(row);
      return;
    }
    contacts.forEach((contact, index) => {
      const row = document.createElement("tr");
      const identityCell = document.createElement("td");
      const identity = element("div", "contact-cell");
      const avatar = element("span", "avatar", initials(contact.displayName));
      const palette = avatarPalettes[index % avatarPalettes.length];
      avatar.style.background = palette[0];
      avatar.style.color = palette[1];
      const copy = document.createElement("div");
      copy.append(element("strong", "", contact.displayName), element("span", "", contact.email !== "—" ? contact.email : contact.channelProfileId));
      identity.append(avatar, copy);
      identityCell.append(identity);
      row.append(identityCell);

      const style = channelStyle(channelFor(contact.channelId));
      const channelCell = document.createElement("td");
      const badge = element("span", "channel-badge", style.label);
      badge.style.background = style.soft;
      badge.style.color = style.color;
      channelCell.append(badge);
      row.append(channelCell);

      const tagCell = document.createElement("td");
      const tagWrap = element("div", "tag-list");
      (contact.tags.length ? contact.tags.slice(0, 2) : ["—"]).forEach((tag) => tagWrap.append(element("span", "tag", tag)));
      tagCell.append(tagWrap);
      row.append(tagCell);

      const conversation = state.conversations.find((item) => item.contactId === contact.contactId);
      row.append(tableCell(conversation ? relativeTime(conversation.lastMessageAt) : "—"));
      const statusCell = document.createElement("td");
      statusCell.append(element("span", `status-chip${contact.status === "inactive" ? " is-inactive" : ""}`, contact.status === "inactive" ? "Inactive" : "Active"));
      row.append(statusCell);
      tbody.append(row);
    });
  }

  function renderChannels() {
    const stats = $("channelStats");
    stats.replaceChildren();
    const connected = state.channels.filter((channel) => channel.enabled && channel.health === "connected").length;
    const open = state.conversations.filter((item) => item.status !== "closed").length;
    const unread = state.conversations.reduce((sum, item) => sum + item.unreadCount, 0);
    [["Connected channels", connected], ["Open conversations", open], ["Unread messages", unread]].forEach(([label, value]) => {
      const card = element("div", "stat-card");
      card.append(element("span", "", label), element("strong", "", String(value)));
      stats.append(card);
    });

    const grid = $("channelGrid");
    grid.replaceChildren();
    state.channels.forEach((channel) => {
      const style = channelStyle(channel);
      const card = element("article", "channel-card");
      const head = element("div", "channel-card-head");
      const logo = element("span", "channel-logo", style.short);
      logo.style.setProperty("--channel-color", style.color);
      logo.style.setProperty("--channel-soft", style.soft);
      const copy = document.createElement("div");
      const needsSetup = channel.health === "setup_required";
      const disconnected = channel.health === "disconnected" || !channel.enabled;
      const healthClass = disconnected ? " is-disconnected" : needsSetup ? " is-warning" : "";
      const healthLabel = disconnected ? "Disconnected" : needsSetup ? "Needs secrets" : "Healthy";
      const health = element("span", `health-dot${healthClass}`, healthLabel);
      copy.append(element("h3", "", channel.name), health);
      head.append(logo, copy);
      const channelConversations = state.conversations.filter((item) => item.channelId === channel.channelId);
      const unreadCount = channelConversations.reduce((sum, item) => sum + item.unreadCount, 0);
      const metrics = element("div", "channel-metrics");
      metrics.append(metric("Conversations", channelConversations.length), metric("Unread", unreadCount));
      card.append(head, element("p", "", `${style.label} routes customer messages into the shared Helixcer inbox.`), metrics);
      grid.append(card);
    });
    if (!state.channels.length) grid.append(element("div", "empty-list", "No channels have been connected yet."));
  }

  function normalizeMember(raw) {
    return {
      ...raw,
      membershipId: String(raw.membershipId || raw.id || ""),
      userId: String(raw.userId || raw.user?.userId || ""),
      email: String(raw.email || raw.user?.email || ""),
      displayName: raw.displayName || raw.user?.displayName || raw.email?.split("@")[0] || "Team member",
      avatarUrl: raw.avatarUrl || raw.user?.avatarUrl || "",
      role: ["owner", "admin", "agent"].includes(raw.role) ? raw.role : "agent",
      status: raw.status || "active",
      createdAt: raw.createdAt || new Date().toISOString(),
    };
  }

  function normalizeInvitation(raw) {
    return {
      ...raw,
      invitationId: String(raw.invitationId || raw.id || ""),
      email: String(raw.email || ""),
      role: ["owner", "admin", "agent"].includes(raw.role) ? raw.role : "agent",
      status: raw.status || "pending",
      createdAt: raw.createdAt || new Date().toISOString(),
      expiresAt: raw.expiresAt || "",
    };
  }

  async function loadTeam() {
    if (!canAdmin()) {
      state.team = { members: [], invitations: [] };
      renderTeam();
      return;
    }
    try {
      const data = await state.api.getTeam();
      state.team.members = asItems(data.members).map(normalizeMember);
      state.team.invitations = asItems(data.invitations).map(normalizeInvitation);
      renderTeam();
      populateAssigneeSelect();
    } catch (error) {
      if (error.status !== 403) showToast("Team could not be loaded", error.message, true);
    }
  }

  function renderTeam() {
    const body = $("teamTableBody");
    body.replaceChildren();
    $("teamCount").textContent = `${state.team.members.length} member${state.team.members.length === 1 ? "" : "s"}`;
    if (!state.team.members.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.className = "empty-list";
      cell.textContent = "No team members are available.";
      row.append(cell);
      body.append(row);
    }

    state.team.members.forEach((member, index) => {
      const row = document.createElement("tr");
      const memberCell = document.createElement("td");
      const identity = element("div", "member-cell");
      const avatar = element("span", "avatar", initials(member.displayName));
      const palette = avatarPalettes[index % avatarPalettes.length];
      avatar.style.background = palette[0];
      avatar.style.color = palette[1];
      const copy = document.createElement("div");
      copy.append(element("strong", "", member.displayName), element("span", "", member.email));
      identity.append(avatar, copy);
      memberCell.append(identity);
      row.append(memberCell);

      const roleCell = document.createElement("td");
      const roleSelect = element("select", "compact-select role-select");
      roleSelect.dataset.memberRole = member.membershipId;
      ["owner", "admin", "agent"].forEach((role) => {
        const option = document.createElement("option");
        option.value = role;
        option.textContent = capitalize(role);
        option.disabled = role === "owner" && !isOwner();
        roleSelect.append(option);
      });
      roleSelect.value = member.role;
      const isCurrentOwner = member.membershipId === state.currentUser?.membershipId && member.role === "owner";
      roleSelect.disabled = !isOwner() && member.role === "owner" || isCurrentOwner;
      roleCell.append(roleSelect);
      row.append(roleCell);

      const statusCell = document.createElement("td");
      statusCell.append(element("span", `status-chip${member.status !== "active" ? " is-inactive" : ""}`, member.status === "active" ? "Enabled" : "Disabled"));
      row.append(statusCell, tableCell(dateLabel(member.createdAt)));

      const actionCell = document.createElement("td");
      const toggle = element("button", `member-action${member.status === "active" ? " is-danger" : ""}`, member.status === "active" ? "Disable" : "Enable");
      toggle.type = "button";
      toggle.dataset.toggleMember = member.membershipId;
      toggle.disabled = member.role === "owner";
      actionCell.append(toggle);
      row.append(actionCell);
      body.append(row);
    });

    const invitations = state.team.invitations.filter((item) => item.status === "pending");
    $("invitationSurface").hidden = invitations.length === 0;
    $("invitationCount").textContent = `${invitations.length} pending`;
    const invitationHost = $("invitationList");
    invitationHost.replaceChildren();
    invitations.forEach((invitation) => {
      const item = element("div", "invitation-item");
      const copy = document.createElement("div");
      copy.append(element("strong", "", invitation.email), element("span", "", `${capitalize(invitation.role)} · waiting for sign-in`));
      const time = document.createElement("time");
      time.dateTime = invitation.expiresAt;
      time.textContent = invitation.expiresAt ? `Expires ${relativeTime(invitation.expiresAt)}` : "Pending";
      const cancel = element("button", "member-action is-danger", "Cancel");
      cancel.type = "button";
      cancel.dataset.cancelInvitation = invitation.invitationId;
      item.append(copy, time, cancel);
      invitationHost.append(item);
    });
  }

  function openInviteDialog() {
    const form = $("inviteForm");
    form.reset();
    $("inviteFields").hidden = false;
    $("inviteResult").hidden = true;
    $("inviteSubmit").hidden = false;
    applyPermissions();
    updateInviteRoleHelp();
    $("inviteDialog").showModal();
  }

  function updateInviteRoleHelp() {
    const role = $("inviteRole").value;
    const descriptions = {
      admin: "Admins can manage channels, contacts, conversations, and team members.",
      agent: "Agents can manage customer conversations but cannot change channels or team access.",
    };
    $("inviteRoleHelp").textContent = descriptions[role] || descriptions.agent;
  }

  async function inviteMember(form) {
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim().toLocaleLowerCase();
    const role = String(data.get("role") || "agent");
    if (!email || !form.elements.email.checkValidity()) {
      form.elements.email.reportValidity();
      return;
    }
    $("inviteSubmit").disabled = true;
    try {
      const result = await state.api.inviteMember({ email, role, return_to: location.origin });
      $("inviteFields").hidden = true;
      $("inviteResult").hidden = false;
      $("inviteSubmit").hidden = true;
      $("inviteLinkOutput").value = result.inviteUrl || state.api.loginUrl();
      await loadTeam();
      showToast("Member access created", `${email} can now sign in with Google.`);
    } catch (error) {
      showToast("Member could not be added", error.message, true);
    } finally {
      $("inviteSubmit").disabled = false;
    }
  }

  async function changeMemberRole(membershipId, role, select) {
    const member = state.team.members.find((item) => item.membershipId === membershipId);
    if (!member) return;
    const previous = member.role;
    select.disabled = true;
    try {
      const result = await state.api.updateMember(membershipId, { role });
      Object.assign(member, normalizeMember(result.item || { ...member, role }));
      renderTeam();
      showToast("Role updated", `${member.displayName} is now ${capitalize(member.role)}.`);
    } catch (error) {
      select.value = previous;
      showToast("Role was not changed", error.message, true);
    } finally {
      select.disabled = false;
    }
  }

  async function toggleMember(membershipId) {
    const member = state.team.members.find((item) => item.membershipId === membershipId);
    if (!member || member.role === "owner") return;
    const status = member.status === "active" ? "disabled" : "active";
    try {
      const result = await state.api.updateMember(membershipId, { status });
      Object.assign(member, normalizeMember(result.item || { ...member, status }));
      renderTeam();
      showToast(status === "active" ? "Member enabled" : "Member disabled", member.displayName);
    } catch (error) {
      showToast("Member access was not changed", error.message, true);
    }
  }

  async function cancelInvitation(invitationId) {
    try {
      await state.api.cancelInvitation(invitationId);
      state.team.invitations = state.team.invitations.filter((item) => item.invitationId !== invitationId);
      renderTeam();
      showToast("Invitation cancelled");
    } catch (error) {
      showToast("Invitation was not cancelled", error.message, true);
    }
  }

  function metric(label, value) {
    const node = document.createElement("div");
    node.append(element("span", "", label), element("strong", "", String(value)));
    return node;
  }

  function populateChannelSelect() {
    const select = $("newContactChannel");
    const previous = select.value;
    select.replaceChildren();
    state.channels.filter((channel) => channel.enabled).forEach((channel) => {
      const option = document.createElement("option");
      option.value = channel.channelId;
      option.textContent = channel.name;
      select.append(option);
    });
    if (previous && state.channels.some((channel) => channel.channelId === previous)) select.value = previous;
  }

  function assignmentMembers() {
    const members = state.team.members.filter((member) => member.status === "active");
    if (state.currentUser && !members.some((member) => member.email === state.currentUser.email)) {
      members.push({
        membershipId: state.currentUser.membershipId,
        email: state.currentUser.email,
        displayName: state.currentUser.displayName,
        role: state.currentUser.role,
        status: "active",
      });
    }
    return members;
  }

  function populateAssigneeSelect(conversation = selectedConversation()) {
    const select = $("conversationAssignee");
    const assignedTo = conversation?.assignedTo && conversation.assignedTo !== "Unassigned" ? conversation.assignedTo : "";
    select.replaceChildren();
    const unassigned = document.createElement("option");
    unassigned.value = "";
    unassigned.textContent = "Unassigned";
    select.append(unassigned);
    assignmentMembers().forEach((member) => {
      const option = document.createElement("option");
      option.value = member.email || member.displayName;
      option.textContent = member.displayName || member.email;
      select.append(option);
    });
    if (assignedTo && ![...select.options].some((option) => option.value === assignedTo)) {
      const existing = document.createElement("option");
      existing.value = assignedTo;
      existing.textContent = assignedTo;
      select.append(existing);
    }
    select.value = assignedTo;
    select.disabled = !conversation;
  }

  function isAssignedToCurrentUser(conversation) {
    if (!state.currentUser || !conversation.assignedTo) return false;
    const assigned = String(conversation.assignedTo).toLocaleLowerCase();
    return [state.currentUser.email, state.currentUser.displayName, state.currentUser.userId]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase() === assigned);
  }

  async function sendCurrentMessage() {
    const conversation = selectedConversation();
    const input = $("messageInput");
    const text = input.value.trim();
    if (!conversation || !text) return;
    input.value = "";
    resizeComposer();
    $("sendButton").disabled = true;
    try {
      const result = await state.api.sendMessage(conversation.conversationId, text);
      const message = normalizeMessage(result.item || { text, direction: "outbound", status: "sent" });
      upsertMessage(conversation.conversationId, message);
      conversation.lastMessage = message.text;
      conversation.lastMessageAt = message.timestamp;
      renderMessages();
      renderConversationList();
    } catch (error) {
      input.value = text;
      resizeComposer();
      showToast("Message was not sent", error.message, true);
    } finally {
      $("sendButton").disabled = false;
      input.focus();
    }
  }

  function upsertMessage(conversationId, message) {
    const messages = state.messages.get(conversationId) || [];
    const index = messages.findIndex((item) => item.messageId === message.messageId);
    if (index >= 0) messages[index] = { ...messages[index], ...message };
    else messages.push(message);
    state.messages.set(conversationId, messages);
  }

  function handleRealtimeEvent(event) {
    const type = event.type || event.event;
    if (type === "message.created" || type === "message.updated") {
      const rawMessage = event.message || event.item || event.data || {};
      let conversationId = String(event.conversationId || rawMessage.conversationId || event.item?.conversationId || "");
      if (!conversationId && rawMessage.messageId) {
        for (const [candidateId, messages] of state.messages.entries()) {
          if (messages.some((item) => item.messageId === String(rawMessage.messageId))) {
            conversationId = candidateId;
            break;
          }
        }
      }
      if (!conversationId) return;
      const existingMessage = (state.messages.get(conversationId) || []).find((item) => item.messageId === String(rawMessage.messageId || rawMessage.id || ""));
      if (!existingMessage && rawMessage.text === undefined && rawMessage.direction === undefined) {
        refreshMessages(conversationId);
        loadAll();
        return;
      }
      const message = normalizeMessage({ ...existingMessage, ...rawMessage });
      upsertMessage(conversationId, message);
      const conversation = state.conversations.find((item) => item.conversationId === conversationId);
      if (conversation) {
        conversation.lastMessage = message.text;
        conversation.lastMessageAt = message.timestamp;
        if (message.direction === "inbound" && conversationId !== state.selectedConversationId) conversation.unreadCount += 1;
      }
      renderCounts();
      renderConversationList();
      if (conversationId === state.selectedConversationId) renderMessages();
      return;
    }
    if (type === "conversation.updated" || type === "conversation.created") {
      const rawConversation = event.conversation || event.item || event.data || {};
      const existing = state.conversations.find((item) => item.conversationId === String(rawConversation.conversationId || rawConversation.id || ""));
      if (!existing && !rawConversation.subject) {
        loadAll();
        return;
      }
      const incoming = normalizeConversation({ ...existing, ...rawConversation });
      if (!incoming.conversationId) return;
      const index = state.conversations.findIndex((item) => item.conversationId === incoming.conversationId);
      if (index >= 0) state.conversations[index] = { ...state.conversations[index], ...incoming };
      else state.conversations.unshift(incoming);
      renderAll();
      return;
    }
    if (type === "bootstrap.changed") loadAll();
  }

  async function refreshMessages(conversationId) {
    try {
      const data = await state.api.getMessages(conversationId);
      state.messages.set(conversationId, asItems(data).map(normalizeMessage));
      if (conversationId === state.selectedConversationId) renderMessages();
    } catch {
      // A later reconnect or manual refresh will retry without disrupting the agent.
    }
  }

  function setConnectionState(status) {
    const pill = $("connectionPill");
    pill.classList.toggle("is-online", status === "online" || status === "demo");
    pill.classList.toggle("is-error", status === "error" || status === "offline");
    const labels = { demo: "Demo mode", recovery: "Recovery mode", connecting: "Connecting…", online: "Live", offline: "Reconnecting…", error: "Connection issue" };
    $("connectionText").textContent = labels[status] || "Starting…";
  }

  function setRoute(route) {
    if (!["inbox", "contacts", "channels", "team"].includes(route)) route = "inbox";
    if (!canAdmin() && ["channels", "team"].includes(route)) route = "inbox";
    state.route = route;
    document.querySelectorAll("[data-route-panel]").forEach((panel) => {
      const active = panel.dataset.routePanel === route;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
    document.querySelectorAll("[data-route]").forEach((button) => {
      const active = button.dataset.route === route;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    const labels = { inbox: "Inbox", contacts: "Contacts", channels: "Channels", team: "Team" };
    $("pageTitle").textContent = labels[route];
    if (location.hash !== `#${route}`) history.replaceState(null, "", `#${route}`);
    closeMobileMenu();
  }

  function toggleDetails() {
    if (!selectedConversation()) return;
    state.detailsOpen = !state.detailsOpen;
    updateDetailsVisibility();
  }

  function updateDetailsVisibility() {
    $("detailsPanel").hidden = !state.detailsOpen;
    $("inboxGrid").classList.toggle("has-details", state.detailsOpen);
  }

  function openChannelDialog() {
    const form = $("channelForm");
    form.reset();
    form.elements.connectorType.value = "whatsapp_cloud";
    form.elements.channelId.value = "wa-main";
    form.elements.secretKey.value = "WA_MAIN";
    updateChannelFormHelp();
    $("channelDialog").showModal();
  }

  function updateChannelFormHelp() {
    const form = $("channelForm");
    const type = form.elements.connectorType.value;
    const prefix = String(form.elements.secretKey.value || "CHANNEL_MAIN").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    $("genericEndpointField").hidden = type !== "generic_http";
    const messages = {
      whatsapp_cloud: `After saving, add ${prefix}_ACCESS_TOKEN, ${prefix}_PHONE_NUMBER_ID, ${prefix}_VERIFY_TOKEN, and ${prefix}_APP_SECRET in Cloudflare Worker secrets.`,
      telegram: `After saving, add ${prefix}_BOT_TOKEN and ${prefix}_WEBHOOK_TOKEN in Cloudflare Worker secrets.`,
      generic_http: `After saving, add ${prefix}_WEBHOOK_TOKEN and any template secrets in Cloudflare Worker secrets. Redirects are blocked for safety.`,
      web_chat: "Website chat needs no provider secret. Public widget authentication can be added when the widget is deployed.",
    };
    $("channelSecretHelp").textContent = messages[type] || "Provider secrets stay in Cloudflare.";
  }

  async function logout() {
    try { await state.api.logout(); }
    catch { /* Always clear local recovery state and return to sign-in. */ }
    sessionStorage.removeItem(RECOVERY_TOKEN_KEY);
    state.messages.clear();
    showSignedOut("You have signed out of the workspace.");
  }

  function toggleUserMenu(force) {
    const menu = $("userMenu");
    const shouldOpen = typeof force === "boolean" ? force : menu.hidden;
    menu.hidden = !shouldOpen;
    $("userMenuButton").setAttribute("aria-expanded", String(shouldOpen));
  }

  async function copyInviteLink() {
    const input = $("inviteLinkOutput");
    try {
      await navigator.clipboard.writeText(input.value);
      showToast("Sign-in link copied");
    } catch {
      input.focus();
      input.select();
      showToast("Copy the selected link", "Your browser blocked automatic clipboard access.");
    }
  }

  async function createContact(form) {
    const formData = new FormData(form);
    const payload = {
      displayName: String(formData.get("displayName") || "").trim(),
      channelId: String(formData.get("channelId") || "").trim(),
      channelProfileId: String(formData.get("channelProfileId") || "").trim(),
    };
    if (!payload.displayName || !payload.channelId || !payload.channelProfileId) return;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const result = await state.api.createContact(payload);
      $("contactDialog").close();
      form.reset();
      await loadAll({ preserveSelection: false });
      setRoute("inbox");
      if (result.conversationId) await selectConversation(String(result.conversationId));
      showToast("Contact created", `${payload.displayName} is ready for a conversation.`);
    } catch (error) {
      showToast("Contact could not be created", error.message, true);
    } finally {
      submit.disabled = false;
    }
  }

  async function saveChannel(form) {
    const data = new FormData(form);
    const connectorType = String(data.get("connectorType") || "");
    const endpoint = String(data.get("endpoint") || "").trim();
    const capabilities = connectorType === "whatsapp_cloud" || connectorType === "telegram"
      ? ["text", "media"] : ["text"];
    const config = connectorType === "whatsapp_cloud" ? { apiVersion: "v23.0" } : {};
    if (connectorType === "generic_http") {
      if (!endpoint) { showToast("Endpoint required", "Enter the HTTPS provider endpoint.", true); return; }
      try {
        const url = new URL(endpoint);
        if (url.protocol !== "https:") throw new Error("HTTPS required");
        config.endpoint = url.toString();
        config.allowedHosts = [url.hostname];
        config.method = "POST";
      } catch {
        showToast("Invalid endpoint", "Use a complete HTTPS provider URL.", true);
        return;
      }
    }
    const payload = {
      name: String(data.get("name") || "").trim(),
      connectorType,
      channelId: String(data.get("channelId") || "").trim(),
      secretKey: String(data.get("secretKey") || "").trim(),
      capabilities,
      enabled: true,
      config,
    };
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await state.api.saveChannel(payload);
      $("channelDialog").close();
      await loadAll();
      setRoute("channels");
      showToast("Channel saved", `${payload.name} is ready for its Cloudflare secrets.`);
    } catch (error) {
      showToast("Channel could not be saved", error.message, true);
    } finally {
      submit.disabled = false;
    }
  }

  function showToast(title, message = "", isError = false) {
    const toast = element("div", `toast${isError ? " is-error" : ""}`);
    const copy = document.createElement("div");
    copy.append(element("strong", "", title));
    if (message) copy.append(element("span", "", message));
    toast.append(copy);
    $("toastRegion").append(toast);
    setTimeout(() => toast.remove(), 4500);
  }

  function openMobileMenu() {
    $("appShell").classList.add("menu-open");
    $("mobileScrim").hidden = false;
    $("mobileMenu").setAttribute("aria-expanded", "true");
  }

  function closeMobileMenu() {
    $("appShell").classList.remove("menu-open");
    $("mobileScrim").hidden = true;
    $("mobileMenu").setAttribute("aria-expanded", "false");
  }

  function selectedConversation() {
    return state.conversations.find((item) => item.conversationId === state.selectedConversationId) || null;
  }

  function contactFor(conversation) {
    return state.contacts.find((contact) => contact.contactId === conversation.contactId) || null;
  }

  function channelFor(channelId) {
    return state.channels.find((channel) => channel.channelId === channelId) || { channelId, connectorType: "generic", name: "Custom channel" };
  }

  function channelStyle(channel) {
    return channelStyles[channel?.connectorType] || channelStyles.generic;
  }

  function element(tag, className = "", text = null) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== null && text !== undefined) node.textContent = String(text);
    return node;
  }

  function tableCell(text) {
    const cell = document.createElement("td");
    cell.textContent = String(text);
    return cell;
  }

  function initials(name) {
    return String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase() || "?";
  }

  function capitalize(value) {
    const text = String(value || "");
    return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "";
  }

  function safeAvatarUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "lh3.googleusercontent.com" ? url.toString() : "";
    } catch {
      return "";
    }
  }

  function relativeTime(value) {
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return "recently";
    const seconds = Math.round((timestamp - Date.now()) / 1000);
    const absolute = Math.abs(seconds);
    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    if (absolute < 60) return formatter.format(seconds, "second");
    if (absolute < 3600) return formatter.format(Math.round(seconds / 60), "minute");
    if (absolute < 86400) return formatter.format(Math.round(seconds / 3600), "hour");
    if (absolute < 604800) return formatter.format(Math.round(seconds / 86400), "day");
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(timestamp));
  }

  function dateLabel(value) {
    const date = new Date(value);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" }).format(date);
  }

  function formatClock(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }

  function resizeComposer() {
    const input = $("messageInput");
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const routeButton = event.target.closest("[data-route]");
      if (routeButton) { setRoute(routeButton.dataset.route); return; }
      const actionButton = event.target.closest("[data-action]");
      if (actionButton) {
        const actions = {
          "toggle-user-menu": () => toggleUserMenu(),
          "logout": logout,
          "toggle-details": toggleDetails,
          "new-conversation": () => $("contactDialog").showModal(),
          "new-contact": () => $("contactDialog").showModal(),
          "close-contact-dialog": () => $("contactDialog").close(),
          "attachment-info": () => showToast("Attachments are protected", "The zero-cost release keeps media on its source channel."),
          "insert-greeting": () => {
            const input = $("messageInput");
            const name = selectedConversation()?.subject?.split(" ")[0] || "there";
            input.value = `Hi ${name}, `;
            resizeComposer();
            input.focus();
          },
          "channel-help": openChannelDialog,
          "close-channel-dialog": () => $("channelDialog").close(),
          "open-invite": openInviteDialog,
          "close-invite": () => $("inviteDialog").close(),
          "copy-invite-link": copyInviteLink,
        };
        actions[actionButton.dataset.action]?.();
      }
      if (!event.target.closest(".user-menu-wrap")) toggleUserMenu(false);
    });

    $("conversationList").addEventListener("click", (event) => {
      const item = event.target.closest("[data-conversation-id]");
      if (item) selectConversation(item.dataset.conversationId);
    });

    $("conversationFilters").addEventListener("click", (event) => {
      const button = event.target.closest("[data-filter]");
      if (!button) return;
      state.filter = button.dataset.filter;
      document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("is-active", item === button));
      renderConversationList();
    });

    $("conversationSearch").addEventListener("input", (event) => { state.search = event.target.value; renderConversationList(); });
    $("contactSearch").addEventListener("input", (event) => { state.contactSearch = event.target.value; renderContacts(); });
    $("refreshButton").addEventListener("click", () => loadAll());
    $("mobileMenu").addEventListener("click", openMobileMenu);
    $("mobileScrim").addEventListener("click", closeMobileMenu);
    $("mobileBack").addEventListener("click", () => $("inboxGrid").classList.remove("chat-open"));

    $("messageForm").addEventListener("submit", (event) => { event.preventDefault(); sendCurrentMessage(); });
    $("messageInput").addEventListener("input", resizeComposer);
    $("messageInput").addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendCurrentMessage();
      }
    });

    $("conversationStatus").addEventListener("change", async (event) => {
      const conversation = selectedConversation();
      if (!conversation) return;
      const previous = conversation.status;
      conversation.status = event.target.value;
      renderCounts();
      renderConversationList();
      try { await state.api.updateConversation(conversation.conversationId, { status: conversation.status }); }
      catch (error) {
        conversation.status = previous;
        event.target.value = previous;
        renderAll();
        showToast("Status was not updated", error.message, true);
      }
    });

    $("conversationAssignee").addEventListener("change", async (event) => {
      const conversation = selectedConversation();
      if (!conversation) return;
      const previous = conversation.assignedTo;
      const assignedTo = event.target.value || "Unassigned";
      conversation.assignedTo = assignedTo;
      renderCounts();
      renderConversationList();
      try { await state.api.updateConversation(conversation.conversationId, { assignedTo: event.target.value }); }
      catch (error) {
        conversation.assignedTo = previous;
        populateAssigneeSelect(conversation);
        renderCounts();
        renderConversationList();
        showToast("Assignee was not updated", error.message, true);
      }
    });

    $("contactForm").addEventListener("submit", (event) => { event.preventDefault(); createContact(event.currentTarget); });
    $("channelForm").addEventListener("submit", (event) => { event.preventDefault(); saveChannel(event.currentTarget); });
    $("channelConnectorType").addEventListener("change", updateChannelFormHelp);
    $("channelForm").elements.secretKey.addEventListener("input", updateChannelFormHelp);
    $("inviteForm").addEventListener("submit", (event) => { event.preventDefault(); inviteMember(event.currentTarget); });
    $("inviteRole").addEventListener("change", updateInviteRoleHelp);
    $("teamTableBody").addEventListener("change", (event) => {
      const select = event.target.closest("[data-member-role]");
      if (select) changeMemberRole(select.dataset.memberRole, select.value, select);
    });
    $("teamTableBody").addEventListener("click", (event) => {
      const button = event.target.closest("[data-toggle-member]");
      if (button) toggleMember(button.dataset.toggleMember);
    });
    $("invitationList").addEventListener("click", (event) => {
      const button = event.target.closest("[data-cancel-invitation]");
      if (button) cancelInvitation(button.dataset.cancelInvitation);
    });
    window.addEventListener("hashchange", () => setRoute(location.hash.slice(1)));
    window.addEventListener("beforeunload", () => state.disconnectRealtime?.());
    window.addEventListener("helixcer:unauthorized", () => showSignedOut("Your session expired. Sign in again to continue."));
    document.addEventListener("keydown", (event) => {
      if (event.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) {
        event.preventDefault();
        setRoute("inbox");
        $("conversationSearch").focus();
      }
      if (event.key === "Escape") closeMobileMenu();
    });
  }

  async function init() {
    bindEvents();
    setRoute(location.hash.slice(1) || "inbox");
    await initializeSession();
  }

  init();
})();
