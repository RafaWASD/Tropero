# Security Review (Gate 2 / código) — spec 03 M5-CLIENTE

**Modo**: `code` (ADR-019). **Veredicto**: **PASS — 0 findings HIGH.**

- **Alcance**: `git diff cba703f..a03e593` (commits `bf82ccd` M5-C.1 + `11ab1de` M5-C.2 + `a03e593` M5-C.3). Frontend puro: services de captura custom + UI de creación/render + connector PowerSync + lógica pura.
- **Baseline**: `cba703f` (provisto por el leader en el prompt; no se asumió por cuenta propia).
- **Fuera de alcance (no auditado)**: M5-BACKEND (migraciones 0093–0097, ya pasó Gate 2). Working-tree sin commitear y todo lo de spec 08 (`app/src/services/sigsa/`, `specs/active/08-*`, `RAFAQ-resumen-app.*`, `design/veto-*`) — otra terminal.
- **Herramienta**: `sentry-skills:security-review` (trace data flow + verify exploitability) + checklist RAFAQ del agente. Las migraciones 0094/0095/0096 se leyeron SOLO para verificar que el CLIENTE no puede eludir la frontera server-side (no para re-auditarlas).

---

## Findings HIGH

**Ninguno.** No se identificó ningún hueco explotable en el delta cliente.

El patrón de fondo es sólido: **el cliente nunca es la autoridad**. Cada vector que el prompt pidió escrutar (id/audit spoofing, IDOR por PK compuesta, jsonb injection, mass assignment, caps) está cerrado por una barrera server-side que el cliente no puede tocar, y el cliente está construido para NO mandar lo que el server fuerza.

---

## Verificación por superficie (lo que el prompt pidió escrutar)

### 1. Write-paths CRUD-plano — audit/tenant spoofing → CERRADO
- `addCustomMeasurement` (`custom-measurements.ts:63`) y `setCustomAttribute` (`custom-attributes.ts:54`) arman el INSERT/UPDATE con builders que proyectan SOLO columnas de dato (`local-reads.ts:1597` measurements: `id, animal_profile_id, field_definition_id, value, session_id, notes`; `:1646` attributes: `id, animal_profile_id, field_definition_id, value`). **`recorded_by`/`updated_by`/`establishment_id`/`recorded_at`/`updated_at` NO se mandan** desde el cliente.
- Aunque un cliente malicioso los inyectara por PostgREST directo, el server los **pisa**: `tg_custom_measurements_force_audit` (0094:44-54) hace `new.recorded_by := auth.uid()` y `new.establishment_id := establishment_of_profile(new.animal_profile_id)`; `tg_custom_attributes_force_audit` (0095:33-44) idem en **BEFORE INSERT *Y* UPDATE** (cubre el vector "pisar establishment_id con un UPDATE"). El `establishment_id` se deriva del **perfil**, no del contexto activo ni del payload → un usuario con rol en el campo B no puede escribir un dato sobre un animal del campo A: el server recomputa el establishment del perfil A y la RLS `has_role_in(establishment_id)` (0094:59-62 / 0095:49-52) lo bloquea (42501). **Anti-spoof confirmado.**
- IDOR al editar un current-value ajeno: `setCustomAttribute` filtra por `(animal_profile_id, field_definition_id)`; la RLS UPDATE `USING (has_role_in(establishment_id))` evalúa la fila EXISTENTE → una fila de otro tenant no matchea. No explotable.

### 2. Serialización de value (`custom-value.ts`) — autoridad server-side → CERRADO
- `serializeCustomValue` (`custom-value.ts:30`) rechaza `NaN/Infinity` (`:32`, evita el `null` que rompería la validación numérica) y arrays con elementos no-string (`:44`). Pero esto es **capa-1/UX**: la autoridad real es `assert_custom_value_valid` (0096:42-82), que valida `jsonb_typeof` por ui_component, pertenencia a `config_schema.options` para enums, cardinalidad ≤50 (0096:68) y **falla cerrado en la rama ELSE** (0096:75-80, ui_component no reconocido → 23514). El cliente no puede bypassear la validación: un value mal tipado sube y es rechazado server-side (descarte + R10.8).
- Double-encoding jsonb resuelto sin abrir inyección (ver punto 3).

