// Supabase Edge Function: envio de Web Push (VAPID) para as inscrições do usuário.
//
// Deploy:
//   supabase functions deploy send-push --no-verify-jwt
//
// Secrets (Supabase → Edge Functions → Secrets):
//   VAPID_KEYS      JSON com as chaves VAPID (gere com gerar-chaves.ts)
//   VAPID_SUBJECT   mailto:seu@email.com
//   PUSH_SECRET     (opcional) segredo para chamadas servidor→servidor/cron
//
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetadas automaticamente.
//
// Chamada autenticada (o próprio usuário):
//   POST /functions/v1/send-push
//   Authorization: Bearer <access_token>
//   { "title": "...", "body": "...", "url": "/" }
//
// Chamada de servidor (cron/outra função):
//   POST /functions/v1/send-push
//   x-push-secret: <PUSH_SECRET>
//   { "user_id": "...", "title": "...", "body": "...", "url": "/" }

import * as webpush from "jsr:@negrel/webpush@0.5.0";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-push-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

let appServer: webpush.ApplicationServer | null = null;

async function getAppServer(): Promise<webpush.ApplicationServer> {
  if (appServer) return appServer;
  const raw = Deno.env.get("VAPID_KEYS");
  if (!raw) throw new Error("VAPID_KEYS não configurada");
  const exported = JSON.parse(raw);
  const vapidKeys = await webpush.importVapidKeys(exported);
  appServer = await webpush.ApplicationServer.new({
    contactInformation:
      Deno.env.get("VAPID_SUBJECT") ?? "mailto:contato@example.com",
    vapidKeys,
  });
  return appServer;
}

type SubRow = {
  id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  /* Autorização: segredo de servidor ou JWT do próprio usuário. */
  const secret = Deno.env.get("PUSH_SECRET") ?? "";
  const provided = req.headers.get("x-push-secret") ?? "";
  let userId = typeof body.user_id === "string" ? body.user_id : null;
  const serverCall = !!secret && provided === secret;

  if (!serverCall) {
    const token = (req.headers.get("Authorization") ?? "").replace(
      /^Bearer\s+/i,
      "",
    );
    if (!token) return json({ ok: false, error: "unauthorized" }, 401);
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    userId = data.user.id;
  }

  if (!userId) return json({ ok: false, error: "missing_user_id" }, 400);

  const { data: subs, error: subError } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, keys")
    .eq("user_id", userId);

  if (subError) return json({ ok: false, error: subError.message }, 500);
  if (!subs || subs.length === 0) {
    return json({ ok: false, error: "no_subscription" }, 404);
  }

  let server: webpush.ApplicationServer;
  try {
    server = await getAppServer();
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }

  /* O Service Worker lê estes campos no evento "push". */
  const payload = JSON.stringify({
    title: (body.title as string) || "Minha Agenda",
    body: (body.body as string) || "Você tem um lembrete de atendimento.",
    url: (body.url as string) || "/",
    tag: (body.tag as string) || "minha-agenda",
    vibrate: [200, 100, 200],
  });

  const results: Array<Record<string, unknown>> = [];

  for (const row of subs as SubRow[]) {
    try {
      const subscriber = server.subscribe({
        endpoint: row.endpoint,
        keys: row.keys,
      });
      await subscriber.pushTextMessage(payload, {
        ttl: 3600,
        urgency: webpush.Urgency.High,
      });
      await admin
        .from("push_subscriptions")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", row.id);
      results.push({ id: row.id, ok: true });
    } catch (e) {
      const gone =
        e instanceof webpush.PushMessageError ? e.isGone() : false;
      results.push({
        id: row.id,
        ok: false,
        gone,
        error: String((e as Error).message ?? e),
      });
      /* Inscrição expirada/cancelada: remove para não tentar de novo. */
      if (gone) {
        await admin.from("push_subscriptions").delete().eq("id", row.id);
      }
    }
  }

  return json({ ok: results.some((r) => r.ok === true), results });
});
