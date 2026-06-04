baseline_commit: 655a200e4884b9b29161d849119acb37390213e8

# impl 02 — frontend C3.2b: PARTO (register_birth N terneros) + link a la MADRE (R14.7)

Feature: spec 02 frontend, chunk C3.2b (sub-decomposición del leader). Frontend PURO — el backend
reproductivo/parto ya existe (RPC `register_birth` 0045, puente `birth_calves`, transiciones server-side).
NO se tocan migraciones ni `supabase/`.

Estado: `01-identity-multitenancy` está `in_progress` (frontend de spec 02 se construye sobre el
sustrato de 01; spec 02 está `deferred` pero el frontend lo dirige el plan multi-sesión del leader,
ver `progress/current.md` bloque C3.2). La RPC y el puente ya están deployados al remoto.

## Plan (tasks de este run)

- **T0 — FIX carrera rodeo-default** (`app/app/crear-animal.tsx`): con 1 rodeo, `selectedRodeo` cae
  al único rodeo aunque `selectedRodeoId` aún no resolvió + gatear submit por `!selectedRodeo`.
- **T1 — `registerBirth`** (`app/src/services/events.ts`): wrapper de `supabase.rpc('register_birth')`.
- **T2 — form de PARTO** (`app/app/agregar-evento.tsx` + `event-input.ts`): tipo `'birth'`, lista
  dinámica de terneros (sexo requerido + peso + tag opcionales), `validateCalves` + `SEX_OPTIONS`.
- **T3 — link a la MADRE** (`app/src/services/events.ts` + `app/app/animal/[id].tsx`): `fetchMother`
  vía `birth_calves` → card tappable "Madre" tolerante a status ≠ active.

## Trazabilidad R<n> → test

- **R9 (parto crea N terneros vía register_birth)** → unit `event-input.test.ts`: `validateCalves`
  (lista vacía → error; 1 ternero sexo sin peso/tag → OK; mellizos 2 sexos distintos → OK; falta sexo
  → error; peso inválido → error; tag se limpia/null). E2E `events.spec.ts` "parto con mellizos":
  agrega un 2do ternero (Ternero 1 → Ternero 2), elige sexos, `Guardar evento` → `register_birth` →
  nodo "Parto" en el timeline de la madre.
- **R9.5 (mellizos, 1..N terneros)** → `validateCalves` (caso "mellizos 2 terneros"); E2E agrega un
  2do ternero (`Agregar otro ternero`) y verifica que aparecen los 2 en la tab Animales (fallback
  "recién nacido — pendiente de caravana").
- **R9.4 (tag duplicado → rollback atómico server-side)** → `classifyError` mapea 23505/unique+tag a
  `duplicate_tag` con copy accionable; el rollback total lo garantiza la RPC (cubierto en la suite
  backend `animal/run.cjs` T2.19 "register_birth con ternero intermedio inválido → rollback total").
- **R14.7 / R4.15 (link a la madre, tolerante a archivada)** → `fetchMother` vía `birth_calves`
  (NO filtra por status → madre vendida/muerta/transferida sigue enlazada). E2E: abrir un ternero →
  card "Madre" con el idv de la madre → tocarla → ficha de la madre (su idv visible, "Parto" en su
  timeline). `archivedLabel` (sold/dead/transferred → indicador; active → null).
- **R10 / deriveCurrentState (estado vigente tras el parto)** → `event-timeline.test.ts`
  deriveCurrentState: BIRTH posterior a un tacto → `{ kind:'empty', via:'birth' }`; **+ TAREA 2**:
  tacto y birth el MISMO día → birth gana por `created_at` (determinístico). E2E: tras el parto,
  "Estado reproductivo → Vacía · Hoy".

## Autorrevisión adversarial

Como revisor hostil, busqué activamente:

- **1 ternero vs N.** `validateCalves` exige ≥1 (lista vacía → error) y el form mantiene mínimo 1.
  Mono-ternero y mellizos cubiertos (unit + E2E mellizos). La RPC `register_birth` es uniforme 1..N.
- **Tag duplicado → rollback.** El cliente NO chequea unicidad (la RPC es la barrera, R9.4); un 23505
  se mapea a `duplicate_tag`. El rollback ATÓMICO server-side está testeado en la suite backend
  (T2.19). El cliente solo re-fetchea al volver — no deja terneros a medias.
