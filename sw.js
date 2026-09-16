const CACHE = 'calendar-shell-v24';
const SHELL = ['./', './index.html', './style.css', './script.js', './calendar.mjs', './storage.mjs', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
const shellURLs = new Set(SHELL.map(path => new URL(path, self.registration.scope).href));
const localPreview = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE)
    .then(cache => cache.addAll(SHELL.map(path => new Request(path, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const previous = keys.filter(key => key.startsWith('calendar-shell-') && key !== CACHE);
    await Promise.all(previous.map(key => caches.delete(key)));
    await self.clients.claim();
    // Refresh existing local previews once when replacing an older cached build.
    // Installed apps keep their open forms; their next reload uses current files.
    if (localPreview && previous.length) {
      const windows = await self.clients.matchAll({ type: 'window' });
      // Do not await navigation: its fetch waits for activation to finish.
      windows.forEach(client => { client.navigate(client.url).catch(() => {}); });
    }
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // Prefer current files, retaining the last successful shell for offline use.
      const response = await fetch(event.request, { cache: 'no-store' });
      if (response.ok) {
        if (shellURLs.has(event.request.url)) await cache.put(event.request, response.clone());
        return response;
      }
      const cached = await cache.match(event.request);
      return cached || response;
    } catch (error) {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      if (event.request.mode === 'navigate') return cache.match('./index.html');
      throw error;
    }
  })());
});
