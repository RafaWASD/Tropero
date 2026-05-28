# Plan de ejecución — RAFAQ

> Fuente única del orden de trabajo. Vive al lado de `current.md` (sesión en curso) y `history.md` (bitácora cerrada) para que sean comparables.
> Última actualización: **2026-05-28** (sesión 15 — gate de refinamiento de contexto ADR-022 + reorden del roadmap por olas para rush MVP).

## Cómo usar este archivo

- Cada item tiene **ID estable** (no renumerar), **estado**, **dependencias** y **output esperado**.
- Al cerrar una sesión, el leader actualiza el estado de los items tocados y agrega entrada al `changelog` al final.
- Si surge una decisión nueva que invalida parte del plan → anotarla en el changelog y reescribir el item afectado.
- Estados válidos: `pending` / `in_progress` / `done` / `blocked` / `deferred`.
- Si un item dice "depende de Raf" significa que no avanza sin decisión humana — el leader no lo arranca por su cuenta.
- **División de autoridad**: `feature_list.json` manda sobre el **estado SDD** de cada feature (pending/context_ready/spec_ready/in_progress/done/blocked/deferred). Este archivo manda sobre el **orden, las dependencias y el porqué**. Si la tabla "Estado global resumido" de abajo discrepa con `feature_list.json`, gana `feature_list.json` — actualizá la tabla, no al revés.

---

## Estado global resumido (al 2026-05-28)

> Snapshot de lectura rápida. La verdad del estado por feature vive en `feature_list.json` — si discrepan, gana el JSON.

| Spec | Backend | Frontend | Notas |
|---|---|---|---|
| 01-identity-multitenancy | ✅ done (41 tests verdes) | ⏸ pausado (Fases 3-8) | Esperando design system + decisión de retomar |
| 02-modelo-animal | ✅ done (Fase 1+2: migrations 0013-0042, 19 tests, reviewer APPROVED + Gate 2 PASS) | ⏸ pausado (Fase 3+) | spec **refundida 2026-05-28** (ADR-020 lote + ADR-021 plantilla de datos: catálogo global + defaults por sistema + toggle por rodeo + gating). R14 y seed de cría TENTATIVOS. Mismo patrón pause-frontend que spec 01 |
| 03-modo-maniobras | ❌ pending | ❌ pending | depende de 02, 04, 05. **Dueña del gating de maniobras** (mapeo maniobra→data_keys de ADR-021, doble capa UI+DB) — spec 02 dejó el sustrato (`rodeo_data_config`) |
| 04-bluetooth-baston | ❌ pending | ❌ pending | bloqueante para BUSCAR ANIMAL y MODO MANIOBRAS |
| 05-bluetooth-balanza | ❌ pending | ❌ pending | depende de hardware confirmado en día de campo |
| 06-import-laboratorios | ❌ pending | ❌ pending | post-MVP esencialmente |
| 07-reportes-basicos | ❌ pending | ❌ pending | post-MVP esencialmente |
| 08-export-sigsa | ❌ pending | ❌ pending | crítico antes de julio 2026 (deadline SENASA) |
| 09-buscar-animal | ❌ pending (esperando turno tras spec 02) | ⏸ pausado (Fases 2-4 esperando design system) | spec aprobada 2026-05-26, **alineada y re-aprobada 2026-05-28** (consume plantilla ADR-021 + lote ADR-020; distinción form-fields vs data_keys; selector de lote en CREATE/EDIT). Status `deferred` por regla one_feature_at_a_time |

**Design system**: en fase de exploración. Research curado de 48 screens hecho (`design/research-findings.md`, 22 Mobbin + 26 device). Dirección sin cerrar. Pendiente: decisión de dirección + Stitch + ADR + tokens canónicos.

---

## Orden de ejecución (olas) — rush MVP

> Vista de orden por encima de los bloques A–D. Los bloques de abajo tienen el detalle por item; esta sección dice **en qué orden** y **qué corre en paralelo**. Política: implementación WIP=1, spec buffer=1, refinamiento buffer=2–3 (ver ADR-022 y `docs/specs.md` § Política de pipeline). Arranque elegido: **paralelo** (no serializar detrás del design system).

**Ola 0 — ahora, en paralelo** (aprovecha el tiempo bloqueado por el design system):
- **[IMPL]** B.2 backend spec 02 — fundacional, sin design system. Lo necesitan 09 y 03.
- **[RAF]** A.1 design system + A.2 ADR-018 bottom nav — destraba TODO el frontend.
- **[REFINAR]** contexto de 03 MODO MANIOBRAS (primer uso del Gate 0, ADR-022; la feature más grande) + pre-refinar 04/05 BLE (cerrar tras día de campo).
- **[RESEARCH]** formato SIGSA (D.1/08) + agendar día de campo (multímetro, sacar loopback ESP32 — `CONTEXT/07`).

