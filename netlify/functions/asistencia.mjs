// Quién va a cada partido. Cada respuesta es una clave propia:
//   <idPartido>/<nombre>/<estado>
// así no hay lecturas-modificaciones-escrituras que se pisen entre amigos.
import { getStore } from "@netlify/blobs";

const ESTADOS = ["voy", "quizas", "no"];
const store = () => getStore({ name: "asistencia", consistency: "strong" });

const limpiarNombre = (n) => String(n || "").replace(/\s+/g, " ").trim().slice(0, 30);

async function leerTodo() {
  const { blobs } = await store().list();
  const out = {};
  for (const { key } of blobs) {
    const [partido, nombreEnc, estado] = key.split("/");
    if (!partido || !nombreEnc || !ESTADOS.includes(estado)) continue;
    (out[partido] ||= []).push({ nombre: decodeURIComponent(nombreEnc), estado });
  }
  return out;
}

export default async (req) => {
  const headers = { "Cache-Control": "no-store" };

  if (req.method === "GET") {
    return Response.json(await leerTodo(), { headers });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "JSON inválido" }, { status: 400, headers });
    }
    const partido = String(body.partido || "");
    const nombre = limpiarNombre(body.nombre);
    const estado = body.estado;
    if (!/^\d{1,15}$/.test(partido)) return Response.json({ error: "Partido inválido" }, { status: 400, headers });
    if (!nombre) return Response.json({ error: "Falta el nombre" }, { status: 400, headers });
    if (estado !== null && !ESTADOS.includes(estado)) {
      return Response.json({ error: "Estado inválido" }, { status: 400, headers });
    }

    const s = store();
    const prefijo = `${partido}/${encodeURIComponent(nombre)}/`;
    const { blobs } = await s.list({ prefix: prefijo });
    await Promise.all(blobs.map((b) => s.delete(b.key)));
    if (estado) await s.set(prefijo + estado, new Date().toISOString());

    return Response.json(await leerTodo(), { headers });
  }

  return new Response("Método no permitido", { status: 405, headers });
};

export const config = { path: "/api/asistencia" };
