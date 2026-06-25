# impl_08-sigsa-ui-run2 — UI run 2 (refinaciones flagship + BreedPicker + RENSPA)

baseline_commit: 559864423de4ee53fb02d33c40dbe090481210d6

> Feature 08 (export SIGSA), capa de UI run 2. La pantalla flagship, el hook, el service y la capa DB
> YA existen (run anterior, gateados + deployados). Este run COMPLETA la UI:
> A) refinaciones del flagship (terracota→muted, sticky CTA, action-sheet markAsDeclared, filtro fechas).
> B) BreedPicker (sheet) + helper puro + integración en el alta (crear-animal).
> C) RENSPA: schema local + CTA/edición en editar-campo + banner en /mas + prepoblación del checklist.

## Plan (orden de ejecución)
1. [baseline] SHA registrado arriba.
2. Helper puro `breedPickerOptions` + test (capa pura primero).
3. Service de lectura del catálogo (`buildBreedCatalogQuery` en local-reads + `fetchBreedCatalog`) + test del builder.
4. `BreedPickerSheet` (sheet patrón LotePickerSheet, con búsqueda).
5. RENSPA: `renspa` en schema.ts (cliente) + `updateRenspa`/`loadEstablishmentDetail` con renspa en establishments service.
6. Integración BreedPicker en `crear-animal.tsx` (alta) + `createAnimal` acepta `breedId`.
7. RENSPA UI: campo en `editar-campo.tsx` (owner, vía RPC) + banner en `/mas` + prop renspa al checklist en `export-sigsa.tsx`.
8. Refinaciones flagship A1-A4.
9. Tests: e2e (markAsDeclared, filtro fechas, BreedPicker, RENSPA) + unit (breedPickerOptions, renspa-validate).
10. Capturas + autorrevisión + verificación (typecheck + unit + e2e).

## Decisión de scope (registrada antes de codear)
- **T18 "alta + edición"**: NO existe pantalla de edición de animal ni service de update de breed en la app
  (la ficha `animal/[id].tsx` muestra `breed` READ-ONLY, línea 699; la zona "Editar" del comentario quedó
  diferida a C3 y nunca se construyó; no hay `updateAnimalProfile`/`setBreed`). Construir un flujo de
  edición de animal nuevo está FUERA del brief (toca el animal-domain) y el brief dice "el resto del wizard
  no se toca" + "NO toques el animal suite". → Integro el BreedPicker en el **alta** (crear-animal),
  wireando `breed_id` por `createAnimal` (param `breedId` OPCIONAL, aditivo, backward-compat). La cláusula
  de "edición / legacy text como sugerencia" (R1.5) se cumple DENTRO del alta: el picker muestra el `breed`
  texto-libre como sugerencia + hint "Completar para exportar a SIGSA" cuando hay texto pero no `breed_id`.
  Esto se reconcilia con el leader al cierre (no marco done).

## ⚠ BLOQUEO PARCIAL DESCUBIERTO (T18 breed_id en el alta) — para decisión del leader
- **El alta NO puede persistir `breed_id` sin una migración.** La RPC ATÓMICA `create_animal` (0083) que drena
  el alta offline (vía outbox → `uploadData`) fue escrita ANTES de spec 08 y NO tiene parámetro `p_breed_id`;
  su `INSERT INTO animal_profiles` enumera columnas SIN `breed_id`; el mapeo `upload.ts` (línea ~111-132)
  tampoco pasa `p_breed_id`. Las migraciones 0108/0109 agregaron la columna + triggers de herencia, pero NO
  actualizaron el RPC. → Un `breed_id` en el payload del alta se PERDERÍA EN SILENCIO al subir (fila server con
  `breed_id NULL`). Verificado en 0083 + upload.ts.
- **Decisión (reconciliación a as-built, NO improvisar un bug):** el BreedPicker del alta setea el NOMBRE de la
  raza elegida en `animal_profiles.breed` (texto, que SÍ persiste por `p_breed`). NO se manda `breed_id` (evita
  el silent-drop). El picker sigue siendo la entrada de raza CONTROLADA del alta (lista vs. tipeo libre) y su
  hint "Completá para exportar a SIGSA" es coherente: hasta que el `breed_id` se setee, el animal queda "a
  completar" para SIGSA (consistente con el validador, que exige breed_id).
