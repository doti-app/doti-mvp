# Doti — guia da plataforma

Este MVP é uma ferramenta interna para organizar a operação de uma agência de marketing. Ele começa sem clientes, projetos, demandas, tarefas ou resultados fictícios.

Os dados são salvos no `localStorage` do navegador. Isso permite utilizar a plataforma sem servidor, mas significa que os dados pertencem ao navegador e ao perfil em que foram cadastrados.

## Desenvolvimento local

Para modificar e testar a Doti no computador:

1. Instale a versão LTS do Node.js.
2. Dê dois cliques em `iniciar-doti-local.cmd`.
3. Abra `http://localhost:3000` no navegador.
4. Mantenha a janela do servidor aberta enquanto estiver testando.

Depois de alterar e salvar um arquivo, atualize a página com `Ctrl + F5`.
Para encerrar o servidor, pressione `Ctrl + C` na janela aberta.

O arquivo `.env.local` contém as variáveis usadas apenas no computador e não deve ser enviado ao GitHub. O ambiente local pode apontar para o mesmo Supabase da produção; nesse caso, alterações de dados feitas durante os testes também afetam os dados reais.

### Modo local seguro

Com `DOTI_LOCAL_MODE=true` no `.env.local`, o servidor:

- libera a interface sem exigir login;
- salva projetos, clientes, demandas, fluxos e equipe somente no `localStorage`;
- simula convites e alterações de acesso sem enviar e-mails;
- bloqueia as APIs remotas de equipe e convites;
- não envia dados ao Supabase.

Um aviso verde no canto inferior direito confirma que o modo seguro está ativo.

## Estrutura operacional

A plataforma usa quatro níveis:

1. **Projeto:** o trabalho maior contratado por um cliente, como “Campanha de lançamento”.
2. **Entregável:** cada serviço dentro do projeto, como site, vídeo ou identidade visual.
3. **Etapa:** a posição atual do entregável dentro de um fluxo, como Briefing ou Aprovação.
4. **Tarefa:** uma ação específica que precisa ser realizada dentro da etapa atual.

Quando um projeto é criado, cada fluxo selecionado gera um entregável independente. As etapas são copiadas para o entregável naquele momento. Alterações futuras no modelo não modificam trabalhos que já foram iniciados.

## Menu lateral

Com a barra aberta, o botão para minimizar permanece visível no canto superior direito. No modo compacto, a versão branca da marca Doti aparece normalmente; passe o cursor sobre ela para substituí-la temporariamente pelo botão de expandir. Os ícones, contadores e perfil da agência continuam disponíveis. Passe o cursor sobre um ícone para conferir o nome da seção. A preferência fica salva neste navegador.

## 1. Visão geral

A Visão geral não possui números fixos. Todos os valores são calculados com os dados cadastrados:

- **Projetos:** total de projetos cadastrados.
- **Em andamento:** entregáveis ainda não concluídos.
- **Em aprovação:** entregáveis cuja etapa atual envolve aprovação, revisão interna ou apresentação.
- **Concluídos:** entregáveis finalizados.

A seção “O que precisa de atenção” mostra:

- entregáveis com prazo vencido;
- entregáveis em uma etapa de aprovação.

“Projetos recentes” é ordenado pela última atualização do projeto.

### Ações disponíveis

- Criar um projeto.
- Abrir a configuração de fluxos.
- Importar um backup.
- Abrir projetos e entregáveis que precisam de atenção.

## 2. Demandas

Demandas é a área de operação diária.

### Criar um projeto

1. Clique em **Novo projeto**.
2. Informe cliente, nome e prazo.
3. Marque um ou mais fluxos contratados.
4. Clique em **Criar projeto**.

O Doti cria um entregável para cada fluxo selecionado.

O **Prazo do projeto** é aplicado automaticamente à última etapa de cada entregável criado. Por exemplo:

- Site institucional: a data entra em **Concluído**.
- Produção de vídeo: a data entra em **Entrega final**.
- Design para redes: a data entra em **Entrega final**.
- Identidade visual: a data entra em **Entrega final**.

