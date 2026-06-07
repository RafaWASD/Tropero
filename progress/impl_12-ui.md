baseline_commit: dfef10f58ab4e264beceac3ad822fff0dec5b308

# impl_12-ui — Feature 12 (Importación masiva de rodeo), Fase 4: hook + 4 pantallas + routing

> **Alcance de este run**: SOLO la capa de UI del import (tasks T4.1–T4.5 + routing). El hook
> `app/src/hooks/useImportRodeo.ts` que orquesta el flujo + la pantalla `app/app/import-rodeo.tsx`
> (1 ruta, 4 pasos internos) + registro en `app/app/_layout.tsx`. NO se toca la capa de datos (solo
> se IMPORTA de `services/import-rodeo.ts` + `utils/import/*`), NO el backend, NO `scripts/run-tests.mjs`.
> El entry point en Rodeos/onboarding lo hace OTRO run — NO toco `rodeos.tsx` ni `onboarding.tsx`.

## Feature en curso

Feature 12 — Importación masiva de rodeo (`in_progress`). Fase 4 (UI). Spec aprobado (Gate 1 PASS +
Puerta 1 Raf 2026-06-06).

## Plan (tasks de Fase 4)

- T4.1 — `app/src/hooks/useImportRodeo.ts`: orquesta pick → size-check (R3.1, ANTES de leer) → parse →
  mapeo → validar → preview → confirmar → escribir → resultado. Expone estado + acciones. (R1.3, R5, R8)
- T4.2 — Paso 1 (Fuente + destino): cards de fuente (CSV/Excel | TXT SIGSA) + selector de rodeo destino
  (1 fijo / ≥2 selector) + pick archivo (`expo-document-picker`); bloqueo si no hay rodeo (R1.4) y si
  `field_operator` (R2.4). (R1.3, R2.1–R2.3, R1.4, R2.4)
- T4.3 — Paso 2 (Mapeo de columnas, solo CSV/Excel): auto-detección + ajuste manual por campo. (R4.1, R4.2)
- T4.4 — Paso 3 (Preview): conteos válidos/errores/duplicados + desglose por motivo legible + confirmación;
  bloqueo si 0 válidas (R5.6). (R5.3, R5.4, R5.5, R5.6)
- T4.5 — Paso 4 (Resultado): conteos finales + detalle legible (nunca sqlerrm crudo) + CTAs. (R8.3)
- Routing — `<Stack.Screen name="import-rodeo" />` en `_layout.tsx` + agregar a `RODEO_DESTINATIONS`
  (destino del owner desde Rodeos en estado `active`, no se expulsa a (tabs)).

## Notas de seguridad carry-forward que DEBO cumplir (de security_code_12-service.md §Fase 4)

1. R3.1 — el hook llama `checkFileSize(asset.size)` ANTES de leer/parsear el contenido (barrera real
   del char-flood de 1 celda gigante; el cap de filas del parser NO cubre un archivo de 1 fila de 50MB).
2. NO renderizar `error.message`/`sqlerrm` crudo al operador → mapear a copy legible en español.
3. NO ofrecer el flujo a `field_operator` (gate en UI; el RPC ya lo bloquea a nivel DB — defensa en profundidad).

## Dependencias instaladas

- `expo-document-picker ~56.0.4` (pick de archivo, managed).
- `expo-file-system ~56.0.7` (lectura de bytes del URI para .xlsx; en web se usa fetch→arrayBuffer).

## Progreso

> **Run 1 (UI / Fase 4, T4.1–T4.5 + routing)** — DONE, reviewer APPROVED + Gate 2 PASS. Bitácora
> completada en el **run consolidado FINAL** (abajo): el implementer del run 1 cortó por timeout antes
> de esta sección + su autorrevisión.

### Capas tocadas (Fase 4)

- `app/src/hooks/useImportRodeo.ts` — orquestador del flujo (estado + acciones). Consume la capa de
  datos (service + utils puros), no la reimplementa.
- `app/app/import-rodeo.tsx` — 1 ruta, 4 pasos internos (patrón crear-rodeo/crear-animal).
- `app/src/utils/import/import-ui.ts` (+ `import-ui.test.ts`) — lógica PURA de la UI (mapeo
  fila→raw, normalización tabla/SIGSA, completitud del mapeo, motivos→copy legible, armado/cap del
  preview). Enganchada en `run-tests.mjs` L53.
