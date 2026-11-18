declare global {
  interface Window {
    _AMapSecurityConfig?: { securityJsCode: string };
    AMap?: Record<string, unknown> & { Map: unknown };
  }
}

let loading: Promise<NonNullable<Window["AMap"]>> | null = null;

export function loadAMap(jsKey: string, securityCode?: string) {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    if (securityCode) window._AMapSecurityConfig = { securityJsCode: securityCode };
    const script = document.createElement("script");
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(jsKey)}`;
    script.async = true;
    script.onload = () => (window.AMap ? resolve(window.AMap) : reject(new Error("amap_missing")));
    script.onerror = () => {
      loading = null;
      reject(new Error("amap_load_failed"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export function parsePolyline(polyline: string): [number, number][] {
  return polyline
    .split(";")
    .map((pair) => {
      const [lng, lat] = pair.split(",").map(Number);
      return [lng, lat] as [number, number];
    })
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
}