Se o prazo do projeto for alterado posteriormente, o Doti atualiza essas datas finais enquanto elas ainda estiverem sincronizadas com o prazo anterior. Uma data final alterada manualmente no cronograma é considerada personalizada e não será sobrescrita.

### Quadro

O quadro distribui os entregáveis em quatro situações:

- Planejamento;
- Em produção;
- Em aprovação;
- Concluído.

A posição é calculada pela etapa atual. Não é um status fictício ou preenchido separadamente.

### Operar um entregável

Clique em um cartão para:

- consultar todas as etapas;
- ver o grupo responsável atual;
- adicionar tarefas à etapa;
- marcar e reabrir tarefas;
- excluir tarefas;
- escrever observações;
- concluir a etapa;
- editar nome e prazo do entregável;
- excluir o entregável.

Se existirem tarefas pendentes, a etapa não poderá avançar. Na última etapa, o botão muda para **Concluir entregável**.

### Projetos

A visualização **Projetos** agrupa todos os entregáveis por cliente e projeto.

Ao abrir um projeto é possível:

- editar cliente, nome e prazo;
- abrir qualquer entregável;
- excluir o projeto com todos os seus entregáveis.

### Datas opcionais por etapa

Cada etapa de um entregável pode ter um prazo próprio. Essa data é opcional e pertence somente àquela demanda.

Para definir um prazo:

1. Abra o entregável no quadro.
2. Localize **Cronograma das etapas**.
3. Escolha uma data ao lado da etapa desejada, como Copywriting ou Design UI.

Você pode preencher todas as etapas, somente os marcos mais importantes ou nenhuma delas. Para remover um prazo, basta limpar o campo de data.

O Doti utiliza essas datas para:

- mostrar o prazo da etapa atual no cartão;
- destacar o próximo marco com data;
- ordenar automaticamente as demandas da data mais próxima para a mais distante;
- identificar etapas atrasadas na Visão geral;
- diferenciar um atraso de etapa do prazo geral do projeto.

### Ordenação automática por prazo

Os cartões de cada coluna do quadro são reorganizados automaticamente sempre que:

- um projeto é criado;
- uma data de etapa é definida, alterada ou removida;
- uma etapa é concluída;
- o prazo geral do projeto é alterado.

A prioridade da ordenação é:

1. prazo da etapa atual;
2. próximo marco futuro que tenha data;
3. prazo geral do projeto;
4. itens sem data, que ficam no final.

Assim, se dois entregáveis de Design estiverem em Briefing, o Briefing com a data mais próxima aparecerá primeiro.

Concluir uma etapa não apaga sua data, preservando o histórico do planejamento. As datas do fluxo continuam independentes: alterar o prazo de Copywriting em um entregável não afeta outros projetos.

Exclusões importantes exigem confirmação.

### Calendário de entregas finais

A visualização **Calendário** mostra exclusivamente o prazo final de cada projeto. As datas intermediárias de Briefing, Copywriting, Design ou outras etapas não aparecem aqui, evitando misturar o cronograma operacional com a data prometida ao cliente.

O calendário oferece:

- navegação para o mês anterior ou seguinte;
- botão **Hoje** para retornar ao mês atual;
- destaque do dia atual;
- quantidade de tarefas finais em cada dia;
- seleção de um dia para consultar as descrições abaixo do calendário;
- detalhes de cliente, projeto, quantidade de entregáveis e situação;
- identificação visual de projetos em andamento, atrasados e concluídos;
- abertura do projeto ao clicar em uma entrega;
- funcionamento conjunto com busca, grupo e situação.

Projetos atrasados aparecem em vermelho, concluídos em verde e projetos em andamento em azul.

### Busca e filtros

A busca encontra conteúdo por:

- nome do projeto;
- cliente;
- nome do entregável.

O filtro de situação pode mostrar apenas planejamento, produção, aprovação ou concluídos.

O filtro **Todos os grupos** mostra somente os entregáveis que estão atualmente sob responsabilidade do grupo selecionado. Por exemplo, ao selecionar **Copywriting**, o quadro exibe as demandas cuja etapa atual pertence ao grupo Copywriting.

Esse filtro considera a etapa atual, não todas as etapas futuras do entregável. Quando a demanda avança para outro grupo, ela deixa automaticamente a visualização do grupo anterior e passa a aparecer para o novo responsável.

