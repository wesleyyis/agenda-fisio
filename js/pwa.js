/* Minha Agenda – PWA
   Notificações push (Web Push/VAPID), fila offline (IndexedDB) e sincronização.
   Depende de: js/vendor/supabase.min.js e js/config.js
   (SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC_KEY).

   O app informa o cliente Supabase já autenticado com:
     MinhaAgendaPWA.configure({ client: sb });
   Assim a fila usa a mesma sessão (com renovação de token) do restante do app. */
(function () {
  "use strict";

  var DB_NAME = "minha-agenda-offline";
  var DB_VERSION = 2;
  var OPS = "ops";
  var CACHE = "cache";
  var SYNC_TAG = "minha-agenda-sync";

  var client = null;
  var lastUserId = null;
  var lastSeq = 0;

  /* ---------------- utilidades ---------------- */
  function dispatch(name, detail) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
    } catch (e) {}
  }
  function errText(e) {
    return e && e.message ? e.message : String(e || "");
  }
  function isNetErr(e) {
    return /failed to fetch|networkerror|network error|err_internet|err_connection|err_name_not_resolved|load failed|fetch failed|timeout/i.test(
      errText(e),
    );
  }
  function isDuplicate(e) {
    return /23505|duplicate key|already exists|409/i.test(
      errText(e) + " " + ((e && e.code) || "") + " " + ((e && e.status) || ""),
    );
  }
  function isAuthErr(e) {
    return /401|403|pgrst301|jwt|invalid claim|not authenticated|session/i.test(
      errText(e) + " " + ((e && e.code) || "") + " " + ((e && e.status) || ""),
    );
  }

  /* ---------------- IndexedDB ---------------- */
  function openDB() {
    return new Promise(function (res, rej) {
      var req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        return rej(e);
      }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(OPS))
          db.createObjectStore(OPS, { keyPath: "id" });
        if (!db.objectStoreNames.contains(CACHE))
          db.createObjectStore(CACHE, { keyPath: "key" });
      };
      req.onsuccess = function () {
        res(req.result);
      };
      req.onerror = function () {
        rej(req.error);
      };
    });
  }

  function txDone(tx) {
    return new Promise(function (res, rej) {
      tx.oncomplete = function () {
        res();
      };
      tx.onerror = function () {
        rej(tx.error);
      };
      tx.onabort = function () {
        rej(tx.error);
      };
    });
  }

  function dbGetAll() {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(OPS, "readonly");
        var r = tx.objectStore(OPS).getAll();
        r.onsuccess = function () {
          res(r.result || []);
        };
        r.onerror = function () {
          rej(r.error);
        };
      });
    });
  }
  function dbPut(op) {
    return openDB().then(function (db) {
      var tx = db.transaction(OPS, "readwrite");
      tx.objectStore(OPS).put(op);
      return txDone(tx);
    });
  }
  function dbDel(id) {
    return openDB().then(function (db) {
      var tx = db.transaction(OPS, "readwrite");
      tx.objectStore(OPS).delete(id);
      return txDone(tx);
    });
  }

  /* ---------------- fila de operações offline ---------------- */
  function queueAdd(op) {
    lastSeq = Math.max(Date.now(), lastSeq + 1);
    return dbPut(
      Object.assign(
        {
          id:
            Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          seq: lastSeq,
          at: new Date().toISOString(),
        },
        op,
      ),
    );
  }

  function queueAll() {
    return dbGetAll().then(function (ops) {
      return ops.sort(function (a, b) {
        return (a.seq || 0) - (b.seq || 0);
      });
    });
  }

  function queueCount(uid) {
    return dbGetAll().then(function (ops) {
      if (!uid) return ops.length;
      return ops.filter(function (op) {
        return !op.uid || op.uid === uid;
      }).length;
    });
  }

  function queueClear() {
    return openDB().then(function (db) {
      var tx = db.transaction(OPS, "readwrite");
      tx.objectStore(OPS).clear();
      return txDone(tx);
    });
  }

  /* ---------------- cache local (snapshot + credenciais do SW) ---------------- */
  function cachePut(key, value) {
    return openDB().then(function (db) {
      var tx = db.transaction(CACHE, "readwrite");
      tx.objectStore(CACHE).put(Object.assign({ key: key }, value));
      return txDone(tx);
    });
  }

  function cacheGet(key) {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(CACHE, "readonly");
        var r = tx.objectStore(CACHE).get(key);
        r.onsuccess = function () {
          res(r.result || null);
        };
        r.onerror = function () {
          rej(r.error);
        };
      });
    });
  }

  function cacheSave(snapshot) {
    return cachePut("snapshot", {
      pts: snapshot.pts || [],
      ap: snapshot.ap || [],
      savedAt: new Date().toISOString(),
    });
  }

  function cacheLoad() {
    return cacheGet("snapshot");
  }

  /* Ao sair da conta: não deixa dados nem token de sessão no aparelho. */
  function clearSession() {
    return openDB().then(function (db) {
      var tx = db.transaction(CACHE, "readwrite");
      var store = tx.objectStore(CACHE);
      store.put({ key: "snapshot", pts: [], ap: [], savedAt: new Date().toISOString() });
      store.delete("auth");
      return txDone(tx);
    });
  }

  /* Mantém uma cópia do token no IndexedDB para o Service Worker conseguir
     sincronizar em segundo plano (ele não acessa o localStorage). */
  function syncAuth() {
    if (!client || !client.auth) return Promise.resolve();
    return client.auth
      .getSession()
      .then(function (r) {
        var s = r && r.data && r.data.session;
        if (s && s.access_token)
          return cachePut("auth", {
            token: s.access_token,
            expires_at: s.expires_at || 0,
          });
      })
      .catch(function () {});
  }

  /* ---------------- sincronização ---------------- */
  function applyOp(op) {
    if (!client) return Promise.resolve({ error: new Error("Cliente offline") });
    if (!op.table) {
      /* Compatibilidade: operação crua { url, method, body, headers }. */
      return fetch(op.url, {
        method: op.method || "POST",
        headers: op.headers || { "Content-Type": "application/json" },
        body: op.body,
      }).then(function (r) {
        return r.ok
          ? { error: null }
          : { error: new Error("HTTP " + r.status), status: r.status };
      });
    }
    var q = client.from(op.table);
    if (op.method === "insert") return q.insert(op.body);
    if (op.method === "update" || op.method === "delete") {
      if (!op.match || !op.match.id) {
        return Promise.resolve({
          error: new Error("Operação " + op.method + " sem id"),
        });
      }
      return op.method === "update"
        ? q.update(op.body).eq("id", op.match.id)
        : q.delete().eq("id", op.match.id);
    }
    return Promise.resolve({
      error: new Error("Método desconhecido: " + op.method),
    });
  }

  var replaying = null;

  function replay() {
    if (replaying) return replaying;
    replaying = (async function () {
      var ops = await queueAll();
      if (!ops.length) {
        dispatch("pwa:synced", { done: 0, pending: 0 });
        return { done: 0, pending: 0 };
      }
      if (!client || !navigator.onLine) {
        dispatch("pwa:synced", { done: 0, pending: ops.length });
        return { done: 0, pending: ops.length };
      }
      await syncAuth();
      /* Descobre o usuário da sessão atual: operações de outra conta no mesmo
         aparelho ficam na fila até o dono entrar de novo. */
      var uid = null;
      try {
        var sess = await client.auth.getSession();
        uid =
          sess &&
          sess.data &&
          sess.data.session &&
          sess.data.session.user &&
          sess.data.session.user.id;
      } catch (e) {
        uid = null;
      }
      var own = ops.filter(function (op) {
        return !uid || !op.uid || op.uid === uid;
      });
      dispatch("pwa:sync-start", { pending: own.length });
      var done = 0;
      for (var i = 0; i < own.length; i++) {
        var op = own[i],
          res;
        try {
          res = await applyOp(op);
        } catch (e) {
          res = { error: e };
        }
        if (res && res.error) {
          /* Já existia no servidor: retry idempotente, pode descartar. */
          if (isDuplicate(res.error)) {
            await dbDel(op.id);
            done++;
            continue;
          }
          /* Sessão expirada/token inválido: mantém a fila e tenta de novo. */
          if (isAuthErr(res.error)) break;
          /* Sem conexão: mantém a fila na ordem e tenta de novo depois. */
          if (isNetErr(res.error)) break;
          /* Erro de validação/RLS: descarta para não travar a fila. */
          console.warn(
            "[PWA] Operação descartada (" + op.table + "/" + op.method + "):",
            errText(res.error),
          );
          await dbDel(op.id);
          continue;
        }
        await dbDel(op.id);
        done++;
      }
      var all = await queueAll();
      var rest = uid
        ? all.filter(function (op) {
            return !op.uid || op.uid === uid;
          }).length
        : all.length;
      dispatch("pwa:synced", { done: done, pending: rest });
      return { done: done, pending: rest };
    })();
    replaying.catch(function () {}).then(function () {
      replaying = null;
    });
    return replaying;
  }

  /* ---------------- push (Web Push + VAPID) ---------------- */
  function urlBase64ToUint8Array(base64) {
    var padding = "=".repeat((4 - (base64.length % 4)) % 4);
    var b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    var json = atob(b64);
    var arr = new Uint8Array(json.length);
    for (var i = 0; i < json.length; i++) arr[i] = json.charCodeAt(i);
    return arr;
  }

  function pushSupported() {
    return (
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      typeof Notification !== "undefined"
    );
  }

  async function ensurePushSubscription(userId) {
    if (!pushSupported() || !userId) return null;
    if (Notification.permission !== "granted") return null;
    lastUserId = userId;

    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    var isNew = false;
    if (!sub) {
      var key =
        typeof VAPID_PUBLIC_KEY === "string" ? VAPID_PUBLIC_KEY.trim() : "";
      if (!key) {
        console.warn(
          "[PWA] VAPID_PUBLIC_KEY vazio em js/config.js: configure o push para inscrever este aparelho.",
        );
        return null;
      }
      try {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        });
        isNew = true;
      } catch (e) {
        console.warn("[PWA] Não foi possível assinar o push:", errText(e));
        return null;
      }
    }
    if (!client) return sub;

    var res = await client
      .from("push_subscriptions")
      .upsert(
        { user_id: userId, endpoint: sub.endpoint, keys: sub.keys },
        { onConflict: "endpoint" },
      );
    if (res.error) {
      console.warn(
        "[PWA] Não foi possível salvar a inscrição push:",
        errText(res.error),
      );
    } else if (isNew) {
      console.info("[PWA] Inscrição push registrada.");
    }
    return sub;
  }

  async function unsubscribe() {
    if (!pushSupported()) return;
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    if (client) {
      try {
        await client
          .from("push_subscriptions")
          .delete()
          .eq("endpoint", sub.endpoint);
      } catch (e) {}
    }
    await sub.unsubscribe();
  }

  async function notifyLocal(title, body, url) {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    var opts = {
      body: body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "minha-agenda",
      data: { url: url || "/" },
      vibrate: [100, 60, 100],
    };
    try {
      var reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, opts);
      return;
    } catch (e) {
      /* Sem Service Worker (ou navegador antigo): tenta o construtor direto.
         No Android ele costuma falhar; o aviso na tela continua aparecendo. */
      try {
        new Notification(title, opts);
      } catch (e2) {}
    }
  }

  /* ---------------- inicialização ---------------- */
  function backgroundSyncSupported() {
    return (
      typeof ServiceWorkerRegistration !== "undefined" &&
      "sync" in ServiceWorkerRegistration.prototype
    );
  }

  function registerSync() {
    if (!("serviceWorker" in navigator) || !backgroundSyncSupported()) return;
    navigator.serviceWorker.ready
      .then(function (reg) {
        return reg.sync.register(SYNC_TAG);
      })
      .catch(function () {
        /* Background Sync não suportado: o replay em "online" cobre. */
      });
  }

  async function init() {
    if ("serviceWorker" in navigator) {
      try {
        await navigator.serviceWorker.register("sw.js");
      } catch (e) {
        console.warn("[PWA] Falha no registro do Service Worker:", e);
      }
      navigator.serviceWorker.addEventListener("message", function (event) {
        var data = (event && event.data) || {};
        if (data.type === "pwa-synced") {
          dispatch("pwa:synced", { done: 1, pending: data.pending || 0 });
        } else if (data.type === "pwa-resubscribe") {
          ensurePushSubscription(lastUserId).catch(function () {});
        }
      });
    }
    registerSync();
    window.addEventListener("online", function () {
      registerSync();
      replay();
    });
    if (navigator.onLine) replay();
  }

  window.MinhaAgendaPWA = {
    configure: function (opts) {
      if (!opts) return;
      if (opts.client) {
        client = opts.client;
        try {
          client.auth.onAuthStateChange(function () {
            syncAuth();
          });
        } catch (e) {}
      }
      if (opts.url && opts.key)
        cachePut("config", { url: opts.url, anonKey: opts.key }).catch(
          function () {},
        );
      syncAuth();
    },
    queue: {
      add: queueAdd,
      all: queueAll,
      count: queueCount,
      clear: queueClear,
    },
    cache: { save: cacheSave, load: cacheLoad, clearSession: clearSession },
    replay: replay,
    notifyLocal: notifyLocal,
    subscribe: ensurePushSubscription,
    unsubscribe: unsubscribe,
    init: init,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      init();
    });
  } else {
    init();
  }
})();
