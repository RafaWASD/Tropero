# Spec 01 — Delta TELÉFONO — Design

**Status**: `spec_ready` · Delta **Nivel B (ADR-028)** · **Gate 1 APLICA** (schema + PII) · **Migración `0126`**.
**Fecha**: 2026-07-18.
**Requirements**: `specs/active/01-identity-multitenancy/requirements-telefono.md` (`RTEL.<n>`).
**Contexto (fuente de verdad)**: `specs/active/01-identity-multitenancy/context-telefono.md`.

---

## 1. Forma de la solución en una línea

Un **componente único** (`PhoneField`) sobre una **lógica pura única** (`utils/phone.ts`) que produce un **formato canónico único** (`+54` + 10 dígitos), respaldado por un **CHECK autoritativo** en `user_private.phone` y una **migración que normaliza lo existente o aborta**.

Las cuatro piezas atacan las cuatro causas del bug: divergencia de inputs (componente), ausencia de canónico (utils), ausencia de validación real (CHECK), y datos ya sucios (migración).

---

## 2. Archivos

### A crear

| Archivo | Qué |
|---|---|
| `app/src/utils/phone.ts` | Lógica pura: normalización N1–N6, máscara AR, tabla de códigos de área, constantes. **Origen único** de la normalización (RTEL.2.9). |
| `app/src/utils/phone-vectors.json` | **Tabla compartida de vectores canónicos** `entrada → esperado` (RTEL.2.9.1). La consumen `phone.test.ts` (encoding TS) y `supabase/tests/user_private/run.cjs` (encoding del CHECK, vía el `REPO_ROOT` que la suite ya resuelve). |
| `app/src/utils/phone.test.ts` | Tests unitarios `node:test` (RTEL.14.1, RTEL.14.2, RTEL.14.8, RTEL.14.11). |
| `app/src/services/classify-error.ts` | **Extracción pura** de `classifyError` (hoy `establishments.ts:48-58`), para que sea testeable sin arrastrar el cliente de Supabase ni PowerSync a la suite unitaria (RTEL.14.9.1). Patrón de `powersync/upload-classify.ts`. |
| `app/src/services/classify-error.test.ts` | Test de la rama `23514`: copy fijo, sin `details`/`hint`/mensaje crudo (RTEL.14.9). **Es el test que sostiene la aceptación de R-7.** |
| `app/src/components/PhoneField.tsx` | Componente compartido (RTEL.3.1). |
| `supabase/migrations/0126_user_private_phone_format.sql` | Backfill + precheck + CHECK de formato (RTEL.7.*). |
| `app/src/components/phone-field-guard.test.ts` | Guard de paridad a futuro (RTEL.3.9, §6bis). |
| `app/e2e/captures/telefono.capture.ts` | Capture del Gate 2.5 (RTEL.12). |

### A modificar

| Archivo | Cambio |
|---|---|
| `app/app/crear-campo.tsx` | `CompletePhoneScreen`: `FormField` → `PhoneField`; separar error de campo vs error de guardado (RTEL.3.2, RTEL.6.5). |
| `app/app/(tabs)/mas.tsx` | `ProfileEditForm`: `FormField` → `PhoneField` (RTEL.3.3); `ProfileField` de teléfono formatea el display (RTEL.10.1). |
| `app/src/utils/validation.ts` | `isValidPhone` / `validateProfile` delegan en `phone.ts`; se preservan los exports vigentes. |
| `app/src/utils/validation.test.ts` | Ajuste de los casos de teléfono al nuevo criterio (AR = 10 exactos). |
| `app/src/services/establishments.ts` | `saveOwnPhone` / `saveProfile` envían el canónico; `classifyError` **se extrae** a `classify-error.ts` y se importa desde acá (RTEL.8.1–RTEL.8.3, RTEL.14.9.1). |
| `app/e2e/helpers/admin.ts` | `setUserPhone` normaliza antes de escribir (RTEL.9.1). |
| `supabase/tests/user_private/run.cjs` | Dos tests nuevos: CHECK rechaza no-canónico / acepta canónico, y `UPDATE` de email no rompe (RTEL.14.4, RTEL.14.5). |
| `scripts/run-tests.mjs` | Registrar `phone.test.ts`, `phone-field-guard.test.ts` y `classify-error.test.ts` en la lista explícita de la línea 61 (sin esto **no corren**). |
| `docs/conventions.md` | Carve-out del teléfono en la sección es-AR (RTEL.13.1). |
| `app/src/components/FormField.tsx` | **(fix-loop del veto de diseño del Gate 2.5, §9bis punto 7.)** Prop **aditiva** `hideLabel?: boolean` (default `false`) + export de `FieldLabel` + placeholder de `$textMuted` → `$textFaint`. `inputMode` sigue **sin** agregarse (RTEL.3.8). |

### Que NO se tocan (deliberado)

- ~~`app/src/components/FormField.tsx` — **sin cambios de contrato**.~~ **Superado por el fix-loop del veto de diseño** (§9bis punto 7): el contrato creció en `hideLabel` (aditiva, default = as-built) y se exportó `FieldLabel`, porque el label tenía que salir de la columna del input para dejar de sangrarse y saltar con el chip `+54` (ADR-027). Lo que `RTEL.3.8`/C5 prohíben —`inputMode` y en general una segunda prop de **teclado** solapada— sigue sin tocarse: `PhoneField` usa `keyboardType`, `maxLength`, `error`, `autoComplete`, `textContentType` y `testID` tal como estaban. Ver §7 y la nota de reconciliación de `RTEL.3.8`.
- `app/src/services/powersync/schema.ts` — la columna sigue siendo `text`; no hay cambio de schema local (§6).
- Policies, grants y streams de `user_private` — intactos (§5).

---

## 3. Lógica pura — `app/src/utils/phone.ts`

### 3.1 Constantes y techos (C4)

```ts
export const PHONE_AR_NATIONAL_DIGITS = 10;   // AR: exactamente 10 (RTEL.5.1)
export const PHONE_AR_TYPING_MAX_DIGITS = 12; // AR: tope de dígitos TIPEABLES (RTEL.4.2)
export const PHONE_MIN_DIGITS = 8;            // intl mínimo (E.164)
export const PHONE_MAX_DIGITS = 15;           // intl máximo (E.164)
export const PHONE_MAX_STORED_LENGTH = 16;    // '+' + 15 dígitos → espeja el CHECK (RTEL.1.5)
export const PHONE_MAX_LENGTH = 20;           // cap del BUFFER tipeable (RTEL.4.9)
export const PHONE_AR_COUNTRY = '54';
```

Los cinco techos tienen significados distintos y documentados; el que gobierna lo persistido es `PHONE_MAX_STORED_LENGTH`, y el CHECK server lo hace cumplir con independencia del cliente.

> **`PHONE_AR_TYPING_MAX_DIGITS = 12` ≠ `PHONE_AR_NATIONAL_DIGITS = 10`, y la diferencia es deliberada** (`RTEL.4.2`, decisión de Raf del 2026-07-18 — ver el bloque "Hueco de UX" de §9bis). El primero acota lo que se puede **tipear**; el segundo es lo que hace **válido** a un número argentino. Con los dos en 10, quien tipeaba su celular con el `15` (`11 15 2345 6789`) se quedaba en `11 1523-4567` —10 dígitos, formalmente válidos— y persistía un número equivocado sin un solo aviso. Aceptar 12 dígitos **no afloja la validación**: `normalizePhone` sigue exigiendo 10 exactos, y 11 y 12 son estados **transitorios** (`incomplete`, o normalizados por N3/N4) que nunca llegan a `valid` ni se persisten. Lo que cambia es que el estado inválido se vuelve **alcanzable tipeando**, y con él el diagnóstico de `RTEL.6.4`/`RTEL.6.6` y la sugerencia de DP4.