## 3. Fluxos

Fluxos são modelos reutilizáveis. A plataforma inclui configurações iniciais para Site, Vídeo, Design e Branding. Eles são configurações operacionais, não demandas ou dados simulados.

### Criar um fluxo

1. Clique em **Novo fluxo**.
2. Informe nome, categoria e descrição.
3. Na seção **Etapas do fluxo**, escreva o nome de cada etapa.
4. Escolha o grupo responsável no seletor ao lado.
5. Use **Adicionar etapa** para criar novas linhas.
6. Clique e segure em qualquer área livre do card da etapa para arrastá-lo, como em um quadro do Trello. As outras etapas deslizam e abrem espaço durante o movimento, enquanto uma linha amarela indica a posição de destino. Os campos, seletores e botões continuam clicáveis normalmente, e as setas permanecem disponíveis como alternativa.
7. Use o botão com ícone de olho, ao lado da quantidade de etapas, para abrir uma prévia visual do fluxo. A prévia mostra a sequência em cartões conectados, com o nome e o grupo responsável de cada etapa, e acompanha as alterações em tempo real sem salvar ou modificar o fluxo.
7. Use o botão “×” para remover uma etapa.

Os seletores exibem somente os grupos já cadastrados na aba **Grupos**, evitando erros de digitação. Um fluxo precisa ter pelo menos duas etapas.

### Ativar e desativar fluxos

O indicador no topo de cada card também funciona como controle de disponibilidade:

- **Ativo**: o fluxo pode ser aberto, editado e selecionado na criação de novos projetos;
- **Desativado**: o card permanece visível para administração, mas não pode ser aberto nem escolhido em novos projetos;
- passe o cursor sobre o indicador para ver a ação disponível e clique nele para alternar o status.

Desativar um fluxo não altera entregáveis já criados. Eles continuam seguindo normalmente a cópia das etapas que já possuem.

### Atualização de projetos ao editar um fluxo

Quando um modelo de fluxo é editado, os entregáveis ativos que utilizam esse modelo são atualizados automaticamente:

- alterar o nome de uma etapa atualiza seu nome nos projetos;
- trocar o grupo responsável atualiza a responsabilidade das tarefas daquela etapa;
- reordenar etapas reorganiza o fluxo sem perder o ponto atual;
- adicionar uma etapa insere a nova etapa nos entregáveis;
- remover uma etapa migra tarefas, observações e prazo para a etapa mais próxima.

Tarefas, datas e observações das etapas mantidas são preservadas. Entregáveis já concluídos não são alterados, pois representam o histórico do trabalho entregue.

### Editar ou excluir

Clique em um cartão de fluxo para editar qualquer informação.

Um fluxo não pode ser excluído enquanto estiver associado a um entregável ativo. Entregáveis concluídos preservam sua própria cópia das etapas.

### Grupos

A aba **Grupos** lista os responsáveis que podem ser associados às etapas.

É possível:

- criar um grupo;
- visualizar quantas etapas usam o grupo;
- excluir grupos sem vínculos;
- excluir grupos em uso transferindo antes suas etapas para outro grupo.

Ao excluir um grupo em uso, o Doti mostra quantas etapas de modelos e de demandas dependem dele. Escolha um grupo substituto e confirme em **Reatribuir e excluir**. A troca é aplicada tanto aos fluxos quanto aos entregáveis já criados. A plataforma exige que pelo menos um grupo permaneça cadastrado.

## Backup e restauração

O botão **Exportar backup** gera um arquivo JSON contendo:

- projetos;
- entregáveis;
- etapas;
- tarefas;
- fluxos;
- grupos;
- histórico de atividade.

Para restaurar, use **Importar backup** na Visão geral e selecione um arquivo gerado por esta mesma versão.

Recomenda-se exportar um backup regularmente, especialmente antes de limpar dados do navegador ou mudar de computador.

## Autenticação e operação compartilhada

A identificação de usuários utiliza Supabase Auth:

- login com e-mail e senha;
- criação de conta e agência;
- confirmação do endereço de e-mail;
- recuperação e redefinição de senha;
- sessão segura com renovação automática;
- perfil vinculado à agência e papel de proprietário, administrador ou membro;
- proteção do painel para visitantes sem sessão.

