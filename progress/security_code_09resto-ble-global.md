# Security code review — spec 09 chunk "BLE global" (Gate 2)

**Veredicto: PASS**

- **Modo:** `code` (Gate 2, post-reviewer APPROVED).
- **Baseline:** `b0700ff` (HEAD). El chunk vive en el working tree, sin commitear (trabajamos sobre `main`, sin feature-branches).
- **Diff analizado:** `git diff b0700ff` + `git status --porcelain` filtrado al scope del chunk (se IGNORARON `specs/active/08-export-sigsa/*` y `security_spec_08*` — son de otra terminal).
- **Naturaleza del cambio:** frontend puro RN/Expo + un builder de SQL PURO. SIN migraciones / RLS / Edge Functions nuevas. El único write server-side es el RPC `transfer_animal` (0087, SECURITY DEFINER) ya gateado en su propio Gate 1/2 (spec 11).
- **Skill Sentry `security-review`:** corrida sobre el diff. No reportó findings HIGH-confidence; coincide con la validación manual.

## Findings HIGH

**Ninguno.** No hay findings HIGH-confidence que bloqueen el gate.

## Validación de los 6 focos del brief

### Foco 1 — Flag/bridge de E2E (`window.__rafaqBle` bajo `window.__RAFAQ_BLE_E2E__`) — OK

El MockAdapter y el handle de `window` NO existen en un build de producción normal. Cadena verificada:

- `app/app/_layout.tsx:437` — `{isBleE2E() ? <BleE2EBridge /> : null}`: el bridge solo se monta bajo el flag.
- `app/app/_layout.tsx:500` — `<BleStickListenerProvider mode={isBleE2E() ? 'mock' : 'auto'}>`: en prod el modo es `'auto'`.
- `app/src/services/ble/adapter-selection.ts:32-38` — `selectTransportAdapter`: `mode='auto'` NUNCA devuelve `'mock'` (solo `web-serial`/`manual`). Por lo tanto en prod jamás se instancia `MockAdapter` (`BleStickListenerProvider.tsx:64-79`).
- `app/app/_components/BleE2EBridge.tsx:38-39` — doble guard: aunque el bridge se montara, `if (!isBleE2E()) return;` aborta antes de publicar el handle; y `asMockAdapter()` (29-33) exige `transport.kind === 'mock'`, que en prod es null/web-serial → `return` sin publicar nada.
- `app/app/_components/ble-e2e-flag.ts:21-30` — `isBleE2E()` lee EXCLUSIVAMENTE `globalThis.__RAFAQ_BLE_E2E__ === true`. No hay otra fuente.

**¿Puede un atacante forzar el flag en runtime e inyectar EIDs?** No de forma que importe a la seguridad:

1. El flag se lee en el `mode` del provider (`_layout.tsx:500`) y en `BleHost` (`:437`), ambos en el árbol de React montado UNA vez al boot. Playwright lo setea con `addInitScript` ANTES del bundle (`baston.spec.ts:48`). Setear `window.__RAFAQ_BLE_E2E__=true` DESPUÉS del boot no re-monta el provider con `mode='mock'` (el `useMemo` de `BleStickListenerProvider.tsx:102-105` depende de `mode`, que ya quedó fijado en `'auto'`) → no aparece un MockAdapter ni el handle.
2. Aun en el caso teórico de que alguien lograra publicar `window.__rafaqBle.tagRead(eid)`, eso solo inyecta una LECTURA de bastón en el cliente del PROPIO atacante (autenticado, en su propia sesión/navegador). Equivale a tipear un EID en su propia app: el EID pasa por `EidIngestEngine` (validate FDX-B + dedup, `BleStickListenerProvider.tsx:119`) y dispara el mismo find-or-create que un escaneo real. No cruza a otra sesión ni bypassea ninguna autorización server-side. No es un vector de privilegio.

Conclusión: superficie de test correctamente aislada del runtime de producción. No hay handle colgado.