**Ola 1 — al cerrar el design system:**
- **[IMPL]** B.1 frontend spec 01 → app navegable. Después frontend spec 02.
- Pull-left: 09 Fases 0/1/5/6 (hooks/validaciones/offline) pueden arrancar sin design system.

**Ola 2 — con B.1 + día de campo hechos:**
- **[IMPL]** B.3 spec 04 (bastón BLE) — destraba puerta BLE de 09 y MODO MANIOBRAS.
- **[IMPL]** B.4 spec 09 (BUSCAR ANIMAL) — puerta manual primero; puerta BLE tras 04.

**Ola 3 — convergencia:**
- **[IMPL]** C.1 spec 05 (balanza BLE).
- **[IMPL]** C.2 spec 03 (MODO MANIOBRAS) — necesita 02+04+05+09; spec escrita JIT desde el `context.md` de Ola 0.

**Ola 4 — compliance + post-MVP:**
- **[IMPL]** D.1 spec 08 (SIGSA) — research ya hecho en Ola 0; aterrizar antes de julio 2026.
- **[IMPL]** D.2 spec 06 (labs), D.3 spec 07 (reportes).

**Dos vistas del orden:**
- **Definir/refinar:** 03 → 04 → 05 → 08 (research) → 06 → 07. *(01/02/09 ya definidas.)*
- **Implementar:** ~~02 backend~~ ✅ (sesión 15) → 01 fe → 02 fe → 04 → 09 → 05 → 03 → 08 → 06 → 07.

### Recomendaciones priorizadas — próximas sesiones (al cierre de sesión 15)

> Qué conviene hacer ahora, en orden de prioridad. **P0** = cuello de botella / destraba lo máximo. **P1** = long-lead, arrancar en paralelo YA por su latencia externa. **P2** = oportunista, llena buffer, sin bloqueante. Regla de pipeline: implementación WIP=1, ≤1 spec on-deck (hoy spec 09), refinar contexto 2-3 features adelante.

**Ola 0 — lo que queda (en paralelo):**
- **[P0] Cerrar design system (A.1) + ADR-018 bottom nav (A.2)** — Dueño: **Raf**. Es EL cuello de botella: bloquea todo el frontend (01, 02, 09 y luego 03). Hasta cerrarlo, el critical path del frontend está congelado. Output: ADR + tokens canónicos + design system.
- **[P1] Agendar día de campo + prep hardware** — Dueño: **Raf**. Comprar multímetro, sacar el loopback del ESP32 (`CONTEXT/07`). Latencia de calendario/hardware; destraba specs 04/05 (escaneo BLE Allflex + Vesta TX) y la puerta BLE de 09/03. Arrancar ya.
- **[P1] Research formato SIGSA/SIGBIOTRAZA (08)** — Dueño: **leader** (sin dependencias). Long-lead + crítico para julio 2026. Investigar el formato exacto que aceptan los sistemas SENASA → insumo para el `context.md` de 08.
- **[P1] Validar seed de cría (26 fields) con Facundo** — Dueño: **Raf + Facundo**. Hoy TENTATIVO; sustenta el modelo de datos de spec 02. De-risk-ea; ajustable por migration sin reabrir spec. Atar a reunión con Facundo (quizás el mismo día de campo).
- **[P2] Pre-refinar contexto de 04 bastón BLE (parte no-hardware)** — Dueño: **leader + Raf**. Barato, llena el buffer de refinamiento. UX/edge cases (doble lectura, no-lectura, desconexión, fallback manual) se cierran ahora; UUIDs/protocolo se finalizan tras el día de campo.

**Ola 1 — al cerrar el design system:**
- **[P0] Frontend de spec 01 (B.1, Fases 3-8)** — Dueño: **implementer**. Da la app navegable; prerequisito de todo el resto del frontend. Necesita A.1 + A.2.
- **[P1] Frontend de spec 02** — Dueño: **implementer**. Después de 01 fe.
- **[P2] Pull-left: 09 Fases 0/1/5/6** (hooks/validaciones/offline) — no necesitan design system; se pueden adelantar en paralelo a B.1.

> **No** escribir la spec larga de 03 hasta estar cerca de implementarla (depende de 04/05/09 sin construir) — su contexto ya está lockeado en `context_ready`.

---

## Bloque A — Preparación (antes de seguir construyendo)

Objetivo: cerrar las decisiones transversales que van a contaminar todo lo que se construya después si no se cierran ahora.

