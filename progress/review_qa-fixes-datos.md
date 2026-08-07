# REVIEW — unidad «tres 🔴 de corrección de datos del QA de maniobras en device»

**Veredicto: CHANGES_REQUESTED**

Los **tres arreglos de producto (A.1, A.2, A.5) son correctos y los verifiqué EJECUTÁNDOLOS**, no leyéndolos.
Las **dos falsificaciones confesadas están reproducidas y efectivamente cerradas**. Lo que bloquea es una
tercera instancia de la MISMA clase que el implementer no encontró: **el guard de A.2 no detecta la forma
dominante de la duplicación que dice prohibir** — y esa afirmación ya quedó escrita como as-built en un spec.

Revisor: reviewer · 2026-08-07 · diff sin commitear · baseline `1922e0e`

---

## 0. Qué ejecuté (y qué no)

**EJECUTADO Y VISTO**
- `node scripts/check.mjs` → **RC=0**, typecheck verde, **client unit 2937/2937**, 0 fail en las 18 suites.
  Confirma el claim del implementer.
- `node scripts/check-hardcode.mjs` → 0 violaciones.
- Las 11 suites unit que la unidad toca, juntas: **400/400** (antes y DESPUÉS de restaurar mis mutantes).
- **Falsificación #1 reproducida**: guard roto → 4 mutantes VIVOS; guard entregado → 4 mutantes MUERTOS.
- **Falsificación #2 reproducida**: build del dist con los tres fixes REVERTIDOS → **5/5 E2E ROJO**, cada una
  en su oráculo específico. Árbol restaurado → **5/5 VERDE (37,8 s)**.
- **A.1 contra SQLite REAL**: el SQL que generan `buildSearchByIdvQuery` / `buildSearchLikeQuery`, ejecutado
  con `node:sqlite` sobre un fixture con los dos homónimos, y el resultado pasado por el
  `resolveManualIdentify` REAL.
- **~40 mutantes propios** (A.2 x14, A.5 x9, A.1 x12, + el revert literal pre-fix de los 12 archivos).

**NO VERIFICADO**
- El A07 (device). El pliego lo prohibía; A.2 en el teléfono real sigue dependiendo del reloj del device.
- La suite E2E COMPLETA (~38 min) y su baseline: el árbol tiene la otra unidad en vuelo (creció de 46 a 49
  archivos modificados DURANTE esta revisión). Solo corrí `qa-fixes-datos.spec.ts`.
- Las 86 filas corridas en DEV (el pliego lo excluyó explícitamente).

---

## 1. 🔴 BLOQUEANTE — el guard de A.2 no ve la forma dominante de la duplicación

### La medición

Revertí, **uno por uno**, los 12 archivos a su estado **PRE-FIX literal** (`git checkout --`) y corrí
`today-iso-guard.test.ts`. Si el guard "va sobre la ausencia", los 12 tienen que dar ROJO:

| archivo revertido al pre-fix | guard |
|---|---|
| `app/app/agregar-evento.tsx` | **VERDE — no lo ve** |
| `app/app/animal/baja.tsx` | **VERDE — no lo ve** |
| `app/app/crear-animal.tsx` | **VERDE — no lo ve** |
| `app/app/lote/venta.tsx` | **VERDE — no lo ve** |
| `app/src/components/TreatmentStartSheet.tsx` | **VERDE — no lo ve** |
| `app/src/components/TreatmentApplicationSheet.tsx` | **VERDE — no lo ve** |
| `app/src/utils/link-calf-query.ts` | **VERDE — no lo ve** |
| `app/src/utils/animal-birth-year.ts` | ROJO OK |
| `app/app/maniobra/carga.tsx` | ROJO OK (regla A) |
| `app/app/seleccion-masiva.tsx` | ROJO OK (regla A) |
| `app/app/vacunacion-masiva.tsx` | ROJO OK (regla A) |
| `app/src/utils/maneuver-category-preview.ts` | ROJO OK (regla A) |

