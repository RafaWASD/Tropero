# Security Code Review — Gate 2 — 03-modo-maniobras / M6-C.1 (cliente CE)

**Veredicto: PASS**
**0 findings HIGH. 0 findings MEDIUM. 0 RAFAQ-SPECIFIC.**

Auditoría del delta cliente de la Circunferencia Escrotal (write-path + cableado del frame). El backend M6 (0098/0099/0100) ya pasó Gate 1+Gate 2 (`security_code_03-m6-backend.md`, 0 HIGH) y la suite `supabase/tests/scrotal/run.cjs` corre 12/12 verde (oráculo server: CHECK rango, audit anti-spoof, RLS, append-only, WAL, session_id no-bypass). Foco de este review: que el CLIENTE no introduzca un hueco. **No lo hace.**

- **baseline_commit**: `a03e593` (registrado en `progress/impl_03-m6-c1.md`).
- **Método**: revisión manual del delta in-scope (no corrí `sentry-skills:security-review` sobre todo el working-tree — está contaminado con specs/08-SIGSA, cut-ficha y M5-bugfix ajenos a M6-C.1; revisé el delta CE archivo por archivo contra el catálogo RAFAQ).

---

## Foco 1 — Cliente no es autoridad (audit forzado server-side). OK

El INSERT a `scrotal_measurements` es CRUD-plano y **NO manda** `establishment_id`, `recorded_by` ni `source`.

`local-reads.ts:1470-1476` (`buildAddScrotalInsert`):
```
INSERT INTO scrotal_measurements
(id, animal_profile_id, circumference_cm, age_months, measured_at, session_id)
VALUES (?, ?, ?, ?, ?, ?)
```
Las columnas de identidad/tenant NO están en la lista → el trigger 0098 (`tg_force_establishment_id_from_profile` reusando 0077 + force `recorded_by = auth.uid()` + `source` default `'manual'`) las fuerza al subir. Confirmado en `scrotal.ts:10-13,62-82` y en el header de `local-reads.ts:1445-1452`. **Mandarlas no serviría**: el trigger las pisa server-side (la suite test "audit anti-spoof" lo prueba empíricamente). La aplicabilidad client-side (torito/toro entero, `maneuver-applicability.ts:98-107`) está documentada explícitamente como **UX, no seguridad** (`maneuver-applicability.ts:16-17,100`): el gating capa 2 (0100 `tg_scrotal_gating`) + RLS (0098) son la autoridad real.

## Foco 2 — Sin IDOR en la corrección (`buildUpdateManeuverScrotal`). OK

`local-reads.ts:1486-1498`:
```
UPDATE scrotal_measurements SET circumference_cm = ?, age_months = ?, measured_at = ?
WHERE id = ? AND deleted_at IS NULL
```
- El `id` del UPDATE-corrección es el **mismo UUID que el cliente acaba de mintear con `crypto.randomUUID()`** dentro del ref en memoria de la sesión de carga (`carga.tsx:213-219` `eventIdFor` + `eventIdsRef`), reusado solo para re-confirmar dentro de la misma jornada. El flujo normal NO permite apuntar el UPDATE a una fila preexistente arbitraria.
- Aunque un cliente malicioso forjara un UPDATE con un `id` ajeno, la **RLS server-side (`is_owner_of(establishment_id) OR recorded_by = auth.uid()`, 0098)** lo gatea, y `recorded_by` es server-forzado (no spoofeable). No hay camino cross-tenant ni pisado de fila ajena.
- Patrón idéntico a `buildUpdateManeuverWeight`/`buildUpdateManeuverConditionScore`, ya validados en Gate 2 previos.

## Foco 3 — Sin inyección. OK

Los 3 builders (`buildAddScrotalInsert`, `buildUpdateManeuverScrotal`, `buildScrotalHistoryQuery`) usan **exclusivamente placeholders `?`**; el `+` entre líneas es concatenación de fragmentos SQL estáticos (palabras clave), nunca de valores. `runLocalWrite` (`local-query.ts:91-106`) ejecuta `db.execute(query.sql, query.args)` parametrizado. Ningún input del usuario (cm, edad, fecha, profileId, sessionId) toca el string SQL. Cero string-concat de valores.

## Foco 4 — Cotas: la cota cliente NO se asume única. OK

`wheel-picker.ts`: `CE_MIN_CM=20`/`CE_MAX_CM=50` + `snapToWheel` clampa y snapea a la grilla 0,5 (`parseCmInput` reusa el mismo clamp para el tipeo manual; NaN/∞ → `min`, fail-safe). El código documenta de forma explícita que **el CHECK del DB es el autoritativo** ("la rueda lo snapea/clampa; el CHECK del DB re-valida al subir", `scrotal.ts:40`, `local-reads.ts:1450,1456-1457`, `maneuver-event-query.ts:214-215`). El cliente NO asume que su cota es la única defensa. La suite server ("CHECK rango", 20-50 / age 0-600) prueba que un valor fuera de rango por un path no-UI lo rechaza el server.

## Foco 5 — Sin RPC nueva, sin secrets, session_id validado server. OK

