# impl — spec 03 M2.1-core: PLOMERÍA del identify de MODO MANIOBRAS

baseline_commit: 6308ff5c1e806a007144d9b244a667767d0f735f

> Cablea el spike `app/app/maniobra/identificar.tsx` (4 estados visuales, vetado + aprobado por Raf)
> a las piezas reales: BLE (spec 04), manual (spec 02/09 lookup), find-or-create (spec 09), sesión
> (M1). FRONTEND puro (backend done). Gate 1 N/A; Gate 2 después. Mantiene la dirección scan-first.

## Plan (tasks) — TODAS hechas
- [x] T1 — módulo PURO `app/src/utils/maniobra-identify.ts` + test (9 casos).
- [x] T2 — rewire `identificar.tsx` a real (sesión + BLE + suspensión global R3.2 + lookup + feedback +
      manual + disconnect/reconnect chip + auto-avance).
- [x] T3 — find-or-create inline (R4.1): UnknownHero con id precargado + rodeo de sesión → /crear-animal.
- [x] T4 — re-point del wizard `jornada.tsx` a `/maniobra/identificar` + ruta autenticada (sacada de
      DEV_WEB_ROUTES) en `_layout.tsx`.
- [x] T5 — e2e `maniobra-identify.spec.ts` reescrito (5 escenarios reales con adapter-mock/BleE2EBridge).

## Archivos tocados
**Nuevos:**
- `app/src/utils/maniobra-identify.ts` — lógica PURA: `resolveBleIdentify` / `resolveManualIdentify` /
  `shouldAutoAdvance` / `resolvePrefilledCreateParams` + tipos.
- `app/src/utils/maniobra-identify.test.ts` — 9 casos (node:test).

**Modificados:**
- `app/app/maniobra/identificar.tsx` — de spike mock a pantalla REAL (mantiene la dirección scan-first
  aprobada): sesión por `sessionId`, BLE manga-owned, lookup, feedback (provider), manual idv/visual,
  disconnect/reconnect (BleConnectionChip en el header), find-or-create inline, auto-avance a carga.
- `app/app/maniobra/_components/SpikeSessionHeader.tsx` — slot opcional `right` (chip de conexión).
- `app/app/_components/FindOrCreateOverlay.tsx` — `BULK_ASSIGN_ROUTE` → `BLE_OWNED_ROUTES` (`asignar-caravanas`
  + `maniobra`): el overlay global se SUPRIME por ruta en la manga (R3.2) → un solo consumidor del bastón.
- `app/app/maniobra/jornada.tsx` — el wizard navega a `/maniobra/identificar` (antes `/maniobra/carga`).
- `app/app/maniobra/carga.tsx` — comentario del punto de integración M2.1-core → M2.2 (recibe sessionId+profileId).
- `app/app/_layout.tsx` — `maniobra/identificar` SACADA de `DEV_WEB_ROUTES` (ahora autenticada real) + comentario.
- `app/e2e/maniobra-identify.spec.ts` — reescrito: 5 escenarios funcionales (a..e).
- `app/e2e/maniobra-wizard.spec.ts` — smoke actualizado (arrancar → identify, no carga).
- `scripts/run-tests.mjs` — registra `maniobra-identify.test.ts` en la suite unit.

## Mapa R → test
| R | Cobertura |
|---|---|
| R3.2 (suspender listener global) | `FindOrCreateOverlay` suprime por ruta `maniobra` (BLE_OWNED_ROUTES) + identify usa su propio `useBleStickListener`; e2e (a)/(b)/(c) bastonean DENTRO de la manga y el overlay global NO abre. |
| R3.3 (parseo+resolución por tag) | `maniobra-identify.test.ts` (lookupByTag edit→found, create→unknown); e2e (a) found, (b) unknown. EID parseado+dedupeado por el provider as-built. |
| R3.4 (feedback inmediato) | el provider dispara `playFeedback` (vibración + beep) al entrar la lectura (as-built `BleStickListenerProvider`); el estado visual "found" (FoundHero) es el feedback visual. e2e (a) "Lectura recibida". |
| R3.5 (manual idv/visual) | `maniobra-identify.test.ts` (0→unknown, 1→found, >1→ambiguous); e2e (d) manual por idv → found. Reusa `searchAnimals` (idv exacto + visual fuzzy). |
| R3.6 (disconnect → manual sin perder sesión) | e2e (e) disconnect → "Bastón desconectado" → manual resuelve, sesión intacta. El provider mantiene la sesión; el manual es manual-first. |
| R3.7 (reconexión automática) | el provider reconecta solo (as-built `connection-status`); el chip refleja el estado. e2e (e) connect→disconnect refleja el chip. |
| R3.8 (StickReader abstracto) | `identificar.tsx` consume `useBleStickListener` (contrato transport-agnóstico de spec 04, `contract.ts`/`stick.ts`); en web/e2e el transporte es `adapter-mock`. La pantalla NO depende del modelo de hardware. |
| R4.1 (find-or-create inline) | `resolvePrefilledCreateParams` test; e2e (b) "Animal nuevo" → "Dar de alta" → `Creando: [TAG]` (precargado read-only) + rodeo de la sesión en el hero. |
| R4.3 (BLE dup auto por tag) | `maniobra-identify.test.ts` (el BLE NUNCA devuelve ambiguous: el tag es único global → desempata solo). |
| R4.5 (otro establecimiento → avisar+saltar) | `maniobra-identify.test.ts` (transfer→other_establishment); e2e (c) "Está en otro campo" → "Saltar y seguir" → vuelve a escuchar. NO transfiere (feature 11). |
| auto-avance (decisión de Raf) | `maniobra-identify.test.ts` (SOLO found auto-avanza); e2e (a)/(d)/(e) found → carga rápida (~0,8s). |

