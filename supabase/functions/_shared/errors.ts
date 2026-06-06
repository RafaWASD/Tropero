import { corsHeaders } from './cors.ts';

const jsonHeaders = {
  ...corsHeaders,
  'Content-Type': 'application/json',
};

export function jsonError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): Response {
  return new Response(
    JSON.stringify({ error: { code, message, ...(extra ?? {}) } }),
    { status, headers: jsonHeaders },
  );
}

export function jsonOk<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

// serverError (spec 13 — B1-1): para CUALQUIER 5xx. Loguea el detalle real server-side
// (console.error → logs de la EF) y devuelve al cliente un copy genérico estable, SIN el
// .message del driver Postgres/Deno (information disclosure de schema: nombres de
// tabla/columna/constraint/path se filtraban por el 3er arg crudo de jsonError). El `code`
// estable ('db_error' | 'unexpected') se conserva para que el cliente diferencie. Los 4xx
// con copy a mano siguen usando jsonError directo (no se tocan).
export function serverError(code: string, detail: unknown): Response {
  console.error(`[serverError:${code}]`, detail);
  return jsonError(500, code, 'Error interno, probá de nuevo.');
}
