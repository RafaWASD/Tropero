baseline_commit: 1922e0eeaddd3f738b7cab7ff09de238af87def0

# UNIDAD «tres 🔴 de corrección de datos del QA de maniobras en device»

**Base**: `1922e0e` (el que fijó el pliego). Entre ese SHA y el HEAD del cierre (`edd3457`) la otra terminal
metió **3 commits SOLO de docs** (`docs/backlog.md` ×2, `CONTEXT/07-pendientes.md`) — ni una línea de código,
así que el diff de esta unidad contra `1922e0e` es limpio.
**Evidencia de origen**: `progress/qa_maniobras-device.md`, hallazgos **A.1**, **A.2**, **A.5** (medidos en el
A07 con A/B). **Nada commiteado.**

---

## 0. Resumen ejecutable

| # | Qué se arregló | Dónde vive la fuente única ahora | Guard de clase |
|---|---|---|---|
| **A.2** | "Hoy" se derivaba en **UTC** → todo lo cargado después de las 21:00 (AR) entraba fechado **mañana** en una columna `date` | `app/src/utils/today-iso.ts` (`todayIsoLocal`) | `today-iso-guard.test.ts` (app-wide, 3 reglas) |
| **A.1** | Tipear la caravana **como está impresa** (`PERF-00500`) no encontraba al animal y la app ofrecía **"Dar de alta"** (= duplicado) | `SearchPlan.idvExactTerms` + `withoutSeparators()` en `buildSearchLikeQuery` | `search-idv-wiring-guard.test.ts` (deriva los motores del árbol) |
| **A.5** | Con dos cargas del mismo día, "Peso actual"/"Condición corporal" desempataban por **UUID random** (~50/50) | `isNewerItem` en `event-timeline.ts`, **uno solo** para las tres ramas | `current-state-tiebreak-guard.test.ts` (deriva las ramas del código) |

**Verificado**: `pnpm typecheck` verde · `node scripts/check.mjs` **RC=0** (client unit **2937/2937**, 0 fail
en las 16 suites) · anti-hardcode 0 violaciones · **27 mutantes lanzados, 27 muertos** · E2E nueva **5/5**
verde y **5/5 ROJA con los fixes revertidos** · regresión E2E de las superficies tocadas **59/65** (los 6
rojos son flakes pre-existentes, ver §7) · capture del Gate 2.5 **8 PNG** generados · `git diff supabase/
sync-streams/` **vacío → Gate 1 N/A** · `design/**/*.png` **sin tocar**.

---

## 1. A.2 — la fecha

### El defecto, y por qué era más ancho de lo reportado

El pliego decía "ocho veces, cuatro bien y cuatro mal". Barrido completo: **doce** derivaciones de "hoy" en
`app/app` + `app/src` — **cuatro en UTC** (`maniobra/carga.tsx`, `seleccion-masiva.tsx`,
`vacunacion-masiva.tsx`, `maneuver-category-preview.ts`) y **ocho locales** correctas pero copiadas
(`agregar-evento.tsx`, `animal/baja.tsx`, `crear-animal.tsx`, `lote/venta.tsx`,
`TreatmentApplicationSheet.tsx`, `TreatmentStartSheet.tsx`, `link-calf-query.ts`, y **dos** en
`animal-birth-year.ts` — una inline dentro de `birthYearToDate` y otra como función privada).

### Semántica, verificada call site por call site (el pliego lo pedía explícitamente)

| call site | qué alimenta | ¿UTC podía ser lo correcto? |
|---|---|---|
| `carga.tsx:623` | `eventDate` de **todas** las maniobras (`weight_date`, `event_date`, `collection_date`, `measured_at`) | No — columnas `date`, el día del operario es el LOCAL |
| `seleccion-masiva.tsx:230` | `eventDate` del destete masivo | No |
| `vacunacion-masiva.tsx:102` | `event_date` **y la clave idempotente** (spec 10 R6.1) | No |
| `maneuver-category-preview.ts:186` | `eventDate` del evento SINTÉTICO del preview de transición | No, y **acá era doblemente malo**: el preview tiene que razonar sobre **el mismo día** que `carga.tsx` va a persistir; en UTC anticipaba sobre otro día |
| `carga.tsx:624` `createdAt` | `timestamptz` (instante real) | **Sí, y se dejó como está** — un instante se serializa ENTERO |
| los ~10 `new Date().toISOString()` de `events.ts` / `sessions.ts` / `outbox.ts` / `treatments.ts` / `establishments.ts` (`deleted_at`) / `status.ts` | instantes reales | **Sí — no se tocó ninguno** |

### Dónde vive la función, y por qué NO en `format-date-es-ar.ts`

El pliego pedía mirarlo. **No es su casa**: ese módulo declara en su header que es "formateo ÚNICO de fechas
para **MOSTRAR** al usuario", y `docs/conventions.md` separa explícitamente el formato de usuario del de
**MÁQUINA** ("los formatos de MÁQUINA (SIGSA/CSV/DB/RPC…) NO se tocan: son ISO por diseño"). Lo que devuelve
`todayIsoLocal` es un valor de máquina: va a una columna `date` y a una clave idempotente UUIDv5, nunca a la
pantalla. Meterlo ahí borraba justo la línea que la convención traza. Lo que sí comparten es la regla de
TZ-safety, y cada módulo apunta al otro. Módulo nuevo: **`app/src/utils/today-iso.ts`**, puro (cero imports
— corre en Hermes, web y node).

`todayIsoLocal` **se mudó** desde `link-calf-query.ts`, donde ya existía bien escrita pero con el nombre
equivocado de vecindario. ⚠️ **Es un cambio de contrato público** (`link-calf-query.ts` dejó de exportarla):
los 2 consumidores (`LinkCalfPrompt.tsx` y su test) están migrados y no queda ninguno. Lo marco explícito
porque `CLAUDE.md` pide confirmar antes de tocar contratos exportados — si el leader prefiere un re-export
de compatibilidad, es una línea.

### El guard, y el agujero adyacente que cerró de paso

`app/src/utils/today-iso-guard.test.ts`, escrito **sobre la ausencia** (no enumera los 4 archivos rotos:
prohíbe la derivación en las ~370 fuentes de `app/app` + `app/src`). Tres reglas:

- **(A) truncar un `toISOString()`** — cualquier `.slice`/`.substring`/`.substr`/`.split` sobre él. La regla
  es "cualquier truncación", no "`(0, 10)`": no hay uso legítimo de un `toISOString()` recortado, así que
  no hace falta adivinar los argumentos y no se puede evadir cambiando el índice. Escanea el ARCHIVO (no por
  línea) para cazar la versión que Prettier parte en tres.
- **(B) componer un `AAAA-MM-DD` a mano** desde los getters de `Date` — la mitad "correcta pero duplicada".
  Discrimina por la FORMA DEL RESULTADO (año primero + empalme con guion), así que `format-date-es-ar.ts`
  (que muestra `dd/mm/aaaa` con los mismos getters) y el `sameDay` de `event-timeline.ts` NO disparan.
- **(C) la puerta de atrás por locale** — `toLocaleDateString('sv-SE')` / `Intl.DateTimeFormat` devuelven
  literalmente `AAAA-MM-DD`. Hoy el árbol tiene **cero** usos de esas APIs de fecha (los ~15
  `toLocaleString` que hay son de NÚMERO es-AR y no matchean), así que la regla es gratis.
- **(D)** un cuarto test verifica que la fuente canónica **existe, es pura y usa getters LOCALES**
  ejecutándola — sin eso, vaciar `today-iso.ts` dejaba las otras tres reglas verdes.
- Auto-verificación de cobertura (`assertScanCoverage`) + válvula de escape con razón escrita obligatoria.

---

## 2. A.1 — la búsqueda

### La decisión, y por qué (el pliego pedía justificarla)

Tres opciones sobre la mesa. **Se tomaron dos mitades, cada una donde corresponde:**

**(a) Del lado del TÉRMINO, para el match EXACTO.** `SearchPlan.idvExactTerms = [tipeado tal cual, compacto]`
y el motor corre una sub-query por término. Motivo: `ap.idv = ?` **usa índice**. Compactar la columna acá
habría convertido el camino rápido de la manga (tipear la caravana completa → auto-avance sin desambiguar)
en un scan, y ese camino corre con debounce de 250 ms sobre 5.000 cabezas.

**(b) Del lado de la COLUMNA, para el match PARCIAL.** `withoutSeparators()` (`REPLACE` anidado ×4 — SQLite
no tiene `translate()` ni regex) en `buildSearchLikeQuery` cuando la columna es `idv`. Motivo: es lo **único**
que hace matchear un fragmento que **cruza** el separador (`PERF-005`, `F-005`), que son 2 de las 6 filas
rojas que midió el QA. Costo cero de plan: un `LIKE '%x%'` ya era scan.

**Lo que NO se hizo, y por qué:**
- **Normalizar lo GUARDADO** (descartada): exigiría migrar datos existentes, cambiaría lo que se exporta a
  SIGSA/SENASA (el separador es parte de lo que está impreso en la caravana) y, peor, **colisionaría en el
  índice único de `idv`** en cualquier campo donde hoy coexistan las dos formas — la migración tendría que
  elegir un perdedor. Destructivo e irreversible.
- **Compactar también el canal TAG** (descartada): la electrónica guardada son 15 dígitos puros (CHECK); ahí
  el separador es siempre de tipeo y el compacto del término ya es correcto. Hay un mutante que lo prueba
  (M17) y un test del guard que lo fija.

### El efecto colateral, dicho explícito (era la pregunta del pliego)

Si en un campo **coexisten** `PERF-00500` y `PERF00500` —hoy son dos animales distintos, el índice único los
admite— tipear cualquiera de las dos formas devuelve **los dos**.

**No se funden. Nada se escribe: la búsqueda es read-only.** Qué pasa en cada superficie:
- **Manga**: 2 candidatos → `resolveManualIdentify` devuelve **`ambiguous`** → `CandidatePicker` con las dos
  caravanas a la vista → el operario elige. **Nunca hay auto-avance sobre el equivocado.**
- **Buscador global / del rodeo**: dos filas en la lista, cada una con su idv.

Está **fijado en tests**, no en un comentario (`maniobra-identify.test.ts`, 3 casos nuevos): la colisión
desambigua; un solo animal con la caravana tipeada exacta **sí** auto-avanza (camino rápido intacto); y
tipear SIN el separador sobre un idv que lo tiene encuentra al animal pero **pide confirmación** (el texto no
es literalmente el idv guardado → `isExactMatch` false → picker). Esa última es la política correcta que ya
tenía el proyecto y que este fix no relaja.

### Las superficies: eran DOS reportadas y hay una TERCERA

El QA midió manga + buscador global. Barrido: **todas** las superficies pasan por dos motores —
`searchAnimals` (tab Animales, manga, cría al pie, asignar caravanas, find-or-create) y **`searchGroupAnimals`**
(el buscador **dentro de un rodeo/lote**, `useGroupView`). La tercera tenía el mismo agujero, por la razón
esperable: el segundo motor se escribió espejando al primero. Los dos arreglados, los dos con E2E.

**El guard va sobre eso**: `search-idv-wiring-guard.test.ts` **deriva del árbol** la lista de motores (todo
archivo de `app/src` que **importe y llame** `classifySearchQuery`) y exige que consuman `idvExactTerms`. Un
tercer motor nace en rojo. Cuatro reglas más: que ninguno pase `plan.compact` al canal exacto, que el canal
TAG **siga** usando el compacto (contrafactual: "no arreglar de más"), que el LIKE de idv use el compacto
(las dos mitades del fix tienen que quedar alineadas o el canal queda mudo), y que el guard encuentre los
motores que hoy existen.

### Un defecto adyacente que salió en la autorrevisión y se cerró acá

`tryIdvSubstring` gateaba por el término **normalizado**. Un término que es puro separador (`---`) compacta a
vacío → el patrón quedaba `%%` → **matcheaba TODA la tabla**: 20 animales arbitrarios ofrecidos como
candidatos y, en la manga, una desambiguación de 20. Ahora gatea por el **compacto**. Es preexistente y está
en la línea exacta que esta unidad tocaba, por eso se cerró acá y no en el backlog. Tiene test y mutante (M16).

---

## 3. A.5 — el desempate

`deriveCurrentState` tenía **dos** criterios: la rama reproductiva con la escalera buena
(`seq → created_at` null-as-newest `→ eventId`) y peso/condición saltando del `event_date` directo a
`eventId`, que es un **UUID v4 random**. Como `event_date` es `date` sin hora, dos cargas del mismo día
**siempre** empatan ahí ⇒ moneda.

