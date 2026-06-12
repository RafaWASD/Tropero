# Review — spec 10 chunk UI-A (Fase 4 parcial: T-UI.1/2/3 + 2 iter polish)

Reviewer: reviewer (Opus 4.8 1M). Fecha: 2026-06-12.
Baseline del diff: 7840b43 (HEAD; working tree sin commitear).
Reportes: progress/impl_10-ui-a-nav-grupo.md + progress/impl_10-ui-a-iter2.md.
Design-review visual: hecho por el leader (paso; design/spec10-ui-a/).

## Veredicto

CHANGES_REQUESTED

Un unico cambio requerido, documental (reconciliacion codigo->spec). El codigo es correcto, los tests
verdes, check.mjs exit 0; lo que falla es la regla dura: design.md y tasks.md afirman que el nombre del
SISTEMA en la card de rodeo esta DIFERIDO, pero el codigo lo implementa y lo muestra. La spec quedo
mintiendo respecto del as-built. Reconciliacion pendiente = CHANGES_REQUESTED.

---

## Trazabilidad R <-> test (chunk UI-A)

| R | Cubre | Test / verificacion |
|---|---|---|
| R1.1 vista de grupo (meta+config+lista+acciones) | T-UI.1 | rodeo/[id].tsx + lote/[id].tsx + GroupViewScreen.tsx; lista via fetchAnimals(status active)/fetchGroupMembers |
| R1.2 reusa AnimalRow + services as-built | T-UI.1 | GroupAnimalsList rinde AnimalRow compact; AnimalRow.tsx extendido additivo |
| R1.4 3 acciones verbos pelados | T-UI.1 | group-actions.test.ts (resolveGroupActions); GroupActionsBar.tsx lineas 39-45 |
| R1.5 vacunar/destetar gated; castrar siempre | T-UI.1 | group-actions.test.ts:21 castrar SIEMPRE true; :26 solo vacunacion |
| R1.6 data_key disabled -> no se ofrece | T-UI.1 | group-actions.test.ts:72 sin field fail-closed; :81 field sin fila |
| R7.1 lote cross-rodeo algun rodeo | T-UI.1 | group-actions.test.ts:34/43; fetchLoteGroupActions |
| R2.1 cards rodeo + lote en Inicio | T-UI.2 | index.tsx Mis rodeos/Lotes; local-reads.test.ts:437/448/481/491 head counts (estructura+comportamiento SQLite) |
| R2.2 tap card -> vista de grupo | T-UI.2 | GroupSummaryCard.onPress -> router.push rodeo/lote |
| R2.3 tab Animales intacta | T-UI.2 | git diff vs 7840b43: animales.tsx SIN cambios |
| R11.9 AnimalRow compacto >=56px + checkbox + categoria-edad | T-UI.3 | animal-age.test.ts (11); minHeight touchMin=56; RowCheckbox; local-reads.test.ts:398/400 future_bull+birth_date |
| R12.3 badge solo positivo, oculto en toro | T-UI.3 | shouldShowFutureBullBadge exportado+testeable (false si no-positivo o toro); E2E es T-UI.9 proximo chunk |

Polish (no son R de spec 10): stepper hide-when-complete (onboarding.test.ts 6 tests, incl. hasAnimals null -> false anti-parpadeo); iconos unificados (grep: cero Layers-rodeo / cero Boxes-lote).

Trazabilidad: COMPLETA. Cada R del chunk con >=1 test concreto. Ningun R sin cobertura.

---

## Tasks completas: parcial (esperado, feature multi-chunk)

- T-UI.1 [x], T-UI.2 [x], T-UI.3 [x] — alcance de ESTE chunk, los 3 verificados.
- T-UI.4..T-UI.11 [ ] — proximos chunks (seleccion explicita, bottom-sheet, vacunacion, ficha, E2E).
  Justificado: chunk declarado Fase 4 PARCIAL; seleccion-masiva/vacunacion-masiva son stubs navegables.
