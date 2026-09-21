# Quanto Tem

Controle financeiro pessoal local-first: funciona no navegador e, quando publicado com o Worker incluído, pode sincronizar vários dispositivos por meio de um cofre criptografado.

## O que o app oferece

- lançamentos, filtros, gráficos e exportação CSV;
- gastos fixos com situação de pagamento;
- metas com acompanhamento de aportes;
- orçamentos mensais por categoria;
- backup e restauração em JSON;
- tema claro/escuro e instalação como PWA;
- sincronização opcional entre navegadores.

Sem um servidor publicado, todo o app continua funcionando normalmente com `localStorage`. A sincronização é a única funcionalidade que depende da função serverless.

## Rodar e testar

Requer Node.js 22 ou mais recente.

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
