export type Poi = {
  id: string;
  name: string;
  address?: string;
  lat: number;
  lng: number;
};

export type Leg = { minutes: number; distanceM: number };

export type Candidate = Poi & { a: Leg; b: Leg };

export type SuggestResponse = {
  ok: true;
  candidates: Candidate[];
  mock?: boolean;
};

export type RoutesResponse = {
  ok: true;
  minutes: number;
  distanceM: number;
  polyline: string;
  mode: "driving" | "walking";
};

export type ConfigResponse = {
  ok: true;
  jsKey: string;
  securityCode: string;
  mock: boolean;
};

export type TipsResponse = { ok: true; items: Poi[]; mock?: boolean };

export type RefineResponse = {
  ok: true;
  kept: string[];
  reason: string;
  mode: "llm" | "rules";
};

export type ApiFailure = { ok: false; error: string; message?: string };