- T-G1.2 [ ] — re-chequeo Gate 1 LIM-2; lo lanza el leader.
- Fases 1/2/3 [x] — ya gateadas en commits previos (64d0d52, 46dc3cb).

Los [ ] tienen justificacion documentada (chunking) -> NO bloquea.

---

## CHECKPOINTS

- C2 [x] — estado coherente; una feature en vuelo (10).
- C3 arquitectura [x] — solo capas previstas. components/ presentacionales sin fetch; hooks/useGroupView
  orquesta services; services/group-data unica capa con I/O (SQLite local); utils/ puros. Cero
  establishment_id hardcodeado. Sin TODOs sueltos, sin logs de debug.
- C4 verificacion [x] — un test por modulo con logica (group-actions 10, animal-age 11, onboarding 6,
  head-counts 4 incl. comportamiento). Runner >0 tests, todos verdes. Sin mocks de I/O critico.
- C6 SDD [x] — 3 archivos de spec; EARS estricto; cada R del chunk con >=1 test.
- C8 offline-first [x] — todas las lecturas (lista, gating, conteos, nombre de sistema) salen del SQLite
  local. Cero fetch directo a Supabase desde pantalla/componente.
- C1/C5/C7 — N/A o sin delta (frontend puro, sin migraciones; backend ya gateado). Las head-count queries
  scopean establishment_id = ? (param) + status active + deleted_at IS NULL.

---

## Checklist RAFAQ-especifico

### A. Multi-tenancy / RLS — N/A (frontend puro, sin tablas/policies nuevas; backend Fase 1 ya gateado).
Igual verificado: lecturas client-side scopean por establishment_id (param del contexto), nunca hardcodeado.

### B. Offline-first
- [x] Funciona offline: lecturas via SQLite local; ninguna pantalla hace request sincrono a Supabase.
- [x] Gating lee config scopeada al campo/rodeo activo (no cross-tenant).
- [N/A] Conflict resolution / sync bucket: este chunk no escribe (nav + lectura).

### C. BLE — N/A (no toca BLE).

### D. UI de campo
- [x] Targets: GroupActionsBar/GroupSummaryCard/AnimalRow compact en touchMin. Nota: fila compacta 56px
  (touchMin, valor lockeado por Gate 0 v2 D11 / R11.9), levemente debajo del 60dp generico pero conforme a la spec.
- [x] Fuente: hero del animal 18px; labels de accion grandes; metadata muted secundaria (consistente con spec 09).
- [x] Una decision por pantalla: acciones apiladas a ancho completo; cards tap-unico.
- [x] Loading visible: useGroupView expone loading.

### E. Edge Functions — N/A (no toca Edge Functions).

---

## Foco (lo cuestionado) — resolucion

1. Gating del GroupActionsBar — OK. La PANTALLA resuelve el gating (group-data.ts -> util puro
   group-actions.ts); el componente es presentacional (recibe availability). Castrar SIEMPRE (linea 45);
   Vacunar/Destetar condicionados (39-44). Lote = algun rodeo. Fail-closed. Testeado.
2. AnimalRow compacta — OK. Badge solo si future_bull true Y categoria distinta de toro. Edad desde
   animal_birth_date (edge cases null/malformado/futuro -> null). El path no-compact produce el mismo
   a11yLabel y accessibilityRole button que el baseline 7840b43 (verificado char-a-char via git show).
   Cambio 100% additivo (props opcionales).
3. Stepper hide-when-complete — OK. allOnboardingStepsDone exige hasAnimals === true; null (cargando) ->
   false (NO oculta) -> test dedicado :17. Con 2 de 3 -> false (visible) -> :27/:34/:41. Render en index:698.
4. Iconos unificados — OK. Grep en app/: Boxes solo rodeo (index:664, mas:840, rodeo/[id]:80, rodeos:230),
   Layers solo lote (index:686, mas:851, animal/[id]:926/964, lote/[id]:88, lotes:385). Import de
   animal/[id].tsx saca Boxes (no dangling, typecheck verde).
