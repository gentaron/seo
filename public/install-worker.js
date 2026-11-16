self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.mode !== 'navigate' || request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(fetch(request).catch(() => new Response(
    '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>オフライン</title><h1>オフラインです</h1><p>接続が戻ったらページを再読み込みしてください。</p></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )));
});
