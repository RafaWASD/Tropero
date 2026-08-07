# Review — delta spec 02 «ficha-categoria-tacto»

**Reviewer**: agente reviewer · **Fecha**: 2026-08-07 · **Baseline**: `fc5aa2f` (diff sin commitear)
**Alcance**: review ACOTADA a los dos puntos que pidió el leader (§1 y §2). Todo lo demás se declara
explícitamente como **no verificado** en §5 — no es aprobación tácita.

**Veredicto**: **CHANGES_REQUESTED** (detalle y prioridades en §5)

---

## §0 — Método

- Read-only sobre el producto. Cero `git add`, cero edición de código de app/tests.
- Mutantes aplicados de a UNO, sin `check.mjs` de fondo, restaurados y verificados con `git diff` + md5.
- Contexto acotado por pedido: `progress/impl_ficha-categoria-tacto.md`, el `git diff` y
  `requirements-ficha-categoria-tacto.md`. No se releyó el proyecto entero.

_(secciones siguientes se completan a medida que avanza la review)_

---

## §1 — 🔴 `resolveRevertCategory`: el fix es CORRECTO pero NO tiene un solo test

### 1.a — Qué cambia realmente (medido, no leído)

Diferencial EJECUTADO sobre `computeCategoryCode` (producto cartesiano sexo × 5 `birth_date` × 5 juegos de
eventos × `is_castrated` real): **21 casos cambian de resultado, y los 21 son `sex='male' AND
is_castrated=true`**:

```
male/* /real=true : torito -> novillito   (11 casos)
male/* /real=true : toro    -> novillo    (10 casos)
```

Cero hembras, cero machos enteros. O sea, sobre la pregunta que me hiciste:

> **«¿"Quitar fijación" sigue haciendo exactamente lo de antes en todos los casos que ya cubría?»**
> **SÍ, con una excepción y es una mejora.** Es byte-idéntico para toda hembra y para todo macho ENTERO.
> Para un macho CASTRADO escribía la categoría equivocada (`torito`/`toro`) con `override=false`, y ahora
> escribe la correcta (`novillito`/`novillo`). El estado final visible ya era el mismo (el server recomputaba
> al subir); lo que cambia es que el estado LOCAL transitorio deja de mentir. No hay caso donde el
> comportamiento previo fuera preferible.
> El tercer consumidor de la función —`resolveCutCategory` (desmarcar CUT en la manga)— es female-only por
> `canUnmarkCut`, así que cae íntegro en la zona de "cero cambio".

### 1.b — P2 se cumple en el código, pero solo está VERIFICADO para hembras

- La regla vive en `decideCategoryPin` (`category-pin-core.ts:100-108`): `derived.code === chosen.code` →
  `writeRevert` → `{override:false}`. Correcta, y cubierta por `category-pin-core.test.ts` con fakes.
- El insumo `derived` de esa comparación sale de `resolveRevertCategory`. **Y esa parte no la testea nadie.**

**Mutante M1** — restaurar el defecto pre-existente (`animals.ts:1368`
`isCastrated: toBool(row.is_castrated ?? 0)` → `isCastrated: false`):

| Corrida | Resultado |
|---|---|
| Suite unit COMPLETA del repo (`run-tests.mjs`, 3021 tests) | **3021 pass / 0 fail — el mutante SOBREVIVE** |

No es sorpresa estructural: no existe ningún `animals.test.ts` (el service value-importa el SDK), así que la
única red posible es E2E — y **ningún E2E siembra un macho castrado con la fijación puesta**. Los dos únicos
specs que siembran `isCastrated: true` (`ficha-circunferencia-escrotal.spec.ts:204`,
`maniobra-circunferencia-escrotal.spec.ts:344`) no tocan ni la card "Quitar fijación" ni el selector nuevo.

**Consecuencia**: el caso que el §4.2 del `impl` describe como *«el motivo por el que no lo podía dejar
pasar»* —elegir "Novillito" en un macho castrado tiene que DES-fijar, no fijar— **es exactamente el caso que
ningún test ejercita**. Hoy el código lo hace bien; mañana un `isCastrated: false` que vuelva por un merge o
un refactor no pone nada en rojo. Se cambió una función COMPARTIDA por tres consumidores y la red quedó
igual de vacía que antes.

