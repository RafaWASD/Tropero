# impl — delta spec 02 «ficha-categoria-tacto»

baseline_commit: fc5aa2faacb9dc0bc8b2bf3fcb1528d33fd28340

**Estado**: **FIX-LOOP 1 CERRADO** — los dos 🔴 del review están arreglados y re-falsificados con mutantes.
Ver **§FIX-LOOP 1 al final** (es lo más nuevo). **Nada commiteado.**
`check.mjs` da **RC=1 por fallas AJENAS** (la suite de campañas congeladas de la otra terminal, contra una
migración no aplicada, + un flake de rate-limit de Auth): **client unit 3021/0**, mi TR.12 verde, cero fallas
de esta unidad — evidencia en §FIX-LOOP 1.

> Delta de spec 02 (frontend). Implementa `requirements-ficha-categoria-tacto.md` (`RCM.n` + `RTF.n`) y
> `design-ficha-categoria-tacto.md`. **Gate 1 N/A verificado** (TCT.31): `git diff supabase/migrations/
> supabase/functions/` **vacío**; el único archivo tocado bajo `supabase/` es `tests/reports/run.cjs`.

---

## §0 — Lo primero que hay que leer

Tres cosas que no estaban en el plan y que el reviewer tiene que mirar sí o sí:

1. **🟠 Corregí un defecto PRE-EXISTENTE en `resolveRevertCategory`** (`animals.ts`) porque **sin eso P2 no
   se cumple**. Derivaba la categoría automática con `isCastrated: false` HARDCODEADO. Para "Quitar fijación"
   el daño era transitorio; para el selector nuevo sería PERSISTENTE (§4.2). Es un cambio de una línea en una
   función COMPARTIDA — el punto de mayor riesgo de regresión de toda la unidad, y por eso lo pongo primero.
2. **Un test E2E mío nació CIEGO y lo cacé con un mutante** (§6.2). El de "un animal CUT no ofrece Cambiar"
   pasaba en verde con el gate de CUT roto. Motivo: `toHaveCount(0)` matchea en t=0, antes de que resuelva la
   lectura asíncrona del catálogo. Corregido y re-falsificado.
3. **11 tests E2E estaban en ROJO ANTES de esta unidad** y lo verifiqué **ejecutando el baseline**, no
   deduciéndolo (§7). No son míos.

---

## §1 — Qué se construyó

### Funcionalidad 1 — fijar la categoría a mano desde la ficha (`RCM.n`)

Fila **"Categoría"** en "Datos del animal" (debajo de "Nacimiento", molde de `BreedRow`) con el link
**"Cambiar"** → `CategoryPickerSheet` (sobre `BottomSheetShell`) con dos fases en el MISMO sheet: lista de las
categorías del mismo sexo (y, para machos, coherentes con su castración — P1) → confirmación con la
consecuencia + el aviso de edad cuando corresponde. Al confirmar: **un** UPDATE local plano
(`category_id` + `category_override`), optimismo en sitio, refresh silencioso.

La regla, en una línea: `override = (elegida ≠ derivada)`. Elegir la categoría automática **quita** la
fijación (P2). La `CategoryOverrideCard` (RC6.4) queda intacta: es el atajo, el selector es el camino general.

### Funcionalidad 2 — tacto reproductivo desde la ficha, animal por animal (`RTF.n`)

CTA **"Tacto de preñez" / "Tacto de aptitud"** en "Estado actual", debajo de las filas reproductivas, que
aparece SOLO cuando corresponde según **el mismo gating que la manga** (capa rodeo `resolveManeuverGating`
AND capa animal `appliesToAnimal`, sin criterio nuevo) → ruta full-screen `animal/tacto` que monta los
**mismos pasos de la manga sin tocarlos** (`TactoStep` / `TactoVaquillonaStep`) → `addTacto` /
`addTactoVaquillona` (servicios que YA existían): un INSERT local plano, **sin `session_id`**, sin crear
ninguna jornada.

Y se retiró la card "Tacto" de "Agregar evento", que ofrecía el tacto de preñez a **cualquier** hembra sin
gating alguno.

---

## §2 — P3 + P4: la decisión de Raf, y por qué NO se perdió capacidad

Es lo que más me pediste que verifique, así que va con evidencia ejecutada.

**Lo que se retiró** (RTF.9.1): la card "Tacto" del paso 1 de `agregar-evento.tsx`, con su `TactoForm`, su
estado, su rama de submit, el `EventType 'tacto'` y los imports que quedaron huérfanos (`addTacto`,
`PREGNANCY_OPTIONS`, `PregnancyStatus`, `Stethoscope`). Esa card tenía **un campo de fecha**: era la única
forma de cargar un tacto atrasado.

**Lo que la reemplaza** (RTF.6.2 reconciliado): en `animal/tacto.tsx`, debajo del paso, un link secundario
**"Fue otro día"** (ícono `CalendarDays`, `$textMuted`, ≥ `$touchMin`) que despliega un campo de fecha con la
**misma validación que el resto de los eventos** (`maskDateInput` + `validateEventDate`: formato `AAAA-MM-DD`
y **no futura**, con error inline). Si no se toca, el tacto se fecha HOY con `todayIsoLocal()`.

**Verificado ejecutando, con oráculo SERVER** — `e2e/ficha-tacto.spec.ts`, test *«"Fue otro día": el link
despliega la fecha y el tacto queda fechado en el PASADO»*:

- el campo **no** está a la vista al entrar (`tacto-fecha` → count 0) y el link **sí**;
- al tocar el link, el campo aparece con **hoy** precargado (`toHaveValue(todayLocalIso())`);
- se fecha 10 días atrás, se carga DIFERIDA, y la aserción final **no mira la pantalla**: lee
  `reproductive_events` con service_role y exige `event_date === pastIso` **y `session_id IS NULL`**.

**Capacidad neta**: no se perdió nada y se ganó gating. Antes se podía fechar en el pasado, pero también se
podía tactar una ternera. Ahora se puede fechar en el pasado **y** solo se ofrece a quien corresponde.

Además, la fecha por default sale de la **fuente única** `todayIsoLocal()`: derivarla en UTC fecharía MAÑANA
toda la carga posterior a las 21:00, en una columna `date`. El guard `today-iso-guard.test.ts` corre en verde.

---

## §3 — Trazabilidad `R<n> → archivo:test`

### Familia RCM (categoría a mano)

