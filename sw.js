// Service worker simples: cacheia só o "esqueleto" estático do app
// (HTML/CSS/JS/ícones) pra carregar mais rápido. Nunca intercepta
// chamadas ao Firebase nem a APIs externas — o jogo continua sempre
// em tempo real.

const CACHE_NAME = "remember-shell-v1";

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./room.js",
  "./picking-logic.js",
  "./ai-validate.js",
  "./scoring.js",
  "./category-queue.js",
  "./countries.js",
  "./firebase-config.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Só cuida de requisições do próprio site (GET). Firebase, fontes do
  // Google e a API do Gemini seguem direto pra rede, sem cache.
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);

      // Cache-first pro app shell (mais rápido), com atualização em segundo plano.
      return cached || networkFetch;
    })
  );
});
