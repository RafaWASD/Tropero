# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a `history.md`.
> Mientras trabajás, **mantenelo actualizado en tiempo real**, no al final.

**SESIÓN 2026-06-29 — CORRECCIONES DEL TESTEO EN VIVO CON FACUNDO (15) + CONVENCIÓN SDD PARA FIXES (ADR-028) + FASE 1 EN CURSO.**

## Contexto
Raf + Facundo testearon la app en vivo (fase PRE-campo, sin datos reales, **bastón todavía no probado**) y trajeron 15 correcciones. Tarea: triage (categorizar/agrupar/ordenar) + plan de corregir de a 1 + resolver cómo documentar fixes bajo SDD.

## Hecho esta sesión
1. **Triage completo** → `docs/correcciones-prueba-en-vivo-2026-06-27.md`: 15 correcciones mapeadas a archivo:línea (4 Explore en paralelo + verificación a mano), agrupadas en **6 segmentos** (A vínculo madre-cría · B reportes repro · C caravana desde ficha · D maniobra/aptitud · E pulido alta · F circunferencia escrotal), ordenadas por importancia/dificultad, con plan de ejecución y clasificación Nivel A/B por corrección.
2. **Convención SDD para cambios sobre features `done`** (pregunta de Raf): **ADR-028** (`docs/adr/ADR-028-documentacion-sdd-cambios-sobre-features-done.md`, `Accepted`) + fila en índice + sección nueva en `docs/specs.md`. Regla de 2 niveles: **Nivel A** (in-place, sin spec — reconciliás baseline + changelog + Gate 2) para lo que solo pule el *cómo*; **Nivel B** (delta-spec `{context,requirements,design,tasks}-<slug>.md`, el patrón que ya se usaba) para cambio sustancial — el `tasks.md` original NO se toca; al cerrar el delta se folda puntero + índice "Deltas posteriores" al baseline.
3. **Decisiones de dominio cerradas con Raf** (en `docs/correcciones-…md`): parición = servicio+9 meses, mostrar SOLO en meses de parto, leyenda obligatoria si quedan preñadas sin parir, servicio 12m no muestra repro · aptitud = flag de TODA hembra (no solo vaquillonas), CUT→no_apta, altas grandes=apta, inseminación solo APTA + nunca machos, **servidas = derivación en vivo** (no batch día-1) · caravana 3→2: `visual_id_alt`→"Nombre/apodo" atado a toggle de rodeo · #5 = badge de estado reproductivo (Preñada/Vacía/sin tacto) en lista+ficha · #6 = prompt aptitud en alta (SÍ/AÚN NO SÉ/NO ES APTA). **Peso de destete → `docs/backlog.md`** (gatea segmento A + parte de B, se refina con Facundo).

## EN CURSO — Fase 1 (Nivel A quick wins)
Implementer (`a5d802b9a1548fd62`) entregó los 3 fixes + autorrevisión:
- **#9** "KPIs"→"Datos" (`reportes.tsx:340,355`; resto eran identificadores de código).
- **#12** orden de dientes mayor→menor (sin/1·4/1·2/3·4/BLL/6d/4d/2d). **Gotcha cazado**: el alta usa `animal-category-fields.ts` (orden propio distinto), NO el `teeth-options.ts` compartido → alineó ambos + oráculos de orden en los 2 tests.
- **#11** circunferencia escrotal: removido el sparkline (barra verde) — solo lista; edad en años ≥24m vía util nueva pura `formatAgeYearsAR`.
- **Veto de diseño del leader: PASS** con 2 ajustes (EN CURSO en background): (a) consistencia riel/lista — el nodo CE del timeline también muestra años ≥24m (`describeScrotalTimeline`); (b) `lineHeight="$3"` al sub-Text "edad·fecha" (descender clipping de jun/jul/ago, bug recurrente).
- **Verificación**: typecheck + lint anti-hardcode + 117 unit verdes. E2E NO corrido en vivo (riesgo de flake 2-terminales); aserciones reconciliadas estáticamente.

