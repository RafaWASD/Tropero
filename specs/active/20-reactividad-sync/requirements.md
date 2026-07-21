# Requirements — feature 20: reactividad de lecturas sincronizadas

> **Estado**: `spec_ready` (redactada 2026-07-19 por `spec_author`).
> **Fuente de verdad**: `specs/active/20-reactividad-sync/context.md` (Gate 0 aprobado por Raf, 2026-07-19).
> Las decisiones **D1, D1.1, D2, D3, D4** del context son vinculantes. Esta spec las traduce a EARS, no las re-decide.
> **Notación**: EARS estricto (`docs/specs.md`). IDs `R20.<n>` estables — no reordenar después de aprobar.

---

## 0. Alcance en una línea

Los dos contextos raíz (`EstablishmentContext`, `RodeoContext`) y la pantalla `lotes.tsx` re-leen el SQLite local en **cada** avance de sync (patrón canónico `lastSyncedMs`), en vez de una sola vez tras el primer sync (latch roto). Sin migrar a watched queries, sin cambiar firmas públicas.

**Fuera de alcance (explícito, no negociable en esta spec)**: E2 (pérdida silenciosa de writes al revocarse el acceso — D3, feature aparte), las 5 pantallas focus-only (§5 del context), y la deuda de arquitectura de migrar a `useQuery`/`db.watch`.

---

## 1. Re-lectura reactiva (el fix base)

**R20.1** — Cuando avance el sync de PowerSync (`lastSyncedAt` cambia a un valor distinto de 0), el sistema deberá re-leer las membresías del usuario en `EstablishmentContext`.

**R20.2** — Cuando avance el sync de PowerSync, el sistema deberá re-leer los rodeos del establecimiento activo en `RodeoContext`.

**R20.3** — Cuando avance el sync de PowerSync y la pantalla de lotes esté montada, el sistema deberá re-leer los lotes del establecimiento activo.

**R20.4** — El sistema no deberá condicionar las re-lecturas de R20.1/R20.2 a una transición única de `hasSynced` de falso a verdadero (queda prohibido el latch de un solo disparo).

**R20.5** — El sistema no deberá condicionar la re-lectura de rodeos (R20.2) a que el contexto esté en estado `loading` (queda eliminado el segundo candado `isWaitingRef`).

**R20.6** — La dependencia del efecto de re-lectura deberá ser un valor primitivo en milisegundos derivado de `lastSyncedAt`, no el objeto de estado de sync.

**R20.7** — Mientras el valor primitivo de sync sea `0` (ningún sync completado), el sistema no deberá disparar la re-lectura reactiva.

**R20.8** — Si el valor primitivo de sync vuelve a `0` (el SDK documenta que `lastSyncedAt` se resetea ante un reinicio del servicio PowerSync), entonces el sistema no deberá modificar el estado ya resuelto.

**R20.9** — Cuando una re-lectura reactiva esté en curso, el sistema no deberá activar el estado de carga que reemplaza el contenido montado por un placeholder (re-lectura **silenciosa**: sin parpadeo en blanco, sin reinicio del scroll — `docs/conventions.md` §UI).

**R20.10** — Si una re-lectura reactiva falla (error de lectura local o degradación "Sincronizando…"), entonces el sistema deberá conservar el estado resuelto previo y no deberá volver a `loading`, `no_establishments` ni `no_rodeos`.

**R20.11** — Cuando el resultado de una re-lectura reactiva resuelva a un estado equivalente al vigente (mismo estado, mismo elemento activo y mismo conjunto disponible), el sistema no deberá emitir un estado nuevo.

---

## 2. E1 — sin falso `active_lost` por sync parcial

> Contexto E1: el latch existía justamente para "evitar falsos `active_lost` por downloads parciales". Al re-leer en cada avance de sync hay que garantizar que un estado transitorio no se lea como "perdiste acceso".
>
> **Regla de decisión (swap ordenado por el leader, 2026-07-19): EVIDENCIA AFIRMATIVA.** La revocación se concluye a partir de un hecho que se lee —la fila local de rol del propio usuario— y nunca por inferencia de ausencia. La fila propia **nunca desaparece por una revocación**: la stream `self_user_roles` (`sync-streams/rafaq.yaml`) se scopea solo por `user_id`, sin `org_scope` y sin filtro `active`, así que una revocación la deja local con `active = 0`. Queda **eliminada** toda confirmación por ventana temporal o por segunda lectura consecutiva. Fundamento completo en `design.md` §4.

