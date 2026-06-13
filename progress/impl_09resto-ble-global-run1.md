baseline_commit: b0700ff49c14f991b8bdb66bcc40bf611c1b4e33

# Impl — spec 09 chunk "BLE global" · Run 1 (backbone)

**Feature**: 09-buscar-animal (chunk "09 resto · BLE global"), in_progress.
**Run**: 1 de 2 (lógica pura + plumbing chico, SIN overlay/chip/provider-mount/E2E — eso es Run 2).
**Spec**: `specs/active/09-buscar-animal/{context,requirements,design}-09resto-ble-global.md` (RB1..RB9, design §3/§5/§8).

## Alcance EXACTO del Run 1 (solo esto)
- T1. `buildLookupTagAcrossFieldsQuery(tag)` en `local-reads.ts` (RB4.6 / design §3.3) + su test.
- T2. Tipo `TagLookupResult` + `lookupByTag(tag, establishmentId)` (3 ramas edit/transfer/create, RB4) + unit tests de las 3 ramas.
- T3. `crear-animal.tsx`: aceptar el param `tag` → precargarlo read-only (rama BLE de R4.2 / RB6.3); no romper idv/visual; actualizar comentario stale.
- T4. `useBusyWhileMounted()` cableado en `crear-animal.tsx`, `animal/[id].tsx`, `agregar-evento.tsx` (RB2.2). No-op seguro sin provider (Run 2).

## NO en Run 1 (es Run 2)
- Provider mount en `_layout.tsx`, `FindOrCreateOverlay`, `BleConnectionChip`, wiring E2E MockAdapter, `baston.spec.ts`.

---

## Decisión de patrón de tests (constraint del repo)
`animals.ts` importa `./supabase` (expo-secure-store) → NO carga bajo `node:test` (confirmado: `transfer-animal.test.ts` testea el módulo PURO, no `animals.ts`; no hay `mock.module` en el repo). El patrón as-built es: la lógica pura se extrae a un módulo SIN I/O (como `exit-animal.ts` / `transfer-animal.ts`) y se testea ahí; el wrapper I/O en `animals.ts` se consume tal cual.

→ La DECISIÓN de las 3 ramas de `lookupByTag` se extrae a `app/src/services/tag-lookup.ts` (puro, sin imports de RN/expo/supabase): `resolveTagLookup({ activeFieldRows, crossFieldRows, establishmentId })`. `lookupByTag` (en `animals.ts`) hace las 2 queries locales (`runLocalQuery`) y delega la decisión al puro. El tipo `TagLookupResult` vive en `tag-lookup.ts` y se RE-EXPORTA desde `animals.ts` (mismo patrón que `TransferAnimalInput`/`TransferAnimalResult`), así el contrato público "el tipo vive en animals.ts" se cumple (importable de `animals.ts`). Esto satisface "unit tests de las 3 ramas" sin romper el constraint del repo.

---

## Archivos tocados (rutas absolutas)
- `app/src/services/powersync/local-reads.ts` — **+** `buildLookupTagAcrossFieldsQuery(tag)` (T1).
- `app/src/services/powersync/local-reads.test.ts` — **+** 2 tests (SQL/args + integración SQLite real) (T1).
- `app/src/services/tag-lookup.ts` — **+** módulo PURO: tipo `TagLookupResult` + `resolveTagLookup(...)` (T2).
- `app/src/services/tag-lookup.test.ts` — **+** 8 unit tests de las 3 ramas + edge cases (T2).
- `app/src/services/animals.ts` — **+** `lookupByTag(tag, establishmentId)` (I/O wrapper) + re-export de `TagLookupResult` + imports (T2).
- `scripts/run-tests.mjs` — **mod** enganchar `tag-lookup.test.ts` a los unit tests del cliente (T2).
- `app/app/crear-animal.tsx` — **mod** param `tag` precargado read-only + `useBusyWhileMounted()` (T3, T4).
- `app/app/animal/[id].tsx` — **mod** `useBusyWhileMounted()` (T4).
- `app/app/agregar-evento.tsx` — **mod** `useBusyWhileMounted()` (T4).
- `specs/active/09-buscar-animal/design-09resto-ble-global.md` — **mod** reconciliación as-built (§3.1/§3.2/§7.1/§8).
- `specs/active/09-buscar-animal/tasks-09resto-ble-global.md` — **mod** T1.1/T1.2/T1.3/T4.1/T5.1 marcadas `[x]` (las del Run 1).

