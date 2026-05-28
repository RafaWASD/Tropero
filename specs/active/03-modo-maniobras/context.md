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
