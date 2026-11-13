# SaaS — provisionamento manual de empresas (fase 1)

## Objetivo
O operador comercializa o CRM para empresas locais e provisiona o primeiro
usuário de cada empresa após a contratação. Cada proprietário recebe conta
Supabase Auth + registro em `accounts` com sua própria `account_id`,
usando as políticas RLS já existentes.

## Configuração
1. Aplicar as migrações Supabase existentes (até 041 (validar primeiro em homologação)) antes de usar o painel.
2. Criar sua própria conta confirmada no Supabase Auth.
3. Definir `PLATFORM_ADMIN_EMAILS=seu-email@dominio.com` **somente no servidor**.
4. Configurar `SUPABASE_SERVICE_ROLE_KEY` somente no servidor; HTTPS obrigatório.
5. Acessar `/platform/companies`. Apenas os e-mails verificados e
   listados em `PLATFORM_ADMIN_EMAILS` podem usar as APIs privilegiadas.
6. Após uma venda, cadastrar empresa, responsável e e-mail. O sistema cria
   uma senha inicial aleatória, exibida uma única vez ao operador.

## Segurança e operação
- Nunca colocar `SUPABASE_SERVICE_ROLE_KEY` ou `PLATFORM_ADMIN_EMAILS` em
  variáveis `NEXT_PUBLIC_`; não gravar a senha inicial em CRM, planilha ou
  repositório. Incentivar troca imediata na primeira sessão.
- As APIs de administração usam sessão autenticada validada no servidor,
  e-mail confirmado e allow-list; o papel 'owner' de uma empresa
  **não** concede acesso ao painel global.
- Cada usuário criado recebe sua conta isolada via trigger
  `handle_new_user` (migração 017). A API renomeia essa conta
  com o nome comercial após a criação.
- O endpoint GET retorna até 100 contas por enquanto; paginação, busca e
  políticas de retenção podem ser implementadas antes de escalar.
- O projeto-base ainda oferece cadastro público (Supabase `signUp`).
  **Esta primeira etapa NÃO impede o auto-cadastro gratuito**. Antes de
  lançar comercialmente, implementar um bloqueio **no banco/serviço
  de autenticação** que preserve convites de funcionários; esconder o
  botão 'Cadastrar' não é uma proteção suficiente.
- O projeto ainda **não** controla pagamentos, assinaturas, suspensão,
  renovação ou acesso por plano. Não considerar como SaaS pago pronto
  para produção até implementar cobrança e bloqueio de acesso,
  inclusive nos caminhos que usam service role.
- E-mails da allow-list de operadores são recusados no cadastro de clientes.
  O código cria usuários com `email_confirm: true` para permitir entrega
  presencial dos dados. A empresa deve validar o e-mail antes de
  habilitar recursos sensíveis; se o cadastro online for automatizado,
  substituir por convite de ativação verificado.
- Em uma falha após criar um usuário, a API tenta desfazer conta e
  usuário. Se a compensação falhar, exige correção manual antes de
  repetir o cadastro (evita criar contas duplicadas).
- O rate limit atual é em memória e deve migrar para armazenamento
  compartilhado antes de hospedar em múltiplos processos.

## Próximas fases
- Cadastro comercial fechado e convites de equipe seguros.
- Planos, assinaturas, webhooks idempotentes de pagamento, cobrança e
  limites por plano (usuários, mensagens, recursos).
- Suspensão/reabilitação respeitando RLS, API pública, webhooks, jobs,
  automações e chaves já emitidas.
- Auditoria, monitoramento, backups, LGPD e testes de isolamento entre
  empresas em ambiente de homologação.

As alterações desta fase devem entrar por PR; não executar em produção
antes de validar os testes de autenticação e de isolamento.