### 3.2 Normalización (RTEL.2)

```ts
export type NormalizedPhone =
  | { ok: true; canonical: string }        // '+54' + 10, o '+' + 8..15 (intl)
  | { ok: false; reason: 'empty' | 'unrecognized' };

export function normalizePhone(raw: string): NormalizedPhone;
```

Orden de evaluación (**la precedencia importa**, RTEL.2.10):

```
digits := raw sin caracteres no-numéricos
intl   := raw.trimStart() empieza con '+'

si intl:
  13 díg. y empieza '549'  → '+54' + últimos 10      (N5, saca el 9 — DP2)
  12 díg. y empieza '54'   → '+' + digits            (N4)
  8..15 díg. Y digits[0] != '0'  → '+' + digits      (N1, internacional)
  si no                    → unrecognized            (N6)
si NO intl:
  10 díg.                  → '+54' + digits          (N2)
  11 díg. y empieza '0'    → '+54' + últimos 10      (N3, saca el troncal)
  12 díg. y empieza '54'   → '+' + digits            (N4)
  13 díg. y empieza '549'  → '+54' + últimos 10      (N5)
  si no                    → unrecognized            (N6)
```

Las dos ramas existen por un caso real: sin ellas, un número extranjero de 10 dígitos (`+3460012345`) caería en N2 y se convertiría en `+543460012345` — un teléfono argentino inventado. El `+` es la señal explícita del usuario de que el país **no** se asume.

> **`digits[0] != '0'` en N1 (MEDIUM-1, Gate 1).** Faltaba, y creaba una contradicción real: el CHECK de `RTEL.7.1` exige `^\+[1-9]…`, así que un `+0123456789` **pasaba el cliente y explotaba con `23514`** contra el server. Fallaba cerrado, pero rompía `RTEL.2.9` (una sola definición de normalización) justo en el borde, y era el camino que volvía **alcanzable** el leak de `DETAIL` de HIGH-1. Ningún código de país del plan E.164 empieza con `0` (el `0` es prefijo troncal nacional, que es justamente lo que N3 descarta). Las ramas AR no necesitan el chequeo: todas producen `+54…`.

`15` **no** se remueve nunca en la normalización (RTEL.2.8). Un `11 15 2345 6789` (12 dígitos, no empieza con `54`) cae en N6 → error accionable de `RTEL.6.4`.

> **Fundamento corregido (2ª pasada).** No es que el `15` sea *imposible* de localizar: con la tabla de DP1 se puede (`área(n) + 15 + (10−n)` = siempre 12 dígitos). Es que **no se debe usar la tabla para escribir**. Si la normalización dependiera de ella, un largo de área mal clasificado recortaría los dos dígitos equivocados y persistiría en silencio un número incorrecto — un error cosmético ascendido a corrupción de datos, rompiendo `RTEL.4.6`. La tabla queda confinada a presentación y, si se aprueba DP4, a *proponer* correcciones que el usuario confirma (§4bis).

### 3.3 Máscara y display (DP1)

```ts
export function arAreaCodeLength(digits: string): 2 | 3 | 4;
export function maskArPhone(digits: string): string;      // tipeo en vivo (RTEL.4.3)
export function formatPhoneDisplay(canonical: string | null): string; // read-only (RTEL.10.1)
```

Tabla de códigos de área — **exhaustiva por construcción**, sin caso "desconocido":

```ts
const AR_AREA_2 = ['11'];
const AR_AREA_3 = [
  '220','221','223','230','236','237','249','260','261','263','264','266',
  '280','291','297','299','336','341','342','343','345','348','351','353',
  '358','362','364','370','376','379','380','381','383','385','387','388',
];
// todo lo demás → 4 dígitos (el caso más común: 2241 Chascomús, 2914, 3489, …)
```

Agrupación resultante: `<área> <resto − 4>-<últimos 4>`.

| Dígitos | Área | Render |
|---|---|---|
| `1123456789` | 2 | `11 2345-6789` |
| `3414567890` | 3 | `341 456-7890` |
| `2241430000` | 4 | `2241 43-0000` |

**Propiedad clave (RTEL.4.6):** la tabla es **solo cosmética**. `normalizePhone` no la consulta; la validación tampoco. Un error u omisión en `AR_AREA_3` produce una agrupación visual distinta y **nada más** — el valor persistido es idéntico. Esto es lo que hace aceptable mantener una tabla a mano en vez de una librería (D4).

**Tipeo progresivo sin separador colgante (RTEL.4.4):** `maskArPhone` agrupa **solo lo tipeado**. `112` → `11 2` (no `11 234`-con-hueco ni `11 ` con espacio final). Como nunca hay separador al final, el backspace del sistema siempre elimina un dígito.

**Detección de "borró un separador":** en `onChangeText`, si la cantidad de dígitos del texto entrante es **igual** a la del estado anterior, el usuario borró un separador → se descarta el último dígito. Es el truco estándar y evita el input trabado.

**Cursor:** el estado es `digits`; el `value` renderizado es derivado → RN deja el caret al final. Aceptado para 10 dígitos tipeados de izquierda a derecha (§8, riesgo R-1).

### 3.4 Validación (RTEL.5)

```ts
export function isValidPhone(raw: string): boolean;  // AR: 10 exactos · intl: 8..15
```

Se implementa como `normalizePhone(raw).ok`. `validation.ts` re-exporta y `validateProfile` sigue tratando el vacío como "sin teléfono" (RTEL.5.4, sin regresión).

> **Cambio de criterio a registrar:** hoy `isValidPhone('12345678')` (8 dígitos AR) es `true`; con D2 pasa a ser `false` (AR exige 10). `validation.test.ts:83-93` se ajusta en consecuencia. Es intencional y es el punto de D2.

---

## 4. Componente — `app/src/components/PhoneField.tsx`

```ts
/** Valor del campo. Tres estados EXPLÍCITOS: el caller nunca recibe texto crudo. */
export type PhoneValue =
  | { kind: 'empty' }                          // campo vacío → perfil persiste null; el gate R3.8 lo rechaza
  | { kind: 'incomplete' }                     // tipeando, o no normalizable → NUNCA se persiste
  | { kind: 'valid'; canonical: string };      // '+54' + 10 díg., o '+' + 8..15 intl

export type PhoneFieldProps = {
  label?: string;                              // default 'Teléfono'
  value: PhoneValue;
  onChangeValue: (next: PhoneValue) => void;
  error?: string | null;
  editable?: boolean;
  testID?: string;
};
```

> **MEDIUM-4 (Gate 1) — el contrato anterior era contradictorio.** Declaraba `onChangeValue: (canonicalOrRaw: string) => void` y a la vez afirmaba que el caller siempre ve el canónico "por construcción". No podían ser ciertas las dos: el nombre del tipo admitía texto crudo. Tampoco alcanza un `string | null` plano —que fue la sugerencia inicial— porque **conflaciona vacío con inválido**, y esa distinción es funcional: el perfil acepta vacío y persiste `null` (`RTEL.5.4`), el gate de `R3.8` debe rechazarlo (`RTEL.5.3`). Con un nullable, cada call site tendría que reconstruir esa diferencia mirando el texto — es decir, volveríamos a tener lógica de teléfono duplicada fuera del componente, que es el bug que este delta cierra.

