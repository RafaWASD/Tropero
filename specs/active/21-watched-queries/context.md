# Contexto — feature 21: watched queries (`db.watch`) para reactividad real (Gate 0)

> **Estado**: ✅ **Gate 0 APROBADO por Raf (2026-07-21)** → `context_ready`. Próximo: `spec_author`.
> **Origen**: decisión firme de Raf (2026-07-21, Puerta 2 de la feature 20): hacer `db.watch` AHORA,
> como feature aparte, para los 3 consumidores de la 20. Eligió esto por sobre mandarlo al backlog.
> **Las 4 decisiones de diseño (§4) quedaron aprobadas con las recomendaciones del leader.**

## 1. Por qué (el hallazgo que lo motiva — feature 20)

La feature 20 arregló la **re-lectura** de campos/rodeos/lotes en caliente reemplazando un latch roto por
el patrón canónico del repo: `useStatus()` + `lastSyncedAt.getTime()` como dep primitiva, re-leyendo en
cada avance de la señal de sync. **Funciona, pero tiene un techo probado.**

**Diagnóstico A/B determinista** (feature 20, sondeo directo de `__RAFAQ_PS__.getAll` SIN reload, 2/3
cambios secuenciales, evidencia cruda en `progress/impl_20-reactividad-sync.md`):

- La fila del cambio server-side **SIEMPRE** llega al SQLite local en **~1,5 s** (6/6 cambios, INSERT y UPDATE).
- Pero `lastSyncedAt` avanza de forma **NO determinista por cambio**: a veces tica al instante, a veces un
  cambio se **estanca ~90 s+** hasta que un checkpoint POSTERIOR (otro cambio, un keepalive, un reconnect)
  lo barre. Corrida 2, cambio 1: fila en SQLite a 1,5 s, señal congelada ~90 s.
- `lastSyncedAt` significa "último sync FULL completado", **no** "cambió un dato" → es el **primitivo
  equivocado** para reactividad. Puede lagear arbitrariamente detrás de la llegada del dato.

**Consecuencia medida**: la E2E de la 20 necesita `retries` honestos + un forzador de blip (adiciones) y
timeouts amplios (revocaciones) para ser verde — porque el cambio "aparece sin reiniciar" pero con latencia
no acotada. En producción, en conexión estable, el cambio de un coworker puede tardar hasta el próximo
checkpoint (~90 s+) en verse. Toda la reactividad de RAFAQ está emulada sobre esta señal gruesa: la app
tiene **CERO** watched queries (`useQuery`/`db.watch`) — deuda deliberada de spec 15 desde 2026-06-09.

## 2. Qué cambia con watched queries

Una **watched query** reacciona al **cambio del SQLite local** (la tabla), no a la señal de status. Como
la fila llega en ~1,5 s (probado), una watched query dispara la re-lectura en ~1,5 s **determinista**, sin
depender de que `lastSyncedAt` tique. Es el fix de fondo del hallazgo A/B.

Beneficios concretos:
- **Reactividad determinista** (~1,5 s en vez de hasta ~90 s+). Mejora de UX real, sobre todo la
  **detección de revocación** (hoy puede lagear; con una watched query sobre `user_roles` se detecta apenas
  la fila pasa a `active=0`).
- **E2E determinista**: se pueden **sacar los `retries` + el forzador de blip** de la 20 y asertar directo.
- **Setea el patrón** para migrar el resto de la app (los 5 focus-only del backlog, y a la larga todo).

## 3. Alcance (decisión firme de Raf: los 3 consumidores de la 20)

| Consumidor | Query a observar | Hoy dispara por |
|---|---|---|
| `EstablishmentContext.tsx` | membresías del usuario (+ `user_roles` propio para evidencia de revocación) | `lastSyncedMs` dep |
| `RodeoContext.tsx` | rodeos del establecimiento activo | `lastSyncedMs` dep |
| `app/app/lotes.tsx` | `management_groups` del establecimiento activo | `lastSyncedMs` dep |

**Explícitamente FUERA** (backlog, se migran después con el patrón ya establecido): los 5 focus-only
(`miembros`, `use-reports`, `animal/[id]`, `export-sigsa`, `maniobra`) y el resto de la app.

**Lo que NO cambia**: la **lógica de resolución** que construyó la 20 se preserva entera —
`assessDisappearance` (evidencia afirmativa), el diferimiento D1 (no patear en maniobra), E1 (no concluir
`active_lost` por sync parcial), E5 (copy para ambas causas). Solo cambia el **disparador** (de dep
`lastSyncedMs` a `db.watch` onChange). La frontera de autorización real (RLS `has_role_in`) no se toca.

