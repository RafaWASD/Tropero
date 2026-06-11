# Bitácora spec_author — spec 02 / chunk C6 (espejo client-side de categoría + override visible)

**Fecha**: 2026-06-10. **Modo**: redacción (Gate 0 aprobado, `context-c6-categoria-espejo.md`).
**Output**: `specs/active/02-modelo-animal/{requirements,design,tasks}-c6-categoria-espejo.md` (numeración `RC6.x`).
**Gate 1**: N/A (frontend puro, sin schema/RLS/triggers). `feature_list.json` NO tocado (coordinación del leader).

## Verificado contra el as-built

- 0062 (función fuente), 0063 (override manda), 0040+0030 (revert respeta + history), 0021 (category_check), 0066 (cron targeted), tests T2.20–T2.33, `animal-category.ts` (medio-espejo a extender), `local-reads.ts`/`schema.ts`/`rafaq.yaml` (qué hay en SQLite local), ficha `[id].tsx` (gating Lote/baja, CategoryBadge ya recibe `manual`).

## Decisiones de criterio propio (validar en Puerta 1)

1. **`is_castrated` NO está en el SQLite local** (context-c6 decía que sí — error de hecho): `animals` está fuera del sync set (b1/ADR-026) y 0079 no lo denormalizó. Resolución frontend-pura: **inferencia** desde el code guardado (`novillito`/`novillo` → castrado; RC6.2.1). Correcta hoy (ningún write-path productivo setea `is_castrated=true`); limitación documentada. Finding al leader: denormalizarlo (backend) cuando llegue el toggle/spec 10.
2. **Revert = el cliente aporta el recalculado** (RC6.4.3): el context decía "trigger 0040 dispara recálculo" — impreciso: 0040 solo *respeta* el revert; no existe trigger que recompute al limpiar override solo, y el cron 0066 es targeted por edad. Se especifica el patrón as-built (T2.5/T2.30): UPDATE único `override=false + category_id=derivada por el espejo` → offline-capable. Alternativa "override-only" descartada (la categoría manual errónea quedaría server-side indefinidamente).
3. **Tie-break `created_at` null** (RC6.1.4): los INSERT locales no setean `created_at` (lo pone el trigger al subir) → el espejo trata null como "más reciente" a igualdad de fecha. Caso no cubierto por la matriz server (es semántica offline propia).
4. **Agregados en TS, no en SQL local**: el SQL trae eventos crudos; toda la máquina decide en el módulo puro (una sola implementación espejo, fixtures unificados). Réplica SQL descartada (segundo espejo = doble drift).
5. **Inyección en la capa service** (`applyCategoryMirror` en `animals.ts`): lista + búsqueda + ficha lo heredan sin tocar componentes; shapes públicos intactos. Búsqueda incluida como superficie de "lista" (mismas filas `AnimalRow`).
6. **Gating del "quitar fijación"**: cualquier rol activo + animal activo (R4.10 base; patrón Lote — RLS `animal_profiles_update` es la barrera real). NO el gating owner/autor de la baja.

## Findings para el leader

- F1: denormalizar `is_castrated` sobre `animal_profiles` (migración estilo 0079) antes/junto con el toggle de castración (spec 10) — backend, fuera de este chunk. (design §7.1)
- F2: la tabla `animals` declarada en `schema.ts` no la alimenta ninguna stream (siempre vacía local) y su comentario dice lo contrario — housekeeping de spec 15. (design §7.2)
- F3: el context-c6 queda con 2 imprecisiones fácticas (inputs locales; trigger de revert) — las correcciones están documentadas en design §5 y §7; si Raf prefiere, se anota una fe de erratas en el context al aprobar.
