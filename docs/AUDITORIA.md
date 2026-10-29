# Auditoria completa — "Minha Agenda"

Auditoria final do app `https://agendaprox.netlify.app/` (HTML + CSS + JS puro, sem build; dados no Supabase).

**Escopo**: funcionamento, falhas, segurança, limpeza de código, recomendações e o código limpo/corrigido resultante.

**Commit corrigido**: `cbb6d3e` — "auditoria: corrige camadas, politica de senha unica e higieniza formularios" (push para o `main`; publicado no Netlify).

---

## 1. Resumo por gravidade

| Gravidade | Problema | Status |
|---|---|---|
| **Critico** | Modal de redefinição ficava **atrás** da tela de autenticacao (`#modal` z-index 30 vs `#auth` 60) | Corrigido (`#modal` -> 70, toast -> 80) |
| **Critico** | Fluxo de recuperacao "piscava e abria a Home" | Corrigido com estado sticky `recovering` / `resetOpen` + guarda em `startApp()` |
| **Critico** | Modal sem gerenciamento de foco (Tab/Esc/foco inicial) | Corrigido: foco inicial, restauracao de foco e trap de Tab |
| **Alto** | Sessao expirada/revogada nao era tratada (excecoes nao tratadas) | Corrigido com `isAuthError()` + `onAuthExpired()` |
| **Alto** | Cadastro nao aplicava politica forte de senha | Corrigido com politica unificada (`PW_RULES`) em cadastro e redefinicao; login com 6+ para contas antigas |
| **Alto** | Tokens de recuperacao permaneciam em URL | Corrigido com remocao ampliada em `cleanAuthUrl()` |
| **Medio** | `saveRecoveryRequest` gravava e-mail (PII) em localStorage | Corrigido: grava apenas o timestamp |
| **Medio** | Atualizacao de horario padrao propagava para atendimentos passados | Corrigido com `.gte("date", todayISO())` no update |
| **Medio** | Cadastro sem rollback quando o primeiro atendimento falha | Corrigido com rollback do paciente inserido |
| **Baixo** | `init` sem guarda para config ausente | Corrigido com validacao de `SUPABASE_URL` / `SUPABASE_KEY` |
| **Baixo** | Boot com `innerHTML` + placeholder de senha desatualizado | Corrigido com `textContent` e placeholder correto |

---

## 2. O que esta funcionando bem

- Auth (login / cadastro / esqueci) com Supabase, sessao persistida e RLS.
- Fluxo de recuperacao completo: envio (`resetPasswordForEmail`), retorno com `?code=`/`#type=recovery`, abertura do modal "Definir nova senha", `updateUser({password})`, encerramento da sessao e retorno ao login.
- Agenda: calendario mensal, lista do dia, status (agendado/realizado/cancelado/remarcado), "proximo", pendencia, historico.
- Pacientes e pacotes de sessoes, com rollback do cadastro incompleto.
- Lembretes (intervalo, notification, limpeza de `S.notified`).
- UI: tema escuro, modal bottom-sheet, toast, checklist de senha com forca e loading.

## 3. O que NAO estava funcionando ou com falhas

Detalhes dos bugs encontrados durante a auditoria e corrigidos no commit `cbb6d3e`.

### Críticos (corrigidos)

1. **Modal escondido pela tela de autenticacao**: `#modal` tinha `z-index:30`, inferior ao `#auth` (`z-index:60`), entao a tela de redefinicao nunca aparecia por cima da tela de login. Corrigido para `z-index:70` no CSS e `z-index:80` no toast.
2. **Fluxo de recuperacao "piscando"**: o estado era local e o `startApp()` abria a Home. Corrigido com flags `recovering` / `resetOpen`, guarda em `startApp()` e tratamento dos eventos `PASSWORD_RECOVERY`, `SIGNED_IN`, `SIGNED_OUT` e `INITIAL_SESSION`.

### Altos

3. **Sessao expirada**: erros `401` / mensagens de JWT/negada de sessao agora viram `onAuthExpired()`, devolvendo o usuario ao login com mensagem.
4. **Politica de senha**: cadastro e redefinicao agora usam a mesma regra (`PW_RULES`: 8+, maiuscula, numero, especial). O login mantem o minimo de 6 caracteres apenas para contas antigas.
5. **URL de recuperacao**: `cleanAuthUrl()` agora remove `access_token`, `refresh_token`, `expires_in` e `token_type` alem de `error*`, `code` e `token_hash`.

### Medicos / baixos

6. `saveRecoveryRequest` salvava e-mail em localStorage (PII) -> apenas timestamp.
7. Update de horario padrao atualizava atendimentos ja passados -> adicionado `.gte("date", todayISO())`.
8. Rollback de paciente sem primeiro atendimento.
9. `init` com validacao de config.
10. Boot com `textContent`; placeholder de senha corrigido.

## 4. Analise de seguranca

- Chave `anon`/`publishable` no cliente; sem `service_role` no repositorio. RLS + grants no `supabase.sql`.
- Validacao de entrada: senha forte, limites de tamanho (nome, telefone, notas, total de sessoes, valor), `maxlength` nos inputs.
- Sanitizacao: `esc()` nos valores exibidos; validacao de e-mail via Supabase.
- Tokens: removidos da URL apos o uso (`cleanAuthUrl`).
- Autenticacao: modal travado (`modalLocked`) durante a redefinicao; guards contra duplo submit (`loading`).
- Sem segredos/SMTP reais commitados; apenas chave anon.
- Riscos residuais (documentados, baixa prioridade): sem CSP no Netlify (recomendado), sem rate-limit customizado no frontend.

## 5. Limpeza de codigo

Removidos / consolidados:
- `REQ_TXT` duplicado -> fonte unica `PW_RULES`.
- Testes de senha duplicados (`TESTS`) -> reuso de `PW_RULES`.
- E-mail armazenado na recovery -> timestamp apenas.
- Variavel nao usada em `openResetPassword` (limpeza de declaracao).
- Formatação da linha dos event handlers de abas.

Nao foi encontrado codigo morto grande; os helpers restantes (`getP`, `getA`) continuam linear, mas sao usados.

## 6. O que manter / otimizar

Manter: IIFE, helpers (`esc`, `pad`, `isoOf`, `hm`, `mins`, `money`, `initials`), padrao de modal, tratamento de erro via `run()`, toast.

Otimizar (baixa prioridade, nao bloqueante):
- Substituir `getP`/`getA` por Map indexado para listas grandes.
- Debounce na busca de pacientes.
- Centralizar mensagens de erro Supabase.

## 7. Testes realizados

- Browser: boot sem erros no console; modal abre por cima do auth; foco e cancelamento funcionam; validacao de senha (fraca/fraca/match) ativa/desativa botao; login <6 chars bloqueado; placeholder atualizado.
- Deploy: commit `cbb6d3e` no `main`, push ok, deploy publicado no Netlify com `#modal` z-index 70 e novos codigos presentes.

## 8. Alteracoes no commit final

- `js/app.js`: camadas/modal/foco, politica de senha unica, sessao expirada, cleanAuthUrl, rollback, indexAppts, guards.
- `css/style.css`: `#modal` z-index 70, `.toast` z-index 80, `.pdet` consolidado.
- `index.html`: maxlength/name/role/aria-live, autocomplete, placeholder.
- `js/boot.js`: `textContent`.
- `README.md` / `LEIA-ME.md`: politica de senha forte documentada.
