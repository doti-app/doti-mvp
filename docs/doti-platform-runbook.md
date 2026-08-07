# Runbook — portal interno DOT

O portal interno fica em `/doti/` e usa a mesma autenticação do painel das
agências. Uma conta pode ter, ao mesmo tempo, um perfil DOT e um perfil de
cliente. Nesse caso, o login abre o portal DOT e o botão **Ir para minha
agência** faz a troca explícita de contexto.

## 1. Publicar banco e funções

Aplique primeiro as migrações e depois publique as funções alteradas:

```sh
supabase db push
supabase functions deploy platform-admin
supabase functions deploy team-admin
supabase functions deploy meta-integration
```

`platform-admin` usa `verify_jwt = false` no gateway porque precisa permitir a
criação única do primeiro administrador. A própria função valida o JWT de todas
as outras ações. O bootstrap exige um secret dedicado e deixa de funcionar
assim que existe um administrador DOT ativo.

Configure um valor aleatório longo, diferente de qualquer senha ou chave do
Supabase:

```sh
supabase secrets set DOTI_PLATFORM_BOOTSTRAP_TOKEN='<valor-aleatorio-longo>'
```

## 2. Criar o primeiro administrador

Faça uma única chamada server-side para `platform-admin`. Não salve a senha ou
o token em arquivos versionados, tickets ou histórico compartilhado.

```sh
curl -X POST '<SUPABASE_URL>/functions/v1/platform-admin' \
  -H 'Content-Type: application/json' \
  -H 'apikey: <SUPABASE_PUBLISHABLE_KEY>' \
  -H 'x-doti-bootstrap-token: <DOTI_PLATFORM_BOOTSTRAP_TOKEN>' \
  --data '{"action":"bootstrap","email":"admin@dotgroup.com.br","fullName":"Administrador DOT","password":"<senha-inicial-com-12-ou-mais-caracteres>"}'
```

Se o e-mail já possuir conta de cliente, o perfil DOT é adicionado à mesma
identidade. Caso contrário, uma identidade exclusiva da equipe DOT é criada.
Depois do primeiro acesso, troque a senha inicial e remova ou rotacione o secret
de bootstrap.

Os próximos acessos internos são convidados em **Equipe DOT** pelo próprio
portal, sem repetir o bootstrap.

## 3. Matriz de acesso

| Perfil DOT | Portal macro | Entrar em agência | Operação diária | Configurações, equipe e WhatsApp | Equipe DOT e ciclo de vida |
| --- | --- | --- | --- | --- | --- |
| Administrador | leitura | sim | escrita | sim | sim |
| Membro | leitura | sim | escrita operacional | não | não |
| Visualizador | leitura | sim | somente leitura | não | não |

O contexto de suporte é enviado no cabeçalho `X-Doti-Agency-Id` e só é aceito
para uma pessoa ativa da equipe DOT e uma agência ativa. Um usuário de cliente
não consegue usar esse cabeçalho para sair da própria agência.

## 4. Suporte, auditoria e arquivamento

- Toda entrada em uma agência exibe um banner persistente de **Modo de suporte
  DOT** e cria um evento de auditoria.
- Alterações operacionais feitas em suporte registram ator, agência, tabela,
  operação e horário; conteúdo de registros e credenciais não é copiado para o
  log interno.
- Arquivar uma agência bloqueia novos acessos de cliente e suporte e desabilita
  o rollout de envio do WhatsApp. Os dados permanecem disponíveis para
  restauração administrativa.
- Tokens da Meta continuam cifrados no schema privado. Somente a Edge Function
  pode ler ou gravar a credencial, após validar que o ator é owner/admin da
  agência ou administrador DOT em suporte.

## 5. Verificação antes de liberar

Em ambiente local, aplique uma base limpa e execute as suítes:

```sh
supabase db reset --local --no-seed
supabase test db supabase/tests --local
npm run check:types
npm run check:architecture
npm run test:unit
npm run test:smoke
```

Não faça o bootstrap na produção antes de a migração e `platform-admin` estarem
publicados na mesma versão.
