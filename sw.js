/* Service Worker do Minha Agenda (PWA)
   - cache do app shell para funcionar offline
   - push / notificationclick
   - Background Sync: reenvia a fila de operações salva no IndexedDB */
const VERSION = "minha-agenda-v5";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icon.svg",
  "/icon-180.png",
  "/icon-192.png",
  "/icon-512.png",
  "/css/style.css",
  "/js/boot.js",
  "/js/config.js",
  "/js/app.js",
  "/js/pwa.js",
  "/js/vendor/supabase.min.js",
];

const DB_NAME = "minha-agenda-offline";
const DB_VERSION = 2;

/* ---------------- ciclo de vida ---------------- */
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(VERSION)
      .then(function (cache) {
        /* "cache: reload" ignora o cache HTTP: a versão nova do app é baixada
           de verdade quando o sw.js muda. Um arquivo ausente não impede a
           instalação dos demais. */
        return Promise.all(
          SHELL.map(function (url) {
            return fetch(url, { cache: "reload" })
              .then(function (response) {
                if (response && response.ok)
                  return cache.put(url, response);
              })
              .catch(function () {});
          }),
        );
      })
      .then(function () {
        return self.skipWaiting();
      }),
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (k) {
              return k !== VERSION;
            })
            .map(function (k) {
              return caches.delete(k);
            }),
        );
      })
      .then(function () {
        return self.clients.claim();
      }),
  );
});

/* ---------------- cache ---------------- */
self.addEventListener("fetch", function (event) {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  /* Não intercepta API do Supabase nem outros domínios. */
  if (url.origin !== self.location.origin) return;

  /* Navegação: rede primeiro (HTML sempre atualizado), cache como reserva. */
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then(function (response) {
          if (!response || !response.ok) {
            return caches.match("/index.html").then(function (r) {
              return r || response;
            });
          }
          const copy = response.clone();
          caches.open(VERSION).then(function (cache) {
            cache.put("/index.html", copy);
          });
          return response;
        })
        .catch(function () {
          return caches
            .match("/index.html")
            .then(function (r) {
              return r || caches.match("/");
            })
            .then(function (r) {
              return (
                r ||
                new Response(
                  "<h1>Sem conexão</h1><p>Abra o app uma vez com internet para liberar o modo offline.</p>",
                  { headers: { "Content-Type": "text/html; charset=utf-8" } },
                )
              );
            });
        }),
    );
    return;
  }

  /* Estáticos: responde do cache e atualiza em segundo plano. O fetch é
     iniciado antes do respondWith para o waitUntil ser registrado de forma
     síncrona (evita InvalidStateError em navegadores mais rígidos). */
  const networkPromise = fetch(request, { cache: "no-store" }).then(
    function (response) {
      if (response && response.ok) {
        const copy = response.clone();
        return caches
          .open(VERSION)
          .then(function (cache) {
            return cache.put(request, copy);
          })
          .then(function () {
            return response;
          });
      }
      return response;
    },
  );

  event.respondWith(
    caches.match(request).then(function (cached) {
      return (
        cached ||
        networkPromise.catch(function () {
          return new Response("", {
            status: 504,
            statusText: "Offline",
          });
        })
      );
    }),
  );
  event.waitUntil(networkPromise.catch(function () {}));
});

/* ---------------- notificações push ---------------- */
self.addEventListener("push", function (event) {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    try {
      data = { body: event.data.text() };
    } catch (e2) {
      data = {};
    }
  }

  const title = data.title || "Minha Agenda";
  const options = {
    body: data.body || "Você tem um lembrete de atendimento.",
    icon: data.icon || "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || "minha-agenda",
    renotify: true,
    requireInteraction: false,
    vibrate: data.vibrate || [200, 100, 200],
    data: { url: data.url || "/" },
    actions: [{ action: "open", title: "Abrir agenda" }],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const target =
    (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async function () {
      const list = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (let i = 0; i < list.length; i++) {
        const client = list[i];
        if ("focus" in client) {
          if (client.navigate) {
            try {
              await client.navigate(target);
            } catch (e) {}
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});

/* Inscrição expirada: pede para a página renovar. */
self.addEventListener("pushsubscriptionchange", function (event) {
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (list) {
        list.forEach(function (client) {
          client.postMessage({ type: "pwa-resubscribe" });
        });
      }),
  );
});

/* ---------------- Background Sync: fila offline ---------------- */
self.addEventListener("sync", function (event) {
  if (event.tag !== "minha-agenda-sync") return;
  event.waitUntil(replayQueue());
});

function openDB() {
  return new Promise(function (resolve) {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains("ops"))
          db.createObjectStore("ops", { keyPath: "id" });
        if (!db.objectStoreNames.contains("cache"))
          db.createObjectStore("cache", { keyPath: "key" });
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        resolve(null);
      };
    } catch (e) {
      resolve(null);
    }
  });
}

