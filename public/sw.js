// Nhịp service worker: only makes the web app installable ("Cài đặt Nhịp").
// It caches nothing — the app's own offline queue handles offline use, and a cache here
// could keep an old version alive after an update.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