**Cambio requerido (🔴 R-1)**: cubrir el caso con un test que pueda fallar. La opción barata y del mismo
patrón que el resto de la unidad: extraer la derivación a un puro (o testear `decideCategoryPin` alimentado
por un fake que espeje `resolveRevertCategory` con `is_castrated` real) **más** un E2E que siembre un macho
CASTRADO ≥365 d con `category_override=true` y verifique que elegir "Novillito" deja `category_override =
false` en el server. Sin eso, `RCM.5.2`/P2 está verificado solo en la mitad del dominio, y el fix de §4.2 es
una afirmación, no un hecho protegido.

---

## §2 — 🔴 Otro test que no puede fallar: «sin CTA de tacto: un MACHO y una TERNERA» (RTF.2.3)

`app/e2e/ficha-tacto.spec.ts:327-348`. Es **la misma forma** que el implementer ya cazó en el test de CUT, en
otro archivo, y sobrevivió a su propia falsificación.

### 2.a — El mecanismo

`tactoOffer` (`app/app/animal/[id].tsx:~690`) se deriva de `detail` **y de `rodeoGating`**, y `rodeoGating`
arranca en `{}` y se llena en un `.then()` asíncrono (`fetchRodeoGating`, `[id].tsx:~256`). Con el mapa vacío
ningún data_key aplica ⇒ **no hay CTA para NINGÚN animal en t=0**. El test hace:

```ts
await openFicha(page, calfIdv);                                  // espera "Estado actual" = detail cargado
await expect(page.getByTestId('ficha-tacto-cta')).toHaveCount(0); // ← matchea al instante, siempre
```

`openFicha` ancla en `detail`, no en `rodeoGating`. La aserción de AUSENCIA se resuelve en el hueco entre las
dos lecturas asíncronas.

### 2.b — Falsificado ejecutando (mutante E-A + control de no-vacuidad)

Mutante **E-A**, elegido para que se manifieste DESPUÉS del read asíncrono (a diferencia del `?? 'prenez'` del
implementer, que se manifiesta en el mismo render que `detail` y por eso sí moría):
`ficha-tacto-offer.ts:73-75` → se elimina la capa ANIMAL de la rama aptitud, dejando la capa RODEO intacta.
Con eso una **ternera** recibe el CTA "Tacto de aptitud".

| Corrida (mismo build mutado) | Resultado |
|---|---|
| `ficha-tacto-offer.test.ts` (unit) | **ROJO** — `actual: 'aptitud', expected: null`. La capa unit sí lo caza. |
| E2E `-g "sin CTA de tacto"` | **1 passed (13.4 s) — el mutante SOBREVIVE** |
| E2E `-g "vaquillona sin veredicto"` (**control de no-vacuidad**) | **FALLA en `ficha-tacto.spec.ts:134`** |

El control es el que cierra el argumento: **el mutante está vivo en el bundle** (mata la aserción
correctamente anclada de RTF.7.5, que es una transición presente→ausente) y **aun así el test de RTF.2.3 pasa
en verde con la capa de aplicabilidad de animal borrada**. No verifica el invariante, verifica un estado
transitorio.

### 2.c — 🟠 Y la mitad "MACHO" del mismo test es vacua por construcción

`[id].tsx:~256`: `fetchRodeoGating` **solo se llama si `detail.sex === 'female'`**; para un macho se hace
`setRodeoGating({})` y el mapa queda vacío **para siempre**. Es decir: en un macho el CTA no puede aparecer
nunca, **cualquiera sea la lógica de `resolveFichaTactoOffer`**. La aserción de la línea 342 no puede fallar
ni con la función entera reemplazada por `() => 'prenez'`. No es un bug de producto (el fail-safe es
correcto), pero el test no prueba lo que su nombre dice.

**Cambio requerido (🔴 R-2)** — `app/e2e/ficha-tacto.spec.ts:342` y `:347`: anclar la ausencia a que la capa
rodeo YA resolvió, no al `detail`. El anclaje barato y determinístico que ya existe en el archivo: en la misma
ficha, asertar primero algo que dependa de `rodeoGating` (p. ej. la afordancia "Marcar como CUT", que sale del
MISMO read para hembras) o, mejor, hacer el test comparativo — misma corrida, mismo rodeo, una vaquillona
elegible mostrando el CTA (positivo, con espera real) y RECIÉN entonces la ternera sin él. La espera positiva
sobre el control prueba que el read del gating ya terminó. Un `waitForTimeout` suelto lo tapa pero no lo
resuelve.