**7 de 12.** Las 4 copias UTC las caza la regla A. De las 8 "correctas pero duplicadas" —que son justo las
que la **regla B** existe para cazar— la regla B ve **una**.

### La causa exacta

`app/src/utils/today-iso-guard.test.ts:78-82,167-175` — la ventana **arranca en `getFullYear()` y mira 400
chars hacia adelante**, exigiendo `getDate()` ahí adentro:

```ts
const YEAR_GETTER = /getFullYear\(\)/g;
const DAY_GETTER  = /getDate\(\)/;
const COMPOSE_WINDOW = 400;
for (const idx of allMatches(code, YEAR_GETTER)) {
  const window = code.slice(idx, idx + COMPOSE_WINDOW);   // <-- solo HACIA ADELANTE
  if (DAY_GETTER.test(window) && DASH_SPLICE.test(window)) out.push(idx);
}
```

La forma que realmente tenía el repo pone `mm`/`dd` en consts **antes** y deja `getFullYear()` en el template
final, así que `getDate()` queda **atrás** de la ventana:

```ts
function todayIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');   // <-- ATRÁS de la ventana
  return `${d.getFullYear()}-${mm}-${dd}`;
}
```

Verificado corriendo `composedDates()` aislada: el fixture del guard (año primero) da **1 hit**; el cuerpo
real del repo da **0**. Y **la propia fuente canónica `today-iso.ts` tiene esa forma** — está exenta, por eso
nadie lo notó.

### Mutantes propios que SOBREVIVEN (archivo nuevo, guard verde)

| # | mutante | resultado |
|---|---|---|
| RX4 | el helper viejo con **otro nombre**, en un **archivo nuevo** (la forma literal de los 7) | **VERDE** |
| RX5 | el ISO a una variable primero, y recién después el recorte | **VERDE** |
| RX6 | `toJSON()` en vez de `toISOString()` (alias exacto) | **VERDE** |
| RX7 | el guion desde una const de módulo | **VERDE** |
| RX8 | `getUTCFullYear` / `getUTCMonth` / `getUTCDate` compuestos a mano = **EL bug con getters** | **VERDE** |
| RX1/RX2/RX3 | UTC directo, en helper, y en una pantalla nueva de `app/app` | ROJO OK |
| RX9/RX10 | controles en verde (instante entero; consumir la fuente canónica) | VERDE OK |
| RY1-RY4 | la fuente canónica pasada a UTC / desplazada 3 h / mes sin +1 / sin padStart | ROJO OK |

El pliego fijó el criterio: *"Si alguno pasa verde, es 🔴"*. **RX4 —el caso que el pliego nombró
textualmente— pasa verde.**

### Y no es hipotético: la firma ya está ocupada en producción

`app/src/utils/animal-category.ts:211-217` (`isoUtcDate`) + `:630-632` (`startOfDay`) componen un
`AAAA-MM-DD` desde getters **UTC** sobre un `new Date()` real, dentro del árbol que el guard escanea, y el
guard no los ve (clase RX8). Es el espejo C6 que alimenta la categoría derivada de la lista y de
`searchAnimals`. No lo declaro bug de esta unidad: lo declaro **prueba de que el punto ciego está habitado hoy**.

### Por qué bloquea

1. Es el criterio explícito del pliego.
2. **El claim ya se escribió como AS-BUILT en un spec**: `specs/active/03-modo-maniobras/requirements.md`,
   nota bajo **R5.11** — *"un guard app-wide … prohíbe derivar una fecha date-only en cualquier otro lado …
   así que el próximo call site nace en rojo"*. Es falso para la forma dominante. Spec mintiendo ⇒
   CHANGES_REQUESTED por la regla dura de exactitud de specs. Ídem `today-iso.ts:17-19` y el header del guard.
