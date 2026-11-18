// 半路见后端：代理高德 Web 服务 API，Key 只存在于服务端环境变量；
// 未配置 Key 时自动返回演示数据（响应带 mock 标记），便于无凭据开发与评审演示。
type Poi = { id?: string; name: string; address?: string; lat: number; lng: number };
type Leg = { minutes: number; distanceM: number };

const AMAP_BASE = "https://restapi.amap.com/v3";

const CATEGORIES: Record<string, string> = {
  cafe: "咖啡",
  food: "美食",
  book: "书店",
  mall: "购物中心",
  park: "公园",
};

const MOCK_TIPS: Poi[] = [
  { id: "mock-1", name: "西湖文化广场", address: "演示数据 · 杭州", lat: 30.2907, lng: 120.1662 },
  { id: "mock-2", name: "武林广场", address: "演示数据 · 杭州", lat: 30.2795, lng: 120.1687 },
  { id: "mock-3", name: "黄龙体育中心", address: "演示数据 · 杭州", lat: 30.2682, lng: 120.1323 },
  { id: "mock-4", name: "龙翔桥", address: "演示数据 · 杭州", lat: 30.2591, lng: 120.1611 },
  { id: "mock-5", name: "钱江新城", address: "演示数据 · 杭州", lat: 30.2501, lng: 120.2113 },
];