- Estado interno: `digits: string` + `intl: boolean`. El caller **no puede** recibir texto crudo: el único campo que transporta valor es `canonical`, y solo existe en `kind: 'valid'`. La garantía es del **tipo**, no de una convención.
- Render: `FormField` con `keyboardType="phone-pad"`, `autoComplete="tel"`, `textContentType="telephoneNumber"`, `maxLength={PHONE_MAX_LENGTH}` (RTEL.3.5, RTEL.4.9), `error` pasado tal cual (borde `$terracota` + inline ya los da `FormField`).
- Adorno `+54`: prefijo visual **no editable** a la izquierda del input, ocultado en modo internacional (RTEL.4.1, RTEL.4.7). Se implementa con un `XStack` que envuelve el `FormField`. ⚠️ **La frase original "sin tocar el contrato de `FormField`" ya no es cierta**: el veto de diseño del Gate 2.5 obligó a sacar el label de la columna del input, y eso agregó la prop aditiva `hideLabel` + el export de `FieldLabel`. Ver §9bis punto 7 y la nota de `RTEL.3.8`.
- Modo internacional: se activa cuando el primer carácter tipeado o pegado es `+`; se desactiva al vaciar el campo (RTEL.4.8).
- Pegado: pasa por `normalizePhone`; si `ok` se adopta el canónico (y el modo correspondiente); si no, se conservan los dígitos y el caller muestra el error (RTEL.4.5).

**Capas (architecture.md):** `components → utils` es legal; `PhoneField` no importa de `services`. ✅

---

## 4bis. Ayuda ante el `15` — DP4 APROBADA (opción D, Raf en Puerta 1, 2026-07-18)

Raf eligió **detectar y sugerir con confirmación**. Entra en el alcance firme del delta.

```ts
// phone.ts — detección para el MENSAJE, nunca para normalizar (RTEL.6.8)
export function detectArTrunkPrefix(digits: string): { suggestion: string } | null;
```

Detección: `digits.length === 12` **y** los dos dígitos que siguen al código de área (largo según `arAreaCodeLength`) son `15`. La sugerencia es el número sin esos dos dígitos → 10 dígitos.

> **Los 12 dígitos son alcanzables TIPEANDO** desde que `RTEL.4.2` subió el tope de tipeo a 12 (§3.1). Sin eso, esta detección solo corría al **pegar** o autocompletar — es decir, DP4 no cubría el caso para el que se aprobó (ver §9bis, "Hueco de UX ... CERRADO").

Comportamiento (opción D): alimenta el copy específico de `RTEL.6.6` **y** `PhoneField` renderiza la sugerencia **formateada** con un affordance de un tap; el valor solo cambia tras la acción explícita del usuario (`RTEL.6.7`). Aceptada la sugerencia, el valor vuelve a entrar por el camino normal — `normalizePhone` → estado `PhoneValue` → re-normalización del service → CHECK (`RTEL.6.9`): no hay atajo de escritura.

**Invariante que preserva la propiedad de `RTEL.4.6` (verificado por el re-Gate 1 — no relajar):** `detectArTrunkPrefix` **no** es llamada desde `normalizePhone` ni desde ningún camino de escritura. Vive en la capa de presentación del error: **propone**, no escribe. Si la tabla de áreas estuviera mal, el chequeo del `15` en el offset equivocado casi siempre no matchea → no hay sugerencia → se cae al mensaje genérico de `RTEL.6.4`. El modo de falla degrada a "sin ayuda", nunca a un dato corrupto.

**Lo que la aprobación de DP4 NO cambia:** amplía la **ayuda**, no afloja la **validación**. Las tres capas siguen intactas y la tabla de códigos de área sigue sin participar de normalización ni de almacenamiento (`RTEL.4.6`, `RTEL.6.8`).

## 5. Backend

### 5.1 Estado de partida

```
public.user_private (0068)
  user_id uuid PK → public.users(id) on delete cascade
  email   text not null
  phone   text                       ← este delta
  created_at / updated_at
RLS: user_private_select_self · user_private_update_self  (self-only, sin insert/delete)
CHECK vigente: user_private_phone_len_chk  (char_length(phone) <= 32)   [0070:142-143]
```

### 5.2 Migración `0126_user_private_phone_format.sql`

> Numeración: `0126` es el siguiente libre (último aplicado: `0125_health_status.sql`). Si otra spec consume `0126` antes, renumerar al siguiente libre — la migración es número-agnóstica (no referencia su propio número salvo en los `raise notice`).

**Orden atómico (una transacción, patrón `0068`):** CHECK `NOT VALID` → backfill → precheck abortivo → `VALIDATE` → `notify pgrst`.

El CHECK va **primero como `NOT VALID`** para que un backfill con bugs falle **de inmediato**, en la fila que lo dispara, en vez de producir en silencio un valor no canónico que recién explotaría al final en el `VALIDATE` (con un error mucho más difícil de ubicar). El `VALIDATE` va al último, cuando el backfill ya garantizó residuo cero.

> **Fundamento corregido (L-1, Gate 1).** La versión anterior justificaba este orden diciendo que así "cualquier write concurrente durante la migración ya queda gobernado por el formato". **Es falso y dejaba un modelo mental equivocado sobre locking en el repo**: en una migración de una sola transacción, el `ALTER TABLE … ADD CONSTRAINT` toma `ACCESS EXCLUSIVE` sobre `user_private` hasta el commit, así que los writers concurrentes **bloquean** — no quedan "gobernados" por nada, esperan. La ventaja real del orden es la de arriba (falla temprana y localizada), que ya estaba bien argumentada en el comentario de la rama intl del backfill.

