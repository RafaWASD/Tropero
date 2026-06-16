# Security (code, Gate 2 / ADR-019) — Spec 03 MODO MANIOBRAS, chunk M1 completo

**Veredicto: PASS** (sin findings HIGH). 2 observaciones MEDIUM de defensa-en-profundidad sobre cotas server-side faltantes en columnas `text` que **hoy no tienen call-site en la UI de M1** (no explotables en este chunk) → quedan registradas como hallazgo para Gate 1 puntual ANTES de cablear esos inputs (M5 custom-maniobras / cuando se exponga "guardar como rutina" o "lote de trabajo").

- **Modo**: `code` (diff del implementer aplicado, M1-SERVICIOS + M1-UI).
- **Baseline**: `6308ff5` (registrado en `progress/impl_03-m1-ui.md` L1). HEAD == baseline; todo M1 está en el working tree sin commitear (mezclado con chunks paralelos 08-sigsa / 10-via-intranasal, fuera de alcance). Diff acotado por el prompt a los archivos M1.
- **Backend (NO auditado, ya aprobado)**: migraciones `0050_sessions.sql`, `0051_maneuver_presets.sql`, `0057_soft_delete_maneuver_preset.sql`. Se leyeron como referencia para verificar las cotas autoritativas server-side.
- **Skill**: `sentry-skills:security-review` aplicada (metodología trace-data-flow + verify-exploitability). Sin findings HIGH de la skill tras validación manual.

---

## Findings HIGH

**Ninguno.**

---

## Foco obligatorio — inputs de usuario (mandato explícito)

| Campo | Dónde se tipea | Persiste en | Límite cliente | Cota autoritativa server-side | OK? |
|---|---|---|---|---|---|
| **Preconfig de tanda** (vacuna(s) multi coma-sep / pajuela single) | `ManeuverConfigSheet.tsx:213` (TextInput, SIN `maxLength`) | `sessions.config.preconfig` jsonb (vía `createSession`) | NO (sin maxLength ni cap de cantidad de chips) | **SÍ** — `CHECK octet_length(config::text) < 16384` (16 KiB) en `0050_sessions.sql:30` | **OK** |
| **Etiqueta de lote de trabajo** (`work_lot_label`) | **sin call-site en M1-UI** (el wizard `jornada.tsx` NO la setea; `setWorkLotLabel` existe en `sessions.ts:164` sin consumidor) | `sessions.work_lot_label` (`text`) | n.a. (no expuesto) | **NO** — `0050_sessions.sql:18` es `text` plano sin CHECK de longitud | **N/A en M1** (ver MED-1) |
| **Nombre de preset** (`name`) | **sin call-site en M1-UI** (no hay "guardar como rutina" cableado en este chunk; `createPreset`/`updatePreset` en `maneuver-presets.ts:78/99` sin consumidor de UI) | `maneuver_presets.name` (`text`) | n.a. (no expuesto) | **PARCIAL** — solo `CHECK length(trim(name)) > 0` (no-vacío) en `0051:16`; sin cap de longitud máxima | **N/A en M1** (ver MED-2) |

**Análisis del único input editable real de M1 (preconfig):** el TextInput del sheet no tiene `maxLength` ni hay tope a la cantidad de chips/vacunas. Esto importaría si el jsonb fuera libre, **pero el `config` completo está acotado a 16 KiB por un CHECK autoritativo en la DB** (`sessions_config_size`, 0050 L30; idéntico `maneuver_presets_config_size`, 0051 L18) que aplica al subir por PostgREST (la RLS + triggers + CHECKs corren server-side al upload, confirmado en `connector.ts:74-85`). El cliente NO es la autoridad: aunque un atacante pegue directo al endpoint o manipule la SQLite local, un `config` > 16 KiB es rechazado server-side (23514) → el path offline NO evade la validación (corre en el upload, no se asume "ya validado en cliente"). **El requisito "límite claro + validación autoritativa server-side" se cumple para el único campo de entrada expuesto en M1.** La falta de `maxLength` en el cliente es UX (LOW, anexo), no un hueco de seguridad.

---

## Findings MEDIUM (defensa en profundidad — hallazgo para Gate 1 puntual)

> Ambos tocan columnas `text` sin cota de longitud server-side. **No son explotables en M1** porque ningún input de M1 las escribe (sin call-site). Se registran para que, cuando se cablee el input correspondiente (M5 / "guardar como rutina" / "lote de trabajo"), **primero** pase por Gate 1 con la DDL de la cota — no después.

