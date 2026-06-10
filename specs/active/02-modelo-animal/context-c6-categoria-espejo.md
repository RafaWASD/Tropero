# Context — C6: espejo client-side de categoría (offline) + visibilidad del override

> Gate 0 (ADR-022) del chunk C6 de spec 02. Decisiones cerradas con Raf en chat el **2026-06-10**
> (vía AskUserQuestion, sesión de cierre de feature 15). Origen: entrada de backlog 2026-06-10
> "Transiciones de categoría NO visibles offline" — golpeó a Raf 2 veces probando en campo.
> **APROBADO por Raf (2026-06-10).** Arranca **después de cerrar la feature 15** (WIP=1).

## Problema (2 casos, 2 causas distintas)

1. **Lag offline real**: `compute_category` corre como trigger server-side en el INSERT del evento
   (Tier 2: 0062/0063/0046). Offline, el evento se guarda local + se encola sin pérdida, pero la
   categoría visible queda vieja hasta completar reconectar→subir→recalc→sync-down. Expectativa de
   campo: "la puse en servicio → la veo vaquillona AHORA". Riesgo de confianza, no de datos.
2. **Override invisible** (caso "1212"): con `category_override = true` el server NO transiciona
   nunca, **ni siquiera online** (R4.9 "override manda", `0063:34`). Comportamiento diseñado y
   correcto, pero la UI no comunica que la categoría está fijada a mano → Raf esperó una
   transición que jamás iba a ocurrir.

## Decisiones (lockeadas, no re-decidir en la spec)

- **D1 — Espejo client-side display-only** (opción A elegida; Raf descartó el "indicio de
  pendiente" extra y el cartelito-solo):
  - Port de `compute_category` (0062, ~100 líneas SQL, función pura y determinística) a TS puro.
  - Inputs: sexo, `birth_date`, `is_castrated`, conteo de partos (eventos `birth` no borrados,
    NUNCA terneros), existencia de destete/servicio, tacto+ no revertido por aborto posterior
    (RT2.7.5, requiere orden por `event_date`). **Todos disponibles en el SQLite local** (los
    eventos offline se escriben a las tablas locales sincronizadas; `animals` denormalizado en
    `animal_profiles` b1/ADR-026 según corresponda).
  - Se aplica **solo a la VISTA** (ficha + lista): si `category_override = false`, la UI muestra la
    categoría derivada localmente. **NO se escribe nada** — ni overlay, ni UPDATE, ni
    reconciliación. El server sigue siendo la única verdad; al sincronizar convergen solos (misma
    función ⇒ mismo resultado).
  - Si `category_override = true` → se muestra la categoría guardada tal cual (espejo NO aplica,
    igual que el server).
- **D2 — Visibilidad del override**: badge en la ficha cuando `category_override = true`
  ("categoría fijada manualmente") **+ acción para quitar la fijación** (revert: backend ya existe,
  trigger 0040 — `override true→false` dispara recálculo server-side). Mismo chunk.

## Fuera de alcance

- Cualquier cambio de backend/schema/RLS/triggers (el chunk es **frontend puro** → Gate 1 N/A,
  salvo que la spec descubra lo contrario).
- Escritura optimista de categoría (overlay `pending_*`) — descartada: display-only alcanza.
- Migración a `useQuery`/`watch` (backlog 2026-06-09, relacionado pero independiente).
- Analytics de categorías (feature 07) y castración masiva (spec 10).

## Riesgos y mitigaciones

- **Drift espejo↔server** si una migración futura toca `compute_category` y nadie actualiza el TS:
  - Mitigación 1: la suite del espejo replica como fixtures la matriz RT2.x ya testeada server-side
    (`supabase/tests/animal/run.cjs` T2.20+) — misma tabla de casos, dos implementaciones.
  - Mitigación 2: nota de mantenimiento en el header del archivo TS y en design.md de spec 02:
    "cualquier migración que toque compute_category actualiza este espejo + sus fixtures".
  - Peor caso del drift: categoría mostrada desactualizada hasta el próximo sync (molesto, no
    corrompe datos — display-only).
- Cliente ya tiene medio espejo (`animal-category.ts`, cortes de edad RT2.20 del alta): el port
  debe **reusar/extender** eso, no duplicar una tercera copia.

## Dependencias / orden

- Después del cierre de feature 15 (T7/T8-web + puerta de código final). Lee del SQLite local que
  la 15 dejó cableado.
- Flujo SDD: este context.md (Gate 0 ✅) → spec corta (requirements/design/tasks del chunk) →
  Puerta 1 → implementer (Opus) → reviewer (Opus) → Gate 2 → puerta de código.