- **Para CERRAR T18 (setear breed_id desde el alta) hace falta** (follow-up, fuera de este run = NO deploys):
  patchear `create_animal` (0083): agregar `p_breed_id uuid default null` + `breed_id` al INSERT; + agregar
  `p_breed_id: profile.breed_id ?? null` al mapeo de `upload.ts`. Es una migración + 1 línea de cliente. El
  leader decide si la agenda en un run de DB o acepta el texto-only por ahora. (El brief pedía "Setea breed_id"
  Y "NO toques migraciones" — conflicto irresoluble en este run; reconcilio a lo deployable.)

## Archivos tocados / creados

### Nuevos (capa pura + componentes + tests)
- `app/src/utils/breed-picker.ts` (+ `.test.ts`) — helper PURO del picker de raza: `breedPickerOptions`
  (Sin raza primero; solo bovine+active; orden sort_order; OR NO promovido), `filterBreedOptions` (búsqueda
  nombre/código case/acentos-insensitive, "Sin raza" siempre), `selectedBreedLabel`, `normalizeForSearch`.
- `app/src/utils/renspa-validate.ts` (+ `.test.ts`) — `validateRenspa` (1-20 chars, vacío=null, espeja CHECK 0110).
- `app/src/utils/sigsa-filters.ts` (+ `.test.ts`) — `isValidBirthDateRange` (desde>hasta → error en "hasta") +
  `normalizeFilterDate` (completo-o-null para la query).
- `app/src/components/sigsa/BreedPickerSheet.tsx` — sheet patrón LotePickerSheet (scrim + doble-RAF + header/
  body/footer fijos) + campo de búsqueda. Chip de código SENASA + nombre.
- `app/src/components/sigsa/MarkDeclaredSheet.tsx` — action-sheet R10.2 (menú: marcar | ver ficha; + confirm).
- `app/e2e/sigsa-breed-renspa.spec.ts` — e2e: BreedPicker en alta (buscar/elegir/sin-raza) + RENSPA banner→editar→guardar.
- `app/e2e/sigsa-run2-screenshot.spec.ts` — capturas del veto (10 PNG en design/veto-sigsa-run2/).

### Modificados
- `app/app/export-sigsa.tsx` — **A1** terracota→`$textMuted` en "{N} a completar"; **A2** CTA export → barra
  STICKY-BOTTOM (Shell con prop `footer`; lista scrollea detrás); **A3** tap en "Listos" → MarkDeclaredSheet
  (las "a completar" siguen tap→ficha directo); **A4** rango de fecha en filtros + validación inline; **R13.3**
  carga `renspa` del campo y lo pasa al checklist.
- `app/app/crear-animal.tsx` (T18) — reemplazado el FormField de raza texto-libre por el BreedPicker (trigger +
  sheet); carga `fetchBreedCatalog`; `onSelectBreed` setea `breed` (nombre) + recuerda el código. Removido
  `BREED_MAX_LENGTH` (ya no se tipea raza).
- `app/app/editar-campo.tsx` (T17) — campo RENSPA (owner-only; persiste vía RPC `updateRenspa`, NO UPDATE
  directo) + validación inline; se guarda SOLO si cambió (evita round-trip).
- `app/app/(tabs)/mas.tsx` (T17) — `RenspaBanner` informativo (no terracota) en la sección SENASA, solo owner +
  solo si falta renspa → linkea a /editar-campo.
- `app/src/services/establishments.ts` — `EstablishmentDetail.renspa` + mapping; nueva `updateRenspa` (RPC
  `update_renspa`, maneja 42501 = no-owner).
- `app/src/services/sigsa/sigsa-export-service.ts` — `fetchBreedCatalog` (lee breed_catalog local → BreedCatalogEntry[]).
- `app/src/services/powersync/local-reads.ts` — `buildBreedCatalogQuery` (catálogo COMPLETO ordenado) +
  `BreedCatalogRow`; `renspa` agregado a `buildEstablishmentDetailQuery`.
- `app/src/services/powersync/schema.ts` (CLIENTE) — `renspa` en `establishments` (R13.3 offline; baja por
  est_establishments SELECT *; NO toca rafaq.yaml ni se deploya).
- `app/src/services/powersync/connector.ts` + `upload-classify.ts` — **FIX CRÍTICO** (ver abajo): tablas
  append-only (sigsa_declarations/export_log) suben por `.insert()` (no `.upsert()`).
