// Supabase Edge Function: envio de notificação push (Web Push via FCM HTTP v1).
// Deploy: supabase functions deploy send-push
// Env vars: SUPABASE_URL, SUPABASE_ANON_KEY, FCM_PROJECT_ID, FCM_SERVICE_ACCOUNT (JSON com private_key/client_email/private_key_id), FCM_SERVER_KEY (fallback).

import { SignJWT } from "jsr:@panva/jose";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  if (url.pathname === "/health") return new Response("ok", { headers: corsHeaders });

  const body = await req.json();
  const { user_id, title, body: message, url: targetUrl } = body ?? {};

  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "");
  const { data: sub } = await supabase
    .from("push_subscriptions")
    .select("*")
    .eq("user_id", user_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sub) {
    return jsonResponse({ ok: false, error: "no_subscription" });
  }

  const projectId = Deno.env.get("FCM_PROJECT_ID");
  if (!projectId) {
    return jsonResponse({ ok: false, error: "fcm_not_configured" });
  }

  const accessToken = await getAccessToken();
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      message: {
        token: sub.endpoint,
        notification: { title: title ?? "Minha Agenda", body: message ?? "Novo lembrete de atendimento." },
        data: { url: targetUrl ?? "/" },
      },
    }),
  });

  const resJson = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Inscrição inválida/expirada: remove do banco.
    await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  }
  return jsonResponse({ ok: res.ok, response: resJson });
});

function jsonResponse(obj: Record<string, unknown>) {
  return new Response(JSON.stringify(obj), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function getAccessToken(): Promise<string> {
  const sa = Deno.env.get("FCM_SERVICE_ACCOUNT");
  if (sa) {
    const credentials = JSON.parse(sa);
    const now = Math.floor(Date.now() / 1000);
    const jwt = await new SignJWT({ iss: "firebase", sub: "firebase-adminsdk", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign({ key: credentials.private_key, kid: credentials.private_key_id });
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jwt, aud: "https://oauth2.googleapis.com/token", grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer" }),
    });
    const tokenJson = await tokenRes.json();
    return tokenJson.access_token ?? "";
  }
  const serverKey = Deno.env.get("FCM_SERVER_KEY");
  return serverKey ?? "";
}
