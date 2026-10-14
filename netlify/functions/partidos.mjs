// Lee calendario y resultados de la Federación Canaria de Voleibol (plataforma Leverade)
import { getStore } from "@netlify/blobs";

const API = "https://api.leverade.com";

const GROUPS = [
  { id: "3711352", key: "masc", nombre: "Sénior Masculina · Grupo Tenerife" },
  { id: "3711343", key: "fem", nombre: "Sénior Femenina · Grupo Oro" },
];

async function fetchGroup(group) {
  const data = [];
  const included = new Map();
  let url = `${API}/matches?filter=round.group.id:${group.id}&include=round,facility,results,teams&page[size]=50`;
  let guard = 0;
  while (url && guard++ < 20) {
    const res = await fetch(url, { headers: { Accept: "application/vnd.api+json" } });
    if (!res.ok) throw new Error(`Leverade ${res.status}`);
    const json = await res.json();
    data.push(...(json.data || []));
    for (const inc of json.included || []) included.set(`${inc.type}:${inc.id}`, inc);
    url = json.links?.next || null;
  }

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
      for (const r of rel.results?.data || []) {
        const res = get("result", r.id);
        const tid = res?.relationships?.team?.data?.id;
        if (tid && !res.relationships?.period?.data && res.attributes.value !== null) {
          sets[tid] = Number(res.attributes.value);
        }
      }
      const tieneResultado = homeId in sets && awayId in sets;
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
        resultado: tieneResultado ? { local: sets[homeId], visitante: sets[awayId] } : null,
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
