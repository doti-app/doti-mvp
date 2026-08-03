# Runbook — piloto e liberação do WhatsApp

Este procedimento cobre a V1 da integração direta com a Meta WhatsApp Cloud
API. A liberação é fechada por padrão: uma agência sem linha em
`meta_whatsapp_rollouts` não consegue configurar a conexão, criar ou disparar
campanhas.

## 1. Preparar a conta Meta

Use um aplicativo Meta e uma WABA de teste ou produção controlada. O número deve
pertencer à WABA, estar apto para envio e ter um template `APPROVED` em `pt_BR`
ou no idioma que será usado pela campanha. O token precisa permitir consultar a
WABA, os números e os templates e enviar mensagens.

Configure os secrets somente nas Edge Functions do Supabase:

- `META_TOKEN_ENCRYPTION_KEY`: 32 bytes aleatórios em Base64;
- `META_TOKEN_ENCRYPTION_KEY_VERSION`: versão inteira da chave, inicialmente `1`;
- `META_WEBHOOK_VERIFY_TOKEN`: segredo aleatório para o desafio inicial;
- `META_APP_SECRET`: App Secret que valida `X-Hub-Signature-256`;
- `META_GRAPH_API_VERSION`: versão da Graph API homologada (opcional).

Publique `meta-integration` com JWT obrigatório e `meta-webhook` com JWT do
gateway desativado. O webhook continua protegido pelo verify token no GET e
pela assinatura HMAC no POST. Cadastre na Meta:

`https://<project-ref>.supabase.co/functions/v1/meta-webhook`

Entre como owner/admin na agência piloto, abra **WhatsApp**, informe WABA ID,
Phone Number ID e o token e use **Validar e conectar**. Confirme que a conta,
o número e somente templates aprovados aparecem. Member e viewer devem enxergar
os dados da própria agência sem botões de configuração ou disparo.

## 2. Autorizar a agência piloto

Escolha uma única agência e números internos que tenham autorizado o teste. Não
grave esses números em tickets, logs ou comandos SQL. Gere SHA-256 localmente,
um E.164 por linha:

```sh
node scripts/hash-whatsapp-allowlist.mjs < numeros-internos-e164.txt
```

O script escreve apenas hashes e não persiste a entrada. No SQL Editor do
Supabase, execute como administrador substituindo somente o UUID e os hashes:

```sql
select public.configure_meta_whatsapp_rollout(
  '<agency-id>'::uuid,
  'pilot',
  true,
  array['<sha256-1>', '<sha256-2>']::text[]
);
```

Não passe números completos para essa função: ela rejeita qualquer item que não
seja um SHA-256 hexadecimal. No estágio `pilot`, o banco bloqueia tanto a criação
quanto o disparo quando houver destinatário fora da allowlist.

Para interromper imediatamente novos disparos, sem apagar histórico:

```sql
select public.configure_meta_whatsapp_rollout(
  '<agency-id>'::uuid, 'disabled', false, array[]::text[]
);
```

Campanhas já iniciadas não possuem pausa/cancelamento na V1; por isso desabilite
antes de iniciar outro teste e acione o suporte operacional se um worker já
estiver em execução.

## 3. Formato do CSV

O arquivo deve ser UTF-8, com cabeçalho, separador vírgula ou ponto e vírgula e
no máximo 100 linhas de destinatários. A tela permite mapear os nomes das colunas,
mas cada destino deve ter:

- uma coluna de telefone;
- uma coluna diferente para cada variável obrigatória do template;
- telefone brasileiro com DDD (a DOTI adiciona o DDI 55) ou internacional em
  E.164, iniciado por `+` ou `00`;
- valores não vazios para todas as variáveis.

Exemplo:

```csv
telefone;nome;codigo
+5511999999999;João & Cia.;A-001
```

Duplicados são ignorados na prévia. Linhas inválidas ou com variável ausente são
rejeitadas e exibidas antes da confirmação. Templates com variáveis exigem CSV;
templates sem variáveis também aceitam um número por linha. Arquivos com mais de
100 contatos válidos devem ser divididos.

## 4. Executar e registrar o piloto

Antes de cadastrar credenciais, valide se as migrações e Edge Functions já
estão publicadas e se as bordas anônimas permanecem protegidas:

```sh
node scripts/check-whatsapp-release-readiness.mjs
```

O comando usa `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`, imprime somente o
nome de cada artefato e o status HTTP e termina com código diferente de zero se
algum item estiver ausente ou exposto. Ele não exige service role, token Meta
ou senha do banco. Todos os oito itens devem aparecer como `PASS`.