### [MED-1] `sessions.work_lot_label` sin cota de longitud server-side
- **Ubicación**: `supabase/migrations/0050_sessions.sql:18` (`work_lot_label text`, sin CHECK); service `app/src/services/sessions.ts:164` (`setWorkLotLabel`) + builder `local-reads.ts:1631` (`buildSetWorkLotLabelUpdate`).
- **Confianza**: Media (patrón claro; superficie de ataque NO expuesta en M1 → no HIGH).
- **Issue**: `work_lot_label` es texto libre del usuario (R9.4) y, a diferencia de `config`, **NO cae bajo el CHECK de 16 KiB** (ese CHECK es solo sobre la columna `config`). Es `text` ilimitado: la única cota es el límite global de payload de PostgREST, no una cota de columna. Hoy `setWorkLotLabel` no tiene consumidor en la UI de M1 (el wizard nunca lo invoca) → **no explotable en este chunk**.
- **Impacto (futuro)**: cuando se exponga el input de "lote de trabajo", un texto desmesurado (vía endpoint directo / SQLite manipulada) se persiste sin tope → storage abuse menor / payload grande sincronizado a todos los dispositivos del campo.
- **Fix recomendado**: agregar `constraint sessions_work_lot_label_len check (char_length(work_lot_label) <= N)` (p.ej. 120) en una migración nueva, ANTES de cablear el input. Marcado como **hallazgo para Gate 1 puntual** (toca DB).

### [MED-2] `maneuver_presets.name` sin cap de longitud máxima server-side
- **Ubicación**: `supabase/migrations/0051_maneuver_presets.sql:16` (solo `length(trim(name)) > 0`); services `maneuver-presets.ts:78` (`createPreset`) / `:99` (`updatePreset`) + builders `local-reads.ts:1696/1712`.
- **Confianza**: Media (mismo razonamiento: sin call-site en M1 → no HIGH).
- **Issue**: el `name` del preset valida no-vacío server-side pero **no tiene cap de longitud máxima**. Los servicios re-trimean (`maneuver-presets.ts:79`) — defensa contra el CHECK no-vacío — pero el trim no acota la longitud. Hoy no hay UI de M1 que cree/edite presets ("guardar como rutina" no está cableado en este chunk) → **no explotable acá**.
- **Impacto (futuro)**: nombre de preset desmesurado persistido y mostrado a todos los usuarios del campo (`maniobra.tsx:147` lo renderiza con `numberOfLines={1}`, contenido, pero el dato se almacena/sincroniza sin tope).
- **Fix recomendado**: extender el constraint a `check (length(trim(name)) > 0 and char_length(name) <= N)` (p.ej. 80) en una migración nueva, ANTES de cablear el alta de presets. **Hallazgo para Gate 1 puntual** (toca DB).

---

## Otros chequeos (mandato del prompt)

### Inyección SQL en builders — LIMPIO (HIGH-confidence negativo)
Todas las builders de sessions/presets usan **placeholders `?` parametrizados**, cero concatenación de input de usuario en el SQL string:
- `buildCreateSessionInsert` (`local-reads.ts:1597`), `buildCloseSessionUpdate` (:1619), `buildSetWorkLotLabelUpdate` (:1631), `buildSetSessionCountsUpdate` (:1645), `buildActiveSessionQuery` (:1663), `buildSessionByIdQuery` (:1678).
- `buildCreateManeuverPresetInsert` (:1696), `buildUpdateManeuverPresetUpdate` (:1712), `buildManeuverPresetsQuery` (:1733), `buildManeuverPresetByIdQuery` (:1745).
El SQL es estático; `id`/`establishmentId`/`name`/`configJson`/`label` viajan siempre por `args: [...]`. No hay vector de inyección.

### Multi-tenant / RLS — LIMPIO
- `establishment_id` **nunca hardcodeado**: lo pasa el caller desde el contexto activo (`jornada.tsx:82` `estState.current.id`; `maniobra.tsx:34`). Verificado contra el lint anti-hardcode (0 violaciones).
- Writes de `sessions`/`maneuver_presets` gateados por RLS `has_role_in(establishment_id)` (INSERT/UPDATE, 0050 L70-74 / 0051 L35-39) al subir. Un `establishment_id` ajeno inyectado en la SQLite local es rechazado por la policy INSERT al upload → no hay escritura cross-tenant desde el cliente.
- `created_by` lo **fuerza el trigger** `tg_force_created_by_auth_uid` (0050 L38-40 / 0051 L23-25) → no spoofeable (no es mass-assignment aunque PowerSync suba `{...op.opData, id}` en `connector.ts:78`).
- `rodeo_id` re-validado server-side: `tg_sessions_rodeo_check` (0050 L47-64) exige rodeo del mismo establishment + activo + vivo (23514 si no). El cliente no puede colgar una sesión de un rodeo ajeno.

