// access.ts — verificación del JWT de Cloudflare Access (spec 24, delta cloudflare-access). Aislado de
// index.ts para mockearlo en los tests de handler (mismo patrón que `db.ts`). La EF ya NO confía en
// Supabase Auth ni en ningún header de identidad crudo: SOLO en este JWT verificado criptográficamente
// (RCFA.2.9). Importa `npm:jose` (Deno-only) → NO es importable por node:test; su verificación es
// integración deploy-gated (ver progress/impl_24-cloudflare-access-backend.md). Los helpers PUROS del gate
// (allowlist de email + comparación en tiempo constante del proxy secret) viven en `access-helpers.ts`.
//
// [§8 M3] `jose` FIJADO a versión EXACTA `5.9.6` (no `^`/flotante), mismo criterio que `npm:postgres@3.4.5`
// de db.ts. El `deno.lock` de la function se genera + commitea en el deploy (`deno cache`, necesita Deno +
// red npm — ambos gateados), como el `postgres` del baseline.
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5.9.6';
import { HttpError } from '../_shared/auth.ts';

// JWKS remoto cacheado a nivel módulo: `createRemoteJWKSet` cachea las claves y refetchea ante un `kid`
// desconocido (rotación). Persiste mientras la instancia de EF esté caliente (RCFA.2.4). NO es un secreto
// (el JWKS es público). [L-2] Memoiza sin re-evaluar `teamDomain` en caliente → supone UN solo team
// (correcto: hay una única Access application).
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks(teamDomain: string) {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
  }
  return jwks;
}

// Verifica el JWT de Cloudflare Access y devuelve el `email` del PAYLOAD VERIFICADO (nunca de un header
// crudo tipo `Cf-Access-Authenticated-User-Email`), lowercased. Tira `HttpError(401)` sin filtrar detalle
// ante cualquier fallo (RCFA.2.8): firma inválida / aud|iss distinto / exp vencido / forma inválida / JWKS
// inalcanzable / config ausente / email ausente.
export async function verifyAccessJwt(token: string): Promise<{ email: string }> {
  const teamDomain = Deno.env.get('CF_ACCESS_TEAM_DOMAIN'); // <team>.cloudflareaccess.com
  const aud = Deno.env.get('CF_ACCESS_AUD'); // AUD tag de NUESTRA app

  // Fail-closed ante config ausente: sin secrets, NADIE entra (RCFA.2.11).
  if (!teamDomain || !aud) {
    throw new HttpError(401, 'unauthorized', 'Sin acceso.');
  }

  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, getJwks(teamDomain), {
      algorithms: ['RS256'], // SOLO RS256: rechaza alg:none / HS256 / substitution (RCFA.2.3)
      issuer: `https://${teamDomain}`, // iss EXACTO = team (RCFA.2.6)
      audience: aud, // aud EXACTO = nuestra app, no cualquiera del team (RCFA.2.5)
      // exp lo valida jwtVerify por defecto (RCFA.2.7). clockTolerance queda en 0 (estricto).
    }));
  } catch (_e) {
    // No se propaga el detalle del error de jose al cliente (no-leak, R7.2). 401 genérico (RCFA.2.8).
    throw new HttpError(401, 'unauthorized', 'Sin acceso.');
  }

  const email = payload.email;
  if (typeof email !== 'string' || email === '') {
    throw new HttpError(401, 'unauthorized', 'Sin acceso.'); // RCFA.2.10
  }
  return { email: email.toLowerCase() };
}
