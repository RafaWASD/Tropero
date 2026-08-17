# review — delta `ios-ble-mfi`, **Fase F1** (T1.1 … T1.9)

**Veredicto: CHANGES_REQUESTED** (1 🔴 bloqueante · 3 🟡 · 3 ⚪).
**Fecha**: 2026-08-17. **Revisor**: reviewer. **HEAD al revisar**: `80c7022` (el baseline del implementer,
`b28bfe3`, quedó un commit atrás: la otra terminal commiteó *rebrand fase 4*, que **no tocó ningún archivo de
F1** — verificado con `git diff --name-only b28bfe3..HEAD -- app/src/services/ble app/app/baston-test.tsx
scripts/run-tests.mjs` → **vacío**).
**Nada está commiteado**: se revisó el árbol de trabajo.

> El código as-built de F1 es **correcto**: no encontré ningún bug vivo. El bloqueante es de **oráculo**, no de
> comportamiento: escribí un mutante propio que **reintroduce en producción el fallback que RBM1.4 prohíbe** y
> **los dos guards quedan en verde** (233/233) **con `tsc --noEmit` EXIT=0**. RBM1.7 pide literalmente un guard
> que falle "si el provider deja de resolver el parser por el driver"; el que hay falla sólo ante **tres
> grafías conocidas**, no ante el invariante.

---

## 0. Evidencia EJECUTADA (lo que corrí y vi, separado de lo que leí)

| Qué | Comando | Resultado |
|---|---|---|
| Typecheck | `app/node_modules/.bin/tsc -p app/tsconfig.json --noEmit` | **EXIT=0** ✅ |
| Suites BLE (11 archivos, incluye las 5 de regresión de RBM1.5 + la nueva) | `node --import ./scripts/ts-ext-resolver.mjs --test <11 suites>` | **233 / 233, 0 fail** ✅ |
| `check.mjs` COMPLETO (typecheck + client units + las suites contra la DB remota) | `node scripts/check.mjs` | **EXIT=0 — "All tests passed" / "Entorno listo"** ✅ |
| Re-run post-mutantes (que el árbol quedó restaurado) | mismas 11 suites | **233 / 233, 0 fail** ✅ |
| Gate 1 ATRIBUIBLE | `git status --porcelain supabase/ sync-streams/` | 11 líneas bajo `supabase/`, **0 nuestras**; `sync-streams/` **vacío** ✅ (detalle en §5) |
| Enumeración de call sites en TODO el árbol | ripgrep de `ingestRawLine`/`processRawLine`, `--hidden -g '!node_modules'` | **2 de producción + 4 archivos de test, todos migrados; cero huérfanos** ✅ |
| Spec 09 intacta (RBM9.6) | `git status --porcelain app/src/features/animals` | **0 líneas** ✅ |

**Lo que NO corrí, dicho y no barrido**: Playwright (`pnpm e2e`, ~38 min, es Gate 2.5 del leader) y device.
Comparto el argumento de riesgo bajo del implementer y lo verifiqué en el código, no sólo lo acepté: la E2E
corre en web con `mock`/`manual`/`simulator`, los tres de modo `'eid'` en `ADAPTER_INGEST_MODE`
(`adapter-selection.ts:89-99`) → van por `processEid`, camino **no tocado** por F1
(`BleStickListenerProvider.tsx:271-273`).

---

## 1. 🔴 BLOQUEANTE — el guard del provider vigila **tres nombres de hoy**, no el invariante (RBM1.7)

**Archivo**: `app/src/services/ble/adapter-ingest-mode.test.ts:124-175` (guard ii) ·
**superficie que vigila**: `app/src/services/ble/BleStickListenerProvider.tsx:135-143` (`readSourceFor`).