**R20.12** — El sistema deberá considerar que hubo revocación del campo activo **únicamente** cuando la fila local de rol del usuario para ese establecimiento esté ausente o tenga `active = 0`.

**R20.13** — Cuando el campo activo no esté en el conjunto devuelto por una re-lectura, el sistema no deberá tomar esa ausencia como condición suficiente para concluir revocación (ni con conjunto vacío ni con conjunto poblado).

**R20.14** — Cuando la fila local de rol del usuario para el campo activo esté ausente o tenga `active = 0`, el sistema deberá concluir que hubo revocación, con independencia de si el conjunto devuelto está vacío o poblado.

**R20.15** — Cuando la fila local de rol del usuario para el campo activo exista y tenga `active = 1` pero el campo no esté en el conjunto devuelto, el sistema deberá tratar el estado como inconsistencia transitoria, no deberá cambiar de estado y deberá re-evaluar en el siguiente avance de sync.

**R20.16** — Mientras el primer sync esté pendiente, el sistema no deberá concluir revocación (comportamiento as-built de `applyMembershipsResult`, preservado).

**R20.17** — El sistema deberá aplicar la misma regla de evidencia afirmativa cualquiera sea el disparador de la re-lectura (avance de sync o acción del usuario).

**R20.18** — Cuando una re-lectura de rodeos devuelva un conjunto vacío **y exista un estado de rodeo ya resuelto para ese mismo campo activo**, el sistema deberá concluir `no_rodeos` únicamente si la fila local de rol del usuario en el campo activo existe y tiene `active = 1`; en caso contrario no deberá cambiar de estado.

> **Nota de reconciliación as-built (implementer, 2026-07-20).** El requisito original no llevaba la
> condición "**y exista un estado de rodeo ya resuelto para ese mismo campo**", y aplicarlo también en el
> arranque rompía un camino real y testeado: al crear un campo, `applyCreatedEstablishment` lo deja activo
> de forma OPTIMISTA y la fila de `user_roles` (que crea el trigger `0011` server-side) todavía no bajó al
> SQLite local → la evidencia devolvería `absent_or_inactive` → no se concluiría `no_rodeos` → el `RootGate`
> quedaría en **splash** en vez de mostrar el wizard "Creá tu primer rodeo" (spec 02 R2.6, cubierto por
> `e2e/establishments.spec.ts`). La guarda existe para que un estado `active` **ya resuelto** no se tumbe a
> `no_rodeos` durante una revocación (design §8 riesgo 7), y ese escenario **siempre** ocurre con un `active`
> resuelto sobre el mismo campo (el operario está adentro de su maniobra) → queda íntegramente cubierto. En
> un arranque, o justo después de cambiar de campo, no hay estado que proteger y se conserva el
> comportamiento as-built (set vacío ⇒ `no_rodeos`). As-built: `RodeoContext.tsx` (`statusRef` +
> `resolvedForEstRef`).

**R20.19** — Cuando una re-lectura reactiva de rodeos devuelva un conjunto poblado que contenga el rodeo activo, el sistema no deberá cambiar el rodeo seleccionado.

**R20.30** — Si la lectura de la evidencia afirmativa falla, entonces el sistema no deberá concluir revocación ni `no_rodeos` (fail-safe: la falta de evidencia nunca decide en contra del usuario).

**R20.31** — El sistema deberá obtener la evidencia afirmativa del SQLite local, sin realizar ninguna llamada de red.

**R20.32** — El sistema deberá consultar la evidencia afirmativa solo cuando el elemento activo no aparezca en el conjunto leído (no en cada avance de sync).

**R20.37** — Cuando la evidencia afirmativa resulte ilegible, el sistema deberá registrar el hecho por el canal de diagnóstico, con el identificador del establecimiento y la clase de error, y sin datos de campo ni PII.