**No se inventó criterio**: se extrajo el de la rama reproductiva a `isNewerItem(cand, best)` y lo usan las
tres. El parámetro está tipado como `EventOrderKey` (solo los 4 campos del orden) a propósito: así el
desempate **no puede** mirar nada específico de un kind y sigue siendo el mismo para todos.

**¿Hay más ramas con el mismo desempate?** Barrido: no. `deriveReproAptitude` (`repro-status.ts`) ya tenía
la escalera correcta; el histórico de circunferencia escrotal desempata **en SQL**
(`ORDER BY measured_at DESC, created_at DESC`); `sortTimelineItems` (el orden de PANTALLA) tiene su propia
escalera con `seq` antes de `eventId` y es correcta. Las tres ramas de `deriveCurrentState` eran las únicas.

**El guard va sobre la clase** (`current-state-tiebreak-guard.test.ts`), porque el bug no fue "una rama mal
escrita" sino **una rama arreglada y las hermanas no**:
- **DERIVA del código** los `kind` que `deriveCurrentState` maneja y exige que estén todos en la tabla
  `PROBES` de ese archivo → **la rama que se agregue mañana nace en rojo** (mutante M13).
- Por cada rama, **EJECUTA** la sonda del bug (dos eventos del mismo día, el VIEJO con el `eventId`
  lexicográficamente MAYOR) y exige que gane el nuevo. Sin esa elección de ids la sonda pasaría con el bug
  puesto — que es literalmente cómo el bug llegó al device (en el peso la moneda salió bien).
- Estructural: el cuerpo de `deriveCurrentState` **no puede nombrar `eventId`** (comparar ids ahí adentro ES
  el bug), tiene que llamar a **un solo** comparador, y ese comparador tiene que consultar `seq` y
  `createdAt` **antes** que `eventId` (mutante M12: dar vuelta la escalera → 8 tests rojos).
- Un test final **ejecuta el comparador VIEJO** re-implementado y verifica que da el resultado contrario:
  si diera lo mismo, todo lo de arriba sería decorativo.

---

## 4. Mutantes — 27 lanzados, 27 muertos

| # | Mutante | Esperado | Obtuvo |
|---|---|---|---|
| M1 | `carga.tsx` vuelve al `toISOString().slice(0,10)` (el bug original) | ROJO | ROJO |
| M2 | el mismo bug escrito con `.substring(0, 10)` | ROJO | ROJO |
| M3 | el mismo bug con `.split('T')[0]` | ROJO | ROJO |
| M4 | el mismo bug partido en 3 líneas por el formatter | ROJO | ROJO |
| M5 | **re-inlinear la forma local con otro nombre** (`fechaDeHoy()`) | ROJO | ROJO |
| M6 | idem con los getters hoisteados a consts | ROJO | ROJO |
| M7 | puerta de atrás `toLocaleDateString('sv-SE')` | ROJO | ROJO |
| M8 | la fuente canónica pasa a getters **UTC** (no-op del fix) | ROJO | ROJO |
| M9 | **control en verde**: un instante real serializado ENTERO | VERDE | VERDE |
| M10 | A.5: el comparador vuelve al desempate por `eventId` | ROJO | ROJO |
| M11 | A.5: se agrega un **segundo** comparador solo para peso | ROJO | ROJO |
| M12 | A.5: el `eventId` se consulta ANTES que `seq` | ROJO | ROJO |
| M13 | A.5: una rama vigente NUEVA sin declararla en la tabla | ROJO | ROJO |
| M14 | A.1: el LIKE vuelve a comparar contra la columna sin compactar | ROJO | ROJO |
| M15 | A.1: `idvExactTerms` vuelve a ser solo el compacto | ROJO | ROJO |
| M16 | A.1: el substring vuelve a gatear por el normalizado (`%%`) | ROJO | ROJO |
| M17 | A.1: se compacta **también** la caravana electrónica | ROJO | ROJO |
| M18 | A.1: solo 3 de los 4 separadores se descartan de la columna | ROJO | ROJO |
| M19 | wiring: `group-page` vuelve a pasar `plan.compact` al exacto | ROJO | ROJO |
| M20 | wiring: `searchAnimals` idem (el bug original) | ROJO | ROJO |
| M21 | wiring: el LIKE de idv corre con el término normalizado | ROJO | ROJO |
| M22 | wiring: el canal TAG pasa a usar el término tipeado | ROJO | ROJO |
| M23 | **control en verde**: un motor nuevo que consume bien `idvExactTerms` | VERDE | VERDE |
| M24-26 | **E2E**: los tres fixes revertidos + rebuild del `dist` | 5/5 ROJO | 5/5 ROJO |
| M27 | E2E, contra-corrida: fixes restaurados + rebuild | 5/5 VERDE | 5/5 VERDE |

Los scripts de mutación quedaron en el scratchpad (no en el repo).

---

## 5. Trazabilidad — hallazgo → test concreto

| hallazgo | test | archivo:caso |
|---|---|---|
| **A.2** valor de la función | `today-iso.test.ts` : "la última hora del día LOCAL sigue siendo hoy" (con contrafactual TZ-consciente; corrido en AR, UTC y Tokyo) |
| A.2 clase (UTC) | `today-iso-guard.test.ts` : "nadie deriva una fecha date-only recortando un toISOString" |
| A.2 clase (duplicación) | idem : "nadie compone un `AAAA-MM-DD` a mano desde los getters" |
| A.2 clase (locale) | idem : "nadie deriva una fecha por LOCALE" |
| A.2 fuente viva | idem : "la fuente canónica existe, es PURA y devuelve el día LOCAL" |
| A.2 **end-to-end** | `e2e/qa-fixes-datos.spec.ts` : "A.2 vacunación masiva a las 22:54" — reloj congelado + huso AR fijado + **lectura de la fila real en el server** |
| A.2 preview | `maneuver-category-preview.test.ts` (suite completa verde con el `today` inyectado) |
| **A.1** plan | `animal-identifier.test.ts` : 5 casos `A.1:` (par de términos, sin duplicar, los 4 separadores, puro-separador, canal TAG) |
| A.1 SQL | `local-reads.test.ts` : 3 casos `A.1` — incluye uno que **EVALÚA** el predicado contra las 6 filas rojas del QA, no solo mira el texto del SQL |
| A.1 wiring | `search-idv-wiring-guard.test.ts` : 5 casos |
| A.1 colateral | `maniobra-identify.test.ts` : 3 casos `A.1` (colisión → picker; exacto → auto-avance; sin separador → confirmación) |
| A.1 **end-to-end ×3 superficies** | `e2e/qa-fixes-datos.spec.ts` : buscador global (7 términos), buscador del rodeo, manga |
| **A.5** valor | `event-timeline.test.ts` : 7 casos `A.5` (peso, el caso exacto del A07, orden de entrada, sin `seq`, null-as-newest, rama repro, las 3 juntas) |
| A.5 clase | `current-state-tiebreak-guard.test.ts` : 10 casos (tabla derivada + sonda por rama + estructura + contrafactual) |
| A.5 **end-to-end** | `e2e/qa-fixes-datos.spec.ts` : "con dos cargas del MISMO día, Estado actual muestra la última" |

