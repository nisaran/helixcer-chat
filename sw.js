const INBOX_URL = "/#inbox";
const DEFAULT_TITLE = "Helixcer Chat";
const DEFAULT_ICON = "/assets/helixcer-mark.jpg";

function boundedText(value, fallback, maximumLength) {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, maximumLength);
}

function notificationFrom(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const options = {
    body: boundedText(source.body, "You have a new message.", 500),
    icon: DEFAULT_ICON,
    data: { url: INBOX_URL },
  };

  const tag = boundedText(source.tag, "", 128);
  if (tag) options.tag = tag;

  return {
    title: boundedText(source.title, DEFAULT_TITLE, 120),
    options,
  };
}

async function show(payload) {
  const notification = notificationFrom(payload);
  await self.registration.showNotification(notification.title, notification.options);
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || message.type !== "SHOW_NOTIFICATION") return;

  event.waitUntil(show(message.notification));
});

self.addEventListener("push", (event) => {
  let payload = {};

  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }

  event.waitUntil(show(payload));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    (async () => {
      const targetUrl = new URL(INBOX_URL, self.location.origin).href;
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing = windows.find((client) => {
        try {
          return new URL(client.url).origin === self.location.origin;
        } catch {
          return false;
        }
      });

      if (existing) {
        if ("navigate" in existing) await existing.navigate(targetUrl);
        return existing.focus();
      }

      return self.clients.openWindow(targetUrl);
    })(),
  );
});
