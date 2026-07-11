# Review — delta `03-skip-por-paso-v2` (C rediseño skip POR-PASO + D2 chevron "Faltan vacunas")

> ADR-028 Nivel A · frontend puro · Gate 1 N/A · Puerta 2 demo-facundo-padre 2026-07-10.
> Contexto: el implementer crasheó mid-run y se resumió → escrutinio de wiring real (imports muertos,
> truncamiento, re-captura tras corrección). Reviewer read-only.

## Veredicto: APPROVED

## Trazabilidad R ↔ test (completa)

- **R5.15 — skipped deliberado = HECHO (no bloquea el resumen, no re-surfacea)**
  → `maneuver-sequence.test.ts`: "un SALTEADO deliberado cuenta como HECHO" (L144), "solo un paso AUSENTE
    frena; un skipped no" (L155), "reanudar NO re-surfacea un paso salteado" (L167).
  → E2E `maniobra-skip-paso.spec.ts` #1 (L87): saltear aptitud → mismo animal sigue en pesaje (· 2 de 2) →
    resumen "Salteado" + pesaje persiste (`waitForServerWeightEventWithSession`).
- **R5.15 — resumen muestra "Salteado", corregible** → `maneuver-sequence.test.ts`: describeStepValue
  "Salteado" (L226), summaryRows captured:false + value "Salteado" (L297). AnimalSummary: fila muted +
  tappable a onEdit, confirm incondicional (no la bloquea).
- **R5.15 — botón nombra la maniobra** → `maneuver-sequence.test.ts`: skipStepButtonLabel corto (L344) +
  fallback "Saltear paso" (L357).
- **R5.15 — corrección captura→salteado soft-borra ACOTADO al paso + reset ids** → `maneuver-skip.test.ts`:
  "target de UN solo paso" (L130), "vacunación borra eventId+extras" (L137), "dientes excluido" (L145).
- **R5.15 — skip animal-entero secundario intacto** → E2E `maniobra-skip-paso.spec.ts` #2 (L140): overflow
  "⋯" → SkipAnimalSheet "Se descarta lo cargado" → confirma → descarta + "0 hoy" (no cuenta).
- **R1.7 — D2 chevron terracota "Faltan vacunas"** → E2E `maniobra-wizard.spec.ts`: `selected-config-fix-2`
  visible + continue bloqueado "Completá las vacunas" (L177-178). Capture `vacunas-checklist.capture.ts`
  `selected-config-fix-0` (L116).

## Tasks completas: sí
- Delta Nivel A (ADR-028): no hay `tasks-*.md` nuevo (correcto — el baseline `tasks.md` no se toca). El ledger
  del incremento vive en `progress/impl_03-skip-por-paso-v2.md`: T1..T7 todas `[x]`.

## Verificación de wiring (post-crash) — SIN hallazgos
- `pnpm typecheck` → EXIT 0 (no dead imports; toda import de carga.tsx usada: collectManeuverDiscardTargets,
  countPersistedCaptures, skipStepButtonLabel, discardManeuverEvents, SkipAnimalSheet).
- `anti-hardcode` (ADR-023 §4) → 0 violaciones.
- Unit relevantes → 1039/1039 verde (incl. familia maniobra: sequence/skip/event-query/vaccine-checklist/
  step-kind/config/wizard/applicability + local-reads/maneuver-reads).
- Re-captura tras corrección→salteado verificada por lectura: reset borra el id viejo (soft-deleteado) →
  `eventIdFor` genera id FRESCO → INSERT limpio, sin colisión de PK. `isCorrection` recalcula false sobre un
  prev `skipped` → INSERT (no UPDATE). Correcto y fail-closed (si el soft-delete falla, no avanza).
- `default` del dispatcher (PlaceholderStep) = código muerto defensivo: los 13 ManeuverKind mapean a los 11
  StepKind manejados; `stepKindFor` cae a `silent_single` (manejado). Nunca se renderiza en prod.
- Spikes (paso/rueda-ce/tacto-spike) NO pasan skip props → layout original (hasSkip=false → ProgressChip):
  cero regresión. No quedan refs al prop viejo `onSkip` de SpikeIdentityHeader ni testIDs de skip huérfanos.

## Exactitud specs (código → spec): OK
- `design.md` "Deltas posteriores" fila `skip-por-paso-v2` (L23) describe el as-built (skip por-paso primario,
  skipped=HECHO, corrección soft-delete+reset, custom excluida, skip animal secundario overflow, D2 chevron).