| R | Test |
|---|---|
| RCM.1.1 / RCM.1.2 | `e2e/ficha-categoria.spec.ts` : «fila "Categoría": fijar a mano…» (valor + link "Cambiar") |
| RCM.1.3 | `utils/category-pin.test.ts` : «RCM.1.3 — archivado → false» · `e2e/ficha-categoria.spec.ts` : «animal CUT…» (la categoría se sigue mostrando) |
| RCM.1.4 | `e2e/ficha-categoria.spec.ts` : el badge del hero y la card de fijación se asertan además de la fila |
| RCM.2.1 | `e2e/ficha-categoria.spec.ts` : el sheet lista las 5 de hembra del catálogo del rodeo |
| RCM.2.2 / RCM.2.3 (P1) | `utils/animal-category-picker.test.ts` : «macho ENTERO: ternero/torito/toro» · «macho CASTRADO: ternero/novillito/novillo» · «hembra: las 5, con y sin isCastrated» |
| RCM.2.4 / RCM.2.5 | `utils/animal-category-picker.test.ts` : «`cut` y `vaca_cabana` NUNCA (ninguna combinación)» · `utils/category-pin.test.ts` : «`cut` NO es fijable» + «las que el selector ofrece son todas fijables» · `e2e/ficha-categoria.spec.ts` : `category-option-cut` count 0 |
| RCM.2.6 | `utils/animal-category-picker.test.ts` : «catálogo vacío → []» · `utils/category-pin.test.ts` : «sin opciones → false» |
| RCM.2.7 | `e2e/ficha-categoria.spec.ts` : `aria-pressed=true` en la vigente, `false` en las demás |
| RCM.3.1 / RCM.3.2 / RCM.3.3 | `e2e/ficha-categoria.spec.ts` : sheet visible → tap opción → `category-sheet-confirm` |
| RCM.3.4 | `utils/category-pin.test.ts` : 3 casos de `noop` (+ el falso no-op) · `e2e/ficha-categoria.spec.ts` : «tocar la VIGENTE es no-op» **con oráculo server** |
| RCM.3.5 | `e2e/ficha-categoria.spec.ts` : cerrar por la X desde la confirmación **con oráculo server de "no escribió nada"** |
| RCM.4.1 / RCM.4.2 | `e2e/ficha-categoria.spec.ts` : `category-confirm-question` + `category-confirm-consequence` contiene "deja de actualizarse sola" |
| RCM.4.3 / RCM.4.7 | `utils/category-pin.test.ts` : 6 tests de ventanas con **fronteras exactas** 364/365 y 729/730, `today` inyectado |
| RCM.4.4 | `e2e/ficha-categoria.spec.ts` : «categoría incoherente con la edad» (aviso con la edad + la categoría por edad) y **Confirmar igual** |
| RCM.4.5 | `utils/category-pin.test.ts` : «sin birth_date, inválida o futura → null» |
| RCM.4.6 | `components/CategoryPickerSheet.tsx` degrada a nombrar solo la edad si el name no resuelve (rama probada por lectura; ver §8 «qué NO verifiqué») |
| RCM.5.1 | `services/category-pin-core.test.ts` : «elegida ≠ derivada → FIJAR con el id de la ELEGIDA» · `powersync/local-reads.test.ts` : SQL exacto del builder |
| RCM.5.2 (P2) | `services/category-pin-core.test.ts` : «elegida = derivada → REVERT con el id de la DERIVADA» · `e2e/ficha-categoria.spec.ts` : la card de fijación DESAPARECE |
| RCM.5.3 | `utils/category-pin.test.ts` : `resolveCategoryPinEffect` + **test de coherencia UI↔datos** · `e2e/ficha-categoria.spec.ts` : el copy cambia a "vuelve a actualizarse sola" |
| RCM.5.4 | `powersync/local-reads.test.ts` : «el pin NO escribe is_castrated / is_cut / teeth_state…» (parsea el SET y exige **exactamente** dos asignaciones) |
| RCM.6.1 | `services/animals.ts` reusa `resolveRevertCategory` (+ §4.2) |
| RCM.6.2 | `services/category-pin-core.test.ts` : «code no resuelve → error es-AR y **CERO writes**» + «id vacío tampoco escribe» |
| RCM.6.3 | `services/category-pin-core.test.ts` : «derivada irresoluble: fijar SÍ se puede» + «derivada sin id → error sin escribir» |
| RCM.6.4 / RCM.9.2 | `e2e/ficha-tacto.spec.ts` : **test OFFLINE** con oráculo server |
| RCM.6.5 | `services/category-pin-core.test.ts` : «el `categoryCode` devuelto es el que quedó GUARDADO» |
| RCM.6.6 | el núcleo puro existe y se testea con fakes (`category-pin-core.test.ts`, 10 tests) |
| RCM.7.1 / RCM.7.2 | `utils/category-pin.test.ts` : `canPinCategory` (activo/CUT/archivado/sin opciones) · `e2e/ficha-categoria.spec.ts` : «animal CUT…» (sin link + hint) |
| RCM.7.3 / RCM.7.4 | `e2e/ficha-categoria.spec.ts` : la card "Categoría fijada manualmente" aparece al fijar y desaparece al des-fijar |
| RCM.7.5 | (negativo) no se agregó ninguna afordancia de castración; `pickableCategories` FILTRA por `is_castrated`, no lo escribe — `local-reads.test.ts` RCM.5.4 lo prueba a nivel SQL |
| RCM.8.1 | `e2e/ficha-tacto.spec.ts` OFFLINE: el badge cambia sin red |
| RCM.8.2 / RCM.8.3 / RCM.8.4 | (negativos) el write es solo `(category_id, category_override)` — `local-reads.test.ts`; el copy no promete el historial |
| RCM.9.1 | `check-hardcode.mjs` → 0 violaciones; `lineHeight` matcheado en todo `Text` nuevo |
| RCM.9.3 | `services/animals.ts` resuelve el `system_id` del PERFIL; la ficha pasa `detail.*` |

### Familia RTF (tacto desde la ficha)

