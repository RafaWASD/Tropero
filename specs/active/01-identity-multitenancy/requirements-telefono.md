# Spec 01 — Delta TELÉFONO — Requirements (EARS)

**Status**: `spec_ready` · Delta **Nivel B (ADR-028)** sobre spec 01 · **CON BACKEND** (CHECK de formato + migración de normalización) · **Gate 1 APLICA** (schema + PII) · **Migración `0126`**.
**Fecha**: 2026-07-18.
**Fuente de verdad**: `specs/active/01-identity-multitenancy/context-telefono.md` (Gate 0 cerrado por el leader). Decisiones D1–D6 (leader) + C1–C9 (delegadas a la spec) traducidas a EARS.
**Numeración**: `RTEL.<n>`. No colisiona con el `R<n>` del baseline de spec 01.
**Baseline afectado**: `R2.1` (perfil edita teléfono), `R3.8` (gate de teléfono al crear campo). No los reemplaza: los refina. `R1.1` (el teléfono **no** se pide en signup) queda **intacto**.

---

## ⚠️ Decisiones de criterio propio para Puerta 1

Tres decisiones que el `spec_author` cerró bajo la delegación explícita del leader ("decidilo vos y justificá"). Raf las ratifica o corrige al aprobar la spec.

### DP1 — Máscara agrupada por **código de área**, no `AA NNNN-NNNN` fijo (OVERRIDE de la letra de D2)

**D2 pidió máscara en vivo `11 2345-6789`.** Esa agrupación asume un código de área de **2 dígitos** (Buenos Aires). En Argentina los códigos de área son de **2, 3 o 4** dígitos sobre un número nacional que siempre suma **10**:

| Área | Ejemplo | Agrupación correcta | Con la máscara literal de D2 |
|---|---|---|---|
| 2 díg. (`11`) | Buenos Aires | `11 2345-6789` | `11 2345-6789` ✅ |
| 3 díg. (`341`) | Rosario | `341 456-7890` | `34 1456-7890` ❌ |
| 4 díg. (`2241`) | **Chascomús** | `2241 43-0000` | `22 4143-0000` ❌ |

El **primer cliente beta está en Chascomús (2241)**: con la agrupación literal, el teléfono del usuario más importante del proyecto se renderiza visiblemente roto.

**Resolución (DP1):** la agrupación se deriva de una **tabla acotada de códigos de área** (~36 entradas: `11` de 2 dígitos, un set conocido de 3 dígitos, y **todo lo demás se trata como 4**). ~30 líneas, no los ~150 KB que D4 descarta — D4 rechazó el peso de una librería multi-país, no la idea de conocer el formato del único país que soportamos.

**Propiedad de seguridad que hace barata la decisión:** la tabla es **puramente cosmética**. No participa de la validación (siempre 10 dígitos) ni del almacenamiento (siempre `+54` + los 10 dígitos). Si una entrada estuviera mal, el único efecto es una agrupación visual rara: **nunca** bloquea al usuario ni corrompe el dato. (Ver `RTEL.4.6`.)

### DP2 — El `9` que el usuario provee se **saca** al normalizar

C1 fija el canónico en `+54` + 10 dígitos nacionales, y **prohíbe inventar** el `9` de celular (adivinarlo corrompe los fijos de forma irrecuperable). El caso simétrico —el usuario **pega** `+5491123456789`, dándonos el `9` de verdad— se resuelve **sacándolo**, no conservándolo.

**Por qué:** conservarlo produciría dos representaciones válidas del mismo abonado (`+541123456789` y `+5491123456789`) y el dedup —el beneficio principal que este delta compra— dejaría de ser una comparación por igualdad. Se prioriza **unicidad exacta** sobre un bit móvil/fijo que de todos modos quedaría poblado solo para la minoría que pega en E.164. El bit se recupera después, explícito, si aparece la feature de contacto (`phone_kind`).

### DP3 — La migración **aborta** ante residuo no normalizable (no grandfatherea)

La alternativa "CHECK `NOT VALID` sin `VALIDATE`, filas viejas grandfathereadas" es el patrón que `0070:177-185` usa para `animals.tag_electronic`. **Acá no sirve**, y la razón es de correctitud, no de prolijidad: Postgres evalúa **todos** los CHECK de una fila en **cualquier** `UPDATE`, cambie o no la columna restringida, y `NOT VALID` solo saltea el re-chequeo de filas *existentes*. El trigger `propagate_confirmed_email` (`0068:169-194`) hace `update user_private set email = ...`; con un `phone` legacy sucio en esa fila, **ese UPDATE falla y aborta la confirmación de cambio de email** de ese usuario.

→ Residuo cero antes de `VALIDATE`, y si no se puede lograr automáticamente, la migración **falla ruidosamente** con mensaje accionable (patrón `0068:75-87`) para que el leader reconcilie a mano. Con el volumen real (beta, un puñado de filas) el costo es trivial; el de una regresión silenciosa en un flujo de auth, no.

---

## ✅ DP4 — APROBADA por Raf en Puerta 1 (2026-07-18): opción **D**, detectar y sugerir con confirmación

**Decisión tomada.** Raf eligió la **opción D**: ante un número escrito con `15`, el sistema detecta el patrón y **propone** el número corregido ("¿Quisiste decir **11 2345-6789**?"); un tap lo aplica. `RTEL.6.6`, `RTEL.6.7` y `RTEL.6.8` pasan a ser **requirements firmes** del delta (ya no condicionales), y T9b deja de ser opcional.

Se conserva abajo el análisis que fundamentó la decisión.

**El problema de producto.** Escribir el celular con `15` (`11 15 2345 6789`) es la forma corriente en Argentina, y nuestros usuarios son gente de campo, no urbanos tech. Con `RTEL.2.8`, eso cae en "no normalizable" → rechazo. El gate de teléfono (`R3.8`) **bloquea la creación del campo**: es el peor momento posible para un rechazo seco.

**Lo que NO está en discusión:** normalizar el `15` con la tabla de áreas. Queda descartado por la justificación corregida de `RTEL.2.8` (rompe `RTEL.4.6` y convierte un error cosmético en corrupción silenciosa).

**Lo que sí está en discusión:** cuánta ayuda damos en el estado de error, donde el dato todavía **no se escribió**.

| | Opción | Qué hace | Costo | Riesgo |
|---|---|---|---|---|
| **A** | Solo el mensaje de `RTEL.6.4` (statu quo de la spec) | "Ingresá los 10 dígitos, sin el 0 ni el 15." | Cero | El usuario tiene que releer y retipear todo |
| **B** | Detectar el patrón `15` **solo para el mensaje** | Mensaje específico: "Sacá el 15 y probá de nuevo." | Bajo | Ninguno sobre el dato: la tabla no toca ningún camino de escritura |
| **D** | Detectar + **sugerir con confirmación** | Muestra "¿Quisiste decir **11 2345-6789**?" y un tap lo aplica | Medio (afordancia en el estado de error) | El humano confirma; la tabla sigue sin escribir nada por su cuenta |

**Recomiendo D**, con B como repliegue conservador si se quiere minimizar superficie de UI.

Por qué D y no B:
1. **La propiedad de seguridad se mantiene.** La tabla nunca escribe: propone. El valor solo se persiste tras un acto explícito del usuario, que está mirando su propio número — el humano queda como verificador.
2. **El modo de falla es benigno.** Si el largo de área estuviera mal clasificado, el chequeo del `15` en el offset equivocado casi siempre **no matchea** → no hay sugerencia → se cae al mensaje genérico de A. Un falso positivo requiere que los dígitos contengan "15" justo en el offset errado *y* que el total dé 12; y aun así la sugerencia se muestra **formateada**, o sea visiblemente mal.
3. **Ataca el momento exacto que más duele** (rechazo en un gate bloqueante) y convierte re-tipear 10 dígitos en un tap — coherente con "el mejor en el primer try" y con velocidad operativa.

Contra-argumento honesto de D: un usuario apurado podría aceptar la sugerencia sin leerla. Es real, pero acotado por (2): para que eso persista un número equivocado tienen que fallar la tabla *y* la lectura del usuario a la vez, sobre su propio teléfono.

**Resolución:** Raf eligió **D** → van `RTEL.6.6` (mensaje específico), `RTEL.6.7` (sugerencia confirmable) y `RTEL.6.8` (el invariante que impide que la tabla escriba sin confirmación). `RTEL.6.4` se mantiene como fallback para todo lo que no matchee el patrón del `15`.

