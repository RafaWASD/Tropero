# Spec 02 — Frontend — Refinamiento de contexto (Gate 0)

**Status**: APROBADO por Raf (sesión 22, 2026-06-01).
**Conducido por**: leader + Raf.
**Related**: spec 02 (sustrato + tasks Fase 3/4), spec 09 (find-or-create), spec 03 (MODO MANIOBRAS, consumidor), ADR-021 (plantilla de datos), ADR-020 (lote), ADR-023 (workflow diseño), CONTEXT/04.

> spec 02 nunca tuvo `context.md` (es anterior a ADR-022). Este Gate 0 cubre el **frontend** (Fase 3-6), cuya UI estaba marcada TENTATIVA (R14). Resuelve la tensión de "crear animal" y fija el orden.

## Driver de la sesión

Tras cerrar el frontend de spec 01 (B.1), Raf eligió arrancar el frontend del core ganadero. Al evaluar MODO MANIOBRAS se vio que es la cima de un stack sin construir (spec 02-cliente + 09 + PowerSync + BLE bloqueado). **Decisión de Raf**: arrancar por la base = **spec 02 frontend** (crear rodeo, animales, eventos, ficha), después **PowerSync**, después el resto, MODO MANIOBRAS al final.

## Decisión clave — "Crear animal" = find-or-create, NO un form de alta

Análisis de diseño (Mobbin + principios), evaluado para 2 personas:
- **Veterano que agrega 2 animales** y **uso en manga (progresivo)** → **una sola mejor manera: find-or-create** (identificar por ID manual o bastón → si no existe, crear). Patrón universal scan-or-type (Lifesum/MyDyson/alias/Zara). Principios: Jakob (modelo mental scan-to-add), reconocer>recordar (Nielsen #6), Hick (una decisión), **prevención de errores** (chequea duplicados ANTES — un form pelado crea TAGs duplicados a ciegas). Esto ES spec 09.
- **Usuario nuevo con rodeo entero** → trabajo DISTINTO (masivo): **importar** (Excel/CSV o datos SENASA/RENSPA que ya está obligado a tener) + **progresivo en la 1ra jornada de manga**. NO una pantalla de forms.
- Un **"form de alta suelto" no le sirve bien a ninguno** — es la respuesta cómoda para el dev, la peor de UX.

**Resolución (Raf, sesión 22)**: en vez de un form throwaway en spec 02, **adelantar la puerta MANUAL de find-or-create** (core de spec 09, sin bastón) como el camino de alta, JUNTO con las pantallas de animal de spec 02. Capas posteriores: puerta BLE (09+04), dedup avanzado, **importación masiva** (feature aparte — roza spec 08 SIGSA/RENSPA; flag de onboarding).

## Secuencia nueva (aprobada)

1. **spec 02 frontend + find-or-create manual (de 09)** ← ACÁ
2. **PowerSync** (offline full) — Fase 5 de spec 02
3. Capas: puerta BLE del bastón (04, hoy bloqueado ADR-024) + importación masiva
4. **spec 09** resto (las dos puertas que convergen, dedup)
5. **spec 03 MODO MANIOBRAS** (la cima)

> Mitigación de retrofit: construir el frontend online-primero **detrás de services swappables** (`src/services/*`) para que el swap a PowerSync (paso 2) sea localizado.

## Decomposición (chunks de implementer; cada uno con veto de diseño antes de mostrar a Raf)

- **C1 — Rodeos**: `RodeoContext` + `rodeo-config.ts` + `RodeosScreen` + **wizard "Crear rodeo"** (sistema → nombre → plantilla de datos) + editar plantilla + empty-state bloqueo total (R2.6). Primero: sin rodeo no hay dónde crear animales. Owner-only. (spec 02 T3.1/T3.6/T4.3)
- **C2 — Alta + lista**: `animals.ts` + **find-or-create manual** (tab Animales: tipear ID → buscar → no existe = CREATE con ID precargado + rodeo [1 fijo / ≥2 combo] + campos dinámicos por sistema; existe = ficha) + `AnimalListScreen`. (spec 02 T3.2/T4.1 + spec 09 puerta manual R1/R3)
- **C3 — Ficha + eventos**: `events.ts`/`observations.ts`/`transitions.ts` + `AnimalDetailScreen` (R14: categoría/override, prompt CUT, lote, timeline, agregar evento, link a la madre). (spec 02 T3.3/T3.4/T3.5/T4.2/T4.4)
- **C4 — Lotes**: `management-groups.ts` + `ManagementGroupsScreen` + asignar desde ficha. (spec 02 T3.7/T4.5)
- **C5 — PowerSync**: sync rules + swap del data layer a SQLite local + preview offline de transiciones. (spec 02 Fase 5)

## Criticidad manga
🟡 mixta (animales/rodeos se tocan tanto en oficina como en campo). La puerta manual de alta entra desde la tab Animales (lugar cómodo) → 🟡. El alta en manga (🔴) es spec 03 después. Igual: targets grandes, campos dinámicos claros, validación robusta (lección de la iteración de perfil de Fase 6).

## Pendientes / flags
- **Importación masiva** (onboarding del usuario nuevo con rodeo existente): feature/decisión aparte; roza spec 08 (SIGSA/RENSPA). Anotar cuando se aborde onboarding real.
- Validación final del seed de `field_definitions` de cría con Facundo (ya en backlog/CONTEXT/07).
- `one_feature_at_a_time`: este chunk activa el frontend de spec 02 (+ parte de 09). Coordinar con la terminal paralela de spec 04 (BLE) — trabajo colisión-safe (archivos distintos: `features/`/`services/` nuevos vs `ble/`).