| R | Test |
|---|---|
| RTF.1.1 / RTF.1.3 | `utils/ficha-tacto-offer.test.ts` : compone `resolveManeuverGating` + `appliesToAnimal` (17 tests) |
| RTF.1.2 | `utils/ficha-tacto-offer.test.ts` : «archivado (sold/dead/transferred) → null aunque todo lo demás aplique» |
| RTF.1.4 | `utils/ficha-tacto-offer.test.ts` : «rodeo SIN `prenez` (o sin `tamano_prenez`)…» + «config irresoluble (mapa vacío) → null» |
| RTF.2.1 | `utils/ficha-tacto-offer.test.ts` : **test de DISYUNCIÓN** sobre el producto cartesiano (sexo × 9 categorías × 3 castración × 10 estados) con control de no-vacuidad |
| RTF.2.2 | precedencia defensiva a `prenez` (código + el barrido devuelve siempre ≤1) |
| RTF.2.3 | `utils/ficha-tacto-offer.test.ts` : macho / ternera / vaquillona apta / CUT → null · `e2e/ficha-tacto.spec.ts` : «sin CTA de tacto: un MACHO y una TERNERA» |
| RTF.2.4 | `utils/ficha-tacto-offer.test.ts` : «el barrido devuelve solo prenez\|aptitud\|null, y produce los tres» |
| RTF.3.1 / RTF.3.3 | `e2e/ficha-tacto.spec.ts` : el CTA está en "Estado actual" y navega a la captura |
| RTF.3.2 | `utils/ficha-tacto-offer.test.ts` : `fichaTactoCtaLabel` |
| RTF.4.1 | `e2e/ficha-tacto.spec.ts` : `fitness-block-APTA/NO APTA/DIFERIDA` y `PREÑADA/VACÍA` — los testID de los componentes de la manga, sin tocarlos |
| RTF.4.2 | `e2e/ficha-tacto.spec.ts` : `tacto-hero` = el idv del animal |
| RTF.4.3 | `e2e/ficha-tacto.spec.ts` : rodeo con 3 meses → CABEZA/CUERPO/COLA; el `medium` aterriza en el server |
| RTF.4.4 | re-validación al montar con `fetchAnimalDetail` + `resolveFichaTactoOffer` (ver §8: el estado "ya no aplica" NO tiene E2E) |
| RTF.4.5 / RTF.4.6 / RTF.4.7 | `backOr`, `useBusyWhileMounted`, `busyRef` antes de todo `await` (ver §8) |
| RTF.5.1 / RTF.5.2 | `e2e/ficha-tacto.spec.ts` : oráculo server del `pregnancy_status` / `heifer_fitness` |
| RTF.5.3 | `e2e/ficha-tacto.spec.ts` : el oráculo exige **`session_id IS NULL`** + «no se creó ninguna jornada» (count de `sessions` = 0) |
| RTF.5.4 | el INSERT pasa por el mismo trigger `0054` (los servicios no se tocaron) |
| RTF.5.5 / RTF.10.2 | `e2e/ficha-tacto.spec.ts` : **test OFFLINE** |
| RTF.5.6 | error inline sin navegar (ver §8: no tiene E2E) |
| RTF.6.1 / RTF.6.2 (P3) | `e2e/ficha-tacto.spec.ts` : `eventDate === todayLocalIso()` por default; «Fue otro día» → fecha pasada, verificada en el server |
| RTF.7.1 / RTF.7.2 | `e2e/ficha-tacto.spec.ts` : vuelve a la ficha y muestra "Apta" / "Preñada (cuerpo)" |
| RTF.7.3 | `e2e/events.spec.ts` : «C6 espejo: tacto+ desde la ficha sobre vaquillona → "Vaquillona preñada" derivado localmente» |
| RTF.7.4 | `e2e/ficha-tacto.spec.ts` : sobre una hembra FIJADA, el tacto positivo **no mueve** la categoría (badge + oráculo server del perfil) |
| RTF.7.5 | `e2e/ficha-tacto.spec.ts` : el CTA desaparece solo tras el veredicto `apta` |
| RTF.8.1 / RTF.8.2 / RTF.8.4 / RTF.8.5 | `supabase/tests/reports/run.cjs` : **TR.12** (§5) |
| RTF.8.3 | (no hay imputación que definir — verificado por TR.12: el KPI cuenta el tacto suelto igual que el de jornada) |
| RTF.9.1 / RTF.9.2 / RTF.9.3 | `e2e/ficha-tacto.spec.ts` : «"Agregar evento" ya NO ofrece "Tacto" y sigue ofreciendo Servicio / Parto / Aborto» (+ el subtítulo "Diagnóstico de preñez" tampoco está) |
| RTF.10.1 | `check-hardcode.mjs` 0 violaciones; `lineHeight` matcheado |
| RTF.10.3 | todo sale de `detail.*` (perfil), nunca de `EstablishmentContext` |

---

## §4 — Decisiones que tomé (y que no estaban escritas)

### 4.1 — Segunda cerradura de RCM.2.4 en el borde donde se ESCRIBE

`isPinnableCategoryCode` (puro, `utils/category-pin.ts`) + `CATEGORY_PIN_FORBIDDEN_CODES = {cut}`.
`setCategoryManual` no resuelve el id si el code no es fijable → el núcleo devuelve el error **sin escribir**.

Motivo: `cut` **acopla** la columna `is_cut`. El selector ya no lo ofrece, pero un caller futuro del servicio
que se salteara `pickableCategories` produciría `category_id = cut` con `is_cut = 0` — el estado inconsistente
que RCUT.2.3 prohíbe, y que además rompe el desmarcado (`unsetCut` es el único camino que resetea `is_cut`).
El guard está escrito **sobre la ausencia**: lo nuevo nace protegido. Hay un test que ata las dos listas (todo
lo que el selector OFRECE tiene que ser fijable) para que no se contradigan.

`vaca_cabana` NO está en la lista, y es deliberado: queda fuera por ALCANCE (cabaña no es MVP de cría), no por
consistencia. Si mañana entra al MVP, entra sin tocar esta lista. Hay un test que fija esa distinción.

### 4.2 — 🟠 `resolveRevertCategory` derivaba con `is_castrated` FALSO

**Lo que encontré**: la resolución COMPARTIDA de la categoría automática pasaba `isCastrated: false`
HARDCODEADO, con un comentario que lo justificaba así: *"hoy ningún write-path setea is_castrated=true"*. Eso
**dejó de ser cierto con spec 10** (R13.1: el toggle "Castrado" de la ficha y la castración masiva escriben
`animal_profiles.is_castrated`, denormalizado por `0084` y ya proyectado por `buildAnimalDetailQuery`).

**Por qué no lo podía dejar pasar**: RCM.6.1 me obliga a reusar esa función para que el selector y "Quitar
fijación" no diverjan. Con el `false` fijo, la derivada de un macho CASTRADO da `torito` en vez de
`novillito` ⇒ elegir "Novillito" (que ES la automática) **no coincidiría** con la derivada ⇒ se fijaría con
`override = true`. O sea: **P2 quedaba incumplido justo en el caso que P1 hace visible**. Y a diferencia del
revert —donde el server recomputa y el daño es transitorio— acá el `override = true` es persistente.

