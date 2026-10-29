# Correção do fluxo de "Esqueci minha senha"

Documento de referência sobre o problema de redirecionamento do link de
recuperação de senha, o que foi alterado no projeto e como configurar o
Supabase para o fluxo funcionar em produção.

---

## 1. O problema

O e-mail de redefinição era enviado com sucesso, mas o link levava para
`localhost` ou para uma URL inválida.

### Causa

O código montava o destino do link assim:

```js
sb.auth.resetPasswordForEmail(email, {
  redirectTo: location.origin + location.pathname
});
```

Isso gera resultados inválidos em várias situações:

| Situação | Valor gerado por `location.origin + location.pathname` | Resultado |
|---|---|---|
| `index.html` aberto direto do disco (`file:///C:/.../index.html`) | `null/C:/.../index.html` | URL inválida: o e-mail não abre o app |
| Teste local no Live Server (`http://localhost:5500/index.html`) | `http://localhost:5500/index.html` | Se esse endereço não estiver liberado no Supabase, o link cai no **Site URL** (muitas vezes `localhost`) |
| Site publicado sem essa URL liberada no Supabase | URL de produção | O Supabase **ignora** o `redirectTo` e usa o **Site URL** configurado no painel — que estava como `localhost` |

Ou seja, existiam **duas falhas somadas**:

1. **Cliente:** a URL era derivada da página atual, sem uma URL pública
   canônica e sem tratamento para `file://`.
2. **Servidor (Supabase):** o **Site URL** / **Redirect URLs** não apontavam
   para o endereço publicado. Quando o `redirectTo` não está na lista de
   URLs permitidas, o Supabase troca silenciosamente pelo Site URL.

> Importante: o link só é corrigido de ponta a ponta quando **as duas partes**
> estão certas. Alterar apenas o código não resolve se o painel do Supabase
> continuar apontando para `localhost`.

---

## 2. O que foi alterado

### 2.1. `js/config.js` — nova variável `APP_URL`

Foi adicionada uma configuração explícita para a URL pública do app:

```js
var APP_URL = "";
```

- **Vazio (`""`):** o app usa automaticamente o endereço da página quando ela
  está em `http`/`https`.
- **Preenchido:** use o endereço definitivo, com `https` e barra no final:

  ```js
  var APP_URL = "https://minha-agenda.netlify.app/";
  ```

Essa é a URL enviada ao Supabase como `redirectTo` no e-mail de recuperação
(e também no e-mail de confirmação de cadastro).

### 2.2. `js/app.js` — novas funções de URL e link

Novo bloco **“URL do app e links de autenticação”**, logo antes da seção
`auth`:

| Função | Responsabilidade |
|---|---|
| `appUrlConfigured()` | Diz se `APP_URL` foi preenchida com uma URL `http(s)` válida. |
| `appBaseUrl()` | Monta a URL pública canônica. Prioriza `APP_URL`; sem ela, usa `location.origin + location.pathname`. Remove `?query`, `#hash` e `index.html`, garantindo a barra final. Retorna `""` em `file://` (onde não existe origem válida). |
| `isLocalUrl(url)` | Detecta `localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]` e `*.local`. |
| `parseAuthLink()` | Lê `error`, `error_code`, `error_description` e `type` da URL (query e hash), antes de o Supabase consumir os tokens. |
| `authLinkMessage(link)` | Traduz os erros do link para mensagens claras em português (link expirado, link inválido etc.). |
| `cleanAuthUrl()` | Remove tokens e erros de autenticação da barra de endereço, mantendo a rota normal do app. |

### 2.3. `js/app.js` — envio do e-mail de recuperação

Antes:

```js
var r3 = await sb.auth.resetPasswordForEmail(em, {
  redirectTo: location.origin + location.pathname
});
```

Depois:

```js
var baseR = appBaseUrl();
if (!baseR) {
  // file:// — explica o problema em vez de enviar um link inválido
}
var r3 = await sb.auth.resetPasswordForEmail(em, { redirectTo: baseR });
```

Comportamentos novos:

- Em `file://`, o envio é bloqueado com uma mensagem explicando que é preciso
  publicar o site ou preencher `APP_URL`.
- Em `localhost` sem `APP_URL`, é gravado um aviso no console do navegador
  avisando que o link apontará para a máquina local.
- A confirmação exibida ao usuário agora informa o e-mail e o próximo passo
  (“abra o e-mail e toque no link para definir a nova senha”).

### 2.4. `js/app.js` — cadastro (`signUp`)

O cadastro passou a enviar `emailRedirectTo` com a mesma URL canônica. Assim,
quando “Confirm email” estiver ligado, o link de confirmação também volta para
o endereço correto (antes ele usava o Site URL do painel).

### 2.5. `js/app.js` — abertura do link e definição da nova senha

- A URL é analisada **antes** de `supabase.createClient(...)`, porque a
  biblioteca consome e limpa os tokens da URL.
- O estado `recovering` impede que a sessão temporária do link abra o app
  antes de a nova senha ser definida.
- Ao receber `PASSWORD_RECOVERY`, o app mostra a tela de login e abre o modal
  **“Definir nova senha”**.