**Invariante de seguridad que sobrevive a la aprobación** (verificado por el re-Gate 1, no relajarlo): `detectArTrunkPrefix` **no** se invoca desde `normalizePhone` ni desde ningún camino de escritura — solo **propone**. El valor sugerido, una vez aceptado por el usuario, atraviesa igual las tres capas (tipo `PhoneValue` → re-normalización del service → CHECK). Aprobar DP4 amplía la **ayuda**, no afloja la **validación**.

---

## Requirements

### RTEL.1 — Formato canónico de almacenamiento (C1)

**RTEL.1.1** El sistema deberá persistir todo teléfono de `public.user_private.phone` en formato canónico `+` seguido de 8 a 15 dígitos **cuyo primer dígito no sea `0`**, sin espacios, guiones, paréntesis ni ningún otro separador.

> **MEDIUM-1 (Gate 1).** La condición "primer dígito ≠ 0" faltaba acá y en `RTEL.2.2`/`RTEL.5.2`, pero **sí** estaba en el CHECK de `RTEL.7.1` (`^\+[1-9]…`). Un `+0123456789` pasaba el cliente y explotaba con `23514` contra el server: falla cerrado, pero rompe `RTEL.2.9` (una sola definición) justo donde importa, y es lo que volvía **alcanzable** el camino de HIGH-1. Ningún código de país del plan E.164 empieza con `0`.

**RTEL.1.2** Cuando el teléfono es argentino, el sistema deberá persistirlo como `+54` seguido de exactamente los 10 dígitos del número nacional (ej. `+541123456789`, 13 caracteres).

**RTEL.1.3** El sistema no deberá anteponer un `9` de celular que el usuario no haya ingresado (no es derivable de los 10 dígitos nacionales sin una tabla de prefijos, y un `9` incorrecto sobre un fijo corrompe el dato de forma irrecuperable).

**RTEL.1.4** Cuando el valor ingresado es un número argentino que incluye el `9` de celular (13 dígitos con prefijo `549`), el sistema deberá removerlo y persistir la forma canónica `+54` + 10 dígitos (DP2).

**RTEL.1.5** El sistema no deberá persistir un teléfono cuyo valor canónico exceda los 16 caracteres.

### RTEL.2 — Normalización determinista (C2, C6)

**RTEL.2.1** El sistema deberá exponer una función pura de normalización que, dado un texto arbitrario, devuelva el valor canónico de `RTEL.1` o un resultado de "no normalizable", sin lanzar excepciones.

**RTEL.2.2** Cuando el texto ingresado empieza con `+` y contiene entre 8 y 15 dígitos **cuyo primer dígito no es `0`**, el sistema deberá normalizarlo a `+` seguido de esos dígitos, descartando todo separador (regla N1). Si el primer dígito es `0`, deberá caer en `RTEL.2.7` (no normalizable) y no deberá enviarse al servidor (MEDIUM-1).

**RTEL.2.3** Cuando el texto ingresado contiene exactamente 10 dígitos y no empieza con `+`, el sistema deberá normalizarlo a `+54` seguido de esos 10 dígitos (regla N2).

**RTEL.2.4** Cuando el texto ingresado contiene 11 dígitos y el primero es `0` (prefijo troncal nacional), el sistema deberá descartar ese `0` y aplicar `RTEL.2.3` (regla N3).

**RTEL.2.5** Cuando el texto ingresado contiene 12 dígitos que empiezan con `54`, el sistema deberá normalizarlo a `+` seguido de esos 12 dígitos (regla N4).

**RTEL.2.6** Cuando el texto ingresado contiene 13 dígitos que empiezan con `549`, el sistema deberá descartar el `9` y normalizarlo a `+54` seguido de los 10 dígitos restantes (regla N5, DP2).

**RTEL.2.7** Si el texto ingresado no encaja en ninguna de las reglas `RTEL.2.2`–`RTEL.2.6`, entonces el sistema deberá devolver "no normalizable" y no deberá truncar, completar ni reinterpretar los dígitos para forzar una coincidencia (regla N6).

**RTEL.2.8** El sistema no deberá remover el prefijo `15` de un número argentino durante la **normalización**. Un valor con `15` deberá caer en `RTEL.2.7`.

> **Justificación (corregida en la 2ª pasada).** La versión original decía que no se puede remover porque "localizarlo exigiría conocer el largo del código de área". **Ese argumento es falso desde DP1**, que introduce precisamente esa tabla. La razón real es otra y es más fuerte: usar la tabla para **normalizar** rompería la propiedad de seguridad de `RTEL.4.6` —hoy la tabla es puramente cosmética, y por eso una entrada equivocada nunca puede corromper un dato—. Si la normalización dependiera de ella, un largo de área mal clasificado recortaría los dos dígitos equivocados y **persistiría en silencio un teléfono incorrecto**, convirtiendo un error cosmético en corrupción de datos. La tabla se mantiene fuera de todo camino que escriba.

**RTEL.2.9** La lógica de normalización deberá tener **un solo origen** en el código de la app (`app/src/utils/phone.ts`), consumido por el input, por el pegado (`RTEL.4.5`), por los services (`RTEL.8.1`/`RTEL.8.2`) y por los helpers de test (`RTEL.9.1`); ningún otro módulo deberá reimplementarla. La migración deberá implementar las mismas reglas N1–N6 en SQL (`RTEL.7.3`).

> **RTEL.2.9 es un CONTROL DE SEGURIDAD, no prolijidad (MEDIUM-B, Gate 1).** La aceptación del riesgo residual `R-7` (PII en el log del servidor por el `DETAIL` del rechazo del CHECK) descansa en que el rechazo sea **prácticamente inalcanzable**, y eso solo se sostiene mientras cliente y CHECK coincidan en **todos** los bordes. Cualquier divergencia futura entre encodings reabre el camino al leak — MEDIUM-1 fue exactamente esa divergencia, y era alcanzable. Por lo tanto: **`RTEL.2.9` es una pata declarada de la aceptación de `R-7`**, y debilitarla exige re-evaluar `R-7`, no es un refactor libre.

**RTEL.2.9.1** *(MEDIUM-B)* Dado que la equivalencia no es literalmente verificable por inspección —hay **tres encodings**: `phone.ts` en TypeScript, el bloque `do $$` del backfill en PL/pgSQL y el regex del CHECK—, el sistema deberá mantener una **tabla compartida de vectores canónicos** (pares `entrada → esperado`, incluidos todos los bordes: N1–N6, primer dígito `0`, `9` removido, `15` no removido, longitudes mínima y máxima) en un único archivo de datos, y deberá ejercitarla **tanto** desde `phone.test.ts` (encoding TypeScript) **como** desde `supabase/tests/user_private/run.cjs` (encoding del CHECK), de modo que una divergencia en cualquier borde ponga **roja al menos una suite**.

**RTEL.2.9.2** *(MEDIUM-B)* La equivalencia del tercer encoding (el backfill en PL/pgSQL) deberá quedar cubierta por el propio precheck abortivo de `RTEL.7.4` seguido del `validate constraint` de `RTEL.7.2`: si el backfill produjera un valor que el CHECK no acepta, la migración deberá abortar en lugar de persistirlo.

**RTEL.2.9.3** *(MEDIUM-B)* El helper `setUserPhone` (`RTEL.9.1`) deberá **importar** la función de normalización de `phone.ts` y no deberá reimplementarla.

**RTEL.2.10** Cuando el texto ingresado empieza con `+`, el sistema deberá evaluar primero las reglas argentinas `RTEL.2.6` (prefijo `549`) y `RTEL.2.5` (prefijo `54`) y recién después la regla internacional `RTEL.2.2`; cuando el texto no empieza con `+`, no deberá aplicar la regla internacional. Sin esta precedencia, un número extranjero de 10 dígitos (ej. `+3460012345`) sería reinterpretado como argentino y un `+549…` conservaría el `9`, contra `RTEL.1.4`.

### RTEL.3 — Componente compartido y paridad entre los dos inputs (D5)

**RTEL.3.1** El sistema deberá exponer un componente único `PhoneField` que encapsule teclado, máscara, sanitización, tope de dígitos y normalización del teléfono.

**RTEL.3.1.1** *(MEDIUM-4)* `PhoneField` deberá comunicar su valor al caller mediante un tipo que distinga sin ambigüedad tres estados —vacío, incompleto/no normalizable, y válido— y deberá exponer el valor canónico **únicamente** en el estado válido. El componente no deberá entregar al caller texto crudo tipeado en ningún estado.