### A.1 — Cerrar design system canónico
- **Estado**: `in_progress` (Raf, en exploración).
- **Dueño**: Raf (con leader como soporte cuando se llegue al ADR).
- **Dependencias**: ninguna.
- **Pasos**:
  - Raf revisa `design/research-findings.md` + inspiraciones en `design/inspiration/`.
  - Raf decide dirección candidata (A híbrida con C, B con C, o pedir otra ronda).
  - Raf descarga apps argentinas/agtech/competencia faltantes (Mobbin no las tiene).
  - Raf usa Stitch con la dirección elegida para generar el flujo signup wizard de spec 01 como prueba.
  - Cuando hay convicción → leader redacta ADR-018 (o el número que toque) + actualiza `docs/design-system.md` + `design/tokens.json` canónicos.
- **Output**: ADR de design system + tokens canónicos + design system canónico.
- **Bloqueante para**: A.2, B.1 (frontend de spec 01), todo el resto del frontend.
- **Notas**: ver `progress/current.md` sesión 9 para detalle del research curado.

### A.2 — Cerrar estructura de navegación principal (bottom nav)
- **Estado**: `pending`.
- **Dueño**: leader propone, Raf aprueba.
- **Dependencias**: A.1 (al menos dirección elegida; no hace falta tokens canónicos todavía).
- **Pasos**:
  - Leader formaliza la estructura tentativa `[Inicio] [Animales] [⚡FAB Maniobra] [Reportes] [Más]` en un ADR.
  - Validar con Raf que el FAB central comunica "Modo Maniobra" como acción más crítica.
  - Validar que `Animales` cubre BUSCAR ANIMAL como tab dedicada (no submenú).
- **Output**: `docs/adr/ADR-018-estructura-navegacion-principal.md` (siguiente número libre, el 015 fue eliminado en sesión 8 y los 016/017 se ocupan en esta sesión).
- **Bloqueante para**: actualización del design.md de spec 01 (sección "Navegación raíz") + design.md de spec 09.
- **Notas**: la estructura tentativa salió del análisis de Mercado Pago bottom nav en sesión 9.

### A.3 — Escribir ADR-016 (terminología rodeo/sistema)
- **Estado**: `done` (2026-05-26).
- **Dueño**: leader.
- **Dependencias**: ninguna (decisión cerrada con el vet socio el 2026-05-26).
- **Output**: [`docs/adr/ADR-016-terminologia-rodeo-sistema.md`](../docs/adr/ADR-016-terminologia-rodeo-sistema.md) creado y agregado al índice.
- **Notas**: el número 015 quedó eliminado por la retirada del ADR de design system en sesión 8; se salta al 016 para evitar ambigüedad con referencias residuales.

### A.4 — Escribir ADR-017 (timeline append-only de eventos del animal)
- **Estado**: `done` (2026-05-26).
- **Dueño**: leader.
- **Dependencias**: ninguna (decisión cerrada en charla el 2026-05-26).
- **Output**: [`docs/adr/ADR-017-timeline-eventos-animal.md`](../docs/adr/ADR-017-timeline-eventos-animal.md) creado y agregado al índice. Schema canónico de `animal_events` definido para que spec 02 lo incorpore en A.5.

### A.5 — Refinar spec 02 antes de aprobar
- **Estado**: `done` (2026-05-26).
- **Dueño**: leader (refinamiento) → Raf (aprobación).
- **Dependencias**: A.3 ✅, A.4 ✅.
- **Output**: spec 02 refinada y aprobada con condición. Cambios principales:
  - **Modelo Híbrido de eventos**: 5 tablas tipadas conservadas + nueva `animal_events` acotada a `event_type IN ('observacion','otro')` para observaciones libres. ADR-017 matizado.
  - **R4.13 nueva**: inmutabilidad de `tag_electronic` e `idv` post-alta. `visual_id_alt` sigue editable.
  - **R10.1 extendido**: la cronología incluye séptimo origen `observacion`.
  - **R15 borrada** entera: UX de búsqueda/alta se mueve a spec 09.
  - **R14 aprobada como TENTATIVA**: sujeta a refinamiento incremental cuando se cierre el design system (A.1). Disclaimer en `requirements.md`.
  - Terminología "rodeo + sistema" (ADR-016) validada en los 3 archivos (sin residuos de "lote").
  - Sección "Motor de form dinámico por rodeo" agregada en design.md.
  - 3 migrations nuevas (0033/0034/0035) + housekeeping renumerada a 0036.
  - `node scripts/check.mjs` verde, 41 tests reales contra DB remota pasan.
- **Status post-aprobación**: spec 02 movida a `in_progress` en `feature_list.json` con `notes` documentando la pausa de frontend (mismo patrón que spec 01).