### 3. Connector + decode — IDOR por `a:f` y jsonb injection → CERRADO
- `decodeCompositeKey` (`upload-classify.ts:118`) parte el id sintético `a:f` y arma `match = {animal_profile_id, field_definition_id}`. El connector lo aplica como `table.update(payload).eq(col, val)` parametrizado (`connector.ts:95-99`). **No hay interpolación de SQL** y la RLS UPDATE gatea la fila matcheada por establishment → un `a:f` forjado contra otro tenant no escribe nada. El trigger re-fuerza `establishment_id` igual.
- `decodeJsonbColumns` (`upload-classify.ts:162`) hace `JSON.parse(raw)` de un string controlado por el cliente y lo pasa como **valor jsonb parametrizado** a `.upsert/.update` de PostgREST (`connector.ts:82-85,94-95`) — no se concatena a SQL. Un value malformado se deja como string (catch defensivo, `:171`) y el server lo rechaza por tipo. Sin vector de inyección.
- `JSONB_TEXT_COLUMNS` (`upload-classify.ts:150`) acota el decode a `value`/`config_schema` (las validadas por tipo server-side); el comentario justifica por qué `sessions.config`/`maneuver_presets.config` quedan fuera (no cambia comportamiento). Correcto.
- `buildCrudUpsert`/`buildCrudPatch` (`upload-classify.ts:185,207`) hacen `delete data.id` para la PK compuesta → no se manda una columna `id` inexistente (42703) ni se permite mass-assignment de columnas de audit (no están en el opData del builder).

### 4. Owner-only de los dos `+` — defensa en profundidad → OK
- UI: `editar-plantilla.tsx:64,278,298` y `jornada.tsx:128,429,530` gatean el `+` y el sheet de creación a `isOwner` (derivado de `estState.role === 'owner'`). Es **capa-1**; la autoridad es `tg_field_definitions_custom_guard` (0093, owner-only + no-global + inmutabilidad) + RLS owner-only. Un no-owner que cree por PostgREST directo es rechazado server-side (descarte + R10.8).
- `establishmentId` viene SIEMPRE del contexto activo (`estState.current.id`, `editar-plantilla.tsx:85` / `jornada.tsx:94`), **nunca hardcodeado** (CLAUDE.md ppio 6). No es spoofeable a un valor útil: el guard exige `is_owner_of(establishment_id)` del caller.

### 5. Caps de TODO input de usuario → OK (ver tabla)
- Todos los caps client-side son UX; cada input tiene una cota AUTORITATIVA server-side (CHECKs de 0093/0094, ya gateados). El único input sin `maxLength` en el cliente (`text` de `CustomManeuverStep.tsx:469`) está acotado server-side por `custom_measurements_value_size`/`custom_attributes_value_size` (octet_length < 4096, 0094:30 / 0095:27) → no es hueco, solo falta el `maxLength` UX (defensa-en-profundidad, MEDIUM más abajo).

---

## Tabla de inputs (campos que el usuario tipea, nuevos/modificados)

| campo | límite | validación (server / solo-cliente / ausente) | OK? |
|---|---|---|---|
| label (nombre del dato) | ≤80 UX (`maxLength`, `CustomFieldSheet.tsx:267,273`) | server: el `data_key` derivado tiene CHECK ≤64 + slug (0093); label en sí sin CHECK pero acotado por slug | OK |
| opción de enum | ≤60 c/u + ≤50 cardinalidad UX (`CustomFieldSheet.tsx:382,118,122`) | server: options 1..50 / ≤60 (guard 0093) | OK |
| value numeric/stepped | ≤6 dígitos UX (`CustomManeuverStep.tsx:144`) | server: `jsonb_typeof='number'` (0096) + value_size <4096 | OK |
| value text | **sin `maxLength` cliente** (`CustomManeuverStep.tsx:469`) | server: `jsonb_typeof='string'` (0096) + value_size <4096 (0094:30/0095:27) **autoritativo** | OK (cap server) |
| value date | regex `\d{4}-\d{2}-\d{2}` + máscara (`CustomManeuverStep.tsx:502,521`) | server: string + `::date` parse-check (0096:73) | OK |
| value enum_single/multi | solo opciones (no texto libre) | server: pertenencia a options + ≤50 (0096:59-69) | OK |
| notes (captura) | — (no expuesto en esta UI de captura) | server: CHECK ≤500 (0094:33) | OK |

**Conclusión inputs**: cada campo de entrada tiene límite + validación autoritativa server-side. No hay input libre que llegue a la DB sin cota. PASS sobre el mandato de Raf ("límites claros y validación en cada formulario").

## Tabla de rate limits

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| crear dato custom (field_definitions) | n.a. | — | — | CRUD-plano offline vía PowerSync; no es Edge Function ni manda email/SMS/API externa. Owner-only + guard server-side. No es vector de abuso a escala distinto del resto del CRUD offline (fuera de scope de este chunk; sin regresión). |
| capturar measurement / set attribute | n.a. | — | — | idem CRUD-plano offline. Sin fan-out, sin costo por request, sin API externa. |