El guard prohíbe en el provider exactamente tres grafías (`:141-154`): `parseRs420Line`, importar un
`./parser-*`, y `RS420_DRIVER`. Todo lo demás pasa. Y **`readSourceFor` no tiene un solo oráculo de
comportamiento**: no está exportada, `wiring.test.ts:125-129` sólo ejecuta el *payload* del log
(`assert.doesNotThrow(() => logTransportEvent(...))`), y el bloque (A) de `frame-parser-resolve.test.ts:61-129`
prueba `resolveFrameParser` **suelta**, nunca el camino del provider.

### El mutante que lo demuestra (**mío, no está en la tabla del implementer**)

En `BleStickListenerProvider.tsx`: agregar `import { DRIVER_REGISTRY } from './driver-registry';` y en
`readSourceFor` cambiar el campo por

    frameParser:
      resolveFrameParser(adapter, (adapterKind) =>
        logTransportEvent({ kind: 'parser_unresolved', adapter: adapterKind, at: 'mount' }),
      ) ?? DRIVER_REGISTRY[0].frameParser,   // <- el fabricante vuelve a quedar FIJADO en produccion

**Corrido, no razonado** (`MR1b`, aplicado y **revertido** con restore en `finally`; árbol verificado igual
después):

| Oráculo | Con MR1b puesto |
|---|---|
| `tsc -p app/tsconfig.json --noEmit` | **EXIT=0** (compila: es un mutante legítimo, no un typo) |
| Guard (ii) `adapter-ingest-mode.test.ts` | 🟢 (no nombra `RS420_DRIVER` ni `parseRs420Line`, no importa `parser-*`, sigue llamando `resolveFrameParser(`, y los dos `at:'mount'`/`at:'read'` siguen en el fuente) |
| Guard (i) `frame-parser-resolve.test.ts` | 🟢 (`contract.ts` intacto) |
| Bloque (A) fail-closed + (B) aditividad | 🟢 (prueban `resolveFrameParser`, no el provider) |
| **Las 11 suites BLE juntas** | **🟢 233 / 233, 0 fail** |

**Qué rompe el mutante, en producción**: un adaptador de modo `'raw-line'` sin `ReaderDriver` (o con un
`frameParser` roto) **ingiere igual, con el parser del RS420** — el fallback silencioso que RBM1.4 prohíbe
textualmente. Y queda peor que antes de F1: el log `parser_unresolved{at:'mount'}` **sigue emitiéndose**
mientras la ingesta continúa, y la rama `at:'read'` (`:266-268`) queda inalcanzable. Es la quinta grafía de la
misma clase de bug de esta feature; el implementer ya tapó la cuarta (su M5, `RS420_DRIVER.frameParser`)
**agregando un nombre más a la lista de prohibidos** en vez de escribir el guard sobre la ausencia — que es
exactamente lo que sí hizo, y bien, para el guard (i) (`frame-parser-resolve.test.ts:232-242` deriva los
nombres del árbol).

**Cambio requerido** (chico, ~30 líneas): darle a `readSourceFor` un oráculo **de comportamiento**.
Mover la función a `adapter-selection.ts` (es pura: `kind` + `ingestModeFor` + `resolveFrameParser`) o
exportarla, y agregar a `frame-parser-resolve.test.ts` un test que fije el invariante por **identidad**:

- `readSourceFor({ kind:'spp-android' }, sink)` → `{ mode:'raw-line', frameParser: null }` **y** `sink`
  llamado una vez → mata MR1b y **toda** grafía futura del fallback;
- `readSourceFor({ kind:'spp-android', driver: SINTETICO }, sink)` → `frameParser === SINTETICO.frameParser`
  (identidad, no `assert.ok`) **y** `sink` sin llamar;
- `readSourceFor({ kind:'manual' }, sink)` → `{ mode:'eid', frameParser: null }` sin aviso.

Con eso el guard estático de `adapter-ingest-mode.test.ts` puede quedarse como red barata, pero deja de ser el
**único** oráculo. **Y falsificalo con MR1b**: si el test nuevo no cae con ese mutante puesto, no sirve.

---

## 2. 🟡 `parse_failed` mete en la misma bolsa "el parser del driver EXPLOTÓ" y "la trama vino mal"