3. **Es la misma clase que la falsificación confesada.** El implementer cerró "la regex y su fixture comparten
   el error" y dejó abierto "los fixtures se escribieron de memoria en vez de sacarse del código que el guard
   existe para prohibir". Si el fixture de la regla B hubiera sido el cuerpo literal de
   `git show 1922e0e:app/app/agregar-evento.tsx`, el agujero salía en la primera corrida.

---

## 2. Lo que SÍ está verificado (y quedó bien)

### 2.1 Falsificación #1 — REPRODUCIDA, y el arreglo es real

Volví el guard a su estado roto (una sola constante, regex con el `String` de más, fixture derivado del mismo
error, sin el assert de alineamiento) y lancé los 4 mutantes sobre `carga.tsx`:

| mutante | guard ROTO | guard ENTREGADO |
|---|---|---|
| M1 el bug original, recorte con slice | **VERDE 11/11** | ROJO |
| M2 el mismo bug con substring | **VERDE 11/11** | ROJO |
| M3 el mismo bug con split | **VERDE 11/11** | ROJO |
| M4 partido en 3 líneas por el formatter | **VERDE 11/11** | ROJO |

La confesión es exacta y el arreglo (dos particiones distintas + el assert de igualdad) funciona: un
desalineamiento entre la regex y su fixture ya no se cancela solo.

### 2.2 Falsificación #2 — REPRODUCIDA, los E2E son oráculos de verdad

Buildeé el dist con los **tres fixes revertidos** y corrí la spec:

| test | resultado | falló en |
|---|---|---|
| A.1 buscador global | ROJO | "tipear «PERF-005002c46» tiene que encontrar a PERF-005002c46" |
| A.1 buscador del rodeo | ROJO | el target no aparece después de filtrar |
| A.1 manga | ROJO | `weight-display` nunca aparece (no auto-avanza) |
| A.5 ficha | ROJO | "318 kg · " no visible (ganó el 312 viejo) |
| A.2 vacunación 22:54 | ROJO | "la vacunación de las 22:54 se fecha el día LOCAL, no el UTC" |

**5/5 ROJO, cada una en SU aserción** (no un build roto: BUILD_RC=0). Con el árbol restaurado, **5/5 VERDE en
37,8 s**. El señuelo es load-bearing.

### 2.3 A.1 — ejecutado contra un SQLite REAL (el SQL del repo, no un espejo)

Levanté `node:sqlite`, armé el esquema que la query necesita, sembré `PERF-00500` **y** `PERF00500` como dos
animales distintos, ejecuté el SQL **generado por el repo** y pasé las filas por el `resolveManualIdentify`
**real**:

- **Las 10 filas del barrido del QA encuentran al animal** (las 6 que estaban en rojo, incluidas `PERF-00500`,
  `perf-00500` y `F-005`).
- **El efecto colateral es el declarado, y lo confirmé**: con los dos homónimos coexistiendo, tipear
  `PERF-00500`, `PERF00500` o `perf-00500` devuelve **los dos**, `resolveManualIdentify` → **ambiguous**, los
  dos van al picker con su caravana, **cero auto-avance**. **No se funden.**
- **Sin homónimo, la caravana tipeada exacta AUTO-AVANZA** → el camino rápido de la manga, intacto.
- **No se volvió comodín**: un término de puro separador devuelve **0 filas** (el patrón que traía toda la
  tabla, cerrado).
- **Cero fuga cross-tenant**: el animal homónimo de otro campo nunca sale (el filtro de `establishment_id`
  sigue en las dos ramas del UNION — verificado en el SQL generado y ejecutando).
- **Canal TAG intacto** y **filtro de borrado/status intacto**.
- **Las TRES superficies**: barrí el árbol — existen **exactamente dos** motores (`searchAnimals`,
  `searchGroupAnimals`) y los dos están arreglados. No hay una cuarta.

**Mutantes A.1: 12 lanzados, 11 muertos + 1 control verde.** Incluye un tercer motor nuevo con destructuring:
el guard **falla cerrado**, ROJO.