### A.6 — Crear feature 09-buscar-animal en feature_list.json
- **Estado**: `done` (2026-05-26).
- **Dueño**: leader.
- **Output**: entrada `id: 9, name: "09-buscar-animal", status: "pending", sdd: true` agregada al `feature_list.json`. `notes` documenta dependencia con specs 02 y 04 + referencia a ADR-016/017.

### A.7 — Escribir spec 09 (BUSCAR ANIMAL)
- **Estado**: `done` (2026-05-26 — esperando aprobación humana).
- **Dueño**: `spec_author` lanzado por leader → Raf aprueba.
- **Dependencias**: A.5 ✅, A.6 ✅, A.3 ✅, A.4 ✅.
- **Output**: `specs/active/09-buscar-animal/{requirements,design,tasks}.md` en `spec_ready`. 12 requirements totales:
  - 6 **definitivas**: R3 (motor find-or-create), R6 (`lastRodeoSelected`), R9 (opción C diferida), R10 (multi-tenant), R11 (offline-sync), R12 (TODO refinamiento R4.13).
  - 6 **tentativas UI** (mismo patrón que R14 de spec 02): R1 (tab Animales), R2 (listener BLE), R4 (CREATE), R5 (EDIT + timeline), R7 (opción A duplicados), R8 (opción B masiva).
- **TODOs documentados que pueden requerir sesión posterior**:
  1. ~~R12 — tensión con R4.13 de spec 02~~ ✅ **Resuelta el 2026-05-26** mediante opción A del análisis (refinamiento de R4.13 para permitir `NULL → valor` y mantener bloqueado `valor → otro valor` y `valor → NULL`). Trigger `tg_animals_block_tag_change` actualizado en `design.md` de spec 02. R4.13 reescrita con sub-cláusulas a/b/c. R12 de spec 09 marcada como RESUELTA. Fase 3 de tasks de spec 09 desbloqueada.
  2. **Dependencia spec 04** — la puerta BLE (R2) y la Fase 4 del `tasks.md` quedan bloqueadas hasta que spec 04 esté implementada. Stub declarado.
  3. **Dependencia ADR-018** — estructura de nav principal asumida como tentativa.
- **Decisiones de criterio propio del spec_author** (Raf debería validar al revisar):
  - Heurística en R1.4: input numérico/estructurado → `idv`; texto libre → `visual_id_alt`.
  - `useBusyMode()` que las pantallas activan para suspender el listener BLE durante forms abiertos.
  - Mock provider del bastón para tests sin device físico.

---

## Bloque B — Construcción del esqueleto

Objetivo: tener la app funcional con identidad + modelo de datos + bastón + BUSCAR ANIMAL trabajando end-to-end.

### B.1 — Frontend de spec 01 (Fases 3-8)
- **Estado**: `blocked` por A.1 (design system).
- **Dueño**: `implementer` → `reviewer`.
- **Dependencias**: A.1 (design system canónico), A.2 (bottom nav).
- **Pasos**:
  - Releer `specs/active/01-identity-multitenancy/{design,tasks}.md`.
  - Agregar sección al design.md "Refinamientos post-research (2026-XX-XX)" con: estructura bottom nav del ADR-017, referencia a design system canónico, patrón de CTA dual de R6.5 si cambia con design system.
  - Implementer ejecuta Fases 3-8 de `tasks.md` (T3.* AuthContext + screens auth, T4.* EstablishmentContext + screens establecimiento, T5.* invitaciones, T6.* perfil, T7.* PowerSync, T8.* QA).
  - Reviewer valida.
- **Output**: spec 01 status pasa a `done` (backend ya estaba, ahora también frontend).
- **Bloqueante para**: cualquier UI siguiente. Sin esto no hay app navegable.
- **Notas**: la sección "Notas técnicas vigentes para el implementer" de `progress/current.md` sigue válida (pnpm.cmd en PowerShell, GRANT explícito, tests Node nativo, etc.).

### B.2 — Implementación backend de spec 02
- **Estado**: `done` (2026-05-28, sesión 15). Migrations 0013-0042 aplicadas al remoto + suite `supabase/tests/animal` 19/19. Reviewer APPROVED + Gate 2 PASS (SEC-HIGH-01 `apply_auto_transition` cerrada con `0042`). spec 02 → `deferred` (backend done, frontend Fase 3+ pausado). Renumber +1 (0012 lo ocupaba spec 01).
- **Dueño**: `implementer` → `reviewer`.
- **Dependencias**: A.5 (spec aprobada), A.3 + A.4 (ADRs canónicos).
- **Pasos**:
  - Implementer ejecuta migrations **0012..0037** según `tasks.md` de spec 02: species/systems/categories config, **plantilla de datos (`field_definitions` + `system_default_fields` + `rodeo_data_config`, migration 0016, ADR-021)**, rodeos, animals/animal_profiles, eventos, triggers, helpers, **lote (`management_groups` + `animal_profiles.management_group_id`, migration 0036, ADR-020)**, RLS.
  - Tests RLS por tabla (incluye T2.16 plantilla + caso "tambo+preñez", T2.17 lote, T2.4 ortogonalidad).
  - Reviewer valida.
