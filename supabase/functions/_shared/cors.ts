// CORS helpers compartidos para Edge Functions.
// Permitimos cualquier origin durante MVP (la app móvil llama con headers
// específicos pero también queremos poder hacer pruebas desde el dashboard).
// En producción ajustar a la lista de dominios oficiales.

import { ACCEPTED_REQUEST_ID_HEADERS } from './request-headers.ts';

/** Headers de infra que siempre viajan (Supabase + JSON). Los propios se DERIVAN de los que la EF acepta. */
const BASE_ALLOWED_HEADERS = ['authorization', 'x-client-info', 'apikey', 'content-type'];

// ⚠️ El Allow-Headers NO se escribe a mano: se deriva de `ACCEPTED_REQUEST_ID_HEADERS`. Un header que la EF
// LEA pero el preflight no permita es un request que el navegador ni llega a mandar — y en nativo no hay
// preflight, así que el skew sólo se ve en web (fue el bug de CORS de la spec 23). Derivándolo, agregar o
// sacar un nombre en `request-headers.ts` mueve las dos puntas juntas o ninguna.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': [
    ...BASE_ALLOWED_HEADERS,
    ...ACCEPTED_REQUEST_ID_HEADERS.map((h) => h.toLowerCase()),
  ].join(', '),
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function handleOptions(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return null;
}
