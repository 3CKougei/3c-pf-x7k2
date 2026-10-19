// © 2026 MR Design · 3C工芸 会社紹介 オフライン保存＆最新化（サービスワーカー）
// build.py が sw-manifest.json（全ファイルのハッシュ一覧）を作る。ここではそれを毎回ネットで確かめ、
//   ・変わった／増えたファイルだけ取り直して保存、消えたファイルは保存からも消す（＝写真を差し替えても必ず最新が出る）
//   ・ネットが無い時は保存してある分で全画面を出す（客先が圏外でも開ける）
// 画面(index.html)はネット優先（3秒で諦めて保存分）。写真・データは保存優先（一覧で鮮度を保証しているので速い）。
const STORE = 'pitch-files-v1';
const META = 'pitch-meta-v1';
const MANIFEST = 'sw-manifest.json';
const base = new URL('./', self.location).href;
const keyOf = p => new URL(p, base).href;

let syncing = null;
function sync() {
  if (!syncing) syncing = doSync().finally(() => { syncing = null; });
  return syncing;
}
async function tell(msg) {
  for (const c of await self.clients.matchAll({ includeUncontrolled: true })) c.postMessage(msg);
}
async function doSync() {
  let man;
  try { man = await fetch(keyOf(MANIFEST), { cache: 'no-store' }).then(r => { if (!r.ok) throw 0; return r.json(); }); }
  catch (e) { await tell({ t: 'sync', offline: true }); return; }
  const meta = await caches.open(META), store = await caches.open(STORE);
  const old = await meta.match('have').then(r => r ? r.json() : {}).catch(() => ({}));
  const want = Object.entries(man.files).filter(([p, h]) => old[p] !== h).map(([p]) => p);
  for (const p of Object.keys(old)) if (!(p in man.files)) { await store.delete(keyOf(p)); delete old[p]; }
  const total = want.length; let done = 0, failed = 0, changed = 0;
  await tell({ t: 'sync', build: man.build, total, done });
  const q = want.slice();
  async function worker() {
    for (let p; (p = q.shift());) {
      try {
        const r = await fetch(keyOf(p), { cache: 'reload' });
        if (!r.ok) throw 0;
        await store.put(keyOf(p), r);
        if (old[p] && p !== 'index.html') changed++;
        old[p] = man.files[p];
      } catch (e) { failed++; }
      done++;
      if (done % 20 === 0 || done === total) {
        await meta.put('have', new Response(JSON.stringify(old)));
        await tell({ t: 'sync', build: man.build, total, done });
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  await meta.put('have', new Response(JSON.stringify(old)));
  await meta.put('build', new Response(man.build));
  await tell({ t: 'synced', build: man.build, total, failed, changed });
}

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== STORE && k !== META) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('message', e => { if (e.data === 'sync') e.waitUntil(sync()); });

// 動画は iOS が Range で取りに来る → 保存分から 206 を組み立てる
async function rangeFrom(resp, range) {
  const buf = await resp.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  const start = m[1] ? +m[1] : 0, end = m[2] ? Math.min(+m[2], buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': resp.headers.get('Content-Type') || 'video/mp4',
      'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(base)) return;
  const url = new URL(req.url);
  const path = url.pathname.slice(new URL(base).pathname.length);
  if (path === MANIFEST || path === 'sw.js') return;
  if (path === '' || path === 'index.html') {
    e.respondWith((async () => {
      const store = await caches.open(STORE);
      const net = fetch(keyOf('index.html'), { cache: 'no-store' }).then(r => {
        if (r.ok) store.put(keyOf('index.html'), r.clone());
        return r;
      });
      const timeout = new Promise(res => setTimeout(res, 3000));
      const r = await Promise.race([net.catch(() => null), timeout]);
      if (r) return r;
      return (await store.match(keyOf('index.html'))) || net;
    })());
    return;
  }
  e.respondWith((async () => {
    const store = await caches.open(STORE);
    const hit = await store.match(keyOf(path));
    const range = req.headers.get('range');
    if (hit) return range ? rangeFrom(hit, range) : hit;
    return fetch(req);
  })());
});