**Archivo**: `app/src/services/ble/contract.ts:60-68`.

Lo primero que verifiqué es si el `try/catch` nuevo **se traga el error en silencio**. **No**: el `catch`
devuelve `{ ok:false, reason:'parse_failed' }` y el provider lo loguea en
`BleStickListenerProvider.tsx:296-299` (`eid_rejected{reason:'parse_failed'}`), y además dispara el feedback
sensorial de rechazo — leí `classifyReadOutcome` (`feedback-logic.ts:68-76`): un `{rejected}` clasifica
`'rejected'` → háptica de error + doble pip grave. O sea que el modo de falla que RBM1.4 nombra (**silencio**
indistinguible de "el operario no está bastoneando") **no se produce**: el operario recibe señal en cada
bastonazo y el log deja rastro por lectura. Y **sí** es distinguible del descarte por parser-no-resuelto
(`parser_unresolved` ≠ `eid_rejected`), que es lo que se me pidió chequear.

Lo que queda perdido es la otra distinción: **un driver de tercero cuyo `parse` tira** produce un log
byte-idéntico al de una trama corrupta del lector. Con un lector nuevo eso es justamente el diagnóstico que
importa ("¿el bastón manda basura o el driver que escribimos está roto?").

**No es bloqueante** (el design §3 nota 5 y la nota as-built de T1.2 declaran "se rechaza como `parse_failed`",
así que spec y código coinciden — no hay spec mintiendo). **Recomendación**: `RejectReason` +=
`'parser_threw'`, propagado al `eid_rejected` de `logging.ts:18`. Es una fila más en un union que ya distingue
tres motivos por este mismo criterio.

## 3. 🟡 El informe verificó Gate 1 con el oráculo que la spec PROHÍBE, y lo que afirma es falso hoy

`progress/impl_ios-ble-mfi-f1.md:12-13` y `:188` dicen: *"`git diff --stat supabase/ sync-streams/` →
**vacío**"*. RBM9.2 y T8.8 prohíben ese comando por escrito ("mide el ÁRBOL, no el cambio… es CIEGO a los
untracked"). **Corrido**: `git diff --stat supabase/ sync-streams/` hoy devuelve **8 archivos, 166
inserciones** — la afirmación del informe es falsa tal como está escrita. Y el untracked
`?? supabase/migrations/0133_rename_audit_headers_mitropero.sql`, que ese comando no ve, es el caso exacto que
la spec cita.

**La conclusión igual se sostiene**, verificada por mí con el oráculo correcto (§6, fila RBM9.1/9.2). Lo que
hay que corregir es el informe: reemplazar esa línea por el `git status --porcelain` cruzado contra la lista
de archivos.

## 4. 🟡 `design-ios-ble-mfi.md:79` quedó con la firma vieja de `resolveFrameParser`

La fila de `adapter-selection.ts` en §2.2 sigue diciendo `resolveFrameParser(adapter)` (un parámetro),
mientras el as-built es `resolveFrameParser(adapter, onUnresolved)` y §3 lo reconcilia en detalle
(`:126-131`, `:137`). Dos lugares del mismo documento dicen cosas distintas, y el que un lector consulta
primero (la tabla de archivos) es el que quedó viejo. Corregir la fila.

## 5. ⚪ Nits (no bloquean)

- `app/src/services/ble/stick-adapter.ts:44` — el bloque de doc que F1 reescribió cierra con *"(ver
  `contract.ingestFromAdapter`)"*. **Corrido**: ripgrep de `ingestFromAdapter` en `app/` → **1 sola
  ocurrencia, la del propio comentario**. La función no existe. Es preexistente, pero está dentro de las
  líneas que F1 tocó.
- `app/app/baston-test.tsx:192` — el harness descarta el `{rejected}` **sin log** (`return` pelado), así que
  ahí un parser que tira sí es silencio puro. Preexistente y es pantalla de dev; lo anoto porque el harness
  ahora dice explícitamente que "no puede tener su propia regla" (`:176-178`) y ésta la tiene.
