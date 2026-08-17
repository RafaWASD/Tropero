/** requestId de correlación: uuid v4 random, sin significado (no-PII). Spec 23. */
export function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * El header de wire que lleva el requestId a las Edge Functions (spec 23 R1.4). UNA sola definición para
 * los tres call-sites (`services/account.ts`, `services/members.ts`, `services/push-notifications.ts`):
 * tres literales que tienen que coincidir sin que nada lo verifique es cómo se pierde la correlación de
 * una sola de las tres acciones sin que nadie se entere.
 *
 * El backend acepta además el nombre PRE-rebrand (`X-Rafaq-Request-Id`) mientras queden builds instaladas
 * sin actualizar — no hay OTA. Ver `supabase/functions/_shared/request-headers.ts` y la entrada de
 * limpieza en `docs/backlog.md`. Desde el cliente se escribe SOLO el nombre nuevo.
 *
 * La válvula del guard de marca es deliberada, y la decisión está escrita en
 * `progress/rebrand-fase5-headers.md` §5: es un nombre de header de WIRE, no el wordmark. Se resolvió con
 * válvula por línea en vez de con un carve-out de forma en `brand-name-guard.test.ts` porque acá hay UNA
 * línea (la constante compartida colapsa los tres call-sites), y un carve-out por forma —"precedido de
 * `-`", "empieza con `X-`"— eximiría también texto de UI que contenga esa forma. La válvula exige razón
 * escrita, vive donde vive la excepción y muere con la línea.
 */
export const REQUEST_ID_HEADER = 'X-Mitropero-Request-Id'; // brand-name-disable-line -- header de wire, no el wordmark
