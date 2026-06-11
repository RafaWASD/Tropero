# impl 10 — frontend Fase 2 (utils puros) — T-CL.3 … T-CL.7

baseline_commit: 95e3177be928ea40165443f16bd9c0cdadf212e9

> Feature: spec 10 (operaciones-rodeo). Chunk: **SOLO Fase 2** (utils puros, sin design system, sin red).
> El backend (Fase 1, migraciones 0084/0085/0086) ya está done+gateado+commiteado. NO se toca Fase 3
> (services/hooks) ni Fase 4 (UI).
>
> **Continuación**: una corrida previa (`impl_10-frontend-fase2-3.md`) se cayó por un error de socket
> (infra) tras completar SOLO T-CL.1/T-CL.2 (`bulk-candidates.ts` + `.test.ts`, 13/13 verde, verificados
> por el leader). Esta corrida retoma desde T-CL.3 y cierra la Fase 2 (hasta T-CL.7). Fase 3 se hace en
> otra corrida. El baseline_commit es el MISMO que la corrida caída (feature multi-sesión; el SHA previo a
> la primera task de la feature-frontend; NO se sobreescribe).

## Estado: FASE 2 COMPLETA (T-CL.1…T-CL.7) — esperando reviewer. NO marqué la feature done.

## Plan (tasks de esta corrida)

Fase 2 — utils puros (sin design system, sin red):
- [x] T-CL.1 `bulk-candidates.ts` — candidatos por operación (YA HECHO, corrida previa, 13/13 verde)
- [x] T-CL.2 tests de candidatos (YA HECHO, corrida previa)
- [x] T-CL.3 `bulk-selection.ts` — secciones por categoría, defaults pre-tildados, todos/ninguno, contador, desglose
- [x] T-CL.4 tests de selección (defaults EXACTOS por operación)
- [x] T-CL.5 `bulk-idempotency.ts` — clave + id UUIDv5 determinístico (solo ops de evento)
- [x] T-CL.6 tests de idempotencia/no-duplicación
- [x] T-CL.7 `animal-category.ts` — cablear `isCastrated` real, degradar inferencia RC6.2.1

## Archivos tocados (esta corrida)

- `app/src/utils/bulk-candidates.ts` — **EDIT menor**: campo OPCIONAL `categoryOverride?: boolean` en
  `GroupProfile` (no afecta candidatura; lo lee el desglose de selección para el aviso R5.6).
- `app/src/utils/bulk-selection.ts` — **NUEVO** (T-CL.3).
- `app/src/utils/bulk-selection.test.ts` — **NUEVO** (T-CL.4), 17/17 verde.
- `app/src/utils/bulk-idempotency.ts` — **NUEVO** (T-CL.5): UUIDv5/SHA-1 puro.
- `app/src/utils/bulk-idempotency.test.ts` — **NUEVO** (T-CL.6), 15/15 verde.
- `app/src/utils/animal-category.ts` — **EDIT** (T-CL.7): `MirrorRowInput.isCastrated?` con precedencia;
  `computeDisplayOverrides` usa el real con fallback degradado a `inferIsCastrated`; header actualizado.
- `app/src/utils/animal-category.test.ts` — **EDIT** (T-CL.7): +6 tests (precedencia real/fallback/revert/
  ternero), 75/75 verde (los 69 C6 previos intactos).
- `specs/active/10-operaciones-rodeo/tasks.md` — T-CL.3…7 marcadas `[x]` + nota AS-BUILT.
- `progress/current.md` — estado de la corrida (retoma Fase 2 desde T-CL.3).
- `run-tests.mjs` ya tenía enganchados `bulk-selection.test.ts` y `bulk-idempotency.test.ts` (corrida
  previa; los archivos faltantes hacían fallar el check — ahora existen).

## Mapa R<n> → archivo:test

