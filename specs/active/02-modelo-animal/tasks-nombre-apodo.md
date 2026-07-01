# Spec 02 — Delta NOMBRE/APODO por rodeo (#2, parte toggle) — Tasks

**Status**: `spec_ready` · Delta **Nivel B (ADR-028)** · **CON BACKEND** (seed `0119`) · **Gate 1 condicional** · **Deploy autorizado** · Orden: **backend (seed) → frontend (sacar built-in) → capture/tests**.
**Requirements**: `requirements-nombre-apodo.md` (RNA.1–RNA.8). **Design**: `design-nombre-apodo.md`.

> El `tasks.md` baseline de spec 02 NO se toca (ledger histórico, ADR-028). Este delta trae su propio checklist. El implementer marca `[x]`; el reviewer rechaza `[ ]` sin justificación.

---

## Backend — seed (RNA.1, RNA.6)

- [x] **T1 — Migración `0119_seed_apodo_field_definition.sql` (backfill-only).** `INSERT ... SELECT FROM establishments` del "apodo" per-est en `field_definitions` (`data_key='apodo'`, `label='Nombre / apodo'`, `ui_component='text'`, `data_type='propiedad'`, `category='identificacion'`, `active=true`, `establishment_id` = cada `establishments.id`), idempotente (`on conflict (establishment_id, data_key) where establishment_id is not null and deleted_at is null do nothing` — predicado del índice `0101` vigente, fix Gate 1). **Sin trigger** sobre `establishments` (DP2 diferida — no tocar el onboarding). NO toca `rodeo_data_config`/`system_default_fields`/RLS/streams/gating. **NO aplicada al remoto** — la aplica el leader por MCP tras los gates. Cubre: RNA.1.1, RNA.1.2, RNA.1.3, RNA.1.4, RNA.1.5, RNA.6.1, RNA.6.2, RNA.6.5.

- [x] **T2 — Test backend del seed.** `supabase/tests/custom/run.cjs` subtest `(p)`. **As-built:** como el seed es **backfill-only** (sin trigger) y la suite usa fixtures **frescas** (un establishment creado por el test NO queda auto-seedeado), el test **replica el INSERT del seed** (mismo cuerpo, service_role → `auth.uid()` NULL → el guard hace `return new`) sobre `estA` y verifica: (a) la fila `apodo` per-est con los campos de T1 (RNA.1.1/1.4); (b) NO está en `system_default_fields` (RNA.6.2) ni auto-enabled en `rodeo_data_config` (RNA.1.3); (c) un 2do apodo vivo colisiona (índice parcial `0101` → 23505, base de la idempotencia RNA.1.2); (d) el owner lo habilita en el rodeo → `enabled=true` (RNA.8.3); (e) `custom_attributes` string OK / número → 23514 (`assert_custom_value_valid`, RNA.6.3). El test es **determinista y NO depende de `0119` aplicado** (prueba la lógica del seed sin estado compartido flakeable); el backfill de los establecimientos **pre-existentes** lo aplica + verifica el leader por MCP (`select count(*) ... data_key='apodo' and category='identificacion'`). **NO corrida** (la corre el leader tras aplicar `0119`). Cubre: RNA.1.1, RNA.1.2, RNA.1.3, RNA.6.2, RNA.6.3, RNA.8.3.

## Frontend — sacar el built-in del alta (RNA.2, RNA.3, RNA.5)

- [x] **T3 — Remover el input editable "Nombre / seña (opcional)".** En `crear-animal.tsx` (paso 4, `Step4Data`) eliminado el `FormField` que se mostraba por default. **Conservado** el display read-only `prefillKind === 'visual'` ("Nombre / seña (no editable)"). Podado el wiring muerto: prop `onVisual` (parent + destructure + type de `Step4Data`), imports `sanitizeVisualInput` + `VISUAL_MAX_LENGTH` (quedaron sin uso), y `visual` pasó de `useState` a un `const` derivado read-only (`prefillKind === 'visual' ? prefilledVisual : ''`) — sigue alimentando el display read-only + `hasAtLeastOneIdentifier` + `visualIdAlt`. El util `sanitizeVisualInput`/`VISUAL_MAX_LENGTH` NO se borró de `animal-input.ts` (lo usa el import flow / tests). Cubre: RNA.2.1, RNA.2.2, RNA.2.3, RNA.5.1, RNA.5.2.

