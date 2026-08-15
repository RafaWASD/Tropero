// serve-log.ts — lógica PURA de construcción de los logs estructurados del wrapper `serveEf`
// (spec 23 — US2, R2.6/R2.7/R2.8/R2.9). Extraída de serve.ts para poder FALSIFICAR el invariante de
// no-leak bajo node:test SIN dependencias Deno-only: este módulo usa SOLO globals web (Request, Response,
// atob, JSON). serve.ts importa estas 3 funciones y mantiene el Deno.serve / handleOptions / backstop.
//
// Invariante de seguridad (R2.8/R2.9): los objetos que salen de acá NUNCA contienen el body del request
// ni el body de la respuesta, ni el header Authorization / el JWT crudo / ningún token. De la ENTRADA solo
// se loguea el TAMAÑO del body (`bodyBytes`) y el `sub` best-effort (`actor`); de la SALIDA solo `error.code`
// en 4xx/5xx — nunca `message` ni el body.

export type EfInLog = {
  evt: 'ef_in';
  fn: string;
  requestId: string;
  bodyBytes: number | null;
  actor: string | undefined;
};

export type EfOutLog = {
  evt: 'ef_out';
  fn: string;
  requestId: string;
  status: number;
  code: string | undefined;
  ms: number;
};

// best-effort: `sub` del payload del JWT del header Authorization, SIN verificar firma.
// try/catch → undefined ante cualquier fallo. Nunca devuelve/loguea el token crudo.
export function readSubBestEffort(req: Request): string | undefined {
  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return undefined;
    const token = auth.replace(/^Bearer\s+/i, '');
    const payloadSeg = token.split('.')[1];
    if (!payloadSeg) return undefined;
    // base64url → base64 y decode.
    const b64 = payloadSeg.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64);
    const payload = JSON.parse(json);
    const sub = payload?.sub;
    return typeof sub === 'string' ? sub : undefined;
  } catch {
    return undefined;
  }
}

// Objeto de ENTRADA (R2.6): evt/fn/requestId + TAMAÑO del body (NO el body) + actor best-effort.
// NUNCA incluye el header Authorization ni el JWT crudo.
export function buildEfIn(fn: string, requestId: string, req: Request): EfInLog {
  return {
    evt: 'ef_in',
    fn,
    requestId,
    bodyBytes: Number(req.headers.get('content-length')) || null,
    actor: readSubBestEffort(req),
  };
}

// Objeto de SALIDA (R2.7): evt/fn/requestId/status/ms + SOLO `error.code` cuando status>=400.
// Clona la respuesta para leer el code sin consumir el body real; ante body no-JSON → code undefined.
// NUNCA loguea `message` ni el body de la respuesta. En 2xx no parsea nada.
export async function buildEfOut(
  fn: string,
  requestId: string,
  res: Response,
  startMs: number,
): Promise<EfOutLog> {
  let code: string | undefined;
  if (res.status >= 400) {
    try {
      const body = await res.clone().json();
      code = body?.error?.code;
    } catch {
      /* no-op: no se loguea message ni body */
    }
  }
  return {
    evt: 'ef_out',
    fn,
    requestId,
    status: res.status,
    code,
    ms: Date.now() - startMs,
  };
}
