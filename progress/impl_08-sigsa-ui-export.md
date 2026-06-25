baseline_commit: 559864423de4ee53fb02d33c40dbe090481210d6

# impl 08 — UI de Exportación SIGSA (pantalla flagship + checklist + fila + estados + historial)

**Sub-run del leader (pipeline autónomo)**. Alcance ACOTADO por el brief: la **pantalla de exportación**
(`ExportSigsaScreen`) + su **fila** (`ExportAnimalRow`) + el **checklist post-export** (`SigsaChecklistReminder`)
+ estados + historial + el link de entrada en `/mas`. **NO** el BreedPicker, **NO** el CTA de RENSPA en config,
**NO** la integración en el form de animal (esas tres = otro run = T13/T17/T18).

Cubre, de las tasks del spec: **T16** (pantalla), **T14** (checklist), **T15** (fila). La capa de servicio
(`sigsa-export-service.ts`) + el hook (`useExportSigsa.ts`) YA existían — se consumen, no se reimplementan.

⚠ NO marqué `done` ni toqué `tasks.md` (instrucción del leader). NO corrí `node scripts/check.mjs` (flake
conocido del Animal suite, ajeno a SIGSA). Verifiqué con `pnpm typecheck` + unit nuevos + e2e nuevo + lint
anti-hardcode.

## Resultados de verificación

- **`pnpm.cmd typecheck` (app/)**: ✅ VERDE (0 errores), con el e2e nuevo incluido.
- **Unit nuevo** `app/src/utils/sigsa-display.test.ts`: ✅ **11/11 pass** (node:test). Registrado en
  `scripts/run-tests.mjs` (client unit tests).
- **E2E nuevo** `app/e2e/sigsa-export.spec.ts`: ✅ **4/4 pass** (chromium, dist estático + Supabase remoto).
  - empty: resumen 0 + botón deshabilitado (`aria-disabled=true`) + "Todo al día" + filtros abren OK.
  - listos/a-completar: tabs con conteo (Listos (1) / A completar (1)); TAG enmascarado; "Falta la raza"
    en "A completar"; tap en la fila → ficha del animal (R8.3).
  - historial: entrada de export_log sembrada (autenticada, ver reconciliación) aparece con "3 animales"
    + afordancia de re-descarga.
  - export: botón "Exportar 1 animal" habilitado (`aria-disabled=false`) dispara el flujo (wiring).
- **Lint anti-hardcode** (`node scripts/check-hardcode.mjs`): ✅ **0 violaciones** en app/app + app/src/components.
- **Capturas para design-review** en `design/veto-sigsa-export/` (sigsa-listos / a-completar / historial-vacio
  / filtros). Mi propio veto: jerarquía OK, descendentes sin recorte ("Generá/exportaciones/descargarlo"),
  criticidad mixta correcta, big-touch RAFAQ. Listo para el veto de Raf.

## Qué REUSÉ vs qué CREÉ

**Reusado** (sin modificar):
- `useExportSigsa` (hook) — consumido por su interfaz completa (pendingAnimals/exportableCount/
  incompleteAnimals/isGenerating/lastExport/history/error/filters/setFilters/refresh/generateExport/
  redownloadExport). NO se tocó.
- `Button`, `Card`, `InfoNote`, `Select` (componentes canónicos).
- `ReportEmpty`, `ReportError` (estados de `@/components/reports`) — para empties/errores (tono positivo/neutro).
- Patrón de `Shell` (header con back chevron + ScrollView) de `rodeos.tsx`/`reportes.tsx`.
- `buttonA11y` (a11y multiplataforma), `getTokenValue` para íconos lucide, `transform rotate` en chevron
  (patrón de `lotes.tsx`).
- E2E: `seedAnimal`/`seedEstablishmentWithRodeo`/`gotoTab`/`signIn`/`waitForHome` + el `admin`/`anonClient`
  exportados (no toqué `admin.ts`).

