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

### 1.1. Segundo problema: o link abria o app, mas não mostrava o formulário

Depois de corrigir o redirecionamento, o link passou a voltar para
`https://agendaprox.netlify.app/`, mas o modal **“Definir nova senha”** não
aparecia. Havia três causas no frontend:

1. O código só abria o formulário no evento `PASSWORD_RECOVERY`. Em alguns
   retornos (por exemplo, `?code=...`), o Supabase dispara apenas
   `SIGNED_IN`, e o app entrava direto na agenda.
2. O evento `SIGNED_IN` zerava a flag `recovering`, então a sessão temporária
   era tratada como um login normal.
3. O evento `INITIAL_SESSION`, que chega depois, chamava `showAuth()` e podia
   fechar o modal recém-aberto.

### 1.2. Terceiro problema: o formulário piscava e a Home abria

Ainda era possível ver o formulário por um instante e ser levado para a Home.
A causa era a **ordem imprevisível dos eventos** do Supabase: um `SIGNED_OUT`
ou um `INITIAL_SESSION` sem sessão podia chegar depois do
`PASSWORD_RECOVERY`, desligando a recuperação e liberando o `SIGNED_IN`
seguinte para chamar `startApp()`.

A correção (estado "sticky" + guarda no `startApp()`) está descrita na
secção 2.6.


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
  var APP_URL = "https://agendaprox.netlify.app/";
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
| `parseAuthLink()` | Lê `error`, `error_code`, `error_description`, `type`, `code`, `token_hash` e `access_token` da URL (query e hash), antes de o Supabase consumir os tokens. |
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
- O formulário abre tanto com o evento `PASSWORD_RECOVERY` quanto com
  `SIGNED_IN` quando a URL indica recuperação. Isso cobre os dois formatos de
  retorno do Supabase (hash com `type=recovery` e `?code=...`).
- Se o evento inicial (`INITIAL_SESSION`) chegar depois, ele não fecha mais o
  modal.
- Em retornos com `?code=...` sem `type=recovery`, o app reconhece o pedido
  guardado no navegador (válido por 2 horas) e abre o formulário.
- O modal tem **Nova senha** e **Confirmar nova senha**, valida o mínimo de 6
  caracteres e a igualdade entre os campos, e não fecha por clique fora ou
  tecla Esc durante a recuperação.
- Erros vindos do link (ex.: `otp_expired`) agora aparecem na tela em
  português, em vez de a página abrir sem explicação. Quando a URL já traz um
  erro, a recuperação nem começa (não abre um formulário que não poderia
  salvar).
- Ao salvar a nova senha:
  - a senha é atualizada via `sb.auth.updateUser({ password })`;
  - a URL é limpa (tokens não ficam no histórico do navegador);
  - a sessão de recuperação é encerrada;
  - o app volta à tela de login com o e-mail preenchido e exibe
    **“Senha alterada com sucesso! Entre com a nova senha.”**;
  - o usuário entra normalmente com a nova senha.
- O botão **Cancelar e voltar ao login** encerra a recuperação e descarta a
  sessão temporária.

### 2.6. `js/app.js` — recuperação "sticky" (correção do pisca e vai para a Home)

Depois da primeira correção, o modal ainda aparecia por um instante e a Home
abria em seguida. Causa: a ordem dos eventos do Supabase não é fixa. Um
`SIGNED_OUT` (ou um `INITIAL_SESSION` sem sessão) podia chegar **depois** do
`PASSWORD_RECOVERY`, zerar a flag `recovering` e permitir que o próximo
`SIGNED_IN` chamasse `startApp()`.

Regras atuais:

- `recovering` é "sticky": só é desligado em três situações explícitas:
  senha salva com sucesso, botão **Cancelar**, ou login/cadastro manual.
- `SIGNED_OUT` durante a recuperação **não** derruba o formulário; ele apenas
  mantém a tela de login com o modal aberto.
- `INITIAL_SESSION` sem sessão durante a recuperação também não fecha o modal.
- `startApp()` tem uma guarda: se `recovering` ou `resetOpen` estiverem ativos,
  ele não abre a Home e reabre o formulário. Assim, nenhum evento do Supabase
  consegue levar o usuário para a agenda no meio da recuperação.