### Bypass de gating — LIMPIO (sin decisión de seguridad en el cliente)
El gating de cliente (`useManeuverGating.ts` + `maneuver-gating.ts`) es **UX fail-safe**: con `config` no cargado todo resuelve a "no aplica" (`useManeuverGating.ts:106-115`, `EMPTY_CONFIG`). La autoridad es la **capa 2 server-side** (trigger `assert_data_keys_enabled`, 0054), documentada explícitamente en `maneuver-gating.ts:12-14`. Saltear el gating del cliente (offrecer una maniobra que el rodeo no habilita) no evade nada: el evento es rechazado al subir por la capa 2. No hay decisión de seguridad delegada al cliente.

### Offline / CRUD-plano — LIMPIO
El path offline NO evade validación: el local write siempre tiene éxito offline (contrato T5, `sessions.ts:12-16`), pero la AUTORIZACIÓN real (RLS) + los CHECKs (config-size, rodeo-check, name-not-empty) + el `created_by` forzado corren **al subir** vía PostgREST (`connector.ts:74` "RLS + triggers + CHECKs siguen aplicando"). No se asume "ya validado en cliente".

### RPC 0057 (`soft_delete_maneuver_preset`) — ownership server-side OK
El cliente invoca la RPC con `{ p_preset_id }` controlado (`maneuver-presets.ts:127-131` → outbox → `upload.ts:45` mapea a `supabase.rpc('soft_delete_maneuver_preset', {p_preset_id})`). La RPC (SECURITY DEFINER, 0057 L17-30) **re-valida ownership**: resuelve el `establishment_id` de la fila objetivo y exige `has_role_in(v_est)` (L26-28) → un `presetId` de otro tenant da 42501 (sin rol en ESE establishment) o P0002 (no existe/borrado). No se confía en el arg del cliente para autorizar.

### Secrets — LIMPIO
Ningún secreto hardcodeado en los archivos M1. Confirmado por el lint anti-hardcode (ADR-023 §4): **0 violaciones** en `app/app` + `app/src/components`. Sin `console.log` de datos sensibles en el código M1.

### Lógica pura (parseo del jsonb pass-through) — robusta
`parseManeuverConfig`/`extractManeuvers` (`maneuver-config.ts:21-48`) tratan el `config` como **no confiable**: parseo tolerante (payload corrupto → `{}`, nunca tira) + filtro de maniobras contra el set conocido (`MANEUVER_SET`). No se confía en el contenido del jsonb leído de la DB (defensa correcta para un campo pass-through escribible por cualquier rol operativo del campo). `maneuverDetail` (`maneuver-wizard.ts:50`) idem (string/objeto → texto, todo lo demás → null).

---

## False positives descartados (trazabilidad)

- **TextInput sin `maxLength` (ManeuverConfigSheet.tsx:213) como vector de payload/jsonb** → descartado como HIGH: el `config` que lo contiene tiene CHECK autoritativo de 16 KiB server-side (0050 L30). La falta de `maxLength` cliente es UX (LOW), no hueco de seguridad.
- **`supabase.from(op.table).upsert({...op.opData})` (connector.ts:78) como mass-assignment** → descartado: las builders construyen columnas FIJAS; los campos sensibles (`created_by`, `establishment_id`) los protegen trigger forzado + RLS server-side. Un cliente que inyecte columnas extra en la SQLite local no escala privilegios.
- **Soft-delete con `p_preset_id` del cliente (IDOR)** → descartado: la RPC re-valida ownership por el establishment de la fila (0057 L22-28).

---

