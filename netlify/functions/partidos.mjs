// Lee calendario y resultados de la Federación Canaria de Voleibol (plataforma Leverade)
import { getStore } from "@netlify/blobs";

const API = "https://api.leverade.com";

const GROUPS = [
  { id: "3711352", key: "masc", nombre: "Sénior Masculina · Grupo Tenerife" },
  { id: "3711351", key: "masc-gc", nombre: "Sénior Masculina · Grupo Gran Canaria" },
  { id: "3711343", key: "fem", nombre: "Sénior Femenina · Grupo Oro" },
];

async function fetchAll(group, include) {
  const data = [];
  const included = new Map();
  let url = `${API}/matches?filter=round.group.id:${group.id}&include=${include}&page[size]=50`;
  let guard = 0;
  while (url && guard++ < 20) {
    const res = await fetch(url, { headers: { Accept: "application/vnd.api+json" } });
    if (!res.ok) throw new Error(`Leverade ${res.status}`);
    const json = await res.json();
    data.push(...(json.data || []));
    for (const inc of json.included || []) included.set(`${inc.type}:${inc.id}`, inc);
    url = json.links?.next || null;
  }
  return { data, included };
}

// TEMPORAL: muestra en los registros cómo publica la federación los parciales
let diagHecho = false;
async function diagnostico(group, data, included, nested) {
  if (diagHecho) return;
  const m = data.find((x) => x.attributes.finished);
  if (!m) return;
  diagHecho = true;
  const res = (m.relationships?.results?.data || []).map((x) => included.get(`result:${x.id}`));
  const periodos = [...included.values()].filter((x) => x.type === "period").slice(0, 3);
  console.log("DIAG1", JSON.stringify({ grupo: group.key, nested, partido: m.id, nResults: res.length, results: res, periodos }).slice(0, 3500));
  for (const url of [
    `${API}/results?filter=parent.id:${m.id}&include=period&page[size]=30`,
    `${API}/results?filter=parent.id:${res[0]?.id}&include=period&page[size]=30`,
    `${API}/results?filter=team.id:${res[0]?.relationships?.team?.data?.id}&include=period,parent&page[size]=30`,
    `${API}/matches?filter=id:${m.id}&include=results.period,results.children,periods`,
    `${API}/periods?filter=match.id:${m.id}`,
  ]) {
    try {
      const r = await fetch(url, { headers: { Accept: "application/vnd.api+json" } });
      const t = await r.text();
      console.log("DIAG2", r.status, url, t.slice(0, 3500));
    } catch (e) { console.log("DIAG2 fallo", url, String(e)); }
  }
}

async function fetchGroup(group) {
  // Con "results.period" llegan los parciales de cada set; si la API no lo admite, se piden sin ellos.
  let r;
  try {
    r = await fetchAll(group, "round,facility,results,results.period,teams");
    r.nested = "ok";
  } catch (e) {
    r = await fetchAll(group, "round,facility,results,teams");
    r.nested = String(e);
  }
  const { data, included } = r;
  diagnostico(group, data, included, r.nested).catch((e) => console.log("DIAG error", String(e)));

  const get = (type, id) => (id ? included.get(`${type}:${id}`) : null);
  const equipos = new Map();

  const partidos = data
    .filter((m) => !m.attributes.rest)
    .map((m) => {
      const a = m.attributes;
      const rel = m.relationships || {};
      const round = get("round", rel.round?.data?.id);
      const fac = get("facility", rel.facility?.data?.id);
      const homeId = m.meta?.home_team;
      const awayId = m.meta?.away_team;
      const team = (id) => {
        const t = get("team", id);
        if (!t) return null;
        const eq = { id, nombre: t.attributes.name, escudo: t.meta?.avatar?.large || null };
        equipos.set(id, eq);
        return eq;
      };
      const sets = {};
      const parciales = new Map(); // id del periodo -> { orden, puntos por equipo }
      for (const r of rel.results?.data || []) {
        const res = get("result", r.id);
        const tid = res?.relationships?.team?.data?.id;
        if (!tid || res.attributes.value === null || res.attributes.value === undefined) continue;
        const pid = res.relationships?.period?.data?.id;
        if (!pid) {
          sets[tid] = Number(res.attributes.value);
        } else {
          const per = get("period", pid);
          const orden = Number(per?.attributes?.order ?? per?.attributes?.number ?? pid);
          if (!parciales.has(pid)) parciales.set(pid, { orden, pid: Number(pid) || 0, p: {} });
          parciales.get(pid).p[tid] = Number(res.attributes.value);
        }
      }
      const listaSets = [...parciales.values()]
        .filter((x) => homeId in x.p && awayId in x.p && x.p[homeId] + x.p[awayId] > 0)
        .sort((a, b) => a.orden - b.orden || a.pid - b.pid)
        .map((x) => [x.p[homeId], x.p[awayId]]);
      // Si solo hay parciales, el marcador en sets se calcula a partir de ellos
      if (!(homeId in sets && awayId in sets) && listaSets.length) {
        sets[homeId] = listaSets.filter(([l, v]) => l > v).length;
        sets[awayId] = listaSets.filter(([l, v]) => v > l).length;
      }
      const tieneResultado = homeId in sets && awayId in sets;
      // Coherencia: tantos parciales como sets jugados; si no cuadra, no se muestran
      if (tieneResultado && listaSets.length !== sets[homeId] + sets[awayId]) listaSets.length = 0;
      return {
        id: m.id,
        grupo: group.key,
        jornada: round ? Number(round.attributes.order) || round.attributes.name : null,
        // Leverade devuelve la hora en UTC
        fecha: a.datetime ? a.datetime.replace(" ", "T") + "Z" : null,
        finalizado: !!a.finished,
        cancelado: !!a.canceled,
        aplazado: !!a.postponed,
        local: team(homeId),
        visitante: team(awayId),
        resultado: tieneResultado ? { local: sets[homeId], visitante: sets[awayId], sets: listaSets } : null,
        pabellon: fac
          ? {
              nombre: fac.attributes.name,
              direccion: [fac.attributes.address, fac.attributes.city].filter(Boolean).join(", ") || null,
              lat: fac.attributes.latitude || null,
              lng: fac.attributes.longitude || null,
            }
          : null,
      };
    });

  return { ...group, equipos: [...equipos.values()], partidos };
}

const cacheStore = () => {
  try { return getStore("cache"); } catch { return null; }
};

export default async () => {
  const store = cacheStore();
  try {
    const grupos = await Promise.all(GROUPS.map(fetchGroup));
    const body = { actualizado: new Date().toISOString(), origen: "federacion", grupos };
    await store?.setJSON("partidos", body).catch(() => {});
    return Response.json(body, {
      headers: {
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Netlify-CDN-Cache-Control": "public, durable, s-maxage=900, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    const copia = store ? await store.get("partidos", { type: "json" }).catch(() => null) : null;
    if (copia) {
      return Response.json({ ...copia, origen: "copia" }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "No se pudo contactar con la federación" }, { status: 502 });
  }
};

export const config = { path: "/api/partidos" };
