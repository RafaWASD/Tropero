# Spec 01 — Delta TELÉFONO — Tasks

**Status**: `spec_ready` · Delta **Nivel B (ADR-028)** · **Gate 1 APLICA** · **Migración `0126`**.
**Fecha**: 2026-07-18.
**Requirements**: `requirements-telefono.md` (`RTEL.<n>`) · **Design**: `design-telefono.md`.

> El implementer marca `[x]`. El reviewer rechaza si queda `[ ]` sin justificación documentada.
> Este delta trae su propio ledger: **el `tasks.md` del baseline NO se toca** (ADR-028).

---

## Estado al cerrar el run del implementer (2026-07-18)

**Hechas**: T1–T18, T20, T24 (todas las de código, tests y docs) + **T22** (la aplicó el leader
después del run — ver abajo).

**Abiertas, con dueño y motivo** (ninguna es un `[ ]` sin justificar):

- **T19 — veto visual**: es del **leader** (Gate 2.5). El capture file de T18 quedó escrito y listo.
- **T21 / T21b — `progress/impl_telefono.md`**: el leader **prohibió explícitamente** tocar `progress/*`
  en este run. La autorrevisión adversarial y el checklist de no-regresión se hicieron igual y viajan en
  el reporte de vuelta del implementer (mapa `RTEL.<n> → archivo:test` incluido), no en `progress/`.
- **T23 — verificación post-apply (parcial)**: lo backend ya está hecho y verde (ver T22). Lo que falta
  es únicamente la **suite E2E completa + las capturas del Gate 2.5**, que exigen `pnpm e2e:build` —
  prohibido mientras `app/dist` esté compartido con otra terminal. Queda `[ ]` acotada a eso.
- **T25 — folding al baseline**: es de la **Puerta 2**.

**Cerradas después del run del implementer** (leader):

- **T22 — `0126` APLICADA a dev** (2026-07-18, con autorización de Raf). El primer intento **abortó** por
  el precheck de DP3 (2 filas no normalizables); se reconciliaron **por `user_id`, sin volcar `phone`**
  (se inspeccionó la *forma* con `regexp_replace(phone,'[0-9]','N','g')`) y se pasaron a `NULL` en vez de
  adivinar. Segundo intento OK. Verificado contra dev: `user_private_phone_format_chk` **validado**,
  **26 filas** con teléfono, **0 fuera de canónico**, `user_private_phone_len_chk` intacto, y los
  **6 tests del CHECK en VERDE con 0 skipped** (el auto-skip del §9bis punto 6 ya no dispara — que es
  justamente la prueba de que la migración entró).

**Dos deliverables escritos pero NO ejecutados** (el implementer no los pudo correr, no es un olvido):
`app/e2e/telefono.spec.ts` (T16/T17) y `app/e2e/captures/telefono.capture.ts` (T18). Correrlos exige
`pnpm e2e:build`, que el leader prohibió en este run (`app/dist` es compartido con otra terminal que
estaba sirviéndolo). Mitigación: **toda la lógica que esos tests ejercitan quedó cubierta por unit tests
puros** — la transición del input (tipeo, máscara, backspace, pegado, topes, modo internacional y las
transiciones `valid → incomplete` / `valid → empty` de L-2) se extrajo a `phoneInputChange` en
`app/src/utils/phone.ts` y se testea con `node:test`, incluidos los **strings exactos** que asertan los
E2E (`11 2345`, `11 2345-6789`, `2241 43-0000`, `11 1523-456789` y `11 2345-678900` — este último es el
**tope de tipeo de 12** de `RTEL.4.2`). El E2E queda como verificación de cableado end-to-end, para el
Gate 2.5.

---

## Orden y por qué

Lógica pura → componente → call sites → services → backend → fixtures → capture → docs.
Dos restricciones de orden que **no son negociables**:

- **T11 (helper `setUserPhone`) va antes de aplicar `0126` (T22).** Si la migración se aplica primero, los ~30 seeds de teléfono de la suite E2E fallan con `23514` y todo queda rojo sin que haya una regresión real.
- **La migración (T12) la escribe el implementer pero la APLICA el leader (T22)**, recién tras Gate 1 + reviewer + Gate 2 (toca schema y PII sobre la DB compartida).

---

## Lógica pura

- [x] **T1** — Crear `app/src/utils/phone.ts` con las constantes de techo (`PHONE_AR_NATIONAL_DIGITS`, `PHONE_MIN_DIGITS`, `PHONE_MAX_DIGITS`, `PHONE_MAX_STORED_LENGTH`, `PHONE_MAX_LENGTH`), documentando en comentario qué gobierna cada una. Cubre: RTEL.1.5, RTEL.4.9.

- [x] **T2** — Implementar `normalizePhone(raw): NormalizedPhone` con las reglas N1–N6 y la **precedencia `+` / no-`+`** del design §3.2. La rama internacional (N1) exige **primer dígito ≠ `0`** (MEDIUM-1): sin eso el cliente daría por válido un `+0123456789` que el CHECK rechaza. Cubre: RTEL.2.1–RTEL.2.10, RTEL.1.1–RTEL.1.4, RTEL.5.2.

- [x] **T3** — Implementar `arAreaCodeLength` + tabla `AR_AREA_2` / `AR_AREA_3` (resto ⇒ 4 dígitos), `maskArPhone` (agrupación progresiva **sin separador colgante**) y `formatPhoneDisplay`. Dejar comentado que la tabla es **solo cosmética** y nunca participa de validación ni de almacenamiento. Cubre: RTEL.4.3, RTEL.4.4, RTEL.4.6, RTEL.10.1.

- [x] **T3b** — Crear `app/src/utils/phone-vectors.json`: **tabla compartida de vectores canónicos** (`entrada → esperado`) cubriendo todos los bordes — N1–N6, precedencia `+`/no-`+`, primer dígito `0`, `9` removido, `15` no removido, longitudes 8 y 15, y no-normalizables. Es el artefacto que hace verificable `RTEL.2.9` (MEDIUM-B). Cubre: RTEL.2.9.1.

- [x] **T4** — Test: `app/src/utils/phone.test.ts` (`node:test`) que **recorre `phone-vectors.json`** (encoding TypeScript) y además cubre la máscara: agrupación para áreas de 2 / 3 / **4** dígitos (incluir `2241…`, Chascomús), ausencia de separador colgante y backspace. Los casos de normalización viven en el JSON, no duplicados acá. Cubre: RTEL.14.1, RTEL.14.2, RTEL.14.8, RTEL.14.11, RTEL.2.6, RTEL.2.8, RTEL.2.10.

- [x] **T5** — Repuntar `app/src/utils/validation.ts`: `isValidPhone` delega en `normalizePhone`; `validateProfile` conserva vacío ⇒ "sin teléfono"; se preservan los exports vigentes (`phoneDigits`, `sanitizePhoneInput`, `PHONE_MAX_LENGTH`) para no romper importadores. Ajustar `validation.test.ts:83-117` al nuevo criterio AR = **10 dígitos exactos** (hoy `'12345678'` da `true`; pasa a `false`). Cubre: RTEL.5.1, RTEL.5.2, RTEL.5.4, RTEL.5.5.

## Componente compartido