- `app/app/_layout.tsx` — `<Stack.Screen name="import-rodeo" />` + `import-rodeo` en `RODEO_DESTINATIONS`.

### Mapa R<n> → pantalla / archivo:test (Fase 4)

| R<n> | Pantalla / dónde | Test |
|---|---|---|
| R1.3 (4 pasos, una decisión por pantalla) | `import-rodeo.tsx` (source/mapping/preview/result) + ProgressBar 4 seg | screen (UI) |
| R1.4 (bloqueo sin rodeo → CTA crear) | `import-rodeo.tsx` BlockShell sin rodeo activo | screen |
| R2.1 (un rodeo destino, hereda rodeo_id) | `useImportRodeo` effectiveRodeoId → confirmImport; el RPC fuerza rodeo_id | `import.run.cjs` T2.5 |
| R2.2 (1 rodeo read-only) / R2.3 (≥2 selector) | `import-rodeo.tsx` StepSource / RodeoSelector | screen |
| R2.4 (owner/vet only; field_operator NO) | `import-rodeo.tsx` gate isFieldOperator → BlockShell + RPC a nivel DB | `import.run.cjs` T2.4/T2.5 (field_operator rechazado) |
| R4.1 (auto-detección) / R4.2 (ajuste manual) | `useImportRodeo` pickFile→autoDetectMapping / setColumnMapping→applyMappingOverride | `column-mapping.test.ts` / `import-ui.test.ts` (mappingIsComplete) |
| R5.3 (preview conteos) / R5.4 (motivos legibles) | StepPreview 3 CountColumn (exactos en el hook) + buildPreviewItems | `import-ui.test.ts` (buildPreviewItems, rowErrorCopy/intraDuplicateCopy/existingDuplicateCopy) |
| R5.5 (confirmación) / R5.6 (0 válidas → no escribir) | StepPreview CTA "Importar N"; disabled validCount===0 + guard hook + service | `import-ui.test.ts` + `import.run.cjs` |
| R8.3 (resultado + detalle legible) | StepResult + writeErrorCopy (nunca sqlerrm) | `import-ui.test.ts` (writeErrorCopy) |
| R12.2 (offline → no encola) | `useImportRodeo` confirm → confirmImport resolveOnline (probe inyectable) | `import-write.test.ts` (confirmImport guard) |
| (badge "lo que dice tu archivo") R10.3 client-side | `useImportRodeo` buildPreview → buildCategoryLabelByIndex → PreviewRow CategoryBadge | `import-ui.test.ts` (buildCategoryLabelByIndex + buildPreviewItems wire) |

> El **contrato/seguridad** (R3.x límites, R7 dedup, R9 campos forzados, R10 escritura, R11 audit)
> está cubierto por las suites de Fase 1 (72 utils), Fase 2 backend (`import.run.cjs` 25) y Fase 3
> service (`import-write.test.ts` 32). La Fase 4 es UI sobre esa base, sin contrato nuevo de datos.

### Orden del size-check (R3.1) — nota de seguridad #1 carry-forward

`useImportRodeo.pickFile` aplica `checkFileSize(asset.size)` **inmediatamente después del picker y
ANTES de cualquier lectura** (`readFileText`/`readFileBytes`) o parseo. Es la barrera real contra el
char-flood de 1 celda gigante de 50 MB que el cap de filas de los parsers NO cubre (un archivo de 1
fila gigante pasa el cap de filas pero revienta memoria al leerlo). Si el size-check falla → `setError`
y `return` sin tocar el contenido. Verificado en `useImportRodeo.ts` L249–258.

### Los 3 carry-forwards de seguridad (cerrados, confirmados por el reviewer)

1. **size-check ANTES de leer/parsear** — cerrado (ver arriba; `pickFile` L254).
2. **NUNCA sqlerrm/error.message crudo al operador** — cerrado: todo motivo de fila pasa por
   `import-ui` (`rowErrorCopy`/`existingDuplicateCopy`/`intraDuplicateCopy`/`writeErrorCopy`); los
   errores del service por `mapErrorToCopy`; el screen solo muestra `state.error` ya mapeado.
   `writeErrorCopy` testea explícitamente que NO filtra `animals_tag_unique`/`constraint`/`does not exist`.