NO tocado (Run 2): `_layout.tsx`, `FindOrCreateOverlay`, `BleConnectionChip`, `(tabs)/animales.tsx`, `baston.spec.ts`, wiring MockAdapter. NO tocado (consumir tal cual): `app/src/services/ble/*`, `transfer-animal.ts`, `baston-test.tsx`. NINGUNA migración/RLS/Edge.

## Cómo quedó cada rama del lookup (`lookupByTag` → `resolveTagLookup`)
- **edit** (RB4.3): `buildSearchByTagQuery(establishmentId, tag)` (campo activo, UNION synced+overlay, status=active). ≥1 fila → `{ mode:'edit', profileId: rows[0].id }`. **Corto-circuito**: si matchea, NO corre la query cross-campo.
- **transfer** (RB4.4 / DEC-3): solo si edit vino vacío → `buildLookupTagAcrossFieldsQuery(tag)` (cross-campo, sin filtro de establishment). `resolveTagLookup` toma la PRIMERA fila con `establishment_id !== establishmentId` → `{ mode:'transfer', sourceProfileId, otherFieldName }`. Defensivo: ignora filas del campo activo; `establishment_name` NULL → `'otro campo'`.
- **create** (RB4.5 / DEC-2): sin match en ningún campo → `{ mode:'create' }` (DIRECTO, sin intermediate de opción A).
- Todo 100% local (`runLocalQuery`, `emptyIsSyncing:false` en ambas → "no hay match" = resultado de negocio, no "Sincronizando"). Sin red (RB9.1).

## Trazabilidad RB<n> → test concreto
- **RB4.6** (query cross-campo) → `local-reads.test.ts`: "buildLookupTagAcrossFieldsQuery: matchea TAG activo SIN filtrar por establishment + JOIN…" (SQL/args) + "…integración SQLite — encuentra el activo en OTRO campo, ignora deleted/no-activo…".
- **RB4.3** (rama edit) → `tag-lookup.test.ts`: "rama EDIT — match activo en el campo activo → { mode:edit, profileId }" + "toma el PRIMER match activo" + "EDIT GANA sobre transfer".
- **RB4.4** (rama transfer) → `tag-lookup.test.ts`: "rama TRANSFER — sin match activo, pero activo en OTRO campo…" + "ignora DEFENSIVAMENTE una fila cross-campo que sea del campo ACTIVO" + "name del otro campo NULL → fallback genérico".
- **RB4.5** (rama create) → `tag-lookup.test.ts`: "rama CREATE — sin match en ningún campo → { mode:create }" + "si la ÚNICA fila cross-campo es del campo activo → cae a create".
- **RB4.1/RB4.2/RB9.1** (offline-first, tipo) → cubiertos por las 8 ramas arriba (decisión pura) + el wrapper `lookupByTag` que solo usa `runLocalQuery` (verificado por typecheck + inspección: sin `supabase.rpc`/red).
- **RB6.3** (param tag read-only en crear-animal) → verificación E2E es Run 2 (T8.2 escenario b). Run 1: typecheck + lint + inspección del render (`prefillKind==='tag'` → FormField read-only; idv/visual editables; comentarios actualizados).
- **RB2.2** (busyMode en 3 forms) → verificación E2E es Run 2 (T8.2 escenario c). Run 1: hook cableado al top de los 3 componentes (typecheck verde; no-op seguro sin provider).