- **Output**: backend completo de spec 02 (schema + RLS + Edge Functions si aplican).
- **Bloqueante para**: B.3, B.4 (BUSCAR ANIMAL y BLE bastón usan estas tablas).
- **Notas**: el seed de cría de `field_definitions` (26 fields) es TENTATIVO hasta validar con Facundo; ajustable por migration sin reabrir spec. Gate 1 de seguridad ya aplicó al refinar la spec (toca RLS/schema); Gate 2 sobre las migrations cuando estén implementadas.
- **Notas**: el frontend de spec 02 se difiere — siguiendo el patrón de spec 01 donde el frontend va por separado integrado con cada feature siguiente.

### B.3 — Implementación de spec 04 (BLE bastón)
- **Estado**: `pending`.
- **Dueño**: `spec_author` → Raf aprueba → `implementer` → `reviewer`.
- **Dependencias**: B.2 (modelo de animal en DB), día de campo (escaneo nRF Connect del Allflex RS420 para identificar UUIDs).
- **Pasos**:
  - Spec 04 ya existe como pending en feature_list. Validar si necesita refinar tras el research (probablemente no — es low-level BLE).
  - Día de campo: escanear protocolo BLE del Allflex con nRF Connect (ver `CONTEXT/07-pendientes.md` sección hardware).
  - Implementer hace conexión + listener global + integración con BUSCAR ANIMAL.
- **Output**: spec 04 done.
- **Bloqueante para**: B.4 (BUSCAR ANIMAL usa el listener BLE global).

### B.4 — Implementación de spec 09 (BUSCAR ANIMAL)
- **Estado**: `pending`.
- **Dueño**: `implementer` → `reviewer`.
- **Dependencias**: A.7 ✅ (spec redactada, esperando aprobación humana), B.1 (frontend de spec 01 para tener app navegable), B.2 (modelo animal en DB), B.3 (bastón funcionando).
- **Pasos**: definidos en `specs/active/09-buscar-animal/tasks.md` en 6 fases. Fases 1+5+6 pueden ejecutarse sin design system cerrado; Fases 2+3+4 dependen del design system.
- **Output**: feature CORE operativa — bastonear desde cualquier pantalla abre flujo, crear/editar animal con form dinámico, timeline funcionando.
- **Bloqueante para**: C.2 (MODO MANIOBRAS comparte motor).

---

## Bloque C — Workflows operativos

### C.1 — Implementación de spec 05 (BLE balanza Vesta)
- **Estado**: `pending`.
- **Dueño**: `spec_author` → Raf aprueba → `implementer` → `reviewer`.
- **Dependencias**: B.2 (modelo animal), día de campo (validar Pin 3 TX del Vesta + cable Vesta↔bastón).
- **Notas**: ADR-010 ya existe con la arquitectura ESP32 bridge. Hardware está en `CONTEXT/07-pendientes.md` (multímetro, sacar loopback, día de campo).

### C.2 — Implementación de spec 03 (MODO MANIOBRAS)
- **Estado**: `pending`.
- **Dueño**: `spec_author` → Raf aprueba → `implementer` → `reviewer`.
- **Dependencias**: B.2 (modelo animal), B.3 (bastón), C.1 (balanza), B.4 (BUSCAR ANIMAL operativo — comparten motor).
- **Notas**: feature CORE. El research de Auravant (sesión 9) lo identifica como molde funcional. Tiene que refinarse spec 03 tras research probablemente.

---

## Bloque D — Soporte y salida (orden flexible, antes de julio 2026)

### D.1 — Spec 08 (export SIGSA/SIGBIOTRAZA)
- **Estado**: `pending`.
- **Crítico antes**: deadline SENASA julio 2026.
- **Pendiente investigación**: formato exacto SIGSA (ver `CONTEXT/07-pendientes.md`).

### D.2 — Spec 06 (import laboratorios CEDIVE)
- **Estado**: `pending`.
- **ADR-007** ya existe con arquitectura de parsers.

### D.3 — Spec 07 (reportes básicos)
- **Estado**: `pending`.

---

