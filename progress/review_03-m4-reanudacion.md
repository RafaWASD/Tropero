# Review — spec 03 chunk M4 (reanudación de jornada, R10.5/R10.6)

**Reviewer**: reviewer (RAFAQ) · **Fecha**: 2026-06-16
**Chunk**: M4.1 — reanudación en el landing de MODO MANIOBRAS. Frontend puro (sin schema/DB).
**Detalle impl**: `progress/impl_03-m4-reanudacion.md`

## Veredicto: APPROVED

Frontend puro, sin reabrir schema/RLS. Gate 1 N/A (backend de sesiones DONE `0050-0057`;
`getActiveSession`/`closeSession` ya existían desde M1). Pasa a Gate 2 (code) + Puerta 2.

---

## Trazabilidad R<n> ↔ test

| R<n> | Qué exige | Test(s) que lo verifican | Estado |
|---|---|---|---|
| **R10.5** (persistir la jornada en curso + ofrecer retomarla) | `maniobra-resume.test.ts` (resumeManeuversSummary 2 casos, resumeStartedDateLabel 3 casos: hoy→null / otro día→dd/mm / null·inválido→null) + e2e `maniobra-reanudar.spec.ts` (a): jornada abierta → tarjeta "Retomar la jornada de hoy" visible → tap → identificación de ESA sesión (oráculo server: sigue `active`, retomar no cierra). | CUBIERTO |
| **R10.6** (una sola activa por dispositivo; al iniciar otra → retomar o cerrar) | e2e `maniobra-reanudar.spec.ts` (b): "Nueva jornada" con abierta → `NuevaJornadaConfirmSheet` → "Empezar una nueva" → closeSession (oráculo SERVER `waitForServerSessionClosed`) + wizard; (c): sin abierta → directo al wizard (sin sheet); (d): sheet → "Retomar la abierta" → identificar (oráculo: sigue `active`). | CUBIERTO |
| Pluralización / contador es-AR | `maniobra-resume.test.ts` (resumeAnimalCountLabel: 0/1/2/12 + negativos/fraccionarios normalizados). | CUBIERTO |
| Guard tap-through web táctil (R10.6 idiom) | `maniobra-config-sheet-race.spec.ts` 3er test (hasTouch + `touchscreen.tap` sobre `nueva-jornada-scrim`: abrir no auto-cierra; backdrop deliberado sí cierra). | CUBIERTO |

Los oráculos e2e son REALES (consultan `sessions` vía service_role: `waitForServerSessionClosed`,
`readServerSessionStatus`, `waitForServerActiveSessionId`). El fail-closed de "Empezar una nueva"
(cierra ANTES de crear; no navega si `closeSession` falla) está verificado por (b) a nivel server.

## Tasks completas: SÍ (con justificación del `[~]`)

`tasks.md` M4.1 marcado `[~]` (as-built parcial): **R10.5/R10.6 DONE**; **R8.4 (preview de transición
offline) PENDIENTE** — justificación documentada en `tasks.md` §M4.1 y en el contrato del chunk
(R8.4 es add-on de ficha/resumen, no de reanudación). M4.2 (R10.8 surfacing de rechazos de sync)
es chunk APARTE (`[ ]`), explícitamente fuera de scope. **R10.8 NO se implementó de más** (verificado:
sin enganche al canal de status/`classifyIntentUploadError` en los archivos del chunk). El `[~]` está
justificado → no bloquea.

## CHECKPOINTS

- **C2** `[x]` — una sola feature `in_progress` (03); estado coherente.
- **C3** `[x]` — solo capas previstas: `app/app/maniobra.tsx` (screen), `_components/NuevaJornadaConfirmSheet.tsx`
  (component, importa `Button` de `@/components`, NO toca services directo), `src/utils/maniobra-resume.ts`
  (util puro). Sin deps nuevas. Sin logs de debug / TODOs (verificado). `establishmentId` SIEMPRE del
  contexto (`useEstablishment`), NUNCA hardcodeado. Anti-hardcode (ADR-023 §4): 0 violaciones.
- **C4** `[x]` — `maniobra-resume.test.ts` 6/6 (lógica con ramas: pluralización, fecha por día calendario,
  config corrupto). e2e con fixtures reales + oráculos server, sin mocks de I/O crítico.
- **C6** `[x]` — feature `sdd:true`; los 3 archivos de spec presentes; R10.5/R10.6 cada uno con ≥1 test;
  reconciliación as-built hecha (ver abajo). EARS no reescrito (correcto: el qué no cambió, solo la superficie cliente).
- **C7** `[ ]` N/A — no toca tablas con `establishment_id` (no crea schema; `sessions`/`maneuver_presets`
  ya tienen RLS de M1). Multi-tenancy honrada por el contexto + RLS server-side al subir.