No se tocó `[auth.rate_limit]` de `config.toml` ni se agregó Edge Function. Sin acción abusable nueva con costo/fan-out.

---

## Findings MEDIUM (defensa en profundidad — NO bloquean)

- **[M-1] `text` ui_component sin `maxLength` client-side** — `CustomManeuverStep.tsx:469-489` (`TextInputStep`) y el draft de la ficha (`CustomFieldInput`/`CustomPropertiesSection`) no ponen `maxLength` en el `TextInput`. El cap autoritativo existe (value_size < 4096 octets server-side), así que NO es hueco de seguridad; pero por paridad con label/opción (que sí limitan UX) y para que el operario no escriba 4KB y reciba un rechazo de sync recién al subir, conviene un `maxLength` UX (p.ej. 500, alineado con `notes`). Mejora de UX/defensa-en-profundidad.

## Findings LOW (anexo)

- **[L-1] `enum_multi` confirma array vacío como dato válido** — `CustomManeuverStep.tsx:442-444` habilita el CTA siempre (array vacío legítimo server-side). No es un problema de seguridad; documentado como decisión de producto (R13.16). Sin acción.

---

## False positives descartados (trazabilidad)

- **service_role / createAdminClient en el diff** — los únicos hits (`app/e2e/helpers/admin.ts`, líneas con "vía service_role") están en un **helper de E2E** (test). Fuera de scope de security review (test files) y nunca en código de app. Confirmado con `git diff … ':(exclude)app/e2e/**' ':(exclude)**/*.test.ts'`: cero service_role/secret/admin-client en código no-test.
- **`console.log` del token en connector.ts:45** — pre-existente (spec 15), NO en este diff; loguea solo booleanos (`hasSession`/`hasToken`) + el endpoint público, nunca el valor del token. No aplica.
- **JSON.parse de input del cliente (`decodeJsonbColumns`, `parseCustomOptions`, `parseCustomValueJson`)** — no es deserialización insegura: `JSON.parse` no ejecuta código; el resultado va parametrizado a PostgREST o se renderiza como dato (React auto-escapa). El server re-valida tipo. No explotable.
- **LIKE injection en buscadores** — no aplica a este chunk (no se agregaron buscadores); `buildSearchLikeQuery`/`escapeLike` (pre-existentes) ya neutralizan comodines. La columna del LIKE es whitelist del service, no input de usuario.

---

## Cobertura indirecta de Deno / RLS / PowerSync (advertencia del agente)

- **RLS / triggers / gating server-side**: la skill de Sentry no cubre SQL/RLS desde un ángulo de DB. Se verificó MANUALMENTE leyendo 0094/0095/0096 SOLO para confirmar que el cliente no elude la frontera (audit forzado, establishment derivado del perfil, fail-closed). La frontera en sí ya pasó Gate 2 (M5-BACKEND) — no re-auditada.
- **PowerSync upload-path**: la skill no modela el connector offline. Se trazó a mano el flujo write-local → CrudEntry → `uploadData` → PostgREST + RLS/triggers. Sin hueco: el write local SIEMPRE "tiene éxito" offline pero el server re-gatea al subir (un rechazo se descarta + R10.8, no persiste).
- **Deno / Edge Functions**: no aplica — este chunk no toca Edge Functions.

---

## Requirements cubiertos

US-13: R13.8 (7 ui_component + render genérico), R13.10 (propiedades enabled en ficha/alta), R13.11 (captura append-only), R13.12 (current-value editable), R13.13 (cualquier rol operativo captura), R13.16/R13.17 (validación + cardinalidad de value, server-authoritative), R13.23 (audit forzado), R13.24 (funciones SECURITY DEFINER + EXECUTE revocado), R13.25 (fail-closed en ui_component no reconocido). Design §11.6/§11.7 (AS-BUILT) consistente con el código.

## Archivos analizados

`custom-measurements.ts`, `custom-attributes.ts`, `custom-fields.ts`, `custom-value.ts`, `custom-field.ts`, `custom-render.ts`, `powersync/connector.ts`, `powersync/upload-classify.ts`, `powersync/local-reads.ts` (builders `buildCustom*`/`buildCrud*`/`decode*`), `powersync/local-query.ts`, `maniobra/jornada.tsx`, `editar-plantilla.tsx`, `maniobra/_components/CustomFieldSheet.tsx`, `CustomManeuverStep.tsx`, `CustomPropertiesSection.tsx` (+ `CustomFieldInput.tsx`, `crear-animal.tsx`, `animal/[id].tsx` por data-flow). Migraciones 0094/0095/0096 leídas como referencia (verificación de frontera, no re-auditoría).