**Creado**:
- `app/src/utils/sigsa-display.ts` (+ `.test.ts`) — lógica PURA: `formatRfidMasked` (TAG legible 6·4),
  `incompleteReasonLabel(s)` (motivos es-AR, R8.3), `exportLogDateLabel`, `animalCountLabel`.
- `app/src/components/sigsa/ExportAnimalRow.tsx` — fila de export (modo listo / a-completar con motivos).
- `app/src/components/sigsa/SigsaChecklistReminder.tsx` — checklist post-export (4 datos + plazo 10 días).
- `app/src/components/sigsa/index.ts` — barrel.
- `app/app/export-sigsa.tsx` — pantalla flagship (resumen + filtros + 3 tabs + estados + checklist + historial).
- `app/app/_layout.tsx` — `<Stack.Screen name="export-sigsa" />` (no en strandedOnGatingRoute → el gate no
  la expulsa, igual que editar-campo).
- `app/app/(tabs)/mas.tsx` — sección "SENASA" con la fila "Exportar a SENASA" (owner/vet only, R7.2).
- `app/e2e/sigsa-export.spec.ts` (red de seguridad) + `app/e2e/sigsa-screenshot.spec.ts` (capturas de veto).

## Trazabilidad R → cobertura

| R | Cómo se cubre (archivo:elemento → test) |
|---|---|
| **R7.1/R7.3** (field_operator no exporta) | `export-sigsa.tsx` gate `canExport` (owner/vet) → InfoNote de bloqueo; `mas.tsx` no ofrece la fila a no-owner/vet. (El RLS 0111/0112 es la barrera real al subir.) |
| **R7.2** (owner/vet exportan) | `export-sigsa.tsx` `canExport`; `mas.tsx` sección SENASA visible a owner/vet. e2e: las 4 corren como owner. |
| **R8.2/R8.3** (a-completar con motivos) | `sigsa-display.ts:incompleteReasonLabels` (test `sigsa-display.test.ts`) + `ExportAnimalRow` modo a-completar; e2e "listos/a-completar" asierta "Falta la raza". |
| **R8.3** (tap → completar) | `export-sigsa.tsx` fila a-completar → `goToAnimal`; e2e tap → ficha del animal (IDV visible). |
| **R8.4/R8.5** (export sólo si ≥1 exportable / elegir exportar los que pasan) | `SummaryCard` botón disabled si `exportableCount===0`; el hook revalida en generateExport. e2e empty asierta disabled. |
| **R9.1** (pendientes por defecto) | la query del hook ya trae pendientes; la pantalla los lista en "Listos". |
| **R9.2** (filtro por rodeo) | `FiltersSection` Select de rodeo → `setFilters({rodeoId})`; e2e empty abre filtros + ve el Select. |
| **R9.3** (filtro por rango de fechas) | `FiltersSection` — **sólo rodeo en esta entrega** (ver reconciliación: el rango de fechas se difiere, el filtro `dateFrom/dateTo` del hook queda disponible). |
| **R9.5** (pendientes vacíos → mensaje + acceso a historial) | `ReadyEmpty` "Todo al día" (tono positivo) + botón "Ver el historial" si hay historial; e2e empty asierta "Todo al día". |
| **R10.1** (re-descarga del historial) | `HistoryList` botón "Re-descargar" → `redownloadExport`; e2e historial asierta la afordancia. |
| **R12.1** (pantalla con lista + botón + historial) | `export-sigsa.tsx` entera. |
| **R12.2** (historial: fecha/cantidad/re-descarga) | `HistoryList` (`exportLogDateLabel`/`animalCountLabel` + botón); e2e historial asierta "3 animales" + re-descarga. |
| **R13.2** (checklist 4 datos) | `SigsaChecklistReminder` (RENSPA/especie/fecha/motivo). |
| **R13.3** (prepopular RENSPA / CTA si falta) | `SigsaChecklistReminder` prop `renspa` (badge si hay; aviso si no). **La pantalla pasa `null` hoy** — ver reconciliación (el read de RENSPA local lo cablea el run de RENSPA, T17). |
| **R13.4** (nota plazo 10 días hábiles) | `SigsaChecklistReminder` franja con el texto "Art. 8°, Res. 841/2025". |
| **R13.1** (share sheet) | lo dispara el service (`generateExport`→`saveAndShare`), no la pantalla (R13.1 ya cubierto en T11). |

