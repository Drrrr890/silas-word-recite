// Service Worker for 单词背诵 PWA
// 策略：缓存优先 + 后台静默更新。
// 先秒回本地缓存，不再因 GitHub Pages 网络卡顿而让 iPad 打开图标长时间等待；
// 联网时在后台静默拉取最新 index.html 更新缓存，下次打开即是最新。
// 静态资源（图标/清单）一旦缓存几乎不变，不再回源，离线也能用。
const CACHE = 'word-recite-v4';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

// 每个 SW 生命周期内，HTML 后台刷新最多触发一次（避免反复拉取 5.2MB）
const htmlChecked = new Set();

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 逐个缓存，单个失败（如离线）不影响整体安装
    await Promise.all(ASSETS.map((a) =>
      cache.add(a).catch((e) => console.log('[sw] cache add skip', a, e && e.message))
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// 后台静默刷新：成功则更新缓存，失败（离线/网络差）保留旧缓存
async function backgroundRefresh(req, cache) {
  try {
    const resp = await fetch(req);
    if (resp && resp.status === 200) {
      await cache.put(req, resp.clone());
    }
  } catch (e) { /* 离线或网络差，保留旧缓存 */ }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isHtml = req.mode === 'navigate' ||
    url.pathname.endsWith('/index.html') ||
    (url.pathname.endsWith('/') && req.destination === 'document');

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    if (cached) {
      // 命中缓存：立即返回；HTML 在后台静默刷新一次
      if (isHtml && !htmlChecked.has(req.url)) {
        htmlChecked.add(req.url);
        event.waitUntil(backgroundRefresh(req, cache));
      }
      return cached;
    }

    // 当前缓存未命中：先查任意旧缓存兜底（版本切换 / 离线安装时）
    const any = await caches.match(req);
    if (any) return any;

    // 都没有：走网络并写入缓存
    try {
      const resp = await fetch(req);
      if (resp && resp.status === 200) {
        const copy = resp.clone();
        event.waitUntil(cache.put(req, copy));
      }
      return resp;
    } catch (e) {
      return any || Response.error();
    }
  })());
});
