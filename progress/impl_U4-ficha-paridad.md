baseline_commit: cf791e4e439f7479e46c3b50d042c40c9e42bedb

# U4 — Ficha de animal incompleta (auditoría de paridad card ↔ ficha)

Tanda `docs/plan-mejoras-2026-07-20.md`, Tier-2. Reporte de Raf:
(a) los **dientes** NO se muestran en el "estado actual" de la ficha;
(b) datos que SÍ aparecen en la **card** del listado (ej. "vacía") NO aparecen en la ficha.

Enfoque = AUDITORÍA DE PARIDAD (no parche campo por campo).

## Alcance (restricciones de la tarea)
- SÍ: ficha `app/app/animal/[id].tsx` (+ helpers puros + query del detalle + AnimalDetail).
- Lectura: componente de card `app/src/components/AnimalRow.tsx` + `repro-status.ts`.
- NO tocar: BLE, reportes/vacunas/invitación/tab-layout (units en paralelo). No commitear. No check.mjs full.

---

## Tabla de paridad CARD ↔ FICHA (as-found)

La "card" = `AnimalRow` (dos variantes):
- NO-compact (tab **Animales**, `(tabs)/animales.tsx`): muestra reproStatus chip.
- compact (vista de grupo rodeo/lote, `rodeo/[id].tsx` / `lote/[id].tsx`): NO muestra reproStatus; muestra "categoría · edad".