**Qué hice**: pasar el valor REAL de la fila (una línea). Los dos caminos siguen sin divergir y ahora los dos
espejan a `compute_category`. Reconciliado en `design.md` §2.5-ter y en el historial de `requirements.md`.

**Alternativa descartada**: computar la derivada por mi cuenta en `setCategoryManual` con el `is_castrated`
real. La descarté porque RCM.6.1 pide explícitamente NO divergir de "Quitar fijación" — habría dejado dos
respuestas distintas a la misma pregunta.

**Riesgo de regresión medido**: `check.mjs` RC=0 con las suites de animal (139), reportes (17), RLS (22) y
Edge (47) completas; ningún test asertaba el comportamiento viejo.

### 4.3 — `resolveCategoryPinEffect`: la misma regla, dos capas, atadas por un test

El copy de la confirmación (RCM.5.3) y el no-op (RCM.3.4) necesitan saber el efecto ANTES de escribir. La UI
no puede importar el service y el service no debe conocer el copy, así que la regla queda escrita dos veces.
Para que no drifteen, hay un test que barre el producto cartesiano y exige que **el efecto que la confirmación
PROMETE sea el `override` que el núcleo ESCRIBE**. Un cambio en una sin la otra lo pone rojo.

Caso que parece no-op y no lo es (tiene test propio): un animal con `override = true` cuya categoría fijada
COINCIDE con la derivada — tocar esa misma categoría QUITA la fijación.

### 4.4 — Re-entrancy del confirmar por `ref`, no por estado

`if (busy) return; setBusy(true)` es el patrón as-built del repo, pero `busy` es estado de React: dos taps en
el mismo tick pasan los dos. Lo cambié a un `busyRef` seteado **síncronamente antes del await** (el mismo
patrón que ya usan `animal/tacto.tsx` y `agregar-evento`). El estado `busy` queda solo para el disabled/label.

### 4.5 — Migración de los E2E que dependían de la card retirada

6 tests de `events.spec.ts` usaban la card "Tacto" como **setup** (para dejar una hembra "figurando preñada"
antes de probar parto/aborto/servicio). Los migré a sembrar el tacto server-side **pre-login** (entra con la
primera sincronización) — el setup no cambia lo que esos tests prueban.

La excepción es **«C6 espejo»**, que prueba que el badge se deriva de un write **LOCAL**: sembrarlo
server-side lo habría vaciado de sentido. Ese lo migré al **CTA de la ficha** (que es un write local), con un
evento `service` sembrado para que la hembra cuente como servida y el rodeo con 3 meses de servicio para que
aparezca el sub-paso de tamaño. Sigue probando exactamente lo mismo, por el camino nuevo.

Detalle que costó un rojo: `seedReproductiveServiceEvent` con `serviceType: 'ai'` es rechazado por el trigger
`0054` (exige el data_key `inseminacion`, que nace DESHABILITADO en cría). Se usa `natural`, que no gatea y
que `deriveReproStatus` lee igual (mira el `event_type`, no el tipo).

---

## §5 — Reportes: TR.12, «suelto pero visible» pasa de leído a ejecutado

`supabase/tests/reports/run.cjs` — test nuevo, **17/17 verde** (era 16). Sin tocar el schema.

- **(a)** dos multíparas del mismo rodeo: una con tacto POSITIVO **sin `session_id`** y otra con tacto de
  JORNADA. `rodeo_pregnancy_kpi(...).pregnant === 2` y `rodeo_ccl_distribution` las bucketea a las dos. El
  test **asierta además que la fila insertada tiene `session_id NULL`**, así no puede pasar por la razón
  equivocada.
- **(b)** el oráculo FUERTE: dos vaquillonas de ≥365 d. **Control de no-vacuidad**: antes del veredicto las
  DOS están en `rodeo_serviced_females` (fallback por edad). Después, con `tacto_vaquillona` **sin
  `session_id`**: la `'apta'` sigue y la `'no_apta'` **queda EXCLUIDA**. Si la función ignorara los eventos
  sin jornada, la `no_apta` entraría igual por el fallback → la exclusión ES la prueba de que se lee.
- **(c)** `session_event_summary` de la jornada cuenta **1** reproductivo (el suyo), no 2; y una jornada vacía
  del mismo rodeo tampoco lo absorbe.

---

## §6 — Falsificación con mutantes

### 6.1 — Unit: 10 mutantes, 10 muertos (+ control verde)

| # | Mutante | Resultado |
|---|---|---|
| M1 | `canPinCategory` ignora `isCut` | **MUERTO** |
| M2 | `resolveFichaTactoOffer` ignora el `status` archivado | **MUERTO** |
| M3 | el builder del pin toca ADEMÁS `is_cut` | **MUERTO** |
| M4 | `decideCategoryPin` FIJA siempre (nunca vuelve a automático) | **MUERTO** |
| M5 | `pickableCategories` ignora la castración del macho | **MUERTO** |
| M6 | `isPinnableCategoryCode` deja pasar `cut` | **MUERTO** |
| M7 | `categoryAgeMismatch` off-by-one en el piso (`>=` → `>`) | **MUERTO** |
| M8 | `categoryAgeMismatch` no juzga nunca (siempre `null`) | **MUERTO** |
| M9 | `resolveCategoryPinEffect` nunca detecta el no-op | **MUERTO** |
| M10 | `resolveFichaTactoOffer` ignora la capa RODEO (data_keys) | **MUERTO** |
| — | **CONTROL** sin mutante | **VERDE** |

### 6.2 — E2E: 2 mutantes, y uno encontró un test CIEGO mío

| # | Mutante | Resultado |
|---|---|---|
| E1 | el gate de la ficha ignora `is_cut` (`canPinCategory({isCut: false})`) | **SOBREVIVIÓ** → test ciego → corregido → **MUERTO** |
| E2 | el CTA de tacto se ofrece siempre (`?? 'prenez'`) | **MUERTO** (mata 2 tests: «sin CTA» y «el CTA desaparece») |

**El ciego, y por qué lo era**: mi test «animal CUT: la fila NO ofrece "Cambiar"» hacía
`expect(getByTestId('ficha-categoria-cambiar')).toHaveCount(0)`. La afordancia depende de
`categoryOptions`, que sale de una lectura **asíncrona** del catálogo: en t=0 esa lista está vacía, así que la
fila es solo-lectura **para cualquier animal** y el `toHaveCount(0)` matchea al instante. Con el gate de CUT
roto, el test seguía en verde.

