# Minha Agenda — guia de ativação (push + offline)

Este arquivo é o passo a passo completo para colocar em produção as funções de
**notificação push com tela apagada** e **funcionamento offline com sincronização**.

Leia tudo antes de começar. Os comandos são para **Windows PowerShell**. Se estiver
em Mac/Linux, os comandos do Deno são os mesmos; mude apenas a forma de instalar.

---

## 0. O que já está pronto no código

Você **não precisa mexer** nestes arquivos, a não ser onde for indicado:

| Arquivo | O que faz |
| --- | --- |
| `manifest.json` | Configura a instalação do app na tela inicial. |
| `icon-180.png`, `icon-192.png`, `icon-512.png`, `icon.svg` | Ícones do app e das notificações. |
| `sw.js` | Service Worker: cache offline, recebimento do push e clique na notificação. |
| `js/pwa.js` | Fila offline, cache dos dados e assinatura do push. |
| `js/app.js` | Integra a fila nas telas de paciente e atendimento. |
| `js/config.js` | **Único arquivo que você vai editar**: colar a chave pública VAPID. |
| `supabase/push_subscriptions.sql` | Cria a tabela onde ficam as inscrições push. |
| `supabase/functions/send-push/index.ts` | Função que envia o push. |
| `supabase/functions/send-push/gerar-chaves.ts` | Gera as chaves VAPID. |
| `docs/PWA.md` | Documentação técnica detalhada. |

Dados do projeto (confirme antes de começar):

- Projeto Supabase: `xapteyatswdtmuuzqbiu`
- URL da função: `https://xapteyatswdtmuuzqbiu.supabase.co/functions/v1/send-push`
- Site publicado no Netlify: `https://agendaprox.netlify.app/` (confirme se ainda é este endereço)

---

## 1. Pré-requisitos

- [ ] Acesso de administrador ao projeto no Supabase.
- [ ] Site publicado em **HTTPS** (localhost só serve para teste local).
- [ ] Celular Android com Chrome atualizado **ou** iPhone/iPad com **iOS 16.4+**.
- [ ] Permissão para instalar o Deno no computador.

---

## 2. Criar a tabela no banco

1. Entre no Supabase → seu projeto.
2. Vá em **SQL Editor**.
3. Abra o arquivo `supabase/push_subscriptions.sql` com um bloco de notas.
4. Copie **todo** o conteúdo e cole no SQL Editor.
5. Clique em **Run**.

O resultado deve aparecer como sucesso. Em **Table Editor**, a tabela
`push_subscriptions` deve existir com as colunas: `id`, `user_id`, `endpoint`,
`keys`, `created_at`, `last_used_at`.

> Pode executar quantas vezes quiser: o script não apaga dados.

> Se o arquivo `supabase.sql` original ainda não tiver sido executado neste
> projeto, execute ele primeiro.

---

## 3. Gerar as chaves VAPID

As chaves VAPID são o par de chaves usado para enviar notificações Web Push.

### 3.1 Instalar o Deno

No PowerShell:

```powershell
winget install DenoLand.Deno
```

Feche o terminal e abra um novo para o comando ficar disponível.

Se o `winget` não funcionar, baixe o instalador em: https://deno.com

### 3.2 Gerar as chaves

Dentro da pasta do projeto, rode:

```powershell
deno run --allow-env supabase/functions/send-push/gerar-chaves.ts
```

Vai aparecer algo assim:

```text
=== 1) Supabase → Edge Functions → Secrets ===
VAPID_KEYS={"publicKey":{"kty":"EC",...},"privateKey":{"kty":"EC",...}}
VAPID_SUBJECT=mailto:seu-email@exemplo.com

=== 2) js/config.js ===
var VAPID_PUBLIC_KEY = "BEl62iUYgUivxIkv...";
```

**Guarde as três linhas.** Você vai usá-las nos próximos passos.

> Atenção: a chave privada está dentro de `VAPID_KEYS`. Ela vai **somente** no
> Supabase. Nunca cole ela no site, no GitHub ou em conversa.

---

## 4. Configurar os Secrets no Supabase

No painel do Supabase:

1. Vá em **Edge Functions** → **Secrets**
   (em alguns projetos fica em **Project Settings → Edge Functions → Secrets**).
2. Clique em **Add new secret** e cadastre exatamente estes nomes:

| Nome do secret | Valor |
| --- | --- |
| `VAPID_KEYS` | A linha inteira que começa com `{"publicKey":...}` gerada no passo 3 |
| `VAPID_SUBJECT` | `mailto:seu-email@exemplo.com` (troque pelo seu e-mail) |
| `PUSH_SECRET` | Um segredo grande e aleatório, usado para chamadas de servidor |