| Dato de la card | Card | Ficha (as-found) | ¿Brecha? |
|---|---|---|---|
| Identificador hero (apodo/idv/tag) | sí | AnimalHero | — |
| Caravana secundaria (#idv cuando apodo hero) | sí | AnimalHero | — |
| Sexo (glifo / ícono) | sí | AnimalHero + "Datos del animal" | — |
| CategoryBadge (color CUT) | sí | AnimalHero CategoryBadge | — |
| Rodeo | sí | AnimalHero + "Datos del animal" | — |
| Chip "En tratamiento" | sí | AnimalHero TreatmentFlag + TreatmentsSection | — |
| ⭐ Futuro torito | sí (algunas listas) | ManagementSection (machos) | — |
| Chip "Sin electrónica" | sí | "Identificación" (caravana electrónica) | — |
| **reproStatus chip** (Apta/Preñada/Vacía/Diferida/Servida sin tacto/No apta[cut]/Sin evaluar) | sí (single-slot `detail.reproStatus`) | "Estado reproductivo" SOLO cubre preñez(timeline)+served_untested → **cut/unknown caían en "Sin registrar"; empty/pregnant dependían del TIMELINE (deriva distinta de `detail.reproStatus`)** | **SÍ (b)** |
| Edad legible ("3 años") | sí (compact) | "Nacimiento" (fecha cruda) | menor (derivable; ver decisión) |
| **Dientes** (teeth_state) | NO la muestra | NO se muestra en ninguna parte de la ficha | **SÍ (a)** — pedido explícito de Raf |

### Detalle de la brecha (b) — estado reproductivo
La card usa `detail.reproStatus` = `deriveReproStatus(...)` (single-slot, precedencia none/cut/pregnant/empty/served/fitness/unknown), computado desde `loadReproBadgeEvents`.
La ficha "Estado reproductivo" (as-found) NO usaba `detail.reproStatus` como fuente: recomputaba la preñez con `deriveCurrentState(fetchTimeline)` y solo caía a `reproStatus` para `served_untested`. Consecuencias:
- `cut` → la ficha mostraba "Sin registrar" (la card: "No apta").
- `unknown` (no-vaquillona) → "Sin registrar" (la card: "Sin evaluar").
- `empty`/`pregnant` → dependían de que el TIMELINE derivara la misma preñez que las badge-events. Ambas son lecturas locales pero **usan tie-breaks distintos** a igualdad de `(event_date, created_at)` (el timeline usa `seq` de la query; `deriveReproStatus` pasa por `toTimelineItems` con eventId por índice) → en el borde "tacto + parto/aborto el mismo día" pueden **divergir** → la card decía "Vacía" y la ficha "Sin registrar". Este es el reporte concreto de Raf.

### Brecha (a) — dientes
`teeth_state` es una columna enum (`teeth_state_enum`, 0020) de `animal_profiles` que la maniobra DIENTES sobreescribe (`buildSetTeethStateUpdate`). NO es evento (no está en el timeline), NO es custom attribute (no lo renderiza `CustomPropertiesFicha`). `AnimalDetail` ni siquiera lo traía → la ficha nunca lo mostró.

---

## FIX (as-built)

1. **`repro-status.ts`** — helper PURO `reproStateRowDisplay(reproStatus, hasPregnancyEvent, aptitudeShown)` que decide qué muestra la fila "Estado reproductivo" de la ficha, anclado en `detail.reproStatus` (paridad total con el chip de la card). Devuelve:
   - `{kind:'pregnancy'}` cuando hay evento determinante de preñez Y el estado es pregnant/empty → el caller enriquece con término entre paréntesis + fecha (más detalle que el chip).
   - `{kind:'label', label}` con el MISMO literal es-AR del chip (`reproStatusLabel`) para served_untested/cut, y fallback pregnant/empty sin fecha.
   - `{kind:'none'}` para fitness/unknown cuando la fila "Aptitud reproductiva" ya se muestra (vaquillona) — no duplicar el veredicto; y para `none` (macho/ternera).
   Aditivo: NO cambia la ruta ya-verde (birth→"Vacía · fecha") — la conserva.

2. **`services/animals.ts`** — `AnimalDetail.teethState: string | null`; `LocalDetailRow.teeth_state`; mapeo `teethState: row.teeth_state ?? null` en `fetchAnimalDetail`.

3. **`services/powersync/local-reads.ts`** — `buildAnimalDetailQuery` proyecta `ap.teeth_state AS teeth_state` (synced) + `NULL AS teeth_state` (overlay: `pending_animal_profiles` no tiene la columna; un alta optimista muestra los dientes recién al sincronizar, igual patrón que is_cut=0).

4. **`app/app/animal/[id].tsx`** — `CurrentStateSection`:
   - Nueva fila "Dientes" (después de "Condición corporal") cuando `teethState != null`, con `teethLabel(teethState)`. Condicional (no siempre visible) para no meter ruido en rodeos que no trackean boca.
   - `reproValue` reescrito sobre `reproStateRowDisplay(...)` (paridad).

### Decisión: edad
No se agrega una fila "Edad" separada. La ficha ya muestra "Nacimiento" (fecha exacta, más información que la edad derivada de la card compact). La edad es un derivado de conveniencia de la card, no un dato ausente. Se documenta como N/A de la brecha (no es dato faltante).

### Decisión: dientes condicional
La fila "Dientes" se muestra solo si hay valor (`teethState != null`), a diferencia de Peso/Condición que siempre muestran "Sin registrar". Motivo: dientes es rodeo-gated (data_key `dientes`); mostrarlo siempre metería "Dientes: Sin registrar" en todo animal de un rodeo que no trackea boca. Menos ruido, respeta el diseño.

---

## Trazabilidad (brecha → test)
- (a) Dientes en Estado actual → E2E `ficha-paridad.spec.ts` (asserta "Dientes" + label) + unit del mapeo (query proyecta teeth_state).
- (b) reproStatus paridad → unit `repro-status.test.ts` (`reproStateRowDisplay`) + E2E (tacto vacía → ficha muestra "Vacía").

## Verificación
- Unit: `repro-status.test.ts` + `local-reads.test.ts` + `animals` (mapper).
- E2E web: `ficha-paridad.spec.ts` (:8099 + Supabase remoto + PowerSync).
- Capture: `captures/ficha-paridad.capture.ts`.
- NO check.mjs full ni suites remotas (por restricción de la tarea + terminales en paralelo).

## Auditoría de paridad COMPLETA (card `AnimalListItem`/`AnimalRow` → ficha)
Enumerados TODOS los campos que respaldan la card (`AnimalListItem`):
| Campo card | En la ficha | ¿Cerrado? |
|---|---|---|
| idv / apodo / rodeoUsesApodo / tagElectronic | AnimalHero (hero + secundaria) + Identificación | ya estaba |
| categoryCode / categoryName (CategoryBadge, color CUT) | AnimalHero | ya estaba |
| sex | AnimalHero + "Datos del animal" | ya estaba |
| rodeoName | AnimalHero + "Datos del animal" | ya estaba |
| status | ArchivedBadge | ya estaba |
| managementGroupId | LoteControl | ya estaba |
| animalBirthDate | "Nacimiento" (fecha exacta) | ya estaba (ver decisión edad) |
| futureBull | ManagementSection ⭐ (machos) | ya estaba |
| inTreatment | TreatmentFlag + TreatmentsSection | ya estaba |
| **reproStatus** | "Estado reproductivo" | **CERRADO (b)** — ahora anclado en `detail.reproStatus` |
| **teeth_state** (NO en la card; pedido de Raf) | "Estado actual" fila "Dientes" | **CERRADO (a)** — nuevo |
→ Ninguna otra brecha. La única diferencia restante (edad derivada vs fecha de nacimiento) es N/A: la ficha muestra el dato superset (fecha exacta).

## Autorrevisión adversarial
Busqué como revisor hostil:
- **Brecha no cubierta**: recorrí `AnimalListItem` completo (arriba). Todo campo de la card está en la ficha. ✔
- **Exhaustividad de `reproStateRowDisplay`**: switch sobre las 7 kinds de `ReproStatus` sin `default` → si se agrega una kind, tsc falla (todos los paths deben retornar). Compile-safe. ✔
- **Regresión de los E2E existentes de la ficha**: analicé cada assert de `events.spec`/`animals.spec` sobre "Estado reproductivo": (a) male → `toHaveCount(0)` (la fila sigue female-only) ✔; (b) vaquillona apta/diferida → la fila Aptitud muestra el veredicto y "Estado reproductivo" cae a "Sin registrar" (fitness+aptitudeShown → `none`), IDÉNTICO al comportamiento previo (fitness → null) ✔; (c) preñada (cabeza) → ruta pregnancy enriquecida, sin cambio ✔; (d) vacía tras parto → ruta pregnancy, "Vacía · fecha", sin cambio ✔; (e) multípara sin tacto → served_untested → "Servida sin tacto", IDÉNTICO ✔. Los ÚNICOS cambios de comportamiento (cut→"No apta", unknown-no-vaquillona→"Sin evaluar", empty/pregnant fallback en divergencia) NO están asertados por ningún test previo → cero regresión. **Confirmado corriendo events.spec + animals.spec: events all-pass; animals 53/53 (+1 flake de `waitForServerBirth` que pasó en retry, ajeno a este cambio — persistencia server de register_birth, no display).**
- **Test que pasa por la razón equivocada**: la aserción E2E de "Vacía" pasa vía la ruta pregnancy (el tacto empty está en el timeline) → pasaría también en el código viejo → NO es guard de la divergencia. El guard de la divergencia es el UNIT `reproStateRowDisplay(empty, hasPregnancyEvent=false) → "Vacía"`. La aserción E2E de "Dientes" SÍ es guard duro (el viejo código nunca renderizaba "Dientes"). Split honesto documentado.
- **Edge cases**: teethState enum desconocido → `teethLabel` cae al valor crudo (no rompe). teethState NULL en overlay de alta optimista → fila oculta hasta sync (documentado, patrón is_cut=0). `reproRow='pregnancy'` pero `state.pregnancy` null en el caller → ternario cae a null → "Sin registrar" (defensivo, no explota). ✔
- **Seguridad / multi-tenant / offline**: cambio display-only (lecturas locales). `teeth_state` ya está en `animal_profiles` (stream tenant-scoped) → el SELECT extra no abre superficie. Sin RPC/RLS/write nuevos. Sin `establishment_id` hardcodeado. Offline-first (lee del SQLite local). ✔
- **Diseño (memoria)**: capturas verificadas — "Dientes: Boca llena" y "Vacía · Hoy" renderizan completos, sin recorte de descendentes, layout de la sección intacto (screenshot 03).

## Reconciliación de specs
- `design-aptitud-reproductiva.md` (spec 02): nota de reconciliación as-built U4 al tope (fila "Estado reproductivo" anclada en `detail.reproStatus` vía `reproStateRowDisplay`; fila "Dientes").
- `design.md` (spec 02): nota bajo `fetchAnimalDetail` (extendido) → `teeth_state → teethState` + proyección synced/overlay + fila "Dientes" condicional.
- Requirements sin cambio de EARS (bugfix de paridad, no cambia el *qué* del contrato; el estado reproductivo single-slot ya era el contrato RAR — la ficha ahora lo respeta de verdad).

## Resultado verificación
- Typecheck app: verde.
- Unit: `repro-status.test.ts` + `local-reads.test.ts` → 209/209 (incluye 6 nuevos de `reproStateRowDisplay` + assert teeth_state en el detalle).
- E2E ficha: `ficha-paridad.spec.ts` → PASS (card "Vacía" + ficha "Dientes: Boca llena" + "Vacía · Hoy").
- E2E regresión ficha: `events.spec.ts` all-pass; `animals.spec.ts` 53/53 (1 flake de sync ajeno, verde en retry).
- Capture Gate 2.5: `captures/ficha-paridad.capture.ts` → 3 shots (01-listado-card-vacia, 02-ficha-hero, 03-estado-actual-dientes-vacia). `.capture.ts` commiteable; `__shots__/*.png` gitignored (verificado con git check-ignore).
- `design/` sin churn tras los E2E (0 dirty). NO commiteo (leader coordina).

## Archivos tocados (file-set disjunto del terminal U7 — no toqué tab-layout ni tab-bar-insets)
- `app/app/animal/[id].tsx` (CurrentStateSection: fila Dientes + reproValue anclado)
- `app/src/utils/repro-status.ts` (+ `.test.ts`) — helper puro `reproStateRowDisplay`
- `app/src/services/animals.ts` — `AnimalDetail.teethState` + mapper + `LocalDetailRow.teeth_state`
- `app/src/services/powersync/local-reads.ts` (+ `.test.ts`) — `teeth_state` en `buildAnimalDetailQuery`
- `app/e2e/helpers/admin.ts` — `seedAnimal({teethState})` + `seedReproductiveTactoEvent`
- `app/e2e/ficha-paridad.spec.ts` (nuevo) + `app/e2e/captures/ficha-paridad.capture.ts` (nuevo)
- specs 02: `design-aptitud-reproductiva.md` + `design.md` (reconciliación)
