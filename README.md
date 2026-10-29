# Minha Agenda

Aplicação web para profissionais organizarem pacientes, atendimentos e sessões em um só lugar. Funciona no computador e no celular, com os dados armazenados no Supabase.

## Recursos

- Cadastro e acesso por conta, com recuperação de senha.
- Senha forte obrigatória no cadastro e na redefinição (8+ caracteres, maiúscula, número e especial).
- Agenda de atendimentos por dia e por mês.
- Cadastro de pacientes, informações de contato e pacotes de sessões.
- Histórico de atendimentos, com opções para concluir, cancelar ou remarcar sessões.
- Lembretes no navegador enquanto o app estiver aberto ou em segundo plano.
- Dados isolados por conta com políticas de segurança do Supabase.

## Tecnologias

- HTML, CSS e JavaScript.
- Supabase para autenticação e banco de dados.

## Configuração

1. Crie um projeto no [Supabase](https://supabase.com).
2. Execute o conteúdo de [`supabase.sql`](./supabase.sql) no SQL Editor do projeto.
3. Configure a URL do projeto e a chave pública `anon`/`publishable` em [`js/config.js`](./js/config.js). Nunca use a chave `service_role` no navegador.
4. No mesmo arquivo, preencha `APP_URL` com o endereço público do site (`https://agendaprox.netlify.app/` neste projeto) para o link de recuperação de senha funcionar. Detalhes em [`docs/RECUPERACAO-SENHA.md`](./docs/RECUPERACAO-SENHA.md).
5. Sirva a pasta do projeto por um servidor local, como a extensão Live Server do VS Code, ou publique os arquivos em uma hospedagem estática com HTTPS.

Para ver o passo a passo completo, incluindo autenticação, publicação e uso no celular, consulte [`LEIA-ME.md`](./LEIA-ME.md).

## Limitação dos lembretes

As notificações dependem de o app permanecer aberto ou em segundo plano. Com o app totalmente fechado, o navegador não dispara lembretes; isso exigiria um serviço de push ou um app nativo.
