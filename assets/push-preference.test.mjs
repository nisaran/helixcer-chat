import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const app = await readFile(new URL("./app.js", import.meta.url), "utf8");
function extract(name) {
  const pattern = new RegExp("  (?:async )?function " + name + "\\(");
  const start = app.search(pattern);
  const rest = app.slice(start + 1);
  const next = rest.search(/\n  (?:async )?function /);
  return app.slice(start, next < 0 ? undefined : start + 1 + next);
}
function setup() {
  const saved = new Map([["pref", "true"]]);
  let retries = 0, removals = 0;
  const state = { authStatus: "authenticated", notificationsEnabled: true, pushSubscriptionReady: false, pushConfig: { available: true }, messages: new Map(), api: { async logout() {} } };
  const context = vm.createContext({ state, Notification: { permission: "granted" },
    NOTIFICATION_PREFERENCE_KEY: "pref", RECOVERY_TOKEN_KEY: "recovery",
    localStorage: { setItem: (k,v) => saved.set(k,v) }, sessionStorage: { removeItem() {} },
    window: { clearTimeout() {}, setTimeout() { retries++; return 1; } },
    $: () => ({ blur() {} }), notificationSupport: () => true, backgroundPushSupport: () => true,
    loadPushConfiguration: async () => {}, ensureServiceWorkerRegistration: async () => ({}),
    subscribeBrowserPush: async () => { throw Error("Temporary outage"); },
    removeBrowserPushSubscription: async () => { removals++; state.pushSubscriptionReady = false; },
    renderNotificationSetting() {}, showToast() {}, showSignedOut() {}, setAuthPanel() {},
  });
  return { context, state, saved, retries: () => retries, removals: () => removals };
}
test("temporary push sync failure preserves preference and schedules reconnect", async () => {
  const h = setup();
  vm.runInContext(extract("scheduleBrowserPushRetry") + extract("prepareBrowserPush"), h.context);
  await vm.runInContext("prepareBrowserPush()", h.context);
  assert.equal(h.saved.get("pref"), "true");
  assert.equal(h.state.notificationsEnabled, true);
  assert.equal(h.retries(), 1);
});
test("test notification failure does not disable a working subscription", async () => {
  const h = setup();
  h.context.subscribeBrowserPush = async () => { h.state.pushSubscriptionReady = true; return { showNotification: async () => { throw Error("Test unavailable"); } }; };
  vm.runInContext(extract("setBrowserNotifications"), h.context);
  await vm.runInContext("setBrowserNotifications(true)", h.context);
  assert.equal(h.saved.get("pref"), "true");
  assert.equal(h.state.notificationsEnabled, true);
  assert.equal(h.state.pushSubscriptionReady, true);
  assert.equal(h.removals(), 0);
});
test("logout removes delivery subscription without erasing saved preference", async () => {
  const h = setup();
  vm.runInContext(extract("logout"), h.context);
  await vm.runInContext("logout()", h.context);
  assert.equal(h.saved.get("pref"), "true");
  assert.equal(h.state.notificationsEnabled, false);
  assert.equal(h.state.pushPaused, true);
  assert.equal(h.removals(), 1);
});

test("enable failure keeps intent while explicit disable clears it", async () => {
  const h = setup();
  vm.runInContext(extract("scheduleBrowserPushRetry") + extract("setBrowserNotifications"), h.context);
  await vm.runInContext("setBrowserNotifications(true)", h.context);
  assert.equal(h.saved.get("pref"), "true");
  assert.equal(h.state.notificationsEnabled, true);
  assert.equal(h.retries(), 1);
  await vm.runInContext("setBrowserNotifications(false)", h.context);
  assert.equal(h.saved.get("pref"), "false");
  assert.equal(h.state.notificationsEnabled, false);
  assert.equal(h.removals(), 1);
});
