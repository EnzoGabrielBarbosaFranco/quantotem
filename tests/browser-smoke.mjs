import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const browserPaths = [
  ["Chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"],
  ["Edge", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"]
];
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function availablePort() {
  const probe = createNetServer();
  await new Promise((resolveListen, reject) => probe.once("error", reject).listen(0, "127.0.0.1", resolveListen));
  const { port } = probe.address();
  await new Promise(resolveClose => probe.close(resolveClose));
  return port;
}

function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const requestedFile = pathname === "/" ? "/index.html" : pathname;
      const filePath = resolve(projectRoot, `.${requestedFile}`);
      if (filePath !== projectRoot && !filePath.startsWith(`${projectRoot}${sep}`)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, { "content-type": contentTypes[extname(filePath)] || "application/octet-stream" }).end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  return server;
}

async function retry(task, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { return await task(); }
    catch (error) { lastError = error; await new Promise(resolveWait => setTimeout(resolveWait, 100)); }
  }
  throw lastError || new Error("Tempo de espera excedido");
}

async function connectDevTools(url) {
  const targets = await retry(async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`DevTools respondeu ${response.status}`);
    return response.json();
  });
  const page = targets.find(target => target.type === "page");
  assert(page, "A aba do teste não foi encontrada");

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let commandId = 0;
  const pending = new Map();
  const exceptions = [];
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
    if (!message.id || !pending.has(message.id)) return;
    const { resolveCommand, rejectCommand } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) rejectCommand(new Error(message.error.message));
    else resolveCommand(message.result);
  });

  function command(method, params = {}) {
    const id = ++commandId;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveCommand, rejectCommand) => pending.set(id, { resolveCommand, rejectCommand }));
  }

  async function evaluate(expression) {
    const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  }

  await command("Runtime.enable");
  await retry(async () => {
    const ready = await evaluate("document.readyState === 'complete' && Boolean(document.querySelector('#transactionForm'))");
    if (!ready) throw new Error("Página ainda não carregou");
  });

  return { command, evaluate, exceptions, close: () => socket.close() };
}

const fillAndSubmit = (type, title, amount, date = "") => `(async () => {
  document.querySelector('[data-open-transaction="${type}"]').click();
  const form = document.querySelector('#transactionForm');
  form.elements.title.value = ${JSON.stringify(title)};
  form.elements.amount.value = ${JSON.stringify(amount)};
  form.elements.amount.dispatchEvent(new Event('input', { bubbles: true }));
  if (${JSON.stringify(date)}) form.elements.date.value = ${JSON.stringify(date)};
  form.elements.account.value = 'Conta teste';
  form.requestSubmit();
  await new Promise(resolve => setTimeout(resolve, 50));
  return {
    modalClosed: document.querySelector('#transactionModal').classList.contains('hidden'),
    amountError: form.elements.amount.validationMessage,
    saved: JSON.parse(localStorage.getItem('contaai-transactions-v2') || '[]'),
    toast: document.querySelector('#toast').textContent,
    recentText: document.querySelector('#recentTransactions').textContent,
    periodLabel: document.querySelector('#periodLabel').textContent,
    typeFilter: document.querySelector('#typeFilter').value,
    categoryFilter: document.querySelector('#categoryFilter').value
  };
})()`;