**Nota (⚪)** — el fix del test de CUT (`ficha-categoria.spec.ts:257`) usa `page.waitForTimeout(2000)`: es un
sleep arbitrario, no un anclaje. Funciona hoy y mata a E1, pero es la misma clase de fragilidad con un margen
temporal. Mismo remedio: anclar en una señal observable del catálogo ya resuelto.

---

## §3 — Restauración de mutantes (verificada)

Tres mutantes, aplicados **de a uno**, sin nada corriendo de fondo:

| # | Archivo:línea | Mutación | Destino |
|---|---|---|---|
| M1 | `app/src/services/animals.ts:1368` | `toBool(row.is_castrated ?? 0)` → `false` | restaurado |
| E-A | `app/src/utils/ficha-tacto-offer.ts:73-75` | se borra `&& appliesToAnimal('tacto_vaquillona', animal)` | restaurado |
| (harness) | `scratchpad/diff-castrated.test.ts` | test diferencial fuera del repo | no toca el repo |

**Verificación de la restauración** (md5 contra el baseline tomado ANTES del primer mutante):

```
0f4ae95df4c0f009781820b9fd63975c  app/src/services/animals.ts        ✔ igual
e5f194a0002ceb91ebe7d0888fff28a6  app/src/utils/ficha-tacto-offer.ts ✔ igual
7113229cb8e52be1a47c824f19dbacd8  app/app/animal/[id].tsx            ✔ igual (nunca mutado)
02594206ef208ad730fb351d37ad45a3  app/src/utils/category-pin.ts      ✔ igual (nunca mutado)
```

- `git status` no muestra ningún archivo mío; **cero `git add`**.
- `design/**` limpio (no corrí capturas ni el veto-sweep).
- **`app/dist` reconstruido desde el árbol restaurado** — el build mutado con el que corrí el E2E no quedó
  en disco (esa es la trampa que puede envenenar la próxima corrida E2E de otro agente).

## §4 — Estado de las verificaciones

| Qué | Resultado |
|---|---|
| Suite unit COMPLETA del repo, árbol restaurado | **3021 pass / 0 fail** (ejecutada por mí) |
| Idem, con el mutante M1 | 3021 pass / 0 fail (**el mutante sobrevive** — §1) |
| `ficha-tacto-offer.test.ts` con el mutante E-A | ROJO (la capa unit sí lo caza) |
| E2E `ficha-tacto -g "sin CTA"` con E-A | **passed (el mutante sobrevive)** — §2 |
| E2E `ficha-tacto -g "vaquillona sin veredicto"` con E-A | falla (control de no-vacuidad) |
| `git diff supabase/migrations supabase/functions` (tracked) | **vacío** → Gate 1 N/A de esta unidad **confirmado** |
| `design/**/*.png` | limpio |

⚠️ **Un rojo transitorio, explicado, que NO es de esta unidad ni de la red**: una corrida intermedia de la
suite unit dio un `ERR_ASSERTION` (`actual: 1, expected: 2`); `app/src/utils/reports-format.ts` tiene
`mtime = 19:24:11`, o sea fue **reescrito por la otra terminal mientras corría**. La corrida inmediatamente
posterior con el mismo set de archivos da 3021/0. No es regresión ni caída de DNS: es la otra terminal.

### Lo que NO verifiqué (declarado, no aprobado en silencio)

1. **`node scripts/check.mjs` completo NO lo corrí.** Motivo explícito: las suites remotas (RLS / Edge /
   reportes) pegan contra la misma base que la otra terminal está usando ahora, y
   `supabase/tests/reports/run.cjs` **ya no es el archivo que el `impl` describe** (ver punto 2). Corrí en su
   lugar la capa que sí es atribuible a esta unidad: la suite unit completa, dos veces.
