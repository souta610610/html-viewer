// HTML Viewer Service Worker
// 方針: HTML は network-first（更新をすぐ反映）、取れなければキャッシュで起動（オフライン対応）
// 加えて、Android の「共有」から送られたファイル（Web Share Target）を受け取り、
// SHARE_CACHE に一時保存してからアプリ本体へリダイレクトする。
const CACHE = 'html-viewer-v1';
const SHARE_CACHE = 'html-viewer-share';
const PRECACHE = [
  './html-viewer.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SHARE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 共有されたファイル・テキストを SHARE_CACHE に積んで、アプリ本体を ?share=1 で開き直す
async function receiveShare(request) {
  try {
    const form = await request.formData();
    const cache = await caches.open(SHARE_CACHE);
    const stamp = Date.now();
    let i = 0;
    for (const file of form.getAll('files')) {
      if (!(file instanceof File)) continue;
      await cache.put(
        new Request('./__share/' + stamp + '-' + (i++)),
        new Response(file, { headers: { 'X-Filename': encodeURIComponent(file.name || '共有ファイル.html') } })
      );
    }
    // ファイルではなく HTML の文字列そのものが共有された場合
    const text = form.get('text');
    if (i === 0 && typeof text === 'string' && text.trim().startsWith('<')) {
      const title = form.get('title');
      const name = (typeof title === 'string' && title.trim()) ? title.trim() : '共有テキスト';
      await cache.put(
        new Request('./__share/' + stamp + '-text'),
        new Response(new Blob([text], { type: 'text/html;charset=utf-8' }), { headers: { 'X-Filename': encodeURIComponent(name) } })
      );
    }
  } catch (e) {
    // 受け取りに失敗してもアプリは開く
  }
  return Response.redirect('./html-viewer.html?share=1', 303);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== 'GET') return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        // ?share=1 などクエリ付きの URL はキャッシュに溜めない
        if (res && res.ok && !url.search) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((cached) => cached || (req.mode === 'navigate' ? caches.match('./html-viewer.html') : undefined))
      )
  );
});
