(() => {
  "use strict";

  const RECOVERY_TOKEN_KEY = "helixcer_recovery_token";
  const NOTIFICATION_PREFERENCE_KEY = "helixcer_browser_notifications";
  const PUSH_DEVICE_KEY = "helixcer_push_device_id";
  const SERVICE_WORKER_URL = "/sw.js?v=20261026-15";
  const DEFAULT_WORKSPACE = "Helixcer workspace";
  const SAVED_SECRET_MASK = "••••••••••••••••";
  const WHATSAPP_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

  const $ = (id) => document.getElementById(id);
  const state = {
    route: "inbox",
    filters: new Set(["open"]),
    search: "",
    contactSearch: "",
    channels: [],
    contacts: [],
    conversations: [],
    messages: new Map(),
    pendingAttachments: new Map(),
    templatesByConversation: new Map(),
    templateConversationId: null,
    whatsappTemplates: [],
    whatsappTemplateErrors: [],
    whatsappTemplateTruncatedChannels: [],
    whatsappTemplateFilterOptions: {},
    whatsappTemplatesLoaded: false,
    whatsappTemplatesLoading: false,
    whatsappTemplatesError: "",
    whatsappTemplateSearch: "",
    whatsappTemplateFilters: {
      channel: new Set(), category: new Set(), status: new Set(), language: new Set(),
    },
    importChat: {
      source: "interakt",
      fileName: "",
      conversations: [],
      conversationCount: 0,
      messageCount: 0,
      availableFields: [],
      sourceAssignments: {},
      fieldMapping: { name: "", phone: "", company: "", tags: "" },
      importing: false,
      abortController: null,
      lastSummary: null,
    },
    pendingConversationId: null,
    unreadMarker: null,
    newMessagesBelow: { conversationId: "", count: 0 },
    replyingTo: null,
    composerRoutes: new Map(),
    recentVerifyTokens: new Map(),
    selectedConversationId: null,
    selectedContactId: null,
    contactCreateIdentityDrafts: [],
    contactEditIdentityDrafts: [],
    contactRouteMenu: null,
    contactPlatformMenu: null,
    messageStatusMenu: null,
    expandedChannelIds: new Set(),
    detailsOpen: false,
    currentUser: null,
    workspace: { name: DEFAULT_WORKSPACE, workspaceId: "default", slug: "helixcer" },
    workspaceProfile: null,
    workspaceProfileLoaded: false,
    workspaceProfileLoading: false,
    team: { members: [], invitations: [] },
    apiKeys: [],
    authStatus: "checking",
    api: null,
    disconnectRealtime: null,
    realtimeConnectedOnce: false,
    realtimeRevision: 0,
    conversationRevisions: new Map(),
    reconcilePromise: null,
    notificationsEnabled: localStorage.getItem(NOTIFICATION_PREFERENCE_KEY) === "true",
    serviceWorkerRegistration: null,
    pushConfig: null,
    pushSubscriptionReady: false,
    pushSyncPromise: null,
    pushActionPending: false,
    lastNotificationAt: new Map(),
    confirmationResolve: null,
    loading: true,
  };
  let whatsappReplyCountdownTimer = null;
  let whatsappReplyCountdownKey = "";

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
    facebook: { label: "Facebook", short: "FB", color: "#2768b2", soft: "#eaf2fb" },
    facebook_messenger: { label: "Facebook", short: "FB", color: "#2768b2", soft: "#eaf2fb" },
    messenger: { label: "Facebook", short: "FB", color: "#2768b2", soft: "#eaf2fb" },
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

  const identityPlatforms = {
    whatsapp: { label: "WhatsApp", profileLabel: "WhatsApp ID", profilePlaceholder: "Phone number or WhatsApp username" },
    telegram: { label: "Telegram", profileLabel: "Telegram ID", profilePlaceholder: "Telegram profile ID or username" },
    instagram: { label: "Instagram", profileLabel: "Instagram ID", profilePlaceholder: "Instagram profile ID or username" },
    facebook: { label: "Facebook", profileLabel: "Facebook ID", profilePlaceholder: "Facebook profile ID or username" },
    email: { label: "Email", profileLabel: "Email Address", profilePlaceholder: "name@example.com" },
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
    const workspaceProfile = {
      workspaceId: "e29d8006-c4de-4cbe-9b17-ec550ba9c6f9", displayName: "Helixcer workspace", registeredName: "Helixcer Technologies",
      addressLine1: "", addressLine2: "", city: "", state: "", postalCode: "", country: "India",
      gstin: "", taxDetails: "",
    };
    return {
      appName: "Helixcer Chat",
      me: {
        authenticated: true,
        user: { userId: "demo-owner", email: "owner@helixcer.example", displayName: "Nisar", avatarUrl: "" },
        workspace: { ...workspaceProfile, name: workspaceProfile.displayName, slug: "helixcer" },
        membership: { membershipId: "demo-membership-owner", role: "owner", status: "active" },
      },
      workspaceProfile,
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
        { channelId: "wa-service", name: "Service WhatsApp", connectorType: "whatsapp_cloud", enabled: true, health: "connected", config: { wabaId: "123456789012347", phoneNumberId: "123456789012348" }, setup: { credentialsPresent: true, credentialsVerifiedAt: ago(95), webhookVerifiedAt: ago(94), lastWebhookAt: ago(11), verifiedName: "Helixcer Service", verifiedPhoneNumber: "+91 91234 56780" } },
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
          { messageId: "msg-a1", channelMessageId: "wa-demo-a1", direction: "inbound", text: "Hi! I placed an order yesterday and wanted to check the delivery date.", timestamp: ago(31), status: "received", senderName: "Ananya" },
          { messageId: "msg-a2", channelMessageId: "wa-demo-a2", direction: "outbound", text: "Hello Ananya — happy to help. Could you share the last four digits of your order number?", timestamp: ago(27), status: "delivered", senderName: "Nisar" },
          { messageId: "msg-a3", channelMessageId: "wa-demo-a3", direction: "inbound", text: "It ends in 4821.", timestamp: ago(7), status: "received", senderName: "Ananya" },
          { messageId: "msg-a4", channelMessageId: "wa-demo-a4", direction: "inbound", text: "Could you confirm when my order will arrive?", timestamp: ago(3), status: "received", senderName: "Ananya", reply: { messageId: "msg-a2", channelMessageId: "wa-demo-a2", direction: "outbound", text: "Hello Ananya — happy to help. Could you share the last four digits of your order number?", messageType: "text" } },
        ],
        "cv-david": [
          { messageId: "msg-d1", channelMessageId: "101", direction: "inbound", text: "Hello, I found you through your website.", timestamp: ago(24), status: "received", senderName: "David" },
          { messageId: "msg-d2", channelMessageId: "102", direction: "inbound", text: "I need help choosing the right plan.", timestamp: ago(18), status: "received", senderName: "David" },
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

    async getWorkspace() {
      await smallDelay(100);
      return { item: clone(this.data.workspaceProfile) };
    }

    async updateWorkspace(payload) {
      await smallDelay(140);
      this.data.workspaceProfile = { ...this.data.workspaceProfile, ...payload };
      this.data.me.workspace = {
        ...this.data.me.workspace,
        ...this.data.workspaceProfile,
        name: this.data.workspaceProfile.displayName,
      };
      return { ok: true, item: clone(this.data.workspaceProfile) };
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

    async deleteApiKey(apiKeyId) {
      await smallDelay(100);
      const index = this.data.apiKeys.findIndex((entry) => entry.apiKeyId === apiKeyId);
      if (index < 0) throw new Error("API key not found.");
      const [item] = this.data.apiKeys.splice(index, 1);
      return { ok: true, deleted: true, item: clone(item) };
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
        allowedChannelIds: payload.role === "agent" ? asItems(payload.allowedChannelIds).map(String) : [],
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

    async deleteMember(membershipId) {
      await smallDelay(100);
      const index = this.data.team.members.findIndex((member) => member.membershipId === membershipId);
      if (index < 0) throw new Error("Member not found");
      const member = this.data.team.members[index];
      if (member.membershipId === this.data.me.membership.membershipId) throw new Error("You cannot delete your own workspace membership.");
      const ownerCount = this.data.team.members.filter((item) => item.role === "owner" && item.status === "active").length;
      if (member.role === "owner" && ownerCount <= 1) throw new Error("The workspace must keep at least one active owner.");
      this.data.team.members.splice(index, 1);
      return { ok: true, deleted: true, item: clone(member) };
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

    async sendMessage(conversationId, text, replyToMessageId = "", route = {}) {
      const replyTarget = (this.data.messages[conversationId] || []).find((message) => message.messageId === replyToMessageId);
      const senderName = String(this.data.me?.displayName || this.data.me?.email || "You").trim() || "You";
      const item = {
        messageId: `demo-${Date.now()}`,
        channelMessageId: `demo-channel-${Date.now()}`,
        direction: "outbound",
        messageType: "text",
        text,
        timestamp: new Date().toISOString(),
        status: "sent",
        senderName,
        channelId: String(route.channelId || ""),
        identityId: String(route.identityId || ""),
        connectorType: String(route.connectorType || ""),
        channelName: String(route.channelName || ""),
        channelProfileId: String(route.channelProfileId || ""),
        reply: replyTarget ? {
          messageId: replyTarget.messageId,
          channelMessageId: replyTarget.channelMessageId || "",
          direction: replyTarget.direction,
          text: replyTarget.text || "",
          messageType: replyTarget.messageType || "text",
          ...(replyTarget.attachment ? { attachment: { type: replyTarget.attachment.type, filename: replyTarget.attachment.filename || "" } } : {}),
        } : null,
      };
      this.data.messages[conversationId] ||= [];
      this.data.messages[conversationId].push(item);
      const conversation = this.data.conversations.find((entry) => entry.conversationId === conversationId);
      if (conversation) {
        conversation.lastMessage = text;
        conversation.lastMessageType = item.messageType;
        conversation.lastMessageAt = item.timestamp;
      }
      await smallDelay(160);
      return { ok: true, item: clone(item) };
    }

    async sendTemplate(conversationId, payload, route = {}) {
      const templateName = payload?.name || "template";
      const response = await this.sendMessage(conversationId, payload.previewText || `[Template: ${templateName}]`, "", route);
      response.item.messageType = "template";
      const stored = (this.data.messages[conversationId] || []).find((message) => message.messageId === response.item.messageId);
      if (stored) stored.messageType = "template";
      const conversation = this.data.conversations.find((entry) => entry.conversationId === conversationId);
      if (conversation) conversation.lastMessageType = "template";
      return response;
    }

    async uploadTemplateMedia(_conversationId, formData) {
      const file = formData.get("file");
      await smallDelay(120);
      return { ok: true, mediaId: `demo-media-${Date.now()}`, filename: file?.name || "media" };
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
          { type: "BODY", text: "Welcome *{{1}}*. We are happy to help." },
          { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Continue" }] },
        ] },
      ]) };
    }

    async getWhatsAppTemplates() {
      await smallDelay(180);
      const items = [
        { channelId: "wa-sales", channelName: "Sales WhatsApp", providerDisplayName: "Helixcer Sales", templateId: "demo-order", name: "order_confirmation", language: { code: "en_US" }, status: "APPROVED", category: "UTILITY", components: [
          { type: "HEADER", format: "IMAGE" },
          { type: "BODY", text: "Hi {{customer_name}}, your order {{2}} is confirmed and will be prepared shortly." },
          { type: "FOOTER", text: "Thank you for shopping with Helixcer." },
          { type: "BUTTONS", buttons: [{ type: "URL", text: "View order", url: "https://example.com/orders/{{1}}" }] },
        ] },
        { channelId: "wa-sales", channelName: "Sales WhatsApp", providerDisplayName: "Helixcer Sales", templateId: "demo-welcome", name: "welcome_message", language: { code: "en_US" }, status: "APPROVED", category: "MARKETING", components: [
          { type: "BODY", text: "Welcome {{1}}. Explore our latest collection and let us know if you need any help." },
          { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Show products" }, { type: "QUICK_REPLY", text: "Talk to support" }] },
        ] },
        { channelId: "wa-sales", channelName: "Sales WhatsApp", providerDisplayName: "Helixcer Sales", templateId: "demo-login", name: "login_code", language: { code: "en" }, status: "APPROVED", category: "AUTHENTICATION", components: [
          { type: "BODY", text: "{{1}} is your verification code. For your security, do not share this code." },
          { type: "FOOTER", text: "This code expires in 10 minutes." },
          { type: "BUTTONS", buttons: [{ type: "OTP", text: "Copy code" }] },
        ] },
        { channelId: "wa-service", channelName: "Service WhatsApp", providerDisplayName: "Helixcer Service", templateId: "demo-delivery", name: "delivery_update", language: { code: "en_GB" }, status: "PENDING", category: "UTILITY", components: [
          { type: "HEADER", format: "TEXT", text: "Delivery update" },
          { type: "BODY", text: "Hello {{1}}, shipment {{2}} is now {{3}}. Track it using the button below." },
          { type: "BUTTONS", buttons: [{ type: "URL", text: "Track shipment", url: "https://example.com/track/{{1}}" }] },
        ] },
        { channelId: "wa-service", channelName: "Service WhatsApp", providerDisplayName: "Helixcer Service", templateId: "demo-feedback", name: "service_feedback", language: { code: "ml" }, status: "PAUSED", category: "MARKETING", components: [
          { type: "BODY", text: "Thank you for contacting us. Please rate your support experience." },
          { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Excellent" }, { type: "QUICK_REPLY", text: "Needs improvement" }] },
        ] },
      ];
      return {
        items: clone(items), errors: [], truncatedChannels: [],
        filterOptions: {
          channels: [{ value: "wa-sales", label: "Sales WhatsApp" }, { value: "wa-service", label: "Service WhatsApp" }],
          categories: ["AUTHENTICATION", "MARKETING", "UTILITY"], statuses: ["APPROVED", "PAUSED", "PENDING"], languages: ["en", "en_GB", "en_US", "ml"],
        },
      };
    }

    async importChat(payload, { signal } = {}) {
      if (signal?.aborted) {
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        throw error;
      }
      await smallDelay(120);
      if (signal?.aborted) {
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        throw error;
      }
      const conversations = Array.isArray(payload?.conversations) ? payload.conversations : [];
      return {
        ok: true,
        source: payload?.source || "interakt",
        channelId: payload?.channelId || "",
        contactsCreated: conversations.length,
        contactsReused: 0,
        conversationsCreated: conversations.length,
        conversationsReused: 0,
        messagesImported: conversations.reduce((total, item) => total + (item.messages?.length || 0), 0),
        messagesUpdated: 0,
        messagesSkipped: 0,
        failed: [],
      };
    }

    async sendAttachment(conversationId, formData) {
      const file = formData.get("file");
      const caption = String(formData.get("caption") || "").trim();
      const replyToMessageId = String(formData.get("replyToMessageId") || "");
      const conversation = this.data.conversations.find((entry) => entry.conversationId === conversationId) || {};
      const route = {
        channelId: String(formData.get("channelId") || conversation.channelId || ""),
        identityId: String(formData.get("identityId") || conversation.contactIdentityId || ""),
        connectorType: conversation.connectorType || "",
        channelName: conversation.channelName || "",
        channelProfileId: conversation.channelProfileId || "",
      };
      const result = await this.sendMessage(conversationId, caption || `[Attachment: ${file?.name || "file"}]`, replyToMessageId, route);
      result.item.messageType = file?.type?.startsWith("image/") ? "image"
        : file?.type?.startsWith("video/") ? "video" : file?.type?.startsWith("audio/") ? "audio" : "document";
      result.item.attachment = {
        type: result.item.messageType, filename: file?.name || "file", mimeType: file?.type || "",
        size: Number(file?.size || 0), caption, available: false, url: ""
      };
      const stored = (this.data.messages[conversationId] || []).find((message) => message.messageId === result.item.messageId);
      if (stored) Object.assign(stored, { messageType: result.item.messageType, attachment: result.item.attachment });
      if (conversation) conversation.lastMessageType = result.item.messageType;
      return result;
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

    async deleteConversation(conversationId) {
      await smallDelay(100);
      const index = this.data.conversations.findIndex((entry) => entry.conversationId === conversationId);
      if (index < 0) throw new Error("Conversation not found");
      const [item] = this.data.conversations.splice(index, 1);
      delete this.data.messages[conversationId];
      return { ok: true, deleted: true, item: clone(item) };
    }

    async createContact(payload) {
      const suffix = Date.now().toString(36);
      const flatIdentities = Object.entries(payload.platformIds || {}).filter(([, profileId]) => String(profileId || "").trim())
        .map(([platform, profileId], index) => ({
          identityId: `identity-${suffix}-${index + 1}`,
          platform,
          profileId: String(profileId).trim(),
          channelProfileId: String(profileId).trim(),
          phoneNumber: platform === "whatsapp" ? String(profileId).trim() : "",
          email: platform === "email" ? String(profileId).trim() : "",
          isPrimary: index === 0,
          bindings: [],
        }));
      const identities = Array.isArray(payload.identities) ? clone(payload.identities).map((identity, index) => ({
        ...identity,
        identityId: String(identity.identityId || `identity-${suffix}-${index + 1}`),
      })) : flatIdentities.length ? flatIdentities : payload.channelId || payload.channelProfileId ? [{
        identityId: `identity-${suffix}-1`,
        platform: connectorPlatform(channelFor(payload.channelId).connectorType),
        profileId: payload.channelProfileId || "",
        channelProfileId: payload.channelProfileId || "",
        channelId: payload.channelId || "",
        bindings: payload.channelId ? [{ channelId: payload.channelId }] : [],
        isPrimary: true,
      }] : [];
      const contact = {
        contactId: `ct-${suffix}`,
        displayName: payload.displayName,
        company: payload.company || "",
        tags: Array.isArray(payload.tags) && payload.tags.length ? payload.tags : ["New"],
        platformIds: clone(payload.platformIds || {}),
        identities,
      };
      this.data.contacts.unshift(contact);
      this.emit({ type: "contact.updated", contactId: contact.contactId, item: clone(contact) });
      return { ok: true, contactId: contact.contactId, item: clone(contact) };
    }

    async getContact(contactId) {
      await smallDelay(90);
      const item = this.data.contacts.find((contact) => contact.contactId === contactId);
      if (!item) throw new Error("Contact not found.");
      return { item: clone(item) };
    }

    async updateContact(contactId, patch) {
      await smallDelay(110);
      const item = this.data.contacts.find((contact) => contact.contactId === contactId);
      if (!item) throw new Error("Contact not found.");
      ["displayName", "company"].forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(patch, key)) item[key] = patch[key];
      });
      if (Array.isArray(patch.tags)) item.tags = clone(patch.tags);
      if (patch.platformIds && typeof patch.platformIds === "object") {
        item.platformIds = clone(patch.platformIds);
        const existingByPlatform = new Map(normalizeContact(item).identities.map((identity) => [identity.platform, identity]));
        item.identities = Object.entries(patch.platformIds).filter(([, profileId]) => String(profileId || "").trim())
          .map(([platform, profileId], index) => {
            const existing = existingByPlatform.get(platform) || {};
            const value = String(profileId).trim();
            return {
              ...clone(existing),
              identityId: String(existing.identityId || `identity-${Date.now().toString(36)}-${index + 1}`),
              platform,
              profileId: value,
              channelProfileId: value,
              phoneNumber: platform === "whatsapp" ? value : "",
              email: platform === "email" ? value : "",
              isPrimary: existing.isPrimary === true || (!existingByPlatform.size && index === 0),
            };
          });
        if (item.identities.length && !item.identities.some((identity) => identity.isPrimary)) item.identities[0].isPrimary = true;
      }
      if (Array.isArray(patch.identities)) {
        item.identities = patch.identities.map((identity, index) => ({
          ...clone(identity),
          identityId: String(identity.identityId || `identity-${Date.now().toString(36)}-${index + 1}`),
        }));
      }
      this.data.conversations.filter((conversation) => conversation.contactId === contactId).forEach((conversation) => {
        conversation.subject = item.displayName;
      });
      return { ok: true, item: clone(item) };
    }

    async createContactIdentity(contactId, payload) {
      await smallDelay(90);
      const item = this.data.contacts.find((contact) => contact.contactId === contactId);
      if (!item) throw new Error("Contact not found.");
      if (!Array.isArray(item.identities)) item.identities = normalizeContact(item).identities.map(identityRequestPayload);
      const identity = { ...clone(payload), identityId: `identity-${Date.now().toString(36)}` };
      item.identities.push(identity);
      return { ok: true, item: clone(identity), contact: clone(item) };
    }

    async updateContactIdentity(contactId, identityId, payload) {
      await smallDelay(90);
      const item = this.data.contacts.find((contact) => contact.contactId === contactId);
      if (!item) throw new Error("Contact not found.");
      if (!Array.isArray(item.identities)) item.identities = normalizeContact(item).identities.map(identityRequestPayload);
      const index = item.identities.findIndex((identity) => String(identity.identityId) === String(identityId));
      if (index < 0) throw new Error("Contact identity not found.");
      item.identities[index] = { ...item.identities[index], ...clone(payload), identityId };
      return { ok: true, item: clone(item.identities[index]), contact: clone(item) };
    }

    async deleteContactIdentity(contactId, identityId) {
      await smallDelay(90);
      const item = this.data.contacts.find((contact) => contact.contactId === contactId);
      if (!item) throw new Error("Contact not found.");
      if (!Array.isArray(item.identities)) item.identities = normalizeContact(item).identities.map(identityRequestPayload);
      const linked = this.data.conversations.some((conversation) => conversation.contactId === contactId &&
        String(conversation.contactIdentityId || conversation.identityId || "") === String(identityId));
      if (linked) throw new Error("This identity has conversation history and cannot be removed.");
      item.identities = item.identities.filter((identity) => String(identity.identityId) !== String(identityId));
      return { ok: true, deleted: true, contact: clone(item) };
    }

    async startContactConversation(contactId, identityId, payload = {}) {
      await smallDelay(100);
      const contact = this.data.contacts.find((item) => item.contactId === contactId &&
        normalizeContact(item).identities.some((identity) => identity.identityId === identityId));
      if (!contact) throw new Error("Contact identity not found.");
      const identity = normalizeContact(contact).identities.find((entry) => entry.identityId === identityId);
      const channelId = String(payload.channelId || identity.bindings[0]?.channelId || identity.channelId || "");
      if (!channelId) throw new Error("Choose a connected route first.");
      const binding = identity.bindings.find((entry) => entry.channelId === channelId) || null;
      const existing = this.data.conversations.find((conversation) => conversation.contactId === contact.contactId &&
        conversation.channelId === channelId &&
        (conversation.contactIdentityId === identityId || !conversation.contactIdentityId));
      if (existing) return { ok: true, conversationId: existing.conversationId, item: clone(existing) };
      const channel = this.data.channels.find((entry) => entry.channelId === channelId);
      if (!channel) throw new Error("The selected route is no longer available.");
      const suffix = Date.now().toString(36);
      const conversation = {
        conversationId: `cv-${suffix}`,
        contactId: contact.contactId,
        contactIdentityId: identityId,
        subject: contact.displayName,
        channelId,
        channelName: channel.name,
        connectorType: channel.connectorType,
        channelProfileId: binding?.scopedProfileId || identity.profileId,
        status: "open",
        assignedTo: "Unassigned",
        unreadCount: 0,
        lastMessage: "New conversation",
        lastMessageAt: new Date().toISOString(),
      };
      this.data.conversations.unshift(conversation);
      this.data.messages[conversation.conversationId] = [];
      this.emit({ type: "conversation.created", conversation: clone(conversation), item: clone(conversation) });
      return { ok: true, conversationId: conversation.conversationId, item: clone(conversation) };
    }

    async deleteContact(contactId) {
      await smallDelay(100);
      const index = this.data.contacts.findIndex((contact) => contact.contactId === contactId);
      if (index < 0) throw new Error("Contact not found.");
      const [item] = this.data.contacts.splice(index, 1);
      const conversationIds = this.data.conversations.filter((conversation) => conversation.contactId === contactId)
        .map((conversation) => conversation.conversationId);
      this.data.conversations = this.data.conversations.filter((conversation) => conversation.contactId !== contactId);
      conversationIds.forEach((conversationId) => { delete this.data.messages[conversationId]; });
      return { ok: true, deleted: true, item: clone(item) };
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

    async deleteChannel(channelId) {
      await smallDelay(100);
      const index = this.data.channels.findIndex((entry) => entry.channelId === channelId);
      if (index < 0) throw new Error("Channel not found.");
      const [item] = this.data.channels.splice(index, 1);
      const conversationIds = this.data.conversations.filter((conversation) => conversation.channelId === channelId)
        .map((conversation) => conversation.conversationId);
      this.data.contacts.forEach((contact) => {
        if (!Array.isArray(contact.identities)) return;
        contact.identities.forEach((identity) => {
          if (Array.isArray(identity.bindings)) identity.bindings = identity.bindings.filter((binding) => binding.channelId !== channelId);
          if (Array.isArray(identity.routes)) identity.routes = identity.routes.filter((route) => route.channelId !== channelId);
          if (identity.channelId === channelId) identity.channelId = "";
        });
      });
      this.data.conversations = this.data.conversations.filter((conversation) => conversation.channelId !== channelId);
      conversationIds.forEach((conversationId) => { delete this.data.messages[conversationId]; });
      this.verifyTokens.delete(channelId);
      this.emit({ type: "channel.deleted", channelId });
      return { ok: true, deleted: true, item: clone(item) };
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
      this.lastSocketActivity = 0;
      this.openSocket = null;
      this.closedByClient = false;
    }

    async request(path, options = {}) {
      const headers = new Headers(options.headers || {});
      if (!headers.has("Accept")) headers.set("Accept", "application/json");
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
      const returnTo = new URL(location.pathname || "/", location.origin);
      returnTo.hash = location.hash || "#inbox";
      url.searchParams.set("return_to", returnTo.toString());
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

    getWorkspace() {
      return this.isDemo ? this.demo.getWorkspace() : this.request("/api/workspace");
    }

    updateWorkspace(payload) {
      return this.isDemo
        ? this.demo.updateWorkspace(payload)
        : this.request("/api/workspace", { method: "PATCH", body: JSON.stringify(payload) });
    }

    getMessages(conversationId) {
      return this.isDemo
        ? this.demo.getMessages(conversationId)
        : this.request(`/api/conversations/${encodeURIComponent(conversationId)}/messages?limit=100`);
    }

    sendMessage(conversationId, text, replyToMessageId = "", route = {}) {
      return this.isDemo
        ? this.demo.sendMessage(conversationId, text, replyToMessageId, route)
        : this.request(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
          method: "POST",
          body: JSON.stringify({ text, ...(replyToMessageId ? { replyToMessageId } : {}),
            ...(route.channelId ? { channelId: route.channelId } : {}),
            ...(route.identityId ? { identityId: route.identityId } : {}) }),
        });
    }

    sendTemplate(conversationId, payload, route = {}) {
      return this.isDemo
        ? this.demo.sendTemplate(conversationId, payload, route)
        : this.request(`/api/conversations/${encodeURIComponent(conversationId)}/template`, {
          method: "POST",
          body: JSON.stringify({ ...payload,
            ...(route.channelId ? { channelId: route.channelId } : {}),
            ...(route.identityId ? { identityId: route.identityId } : {}) }),
        });
    }

    uploadTemplateMedia(conversationId, formData) {
      return this.isDemo
        ? this.demo.uploadTemplateMedia(conversationId, formData)
        : this.request(`/api/conversations/${encodeURIComponent(conversationId)}/template-media`, {
          method: "POST",
          body: formData,
        });
    }

    getTemplates(conversationId, route = {}) {
      return this.isDemo
        ? this.demo.getTemplates(conversationId)
        : this.request(`/api/conversations/${encodeURIComponent(conversationId)}/templates${(() => {
          const query = new URLSearchParams();
          if (route.channelId) query.set("channelId", route.channelId);
          if (route.identityId) query.set("identityId", route.identityId);
          return query.size ? `?${query}` : "";
        })()}`);
    }

    getWhatsAppTemplates() {
      return this.isDemo
        ? this.demo.getWhatsAppTemplates()
        : this.request("/api/channel-data/whatsapp-templates");
    }

    importChat(payload, { signal } = {}) {
      return this.isDemo
        ? this.demo.importChat(payload, { signal })
        : this.request("/api/channel-data/import-chat", {
          method: "POST",
          body: JSON.stringify(payload),
          signal,
        });
    }

    sendAttachment(conversationId, formData) {
      return this.isDemo
        ? this.demo.sendAttachment(conversationId, formData)
        : this.request(`/api/conversations/${encodeURIComponent(conversationId)}/attachments`, {
          method: "POST",
          body: formData,
        });
    }

    attachmentUrl(messageId, { download = false } = {}) {
      if (this.isDemo || !messageId) return "";
      return `${this.base}/api/messages/${encodeURIComponent(messageId)}/attachment${download ? "?download=1" : ""}`;
    }

    updateConversation(conversationId, patch) {
      return this.isDemo
        ? this.demo.updateConversation(conversationId, patch)
        : this.request(`/api/conversations/${encodeURIComponent(conversationId)}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
    }

    deleteConversation(conversationId) {
      return this.isDemo
        ? this.demo.deleteConversation(conversationId)
        : this.request(`/api/conversations/${encodeURIComponent(conversationId)}`, { method: "DELETE" });
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

    exportContacts() {
      if (this.isDemo) {
        const headers = ["Contact ID", "Name", "Company", "Tags", "WhatsApp ID", "Telegram ID", "Instagram ID", "Facebook ID", "Email ID"];
        const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
        const rows = this.demo.data.contacts.map((raw) => {
          const contact = normalizeContact(raw);
          const ids = contactPlatformIds(contact);
          return [contact.contactId, contact.displayName, contact.company, contact.tags.join(", "), ids.whatsapp,
            ids.telegram, ids.instagram, ids.facebook, ids.email].map(escape).join(",");
        });
        return Promise.resolve([headers.map(escape).join(","), ...rows].join("\r\n"));
      }
      return this.request("/api/contacts/export.csv", { headers: { Accept: "text/csv" } });
    }

    createContactIdentity(contactId, payload) {
      return this.isDemo
        ? this.demo.createContactIdentity(contactId, payload)
        : this.request(`/api/contacts/${encodeURIComponent(contactId)}/identities`, { method: "POST", body: JSON.stringify(payload) });
    }

    updateContactIdentity(contactId, identityId, payload) {
      return this.isDemo
        ? this.demo.updateContactIdentity(contactId, identityId, payload)
        : this.request(`/api/contacts/${encodeURIComponent(contactId)}/identities/${encodeURIComponent(identityId)}`, {
          method: "PATCH", body: JSON.stringify(payload),
        });
    }

    deleteContactIdentity(contactId, identityId) {
      return this.isDemo
        ? this.demo.deleteContactIdentity(contactId, identityId)
        : this.request(`/api/contacts/${encodeURIComponent(contactId)}/identities/${encodeURIComponent(identityId)}`, { method: "DELETE" });
    }

    startContactConversation(contactId, identityId, payload = {}) {
      return this.isDemo
        ? this.demo.startContactConversation(contactId, identityId, payload)
        : this.request("/api/conversations", {
          method: "POST", body: JSON.stringify({ contactId, identityId, ...payload }),
        });
    }

    deleteContact(contactId) {
      return this.isDemo
        ? this.demo.deleteContact(contactId)
        : this.request(`/api/contacts/${encodeURIComponent(contactId)}`, { method: "DELETE" });
    }

    getPushConfig() {
      return this.isDemo
        ? Promise.resolve({ available: false, publicKey: "" })
        : this.request("/api/push/config");
    }

    savePushSubscription(payload) {
      return this.isDemo
        ? Promise.resolve({ subscribed: true, deviceId: payload.deviceId })
        : this.request("/api/push/subscriptions", { method: "POST", body: JSON.stringify(payload) });
    }

    removePushSubscription(payload) {
      return this.isDemo
        ? Promise.resolve({ subscribed: false, deviceId: payload.deviceId })
        : this.request("/api/push/subscriptions", { method: "DELETE", body: JSON.stringify(payload) });
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

    deleteChannel(channelId) {
      return this.isDemo
        ? this.demo.deleteChannel(channelId)
        : this.request(`/api/channels/${encodeURIComponent(channelId)}`, { method: "DELETE" });
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

    deleteApiKey(apiKeyId) {
      return this.isDemo
        ? this.demo.deleteApiKey(apiKeyId)
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

    deleteMember(membershipId) {
      return this.isDemo
        ? this.demo.deleteMember(membershipId)
        : this.request(`/api/team/members/${encodeURIComponent(membershipId)}`, { method: "DELETE" });
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
        if (this.closedByClient || [WebSocket.OPEN, WebSocket.CONNECTING].includes(this.socket?.readyState)) return;
        clearTimeout(this.reconnectTimer);
        const url = new URL(this.base);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.pathname = `${url.pathname.replace(/\/$/, "")}/api/realtime`;
        url.search = "";
        onState("connecting");
        const socket = new WebSocket(url);
        let heartbeatTimer = null;
        const connectTimer = setTimeout(() => {
          if (this.socket === socket && socket.readyState === WebSocket.CONNECTING) {
            try { socket.close(4000, "Realtime connection timed out"); }
            catch { /* The browser will surface its own connection error. */ }
          }
        }, 15_000);
        this.socket = socket;
        socket.addEventListener("open", () => {
          clearTimeout(connectTimer);
          if (this.socket !== socket || this.closedByClient) {
            socket.close(1000, "Superseded realtime connection");
            return;
          }
          this.lastSocketActivity = Date.now();
          onState("online");
          heartbeatTimer = setInterval(() => {
            if (this.socket !== socket) {
              clearInterval(heartbeatTimer);
              return;
            }
            if (socket.readyState !== WebSocket.OPEN) return;
            if (Date.now() - this.lastSocketActivity > 70_000) {
              socket.close(4000, "Realtime heartbeat timed out");
              return;
            }
            socket.send("ping");
          }, 25_000);
        });
        socket.addEventListener("message", (event) => {
          if (this.socket !== socket || this.closedByClient) return;
          this.lastSocketActivity = Date.now();
          if (event.data === "pong") return;
          try { listener(JSON.parse(event.data)); }
          catch { /* Ignore non-JSON keepalives. */ }
        });
        socket.addEventListener("error", () => {
          if (this.socket === socket && !this.closedByClient) onState("error");
        });
        socket.addEventListener("close", (event) => {
          clearTimeout(connectTimer);
          clearInterval(heartbeatTimer);
          if (this.socket !== socket) return;
          this.socket = null;
          if (this.closedByClient) return;
          if (event.code === 1008) {
            onState("error");
            window.dispatchEvent(new CustomEvent("helixcer:unauthorized"));
            return;
          }
          onState("offline");
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = setTimeout(openSocket, 3500);
        });
      };
      this.openSocket = openSocket;
      openSocket();
      return () => {
        this.closedByClient = true;
        clearTimeout(this.reconnectTimer);
        if (this.socket) this.socket.close();
      };
    }

    ensureRealtimeConnected({ resume = false } = {}) {
      if (this.isDemo || this.recoveryToken) return;
      if (resume) this.closedByClient = false;
      if (this.closedByClient) return;
      if ([WebSocket.OPEN, WebSocket.CONNECTING].includes(this.socket?.readyState)) return;
      clearTimeout(this.reconnectTimer);
      this.openSocket?.();
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
      allowedChannelIds: normalizeAllowedChannelIds(membership.allowedChannelIds ?? membership.allowed_channel_ids),
      workspace: source.workspace || { workspaceId: "default", name: DEFAULT_WORKSPACE, slug: "helixcer" },
    };
  }

  function normalizeWorkspaceProfile(raw = {}) {
    return {
      workspaceId: String(raw.workspaceId || state.workspace?.workspaceId || ""),
      displayName: String(raw.displayName || raw.name || state.workspace?.displayName || state.workspace?.name || DEFAULT_WORKSPACE),
      registeredName: String(raw.registeredName || ""),
      addressLine1: String(raw.addressLine1 || ""),
      addressLine2: String(raw.addressLine2 || ""),
      city: String(raw.city || ""),
      state: String(raw.state || ""),
      postalCode: String(raw.postalCode || ""),
      country: String(raw.country || ""),
      gstin: String(raw.gstin || "").toUpperCase(),
      taxDetails: String(raw.taxDetails || ""),
    };
  }

  function canAdmin() {
    return state.currentUser && ["owner", "admin"].includes(state.currentUser.role);
  }

  function isOwner() {
    return state.currentUser?.role === "owner";
  }

  function updateWorkspaceIdentity(profile = state.workspaceProfile || normalizeWorkspaceProfile(state.workspace)) {
    const displayName = profile.displayName || DEFAULT_WORKSPACE;
    $("sidebarWorkspaceName").textContent = displayName;
    state.workspace = { ...state.workspace, ...profile, name: displayName };
    if (state.currentUser?.workspace) state.currentUser.workspace = { ...state.currentUser.workspace, ...profile, name: displayName };
  }

  function setWorkspaceFormBusy(busy) {
    state.workspaceProfileLoading = busy;
    const admin = canAdmin();
    const editable = admin && state.workspaceProfileLoaded;
    $("workspaceProfileForm").querySelectorAll("input, textarea").forEach((field) => {
      const readOnly = field.hasAttribute("data-workspace-immutable") || busy || !editable;
      field.readOnly = readOnly;
      field.setAttribute("aria-readonly", String(readOnly));
    });
    $("workspaceSaveButton").disabled = busy || !editable;
    $("workspaceReadonlyNote").hidden = admin;
  }

  function renderWorkspaceProfile() {
    const profile = state.workspaceProfile || normalizeWorkspaceProfile(state.workspace);
    const values = {
      workspaceId: profile.workspaceId,
      workspaceDisplayName: profile.displayName,
      workspaceRegisteredName: profile.registeredName,
      workspaceAddressLine1: profile.addressLine1,
      workspaceAddressLine2: profile.addressLine2,
      workspaceCity: profile.city,
      workspaceState: profile.state,
      workspacePostalCode: profile.postalCode,
      workspaceCountry: profile.country,
      workspaceGstin: profile.gstin,
      workspaceTaxDetails: profile.taxDetails,
    };
    Object.entries(values).forEach(([id, value]) => { $(id).value = value || ""; });
    updateWorkspaceIdentity(profile);
    setWorkspaceFormBusy(false);
  }

  async function loadWorkspaceProfile({ force = false } = {}) {
    if (!state.api || state.authStatus !== "authenticated") return;
    if (state.workspaceProfileLoading || (state.workspaceProfileLoaded && !force)) {
      if (state.workspaceProfileLoaded) renderWorkspaceProfile();
      return;
    }
    $("workspaceSaveState").textContent = "Loading…";
    setWorkspaceFormBusy(true);
    try {
      const response = await state.api.getWorkspace();
      state.workspaceProfile = normalizeWorkspaceProfile(response?.item || response?.workspace || response);
      state.workspaceProfileLoaded = true;
      renderWorkspaceProfile();
      $("workspaceSaveState").textContent = "";
    } catch (error) {
      $("workspaceSaveState").textContent = "Unable to load workspace details";
      setWorkspaceFormBusy(false);
      if (state.route === "workspace") showToast("Workspace details were not loaded", error.message, true);
    }
  }

  async function saveWorkspaceProfile(form) {
    if (!canAdmin() || state.workspaceProfileLoading) return;
    const gstinField = $("workspaceGstin");
    const gstin = gstinField.value.trim().toUpperCase();
    gstinField.value = gstin;
    gstinField.setCustomValidity(gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)
      ? "Enter a valid 15-character GSTIN." : "");
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const payload = {
      displayName: String(data.get("displayName") || "").trim(),
      registeredName: String(data.get("registeredName") || "").trim(),
      addressLine1: String(data.get("addressLine1") || "").trim(),
      addressLine2: String(data.get("addressLine2") || "").trim(),
      city: String(data.get("city") || "").trim(),
      state: String(data.get("state") || "").trim(),
      postalCode: String(data.get("postalCode") || "").trim(),
      country: String(data.get("country") || "").trim(),
      gstin,
      taxDetails: String(data.get("taxDetails") || "").trim(),
    };
    $("workspaceSaveState").textContent = "Saving…";
    setWorkspaceFormBusy(true);
    try {
      const response = await state.api.updateWorkspace(payload);
      state.workspaceProfile = normalizeWorkspaceProfile(response?.item || response?.workspace || { ...state.workspaceProfile, ...payload });
      state.workspaceProfileLoaded = true;
      renderWorkspaceProfile();
      $("workspaceSaveState").textContent = "Saved";
      showToast("Workspace saved", "The workspace profile is now up to date.");
    } catch (error) {
      $("workspaceSaveState").textContent = "Changes not saved";
      setWorkspaceFormBusy(false);
      showToast("Workspace was not updated", error.message, true);
    }
  }

  function showAuthChecking() {
    state.authStatus = "checking";
    $("sessionSplash").hidden = false;
    $("authGate").hidden = true;
    $("appShell").hidden = true;
  }

  function showSignedOut(message = "") {
    state.authStatus = "signed-out";
    state.currentUser = null;
    state.workspaceProfile = null;
    state.workspaceProfileLoaded = false;
    state.recentVerifyTokens.clear();
    if (state.disconnectRealtime) state.disconnectRealtime();
    state.disconnectRealtime = null;
    $("appShell").hidden = true;
    $("sessionSplash").hidden = true;
    $("authGate").hidden = false;
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
    $("sessionSplash").hidden = true;
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
    updateWorkspaceIdentity();
    $("sidebarMode").textContent = state.api.isDemo ? "Demo workspace" : `${capitalize(user.role)} access`;
  }

  function applyPermissions() {
    const admin = canAdmin();
    document.querySelectorAll("[data-admin-only]").forEach((node) => { node.hidden = !admin; });
    document.querySelectorAll("[data-owner-only]").forEach((node) => { node.hidden = !isOwner(); node.disabled = !isOwner(); });
    setWorkspaceFormBusy(state.workspaceProfileLoading);
    if (!admin && ["channels", "whatsapp-templates", "import-chat", "developer", "team"].includes(state.route)) setRoute("inbox");
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
        prepareBrowserPush(),
      ]);
      await applyLocationRoute();
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

  function connectorPlatform(value) {
    const normalized = String(value || "").trim().toLocaleLowerCase().replace(/[-\s]+/g, "_");
    if (["whatsapp", "whatsapp_cloud", "wa"].includes(normalized)) return "whatsapp";
    if (["telegram", "telegram_bot", "tg"].includes(normalized)) return "telegram";
    if (["instagram", "instagram_messaging", "ig"].includes(normalized)) return "instagram";
    if (["facebook", "facebook_messenger", "messenger", "fb"].includes(normalized)) return "facebook";
    if (["email", "gmail", "outlook", "mail"].includes(normalized)) return "email";
    return identityPlatforms[normalized] ? normalized : "";
  }

  function normalizeIdentityBinding(raw, identity = {}) {
    const channelId = String(raw?.channelId || raw?.routeId || "");
    const channel = state.channels.find((item) => item.channelId === channelId) || null;
    const connectorType = String(raw?.connectorType || channel?.connectorType || identity.connectorType || "");
    const lastUsedAt = raw?.lastUsedAt || raw?.lastMessageAt || raw?.lastInboundAt || raw?.lastOutboundAt || "";
    return {
      ...raw,
      channelId,
      channelName: raw?.channelName || raw?.name || channel?.name || "Connected route",
      connectorType,
      scopedProfileId: String(raw?.scopedProfileId || raw?.channelProfileId || identity.channelProfileId || identity.profileId || ""),
      conversationId: String(raw?.conversationId || raw?.lastConversationId || ""),
      conversationStatus: String(raw?.conversationStatus || ""),
      lastUsedAt,
      eligible: raw?.eligible !== false && raw?.channelEnabled !== false && channel?.enabled !== false,
    };
  }

  function normalizeContactIdentity(raw, contact = {}, index = 0) {
    const channelId = String(raw?.channelId || "");
    const channel = state.channels.find((item) => item.channelId === channelId) || null;
    const connectorType = String(raw?.connectorType || channel?.connectorType || "");
    const platform = connectorPlatform(raw?.platform || raw?.provider || connectorType) || "email";
    const profileId = String(raw?.profileId || raw?.channelProfileId || raw?.providerId || raw?.identity || raw?.email || "");
    const identityId = String(raw?.identityId || raw?.contactIdentityId || raw?.id ||
      `legacy:${contact.contactId || contact.id || "contact"}:${channelId || platform}:${profileId || index + 1}`);
    const routeSource = [
      ...asItems(raw?.routes),
      ...asItems(raw?.bindings),
    ];
    if (!routeSource.length && channelId) routeSource.push({
      channelId,
      channelName: raw?.channelName || contact.channelName,
      connectorType,
      channelProfileId: raw?.channelProfileId || profileId,
      conversationId: raw?.conversationId,
      conversationStatus: raw?.conversationStatus,
      lastUsedAt: raw?.lastMessageAt,
      channelEnabled: raw?.channelEnabled,
    });
    const routeMap = new Map();
    routeSource.forEach((route) => {
      const normalized = normalizeIdentityBinding(route, { ...raw, profileId });
      const key = `${normalized.channelId}:${normalized.conversationId || ""}`;
      if (!routeMap.has(key)) routeMap.set(key, normalized);
    });
    const bindings = [...routeMap.values()];
    return {
      ...raw,
      identityId,
      platform,
      profileId,
      channelProfileId: profileId,
      username: String(raw?.username || raw?.handle || ""),
      phoneNumber: String(raw?.phoneNumber || raw?.phone || (platform === "whatsapp" ? profileId : "")),
      email: String(raw?.email || (platform === "email" ? profileId : "")),
      displayName: String(raw?.displayName || ""),
      metadata: raw?.metadata && typeof raw.metadata === "object" ? { ...raw.metadata } : {},
      isPrimary: raw?.isPrimary === true || raw?.primary === true,
      channelId: channelId || bindings[0]?.channelId || "",
      channelName: raw?.channelName || bindings[0]?.channelName || "",
      connectorType: connectorType || bindings[0]?.connectorType || "",
      conversationId: String(raw?.conversationId || bindings[0]?.conversationId || ""),
      conversationStatus: String(raw?.conversationStatus || bindings[0]?.conversationStatus || ""),
      lastMessageAt: raw?.lastMessageAt || bindings[0]?.lastUsedAt || "",
      channelEnabled: raw?.channelEnabled !== false,
      bindings,
      routes: bindings,
    };
  }

  function normalizeConversationRoute(raw = {}, conversation = {}) {
    const channelId = String(raw.channelId || conversation.channelId || "");
    const channel = state.channels.find((item) => item.channelId === channelId) || {};
    return {
      ...raw,
      channelId,
      identityId: String(raw.identityId || raw.contactIdentityId || conversation.contactIdentityId || ""),
      connectorType: String(raw.connectorType || channel.connectorType || conversation.connectorType || ""),
      channelName: String(raw.channelName || channel.name || conversation.channelName || "Channel"),
      channelProfileId: String(raw.channelProfileId || raw.profileId || raw.scopedProfileId || conversation.channelProfileId || ""),
      enabled: raw.enabled !== false && raw.channelEnabled !== false,
      freeformAllowed: typeof raw.freeformAllowed === "boolean" ? raw.freeformAllowed : undefined,
      replyWindowExpiresAt: String(raw.replyWindowExpiresAt || raw.replyWindow?.expiresAt || ""),
      replyWindowReason: String(raw.replyWindowReason || raw.replyWindow?.reason || ""),
      lastInboundAt: String(raw.lastInboundAt || ""),
    };
  }

  function conversationRouteKey(route = {}) {
    return `${route.channelId || ""}:${route.identityId || ""}`;
  }

  function conversationRoutes(conversation) {
    if (!conversation) return [];
    const source = asItems(conversation.routeOptions).length
      ? asItems(conversation.routeOptions)
      : [{
        channelId: conversation.channelId,
        identityId: conversation.contactIdentityId,
        connectorType: conversation.connectorType,
        channelName: conversation.channelName,
        channelProfileId: conversation.channelProfileId,
        freeformAllowed: conversation.freeformAllowed,
        replyWindowExpiresAt: conversation.replyWindowExpiresAt,
        replyWindowReason: conversation.replyWindowReason,
      }];
    const seen = new Set();
    return source.map((route) => normalizeConversationRoute(route, conversation)).filter((route) => {
      const key = conversationRouteKey(route);
      if (!route.channelId || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function messageRoute(message, conversation = selectedConversation()) {
    if (!message || !conversation) return null;
    const routes = conversationRoutes(conversation);
    return routes.find((route) => route.channelId === message.channelId &&
      (!message.identityId || !route.identityId || route.identityId === message.identityId)) ||
      (message.channelId ? normalizeConversationRoute(message, conversation) : null);
  }

  function defaultConversationRoute(conversation) {
    const routes = conversationRoutes(conversation);
    const rawDefault = conversation?.defaultRoute && typeof conversation.defaultRoute === "object"
      ? normalizeConversationRoute(conversation.defaultRoute, conversation) : null;
    const defaultChannelId = rawDefault?.channelId || conversation?.defaultChannelId || conversation?.channelId || "";
    const defaultIdentityId = rawDefault?.identityId || conversation?.defaultIdentityId || conversation?.contactIdentityId || "";
    return routes.find((route) => route.channelId === defaultChannelId &&
      (!defaultIdentityId || !route.identityId || route.identityId === defaultIdentityId)) ||
      routes.filter((route) => route.enabled).sort((a, b) => new Date(b.lastInboundAt || 0) - new Date(a.lastInboundAt || 0))[0] ||
      routes[0] || null;
  }

  function selectedComposerRoute(conversation = selectedConversation()) {
    if (!conversation) return null;
    const replyMessage = state.replyingTo?.conversationId === conversation.conversationId
      ? selectedMessageById(state.replyingTo.messageId) || state.replyingTo.message : null;
    const replyRoute = messageRoute(replyMessage, conversation);
    if (replyRoute) return replyRoute;
    const selectedKey = state.composerRoutes.get(conversation.conversationId);
    return conversationRoutes(conversation).find((route) => conversationRouteKey(route) === selectedKey) ||
      defaultConversationRoute(conversation);
  }

  function promoteInboundConversationRoute(conversation, message) {
    if (!conversation || !message?.channelId) return;
    const expiresAt = new Date(new Date(message.timestamp).getTime() + 24 * 60 * 60 * 1000).toISOString();
    const inboundRoute = normalizeConversationRoute({
      ...message,
      lastInboundAt: message.timestamp,
      freeformAllowed: true,
      replyWindowExpiresAt: expiresAt,
      replyWindowReason: "",
    }, conversation);
    const routes = conversationRoutes(conversation);
    const key = conversationRouteKey(inboundRoute);
    const routeIndex = routes.findIndex((route) => conversationRouteKey(route) === key);
    if (routeIndex >= 0) routes[routeIndex] = { ...routes[routeIndex], ...inboundRoute };
    else routes.push(inboundRoute);
    conversation.routeOptions = routes;
    conversation.defaultRoute = inboundRoute;
    conversation.defaultChannelId = inboundRoute.channelId;
    conversation.defaultIdentityId = inboundRoute.identityId;
  }

  function normalizeConversation(raw) {
    const replyWindow = raw.replyWindow && typeof raw.replyWindow === "object" ? raw.replyWindow : {};
    const lastMessageObject = raw.lastMessage && typeof raw.lastMessage === "object" ? raw.lastMessage : null;
    const lastMessageType = String(raw.lastMessageType || lastMessageObject?.messageType || lastMessageObject?.attachment?.type || "")
      .trim().toLocaleLowerCase();
    const lastMessageText = lastMessageObject?.text || raw.lastMessageText || raw.preview ||
      (typeof raw.lastMessage === "string" ? raw.lastMessage : "");
    const lastMessage = conversationMessagePreview({
      ...lastMessageObject,
      text: lastMessageText,
      messageType: lastMessageType,
      attachment: lastMessageObject?.attachment || raw.lastMessageAttachment || raw.attachment || null,
    }) || "No messages yet";
    const normalized = {
      ...raw,
      conversationId: String(raw.conversationId || raw.id || ""),
      contactId: String(raw.contactId || raw.contact?.contactId || raw.contact?.id || ""),
      contactIdentityId: String(raw.contactIdentityId || raw.identityId || raw.contact?.identityId || ""),
      subject: raw.subject || raw.contactName || raw.displayName || raw.contact?.displayName || "Unknown contact",
      channelId: String(raw.channelId || raw.channel?.channelId || raw.channel?.id || "unknown"),
      connectorType: raw.connectorType || raw.channel?.connectorType || "",
      status: raw.status || "open",
      assignedTo: raw.assignedTo || raw.assignee || "Unassigned",
      unreadCount: Number(raw.unreadCount ?? raw.unread ?? 0),
      lastMessage: String(lastMessage),
      lastMessageType,
      lastMessageAt: raw.lastMessageAt || raw.updatedAt || raw.createdAt || new Date().toISOString(),
      channelProfileId: raw.channelProfileId || raw.contact?.channelProfileId || "",
      freeformAllowed: typeof raw.freeformAllowed === "boolean"
        ? raw.freeformAllowed
        : typeof replyWindow.freeformAllowed === "boolean" ? replyWindow.freeformAllowed : undefined,
      replyWindowExpiresAt: raw.replyWindowExpiresAt || replyWindow.expiresAt || "",
      replyWindowReason: raw.replyWindowReason || replyWindow.reason || "",
    };
    normalized.routeOptions = asItems(raw.routeOptions || raw.routes)
      .map((route) => normalizeConversationRoute(route, normalized));
    if (!normalized.routeOptions.length && normalized.channelId && normalized.channelId !== "unknown") {
      normalized.routeOptions = [normalizeConversationRoute({}, normalized)];
    }
    normalized.defaultRoute = raw.defaultRoute && typeof raw.defaultRoute === "object"
      ? normalizeConversationRoute(raw.defaultRoute, normalized) : null;
    normalized.defaultChannelId = String(raw.defaultChannelId || normalized.defaultRoute?.channelId || normalized.channelId || "");
    normalized.defaultIdentityId = String(raw.defaultIdentityId || normalized.defaultRoute?.identityId || normalized.contactIdentityId || "");
    return normalized;
  }

  function contactPlatformIds(contact = {}) {
    const source = contact.platformIds && typeof contact.platformIds === "object" ? contact.platformIds : {};
    const identities = asItems(contact.identities).map((identity, index) =>
      normalizeContactIdentity(identity, contact, index));
    return Object.fromEntries(Object.keys(identityPlatforms).map((platform) => {
      const direct = source[platform] ?? contact[`${platform}Id`] ?? "";
      const fallback = identities.find((identity) => identity.platform === platform)?.profileId || "";
      return [platform, String(direct || fallback).trim()];
    }));
  }

  function markConversationRealtimeMutation(conversationId) {
    if (!conversationId) return;
    state.realtimeRevision += 1;
    state.conversationRevisions.set(conversationId, state.realtimeRevision);
  }

  function mergeConversationSnapshots(fetchedConversations, revisionAtStart) {
    const localById = new Map(state.conversations.map((conversation) => [conversation.conversationId, conversation]));
    const fetchedIds = new Set(fetchedConversations.map((conversation) => conversation.conversationId));
    const liveOnly = state.conversations.filter((conversation) =>
      !fetchedIds.has(conversation.conversationId)
      && (state.conversationRevisions.get(conversation.conversationId) || 0) > revisionAtStart);
    const merged = fetchedConversations.map((conversation) => {
      const local = localById.get(conversation.conversationId);
      const localRevision = state.conversationRevisions.get(conversation.conversationId) || 0;
      return local && localRevision > revisionAtStart ? { ...conversation, ...local } : conversation;
    });
    return [...liveOnly, ...merged];
  }

  function normalizeContact(raw) {
    const identitySource = asItems(raw.identities);
    if (!identitySource.length && (raw.channelId || raw.channelProfileId || raw.identity || raw.email || raw.phone)) {
      identitySource.push({
        identityId: raw.identityId || raw.contactIdentityId,
        platform: raw.platform || raw.connectorType || raw.channel?.connectorType || (raw.email && raw.email !== "—" ? "email" : ""),
        channelId: raw.channelId,
        channelName: raw.channelName || raw.channel?.name,
        connectorType: raw.connectorType || raw.channel?.connectorType,
        profileId: raw.channelProfileId || raw.identity || (raw.email !== "—" ? raw.email : "") || (raw.phone !== "—" ? raw.phone : ""),
        username: raw.username,
        phoneNumber: raw.phone !== "—" ? raw.phone : "",
        email: raw.email !== "—" ? raw.email : "",
        conversationId: raw.conversationId,
        lastMessageAt: raw.lastMessageAt,
        isPrimary: true,
      });
    }
    const flatIds = contactPlatformIds({ ...raw, identities: identitySource });
    Object.entries(flatIds).forEach(([platform, profileId]) => {
      if (!profileId || identitySource.some((identity) => connectorPlatform(identity.platform || identity.provider) === platform)) return;
      identitySource.push({ platform, profileId, channelProfileId: profileId });
    });
    const seenPlatforms = new Set();
    const identities = identitySource.map((identity, index) => normalizeContactIdentity(identity, raw, index))
      .filter((identity) => {
        if (seenPlatforms.has(identity.platform)) return false;
        seenPlatforms.add(identity.platform);
        return true;
      });
    if (identities.length && !identities.some((identity) => identity.isPrimary)) identities[0].isPrimary = true;
    const preferred = identities.find((identity) => identity.isPrimary) || identities[0] || null;
    const emailIdentity = identities.find((identity) => identity.platform === "email");
    const whatsappIdentity = identities.find((identity) => identity.platform === "whatsapp");
    return {
      ...raw,
      contactId: String(raw.contactId || raw.id || ""),
      displayName: raw.displayName || raw.name || "Unknown contact",
      identities,
      platformIds: Object.fromEntries(Object.keys(identityPlatforms).map((platform) => [
        platform,
        flatIds[platform] || identities.find((identity) => identity.platform === platform)?.profileId || "",
      ])),
      channelId: String(raw.channelId || preferred?.channelId || ""),
      channelName: raw.channelName || raw.channel?.name || preferred?.channelName || "",
      connectorType: raw.connectorType || raw.channel?.connectorType || preferred?.connectorType || preferred?.platform || "",
      channelProfileId: raw.channelProfileId || raw.identity || preferred?.profileId || "—",
      company: raw.company || "",
      channelEditable: raw.channelEditable !== false,
      email: (raw.email && raw.email !== "—" ? raw.email : emailIdentity?.profileId) || "—",
      phone: (raw.phone && raw.phone !== "—" ? raw.phone : whatsappIdentity?.phoneNumber) || "—",
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      status: raw.status || "active",
    };
  }

  function normalizeMessage(raw) {
    const replySource = raw?.reply && typeof raw.reply === "object" ? raw.reply : null;
    const templateSource = raw?.template && typeof raw.template === "object" ? raw.template : null;
    const template = templateSource ? {
      ...templateSource,
      buttons: Array.isArray(templateSource.buttons) ? templateSource.buttons.slice(0, 10).flatMap((button) => {
        if (!button || typeof button !== "object") return [];
        const text = String(button.text || button.label || "").trim().slice(0, 100);
        if (!text) return [];
        return [{ ...button, text, type: String(button.type || "quick_reply").toLocaleLowerCase().slice(0, 40) }];
      }) : [],
    } : null;
    const reply = replySource ? {
      messageId: String(replySource.messageId || ""),
      channelMessageId: String(replySource.channelMessageId || replySource.providerMessageId || ""),
      direction: replySource.direction === "outbound" ? "outbound" : replySource.direction === "inbound" ? "inbound" : "",
      text: String(replySource.text || ""),
      messageType: String(replySource.messageType || "text"),
      attachment: replySource.attachment && typeof replySource.attachment === "object" ? {
        type: String(replySource.attachment.type || "document"),
        filename: String(replySource.attachment.filename || ""),
      } : null,
    } : null;
    return {
      ...raw,
      messageId: String(raw.messageId || raw.id || `message-${Date.now()}-${Math.random().toString(36).slice(2)}`),
      direction: raw.direction === "outbound" ? "outbound" : "inbound",
      text: raw.text || raw.body || raw.content || "",
      timestamp: raw.timestamp || raw.createdAt || raw.sentAt || new Date().toISOString(),
      status: raw.status || (raw.direction === "outbound" ? "sent" : "received"),
      senderName: raw.senderName || raw.sender || "",
      channelMessageId: raw.channelMessageId || raw.providerMessageId || "",
      channelId: String(raw.channelId || raw.route?.channelId || ""),
      identityId: String(raw.identityId || raw.contactIdentityId || raw.route?.identityId || ""),
      connectorType: String(raw.connectorType || raw.route?.connectorType || ""),
      channelName: String(raw.channelName || raw.route?.channelName || ""),
      channelProfileId: String(raw.channelProfileId || raw.profileId || raw.route?.channelProfileId || ""),
      error: String(raw.error || ""),
      statusHistory: normalizeMessageStatusHistory(raw.statusHistory || raw.delivery || null),
      template,
      reply,
    };
  }

  function normalizeMessageStatusHistory(value) {
    if (!value || typeof value !== "object") return null;
    const next = {};
    [
      ["sentAt", value.sentAt || value.sent_at || value.createdAt],
      ["deliveredAt", value.deliveredAt || value.delivered_at],
      ["readAt", value.readAt || value.read_at || value.seenAt || value.seen_at],
      ["failedAt", value.failedAt || value.failed_at],
      ["updatedAt", value.updatedAt || value.updated_at],
    ].forEach(([key, raw]) => {
      const text = String(raw || "").trim();
      if (text) next[key] = text;
    });
    return Object.keys(next).length ? next : null;
  }

  function resolveMessageStatusHistory(message) {
    const history = normalizeMessageStatusHistory(message?.statusHistory || null) || {};
    const status = String(message?.status || "").toLocaleLowerCase();
    // Older outbound rows may lack webhook timestamps; fall back to message time as Sent.
    if (!history.sentAt && message?.timestamp &&
        ["submitted", "accepted", "sent", "delivered", "read", "seen", "failed", "error"].includes(status)) {
      history.sentAt = message.timestamp;
    }
    return Object.keys(history).length ? history : null;
  }

  function messageStatusHistoryEntries(message) {
    const history = resolveMessageStatusHistory(message);
    if (!history) return [];
    // Only include statuses that have a real timestamp — never blank rows.
    return [
      ["Sent", history.sentAt],
      ["Delivered", history.deliveredAt],
      ["Seen", history.readAt],
      ["Failed", history.failedAt],
    ].flatMap(([label, value]) => {
      const when = formatStatusHistoryTime(value);
      return when ? [{ label, when }] : [];
    });
  }

  function messageStatusHistoryTitle(message) {
    return messageStatusHistoryEntries(message)
      .map((entry) => `${entry.label}: ${entry.when}`)
      .join("\n");
  }

  function outboundDeliveryStatus(value) {
    const status = String(value || "sent").toLocaleLowerCase();
    if (status === "failed" || status === "error") return { label: "Failed", className: "message-failed" };
    if (status === "read" || status === "seen") return { label: "Read ✓✓", className: "delivery-status is-read" };
    if (status === "delivered") return { label: "Delivered ✓✓", className: "delivery-status is-delivered" };
    if (status === "retrying") return { label: "Retrying", className: "delivery-status is-pending" };
    if (status === "pending" || status === "queued") return { label: "Pending", className: "delivery-status is-pending" };
    if (status === "submitted" || status === "accepted") return { label: "Submitted ✓", className: "delivery-status is-sent" };
    return { label: "Sent ✓", className: "delivery-status is-sent" };
  }

  function mergeOutboundMessageStatus(currentValue, incomingValue) {
    const current = String(currentValue || "").toLocaleLowerCase();
    const incoming = String(incomingValue || "").toLocaleLowerCase();
    if (!incoming) return currentValue || "";
    if (!current || current === incoming) return incomingValue;
    const failures = new Set(["failed", "error"]);
    if (failures.has(incoming)) return incomingValue;
    // A retry is the only normal transition out of a recorded failure. Once it
    // starts, later provider states can advance through the ranked lifecycle.
    if (failures.has(current)) return incoming === "retrying" ? incomingValue : currentValue;
    const ranks = {
      pending: 0, queued: 0,
      retrying: 1,
      submitted: 2, accepted: 2,
      sent: 3,
      delivered: 4,
      read: 5, seen: 5,
    };
    const currentRank = ranks[current];
    const incomingRank = ranks[incoming];
    if (currentRank !== undefined && incomingRank !== undefined && incomingRank < currentRank) return currentValue;
    return incomingValue;
  }

  function mergeMessageSnapshots(cachedMessages = [], fetchedMessages = []) {
    const merged = new Map(fetchedMessages.map((message) => [message.messageId, message]));
    for (const cached of cachedMessages || []) {
      const fetched = merged.get(cached.messageId);
      if (!fetched) {
        merged.set(cached.messageId, cached);
        continue;
      }
      const combined = { ...cached, ...fetched };
      if (cached.direction === "outbound" || fetched.direction === "outbound") {
        combined.status = mergeOutboundMessageStatus(cached.status, fetched.status);
      }
      combined.channelMessageId = fetched.channelMessageId || cached.channelMessageId || "";
      combined.reply = fetched.reply || cached.reply || null;
      combined.attachment = fetched.attachment || cached.attachment;
      // Keep live outbound attribution if a refresh omits or blanks senderName.
      combined.senderName = fetched.senderName || cached.senderName || "";
      combined.statusHistory = mergeMessageStatusHistory(cached.statusHistory, fetched.statusHistory);
      merged.set(cached.messageId, combined);
    }
    return [...merged.values()];
  }

  function mergeMessageStatusHistory(cached, fetched) {
    const left = normalizeMessageStatusHistory(cached) || {};
    const right = normalizeMessageStatusHistory(fetched) || {};
    const next = { ...left };
    for (const key of ["sentAt", "deliveredAt", "readAt", "failedAt", "updatedAt"]) {
      if (right[key]) next[key] = right[key];
    }
    return Object.keys(next).length ? next : null;
  }

  function updateRenderedMessageStatus(message) {
    if (!message?.messageId || message.direction !== "outbound") return false;
    const row = document.querySelector(`#messageThread .message-row[data-message-id="${CSS.escape(message.messageId)}"]`);
    const status = row?.querySelector(".delivery-status, .message-failed");
    if (!status) return false;
    const delivery = outboundDeliveryStatus(message.status);
    status.className = delivery.className;
    status.textContent = delivery.label;
    const errorText = String(message.error || "").trim();
    const historyTitle = messageStatusHistoryTitle(message);
    status.title = errorText
      ? (historyTitle ? `${historyTitle}\nFailed: ${errorText}` : `Failed: ${errorText}`)
      : (historyTitle || `Message status: ${delivery.label.replace(/\s*[✓]+$/, "")}`);
    status.setAttribute("aria-label", status.title.replace(/\n/g, "; "));
    syncMessageStatusInfoButton(row, message);
    return true;
  }

  function syncMessageStatusInfoButton(row, message) {
    const foot = row?.querySelector(".message-foot");
    if (!foot) return;
    let info = foot.querySelector(".message-status-info");
    const entries = messageStatusHistoryEntries(message);
    if (!entries.length) {
      info?.remove();
      if (state.messageStatusMenu?.messageId === message.messageId) closeMessageStatusMenu();
      return;
    }
    if (!info) {
      info = element("button", "message-status-info", "ⓘ");
      info.type = "button";
      info.dataset.action = "toggle-message-status-history";
      info.dataset.messageId = message.messageId;
      const status = foot.querySelector(".delivery-status, .message-failed");
      if (status) foot.insertBefore(info, status);
      else foot.append(info);
    }
    info.dataset.messageId = message.messageId;
    info.setAttribute("aria-label", "Message status history");
    info.title = "Status history";
    if (state.messageStatusMenu?.messageId === message.messageId) {
      renderMessageStatusMenuContent(state.messageStatusMenu.menu, entries);
      positionMessageStatusMenu();
    }
  }

  function deriveContacts(conversations) {
    const byId = new Map();
    conversations.forEach((conversation) => {
      const key = conversation.contactId || `conversation:${conversation.conversationId}`;
      const existing = byId.get(key) || {
        contactId: key,
        displayName: conversation.subject,
        email: conversation.email || "—",
        phone: conversation.phone || "—",
        tags: conversation.tags || [],
        status: conversation.status === "closed" ? "inactive" : "active",
        identities: [],
      };
      const identityKey = conversation.contactIdentityId ||
        `legacy:${key}:${conversation.channelId}:${conversation.channelProfileId || "profile"}`;
      let identity = existing.identities.find((item) => item.identityId === identityKey);
      if (!identity) {
        identity = {
          identityId: identityKey,
          platform: connectorPlatform(conversation.connectorType || channelFor(conversation.channelId).connectorType),
          profileId: conversation.channelProfileId || "",
          channelProfileId: conversation.channelProfileId || "",
          isPrimary: existing.identities.length === 0,
          bindings: [],
        };
        existing.identities.push(identity);
      }
      identity.bindings.push({
        channelId: conversation.channelId,
        channelName: conversation.channelName || channelFor(conversation.channelId).name,
        connectorType: conversation.connectorType || channelFor(conversation.channelId).connectorType,
        channelProfileId: conversation.channelProfileId || "",
        conversationId: conversation.conversationId,
        conversationStatus: conversation.status,
        lastUsedAt: conversation.lastMessageAt,
        eligible: true,
      });
      byId.set(key, existing);
    });
    return [...byId.values()].map(normalizeContact);
  }

  async function loadAll({ preserveSelection = true } = {}) {
    state.loading = true;
    renderConversationList();
    try {
      const realtimeRevisionAtStart = state.realtimeRevision;
      const data = await state.api.bootstrap();
      if (data.me) {
        state.currentUser = normalizeAuth(data.me);
        state.workspace = state.currentUser.workspace || state.workspace;
        renderCurrentUser();
        applyPermissions();
      }
      if (data.workspace) {
        state.workspaceProfile = normalizeWorkspaceProfile(data.workspace);
        state.workspaceProfileLoaded = true;
        if (state.route === "workspace") renderWorkspaceProfile();
        else updateWorkspaceIdentity(state.workspaceProfile);
      }
      state.channels = asItems(data.channels).map(normalizeChannel);
      const fetchedConversations = asItems(data.conversations).map(normalizeConversation);
      state.conversations = mergeConversationSnapshots(fetchedConversations, realtimeRevisionAtStart);
      state.contacts = asItems(data.contacts).map(normalizeContact);
      if (!state.contacts.length) state.contacts = deriveContacts(state.conversations);
      if (!preserveSelection || !state.conversations.some((item) => item.conversationId === state.selectedConversationId)) {
        state.selectedConversationId = null;
      }
      renderAll();
      if (state.selectedConversationId) await selectConversation(state.selectedConversationId, { markRead: false, updateUrl: false });
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

  async function reconcileWorkspace({ includeSelectedMessages = true } = {}) {
    if (!state.api || state.api.isDemo || state.authStatus !== "authenticated") return;
    if (state.reconcilePromise) return state.reconcilePromise;
    state.reconcilePromise = (async () => {
      const selectedId = state.selectedConversationId;
      const realtimeRevisionAtStart = state.realtimeRevision;
      const thread = $("messageThread");
      const distanceFromBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight;
      const wasNearBottom = distanceFromBottom < 90;
      const previousScrollTop = thread.scrollTop;
      const [data, messageData] = await Promise.all([
        state.api.bootstrap(),
        selectedId && includeSelectedMessages ? state.api.getMessages(selectedId).catch(() => null) : Promise.resolve(null),
      ]);
      if (data.me) {
        state.currentUser = normalizeAuth(data.me);
        state.workspace = state.currentUser.workspace || state.workspace;
        renderCurrentUser();
        applyPermissions();
      }
      if (data.workspace) {
        state.workspaceProfile = normalizeWorkspaceProfile(data.workspace);
        state.workspaceProfileLoaded = true;
        if (state.route === "workspace") renderWorkspaceProfile();
        else updateWorkspaceIdentity(state.workspaceProfile);
      }
      state.channels = asItems(data.channels).map(normalizeChannel);
      const fetchedConversations = asItems(data.conversations).map(normalizeConversation);
      state.conversations = mergeConversationSnapshots(fetchedConversations, realtimeRevisionAtStart);
      state.contacts = asItems(data.contacts).map(normalizeContact);
      if (!state.contacts.length) state.contacts = deriveContacts(state.conversations);
      const activeSelectedId = state.selectedConversationId;
      const selectionUnchanged = activeSelectedId === selectedId;
      // A reconnect has no event replay. Cached histories that were not refreshed here
      // must be fetched again when opened or they can hide messages received while the
      // browser was suspended.
      for (const cachedConversationId of state.messages.keys()) {
        if (cachedConversationId !== activeSelectedId) state.messages.delete(cachedConversationId);
      }
      const selectedConversation = state.conversations.find((item) => item.conversationId === activeSelectedId);
      if (selectionUnchanged && activeSelectedId && !selectedConversation) {
        clearSelectedConversation({ updateUrl: false });
      } else if (selectionUnchanged && selectedConversation && ["pending", "closed"].includes(selectedConversation.status)) {
        clearSelectedConversation({ updateUrl: false });
      } else if (selectedConversation) {
        const shouldMarkRead = selectedConversation.unreadCount > 0 &&
          isConversationActivelyViewed(activeSelectedId);
        if (shouldMarkRead) selectedConversation.unreadCount = 0;
        if (selectionUnchanged && messageData) {
          const fetchedMessages = asItems(messageData).map(normalizeMessage);
          state.messages.set(activeSelectedId, mergeMessageSnapshots(state.messages.get(activeSelectedId), fetchedMessages));
          if (typeof messageData.freeformAllowed === "boolean") selectedConversation.freeformAllowed = messageData.freeformAllowed;
          if (messageData.replyWindowExpiresAt) selectedConversation.replyWindowExpiresAt = messageData.replyWindowExpiresAt;
          if (messageData.replyWindowReason) selectedConversation.replyWindowReason = messageData.replyWindowReason;
        }
        if (shouldMarkRead) state.api.updateConversation(activeSelectedId, { markRead: true }).catch(() => {});
      }
      renderAll();
      if (selectedConversation && selectionUnchanged && state.selectedConversationId === selectedId) {
        thread.scrollTop = wasNearBottom ? thread.scrollHeight : Math.min(previousScrollTop, Math.max(0, thread.scrollHeight - thread.clientHeight));
      }
    })().catch((error) => {
      console.warn("Realtime reconciliation failed", error);
    }).finally(() => {
      state.reconcilePromise = null;
    });
    return state.reconcilePromise;
  }

  function renderAll() {
    renderConversationList();
    renderCounts();
    renderContacts();
    renderChannels();
    populateAssigneeSelect();
    if (canAdmin()) renderApiKeys();
    renderNotificationSetting();
    renderSelectedConversation();
  }

  function renderCounts() {
    const conversations = unifiedConversations();
    const open = conversations.filter((item) => item.status !== "closed").length;
    const closed = conversations.filter((item) => item.status === "closed").length;
    const unread = conversations.filter((item) => item.unreadCount > 0).length;
    const mine = conversations.filter((item) => isAssignedToCurrentUser(item)).length;
    const unassigned = conversations.filter((item) => !item.assignedTo || item.assignedTo === "Unassigned").length;
    const counts = { all: conversations.length, mine, unassigned, open, unread, closed };
    Object.entries(counts).forEach(([filter, count]) => {
      document.querySelectorAll(`[data-filter-count="${filter}"]`).forEach((node) => { node.textContent = String(count); });
    });
    $("sidebarUnread").textContent = unread ? String(unread) : "";
    $("conversationSummary").textContent = `${open} active · ${unread} unread`;
    renderConversationFilterControls();
  }

  const conversationFilterLabels = {
    mine: "Mine", unassigned: "Unassigned", open: "Open", unread: "Unread", closed: "Closed",
  };

  function renderConversationFilterControls() {
    const selected = state.filters;
    const activeLabels = [...selected].map((filter) => conversationFilterLabels[filter]).filter(Boolean);
    $("conversationFilterSummary").textContent = activeLabels.length ? activeLabels.join(" · ") : "All conversations";
    $("conversationFilterCount").textContent = String(selected.size);
    $("conversationFilterCount").hidden = selected.size === 0;
    document.querySelectorAll("[data-conversation-filter-option]").forEach((input) => {
      input.checked = input.value === "all" ? selected.size === 0 : selected.has(input.value);
    });
    document.querySelectorAll("#conversationFilters [data-filter]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.filter === "all" ? selected.size === 0 : selected.has(button.dataset.filter));
      button.setAttribute("aria-pressed", String(button.classList.contains("is-active")));
    });
  }

  function toggleConversationFilter(filter) {
    if (filter === "all") state.filters.clear();
    else if (state.filters.has(filter)) state.filters.delete(filter);
    else state.filters.add(filter);
    renderConversationFilterControls();
    renderConversationList();
  }

  function toggleConversationFilterMenu(force = null, { restoreFocus = false } = {}) {
    const menu = $("conversationFilterMenu");
    const trigger = $("conversationFilterToggle");
    const open = force === null ? menu.hidden : Boolean(force);
    menu.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    if (open) menu.querySelector("[data-conversation-filter-option]")?.focus();
    else if (restoreFocus) trigger.focus();
  }

  function closeConversationFilterMenu(options = {}) {
    if (!$("conversationFilterMenu").hidden) toggleConversationFilterMenu(false, options);
  }

  function filteredConversations() {
    const search = state.search.trim().toLocaleLowerCase();
    const selected = state.filters;
    const statusFilters = ["open", "closed"].filter((filter) => selected.has(filter));
    const assignmentFilters = ["mine", "unassigned"].filter((filter) => selected.has(filter));
    return unifiedConversations()
      .filter((item) => {
        if (statusFilters.length && !statusFilters.some((filter) => filter === "open" ? item.status !== "closed" : item.status === "closed")) return false;
        if (assignmentFilters.length && !assignmentFilters.some((filter) => filter === "mine"
          ? isAssignedToCurrentUser(item)
          : !item.assignedTo || item.assignedTo === "Unassigned")) return false;
        if (selected.has("unread") && item.unreadCount <= 0) return false;
        if (!search) return true;
        return `${item.subject} ${item.lastMessage} ${item.channelId}`.toLocaleLowerCase().includes(search);
      })
      .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
  }

  function unifiedConversations() {
    const groups = new Map();
    state.conversations.forEach((conversation) => {
      const key = conversation.contactId || `conversation:${conversation.conversationId}`;
      const group = groups.get(key);
      if (!group) {
        groups.set(key, { ...conversation, routeOptions: conversationRoutes(conversation) });
        return;
      }
      const conversationIsNewer = new Date(conversation.lastMessageAt || 0) > new Date(group.lastMessageAt || 0);
      const primary = conversationIsNewer ? conversation : group;
      const routes = [...conversationRoutes(group), ...conversationRoutes(conversation)];
      const routeMap = new Map(routes.map((route) => [conversationRouteKey(route), route]));
      groups.set(key, {
        ...group,
        ...primary,
        unreadCount: Number(group.unreadCount || 0) + Number(conversation.unreadCount || 0),
        routeOptions: [...routeMap.values()],
      });
    });
    return [...groups.values()];
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

      const copy = element("span", "conversation-copy");
      const nameRow = element("span", "conversation-name-row");
      nameRow.append(element("strong", "", conversation.subject));
      if (conversation.priority === "high") nameRow.append(element("i", "priority-mark"));
      copy.append(nameRow, element("span", "conversation-preview", conversationPreviewText(
        conversation.lastMessage, conversation.lastMessageType, conversation,
      )));

      const side = element("span", "conversation-side");
      side.append(element("span", "conversation-time", relativeTime(conversation.lastMessageAt)));
      if (conversation.unreadCount > 0) side.append(element("span", "unread-badge", conversation.unreadCount > 99 ? "99+" : String(conversation.unreadCount)));
      button.append(avatarWrap, copy, side);
      host.append(button);
    });
  }

  async function selectConversation(conversationId, { markRead = true, updateUrl = true } = {}) {
    const conversation = state.conversations.find((item) => item.conversationId === conversationId);
    if (!conversation) return;
    const unreadCount = Math.max(0, Number(conversation.unreadCount) || 0);
    const changingConversation = state.selectedConversationId !== conversationId;
    if (changingConversation) {
      closeConversationActionMenu();
      closeComposerRouteMenu();
      state.unreadMarker = markRead && unreadCount > 0 ? { conversationId, count: unreadCount } : null;
      state.replyingTo = null;
    }
    state.selectedConversationId = conversationId;
    state.pendingConversationId = null;
    if (changingConversation) resetNewMessagesBelow(conversationId);
    if (updateUrl) replaceAppHash(conversationHash(conversationId));
    $("inboxGrid").classList.add("chat-open");
    const shouldMarkRead = markRead && unreadCount > 0 && isConversationActivelyViewed(conversationId);
    if (shouldMarkRead) {
      conversation.unreadCount = 0;
      renderCounts();
      state.api.updateConversation(conversationId, { markRead: true }).catch(() => {});
    }
    renderConversationList();
    renderSelectedConversation();
    if (!state.messages.has(conversationId)) {
      renderMessageLoading();
      try {
        const data = await state.api.getMessages(conversationId);
        const fetchedMessages = asItems(data).map(normalizeMessage);
        state.messages.set(conversationId, mergeMessageSnapshots(state.messages.get(conversationId), fetchedMessages));
        if (typeof data?.freeformAllowed === "boolean") conversation.freeformAllowed = data.freeformAllowed;
        if (data?.replyWindowExpiresAt) conversation.replyWindowExpiresAt = data.replyWindowExpiresAt;
        if (data?.replyWindowReason) conversation.replyWindowReason = data.replyWindowReason;
      } catch (error) {
        state.messages.set(conversationId, []);
        showToast("Messages could not be loaded", error.message, true);
      }
    }
    renderSelectedConversation();
  }

  function renderSelectedConversation({ preserveScroll = false, renderThread = true } = {}) {
    const conversation = selectedConversation();
    $("emptyConversation").hidden = Boolean(conversation);
    $("chatContent").hidden = !conversation;
    if (!conversation) {
      syncWhatsAppReplyCountdown(null);
      state.detailsOpen = false;
      updateDetailsVisibility();
      return;
    }
    const contact = contactFor(conversation);
    const activeIdentity = contactIdentityForConversation(conversation, contact);
    const channel = channelFor(conversation.channelId);
    const style = channelStyle(channel);
    $("chatTitle").textContent = conversation.subject;
    $("chatAvatar").textContent = initials(conversation.subject);
    $("chatChannel").textContent = channel?.name || style.label;
    $("chatChannelBadge").title = style.label;
    const channelProfileId = conversation.channelProfileId || activeIdentity?.profileId || contact?.channelProfileId || "";
    $("chatChannelProfileId").textContent = channelProfileId === "—" ? "" : channelProfileId;
    $("chatChannelProfileId").title = channelProfileId === "—" ? "" : channelProfileId;
    // The unified inbox header identifies the person only.  Route identity is
    // deliberately rendered on each message and in the composer route picker.
    $("chatChannelProfileId").hidden = true;
    $("chatChannelBadge").hidden = true;
    $("chatChannelBadge").closest(".chat-meta")?.setAttribute("hidden", "");
    const chatLogo = $("chatProviderLogo");
    const logoPath = providerLogoPaths[channel?.connectorType];
    chatLogo.hidden = !logoPath;
    if (logoPath) chatLogo.src = logoPath;
    $("chatPresence").textContent = `Active ${relativeTime(conversation.lastMessageAt)}`;
    $("conversationStatus").value = conversation.status;
    populateAssigneeSelect(conversation);

    $("detailsAvatar").textContent = initials(conversation.subject);
    $("detailsName").textContent = conversation.subject;
    $("detailsIdentity").textContent = conversation.channelProfileId || activeIdentity?.profileId || contact?.channelProfileId || "No saved identity";
    $("detailsEmail").textContent = contact?.email || "—";
    $("detailsPhone").textContent = contact?.phone || "—";
    $("detailsChannel").textContent = channel?.name || style.label;
    $("detailsAssignee").textContent = conversation.assignedTo || "Unassigned";
    const tagHost = $("detailsTags");
    tagHost.replaceChildren();
    const tags = contact?.tags?.length ? contact.tags : ["No tags"];
    tags.forEach((tag) => tagHost.append(element("span", "tag", tag)));
    if (renderThread) renderMessages({ preserveScroll });
    renderComposerState();
  }

  function renderMessageLoading() {
    const host = $("messageThread");
    host.replaceChildren();
    const loading = element("div", "empty-list", "Loading messages…");
    host.append(loading);
    resetNewMessagesBelow(state.selectedConversationId);
  }

  function messageAttachmentUrl(message, download = false) {
    const attachment = message?.attachment;
    if (!attachment || attachment.available !== true) return "";
    if (attachment.external === true) {
      try {
        const url = new URL(String(attachment.url || ""));
        return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
      } catch { return ""; }
    }
    if (state.api?.attachmentUrl) return state.api.attachmentUrl(message.messageId, { download });
    const raw = String(attachment.url || "");
    if (!raw) return "";
    try {
      const url = new URL(raw, state.api?.base || location.origin);
      if (download) url.searchParams.set("download", "1");
      return url.toString();
    } catch { return ""; }
  }

  function mediaLoadingIndicator(label = "Loading media") {
    const loading = element("div", "message-media-loading");
    loading.setAttribute("role", "status");
    loading.setAttribute("aria-live", "polite");
    loading.setAttribute("aria-label", label);
    loading.append(element("span", "message-media-spinner"));
    return loading;
  }

  function isAwaitingMediaPreview(message) {
    if (message?.direction !== "outbound") return false;
    return ["pending", "queued", "retrying"].includes(String(message.status || "").toLowerCase());
  }

  function renderMessageAttachment(message) {
    const attachment = message?.attachment;
    if (!attachment) return null;
    const type = String(attachment.type || message.messageType || "document");
    const filename = attachment.filename || `${capitalize(type)} attachment`;
    const url = messageAttachmentUrl(message);
    const awaitingPreview = isAwaitingMediaPreview(message);
    const card = element("div", `message-attachment is-${type}${(!url || awaitingPreview) ? " is-loading" : ""}`);
    if (url && type === "image" && !awaitingPreview) {
      const frame = element("div", "message-media-frame");
      const loading = mediaLoadingIndicator(`Loading ${filename}`);
      const link = document.createElement("button");
      link.type = "button";
      link.className = "message-media-link";
      link.dataset.action = "preview-attachment";
      link.dataset.messageId = message.messageId;
      link.setAttribute("aria-label", `Preview ${filename}`);
      link.hidden = true;
      const image = document.createElement("img");
      image.className = "message-media-preview";
      if (attachment.external === true) image.referrerPolicy = "no-referrer";
      else image.crossOrigin = "use-credentials";
      image.alt = filename;
      image.decoding = "async";
      const reveal = () => {
        loading.remove();
        link.hidden = false;
      };
      image.addEventListener("load", reveal, { once: true });
      image.addEventListener("error", reveal, { once: true });
      image.src = url;
      link.append(image);
      frame.append(loading, link);
      card.append(frame);
    } else if (url && type === "video" && !awaitingPreview) {
      const frame = element("div", "message-media-frame");
      const loading = mediaLoadingIndicator(`Loading ${filename}`);
      const video = document.createElement("video");
      video.className = "message-media-preview";
      video.hidden = true;
      if (attachment.external === true) video.referrerPolicy = "no-referrer";
      else video.crossOrigin = "use-credentials";
      video.controls = true;
      video.preload = "metadata";
      const reveal = () => {
        loading.remove();
        video.hidden = false;
      };
      video.addEventListener("loadeddata", reveal, { once: true });
      video.addEventListener("error", reveal, { once: true });
      video.src = url;
      frame.append(loading, video);
      card.append(frame);
    } else if (url && type === "audio" && !awaitingPreview) {
      const audio = document.createElement("audio");
      if (attachment.external === true) audio.referrerPolicy = "no-referrer";
      else audio.crossOrigin = "use-credentials";
      audio.src = url;
      audio.controls = true;
      audio.preload = "metadata";
      card.append(audio);
    } else if (!url || awaitingPreview) {
      card.append(mediaLoadingIndicator(awaitingPreview ? "Media is uploading" : "Loading media"));
    }
    const info = element("div", "message-attachment-info");
    info.append(element("strong", "", filename));
    info.append(element("span", "", [attachment.mimeType, attachment.size ? formatFileSize(attachment.size) : ""].filter(Boolean).join(" · ") || capitalize(type)));
    if (url) {
      const actions = element("div", "message-attachment-actions");
      const download = element("a", "message-attachment-action", "Download");
      download.href = messageAttachmentUrl(message, true);
      download.setAttribute("download", filename);
      download.referrerPolicy = "no-referrer";
      const open = element("button", "message-attachment-action", "Preview");
      open.type = "button";
      open.dataset.action = "preview-attachment";
      open.dataset.messageId = message.messageId;
      actions.append(open);
      actions.append(download);
      info.append(actions);
    } else {
      info.append(element("span", "message-attachment-unavailable", "Preview will be available after the provider accepts the file."));
    }
    card.append(info);
    return card;
  }

  function messageDisplayText(message) {
    if (!message) return "Message";
    if (message.attachment) {
      const caption = String(message.attachment.caption || "").trim();
      if (caption) return caption;
      const filename = String(message.attachment.filename || "").trim();
      if (filename) return filename;
      return `${capitalize(message.attachment.type || message.messageType || "file")} attachment`;
    }
    return String(message.text || `[${message.messageType || "Message"}]`);
  }

  function attachmentPreviewLabel(messageType, attachment = {}) {
    const descriptor = [messageType, attachment?.type, attachment?.mimeType]
      .filter(Boolean).join(" ").toLocaleLowerCase();
    if (/image|photo|picture/.test(descriptor)) return "Photo";
    if (/video/.test(descriptor)) return "Video";
    if (/audio|voice|ogg|mpeg/.test(descriptor)) return "Audio";
    if (/document|pdf|text|csv|word|sheet|presentation/.test(descriptor)) return "Document";
    if (/sticker/.test(descriptor)) return "Sticker";
    if (/file|media|attachment/.test(descriptor) || Object.keys(attachment || {}).length) return "File";
    return "";
  }

  function generatedMediaPreviewMatch(text) {
    const value = String(text || "").trim();
    if (!value) return null;
    const typed = value.match(/^\[(?:whatsapp|telegram|instagram|facebook)?\s*(image|photo|picture|document|file|audio|voice|video|media|attachment|sticker)\s*:\s*[^\]]*\]$/i)
      || value.match(/^\[(?:whatsapp|telegram|instagram|facebook)?\s*(image|photo|picture|document|file|audio|voice|video|media|attachment|sticker)(?:\s+received)?\]$/i);
    if (typed) return String(typed[1] || "file").trim().toLocaleLowerCase();
    if (/^\[Attachment:[^\]]+\]$/i.test(value)) return "file";
    return null;
  }

  function conversationMessagePreview(message) {
    if (!message) return "";
    const attachment = message.attachment && typeof message.attachment === "object" ? message.attachment : null;
    const text = String(attachment?.caption || message.text || "").trim();
    const generatedType = generatedMediaPreviewMatch(text);
    if (text && !generatedType) return text;
    return attachmentPreviewLabel(message.messageType || generatedType, attachment || { type: generatedType || "" });
  }

  function appendWhatsAppFormattedText(host, value) {
    const text = String(value || "");
    const pattern = /```([\s\S]*?)```|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g;
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
      const index = Number(match.index || 0);
      const before = text[index - 1] || "";
      const after = text[index + match[0].length] || "";
      const isCode = match[1] !== undefined;
      const content = match.slice(1).find((item) => item !== undefined) || "";
      const touchesWord = !isCode && ((before && /[\p{L}\p{N}]/u.test(before)) || (after && /[\p{L}\p{N}]/u.test(after)));
      if (!content.trim() || touchesWord) continue;
      if (index > cursor) host.append(document.createTextNode(text.slice(cursor, index)));
      const tag = isCode ? "code" : match[2] !== undefined ? "strong" : match[3] !== undefined ? "em" : "s";
      const formatted = document.createElement(tag);
      if (isCode) formatted.textContent = content;
      else appendWhatsAppFormattedText(formatted, content);
      host.append(formatted);
      cursor = index + match[0].length;
    }
    if (cursor < text.length) host.append(document.createTextNode(text.slice(cursor)));
    return host;
  }

  function whatsAppPlainText(value) {
    return appendWhatsAppFormattedText(document.createElement("span"), value).textContent || "";
  }

  function appendChannelFormattedText(host, value, conversation) {
    if (isWhatsAppConversation(conversation)) return appendWhatsAppFormattedText(host, value);
    host.append(document.createTextNode(String(value || "")));
    return host;
  }

  function channelPlainText(value, conversation) {
    const text = String(value || "");
    return isWhatsAppConversation(conversation) ? whatsAppPlainText(text) : text;
  }

  function conversationPreviewText(value, messageType, conversation) {
    const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
    let last = lines.length - 1;
    while (last >= 0 && !lines[last].trim()) last--;
    const isTemplate = String(messageType || "").trim().toLocaleLowerCase() === "template";
    if (isTemplate && last >= 0 && /^\s*Actions:\s*.+$/i.test(lines[last])) lines.splice(last, 1);
    const text = channelPlainText(lines.join("\n").trim(), conversation);
    const generatedType = generatedMediaPreviewMatch(text);
    if (generatedType) return attachmentPreviewLabel(messageType || generatedType, { type: generatedType });
    return text || attachmentPreviewLabel(messageType);
  }

  function templateMessagePresentation(message, value) {
    let text = String(value || "");
    let buttons = Array.isArray(message?.template?.buttons) ? message.template.buttons : [];
    if (String(message?.messageType || "").toLocaleLowerCase() !== "template") return { text, buttons: [] };
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    let actionIndex = lines.length - 1;
    while (actionIndex >= 0 && !lines[actionIndex].trim()) actionIndex--;
    const fallbackActions = actionIndex >= 0 ? lines[actionIndex].match(/^\s*Actions:\s*(.+?)\s*$/i) : null;
    if (fallbackActions) {
      if (!buttons.length) {
        buttons = fallbackActions[1].split(/\s*,\s*/).map((label) => ({
          text: label.trim().slice(0, 100), type: "quick_reply",
        })).filter((button) => button.text).slice(0, 10);
      }
      lines.splice(actionIndex, 1);
      text = lines.join("\n").replace(/\n+$/, "");
    }
    return { text, buttons };
  }

  function renderTemplateMessageActions(buttons) {
    if (!Array.isArray(buttons) || !buttons.length) return null;
    const actions = element("div", "message-template-actions");
    actions.setAttribute("role", "group");
    actions.setAttribute("aria-label", "Template actions");
    buttons.slice(0, 10).forEach((button) => {
      const label = String(button?.text || button?.label || "").trim().slice(0, 100);
      if (!label) return;
      const action = element("span", "message-template-action", label);
      action.setAttribute("role", "button");
      action.setAttribute("aria-disabled", "true");
      action.dataset.buttonType = String(button?.type || "quick_reply").toLocaleLowerCase().slice(0, 40);
      actions.append(action);
    });
    return actions.childElementCount ? actions : null;
  }

  function messagePlainText(message, conversation) {
    const presentation = templateMessagePresentation(message, messageDisplayText(message));
    const labels = presentation.buttons.map((button) => String(button?.text || button?.label || "").trim()).filter(Boolean);
    return [channelPlainText(presentation.text, messageRoute(message, conversation) || conversation), labels.length ? `Actions: ${labels.join(", ")}` : ""]
      .filter(Boolean).join(". ");
  }

  function stripOutboundSenderAttribution(text, senderName) {
    const name = String(senderName || "").trim();
    let value = String(text || "");
    if (!name || !value) return value;
    const suffixes = [`\n\n— ${name}`, `\n— ${name}`, `\n\n${name}`, `\n${name}`];
    for (const suffix of suffixes) {
      if (value.endsWith(suffix)) return value.slice(0, -suffix.length).trimEnd();
    }
    if (value === name || value === `— ${name}`) return "";
    return value;
  }

  function replyAuthor(reply, conversation = selectedConversation()) {
    if (reply?.direction === "outbound") return "You";
    if (reply?.direction === "inbound") return conversation?.subject || "Customer";
    return "Referenced message";
  }

  function renderQuotedReply(reply, conversation) {
    if (!reply) return null;
    const quote = element("button", `message-quote is-${reply.direction || "inbound"}`);
    quote.type = "button";
    if (reply.messageId) {
      quote.dataset.action = "jump-to-message";
      quote.dataset.messageId = reply.messageId;
    } else quote.disabled = true;
    quote.append(element("strong", "", replyAuthor(reply, conversation)));
    const preview = reply.attachment?.filename || reply.text || `${capitalize(reply.messageType || "message")} message`;
    const presentation = templateMessagePresentation(reply, preview);
    quote.append(appendChannelFormattedText(element("span"), presentation.text, conversation));
    quote.setAttribute("aria-label", `Reply to ${replyAuthor(reply, conversation)}: ${messagePlainText(reply, conversation)}`);
    return quote;
  }

  function canReplyToMessage(conversation, message) {
    if (!conversation || !message?.messageId || !message.channelMessageId) return false;
    const route = messageRoute(message, conversation) || defaultConversationRoute(conversation);
    const connectorType = route?.connectorType || channelFor(route?.channelId).connectorType;
    return ["whatsapp", "whatsapp_cloud", "telegram", "telegram_bot"].includes(connectorType);
  }

  function createMessageRow(message, conversation) {
    const row = element("div", `message-row${message.direction === "outbound" ? " is-outbound" : ""}`);
    row.dataset.messageId = message.messageId;
    row.dataset.messageTimestamp = String(new Date(message.timestamp).getTime() || 0);
    if (canReplyToMessage(conversation, message)) row.dataset.replyable = "true";
    const stack = element("div", "message-stack");
    const bubble = element("div", "message-bubble");
    // Outbound agent/API name comes only from messages.sender_name (API: senderName)
    // and is rendered below the timestamp — never above the bubble or inside body text.
    const outboundSender = message.direction === "outbound" ? String(message.senderName || "").trim() : "";
    const quoted = renderQuotedReply(message.reply, conversation);
    if (quoted) bubble.append(quoted);
    const attachment = renderMessageAttachment(message);
    if (attachment) bubble.append(attachment);
    const visibleText = message.attachment
      ? String(message.attachment.caption || (!/^\[[^\]]+\]$/.test(message.text || "") ? message.text || "" : ""))
      : messageDisplayText(message);
    const presentation = templateMessagePresentation(message, stripOutboundSenderAttribution(visibleText, outboundSender));
    const route = messageRoute(message, conversation) || defaultConversationRoute(conversation);
    if (presentation.text) bubble.append(appendChannelFormattedText(element("p", "message-text"), presentation.text, route || conversation));
    const templateActions = renderTemplateMessageActions(presentation.buttons);
    const foot = element("div", "message-foot");
    foot.append(element("time", "", formatClock(message.timestamp)));
    if (message.direction === "outbound") {
      const delivery = outboundDeliveryStatus(message.status);
      const status = element("span", delivery.className, delivery.label);
      const errorText = String(message.error || "").trim();
      const historyTitle = messageStatusHistoryTitle(message);
      status.title = errorText
        ? (historyTitle ? `${historyTitle}\nFailed: ${errorText}` : `Failed: ${errorText}`)
        : (historyTitle || `Message status: ${delivery.label.replace(/\s*[✓]+$/, "")}`);
      status.setAttribute("aria-label", status.title.replace(/\n/g, "; "));
      const historyEntries = messageStatusHistoryEntries(message);
      if (historyEntries.length) {
        const info = element("button", "message-status-info", "ⓘ");
        info.type = "button";
        info.dataset.action = "toggle-message-status-history";
        info.dataset.messageId = message.messageId;
        info.setAttribute("aria-label", "Message status history");
        info.setAttribute("aria-haspopup", "dialog");
        info.setAttribute("aria-expanded", "false");
        info.title = "Status history";
        foot.append(info);
      }
      foot.append(status);
    }
    bubble.append(foot);
    if (outboundSender) {
      bubble.append(element("p", "message-sender is-outbound-sender", outboundSender));
    }
    const errorText = String(message.error || "").trim();
    if (errorText && ["failed", "error"].includes(String(message.status || "").toLocaleLowerCase())) {
      bubble.append(element("p", "message-error", errorText));
    }
    if (templateActions) bubble.append(templateActions);
    stack.append(bubble);
    if (route) {
      const routeMeta = element("div", "message-route-meta");
      routeMeta.append(providerLogo(route.connectorType, "message-route-logo"));
      routeMeta.append(element("span", "", route.channelName || "Channel"));
      stack.append(routeMeta);
    }
    row.append(stack);
    if (canReplyToMessage(conversation, message)) {
      const replyButton = element("button", "message-reply-button", "↩");
      replyButton.type = "button";
      replyButton.dataset.action = "reply-to-message";
      replyButton.dataset.messageId = message.messageId;
      replyButton.setAttribute("aria-label", `Reply to ${messagePlainText(message, conversation)}`);
      row.append(replyButton);
    }
    return row;
  }

  function messageThreadNearBottom(host = $("messageThread")) {
    return !host || host.scrollHeight - host.scrollTop - host.clientHeight < 90;
  }

  function renderMessageJumpButton() {
    const button = $("messageJumpButton");
    const countHost = $("messageJumpCount");
    const conversationId = state.selectedConversationId || "";
    const count = state.newMessagesBelow.conversationId === conversationId
      ? state.newMessagesBelow.count : 0;
    const show = Boolean(conversationId) && !messageThreadNearBottom();
    button.hidden = !show;
    countHost.hidden = count <= 0;
    countHost.textContent = count > 99 ? "99+" : String(count || "");
    button.setAttribute("aria-label", count > 0
      ? `Jump to latest message, ${count} new message${count === 1 ? "" : "s"}`
      : "Jump to latest message");
  }

  function resetNewMessagesBelow(conversationId = state.selectedConversationId) {
    state.newMessagesBelow = { conversationId: conversationId || "", count: 0 };
    renderMessageJumpButton();
  }

  function clearUnreadMarkerAfterOutbound(message, conversationId) {
    if (message?.direction !== "outbound" || state.unreadMarker?.conversationId !== conversationId) return;
    state.unreadMarker = null;
    $("messageThread").querySelector(".unread-divider")?.remove();
  }

  function upsertRenderedMessage(message, conversationId = message?.conversationId) {
    const conversation = selectedConversation();
    if (!conversation || conversation.conversationId !== conversationId) return false;
    const host = $("messageThread");
    const stayAtBottom = messageThreadNearBottom(host);
    const visibleAnchor = [...host.querySelectorAll(".message-row")]
      .find((row) => row.offsetTop + row.offsetHeight >= host.scrollTop);
    const anchorId = visibleAnchor?.dataset.messageId || "";
    const anchorOffset = visibleAnchor ? visibleAnchor.offsetTop - host.scrollTop : 0;
    host.querySelector(".empty-list")?.remove();
    const existing = host.querySelector(`.message-row[data-message-id="${CSS.escape(message.messageId)}"]`);
    const isNewInbound = !existing && message.direction === "inbound";
    clearUnreadMarkerAfterOutbound(message, conversationId);
    const replacement = createMessageRow(message, conversation);
    if (existing) {
      existing.replaceWith(replacement);
    } else {
      const timestamp = Number(replacement.dataset.messageTimestamp || 0);
      const nextRow = [...host.querySelectorAll(".message-row")]
        .find((row) => Number(row.dataset.messageTimestamp || 0) > timestamp);
      if (nextRow) host.insertBefore(replacement, nextRow);
      else host.append(replacement);
    }
    if (stayAtBottom) {
      host.scrollTop = host.scrollHeight;
      resetNewMessagesBelow(conversationId);
    }
    else if (anchorId) {
      const restoredAnchor = host.querySelector(`.message-row[data-message-id="${CSS.escape(anchorId)}"]`);
      if (restoredAnchor) host.scrollTop = Math.max(0, restoredAnchor.offsetTop - anchorOffset);
    }
    if (!stayAtBottom && isNewInbound) {
      const previousCount = state.newMessagesBelow.conversationId === conversationId
        ? state.newMessagesBelow.count : 0;
      state.newMessagesBelow = { conversationId, count: previousCount + 1 };
    }
    renderMessageJumpButton();
    renderComposerState();
    return true;
  }

  function renderMessages({ preserveScroll = false } = {}) {
    const conversation = selectedConversation();
    if (!conversation) return;
    const host = $("messageThread");
    const stayAtBottom = !preserveScroll || messageThreadNearBottom(host);
    const previousScrollTop = host.scrollTop;
    host.replaceChildren();
    const messages = state.messages.get(conversation.conversationId);
    if (!messages) {
      renderMessageLoading();
      return;
    }
    if (!messages.length) {
      host.append(element("div", "empty-list", "No messages yet. Send the first reply below."));
      renderComposerState();
      resetNewMessagesBelow(conversation.conversationId);
      return;
    }
    const sortedMessages = messages
      .slice()
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const marker = state.unreadMarker?.conversationId === conversation.conversationId ? state.unreadMarker : null;
    const inboundIndexes = marker
      ? sortedMessages.map((message, index) => message.direction === "inbound" ? index : -1).filter((index) => index >= 0)
      : [];
    const unreadStartIndex = marker
      ? marker.count > inboundIndexes.length ? 0 : inboundIndexes[inboundIndexes.length - marker.count]
      : -1;
    sortedMessages.forEach((message, index) => {
      if (index === unreadStartIndex) {
        const label = `${marker.count} unread message${marker.count === 1 ? "" : "s"}`;
        const divider = element("div", "unread-divider", label);
        divider.setAttribute("role", "separator");
        divider.setAttribute("aria-label", label);
        host.append(divider);
      }
      host.append(createMessageRow(message, conversation));
    });
    renderComposerState();
    host.scrollTop = stayAtBottom ? host.scrollHeight : Math.min(previousScrollTop, host.scrollHeight - host.clientHeight);
    if (stayAtBottom) resetNewMessagesBelow(conversation.conversationId);
    else renderMessageJumpButton();
  }

  function isWhatsAppRoute(route) {
    if (!route) return false;
    const connectorType = route.connectorType || channelFor(route.channelId).connectorType;
    return connectorType === "whatsapp" || connectorType === "whatsapp_cloud";
  }

  function isWhatsAppConversation(conversation = selectedConversation()) {
    if (!conversation) return false;
    return isWhatsAppRoute(conversation.conversationId ? selectedComposerRoute(conversation) : conversation);
  }

  function supportsChatAttachments(conversation = selectedConversation()) {
    if (!conversation) return false;
    const route = conversation.conversationId ? selectedComposerRoute(conversation) : conversation;
    const connectorType = route?.connectorType || channelFor(route?.channelId).connectorType;
    return ["whatsapp", "whatsapp_cloud", "telegram", "telegram_bot"].includes(connectorType);
  }

  function currentAttachmentQueue(conversation = selectedConversation()) {
    return conversation ? state.pendingAttachments.get(conversation.conversationId) || [] : [];
  }

  function selectedMessageById(messageId) {
    const conversation = selectedConversation();
    if (!conversation || !messageId) return null;
    return (state.messages.get(conversation.conversationId) || []).find((message) => message.messageId === messageId) || null;
  }

  function renderComposerReply() {
    const host = $("composerReply");
    const conversation = selectedConversation();
    const active = state.replyingTo?.conversationId === conversation?.conversationId
      ? selectedMessageById(state.replyingTo.messageId) || state.replyingTo.message
      : null;
    host.hidden = !active;
    if (!active) return;
    $("composerReplyAuthor").textContent = `Replying to ${active.direction === "outbound" ? "your message" : active.senderName || conversation.subject}`;
    $("composerReplyPreview").textContent = messagePlainText(active, conversation);
  }

  function startReplyToMessage(messageId) {
    const conversation = selectedConversation();
    const message = selectedMessageById(messageId);
    if (!conversation || !message || !canReplyToMessage(conversation, message)) {
      showToast("Reply is unavailable", "This message does not have a reply-compatible channel reference yet.", true);
      return;
    }
    const replyRoute = messageRoute(message, conversation);
    if (isWhatsAppRoute(replyRoute) && !whatsappReplyWindow(conversation, replyRoute).allowed) {
      showToast("Use a WhatsApp template", "A specific-message reply can only be sent inside the 24-hour reply window.", true);
      return;
    }
    state.replyingTo = { conversationId: conversation.conversationId, messageId: message.messageId, message };
    renderComposerState();
    $("messageInput").focus();
  }

  function clearReplyTarget() {
    state.replyingTo = null;
    renderComposerState();
  }

  function jumpToMessage(messageId) {
    const row = [...document.querySelectorAll("#messageThread .message-row")]
      .find((item) => item.dataset.messageId === messageId);
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    row.classList.remove("is-located");
    requestAnimationFrame(() => row.classList.add("is-located"));
    setTimeout(() => row.classList.remove("is-located"), 1400);
  }

  function closeAttachmentPreview() {
    const dialog = $("attachmentPreviewDialog");
    dialog.querySelectorAll("video,audio").forEach((media) => {
      media.pause();
      media.removeAttribute("src");
      media.load();
    });
    $("attachmentPreviewBody").replaceChildren();
    if (dialog.open) dialog.close();
  }

  function openAttachmentPreview(messageId) {
    const message = selectedMessageById(messageId);
    const attachment = message?.attachment;
    const url = messageAttachmentUrl(message);
    if (!message || !attachment || !url) {
      showToast("Preview unavailable", "This attachment is not available from the channel yet.", true);
      return;
    }
    const type = String(attachment.type || message.messageType || "document");
    const filename = attachment.filename || `${capitalize(type)} attachment`;
    const body = $("attachmentPreviewBody");
    body.replaceChildren();
    let media;
    if (type === "image") {
      media = document.createElement("img");
      media.alt = filename;
    } else if (type === "video") {
      media = document.createElement("video");
      media.controls = true;
      media.preload = "metadata";
    } else if (type === "audio") {
      media = document.createElement("audio");
      media.controls = true;
      media.preload = "none";
    }
    if (media) {
      media.className = "attachment-preview-media";
      if (attachment.external === true) media.referrerPolicy = "no-referrer";
      else media.crossOrigin = "use-credentials";
      media.src = url;
      body.append(media);
    } else {
      const documentPreview = element("div", "attachment-document-preview");
      documentPreview.append(element("span", "attachment-document-icon", "DOC"));
      documentPreview.append(element("strong", "", filename));
      documentPreview.append(element("small", "", [attachment.mimeType, attachment.size ? formatFileSize(attachment.size) : ""].filter(Boolean).join(" · ") || "Document"));
      body.append(documentPreview);
    }
    $("attachmentPreviewTitle").textContent = filename;
    const download = $("attachmentPreviewDownload");
    download.href = messageAttachmentUrl(message, true);
    download.download = filename;
    download.referrerPolicy = "no-referrer";
    $("attachmentPreviewDialog").showModal();
  }

  function renderAttachmentQueue() {
    const host = $("attachmentQueue");
    const queue = currentAttachmentQueue();
    host.replaceChildren();
    host.hidden = !queue.length;
    queue.forEach((item) => {
      const card = element("div", "attachment-queue-item");
      if (item.previewUrl && item.file.type.startsWith("image/")) {
        const image = document.createElement("img");
        image.src = item.previewUrl;
        image.alt = "";
        card.append(image);
      } else {
        card.append(element("span", "attachment-queue-icon", item.file.type.startsWith("video/") ? "▶" : item.file.type.startsWith("audio/") ? "♪" : "DOC"));
      }
      const copy = element("span", "attachment-queue-copy");
      copy.append(element("strong", "", item.file.name));
      copy.append(element("small", "", formatFileSize(item.file.size)));
      const remove = element("button", "attachment-queue-remove", "×");
      remove.type = "button";
      remove.dataset.action = "remove-queued-attachment";
      remove.dataset.attachmentId = item.id;
      remove.setAttribute("aria-label", `Remove ${item.file.name}`);
      card.append(copy, remove);
      host.append(card);
    });
  }

  function whatsappReplyWindow(conversation = selectedConversation(), route = selectedComposerRoute(conversation)) {
    if (!isWhatsAppRoute(route)) return { allowed: true, expiresAt: "" };
    if (typeof route?.freeformAllowed === "boolean") {
      return { allowed: route.freeformAllowed, expiresAt: route.replyWindowExpiresAt || "" };
    }
    const messages = state.messages.get(conversation.conversationId);
    if (!messages) return { allowed: true, expiresAt: "" };
    const latestInbound = messages
      .filter((message) => message.direction === "inbound" &&
        conversationRouteKey(messageRoute(message, conversation) || {}) === conversationRouteKey(route))
      .reduce((latest, message) => Math.max(latest, new Date(message.timestamp).getTime() || 0), 0);
    if (!latestInbound) return { allowed: false, expiresAt: "" };
    const expiresAt = new Date(latestInbound + 24 * 60 * 60 * 1000).toISOString();
    return { allowed: Date.now() < new Date(expiresAt).getTime(), expiresAt };
  }

  function replyWindowCountdownText(expiresAt, now = Date.now()) {
    const expiryTime = new Date(expiresAt).getTime();
    if (!Number.isFinite(expiryTime)) return "";
    const seconds = Math.max(0, Math.ceil((expiryTime - Number(now)) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return [hours, minutes, remainder].map((value) => String(value).padStart(2, "0")).join(":");
  }

  function latestInboundWhatsAppReplyWindow(conversation = selectedConversation()) {
    if (!conversation) return null;
    const routes = conversationRoutes(conversation).filter(isWhatsAppRoute);
    const candidates = [];
    routes.forEach((route) => {
      const routeExpiry = new Date(route.replyWindowExpiresAt || "").getTime();
      const routeInbound = new Date(route.lastInboundAt || "").getTime();
      const inboundAt = Number.isFinite(routeInbound)
        ? routeInbound
        : Number.isFinite(routeExpiry) ? routeExpiry - WHATSAPP_REPLY_WINDOW_MS : NaN;
      if (!Number.isFinite(inboundAt)) return;
      const expectedExpiry = inboundAt + WHATSAPP_REPLY_WINDOW_MS;
      const authoritativeExpiry = Number.isFinite(routeExpiry) &&
        (!Number.isFinite(routeInbound) || Math.abs(routeExpiry - expectedExpiry) < 60_000);
      candidates.push({
        inboundAt,
        expiresAt: authoritativeExpiry ? routeExpiry : expectedExpiry,
        routeKey: conversationRouteKey(route),
      });
    });
    (state.messages.get(conversation.conversationId) || []).forEach((message) => {
      if (message.direction !== "inbound") return;
      const route = messageRoute(message, conversation);
      if (!isWhatsAppRoute(route)) return;
      const inboundAt = new Date(message.timestamp || "").getTime();
      if (!Number.isFinite(inboundAt)) return;
      const routeKey = conversationRouteKey(route || {});
      const authoritativeRoute = candidates.find((candidate) => candidate.routeKey === routeKey && candidate.inboundAt >= inboundAt);
      candidates.push({
        inboundAt,
        expiresAt: authoritativeRoute?.expiresAt || inboundAt + WHATSAPP_REPLY_WINDOW_MS,
        routeKey,
      });
    });
    if (!candidates.length) return null;
    return candidates.reduce((latest, candidate) => candidate.inboundAt > latest.inboundAt ? candidate : latest);
  }

  function stopWhatsAppReplyCountdown({ hide = false } = {}) {
    if (whatsappReplyCountdownTimer !== null) {
      clearInterval(whatsappReplyCountdownTimer);
      whatsappReplyCountdownTimer = null;
    }
    whatsappReplyCountdownKey = "";
    if (!hide) return;
    const host = $("whatsappReplyCountdown");
    const textHost = $("whatsappReplyCountdownText");
    host.hidden = true;
    textHost.textContent = "";
    host.removeAttribute("data-expired");
    host.title = "";
  }

  function syncWhatsAppReplyCountdown(conversation = selectedConversation()) {
    const host = $("whatsappReplyCountdown");
    const textHost = $("whatsappReplyCountdownText");
    const windowState = latestInboundWhatsAppReplyWindow(conversation);
    if (!conversation || !windowState) {
      stopWhatsAppReplyCountdown({ hide: true });
      return;
    }
    const key = `${conversation.conversationId}:${windowState.routeKey}:${windowState.expiresAt}`;
    if (key !== whatsappReplyCountdownKey) {
      stopWhatsAppReplyCountdown();
      whatsappReplyCountdownKey = key;
    }
    const update = () => {
      if (state.selectedConversationId !== conversation.conversationId || whatsappReplyCountdownKey !== key) {
        stopWhatsAppReplyCountdown({ hide: true });
        return;
      }
      const remaining = replyWindowCountdownText(windowState.expiresAt);
      const expired = new Date(windowState.expiresAt).getTime() <= Date.now();
      host.hidden = false;
      textHost.textContent = remaining || "00:00:00";
      host.dataset.expired = String(expired);
      host.title = expired ? "WhatsApp reply window expired" : `WhatsApp reply window: ${textHost.textContent} remaining`;
      host.setAttribute("aria-label", host.title);
      if (expired && whatsappReplyCountdownTimer !== null) {
        clearInterval(whatsappReplyCountdownTimer);
        whatsappReplyCountdownTimer = null;
      }
    };
    update();
    if (whatsappReplyCountdownTimer === null && new Date(windowState.expiresAt).getTime() > Date.now()) {
      whatsappReplyCountdownTimer = setInterval(update, 1000);
    }
  }

  function closeComposerRouteMenu({ restoreFocus = false } = {}) {
    const menu = $("composerRouteMenu");
    const button = $("composerRouteButton");
    if (!menu || !button) return;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (restoreFocus) button.focus();
  }

  function toggleComposerRouteMenu() {
    const conversation = selectedConversation();
    const menu = $("composerRouteMenu");
    const button = $("composerRouteButton");
    if (!conversation || !menu || !button || button.disabled) return;
    const opening = menu.hidden;
    menu.hidden = !opening;
    button.setAttribute("aria-expanded", String(opening));
    if (opening) menu.querySelector("button:not(:disabled)")?.focus();
  }

  function chooseComposerRoute(index) {
    const conversation = selectedConversation();
    const route = conversationRoutes(conversation)[Number(index)];
    if (!conversation || !route || !route.enabled) return;
    state.composerRoutes.set(conversation.conversationId, conversationRouteKey(route));
    closeComposerRouteMenu();
    renderComposerState();
  }

  function selectRequestedComposerRoute(conversationId, requestedRoute) {
    const conversation = state.conversations.find((item) => item.conversationId === conversationId);
    if (!conversation || !requestedRoute?.channelId) return false;
    const routes = conversationRoutes(conversation);
    const exact = routes.find((route) => route.channelId === requestedRoute.channelId &&
      (!requestedRoute.identityId || route.identityId === requestedRoute.identityId));
    const selected = exact || routes.find((route) => route.channelId === requestedRoute.channelId);
    if (!selected) return false;
    // A route chosen from a contact is an explicit agent choice. Keep that
    // route selected even when its WhatsApp free-form window is closed; the
    // composer will block text while leaving templates and route switching
    // available instead of silently falling back to another provider.
    state.composerRoutes.set(conversationId, conversationRouteKey(selected));
    if (state.selectedConversationId === conversationId) renderComposerState();
    return true;
  }

  function renderComposerRouteControl(conversation, selectedRoute = selectedComposerRoute(conversation)) {
    const button = $("composerRouteButton");
    const logo = $("composerRouteLogo");
    const name = $("composerRouteName");
    const menu = $("composerRouteMenu");
    if (!button || !logo || !name || !menu) return;
    const routes = conversationRoutes(conversation);
    const replying = state.replyingTo?.conversationId === conversation?.conversationId;
    button.hidden = !conversation || !routes.length;
    button.disabled = !selectedRoute || replying;
    button.title = selectedRoute?.channelName || "Choose sending channel";
    button.setAttribute("aria-label", selectedRoute
      ? `Sending channel: ${selectedRoute.channelName || "Channel"}`
      : "Choose sending channel");
    logo.replaceChildren();
    name.textContent = selectedRoute?.channelName || "";
    if (selectedRoute) {
      logo.append(providerLogo(selectedRoute.connectorType, "composer-route-logo"));
      name.textContent ||= "Channel";
    }
    menu.replaceChildren();
    routes.forEach((route, index) => {
      const option = element("button", "composer-route-option");
      option.type = "button";
      option.role = "menuitem";
      option.dataset.action = "choose-composer-route";
      option.dataset.routeIndex = String(index);
      option.disabled = !route.enabled;
      option.classList.toggle("is-selected", selectedRoute && conversationRouteKey(route) === conversationRouteKey(selectedRoute));
      option.append(providerLogo(route.connectorType, "composer-route-option-logo"));
      const copy = element("span", "composer-route-option-copy");
      copy.append(element("strong", "", route.channelName || "Channel"));
      option.append(copy);
      menu.append(option);
    });
    if (replying) closeComposerRouteMenu();
  }

  function renderComposerState() {
    const conversation = selectedConversation();
    const route = selectedComposerRoute(conversation);
    const whatsapp = isWhatsAppRoute(route);
    const windowState = whatsappReplyWindow(conversation, route);
    const blocked = Boolean(conversation && whatsapp && !windowState.allowed);
    const input = $("messageInput");
    const send = $("sendButton");
    const attach = $("attachmentButton");
    const greeting = document.querySelector('#messageForm [data-action="insert-greeting"]');
    const template = $("templateButton");
    renderComposerReply();
    template.hidden = !whatsapp;
    input.disabled = blocked;
    send.disabled = blocked;
    const attachmentSupported = supportsChatAttachments(conversation);
    attach.disabled = blocked || !attachmentSupported;
    greeting.disabled = blocked;
    input.placeholder = blocked
      ? "The customer has not messaged on WhatsApp in the last 24 hours. You can only send approved WhatsApp message templates"
      : "Message...";
    $("messageForm").classList.toggle("is-window-closed", blocked);
    attach.title = !attachmentSupported ? "Attachments are available for WhatsApp and Telegram conversations"
      : blocked ? "Send an approved template to reopen the conversation" : "Attach files";
    renderComposerRouteControl(conversation, route);
    renderAttachmentQueue();
    syncWhatsAppReplyCountdown(conversation);
  }

  let contactIdentityDraftSequence = 0;

  function identityLabel(platform) {
    return identityPlatforms[platform]?.label || capitalize(String(platform || "Identity"));
  }

  function identityDraft(identity = {}, platform = "whatsapp") {
    const normalized = normalizeContactIdentity({ platform, ...identity }, {}, contactIdentityDraftSequence);
    return {
      ...normalized,
      clientKey: String(identity.clientKey || identity.identityId || `draft-${++contactIdentityDraftSequence}`),
      identityId: String(identity.identityId || ""),
      platform: normalized.platform || platform,
      profileId: normalized.profileId || "",
      username: normalized.username || "",
      phoneNumber: normalized.phoneNumber || "",
      isPrimary: identity.isPrimary === true,
      bindings: normalized.bindings || [],
    };
  }

  function identityHasHistory(identity) {
    if (!identity) return false;
    if (identity.conversationId || identity.lastConversationId || identity.lastInboundAt ||
        identity.lastOutboundAt || identity.lastMessageAt) return true;
    return asItems(identity.bindings || identity.routes).some((binding) =>
      binding.conversationId || binding.lastConversationId || binding.lastInboundAt ||
      binding.lastOutboundAt || binding.lastMessageAt || binding.lastUsedAt);
  }

  function identityRequestPayload(identity) {
    const platform = connectorPlatform(identity.platform) || identity.platform;
    const profileId = String(identity.profileId || identity.channelProfileId || "").trim();
    const bindings = asItems(identity.bindings || identity.routes).map((binding) => ({
      channelId: String(binding.channelId || ""),
      scopedProfileId: String(binding.scopedProfileId || binding.channelProfileId || profileId).trim(),
    })).filter((binding) => binding.channelId);
    const payload = {
      platform,
      profileId,
      channelProfileId: profileId,
      username: String(identity.username || "").trim(),
      // WhatsApp uses one canonical UI value. Keep the legacy phone field in
      // sync for API compatibility while avoiding a second, conflicting input.
      phoneNumber: platform === "whatsapp" ? profileId : String(identity.phoneNumber || "").trim(),
      displayName: String(identity.displayName || "").trim(),
      metadata: identity.metadata && typeof identity.metadata === "object" ? identity.metadata : {},
      isPrimary: identity.isPrimary === true,
      bindings,
    };
    return payload;
  }

  function identityChannels(platform, bindings = []) {
    const matched = state.channels.filter((channel) => connectorPlatform(channel.connectorType) === platform);
    const byId = new Map(matched.map((channel) => [channel.channelId, channel]));
    asItems(bindings).forEach((binding) => {
      if (!binding.channelId || byId.has(binding.channelId)) return;
      byId.set(binding.channelId, {
        channelId: binding.channelId,
        name: binding.channelName || "Unavailable route",
        connectorType: binding.connectorType || platform,
        enabled: false,
        health: "disconnected",
      });
    });
    return [...byId.values()];
  }

  function collectIdentityDrafts(host, fallbackDrafts = []) {
    if (!host) return fallbackDrafts;
    const fallback = new Map(fallbackDrafts.map((draft) => [draft.clientKey, draft]));
    return [...host.querySelectorAll("[data-contact-identity-key]")].map((card) => {
      const clientKey = card.dataset.contactIdentityKey;
      const previous = fallback.get(clientKey) || {};
      const platform = connectorPlatform(card.dataset.platform) || "email";
      const profileId = card.querySelector("[data-identity-profile]")?.value || "";
      const routeProfileInputs = [...card.querySelectorAll("[data-identity-route-profile]")];
      const checkedRoutes = [...card.querySelectorAll("[data-identity-route]:checked")].map((input) => {
        const existing = asItems(previous.bindings).find((binding) => binding.channelId === input.value);
        const channel = channelFor(input.value);
        const scopedProfileId = String(routeProfileInputs.find((field) =>
          field.dataset.identityRouteProfile === input.value)?.value || existing?.scopedProfileId || profileId).trim();
        return normalizeIdentityBinding({
          ...existing,
          channelId: input.value,
          scopedProfileId,
          channelName: channel.name,
          connectorType: channel.connectorType,
          eligible: channel.enabled !== false && channel.health === "connected",
        }, previous);
      });
      return identityDraft({
        ...previous,
        clientKey,
        platform,
        profileId,
        username: card.querySelector("[data-identity-username]")?.value || "",
        displayName: card.querySelector("[data-identity-display-name]")?.value || "",
        phoneNumber: card.querySelector("[data-identity-phone]")?.value || "",
        isPrimary: card.querySelector("[data-identity-primary]")?.checked === true,
        bindings: checkedRoutes,
      }, platform);
    });
  }

  function renderContactIdentityList(host, drafts, mode) {
    if (!host) return;
    host.replaceChildren();
    if (!drafts.length) {
      host.append(element("div", "contact-identities-empty", "No platform identities yet. Add one when you are ready."));
      return;
    }
    drafts.forEach((draft, index) => {
      const persisted = Boolean(draft.identityId);
      const expanded = !persisted;
      const card = element("article", `contact-identity-card${draft.isPrimary ? " is-primary" : ""}${expanded ? " is-expanded" : ""}`);
      card.dataset.contactIdentityKey = draft.clientKey;
      card.dataset.platform = draft.platform;
      const profile = identityPlatforms[draft.platform] || identityPlatforms.email;
      const summary = element("div", "contact-identity-summary");
      const platformBadge = element("span", "contact-identity-platform-badge", profile.label);
      platformBadge.dataset.platform = draft.platform;
      const summaryCopy = element("div", "contact-identity-summary-copy");
      summaryCopy.append(
        element("span", "contact-identity-profile-label", profile.profileLabel),
        element("strong", "contact-identity-profile-value", draft.profileId || "Not entered"),
      );
      summary.append(platformBadge, summaryCopy);

      if (persisted && mode === "edit") {
        const contact = state.contacts.find((item) => item.contactId === state.selectedContactId);
        const routes = contact ? contactPlatformRoutes(contact, draft.platform, draft.identityId) : [];
        const eligibleRoutes = routes.filter((route) => route.eligible);
        const defaultRoute = eligibleRoutes[0] || null;
        const messageSplit = element("div", "identity-message-split");
        const message = element("button", "identity-message-main", "Message");
        message.type = "button";
        message.dataset.action = "open-contact-identity-default";
        message.dataset.contactId = contact?.contactId || "";
        message.dataset.identityId = draft.identityId;
        message.disabled = !defaultRoute;
        message.title = defaultRoute
          ? `Message using ${defaultRoute.channelName || profile.label}`
          : `No available ${profile.label} route`;
        const chooseRoute = element("button", "identity-message-menu", "▾");
        chooseRoute.type = "button";
        chooseRoute.dataset.action = "choose-contact-identity-route";
        chooseRoute.dataset.contactId = contact?.contactId || "";
        chooseRoute.dataset.identityId = draft.identityId;
        chooseRoute.disabled = !eligibleRoutes.length;
        chooseRoute.setAttribute("aria-haspopup", "menu");
        chooseRoute.setAttribute("aria-expanded", "false");
        chooseRoute.setAttribute("aria-label", `Choose ${profile.label} channel`);
        chooseRoute.title = "Choose another connected channel";
        messageSplit.append(message, chooseRoute);
        summary.append(messageSplit);
      }

      const expand = element("button", "identity-expand-button", expanded ? "⌃" : "⌄");
      expand.type = "button";
      expand.dataset.action = "toggle-contact-identity-details";
      expand.setAttribute("aria-expanded", String(expanded));
      expand.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${profile.label} identity details`);
      summary.append(expand);

      const details = element("div", "contact-identity-details");
      details.hidden = !expanded;
      if (!persisted) {
        const head = element("div", "contact-identity-card-head");
        const platforms = element("div", "identity-platform-options");
        Object.entries(identityPlatforms).forEach(([value, optionProfile]) => {
          const button = element("button", `identity-platform-button${draft.platform === value ? " is-selected" : ""}`, optionProfile.label);
          button.type = "button";
          button.dataset.action = "choose-contact-identity-platform";
          button.dataset.identityMode = mode;
          button.dataset.identityKey = draft.clientKey;
          button.dataset.platform = value;
          button.setAttribute("aria-pressed", String(draft.platform === value));
          platforms.append(button);
        });
        const remove = element("button", "identity-remove-button", "×");
        remove.type = "button";
        remove.dataset.action = "remove-contact-identity";
        remove.dataset.identityMode = mode;
        remove.dataset.identityKey = draft.clientKey;
        remove.setAttribute("aria-label", `Remove ${identityLabel(draft.platform)} identity`);
        head.append(platforms, remove);
        details.append(head);
      }

      const fields = element("div", "contact-identity-fields");
      const profileLabel = element("label", "field-label", profile.profileLabel);
      const profileInput = document.createElement("input");
      profileInput.className = "text-field";
      profileInput.value = draft.profileId;
      profileInput.placeholder = profile.profilePlaceholder;
      profileInput.type = draft.platform === "email" ? "email" : "text";
      profileInput.maxLength = 200;
      profileInput.dataset.identityProfile = "";
      profileInput.readOnly = Boolean(draft.identityId);
      if (draft.identityId) {
        profileInput.title = "An existing channel profile ID cannot be changed. Add another identity instead.";
        profileInput.setAttribute("aria-readonly", "true");
      }
      profileLabel.append(profileInput);
      if (draft.identityId) profileLabel.append(element("span", "field-help", "Existing profile IDs are read only."));
      const usernameLabel = element("label", "field-label", "Username");
      const username = document.createElement("input");
      username.className = "text-field";
      username.value = draft.username;
      username.placeholder = "Optional username or handle";
      username.maxLength = 160;
      username.dataset.identityUsername = "";
      usernameLabel.append(username);
      const displayNameLabel = element("label", "field-label", "Display name");
      const displayName = document.createElement("input");
      displayName.className = "text-field";
      displayName.value = draft.displayName || "";
      displayName.placeholder = "Optional platform display name";
      displayName.maxLength = 160;
      displayName.dataset.identityDisplayName = "";
      displayNameLabel.append(displayName);
      if (draft.platform === "whatsapp") profileInput.inputMode = "tel";
      fields.append(profileLabel, usernameLabel, displayNameLabel);
      const routeFieldset = element("fieldset", "identity-route-fieldset");
      routeFieldset.append(element("legend", "", "Connected routes"));
      const routeOptions = element("div", "identity-route-options");
      const boundChannelIds = new Set(asItems(draft.bindings).map((binding) => binding.channelId));
      const availableChannels = identityChannels(draft.platform, draft.bindings).filter((channel) =>
        boundChannelIds.has(channel.channelId) || (channel.enabled !== false && channel.health === "connected"));
      if (!availableChannels.length) {
        routeOptions.append(element("span", "identity-route-empty", draft.platform === "email"
          ? "Email can be saved without a connected messaging route."
          : "No matching channel is connected yet."));
      } else availableChannels.forEach((channel) => {
        const existingBinding = asItems(draft.bindings).find((binding) => binding.channelId === channel.channelId);
        const routeHasHistory = Boolean(existingBinding && (
          existingBinding.conversationId || existingBinding.lastConversationId || existingBinding.lastInboundAt ||
          existingBinding.lastOutboundAt || existingBinding.lastMessageAt
        ));
        const routeRow = element("div", "identity-route-option-row");
        const option = element("label", "identity-route-option");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = channel.channelId;
        checkbox.dataset.identityRoute = "";
        checkbox.checked = asItems(draft.bindings).some((binding) => binding.channelId === channel.channelId);
        checkbox.disabled = routeHasHistory || (!checkbox.checked && (channel.enabled === false || channel.health !== "connected"));
        if (routeHasHistory) {
          checkbox.title = "This route has conversation history and cannot be removed.";
        }
        option.append(checkbox, document.createTextNode(`${channel.name}${channel.enabled === false ? " · unavailable" : ""}`));
        const scopedProfile = document.createElement("input");
        scopedProfile.className = "text-field identity-route-profile";
        scopedProfile.value = String(existingBinding?.scopedProfileId || draft.profileId || "");
        scopedProfile.placeholder = "Channel-scoped profile ID";
        scopedProfile.maxLength = 512;
        scopedProfile.dataset.identityRouteProfile = channel.channelId;
        scopedProfile.setAttribute("aria-label", `${channel.name} scoped profile ID`);
        scopedProfile.disabled = channel.enabled === false || channel.health !== "connected";
        scopedProfile.readOnly = Boolean(existingBinding);
        if (existingBinding) {
          scopedProfile.title = routeHasHistory
            ? "This route has conversation history and its profile ID cannot be changed."
            : "An existing channel route ID cannot be changed. Remove the route and add a new one instead.";
        }
        routeRow.append(option, scopedProfile);
        if (routeHasHistory) {
          routeRow.append(element("span", "field-help", "Used by conversation history · locked"));
        }
        routeOptions.append(routeRow);
      });
      routeFieldset.append(routeOptions);
      fields.append(routeFieldset);
      const primary = element("label", "identity-primary-control");
      const primaryInput = document.createElement("input");
      primaryInput.type = "radio";
      primaryInput.name = `${mode}-primary-contact-identity`;
      primaryInput.dataset.identityPrimary = "";
      primaryInput.checked = draft.isPrimary || (!drafts.some((item) => item.isPrimary) && index === 0);
      primary.append(primaryInput, document.createTextNode("Primary identity"));
      fields.append(primary);
      details.append(fields);
      card.append(summary, details);
      host.append(card);
    });
  }

  function collectContactPlatformIds(host) {
    const ids = Object.fromEntries(Object.keys(identityPlatforms).map((platform) => [platform, ""]));
    host?.querySelectorAll("[data-contact-platform-id]").forEach((input) => {
      const platform = connectorPlatform(input.dataset.contactPlatformId);
      if (platform) ids[platform] = String(input.value || "").trim();
    });
    return ids;
  }

  function validateContactPlatformIds(ids) {
    const normalized = Object.fromEntries(Object.keys(identityPlatforms).map((platform) => [
      platform,
      String(ids?.[platform] || "").trim(),
    ]));
    if (!Object.values(normalized).some(Boolean)) {
      throw new Error("Enter at least one WhatsApp, Telegram, Instagram, Facebook or Email ID.");
    }
    return normalized;
  }

  function visibleContactPlatformIdDraft(host) {
    const ids = {};
    host?.querySelectorAll("[data-contact-platform-id]").forEach((input) => {
      const platform = connectorPlatform(input.dataset.contactPlatformId);
      if (platform) ids[platform] = String(input.value || "");
    });
    return ids;
  }

  function missingContactPlatforms() {
    const visible = new Set($("contactEditPlatformIds")?.querySelectorAll("[data-contact-platform-id]") || []);
    const shownPlatforms = new Set([...visible].map((input) => connectorPlatform(input.dataset.contactPlatformId)).filter(Boolean));
    return Object.entries(identityPlatforms).filter(([platform]) => !shownPlatforms.has(platform));
  }

  function refreshContactPlatformAddControl() {
    const control = $("contactEditPlatformAdd");
    const button = $("contactEditPlatformAddButton");
    if (!control || !button) return;
    const missing = missingContactPlatforms();
    control.hidden = !missing.length;
    button.toggleAttribute("disabled", !missing.length);
    if (!missing.length) closeContactPlatformMenu();
  }

  function renderContactPlatformIdFields(host, contact = null, mode = "create", options = {}) {
    if (!host) return;
    host.replaceChildren();
    const ids = { ...contactPlatformIds(contact || {}), ...(options.draftIds || {}) };
    const visiblePlatforms = new Set(options.visiblePlatforms || []);
    Object.entries(identityPlatforms).filter(([platform]) =>
      mode !== "edit" || Boolean(ids[platform]) || visiblePlatforms.has(platform)).forEach(([platform, profile]) => {
      const value = ids[platform] || "";
      const identity = asItems(contact?.identities).find((item) => item.platform === platform) || null;
      const locked = Boolean(identity && value && identityHasHistory(identity));
      const row = element("div", "contact-platform-id-row");
      const badge = element("span", "contact-identity-platform-badge", profile.label);
      badge.dataset.platform = platform;
      const label = element("label", "field-label contact-platform-id-field", profile.profileLabel);
      const input = document.createElement("input");
      input.className = "text-field";
      input.type = platform === "email" ? "email" : "text";
      input.inputMode = platform === "whatsapp" ? "tel" : platform === "email" ? "email" : "text";
      input.maxLength = 200;
      input.placeholder = profile.profilePlaceholder;
      input.value = value;
      input.dataset.contactPlatformId = platform;
      input.autocomplete = platform === "email" ? "email" : "off";
      input.readOnly = locked;
      if (locked) {
        input.title = "This ID is used by conversation history and cannot be changed.";
        input.setAttribute("aria-readonly", "true");
      }
      label.append(input);
      if (locked) label.append(element("span", "field-help", "Used by conversation history · locked"));
      row.append(badge, label);

      if (mode === "edit" && contact && identity && value) {
        const routes = contactPlatformRoutes(contact, platform, identity.identityId);
        const eligibleRoutes = routes.filter((route) => route.eligible);
        const defaultRoute = eligibleRoutes[0] || null;
        const actions = element("div", "identity-message-split");
        const message = element("button", "identity-message-main", "Message");
        message.type = "button";
        message.dataset.action = "open-contact-identity-default";
        message.dataset.contactId = contact.contactId;
        message.dataset.identityId = identity.identityId;
        message.disabled = !defaultRoute;
        message.title = defaultRoute
          ? `Message using ${defaultRoute.channelName || profile.label}`
          : `No available ${profile.label} route`;
        const choose = element("button", "identity-message-menu", "▾");
        choose.type = "button";
        choose.dataset.action = "choose-contact-identity-route";
        choose.dataset.contactId = contact.contactId;
        choose.dataset.identityId = identity.identityId;
        choose.disabled = !eligibleRoutes.length;
        choose.setAttribute("aria-haspopup", "menu");
        choose.setAttribute("aria-expanded", "false");
        choose.setAttribute("aria-label", `Choose ${profile.label} channel`);
        choose.title = "Choose another connected channel";
        actions.append(message, choose);
        row.append(actions);
      } else {
        row.append(element("span", "contact-platform-id-action-spacer", ""));
      }
      host.append(row);
    });
    if (mode === "edit") refreshContactPlatformAddControl();
  }

  function addContactPlatformId(value) {
    const platform = connectorPlatform(value);
    const host = $("contactEditPlatformIds");
    const contact = state.contacts.find((item) => item.contactId === state.selectedContactId);
    if (!platform || !host || !contact) return;
    closeContactPlatformMenu();
    const visiblePlatforms = [...host.querySelectorAll("[data-contact-platform-id]")]
      .map((input) => connectorPlatform(input.dataset.contactPlatformId)).filter(Boolean);
    if (visiblePlatforms.includes(platform)) return;
    const draftIds = visibleContactPlatformIdDraft(host);
    visiblePlatforms.push(platform);
    renderContactPlatformIdFields(host, normalizeContact(contact), "edit", { visiblePlatforms, draftIds });
    host.querySelector(`[data-contact-platform-id="${CSS.escape(platform)}"]`)?.focus();
  }

  function contactIdentityDraftContext(mode) {
    const createMode = mode === "create";
    return {
      host: $(createMode ? "contactCreateIdentities" : "contactEditIdentities"),
      drafts: createMode ? state.contactCreateIdentityDrafts : state.contactEditIdentityDrafts,
      set(next) {
        if (createMode) state.contactCreateIdentityDrafts = next;
        else state.contactEditIdentityDrafts = next;
      },
    };
  }

  function refreshContactIdentityDrafts(mode, mutate) {
    const context = contactIdentityDraftContext(mode);
    let drafts = collectIdentityDrafts(context.host, context.drafts);
    drafts = mutate(drafts) || drafts;
    if (drafts.length && !drafts.some((draft) => draft.isPrimary)) drafts[0].isPrimary = true;
    context.set(drafts);
    renderContactIdentityList(context.host, drafts, mode);
  }

  function contactSearchText(contact) {
    const identities = contact.identities.flatMap((identity) => [
      identity.platform, identityLabel(identity.platform), identity.profileId,
      ...identity.bindings.flatMap((binding) => [binding.channelId, binding.channelName, binding.scopedProfileId]),
    ]);
    return [contact.displayName, contact.company, ...contact.tags, ...Object.values(contactPlatformIds(contact)), ...identities]
      .join(" ").toLocaleLowerCase();
  }

  function contactLastActive(contact) {
    const values = [
      ...state.conversations.filter((conversation) => conversation.contactId === contact.contactId).map((conversation) => conversation.lastMessageAt),
      ...contact.identities.flatMap((identity) => [identity.lastMessageAt, ...identity.bindings.map((binding) => binding.lastUsedAt)]),
    ].filter(Boolean).map((value) => new Date(value)).filter((value) => !Number.isNaN(value.getTime()));
    return values.sort((a, b) => b - a)[0]?.toISOString() || "";
  }

  function renderContacts() {
    const search = state.contactSearch.trim().toLocaleLowerCase();
    const contacts = state.contacts.filter((contact) => contactSearchText(contact).includes(search));
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
      const count = contact.identities.length;
      copy.append(
        element("strong", "", contact.displayName),
        element("span", "contact-count-copy", `${count} messaging ID${count === 1 ? "" : "s"}`),
      );
      identity.append(avatar, copy);
      identityCell.append(identity);
      row.append(identityCell);

      row.append(tableCell(contact.company || "—"));

      const tagCell = document.createElement("td");
      const tagWrap = element("div", "tag-list");
      (contact.tags.length ? contact.tags.slice(0, 2) : ["—"]).forEach((tag) => tagWrap.append(element("span", "tag", tag)));
      tagCell.append(tagWrap);
      row.append(tagCell);

      const lastActive = contactLastActive(contact);
      row.append(tableCell(lastActive ? relativeTime(lastActive) : "—"));
      const statusCell = document.createElement("td");
      statusCell.append(element("span", `status-chip${contact.status === "inactive" ? " is-inactive" : ""}`, contact.status === "inactive" ? "Inactive" : "Active"));
      row.append(statusCell);
      tbody.append(row);
    });
  }

  function contactPlatformRoutes(contact, platform, identityId = "") {
    const routes = [];
    contact.identities.filter((identity) => identity.platform === platform && (!identityId || identity.identityId === identityId)).forEach((identity) => {
      if (platform === "email" && identity.profileId) {
        routes.push({
          key: `email:${identity.identityId}`,
          contactId: contact.contactId,
          identityId: identity.identityId,
          platform,
          profileId: identity.profileId,
          scopedProfileId: identity.profileId,
          channelId: "",
          channelName: identity.username || identity.profileId,
          connectorType: "email",
          conversationId: "",
          lastUsedAt: identity.lastMessageAt || "",
          eligible: true,
          kind: "email",
          isBound: true,
        });
        return;
      }
      const bindingByChannel = new Map(identity.bindings.map((binding) => [binding.channelId, binding]));
      // Keep saved routes, including unavailable historical routes, and also
      // offer every connected account for this provider. The server creates
      // the exact identity/channel binding when a new route is first used.
      const compatible = identityChannels(platform, identity.bindings).filter((channel) =>
        bindingByChannel.has(channel.channelId) ||
        (channel.enabled !== false && channel.health === "connected"));
      compatible.forEach((channel) => {
        const binding = bindingByChannel.get(channel.channelId) || null;
        const conversation = state.conversations.find((item) => item.contactId === contact.contactId &&
          ((item.contactIdentityId && item.contactIdentityId === identity.identityId && item.channelId === channel.channelId) ||
            (binding?.conversationId && item.conversationId === binding.conversationId))) ||
          state.conversations.find((item) => item.contactId === contact.contactId && !item.contactIdentityId &&
            item.channelId === channel.channelId && (!item.channelProfileId || item.channelProfileId === identity.profileId));
        routes.push({
          key: `${identity.identityId}:${channel.channelId}`,
          contactId: contact.contactId,
          identityId: identity.identityId,
          platform,
          profileId: identity.profileId,
          scopedProfileId: binding?.scopedProfileId || identity.profileId,
          username: identity.username,
          channelId: channel.channelId,
          channelName: binding?.channelName || channel.name,
          connectorType: binding?.connectorType || channel.connectorType,
          conversationId: conversation?.conversationId || binding?.conversationId || "",
          conversationStatus: conversation?.status || binding?.conversationStatus || "",
          lastUsedAt: conversation?.lastMessageAt || binding?.lastUsedAt || "",
          eligible: Boolean(conversation) || (binding?.eligible !== false && channel.enabled !== false && channel.health === "connected"),
          isBound: Boolean(binding),
          kind: "conversation",
        });
      });
    });
    const latest = routes.filter((route) => route.lastUsedAt).sort((a, b) => new Date(b.lastUsedAt) - new Date(a.lastUsedAt))[0];
    return routes.map((route) => ({ ...route, isLastUsed: Boolean(latest && latest.key === route.key) }))
      .sort((a, b) => Number(b.isLastUsed) - Number(a.isLastUsed) || Number(b.eligible) - Number(a.eligible) ||
        Number(b.isBound) - Number(a.isBound) ||
        new Date(b.lastUsedAt || 0) - new Date(a.lastUsedAt || 0));
  }

  async function openContactRoute(route) {
    if (!route?.eligible) return;
    closeContactRouteMenu();
    if (route.kind === "email") {
      window.location.href = `mailto:${encodeURIComponent(route.profileId)}`;
      return;
    }
    if (route.conversationId && state.conversations.some((conversation) => conversation.conversationId === route.conversationId)) {
      setRoute("inbox");
      await selectConversation(route.conversationId);
      selectRequestedComposerRoute(route.conversationId, route);
      return;
    }
    try {
      const result = await state.api.startContactConversation(route.contactId, route.identityId,
        route.channelId ? { channelId: route.channelId } : {});
      const conversationId = String(result.conversationId || result.item?.conversationId || "");
      await loadAll({ preserveSelection: false });
      setRoute("inbox");
      if (conversationId) {
        await selectConversation(conversationId);
        selectRequestedComposerRoute(conversationId, route);
      }
    } catch (error) {
      showToast("Conversation could not be opened", error.message, true);
    }
  }

  function closeContactRouteMenu({ restoreFocus = false } = {}) {
    const current = state.contactRouteMenu;
    if (!current) return;
    current.trigger?.setAttribute("aria-expanded", "false");
    current.trigger?.removeAttribute("aria-controls");
    current.menu?.remove();
    state.contactRouteMenu = null;
    if (restoreFocus && current.trigger?.isConnected) current.trigger.focus();
  }

  function positionAnchoredContactMenu(current, closeMenu) {
    if (!current?.trigger?.isConnected || !current?.menu?.isConnected) {
      closeMenu();
      return;
    }
    const triggerRect = current.trigger.getBoundingClientRect();
    if (triggerRect.bottom < 0 || triggerRect.top > window.innerHeight ||
        triggerRect.right < 0 || triggerRect.left > window.innerWidth) {
      closeMenu();
      return;
    }
    const edge = 8;
    const gap = 6;
    const width = Math.max(1, Math.min(340, window.innerWidth - (edge * 2)));
    current.menu.style.width = `${width}px`;
    current.menu.style.left = `${Math.min(Math.max(edge, triggerRect.right - width), window.innerWidth - width - edge)}px`;
    current.menu.style.top = `${triggerRect.bottom + gap}px`;
    current.menu.style.visibility = "hidden";
    const menuHeight = current.menu.getBoundingClientRect().height;
    const below = window.innerHeight - triggerRect.bottom - gap - edge;
    const above = triggerRect.top - gap - edge;
    const top = below < Math.min(menuHeight, 220) && above > below
      ? Math.max(edge, triggerRect.top - Math.min(menuHeight, above) - gap)
      : Math.min(triggerRect.bottom + gap, window.innerHeight - Math.min(menuHeight, window.innerHeight - (edge * 2)) - edge);
    current.menu.style.top = `${Math.max(edge, top)}px`;
    current.menu.style.visibility = "visible";
  }

  function positionContactRouteMenu() {
    positionAnchoredContactMenu(state.contactRouteMenu, closeContactRouteMenu);
  }

  function focusAnchoredMenuOption(menu, direction) {
    const options = [...menu.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    if (!options.length) return;
    const currentIndex = options.indexOf(document.activeElement);
    let nextIndex;
    if (direction === "first") nextIndex = 0;
    else if (direction === "last") nextIndex = options.length - 1;
    else if (direction > 0) nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % options.length;
    else nextIndex = currentIndex < 0 ? options.length - 1 : (currentIndex - 1 + options.length) % options.length;
    options[nextIndex].focus();
  }

  function showContactRouteMenu(trigger, contact, platform, routes) {
    if (state.contactRouteMenu?.trigger === trigger) {
      closeContactRouteMenu({ restoreFocus: true });
      return;
    }
    closeContactRouteMenu();
    closeContactPlatformMenu();
    const menu = element("section", "contact-route-menu");
    const menuId = `contact-route-menu-${String(contact.contactId).replace(/[^a-z0-9_-]/gi, "-")}-${String(Date.now())}`;
    menu.id = menuId;
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", `Choose ${identityLabel(platform)} channel for ${contact.displayName}`);
    menu.append(element("div", "contact-route-menu-title", `Choose ${identityLabel(platform)} channel`));
    const defaultRoute = routes.find((route) => route.eligible) || null;
    routes.forEach((route, index) => {
      const button = element("button", "contact-route-menu-option");
      button.type = "button";
      button.dataset.action = "choose-contact-route";
      button.dataset.routeIndex = String(index);
      button.setAttribute("role", "menuitem");
      button.disabled = !route.eligible;
      const logo = element("span", "contact-route-menu-logo");
      logo.append(providerLogo(route.connectorType, "contact-route-provider-logo"));
      const copy = element("span", "contact-route-menu-copy");
      copy.append(
        element("strong", "", route.channelName || identityLabel(platform)),
        element("span", "contact-route-menu-profile", route.scopedProfileId || route.profileId || "No profile ID"),
      );
      if (route.lastUsedAt) copy.append(element("span", "contact-route-menu-used", `Last used ${relativeTime(route.lastUsedAt)}`));
      const isDefault = defaultRoute?.key === route.key;
      const statusText = !route.eligible ? "Unavailable"
        : isDefault && route.isLastUsed ? "Default · Last used"
          : isDefault ? "Default"
            : route.isBound ? "Available" : "New";
      const status = element("span", `contact-route-state${isDefault ? " is-default" : ""}${route.isLastUsed ? " is-last-used" : ""}`, statusText);
      button.append(logo, copy, status);
      menu.append(button);
    });
    menu.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        focusAnchoredMenuOption(menu, event.key === "ArrowDown" ? 1 : -1);
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        focusAnchoredMenuOption(menu, event.key === "Home" ? "first" : "last");
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeContactRouteMenu({ restoreFocus: true });
      } else if (event.key === "Tab") {
        setTimeout(() => {
          if (state.contactRouteMenu?.menu === menu && !menu.contains(document.activeElement)) closeContactRouteMenu();
        }, 0);
      }
    });
    document.body.append(menu);
    trigger.setAttribute("aria-expanded", "true");
    trigger.setAttribute("aria-controls", menuId);
    state.contactRouteMenu = { trigger, menu, routes, contactId: contact.contactId, platform };
    positionContactRouteMenu();
    focusAnchoredMenuOption(menu, "first");
  }

  function closeContactPlatformMenu({ restoreFocus = false } = {}) {
    const current = state.contactPlatformMenu;
    if (!current) return;
    current.trigger?.setAttribute("aria-expanded", "false");
    current.trigger?.removeAttribute("aria-controls");
    current.menu?.remove();
    state.contactPlatformMenu = null;
    if (restoreFocus && current.trigger?.isConnected) current.trigger.focus();
  }

  function positionContactPlatformMenu() {
    positionAnchoredContactMenu(state.contactPlatformMenu, closeContactPlatformMenu);
  }

  function platformConnectorType(platform) {
    if (platform === "whatsapp") return "whatsapp_cloud";
    return platform;
  }

  function showContactPlatformMenu(trigger) {
    if (state.contactPlatformMenu?.trigger === trigger) {
      closeContactPlatformMenu({ restoreFocus: true });
      return;
    }
    const missing = missingContactPlatforms();
    if (!missing.length) return;
    closeContactPlatformMenu();
    closeContactRouteMenu();
    const menu = element("section", "contact-route-menu contact-platform-menu");
    const menuId = `contact-platform-menu-${String(Date.now())}`;
    menu.id = menuId;
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Add a platform ID");
    menu.append(element("div", "contact-route-menu-title", "Add platform ID"));
    missing.forEach(([platform, profile]) => {
      const button = element("button", "contact-route-menu-option contact-platform-menu-option");
      button.type = "button";
      button.dataset.action = "choose-contact-platform-id";
      button.dataset.platform = platform;
      button.setAttribute("role", "menuitem");
      const logo = element("span", "contact-route-menu-logo");
      logo.append(providerLogo(platformConnectorType(platform), "contact-route-provider-logo"));
      const copy = element("span", "contact-route-menu-copy");
      copy.append(
        element("strong", "", profile.label),
        element("span", "contact-route-menu-profile", profile.profileLabel),
      );
      button.append(logo, copy, element("span", "contact-platform-menu-add", "+"));
      menu.append(button);
    });
    menu.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        focusAnchoredMenuOption(menu, event.key === "ArrowDown" ? 1 : -1);
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        focusAnchoredMenuOption(menu, event.key === "Home" ? "first" : "last");
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeContactPlatformMenu({ restoreFocus: true });
      } else if (event.key === "Tab") {
        setTimeout(() => {
          if (state.contactPlatformMenu?.menu === menu && !menu.contains(document.activeElement)) closeContactPlatformMenu();
        }, 0);
      }
    });
    document.body.append(menu);
    trigger.setAttribute("aria-expanded", "true");
    trigger.setAttribute("aria-controls", menuId);
    state.contactPlatformMenu = { trigger, menu };
    positionContactPlatformMenu();
    focusAnchoredMenuOption(menu, "first");
  }

  function contactIdentityRouteContext(contactId, identityId) {
    const contact = state.contacts.find((item) => item.contactId === contactId);
    const identity = contact?.identities.find((item) => item.identityId === identityId);
    if (!contact || !identity) return null;
    return {
      contact,
      identity,
      routes: contactPlatformRoutes(contact, identity.platform, identity.identityId),
    };
  }

  function openContactIdentityDefault(contactId, identityId) {
    const context = contactIdentityRouteContext(contactId, identityId);
    if (!context) return;
    const route = context.routes.find((item) => item.eligible);
    if (!route) {
      showToast("No available route", `Connect a ${identityLabel(context.identity.platform)} channel before starting this conversation.`, true);
      return;
    }
    openContactRoute(route);
  }

  function chooseContactIdentityRoute(contactId, identityId, trigger) {
    const context = contactIdentityRouteContext(contactId, identityId);
    if (!context || !trigger) return;
    const eligibleRoutes = context.routes.filter((route) => route.eligible);
    if (!eligibleRoutes.length) {
      showToast("No available route", `Connect a ${identityLabel(context.identity.platform)} channel before starting this conversation.`, true);
      return;
    }
    showContactRouteMenu(trigger, context.contact, context.identity.platform, eligibleRoutes);
  }

  function showContactEditor(contact, { loading = false, error = "" } = {}) {
    closeContactRouteMenu();
    closeContactPlatformMenu();
    const panel = $("contactEditor");
    const fields = $("contactEditorFields");
    const actions = $("contactEditorActions");
    panel.hidden = false;
    $("contactsWorkspace").classList.add("has-editor");
    $("contactEditorStatus").hidden = Boolean(contact) && !loading && !error;
    $("contactEditorStatus").textContent = loading ? "Loading contact details…" : error || "Choose a contact to view the details.";
    fields.hidden = !contact || loading || Boolean(error);
    actions.hidden = fields.hidden;
    $("contactDeleteButton").hidden = !canAdmin();
    if (!contact || fields.hidden) return;
    const normalized = normalizeContact(contact);
    $("contactEditorTitle").textContent = normalized.displayName;
    $("contactEditId").value = normalized.contactId;
    $("contactEditName").value = normalized.displayName;
    $("contactEditCompany").value = normalized.company;
    $("contactEditTags").value = normalized.tags.join(", ");
    renderContactPlatformIdFields($("contactEditPlatformIds"), normalized, "edit");
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
    closeContactRouteMenu();
    closeContactPlatformMenu();
    state.selectedContactId = null;
    $("contactsWorkspace").classList.remove("has-editor");
    $("contactEditor").hidden = true;
    $("contactEditForm").reset();
    $("contactEditorTitle").textContent = "Edit contact";
    $("contactEditPlatformIds").replaceChildren();
    refreshContactPlatformAddControl();
    renderContacts();
  }

  function validateContactIdentities(drafts) {
    const normalized = drafts.map((draft) => {
      const profileId = String(draft.profileId || (draft.platform === "whatsapp" ? draft.phoneNumber : "")).trim();
      return { ...draft, profileId };
    });
    const missing = normalized.find((identity) => !identity.profileId);
    if (missing) {
      const label = identityPlatforms[missing.platform]?.profileLabel || `${identityLabel(missing.platform)} Profile ID`;
      throw new Error(`${label} is required.`);
    }
    const keys = normalized.map((identity) => `${identity.platform}:${identity.profileId.toLocaleLowerCase()}`);
    if (new Set(keys).size !== keys.length) throw new Error("The same platform identity was added more than once.");
    if (normalized.length && !normalized.some((identity) => identity.isPrimary)) normalized[0].isPrimary = true;
    return normalized;
  }

  function identityPayloadChanged(previous, next) {
    const compact = (identity) => JSON.stringify(identityRequestPayload(identity));
    return compact(previous) !== compact(next);
  }

  async function syncContactIdentities(contact, drafts) {
    const previousById = new Map(contact.identities.filter((identity) => identity.identityId).map((identity) => [identity.identityId, identity]));
    const retained = new Set();
    for (const draft of drafts) {
      const previous = draft.identityId ? previousById.get(draft.identityId) : null;
      const payload = identityRequestPayload(draft);
      if (!previous || draft.identityId.startsWith("legacy:")) {
        if (!previous || identityPayloadChanged(previous, draft)) await state.api.createContactIdentity(contact.contactId, payload);
      } else {
        retained.add(draft.identityId);
        if (identityPayloadChanged(previous, draft)) await state.api.updateContactIdentity(contact.contactId, draft.identityId, payload);
      }
    }
    for (const identity of contact.identities) {
      if (!identity.identityId || identity.identityId.startsWith("legacy:") || retained.has(identity.identityId)) continue;
      if (!drafts.some((draft) => draft.identityId === identity.identityId)) {
        await state.api.deleteContactIdentity(contact.contactId, identity.identityId);
      }
    }
  }

  async function saveContactEdits(form) {
    const data = new FormData(form);
    const contactId = String(data.get("contactId") || "");
    const payload = {
      displayName: String(data.get("displayName") || "").trim(),
      company: String(data.get("company") || "").trim(),
      tags: String(data.get("tags") || "").split(/[,\n]/).map((tag) => tag.trim()).filter(Boolean),
    };
    if (!contactId || !payload.displayName) {
      form.reportValidity();
      return;
    }
    const current = state.contacts.find((contact) => contact.contactId === contactId);
    if (!current) return;
    let platformIds;
    try {
      platformIds = validateContactPlatformIds(collectContactPlatformIds($("contactEditPlatformIds")));
    } catch (error) {
      showToast("Contact was not saved", error.message, true);
      return;
    }
    const submit = $("contactEditSubmit");
    submit.disabled = true;
    submit.textContent = "Saving…";
    try {
      payload.platformIds = platformIds;
      await state.api.updateContact(contactId, payload);
      const refreshed = await state.api.getContact(contactId);
      const updated = normalizeContact(refreshed.item || refreshed || { contactId, ...payload });
      const index = state.contacts.findIndex((contact) => contact.contactId === contactId);
      if (index >= 0) state.contacts[index] = { ...state.contacts[index], ...updated };
      state.conversations.filter((conversation) => conversation.contactId === contactId).forEach((conversation) => {
        conversation.subject = updated.displayName;
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

  async function deleteSelectedContact() {
    const contactId = String(state.selectedContactId || "");
    const contact = state.contacts.find((item) => item.contactId === contactId);
    if (!canAdmin() || !contact) return;
    const relatedConversations = state.conversations.filter((conversation) => conversation.contactId === contactId);
    const confirmed = await requestConfirmation({
      title: `Delete ${contact.displayName}?`,
      message: "This permanently deletes the contact from Helixcer, including every conversation and message stored for this contact.",
      note: "This does not block or delete the customer on the original messaging provider.",
      confirmLabel: "Delete contact",
    });
    if (!confirmed) return;
    try {
      await state.api.deleteContact(contactId);
      const conversationIds = new Set(relatedConversations.map((conversation) => conversation.conversationId));
      conversationIds.forEach((conversationId) => {
        state.messages.delete(conversationId);
        state.conversationRevisions.delete(conversationId);
      });
      state.contacts = state.contacts.filter((item) => item.contactId !== contactId);
      state.conversations = state.conversations.filter((conversation) => !conversationIds.has(conversation.conversationId));
      if (conversationIds.has(state.selectedConversationId)) clearSelectedConversation();
      closeContactEditor();
      renderCounts();
      renderChannels();
      renderConversationList();
      showToast("Contact deleted", `${contact.displayName} and their Helixcer history were removed.`);
    } catch (error) {
      showToast("Contact was not deleted", error.message, true);
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
      if (state.route === "import-chat") renderImportChatPage();
      return;
    }
    channels.forEach((channel) => grid.append(renderChannelCard(channel)));
    if (state.route === "import-chat") renderImportChatPage();
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
    const providerDisplayName = channel.setup?.verifiedName || channel.setup?.verifiedUsername || "Not available yet";
    const connectionName = element("div", "channel-identity-line channel-connection-name");
    connectionName.append(element("span", "channel-identity-field-label", "Connection name"), element("h3", "", channel.name));
    const providerName = element("div", "channel-identity-line channel-provider-display-name");
    providerName.append(
      element("span", "channel-identity-field-label", "Provider display name"),
      element("strong", "channel-identity-field-value", providerDisplayName)
    );
    name.append(
      element("span", "provider-label", profile.label),
      connectionName,
      providerName,
      element("span", `health-dot${health.className ? ` ${health.className}` : ""}`, health.label)
    );
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

    const channelIdBlock = element("div", "callback-block channel-id-block");
    channelIdBlock.append(element("span", "callback-label", "Channel ID"));
    const channelIdRow = element("div", "meta-callback-row");
    channelIdRow.append(element("code", "channel-callback", channel.channelId));
    const copyChannelId = element("button", "secondary-button compact-button", "Copy ID");
    copyChannelId.type = "button";
    copyChannelId.setAttribute("aria-label", "Copy Channel ID");
    copyChannelId.title = "Copy Channel ID";
    copyChannelId.dataset.action = "copy-channel-id";
    copyChannelId.dataset.copyValue = channel.channelId;
    channelIdRow.append(copyChannelId);
    channelIdBlock.append(channelIdRow);
    setup.append(channelIdBlock);

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

  function normalizeWhatsAppTemplate(raw, index) {
    const channelId = String(raw?.channelId || "").trim();
    const channel = state.channels.find((item) => item.channelId === channelId);
    const languageCode = String(raw?.language?.code || raw?.language || "Unknown").trim() || "Unknown";
    return {
      ...raw,
      channelId,
      channelName: String(raw?.channelName || channel?.name || "WhatsApp channel").trim(),
      channelEnabled: raw?.channelEnabled !== false,
      providerDisplayName: String(raw?.providerDisplayName || channel?.setup?.verifiedName || "").trim(),
      templateId: String(raw?.templateId || raw?.id || `${channelId || "channel"}-${index}`).trim(),
      name: String(raw?.name || "Untitled template").trim(),
      languageCode,
      category: String(raw?.category || "UNCATEGORIZED").trim().toUpperCase(),
      status: String(raw?.status || "UNKNOWN").trim().toUpperCase(),
      components: asItems(raw?.components),
      variables: asItems(raw?.variables),
    };
  }

  function templateLibraryComponent(template, type) {
    return template.components.find((component) => String(component?.type || "").toUpperCase() === type) || null;
  }

  function templateLibraryButtons(template) {
    return asItems(templateLibraryComponent(template, "BUTTONS")?.buttons);
  }

  function templateLibrarySearchText(template) {
    const componentText = template.components.flatMap((component) => [
      component?.text,
      component?.format,
      ...asItems(component?.buttons).flatMap((button) => [button?.text, button?.type, button?.url]),
    ]);
    return [template.name, template.templateId, template.channelName, template.providerDisplayName,
      template.category, template.status, template.languageCode, ...componentText]
      .filter(Boolean).join(" ").toLocaleLowerCase();
  }

  function templateFilterValue(template, type) {
    if (type === "channel") return template.channelId;
    if (type === "language") return template.languageCode;
    return String(template[type] || "");
  }

  function templateFilterLabel(type, value) {
    if (type === "channel") {
      const template = state.whatsappTemplates.find((item) => item.channelId === value);
      const configured = asItems(state.whatsappTemplateFilterOptions?.channels)
        .find((item) => String(item?.value || item?.channelId || item) === value);
      const label = String(configured?.label || configured?.channelName || template?.channelName || value);
      const providerDisplayName = String(configured?.providerDisplayName || template?.providerDisplayName || "").trim();
      return providerDisplayName && providerDisplayName.toLocaleLowerCase() !== label.toLocaleLowerCase()
        ? `${label} · ${providerDisplayName}`
        : label;
    }
    return type === "language" ? value : value.replaceAll("_", " ").toLocaleLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function configuredTemplateFilterValues(type) {
    const key = { channel: "channels", category: "categories", status: "statuses", language: "languages" }[type];
    return asItems(state.whatsappTemplateFilterOptions?.[key]).map((item) => String(item?.value || item?.channelId || item || "").trim()).filter(Boolean);
  }

  function availableTemplateFilterValues(type) {
    return [...new Set([
      ...configuredTemplateFilterValues(type),
      ...state.whatsappTemplates.map((template) => templateFilterValue(template, type)).filter(Boolean),
      ...state.whatsappTemplateFilters[type],
    ])].sort((left, right) => templateFilterLabel(type, left).localeCompare(templateFilterLabel(type, right)));
  }

  function filteredWhatsAppTemplates() {
    const search = state.whatsappTemplateSearch.trim().toLocaleLowerCase();
    return state.whatsappTemplates.filter((template) => {
      if (search && !templateLibrarySearchText(template).includes(search)) return false;
      return Object.entries(state.whatsappTemplateFilters).every(([type, selected]) =>
        !selected.size || selected.has(templateFilterValue(template, type)));
    });
  }

  function closeTemplateFilterMenus(exceptType = "", { restoreFocus = false } = {}) {
    let focusTarget = null;
    document.querySelectorAll("[data-template-filter-menu]").forEach((menu) => {
      if (exceptType && menu.dataset.templateFilterMenu === exceptType) return;
      const wasOpen = !menu.hidden;
      menu.hidden = true;
      const trigger = document.querySelector(`[data-action="toggle-template-filter"][data-filter-type="${menu.dataset.templateFilterMenu}"]`);
      trigger?.setAttribute("aria-expanded", "false");
      if (restoreFocus && wasOpen && (menu.contains(document.activeElement) || trigger === document.activeElement)) focusTarget = trigger;
    });
    focusTarget?.focus();
  }

  function toggleTemplateFilterMenu(type) {
    const menu = document.querySelector(`[data-template-filter-menu="${CSS.escape(type)}"]`);
    const trigger = document.querySelector(`[data-action="toggle-template-filter"][data-filter-type="${CSS.escape(type)}"]`);
    if (!menu || !trigger) return;
    const opening = menu.hidden;
    closeTemplateFilterMenus(type);
    menu.hidden = !opening;
    trigger.setAttribute("aria-expanded", String(opening));
    if (opening) {
      const search = menu.querySelector("[data-template-filter-search]");
      renderTemplateFilterOptions(type, search?.value || "");
      requestAnimationFrame(() => search?.focus());
    }
  }

  function renderTemplateFilterOptions(type, query = "") {
    const host = document.querySelector(`[data-template-filter-options="${CSS.escape(type)}"]`);
    if (!host) return;
    host.replaceChildren();
    const needle = query.trim().toLocaleLowerCase();
    const values = availableTemplateFilterValues(type).filter((value) => templateFilterLabel(type, value).toLocaleLowerCase().includes(needle));
    if (!values.length) {
      host.append(element("p", "template-filter-empty", "No matching options"));
      return;
    }
    values.forEach((value) => {
      const label = element("label", "template-filter-option");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = state.whatsappTemplateFilters[type].has(value);
      input.dataset.templateFilterOption = type;
      input.value = value;
      label.append(input, element("span", "", templateFilterLabel(type, value)));
      const count = state.whatsappTemplates.filter((template) => templateFilterValue(template, type) === value).length;
      label.append(element("small", "", String(count)));
      host.append(label);
    });
  }

  function updateTemplateFilterControls() {
    const chipHost = $("whatsappTemplateActiveFilters");
    chipHost.replaceChildren();
    let total = 0;
    Object.entries(state.whatsappTemplateFilters).forEach(([type, selected]) => {
      const counter = document.querySelector(`[data-template-filter-count="${type}"]`);
      if (counter) {
        counter.textContent = String(selected.size);
        counter.hidden = selected.size === 0;
      }
      selected.forEach((value) => {
        total += 1;
        const chip = element("button", "template-filter-chip", `${type === "channel" ? "Channel" : capitalize(type)}: ${templateFilterLabel(type, value)}`);
        chip.type = "button";
        chip.dataset.action = "remove-template-filter";
        chip.dataset.filterType = type;
        chip.dataset.filterValue = value;
        chip.setAttribute("aria-label", `Remove ${templateFilterLabel(type, value)} ${type} filter`);
        chip.append(element("span", "", "×"));
        chipHost.append(chip);
      });
    });
    $("clearWhatsAppTemplateFilters").hidden = total === 0 && !state.whatsappTemplateSearch;
  }

  function renderWhatsAppTemplatePreview(template) {
    const preview = element("div", "whatsapp-template-preview");
    const header = templateLibraryComponent(template, "HEADER");
    if (header) {
      const format = String(header.format || "TEXT").toUpperCase();
      if (format === "TEXT" && header.text) preview.append(element("strong", "template-preview-header", header.text));
      else {
        const media = element("div", "template-preview-media");
        media.append(element("span", "", format === "VIDEO" ? "▶" : format === "DOCUMENT" ? "▤" : "▧"), element("small", "", `${capitalize(format.toLocaleLowerCase())} header`));
        preview.append(media);
      }
    }
    const bodyText = String(templateLibraryComponent(template, "BODY")?.text || "No body text provided.");
    preview.append(element("p", "template-preview-body", bodyText));
    const footerText = String(templateLibraryComponent(template, "FOOTER")?.text || "").trim();
    if (footerText) preview.append(element("small", "template-preview-footer", footerText));
    const buttons = templateLibraryButtons(template);
    if (buttons.length) {
      const buttonHost = element("div", "template-preview-buttons");
      buttons.forEach((button) => buttonHost.append(element("span", "", String(button?.text || button?.type || "Action"))));
      preview.append(buttonHost);
    }
    return preview;
  }

  function renderWhatsAppTemplateCard(template) {
    const card = element("article", `whatsapp-template-card${template.channelEnabled ? "" : " is-channel-disabled"}`);
    const head = element("div", "whatsapp-template-card-head");
    const identity = element("div", "template-channel-identity");
    const logo = document.createElement("img");
    logo.src = providerLogoPaths.whatsapp_cloud;
    logo.alt = "";
    identity.append(logo);
    const channelCopy = document.createElement("div");
    const providerLine = [template.providerDisplayName || "WhatsApp account", template.channelEnabled ? "" : "Channel disabled"].filter(Boolean).join(" · ");
    channelCopy.append(element("strong", "", template.channelName), element("span", "", providerLine));
    identity.append(channelCopy);
    const statusClass = template.status.toLocaleLowerCase().replace(/[^a-z0-9-]/g, "-");
    head.append(identity, element("span", `template-status-badge is-${statusClass}`, template.status));
    const title = element("div", "whatsapp-template-title");
    title.append(element("h3", "", template.name), element("code", "", template.languageCode));
    const meta = element("div", "whatsapp-template-meta");
    meta.append(element("span", "", template.category), element("span", "", `${template.variables.length || templateVariableDescriptors(template).length} variable${(template.variables.length || templateVariableDescriptors(template).length) === 1 ? "" : "s"}`));
    card.append(head, title, meta, renderWhatsAppTemplatePreview(template));
    return card;
  }

  function renderWhatsAppTemplateResults() {
    const host = $("whatsappTemplateGrid");
    host.replaceChildren();
    updateTemplateFilterControls();
    if (state.whatsappTemplatesLoading) {
      $("whatsappTemplateResultCount").textContent = "Loading templates…";
      for (let index = 0; index < 6; index += 1) host.append(element("div", "whatsapp-template-card template-library-skeleton"));
      return;
    }
    if (state.whatsappTemplatesError) {
      $("whatsappTemplateResultCount").textContent = "Templates unavailable";
      const empty = element("div", "template-library-empty");
      empty.append(element("strong", "", "Templates could not be loaded"), element("span", "", state.whatsappTemplatesError));
      const retry = element("button", "secondary-button", "Try again");
      retry.type = "button";
      retry.dataset.action = "refresh-whatsapp-templates";
      empty.append(retry);
      host.append(empty);
      return;
    }
    const templates = filteredWhatsAppTemplates();
    const totalChannels = new Set(templates.map((template) => template.channelId)).size;
    $("whatsappTemplateResultCount").textContent = `${templates.length} of ${state.whatsappTemplates.length} template${state.whatsappTemplates.length === 1 ? "" : "s"}${templates.length ? ` · ${totalChannels} channel${totalChannels === 1 ? "" : "s"}` : ""}`;
    if (!templates.length) {
      const empty = element("div", "template-library-empty");
      const hasTemplates = state.whatsappTemplates.length > 0;
      empty.append(
        element("strong", "", hasTemplates ? "No templates match these filters" : "No WhatsApp templates found"),
        element("span", "", hasTemplates ? "Try a different search or clear one of the selected filters." : "Connect a WhatsApp account with templates, then refresh this page.")
      );
      if (hasTemplates) {
        const clear = element("button", "secondary-button", "Clear filters");
        clear.type = "button";
        clear.dataset.action = "clear-all-template-filters";
        empty.append(clear);
      }
      host.append(empty);
      return;
    }
    templates.forEach((template) => host.append(renderWhatsAppTemplateCard(template)));
  }

  function renderWhatsAppTemplateLibrary() {
    ["channel", "category", "status", "language"].forEach((type) => {
      const search = document.querySelector(`[data-template-filter-search="${type}"]`);
      renderTemplateFilterOptions(type, search?.value || "");
    });
    const notice = $("whatsappTemplateLibraryNotice");
    const notices = [];
    if (state.whatsappTemplateErrors.length) {
      const channelNames = state.whatsappTemplateErrors.map((item) => item.channelName || "a WhatsApp channel");
      notices.push(`${state.whatsappTemplateErrors.length} channel${state.whatsappTemplateErrors.length === 1 ? "" : "s"} could not be refreshed: ${channelNames.join(", ")}. Templates from the remaining channels are shown.`);
    }
    if (state.whatsappTemplateTruncatedChannels.length) {
      const channelNames = state.whatsappTemplateTruncatedChannels.map((item) => item.channelName || "a WhatsApp channel");
      const limit = Math.max(...state.whatsappTemplateTruncatedChannels.map((item) => Number(item.limit) || 1000));
      notices.push(`Meta returned more than ${limit.toLocaleString()} templates for ${channelNames.join(", ")}. The first ${limit.toLocaleString()} per channel are shown.`);
    }
    if (notices.length) {
      notice.textContent = notices.join(" ");
      notice.classList.add("is-warning");
      notice.hidden = false;
    } else {
      notice.hidden = true;
      notice.classList.remove("is-warning");
    }
    $("refreshWhatsAppTemplates").disabled = state.whatsappTemplatesLoading;
    renderWhatsAppTemplateResults();
  }

  async function loadWhatsAppTemplateLibrary({ refresh = false } = {}) {
    if (state.whatsappTemplatesLoading || (state.whatsappTemplatesLoaded && !refresh)) {
      renderWhatsAppTemplateLibrary();
      return;
    }
    state.whatsappTemplatesLoading = true;
    state.whatsappTemplatesError = "";
    state.whatsappTemplateErrors = [];
    state.whatsappTemplateTruncatedChannels = [];
    renderWhatsAppTemplateLibrary();
    try {
      const data = await state.api.getWhatsAppTemplates();
      state.whatsappTemplates = asItems(data).map(normalizeWhatsAppTemplate);
      state.whatsappTemplateErrors = asItems(data?.errors);
      state.whatsappTemplateTruncatedChannels = asItems(data?.truncatedChannels);
      state.whatsappTemplateFilterOptions = data?.filterOptions && typeof data.filterOptions === "object" ? data.filterOptions : {};
      state.whatsappTemplatesLoaded = true;
    } catch (error) {
      state.whatsappTemplatesError = error.message || "Unable to reach the template service.";
    } finally {
      state.whatsappTemplatesLoading = false;
      renderWhatsAppTemplateLibrary();
    }
  }

  function clearWhatsAppTemplateFilters() {
    Object.values(state.whatsappTemplateFilters).forEach((selected) => selected.clear());
    state.whatsappTemplateSearch = "";
    $("whatsappTemplateSearch").value = "";
    document.querySelectorAll("[data-template-filter-search]").forEach((input) => { input.value = ""; });
    renderWhatsAppTemplateLibrary();
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

  function normalizeAllowedChannelIds(raw) {
    if (Array.isArray(raw)) return [...new Set(raw.map((item) => String(item || "").trim()).filter(Boolean))];
    if (typeof raw === "string" && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return normalizeAllowedChannelIds(parsed);
      } catch {
        return raw.split(",").map((item) => item.trim()).filter(Boolean);
      }
    }
    return [];
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
      allowedChannelIds: normalizeAllowedChannelIds(raw.allowedChannelIds ?? raw.allowed_channel_ids),
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
      allowedChannelIds: normalizeAllowedChannelIds(raw.allowedChannelIds ?? raw.allowed_channel_ids),
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
      const remove = element("button", "member-action is-danger", "Delete");
      remove.type = "button";
      remove.dataset.action = "delete-api-key";
      remove.dataset.deleteApiKey = apiKey.apiKeyId;
      actionCell.append(remove);
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

  async function deleteDeveloperApiKey(apiKeyId, button) {
    const apiKey = state.apiKeys.find((item) => item.apiKeyId === apiKeyId);
    if (!canAdmin() || !apiKey) return;
    const confirmed = await requestConfirmation({
      title: `Delete ${apiKey.name}?`,
      message: "This permanently deletes this API key from Helixcer. Any app using it will lose access immediately.",
      note: "This action cannot be undone. Create a new key if the integration needs access again.",
      confirmLabel: "Delete API key",
    });
    if (!confirmed) return;
    if (button) button.disabled = true;
    try {
      await state.api.deleteApiKey(apiKeyId);
      state.apiKeys = state.apiKeys.filter((item) => item.apiKeyId !== apiKeyId);
      renderApiKeys();
      showToast("API key deleted", apiKey.name);
    } catch (error) {
      if (button) button.disabled = false;
      showToast("API key was not deleted", error.message, true);
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
      if (member.role === "agent") {
        copy.append(element("span", "subtle", agentChannelAccessLabel(member.allowedChannelIds)));
      }
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
      row.append(statusCell, tableCell(formatCalendarDate(member.createdAt)));

      const actionCell = document.createElement("td");
      const actionWrap = element("div", "member-actions");
      const toggle = element("button", `member-action${member.status === "active" ? " is-danger" : ""}`, member.status === "active" ? "Disable" : "Enable");
      toggle.type = "button";
      toggle.dataset.toggleMember = member.membershipId;
      toggle.disabled = member.role === "owner";
      const remove = element("button", "member-action is-danger", "Delete");
      remove.type = "button";
      remove.dataset.deleteMember = member.membershipId;
      const deletingSelf = member.membershipId === state.currentUser?.membershipId;
      const outsideAdminScope = !isOwner() && member.role !== "agent";
      remove.disabled = deletingSelf || outsideAdminScope;
      if (deletingSelf) remove.title = "You cannot delete your own workspace membership.";
      else if (outsideAdminScope) remove.title = "Only an owner can delete an administrator or owner.";
      actionWrap.append(toggle, remove);
      actionCell.append(actionWrap);
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
      const channelSummary = invitation.role === "agent"
        ? agentChannelAccessLabel(invitation.allowedChannelIds)
        : "All channels";
      copy.append(
        element("strong", "", invitation.email),
        element("span", "", `${capitalize(invitation.role)} · waiting for sign-in · ${channelSummary}`)
      );
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
    renderInviteChannelOptions(state.channels.map((channel) => channel.channelId));
    updateInviteRoleHelp();
    $("inviteDialog").showModal();
  }

  function agentChannelAccessLabel(channelIds) {
    const ids = normalizeAllowedChannelIds(channelIds);
    if (!ids.length) return "All channels";
    if (ids.length === 1) {
      const channel = state.channels.find((item) => item.channelId === ids[0]);
      return channel?.name || "1 channel";
    }
    return `${ids.length} channels`;
  }

  function renderInviteChannelOptions(selectedIds = null) {
    const host = $("inviteChannelOptions");
    const empty = $("inviteChannelEmpty");
    const selectAll = $("inviteSelectAllChannels");
    if (!host || !empty || !selectAll) return;
    const selected = selectedIds === null
      ? new Set(selectedInviteChannelIds())
      : new Set(normalizeAllowedChannelIds(selectedIds));
    host.replaceChildren();
    const channels = asItems(state.channels).slice().sort((left, right) =>
      String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base" }));
    empty.hidden = channels.length > 0;
    selectAll.disabled = channels.length === 0;
    channels.forEach((channel) => {
      const option = element("label", "invite-channel-option");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "allowedChannelIds";
      checkbox.value = channel.channelId;
      checkbox.checked = selected.has(channel.channelId);
      const copy = document.createElement("span");
      copy.append(document.createTextNode(channel.name || channel.channelId));
      const meta = document.createElement("small");
      meta.textContent = channelStyles[channel.connectorType]?.label || channel.connectorType || "Channel";
      copy.append(meta);
      option.append(checkbox, copy);
      host.append(option);
    });
    updateInviteSelectAllLabel();
  }

  function selectedInviteChannelIds() {
    return [...document.querySelectorAll('#inviteChannelOptions input[type="checkbox"]:checked')]
      .map((input) => input.value)
      .filter(Boolean);
  }

  function updateInviteSelectAllLabel() {
    const selectAll = $("inviteSelectAllChannels");
    const boxes = [...document.querySelectorAll('#inviteChannelOptions input[type="checkbox"]')];
    if (!selectAll) return;
    const allSelected = boxes.length > 0 && boxes.every((input) => input.checked);
    selectAll.textContent = allSelected ? "Clear all" : "Select all";
  }

  function toggleInviteSelectAllChannels() {
    const boxes = [...document.querySelectorAll('#inviteChannelOptions input[type="checkbox"]')];
    if (!boxes.length) return;
    const allSelected = boxes.every((input) => input.checked);
    boxes.forEach((input) => { input.checked = !allSelected; });
    updateInviteSelectAllLabel();
  }

  function updateInviteRoleHelp() {
    const role = $("inviteRole").value;
    const descriptions = {
      admin: "Admins can manage channels, contacts, conversations, and team members. They have access to every messaging channel.",
      agent: "Agents can manage customer conversations on the channels you select below, but cannot change channels or team access.",
    };
    $("inviteRoleHelp").textContent = descriptions[role] || descriptions.agent;
    const channelAccess = $("inviteChannelAccess");
    if (channelAccess) channelAccess.hidden = role !== "agent";
  }

  async function inviteMember(form) {
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim().toLocaleLowerCase();
    const role = String(data.get("role") || "agent");
    if (!email || !form.elements.email.checkValidity()) {
      form.elements.email.reportValidity();
      return;
    }
    const allowedChannelIds = role === "agent" ? selectedInviteChannelIds() : [];
    if (role === "agent" && !allowedChannelIds.length) {
      showToast("Choose messaging channels", "Select at least one channel this agent can use, or select all.", true);
      return;
    }
    $("inviteSubmit").disabled = true;
    try {
      const result = await state.api.inviteMember({
        email,
        role,
        ...(role === "agent" ? { allowedChannelIds } : {}),
        return_to: location.origin,
      });
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

  async function deleteTeamMember(membershipId) {
    const member = state.team.members.find((item) => item.membershipId === membershipId);
    if (!canAdmin() || !member || member.membershipId === state.currentUser?.membershipId) return;
    if (!isOwner() && member.role !== "agent") return;
    const confirmed = await requestConfirmation({
      title: `Delete ${member.displayName}?`,
      message: `This permanently removes ${member.email || member.displayName} from the Helixcer workspace and ends their access.`,
      note: "Their past actions and customer messages remain in the workspace history.",
      confirmLabel: "Delete team member",
    });
    if (!confirmed) return;
    try {
      await state.api.deleteMember(membershipId);
      state.team.members = state.team.members.filter((item) => item.membershipId !== membershipId);
      state.conversations.forEach((conversation) => {
        if ([member.email, member.displayName].includes(conversation.assignedTo)) conversation.assignedTo = "Unassigned";
      });
      renderTeam();
      populateAssigneeSelect();
      renderConversationList();
      showToast("Team member deleted", `${member.displayName} no longer has workspace access.`);
    } catch (error) {
      showToast("Team member was not deleted", error.message, true);
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
    const route = selectedComposerRoute(conversation);
    const input = $("messageInput");
    const text = input.value.trim();
    const queued = currentAttachmentQueue(conversation);
    const replyToMessageId = state.replyingTo?.conversationId === conversation?.conversationId
      ? state.replyingTo.messageId : "";
    if (!conversation || (!text && !queued.length)) return;
    if (isWhatsAppRoute(route) && !whatsappReplyWindow(conversation, route).allowed) {
      renderComposerState();
      showToast("Use a WhatsApp template", "The 24-hour reply window is closed for this conversation.", true);
      return;
    }
    if (queued.length) {
      await sendQueuedAttachments(conversation, text);
      return;
    }
    input.value = "";
    resizeComposer();
    $("sendButton").disabled = true;
    clearUnreadMarkerAfterOutbound({ direction: "outbound" }, conversation.conversationId);
    try {
      const result = await state.api.sendMessage(conversation.conversationId, text, replyToMessageId, route || {});
      const message = normalizeMessage(result.item || { text, direction: "outbound", status: "sent", ...route });
      upsertMessage(conversation.conversationId, message);
      conversation.lastMessage = conversationMessagePreview(message) || message.text;
      conversation.lastMessageType = String(message.messageType || "text").toLocaleLowerCase();
      conversation.lastMessageAt = message.timestamp;
      upsertRenderedMessage(message, conversation.conversationId);
      renderConversationList();
      if (replyToMessageId) clearReplyTarget();
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
    if (Array.isArray(template?.variables) && template.variables.length) {
      return template.variables.map((variable, index) => {
        const componentType = String(variable.component || "body").toLowerCase();
        const sourceKind = String(variable.kind || "text").toLowerCase();
        const parameterIndex = Number.isFinite(Number(variable.parameterIndex)) ? Number(variable.parameterIndex) : index;
        const key = String(variable.key || parameterIndex + 1);
        const media = ["image", "video", "document"].includes(sourceKind);
        const buttonIndex = Number(variable.buttonIndex ?? 0);
        return {
          id: `${componentType}-${variable.componentIndex ?? 0}-${buttonIndex}-${parameterIndex}-${key.replace(/[^a-z0-9_-]/gi, "-")}`,
          componentType,
          componentIndex: Number(variable.componentIndex ?? 0),
          parameterIndex,
          subType: componentType === "button" ? "url" : "",
          buttonIndex,
          kind: media ? "media" : sourceKind === "location" ? "location" : "text",
          mediaType: media ? sourceKind : "",
          parameterName: /^\d+$/.test(key) || key === "media" ? "" : key,
          placeholder: media ? "" : key,
          label: media
            ? `${capitalize(sourceKind)} header`
            : sourceKind === "location" ? "Location header" : componentType === "button" ? `Button ${buttonIndex + 1} URL value` : `${capitalize(componentType)} variable ${key}`,
        };
      });
    }
    const descriptors = [];
    asItems(template?.components).forEach((component) => {
      const type = String(component.type || "").toUpperCase();
      const format = String(component.format || "").toLowerCase();
      if (type === "HEADER" && ["image", "video", "document"].includes(format)) {
        descriptors.push({ id: `header-media-${format}`, componentType: "header", componentIndex: 0, parameterIndex: 0,
          kind: "media", mediaType: format, parameterName: "", placeholder: "", label: `${capitalize(format)} header` });
      }
      if (type === "HEADER" || type === "BODY") {
        templatePlaceholders(component.text).forEach((placeholder, index) => descriptors.push({
          id: `${type.toLowerCase()}-text-${index}-${placeholder.replace(/[^a-z0-9_-]/gi, "-")}`,
          componentType: type.toLowerCase(),
          componentIndex: 0,
          parameterIndex: index,
          kind: "text",
          parameterName: /^\d+$/.test(placeholder) ? "" : placeholder,
          placeholder,
          label: `${capitalize(type.toLowerCase())} variable ${placeholder}`,
        }));
      }
      if (type === "BUTTONS") {
        asItems(component.buttons).forEach((button, buttonIndex) => {
          if (String(button.type || "").toUpperCase() !== "URL") return;
          templatePlaceholders(button.url).forEach((placeholder, index) => descriptors.push({
            id: `button-${buttonIndex}-${index}-${placeholder.replace(/[^a-z0-9_-]/gi, "-")}`,
            componentType: "button",
            componentIndex: 0,
            parameterIndex: index,
            subType: "url",
            buttonIndex,
            kind: "text",
            parameterName: /^\d+$/.test(placeholder) ? "" : placeholder,
            placeholder,
            label: `${button.text || `Button ${buttonIndex + 1}`} URL value`,
          }));
        });
      }
    });
    return descriptors;
  }

  function currentTemplate() {
    const templates = state.templatesByConversation.get(templateConversationCacheKey(state.templateConversationId)) || [];
    return templates.find((template) => template._selectionKey === $("templateSelect").value) || null;
  }

  function templateSourceValue(source, conversation = selectedConversation()) {
    const contact = conversation ? contactFor(conversation) : null;
    const identity = conversation ? contactIdentityForConversation(conversation, contact) : null;
    const channel = conversation ? channelFor(conversation.channelId) : null;
    const values = {
      displayName: contact?.displayName || conversation?.subject || "",
      channelProfileId: conversation?.channelProfileId || identity?.profileId || (contact?.channelProfileId === "—" ? "" : contact?.channelProfileId) || "",
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
    const select = row.querySelector(".template-source-select");
    const input = row.querySelector(".template-manual-value");
    const preview = row.querySelector(".template-source-preview");
    if (!select || !input || !preview) return;
    if (row.dataset.kind === "media") {
      if (!select.value) {
        const fileInput = row.querySelector(".template-media-file");
        input.hidden = true;
        input.required = false;
        fileInput.hidden = true;
        fileInput.required = false;
        row._templateFile = null;
        preview.hidden = false;
        preview.textContent = "Choose upload or URL";
        preview.classList.add("is-missing");
        renderTemplateComposerPreview();
        return;
      }
      const upload = select.value === "upload";
      const fileInput = row.querySelector(".template-media-file");
      input.hidden = upload;
      input.required = !upload;
      fileInput.hidden = !upload;
      fileInput.required = upload;
      const file = fileInput.files?.[0] || null;
      row._templateFile = file;
      preview.hidden = false;
      preview.textContent = upload
        ? (file ? `${file.name} · ${formatFileSize(file.size)}` : "Choose a file to upload when you send")
        : (input.value.trim() || "Enter a public media URL");
      preview.classList.toggle("is-missing", upload ? !file : !input.value.trim());
      renderTemplateComposerPreview();
      return;
    }
    const manual = select.value === "manual";
    input.hidden = !manual;
    input.required = manual;
    const resolved = manual ? input.value.trim() : templateSourceValue(select.value);
    preview.hidden = manual;
    preview.textContent = select.value
      ? (resolved || "No saved value for this contact")
      : "Choose a contact field or manual entry";
    preview.classList.toggle("is-missing", !resolved);
    renderTemplateComposerPreview();
  }

  const templateSourceOptions = [
    ["", "Choose source"], ["displayName", "Contact name"], ["channelProfileId", "Channel Profile ID"],
    ["company", "Company"], ["tags", "Tags"], ["channelName", "Channel name"], ["manual", "Manual entry"],
  ];

  function setSearchableComboboxOpen(input, menu, open) {
    if (!input || !menu) return;
    menu.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
  }

  function searchableComboboxOptions(menu, options, query, selectedValue = "") {
    const needle = String(query || "").trim().toLocaleLowerCase();
    const filtered = options.filter(([value, label]) => value && (!needle || label.toLocaleLowerCase().includes(needle)));
    menu.replaceChildren();
    if (!filtered.length) {
      menu.append(element("span", "searchable-combobox-empty", "No matching options"));
      return 0;
    }
    filtered.forEach(([value, label]) => {
      const option = element("button", "searchable-combobox-option", label);
      option.type = "button";
      option.setAttribute("role", "option");
      option.dataset.value = value;
      option.dataset.label = label;
      option.setAttribute("aria-selected", String(value === selectedValue));
      option.classList.toggle("is-active", value === selectedValue);
      menu.append(option);
    });
    return filtered.length;
  }

  function templateSourceLabel(row) {
    const value = row.querySelector(".template-source-select")?.value || "";
    return row._sourceOptions?.find(([optionValue]) => optionValue === value)?.[1] || "";
  }

  function filterTemplateSourceOptions(row, query) {
    const source = row.querySelector(".template-source-select");
    const input = row.querySelector(".template-source-combobox-input");
    const menu = row.querySelector(".template-source-menu");
    if (!source || !input || !menu) return;
    searchableComboboxOptions(menu, row._sourceOptions || templateSourceOptions, query, source.value);
    setSearchableComboboxOpen(input, menu, true);
  }

  function chooseTemplateSource(row, value, label) {
    const source = row.querySelector(".template-source-select");
    const input = row.querySelector(".template-source-combobox-input");
    const menu = row.querySelector(".template-source-menu");
    if (!source || !input || !menu) return;
    source.value = value;
    input.value = label;
    input.dataset.selectedLabel = label;
    setSearchableComboboxOpen(input, menu, false);
    syncTemplateVariableSource(row);
  }

  function invalidateTemplateSourceSelection(row, input) {
    const source = row?.querySelector(".template-source-select");
    if (!source || !input || input.value === input.dataset.selectedLabel) return;
    source.value = "";
    delete input.dataset.selectedLabel;
    syncTemplateVariableSource(row);
  }

  function searchableComboboxInputKeydown(event, input, menu) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSearchableComboboxOpen(input, menu, true);
      menu.querySelector(".searchable-combobox-option")?.focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!menu.hidden) menu.querySelector(".searchable-combobox-option")?.click();
    } else if (event.key === "Escape") {
      event.preventDefault();
      input.value = input.dataset.selectedLabel || "";
      setSearchableComboboxOpen(input, menu, false);
    }
  }

  function searchableComboboxOptionKeydown(event, input, menu) {
    const options = [...menu.querySelectorAll(".searchable-combobox-option")];
    const index = options.indexOf(event.target);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      options[(index + direction + options.length) % options.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      input.value = input.dataset.selectedLabel || "";
      setSearchableComboboxOpen(input, menu, false);
      input.focus();
    }
  }

  function renderTemplateVariables() {
    const template = currentTemplate();
    const host = $("templateVariableFields");
    const summary = $("templateSummary");
    host.replaceChildren();
    if (!template) {
      summary.hidden = true;
      renderTemplateComposerPreview();
      return;
    }
    const languageCode = template.language?.code || template.language || "";
    summary.hidden = false;
    summary.textContent = [template.category, languageCode, template.status].filter(Boolean).join(" · ");
    const descriptors = templateVariableDescriptors(template);
    if (!descriptors.length) {
      host.append(element("p", "template-no-variables", "This template does not require any values."));
      renderTemplateComposerPreview();
      return;
    }
    descriptors.forEach((descriptor) => {
      const row = element("div", "template-variable-row");
      row.dataset.variableId = descriptor.id;
      row.dataset.kind = descriptor.kind;
      const label = element("label", "field-label", descriptor.label);
      const options = descriptor.kind === "media" ? [["upload", "Upload a file"], ["url", "Use media URL"]] : templateSourceOptions;
      row._sourceOptions = options;
      const source = document.createElement("input");
      source.type = "hidden";
      source.className = "template-source-select";
      source.value = descriptor.kind === "media" ? "upload" : suggestedTemplateSource(descriptor);
      const combo = element("span", "searchable-combobox template-source-combobox");
      const comboInput = document.createElement("input");
      const menuId = `template-source-options-${descriptor.id}`;
      comboInput.className = "text-field searchable-combobox-input template-source-combobox-input";
      comboInput.type = "search";
      comboInput.placeholder = descriptor.kind === "media" ? "Choose upload or URL…" : "Search or choose a contact field…";
      comboInput.autocomplete = "off";
      comboInput.setAttribute("role", "combobox");
      comboInput.setAttribute("aria-autocomplete", "list");
      comboInput.setAttribute("aria-expanded", "false");
      comboInput.setAttribute("aria-controls", menuId);
      comboInput.setAttribute("aria-label", `${descriptor.label} source`);
      const menu = element("span", "searchable-combobox-menu template-source-menu");
      menu.id = menuId;
      menu.hidden = true;
      menu.setAttribute("role", "listbox");
      menu.setAttribute("aria-label", `${descriptor.label} sources`);
      const selectedLabel = options.find(([value]) => value === source.value)?.[1] || "";
      comboInput.value = selectedLabel;
      comboInput.dataset.selectedLabel = selectedLabel;
      combo.append(comboInput, source, menu);
      label.append(combo);
      const manual = document.createElement("input");
      manual.className = "text-field template-manual-value";
      manual.type = descriptor.kind === "media" ? "url" : "text";
      manual.maxLength = descriptor.kind === "media" ? 2048 : 1000;
      manual.placeholder = descriptor.kind === "media"
        ? "https://example.com/media.jpg"
        : descriptor.kind === "location" ? "12.9716, 77.5946 | Location name | Address" : `Enter ${descriptor.label.toLowerCase()}`;
      manual.setAttribute("aria-label", `${descriptor.label} manual value`);
      const file = document.createElement("input");
      file.className = "text-field template-media-file";
      file.type = "file";
      file.hidden = true;
      file.accept = descriptor.mediaType === "image" ? "image/jpeg,image/png"
        : descriptor.mediaType === "video" ? "video/mp4,video/3gpp"
          : "application/pdf,text/plain,text/csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx";
      file.setAttribute("aria-label", `Upload ${descriptor.label.toLowerCase()}`);
      const preview = element("span", "template-source-preview");
      row.append(label, manual);
      if (descriptor.kind === "media") row.append(file);
      row.append(preview);
      host.append(row);
      searchableComboboxOptions(menu, options, "", source.value);
      syncTemplateVariableSource(row);
    });
    renderTemplateComposerPreview();
  }

  function resolvedTemplateValue(row, descriptor, conversation = selectedConversation()) {
    const source = row?.querySelector(".template-source-select")?.value || "";
    const manual = row?.querySelector(".template-manual-value")?.value?.trim() || "";
    if (descriptor.kind === "media") {
      const file = row?.querySelector(".template-media-file")?.files?.[0] || null;
      return source === "upload" ? (file?.name || "") : manual;
    }
    return source === "manual" ? manual : templateSourceValue(source, conversation);
  }

  function replaceTemplatePlaceholders(text, componentType, descriptors, values, buttonIndex = null) {
    const candidates = descriptors.filter((descriptor) => descriptor.kind === "text"
      && descriptor.componentType === componentType
      && (componentType !== "button" || descriptor.buttonIndex === buttonIndex));
    let positionalIndex = 0;
    return String(text || "").replace(/{{\s*([^{}]+?)\s*}}/g, (match, rawKey) => {
      const key = String(rawKey || "").trim();
      const named = candidates.find((descriptor) => descriptor.parameterName === key || descriptor.placeholder === key);
      const descriptor = named || candidates[positionalIndex++];
      return descriptor && values.get(descriptor.id) ? values.get(descriptor.id) : match;
    });
  }

  function safeTemplateMediaPreviewUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
    } catch { return ""; }
  }

  function templateComposerModel({ includeMediaPreview = true } = {}) {
    const template = currentTemplate();
    if (!template) return null;
    const descriptors = templateVariableDescriptors(template);
    const values = new Map();
    descriptors.forEach((descriptor) => {
      const row = $("templateVariableFields").querySelector(`[data-variable-id="${CSS.escape(descriptor.id)}"]`);
      values.set(descriptor.id, resolvedTemplateValue(row, descriptor));
    });
    const model = { header: "", body: "", footer: "", buttons: [], media: null, location: "", text: "" };
    asItems(template.components).forEach((component) => {
      const type = String(component.type || "").toUpperCase();
      if (type === "HEADER") {
        const mediaDescriptor = descriptors.find((descriptor) => descriptor.componentType === "header" && descriptor.kind === "media");
        const locationDescriptor = descriptors.find((descriptor) => descriptor.componentType === "header" && descriptor.kind === "location");
        if (mediaDescriptor) {
          const row = $("templateVariableFields").querySelector(`[data-variable-id="${CSS.escape(mediaDescriptor.id)}"]`);
          const source = row?.querySelector(".template-source-select")?.value || "";
          const file = source === "upload" ? row?.querySelector(".template-media-file")?.files?.[0] || null : null;
          const remoteUrl = source === "url" ? safeTemplateMediaPreviewUrl(values.get(mediaDescriptor.id)) : "";
          model.media = {
            type: mediaDescriptor.mediaType,
            name: file?.name || values.get(mediaDescriptor.id) || `${capitalize(mediaDescriptor.mediaType)} attachment`,
            previewUrl: includeMediaPreview && file && mediaDescriptor.mediaType !== "document"
              ? URL.createObjectURL(file) : remoteUrl,
            temporary: Boolean(includeMediaPreview && file && mediaDescriptor.mediaType !== "document"),
            external: Boolean(remoteUrl)
          };
        } else if (locationDescriptor) {
          model.location = values.get(locationDescriptor.id) || "Location";
        } else if (component.text) {
          model.header = replaceTemplatePlaceholders(component.text, "header", descriptors, values);
        }
      } else if (type === "BODY") {
        model.body = replaceTemplatePlaceholders(component.text, "body", descriptors, values);
      } else if (type === "FOOTER") {
        model.footer = String(component.text || "");
      } else if (type === "BUTTONS") {
        model.buttons = asItems(component.buttons).map((button, index) => ({
          text: String(button.text || button.type || `Button ${index + 1}`),
          url: replaceTemplatePlaceholders(button.url, "button", descriptors, values, index)
        }));
      }
    });
    const textParts = [];
    if (model.location) textParts.push(`Location: ${model.location}`);
    if (model.header) textParts.push(model.header);
    if (model.body) textParts.push(model.body);
    if (model.footer) textParts.push(model.footer);
    if (model.buttons.length) textParts.push(`Actions: ${model.buttons.map((button) => button.text).join(", ")}`);
    model.text = textParts.join("\n").trim() || `Template: ${template.name || "message"}`;
    return model;
  }

  function revokeTemplatePreviewUrl() {
    const host = $("templatePreviewContent");
    const temporary = host?.dataset.temporaryUrl || "";
    if (temporary) URL.revokeObjectURL(temporary);
    if (host) delete host.dataset.temporaryUrl;
  }

  function closeTemplateDialog() {
    revokeTemplatePreviewUrl();
    state.templateConversationId = null;
    if ($("templateDialog").open) $("templateDialog").close();
  }

  function renderTemplateComposerPreview() {
    const section = $("templateMessagePreview");
    const host = $("templatePreviewContent");
    const hidden = $("templatePreviewText");
    if (!section || !host || !hidden) return null;
    revokeTemplatePreviewUrl();
    host.replaceChildren();
    const model = templateComposerModel();
    section.hidden = !model;
    hidden.value = model?.text || "";
    if (!model) return null;
    if (model.media) {
      if (model.media.type === "image" && model.media.previewUrl) {
        const image = document.createElement("img");
        image.className = "template-preview-media";
        image.src = model.media.previewUrl;
        image.alt = model.media.name;
        image.referrerPolicy = "no-referrer";
        image.loading = "lazy";
        host.append(image);
      } else if (model.media.type === "video" && model.media.previewUrl) {
        const video = document.createElement("video");
        video.className = "template-preview-media";
        video.src = model.media.previewUrl;
        video.controls = true;
        video.preload = "metadata";
        video.referrerPolicy = "no-referrer";
        host.append(video);
      } else {
        host.append(element("div", "template-preview-document", model.media.name));
      }
      if (model.media.temporary) host.dataset.temporaryUrl = model.media.previewUrl;
    }
    if (model.location) host.append(element("div", "template-preview-location", `📍 ${model.location}`));
    if (model.header) host.append(element("strong", "template-preview-header", model.header));
    if (model.body) host.append(element("p", "template-preview-body", model.body));
    if (model.footer) host.append(element("small", "template-preview-footer", model.footer));
    model.buttons.forEach((button) => {
      const action = element("span", "template-preview-action");
      action.append(element("strong", "", button.text));
      if (button.url) action.append(element("small", "", button.url));
      host.append(action);
    });
    return model;
  }

  function templateSearchText(template) {
    const parts = [template.name, template.category, template.status, template.language?.code || template.language];
    asItems(template.components).forEach((component) => {
      parts.push(component.type, component.text, component.format);
      asItems(component.buttons).forEach((button) => parts.push(button.text, button.type));
    });
    return parts.filter(Boolean).join(" ").toLocaleLowerCase();
  }

  function templateOptionLabel(template) {
    const language = template.language?.code || template.language || "";
    return `${template.name}${language ? ` · ${language}` : ""}`;
  }

  function templateConversationCacheKey(conversationId) {
    const conversation = state.conversations.find((item) => item.conversationId === conversationId);
    return `${conversationId || ""}|${conversationRouteKey(selectedComposerRoute(conversation) || {})}`;
  }

  function chooseTemplateOption(value, label) {
    const select = $("templateSelect");
    const search = $("templateSearch");
    const menu = $("templateOptions");
    select.value = value;
    search.value = label;
    search.dataset.selectedLabel = label;
    setSearchableComboboxOpen(search, menu, false);
    $("templateSubmit").disabled = !value;
    renderTemplateVariables();
  }

  function invalidateTemplateSelection(input) {
    const select = $("templateSelect");
    if (!input || input.value === input.dataset.selectedLabel) return;
    select.value = "";
    delete input.dataset.selectedLabel;
    $("templateSubmit").disabled = true;
    renderTemplateVariables();
  }

  function renderTemplateSelectOptions(query = "", { open = true } = {}) {
    const select = $("templateSelect");
    const search = $("templateSearch");
    const menu = $("templateOptions");
    const templates = state.templatesByConversation.get(templateConversationCacheKey(state.templateConversationId)) || [];
    const selected = select.value;
    const needle = String(query || "").trim().toLocaleLowerCase();
    const filtered = templates.filter((template) => !needle || templateSearchText(template).includes(needle));
    const options = filtered.map((template) => [template._selectionKey, templateOptionLabel(template)]);
    searchableComboboxOptions(menu, options, "", selected);
    const selectedTemplate = templates.find((template) => template._selectionKey === selected);
    if (selectedTemplate) {
      const label = templateOptionLabel(selectedTemplate);
      search.dataset.selectedLabel = label;
    }
    search.disabled = !templates.length;
    $("templateSubmit").disabled = !selected;
    setSearchableComboboxOpen(search, menu, open && !search.disabled);
  }

  async function loadConversationTemplates(conversationId, { refresh = false } = {}) {
    const select = $("templateSelect");
    const search = $("templateSearch");
    const status = $("templateLoadStatus");
    const submit = $("templateSubmit");
    select.disabled = true;
    select.value = "";
    search.disabled = true;
    search.value = "";
    delete search.dataset.selectedLabel;
    submit.disabled = true;
    status.hidden = false;
    status.classList.remove("is-error");
    status.textContent = "Loading approved templates from WhatsApp…";
    $("templateOptions").replaceChildren(element("span", "searchable-combobox-empty", "Loading templates…"));
    setSearchableComboboxOpen(search, $("templateOptions"), false);
    $("templateVariableFields").replaceChildren();
    $("templateSummary").hidden = true;
    try {
      const conversation = state.conversations.find((item) => item.conversationId === conversationId);
      const route = selectedComposerRoute(conversation);
      const cacheKey = `${conversationId}|${conversationRouteKey(route || {})}`;
      let templates = !refresh ? state.templatesByConversation.get(cacheKey) : null;
      if (!templates) {
        const result = await state.api.getTemplates(conversationId, route || {});
        templates = asItems(result).filter((template) => !template.status || String(template.status).toUpperCase() === "APPROVED");
        templates = templates.map((template, index) => ({
          ...template,
          _selectionKey: `${template.templateId || template.name || index}::${template.language?.code || template.language || ""}::${index}`,
        }));
        state.templatesByConversation.set(cacheKey, templates);
      }
      if (state.templateConversationId !== conversationId) return;
      renderTemplateSelectOptions("", { open: false });
      search.disabled = !templates.length;
      submit.disabled = true;
      status.textContent = templates.length
        ? `${templates.length} approved template${templates.length === 1 ? "" : "s"} available.`
        : "No approved templates are available for this WhatsApp connection.";
      status.append(document.createTextNode(" "));
      const refreshButton = element("button", "inline-retry", "Refresh");
      refreshButton.type = "button";
      refreshButton.dataset.action = "reload-templates";
      status.append(refreshButton);
      if (templates.length) search.focus();
    } catch (error) {
      if (state.templateConversationId !== conversationId) return;
      status.classList.add("is-error");
      status.replaceChildren(document.createTextNode(`Templates could not be loaded: ${error.message} `));
      const retry = element("button", "inline-retry", "Retry");
      retry.type = "button";
      retry.dataset.action = "reload-templates";
      status.append(retry);
      $("templateOptions").replaceChildren(element("span", "searchable-combobox-empty", "Templates unavailable"));
      setSearchableComboboxOpen(search, $("templateOptions"), false);
      search.disabled = true;
    }
  }

  function openTemplateDialog() {
    const conversation = selectedConversation();
    const route = selectedComposerRoute(conversation);
    if (!conversation || !isWhatsAppRoute(route)) {
      showToast("WhatsApp conversation required", "Templates can currently be sent from WhatsApp conversations only.", true);
      return;
    }
    const form = $("templateForm");
    form.reset();
    $("templateSearch").value = "";
    delete $("templateSearch").dataset.selectedLabel;
    $("templateSelect").value = "";
    state.templateConversationId = conversation.conversationId;
    $("templateDialog").showModal();
    loadConversationTemplates(conversation.conversationId);
  }

  async function sendCurrentTemplate(form) {
    const conversation = selectedConversation();
    const route = selectedComposerRoute(conversation);
    if (!conversation || !isWhatsAppRoute(route)) return;
    const template = currentTemplate();
    if (!template) {
      showToast("Choose a template", "Select an approved template before sending.", true);
      return;
    }
    const name = String(template.name || "").trim();
    const languageCode = String(template.language?.code || template.language || "").trim();
    if (!name || !languageCode) return;
    const descriptors = templateVariableDescriptors(template);
    const resolvedDescriptors = [];
    for (const descriptor of descriptors) {
      const row = $("templateVariableFields").querySelector(`[data-variable-id="${CSS.escape(descriptor.id)}"]`);
      const source = row?.querySelector(".template-source-select")?.value || "";
      const manual = row?.querySelector(".template-manual-value")?.value?.trim() || "";
      if (!source) {
        showToast("Choose a template source", `Choose a contact field or manual entry for ${descriptor.label}.`, true);
        row?.querySelector(".template-source-combobox-input")?.focus();
        return;
      }
      const file = descriptor.kind === "media" && source === "upload"
        ? row?.querySelector(".template-media-file")?.files?.[0] || null : null;
      const value = descriptor.kind === "media"
        ? (source === "upload" ? file?.name || "" : manual)
        : source === "manual" ? manual : templateSourceValue(source, conversation);
      if (!value) {
        showToast("Template value required", `${descriptor.label} does not have a value. Choose another source or enter it manually.`, true);
        row?.querySelector(source === "upload" ? ".template-media-file" : source === "manual" || source === "url"
          ? ".template-manual-value" : ".template-source-combobox-input")?.focus();
        return;
      }
      resolvedDescriptors.push({ descriptor, row, source, value, file });
    }
    const previewText = String(renderTemplateComposerPreview()?.text || "").trim();
    const submit = $("templateSubmit");
    submit.disabled = true;
    submit.textContent = "Sending…";
    clearUnreadMarkerAfterOutbound({ direction: "outbound" }, conversation.conversationId);
    try {
      const componentMap = new Map();
      let mediaPreview = null;
      for (const resolved of resolvedDescriptors) {
        const { descriptor, row, source, value, file } = resolved;
      let key = descriptor.componentType;
      if (descriptor.componentType === "button") key = `button:${descriptor.buttonIndex}`;
      if (!componentMap.has(key)) componentMap.set(key, descriptor.componentType === "button"
        ? { type: "button", sub_type: descriptor.subType, index: String(descriptor.buttonIndex), parameters: [] }
        : { type: descriptor.componentType, parameters: [] });
      const component = componentMap.get(key);
      if (descriptor.kind === "media") {
          if (source === "upload") {
            const mediaForm = new FormData();
            mediaForm.append("file", file, file.name);
            mediaForm.append("type", descriptor.mediaType);
            if (route?.channelId) mediaForm.append("channelId", route.channelId);
            if (route?.identityId) mediaForm.append("identityId", route.identityId);
            const uploaded = await state.api.uploadTemplateMedia(conversation.conversationId, mediaForm);
            component.parameters.push({ type: descriptor.mediaType, [descriptor.mediaType]: { id: uploaded.mediaId } });
            mediaPreview = {
              filename: uploaded.filename || file.name,
              mimeType: uploaded.mimeType || file.type || "",
              size: Number(uploaded.size || file.size || 0)
            };
          } else {
            component.parameters.push({ type: descriptor.mediaType, [descriptor.mediaType]: { link: value } });
          }
      } else if (descriptor.kind === "location") {
        const [coordinates, name = "", address = ""] = value.split("|").map((part) => part.trim());
        const [latitude, longitude] = coordinates.split(",").map((part) => Number(part.trim()));
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          showToast("Location is invalid", "Enter latitude and longitude separated by a comma, followed by optional name and address.", true);
            row?.querySelector(".template-manual-value")?.focus();
          return;
        }
        component.parameters.push({ type: "location", location: { latitude, longitude, ...(name ? { name } : {}), ...(address ? { address } : {}) } });
      } else {
        const parameter = { type: "text", text: value };
        if (descriptor.parameterName) parameter.parameter_name = descriptor.parameterName;
        component.parameters.push(parameter);
      }
      }
      const request = { name, language: { code: languageCode }, previewText };
      if (componentMap.size) request.components = [...componentMap.values()];
      if (mediaPreview) request.mediaPreview = mediaPreview;
      const result = await state.api.sendTemplate(conversation.conversationId, request, route || {});
      const fallback = previewText || `Template: ${name}`;
      const message = normalizeMessage(result.item || result.message || { text: fallback, direction: "outbound", status: "pending", messageType: "template", ...route });
      upsertMessage(conversation.conversationId, message);
      conversation.lastMessage = conversationMessagePreview(message) || fallback;
      conversation.lastMessageType = "template";
      conversation.lastMessageAt = message.timestamp;
      closeTemplateDialog();
      upsertRenderedMessage(message, conversation.conversationId);
      renderConversationList();
      showToast("Template queued", `${name} is being sent through WhatsApp.`);
    } catch (error) {
      showToast("Template was not sent", error.message, true);
    } finally {
      submit.disabled = false;
      submit.textContent = "Send template";
    }
  }

  function attachmentSizeLimit(file, conversation = selectedConversation()) {
    if (isWhatsAppConversation(conversation) && String(file?.type || "").startsWith("image/")) {
      return 5 * 1024 * 1024;
    }
    return 16 * 1024 * 1024;
  }

  function formatFileSize(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function queueCurrentAttachments(fileList) {
    const conversation = selectedConversation();
    const status = $("attachmentStatus");
    const files = [...(fileList || [])];
    if (!conversation || !files.length) return;
    if (!supportsChatAttachments(conversation)) {
      showToast("Attachments unavailable", "File sending is currently available for WhatsApp and Telegram conversations.", true);
      return;
    }
    if (!whatsappReplyWindow(conversation).allowed) {
      renderComposerState();
      showToast("Use a WhatsApp template", "Attachments cannot be sent after the 24-hour reply window closes.", true);
      return;
    }
    const queue = state.pendingAttachments.get(conversation.conversationId) || [];
    for (const file of files) {
      if (isWhatsAppConversation(conversation) && file.type === "image/webp") {
        showToast("WhatsApp image type not supported", `${file.name} must be converted to JPEG or PNG before sending.`, true);
        continue;
      }
      const limit = attachmentSizeLimit(file, conversation);
      if (!file.size || file.size > limit) {
        showToast(file.size ? "File is too large" : "Empty file skipped",
          file.size ? `${file.name} is ${formatFileSize(file.size)}. The limit is ${formatFileSize(limit)}.` : `${file.name} is empty.`, true);
        continue;
      }
      const previewUrl = file.type.startsWith("image/") || file.type.startsWith("video/") ? URL.createObjectURL(file) : "";
      queue.push({ id: crypto.randomUUID?.() || `attachment-${Date.now()}-${Math.random()}`, file, previewUrl });
    }
    state.pendingAttachments.set(conversation.conversationId, queue);
    $("attachmentInput").value = "";
    status.hidden = true;
    renderAttachmentQueue();
    $("messageInput").focus();
  }

  function removeQueuedAttachment(attachmentId) {
    const conversation = selectedConversation();
    if (!conversation) return;
    const queue = currentAttachmentQueue(conversation);
    const index = queue.findIndex((item) => item.id === attachmentId);
    if (index < 0) return;
    const [removed] = queue.splice(index, 1);
    if (removed.previewUrl) URL.revokeObjectURL(removed.previewUrl);
    if (queue.length) state.pendingAttachments.set(conversation.conversationId, queue);
    else state.pendingAttachments.delete(conversation.conversationId);
    renderAttachmentQueue();
  }

  function discardAttachmentQueue(conversationId) {
    if (!conversationId) return;
    const queue = state.pendingAttachments.get(conversationId) || [];
    queue.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    state.pendingAttachments.delete(conversationId);
  }

  async function sendQueuedAttachments(conversation, caption) {
    const queue = currentAttachmentQueue(conversation);
    const status = $("attachmentStatus");
    const input = $("messageInput");
    if (!queue.length) return;
    if (caption.length > 1024) {
      showToast("Caption is too long", "Attachment captions can contain up to 1,024 characters. Shorten the message or send it separately.", true);
      return;
    }
    const stillSelected = () => state.selectedConversationId === conversation.conversationId;
    if (stillSelected()) {
      $("sendButton").disabled = true;
      $("attachmentButton").disabled = true;
      status.hidden = false;
      status.classList.remove("is-error");
    }
    let sent = 0;
    const replyToMessageId = state.replyingTo?.conversationId === conversation.conversationId
      ? state.replyingTo.messageId : "";
    const route = selectedComposerRoute(conversation);
    clearUnreadMarkerAfterOutbound({ direction: "outbound" }, conversation.conversationId);
    try {
      while (queue.length) {
        const item = queue[0];
        if (stillSelected()) status.textContent = `Sending ${sent + 1} of ${sent + queue.length}: ${item.file.name}…`;
        const formData = new FormData();
        formData.append("file", item.file, item.file.name);
        if (sent === 0 && caption) formData.append("caption", caption);
        if (sent === 0 && replyToMessageId) formData.append("replyToMessageId", replyToMessageId);
        if (route?.channelId) formData.append("channelId", route.channelId);
        if (route?.identityId) formData.append("identityId", route.identityId);
        const result = await state.api.sendAttachment(conversation.conversationId, formData);
        const fallback = sent === 0 && caption ? caption : `[Attachment: ${item.file.name}]`;
        const message = normalizeMessage(result.item || { text: fallback, direction: "outbound", status: "pending", messageType: "document", ...route });
        upsertMessage(conversation.conversationId, message);
        conversation.lastMessage = conversationMessagePreview(message) || fallback;
        conversation.lastMessageType = String(message.messageType || "document").toLocaleLowerCase();
        conversation.lastMessageAt = message.timestamp;
        if (stillSelected()) upsertRenderedMessage(message, conversation.conversationId);
        queue.shift();
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        sent++;
        if (sent === 1 && replyToMessageId && stillSelected()) clearReplyTarget();
        if (sent === 1 && caption && stillSelected() && input.value.trim() === caption) {
          input.value = "";
          resizeComposer();
        }
        if (stillSelected()) renderAttachmentQueue();
      }
      state.pendingAttachments.delete(conversation.conversationId);
      if (stillSelected()) {
        status.textContent = `${sent} file${sent === 1 ? "" : "s"} sent`;
        setTimeout(() => { if (stillSelected()) status.hidden = true; }, 3500);
      }
      renderConversationList();
    } catch (error) {
      state.pendingAttachments.set(conversation.conversationId, queue);
      if (stillSelected()) {
        status.classList.add("is-error");
        status.textContent = `${sent ? `${sent} sent; ` : ""}${queue.length} not sent: ${error.message}`;
      }
      showToast("Attachment sending stopped", `${error.message} Remaining files are still ready to send.`, true);
      renderConversationList();
    } finally {
      renderComposerState();
      if (stillSelected() && !input.disabled) input.focus();
    }
  }

  async function uploadCurrentAttachment(file) {
    // Backward-compatible entry point retained for integrations that dispatch a single File.
    queueCurrentAttachments(file ? [file] : []);
  }

  function upsertMessage(conversationId, message) {
    const messages = state.messages.get(conversationId) || [];
    const index = messages.findIndex((item) => item.messageId === message.messageId);
    if (index >= 0) {
      const existing = messages[index];
      const merged = { ...existing, ...message };
      if (existing.direction === "outbound" || message.direction === "outbound") {
        merged.status = mergeOutboundMessageStatus(existing.status, message.status);
      }
      merged.statusHistory = mergeMessageStatusHistory(existing.statusHistory, message.statusHistory);
      messages[index] = merged;
    }
    else messages.push(message);
    state.messages.set(conversationId, messages);
  }

  async function handleRealtimeEvent(event) {
    const type = event.type || event.event;
    if (type === "connected") {
      const reconnected = state.realtimeConnectedOnce;
      state.realtimeConnectedOnce = true;
      if (!state.loading && (reconnected || state.conversations.length)) await reconcileWorkspace();
      return;
    }
    if (type === "webhook.received") {
      // Current Workers already emitted granular message/status events. The aggregate
      // exists for metrics only; older Workers fall back to a silent reconciliation.
      if (!event.granular) await reconcileWorkspace();
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
      const cachedMessages = state.messages.get(conversationId);
      const existingMessage = (cachedMessages || []).find((item) => item.messageId === String(rawMessage.messageId || rawMessage.id || ""));
      if (!existingMessage && rawMessage.text === undefined && rawMessage.direction === undefined) {
        if (conversationId === state.selectedConversationId) await refreshMessages(conversationId);
        else if (type === "message.created") await reconcileWorkspace({ includeSelectedMessages: false });
        return;
      }
      const statusOnly = type === "message.updated" && Boolean(existingMessage)
        && rawMessage.status !== undefined && rawMessage.text === undefined && rawMessage.direction === undefined;
      const message = normalizeMessage({
        ...existingMessage,
        ...rawMessage,
        conversationId,
        // Status-only broadcasts omit senderName; never blank a known outbound label.
        senderName: rawMessage.senderName || existingMessage?.senderName || "",
        statusHistory: mergeMessageStatusHistory(existingMessage?.statusHistory, rawMessage.statusHistory),
      });
      const replyBecameAvailable = Boolean(existingMessage && !existingMessage.channelMessageId && message.channelMessageId);
      if (cachedMessages || conversationId === state.selectedConversationId) upsertMessage(conversationId, message);
      if (statusOnly) {
        if (conversationId === state.selectedConversationId) {
          if (replyBecameAvailable) upsertRenderedMessage(message, conversationId);
          else updateRenderedMessageStatus(message);
        }
        return;
      }
      const rawConversation = event.conversation && typeof event.conversation === "object" ? event.conversation : null;
      let conversation = state.conversations.find((item) => item.conversationId === conversationId);
      if (rawConversation) {
        const incomingConversation = normalizeConversation({ ...conversation, ...rawConversation, conversationId });
        const conversationIndex = state.conversations.findIndex((item) => item.conversationId === conversationId);
        if (conversationIndex >= 0) state.conversations[conversationIndex] = incomingConversation;
        else state.conversations.unshift(incomingConversation);
        conversation = incomingConversation;
      }
      if (conversation) {
        conversation.lastMessageType = String(message.messageType || "text").toLocaleLowerCase();
        if (!rawConversation) {
          conversation.lastMessage = conversationMessagePreview(message) || messageDisplayText(message);
          conversation.lastMessageAt = message.timestamp;
        }
        if (message.direction === "inbound") {
          conversation.freeformAllowed = true;
          conversation.replyWindowExpiresAt = new Date(new Date(message.timestamp).getTime() + 24 * 60 * 60 * 1000).toISOString();
          promoteInboundConversationRoute(conversation, message);
          if (isConversationActivelyViewed(conversationId)) {
            conversation.unreadCount = 0;
            state.api.updateConversation(conversationId, { markRead: true }).catch(() => {});
          } else if (!rawConversation) conversation.unreadCount += 1;
          if (type === "message.created" && !existingMessage) notifyInboundMessage(conversation, message);
        }
        markConversationRealtimeMutation(conversationId);
      }
      renderCounts();
      renderConversationList();
      if (conversationId === state.selectedConversationId) {
        if (state.messages.has(conversationId)) upsertRenderedMessage(message, conversationId);
        else await refreshMessages(conversationId);
      }
      return;
    }
    if (type === "conversation.updated" || type === "conversation.created") {
      const rawConversation = event.conversation || event.item || event.data || {};
      const eventConversationId = String(event.conversationId || rawConversation.conversationId || rawConversation.id || "");
      const existing = state.conversations.find((item) => item.conversationId === eventConversationId);
      if (!rawConversation.subject && !rawConversation.status) {
        await reconcileWorkspace();
        return;
      }
      const incoming = normalizeConversation({ ...existing, ...rawConversation });
      if (!incoming.conversationId) return;
      const index = state.conversations.findIndex((item) => item.conversationId === incoming.conversationId);
      if (index >= 0) state.conversations[index] = { ...state.conversations[index], ...incoming };
      else state.conversations.unshift(incoming);
      markConversationRealtimeMutation(incoming.conversationId);
      if (incoming.conversationId === state.selectedConversationId && ["pending", "closed"].includes(incoming.status)) {
        clearSelectedConversation();
      } else {
        renderCounts();
        renderConversationList();
        if (incoming.conversationId === state.selectedConversationId) {
          renderSelectedConversation({ preserveScroll: true, renderThread: false });
        }
      }
      return;
    }
    if (type === "conversation.deleted") {
      const conversationId = String(event.conversationId || event.id || "");
      if (!conversationId) return;
      state.messages.delete(conversationId);
      state.conversationRevisions.delete(conversationId);
      state.conversations = state.conversations.filter((conversation) => conversation.conversationId !== conversationId);
      if (conversationId === state.selectedConversationId) clearSelectedConversation();
      else {
        renderCounts();
        renderConversationList();
      }
      return;
    }
    if (type === "contact.updated") {
      const selectedContactId = state.selectedContactId;
      await reconcileWorkspace();
      if (selectedContactId && state.contacts.some((contact) => contact.contactId === selectedContactId)) {
        await selectContact(selectedContactId);
      }
      return;
    }
    if (type === "contact.deleted") {
      const contactId = String(event.contactId || event.id || "");
      if (!contactId) return;
      const conversationIds = new Set([
        ...asItems(event.conversationIds).map(String),
        ...state.conversations.filter((conversation) => conversation.contactId === contactId)
          .map((conversation) => conversation.conversationId),
      ]);
      conversationIds.forEach((conversationId) => {
        state.messages.delete(conversationId);
        state.conversationRevisions.delete(conversationId);
      });
      state.contacts = state.contacts.filter((contact) => contact.contactId !== contactId);
      state.conversations = state.conversations.filter((conversation) => !conversationIds.has(conversation.conversationId));
      if (contactId === state.selectedContactId) closeContactEditor();
      if (conversationIds.has(state.selectedConversationId)) clearSelectedConversation();
      else {
        renderCounts();
        renderContacts();
        renderConversationList();
      }
      return;
    }
    if (type === "workspace.updated") {
      const workspace = event.workspace || event.item || event.data;
      if (workspace && typeof workspace === "object") {
        state.workspaceProfile = normalizeWorkspaceProfile(workspace);
        state.workspaceProfileLoaded = true;
        if (state.route === "workspace") renderWorkspaceProfile();
        else updateWorkspaceIdentity(state.workspaceProfile);
      } else {
        await loadWorkspaceProfile({ force: true });
      }
      return;
    }
    if (["channel.updated", "channel.deleted", "bootstrap.changed"].includes(type)) {
      state.whatsappTemplatesLoaded = false;
      await reconcileWorkspace();
      if (state.route === "whatsapp-templates") await loadWhatsAppTemplateLibrary({ refresh: true });
    }
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

  function backgroundPushSupport() {
    return notificationSupport() && "PushManager" in window;
  }

  async function ensureServiceWorkerRegistration() {
    if (!("serviceWorker" in navigator)) return null;
    if (state.serviceWorkerRegistration?.active) return state.serviceWorkerRegistration;
    await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
    state.serviceWorkerRegistration = await navigator.serviceWorker.ready;
    return state.serviceWorkerRegistration;
  }

  function pushDeviceId() {
    const saved = localStorage.getItem(PUSH_DEVICE_KEY) || "";
    if (/^[A-Za-z0-9_-]{16,100}$/.test(saved)) return saved;
    const generated = crypto.randomUUID();
    localStorage.setItem(PUSH_DEVICE_KEY, generated);
    return generated;
  }

  function applicationServerKey(value) {
    const padding = "=".repeat((4 - (value.length % 4)) % 4);
    const decoded = atob(`${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  }

  function subscriptionUsesKey(subscription, expected) {
    const current = subscription?.options?.applicationServerKey;
    if (!current) return false;
    const bytes = new Uint8Array(current);
    return bytes.length === expected.length && bytes.every((value, index) => value === expected[index]);
  }

  async function loadPushConfiguration() {
    if (!state.api || state.api.recoveryToken) {
      state.pushConfig = { available: false, publicKey: "" };
      return state.pushConfig;
    }
    try {
      state.pushConfig = await state.api.getPushConfig();
    } catch {
      state.pushConfig = { available: false, publicKey: "" };
    }
    renderNotificationSetting();
    return state.pushConfig;
  }

  async function subscribeBrowserPush() {
    if (!backgroundPushSupport()) throw new Error("This browser does not support background Web Push.");
    const config = state.pushConfig || await loadPushConfiguration();
    if (!config?.available || !config.publicKey) throw new Error("Background Web Push is not configured on the server.");
    const registration = await ensureServiceWorkerRegistration();
    const expectedKey = applicationServerKey(config.publicKey);
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !subscriptionUsesKey(subscription, expectedKey)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: expectedKey });
    }
    if (!subscription?.endpoint) throw new Error("Chrome did not create a Web Push subscription.");
    await state.api.savePushSubscription({ deviceId: pushDeviceId(), subscription: subscription.toJSON() });
    state.pushSubscriptionReady = true;
    return registration;
  }

  async function removeBrowserPushSubscription() {
    state.pushSubscriptionReady = false;
    let subscription = null;
    try {
      const registration = await ensureServiceWorkerRegistration();
      subscription = await registration?.pushManager?.getSubscription();
    } catch { /* Continue with server cleanup. */ }
    await Promise.allSettled([
      state.api?.removePushSubscription?.({ deviceId: pushDeviceId() }),
      subscription?.unsubscribe?.()
    ]);
  }

  function androidPermissionHelp() {
    return "In Android Chrome, tap the site-controls icon beside the address bar, open Permissions, and allow Notifications. If Chrome itself is blocked, open Android Settings → Apps → Chrome → Notifications.";
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
    if (!backgroundPushSupport()) {
      toggle.checked = false;
      toggle.disabled = true;
      status.textContent = "This browser does not support background Web Push.";
      return;
    }
    if (state.pushConfig === null) {
      toggle.checked = false;
      toggle.disabled = true;
      status.textContent = "Checking the background notification service…";
      return;
    }
    if (!state.pushConfig.available) {
      toggle.checked = false;
      toggle.disabled = true;
      status.textContent = "Background notifications are not configured on the server.";
      return;
    }
    if (!state.serviceWorkerRegistration?.active) {
      toggle.checked = false;
      toggle.disabled = true;
      status.textContent = "Preparing the background notification service…";
      return;
    }
    const permission = Notification.permission;
    const enabledOnDevice = permission === "granted" && state.notificationsEnabled && state.pushSubscriptionReady;
    toggle.checked = enabledOnDevice;
    toggle.disabled = state.pushActionPending;
    if (state.pushActionPending) {
      status.textContent = permission === "granted"
        ? "Creating this device's background notification subscription…"
        : "Waiting for Chrome's notification permission…";
      return;
    }
    status.textContent = permission === "granted"
      ? (enabledOnDevice
        ? "Background notifications are enabled on this device."
        : "Permission granted; background notifications are currently off.")
      : permission === "denied"
        ? `Notifications are off because Chrome blocked permission. ${androidPermissionHelp()}`
        : "Notifications are off. Chrome will ask for permission when you enable this setting.";
  }

  async function setBrowserNotifications(enabled) {
    const toggle = $("pushNotificationsToggle");
    if (!notificationSupport()) {
      renderNotificationSetting();
      return;
    }
    if (!enabled) {
      state.notificationsEnabled = false;
      localStorage.setItem(NOTIFICATION_PREFERENCE_KEY, "false");
      await removeBrowserPushSubscription();
      renderNotificationSetting();
      showToast("Notifications disabled", "This device will no longer receive Helixcer message alerts.");
      toggle.blur();
      return;
    }
    state.pushActionPending = true;
    state.notificationsEnabled = false;
    state.pushSubscriptionReady = false;
    localStorage.setItem(NOTIFICATION_PREFERENCE_KEY, "false");
    renderNotificationSetting();
    if (Notification.permission !== "granted") {
      let permission = "default";
      try {
        permission = await Notification.requestPermission();
      } catch {
        permission = Notification.permission || "default";
      }
      if (permission !== "granted") {
        state.pushActionPending = false;
        renderNotificationSetting();
        showToast("Chrome permission is still needed", permission === "denied"
          ? androidPermissionHelp()
          : `Chrome may show a quiet permission request. ${androidPermissionHelp()}`, true);
        toggle.blur();
        return;
      }
    }
    try {
      const registration = await subscribeBrowserPush();
      await registration.showNotification("Helixcer notifications enabled", {
        body: "This device can now receive new customer message alerts in the background.",
        icon: "/assets/helixcer-mark.jpg?v=fc5bb333",
        badge: "/assets/helixcer-mark.jpg?v=fc5bb333",
        tag: "helixcer-notification-test",
        data: { url: "/#inbox" }
      });
      state.notificationsEnabled = true;
      localStorage.setItem(NOTIFICATION_PREFERENCE_KEY, "true");
    } catch (error) {
      state.notificationsEnabled = false;
      state.pushSubscriptionReady = false;
      localStorage.setItem(NOTIFICATION_PREFERENCE_KEY, "false");
      await removeBrowserPushSubscription().catch(() => {});
      state.pushActionPending = false;
      renderNotificationSetting();
      showToast("Notifications were not enabled", `The background notification service could not start: ${error.message}`, true);
      toggle.blur();
      return;
    }
    state.pushActionPending = false;
    renderNotificationSetting();
    showToast("Background notifications enabled", "This device can receive alerts even when Helixcer Chat is closed.");
    toggle.blur();
  }

  function prepareBrowserPush() {
    if (state.pushSyncPromise) return state.pushSyncPromise;
    state.pushSyncPromise = (async () => {
      await loadPushConfiguration();
      if (!backgroundPushSupport() || !state.pushConfig?.available) return;
      try {
        await ensureServiceWorkerRegistration();
      } catch {
        state.pushSubscriptionReady = false;
        renderNotificationSetting();
        return;
      }
      if (!state.notificationsEnabled || Notification.permission !== "granted") {
        state.pushSubscriptionReady = false;
        if (state.notificationsEnabled) {
          state.notificationsEnabled = false;
          localStorage.setItem(NOTIFICATION_PREFERENCE_KEY, "false");
          await removeBrowserPushSubscription();
        }
        renderNotificationSetting();
        return;
      }
      try {
        await subscribeBrowserPush();
      } catch {
        state.pushSubscriptionReady = false;
      }
      renderNotificationSetting();
    })().finally(() => { state.pushSyncPromise = null; });
    return state.pushSyncPromise;
  }

  async function notifyInboundMessage(conversation, message) {
    if (!state.notificationsEnabled || !notificationSupport() || Notification.permission !== "granted") return;
    if (state.pushSubscriptionReady && document.visibilityState !== "visible") return;
    if (isConversationActivelyViewed(conversation.conversationId)) return;
    const timestamp = new Date(message.timestamp || conversation.lastMessageAt).getTime() || Date.now();
    const previousNotification = state.lastNotificationAt.get(conversation.conversationId) || 0;
    if (timestamp <= previousNotification) return;
    state.lastNotificationAt.set(conversation.conversationId, timestamp);
    const title = conversation.subject;
    const options = {
      body: channelPlainText(message.text, conversation) || "A new customer message arrived.",
      icon: "/assets/helixcer-mark.jpg?v=fc5bb333",
      badge: "/assets/helixcer-mark.jpg?v=fc5bb333",
      tag: `helixcer-${conversation.conversationId}`,
      data: { url: conversationUrl(conversation.conversationId), conversationId: conversation.conversationId },
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
      const fetchedMessages = asItems(data).map(normalizeMessage);
      state.messages.set(conversationId, mergeMessageSnapshots(state.messages.get(conversationId), fetchedMessages));
      const conversation = state.conversations.find((item) => item.conversationId === conversationId);
      if (conversation && typeof data?.freeformAllowed === "boolean") conversation.freeformAllowed = data.freeformAllowed;
      if (conversation && data?.replyWindowExpiresAt) conversation.replyWindowExpiresAt = data.replyWindowExpiresAt;
      if (conversation && data?.replyWindowReason) conversation.replyWindowReason = data.replyWindowReason;
      if (conversationId === state.selectedConversationId) renderMessages({ preserveScroll: true });
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

  function validConversationId(value) {
    return /^[A-Za-z0-9_-]{1,100}$/.test(String(value || ""));
  }

  function conversationHash(conversationId) {
    return validConversationId(conversationId) ? `#inbox/${encodeURIComponent(conversationId)}` : "#inbox";
  }

  function conversationUrl(conversationId) {
    return `/${conversationHash(conversationId)}`;
  }

  function replaceAppHash(hash) {
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }

  function parseAppHash(value = location.hash) {
    const raw = String(value || "").replace(/^#/, "");
    const separator = raw.indexOf("/");
    const requestedRoute = separator >= 0 ? raw.slice(0, separator) : raw;
    const allowedRoutes = ["inbox", "contacts", "channels", "whatsapp-templates", "import-chat", "developer", "team", "workspace", "settings"];
    const route = allowedRoutes.includes(requestedRoute) ? requestedRoute : "inbox";
    if (route !== "inbox" || separator < 0) return { route, conversationId: "" };
    let conversationId = "";
    try { conversationId = decodeURIComponent(raw.slice(separator + 1)); }
    catch { conversationId = ""; }
    return { route, conversationId: validConversationId(conversationId) ? conversationId : "" };
  }

  async function openPendingConversation({ refreshIfMissing = false } = {}) {
    const conversationId = state.pendingConversationId;
    if (!conversationId || state.authStatus !== "authenticated") return;
    let conversation = state.conversations.find((item) => item.conversationId === conversationId);
    if (!conversation && refreshIfMissing) {
      await loadAll({ preserveSelection: false });
      conversation = state.conversations.find((item) => item.conversationId === conversationId);
    }
    if (!conversation) {
      state.pendingConversationId = null;
      clearSelectedConversation({ updateUrl: false });
      replaceAppHash("#inbox");
      return;
    }
    await selectConversation(conversationId, { updateUrl: false });
  }

  async function applyLocationRoute() {
    const target = parseAppHash();
    state.pendingConversationId = target.conversationId || null;
    setRoute(target.route, { preserveLocation: true });
    if (target.route !== "inbox" || state.authStatus !== "authenticated") return;
    if (target.conversationId) await openPendingConversation({ refreshIfMissing: true });
    else {
      clearSelectedConversation({ updateUrl: false });
      replaceAppHash("#inbox");
    }
  }

  function setRoute(route, { preserveLocation = false } = {}) {
    closeContactRouteMenu();
    closeContactPlatformMenu();
    if (!["inbox", "contacts", "channels", "whatsapp-templates", "import-chat", "developer", "team", "workspace", "settings"].includes(route)) route = "inbox";
    if (!canAdmin() && ["channels", "whatsapp-templates", "import-chat", "developer", "team"].includes(route)) route = "inbox";
    if (!preserveLocation) {
      state.pendingConversationId = null;
      if (route === "inbox") clearSelectedConversation({ updateUrl: false });
    }
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
    const channelSectionActive = ["channels", "whatsapp-templates", "import-chat"].includes(route);
    $("channelNavToggle").classList.toggle("is-active", channelSectionActive);
    if (channelSectionActive) {
      $("channelNavToggle").setAttribute("aria-expanded", "true");
      $("channelNavChildren").hidden = false;
      $("channelNavGroup").classList.add("is-open");
    }
    if (route === "whatsapp-templates" || route === "import-chat") {
      $("channelDataNavToggle").setAttribute("aria-expanded", "true");
      $("channelDataNavChildren").hidden = false;
    }
    const labels = {
      inbox: "Inbox", contacts: "Contacts", channels: "Channels",
      "whatsapp-templates": "WhatsApp Templates", "import-chat": "Import Chat",
      developer: "Developer API", team: "Team", workspace: "Workspace", settings: "Settings",
    };
    $("pageTitle").textContent = labels[route];
    if (route === "settings") renderNotificationSetting();
    if (route === "workspace") loadWorkspaceProfile().catch(() => {});
    if (route === "whatsapp-templates") loadWhatsAppTemplateLibrary().catch(() => {});
    if (route === "import-chat") renderImportChatPage();
    if (!preserveLocation) replaceAppHash(`#${route}`);
    closeMobileMenu();
  }

  function whatsappImportChannels() {
    return state.channels
      .filter((channel) => channel.connectorType === "whatsapp_cloud" || channel.connectorType === "whatsapp")
      .slice()
      .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base" }));
  }

  const IMPORT_CONTACT_TARGETS = [
    { key: "name", label: "Name", help: "Contact display name", required: false },
    { key: "phone", label: "Phone", help: "WhatsApp number with country code", required: true },
    { key: "company", label: "Company", help: "Optional company name", required: false },
    { key: "tags", label: "Tags", help: "Optional tags (only if useful values exist)", required: false },
  ];

  function discoverInteraktContactFields(conversations) {
    const counts = new Map();
    const bump = (path, label, sample = "") => {
      const current = counts.get(path) || { path, label, count: 0, sample: "" };
      current.count += 1;
      if (!current.sample && sample) current.sample = String(sample).slice(0, 80);
      counts.set(path, current);
    };
    (conversations || []).forEach((conversation) => {
      const top = conversation?.customer && typeof conversation.customer === "object" ? conversation.customer : {};
      const raw = conversation?.raw_chat?.customer_id && typeof conversation.raw_chat.customer_id === "object"
        ? conversation.raw_chat.customer_id : {};
      const traits = raw.traits && typeof raw.traits === "object" ? raw.traits : {};
      const tags = Array.isArray(raw.tags) ? raw.tags : [];
      if (raw.channel_phone_number) bump("channel_phone_number", "channel_phone_number (with country code)", raw.channel_phone_number);
      if (raw.channel_account_identifier) bump("channel_account_identifier", "channel_account_identifier", raw.channel_account_identifier);
      if (raw.phone_number) {
        bump("phone_number", "phone_number (local)", raw.phone_number);
        if (raw.country_code) {
          bump("phone_number_with_country_code", "phone_number + country_code",
            `${raw.country_code}${String(raw.phone_number).replace(/\D/g, "")}`);
        }
      }
      if (top.phone) bump("customer.phone", "customer.phone", top.phone);
      if (top.name) bump("customer.name", "customer.name", top.name);
      if (tags.length) {
        const firstTag = tags.map((tag) => String(tag || "").trim()).find(Boolean);
        if (firstTag) bump("tags", "tags", firstTag);
      }
      Object.entries(traits).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") return;
        const sample = Array.isArray(value)
          ? value.map((item) => String(item || "").trim()).find(Boolean)
          : value;
        if (sample === undefined || sample === null || sample === "") return;
        bump(`traits.${key}`, `traits.${key}`, sample);
      });
    });
    return [...counts.values()].sort((left, right) => right.count - left.count || left.path.localeCompare(right.path));
  }

  function defaultImportFieldMapping(availableFields) {
    const paths = new Set(availableFields.map((field) => field.path));
    const pick = (...candidates) => candidates.find((path) => paths.has(path)) || "";
    return {
      name: pick("traits.name", "traits.Name", "traits.full_name", "customer.name", "traits.User Name"),
      phone: pick("channel_phone_number", "phone_number_with_country_code", "channel_account_identifier", "customer.phone"),
      company: pick("traits.Company", "traits.company", "traits.company_name"),
      tags: "",
    };
  }

  function sourceAssignmentsFromFieldMapping(fieldMapping) {
    const assignments = {};
    Object.entries(fieldMapping || {}).forEach(([target, path]) => {
      if (path) assignments[path] = target;
    });
    return assignments;
  }

  function fieldMappingFromSourceAssignments(sourceAssignments) {
    const mapping = { name: "", phone: "", company: "", tags: "" };
    Object.entries(sourceAssignments || {}).forEach(([path, target]) => {
      if (!target || !(target in mapping)) return;
      mapping[target] = path;
    });
    return mapping;
  }

  function syncImportFieldMappingFromAssignments() {
    state.importChat.fieldMapping = fieldMappingFromSourceAssignments(state.importChat.sourceAssignments);
    syncImportChatActionButtons();
  }

  function syncImportChatActionButtons() {
    const channels = whatsappImportChannels();
    const canImport = channels.length
      && state.importChat.conversations.length
      && state.importChat.fieldMapping.phone;
    $("importChatSubmit").disabled = state.importChat.importing || !canImport;
    $("importChatSubmit").hidden = false;
    $("importChatSubmit").textContent = state.importChat.importing ? "Importing…" : "Start import";
    const cancel = $("importChatCancel");
    const cancelling = Boolean(state.importChat.importing && state.importChat.abortController?.signal?.aborted);
    cancel.hidden = !state.importChat.importing;
    cancel.disabled = !state.importChat.importing || cancelling;
    cancel.textContent = cancelling ? "Cancelling…" : "Cancel import";
  }

  function renderImportChatPage() {
    const channelSelect = $("importChatChannel");
    const selected = channelSelect.value;
    const channels = whatsappImportChannels();
    channelSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = channels.length ? "Select a channel…" : "No WhatsApp channel connected";
    channelSelect.append(placeholder);
    channels.forEach((channel) => {
      const option = document.createElement("option");
      option.value = channel.channelId;
      option.textContent = channel.name || channel.channelId;
      channelSelect.append(option);
    });
    if (selected && channels.some((channel) => channel.channelId === selected)) channelSelect.value = selected;
    $("importChatSource").value = state.importChat.source || "interakt";
    channelSelect.disabled = state.importChat.importing;
    $("importChatSource").disabled = state.importChat.importing;
    $("importChatFile").disabled = state.importChat.importing;
    syncImportChatActionButtons();
    renderImportChatPreview();
    renderImportChatMapping();
    if (state.importChat.lastSummary) showImportChatResult(state.importChat.lastSummary);
  }

  function renderImportChatPreview() {
    const preview = $("importChatPreview");
    const stats = $("importChatStats");
    const ready = state.importChat.conversations.length > 0;
    preview.hidden = !ready;
    if (!ready) {
      stats.innerHTML = "";
      return;
    }
    stats.innerHTML = "";
    [
      ["File", state.importChat.fileName || "export.json"],
      ["Conversations", String(state.importChat.conversationCount)],
      ["Messages", String(state.importChat.messageCount)],
    ].forEach(([label, value]) => {
      const item = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      item.append(dt, dd);
      stats.append(item);
    });
  }

  function formatImportFieldExample(value) {
    if (Array.isArray(value)) {
      const first = value.map((item) => String(item || "").trim()).find(Boolean);
      return first || "";
    }
    return String(value ?? "").trim();
  }

  function renderImportChatMapping() {
    const host = $("importChatMapping");
    const list = $("importChatMappingList");
    const ready = state.importChat.conversations.length > 0;
    host.hidden = !ready;
    list.innerHTML = "";
    if (!ready) return;
    const fields = state.importChat.availableFields;
    const assignedTargets = new Set(
      Object.values(state.importChat.sourceAssignments || {}).filter(Boolean)
    );
    fields.forEach((field) => {
      const row = document.createElement("div");
      row.className = "import-chat-mapping-row";
      const label = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = field.label;
      const help = document.createElement("span");
      help.className = "subtle";
      help.textContent = `Found in ${field.count} chat${field.count === 1 ? "" : "s"}`;
      label.append(title, help);
      const example = formatImportFieldExample(field.sample);
      if (example) {
        const exampleLine = document.createElement("div");
        exampleLine.className = "import-chat-mapping-example";
        const exampleLabel = document.createElement("span");
        exampleLabel.textContent = "Example";
        const exampleValue = document.createElement("code");
        exampleValue.textContent = example;
        exampleLine.append(exampleLabel, exampleValue);
        label.append(exampleLine);
      }
      const select = document.createElement("select");
      select.className = "text-field";
      select.dataset.importSource = field.path;
      const skip = document.createElement("option");
      skip.value = "";
      skip.textContent = "Don’t import";
      select.append(skip);
      IMPORT_CONTACT_TARGETS.forEach((target) => {
        const current = state.importChat.sourceAssignments[field.path] || "";
        const taken = assignedTargets.has(target.key) && current !== target.key;
        const option = document.createElement("option");
        option.value = target.key;
        option.textContent = target.required ? `${target.label} *` : target.label;
        option.disabled = taken;
        select.append(option);
      });
      select.value = state.importChat.sourceAssignments[field.path] || "";
      select.disabled = state.importChat.importing;
      select.addEventListener("change", () => {
        const nextTarget = select.value;
        if (nextTarget) {
          Object.keys(state.importChat.sourceAssignments).forEach((path) => {
            if (path !== field.path && state.importChat.sourceAssignments[path] === nextTarget) {
              delete state.importChat.sourceAssignments[path];
            }
          });
          state.importChat.sourceAssignments[field.path] = nextTarget;
        } else {
          delete state.importChat.sourceAssignments[field.path];
        }
        syncImportFieldMappingFromAssignments();
        renderImportChatMapping();
      });
      row.append(label, select);
      list.append(row);
    });
    const phoneHint = document.createElement("p");
    phoneHint.className = "import-chat-mapping-meta";
    phoneHint.textContent = state.importChat.fieldMapping.phone
      ? `Phone mapped from ${state.importChat.fieldMapping.phone}`
      : "Phone is required — map one uploaded phone field to Phone.";
    list.append(phoneHint);
  }

  function setImportChatProgress(done, total, label) {
    const host = $("importChatProgress");
    const fill = $("importChatProgressFill");
    const text = $("importChatProgressLabel");
    if (!total) {
      host.hidden = true;
      fill.style.width = "0%";
      text.textContent = "";
      return;
    }
    host.hidden = false;
    const ratio = Math.max(0, Math.min(1, done / total));
    fill.style.width = `${Math.round(ratio * 100)}%`;
    text.textContent = label || `Imported ${done} of ${total}…`;
  }

  function importChatResultTitle(summary) {
    if (summary?.cancelled) return "Import cancelled";
    const failed = Array.isArray(summary?.failed) ? summary.failed.length : 0;
    if (failed) return `Import finished with ${failed} conversation issue${failed === 1 ? "" : "s"}`;
    return "Import finished";
  }

  function showImportChatResult(summary) {
    const host = $("importChatResult");
    if (!summary) {
      host.hidden = true;
      host.innerHTML = "";
      return;
    }
    state.importChat.lastSummary = summary;
    host.hidden = false;
    const failed = Array.isArray(summary.failed) ? summary.failed : [];
    host.innerHTML = "";
    const title = document.createElement("strong");
    title.textContent = importChatResultTitle(summary);
    const status = document.createElement("p");
    status.className = "import-chat-result-status";
    if (summary.cancelled) status.classList.add("is-cancelled");
    else if (failed.length) status.classList.add("is-warning");
    const batchesDone = Number(summary.batchesCompleted || 0);
    const batchesTotal = Number(summary.batchesTotal || 0);
    status.textContent = summary.cancelled
      ? (batchesTotal
        ? `Stopped after ${batchesDone} of ${batchesTotal} batches`
        : "Stopped before any batch completed")
      : (batchesTotal ? `Completed ${batchesDone} of ${batchesTotal} batches` : "Completed");
    const stats = document.createElement("dl");
    stats.className = "import-chat-stats";
    [
      ["Messages imported", String(summary.messagesImported || 0)],
      ["Messages updated", String(summary.messagesUpdated || 0)],
      ["Messages skipped", String(summary.messagesSkipped || 0)],
      ["Contacts created", String(summary.contactsCreated || 0)],
      ["Contacts reused", String(summary.contactsReused || 0)],
      ["Conversations created", String(summary.conversationsCreated || 0)],
      ["Conversations reused", String(summary.conversationsReused || 0)],
      ["Conversation issues", String(failed.length)],
    ].forEach(([label, value]) => {
      const item = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      item.append(dt, dd);
      stats.append(item);
    });
    host.append(title, status, stats);
  }

  function cancelImportChat() {
    if (!state.importChat.importing) return;
    state.importChat.abortController?.abort();
    syncImportChatActionButtons();
    setImportChatProgress(
      Number(state.importChat.lastSummary?.batchesCompleted || 0) || 0,
      Number(state.importChat.lastSummary?.batchesTotal || 1),
      "Cancelling import…"
    );
  }

  function importChatProgressLabel(summary, index, total) {
    const parts = [
      `Uploading batch ${index + 1} of ${total}`,
      `${summary.messagesImported || 0} imported`,
      `${summary.messagesUpdated || 0} updated`,
      `${summary.messagesSkipped || 0} skipped`,
    ];
    return `${parts[0]}… (${parts.slice(1).join(", ")})`;
  }

  function isImportAbortError(error) {
    return Boolean(
      error?.name === "AbortError"
      || error?.code === 20
      || /aborted|abort/i.test(String(error?.message || ""))
    );
  }

  function slimInteraktConversation(conversation, fieldMapping = state.importChat.fieldMapping) {
    const customer = conversation?.raw_chat?.customer_id && typeof conversation.raw_chat.customer_id === "object"
      ? conversation.raw_chat.customer_id
      : {};
    const traits = customer.traits && typeof customer.traits === "object" ? customer.traits : {};
    const mappedPaths = new Set(Object.values(fieldMapping || {}).filter(Boolean));
    const slimTraits = {};
    Object.entries(traits).forEach(([key, value]) => {
      if (mappedPaths.has(`traits.${key}`)) slimTraits[key] = value;
    });
    // Keep common fallbacks so remapping still works if the user changes selects mid-session.
    ["name", "Name", "full_name", "Company", "company", "company_name", "User Name"].forEach((key) => {
      if (traits[key] !== undefined && traits[key] !== null && traits[key] !== "") slimTraits[key] = traits[key];
    });
    const includeTags = mappedPaths.has("tags");
    return {
      id: conversation?.id || conversation?.raw_chat?.id || "",
      status: conversation?.status || conversation?.raw_chat?.chat_status || "",
      customer: {
        name: conversation?.customer?.name || "",
        phone: conversation?.customer?.phone || "",
      },
      raw_chat: {
        id: conversation?.raw_chat?.id || conversation?.id || "",
        chat_status: conversation?.raw_chat?.chat_status || conversation?.status || "",
        customer_id: {
          phone_number: customer.phone_number || "",
          country_code: customer.country_code || "",
          channel_phone_number: customer.channel_phone_number || "",
          channel_account_identifier: customer.channel_account_identifier || "",
          tags: includeTags && Array.isArray(customer.tags) ? customer.tags.slice(0, 20) : [],
          traits: slimTraits,
        },
      },
      messages: (Array.isArray(conversation?.messages) ? conversation.messages : []).map((message) => {
        const contentType = String(message?.content_type || message?.raw?.message_content_type || "");
        const slimMessage = {
          id: message?.id || "",
          channel_message_id: message?.channel_message_id || "",
          timestamp: message?.timestamp || "",
          direction: message?.direction || "",
          content_type: contentType,
          text: message?.text || "",
          media_url: message?.media_url || "",
          media_file_name: message?.media_file_name || "",
          status: message?.status || "",
          reply_to: message?.reply_to || message?.raw?.reply_channel_message_id || "",
        };
        const rawPatch = {};
        // Template bodies live in raw.raw_template; without it the API can only store
        // parameter values joined with middots (e.g. "Acme · 1200").
        if (contentType.toLowerCase() === "template") {
          const rawTemplate = message?.raw?.raw_template;
          if (rawTemplate !== undefined && rawTemplate !== null && rawTemplate !== "") {
            rawPatch.raw_template = rawTemplate;
          }
        }
        const errorCode = message?.raw?.channel_error_code ?? message?.channel_error_code;
        const failureReason = message?.raw?.channel_failure_reason
          || message?.channel_failure_reason
          || message?.failure_reason
          || "";
        if (errorCode !== undefined && errorCode !== null && String(errorCode).trim() !== "") {
          rawPatch.channel_error_code = errorCode;
        }
        if (String(failureReason).trim()) {
          rawPatch.channel_failure_reason = String(failureReason).trim();
        }
        [
          ["created_at_utc", message?.raw?.created_at_utc],
          ["delivered_at_utc", message?.raw?.delivered_at_utc || message?.delivered_at_utc],
          ["seen_at_utc", message?.raw?.seen_at_utc || message?.seen_at_utc],
          ["received_at_utc", message?.raw?.received_at_utc],
          ["modified_at_utc", message?.raw?.modified_at_utc],
          ["failed_at_utc", message?.raw?.failed_at_utc || message?.failed_at_utc],
        ].forEach(([key, value]) => {
          if (value !== undefined && value !== null && String(value).trim() !== "") {
            rawPatch[key] = value;
          }
        });
        if (Object.keys(rawPatch).length) slimMessage.raw = rawPatch;
        return slimMessage;
      }),
    };
  }

  function chunkInteraktConversations(conversations) {
    const batches = [];
    const maxMessages = 120;
    const maxBatchChars = 900_000;
    for (const conversation of conversations) {
      const slim = slimInteraktConversation(conversation);
      const messages = slim.messages;
      if (!messages.length) {
        batches.push({ ...slim, messages: [] });
        continue;
      }
      for (let index = 0; index < messages.length; index += maxMessages) {
        const slice = { ...slim, messages: messages.slice(index, index + maxMessages) };
        const encoded = JSON.stringify(slice);
        if (encoded.length <= maxBatchChars) {
          batches.push(slice);
          continue;
        }
        // Oversized message groups: send one message at a time.
        slice.messages.forEach((message) => {
          batches.push({ ...slim, messages: [message] });
        });
      }
    }
    return batches;
  }

  async function prepareImportChatFile(file) {
    if (!file) {
      state.importChat.fileName = "";
      state.importChat.conversations = [];
      state.importChat.conversationCount = 0;
      state.importChat.messageCount = 0;
      state.importChat.availableFields = [];
      state.importChat.sourceAssignments = {};
      state.importChat.fieldMapping = { name: "", phone: "", company: "", tags: "" };
      state.importChat.lastSummary = null;
      showImportChatResult(null);
      renderImportChatPage();
      return;
    }
    const source = $("importChatSource").value || "interakt";
    if (source !== "interakt") throw new Error("Only Interakt imports are available right now.");
    const text = await file.text();
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error("The selected file is not valid JSON."); }
    const conversations = Array.isArray(data?.conversations) ? data.conversations : null;
    if (!conversations) throw new Error("Interakt export must include a conversations array.");
    if (data.source && String(data.source).toLowerCase() !== "interakt") {
      throw new Error("This file does not look like an Interakt export.");
    }
    const availableFields = discoverInteraktContactFields(conversations);
    state.importChat.source = "interakt";
    state.importChat.fileName = file.name || "export.json";
    state.importChat.conversations = conversations;
    state.importChat.conversationCount = Number(data.conversation_count) || conversations.length;
    state.importChat.messageCount = Number(data.message_count)
      || conversations.reduce((total, item) => total + (Array.isArray(item.messages) ? item.messages.length : 0), 0);
    state.importChat.availableFields = availableFields;
    state.importChat.fieldMapping = defaultImportFieldMapping(availableFields);
    state.importChat.sourceAssignments = sourceAssignmentsFromFieldMapping(state.importChat.fieldMapping);
    state.importChat.lastSummary = null;
    showImportChatResult(null);
    renderImportChatPage();
  }

  async function runImportChat(event) {
    event.preventDefault();
    if (state.importChat.importing) return;
    if (!canAdmin()) {
      showToast("Import unavailable", "Only owners and admins can import chat history.", true);
      return;
    }
    const channelId = $("importChatChannel").value;
    const source = $("importChatSource").value || "interakt";
    const fieldMapping = { ...state.importChat.fieldMapping };
    if (!channelId) {
      showToast("Choose a channel", "Select the WhatsApp channel that should receive this history.", true);
      return;
    }
    if (!state.importChat.conversations.length) {
      showToast("Choose a file", "Upload an Interakt JSON export first.", true);
      return;
    }
    if (!fieldMapping.phone) {
      showToast("Map phone first", "Phone with country code is required to import WhatsApp chats.", true);
      return;
    }
    const batches = chunkInteraktConversations(state.importChat.conversations);
    const abortController = new AbortController();
    state.importChat.abortController = abortController;
    state.importChat.importing = true;
    const summary = {
      messagesImported: 0,
      messagesUpdated: 0,
      messagesSkipped: 0,
      contactsCreated: 0,
      contactsReused: 0,
      conversationsCreated: 0,
      conversationsReused: 0,
      failed: [],
      batchesCompleted: 0,
      batchesTotal: batches.length,
      cancelled: false,
    };
    state.importChat.lastSummary = summary;
    showImportChatResult(null);
    renderImportChatPage();
    let shouldReload = false;
    try {
      for (let index = 0; index < batches.length; index += 1) {
        if (abortController.signal.aborted) {
          summary.cancelled = true;
          break;
        }
        setImportChatProgress(index, batches.length, importChatProgressLabel(summary, index, batches.length));
        const result = await state.api.importChat({
          source,
          channelId,
          fieldMapping,
          conversations: [batches[index]],
        }, { signal: abortController.signal });
        summary.messagesImported += Number(result.messagesImported || 0);
        summary.messagesUpdated += Number(result.messagesUpdated || 0);
        summary.messagesSkipped += Number(result.messagesSkipped || 0);
        summary.contactsCreated += Number(result.contactsCreated || 0);
        summary.contactsReused += Number(result.contactsReused || 0);
        summary.conversationsCreated += Number(result.conversationsCreated || 0);
        summary.conversationsReused += Number(result.conversationsReused || 0);
        if (Array.isArray(result.failed)) summary.failed.push(...result.failed);
        summary.batchesCompleted = index + 1;
        state.importChat.lastSummary = summary;
        shouldReload = true;
      }
      if (abortController.signal.aborted) summary.cancelled = true;
      if (summary.cancelled) {
        setImportChatProgress(summary.batchesCompleted, batches.length || 1, "Import cancelled");
        showImportChatResult(summary);
        showToast(
          "Import cancelled",
          `${summary.messagesImported} messages imported before cancel${summary.messagesUpdated ? `, ${summary.messagesUpdated} updated` : ""}.`
        );
      } else {
        setImportChatProgress(batches.length, batches.length, "Import complete");
        showImportChatResult(summary);
        const updatedNote = summary.messagesUpdated
          ? ` (${summary.messagesUpdated} templates refreshed)`
          : "";
        showToast("Chat import complete", `${summary.messagesImported} messages imported${updatedNote}.`);
        shouldReload = true;
      }
      if (shouldReload) await loadAll({ preserveSelection: true });
    } catch (error) {
      if (isImportAbortError(error) || abortController.signal.aborted) {
        summary.cancelled = true;
        setImportChatProgress(summary.batchesCompleted, batches.length || 1, "Import cancelled");
        showImportChatResult(summary);
        showToast(
          "Import cancelled",
          `${summary.messagesImported} messages imported before cancel${summary.messagesUpdated ? `, ${summary.messagesUpdated} updated` : ""}.`
        );
        if (summary.batchesCompleted > 0) await loadAll({ preserveSelection: true });
      } else {
        showToast("Import failed", error.message, true);
        if (summary.batchesCompleted > 0) {
          showImportChatResult(summary);
          await loadAll({ preserveSelection: true });
        } else {
          setImportChatProgress(0, 0, "");
        }
      }
    } finally {
      state.importChat.importing = false;
      state.importChat.abortController = null;
      renderImportChatPage();
    }
  }

  function toggleSidebarNavigation(toggleId, childrenId, groupId = "") {
    const toggle = $(toggleId);
    const children = $(childrenId);
    const opening = children.hidden;
    children.hidden = !opening;
    toggle.setAttribute("aria-expanded", String(opening));
    if (groupId) $(groupId).classList.toggle("is-open", opening);
    if (opening) children.querySelector("[data-route]")?.focus();
  }

  function toggleDetails() {
    if (!selectedConversation()) return;
    state.detailsOpen = !state.detailsOpen;
    updateDetailsVisibility();
  }

  function updateDetailsVisibility() {
    $("detailsPanel").hidden = !state.detailsOpen;
    $("inboxGrid").classList.toggle("has-details", state.detailsOpen);
    document.querySelectorAll('[data-action="toggle-details"]').forEach((button) => {
      button.setAttribute("aria-expanded", String(state.detailsOpen));
    });
  }

  async function logout() {
    if (state.notificationsEnabled) {
      state.notificationsEnabled = false;
      localStorage.setItem(NOTIFICATION_PREFERENCE_KEY, "false");
      await removeBrowserPushSubscription();
    }
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
    $("channelDeleteButton").hidden = !channel;
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

  async function deleteEditingChannel() {
    const channelId = String($("channelIdInput").value || "");
    const channel = state.channels.find((item) => item.channelId === channelId);
    if (!canAdmin() || !channel) return;
    const providerName = providerProfiles[channel.connectorType]?.label || "provider";
    const relatedConversationIds = new Set(state.conversations.filter((conversation) => conversation.channelId === channelId)
      .map((conversation) => conversation.conversationId));
    const confirmed = await requestConfirmation({
      title: `Delete ${channel.name}?`,
      message: "This removes the channel connection, credentials, contacts, conversations, and stored messages from Helixcer.",
      note: `Only Helixcer data will be deleted. The original ${providerName} account, phone number, bot, profile, and provider-side message history will not be changed.`,
      confirmLabel: "Delete channel",
    });
    if (!confirmed) return;
    try {
      await state.api.deleteChannel(channelId);
      relatedConversationIds.forEach((conversationId) => {
        state.messages.delete(conversationId);
        state.conversationRevisions.delete(conversationId);
      });
      state.channels = state.channels.filter((item) => item.channelId !== channelId);
      state.conversations = state.conversations.filter((conversation) => !relatedConversationIds.has(conversation.conversationId));
      state.expandedChannelIds.delete(channelId);
      state.recentVerifyTokens.delete(channelId);
      state.whatsappTemplates = state.whatsappTemplates.filter((template) => template.channelId !== channelId);
      state.whatsappTemplateFilters.channel.delete(channelId);
      if (relatedConversationIds.has(state.selectedConversationId)) clearSelectedConversation();
      $("channelDialog").close();
      // Reload the authoritative contact list because a contact can have identities
      // on more than one channel. The server preserves those shared contacts.
      await loadAll({ preserveSelection: true });
      if (state.selectedContactId && !state.contacts.some((contact) => contact.contactId === state.selectedContactId)) {
        closeContactEditor();
      }
      setRoute("channels");
      showToast("Channel deleted from Helixcer", `${channel.name} was removed. The original ${providerName} account was not changed.`);
    } catch (error) {
      showToast("Channel was not deleted", error.message, true);
    }
  }

  function openContactDialog() {
    $("contactForm").reset();
    renderContactPlatformIdFields($("contactCreatePlatformIds"), null, "create");
    $("contactDialog").showModal();
    $("contactForm").elements.displayName?.focus();
  }

  async function createContact(form) {
    const formData = new FormData(form);
    let platformIds;
    try {
      platformIds = validateContactPlatformIds(collectContactPlatformIds($("contactCreatePlatformIds")));
    } catch (error) {
      showToast("Contact needs attention", error.message, true);
      return;
    }
    const payload = {
      displayName: String(formData.get("displayName") || "").trim(),
      company: String(formData.get("company") || "").trim(),
      tags: String(formData.get("tags") || "").split(/[,\n]/).map((tag) => tag.trim()).filter(Boolean),
      platformIds,
    };
    if (!payload.displayName) {
      form.reportValidity();
      return;
    }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await state.api.createContact(payload);
      $("contactDialog").close();
      form.reset();
      $("contactCreatePlatformIds").replaceChildren();
      await loadAll({ preserveSelection: false });
      setRoute("contacts");
      // Creating a contact should not navigate into a chat or open the detail
      // editor. Keep Contacts as the neutral landing view so the user can
      // choose what to open next.
      closeContactEditor();
      const idCount = Object.values(platformIds).filter(Boolean).length;
      showToast("Contact created", `${payload.displayName} was added with ${idCount} messaging ID${idCount === 1 ? "" : "s"}.`);
    } catch (error) {
      showToast("Contact could not be created", error.message, true);
    } finally {
      submit.disabled = false;
    }
  }

  async function exportContacts(button) {
    const previous = button?.textContent || "Export contacts";
    if (button) {
      button.disabled = true;
      button.textContent = "Exporting…";
    }
    try {
      const csv = await state.api.exportContacts();
      const blob = new Blob([String(csv || "")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `helixcer-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("Contacts exported", "Each contact is one CSV row with a separate column for every platform ID.");
    } catch (error) {
      showToast("Contacts could not be exported", error.message, true);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = previous;
      }
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

  function finishConfirmation(confirmed, { close = true } = {}) {
    const resolve = state.confirmationResolve;
    state.confirmationResolve = null;
    const dialog = $("confirmationDialog");
    if (close && dialog.open) dialog.close();
    if (resolve) resolve(Boolean(confirmed));
  }

  function requestConfirmation({ eyebrow = "Confirm deletion", title, message, note = "", confirmLabel = "Delete" }) {
    if (state.confirmationResolve) finishConfirmation(false);
    $("confirmationEyebrow").textContent = eyebrow;
    $("confirmationTitle").textContent = title;
    $("confirmationMessage").textContent = message;
    $("confirmationNote").textContent = note;
    $("confirmationNote").hidden = !note;
    $("confirmationSubmit").textContent = confirmLabel;
    return new Promise((resolve) => {
      state.confirmationResolve = resolve;
      $("confirmationDialog").showModal();
    });
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

  function isConversationActivelyViewed(conversationId) {
    const documentFocused = typeof document.hasFocus !== "function" || document.hasFocus();
    return Boolean(conversationId) &&
      state.route === "inbox" &&
      state.selectedConversationId === conversationId &&
      !state.detailsOpen &&
      document.visibilityState === "visible" &&
      documentFocused;
  }

  function closeConversationActionMenu({ restoreFocus = false } = {}) {
    const menu = $("conversationActionMenu");
    const button = $("conversationMenuButton");
    if (!menu || !button || menu.hidden) return;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (restoreFocus) button.focus();
  }

  function toggleConversationActionMenu() {
    const menu = $("conversationActionMenu");
    const button = $("conversationMenuButton");
    if (!canAdmin() || !selectedConversation() || !menu || !button) return;
    const opening = menu.hidden;
    menu.hidden = !opening;
    button.setAttribute("aria-expanded", String(opening));
    if (opening) menu.querySelector("button")?.focus();
  }

  function clearSelectedConversation({ updateUrl = true } = {}) {
    const conversationId = state.selectedConversationId;
    closeConversationActionMenu();
    closeComposerRouteMenu();
    discardAttachmentQueue(conversationId);
    if (state.templateConversationId === conversationId) closeTemplateDialog();
    state.selectedConversationId = null;
    state.pendingConversationId = null;
    state.unreadMarker = null;
    resetNewMessagesBelow("");
    state.replyingTo = null;
    state.detailsOpen = false;
    $("inboxGrid").classList.remove("chat-open", "has-details");
    renderConversationList();
    renderSelectedConversation();
    if (updateUrl && state.route === "inbox") replaceAppHash("#inbox");
  }

  async function deleteSelectedConversation() {
    const conversation = selectedConversation();
    if (!canAdmin() || !conversation) return;
    closeConversationActionMenu();
    const confirmed = await requestConfirmation({
      title: `Delete conversation with ${conversation.subject}?`,
      message: "This permanently deletes this conversation, its message history, and attachment media from Helixcer so that storage can be reused.",
      note: "The contact and the original provider account are not deleted. A future customer message may create a new conversation.",
      confirmLabel: "Delete conversation",
    });
    if (!confirmed) return;
    try {
      closeAttachmentPreview();
      const result = await state.api.deleteConversation(conversation.conversationId);
      state.messages.delete(conversation.conversationId);
      state.conversationRevisions.delete(conversation.conversationId);
      state.conversations = state.conversations.filter((item) => item.conversationId !== conversation.conversationId);
      clearSelectedConversation();
      renderCounts();
      renderContacts();
      renderChannels();
      const deletedMedia = Number(result?.deletedMedia || 0);
      showToast(
        "Conversation deleted",
        deletedMedia > 0
          ? `${conversation.subject}'s conversation and ${deletedMedia} media file${deletedMedia === 1 ? "" : "s"} were removed.`
          : `${conversation.subject}'s conversation was removed from Helixcer.`
      );
    } catch (error) {
      showToast("Conversation was not deleted", error.message, true);
    }
  }

  function contactFor(conversation) {
    return state.contacts.find((contact) => contact.contactId === conversation.contactId) || null;
  }

  function contactIdentityForConversation(conversation, contact = contactFor(conversation)) {
    if (!contact || !conversation) return null;
    const identities = asItems(contact.identities);
    if (conversation.contactIdentityId) {
      const exact = identities.find((identity) => identity.identityId === conversation.contactIdentityId);
      if (exact) return exact;
    }
    const routed = identities.find((identity) => asItems(identity.bindings || identity.routes).some((binding) =>
      binding.channelId === conversation.channelId &&
      (!conversation.channelProfileId || !binding.scopedProfileId || binding.scopedProfileId === conversation.channelProfileId)));
    if (routed) return routed;
    const legacy = identities.find((identity) =>
      identity.channelId === conversation.channelId &&
      (!conversation.channelProfileId || !identity.profileId || identity.profileId === conversation.channelProfileId));
    return legacy || identities.find((identity) => identity.isPrimary) || identities[0] || null;
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

  function formatClock(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const day = String(date.getDate()).padStart(2, "0");
    const year = date.getFullYear() === new Date().getFullYear() ? "" : ` ${date.getFullYear()}`;
    const hour = String(date.getHours() % 12 || 12).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    const period = date.getHours() < 12 ? "am" : "pm";
    return `${day} ${monthNames[date.getMonth()]}${year} · ${hour}:${minute} ${period}`;
  }

  function formatStatusHistoryTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours() % 12 || 12).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    const second = String(date.getSeconds()).padStart(2, "0");
    const period = date.getHours() < 12 ? "am" : "pm";
    return `${day}-${monthNames[date.getMonth()]}-${date.getFullYear()} · ${hour}:${minute}:${second} ${period}`;
  }

  function formatCalendarDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, {
      day: "numeric", month: "short", year: "numeric",
    }).format(date);
  }

  function closeMessageStatusMenu(restoreFocus = false) {
    const current = state.messageStatusMenu;
    if (!current) return;
    current.trigger?.setAttribute("aria-expanded", "false");
    current.trigger?.removeAttribute("aria-controls");
    current.menu?.remove();
    state.messageStatusMenu = null;
    if (restoreFocus && current.trigger?.isConnected) current.trigger.focus();
  }

  function renderMessageStatusMenuContent(menu, entries) {
    if (!menu) return;
    menu.replaceChildren();
    menu.append(element("div", "message-status-menu-title", "Status history"));
    const list = element("div", "message-status-menu-list");
    entries.forEach((entry) => {
      const row = element("div", "message-status-menu-row");
      const label = element("span", "message-status-menu-label", `${entry.label}:\u00a0`);
      const time = element("span", "message-status-menu-time", entry.when);
      row.append(label, time);
      list.append(row);
    });
    menu.append(list);
  }

  function positionMessageStatusMenu() {
    const current = state.messageStatusMenu;
    if (!current?.trigger?.isConnected || !current?.menu?.isConnected) {
      closeMessageStatusMenu();
      return;
    }
    const triggerRect = current.trigger.getBoundingClientRect();
    if (triggerRect.bottom < 0 || triggerRect.top > window.innerHeight ||
        triggerRect.right < 0 || triggerRect.left > window.innerWidth) {
      closeMessageStatusMenu();
      return;
    }
    const edge = 8;
    const gap = 6;
    const width = Math.max(1, Math.min(260, window.innerWidth - (edge * 2)));
    current.menu.style.width = `${width}px`;
    current.menu.style.left = `${Math.min(Math.max(edge, triggerRect.right - width), window.innerWidth - width - edge)}px`;
    current.menu.style.top = `${triggerRect.bottom + gap}px`;
    current.menu.style.visibility = "hidden";
    const menuHeight = current.menu.getBoundingClientRect().height;
    const below = window.innerHeight - triggerRect.bottom - gap - edge;
    const above = triggerRect.top - gap - edge;
    const top = below < Math.min(menuHeight, 180) && above > below
      ? Math.max(edge, triggerRect.top - Math.min(menuHeight, above) - gap)
      : Math.min(triggerRect.bottom + gap, window.innerHeight - Math.min(menuHeight, window.innerHeight - (edge * 2)) - edge);
    current.menu.style.top = `${Math.max(edge, top)}px`;
    current.menu.style.visibility = "visible";
  }

  function toggleMessageStatusHistory(messageId, trigger) {
    if (state.messageStatusMenu?.messageId === messageId) {
      closeMessageStatusMenu(true);
      return;
    }
    closeMessageStatusMenu();
    const conversationId = state.selectedConversationId;
    const message = (state.messages.get(conversationId) || [])
      .find((item) => item.messageId === messageId);
    const entries = messageStatusHistoryEntries(message);
    if (!entries.length || !trigger) return;
    const menu = element("section", "message-status-menu");
    const menuId = `message-status-menu-${String(messageId).replace(/[^a-z0-9_-]/gi, "-")}`;
    menu.id = menuId;
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", "Message status history");
    renderMessageStatusMenuContent(menu, entries);
    document.body.append(menu);
    trigger.setAttribute("aria-expanded", "true");
    trigger.setAttribute("aria-controls", menuId);
    state.messageStatusMenu = { trigger, menu, messageId };
    positionMessageStatusMenu();
  }

  function resizeComposer() {
    const input = $("messageInput");
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
  }

  function usesMobileComposerKeyboard() {
    if (typeof navigator.userAgentData?.mobile === "boolean") return navigator.userAgentData.mobile;
    if (/android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent || "")) return true;
    return navigator.maxTouchPoints > 1 && window.matchMedia?.("(pointer: coarse)")?.matches === true;
  }

  function updateComposerKeyboardHint() {
    $("sendHint").textContent = usesMobileComposerKeyboard()
      ? "Use Send to send"
      : "Enter to send · Shift+Enter for a new line";
  }

  function handleComposerKeydown(event) {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing || usesMobileComposerKeyboard()) return;
    event.preventDefault();
    if (!event.repeat) sendCurrentMessage();
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      if (state.contactRouteMenu &&
          !state.contactRouteMenu.menu.contains(event.target) &&
          !state.contactRouteMenu.trigger.contains(event.target)) closeContactRouteMenu();
      if (state.contactPlatformMenu &&
          !state.contactPlatformMenu.menu.contains(event.target) &&
          !state.contactPlatformMenu.trigger.contains(event.target)) closeContactPlatformMenu();
      if (state.messageStatusMenu &&
          !state.messageStatusMenu.menu.contains(event.target) &&
          !state.messageStatusMenu.trigger.contains(event.target)) closeMessageStatusMenu();
      if (!event.target.closest(".template-filter")) closeTemplateFilterMenus();
      if (!event.target.closest(".conversation-filter-desktop")) closeConversationFilterMenu();
      if (!event.target.closest(".conversation-menu-wrap")) closeConversationActionMenu();
      if (!event.target.closest(".composer-route-wrap")) closeComposerRouteMenu();
      const routeButton = event.target.closest("[data-route]");
      if (routeButton) { setRoute(routeButton.dataset.route); return; }
      const actionButton = event.target.closest("[data-action]");
      if (actionButton) {
        if (actionButton.dataset.action === "toggle-message-status-history") {
          toggleMessageStatusHistory(actionButton.dataset.messageId, actionButton);
          return;
        }
        if (actionButton.dataset.action === "choose-composer-route") {
          chooseComposerRoute(actionButton.dataset.routeIndex);
          return;
        }
        if (actionButton.dataset.action === "toggle-channel-nav") {
          toggleSidebarNavigation("channelNavToggle", "channelNavChildren", "channelNavGroup");
          return;
        }
        if (actionButton.dataset.action === "toggle-channel-data-nav") {
          toggleSidebarNavigation("channelDataNavToggle", "channelDataNavChildren");
          return;
        }
        if (actionButton.dataset.action === "toggle-template-filter") {
          toggleTemplateFilterMenu(actionButton.dataset.filterType);
          return;
        }
        if (actionButton.dataset.action === "toggle-conversation-filters") {
          toggleConversationFilterMenu();
          return;
        }
        if (actionButton.dataset.action === "clear-conversation-filters") {
          state.filters.clear();
          renderConversationFilterControls();
          renderConversationList();
          closeConversationFilterMenu({ restoreFocus: true });
          return;
        }
        if (actionButton.dataset.action === "clear-template-filter") {
          state.whatsappTemplateFilters[actionButton.dataset.filterType]?.clear();
          renderWhatsAppTemplateLibrary();
          return;
        }
        if (actionButton.dataset.action === "clear-all-template-filters") {
          clearWhatsAppTemplateFilters();
          return;
        }
        if (actionButton.dataset.action === "remove-template-filter") {
          state.whatsappTemplateFilters[actionButton.dataset.filterType]?.delete(actionButton.dataset.filterValue);
          renderWhatsAppTemplateLibrary();
          return;
        }
        if (actionButton.dataset.action === "refresh-whatsapp-templates") {
          loadWhatsAppTemplateLibrary({ refresh: true });
          return;
        }
        if (actionButton.dataset.deleteApiKey) {
          deleteDeveloperApiKey(actionButton.dataset.deleteApiKey, actionButton);
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
        if (actionButton.dataset.action === "copy-channel-id") {
          copyDeveloperApiValue(actionButton.dataset.copyValue, "Channel ID copied");
          return;
        }
        if (actionButton.dataset.action === "copy-webhook-token") {
          copyWebhookVerifyToken(actionButton);
          return;
        }
        if (actionButton.dataset.action === "remove-queued-attachment") {
          removeQueuedAttachment(actionButton.dataset.attachmentId);
          return;
        }
        if (actionButton.dataset.action === "reply-to-message") {
          startReplyToMessage(actionButton.dataset.messageId);
          return;
        }
        if (actionButton.dataset.action === "jump-to-message") {
          jumpToMessage(actionButton.dataset.messageId);
          return;
        }
        if (actionButton.dataset.action === "preview-attachment") {
          openAttachmentPreview(actionButton.dataset.messageId);
          return;
        }
        if (actionButton.dataset.action === "edit-webhook-token") {
          openWebhookTokenDialog(actionButton.dataset.channelId);
          return;
        }
        if (actionButton.dataset.action === "open-contact-identity-default") {
          openContactIdentityDefault(actionButton.dataset.contactId, actionButton.dataset.identityId);
          return;
        }
        if (actionButton.dataset.action === "choose-contact-identity-route") {
          chooseContactIdentityRoute(actionButton.dataset.contactId, actionButton.dataset.identityId, actionButton);
          return;
        }
        if (actionButton.dataset.action === "choose-contact-route") {
          const route = state.contactRouteMenu?.routes?.[Number(actionButton.dataset.routeIndex)];
          if (route) openContactRoute(route);
          return;
        }
        if (actionButton.dataset.action === "toggle-contact-platform-menu") {
          showContactPlatformMenu(actionButton);
          return;
        }
        if (actionButton.dataset.action === "choose-contact-platform-id") {
          addContactPlatformId(actionButton.dataset.platform);
          return;
        }
        const actions = {
          "toggle-composer-route-menu": toggleComposerRouteMenu,
          "toggle-user-menu": () => toggleUserMenu(),
          "logout": logout,
          "toggle-details": toggleDetails,
          "toggle-conversation-menu": toggleConversationActionMenu,
          "delete-conversation": deleteSelectedConversation,
          "open-channel": () => openChannelDialog(),
          "close-channel-dialog": () => $("channelDialog").close(),
          "delete-channel": deleteEditingChannel,
          "close-webhook-token": () => $("webhookTokenDialog").close(),
          "generate-webhook-token": () => {
            const input = $("webhookTokenInput");
            input.value = generatePrivateToken();
            input.focus();
          },
          "new-conversation": openContactDialog,
          "new-contact": openContactDialog,
          "export-contacts": () => exportContacts(actionButton),
          "close-contact-dialog": () => $("contactDialog").close(),
          "close-contact-editor": closeContactEditor,
          "delete-contact": deleteSelectedContact,
          "cancel-contact-edit": () => {
            const contact = state.contacts.find((item) => item.contactId === state.selectedContactId);
            if (contact) showContactEditor(contact);
            else closeContactEditor();
          },
          "choose-attachment": () => $("attachmentInput").click(),
          "cancel-reply": clearReplyTarget,
          "close-attachment-preview": closeAttachmentPreview,
          "open-template": openTemplateDialog,
          "close-template": closeTemplateDialog,
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
          "invite-select-all-channels": toggleInviteSelectAllChannels,
          "copy-invite-link": copyInviteLink,
          "open-api-key": openApiKeyDialog,
          "close-api-key": closeApiKeyDialog,
          "copy-api-base": () => copyDeveloperApiValue($("developerApiBase").textContent, "API base URL copied"),
          "copy-api-key": () => copyDeveloperApiValue($("apiKeyOutput").value, "API key copied"),
          "copy-workspace-id": () => copyDeveloperApiValue($("workspaceId").value, "Workspace ID copied"),
          "cancel-confirmation": () => finishConfirmation(false),
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

    let replySwipe = null;
    const messageThread = $("messageThread");
    messageThread.addEventListener("scroll", () => {
      if (messageThreadNearBottom(messageThread)) resetNewMessagesBelow(state.selectedConversationId);
      else renderMessageJumpButton();
    }, { passive: true });
    $("messageJumpButton").addEventListener("click", () => {
      messageThread.scrollTop = messageThread.scrollHeight;
      resetNewMessagesBelow(state.selectedConversationId);
    });
    messageThread.addEventListener("pointerdown", (event) => {
      const row = event.target.closest(".message-row[data-replyable='true']");
      if (!row || event.button > 0 || event.target.closest("button,a,input,video,audio")) return;
      replySwipe = { row, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, offset: 0, horizontal: false };
      row.setPointerCapture?.(event.pointerId);
    });
    messageThread.addEventListener("pointermove", (event) => {
      if (!replySwipe || replySwipe.pointerId !== event.pointerId) return;
      const dx = event.clientX - replySwipe.startX;
      const dy = event.clientY - replySwipe.startY;
      if (!replySwipe.horizontal && Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (!replySwipe.horizontal && Math.abs(dy) > Math.abs(dx)) {
        replySwipe = null;
        return;
      }
      replySwipe.horizontal = true;
      replySwipe.offset = Math.max(0, Math.min(72, dx));
      replySwipe.row.style.setProperty("--reply-swipe", `${replySwipe.offset}px`);
      replySwipe.row.classList.toggle("is-swipe-ready", replySwipe.offset >= 52);
    });
    const finishReplySwipe = (event) => {
      if (!replySwipe || (event.pointerId !== undefined && replySwipe.pointerId !== event.pointerId)) return;
      const { row, offset } = replySwipe;
      row.style.removeProperty("--reply-swipe");
      row.classList.remove("is-swipe-ready");
      replySwipe = null;
      if (offset >= 52) startReplyToMessage(row.dataset.messageId);
    };
    messageThread.addEventListener("pointerup", finishReplySwipe);
    messageThread.addEventListener("pointercancel", finishReplySwipe);

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
      toggleConversationFilter(button.dataset.filter);
    });
    $("conversationFilterMenu").addEventListener("change", (event) => {
      const input = event.target.closest("[data-conversation-filter-option]");
      if (input) toggleConversationFilter(input.value);
    });

    $("conversationSearch").addEventListener("input", (event) => { state.search = event.target.value; renderConversationList(); });
    $("contactSearch").addEventListener("input", (event) => { state.contactSearch = event.target.value; renderContacts(); });
    $("whatsappTemplateSearch").addEventListener("input", (event) => {
      state.whatsappTemplateSearch = event.target.value;
      renderWhatsAppTemplateResults();
    });
    $("whatsappTemplatesRoute").addEventListener("input", (event) => {
      const type = event.target.dataset.templateFilterSearch;
      if (type) renderTemplateFilterOptions(type, event.target.value);
    });
    $("whatsappTemplatesRoute").addEventListener("change", (event) => {
      const type = event.target.dataset.templateFilterOption;
      if (!type || !state.whatsappTemplateFilters[type]) return;
      if (event.target.checked) state.whatsappTemplateFilters[type].add(event.target.value);
      else state.whatsappTemplateFilters[type].delete(event.target.value);
      renderWhatsAppTemplateResults();
    });
    $("refreshButton").addEventListener("click", () => state.route === "whatsapp-templates"
      ? loadWhatsAppTemplateLibrary({ refresh: true })
      : state.route === "import-chat" ? renderImportChatPage()
      : state.route === "workspace" ? loadWorkspaceProfile({ force: true }) : loadAll());
    $("mobileMenu").addEventListener("click", openMobileMenu);
    $("mobileScrim").addEventListener("click", closeMobileMenu);
    $("mobileBack").addEventListener("click", () => clearSelectedConversation());

    $("messageForm").addEventListener("submit", (event) => { event.preventDefault(); });
    $("sendButton").addEventListener("click", sendCurrentMessage);
    $("messageInput").addEventListener("input", resizeComposer);
    $("messageInput").addEventListener("keydown", handleComposerKeydown);
    $("attachmentInput").addEventListener("change", (event) => queueCurrentAttachments(event.target.files));
    $("pushNotificationsToggle").addEventListener("click", (event) => setBrowserNotifications(event.target.checked));
    $("workspaceProfileForm").addEventListener("submit", (event) => {
      event.preventDefault();
      saveWorkspaceProfile(event.currentTarget);
    });
    $("workspaceGstin").addEventListener("input", (event) => {
      event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      event.target.setCustomValidity("");
    });
    $("importChatForm").addEventListener("submit", runImportChat);
    $("importChatCancel").addEventListener("click", cancelImportChat);
    $("importChatSource").addEventListener("change", (event) => {
      state.importChat.source = event.target.value || "interakt";
    });
    $("importChatFile").addEventListener("change", async (event) => {
      try {
        await prepareImportChatFile(event.target.files?.[0] || null);
      } catch (error) {
        event.target.value = "";
        state.importChat.conversations = [];
        state.importChat.conversationCount = 0;
        state.importChat.messageCount = 0;
        state.importChat.availableFields = [];
        state.importChat.sourceAssignments = {};
        state.importChat.fieldMapping = { name: "", phone: "", company: "", tags: "" };
        renderImportChatPage();
        showToast("File not ready", error.message, true);
      }
    });

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
    $("contactForm").addEventListener("submit", (event) => { event.preventDefault(); createContact(event.currentTarget); });
    $("contactEditForm").addEventListener("submit", (event) => { event.preventDefault(); saveContactEdits(event.currentTarget); });
    $("templateSearch").addEventListener("focus", (event) => {
      const query = event.target.value === event.target.dataset.selectedLabel ? "" : event.target.value;
      renderTemplateSelectOptions(query);
    });
    $("templateSearch").addEventListener("click", (event) => {
      const query = event.target.value === event.target.dataset.selectedLabel ? "" : event.target.value;
      renderTemplateSelectOptions(query);
    });
    $("templateSearch").addEventListener("input", (event) => {
      invalidateTemplateSelection(event.target);
      renderTemplateSelectOptions(event.target.value);
    });
    $("templateSearch").addEventListener("keydown", (event) => {
      searchableComboboxInputKeydown(event, event.currentTarget, $("templateOptions"));
    });
    $("templateOptions").addEventListener("click", (event) => {
      const option = event.target.closest(".searchable-combobox-option");
      if (option) chooseTemplateOption(option.dataset.value, option.dataset.label);
    });
    $("templateOptions").addEventListener("keydown", (event) => {
      if (event.target.matches(".searchable-combobox-option")) {
        searchableComboboxOptionKeydown(event, $("templateSearch"), $("templateOptions"));
      }
    });
    $("templateVariableFields").addEventListener("change", (event) => {
      const row = event.target.closest(".template-variable-row");
      if (row) syncTemplateVariableSource(row);
    });
    $("templateVariableFields").addEventListener("focusin", (event) => {
      if (!event.target.matches(".template-source-combobox-input")) return;
      const row = event.target.closest(".template-variable-row");
      const query = event.target.value === event.target.dataset.selectedLabel ? "" : event.target.value;
      filterTemplateSourceOptions(row, query);
    });
    $("templateVariableFields").addEventListener("click", (event) => {
      const option = event.target.closest(".template-source-menu .searchable-combobox-option");
      if (option) {
        chooseTemplateSource(option.closest(".template-variable-row"), option.dataset.value, option.dataset.label);
        return;
      }
      if (event.target.matches(".template-source-combobox-input")) {
        const row = event.target.closest(".template-variable-row");
        const query = event.target.value === event.target.dataset.selectedLabel ? "" : event.target.value;
        filterTemplateSourceOptions(row, query);
      }
    });
    $("templateVariableFields").addEventListener("input", (event) => {
      const row = event.target.closest(".template-variable-row");
      if (!row) return;
      if (event.target.matches(".template-source-combobox-input")) {
        invalidateTemplateSourceSelection(row, event.target);
        filterTemplateSourceOptions(row, event.target.value);
      }
      else syncTemplateVariableSource(row);
    });
    $("templateVariableFields").addEventListener("keydown", (event) => {
      const row = event.target.closest(".template-variable-row");
      if (!row) return;
      const input = row.querySelector(".template-source-combobox-input");
      const menu = row.querySelector(".template-source-menu");
      if (event.target === input) searchableComboboxInputKeydown(event, input, menu);
      else if (event.target.matches(".searchable-combobox-option")) searchableComboboxOptionKeydown(event, input, menu);
    });
    document.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".searchable-combobox")) return;
      document.querySelectorAll(".searchable-combobox-input").forEach((input) => {
        const menu = document.getElementById(input.getAttribute("aria-controls"));
        input.value = input.dataset.selectedLabel || input.value;
        setSearchableComboboxOpen(input, menu, false);
      });
    });
    $("templateForm").addEventListener("submit", (event) => { event.preventDefault(); sendCurrentTemplate(event.currentTarget); });
    $("templateDialog").addEventListener("close", () => {
      revokeTemplatePreviewUrl();
      state.templateConversationId = null;
    });
    $("attachmentPreviewDialog").addEventListener("close", () => {
      $("attachmentPreviewDialog").querySelectorAll("video,audio").forEach((media) => media.pause());
      $("attachmentPreviewBody").replaceChildren();
    });
    $("inviteForm").addEventListener("submit", (event) => { event.preventDefault(); inviteMember(event.currentTarget); });
    $("apiKeyForm").addEventListener("submit", (event) => { event.preventDefault(); createDeveloperApiKey(event.currentTarget); });
    $("confirmationForm").addEventListener("submit", (event) => { event.preventDefault(); finishConfirmation(true); });
    $("confirmationDialog").addEventListener("cancel", (event) => { event.preventDefault(); finishConfirmation(false); });
    $("confirmationDialog").addEventListener("close", () => {
      if (state.confirmationResolve) finishConfirmation(false, { close: false });
    });
    $("inviteRole").addEventListener("change", updateInviteRoleHelp);
    $("inviteChannelOptions")?.addEventListener("change", (event) => {
      if (event.target?.matches?.('input[type="checkbox"]')) updateInviteSelectAllLabel();
    });
    $("teamTableBody").addEventListener("change", (event) => {
      const select = event.target.closest("[data-member-role]");
      if (select) changeMemberRole(select.dataset.memberRole, select.value, select);
    });
    $("teamTableBody").addEventListener("click", (event) => {
      const deleteButton = event.target.closest("[data-delete-member]");
      if (deleteButton) {
        deleteTeamMember(deleteButton.dataset.deleteMember);
        return;
      }
      const toggleButton = event.target.closest("[data-toggle-member]");
      if (toggleButton) toggleMember(toggleButton.dataset.toggleMember);
    });
    $("invitationList").addEventListener("click", (event) => {
      const button = event.target.closest("[data-cancel-invitation]");
      if (button) cancelInvitation(button.dataset.cancelInvitation);
    });
    window.addEventListener("hashchange", () => applyLocationRoute().catch(() => {}));
    window.addEventListener("focus", () => prepareBrowserPush().catch(() => {}));
    window.addEventListener("resize", positionContactRouteMenu);
    window.addEventListener("resize", positionContactPlatformMenu);
    window.addEventListener("resize", positionMessageStatusMenu);
    document.addEventListener("scroll", positionContactRouteMenu, true);
    document.addEventListener("scroll", positionMessageStatusMenu, true);
    document.addEventListener("scroll", positionContactPlatformMenu, true);
    window.addEventListener("pagehide", () => state.disconnectRealtime?.());
    window.addEventListener("beforeunload", () => state.disconnectRealtime?.());
    window.addEventListener("helixcer:unauthorized", () => showSignedOut("Your session expired. Sign in again to continue."));
    document.addEventListener("keydown", (event) => {
      if (event.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) {
        event.preventDefault();
        setRoute("inbox");
        $("conversationSearch").focus();
      }
      if (event.key === "Escape") {
        closeMessageStatusMenu(true);
        closeContactRouteMenu({ restoreFocus: true });
        closeContactPlatformMenu({ restoreFocus: true });
        closeConversationActionMenu({ restoreFocus: true });
        closeTemplateFilterMenus("", { restoreFocus: true });
        closeConversationFilterMenu({ restoreFocus: true });
        closeMobileMenu();
      }
    });
    const resumeLiveWorkspace = () => {
      if (state.authStatus !== "authenticated") return;
      state.api?.ensureRealtimeConnected?.({ resume: true });
      reconcileWorkspace().catch(() => {});
    };
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      prepareBrowserPush().catch(() => {});
      resumeLiveWorkspace();
    });
    window.addEventListener("focus", resumeLiveWorkspace);
    window.addEventListener("pageshow", resumeLiveWorkspace);
    window.addEventListener("online", resumeLiveWorkspace);
  }

  async function init() {
    bindEvents();
    updateComposerKeyboardHint();
    await applyLocationRoute();
    await initializeSession();
  }

  init();
})();