- [x] **T6** — Crear `app/src/components/PhoneField.tsx`: estado interno `digits` + `intl`; contrato `PhoneValue` de **tres estados** (`empty` / `incomplete` / `valid` con `canonical`) — MEDIUM-4: el caller no puede recibir texto crudo porque el único campo que transporta valor vive en `valid`, y `empty` no se conflaciona con inválido (`RTEL.5.3` vs `RTEL.5.4`); adorno `+54` no editable; modo internacional al tipear/pegar `+` y regreso al vaciar; pegado vía `normalizePhone` sin truncado silencioso; compone `FormField` **sin cambiar su contrato** (`keyboardType="phone-pad"`, `autoComplete="tel"`, `textContentType="telephoneNumber"`, `maxLength`, `error`, `testID`). Cubre: RTEL.3.1, RTEL.3.1.1, RTEL.3.5, RTEL.3.8, RTEL.4.1, RTEL.4.2, RTEL.4.5, RTEL.4.7, RTEL.4.8, RTEL.4.9.

  > **⚠️ L-2 — emitir SIEMPRE.** `onChangeValue` se invoca en **cada** cambio, incluidas las transiciones `valid → incomplete` y `valid → empty`. Si el componente emitiera solo al alcanzar `valid`, borrar un dígito de un número ya válido dejaría al caller con el `canonical` viejo y **persistiría un número que el usuario ya editó** — y ninguna de las tres capas lo atrapa: el tipo es correcto, re-normalizar un canónico válido es idempotente (devuelve el mismo stale), y el CHECK lo acepta porque *es* un canónico bien formado, solo que del número equivocado. Es el único camino del delta capaz de guardar un teléfono incorrecto sin que nada falle. Test de transiciones obligatorio. Cubre: RTEL.3.1.2, RTEL.14.10.

## Call sites (la paridad)

- [x] **T7** — `app/app/crear-campo.tsx` (`CompletePhoneScreen`, ~L148-173): reemplazar el `FormField` por `PhoneField`; **separar** el error de validación de campo del error de guardado/red (hoy ambos van al mismo prop del campo, `:162`) llevando el segundo a un `FormError` debajo. Cubre: RTEL.3.2, RTEL.3.6, RTEL.3.7, RTEL.6.1, RTEL.6.5, RTEL.5.3.

- [x] **T8** — `app/app/(tabs)/mas.tsx`: (a) `ProfileEditForm` (~L464-476) usa `PhoneField`; (b) el `ProfileField` de teléfono (`:308`) muestra `formatPhoneDisplay(profile.phone)` y conserva "Sin teléfono" cuando es `null`; (c) scroll-al-campo ante error de teléfono con el patrón de geometría de `crear-animal.tsx:237-259`. Cubre: RTEL.3.3, RTEL.3.4, RTEL.6.1, RTEL.6.2, RTEL.6.3, RTEL.10.1, RTEL.10.2.

- [x] **T9** — Copy de errores en voseo: mensaje de formato para el caso 11–12 dígitos no reconocido ("Ingresá los 10 dígitos, sin el 0 ni el 15."), mensaje de largo AR, y mensaje del rechazo `23514`. Centralizados, no duplicados por pantalla. Cubre: RTEL.6.4, RTEL.8.3.

- [x] **T9b** — **DP4 aprobada (opción D).** Implementar `detectArTrunkPrefix` (design §4bis) + el mensaje específico del `15` + la **sugerencia confirmable de un tap**, mostrada formateada según `RTEL.4.3`. Al aceptarla, el valor vuelve a entrar por el camino normal (`normalizePhone` → `PhoneValue` → re-normalización del service → CHECK), sin atajo de escritura. Cubre: RTEL.6.6, RTEL.6.7, RTEL.6.8, RTEL.6.9.

  > **⚠️ INVARIANTE DE SEGURIDAD (no es detalle de implementación).** `detectArTrunkPrefix` **no** se invoca desde `normalizePhone` ni desde ningún camino de escritura: **propone**, no escribe. Es lo que mantiene la tabla de códigos de área confinada a presentación (`RTEL.4.6`) y sostiene la justificación de `RTEL.2.8` — si la tabla escribiera, un largo de área mal clasificado recortaría los dígitos equivocados y persistiría un teléfono incorrecto en silencio. El re-Gate 1 verificó este invariante; **no relajarlo** al implementar. Dejarlo comentado en el código como invariante, no como nota de estilo.