| R<n> | test concreto |
|---|---|
| R11.3 (defaults castración: solo terneros comunes; ⭐/adultos sin tildar) | `bulk-selection.test.ts` → "R11.3: castración pre-tilda SOLO terneros comunes…" + "el ⭐ NUNCA arranca tildado…" |
| R11.4 (defaults destete: todos) | `bulk-selection.test.ts` → "R11.4: destete pre-tilda a TODOS…" |
| R11.5 (secciones, todos/ninguno, contador) | `bulk-selection.test.ts` → "toggleSection(check=true/false)…" + "sectionCheckState all/none/some" + "sección VACÍA = none" |
| R11.7 (CTA count == seleccionados, disabled en 0) | `bulk-selection.test.ts` → "selectedCount == cantidad de tildados" + "CTA en 0 cuando se destilda todo" + invariante |
| R11.8 (desglose por categoría + ⭐ del sheet) | `bulk-selection.test.ts` → "el desglose por categoría suma EXACTAMENTE…" + "futureBullCount…" + "desglose de DESTETE…" |
| R5.6 (override no transiciona — conteo del sheet) | `bulk-selection.test.ts` → "overrideCount cuenta los SELECCIONADOS con category_override=true" (+ default 0 + destete) |
| R6.1 (clave + UUIDv5 determinístico) | `bulk-idempotency.test.ts` → "bulkEventId es determinístico…" + "claves distintas ⇒ ids distintos" + "distintos tipos… NO colisionan" + vector RFC 4122 + vectores SHA-1 FIPS |
| R6.2 (excluir ya procesados de entrada) | `bulk-idempotency.test.ts` → "claves DUPLICADAS… colapsan" + "lista vacía ⇒ sin nuevas" |
| R6.3 (re-ejecución no duplica) | `bulk-idempotency.test.ts` → "filterNewEventKeys excluye las ya existentes" + "re-ejecutar la MISMA masiva ⇒ 0 nuevas" |
| R13.6 (espejo con is_castrated real, degradar RC6.2.1) | `animal-category.test.ts` → "isCastrated=true/false REAL…" + "el real GANA a lo que infiere el code" + "SIN isCastrated ⇒ DEGRADA al fallback" |
| R10.6 (transición visible offline) | `animal-category.test.ts` → "isCastrated=true REAL ⇒ novillito… SIN sync" + "isCastrated=false ⇒ torito/toro (revert)" + "ternero no transiciona" |

> R4.3/R4.4 (vacunación skip `already_applied`) los toca el mapa de cobertura de la spec en T-CL.6, pero
> el lado vacunación/skip se ejercita en el SERVICE de Fase 3 (T-CL.8/9) + UI T-UI.6 — acá solo la barrera
> idempotente pura (`filterNewEventKeys`), que sirve a ambas ops de evento. No es un gap: es el reparto
> Fase 2 (pura) / Fase 3 (I/O) del propio diseño.

## Autorrevisión adversarial (paso 8)

Pasada hostil sobre mi propio trabajo. Qué busqué y qué encontré:

1. **¿Defaults EXACTOS?** (lo más cargado del chunk) — Verificado con tests dedicados: castración
   pre-tilda SOLO `ternero && futureBull!==true`; los ⭐ y TODOS los adultos arrancan sin tildar (incluso
   el caso "único candidato es ⭐" → 0 tildados). Destete pre-tilda TODOS. Usé `futureBull !== true` (no
   `=== false`) a propósito: un `undefined` defensivo queda pre-tildado (no es ⭐) — dirección segura.
2. **¿El espejo usa el is_castrated REAL y no la inferencia vieja, sin romper C6?** — `r.isCastrated ??
   inferIsCastrated(storedCode)`: el real (incl. `false`) gana; solo `null`/`undefined` caen al fallback.
   Test de PRECEDENCIA explícito (storedCode novillito + real false → torito). Los 69 tests C6 previos
   pasan intactos (el call-site `animals.ts` no pasa el real → fallback idéntico → cero regresión). Caso
   `ternero` castrado offline: NO inventa novillito (sigue ternero — espeja a 0062/T-DB.5, ambas
   direcciones), testeado.
3. **¿UUIDv5 determinístico y CORRECTO?** — No me confié de "compila": lo anclé al vector canónico de
   RFC 4122 (DNS + www.example.com → `2ed6657d-…`, que pasa exacto) y a vectores FIPS 180-1 de SHA-1
   (`""`, `"abc"`, multi-bloque de 56 bytes, boundary de 64 bytes) — todos pasan. Esto blinda el padding
   big-endian multi-bloque (el bug clásico de un SHA-1 a mano). SHA-1 PURO en JS (no `node:crypto`) para
   que corra en Hermes igual que en Node — el repo nunca usa `node:crypto`.
4. **Edge cases cazados**: (a) sección vacía → `sectionCheckState='none'` (no crash); (b) `summarize`
   sobre 0 seleccionados → `{total:0, byCategory:[], …}`; (c) dedup intra-batch en `filterNewEventKeys`
   (dos claves iguales en la misma corrida colapsan); (d) campo `categoryOverride` opcional → default 0
   en el conteo cuando no se provee. (e) Invariante `selectedCount == summarize().total` para CUALQUIER
   selección (el desglose del sheet y el número del CTA NO pueden divergir — propiedad, no caso suelto).