## Autorrevisión adversarial (paso 8)
Busqué activamente, como revisor hostil:
- **Orden de las ramas / doble conteo**: `lookupByTag` corre edit primero y corta-circuita; `resolveTagLookup` re-chequea edit > transfer > create. Sin doble conteo. Test "EDIT GANA sobre transfer" lo fija.
- **Fila del campo activo colándose en transfer**: la query cross-campo NO filtra por establishment → podría traer una fila del campo activo. `resolveTagLookup` usa `.find(r => r.establishment_id !== establishmentId)` → la ignora. Tests: "ignora DEFENSIVAMENTE…" + "si la ÚNICA fila cross-campo es del campo activo → create".
- **`buildSearchByTagQuery` proyecta `id`?**: verificado (`LOCAL_LIST_SELECT` proyecta `ap.id AS id`; overlay `pap.id AS id`). `lookupByTag` lee `{ id }` → profileId correcto.
- **Param `tag` rompiendo el camino manual**: la prioridad es tag > idv > visual SOLO si el param tag está presente; sin tag, el flujo manual queda idéntico (idv/visual). El campo TAG editable se oculta solo en la rama BLE; idv/visual siguen editables. `tag` state arranca del param solo si `prefillKind==='tag'`. Sin regresión.
- **Dead-end silencioso por TAG inválido**: si llegara un `tag` malformado por deep-link a mano, `isValidTagElectronic` lo rechazaría y `tagError` se setearía pero el campo read-only no lo mostraba → FIX: pasé `error={tagError}` al FormField read-only de la rama BLE (el bastón real solo entrega EIDs válidos, así que es defensa de borde).
- **Tests que pasan por la razón equivocada**: los tests de `resolveTagLookup` ejercen el path real de decisión con las MISMAS filas que cada query produce; el de integración SQLite ejercita el SQL real (no un mock). El "EDIT GANA" pasa BOTH active+cross para probar robustez (en `lookupByTag` real cross=[] cuando hay edit, por el corto-circuito → más fuerte, no más débil).
- **Hooks rules**: `useBusyWhileMounted()` está al top de los 3 componentes, antes de cualquier return condicional. Typecheck verde.
- **Seguridad / multi-tenant**: lookup es local-read puro (Gate 1 N/A). `tag`/`establishmentId` parametrizados (`?`), sin injection. `establishmentId` del contexto (param), nunca hardcodeado. La query cross-campo no debilita RLS (la stream ya scopea por has_role_in; RB9.2). Sin RPC/schema/Edge nuevos.

## Reconciliación de specs (paso 9)
Mi implementación quedó distinta del wording literal del design en un punto estructural (el tipo + la decisión viven en `tag-lookup.ts`, no inline en `animals.ts`), por testabilidad (constraint del repo: `animals.ts` no carga bajo node:test). Reconciliado en `design-09resto-ble-global.md`:
- §3.1: nota de reconciliación as-built (split a `tag-lookup.ts` + re-export, por qué).
- §3.2: el wrapper I/O delega a `resolveTagLookup`; corto-circuito + emptyIsSyncing:false documentados.
- §7.1: los tests de las 3 ramas corren sobre `resolveTagLookup` (no mock de `runLocalQuery`).
- §8: tabla de archivos actualizada (`tag-lookup.ts` + test + `run-tests.mjs`).
`requirements.md` (RB) NO cambió: el QUÉ (3 modos, offline, contrato del tipo público) se cumple sin desviación — solo cambió DÓNDE vive el tipo, que es decisión de diseño, no de requisito. `tasks.md`: T1.1/T1.2/T1.3/T4.1/T5.1 `[x]` con la nota del as-built.

## Resultado de `node scripts/check.mjs`
VERDE end-to-end (exit 0): typecheck del cliente OK, lint anti-hardcode 0 violaciones, unit del cliente (incl. los 10 tests nuevos: 8 de `tag-lookup` + 2 de `buildLookupTagAcrossFieldsQuery`), suites backend (RLS/Edge/Animal+spec11/Maneuvers/user_private/Import/Sync-streams/Operaciones-rodeo) todas pass. "All tests passed." + "Entorno listo."

> **Nota (falso-rojo transitorio observado)**: una corrida intermedia de `check.mjs` salió roja con `Error: signIn(...): Request rate limit reached` en el setup de la suite Animal (spec 11), por correr la suite backend repetidas veces seguidas (rate-limit de Supabase Auth) → los `TypeError: Cannot read properties of undefined (reading 'id')` posteriores eran fixtures sin crear por el setup fallido. NO es del código de Run 1 (frontend/local puro; no toca el RPC ni los tests de spec 11). Tras ~90s de cooldown, la suite Animal corrió aislada VERDE (98 pass / 0 fail) y el `check.mjs` completo VERDE (exit 0). Si Gate 2 ve un rojo de rate-limit, esperar el cooldown y re-correr.

## Sorpresas / bloqueantes
- **Sin bloqueantes.** El BLOQUEANTE design §10.1 (¿`establishments` sincronizado con `name`?) quedó descartado: lo usan `buildMembershipsQuery`/`buildEstablishmentDetailQuery` → está en el set local con `name`. El JOIN cross-campo es válido.
- **Constraint de testing del repo** (sorpresa esperable): `animals.ts` importa `./supabase` (expo-secure-store) → no carga bajo `node:test`; el repo no usa `mock.module`. Resuelto con el patrón as-built (extraer la lógica pura a un módulo sin I/O, como `transfer-animal.ts`/`exit-animal.ts`). Reconciliado en specs.
- Los BLOQUEANTES §10.3 (resolución de rodeo/categoría destino del transfer) y §10.4 (wiring E2E del MockAdapter) son de Run 2 — NO tocados en Run 1.