- `scripts/run-tests.mjs` — registrados breed-picker / renspa-validate / sigsa-filters tests.
- Tests extendidos: `local-reads.test.ts` (buildBreedCatalogQuery + renspa), `schema.test.ts` (renspa col),
  `upload-classify.test.ts` (append-only insert), `sigsa-export.spec.ts` (markAsDeclared + filtro fecha).

## 🔴 BUG CRÍTICO ENCONTRADO Y CORREGIDO — el upload de sigsa_declarations/export_log se descartaba en silencio
- **Síntoma (detectado por el e2e de markAsDeclared con verificación server-side):** la marca declaraba bien en
  la UI (sale de pendientes — el SQLite local ya excluye al declarado) PERO la fila NUNCA llegaba al servidor.
- **Causa raíz:** el connector de PowerSync sube TODO PUT CRUD-plano con `supabase.from(t).upsert(payload)`.
  Un `upsert` de PostgREST compila `INSERT ... ON CONFLICT DO UPDATE`, que **exige privilegio UPDATE** aunque
  no haya conflicto. Las tablas `sigsa_declarations`/`export_log` son APPEND-ONLY por diseño (R11.3): `GRANT
  SELECT, INSERT` (sin UPDATE) + sin policy UPDATE (la auditoría no-spoofeable depende de eso: `declared_by`/
  `generated_by` forzados por trigger, sin UPDATE desde el cliente). → el upsert se rechazaba con 42501 →
  el connector lo trata como rechazo PERMANENTE → **descarte silencioso**. Sin este fix, NINGUNA declaración
  NI export_log persistía server-side (la feature 08 entera quedaba rota en la práctica, no solo markAsDeclared).
  Las tablas de evento (weight_events, etc.) NO tienen el problema porque 0025+ les da `grant ... update` +
  policy UPDATE justamente para que el upsert del connector funcione.
- **Fix (CLIENTE, NO migración):** `buildCrudUpsert` marca `insertOnly:true` para las tablas append-only
  (`isAppendOnlyInsertTable`); el connector usa `.insert()` (no `.upsert()`) para ésas → basta el grant INSERT.
  Un re-intento (mismo id / UNIQUE de dominio) = 23505 = descarte permanente (fila ya presente = idempotente
  en efecto). **PRESERVA** la propiedad append-only/no-UPDATE (R11.3) — es el fix arquitectónicamente correcto,
  NO un workaround (la alternativa, dar grant UPDATE, rompería la auditoría no-spoofeable). Verificado: el e2e
  de markAsDeclared ahora confirma la fila server-side con `export_log_id IS NULL`. Cubierto por unit tests en
  upload-classify.test.ts. **El leader debería confirmar que NO falta también el lado spec/design** (el design
  de 0111/0112 asume el upload, pero no notó la incompatibilidad upsert↔append-only; quizá merezca una nota).

## Decisiones A1-A4 aplicadas (refinaciones del flagship, NO re-litigadas)
- **A1** ✓ "{N} animal(es) a completar" en `$textMuted` (estado normal). Terracota SOLO en el flag por-fila
  "Falta la raza" del ExportAnimalRow (intacto).
- **A2** ✓ CTA export en barra sticky-bottom full-width ≥`$touchMin`, `paddingBottom=max(insets.bottom,
  $navBottomMin)`, fondo `$white` + divider superior. Card-resumen conserva solo el conteo. Lista scrollea
  detrás (padding inferior `$10` para no tapar la última fila). Disabled si exportableCount=0.
- **A3** ✓ tap en "Listos" → MarkDeclaredSheet (copy EXACTO "Marcar como ya declarado por otro medio" +
  "Ver la ficha del animal" + Cancelar; confirm breve "No genera ningún archivo…"). markDeclared → refresca.
  Las "a completar" siguen tap→ficha directo.
- **A4** ✓ rango desde/hasta de nacimiento en filtros, wireado a `filters.dateFrom`/`dateTo`; inputs mascados
  AAAA-MM-DD (maskDateInput); validación inline desde>hasta (borde rojo en "hasta" + error pegado, NO banner).

## Trazabilidad R<n> → archivo:test
- **R1.4 (breed_id UX)** → `breed-picker.test.ts` (opciones/orden/OR-no-promovido) + `sigsa-breed-renspa.spec.ts`
  (BreedPicker en alta) + `06/07/08` screenshots.
