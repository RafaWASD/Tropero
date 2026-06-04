# Review — C3.2 (frontend reproductivo, spec 02): Tacto + Servicio + Parto + link a la Madre

**Reviewer**: reviewer (RAFAQ) | **Fecha**: 2026-06-04 | **Baseline**: 655a200
**Alcance**: frontend PURO (sin migraciones; backend reproductivo ya existe). Sub-chunks C3.2a + C3.2b + cierre (B1 + desempate created_at + fetchMother + carrera rodeo-default).

## Veredicto

**APPROVED**

Trazabilidad completa, tasks del run cerradas, check.mjs verde (counts exactos), E2E 28/28 + parto 5/5 estable. B1 y /sec/5 alineados con la decisión de Facundo.

## Trazabilidad R<n> <-> test

- **R6.2** (tacto/servicio/parto) -> addTacto/addService/registerBirth (events.ts); unit applyReproMeta/humanize* (event-timeline.test.ts); E2E repro (events.spec:152) + parto (229).
- **R9** (parto crea N terneros) -> validateCalves (event-input.test.ts); E2E Ternero 1+2 -> Parto en timeline.
- **R9.4** (tag dup -> rollback atómico) -> classifyError 23505 -> duplicate_tag; rollback en backend T2.19 (register_birth ternero inválido -> rollback total, verde).
- **R9.5** (mellizos 1..N) -> validateCalves caso mellizos; E2E 2do ternero.
- **R10 / R10.1** (cronología desc + estado vigente) -> parseTimeline + deriveCurrentState (preñez + desempate created_at); E2E timeline.
- **R14.3** (componente por evento) -> TimelineEvent.present() rama reproductive; E2E asserta Tacto/Servicio/Monta natural/Parto.
- **R14.7 / R4.15** (link a la madre, tolera status != active) -> fetchMother vía birth_calves (NO filtra status); archivedLabel; E2E abre ternero -> card Madre -> navega a la ficha de la madre.

Preñez en "Estado actual": deriveCurrentState/humanizePregnancyState (9 casos unit: service/weaning NO determinan; birth/abortion -> vacía; tacto null -> ausente) + E2E "Preñada (cuerpo)" y "Vacía".

**Todo R<n> aplicable tiene >=1 test concreto.** Sin huecos.

## Tasks completas: sí

Las bitácoras (impl_02-frontend-c3.2a / c3.2b) listan T0..T5 / T0..T3 + cierre, todas ejecutadas y verdes. No quedan [ ] sin justificar. Chunk = incremento de frontend sobre backend done; no abre tasks de migración (correcto: frontend puro).

## CHECKPOINTS

- **C1** [x] check.mjs exit 0.
- **C2** [x] estado coherente.
- **C3** [x] solo capas previstas (services/utils/screens/components); [x] sin deps nuevas; [x] sin logs de debug ni TODOs reales (los "TODO" detectados son la palabra española "TODOS/TODO el parto" en comentarios); [x] no se hardcodea establishment_id.
- **C4** [x] >=1 test por módulo con lógica; [x] fixtures reales (E2E remoto + backend runners); [x] runner >0 verde; [x] cross-tenant (T2.19 caso 2).
- **C6** [x] EARS; [x] cada R con >=1 test.
- **C7** [x] RLS-on; [x] helpers has_role_in/establishment_of_profile server-side; [x] cross-tenant verde (T2.19 caso 2 + 1).
- **C8** ver "B. N/A" abajo.

No quedan boxes vacíos en checkpoints aplicables.

## Checklist RAFAQ-específico

### A. Multi-tenancy / RLS (toca tablas con establishment_id transitivo)
- [x] RLS on - N/A crear tablas (sin migraciones); las existentes ya tienen RLS-on (Animal 28/28 + T2.19).
- [x] Policies - N/A escribir (no hay migraciones); el cliente usa las existentes.
- [x] Helpers has_role_in/is_owner_of - server-side (no duplicado inline client-side).
- [x] Test cross-tenant - T2.19 caso 2 (register_birth A->B -> 42501) + caso 1 (autor-sin-rol).
- [x] deleted_at IS NULL en SELECT - birth_calves_select filtra parto soft-deleted (T2.19 caso 4).

