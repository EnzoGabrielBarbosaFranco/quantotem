# Quanto Tem

Controle financeiro pessoal local-first: funciona no navegador e, quando publicado com o Worker incluído, pode sincronizar vários dispositivos por meio de um cofre criptografado.

## O que o app oferece

- lançamentos, filtros, gráficos e exportação em PDF e CSV;
- gastos fixos com situação de pagamento;
- metas com acompanhamento de aportes;
- orçamentos mensais por categoria;
- backup e restauração em JSON;
- tema claro/escuro e instalação como PWA;
- sincronização opcional entre navegadores.

## Painel e planejamento

### Meu perfil

Clique no cartão **Seu perfil**, na barra lateral (também acessível pelo menu no celular), para informar ou editar seu nome. O painel passa a exibir uma saudação e um avatar com suas iniciais. O nome é opcional; salvar o campo vazio remove a identificação. Não é necessário criar login.

O PDF inclui o titular na primeira página, nos cabeçalhos das páginas seguintes e nos metadados de autor. O CSV acrescenta uma coluna **Titular** em cada lançamento quando há nome cadastrado, mantendo as demais colunas e o formato UTF-8. Sem nome, os arquivos continuam sendo gerados normalmente.

O perfil acompanha os backups e a sincronização criptografada do cofre. Dispositivos ligados ao mesmo cofre compartilham o mesmo perfil. Restaurar um backup antigo sem perfil mantém o nome atual do navegador.

### Configurações

O item **Configurações**, no menu lateral (ou no menu do celular), reúne todas as opções do cofre e dos backups. Nessa tela é possível criar ou conectar um cofre, acompanhar o estado da sincronização, copiar o código, baixar a recuperação, sincronizar manualmente e desconectar o navegador. As ações de baixar e restaurar backup ficam em um cartão separado. A tela selecionada é mantida ao recarregar o aplicativo.

### Visão geral

A tela inicial prioriza as contas do mês e os lançamentos recentes. O cartão **Depois dos compromissos** desconta as contas ainda pendentes do resultado registrado no mês indicado; não estima receitas ou gastos que você não cadastrou. Ele acompanha o mês do cabeçalho, mesmo quando o histórico está filtrado por dia, semana ou intervalo.

O gráfico dos últimos seis meses mostra entradas, despesas e saldo ao passar o mouse ou tocar em um mês. Com teclado, use Tab para chegar ao gráfico, as setas para mudar de mês, Home/End para ir às extremidades e Escape para fechar os valores. As linhas também se diferenciam pelo traçado. Fontes e bibliotecas são locais e o app pode continuar funcionando offline.

Ao informar um prazo em uma meta, o app calcula o aporte mensal necessário, incluindo o mês atual e arredondando para cima em centavos. Os aportes representam o acompanhamento do objetivo e não criam movimentações na conta.

### Gastos fixos por mês

Cada gasto fixo representa uma série mensal a partir da data do cadastro. Os registros existentes são preservados e passam a servir de origem para suas próximas parcelas. Séries distintas não são unificadas automaticamente, mesmo que tenham a mesma descrição.

Cada mês possui sua própria situação de pagamento. Uma conta paga em janeiro reaparece pendente em fevereiro; vencimentos nos dias 29, 30 e 31 se ajustam ao último dia dos meses mais curtos. Navegar pelos meses não grava lançamentos: uma parcela só é salva quando editada ou paga. IDs determinísticos evitam duplicar uma parcela gerada por dois dispositivos.

Editar uma parcela gerada altera apenas aquele mês. Editar o registro de origem altera a base das próximas parcelas ainda não salvas. Excluir uma parcela gerada remove somente aquele mês; excluir a origem remove essa conta e suas projeções futuras, preservando outras parcelas já salvas. **Encerrar após este mês** interrompe novas parcelas e mantém o histórico. O pagamento entra no fluxo de caixa na data da confirmação, mesmo se a conta vencer em outro mês.

