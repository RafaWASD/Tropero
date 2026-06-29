# Spec 02 — Delta REFINAMIENTO DEL FORMULARIO DE ALTA (#3 / #13 / #14) — Design

**Fuente**: `context-alta-form-refinamiento.md` (Gate 0 auto-aprobado) + `requirements-alta-form-refinamiento.md` (RAF2.x).
**Alcance**: **frontend puro**. Cero migraciones, cero RLS nueva, cero triggers/RPC, cero cambios de schema. **Gate 1 N/A** (ver §6 "¿Toca DB?"). Todo es UI del paso 4 de `crear-animal.tsx` + utils puras testeables con `node:test`.

> **Nota de delta (ADR-028)**: el baseline (`requirements.md`/`design.md`/`tasks.md` y los deltas previos) NO se reescribe ni se re-tilda. Al cerrar este delta (Puerta 2) se folda al `design.md` baseline un puntero en "Deltas posteriores" + nota as-built bajo el/los `R<n>` afectados (R4 alta; los campos del paso 4 que toca RT2/RAR).

---

## 1. Archivos a crear / modificar

| Archivo | Cambio |
|---|---|
| `app/src/utils/animal-birth-year.ts` | **Agregar** `sanitizeDayMonthInput(raw)` (RAF2.1.11) y `validateBirthDate(year, dayMonthRaw, now)` → fecha exacta ISO o error (RAF2.1.4–2.1.10). `birthYearToDate` **intacto** (camino año-solo, RAF2.1.3). |
| `app/src/utils/animal-birth-year.test.ts` | **Extender**: bordes de día/mes, 29/02 bisiesto vs no-bisiesto, fecha futura, todo-o-nada, año-solo → midpoint, sanitizer día-primero con "/". |
| `app/src/components/ConditionScoreStepper.tsx` *(nuevo, recomendado)* | Stepper **presentacional controlado** (valor hero + − / + + pista de escala), extraído del cuerpo de `CondicionCorporalStep`. Props `{ score, onChange, compact? }`. Reusa `condition-stepper.ts`. (RAF2.2.x) |
| `app/app/maniobra/_components/CondicionCorporalStep.tsx` | **Refactor sin cambio de comportamiento**: pasa a envolver `ConditionScoreStepper` (estado interno + CTA "Confirmar" + `bottomPad`). El contrato de la maniobra (R6.6) no cambia. |
| `app/app/crear-animal.tsx` | Paso 4: (a) campo DD/MM + `birthDayMonth` state + error + submit con fecha exacta/midpoint + scroll-al-campo (RAF2.1); (b) `ScoreChips` → `ConditionScoreStepper` con tri-estado null (RAF2.2 + RAF2.3.2/2.3.3); (c) `OptionRows` con `allowDeselect` para los opcionales del paso 4 (RAF2.3.1/2.3.6); (d) ScrollView ref + refs de campo para scroll-al-error (RAF2.4.4). |
| `app/e2e/animals.spec.ts` | e2e: alta con DD/MM → fecha exacta; alta solo-año → midpoint; DD/MM inválido (31/02, sin año) → error inline; condición por stepper; re-tap deselecciona dientes/preñez; condición "Sin cargar" no persiste. |

