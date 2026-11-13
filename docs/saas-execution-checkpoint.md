# Missão integral — checkpoint de execução (13/11/2026)

**Não concluída. Não realizar merge nem publicar em produção.**

O proprietário autorizou execução autônoma de código, migrations em homologação, testes, branches e deploy de homologação sem despesas. Essa autorização não dispensa confirmações obrigatórias das ferramentas. Merge em main somente após todos os critérios críticos; condição ainda NÃO satisfeita.

## Estado versionado

Base anterior: `4d4241a`, PR #1, branch `feat/saas-customer-provisioning`. As duas tentativas dos agentes especializados foram interrompidas por limite de uso. O trabalho incompleto foi revisado: dependências ausentes de assinatura produziam falhas em 47 testes. Ele foi separado em `wip/saas-commercial-foundation`, apenas para retomada, sem merge nem aplicação de suas migrations. Não usar essa branch como versão homologada.

A branch do PR conserva o cadastro administrativo anterior, acrescentando proteção compartilhada contra abuso. Ativação/idempotência/cobrança/suspensão novas NÃO estão disponíveis nela ainda.

## Incremento implementado na branch do PR

- Mídias chat-media/flow-media e avatars: migration para buckets privados e RLS por empresa. Funcionários agent+ podem gravar mídias; viewer apenas lê. Caminhos de outra empresa e mudança de prefixo são bloqueados.
- Referências duráveis `/api/storage/media?bucket=...&path=...`, sem tokens persistidos no CRM. Resolver autentica a sessão e usa Storage com RLS, nunca service_role, para produzir redirecionamento temporário de 60 segundos e no-store.
- Entrega legítima à Meta: assinatura por 300 segundos no servidor, após conferir o prefixo de empresa; propagação de accountId em envio, broadcasts, flows, automações e templates. A assinatura temporária é uma capacidade bearer: quem recebe o link pode usá-lo durante a validade. A UI exige nova autorização para obtê-lo.
- URLs públicas antigas deste projeto são convertidas em referências privadas na renderização. Mídias antigas com prefixo de usuário requerem inventário e cópia auditada; a mudança não tenta adivinhar a empresa histórica. Homologação tinha zero objetos nos três buckets antes da tentativa de migração.
- Avatars privados: leitura por integrantes da empresa; gravação apenas no caminho do próprio usuário.
- Rate limit administrativo compartilhado no PostgreSQL, com incremento atômico, identificadores em SHA-256, acesso RPC somente service_role, limpeza limitada e falha fechada quando o serviço não está disponível. Integrado ao cadastro global de empresas. Outros limites do CRM ainda são locais ao processo.
- Configuração central de marca provisória Identidade CRM: nome, descrição, logo, favicon, cor do ícone e tema padrão. Isto não equivale a tradução completa do CRM para PT-BR.
- Novo comando `npm run test:storage-security` incluído no CI.

## Resultados locais desta retomada

- Vitest: 871 testes em 86 arquivos passaram.
- Lint: zero erros, 37 avisos preexistentes.
- Typecheck: passou.
- PGlite anterior: 27 verificações passaram.
- Novo fixture PostgreSQL Storage/limiter: 32 verificações passaram.
- MCP: typecheck e smoke/build passaram.
- Build Next.js: passou com placeholders, sem segredos de homologação.

Os fixtures de políticas usam PostgreSQL isolado com schemas mínimos. Não são Storage HTTP real, teste de entrega à Meta ou comprovação de concorrência em múltiplos servidores. Os testes unitários de assinatura usam mocks. Testes reais anteriores continuam descritos em `saas-homologacao-phase-2.md`.

## Estado remoto e bloqueio obrigatório

Projeto exclusivo `mpxepzmqvobzhpcgolun`, organização Identidade CRM, São Paulo. Uma nova consulta HTTP a Auth retornou 200. A chave service_role continua indisponível ao executor; não foi fabricada nem exposta.

A ferramenta `apply_migration` pediu confirmação para `20261113133124_private_account_media`. Duas tentativas retornaram `status: expired` / “This confirmation expired after 2 minutes”. Não houve aprovação concluída. Não contornamos o fluxo executando DDL por outra ferramenta.

Consulta posterior confirmou **42 migrations e os três buckets ainda públicos**. Portanto o bloqueio de privacidade remoto continua aberto, apesar da correção de código estar pronta para homologação. A migration do limitador também não foi aplicada. Antes de executar a versão nova, aplicar ambas na homologação; sem a segunda o cadastro administrativo falhará fechado.

## Próxima execução, sem repetir auditoria inicial

1. Conferir HEAD remoto e este checkpoint. Manter PR em rascunho.
2. Concluir a confirmação obrigatória e aplicar as migrations `20261113133124_private_account_media` e `20261113182010_distributed_admin_limits` exclusivamente na homologação.
3. Testar Storage HTTP com sessões A/B/viewer: upload próprio, leitura/signed URL, listagem, alteração/exclusão cruzadas, anonimato e expiração. Testar Meta com app/número de teste antes de aprovar entrega. Confirmar rate-limit RPC no PostgreSQL real e múltiplas requisições.
4. Retomar `wip/saas-commercial-foundation`: billing SQL tem tabelas/rotinas preliminares, mas faltam APIs, adapter/simulador verificado, UI e testes. Migration de entitlement foi deixada vazia pelos agentes; chamadas existentes a account_has_access/account_has_feature não possuem implementação. NÃO aplicar esse conjunto parcial.
5. Completar ativação: API preliminar depende de ledger, billing_start_subscription e página `/activate` ainda inexistente; signup de funcionário ainda precisa enviar token e adaptar resgate. Validar expiração, retries, concorrência, cancelamento/compensação e recuperação. Não remover testes antigos sem substituí-los pelas novas garantias.
6. Completar suspensão/reativação em RLS, service_role, jobs, Realtime e Storage; limites atômicos; painel de empresas/planos/assinaturas/auditoria. Depois tradução PT-BR completa e validação de UI.
7. Infraestrutura: CI remota, secrets exclusivos de teste, SMTP/redirects, backup/restauração, logs/monitoramento e cron. Não contratar serviço pago nem processar pagamento real.

## Configuração da marca

Variáveis públicas opcionais (build-time): `NEXT_PUBLIC_BRAND_NAME`, `NEXT_PUBLIC_BRAND_LOGO`, `NEXT_PUBLIC_BRAND_FAVICON`, `NEXT_PUBLIC_BRAND_COLOR` (hex), `NEXT_PUBLIC_BRAND_THEME` (um tema existente). Logo/favicon aceitam somente caminho local estático. Nenhuma dessas variáveis deve conter segredos. A licença MIT foi preservada.

## Aprovação

A missão ampla permanece em execução, com checkpoint necessário por limites do ambiente e confirmação externa pendente. Nenhuma assinatura real, cobrança, alteração de produção ou merge foi realizado. Código local aprovado não equivale a base SaaS integral ou homologação comercial aprovada.