> **MEDIUM-4 (Gate 1).** La versión anterior declaraba `onChangeValue: (canonicalOrRaw: string) => void` y a la vez afirmaba que el caller siempre ve el canónico "por construcción": las dos cosas no podían ser ciertas. Un `string | null` plano tampoco alcanza, porque **conflaciona vacío con inválido**, y esa distinción es funcional: el perfil acepta vacío y persiste `null` (`RTEL.5.4`), mientras que el gate de `R3.8` debe rechazarlo (`RTEL.5.3`). Por eso el contrato es un tipo de tres estados y no un nullable. Definición en design §4.

**RTEL.3.1.2** *(L-2)* `PhoneField` deberá invocar `onChangeValue` en **cada** cambio del valor, incluidas las transiciones de `valid` a `incomplete` y de `valid` a `empty`. El componente no deberá emitir únicamente al alcanzar el estado `valid`.

> **L-2 (Gate 1) — bug introducido por el propio fix de MEDIUM-4, no un LOW.** Si el componente emitiera solo en `valid`, borrar un dígito de un número ya válido dejaría al caller con el `canonical` **anterior**, y persistiría un número que el usuario ya editó. **Las tres capas de garantía no lo atrapan**: el tipo es correcto (nunca hubo texto crudo), la re-normalización del service devuelve el mismo canónico stale (re-normalizar un canónico válido es idempotente), y el CHECK lo acepta porque *es* un canónico bien formado — solo que del número equivocado. Es el único camino del delta que puede persistir un teléfono incorrecto sin que nada falle, así que la obligación de emitir va escrita, no asumida. Test en `RTEL.14.10`.

**RTEL.3.2** La pantalla de gate de teléfono al crear campo (`crear-campo.tsx`, `CompletePhoneScreen`, baseline `R3.8`) deberá capturar el teléfono exclusivamente mediante `PhoneField`.

**RTEL.3.3** La pantalla de edición de perfil (`mas.tsx`, `ProfileEditForm`, baseline `R2.1`) deberá capturar el teléfono exclusivamente mediante `PhoneField`.

**RTEL.3.4** Ninguna pantalla deberá renderizar un input de teléfono con un `FormField` directo (la paridad se garantiza por construcción: un solo componente, no dos configuraciones que puedan divergir).

**RTEL.3.5** El input de teléfono deberá usar `keyboardType="phone-pad"`, `autoComplete="tel"` y `textContentType="telephoneNumber"` en ambas pantallas (D1, sin regresión sobre el as-built).

**RTEL.3.6** El sistema no deberá permitir que se tipeen letras en un input de teléfono en ninguna de las dos pantallas (cierra el bug reportado: hoy `crear-campo.tsx:157` pasa `setPhone` crudo).

**RTEL.3.7** El sistema no deberá permitir que un input de teléfono acepte texto ilimitado en ninguna de las dos pantallas (cierra el bug reportado: hoy `crear-campo.tsx:154-163` no declara `maxLength`).

**RTEL.3.8** El sistema no deberá agregar la prop `inputMode` al contrato público de `FormField` (C5: `keyboardType` ya es la prop canónica; una segunda prop solapada reintroduce el riesgo de divergencia que este delta cierra).

> **Reconciliación as-built (implementer, 2026-07-18).** `RTEL.3.8` se cumple: **`inputMode` no se
> agregó** y `keyboardType` sigue siendo la única prop de teclado. Lo que **sí** cambió respecto del
> design original —que afirmaba "sin tocar el contrato de `FormField`"— es que el contrato creció en una
> prop **aditiva y de layout**, `hideLabel?: boolean` (default `false` ⇒ cero cambio para los ~40 callers
> previos), más el export de `FieldLabel`. Motivo en `RTEL.4.1` nota (a). **No reabre el riesgo que C5
> cierra**: ese riesgo era el de *dos props solapadas de teclado* que dos pantallas podrían configurar
> distinto; `hideLabel` no solapa a ninguna, no tiene nada que ver con la entrada de datos, y el label
> se comparte por **construcción** (`FieldLabel` es una sola definición usada por `FormField` y por
> `PhoneField`, no una copia). La paridad de `RTEL.3.1`/`RTEL.3.4` sigue garantizada por el componente
> único y su guard (`RTEL.3.9`), que no se toca.

**RTEL.3.9** El sistema deberá hacer cumplir `RTEL.3.4` con un **guard automatizado** que falle la verificación del repo si algún archivo de `app/app/` o `app/src/components/`, distinto de `PhoneField.tsx`, contiene la firma de un input de teléfono construido a mano (`keyboardType` en `phone-pad`, `autoComplete` en `tel` o `textContentType` en `telephoneNumber`).

> **Por qué.** `RTEL.3.4` tal como estaba era prosa sin diente: nada impedía que dentro de seis meses una tercera pantalla agregara un `FormField` con `keyboardType="phone-pad"` y reintrodujera exactamente la divergencia que este delta cierra — el mismo bug, en un archivo nuevo. La firma es greppable, así que el guard es barato y determinista. Diseño en `design-telefono.md` §7bis; el repo ya tiene el precedente de `scripts/check-hardcode.mjs` (ADR-023 §4), incluida su válvula de escape por línea justificada.

**RTEL.3.10** El guard de `RTEL.3.9` deberá permitir una excepción explícita por línea, acompañada de una justificación escrita, para no volverse un bloqueo dogmático ante un caso legítimo futuro (mismo patrón que `design-lint-disable-next-line -- <razón>` de `check-hardcode.mjs`).

### RTEL.4 — Máscara y comportamiento de entrada (C6, C7 / DP1)

**RTEL.4.1** Mientras el input esté en modo argentino, el sistema deberá mostrar el prefijo `+54` como adorno visual fijo y no deberá incluirlo entre los caracteres editables por el usuario (D2).

> **Reconciliación as-built (implementer, 2026-07-18) — veto de diseño del leader sobre las capturas del
> Gate 2.5.** `RTEL.4.1` se cumple tal como está escrito; lo que se corrigió son dos **defectos de
> presentación** que el adorno `+54` introdujo y que la spec no había previsto. Se anotan acá porque los
> dos son consecuencia directa de este requirement.
>
> **(a) El label pasa a etiquetar el GRUPO (adorno + input), no el input solo.** El adorno es un hermano
> de layout a la izquierda, así que el label dibujado dentro de la columna del input quedaba **sangrado**
> el ancho del chip: en el perfil, `Nombre` arrancaba en x=37 y `Teléfono` en x=112 (75px de dentado en
> la columna de labels), y el label **saltaba ~76px** al entrar en modo internacional (`RTEL.4.7`),
> cuando el chip desaparece. Es la clase de bug de **ADR-027** (decoración lateral que corre el layout
> de algo que debería estar anclado; regla 2: el estado de la decoración no recorre el layout). As-built,
> el label lo dibuja `PhoneField` a nivel de grupo y el interno de `FormField` se apaga con la prop
> aditiva `hideLabel` — el `label` sigue siendo el **nombre accesible** del input (`aria-label` /
> `accessibilityLabel`), así que `getByLabel('Teléfono')` y los lectores de pantalla no cambian.
> **Verificado midiendo las capturas**: `Nombre` x=37 vs `Teléfono` x=36 (1px de *side bearing* de la
> `N` vs la `T`, idéntico en el display de solo lectura que nunca tuvo chip), y el bbox del label es
> **exactamente el mismo** —(18,207)-(71,216)— en modo AR, en modo internacional y en estado de error.
>
> **(b) El placeholder deja de leerse como un valor ya cargado.** Ocupaba la misma posición que un valor
> real y solo se distinguía por color, con el agravante de que estaba en `$textMuted` (6.03:1 contra el
> blanco del input: anormalmente oscuro para un placeholder, apenas 3.2× de separación contra un valor
> real en `$textPrimary`). En el gate de `R3.8` —que **bloquea** la creación del campo— eso se lee como
> "ya está cargado": el usuario toca Continuar y se come el error de `RTEL.5.3`. As-built: el copy
> recupera el prefijo **`Ej. `** que el as-built previo a `PhoneField` ya tenía en las dos pantallas y
> que el componente había perdido al unificarlas (`Ej. 11 2345-6789` / `Ej. +34 600 123 456`), y el
> color del placeholder de `FormField` pasa de `$textMuted` a `$textFaint` (4.24:1 medido → la
> separación contra un valor real sube a 4.6×). No hay token de placeholder dedicado en el design
> system; la elección y su costo de accesibilidad quedan anotados en `FormField.tsx` y en
> `design-telefono.md` §9bis punto 7.

