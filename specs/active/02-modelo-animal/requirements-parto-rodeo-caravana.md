# Spec 02 — Delta PARTO: RODEO + CARAVANA VISUAL DEL TERNERO (#4 / #1a) — Requirements (EARS)

**Status**: `spec_ready` — delta **Nivel B (ADR-028)** sobre spec 02 (feature `done`), **frontend-only** (el backend ya está deployado). El baseline NO se reescribe; este delta trae su propio set `{requirements,design,tasks}-parto-rodeo-caravana.md`.
**Fecha**: 2026-06-30.
**Autor**: spec_author.
**Fuente de verdad**: `specs/active/02-modelo-animal/context-parto-rodeo-caravana.md` (Gate 0 **auto-aprobado** por el leader en modo autónomo, 2026-06-30 — defaults del leader, **se confirman en Puerta 1**). Las decisiones D1–D5 vienen lockeadas en ese contexto; acá NO se re-deciden, se traducen a EARS.
**Origen**: correcciones del testeo en vivo con Facundo **#4** ("rodeo al parto") + **#1a** ("caravana visual al parto"). `docs/correcciones-prueba-en-vivo-2026-06-27.md`. Segundo cluster del segmento A (ternero), después de #15 (`cria-al-pie-alta`).
**Related**: `requirements-cria-al-pie-alta.md` (RCAP.7 — `register_birth` 6-arg con `p_calf_rodeo_id`/`p_calf_idv` ya deployado; RCAP.5 — picker de rodeo + leyenda; `LinkCalfPrompt.tsx`), `requirements-alta-form-refinamiento.md` (RAF2 — `sanitizeIdvInput`/es-AR en el alta). ADR-028 (delta-spec), ADR-029 (Gate 2.5 capturas), ADR-023 (tokens / sin hardcode), memoria `feedback_ux_basicos_sheets_forms`, `reference_es_ar_number_format`.

> **Gate 1 N/A**: este delta es **frontend-only** — NO toca `supabase/` (sin migración, schema, RLS, trigger ni RPC nuevo). El RPC `register_birth` **6-arg** (`0116`) y el servicio `registerBirth` (`RegisterBirthInput.calfRodeoId`/`calfIdv`) ya están deployados/listos por el delta #15. Confirmable con `git diff supabase/` vacío. El gate de seguridad relevante queda cubierto por el Gate 1 de #15 (que aprobó la RPC 6-arg).

> **Notación EARS** (`docs/specs.md`). **Numeración `RPRC.<n>`** ("Parto Rodeo Caravana") para no colisionar con `R<n>` (baseline), `RT2.<n>`, `RC6.<n>`, `RCUT.<n>`, `RPS.<n>`, `RAR.<n>`, `RAF2.<n>`, `RCF.<n>`, `RCAP.<n>`. IDs estables; cada hoja `RPRC.<n>.<m>` verificable por ≥1 test.

---

## Resumen

Dos correcciones del testeo en vivo, **ambas en el form de Parto** (`app/app/agregar-evento.tsx`, `eventType='birth'`), **sin tocar DB** (el RPC 6-arg ya valida server-side → **Gate 1 N/A**):

1. **#4 — Rodeo del ternero al parto.** Hoy los terneros heredan siempre el rodeo de la madre. Se agrega un **picker de rodeo a nivel parto** (uno para toda la camada): rodeo de la madre preseleccionado + leyenda "(Mismo rodeo que la madre)", editable a otro rodeo del **mismo sistema** del campo de la madre. Se pasa como `calfRodeoId` a `registerBirth` (ya soportado). Aplica a single y mellizos (el RPC toma un `p_calf_rodeo_id` escalar único).
2. **#1a — Caravana visual del ternero al parto.** Hoy solo se carga la caravana **electrónica** (tag, por ternero). Se agrega un campo de **caravana visual (idv)** que aparece **SOLO cuando hay 1 ternero** en la camada (el RPC toma un `p_calf_idv` escalar único). Se pasa como `calfIdv`. Con ≥2 terneros (mellizos), el campo NO se muestra y aparece una **nota** que remite a la ficha de cada ternero. El tag electrónico sigue **por ternero** (sin cambios).

---

## RPRC.1 — Rodeo del ternero al parto: picker a nivel parto (#4 / D1)

**RPRC.1.1** Cuando el operario elija el tipo de evento "Parto" (`eventType='birth'`) en `agregar-evento.tsx`, el sistema deberá mostrar un **picker de rodeo a nivel parto** (uno solo para toda la camada), dentro del form de parto.

**RPRC.1.2** El sistema deberá **preseleccionar** en el picker el **rodeo de la madre**.

**RPRC.1.3** Mientras la selección del picker **coincida** con el rodeo de la madre, el sistema deberá mostrar la leyenda **"(Mismo rodeo que la madre)"**.