```sql
-- 0126_user_private_phone_format.sql — Delta TELÉFONO de spec 01.
-- Normaliza public.user_private.phone al canónico '+54'+10 dígitos (o '+'+8..15 intl) e impone
-- un CHECK de formato AUTORITATIVO. El cliente valida por UX; esta es la única frontera real
-- (el bundle RN es modificable y PostgREST es alcanzable con el JWT del propio usuario).
--
-- ⚠️ PII: ningún raise notice/exception de ESTA MIGRACIÓN imprime un teléfono ni un email —
--    solo conteos y user_id opacos (RTEL.7.5).
-- ⚠️ RIESGO RESIDUAL ACEPTADO (R-7, HIGH-1 de Gate 1): el CHECK de abajo, al rechazar en
--    RUNTIME, hace que Postgres emita `DETAIL: Failing row contains (...)` con TODAS las
--    columnas sobre las que el rol tiene SELECT — y `authenticated` tiene grant select sobre
--    user_private (0068:200) → email + teléfono EN CLARO en el log del servidor, sujeto a su
--    retención y drains, sobreviviendo a delete_account. Aceptado (decisión del leader): es
--    self-scoped (la RLS impide que el DETAIL traiga la fila de otro), la audiencia son quienes
--    ya tienen acceso a la DB, y con cliente y CHECK alineados (MEDIUM-1) el rechazo es
--    prácticamente inalcanzable en operación normal. Ver design §8 R-7.
-- ⚠️ Coordinar con el release del cliente: un cliente viejo que escriba formato no canónico
--    recibe 23514. Es beta con release coordinado.

-- T1 — CHECK de formato, NOT VALID (gobierna writes futuros desde ya).
alter table public.user_private
  add constraint user_private_phone_format_chk
  check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$') not valid;

-- T2 — Backfill: reglas N1..N6 (las MISMAS de app/src/utils/phone.ts, con la precedencia
-- +/no-+ de RTEL.2.10: sin ella un +34 60012345 se volvería un teléfono argentino inventado).
do $$
declare
  r        record;
  v_digits text;
  v_intl   boolean;
  v_canon  text;
  v_count  int := 0;
begin
  for r in select user_id, phone from public.user_private where phone is not null loop
    v_digits := regexp_replace(r.phone, '\D', '', 'g');
    v_intl   := left(btrim(r.phone), 1) = '+';
    v_canon  := null;

    if v_intl then
      if    length(v_digits) = 13 and left(v_digits, 3) = '549' then v_canon := '+54' || right(v_digits, 10);
      elsif length(v_digits) = 12 and left(v_digits, 2) = '54'  then v_canon := '+'   || v_digits;
      -- MEDIUM-1: primer dígito != '0' — ningún código de país E.164 empieza con 0, y el CHECK
      -- de T1 (^\+[1-9]...) lo exige. Sin esta condición el backfill produciría un valor que el
      -- propio VALIDATE de T4 rechazaría, abortando la migración por un bug nuestro.
      elsif length(v_digits) between 8 and 15 and left(v_digits, 1) <> '0'
                                                                then v_canon := '+'   || v_digits;
      end if;
    else
      if    length(v_digits) = 10                               then v_canon := '+54' || v_digits;
      elsif length(v_digits) = 11 and left(v_digits, 1) = '0'   then v_canon := '+54' || right(v_digits, 10);
      elsif length(v_digits) = 12 and left(v_digits, 2) = '54'  then v_canon := '+'   || v_digits;
      elsif length(v_digits) = 13 and left(v_digits, 3) = '549' then v_canon := '+54' || right(v_digits, 10);
      end if;
    end if;

    if v_canon is not null and v_canon is distinct from r.phone then
      update public.user_private set phone = v_canon where user_id = r.user_id;
      v_count := v_count + 1;
    end if;
  end loop;

  raise notice '0126: % fila(s) de user_private.phone normalizada(s)', v_count;  -- SOLO conteo
end $$;

-- T3 — Precheck ABORTIVO del residuo (DP3, patrón 0068:75-87).
-- Grandfatherear no es opción: Postgres evalúa TODOS los CHECK de la fila en CUALQUIER update
-- (cambie o no la columna), y NOT VALID solo saltea el re-chequeo de filas existentes. Con un
-- phone legacy sucio, el update de propagate_confirmed_email (0068:169-194) fallaría y ABORTARÍA
-- la confirmación de cambio de email de ese usuario.
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
  from public.user_private
  where phone is not null and phone !~ '^\+[1-9][0-9]{7,14}$';

  if v_bad > 0 then
    -- MEDIUM-1..2: se da la QUERY de reconciliación, no solo el diagnóstico. Devuelve SOLO
    -- user_id (UUID opaco, no PII de contacto) → el operador ubica las filas sin volcar phone.
    raise exception
      '0126 abortada: % fila(s) de user_private.phone no se pudieron normalizar al canónico. '
      'Los valores NO se listan (PII). Para ubicarlas, ejecutar: '
      'select user_id from public.user_private where phone is not null '
      'and phone !~ ''^\+[1-9][0-9]{7,14}$''; '
      'Corregir cada fila por user_id (sin copiar la columna phone a archivos ni a chat) y re-aplicar.',
      v_bad;
  end if;
end $$;

-- T4 — Recién ahora el re-chequeo retroactivo es seguro.
alter table public.user_private validate constraint user_private_phone_format_chk;

comment on constraint user_private_phone_format_chk on public.user_private is
  'Formato canónico del teléfono (spec 01, delta telefono, RTEL.7.1): NULL o E.164-sintáctico '
  '(+ seguido de 8 a 15 dígitos, sin separadores). Para AR el canónico es +54 + los 10 dígitos '
  'nacionales, SIN el 9 de celular (no es derivable; inventarlo corrompe los fijos). Validación '
  'AUTORITATIVA: el cliente valida solo por UX. Cap complementario de longitud: '
  'user_private_phone_len_chk (0070).';

notify pgrst, 'reload schema';
```

### 5.2bis El regex, verificado contra el Postgres real

El CHECK es un claim de seguridad (`RTEL.11.2`), así que se verificó en vez de asumirse. Ejecutado como `SELECT` de solo lectura (sin DDL/DML) contra el Postgres remoto del proyecto:

```
MATCH     +541123456789            (canónico AR)
MATCH     8 y 15 dígitos           (bordes del rango)
no-match  7 y 16 dígitos           (fuera de rango)
no-match  '+541123456789' || chr(10)   ← EL CASO CRÍTICO
no-match  chr(10) || '+541123456789'
no-match  newline en el medio
no-match  || chr(13) (CR)   || chr(9) (tab)
no-match  '+54 1123456789'  (espacio)
no-match  "+541123456789'"  (comilla simple)
no-match  '+54112345678<script>'
no-match  '+0411234567'     (código de país con 0)
no-match  '541123456789'    (sin +)
no-match  '+54' || dígitos arábigo-índicos   ← [0-9] es ASCII-only
```

**Por qué esto no era trivial:** en PCRE (Perl, JavaScript) `$` **sí** matchea antes de un `\n` final, con lo cual `'+541123456789\n'` **pasaría** un CHECK escrito igual en un motor tipo PCRE. Postgres usa POSIX ARE y, sin *newline-sensitive matching* (apagado por defecto), `$` ancla solo al fin de string. La garantía depende de esa diferencia, así que queda fijada como test (`RTEL.14.6`) para que una reescritura futura del regex no la debilite en silencio.

**Hallazgo adicional:** `chr(0)` ni siquiera llega al CHECK — Postgres rechaza el valor a nivel de tipo (`54000: null character not permitted`). Ese vector lo cierra `text`, no el constraint.

### 5.3 RLS y multi-tenancy (obligatorio declararlo)

`public.user_private` **no tiene `establishment_id`**: su aislamiento no es por tenant sino **self-only por usuario**, que es más estricto. El delta **no toca** `user_private_select_self` ni `user_private_update_self` (`0068:105-114`), ni los grants (`select, update` a `authenticated`; `insert/delete` revocados), ni el `revoke all ... from anon, public`.

Un CHECK constraint es ortogonal al control de acceso: **valida input, no autoriza**. La pregunta "¿quién puede escribir este teléfono?" la sigue contestando la RLS (solo el dueño de la fila, `RTEL.11.3`); la pregunta "¿qué forma puede tener?" la contesta ahora el CHECK. Ninguna de las dos sustituye a la otra.