## Tabla de rate limits (acciones abusables tocadas por el diff)

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| `createSession` (INSERT sessions) | n.a. (escritura de datos offline-first, sin email/SMS/API externa/bulk) | per-user vía RLS `has_role_in` | sí (RLS al upload) | No es endpoint abusable de costo; el techo es el CHECK de 16 KiB del config. |
| `createPreset`/`updatePreset` | n.a. | per-establishment (RLS) | sí | Sin call-site en M1. Cap de longitud pendiente (MED-2). |
| `softDeletePreset` (RPC 0057) | n.a. | per-establishment (`has_role_in` dentro de la RPC) | sí | Idempotente (P0002 → descarte). |

Ninguna acción de M1 manda email/SMS, pega a API externa, ni es bulk/import → **no requiere rate limit propio**. La escritura offline-first va por PowerSync/PostgREST bajo RLS; no es un vector de denial-of-wallet.

---

## Archivos analizados (chunk M1)

- `app/src/services/sessions.ts`
- `app/src/services/maneuver-presets.ts`
- `app/src/utils/maneuver-gating.ts`
- `app/src/utils/maneuver-config.ts`
- `app/src/utils/maneuver-wizard.ts`
- `app/src/hooks/useManeuverGating.ts`
- `app/app/maniobra.tsx`
- `app/app/maniobra/jornada.tsx`
- `app/app/maniobra/_components/ManeuverConfigSheet.tsx`
- `app/src/services/powersync/local-reads.ts` (builders sessions/presets, L1595-1751)
- `app/src/services/powersync/connector.ts` (mecanismo de upload CRUD plano, referencia)
- `app/src/services/powersync/upload.ts` + `outbox.ts` (mapeo del soft-delete a RPC, referencia)
- Backend de referencia (no auditado): `0050_sessions.sql`, `0051_maneuver_presets.sql`, `0057_soft_delete_maneuver_preset.sql`

`ManeuverReorderList.tsx` / `SpikeIdentityHeader.tsx`: presentación pura (drag-reorder de presentación, sin I/O ni input persistido) → sin superficie de seguridad. Pantallas del spike M2.0 (`carga.tsx`, `paso.tsx`): **excluidas** por el prompt (mock data, van con M2).

---

## Cobertura indirecta de la skill (Deno / RLS / PowerSync / RN)

La skill `sentry-skills:security-review` está orientada a patrones web/Django/JS clásicos; **no cubre nativamente** RLS de Supabase, triggers PL/pgSQL, ni el modelo de sync de PowerSync. Esos dominios — que son donde vive la autoridad de seguridad de M1 — se cubrieron por **revisión manual** contra el Catálogo RAFAQ (A1 service-role n/a en M1, A2 mass-assignment descartado, A3 IDOR del preset descartado, C4 stale-auth/replay cubierto por re-validación RLS al upload, F1 inyección PostgREST/SQL descartada). La skill confirmó: sin XSS (RN sin `dangerouslySetInnerHTML`/`v-html`), sin inyección de string en SQL, sin secrets, sin eval/deserialización.

---

## `node scripts/check.mjs` — RC

**RC = 1**, pero **NO es finding de seguridad ni regresión de M1**:
- **Verde antes del corte**: anti-hardcode lint (0 violaciones), typecheck client OK, y la suite client-unit corriendo — incluye TODAS las suites de M1 (`maneuver-gating.test.ts`, `maneuver-config.test.ts`, `maneuver-wizard.test.ts`, `local-reads.test.ts`, `maneuver-reads.test.ts`, `upload.test.ts`).
- **El fallo**: `TypeError: Cannot read properties of undefined (reading 'id')` en `seedNoTagAnimal` de `supabase/tests/animal/run.cjs:3606` — suite `animal`, **ajena a M1** (sessions/presets no se tocan ahí). Es el patrón exacto documentado en memoria (`reference_check_red_rate_limit`): flake de auth de Supabase por rate-limit cuando corren 2 terminales contra la DB remota compartida (cascada de `undefined.id`), no una regresión de schema ni de código M1.

---

## Anexo LOW (no destaca)

- **LOW-1 — `maxLength` ausente en el TextInput de preconfig** (`ManeuverConfigSheet.tsx:213`): añadir `maxLength` (p.ej. 60 por vacuna/pajuela) + un tope de cantidad de chips mejora la UX (evita pegar un bloque enorme que el usuario no quiso) y refuerza defensa-en-profundidad bajo el CHECK de 16 KiB. No es seguridad (la cota real es server-side), es pulido.
- **LOW-2 — `sessions.notes`** (`0050:22`, `text` sin CHECK): no usado por M1; si se expone a futuro, aplicar la misma cota que MED-1.
