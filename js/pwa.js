/* Minha Agenda – PWA: notificações push, fila offline (IndexedDB) e sincronização.
   Depende de: js/vendor/supabase.min.js e js/config.js (SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC_KEY). */
(function () {
  "use strict";

  var DB_NAME = "minha-agenda-offline";
  var DB_VERSION = 1;
  var STORE = "ops";

  /* ---------- IndexedDB: fila de operações offline ---------- */
  function openDB() {
    return new Promise(function (res, rej) {
      var req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { return rej(e); }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
  }
  function dbGetAll() {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(STORE, "readonly");
        var r = tx.objectStore(STORE).getAll();
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
    });
  }
  function dbPut(op) {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(STORE, "readwrite");
        var r = tx.objectStore(STORE).put(op);
        r.onsuccess = function () { res(); };
        r.onerror = function () { rej(r.error); };
      });
    });
  }
  function dbDel(id) {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(STORE, "readwrite");
        var r = tx.objectStore(STORE).delete(id);
        r.onsuccess = function () { res(); };
        r.onerror = function () { rej(r.error); };
      });
    });
  }

  function queueAdd(op) {
    return dbPut(Object.assign({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }, op));
  }
  async function queueClear() {
    var ops = await dbGetAll();
    for (var i = 0; i < ops.length; i++) { try { await dbDel(ops[i].id); } catch (e) {} }
  }

  async function replay() {
    var ops = await dbGetAll();
    for (var i = ops.length - 1; i >= 0; i--) {
      var op = ops[i];
      try {
        var res = await fetch(op.url, { method: op.method || "POST", headers: op.headers || { "Content-Type": "application/json" }, body: op.body });
        if (!res.ok) throw new Error("Falha na sincronização: HTTP " + res.status);
        await dbDel(op.id);
      } catch (e) { break; }
    }
  }

  /* ---------- Push (Web Push + VAPID) ---------- */
  function urlBase64ToUint8Array(base64) {
    var padding = "=".repeat((4 - (base64.length % 4)) % 4);
    var b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    var json = atob(b64);
    var arr = new Uint8Array(json.length);
    for (var i = 0; i < json.length; i++) arr[i] = json.charCodeAt(i);
    return arr;
  }

  async function ensurePushSubscription(userId) {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") return null;
    if (Notification.permission !== "granted") return null;
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: VAPID_PUBLIC_KEY ? urlBase64ToUint8Array(VAPID_PUBLIC_KEY) : undefined
      });
      var c = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
      var res = await c.from("push_subscriptions").upsert({ user_id: userId, endpoint: sub.endpoint, keys: sub.keys });
      if (res.error) console.warn("[PWA] Não foi possível salvar a inscrição push:", res.error && res.error.message);
    }
    return sub;
  }

  async function unsubscribe() {
    if (!("serviceWorker" in navigator)) return;
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    var c = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
    await c.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  }

  async function notifyLocal(title, body, url) {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    var reg = await navigator.serviceWorker.ready;
    reg.showNotification(title, { body: body, icon: "/icon.svg", badge: "/icon.svg", tag: "minha-agenda", data: { url: url || "/" }, vibrate: [100, 60, 100] });
  }

  /* ---------- Inicialização ---------- */
  async function init() {
    if ("serviceWorker" in navigator) {
      try { await navigator.serviceWorker.register("/sw.js"); } catch (e) { console.warn("[PWA] Falha no registro do SW:", e); }
    }
    if ("serviceWorker" in navigator && "SyncManager" in window) {
      try { var reg2 = await navigator.serviceWorker.ready; await reg2.sync.register("minha-agenda-sync"); } catch (e) { /* background sync não suportado */ }
    }
    window.addEventListener("online", function () { replay(); });
    if (navigator.onLine) { replay(); }
  }

  window.MinhaAgendaPWA = {
    queue: { add: queueAdd, all: dbGetAll, clear: queueClear },
    replay: replay,
    notifyLocal: notifyLocal,
    subscribe: ensurePushSubscription,
    unsubscribe: unsubscribe,
    init: init
  };

  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", function () { init(); }); } else { init(); }
})();
