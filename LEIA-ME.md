# Minha Agenda – como colocar para funcionar

O app é feito de `index.html` (estrutura), `css/style.css` (visual) e `js/` (configuração e lógica). Ele guarda os dados no **Supabase** (gratuito para começar). Cada profissional cria a própria conta e só vê os próprios pacientes.

## 1. Criar o banco
1. Crie um projeto em https://supabase.com.
2. Abra **SQL Editor**, cole o conteúdo de `supabase.sql` e clique em **Run**.
   O arquivo já inclui as permissões (`GRANT`) que o Supabase passa a exigir para tabelas novas em `public`. Se aparecer o erro "permission denied for table", é porque faltou rodar essa parte.
3. Confira em **Project Settings → API** (Data API) se o schema `public` está exposto.

## 2. Ligar o app ao banco
1. No Supabase, vá em **Project Settings → API**.
2. Copie a **Project URL** e a chave **anon / publishable**.
3. Abra o arquivo `js/config.js` e preencha:
   ```js
   var SUPABASE_URL = "https://SEU-PROJETO.supabase.co";
   var SUPABASE_KEY = "sua-chave-publica";
   ```
   Use apenas a chave pública. **Nunca** coloque a chave `service_role` no arquivo.

## Testar no VS Code (Live Server)
1. Descompacte o `minha-agenda.zip`. As pastas `css` e `js` devem ficar **ao lado** do `index.html`.
2. No VS Code: **File → Open Folder** e escolha a pasta `minha-agenda`.
3. Instale a extensão **Live Server** (Ritwick Dey).
4. Clique com o botão direito no `index.html` → **Open with Live Server**. Abra no navegador (Chrome/Edge), não na visualização embutida do VS Code.
5. Se aparecer "Configuração pendente", preencha `js/config.js`. Se aparecer "Carregando…" sem sair, as pastas `css`/`js` não estão ao lado do `index.html`. Se aparecer "Erro no script", a mensagem diz o que houve.

**Tela preta?** Costuma ser o `index.html` aberto sem as pastas `css` e `js` (baixados um por um, sem as pastas) ou aberto na visualização embutida do VS Code. Use o zip e o Live Server.

## 3. Publicar
Suba a pasta inteira (`index.html`, `css/` e `js/`) em qualquer hospedagem de site estático (Netlify, Vercel, GitHub Pages, Cloudflare Pages). O endereço precisa ser **https**.

## 4. Autenticação
Antes de publicar, habilite o retorno do link de recuperação de senha:
1. Em **Authentication → URL Configuration**, ponha o endereço do site em **Site URL** (com `https` e barra no final, ex.: `https://agendaprox.netlify.app/`).
2. Em **Redirect URLs**, adicione o mesmo endereço e a variação com `/**` (ex.: `https://agendaprox.netlify.app/**`). Para testar no Live Server, adicione também `http://localhost:5500/**`.
3. Em `js/config.js`, preencha `APP_URL` com o endereço publicado. Sem isso, o link do e-mail pode apontar para `localhost` ou para uma URL inválida quando o app é aberto por `file://`.
4. Em **Authentication → Email Templates → Reset Password**, mantenha o link como `{{ .ConfirmationURL }}`.

O passo a passo completo, com diagnóstico de erros, está em [`docs/RECUPERACAO-SENHA.md`](./docs/RECUPERACAO-SENHA.md).

Para a pessoa entrar **na hora** depois de criar a conta, desligue **Authentication → Sign In / Providers → Email → Confirm email**. Com isso o app faz o login automático e ninguém precisa abrir o e-mail.
O nome informado no cadastro ("Como você gostaria de ser chamado?") fica salvo na tabela `profiles`, ligado à conta.

### Política de senha
- **Cadastro e redefinição:** senha com no mínimo **8 caracteres**, 1 letra maiúscula, 1 número e 1 caractere especial. O app valida antes de enviar e exibe os requisitos em tempo real.
- **Login:** contas antigas com senha mais simples continuam podendo entrar (o app só exige preenchimento e senha com 6+ caracteres).
- A regra é a mesma para cadastro e redefinição (fonte única em `js/app.js`: `PW_RULES`).

## 5. Usar no celular
- **iPhone (Safari):** Compartilhar → Adicionar à Tela de Início.
- **Android (Chrome):** menu ⋮ → Instalar app / Adicionar à tela inicial.

## Sobre os lembretes
Os avisos funcionam **com o app aberto** (ou aberto em segundo plano): tela com aviso, e notificação do navegador se você tocar no sino 🔔 e permitir. Com o app totalmente fechado, o navegador não consegue disparar avisos sozinho. Para isso seria preciso um serviço de push ou um app nativo.
