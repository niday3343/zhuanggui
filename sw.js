/* 智能装柜 · 离线缓存（页面网络优先，静态资源缓存优先） */
const CACHE = 'zhuanggui-v1';
const ASSETS = [
  './', './index.html', './css/app.css',
  './js/app.js', './js/geom.js', './js/packer.js', './js/smart.js', './js/scene.js', './js/importer.js',
  './manifest.json', './icon.svg', './icon-192.png', './icon-512.png',
  './vendor/three.module.js', './vendor/OrbitControls.js', './vendor/RoundedBoxGeometry.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(ASSETS.map(u => c.add(u).catch(() => {}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const store = r => { if (r && r.status === 200) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return r; };
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(store).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html'))));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(store)));
});
