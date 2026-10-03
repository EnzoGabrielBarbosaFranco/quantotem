# Bibliotecas de geração de PDF

Esta pasta acompanha o aplicativo para que a exportação funcione também quando a raiz do projeto é servida por um servidor estático, sem redirecionamentos para `node_modules`.

- jsPDF 4.2.1: `jspdf.umd.min.js`, sob licença MIT em `jspdf-LICENSE.txt`.
- jsPDF-AutoTable 5.0.8: `jspdf.plugin.autotable.min.js`, sob licença MIT em `jspdf-autotable-LICENSE.txt`.

`npm run prepare:assets` atualiza esses arquivos a partir das dependências fixadas em `package-lock.json` e copia a mesma pasta para `.dist`. Não é necessário carregar bibliotecas de um CDN para exportar relatórios.