Es exactamente la clase que venís cazando: **verificaba un estado transitorio en vez del invariante**. Lo
cerré esperando a que el catálogo resuelva y asertando ADEMÁS que el hint **sigue** puesto (con el gate roto,
el hint desaparece y aparece el link). Re-corrido con E1: **falla**. Sin mutante: pasa. El porqué del settle
está escrito en el propio test para que nadie lo saque por prolijidad.

---

## §7 — Los 11 E2E rojos NO son míos (verificado ejecutando el baseline)

Método (tres veces, una por familia): `git stash push` **solo de mis 8 archivos fuente** (sin tocar los de la
otra terminal) → `pnpm e2e:build` → correr → `git stash pop` → rebuild.

| Familia | Baseline | Con mi unidad | Veredicto |
|---|---|---|---|
| `maniobra-carga` ×2 · `maniobra-tacto-adaptativo` ×4 · `maniobra-tacto-bugfix` ×3 | falla igual | falla igual | **pre-existente** |
| `cut-ficha` ×1 · `treatments` ×1 | falla igual | falla igual | **pre-existente** |
| `animals` + `animals-offline` | **6 rojos** | **3–5 rojos** (varía) | **pre-existente + FLAKY** |

**Causa de los 9 de la manga** (leída, no supuesta): esperan que el tacto de PREÑEZ aplique a una **vaquillona
sin servicio**. Desde el fix del bug-B (`a2354d9`, 2026-07-10) aplica solo a hembras SERVIDAS, y ese commit
**no actualizó estos e2e** (su último cambio es del 2026-07-09, `5c658ff`). Las specs quedaron viejas respecto
del fix.

**Causa de los 2 de badge**: `.first()` resuelve a un nodo **oculto** — con la ficha abierta desde la LISTA, la
pantalla de fondo queda montada aria-hidden con su propio `CategoryBadge`. El fix conocido es
`filter({ visible: true })` + anclar por `aria-label`; lo apliqué en las 3 aserciones equivalentes de
`events.spec.ts` que este delta hizo alcanzables, pero **no toqué `cut-ficha` ni `treatments`** (no son de
esta unidad). Todo esto quedó anotado en `docs/backlog.md` con el mecanismo y el próximo paso.

---

## §8 — Qué NO pude verificar (o verifiqué de menos)

1. **Nada en DEVICE.** Todo es web (export estático + Chromium). En particular: el `hitSlop`, el teclado real
   sobre el campo de "Fue otro día" (en web `KeyboardAvoidingShell` es inerte), el back físico de Android
   cerrando el sheet, y el arrastre-para-cerrar. Los tres los aporta `BottomSheetShell` y están cubiertos por
   sus propios guards, pero **no los vi funcionar en esta pantalla**.
2. **RTF.4.4 — el estado "este tacto ya no aplica"** (deep-link / dato cambiado entre el tap y el montaje).
   El código re-valida y muestra `tacto-no-aplica` + salida; **no escribí un E2E que lo dispare** (haría falta
   mutar el dato entre la navegación y el montaje, o navegar por URL directa con un `kind` inventado).
   Verificado por lectura, no por ejecución.
3. **RTF.5.6 — el error inline del write local fallido.** Mismo caso: el camino existe (no navega, muestra el
   error, libera el guard) pero no hay forma barata de hacer fallar el write local desde el E2E.
4. **RTF.4.7 (doble-tap) y RCM (doble-tap del Confirmar)**: los guards son `busyRef` tomados antes del primer
   `await`; **no los probé con dos taps simultáneos** (Playwright serializa). Es verificación por lectura.
5. **RCM.4.6 — la degradación del aviso cuando el name no resuelve en el catálogo**: rama defensiva, sin test.
   En la práctica el `expectedCode` siempre cae dentro de las opciones ofrecidas.
6. **El test OFFLINE prueba que el flujo NO depende del server, no que la red estuviera caída.** Usa
   `context.setOffline(true)` (el primitivo del repo) y el oráculo es post-reconexión; si `setOffline` fuera
   un no-op, el test pasaría igual. Lo que sí prueba: la UI refleja los dos cambios sin esperar al server, y
   los dos writes drenan y aterrizan después.
7. **`pnpm e2e` COMPLETO no lo corrí** (~38 min). Corrí, con el build final: los 2 specs nuevos (10/10), los
   `events` migrados (17/17), `animals` + `animals-offline`, `titulos-sweep` (3/3), `cut-ficha`,
   `ficha-paridad`, `ficha-circunferencia-escrotal`, `treatments`, `identificadores-unificados`, y los 3
   specs de tacto de la manga. **No corrí** el resto de la suite de maniobras, BLE, SIGSA, invitaciones ni
   cuentas — mi diff no los toca, pero no lo verifiqué.
8. **No corrí el `design-review` sobre las capturas**: las generé y las miré, el veto es tuyo.

---

## §9 — Campañas: lo que rocé y NO resolví

Me pediste que lo mire y que lo pare si aparecía. **Aparece, y no lo toqué.**

`design.md` §3.5 ya lo declara y lo confirmé leyendo `0106`: la regla es "**último tacto vigente del
animal**", sin ventana temporal. Es decir, el tacto más reciente de una hembra influye también sobre el KPI de
campañas **pasadas** que se consulten. **Este delta no lo agrava ni lo arregla** — usa exactamente el mismo
perímetro que la manga. Dos observaciones concretas para quien esté rediseñando esto:

1. **La decisión de P3 lo toca de refilón, en el sentido correcto y en el equivocado a la vez.** Fechar HOY
   por default mantiene el sesgo "hacia adelante" (el dato más nuevo), que es lo que un productor espera.
   Pero el link "Fue otro día" **habilita retro-fechar**, y un tacto retro-fechado con la regla "último tacto"
   **no se imputa a la campaña de su fecha**: sigue siendo el último del animal. O sea, la fecha que el
   operario elige NO decide a qué campaña va. Eso era el argumento original para NO ofrecer el campo; Raf
   decidió ofrecerlo igual (con razón: la alternativa era perder la capacidad). **Lo dejo señalado, no
   resuelto**: si el rediseño de campañas congela el numerador por fecha, este campo pasa a tener el
   comportamiento que el operario espera, gratis.
2. **Fijar la categoría a mano MUEVE el denominador reproductivo.** `rodeo_serviced_females` (`0105`) lee
   `c.code`: fijar "Multípara" mete al animal en las "probadamente servidas" y fijar "Ternera" lo saca. Está
   documentado en `design.md` §7 y es la semántica correcta, pero es una **vía nueva** —de un tap— para
   cambiar el denominador de una campaña, incluida una pasada. No se le explica al usuario (no se le explica
   el denominador al peón) y no lo cambié.