- **Madre archivada (status ≠ active).** `fetchMother` NO filtra por status (R4.15): la madre vendida/
  muerta/transferida se enlaza igual, con indicador. La navegación a su ficha tampoco filtra (sin
  dead-end). `birth_calves` nunca apunta a un perfil hard-deleteado (R4.15 lo prohíbe).
- **RPC atómica + multi-tenant.** El cliente manda SOLO `motherProfileId` + fecha + terneros; el
  tenant lo deriva la RPC de la fila real de la madre + `has_role_in` (sin rol → 42501 → copy claro).
  NO se manda `establishment_id`. `created_by` por trigger. No `.select()` en inserts (la RPC devuelve
  escalar uuid, OK).
- **🔴 BUG REAL ENCONTRADO (fetchMother) — el link a la madre NUNCA funcionaba.** El nested embed
  `reproductive_events!inner(animal_profiles!inner(...))` es AMBIGUO: `reproductive_events` tiene TRES
  FKs a `animal_profiles` (`animal_profile_id` = madre, `calf_id`, `bull_id`) → PostgREST no sabe qué
  relación seguir → la query falla (PGRST201) y la card "Madre" no se mostraba (silenciosamente,
  fetchMother caía al error blando). Estaba ENMASCARADO por el flake de timing del paso 3 del E2E (el
  test nunca llegaba estable al paso 5). **Fix**: disambiguar con el nombre de columna FK →
  `animal_profiles!animal_profile_id!inner`. Verificado: el E2E navega a la madre correcta 5/5.
- **🔴 BUG REAL ENCONTRADO (cleanup E2E) — residuo en el remoto.** `birth_calves.calf_profile_id →
  animal_profiles(id)` NO tiene `ON DELETE CASCADE` (mig 0045) → el cleanup (CASCADE de establishments
  → animal_profiles) chocaba con ese FK y dejaba campo + usuario colgados. **Fix** en `e2e/helpers/
  admin.ts`: antes de borrar establishments, borrar los `reproductive_events` de sus animal_profiles
  → el FK `birth_event_id` (ON DELETE CASCADE) limpia `birth_calves` → el cascade ya puede completar.
  Verificado: 0 warnings de FK en 5x + suite completa.

## Nota — fix de desempate (created_at) plegado en este run

El flake del paso 3 del parto (la aserción "Vacía") era NO DETERMINÍSTICO: tacto y parto el mismo día
→ `deriveCurrentState` desempataba por `eventId` (UUID random) → ~50% mostraba "Preñada" del tacto en
vez de "Vacía" del parto. **Fix (TAREA 2)**: orden total real por `created_at`. Detalle en
`impl_02-frontend-c3.2a-tacto-servicio.md` (sección final). Con eso + el fix de `fetchMother` + el
robustecimiento del E2E (anclas por estado, filtro `visible:true` para las pantallas apiladas de Expo
Router en web), el test "parto con mellizos" pasa **5/5** con `--repeat-each=5`.

## Fix post-test de Raf (web) — GATE POR SEXO de los eventos reproductivos

Raf pegó testeando en web: el wizard "Agregar evento" ofrecía la sección **"Reproductivo"** (Tacto /
Servicio / Parto) también para animales **MACHO**. Esos tres eventos son SOLO de hembras (un torito/
toro/novillito/novillo/ternero no preña, no se le da servicio ni pare). **Fix (frontend puro)**:
`animal/[id].tsx#goToAddEvent` ahora pasa `sex: detail.sex` (`'male' | 'female'`) en los params de
navegación; `agregar-evento.tsx` lee `sex` de `useLocalSearchParams`, computa `isFemale = sex ===
'female'` (CONSERVADOR: macho o sexo ausente/desconocido → NO-hembra → sin reproductivo) y lo pasa a
`Step1ChooseType`, que renderiza la sección "Reproductivo" **solo si `isFemale`**. Para machos el paso 1
muestra solo "General" (Pesaje / Condición corporal / Observación). Defensa en profundidad: el único
setter de `eventType` a tacto/service/birth son las TypeCards del picker (ya ocultas) → no hace falta
lógica extra de submit. NO se tocó el backend ni las reglas de transición. Tests: E2E nuevo
`events.spec.ts` "macho: el paso 1 NO ofrece eventos reproductivos" (siembra macho → ficha → Agregar
evento → Tacto/Servicio/Parto + "Reproductivo" → `toHaveCount(0)`; Pesaje/Condición/Observación
visibles); los tests de hembra (reproductivo + parto) siguen verdes (espejo: la hembra SÍ ve
"Reproductivo"). check.mjs COMPLETO verde (anti-hardcode 0, client unit 296, RLS 17, Edge 36, Animal
28, Maniobras 13) + `pnpm e2e` **29/29**.