### 2.4 A.5 — el criterio es el que ya tenía la rama repro, y no quedan ramas sueltas

- `isNewerItem` es el extraído de `isNewerRepro` (seq → createdAt null-as-newest → eventId), no uno nuevo.
  Verificado línea por línea contra el `isNewerRepro` borrado.
- Barrido de ramas con desempate por UUID: `deriveReproAptitude` ya tenía la escalera; la CE desempata en SQL;
  `sortTimelineItems` tiene la suya con `seq` antes del id. **No queda ninguna.**
- **Mutantes A.5: 9.** Mueren los que importan: volver al eventId, dar vuelta la escalera, un segundo
  comparador para una rama, una rama nueva sin declarar, la **escalera decorativa** (menciona seq/createdAt
  pero decide por id) y renombrar el comparador.

### 2.5 A.2 — semántica por call site: SÍ la revisó caso por caso

- Los `toISOString()` de **instantes reales** (`createdAt` en `carga.tsx:621`, `deleted_at`, `lastSyncedAt`)
  **no se tocaron**. Correcto.
- Cero recortes de `toISOString()` en producción (`app/app` + `app/src`) — solo en tests y en `e2e/`.
- **`maneuver-category-preview.ts`** (el que el pliego marcó): el único caller de producción es
  `app/maniobra/carga.tsx:503` y **no pasa `today`** ⇒ es un instante real ⇒ convertirlo al día LOCAL es lo
  correcto, y ahora el preview razona sobre el MISMO día que `carga.tsx` persiste. No fue reemplazo a ciegas.

---

## 3. Hallazgos no bloqueantes

**🟠 3.1 — el informe declara un cross-reference que no existe.** `today-iso.ts:26` dice "cada módulo apunta
al otro"; `format-date-es-ar.ts` **no menciona** `today-iso` ni `todayIsoLocal` (grep = 0). Y la regla nueva
—app-wide, con guard— **no se escribió en `docs/conventions.md`**, que es donde vive su hermana TZ-safe
(líneas 35-38). Por la jerarquía de verdad, una regla app-wide no puede vivir solo en un comentario.

**🟡 3.2 — conteo contradictorio dentro del propio entregable.** `today-iso.ts:5` y
`today-iso-guard.test.ts:5` dicen **"NUEVE veces"**; el informe §1 y la reconciliación de spec 03 dicen
**"doce"**. Y `today-iso-guard.test.ts:70` dice "8 de las 9 copias devolvían el valor bien … el error se coló
en las otras 4" → 8+4=12, no 9.

**🟡 3.3 — el test "evaluado, no leído" de A.1 no evalúa el predicado.** El caso
"A.1 el predicado compactado ENCUENTRA lo que el bug no encontraba" de `local-reads.test.ts` corre un
**espejo en JS escrito a mano**, no el SQL. Si los args del REPLACE se invirtieran, el espejo seguiría verde
(lo salva el assert de TEXTO de arriba). Misma familia, en versión suave. **Yo cerré ese hueco por afuera**
ejecutando el SQL real contra SQLite (§2.3), pero el oráculo debería estar en el repo.

**🟡 3.4 — evasiones del guard de A.5 (menores).** Una rama nueva declarada pasando el kind a una variable, o
con `==`, o con comillas dobles, no la ve `handledKinds()`. La forma idiomática (la que Prettier/ESLint
imponen) sí. No bloquea.

**⚪ 3.5 — `app/e2e/helpers/admin.ts:974,1000`** siembran `event_date` derivándolo en UTC. Está fuera de los
ROOTS del guard, pero es la misma clase, en el helper que siembra los datos que los E2E asertan: una corrida
nocturna siembra con fecha de mañana.

**⚪ 3.6 — las dos mitades del preview usan convenciones de día distintas.** El `eventDate` sintético pasó a
día LOCAL, pero `computeCategoryCode` sigue comparando contra `startOfDay(today)` en **UTC**
(`animal-category.ts:631`). Después de las 21:00 AR razonan sobre días distintos. Preexistente, display-only.