## DIFERIDO a M2.1-edge (NO se hizo; queda safe + anotado)
- **R4.2** — manual con >1 candidato (caravana visual duplicada): outcome `ambiguous` (NO se auto-elige el
  equivocado) → `AmbiguousHero` (aviso "Hay varias iguales" + "Volver"). La UI de DESAMBIGUACIÓN (lista de
  candidatos para elegir) es M2.1-edge. La spec 09 tiene una UI de asignación masiva pero NO una de
  desambiguación-de-lookup reusable directa para esto → se construye en M2.1-edge. El estado seguro ya está.
- **R4.7** — heurística de "rodeo de jornada mal elegido" (primeros ~3 de otro rodeo) → M2.1-edge.
- **R4.4** — pasar/saltar a otro rodeo del MISMO establecimiento: el core resuelve EDIT directo (el animal
  del mismo campo se carga, sea cual sea su rodeo). El aviso/acción "otro rodeo mismo sistema" se evalúa en
  el frame de carga (M2.2), donde el gating por rodeo real ya re-resuelve qué maniobras aplican. Anotado.

## Qué REUSÉ vs qué CREÉ
- **Reusé (NO reinventé)**: `useBleStickListener`/`useStickListenerControls` + el provider + `adapter-mock` +
  `parser-rs420`/`dedup` (parseo+dedup ya hechos por el provider) + `playFeedback`/`feedback-pref` (R3.4) +
  `connection-status`/`BleConnectionChip` (R3.6/R3.7) + `lookupByTag`/`resolveTagLookup` (BLE) +
  `searchAnimals` (manual idv/visual) + `getSessionById` (M1) + `extractManeuvers`/`maneuverLabel` (header) +
  `formatEidReadable` + el patrón de suspensión-por-ruta del `FindOrCreateOverlay` (bulk-assign) + el idiom
  visual del overlay para "Animal nuevo" + los componentes visuales del spike (ScanHero/FoundHero/ManualEntry).
- **Creé**: el módulo PURO `maniobra-identify.ts` (la decisión de manga: found/other/unknown/ambiguous +
  gate de auto-avance) + los heroes nuevos `OtherFieldHero`/`AmbiguousHero` + el slot `right` del header.

## Autorrevisión adversarial (paso 8) — qué busqué, qué encontré, cómo lo cerré
Probé los edge cases como revisor hostil:
- **[ENCONTRADO Y CORREGIDO] setState-after-unmount bajo auto-avance.** El auto-avance (`router.replace` a
  carga) DESMONTA la pantalla; un `lookupByTag`/`searchAnimals` en vuelo que resolviera DESPUÉS llamaría
  `setOutcome` sobre un componente desmontado (warning + write inútil). **Fix**: `mountedRef` (useEffect de
  montaje) + guard `if (!mountedRef.current || seqRef.current !== ticket) return` en ambos async. (El
  `seqRef` ya cubría el live-rescan; faltaba el desmonte.)
- **[VERIFICADO OK] Doble lectura / live-rescan.** Un bastonazo nuevo (++seqRef) descarta el lookup viejo en
  vuelo; el auto-avance (useEffect con cleanup) reinicia el timer si el outcome cambia. El dedup por-TAG ya
  lo hace el provider (un re-escaneo dentro de la ventana ni llega al `onTagRead`).
- **[VERIFICADO OK] Desconexión a mitad.** e2e (e): disconnect → chip "Bastón desconectado" → la sesión NO
  se reinicia (el `outcome`/sesión viven en el state, el provider no los toca) → manual resuelve. R3.6 OK.