5. **¿Tests que pasan por la razón equivocada?** — Revisé que los tests de T-CL.7 ejerzan el path NUEVO:
   uso un `storedCode` que la inferencia resolvería DISTINTO del real (novillito+real-false → si pasara
   por inferencia daría novillito; pasa por el real → torito) — así el test FALLA si el wiring cae al
   fallback por error. El de fallback usa storedCode que infiere el resultado esperado, pero el de
   precedencia lo descarta. Cubierto en ambos sentidos.
6. **Inmutabilidad** (wiring React seguro): `toggleProfile`/`toggleSection` devuelven Set NUEVO; testeado
   que NO mutan el recibido (identidad). Importa para `useState` en Fase 4.

Nada quedó abierto: todo lo que encontré ya está cubierto por test antes de reportar.

## Reconciliación de specs (paso 9)

El as-built coincide con el design en lo esencial (utils puros, defaults Gate 0 v2, UUIDv5 R6.1). Dos
precisiones de implementación, reconciliadas en `tasks.md` (notas AS-BUILT bajo cada T-CL):

1. **`GroupProfile.categoryOverride` (campo nuevo, opcional)** en `bulk-candidates.ts`: el design §2.3
   no lo listaba en la forma del perfil candidato, pero R5.6 (aviso de override en el bottom-sheet, que
   T-CL.3 cubre) lo necesita en el desglose. Se agregó OPCIONAL (default `false`) y NO afecta la
   candidatura (un perfil con override igual es candidato — solo no transiciona, 0063/0064 respetan el
   override). Reconciliado en `tasks.md` T-CL.3 (nota AS-BUILT). No cambia el *qué* de ningún R<n>: es el
   input que R5.6 ya implicaba.
2. **UUIDv5 sobre SHA-1 PURO en JS** (no `node:crypto`): el design decía "UUIDv5 sobre namespace fijo"
   sin fijar la implementación. As-built = SHA-1 propio para portabilidad Hermes (el repo no usa
   `node:crypto`; solo `globalThis.crypto.randomUUID`). Reconciliado en `tasks.md` T-CL.5. No cambia el
   contrato (id determinístico por `(animal, tipo, fecha)`); es decisión de implementación.
3. **T-CL.7 — alcance Fase 2 vs Fase 3**: la función pura HABILITA + testea el input real; el CABLEADO
   en `animals.ts` + la proyección de la columna `is_castrated` en `local-reads.ts`/schema PowerSync son
   **Fase 3 (T-CL.12)**. El design (§4.4) ya separaba "schema cliente" como acompañamiento del delta; la
   nota AS-BUILT en `tasks.md` T-CL.7 deja explícito el reparto (cero regresión de C6 hasta entonces).

No hay contradicción spec↔código pendiente.

## Verificación

- `cd app && pnpm.cmd typecheck` → VERDE (0 errores).
- `node scripts/check.mjs` → **exit 0**, TODAS las suites verdes (typecheck + client unit con las 3 suites
  nuevas/tocadas enganchadas + RLS + Edge + Animal + Maneuvers + user_private + Import + Sync-streams +
  Operaciones-rodeo Fase 1 — sin flake en esta corrida).
- Conteos por suite: bulk-candidates 13/13, bulk-selection 17/17, bulk-idempotency 15/15,
  animal-category 75/75 (69 C6 previos + 6 nuevos T-CL.7).

## Riesgos / notas para el reviewer

- **SHA-1 a mano**: validado contra 4 vectores FIPS 180-1 + el vector canónico UUIDv5 de RFC 4122. Es
  hash NO-criptográfico de uso (derivar PK determinística), exactamente lo que pide RFC 4122 §4.3 — no es
  superficie de seguridad. Si el reviewer prefiere una lib, el contrato (`bulkEventId`/`uuidv5`) no
  cambiaría.
- **`BULK_EVENT_NAMESPACE` CONGELADO**: cambiarlo rompería la dedup contra eventos ya subidos. Hay un
  test que lo pinea. Documentado en el header del módulo.
- **Fase 3 pendiente** (NO en este chunk): cablear `isCastrated` real en `animals.ts` + proyectar la
  columna en queries/schema (T-CL.12); services `bulk-operations.ts`/`animals.ts setCastrated` (T-CL.8/11)
  que CONSUMEN estos utils; observación automática (T-CL.13). Hasta entonces, el espejo cae al fallback
  por inferencia (sin regresión).
</content>
</invoke>