3. **field_operator NO ve el wizard** — cerrado: `import-rodeo.tsx` rebota a BlockShell ANTES de
   cualquier paso si `role === field_operator`; el RPC re-bloquea a nivel DB (defensa en profundidad).

### Nota del flake transitorio de la Animal suite (no es regresión)

El 1er run de `check.mjs` del reviewer dio rojo por un **flake de timeout en la Animal suite** (remota,
~71 s corrida sola); re-corrida aislada 47/47 verde y `check.mjs` completo re-corrido cerró verde. **No
es regresión de esta feature** (la Fase 4 es UI, no toca la DB de la Animal suite). En este run
consolidado final la Animal suite corrió 47/47 verde dentro de `check.mjs` sin flake.

---

## Run consolidado FINAL — 3 nits del reviewer + entry point (Fase 5)

> **Alcance**: cerrar los 3 nits NO bloqueantes del reviewer sobre el wizard ya APROBADO + el entry
> point (Fase 5, T5.1 + T5.2). **NO** se tocó la capa de datos/backend/parsers (solo se consumen).

### A — 3 nits del wizard

1. **Import muerto `useMemo`** (`import-rodeo.tsx` L27) — RESUELTO: el screen no usa `useMemo` (el
   hook sí, ahí queda); se sacó del import de `react`. (El typecheck no lo flageaba: sin `noUnusedLocals`.)
2. **CategoryBadge del preview no renderizaba** — RESUELTO (WIRE): el hook nunca pasaba el label de
   categoría, así que `item.categoryLabel` era siempre null → badge muerto. Ahora `buildPreview`
   construye `categoryLabelByIndex` con **el texto CRUDO de la columna de categoría que el operador
   mapeó** ("lo que dice tu archivo", ej. "Vaca"/"Vaquillona") — `row.category`, el MISMO valor que
   `resolveCategory`/`buildRpcRow` mandan al RPC como `category_code` (no se duplica la resolución
   server-side de R10.3). Solo para filas **válidas** con categoría no vacía; SIGSA (sin columna de
   categoría → `row.category` null) y "sin mapear" → sin badge, automático. El valor se capa a
   `CATEGORY_BADGE_MAX=32` (defensa: texto opaco del archivo, R3.5; solo se muestra en un `<Text>`,
   sin sink) y `CategoryBadge` usa `numberOfLines={1}` (sin overflow). Lógica pura nueva
   `buildCategoryLabelByIndex` en `import-ui.ts` + 5 tests nuevos en `import-ui.test.ts`
   (15→20 verdes): texto crudo solo válidas-con-categoría; no-válida con categoría NO entra; SIGSA →
   mapa vacío; cap a CATEGORY_BADGE_MAX; wire end-to-end del `categoryLabel` del preview.
3. **Bitácora** — RESUELTO: la sección "## Progreso" (arriba) quedó completa.

### B — Entry point (Fase 5)

- **T5.1 — `app/app/rodeos.tsx`**: CTA "Importar rodeo" (ícono lucide `Upload`), **owner/vet only**
  (`canImport = role === 'owner' || role === 'veterinarian'`; field_operator NO, R2.4 — el RPC ya lo
  bloquea a nivel DB, esto es la barrera de UX), fila de acción icono+texto (el `Button` canónico es
  solo-texto; reusamos el patrón de las acciones de RodeoCard — `$touchMin`, `$pill`, borde `$primary`,
  a11y por `buttonA11y`) que hace `router.push('/import-rodeo')`. Ubicado bajo "Crear rodeo".
  Re-ejecutable (R1.1). Solo se muestra con ≥1 rodeo (`hasRodeos` — el wizard también bloquea sin
  rodeo, R1.4; acá ni lo ofrecemos para no confundir). NO se tocó `_layout.tsx` (la ruta ya estaba
  registrada + en `RODEO_DESTINATIONS`). **Marcado [x] T5.1 en tasks.md.**