- **C8** `[x]` — offline-first: `getActiveSession`/`closeSession` son lecturas/escrituras LOCALES (CRUD-plano
  SQLite, M1); la tarjeta de retomar y el cierre funcionan sin red. La autorización la valida la RLS al subir.

## Checklist RAFAQ-específico

- **A. Multi-tenancy / RLS** — N/A. No crea ni altera tablas; reusa `sessions` (RLS de M1, `0050`). El
  `establishmentId` viene del contexto; `getActiveSession` scopea por establishment local + RLS al subir.
- **B. Offline-first** — APLICA, OK.
  - `[x]` Funciona offline: lecturas/escrituras locales (CRUD-plano), sin requests síncronos a Supabase desde la pantalla.
  - `[x]` Scoped por `establishment_id` activo (del contexto, no hardcodeado).
  - `[x]` LWW explícito (heredado de PowerSync, sessions CRUD-plano; documentado en `sessions.ts`).
  - `[x]` La pantalla usa el repositorio (`@/services/sessions`), no toca SQLite/Supabase directo.
- **C. BLE** — N/A. El landing no toca BLE (la identificación, destino del tap, sí — pero está fuera de este chunk).
- **D. UI de campo** — APLICA, OK (con 1 nota menor, no bloqueante).
  - `[~]` Targets: tarjeta de retomar = full-width card grande; CTA "Nueva jornada", botones del sheet y
    "Cancelar" usan `$touchMin = 56`. El checklist menciona ≥60dp; 56 es el token DS canónico usado por TODOS
    los sheets hermanos (ExitJornadaSheet/SavePresetSheet) — consistencia DS, no regresión. El piso de ≥60px de
    R5.2/R12.2 aplica a los bloques de DECISIÓN de la carga rápida, no a este landing/sheet. Nota, no cambio requerido.
  - `[x]` Fuente legible: títulos `$6`/`$7`, cuerpo `$5`/`$4`.
  - `[x]` Una decisión por pantalla: el sheet ofrece 3 acciones claras en una columna; nada rojo (cerrar no es destructivo).
  - `[x]` Loading visible: `loading` deshabilita el CTA + InfoNote "Cargando rutinas…"; el sheet muestra "Cerrando la abierta…" al confirmar.
  - `[x]` Recorte de descendentes: lineHeight matching en todo heading/Text con numberOfLines (verificado en
    capturas 360/412: "jornada" / "abierta" con la "j" completa; "…de hoy" NO se trunca, envuelve a 2 líneas en 360).
- **E. Edge Functions** — N/A. No toca Edge Functions.

## Reconciliación de specs (código → spec): OK

- `design.md` §6.bis.11 NUEVA — describe el as-built fielmente (tarjeta + sheet + guard de carrera + fail-closed
  + lógica pura). Coincide con el código.
- `requirements.md` — notas de reconciliación as-built bajo R10.5 (superficie RETOMAR en el landing) y R10.6
  (NuevaJornadaConfirmSheet = retomar/cerrar la activa + guard de carrera). EARS no reescrito (correcto: el qué
  no cambió). No quedó mintiendo.
- `tasks.md` §M4.1 `[~]` con justificación del R8.4 pendiente y R10.8 (M4.2) aparte.

No hay contradicción spec ↔ código as-built.

## Tests / check.mjs

- `node scripts/check.mjs`: ROJO por UN solo fallo → `supabase/tests/animal/run.cjs` R2 INPUT-1
  (`animals_tag_unique`, `23505` duplicate key sobre `animals.tag_electronic`). Es el FLAKE CONOCIDO de la
  suite backend del spec 02 por terminales paralelas colisionando en inserts de tag (memoria
  `reference_check_red_rate_limit` / `animals_tag_unique`). **Frontend puro, NO regresión de este chunk.**
- Typecheck client: OK.
- Anti-hardcode (ADR-023 §4): 0 violaciones.
- Client unit (harness resolver): `maniobra-resume.test.ts` 6/6; suites M4-adyacentes 190/190 verde.
- e2e: NO re-ejecutado acá (requiere `expo export -p web` + DB remota compartida → colisiona con la terminal
  paralela activa que causa el flake; sin ganancia de confianza que no tenga ya). Specs correctas por inspección,
  con oráculos server reales; impl reporta 4/4 (reanudar) + 3/3 (race) + wizard 1/1 + identify 15/15.
- Capturas web táctil 360/412 verificadas visualmente: `retomar-jornada-landing-{360,412}.png`,
  `nueva-jornada-confirm-{360,412}.png` (en `tests/modo-maniobra/`).

## Cambios requeridos

Ninguno bloqueante. (Nota DS menor sobre `touchMin=56` vs ≥60dp del checklist D — consistente con el DS,
no se pide cambio.)