- `requirements.md` R5.15 nota de reconciliación (L190-194) + R1.7 nota D2 chevron (L45) fieles al código.
  No hay spec vieja que contradiga el as-built.

## check.mjs
- Porción relevante al delta (frontend puro) VERDE: estructura + feature_list + anti-hardcode + typecheck +
  client unit (1039). Las suites backend/remotas (RLS/Edge/Animal/Maneuvers/…) NO se corrieron: este delta
  toca CERO backend (sin migraciones/RLS/RPC/Edge — Nivel A frontend puro) y hay un implementer de feature A
  escribiendo la DB compartida en paralelo → correrlas ahora arriesga false-red por contención (memoria
  reference_check_red_rate_limit) y colisión con esa terminal. No son señal de regresión para este delta.

## CHECKPOINTS
- [x] C2 — estado coherente (delta sobre feature done; A es la in_progress).
- [x] C3 — arquitectura: utils puros + screen (carga.tsx orquesta services) + components (SpikeIdentityHeader/
      ManeuverReorderList importan solo utils/tamagui/lucide, no services). Sin debug logs / TODOs sueltos.
- [x] C4 — verificación real: unit con node:test (skip/sequence), E2E con oráculos correctos.
- [x] C6 — SDD: cada R con ≥1 test; specs reconciladas.
- [x] C9 — E2E de regresión (`maniobra-skip-paso.spec.ts` #1/#2 + assert D2 en `maniobra-wizard.spec.ts`) +
      captures (`skip-animal-maniobra.capture.ts` reescrito, `vacunas-checklist.capture.ts` +chevron). Oráculos
      correctos, sin testIDs muertos. Ejecución + veto visual = Gate 2.5 del leader (no del reviewer).
- [ ] C7 — N/A (no toca tablas con establishment_id).
- [x] C8 — offline-first (ver checklist B).

## Checklist RAFAQ-específico
- **A. Multi-tenancy/RLS**: N/A — el delta no crea ni toca tablas; skip = estado puro + soft-delete local.
- **B. Offline-first**: [x] skip = estado `{kind:'skipped'}` puro + soft-delete LOCAL (`discardManeuverEvents`
  → runLocalWrite, CRUD-plano). [x] Sin requests síncronos a Supabase desde la pantalla (todo por
  services→SQLite). [x] Conflict resolution = LWW (soft-delete por `deleted_at`, uploadData lo sube;
  idempotente `deleted_at IS NULL`). [x] Fail-closed en el descarte (per-paso y animal-entero).
- **C. BLE**: N/A — reusa el identify BLE existente, sin cambios.
- **D. UI de campo**: [x] una decisión por pantalla (pill primaria "Saltear <maniobra>" vs overflow "⋯"
  secundario; Fitts: skip arriba-derecha, lejos del CTA de confirmar abajo). [x] fuentes legibles (pill $4,
  IDV $9). [x] lineHeight matching en todo Text con numberOfLines (sin recorte de descendentes). [x] estado
  loading existente (spinner "Abriendo el animal…"). Nota: targets usan `$touchMin`=56 (token app-wide,
  consistente, sobre el mínimo de plataforma) — por debajo de la guía RAFAQ de 60dp, pero es el estándar
  canónico pre-existente del app, no introducido por este delta → no bloqueante.
- **E. Edge Functions**: N/A.

## Cambios requeridos: ninguno (bloqueantes)

## Observaciones no bloqueantes (para el veto visual del leader en Gate 2.5)
1. **Squeeze de la caravana con IDV largo** (SpikeIdentityHeader L151-161): en modo paso, línea 1 = IDV
   (flexShrink=1) + pill + "⋯"; un IDV largo (RFID 15 díg sin caravana visual) elipsa para dar lugar al pill.
   Tradeoff documentado (autorrevisión #8), igual que v1. Caso común (caravana "0385") entra holgado. Vetar
   con capturas 01/02.
2. **D2 chevron contraste**: correcto — círculo terracota LLENO + chevron BLANCO (~5.1:1); no quedó terracota
   suelto sobre el verde botella (que daría 1.59:1). Confirmar visualmente el pop contra el fondo $primary.
3. **dientes corrección→salteado**: `teeth_state` (propiedad, no fila) NO se revierte — excepción documentada
   y consistente con skip-animal. Decisión de scope, no bug.