**⚪ 3.7 — contrato público.** `link-calf-query.ts` dejó de exportar `todayIsoLocal`: cero consumidores
huérfanos (verificado). El cambio está marcado en el informe §12.2, como pide `CLAUDE.md`. Sin objeción.

---

## 4. Trazabilidad — hallazgo ↔ test concreto (verificada corriendo)

| hallazgo | test que lo verifica | ¿lo verifiqué? |
|---|---|---|
| **A.1** plan (par de términos) | `animal-identifier.test.ts` — 5 casos A.1 | SÍ, corridos + 12 mutantes |
| A.1 SQL (columna compactada) | `local-reads.test.ts` — 3 casos A.1 | SÍ + SQLite real (§2.3) |
| A.1 wiring (los motores) | `search-idv-wiring-guard.test.ts` — 5 casos | SÍ, mutante de 3er motor |
| A.1 colateral (colisión → picker) | `maniobra-identify.test.ts` — 3 casos A.1 | SÍ + ejecutado sobre SQLite |
| A.1 end-to-end x3 superficies | `e2e/qa-fixes-datos.spec.ts` — 3 tests | SÍ: 3/3 verde · 3/3 rojo con el bug |
| **A.2** valor de la función | `today-iso.test.ts` — 4 tests (contrafactual TZ-consciente) | SÍ + 4 mutantes RY |
| A.2 clase (UTC) | `today-iso-guard.test.ts` regla A | SÍ mata M1-M4; **hueco RX5/RX6** |
| A.2 clase (duplicación local) | idem, regla B | **NO cubre la forma dominante — §1** |
| A.2 clase (locale) | idem, regla C | SÍ (sin uso en el árbol; regla gratis) |
| A.2 fuente viva | idem, test D | SÍ, RY1-RY4 mueren |
| A.2 end-to-end | `e2e/qa-fixes-datos.spec.ts` (reloj 22:54 + fila real del server) | SÍ verde/rojo |
| A.2 preview | `maneuver-category-preview.test.ts` | SÍ verde |
| **A.5** valor | `event-timeline.test.ts` — 7 casos A.5 | SÍ corridos |
| A.5 clase (todas las ramas) | `current-state-tiebreak-guard.test.ts` — 10 casos | SÍ, 9 mutantes |
| A.5 end-to-end | `e2e/qa-fixes-datos.spec.ts` | SÍ verde/rojo |

**Cobertura**: completa salvo la fila marcada.

---

## 5. Tasks

**No hay `tasks.md`**: la unidad es un bugfix dirigido por el pliego del leader, no una feature con spec
propio. **Justificación documentada** en el informe §9. Aceptado — no aplica el rechazo por tasks `[ ]`.

---

## 6. CHECKPOINTS

