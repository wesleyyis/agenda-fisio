// Gera um par de chaves VAPID para o Web Push.
//
// Como usar (precisa do Deno instalado: https://deno.com):
//   deno run --allow-env supabase/functions/send-push/gerar-chaves.ts
//
// O script imprime:
//   1) VAPID_KEYS    → cole em Supabase → Edge Functions → Secrets
//   2) VAPID_PUBLIC_KEY → cole em js/config.js (chave pública, pode ser exposta)

import * as webpush from "jsr:@negrel/webpush@0.5.0";

const pair = await webpush.generateVapidKeys();
const exported = await webpush.exportVapidKeys(pair);
const publicKey = await webpush.exportApplicationServerKey(pair);

console.log("");
console.log("=== 1) Supabase → Edge Functions → Secrets ===");
console.log("VAPID_KEYS=" + JSON.stringify(exported));
console.log("VAPID_SUBJECT=mailto:seu-email@exemplo.com");
console.log("");
console.log("=== 2) js/config.js ===");
console.log('var VAPID_PUBLIC_KEY = "' + publicKey + '";');
console.log("");