> **Limitación conocida y aceptada** (Gate 1 MED-2, decisión del leader — opción (a), sin contador): una evidencia ilegible **persistente** deja al usuario en `active` sobre un campo cuyas filas PowerSync ya borró, indefinidamente y a través de reinicios. Se acepta porque: (i) el blast radius es una vista vacía, no una fuga — concluir o no la revocación **no cambia qué datos hay en el device**; (ii) darle un piso exigiría reintroducir un contador, justo la clase de heurística que se acaba de eliminar (`design.md` §9.2), por un caso cuyo peor desenlace es una pantalla vacía; (iii) `unknown` proviene de un fallo de lectura del SQLite local, y si esa lectura falla de forma persistente entonces `loadMemberships` también falla y la app está rota de punta a punta — el escenario está subsumido por una falla mayor. Lo que **no** se acepta es que sea silencioso: de ahí R20.37. Esto **no** debilita R20.30 (seguir sin concluir revocación sigue siendo el fail-safe); solo hace visible que no se pudo verificar.

---

## 3. D1 / D1.1 / D1.2 — revocación en caliente (SOLO navegación y aviso, SOLO mientras viva la sesión)

> **Límite duro heredado de D1.1**: D1 gobierna **la navegación y el aviso**. Esta spec **no** promete que los datos de la maniobra sobrevivan a la revocación — eso es E2 y está FUERA (D3).
>
> **Límite duro heredado de D1.2** (Gate 1 HIGH-1): el diferimiento vale **mientras viva la sesión**. En una remoción de miembro, `remove_member` revoca la sesión del target → el operario termina en **login** dentro de ≤`jwt_expiry` (3600 s), y eso ocurre en una capa (auth) por encima de `EstablishmentContext`. Los requisitos de abajo son una **garantía acotada**, no una aspiración.

**R20.20** — Mientras el usuario esté dentro del flujo de maniobra, el sistema no deberá pasar el contexto de establecimiento a `active_lost` aunque haya detectado una revocación del campo activo.

**R20.21** — Mientras el usuario esté dentro del flujo de maniobra con una revocación detectada **y la sesión siga vigente**, el sistema deberá conservar el estado `active` sobre el campo revocado (el usuario no es sacado de la pantalla en la que está trabajando).

**R20.22** — Cuando el usuario salga del flujo de maniobra teniendo una revocación diferida pendiente, el sistema deberá aplicar la transición a `active_lost`.

**R20.23** — Cuando el sistema entre en `active_lost`, deberá mostrar el aviso de pérdida del campo antes de re-rutear a cualquier otro destino.

**R20.24** — Cuando se detecte una revocación y el usuario **no** esté dentro del flujo de maniobra, el sistema deberá pasar a `active_lost` de inmediato.

**R20.25** — El diferimiento de la revocación deberá vivir solo en memoria; en un arranque en frío el sistema deberá re-evaluar las membresías sin diferimiento.

**R20.26** — El aviso de pérdida del campo no deberá afirmar que los datos cargados durante la maniobra se conservaron ni que se subieron.

**R20.33** — Mientras haya una revocación diferida pendiente, el sistema deberá conservar el campo revocado dentro del conjunto de campos disponibles que expone el contexto **y** dentro del set vigente que consumen sus acciones, sin divergencia entre ambos (invariante: el campo activo siempre pertenece al conjunto disponible).

**R20.34** — Cuando el usuario cambie de campo activo durante el diferimiento, el sistema deberá descartar la revocación diferida sin emitir aviso.

> **Nota de reconciliación as-built — cobertura de R20.33/R20.34 (implementer, 2026-07-20).** Ambos están
> **implementados** (merge del campo revocado atado a `pendingRevocationRef`, en una sola fuente para
> `availableRef.current` y `state.available`; descarte del pendiente en `switchEstablishment`), pero **no
> son alcanzables por la UI**, así que su verificación es unitaria y por inspección, no E2E — a diferencia
> de lo que anticipaba `tasks.md` T21 punto 4 y la fila de E2E de §6.
>
> El motivo es estructural: la señal de "hay maniobra en curso" **es la ruta** (D1, design §5.1), y el
> switch de campo vive en el header de la home, fuera del flujo de maniobra. Salir de la maniobra para
> llegar al switch es exactamente lo que dispara la emisión de la revocación diferida (R20.22), así que la
> ventana en la que el switch sería observable con un pendiente vivo dura lo que una lectura local del
> SQLite. No hay forma honesta de escribir un E2E de eso: cualquier intento probaría otra cosa.
>
> Lo que sí se verifica: (a) la lógica de decisión del descarte, con unitarios de
> `shouldEmitDeferredRevocation` (`pendingId !== currentId` → no emite, R20.34); (b) la invariante de R20.33
> por inspección — el merge está en el único punto por el que pasan todas las aplicaciones de set
> (`applyMemberships`) y la rama async **no toca `availableRef`** hasta tener veredicto, de modo que ref y
> estado no pueden divergir ni siquiera durante la lectura de evidencia.

