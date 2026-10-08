self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("traffic-")).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Private beta: network access is always checked by the server; no offline shell.
self.addEventListener("push", (event) => {
  let data = {
    title: "Traffic Optimizer",
    body: "Your journey reminder is ready.",
    url: "/plan",
  };
  try {
    data = { ...data, ...event.data.json() };
  } catch {}
  if(data.expiresAt && Date.parse(data.expiresAt)<=Date.now())return;
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || "traffic-journey",
      data: { url: data.url },
      requireInteraction: false,
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    event.notification.data?.url || "/plan",
    self.location.origin,
  );
  if (url.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const client = clients.find(
          (c) => new URL(c.url).origin === url.origin,
        );
        if (client) {
          return client.navigate(url.href).then(updated => (updated || client).focus());
        }
        return self.clients.openWindow(url.href);
      }),
  );
});
