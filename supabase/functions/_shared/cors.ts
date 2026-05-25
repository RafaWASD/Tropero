// CORS helpers compartidos para Edge Functions.
// Permitimos cualquier origin durante MVP (la app móvil llama con headers
// específicos pero también queremos poder hacer pruebas desde el dashboard).
// En producción ajustar a la lista de dominios oficiales.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function handleOptions(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return null;
}