Use uma campanha de um destinatário antes da carga. Na prévia, valide posições
das variáveis, acentos, emoji, aspas, ponto e vírgula e quebra de linha. Confirme
o disparo imediato e guarde como evidência apenas: ID interno da campanha,
horários, template/idioma e contadores — nunca token, conteúdo ou número completo.

Valide nesta ordem:

1. a resposta de envio produz `accepted` e um `wamid` na tela de resultados;
2. o webhook avança para `sent`, `delivered` e `read` sem regressão;
3. uma repetição do mesmo webhook não altera contadores;
4. um webhook atrasado fica no histórico sem regredir `read`;
5. assinatura ausente/adulterada retorna `401`;
6. erro temporário agenda até três tentativas; erro permanente não repete;
7. a exportação CSV corresponde ao filtro e aos totais exibidos;
8. owner/admin operam; member/viewer não criam nem disparam;
9. outra agência não consulta conexão, template, campanha, destinatários,
   tentativas, eventos ou rollout do piloto.

Depois execute a campanha de carga com exatamente 100 números internos
autorizados. Compare `total_count` com a soma de pendentes, sucesso e falhas e
registre duração total, taxa de falha e p95 de latência. Não use contatos reais
externos nessa etapa.

## 5. Ler status e monitorar

Na interface:

- **Pendente**: ainda não reivindicado ou aguardando repetição;
- **Aceito**: a Meta aceitou e devolveu `wamid`;
- **Enviado**, **Entregue** e **Lido**: progressão informada por webhook;
- **Falhou**: rejeição permanente ou três tentativas temporárias sem sucesso.

O histórico principal usa `meta_campaigns`, `meta_campaign_recipients`,
`meta_campaign_send_attempts` e `meta_delivery_events`. Logs técnicos ficam em
`private.meta_whatsapp_technical_logs` e contêm apenas operação, resultado,
hash de correlação, latência, código e contadores técnicos. Eles não recebem
telefone, `wamid`, token, variáveis nem conteúdo da mensagem.

Consulte métricas da agência piloto com service role ou no SQL Editor:

```sql
select public.get_meta_whatsapp_operational_metrics(
  '<agency-id>'::uuid,
  now() - interval '24 hours'
);
```

Antes da liberação geral, exija:

- `counterDivergences = 0`;
- campanha curta completa até `read`;
- carga de 100 processada sem duplicidade;
- falhas explicadas e dentro do limite acordado;
- p95 e duração total sem degradação operacional;
- nenhuma ocorrência de telefone completo, token, variável, conteúdo ou WAMID
  nos logs da Edge Function e em `private.meta_whatsapp_technical_logs`;
- verificação responsiva em 360 px, 768 px e desktop e navegação por teclado
  com foco visível, nomes acessíveis e avisos anunciados.

## 6. Trocar token inválido ou expirado

Gere um novo token no mesmo aplicativo/Business Manager, mantendo as permissões
necessárias. Na DOTI, owner/admin usa **Substituir credenciais**, informa a mesma
WABA e Phone Number ID e cola o novo token. A Edge Function valida primeiro,
cifra com AES-GCM e substitui a credencial de forma atômica; o token anterior
nunca volta ao navegador.

Depois:

1. use **Testar conexão**;
2. use **Sincronizar novamente** e confira mudanças nos aprovados;
3. execute uma campanha interna de um destinatário;
4. confirme envio e webhook antes de retomar a carga.

Se a versão de `META_TOKEN_ENCRYPTION_KEY` também mudar, mantenha a chave anterior
até substituir todas as credenciais afetadas. A mensagem “a credencial precisa
ser substituída” indica que a versão armazenada não corresponde à configurada.

## 7. Liberação geral

Após anexar as evidências do piloto e cumprir todos os critérios, altere somente
a agência aprovada:

```sql
select public.configure_meta_whatsapp_rollout(
  '<agency-id>'::uuid, 'general', true, array[]::text[]
);
```

Isso remove a allowlist temporária. Repita agência por agência, monitorando por
24 horas entre ondas. Para bloquear uma agência, volte a `disabled`; não exclua
campanhas, tentativas ou eventos, pois são necessários para auditoria.

## Interfaces de dados da V1

Os nomes funcionais do escopo correspondem às tabelas atuais:

| Interface funcional | Implementação |
| --- | --- |
| `whatsapp_connections` | `meta_connections` + segredo em `private.meta_connection_credentials` |
| `whatsapp_templates` | `meta_templates` |
| `whatsapp_campaigns` | `meta_campaigns` |
| `whatsapp_recipients` | `meta_campaign_recipients` |
| `whatsapp_events` | `meta_delivery_events` |

A V1 mantém uma conexão ativa por agência, um template/idioma por campanha,
envio imediato, limite de 100, sem agendamento, pausa, cancelamento, sequências,
criação/aprovação de templates ou gestão de opt-in dentro da DOTI.