O frontend precisa apenas das variáveis públicas `SUPABASE_URL` e
`SUPABASE_PUBLISHABLE_KEY`. As migrations versionadas em `supabase/migrations`
configuram autenticação, operação, integração Meta, RLS, Storage e Realtime.
As funções `team-admin` e `meta-integration` mantêm as operações privilegiadas
dentro do Supabase, sem chave administrativa ou token da Meta no Vercel.

Os dados operacionais usam tabelas multiagência no Supabase:

- cada registro é isolado pelo `agency_id` e por políticas RLS;
- alterações são sincronizadas entre dispositivos e integrantes;
- logos, imagens, PDFs, vídeos e anexos ficam em um bucket privado;
- conflitos simultâneos são detectados pela revisão da operação;
- o armazenamento do navegador fica restrito à sessão, preferências visuais e
  à cópia legada preservada durante a migração.

No primeiro acesso após a atualização, o proprietário verá um resumo dos dados
locais. Ao confirmar, aquele navegador será tratado como a cópia oficial. Os
arquivos presentes serão enviados ao Storage e arquivos locais ausentes serão
relatados sem gerar referências quebradas.

## Arquivos do projeto

- `index.html`: estrutura das três telas.
- `styles.css`: identidade visual principal.
- `styles-extra.css`: complementos visuais herdados do protótipo.
- `functional.css`: componentes funcionais, formulários, estados vazios e responsividade.
- `app.js`: regras, persistência, criação, edição, filtros, tarefas, fluxos e backups.
- `dot-admin/index.html`: página independente de acesso à Doti.
- `dot-admin/login.css`: identidade visual e responsividade da área de login.
- `dot-admin/login.js`: login, cadastro, confirmação e recuperação de senha.
- `dot-admin/auth-guard.js`: proteção do painel, identificação do perfil e logout.
- `dot-admin/supabase-client.js`: cliente compartilhado de autenticação.
- `dot-admin/operation-store.js`: carregamento, gravação, Realtime, Storage e migração assistida.
- `dot-admin/whatsapp-admin.js`: configuração da conta, campanhas e consulta dos templates aprovados.
- `dot-admin/whatsapp-campaign-utils.mjs`: leitura de CSV, normalização, deduplicação e prévia das campanhas.
- `api/auth-config.js`: entrega segura da configuração pública no ambiente Vercel.
- `supabase/migrations/`: autenticação, tabelas operacionais, RLS, RPCs, Storage e Realtime.
- `supabase/functions/team-admin/`: convites e administração privilegiada da equipe.
- `supabase/functions/meta-integration/`: criptografia de credenciais e ações administrativas da integração Meta.
- `supabase/functions/meta-webhook/`: verificação pública e recebimento assinado dos eventos de entrega da Meta.
- `.env.example`: nomes das variáveis exigidas no deploy.

## Segurança da integração Meta

A credencial da Meta é enviada diretamente para a Edge Function autenticada,
cifrada com AES-GCM e gravada no schema privado. A resposta retorna somente
metadados da conexão. O token não deve ser salvo em `localStorage`,
`sessionStorage`, logs, tabelas públicas ou variáveis do frontend.

Antes de publicar `meta-integration`, configure nos secrets das Edge Functions:

- `META_TOKEN_ENCRYPTION_KEY`: chave aleatória de 32 bytes codificada em Base64;
- `META_TOKEN_ENCRYPTION_KEY_VERSION`: versão numérica da chave, iniciando em `1`.
- `META_WEBHOOK_VERIFY_TOKEN`: valor aleatório usado somente na verificação inicial do webhook;
- `META_APP_SECRET`: App Secret do aplicativo Meta, usado para validar `X-Hub-Signature-256`.

Opcionalmente, `META_GRAPH_API_VERSION` pode fixar a versão da Graph API. Sem
esse secret, a função usa `v24.0`.

Na aba **WhatsApp**, owner e admin informam WABA ID, Phone Number ID e token
permanente. Antes de persistir, a função confirma na Meta que o número pertence
ao WABA e consulta somente templates `APPROVED`. Modelos que deixam de aparecer
como aprovados são mantidos para histórico, mas recebem status `disabled` e não
ficam disponíveis para novas campanhas.