## Gating final C3.2 — AVISO SUAVE: PARTO sobre una hembra que NO figura preñada (no bloqueo)

**Por qué (decisión de Raf)**: un parto solo lo da una hembra preñada, PERO una hembra puede estar
preñada de verdad sin tener el tacto cargado (se olvidaron de registrarlo) → en la app figura "Sin
registrar". El parto en sí ya es prueba de la preñez. Entonces NO bloqueamos: avisamos **suave**
(confirmación, no error terracota) para que el operario confirme conscientemente. Si la hembra SÍ
figura preñada → sin aviso, guarda directo (comportamiento previo). Solo aplica al PARTO (tacto/
servicio NO llevan aviso). **Frontend PURO** — no toca backend, ni reglas de transición, ni la RPC.

**Mecanismo de confirmación (de dónde lo copié)**: extraje el patrón ya existente `confirmDestructive`
de `app/app/(tabs)/mas.tsx` (usado en toda la app para "¿seguro?": eliminar campo, logout, eliminar
cuenta) a un util compartido `app/src/utils/confirm.ts` (`confirmAction`), generalizado a confirmación
**SUAVE** (`destructive` default false → en native `style:'default'`, no rojo; en web es `window.confirm`,
el tono lo da el copy). Es el mismo mecanismo multiplataforma (web `window.confirm` / native `Alert.alert`)
ya canónico en el repo — NO un patrón nuevo. `mas.tsx` queda intacto con su copia local (deuda menor:
consolidarlo a `confirmAction` algún día; fuera de scope acá).

**Cambios (archivos tocados)**:
- `app/src/utils/event-input.ts` — `shouldWarnUnconfirmedBirth(eventType, pregnant)` (lógica PURA: true
  solo para `'birth'` + `pregnant !== true`; conservador: null/undefined → avisa) + copy
  `UNCONFIRMED_BIRTH_WARNING` / `UNCONFIRMED_BIRTH_CONFIRM_LABEL`.
- `app/src/utils/event-input.test.ts` — +4 tests de `shouldWarnUnconfirmedBirth` (preñada → no avisa;
  no preñada → avisa; indeterminado null/undefined → avisa; tacto/servicio/peso/condición/observación
  nunca avisan).
- `app/src/utils/confirm.ts` — **nuevo** `confirmAction({title,message,confirmLabel,cancelLabel?,
  destructive?})` (web `window.confirm` fail-closed sin window; native `Alert.alert` con botones).
- `app/app/animal/[id].tsx` — `goToAddEvent` pasa `pregnant: pregnant ? '1' : '0'` donde `pregnant =
  deriveCurrentState(timeline).pregnancy?.kind === 'pregnant'` (MISMO cálculo que alimenta la fila
  "Estado reproductivo" — reuso del timeline ya cargado; dep `timeline` agregada al useCallback).
- `app/app/agregar-evento.tsx` — lee `pregnant` del param (`figuresPregnant = params.pregnant === '1'`);
  en el submit del branch `birth`, DESPUÉS de validar fecha+terneros y ANTES de `registerBirth`, si
  `shouldWarnUnconfirmedBirth('birth', figuresPregnant)` → `confirmAction(...)`; cancela → `return`
  (form intacto, botón usable); confirma → procede. Re-entrancy guard (`busyRef`) tomado ANTES del
  diálogo (cubre el doble-tap del Alert async en native) y liberado si cancela; `setSubmitting` (visual)
  solo tras confirmar. UNA sola llamada a `registerBirth` (sin duplicar el camino preñada/no-preñada).

**Trazabilidad (gating final)** → test:
- *aviso suave en hembra no preñada* → unit `event-input.test.ts` (`shouldWarnUnconfirmedBirth`: 4 casos)
  + E2E `events.spec.ts` "parto en hembra NO preñada: aparece el aviso suave → al confirmar crea el
  parto (no bloqueo)" (siembra hembra SIN tacto → Sin registrar → Parto → "Guardar evento" dispara el
  `window.confirm`; el handler `page.once('dialog')` asierta el copy `/no figura preñada/i` +
  `/registrar el parto igual/i` y lo ACEPTA → nodo "Parto" + estado "Vacía").