**RTEL.4.2** Mientras el input esté en modo argentino, el sistema deberá aceptar como máximo **12** dígitos
tipeables. La **validación no cambia**: sigue siendo de exactamente 10 dígitos (`RTEL.5.1`), de modo que 11
y 12 son estados **transitorios** — nunca `valid`, nunca persistidos.

> **Decisión de Raf (Puerta 1 ampliada, 2026-07-18) — el tope sube de 10 a 12.** El implementer detectó
> en su autorrevisión que con el tope en 10 quien **tipea** su celular con el `15` se queda en
> `11 1523-4567` —10 dígitos, formalmente válidos— y el sistema lo acepta **sin avisar**, persistiendo un
> número equivocado. La ayuda de DP4 (`RTEL.6.6`–`RTEL.6.8`) necesita ver 12 dígitos, así que solo se
> disparaba al **pegar** o autocompletar: **DP4 no cubría el caso más común, que es tipear en la manga**,
> justo aquello para lo que Raf la aprobó.
>
> Al subir el tope a 12, DP4 se dispara también al tipear y sugiere sacar el `15`. El número con `15`
> queda **inválido** hasta que el usuario acepta la sugerencia → nunca se guarda mal en silencio.
> El requirement se relajó **solo en el buffer de tipeo**; la validación y el canónico no se tocaron.
>
> El implementer NO lo cambió por su cuenta (habría contradicho un requirement aprobado y su test) y lo
> escaló — comportamiento correcto. `T16(b)` se actualiza en consecuencia.

**RTEL.4.3** Mientras el usuario tipea en modo argentino, el sistema deberá renderizar los dígitos agrupados según el largo del código de área: `AA NNNN-NNNN` para códigos de 2 dígitos, `AAA NNN-NNNN` para 3 dígitos y `AAAA NN-NNNN` para 4 dígitos (DP1).

**RTEL.4.4** El sistema no deberá emitir un separador de la máscara antes de que exista un dígito que lo siga (evita el loop "backspace borra el separador → la máscara lo re-agrega"), y por lo tanto un backspace deberá remover siempre un dígito y nunca solo un separador.

**RTEL.4.5** Cuando el usuario pega un texto en el input de teléfono, el sistema deberá aplicarle las reglas de normalización `RTEL.2.2`–`RTEL.2.7`; si el resultado es "no normalizable", deberá conservar los dígitos pegados y mostrar el error inline de `RTEL.6`, y no deberá truncarlos en silencio.

**RTEL.4.6** El sistema no deberá usar la tabla de códigos de área para validar ni para almacenar: una entrada faltante o incorrecta solo deberá alterar la agrupación visual, nunca el resultado de la validación ni el valor persistido (DP1).

**RTEL.4.7** Cuando el usuario ingresa un `+` como primer carácter, el sistema deberá pasar el input a modo internacional: deberá ocultar el adorno `+54`, deberá aceptar de 8 a 15 dígitos y no deberá aplicar la máscara argentina (D3).

**RTEL.4.8** Cuando el usuario vacía el input estando en modo internacional, el sistema deberá volver al modo argentino.

**RTEL.4.9** El sistema deberá acotar el buffer de texto tipeable del input a `PHONE_MAX_LENGTH` (20) caracteres en ambas pantallas (C4: cota del buffer de display; el techo que gobierna lo persistido es el de `RTEL.1.5`).

### RTEL.5 — Validación de cliente (D2, D3)

**RTEL.5.1** Mientras el input esté en modo argentino, el sistema deberá considerar válido el teléfono si y solo si tiene exactamente 10 dígitos.

**RTEL.5.2** Mientras el input esté en modo internacional, el sistema deberá considerar válido el teléfono si y solo si tiene entre 8 y 15 dígitos y su primer dígito no es `0` (alineado con `RTEL.1.1`/`RTEL.7.1` — MEDIUM-1).

**RTEL.5.3** Cuando el usuario intenta crear un establecimiento (baseline `R3.8`), el sistema no deberá aceptar un teléfono vacío ni inválido según `RTEL.5.1`/`RTEL.5.2`.

**RTEL.5.4** Cuando el usuario guarda su perfil (baseline `R2.1`) con el teléfono vacío, el sistema deberá aceptarlo y deberá persistir `null` (el teléfono es opcional en el perfil; sin regresión sobre `validateProfile`).

**RTEL.5.5** Cuando el usuario guarda su perfil con un teléfono no vacío, el sistema no deberá aceptarlo si es inválido según `RTEL.5.1`/`RTEL.5.2`.

**RTEL.5.6** El sistema deberá tratar la validación de cliente como asistencia de UX y no como control de seguridad: la validación autoritativa es la de `RTEL.7` (Gate 1 §1).

### RTEL.6 — Estados de error (C8)

**RTEL.6.1** Cuando la validación del teléfono falla, el sistema deberá mostrar el borde del input en `$terracota` y un mensaje de error inline debajo del input.

**RTEL.6.2** Cuando la validación del teléfono falla en un formulario scrolleable, el sistema deberá desplazar la vista hasta dejar el input de teléfono visible antes de que el usuario tenga que buscarlo.

**RTEL.6.3** El sistema no deberá mostrar el error de validación del teléfono como banner global por encima del contenido ni de forma que tape el título de la pantalla.

**RTEL.6.4** Cuando el valor ingresado tiene entre 11 y 12 dígitos y no encaja en ninguna regla de normalización, el sistema deberá mostrar un mensaje que enseñe el formato esperado, indicando que se ingresen los 10 dígitos sin el `0` y sin el `15` (C6).

**RTEL.6.5** El sistema deberá mostrar los errores de **validación de campo** en el propio input y los errores de **guardado o de red** en un mensaje de formulario ubicado debajo de los campos, en ambas pantallas (paridad: hoy `CompletePhoneScreen` mezcla ambos en el mismo prop del campo, `crear-campo.tsx:162`).

**RTEL.6.6** *(DP4 aprobada)* Cuando el valor ingresado tiene 12 dígitos y contiene `15` en la posición inmediatamente posterior al código de área (según la tabla de `RTEL.4.3`), el sistema deberá mostrar un mensaje de error específico que indique remover el `15`, en lugar del mensaje genérico de `RTEL.6.4`.

**RTEL.6.7** *(DP4 aprobada)* Cuando se detecta el patrón de `RTEL.6.6`, el sistema deberá ofrecer el número de 10 dígitos resultante como **sugerencia confirmable**, mostrándolo formateado según `RTEL.4.3`, y deberá aplicarlo únicamente tras una acción explícita del usuario.

**RTEL.6.8** *(DP4 aprobada)* El sistema no deberá usar la detección del `15` para modificar el valor sin confirmación del usuario: la tabla de códigos de área deberá seguir sin participar de ningún camino de normalización ni de escritura automática (preserva `RTEL.4.6` y la justificación de `RTEL.2.8`).

**RTEL.6.9** *(DP4 aprobada)* Cuando el usuario acepta la sugerencia de `RTEL.6.7`, el sistema deberá tratar el valor resultante como una entrada más: deberá pasarlo por `normalizePhone` y por la re-normalización del service, y no deberá persistirlo por una vía que saltee esas capas ni el CHECK de `RTEL.7.1`.

### RTEL.7 — Validación autoritativa server-side y migración (C3, D6, DP3)

**RTEL.7.1** El sistema deberá imponer sobre `public.user_private.phone` un CHECK constraint `user_private_phone_format_chk` que acepte únicamente `null` o un valor que satisfaga la expresión `^\+[1-9][0-9]{7,14}$`.

**RTEL.7.2** La migración `0126` deberá agregar ese constraint como `NOT VALID` y ejecutar `validate constraint` recién después del backfill de `RTEL.7.3`, dentro de la misma transacción.

**RTEL.7.3** La migración `0126` deberá normalizar los valores existentes de `public.user_private.phone` aplicando en SQL las mismas reglas N1–N6 de `RTEL.2`.

**RTEL.7.4** Si tras el backfill queda al menos una fila cuyo `phone` no es `null` y no satisface `RTEL.7.1`, entonces la migración `0126` deberá abortar con una excepción que indique la cantidad de filas afectadas **y la query de reconciliación exacta a ejecutar**, devolviendo dicha query **solo `user_id`** (identificador opaco) y nunca la columna `phone` (MEDIUM-2, DP3).

> **MEDIUM-2 (Gate 1).** La redacción anterior decía "reconciliar a mano (no se listan por ser PII)": correcto en no listar valores, pero dejaba al operador sin el paso siguiente — una instrucción sin herramienta. El `user_id` es un UUID opaco, no PII de contacto, así que puede viajar en el mensaje de error sin abrir el leak que `RTEL.7.5` cierra.

