# Controle e curadoria de bots no Doti

## Arquitetura

O fluxo atual do n8n pode continuar gravando no Google Sheets. Depois do nó `Merge`, crie uma segunda saída para um nó **HTTP Request** que envie a mesma interação à Edge Function `chatbot-ingest`.

```text
AI Agent → Respond to Webhook
        └→ Merge → Google Sheets
                 └→ HTTP Request → Supabase Edge Function → Doti / Curadoria
```

A função valida as credenciais da integração, identifica automaticamente o bot conectado, normaliza os campos e grava cada evento uma única vez. A chave `event_id` evita duplicações caso o n8n repita uma execução.

O cadastro é separado em três níveis:

- `chatbots`: identidade do Virgulinha, Camilinha e dos próximos bots, com vínculo opcional a um cliente;
- `chatbot_integrations`: uma ou mais conexões de cada bot com n8n, site, WhatsApp ou outros canais;
- `chatbot_interactions`: perguntas e respostas recebidas por cada conexão.

Essa separação permite adicionar bots e canais sem criar novas páginas ou duplicar a lógica de curadoria.

## Configuração no Doti

1. Entre como proprietário ou administrador.
2. Abra **Bots**.
3. Para um bot novo, clique em **Novo bot**, informe o nome e selecione o cliente, quando aplicável.
4. Abra o bot escolhido e clique em **Conectar n8n**.
5. Clique em **Criar conexão**.
6. Copie a URL, o `x-doti-source-key` e o `x-doti-webhook-secret`. O segredo só é mostrado naquele momento.
7. No n8n, guarde o segredo como credencial/variável; não o escreva em um nó público nem em logs.

## Nó HTTP Request no n8n

- Method: `POST`
- URL: a URL exibida pelo Doti
- Send Headers: ligado
- `Content-Type`: `application/json`
- `x-doti-source-key`: valor exibido pelo Doti
- `x-doti-webhook-secret`: segredo exibido pelo Doti
- Body Content Type: JSON

Body sugerido:

```json
{
  "event_id": "={{ $json.event_id || $execution.id + '-' + $itemIndex }}",
  "occurred_at": "={{ $json.data_hora || $now }}",
  "question": "={{ $json.pergunta }}",
  "answer": "={{ $json.resposta }}",
  "channel": "={{ $json.canal || 'web' }}",
  "user_id": "={{ $json.id_usuario }}",
  "url": "={{ $json.url }}",
  "response_time_ms": "={{ $json.tempo_resposta_ms || Math.round(Number(String($json.tempo_resposta || 0).replace(',', '.')) * 1000) }}"
}
```

Se os nomes de saída do AI Agent forem diferentes, ajuste somente as expressões à direita. `event_id`, `question` e `answer` são obrigatórios.

## Desenvolvimento local

Com `DOTI_LOCAL_MODE=true`, a página mostra Virgulinha e Camilinha com conversas de demonstração e salva cadastros, conexões e revisões no `localStorage`. Assim a interface pode ser validada sem escrever no banco remoto.

```powershell
npm test
npm run dev
```

Abra `http://localhost:3000/#curadoria-chatbot`.

Para testar a ingestão completa com o Supabase local, inicie a stack, aplique as migrações e sirva a função conforme os comandos mostrados por `supabase --help` e `supabase functions --help`. O endpoint local esperado é `http://127.0.0.1:54321/functions/v1/chatbot-ingest`.

## Publicação

Ordem segura de release:

1. Rodar testes e revisão de segurança na branch `curadoria-chatbot`.
2. Aplicar a migração no projeto Supabase.
3. Publicar a Edge Function com verificação JWT desabilitada, pois ela usa autenticação própria por segredo.
4. Publicar o front-end da branch e fazer um teste real do n8n.
5. Promover a branch para `main` somente após validar ingestão, idempotência, RLS e curadoria.

O `SUPABASE_SERVICE_ROLE_KEY` fica apenas no ambiente da Edge Function. O navegador recebe somente a chave publicável e nunca acessa o hash do segredo.
