/* Service worker mínimo de CabanApp.
   - Permite instalar la app ("Agregar a pantalla de inicio").
   - Estrategia "red primero": siempre intenta traer la versión nueva; si no
     hay internet, usa la copia guardada. Así cada deploy en Vercel se ve al
     instante sin tener que tocar nada acá.
   - Los datos siguen viniendo de Firestore en tiempo real.
   - Recibe las notificaciones push (FCM) aunque la app esté cerrada. */

/* --- Notificaciones push (FCM) --- */
try {
  importScripts(
    "https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js",
  );
  firebase.initializeApp({
    apiKey: "AIzaSyB9Fb4nHmvihKJ_RxT-eciu45kAM1CEKYE",
    authDomain: "cabanapp-ca1d1.firebaseapp.com",
    projectId: "cabanapp-ca1d1",
    storageBucket: "cabanapp-ca1d1.firebasestorage.app",
    messagingSenderId: "903412118535",
    appId: "1:903412118535:web:9fb441c99aa203a8eba6a2",
  });
  firebase.messaging().onBackgroundMessage((payload) => {
    const n = payload.notification || {};
    self.registration.showNotification(n.title || "CabanApp", {
      body: n.body || "",
      icon: "/logo-192.png",
      badge: "/logo-192.png",
      tag: "cabanapp",
    });
  });
} catch (_) {
  /* Sin Firebase disponible: la app sigue funcionando, solo sin push. */
}

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window" }).then((cs) => {
      for (const c of cs) if ("focus" in c) return c.focus();
      return self.clients.openWindow("/");
    }),
  );
});

const CACHE = "cabanapp-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./manifest.json",
  "./logo-192.png",
  "./logo-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((claves) =>
        Promise.all(
          claves.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Solo el propio sitio: Firebase, Firestore y CDNs pasan directo a la red.
  if (url.origin !== self.location.origin) return;
  // Red primero; si falla (sin internet), se responde con la copia en caché.
  e.respondWith(
    fetch(request)
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copia));
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match("./index.html"))),
  );
});