**No se toca**: `createAnimal` / `services/animals.ts` (RAF2.4.2), find-or-create (spec 09), pasos 1–3, identificadores, lote, custom props, `events.ts` (los eventos post-create ya existen). `ScoreChips` se **elimina** de `crear-animal.tsx` (queda sin uso tras #13); si el reviewer prefiere conservarlo muerto, se deja con comentario — default: borrar.

---

## 2. #3 — Fecha DD/MM separada del año (RAF2.1)

### 2.1 Util pura nueva (`animal-birth-year.ts`)

`birthYearToDate` (línea 67) **no se toca** — sigue siendo el camino año-solo (midpoint `AAAA-07-01`, con su clamp a `01-01` si el mid-año cae futuro). Se agregan dos funciones puras (firmas contractuales; nombres finos a criterio del implementer):

```ts
/** Sanitiza el input de día/mes EN VIVO: solo dígitos, día-primero, con "/" automático, tope DD/MM (4 díg). */
export function sanitizeDayMonthInput(raw: string): string; // "1502" → "15/02" ; "3/" → "3" ; "abc" → ""

export type BirthDateValidation =
  | { ok: true; date: string }           // ISO 'YYYY-MM-DD' (exacta si hay DD/MM; midpoint si solo año)
  | { ok: true; date: null }             // todo vacío (año y DD/MM): birth_date null (opcional, válido)
  | { ok: false; error: string; field: 'year' | 'dayMonth' };

/**
 * Valida la fecha de nacimiento COMPLETA al submit. `yearRaw` y `dayMonthRaw` son los strings crudos del
 * form (ya sanitizados en vivo). Reglas (RAF2.1.3–2.1.9):
 *   - año vacío + DD/MM vacío → { ok:true, date:null }.
 *   - año válido + DD/MM vacío → { ok:true, date: birthYearToDate(year, now) }  (midpoint, RAF2.1.3).
 *   - año vacío + DD/MM presente → { ok:false, field:'dayMonth' }  (no hay fecha sin año, RAF2.1.5).
 *   - DD/MM incompleto (solo D o solo M) → { ok:false, field:'dayMonth' }  (todo-o-nada, RAF2.1.6).
 *   - mes ∉ 1..12 / día ∉ 1..daysInMonth(mes, año) / 00 / 31-en-mes-de-30 → { ok:false }  (RAF2.1.7).
 *   - 29/02 en año no bisiesto → { ok:false }  (RAF2.1.8, NO clampea).
 *   - fecha exacta futura (> hoy) → { ok:false }  (RAF2.1.9, criterio propio).
 *   - año válido + DD/MM válido y no-futuro → { ok:true, date: 'AAAA-MM-DD' }  (RAF2.1.4).
 * Reusa `validateBirthYear` para el eje año (4 díg / no futuro / ≥ MIN_BIRTH_YEAR). `now` inyectable (tests).
 */
export function validateBirthDate(yearRaw: string, dayMonthRaw: string, now?: Date): BirthDateValidation;
```

- **Bisiesto**: regla estándar `(y % 4 === 0 && y % 100 !== 0) || y % 400 === 0`; `daysInMonth(m, y)` con febrero = 28/29. Testeable sin red (RAF2.1.8: 2020-02-29 ok, 2021-02-29 error, 2000-02-29 ok, 1900-02-29 error).
- **`field`** en el error permite al screen pintar el borde rojo + scroll en el campo correcto (año vs DD/MM).
- **No duplica** `birthYearToDate`: el camino año-solo delega en él (RAF2.1.10).

### 2.2 UI del paso 4 (`crear-animal.tsx`)

- Estado nuevo: `const [birthDayMonth, setBirthDayMonth] = useState('')` + `const [birthDateError, setBirthDateError] = useState<string|null>(null)` (reemplaza el uso de `birthYearError` para el error combinado, o se conserva `birthYearError` y se agrega `dayMonthError` — el `field` del resultado decide cuál).
- Campo nuevo `FormField` "Día / Mes (opcional, DD/MM)" debajo del campo Año (`crear-animal.tsx:1193`), `keyboardType="number-pad"`, `placeholder="DD/MM"`, `onChangeText={(t)=>setBirthDayMonth(sanitizeDayMonthInput(t))}`, `error={dayMonthError}`.
- Submit (`onSubmit`, hoy `crear-animal.tsx:447` valida año y `:481` calcula `birthDate`): se reemplaza el par `validateBirthYear` + `birthYearToDate` por **una** llamada a `validateBirthDate(birthYear, birthDayMonth, new Date())`; si `!ok`, set del error en el campo que indica `field`, scroll-al-campo y `return`; si `ok`, `birthDate = result.date`.

### 2.3 Scroll-al-campo (RAF2.4.4)

Hoy el `ScrollView` (`crear-animal.tsx:658`) **no** tiene ref ni se hace scroll a los errores (año/peso solo pintan inline). Para honrar el MUST en el campo nuevo se agrega:
- `const scrollRef = useRef<ScrollView>(null)` + un ref por campo validado (envuelto en `View` con `onLayout` que captura su `y`, o `measureLayout`).
- En el `return` de validación fallida, `scrollRef.current?.scrollTo({ y, animated: true })` al campo del error.
- **Criterio propio (d)**: se extiende el mismo patrón a los errores existentes de **año** y **peso** (coherencia con el MUST). Si Raf prefiere acotarlo solo al DD/MM en Puerta 2, se recorta.

---

## 3. #13 — Condición corporal stepper (RAF2.2)

### 3.1 Extracción del stepper a un componente compartido (recomendado)

`CondicionCorporalStep.tsx` (maniobra) hoy mezcla: estado interno (`useState(score)`), el cuerpo visual (valor hero `$11` + botones `$stepperBtn` + pista de escala 1…5) y el CTA "Confirmar" + `bottomPad`. Se **extrae el cuerpo visual** a `app/src/components/ConditionScoreStepper.tsx`, **controlado**:

```ts
export type ConditionScoreStepperProps = {
  score: number;                 // valor a mostrar (controlado)
  onChange: (next: number) => void; // emite el resultado de increment/decrement (snapeado)
  compact?: boolean;             // alta: layout embebido sin ocupar flex={1} de pantalla
  dimmed?: boolean;              // alta tri-estado: atenúa el hero + apaga la marca activa = "sin cargar" (conditionScore null)
};
```

- Reusa `decrementScore`/`incrementScore`/`isScoreAtMin`/`isScoreAtMax`/`formatScoreAR`/`snapScore` de `condition-stepper.ts` (RAF2.2.2) — **cero aritmética nueva**.
- Valor hero full-width, `lineHeight` matcheado (RAF2.2.5); botones deshabilitados en los límites (RAF2.2.4); coma decimal + 2 decimales (RAF2.2.3).
- `CondicionCorporalStep` (maniobra) pasa a: `useState` + `<ConditionScoreStepper score={score} onChange={setScore}/>` + su CTA "Confirmar". **Comportamiento idéntico** (R6.6) → la e2e/los tests de la maniobra deben seguir verdes (anti-regresión, ver §8).
- **Alternativa si el full-screen no encaja** (RAF2.2.6, fallback del context): no extraer y embeber una **versión compacta duplicada** en `crear-animal.tsx` reusando igual `condition-stepper.ts`. Default del leader: **extraer** (evita duplicar el JSX del stepper). El layout `compact` lo decide el implementer.

### 3.2 Tri-estado en el alta (entrelaza con RAF2.3.2/2.3.3)

En la maniobra el score **siempre** tiene valor (paso requerido con default 3,00). En el alta es **opcional** → `conditionScore: number | null` (ya es así, `crear-animal.tsx:200`). El embebido necesita un valor para dibujar aunque el estado sea null:

- Mostrar `displayScore = conditionScore ?? SCORE_DEFAULT` (3,00), **atenuado** (`$textMuted`) mientras `conditionScore == null` (señal visual de "sin cargar" / hint).
- **Primer toque** a − o + : `onChange(decrement/increment(displayScore))` → `setConditionScore(...)` (queda **cargado**, color normal).
- Control **"Sin cargar"** (text-button bajo el stepper) visible cuando `conditionScore != null` → `setConditionScore(null)` (vuelve a sin-cargar). (RAF2.3.2)
- Cargar **exactamente 3,00**: tocar +/− o −/+ (queda cargado en 3,00). **Criterio propio (c)** — alternativa para Puerta 2: un toggle explícito "Cargar / Sin cargar". Default: el patrón toque-marca-cargado (mínimo control extra, manga-friendly).
- Submit: el bloque post-create `if (showCondition && conditionScore != null)` (`crear-animal.tsx:532`) ya respeta el null → con `conditionScore==null` **no** se crea el evento (RAF2.3.3/2.3.5). **Sin cambio** en esa rama.

---

## 4. #14 — Destildar opcionales (RAF2.3)

### 4.1 `OptionRows` deseleccionable (opt-in)

`OptionRows` (`crear-animal.tsx:1384`) se usa en **4 lugares**: rodeo paso 1 (`:883`, requerido), categoría paso 3 (`:1010`, requerido), dientes (`:1240`), preñez (`:1257`), cría al pie (`:1276`). Para no romper los requeridos se agrega un flag **opt-in**:

```ts
function OptionRows({ options, value, onChange, a11yPrefix, allowDeselect = false }: {
  ...
  onChange: (v: string | null) => void;   // widen: null solo cuando allowDeselect y re-tap del seleccionado
  allowDeselect?: boolean;
})
```

- `onPress`: si `allowDeselect && value === opt.value` → `onChange(null)` (deselección); si no → `onChange(opt.value)` (igual que hoy).
- **Requeridos** (rodeo/categoría): `allowDeselect` queda en `false` (default) → comportamiento **idéntico**; sus `onChange` ignoran null (nunca lo reciben). (RAF2.3.6)
- **Opcionales del paso 4** (dientes/preñez/cría): `allowDeselect` en `true`; los handlers mapean null → set del estado a null:
  - dientes: `onTeeth: (v: TeethState | null) => void` → `setTeethState(v)`.
  - preñez: `onPregnancy: (v: PregnancyStatus | null) => void` → `setPregnancyStatus(v)`.
  - cría al pie: hoy mapea string↔boolean (`crear-animal.tsx:1281`); `onNursing` pasa a aceptar `boolean | null` (null = deselección → `setNursing(null)`).
- **Aptitud** (`FitnessOptionRows`, `:1451`, del delta RAR.1): se le agrega el mismo `allowDeselect` (re-tap deselecciona → `setHeiferFitness(null)`). (RAF2.3.1)

### 4.2 Inputs vaciables (RAF2.3.4)

Ya funcionan (vaciar el `TextInput` deja el estado en `''` → el submit manda `trim() || null`): raza (vía "Sin raza" en el BreedPicker → `onSelectBreed(null, null)`, `crear-animal.tsx:382`), pelaje, peso, DD/MM. No requieren cambio funcional. La "✕" de limpiar rápido del context es **opcional** (a criterio del implementer); default: no agregarla (vaciar el campo alcanza).

### 4.3 "Sin cargar" no se envía (RAF2.3.5)

Es el comportamiento **actual** y se conserva: el submit ya manda `teethState`/`nursing` solo si `show*` y manda `null`/`|| null` cuando no hay valor; los eventos post-create (condición/preñez/aptitud) ya se gatean por `!= null` (`crear-animal.tsx:532/539/546`). La deselección de #14 simplemente **devuelve esos estados a null**, que el submit ya trata como "no enviar". Sin cambio en `createAnimal`.

---

## 5. Offline-first, multi-tenancy y RLS

- **Offline-first (RAF2.4.3)**: todo lo del delta es UI + utils puras client-side. `validateBirthDate`/`sanitizeDayMonthInput`/`condition-stepper` corren sin red (testeables con `node:test`). El `createAnimal` y los eventos post-create siguen el **mismo camino offline-safe** que hoy (encolado local + RLS al subir) — el delta no lo toca. El alta funciona en la manga sin señal.
- **Multi-tenancy / RLS**: el delta **no toca** tablas ni el tenant. `establishment_id` lo sigue derivando `createAnimal`/RLS server-side como hoy (sin cambio). No hay policy nueva ni modificada — se documenta explícitamente que **RLS queda intacta** (regla de mención obligatoria de multi-tenancy del proyecto).

## 6. ¿Toca DB? — Gate 1 N/A

**NO toca DB.** Confirmado contra el as-built:
- `animals.birth_date` ya es `DATE` → guardar la fecha exacta `AAAA-MM-DD` usa la **misma** columna y el **mismo** parámetro de `createAnimal` que el midpoint de hoy (RAF2.1.4). Sin migración.
- La condición corporal ya se persiste como evento post-create (`addConditionScore`, `condition_score_events`) — el stepper solo cambia el **input** del mismo valor (RAF2.2). Sin schema nuevo.
- Los opcionales (dientes/preñez/cría/aptitud/raza/pelaje/peso) ya existen como columnas/eventos. Destildar = mandar NULL/omitir, que ya está soportado (RAF2.3.5). Sin schema nuevo.
- Cero RLS, cero triggers, cero RPC, cero Edge Functions, cero secrets, cero datos regulados nuevos.

⇒ **Gate 1 (security spec) N/A.** Si en la implementación el diseño introdujera **cualquier** toque de DB (no previsto), se detiene y se eleva Gate 1 antes de seguir.

## 7. Alternativa descartada

**Un único campo de fecha completa `AAAA-MM-DD` (reusar `maskDateInput` de `animal-input.ts`) en vez de Año + DD/MM separados.**
- **Pros**: una sola util ya existente (`maskDateInput`, year-first), un solo campo, un solo error.
- **Contras**: rompe el caso de uso real del campo (el operario sabe el **año** —"nació en 2022"— y muchas veces **no** el día); un campo único year-first obligaría a tipear "2022-" antes de nada y perdería el atajo "solo año → midpoint" que el context exige conservar (RAF2.1.3, no romper). Además invierte el orden a year-first cuando el context pide **día-primero es-AR**.
- **Razón de descarte**: el context #3 fija explícitamente "**mantener el campo Año** + agregar DD/MM **separado**, día-primero, opcional, con año-solo→midpoint intacto". El campo único contradice el Gate 0. Se mantienen los dos campos.

*(Alternativa de #13 descartada, menor: duplicar la aritmética del stepper en el alta en vez de reusar `condition-stepper.ts` — descartada por el "no dupliques la aritmética" del context; la util pura es la fuente única.)*

## 8. Decisiones de criterio propio (a validar en Puerta 2)

Defaults del leader (Gate 0 auto-aprobado); cada uno reversible en Puerta 2:

- **(a) RAF2.1.9 — fecha exacta futura rechazada.** El context fija "día/mes válidos" + "no clamp silencioso" y `validateBirthYear` ya rechaza años futuros; extender a la fecha exacta (año en curso + DD/MM posterior a hoy → error) es la lectura fiel, no una invención. Alternativa: aceptarla. Default: **rechazar**.
- **(b) RAF2.2.6 — extraer `ConditionScoreStepper` compartido** (vs. duplicar una versión compacta). Default: **extraer** (reusa JSX + aritmética; toca `CondicionCorporalStep` pero sin cambiar su comportamiento). Riesgo: regresión visual de la maniobra → se mitiga corriendo la e2e/tests de spec 03. Si el reviewer ve riesgo, fallback a duplicar compacto.
- **(c) RAF2.3.2/2.3.3 — stepper "sin cargar" + 3,00 atenuado.** El stepper arranca mostrando 3,00 **atenuado** (estado null), el primer toque −/+ lo marca cargado, "Sin cargar" lo limpia; cargar exactamente 3,00 = +/− o −/+. Alternativa: toggle explícito "Cargar/Sin cargar". Default: **toque-marca-cargado** (menos controles, manga-friendly).
- **(d) RAF2.4.4 — scroll-al-campo extendido a año y peso.** Hoy esos errores solo pintan inline (sin scroll). Se agrega scroll-al-campo para el DD/MM (en scope, Gate 0) y, por coherencia con el MUST, también para año/peso. Alternativa: solo DD/MM. Default: **los tres** (chico, mismo patrón).

---

## 9. Trazabilidad design → requirements / tests

| Componente / cambio | Requirement(s) | Test(s) |
|---|---|---|
| `validateBirthDate` / `sanitizeDayMonthInput` (util pura) | RAF2.1.3–2.1.11 | `animal-birth-year.test.ts` (bordes día/mes, bisiesto, futuro, año-solo, todo-o-nada, sanitizer) |
| Campo DD/MM + submit fecha exacta/midpoint + scroll | RAF2.1.1–2.1.5, RAF2.4.4 | e2e `animals.spec.ts` (exacta / midpoint / inválida / sin-año) |
| `ConditionScoreStepper` controlado (reusa `condition-stepper.ts`) | RAF2.2.1–2.2.6 | tests de `condition-stepper.ts` (ya existen) + e2e stepper en alta |
| Tri-estado condición (null / cargado / Sin cargar) | RAF2.3.2, RAF2.3.3, RAF2.3.5 | e2e (condición sin tocar → no persiste; cargada → persiste; Sin cargar → no persiste) |
| `OptionRows`/`FitnessOptionRows` `allowDeselect` | RAF2.3.1, RAF2.3.6 | e2e (re-tap dientes/preñez deselecciona; rodeo/categoría no) |
| Inputs vaciables = sin-cargar; no enviar sin-cargar | RAF2.3.4, RAF2.3.5 | e2e (raza "Sin raza"/peso vacío → NULL en el animal creado) |
| Sin DB / contrato `createAnimal` intacto / offline | RAF2.4.1, RAF2.4.2, RAF2.4.3 | revisión estática (no hay migración nueva; `createAnimal` sin cambio de firma) |
| Tokens / es-AR / lineHeight | RAF2.4.5 | revisión del reviewer (sin hardcode; coma decimal; lineHeight matcheado) |
