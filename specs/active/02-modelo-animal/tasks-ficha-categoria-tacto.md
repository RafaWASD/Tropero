# Tasks (delta spec 02) — Fijar la categoría a mano + tacto reproductivo, desde la ficha

**Status**: `in_progress` — **TCT.1–TCT.32 en `[x]`** + 7 tasks agregadas en implementación (TCT.33–TCT.39,
al final). Implementa `requirements-ficha-categoria-tacto.md` + `design-ficha-categoria-tacto.md`.
**Gate 1 N/A — VERIFICADO** (TCT.31): `git diff supabase/migrations/ supabase/functions/` **vacío**; el único
archivo tocado bajo `supabase/` es `tests/reports/run.cjs`. **Gate 2 y Gate 2.5 SÍ.**

> **Orden por dependencia.** Las dos funcionalidades son independientes entre sí: se pueden implementar en dos
> runs (F1 = TCT.1–TCT.12, F2 = TCT.13–TCT.22) sin bloquearse. Dentro de cada una, el orden importa.
>
> **Colisiones con otras unidades en curso** (memoria `feedback_parallel_terminals`): hay una campaña de QA
> escribiendo en `progress/qa_maniobras-device.md` y otra unidad tocando `StickStatusIndicator.tsx` /
> `nav-target-bands*`. **Ninguna task de este delta toca esos archivos.** Marcadas ⚠️ las que tocan archivos
> compartidos de alto tránsito (`animals.ts`, `local-reads.ts`, `run-tests.mjs`, `animal/[id].tsx`,
> `_layout.tsx`): secuenciarlas o hacerlas en worktree aislado, y commitear solo este slice.

---

## Fase 1 — Lógica pura de la categoría (sin red, se testea primero)

- [x] **TCT.1** — `app/src/utils/animal-category.ts` (**colisión-safe**): **exportar** `ONE_YEAR_DAYS` y
  `TWO_YEAR_DAYS` (hoy `const` privados). Cambio estrictamente aditivo — no se toca `AGE_WINDOWS` ni ninguna
  función (ver design §2.3: extender `AGE_WINDOWS` regresionaría `imputeBirthDateForCategory`). — *infra de la
  fuente única de los cortes; habilita TCT.3.*

- [x] **TCT.2** — `app/src/utils/animal-category-picker.ts` (**colisión-safe**): `+ pickableCategories(
  catalog: SystemCategory[], sex: AnimalSex, isCastrated: boolean): SystemCategory[]` — filtra por sexo
  reusando `MALE_CATEGORY_CODES` / `FEMALE_CATEGORY_CODES` (que ya excluyen `cut` y `vaca_cabana`) y, para
  machos, por castración (`false` → ternero/torito/toro; `true` → ternero/novillito/novillo). Preserva el
  orden de entrada (`sort_order`). PURA. — *cubre RCM.2.2, RCM.2.3, RCM.2.4, RCM.2.5.*

- [x] **TCT.3** — `app/src/utils/category-pin.ts` (NUEVO, **colisión-safe**): `COHERENCE_WINDOWS` (construida
  con las constantes de TCT.1, con banner ANTI-DRIFT igual al de `animal-category.ts`) +
  `categoryAgeMismatch({ chosen, sex, birthDate, isCastrated, today })` → `null | { ageDays, expectedCode }`
  (`expectedCode` = `computeCategoryCode({ …, events: [] })`) + `canPinCategory({ status, isCut,
  optionCount })`. PURAS, `today` inyectable. — *cubre RCM.4.3, RCM.4.5, RCM.4.6, RCM.4.7, RCM.7.1, RCM.7.2.*

- [x] **TCT.4** — `app/src/utils/animal-category-picker.test.ts` (**existente, colisión-safe**) +
  `app/src/utils/category-pin.test.ts` (NUEVO): `node:test`. Picker: hembra 5 codes / macho entero 3 / macho
  castrado 3 / `cut` y `vaca_cabana` nunca / orden preservado / catálogo vacío → `[]`. Coherencia: cada code
  dentro y fuera de su ventana, **fronteras exactas** 364/365 y 729/730 d, `birthDate` null → `null`, code sin
  ventana → `null`. `canPinCategory`: activo+no-CUT+opciones → true; archivado / CUT / 0 opciones → false. —
  *cubre RCM.2.\*, RCM.4.3, RCM.4.5, RCM.4.7, RCM.7.1, RCM.7.2, RCM.2.6.*

