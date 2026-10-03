import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { reportBounds, selectReportTransactions, reportTotals, csvBytes, buildReportPDF } from "../reports.js";

assert.deepEqual(reportBounds({ period: "week", date: "2026-10-04" }), { start: "2026-09-28", end: "2026-10-04", label: "Semana de 28/09/2026 a 04/10/2026" });
assert.equal(reportBounds({ period: "month", month: "2028-02" }).end, "2028-02-29");
assert.equal(reportBounds({ period: "year", year: "2026" }).end, "2026-12-31");
assert.equal(reportBounds({ period: "day", date: "2026-10-03" }).start, "2026-10-03");
assert.equal(reportBounds({ period: "all" }).start, null);
assert.throws(() => reportBounds({ period: "range", start: "2026-10-05", end: "2026-10-03" }));
assert.throws(() => reportBounds({ period: "day", date: "2026-02-31" }));
assert.throws(() => reportBounds({ period: "month", month: "2026-13" }));

const records = [
  { id: "income", title: "Salário de João", category: "Salário", type: "income", amount: 2545, date: "2026-10-03", account: "Conta corrente", paid: true },
  { id: "phone", title: 'Telefone; plano "Família"', category: "Assinaturas", type: "expense", amount: 65, date: "2026-09-01", paidDate: "2026-10-03", account: "Cartão principal", recurring: true, paid: true, note: "Observação com ação e ç\nSegunda linha" },
  { id: "singing", title: "Aula de música e canto", category: "Educação", type: "expense", amount: 300, date: "2026-10-04", account: "Débito", recurring: true, paid: true },
  { id: "pending", title: "Consulta médica", category: "Saúde", type: "expense", amount: 80, date: "2026-10-03", account: "Conta corrente", recurring: true, paid: false },
  { id: "old", title: "Compra anterior", category: "Compras", type: "expense", amount: 100, date: "2026-09-10", account: "Cartão", paid: true },
  { id: "future", title: "Compra futura", category: "Compras", type: "expense", amount: 150, date: "2027-01-01", account: "Cartão", paid: true }
];
const month = reportBounds({ period: "month", month: "2026-10" });
const selected = selectReportTransactions(records, month);
assert.deepEqual(selected.map(item => item.id).sort(), ["income", "phone", "singing"]);
assert.deepEqual(reportTotals(selected), { income: 2545, expenses: 365, balance: 2180, pending: 0 });
assert.equal(selectReportTransactions(records, { ...month, categories: ["Educação", "Assinaturas"] }).length, 2);
assert.equal(selectReportTransactions(records, { ...month, categories: [] }).length, 0);
assert.equal(selectReportTransactions(records, { ...month, type: "income" }).length, 1);
assert.equal(selectReportTransactions(records, { ...reportBounds({ period: "day", date: "2026-10-03" }) }).length, 2);
assert.equal(selectReportTransactions(records, { ...reportBounds({ period: "week", date: "2026-10-04" }) }).length, 3);
assert.equal(selectReportTransactions(records, { ...reportBounds({ period: "year", year: "2026" }) }).length, 4);
assert.equal(selectReportTransactions(records).length, 5);
const withPending = selectReportTransactions(records, { ...month, includePending: true });
assert.deepEqual(reportTotals(withPending), { income: 2545, expenses: 365, balance: 2180, pending: 80 });
const bytes = csvBytes(withPending);
assert.deepEqual([...bytes.slice(0, 3)], [239, 187, 191]);
const csv = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
assert(csv.includes('"Descrição";"Categoria";"Conta";"Valor (R$)";"Situação";"Observação"'));
assert(csv.includes('"Telefone; plano ""Família"""') && csv.includes("Cartão principal") && csv.includes("Observação com ação e ç\nSegunda linha"));
assert(csv.includes('"03/10/2026";"Despesa"') && csv.includes('"65,00";"Pago"'));
assert(csv.includes("\r\n") && !csv.includes("Ã§"));
assert(new TextDecoder().decode(csvBytes([{ ...records[0], title: "=HYPERLINK(1)" }])).includes('"\'=HYPERLINK(1)"'));

const [normal, bold] = await Promise.all(["NotoSans-Regular.ttf", "NotoSans-Bold.ttf"].map(async name => (await readFile(new URL(`../assets/fonts/${name}`, import.meta.url))).toString("base64")));
const assets = { jsPDF, autoTable, normal, bold };
const report = { items: withPending, periodLabel: month.label, categoryLabel: "Todas as categorias", typeLabel: "Entradas e despesas", generatedAt: new Date(2026, 9, 3, 10, 30) };
const pdf = buildReportPDF(report, assets);
assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), "%PDF-");
async function pdfText(data) {
  const task = getDocument({ data: new Uint8Array(data) });
  const document = await task.promise;
  const pages = [];
  for (let page = 1; page <= document.numPages; page++) {
    const content = await (await document.getPage(page)).getTextContent();
    pages.push(content.items.map(item => item.str).join(" ").normalize("NFC"));
  }
  const result = { pages: document.numPages, text: pages.join("\n"), pageTexts: pages };
  await task.destroy();
  return result;
}
const extracted = await pdfText(pdf.slice(0));
for (const text of ["Descrição", "Educação", "Cartão principal", "Salário de João", "Família", "Observação com ação e ç", "Consulta médica", "Pendente", "2.180,00", "365,00"]) assert(extracted.text.includes(text), `PDF não preservou: ${text}`);
const manyRows = Array.from({ length: 120 }, (_, index) => ({ ...records[1], id: `row-${index}`, title: `Lançamento ${index + 1} com acentuação`, note: index === 119 ? "ÚLTIMO REGISTRO: não pode ser cortado" : "Texto longo para confirmar a quebra de linha e de página sem cortar valores ou observações." }));
const paged = await pdfText(buildReportPDF({ ...report, items: manyRows }, assets));
assert(paged.pages > 2 && paged.text.includes("ÚLTIMO REGISTRO: não pode ser cortado"));
paged.pageTexts.forEach((text, index) => assert(text.includes(`Página ${index + 1} de ${paged.pages}`) && text.includes("Descrição"), `Página ${index + 1} sem numeração ou cabeçalho repetido`));
if (process.argv.includes("--preview")) {
  const pdfPath = resolve(tmpdir(), "quanto-tem-relatorio-exemplo.pdf");
  await writeFile(pdfPath, new Uint8Array(pdf));
  const task = getDocument({ data: new Uint8Array(pdf.slice(0)) });
  const document = await task.promise;
  const page = await document.getPage(1);
  const viewport = page.getViewport({ scale: 1.6 });
  const canvas = document.canvasFactory.create(viewport.width, viewport.height);
  await page.render({ canvasContext: canvas.context, viewport }).promise;
  const imagePath = resolve(tmpdir(), "quanto-tem-relatorio-exemplo.png");
  await writeFile(imagePath, canvas.canvas.toBuffer("image/png"));
  await task.destroy();
  process.stdout.write(`Prévia: ${pdfPath}\nImagem: ${imagePath}\n`);
}
process.stdout.write("✓ Relatórios: períodos, categorias, CSV UTF-8 e PDF com acentos e paginação validados\n");
