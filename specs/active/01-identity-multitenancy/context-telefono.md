# Spec 01 — Delta TELÉFONO (input, normalización y validación autoritativa) — Contexto (Gate 0)

**Status**: `context_ready` · Delta **Nivel B (ADR-028)** sobre spec 01 (baseline) · **CON BACKEND** (CHECK de formato + migración de normalización sobre PII) · **Gate 1 APLICA** (schema + PII).
**Fecha**: 2026-07-18.
**Origen**: bug reportado por Raf — los dos inputs de teléfono de la app **no son equivalentes**: en `crear-campo.tsx` se pueden tipear **letras** y el campo es de **largo ilimitado**; en `mas.tsx` no. Relevamiento del leader confirmado contra el as-built por este `spec_author`.
**Gate 0**: cerrado por el **leader** (modo autónomo). Las decisiones 1–6 de abajo vienen cerradas y **no se re-abren**; los puntos de "Casos y decisiones" que el leader delegó explícitamente los resuelve la spec y quedan marcados como **DP (decisión propia) para Puerta 1**.

---

## Problema

Un mismo dato (el teléfono del usuario, PII de contacto en `public.user_private`) se captura en **dos** pantallas con **dos** comportamientos distintos, y se persiste **sin normalizar** y **sin validación autoritativa** en el server.

### Los dos inputs divergen (el bug)

| | `app/app/crear-campo.tsx:154-163` (`CompletePhoneScreen`, gate R3.8) | `app/app/(tabs)/mas.tsx:464-476` (`ProfileEditForm`, R2.1) |
|---|---|---|
| `keyboardType` | `phone-pad` | `phone-pad` |
| `autoComplete` / `textContentType` | `tel` / `telephoneNumber` | ídem |
| `maxLength` | **AUSENTE** | `PHONE_MAX_LENGTH` (20) |
| `onChangeText` | `setPhone` **crudo** | `sanitizePhoneInput(text)` |

→ En `crear-campo` se pueden tipear **letras** y **largo ilimitado**. El único freno es `isValidPhone()` al submit (8–15 dígitos, ignora todo lo demás), y el cap server de 32 chars.

La causa raíz no es que falten dos props: es que **no hay un componente compartido**. Dos copias del mismo input divergen apenas una se toca. Cualquier fix que solo agregue las props faltantes vuelve a divergir en el próximo cambio.

### No hay formato canónico (cero normalización)

`establishments.ts:200` (`saveOwnPhone`) y `:290` (`saveProfile`) guardan el string con `.trim()` y nada más. Consecuencia: `"+54 9 11 2345-6789"`, `"011 4567-8900"` y `"5491123456789"` son **filas distintas** para el mismo abonado. Hoy eso no rompe nada visible; **impide deduplicar y contactar** el día que haga falta (y "el vet es el canal de adquisición" — su agenda de contactos es activo de producto).

### La validación server es solo un cap de longitud

Único constraint: `user_private_phone_len_chk` (`char_length(phone) <= 32`), `0070_check_text_length_caps.sql:142-143`. **Sin formato, sin mínimo, sin trigger.** La columna `public.user_private.phone` es `text` nullable (`0068_user_private_pii.sql:28-34`), RLS self-only (`user_private_update_self`).

Es decir: hoy un cliente puede escribir **cualquier string de ≤32 chars** en su propio `phone` — incluidos saltos de línea, comillas y unicode arbitrario. El cliente valida, pero el cliente **no es una frontera de seguridad** (ver §Gate 1).

### Hallazgo del `spec_author` no relevado por el leader — ⚠️ rompe la suite E2E

`app/e2e/helpers/admin.ts:85` (`setUserPhone`) siembra `'1123456789'` (10 dígitos crudos, sin `+54`) desde **~30 call sites** en 6+ specs (`animals.spec.ts`, `animals-offline.spec.ts`, `account.spec.ts`, `alta-bastoneo.spec.ts`, `auth.spec.ts`, …). En cuanto el CHECK de formato esté activo, **cada uno de esos seeds falla con 23514 y la suite E2E entera se pone roja**.