- O estado também fica marcado em `sessionStorage`
  (`agendapro:recovery-flow`), então recarregar a página no meio da recuperação
  mantém o formulário aberto.
- Um login ou cadastro manual limpa esse estado, evitando que um modal antigo
  apareça depois.

> Se o link estiver expirado e o Supabase não devolver sessão, o formulário
> pode ficar aberto, mas ao salvar o app mostra “A sessão do link expirou.
> Peça um novo link…”. O botão **Cancelar** sempre volta ao login.


---

## 3. Configuração no painel do Supabase

Atalhos do seu projeto (ref. `xapteyatswdtmuuzqbiu`):

| Página | Link direto |
|---|---|
| URL Configuration | https://supabase.com/dashboard/project/xapteyatswdtmuuzqbiu/auth/url-configuration |
| Email Templates | https://supabase.com/dashboard/project/xapteyatswdtmuuzqbiu/auth/templates |
| SMTP Settings | https://supabase.com/dashboard/project/xapteyatswdtmuuzqbiu/auth/smtp |
| Rate Limits | https://supabase.com/dashboard/project/xapteyatswdtmuuzqbiu/auth/rate-limits |

### Checklist rápido

- [ ] **Site URL** = URL publicada do app (`https` + barra final).
- [ ] **Redirect URLs** contém a URL publicada, a variação `/**` e, se for
      testar localmente, `http://localhost:5500/**`.
- [ ] Template **Reset Password** usa `{{ .ConfirmationURL }}`.
- [ ] `APP_URL` em `js/config.js` = mesma URL publicada.
- [ ] SMTP próprio configurado (obrigatório em produção).
- [ ] Pedir um **novo** link de recuperação depois das mudanças.

### 3.1. Site URL

**Authentication → URL Configuration → Site URL**

Coloque o endereço **publicado** do app, sempre com `https` e barra final:

```
https://agendaprox.netlify.app/
```

> É esse valor que o Supabase usa quando o `redirectTo` não é aceito. Se ele
> estiver como `http://localhost:3000`, **todo** link de e-mail cai em
> localhost — exatamente o sintoma relatado.

Atenção ao subcaminho: no GitHub Pages o app costuma ficar em
`https://USUARIO.github.io/REPO/`. Nesse caso, o Site URL precisa incluir
`/REPO/`.

### 3.2. Redirect URLs

**Authentication → URL Configuration → Redirect URLs**

Adicione as URLs permitidas (uma por linha):

```
https://agendaprox.netlify.app/
https://agendaprox.netlify.app/**
http://localhost:5500/**
```

- A primeira cobre o link de recuperação (que usa a raiz do site, com barra
  final, exatamente como o app envia).
- A segunda cobre caminhos internos e variações.
- A terceira é opcional: só para testar no Live Server. Remova em produção se
  não quiser permitir redirecionamentos para a máquina local.

A URL usada no e-mail precisa **bater exatamente** com uma entrada da lista
(incluindo `https`, domínio, subcaminho e barra final). Caso contrário o
Supabase ignora o `redirectTo` e usa o **Site URL**.

### 3.3. Template do e-mail

**Authentication → Email Templates → Reset Password**

Mantenha o link apontando para a URL de confirmação:

```html
<a href="{{ .ConfirmationURL }}">Redefinir senha</a>
```

Não troque `{{ .ConfirmationURL }}` por `{{ .SiteURL }}`: o primeiro carrega o
token e respeita o `redirectTo`; o segundo leva apenas para a raiz do site.

### 3.4. `js/config.js`

Preencha a mesma URL pública:

```js
var APP_URL = "https://agendaprox.netlify.app/";
```

### 3.5. Envio de e-mails (SMTP)

**Authentication → SMTP Settings**

O serviço de e-mail embutido do Supabase é **só para testes**:

- entrega apenas para endereços que fazem parte do time do projeto;
- limite de **2 e-mails por hora**;
- sem garantia de entrega.

Em produção, habilite um SMTP próprio. Sem isso, usuários reais recebem o erro
**“Email address not authorized”** ou não recebem nada.

#### Receita com Resend

