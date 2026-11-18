import type { Candidate, ConfigResponse, Poi, RefineResponse, RoutesResponse, SuggestResponse, TipsResponse } from "./types";

const ENDPOINT = "/functions/v1/app";

async function callAction<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(typeof data.message === "string" && data.message ? data.message : (data.error ?? "unknown"));
  return data as T;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const shrinkPoi = (p: Poi) => ({ id: p.id, name: p.name, lat: round6(p.lat), lng: round6(p.lng) });

export const getConfig = () => callAction<ConfigResponse>({ action: "config" });

export const getTips = (q: string) => callAction<TipsResponse>({ action: "tips", q });

export const getSuggest = (a: Poi, b: Poi, category: string) =>
  callAction<SuggestResponse>({ action: "suggest", a: shrinkPoi(a), b: shrinkPoi(b), category });

export const getRoutes = (from: Poi, to: Poi, mode?: "driving" | "walking") =>
  callAction<RoutesResponse>({ action: "routes", from: shrinkPoi(from), to: shrinkPoi(to), mode });

export const refineCandidates = (candidates: Candidate[], utterance: string) =>
  callAction<RefineResponse>({
    action: "refine",
    utterance,
    candidates: candidates.map((c) => ({
      id: c.id,
      name: c.name,
      address: c.address ?? "",
      aMinutes: c.a.minutes,
      bMinutes: c.b.minutes,
    })),
  });
