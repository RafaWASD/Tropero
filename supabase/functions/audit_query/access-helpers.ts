// access-helpers.ts — helpers PUROS del gate de auth de la EF `audit_query` (delta cloudflare-access).
// Sin deps Deno-only (solo globals JS + `TextEncoder`, web-estándar) → node:test los ejerce EXACTAMENTE
// como corren en producción (mismo patrón que `query.ts`, no un espejo a mano). Aislados de `access.ts`
// (que importa `npm:jose`, Deno-only y no importable por node) para poder falsificarlos en el harness node.
//
// Por qué un módulo nuevo y no `query.ts`: la instrucción de esta corrida fija `query.ts`/`db.ts` INTACTOS
// (preservar las garantías §8 M2/M3 y su suite). El design §3.3 sugería `query.ts`; se reconcilia acá.

// TextEncoder reutilizado a nivel módulo (no re-alocar por request).
const encoder = new TextEncoder();

// Comparación byte-a-byte en TIEMPO CONSTANTE respecto del CONTENIDO: XOR-acumula sobre el largo máximo y
// funde la diferencia de largo en el acumulador (`a.length ^ b.length`), de modo que NO hay early-return en
// la primer diferencia (lo que filtraría bytes del secreto por timing) ni cortocircuito por largo distinto.
// Leer más allá del fin de cualquiera de los dos arrays devuelve 0 (costo constante), nunca un return
// anticipado. (Es el "patrón equivalente" a `crypto.subtle.timingSafeEqual`, que además exige largos iguales
// y no está garantizado en todos los runtimes.) Residual conocido y aceptado: el número de iteraciones
// depende del largo máximo → puede filtrar el LARGO del secreto, no su contenido; despreciable para un token
// random fuerte detrás de Access.
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

// [M-1] Gate del secreto compartido Function↔EF. FAIL-CLOSED: si el secret del env está ausente/vacío,
// NADIE pasa (aunque el header venga poblado) — igual que los `CF_ACCESS_*`. Si el header del cliente está
// ausente/vacío, tampoco. Solo matchea si AMBOS están presentes y son byte-idénticos (tiempo constante). El
// early-return es sobre PRESENCIA (no sobre contenido del secreto) → no filtra bytes.
export function proxySecretMatches(
  headerValue: string | null | undefined,
  envSecret: string | null | undefined,
): boolean {
  if (typeof envSecret !== 'string' || envSecret === '') return false; // fail-closed ante env ausente
  if (typeof headerValue !== 'string' || headerValue === '') return false;
  return timingSafeEqualBytes(encoder.encode(headerValue), encoder.encode(envSecret));
}

// Allowlist OPCIONAL de emails de staff (defensa en profundidad, RCFA.2.13). Devuelve `null` si el secret
// está ausente/vacío/solo-espacios ⇒ Access es la autoridad y NO se filtra por email. `null` NO es fail-open:
// el gate real (JWT válido para NUESTRO `aud`) ya corrió; esto es un segundo muro opcional. Un `Set<string>`
// de emails lowercased si viene poblado; tokens en blanco se descartan.
export function parseEmailAllowlist(secret: string | null | undefined): Set<string> | null {
  if (typeof secret !== 'string' || secret.trim() === '') return null;
  const emails = secret
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== '');
  if (emails.length === 0) return null;
  return new Set(emails);
}
