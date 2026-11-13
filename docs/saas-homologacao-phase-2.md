# Missão 02 — homologação parcial, ainda não aprovada

Data: 13/11/2026. Base: `aa84c4b`. Branch: `feat/saas-customer-provisioning`.

## Ambiente

- Supabase `crm-homologacao`, organização Identidade CRM, São Paulo (`sa-east-1`).
- Projeto exclusivo `mpxepzmqvobzhpcgolun`, PostgreSQL 17.11. Cotação de criação: US$ 0/mês; nenhuma contratação paga autorizada.
- Aplicação Next.js executada localmente em loopback, sem deploy público.
- Seis usuários fictícios `example.test`: operador, dois proprietários, dois agentes e um observador. Empresas A e B independentes.
- Usuários iniciais inseridos como fixtures SQL em Auth, acionando os gatilhos reais. Isso **não comprova** o cadastro pelo endpoint de provisionamento. Agentes e observador ingressaram pelos convites reais da aplicação.
- Credenciais aleatórias em arquivo protegido fora do repositório. Nenhum segredo incluído neste PR.

## Migrations e correção

001–041 aplicadas em sequência no projeto vazio. A nova 042 também foi aplicada, totalizando 42 migrations. Todas as 36 tabelas públicas têm RLS ativo; nenhuma política foi desativada.

O Advisor e a inspeção das ACLs identificaram funções SECURITY DEFINER internas executáveis por `anon` e `authenticated`. `REVOKE FROM PUBLIC` em migrations antigas não removia concessões diretas padrão do Supabase. A execução anônima de `claim_ai_reply_slot` foi reproduzida com UUID inexistente, sem alterar dados.

A 042 restringe seis RPCs internos (contadores de broadcasts, slots de IA, falhas de webhook e manutenção de duplicados), preserva `service_role`, remove execução pública de operações que exigem sessão e de funções de gatilhos, e fixa o search_path de quatro funções. Os gatilhos e fluxos de usuário continuam ativos.

Regressões adicionadas a `supabase/ci/verify-schema.sql` e `verify-internal-rpcs.sql`. O teste de permissões foi executado no PostgreSQL real: 12 chamadas negadas, contemplando seis funções em dois papéis. A inspeção confirmou o acesso preservado de `service_role`; a execução HTTP com essa chave permanece pendente.

## Evidências reais

| Verificação | Resultado |
|---|---|
| Auth HTTP: seis logins, senha incorreta, refresh | Passou |
| Convites via Next.js: criação, resgate e rejeição de replay para dois agentes e um observador | Passou na primeira execução; reexecuções marcam fixtures já associadas como skipped |
| HTTP/PostgREST: criar contatos, conversas, mensagens, funis, etapas e negócios nas duas empresas | Passou |
| HTTP: proprietário A não lê/altera/exclui contatos e conversas de B | Passou antes da interrupção de rede |
| SQL com papel authenticated e subject JWT: proprietário e agente A/B, nos dois sentidos, seis tabelas, SELECT/UPDATE/DELETE | 72 tentativas bloqueadas; linhas vítimas preservadas |
| SQL: agente altera registro próprio; observador não altera | 2 verificações passaram |
| SQL: autopromoção, troca de empresa, reatribuição direta de proprietário, três RPCs administrativos entre empresas, inserção com empresa falsa e referência cruzada | 8 tentativas bloqueadas |
| SQL: chamadas aos seis RPCs internos como anon/authenticated | 12 tentativas bloqueadas |
| Verificação de esquema usada pelo CI | Executada com sucesso no Supabase |
| Lint | 0 erros, 37 avisos existentes |
| Typecheck | Passou |
| Vitest | 853 testes em 81 arquivos passaram |
| PGlite | 27 verificações passaram; fixture reduzida, não equivale ao Supabase completo |
| Build Next.js | Passou; avisos de depreciação middleware/Edge Runtime |
| MCP typecheck e smoke de schemas | Passaram |

Os testes SQL de isolamento e papéis estão em `scripts/staging/verify-tenant-rls.sql` e `verify-roles.sql`. Foram executados dentro de BEGIN/ROLLBACK no projeto isolado: o código usa SET LOCAL ROLE authenticated e claims de cada usuário, e não leituras privilegiadas para avaliar o acesso. Não equivalem a testes completos da UI ou dos endpoints.

A primeira execução do novo harness HTTP tinha um campo de fixture incorreto (`content` em vez de `content_text`); foi corrigido. A execução seguinte criou os registros com sucesso, mas a infraestrutura interrompeu o acesso HTTP ao domínio Supabase por política de rede. Portanto **a suíte HTTP completa não passou**. Os passos posteriores — painel global, gerenciamento de API keys, bloqueio de automações, assinatura de webhook e troca de senha — não são registrados como executados nesta etapa. O harness agora grava checkpoints para não confundir relatório antigo com execução interrompida.

## CI remoto

A API do repositório retornou zero workflow runs; a consulta de workflows retornou zero workflows e a página Actions mostrou “No workflows found”. Não existem logs de uma execução remota falha que expliquem a ausência. O repositório é um fork; desativação de Actions em forks é uma hipótese, não uma configuração administrativa comprovada.

Os workflows agora aceitam push na branch desta missão e disparo manual, têm `contents: read` e limite de 20 minutos. Todas as verificações anteriores foram preservadas e foi acrescentada a regressão de RPCs. Os tags v7 de checkout/setup-node foram verificados como existentes, portanto não foram rebaixados. Disparo manual depende de o workflow estar registrado pelo GitHub; não alteramos main para isso.

É necessário confirmar Actions habilitado em Settings → Actions e obter execuções remotas para o novo commit. A conexão GitHub disponível não oferece alteração dessa configuração. Resultado local não substitui CI remoto.

## Bloqueios de aprovação

1. `chat-media` e `flow-media` continuam públicos. RLS das tabelas não protege downloads públicos desses buckets. A privacidade de mídia precisa de correção e teste antes de aprovação comercial.
2. Falta disponibilizar `SUPABASE_SERVICE_ROLE_KEY` **somente deste projeto de homologação** ao processo local por mecanismo seguro de secrets. O conector fornece apenas chaves públicas. Não enviar a chave em conversa nem adicioná-la ao Git. Sem ela não foram validados provisionamento administrativo, API key authentication com escopo, automações e processamento privilegiado de webhooks.
3. Restabelecer acesso HTTP do executor a este projeto e concluir a suíte: bloqueio de painel global, fluxos positivos/negativos dos endpoints e interface.
4. Recuperação de senha por e-mail e conclusão do link ainda não executadas; requerem caixa de testes/SMTP e redirects de homologação. Troca autenticada de senha também não foi alcançada após a interrupção.
5. Meta/WhatsApp, fornecedores de IA e entrega externa de webhooks ainda não validados. Nenhuma mensagem externa foi enviada.
6. Confirmar CI remoto. Inspecionar também os avisos restantes do Advisor: extensão vector no schema public e proteção contra senhas vazadas desabilitada. Funções intencionalmente expostas com validação de sessão/token continuam sinalizadas; `automation_pending_executions` sem policy é deny-by-default, destinada ao backend.

Referências oficiais dos avisos: [SECURITY DEFINER público](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [extensão em public](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public), [proteção de senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

**Conclusão:** isolamento de tabelas e controles SQL testados com sucesso, mas a estrutura multiempresa completa **ainda não está validada em homologação**. PR deve permanecer em revisão, sem merge ou produção.