---

## 6. La pregunta de Raf: los datos ya cargados

**Sí, quedan mal para siempre si nadie los corrige** — el valor guardado en la columna `date` es el
equivocado y la app no lo recalcula nunca. Pero **son identificables y, en principio, reparables**, porque el
`created_at` (timestamptz) sí guarda el instante real.

**La firma**: `event_date > (día LOCAL de AR del created_at)`. La app **nunca** permite post-datar
(`validateEventDate` rechaza futuro, y la manga escribe siempre "hoy"), así que una fecha posterior al día en
que la fila se creó **solo** puede venir de haber derivado "hoy" en UTC.

**Query** (SQL directo; UTC−3 fijo, Argentina no tiene DST):

```sql
-- una por tabla; la columna de fecha cambia según la tabla
select count(*) from weight_events
 where weight_date > (created_at at time zone 'America/Argentina/Buenos_Aires')::date;
--  condition_score_events.event_date · sanitary_events.event_date · reproductive_events.event_date
--  lab_samples.collection_date       · scrotal_measurements.measured_at
```

**Medido en DEV (solo lectura, NO se tocó nada)** — se descontaron los establecimientos de fixtures E2E
(nombre `e2e_…`), que aportaron **0**:

| tabla | filas | **corridas** |
|---|---|---|
| `weight_events` | 461 | **11** |
| `condition_score_events` | 284 | **10** |
| `sanitary_events` | 1014 | **27** |
| `reproductive_events` | 957 | **20** |
| `lab_samples` | 47 | **14** |
| `scrotal_measurements` | 20 | **4** |
| | | **86 en total** |

Todas tienen la firma exacta: `created_at` entre las 00:00 y las 03:00 UTC (= 21:00–00:00 AR) y `event_date`
= el día siguiente. La más vieja es del **16/06/2026**, así que el bug lleva al menos ~7 semanas corriendo.
Ejemplos: `weight_events 348868a4… weight_date=2026-08-07, created_at=2026-08-07T01:40Z (local 2026-08-06)`.

**Recomendación (NO aplicada, decide Raf)**: un `UPDATE … SET <fecha> = (created_at at time zone
'America/Argentina/Buenos_Aires')::date WHERE <la firma>` corrige las 86 con exactitud, porque el
`created_at` de esas filas es el instante REAL de creación. Dos avisos antes de tocar nada: (1) los eventos
reproductivos disparan triggers de transición de categoría al cambiar — hay que verificar si un UPDATE de
`event_date` los re-dispara; (2) conviene correrlo con la app cerrada, para que PowerSync no traiga de vuelta
una versión vieja por LWW.

---

## 7. Verificación — qué ejecuté y qué solo leí

**EJECUTADO Y VISTO:**
- `pnpm typecheck` → verde (dos corridas dieron un error transitorio en `Card.tsx` / `StickStatusIndicator`
  que **no es mío**: la otra terminal está escribiendo esos archivos en paralelo; con el archivo estable el
  typecheck es verde).
- `node scripts/check.mjs` → **RC=0**, client unit **2937 / 2937**, 0 fail en las 16 suites.
- Las 14 suites que esta unidad toca, juntas: **552 / 552**.
- **27 mutantes** (tabla §4), incluidos los de E2E con rebuild del `dist`.
- E2E nueva `qa-fixes-datos.spec.ts`: **5/5 verde** · **5/5 roja** con los fixes revertidos.
- E2E de regresión de las superficies tocadas (`identificadores-unificados`, `animals`, `events`,
  `operaciones-vacunacion`, `operaciones-destete`): **59 pass / 6 fail**.
- Capture del Gate 2.5: **1/1**, **8 PNG** generados y **mirados uno por uno**.
- Conteo de filas afectadas en DEV: script de solo-lectura vía PostgREST.
- `git diff supabase/ sync-streams/` → **vacío**.
- `node scripts/check-hardcode.mjs` → 0 violaciones.
- `git status design/` → **limpio** (esta unidad no corrió capturas de `design/`).

**LEÍDO, no ejecutado:** el impacto de un eventual UPDATE de reparación sobre los triggers de transición de
categoría (§6, aviso 1). No lo probé porque el pliego dijo explícitamente que no tocara las filas.

### Los 6 rojos de la regresión E2E: flakes pre-existentes, con evidencia

Todos con la **misma firma**, que además ya está documentada en `docs/backlog.md` (entrada del locator de
`lotes.spec.ts`): `getByText(…).first()` **resuelve** a un `<span>` que existe pero está `hidden` (agarra una
copia oculta/truncada en vez de la visible). No es un fallo funcional.

Re-corridos **en aislamiento**: **5 de los 6 pasan** (`animals:74`, `animals:1468`, `events:286`,
`events:1008`, `operaciones-destete:154`). El sexto (`animals.spec.ts:397`, "vaquillona sin año") se corrió
**3 veces**: **1 verde / 2 rojas** → flaky, no determinista. Ninguno toca fecha, búsqueda ni desempate: los
tres asertan la visibilidad de un texto de categoría o de caravana en la ficha.

⚠️ **Lo que NO puedo afirmar**: no corrí la suite E2E **completa** (~38 min) ni la comparé contra un
baseline limpio, porque el `dist` que se buildea incluye también los cambios sin commitear de la otra
terminal (que está tocando `StickStatusIndicator`, `GroupViewScreen`, `reportes.tsx`, `Card.tsx`). Un
baseline honesto exige un árbol quieto.