**RTEL.7.5** Ningún mensaje **emitido por esta migración** (`raise notice` / `raise exception` de `0126`) deberá incluir un valor de teléfono ni de email: solo conteos e identificadores opacos (patrón `0068:83-86`).

> **Corrección de alcance (HIGH-1, Gate 1).** La redacción anterior — "PII fuera de logs" a secas — **sobre-afirmaba**. Es cierta para los `raise` de la migración, pero no cubre el leak principal que este delta introduce: el **rechazo del CHECK en runtime**, donde Postgres emite `DETAIL: Failing row contains (...)` con todas las columnas sobre las que el rol tiene `SELECT` — y `authenticated` tiene `grant select` sobre `user_private` (`0068:200`) → **email y teléfono en claro** en el log del servidor, con su retención y sus drains, sobreviviendo a `delete_account`. Ese leak **no** lo cierra este requirement; se acepta como riesgo residual documentado (`R-7`, design §8) por decisión del leader, y se mitiga indirectamente cerrando MEDIUM-1 (que vuelve el rechazo prácticamente inalcanzable en operación normal).

**RTEL.7.6** La migración `0126` no deberá modificar policies de RLS, grants, streams de PowerSync, triggers ni el tipo de la columna `phone` (sigue `text` nullable).

**RTEL.7.7** La migración `0126` no deberá eliminar ni modificar el constraint `user_private_phone_len_chk` de `0070` (C4: el CHECK de formato ya es estrictamente más fuerte; el cap de 32 queda como cota externa de defensa en profundidad).

**RTEL.7.8** La migración `0126` deberá ejecutarse de forma atómica: si cualquiera de sus pasos falla, no deberá dejar el constraint agregado ni filas parcialmente normalizadas.

### RTEL.8 — Escritura desde los services (C1)

**RTEL.8.1** Cuando `saveOwnPhone` persiste el teléfono, el sistema deberá enviar el valor canónico de `RTEL.1` y no deberá enviar el texto tal como fue tipeado.

**RTEL.8.2** Cuando `saveProfile` persiste el teléfono, el sistema deberá enviar el valor canónico de `RTEL.1`, o `null` si el campo quedó vacío.

**RTEL.8.3** Si el servidor rechaza la escritura del teléfono por violación del CHECK de formato (`23514`), entonces el sistema deberá mostrar un mensaje accionable sobre el formato del teléfono y no deberá mostrarlo como error genérico ni como error de red.

> **Reconciliación as-built (implementer, 2026-07-18).** `RTEL.8.3` se cumple, con una precisión sobre el
> mecanismo: la clasificación devuelve un `kind` propio (`'phone_format'`) además del copy fijo, y cada
> pantalla lo muestra **sobre el campo de teléfono** (no en el mensaje de formulario), porque lo que está
> mal es el número y no el guardado — coherente con `RTEL.6.5`. Con el `kind: 'unknown'` que proponía el
> design, la UI no podía distinguir este rechazo de un error genérico y habría tenido que elegir entre
> mostrar siempre el mensaje CRUDO de Postgres o no mostrar nunca el copy accionable. `RTEL.8.5`/`RTEL.8.6`
> quedan intactos y verificados: el copy es fijo, la firma no se amplió, y `details`/`hint`/mensaje crudo
> no se propagan. Detalle en `design-telefono.md` §9bis punto 5.

**RTEL.8.4** El sistema deberá mantener la escritura del teléfono como operación online-only (sin regresión sobre el `assertOnline` de `establishments.ts:195,283` y el baseline `R9.2`).

**RTEL.8.5** *(bloqueante para T10 — HIGH-1)* Cuando el servidor rechaza la escritura con `23514`, el sistema deberá devolver a la UI **únicamente un copy fijo** sobre el formato del teléfono, y **no deberá** propagar `error.details`, `error.hint` ni el `error.message` crudo de Postgres a la UI, al copy mostrado ni a ningún log del cliente.

**RTEL.8.6** *(bloqueante para T10 — HIGH-1)* La firma de `classifyError` no deberá ampliarse para consumir `details` ni `hint`.

> **Por qué esto tiene que estar escrito.** Hoy la garantía existe **por accidente de firma**: `classifyError(error: { message?: string; code?: string } | null)` (`establishments.ts:48-58`) solo consume `message` y `code`, así que `details` —donde vive el `Failing row contains (...)` con email y teléfono en claro— nunca llega a la UI. Pero **T10 modifica exactamente esa función** para agregar la rama de `23514`; ampliar la firma "para dar mejor diagnóstico" sería el cambio más natural del mundo y traería la PII al cliente. Sin requirement explícito, la protección no sobrevive al primer refactor. Nótese además que hoy la rama genérica devuelve `message: msg` (el texto crudo de Postgres): la rama de `23514` **no** debe seguir ese patrón.

### RTEL.9 — Fixtures y suites existentes (hallazgo del `spec_author`)

**RTEL.9.1** El helper `setUserPhone` (`app/e2e/helpers/admin.ts:85`) deberá normalizar el valor recibido al canónico de `RTEL.1` antes de escribirlo, de modo que los aproximadamente 30 call sites que hoy pasan `'1123456789'` sigan funcionando sin modificarse.

**RTEL.9.2** La suite E2E no deberá quedar en rojo por el CHECK de `RTEL.7.1` (sin la normalización de `RTEL.9.1`, cada seed de teléfono fallaría con `23514`).

**RTEL.9.3** La suite `supabase/tests/user_private/run.cjs` no deberá requerir cambios en sus valores de fixture (`'+541112345678'`, `'+541199999999'`, `'+540000000000'` ya satisfacen `RTEL.7.1`).

### RTEL.10 — Display de solo lectura

**RTEL.10.1** Cuando la pantalla "Más" muestra el teléfono guardado en modo lectura (`mas.tsx:308`), el sistema deberá renderizarlo con el formato de display de `RTEL.4.3` y no deberá mostrar el valor canónico crudo.

**RTEL.10.2** Cuando el usuario no tiene teléfono cargado, el sistema deberá seguir mostrando "Sin teléfono" (sin regresión).

### RTEL.11 — Seguridad y no-regresión (Gate 1)

**RTEL.11.1** El delta no deberá debilitar el aislamiento de la PII de contacto: `public.user_private` deberá seguir siendo self-only vía `user_private_select_self` / `user_private_update_self` (`0068:105-114`), sin exposición de teléfonos de terceros.

**RTEL.11.2** El CHECK de `RTEL.7.1` deberá garantizar que ningún valor persistido de `phone` contenga saltos de línea, retornos de carro, tabuladores, comillas, caracteres de control ni dígitos no ASCII, de modo que ningún consumidor downstream pueda recibir un teléfono con payload de inyección.

> **Verificado empíricamente (2ª pasada), no supuesto.** El claim depende de la semántica de `^`/`$` del operador `~` de Postgres y **no** era seguro asumirlo: en PCRE (Perl, JS) `$` **sí** matchea antes de un `\n` final, con lo que `'+541123456789\n'` pasaría el CHECK en un motor tipo PCRE. Postgres usa POSIX ARE y, sin el flag de *newline-sensitive matching*, `$` ancla **solo** al fin de string.
>
> Ejecutado como `SELECT` de solo lectura contra el Postgres remoto del proyecto (sin DDL ni DML), con el regex exacto `^\+[1-9][0-9]{7,14}$`:
>
> | Entrada | Resultado |
> |---|---|
> | `+541123456789` (canónico) | **MATCH** ✅ |
> | 8 dígitos / 15 dígitos (bordes) | **MATCH** ✅ |
> | 7 dígitos / 16 dígitos | no-match ✅ |
> | `+541123456789` + `chr(10)` (newline final) | **no-match** ✅ ← el caso crítico |
> | `chr(10)` + `+541123456789` | no-match ✅ |
> | newline en el medio | no-match ✅ |
> | `+541123456789` + `chr(13)` (CR) | no-match ✅ |
> | `+541123456789` + `chr(9)` (tab) | no-match ✅ |
> | `+54 1123456789` (espacio) | no-match ✅ |
> | `+541123456789'` (comilla simple) | no-match ✅ |
> | `+54112345678<script>` | no-match ✅ |
> | `+0411234567` (código de país con `0`) | no-match ✅ |
> | `541123456789` (sin `+`) | no-match ✅ |
> | `+54` + dígitos arábigo-índicos (`٠١٢…`) | no-match ✅ ← `[0-9]` es ASCII-only |
>
> **Hallazgo adicional:** el caso `chr(0)` (NUL) no llega siquiera a evaluarse — Postgres rechaza el valor antes, a nivel de tipo, con `54000: null character not permitted`. Ese vector lo cierra el tipo `text`, no el CHECK.