| # | checkpoint | estado |
|---|---|---|
| C1 | harness completo (AGENTS, feature_list, progress, docs, 5 agentes) | **[x]** |
| C1 | `node scripts/check.mjs` exit 0 | **[x]** RC=0 · 2937/2937 |
| C2 | como mucho una feature `in_progress` | **[x]** (ninguna) |
| C2 | toda feature `done` con tests que pasan | **[x]** |
| C3 | solo capas previstas (`utils/` para `today-iso.ts`, helper puro sin imports) | **[x]** |
| C3 | sin dependencias nuevas | **[x]** |
| C3 | sin logs de debug ni TODOs sueltos | **[x]** |
| C3 | `establishment_id` nunca hardcodeado | **[x]** verificado ejecutando el SQL |
| C4 | al menos un test por módulo con lógica | **[x]** |
| C4 | fixtures reales | **[x]** (el E2E de A.2 lee la fila real del server) |
| C4 | el runner muestra >0 tests, todos verdes | **[x]** |
| C4 | test cross-tenant si toca RLS | **N/A** (cero cambios en `supabase/`) |
| C5 | sin artefactos temporales sin trackear | **[x]** (`__shots__` gitignored; `design/` limpio) |
| C5 | entrada en `progress/history.md` de la sesión | **[ ]** la cierra el leader |
| C5 | la última feature en su estado correcto | **N/A** (bugfix sin feature) |
| C6 | los 3 archivos de spec por feature sdd | **N/A** (bugfix) |
| C6 | EARS estricto | **N/A** (notas de reconciliación, no EARS nuevo) |
| C6 | tasks `[x]` | **N/A** (§5) |
| C6 | cada `R<n>` con >=1 test | **[x]** salvo el hueco de §1 |
| C7 | tabla nueva / RLS / helpers / cross-tenant | **N/A** (sin migraciones) |
| C8 | funciona sin conexión | **[x]** búsqueda = SQLite local; `todayIsoLocal` pura; cero red nueva |
| C8 | bucket de PowerSync correcto | **N/A** (`git status sync-streams/` vacío → **Gate 1 N/A**) |
| C8 | conflict resolution documentada | **N/A** (no cambia el modelo de escritura) |
| C9 | suite E2E de regresión verde | **[x]** 5/5, y 5/5 roja con el bug |
| C9 | capture file con los estados clave | **[x]** `e2e/captures/qa-fixes-datos.capture.ts` (8 shots) |
| C9 | Gate 2.5 corrido por el leader con las capturas a la vista | **[ ]** pendiente del leader |
| C9 | los PNG NO commiteados | **[x]** (`app/.gitignore:29`) |

---

## 7. Checklist RAFAQ-específico

**A. Tablas con `establishment_id` / RLS — N/A.** Cero cambios en `supabase/`, `sync-streams/`, `powersync/`
(`git status` vacío). Lo que sí verifiqué, ejecutando: el scope de tenant sigue en **las dos ramas** del UNION
de las queries que la unidad tocó, y un animal homónimo de otro campo **nunca** sale.

**B. Carga/edición de datos en campo (offline-first)**
- [x] Funciona offline — la búsqueda sigue siendo 100 % SQLite local (`runLocalQuery`), `todayIsoLocal` es
      pura (cero imports), `deriveCurrentState` es pura. No se agregó ni un request.
- [x] Sync bucket correcto — sin delta de streams (N/A por ausencia).
- [x] Conflictos — sin cambios en el modelo de escritura. A.5 cambia el criterio de **lectura** del vigente,
      documentado y guardado por test.
- [x] No hay requests síncronos a Supabase desde pantalla — los 3 fixes viven en utils/services locales.

**C. BLE — N/A.** La unidad no toca `src/features/ble-stick/**` (los archivos BLE del árbol son de la OTRA
unidad en vuelo).

**D. UI de campo — N/A en lo estructural**: cero líneas de JSX. Lo que cambia es el **contenido** de tres
pantallas, cubierto por las 8 capturas del `.capture.ts` + los 5 E2E. El veto visual es del leader.

**E. Edge Functions — N/A.** Cero cambios en `supabase/functions/`.

---

## 8. Lista priorizada de cambios requeridos