**R20.35** — Cuando corresponda aplicar una revocación diferida, el sistema deberá re-verificar que el campo pendiente siga siendo el campo activo y que su evidencia afirmativa siga indicando revocación; si alguna de las dos condiciones no se cumple, deberá descartar el pendiente sin emitir `active_lost`.

**R20.36** — El diferimiento deberá estar acotado a la vigencia de la sesión: si la sesión del usuario cae durante una maniobra, el sistema deberá seguir el flujo de autenticación existente (ruteo a login), sin aviso de campo perdido y sin garantizar la continuidad de la maniobra.

---

## 4. E5 — campo activo borrado vs. revocado

> Resolución (ver `design.md` §6, con la evidencia): desde el cliente **son indistinguibles, incluso teniendo la fila de rol propia a la vista**. `remove_member` (Edge Function, líneas 88-92) y el trigger `deactivate_roles_on_establishment_soft_delete` (migración 0076) escriben **el mismo par de columnas con los mismos valores** (`active = false` + `deactivated_at = now()`), y en ambos casos la fila de `establishments` sale del SQLite local. La propia migración 0076 documenta la indistinguibilidad. Por lo tanto: **mismo tratamiento**, con copy verdadero para ambas causas.

> **Matiz obligatorio (Gate 1 HIGH-1)**: "indistinguibles" aplica a **la firma local** (qué columnas quedan en el SQLite), que es lo que gobierna el aviso y el copy. **No** aplica a la duración de la ventana de diferimiento: una remoción de miembro revoca la sesión y una eliminación de campo no (tabla en D1.2 / `design.md` §5.4). Son dos ejes distintos y la spec los trata por separado — R20.27/R20.28 hablan del primero, R20.36 del segundo.

**R20.27** — Cuando el campo activo desaparezca del conjunto accesible, el sistema deberá aplicar el mismo tratamiento (aviso + re-ruteo por cantidad de campos restantes) sea la causa una revocación de rol o un borrado del campo.

**R20.28** — El aviso de pérdida del campo deberá usar un texto que sea verdadero para ambas causas y no deberá afirmar una causa única.

**R20.29** — El sistema no deberá emitir la razón `establishment_deleted` mientras no exista una señal server-side que permita distinguirla (hoy no existe: la razón queda declarada en el tipo pero nunca se produce).

---

## 5. Trazabilidad — criterios de aceptación → requisitos

