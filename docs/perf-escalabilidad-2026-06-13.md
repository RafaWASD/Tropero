# Auditoría de performance / escalabilidad — 2026-06-13

> **Origen**: pregunta de Raf sobre cómo escala la app con muchos clientes/usuarios y cómo se comporta un campo con mucha data en un teléfono malo.
> **Estado**: análisis cerrado + **propuesta accionable lista** (los 6 índices de eventos). El resto es backlog para el "performance pass" de frontend.
> **Terminal**: redactado por la terminal NO-dueña de la feature activa (modo maniobras, spec 03). **No toca** `feature_list.json`, `progress/`, app code, ni la DB remota — solo este doc. Aplicar el SQL de §3 es un paso **gateado** (DB compartida) para cuando esta terminal sea dueña o Raf lo autorice.

---

## 1. Veredicto

- **Escalar a muchos clientes/usuarios (backend)**: bien parado. El sync JOIN-free (ADR-026, `sync-streams/rafaq.yaml`) hace que el bucket count sea **independiente del volumen de datos** — el problema más difícil de un offline-first multi-tenant ya está resuelto. Único agujero concreto: **faltan índices de `establishment_id` en las 6 tablas de eventos** (ver §2/§3). Barato de tapar.
- **Campo grande en teléfono malo (cliente)**: deuda real. **Cero virtualización de listas** en toda la app. No bloquea el beta (un campo, pocos miles de animales), pero es lo primero que se nota al crecer (ver §4).
- **Primeros meses con clientes reales (beta Chascomús)**: riesgo **bajo**. No se cae. Los riesgos aparecen con campos de muchos miles de animales, import de historial profundo, o gama baja real.

---

## 2. Hallazgo backend (accionable ya) — índices faltantes en tablas de eventos

La migración `0077_denormalize_establishment_id_event_children.sql` agregó `establishment_id` denormalizado a 6 tablas hijas (anti-spoof por trigger), para que entren al sync JOIN-free del paso 2. **Pero no creó índice sobre esa columna** — verificado: 0 hits de `CREATE INDEX ... establishment` sobre esas tablas en todo el árbol (`0001-0089`).

Tanto la **RLS** (`<tabla>_select` filtra por `establishment_id` vía el perfil) como el **stream de PowerSync** (`WHERE establishment_id IN org_scope`) filtran por esa columna. Sin índice → **sequential scan** sobre tablas que a escala tienen cientos de miles de filas (decenas de eventos × miles de animales × años).

Tablas afectadas y forma del índice (verificado contra el árbol):

| Tabla | `deleted_at`? | Índice recomendado |
|---|---|---|
| `weight_events` (0025) | sí | parcial `WHERE deleted_at IS NULL` |
| `reproductive_events` (0026) | sí | parcial `WHERE deleted_at IS NULL` |
| `sanitary_events` (0027) | sí | parcial `WHERE deleted_at IS NULL` |
| `condition_score_events` (0028) | sí | parcial `WHERE deleted_at IS NULL` |
| `lab_samples` (0029) | sí | parcial `WHERE deleted_at IS NULL` |
| `animal_category_history` (0030) | **no** (append-only) | índice plano |

El predicado parcial `WHERE deleted_at IS NULL` espeja exactamente el filtro de las streams y de la RLS de esas tablas → el índice se usa en el plan.

---

## 3. SQL propuesto (listo para aplicar — paso gateado)

> ⚠️ **No aplicar sin pasar por el clasificador / autorización de Raf** (DB remota compartida; memoria "Supabase MCP en modo escritura gatea deploys").
> ⚠️ **Numeración**: próximo número libre = `0090` (último as-built `0089`). **Coordinar con la terminal de modo maniobras antes de crear el archivo** — su cliente es frontend puro y no debería tomar números, pero su tasks.md exige reservar el rango "contra lo que la otra terminal tenga en vuelo". Confirmar `0090` libre al momento de aplicar.
> ℹ️ **Tamaño de tablas hoy (beta) = chico** → `CREATE INDEX` plano (lock breve) es suficiente. Si al momento de aplicar las tablas ya son grandes, usar `CREATE INDEX CONCURRENTLY` (fuera de transacción; la migración no puede correr en un bloque transaccional en ese caso).

