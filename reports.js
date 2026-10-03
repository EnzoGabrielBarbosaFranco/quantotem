const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateLabel = value => value.split("-").reverse().join("/");
const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const parseDate = value => { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day); };
export const reportDate = item => item.recurring && item.paid && /^\d{4}-\d{2}-\d{2}$/.test(item.paidDate || "") ? item.paidDate : item.date;
export const isPending = item => item.recurring && !item.paid;

export function reportBounds({ period, date, month, year, start, end }) {
  if (period === "all") return { start: null, end: null, label: "Todos os lançamentos" };
  if (period === "month") {
    if (!/^\d{4}-\d{2}$/.test(month || "")) throw new Error("Escolha o mês do relatório.");
    const anchor = parseDate(`${month}-01`);
    if (iso(anchor).slice(0, 7) !== month) throw new Error("Escolha um mês válido.");
    return { start: iso(anchor), end: iso(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)), label: anchor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) };
  }
  if (period === "year") {
    if (!/^\d{4}$/.test(String(year)) || Number(year) < 1900) throw new Error("Informe um ano válido.");
    return { start: `${year}-01-01`, end: `${year}-12-31`, label: `Ano de ${year}` };
  }
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "") && iso(parseDate(value)) === value;
  if (period === "range") {
    if (!validDate(start) || !validDate(end) || start > end) throw new Error("Informe um intervalo válido: a data inicial deve vir antes da data final.");
    return { start, end, label: `${dateLabel(start)} a ${dateLabel(end)}` };
  }
  if (!["day", "week"].includes(period) || !validDate(date)) throw new Error("Escolha uma data válida.");
  if (period === "day") return { start: date, end: date, label: `Dia ${dateLabel(date)}` };
  const first = parseDate(date);
  first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const last = new Date(first); last.setDate(first.getDate() + 6);
  return { start: iso(first), end: iso(last), label: `Semana de ${dateLabel(iso(first))} a ${dateLabel(iso(last))}` };
}

export function selectReportTransactions(transactions, { start = null, end = null, categories = null, type = "all", includePending = false } = {}) {
  return transactions.filter(item => includePending || !isPending(item))
    .filter(item => (!start || reportDate(item) >= start) && (!end || reportDate(item) <= end))
    .filter(item => type === "all" || item.type === type)
    .filter(item => categories === null || categories.includes(item.category))
    .sort((a, b) => reportDate(a).localeCompare(reportDate(b)) || a.title.localeCompare(b.title, "pt-BR") || a.id.localeCompare(b.id));
}

export function reportTotals(items) {
  let income = 0, expenses = 0, pending = 0;
  items.forEach(item => {
    const cents = Math.round(Number(item.amount) * 100);
    if (isPending(item)) pending += cents;
    else if (item.type === "income") income += cents;
    else expenses += cents;
  });
  return { income: income / 100, expenses: expenses / 100, balance: (income - expenses) / 100, pending: pending / 100 };
}