---

## 8. Autorrevisión adversarial

Lo que busqué, y lo que encontré. **Los dos hallazgos grandes son tests míos que pasaban por la razón
equivocada** — los dos aparecieron recién al falsificar, no al leer.

### 🔴 1 — El guard de A.2 no miraba NADA, y su propio test de detección lo tapaba

La regex se componía como `` `${TO_ISO}String\\(\\)` `` sobre un `TO_ISO` que **ya valía** `toISOString` →
buscaba `toISOStringString()`, o sea nada. Y el test "el guard DETECTA las firmas" construía su caso
sintético con **el mismo `TO_ISO`**, así que reproducía el error y daba verde.

**Resultado medido: 4 mutantes sobrevivieron al guard entero** (M1–M4, incluido el bug original tal cual
estaba escrito en `carga.tsx`). El guard habría entrado al repo pareciendo que cuidaba algo.

**Cómo lo cerré**: dos constantes con **particiones distintas** (`['toISO','String']` para la regex,
`['to','ISOString']` para los fixtures) + un assert de que las dos coinciden. Un desalineamiento entre la
regex y su fixture ya no puede cancelarse solo, porque el fixture no deriva de lo que la regex usa. Los 4
mutantes pasaron a ROJO.

*Es exactamente la clase de bug que esta sesión viene cerrando —"el verificador y su verificación comparten
el error"— cometida por mí, en el guard escrito para no cometerla.*

### 🔴 2 — Dos de los cinco E2E pasaban con el bug entero puesto

Al correr los E2E contra el build mutado (fixes revertidos), `A.1 buscador global` y `A.1 buscador del rodeo`
dieron **verde**. Causa: la fila del animal **ya está en pantalla** antes de tipear (la lista sin filtrar), así
que `toBeVisible()` resolvía al instante y el debounce de 250 ms ni llegaba a correr. El test miraba la lista
vieja.

**Cómo lo cerré**: un **señuelo** — un animal que no matchea ningún término. La secuencia pasó a ser
"el señuelo DESAPARECE ⇒ la lista ya muestra resultados de búsqueda" y **recién ahí** se pregunta por el
target; más un `fill('')` + espera de que el señuelo vuelva **entre término y término**, para que el estado
observado sea el de ESA búsqueda y no el que dejó la anterior. Con el mutante, los 5 dan rojo.

### Lo demás que busqué

- **Cobertura del pliego**: el pliego decía 8 sitios de fecha; son **12**. Los 12 unificados.
- **Semántica por call site** (lo pedía explícitamente): tabla en §1. Encontré que **sí hay lugares donde UTC
  es correcto** —los ~10 `toISOString()` de instantes (`created_at`, `deleted_at`, `lastSyncedAt`)— y NO se
  tocaron; el guard tiene un control en verde (M9) que lo prueba.
- **Superficies**: el pliego pedía verificar si había una tercera. **La hay** (`searchGroupAnimals`).
- **Edge cases no testeados**: el `%%` sobre toda la tabla (§2, cerrado); `idv` NULL bajo el `REPLACE`
  (`NULL LIKE …` → NULL → fila excluida, mismo comportamiento que antes); término de 64 chars capado (los dos
  términos siguen ≤64).
- **Seguridad**: los literales del `REPLACE` son constantes y el término va **parametrizado** — verificado
  ejecutando el builder con `5%_x'` y mirando los args (`%5\%\_x'%`, escapado). El scope de tenant
  (`ap.establishment_id = ?` en las dos ramas del UNION) sigue en el SQL generado — verificado ejecutando, no
  leyendo. Cero cambios en `supabase/` → Gate 1 N/A.
- **Offline-first**: nada nuevo toca la red. La búsqueda sigue siendo SQLite local; `todayIsoLocal` es pura.
- **Multi-tenant**: ningún `establishment_id` hardcodeado; no toqué `buildSearchUnion`.
- **Rendimiento**: +1 sub-query exacta (indexada) solo cuando el término tiene separador; el LIKE de idv pasa
  a evaluar 4 `REPLACE` por fila en una sub-query que ya era scan.
- **Contrato público**: `link-calf-query.ts` dejó de exportar `todayIsoLocal` (§1) — marcado para que el
  leader lo vete si prefiere un re-export. `SearchPlan` ganó un campo: **aditivo**, no rompe.
- **`seq` en las ramas nuevas**: verifiqué en el código que `fetchTimeline` asigna `seq` sobre el UNION
  **completo** (los 7 orígenes), así que el orden relativo dentro de una rama sigue siendo
  `(event_date, created_at nulls-last)` — que es la semántica que el desempate necesita. Los writes de
  `weight_events`/`condition_score_events` **no** setean `created_at` de cliente (a diferencia de los
  reproductivos), así que en local quedan NULL hasta el sello del trigger: por el `created_at IS NULL ASC`
  del ORDER BY caen al final = `seq` mayor = más recientes. Correcto, y hay test (`null-as-newest`).

---

## 9. Reconciliación de specs (regla dura §9)

| archivo | qué se reconcilió |
|---|---|
| `specs/active/02-modelo-animal/requirements-identificadores-unificados.md` | nota bajo **IDU.4.3**: por qué el canal idv corría solo con el compacto y cómo quedó (dos términos + columna compactada) |
| `specs/active/02-modelo-animal/design-identificadores-unificados.md` | bloque **AS-BUILT** en la sección de `classifySearchQuery`: las dos mitades del fix con su motivo, `idvExactTerms`, el gate del substring por el compacto, **el efecto colateral declarado** y el guard de wiring |
| `specs/active/02-modelo-animal/requirements.md` | nota bajo **R10.3** (cronología/ficha): "Estado actual" desempata igual en todas sus ramas; el porqué y el guard derivado |
| `specs/active/03-modo-maniobras/requirements.md` | nota bajo **R5.11**: la fecha del evento es el día LOCAL; fuente única + guard app-wide; menciona el arrastre a spec 10 y al preview R8.4 |
| `specs/active/10-operaciones-rodeo/requirements.md` | nota antes de **R6.2**: "la fecha de la operación" es local; y que **no hay impacto retroactivo** en la clave idempotente |

No se reescribió ningún EARS (notas de reconciliación, como en `impl_13`). No hay `tasks.md` que marcar: esta
unidad es un bugfix dirigido por el pliego del leader, no una feature con spec propio.