- [x] **T9c** — Test de DP4: detección del `15` para áreas de **2, 3 y 4 dígitos** (la sugerencia se calcula distinto según el largo); un valor de 12 dígitos **sin** `15` en esa posición no produce sugerencia; y el invariante — `normalizePhone` da el mismo resultado con y sin detección disponible, y el valor aceptado desde la sugerencia atraviesa `normalizePhone` antes de persistirse. Cubre: RTEL.14.12, RTEL.14.13.

## Services

- [x] **T10** — `app/src/services/establishments.ts`: `saveOwnPhone` (`:193-207`) y `saveProfile` (`:276-306`) envían el **canónico** (o `null` si vacío, solo en perfil); agregar la rama de `classifyError` para `23514` sobre el constraint de teléfono → copy accionable de formato; conservar intacto el `assertOnline` de ambos. Cubre: RTEL.8.1, RTEL.8.2, RTEL.8.3, RTEL.8.4.

  > **⚠️ BLOQUEANTE (HIGH-1).** La rama de `23514` devuelve **solo el copy fijo** de formato: **no** lee `error.details` ni `error.hint`, **no** devuelve el `error.message` crudo de Postgres, y la firma `classifyError(error: { message?: string; code?: string } | null)` (`:48-58`) **no se amplía**. En un `23514`, PostgREST expone en `details` el `Failing row contains (...)` con **email y teléfono en claro**. Hoy eso no llega a la UI *solo* porque la firma no lo consume — protección accidental, y esta tarea toca justo esa función. Cubre además: RTEL.8.5, RTEL.8.6.
  >
  > **MEDIUM-A:** para que esto sea **testeable** y no dependa del criterio del reviewer, `classifyError` se **extrae** de `establishments.ts:48-58` a `app/src/services/classify-error.ts` (módulo puro, patrón de `powersync/upload-classify.ts`) y `establishments.ts` la importa. Sin extraer (o al menos exportar) no hay forma de testearla sin arrastrar el cliente de Supabase y PowerSync a la suite unitaria. Cubre: RTEL.14.9.1.

- [x] **T10d** — Crear `app/src/services/classify-error.test.ts`: ante un error `23514` **con `details` y `hint` poblados con PII simulada**, la clasificación devuelve el copy fijo de formato y no expone `details`, `hint` ni el mensaje crudo de Postgres. Es el test que **sostiene la aceptación de R-7** (MEDIUM-A). Cubre: RTEL.14.9, RTEL.8.5, RTEL.8.6.

## Guard de paridad (que RTEL.3.4 tenga diente)

- [x] **T10b** — Crear `app/src/components/phone-field-guard.test.ts` (design §6bis): camina `app/app/**` y `app/src/components/**`, saltea comentarios, y falla si un archivo distinto de `PhoneField.tsx` contiene `keyboardType` en `phone-pad`, `autoComplete` en `tel` o `textContentType` en `telephoneNumber`. Reportar `archivo:línea` + por qué (apuntar a `PhoneField`). Soportar la excepción por línea `phone-field-disable-next-line -- <razón>`. Cubre: RTEL.3.9, RTEL.3.10, RTEL.14.7, RTEL.3.4.

- [x] **T10c** — ⚠️ Registrar **los tres** archivos nuevos en la lista **explícita** de `scripts/run-tests.mjs:61`: `app/src/utils/phone.test.ts`, `app/src/components/phone-field-guard.test.ts` y `app/src/services/classify-error.test.ts`. No hay glob: un test no registrado **nunca corre**. Un guard muerto es peor que ninguno (da falsa confianza), y en el caso de `classify-error.test.ts` la omisión sería peor todavía, porque **es la pata de la aceptación de R-7** (MEDIUM-A). Verificar que los tres aparecen en la salida de `node scripts/check.mjs`. Cubre: RTEL.14.1, RTEL.14.2, RTEL.14.7, RTEL.14.9.