async function runBrowser(name, executable, appUrl) {
  const debugPort = await availablePort();
  const profile = await mkdtemp(resolve(tmpdir(), "quanto-tem-browser-test-"));
  const browser = spawn(executable, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "--lang=pt-BR",
    appUrl
  ], { stdio: "ignore" });

  let devTools;
  try {
    devTools = await connectDevTools(`http://127.0.0.1:${debugPort}/json/list`);
    await devTools.command("Emulation.setDeviceMetricsOverride", { width: 1354, height: 650, deviceScaleFactor: 1, mobile: false });
    await devTools.evaluate("localStorage.clear(); location.reload(); true").catch(() => {});
    await retry(async () => {
      const ready = await devTools.evaluate("document.readyState === 'complete' && Boolean(document.querySelector('#transactionForm'))");
      if (!ready) throw new Error("Página ainda não recarregou");
    });

    const todayShortcut = await devTools.evaluate(`(() => {
      document.querySelector('[data-period="day"]').click();
      document.querySelector('#prevPeriod').click();
      const button = document.querySelector('#goToday');
      const shownAfterNavigating = !button.classList.contains('hidden');
      const historicalEyebrow = document.querySelector('#periodEyebrow').textContent;
      button.click();
      const savedUI = JSON.parse(localStorage.getItem('contaai-ui-state-v1') || '{}');
      return {
        shownAfterNavigating,
        historicalEyebrow,
        hiddenAfterReturning: button.classList.contains('hidden'),
        currentEyebrow: document.querySelector('#periodEyebrow').textContent,
        returnedToToday: savedUI.anchor === new Date().toLocaleDateString('sv-SE')
      };
    })()`);
    assert(todayShortcut.shownAfterNavigating && todayShortcut.historicalEyebrow === "PERÍODO SELECIONADO", `${name}: o botão Hoje não apareceu fora do período atual`);
    assert(todayShortcut.hiddenAfterReturning && todayShortcut.currentEyebrow === "PERÍODO ATUAL" && todayShortcut.returnedToToday, `${name}: o botão Hoje não retornou à data atual`);

    const formatting = await devTools.evaluate(`(() => {
      document.querySelector('[data-open-transaction="income"]').click();
      const amount = document.querySelector('#transactionForm').elements.amount;
      amount.focus();
      amount.value = '2000';
      amount.dispatchEvent(new Event('input', { bubbles: true }));
      const whileTyping = amount.value;
      amount.value = '2.00';
      amount.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
      const afterDeletingDigit = amount.value;
      amount.value = '2000';
      amount.dispatchEvent(new Event('input', { bubbles: true }));
      amount.blur();
      const afterBlur = amount.value;
      document.querySelector('#transactionModal .close-modal').click();
      return { whileTyping, afterDeletingDigit, afterBlur };
    })()`);
    assert(formatting.whileTyping === "2.000" && formatting.afterDeletingDigit === "200" && formatting.afterBlur === "2.000,00", `${name}: a formatação automática do valor falhou`);

    const darkMode = await devTools.evaluate(`(() => {
      document.querySelector('#themeBtn').click();
      document.querySelector('[data-open-transaction="income"]').click();
      const footerElement = document.querySelector('.sidebar-foot');
      const footer = footerElement?.getBoundingClientRect();
      const modal = getComputedStyle(document.querySelector('#transactionModal .modal'));
      const activeTab = getComputedStyle(document.querySelector('.period-tabs button.active'));
      const result = {
        bodyDark: document.body.classList.contains('dark'),
        appDark: document.querySelector('#app').classList.contains('dark'),
        modalBackground: modal.backgroundImage,
        modalColorScheme: modal.colorScheme,
        activeTabColor: activeTab.color,
        footerVisible: !footer || (footer.top >= 0 && footer.bottom <= innerHeight + 1)
      };
      document.querySelector('#transactionModal .close-modal').click();
      document.querySelector('#themeBtn').click();
      return result;
    })()`);
    assert(darkMode.bodyDark && darkMode.appDark && darkMode.modalBackground !== "none", `${name}: o dark mode não alcançou toda a interface`);
    assert(darkMode.modalColorScheme === "dark", `${name}: os controles nativos do modal não receberam o tema escuro`);
    assert(darkMode.footerVisible, `${name}: o rodapé lateral ficou cortado em 1354x650`);

    await devTools.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const mobileHeader = await devTools.evaluate(`(async () => {
      document.querySelector('#openMenu').click();
      await new Promise(resolve => setTimeout(resolve, 280));
      const brand = document.querySelector('.mobile-brand').getBoundingClientRect();
      const period = document.querySelector('.period-control').getBoundingClientRect();
      const sidebar = document.querySelector('#sidebar').getBoundingClientRect();
      const syncButton = document.querySelector('#openSync');
      const syncLabel = syncButton.querySelector('span').getBoundingClientRect();
      const result = {
        brandVisible: brand.width > 90 && brand.height >= 28,
        brandText: document.querySelector('.mobile-brand').textContent,
        brandAbovePeriod: brand.bottom <= period.top,
        sidebarFits: sidebar.width <= innerWidth - 15,
        syncSingleLine: syncLabel.height < 20 && syncButton.scrollHeight <= syncButton.clientHeight + 1,
        topStripeRemoved: getComputedStyle(document.body, '::before').content === 'none'
      };
      document.querySelector('#closeMenu').click();
      return result;
    })()`);
    assert(mobileHeader.brandVisible && mobileHeader.brandText.includes("Quanto") && mobileHeader.brandText.includes("Tem") && mobileHeader.brandAbovePeriod, `${name}: a marca não ficou visível e organizada no cabeçalho mobile`);
    assert(mobileHeader.sidebarFits && mobileHeader.syncSingleLine && mobileHeader.topStripeRemoved, `${name}: a barra lateral mobile, o botão de sincronização ou a remoção da faixa superior falhou`);
    if (process.argv.includes("--screenshots") && name === "Chrome") {
      await devTools.evaluate("new Promise(resolve => setTimeout(() => resolve(true), 300))");
      const mobileHeaderShot = await devTools.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const mobileHeaderPath = resolve(tmpdir(), "quanto-tem-mobile-header.png");
      await writeFile(mobileHeaderPath, Buffer.from(mobileHeaderShot.data, "base64"));
      process.stdout.write(`Prévia: ${mobileHeaderPath}\n`);
      await devTools.evaluate("document.querySelector('#openMenu').click(); new Promise(resolve => setTimeout(() => resolve(true), 300))");
      const mobileShot = await devTools.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const mobilePath = resolve(tmpdir(), "quanto-tem-mobile-navigation.png");
      await writeFile(mobilePath, Buffer.from(mobileShot.data, "base64"));
      process.stdout.write(`Prévia: ${mobilePath}\n`);
      await devTools.evaluate("document.querySelector('#closeMenu').click(); true");
    }
    await devTools.command("Emulation.setDeviceMetricsOverride", { width: 1354, height: 650, deviceScaleFactor: 1, mobile: false });

    if (process.argv.includes("--screenshots") && name === "Chrome") {
      await devTools.evaluate("document.querySelector('#themeBtn').click(); document.querySelector('#prevPeriod').click(); new Promise(resolve => setTimeout(() => resolve(true), 350))");
      const dashboardShot = await devTools.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const dashboardPath = resolve(tmpdir(), "quanto-tem-dark-dashboard.png");
      await writeFile(dashboardPath, Buffer.from(dashboardShot.data, "base64"));

      await devTools.evaluate(`(async () => {
        document.querySelector('#goToday').click();
        document.querySelector('[data-open-transaction="income"]').click();
        const amount = document.querySelector('#transactionForm').elements.amount;
        amount.value = '2000';
        amount.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 300));
        return true;
      })()`);
      const modalShot = await devTools.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const modalPath = resolve(tmpdir(), "quanto-tem-dark-modal.png");
      await writeFile(modalPath, Buffer.from(modalShot.data, "base64"));
      process.stdout.write(`Prévia: ${dashboardPath}\nPrévia: ${modalPath}\n`);
      await devTools.evaluate("document.querySelector('#transactionModal .close-modal').click(); document.querySelector('#themeBtn').click(); true");
    }

    await devTools.evaluate(`(() => {
      const nativeSetItem = Storage.prototype.setItem;
      localStorage.setItem('contaai-ui-state-v1', JSON.stringify({
        period: 'day',
        anchor: '2026-08-18',
        typeFilter: 'expense',
        categoryFilter: 'Moradia',
        search: 'não corresponde',
        view: 'dashboard',
        transactionType: 'expense'
      }));
      Storage.prototype.setItem = function (key, value) {
        if (key !== 'contaai-ui-state-v1') nativeSetItem.call(this, key, value);
      };
      location.reload();
      return true;
    })()`).catch(() => {});
    await retry(async () => {
      const ready = await devTools.evaluate("document.readyState === 'complete' && document.querySelector('#periodLabel')?.textContent.includes('18')");
      if (!ready) throw new Error("O filtro antigo ainda não carregou");
    });
    const revealed = await devTools.evaluate(fillAndSubmit("income", "Entrada fora do filtro", "2500", "2026-09-03"));
    assert(revealed.recentText.includes("Entrada fora do filtro"), `${name}: o lançamento salvo continuou escondido pelo período`);
    assert(revealed.periodLabel.toLocaleLowerCase("pt-BR").includes("setembro") && revealed.typeFilter === "all" && revealed.categoryFilter === "all", `${name}: os filtros não foram ajustados para revelar o lançamento`);

    await devTools.evaluate(`(() => {
      const nativeSetItem = Storage.prototype.setItem;
      localStorage.clear();
      Storage.prototype.setItem = function (key, value) {
        if (key !== 'contaai-ui-state-v1') nativeSetItem.call(this, key, value);
      };
      location.reload();
      return true;
    })()`).catch(() => {});
    await retry(async () => {
      const ready = await devTools.evaluate("document.readyState === 'complete' && Boolean(document.querySelector('#transactionForm'))");
      if (!ready) throw new Error("A página ainda não reiniciou");
    });

    const expense = await devTools.evaluate(fillAndSubmit("expense", "Despesa Chrome", "1.234,56"));
    assert(expense.modalClosed, `${name}: a despesa com vírgula não fechou o modal`);
    assert(expense.saved[0]?.amount === 1234.56 && expense.saved[0]?.type === "expense", `${name}: a despesa foi salva com valor incorreto`);

    const income = await devTools.evaluate(fillAndSubmit("income", "Entrada Chrome", "987.65"));
    assert(income.modalClosed, `${name}: a entrada com ponto não fechou o modal`);
    assert(income.saved[0]?.amount === 987.65 && income.saved[0]?.type === "income", `${name}: a entrada foi salva com valor incorreto`);

    const editing = await devTools.evaluate(`(async () => {
      const before = JSON.parse(localStorage.getItem('contaai-transactions-v2') || '[]');
      const original = before.find(item => item.title === 'Entrada Chrome');
      document.querySelector('[data-edit="' + original.id + '"]').click();
      const form = document.querySelector('#transactionForm');
      const prefilled = {
        title: form.elements.title.value,
        amount: form.elements.amount.value,
        type: form.elements.type.value,
        account: form.elements.account.value,
        heading: document.querySelector('#transactionModalTitle').textContent
      };
      form.elements.title.value = 'Lançamento editado';
      form.elements.amount.value = '2.345,67';
      form.elements.amount.dispatchEvent(new Event('input', { bubbles: true }));
      form.elements.type.value = 'expense';
      form.elements.type.dispatchEvent(new Event('change', { bubbles: true }));
      form.elements.category.value = 'Moradia';
      form.elements.date.value = new Date().toLocaleDateString('sv-SE');
      form.elements.account.value = 'Cartão principal';
      form.elements.note.value = 'Observação atualizada';
      form.elements.recurring.checked = true;
      form.elements.recurring.dispatchEvent(new Event('change', { bubbles: true }));
      form.elements.paid.checked = true;
      form.requestSubmit();
      await new Promise(resolve => setTimeout(resolve, 50));
      const saved = JSON.parse(localStorage.getItem('contaai-transactions-v2') || '[]');
      return {
        prefilled,
        originalId: original.id,
        saved,
        edited: saved.find(item => item.id === original.id),
        modalClosed: document.querySelector('#transactionModal').classList.contains('hidden'),
        toast: document.querySelector('#toast').textContent,
        recurringEditAvailable: Boolean(document.querySelector('#recurringGrid [data-edit="' + original.id + '"]'))
      };
    })()`);
    assert(editing.prefilled.title === "Entrada Chrome" && editing.prefilled.amount === "987,65" && editing.prefilled.type === "income" && editing.prefilled.account === "Conta teste" && editing.prefilled.heading === "Editar lançamento", `${name}: os dados do lançamento não foram preenchidos para edição`);
    assert(editing.saved.length === 2 && editing.edited?.id === editing.originalId, `${name}: a edição criou outro lançamento ou alterou o identificador`);
    assert(editing.edited?.title === "Lançamento editado" && editing.edited?.amount === 2345.67 && editing.edited?.type === "expense" && editing.edited?.category === "Moradia", `${name}: os dados principais da edição não foram salvos`);
    assert(editing.edited?.account === "Cartão principal" && editing.edited?.note === "Observação atualizada" && editing.edited?.recurring === true && editing.edited?.paid === true, `${name}: conta, observação ou dados do gasto fixo não foram atualizados`);
    assert(editing.modalClosed && editing.toast.includes("atualizado") && editing.recurringEditAvailable, `${name}: o retorno visual da edição ou o atalho do gasto fixo falhou`);

    const goalEditing = await devTools.evaluate(`(async () => {
      document.querySelector('#openGoal').click();
      const form = document.querySelector('#goalForm');
      form.elements.title.value = 'Reserva de emergência';
      form.elements.target.value = '10000.50';
      form.elements.saved.value = '1250.25';
      form.requestSubmit();
      await new Promise(resolve => setTimeout(resolve, 50));
      const created = JSON.parse(localStorage.getItem('contaai-goals-v2') || '[]')[0];
      const editButton = document.querySelector('[data-edit-goal="' + created.id + '"]');
      const deleteButton = document.querySelector('[data-delete-goal="' + created.id + '"]');
      const iconsAlwaysVisible = getComputedStyle(editButton).opacity === '1' && getComputedStyle(deleteButton).opacity === '1';
      editButton.click();
      const prefilled = {
        title: form.elements.title.value,
        target: Number(form.elements.target.value),
        saved: Number(form.elements.saved.value),
        heading: document.querySelector('#goalModalTitle').textContent
      };
      form.elements.title.value = 'Reserva atualizada';
      form.elements.target.value = '15000.75';
      form.elements.saved.value = '3200.50';
      form.requestSubmit();
      await new Promise(resolve => setTimeout(resolve, 50));
      const goals = JSON.parse(localStorage.getItem('contaai-goals-v2') || '[]');
      return {
        prefilled,
        createdId: created.id,
        iconsAlwaysVisible,
        goals,
        modalClosed: document.querySelector('#goalModal').classList.contains('hidden'),
        toast: document.querySelector('#toast').textContent,
        cardText: document.querySelector('#goalsGrid').textContent
      };
    })()`);
    assert(goalEditing.prefilled.title === "Reserva de emergência" && goalEditing.prefilled.target === 10000.5 && goalEditing.prefilled.saved === 1250.25 && goalEditing.prefilled.heading === "Editar meta", `${name}: os valores da meta não foram preenchidos para edição`);
    assert(goalEditing.goals.length === 1 && goalEditing.goals[0]?.id === goalEditing.createdId, `${name}: a edição duplicou a meta ou alterou seu identificador`);
    assert(goalEditing.goals[0]?.title === "Reserva atualizada" && goalEditing.goals[0]?.target === 15000.75 && goalEditing.goals[0]?.saved === 3200.5, `${name}: os novos valores da meta não foram salvos`);
    assert(goalEditing.iconsAlwaysVisible && goalEditing.modalClosed && goalEditing.toast.includes("atualizada") && goalEditing.cardText.includes("Reserva atualizada"), `${name}: a interface de edição da meta não foi atualizada corretamente`);

    const budgeting = await devTools.evaluate(`(async () => {
      document.querySelector('[data-view="budgets"]').click();
      document.querySelector('#openBudget').click();
      const form = document.querySelector('#budgetForm');
      const categories = [...form.elements.category.options].map(option => option.value);
      form.elements.category.value = 'Moradia';
      form.elements.limit.value = '1.500,00';
      form.requestSubmit();
      await new Promise(resolve => setTimeout(resolve, 50));
      const created = JSON.parse(localStorage.getItem('contaai-budgets-v1') || '[]')[0];
      document.querySelector('[data-edit-budget="' + created.id + '"]').click();
      const prefilled = { category: form.elements.category.value, limit: form.elements.limit.value };
      form.elements.limit.value = '2.000,00';
      form.requestSubmit();
      await new Promise(resolve => setTimeout(resolve, 50));
      const budgets = JSON.parse(localStorage.getItem('contaai-budgets-v1') || '[]');
      const result = {
        categories,
        prefilled,
        budgets,
        cardText: document.querySelector('#budgetGrid').textContent,
        summaryText: document.querySelector('#budgetSummary').textContent,
        modalClosed: document.querySelector('#budgetModal').classList.contains('hidden')
      };
      document.querySelector('[data-view="dashboard"]').click();
      return result;
    })()`);
    assert(budgeting.categories.includes("Moradia") && budgeting.prefilled.category === "Moradia" && budgeting.prefilled.limit === "1.500,00", `${name}: o orçamento não abriu com os dados esperados`);
    assert(budgeting.budgets.length === 1 && budgeting.budgets[0]?.limit === 2000 && Number.isFinite(budgeting.budgets[0]?.updatedAt), `${name}: o orçamento não foi salvo ou atualizado corretamente`);
    assert(budgeting.modalClosed && budgeting.cardText.includes("Moradia") && budgeting.cardText.includes("R$ 2.000,00") && budgeting.summaryText.includes("R$ 2.000,00"), `${name}: o resumo visual do orçamento não foi atualizado`);

    const pendingFixed = await devTools.evaluate(`(async () => {
      const expenseCard = () => document.querySelector('#dashboardView .summary-card.expense strong').textContent;
      const expenseBefore = expenseCard();
      const numberFromMoney = value => Number(value.replace(/[^0-9,.-]/g, '').replaceAll('.', '').replace(',', '.'));
      const budgetSpent = () => numberFromMoney(document.querySelector('.budget-values strong').textContent);
      const budgetBefore = budgetSpent();
      const originalDate = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toLocaleDateString('sv-SE');
      document.querySelector('[data-open-transaction="expense"]').click();
      const form = document.querySelector('#transactionForm');
      form.elements.title.value = 'Conta fixa pendente';
      form.elements.date.value = originalDate;
      form.elements.category.value = 'Moradia';
      form.elements.amount.value = '300,00';
      form.elements.amount.dispatchEvent(new Event('input', { bubbles: true }));
      form.elements.account.value = 'Débito automático';
      form.elements.recurring.checked = true;
      form.elements.recurring.dispatchEvent(new Event('change', { bubbles: true }));
      form.requestSubmit();
      await new Promise(resolve => setTimeout(resolve, 50));
      const createdToast = document.querySelector('#toast').textContent;
      const savedAfterCreation = JSON.parse(localStorage.getItem('contaai-transactions-v2') || '[]');
      const fixed = savedAfterCreation.find(item => item.title === 'Conta fixa pendente');
      const pendingState = {
        expense: expenseCard(),
        inRecent: document.querySelector('#recentTransactions').textContent.includes(fixed.title),
        inHistory: document.querySelector('#allTransactions').textContent.includes(fixed.title),
        inFixedExpenses: document.querySelector('#recurringGrid').textContent.includes(fixed.title)
      };
      let checkbox = document.querySelector('[data-toggle-paid="' + fixed.id + '"]');
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 20));
      const paidState = {
        expense: expenseCard(),
        budget: budgetSpent(),
        currentMonthChart: document.querySelector('#monthlyChart .expense-point:last-child title')?.textContent,
        inRecent: document.querySelector('#recentTransactions').textContent.includes(fixed.title),
        inHistory: document.querySelector('#allTransactions').textContent.includes(fixed.title),
        saved: JSON.parse(localStorage.getItem('contaai-transactions-v2')).find(item => item.id === fixed.id),
        toast: document.querySelector('#toast').textContent
      };
      checkbox = document.querySelector('[data-toggle-paid="' + fixed.id + '"]');
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 20));
      const finalSaved = JSON.parse(localStorage.getItem('contaai-transactions-v2') || '[]');
      return {
        expenseBefore,
        budgetBefore,
        budgetAfterUnmarking: budgetSpent(),
        expectedPaidExpense: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(numberFromMoney(expenseBefore) + 300),
        originalDate,
        paymentDate: new Date().toLocaleDateString('sv-SE'),
        createdToast,
        fixed,
        pendingState,
        paidState,
        expenseAfterUnmarking: expenseCard(),
        visibleAfterUnmarking: document.querySelector('#recentTransactions').textContent.includes(fixed.title),
        finalPaid: finalSaved.find(item => item.id === fixed.id)?.paid
      };
    })()`);
    assert(pendingFixed.fixed?.recurring === true && pendingFixed.fixed?.paid === false && pendingFixed.createdToast.includes("quando for marcado como pago"), `${name}: o gasto fixo pendente não foi cadastrado corretamente`);
    assert(pendingFixed.pendingState.expense === pendingFixed.expenseBefore && !pendingFixed.pendingState.inRecent && !pendingFixed.pendingState.inHistory && pendingFixed.pendingState.inFixedExpenses, `${name}: o gasto fixo pendente entrou no saldo ou no histórico antes do pagamento`);
    assert(pendingFixed.paidState.expense !== pendingFixed.expenseBefore && pendingFixed.paidState.inRecent && pendingFixed.paidState.toast.includes("incluído no saldo"), `${name}: o gasto fixo pago não entrou no saldo e no histórico`);
    assert(pendingFixed.paidState.inHistory && pendingFixed.paidState.saved?.date === pendingFixed.originalDate && pendingFixed.paidState.saved?.paidDate === pendingFixed.paymentDate, `${name}: o pagamento não foi contabilizado na data da confirmação ou perdeu a data original`);
    assert(pendingFixed.paidState.expense === pendingFixed.expectedPaidExpense && pendingFixed.paidState.currentMonthChart?.includes(pendingFixed.expectedPaidExpense), `${name}: o pagamento não entrou com o valor correto no resumo e no gráfico do mês`);
    assert(pendingFixed.paidState.budget === pendingFixed.budgetBefore + 300 && pendingFixed.budgetAfterUnmarking === pendingFixed.budgetBefore, `${name}: o orçamento não acompanhou a confirmação e o cancelamento do pagamento`);
    assert(pendingFixed.expenseAfterUnmarking === pendingFixed.expenseBefore && !pendingFixed.visibleAfterUnmarking && pendingFixed.finalPaid === false, `${name}: desmarcar o pagamento não removeu o gasto do saldo`);

    const filteredPayment = await devTools.evaluate(`(async () => {
      const fixed = JSON.parse(localStorage.getItem('contaai-transactions-v2')).find(item => item.title === 'Conta fixa pendente');
      document.querySelector('[data-period="month"]').click();
      document.querySelector('#prevPeriod').click();
      const typeFilter = document.querySelector('#typeFilter');
      typeFilter.value = 'income';
      typeFilter.dispatchEvent(new Event('change', { bubbles: true }));
      const categoryFilter = document.querySelector('#categoryFilter');
      categoryFilter.value = 'Salário';
      categoryFilter.dispatchEvent(new Event('change', { bubbles: true }));
      const search = document.querySelector('.search-input');
      search.value = 'busca sem correspondência';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-view="recurring"]').click();
      document.querySelector('[data-toggle-paid="' + fixed.id + '"]').click();
      const ui = JSON.parse(localStorage.getItem('contaai-ui-state-v1'));
      const visible = document.querySelector('#allTransactions').textContent.includes(fixed.title);

      document.querySelector('#recurringGrid [data-edit="' + fixed.id + '"]').click();
      const form = document.querySelector('#transactionForm');
      const editDate = form.elements.date.value;
      form.elements.note.value = 'Pagamento revisado';
      form.requestSubmit();
      const saved = JSON.parse(localStorage.getItem('contaai-transactions-v2'));

      let exportedBlob;
      const originalCreateURL = URL.createObjectURL;
      const originalAnchorClick = HTMLAnchorElement.prototype.click;
      try {
        URL.createObjectURL = blob => { exportedBlob = blob; return originalCreateURL(blob); };
        HTMLAnchorElement.prototype.click = function () {};
        document.querySelector('.export-btn').click();
      } finally {
        URL.createObjectURL = originalCreateURL;
        HTMLAnchorElement.prototype.click = originalAnchorClick;
      }
      const csv = await exportedBlob.text();
      return { ui, visible, editDate, saved: saved.find(item => item.id === fixed.id), count: saved.filter(item => item.id === fixed.id).length, csv };
    })()`);
    assert(filteredPayment.visible && filteredPayment.ui.typeFilter === 'all' && filteredPayment.ui.categoryFilter === 'all' && filteredPayment.ui.search === '' && filteredPayment.ui.anchor === pendingFixed.paymentDate, `${name}: os filtros ou o mês anterior esconderam o pagamento confirmado`);
    assert(filteredPayment.editDate === pendingFixed.paymentDate && filteredPayment.saved?.date === pendingFixed.originalDate && filteredPayment.saved?.paidDate === pendingFixed.paymentDate && filteredPayment.count === 1, `${name}: editar o pagamento alterou sua data ou duplicou a despesa`);
    assert(filteredPayment.csv.includes('"' + pendingFixed.paymentDate.split('-').reverse().join('/') + '";"Despesa";"Conta fixa pendente"'), `${name}: a exportação não utilizou a data do pagamento`);

    await devTools.evaluate("location.reload(); true").catch(() => {});
    await retry(async () => {
      const persistedPayment = await devTools.evaluate(`(() => {
        const saved = JSON.parse(localStorage.getItem('contaai-transactions-v2') || '[]');
        const fixed = saved.find(item => item.title === 'Conta fixa pendente');
        return fixed?.paid && fixed.paidDate === new Date().toLocaleDateString('sv-SE') && document.querySelector('#allTransactions')?.textContent.includes(fixed.title);
      })()`);
      if (!persistedPayment) throw new Error('O pagamento não reapareceu como despesa depois de recarregar');
    });
    const unmarkedPayment = await devTools.evaluate(`(() => {
      const fixed = JSON.parse(localStorage.getItem('contaai-transactions-v2')).find(item => item.title === 'Conta fixa pendente');
      document.querySelector('[data-toggle-paid="' + fixed.id + '"]').click();
      const saved = JSON.parse(localStorage.getItem('contaai-transactions-v2')).find(item => item.id === fixed.id);
      document.querySelector('[data-view="dashboard"]').click();
      return { saved, expense: document.querySelector('#dashboardView .summary-card.expense strong').textContent };
    })()`);
    assert(unmarkedPayment.saved?.paid === false && unmarkedPayment.saved?.paidDate === null && unmarkedPayment.saved?.date === pendingFixed.originalDate && unmarkedPayment.expense === pendingFixed.expenseBefore, `${name}: desmarcar o pagamento após recarregar não restaurou o saldo e a data original`);

    const invalid = await devTools.evaluate(fillAndSubmit("expense", "Valor inválido", "abc"));
    assert(!invalid.modalClosed && invalid.saved.length === 3 && invalid.amountError, `${name}: um valor inválido foi aceito`);
    await devTools.evaluate("document.querySelector('#transactionModal .close-modal').click(); true");

    await devTools.evaluate("location.reload(); true").catch(() => {});
    await retry(async () => {
      const persisted = await devTools.evaluate(`(() => {
        const saved = JSON.parse(localStorage.getItem('contaai-transactions-v2') || '[]');
        const visible = document.querySelector('#recentTransactions')?.textContent || '';
        return saved.length === 3 && visible.includes('Despesa Chrome') && visible.includes('Lançamento editado') && !visible.includes('Conta fixa pendente');
      })()`);
      if (!persisted) throw new Error("Os lançamentos ainda não reapareceram após recarregar");
    });

    const blockedStorage = await devTools.evaluate(`(async () => {
      window.__originalStorageSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function () { throw new DOMException('Blocked', 'SecurityError'); };
      ${fillAndSubmit("expense", "Sessão sem storage", "10,50")}
      const visibleRows = document.querySelector('#recentTransactions').textContent;
      Storage.prototype.setItem = window.__originalStorageSetItem;
      return { visibleRows, modalClosed: document.querySelector('#transactionModal').classList.contains('hidden'), toast: document.querySelector('#toast').textContent };
    })()`);
    assert(blockedStorage.modalClosed && blockedStorage.visibleRows.includes("Sessão sem storage"), `${name}: o cadastro travou com armazenamento bloqueado`);
    assert(blockedStorage.toast.includes("nesta sessão"), `${name}: não houve aviso sobre o armazenamento bloqueado`);

    await devTools.evaluate(`(() => {
      const date = new Date().toLocaleDateString('sv-SE');
      const now = Date.now();
      localStorage.setItem('contaai-transactions-v2', JSON.stringify([
        { id: 'salary', title: 'Salário', type: 'income', category: 'Salário', amount: 2545, date, recurring: false, paid: true, updatedAt: now },
        { id: 'phone', title: 'Telefone', type: 'expense', category: 'Assinaturas', amount: 65, date, recurring: true, paid: true, updatedAt: now },
        { id: 'singing', title: 'Canto', type: 'expense', category: 'Educação', amount: 300, date, recurring: true, paid: true, updatedAt: now }
      ]));
      localStorage.setItem('contaai-ui-state-v1', JSON.stringify({ view: 'transactions', period: 'month', anchor: date, typeFilter: 'income', categoryFilter: 'Salário', search: '' }));
      const nativeSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key !== 'contaai-ui-state-v1') nativeSetItem.call(this, key, value);
      };
      location.reload();
      return true;
    })()`).catch(() => {});
    await retry(async () => {
      if (!await devTools.evaluate("document.readyState === 'complete' && document.querySelector('#typeFilter')?.value === 'income'")) throw new Error('Filtros de lançamentos ainda não foram restaurados');
    });
    const existingPayments = await devTools.evaluate(`(() => {
      const filteredHistory = document.querySelector('#allTransactions').textContent;
      const filteredExpenses = document.querySelector('#transactionsView .summary-card.expense strong').textContent;
      document.querySelector('[data-view="recurring"]').click();
      const fixedPaid = document.querySelector('#fixedSummary > div:nth-child(2) strong').textContent;
      const checked = [...document.querySelectorAll('[data-toggle-paid]')].every(input => input.checked);
      document.querySelector('[data-view="dashboard"]').click();
      return {
        fixedPaid, checked, filteredHistory, filteredExpenses,
        income: document.querySelector('#dashboardView .summary-card.income strong').textContent,
        expenses: document.querySelector('#dashboardView .summary-card.expense strong').textContent,
        balance: document.querySelector('#dashboardView .summary-card.balance strong').textContent,
        recent: document.querySelector('#recentTransactions').textContent,
        categories: document.querySelector('#categoryChart').textContent,
        chart: document.querySelector('#monthlyChart .expense-point:last-child title')?.textContent
      };
    })()`);
    assert(existingPayments.checked && existingPayments.fixedPaid === 'R$ 365,00', `${name}: a reprodução dos gastos já pagos não foi carregada`);
    assert(existingPayments.filteredExpenses === 'R$ 0,00' && existingPayments.filteredHistory.includes('Salário') && !existingPayments.filteredHistory.includes('Telefone'), `${name}: os filtros de lançamentos deixaram de funcionar`);
    assert(existingPayments.expenses === 'R$ 365,00' && existingPayments.income === 'R$ 2.545,00' && existingPayments.balance === 'R$ 2.180,00', `${name}: filtros ocultos de lançamentos esconderam os gastos já pagos na visão geral`);
    assert(existingPayments.recent.includes('Telefone') && existingPayments.recent.includes('Canto') && existingPayments.categories.includes('Assinaturas') && existingPayments.categories.includes('Educação') && existingPayments.chart?.includes('R$ 365,00'), `${name}: gastos já pagos não apareceram no histórico recente e nos gráficos da visão geral`);

    const searchedPayments = await devTools.evaluate(`(() => {
      const search = document.querySelector('#dashboardView .search-input');
      search.value = 'Telefone';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      const result = {
        expenses: document.querySelector('#dashboardView .summary-card.expense strong').textContent,
        balance: document.querySelector('#dashboardView .summary-card.balance strong').textContent,
        recent: document.querySelector('#recentTransactions').textContent,
        insights: document.querySelector('#insightsPanel').textContent
      };
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      return result;
    })()`);
    assert(searchedPayments.expenses === 'R$ 365,00' && searchedPayments.balance === 'R$ 2.180,00' && searchedPayments.insights.includes('3 movimentações'), `${name}: uma busca alterou o saldo ou os totais da visão geral`);
    assert(searchedPayments.recent.includes('Telefone') && !searchedPayments.recent.includes('Canto'), `${name}: a busca deixou de filtrar os lançamentos recentes`);

    await devTools.evaluate("location.reload(); true").catch(() => {});
    await retry(async () => {
      const restoredOverview = await devTools.evaluate(`(() => {
        return document.querySelector('#typeFilter')?.value === 'income' && document.querySelector('#dashboardView .summary-card.expense strong')?.textContent === 'R$ 365,00';
      })()`);
      if (!restoredOverview) throw new Error('Os filtros persistidos voltaram a ocultar as despesas após recarregar');
    });

    const exportOptions = await devTools.evaluate(`(() => {
      document.querySelector('[data-view="transactions"]').click();
      document.querySelector('#openPDFExport').click();
      const form = document.querySelector('#exportForm');
      const initiallySelected = form.elements.type.value === 'income' && document.querySelector('#exportPreview').textContent.includes('1 lançamento');
      form.elements.type.value = 'all';
      form.elements.type.dispatchEvent(new Event('change', { bubbles: true }));
      form.elements.period.value = 'all';
      form.elements.period.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#exportAllCategories').click();
      const allSelected = document.querySelector('#exportAllCategories').checked && document.querySelector('#exportPreview').textContent.includes('3 lançamentos');
      document.querySelector('#exportAllCategories').click();
      const disabledWhenEmpty = document.querySelector('#exportPDFSubmit').disabled && document.querySelector('#exportModalCSV').disabled;
      for (const category of ['Assinaturas', 'Educação']) {
        document.querySelector('#exportCategories input[value="' + category + '"]').click();
      }
      form.elements.period.value = 'week';
      form.elements.period.dispatchEvent(new Event('change', { bubbles: true }));
      form.elements.date.value = new Date().toLocaleDateString('sv-SE');
      form.elements.date.dispatchEvent(new Event('input', { bubbles: true }));
      const selectedPreview = document.querySelector('#exportPreview').textContent;
      window.__exportOriginalCreateURL = URL.createObjectURL;
      window.__exportOriginalAnchorClick = HTMLAnchorElement.prototype.click;
      URL.createObjectURL = blob => { window.__exportBlob = blob; return window.__exportOriginalCreateURL(blob); };
      HTMLAnchorElement.prototype.click = function () { window.__exportFilename = this.download; };
      document.querySelector('#exportPDFSubmit').click();
      return { initiallySelected, allSelected, disabledWhenEmpty, selectedPreview, modalOpen: !document.querySelector('#exportModal').classList.contains('hidden') };
    })()`);
    assert(exportOptions.modalOpen && exportOptions.initiallySelected && exportOptions.allSelected && exportOptions.disabledWhenEmpty && exportOptions.selectedPreview.includes('2 lançamentos') && exportOptions.selectedPreview.includes('365,00'), `${name}: a seleção de período e categorias do relatório não atualizou a prévia corretamente`);
    await devTools.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const mobileExport = await devTools.evaluate(`(() => {
      const modal = document.querySelector('#exportModal .modal');
      const bounds = modal.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= innerWidth && modal.scrollWidth <= modal.clientWidth;
    })()`);
    assert(mobileExport, `${name}: a janela de exportação transbordou a tela do celular`);
    if (process.argv.includes('--screenshots') && name === 'Chrome') {
      const preview = await devTools.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const path = resolve(tmpdir(), 'quanto-tem-exportar-pdf-mobile.png');
      await writeFile(path, Buffer.from(preview.data, 'base64'));
      process.stdout.write(`Prévia: ${path}\n`);
    }
    await devTools.command("Emulation.setDeviceMetricsOverride", { width: 1354, height: 650, deviceScaleFactor: 1, mobile: false });
    const browserPDF = await retry(async () => {
      const file = await devTools.evaluate(`(async () => {
        if (!window.__exportBlob || window.__exportBlob.type !== 'application/pdf') return null;
        const bytes = new Uint8Array(await window.__exportBlob.arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        return { base64: btoa(binary), filename: window.__exportFilename };
      })()`);
      if (!file) {
        const error = await devTools.evaluate("document.querySelector('#exportError').textContent");
        throw new Error(error || 'O PDF ainda não foi gerado');
      }
      return file;
    });
    assert(browserPDF.filename.endsWith('.pdf'), `${name}: o arquivo gerado não tem extensão PDF`);
    const pdfTask = getDocument({ data: new Uint8Array(Buffer.from(browserPDF.base64, 'base64')) });
    const generatedPDF = await pdfTask.promise;
    let pdfContent = '';
    for (let page = 1; page <= generatedPDF.numPages; page++) pdfContent += (await (await generatedPDF.getPage(page)).getTextContent()).items.map(item => item.str).join(' ');
    await pdfTask.destroy();
    assert(pdfContent.includes('Telefone') && pdfContent.includes('Canto') && pdfContent.includes('Educação') && pdfContent.includes('365,00') && !pdfContent.includes('Salário'), `${name}: o PDF gerado pelo botão perdeu os acentos ou ignorou as categorias selecionadas`);
    const browserCSV = await devTools.evaluate(`(async () => {
      window.__exportBlob = null;
      document.querySelector('#exportModalCSV').click();
      const bytes = new Uint8Array(await window.__exportBlob.arrayBuffer());
      const text = await window.__exportBlob.text();
      URL.createObjectURL = window.__exportOriginalCreateURL;
      HTMLAnchorElement.prototype.click = window.__exportOriginalAnchorClick;
      document.querySelector('#exportModal .close-modal').click();
      return { bytes: [...bytes.slice(0, 3)], text };
    })()`);
    assert(browserCSV.bytes.join(',') === '239,187,191' && browserCSV.text.includes('Educação') && browserCSV.text.includes('65,00') && browserCSV.text.includes('\r\n') && !browserCSV.text.includes('Salário'), `${name}: o CSV do relatório não preservou a codificação, os valores ou as categorias selecionadas`);

    await devTools.evaluate(`
      localStorage.setItem('contaai-transactions-v2', JSON.stringify({ antigo: true }));
      localStorage.setItem('contaai-goals-v2', 'null');
      localStorage.setItem('contaai-categories-v1', JSON.stringify({ inválido: true }));
      localStorage.setItem('contaai-ui-state-v1', 'null');
      location.reload();
      true
    `).catch(() => {});
    await retry(async () => {
      const recovered = await devTools.evaluate("document.readyState === 'complete' && document.querySelector('#recentTransactions')?.textContent.includes('Nenhum lançamento')");
      if (!recovered) throw new Error("Aplicação ainda não se recuperou dos dados antigos");
    });

    assert(devTools.exceptions.length === 0, `${name}: erros de JavaScript: ${devTools.exceptions.join(", ")}`);
    process.stdout.write(`✓ ${name}: despesas, entradas, formatos monetários e armazenamento validados\n`);
  } finally {
    devTools?.close();
    const taskkill = spawn("taskkill", ["/pid", String(browser.pid), "/T", "/F"], { stdio: "ignore" });
    await new Promise(resolveExit => taskkill.once("exit", resolveExit));
    await retry(() => rm(profile, { recursive: true, force: true }), 5000).catch(() => {});
  }
}

const server = startStaticServer();
await new Promise((resolveListen, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolveListen));
const { port } = server.address();

try {
  for (const [name, executable] of browserPaths) await runBrowser(name, executable, `http://127.0.0.1:${port}/index.html`);
} finally {
  await new Promise(resolveClose => server.close(resolveClose));
}
