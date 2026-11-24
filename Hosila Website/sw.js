// Legacy Workbox PWA cache cleanup stub for domain migration
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      } catch {}
      try {
        await self.registration.unregister();
      } catch {}
    })()
  );
});