Ninguna de las dos la resolví. Ninguna toca archivos de la otra terminal.

---

## §10 — Autorrevisión adversarial (qué busqué, qué encontré, cómo lo cerré)

| # | Qué busqué | Qué encontré | Cómo lo cerré |
|---|---|---|---|
| 1 | ¿Algún `R<n>` cubierto a medias? | RCM.3.4, RCM.3.5 y RTF.7.4 solo tenían unit / nada | 3 casos E2E nuevos, dos con **oráculo server de "no escribió nada"** |
| 2 | ¿El offline está *testeado* o solo *afirmado*? | Solo afirmado | Test E2E offline de las DOS capacidades, con oráculo server post-reconexión |
| 3 | ¿La regla del `override` puede driftear entre el copy y el write? | Sí (dos implementaciones) | Test de coherencia sobre el producto cartesiano que las ata |
| 4 | ¿Se puede llegar a un estado inconsistente por el servicio? | Sí: `setCategoryManual('cut')` | `isPinnableCategoryCode` — rechazo sin escribir + test que ata las dos listas (§4.1) |
| 5 | ¿La derivada que uso es la que el server computa? | **No** para machos castrados (§4.2) | Corregido en la fuente compartida |
| 6 | ¿Doble-tap escribe dos veces? | El `if (busy)` del sheet era evadible en el mismo tick | `busyRef` síncrono antes del await |
| 7 | ¿Los guards se burlan verificando la forma? | El test de RCM.5.4 podría haber sido un `doesNotMatch` cosmético | Parsea el SET y exige **exactamente** `['category_id','category_override']`; M3 lo mata |
| 8 | ¿Mis E2E pasan por la razón correcta? | **No** — el de CUT era ciego (§6.2) | Settle + aserción del hint; re-falsificado con E1 |
| 9 | ¿La fecha se deriva bien de noche? | OK (`todayIsoLocal` / `ageInDaysFromBirthDate`) | Test explícito «22:00 y 02:00 del mismo día LOCAL dan lo mismo»; el guard app-wide corre verde |
| 10 | ¿Rompí algo de la manga al consumir sus pasos? | No (no cambié props ni lógica) | Baseline ejecutado: los rojos de la manga son previos (§7) |
| 11 | ¿Quedó código muerto tras retirar la card? | Sí: 4 imports huérfanos y 3 comentarios que mentían | Quitados / corregidos (`agregar-evento.tsx`) |
| 12 | ¿Ensucié `design/**/*.png`? | Sí, 3 PNG de `veto-titulos-sweep` | `git checkout -- design/`; **`design/` limpio** |
| 13 | ¿CRLF churn de los scripts de Python? | No: `git diff` vs `git diff -w` coinciden salvo 7 líneas de re-indentación real del ternario del título | verificado archivo por archivo |
| 14 | ¿Toqué archivos de la otra terminal? | No | `git status` limpio de `specs/07`, `reportes.tsx`, `ADR-032*`, `specs/10`, `docs/marketing` |

---

## §11 — Reconciliación de specs (regla dura)

- **`requirements-ficha-categoria-tacto.md`**: RTF.6.2 **reescrito con nota de reconciliación** (tachado el
  "no se puede fechar en el pasado", agregado el link "Fue otro día" como REQUERIDO, con su validación);
  RTF.6.1 aclara que HOY es el default y que sale de la fuente única. Tabla de P1–P5 **cerradas** al tope de
  esa sección (el texto original se conserva como registro). Historial: entrada de la Puerta 1 + las dos
  reconciliaciones de implementación.
- **`design-ficha-categoria-tacto.md`**: bloque de reconciliación al as-built al inicio (5 puntos); §2.5-bis
  (la segunda cerradura de `cut`), §2.5-ter (el `is_castrated` real, con el porqué), §2.6
  (`resolveCategoryPinEffect`), la nota de la fecha en §3.2, y la tabla de archivos actualizada.
- **`tasks-ficha-categoria-tacto.md`**: TCT.1–TCT.32 en `[x]`; TCT.18 con su nota as-built de P3; **7 tasks
  nuevas TCT.33–TCT.39** con lo que se agregó en implementación; header con el Gate 1 **verificado**.
- **`docs/backlog.md`**: dos entradas nuevas — el `tacto_vaquillona` sin label en el timeline (se lee
  "Reproducción"; no lo arreglé porque el design declara que el timeline no se toca) y los 11 E2E rojos
  pre-existentes con su causa y el próximo paso.

---

## §12 — Verificación (números)

| Qué | Resultado |
|---|---|
| `pnpm typecheck` (app + e2e) | **verde** |
| `node scripts/check.mjs` | **RC=0** · client unit **3009 pass / 0 fail** (baseline 2946 → **+63**) |
| `check-hardcode.mjs` (ADR-023 §4) | **0 violaciones** |
| Unit nuevos | `category-pin.test.ts` **26** · `ficha-tacto-offer.test.ts` **17** · `category-pin-core.test.ts` **10** · `animal-category-picker.test.ts` **+7** · `local-reads.test.ts` **+3** |
| Backend reportes | `supabase/tests/reports/run.cjs` **17/17** (TR.12 nuevo) |
| E2E nuevos | `ficha-categoria.spec.ts` **4/4** · `ficha-tacto.spec.ts` **6/6** |
| E2E migrados | `events.spec.ts` **17/17** |
| E2E de regresión de la ficha | `titulos-sweep` 3/3 · `ficha-paridad` · `ficha-circunferencia-escrotal` · `identificadores-unificados` verdes |
| Mutantes | **12 lanzados, 12 muertos** (10 unit + 2 E2E; uno tras corregir un test ciego) |
| Capturas Gate 2.5 | **15 PNG** en `app/e2e/captures/__shots__/ficha-categoria-tacto/` (gitignoreadas) |
| `git diff supabase/migrations/ supabase/functions/` | **vacío** → Gate 1 N/A confirmado |
| `design/**/*.png` | **limpio** (revertí las 3 que ensució una corrida E2E) |
| Commits | **ninguno** |

### Las 15 capturas del Gate 2.5

