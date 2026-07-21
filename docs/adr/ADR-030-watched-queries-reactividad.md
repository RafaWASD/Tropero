# ADR-030: Adopción de watched queries (`db.watch` / `useQuery`) para reactividad

- **Estado**: Aceptada
- **Fecha**: 2026-07-21
- **Decisor**: Raf (Puerta 2 de la feature 20 → decidió hacer `db.watch` ahora)
- **Relacionado**: feature 20 (`20-reactividad-sync`, hallazgo A/B), feature 21 (`21-watched-queries`, esta migración), `specs/active/15-powersync/design.md` (deuda "cero watched queries")

## Contexto

Toda la reactividad de RAFAQ está **emulada sobre la señal de status** de PowerSync: el patrón canónico
del repo es `useStatus()` de `@powersync/react` + `lastSyncedAt.getTime()` como dependencia primitiva de un
efecto que re-lee con `getAll` en cada avance de sync. **La app tiene CERO watched queries** (`db.watch` /
`useQuery`) — deuda deliberada documentada desde 2026-06-09.

La feature 20 probó, con un **diagnóstico A/B determinista** (sondeo directo de `getAll` SIN reload, 2/3
cambios secuenciales; evidencia cruda en `progress/impl_20-reactividad-sync.md`), que **`lastSyncedAt` es
un proxy NO determinista del cambio de dato**:

- La fila del cambio server-side **SIEMPRE** llega al SQLite local en **~1,5 s** (6/6 cambios).
- Pero `lastSyncedAt` avanza **NO determinista por cambio**: a veces al instante, a veces un cambio se
  **estanca ~90 s+** hasta que un checkpoint posterior lo barre. Significa "último sync FULL completado",
  **no** "cambió un dato".

Consecuencia: la reactividad emulada tiene **latencia no acotada** (hasta ~90 s+), y su E2E necesita
`retries` + forzadores de blip para ser verde. Es el techo estructural del patrón vigente.

## Decisión

Adoptar **watched queries reales de PowerSync** como el patrón de reactividad, reaccionando al cambio del
**SQLite local** (que llega en ~1,5 s) en vez de a la señal gruesa de status:

- **`db.watch`** (imperativo) en los **contextos** que corren lógica de resolución sobre los datos
  (`EstablishmentContext`, `RodeoContext`): el `onChange` re-corre la resolución que ya existe
  (`assessDisappearance`, diferimiento D1, evidencia de revocación). Solo cambia el **disparador**.
- **`useQuery`** (`@powersync/react`, hook) en pantallas/componentes que renderizan listas directo
  (`lotes.tsx`, y a futuro las demás).
- **Migración INCREMENTAL, no big-bang**: la feature 21 migra los **3 consumidores de la 20**
  (`EstablishmentContext`, `RodeoContext`, `lotes.tsx`). El resto (los 5 focus-only del backlog:
  `miembros`, `use-reports`, `animal/[id]`, `export-sigsa`, `maniobra`; y demás) se migra después con
  este patrón ya establecido.

## Consecuencias

**Positivas**
- Reactividad **determinista ~1,5 s** (vs. hasta ~90 s+), incluida la **detección de revocación** (watched
  query sobre `self_user_roles`: el aviso de campo-perdido deja de lagear).
- **E2E deterministas sin `retries` ni forzadores** (se reconcilia la E2E de la 20).
- La frontera de autorización real (RLS `has_role_in`, server-side, instantánea) **no cambia**: la
  reactividad del cliente es UX, no authz.

**Negativas / costos**
- El patrón `useStatus() + lastSyncedAt` queda como **legado a reemplazar** — coexisten dos patrones hasta
  completar la migración incremental.
- Cada consumidor migrado cambia su disparador; hay que preservar la lógica de resolución y los guards de
  equivalencia (evitar thrash por el disparo más frecuente de `db.watch`).

## Alternativas consideradas

- **Seguir con `lastSyncedAt` + `retries`** (lo que hizo la 20): funciona y es estrictamente mejor que el
  latch previo, pero la latencia sigue no acotada — es un band-aid sobre el primitivo equivocado.
- **Big-bang de toda la app a watched queries**: mayor riesgo y superficie; se prefiere incremental
  empezando por los 3 consumidores ya aislados de la 20.
