// Wrapper `serveEf` (spec 23 — US2). Envuelve Deno.serve, resuelve el requestId de
// correlación (header entrante validado o uno nuevo server-side), loguea ENTRADA/SALIDA
// en JSON (sin body, sin token) y expone el requestId al handler por contexto.
//
// No-leak (R2.9): NUNCA se loguea el body (solo content-length), NUNCA el header
// Authorization ni el JWT crudo; en la salida solo se extrae error.code (nunca message/body).
// La construcción PURA de esos objetos vive en `serve-log.ts` (sin deps Deno-only) para poder
// falsificar el no-leak bajo node:test; acá queda solo el I/O (Deno.serve / handleOptions / backstop).
// El `sub` del JWT que se loguea es best-effort SIN verificar firma — solo etiqueta de traza;
// el actor autoritativo/anti-spoof vive en audit.auth_uid.

import { handleOptions } from './cors.ts';
import { serverError } from './errors.ts';
import { readRequestIdHeader } from './request-headers.ts';
import { buildEfIn, buildEfOut } from './serve-log.ts';

export type EfContext = { requestId: string };
export type EfHandler = (req: Request, ctx: EfContext) => Promise<Response> | Response;

export function serveEf(fn: string, handler: EfHandler): void {
  Deno.serve(async (req) => {
    // Preflight: 204 sin loguear ni medir (un OPTIONS no es una acción de usuario).
    const pre = handleOptions(req);
    if (pre) {
      return pre;
    }

    // R2.2/R2.3/R2.4: el id entrante se usa si tiene forma de uuid; si no vino uno válido, se genera
    // server-side para no perder la traza. La resolución (QUÉ nombres se aceptan y la validación de forma)
    // vive en `request-headers.ts` — rebrand fase 5: se acepta el nombre NUEVO y, si no vino uno válido con
    // ese nombre, el VIEJO. Hay builds instaladas sin OTA que siguen mandando el viejo; **acá** es donde se
    // las atrapa, antes de que el admin client re-emita el id ya con el nombre nuevo hacia PostgREST.
    const requestId = readRequestIdHeader(req) ?? crypto.randomUUID();

    const start = Date.now();

    console.log(JSON.stringify(buildEfIn(fn, requestId, req)));

    let res: Response;
    try {
      res = await handler(req, { requestId });
    } catch (err) {
      res = serverError('unexpected', err);
    }

    console.log(JSON.stringify(await buildEfOut(fn, requestId, res, start)));

    return res;
  });
}