`01-fila-categoria-cambiar` · `02-sheet-opciones` · `03-confirmacion-fijar` · `04-ficha-categoria-fijada` ·
`05-confirmacion-volver-a-automatico` · **`06-confirmacion-aviso-edad`** · `07-fila-categoria-cut-solo-lectura` ·
`08-cta-tacto-aptitud` · `09-tacto-aptitud-paso` · **`10-tacto-fue-otro-dia`** · `11-ficha-post-tacto-aptitud` ·
`12-cta-tacto-prenez` · `13-tacto-prenez-paso` · `14-tacto-prenez-tamano` · `15-ficha-post-tacto-prenez`

Las dos que pediste explícitamente son la **06** (confirmación con el aviso de incoherencia: *"El animal tiene
7 meses. Por edad le corresponde Ternera."*) y la **09/10** (el paso de tacto con el link "Fue otro día"
visible, y el campo desplegado).

Se regeneran con:
```
cd app && pnpm exec playwright test e2e/captures/ficha-categoria-tacto.capture.ts \
  --config playwright.capture.config.ts --workers=1
```

### Lo que yo mismo marco para tu veto de diseño

La fila "Categoría" tiene **más aire** entre el label y el valor que sus vecinas ("Sexo", "Nacimiento"),
porque el link "Cambiar" vive dentro de una caja de `$touchMin` (44 dp) para cumplir Fitts. `BreedRow` —el
molde que RCM.1.2 manda copiar— tiene el link como un `Text` de 13 px suelto, sin target. Elegí **cumplir el
target** y quedar levemente desalineado con la fila de Raza, en vez de copiar un target chico. Está en la
captura **01**; si preferís la otra, es mover el link a la línea del VALOR (queda más prolijo y sigue teniendo
44 dp), pero eso sí se aparta del "mismo patrón visual que BreedRow" de RCM.1.2.

---

# FIX-LOOP 1 — CHANGES_REQUESTED (`progress/review_ficha-categoria-tacto.md`)

**Los dos 🔴 eran tests que no podían fallar. Los dos están cerrados y re-falsificados.** Cero cambios en
código de producto: los arreglos son de fixtures y de oráculos.

## 🔴 1 — Mi fix de `resolveRevertCategory` sobrevivía a su propio mutante

**Lo que el reviewer midió**: restauró el `isCastrated: false` hardcodeado y la suite quedó **3021 unit en
verde**. Tenía razón y la causa era exactamente la que señaló: **no había un solo macho castrado en toda la
suite E2E**, así que P2 estaba verificado únicamente en hembras — donde el eje castración ni siquiera aplica.
El arreglo era correcto y no lo probaba nadie.

**Qué agregué**: `e2e/ficha-categoria.spec.ts` → *«MACHO CASTRADO: elegir la categoría automática (Novillito)
QUITA la fijación, no la re-fija (P2)»*. El fixture está elegido para que el defecto sea VISIBLE:

- macho **castrado**, **500 días** (entre 1 y 2 años) → `compute_category` da **`novillito`**; con el defecto
  (`is_castrated=false`) la derivada daría **`torito`**;
- arranca **fijado en "Novillo"** (≠ la derivada) para que "Cambiar" se ofrezca y el cambio sea real.

Al elegir "Novillito" —que ES la automática—: con el arreglo la elegida COINCIDE con la derivada → se QUITA
la fijación; con el defecto DIFIERE de `torito` → se FIJA. **La categoría escrita es la misma en los dos
casos**, así que el discriminante es el `override`, no el `category_id`. Tres oráculos independientes:

1. **copy** — la confirmación tiene que decir "vuelve a actualizarse sola";
2. **UI** — la card "Categoría fijada manualmente" desaparece;
3. **SERVER** — `category_override === false` y `code === 'novillito'` (polleado).

De paso el test cubre **RCM.2.3 / P1 en E2E** (hasta ahora solo tenía unit): a un castrado se le ofrecen
ternero/novillito/novillo, y **`toro`/`torito` NO están**.

**Falsificado ejecutando** (mutante **R1**: restaurar `isCastrated: false` en `resolveRevertCategory`):

```
> 282 | await expect(page.getByTestId('category-confirm-consequence')).toContainText(
Expected substring: "vuelve a actualizarse sola"
Received string:    "La categoría queda fijada a mano: deja de actualizarse sola, ni por la edad ni por
                     los eventos (parto, tacto, destete, castración)…"
1 failed
```

**MUERTO.** Revertido el mutante → verde.

## 🔴 2 — `ficha-tacto.spec.ts` "sin CTA" pasaba con la capa ANIMAL del gating borrada

**Misma forma que el de CUT que había cazado yo**: `toHaveCount(0)` en `t=0`. El CTA depende de
`rodeoGating`, una lectura **asíncrona**; con el mapa todavía vacío **no hay CTA para nadie**, así que la
ausencia matchea al instante y no distingue "el gating funciona" de "todavía no cargó".

**El ancla determinística que encontré**: **"Marcar como CUT (descarte)"** sale del **mismo mapa**
(`rodeoGating['dientes']`) y se ofrece a toda hembra activa que no sea ternera ni CUT (`canMarkCut`). Su
presencia **prueba que el gating ya resolvió en esa ficha** — sin `waitForTimeout`. Por eso el caso principal
pasó a ser una **vaquillona YA APTA** (que RTF.2.3 nombra explícitamente) y no la ternera: a la ternera
`canMarkCut` la excluye, así que no tiene ancla propia.

El test reescrito tiene ahora:

- **control de no-vacuidad**: una vaquillona sin veredicto, en el MISMO rodeo, que SÍ muestra el CTA — sin
  esto, "no aparece" podría significar que el CTA no funciona en ningún lado;
- **(1) vaquillona apta** → ancla `Marcar como CUT` visible → **entonces** ausencia del CTA;
- **(2) ternera** → sin ancla propia: settle explícito, con el porqué escrito en el test;
- **(3) macho** → **declaro lo que el test NO ve**: la ficha resuelve el gating solo para hembras
  (`rodeoGating` queda `{}` en un macho), así que un macho está protegido por DOS vías y este caso **no puede
  discriminar la capa animal**. Se conserva por el requisito de producto, no como oráculo del gating.

**Y el test reescrito encontró un bug de fixture MÍO al primer intento**: la "ternera" se sembraba **sin
`birth_date`**, así que el espejo C6 derivaba el **default conservador de la rama hembra (`vaquillona`)** y el
animal legítimamente merecía el CTA de aptitud. O sea: el caso "ternera" **nunca fue una ternera**. Eran dos
cegueras superpuestas (fixture benigno + carrera de t=0) tapándose entre sí. Corregido con `birthDate` de 100
días; el propio test lo caza ahora.

