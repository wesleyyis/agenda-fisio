# PWA: notificações push e modo offline

Este documento explica o que foi implementado no **Minha Agenda**, como ativar o
push no Supabase e como testar. Tudo continua em HTML/CSS/JS puro (sem build e
sem bibliotecas novas no frontend).

> Para um passo a passo pronto para a pessoa que vai fazer a configuração, use
> **`docs/ATIVACAO.md`**.

## Arquivos envolvidos

| Arquivo | Papel |
| --- | --- |
| `manifest.json` | Nome, ícone, cores e modo `standalone` (instalar na tela inicial). |
| `icon.svg` / `icon-192.png` / `icon-512.png` | Ícone do app e das notificações. |
| `icon-180.png` | Ícone da tela inicial no iOS (`apple-touch-icon`). |
| `sw.js` | Service Worker: cache do app, eventos `push`, `notificationclick` e `sync`. |
| `js/pwa.js` | Fila offline (IndexedDB), cache local, assinatura push e replay. |
| `js/app.js` | Passa as operações de pacientes/atendimentos pela fila quando não há internet. |
| `js/config.js` | `VAPID_PUBLIC_KEY` (chave pública do push). |
| `supabase/push_subscriptions.sql` | Tabela e RLS das inscrições push. |
| `supabase/functions/send-push/index.ts` | Edge Function que envia o Web Push. |
| `supabase/functions/send-push/gerar-chaves.ts` | Gera o par de chaves VAPID. |

## 1. Notificações push (tela apagada / app fechado)

### Como funciona

1. A página registra o Service Worker (`sw.js`).
2. Com a permissão de notificação concedida, o navegador cria uma inscrição
   (`PushSubscription`: `endpoint` + chaves `p256dh`/`auth`).
3. A inscrição é salva na tabela `push_subscriptions`, vinculada ao usuário.
4. O backend envia um POST assinado com **VAPID** para o `endpoint`.
5. O serviço de push do navegador (FCM no Chrome/Android, APNs no Safari/iOS)
   entrega a mensagem ao Service Worker, mesmo com a tela apagada.
6. O evento `push` mostra a notificação; o `notificationclick` abre/foca o app.

O app **não usa o SDK do Firebase**: usa Web Push padrão com VAPID, que é o
caminho recomendado para PWA e o único suportado no iOS 16.4+.

### Pré-requisitos

- Site em **HTTPS** (ou `localhost` para testes). O Netlify já atende.
- Android: Chrome/Edge/Firefox atualizados.
- iPhone/iPad: **iOS/iPadOS 16.4 ou superior** e o app **instalado na Tela de
  Início** (Safari → Compartilhar → Adicionar à Tela de Início). No Safari "na
  aba" o push não funciona.

### 1.1. Gerar as chaves VAPID