const MOCK_NAMES = ["街角咖啡", "半山书屋", "白鹭茶集", "湖畔烘焙", "绿廊轻食"];

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function bad(error: string, status = 400, message?: string) {
  return json({ ok: false, error, message }, status);
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function haversineM(p1: { lat: number; lng: number }, p2: { lat: number; lng: number }) {
  const R = 6371000;
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((p1.lat * Math.PI) / 180) * Math.cos((p2.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function parsePoi(v: unknown, field: string): Poi {
  const o = (v ?? {}) as Record<string, unknown>;
  const lat = num(o.lat);
  const lng = num(o.lng);
  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (lat === null || lng === null || !name) throw new Error(`invalid_${field}`);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error(`invalid_${field}`);
  return { id: typeof o.id === "string" ? o.id : name, name, lat, lng };
}

function amapKey() {
  return (Deno.env.get("AMAP_WEB_KEY") ?? "").trim();
}

async function amap(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const url = new URL(AMAP_BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", amapKey());
  const res = await fetch(url);
  if (!res.ok) throw new Error(`amap_http_${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  if (data.status !== "1") throw new Error(`amap_${String(data.info ?? "error")}`);
  return data;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 个人 Key QPS 限额低且按滑动窗口计，命中后稍等重试一次。
async function amapRetryOnQps(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  try {
    return await amap(path, params);
  } catch (e) {
    if (e instanceof Error && e.message.includes("CUQPS")) {
      await sleep(900);
      return amap(path, params);
    }
    throw e;
  }
}

function locationOf(t: unknown): [number, number] | null {
  const loc = (t as { location?: unknown })?.location;
  if (typeof loc === "string") {
    const [lng, lat] = loc.split(",").map(Number);
    if (Number.isFinite(lng) && Number.isFinite(lat)) return [lng, lat];
  } else if (loc && typeof loc === "object") {
    const o = loc as { lng?: unknown; lat?: unknown };
    const lng = num(o.lng);
    const lat = num(o.lat);
    if (lng !== null && lat !== null) return [lng, lat];
  }
  return null;
}

async function tipsAction(q: string) {
  if (!amapKey()) return json({ ok: true, mock: true, items: MOCK_TIPS });
  const data = await amap("/assistant/inputtips", { keywords: q, datatype: "poi" });
  const items: Poi[] = [];
  for (const t of (data.tips ?? []) as Array<Record<string, unknown>>) {
    const name = typeof t.name === "string" ? t.name.trim() : "";
    const loc = locationOf(t);
    if (!name || !loc) continue;
    const [lng, lat] = loc;
    const address = [t.district, t.address].filter((p) => typeof p === "string" && p).join("");
    items.push({ id: typeof t.id === "string" && t.id ? t.id : `${name}@${lng},${lat}`, name, address, lat, lng });
    if (items.length >= 8) break;
  }
  return json({ ok: true, items });
}

// 距离矩阵实测 origin_id/dest_id 为 1-based 字符串，仅当出现 0 时按 0-based 兼容。
function matrixIndex(v: unknown, count: number, fallback: number) {
  const n = num(v);
  if (n !== null && Number.isInteger(n)) {
    if (n >= 1 && n <= count) return n - 1;
    if (n === 0) return 0;
  }
  return fallback;
}

type Scored = Poi & { a: Leg; b: Leg };

// 先让走得最远的人尽量近，再让两人总耗时更短，最后以距中点距离定序。
function rankCandidates(list: Scored[], mid: { lat: number; lng: number }): Scored[] {
  return [...list].sort(
    (x, y) =>
      Math.max(x.a.minutes, x.b.minutes) - Math.max(y.a.minutes, y.b.minutes) ||
      x.a.minutes + x.b.minutes - (y.a.minutes + y.b.minutes) ||
      haversineM(mid, x) - haversineM(mid, y),
  );
}

async function suggestAction(a: Poi, b: Poi, category: string) {
  if (!amapKey()) {
    const mid = { lng: (a.lng + b.lng) / 2, lat: (a.lat + b.lat) / 2 };
    const offsets = [
      [-0.004, 0.003],
      [0.005, -0.002],
      [-0.002, -0.005],
      [0.006, 0.004],
      [-0.005, -0.001],
    ];
    const candidates = offsets.map(([dLng, dLat], i) => {
      const c = { lng: Number((mid.lng + dLng).toFixed(6)), lat: Number((mid.lat + dLat).toFixed(6)) };
      const leg = (from: Poi): Leg => ({
        minutes: clamp(Math.round(haversineM(from, c) / 320) + 3, 3, 60),
        distanceM: Math.round(haversineM(from, c)),
      });
      return {
        id: `mock-c${i}`,
        name: MOCK_NAMES[i % MOCK_NAMES.length],
        address: "演示数据",
        lat: c.lat,
        lng: c.lng,
        a: leg(a),
        b: leg(b),
      };
    });
    return json({ ok: true, mock: true, candidates: rankCandidates(candidates, mid) });
  }

  const mid = { lng: (a.lng + b.lng) / 2, lat: (a.lat + b.lat) / 2 };
  const radius = Math.round(clamp(haversineM(a, b) * 0.4, 1200, 6000));
  const keyword = CATEGORIES[category] ?? "咖啡";
  const around = await amap("/place/around", {
    location: `${mid.lng},${mid.lat}`,
    keywords: keyword,
    radius: String(radius),
    offset: "8",
    page: "1",
  });
  const pois: Poi[] = [];
  for (const p of (around.pois ?? []) as Array<Record<string, unknown>>) {
    const name = typeof p.name === "string" ? p.name.trim() : "";
    const loc = locationOf(p);
    if (!name || !loc) continue;
    const [lng, lat] = loc;
    pois.push({
      id: typeof p.id === "string" && p.id ? p.id : `${name}@${lng},${lat}`,
      name,
      address: typeof p.address === "string" ? p.address : "",
      lat,
      lng,
    });
  }
  if (!pois.length) return json({ ok: true, candidates: [] });

  // v3/distance 只支持「多起点 → 单终点」，对每个候选点各查一次（A、B 两行）；
  // 个人 Key QPS 限额很低，串行加间隔调用。
  const matrix: Array<Array<Leg | null>> = pois.map(() => [null, null]);
  for (const [d, p] of pois.entries()) {
    if (d > 0) await sleep(300);
    const dist = await amapRetryOnQps("/distance", {
      origins: `${a.lng},${a.lat}|${b.lng},${b.lat}`,
      destination: `${p.lng},${p.lat}`,
      type: "1",
    });
    const results = (dist.results ?? []) as Array<Record<string, unknown>>;
    results.forEach((r, i) => {
      const o = matrixIndex(r.origin_id, 2, i);
      const minutes = Math.max(1, Math.round(num(r.duration)! / 60));
      const distanceM = Math.round(num(r.distance)!);
      if (o === 0 || o === 1) matrix[d][o] = { minutes, distanceM };
    });
  }

  const candidates = pois
    .map((p, d) => ({ ...p, a: matrix[d][0], b: matrix[d][1] }))
    .filter((c): c is Poi & { a: Leg; b: Leg } => Boolean(c.a && c.b));
  return json({ ok: true, candidates: rankCandidates(candidates, mid).slice(0, 5) });
}

function concatSteps(path: unknown): string {
  const p = path as { steps?: Array<{ polyline?: string }> } | undefined;
  return (p?.steps ?? [])
    .map((s) => s.polyline ?? "")
    .filter(Boolean)
    .join(";");
}

async function routesAction(from: Poi, to: Poi, mode?: "driving" | "walking") {
  if (!amapKey()) {
    const points: string[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const jitter = i % 2 === 0 ? 0 : 0.0008;
      points.push(
        `${(from.lng + (to.lng - from.lng) * t + jitter).toFixed(6)},${(from.lat + (to.lat - from.lat) * t).toFixed(6)}`,
      );
    }
    const m = haversineM(from, to);
    return json({
      ok: true,
      mock: true,
      mode: "driving",
      minutes: clamp(Math.round(m / 400) + 2, 2, 90),
      distanceM: Math.round(m),
      polyline: points.join(";"),
    });
  }
  const effective = mode ?? (haversineM(from, to) < 1500 ? "walking" : "driving");
  const origin = `${from.lng},${from.lat}`;
  const destination = `${to.lng},${to.lat}`;
  if (effective === "walking") {
    const data = await amap("/direction/walking", { origin, destination });
    const path = (data.route as { paths?: unknown[] })?.paths?.[0] as Record<string, unknown> | undefined;
    if (!path) throw new Error("amap_no_path");
    return json({
      ok: true,
      mode: "walking",
      minutes: Math.max(1, Math.round(num(path.duration)! / 60)),
      distanceM: Math.round(num(path.distance)!),
      polyline: concatSteps(path),
    });
  }
  const data = await amap("/direction/driving", { origin, destination, strategy: "0", extensions: "base" });
  const path = (data.route as { paths?: unknown[] })?.paths?.[0] as Record<string, unknown> | undefined;
  if (!path) throw new Error("amap_no_path");
  return json({
    ok: true,
    mode: "driving",
    minutes: Math.max(1, Math.round(num(path.duration)! / 60)),
    distanceM: Math.round(num(path.distance)!),
    polyline: concatSteps(path),
  });
}

function configAction() {
  const jsKey = (Deno.env.get("AMAP_JS_KEY") ?? "").trim();
  const securityCode = (Deno.env.get("AMAP_JS_SECURITY_CODE") ?? "").trim();
  return json({ ok: true, jsKey, securityCode, mock: !amapKey() });
}

type RefineInput = { id: string; name: string; address: string; aMinutes: number; bMinutes: number };
type RefineResult = { kept: string[]; reason: string };

const QUIET_RE = /安静|清静|人少|学习|自习|工作|办公|看书|读书|聊天|谈事/;
const NEAR_RE = /近|别太远|不要太远|少走|不想走|走远|顺路/;
const BALANCED_RE = /公平|均衡|中间|相差|不吃亏|都不亏/;
const FAST_RE = /快|赶|急|马上|尽快|省时间/;
const SCENIC_RE = /风景|环境|有情调|格调|氛围|好看|湖|江|公园|山|绿|园|露台|院子|庭院|老街|古镇/;
const CHEAP_RE = /便宜|实惠|省钱|预算|价格|人均|平价/;
const CHEAP_BRANDS = /瑞幸|库迪|蜜雪|便利|快餐|沙县|兰州|麦当劳|肯德基|塔斯汀/;
const QUIET_HINTS = /书屋|书店|自习|图书|咖啡馆|咖啡|茶/;
const NOISY_HINTS = /商场|in77|银泰|万达|广场|美食城/;

// 相对指标（少走/均衡/省时）按升序排名给分，保证命中即有区分度；正信号主题按关键词加分。
function rankScore(list: RefineInput[], value: (c: RefineInput) => number) {
  const order = [...list].sort((x, y) => value(x) - value(y));
  return new Map(order.map((c, i) => [c.id, list.length - i]));
}

function rulesRefine(list: RefineInput[], q: string): RefineResult {
  const themes: Array<{ label: string; score: (c: RefineInput) => number }> = [];
  if (QUIET_RE.test(q)) {
    themes.push({
      label: "安静",
      score: (c) => (QUIET_HINTS.test(c.name) ? 3 : 0) - (NOISY_HINTS.test(c.name) || NOISY_HINTS.test(c.address) ? 2 : 0),
    });
  }
  if (NEAR_RE.test(q)) {
    const ranks = rankScore(list, (c) => Math.max(c.aMinutes, c.bMinutes));
    themes.push({ label: "少走", score: (c) => ranks.get(c.id) ?? 0 });
  }
  if (BALANCED_RE.test(q)) {
    const ranks = rankScore(list, (c) => Math.abs(c.aMinutes - c.bMinutes));
    themes.push({ label: "均衡", score: (c) => ranks.get(c.id) ?? 0 });
  }
  if (FAST_RE.test(q)) {
    const ranks = rankScore(list, (c) => c.aMinutes + c.bMinutes);
    themes.push({ label: "省时", score: (c) => ranks.get(c.id) ?? 0 });
  }
  if (SCENIC_RE.test(q)) {
    themes.push({ label: "环境", score: (c) => (SCENIC_RE.test(c.name) || SCENIC_RE.test(c.address) ? 3 : 0) });
  }
  if (CHEAP_RE.test(q)) themes.push({ label: "实惠", score: (c) => (CHEAP_BRANDS.test(c.name) ? 3 : 0) });

  if (!themes.length) {
    return { kept: list.map((c) => c.id), reason: "没识别到明确偏好，先按均衡排序推荐。" };
  }
  const scored = list.map((c) => ({ id: c.id, score: themes.reduce((s, t) => s + t.score(c), 0) }));
  const best = Math.max(...scored.map((s) => s.score));
  if (best <= 0) return { kept: list.map((c) => c.id), reason: `按「${themes.map((t) => t.label).join("、")}」没有拉开差距，保持原推荐。` };
  const kept = scored
    .filter((s) => s.score === best || s.score >= best - 2)
    .sort((x, y) => y.score - x.score)
    .map((s) => s.id);
  return { kept, reason: `按「${themes.map((t) => t.label).join("、")}」偏好把更符合的排到了前面。` };
}

async function dashscopeChat(apiKey: string, userContent: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        model: "qwen-flash",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              '你是见面地点推荐助手。根据用户偏好从候选中挑选更符合的地点。只输出 JSON，不要输出其他文字：{"kept": ["<候选id>", ...], "reason": "不超过30字的中文解释"}。kept 必须是候选 id 的子集，可以为空数组（表示都不合适），不要编造 id。',
          },
          { role: "user", content: userContent },
        ],
      }),
    });
    if (res.ok) return (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    if (res.status === 429 && attempt === 0) {
      await sleep(1500);
      continue;
    }
    console.warn(`refine_llm http_${res.status}`);
    return null;
  }
  return null;
}

async function llmRefine(list: RefineInput[], q: string): Promise<RefineResult | null> {
  const apiKey = (Deno.env.get("DASHSCOPE_API_KEY") ?? "").trim();
  if (!apiKey || !list.length) return null;
  const brief = list.map((c) => ({
    id: c.id,
    名称: c.name,
    地址: c.address,
    A方分钟: c.aMinutes,
    B方分钟: c.bMinutes,
  }));
  const data = await dashscopeChat(apiKey, `候选：${JSON.stringify(brief)}\n用户偏好：${q}`);
  const content = data?.choices?.[0]?.message?.content ?? "";
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) {
    console.warn("refine_llm_unparseable");
    return null;
  }
  const parsed = JSON.parse(m[0]) as { kept?: unknown; reason?: unknown };
  if (!Array.isArray(parsed.kept)) return null;
  const valid = new Set(list.map((c) => c.id));
  const kept = [...new Set(parsed.kept.filter((v): v is string => typeof v === "string" && valid.has(v)))];
  const reason = typeof parsed.reason === "string" && parsed.reason.trim() ? parsed.reason.trim().slice(0, 60) : "已按你的偏好调整推荐。";
  return { kept, reason };
}

function parseRefineInput(v: unknown): RefineInput | null {
  const o = (v ?? {}) as Record<string, unknown>;
  const id = typeof o.id === "string" && o.id ? o.id : null;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  const aMinutes = num(o.aMinutes);
  const bMinutes = num(o.bMinutes);
  if (!id || !name || aMinutes === null || bMinutes === null) return null;
  return {
    id: id.slice(0, 80),
    name: name.slice(0, 80),
    address: typeof o.address === "string" ? o.address.slice(0, 120) : "",
    aMinutes: clamp(Math.round(aMinutes), 1, 600),
    bMinutes: clamp(Math.round(bMinutes), 1, 600),
  };
}

async function refineAction(list: unknown[], q: string) {
  const inputs = list.slice(0, 20).map(parseRefineInput).filter((c): c is RefineInput => c !== null);
  if (!inputs.length) return bad("empty_candidates");
  const utterance = q.trim().slice(0, 120);
  if (!utterance) return bad("empty_utterance");
  let result: RefineResult | null = null;
  let mode: "llm" | "rules" = "rules";
  try {
    result = await llmRefine(inputs, utterance);
    if (result) mode = "llm";
  } catch (e) {
    console.warn(`refine_llm_failed ${e instanceof Error ? e.message : String(e)}`);
    result = null;
  }
  if (!result) result = rulesRefine(inputs, utterance);
  return json({ ok: true, ...result, mode });
}

export function handler(request: Request): Response | Promise<Response> {
  if (request.method === "GET") {
    return json({ ok: true, service: "banlujian", mock: !amapKey() });
  }
  if (request.method !== "POST") {
    return Promise.resolve(bad("method_not_allowed", 405));
  }
  return request
    .text()
    .then((raw) => {
      if (raw.length > 20000) return bad("payload_too_large", 413);
      const body = JSON.parse(raw) as Record<string, unknown>;
      switch (body.action) {
        case "config":
          return configAction();
        case "tips":
          return tipsAction(String(body.q ?? "").trim().slice(0, 40));
        case "suggest":
          return suggestAction(parsePoi(body.a, "a"), parsePoi(body.b, "b"), String(body.category ?? "cafe"));
        case "routes": {
          const mode = body.mode === "driving" || body.mode === "walking" ? body.mode : undefined;
          return routesAction(parsePoi(body.from, "from"), parsePoi(body.to, "to"), mode);
        }
        case "refine":
          return refineAction(Array.isArray(body.candidates) ? body.candidates : [], String(body.utterance ?? ""));
        default:
          return bad("unknown_action");
      }
    })
    .catch((e: unknown) => {
      if (e instanceof SyntaxError) return bad("invalid_json");
      const message = e instanceof Error ? e.message : String(e);
      return bad(message.startsWith("invalid_") ? "invalid_input" : "upstream_error", message.startsWith("invalid_") ? 400 : 502, message);
    });
}