- **[VERIFICADO OK] Tag desconocido.** e2e (b): create→unknown→"Dar de alta" con el tag precargado read-only
  (`Creando: [TAG]`). El precargado va por params a crear-animal (tag>idv>visual), que ya valida el UNIQUE.
- **[VERIFICADO OK] Animal de otro campo.** e2e (c): transfer→"Está en otro campo"→Saltar→vuelve a escuchar
  (no frena la fila, no carga sobre él). NO transfiere (feature 11). R4.5 OK.
- **[VERIFICADO OK] Manual multi-candidato (R4.2).** El outcome `ambiguous` NO auto-elige (test unit + el
  `AmbiguousHero` solo avisa + "Volver"). Estado seguro; la UI de selección es M2.1-edge (no se finge).
- **[VERIFICADO OK] Dos consumidores del bastón (R3.2).** El overlay global early-returns por ruta `maniobra`
  (BLE_OWNED_ROUTES) ANTES del lookup → no hay doble proceso del EID. La manga es el único consumidor efectivo.
- **[VERIFICADO OK] find-or-create cross-tenant (T2.12/D9).** El alta delega a `/crear-animal` (params solo
  identificador, SIN `establishment_id`) → el establishment lo pone el contexto, el UNIQUE + `created_by`
  forzado los aplica el alta as-built. M2.1-core NO crea superficie de alta nueva.
- **[VERIFICADO OK] Multi-tenant / offline / es-AR / descendentes.** establishmentId del contexto (no
  hardcode); lookups locales (offline); el `tag_electronic`/`idv` son IDs de máquina (NO es-AR); headings y
  numberOfLines con lineHeight matching (heredado del spike aprobado + heroes nuevos verificados).
- **[VERIFICADO OK] Tests que pasan por la razón correcta.** El e2e bastonea/tipea de verdad y verifica el
  reject (otro-campo NO carga; ambiguo NO elige) y el path real (found→carga, unknown→alta precargada).

## Reconciliación de specs (paso 9)
- `tasks.md` — M2.1 partido en M2.1-spike `[x]` / M2.1-core `[x]` (as-built + tests) / M2.1-edge `[ ]`
  (R4.2/R4.7/R4.4-UI, justificado). T2.12 actualizado (spec 09 integrada → Gate 2 verifica la delegación al
  alta as-built, sin migración).
- `design.md` — §1.1 y §5: la suspensión del listener global (R3.2) reconciliada al as-built (supresión por
  RUTA del overlay + listener manga-owned, NO `disableListener()`, con el porqué).
- `requirements.md` — nota de reconciliación bajo R4.1 (el alta delega a `/crear-animal`; el "continuar el
  wizard para ese animal" sin re-identificar es mejora de M2.2; el precargado + rodeo de contexto + alta
  cross-tenant-safe SÍ se cumplen).
- NO se tocaron los EARS por gusto; solo la nota de reconciliación + el split de tasks.

## R3.2 — cómo quedó la suspensión del listener global
El `FindOrCreateOverlay` global (host del bastón en la raíz) ya se SUPRIME por ruta para la asignación
masiva (`asignar-caravanas`). Generalicé eso a `BLE_OWNED_ROUTES = { 'asignar-caravanas', 'maniobra' }`:
mientras `segments[0] === 'maniobra'`, el `onTagRead` del overlay early-returns → NO abre nada por un
bastoneo. La pantalla `maniobra/identificar` monta su PROPIO `useBleStickListener({ enabled:true, onTagRead })`
→ es el ÚNICO consumidor efectivo de la lectura en la manga. **Por qué por-ruta y NO `disableListener()`**:
`disableListener()` apaga el transporte (`transport.disable()` → el mock no propaga) → la manga tampoco
recibiría la lectura; y dos consumidores con `enabled` propio competirían. Suprimir el overlay por ruta +
listener manga-owned deja el transporte escuchando y un solo consumidor efectivo. Al SALIR de la manga
(`segments[0] !== 'maniobra'`), el overlay vuelve a procesar bastoneos (su efecto cierra un sheet stale si
quedó abierto). Verificado: no quedan dos consumidores compitiendo (el overlay retorna temprano por ruta).

## Diferido a M2.1-edge (NO se hace en core; queda safe + anotado)
- R4.2 — desambiguación manual de `visual_id_alt` multi-candidato (estado seguro + TODO).
- R4.7 — heurística de rodeo de jornada mal elegido (primeros ~3 de otro rodeo).
- R4.4 — pasar/saltar a otro rodeo del mismo establecimiento: el core resuelve EDIT directo (mismo campo);
  el aviso/acción de "otro rodeo mismo sistema" se evalúa en el frame de carga (M2.2) — ver nota más abajo.