## Fase 2 — Capa de datos y servicio de la categoría

- [x] **TCT.5** — `app/src/services/powersync/local-reads.ts` (**⚠️ compartido**):
  `+ buildSetCategoryOverrideUpdate(profileId, categoryId)` →
  `UPDATE animal_profiles SET category_id = ?, category_override = 1 WHERE id = ?`. **Un solo statement** (el
  trigger `0040` distingue revert vs override manual mirando el mismo UPDATE — design §2.4). Aserto de SQL
  exacto en `local-reads.test.ts`. — *cubre RCM.5.1, RCM.5.4.*

- [x] **TCT.6** — `app/src/services/category-pin-core.ts` (NUEVO, **colisión-safe**): `decideCategoryPin({
  chosen, derived })` con el write inyectado — `chosen.code === derived.code` → builder de **revert**
  (`buildRevertCategoryOverrideUpdate`, `override = 0`); distinto → builder de **fijación** (TCT.5); `chosen`
  sin id resuelto → error es-AR **sin escribir**; caso revert con `derived` irresoluble → error es-AR sin
  escribir. PURO (patrón `cut-service-core.ts`: los services value-importan el SDK y no son importables bajo
  `node:test`). — *cubre RCM.5.1, RCM.5.2, RCM.6.2, RCM.6.3, RCM.6.6.*

- [x] **TCT.7** — `app/src/services/category-pin-core.test.ts` (NUEVO, **colisión-safe**): `node:test` con
  fakes del resolve y del write — los 4 caminos de TCT.6 + que en los caminos de error **no se llame al
  write**. — *cubre RCM.5.1, RCM.5.2, RCM.6.2, RCM.6.3.*

- [x] **TCT.8** — `app/src/services/animals.ts` (**⚠️ compartido**): `+ setCategoryManual(profileId,
  chosenCode): ServiceResult<{ override: boolean; categoryCode: string }>` — resuelve `system_id` del perfil
  (`buildAnimalDetailQuery`), el `category_id` de `chosenCode` (`buildCategoryByCodeQuery`, activo) y la
  derivada (`resolveRevertCategory`, la MISMA resolución que "Quitar fijación"), y delega la decisión en
  `decideCategoryPin`. Todo desde el SQLite local (offline-safe). — *cubre RCM.6.1, RCM.6.4, RCM.6.5.*

## Fase 3 — UI de la categoría en la ficha

- [x] **TCT.9** — `app/src/components/CategoryPickerSheet.tsx` (NUEVO, **colisión-safe**): sobre
  `BottomSheetShell` (`title="Elegir categoría"`, sin buscador), molde `BreedPickerSheet`. Dos fases internas:
  `list` (filas ≥ `$touchMin`, check + borde `$primary` en la vigente) y `confirm` (pregunta + aviso de edad
  opcional + consecuencia + footer fijo `Cancelar`/`Confirmar`). Cerrar por cualquier vía cancela. Cero
  hardcode, a11y por helpers, `lineHeight` matcheado. — *cubre RCM.3.1, RCM.3.2, RCM.3.3, RCM.3.5, RCM.4.1,
  RCM.4.2, RCM.4.4, RCM.5.3, RCM.2.7, RCM.9.1.*

- [x] **TCT.10** — `app/app/animal/[id].tsx` (**⚠️ compartido**): fila **"Categoría"** en "Datos del animal",
  después de "Nacimiento" — molde `BreedRow` (valor + link "Cambiar" si editable; solo lectura si no; hint
  *"Quitá la marca CUT para cambiar la categoría."* cuando `isCut`). Carga del catálogo con
  `fetchRodeoCategoryCatalog(detail.rodeoId)` (blanda: si falla → `[]` → fila solo lectura). — *cubre RCM.1.1,
  RCM.1.2, RCM.1.3, RCM.1.4, RCM.2.1, RCM.2.6, RCM.7.1, RCM.7.2.*

- [x] **TCT.11** — `app/app/animal/[id].tsx` (**⚠️ compartido**): montaje del `CategoryPickerSheet` al ROOT
  (condicional, monta/desmonta con el estado de apertura — precondición 1 del shell) + handler `onPickCategory`
  con **optimismo en sitio** (`categoryCode`/`categoryName`/`categoryOverride` antes del await, revert al
  snapshot si falla, error inline) + refresh silencioso. La `CategoryOverrideCard` (RC6.4) **no se toca**:
  aparece sola por el optimismo. — *cubre RCM.5.\*, RCM.6.5, RCM.7.3, RCM.7.4, RCM.9.2, RCM.9.3, RCM.8.1.*

