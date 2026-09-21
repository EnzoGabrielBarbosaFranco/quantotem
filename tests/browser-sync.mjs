import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function assert(condition, message) { if (!condition) throw new Error(message); }
async function retry(task, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { return await task(); }
    catch (error) { lastError = error; await new Promise(resolveWait => setTimeout(resolveWait, 120)); }
  }
  throw lastError || new Error("Tempo de espera excedido");
}
async function availablePort() {
  const server = createNetServer();
  await new Promise((resolveListen, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolveListen));
  const { port } = server.address();
  await new Promise(resolveClose => server.close(resolveClose));
  return port;
}
async function stopProcess(processHandle) {
  if (!processHandle || processHandle.exitCode !== null) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(processHandle.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    await new Promise(resolveExit => killer.once("exit", resolveExit));
  } else {
    processHandle.kill("SIGTERM");
    await Promise.race([new Promise(resolveExit => processHandle.once("exit", resolveExit)), new Promise(resolveWait => setTimeout(resolveWait, 3000))]);
  }
}
async function connectDevTools(debugPort) {
  const targets = await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
    if (!response.ok) throw new Error("DevTools ainda não respondeu");
    return response.json();
  });
  const page = targets.find(target => target.type === "page");
  assert(page, "A aba de teste não foi encontrada");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => { socket.addEventListener("open", resolveOpen, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let commandId = 0;
  const pending = new Map();
  const exceptions = [];
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (!message.id || !pending.has(message.id)) return;
    const handlers = pending.get(message.id); pending.delete(message.id);
    message.error ? handlers.reject(new Error(message.error.message)) : handlers.resolve(message.result);
  });
  const command = (method, params = {}) => new Promise((resolveCommand, rejectCommand) => { const id = ++commandId; pending.set(id, { resolve: resolveCommand, reject: rejectCommand }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await command("Runtime.enable");
  await retry(async () => { if (!await evaluate("document.readyState === 'complete' && Boolean(document.querySelector('#openSync'))")) throw new Error("App ainda não abriu"); });
  return { evaluate, exceptions, close: () => socket.close() };
}
async function openBrowser(appUrl) {
  const profile = await mkdtemp(resolve(tmpdir(), "contaai-sync-browser-"));
  const debugPort = await availablePort();
  const browser = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, appUrl], { stdio: "ignore", windowsHide: true });
  const devTools = await connectDevTools(debugPort);
  return { browser, devTools, profile };
}
async function closeBrowser(target) {
  target?.devTools?.close();
  await stopProcess(target?.browser);
  if (target?.profile) await retry(() => rm(target.profile, { recursive: true, force: true }), 5000).catch(() => {});
}

