// Capa de datos del perfil propio (spec 01, Fase 6 — ProfileContext).
//
// El `name` sale de `public.users` (perfil público); el `phone` se separó a
// `public.user_private` (PII de contacto self-only, spec 14 / ADR-025). El email NO se lee de
// acá: el ProfileContext lo toma del session de auth (AuthContext), que es siempre el email
// fresco tras confirmar un cambio (R2.2). Así eliminamos la desincronización del saludo que
// tenía Run 2 (que sincronizaba el nombre a auth.user_metadata además de a public.users).
//
// LECTURA (spec 15, T3.2): desde el SQLite local de PowerSync (self-only sincronizado por las streams
// self_user_private + est_members/self). El scoping self-only (user_id = auth.uid()) ya lo aplicó la
// stream → no se re-filtra. NUNCA se hardcodea nada del usuario; sale del propio user vía la stream.

import { buildOwnNameQuery, buildOwnPhoneQuery } from './powersync/local-reads';
import { runLocalQuerySingle } from './powersync/local-query';

export type ProfileNamePhone = { name: string; phone: string | null };

export type LoadProfileNamePhoneResult =
  | { ok: true; profile: ProfileNamePhone }
  | { ok: false; error: { kind: 'network' | 'unknown'; message: string } };

/**
 * Lee name (de `public.users`) + phone (de `public.user_private`) del perfil propio para el
 * ProfileContext. El email NO se trae acá (lo da el session de auth). Si la fila de users no existe
 * (debería crearla el trigger on_auth_user_created), reporta unknown en vez de fabricar datos.
 *
 * El phone vive en `user_private` (spec 14): lo leemos con su propia query self-only. Si esa fila
 * faltara (no debería: el trigger de signup la crea junto con users), tratamos phone como null en
 * vez de fallar — el name (perfil público) es suficiente para el saludo; el teléfono es opcional.
 */
export async function loadProfileNamePhone(
  userId: string,
): Promise<LoadProfileNamePhoneResult> {
  // name desde users (self) en el SQLite local (T3.2). emptyIsSyncing:true → pre-sync ausente degrada
  // "sincronizando"; post-sync ausente → "no se encontró el perfil" (igual que el path PostgREST).
  const nameRes = await runLocalQuerySingle<{ name: string | null }>(buildOwnNameQuery(userId), {
    emptyIsSyncing: true,
  });
  if (!nameRes.ok) return { ok: false, error: nameRes.error };
  if (!nameRes.value) {
    return {
      ok: false,
      error: { kind: 'unknown', message: 'No se encontró el perfil del usuario.' },
    };
  }

  // phone desde user_private (self). Ausente = null (resultado legítimo: el teléfono es opcional),
  // no se degrada — el name (perfil público) basta para el saludo.
  const privRes = await runLocalQuerySingle<{ phone: string | null }>(buildOwnPhoneQuery(userId));
  if (!privRes.ok) return { ok: false, error: privRes.error };

  return { ok: true, profile: { name: nameRes.value.name ?? '', phone: privRes.value?.phone ?? null } };
}
