# Spec 02 — Delta PARTO: RODEO + CARAVANA VISUAL DEL TERNERO (#4 / #1a) — Tasks

**Status**: `spec_ready` · Delta **Nivel B (ADR-028)** sobre spec 02 (feature `done`) · **frontend-only** · **Gate 1 N/A**.
**Requirements**: `requirements-parto-rodeo-caravana.md` (`RPRC.<n>`) · **Design**: `design-parto-rodeo-caravana.md`.
**Orden de ejecución**: **frontend directo, sin backend** — el RPC `register_birth` 6-arg (`0116`) y `registerBirth({ calfRodeoId, calfIdv })` ya están deployados/listos (delta #15). NO se toca `supabase/` (`git diff supabase/` debe quedar vacío). No hay migraciones ni suites backend nuevas.

> El implementer marca `[x]`. El reviewer rechaza si queda `[ ]` sin justificación documentada. Cada tarea cita los `RPRC.<n>` que cubre. Reúso de #15 (`LinkCalfPrompt.tsx`) es obligatorio donde el `design` §2 lo mapea — no inventar componentes nuevos.

---

## Fase A — Navegación: pasar el rodeo de la madre al form de parto

- [x] **T1** — `app/app/animal/[id].tsx` (`goToAddEvent`): agregar a los params de la navegación a `/agregar-evento` los campos **`rodeoId`** y **`rodeoName`** de la madre (desde `detail.rodeoId`/`detail.rodeoName`, ya disponibles), junto a los actuales (`profileId`/`establishmentId`/`sex`/`pregnant`). Sin fetch extra. Cubre: RPRC.1.2, RPRC.1.3. **[as-built]** Se conservan los params pero como **seed/fallback del NOMBRE** — la resolución autoritativa de `rodeoId`/`systemId` la hace el read local `fetchMotherRodeoContext` (T3, veto leader #1: uniforme para todo caller, offline). Grep confirmó que la maniobra NO rutea a `agregar-evento` para parto → un solo caller (la ficha).

## Fase B — Lógica pura del rodeo efectivo + idv single-calf (testeable)

- [x] **T2** — Helpers puros nuevos (p.ej. en `utils/event-input.ts` o un módulo dedicado) + tests unitarios: `resolveEffectiveCalfRodeoId(selected, motherRodeoId)`, `resolveMotherSystemId(rodeos, motherRodeoId)`, `eligibleCalfRodeos(rodeos, motherSystemId)` (filtro por sistema; `[]` si `motherSystemId` null → fallback), `calfIdvForSubmit(calvesLength, idvRaw)` (`calvesLength===1 && idvRaw.trim() ? trim : null`). Espejan la lógica inline de `LinkCalfPrompt.tsx:122-127`. Cubre: RPRC.1.6, RPRC.1.7, RPRC.3.2, RPRC.3.3.

## Fase C — Picker de rodeo a nivel parto (#4 / D1)

- [x] **T3** — `agregar-evento.tsx`: estado nuevo del screen `calfRodeoId: string | null` (rodeo elegido, `null` = usar el de la madre). Leer `rodeoId`/`rodeoName` de los params; obtener los rodeos con `useRodeo()` (campo activo, lectura local); resolver el `systemId` de la madre (`resolveMotherSystemId`) y los rodeos elegibles (`eligibleCalfRodeos`). Cubre: RPRC.1.1, RPRC.1.6, RPRC.4.4. **[as-built]** El `systemId` (y el `rodeoId`) autoritativos salen de un **read local** del perfil de la madre vía `fetchMotherRodeoContext(profileId)` (nueva función en `services/events.ts`, reusa `buildBirthOverlayContextQuery`) en un `useEffect`; `resolveMotherSystemId(available, motherRodeoId)` queda como **fallback** cuando el read aún no resolvió. Estado extra: `calfIdv`, `rodeoPickerOpen`, `motherCtx`.
- [x] **T4** — `PartoForm`: renderizar el **selector de rodeo inline a nivel parto** (entre la fecha y el bloque de terneros, `design` §3), **reusando el patrón** del `CreateCalfForm` de `LinkCalfPrompt.tsx` (trigger + `ChevronDown` + lista expandible + `RodeoOptionRow`): preseleccionado al rodeo de la madre, editable a otro rodeo del **mismo sistema**. Cubre: RPRC.1.1, RPRC.1.2, RPRC.1.5, RPRC.6.1.
- [x] **T5** — Leyenda **"(Mismo rodeo que la madre)"**: mostrar mientras el rodeo efectivo (`resolveEffectiveCalfRodeoId`) coincida con el de la madre; ocultarla cuando se elige otro. Cubre: RPRC.1.3, RPRC.1.4.
- [x] **T6** — **Fallback no-editable** (RPRC.1.8, criterio propio §8.2): si el `rodeoId` de la madre no está en `useRodeo().available` (parto sobre animal de campo distinto del activo, o `RodeoContext` no `active`), preseleccionar el rodeo de la madre (nombre desde el param `rodeoName`) **sin ofrecer opciones** (no editable) + leyenda, sin romper el form. Cubre: RPRC.1.8.

## Fase D — Caravana visual del ternero (idv) single-calf (#1a / D2)

- [x] **T7** — `agregar-evento.tsx`: estado nuevo `calfIdv: string`. En `PartoForm`, renderizar un `FormField` de **caravana visual del ternero (opcional)** a nivel parto **solo cuando `calves.length === 1`**, con `onChangeText` sanitizado por `sanitizeIdvInput`. Cubre: RPRC.2.1, RPRC.2.2, RPRC.6.1.
- [x] **T8** — Nota de mellizos: cuando `calves.length >= 2`, **ocultar** el campo de caravana visual y mostrar una `InfoNote` con el copy *"Las caravanas visuales de mellizos se asignan después desde la ficha de cada ternero."* Cubre: RPRC.2.3, RPRC.2.4.
- [x] **T9** — Conservar el **tag electrónico por ternero** dentro de cada `CalfBlock` sin cambios (RPRC.2.5) y el resto del `PartoForm`/`validateCalves`/mínimo 1 ternero/agregar-quitar/aviso suave sin regresión (RPRC.5.2). Cubre: RPRC.2.5, RPRC.5.2.

## Fase E — Wiring a `registerBirth` (D2 / RPC escalar)

- [x] **T10** — En `onSubmit` (`eventType==='birth'`): pasar `calfRodeoId` = rodeo efectivo a `registerBirth`; pasar `calfIdv` **solo** si `calves.length === 1` y hay idv (`calfIdvForSubmit`), omitido/`null` con `≥2` terneros — sin alterar el resto del payload (`calves`/`eventDate`/`motherProfileId`). Cubre: RPRC.3.1, RPRC.3.2, RPRC.3.3, RPRC.3.4.
- [x] **T11** — Verificar/anotar que la validación server-side (rodeo activo/tenant/sistema → `23514`; idv único/inmutable → `23505`) y su clasificación **permanente** offline la resuelven `register_birth` 6-arg + `uploadData` as-built (sin código nuevo); documentar el camino en `impl_parto-rodeo-caravana.md`. Cubre: RPRC.4.1, RPRC.4.2, RPRC.4.3, RPRC.4.4.

## Fase F — MUSTs de UI de campo (D4)

- [x] **T12** — MUSTs de forms sobre lo nuevo: **solo tokens** (ADR-023 §4, sin hex/px), **es-AR** voseo (picker/leyenda/label idv/nota), **anti-recorte** (`lineHeight` matcheado en headings ≥`$6` y todo `Text` con `numberOfLines`), **validación inline** conservada (sin banner global nuevo que tape el título). Cubre: RPRC.6.2, RPRC.6.3, RPRC.6.4.
- [x] **T13** — Confirmar que el cambio cubre el parto **desde la ficha** y **desde la maniobra** con un solo cambio (misma pantalla `agregar-evento.tsx`); verificar el/los caller(s) de `eventType='birth'` y que ambos pasen los params de rodeo (si la maniobra usa otra ruta/param set, ajustarla). Cubre: RPRC.5.3.
- [x] **T14** — Confirmar **frontend-only**: `git diff supabase/` vacío, sin migración/schema/RLS/RPC nuevos. Cubre: RPRC.5.1.

## Fase G — Gate 2.5 (ADR-029) + E2E de regresión (D5)

- [x] **T15** — **Capture file** `app/e2e/captures/parto-rodeo-caravana.capture.ts` con capturas nombradas de cada estado: (a) parto **single** con rodeo picker + leyenda + campo de caravana visual; (b) parto **mellizos** (2 terneros) **sin** idv + la **nota**; (c) **picker de rodeo abierto** (rodeos del mismo sistema); (d) **rodeo cambiado** (la leyenda desaparece); (e) validación inline **N/A** documentada (este delta no agrega validación client-side nueva, §8.4). El leader veta visualmente antes de la Puerta 2. Cubre: RPRC.7.1.
- [x] **T16** — **E2E de regresión** en `app/e2e/animals.spec.ts` (o suite de eventos): el picker de rodeo aparece y el rodeo elegido aplica al confirmar; el campo de caravana visual aparece con 1 ternero y desaparece (con la nota) al agregar un 2º; `registerBirth` recibe `calfRodeoId`/`calfIdv` esperados. Import de `test`/`expect` desde `./helpers/fixtures` (no `@playwright/test`). Correr la suite. Cubre: RPRC.7.2. Ojo `reference_e2e_design_png_rerender`: NO `git add -A` tras un e2e; revertir `design/**` antes de commitear.

## Fase H — Cierre

- [x] **T17** — Reconciliación (regla dura `docs/specs.md`): mapa `RPRC.<n> → archivo:test` en `progress/impl_parto-rodeo-caravana.md`; reflejar cualquier fix de la autorrevisión / Gate 2 en estos 3 archivos **antes** de cerrar/commitear. El **fold al baseline** (puntero + bloque "Deltas posteriores" bajo R9/R14) lo hace el **leader** al cerrar la Puerta 2 — **NO** en este delta. Cubre: RPRC.7.3.

---

## Notas de ejecución

- **Frontend-only**: no hay backend que deployar. Todo el flujo es offline-first sin red nueva (lectura de rodeos local vía `useRodeo()`; escritura por la outbox de `registerBirth`, params `p_calf_rodeo_id`/`p_calf_idv` ya soportados en `events.ts:627-628`).
- **Reúso obligatorio de #15**: el picker de rodeo, la leyenda, el filtro por sistema y el sanitizado de idv salen de `LinkCalfPrompt.tsx` (`design` §2). No duplicar aritmética/patrones ya resueltos.
- **Restricción del RPC (D2)**: `register_birth` toma `p_calf_idv`/`p_calf_rodeo_id` **escalares únicos** → idv solo se ofrece/envía con 1 ternero; el rodeo aplica a toda la camada. idv por-mellizo requiere backend + deploy → fuera de alcance (backlog, `design` §7 alt. #1).
- **WIP**: coordinar con otros deltas sobre spec 02 que tocan `agregar-evento.tsx`/`events.ts`/`crear-animal.tsx` para no colisionar (el leader gestiona el WIP).
- **Decisiones de criterio propio** (a confirmar en Puerta 1, `design` §8): idv single-calf + descarte con mellizo (D2); fallback no-editable RPRC.1.8; layout a nivel parto; sin validación client-side nueva (captura (e) N/A).