---

## 10. Entregables

**Nuevos**
- `app/src/utils/today-iso.ts` — la fuente única de "hoy"
- `app/src/utils/today-iso.test.ts` · `today-iso-guard.test.ts`
- `app/src/utils/current-state-tiebreak-guard.test.ts`
- `app/src/services/search-idv-wiring-guard.test.ts`
- `app/e2e/qa-fixes-datos.spec.ts` (5 tests) · `app/e2e/captures/qa-fixes-datos.capture.ts` (8 shots)

**Modificados (código)** — `app/app/{maniobra/carga,seleccion-masiva,vacunacion-masiva,agregar-evento,crear-animal,animal/baja,lote/venta}.tsx` ·
`app/src/components/{LinkCalfPrompt,TreatmentApplicationSheet,TreatmentStartSheet}.tsx` ·
`app/src/services/{animals,group-page}.ts` · `app/src/services/powersync/local-reads.ts` ·
`app/src/utils/{animal-identifier,event-timeline,link-calf-query,animal-birth-year,maneuver-category-preview}.ts` ·
`scripts/run-tests.mjs` (los 4 tests nuevos registrados en la lista explícita, con su párrafo de por qué)

**Modificados (tests)** — `animal-identifier.test.ts` · `event-timeline.test.ts` · `local-reads.test.ts` ·
`link-calf-query.test.ts` · `maniobra-identify.test.ts`

**No tocados** (pliego): `src/features/ble-stick/**`, `nav-target-bands*`, `tap-target-collision-guard*`,
`StickStatusIndicator.tsx`, `progress/qa_maniobras-device.md`, los specs nuevos de ficha. Tampoco el device.

---

## 11. Para el Gate 2.5 — las capturas

`pnpm exec playwright test e2e/captures/qa-fixes-datos.capture.ts --config playwright.capture.config.ts`
→ **1 passed**, 8 PNG en `app/e2e/captures/__shots__/qa-fixes-datos/` (gitignored; el `.capture.ts` se
commitea).

Esta unidad **no tocó una línea de JSX**, pero sí cambia lo que se ve en tres pantallas, así que las capturas
son de **estados de contenido**:

- `01` buscador global con la caravana **completa con guion** tipeada → el animal aparece. **Es el estado que
  el QA no pudo obtener en el A07** (ahí esta pantalla mostraba lo de `04`).
- `02` fragmento que cruza el guion · `03` la misma caravana en minúsculas.
- `04` **CONTRASTE**: "No encontramos…" + **"Dar de alta este animal"** — eso, sobre un animal que SÍ existe,
  es lo que producía el duplicado. Se lee **contra `01`**.
- `05` manga, entrada manual con la caravana tipeada · `06` el auto-avance a la carga rápida sobre el animal
  correcto (con el bug acá salía el hero "Animal nuevo").
- `07` ficha, "Estado actual": **318 kg · Hoy** y **3,75 / 5 · Hoy** (con el bug: 312 y 2,25).
- `08` el historial con las **cuatro** cargas intactas — el control de que el fix cambia cuál es el VIGENTE y
  no borra nada. Se lee junto a `07`.

⚠️ **A.2 no tiene captura, y lo digo en el archivo**: el bug era el VALOR de una columna `date` del server y
la pantalla de la vacunación masiva no muestra la fecha en ningún lado. Una captura de esa pantalla se vería
**idéntica con el bug puesto**. Su oráculo es la fila real en la DB, en el E2E.

---

## 12. Lo que queda abierto (no bloquea)

1. **Las 86 filas corridas en DEV** — decisión de Raf (§6). No las toqué.
2. **`link-calf-query.ts` dejó de exportar `todayIsoLocal`** — cambio de contrato deliberado, vetable.
3. **Los 6 flakes de E2E** (§7) — pre-existentes, misma firma que la entrada del backlog. Si el leader quiere,
   van al backlog con el diagnóstico (`.first()` agarra la copia oculta; el arreglo es scopear el locator).
4. **Suite E2E completa sin correr** — necesita el árbol quieto (la otra terminal está editando en paralelo).
5. **Device**: no se usó el A07, como pidió el pliego. Los tres arreglos son verificables en web y el E2E los
   cubre, pero **A.2 en el teléfono real depende del reloj del device**, así que una pasada nocturna en el A07
   sigue siendo la confirmación final del hallazgo que el QA midió ahí.

---
---

# FIX-LOOP (2026-08-07) — respuesta al CHANGES_REQUESTED de `progress/review_qa-fixes-datos.md`

**Estado**: cerrado. `check.mjs` **RC=0** · client unit **2946/2946** · typecheck verde · **28 mutantes
nuevos, 28 muertos** · E2E de la unidad **5/5** · `design/` limpio · **nada commiteado**.

El reviewer aprobó los tres fixes de producto (los verificó ejecutando) y bloqueó por una **tercera
instancia de la clase que yo mismo había confesado**: el guard de A.2 no veía la forma dominante del bug.
Tenía razón, y la causa raíz que nombró es la correcta: **los fixtures del guard se escribieron de memoria
en vez de sacarse del código que el guard existe para prohibir.**

---

## 1. 🔴 BUG VIVO — el mismo A.2, con getters, en producción (lo peor que salió del fix-loop)

El reviewer marcó `animal-category.ts` como "prueba de que el punto ciego está habitado". Lo fui a mirar y
**no era una firma ocupada: era un bug corriendo**. Y buscando su clase apareció **un segundo**.

| dónde | qué hacía | qué rompía |
|---|---|---|
| `animal-category.ts` `startOfDay` (→ `ageInDays` y `imputeBirthDateForCategory`) | `Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())` sobre un **instante real** | de 21:00 a 23:59 (AR) **todo animal figuraba un día más viejo** → el corte de **365 días** (ternera/vaquillona, ternero/torito) se cruzaba 3 h antes **todos los días**; y la ventana de imputación del alta year-only se corría un día |
| `repro-status.ts` `ageInDaysFromBirthDate` | el mismo idiom; `carga.tsx:1243` le pasa `new Date()` | esa edad alimenta `isReproApt` (RAR.6.1) → **decide si la manga OFRECE INSEMINAR**. Después de las 21:00 se le ofrecía inseminación a una vaquillona que todavía no llegaba al año |

