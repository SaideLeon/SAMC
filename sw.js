/**
 * sw.js — Service Worker do SAMC
 * Estratégia: Cache-First para assets estáticos, Network-First para API
 */

const CACHE_NAME   = 'samc-v1';
const CACHE_STATIC = 'samc-static-v1';

/* Assets a pré-cachear na instalação */
const PRE_CACHE = [
  '/',
  '/static/css/style.css',
  '/static/css/enviar.css',
  '/static/js/app.js',
  '/static/js/enviar.js',
  '/static/js/md.js',
  'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;600;700&family=Space+Mono:wght@400;700&display=swap',
];

/* Prefixos de API — nunca cacheados */
const API_PATHS = ['/api/'];

/* ── Instalação ─────────────────────────────────── */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => {
      /* Pré-cache individual para não bloquear na falha de uma fonte */
      return Promise.allSettled(
        PRE_CACHE.map((url) =>
          cache.add(url).catch((err) =>
            console.warn('[SW] Falha ao pré-cachear:', url, err)
          )
        )
      );
    }).then(() => self.skipWaiting())
  );
});

/* ── Activação ─────────────────────────────────── */
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_STATIC && k !== CACHE_NAME)
          .map((k) => {
            console.info('[SW] A remover cache antigo:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch ─────────────────────────────────────── */
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  /* Ignora requests não-GET e extensões de browser */
  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  /* ── API: Network-First, sem cache ── */
  const isApi = API_PATHS.some((p) => url.pathname.startsWith(p));
  if (isApi) {
    e.respondWith(
      fetch(request).catch(() =>
        new Response(
          JSON.stringify({ error: 'Sem ligação à rede' }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )
    );
    return;
  }

  /* ── SSE streams: nunca interceptar ── */
  if (request.headers.get('Accept')?.includes('text/event-stream')) return;

  /* ── Assets estáticos e página: Cache-First ── */
  e.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      /* Não está em cache — vai à rede e guarda */
      return fetch(request)
        .then((response) => {
          /* Só cacheia respostas válidas e do mesmo origin ou fonts */
          if (
            response.ok &&
            (url.origin === self.location.origin ||
              url.hostname === 'fonts.googleapis.com' ||
              url.hostname === 'fonts.gstatic.com')
          ) {
            const toCache = response.clone();
            caches.open(CACHE_STATIC).then((cache) =>
              cache.put(request, toCache)
            );
          }
          return response;
        })
        .catch(() => {
          /* Offline fallback — devolve a página principal se disponível */
          if (request.destination === 'document') {
            return caches.match('/');
          }
        });
    })
  );
});