| # | Criterio de aceptación (`feature_list.json`, id 20) | Requisitos |
|---|---|---|
| A1 | Un campo al que te agregan server-side aparece en Mis campos / el switch SIN reiniciar la app. | R20.1, R20.4, R20.9, R20.11 |
| A2 | Un rodeo creado/borrado/renombrado por un coworker aparece o desaparece del selector sin reiniciar. | R20.2, R20.4, R20.5, R20.18, R20.19 |
| A3 | `lotes.tsx` (hoy mount-only) refleja lotes de otros usuarios. | R20.3, R20.9 |
| A4 | Revocación en caliente (D1/D1.1/**D1.2**): no se saca al usuario si hay maniobra en curso; aviso diferido al cierre; fuera de maniobra, salida con aviso claro. SOLO navegación y aviso, y **solo mientras viva la sesión**. | R20.20–R20.26, R20.33–R20.36 |
| A5 | Sin falso `active_lost` por sync parcial (E1); lista vacía (transitorio) vs. lista poblada sin el campo activo (revocación real). | R20.12–R20.18, R20.10, R20.30, R20.31, R20.32 |
| A6 | Sin loop de re-lectura: la dep del efecto es un primitivo (ms). | R20.6, R20.11 |
| A7 | Offline puro intacto: sin ningún sync (`lastSyncedMs === 0`) el efecto no dispara. | R20.7, R20.8 |
| A8 | E2E que cree la membresía server-side a mitad de test y assertee que la UI se actualiza SIN reiniciar. | R20.1 (verificación E2E: T10 de `tasks.md`) |

**Cobertura de los "Casos y decisiones" del `context.md`** (§6, regla de `docs/specs.md`):

| Caso | Requisitos que lo cubren |
|---|---|
| E1 — falso `active_lost` por sync parcial | R20.12–R20.18, R20.30–R20.32 |
| E2 — pérdida silenciosa de writes | **FUERA (D3)**. Delimitado explícitamente por R20.26 (el aviso no promete preservación) y por R20.36 (tampoco se promete continuidad ante caída de sesión). |
| D1.2 — diferimiento acotado a la sesión | R20.21, R20.36 |
| E3 — loop de re-lectura | R20.6, R20.11 |
| E4 — offline puro | R20.7, R20.8 |
| E5 — campo borrado vs. revocado | R20.27–R20.29 |
| D1 / D1.1 — revocación en caliente, solo navegación | R20.20–R20.26 |
| D2 — alcance membresías + barrido | R20.1, R20.2 |
| D4 — `lotes.tsx` entra | R20.3 |

---

## 6. Verificabilidad

Cada `R20.<n>` tiene ≥1 test concreto asignado en `tasks.md`. Resumen del tipo de prueba:

- **Unitarios puros** (`node:test`, sin RN ni red): R20.11–R20.19, R20.27–R20.30, R20.32 → lógica de resolución de membresías/rodeos y del veredicto de desaparición (incluido el caso central: checkpoint sin la fila de `establishments` pero **con** el rol local `active = 1` → NO concluye).
- **Unitarios del SQL builder** (`local-reads.test.ts`): R20.31 → la query de evidencia afirmativa es local, parametrizada por `(user_id, establishment_id)` y no toca red.
- **Unitarios puros del predicado de maniobra**: R20.20, R20.24 (decisión "diferir vs. aplicar" a partir de la ruta y del pendiente).
- **E2E (Playwright, `./helpers/fixtures`)**: R20.1, R20.2, R20.3, R20.9, R20.22, R20.23, R20.24, R20.28. El caso 2 (T18) es **multi-cambio** (alta INSERT + rename UPDATE) y asserta el estado final combinado: R20.2 cubre que la re-lectura refleja tanto INSERTS como UPDATES (design §10-bis (g) reconciliado — ver abajo).
- **Unit + inspección (NO alcanzables por E2E)**: R20.33 (invariante del merge `available` durante el diferimiento — inspección; el switch con pendiente vivo no es observable por UI, ver nota bajo R20.33/R20.34) y R20.34 (unit `shouldEmitDeferredRevocation` con `pendingId !== currentId` + inspección del descarte en `switchEstablishment`). **NO** los cubre el E2E: la señal de "hay maniobra" es la ruta, y salir para llegar al switch es lo que dispara la emisión.
- **Unitarios puros del pendiente diferido**: R20.35 (el guard de re-verificación al emitir).
- **No verificable por E2E, documentado como limitación**: R20.36 — el bounce a login ocurre al vencer el access token (`jwt_expiry = 3600`), fuera de cualquier ventana razonable de test; acortar `jwt_expiry` implicaría tocar config compartida, que está fuera de alcance. Se cubre por inspección + la nota de `design.md` §5.4.
- **Inspección de código verificada por el reviewer** (invariantes estructurales, no comportamiento observable): R20.4, R20.5, R20.6, R20.7 — además cubiertas indirectamente por los E2E de R20.1/R20.2 (sin el fix, fallan).
- **E2E offline**: R20.7, R20.8 (la app arranca sin sync y no cambia de estado).

---

## 7. Notas de reconciliación (a completar al cerrar, no antes)

Al cerrar la feature (regla dura de `docs/specs.md` §Reconciliación) hay que tocar:

1. `specs/active/01-identity-multitenancy/` — `EstablishmentContext` y el gate `active_lost` cambian de comportamiento (aviso diferido en maniobra, guarda de lista vacía). Nota as-built bajo el `R6.10` de esa spec.
2. `specs/active/15-powersync/design.md` (bullet "One-shot `getAll`, NO `db.watch` — reactividad diferida"): sigue siendo cierto como deuda general, pero deja de aplicar a `EstablishmentContext`, `RodeoContext` y `lotes.tsx`.
3. El comentario de `EstablishmentContext.tsx:331-332` ("la cubre el `useFocusEffect` / refresh manual existente de las pantallas") es **falso** y se corrige junto con el código (T1).