- *hembra preñada NO ve aviso (guarda directo)* → E2E `events.spec.ts` "parto en hembra PREÑADA: NO
  aparece aviso → guarda directo" (tacto Cabeza → figura preñada → Parto guarda sin confirm; un
  `page.on('dialog')` que FALLARÍA si apareciera; aserto final `unexpectedDialog === false`). El test
  "parto con mellizos" existente también ejercita el camino preñada (tacto previo) y sigue verde.

**Autorrevisión adversarial (revisor hostil)**:
- *Coherencia con la fila "Estado reproductivo"*: `goToAddEvent` recomputa `deriveCurrentState` del
  MISMO `timeline` que la fila → un único origen de verdad; lo que el operario VE (Preñada/Sin
  registrar) es exactamente lo que decide el aviso. ✓
- *Estado indeterminado / deep-link*: si el wizard se abre sin pasar por la ficha (`params.pregnant`
  undefined) → `figuresPregnant=false` → avisa (conservador, testeado). ✓
- *Doble-submit durante el Alert (native)*: el guard `busyRef` se toma antes del diálogo y se libera al
  cancelar; `onSubmit` arranca con `if (busyRef.current) return`. Sin esto un doble-tap abriría un 2do
  Alert. ✓ (corregido en autorrevisión: 1ra versión tomaba el guard recién después de confirmar).
- *No-duplicación de `registerBirth`*: 1ra versión del fix duplicó la llamada RPC en el branch del
  aviso; refactorizado a una sola llamada compartida. ✓
- *Seguridad / multi-tenant*: NO toca backend; `pregnant` es solo un hint de UX; el tenant lo sigue
  derivando la RPC server-side; el aviso NO altera el payload del insert; fail-closed si no hay
  `window.confirm`. ✓
- *Alcance*: el aviso es EXCLUSIVO del parto (`shouldWarnUnconfirmedBirth` devuelve false para todo lo
  demás); tacto/servicio/peso/condición/observación nunca avisan (testeado). ✓
- *No es un bloqueo*: es confirmación "Registrar igual" → procede; NO terracota, NO "no podés". ✓

**Verificación**: `node scripts/check.mjs` COMPLETO verde (anti-hardcode 0, typecheck OK, client unit
**300**, RLS 17, Edge 36, Animal 28, Maniobras 13) + `pnpm.cmd e2e` **31/31** (29 previas + 2 nuevas del
aviso) + los 2 tests del aviso 5/5 con `--repeat-each=5` (no-flaky).

---

## Gating reproductivo C3.2 — ABORTO + avisos servicio/aborto + flag "Tuvo aborto" (implementer, baseline `655a200`)

Frontend PURO. El backend reproductivo ya tiene el enum `event_type='abortion'` (`reproductive_events`,
migration `0026`); `deriveCurrentState` ya trataba `abortion` como determinante de preñez (→ "Vacía") y el
trigger server-side ya revierte la preñez de la categoría. NO se tocó `supabase/`, ni migraciones, ni
reglas de transición. 3 tareas que Raf pidió.

### TAREA 1 — Evento ABORTO (nuevo tipo reproductivo)
- **`app/src/services/events.ts`** — `addAbortion({ profileId, eventDate, notes? })`: insert mínimo en
  `reproductive_events` `{ animal_profile_id, event_type:'abortion', event_date }` (+ notes si viene),
  MISMO patrón que `addTacto` (SIN `.select()`, `created_by` por trigger, tenant por RLS). Input tipado
  (`AddAbortionInput`). Doc del efecto colateral server-side (revierte preñez de la categoría) + del flag
  derivado (no es columna de estado).
- **`app/app/agregar-evento.tsx`** — `EventType` += `'abortion'`; 4ta TypeCard **"Aborto"** en la sección
  "Reproductivo" (ya gateada a hembras), ícono `HeartCrack` (corazón roto = PÉRDIDA, distinto del `Baby`
  del parto), subtítulo "Pérdida de la preñez"; `AbortionForm` (fecha prefill hoy `maskDateInput` +
  `validateEventDate` + `NotesField` reusado para notas OPCIONALES); título del paso 2 "Aborto"; rama de
  submit `abortion` (valida fecha + notas opcionales → `addAbortion`). Ícono `HeartCrack` al import lucide.