const externalAppUrl = process.env.CONTA_AI_APP_URL || process.argv.find(argument => argument.startsWith("--url="))?.slice(6);
let worker = null;
let appUrl;
if (externalAppUrl) appUrl = `${externalAppUrl.replace(/\/$/, "")}/`;
else {
  await import("../scripts/prepare-assets.mjs");
  const workerPort = await availablePort();
  const wranglerBin = resolve(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
  worker = spawn(process.execPath, [wranglerBin, "dev", "--port", String(workerPort)], { cwd: projectRoot, stdio: "ignore", windowsHide: true });
  appUrl = `http://127.0.0.1:${workerPort}/`;
}
let first;
let second;

try {
  await retry(async () => { const response = await fetch(`${appUrl}api/sync`); if (!response.ok || response.headers.get("x-contaai-sync") !== "1") throw new Error("Worker ainda não iniciou"); }, 30000);
  first = await openBrowser(appUrl);
  await first.devTools.evaluate("localStorage.clear(); location.reload(); true").catch(() => {});
  await retry(async () => { if (!await first.devTools.evaluate("document.readyState === 'complete' && Boolean(document.querySelector('#createVault'))")) throw new Error("Primeiro navegador recarregando"); });
  await first.devTools.evaluate("document.querySelector('#openSync').click(); document.querySelector('#createVault').click(); true");
  const secret = await retry(async () => {
    const result = await first.devTools.evaluate(`({ secret: localStorage.getItem('contaai-sync-secret-v1'), connected: document.querySelector('#syncDot').classList.contains('connected') })`);
    if (!result.secret || !result.connected) throw new Error("Cofre ainda não foi criado");
    return result.secret;
  });
  await first.devTools.evaluate(`(() => {
    document.querySelector('#syncModal .close-modal').click();
    document.querySelector('[data-open-transaction="income"]').click();
    const form = document.querySelector('#transactionForm');
    form.elements.title.value = 'Compartilhado entre navegadores';
    form.elements.amount.value = '345,67';
    form.elements.date.value = new Date().toLocaleDateString('sv-SE');
    form.elements.account.value = 'Conta sincronizada';
    form.requestSubmit();
    document.querySelector('#openSync').click();
    document.querySelector('#syncNow').click();
    return true;
  })()`);
  await retry(async () => { if (!await first.devTools.evaluate("document.querySelector('#syncDot').classList.contains('connected')")) throw new Error("Primeiro navegador ainda sincronizando"); });

  const recoveryText = await first.devTools.evaluate(`(async () => {
    let recoveryBlob;
    const createObjectURL = URL.createObjectURL;
    const revokeObjectURL = URL.revokeObjectURL;
    const click = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = blob => { recoveryBlob = blob; return 'blob:contaai-recovery-test'; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = () => {};
    document.querySelector('#downloadRecovery').click();
    const content = await recoveryBlob.text();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    HTMLAnchorElement.prototype.click = click;
    return content;
  })()`);
  const recovery = JSON.parse(recoveryText);
  assert(recovery.vaultCode?.replace(/-/g, "") === secret && recovery.transactions.some(item => item.title === "Compartilhado entre navegadores"), "O arquivo de recuperação não preservou o cofre e os dados");

  second = await openBrowser(appUrl);
  await second.devTools.evaluate(`(() => {
    localStorage.clear();
    const input = document.querySelector('#restoreInput');
    const transfer = new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(recoveryText)}], 'recuperacao-contaai.json', { type: 'application/json' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await retry(async () => {
    const result = await second.devTools.evaluate(`({ connected: document.querySelector('#syncDot').classList.contains('connected'), text: document.querySelector('#allTransactions').textContent })`);
    if (!result.connected || !result.text.includes("Compartilhado entre navegadores")) throw new Error("Dados ainda não chegaram ao segundo navegador");
  });

  await second.devTools.evaluate(`(() => {
    document.querySelector('#syncModal .close-modal').click();
    const saved = JSON.parse(localStorage.getItem('contaai-transactions-v2'));
    document.querySelector('[data-delete="' + saved[0].id + '"]').click();
    document.querySelector('#openSync').click();
    document.querySelector('#syncNow').click();
    return true;
  })()`);
  await retry(async () => { if (!await second.devTools.evaluate("document.querySelector('#syncDot').classList.contains('connected')")) throw new Error("Exclusão ainda não foi sincronizada"); });
  await first.devTools.evaluate("document.querySelector('#syncNow').click(); true");
  await retry(async () => {
    const count = await first.devTools.evaluate("JSON.parse(localStorage.getItem('contaai-transactions-v2') || '[]').length");
    if (count !== 0) throw new Error("Exclusão ainda não chegou ao primeiro navegador");
  });
  assert(first.devTools.exceptions.length === 0 && second.devTools.exceptions.length === 0, `Erros de JavaScript: ${[...first.devTools.exceptions, ...second.devTools.exceptions].join(" | ")}`);
  process.stdout.write("✓ Navegadores: criação, conexão, envio e exclusão sincronizados\n");
} finally {
  await closeBrowser(second);
  await closeBrowser(first);
  if (worker) {
    await stopProcess(worker);
    await retry(() => rm(resolve(projectRoot, ".wrangler"), { recursive: true, force: true }), 8000).catch(() => {});
    await retry(() => rm(resolve(projectRoot, ".dist"), { recursive: true, force: true }), 8000).catch(() => {});
  }
}