**No Resend (https://resend.com):**

1. **Domains → Add Domain** e cadastre um domínio que você controla
   (ex.: `agendaprox.com`). O subdomínio `agendaprox.netlify.app` **não serve**,
   porque você não controla o DNS dele.
2. Copie os registos DNS que o Resend mostra (SPF/TXT, DKIM e, se quiser,
   DMARC) e cadastre no seu provedor de domínio.
3. Aguarde o estado **Verified**.
4. **API Keys → Create API Key**, permissão de **Sending access**. Guarde a
   chave `re_...` (ela só aparece uma vez).

**No Supabase → Authentication → SMTP Settings:**

| Campo | Valor |
|---|---|
| Enable Custom SMTP | ligado |
| Host | `smtp.resend.com` |
| Port | `465` (SSL) — recomendado pelo Resend; `587` (STARTTLS) como alternativa |
| Username | `resend` |
| Password | a API key `re_...` |
| Sender email | `no-reply@SEU-DOMINIO-VERIFICADO` |
| Sender name | `Minha Agenda` |

Clique em **Save**. A partir daí, o Supabase envia para **qualquer** endereço
(limite padrão de 30 e-mails/hora, ajustável em **Rate Limits**).

> `onboarding@resend.dev` só entrega para o e-mail dono da conta Resend.
> Para várias pessoas, é obrigatório verificar um domínio próprio.

#### Por que `agendaprox.netlify.app` não serve?

O Resend exige que você prove que controla o domínio de envio, adicionando
registos DNS (MX, SPF e DKIM). Você **não controla o DNS de `netlify.app`** —
ele pertence ao Netlify —, então o domínio nunca fica `Verified` e o Supabase
devolve **“Error sending recovery email”**.

Isso **não obriga** a mudar o site: o app pode continuar em
`https://agendaprox.netlify.app/`. Só o **remetente do e-mail** precisa usar um
domínio próprio, por exemplo:

- `no-reply@agendaprox.com` (domínio raiz verificado), ou
- `no-reply@mail.agendaprox.com` (subdomínio só para envio — recomendado para
  separar a reputação de envio).

Enquanto não tiver domínio próprio, o único teste possível com o Resend é usar
`onboarding@resend.dev` **enviando para o e-mail dono da conta Resend**.

Alternativa temporária sem comprar domínio: provedores que permitem verificar
apenas um remetente (ex.: SendGrid Single Sender ou Brevo). Funciona para
testar, mas a entrega é pior e não é recomendado para muitos usuários.

#### Alternativa sem domínio próprio (temporária)

**Gmail SMTP — recomendado enquanto não houver domínio**

Use uma conta Gmail (de preferência **dedicada ao app**, não a pessoal):

| Campo | Valor |
|---|---|
| Host | `smtp.gmail.com` |
| Port | `465` (SSL) |
| Username | `seuapp@gmail.com` |
| Password | **senha de app** de 16 caracteres (não é a senha normal) |
| Sender email | `seuapp@gmail.com` |
| Sender name | `Minha Agenda` |

Como gerar a senha de app:

1. Ative a **verificação em duas etapas** em
   https://myaccount.google.com/security.
2. Abra https://myaccount.google.com/apppasswords.
3. Crie uma senha para “Mail” e copie os 16 caracteres.
4. Cole em **Password** no Supabase e clique em **Save**.

> Ao salvar com `smtp.gmail.com`, o Supabase mostra o aviso
> **“Check your SMTP provider”** (“designed for sending personal rather than
> transactional email messages”). É **apenas um alerta**, não um bloqueio:
> confirme e salve. Ele só lembra que o Gmail não é um serviço de e-mail
> transacional — por isso use uma conta dedicada, mantenha o volume baixo e
> migre para o Resend quando tiver um domínio.

Vantagens: não precisa de domínio, a entrega é boa (o Gmail assina com
DKIM/SPF do próprio gmail.com) e o limite é de cerca de **500 destinatários por
dia**. Desvantagens: usa uma conta Google, tem limite diário e não é indicado
para volumes grandes — quando tiver um domínio, migre para o Resend.

**Verificação de remetente único (SendGrid ou Brevo)**

Permitem verificar um e-mail (ex.: um Gmail) sem domínio. Porém, ao enviar
“de” um Gmail através de outro provedor, a autenticação DMARC não alinha e a
mensagem cai facilmente em spam. Serve só para testes rápidos.

**O que não resolve**

- `onboarding@resend.dev`: só entrega para o e-mail dono da conta Resend.
- SMTP embutido do Supabase: só para o time do projeto e 2 e-mails/hora.
- Verificar `agendaprox.netlify.app` no Resend: impossível (DNS do Netlify).

**Domínio grátis (para quando quiser migrar)**

- **EU.org** (https://nic.eu.org): domínio gratuito com DNS completo, mas a
  aprovação é manual e pode demorar semanas.
- **GitHub Student Developer Pack**: se você for estudante, inclui um `.me`
  grátis por 1 ano na Namecheap.

Depois de configurar, faça um teste e confira o resultado em
**Resend → Emails** (entregue, bounced, spam etc.).

### 3.6. Limites de envio (Rate Limits)

**Authentication → Rate Limits**

- **Password reset request (`/auth/v1/recover`):** por padrão, o mesmo usuário
  só pode pedir um novo link após **60 segundos**. Se aparecer “For security
  purposes…”, basta aguardar.
- **Emails sent:** com SMTP próprio o padrão é **30 e-mails/hora** e pode ser
  ajustado conforme o seu provedor.
- Se receber `429 Too Many Requests`, aguarde ou revise esses limites.

---

## 4. Como testar o fluxo completo

1. Publique o app (ou rode no Live Server com a URL dele liberada no Supabase).
2. Abra o site pelo endereço publicado.
3. Clique em **Esqueci minha senha**, informe o e-mail e envie.
4. Abra o e-mail e clique no link.
5. O navegador deve abrir o app e exibir o modal **Definir nova senha**.
6. Informe a nova senha e a confirmação (mínimo 6 caracteres) e salve.
7. O app deve mostrar **“Senha alterada com sucesso!”**, voltar ao login com
   o e-mail preenchido e pedir a nova senha.
8. Entre com a nova senha para confirmar.

Dica: a barra de endereço do link deve começar com a URL de produção, por
exemplo:

```
https://agendaprox.netlify.app/#access_token=...&type=recovery
```

Se começar com `http://localhost...`, o problema ainda está no **Site URL** do
painel do Supabase.

### 4.1. O que conta como “publicado” (Netlify + GitHub)

O site de produção (`agendaprox.netlify.app`) é publicado a partir do branch
**`main`** do repositório. Commits em outros branches (por exemplo,
`tela_recuperação`) **não** vão para o ar, mesmo que já estejam no GitHub.

Antes de testar, confirme que o `main` está atualizado:

```powershell
git checkout main
git merge --ff-only origin/NOME-DO-BRANCH
git push origin main
```

O Netlify publica em poucos segundos. Para conferir se o código novo chegou
(abra no navegador ou use `Invoke-WebRequest`):

```
https://agendaprox.netlify.app/js/app.js?x=1
```

O arquivo publicado deve conter a frase `app nunca abre a Home` (comentário da
guarda do `startApp()`). Se não contiver, o deploy ainda é o antigo.

> Um teste feito antes do deploy usa o código antigo e não valida a correção.

---

## 5. Resolução de problemas

| Sintoma | Causa provável | Solução |
|---|---|---|
| Correção feita, mas o site continua com o comportamento antigo | O Netlify publica o branch `main`; a correção ficou em outro branch | Fazer merge/push para o `main` e conferir `js/app.js` publicado (secção 4.1) |
| Link abre em `localhost` | **Site URL** do Supabase ainda é local, ou `redirectTo` não está em **Redirect URLs** | Corrigir as duas configurações (seção 3) |
| Link abre em “URL inválida” / página em branco | App aberto por `file://` na hora de pedir o link | Publicar o site ou preencher `APP_URL` |
| “O link de recuperação expirou ou já foi usado” | Link com mais de 1 hora ou já utilizado | Pedir um novo link |
| Link abre o app, mas não aparece o modal | `redirectTo` caiu em outra página/aba | Conferir **Redirect URLs** e o template do e-mail |
| Erro “Email link is invalid or has expired” | Token inválido (link antigo, template alterado ou URL não liberada) | Gerar novo link após corrigir as configurações |
| Nada acontece ao clicar em “Enviar link” | App em `file://` | Mensagem já orienta; publicar o site |
| “Error sending recovery email” | Falha do SMTP/Resend (domínio não verificado, porta, chave, remetente) | Ver **Logs → Auth Logs** para a mensagem exata e seguir a secção 5.1 |
| “Email address not authorized” | SMTP embutido do Supabase (só entrega para o time do projeto) | Configurar SMTP próprio |
| E-mail não chega para usuários reais | SMTP embutido (2 e-mails/hora, sem garantia) | Configurar SMTP próprio e conferir SPF/DKIM/DMARC |
| “For security purposes…” / `429` | Limite de 60 s por usuário ou limite de e-mails/hora | Aguardar e revisar **Rate Limits** |
| Link expira antes de abrir | Filtro anti-spam do e-mail “pré-carrega” o link | Usar link/OTP próprio ou desativar o rastreio de links no provedor |

> Links de recuperação já enviados antes da correção continuam inválidos.
> É necessário pedir um novo link depois de ajustar o Supabase.

### 5.1. Diagnosticar “Error sending recovery email”

O texto na tela é genérico. A mensagem real fica nos logs:

**Supabase → Logs → Auth Logs** (ou **Logs Explorer** filtrando `auth`)
https://supabase.com/dashboard/project/xapteyatswdtmuuzqbiu/logs/auth-logs

Procure a linha do pedido `/recover` no horário do erro. O que cada mensagem
costuma indicar:

| Log do Supabase | Causa | Correção |
|---|---|---|
| `535 ... Authentication failed` | Usuário/senha SMTP errados no Resend | Username `resend`; Password = API key `re_...` (sem espaços) |
| `535 5.7.8 Username and Password not accepted` | Gmail recusou o login: senha normal em vez de senha de app, senha de app inválida/expirada, usuário sem `@gmail.com` ou 2FA desligada | Ver checklist do Gmail abaixo |
| `550` / `domain is not verified` / `not allowed to send` | Remetente fora do domínio verificado no Resend | Verificar o domínio no Resend e usar `no-reply@DOMINIO-VERIFICADO` |
| `You can only send testing emails to your own email address` | Usou `onboarding@resend.dev` | Verificar um domínio próprio |
| `dial tcp ... i/o timeout` / `connection refused` | Porta/host errados | Host `smtp.resend.com`, porta `465` (ou `587`) |
| `Invalid \`to\` field` | Destinatário inválido | Testar com um e-mail válido |
| `email rate limit exceeded` | Limite do Supabase/Resend | Aguardar ou rever **Rate Limits** |

Checklist rápido do Resend/Supabase:

- [ ] **Enable Custom SMTP** ligado e **Save** clicado.
- [ ] Host `smtp.resend.com`, porta `465`, username `resend`.
- [ ] Password = API key `re_...` com permissão de envio (sem espaços sobrando).
- [ ] Sender email exatamente `no-reply@SEU-DOMINIO-VERIFICADO` (só o e-mail,
      sem “Nome &lt;...&gt;”).
- [ ] Domínio com estado **Verified** no Resend.
- [ ] Testar para um e-mail de outra pessoa (Gmail, por exemplo).
- [ ] Conferir **Resend → Emails** para ver se a mensagem chegou a ser aceita.

Checklist rápido do Gmail (`535 5.7.8 Username and Password not accepted`):

- [ ] **Username** é o endereço completo, incluindo `@gmail.com`
      (não apenas `bshdgcct`). Exemplo errado: `agendapro`; exemplo correto:
      `agendaprox@gmail.com`.
- [ ] **Password** é a **senha de app** de 16 letras, **sem espaços** — não é a
      senha normal da conta Google.
- [ ] A **verificação em duas etapas** está ativa na conta; sem ela não existe
      senha de app.
- [ ] A senha de app foi criada em https://myaccount.google.com/apppasswords
      para “Mail” e não foi revogada.
- [ ] **Sender email** é exatamente o mesmo Gmail usado no login.
- [ ] A conta não está bloqueada/suspensa e não há alerta de segurança em
      https://myaccount.google.com/security-checkup.
- [ ] Depois de corrigir, **Save** no Supabase, aguardar ~1 minuto e pedir um
      **novo** link.

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
