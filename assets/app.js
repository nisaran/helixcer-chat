(() => {
  "use strict";

  const RECOVERY_TOKEN_KEY = "helixcer_recovery_token";
  const NOTIFICATION_PREFERENCE_KEY = "helixcer_browser_notifications";
  const DEFAULT_WORKSPACE = "Helixcer workspace";
  const SAVED_SECRET_MASK = "••••••••••••••••";

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
    templatesByConversation: new Map(),
    templateConversationId: null,
    recentVerifyTokens: new Map(),
    selectedConversationId: null,
    selectedContactId: null,
    expandedChannelIds: new Set(),
    detailsOpen: false,
    currentUser: null,
    workspace: { name: DEFAULT_WORKSPACE, workspaceId: "default", slug: "helixcer" },
    team: { members: [], invitations: [] },
    apiKeys: [],
    authStatus: "checking",
    api: null,
    disconnectRealtime: null,
    notificationsEnabled: localStorage.getItem(NOTIFICATION_PREFERENCE_KEY) === "true",
    serviceWorkerRegistration: null,
    lastNotificationAt: new Map(),
    loading: true,
  };

  const channelStyles = {
    whatsapp_cloud: { label: "WhatsApp", short: "WA", color: "#168f66", soft: "#e7f6ef" },
    whatsapp: { label: "WhatsApp", short: "WA", color: "#168f66", soft: "#e7f6ef" },
    telegram: { label: "Telegram", short: "TG", color: "#2d8bc0", soft: "#e8f4fa" },
    telegram_bot: { label: "Telegram", short: "TG", color: "#2d8bc0", soft: "#e8f4fa" },
    webchat: { label: "Web chat", short: "WB", color: "#9a4f37", soft: "#faeee9" },
    web_chat: { label: "Web chat", short: "WB", color: "#9a4f37", soft: "#faeee9" },
    email: { label: "Email", short: "EM", color: "#7b5ba9", soft: "#f0ebf8" },
    gmail: { label: "Gmail", short: "GM", color: "#c44d3b", soft: "#faece9" },
    instagram: { label: "Instagram", short: "IG", color: "#b6427b", soft: "#f9eaf2" },
    instagram_messaging: { label: "Instagram", short: "IG", color: "#b6427b", soft: "#f9eaf2" },
    generic: { label: "Custom", short: "API", color: "#5e6c69", soft: "#edf0ef" },
  };

  const providerLogoPaths = {
    whatsapp_cloud: "./assets/provider-whatsapp.svg",
    whatsapp: "./assets/provider-whatsapp.svg",
    telegram: "./assets/provider-telegram.svg",
    telegram_bot: "./assets/provider-telegram.svg",
    instagram: "./assets/provider-instagram.svg",
    instagram_messaging: "./assets/provider-instagram.svg",
  };

  const providerProfiles = {
    whatsapp_cloud: {
      label: "WhatsApp", noun: "WhatsApp number", placeholder: "919876543210",
      help: "Include the country code. Spaces, +, brackets and hyphens are accepted.",
      description: "Send and receive WhatsApp Cloud API conversations.",
      setupUrl: "https://developers.facebook.com/apps/", setupLabel: "Open Meta",
    },
    telegram: {
      label: "Telegram", noun: "Telegram chat ID", placeholder: "123456789",
      help: "Use the numeric Telegram chat ID for an existing customer conversation.",
      description: "Route Telegram Bot API messages into the shared inbox.",
      setupUrl: "https://t.me/BotFather", setupLabel: "Open BotFather",
    },
    instagram: {
      label: "Instagram", noun: "Instagram-scoped user ID", placeholder: "17890000000000001",
      help: "Use the Instagram-scoped ID supplied by the messaging webhook.",
      description: "Manage Instagram Business or Creator account messages from the inbox.",
      setupUrl: "https://developers.facebook.com/apps/", setupLabel: "Open Meta",
    },
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
      apiKeys: [
        { apiKeyId: "demo-api-key", name: "Order notifications", keyPrefix: "hxc_live_demo…", scopes: ["whatsapp:template:send", "messages:read"], status: "active", createdAt: ago(1440), lastUsedAt: ago(8), expiresAt: "" },
      ],
      channels: [
        { channelId: "wa-sales", name: "Sales WhatsApp", connectorType: "whatsapp_cloud", enabled: true, health: "connected", config: { wabaId: "123456789012345", phoneNumberId: "123456789012346" }, setup: { credentialsPresent: true, credentialsVerifiedAt: ago(120), webhookVerifiedAt: ago(118), lastWebhookAt: ago(3), verifiedName: "Helixcer Sales", verifiedPhoneNumber: "+91 98765 43210" } },
        { channelId: "telegram-support", name: "Support Bot", connectorType: "telegram", enabled: true, health: "connected", config: {}, setup: { credentialsPresent: true, credentialsVerifiedAt: ago(160), webhookVerifiedAt: ago(158), lastWebhookAt: ago(18), verifiedName: "helixcer_support_bot" } },
        { channelId: "instagram-main", name: "Helixcer Instagram", connectorType: "instagram", enabled: true, health: "connected", config: { instagramAccountId: "17841400000000000", appId: "123456789012345", username: "helixcer", authMode: "instagram_login" }, setup: { credentialsPresent: true, credentialsVerifiedAt: ago(200), webhookVerifiedAt: ago(198), lastWebhookAt: ago(57), verifiedName: "helixcer" } },
      ],
      contacts: [
        { contactId: "ct-ananya", displayName: "Ananya Sharma", company: "Northwind Retail", channelId: "wa-sales", channelProfileId: "+91 98••• 1402", phone: "+91 98••• 1402", email: "ananya@example.com", tags: ["Priority", "Returning"] },
        { contactId: "ct-david", displayName: "David Miller", company: "", channelId: "telegram-support", channelProfileId: "@davidm", phone: "—", email: "david@example.com", tags: ["New lead"] },
        { contactId: "ct-meera", displayName: "Meera Iyer", company: "Acme Studio", channelId: "instagram-main", channelProfileId: "17890000000000001", phone: "—", email: "meera@example.com", tags: ["Instagram"] },
        { contactId: "ct-ravi", displayName: "Ravi Menon", company: "", channelId: "wa-sales", channelProfileId: "+91 97••• 7780", phone: "+91 97••• 7780", email: "ravi@example.com", tags: ["Billing"] },
        { contactId: "ct-lina", displayName: "Lina George", company: "", channelId: "telegram-support", channelProfileId: "@linag", phone: "—", email: "lina@example.com", tags: ["Resolved"] },
      ],
      conversations: [
        { conversationId: "cv-ananya", contactId: "ct-ananya", subject: "Ananya Sharma", channelId: "wa-sales", status: "open", assignedTo: "Nisar", priority: "high", unreadCount: 2, lastMessage: "Could you confirm when my order will arrive?", lastMessageAt: ago(3) },
        { conversationId: "cv-david", contactId: "ct-david", subject: "David Miller", channelId: "telegram-support", status: "open", assignedTo: "Unassigned", unreadCount: 1, lastMessage: "I need help choosing the right plan.", lastMessageAt: ago(18) },
        { conversationId: "cv-meera", contactId: "ct-meera", subject: "Meera Iyer", channelId: "instagram-main", status: "pending", assignedTo: "Nisar", unreadCount: 0, lastMessage: "Thank you, that answers my question.", lastMessageAt: ago(57) },
        { conversationId: "cv-ravi", contactId: "ct-ravi", subject: "Ravi Menon", channelId: "wa-sales", status: "open", assignedTo: "Nisar", unreadCount: 0, lastMessage: "The invoice amount looks different.", lastMessageAt: ago(145) },
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
      this.verifyTokens = new Map([
        ["wa-sales", "demo_whatsapp_verify_token"],
        ["instagram-main", "demo_instagram_verify_token"],
      ]);
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

    async getApiKeys() {
      await smallDelay(100);
      return { items: clone(this.data.apiKeys) };
    }

    async createApiKey(payload) {
      await smallDelay(120);
      const suffix = Date.now().toString(36);
      const item = {
        apiKeyId: `key-${suffix}`,
        name: payload.name,
        keyPrefix: `hxc_live_${suffix.slice(-8)}…`,
        scopes: ["whatsapp:template:send", "messages:read"],
        status: "active",
        createdAt: new Date().toISOString(),
        lastUsedAt: "",
        expiresAt: payload.expiresAt || "",
      };
      this.data.apiKeys.unshift(item);
      return { ok: true, item: clone(item), apiKey: `hxc_live_${suffix}.demo-secret-${crypto.randomUUID().replaceAll("-", "")}` };
    }

    async revokeApiKey(apiKeyId) {
      await smallDelay(100);
      const item = this.data.apiKeys.find((entry) => entry.apiKeyId === apiKeyId);
      if (!item) throw new Error("API key not found.");
      item.status = "revoked";
      item.revokedAt = new Date().toISOString();
      return { ok: true, item: clone(item) };
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

    async sendTemplate(conversationId, payload) {
      const templateName = payload?.name || "template";
      return this.sendMessage(conversationId, payload.previewText || `[Template: ${templateName}]`);
    }

    async getTemplates() {
      await smallDelay(140);
      return { items: clone([
        { templateId: "demo-order", name: "order_confirmation", language: { code: "en_US" }, status: "APPROVED", category: "UTILITY", components: [
          { type: "HEADER", format: "IMAGE" },
          { type: "BODY", text: "Hi {{customer_name}}, your order {{2}} is confirmed." },
          { type: "BUTTONS", buttons: [{ type: "URL", text: "View order", url: "https://example.com/orders/{{1}}" }] },
        ] },
        { templateId: "demo-welcome", name: "welcome_message", language: { code: "en_US" }, status: "APPROVED", category: "MARKETING", components: [
          { type: "BODY", text: "Welcome {{1}}. We are happy to help." },
        ] },
      ]) };
    }

    async sendAttachment(conversationId, formData) {
      const file = formData.get("file");
      const caption = String(formData.get("caption") || "").trim();
      return this.sendMessage(conversationId, caption || `[Attachment: ${file?.name || "file"}]`);
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
        company: payload.company || "",
        phone: payload.channelProfileId,
        email: "—",
        tags: Array.isArray(payload.tags) && payload.tags.length ? payload.tags : ["New"],
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

    async getContact(contactId) {
      await smallDelay(90);
      const item = this.data.contacts.find((contact) => contact.contactId === contactId);
      if (!item) throw new Error("Contact not found.");
      const channel = this.data.channels.find((entry) => entry.channelId === item.channelId);
      const hasMessages = this.data.conversations
        .filter((conversation) => conversation.contactId === contactId)
        .some((conversation) => (this.data.messages[conversation.conversationId] || []).length > 0);
      return { item: clone({ ...item, channelName: channel?.name || "", connectorType: channel?.connectorType || "generic", channelEditable: !hasMessages }) };
    }

    async updateContact(contactId, patch) {
      await smallDelay(110);
      const item = this.data.contacts.find((contact) => contact.contactId === contactId);
      if (!item) throw new Error("Contact not found.");
      if (patch.channelId && patch.channelId !== item.channelId) {
        const hasMessages = this.data.conversations
          .filter((conversation) => conversation.contactId === contactId)
          .some((conversation) => (this.data.messages[conversation.conversationId] || []).length > 0);
        if (hasMessages) throw new Error("The channel cannot be changed after messages have been sent or received.");
      }
      ["displayName", "company", "channelId", "channelProfileId"].forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(patch, key)) item[key] = patch[key];
      });
      if (Array.isArray(patch.tags)) item.tags = clone(patch.tags);
      this.data.conversations.filter((conversation) => conversation.contactId === contactId).forEach((conversation) => {
        conversation.subject = item.displayName;
        conversation.channelId = item.channelId;
      });
      const channel = this.data.channels.find((entry) => entry.channelId === item.channelId);
      const hasMessages = this.data.conversations
        .filter((conversation) => conversation.contactId === contactId)
        .some((conversation) => (this.data.messages[conversation.conversationId] || []).length > 0);
      return { ok: true, item: clone({ ...item, channelName: channel?.name || "", connectorType: channel?.connectorType || "generic", channelEditable: !hasMessages }) };
    }

    async createChannel(payload) {
      await smallDelay(140);
      const channel = {
        channelId: `channel-${Date.now().toString(36)}`,
        name: payload.name,
        connectorType: payload.connectorType,
        enabled: payload.enabled !== false,
        config: clone(payload.config || {}),
        setup: { credentialsPresent: Object.values(payload.credentials || {}).some(Boolean) },
        health: Object.values(payload.credentials || {}).some(Boolean) ? "configured" : "setup_required",
      };
      this.data.channels.push(channel);
      if (payload.credentials?.verifyToken) this.verifyTokens.set(channel.channelId, payload.credentials.verifyToken);
      this.emit({ type: "channel.updated", channelId: channel.channelId });
      return { ok: true, channelId: channel.channelId, item: clone(channel) };
    }

    async updateChannel(channelId, payload) {
      await smallDelay(120);
      const channel = this.data.channels.find((entry) => entry.channelId === channelId);
      if (!channel) throw new Error("Channel not found.");
      if (payload.name) channel.name = payload.name;
      if (payload.connectorType) channel.connectorType = payload.connectorType;
      if (Object.prototype.hasOwnProperty.call(payload, "enabled")) channel.enabled = payload.enabled !== false;
      if (payload.config) channel.config = { ...(channel.config || {}), ...clone(payload.config) };
      if (Object.values(payload.credentials || {}).some(Boolean)) {
        channel.setup = { ...(channel.setup || {}), credentialsPresent: true, credentialsVerifiedAt: "", webhookVerifiedAt: "" };
        channel.health = channel.enabled ? "configured" : "disconnected";
      } else if (!channel.enabled) channel.health = "disconnected";
      else if (channel.health === "disconnected") channel.health = channel.setup?.credentialsPresent ? "configured" : "setup_required";
      if (payload.credentials?.verifyToken) this.verifyTokens.set(channelId, payload.credentials.verifyToken);
      this.emit({ type: "channel.updated", channelId });
      return { ok: true, channelId, item: clone(channel) };
    }

    async getVerifyToken(channelId) {
      await smallDelay(80);
      const verifyToken = this.verifyTokens.get(channelId);
      if (!verifyToken) throw new Error("No verify token is saved for this channel.");
      return { ok: true, channelId, verifyToken };
    }

    async verifyChannel(channelId) {
      await smallDelay(120);
      const channel = this.data.channels.find((entry) => entry.channelId === channelId);
      if (!channel) throw new Error("Channel not found.");
      channel.health = "connected";
      const style = channelStyles[channel.connectorType] || channelStyles.generic;
      channel.setup = { ...(channel.setup || {}), credentialsPresent: true, credentialsVerifiedAt: new Date().toISOString(), webhookVerifiedAt: new Date().toISOString(), verifiedName: channel.setup?.verifiedName || `${channel.name} ${style.label}` };
      this.emit({ type: "channel.updated", channelId });
      return { ok: true, channelId, health: "connected" };
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
      const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
      if (options.body && !isFormData && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      if (this.recoveryToken) headers.set("Authorization", `Bearer ${this.recoveryToken}`);
      const response = await fetch(`${this.base}${path}`, { ...options, headers, credentials: "include" });
      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json") ? await response.json() : await response.text();
      if (!response.ok) {
        const message = typeof payload === "object" && payload
          ? payload.error?.message || payload.error || payload.message
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

    sendTemplate(conversationId, payload) {
      return this.isDemo
        ? this.demo.sendTemplate(conversationId, payload)
        : this.request(`/api/conversations/${encodeURIComponent(conversationId)}/template`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
    }

    getTemplates(conversationId) {
      return this.isDemo
        ? this.demo.getTemplates(conversationId)
        : this.request(`/api/conversations/${encodeURIComponent(conversationId)}/templates`);
    }

    sendAttachment(conversationId, formData) {
      return this.isDemo
        ? this.demo.sendAttachment(conversationId, formData)
        : this.request(`/api/conversations/${encodeURIComponent(conversationId)}/attachments`, {
          method: "POST",
          body: formData,
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

    getContact(contactId) {
      return this.isDemo
        ? this.demo.getContact(contactId)
        : this.request(`/api/contacts/${encodeURIComponent(contactId)}`);
    }

    updateContact(contactId, payload) {
      return this.isDemo
        ? this.demo.updateContact(contactId, payload)
        : this.request(`/api/contacts/${encodeURIComponent(contactId)}`, { method: "PATCH", body: JSON.stringify(payload) });
    }

    createChannel(payload) {
      return this.isDemo
        ? this.demo.createChannel(payload)
        : this.request("/api/channels", { method: "POST", body: JSON.stringify(payload) });
    }

    updateChannel(channelId, payload) {
      return this.isDemo
        ? this.demo.updateChannel(channelId, payload)
        : this.request(`/api/channels/${encodeURIComponent(channelId)}`, { method: "PATCH", body: JSON.stringify(payload) });
    }

    verifyChannel(channelId) {
      return this.isDemo
        ? this.demo.verifyChannel(channelId)
        : this.request(`/api/channels/${encodeURIComponent(channelId)}/verify`, { method: "POST" });
    }

    getVerifyToken(channelId) {
      return this.isDemo
        ? this.demo.getVerifyToken(channelId)
        : this.request(`/api/channels/${encodeURIComponent(channelId)}/verify-token`);
    }

    webhookUrl(channel) {
      const channelId = typeof channel === "string" ? channel : channel?.channelId;
      const connectorType = typeof channel === "string" ? "whatsapp_cloud" : channel?.connectorType;
      const provider = connectorType === "whatsapp_cloud" ? "whatsapp" : connectorType === "instagram_messaging" ? "instagram" : connectorType === "telegram_bot" ? "telegram" : connectorType;
      const base = this.isDemo ? "https://api.chat.helixcer.com" : this.base;
      const sharedInstagramPath = connectorType === "instagram" && channel?.config?.appId
        ? `/webhooks/instagram-app/${encodeURIComponent(channel.config.appId)}`
        : "";
      const callbackPath = channel?.setup?.callbackPath || sharedInstagramPath ||
        `/webhooks/${encodeURIComponent(provider || "channel")}/${encodeURIComponent(channelId || "")}`;
      return `${base}${callbackPath.startsWith("/") ? callbackPath : `/${callbackPath}`}`;
    }

    getTeam() {
      return this.isDemo ? this.demo.getTeam() : this.request("/api/team");
    }

    getApiKeys() {
      return this.isDemo ? this.demo.getApiKeys() : this.request("/api/developer/api-keys");
    }

    createApiKey(payload) {
      return this.isDemo
        ? this.demo.createApiKey(payload)
        : this.request("/api/developer/api-keys", { method: "POST", body: JSON.stringify(payload) });
    }

    revokeApiKey(apiKeyId) {
      return this.isDemo
        ? this.demo.revokeApiKey(apiKeyId)
        : this.request(`/api/developer/api-keys/${encodeURIComponent(apiKeyId)}`, { method: "DELETE" });
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
    $("developerApiBase").textContent = state.api.isDemo ? "https://api.chat.helixcer.com" : state.api.base;
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
    state.recentVerifyTokens.clear();
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
    if (!admin && ["channels", "developer", "team"].includes(state.route)) setRoute("inbox");
  }

  async function initializeSession() {
    showAuthChecking();
    createApi();
    const authParams = new URLSearchParams(location.search);
    const callbackError = String(authParams.get("auth_error") || authParams.get("authError") || "").trim();
    if (callbackError) {
      authParams.delete("auth_error");
      authParams.delete("authError");
      authParams.delete("auth_error_code");
      const cleanQuery = authParams.toString();
      history.replaceState(null, "", `${location.pathname}${cleanQuery ? `?${cleanQuery}` : ""}${location.hash}`);
    }
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
      await Promise.all([
        loadAll({ preserveSelection: false }),
        canAdmin() ? loadTeam() : Promise.resolve(),
        canAdmin() ? loadApiKeys() : Promise.resolve(),
      ]);
    } catch (error) {
      const message = error.status === 403
        ? "Your account does not currently have access to this workspace."
        : error.status === 401
          ? "Sign in with an approved Google account to continue."
          : "We could not reach the secure session service. Please try again.";
      showSignedOut(callbackError || message);
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
      config: raw.config && typeof raw.config === "object" ? raw.config : {},
      setup: raw.setup && typeof raw.setup === "object" ? raw.setup : {},
    };
  }

  function normalizeConversation(raw) {
    const replyWindow = raw.replyWindow && typeof raw.replyWindow === "object" ? raw.replyWindow : {};
    return {
      ...raw,
      conversationId: String(raw.conversationId || raw.id || ""),
      contactId: String(raw.contactId || raw.contact?.contactId || raw.contact?.id || ""),
      subject: raw.subject || raw.contactName || raw.displayName || raw.contact?.displayName || "Unknown contact",
      channelId: String(raw.channelId || raw.channel?.channelId || raw.channel?.id || "unknown"),
      connectorType: raw.connectorType || raw.channel?.connectorType || "",
      status: raw.status || "open",
      assignedTo: raw.assignedTo || raw.assignee || "Unassigned",
      unreadCount: Number(raw.unreadCount ?? raw.unread ?? 0),
      lastMessage: raw.lastMessage?.text || raw.lastMessageText || raw.preview || raw.lastMessage || "No messages yet",
      lastMessageAt: raw.lastMessageAt || raw.updatedAt || raw.createdAt || new Date().toISOString(),
      channelProfileId: raw.channelProfileId || raw.contact?.channelProfileId || "",
      freeformAllowed: typeof raw.freeformAllowed === "boolean"
        ? raw.freeformAllowed
        : typeof replyWindow.freeformAllowed === "boolean" ? replyWindow.freeformAllowed : undefined,
      replyWindowExpiresAt: raw.replyWindowExpiresAt || replyWindow.expiresAt || "",
      replyWindowReason: raw.replyWindowReason || replyWindow.reason || "",
    };
  }

  function normalizeContact(raw) {
    return {
      ...raw,
      contactId: String(raw.contactId || raw.id || ""),
      displayName: raw.displayName || raw.name || "Unknown contact",
      channelId: String(raw.channelId || raw.identities?.[0]?.channelId || "unknown"),
      channelName: raw.channelName || raw.channel?.name || "",
      connectorType: raw.connectorType || raw.channel?.connectorType || "",
      channelProfileId: raw.channelProfileId || raw.identity || raw.identities?.[0]?.channelProfileId || "—",
      company: raw.company || "",
      channelEditable: raw.channelEditable !== false,
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
    populateContactChannelSelect();
    populateAssigneeSelect();
    if (canAdmin()) renderApiKeys();
    renderNotificationSetting();
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
      const mini = providerLogo(channel.connectorType, "channel-mini");
      mini.title = `${channel.name || style.label} · ${style.label}`;
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
        if (typeof data?.freeformAllowed === "boolean") conversation.freeformAllowed = data.freeformAllowed;
        if (data?.replyWindowExpiresAt) conversation.replyWindowExpiresAt = data.replyWindowExpiresAt;
        if (data?.replyWindowReason) conversation.replyWindowReason = data.replyWindowReason;
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
    $("chatChannel").textContent = channel?.name || style.label;
    $("chatChannelBadge").title = style.label;
    const chatLogo = $("chatProviderLogo");
    const logoPath = providerLogoPaths[channel?.connectorType];
    chatLogo.hidden = !logoPath;
    if (logoPath) chatLogo.src = logoPath;
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
    renderComposerState();
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
      renderComposerState();
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
    renderComposerState();
    requestAnimationFrame(() => { host.scrollTop = host.scrollHeight; });
  }

  function isWhatsAppConversation(conversation = selectedConversation()) {
    if (!conversation) return false;
    const connectorType = conversation.connectorType || channelFor(conversation.channelId).connectorType;
    return connectorType === "whatsapp" || connectorType === "whatsapp_cloud";
  }

  function whatsappReplyWindow(conversation = selectedConversation()) {
    if (!isWhatsAppConversation(conversation)) return { allowed: true, expiresAt: "" };
    if (typeof conversation.freeformAllowed === "boolean") {
      return { allowed: conversation.freeformAllowed, expiresAt: conversation.replyWindowExpiresAt || "" };
    }
    const messages = state.messages.get(conversation.conversationId);
    if (!messages) return { allowed: true, expiresAt: "" };
    const latestInbound = messages
      .filter((message) => message.direction === "inbound")
      .reduce((latest, message) => Math.max(latest, new Date(message.timestamp).getTime() || 0), 0);
    if (!latestInbound) return { allowed: false, expiresAt: "" };
    const expiresAt = new Date(latestInbound + 24 * 60 * 60 * 1000).toISOString();
    return { allowed: Date.now() < new Date(expiresAt).getTime(), expiresAt };
  }

  function renderComposerState() {
    const conversation = selectedConversation();
    const whatsapp = isWhatsAppConversation(conversation);
    const windowState = whatsappReplyWindow(conversation);
    const blocked = Boolean(conversation && whatsapp && !windowState.allowed);
    const input = $("messageInput");
    const send = $("sendButton");
    const attach = $("attachmentButton");
    const greeting = document.querySelector('#messageForm [data-action="insert-greeting"]');
    const template = $("templateButton");
    const notice = $("replyWindowNotice");
    template.hidden = !whatsapp;
    notice.hidden = !blocked;
    input.disabled = blocked;
    send.disabled = blocked;
    attach.disabled = blocked || !whatsapp;
    greeting.disabled = blocked;
    input.placeholder = blocked ? "The WhatsApp reply window is closed" : "Write a reply…";
    $("messageForm").classList.toggle("is-window-closed", blocked);
    attach.title = !whatsapp ? "Attachments are currently available for WhatsApp conversations" : blocked ? "Send an approved template to reopen the conversation" : "Attach a file";
    if (blocked) {
      const expiry = windowState.expiresAt ? new Date(windowState.expiresAt) : null;
      const expiryCopy = expiry && !Number.isNaN(expiry.getTime())
        ? ` The reply window ended ${relativeTime(expiry.toISOString())}.`
        : "";
      const reason = conversation.replyWindowReason || "A free-form reply is no longer allowed.";
      const templatePrompt = /approved template/i.test(reason) ? "" : " Send an approved template to continue.";
      $("replyWindowMessage").textContent = `${reason}${expiryCopy}${templatePrompt}`;
    }
  }

  function renderContacts() {
    const search = state.contactSearch.trim().toLocaleLowerCase();
    const contacts = state.contacts.filter((contact) => `${contact.displayName} ${contact.email} ${contact.phone} ${contact.channelProfileId} ${contact.company} ${contact.channelName} ${contact.tags.join(" ")}`.toLocaleLowerCase().includes(search));
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
      row.dataset.contactId = contact.contactId;
      row.tabIndex = 0;
      row.classList.toggle("is-selected", contact.contactId === state.selectedContactId);
      row.setAttribute("aria-label", `View and edit ${contact.displayName}`);
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

  function populateContactEditorChannels(selectedId = "") {
    const select = $("contactEditChannel");
    select.replaceChildren();
    state.channels.filter((channel) => providerProfiles[channel.connectorType]).forEach((channel) => {
      const option = document.createElement("option");
      option.value = channel.channelId;
      option.textContent = `${channel.name} · ${(providerProfiles[channel.connectorType] || {}).label || channel.connectorType}`;
      option.disabled = channel.enabled === false;
      select.append(option);
    });
    if ([...select.options].some((option) => option.value === selectedId)) select.value = selectedId;
  }

  function showContactEditor(contact, { loading = false, error = "" } = {}) {
    const panel = $("contactEditor");
    const fields = $("contactEditorFields");
    const actions = $("contactEditorActions");
    panel.hidden = false;
    $("contactsWorkspace").classList.add("has-editor");
    $("contactEditorStatus").hidden = Boolean(contact) && !loading && !error;
    $("contactEditorStatus").textContent = loading ? "Loading contact details…" : error || "Choose a contact to view the details.";
    fields.hidden = !contact || loading || Boolean(error);
    actions.hidden = fields.hidden;
    if (!contact || fields.hidden) return;
    const normalized = normalizeContact(contact);
    $("contactEditorTitle").textContent = normalized.displayName;
    $("contactEditId").value = normalized.contactId;
    $("contactEditName").value = normalized.displayName;
    populateContactEditorChannels(normalized.channelId);
    $("contactEditChannel").disabled = !normalized.channelEditable;
    $("contactEditChannelHelp").textContent = normalized.channelEditable
      ? "You can change the channel until the first message is sent or received."
      : "Channel is locked because this contact already has message history.";
    $("contactEditProviderId").value = normalized.channelProfileId === "—" ? "" : normalized.channelProfileId;
    $("contactEditCompany").value = normalized.company;
    $("contactEditTags").value = normalized.tags.join(", ");
  }

  async function selectContact(contactId) {
    if (!contactId) return;
    state.selectedContactId = contactId;
    renderContacts();
    const cached = state.contacts.find((contact) => contact.contactId === contactId) || null;
    showContactEditor(cached, { loading: true });
    try {
      const result = await state.api.getContact(contactId);
      if (state.selectedContactId !== contactId) return;
      const contact = normalizeContact(result.item || result);
      const index = state.contacts.findIndex((item) => item.contactId === contactId);
      if (index >= 0) state.contacts[index] = { ...state.contacts[index], ...contact };
      else state.contacts.push(contact);
      showContactEditor(contact);
      renderContacts();
    } catch (error) {
      if (state.selectedContactId === contactId) showContactEditor(null, { error: `Contact details could not be loaded: ${error.message}` });
    }
  }

  function closeContactEditor() {
    state.selectedContactId = null;
    $("contactsWorkspace").classList.remove("has-editor");
    $("contactEditor").hidden = true;
    $("contactEditForm").reset();
    $("contactEditorTitle").textContent = "Edit contact";
    renderContacts();
  }

  async function saveContactEdits(form) {
    const data = new FormData(form);
    const contactId = String(data.get("contactId") || "");
    const payload = {
      displayName: String(data.get("displayName") || "").trim(),
      channelId: String($("contactEditChannel").value || "").trim(),
      channelProfileId: String(data.get("channelProfileId") || "").trim(),
      company: String(data.get("company") || "").trim(),
      tags: String(data.get("tags") || "").split(/[,\n]/).map((tag) => tag.trim()).filter(Boolean),
    };
    if (!contactId || !payload.displayName || !payload.channelId || !payload.channelProfileId) {
      form.reportValidity();
      return;
    }
    const submit = $("contactEditSubmit");
    submit.disabled = true;
    submit.textContent = "Saving…";
    try {
      const result = await state.api.updateContact(contactId, payload);
      const updated = normalizeContact(result.item || { contactId, ...payload });
      const index = state.contacts.findIndex((contact) => contact.contactId === contactId);
      if (index >= 0) state.contacts[index] = { ...state.contacts[index], ...updated };
      state.conversations.filter((conversation) => conversation.contactId === contactId).forEach((conversation) => {
        conversation.subject = updated.displayName;
        conversation.channelId = updated.channelId;
      });
      showContactEditor(state.contacts[index] || updated);
      renderContacts();
      renderConversationList();
      renderSelectedConversation();
      showToast("Contact saved", `${updated.displayName} was updated.`);
    } catch (error) {
      showToast("Contact was not saved", error.message, true);
    } finally {
      submit.disabled = false;
      submit.textContent = "Save contact";
    }
  }

  function renderChannels() {
    const channels = state.channels.filter((channel) => providerProfiles[channel.connectorType]);
    const stats = $("channelStats");
    stats.replaceChildren();
    const live = channels.filter((channel) => channel.health === "connected" && channel.enabled).length;
    const attention = channels.filter((channel) => channel.health !== "connected" || !channel.enabled).length;
    [["Connected channels", channels.length], ["Live", live], ["Needs attention", attention]].forEach(([label, value]) => {
      const card = element("div", "stat-card");
      card.append(element("span", "", label), element("strong", "", String(value)));
      stats.append(card);
    });

    const grid = $("channelGrid");
    grid.replaceChildren();
    if (!channels.length) {
      const empty = element("div", "channel-empty-state");
      empty.append(
        element("span", "channel-empty-icon", "+"),
        element("h3", "", "Connect your first messaging account"),
        element("p", "", "Add WhatsApp, Telegram, or Instagram now. You can connect more accounts at any time.")
      );
      const add = element("button", "primary-button", "Add channel");
      add.type = "button";
      add.dataset.action = "open-channel";
      empty.append(add);
      grid.append(empty);
      return;
    }
    channels.forEach((channel) => grid.append(renderChannelCard(channel)));
  }

  function renderChannelCard(channel) {
    const profile = providerProfiles[channel.connectorType] || providerProfiles.whatsapp_cloud;
    const health = channelHealthView(channel);
    const expanded = state.expandedChannelIds.has(channel.channelId);
    const card = element("article", `channel-card connection-card${expanded ? " is-expanded" : ""}`);
    const head = element("div", "channel-card-head");
    const identity = element("div", "channel-card-identity");
    const logo = providerLogo(channel.connectorType, "channel-logo");
    const name = document.createElement("div");
    name.append(element("span", "provider-label", profile.label), element("h3", "", channel.name), element("span", `health-dot${health.className ? ` ${health.className}` : ""}`, health.label));
    identity.append(logo, name);
    const headActions = element("div", "channel-head-actions");
    const providerLink = document.createElement("a");
    providerLink.className = "secondary-button compact-button";
    providerLink.href = profile.setupUrl;
    providerLink.target = "_blank";
    providerLink.rel = "noopener noreferrer";
    providerLink.textContent = profile.setupLabel;
    const edit = element("button", "secondary-button compact-button", "Edit");
    edit.type = "button";
    edit.dataset.action = "edit-channel";
    edit.dataset.channelId = channel.channelId;
    const expand = element("button", "secondary-button compact-button channel-expand-button", expanded ? "Collapse" : "Expand");
    expand.type = "button";
    expand.dataset.action = "toggle-channel-details";
    expand.dataset.channelId = channel.channelId;
    expand.setAttribute("aria-expanded", String(expanded));
    expand.setAttribute("aria-controls", `channel-details-${channel.channelId}`);
    headActions.append(providerLink, edit, expand);
    head.append(identity, headActions);

    const conversations = state.conversations.filter((item) => item.channelId === channel.channelId);
    const unread = conversations.reduce((sum, item) => sum + item.unreadCount, 0);
    const metrics = element("div", "channel-metrics");
    metrics.append(
      metric("Conversations", conversations.length),
      metric("Unread", unread),
      metric("Last webhook", channel.setup?.lastWebhookAt ? relativeTime(channel.setup.lastWebhookAt) : "Waiting")
    );

    const body = element("div", "connection-card-body");
    body.append(element("p", "channel-description", profile.description));
    const verifiedIdentity = [channel.setup?.verifiedName, channel.setup?.verifiedPhoneNumber].filter(Boolean).join(" · ");
    if (verifiedIdentity) body.append(element("p", "verified-identity", verifiedIdentity));

    const setup = element("section", "connection-setup");
    const credentialsReady = Boolean(channel.setup?.credentialsPresent || ["configured", "receiving", "webhook_required", "connected"].includes(channel.health));
    const identityVerified = Boolean(channel.setup?.credentialsVerifiedAt || ["webhook_required", "connected"].includes(channel.health));
    const webhookVerified = Boolean(channel.setup?.webhookVerifiedAt || channel.health === "connected");
    const progress = [credentialsReady, identityVerified, webhookVerified].filter(Boolean).length;
    const setupHead = element("div", "connection-setup-head");
    setupHead.append(element("strong", "", "Connection setup"), element("span", "meta-progress", `${progress}/3 ready`));
    setup.append(setupHead, element("p", "channel-setup-note", health.summary));

    const readiness = element("div", "readiness-list");
    readiness.append(
      readinessItem("Credentials", credentialsReady),
      readinessItem("Provider identity", identityVerified),
      readinessItem("Webhook", webhookVerified)
    );
    setup.append(readiness);

    const callbackUrl = channel.setup?.webhookUrl || state.api.webhookUrl(channel);
    const callbackBlock = element("div", "callback-block");
    callbackBlock.append(element("span", "callback-label", "Webhook callback"));
    const callbackRow = element("div", "meta-callback-row");
    callbackRow.append(element("code", "channel-callback", callbackUrl));
    const copyButton = element("button", "secondary-button compact-button", "Copy URL");
    copyButton.type = "button";
    copyButton.dataset.action = "copy-webhook-callback";
    copyButton.dataset.copyValue = callbackUrl;
    callbackRow.append(copyButton);
    callbackBlock.append(callbackRow);

    if (channel.connectorType === "whatsapp_cloud" || channel.connectorType === "instagram") {
      const storedVerifyToken = Boolean(channel.setup?.credentialFields?.verifyToken || channel.setup?.credentialsPresent);
      const recentVerifyToken = state.recentVerifyTokens.get(channel.channelId) || "";
      const tokenBlock = element("div", "callback-token-block");
      tokenBlock.append(element("span", "callback-label", "Webhook verify token"));
      const tokenRow = element("div", "callback-token-row");
      const display = document.createElement("input");
      display.className = "text-field callback-token-display";
      display.type = "password";
      display.readOnly = true;
      display.value = recentVerifyToken || (storedVerifyToken ? SAVED_SECRET_MASK : "");
      display.placeholder = "No verify token saved";
      display.setAttribute("aria-label", recentVerifyToken
        ? "New webhook verify token ready to copy"
        : storedVerifyToken ? "Webhook verify token saved securely" : "No webhook verify token saved");
      const status = element("span", `saved-secret-status${recentVerifyToken || storedVerifyToken ? " is-saved" : ""}`,
        recentVerifyToken ? "New token ready to copy" : storedVerifyToken ? "Saved securely" : "Not set");
      const displayWrap = element("div", "callback-token-display-wrap");
      displayWrap.append(display, status);
      tokenRow.append(displayWrap);
      const copyToken = element("button", "secondary-button compact-button", "Copy token");
      copyToken.type = "button";
      copyToken.dataset.action = "copy-webhook-token";
      copyToken.dataset.channelId = channel.channelId;
      tokenRow.append(copyToken);
      const replaceToken = element("button", "secondary-button compact-button", storedVerifyToken ? "Replace token" : "Set token");
      replaceToken.type = "button";
      replaceToken.dataset.action = "edit-webhook-token";
      replaceToken.dataset.channelId = channel.channelId;
      tokenRow.append(replaceToken);
      tokenBlock.append(tokenRow, element("span", "callback-token-help",
        recentVerifyToken ? "Copy this value into Meta now. It will be masked again after a refresh."
          : storedVerifyToken ? "The saved value stays masked. Replace it only when you also update Meta."
            : "Set this to the same private value used in Meta's webhook configuration."));
      callbackBlock.append(tokenBlock);
    }
    setup.append(callbackBlock);

    const actions = element("div", "channel-card-actions");
    const verify = element("button", "primary-button", channel.health === "connected"
      ? "Recheck connection"
      : channel.health === "receiving" ? "Verify sending" : "Verify connection");
    verify.type = "button";
    verify.dataset.action = "verify-channel";
    verify.dataset.channelId = channel.channelId;
    verify.disabled = !credentialsReady || !channel.enabled;
    const toggle = element("button", "secondary-button", channel.enabled ? "Disable" : "Enable");
    toggle.type = "button";
    toggle.dataset.action = "toggle-channel";
    toggle.dataset.channelId = channel.channelId;
    actions.append(toggle, verify);
    setup.append(actions);

    if ((channel.connectorType === "whatsapp_cloud" || channel.connectorType === "instagram") && !webhookVerified) {
      const note = element("div", "meta-webhook-warning");
      if (channel.connectorType === "instagram" && channel.config?.appId) {
        note.append(element("strong", "", "Shared Meta app callback"), element("span", "", "Use this URL once for every Instagram account connected through the same Meta App ID. Helixcer routes messages by account ID."));
      } else {
        note.append(element("strong", "", "Meta callback"), element("span", "", "Meta allows one callback per app. Replace an existing callback only when this connection is ready."));
      }
      setup.append(note);
    }

    const overview = element("div", "channel-overview");
    overview.append(body, metrics);
    const details = element("div", "channel-expanded-content");
    details.id = `channel-details-${channel.channelId}`;
    details.hidden = !expanded;
    details.append(overview, setup);
    card.append(head, details);
    return card;
  }

  function channelHealthView(channel) {
    const states = {
      setup_required: { label: "Setup required", className: "is-warning", summary: "Add the required provider IDs and credentials." },
      configured: { label: "Ready to verify", className: "is-warning", summary: "Credentials are encrypted and ready for verification." },
      receiving: { label: "Receiving", className: "", summary: "Signed webhook messages are reaching the Inbox. Verify provider access when you are ready to send replies." },
      webhook_required: { label: "Webhook required", className: "is-warning", summary: "The provider identity is verified. Complete the webhook setup." },
      connected: { label: "Live", className: "", summary: "This connection is ready for live messaging." },
      error: { label: "Connection error", className: "is-error", summary: "Review the credentials and verify the connection again." },
      disconnected: { label: "Disabled", className: "is-disconnected", summary: "The history is preserved, but messaging is paused." },
    };
    if (!channel.enabled) return states.disconnected;
    return states[channel.health] || states.setup_required;
  }

  function readinessItem(label, complete) {
    const item = element("span", `readiness-item${complete ? " is-ready" : ""}`);
    item.append(element("i", "", complete ? "✓" : ""), document.createTextNode(label));
    return item;
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

  function normalizeApiKey(raw) {
    const parseList = (value) => {
      if (Array.isArray(value)) return value.map(String);
      if (typeof value !== "string" || !value) return [];
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        return value.split(",").map((item) => item.trim()).filter(Boolean);
      }
    };
    return {
      ...raw,
      apiKeyId: String(raw.apiKeyId || raw.id || ""),
      name: String(raw.name || "API key"),
      keyPrefix: String(raw.keyPrefix || raw.prefix || "hxc_live_…"),
      scopes: parseList(raw.scopes || raw.scopesJson),
      status: raw.status || (raw.revokedAt ? "revoked" : "active"),
      createdAt: raw.createdAt || new Date().toISOString(),
      lastUsedAt: raw.lastUsedAt || "",
      expiresAt: raw.expiresAt || "",
      revokedAt: raw.revokedAt || "",
    };
  }

  async function loadApiKeys() {
    if (!canAdmin()) {
      state.apiKeys = [];
      renderApiKeys();
      return;
    }
    try {
      const data = await state.api.getApiKeys();
      state.apiKeys = asItems(data.apiKeys || data).map(normalizeApiKey);
      renderApiKeys();
    } catch (error) {
      state.apiKeys = [];
      renderApiKeys();
      if (error.status !== 403) showToast("API keys could not be loaded", error.message, true);
    }
  }

  function renderApiKeys() {
    const body = $("apiKeyTableBody");
    body.replaceChildren();
    if (!state.apiKeys.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 4;
      cell.className = "empty-list";
      cell.textContent = "No API keys have been created.";
      row.append(cell);
      body.append(row);
      return;
    }
    state.apiKeys.forEach((apiKey) => {
      const row = document.createElement("tr");
      const identityCell = document.createElement("td");
      const identity = element("div", "api-key-identity");
      identity.append(element("strong", "", apiKey.name), element("code", "", apiKey.keyPrefix));
      identityCell.append(identity);

      const lastUsedCell = tableCell(apiKey.lastUsedAt ? relativeTime(apiKey.lastUsedAt) : "Never");
      const statusCell = document.createElement("td");
      const expired = apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() <= Date.now();
      const status = apiKey.status === "revoked" ? "Revoked" : expired ? "Expired" : "Active";
      statusCell.append(element("span", `status-chip${status === "Active" ? "" : " is-inactive"}`, status));

      const actionCell = document.createElement("td");
      if (status === "Active") {
        const revoke = element("button", "member-action is-danger", "Revoke");
        revoke.type = "button";
        revoke.dataset.action = "revoke-api-key";
        revoke.dataset.revokeApiKey = apiKey.apiKeyId;
        actionCell.append(revoke);
      }
      row.append(identityCell, lastUsedCell, statusCell, actionCell);
      body.append(row);
    });
  }

  function openApiKeyDialog() {
    const form = $("apiKeyForm");
    form.reset();
    $("apiKeyOutput").value = "";
    $("apiKeyFields").hidden = false;
    $("apiKeyResult").hidden = true;
    $("apiKeySubmit").hidden = false;
    $("apiKeyDialog").showModal();
  }

  function closeApiKeyDialog() {
    $("apiKeyOutput").value = "";
    $("apiKeyDialog").close();
  }

  async function createDeveloperApiKey(form) {
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    if (!name || !form.elements.name.checkValidity()) {
      form.elements.name.reportValidity();
      return;
    }
    const expiryDate = String(data.get("expiresAt") || "");
    const payload = {
      name,
      ...(expiryDate ? { expiresAt: new Date(`${expiryDate}T23:59:59.999Z`).toISOString() } : {}),
    };
    $("apiKeySubmit").disabled = true;
    try {
      const result = await state.api.createApiKey(payload);
      const secret = String(result.apiKey || result.key || result.secret || result.token || "");
      if (!secret) throw new Error("The key was created, but its one-time secret was not returned.");
      $("apiKeyOutput").value = secret;
      $("apiKeyFields").hidden = true;
      $("apiKeyResult").hidden = false;
      $("apiKeySubmit").hidden = true;
      await loadApiKeys();
      showToast("API key created", "Copy the secret now; it will not be shown again.");
    } catch (error) {
      showToast("API key could not be created", error.message, true);
    } finally {
      $("apiKeySubmit").disabled = false;
    }
  }

  async function revokeDeveloperApiKey(apiKeyId, button) {
    const apiKey = state.apiKeys.find((item) => item.apiKeyId === apiKeyId);
    if (!apiKey || !window.confirm(`Revoke “${apiKey.name}”? Apps using this key will stop working immediately.`)) return;
    button.disabled = true;
    try {
      await state.api.revokeApiKey(apiKeyId);
      await loadApiKeys();
      showToast("API key revoked", apiKey.name);
    } catch (error) {
      button.disabled = false;
      showToast("API key was not revoked", error.message, true);
    }
  }

  async function copyDeveloperApiValue(value, title) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      showToast(title, "Copied to the clipboard.");
    } catch {
      showToast("Copy was blocked", "Select the value and copy it manually.", true);
    }
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
    if (isWhatsAppConversation(conversation) && !whatsappReplyWindow(conversation).allowed) {
      renderComposerState();
      showToast("Use a WhatsApp template", "The 24-hour reply window is closed for this conversation.", true);
      return;
    }
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
      renderComposerState();
      if (!input.disabled) input.focus();
    }
  }

  function templatePlaceholders(text) {
    const seen = new Set();
    return [...String(text || "").matchAll(/{{\s*([^{}]+?)\s*}}/g)]
      .map((match) => match[1].trim())
      .filter((value) => value && !seen.has(value) && seen.add(value));
  }

  function templateVariableDescriptors(template) {
    if (Array.isArray(template?.variables)) {
      return template.variables.map((variable, index) => {
        const componentType = String(variable.component || "body").toLowerCase();
        const sourceKind = String(variable.kind || "text").toLowerCase();
        const key = String(variable.key || variable.parameterIndex + 1 || index + 1);
        const media = ["image", "video", "document"].includes(sourceKind);
        const buttonIndex = Number(variable.buttonIndex ?? 0);
        return {
          id: `${componentType}-${variable.componentIndex ?? 0}-${buttonIndex}-${variable.parameterIndex ?? index}-${key.replace(/[^a-z0-9_-]/gi, "-")}`,
          componentType,
          subType: componentType === "button" ? "url" : "",
          buttonIndex,
          kind: media ? "media" : sourceKind === "location" ? "location" : "text",
          mediaType: media ? sourceKind : "",
          parameterName: /^\d+$/.test(key) || key === "media" ? "" : key,
          label: media
            ? `${capitalize(sourceKind)} header URL`
            : sourceKind === "location" ? "Location header" : componentType === "button" ? `Button ${buttonIndex + 1} URL value` : `${capitalize(componentType)} variable ${key}`,
        };
      });
    }
    const descriptors = [];
    asItems(template?.components).forEach((component) => {
      const type = String(component.type || "").toUpperCase();
      const format = String(component.format || "").toLowerCase();
      if (type === "HEADER" && ["image", "video", "document"].includes(format)) {
        descriptors.push({ id: `header-media-${format}`, componentType: "header", kind: "media", mediaType: format, label: `${capitalize(format)} header URL` });
      }
      if (type === "HEADER" || type === "BODY") {
        templatePlaceholders(component.text).forEach((placeholder, index) => descriptors.push({
          id: `${type.toLowerCase()}-text-${index}-${placeholder.replace(/[^a-z0-9_-]/gi, "-")}`,
          componentType: type.toLowerCase(),
          kind: "text",
          parameterName: /^\d+$/.test(placeholder) ? "" : placeholder,
          label: `${capitalize(type.toLowerCase())} variable ${placeholder}`,
        }));
      }
      if (type === "BUTTONS") {
        asItems(component.buttons).forEach((button, buttonIndex) => {
          if (String(button.type || "").toUpperCase() !== "URL") return;
          templatePlaceholders(button.url).forEach((placeholder, index) => descriptors.push({
            id: `button-${buttonIndex}-${index}-${placeholder.replace(/[^a-z0-9_-]/gi, "-")}`,
            componentType: "button",
            subType: "url",
            buttonIndex,
            kind: "text",
            parameterName: /^\d+$/.test(placeholder) ? "" : placeholder,
            label: `${button.text || `Button ${buttonIndex + 1}`} URL value`,
          }));
        });
      }
    });
    return descriptors;
  }

  function currentTemplate() {
    const templates = state.templatesByConversation.get(state.templateConversationId) || [];
    return templates.find((template) => template._selectionKey === $("templateSelect").value) || null;
  }

  function templateSourceValue(source, conversation = selectedConversation()) {
    const contact = conversation ? contactFor(conversation) : null;
    const channel = conversation ? channelFor(conversation.channelId) : null;
    const values = {
      displayName: contact?.displayName || conversation?.subject || "",
      channelProfileId: contact?.channelProfileId === "—" ? "" : contact?.channelProfileId || conversation?.channelProfileId || "",
      company: contact?.company || "",
      tags: contact?.tags?.join(", ") || "",
      channelName: channel?.name || "",
    };
    return values[source] || "";
  }

  function suggestedTemplateSource(descriptor) {
    if (["media", "location"].includes(descriptor.kind)) return "manual";
    const name = String(descriptor.parameterName || "").toLocaleLowerCase();
    if (!name) return "";
    const sources = new Map([
      ["name", "displayName"],
      ["customer_name", "displayName"],
      ["contact_name", "displayName"],
      ["recipient_name", "displayName"],
      ["company", "company"],
      ["company_name", "company"],
      ["tag", "tags"],
      ["tags", "tags"],
      ["channel", "channelName"],
      ["channel_name", "channelName"],
      ["phone", "channelProfileId"],
      ["phone_number", "channelProfileId"],
      ["provider_id", "channelProfileId"],
      ["contact_id", "channelProfileId"],
      ["wa_id", "channelProfileId"]
    ]);
    return sources.get(name) || "";
  }

  function syncTemplateVariableSource(row) {
    const select = row.querySelector("select");
    const input = row.querySelector("input");
    const preview = row.querySelector(".template-source-preview");
    const manual = select.value === "manual";
    input.hidden = !manual;
    input.required = manual;
    const resolved = manual ? input.value.trim() : templateSourceValue(select.value);
    preview.hidden = manual;
    preview.textContent = select.value
      ? (resolved || "No saved value for this contact")
      : "Choose a contact field or manual entry";
    preview.classList.toggle("is-missing", !resolved);
  }

  function renderTemplateVariables() {
    const template = currentTemplate();
    const host = $("templateVariableFields");
    const summary = $("templateSummary");
    host.replaceChildren();
    if (!template) {
      summary.hidden = true;
      return;
    }
    const languageCode = template.language?.code || template.language || "";
    summary.hidden = false;
    summary.textContent = [template.category, languageCode, template.status].filter(Boolean).join(" · ");
    const descriptors = templateVariableDescriptors(template);
    if (!descriptors.length) {
      host.append(element("p", "template-no-variables", "This template does not require any values."));
      return;
    }
    descriptors.forEach((descriptor) => {
      const row = element("div", "template-variable-row");
      row.dataset.variableId = descriptor.id;
      const label = element("label", "field-label", descriptor.label);
      const source = document.createElement("select");
      source.className = "text-field template-source-select";
      source.setAttribute("aria-label", `${descriptor.label} source`);
      [
        ["", "Choose source"],
        ["displayName", "Contact name"],
        ["channelProfileId", "Provider ID"],
        ["company", "Company"],
        ["tags", "Tags"],
        ["channelName", "Channel name"],
        ["manual", "Manual entry"],
      ].forEach(([value, text]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        if (!value) option.disabled = true;
        source.append(option);
      });
      source.value = suggestedTemplateSource(descriptor);
      label.append(source);
      const manual = document.createElement("input");
      manual.className = "text-field template-manual-value";
      manual.type = descriptor.kind === "media" ? "url" : "text";
      manual.maxLength = descriptor.kind === "media" ? 2048 : 1000;
      manual.placeholder = descriptor.kind === "media"
        ? "https://example.com/media.jpg"
        : descriptor.kind === "location" ? "12.9716, 77.5946 | Location name | Address" : `Enter ${descriptor.label.toLowerCase()}`;
      manual.setAttribute("aria-label", `${descriptor.label} manual value`);
      const preview = element("span", "template-source-preview");
      row.append(label, manual, preview);
      host.append(row);
      syncTemplateVariableSource(row);
    });
  }

  async function loadConversationTemplates(conversationId, { refresh = false } = {}) {
    const select = $("templateSelect");
    const status = $("templateLoadStatus");
    const submit = $("templateSubmit");
    select.disabled = true;
    submit.disabled = true;
    status.hidden = false;
    status.classList.remove("is-error");
    status.textContent = "Loading approved templates from WhatsApp…";
    select.replaceChildren(new Option("Loading templates…", ""));
    $("templateVariableFields").replaceChildren();
    $("templateSummary").hidden = true;
    try {
      let templates = !refresh ? state.templatesByConversation.get(conversationId) : null;
      if (!templates) {
        const result = await state.api.getTemplates(conversationId);
        templates = asItems(result).filter((template) => !template.status || String(template.status).toUpperCase() === "APPROVED");
        templates = templates.map((template, index) => ({
          ...template,
          _selectionKey: `${template.templateId || template.name || index}::${template.language?.code || template.language || ""}::${index}`,
        }));
        state.templatesByConversation.set(conversationId, templates);
      }
      if (state.templateConversationId !== conversationId) return;
      select.replaceChildren(new Option(templates.length ? "Choose a template" : "No approved templates found", ""));
      templates.forEach((template) => {
        const language = template.language?.code || template.language || "";
        const option = new Option(`${template.name}${language ? ` · ${language}` : ""}`, template._selectionKey);
        select.append(option);
      });
      select.disabled = !templates.length;
      submit.disabled = !templates.length;
      status.textContent = templates.length
        ? `${templates.length} approved template${templates.length === 1 ? "" : "s"} available.`
        : "No approved templates are available for this WhatsApp connection.";
      status.append(document.createTextNode(" "));
      const refreshButton = element("button", "inline-retry", "Refresh");
      refreshButton.type = "button";
      refreshButton.dataset.action = "reload-templates";
      status.append(refreshButton);
      if (templates.length) select.focus();
    } catch (error) {
      if (state.templateConversationId !== conversationId) return;
      status.classList.add("is-error");
      status.replaceChildren(document.createTextNode(`Templates could not be loaded: ${error.message} `));
      const retry = element("button", "inline-retry", "Retry");
      retry.type = "button";
      retry.dataset.action = "reload-templates";
      status.append(retry);
      select.replaceChildren(new Option("Templates unavailable", ""));
    }
  }

  function openTemplateDialog() {
    const conversation = selectedConversation();
    if (!conversation || !isWhatsAppConversation(conversation)) {
      showToast("WhatsApp conversation required", "Templates can currently be sent from WhatsApp conversations only.", true);
      return;
    }
    const form = $("templateForm");
    form.reset();
    state.templateConversationId = conversation.conversationId;
    $("templateDialog").showModal();
    loadConversationTemplates(conversation.conversationId);
  }

  async function sendCurrentTemplate(form) {
    const conversation = selectedConversation();
    if (!conversation || !isWhatsAppConversation(conversation)) return;
    const values = new FormData(form);
    const template = currentTemplate();
    if (!template) {
      showToast("Choose a template", "Select an approved template before sending.", true);
      return;
    }
    const name = String(template.name || "").trim();
    const languageCode = String(template.language?.code || template.language || "").trim();
    const previewText = String(values.get("previewText") || "").trim();
    if (!name || !languageCode) return;
    const descriptors = templateVariableDescriptors(template);
    const componentMap = new Map();
    for (const descriptor of descriptors) {
      const row = $("templateVariableFields").querySelector(`[data-variable-id="${CSS.escape(descriptor.id)}"]`);
      const source = row?.querySelector("select")?.value || "";
      const manual = row?.querySelector("input")?.value?.trim() || "";
      if (!source) {
        showToast("Choose a template source", `Choose a contact field or manual entry for ${descriptor.label}.`, true);
        row?.querySelector("select")?.focus();
        return;
      }
      const value = source === "manual" ? manual : templateSourceValue(source, conversation);
      if (!value) {
        showToast("Template value required", `${descriptor.label} does not have a value. Choose another source or enter it manually.`, true);
        row?.querySelector(source === "manual" ? "input" : "select")?.focus();
        return;
      }
      let key = descriptor.componentType;
      if (descriptor.componentType === "button") key = `button:${descriptor.buttonIndex}`;
      if (!componentMap.has(key)) componentMap.set(key, descriptor.componentType === "button"
        ? { type: "button", sub_type: descriptor.subType, index: String(descriptor.buttonIndex), parameters: [] }
        : { type: descriptor.componentType, parameters: [] });
      const component = componentMap.get(key);
      if (descriptor.kind === "media") {
        component.parameters.push({ type: descriptor.mediaType, [descriptor.mediaType]: { link: value } });
      } else if (descriptor.kind === "location") {
        const [coordinates, name = "", address = ""] = value.split("|").map((part) => part.trim());
        const [latitude, longitude] = coordinates.split(",").map((part) => Number(part.trim()));
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          showToast("Location is invalid", "Enter latitude and longitude separated by a comma, followed by optional name and address.", true);
          row?.querySelector("input")?.focus();
          return;
        }
        component.parameters.push({ type: "location", location: { latitude, longitude, ...(name ? { name } : {}), ...(address ? { address } : {}) } });
      } else {
        const parameter = { type: "text", text: value };
        if (descriptor.parameterName) parameter.parameter_name = descriptor.parameterName;
        component.parameters.push(parameter);
      }
    }
    const requestTemplate = { name, language: { code: languageCode } };
    if (componentMap.size) requestTemplate.components = [...componentMap.values()];
    const submit = $("templateSubmit");
    submit.disabled = true;
    submit.textContent = "Sending…";
    try {
      const request = previewText ? { ...requestTemplate, previewText } : requestTemplate;
      const result = await state.api.sendTemplate(conversation.conversationId, request);
      const fallback = previewText || `[Template: ${name}]`;
      const message = normalizeMessage(result.item || result.message || { text: fallback, direction: "outbound", status: "pending", messageType: "template" });
      upsertMessage(conversation.conversationId, message);
      conversation.lastMessage = message.text || fallback;
      conversation.lastMessageAt = message.timestamp;
      $("templateDialog").close();
      renderMessages();
      renderConversationList();
      showToast("Template queued", `${name} is being sent through WhatsApp.`);
    } catch (error) {
      showToast("Template was not sent", error.message, true);
    } finally {
      submit.disabled = false;
      submit.textContent = "Send template";
    }
  }

  function attachmentSizeLimit(file) {
    return 16 * 1024 * 1024;
  }

  function formatFileSize(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function uploadCurrentAttachment(file) {
    const conversation = selectedConversation();
    const status = $("attachmentStatus");
    if (!conversation || !file) return;
    if (!isWhatsAppConversation(conversation)) {
      showToast("WhatsApp conversation required", "File sending is currently available for WhatsApp conversations.", true);
      return;
    }
    if (!whatsappReplyWindow(conversation).allowed) {
      renderComposerState();
      showToast("Use a WhatsApp template", "Attachments cannot be sent after the 24-hour reply window closes.", true);
      return;
    }
    const limit = attachmentSizeLimit(file);
    if (file.size > limit) {
      showToast("File is too large", `${file.name} is ${formatFileSize(file.size)}. The limit for this file type is ${formatFileSize(limit)}.`, true);
      return;
    }
    const input = $("messageInput");
    const formData = new FormData();
    formData.append("file", file, file.name);
    if (input.value.trim()) formData.append("caption", input.value.trim());
    status.hidden = false;
    status.classList.remove("is-error");
    status.textContent = `Uploading ${file.name} (${formatFileSize(file.size)})…`;
    $("attachmentButton").disabled = true;
    try {
      const result = await state.api.sendAttachment(conversation.conversationId, formData);
      const fallback = input.value.trim() || `[Attachment: ${file.name}]`;
      const message = normalizeMessage(result.item || { text: fallback, direction: "outbound", status: "pending", messageType: "document" });
      upsertMessage(conversation.conversationId, message);
      conversation.lastMessage = message.text || fallback;
      conversation.lastMessageAt = message.timestamp;
      input.value = "";
      resizeComposer();
      status.textContent = `${file.name} sent`;
      renderMessages();
      renderConversationList();
      setTimeout(() => { status.hidden = true; }, 3500);
    } catch (error) {
      status.classList.add("is-error");
      status.textContent = `${file.name} was not sent: ${error.message}`;
      showToast("Attachment was not sent", error.message, true);
    } finally {
      $("attachmentInput").value = "";
      renderComposerState();
    }
  }

  function upsertMessage(conversationId, message) {
    const messages = state.messages.get(conversationId) || [];
    const index = messages.findIndex((item) => item.messageId === message.messageId);
    if (index >= 0) messages[index] = { ...messages[index], ...message };
    else messages.push(message);
    state.messages.set(conversationId, messages);
  }

  async function handleRealtimeEvent(event) {
    const type = event.type || event.event;
    if (type === "webhook.received") {
      const before = new Map(state.conversations.map((conversation) => [conversation.conversationId, {
        lastMessageAt: new Date(conversation.lastMessageAt).getTime() || 0,
        unreadCount: conversation.unreadCount,
      }]));
      if (state.selectedConversationId) state.messages.delete(state.selectedConversationId);
      await loadAll();
      state.conversations.forEach((conversation) => {
        const previous = before.get(conversation.conversationId);
        const timestamp = new Date(conversation.lastMessageAt).getTime() || 0;
        const isNewInbound = timestamp > (previous?.lastMessageAt || 0)
          && (!previous || conversation.unreadCount > previous.unreadCount || conversation.conversationId === state.selectedConversationId);
        if (isNewInbound) notifyInboundMessage(conversation, {
          direction: "inbound",
          text: conversation.lastMessage,
          timestamp: conversation.lastMessageAt,
        });
      });
      return;
    }
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
        if (message.direction === "inbound") {
          conversation.freeformAllowed = true;
          conversation.replyWindowExpiresAt = new Date(new Date(message.timestamp).getTime() + 24 * 60 * 60 * 1000).toISOString();
          if (conversationId !== state.selectedConversationId) conversation.unreadCount += 1;
          if (type === "message.created" && !existingMessage) notifyInboundMessage(conversation, message);
        }
      }
      renderCounts();
      renderConversationList();
      if (conversationId === state.selectedConversationId) renderMessages();
      return;
    }
    if (type === "conversation.updated" || type === "conversation.created") {
      const rawConversation = event.conversation || event.item || event.data || {};
      const eventConversationId = String(event.conversationId || rawConversation.conversationId || rawConversation.id || "");
      const existing = state.conversations.find((item) => item.conversationId === eventConversationId);
      if (!rawConversation.subject && !rawConversation.status) {
        const wasSelected = eventConversationId && eventConversationId === state.selectedConversationId;
        const previousStatus = existing?.status || "";
        await loadAll();
        const refreshed = state.conversations.find((item) => item.conversationId === eventConversationId);
        if (wasSelected && refreshed && refreshed.status !== previousStatus && ["pending", "closed"].includes(refreshed.status)) {
          clearSelectedConversation();
        }
        return;
      }
      const incoming = normalizeConversation({ ...existing, ...rawConversation });
      if (!incoming.conversationId) return;
      const index = state.conversations.findIndex((item) => item.conversationId === incoming.conversationId);
      if (index >= 0) state.conversations[index] = { ...state.conversations[index], ...incoming };
      else state.conversations.unshift(incoming);
      if (incoming.conversationId === state.selectedConversationId && ["pending", "closed"].includes(incoming.status)) {
        clearSelectedConversation();
      }
      renderAll();
      return;
    }
    if (type === "contact.updated") {
      const selectedContactId = state.selectedContactId;
      await loadAll();
      if (selectedContactId && state.contacts.some((contact) => contact.contactId === selectedContactId)) {
        await selectContact(selectedContactId);
      }
      return;
    }
    if (["channel.updated", "channel.deleted", "bootstrap.changed"].includes(type)) loadAll();
  }

  function isIosDevice() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent || "") || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function isStandaloneApp() {
    return window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone === true;
  }

  function notificationSupport() {
    return typeof window.Notification !== "undefined" && "serviceWorker" in navigator;
  }

  async function ensureServiceWorkerRegistration() {
    if (!("serviceWorker" in navigator)) return null;
    if (state.serviceWorkerRegistration) return state.serviceWorkerRegistration;
    const existing = await navigator.serviceWorker.getRegistration("/");
    state.serviceWorkerRegistration = existing || await navigator.serviceWorker.register("/sw.js");
    return state.serviceWorkerRegistration;
  }

  function renderNotificationSetting() {
    const toggle = $("pushNotificationsToggle");
    const status = $("notificationPermissionStatus");
    if (!toggle || !status) return;
    if (isIosDevice() && !isStandaloneApp()) {
      toggle.checked = false;
      toggle.disabled = true;
      status.textContent = "Add Helixcer to your Home Screen, open it there, then enable notifications.";
      return;
    }
    if (!notificationSupport()) {
      toggle.checked = false;
      toggle.disabled = true;
      status.textContent = "Notifications are not available in this browser. On mobile, install the app to your Home Screen and open it there.";
      return;
    }
    const permission = Notification.permission;
    if (permission === "denied") state.notificationsEnabled = false;
    toggle.checked = state.notificationsEnabled && permission === "granted";
    toggle.disabled = permission === "denied";
    status.textContent = permission === "granted"
      ? (toggle.checked ? "Enabled on this browser." : "Permission granted; alerts are currently off.")
      : permission === "denied"
        ? "Blocked in your browser settings. Allow notifications for this site to enable alerts."
        : "Your browser will ask for permission when you enable this setting.";
  }

  async function setBrowserNotifications(enabled) {
    const toggle = $("pushNotificationsToggle");
    if (!notificationSupport()) {
      renderNotificationSetting();
      return;
    }
    if (enabled && Notification.permission !== "granted") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        state.notificationsEnabled = false;
        localStorage.setItem(NOTIFICATION_PREFERENCE_KEY, "false");
        renderNotificationSetting();
        showToast("Notifications were not enabled", permission === "denied" ? "Allow notifications for this site in your browser settings." : "Permission was not granted.", true);
        return;
      }
    }
    if (enabled) {
      try {
        const registration = await ensureServiceWorkerRegistration();
        if (!registration?.showNotification) throw new Error("This browser cannot display service-worker notifications.");
      } catch (error) {
        state.notificationsEnabled = false;
        localStorage.setItem(NOTIFICATION_PREFERENCE_KEY, "false");
        renderNotificationSetting();
        showToast("Notifications were not enabled", `The notification service could not start: ${error.message}`, true);
        return;
      }
    }
    state.notificationsEnabled = enabled;
    localStorage.setItem(NOTIFICATION_PREFERENCE_KEY, String(enabled));
    renderNotificationSetting();
    showToast(enabled ? "Notifications enabled" : "Notifications disabled", enabled ? "This browser will alert you to new customer messages while Helixcer Chat is running." : "This browser will no longer show Helixcer message alerts.");
    toggle.blur();
  }

  async function notifyInboundMessage(conversation, message) {
    if (!state.notificationsEnabled || !notificationSupport() || Notification.permission !== "granted") return;
    if (document.visibilityState === "visible" && conversation.conversationId === state.selectedConversationId) return;
    const timestamp = new Date(message.timestamp || conversation.lastMessageAt).getTime() || Date.now();
    const previousNotification = state.lastNotificationAt.get(conversation.conversationId) || 0;
    if (timestamp <= previousNotification) return;
    state.lastNotificationAt.set(conversation.conversationId, timestamp);
    const title = `New message from ${conversation.subject}`;
    const options = {
      body: message.text || "A new customer message arrived.",
      icon: "/assets/helixcer-mark.jpg",
      badge: "/assets/helixcer-mark.jpg",
      tag: `helixcer-${conversation.conversationId}`,
      data: { url: "/#inbox", conversationId: conversation.conversationId },
    };
    let registration = null;
    try {
      registration = await ensureServiceWorkerRegistration();
    } catch {
      registration = null;
    }
    if (registration?.showNotification) {
      try {
        await registration.showNotification(title, options);
        return;
      } catch {
        // Desktop browsers can still use the window Notification API as a fallback.
      }
    }
    let notification;
    try {
      notification = new Notification(title, options);
    } catch {
      return;
    }
    notification.addEventListener("click", () => {
      window.focus();
      setRoute("inbox");
      selectConversation(conversation.conversationId);
      notification.close();
    });
  }

  async function refreshMessages(conversationId) {
    try {
      const data = await state.api.getMessages(conversationId);
      state.messages.set(conversationId, asItems(data).map(normalizeMessage));
      const conversation = state.conversations.find((item) => item.conversationId === conversationId);
      if (conversation && typeof data?.freeformAllowed === "boolean") conversation.freeformAllowed = data.freeformAllowed;
      if (conversation && data?.replyWindowExpiresAt) conversation.replyWindowExpiresAt = data.replyWindowExpiresAt;
      if (conversation && data?.replyWindowReason) conversation.replyWindowReason = data.replyWindowReason;
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
    if (!["inbox", "contacts", "channels", "developer", "team", "settings"].includes(route)) route = "inbox";
    if (!canAdmin() && ["channels", "developer", "team"].includes(route)) route = "inbox";
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
    const labels = { inbox: "Inbox", contacts: "Contacts", channels: "Channels", developer: "Developer API", team: "Team", settings: "Settings" };
    $("pageTitle").textContent = labels[route];
    if (route === "settings") renderNotificationSetting();
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

  async function copyWebhookCallback(button) {
    const value = String(button?.dataset.copyValue || "");
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      showToast("Callback URL copied", "Paste it into the provider's webhook configuration.");
    } catch {
      const code = button.closest(".meta-callback-row")?.querySelector("code");
      if (code) {
        const range = document.createRange();
        range.selectNodeContents(code);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      showToast("Copy the selected URL", "Your browser blocked automatic clipboard access.");
    }
  }

  function openWebhookTokenDialog(channelId) {
    const channel = state.channels.find((item) => item.channelId === channelId);
    if (!channel || !["whatsapp_cloud", "instagram"].includes(channel.connectorType)) return;
    const form = $("webhookTokenForm");
    form.reset();
    $("webhookTokenChannelId").value = channel.channelId;
    $("webhookTokenDialogTitle").textContent = `${channel.setup?.credentialFields?.verifyToken || channel.setup?.credentialsPresent ? "Replace" : "Set"} verify token`;
    $("webhookTokenDialogCopy").textContent = channel.setup?.credentialFields?.verifyToken || channel.setup?.credentialsPresent
      ? "The current token remains encrypted and cannot be displayed. Create a replacement only when you are ready to update Meta."
      : "Create the private token that Meta will use when verifying this webhook callback.";
    $("webhookTokenDialog").showModal();
    $("webhookTokenInput").focus();
  }

  async function copyWebhookVerifyToken(button) {
    const channelId = String(button?.dataset.channelId || "");
    if (!channelId || !button) return;
    let token = state.recentVerifyTokens.get(channelId) || "";
    const previous = button.textContent;
    button.disabled = true;
    button.textContent = "Loading…";
    try {
      if (!token) {
        const result = await state.api.getVerifyToken(channelId);
        token = String(result.verifyToken || "");
        if (!token) throw new Error("No verify token is saved for this channel.");
      }
      await navigator.clipboard.writeText(token);
      showToast("Verify token copied", "Paste it into Meta's webhook configuration.");
    } catch (error) {
      const input = button.closest(".callback-token-row")?.querySelector("input");
      if (input && token) {
        input.value = token;
        input.type = "text";
        input.focus();
        input.select();
        showToast("Copy the selected token", "Your browser blocked automatic clipboard access.");
      } else {
        showToast("Verify token could not be copied", error.message, true);
      }
    } finally {
      button.disabled = false;
      button.textContent = previous;
    }
  }

  async function saveWebhookVerifyToken(form) {
    const channelId = String(new FormData(form).get("channelId") || "");
    const verifyToken = String(new FormData(form).get("verifyToken") || "").trim();
    if (!channelId || !verifyToken) return;
    const submit = $("webhookTokenSubmit");
    submit.disabled = true;
    submit.textContent = "Saving…";
    try {
      await state.api.updateChannel(channelId, { credentials: { verifyToken } });
      state.recentVerifyTokens.set(channelId, verifyToken);
      $("webhookTokenDialog").close();
      await loadAll();
      setRoute("channels");
      showToast("Verify token saved", "Copy the new token beside the callback URL, then update Meta.");
    } catch (error) {
      showToast("Verify token was not saved", error.message, true);
    } finally {
      submit.disabled = false;
      submit.textContent = "Save token";
    }
  }

  function openChannelDialog(channelId = "") {
    const form = $("channelForm");
    const channel = state.channels.find((item) => item.channelId === channelId) || null;
    form.reset();
    form.querySelectorAll(".secret-field").forEach((input) => {
      input.value = "";
      input.type = "password";
      input.classList.remove("is-saved");
      delete input.dataset.savedCredential;
    });
    $("channelIdInput").value = channel?.channelId || "";
    $("channelMetaVerifyToken").value = channel ? "" : generatePrivateToken();
    $("channelProvider").value = channel?.connectorType || "whatsapp_cloud";
    $("channelProvider").disabled = Boolean(channel);
    $("channelNameInput").value = channel?.name || "";
    $("channelEnabledInput").checked = channel?.enabled !== false;
    form.elements.wabaId.value = channel?.config?.wabaId || "";
    form.elements.phoneNumberId.value = channel?.config?.phoneNumberId || "";
    form.elements.instagramAccountId.value = channel?.config?.instagramAccountId || "";
    form.elements.instagramAppId.value = channel?.config?.appId || "";
    form.elements.instagramUsername.value = channel?.config?.username || "";
    $("channelDialogTitle").textContent = channel ? `Edit ${channel.name}` : "Add a channel";
    $("channelSubmit").textContent = channel ? "Save changes" : "Save connection";
    syncChannelForm(channel?.connectorType || "whatsapp_cloud", Boolean(channel), channel?.setup || {});
    $("channelDialog").showModal();
  }

  function syncChannelForm(provider, editing = Boolean($("channelIdInput").value), setup = {}) {
    const credentialKeys = {
      whatsappAccessToken: "accessToken", whatsappAppSecret: "appSecret",
      telegramBotToken: "botToken", telegramWebhookSecret: "webhookSecret",
      instagramAccessToken: "accessToken", instagramAppSecret: "appSecret",
    };
    document.querySelectorAll("[data-provider-fields]").forEach((section) => {
      const active = section.dataset.providerFields === provider;
      section.hidden = !active;
      section.querySelectorAll("input,select,textarea").forEach((input) => {
        input.disabled = !active;
        if (input.classList.contains("secret-field")) {
          if (!Object.prototype.hasOwnProperty.call(input.dataset, "defaultPlaceholder")) {
            input.dataset.defaultPlaceholder = input.placeholder;
          }
          const key = credentialKeys[input.name];
          const hasFieldState = key && setup.credentialFields && Object.prototype.hasOwnProperty.call(setup.credentialFields, key);
          const saved = Boolean(editing && (hasFieldState ? setup.credentialFields[key] : setup.credentialsPresent));
          const showingSaved = Boolean(active && saved && (!input.value || input.value === SAVED_SECRET_MASK));
          input.required = active && !saved;
          input.placeholder = input.dataset.defaultPlaceholder;
          input.classList.toggle("is-saved", showingSaved);
          if (showingSaved) {
            input.value = SAVED_SECRET_MASK;
            input.dataset.savedCredential = "true";
            input.setAttribute("aria-label", `${input.name} is saved securely. Focus this field to replace it.`);
          } else if (!saved) {
            delete input.dataset.savedCredential;
            input.removeAttribute("aria-label");
          }
        }
      });
    });
    if (!editing && !$("channelNameInput").value.trim()) {
      $("channelNameInput").value = `${providerProfiles[provider]?.label || "Channel"} connection`;
    }
  }

  function generatePrivateToken() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  function channelPayload(form) {
    const values = new FormData(form);
    const credentialValue = (name) => {
      const value = String(values.get(name) || "").trim();
      return value === SAVED_SECRET_MASK ? "" : value;
    };
    const connectorType = form.elements.connectorType.value;
    const config = connectorType === "whatsapp_cloud"
      ? { wabaId: String(values.get("wabaId") || "").trim(), phoneNumberId: String(values.get("phoneNumberId") || "").trim(), apiVersion: "v26.0" }
      : connectorType === "instagram"
        ? { instagramAccountId: String(values.get("instagramAccountId") || "").trim(), appId: String(values.get("instagramAppId") || "").trim(), username: String(values.get("instagramUsername") || "").trim(), authMode: "instagram_login", apiVersion: "v26.0" }
        : {};
    const credentialMap = connectorType === "whatsapp_cloud"
      ? { accessToken: credentialValue("whatsappAccessToken"), appSecret: credentialValue("whatsappAppSecret"), verifyToken: credentialValue("metaVerifyToken") }
      : connectorType === "telegram"
        ? { botToken: credentialValue("telegramBotToken"), webhookSecret: credentialValue("telegramWebhookSecret") }
        : { accessToken: credentialValue("instagramAccessToken"), appSecret: credentialValue("instagramAppSecret"), verifyToken: credentialValue("metaVerifyToken") };
    const credentials = Object.fromEntries(Object.entries(credentialMap)
      .map(([key, value]) => [key, String(value || "").trim()])
      .filter(([, value]) => value));
    return {
      name: String(values.get("name") || "").trim(),
      connectorType,
      enabled: form.elements.enabled.checked,
      config,
      credentials,
    };
  }

  async function saveChannel(form) {
    const channelId = $("channelIdInput").value;
    const payload = channelPayload(form);
    const submit = $("channelSubmit");
    let savedChannelId = channelId;
    submit.disabled = true;
    submit.textContent = "Saving…";
    try {
      const result = await (channelId ? state.api.updateChannel(channelId, payload) : state.api.createChannel(payload));
      savedChannelId = channelId || String(result.channelId || "");
      if (!savedChannelId) throw new Error("The connection was saved, but its channel ID was not returned.");
      const newVerifyToken = ["whatsapp_cloud", "instagram"].includes(payload.connectorType)
        ? String(payload.credentials?.verifyToken || "") : "";
      if (newVerifyToken) {
        state.recentVerifyTokens.set(savedChannelId, newVerifyToken);
        $("channelMetaVerifyToken").value = "";
      }
      if (!channelId) {
        $("channelIdInput").value = savedChannelId;
        $("channelProvider").disabled = true;
        $("channelDialogTitle").textContent = `Edit ${payload.name}`;
      }
      $("channelDialog").close();
      await loadAll();
      setRoute("channels");
      if (!payload.enabled) showToast(channelId ? "Connection updated" : "Connection added", `${payload.name} is saved but disabled.`);
      else showToast("Connection saved", `${payload.name} was saved without running provider verification. Use Verify connection whenever you are ready.`);
    } catch (error) {
      showToast("Connection was not saved", error.message, true);
    } finally {
      submit.disabled = false;
      submit.textContent = savedChannelId ? "Save changes" : "Save connection";
    }
  }

  async function toggleChannel(channelId, button) {
    const channel = state.channels.find((item) => item.channelId === channelId);
    if (!channel || !button) return;
    button.disabled = true;
    try {
      await state.api.updateChannel(channelId, { enabled: !channel.enabled });
      await loadAll();
      setRoute("channels");
      showToast(channel.enabled ? "Connection disabled" : "Connection enabled", channel.name);
    } catch (error) {
      showToast("Connection was not updated", error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  function populateContactChannelSelect(selectedId = "") {
    const select = $("contactChannelId");
    if (!select) return;
    const previous = selectedId || select.value;
    const available = state.channels.filter((channel) => providerProfiles[channel.connectorType] && channel.enabled && channel.health === "connected");
    select.replaceChildren();
    available.forEach((channel) => {
      const option = document.createElement("option");
      option.value = channel.channelId;
      option.textContent = `${channel.name} · ${providerProfiles[channel.connectorType].label}`;
      select.append(option);
    });
    if (available.some((channel) => channel.channelId === previous)) select.value = previous;
    updateContactIdentityField();
  }

  function updateContactIdentityField() {
    const channel = channelFor($("contactChannelId")?.value);
    const profile = providerProfiles[channel.connectorType] || { noun: "Customer identifier", placeholder: "Customer identifier", help: "Enter the provider-specific customer identifier." };
    $("contactIdentityLabel").textContent = profile.noun;
    $("contactChannelProfileId").placeholder = profile.placeholder;
    $("contactChannelProfileId").inputMode = channel.connectorType === "whatsapp_cloud" ? "tel" : "text";
    $("contactIdentityHelp").textContent = profile.help;
  }

  function openContactDialog() {
    const available = state.channels.filter((channel) => providerProfiles[channel.connectorType] && channel.enabled && channel.health === "connected");
    if (!available.length) {
      setRoute(canAdmin() ? "channels" : "inbox");
      showToast("Connect a channel first", "An enabled messaging channel is required before creating a conversation.", true);
      return;
    }
    $("contactForm").reset();
    populateContactChannelSelect(available[0].channelId);
    $("contactDialog").showModal();
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

  async function verifyChannelConnection(channelId, button) {
    if (!channelId || !button) return;
    const channel = state.channels.find((item) => item.channelId === channelId);
    const label = providerProfiles[channel?.connectorType]?.label || "Channel";
    button.disabled = true;
    const previousLabel = button.textContent;
    button.textContent = "Checking…";
    try {
      const result = await state.api.verifyChannel(channelId);
      await loadAll();
      setRoute("channels");
      showToast(result.health === "connected" ? `${label} is live` : `${label} credentials verified`,
        result.health === "connected" ? "The provider identity and webhook are working." : "Complete the provider webhook setup to go live.");
    } catch (error) {
      showToast(`${label} connection failed`, error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = previousLabel;
    }
  }

  function showToast(title, message = "", isError = false) {
    const region = $("toastRegion");
    const openDialog = document.querySelector("dialog[open]");
    const modalCard = openDialog?.querySelector(".modal-card");
    if (modalCard) {
      region.classList.add("is-modal-toast");
      modalCard.prepend(region);
    } else {
      region.classList.remove("is-modal-toast");
      document.body.append(region);
    }
    const toast = element("div", `toast${isError ? " is-error" : ""}`);
    toast.setAttribute("role", isError ? "alert" : "status");
    const copy = document.createElement("div");
    copy.append(element("strong", "", title));
    if (message) copy.append(element("span", "", message));
    toast.append(copy);
    region.append(toast);
    setTimeout(() => toast.remove(), isError ? 12000 : 4500);
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

  function clearSelectedConversation() {
    state.selectedConversationId = null;
    state.detailsOpen = false;
    $("inboxGrid").classList.remove("chat-open", "has-details");
    renderConversationList();
    renderSelectedConversation();
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

  function providerLogo(connectorType, className = "provider-logo") {
    const style = channelStyles[connectorType] || channelStyles.generic;
    const path = providerLogoPaths[connectorType];
    if (!path) {
      const fallback = element("span", `${className} provider-logo-fallback`, style.short);
      fallback.setAttribute("aria-hidden", "true");
      return fallback;
    }
    const image = document.createElement("img");
    image.className = className;
    image.src = path;
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    return image;
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
        if (actionButton.dataset.revokeApiKey) {
          revokeDeveloperApiKey(actionButton.dataset.revokeApiKey, actionButton);
          return;
        }
        if (actionButton.dataset.action === "verify-channel") {
          verifyChannelConnection(actionButton.dataset.channelId, actionButton);
          return;
        }
        if (actionButton.dataset.action === "edit-channel") {
          openChannelDialog(actionButton.dataset.channelId);
          return;
        }
        if (actionButton.dataset.action === "toggle-channel") {
          toggleChannel(actionButton.dataset.channelId, actionButton);
          return;
        }
        if (actionButton.dataset.action === "toggle-channel-details") {
          const channelId = actionButton.dataset.channelId;
          if (state.expandedChannelIds.has(channelId)) state.expandedChannelIds.delete(channelId);
          else state.expandedChannelIds.add(channelId);
          renderChannels();
          document.querySelector(`[data-action="toggle-channel-details"][data-channel-id="${CSS.escape(channelId)}"]`)?.focus();
          return;
        }
        if (actionButton.dataset.action === "copy-webhook-callback") {
          copyWebhookCallback(actionButton);
          return;
        }
        if (actionButton.dataset.action === "copy-webhook-token") {
          copyWebhookVerifyToken(actionButton);
          return;
        }
        if (actionButton.dataset.action === "edit-webhook-token") {
          openWebhookTokenDialog(actionButton.dataset.channelId);
          return;
        }
        const actions = {
          "toggle-user-menu": () => toggleUserMenu(),
          "logout": logout,
          "toggle-details": toggleDetails,
          "open-channel": () => openChannelDialog(),
          "close-channel-dialog": () => $("channelDialog").close(),
          "close-webhook-token": () => $("webhookTokenDialog").close(),
          "generate-webhook-token": () => {
            const input = $("webhookTokenInput");
            input.value = generatePrivateToken();
            input.focus();
          },
          "new-conversation": openContactDialog,
          "new-contact": openContactDialog,
          "close-contact-dialog": () => $("contactDialog").close(),
          "close-contact-editor": closeContactEditor,
          "cancel-contact-edit": () => {
            const contact = state.contacts.find((item) => item.contactId === state.selectedContactId);
            if (contact) showContactEditor(contact);
            else closeContactEditor();
          },
          "choose-attachment": () => $("attachmentInput").click(),
          "open-template": openTemplateDialog,
          "close-template": () => $("templateDialog").close(),
          "reload-templates": () => state.templateConversationId && loadConversationTemplates(state.templateConversationId, { refresh: true }),
          "insert-greeting": () => {
            const input = $("messageInput");
            const name = selectedConversation()?.subject?.split(" ")[0] || "there";
            input.value = `Hi ${name}, `;
            resizeComposer();
            input.focus();
          },
          "open-invite": openInviteDialog,
          "close-invite": () => $("inviteDialog").close(),
          "copy-invite-link": copyInviteLink,
          "open-api-key": openApiKeyDialog,
          "close-api-key": closeApiKeyDialog,
          "copy-api-base": () => copyDeveloperApiValue($("developerApiBase").textContent, "API base URL copied"),
          "copy-api-key": () => copyDeveloperApiValue($("apiKeyOutput").value, "API key copied"),
        };
        actions[actionButton.dataset.action]?.();
      }
      const generateButton = event.target.closest("[data-generate-secret]");
      if (generateButton) {
        const input = $("channelForm").elements[generateButton.dataset.generateSecret];
        if (input) {
          input.value = generatePrivateToken();
          input.dispatchEvent(new Event("input", { bubbles: true }));
          showToast("Private token generated", "It is masked in the form and will be stored securely when you save.");
        }
      }
      const copySecretButton = event.target.closest("[data-copy-secret]");
      if (copySecretButton) {
        const input = $("channelForm").elements[copySecretButton.dataset.copySecret];
        if (!input?.value) {
          showToast("Generate or enter a token first", "The token field is currently empty.", true);
        } else {
          Promise.resolve().then(() => navigator.clipboard.writeText(input.value))
            .then(() => showToast("Verify token copied", "Paste it into Meta's webhook setup before saving."))
            .catch(() => showToast("Copy was blocked", "Select the token and copy it manually.", true));
        }
      }
      if (!event.target.closest(".user-menu-wrap")) toggleUserMenu(false);
    });

    document.addEventListener("focusin", (event) => {
      const input = event.target.closest?.(".secret-field[data-saved-credential='true']");
      if (!input || input.value !== SAVED_SECRET_MASK) return;
      input.value = "";
      input.classList.remove("is-saved");
      input.placeholder = "Paste a replacement value";
    });

    document.addEventListener("focusout", (event) => {
      const input = event.target.closest?.(".secret-field[data-saved-credential='true']");
      if (!input || input.value) return;
      input.value = SAVED_SECRET_MASK;
      input.classList.add("is-saved");
      input.placeholder = input.dataset.defaultPlaceholder || "";
    });

    $("conversationList").addEventListener("click", (event) => {
      const item = event.target.closest("[data-conversation-id]");
      if (item) selectConversation(item.dataset.conversationId);
    });

    $("contactTableBody").addEventListener("click", (event) => {
      const row = event.target.closest("[data-contact-id]");
      if (row) selectContact(row.dataset.contactId);
    });
    $("contactTableBody").addEventListener("keydown", (event) => {
      if (!['Enter', ' '].includes(event.key)) return;
      const row = event.target.closest("[data-contact-id]");
      if (!row) return;
      event.preventDefault();
      selectContact(row.dataset.contactId);
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
    $("attachmentInput").addEventListener("change", (event) => uploadCurrentAttachment(event.target.files?.[0]));
    $("pushNotificationsToggle").addEventListener("change", (event) => setBrowserNotifications(event.target.checked));

    $("conversationStatus").addEventListener("change", async (event) => {
      const conversation = selectedConversation();
      if (!conversation) return;
      const previous = conversation.status;
      const next = event.target.value;
      event.target.disabled = true;
      try {
        await state.api.updateConversation(conversation.conversationId, { status: next });
        conversation.status = next;
        renderCounts();
        if (["pending", "closed"].includes(next)) clearSelectedConversation();
        else renderConversationList();
      } catch (error) {
        event.target.value = previous;
        showToast("Status was not updated", error.message, true);
      } finally {
        event.target.disabled = false;
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

    $("channelForm").addEventListener("submit", (event) => { event.preventDefault(); saveChannel(event.currentTarget); });
    $("webhookTokenForm").addEventListener("submit", (event) => { event.preventDefault(); saveWebhookVerifyToken(event.currentTarget); });
    $("channelProvider").addEventListener("change", (event) => {
      const nameInput = $("channelNameInput");
      if (!nameInput.value.trim() || /^(WhatsApp|Telegram|Instagram) connection$/.test(nameInput.value.trim())) {
        nameInput.value = `${providerProfiles[event.target.value]?.label || "Channel"} connection`;
      }
      syncChannelForm(event.target.value, false, {});
    });
    $("contactChannelId").addEventListener("change", updateContactIdentityField);
    $("contactForm").addEventListener("submit", (event) => { event.preventDefault(); createContact(event.currentTarget); });
    $("contactEditForm").addEventListener("submit", (event) => { event.preventDefault(); saveContactEdits(event.currentTarget); });
    $("templateSelect").addEventListener("change", renderTemplateVariables);
    $("templateVariableFields").addEventListener("change", (event) => {
      const row = event.target.closest(".template-variable-row");
      if (row) syncTemplateVariableSource(row);
    });
    $("templateVariableFields").addEventListener("input", (event) => {
      const row = event.target.closest(".template-variable-row");
      if (row) syncTemplateVariableSource(row);
    });
    $("templateForm").addEventListener("submit", (event) => { event.preventDefault(); sendCurrentTemplate(event.currentTarget); });
    $("inviteForm").addEventListener("submit", (event) => { event.preventDefault(); inviteMember(event.currentTarget); });
    $("apiKeyForm").addEventListener("submit", (event) => { event.preventDefault(); createDeveloperApiKey(event.currentTarget); });
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
    ensureServiceWorkerRegistration().catch(() => {});
    await initializeSession();
  }

  init();
})();