5. Registro de rutas en _layout — OK. 4 rutas en el Stack (411-416) + GROUP_DESTINATIONS (138-143). NO
   abren bypass del gate de auth: se chequean en la rama est active y solo evitan el de-strand (350-354);
   un usuario sin sesion cae en el gate de auth (257-259) ANTES.
6. Tab Animales intacta — OK. animales.tsx SIN cambios (git diff vacio). El switch de establecimiento se conserva.
7. Offline-first — OK. Cero fetch directo a Supabase desde pantalla/componente. group-data.ts solo usa
   runLocalQuery/fetchFieldCatalog/fetchRodeoConfig (SQLite local).
8. Tokens / no-hardcode — OK. Lint ADR-023 p4: 0 violaciones en app/app + app/src/components.

---

## Cambios requeridos

### CR-1 (regla dura codigo->spec) — el nombre del SISTEMA no esta diferido, esta implementado

index.tsx SI resuelve y muestra el sistema productivo en la card de rodeo:
- index.tsx:51 importa fetchProductionSystems; index.tsx:422 state systemNames; index.tsx:441 lo carga en
  loadGroups; index.tsx:669 pasa meta=systemNames.get(r.systemId) -> GroupSummaryCard renderiza el sistema
  (ej. Cria) seguido de las cabezas (GroupSummaryCard.tsx:37 arma el subtitle con meta cuando existe).
- Verificado en el diff vs 7840b43: todas lineas + (parte de este chunk). fetchProductionSystems devuelve
  systemId+name desde SQLite local (offline-safe) y Rodeo.systemId existe -> codigo vivo, no muerto.

Pero las specs afirman DIFERIDO:
- design.md:39 — el nombre del sistema + la senal de atencion (R2.1) se DIFIEREN... el head count es la
  metrica concreta disponible hoy.
- tasks.md:52 (T-UI.2 AS-BUILT) — El sistema del rodeo + la senal de atencion (R2.1) se difieren...
- progress/impl_10-ui-a-nav-grupo.md:124 — declara el sistema como diferido.

Reconciliacion pedida (la hace el implementer; el reviewer no edita): separar las dos cosas en el AS-BUILT
de design.md:39 y tasks.md:52 — el nombre del sistema SI esta implementado (R2.1, via fetchProductionSystems
+ GroupSummaryCard.meta); solo la senal de atencion (analytics, feature 07) sigue diferida.

Severidad: BAJA en lo funcional (el codigo hace MAS de lo documentado, no menos — no hay bug). La regla dura
es incondicional: specs viejas tras el trabajo = CHANGES_REQUESTED. Fix de ~2 lineas de doc; una vez
reconciliado, el chunk queda aprobable sin mas cambios de codigo.

---

## Verificacion ejecutada

- node scripts/check.mjs -> exit 0. Typecheck verde; anti-hardcode 0 violaciones; client unit (incl.
  animal-age 11 + group-actions 10 + onboarding 6 + head-counts 4); live Supabase verde (operaciones-rodeo
  22/22, sync streams 25/25, RLS/edge).
- Test files del chunk en aislamiento: animal-age + group-actions + onboarding + local-reads -> 115/115 pass.
- git diff 7840b43: AnimalRow non-compact byte-identico al baseline; animales.tsx intacto; tsconfig excluye
  playwright.capture.config.ts (tooling aislado).

## Notas (no bloqueantes)

- Tooling de captura: DEV TOOLING aislado del typecheck (exclude) y de la regresion. No rompe nada.
- Stubs seleccion-masiva/vacunacion-masiva: placeholders navegables declarados — OK para el chunk.
- Fila compacta a 56px (touchMin): debajo del 60dp generico pero lockeada por Gate 0 v2 D11/R11.9 — conforme.