- [x] **TCT.12** — `scripts/run-tests.mjs` (**⚠️ compartido**): enganchar `category-pin.test.ts` y
  `category-pin-core.test.ts` en la lista de `client unit tests` (paths explícitos, no glob). Inserción
  quirúrgica junto a `cut-eligibility.test.ts` / `cut-service-core.test.ts`. — *infra de tests.*

## Fase 4 — Lógica pura del ofrecimiento de tacto

- [x] **TCT.13** — `app/src/utils/ficha-tacto-offer.ts` (NUEVO, **colisión-safe**):
  `resolveFichaTactoOffer({ status, sex, categoryCode, isCastrated, reproStatus, rodeoConfig })` →
  `'prenez' | 'aptitud' | null`. Compone **sin reimplementar**: `resolveManeuverGating` (capa rodeo) AND
  `appliesToAnimal` (capa animal) + `status === 'active'`; precedencia defensiva a `prenez`. PURA. — *cubre
  RTF.1.1, RTF.1.2, RTF.1.3, RTF.1.4, RTF.2.2, RTF.2.4.*

- [x] **TCT.14** — `app/src/utils/ficha-tacto-offer.test.ts` (NUEVO, **colisión-safe**): `node:test` con
  barrido de los 7 `ReproStatus` × {ternera, vaquillona, vaquillona_prenada, multipara, cut} × {male, female}
  × {active, sold} × {rodeo con/sin cada data_key}: (a) el resultado es siempre `'prenez' | 'aptitud' | null`;
  (b) **test de DISYUNCIÓN** — `appliesToAnimal('tacto')` y `appliesToAnimal('tacto_vaquillona')` nunca son
  ambos true; (c) rodeo sin data_key → `null`; (d) `rodeoConfig` vacío (irresoluble) → `null`; (e) macho /
  ternera / vaquillona apta sin servicio / CUT / archivado → `null`. — *cubre RTF.1.4, RTF.2.1, RTF.2.3,
  RTF.2.4.*

## Fase 5 — Pantalla de captura + CTA en la ficha

- [x] **TCT.15** — `app/app/animal/tacto.tsx` (NUEVO, **colisión-safe**): ruta full-screen con params
  `{ profileId, kind }`. Back robusto (`backOr` → `/animal/[id]`), header de identidad (`pickHeroIdentifier` +
  `CategoryBadge`), título por `kind`, y el paso: `TactoStep` (con `buckets`) o `TactoVaquillonaStep` —
  **consumidos de `app/maniobra/_components/` sin modificarlos**. `useBusyWhileMounted()` (anti-stacking del
  bastón). `busyRef` tomado antes de cualquier `await`. — *cubre RTF.4.1, RTF.4.2, RTF.4.5, RTF.4.6, RTF.4.7,
  RTF.10.1.*

- [x] **TCT.16** — `app/app/animal/tacto.tsx` (**colisión-safe**): resolución de los **buckets** —
  `fetchRodeoServiceMonths(detail.rodeoId)` devuelve `ServiceResult<number[] | null>` (`null` = sin
  configurar) → `const nMonths = r.ok && r.value ? r.value.length : null` →
  `effectiveSizeBuckets(nMonths, undefined)`. El `undefined` es la decisión: sin jornada no hay override de
  "¿medir tamaño?" → rige el default del rodeo; rodeo sin meses → `[]` → PREÑADA persiste `'large'`
  (DD-PSC-2). — *cubre RTF.4.3.*

- [x] **TCT.17** — `app/app/animal/tacto.tsx` (**colisión-safe**): **re-validación al montar** con
  `fetchAnimalDetail` + `resolveFichaTactoOffer` (no confía en el param `kind`); si ya no aplica → estado
  explicativo es-AR + salida, sin escribir. — *cubre RTF.4.4.*