## Fixtures — antes de aplicar la migración

- [x] **T11** — `app/e2e/helpers/admin.ts:85` (`setUserPhone`): normalizar el valor recibido al canónico **dentro del helper**, de modo que los ~30 call sites que pasan `'1123456789'` no se toquen. Documentar en el docstring por qué. Cubre: RTEL.9.1, RTEL.9.2.

  > **⚠️ MEDIUM-B — importar, no reimplementar.** El helper debe **importar `normalizePhone` de `app/src/utils/phone.ts`**. Hoy `admin.ts` no importa nada de `app/src`, así que "normalizar dentro del helper" se lee natural como *escribir la normalización acá* → sería una **cuarta copia** de las reglas, y `RTEL.2.9` (que es control de seguridad, pata de la aceptación de R-7) quedaría violada en el lugar más silencioso posible: los fixtures. Si hace falta ajustar rutas/resolución de módulos para el import, ese ajuste es parte de la tarea. Cubre: RTEL.2.9.3.

## Backend

- [x] **T12** — Crear `supabase/migrations/0126_user_private_phone_format.sql` según design §5.2: CHECK `NOT VALID` → backfill N1–N6 en SQL (con la precedencia `+`/no-`+` **y el `left(v_digits,1) <> '0'` de la rama intl**, MEDIUM-1 — sin eso el backfill produciría un valor que el propio `VALIDATE` rechazaría) → **precheck abortivo** del residuo → `validate constraint` → `comment on constraint` → `notify pgrst`. Todo en una transacción. **Ningún teléfono ni email en `raise notice`/`raise exception`** (solo conteos y `user_id`). El `raise exception` del precheck debe incluir la **query de reconciliación que devuelve solo `user_id`** (MEDIUM-2). Incluir en el header la nota de **riesgo residual R-7** (leak de PII por `DETAIL` del CHECK en runtime, HIGH-1). No tocar policies, grants, streams, triggers, el tipo de la columna ni `user_private_phone_len_chk`; no crear índices ni constraints de unicidad sobre `phone` (RTEL.11.8). Cubre: RTEL.7.1–RTEL.7.8, RTEL.1.5, RTEL.11.2, RTEL.11.8, RTEL.2.9.2.

  > **MEDIUM-B — el backfill es el tercer encoding.** Su equivalencia con los otros dos no se testea aparte: la garantiza la **propia migración**, porque el precheck abortivo (T3 del SQL) corre **después** del backfill y **antes** del `validate constraint`. Si el `do $$` en PL/pgSQL produjera un valor que el regex del CHECK no acepta, la migración aborta en vez de persistirlo. Dejar ese razonamiento comentado en el SQL, para que nadie "optimice" sacando el precheck creyéndolo redundante con el `VALIDATE` (RTEL.2.9.2).

- [x] **T13** — Test backend en `supabase/tests/user_private/run.cjs`: (a) `UPDATE` de `phone` con formato no canónico (`'11 2345 6789'`, `'abc'`, `'+549112345678901234'`, `'+0123456789'`) → rechazado por `user_private_phone_format_chk`; (b) canónico (`'+541123456789'`) → aceptado; (c) `phone = null` → aceptado. El caso `'+0123456789'` es el que demuestra `RTEL.5.6`: la validación de cliente es UX y el CHECK es la frontera real (un cliente modificado no puede saltearla). Cubre: RTEL.14.4, RTEL.7.1, RTEL.5.6.

- [x] **T13c** — Test backend que **recorre `app/src/utils/phone-vectors.json`** desde `supabase/tests/user_private/run.cjs` (leyéndolo vía el `REPO_ROOT` que la suite ya resuelve) y verifica, contra el CHECK real, que cada `esperado` es aceptado y cada no-normalizable es rechazado. Es la mitad backend de `RTEL.2.9.1`: si el encoding TypeScript y el del CHECK divergen en cualquier borde, **una de las dos suites se pone roja**. Cubre: RTEL.14.11, RTEL.2.9, RTEL.2.9.1.