**Por qué importa más que un off-by-one**: la categoría derivada alimenta el denominador reproductivo de
los reportes (`0105`, rama `eligible_natural`), así que un animal que cruza el corte antes de tiempo entra
al conjunto "servidas" y mueve un KPI.

**Cómo quedó**: una sola función más en la fuente única — `localDayAnchorUtc(now)`
(`utils/today-iso.ts`), que es el **único puente admitido** entre "instante real" y "dominio date-only".
Los dos call sites la usan.

**La distinción fina, que es la que se sigue confundiendo y quedó escrita en el código**: normalizar a
medianoche UTC un `Date` que **YA ES** una fecha date-only parseada (`animal-form.ts`, `event-input.ts`,
`isoUtcDate`, `parseIsoDate`) es **correcto** — ese dominio es UTC por diseño. Lo que nunca es correcto es
leer los componentes **UTC de un INSTANTE real**. Por eso el fix no toca `isoUtcDate`, como marcó el leader.

**Tests**: 5 nuevos (3 en `animal-category.test.ts`, 2 en `repro-status.test.ts`), todos construidos sobre
el instante que produce la divergencia (22:54 AR = 01:54 UTC del día siguiente, la hora que midió el QA), y
todos con la guarda de "si el runner no está al oeste de UTC, este caso no se ejercita" en vez de dar un
verde mentiroso. **Falsificados: revertir el ancla mata los 5.**

**Y hubo que corregir los ANCLAS DE LOS TESTS VIEJOS.** `animal-category.test.ts` fijaba "hoy" como
`new Date(Date.UTC(2026, 5, 1))`, que en AR **es el 31 de mayo a las 21:00** — o sea que el test decía una
fecha y fijaba otra. Con el ancla correcta, 4 tests de borde (365/729/730 días) caían. Pasaron a componentes
**locales al mediodía** (`new Date(2026, 5, 1, 12, 0, 0)`), que es la forma sin ambigüedad, y el helper
`isoDaysAgo` a aritmética de calendario local. No es cosmético: esos 4 tests estaban midiendo el corte
contra un ancla corrida.

---

## 2. 🔴 El guard reescrito — el oráculo ahora sale del git

### Lo que medía el reviewer, reproducido

Revirtió los 12 archivos a su forma pre-fix literal: **7 dejaban el guard verde**. Causa exacta: la ventana
de la regla B arrancaba **en** `getFullYear()` y miraba 400 chars **hacia adelante** pidiendo `getDate()`;
la forma real del repo pone `mm`/`dd` en consts **antes**. Y la propia fuente canónica tiene esa forma y
está exenta, así que nada lo delataba.

### La propiedad, escrita como test

> **Revertir cualquiera de los 13 archivos a su forma pre-fix tiene que poner el guard en ROJO.**

El test `PROPIEDAD` trae con `git show 1922e0e:<archivo>` el cuerpo **LITERAL** de cada uno y exige que
dispare al menos una regla. **Es la única versión que no se puede escribir de memoria** — y se ganó el
lugar en la primera corrida: cazó que mi regla D nueva (`Date.UTC(…getUTC…)`) no matcheaba **nada**, porque
había escrito el salto entre getters como `[^)]*` y entre ellos hay un `getUTCMonth()`, o sea paréntesis.
El mismo error que la regex de `toISOStringString`, cazado esta vez por el oráculo en vez de por el reviewer.

### Las cuatro reglas

| | qué prohíbe | evasiones que ahora cierra |
|---|---|---|
| **A1** | recortar un `toISOString()`/`toJSON()` pegado | `substring`, `substr`, `split('T')`, partido en 3 líneas, **`toJSON()`** (alias exacto) |
| **A2** | el ISO **a una variable** y el recorte después | `const iso = d.toISOString(); return iso.slice(0,10)` — incluso con anotación de tipo |
| **B** | componer `AAAA-MM-DD` a mano desde getters de `Date` | ventana **bidireccional** (la forma real del repo), consts hoisteadas, `join('-')`, **el guion detrás de una const**, getters **UTC** |
| **C** | derivarla por locale (`sv-SE`/`en-CA`) | — |
| **D** | anclar un instante por sus componentes **UTC** | el 🔴 vivo de §1 |

**Dos afinaciones salieron de MEDIR contra el árbol, no de imaginar** (y las dejo escritas en el código
porque son justo donde un guard se vuelve inusable):

1. La regla D primero marcaba los **parsers** de fechas date-only (`Date.UTC(year, month-1, day)` + la
   validación de desborde que lee los mismos getters) → 3 falsos positivos legítimos. Ahora exige que los
   getters estén **en los argumentos** de `Date.UTC(...)`.
2. La regla B marcaba `import/normalize-row.ts`, que recompone la ISO desde números ya parseados. El
   discriminador real es que el getter se use **como VALOR** y no dentro de una **comparación**
   (`d.getUTCMonth() !== month - 1`). Con eso, `sameDay` y los validadores de desborde dejan de disparar.

**Exenciones: cuatro, cada una con su motivo escrito**, y un test que verifica que existen, que el motivo
no es una etiqueta vacía y que no pueden crecer sin que alguien lo note.

**Lo que el guard NO ve, declarado en el propio archivo**: dos o más niveles de indirección para el
separador (`const A = B`), un separador importado, o uno construido en runtime. Para eso hace falta un AST.

### Falsificación: 28 mutantes, 28 muertos

| bloque | qué | resultado |
|---|---|---|
| **13 reverts** | cada archivo a su cuerpo pre-fix REAL (git) | **13/13 ROJO** (antes: 7 verdes) |
| **RX4** | el helper viejo con otro nombre, en archivo nuevo — *el caso que el pliego nombró textualmente* | ROJO |
| **RX5** | el ISO a una variable, recorte después | ROJO |
| **RX6** | `toJSON()` | ROJO |
| **RX7** | el guion desde una const de módulo | ROJO |
| **RX8** | getters UTC compuestos a mano | ROJO |
| **RX8b** | el ancla por día UTC de un instante (el 🔴 vivo) | ROJO |
| **RX1 / locale** | UTC directo en pantalla nueva · `sv-SE` | ROJO |
| **4 controles en VERDE** | instante entero · consumir la fuente canónica · display `dd/mm/aaaa` · parser date-only | VERDE |
| **3 relajaciones del propio guard** | regla B solo hacia adelante (el bug del guard viejo) · A sin `toJSON` · D desactivada | **PROPIEDAD cae en las 3** |

