(() => {
  "use strict";

  const STORAGE_KEY = "contaai-transactions-v2";
  const GOALS_KEY = "contaai-goals-v2";
  const CATEGORIES_KEY = "contaai-categories-v1";
  const BUDGETS_KEY = "contaai-budgets-v1";
  const TOMBSTONES_KEY = "contaai-tombstones-v1";
  const SYNC_SECRET_KEY = "contaai-sync-secret-v1";
  const UI_STATE_KEY = "contaai-ui-state-v1";
  const THEME_KEY = "meu-dinheiro-static-theme";
  const SYNC_API_PATH = "/api/sync";
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const shortMoney = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
  const colors = { Moradia: "#106EBE", Alimentação: "#08B98C", Transporte: "#398ED3", Lazer: "#0DD8A6", Saúde: "#0B5B9B", Educação: "#51A5E6", Assinaturas: "#08A77F", Compras: "#287FCA", Salário: "#08B98C", Freelance: "#106EBE", Investimentos: "#0CD9A7", Outros: "#6C9FC9" };
  const defaultCategories = [
    ...["Moradia", "Alimentação", "Transporte", "Lazer", "Saúde", "Educação", "Assinaturas", "Compras"].map(name => ({ name, type: "expense", color: colors[name] })),
    ...["Salário", "Freelance", "Investimentos"].map(name => ({ name, type: "income", color: colors[name] })),
    { name: "Outros", type: "both", color: colors.Outros }
  ];
  const customColors = ["#106EBE", "#0FFCBE", "#398ED3", "#08B98C", "#0B5B9B", "#51A5E6", "#0DD8A6", "#287FCA"];
  const goalColors = ["#106EBE", "#08B98C", "#398ED3", "#0DD8A6"];
  const icon = (name, className = "") => `<svg class="icon ${className}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
  const icons = { balance: icon("wallet"), income: icon("arrow-up-right"), expense: icon("arrow-down-right"), savings: icon("piggy-bank") };

  const pad = value => String(value).padStart(2, "0");
  const toISO = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const parseDate = value => { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day); };
  const monthKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  const uid = () => window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const escapeHTML = value => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const safeColor = (value, fallback = colors.Outros) => /^#[\da-f]{6}$/i.test(String(value || "")) ? String(value) : fallback;
  const defaultCategoryId = name => `default-${name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, "-")}`;
  let logicalTime = Date.now();
  const nextTimestamp = () => logicalTime = Math.max(logicalTime + 1, Date.now());

  function parseMoney(value) {
    const raw = String(value ?? "").trim().replace(/\s|R\$/gi, "");
    if (!raw || /[^\d.,]/.test(raw)) return NaN;

    const comma = raw.lastIndexOf(",");
    const dot = raw.lastIndexOf(".");
    let normalized = raw;

    if (comma >= 0 && dot >= 0) {
      const decimalSeparator = comma > dot ? "," : ".";
      const groupingSeparator = decimalSeparator === "," ? "." : ",";
      normalized = raw.split(groupingSeparator).join("");
      const decimalIndex = normalized.lastIndexOf(decimalSeparator);
      normalized = `${normalized.slice(0, decimalIndex).split(decimalSeparator).join("")}.${normalized.slice(decimalIndex + 1)}`;
    } else if (comma >= 0 || dot >= 0) {
      const separator = comma >= 0 ? "," : ".";
      const parts = raw.split(separator);
      const hasValidGroups = parts.slice(1).every(part => part.length === 3);
      if (parts.length > 1 && hasValidGroups) normalized = parts.join("");
      else {
        const decimals = parts.pop();
        const integerGroups = parts;
        const validIntegerGroups = integerGroups.length === 1 || integerGroups.slice(1).every(part => part.length === 3);
        normalized = validIntegerGroups && decimals.length <= 2 ? `${integerGroups.join("")}.${decimals}` : "";
      }
    }

    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return NaN;
    return Number(normalized);
  }

  function formatMoneyValue(value, finalize = false, dotsAreGrouping = false) {
    const raw = String(value ?? "").replace(/[^\d.,]/g, "");
    if (!raw) return "";

    const lastComma = raw.lastIndexOf(",");
    const lastDot = raw.lastIndexOf(".");
    let decimalIndex = -1;

    if (lastComma >= 0 && lastDot >= 0) decimalIndex = Math.max(lastComma, lastDot);
    else {
      const separatorIndex = Math.max(lastComma, lastDot);
      const digitsAfterSeparator = separatorIndex >= 0 ? raw.length - separatorIndex - 1 : 0;
      if (separatorIndex >= 0 && digitsAfterSeparator <= 2 && !(dotsAreGrouping && lastDot >= 0)) decimalIndex = separatorIndex;
    }

    let integerDigits = (decimalIndex >= 0 ? raw.slice(0, decimalIndex) : raw).replace(/\D/g, "");
    if (!integerDigits) integerDigits = "0";
    integerDigits = integerDigits.replace(/^0+(?=\d)/, "");
    const groupedInteger = integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const decimals = decimalIndex >= 0 ? raw.slice(decimalIndex + 1).replace(/\D/g, "").slice(0, 2) : "";

    if (decimalIndex >= 0) return `${groupedInteger},${finalize ? decimals.padEnd(2, "0") : decimals}`;
    return finalize ? `${groupedInteger},00` : groupedInteger;
  }

  function formatMoneyField(input, finalize = false, dotsAreGrouping = false) {
    const raw = input.value;
    const cursor = input.selectionStart ?? raw.length;
    const digitsAfterCursor = raw.slice(cursor).replace(/\D/g, "").length;
    const formatted = formatMoneyValue(raw, finalize, dotsAreGrouping);
    input.value = formatted;
    input.dataset.moneyFormatted = formatted;

    if (document.activeElement !== input || finalize) return;
    let nextCursor = formatted.length;
    let remainingDigits = digitsAfterCursor;
    while (nextCursor > 0 && remainingDigits > 0) {
      nextCursor -= 1;
      if (/\d/.test(formatted[nextCursor])) remainingDigits -= 1;
    }
    input.setSelectionRange(nextCursor, nextCursor);
  }

  function storageGet(key) {
    try { return window.localStorage.getItem(key); }
    catch { return null; }
  }
  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); return true; }
    catch { return false; }
  }
  function storageRemove(key) {
    try { window.localStorage.removeItem(key); return true; }
    catch { return false; }
  }

  const loadedUI = load(UI_STATE_KEY, {});
  const savedUI = loadedUI && typeof loadedUI === "object" && !Array.isArray(loadedUI) ? loadedUI : {};
  const today = new Date();
  const savedAnchor = /^\d{4}-\d{2}-\d{2}$/.test(savedUI.anchor || "") ? parseDate(savedUI.anchor) : today;
  const state = {
    transactions: ensureArray(load(STORAGE_KEY, []), []),
    goals: ensureArray(load(GOALS_KEY, []), []),
    categories: ensureArray(load(CATEGORIES_KEY, defaultCategories), defaultCategories),
    budgets: ensureArray(load(BUDGETS_KEY, []), []),
    tombstones: ensureArray(load(TOMBSTONES_KEY, []), []),
    period: ["day", "week", "month", "year", "range"].includes(savedUI.period) ? savedUI.period : "month",
    anchor: savedAnchor,
    rangeStart: /^\d{4}-\d{2}-\d{2}$/.test(savedUI.rangeStart || "") ? savedUI.rangeStart : toISO(new Date(today.getFullYear(), today.getMonth(), 1)),
    rangeEnd: /^\d{4}-\d{2}-\d{2}$/.test(savedUI.rangeEnd || "") ? savedUI.rangeEnd : toISO(today),
    search: typeof savedUI.search === "string" ? savedUI.search : "",
    typeFilter: ["all", "expense", "income"].includes(savedUI.typeFilter) ? savedUI.typeFilter : "all",
    categoryFilter: typeof savedUI.categoryFilter === "string" ? savedUI.categoryFilter : "all",
    view: ["dashboard", "transactions", "recurring", "budgets", "goals"].includes(savedUI.view) ? savedUI.view : "dashboard",
    transactionType: ["expense", "income"].includes(savedUI.transactionType) ? savedUI.transactionType : "expense"
  };
  state.transactions = state.transactions.filter(item => item && typeof item === "object")
    .map(item => ({
      ...item,
      id: typeof item.id === "string" && item.id ? item.id : uid(),
      title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : "Lançamento",
      amount: Number(item.amount),
      type: item.type === "income" ? "income" : "expense",
      category: typeof item.category === "string" && item.category ? item.category : "Outros",
      date: /^\d{4}-\d{2}-\d{2}$/.test(item.date || "") ? item.date : toISO(today),
      account: typeof item.account === "string" && item.account ? item.account : "Não informada",
      note: typeof item.note === "string" ? item.note : "",
      recurring: Boolean(item.recurring),
      paid: typeof item.paid === "boolean" ? item.paid : true,
      updatedAt: Number.isFinite(Number(item.updatedAt)) ? Number(item.updatedAt) : nextTimestamp()
    }))
    .filter(item => Number.isFinite(item.amount) && item.amount > 0);
  state.categories = state.categories
    .filter(category => typeof category === "string" || (category && typeof category === "object"))
    .map(category => typeof category === "string" ? { name: category, type: "both" } : category)
    .filter(category => typeof category.name === "string" && category.name.trim())
    .map((category, index) => ({
      ...category,
      id: typeof category.id === "string" && category.id ? category.id : defaultCategories.some(item => item.name === category.name.trim()) ? defaultCategoryId(category.name.trim()) : uid(),
      name: category.name.trim(),
      type: ["expense", "income", "both"].includes(category.type) ? category.type : "both",
      color: colors[category.name] || safeColor(category.color, customColors[index % customColors.length]),
      updatedAt: Number.isFinite(Number(category.updatedAt)) ? Number(category.updatedAt) : defaultCategories.some(item => item.name === category.name.trim()) ? 0 : nextTimestamp()
    }));
  if (!state.categories.length) state.categories = defaultCategories.map(category => ({ ...category }));
  state.goals = state.goals.filter(goal => goal && typeof goal === "object")
    .map((goal, index) => ({ ...goal, id: typeof goal.id === "string" && goal.id ? goal.id : uid(), title: String(goal.title || "").trim(), target: Number(goal.target), saved: Number(goal.saved), color: safeColor(goal.color, goalColors[index % goalColors.length]), updatedAt: Number.isFinite(Number(goal.updatedAt)) ? Number(goal.updatedAt) : nextTimestamp() }))
    .filter(goal => goal.title && goal.target > 0 && goal.saved >= 0);
  state.budgets = state.budgets.filter(budget => budget && typeof budget === "object")
    .map(budget => ({ ...budget, id: typeof budget.id === "string" && budget.id ? budget.id : uid(), category: String(budget.category || "").trim(), limit: Number(budget.limit), updatedAt: Number.isFinite(Number(budget.updatedAt)) ? Number(budget.updatedAt) : nextTimestamp() }))
    .filter(budget => budget.category && Number.isFinite(budget.limit) && budget.limit > 0)
    .filter((budget, index, items) => items.findIndex(item => item.category.localeCompare(budget.category, "pt-BR", { sensitivity: "base" }) === 0) === index);
  state.tombstones = state.tombstones.filter(item => item && ["transactions", "goals", "budgets", "categories"].includes(item.collection) && typeof item.id === "string" && Number.isFinite(Number(item.deletedAt)))
    .map(item => ({ collection: item.collection, id: item.id, deletedAt: Number(item.deletedAt) }));
  logicalTime = Math.max(logicalTime, ...state.transactions.map(item => item.updatedAt), ...state.goals.map(item => item.updatedAt), ...state.budgets.map(item => item.updatedAt), ...state.categories.map(item => item.updatedAt), ...state.tombstones.map(item => item.deletedAt));
  state.categories.forEach(category => { colors[category.name] = category.color || colors.Outros; });
  const syncRuntime = {
    secret: normalizeVaultSecret(storageGet(SYNC_SECRET_KEY) || ""),
    keys: null,
    busy: false,
    applyingRemote: false,
    timer: null,
    lastSynced: null,
    error: ""
  };

  function load(key, fallback) {
    try { const value = storageGet(key); return value ? JSON.parse(value) : fallback; }
    catch { return fallback; }
  }
  function ensureArray(value, fallback) { return Array.isArray(value) ? value : fallback; }
  function save() {
    const transactionsSaved = storageSet(STORAGE_KEY, JSON.stringify(state.transactions));
    const goalsSaved = storageSet(GOALS_KEY, JSON.stringify(state.goals));
    const categoriesSaved = storageSet(CATEGORIES_KEY, JSON.stringify(state.categories));
    const budgetsSaved = storageSet(BUDGETS_KEY, JSON.stringify(state.budgets));
    const tombstonesSaved = storageSet(TOMBSTONES_KEY, JSON.stringify(state.tombstones));
    if (syncRuntime.secret && !syncRuntime.applyingRemote) scheduleSync();
    return transactionsSaved && goalsSaved && categoriesSaved && budgetsSaved && tombstonesSaved;
  }
  function saveUI(overrides = {}) {
    return storageSet(UI_STATE_KEY, JSON.stringify({
      view: state.view,
      period: state.period,
      anchor: toISO(state.anchor),
      rangeStart: state.rangeStart,
      rangeEnd: state.rangeEnd,
      search: state.search,
      typeFilter: state.typeFilter,
      categoryFilter: state.categoryFilter,
      transactionType: state.transactionType,
      scrollY: Math.round(window.scrollY),
      ...overrides
    }));
  }
  function normalizeVaultSecret(value) {
    const normalized = String(value || "").toUpperCase().replace(/[^A-F0-9]/g, "");
    return normalized.length === 32 ? normalized : "";
  }
  function formatVaultSecret(secret) { return normalizeVaultSecret(secret).match(/.{1,4}/g)?.join("-") || ""; }
  function generateVaultSecret() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  function bytesToBase64(bytes) {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  function base64ToBytes(value) {
    const base64 = String(value).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(value).length / 4) * 4, "=");
    return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  }
  async function sha256(value) { return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))); }
  async function deriveVaultKeys(secret) {
    const normalized = normalizeVaultSecret(secret);
    if (!normalized) throw new Error("Digite um código de cofre válido.");
    const [idBytes, writeBytes, encryptionBytes] = await Promise.all([sha256(`contaai:id:${normalized}`), sha256(`contaai:write:${normalized}`), sha256(`contaai:encryption:${normalized}`)]);
    return {
      id: [...idBytes].map(byte => byte.toString(16).padStart(2, "0")).join(""),
      writeKey: [...writeBytes].map(byte => byte.toString(16).padStart(2, "0")).join(""),
      encryptionKey: await crypto.subtle.importKey("raw", encryptionBytes, "AES-GCM", false, ["encrypt", "decrypt"])
    };
  }
  async function encryptDocument(documentValue, keys) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(documentValue));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(keys.id) }, keys.encryptionKey, plaintext);
    return { version: 1, iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(ciphertext)) };
  }
  async function decryptDocument(payload, keys) {
    try {
      if (!payload || payload.version !== 1 || typeof payload.iv !== "string" || typeof payload.data !== "string") throw new Error();
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(payload.iv), additionalData: new TextEncoder().encode(keys.id) }, keys.encryptionKey, base64ToBytes(payload.data));
      const documentValue = JSON.parse(new TextDecoder().decode(plaintext));
      if (!documentValue || documentValue.version !== 1) throw new Error();
      return documentValue;
    } catch {
      throw new Error("Não foi possível abrir este cofre. Confira o código informado.");
    }
  }
  function syncApiUrl(vaultId = "") {
    const configured = document.querySelector('meta[name="quanto-tem-sync-url"]')?.content || document.querySelector('meta[name="contaai-sync-url"]')?.content || SYNC_API_PATH;
    const base = new URL(configured, window.location.href).toString().replace(/\/$/, "");
    return vaultId ? `${base}/${vaultId}` : base;
  }
  async function vaultRequest(keys, options = {}) {
    const response = await fetch(syncApiUrl(keys.id), { cache: "no-store", ...options, headers: { Accept: "application/json", ...(options.headers || {}) } });
    const isSyncService = response.headers.get("X-Contaai-Sync") === "1";
    if (!isSyncService) throw new Error("A sincronização ainda não está publicada neste endereço.");
    const body = await response.json().catch(() => ({}));
    if (response.status === 404) return null;
    if (!response.ok && response.status !== 409) throw new Error(body.error || "O cofre não respondeu. Tente novamente.");
    return { status: response.status, ...body };
  }
  function syncDocument() {
    return {
      version: 1,
      updatedAt: Math.max(0, ...state.transactions.map(item => item.updatedAt), ...state.goals.map(item => item.updatedAt), ...state.budgets.map(item => item.updatedAt), ...state.categories.map(item => item.updatedAt), ...state.tombstones.map(item => item.deletedAt)),
      transactions: state.transactions.map(item => ({ ...item })),
      goals: state.goals.map(item => ({ ...item })),
      budgets: state.budgets.map(item => ({ ...item })),
      categories: state.categories.map(item => ({ ...item })),
      tombstones: state.tombstones.map(item => ({ ...item }))
    };
  }
  function normalizeRemoteDocument(documentValue) {
    const safe = documentValue && typeof documentValue === "object" ? documentValue : {};
    return {
      version: 1,
      updatedAt: Number(safe.updatedAt) || 0,
      transactions: ensureArray(safe.transactions, []).filter(item => item && typeof item.id === "string").map(item => ({ ...item, updatedAt: Number(item.updatedAt) || 0 })),
      goals: ensureArray(safe.goals, []).filter(item => item && typeof item.id === "string").map((item, index) => ({ ...item, color: safeColor(item.color, goalColors[index % goalColors.length]), updatedAt: Number(item.updatedAt) || 0 })),
      budgets: ensureArray(safe.budgets, []).filter(item => item && typeof item.id === "string").map(item => ({ ...item, updatedAt: Number(item.updatedAt) || 0 })),
      categories: ensureArray(safe.categories, []).filter(item => item && typeof item.id === "string").map((item, index) => ({ ...item, color: safeColor(item.color, customColors[index % customColors.length]), updatedAt: Number(item.updatedAt) || 0 })),
      tombstones: ensureArray(safe.tombstones, []).filter(item => item && typeof item.id === "string" && ["transactions", "goals", "budgets", "categories"].includes(item.collection)).map(item => ({ collection: item.collection, id: item.id, deletedAt: Number(item.deletedAt) || 0 }))
    };
  }
  function mergeSyncDocuments(first, second) {
    const local = normalizeRemoteDocument(first);
    const remote = normalizeRemoteDocument(second);
    const tombstoneMap = new Map();
    [...local.tombstones, ...remote.tombstones].forEach(item => {
      const key = `${item.collection}:${item.id}`;
      if (!tombstoneMap.has(key) || tombstoneMap.get(key).deletedAt < item.deletedAt) tombstoneMap.set(key, item);
    });
    const tombstones = [...tombstoneMap.values()];
    const mergeCollection = collection => {
      const items = new Map();
      [...local[collection], ...remote[collection]].forEach(item => {
        const current = items.get(item.id);
        if (!current || Number(current.updatedAt) <= Number(item.updatedAt)) items.set(item.id, item);
      });
      return [...items.values()].filter(item => (tombstoneMap.get(`${collection}:${item.id}`)?.deletedAt || -1) < Number(item.updatedAt));
    };
    const categoriesByName = new Map();
    mergeCollection("categories").forEach(category => {
      const key = category.name.toLocaleLowerCase("pt-BR");
      const current = categoriesByName.get(key);
      if (!current || current.updatedAt <= category.updatedAt) categoriesByName.set(key, category);
    });
    const budgetsByCategory = new Map();
    mergeCollection("budgets").forEach(budget => {
      const key = budget.category.toLocaleLowerCase("pt-BR");
      const current = budgetsByCategory.get(key);
      if (!current || current.updatedAt <= budget.updatedAt) budgetsByCategory.set(key, budget);
    });
    const merged = {
      version: 1,
      transactions: mergeCollection("transactions"),
      goals: mergeCollection("goals"),
      budgets: [...budgetsByCategory.values()],
      categories: [...categoriesByName.values()],
      tombstones
    };
    merged.updatedAt = Math.max(local.updatedAt, remote.updatedAt, ...merged.transactions.map(item => item.updatedAt), ...merged.goals.map(item => item.updatedAt), ...merged.budgets.map(item => item.updatedAt), ...merged.categories.map(item => item.updatedAt), ...tombstones.map(item => item.deletedAt));
    return merged;
  }
  function comparableDocument(documentValue) {
    const normalized = normalizeRemoteDocument(documentValue);
    ["transactions", "goals", "budgets", "categories"].forEach(collection => normalized[collection].sort((a, b) => a.id.localeCompare(b.id)));
    normalized.tombstones.sort((a, b) => `${a.collection}:${a.id}`.localeCompare(`${b.collection}:${b.id}`));
    return JSON.stringify(normalized);
  }
  function applySyncDocument(documentValue) {
    const merged = normalizeRemoteDocument(documentValue);
    syncRuntime.applyingRemote = true;
    state.transactions = merged.transactions;
    state.goals = merged.goals;
    state.budgets = merged.budgets;
    state.categories = merged.categories.length ? merged.categories : defaultCategories.map(category => ({ ...category, id: defaultCategoryId(category.name), updatedAt: 0 }));
    state.tombstones = merged.tombstones;
    Object.keys(colors).forEach(name => { if (!defaultCategories.some(category => category.name === name)) delete colors[name]; });
    state.categories.forEach(category => { colors[category.name] = category.color || colors.Outros; });
    logicalTime = Math.max(logicalTime, merged.updatedAt);
    save();
    syncRuntime.applyingRemote = false;
    render();
  }
  async function uploadVault(keys, documentValue, baseRevision) {
    const payload = await encryptDocument(documentValue, keys);
    return vaultRequest(keys, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Contaai-Key": keys.writeKey },
      body: JSON.stringify({ baseRevision, payload })
    });
  }
  async function performSync({ secret = syncRuntime.secret, requireExisting = false } = {}) {
    if (syncRuntime.busy) return false;
    if (!navigator.onLine) throw new Error("Sem internet. Os dados continuam seguros neste navegador.");
    const normalizedSecret = normalizeVaultSecret(secret);
    if (!normalizedSecret) throw new Error("Digite um código de cofre válido.");
    syncRuntime.busy = true;
    syncRuntime.error = "";
    renderSyncUI();
    try {
      const keys = syncRuntime.keys && normalizedSecret === syncRuntime.secret ? syncRuntime.keys : await deriveVaultKeys(normalizedSecret);
      let remoteEnvelope = await vaultRequest(keys);
      if (!remoteEnvelope && requireExisting) throw new Error("Cofre não encontrado. Confira o código e tente novamente.");
      let merged = syncDocument();
      let remoteDocument = null;
      let revision = 0;
      if (remoteEnvelope) {
        remoteDocument = await decryptDocument(remoteEnvelope.payload, keys);
        merged = mergeSyncDocuments(merged, remoteDocument);
        revision = Number(remoteEnvelope.revision) || 0;
      }
      if (comparableDocument(merged) !== comparableDocument(syncDocument())) applySyncDocument(merged);

      let needsUpload = !remoteDocument || comparableDocument(merged) !== comparableDocument(remoteDocument);
      for (let attempt = 0; needsUpload && attempt < 3; attempt += 1) {
        const result = await uploadVault(keys, merged, revision);
        if (result.status !== 409) { revision = Number(result.revision) || revision + 1; needsUpload = false; break; }
        remoteDocument = await decryptDocument(result.payload, keys);
        revision = Number(result.revision) || revision;
        merged = mergeSyncDocuments(merged, remoteDocument);
        if (comparableDocument(merged) !== comparableDocument(syncDocument())) applySyncDocument(merged);
      }
      if (needsUpload) throw new Error("Houve muitas alterações ao mesmo tempo. Tente sincronizar novamente.");
      syncRuntime.secret = normalizedSecret;
      syncRuntime.keys = keys;
      syncRuntime.lastSynced = new Date();
      syncRuntime.applyingRemote = true;
      save();
      syncRuntime.applyingRemote = false;
      storageSet(SYNC_SECRET_KEY, normalizedSecret);
      return true;
    } catch (error) {
      syncRuntime.error = error?.message || "Não foi possível sincronizar agora.";
      throw error;
    } finally {
      syncRuntime.busy = false;
      renderSyncUI();
    }
  }
  function scheduleSync(delay = 1200) {
    if (!syncRuntime.secret) return;
    clearTimeout(syncRuntime.timer);
    syncRuntime.timer = setTimeout(() => performSync().catch(() => {}), delay);
  }
  function recordDeletion(collection, id) {
    const deletedAt = nextTimestamp();
    state.tombstones = state.tombstones.filter(item => !(item.collection === collection && item.id === id));
    state.tombstones.push({ collection, id, deletedAt });
  }
  function renderSyncUI() {
    const connected = Boolean(syncRuntime.secret);
    document.querySelector("#syncDisconnected").classList.toggle("hidden", connected);
    document.querySelector("#syncConnected").classList.toggle("hidden", !connected);
    document.querySelector("#syncSidebarTitle").textContent = connected ? "Cofre sincronizado" : "Dados neste navegador";
    document.querySelector("#syncSidebarText").textContent = connected ? syncRuntime.error ? "Seus dados locais estão seguros. Abra para tentar novamente." : "Alterações são protegidas e compartilhadas com seus dispositivos." : "Ative o cofre para usar os mesmos dados nos seus outros navegadores.";
    document.querySelector("#openSync span").textContent = connected ? "Ver sincronização" : "Ativar sincronização";
    const dot = document.querySelector("#syncDot");
    dot.className = syncRuntime.busy ? "syncing" : connected ? (syncRuntime.error ? "error" : "connected") : "";
    if (!connected) return;
    document.querySelector("#vaultCode").textContent = formatVaultSecret(syncRuntime.secret);
    const title = document.querySelector("#syncStatusTitle");
    const text = document.querySelector("#syncStatusText");
    const card = document.querySelector(".sync-status-card");
    card.classList.toggle("sync-error", Boolean(syncRuntime.error));
    if (syncRuntime.busy) { title.textContent = "Sincronizando…"; text.textContent = "Protegendo e comparando as alterações dos seus dispositivos."; }
    else if (syncRuntime.error) { title.textContent = "Sincronização pendente"; text.textContent = syncRuntime.error; }
    else if (!navigator.onLine) { title.textContent = "Você está offline"; text.textContent = "Pode continuar usando o app; enviaremos as mudanças quando a conexão voltar."; }
    else { title.textContent = "Cofre conectado"; text.textContent = syncRuntime.lastSynced ? `Tudo certo · sincronizado às ${syncRuntime.lastSynced.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "A sincronização automática está ativa neste navegador."; }
  }
  async function copyText(value) {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return; }
    const input = document.createElement("textarea"); input.value = value; input.style.position = "fixed"; input.style.opacity = "0"; document.body.appendChild(input); input.select(); document.execCommand("copy"); input.remove();
  }
  function inPeriod(date, period, anchor) {
    if (period === "range") return date >= parseDate(state.rangeStart) && date <= parseDate(state.rangeEnd);
    if (period === "day") return date.toDateString() === anchor.toDateString();
    if (period === "week") {
      const start = new Date(anchor); start.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7)); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(start.getDate() + 7);
      return date >= start && date < end;
    }
    if (period === "month") return date.getMonth() === anchor.getMonth() && date.getFullYear() === anchor.getFullYear();
    return date.getFullYear() === anchor.getFullYear();
  }
  function isPostedTransaction(item) { return !item.recurring || item.paid; }
  function filteredTransactions() {
    const search = state.search.toLocaleLowerCase("pt-BR");
    return state.transactions.filter(isPostedTransaction)
      .filter(item => inPeriod(parseDate(item.date), state.period, state.anchor))
      .filter(item => state.typeFilter === "all" || item.type === state.typeFilter)
      .filter(item => state.categoryFilter === "all" || item.category === state.categoryFilter)
      .filter(item => !search || `${item.title} ${item.category} ${item.account}`.toLocaleLowerCase("pt-BR").includes(search))
      .sort((a, b) => b.date.localeCompare(a.date) || Number(b.updatedAt) - Number(a.updatedAt) || b.id.localeCompare(a.id));
  }
  function revealTransaction(item) {
    const itemDate = parseDate(item.date);
    if (!inPeriod(itemDate, state.period, state.anchor)) {
      if (state.period === "range") {
        if (item.date < state.rangeStart) state.rangeStart = item.date;
        if (item.date > state.rangeEnd) state.rangeEnd = item.date;
      } else state.anchor = itemDate;
    }

    if (state.typeFilter !== "all" && state.typeFilter !== item.type) state.typeFilter = "all";
    if (state.categoryFilter !== "all" && state.categoryFilter !== item.category) state.categoryFilter = "all";
    const search = state.search.toLocaleLowerCase("pt-BR");
    const searchableText = `${item.title} ${item.category} ${item.account}`.toLocaleLowerCase("pt-BR");
    if (search && !searchableText.includes(search)) state.search = "";
  }
  function totals(items) {
    const income = items.filter(item => item.type === "income").reduce((sum, item) => sum + Number(item.amount), 0);
    const expenses = items.filter(item => item.type === "expense").reduce((sum, item) => sum + Number(item.amount), 0);
    return { income, expenses, balance: income - expenses, savings: income ? Math.max(0, Math.round((income - expenses) / income * 100)) : 0 };
  }
  function groups(items) {
    const grouped = {};
    items.filter(item => item.type === "expense").forEach(item => grouped[item.category] = (grouped[item.category] || 0) + Number(item.amount));
    return Object.entries(grouped).sort((a, b) => b[1] - a[1]);
  }

  function render() {
    const items = filteredTransactions();
    const total = totals(items);
    renderPeriodLabel();
    renderTabs();
    renderCategoryFilters();
    renderSummary(total, items);
    renderMonthlyChart();
    renderCategoryChart(groups(items), total.expenses);
    renderTransactions(items);
    renderInsights(groups(items), total);
    renderRecurring();
    renderBudgets();
    renderGoals();
    document.querySelectorAll(".search-input").forEach(input => { input.value = state.search; });
  }

  function renderPeriodLabel() {
    const options = state.period === "day" ? { day: "2-digit", month: "long", year: "numeric" } : state.period === "month" ? { month: "long", year: "numeric" } : null;
    let label;
    if (state.period === "range") {
      const compactDate = value => parseDate(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
      label = `${compactDate(state.rangeStart)} – ${compactDate(state.rangeEnd)}`;
    }
    else if (state.period === "week") label = `Semana de ${state.anchor.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}`;
    else if (state.period === "year") label = String(state.anchor.getFullYear());
    else label = state.anchor.toLocaleDateString("pt-BR", options);
    document.querySelector("#periodLabel").textContent = label;
    const viewingToday = inPeriod(new Date(), state.period, state.anchor);
    document.querySelector("#periodEyebrow").textContent = viewingToday ? "PERÍODO ATUAL" : "PERÍODO SELECIONADO";
    document.querySelector("#goToday").classList.toggle("hidden", viewingToday);
  }
  function renderTabs() {
    const labels = { day: "Dia", week: "Semana", month: "Mês", year: "Ano", range: "Datas" };
    const html = Object.entries(labels).map(([key, label]) => `<button class="${state.period === key ? "active" : ""}" data-period="${key}">${label}</button>`).join("");
    document.querySelectorAll(".period-tabs-slot").forEach(slot => slot.innerHTML = html);
    const rangeHTML = state.period === "range" ? `<div class="date-range"><label>De<input type="date" data-range-start value="${state.rangeStart}" max="${state.rangeEnd}"></label><span>até</span><label>Até<input type="date" data-range-end value="${state.rangeEnd}" min="${state.rangeStart}"></label></div>` : "";
    document.querySelectorAll(".date-range-slot").forEach(slot => slot.innerHTML = rangeHTML);
  }
  function renderCategoryFilters() {
    const categoryFilter = document.querySelector("#categoryFilter");
    const typeFilter = document.querySelector("#typeFilter");
    const names = [...new Set([...state.categories.map(category => category.name), ...state.transactions.map(item => item.category)])].sort((a, b) => a.localeCompare(b, "pt-BR"));
    categoryFilter.innerHTML = `<option value="all">Todas as categorias</option>${names.map(name => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join("")}`;
    categoryFilter.value = names.includes(state.categoryFilter) ? state.categoryFilter : "all";
    if (categoryFilter.value === "all") state.categoryFilter = "all";
    typeFilter.value = state.typeFilter;
  }
  function renderSummary(total, items) {
    const incomeCount = items.filter(item => item.type === "income").length;
    const expenseCount = items.filter(item => item.type === "expense").length;
    const cards = [
      ["Saldo do período", total.balance, "balance", items.length ? (total.balance >= 0 ? "Entradas menos despesas" : "Despesas acima das entradas") : (state.transactions.some(isPostedTransaction) ? "Sem movimentações neste filtro" : "Sem movimentações pagas")],
      ["Entradas", total.income, "income", incomeCount ? `${incomeCount} ${incomeCount === 1 ? "recebimento" : "recebimentos"}` : "Nenhuma entrada no período"],
      ["Despesas", total.expenses, "expense", expenseCount ? `${expenseCount} ${expenseCount === 1 ? "pagamento" : "pagamentos"}` : "Nenhuma despesa no período"],
      ["Taxa de economia", total.income ? total.savings : null, "savings", total.income ? "Percentual da renda preservado" : "Disponível após registrar renda"]
    ];
    const html = cards.map(([label, value, tone, detail]) => `<article class="summary-card ${tone}"><div class="summary-icon">${icons[tone]}</div><div class="summary-copy"><span>${label}</span><strong>${tone === "savings" ? (value === null ? "—" : `${value}%`) : money.format(value)}</strong><small>${detail}</small></div></article>`).join("");
    document.querySelectorAll(".summary-slot").forEach(slot => slot.innerHTML = html);
  }
  function renderMonthlyChart() {
    const chartItems = state.transactions
      .filter(isPostedTransaction)
      .filter(item => state.typeFilter === "all" || item.type === state.typeFilter)
      .filter(item => state.categoryFilter === "all" || item.category === state.categoryFilter);
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(state.anchor.getFullYear(), state.anchor.getMonth() - 5 + index, 1);
      const monthItems = chartItems.filter(item => item.date.startsWith(monthKey(date)));
      const total = totals(monthItems);
      return { label: date.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""), income: total.income, expense: total.expenses };
    });
    const target = document.querySelector("#monthlyChart");
    if (!months.some(month => month.income || month.expense)) {
      target.innerHTML = empty("O histórico aparecerá aqui", "Adicione entradas e despesas para acompanhar a evolução mensal.");
      return;
    }
    const width = 720, height = 236, left = 62, right = 18, top = 18, bottom = 38;
    const rawMaximum = Math.max(...months.flatMap(month => [month.income, month.expense]), 1);
    const magnitude = 10 ** Math.floor(Math.log10(rawMaximum));
    const maximum = Math.ceil(rawMaximum / magnitude) * magnitude;
    const chartWidth = width - left - right, chartHeight = height - top - bottom;
    const points = type => months.map((month, index) => ({ x: left + chartWidth * index / (months.length - 1), y: top + chartHeight * (1 - month[type] / maximum), value: month[type] }));
    const path = values => values.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
    const incomePoints = points("income"), expensePoints = points("expense");
    const area = `${path(incomePoints)} L${incomePoints[incomePoints.length - 1].x},${height - bottom} L${incomePoints[0].x},${height - bottom} Z`;
    const ticks = [1, .75, .5, .25, 0];
    target.innerHTML = `<svg class="trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Comparação de entradas e despesas dos últimos seis meses"><defs><linearGradient id="incomeArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0FFCBE" stop-opacity=".22"/><stop offset="1" stop-color="#0FFCBE" stop-opacity="0"/></linearGradient></defs>${ticks.map(tick => { const y = top + chartHeight * (1 - tick); return `<line class="chart-gridline" x1="${left}" x2="${width - right}" y1="${y}" y2="${y}"/><text class="axis-label" x="${left - 12}" y="${y + 3}" text-anchor="end">${shortMoney.format(maximum * tick)}</text>`; }).join("")}<path class="chart-area-fill" d="${area}"/><path class="chart-line expense-line" d="${path(expensePoints)}"/><path class="chart-line income-line" d="${path(incomePoints)}"/>${incomePoints.map((point, index) => `<g><circle class="chart-point income-point" cx="${point.x}" cy="${point.y}" r="4"><title>Entradas em ${months[index].label}: ${money.format(point.value)}</title></circle><text class="month-label" x="${point.x}" y="${height - 12}" text-anchor="middle">${months[index].label}</text></g>`).join("")}${expensePoints.map((point, index) => `<circle class="chart-point expense-point" cx="${point.x}" cy="${point.y}" r="4"><title>Despesas em ${months[index].label}: ${money.format(point.value)}</title></circle>`).join("")}</svg>`;
  }
  function renderCategoryChart(categoryGroups, total) {
    const target = document.querySelector("#categoryChart");
    if (!categoryGroups.length) { target.innerHTML = empty("Sem despesas no período", "As categorias serão exibidas depois do primeiro lançamento."); return; }
    const visibleGroups = categoryGroups.length > 5
      ? [...categoryGroups.slice(0, 4), ["Outras", categoryGroups.slice(4).reduce((sum, [, value]) => sum + value, 0)]]
      : categoryGroups;
    const circumference = 301.59;
    let offset = 0;
    const segments = visibleGroups.map(([category, value]) => { const length = value / total * circumference; const segment = `<circle class="donut-segment" cx="58" cy="58" r="48" fill="none" stroke="${colors[category] || colors.Outros}" stroke-width="12" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}"/>`; offset += length; return segment; }).join("");
    target.innerHTML = `<div class="category-content"><div class="donut-wrap"><svg class="donut" viewBox="0 0 116 116" role="img" aria-label="Distribuição das despesas por categoria"><circle class="donut-track" cx="58" cy="58" r="48" fill="none" stroke-width="12"/>${segments}</svg><div class="donut-total"><span>Total</span><strong>${shortMoney.format(total)}</strong></div></div><div class="category-list">${visibleGroups.map(([category, value]) => `<div><span><i style="background:${colors[category] || colors.Outros}"></i>${escapeHTML(category)}</span><strong>${Math.round(value / total * 100)}%</strong><small>${money.format(value)}</small></div>`).join("")}</div></div>`;
  }
  function transactionRow(item) {
    const sign = item.type === "income" ? "+" : "−";
    const id = escapeHTML(item.id);
    return `<div class="transaction-row"><div class="transaction-symbol" style="background:${colors[item.category] || colors.Outros}18;color:${colors[item.category] || colors.Outros}">${icon(item.type === "income" ? "arrow-up-right" : "arrow-down-right")}</div><div class="transaction-main"><strong>${escapeHTML(item.title)}</strong><span>${escapeHTML(item.category)} · ${escapeHTML(item.account)}</span></div><time>${parseDate(item.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}</time><span class="transaction-category">${escapeHTML(item.category)}</span><strong class="amount ${item.type === "income" ? "income-text" : "expense-text"}">${sign}${money.format(item.amount)}</strong><div class="transaction-actions"><button class="edit-button" data-edit="${id}" aria-label="Editar lançamento" title="Editar lançamento">${icon("edit")}</button><button class="delete-button" data-delete="${id}" aria-label="Excluir lançamento" title="Excluir lançamento">${icon("trash")}</button></div></div>`;
  }
  function renderTransactions(items) {
    const hasPendingFixedExpense = state.transactions.some(item => item.recurring && !item.paid);
    const emptyDetail = hasPendingFixedExpense && !state.transactions.some(isPostedTransaction) ? "Os gastos fixos pendentes aparecerão aqui depois que forem marcados como pagos." : state.transactions.length ? "Existem lançamentos salvos fora do período ou dos filtros selecionados." : "Registre uma entrada ou despesa para começar.";
    document.querySelector("#recentTransactions").innerHTML = items.length ? items.slice(0, 6).map(transactionRow).join("") : empty("Nenhum lançamento neste período.", emptyDetail);
    document.querySelector("#transactionCount").textContent = `${items.length} ${items.length === 1 ? "lançamento" : "lançamentos"}`;
    document.querySelector("#allTransactions").innerHTML = items.length ? `<div class="table-head"><span>Lançamento</span><span>Data</span><span>Categoria</span><span>Valor</span><span></span></div>${items.map(transactionRow).join("")}` : empty("Nenhum lançamento neste período.", emptyDetail);
  }
  function renderInsights(categoryGroups, total) {
    const top = categoryGroups[0];
    const target = document.querySelector("#insightsPanel");
    if (!total.income && !total.expenses) {
      target.innerHTML = `<div class="insights-title"><span>${icon("chart")}</span><div><small>RESUMO DO PERÍODO</small><h2>Comece pelos lançamentos</h2></div></div><div class="insight-empty"><p>Quando você registrar suas movimentações, verá aqui um resumo direto do período — sem estimativas inventadas.</p><button class="insight-action" data-open-transaction="expense">${icon("plus")} Adicionar lançamento</button></div>`;
      return;
    }
    const balance = total.balance;
    const expenseShare = total.income ? Math.round(total.expenses / total.income * 100) : null;
    const transactionCount = filteredTransactions().length;
    target.innerHTML = `<div class="insights-title"><span>${icon("chart")}</span><div><small>RESUMO DO PERÍODO</small><h2>Leitura dos seus números</h2></div></div><div class="insight-highlight"><span>Resultado do período</span><strong class="${balance < 0 ? "negative" : ""}">${money.format(balance)}</strong><small>Entradas menos despesas</small></div><div class="insight-list"><div><span class="insight-number">01</span><p><strong>${top ? `Maior gasto: ${escapeHTML(top[0])}` : "Nenhuma despesa"}</strong>${top ? `${money.format(top[1])}, equivalente a ${Math.round(top[1] / total.expenses * 100)}% das despesas.` : "Não houve saídas registradas neste período."}</p></div><div><span class="insight-number">02</span><p><strong>${expenseShare === null ? "Sem renda registrada" : `${expenseShare}% da renda foi utilizada`}</strong>${expenseShare === null ? "Adicione suas entradas para comparar renda e despesas." : `${money.format(total.expenses)} em despesas sobre ${money.format(total.income)} em entradas.`}</p></div><div><span class="insight-number">03</span><p><strong>${transactionCount} ${transactionCount === 1 ? "movimentação" : "movimentações"}</strong>Total considerado no filtro e período selecionados.</p></div></div><button data-scroll-categories>Ver categorias ${icon("arrow-right")}</button>`;
  }
  function renderRecurring() {
    const items = state.transactions.filter(item => item.recurring && item.type === "expense");
    const committed = items.reduce((sum, item) => sum + Number(item.amount), 0);
    const paid = items.filter(item => item.paid).reduce((sum, item) => sum + Number(item.amount), 0);
    document.querySelector("#fixedCount").textContent = items.length;
    document.querySelector("#fixedSummary").innerHTML = `<div><span>Comprometido no mês</span><strong>${money.format(committed)}</strong></div><div><span>Já pago</span><strong>${money.format(paid)}</strong></div><div><span>Falta pagar</span><strong>${money.format(committed - paid)}</strong></div><div class="fixed-progress"><span style="width:${committed ? paid / committed * 100 : 0}%"></span></div>`;
    document.querySelector("#recurringGrid").innerHTML = items.length ? items.map(item => { const id = escapeHTML(item.id); return `<div class="recurring-card ${item.paid ? "paid" : ""}"><div class="recurring-top"><span class="category-icon" style="color:${colors[item.category] || colors.Outros};background:${colors[item.category] || colors.Outros}18">${icon("repeat")}</span><div class="recurring-actions"><button class="edit-button" data-edit="${id}" aria-label="Editar gasto fixo" title="Editar gasto fixo">${icon("edit")}</button><button class="delete-button" data-delete="${id}" aria-label="Excluir gasto fixo" title="Excluir gasto fixo">${icon("trash")}</button></div></div><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.category)} · todo mês</small><b>${money.format(item.amount)}</b><label><input type="checkbox" data-toggle-paid="${id}" ${item.paid ? "checked" : ""}><span>${item.paid ? "Pago" : "Marcar como pago"}</span></label></div>`; }).join("") : empty("Nenhum gasto fixo cadastrado", "Cadastre uma despesa e marque-a como gasto fixo.");
  }
  function renderBudgets() {
    const month = monthKey(state.anchor);
    const monthLabel = state.anchor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const monthExpenses = state.transactions.filter(item => isPostedTransaction(item) && item.type === "expense" && item.date.startsWith(month));
    const spentByCategory = new Map(groups(monthExpenses));
    const planned = state.budgets.reduce((sum, budget) => sum + budget.limit, 0);
    const spent = state.budgets.reduce((sum, budget) => sum + (spentByCategory.get(budget.category) || 0), 0);
    const remaining = planned - spent;
    const summary = document.querySelector("#budgetSummary");
    summary.innerHTML = `<div><span>Planejado por mês</span><strong>${money.format(planned)}</strong><small>${state.budgets.length} ${state.budgets.length === 1 ? "categoria planejada" : "categorias planejadas"}</small></div><div><span>Gasto em ${escapeHTML(monthLabel)}</span><strong>${money.format(spent)}</strong><small>Somente categorias com orçamento</small></div><div><span>${remaining >= 0 ? "Ainda disponível" : "Acima do planejado"}</span><strong class="${remaining >= 0 ? "positive" : "negative"}">${money.format(Math.abs(remaining))}</strong><small>${planned ? `${Math.round(spent / planned * 100)}% do limite utilizado` : "Crie um limite para começar"}</small></div>`;

    const target = document.querySelector("#budgetGrid");
    target.innerHTML = state.budgets.length ? state.budgets.map(budget => {
      const spentAmount = spentByCategory.get(budget.category) || 0;
      const percentage = budget.limit ? Math.round(spentAmount / budget.limit * 100) : 0;
      const available = budget.limit - spentAmount;
      const color = percentage > 100 ? "var(--red)" : percentage >= 80 ? "#e2a641" : colors[budget.category] || colors.Outros;
      const id = escapeHTML(budget.id);
      return `<article class="budget-card"><div class="budget-card-head"><div class="budget-category"><span style="color:${colors[budget.category] || colors.Outros};background:${colors[budget.category] || colors.Outros}18">${icon("budget")}</span><div><small>ORÇAMENTO MENSAL</small><strong>${escapeHTML(budget.category)}</strong></div></div><div class="budget-actions"><button data-edit-budget="${id}" aria-label="Editar orçamento" title="Editar orçamento">${icon("edit")}</button><button class="delete-button" data-delete-budget="${id}" aria-label="Excluir orçamento" title="Excluir orçamento">${icon("trash")}</button></div></div><div class="budget-values"><div><span>Gasto no mês</span><strong>${money.format(spentAmount)}</strong></div><b>de ${money.format(budget.limit)}</b></div><div class="budget-progress"><span style="width:${Math.min(100, percentage)}%;background:${color}"></span></div><div class="budget-foot"><span>${percentage}% utilizado</span><span class="${available < 0 ? "warning" : ""}">${available >= 0 ? `${money.format(available)} disponíveis` : `${money.format(Math.abs(available))} acima`}</span></div></article>`;
    }).join("") : `<article class="panel full-panel budget-empty">${empty("Planeje seu primeiro orçamento", "Defina um limite mensal para uma categoria e acompanhe seus gastos sem planilhas.")}</article>`;
  }
  function renderGoals() {
    const target = document.querySelector("#goalsGrid");
    target.innerHTML = state.goals.length ? state.goals.map(goal => { const percentage = Math.min(100, Math.round(goal.saved / goal.target * 100)); const id = escapeHTML(goal.id); return `<article class="goal-card"><div class="goal-head"><span class="goal-icon" style="background:${goal.color}18;color:${goal.color}">${icon("target")}</span><div class="goal-actions"><button class="edit-button" data-edit-goal="${id}" aria-label="Editar meta" title="Editar meta">${icon("edit")}</button><button class="delete-button" data-delete-goal="${id}" aria-label="Excluir meta" title="Excluir meta">${icon("trash")}</button></div></div><span class="goal-label">OBJETIVO</span><h2>${escapeHTML(goal.title)}</h2><div class="goal-values"><strong>${money.format(goal.saved)}</strong><span>de ${money.format(goal.target)}</span></div><div class="goal-progress"><span style="width:${percentage}%;background:${goal.color}"></span></div><div class="goal-foot"><b>${percentage}% concluído</b><small>Faltam ${money.format(Math.max(0, goal.target - goal.saved))}</small></div><form class="deposit-form" data-goal="${id}"><input type="number" min="0.01" step="0.01" required placeholder="Valor a adicionar" aria-label="Valor a adicionar ao total guardado"><button>Adicionar valor</button></form></article>`; }).join("") : `<article class="panel full-panel">${empty("Crie sua primeira meta", "Defina um valor e acompanhe os aportes ao longo do tempo.")}</article>`;
  }
  function empty(text, detail = "Altere o período ou registre um novo lançamento.") { return `<div class="empty-state"><span>${icon("inbox")}</span><strong>${escapeHTML(text)}</strong><small>${escapeHTML(detail)}</small></div>`; }

  function activateView(view) {
    document.querySelectorAll(".view").forEach(section => section.classList.toggle("active", section.id === `${view}View`));
    document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.view === view));
  }
  function switchView(view) {
    state.view = view;
    if (view === "budgets") state.period = "month";
    activateView(view);
    if (view === "budgets") render();
    document.querySelector("#sidebar").classList.remove("open");
    document.querySelector("#scrim").classList.remove("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
    saveUI({ scrollY: 0 });
  }
  function openTransaction(type) {
    const form = document.querySelector("#transactionForm");
    form.reset();
    form.dataset.editingId = "";
    form.elements.amount.setCustomValidity("");
    form.elements.amount.dataset.moneyFormatted = "";
    form.elements.date.value = toISO(new Date());
    setTransactionType(type);
    updateTransactionModalHeading();
    saveUI();
    closeCategoryField();
    document.querySelector("#transactionModal").classList.remove("hidden");
    setTimeout(() => form.elements.title.focus(), 50);
  }
  function editTransaction(id) {
    const transaction = state.transactions.find(item => item.id === id);
    if (!transaction) { toast("Não foi possível encontrar este lançamento"); return; }

    const form = document.querySelector("#transactionForm");
    form.reset();
    form.dataset.editingId = transaction.id;
    form.elements.amount.setCustomValidity("");
    form.elements.title.value = transaction.title;
    form.elements.amount.value = formatMoneyValue(String(transaction.amount).replace(".", ","), true);
    form.elements.amount.dataset.moneyFormatted = form.elements.amount.value;
    form.elements.date.value = transaction.date;
    form.elements.account.value = transaction.account;
    form.elements.note.value = transaction.note || "";
    form.elements.recurring.checked = Boolean(transaction.recurring);
    form.elements.paid.checked = Boolean(transaction.paid);
    setTransactionType(transaction.type, transaction.category);
    updateTransactionModalHeading();
    saveUI();
    closeCategoryField();
    document.querySelector("#transactionModal").classList.remove("hidden");
    setTimeout(() => form.elements.title.focus(), 50);
  }
  function updateTransactionModalHeading() {
    const form = document.querySelector("#transactionForm");
    const editing = Boolean(form.dataset.editingId);
    document.querySelector("#transactionModalEyebrow").textContent = editing ? "EDITAR LANÇAMENTO" : "NOVO LANÇAMENTO";
    document.querySelector("#transactionModalTitle").textContent = editing ? "Editar lançamento" : state.transactionType === "income" ? "Registrar entrada" : "Registrar despesa";
    document.querySelector("#transactionSubmit").textContent = editing ? "Salvar alterações" : "Salvar lançamento";
  }
  function setTransactionType(type, selectedCategory = "") {
    const form = document.querySelector("#transactionForm");
    state.transactionType = type === "income" ? "income" : "expense";
    form.elements.type.value = state.transactionType;
    if (state.transactionType === "income") form.elements.recurring.checked = false;
    document.querySelector("#fixedField").classList.toggle("hidden", state.transactionType === "income");
    renderTransactionCategories(selectedCategory);
    syncRecurringFields();
    updateTransactionModalHeading();
  }
  function syncRecurringFields() {
    const form = document.querySelector("#transactionForm");
    const isRecurringExpense = state.transactionType === "expense" && form.elements.recurring.checked;
    document.querySelector("#paidField").classList.toggle("hidden", !isRecurringExpense);
  }
  function openGoal() {
    const form = document.querySelector("#goalForm");
    form.reset();
    form.dataset.editingId = "";
    updateGoalModalHeading();
    document.querySelector("#goalModal").classList.remove("hidden");
    setTimeout(() => form.elements.title.focus(), 50);
  }
  function editGoal(id) {
    const goal = state.goals.find(item => item.id === id);
    if (!goal) { toast("Não foi possível encontrar esta meta"); return; }

    const form = document.querySelector("#goalForm");
    form.reset();
    form.dataset.editingId = goal.id;
    form.elements.title.value = goal.title;
    form.elements.target.value = goal.target;
    form.elements.saved.value = goal.saved;
    updateGoalModalHeading();
    document.querySelector("#goalModal").classList.remove("hidden");
    setTimeout(() => form.elements.title.focus(), 50);
  }
  function updateGoalModalHeading() {
    const editing = Boolean(document.querySelector("#goalForm").dataset.editingId);
    document.querySelector("#goalModalEyebrow").textContent = editing ? "EDITAR OBJETIVO" : "NOVO OBJETIVO";
    document.querySelector("#goalModalTitle").textContent = editing ? "Editar meta" : "Crie uma meta";
    document.querySelector("#goalSubmit").textContent = editing ? "Salvar alterações" : "Criar meta";
  }
  function renderBudgetCategories(selected = "") {
    const categories = state.categories.filter(category => category.type === "expense" || category.type === "both");
    const select = document.querySelector("#budgetCategory");
    select.innerHTML = categories.map(category => `<option value="${escapeHTML(category.name)}">${escapeHTML(category.name)}</option>`).join("");
    if (selected && categories.some(category => category.name === selected)) select.value = selected;
  }
  function openBudget() {
    const form = document.querySelector("#budgetForm");
    form.reset();
    form.dataset.editingId = "";
    form.elements.limit.setCustomValidity("");
    form.elements.limit.dataset.moneyFormatted = "";
    renderBudgetCategories();
    updateBudgetModalHeading();
    document.querySelector("#budgetModal").classList.remove("hidden");
    setTimeout(() => form.elements.category.focus(), 50);
  }
  function editBudget(id) {
    const budget = state.budgets.find(item => item.id === id);
    if (!budget) { toast("Não foi possível encontrar este orçamento"); return; }
    const form = document.querySelector("#budgetForm");
    form.reset();
    form.dataset.editingId = budget.id;
    form.elements.limit.setCustomValidity("");
    form.elements.limit.value = formatMoneyValue(String(budget.limit).replace(".", ","), true);
    form.elements.limit.dataset.moneyFormatted = form.elements.limit.value;
    renderBudgetCategories(budget.category);
    updateBudgetModalHeading();
    document.querySelector("#budgetModal").classList.remove("hidden");
    setTimeout(() => form.elements.limit.focus(), 50);
  }
  function updateBudgetModalHeading() {
    const editing = Boolean(document.querySelector("#budgetForm").dataset.editingId);
    document.querySelector("#budgetModalEyebrow").textContent = editing ? "EDITAR ORÇAMENTO" : "NOVO ORÇAMENTO";
    document.querySelector("#budgetModalTitle").textContent = editing ? "Editar limite mensal" : "Planejar categoria";
    document.querySelector("#budgetSubmit").textContent = editing ? "Salvar alterações" : "Salvar orçamento";
  }
  function renderTransactionCategories(selected = "") {
    const allowed = state.categories.filter(category => category.type === state.transactionType || category.type === "both");
    const select = document.querySelector("#categorySelect");
    select.innerHTML = allowed.map(category => `<option value="${escapeHTML(category.name)}">${escapeHTML(category.name)}</option>`).join("");
    if (selected && allowed.some(category => category.name === selected)) select.value = selected;
  }
  function closeCategoryField() {
    document.querySelector("#categoryCreateField").classList.add("hidden");
    document.querySelector("#newCategoryName").value = "";
  }
  function createCategory() {
    const input = document.querySelector("#newCategoryName");
    const name = input.value.trim().replace(/\s+/g, " ");
    if (!name) { input.focus(); return; }
    const existing = state.categories.find(category => category.name.localeCompare(name, "pt-BR", { sensitivity: "base" }) === 0);
    if (existing) {
      if (existing.type !== state.transactionType && existing.type !== "both") { existing.type = "both"; existing.updatedAt = nextTimestamp(); }
      renderTransactionCategories(existing.name); save(); closeCategoryField(); toast("Categoria disponível para este lançamento"); return;
    }
    const color = customColors[state.categories.length % customColors.length];
    state.categories.push({ id: uid(), name, type: state.transactionType, color, updatedAt: nextTimestamp() });
    colors[name] = color;
    save(); renderTransactionCategories(name); renderCategoryFilters(); closeCategoryField(); toast("Categoria criada com sucesso");
  }
  function closeModals() { document.querySelectorAll(".modal-backdrop").forEach(modal => modal.classList.add("hidden")); }
  function toast(message) {
    const element = document.querySelector("#toast"); element.innerHTML = `<span>✓</span>${escapeHTML(message)}`; element.classList.remove("hidden");
    clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.add("hidden"), 2800);
  }
  function applyTheme(theme) {
    const isDark = theme === "dark";
    document.querySelector("#app").classList.toggle("dark", isDark);
    document.body.classList.toggle("dark", isDark);
    const button = document.querySelector("#themeBtn");
    button.setAttribute("aria-pressed", String(isDark));
    button.setAttribute("aria-label", isDark ? "Ativar tema claro" : "Ativar tema escuro");
    button.querySelector("use").setAttribute("href", isDark ? "#icon-sun" : "#icon-moon");
  }
  function download(content, filename, type) {
    const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
  }
  function recoveryBackup() {
    return {
      version: 4,
      exportedAt: new Date().toISOString(),
      sourceOrigin: window.location.origin,
      vaultCode: syncRuntime.secret ? formatVaultSecret(syncRuntime.secret) : null,
      transactions: state.transactions,
      goals: state.goals,
      budgets: state.budgets,
      categories: state.categories
    };
  }
  function downloadRecoveryBackup(prefix = "backup-quanto-tem") {
    download(JSON.stringify(recoveryBackup(), null, 2), `${prefix}-${toISO(new Date())}.json`, "application/json");
  }
  function exportCSV() {
    const rows = [["Data", "Tipo", "Descrição", "Categoria", "Conta", "Valor"], ...state.transactions.filter(isPostedTransaction).map(item => [item.date, item.type === "income" ? "Entrada" : "Despesa", item.title, item.category, item.account, Number(item.amount).toFixed(2)])];
    const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(";")).join("\n");
    download("\ufeff" + csv, `meu-dinheiro-${toISO(new Date())}.csv`, "text/csv;charset=utf-8"); toast("Planilha exportada");
  }

  document.addEventListener("click", event => {
    const button = event.target.closest("button"); if (!button) return;
    if (button.dataset.view) switchView(button.dataset.view);
    if (button.dataset.goView) switchView(button.dataset.goView);
    if (button.dataset.openTransaction) openTransaction(button.dataset.openTransaction);
    if (button.dataset.edit) editTransaction(button.dataset.edit);
    if (button.dataset.editGoal) editGoal(button.dataset.editGoal);
    if (button.dataset.editBudget) editBudget(button.dataset.editBudget);
    if (button.dataset.period) { state.period = button.dataset.period; render(); saveUI(); }
    if (button.id === "openCategoryField") { document.querySelector("#categoryCreateField").classList.remove("hidden"); setTimeout(() => document.querySelector("#newCategoryName").focus(), 0); }
    if (button.id === "cancelCategory") closeCategoryField();
    if (button.id === "saveCategory") createCategory();
    if (button.dataset.delete) { recordDeletion("transactions", button.dataset.delete); state.transactions = state.transactions.filter(item => item.id !== button.dataset.delete); save(); render(); toast("Lançamento excluído"); }
    if (button.dataset.deleteGoal) { recordDeletion("goals", button.dataset.deleteGoal); state.goals = state.goals.filter(goal => goal.id !== button.dataset.deleteGoal); save(); render(); toast("Meta excluída"); }
    if (button.dataset.deleteBudget) { recordDeletion("budgets", button.dataset.deleteBudget); state.budgets = state.budgets.filter(budget => budget.id !== button.dataset.deleteBudget); save(); render(); toast("Orçamento excluído"); }
    if (button.matches(".close-modal")) closeModals();
    if (button.matches(".export-btn")) exportCSV();
    if (button.hasAttribute("data-scroll-categories")) document.querySelector(".category-chart").scrollIntoView({ behavior: "smooth" });
  });
  document.addEventListener("change", event => {
    if (event.target.matches("[data-toggle-paid]")) {
      const paid = event.target.checked;
      state.transactions = state.transactions.map(item => item.id === event.target.dataset.togglePaid ? { ...item, paid, updatedAt: nextTimestamp() } : item);
      save(); render(); toast(paid ? "Pagamento confirmado e incluído no saldo" : "Pagamento desmarcado e removido do saldo");
    }
    if (event.target.id === "transactionTypeSelect") setTransactionType(event.target.value, document.querySelector("#categorySelect").value);
    if (event.target.matches("#transactionForm [name='recurring']")) syncRecurringFields();
    if (event.target.id === "typeFilter") { state.typeFilter = event.target.value; render(); saveUI(); }
    if (event.target.id === "categoryFilter") { state.categoryFilter = event.target.value; render(); saveUI(); }
    if (event.target.matches("[data-range-start]")) { if (!event.target.value) { render(); return; } state.rangeStart = event.target.value; if (state.rangeStart > state.rangeEnd) state.rangeEnd = state.rangeStart; render(); saveUI(); }
    if (event.target.matches("[data-range-end]")) { if (!event.target.value) { render(); return; } state.rangeEnd = event.target.value; if (state.rangeEnd < state.rangeStart) state.rangeStart = state.rangeEnd; render(); saveUI(); }
  });
  document.querySelector("#newCategoryName").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); createCategory(); } });
  document.querySelectorAll(".search-input").forEach(input => input.addEventListener("input", event => { state.search = event.target.value; document.querySelectorAll(".search-input").forEach(other => { if (other !== event.target) other.value = state.search; }); render(); saveUI(); }));
  document.querySelector("#transactionForm").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const amount = parseMoney(data.get("amount"));
    if (!Number.isFinite(amount) || amount <= 0) {
      form.elements.amount.setCustomValidity("Informe um valor maior que zero. Use, por exemplo, 1234,56.");
      form.elements.amount.reportValidity();
      form.elements.amount.focus();
      return;
    }

    form.elements.amount.setCustomValidity("");
    const type = data.get("type") === "income" ? "income" : "expense";
    state.transactionType = type;
    const recurring = type === "expense" && data.get("recurring") === "on";
    const paid = recurring ? data.get("paid") === "on" : true;
    const editingId = form.dataset.editingId;
    const editingIndex = editingId ? state.transactions.findIndex(item => item.id === editingId) : -1;
    if (editingId && editingIndex < 0) { closeModals(); toast("Não foi possível encontrar este lançamento"); return; }
    const previous = editingIndex >= 0 ? state.transactions[editingIndex] : {};
    const transaction = { ...previous, id: editingId || uid(), title: String(data.get("title") || "").trim(), amount, type, category: data.get("category"), date: data.get("date"), account: String(data.get("account") || "").trim(), note: String(data.get("note") || "").trim(), recurring, paid, updatedAt: nextTimestamp() };
    if (editingIndex >= 0) state.transactions[editingIndex] = transaction;
    else state.transactions.unshift(transaction);
    if (isPostedTransaction(transaction)) revealTransaction(transaction);
    const persisted = save();
    saveUI();
    closeModals();
    render();
    if (persisted) toast(editingIndex >= 0 ? "Lançamento atualizado com sucesso" : recurring && !paid ? "Gasto fixo cadastrado. Ele entrará no saldo quando for marcado como pago." : state.transactionType === "income" ? "Entrada registrada com sucesso" : "Despesa registrada com sucesso");
    else toast(`${editingIndex >= 0 ? "Lançamento atualizado" : "Lançamento registrado"} nesta sessão. O navegador bloqueou o armazenamento local.`);
  });
  const transactionAmountInput = document.querySelector("#transactionForm").elements.amount;
  transactionAmountInput.addEventListener("input", event => {
    event.currentTarget.setCustomValidity("");
    const previousValue = event.currentTarget.dataset.moneyFormatted || "";
    const deletingGroupedInteger = event.inputType?.startsWith("delete") && previousValue.includes(".") && !previousValue.includes(",");
    formatMoneyField(event.currentTarget, false, deletingGroupedInteger);
  });
  transactionAmountInput.addEventListener("blur", event => formatMoneyField(event.currentTarget, true));
  document.querySelector("#goalForm").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const editingId = form.dataset.editingId;
    const editingIndex = editingId ? state.goals.findIndex(goal => goal.id === editingId) : -1;
    if (editingId && editingIndex < 0) { closeModals(); toast("Não foi possível encontrar esta meta"); return; }
    const previous = editingIndex >= 0 ? state.goals[editingIndex] : {};
    const goal = { ...previous, id: editingId || uid(), title: String(data.get("title") || "").trim(), target: Number(data.get("target")), saved: Number(data.get("saved") || 0), color: safeColor(previous.color, goalColors[state.goals.length % goalColors.length]), updatedAt: nextTimestamp() };
    if (editingIndex >= 0) state.goals[editingIndex] = goal;
    else state.goals.push(goal);
    save(); closeModals(); form.reset(); render(); toast(editingIndex >= 0 ? "Meta atualizada com sucesso" : "Meta criada com sucesso");
  });
  document.querySelector("#goalsGrid").addEventListener("submit", event => {
    const form = event.target.closest(".deposit-form"); if (!form) return; event.preventDefault(); const amount = Number(form.querySelector("input").value); state.goals = state.goals.map(goal => goal.id === form.dataset.goal ? { ...goal, saved: Math.min(goal.target, goal.saved + amount), updatedAt: nextTimestamp() } : goal); save(); render(); toast("Valor adicionado ao total guardado");
  });
  document.querySelector("#budgetForm").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const limit = parseMoney(data.get("limit"));
    if (!Number.isFinite(limit) || limit <= 0) {
      form.elements.limit.setCustomValidity("Informe um limite maior que zero. Use, por exemplo, 500,00.");
      form.elements.limit.reportValidity();
      form.elements.limit.focus();
      return;
    }
    form.elements.limit.setCustomValidity("");
    const category = String(data.get("category") || "");
    const editingId = form.dataset.editingId;
    const editingIndex = editingId ? state.budgets.findIndex(budget => budget.id === editingId) : -1;
    const duplicate = state.budgets.find(budget => budget.id !== editingId && budget.category.localeCompare(category, "pt-BR", { sensitivity: "base" }) === 0);
    if (duplicate) {
      duplicate.limit = limit;
      duplicate.updatedAt = nextTimestamp();
      save(); closeModals(); render(); toast("Limite da categoria atualizado");
      return;
    }
    const previous = editingIndex >= 0 ? state.budgets[editingIndex] : {};
    const budget = { ...previous, id: editingId || uid(), category, limit, updatedAt: nextTimestamp() };
    if (editingIndex >= 0) state.budgets[editingIndex] = budget;
    else state.budgets.push(budget);
    save(); closeModals(); render(); toast(editingIndex >= 0 ? "Orçamento atualizado" : "Orçamento criado com sucesso");
  });
  const budgetLimitInput = document.querySelector("#budgetForm").elements.limit;
  budgetLimitInput.addEventListener("input", event => { event.currentTarget.setCustomValidity(""); formatMoneyField(event.currentTarget); });
  budgetLimitInput.addEventListener("blur", event => formatMoneyField(event.currentTarget, true));
  document.querySelector("#prevPeriod").addEventListener("click", () => movePeriod(-1));
  document.querySelector("#nextPeriod").addEventListener("click", () => movePeriod(1));
  document.querySelector("#goToday").addEventListener("click", () => {
    const currentDate = new Date();
    if (state.period === "range") {
      const start = parseDate(state.rangeStart), end = parseDate(state.rangeEnd);
      const span = Math.round((end - start) / 86400000) + 1;
      const newStart = new Date(currentDate);
      newStart.setDate(currentDate.getDate() - span + 1);
      state.rangeStart = toISO(newStart);
      state.rangeEnd = toISO(currentDate);
    } else state.anchor = currentDate;
    render();
    saveUI();
  });
  function movePeriod(direction) {
    if (state.period === "range") {
      const start = parseDate(state.rangeStart), end = parseDate(state.rangeEnd);
      const span = Math.round((end - start) / 86400000) + 1;
      start.setDate(start.getDate() + direction * span); end.setDate(end.getDate() + direction * span);
      state.rangeStart = toISO(start); state.rangeEnd = toISO(end);
    } else if (state.period === "day") state.anchor.setDate(state.anchor.getDate() + direction);
    else if (state.period === "week") state.anchor.setDate(state.anchor.getDate() + direction * 7);
    else if (state.period === "month") state.anchor.setMonth(state.anchor.getMonth() + direction);
    else state.anchor.setFullYear(state.anchor.getFullYear() + direction);
    state.anchor = new Date(state.anchor); render(); saveUI();
  }
  document.querySelector("#themeBtn").addEventListener("click", () => {
    const theme = document.querySelector("#app").classList.contains("dark") ? "light" : "dark";
    applyTheme(theme);
    storageSet(THEME_KEY, theme);
  });
  document.querySelector("#openMenu").addEventListener("click", () => { document.querySelector("#sidebar").classList.add("open"); document.querySelector("#scrim").classList.add("active"); });
  ["#closeMenu", "#scrim"].forEach(selector => document.querySelector(selector).addEventListener("click", () => { document.querySelector("#sidebar").classList.remove("open"); document.querySelector("#scrim").classList.remove("active"); }));
  document.querySelector("#openGoal").addEventListener("click", openGoal);
  document.querySelector("#openBudget").addEventListener("click", openBudget);
  document.querySelector("#openSync").addEventListener("click", () => { renderSyncUI(); document.querySelector("#syncModal").classList.remove("hidden"); });
  document.querySelector("#createVault").addEventListener("click", async () => {
    const secret = generateVaultSecret();
    syncRuntime.secret = secret;
    syncRuntime.keys = null;
    syncRuntime.error = "";
    renderSyncUI();
    try { await performSync({ secret }); downloadRecoveryBackup("recuperacao-quanto-tem"); toast("Cofre criado. Arquivo de recuperação baixado"); }
    catch (error) { syncRuntime.secret = ""; syncRuntime.keys = null; syncRuntime.error = ""; storageRemove(SYNC_SECRET_KEY); renderSyncUI(); toast(error.message); }
  });
  document.querySelector("#connectVaultForm").addEventListener("submit", async event => {
    event.preventDefault();
    const input = event.currentTarget.elements.secret;
    const secret = normalizeVaultSecret(input.value);
    if (!secret) { input.setCustomValidity("Use o código completo com 32 caracteres."); input.reportValidity(); return; }
    input.setCustomValidity("");
    try { await performSync({ secret, requireExisting: true }); input.value = ""; toast("Este navegador foi conectado ao cofre"); }
    catch (error) { toast(error.message); }
  });
  document.querySelector("#connectVaultForm").elements.secret.addEventListener("input", event => {
    event.currentTarget.setCustomValidity("");
    const cursorAtEnd = event.currentTarget.selectionStart === event.currentTarget.value.length;
    const normalized = String(event.currentTarget.value).toUpperCase().replace(/[^A-F0-9]/g, "").slice(0, 32);
    event.currentTarget.value = normalized.match(/.{1,4}/g)?.join("-") || "";
    if (cursorAtEnd) event.currentTarget.setSelectionRange(event.currentTarget.value.length, event.currentTarget.value.length);
  });
  document.querySelector("#copyVaultCode").addEventListener("click", async () => { try { await copyText(formatVaultSecret(syncRuntime.secret)); toast("Código do cofre copiado"); } catch { toast("Não foi possível copiar o código"); } });
  document.querySelector("#downloadRecovery").addEventListener("click", () => { downloadRecoveryBackup("recuperacao-quanto-tem"); toast("Arquivo de recuperação baixado"); });
  document.querySelector("#syncNow").addEventListener("click", async () => { try { await performSync(); toast("Dados sincronizados"); } catch (error) { toast(error.message); } });
  document.querySelector("#disconnectVault").addEventListener("click", () => {
    syncRuntime.secret = ""; syncRuntime.keys = null; syncRuntime.error = ""; syncRuntime.lastSynced = null; clearTimeout(syncRuntime.timer); storageRemove(SYNC_SECRET_KEY); renderSyncUI(); toast("Cofre desconectado deste navegador");
  });
  document.querySelectorAll(".modal-backdrop").forEach(modal => modal.addEventListener("mousedown", event => { if (event.target === modal) closeModals(); }));
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeModals(); });
  document.querySelector("#backupBtn").addEventListener("click", () => { downloadRecoveryBackup(); toast(syncRuntime.secret ? "Backup com recuperação do cofre criado" : "Backup criado com sucesso"); });
  document.querySelector("#restoreBtn").addEventListener("click", () => document.querySelector("#restoreInput").click());
  document.querySelector("#restoreInput").addEventListener("change", event => {
    const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = async () => { try { const data = JSON.parse(reader.result); if (!Array.isArray(data.transactions)) throw new Error(); const restoredSecret = normalizeVaultSecret(data.vaultCode || ""); ["transactions", "goals", "budgets", "categories"].forEach(collection => state[collection].forEach(item => recordDeletion(collection, item.id))); state.transactions = data.transactions.map(item => ({ ...item, id: typeof item.id === "string" && item.id ? item.id : uid(), updatedAt: nextTimestamp() })); state.goals = Array.isArray(data.goals) ? data.goals.map((goal, index) => ({ ...goal, id: typeof goal.id === "string" && goal.id ? goal.id : uid(), color: safeColor(goal.color, goalColors[index % goalColors.length]), updatedAt: nextTimestamp() })) : []; state.budgets = Array.isArray(data.budgets) ? data.budgets.map(budget => ({ ...budget, id: typeof budget.id === "string" && budget.id ? budget.id : uid(), updatedAt: nextTimestamp() })) : []; if (Array.isArray(data.categories)) { state.categories = data.categories.map((category, index) => ({ ...category, id: typeof category.id === "string" && category.id ? category.id : uid(), color: colors[category.name] || safeColor(category.color, customColors[index % customColors.length]), updatedAt: nextTimestamp() })); state.categories.forEach(category => { colors[category.name] = category.color || colors.Outros; }); } save(); render(); if (!restoredSecret) { toast("Dados restaurados com sucesso"); return; } syncRuntime.secret = restoredSecret; syncRuntime.keys = null; syncRuntime.error = ""; storageSet(SYNC_SECRET_KEY, restoredSecret); renderSyncUI(); try { await performSync({ secret: restoredSecret }); toast("Dados restaurados e cofre reconectado"); } catch { toast("Dados restaurados. Abra a sincronização para tentar conectar novamente"); } } catch { toast("Arquivo de backup inválido"); } }; reader.readAsText(file); event.target.value = "";
  });
  let scrollSaveTimer;
  window.addEventListener("scroll", () => { clearTimeout(scrollSaveTimer); scrollSaveTimer = setTimeout(() => saveUI(), 120); }, { passive: true });
  window.addEventListener("storage", event => {
    if (![STORAGE_KEY, GOALS_KEY, CATEGORIES_KEY, BUDGETS_KEY, TOMBSTONES_KEY, SYNC_SECRET_KEY].includes(event.key)) return;
    if (event.key === SYNC_SECRET_KEY) { syncRuntime.secret = normalizeVaultSecret(event.newValue || ""); syncRuntime.keys = null; renderSyncUI(); if (syncRuntime.secret) scheduleSync(100); return; }
    state.transactions = ensureArray(load(STORAGE_KEY, state.transactions), state.transactions);
    state.goals = ensureArray(load(GOALS_KEY, state.goals), state.goals);
    state.categories = ensureArray(load(CATEGORIES_KEY, state.categories), state.categories);
    state.budgets = ensureArray(load(BUDGETS_KEY, state.budgets), state.budgets);
    state.tombstones = ensureArray(load(TOMBSTONES_KEY, state.tombstones), state.tombstones);
    state.categories.forEach(category => { colors[category.name] = category.color || colors.Outros; });
    render();
  });
  window.addEventListener("online", () => { renderSyncUI(); scheduleSync(100); });
  window.addEventListener("offline", renderSyncUI);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && syncRuntime.secret) scheduleSync(100); });
  window.addEventListener("beforeunload", () => saveUI());
  applyTheme(storageGet(THEME_KEY) === "dark" ? "dark" : "light");
  activateView(state.view);
  render();
  renderSyncUI();
  if (syncRuntime.secret) scheduleSync(250);
  window.setInterval(() => { if (syncRuntime.secret && document.visibilityState === "visible") scheduleSync(0); }, 30000);
  if ("serviceWorker" in navigator && !navigator.webdriver && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) navigator.serviceWorker.register("service-worker.js").catch(() => {});
  setTimeout(() => window.scrollTo({ top: Number.isFinite(savedUI.scrollY) ? savedUI.scrollY : 0, behavior: "auto" }), 80);
})();