**Fase 1 DONE + COMMITEADA** (2026-06-29): reviewer APPROVED + Gate 2 PASS 0 HIGH + **Puerta 2 aprobada por Raf**. 2 commits en `main`: `2009104` (ADR-028 + triage) + `d67ea3e` (código #9/#12/#11). 116/116 unit + typecheck + anti-hardcode verdes; e2e reconciliado estáticamente (no corrido en vivo por riesgo de flake 2-terminales — quedó como deuda menor).

## EN CURSO — Gate 0 del delta de APTITUD REPRODUCTIVA (keystone, elegido por Raf)
**Gate 0 APROBADO** (Puerta 0, Raf 2026-06-29) → `context-aptitud-reproductiva.md`. **Hallazgo clave**: el backend YA hace casi todo (servidas en vivo + gateada por aptitud, `0105`); delta **frontend puro, SIN migración → Gate 1 N/A**. Cubre #6 (prompt aptitud en alta → evento `tacto_vaquillona`), #1b (inseminación = hembra+apta, fix de `appliesToAnimal`), #5 (badge **único** de estado reproductivo, desglosado en ficha). Guard server-side de macho → backlog.

**spec_author DONE** → `{requirements,design,tasks}-aptitud-reproductiva.md` (RAR.1–RAR.8). Espejo puro `repro-status.ts` (reusa `deriveCurrentState`), fix `appliesToAnimal`, badge `ReproStatusChip` (3 tiers), prompt de aptitud en `crear-animal.tsx`. **Gate 1 N/A** (frontend puro). Veto del leader PASS.

**Puerta 1 APROBADA por Raf** (2026-06-29) con 1 cambio: inseminación **SÍ aplica el fallback de edad** (vaquillona ≥365d sin veredicto = inseminable, alineada a `0105`). Spec reconciliada (RAR.6.1/6.2/6.5 + design §2/§6/§10 + Historial). Las otras 3 decisiones (colores 3-tier · "No apta" neutro · "Sin evaluar") avaladas.

**Estados**: spec 08 → `blocked` (2 gates externos: deploy YAML PowerSync [Raf] + upload SIGSA [Facundo]); spec 02 → `in_progress` (delta aptitud). Un solo in_progress (validado).

**Implementer DONE** (`progress/impl_02-aptitud-reproductiva.md`): `repro-status.ts` (+test) + fix `appliesToAnimal` (+test) + `local-reads` builders (+test) + `animals.ts`/`events.ts`/`AnimalRow.tsx`/`animales.tsx`/`[id].tsx`/`crear-animal.tsx`/`carga.tsx` + e2e. **417/417 unit + typecheck + anti-hardcode verdes, NO tocó DB** (Gate 1 N/A confirmado). Constante única `PROVEN_FEMALE_CATEGORY_CODES` + `SERVICE_AGE_THRESHOLD_DAYS=365` (cita 0105). Divergencia badge/inseminación respetada (vaquillona sin veredicto ≥365d → badge "Sin evaluar" pero inseminable). `aptitude`/`ageDays` opcionales (no rompe call-sites legacy).

**Veto de diseño del leader: PASS** — chip 3 tiers por token, sin doble-amarillo con CUT, lineHeight matcheado. Tradeoff de layout notado (rodeo trunca primero ante "Multípara"+"Servida sin tacto" en pantalla angosta; prioridad correcta) → a confirmar por Raf en la app.

**Gate 2 PASS** 0 HIGH/0 MEDIUM + **reviewer APPROVED** + **Puerta 2 APROBADA por Raf** (2026-06-29). **DELTA APTITUD CERRADO.** Reconciliado el baseline (ADR-028: índice "Deltas posteriores" introducido en `design.md` de spec 02 + backfill de previos + nota as-built; T15 [x]). Spec 02 → `deferred`. Commits: `0d447cd` (spec) + `b7c2554` (código). **`check.mjs` completo VERDE end-to-end (exit 0)** — validado a fondo. Layout del badge: pendiente que Raf lo confirme en la app (tradeoff de truncado del rodeo, no bloqueante).

**ESTADO DE LAS 16 CORRECCIONES**: Fase 1 done (#9/#11/#12) · Aptitud done (#5/#6/#1b).

**MODO AUTÓNOMO** (Raf 2026-06-29: "hacé todo lo que puedas, no necesites nada de mí"): avanzo todo lo que no requiera decisión suya ni de Facundo ni deploy a la DB compartida; apilo las Puertas 2 para su vuelta. Puerta 0/1 de chunks frontend-puros con decisiones menores → defaults del leader (auto-aprobados, confirmables en Puerta 2). NO toco la DB compartida (deploy gated por Raf, memoria project_supabase_mcp_write) ni salto Puerta 2.

**EN CURSO**: delta **alta-form-refinamiento** (#3 fecha dd/mm + #13 condición stepper + #14 destildar) — frontend puro, Gate 1 N/A, Gate 0 auto-aprobado. spec_author (`ad0ad434dd9add2f5`) en background → seguirá implementer → gates → **stack para Puerta 2**.

**EN CURSO 2**: delta **alta-form** (#3/#13/#14). El implementer (`a1cb86e9c5152cae3`) **CRASHEÓ** (el proceso anterior salió mid-run) pero dejó el trabajo COMPLETO en disco; el leader lo **recuperó y verificó**: typecheck VERDE + 35/35 unit + anti-hardcode 0 + extracción `ConditionScoreStepper` behavior-preserving (testIDs `score-*`/`confirm-step` intactos → maniobra sin regresión) + revertidos 4 .png espurios de design/. Veto de diseño del leader PASS. **Gate 2 PASS 0 HIGH/0 MEDIUM + reviewer APPROVED** (3 obs menores no-bloqueantes, reconciliadas). **DELTA ALTA-FORM GATEADO + COMMITEADO** (modo autónomo) → ⏸ **Puerta 2 post-hoc de Raf** (la única acción humana pendiente). Baseline reconciliado (índice de deltas + snippet `dimmed?`). Spec 02 → deferred. Recuperación del crash documentada en `impl_02-alta-form-refinamiento.md`.

**AUTÓNOMO-COMPLETABLE (cola, secuencial — comparten files con el alta, no paralelizar)**: **#6-ficha caravana manual** = CONFIRMADO frontend puro (electrónica vía RPC existente `assign_tag_to_animal` NULL→valor; visual vía UPDATE local sobre `animal_profiles` patrón CUT, editable R4.13; bastoneo DEFERIDO por hardware). · #2 nombre/apodo (toca `rodeo_data_config` — probablemente DB/gate de Raf; verificar al llegar).
**NECESITAN A RAF/FACUNDO/DEPLOY (queda para su vuelta)**: #8 parición + #10 destete (RPC → Gate 1 + deploy; #10 además gatea peso destete/Facundo) · A cluster ternero (peso destete/Facundo + register_birth RPC/deploy) · #6-bastoneo (hardware) · #16 wheels (Raf dijo "hacer después").

Commit `0d447cd` = fase de spec del delta (Gate 0 + RAR.1-8 + Puerta 1 + estados). Fase 1 (#9/#12/#11) en `2009104`+`d67ea3e`.

## PENDIENTE (próximos segmentos, por orden)
- **A** cluster ternero (#7/#4/#15/#1a) — delta-02, **gatea peso destete (Facundo)**.
- **B** reportes repro (#8 parición / #10 destete / #9 ya hecho) — delta-07.
- **C** caravana desde ficha + bastoneo (#6) — bastoneo gated por dev build Android (no probado).
- **D** flag de aptitud + gating inseminación + badge repro #5 (#1b/#5) — delta-02+03.
- **E** resto del alta (#2 nombre/apodo por toggle · #3 fecha dd/mm · #13 condición stepper · #14 destildar) — delta-02.

## Otro estado (no de esta sesión)
- **Spec 08 (SIGSA)** sigue `in_progress` esperando 2 gates EXTERNOS (no hay código pendiente): (a) deploy del YAML de sync rules por Raf en dashboard PowerSync; (b) upload de formato a SIGSA por Facundo. Ver notes de spec 08 en `feature_list.json`.