- **`app/src/components/TimelineEvent.tsx`** — el caso `reproductive` con `eventType==='abortion'` rama a
  **acento `$terracota` + ícono `HeartCrack`** (señal médica/pérdida, igual que los sanitarios); tacto/
  servicio/parto siguen con `$primary` + `Baby`. Título via `humanizeReproEventType` (ya devuelve
  "Aborto"). El halo terracota cae a `$surface` (no hay token terracota-claro — mismo criterio existente).

**Ícono/acento elegidos para el aborto**: `HeartCrack` (lucide) + acento **terracota**. Razón: el aborto
es una PÉRDIDA / evento médico — el corazón roto comunica pérdida (no nacimiento) y el terracota es la
señal médica/alerta de la paleta (ya usada por los sanitarios). Distinto del `Baby`/primary del parto.

### TAREA 2 — Avisos suaves de servicio y aborto (generalizados)
- **`app/src/utils/event-input.ts`** — `reproductiveWarning(eventType, pregnant): { message, confirmLabel }
  | null` (PURO). Ramas que avisan: `birth`|`abortion` + NO preñada → "no figura preñada, ¿registrar el
  {parto/aborto} igual?"; `service` + SÍ preñada → "figura preñada, ¿registrar el servicio igual?";
  cualquier otro caso → null. Copys nuevos: `UNCONFIRMED_ABORTION_WARNING`, `SERVICE_ON_PREGNANT_WARNING`,
  `REPRODUCTIVE_WARNING_CONFIRM_LABEL` (= "Registrar igual"). `shouldWarnUnconfirmedBirth` conservado
  (delega en `reproductiveWarning` → el parto anda IDÉNTICO); `UNCONFIRMED_BIRTH_WARNING`/
  `UNCONFIRMED_BIRTH_CONFIRM_LABEL` siguen exportados (compat/tests).
  - Cómo quedó `reproductiveWarning` (semántica): `birth`/`abortion` con `pregnant !== true` (incluye
    null/undefined = conservador, ante la duda avisa) → aviso; `service` con `pregnant === true` → aviso;
    `service` con NO preñada/indeterminado → null (un estado desconocido NO es "figura preñada"); tacto/
    pesaje/condición/observación → siempre null.
- **`app/app/agregar-evento.tsx`** — helper local `confirmReproIfNeeded()` en `onSubmit`: llama
  `reproductiveWarning(eventType, figuresPregnant)`; si hay aviso → `confirmAction({title,message,
  confirmLabel})` (mecanismo canónico web `window.confirm` / native `Alert`). Aplicado en los branches de
  **tacto/servicio/parto/aborto** ANTES de llamar al service. Re-entrancy: cada branch toma `busyRef.
  current = true` SINCRÓNICAMENTE (antes del `await`) y `confirmReproIfNeeded` LIBERA el guard si el
  operario cancela (anti doble-tap del Alert async en native). El branch del parto reemplazó su lógica
  inline por el helper (mismo comportamiento). Título del diálogo por tipo (`REPRO_DIALOG_TITLE`).

### TAREA 3 — Flag "Tuvo aborto" en la ficha (A2, marquita roja)
- **`app/src/utils/event-timeline.ts`** — `hasAbortion(timeline): boolean` (PURO): true si hay ≥1
  reproductive con `eventType==='abortion'`. Permanente (no se "limpia" por una preñez posterior — es
  historia). Vacío/null → false.
- **`app/app/animal/[id].tsx`** — `AbortionFlag` (chip terracota: borde+texto `$terracota` + ícono
  `HeartCrack` sobre `$surface`, a11y por `labelA11y`) en el hero junto al `CategoryBadge` si
  `hasAbortion(timeline)`. `AnimalHero` recibe `hadAbortion`. Tokenizado (cero hardcode).
- **El flag en la LISTA** → `docs/backlog.md` (2026-06-04): requiere extender la query del listado
  (`services/animals.ts`) con un flag `had_abortion` por animal (la lista hoy no trae los eventos repro).

### Trazabilidad (R/feature → test)
- **Aborto crea evento repro** → `addAbortion` (shape implícito, mismo patrón verificado por la suite
  Animal/RLS); E2E `events.spec.ts` "aborto: cargar un aborto …" (insert real contra el remoto → nodo
  "Aborto" en el timeline).