## Reconciliaciones contra el design/requirements (as-built — para foldear el leader al cierre)

> NO edité `specs/active/08/*.md` para no colisionar con los runs paralelos (BreedPicker/RENSPA) ni con el
> leader, que coordina la reconciliación de specs al cierre de la feature multi-run (disciplina de terminales
> paralelas). Las dejo acá para que el leader las foldee en `design.md` §"UX — Pantalla de exportación" y bajo
> los R afectados en `requirements.md`.

1. **`ExportAnimalRow` muestra TAG + sexo + estado/motivos, NO "categoría/rodeo/badge declarado"** (el design
   §"UX" tipaba "TAG, categoría, rodeo, badge declarado"). Razón: el hook entrega `PendingAnimalInfo` (rfid/
   sex/birthDate/breedId/breedCode) — NO porta categoría ni nombre de rodeo. La lista muestra SOLO PENDIENTES
   (la query filtra los ya declarados con `sd.id IS NULL`), así que un "badge declarado" no aplica acá (ningún
   animal de esta lista está declarado). La fila presenta lo que la capa de datos de export provee, honesto al
   contrato. (Si en el futuro se quiere categoría/rodeo en la fila, hay que extender `PendingAnimalInfo` + la
   query — anotado, no es de este run.)

2. **R13.3 (prepopular RENSPA): la pantalla pasa `renspa={null}` HOY.** El `SigsaChecklistReminder` SOPORTA la
   prepopulación (prop `renspa` → badge verde) y la degradación (aviso "cargalo en config"). Pero leer el
   RENSPA del campo activo requeriría: (a) la columna `renspa` en la tabla LOCAL `establishments` de
   `app/src/services/powersync/schema.ts` — que NO está (T7 agregó las tablas SIGSA pero no la columna renspa al
   establishments local) + (b) un reader. Agregar `renspa` a `schema.ts` está **FUERA del scope de este run**
   (el brief prohíbe tocar schema.ts) y pertenece al run del **CTA de RENSPA (T17)**, que ya va a tocar config +
   el read de RENSPA. **Seam limpio**: cuando T17 agregue `renspa` a schema.ts + un reader, cablea el valor en
   `<SigsaChecklistReminder renspa={…}/>` (1 línea en `export-sigsa.tsx`). Hoy: el checklist muestra el aviso de
   completar RENSPA — comportamiento correcto para un campo sin RENSPA, que es el estado real mientras no haya
   read. R13.3 queda cubierto ESTRUCTURALMENTE; la prepopulación efectiva se activa con T17.

3. **Filtro de fechas (R9.3) DIFERIDO en la UI de este run.** El `FiltersSection` expone HOY sólo el filtro de
   **rodeo** (R9.2). El hook ya acepta `dateFrom/dateTo` (`SigsaPendingFilters`), así que el backend del filtro
   está listo; falta el control de UI (date range picker). Lo difiero para no meter un date-picker a medias en
   la pantalla flagship (no hay un DateRange component canónico en la librería todavía — sería JIT). R9.3 queda
   con el camino de datos disponible; la UI del rango se agrega cuando exista el componente de fecha. Anotado.

4. **Historial como TAB (no botón separado).** El design dice "botón/tab 'Historial'". Elegí TAB (un 3er
   segmento junto a Listos/A-completar) por coherencia con el patrón segmentado de la pantalla. Es una de las
   dos opciones que el design admite — no es desviación.

5. **markAsDeclared (R10.2) NO tiene afordancia de UI en este run.** El brief acotó el run a "pantalla +
   fila + checklist + estados + historial" y NO listó la marca-manual. El hook expone `markDeclared`; la
   afordancia "Marcar como ya declarado por otro medio" (T19-UI, copy de la decisión 2 del leader) es una
   acción por-fila distinta que conviene sumar en un follow-up acotado (ej. en el contexto de la fila o un
   long-press). Lo dejo señalado; el método ya está listo para cablear.