- La resolución del parser **en el mount** (decisión as-built 4) es correcta **porque `driver` es inmutable
  por instancia** (`readonly` + inyectado por constructor: `adapter-spp-android.ts:429,485` y
  `adapter-web-serial.ts:45,68`), y TS lo hace cumplir. **Para F3**: el adapter BLE conoce el driver recién
  cuando el operario **elige el device en el escaneo**; si esa elección no fuerza una instancia nueva (y por
  lo tanto un re-cableado del efecto), el `ReadSource` queda con el parser viejo y el transporte nuevo nace
  mudo. Nada lo guarda hoy. Anotarlo en el design de F3.

---

## 6. Trazabilidad `RBM<n>` ↔ test (verificada archivo:línea, no copiada del informe)

| Req | Test(s) concreto(s) | Veredicto |
|---|---|---|
| **RBM1.1** el EID sale del `frameParser` del driver del adapter | `contract.test.ts:70` *"ingestRawLine usa EL PARSER QUE SE LE PASA"* (con contraprueba invertida en `:79`) · `frame-parser-resolve.test.ts:107` *"devuelve EXACTAMENTE el frameParser de ESE driver"* (**identidad**, no `ok`) | ✅ |
| **RBM1.2** `contract.ts` no importa ni invoca un parser de fabricante; entra por parámetro | `frame-parser-resolve.test.ts:252` (GUARD i) + su **meta-test** `:244` + la prohibición del default `:276-281` · lo falsifiqué yo con **MR3** y **MR3b** (§7) | ✅ |
| **RBM1.3** driver expuesto de forma aditiva, sin tocar métodos | `adapter-spp-android.test.ts:312` · `adapter-web-serial.test.ts:79` (los dos por identidad) · "ningún método cambió" lo verifiqué leyendo el diff de `stick-adapter.ts` (sólo `+ readonly driver?: ReaderDriver`) | ✅ |
| **RBM1.4** fail-closed con log, sin parser por defecto | `frame-parser-resolve.test.ts:61` (exhaustivo + **anti-vacuidad** `:65`), `:81` (contraprueba explícita del fallback a RS420), `:89` (kinds `eid` → null **sin** aviso), `:120` (`frameParser` sin `parse`) · `adapter-ingest-mode.test.ts:165-174` (log en los DOS momentos) · `wiring.test.ts:128-129` (el payload se ejecuta) | ⚠️ **cubierto para `resolveFrameParser`; NO para el camino del provider** → §1 |
| **RBM1.5** regresión `web-serial` / `spp-android` | **Corrido**: `contract.test.ts` 21/21 · `adapter-web-serial.test.ts` 10/10 · `adapter-spp-android.test.ts` 103/103 · `offline-noread.test.ts` 3/3. Leí el diff de los cuatro: **ninguna aserción vieja se debilitó**, sólo se les pasa `RS420_PARSER` (= `RS420_DRIVER.frameParser`, el mismo `parseRs420Line` de antes) | ✅ |
| **RBM1.6** aditividad real de otro formato de trama | `frame-parser-resolve.test.ts:171` (registro → resolución → contrato → dedup → commit) + la **contraprueba de que los dos formatos son distintos** `:159` + el aislamiento del registry de producción `:214` | ✅ |
| **RBM1.7** guard falsificado mutando lo que vigila | Mitad `contract.ts`: ✅ (7 mutantes del implementer + mis MR3/MR3b). Mitad **provider**: ❌ **MR1b lo deja en verde** | ❌ → §1 |
| **RBM1.8** `isValidTag` + dedup + gate de confirmación sobre todo EID | `contract.test.ts:81` (parser "flojo" → `invalid_eid`) · `frame-parser-resolve.test.ts:200` (dedup + `isValidTag` con el driver nuevo) · `:189` (`commit` → `tag_read`) | ✅ |
| **RBM9.1 / RBM9.2** Gate 1 N/A, ATRIBUIBLE | **Corrido por mí**: `git status --porcelain supabase/ sync-streams/` → 11 líneas bajo `supabase/` (`_shared/{cors,serve,supabase}.ts`, 4 EFs, `tests/audit/run.cjs`, `?? _shared/request-headers{,.test}.ts`, `?? migrations/0133_rename_audit_headers_mitropero.sql`) — **ninguna** está en la lista de 15 archivos de F1; todas son de la otra terminal (*rebrand fase 5 / headers*, corroborado por `?? progress/rebrand-fase5-headers.md` y por los `app/src/services/{account,members,push-notifications}.ts` + `request-id.ts` + `invitar.tsx` modificados). `sync-streams/` → **0 líneas** | ✅ (con el 🟡 de §3) |
| **RBM9.4** offline | `offline-noread.test.ts` 3/3 · leído: cero red en el grafo tocado | ✅ |
| **RBM9.5** la carga manual nunca se bloquea | `frame-parser-resolve.test.ts:89` — `manual` es kind `'eid'` → `null` **en silencio** → `processEid`: el fail-closed no puede tocar la puerta manual | ✅ |
| **RBM9.6** cero archivos de spec 09 / ningún método de `StickAdapter` modificado | **Corrido**: `git status --porcelain app/src/features/animals` → vacío · diff de `stick-adapter.ts` leído: sólo un campo opcional agregado | ✅ |

