# Security Code Review (Gate 2, ADR-019) — spec 03 M2.1-core

**Modo**: `code` · **Baseline**: `6308ff5c1e806a007144d9b244a667767d0f735f` · **Fecha**: 2026-06-14
**Skill**: `sentry-skills:security-review` (corrida sobre el diff + validación manual RAFAQ-specific)

## Veredicto: **PASS**

No se identificaron findings HIGH ni MEDIUM. El chunk es FRONTEND puro que cablea piezas
server-side ya auditadas (alta atómica `create_animal` 0083, caps 0070, RLS/sync-streams). Cada
uno de los 6 focos obligatorios fue trazado end-to-end y verificado exploitability=false. RC de
`check.mjs` rojo = flake conocido de rate-limit de auth (NO finding — detalle abajo).

---

## Foco 1 — Inputs de usuario (mandato)

| campo | límite | validación (server / solo-cliente / ausente) | OK? |
|---|---|---|---|
| input manual idv/visual (`identificar.tsx` `ManualEntry`) | sin cap explícito en el TextInput; `.trim()` antes de `searchAnimals` | **server** (es un READ contra SQLite local; no escribe nada) | OK |
| identificador precargado al find-or-create (`tag`/`idv`/`visual` por params a `/crear-animal`) | tag: 15 díg FDX-B (`isValidTagElectronic` submit); idv/visual: cap **64 char server-side** (CHECK 0070) | **server** (CHECK `animal_profiles_idv_len_chk` / `_visual_id_alt_len_chk` / `animals_tag_electronic_len_chk` ≤64 — enforça TODO INSERT futuro vía RPC `create_animal`) | OK |