- [x] **TCT.18** — `app/app/animal/tacto.tsx` (**colisión-safe**): persistencia con los servicios EXISTENTES
  `addTacto({ profileId, pregnancyStatus, eventDate: hoy })` / `addTactoVaquillona({ profileId, fitness,
  eventDate: hoy })` — **sin `session_id`**, sin crear ninguna `sessions`. Éxito → `router.back()`; fallo del
  write local → error accionable inline **sin navegar**. — *cubre RTF.5.1, RTF.5.2, RTF.5.3, RTF.5.4, RTF.5.5,
  RTF.5.6, RTF.6.1, RTF.6.2, RTF.10.2.*
  **AS-BUILT (P3, decisión de Raf en la Puerta 1)**: la fecha es HOY (`todayIsoLocal()`) **por default**, y un
  link secundario **"Fue otro día"** despliega el campo (`FormField` + `maskDateInput` + `validateEventDate`)
  para cargar un tacto atrasado — la capacidad que RTF.9 le saca a "Agregar evento". La pantalla pasa a
  envolverse en `KeyboardAvoidingShell` (lo exige el guard de teclado ante un `FormField`) y los pasos reciben
  `bottomPad = 0`.

- [x] **TCT.19** — `app/app/_layout.tsx` (**⚠️ compartido**): `+ <Stack.Screen name="animal/tacto" />` junto a
  `animal/baja`. — *infra de navegación.*

- [x] **TCT.20** — `app/app/animal/[id].tsx` (**⚠️ compartido**): (a) guardar el `RodeoDataKeyMap` COMPLETO de
  `fetchRodeoGating(detail.rodeoId)` en vez de solo el booleano `dientesEnabled` (que pasa a derivarse:
  `rodeoGating['dientes']?.enabled === true`) — un read, dos consumidores, **cero cambio** del gate de CUT;
  (b) CTA de tacto en `CurrentStateSection`, debajo de las filas reproductivas, con ícono `Stethoscope`, copy
  "Tacto de preñez" / "Tacto de aptitud", ≥ `$touchMin`, que navega a `animal/tacto`. — *cubre RTF.1.1,
  RTF.1.4, RTF.3.1, RTF.3.2, RTF.3.3, RTF.7.5.*

- [x] **TCT.21** — Verificar (sin código nuevo) que al volver de la captura la ficha refleja el tacto por
  **refresh silencioso**: evento en el historial, fila repro actualizada, transición de categoría del espejo
  C6 si el tacto fue positivo **y** `override = false`, y **sin** transición si `override = true`. Si algo no
  se refresca, el fix va acá. — *cubre RTF.7.1, RTF.7.2, RTF.7.3, RTF.7.4.*

- [x] **TCT.22** — `scripts/run-tests.mjs` (**⚠️ compartido**): enganchar `ficha-tacto-offer.test.ts`. —
  *infra de tests.*

## Fase 6 — Retiro del tacto sin gatear de "Agregar evento"

- [x] **TCT.23** — Barrido previo: `grep -rn "Tacto" app/e2e/` + `app/src/**` para inventariar quién depende
  de la card/`TactoForm` de `agregar-evento` (candidato: `events.spec.ts`). **Antes** de borrar. — *evita un
  rojo sorpresa de E2E.*

- [x] **TCT.24** — `app/app/agregar-evento.tsx` (**⚠️ compartido**): quitar la `TypeCard` "Tacto", el
  `TactoForm`, su estado (`pregnancyStatus`/`tactoDate`/errores), su rama de `onSubmit`, el `EventType`
  `'tacto'` y los imports que quedan huérfanos (`addTacto`, `PREGNANCY_OPTIONS`, `PregnancyStatus`). **No
  tocar** Servicio / Parto / Aborto ni el aviso suave reproductivo. — *cubre RTF.9.1, RTF.9.2, RTF.9.3.*

- [x] **TCT.25** — Ajustar los E2E que TCT.23 haya encontrado (el flujo de tacto se cubre ahora en
  `ficha-tacto.spec.ts`). — *no-regresión.*

## Fase 7 — Verificación del contrato de reportes (backend, read-only)

- [x] **TCT.26** — `supabase/tests/reports/run.cjs` (**⚠️ compartido, pero suite propia**): 3 casos nuevos,
  **sin tocar el schema** — (a) `tacto` con `pregnancy_status ≠ 'empty'` y **`session_id` NULL** sobre una
  hembra del conjunto servidas → `rodeo_pregnancy_kpi(rodeo, año).pregnant` la cuenta; (b) `tacto_vaquillona`
  `'apta'` con `session_id` NULL sobre una vaquillona sin veredicto → `rodeo_serviced_females` la incluye, y
  con `'no_apta'` la excluye; (c) ese mismo tacto **no** aparece en `session_event_summary` de ninguna sesión
  del rodeo. Convierte RTF.8 de "lo leí en el SQL" a "lo ejecuté y lo vi". — *cubre RTF.8.1, RTF.8.2, RTF.8.4,
  RTF.8.5.*

