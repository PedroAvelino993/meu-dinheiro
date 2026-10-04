// "Service worker": um script que o navegador roda em segundo plano,
// mesmo quando a página está fechada. Usamos ele pra guardar uma cópia
// dos arquivos do app, então ele abre rápido (e até funciona sem internet).
const CACHE_NAME = "onde-investir-v1";
const ARQUIVOS_PARA_GUARDAR = [
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARQUIVOS_PARA_GUARDAR))
  );
});

self.addEventListener("fetch", (evento) => {
  evento.respondWith(
    caches.match(evento.request).then((respostaCache) => {
      return respostaCache || fetch(evento.request);
    })
  );
});