Mitigación (barata, un solo lugar): normalizar **dentro del helper** `setUserPhone` → los ~30 call sites siguen pasando `'1123456789'` sin tocarse. Queda como requirement explícito (`RTEL.9.1`).

Nota complementaria: `supabase/tests/user_private/run.cjs:215,233,244` ya siembra `'+541112345678'` / `'+541199999999'` — que **coinciden exactamente** con el formato canónico que elige este delta. La suite backend no requiere cambios.

---

## Decisiones ya cerradas por el leader (NO se re-abren)

- **D1 — Teclado numérico.** `keyboardType="phone-pad"` en ambos inputs (gold standard HIG/Material para campos `tel`; prevención de errores — Nielsen #5 — y teclas grandes — Fitts). Ya está bien; se conserva.
- **D2 — Enfoque Argentina.** Prefijo `+54` como **adorno visual fijo**; el usuario tipea **10 dígitos nacionales**; **máscara en vivo**. Validación de 10 dígitos exactos para AR.
- **D3 — Escape internacional.** Si el usuario arranca con `+`, se acepta formato libre con el rango **8–15 dígitos** actual (caso vet extranjero). No se bloquea a nadie.
- **D4 — NO se agrega `libphonenumber`** (~150 KB para un solo país).
- **D5 — Paridad entre los dos inputs.** Mismo componente/comportamiento en los dos lugares; el leader sugiere un componente `PhoneField` compartido para que no vuelvan a divergir.
- **D6 — Validación server-side real.** Hoy solo hay cap de longitud; hace falta un CHECK autoritativo.

---

## Casos y decisiones (los que el leader delegó a la spec)

### C1 — Formato de almacenamiento → **`+54` + 10 dígitos nacionales, canónico único**

**El detalle que decide todo:** el E.164 de un **celular** argentino lleva un `9` (`+549 11 2345 6789`); el de un **fijo** NO (`+54 11 4567 8900`). Ambos números nacionales significativos tienen **10 dígitos**. El `9` es información *derivada* (móvil vs fijo) que **no se puede inferir de los 10 dígitos** sin una tabla de prefijos — justamente lo que D4 descarta.

**Decisión (D-C1):** el formato canónico de almacenamiento es **`+54` + los 10 dígitos nacionales** (ej. `+541123456789`, 13 chars). Sin espacios, guiones ni paréntesis. Para el escape internacional (D3): `+` + 8–15 dígitos tal cual los dio el usuario. Sintaxis E.164 en ambos casos: `^\+[1-9][0-9]{7,14}$`.

**Por qué NO auto-insertar el `9`:** sería *adivinar*. Si adivinamos mal sobre un fijo, **corrompemos el dato de forma irrecuperable** (no hay forma de saber después si ese `9` lo puso el usuario o nosotros). Preservar los 10 dígitos nacionales es **lossless**: el `9` se puede anteponer más adelante, cuando exista el bit móvil/fijo; el camino inverso no existe.

**Y si el usuario nos DA el `9`** (pega `+5491123456789`): se **normaliza sacándolo** cuando el resto son exactamente 10 dígitos. Razón: una sola representación por abonado o el dedup no sirve. Perdemos un bit que igual no está poblado para el resto del universo de datos; ganamos unicidad exacta.

**Consecuencias explícitas (lo que el leader pidió considerar):**
- **Deduplicar** → habilitado: una representación estable por número nacional, comparable por igualdad de string. Es el beneficio principal y se cobra hoy.
  > **Corregido tras Gate 1 (MEDIUM-3).** Acá decía dedup **"exacto"** y era una sobre-afirmación: al descartar el `9`, un móvil y un fijo con el mismo número nacional colapsan al mismo string. Sirve para agrupar y comparar; **no** es un identificador de abonado. `RTEL.11.7`/`RTEL.11.8` prohíben usarlo como clave de identidad, dedup de cuentas, recuperación de acceso o matching de invitación mientras el canónico descarte el bit móvil/fijo.
- **WhatsApp** → **diferido pero desbloqueado**: `wa.me` necesita el `9` para celulares AR. El número nacional queda íntegro, así que cuando exista la feature se resuelve agregando el bit explícito (columna `phone_kind`, o preguntarlo una vez en ese flujo) y anteponiendo el `9` al enviar. Lo que **sí** habría bloqueado esa feature es corromper los fijos hoy con un `9` adivinado.

### C2 — Migración de los teléfonos existentes → **normalización determinista + precheck que aborta**

Hay datos en dev y prod. **Se normalizan retroactivamente**, con reglas deterministas y **cero adivinanza**:

| | Entrada | Resultado |
|---|---|---|
| N1 | empieza con `+`, 8–15 dígitos | `+<dígitos>` (se limpian separadores) |
| N2 | 10 dígitos | `+54<10>` |
| N3 | 11 dígitos con `0` inicial (prefijo troncal) | se saca el `0` → N2 |
| N4 | 12 dígitos con `54` inicial | `+<12>` |
| N5 | 13 dígitos con `549` inicial | se saca el `9` → `+54<10>` (C1) |
| N6 | cualquier otra cosa | **residuo**: no se toca |

**El residuo NO se deja pasar ni se borra:** la migración hace un **precheck que aborta con `raise exception`** si queda alguna fila fuera del formato canónico, con mensaje accionable y **solo el conteo, nunca el valor** (es PII: no va a logs). El leader reconcilia esas filas a mano y re-aplica. Es exactamente el patrón de `0068_user_private_pii.sql:75-87` (precheck de emails duplicados antes del backfill).

**Por qué abortar y no grandfatherear** (esto es lo que hace inviable la opción "dejarlos como están"): Postgres evalúa **todos** los CHECK de una fila en **cualquier** `UPDATE`, aunque la columna restringida no cambie. El trigger `propagate_confirmed_email` (`0068:169-194`) hace `update public.user_private set email = ... where user_id = ...`. Si esa fila tuviera un `phone` legacy sucio, **ese UPDATE fallaría y abortaría la confirmación de cambio de email** de ese usuario. Un CHECK `NOT VALID` no salva de esto: `NOT VALID` solo saltea el re-chequeo de las filas *existentes*; todo `INSERT`/`UPDATE` futuro **sí** se valida. Dejar filas sucias es dejar una bomba de tiempo en un flujo de auth. → **Cero residuo antes de `VALIDATE`.**

Volumen real: beta con un puñado de usuarios (Raf, Facundo, campo beta, usuarios e2e). El costo de reconciliar a mano es trivial; el de una regresión silenciosa en auth, no.

### C3 — El CHECK server-side → **formato + `NOT VALID` … `VALIDATE` en la misma migración**

```sql
alter table public.user_private
  add constraint user_private_phone_format_chk
  check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$') not valid;
-- (backfill + precheck en el medio; sin residuo)
alter table public.user_private validate constraint user_private_phone_format_chk;
```

`NOT VALID` primero (patrón de `0070`) para separar el enforcement de los writes futuros del re-chequeo retroactivo, y `VALIDATE` **después** del backfill, ya con el precheck garantizando cero residuo. Toda la migración en **una transacción** (atomicidad como `0068`).

`phone is null` explícito: el teléfono es opcional en el perfil (`validateProfile` trata vacío como "sin teléfono") y la fila nace con `phone` NULL desde `handle_new_auth_user`.

### C4 — Alineación de techos → **el techo que manda es 16, impuesto por el formato**

| Capa | Hoy | Después |
|---|---|---|
| Cliente, buffer tipeable | `PHONE_MAX_LENGTH = 20` chars (solo en `mas.tsx`) | `PHONE_MAX_LENGTH = 20` — **cap del buffer de display**, en ambos inputs |
| Cliente, dígitos | 8–15 | AR: **10 exactos** · intl: 8–15 |
| Valor almacenado | sin límite de formato, ≤32 chars | **≤16 chars** (`+` + 15 dígitos), formato exacto |
| Server, formato | — | `^\+[1-9][0-9]{7,14}$` (**≤16 implícito**) |
| Server, longitud | `<= 32` | `<= 32` (se **conserva**) |

Quedan unificados donde importa: **lo que se persiste está acotado a 16 chars y a un formato exacto**, y el buffer de 20 del cliente es físicamente incapaz de producir algo mayor. El cap de 32 de `0070` se **conserva** a propósito, no se aprieta a 16: es una constraint de seguridad vigente (INPUT-1), el CHECK de formato ya es estrictamente más fuerte, y un `drop`+`add` sobre un constraint de seguridad es churn destructivo sin ganancia. Queda como cota externa muerta (defensa en profundidad).

### C5 — `inputMode` en `FormField` → **NO se agrega al contrato**

`FormField` (`app/src/components/FormField.tsx:18-49`) no expone `inputMode`. **No hace falta**:
1. `keyboardType="phone-pad"` es la prop canónica de RN y react-native-web ya deriva de ahí el modo de teclado del input web.
2. Agregar una segunda prop solapada = dos formas de decir lo mismo → **exactamente la clase de divergencia que este delta viene a cerrar**.
3. `FormField` es contrato público de la librería de componentes; CLAUDE.md pide confirmar antes de modificar contratos públicos, y acá no hay defecto observado que lo justifique.

Si en Gate 2.5 aparece un defecto real de teclado en web táctil, es un follow-up de una línea. Se anota como riesgo, no como tarea.

### C6 — UX de la máscara (tipeo, borrado, pegado, cursor)

- **Tipeo:** los separadores **nunca se emiten por adelantado**. Se agrupa solo lo ya tipeado (`1` → `11` → `11 2` → … → `11 2345-6789`), sin dejar un separador colgando al final. Esto elimina de raíz el loop clásico "backspace borra el separador → la máscara lo re-agrega → el usuario queda trabado".
- **Borrado:** como no hay separadores colgantes, backspace **siempre** saca un dígito. Implementación: se deriva `digits` del string entrante; si el entrante tiene la **misma** cantidad de dígitos que el anterior (⇒ el usuario borró un separador), se descarta el último dígito.
- **Cursor:** el estado es *digits*; el valor renderizado es derivado → RN deja el caret al final. Aceptado para un campo de 10 dígitos que se tipea de izquierda a derecha. Edición en el medio salta el caret al final: tradeoff conocido de máscara simple, documentado, no bloqueante.
- **Pegado:** se aplican **las mismas reglas N1–N6 de C2** (una sola definición de normalización, compartida por cliente y migración). Si el resultado no cae en ninguna → **no se trunca en silencio**: se dejan los dígitos y se muestra el error inline accionable.
- **Prefijo `15`:** **no se saca al normalizar**. Copy que enseña el formato: *"Ingresá los 10 dígitos, sin el 0 ni el 15."*
  > **Corregido en la 2ª pasada.** La versión original justificaba esto con "sacarlo exige saber el largo del código de área → sería adivinar". **Ese argumento quedó falso** al introducirse la tabla de áreas en DP1 (C7), que da exactamente ese dato. La razón real: usar la tabla para **normalizar** rompería su propiedad de seguridad (es cosmética, y por eso una entrada mal nunca corrompe dato); si escribiera, un largo de área mal clasificado recortaría los dígitos equivocados y persistiría en silencio un teléfono incorrecto. Cuánta ayuda dar en el **estado de error** (donde nada se escribió todavía) se abrió como **DP4** en `requirements-telefono.md` → **resuelta por Raf en Puerta 1 (2026-07-18): opción D**, detectar y sugerir con confirmación de un tap. La detección **propone, no escribe**, así que la propiedad de arriba se mantiene intacta.

### C7 — Agrupación de la máscara → ⚠️ **DP1: override de la letra de D2** (ver requirements)

D2 dice máscara **`11 2345-6789`**. Esa agrupación es **correcta solo para códigos de área de 2 dígitos (Buenos Aires)**. En AR los códigos de área son de **2, 3 o 4** dígitos, y el **primer cliente beta está en Chascomús — área 2241** (4 dígitos): con la agrupación literal su propio teléfono se renderizaría `22 4143-0000`, visiblemente roto para el usuario que más cuida el proyecto.

Resolución en `requirements-telefono.md` **DP1** (tabla acotada de códigos de área, ~36 entradas, **solo cosmética**). Se marca como decisión propia porque refina la letra de una decisión del leader.

### C8 — Estados de error → patrón del repo

**scroll-al-campo + borde rojo `$terracota` + error inline.** Nunca banner global que tape el título.
- Borde + error inline: ya los da `FormField` (`hasError` → `borderColorError` = `$terracota`, más `<Text color="$terracota">` debajo).
- Scroll-al-campo: patrón de geometría ya establecido en `crear-animal.tsx:237-259` (`onLayout` → `y` relativo → `scrollTo`, sin `measureLayout`, robusto en web y native). Aplica donde el form scrollea (`mas.tsx`); en `CompletePhoneScreen` (pantalla corta de un solo campo) es no-op.
- **Separación de errores** (paridad, hoy rota): el error de **validación de campo** va al campo (`FormField error`); el error de **guardado/red** va al `FormError` **debajo** de los campos. Hoy `CompletePhoneScreen` mete los dos en el mismo prop del campo; `mas.tsx` ya los separa bien. Se alinea a `mas.tsx`.

### C9 — Formato es-AR: el teléfono es un caso aparte (definición explícita)

`docs/conventions.md` §"Formato de datos para el usuario (es-AR)" manda coma decimal + punto de miles. **Eso NO aplica al teléfono** — un teléfono no es una cantidad: `1.123.456.789` sería absurdo. Regla propia:

- **Display / tipeo:** adorno fijo `+54` + máscara nacional agrupada por código de área (C7). Nunca punto de miles, nunca coma.
- **Almacenamiento / máquina:** canónico `+54` + 10 dígitos, sin separadores (C1) — igual que ISO/punto decimal en el resto de los formatos de máquina.

Se agrega como carve-out de una línea en `docs/conventions.md` (tarea del delta).

---

## Alcance

**Entra:**
- Componente compartido `PhoneField` (D5) + su adopción en los **dos** call sites.
- Normalización canónica + formateo de display, en `app/src/utils/` (lógica pura, testeable con node:test).
- Migración `0126`: backfill de normalización + precheck que aborta + CHECK de formato `NOT VALID` → `VALIDATE`.
- Normalización en `setUserPhone` (`app/e2e/helpers/admin.ts`) para no romper la suite E2E.
- Clasificación del error `23514` en los services a copy accionable.
- Carve-out del teléfono en `docs/conventions.md`.

**No entra:**
- `libphonenumber` (D4).
- Columna `phone_kind` / bit móvil-vs-fijo, y cualquier feature de WhatsApp (diferido, C1).
- Deduplicación de usuarios por teléfono (este delta la **habilita**; no la implementa).
- Verificación del teléfono por SMS/OTP.
- Pedir teléfono en signup (sigue opcional — decisión vigente del baseline, `requirements.md:27` y `R1.1`).
- Apretar `user_private_phone_len_chk` de 32 a 16 (C4).
- Agregar `inputMode` a `FormField` (C5).

---

## Pendientes

De `CONTEXT/07-pendientes.md`: ninguno bloqueante. El bit móvil/fijo (C1) **no** se eleva a pendiente-de-Facundo: es una decisión de producto que recién aparece cuando exista la feature de contacto.

---

## Gate 1 — por qué aplica y qué tiene que auditar

Toca **schema** (CHECK nuevo + migración con backfill) y **PII** (`user_private.phone`, ADR-025). El `security_analyzer` en modo `spec` debería verificar en particular:

1. **El cliente no es frontera de seguridad.** El bundle RN es modificable por el usuario y PostgREST es alcanzable directo con su propio JWT; `user_private_update_self` autoriza cualquier `UPDATE` de la **fila propia**. Hoy eso permite escribir **cualquier string ≤32 chars** en una columna de PII. La única cota autoritativa es el CHECK. Toda la validación de cliente de este delta es UX, no control.
2. **El CHECK como saneamiento para consumidores downstream.** `^\+[1-9][0-9]{7,14}$` elimina por construcción saltos de línea, comillas, control chars y unicode arbitrario → ningún consumidor futuro (email transaccional, push, export) puede recibir un `phone` con payload de inyección. Es la mitigación barata que el cap de longitud no da.
3. **No se afecta la RLS.** El delta no toca policies, grants ni streams. `user_private` sigue self-only (`user_private_select_self` / `user_private_update_self`, `0068:105-114`), sin `establishment_id`, y `members.ts` sigue sin exponer PII de terceros. El CHECK es ortogonal al control de acceso (valida input, no autoriza).
4. **PII fuera de los mensajes *de esta migración*.** El precheck reporta **conteo** y `user_id` opacos, nunca valores de contacto (patrón `0068:83-86`).
   > **Alcance corregido tras Gate 1 (HIGH-1).** La redacción original —"PII fuera de logs" a secas— **sobre-afirmaba**. Es cierta para los `raise` de `0126`, pero **no** cubre el leak que el delta sí introduce: el rechazo del CHECK en **runtime** emite `DETAIL: Failing row contains (...)` con email y teléfono en claro, porque `authenticated` tiene `grant select` sobre `user_private` (`0068:200`). Ese leak se **acepta como riesgo residual documentado** (`R-7`, design §8) por decisión del leader: es self-scoped por RLS, la audiencia ya tiene acceso a la DB, y cerrar MEDIUM-1 lo vuelve prácticamente inalcanzable. Se agregaron `RTEL.8.5`/`RTEL.8.6` para que la PII tampoco viaje al **cliente** por la vía de `error.details`.
5. **El hazard del CHECK sobre `UPDATE` no relacionado** (C2): que el residuo sea cero antes de `VALIDATE` es requisito de correctitud de `propagate_confirmed_email`, no una preferencia estética.
6. **Superficie de deploy**: migración en una transacción, coordinada con el release del cliente (un cliente viejo escribiendo formato viejo recibe 23514).

---

## Insumos para `spec_author`

- Baseline: `specs/active/01-identity-multitenancy/requirements.md` — `R1.1` (teléfono no se pide en signup), `R2.1` (perfil edita teléfono), `R3.8` (gate al crear campo), decisión de diseño de la línea 27, `R9.2` (online-only).
- `docs/adr/ADR-025-pii-tabla-private-self-only.md` — por qué `phone` vive en `user_private`.
- `docs/adr/ADR-028-...` — este delta es Nivel B.
- `docs/conventions.md` §"Formato de datos para el usuario (es-AR)" y §SQL (migrations).
- As-built: `app/src/utils/validation.ts:47-92` · `app/src/utils/validation.test.ts:83-117` · `app/src/components/FormField.tsx` · `app/app/crear-campo.tsx:115-173` · `app/app/(tabs)/mas.tsx:405-496` (+ `:308` display read-only) · `app/src/services/establishments.ts:193-207, 276-306` · `app/e2e/helpers/admin.ts:85-88`.
- Migraciones de referencia: `0068_user_private_pii.sql` (atomicidad, precheck abortivo, PII fuera de logs) · `0070_check_text_length_caps.sql:135-185` (`NOT VALID` / `VALIDATE`, y el comentario de por qué a veces se omite `VALIDATE`).
- Patrón scroll-al-campo: `app/app/crear-animal.tsx:231-259, 533-537`.

---

## Aprobación

- **Gate 0 cerrado por**: leader (modo autónomo), 2026-07-18. Decisiones D1–D6 fijadas por el leader; C1–C9 resueltas por el `spec_author` bajo delegación explícita.
- **Puerta 1 (spec)**: pendiente de Raf. Flags de criterio propio a ratificar: **DP1** (agrupación de la máscara por código de área — override de la letra de D2), **DP2** (normalizar sacando el `9` que el usuario provee), **DP3** (migración aborta ante residuo en vez de grandfatherear). **DP1–DP3 aceptadas por el leader (2026-07-18).**
- **Puerta 1 APROBADA por Raf (2026-07-18).** **DP4 resuelta = opción D**: ante un celular escrito con `15` (forma corriente en AR), el sistema detecta el patrón y **propone** el número corregido con confirmación de un tap. `RTEL.6.6`–`RTEL.6.9` firmes. El invariante se conserva: la detección **propone, no escribe** — la tabla de códigos de área sigue sin participar de normalización ni de almacenamiento.
- **El delta queda sin decisiones abiertas.** DP1/DP2/DP3 aceptadas por el leader; DP4 por Raf.