- **T5.2 — flag de onboarding (R1.2) — HECHO**: enganche LIMPIO en `app/app/crear-rodeo.tsx`, en el
  punto natural post-creación del PRIMER rodeo (bloqueo total = onboarding). Antes hacía
  `router.replace('/(tabs)')` directo; ahora pasa por un estado `onboardingDone` que renderiza
  `OnboardingImportOffer` (componente nuevo en el mismo archivo, mismo esqueleto de footer fijo +
  insets): CTA primario "Importar mi rodeo existente" → `/import-rodeo`, CTA secundario "Más tarde, ir
  al inicio" → `/(tabs)`. Es una **oferta, no un paso obligatorio** (R1.2). Solo en el flujo de
  onboarding (el alta de un 2do rodeo desde Rodeos mantiene `replace('/rodeos')` — ahí ya está el CTA
  de T5.1, sin duplicar). El que llega al bloqueo total es siempre el owner. Tras crear, el RodeoContext
  pasa a 'active' y tanto `crear-rodeo` como `import-rodeo` están en `RODEO_DESTINATIONS` → el RootGate
  no expulsa de la oferta ni del wizard. **Marcado [x] T5.2 en tasks.md.**

### Autorrevisión adversarial (run consolidado)

Busqué activamente, como revisor hostil:
- **Desviación del spec / badge a medias**: ¿el badge muestra la categoría RESUELTA por el RPC (que
  duplicaría lógica server-side) o la del archivo? → la del **archivo** (`row.category`), que es lo que
  el brief pide ("lo que dice tu archivo") y es exactamente el `category_code` que se manda al RPC
  (`buildRpcRow`). No se duplica el placeholder por sexo de R10.5. ✓
- **Edge: badge con valor faltante / SIGSA / sin columna**: `buildCategoryLabelByIndex` no agrega
  entrada si `row.category` es null/vacío → `CategoryBadge` no se renderiza (PreviewRow guard
  `item.status === 'valid' && item.categoryLabel`); `CategoryBadge` además retorna null si el label
  trimmeado es vacío. Tres tests cubren no-válida/SIGSA/sin-categoría. ✓
- **Edge: categoría gigante (no confiable a escala, R3.5)**: capada a `CATEGORY_BADGE_MAX` + `<Text>`
  sin sink + `numberOfLines={1}`. Test del cap. ✓
- **Gate de rol del CTA de import (R2.4)**: `canImport` excluye `field_operator` (solo owner/vet); el
  RPC re-bloquea a nivel DB. Verificado contra el tipo `UserRole` de `estState.role`. El gate de
  `field_operator` en el wizard mismo ya estaba (run 1). ✓
- **Tests que pasan por la razón equivocada**: los tests del badge verifican el reject real (no-válida
  NO entra; SIGSA mapa vacío) y el valor exacto ("Torito"/"Vaquillona" trimmeado), no solo "no rompe". ✓
- **Cero hardcode (ADR-023 §4)**: `check-hardcode.mjs` 0 violaciones; íconos lucide con literal `size`
  (convención del repo + del propio `import-rodeo.tsx` aprobado) y `color` por `getTokenValue`; spacing
  por tokens. ✓
- **Multi-tenant / offline-first**: el CTA de import deriva el establishment del contexto (no hardcode);
  el import es online por diseño (R12.1/R12.2, ya cubierto en run 1). ✓

### Verificación (run consolidado)

- `pnpm.cmd typecheck` (app) — **verde**.
- `node scripts/check-hardcode.mjs` — **0 violaciones**.
- `node scripts/check.mjs` end-to-end — **verde**: client unit tests **562/562** (import-ui 15→20),
  RLS/Edge/Animal **47/47** (sin flake este run)/Maneuvers/user_private/import **25/25**. Sin regresión.
- `import-ui.test.ts` ya estaba enganchada en `run-tests.mjs` L53 (NO se tocó el runner — el test
  nuevo va dentro del mismo archivo ya listado).

### Para el leader

- Reconciliar specs: `tasks.md` T5.1/T5.2 marcadas [x]. Conviene una nota en `requirements.md`/`design.md`
  de que el CTA de import en Rodeos es una **fila de acción icono+texto** (el `Button` canónico es
  solo-texto, no soporta `icon`) y que la oferta de onboarding (R1.2) vive en `crear-rodeo.tsx` como
  estado post-creación (`OnboardingImportOffer`), no en `onboarding.tsx`.
- Quedan Fase 6 (T6.1 ya hecho — suites enganchadas; T6.2 verde; T6.3 = esta autorrevisión) + Gate 2 +
  Puerta final. No marco `done` (espera al reviewer + Gate 2).