**RPRC.1.4** Cuando la selección del picker **no coincida** con el rodeo de la madre, el sistema **no deberá** mostrar la leyenda "(Mismo rodeo que la madre)".

**RPRC.1.5** El sistema deberá permitir **editar** el rodeo del parto a otro rodeo del campo de la madre que sea del **mismo sistema productivo** que el rodeo de la madre.

**RPRC.1.6** El picker **no deberá** ofrecer rodeos de un **sistema productivo distinto** al del rodeo de la madre (filtro client-side por `systemId`, paridad con #15 `LinkCalfPrompt`).

**RPRC.1.7** El rodeo elegido deberá aplicar a **toda la camada** (single y mellizos): un único valor de rodeo para todos los terneros del parto (el RPC toma `p_calf_rodeo_id` escalar).

**RPRC.1.8** Si el rodeo de la madre **no figura** en la lista de rodeos elegibles disponibles (p.ej. el parto se registra sobre un animal de un campo distinto del activo, o el sistema del rodeo no se puede resolver localmente), entonces el sistema deberá preseleccionar el rodeo de la madre **sin ofrecer otras opciones** (no editable), mostrando la leyenda, sin romper el form. *(Decisión de criterio propio del leader — fallback conservador; el RPC re-valida con `23514`. A confirmar en Puerta 1, ver `design` §Decisiones de criterio propio.)*

> **[Reconciliación as-built RPRC.1.2/1.6/1.8]** El `rodeoId` + `systemId` de la madre se resuelven por **READ LOCAL** del perfil de la madre (`fetchMotherRodeoContext`, reusa `buildBirthOverlayContextQuery`) — uniforme para todo caller que pase `profileId`, offline (veto del leader: no depender de que cada caller pase el param del rodeo). Los params `rodeoId`/`rodeoName` de la ficha se conservan como seed/fallback del **nombre** a mostrar. El fallback no-editable (RPRC.1.8) lo encarna el helper puro `canEditCalfRodeo(eligible, motherRodeoId)`: editable solo si el rodeo de la madre figura entre los elegibles del campo activo; como `system_id` es catálogo global, ese guard es lo que evita ofrecer rodeos del tenant activo para una madre de otro campo. Ver `design` §1/§4/§6 reconciliados.

## RPRC.2 — Caravana visual del ternero al parto: campo idv solo single-calf (#1a / D2)

**RPRC.2.1** Mientras la camada tenga **exactamente 1 ternero**, el sistema deberá mostrar un campo **opcional** de **caravana visual (idv)** del ternero.

**RPRC.2.2** El sistema deberá **sanitizar en vivo** el input de caravana visual con `sanitizeIdvInput` (reúso de #15 / alta), sin clamp que oculte un error de tipeo.

**RPRC.2.3** Cuando la camada tenga **≥2 terneros** (mellizos), el sistema **no deberá** mostrar el campo de caravana visual.

**RPRC.2.4** Cuando la camada tenga **≥2 terneros**, el sistema deberá mostrar una **nota**: *"Las caravanas visuales de mellizos se asignan después desde la ficha de cada ternero."*

**RPRC.2.5** El sistema deberá mantener el **tag electrónico (caravana electrónica)** como dato **por ternero** dentro de cada card "Ternero N".
> **SUPERADA por el delta `bastoneo-captura-alta-parto` (RCF.6 generalizado, 2026-07-06)**: el tag electrónico por ternero ya **no es un campo tipeable** — se **captura por bastoneo** (CTA `TagScanCta` → `TagScanSheet` en **modo captura** `onSubmit`, con la carga manual anidada detrás de "¿Sin bastón?"), **un ternero a la vez** (ruteo por `scanCalfLocalId`), y queda read-only tras capturar (`CapturedTagRow`) con "Cambiar" para re-escanear. El `tag` por ternero **sigue fluyendo a `registerBirth` sin cambios**. Mismo patrón que la ficha (RCF.6) y el alta. Ver `design-caravana-ficha.md §10.6` + `impl_02-bastoneo-captura-alta-parto.md`.

## RPRC.3 — Paso de datos a `registerBirth` (D2 / restricción del RPC escalar)

**RPRC.3.1** Al confirmar el parto, el sistema deberá pasar el **rodeo efectivo del parto** (el elegido en el picker, o el de la madre si no se editó) como **`calfRodeoId`** a `registerBirth`.

**RPRC.3.2** Cuando la camada tenga **1 ternero** y el campo de caravana visual tenga un valor no vacío, el sistema deberá pasar ese valor como **`calfIdv`** a `registerBirth`.

**RPRC.3.3** Cuando la camada tenga **≥2 terneros**, el sistema **no deberá** pasar `calfIdv` a `registerBirth` (omitido/`null`), **aunque** el operario haya tipeado un idv antes de agregar el 2º ternero (no se filtra a mellizos).

**RPRC.3.4** El sistema **no deberá** alterar el resto del payload de `registerBirth` (lista de terneros con `sex`/`weightKg`/`tag` por `validateCalves`, `eventDate`, `motherProfileId`).

## RPRC.4 — Validación server-side (RPC ya deployado) + offline-first (D3)

**RPRC.4.1** El sistema deberá apoyarse en `register_birth` (6-arg, ya deployado) para **validar server-side** que el rodeo del ternero esté **activo**, **pertenezca al tenant de la madre** y sea del **mismo sistema productivo**; un rodeo inactivo / de otro tenant / de otro sistema deberá ser rechazado con `23514` (anti-IDOR / consistencia de categoría).

**RPRC.4.2** El sistema deberá apoyarse en `register_birth` para la **unicidad parcial** `(establishment_id, idv)` y la **inmutabilidad** del idv; el cliente no re-implementa esa validación.

**RPRC.4.3** Si el rodeo elegido o el idv son **rechazados al subir** (rodeo ajeno → `23514`; idv duplicado → `23505`), entonces el sistema deberá clasificar el rechazo como **permanente** (sin loop de reintento) y superficiarlo por el canal de status/error de la outbox (camino as-built de `registerBirth`/`uploadData`), sin perder el resto del trabajo.

**RPRC.4.4** El picker de rodeo, la **lectura local** de los rodeos elegibles (`useRodeo()`, SQLite local) y el **encolado** del parto deberán funcionar **sin conexión** (offline-first); la escritura va por la **outbox** de PowerSync (sin red nueva).

## RPRC.5 — Frontend-only, sin migración, no regresión (D3)

**RPRC.5.1** El delta **no deberá** introducir migraciones ni tocar `supabase/` (sin schema, RLS, triggers ni RPC nuevos): el RPC `register_birth` 6-arg y `RegisterBirthInput.calfRodeoId`/`calfIdv` ya existen (**frontend-only, Gate 1 N/A**, confirmable con `git diff supabase/` vacío).

**RPRC.5.2** El sistema deberá conservar **sin cambios** el resto del form de parto (fecha del parto, lista dinámica de terneros con sexo/peso, `validateCalves`, mínimo de 1 ternero, "Agregar/Quitar ternero", aviso suave reproductivo) y el resto de `agregar-evento.tsx` (peso, condición, observación, tacto, servicio, aborto).
> **Nota (delta `bastoneo-captura-alta-parto`)**: el **input** del tag electrónico por ternero cambió de campo tipeable a **bastoneo** (ver RPRC.2.5 superada); todo lo demás del form de parto queda sin cambios, y el `tag` sigue entrando a `validateCalves`/`registerBirth` por el mismo camino.

**RPRC.5.3** El cambio deberá cubrir el parto registrado **desde la ficha del animal** y **desde la maniobra** con **un solo cambio**, por compartir ambos la pantalla `agregar-evento.tsx`.

## RPRC.6 — Reúso de #15 y MUSTs de UI de campo (D4)

**RPRC.6.1** El picker de rodeo y el campo de caravana visual deberán **reusar los patrones de #15** (`LinkCalfPrompt.tsx` / `crear-animal.tsx`): selector de rodeo inline con leyenda "(Mismo rodeo que la madre)", filtro por sistema vía `useRodeo()`, `sanitizeIdvInput`, validación inline, tokens (ADR-023) — **sin inventar componentes nuevos** donde se pueda reusar.

**RPRC.6.2** El sistema deberá usar **solo tokens** del design system (sin hex/px hardcodeado, ADR-023 §4) y **es-AR** voseo en todo copy nuevo (picker, leyenda, label de idv, nota de mellizos).

**RPRC.6.3** Todo título / leyenda / valor con descendentes (g/p/y/j/q) del rodeo y la nota deberá renderizarse **sin recortarse** (`lineHeight` matcheado al `fontSize` en headings ≥`$6` y todo `Text` con `numberOfLines`).

**RPRC.6.4** El sistema deberá conservar la **validación inline** del form (borde rojo + error junto al campo, sin banner global que tape el título); el delta **no deberá** introducir un banner global de error nuevo.

## RPRC.7 — Gate 2.5 (ADR-029) + E2E de regresión (D5)

**RPRC.7.1** El implementer deberá entregar `app/e2e/captures/parto-rodeo-caravana.capture.ts` con **capturas nombradas** de cada estado: (a) **parto single** con rodeo picker + leyenda "(Mismo rodeo que la madre)" + campo de caravana visual; (b) **parto mellizos** (2 terneros) **sin** el campo de caravana visual + la **nota**; (c) **picker de rodeo abierto** (lista de rodeos del mismo sistema); (d) **rodeo cambiado** (la leyenda desaparece); (e) validación inline **si aplica** (ver `design` — este delta no agrega validación client-side nueva, así que (e) puede quedar N/A documentado).

**RPRC.7.2** El sistema deberá tener cobertura **E2E de regresión** del parto que verifique: el picker de rodeo aparece y aplica al confirmar; el campo de caravana visual aparece con 1 ternero y desaparece (con la nota) al agregar un 2º; el rodeo/idv elegidos llegan a `registerBirth`.

**RPRC.7.3** Cada `RPRC.<n>.<m>` deberá quedar mapeado a ≥1 test (unitario y/o E2E) en `progress/impl_parto-rodeo-caravana.md` (trazabilidad `docs/specs.md`).

---

## Trazabilidad context → requirements

Cada decisión D1–D5 y cada edge case del `context-parto-rodeo-caravana.md` queda cubierto por ≥1 `RPRC.<n>`:

| Caso / decisión del `context.md` | Requirement(s) |
|---|---|
| **D1** — picker de rodeo a nivel parto (toda la camada), rodeo madre preseleccionado + leyenda, editable mismo sistema | RPRC.1.1, RPRC.1.2, RPRC.1.3, RPRC.1.4, RPRC.1.5, RPRC.1.6, RPRC.1.7 |
| **D2** — caravana visual idv SOLO 1 ternero; nota con ≥2; tag electrónico sigue por-ternero | RPRC.2.1, RPRC.2.2, RPRC.2.3, RPRC.2.4, RPRC.2.5 |
| **D2** — `p_calf_idv`/`p_calf_rodeo_id` escalares → idv no se ofrece para mellizos | RPRC.3.2, RPRC.3.3, RPRC.1.7 |
| **D3** — frontend-only, sin migración, Gate 1 N/A | RPRC.5.1 |
| **D3** — RPC 6-arg valida rodeo (activo/tenant/sistema → 23514) e idv (único/inmutable) | RPRC.4.1, RPRC.4.2 |
| **D4** — reúso de patrones de #15 (`LinkCalfPrompt`/`crear-animal`): leyenda, filtro sistema, `sanitizeIdvInput`, es-AR, anti-recorte, validación inline, tokens | RPRC.6.1, RPRC.6.2, RPRC.6.3, RPRC.6.4 |
| **D5** — Gate 2.5: capture file con cada estado + E2E | RPRC.7.1, RPRC.7.2, RPRC.7.3 |
| Edge — mellizos: rodeo a todos; idv no se ofrece + nota; tag electrónico por ternero | RPRC.1.7, RPRC.2.3, RPRC.2.4, RPRC.2.5, RPRC.3.3 |
| Edge — rodeo de otro sistema / otro tenant → RPC rebota `23514` (filtro client + server) | RPRC.1.6, RPRC.4.1, RPRC.1.8 |
| Edge — idv duplicado / inmutable → RPC valida; rechazo offline vía `uploadData` | RPRC.4.2, RPRC.4.3 |
| Edge — offline (lectura local de rodeos, escritura outbox) | RPRC.4.4 |
| Edge — parto desde ficha vs. maniobra (misma pantalla, un cambio) | RPRC.5.3 |
| Alcance — no romper el resto del form de parto / `agregar-evento.tsx` | RPRC.3.4, RPRC.5.2 |
| Paso de datos — `calfRodeoId` siempre; `calfIdv` solo single-calf | RPRC.3.1, RPRC.3.2, RPRC.3.3 |

---

## Historial de refinamiento

- 2026-06-30 — Redacción inicial del delta (Gate 0 auto-aprobado por el leader en modo autónomo; defaults del leader, a confirmar en Puerta 1). Decisiones de criterio propio del `spec_author`/leader elevadas a Puerta 1 (detalle en `design-parto-rodeo-caravana.md` §Decisiones de criterio propio): (a) **RPRC.1.8** — fallback no-editable cuando el rodeo de la madre no figura en los rodeos elegibles del campo activo (parto sobre animal de campo distinto del activo); (b) **RPRC.2.5/3.3** — el campo de caravana visual aparece y se envía **solo con 1 ternero**, descartando un idv tipeado si después se agrega un mellizo (consecuencia de `p_calf_idv` escalar — decisión de criterio propio del leader marcada en D2); (c) **RPRC.7.1 (e)** — este delta no agrega validación client-side nueva (rodeo siempre válido por preselección; idv solo sanitizado, sin rechazo client-side: la unicidad la valida el server), por lo que la captura de "validación inline" puede quedar **N/A** documentada.