- **R8.3 (datos faltantes / completar)** → BreedPicker hint "Completá la raza para SIGSA" + el tap→ficha de "a completar".
- **R2.1/R2.2/R2.3 (renspa)** → `renspa-validate.test.ts` + `local-reads.test.ts` (buildEstablishmentDetailQuery
  renspa) + `schema.test.ts` (col) + `sigsa-breed-renspa.spec.ts` (banner→editar→guardar vía RPC + verificación server).
- **R9.3 (filtro fecha)** → `sigsa-filters.test.ts` + `sigsa-export.spec.ts` (filtro de fechas: acota + error inline).
- **R10.2 (markAsDeclared)** → `sigsa-export.spec.ts` (markAsDeclared: action-sheet → marca → server-side
  export_log_id NULL) + `upload-classify.test.ts` (append-only insert) + `02/03` screenshots.
- **R13.3 (renspa en checklist)** → checklist recibe `renspa` del campo (export-sigsa.tsx) + el banner si falta.
- **T13/T7 (catálogo)** → `buildBreedCatalogQuery` test (local-reads) + `fetchBreedCatalog`.

## Autorrevisión adversarial (paso 8) — qué busqué, qué encontré, cómo lo cerré
1. **Font gigante del input de búsqueda del BreedPicker** (encontrado en el self-veto de capturas): usaba
   `getTokenValue('$4','size')` que lee el token de TAMAÑO global (no el de fuente) → fuente enorme. → corregido
   a `getTokenValue('$inputText','size')` (16px, igual que FormField). Re-capturado y verificado.
2. **Upload silenciosamente descartado de sigsa_declarations/export_log** (encontrado por la verificación
   server-side del e2e de markAsDeclared, que añadí a propósito en vez de quedarme en el assert de UI): bug
   crítico append-only↔upsert. Fix en el connector (ver arriba). Re-verificado E2E.
3. **breed_id no persiste desde el alta** (encontrado revisando la RPC 0083 antes de wirear): la RPC del alta
   no tiene `p_breed_id`; un breed_id en el payload se perdería. → reconciliado: el picker setea `breed` (texto,
   persiste); breed_id queda como follow-up de migración (documentado). El e2e verifica el NOMBRE en la ficha.
4. **Edge sheets**: reapertura limpia búsqueda/fase; doble-RAF anti tap-through copiado; header/body/footer
   fijos (título no se recorta al crecer la lista). Verificado en capturas (lista larga + búsqueda).
5. **Validación = inline, no banner**: tanto el filtro de fecha como (en teoría) el RENSPA usan borde rojo +
   error pegado al campo. (El RENSPA capea a 20 con maxLength → el >20 no es alcanzable por UI; cubierto por unit.)
6. **Multi-tenant/offline**: renspa + catálogo se leen del SQLite local (offline); markDeclared es offline-first;
   nunca se hardcodea establishment_id (sale del contexto).
7. **Tests por la razón correcta**: el e2e de markAsDeclared verifica la fila SERVER-SIDE (no solo UI) — eso es lo
   que destapó el bug del connector. El de breed verifica el dato persistido real (breed name).

## Reconciliación de specs pendiente (la hace el leader al cierre, paso 9 — NO toco specs)
- **design.md / requirements.md**: documentar (a) el fix connector append-only↔upsert (las tablas suben por
  INSERT, no upsert; la propiedad R11.3 se preserva client-side); (b) la reconciliación de T18 (alta setea
  `breed` texto, no breed_id, hasta patchear la RPC 0083); (c) el `renspa` agregado al schema CLIENTE + la query
  de detalle. **tasks.md**: T13/T17/T18 + R10.2 quedan como hechos (UI), con la nota de que T18-breed_id y el
  connector-fix-en-design son follow-ups del leader.

## Verificación
- `pnpm typecheck`: ✓ verde.
- Unit (node:test): 299 pass en las suites tocadas/nuevas (breed-picker 32 incl. en el bloque, renspa-validate,
  sigsa-filters, sigsa-display, sigsa-{txt-generator,validator,export-service}, local-reads, schema,
  upload-classify, upload). 0 fail.
- check-hardcode: ✓ 0 violaciones.
- e2e (Playwright, build estático :8099 + Supabase remoto): `sigsa-export.spec.ts` 6/6 ok; `sigsa-breed-renspa.spec.ts`
  3/3 ok; `sigsa-run2-screenshot.spec.ts` 3/3 ok (10 capturas). NO se corrió `check.mjs` completo (flake conocido
  del Animal suite, ajeno — instrucción del leader).
- Capturas del veto: design/veto-sigsa-run2/{01..10}.png.