## Fase 8 — E2E, gates y cierre

- [x] **TCT.27** — `app/e2e/ficha-categoria.spec.ts` (NUEVO, **colisión-safe**) — Playwright web táctil real
  (`hasTouch: true` + `touchscreen.tap()`, `reference_rn_web_pitfalls`): (a) vaquillona → "Cambiar" → "Vaca
  multípara" → confirmación con consecuencia → Confirmar → badge del hero + card "Categoría fijada
  manualmente"; (b) volver a elegir la automática → la card desaparece; (c) ternera < 1 año → elegir "Vaca
  multípara" → **aparece el aviso de edad** → Confirmar igual; (d) hembra CUT → la fila NO ofrece "Cambiar".
  — *cubre RCM.1.2, RCM.3, RCM.4.1, RCM.4.2, RCM.4.4, RCM.5, RCM.7.2, RCM.7.4.*

- [x] **TCT.28** — `app/e2e/ficha-tacto.spec.ts` (NUEVO, **colisión-safe**): (a) vaquillona sin veredicto
  (rodeo con `tacto_vaquillona` ON) → CTA "Tacto de aptitud" → APTA → vuelve a la ficha → "Aptitud
  reproductiva: Apta" + evento en el historial + el CTA ya no está; (b) hembra servida (rodeo con `prenez` +
  `tamano_prenez` ON) → CTA "Tacto de preñez" → PREÑADA → tamaño → "Estado reproductivo: Preñada (…)";
  (c) macho y ternera → sin CTA; (d) "Agregar evento" ya no ofrece "Tacto" y sigue ofreciendo Servicio /
  Parto / Aborto. — *cubre RTF.3, RTF.4.1, RTF.4.3, RTF.5, RTF.7.2, RTF.7.5, RTF.2.3, RTF.9.*

- [x] **TCT.29** — **No-regresión de la manga**: correr `maniobra-carga.spec.ts` (tacto + aptitud en jornada)
  y confirmar que `TactoStep`/`TactoVaquillonaStep` siguen comportándose igual (se consumieron sin cambiar
  props ni lógica). — *cubre RTF.4.1 (cláusula "sin cambiar su comportamiento para la manga").*

- [x] **TCT.30** — **Veto de diseño del leader** (skill `design-review`) antes de mostrarle nada a Raf:
  capturas de la fila "Categoría", el sheet, la confirmación normal, la confirmación con aviso de edad, la
  fila CUT sin "Cambiar", los dos CTAs de tacto, `TactoStep` y `TactoVaquillonaStep` lanzados desde la ficha,
  y la ficha post-tacto. Chequear recorte de descendentes ("Categoría", "PREÑADA", "Vaquillona preñada"),
  targets ≥ 44 dp y jerarquía. Re-iterar con el implementer si no queda bien. — *Gate 2.5 (ADR-029).*

- [x] **TCT.31** — **Verificación de que Gate 1 no aplicaba**: `git diff supabase/migrations/
  supabase/functions/` **vacío** (el único cambio bajo `supabase/` es `tests/reports/run.cjs`). Dejarlo
  documentado en `progress/current.md` (ADR-019). — *cierre de gates.*

- [x] **TCT.32** — Reconciliar specs al as-built (regla dura de `docs/specs.md`): si en implementación cambia
  algún detalle, se refleja en estos 3 documentos **antes** de commitear. Después: `node scripts/check.mjs`
  verde + `pnpm e2e` de los specs tocados + reviewer + Gate 2 → recién ahí la Puerta 2 humana. — *cierre.*

---

## Tasks AGREGADAS en implementación (as-built, 2026-08-07)

- [x] **TCT.33** — `app/src/utils/category-pin.ts`: `+ resolveCategoryPinEffect({chosen, currentCode,
  currentOverride, derivedCode})` → `'noop' | 'pin' | 'unpin'`. PURA. Alimenta el COPY de la confirmación
  (RCM.5.3) y el no-op de RCM.3.4 con la MISMA regla que el write, **atada por un test de coherencia** que
  barre el producto cartesiano contra `decideCategoryPin`. — *cubre RCM.3.4, RCM.5.3.*