## 4. DECISIONES (✅ aprobadas por Raf en Gate 0, 2026-07-21 — con las recomendaciones del leader)

**D1 ✅ — `useQuery` vs `db.watch`.** `@powersync/react` expone `useQuery` (hook reactivo,
idiomático React) y `db.watch` (imperativo, callback onChange). Los **contextos** (`EstablishmentContext`,
`RodeoContext`) hacen más que renderizar filas: corren lógica de resolución (evidencia, revocación,
diferimiento). Recomiendo **`db.watch` imperativo dentro del efecto existente** para los contextos (el
onChange corre la resolución que ya existe), y **`useQuery`** para `lotes.tsx` (es una pantalla que
renderiza una lista — el hook es el encaje natural). Alternativa: `useQuery` uniforme y derivar la
resolución de su `data`. *Abierto: ¿unificamos en uno, o mixto por tipo de consumidor?*

**D2 (leader recomienda) — la watched query de revocación.** Observar `user_roles` del propio usuario
(el stream `self_user_roles`, que sobrevive a la revocación con `active=0` — candado RG-1 de la 20)
detecta la revocación **directo y rápido**, mejor que el "leer evidencia en cada avance de señal" de la 20.
Recomiendo observarlo explícitamente. *Abierto: ¿confirmás que querés que la detección de revocación también
pase a watched query (mejora la latencia del aviso de campo-perdido), o solo la aparición de datos nuevos?*

**D3 — ¿sacamos los `retries` + el forzador de la E2E de la 20?** Si `db.watch` vuelve determinista la
reactividad, la E2E de la 20 podría asertar directo sin `retries` ni blip. Recomiendo **sí, como parte de
esta feature** (reconciliar la E2E de la 20). *Abierto: ¿lo hacemos acá o lo dejamos para no tocar la 20 ya
cerrada?*

**D4 — ¿esta feature toca el ADR del patrón?** `db.watch` es el **primer** watched query de la app y setea
el patrón para migrar el resto. Recomiendo un **ADR** (decisión arquitectónica) que declare el patrón y el
plan de migración incremental. *Abierto: confirmás el ADR.*

## 5. Edge cases a resolver en la spec

- **E1 — Falso `active_lost` por estado transitorio.** Las watched queries disparan en **cada** cambio
  local, posiblemente MÁS que `lastSyncedMs` (que solo ticaba en checkpoints completos). Hay que garantizar
  que un estado intermedio (fila a medio bajar, set momentáneamente vacío) no se lea como "perdiste acceso".
  La lógica de evidencia afirmativa de la 20 (`assessDisappearance`) ya lo cubre — pero la spec debe
  demostrar que sigue valiendo con el nuevo disparador (más frecuente).
- **E2 — Doble disparo / thrash.** `db.watch` puede emitir seguido; el guard de equivalencia de la 20
  (`sameEstablishmentList`, `sameManagementGroups`, `sameResolvedEstablishmentState`) evita re-render por
  cambio no-op. Verificar que se compone bien con el onChange.
- **E3 — Offline puro.** Sin sync, la watched query emite el estado local vigente (vacío o lo último). Igual
  que hoy, no debe concluir en contra del usuario.
- **E4 — La ventana de propagación de revocación bajo red mala.** Hallazgo de la 20: la remoción de bucket
  se DISRUPTA con reconnects; una watched query reacciona apenas la remoción llega al SQLite, pero **no
  acelera la ENTREGA** (eso es el servicio). La frontera real sigue siendo server-side (RLS instantáneo).
  La spec no debe prometer revocación de UI instantánea bajo conectividad intermitente.

## 6. Gates

- **Gate 1 (spec, seguridad)**: probable — toca la detección de revocación (de nuevo). La frontera real
  (RLS + streams) no se mueve; la evidencia afirmativa sigue siendo señal de UX, no authz.
- **Gate 2.5 (E2E)**: sí. Objetivo: E2E **determinista sin retries** (a diferencia de la 20).

## 7. Reconciliación al cerrar

- `specs/active/15-powersync/design.md` — la nota de "cero watched queries / reactividad emulada" pasa de
  deuda total a "los 3 consumidores migrados; el resto pendiente".
- `specs/active/20-reactividad-sync/` — si D3 = sí, reconciliar la E2E (sacar retries/forzador) y el header.
- `docs/backlog.md` — cerrar/acotar el ítem `db.watch` (reescrito el 2026-07-20).
- Nuevo **ADR** (D4) — patrón de watched queries + plan de migración incremental.