| # | sev | qué | dónde |
|---|---|---|---|
| 1 | 🔴 | La **regla B** no detecta la forma dominante (mm/dd en consts antes del template): 7 de los 12 archivos, revertidos a su pre-fix literal, dejan el guard VERDE. Ventana solo hacia adelante desde `getFullYear()`. | `app/src/utils/today-iso-guard.test.ts:78-82,167-175` |
| 2 | 🔴 | Los **getters UTC** evaden las tres reglas — es EL bug escrito con getters, y la firma ya está ocupada en producción. | `today-iso-guard.test.ts:78-79` · ocurrencia: `app/src/utils/animal-category.ts:211-217,630-632` |
| 3 | 🔴 | La **regla A** exige el recorte pegado al `toISOString()`: evade la variable intermedia y el alias `toJSON()`. | `today-iso-guard.test.ts:66` |
| 4 | 🔴 | Los fixtures de "el guard DETECTA las firmas" se escribieron **a mano**; tienen que salir de los **cuerpos reales pre-fix** (`git show 1922e0e:<archivo>`). Es el arreglo estructural — sin él el patrón se repite en el próximo guard. | `today-iso-guard.test.ts:223-290` |
| 5 | 🔴 | **Spec mintiendo**: la nota as-built afirma que el guard hace que "el próximo call site nazca en rojo". Falso para la forma dominante. Reconciliar cuando 1-4 estén hechos (o achicar el claim al alcance real). | `specs/active/03-modo-maniobras/requirements.md` (nota bajo R5.11) · `today-iso.ts:17-19` · `today-iso-guard.test.ts:18-20` |
| 6 | 🟠 | Cross-reference declarado y ausente: `format-date-es-ar.ts` no apunta a `today-iso.ts`. Y la regla app-wide no está en `docs/conventions.md` (junto a la TZ-safe, líneas 35-38). | `today-iso.ts:26` · `docs/conventions.md` |
| 7 | 🟡 | "NUEVE veces" (código) vs "doce" (informe + specs); y "8 de las 9 copias … las otras 4". | `today-iso.ts:5` · `today-iso-guard.test.ts:5,70` |
| 8 | 🟡 | El test "evaluado, no leído" corre un espejo JS, no el predicado SQL. Se cierra ejecutando el SQL contra `node:sqlite` (disponible en Node 24). | `local-reads.test.ts`, caso "A.1 el predicado compactado ENCUENTRA…" |
| 9 | 🟡 | Evasiones del guard A.5 (kind a una variable, `==`, comillas dobles). | `current-state-tiebreak-guard.test.ts:79-84` |
| 10 | ⚪ | El seeder de E2E deriva `event_date` en UTC. | `app/e2e/helpers/admin.ts:974,1000` |
| 11 | ⚪ | El preview mezcla día LOCAL (evento sintético) con día UTC (`startOfDay`). Preexistente. | `maneuver-category-preview.ts:181` ↔ `animal-category.ts:631` |

**Lo que NO hay que tocar**: los tres fixes de producto. Están bien y verificados por ejecución.

---

## 9. Disciplina de la revisión (higiene del árbol)

- **Nada de `git add`.** Ningún commit. Ningún build de EAS. Device no usado.
- **Todos los mutantes restaurados y la restauración VERIFICADA**: `md5sum -c` de los 10 archivos respaldados
  → todos OK; `git status design/` → **vacío** antes y después; los archivos nuevos que creé para los mutantes
  → borrados; las 11 suites tocadas re-corridas al final: **400/400**.
- **Incidente, declarado**: en un intento de mutación hice `git checkout -- app/app/agregar-evento.tsx`
  **antes** de respaldarlo, destruyendo el cambio sin commitear del implementer. Lo **reconstruí** aplicando la
  transformación mecánica del diff que ya tenía capturado. Está **byte-idéntico**: el hash del blob
  post-imagen de git es `6f05594`, exactamente el del diff original. Sin residuo.
- **`app/dist`** quedó reconstruido por mí (el round de mutantes E2E lo dejó con el bug): lo **rebuildeé desde
  las fuentes restauradas**, RC=0.
- **Otra unidad en vuelo**: el árbol creció de 46 a **49** archivos modificados DURANTE la revisión, con
  untracked nuevos (`docs/adr/ADR-032-*`, `progress/repro_reportes-campanas-congeladas.md`,
  `app/app/(tabs)/reportes.tsx`). **No es mío.** No toqué `StickStatusIndicator.tsx`, `nav-target-bands*`,
  `tap-target-collision-guard*`, `fab-target-geometry.spec.ts`, `app/(tabs)/index.tsx`,
  `progress/qa_maniobras-device.md` ni los specs de ficha-categoría-tacto. Ninguno dio rojo en `check.mjs`.