- Sin RPC nueva: el write-path es CRUD-plano sobre la tabla sincronizada (sin `supabase.rpc(...)`).
- Sin `createAdminClient`/service_role en el delta cliente (grep limpio en `scrotal.ts`; el cliente solo usa el SDK anon vía PowerSync).
- Sin secrets hardcodeados; sin `console.log`/`console.error` que loggee datos.
- `session_id` se pasa tal cual al INSERT y lo re-valida el tenant-check server (`tg_event_session_tenant_check`, 0052 — suite "session_id no-bypass" verde).

---

## Tabla de inputs (campos que el usuario tipea/elige en el delta)

| campo | límite | validación | OK? |
|---|---|---|---|
| CE en cm (campo editable + rueda, `CmInputField`/`WheelPicker`) | [20,50], paso 0,5 | cliente: `parseCmInput`/`snapToWheel` (UX). **Server autoritativo**: CHECK `numeric(4,1)` ∈[20,50] (0098), suite verde | OK |
| Edad en meses (rueda de meses, `AgeAdjustSheet`) | [6,120] paso 1, o null (R14.7) | cliente: `snapToWheel(AGE_WHEEL)` (UX). **Server autoritativo**: CHECK age 0-600 (0098), nullable | OK |
| `measured_at` | ISO YYYY-MM-DD | columna `date NOT NULL` (0098) | OK |

Ningún campo es texto libre, ningún término se concatena en `.or()/.filter()`/`ilike`/prompt LLM. La rueda es un selector cerrado; el tipeo manual de cm pasa por `parseCmInput` (clamp+grilla) y el server re-valida. No hay campo sin límite + validación autoritativa server.

## Tabla de rate limits

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| INSERT/UPDATE local de CE | n.a. | — | — | CRUD-plano local→PowerSync upload queue. No es endpoint custom, no manda email/SMS, no pega a API externa, no es bulk. Sube vía sync nativo. Sin nueva superficie abusable a escala. |

## Dominios del catálogo RAFAQ revisados

- **A1 service-role bypass**: N/A (cliente, sin admin-client). OK
- **A2 mass assignment**: OK — INSERT con whitelist explícita de columnas (no spread de body); `establishment_id`/`recorded_by`/`source`/`id` NO vienen del cliente como datos de tenant (el `id` es UUID de cliente para la fila, no un campo de autoridad).
- **A3 IDOR por FK**: `animal_profile_id` es FK; la pertenencia al tenant la cubre RLS + tenant-check del `session_id` server-side. OK
- **A4 BFLA / authz de función**: gating capa 2 server (0100) re-valida el data_key habilitado. OK
- **B1 information disclosure**: el `r.error.message` propagado a la UI (`scrotal.ts:80,95`) es el error LOCAL de SQLite/PowerSync del propio dispositivo (write offline fallido), no una respuesta server con datos de tenant. Patrón idéntico a `events.ts`/`custom-measurements.ts` (Gate 2 previos). No es vector de disclosure.
- **C offline/sync**: write CRUD-plano correcto; corrección por UPDATE in-place con id estable (no upsert sobre view); re-autorización server al subir (RLS + gating + tenant-check, fail-closed) cubre stale-auth en replay (C4). OK
- **F1 PostgREST/SQL injection**: builders 100% parametrizados. OK

## Dominios excluidos (con justificación)

- **D (secrets/supply chain), E (abuso a escala), G (BLE), H (auth/sesión), I (compliance)**: el delta no toca esas superficies (no agrega imports remotos, ni endpoints con costo, ni lecturas BLE nuevas, ni auth, ni borrado/retención).
- **C1 PowerSync sync rules**: el stream `ev_scrotal_measurements` (sync-streams/rafaq.yaml) es parte del chunk M6-BACKEND ya en Gate 2; fuera del delta cliente M6-C.1.

## Cobertura indirecta (advertencia de trazabilidad)

`sentry-skills:security-review` NO se corrió sobre el working-tree completo (contaminado con features ajenas: spec-08 SIGSA, cut-ficha, M5-bugfix). El delta CE es TypeScript/SQL parametrizado + lógica pura sin red propia; la skill no cubre desde un ángulo distinto la autoridad RLS/trigger de Supabase ni el gating Postgres — esos los cubre el **oráculo server empírico** (suite `scrotal/run.cjs` 12/12) ya verde y el Gate 2 del backend. Revisión manual del delta cliente completada sin findings.

## Archivos analizados (delta in-scope)

- `app/src/services/scrotal.ts`
- `app/src/services/powersync/local-reads.ts` (`buildAddScrotalInsert`/`buildUpdateManeuverScrotal`/`buildScrotalHistoryQuery`)
- `app/src/services/powersync/local-query.ts` (`runLocalWrite`/`runLocalQuery` — parametrización)
- `app/src/utils/maneuver-event-query.ts` (`case 'scrotal'`)
- `app/src/utils/maneuver-applicability.ts` (delta CE, `isCastrated`)
- `app/src/utils/maneuver-sequence.ts` (`StepValue {kind:'scrotal'}` + `describeStepValue`)
- `app/src/utils/wheel-picker.ts` (clamp/snap/parseCmInput)
- `app/app/maniobra/carga.tsx` (`case 'rueda'`, `eventIdFor`, `lastScrotalCm`)
- `app/app/maniobra/_components/CircunferenciaEscrotalStep.tsx`

**No analizado por estar fuera de scope** (working-tree ajeno): spec-08 SIGSA, cut-ficha, M5-custom-bugfix, _layout.tsx, etc.
