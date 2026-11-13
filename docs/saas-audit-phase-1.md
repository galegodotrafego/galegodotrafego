# Auditoria SaaS — etapa 1 — 11/11/2026

**Decisão: NÃO APROVADA para avançar como etapa validada ou lançar comercialmente.**
As correções locais passaram nos checks abaixo; ainda há verificações críticas de integração e privacidade pendentes.

## Escopo e arquitetura

Base analisada: `b55c9371861d3bef698bff3a1b5135585114836b`, branch
`feat/saas-customer-provisioning`, PR #1. Comparação com main
`6ed9191189e71d2e69d9380422f9415ecc589266` (ancestral, sem conflito local).
Nenhum merge, deploy ou acesso a banco de clientes foi realizado.

- Next.js App Router (16.2.12, corrigido para 16.4.6), React 19.2.4,
  TypeScript 6, Tailwind 4, next-intl, Supabase JS/SSR.
- Supabase Auth, PostgreSQL com RLS, Realtime e Storage. Tenancy compartilhada
  por `account_id`; cada perfil pertence a uma conta. Papéis owner/admin/agent/viewer.
- Inbox WhatsApp, contatos/tags/campos, pipelines, broadcasts, automações/flows,
  IA/base de conhecimento, convites/equipe, API pública com escopos e servidor MCP.
- APIs privilegiadas usam service role; guard de plataforma usa `auth.getUser()`,
  e-mail confirmado e allow-list server-only, independente do owner do cliente.
- Revisão integral dos oito arquivos alterados pelo PR original; revisão focada
  dos fluxos de autenticação, provisionamento, papéis, migrações, referências
  entre tenants, Storage e checks. Não representa pentest completo de cada API.

## Problemas e correções

1. Exemplo de ambiente tinha `\\n` literais, tornando a configuração ilegível:
   corrigido para linhas reais.
2. Cadastro podia auto-confirmar um endereço reservado à administração global:
   recusado antes de criar usuário.
3. POST aceitava JSON enviado com tipo text/plain: exige application/json e
   recusa `Sec-Fetch-Site: cross-site`, impedindo o caminho de formulário simples.
4. Sucesso era informado sem conferir perfil/tenant/papel ou linhas renomeadas:
   agora valida perfil owner, mesma conta e retorno efetivo do update.
5. Exceções após criar Auth escapavam da compensação: limpeza agora abrange
   leituras/renomeação com falha; só atua no novo user ID, contas antes do Auth.
   Falha na compensação exige revisão manual; logs não incluem objetos do provedor.
6. Todo erro 422 era classificado como duplicidade: usa códigos específicos.
7. Senha puramente aleatória podia não satisfazer regras de classes: acrescenta
   maiúscula, minúscula, número e símbolo, preservando 192 bits aleatórios.
8. Migration 040: remove INSERT de perfis pelo browser (trigger é responsável),
   bloqueia alteração direta de owner_user_id por authenticated e deixa bootstrap
   de Auth/conta/perfil falhar atomicamente em vez de engolir exceções.
9. Migration 041: valida relações entre empresas em notas, conversas, deals,
   contatos/tags/campos personalizados e destinatários de broadcasts; valida
   também que a etapa pertence ao pipeline do deal. Atua em novos INSERT/UPDATE,
   inclusive com service role; não modifica nem corrige registros históricos.
10. Dois testes usavam datas UTC para verificar dia local: fixtures corrigidas;
    13 testes de datas passaram em UTC e America/Sao_Paulo.
11. Dependências: Next.js atualizado e lockfiles corrigidos sem audit fix --force.
    MCP atualizado para Zod 4, com teste de protocolo/schema sem chamadas externas.
12. Adicionados 22 testes de endpoint, 27 checks SQL isolados e checks na CI.

A atualização transitiva de eslint-plugin-react-hooks para 7.1.1 introduziu
27 diagnósticos novos em telas preexistentes. Para evitar refatoração geral fora
desta etapa, preservados eslint-config-next 16.2.12 e plugin 7.0.1 (baseline
original), sem desativar regras. A atualização desta ferramenta fica pendente.

## Resultados reais locais

Ambiente: Node 24.22.1 / npm 11.9.0; CI do projeto usa Node 20.
Build usa placeholders documentados na CI, nunca credenciais reais.