- **El input manual NO escribe**: `onManualSearch` → `searchAnimals(establishmentId, trimmed)` es una
  lectura local (read-only) contra SQLite. No hay sink de escritura desde la pantalla de identify.
  La inyección PostgREST/SQL no aplica: `buildSearchLikeQuery` usa `LIKE ? ESCAPE '\'` con `escapeLike()`
  neutralizando `% _ \`, y la columna es de una **whitelist** del service (no input de usuario)
  (`local-reads.ts:810-822`). El término no se concatena en `.or()/.filter()` ni va a un prompt LLM.
- **El precargado al alta NO es spoofeable a otro tenant**: `resolvePrefilledCreateParams`
  (`maniobra-identify.ts:170`) solo emite `{tag}` (BLE) o `{idv|visual}` (manual). NUNCA emite
  `establishment_id` ni `created_by` — esos los pone el contexto/trigger server-side (ver Foco 2).
- **Cap server-side autoritativo confirmado**: aunque el `TextInput` del paso 4 de `/crear-animal`
  re-sanitiza al editar (`sanitizeIdvInput`/`sanitizeVisualInput`) y el precargado entra a state sin
  re-sanitizar (`crear-animal.tsx:141-143`, solo `.trim()` al submit), el techo real es el CHECK de DB
  (0070). El cliente Expo es attacker-controlled (puede pegar a PostgREST/RPC directo); el control que
  vale es el CHECK ≤64, que aplica dentro de `create_animal` (definer). No hay storage-exhaustion.

## Foco 2 — find-or-create cross-spec (D9 / T2.12) — **cerrado**

El alta inline desde la manga delega a `/crear-animal` → `createAnimal` → outbox → RPC `create_animal`
(0083). Verificado contra la migración:
- **`created_by = auth.uid()` FORZADO server-side**: trigger `animal_profiles_set_created_by`
  (`tg_force_created_by_auth_uid`, 0043) **ignora** cualquier valor del cliente
  (`new.created_by := auth.uid()`). Es load-bearing para authz (`exit_animal_profile`). No spoofeable.
- **authz PRIMERO (anti-IDOR de establecimiento)**: `create_animal` chequea
  `has_role_in(p_establishment_id)` antes de cualquier escritura → `42501` si el caller no tiene rol en
  ese campo (`0083:83-85`). Un atacante que mande un `establishment_id` ajeno en el payload rebota.
- **Anti-IDOR post-insert**: guards (b-bis)/(c-bis) exigen que la fila `animals`/`animal_profiles`
  con el id de cliente matchee la identidad del intent → `42501` genérico sin oráculo (`0083:113-168`).
- **UNIQUE de dominio**: `tag_electronic` único global (0019), `(establishment_id, idv)` único (0020),
  `animal_profiles_active_animal_unique` — un duplicado real revienta `23505` y SALE de la RPC (no se
  absorbe: el ON CONFLICT apunta solo a la PK). Respeta spec 02 R3.2.
- **rodeo precargado = el de la sesión, no cross-tenant**: el `rodeoName` mostrado sale del
  `RodeoContext` (scopeado al campo activo) cruzado con `session.rodeoId`; el alta usa el rodeo elegido
  en el paso 1 del wizard (del contexto activo), no un id arbitrario. La sesión se lee de SQLite local
  (scopeada por el sync-stream `est_sessions`, ver Foco 3) → un `sessionId` ajeno por URL devuelve 0
  filas (`buildSessionByIdQuery` → `getSessionById`), no revela ni autoriza nada.

## Foco 3 — R4.5 (animal de otro establecimiento) — sin info disclosure

**No hay fuga cross-tenant.** El surfacing "está en el campo X" sale de `lookupByTag` →
`buildLookupTagAcrossFieldsQuery` (`local-reads.ts:779`), que lee del **SQLite local**. El SQLite local
solo contiene `animal_profiles` que bajaron por el sync-stream `est_animal_profiles`
(`sync-streams/rafaq.yaml:123-128`): `WHERE establishment_id IN org_scope`, donde
`org_scope = SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true`.
- Un EID de un tenant donde el usuario **no tiene rol** simplemente **no está** en el SQLite local →
  el cross-field lookup devuelve 0 filas → `resolveTagLookup` → `mode:'create'` → outcome `unknown`
  (find-or-create), **no** `other_establishment` con un nombre de campo ajeno.
- El stream ES la frontera de autorización del wire de sync (ADR-025: no hay RLS sobre el WAL) y está
  correctamente scopeado. El `otherFieldName` que se muestra (R4.5) solo puede ser de un campo donde el
  usuario YA es miembro. Confirmado: el comentario del service (`local-reads.ts:775-777`) es exacto.

## Foco 4 — R3.2 (supresión del listener por ruta) — un solo consumidor

Robusto. Ambos `FindOrCreateOverlay` (global) y `identificar.tsx` montan `useBleStickListener`, pero:
- El overlay global **early-returns** en `onTagRead` cuando `onBleOwnedRouteRef.current` es true
  (`segments[0] === 'maniobra'`, `FindOrCreateOverlay.tsx:137`) → NO hace lookup ni abre sheet.
- La pantalla de manga es el **único consumidor efectivo** que procesa el EID.
- El ref `onBleOwnedRouteRef` se actualiza en cada render (`:109`) → leído fresco dentro del callback
  sin re-suscribir; no hay ventana de stale-route que deje dos consumidores procesando.
- Si un live-rescan abrió el sheet justo antes de navegar a `maniobra/*`, el efecto `:185-187` lo
  cierra. No queda sheet stale encima de la manga.
- **No por `disableListener()`**: correcto — apagar el transporte cortaría también la escucha de la
  pantalla dueña. Suprimir por ruta deja el transporte vivo y un solo consumidor. Sin doble-proceso del EID.

## Foco 5 — Auto-avance / dedup — sin doble-INSERT ni doble-nav

- La pantalla de identify **nunca INSERTa**. En `found` solo navega (`router.replace` a carga). El
  único INSERT es el alta, que requiere acción explícita ("Dar de alta" → submit de `/crear-animal`).
- Doble-navegación cubierta: el auto-avance es un `setTimeout` con **cleanup** (`:164-169`); un cambio
  de outcome reinicia el timer. `seqRef` descarta lookups viejos en vuelo; `mountedRef` evita
  `setState` post-desmonte (`:124-152`). El dedup por-TAG lo hace el provider aguas arriba (un
  re-escaneo dentro de la ventana ni llega a `onTagRead`).
- Aun si dos altas se encolaran, la RPC `create_animal` es **idempotente** por los ids de cliente
  (ON CONFLICT (id) DO NOTHING, R6.10) → un replay at-least-once no duplica.

## Foco 6 — Secrets — limpio

`grep` de `service_role|SUPABASE_SERVICE|secret|password|api_key|bearer|eyJ...` sobre `app/app/maniobra/**`
y `maniobra-identify.ts` → **0 matches**. Sin hardcode. Sin `console.log` de identificadores sensibles
en el path nuevo (el EID se muestra en UI vía `formatEidReadable`, no se loggea).

---

## Hallazgos de la skill `sentry-skills:security-review`

**No high-confidence vulnerabilities identified.** La skill no encontró sinks explotables: no hay
`eval`/`exec`, no `dangerouslySetInnerHTML` (React Native + Tamagui auto-escapa el texto), no SQL/command
injection (queries parametrizadas con `?` + whitelist de columnas), no SSRF, no deserialización insegura.
El único input attacker-controlled del chunk (texto manual) alimenta un READ local parametrizado.

### False positives descartados (trazabilidad)
- **"prefilled idv/visual entra a state sin re-sanitizar" (`crear-animal.tsx:141-143`)** → NO finding.
  El sanitizador del cliente es UX (bypasseable por diseño); el control autoritativo es el CHECK ≤64
  server-side (0070), que aplica dentro de la RPC. Sin storage-exhaustion. Documentado en Foco 1.
- **"cross-field tag lookup sin filtro de establishment_id" (`buildLookupTagAcrossFieldsQuery`)** → NO
  finding. La ausencia del filtro es intencional y segura: el set local YA está scopeado por el
  sync-stream (`establishment_id IN org_scope`). Verificado contra `rafaq.yaml`. Foco 3.
- **"sessionId / establishmentId vienen de params/contexto del cliente"** → NO finding. El sessionId
  resuelve contra SQLite local scopeado (0 filas si es ajeno); el establishmentId del contexto se
  re-valida server-side vía `has_role_in` en `create_animal`. El cliente no es la barrera. Foco 2.

---

## Archivos analizados (alcance M2.1-core)
- `app/src/utils/maniobra-identify.ts` (lógica pura; decisión found/other/unknown/ambiguous)
- `app/app/maniobra/identificar.tsx` (pantalla real cableada)
- `app/app/maniobra/_components/SpikeSessionHeader.tsx` (presentacional puro; sin superficie)
- `app/app/_components/FindOrCreateOverlay.tsx` (cambio `BLE_OWNED_ROUTES` + supresión por ruta)
- `app/app/maniobra/jornada.tsx` (re-point a `/maniobra/identificar`)
- `app/app/maniobra/carga.tsx` (mock visual M2.0; sin I/O)
- `app/app/_layout.tsx` (rutas; `maniobra/identificar` autenticada — NO en DEV_WEB_ROUTES)

**Reusos auditados en su uso desde acá**: `lookupByTag`/`searchAnimals` (`animals.ts`),
`resolveTagLookup`/`buildLookupTagAcrossFieldsQuery`/`buildSearchLikeQuery` (`tag-lookup.ts` /
`local-reads.ts`), alta `createAnimal` + RPC `create_animal` (0083), caps `0070`, trigger `created_by`
(0043), sync-streams (`rafaq.yaml`), `getSessionById`/`buildSessionByIdQuery`.

## Tabla de rate limits (acciones abusables tocadas por el diff)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| lookup por tag / búsqueda manual | n.a. | — | — | READ local (SQLite), sin red ni costo server. No abusable a escala server-side. `LIMIT 20`/`LIMIT 2` acotan filas. |
| alta find-or-create (INSERT vía outbox→RPC) | n.a. (este chunk) | per-user/establishment (authz) | sí (`has_role_in` 42501) | El alta no manda email/SMS ni pega a API externa; no es bulk. Cuota global de altas es scope de otra spec, no se afloja acá. |

**Sin cambios a `[auth.rate_limit]` (`config.toml`)** en el diff. El chunk no toca Auth, email/SMS,
APIs externas ni operaciones masivas.

## Cobertura indirecta de Deno / RLS / PowerSync (advertencia de scope de la skill)
La skill de Sentry **no** cubre nativamente Deno Edge Functions, policies RLS Postgres ni sync-rules de
PowerSync. Esos dominios se revisaron **manualmente** (Focos 2/3): `create_animal` (0083), trigger 0043,
caps 0070 y `sync-streams/rafaq.yaml`. Todos son código YA aplicado/auditado en Gates previos; el chunk
M2.1-core no introduce DDL nueva ni Edge Functions → **no se requiere Gate 1 puntual**.

## check.mjs — RC=1 (flake conocido, NO finding)
- `typecheck client` **OK** · `client unit tests` **OK** (incluye `maniobra-identify.test.ts`).
- Rojo en `supabase/tests/animal/run.cjs`: `signIn(...): Request rate limit reached` → cascada de
  `TypeError: Cannot read properties of undefined (reading 'id')` en `seedNoTagAnimal`.
- Firma EXACTA del flake documentado (rate-limit de auth de Supabase por 2 terminales en paralelo
  pegándole a la DB compartida). NO es regresión del código M2.1-core (frontend puro, sin backend) ni
  un hallazgo de seguridad. El leader puede re-correr con una sola terminal para confirmar verde.