As chaves padrão do Supabase são fornecidas automaticamente às Edge Functions.
Não copie `SUPABASE_SECRET_KEYS`, `SUPABASE_SERVICE_ROLE_KEY` ou a chave de
criptografia para o navegador, Vercel, repositório ou arquivos públicos.

Publique também `meta-webhook` e cadastre na Meta a URL
`https://<project-ref>.supabase.co/functions/v1/meta-webhook`. A função é
pública apenas no gateway (`verify_jwt = false`): verificações exigem o token
configurado e notificações POST sem assinatura HMAC válida são rejeitadas.

Owner e admin podem configurar conexões e colocar campanhas na fila. Member e
viewer têm leitura limitada à própria agência e não podem configurar nem
disparar campanhas. Todas as mudanças administrativas registram autor e data.

## Campanhas de WhatsApp

Em **WhatsApp**, owner e admin podem abrir **Nova campanha** e seguir cinco
etapas: nome, template/idioma, destinatários, variáveis e revisão. Cada campanha
usa um único template aprovado e só entra na fila após a confirmação explícita
na última etapa.

Para templates sem variáveis, os contatos podem vir de um CSV ou de uma colagem
com um número por linha. Templates com variáveis exigem CSV com cabeçalho e uma
coluna diferente para o telefone e para cada parâmetro obrigatório. Números
brasileiros recebem o DDI 55; números internacionais devem estar completos e
começar com `+` ou `00`.

Antes da revisão, duplicados são removidos e linhas inválidas ou incompletas são
separadas. A tela mostra os totais enviados, ignorados e rejeitados e permite
alternar a prévia entre destinatários de exemplo. Mais de 100 contatos válidos
bloqueiam a confirmação; divida o arquivo em campanhas menores.

Depois da confirmação, a Edge Function continua o processamento em segundo
plano, em lotes de 10. Cada destinatário é reivindicado atomicamente e cada
tentativa registra horário, resultado e código de erro. Falhas de rede, limite
ou servidor recebem até três tentativas, com espera progressiva; números ou
templates rejeitados de forma permanente não são repetidos.

Use **Ver resultados** na lista de campanhas para consultar pendentes, aceitos,
enviados, entregues, lidos e falhos. A tabela mostra o `wamid`, o número de
tentativas e o motivo da falha, permite filtrar por status e exportar o recorte
visível em CSV. Atualizações repetidas ou atrasadas da Meta ficam no histórico
sem duplicar contadores nem regredir o status atual.

A funcionalidade permanece bloqueada por padrão e é liberada por agência. O
piloto aceita somente hashes de números internos autorizados; a liberação geral
remove essa allowlist apenas depois da validação operacional. O procedimento de
conexão, CSV, testes, monitoramento, substituição de token e rollout está em
[`docs/whatsapp-rollout-runbook.md`](docs/whatsapp-rollout-runbook.md).

## Primeiro uso recomendado

1. Revise os modelos na página Fluxos.
2. Ajuste ou crie os grupos da agência.
3. Edite os fluxos para refletir o processo real.
4. Crie o primeiro projeto em Demandas.
5. Adicione tarefas à etapa atual de cada entregável.
6. Avance as etapas conforme o trabalho for concluído.
7. Exporte um backup ao final da configuração.
# Administração da equipe

O primeiro cadastro da agência recebe o nível **Proprietário**. Para liberar
acessos individuais, aplique as migrations, publique a função `team-admin` e
configure no Vercel:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

A chave administrativa é fornecida automaticamente pelo ambiente seguro das
Edge Functions. Nunca adicione essa chave ao navegador, ao Vercel, ao GitHub ou
ao arquivo `api/auth-config.js`.

Depois, entre como proprietário e abra **Equipe**:

- Proprietário: controle total e administração de todos os níveis.
- Administrador: gerencia operação, membros e visualizadores.
- Membro: cria e atualiza o trabalho.
- Visualizador: acompanha sem alterar.

Ao convidar, o Supabase envia um e-mail. A pessoa abre o link, cria a própria
senha e passa a acessar a mesma agência.