- [x] **T13b** — Test backend de los **vectores de inyección** de `RTEL.11.2`, en la misma suite: newline al final / al inicio / en el medio, CR, tab, espacio, comilla simple, marcado HTML, dígitos no ASCII y código de país con `0` → todos rechazados. El caso de **newline al final** va explícito y comentado: es el que distingue la semántica POSIX de Postgres de la de PCRE (donde `$` sí matchea antes de un `\n` final), y por eso la garantía no puede quedar como supuesto. Valores esperados ya verificados contra el remoto (design §5.2bis). Cubre: RTEL.14.6, RTEL.11.2, RTEL.11.2.1.

- [x] **T14** — Test backend en la misma suite: sobre una fila con `phone` canónico, un `UPDATE` de `email` **no** es rechazado por el CHECK de formato (regresión que DP3 previene sobre `propagate_confirmed_email`). Cubre: RTEL.14.5, RTEL.11.4.

- [x] **T15** — Verificar que la suite `user_private` existente sigue verde sin cambiar sus valores de fixture (`'+541112345678'`, `'+541199999999'`, `'+540000000000'` ya son canónicos). **Anexo LOW del Gate 1**: el test negativo de RLS de `run.cjs:244` (escribir en la fila ajena y assertar que no cambia) **debe conservar un valor canónico**; con uno no canónico el `UPDATE` fallaría por el CHECK y el test pasaría **por la razón equivocada**, dejando de verificar la RLS. Anotar ese porqué en el test. Cubre: RTEL.9.3, RTEL.11.1.

## Tests de UI

- [x] **T16** — E2E sobre el gate de teléfono de `crear-campo`: (a) tipear letras no deja **ningún** carácter en el campo; (b) no se pueden superar los **12** dígitos en modo AR (`RTEL.4.2` reconciliada: el tope de tipeo subió de 10 a 12 por decisión de Raf; la **validación sigue en 10 exactos**, así que 11 y 12 nunca son `valid` ni se persisten); (c) submit con teléfono corto muestra borde `$terracota` + error inline y **no** navega. Es la verificación directa del bug reportado. Cubre: RTEL.14.3, RTEL.3.6, RTEL.3.7, RTEL.6.1, RTEL.4.2.

- [x] **T17** — E2E de paridad: el input de teléfono de "Más" rechaza letras y topea igual que el de `crear-campo` (mismo componente ⇒ mismo comportamiento). Cubre: RTEL.3.3, RTEL.3.4.

## Gate 2.5

- [x] **T18** — Crear `app/e2e/captures/telefono.capture.ts` con: (a) gate de `crear-campo` con máscara en vivo y adorno `+54`; (b) el mismo en estado de error (borde `$terracota` + inline, título **no** tapado); (c) el input de teléfono del perfil en "Más"; (d) el display read-only del teléfono guardado. Incluir un número con área de **4 dígitos** (`2241…`) para vetar DP1, y **la sugerencia de DP4** (`11 15 2345 6789` → "¿Quisiste decir 11 2345-6789?") para vetar que el affordance se lea claro y no tape el título. Cubre: RTEL.12.1, RTEL.12.2, RTEL.6.3, RTEL.6.7.

- [ ] **T19** — Veto visual (leader): descendentes no recortados en los títulos de ambas pantallas, sheet/form con header fijo, y **prueba táctil real en web** del `phone-pad` (memoria: Playwright Desktop enmascara touch). Cubre: RTEL.3.5 (riesgo R-5).

  > **1ª pasada del veto: RECHAZADA (leader, 2026-07-18)** con dos defectos de presentación. Fix-loop en
  > **T19b**. Queda `[ ]` a propósito: el veto lo cierra el leader sobre las capturas **regeneradas**.