- [x] **TCT.34** — `app/src/utils/category-pin.ts`: `+ isPinnableCategoryCode(code)` +
  `CATEGORY_PIN_FORBIDDEN_CODES` (hoy: `cut`). PURA. La usa `setCategoryManual` para RECHAZAR sin escribir —
  segunda cerradura de RCM.2.4 en el borde donde se escribe (design §2.5-bis). Test que ata las dos listas:
  todo lo que `pickableCategories` OFRECE tiene que ser fijable. — *cubre RCM.2.4 (defensa en profundidad).*

- [x] **TCT.35** — `app/src/services/animals.ts`: `resolveRevertCategory` deriva con el `is_castrated` REAL
  del perfil (era `false` hardcodeado). Corrección NECESARIA para que RCM.5.2/P2 funcione en un macho
  castrado sin divergir de "Quitar fijación" (design §2.5-ter). — *cubre RCM.5.2, RCM.6.1.*

- [x] **TCT.36** — `app/e2e/ficha-tacto.spec.ts`: caso **OFFLINE** explícito (principio 3 de `CLAUDE.md`):
  `context.setOffline(true)` → tacto de aptitud + fijación de categoría sin red (la ficha refleja los dos al
  instante) → `setOffline(false)` → **oráculo SERVER**: el evento (con `session_id` NULL) y el pin
  (`override=true` + `category_id`) aterrizan. — *cubre RCM.9.2, RTF.10.2.*

- [x] **TCT.37** — `app/e2e/ficha-categoria.spec.ts`: casos de RCM.3.4 (tocar la vigente = no-op) y RCM.3.5
  (cerrar desde la confirmación cancela), los dos con **oráculo SERVER de "no escribió nada"** (la fila del
  perfil sigue con `override=false` y su `category_id` original). — *cubre RCM.3.4, RCM.3.5.*

- [x] **TCT.38** — `app/e2e/ficha-tacto.spec.ts`: RTF.7.4 asertado — sobre una hembra con la categoría
  FIJADA, un tacto POSITIVO **no mueve la categoría** (ni en el espejo ni en el server). — *cubre RTF.7.4.*

- [x] **TCT.39** — `app/e2e/events.spec.ts` (TCT.25 ampliada): los 6 tests que usaban la card "Tacto" como
  SETUP pasan a sembrar el tacto server-side pre-login (`seedReproductiveTactoEvent`), y el test **"C6
  espejo"** —que necesita un write LOCAL para probar el espejo— migra al **CTA de la ficha** (con un
  `service` sembrado para que la hembra cuente como servida y el rodeo con 3 meses de servicio para el
  sub-paso de tamaño). Además, 3 aserciones de badge se anclan por `aria-label` + `filter({visible:true})`:
  con la ficha abierta desde la LISTA, la pantalla de fondo queda montada aria-hidden con su propio badge y
  `.first()` resolvía a un nodo oculto. — *no-regresión de RTF.9.*

## Notas de ejecución

- **Dos runs independientes**: F1 categoría (TCT.1–TCT.12) y F2 tacto (TCT.13–TCT.25). Comparten solo
  `animal/[id].tsx` y `run-tests.mjs` → secuenciar esos dos archivos entre runs, no el resto.
- **Sin migraciones** (design §4): si aparece la tentación de tocar `supabase/migrations/`, es señal de que
  algo se salió del alcance → parar y consultar.
- **Orden mínimo viable**: TCT.1→4 (puro) · TCT.5→8 (datos+servicio) · TCT.9→12 (UI categoría) · TCT.13→14
  (puro tacto) · TCT.15→22 (ruta + CTA) · TCT.23→25 (retiro) · TCT.26 (reportes) · TCT.27→32 (E2E + gates).
- **Las 5 preguntas abiertas (P1–P5)** de `requirements-ficha-categoria-tacto.md` se resuelven en la Puerta 1,
  **antes** de arrancar: P1 y P2 cambian `pickableCategories` / `decideCategoryPin` (1–2 líneas cada una), P3
  agrega un campo de fecha opcional a `animal/tacto.tsx`, P4 revierte TCT.24, P5 agrega filas a
  `COHERENCE_WINDOWS`. Ninguna invalida la estructura de tasks.
</content>
</invoke>