Os relatórios com **Incluir gastos fixos pendentes** também incluem as parcelas projetadas no intervalo escolhido. Em todo o histórico, são consideradas as recorrências até o mês atual. O limite para projetar pendências em uma única exportação é de 100 anos.

Sem um servidor publicado, todo o app continua funcionando normalmente com `localStorage`. A sincronização é a única funcionalidade que depende da função serverless.

Gastos fixos pendentes ficam fora das despesas e do saldo. Ao marcar um gasto como pago na área de gastos fixos, ele entra no histórico, nos gráficos e no orçamento na data da confirmação, mantendo a data original do cadastro. Desmarcar o pagamento retira a despesa desses totais. Pagamentos antigos continuam usando a data que já estava registrada.

A Visão geral calcula entradas, despesas, saldo e gráficos com todos os lançamentos pagos do período selecionado. Os filtros de tipo e categoria da tela Lançamentos afetam apenas essa tela. A busca na Visão geral filtra a lista de lançamentos recentes, mantendo os totais do período.

Na tela Lançamentos, **Exportar PDF** abre a seleção de dia, semana (segunda a domingo), mês, ano, intervalo de datas ou todo o histórico. É possível escolher várias categorias, o tipo de lançamento e a inclusão de gastos fixos pendentes. A prévia mostra os totais antes do download. O PDF tem resumo por categoria, descrição, observações, conta, situação do pagamento e páginas numeradas. Os arquivos são gerados no próprio navegador, com bibliotecas e fontes locais.

**Exportar CSV** segue o período, a busca e os filtros ativos na tela Lançamentos. O botão **Baixar CSV** da janela de exportação usa a seleção do relatório. Os arquivos preservam acentos em UTF-8 com BOM, separam as colunas por ponto e vírgula e usam vírgula decimal para valores em reais.

As bibliotecas de PDF ficam em `vendor/` e as fontes em `assets/fonts/`. Essas pastas acompanham os arquivos do aplicativo e também são copiadas para `.dist` pela preparação dos assets. Isso permite exportar tanto pelo servidor de desenvolvimento quanto por um servidor estático da raiz do projeto.

## Rodar e testar

Requer Node.js 22.13 ou mais recente.

```bash
npm install
npm run dev
```

Os testes de interface usam Chrome e Edge instalados no Windows:

```bash
npm test
```

O teste completo de sincronização inicia um Worker local e abre dois perfis isolados do Chrome:

```bash
npm run test:sync:browser
```

## Publicar com sincronização

O projeto já contém um Cloudflare Worker, assets estáticos e um Durable Object SQLite configurados em `wrangler.jsonc`. Os comandos de desenvolvimento e deploy preparam automaticamente a pasta temporária `.dist` somente com os arquivos públicos.

```bash
npm install
npx wrangler login
npm run deploy
```

O endereço criado pelo deploy serve o site e a API `/api/sync` no mesmo domínio. Isso evita manter API, banco e autenticação tradicionais. Para permitir que outro domínio já existente consuma essa API, configure `ALLOWED_ORIGINS` no Worker como uma lista separada por vírgulas e adicione no HTML desse site:

```html
<meta name="quanto-tem-sync-url" content="https://seu-worker.workers.dev/api/sync">
```

## Como o cofre protege os dados

O navegador gera um código aleatório de 128 bits. Chaves separadas de identificação, gravação e criptografia são derivadas localmente desse código. Lançamentos, metas, categorias e orçamentos são criptografados com AES-GCM antes do envio; o servidor armazena apenas o pacote cifrado.

O código não é enviado nem pode ser recuperado. Quem tiver o código consegue abrir o cofre, portanto ele deve ser guardado como uma senha. O backup JSON continua recomendado para recuperação independente.

Ao sincronizar, o app mescla cada registro pela data da última alteração e também replica exclusões. O Durable Object serializa atualizações concorrentes e devolve conflito de revisão para o navegador refazer a mesclagem sem perder alterações.
