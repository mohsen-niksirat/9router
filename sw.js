const CACHE = '9router-web-v13';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/store.js',
  './js/router.js',
  './js/manus.js',
  './js/markdown.js',
  './js/providers_ui.js',
  './js/combo_graph.js',
  './js/team_graph.js',
  './js/agent_team.js',
  './js/arena.js',
  './js/web_search.js',
  './js/artifacts.js',
  './js/command_palette.js',
  './js/export_utils.js',
  './js/analytics.js',
  './js/prompt_utils.js',
  './js/web_fetch.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