function readAll(db, store) {
  return new Promise(function (resolve) {
    if (!db) return resolve([]);
    try {
      const tx = db.transaction(store, "readonly");
      const r = tx.objectStore(store).getAll();
      r.onsuccess = function () {
        resolve(r.result || []);
      };
      r.onerror = function () {
        resolve([]);
      };
    } catch (e) {
      resolve([]);
    }
  });
}

function readOne(db, store, key) {
  return new Promise(function (resolve) {
    if (!db) return resolve(null);
    try {
      const tx = db.transaction(store, "readonly");
      const r = tx.objectStore(store).get(key);
      r.onsuccess = function () {
        resolve(r.result || null);
      };
      r.onerror = function () {
        resolve(null);
      };
    } catch (e) {
      resolve(null);
    }
  });
}

function removeOp(db, id) {
  return new Promise(function (resolve) {
    try {
      const tx = db.transaction("ops", "readwrite");
      tx.objectStore("ops").delete(id);
      tx.oncomplete = function () {
        resolve();
      };
      tx.onerror = function () {
        resolve();
      };
    } catch (e) {
      resolve();
    }
  });
}

function tokenUserId(token) {
  try {
    const part = token.split(".")[1] || "";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(b64 + pad));
    return payload.sub || null;
  } catch (e) {
    return null;
  }
}

async function replayQueue() {
  const db = await openDB();
  if (!db) return;

  const ops = (await readAll(db, "ops")).sort(function (a, b) {
    return (a.seq || 0) - (b.seq || 0);
  });
  if (!ops.length) {
    db.close();
    return;
  }

  const config = await readOne(db, "cache", "config");
  const auth = await readOne(db, "cache", "auth");
  const validToken =
    auth &&
    auth.token &&
    (!auth.expires_at || auth.expires_at * 1000 > Date.now() + 60000);

  /* Sem URL/credenciais válidas o SW não consegue autenticar: a página fará
     o replay na próxima abertura (a fila fica preservada). */
  if (!config || !config.url || !validToken) {
    db.close();
    return;
  }

  /* Só sincroniza as operações do dono do token atual. */
  const uid = tokenUserId(auth.token);
  const own = uid
    ? ops.filter(function (op) {
        return !op.uid || op.uid === uid;
      })
    : ops;

  const base = config.url.replace(/\/+$/, "");
  const headers = {
    apikey: config.anonKey,
    Authorization: "Bearer " + auth.token,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };

  for (let i = 0; i < own.length; i++) {
    const op = own[i];
    let url, method, body;
    if (!op.table) continue; // formato antigo sem tabela: deixa para a página
    if (op.method === "insert") {
      url = base + "/rest/v1/" + op.table;
      method = "POST";
      body = JSON.stringify(op.body);
    } else if (op.method === "update" || op.method === "delete") {
      url =
        base +
        "/rest/v1/" +
        op.table +
        "?id=eq." +
        encodeURIComponent((op.match && op.match.id) || "");
      method = op.method === "update" ? "PATCH" : "DELETE";
      body = op.method === "update" ? JSON.stringify(op.body) : undefined;
    } else {
      continue;
    }

    let res;
    try {
      res = await fetch(url, { method: method, headers: headers, body: body });
    } catch (e) {
      break; // sem rede: mantém a fila
    }

    if (res.ok || res.status === 409) {
      await removeOp(db, op.id);
      continue;
    }
    if (res.status === 401 || res.status === 403) break; // token expirado
    if (res.status >= 500) break; // servidor instável: tenta depois
    /* 4xx de validação: descarta para não travar a fila. */
    await removeOp(db, op.id);
  }

  const allOps = await readAll(db, "ops");
  const rest = uid
    ? allOps.filter(function (op) {
        return !op.uid || op.uid === uid;
      }).length
    : allOps.length;
  db.close();

  const list = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  list.forEach(function (client) {
    client.postMessage({ type: "pwa-synced", pending: rest });
  });
}
