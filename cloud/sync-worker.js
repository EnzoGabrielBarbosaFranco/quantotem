const SYNC_HEADER = { "X-Contaai-Sync": "1", "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 1024 * 1024;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SYNC_HEADER, ...extraHeaders }
  });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return "*";
  const ownOrigin = new URL(request.url).origin;
  const configured = String(env.ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean);
  return origin === ownOrigin || configured.includes("*") || configured.includes(origin) ? origin : "";
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Contaai-Key",
    "Access-Control-Expose-Headers": "X-Contaai-Sync",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function secureEqual(first, second) {
  if (typeof first !== "string" || typeof second !== "string" || first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  return difference === 0;
}

export class SyncVault {
  constructor(ctx) { this.ctx = ctx; }

  async fetch(request) {
    if (request.method === "GET") {
      const vault = await this.ctx.storage.get("vault");
      return vault ? json({ revision: vault.revision, payload: vault.payload }) : json({ error: "Cofre não encontrado." }, 404);
    }

    if (request.method !== "PUT") return json({ error: "Método não permitido." }, 405, { Allow: "GET, PUT" });
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > MAX_BODY_BYTES) return json({ error: "O cofre excedeu o limite de 1 MB." }, 413);
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return json({ error: "O cofre excedeu o limite de 1 MB." }, 413);

    let body;
    try { body = JSON.parse(rawBody); }
    catch { return json({ error: "Conteúdo inválido." }, 400); }

    const writeKey = request.headers.get("X-Contaai-Key") || "";
    const validPayload = body?.payload?.version === 1 && typeof body.payload.iv === "string" && typeof body.payload.data === "string";
    if (!/^[a-f0-9]{64}$/.test(writeKey) || !Number.isInteger(body?.baseRevision) || body.baseRevision < 0 || !validPayload) return json({ error: "Requisição inválida." }, 400);

    const current = await this.ctx.storage.get("vault");
    if (current && !secureEqual(current.writeKey, writeKey)) return json({ error: "Chave de gravação inválida." }, 403);
    if (current && body.baseRevision !== current.revision) return json({ error: "O cofre mudou em outro dispositivo.", revision: current.revision, payload: current.payload }, 409);
    if (!current && body.baseRevision !== 0) return json({ error: "O cofre ainda não existe." }, 409);

    const vault = { revision: (current?.revision || 0) + 1, writeKey, payload: body.payload, updatedAt: Date.now() };
    await this.ctx.storage.put("vault", vault);
    return json({ revision: vault.revision }, current ? 200 : 201);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/sync")) return env.ASSETS.fetch(request);

    const origin = allowedOrigin(request, env);
    if (!origin) return json({ error: "Origem não autorizada." }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...SYNC_HEADER, ...corsHeaders(origin) } });
    if (url.pathname === "/api/sync") return json({ ok: true, service: "Quanto Tem Sync" }, 200, corsHeaders(origin));

    const match = url.pathname.match(/^\/api\/sync\/([a-f0-9]{64})$/);
    if (!match) return json({ error: "Endereço de cofre inválido." }, 404, corsHeaders(origin));
    const stub = env.VAULTS.getByName(match[1]);
    const response = await stub.fetch(request);
    const headers = new Headers(response.headers);
    Object.entries(corsHeaders(origin)).forEach(([name, value]) => headers.set(name, value));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
};
