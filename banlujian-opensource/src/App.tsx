import { useCallback, useEffect, useMemo, useState } from "react";
import { LocationInput } from "@/components/LocationInput";
import { MapPanel } from "@/components/MapPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getConfig, getRoutes, getSuggest, refineCandidates } from "@/lib/api";
import type { Candidate, ConfigResponse, Poi, RoutesResponse } from "@/lib/types";

const CATEGORIES = [
  { id: "cafe", label: "咖啡" },
  { id: "food", label: "美食" },
  { id: "book", label: "书店" },
  { id: "mall", label: "商场" },
  { id: "park", label: "公园" },
];

export default function App() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [a, setA] = useState<Poi | null>(null);
  const [b, setB] = useState<Poi | null>(null);
  const [category, setCategory] = useState("cafe");
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [routes, setRoutes] = useState<{ a: RoutesResponse | null; b: RoutesResponse | null }>({ a: null, b: null });
  const [routesLoading, setRoutesLoading] = useState(false);
  const [refineInput, setRefineInput] = useState("");
  const [refineLoading, setRefineLoading] = useState(false);
  const [refine, setRefine] = useState<{ kept: string[]; reason: string; mode: "llm" | "rules" } | null>(null);
  const [refineError, setRefineError] = useState("");

  useEffect(() => {
    getConfig().then(setConfig).catch(() => setConfig({ ok: true, jsKey: "", securityCode: "", mock: true }));
  }, []);

  const search = useCallback(() => {
    if (!a || !b) return;
    setPhase("loading");
    setErrorMsg("");
    setRefine(null);
    setRefineError("");
    setRefineInput("");
    getSuggest(a, b, category)
      .then((res) => {
        setCandidates(res.candidates);
        setSelectedId(res.candidates[0]?.id ?? null);
        setPhase(res.candidates.length ? "done" : "idle");
        if (!res.candidates.length) setErrorMsg("中间点附近没找到符合的地点，试试换个类型或调整位置。");
      })
      .catch((e: unknown) => {
        setPhase("error");
        setErrorMsg(e instanceof Error ? e.message : "请求失败，请稍后再试");
      });
  }, [a, b, category]);

  const submitRefine = useCallback(() => {
    const q = refineInput.trim();
    if (!q || !candidates.length || refineLoading) return;
    setRefineLoading(true);
    setRefineError("");
    refineCandidates(candidates, q)
      .then((res) => {
        if (!res.kept.length) {
          setRefine(null);
          setRefineError(`AI 觉得这些候选都不太符合「${q}」，换个说法试试，或重新搜索。`);
        } else {
          setRefine({ kept: res.kept, reason: res.reason, mode: res.mode });
        }
      })
      .catch(() => setRefineError("AI 调整失败，请稍后再试"))
      .finally(() => setRefineLoading(false));
  }, [refineInput, candidates, refineLoading]);

  const orderedCandidates = useMemo(() => {
    if (!refine) return candidates;
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const kept = refine.kept.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
    return [...kept, ...candidates.filter((c) => !kept.includes(c))];
  }, [candidates, refine]);

  useEffect(() => {
    const c = candidates.find((item) => item.id === selectedId);
    if (!c || !a || !b) {
      setRoutes({ a: null, b: null });
      return;
    }
    setRoutesLoading(true);
    setRoutes({ a: null, b: null });
    Promise.all([getRoutes(a, c), getRoutes(b, c)])
      .then(([ra, rb]) => setRoutes({ a: ra, b: rb }))
      .catch(() => setRoutes({ a: null, b: null }))
      .finally(() => setRoutesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const canSearch = Boolean(a && b) && phase !== "loading";

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-6 px-4 py-8 md:px-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">半路见</h1>
          {config?.mock && <Badge variant="secondary">演示数据</Badge>}
        </div>
        <p className="text-muted-foreground">
          两个人约在哪？输入双方位置，我们给出对你们俩<span className="text-foreground">都方便</span>的见面点。
        </p>
      </header>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            <LocationInput
              label="A"
              accentClass="bg-blue-600"
              placeholder="你的位置，如：黄龙体育中心"
              value={a}
              onChange={setA}
            />
            <LocationInput
              label="B"
              accentClass="bg-orange-500"
              placeholder="对方的位置，如：龙翔桥"
              value={b}
              onChange={setB}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ToggleGroup
              type="single"
              variant="outline"
              value={category}
              onValueChange={(v) => v && setCategory(v)}
              aria-label="见面类型"
              className="flex-wrap"
            >
              {CATEGORIES.map((c) => (
                <ToggleGroupItem key={c.id} value={c.id} className="px-4">
                  {c.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Button size="lg" disabled={!canSearch} onClick={search} className="font-semibold">
              {phase === "loading" ? (
                <>
                  <Spinner className="h-4 w-4" /> 正在找中间点…
                </>
              ) : (
                "找中间点"
              )}
            </Button>
          </div>
          {!a || !b ? (
            <p className="text-xs text-muted-foreground">从下拉建议中选择两个地点（搜索框输入后会自动提示）。</p>
          ) : null}
          {phase === "error" && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errorMsg}
            </p>
          )}
          {phase === "done" && !candidates.length && (
            <p role="status" className="text-sm text-muted-foreground">
              {errorMsg}
            </p>
          )}
        </CardContent>
      </Card>

      {(phase === "done" || phase === "loading") && candidates.length > 0 && (
        <section className="grid gap-4 md:grid-cols-[1.2fr_1fr]" aria-label="推荐结果">
          <MapPanel
            jsKey={config?.jsKey ?? ""}
            securityCode={config?.securityCode ?? ""}
            a={a}
            b={b}
            candidates={candidates}
            selectedId={selectedId}
            routes={routes}
          />
          <div className="flex flex-col gap-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitRefine();
              }}
              className="flex gap-2"
            >
              <Input
                value={refineInput}
                onChange={(e) => setRefineInput(e.target.value)}
                placeholder="想调整？告诉 AI：安静点 / 别太远 / 有情调"
                aria-label="向 AI 描述你的偏好"
                maxLength={120}
                className="text-sm"
              />
              <Button type="submit" variant="outline" disabled={!refineInput.trim() || refineLoading || !candidates.length} className="shrink-0">
                {refineLoading ? (
                  <>
                    <Spinner className="h-4 w-4" /> 调整中…
                  </>
                ) : (
                  "AI 调整"
                )}
              </Button>
            </form>
            {refineError && (
              <p role="alert" className="text-xs text-destructive">
                {refineError}
              </p>
            )}
            {refine && (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary" className="shrink-0">
                  AI 已调整{refine.mode === "rules" ? " · 精简模式" : ""}
                </Badge>
                {refine.reason}
              </p>
            )}
            <ol className="flex flex-col gap-2">
              {orderedCandidates.map((c, i) => {
              const selected = c.id === selectedId;
              const gap = Math.abs(c.a.minutes - c.b.minutes);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSelectedId(c.id)}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                      selected ? "border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30" : "border-border hover:bg-accent"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
                        {i + 1}
                      </span>
                      <span className="truncate font-medium">{c.name}</span>
                      {refine && refine.kept.includes(c.id) && i < refine.kept.length && (
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          AI
                        </Badge>
                      )}
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {gap === 0 ? "完美均衡" : `相差 ${gap} 分钟`}
                      </span>
                    </div>
                    {c.address && <p className="mt-1 truncate text-xs text-muted-foreground">{c.address}</p>}
                    <div className="mt-2 flex gap-2 text-xs">
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                        A {routesLoading && selected ? "…" : `${c.a.minutes} 分钟`}
                      </span>
                      <span className="rounded-full bg-orange-100 px-2 py-0.5 font-medium text-orange-700 dark:bg-orange-950 dark:text-orange-300">
                        B {routesLoading && selected ? "…" : `${c.b.minutes} 分钟`}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
            <li className="mt-1 px-1 text-xs text-muted-foreground">
              排序规则：让「走得最远的那个人」尽量少走，再让两个人总耗时更短。
              {routes.a && routes.b && (
                <span className="mt-1 block">
                  当前选中：A 约 {routes.a.distanceM >= 1000 ? `${(routes.a.distanceM / 1000).toFixed(1)}km` : `${routes.a.distanceM}m`} ·
                  B 约 {routes.b.distanceM >= 1000 ? `${(routes.b.distanceM / 1000).toFixed(1)}km` : `${routes.b.distanceM}m`}
                  （{routes.a.mode === "walking" ? "步行" : "驾车"}方案）
                </span>
              )}
            </li>
          </ol>
          </div>
        </section>
      )}

      <footer className="mt-auto border-t border-border pt-4 text-xs text-muted-foreground">
        地点与路线数据来自高德开放平台，结果仅供参考。 · 用 Qoder 构建 · 2026 Qoder 高校创造力大赛
      </footer>
    </div>
  );
}