## 7. Mutantes que corrí YO (además de los 7 del implementer). Todos aplicados y **revertidos**

| # | Mutante | tsc | Suites BLE | Quién lo mata |
|---|---|---|---|---|
| **MR1** | provider: `?? DRIVER_REGISTRY[0].frameParser` **sin** el import | — | 🟢 233/0 | nadie (descartado como no-mutante: no compilaría) |
| **MR1b** | idem **con** el import (mutante legítimo) | **EXIT=0** | **🟢 233/0** | **NADIE** → 🔴 §1 |
| **MR3** | `contract.ts`: fallback vía `driver-rs420` (**no** nombra ningún `parser-*`), sustituyendo la llamada | EXIT=0 | 🔴 231/2 | guard (i) por su aserción `frameParser.parse(` + `contract.test.ts:104` |
| **MR3b** | `contract.ts`: fallback a `RS420_DRIVER.frameParser` **conservando** la llamada literal `frameParser.parse(` | EXIT=0 | 🔴 231/2 | `contract.test.ts:70` (RBM1.1) y `:115` (forma inesperada) — **no** el guard estático |

Dos lecturas de MR3/MR3b que valen para el informe: (a) el guard (i) **tiene el mismo agujero de familia** que
el (ii) — `vendorParserExports()` (`frame-parser-resolve.test.ts:232`) sólo escanea `parser-*.ts`, así que un
fallback importado de `driver-rs420.ts` **no cae por el nombre**; (b) en `contract.ts` eso no importa porque
hay **oráculos de comportamiento** que lo matan igual (`contract.test.ts:70,104,115`). Es exactamente la
diferencia con el provider, donde esos oráculos **no existen**. Restauración verificada: `git diff --stat` de
los dos archivos idéntico al de antes (87 y 71 líneas) y re-run **233/233**.

## 8. Tasks

**Completas: SÍ.** T1.1 … T1.9 todas `[x]` en `tasks-ios-ble-mfi.md:48-64`, cada una con su nota **(as-built)**
donde el as-built se apartó del plan. Ningún `[ ]` de F1. Las fases F0/F2…F8 quedan `[ ]` **por despacho**
(esta unidad era sólo F1) — no cuentan como task pendiente de este review.

Chequeo específico de las que más fácil se dan por hechas:

- **T1.9** (el typecheck ENUMERA los call sites) — verificado de forma independiente: ripgrep sobre **todo el
  árbol** (incluidos los `.test.ts` que `app/tsconfig.json` excluye) da exactamente
  `BleStickListenerProvider.tsx:270`, `baston-test.tsx:190`, `contract.test.ts`, `adapter-web-serial.test.ts`,
  `offline-noread.test.ts` y `frame-parser-resolve.test.ts`. **Cero huérfanos**: el barrido a mano del
  implementer fue completo.
- **T1.3** (sink inyectado y requerido) — enumerados **todos** los call sites de `resolveFrameParser`:
  `BleStickListenerProvider.tsx:139` (sink real → `logTransportEvent`), `baston-test.tsx:179` (sink real →
  `logTransportEvent`) y los tests (espía que registra los kinds). **Ningún no-op**, ni con default.
- **T1.8** (guards falsificados) — los 7 mutantes del informe son creíbles y los dos que importan los
  re-verifiqué por mi cuenta (§7). El que falta es el del provider (§1).

Nota de estado, no bloqueante: `feature_list.json` tiene `04-bluetooth-baston` en **`deferred`** (no
`in_progress`) y la única `in_progress` es la 24. El implementer lo declaró explícitamente
(`impl_ios-ble-mfi-f1.md:7-10`) y es el mismo patrón bajo el que se cerró el delta `multivendor` (`acec3cd`),
ADR-028 Nivel B. Lo acepto documentado.

## 9. CHECKPOINTS

- **C1** — [x] archivos base y docs presentes · [x] los 5 agentes · [x] `node scripts/check.mjs` **EXIT=0** (corrido).
- **C2** — [x] una sola feature `in_progress` (la 24) · [x] `progress/current.md` describe la sesión activa ·
  [x] la 04 en su estado declarado (`deferred`, delta ADR-028).
- **C3** — [x] capas respetadas: todo el código nuevo vive en `services/ble` (la capa de I/O) y las piezas
  puras (`resolveFrameParser`) quedan sin RN · [x] **cero deps nuevas** (F1 es puro; `react-native-ble-plx` es
  F2) · [x] sin logs de debug sueltos (el único `console.info` es el de `logging.ts`, canal declarado por R15) ·
  [x] cero `establishment_id`.
- **C4** — [x] test por módulo con lógica · [x] fixtures reales (las capturas de campo de `contract.test.ts`) ·
  [x] el runner muestra 233 > 0, todos verdes · [x] no toca RLS → cross-tenant N/A.
- **C5** — [x] `.gitignore` sano · [ ] `progress/history.md` **sin entrada de esta sesión** (es del leader al
  cerrar, no del implementer) · [x] estado de la feature correcto.
- **C6** — [x] los 3 archivos de spec existen (+ `context`) · [x] EARS estricto · [x] tasks de F1 `[x]` ·
  [ ] **cada `RBM<n>` cubierto por ≥1 test concreto: RBM1.7 NO lo está en su mitad del provider** (§1).
- **C7** — **N/A**: F1 no crea ni toca ninguna tabla (verificado con `git status --porcelain supabase/`).
- **C8** — [x] offline: el camino es local y puro, `offline-noread.test.ts` 3/3 corrido · conflict-resolution
  **N/A** (F1 no escribe nada; el EID entra al motor de spec 09, que no cambió).
- **C9** — **N/A**: F1 no toca ninguna superficie de UI. El único `.tsx` de producción es el provider (no
  renderiza nada propio) y el harness de dev `/baston-test`, cuyo layout no cambió (leí el diff: 2 imports +
  la resolución del parser + el guard de `null`, sin tocar un solo componente). Coincido con el N/A del
  implementer.

## 10. Checklist RAFAQ-específico

- **A. Multi-tenancy / RLS** — **N/A**. Cero tablas, cero policies, cero `establishment_id` en la superficie
  tocada. Verificado **ejecutando** `git status --porcelain supabase/ sync-streams/`, no leyendo la spec.