- [x] **T19b** — *(fix-loop del veto de T19; solo presentación — no se tocó `phone.ts`, ni la validación, ni el canónico, ni DP4, ni la migración `0126`, ni `classify-error.ts`.)* Cerrar los dos defectos que el leader midió sobre las capturas: **(1)** el placeholder se leía como un valor ya cargado (misma posición que un valor real, y en `$textMuted` = 6.03:1, apenas 3.2× de separación) → restituir el prefijo **`Ej. `** que el as-built previo a `PhoneField` tenía y que el componente perdió al unificar las dos pantallas, + bajar el placeholder de `FormField` a **`$textFaint`**; **(2)** el label `Teléfono` quedaba sangrado 75px respecto de sus hermanos y **saltaba ~76px** al desaparecer el chip `+54` (**ADR-027**) → el label pasa a etiquetar el **grupo** (`FieldLabel` a nivel de `PhoneField` + `hideLabel` aditiva en `FormField`, con el `label` intacto como nombre accesible). Regenerar las capturas con `app/dist` reconstruido **limpio** y **verificar midiendo** (Pillow), no a ojo. Cubre: RTEL.4.1 (nota as-built), RTEL.3.8 (nota as-built), RTEL.12.1, ADR-027.

  > **Verificado midiendo, no a ojo.** Placeholder `(114,249)-(237,263)` `rgb(128,122,116)` → **4.24:1**;
  > valor real `(113,249)-(214,260)` `rgb(15,14,12)` → **19.29:1** (separación **4.6×**, antes 3.2×), más
  > el `Ej. ` y la silueta (descendente de la `j`: h=15 vs h=12). Perfil: `Nombre` x=37 / `Teléfono`
  > x=36 —el 1px es *side bearing* `N` vs `T`, no layout: las cajas del grupo arrancan las dos en x=36 y
  > terminan en x=375, y el mismo par da 37/36 en el display de **solo lectura**, que nunca tuvo chip—.
  > Label con bbox **idéntico** `(18,207)-(71,216)` en AR (`01`), internacional (`08`) y error (`05`):
  > no se mueve con la decoración (ADR-027 regla 2). Suites: typecheck verde, **64/64** unit del delta,
  > **10/10** E2E (`telefono` + `profile` + `establishments`), capture **2 passed** / 12 capturas.

## Documentación

- [x] **T20** — `docs/conventions.md`, sección "Formato de datos para el usuario (es-AR)": agregar el carve-out del teléfono — la regla de coma decimal + punto de miles **no** aplica; display = `+54` + agrupación por código de área; almacenamiento = canónico `+54` + 10 dígitos sin separadores. Cubre: RTEL.13.1.

- [ ] **T21** — Autorrevisión adversarial del implementer + `progress/impl_telefono.md` con el mapa `RTEL.<n> → archivo:test` completo. Cubre: trazabilidad (docs/specs.md).

- [ ] **T21b** — Checklist de no-regresión y de restricciones declarativas, a verificar y dejar asentada en `progress/impl_telefono.md`: (a) ningún write nuevo al `phone` de otro usuario — el único sigue siendo el `UPDATE` self gateado por RLS (RTEL.11.3); (b) `members.ts` sigue sin proyectar `phone`/`email` de terceros (RTEL.11.5); (c) el teléfono se sigue pidiendo en los mismos momentos: no en signup, obligatorio al crear campo (RTEL.11.6); (d) **MEDIUM-3** — no se introdujo ningún uso de `user_private.phone` como clave de identidad, dedup de cuentas, recuperación de acceso o matching de invitación, ni índice/constraint de unicidad sobre esa columna; cualquier feature futura que lo requiera introduce `phone_kind` primero (RTEL.11.7, RTEL.11.8); (e) **MEDIUM-B** — la normalización tiene **un solo origen** (`app/src/utils/phone.ts`): confirmar que `PhoneField`, los services, `setUserPhone` y cualquier consumidor la **importan** y que no quedó ninguna reimplementación; declarar explícitamente que `RTEL.2.9` es pata de la aceptación de `R-7` y que debilitarla obliga a re-evaluar el riesgo (RTEL.2.9, RTEL.2.9.3). Cubre: RTEL.11.3, RTEL.11.5, RTEL.11.6, RTEL.11.7, RTEL.2.9, RTEL.2.9.3.