### Foco 2 — `buildLookupTagAcrossFieldsQuery` sin filtro de establishment activo — OK (no debilita el aislamiento multi-tenant)

`app/src/services/powersync/local-reads.ts:683-694`. Corre SIN `establishment_id = ?` a propósito (RB4.6: detectar que el EID vive en OTRO campo del usuario → modo transfer). NO debilita el aislamiento:

- **Lee solo el set YA sincronizado al SQLite local.** Ese set fue scopeado server-side por la sync stream `est_animal_profiles` (`has_role_in`): solo bajan los perfiles de campos donde el usuario TIENE rol. La query cross-campo no puede ver una fila que la stream no haya replicado → no hay camino a un campo donde el usuario no tenga rol. La barrera final sigue siendo la RLS de spec 02/11 en el server (el cliente nunca lee del server acá; es 100% local).
- **El `JOIN establishments e` (`:689`) solo proyecta `e.name`** (`establishment_name`, `:687`). El name del campo es exactamente lo que la UI necesita mostrar ("Está en {otro campo}") y solo bajan al local los establishments donde el usuario es miembro (mismo set que `buildMembershipsQuery`/`buildEstablishmentDetailQuery` ya consumen). NO filtra PII de terceros (sin email/phone/coordenadas; esa PII vive en `user_private` self-only, ADR-025, fuera de esta query).
- **`resolveTagLookup` (`tag-lookup.ts:66`) es defensivo:** descarta filas cuyo `establishment_id === establishmentId` activo (esas ya las tomó la rama EDIT) → nunca confunde el campo activo con "otro campo".

### Foco 3 — Wiring del transfer (`TransferBody`) — OK (sin IDOR, sin leak de error crudo)

`FindOrCreateOverlay.tsx:399-477` → `animals.ts::transferAnimal:1299-1318` → RPC `transfer_animal`.

- **Anti-IDOR:** el cliente NO arma el `establishment_id` de origen ni el `animal_id`. El RPC los deriva de la FILA REAL del `p_source_profile_id` y enforça authz asimétrica server-side (origen X: `has_role_in(X) AND owner-or-creator`; destino Y: rol activo) — verificado en impl_11 (T2.4/T2.5/T2.6, 0044 parity). Aunque el cliente mandara un `targetRodeoId`/`targetCategoryId`/`targetProfileId` arbitrario, el RPC re-valida que el rodeo/categoría sean del campo destino y del mismo sistema (23514) y que el caller tenga rol en Y (42501). Los ids de destino son del campo ACTIVO del propio caller (resueltos vía `RodeoContext` + catálogo local), no inyectables hacia otro tenant.
- **`sourceProfileId` viene del lookup local cross-campo** (`OverlayBody:264` ← `result.sourceProfileId`). Es un perfil de un campo donde el usuario SÍ tiene rol (el set local ya está scopeado, ver foco 2). Si por alguna razón no lo fuera, el RPC rechaza con 42501 (no hay `has_role_in` en X). No es un IDOR explotable.
- **Sin leak de `sqlerrm`:** todo error del RPC pasa por `classifyTransferError` (`transfer-animal.ts:100-120`), que mapea por `errcode` (42501/23514/23503/23505/network) a copys es-AR ESTÁTICOS (`COPY`, `:84-91`). El `error.message` crudo de Postgres NUNCA se renderiza. El `transferError` mostrado en `TransferBody` (`:517-519`) es siempre uno de esos copys (o el copy de "no hay rodeo disponible" / "no se pudo determinar la categoría", también estáticos, `:417`/`:444-446`).

### Foco 4 — Param `tag` de `crear-animal` — OK (sin injection/XSS)

`crear-animal.tsx:125` lee `params.tag` con guard `typeof params.tag === 'string'`. El valor:

- Se renderiza como TEXTO dentro de componentes Tamagui/`<Text>` (React Native auto-escapa; no hay `dangerouslySetInnerHTML`/`innerHTML`/`v-html` en el chunk).
- Se pasa a `setTag(...)` (`:141`) como string de estado, y al crear se sanitiza por `sanitizeTagInput`/`isValidTagElectronic` (`crear-animal.tsx:51-56`) antes de cruzar al service. El EID que llega por este param fue validado FDX-B por el `EidIngestEngine` del provider (15 díg) antes de existir el overlay → el `router.push({ params: { tag: eid } })` (`FindOrCreateOverlay.tsx:337`) transporta un EID ya validado.
- No se usa en ninguna query SQL por concatenación (el lookup usa `?` parametrizado).

### Foco 5 — Input del EID en el overlay / `formatEidReadable` — OK

- El EID llega del provider ya validado (`isValidTag`/contract de spec 04). El overlay no re-valida porque no lo necesita, pero `formatEidReadable` (`eid-format.ts:16-21`) es defensivo: si el input NO es exactamente 15 dígitos devuelve el string tal cual (o `''` si no es string) — nunca rompe ni lanza. No hay path de crash por input inesperado.

### Foco 6 — Logs / PII — OK

`grep` de `console.(log|warn|error|info|debug)` sobre los archivos nuevos/modificados del chunk (`app/app/_components/*`, `BleConnectionChip.tsx`, `ble-connection-view.ts`, `tag-lookup.ts`, `eid-format.ts`): **cero matches**. Ningún EID, nombre de campo ni id se loguea. (El logging de transporte BLE vive en `services/ble/logging.ts`, que NO es del chunk y registra `eid_rejected`/`connection_changed` sin el EID.)

## False positives descartados (trazabilidad)

- **`buildSearchLikeQuery` (`local-reads.ts:714-726`) — interpolación de `column` en el SQL (`ap.${column} LIKE ?`).** Pattern de inyección, pero NO explotable: `column` es del tipo unión literal `'animal_tag_electronic' | 'idv' | 'visual_id_alt'` (whitelist en compile-time) y SIEMPRE lo fija el service con un literal (`animals.ts:453/460/473`), nunca input de usuario. El `term` entra parametrizado (`?`) tras `escapeLike()`. Además es código PRE-EXISTENTE (no del diff de este chunk). Descartado.
- **`runLocalQuery` devuelve `err.message` crudo (`local-query.ts:53-54`)** y `lookupByTag`/`OverlayError` lo propagan a la UI (`FindOrCreateOverlay.tsx:228`). El mensaje es de un error del MOTOR SQLite LOCAL del propio dispositivo (no del server, no datos de tenant), solo aparece si el SQLite local está roto/no-booteado. No es information disclosure de datos sensibles ni cross-tenant. Pre-existente (es la capa de I/O de spec 15, no del chunk). No bloquea. → ver MED-1.

## MED / LOW (no bloquean — backlog)

- **MED-1 (info disclosure menor, pre-existente):** `runLocalQuery`/`runLocalWrite` (`local-query.ts:53-54`, `:99`) surfacean el `err.message` crudo del SQLite local a la UI vía el AppError `unknown`. Es del motor local (no server, no tenant), pero un copy genérico ("Error al leer datos locales") sería más prolijo y evitaría filtrar internals del esquema/SQL en un toast. Fuera del scope del chunk (capa de spec 15). Anotar en backlog para reconciliar transversalmente.
- **LOW-1 (DoW self-scoped, ya conocido):** el transfer no tiene rate limit propio (MED-2 de spec 11, Raf lo aceptó en Puerta 1: es online-only, per-user, self-scoped — un usuario solo puede transferir sus propios animales entre sus propios campos). No es vector de abuso a escala. Ya en backlog de spec 11.
- **LOW-2 (robustez de la marca E2E):** la marca `__RAFAQ_BLE_E2E__` vive en `globalThis` y se evalúa al boot. Si en algún build de DEBUG futuro se permitiera setearla post-boot con re-mount, podría montar el MockAdapter en dev. Hoy NO pasa (el `mode` queda fijado al boot). Defense-in-depth opcional: gatear también por `__DEV__`/NODE_ENV además del flag, para que ni en un bundle de release accidental con la marca pueda activarse. No explotable hoy. Backlog opcional.