Com o [Deno](https://deno.com) instalado:

```bash
deno run --allow-env supabase/functions/send-push/gerar-chaves.ts
```

O script imprime:

- `VAPID_KEYS` (JSON com chave pública e privada) → **só** nos Secrets do Supabase;
- `VAPID_PUBLIC_KEY` → cole em `js/config.js`.

```js
// js/config.js
var VAPID_PUBLIC_KEY = "BEl62iUYgUivxIkv69yViEuiBIa-...";
```

### 1.2. Criar a tabela de inscrições

No SQL Editor do Supabase, execute `supabase/push_subscriptions.sql` (junto com
o `supabase.sql` do projeto). A RLS garante que cada usuário só vê/apaga as
próprias inscrições.

### 1.3. Configurar e publicar a Edge Function

```bash
supabase secrets set \
  VAPID_KEYS='{"publicKey":{...},"privateKey":{...}}' \
  VAPID_SUBJECT='mailto:seu-email@exemplo.com' \
  PUSH_SECRET='um-segredo-grande-e-aleatorio'

# --no-verify-jwt porque a função valida o JWT (ou o x-push-secret) por conta própria
supabase functions deploy send-push --no-verify-jwt
```

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são injetadas automaticamente pelo
Supabase. A service role **nunca** vai para o navegador.

### 1.4. Enviar uma notificação

Do próprio app (usuário autenticado, envia para ele mesmo):

```js
await fetch(SUPABASE_URL + "/functions/v1/send-push", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    apikey: SUPABASE_KEY,
    Authorization: "Bearer " + session.access_token,
  },
  body: JSON.stringify({
    title: "Lembrete de atendimento",
    body: "Ana Pereira às 15:00 (faltam 30 min).",
    url: "/",
  }),
});
```

De um cron/outra função (servidor → servidor), use o segredo e informe o usuário:

```bash
curl -X POST "https://SEU-PROJETO.supabase.co/functions/v1/send-push" \
  -H "Content-Type: application/json" \
  -H "x-push-secret: $PUSH_SECRET" \
  -d '{"user_id":"UUID-DO-USUARIO","title":"Agenda de amanhã","body":"Você tem 3 atendimentos.","url":"/"}'
```

Para lembretes automáticos, agende essa chamada (pg_cron + `pg_net` ou um cron
externo) consultando os atendimentos do dia.

### 1.5. Eventos no Service Worker

O `sw.js` já contém os dois eventos pedidos:

```js
self.addEventListener("push", function (event) {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || "Minha Agenda", {
      body: data.body || "Você tem um lembrete de atendimento.",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: data.tag || "minha-agenda",
      renotify: true,
      vibrate: data.vibrate || [200, 100, 200],
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of list) {
        if ("focus" in client) {
          if (client.navigate) await client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});
```

### 1.6. Ativar no aparelho

1. Abra o site e instale na tela inicial.
2. Toque no sino 🔔 no app e permita notificações.
3. A inscrição é salva automaticamente em `push_subscriptions`.
4. Envie um push de teste com a chamada acima.

### Limitações importantes (seja transparente com o cliente)

- **iOS**: só funciona com o app instalado na Tela de Início (16.4+); a permissão
  precisa ser pedida por um toque do usuário; **não existe Background Sync** no
  Safari (a sincronização offline acontece quando o app é aberto/volta a conexão).
- **Som e vibração** seguem as regras do sistema: modo silencioso, Não Perturbe e
  economia de bateria podem silenciar/atrasar. O campo `vibrate` é ignorado no
  iOS e em alguns navegadores; no Android funciona.
- Navegador fechado por completo pelo usuário (force stop) pode impedir a entrega
  até ele ser reaberto — isso vale para qualquer PWA, não é limitação do código.
- Push não é 100% garantido: serviços de push podem atrasar mensagens.

## 2. Modo offline (IndexedDB + fila + Background Sync)

### Estratégia

- **Cache do app** (`sw.js`): HTML sempre tenta a rede e cai para o cache; CSS/JS
  vêm do cache e são atualizados em segundo plano. Assim o app abre sem internet.
- **Cache de dados** (`js/pwa.js`, store `cache`): após cada carregamento bem
  sucedido, pacientes e atendimentos são salvos no IndexedDB. Sem internet, a tela
  usa esse retrato e avisa "mostrando os últimos dados salvos".
- **Fila de operações** (store `ops`): toda escrita (insert/update/delete) feita
  offline é guardada com tabela, método, corpo e id. A interface é atualizada na
  hora (otimista), sem esperar o servidor.
- **Sincronização**:
  - ao evento `online`, a página reenvia a fila em ordem;
  - no Android/Chrome, o `sync` do Service Worker também reenvia em segundo plano;
  - ao abrir o app, qualquer pendência é reenviada.
- **IDs gerados no cliente** (`crypto.randomUUID()`): o registro criado offline já
  nasce com o id definitivo, então os atendimentos podem referenciar o paciente
  antes de sincronizar.
- **Ordem e falhas**: a fila é enviada do mais antigo para o mais novo e para na
  primeira falha de rede/autenticação (para preservar dependências). Erros de
  validação (4xx) são descartados com aviso no console para não travar a fila;
  conflitos de chave (409/23505) são tratados como sucesso (reenvio idempotente).
- **Por usuário**: cada operação guarda o `uid` da conta. Se outra pessoa entrar
  no mesmo aparelho, a fila antiga fica parada até o dono entrar novamente.
- **Atualização do app**: ao publicar mudanças em HTML/CSS/JS, aumente `VERSION`
  no topo do `sw.js` (ex.: `minha-agenda-v4`). O Service Worker baixa o shell
  novo ignorando o cache HTTP e apaga o cache antigo na ativação.

### Formato de uma operação na fila

```js
{
  id: "mvwf4tsawxkicf",     // id da fila
  seq: 1793452199626,       // ordem
  table: "patients",
  method: "insert",         // insert | update | delete
  body: { id: "uuid...", name: "Ana" },
  match: { id: "uuid..." }, // usado em update/delete
  uid: "uuid-do-usuario"    // dono da operação (isola contas no mesmo aparelho)
}
```

### API exposta (`window.MinhaAgendaPWA`)

```js
MinhaAgendaPWA.queue.add(op);   // enfileira
MinhaAgendaPWA.queue.all();     // lista ordenada
MinhaAgendaPWA.queue.count();   // pendências
MinhaAgendaPWA.queue.clear();
MinhaAgendaPWA.replay();        // tenta sincronizar agora
MinhaAgendaPWA.cache.save({ pts, ap });
MinhaAgendaPWA.cache.load();
MinhaAgendaPWA.cache.clearSession();  // limpa snapshot e token (usado no logout)
MinhaAgendaPWA.subscribe(userId);   // assina o push
MinhaAgendaPWA.notifyLocal(title, body, url);
```

O app escuta os eventos `pwa:synced`, `online` e `offline` para atualizar a tela
e avisar o usuário.

### Limitações do offline

- É preciso abrir o app **uma vez com internet** para popular o cache inicial.
- A política de conflito é "última escrita vence"; não há mesclagem campo a campo.
- Ao sair da conta com pendências, o app bloqueia o logout e pede para sincronizar
  antes (evita enviar dados de um usuário na sessão de outro).
- No iOS não há Background Sync: a fila é enviada quando o app volta a abrir ou
  quando a página detecta a conexão.

## 3. Testes rápidos

### Service Worker e cache

1. Abra o app em `http://localhost:8765` (ou no Netlify).
2. DevTools → **Application → Service Workers**: deve aparecer `sw.js` ativo.
3. DevTools → **Application → Cache Storage**: deve existir `minha-agenda-v5`.
4. Marque **Offline** em Network e recarregue: o app deve abrir normalmente.

### Fila offline

No console:

```js
await MinhaAgendaPWA.queue.add({
  table: "patients",
  method: "insert",
  body: { id: crypto.randomUUID(), name: "Teste offline" },
});
await MinhaAgendaPWA.queue.count(); // 1
await MinhaAgendaPWA.replay();      // com internet e logado: envia e zera
```

### Push

1. Instale a PWA, toque no sino e permita.
2. Confira a linha em `push_subscriptions` no Supabase.
3. Dispare a Edge Function e bloqueie a tela do celular.

## 4. Checklist de ativação em produção

- [ ] Executar `supabase/push_subscriptions.sql`.
- [ ] Gerar as chaves VAPID e configurar os Secrets.
- [ ] Publicar `send-push` com `--no-verify-jwt`.
- [ ] Preencher `VAPID_PUBLIC_KEY` em `js/config.js`.
- [ ] Publicar o site em HTTPS (Netlify).
- [ ] Testar instalação + permissão + push no Android.
- [ ] Testar no iPhone com iOS 16.4+ **instalado na Tela de Início**.
- [ ] Testar cadastro/edição offline e sincronização ao voltar a conexão.