## Decisiones cerradas en charla pero todavía no formalizadas

Esto es red de seguridad. Si una sesión se corta antes de hacer los ADRs, estas decisiones siguen acá hasta que se materializan.

- ~~**Terminología**: rodeo (grupo) + sistema (tipo productivo).~~ ✅ Formalizada en `ADR-016` (2026-05-26).
- ~~**Comentarios del animal = timeline append-only**.~~ ✅ Formalizada en `ADR-017` (2026-05-26).
- ~~**Bastón BLE como listener global**~~ ✅ Formalizado en spec 09 R2 (2026-05-26).
- ~~**Selección de rodeo al bastonear**~~ ✅ Formalizado en spec 09 R6 (`lastRodeoSelected`).
- ~~**IDs únicas + dual visual+electrónica al crear**~~ ✅ Formalizado en spec 09 R4 + R4.13 de spec 02 (inmutabilidad).
- ~~**Duplicados lógicos**~~ ✅ Formalizado en spec 09 R7 (opción A) + R8 (opción B) + R9 (opción C diferida).
- **Estructura tentativa bottom nav**: `[Inicio] [Animales] [⚡FAB Maniobra central] [Reportes] [Más]`. → debe ir a ADR-018 (item A.2).
- **Vet socio = Facundo**. RAFAQ = Raf + Facundo. UNLP confirmado. → memoria persistida en `memory/product_people.md`, no requiere ADR.

---

## Changelog del plan

- **2026-05-28 (sesión 15 — gate de refinamiento de contexto + reorden del roadmap)** — Raf pidió ordenar todo el desarrollo y resolver tres dolores: (1) specs largas que salían mal por contexto sin refinar (spec 02 reescrita ×2), (2) falta de política de orden entre spec-ear e implementar, (3) falta de un orden claro de qué definir/implementar primero. Cambios:
  - **Gate 0 de refinamiento de contexto** (ADR-022): estado nuevo `context_ready` + artefacto `context.md` (corto, conducido por el leader en charla con Raf) entre `pending` y `spec_ready`. Tres puertas humanas ahora (contexto → spec → código). Tocados `feature_list.json`, `scripts/check.mjs`, `docs/specs.md`, `.claude/agents/leader.md`, `.claude/agents/spec_author.md`, `AGENTS.md`, `CLAUDE.md`. Grandfathering de 01/02/09 (SDD hacia adelante).
  - **Política de pipeline** (ADR-022 + `docs/specs.md`): implementación WIP=1, spec buffer=1, refinamiento buffer=2–3. Alternar es correcto si es dirigido por el pipeline, no por humor.
  - **Roadmap por olas (rush MVP)**: sección nueva "Orden de ejecución (olas)" arriba. Arranque en paralelo (Ola 0): B.2 backend 02 + design system (Raf) + refinar 03 + research SIGSA + agendar día de campo.
  - Reconciliado el drift de la tabla "Estado global resumido" (09 es `deferred`, no `blocked`; fecha actualizada).
  - **Ola 0 ejecutada (misma sesión 15)**: (a) **B.2 backend de spec 02 IMPLEMENTADO** — migrations 0013-0042 + suite animal 19/19 → reviewer APPROVED → Gate 2 encontró y cerró **SEC-HIGH-01** (`apply_auto_transition` expuesta como RPC → cross-tenant; fix `0042` revoke + test T2.18) → PASS → Raf aprobó → spec 02 a `deferred` (backend done, frontend pausado, patrón spec 01). `design.md` de spec 02 actualizado al as-built (soft-delete RPC + SECURITY DEFINER + renumber). (b) **Gate 0 estrenado**: contexto de 03 MODO MANIOBRAS refinado con Raf (2 rondas) y aprobado → `context_ready`; spec diferida JIT (buffer=1, 09 on-deck).
  - **Próximo**: Ola 0/1 restantes — design system (Raf), research SIGSA (08), día de campo (04/05). Implementable hoy sin design system: nada nuevo en critical path hasta destrabar frontend; pre-refinar 04 (parte no-hardware) es opción.
