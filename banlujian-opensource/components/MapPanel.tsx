import { useEffect, useRef, useState } from "react";
import { loadAMap, parsePolyline } from "@/lib/amap";
import type { Candidate, Poi, RoutesResponse } from "@/lib/types";

type Props = {
  jsKey: string;
  securityCode: string;
  a: Poi | null;
  b: Poi | null;
  candidates: Candidate[];
  selectedId: string | null;
  routes: { a: RoutesResponse | null; b: RoutesResponse | null };
};

const PIN = (bg: string, text: string) =>
  `<div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9999px;background:${bg};color:#fff;font-size:12px;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,.35);border:2px solid #fff;">${text}</div>`;

export function MapPanel({ jsKey, securityCode, a, b, candidates, selectedId, routes }: Props) {
  const containerId = "amap-container";
  const mapRef = useRef<unknown>(null);
  const [amap, setAmap] = useState<Record<string, unknown> | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!jsKey) return;
    let alive = true;
    loadAMap(jsKey, securityCode || undefined)
      .then((A) => {
        if (alive) setAmap(A as unknown as Record<string, unknown>);
      })
      .catch(() => {
        if (alive) setLoadError(true);
      });
    return () => {
      alive = false;
    };
  }, [jsKey, securityCode]);

  useEffect(() => {
    if (!amap || mapRef.current) return;
    const MapCtor = amap.Map as new (el: string, opts: Record<string, unknown>) => {
      destroy?: () => void;
      add: (o: unknown) => void;
      remove: (o: unknown) => void;
      setFitView: (o: unknown, immediate?: boolean, margin?: number[]) => void;
    };
    const map = new MapCtor(containerId, { zoom: 12, viewMode: "2D" });
    mapRef.current = map;
    return () => {
      map.destroy?.();
      mapRef.current = null;
    };
  }, [amap]);

  const overlayKey = [
    a?.id,
    b?.id,
    candidates.map((c) => c.id).join(","),
    selectedId,
    routes.a ? routes.a.polyline.length : 0,
    routes.b ? routes.b.polyline.length : 0,
  ].join("|");

  useEffect(() => {
    const A = amap;
    const map = mapRef.current as {
      add: (o: unknown) => void;
      remove: (o: unknown) => void;
      setFitView: (o: unknown, immediate?: boolean, margin?: number[]) => void;
    } | null;
    if (!A || !map) return;
    const Marker = A.Marker as new (opts: Record<string, unknown>) => unknown;
    const Polyline = A.Polyline as new (opts: Record<string, unknown>) => unknown;
    const overlays: unknown[] = [];

    const pins: Array<[Poi | null, string, string]> = [
      [a, "#2563eb", "A"],
      [b, "#f97316", "B"],
    ];
    for (const [poi, color, label] of pins) {
      if (!poi) continue;
      overlays.push(
        new Marker({
          position: [poi.lng, poi.lat],
          content: PIN(color, label),
          zIndex: 110,
        }),
      );
    }
    candidates.forEach((c, i) => {
      const selected = c.id === selectedId;
      overlays.push(
        new Marker({
          position: [c.lng, c.lat],
          content: `<div style="display:flex;align-items:center;justify-content:center;min-width:24px;height:24px;padding:0 5px;border-radius:9999px;background:${selected ? "#10b981" : "#ffffff"};color:${selected ? "#fff" : "#065f46"};font-size:12px;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,.3);border:2px solid ${selected ? "#10b981" : "#10b98166"};">${i + 1}</div>`,
          zIndex: selected ? 120 : 100,
        }),
      );
    });
    const line = (polyline: string, color: string) => {
      const path = parsePolyline(polyline);
      if (path.length < 2) return;
      overlays.push(new Polyline({ path, strokeColor: color, strokeWeight: 5, strokeOpacity: 0.85, lineJoin: "round" }));
    };
    if (selectedId) {
      if (routes.a) line(routes.a.polyline, "#2563eb");
      if (routes.b) line(routes.b.polyline, "#f97316");
    }
    if (overlays.length) {
      map.add(overlays);
      map.setFitView(overlays, false, [50, 50, 50, 50]);
    }
  }, [amap, overlayKey]);

  if (!jsKey || loadError) {
    return (
      <div
        className="relative flex h-72 items-center justify-center overflow-hidden rounded-xl border border-border bg-gradient-to-br from-emerald-50 via-sky-50 to-orange-50 md:h-full md:min-h-[420px]"
        aria-label="地图区域"
      >
        <div className="absolute inset-0 opacity-40">
          <svg width="100%" height="100%" aria-hidden="true">
            <defs>
              <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
                <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#94a3b8" strokeOpacity="0.25" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>
        <div className="relative z-10 px-6 text-center">
          <div className="mb-3 flex items-center justify-center gap-6 text-3xl">
            <span className="translate-y-2 font-bold text-blue-600">A</span>
            <span className="font-bold text-emerald-600">◎</span>
            <span className="-translate-y-2 font-bold text-orange-500">B</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {loadError ? "地图加载失败，已切换为列表模式" : "配置高德 JS Key 后这里会展示交互地图"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground/70">当前为演示模式</p>
        </div>
      </div>
    );
  }

  return <div id={containerId} className="h-72 rounded-xl border border-border md:h-full md:min-h-[420px]" aria-label="地图区域" />;
}
