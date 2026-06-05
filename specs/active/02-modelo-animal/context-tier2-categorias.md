# Spec 02 — Tier 2/3 backend: modelo de categorías de cría (Gate 0 / contexto)

**Status**: APROBADO por Raf (Gate 0, 2026-06-04 — scope confirmado en chat).
**Tipo**: delta backend sobre spec 02 (feature 2). NO es feature nueva: cierra el "PENDIENTE Tier 2/3"
ya trackeado en `feature_list.json` (feature 2), que estaba bloqueado en "→Facundo".

## Driver

La sesión con Facundo (2026-06-03/04) cerró los "→Facundo" que tenían trabado el Tier 2/3 backend de
spec 02 (aborto destino, castración efecto, destete→madre, edades de transición). Además, el frontend
C3.2 (reproductivo, ya commiteado `60f927f`) registra eventos cuyos efectos de categoría **no están
todos modelados** en el backend → desfasajes visibles que Raf pegó testeando: registrar un **servicio**
sobre una ternera no la pasa a vaquillona; un **parto** sobre una ternera la deja en ternera; un
**aborto** no revierte la preñez del badge. Este chunk cierra esos desfasajes.

## Fuente de verdad del dominio (NO se re-decide acá)

- `docs/adr/ADR-008-automatic-category-transitions.md` (**enmienda 2026-06-03**) — máquina de estados completa.
- `specs/active/02-modelo-animal/dominio-categorias-facundo-2026-06-03.md` — detalle (datos por categoría, fórmulas, castración).

Este context fija el **SCOPE del delta backend** + los **edge cases de implementación** para el spec_author + Gate 1.

## Scope (aprobado por Raf)

### ENTRA
1. **Categorías nuevas** `novillito` / `novillo` → seed en `categories_by_system` (sistema cría bovina), sin romper los existentes.
2. **`is_castrated`** — atributo nuevo (ubicación `animals` vs `animal_profiles` → decide el design; probablemente `animals`, es del animal físico). Es el eje torito↔novillito / toro↔novillo. La CARGA del atributo (masiva = spec 10; individual desde la ficha = frontend posterior) NO es de este chunk; acá va el **atributo + su efecto en `compute_category`/triggers**.
3. **Reescritura de `compute_category`** (recálculo completo, `SECURITY DEFINER`):
   - **Macho**: `ternero` → (destete o al año) → `torito` (entero) / `novillito` (castrado) → (2 años) → `toro` / `novillo`.
   - **Hembra**: `ternera` → (destete o servicio o al año) → `vaquillona` → (tacto+) → `vaquillona preñada` → (1er parto, desde CUALQUIER categoría) → `vaca 2º servicio` → (2º parto) → `multípara`.
4. **Triggers de transición incremental** alineados 1:1 con `compute_category` — disparadores nuevos respecto al as-built (0031/0045/0046):
   - `weaning` (destete): `ternero→torito/novillito` (lee `is_castrated`), `ternera→vaquillona`.
   - `service` (servicio): `ternera→vaquillona`.
   - `birth` (parto): → `vaca 2º servicio` / `multípara` **desde CUALQUIER categoría femenina** por conteo de partos (hoy el trigger solo maneja `vaquillona preñada→vaca`).
   - `abortion` (aborto): **revierte la preñez** (`vaquillona preñada→vaquillona`; una vaca con partos queda igual) + `compute_category` deja de contar como preñez el `tacto+` previo a un aborto posterior.
   - **castración** (cambio de `is_castrated`): `torito→novillito`, `toro→novillo` en el momento; `ternero` sin cambio hasta el destete.
5. **Cría al pie** — estado de la madre (`con`/`sin`), driveado por parto (con) / destete del ternero (sin). Columna en `animal_profiles` vs derivado on-read → decide el design.
6. Migraciones (desde **0059**; as-built llega a 0058) + tests reales (suite `supabase/tests/animal`) + Gate 1.

### QUEDA AFUERA (diferido a su feature/chunk donde se usa)
- **Datos puros nuevos**: `dientes` (va con CUT en C3.3), `circunferencia_escrotal` (con historial), `año-de-nacimiento` (year-only) → alta guiada / C3.3. No afectan transiciones.
- **Fórmulas de analytics** (% preñez/destete/cabeza-cuerpo-cola, entoradas) → feature 07.
- **Castración masiva** (UI + `data_key` castracion) → spec 10.
- **Frontend** de las categorías/datos nuevos (picker de categoría con novillito/novillo, toggle castrado en la ficha) → después del backend.
- **Razas SENASA** → feature 08.

## Edge cases / decisiones para el design (spec_author + Gate 1)

- **Consistencia trigger incremental ↔ `compute_category`**: AMBOS deben dar el mismo resultado. Lección as-built: si una regla vive solo en el trigger, editar/borrar el evento hace que `compute_category` (recálculo, trigger 0046) revierta por edad. **Toda regla nueva va en los dos.**
- **Transiciones por EDAD** (1 año, 2 años): tensión con ADR-008 original (R7.8: "transiciones por edad NO automáticas"). El modelo nuevo SÍ usa cortes de edad. ¿Cómo se materializan sin un cron? Opciones a evaluar en design: (a) recálculo on-read / en cada apertura de ficha; (b) recalcular en el próximo evento; (c) job programado (no MVP). **Resolver en design — es el punto más espinoso.**
- **`is_castrated` ubicación**: `animals` (atributo del animal físico) vs `animal_profiles`. Probablemente `animals`. Confirmar + RLS/grants.
- **Override manual** (`category_override`): sigue ganando (R4.9). Las reglas nuevas lo respetan (no tocan si override=true).
- **Animal sin eventos** (alta directa con categoría elegida): `compute_category` resuelve por sexo/edad/castración.
- **Migración de datos existentes**: los animales ya cargados con categorías viejas — ¿se recalculan en la migración, o las reglas nuevas aplican solo a eventos/recálculos futuros? (probable: no tocar el histórico; aplicar on-edit/on-event). Decidir.
- **Seed `novillito`/`novillo`**: agregar a `categories_by_system` del sistema cría; verificar que `computeInitialCategoryCode` (cliente, espejo) y los tests no asuman el set viejo.
- **RLS/grants** de columnas nuevas (`is_castrated`, cría al pie): `authenticated` select/update con `has_role_in`; `apply_auto_transition` sigue REVOCADA (SEC-HIGH-01, no reintroducir).

## Gate
- **Gate 1 OBLIGATORIO** (schema + `compute_category`/triggers `SECURITY DEFINER` + RLS/grants de columnas nuevas) — `security_analyzer` modo spec antes de la aprobación humana de la spec (Puerta 1).

## Dependencias / qué desbloquea
- Depende de: backend spec 02 Tier 1 (done; migrations 0043-0049, `register_birth` 0045, `compute_category` 0031/0045).
- Migraciones desde **0059**.
- **Desbloquea**: el rediseño del **alta guiada** (necesita las categorías + datos por categoría en la DB), **C3.3** (CUT/editar categoría), **feature 07** (analytics), **spec 10** (castración masiva).