**RTEL.11.2.1** El delta deberá dejar la verificación de `RTEL.11.2` cubierta por test automatizado y no como afirmación de la spec (`RTEL.14.6`), de modo que una futura reescritura del regex no pueda debilitar la garantía en silencio.

**RTEL.11.3** El delta no deberá introducir una vía por la que un usuario pueda escribir el `phone` de otro usuario (el único write sigue siendo el `UPDATE` sobre la fila propia, gateado por RLS).

**RTEL.11.4** El delta no deberá romper el trigger `propagate_confirmed_email` (`0068:169-194`): tras la migración, todo `UPDATE` sobre `user_private` de una fila existente deberá seguir satisfaciendo `RTEL.7.1` (garantizado por residuo cero, DP3).

**RTEL.11.5** El delta no deberá alterar el comportamiento de `members.ts`, que nunca expone `phone` ni `email` de otros usuarios (hallazgo RLS #2, sin regresión).

**RTEL.11.6** El delta no deberá cambiar el momento en que se pide el teléfono: sigue sin pedirse en signup y sigue siendo obligatorio al crear establecimiento (baseline `R1.1` y `R3.8` intactos).

**RTEL.11.7** *(MEDIUM-3)* Mientras el formato canónico descarte el bit móvil/fijo (el `9` de `RTEL.1.3`/`RTEL.1.4`), el sistema **no deberá** usar `user_private.phone` como clave de identidad, como criterio de deduplicación de cuentas, como vía de recuperación de acceso, ni como criterio de matching de invitaciones. Cualquier feature que requiera alguno de esos usos deberá introducir antes el discriminante `phone_kind` (o equivalente).

> **MEDIUM-3 (Gate 1).** El canónico `+54` + 10 dígitos **colapsa** un móvil y un fijo que compartan el mismo número nacional en el mismo string (`+5491123456789` y `+541123456789` → ambos `+541123456789`). Hoy no hay riesgo explotable —verificado por el gate: `[auth.sms]` deshabilitado, sin índice único sobre `phone`, sin lookup por teléfono en ningún flujo—, pero la spec **vendía el dedup como "exacto"** (corregido en `context-telefono.md` C1 y en design §7/A1). Este requirement convierte esa propiedad en una restricción escrita, para que una feature futura no herede el supuesto equivocado en silencio.

**RTEL.11.8** *(MEDIUM-3)* El delta no deberá crear un índice único, una constraint de unicidad ni una policy que dependa de `user_private.phone`.

### RTEL.12 — Capture del Gate 2.5

**RTEL.12.1** El delta deberá incluir un capture file `app/e2e/captures/telefono.capture.ts` que capture: (a) el gate de teléfono de `crear-campo` con la máscara en vivo y el adorno `+54`; (b) el mismo gate en estado de error, con borde `$terracota` y error inline; (c) el input de teléfono del perfil en "Más" mostrando el mismo componente y comportamiento; (d) el display de solo lectura del teléfono ya guardado.

**RTEL.12.2** El capture deberá incluir al menos un número con código de área de 4 dígitos (por ejemplo `2241`, Chascomús) para vetar visualmente la agrupación de DP1.

### RTEL.13 — Documentación

**RTEL.13.1** El delta deberá agregar en `docs/conventions.md`, en la sección "Formato de datos para el usuario (es-AR)", una nota explícita de que la regla de coma decimal y punto de miles **no** aplica al teléfono, indicando su formato de display y su formato canónico de almacenamiento (C9).

### RTEL.14 — Tests

**RTEL.14.1** El delta deberá cubrir con tests unitarios puros (`node:test`, junto a `validation.test.ts`) las reglas de normalización N1–N6, incluyendo el caso del `9` removido (`RTEL.2.6`) y el del `15` no removido (`RTEL.2.8`).

**RTEL.14.2** El delta deberá cubrir con tests unitarios puros la máscara: agrupación para códigos de área de 2, 3 y 4 dígitos (`RTEL.4.3`), ausencia de separador colgante y borrado por backspace (`RTEL.4.4`).

**RTEL.14.3** El delta deberá cubrir con test E2E que en la pantalla de gate de teléfono de `crear-campo` no se pueden tipear letras ni superar el tope de dígitos (`RTEL.3.6`, `RTEL.3.7` — el bug reportado).

**RTEL.14.4** El delta deberá cubrir con test backend, en `supabase/tests/user_private/run.cjs`, que un `UPDATE` de `phone` con formato no canónico es rechazado por `user_private_phone_format_chk` y que uno canónico es aceptado (`RTEL.7.1`).

**RTEL.14.5** El delta deberá cubrir con test backend que un `UPDATE` de `email` sobre una fila con `phone` canónico no es rechazado por el CHECK de formato (`RTEL.11.4`).

**RTEL.14.6** El delta deberá cubrir con test backend, en `supabase/tests/user_private/run.cjs`, que el CHECK rechaza los vectores de `RTEL.11.2`: `phone` con newline al final, al inicio y en el medio; con CR; con tab; con espacio; con comilla simple; con marcado HTML; con dígitos no ASCII; y con código de país que empieza en `0`. El caso del newline **al final** deberá estar presente de forma explícita, por ser el que distingue la semántica POSIX de Postgres de la semántica PCRE.

**RTEL.14.7** El delta deberá cubrir el guard de `RTEL.3.9` con un test que falle cuando un archivo de `app/app/` o `app/src/components/` distinto de `PhoneField.tsx` presenta la firma de input de teléfono, y que pase con el árbol de archivos vigente.

**RTEL.14.8** *(MEDIUM-1)* El delta deberá cubrir con test unitario que un valor con primer dígito `0` tras el `+` (ej. `+0123456789`) es rechazado por el cliente y **nunca** se envía al servidor, garantizando que cliente y CHECK coinciden en el borde.

**RTEL.14.9** *(HIGH-1 / MEDIUM-A)* El delta deberá cubrir con test **unitario ejecutable** que, ante un error `23514` que incluya `details` y `hint` con contenido de PII simulado, la clasificación devuelve el copy fijo de formato y **no** expone `details`, `hint` ni el mensaje crudo de Postgres (`RTEL.8.5`). El test deberá vivir en un archivo propio y estar **registrado en `scripts/run-tests.mjs`**.

**RTEL.14.9.1** *(MEDIUM-A)* Para que `RTEL.14.9` sea ejecutable, la función de clasificación de errores deberá ser **importable desde un módulo puro** (extraída de `establishments.ts:48-58` a su propio módulo, o exportada), sin arrastrar el cliente de Supabase ni PowerSync a la suite unitaria.

> **MEDIUM-A (Gate 1) — el mismo defecto que `RTEL.3.4`, sobre un riesgo mayor.** `RTEL.14.9` existía como requirement pero no tenía archivo en design §2, ni fila en la tabla requirement→test de §9, ni registro en `run-tests.mjs` (que es lista **explícita**, no glob) → **nunca habría corrido**. Y `classifyError` no está exportada, así que ni siquiera era testeable como estaba. Eso dejaba la aceptación de `R-7` apoyada solo en una nota bloqueante en T10 más el criterio del reviewer. Precedente en el repo para la extracción pura: `app/src/services/powersync/upload-classify.test.ts`.

**RTEL.14.10** *(L-2)* El delta deberá cubrir con test que `PhoneField` emite el cambio al pasar de `valid` a `incomplete` y de `valid` a `empty`, y que el caller no conserva el `canonical` anterior tras esas transiciones (`RTEL.3.1.2`).

**RTEL.14.11** *(MEDIUM-B)* El delta deberá cubrir la tabla compartida de vectores de `RTEL.2.9.1` desde las dos suites (`phone.test.ts` y `supabase/tests/user_private/run.cjs`), fallando si algún vector diverge entre el encoding TypeScript y el CHECK.

**RTEL.14.12** *(DP4 aprobada)* El delta deberá cubrir con test unitario la detección del `15` para códigos de área de **2, 3 y 4 dígitos** (la sugerencia se calcula distinto según el largo del área), y que un valor de 12 dígitos **sin** `15` en esa posición **no** produce sugerencia (cae al mensaje genérico de `RTEL.6.4`).

**RTEL.14.13** *(DP4 aprobada — invariante de seguridad)* El delta deberá cubrir con test que `normalizePhone` produce el mismo resultado con y sin la detección del `15` disponible, evidenciando que `detectArTrunkPrefix` no participa de la normalización (`RTEL.6.8`), y que el valor aceptado desde la sugerencia atraviesa `normalizePhone` antes de persistirse (`RTEL.6.9`).

---

## Trazabilidad: `context-telefono.md` → requirements

| Caso / decisión del contexto | Requirement(s) |
|---|---|
| D1 — teclado numérico `phone-pad` | RTEL.3.5 |
| D2 — `+54` fijo, 10 dígitos, máscara en vivo | RTEL.4.1–RTEL.4.3, RTEL.5.1 |
| D3 — escape internacional con `+` | RTEL.4.7, RTEL.4.8, RTEL.5.2 |
| D4 — sin `libphonenumber` | RTEL.2.8, RTEL.4.6 (tabla acotada y solo cosmética) |
| D5 — paridad vía componente compartido | RTEL.3.1–RTEL.3.4, RTEL.3.6, RTEL.3.7 |
| DP4 — ayuda ante el `15` (✅ aprobada, opción D) | RTEL.6.6, RTEL.6.7, RTEL.6.8, RTEL.6.9, RTEL.14.12, RTEL.14.13 |
| Guard de la paridad a futuro | RTEL.3.9, RTEL.3.10, RTEL.14.7 |
| D6 — validación server-side real | RTEL.7.1, RTEL.5.6 |
| C1 — formato de almacenamiento | RTEL.1.1–RTEL.1.5, RTEL.8.1, RTEL.8.2 |
| C2 — migración de datos existentes | RTEL.2.*, RTEL.7.3, RTEL.7.4 |
| C3 — el CHECK server-side | RTEL.7.1, RTEL.7.2, RTEL.7.8 |
| C4 — alineación de techos | RTEL.1.5, RTEL.4.9, RTEL.7.7 |
| C5 — `inputMode` en `FormField` | RTEL.3.8 |
| C6 — UX de máscara (tipeo/borrado/pegado/cursor) | RTEL.4.4, RTEL.4.5, RTEL.6.4 |
| C7 / DP1 — agrupación por código de área | RTEL.4.3, RTEL.4.6, RTEL.12.2 |
| C8 — estados de error | RTEL.6.1–RTEL.6.5 |
| C9 — el teléfono es un caso aparte del formato es-AR | RTEL.13.1 |
| Hallazgo `setUserPhone` (rompe E2E) | RTEL.9.1–RTEL.9.3 |
| Gate 1 (schema + PII) | RTEL.7.5, RTEL.7.6, RTEL.11.1–RTEL.11.6 |
| Gate 2.5 (capture) | RTEL.12.1, RTEL.12.2 |
| Tests | RTEL.14.1–RTEL.14.5 |

## Trazabilidad: requirement → test

Cada `RTEL.<n>` mapea a ≥1 test. El implementer documenta el mapa `RTEL.<n> → archivo:test` en `progress/impl_telefono.md`; el reviewer lo verifica.

---

## Historial de refinamiento

- **2026-07-18 — Redacción inicial del delta.** Origen: bug de divergencia entre los dos inputs de teléfono reportado por Raf. Gate 0 cerrado por el leader (D1–D6); C1–C9 resueltos por el `spec_author` bajo delegación explícita. Flags para Puerta 1: **DP1** (agrupación por código de área — override de la letra de D2, motivado por Chascomús/2241), **DP2** (se saca el `9` provisto por el usuario, para unicidad exacta del dedup), **DP3** (la migración aborta ante residuo en lugar de grandfatherear, por el hazard del CHECK re-evaluado en `UPDATE` no relacionado sobre `propagate_confirmed_email`).
- **2026-07-18 — Hallazgo no relevado en el brief del leader.** `setUserPhone` (`app/e2e/helpers/admin.ts:85`) siembra `'1123456789'` crudo desde ~30 call sites: con el CHECK activo, la suite E2E entera se pondría roja. Cubierto por `RTEL.9.*` con fix en un solo lugar.

- **2026-07-18 — 2ª pasada: tres objeciones del leader, reconciliadas.**
  1. **Justificación falsa en `RTEL.2.8` — corregida.** El leader detectó que DP1 introduce la tabla de códigos de área que `RTEL.2.8` invocaba como imposible de tener; el argumento original ("no se puede localizar el `15`") quedó falso al escribirse DP1. Se reemplazó por la razón real: usar la tabla para normalizar rompería la propiedad de seguridad de `RTEL.4.6` y convertiría un error cosmético en corrupción silenciosa. La conclusión (no se remueve el `15`) no cambia; el fundamento sí. Se agregó **DP4** como decisión abierta sobre cuánta ayuda dar en el estado de error, con recomendación (opción D: sugerencia confirmable) y sin cerrarla por cuenta propia.
  2. **`RTEL.11.2` — verificado, ya no es supuesto.** Se ejecutó un `SELECT` de solo lectura contra el Postgres remoto (sin DDL/DML) con el regex exacto. Confirmado que `'+541123456789' || chr(10)` **no** matchea (semántica POSIX de Postgres; en PCRE sí matchearía — el claim no era trivial). Tabla completa de 14 vectores bajo `RTEL.11.2`, y hallazgo extra: `chr(0)` lo rechaza el tipo `text` antes del CHECK (`54000`). Fijado como test obligatorio en `RTEL.14.6`.
  3. **`RTEL.3.4` — con diente.** Era prosa inaplicable. Se agregaron `RTEL.3.9` (guard automatizado sobre la firma greppable del input de teléfono, modelado en `scripts/check-hardcode.mjs`), `RTEL.3.10` (válvula de escape por línea justificada) y `RTEL.14.7` (test del guard).

- **2026-07-18 — 3ª pasada: Gate 1 `NEEDS_CLARIFICATION` (1 HIGH + 4 MEDIUM), reconciliado.** El gate confirmó DP3, la hermeticidad del CHECK (incluida la tabla de vectores) y el hallazgo de `setUserPhone`.
  - **HIGH-1 — "PII fuera de logs" sobre-afirmado.** El leak real que introduce el delta no son los `raise` de la migración sino el **`DETAIL: Failing row contains (...)`** del rechazo del CHECK en runtime, que incluye email y teléfono en claro porque `authenticated` tiene `grant select` sobre `user_private` (`0068:200`). Alcance de `RTEL.7.5` corregido a "ningún mensaje emitido por esta migración"; el leak se acepta como **riesgo residual `R-7`** (decisión del leader: es self-scoped por RLS, la audiencia ya tiene acceso a la DB, y cerrar MEDIUM-1 lo vuelve prácticamente inalcanzable). Se agregaron `RTEL.8.5`/`RTEL.8.6` como **bloqueantes de T10**: la rama de `23514` no propaga `details`/`hint`/mensaje crudo y la firma de `classifyError` no se amplía — hoy se cumple solo por accidente de firma y T10 modifica esa función.
  - **MEDIUM-1 — contradicción cliente/server.** El CHECK exigía primer dígito ≠ `0` y el cliente no: `+0123456789` pasaba validación y explotaba con `23514`. Corregido en `RTEL.1.1`, `RTEL.2.2`, `RTEL.5.2`, design §3.2, la rama intl de la migración y `RTEL.14.8`. Es además la mitigación indirecta de HIGH-1.
  - **MEDIUM-2 — abort no accionable.** `RTEL.7.4` ahora exige que la excepción incluya la query de reconciliación, devolviendo **solo `user_id`** (opaco), nunca `phone`.
  - **MEDIUM-3 — identidad.** Nuevos `RTEL.11.7`/`RTEL.11.8`: el `phone` no se usa como clave de identidad, dedup de cuentas, recuperación de acceso ni matching de invitación mientras el canónico descarte el bit móvil/fijo. Corregida la afirmación de "dedup exacto" en `context` C1 y design §7/A1.
  - **MEDIUM-4 — contrato ambiguo de `PhoneField`.** `onChangeValue: (canonicalOrRaw: string)` contradecía la garantía "por construcción". Nuevo `RTEL.3.1.1`: tipo de **tres estados** (vacío / incompleto / válido), preferido sobre `string | null` porque este último conflaciona vacío con inválido y esa distinción es funcional (`RTEL.5.3` vs `RTEL.5.4`).
  - **Anexo LOW** incorporado a design §8: el backfill dispara `user_private_set_updated_at` → re-sync de esas filas por PowerSync (inocuo, anotado para que T22/T23 no lo lean como anomalía), y los tests negativos de RLS de `run.cjs:244` deben conservar valores canónicos para no pasar por la razón equivocada.
  - **DP4 sigue abierta** para Puerta 1, sin cambios.

- **2026-07-18 — 4ª pasada: re-Gate 1 `PASS` + 4 ítems de texto de spec, cerrados.**
  - **MEDIUM-A — `RTEL.14.9` sin diente (el mismo defecto que `RTEL.3.4`, sobre un riesgo mayor).** El requirement existía pero no tenía archivo en design §2, ni fila en §9, ni registro en `run-tests.mjs` (lista explícita) → nunca habría corrido; y `classifyError` no está exportada, así que ni era testeable. Se agregó la extracción a `app/src/services/classify-error.ts` (`RTEL.14.9.1`, patrón `upload-classify.ts`), el test `classify-error.test.ts` (T10d), la fila en §9 y el registro en T10c. La aceptación de `R-7` deja de depender de una nota bloqueante más el criterio del reviewer.
  - **MEDIUM-B — `RTEL.2.9` elevada a control de seguridad.** Texto reescrito ("un solo origen", no "única"), nota declarándola **pata de la aceptación de `R-7`**, y reconocimiento de que hay **tres encodings** (TS / PL/pgSQL / regex del CHECK) sin verificación de equivalencia. Cerrado con `phone-vectors.json` (`RTEL.2.9.1`) ejercitado desde las dos suites (T3b, T4, T13c), `RTEL.2.9.2` (el backfill lo cubre el precheck + `VALIDATE` de la propia migración) y `RTEL.2.9.3` + T11 explícito: `setUserPhone` **importa** `normalizePhone` en vez de reimplementarla — `admin.ts` hoy no importa nada de `app/src`, así que era el camino natural a una cuarta copia, en el lugar más silencioso (los fixtures).
  - **L-2 — bug introducido por el fix de MEDIUM-4, no un LOW.** Nada obligaba a **emitir** en `valid → incomplete`/`empty`: borrar un dígito de un número válido dejaba al caller con el `canonical` viejo y persistía un número ya editado, y **las tres capas no lo atrapan** (re-normalizar un canónico stale es idempotente y el CHECK lo acepta: es un canónico bien formado del número equivocado). Nuevo `RTEL.3.1.2` + `RTEL.14.10` + nota en T6.
  - **L-1 — fundamento equivocado corregido.** `design:220` decía que el CHECK `NOT VALID` primero hace que los writes concurrentes "queden gobernados por el formato": falso, el `ADD CONSTRAINT` toma `ACCESS EXCLUSIVE` hasta el commit y los writers **bloquean**. El orden es correcto por otra razón (falla temprana y localizada ante un backfill con bugs), que ya estaba bien argumentada más abajo. Reescrito para no dejar un modelo mental equivocado sobre locking en el repo.
  - **L-3 — anotado sin acción** como línea de `R-7`: reintentos ilimitados ante `23514` amplifican el volumen de log del `DETAIL`; sigue siendo self-scoped y el rechazo es inalcanzable en operación normal.
  - **DP4 sigue abierta**, sin tocar.

- **2026-07-18 — Puerta 1: APROBADA por Raf. DP4 resuelta = opción D.** Raf eligió **detectar y sugerir con confirmación** ("¿Quisiste decir `11 2345-6789`?" + un tap lo aplica). Foldeado:
  - `RTEL.6.6`, `RTEL.6.7` y `RTEL.6.8` dejan de ser condicionales y pasan a **requirements firmes**; T9b deja de ser opcional.
  - Nuevo `RTEL.6.9`: el valor aceptado desde la sugerencia vuelve a entrar por el camino normal (`normalizePhone` → `PhoneValue` → re-normalización del service → CHECK), sin atajo de escritura.
  - Tests `RTEL.14.12` (detección para áreas de 2/3/4 dígitos + no-falso-positivo) y `RTEL.14.13` (el invariante: `normalizePhone` da el mismo resultado con y sin detección) + tarea T9c. Capture del Gate 2.5 extendido con la sugerencia.
  - **Invariante conservado intacto** (verificado por el re-Gate 1): `detectArTrunkPrefix` no se invoca desde `normalizePhone` ni desde ningún camino de escritura — propone, no escribe. La aprobación de DP4 amplía la **ayuda**, no afloja la **validación**: la tabla de códigos de área sigue confinada a presentación (`RTEL.4.6`) y la justificación de `RTEL.2.8` sigue en pie.
  - **DP1, DP2 y DP3** ya habían sido aceptadas por el leader; con esta aprobación el delta queda **sin decisiones abiertas**.

- **2026-07-18 — Implementación (T1–T18, T20) + reconciliación al as-built.** Todos los `RTEL.<n>` se
  implementaron como están escritos; ningún *qué* cambió. Se anotaron dos notas de reconciliación
  (`RTEL.4.2`: hueco de UX del tope de 10 dígitos frente al `15` **tipeado** — ver la entrada siguiente,
  donde Raf lo resolvió subiendo el tope; `RTEL.8.3`: el mecanismo del
  rechazo `23514` viaja con un `kind` propio y se muestra sobre el campo) y seis desvíos de **estructura**
  en `design-telefono.md` §9bis (ubicación de `PhoneValue`, extracción de la transición del input a
  funciones puras, dos props extra de `PhoneField`, firma de `validateProfile`, `kind: 'phone_format'` en
  la clasificación de errores, y el auto-skip de los tests backend hasta aplicar `0126`). La migración
  `0126` quedó **escrita y NO aplicada** (deploy gateado, T22). `app/e2e/telefono.spec.ts` y
  `app/e2e/captures/telefono.capture.ts` quedaron escritos y **no ejecutados** (requieren `e2e:build`,
  prohibido en el run); la lógica que ejercitan está cubierta por unit tests puros.

- **2026-07-18 — `0126` APLICADA a dev + reconciliación de datos (leader, con autorización de Raf).**
  Primer intento: la migración **abortó** por DP3 con `2 fila(s) ... no se pudieron normalizar` — el
  precheck funcionó exactamente como se diseñó y no dejó el CHECK a medias. Diagnóstico sin exponer PII
  (se inspeccionó la **forma** con `regexp_replace(phone,'[0-9]','N','g')`, nunca el valor): una fila de
  9 dígitos (usuario ya soft-deleteado) y una de 12 que **no** empieza con `54` ni matchea el patrón del
  `15` en áreas de 2/3/4 dígitos. Ninguna era interpretable → ambas a `NULL` (`phone` es nullable y
  opcional, `RTEL.5.4`) en vez de adivinar. Las otras 25 filas fuera de canónico las normalizó el backfill.
  Segundo intento: **OK (HTTP 201)**. Verificado contra dev: `user_private_phone_format_chk` **validado**,
  26 filas con teléfono, **0 fuera de canónico**, `user_private_phone_len_chk` de `0070` intacto.
  `check.mjs` con **todas las suites verdes**; los 6 tests del CHECK **en VERDE, 0 skipped** (T23 cumplido)
  — incluidos `RTEL.14.5` (un UPDATE de `email` sobre fila con teléfono canónico NO es rechazado → el
  hazard de DP3 sobre `propagate_confirmed_email` cerrado contra la DB real) y `RTEL.14.6` (el CHECK
  rechaza los vectores de inyección, incluido el salto de línea final que en PCRE habría pasado).
  **Nota de valor**: DP3 se justificó sola en su primera corrida — con el patrón `NOT VALID` sin validar,
  esas 2 filas habrían quedado grandfathereadas y el primer cambio de email de esos usuarios habría
  fallado con un error incomprensible.

- **2026-07-18 — `RTEL.4.2`: el tope de tipeo sube de 10 a 12 (decisión de Raf).** Origen: hallazgo del
  implementer en su autorrevisión (ver la nota bajo `RTEL.4.2`). Con el tope en 10, DP4 no cubría el caso
  para el que se aprobó —el `15` **tipeado**, que es lo más común en la manga— y se persistía un número
  equivocado sin aviso. Validación y canónico **sin cambios**; solo se relajó el buffer de tipeo.
  ⚠️ **El implementer que aplicó este cambio murió por límite de sesión durante su pasada adversarial**
  (justo al ir a revisar "otros consumidores del tope viejo y call sites faltantes"). El código quedó
  aplicado y verde (typecheck + 64 unit), pero **la reconciliación de spec no la había hecho** — la
  completó el leader. Por la regla de `reference_crashed_agent_recovery`, verde en typecheck+unit NO
  confirma completitud: el **reviewer es el oráculo** y debe verificar explícitamente que no quedaron
  call sites ni tests con el tope viejo.