## Autorrevisión adversarial (paso 8) — qué busqué, qué encontré, cómo lo cerré

Pasada hostil sobre mi propio código ANTES de reportar:

- **Consistencia conteo tab "Listos" vs empty**: verifiqué que `readyAnimals.length === exportableCount`
  siempre (validateForExport particiona pendingAnimals en exportable+incomplete; readyAnimals = no-incompletos
  = exactamente los exportables). Sin desajuste. ✓
- **Stale closure del refresh on-focus** (BUG real encontrado): mi `useFocusEffect` dependía de
  `[establishmentId, filters]` con eslint-disable, capturando un `refresh` potencialmente STALE re: filtros al
  re-enfocar (la query local del hook NO es reactiva → el refresh on-focus es lo único que pone al día tras
  volver de la ficha). **Cerrado**: lo cambié a `[refresh]` (patrón de `rodeos.tsx`) → siempre se llama la
  versión fresca; el costo es un refresh idempotente extra al cambiar filtro (benigno). Rebuild + re-run e2e OK.
- **File API stub en WEB** (gotcha rn-web encontrado): `expo-file-system` `File` es un STUB en web (constructor
  sólo `console.warn`, sin métodos) → `saveAndShare` (en el service) lanza y `generateExport` degrada a error.
  El happy-path archivo+checklist es **NATIVE-only**. **Cerrado**: el e2e de export asierta el WIRING (botón
  habilitado dispara el flujo) aceptando `checklist.or(errorCard)` — ambos prueban que disparó sin colgarse;
  no aserto un download imposible en web. Documentado arriba.
- **Tags hardcodeados en la spec de capturas** (flake encontrado): el screenshot spec usaba tags fijos →
  colisión con `animals.tag_unique` GLOBAL (animals NO cascade-deletea) entre runs, Y entre sí por un slice que
  recortaba el suffix. **Cerrado**: tags `032`+11 díg timestamp+1 díg = 15 únicos. El MAIN spec ya usaba tags
  timestamp-derivados (safe). Re-run verde.
- **Ambigüedad de strict-mode** (encontrado en e2e): "Exportar a SENASA" choca entre el header de la pantalla y
  el label de la fila de "Más" (queda montada bajo la pantalla pusheada). **Cerrado**: ancla del aterrizaje =
  el subtítulo único. Re-run verde.
- **Seed de export_log bajo service_role** (encontrado en e2e): `export_log.generated_by` es NOT NULL + el
  trigger 0112 lo fuerza = auth.uid() (NULL bajo service_role) → INSERT imposible vía admin. **Cerrado**: el
  seed firma como el owner (anonClient + signIn) → el trigger pone su uid + el RLS owner/vet pasa (mismo camino
  que la app). Documentado en el helper.
- **Descendentes**: veté las capturas — "Generá/exportaciones/descargarlo/aparecer" sin recorte; todo heading
  ≥$6 y todo Text con numberOfLines lleva `lineHeight` matcheado (auditado fila por fila). ✓
- **Multi-tenant**: la pantalla NUNCA hardcodea establishment_id (el hook lo lee del contexto); el rol sale del
  contexto. ✓
- **Cero-hardcode**: lint 0 violaciones tras todas las ediciones. ✓
- **Sheets/tap-through**: la pantalla NO tiene sheet (checklist = Card inline, filtros = Card acordeón, tabs =
  botones) → `.click()` correcto, sin riesgo de tap-through al backdrop ni necesidad de touchscreen.tap(). ✓

## Pendiente / para el leader

- Foldear las 5 reconciliaciones de arriba en `specs/active/08/{design,requirements}.md` al cierre de la feature.
- Cablear `renspa` real en el checklist + filtro de fechas + afordancia de markAsDeclared = follow-ups acotados
  (T17 trae el read de RENSPA; el resto son JIT).
- Esperar el **reviewer + Gate 2** (no marco done yo).