Para gerar um `PUSH_SECRET` no PowerShell:

```powershell
[guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
```

Exemplo de valor: `9f1c...a72b8d1e...`. Copie esse valor e guarde, você vai usar
no teste do passo 8.

> `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já são configurados
> automaticamente pelo Supabase. Não precisa cadastrar.

---

## 5. Publicar a função `send-push`

### Opção A — pelo painel (recomendada)

1. No Supabase, vá em **Edge Functions**.
2. Clique em **Deploy a new function** → **Via editor**.
3. Nome da função: `send-push` (exatamente assim, sem maiúsculas).
4. Apague o código de exemplo que aparece.
5. Abra o arquivo `supabase/functions/send-push/index.ts`, copie **todo** o
   conteúdo e cole no editor.
6. **Desmarque** a opção **Verify JWT** (ou *Enforce JWT Verification*).
   A função já valida o token por conta própria.
7. Clique em **Deploy**.

Espere aparecer a função na lista com status ativo.

### Opção B — pela linha de comando (alternativa)

Instale o Supabase CLI (se quiser usar este caminho):

```powershell
winget install Supabase.CLI
```

Se não der certo, baixe o instalador em:
https://github.com/supabase/cli/releases

Depois rode, na pasta do projeto:

```powershell
supabase login
supabase link --project-ref xapteyatswdtmuuzqbiu
supabase functions deploy send-push --no-verify-jwt
```

> Use **uma** das duas opções. Não precisa fazer as duas.

---

## 6. Colocar a chave pública no site

1. Abra o arquivo `js/config.js`.
2. Encontre esta linha no final:

```js
var VAPID_PUBLIC_KEY = "";
```

3. Substitua pelo valor da **chave pública** gerada no passo 3:

```js
var VAPID_PUBLIC_KEY = "BEl62iUYgUivxIkv...";
```

4. Salve o arquivo.

> Enquanto essa chave estiver vazia, o app continua funcionando, mas só mostra
> lembretes com a tela ligada e o site aberto.

> Se as chaves VAPID forem geradas de novo no futuro, atualize **os dois lados**:
> o Secret `VAPID_KEYS` no Supabase **e** esta linha em `js/config.js`.

---

## 7. Publicar o site atualizado

As alterações de código precisam chegar no ar.

- Se o Netlify publica automaticamente a partir do GitHub: faça o commit e o push.

Exemplo:

```powershell
git add .
git commit -m "PWA: notificacoes push e modo offline"
git push
```

- Se o site é publicado arrastando arquivos: publique a pasta inteira do projeto.

Depois aguarde o deploy terminar e abra o site no navegador para confirmar que
carregou a versão nova.

> Se o celular continuar com a versão antiga, desinstale a PWA da tela inicial e
> instale de novo, ou abra e feche o app duas vezes.

---

## 8. Ativar no celular

### Android (Chrome)

1. Abra o site no Chrome.
2. Menu **⋮** → **Instalar app** ou **Adicionar à tela inicial**.
3. Feche o navegador e abra o app pelo ícone instalado.
4. Toque no botão do sino **🔔**.
5. Escolha **Permitir** notificações.

### iPhone / iPad (Safari)

1. Abra o site no **Safari**.
2. Toque em **Compartilhar** → **Adicionar à Tela de Início**.
3. Feche o Safari e abra o app pelo ícone da tela inicial.
4. Toque no sino **🔔** e permita notificações.

> No iPhone, o push **não funciona** se o app estiver aberto apenas como aba do
> Safari. Precisa estar instalado na tela inicial.

Depois de permitir, confirme no Supabase:

**Table Editor → push_subscriptions**

Deve existir uma linha com o seu `user_id` e um `endpoint`. Se não aparecer,
volte ao passo 8 e confirme que a permissão foi concedida.

---

## 9. Testar o envio do push

### 9.1 Descobrir seu `user_id`

No Supabase, vá em **Authentication → Users** e copie o UUID do seu usuário.

Outra opção, no SQL Editor:

```sql
select id, email from auth.users;
```

### 9.2 Enviar uma notificação de teste

No PowerShell, substitua os dois valores entre aspas e rode:

```powershell
$body = @{
  user_id = "COLE-SEU-UUID-AQUI"
  title   = "Teste Minha Agenda"
  body    = "Se você está vendo isso com a tela apagada, funcionou."
  url     = "/"
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri "https://xapteyatswdtmuuzqbiu.supabase.co/functions/v1/send-push" `
  -Headers @{ "x-push-secret" = "COLE-SEU-PUSH_SECRET-AQUI" } `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

A resposta esperada é parecida com:

```json
{
  "ok": true,
  "results": [
    { "id": "...", "ok": true }
  ]
}
```

### 9.3 Confirmar com a tela apagada

1. Envie o comando novamente.
2. Apague a tela do celular.
3. A notificação deve chegar com o ícone do app.

- No **Android**, deve vibrar (respeitando o modo silencioso).
- No **iPhone**, a vibração é controlada pelo sistema; o som depende das
  configurações de Não Perturbe e do volume.

---

## 10. Testar o modo offline

1. Abra o app **com internet** uma vez, para salvar os dados no aparelho.
2. Ative o **modo avião** no celular.
3. Cadastre um paciente novo ou edite um existente.
4. Deve aparecer a mensagem: “salvo no aparelho / sincroniza quando a internet voltar”.
5. Desligue o modo avião.
6. Aguarde alguns segundos. Deve aparecer “Alterações sincronizadas com o servidor”.
7. Confira no Supabase → **Table Editor → patients / appointments** se o dado chegou.

> No Android/Chrome, a fila também pode sincronizar em segundo plano.
> No iPhone, a fila é enviada quando o app volta a abrir.

---

## 11. Lembretes automáticos — situação atual

Neste momento a função `send-push` envia **quando você chama** (como no teste do
passo 9). O app já mostra avisos na tela com ele aberto, e o push funciona com a
tela apagada, mas **ainda não existe agendamento automático** dos lembretes.

Para o cliente receber sozinho “faltam 30 minutos”, falta implementar uma função
de agendamento que consulta os atendimentos e chama o envio. Isso pode ser feito
com pg_cron no Supabase ou com um cron externo.

Se isso for necessário, peça ao desenvolvedor para implementar a função
`send-reminders` e o agendamento.

---

## 12. Resolução de problemas

| Sintoma | O que verificar |
| --- | --- |
| Resposta `no_subscription` | O celular não foi inscrito. Toque no sino 🔔, permita notificações e confira a tabela `push_subscriptions`. |
| Resposta `unauthorized` | `PUSH_SECRET` copiado errado ou função publicada com “Verify JWT” ligado. |
| Erro `VAPID_KEYS não configurada` | O Secret `VAPID_KEYS` não foi cadastrado ou foi colado incompleto. |
| Chega com a tela ligada, mas não com a tela apagada | No iPhone: app não está instalado na tela inicial ou iOS é antigo. No Android: verifique permissões e economia de bateria. |
| Permissão negada | Android: configurações do app → Notificações. iPhone: Ajustes → notificações do app/site → permitir. |
| Notificação sem som | Modo silencioso, Não Perturbe, volume ou canal de notificação do sistema. |
| Dados offline não sincronizam | Confira se há internet, se a sessão não expirou e se o app foi aberto novamente (no iPhone). |
| Site não atualizou | Feche e abra o app duas vezes, ou desinstale e reinstale a PWA. |
| Erro ao salvar no celular | Verifique se o navegador permite armazenamento e se o app foi aberto ao menos uma vez com internet. |

Para investigar, veja também **Supabase → Edge Functions → Logs → send-push**.

---

## 13. Checklist final

- [ ] `supabase/push_subscriptions.sql` executado.
- [ ] Chaves VAPID geradas.
- [ ] Secrets `VAPID_KEYS`, `VAPID_SUBJECT` e `PUSH_SECRET` cadastrados.
- [ ] Função `send-push` publicada com verificação de JWT desligada.
- [ ] `VAPID_PUBLIC_KEY` preenchida em `js/config.js`.
- [ ] Site atualizado e publicado em HTTPS.
- [ ] PWA instalada no celular.
- [ ] Permissão de notificação concedida pelo sino 🔔.
- [ ] Linha criada em `push_subscriptions`.
- [ ] Push de teste recebido com a tela apagada.
- [ ] Cadastro offline feito e sincronizado ao voltar a internet.
- [ ] (Pendente) Agendamento automático dos lembretes, se desejado.

---

## 14. Regras de segurança

- Nunca coloque a chave **privada** VAPID no site ou no GitHub.
- Nunca coloque a `service_role` do Supabase no site.
- O `PUSH_SECRET` é só para servidores/cron. Não vai no JavaScript.
- A chave pública VAPID em `js/config.js` pode ficar exposta — isso é normal.