Sin cambios tampoco en `members.ts`, que nunca proyecta `phone`/`email` de terceros (hallazgo RLS #2, `RTEL.11.5`).

### 5.4 Offline-sync (PowerSync)

`user_private` **sí** está en el sync schema (`app/src/services/powersync/schema.ts:88`, columna `phone` como `column.text`) con stream self-only. Este delta:

- **No cambia el schema local** — la columna sigue siendo texto; solo cambia el *contenido* (canónico). No hay migración de SQLite local ni cambio de bucket.
- **No cambia la estrategia de conflictos** — las escrituras de teléfono **no** pasan por la cola CRUD de PowerSync: `saveOwnPhone` y `saveProfile` escriben **directo a Supabase** y son **online-only** por `assertOnline` (`establishments.ts:195,283`), consistente con el baseline `R9.2`. Por lo tanto no hay writes offline encolados que puedan chocar contra el CHECK después.
- **Lecturas**: `buildOwnPhoneQuery` / `buildOwnEmailPhoneQuery` (`local-reads.ts:229,254`) devuelven el canónico desde el SQLite local; el formateo a display es del lado de la UI (`RTEL.10.1`).

**Offline-first (principio 3 de CLAUDE.md):** este delta **no** es carga de datos en campo. Es un dato administrativo de perfil, de baja frecuencia, que ya era online-only por decisión del baseline. No se degrada ninguna capacidad offline: el peón en la manga nunca edita su teléfono con las manos embarradas. Se deja explícito para que el reviewer no lo lea como una omisión.

### 5.5 Coordinación de deploy

La migración y el release del cliente **viajan juntos**. Un cliente viejo (que envía `"11 2345 6789"` crudo) recibiría `23514` tras aplicar `0126`. Al ser beta con release coordinado, no se diseña compatibilidad hacia atrás; `RTEL.8.3` garantiza que, si ocurriera, el usuario ve un mensaje accionable sobre el formato y no un error genérico.

---

## 6. Services

```ts
// establishments.ts — saveOwnPhone / saveProfile
const norm = normalizePhone(phone);
if (!norm.ok) return { ok: false, error: { kind: 'unknown', message: PHONE_FORMAT_COPY } };
// ... .update({ phone: norm.canonical })
```

Las tres capas de garantía, de la más débil a la más fuerte: **tipo** (`PhoneValue`, §4) → **re-normalización en el service** (arriba; defiende aun si un call site futuro construyera el valor a mano) → **CHECK** (autoritativa, §5.2).

`classifyError` gana una rama: `code === '23514'` con el nombre del constraint de teléfono → `kind: 'unknown'` + copy **fijo** de formato (RTEL.8.3). Hoy caería en el genérico "No pudimos guardar el teléfono", que oculta la causa real y deja al usuario sin salida.

> **⚠️ Restricción bloqueante (HIGH-1, `RTEL.8.5`/`RTEL.8.6`).** Esa rama **no** debe leer `error.details` ni `error.hint`, y **no** debe devolver el `error.message` crudo de Postgres — solo el copy fijo. Y la firma `classifyError(error: { message?: string; code?: string } | null)` (`establishments.ts:48-58`) **no se amplía**.
>
> El motivo es concreto: en un `23514`, PostgREST expone en `details` el `Failing row contains (...)` de Postgres, que trae **email y teléfono en claro** (`authenticated` tiene `grant select` sobre `user_private`). Hoy no llega a la UI **solo porque la firma no lo consume** — una protección accidental. T10 modifica exactamente esta función, y ampliar la firma "para dar mejor diagnóstico" es el refactor más natural del mundo. Nótese además que la rama genérica actual devuelve `message: msg`: la rama de `23514` **no** debe copiar ese patrón.

---

## 6bis. Guard de paridad — que `RTEL.3.4` no sea prosa (RTEL.3.9)

**El problema:** "ninguna pantalla debe renderizar un input de teléfono con `FormField` directo" no lo hace cumplir nadie. En seis meses, una tercera pantalla con `keyboardType="phone-pad"` reintroduce el bug exacto que este delta cierra — con la diferencia de que ya nadie recuerda por qué existe `PhoneField`.

**La firma es greppable**, que es lo que hace barato el guard:

```
keyboardType    ... 'phone-pad'
autoComplete    ... 'tel'
textContentType ... 'telephoneNumber'
```

Cualquiera de las tres, en `app/app/**` o `app/src/components/**`, en un archivo que no sea `PhoneField.tsx`, es un input de teléfono construido a mano.

**Forma elegida: test de `node:test`**, `app/src/components/phone-field-guard.test.ts` — camina el árbol, saltea comentarios, reporta `archivo:línea` y falla con un mensaje que explica *por qué* (apuntando a `PhoneField`).

Por qué un test y no un script nuevo:
- **Cero plumbing.** `scripts/check.mjs` ya corre la suite unitaria; un script nuevo obligaría a editar `check.mjs` y a mantener otro binario para una sola regla.
- **Vive al lado de lo que protege.** Quien toque `PhoneField.tsx` ve el guard en el mismo directorio.
- **Es lo que pedía la trazabilidad.** `RTEL.3.4` hoy no tiene ningún test; convertirlo en test cierra el hueco (`docs/specs.md`: cada `R<n>` verificable por ≥1 test).

**⚠️ Registro obligatorio:** `scripts/run-tests.mjs:61` enumera los archivos de test **explícitamente** (no hay glob). Un test que no se agregue a esa lista **nunca corre** — un guard muerto es peor que ninguno, porque da falsa confianza. Es un paso propio en tasks (T13).

**Válvula de escape (RTEL.3.10):** comentario en la línea o la anterior, con justificación, replicando el patrón de `check-hardcode.mjs:112` (`design-lint-disable-next-line -- razón`) → `phone-field-disable-next-line -- <razón>`. Una excepción es de una línea y va justificada; no hay disable de archivo entero.

**Alternativa considerada:** extender `scripts/check-hardcode.mjs`. Descartada porque ese script tiene un alcance declarado y acotado (anti-hardcode de color/spacing, ADR-023 §4); meterle una regla de composición de componentes lo convierte en un cajón de sastre y confunde su mensaje de error.

## 7. Alternativas descartadas

### A1 — Guardar E.164 completo, auto-insertando el `9` de celular (**la trampa principal**)

`+549 11 2345 6789` es el E.164 real de un celular AR; sería el formato "correcto de libro" y el único directamente usable por WhatsApp.

**Descartada.** El `9` **no es derivable** de los 10 dígitos nacionales sin una tabla de prefijos móvil/fijo (justo lo que D4 descarta). Auto-insertarlo convierte **todos los fijos en números inválidos**, y de forma **irrecuperable**: una vez guardado, nada distingue un `9` puesto por el usuario de uno inventado por nosotros. Se cambiaría una feature futura (WhatsApp) por corrupción presente del dato de contacto de los clientes que pagan. El canónico elegido preserva el número nacional íntegro, así que el `9` se puede anteponer *después*, cuando exista el bit explícito.

> **Precisión sobre el dedup (MEDIUM-3, Gate 1).** Las versiones previas de este design y de `context` C1 decían que el canónico habilita dedup **"exacto"**. Es una **sobre-afirmación**: al descartar el `9`, un móvil y un fijo que compartan el mismo número nacional colapsan al mismo string (`+5491123456789` y `+541123456789` → ambos `+541123456789`). Lo correcto: el canónico habilita una **comparación por igualdad de string bien definida y estable**, que es lo que hoy no existe; pero **no** es un identificador de abonado, y por eso `RTEL.11.7`/`RTEL.11.8` prohíben usarlo como clave de identidad, dedup de cuentas, recuperación de acceso o matching de invitación hasta que exista `phone_kind`. El gate verificó que hoy no hay riesgo explotable: `[auth.sms]` deshabilitado, sin índice único sobre `phone`, sin lookup por teléfono en ningún flujo.

### A2 — Guardar 10 dígitos nacionales + país en columna aparte

Modelo normalizado "de manual" (`phone_national` + `phone_country`).

**Descartada.** Duplica el estado a mantener sincronizado, obliga a una migración de schema sobre una tabla de PII, y **no tiene dónde poner el escape internacional** de D3 (un `+34 600 123 456` no tiene "10 dígitos nacionales" en el sentido argentino). Un solo string E.164-sintáctico expresa ambos casos, se compara por igualdad y se valida con un regex de una línea.

### A3 — Guardar los dígitos crudos como los tipeó el usuario (statu quo + sanitización)

El cambio mínimo: dejar de guardar letras, nada más.

**Descartada.** No resuelve nada de lo que importa: `"11 2345-6789"` y `"1123456789"` siguen siendo filas distintas → dedup imposible, y el CHECK server tendría que aceptar separadores arbitrarios, con lo que dejaría de ser una garantía de saneamiento útil para consumidores downstream (`RTEL.11.2`).

### A4 — CHECK `NOT VALID` sin `VALIDATE`, grandfathereando las filas viejas

Es el patrón que `0070:177-185` usa para `animals.tag_electronic` (ahí, a propósito, por basura de e2e).

**Descartada acá** por correctitud, no por prolijidad: ver DP3. Postgres re-evalúa todos los CHECK de la fila en cualquier `UPDATE`; una fila con `phone` legacy sucio haría fallar el `update ... set email = ...` de `propagate_confirmed_email` (`0068:169-194`), **rompiendo la confirmación de cambio de email** de ese usuario. El `NOT VALID` no protege de eso — solo saltea el re-chequeo inicial. Con residuo cero el problema no existe.

### A5 — Trigger `BEFORE INSERT/UPDATE` que normaliza en el server, en vez de un CHECK

Más permisivo: el server acepta cualquier forma y la canoniza solo.

**Descartada.** (a) Mutar datos del usuario en silencio esconde bugs del cliente en vez de exponerlos — con el CHECK, un cliente que manda formato viejo **falla ruidoso** y se arregla; (b) un trigger es código imperativo con `search_path` y `security definer` que auditar (más superficie de Gate 1) frente a un CHECK declarativo; (c) el trigger tendría que decidir qué hacer con lo no normalizable, y la única respuesta segura vuelve a ser rechazar. El CHECK da la misma garantía con menos superficie.

### A6 — Solo agregar `maxLength` + `sanitizePhoneInput` a `crear-campo.tsx` (fix de 2 líneas)

Cierra el bug reportado literalmente y hoy.

**Descartada.** Es el fix que garantiza la reincidencia: deja **dos copias** del mismo input y la próxima mejora vuelve a aplicarse a una sola. La causa raíz del bug es la ausencia de un componente compartido, no la ausencia de dos props (D5).

### A7 — `libphonenumber-js`

**Ya descartada por el leader (D4)**: ~150 KB para un solo país. Se registra acá porque DP1 toma prestada *una parte mínima* de lo que aporta —el largo del código de área— con ~36 constantes y **solo para presentación**, sin que ningún camino de validación o almacenamiento dependa de ellas (`RTEL.4.6`).

---

## 8. Riesgos

| # | Riesgo | Severidad | Mitigación |
|---|---|---|---|
| R-1 | El caret salta al final al editar en el medio de la máscara | Baja | Campo de 10 dígitos tipeado de izquierda a derecha; tradeoff documentado (C6). Sin máscara no habría problema, pero sí peor legibilidad. |
| R-2 | La tabla de códigos de área tiene una entrada mal/faltante | Baja | Efecto **solo cosmético** por diseño (`RTEL.4.6`); nunca bloquea ni corrompe. Corregible en una línea. |
| R-3 | Un cliente viejo escribe formato no canónico tras aplicar `0126` | Media | Release coordinado (§5.5) + copy accionable en `23514` (`RTEL.8.3`). |
| R-4 | La migración aborta por residuo y frena el deploy | Baja | Es el comportamiento **buscado** (DP3). Volumen beta ⇒ reconciliación manual trivial. |
| R-5 | `keyboardType="phone-pad"` no rinde bien en web táctil | Baja | Se veta en Gate 2.5 con touch real (memoria: Playwright Desktop enmascara touch). Si falla, `inputMode` es un follow-up de una línea (C5). |
| R-6 | Se pierde el bit móvil/fijo al normalizar el `9` (DP2) | Baja | Consciente. El número nacional queda íntegro; el bit se recupera explícito si aparece la feature de contacto. **MEDIUM-3**: además de perder el bit, el canónico **colapsa** móvil y fijo del mismo número nacional en un mismo string → `RTEL.11.7`/`RTEL.11.8` prohíben usar `phone` como identidad/dedup/recuperación/matching hasta que exista `phone_kind`. |
| **R-7** | **PII en logs del servidor por rechazo del CHECK** — `DETAIL: Failing row contains (...)` incluye email y teléfono en claro (`authenticated` tiene `grant select` sobre `user_private`, `0068:200`); queda sujeto a retención y drains del log y **sobrevive a `delete_account`** | Media | **RIESGO RESIDUAL ACEPTADO** (decisión del leader, HIGH-1 de Gate 1). Razones: (a) es **self-scoped** — la RLS impide que el `UPDATE` toque una fila ajena, así que el `DETAIL` solo puede contener PII **propia** del usuario que dispara el error; (b) la audiencia del log son quienes ya tienen acceso a la DB; (c) con MEDIUM-1 cerrado, cliente y CHECK coinciden en todos los bordes → el rechazo es **prácticamente inalcanzable** en operación normal (solo lo alcanza un cliente viejo o un ataque deliberado contra la propia fila). Descartada la alternativa de un trigger `BEFORE` con excepción propia: reintroduce la superficie que §7/A5 ya descartó, por un `DETAIL` self-scoped. Documentado también en el header de `0126`.<br><br>**Patas declaradas de esta aceptación** (si alguna cae, `R-7` se re-evalúa; no son refactors libres): (1) **`RTEL.2.9`** — cliente y CHECK coinciden en todos los bordes, que es lo que vuelve inalcanzable el rechazo (MEDIUM-1 fue justamente esa divergencia, y era alcanzable); (2) **`RTEL.8.5`/`RTEL.8.6`** — la PII tampoco viaja al cliente por `error.details`, sostenido por el test ejecutable `classify-error.test.ts` (RTEL.14.9), no por criterio del reviewer.<br><br>**L-3 (sin acción):** un cliente que reintente el guardado ante `23514` amplifica el volumen de log del `DETAIL`. No se agrega backoff ni límite: sigue siendo self-scoped (solo PII propia) y el rechazo ya es inalcanzable en operación normal. Anotado para que no se lea como omisión. |

### Anexo — observaciones LOW del Gate 1 (no bloqueantes, anotadas para no confundir a nadie)

- **El backfill dispara `user_private_set_updated_at`.** El trigger de `0068:56-58` corre en cada `UPDATE`, así que las filas normalizadas por T2 cambian su `updated_at` y **re-sincronizan por PowerSync** después de aplicar `0126`. Es inocuo (el contenido es el mismo teléfono en forma canónica), pero **T22/T23 no deben leer ese movimiento de sync como una anomalía**. Solo afecta a las filas efectivamente normalizadas (el backfill saltea las que ya estaban canónicas vía `is distinct from`).
- **Tests negativos de RLS sobre `user_private`.** `supabase/tests/user_private/run.cjs:244` intenta escribir `'+540000000000'` en la fila de otro usuario y asserta que **no** cambia. Ese valor es canónico-válido (`+` `5`, 12 dígitos) y **debe seguir siéndolo**: si alguien lo cambiara por un valor no canónico, el `UPDATE` fallaría por el CHECK y el test pasaría **por la razón equivocada**, dejando de verificar la RLS. Anotar el porqué en el test.

---

## 9. Tests

| Requirement | Test |
|---|---|
| RTEL.2.* (N1–N6, precedencia) | `app/src/utils/phone.test.ts` — unit puro |
| RTEL.1.4 (se saca el `9`), RTEL.2.8 (no se saca el `15`) | `phone.test.ts` — casos dedicados |
| RTEL.4.3 (agrupación 2/3/4 díg.), RTEL.4.4 (backspace) | `phone.test.ts` — incluye `2241…` (Chascomús) |
| RTEL.5.1, RTEL.5.2, RTEL.5.4 | `app/src/utils/validation.test.ts` — ajustado |
| RTEL.3.6, RTEL.3.7 (el bug reportado) | E2E sobre el gate de `crear-campo`: tipear letras no deja nada; no se superan los **12** dígitos (tope de tipeo, `RTEL.4.2`) |
| RTEL.4.2 (tope de tipeo = 12, validación intacta en 10) | `app/src/utils/phone.test.ts` — tope, "12 no afloja la validación" y N3/N4 destapadas; E2E `telefono.spec.ts` (tipeo y paridad) |
| RTEL.6.1, RTEL.6.2 | E2E / capture: borde `$terracota` + inline + scroll-al-campo |
| RTEL.7.1 (CHECK rechaza/acepta) | `supabase/tests/user_private/run.cjs` — test nuevo |
| RTEL.11.2 (vectores de inyección, incl. newline final) | `supabase/tests/user_private/run.cjs` — test nuevo (RTEL.14.6) |
| RTEL.11.4 (`UPDATE` de email no rompe) | `supabase/tests/user_private/run.cjs` — test nuevo |
| RTEL.3.4 / RTEL.3.9 (paridad a futuro) | `app/src/components/phone-field-guard.test.ts` (RTEL.14.7) |
| **RTEL.8.5 / RTEL.8.6 (no fugar `details`/`hint`) — sostiene R-7** | **`app/src/services/classify-error.test.ts` (RTEL.14.9)** |
| RTEL.3.1.2 (emitir en `valid`→`incomplete`/`empty`) | `PhoneField` — test de transiciones (RTEL.14.10) |
| RTEL.2.9 / RTEL.2.9.1 (equivalencia de encodings) | `phone-vectors.json` ejercitado desde `phone.test.ts` **y** `run.cjs` (RTEL.14.11) |
| RTEL.2.9.2 (equivalencia del backfill) | El precheck abortivo + `validate constraint` de la propia `0126` |
| RTEL.9.1, RTEL.9.2 | La suite E2E completa en verde tras aplicar `0126` |
| RTEL.10.1 | Capture del display read-only |

---

## 9bis. Reconciliación al AS-BUILT (implementer, 2026-07-18)

Lo construido difiere del diseño de arriba en siete puntos (los 6 primeros, de la implementación; el
7º, del fix-loop del veto de diseño del Gate 2.5). Ninguno cambia el *qué* (los `RTEL.<n>` se cumplen
tal como están escritos); son decisiones de estructura tomadas durante la implementación, y se
documentan acá para que el design no mienta (regla dura de `docs/specs.md`).

**1. `PhoneValue` vive en `utils/phone.ts`, no en `PhoneField.tsx`.** §4 lo declaraba en el componente.
Se movió a la capa pura y `PhoneField` lo **re-exporta** como parte de su contrato (`export type
{ PhoneValue } from '../utils/phone'`). Motivo: la derivación del valor y el copy de error tienen que ser
testeables **sin renderer de React** (el repo no tiene Jest/RNTL seteado, `docs/conventions.md` §Tests), y
`utils/validation.ts` necesita el tipo sin importar de `components` (eso invertiría las capas de
`architecture.md`). El contrato de tres estados de `RTEL.3.1.1` queda idéntico.

**2. La transición del input se extrajo a funciones puras.** §4 dejaba el estado interno (`digits` +
`intl`) y su lógica dentro del componente. As-built, `phone.ts` expone `PhoneInputState`,
`renderPhoneInput`, `phoneInputFromValue` y `phoneInputChange(previous, incoming) → { state, value }`, y
`PhoneField` quedó como cáscara. Motivo: sin esto, el tipeo, el borrado, el pegado, los topes y —sobre
todo— **la emisión de L-2 (`RTEL.3.1.2`)** solo serían verificables por E2E. Con la extracción,
`RTEL.14.2` y `RTEL.14.10` son unit tests deterministas. **`phoneInputChange` devuelve SIEMPRE el valor a
emitir**, que es donde vive la garantía de L-2.

**3. `PhoneField` tiene dos props más que las de §4: `showError` y `required`.** §4 solo listaba
`error?: string | null`. Motivo: el mensaje puntual de `RTEL.6.4`/`RTEL.6.6` y la sugerencia de
`RTEL.6.7` se derivan de **los dígitos tipeados**, que el caller no ve (y no debe ver, `RTEL.3.1.1`) → el
componente los deriva y los muestra; el caller solo decide **cuándo** (`showError`, al intentar guardar,
no mientras se tipea) y **si el vacío es error** (`required`: verdadero en el gate de `R3.8`, falso en el
perfil — `RTEL.5.3` vs `RTEL.5.4`). `error` se conserva y **se usa**: es por donde entra el rechazo
server-side del formato (punto 5).

**4. `validateProfile` cambió de firma.** Ahora recibe `phone: PhoneValue` (no texto crudo) y devuelve
`{ name, phoneInvalid, valid }` en vez de `{ name, phone: FieldError, valid }`. Motivo: devolver un
segundo mensaje genérico desde el validador **pisaría** el mensaje específico del componente (el del `15`
con su sugerencia) — reintroduciendo por otra puerta la divergencia de copy que el delta cierra. El
comportamiento de `RTEL.5.4`/`RTEL.5.5` es el mismo. `validation.ts` además **re-exporta** de `phone.ts`
(`phoneDigits`, `sanitizePhoneInput`, `isValidPhone`, `PHONE_*`) para no romper importadores, sin
reimplementar nada (`RTEL.2.9`).

**5. `classifyError` devuelve `kind: 'phone_format'` (no `'unknown'`).** §6 proponía `kind:'unknown'` +
copy fijo. Con `'unknown'` la UI **no puede distinguir** el rechazo de formato de un error genérico, y
tendría que elegir entre mostrar siempre `error.message` (que en la rama genérica es el mensaje CRUDO de
Postgres) o no mostrar nunca el copy accionable de `RTEL.8.3`. Con la variante propia, cada pantalla
ubica el rechazo **sobre el campo** (vía la prop `error`, que es donde corresponde según `RTEL.6.5` — el
número es lo que está mal, no el guardado) y deja el copy genérico para el resto. `RTEL.8.5`/`RTEL.8.6`
se cumplen igual y siguen verificados por `classify-error.test.ts`: el copy es **fijo**, la firma no se
amplió, y `details`/`hint`/mensaje crudo no se propagan. Los tipos de resultado de `establishments.ts`
pasaron a usar `ClassifiedError` (ampliación de unión; todos los consumidores comparan contra
`'network'`, así que no hubo cambios de call site).

**6. Los tests backend del CHECK se AUTO-SALTEAN hasta que `0126` esté aplicada.** El patrón del repo
para una suite que depende de una migración no aplicada es comentar su hook en `scripts/run-tests.mjs`
(spec 12/14/M6/audit/health). Acá eso habría apagado **toda** la suite `user_private`, incluidos sus 9
tests de RLS/PII que **no** dependen de `0126`. As-built: el bloque nuevo hace un *probe* (intenta
escribir un valor no canónico; si no lo rechaza un `23514` del constraint, la migración no está) y se
saltea con un mensaje explícito, dejando el resto de la suite corriendo. El hook queda **enganchado**.
`T23` exige verlo en **verde** (no en SKIP) tras el apply: si sigue salteado, la migración no entró.
**Estado: `0126` aplicada a dev el 2026-07-18** — el probe ya no saltea y los **6 tests del CHECK corren
en verde, 0 skipped** (`T22` cerrada; ver el bloque de estado de `tasks-telefono.md`). El auto-skip se
conserva a propósito: es lo que mantiene la suite corriendo en un entorno donde `0126` todavía no entró.

**7. Fix-loop del veto de diseño del Gate 2.5 (leader, 2026-07-18) — `FormField` crece 1 prop + 1 export.**
El leader vetó las capturas y encontró **dos defectos de presentación** que el as-built anterior tenía
(ninguno de lógica: normalización, validación, canónico, DP4 y la migración `0126` **no se tocaron**).

| # | Defecto (medido sobre las capturas) | Fix as-built |
|---|---|---|
| 1 | El placeholder se leía como **valor ya cargado**: misma posición que un valor real y solo distinguible por color, encima en `$textMuted` (**6.03:1**, apenas **3.2×** de separación contra el valor en `$textPrimary`). En el gate de `R3.8`, que bloquea, eso cuesta un rechazo seco al tocar Continuar. Regresión propia del delta: el as-built previo a `PhoneField` usaba `placeholder="Ej. 11 2345 6789"` en las dos pantallas y el componente **perdió el `Ej.`** al unificarlas. | (a) Copy: vuelve el prefijo → `Ej. 11 2345-6789` / `Ej. +34 600 123 456`. (b) Color: `FormField` pasa el placeholder de `$textMuted` a **`$textFaint`** (4.24:1 medido; separación contra el valor **4.6×**). |
| 2 | El label `Teléfono` estaba **sangrado y saltaba**: dibujado dentro de la columna del input, el chip `+54` (hermano de layout a la izquierda) lo corría 75px → columna de labels dentada (`Nombre` x=37 vs `Teléfono` x=112 en el perfil) y **salto de ~76px** al pasar a modo internacional, cuando el chip desaparece. **ADR-027** exacto. | El label lo dibuja `PhoneField` a **nivel de grupo** (`FieldLabel`) y el interno de `FormField` se apaga con `hideLabel`. Cae también el *spacer* de U+00A0 que simulaba el alto del label en la columna del chip: sin label en la fila, chip e input se alinean por su `minHeight="$touchMin"` compartido. |

**Cambios de contrato (los únicos):**
- `FormField` gana `hideLabel?: boolean` (**aditiva**, default `false` ⇒ cero cambio para los callers previos). `label` sigue siendo **obligatorio** y sigue siendo el nombre accesible del input (`aria-label` web / `accessibilityLabel` native) → ocultarlo no degrada a11y ni rompe los `getByLabel('Teléfono')` de `telefono.spec.ts` / `profile.spec.ts` / `establishments.spec.ts`.
- `FormField` **exporta `FieldLabel`**. Es lo que hace que el label del grupo y el de los campos hermanos no puedan divergir: una sola definición usada por los dos, mismo criterio que el resto del delta (paridad por construcción, no por convención).
- No se agregó `inputMode` (`RTEL.3.8` intacta) ni ninguna prop de teclado.

**Token de placeholder — decisión anotada.** El design system **no tiene** un token de placeholder
dedicado; `$textMuted` es el color de los **labels**, así que usarlo para el placeholder era la causa
raíz del defecto 1. Se eligió `$textFaint` (el más claro con legibilidad razonable, ya usado con este
mismo rol en `baston-test.tsx`). **Costo declarado, medido y aceptado**: 4.24:1 queda apenas por debajo
del 4.5:1 de WCAG AA para texto normal. Se acepta porque el placeholder es un **ejemplo**, no
información —el nombre accesible lo da el `label`, siempre visible y en 6.03:1— y porque el riesgo que
cierra (confundir vacío con lleno y perder el dato en un gate bloqueante) es operativamente peor. Si
alguna vez se agrega `$textPlaceholder`, `FormField` es el único consumidor a migrar. **Blast radius**:
el cambio de color aplica a **todos** los `FormField` de la app — deliberado, porque "un placeholder no
debe leerse como un valor" es una propiedad de todo formulario, no de este campo.

**Verificación (medida con Pillow sobre las capturas regeneradas, no a ojo):**
- Placeholder `(114,249)-(237,263)`, píxel más oscuro `rgb(128,122,116)` → **4.24:1**. Valor real
  `(113,249)-(214,260)`, `rgb(15,14,12)` → **19.29:1**. Ya no se confunden: color (4.6× de separación),
  copy (`Ej. `) y hasta silueta (la `j` de `Ej.` mete descendente, h=15 vs h=12).
- Perfil: `Nombre` x=37 y `Teléfono` x=36. **El 1px es *side bearing* de la `N` vs la `T`, no layout**:
  las cajas del grupo arrancan las dos en x=36 y terminan las dos en x=375, y el mismo par da 37/36 en
  el display de **solo lectura** (`09`), que nunca tuvo chip.
- El bbox del label es **idéntico** —`(18,207)-(71,216)`— en `01` (AR, con chip), `08` (internacional,
  sin chip) y `05` (AR + error): el label **no se mueve** cuando la decoración aparece o desaparece
  (ADR-027 regla 2).

**Suites tras el fix-loop:** `pnpm -C app typecheck` verde; **64/64** unit del delta
(`phone.test.ts` + `phone-field-guard.test.ts` + `classify-error.test.ts` + `validation.test.ts`);
**10/10** E2E de `telefono.spec.ts` + `profile.spec.ts` + `establishments.spec.ts`; capture regenerado
con `app/dist` reconstruido limpio (**2 passed**, 12 capturas).

### Hueco de UX detectado y **CERRADO** — el tope de tipeo sube de 10 a 12 (`RTEL.4.2`)

**Cómo se detectó.** En la autorrevisión adversarial del implementer apareció que, con el tope de tipeo
en 10 dígitos, quien **tipea** su celular como se dice en Argentina (`11 15 2345 6789`) se quedaba en
`11 1523-4567` —10 dígitos, formalmente **válidos**— y el sistema lo aceptaba **sin avisar**: un número
equivocado persistido en silencio. La ayuda de DP4 necesita ver 12 dígitos, así que solo se disparaba al
**pegar** o autocompletar. Es decir: **DP4 no cubría el caso más común, que es tipear en la manga**, que
es justamente para lo que Raf la aprobó. El implementer **no** lo cambió por su cuenta (habría
contradicho un requirement aprobado y su test) y lo escaló.

**Cómo se cerró (decisión de Raf, 2026-07-18).** `RTEL.4.2` se relajó a **12 dígitos tipeables** en modo
AR: `PHONE_AR_TYPING_MAX_DIGITS = 12` en `app/src/utils/phone.ts` (§3.1), aplicado en la transición
`phoneInputChange`. La reconciliación del requirement quedó anotada bajo `RTEL.4.2` y en el historial de
`requirements-telefono.md`.

**Lo que NO cambió — el borde que importa.** La **validación sigue siendo de exactamente 10 dígitos**
(`RTEL.5.1`) y el canónico sigue siendo `+54` + 10. Los largos 11 y 12 son estados **transitorios**:
o normalizan por N3 (`0` troncal) / N4 (`54` adelante), o quedan `incomplete` → **nunca** son `valid` y
**nunca** se persisten. Ninguna de las dos pantallas guarda en ese estado, y el CHECK server sigue siendo
la frontera real (`RTEL.5.6`). El tope de tipeo es un tope de **buffer**, no un criterio de validez.

**Efecto secundario buscado.** N3 y N4 también eran inalcanzables tipeando: el tope de 10 los truncaba a
un número que normalizaba **distinto** (`01123456789` → `0112345678` → `+540112345678`). Con 12, el tipeo
llega a la regla correcta.

**Verificación.** `phone.test.ts` cubre las tres patas: el tope en 12, que 11 y 12 dígitos **siguen sin
ser válidos**, y que subir el tope destapa N3/N4. `telefono.spec.ts` asserta el tope de 12 en las dos
pantallas y que el `15` **tipeado** dispara la sugerencia de DP4.

## 10. Nota de cierre (Puerta 2)

Al cerrar el delta, y **solo entonces** (hoy hay otro implementer reconciliando el baseline de spec 01 — no se toca ningún otro archivo de la carpeta):

1. Agregar el puntero de este delta al bloque "Deltas posteriores" de `design.md` del baseline (ADR-028).
2. Anotar bajo `R2.1` y `R3.8` del baseline una nota as-built de alto nivel: el teléfono se captura con `PhoneField`, se persiste canónico `+54`+10 y lo valida `user_private_phone_format_chk`. **Sin reescribir los EARS.**
