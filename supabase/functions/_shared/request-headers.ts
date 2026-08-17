// Nombres de los headers de wire propios (actor de auditoría + id de correlación) y la resolución
// TOLERANTE del rebrand miTropero. Módulo PURO (solo globals web: Request/Headers) — sin deps Deno-only,
// para poder falsificarlo con `node:test` (`request-headers.test.ts`), igual que `serve-log.ts`.
//
// ── POR QUÉ EXISTE ESTE MÓDULO ───────────────────────────────────────────────────────────────────────
// Los nombres se escribían como literales en TRES lugares del backend: el que LEE (`serve.ts`), el que
// ESCRIBE (`supabase.ts` → admin client) y el que PUBLICA en CORS (`cors.ts`). Tres literales que tienen
// que coincidir sin que nada lo verifique = el mismo modo de falla que ya mordió en la spec 23 (un header
// que el servidor lee pero el preflight no permite: en web el request muere y en nativo no se nota).
// Con una sola definición, el Allow-Headers se DERIVA de lo que el servidor lee y el skew es imposible.
//
// ── EL RENAME EN DOS TIEMPOS (rebrand fase 5) ────────────────────────────────────────────────────────
// Hay builds instaladas afuera (TestFlight + el APK de los testers) y NO hay OTA (`app/app.config.ts` no
// tiene bloque `updates`): la única forma de que un cliente instalado cambie de header es que alguien
// instale una build nueva a mano, y eso puede no pasar nunca. Con corte seco, esos clientes seguirían
// mandando el nombre viejo y todo lo que hicieran entraría al audit con `request_id` NULL — no rompe nada
// visible, la correlación se pierde EN SILENCIO, que para una feature de auditoría es el peor modo de
// falla. Por eso: el servidor LEE LOS DOS nombres y los clientes ESCRIBEN SOLO EL NUEVO.
//
// La limpieza (sacar los `LEGACY_*` y su entrada de CORS) es una fase aparte, cuando no queden clientes
// viejos. Está anotada en `docs/backlog.md` con la condición que la habilita — no la hagas acá.

/** Actor real de la mutación (spec 18). Lo escribe el admin client de las EFs; lo lee `audit.resolve_actor()`. */
export const ACTOR_HEADER = 'X-Mitropero-Actor';

/** Id de correlación de la acción (spec 23). Lo escribe el cliente y el admin client; lo leen `serveEf` y `audit.resolve_request_id()`. */
export const REQUEST_ID_HEADER = 'X-Mitropero-Request-Id';

/**
 * Nombre PRE-rebrand del actor. **Nada en TypeScript lo lee ni lo escribe**: quien lo acepta es
 * `audit.resolve_actor()` en la base (migración `0133`), para la ventana en que una EF todavía no
 * redeployada le manda ese nombre a PostgREST. Se declara acá igual por dos motivos concretos: que la fase
 * de limpieza tenga UN inventario de nombres viejos en vez de buscarlos por el árbol, y que
 * `request-headers.test.ts` pueda afirmar que CORS **no** lo publica (el actor nunca viene del caller).
 */
export const LEGACY_ACTOR_HEADER = 'X-Rafaq-Actor';

/** Nombre PRE-rebrand del id de correlación. Se sigue LEYENDO (nunca escribiendo) mientras existan clientes viejos. */
export const LEGACY_REQUEST_ID_HEADER = 'X-Rafaq-Request-Id';

/**
 * Los nombres que una Edge Function ACEPTA en el request ENTRANTE — hoy sólo el id de correlación, en sus
 * dos grafías. De acá se derivan las dos cosas que tienen que moverse juntas: lo que `readRequestIdHeader`
 * lee y lo que `cors.ts` publica en `Access-Control-Allow-Headers`.
 *
 * ⚠️ Los headers de ACTOR NO están en esta lista **a propósito**: ningún cliente los manda ni ninguna EF
 * los lee del request entrante. Los mintea el admin client de la EF (`supabase.ts`) hacia PostgREST, con
 * el `user.id` del JWT ya validado. Publicarlos en CORS sería anunciar que se aceptan del navegador — y
 * el modelo anti-spoof depende justamente de que el actor NUNCA venga del caller.
 */
export const ACCEPTED_REQUEST_ID_HEADERS: readonly string[] = [
  REQUEST_ID_HEADER,
  LEGACY_REQUEST_ID_HEADER,
];

/** uuid canónico 8-4-4-4-12. Un header que no matchea se trata como ausente (R2.4 de spec 23). */
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Lee el id de correlación entrante aceptando los DOS nombres, en el orden de
 * `ACCEPTED_REQUEST_ID_HEADERS`: devuelve el PRIMERO que trae un uuid **válido**.
 *
 * ⚠️ Es "el primero VÁLIDO", no "el primero PRESENTE", y la diferencia importa: con un header nuevo vacío
 * o con basura y un header viejo bueno, "el primero presente" devolvería la basura → `serveEf` la
 * descartaría y generaría un id server-side → **se perdería la correlación con el id que el cliente ya
 * puso en su evento de dominio**, que es justo lo que esta feature existe para evitar. Además así el
 * criterio es el MISMO que el de `audit.resolve_request_id()` en la base (migración 0133): las dos capas
 * resuelven igual, en vez de tener dos reglas de precedencia parecidas.
 *
 * Devuelve `null` si no vino ninguno válido → el llamador genera uno server-side (R2.3/R2.4 de spec 23).
 */
export function readRequestIdHeader(req: Request): string | null {
  for (const name of ACCEPTED_REQUEST_ID_HEADERS) {
    const value = req.headers.get(name);
    if (value !== null && UUID_RE.test(value)) return value;
  }
  return null;
}