- **2026-05-28 (sesión 14 — refundición consolidada de spec 02: lote + plantilla de datos)** — Tras detectar que spec 02 acumulaba refinamientos apilados y un bug en el modelo de plantilla (catálogo por-sistema que no permitía reusar datos entre sistemas, ej. "tambo que tactea preñez"), Raf cerró dos decisiones en chats externos y las bajó como ADRs:
  - **ADR-020 (lote como agrupación de manejo)**: tercer eje de organización ortogonal a rodeo y categoría. Tabla `management_groups` (scope establishment, nombre libre, sin presets) + `animal_profiles.management_group_id` nullable. Asignación exclusiva, manual, sin historial MVP. Regla de display "lote si tiene, si no categoría". Sin auto-asignación. Activa la cláusula reservada de ADR-016.
  - **ADR-021 (plantilla de datos)**: catálogo GLOBAL (`field_definitions`) + defaults por sistema (`system_default_fields`) + toggle por rodeo (`rodeo_data_config`). Corrige el bug del catálogo-por-sistema. Seed de 26 fields de cría (TENTATIVO hasta validar con Facundo). Gating de maniobras doble capa (UI + DB), mapeo hardcodeado. Nombre canónico de la tabla de lote resuelto: `management_groups`.
  - **Refundición de spec 02** (los 3 archivos) consolidando ambos hilos en una sola pasada para no consolidar el bug ni tocar la spec dos veces: cuerpo reescrito orgánicamente, historial movido a Changelog, migrations renumeradas (plantilla en `0016`, lote en `0036`, check_grants `0037`), R2.B reemplazada (3 tablas), R2.C nueva (lote), R7.7 ortogonalidad. Todo el detalle ganado preservado (R4.13, modelo Híbrido, ternero al pie, transiciones, split insert+select).
  - **Spec 09 alineada y re-aprobada**: consume plantilla + lote; distinción form-fields (`animal_profiles`, hardcode cría) vs data_keys de eventos (`rodeo_data_config`); selector de lote en CREATE/EDIT; corregida la lista de tipos de evento de R5.4/AddEventSheet (usaba los tipos viejos del ADR-017 que el modelo Híbrido descartó); R6.4 fallback al primer rodeo creado (no "Rodeo principal").
  - **CONTEXT/04 actualizado**: 3 tablas de plantilla + `management_groups` + `animal_profiles.management_group_id`; sección de 3 ejes ortogonales; "Lo que NO se modela" aclarado (lote ya no prohibido, sí potreros físicos y `movements`); reconciliados `sessions.lote_label` y `sanitary_campaigns.lote_label` → `management_group_id` FK.
  - ADR-020 y ADR-021 commiteados al índice de `docs/adr/README.md`.
- **2026-05-26 (creación)** — Plan inicial. Sesión de discovery sobre BUSCAR ANIMAL con Raf + validación de terminología con el vet socio. Decisiones cerradas en charla anotadas en sección anterior.
- **2026-05-26 (avance bloque A)** — Cerrados A.3, A.4 y A.6 en la misma sesión:
  - `ADR-016-terminologia-rodeo-sistema.md` creado.
  - `ADR-017-timeline-eventos-animal.md` creado.
  - Feature `09-buscar-animal` agregada al `feature_list.json` con `status: pending`.
  - Numeración de ADRs: se salta el 015 (eliminado en sesión 8 por retirada del design system "Campo Profundo") y el slot del bottom nav se reasigna de ADR-017 a ADR-018.
  - Próxima sesión: lo que el leader puede avanzar sin Raf queda completo. El siguiente paso depende de decisiones de Raf — refinar/aprobar spec 02 (A.5) o seguir cerrando design system (A.1).
- **2026-05-26 (sesión 11 — refinamiento y aprobación de spec 02)** — Cerrado A.5:
  - `spec_author` refinó los 3 archivos de spec 02 con decisiones tomadas en la sesión: modelo Híbrido de eventos, R4.13 inmutabilidad, R10.1 séptimo origen, R15 borrada, terminología validada, motor de form dinámico agregado.
  - Raf aprobó con condición: R14 (pantalla Ficha animal) marcada como **TENTATIVA** hasta cerrar design system. Disclaimer agregado en `requirements.md`. Las requirements R1..R13 + R6.B son definitivas.
  - Spec 02 movida a `status: in_progress` en `feature_list.json` con `notes` documentando la pausa de frontend (mismo patrón que spec 01).
  - **Próximos pasos posibles**: lanzar `spec_author` para A.7 (spec 09 BUSCAR ANIMAL) — depende de A.5 ✅. O lanzar `implementer` para B.2 (backend de spec 02, Fase 1+2) — depende de A.5 ✅. Ambas pueden correr en paralelo en sesiones distintas. Raf decide el orden.