## Deploy (leader, no implementer)

- [x] **T22** — Tras Gate 1 (PASS) + reviewer (APPROVED) + Gate 2 (PASS): el **leader** aplica `0126` por MCP y verifica el conteo del `raise notice`. **Si abortó por residuo (MEDIUM-2):** ejecutar la query de reconciliación que da el propio mensaje de error, que devuelve **solo `user_id`**; corregir cada fila **por `user_id`**, **sin volcar la columna `phone` a ningún archivo, log, chat ni captura**; re-aplicar. Cubre: RTEL.7.4, RTEL.7.5.

  > **APLICADA a dev el 2026-07-18** (leader, con autorización de Raf). Se ejercitó la rama de aborto:
  > el primer intento **abortó por residuo** con `2 fila(s) ... no se pudieron normalizar` — el precheck
  > de DP3 funcionó como se diseñó y **no dejó el CHECK a medias**. Se siguió el protocolo MEDIUM-2 al
  > pie: reconciliación **por `user_id`**, sin volcar `phone` a ningún archivo/log/chat/captura (se
  > inspeccionó solo la **forma**, `regexp_replace(phone,'[0-9]','N','g')`). Ninguna de las dos filas era
  > interpretable (una de 9 dígitos de un usuario ya soft-deleteado; una de 12 que no empieza con `54` ni
  > matchea el patrón del `15`) → ambas a `NULL` (`phone` es nullable, `RTEL.5.4`) en vez de adivinar.
  > Segundo intento **OK**. **Verificación contra dev**: `user_private_phone_format_chk` **validado**
  > (no `NOT VALID`), **26 filas** con teléfono, **0 fuera de canónico**, `user_private_phone_len_chk` de
  > `0070` intacto, y los **6 tests del CHECK en VERDE con 0 skipped** — el auto-skip del §9bis punto 6
  > dejó de dispararse, que es el oráculo de que la migración entró de verdad.

- [ ] **T23** — Post-apply. **Backend: HECHO** — `supabase/tests/user_private` y `node scripts/check.mjs` corrieron **en verde** tras aplicar `0126`, ninguna suite quedó roja por el CHECK, y los 6 tests del CHECK pasaron sin skips (incluidos `RTEL.14.5`, el `UPDATE` de email sobre fila con teléfono canónico, y `RTEL.14.6`, los vectores de inyección con el salto de línea final). **Falta solo**: la **suite E2E completa** + las **capturas del Gate 2.5** (`telefono.spec.ts` y `telefono.capture.ts`, escritos y nunca ejecutados), que requieren `pnpm e2e:build` — bloqueado mientras `app/dist` esté compartido con otra terminal. **Anexo LOW del Gate 1**: el backfill dispara `user_private_set_updated_at` (`0068:56-58`), así que las filas normalizadas **re-sincronizan por PowerSync** tras el apply. Es esperado e inocuo (mismo teléfono en forma canónica) — **no leerlo como anomalía de sync**. Cubre: RTEL.9.2, RTEL.9.3.

## Cierre (Puerta 2)

- [x] **T24** — Reconciliación al as-built: si algo cambió durante los gates, actualizar `{requirements,design,tasks}-telefono.md` **antes** de commitear (regla dura de `docs/specs.md`).

- [ ] **T25** — Folding al baseline (**solo en Puerta 2**, cuando ya no haya otro implementer sobre spec 01): puntero de este delta en el bloque "Deltas posteriores" de `design.md` + nota as-built de alto nivel bajo `R2.1` y `R3.8` de `requirements.md`, **sin reescribir los EARS** (ADR-028).