- **Aborto deja "Vacía"** → unit `event-timeline.test.ts` "deriveCurrentState: ABORTION → vacía (via
  abortion)" (ya existía, confirmado que sigue) + E2E (estado reproductivo "Vacía · …" tras el aborto).
- **`reproductiveWarning` (3 ramas + null)** → unit `event-input.test.ts` (+8 tests). E2E: "servicio en
  hembra PREÑADA → aviso → confirma → registra" + "servicio en hembra NO preñada → SIN aviso, directo".
- **`hasAbortion` (true/false/permanente)** → unit `event-timeline.test.ts` (+5 tests). E2E: flag "Tuvo
  aborto" visible en el hero tras cargar el aborto.

### Autorrevisión adversarial (paso 8) — qué busqué, qué encontré, cómo lo cerré
Como revisor hostil:
- **🔴 REGRESIÓN REAL que YO introduje y cacé con el E2E**: el test pre-existente "reproductivo: tacto …
  → servicio" registra un servicio sobre una hembra que figura PREÑADA (tacto Cuerpo previo). Con la
  TAREA 2 ese servicio AHORA dispara el aviso "figura preñada, ¿registrar igual?" → Playwright
  auto-dismiss el `window.confirm` → el servicio NO se guardaba → el test quedaba trabado en el form (el
  snapshot lo confirmó). **Es el comportamiento nuevo CORRECTO**, no un bug: actualicé el test para
  ACEPTAR el dialog (`page.once('dialog')` + assert "figura preñada") y robustecí sus aserciones con
  `.filter({ visible: true })`. Verde 5/5.
- **Doble-tap durante el Alert (native)**: el guard se toma SINCRÓNICAMENTE antes del `await` (sin gap de
  microtask) y se libera solo si cancela. 1ra versión lo tomaba DENTRO del helper (con gap) → lo moví al
  caller. ✓
- **Aborto el mismo día que un tacto**: `deriveCurrentState` desempata por `created_at` (el aborto,
  insertado después, gana → "Vacía", determinístico). E2E lo ejercita, 5/5. ✓
- **Flag permanente**: una preñez posterior a un aborto NO limpia el flag. Test unit explícito. ✓
- **`service` con estado indeterminado → NO avisa** (un estado desconocido ≠ "preñada"). Test unit. ✓
- **Multi-tenant / seguridad**: `addAbortion` NO manda `establishment_id` (tenant por RLS), `created_by`
  por trigger, insert SIN `.select()`, sin ids hardcodeados. `pregnant` es solo hint de UX. `abortion`
  confirmado en el enum 0026 (el E2E real lo prueba end-to-end por RLS). ✓
- **a11y / anti-hardcode**: `AbortionFlag` usa `labelA11y` + `getTokenValue`; TypeCard/AbortionForm reusan
  componentes a11y-safe. 0 violaciones. ✓
- **Tests por la razón correcta**: "service preñada" falla si el dialog NO aparece (`expect.poll` →
  timeout); "service no preñada" falla si CUALQUIER dialog aparece (`unexpectedDialog`). No vacuos. ✓

### Conteos finales (verificados por el implementer)
- **`node scripts/check.mjs` COMPLETO**: VERDE. anti-hardcode **0**; typecheck cliente OK; client unit
  **313/313** (300 + 8 `reproductiveWarning` + 5 `hasAbortion`); RLS **17/17**; Edge **36/36**; Animal
  **28/28**; Maniobras **13/13**.
- **`pnpm.cmd e2e`**: **34 passed / 0 failed** (31 previas + 3 nuevas: aborto + servicio-preñada +
  servicio-no-preñada; la pre-existente "reproductivo → servicio" actualizada al aviso nuevo).
- **`--repeat-each=5`** de los 3 nuevos + el modificado ("reproductivo"): **20/20** (no-flaky).

Archivos tocados (frontend + tests + e2e + backlog, cero backend/migraciones): `app/src/services/events.ts`,
`app/src/utils/event-input.ts`, `app/src/utils/event-timeline.ts`, `app/src/components/TimelineEvent.tsx`,
`app/app/agregar-evento.tsx`, `app/app/animal/[id].tsx`, `app/src/utils/event-input.test.ts`,
`app/src/utils/event-timeline.test.ts`, `app/e2e/events.spec.ts`, `docs/backlog.md`.