---

## 3. 🔴 La spec que mentía — corregida

`specs/active/03-modo-maniobras/requirements.md` (nota bajo **R5.11**) afirmaba que el guard hacía que "el
próximo call site nazca en rojo". Era falso para la forma dominante. Reescrita con el **alcance real**: las
cuatro reglas nombradas una por una, las cuatro excepciones, y un párrafo nuevo que cuenta que el oráculo se
deriva del git y **que en el fix-loop apareció el 🔴 vivo** de §1 con sus consecuencias. Mismo tratamiento en
los headers de `today-iso.ts` y del guard (y el conteo "NUEVE" → **TRECE**, que el reviewer marcó como
contradictorio con el informe).

---

## 4. Los no-bloqueantes del reviewer

| # | qué | cómo quedó |
|---|---|---|
| 🟠 3.1 | el cross-reference declarado y ausente | `format-date-es-ar.ts` tiene ahora el puntero recíproco a `today-iso.ts` (con el porqué de la separación display/máquina). **Y la regla app-wide se escribió en `docs/conventions.md`**, con sus 4 prohibiciones y el motivo de por qué es regla dura y no recomendación — por jerarquía de verdad, una regla app-wide no puede vivir solo en un comentario |
| 🟡 3.2 | "NUEVE" vs "doce" | unificado en **13** (los 12 + `animal-category.ts`) en código, informe y spec |
| 🟡 3.3 | el test "evaluado, no leído" corría un espejo JS | reemplazado: ahora **ejecuta el SQL REAL** que genera el repo contra `node:sqlite`, con las 9 tablas del `buildSearchUnion`, las 10 filas del barrido del QA, el control de no-comodín **y el de no-fuga cross-tenant**. Falsificado con 2 mutantes (falta el separador guion · la columna sin compactar): **los dos mueren** |
| 🟡 3.4 | evasiones del guard de A.5 | el extractor acepta `==`/comillas dobles/backtick **y declara lo que no ve**: audita cuántas veces se nombra `it.kind` vs. cuántas entiende, y si no cuadra se pone rojo. Mutante (`const k = it.kind`) → ROJO |
| ⚪ 3.5 | el seeder de E2E derivaba `event_date` en UTC | corregido: los dos seeders de eventos reproductivos usan un `todayLocalIso` local a `e2e/helpers/admin.ts` (con la nota de por qué no importa el de la app). Una corrida nocturna ya no siembra con fecha de mañana |
| ⚪ 3.6 | el preview mezclaba día LOCAL con `startOfDay` UTC | **resuelto de raíz**: era el 🔴 vivo de §1. Las dos mitades usan ahora el mismo día local |
| ⚪ 3.7 | contrato público de `link-calf-query` | sin cambios (el reviewer no objetó); sigue marcado para veto del leader |

---

## 5. Verificación de este fix-loop

**EJECUTADO Y VISTO**

- `pnpm typecheck` verde · `node scripts/check.mjs` **RC=0**, client unit **2946/2946**, 0 fail.
- **28 mutantes** (tabla §2) + los 5 de falsificación de los tests del 🔴 vivo + 2 del oráculo SQL real.
- E2E de la unidad: rebuild del `dist` + **5/5 verde**.
- E2E de regresión de las suites que el cambio de categoría podía mover (`animals`, `events`):
  **50 pass / 4 fail**.
- Capture del Gate 2.5 re-corrida contra el build nuevo: **1/1**, 8 PNG.
- `git status design/` → **limpio**. Sin residuo de mutantes (`zz-mutante-tmp.ts` borrado, archivos
  restaurados, `git status` verificado).

**Los 4 rojos de E2E, con su evidencia** — ninguno es de este fix-loop:

- `animals:626` (baja) y **`animals:786` (delta override-imputación, el que SÍ toca lo que cambié)**:
  **pasan en aislamiento**. Que el de imputación pase es la verificación que importa: mi cambio de ancla no
  flipeó ninguna categoría.
- `animals:74` y `animals:397`: **flaky, 1 de 3 verdes cada uno**, y ya fallaban **antes** de este fix-loop
  (están en la corrida de regresión de la primera pasada). Los cuatro tienen la firma documentada en
  `docs/backlog.md`: `getByText(…).first()` resuelve a un `<span>` que existe pero está `hidden` — es el
  locator, no la funcionalidad.

**NO VERIFICADO (declarado)**

- La suite E2E completa contra un baseline limpio: el árbol tiene la otra unidad en vuelo.
- El A07. Los dos 🔴 vivos son de reloj, así que su confirmación final en device depende de correr algo
  después de las 21:00 en el teléfono.
- **Si las 86 filas corridas de DEV tienen ahora compañía**: el 🔴 vivo de §1 no escribe datos (deriva
  categoría y aptitud en el momento), así que no dejó filas mal — pero **sí pudo escribir un
  `category_override` equivocado** en altas year-only hechas de noche, y esa columna sí es persistente. No
  lo medí: queda para el leader decidir si vale una query.

## 6. Autorrevisión del fix-loop

- **La causa raíz que nombró el reviewer la absorbí, no la parcheé.** El arreglo no fue "agregar la forma
  que faltaba" (eso habría sido la cuarta instancia del mismo error): fue **cambiar de dónde sale el
  oráculo**. Ahora el guard se prueba contra el código que existió, no contra el que imaginé.
- **El nuevo oráculo se ganó el puesto en su primera corrida**, cazando que mi regla D no matcheaba nada.
  Lo dejo escrito en el código porque es la mejor evidencia de que sirve.
- **Fui a mirar el "no es hipotético" del reviewer antes que nada** y resultó peor de lo reportado: no una
  firma ocupada sino **dos bugs vivos**, uno de ellos en la pantalla que el QA estaba probando.
- **Lo que corregí de mis propios tests viejos** (los anclas UTC de `animal-category.test.ts`) es un
  hallazgo aparte: 4 tests de borde estaban midiendo contra un ancla corrida un día. Podrían haber
  enmascarado el bug vivo si alguien lo hubiera buscado por ahí.
- **Dónde sigo sin poder afirmar nada**: en un runner en UTC, los 5 tests del 🔴 vivo se auto-declaran "no
  ejercitados" en vez de fallar. Es la decisión honesta (el caso no existe sin desfasaje), pero significa
  que en un CI en UTC esa red no protege. Está dicho en cada test.
