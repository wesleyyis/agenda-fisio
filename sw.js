/* Service Worker do Minha Agenda (PWA) - escopo raiz */
const CACHE = "minha-agenda-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icon.svg",
  "/css/style.css",
  "/js/boot.js",
  "/js/app.js",
  "/js/config.js",
  "/js/vendor/supabase.min.js"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request).then(function (cached) {
      return cached || fetch(request).then(function (response) {
        var copy = response.clone();
        caches.open(CACHE).then(function (c) { c.put(request, copy); });
        return response;
      });
    }).catch(function () { return caches.match("/index.html"); })
  );
});

self.addEventListener("push", function (event) {
  var data = {};
  try { data = (event.data && event.data.json) ? event.data.json() : {}; } catch (e) { data = {}; }
  var title = data.title || "Minha Agenda";
  var options = {
    body: data.body || "Você tem um lembrete de atendimento.",
    icon: "/icon.svg",
    badge: "/icon.svg",
    tag: data.tag || "minha-agenda",
    data: { url: data.url || "/" },
    vibrate: [100, 60, 100],
    renotify: true,
    requireInteraction: false
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async function () {
      var clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if ("focus" in client) {
          if (client.navigate) { try { await client.navigate(target); } catch (e) {} }
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })()
  );
});

self.addEventListener("sync", function (event) {
  if (event.tag !== "minha-agenda-sync") return;
  event.waitUntil(
    (async function () {
      // Replay da fila offline (IndexedDB) via Background Sync.
      var db = await openOfflineDB();
      if (!db) return;
      var ops = await new Promise(function (res, rej) {
        var tx = db.transaction("ops", "readonly");
        var store = tx.objectStore("ops");
        var r = store.getAll();
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
      for (var i = ops.length - 1; i >= 0; i--) {
        var op = ops[i];
        try {
          var res = await fetch(op.url, { method: op.method || "POST", headers: op.headers || { "Content-Type": "application/json" }, body: op.body });
          if (!res.ok) throw new Error("Falha HTTP " + res.status);
          var tx = db.transaction("ops", "readwrite");
          tx.objectStore("ops").delete(op.id);
          await new Promise(function (res2, rej2) { tx.oncomplete = function () { res2(); }; tx.onerror = function () { rej2(tx.error); }; tx.onabort = function () { rej2(tx.error); }; });
        } catch (e) { break; } // mantém a última operação pendente
      }
      var db2 = await openOfflineDB();
      db2.close();
    })()
  );
});

function openOfflineDB() {
  return new Promise(function (res) {
    try {
      var req = indexedDB.open("minha-agenda-offline", 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains("ops")) db.createObjectStore("ops", { keyPath: "id" });
      };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { res(null); };
    } catch (e) { res(null); }
  });
}
