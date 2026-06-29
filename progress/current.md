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

**Fase 1 CODE-COMPLETE + GATEADA** (2026-06-29): 2 ajustes del veto aplicados (riel↔lista consistentes en años, `formatAgeMonthsAR` removida limpia, `lineHeight="$3"`). **reviewer APPROVED** + **Gate 2 PASS 0 HIGH** (`progress/security_code_correcciones-fase1.md`). 116/116 unit + typecheck + anti-hardcode verdes; e2e reconciliado estáticamente (no corrido en vivo por riesgo de flake 2-terminales). **PENDIENTE: Puerta 2 (Raf)** + decidir si correr e2e/check completo y commitear.

## PENDIENTE (próximos segmentos, por orden)
- **A** cluster ternero (#7/#4/#15/#1a) — delta-02, **gatea peso destete (Facundo)**.
- **B** reportes repro (#8 parición / #10 destete / #9 ya hecho) — delta-07.
- **C** caravana desde ficha + bastoneo (#6) — bastoneo gated por dev build Android (no probado).
- **D** flag de aptitud + gating inseminación + badge repro #5 (#1b/#5) — delta-02+03.
- **E** resto del alta (#2 nombre/apodo por toggle · #3 fecha dd/mm · #13 condición stepper · #14 destildar) — delta-02.

## Otro estado (no de esta sesión)
- **Spec 08 (SIGSA)** sigue `in_progress` esperando 2 gates EXTERNOS (no hay código pendiente): (a) deploy del YAML de sync rules por Raf en dashboard PowerSync; (b) upload de formato a SIGSA por Facundo. Ver notes de spec 08 en `feature_list.json`.
