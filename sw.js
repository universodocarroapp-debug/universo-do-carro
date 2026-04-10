const CACHE_NAME = 'universo-do-carro-v1';

const urlsToCache = [
  './index.html',
  './login.html',
  './comprador.html',
  './loja.html',
  './admin.html',
  './cotacao.html'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
        .then(cache => {
            return cache.addAll(urlsToCache);
        })
    );
});

self.addEventListener('fetch', event => {
    // Para APIs e dinâmicos, tenta a rede primeiro
    if (event.request.url.includes('/api/')) {
        event.respondWith(
            fetch(event.request).catch(() => new Response(JSON.stringify({ error: 'Offline' })))
        );
        return;
    }

    // Para arquivos estáticos, usa o cache com fallback na rede
    event.respondWith(
        caches.match(event.request)
        .then(response => {
            return response || fetch(event.request);
        }).catch(() => {
            // Em caso extremo de erro 404/offline, carrega cache da index
            if (event.request.mode === 'navigate') {
                return caches.match('./index.html');
            }
        })
    );
});

self.addEventListener('activate', event => {
    const cacheWhiteList = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheWhiteList.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});
