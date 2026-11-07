// Marcador en directo de los partidos que se están jugando (punto a punto, según los publica la federación)
const API = "https://api.leverade.com";

async function partido(id) {
  const url = `${API}/matches?filter=id:${id}&include=results,periods,periods.results`;
  const res = await fetch(url, { headers: { Accept: "application/vnd.api+json" } });
  if (!res.ok) throw new Error(`Leverade ${res.status}`);
  const json = await res.json();
  const m = json.data?.[0];
  if (!m) return null;
  const inc = new Map((json.included || []).map((x) => [`${x.type}:${x.id}`, x]));
  const homeId = m.meta?.home_team;
  const awayId = m.meta?.away_team;

  // Puntos de cada periodo (set) por equipo
  const puntos = new Map();
  for (const x of inc.values()) {
    if (x.type !== "result") continue;
    const pid = x.relationships?.period?.data?.id;
    const tid = x.relationships?.team?.data?.id;
    if (!pid || !tid || x.attributes.value == null) continue;
    if (!puntos.has(pid)) puntos.set(pid, {});
    puntos.get(pid)[tid] = Number(x.attributes.value);
  }
  const periodos = (m.relationships?.periods?.data || [])
    .map((p) => inc.get(`period:${p.id}`))
    .filter(Boolean)
    .sort((a, b) => Number(a.attributes.order) - Number(b.attributes.order));

  const sets = [];
  let actual = null;
  for (const per of periodos) {
    const p = puntos.get(per.id) || {};
    const l = p[homeId] ?? 0;
    const v = p[awayId] ?? 0;
    if (per.attributes.finished) sets.push([l, v]);
    else if (!actual && l + v > 0) actual = [l, v];
  }

  // Sets ganados: los que publica la federación o, si no, los contados
  const total = {};
  for (const r of m.relationships?.results?.data || []) {
    const x = inc.get(`result:${r.id}`);
    const tid = x?.relationships?.team?.data?.id;
    if (tid && !x.relationships?.period?.data && x.attributes.value != null) total[tid] = Number(x.attributes.value);
  }
  const ganadosL = sets.filter(([l, v]) => l > v).length;
  const ganadosV = sets.filter(([l, v]) => v > l).length;

  return {
    id: m.id,
    finalizado: !!m.attributes.finished,
    local: Math.max(total[homeId] ?? 0, ganadosL),
    visitante: Math.max(total[awayId] ?? 0, ganadosV),
    sets,
    actual,
  };
}

export default async (req) => {
  const ids = [...new Set((new URL(req.url).searchParams.get("ids") || "").split(","))]
    .filter((x) => /^\d{1,15}$/.test(x))
    .sort()
    .slice(0, 8);
  if (!ids.length) return Response.json({ error: "Faltan ids" }, { status: 400 });

  const resultados = await Promise.allSettled(ids.map(partido));
  const out = {};
  resultados.forEach((r, i) => { if (r.status === "fulfilled" && r.value) out[ids[i]] = r.value; });

  return Response.json(
    { actualizado: new Date().toISOString(), partidos: out },
    {
      headers: {
        "Cache-Control": "public, max-age=0, must-revalidate",
        // Todos los que miren a la vez comparten la misma respuesta durante 20 s
        "Netlify-CDN-Cache-Control": "public, durable, s-maxage=20",
      },
    },
  );
};

export const config = { path: "/api/vivo" };