- **B. Offline-first** — parcialmente aplicable (es el camino de carga en campo, pero F1 no persiste nada):
  - [x] funciona offline: todo el camino (transporte → `resolveFrameParser` → contrato → dedup) es local y
    puro; `offline-noread.test.ts` 3/3 corrido.
  - N/A sync bucket / resolución de conflictos / repositorio SQLite: F1 no escribe en la base ni sincroniza.
- **C. BLE (Vesta, Allflex)** — **N/A en esta fase**. F1 no toca ningún transporte con radio: desconexión
  repentina, fallback manual en ≤1 tap y correlación TAG↔peso son F3/F6 y spec 05. Lo único adyacente que sí
  verifiqué: el piso manual sigue intacto (RBM9.5, §6) y los logs siguen siendo no bloqueantes
  (`logging.ts:96-112`, doble try/catch).
- **D. UI de campo** — **N/A**: F1 no cambia ninguna pantalla, ningún target ni ningún texto.
- **E. Edge Functions** — **N/A**: cero Edge Functions. Las de `supabase/functions` que aparecen modificadas en
  el árbol son de la otra terminal (§6, fila RBM9.1/9.2).

## 11. Cambios requeridos (concretos)

1. 🔴 **`app/src/services/ble/BleStickListenerProvider.tsx:135-143` + `adapter-ingest-mode.test.ts:124-175`** —
   exportar (o mover a `adapter-selection.ts`) `readSourceFor` y darle un oráculo **de comportamiento** en
   `frame-parser-resolve.test.ts`, con las tres aserciones de §1 (identidad del parser · `null` + `sink`
   llamado en el fail-closed · `'eid'` en silencio). **Falsificarlo con MR1b**
   (`?? DRIVER_REGISTRY[0].frameParser`) y dejar la constancia en la tabla de mutantes del informe: si con ese
   mutante el test nuevo no cae, no sirve.
2. 🟡 **`app/src/services/ble/contract.ts:63` + `logging.ts:18`** — separar `'parser_threw'` de
   `'parse_failed'` para que "el driver está roto" no se lea igual que "el lector mandó basura". Reconciliar
   la nota 5 de `design-ios-ble-mfi.md:141` y la nota as-built de `tasks-ios-ble-mfi.md:50`.
3. 🟡 **`progress/impl_ios-ble-mfi-f1.md:12-13` y `:188`** — reemplazar
   `git diff --stat supabase/ sync-streams/` → *"vacío"* (oráculo prohibido por RBM9.2/T8.8, y **falso** en el
   árbol de hoy) por el `git status --porcelain` cruzado contra la lista de archivos, nombrando de quién es
   cada línea ajena (el detalle está en §6 de este review, se puede copiar).
4. 🟡 **`specs/active/04-bluetooth-baston/design-ios-ble-mfi.md:79`** — la fila de `adapter-selection.ts` dice
   `resolveFrameParser(adapter)`; el as-built es `resolveFrameParser(adapter, onUnresolved)` (§3 ya lo
   reconcilia, §2.2 no).
5. ⚪ **`app/src/services/ble/stick-adapter.ts:44`** — sacar la referencia a `contract.ingestFromAdapter`, que
   no existe.
6. ⚪ **`app/app/baston-test.tsx:192`** — loguear el descarte por `{rejected}` (aunque sea `eid_rejected`),
   para que el harness deje de tener la regla propia que su propio comentario dice no tener.
7. ⚪ **design de F3** — dejar escrito que el `ReadSource` se resuelve en el **mount** y que eso sólo es
   correcto mientras `driver` sea inmutable por instancia de adapter: el adapter BLE conoce su driver recién
   al elegir el device en el escaneo.

---

**Re-review**: alcanza con el punto 1 verde (con su mutante falsificado) + los tres 🟡. Los ⚪ pueden ir en el
mismo commit o al backlog, a criterio del leader. Nada más de F1 está en discusión: el resto del changeset
—incluida la regresión de RBM1.5, la aditividad de RBM1.6 y el Gate 1 N/A— quedó verificado y verde.