| Verificação | Antes | Depois |
|---|---|---|
| Vitest | 829 passaram; 2 falharam | 853/853; 81 arquivos |
| ESLint | 0 erros, 37 avisos | 0 erros, 37 avisos preexistentes |
| Typecheck | Passou | Passou |
| next build | Passou | Passou em Next 16.4.6 |
| SQL/PGlite | Não existia | 27 verificações passaram |
| Datas UTC/São Paulo | Falha em fuso negativo | 13/13 em cada fuso |
| MCP typecheck/build | Passou | Passou após atualização |
| MCP schema/protocolo | Não existia | Passou: leitura/escrita e rejeição de limite inválido |
| npm audit principal | 34: 2 críticas, 12 altas, 19 moderadas, 1 baixa | 12: 10 moderadas, 2 baixas; zero altas/críticas |
| npm audit MCP | 1 alta remanescente após correções compatíveis | Zero após atualização Zod |

`npm audit` contabiliza pacotes afetados, não necessariamente vulnerabilidades
independentes/exploráveis. Restam cadeias de deepmerge/shadcn e minimatch/
TypeScript ESLint/ts-morph. Não foi aplicado downgrade forçado de shadcn nem
substituição incompatível de dependências apenas para zerar o contador.
Build avisa depreciação de middleware/Edge Runtime; não é falha de build.

## Bloqueios e validação necessária

- **Supabase completo:** replay de 001–041, RLS real, JWT, PostgREST, Auth,
  Realtime e Storage ainda não testados neste ambiente. PGlite usa PostgreSQL
  com fixture mínima: comprova SQL e guards isolados, não a integração completa.
  Sem Docker, CLI Supabase ou psql disponíveis localmente. A CI Migrations
  existente pode fazer replay em banco descartável; conferir o resultado do commit.
- **Privacidade dos anexos:** migrations 020/023 mantêm flow-media/chat-media
  públicos para download pela Meta. Conhecer uma URL permite leitura sem login.
  Não há garantia de confidencialidade entre tenants para esses arquivos.
  Fechar buckets sem ajustar entrega à Meta quebraria funcionalidade; é preciso
  validar uma solução de mídia privada/URLs temporárias antes da aprovação SaaS.
- **Provisionamento real:** criar A/B e operadores de teste, confirmar login e
  troca de senha, falhas/duplicidade, perfil/conta/owner, rollback e perda de resposta.
  Não há idempotência persistente: resposta perdida exige verificar cadastro,
  não repetir cegamente. Troca de senha inicial é orientada, não obrigatória.
- **Isolamento end-to-end:** tentar leitura/escrita cruzada em todas as entidades,
  convites/equipe, storage, API keys, webhooks, jobs e caminhos service-role.
  Testar também alteração de papéis/transferência com as novas migrações.
- **Histórico:** auditar referências entre tenants antes de aplicar guards a
  instalação existente. Nenhum registro real foi consultado ou modificado.
- **Comercialização:** signup público, ausência de cobrança/suspensão por plano,
  allow-list por e-mail e rate limit em memória continuam limitações conhecidas.
  Não foram criadas novas funcionalidades de billing nesta etapa.
- **Browser/integrações:** não houve sessão real nem teste visual autenticado,
  envio à Meta ou execução de IA com provedores externos.
- **CI remota/Node 20:** consultar os checks do commit no PR; execução local
  Node 24 não comprova o ambiente Node 20.

## O que falta disponibilizar

Um projeto Supabase **exclusivo de homologação**, sem clientes reais, com URL,
chave pública e service role configuradas por canal seguro no ambiente de testes;
conta operadora de teste com e-mail verificado e `PLATFORM_ADMIN_EMAILS` server-only.
Para mídia/WhatsApp, número e app Meta de teste, configuração e segredos próprios
de homologação; para teste IA real, chave de teste com limite de uso.
Não enviar senhas/tokens no PR ou no chat. Não é necessário acesso a produção.

Reprodução: `npm ci`; `npm run lint`; `npm run typecheck`; `npm test`;
`npm run test:db-security`; `npm run build` com os placeholders da CI;
`npm ci --prefix mcp-server`; `npm run typecheck --prefix mcp-server`;
`npm test --prefix mcp-server`; `npm audit` em ambos os pacotes.