**Falsificado ejecutando, dos mutantes**:

| Mutante | Dónde muere | Veredicto |
|---|---|---|
| **R2** — capa ANIMAL borrada de las DOS ramas | en el **control** (la vaquillona sin veredicto pasa a ofrecer "Tacto de preñez" por precedencia) | MUERTO |
| **R3** — `needsFitnessEvaluation` deja de discriminar el veredicto (el control queda intacto a propósito) | **línea 417: la aserción de ausencia ANCLADA sobre la vaquillona apta** (`Expected: 0 / Received: 1`) | MUERTO |

R3 es el que importa: prueba que **la aserción de ausencia en sí** discrimina, no solo el control.

## El criterio, aplicado a TODA la unidad

Barrí mis **12 aserciones de ausencia** con la pregunta *"¿qué fixture haría que esto falle?"*:

| Aserción | ¿Discrimina? |
|---|---|
| `ficha-tacto-cta` count 0 (macho / ternera / apta) | 🔴 **NO** → reescrito (arriba) |
| `ficha-categoria-cambiar` count 0 en un CUT | ya corregido en la 1ª pasada (settle + hint), mutante E1 muerto |
| `ficha-tacto-cta` count 0 tras el veredicto apta (RTF.7.5) | ⚠️ era transición present→absent pero medible en t=0 → **le agregué el mismo ancla** `Marcar como CUT` |
| `category-option-{cut,vaca_cabana,toro}` count 0 | sí: el sheet está abierto y ya se asertó `aria-pressed` en otra opción del mismo render |
| `Categoría fijada manualmente` count 0 (inicial y tras des-fijar) | sí: par positivo/negativo en el mismo test + oráculo server |
| `category-age-warning` count 0 (hembra adulta) | sí: contraparte positiva en el test de la ternera; render síncrono tras un assert de visibilidad |
| `category-sheet` / `-confirm` count 0 tras no-op y tras cancelar | sí: el sheet fue visible antes + **oráculo server de "no escribió nada"** |
| `tacto-fecha` count 0 antes de tocar el link | sí: contraparte positiva en el test de "Fue otro día"; render síncrono |
| `Vaquillona preñada` count 0 (RTF.7.4) | sí: precedido del positivo `Categoría Multípara` + oráculo server |
| `Tacto` / `Diagnóstico de preñez` count 0 en "Agregar evento" | sí: Servicio/Parto/Aborto asertados VISIBLES en el mismo render |
| `sessions` count 0 (no se creó jornada) | sí: invariante sobre un establishment namespaced |

**Lo que me llevo, escrito para el próximo**: las tres cegueras de esta unidad son la misma —
**el fixture es benigno, así que el test nunca ve el caso**. Dos formas concretas que voy a mirar primero de
ahora en adelante: (a) **un `toHaveCount(0)` sobre UI que depende de una lectura asíncrona mide t=0** — hay
que anclarlo a algo que salga de la MISMA cadena async, y si no existe, decirlo; (b) **un fixture sin el dato
que define el caso** (una "ternera" sin `birth_date`, un "castrado" que no existe en la suite) hace que el
test hable de otro animal.

## Verificación del fix-loop

| Qué | Resultado |
|---|---|
| `pnpm typecheck` | **verde** |
| E2E de la unidad | `ficha-categoria.spec.ts` **5/5** (era 4) · `ficha-tacto.spec.ts` **6/6** → **11/11** |
| Mutantes del fix-loop | **R1, R2, R3 — 3 lanzados, 3 muertos** (más los 12 de la 1ª pasada = **15/15**) |
| Residuo de mutantes | `grep MUTANTE` → **0** en `animals.ts`, `ficha-tacto-offer.ts`, `maneuver-applicability.ts` |
| Capturas Gate 2.5 | **16** (agregué `16-sheet-opciones-macho-castrado`, el estado visual de P1 que ninguna mostraba) |
| `git diff supabase/migrations/ supabase/functions/` | **vacío** |
| `design/**/*.png` | **limpio** |
| Commits | **ninguno** |

### ⚠️ `check.mjs` da RC=1 y NINGUNA falla es de esta unidad — verificado, no supuesto

- **client unit: 3021 pass / 0 fail** en las dos corridas. (Subió de 3009 a 3021 porque la **otra terminal**
  agregó tests en `app/src/utils/reports-format.test.ts`, que está modificado en el árbol.)
- **Corrida 1** → 6 fallas en la suite de **Edge Functions**, todas
  `signIn(...): Request rate limit reached` + la cascada `Cannot read properties of undefined`. Es el flake
  conocido de dos terminales contra el mismo Auth (`reference_check_red_rate_limit`). **Confirmado
  ejecutando**: la suite de Edge sola da **47 tests / 0 fail**.
- **Corrida 2** → Edge OK, y aparecen **18 fallas en la suite de reportes, TODAS de la otra terminal**:
  `TR.12/12b/12c/13/14x/15/16 (campañas congeladas)`, que fallan con
  `Could not find the function public.close_campaign(...) in the schema cache` — su migración todavía no está
  aplicada. **Mi test pasa**: `✔ TR.12 tacto sin session_id: cuenta en pregnancy_kpi / serviced_females y NO
  en session_event_summary`.
- Dato lindo: su `✔ TR.17 (campañas congeladas) un tacto sin session_id sigue contando + ninguna de las 7
  mira session_id` **pasa** y refuerza, desde el otro lado, el mismo contrato que RTF.8.

**⚠️ Colisión de nombre de test, para que la resuelva el leader**: los dos deltas llamamos **`TR.12`** a
tests distintos en `supabase/tests/reports/run.cjs` (el mío `TR.12 tacto sin session_id`, el de ellos
`TR.12 (campañas congeladas) inmutabilidad`). No rompe nada (`node:test` no exige unicidad) y **no lo toqué a
propósito**: la otra terminal está escribiendo ese archivo AHORA y renombrar sería pisarle el trabajo.
Conviene renumerar uno de los dos al integrar.

### Qué sigo sin poder verificar (además de lo del §8)

- **Nada en device** (el A07 y el ESP32 están desconectados).
- El caso **(3) MACHO** del test de "sin CTA" **no discrimina la capa animal** — está declarado dentro del
  propio test, no escondido acá.
- El **settle de 2 s** de la ternera es una espera temporal, no un ancla: si la lectura del gating tardara más
  que eso en una máquina lenta, el test volvería a ser ciego (no falso-positivo: ciego). La ternera no tiene
  ancla posible porque `canMarkCut` la excluye; lo dejo escrito en el test.