## Archivos analizados (scope del chunk)

Nuevos: `app/app/_components/{FindOrCreateOverlay.tsx, BleE2EBridge.tsx, ble-e2e-flag.ts}`, `app/e2e/baston.spec.ts`, `app/src/components/{BleConnectionChip.tsx, ble-connection-view.ts}`, `app/src/services/tag-lookup.ts` (+test), `app/src/utils/eid-format.ts` (+test).
Modificados: `app/app/(tabs)/animales.tsx`, `app/app/_layout.tsx`, `app/app/{agregar-evento,animal/[id],crear-animal}.tsx`, `app/src/components/index.ts`, `app/src/services/animals.ts`, `app/src/services/powersync/local-reads.ts` (+test), `scripts/run-tests.mjs`.
Contexto leído (no del chunk, para trazar data flow): `app/src/services/ble/{BleStickListenerProvider.tsx, adapter-selection.ts}`, `app/src/services/transfer-animal.ts`, `app/src/services/powersync/local-query.ts`, `progress/impl_11-transferencia-animal.md`.

## Tabla de inputs (campos que el usuario "tipea"/aporta en el chunk)

| campo | límite | validación | OK? |
|---|---|---|---|
| EID bastoneado (entra al overlay) | 15 díg FDX-B | server/contract: `EidIngestEngine` (validate+dedup) en el provider ANTES del overlay; el overlay solo muestra/transporta | OK |
| `tag` route param (crear-animal) | string; re-sanitizado por `sanitizeTagInput`/`isValidTagElectronic` al crear; constraint de DB en el alta | autoritativa server-side en createAnimal (no cambia en este chunk) | OK |
| `targetRodeoId`/`targetCategoryId`/`targetProfileId` (transfer) | UUIDs resueltos del contexto activo del propio caller | autoritativa: el RPC re-valida sistema/campo/rol (23514/42501), deriva origen+animal_id de la fila real | OK |

No hay buscadores ni texto libre NUEVO en el chunk (el buscador de animales es pre-existente; el chunk no lo toca).

## Tabla de rate limits (acciones abusables tocadas por el diff)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `transfer_animal` (RPC, online-only) | no | n.a. (per-user implícito por authz) | sí (authz server-side rechaza si no hay rol) | DoW self-scoped: el usuario solo transfiere SUS animales entre SUS campos. MED-2 de spec 11, aceptado por Raf en Puerta 1. No es abuso a escala. |
| lookup por TAG (`lookupByTag`) | n.a. | n.a. | n.a. | 100% local (SQLite), sin red → no consume recursos del server, no rate-limiteable ni necesario. |
| connect web-serial (`BleConnectionChip`) | n.a. | n.a. | n.a. | gesto de usuario local, sin red/DB. |

## Cobertura indirecta de Deno / RLS / PowerSync

- **Deno / Edge Functions:** N/A — el chunk no toca Edge Functions.
- **RLS:** N/A en el diff — no hay migraciones ni policies nuevas. La barrera RLS relevante (transfer, lookup) es la de spec 02/11, ya gateada. La skill Sentry no cubre RLS de Postgres; revisión manual hecha (foco 2/3): el aislamiento se apoya en el scoping de la sync stream + RLS server, no debilitado por la query cross-campo local.
- **PowerSync sync rules:** cobertura indirecta. La query cross-campo (`buildLookupTagAcrossFieldsQuery`) DEPENDE de que la stream `est_animal_profiles` esté correctamente scopeada por `has_role_in` (replica al local solo los campos del usuario). Eso es responsabilidad de spec 15 (ya en prod) y NO cambia en este chunk. Si en el futuro una sync rule se aflojara, esta query heredaría el problema — pero el chunk no introduce el riesgo. Recomendación de trazabilidad: cualquier cambio futuro a las sync rules de `est_animal_profiles` debe re-evaluar este lookup.