Multi-tenant confirmado: NO se cruza tenant client-side. addTacto/addService mandan solo animal_profile_id; registerBirth solo p_mother_profile_id + fecha + terneros; fetchMother filtra por calf_profile_id y deja el tenant a la RLS.

### B. Offline-first - N/A (con nota)
PowerSync es C5 (diferido). Este chunk no introduce sync ni resolución de conflictos; usa el patrón online de C3.1 (insert -> re-fetch on focus). No degrada la postura offline futura. Last-write-wins ya fijado en spec 02 R13.4.

### C. BLE - N/A.

### D. UI de campo
- [x] Botones >=60dp - $touchMin / Button fullWidth en CTAs y OptionSelector/TypeCards.
- [x] Fuente legible - labels/valores $5/$6, sin px crudos de fuente.
- [x] Una decisión por pantalla - wizard 2 pasos.
- [x] Loading visible - "Guardando..." (submitting) + busyRef; "Cargando ficha...".

### E. Edge Functions - N/A (register_birth es RPC SQL, no Edge).

## Verificaciones puntuales del brief

- **Inserts SIN .select()** - addTacto/addService sin returning; registerBirth RPC escalar uuid -> OK.
- **Validación de inputs (manga)** - peso ternero opcional (>0 / <=4 cifras); caravana opcional; sexo requerido por ternero; >=1 ternero; pregnancy/service por selector CERRADO; fecha no futura.
- **a11y** - OptionSelector/NotesField/MotherCard/CalfBlock/AddCalf usan buttonA11y/labelA11y (ramas por plataforma); cero accessibilityLabel crudo.
- **Anti-hardcode** - lint ADR-023 sec4: 0 violaciones en app/app/** + app/src/components/**.
- **deriveCurrentState (desempate created_at)** - PURO (sin Date.now() interno); birth/abortion del mismo día ganan al tacto por created_at; fallback a eventId. 5 tests deterministas (invierten orden + fuerzan eventId del tacto MAYOR).
- **fetchMother / R14.7** - embed disambiguado (animal_profiles!animal_profile_id!inner, las 3 FKs eran ambiguas -> bug real cazado); tolera madre archivada (no filtra status); card no se muestra si no es ternero con parto (null).
- **B1 (etiquetas de tacto)** - dominio-categorias-facundo sec4 (L117-119): SOLO término de campo Vacía/Cola/Cuerpo/Cabeza, mapeo small=cola/medium=cuerpo/large=cabeza. Coincide exacto con PREGNANCY_OPTIONS/_LABELS y los tests (guard doesNotMatch /chica|media|grande/).
- **sec5 (servicio sin toro / pajuela diferida)** - addService NO manda bull_id/semen_id (monta natural no anota el toro, L125); la pajuela de IA/TE se sostiene en las notas opcionales del servicio (L126-127).

## Verificación de suites

- `node scripts/check.mjs` **VERDE** completo: anti-hardcode *0*; client unit *293/293*; RLS *17/17*; Edge *36/36*; Animal *28/28* (incl. T2.19 no-bypass Tier 1); Maniobras *13/13*. Counts idénticos al reporte del implementer.
- `pnpm e2e`: **28 passed / 0 failed** (incl. los 4 de events.spec: timeline, validación, repro tacto->servicio, parto con mellizos+madre).
- `npx playwright test events.spec.ts -g "parto con mellizos" --repeat-each=5`: **5/5** estable, sin warnings de FK en el cleanup (fix de admin.ts borra reproductive_events antes de los establishments).

## Cambios requeridos

Ninguno. Aprobado sin observaciones bloqueantes.

### Nota menor (no bloqueante, backlog - NO requiere acción ahora)
El comentario de `applyReproMeta` (event-timeline.ts L66 / L327-333) y el del campo `serviceType` (L107-110) mencionan "applyServiceTypes" en un par de líneas de prosa (nombre del wrapper deprecado que el cierre eliminó y reemplazó por applyReproMeta). La función real y los tests ya usan applyReproMeta; es solo prosa stale en comentarios (no afecta comportamiento, types ni cobertura). Anotado para limpieza oportunista en el próximo toque - no justifica un fix-loop.