- [x] **T4 — Ajustar el mensaje de identificador mínimo.** En `crear-animal.tsx` el copy quedó `'Cargá al menos un identificador: caravana electrónica o caravana visual.'` (sin "nombre/seña"). `hasAtLeastOneIdentifier(tag, idv, visual)` NO se relajó (sigue aceptando `visual` para el camino prefill `visual`); el server sigue exigiendo ≥1 identificador. El mensaje del **import flow** (`import-rodeo.tsx`) NO se toca (no-alcance, feature 12). Cubre: RNA.3.1, RNA.3.2.

- [x] **T5 — Verificar la ficha (sin cambios de código).** Confirmado: `animal/[id].tsx` conserva el display condicional de `visual_id_alt` ("Nombre / seña" solo-si-`visualIdAlt != null`, L898-899) y el "apodo" habilitado se muestra por `CustomPropertiesFicha` ("Datos personalizados"). Sin edición de código. Cubre: RNA.4.1, RNA.4.2.

## Capture + tests (RNA.7, RNA.8)

- [x] **T6 — Capture `app/e2e/captures/nombre-apodo.capture.ts`.** Molde `cria-al-pie-alta.capture.ts`. Un flujo con 4 shots nombrados: `01-alta-paso4-sin-nombre-sena` (RNA.2.1), `02-mensaje-identificador-minimo` (RNA.3.1), `03-apodo-en-datos-personalizados` (via `seedCustomField` propiedad/text, RNA.2.2), `04-ficha-apodo-datos-personalizados` (RNA.4.2). Salida a `__shots__/nombre-apodo/` (gitignored). Compila (`playwright --list` OK). **NO corrido** (lo dispara el leader en el Gate 2.5 con `pnpm e2e:build` + `--config playwright.capture.config.ts`). Cubre: RNA.7.1.

- [x] **T7 — E2E de regresión en `app/e2e/animals.spec.ts`.** Bloque `delta #2 nombre/apodo` (2 tests): (a)+(b) el alta NO renderiza "Nombre / seña" por default + el mensaje de identificador mínimo (alta en blanco) no menciona "nombre/seña" (`toHaveCount(0)` sobre `/nombre\s*\/\s*seña/i`) sin navegar (RNA.2.1/3.1/3.2); (c) con el "apodo" seedeado+habilitado (`seedCustomField`) el campo aparece en el alta bajo "Datos personalizados", se carga y persiste en `custom_attributes` (oráculo `waitForServerCustomAttribute`), y se ve en la ficha (RNA.2.2/4.2/8.2). Importan `test`/`expect` de `./helpers/fixtures`. **As-built (consecuencia obligatoria de RNA.2.1):** al remover el built-in editable, se migraron los **~17 fills** existentes de "Nombre / seña (opcional)" en `animals.spec.ts` + los de `sigsa-breed-renspa.spec.ts`, `maniobra-identify.spec.ts` y `maniobra-custom-render.spec.ts` para usar la **caravana visual (idv)** como identificador (+ oráculos server `{ idv }`). Los `seedAnimal({ visualAlt })` (service_role) se conservan (testean el display legacy de ficha, RNA.4.1). Compilan (`playwright --list` 58 tests OK). **NO corrida** (la corre el leader). Cubre: RNA.8.1, RNA.8.2.

- [ ] **T8 — Reconciliación de cierre (pre-Puerta 2).** Pendiente **al cierre (leader, Puerta 2)** — patrón #15 T22 / aptitud: foldear al `design.md` **baseline** de spec 02 el bloque "Deltas posteriores" (slug `nombre-apodo` + 1 línea + estado) + nota as-built bajo R6.2 / R13.10 (apodo = dato custom per-est vía `custom_attributes`; built-in `visual_id_alt` removido del alta, display legacy conservado en ficha). NO reescribir los EARS del baseline. Cubre: ADR-028 reconciliación de cierre.

---

## Notas para el implementer / leader

- **Deploy del seed**: `0119` la aplica el **leader por MCP** tras Gate 1 (si el analyzer lo pide) + reviewer + Gate 2 + Gate 2.5. NO aplicar desde el implementer.
- **Puerta 1**: DP1 (per-est), DP3 (`category='identificacion'`), DP4 (alcance de la remoción) **aprobadas**; DP2 **diferida** = **backfill-only** (sin trigger). Los ests futuros crean el "apodo" on-demand; el auto-seed seguro (fold en `handle_new_establishment` 0011) queda en `docs/backlog.md`. El delta ya no toca el path de onboarding → menor superficie de Gate 1.
- **Trazabilidad**: el implementer registra `RNA.<n> → archivo:test` en `progress/impl_<slug>.md`; el reviewer verifica cobertura + que ningún `[ ]` quede sin justificar.
