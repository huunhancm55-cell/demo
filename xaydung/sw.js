// Service worker: cho phép ứng dụng chạy khi không có mạng
const CACHE = 'qlxd-v24';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'sync.js', 'docs.js', 'progress.js', 'accept.js', 'share.js', 'crew.js', 'config.js', 'vendor/supabase-js-2.118.0.js', 'manifest.webmanifest', 'icon.svg', 'logo.png', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Ưu tiên mạng và luôn hỏi lại máy chủ (không dùng bộ đệm HTTP) để bản cập nhật hiện ngay; mất mạng thì dùng bản đã lưu
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
