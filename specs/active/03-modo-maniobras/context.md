# Spec 03 — MODO MANIOBRAS — Refinamiento de contexto (Gate 0)

**Status**: Pendiente de aprobación de Raf.
**Fecha**: 2026-05-28 (sesión 15)
**Conducido por**: leader + Raf (2 rondas de AskUserQuestion).
**Related**: spec 02 (sustrato), spec 09 (find-or-create), spec 04/05 (BLE), ADR-021 (gating), ADR-020 (lote), ADR-016 (rodeo/sistema), ADR-017 (timeline), ADR-008 (transiciones), CONTEXT/03, CONTEXT/07.

> Contrato humano del Gate 0 (ADR-022): contexto validado + edge cases resueltos. El `spec_author` lo lee como fuente de verdad y lo traduce a requirements/design/tasks — no re-decide nada de acá. Cada "Caso y decisión" debe quedar cubierto por ≥1 `R<n>`.

## Contexto validado

MODO MANIOBRAS es el modo guiado de jornada de manga — el corazón operativo (se carga el 90% del día).
- **Por jornada**: elegís maniobras (o un preset) + pre-config de algunas.
- **Por animal**: identificás (bastón BLE o IDV manual, vía el motor de spec 09) → wizard pantalla-por-maniobra (botones 60-80px, una decisión por pantalla, alto contraste, vibración táctil) → pantalla resumen → confirmás → siguiente animal (o corregís tocando una maniobra del resumen).
- **Los datos se guardan a medida que avanza el wizard** (resiliencia ante crash/batería); el resumen es de verificación, no de commit.
- Escribe en las tablas de evento de spec 02 (`weight_events`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples`), en la propiedad `dientes`/CUT de `animal_profiles`, y en `animal_events` (observación).
- **Es dueña del gating de maniobras** (ADR-021): solo ofrece las maniobras cuyos `data_keys` están `enabled` en `rodeo_data_config`; doble capa (UI + check DB que esta spec implementa).

## Alcance

**Dentro**: las 10 maniobras (mapeo ADR-021), presets, wizard + resumen, gating doble capa (UI + DB), entidad `sessions`, carga offline + sync (PowerSync), integración con spec 09 (alta en manga) y con BLE (manual-first).

**Fuera (post-MVP)**: stock de pajuelas/vacunas/medicamentos, tratamientos como módulo dedicado, otros sistemas productivos (solo cría en MVP), validaciones cruzadas tacto/parto (→ spec 07), peso al pie vs peso al destete tipados (→ post-MVP con Facundo).

**Depende de**: spec 02 (sustrato + eventos + `rodeo_data_config` + `management_group_id` + triggers de transición), spec 09 (motor find-or-create + `useBusyMode` que suspende el listener BLE global), spec 04 (bastón) y spec 05 (balanza) — ambas con fallback manual.

## Casos y decisiones

### Sesión
- **`sessions` es entidad persistida** (tabla nueva): `(id, establishment_id, rodeo_id, created_by/operador, fecha, maniobras elegidas + pre-config, status, created_at...)`. Cada evento cargado lleva `session_id`. Habilita resumen de sesión (spec 07), reanudación tras crash, y auditoría de quién cargó qué jornada.
- **Una sesión = un rodeo.** Se elige al iniciar; el gating sale de ese rodeo.
- **Animal de otro rodeo escaneado en la sesión**: la app avisa y ofrece **[pasar el animal a este rodeo]** (UPDATE de `animal_profiles.rodeo_id`, validado por el trigger de spec 02) o **[saltarlo]**. No se carga con gating de otro rodeo.
- **Reanudación**: como los datos se guardan progresivamente y la sesión persiste, una sesión interrumpida se retoma.

### Alta en manga (integración spec 09)
- **TAG/IDV desconocido durante la sesión** → dispara el find-or-create de spec 09 inline: alta rápida (ID precargado no editable + rodeo de la sesión + form dinámico por sistema) y al confirmar sigue el wizard de maniobras para ese animal. La manga es donde aparecen animales nuevos sin cargar.
- MODO MANIOBRAS suspende el listener BLE global (`useBusyMode` de spec 09): el escaneo dentro del modo lo maneja el propio modo.

### Las 10 maniobras
- **Gating UI**: cada maniobra se ofrece solo si su(s) `data_key(s)` requeridos (mapeo hardcodeado ADR-021) están `enabled` en el rodeo de la sesión.
- **Gating DB**: trigger `BEFORE INSERT` en cada tabla de evento gateada valida el `rodeo_data_config` del rodeo **del animal**; rechaza si el data_key requerido no está `enabled` (defensa en profundidad sobre la UI).
- **Sangrado**: input nº tubo → `lab_sample` (brucelosis); resultado llega luego vía import (spec 06). Requiere `brucelosis`.
- **Tacto vaca**: PREÑADA/VACÍA (+ CABEZA/CUERPO/COLA) → `reproductive_event` (event_type tacto, pregnancy_status). Dispara transición de categoría (spec 02). Requiere `prenez` Y `tamano_prenez`.
- **Tacto vaquillona**: APTA/NO APTA/DIFERIDA → `reproductive_event` con `event_type='tacto_vaquillona'` + resultado enum (apta/no_apta/diferida). Si el enum repro de spec 02 no lo incluye, spec 03 lo extiende por migration. Requiere `tacto_vaquillona`.
- **Vacunación**: silenciosa (✓ inline), multi-vacuna simultánea. Pre-config = vacuna(s) por **texto libre + autocompletar** de usadas antes (sin stock). → `sanitary_event(s)`. Requiere `vacunacion`.
- **Inseminación**: 1 pajuela → popup informativo; >1 → selector. Pajuela por **texto libre + autocompletar** (sin stock). → `reproductive_event`. Requiere `inseminacion`.
- **Condición corporal**: selector 1.00-5.00 step 0.25 → `condition_score_event`. Requiere `condicion_corporal`.
- **Dientes**: **propiedad** (sobrescribe `teeth_state` de `animal_profiles`, reusa sustrato de spec 02; no es evento con historial). **Prompt CUT** (si 1/2, 1/4, sin dientes) vive ACÁ en la maniobra — la Fase 4 de spec 02 que lo modelaba estaba pausada, y la manga es donde realmente se cargan los dientes. No para terneros. Requiere `dientes`.
- **Pesaje**: manual o balanza BLE (spec 05; el animal ya está identificado → el peso se adjunta al animal actual, sin la ventana de correlación de spec 05). → `weight_event`. Requiere `peso`.
- **Raspado de toros**: 2 nº tubo (tricomoniasis + campylobacteriosis) → 2 `lab_samples`. **Solo para machos**: si se escanea una hembra en una sesión con raspado, la maniobra se saltea para ella (el resto de las maniobras sí corren). Requiere `raspado_toros`.
- **Pesaje de ternero**: igual que pesaje adulto; **solo autocompleta la categoría ternero/ternera**. El vínculo con la madre ya viene del `reproductive_events.calf_id` del nacimiento. (Peso al pie vs destete tipados → post-MVP con Facundo, ver Pendientes.) Requiere `peso`.

### Presets
- Entidad de presets: combinación de maniobras + pre-config, guardada con nombre; aparecen al tope al iniciar MODO MANIOBRAS.
- Un preset con una maniobra gateada OFF en el rodeo actual: esa maniobra se filtra (no se ofrece) y se avisa.
- Scope del preset (por usuario / por establishment): detalle menor; default sugerido **por establishment** (lo confirma spec_author).

### Lote
- **NO se auto-asigna desde la sesión.** Razón (Raf): una misma jornada puede tocar 2 lotes → auto-asignar pisaría el `management_group_id`.
- La asignación de lote es **per-animal, manual** (`management_group_id` de spec 02), disponible opcionalmente en el wizard o desde la ficha.
- La sesión puede registrar un lote "de trabajo" como metadata informativa no-autoritativa, o se omite (detalle menor para spec_author). Esto resuelve la reconciliación pendiente `sessions.lote_label → management_group_id`: el lote NO vive como FK asignadora en la sesión.

### Roles
- Todas las maniobras: cualquier rol (CONTEXT/03). Sin gating por rol dentro de las maniobras.

### Offline-first
- Toda maniobra funciona con carga manual sin red; sesión + eventos se encolan y sincronizan después (PowerSync). `rodeo_data_config` cacheado para el gating offline. Preview de transición de categoría offline (`transitions.ts` de spec 02).

### Postura BLE
- **Manual-first**: toda maniobra anda con carga manual; bastón (spec 04) y balanza (spec 05) son enhancement con puntos de integración limpios. La spec no se bloquea por hardware y la manga funciona aunque falle el BLE.

### Migrations
- spec 03 suma `sessions`, presets, los triggers del gating DB y (si hace falta) la extensión del enum repro para `tacto_vaquillona` — en migrations `0038+`, sin pisar spec 02.

## Pendientes (CONTEXT/07)
- **Pesaje de ternero**: MVP = igual que adulto + autocompleta categoría. **Modelar peso al pie vs peso al destete como pesajes tipados distintos queda para una versión post-MVP, a refinar con Facundo** (anotado en `docs/backlog.md`).
- **Validaciones cruzadas tacto/parto**: diferidas a reportes (spec 07). spec 03 solo registra los datos (tacto + parto); la comparación tamaño-preñez-predicho vs fecha-real es analítica.
- Catálogo de cría / `data_keys`: ya cerrado en ADR-021 (seed tentativo hasta validar con Facundo; no bloquea spec 03).

## Insumos para spec_author
- **ADR-021** (gating: mapeo maniobra→data_keys, doble capa) — CRÍTICO, esta spec implementa el check DB.
- ADR-020 (lote `management_groups`), ADR-016 (rodeo/sistema), ADR-017 (timeline), ADR-008 (transiciones de categoría).
- **spec 02** (tablas de evento, `rodeo_data_config`, `animal_profiles`, `management_group_id`, triggers de transición, propiedad `teeth_state`/CUT) — sustrato; reusar, no redefinir.
- **spec 09** (motor find-or-create, `useBusyMode`) — integración del alta en manga + suspensión del listener BLE.
- CONTEXT/03 (las 10 maniobras, presets, UI de manga), CONTEXT/07 (pendientes).

## Aprobación
- **Aprobado por Raf el 2026-05-28** (sesión 15, primer uso del Gate 0 de ADR-022). 03 pasa a `context_ready`. Las decisiones quedan lockeadas acá. La redacción de la spec (`spec_author`) se hace **just-in-time**, más cerca de implementar 03 (Ola 3), porque 03 depende de 04/05/09 todavía sin construir — escribirla ahora arriesgaría el mismo rot que sufrieron spec 02/09 (política de pipeline: spec buffer = 1, hoy ocupado por spec 09).

## Refinamiento de edge cases — sesión 18 (2026-05-29) — SETTLED-BY-IMPLEMENTATION (ver nota 2026-06-13)

Audit profundo del context (s15) contra spec 02 con los refinamientos de s17/s18. Corrige contradicciones stale y suma decisiones. **Supersede** las líneas del cuerpo (s15) que se indican.

> **Estado (2026-06-13):** estas 4 decisiones **ya NO están pendientes** — se resolvieron e implementaron en otras features mientras 03 esperaba su redacción JIT del cliente. Cada una está **settled-by-implementation** con su puntero al as-built. Ver la nota "Reconciliación JIT del cliente — 2026-06-13" al final.

1. **Cambio de rodeo en la sesión — corrige contradicción con R4.5.1.** El cuerpo (s15) ofrecía "[pasar el animal a este rodeo]" vía `UPDATE rodeo_id`; spec 02 **R4.5.1 (s17) bloqueó** el cambio de rodeo. **Resolución (Raf): relajar R4.5.1 → mover de rodeo PERMITIDO dentro del mismo sistema productivo** (el rationale de R4.5.1 era el dead-end de categoría cross-sistema; dentro de cría —un solo sistema— es seguro). En la manga, animal de otro rodeo del mismo establ./sistema → "[pasar a este rodeo]" vuelve a ser válido. **Delta sobre spec 02**: refinar R4.5.1 a "permitido dentro del mismo sistema". → **SETTLED**: el move-de-rodeo mismo-sistema ya está implementado en spec 02 Tier1 (R4.5.1 relajada). R4.4 se apoya en eso y NO dice "bloqueado".

2. **Eventos reproductivos NO-maniobra (parto / aborto / destete) → solo desde la ficha (spec 09 EDIT), no del wizard de manga.** Solo **tacto e inseminación** son maniobras reproductivas de manga. Ubicación de cada uno (criterio del leader, aprobado por Raf — "evento de la vaca → ficha de la vaca; transición del ternero → ficha del ternero"):
   - **Parto → ficha de la MADRE** (`reproductive_events.animal_profile_id = madre`; crea el/los ternero(s); el form de **mellizos** vive acá).
   - **Aborto → ficha de la MADRE** (revierte su categoría — decisión s18).
   - **Destete → ficha del TERNERO** (transiciona la categoría del ternero, R7.8; "destetar todo" opera sobre los terneros). Posible marca derivada en la madre (fin de lactancia) → **a confirmar con Facundo**.
   → **SETTLED**: ya construido en el frontend de spec 02 (chunk C3, done): `registerBirth`/`addAbortion`/destete viven en `app/src/services/events.ts`, disparados desde la ficha (`app/app/animal/[id].tsx` / `agregar-evento.tsx`), NO del wizard de manga. "Destetar todo" es feature 10 (`applyBulkWeaning`, done). US-8 nota de alcance ya lo refleja.

3. **Castración (revisado s18 — NO es maniobra de manga por ahora).** Decisión de Raf: la castración **no** se agrega como maniobra del wizard todavía; se anota como **"quizás a futuro"**. En MVP la castración existe como: **(a) evento individual** sobre el animal (desde la ficha) y **(b) operación masiva "castrar todo"** sobre un **rodeo o lote** (ver scope nuevo abajo).
   → **SETTLED**: resuelto fuera de 03. (a) castración individual = `setCastrated` (spec 02 Tier2 / spec 10, done — `is_castrated` reversible en la ficha, con observación automática); (b) "castrar todo" = `applyBulkCastration` (feature 10, done). **El "⚠️ efecto de categoría pendiente de Facundo / no hay novillo" YA NO APLICA**: spec 02 Tier2 agregó las categorías `novillito`/`novillo` + la columna `is_castrated` denormalizada + el recompute server-side (`compute_category` 0062) y su espejo cliente (`computeCategoryCode` en `app/src/utils/animal-category.ts`). Las 10 maniobras de manga quedan como estaban (sin 11ª).

4. **Animal de OTRO ESTABLECIMIENTO escaneado en la sesión (caso D2).** El cuerpo (s15) solo contemplaba otro RODEO del mismo campo. **Resolución (Raf): avisar "este animal está en el campo X" + saltarlo** (no frenar la manga) **+ sugerir "si querés transferirlo a este campo, bastonealo después de terminar las maniobras"**. La transferencia con re-parenting (sub-spec aparte, ver abajo) se dispara fuera de la sesión de manga.
   → **SETTLED**: la transferencia con re-parenting es **feature 11 (done, online-only)** — `transferAnimal` (`app/src/services/animals.ts` + `transfer-animal.ts`), con su modo `transfer` en `FindOrCreateOverlay.tsx`. R4.5 sigue siendo avisar+saltar+sugerir; el "sugerir transferir después" ahora apunta a un flujo real existente (bastonear el animal fuera de la sesión → el overlay global de spec 09 ofrece transferir).

### Scope NUEVO capturado (excede este audit → su propia feature + Gate 0)
- **Operaciones masivas por rodeo**: generar eventos sobre todo el rodeo (o subconjunto filtrado) manualmente — **destetar todo, castrar todo, vacunar todo**. → **SETTLED como feature 10 (done)**: `app/src/services/bulk-operations.ts` (`applyBulkVaccination`, `applyBulkWeaning`, `applyBulkCastration`) + `app/app/seleccion-masiva.tsx` / `vacunacion-masiva.tsx`.
- **Navegación rodeo-céntrica**: la vista de rodeo con acciones choca con ADR-018 (no hay tab "Rodeos"; viven en "Más"). Hay vista de rodeo as-built (`app/app/rodeo/[id].tsx`); la reapertura de ADR-018 no fue necesaria para 03.
- **Decisión de tratamiento PENDIENTE** (Raf decide al cierre): se resolvió como **feature nueva** (operaciones masivas = feature 10), no foldeada en 03.

### Transferencia con re-parenting (de 09 D2) → SUB-SPEC APARTE
Decisión de Raf (s18): la transferencia que preserva historia (re-apunta eventos/vínculos cross-tenant + Gate 1) se trata como **sub-spec propia**, no foldeada en 09. → **SETTLED**: implementada como **feature 11 (done)**. Ver `specs/active/09-buscar-animal/context.md` D2.

## Reconciliación JIT del cliente — sesión actual (2026-06-13) — decisiones nuevas de Raf

> El backend de 03 está **done** (migrations `0050-0057`: `sessions`, `maneuver_presets`, FK `session_id` en las 5 tablas de evento, triggers de gating capa 2 INSERT + UPDATE dientes/CUT, tenant-check cross+intra, enum `tacto_vaquillona`, fail-closed). Falta SOLO el cliente (Fase 3/4). Esta nota fold-ea las decisiones nuevas de Raf y settlea el stale de s18 (arriba). NO re-decide nada lockeado.

### Decisión nueva 1 — Balanza FUERA del MVP (cierra D6)
El pesaje (R6.9, R6.10) se carga **a mano** en el MVP: una acción explícita "pesar" sobre el animal que está en el cepo, tipeada por el operario. La integración con **balanza BLE** se **difiere a spec 05** (no existe aún, hardware-bloqueada). La interfaz del bastón (contrato BLE de spec 04) queda **extensible** para enchufar la balanza después (un `WeightCapableStickAdapter` futuro) sin reabrir esta spec. Toda mención a "balanza BLE" en el camino del cliente del MVP pasa a "peso manual + punto de extensión limpio"; toda mención a "spec 05" pasa a "post-MVP / spec 05 diferida".

### Decisión nueva 2 — Botones GIGANTES que llenan la pantalla (supersede el "60-80 px")
En la manga los controles de decisión deben ser **bloques full-width que se reparten el alto disponible del viewport**, ocupando gran parte de la pantalla; **cero espacio muerto** sin info ni botones. El **header de identidad** (tag/idv/rodeo/categoría) es mínimo pero **siempre visible**. Nada de tarjetas chicas centradas con márgenes enormes. Rationale de campo: se opera con una mano, guantes/barro/sangre, a velocidad de manga → tap imposible de errar + lectura instantánea. El piso de 60-80 px se conserva solo como **mínimo absoluto**, no como objetivo. Aplica sobre todo a la pantalla de carga rápida y a cada pantalla de paso-de-maniobra. (Folded en R5.2, R12.2 + nueva NFR de densidad R12.5.)

### Decisión nueva 3 — Orden de arranque del cliente: DESIGN SPIKE primero
El **primer** chunk de implementación es un **design spike de la pantalla de manga** (carga rápida + paso de maniobra) con esos botones gigantes, **antes** de la plomería. Visual primero, vetado con design-review (análisis pro fundamentado), solo se le muestra a Raf lo aceptable. Recién después se construye la lógica. (Reflejado en el orden de `tasks.md`: el chunk **M2** arranca por el design spike.)

### Decomposición de build (M1-M4) — ver `tasks.md`
- **M1 — Inicio + config de jornada**: pantalla de inicio (presets al tope + "nueva jornada") + wizard 3 etapas + services offline de `sessions`/`maneuver_presets` + gating UI capa 1.
- **M2 — Carga rápida (PANTALLA CRÍTICA, arranca por DESIGN SPIKE)**: identificación (bastón spec 04 + manual vía `FindOrCreateOverlay` spec 09 + `useBusyMode`/`useStickListenerControls`) + frame de carga rápida con header de identidad siempre visible + resumen por animal + siguiente animal + contador. **Acá caen los botones gigantes.**
- **M3 — Las 10 maniobras**: las pantallas paso-por-maniobra escribiendo a los services de evento de spec 02 con `session_id` + preview de transición (R8) + path dientes/CUT (gate capa 2 ya en backend).
- **M4 — Offline / reanudación / surfacing**: pulido offline sobre el outbox/CRUD-plano de feature 15 + reanudación (R10.5) + visibilidad de rechazos de sync (R10.8) + cierre de sesión.