- Erros vindos do link (ex.: `otp_expired`) agora aparecem na tela em
  português, em vez de a página abrir sem explicação.
- Ao salvar a nova senha:
  - a senha é atualizada via `sb.auth.updateUser({ password })`;
  - a URL é limpa (tokens não ficam no histórico do navegador);
  - o usuário é levado ao app já conectado (ou à tela de login, se a sessão
    não puder ser confirmada).

---

## 3. Configuração obrigatória no Supabase

Acesse **Supabase → Authentication → URL Configuration**.

### 3.1. Site URL

Coloque o endereço **publicado** do app, sempre com `https` e barra final:

```
https://minha-agenda.netlify.app/
```

> É esse valor que o Supabase usa quando o `redirectTo` não é aceito. Se ele
> estiver como `http://localhost:3000`, **todo** link de e-mail cai em
> localhost — exatamente o sintoma relatado.

### 3.2. Redirect URLs

Adicione as URLs permitidas (uma por linha):

```
https://minha-agenda.netlify.app/
https://minha-agenda.netlify.app/**
http://localhost:5500/**
```

- A primeira cobre o link de recuperação (que usa a raiz do site).
- A segunda cobre caminhos internos e variações.
- A terceira é opcional: só para testar no Live Server. Remova em produção se
  não quiser permitir redirecionamentos para a máquina local.

A URL usada no e-mail precisa **bater exatamente** com uma entrada da lista
(incluindo `https`, domínio e barra final). Caso contrário o Supabase ignora o
`redirectTo` e usa o **Site URL**.

### 3.3. Template do e-mail

Em **Authentication → Email Templates → Reset Password**, mantenha o link
apontando para a URL de confirmação:

```html
<a href="{{ .ConfirmationURL }}">Redefinir senha</a>
```

Não troque `{{ .ConfirmationURL }}` por `{{ .SiteURL }}`: o primeiro carrega o
token e respeita o `redirectTo`; o segundo leva apenas para a raiz do site.

### 3.4. `js/config.js`

Preencha a mesma URL pública:

```js
var APP_URL = "https://minha-agenda.netlify.app/";
```

---

## 4. Como testar o fluxo completo

1. Publique o app (ou rode no Live Server com a URL dele liberada no Supabase).
2. Abra o site pelo endereço publicado.
3. Clique em **Esqueci minha senha**, informe o e-mail e envie.
4. Abra o e-mail e clique no link.
5. O navegador deve abrir o app e exibir o modal **Definir nova senha**.
6. Informe a nova senha (mínimo 6 caracteres) e salve.
7. O app deve entrar já conectado. Saia e entre novamente com a nova senha
   para confirmar.

Dica: a barra de endereço do link deve começar com a URL de produção, por
exemplo:

```
https://minha-agenda.netlify.app/#access_token=...&type=recovery
```

Se começar com `http://localhost...`, o problema ainda está no **Site URL** do
painel do Supabase.

---

## 5. Resolução de problemas

| Sintoma | Causa provável | Solução |
|---|---|---|
| Link abre em `localhost` | **Site URL** do Supabase ainda é local, ou `redirectTo` não está em **Redirect URLs** | Corrigir as duas configurações (seção 3) |
| Link abre em “URL inválida” / página em branco | App aberto por `file://` na hora de pedir o link | Publicar o site ou preencher `APP_URL` |
| “O link de recuperação expirou ou já foi usado” | Link com mais de 1 hora ou já utilizado | Pedir um novo link |
| Link abre o app, mas não aparece o modal | `redirectTo` caiu em outra página/aba | Conferir **Redirect URLs** e o template do e-mail |
| Erro “Email link is invalid or has expired” | Token inválido (link antigo, template alterado ou URL não liberada) | Gerar novo link após corrigir as configurações |
| Nada acontece ao clicar em “Enviar link” | App em `file://` | Mensagem já orienta; publicar o site |
| Muitos pedidos seguidos | Limite de envio do Supabase | Aguardar alguns minutos |

> Links de recuperação já enviados antes da correção continuam inválidos.
> É necessário pedir um novo link depois de ajustar o Supabase.

---

## 6. Ficheiros alterados

| Ficheiro | Alteração |
|---|---|
| `js/config.js` | Nova variável `APP_URL` documentada (URL pública do app). |
| `js/app.js` | Funções `appUrlConfigured`, `appBaseUrl`, `isLocalUrl`, `parseAuthLink`, `authLinkMessage`, `cleanAuthUrl`; envio do e-mail com URL canônica; `emailRedirectTo` no cadastro; tratamento de `PASSWORD_RECOVERY`, de erros do link e do pós-salvamento da senha. |
| `LEIA-ME.md` | Seção de autenticação ampliada e ligação para este documento. |
| `README.md` | Passo de configuração mencionando `APP_URL`. |
| `docs/RECUPERACAO-SENHA.md` | Este documento. |

---

## 7. Notas de segurança

- O app usa apenas a chave pública (`anon` / `publishable`). Nunca coloque a
  `service_role` no navegador.
- O token de recuperação é removido da URL após o uso, evitando que fique no
  histórico do navegador.
- O link de recuperação é de uso único e expira; ao salvar a senha, o usuário
  é autenticado com a sessão criada pelo próprio link.