```sql
-- 0090_event_children_establishment_id_indexes.sql
-- Índices de establishment_id sobre las tablas hijas denormalizadas en 0077.
-- Las streams (sync-streams/rafaq.yaml) y la RLS filtran por establishment_id sin índice → seq scan a escala.
-- Predicado parcial = espejo del filtro de la stream/RLS (deleted_at IS NULL) donde aplica.

create index if not exists weight_events_by_est
  on public.weight_events (establishment_id) where deleted_at is null;

create index if not exists reproductive_events_by_est
  on public.reproductive_events (establishment_id) where deleted_at is null;

create index if not exists sanitary_events_by_est
  on public.sanitary_events (establishment_id) where deleted_at is null;

create index if not exists condition_score_events_by_est
  on public.condition_score_events (establishment_id) where deleted_at is null;

create index if not exists lab_samples_by_est
  on public.lab_samples (establishment_id) where deleted_at is null;

-- animal_category_history: append-only, sin deleted_at → índice plano.
create index if not exists animal_category_history_by_est
  on public.animal_category_history (establishment_id);
```

**Riesgo**: nulo (aditivo, no cambia comportamiento de triggers/RLS, `IF NOT EXISTS` idempotente). **Reconciliación de spec**: al aplicar, reflejar el delta donde corresponda (feature de perf/índices nueva, o nota en la spec 15-powersync que introdujo la denormalización 0077).

---

## 4. Hallazgos cliente (backlog — NO accionable ahora, choca con frontend de maniobras)

Para el "performance pass" de frontend (cuando se retome y esta terminal/ese frente esté libre):

1. **Cero virtualización** 🔴 — ningún `FlatList`/`FlashList`/`SectionList` en toda la app. Toda lista grande es `.map()` dentro de `ScrollView`:
   - lista de animales: `app/app/(tabs)/animales.tsx:386`
   - vista grupo/lote: `app/src/components/GroupViewBits.tsx:104`
   - timeline del animal: `app/app/animal/[id].tsx` (`timeline.map(...)`)
   → Migrar a `FlashList`. Mayor ROI para "teléfono malo".
2. **`LIMIT 200` en la lista principal** (`app/src/services/powersync/local-reads.ts:604`) — salva el peor caso (no pinta 5000 filas) pero es tope tonto, no paginación. **Confirmar** el reporte de que las vistas de lote/grupo traen activos del campo y **filtran en memoria** (`management-groups.ts`) → con el tope de 200 puede dar **listas incompletas silenciosas** (correctitud, no solo perf).
3. **Sin índices locales en SQLite** 🟠 — `app/src/services/powersync/schema.ts` no declara ningún `index` (PowerSync **sí** lo soporta). Queries del device que filtran por `establishment_id`/`tag_electronic`/`rodeo_id` hacen full scan local. Agregar índices locales a las tablas grandes.
4. **Timeline sin LIMIT** — un animal con muchos años de eventos trae todo sin tope. Agregar `LIMIT` + "ver más".
5. **Sync inicial** — PowerSync baja **todas** las filas de los campos del usuario, sin ventana temporal ni archivado. Campo con historial profundo importado = base SQLite grande + primer sync largo con mala señal. Vigilar en onboarding de campos grandes.

---

## 5. Prioridad sugerida

1. **Antes de cargar un campo real con historial** → §3 (6 índices). Barato, alto impacto a escala. Gateado (DB).
2. **Performance pass de frontend** (#1, #2) → cuando se retome frontend. Mayor ROI percibido en gama baja.
3. **Confirmar/arreglar filtro en memoria de grupos** (#2) → es medio bug, no solo perf.
4. Índices locales + paginación real (#3, #4) → medio plazo.