2. **Reportes / TR.12: la numeración YA colisionó.** `run.cjs` (+1130 líneas) contiene **TR.12…TR.21 del
   delta «campañas congeladas»** de la otra terminal, que declara la colisión en un comentario
   (`run.cjs`, bloque «⚠ COLISIÓN DE NUMERACIÓN»). El "17/17" del `impl` §12 quedó viejo por un cambio ajeno.
   **No lo cuento como defecto de esta unidad**, pero `RTF.8.5` está atado a un archivo compartido en
   movimiento: hay que re-verificarlo cuando la otra terminal cierre.
3. **Nada en device** (está desconectado), nada de Gate 2.5 / veto visual, nada de la suite E2E completa.
4. **No revisé** arquitectura/convenciones/CHECKPOINTS/exactitud de specs del resto del delta: la review es
   acotada por pedido a §1 y §2. **Los ~14 archivos restantes del diff no están revisados** — esto no es una
   aprobación parcial de ellos.

---

## §5 — Veredicto

# CHANGES_REQUESTED

Los dos puntos que me pediste verificar dieron el mismo resultado de fondo: **el código está bien y la red de
tests no lo sostiene**. No hay defecto funcional demostrado en ninguno de los dos; hay dos lugares donde un
test declara cubrir algo que no puede detectar. Y "no puede fallar" es exactamente el criterio que hoy ya
apareció ocho veces.

### Cambios requeridos

| # | Sev | Archivo:línea | Qué |
|---|---|---|---|
| **R-1** | 🔴 | `app/src/services/animals.ts:1368` (test faltante) | El fix de `resolveRevertCategory` sobrevive a su propio mutante: 3021 tests unit en verde con `isCastrated: false` restaurado, y ningún E2E siembra un macho castrado con fijación. Cubrir el caso macho CASTRADO ≥365 d + `category_override=true` → elegir "Novillito" → `category_override=false` en el server (E2E), o exponer la derivación como puro y testearla. Hoy P2 está verificado solo para hembras. |
| **R-2** | 🔴 | `app/e2e/ficha-tacto.spec.ts:347` (y `:342`) | La aserción de ausencia del CTA corre en el hueco entre `detail` (cargado) y `rodeoGating` (aún `{}`): con la capa ANIMAL borrada de la rama aptitud el test pasa igual — verificado ejecutando, con control de no-vacuidad. Anclar en una señal de que el gating del rodeo YA resolvió (control positivo en la misma corrida), no en `openFicha`. |
| **R-3** | 🟠 | `app/e2e/ficha-tacto.spec.ts:342` | La mitad "MACHO" del test es **vacua por construcción**: `[id].tsx` solo llama `fetchRodeoGating` para hembras, así que en un macho el CTA no puede aparecer ni con `resolveFichaTactoOffer` reemplazada por `() => 'prenez'`. O se ancla distinto, o se dice en el test qué está probando de verdad (el fail-safe de la ficha, no el predicado). |
| **R-4** | 🟡 | `app/e2e/ficha-categoria.spec.ts:257` | El fix del test ciego de CUT quedó anclado en `waitForTimeout(2000)`: es un sleep, no una señal. Mata a E1 hoy; bajo carga vuelve a ser ciego sin avisar. Anclar en algo observable del catálogo resuelto. |
| **R-5** | ⚪ | `progress/impl_ficha-categoria-tacto.md` §12 | El "17/17" de `run.cjs` quedó viejo: la otra terminal metió TR.12…TR.21 en el mismo archivo, con colisión de rótulo declarada. Reconciliar el número (y el rótulo de TR.12) cuando esa unidad cierre. |

### Lo que SÍ quedó confirmado

- **P2 se cumple en el código** (`category-pin-core.ts:100-108`), y la corrección de `is_castrated` es
  necesaria para que se cumpla en machos castrados.
- **"Quitar fijación" no sufrió regresión**: medido, el cambio es un no-op exacto para hembras y para machos
  enteros; los 21 casos que se mueven son todos macho castrado, y se mueven hacia la categoría correcta.
- El tercer consumidor de la función (`resolveCutCategory`, desmarcar CUT) es female-only → intacto.
- La capa unit de la unidad sí caza los mutantes de dominio (E-A murió ahí).
- Gate 1 N/A de esta unidad: confirmado (los `0127`-`0130` sin trackear son de la otra terminal).