- **2026-05-26 (sesión 11 continuación — A.7 redactada)** — Cerrado A.7:
  - `spec_author` redactó los 3 archivos de spec 09 (`specs/active/09-buscar-animal/{requirements,design,tasks}.md`) siguiendo decisiones cerradas en sesiones 9-11.
  - 12 requirements (6 definitivas + 6 tentativas UI con disclaimer estilo R14 de spec 02).
  - 3 TODOs declarados que pueden requerir sesión posterior: tensión R4.13 NULL→valor, dependencia spec 04 (BLE), dependencia ADR-018 (bottom nav).
  - 3 decisiones de criterio propio del spec_author que Raf debería validar al revisar: heurística input numérico/texto, `useBusyMode()` para suspender BLE, mock provider para tests.
  - Spec 09 movida a `status: spec_ready` en `feature_list.json` con `notes` documentando TODOs.
  - **Próximo paso depende de Raf**: leer `specs/active/09-buscar-animal/` y aprobar/pedir cambios. Una vez aprobado, se desbloquea B.4 (implementación). En paralelo, B.2 (backend de spec 02) sigue libre para arrancar — no depende de aprobación de spec 09.
- **2026-05-26 (sesión 11 — aprobación spec 09)** — Raf aprobó spec 09 tras lectura del resumen ejecutivo. Status en `feature_list.json` movido de `spec_ready` a `blocked` (no `in_progress`) para respetar regla `one_feature_at_a_time`: spec 02 sigue siendo la feature actualmente "abierta" porque es prerequisito técnico (spec 09 consume primitives de spec 02). Cuando B.2 termine o se libere el slot, spec 09 pasa a `in_progress`. Historial de aprobación agregado a `specs/active/09-buscar-animal/requirements.md`. Fases ejecutables sin design system cerrado: 0, 1, 5, 6 (parcial) — pueden empezar en paralelo a B.2 si Raf lo decide.
- **2026-05-27 (sesión 12 — security analyzer + skill Sentry)** — Raf decidió incorporar análisis automático de seguridad al flujo SDD. Tras investigación de 6 alternativas (Cyber Neo, Sentry, OWASP, Phoenix, mahmutka, /security-review built-in), eligió **Patrón D** de implementación: skill `getsentry/skills@security-review` + nuevo subagente `security_analyzer` + 2 gates condicionales en el flujo SDD. Cambios aplicados:
  - `docs/adr/ADR-019-security-analyzer-skill-sentry.md` creado con análisis completo + alternativas + consecuencias.
  - `.claude/agents/security_analyzer.md` creado con 2 modos (`spec` y `code`) + checklist RAFAQ-específico.
  - `.claude/agents/leader.md` actualizado: flujo SDD con Gate 1 (condicional) y Gate 2 (siempre), criterios explícitos para invocar cada uno.
  - `AGENTS.md` y `docs/specs.md` actualizados: flujo SDD con 2 puertas de aprobación humana + gates intercalados.
  - `docs/adr/README.md` actualizado con ADR-019 + slot 018 reservado para bottom nav.
  - Plugin `sentry-skills@sentry-skills` instalado a nivel user por Raf (`claude plugin install sentry-skills@sentry-skills`).
  - **Próxima prueba real del flujo**: B.2 (backend spec 02). Gate 1 ya debería aplicar (spec 02 toca RLS, schema, Edge Functions). Gate 2 sobre las migrations + tests cuando estén implementadas.
- **2026-05-26 (sesión 11 — resolución R12 ↔ R4.13)** — Tras análisis del leader con 5 opciones evaluadas y 3 presentadas a Raf vía AskUserQuestion, Raf eligió **opción A** (refinar el trigger en 2 líneas SQL para permitir `NULL → valor`). Cambios aplicados:
  - `specs/active/02-modelo-animal/design.md`: trigger `tg_animals_block_tag_change` y `tg_animal_profiles_block_idv_change` actualizados con condición `if old IS NULL then return new`. Comentarios SQL agregados explicando la distinción semántica "completar info" vs "reescribir identidad".
  - `specs/active/02-modelo-animal/requirements.md`: R4.13 reescrita con sub-cláusulas R4.13.a/b/c (permitido / prohibido reescribir / prohibido volver a NULL). Entrada nueva al Historial de refinamiento.
  - `specs/active/09-buscar-animal/requirements.md`: R12 marcada como RESUELTA con trazabilidad histórica + R12.2 actualizada con UPDATE defensivo `WHERE tag_electronic IS NULL` + R12.4 documenta upgrade path post-MVP a opción B (Edge Function con audit granular).
  - `specs/active/09-buscar-animal/tasks.md`: Fase 3 desbloqueada (header + diagrama + tabla de trazabilidad + T3.1 reescrita como validación de precondición). Eliminada la columna "Depende de R12" de la tabla de fases.
  - `feature_list.json` spec 09 notes: eliminado el TODO de R12, mantenidos los de spec 04 + ADR-018.
  - No se crea ADR separado — es refinamiento de spec, no decisión arquitectónica transversal. La trazabilidad vive en los Historiales de spec 02 y 09 + en `progress/current.md` sesión 11.