export function csvBytes(items) {
  const rows = [["Data", "Tipo", "Descrição", "Categoria", "Conta", "Valor (R$)", "Situação", "Observação"], ...items.map(item => [
    dateLabel(reportDate(item)), item.type === "income" ? "Entrada" : "Despesa", item.title, item.category, item.account,
    Number(item.amount).toFixed(2).replace(".", ","), isPending(item) ? "Pendente" : item.type === "income" ? "Recebido" : "Pago", item.note || ""
  ])];
  const cell = value => {
    let text = String(value ?? "").normalize("NFC");
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  // BOM UTF-8 e linhas CRLF permitem ao Excel reconhecer os acentos ao abrir.
  return new TextEncoder().encode("\ufeff" + rows.map(row => row.map(cell).join(";")).join("\r\n") + "\r\n");
}

let pdfAssetsPromise;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL(src, import.meta.url).href;
    script.onload = resolve;
    script.onerror = () => { script.remove(); reject(new Error("Não foi possível carregar a geração de PDF. Tente novamente.")); };
    document.head.appendChild(script);
  });
}
async function fontBase64(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error("Não foi possível carregar a fonte do relatório. Tente novamente.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
async function loadPDFAssets() {
  if (!pdfAssetsPromise) pdfAssetsPromise = (async () => {
    if (!window.jspdf) await loadScript("vendor/jspdf.umd.min.js");
    if (!window.jspdf.jsPDF.API.autoTable) await loadScript("vendor/jspdf.plugin.autotable.min.js");
    const [normal, bold] = await Promise.all([fontBase64("assets/fonts/NotoSans-Regular.ttf"), fontBase64("assets/fonts/NotoSans-Bold.ttf")]);
    return { jsPDF: window.jspdf.jsPDF, autoTable: (doc, options) => doc.autoTable(options), normal, bold };
  })().catch(error => { pdfAssetsPromise = null; throw error; });
  return pdfAssetsPromise;
}

export async function createReportPDF(report) {
  return buildReportPDF(report, await loadPDFAssets());
}

export function buildReportPDF({ items, periodLabel, categoryLabel, typeLabel, generatedAt = new Date() }, { jsPDF, autoTable, normal, bold }) {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true });
  doc.addFileToVFS("NotoSans-Regular.ttf", normal);
  doc.addFileToVFS("NotoSans-Bold.ttf", bold);
  doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
  doc.addFont("NotoSans-Bold.ttf", "NotoSans", "bold");
  doc.setFont("NotoSans", "normal");
  doc.setProperties({ title: `Quanto Tem - Relatório financeiro - ${periodLabel}`, subject: "Lançamentos financeiros", author: "Quanto Tem", creator: "Quanto Tem" });
  const total = reportTotals(items);
  const blue = [12, 93, 159], navy = [17, 46, 68], muted = [88, 107, 123];
  doc.setFillColor(...blue); doc.roundedRect(15, 15, 180, 25, 3, 3, "F");
  doc.setTextColor(255); doc.setFont("NotoSans", "bold"); doc.setFontSize(19); doc.text("Quanto Tem", 21, 26);
  doc.setFont("NotoSans", "normal"); doc.setFontSize(9); doc.text("RELATÓRIO FINANCEIRO", 21, 34);
  doc.setTextColor(...navy); doc.setFont("NotoSans", "bold"); doc.setFontSize(14); doc.text("Seus lançamentos", 15, 50);
  doc.setFont("NotoSans", "normal"); doc.setFontSize(9); doc.text(periodLabel, 15, 58);
  doc.setTextColor(...muted); doc.setFontSize(8);
  const filterLines = doc.splitTextToSize(`Categorias: ${categoryLabel} | ${typeLabel}`, 180);
  doc.text(filterLines, 15, 65);
  let y = 70 + (filterLines.length - 1) * 4;
  [["ENTRADAS", total.income, [7, 128, 98]], ["DESPESAS PAGAS", total.expenses, [183, 64, 76]], ["SALDO", total.balance, blue]].forEach(([label, value, color], index) => {
    const x = 15 + index * 62;
    doc.setFillColor(242, 247, 251); doc.roundedRect(x, y, 56, 23, 2, 2, "F");
    doc.setFont("NotoSans", "normal"); doc.setFontSize(7); doc.setTextColor(...muted); doc.text(label, x + 5, y + 7);
    doc.setFont("NotoSans", "bold"); doc.setFontSize(12); doc.setTextColor(...color); doc.text(money.format(value), x + 5, y + 17);
  });
  y += 31;
  doc.setFont("NotoSans", "normal"); doc.setFontSize(8); doc.setTextColor(...muted);
  doc.text(`${items.length} ${items.length === 1 ? "lançamento selecionado" : "lançamentos selecionados"}${total.pending ? ` | Pendentes: ${money.format(total.pending)} (fora do saldo)` : ""}`, 15, y);
  const tableOptions = {
    theme: "striped", margin: { top: 30, bottom: 22, left: 15, right: 15 },
    styles: { font: "NotoSans", fontSize: 8, cellPadding: 2.5, overflow: "linebreak", textColor: navy, lineColor: [227, 236, 243] },
    headStyles: { fillColor: blue, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
    alternateRowStyles: { fillColor: [245, 248, 251] }, rowPageBreak: "avoid",
    willDrawPage: () => {
      if (doc.getNumberOfPages() > 1) {
        doc.setFont("NotoSans", "bold"); doc.setFontSize(10); doc.setTextColor(...blue); doc.text("Quanto Tem | Relatório financeiro", 15, 19);
      }
    }
  };
  const byCategory = new Map();
  items.forEach(item => { const group = byCategory.get(item.category) || []; group.push(item); byCategory.set(item.category, group); });
  autoTable(doc, { ...tableOptions, startY: y + 5,
    head: [["Resumo por categoria", "Entradas", "Despesas pagas", "Pendentes"]],
    body: [...byCategory].sort(([a], [b]) => a.localeCompare(b, "pt-BR")).map(([category, entries]) => {
      const values = reportTotals(entries); return [category, money.format(values.income), money.format(values.expenses), money.format(values.pending)];
    }),
    columnStyles: { 0: { cellWidth: 69 }, 1: { halign: "right", cellWidth: 37 }, 2: { halign: "right", cellWidth: 37 }, 3: { halign: "right", cellWidth: 37 } }
  });
  autoTable(doc, { ...tableOptions, startY: doc.lastAutoTable.finalY + 10,
    head: [["Data", "Tipo", "Descrição / observação", "Categoria", "Conta", "Valor (R$)", "Situação"]],
    body: items.map(item => [dateLabel(reportDate(item)), item.type === "income" ? "Entrada" : "Despesa", `${item.title}${item.note ? `\nObs.: ${item.note}` : ""}`, item.category, item.account, money.format(Number(item.amount)), isPending(item) ? "Pendente" : item.type === "income" ? "Recebido" : "Pago"]),
    columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 16 }, 2: { cellWidth: 45 }, 3: { cellWidth: 27 }, 4: { cellWidth: 28 }, 5: { cellWidth: 25, halign: "right" }, 6: { cellWidth: 19 } },
    didParseCell: data => {
      if (data.section === "body" && data.column.index === 5) data.cell.styles.textColor = isPending(items[data.row.index]) ? muted : items[data.row.index].type === "income" ? [7, 128, 98] : [183, 64, 76];
    }
  });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setFont("NotoSans", "normal"); doc.setFontSize(7); doc.setTextColor(...muted);
    doc.setDrawColor(218, 230, 239); doc.line(15, 278, 195, 278);
    doc.text(`Gerado em ${generatedAt.toLocaleString("pt-BR")} | Valores em reais`, 15, 283);
    doc.text(`Página ${page} de ${pages}`, 195, 283, { align: "right" });
    doc.text("Gastos fixos pendentes são informativos e não entram no saldo.", 15, 288);
  }
  return doc.output("arraybuffer");
}
