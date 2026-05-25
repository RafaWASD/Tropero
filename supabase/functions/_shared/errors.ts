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
