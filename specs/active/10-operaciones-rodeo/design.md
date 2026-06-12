# Spec 10 — Operaciones masivas por rodeo + vista de grupo — Design

**Status**: reconciliado 2026-06-11 (Gate 0 v2 + staleness vs Tier 2 as-built). Gate 1 re-corrido 2026-06-11: **PASS 0 HIGH / 2 MEDIUM / 3 LOW** (`progress/security_spec_10-operaciones-rodeo.md` §"Spec reconciliada v2"); M1/M2 + L1 foldeados (fix-loop 2026-06-11). **Puerta 1 APROBADA por Raf (2026-06-11) — LIM-1=mitigar con observación / LIM-2=tolerar-y-saltear foldeadas** (fix-loop #2): observación automática de castración (§3.5) + propagación tolerante con pre-filtro (§4.2(4)). ⚠ El delta de LIM-2 (trigger de propagación) requiere **re-chequeo puntual de Gate 1** — lo lanza el leader (§6).
**Fuente**: `context-v2-seleccion.md` (gana donde choca) + `context.md` + `requirements.md` reconciliado.
**Reusa as-built**: spec 02 backend (0013–0067: tablas de evento, `rodeo_data_config`, `management_groups`, **Tier 2 categorías**: 0059 seed novillito/novillo, 0060 `animals.is_castrated`, 0061/0067 `nursing`, 0062 `compute_category`, 0063 triggers delegados, 0064 transición de castración, 0066 cron de edad), spec 02 frontend **C1–C4 DONE** (rodeos, alta+lista, ficha, lotes — rutas Expo Router en `app/app/`, services en `app/src/services/`), spec 03 (gating capa 2, 0054/0056), spec 13 (0068–0072), spec 15 PowerSync (sync streams JOIN-free `sync-streams/rafaq.yaml`, CRUD plano `runLocalWrite`, denormalizaciones 0077–0080, outbox; ADR-025/026), chunk C6 (espejo `computeCategoryCode` en `app/src/utils/animal-category.ts`).

> **Regla de oro reconciliada**: vacunación y destete = **N eventos individuales idénticos a los que ya se cargan uno por uno**; castración = **N UPDATEs del estado `is_castrated`** (sin evento tipado, D10) **+ N observaciones automáticas** (`animal_events 'observacion'`, §3.5 — LIM-1 mitigada, Puerta 1 2026-06-11). Nada crea entidades nuevas ni un "evento colectivo". El grueso es **cliente** (vista de grupo + pantalla de selección + preview + offline). El delta de DB es chico pero existe (§4): `future_bull` + denormalización de `is_castrated` + recompute simétrico — **Gate 1 re-corre sobre eso**.

---

## 1. Resumen de capas y archivos

### 1.1 Cliente (grueso de la feature) — interacción lockeada por Gate 0 v2, estética TENTATIVA

Convenciones as-built: rutas = Expo Router en `app/app/` (kebab-case), componentes en `app/src/components/`, services en `app/src/services/`, utils puros en `app/src/utils/`. Nombres de ruta/archivo **propuestos** (el implementer los alinea al patrón as-built si difieren; no duplica lógica).

| Archivo | Capa | Qué hace | Cubre |
|---|---|---|---|
| `app/app/(tabs)/index.tsx` (evolución de la home as-built) | route | Inicio rodeo-céntrico: cards de rodeo + cards de lote → vista de grupo | R2.1, R2.2 |
| `app/app/rodeo/[id].tsx` y `app/app/lote/[id].tsx` | route | Vista de grupo (rodeo / lote): metadatos + config + lista de animales activos + acciones masivas | R1.1, R1.3, R1.4, R1.5, R1.6, R7.1 |
| `app/app/seleccion-masiva.tsx` (params: `groupType`, `groupId`, `op: 'castrate'\|'wean'`) | route | **Pantalla de selección explícita** (D6–D9, D11): secciones, checkboxes, CTA vivo, bottom-sheet | R11.1–R11.9, R5.6 |
| `app/app/vacunacion-masiva.tsx` (params: grupo) | route | Vacunación masiva: pre-config + filtro + preview + skip-report + progreso | R3.1, R4.1–R4.4, R10.3, R10.4 |
| `app/src/components/GroupActionsBar.tsx` | component | Botonera de las 3 acciones (Vacunar/Destetar gated; Castrar siempre) | R1.4, R1.5, R1.6 |
| `app/src/components/AnimalRow.tsx` (**reuso, se extiende**) | component | Variante **compacta** (≥56px) + slot checkbox + badge ⭐ + "categoría · edad" — sin redefinir el componente | R11.9, R12.3 |
| `app/src/utils/bulk-candidates.ts` | util puro | Candidatos por operación (active + scope grupo + reglas D3/D4 + filtro vacunación + gating por rodeo real) | R1.3, R4.1, R4.3, R7.2, R11.2, R11.4 |
| `app/src/utils/bulk-selection.ts` | util puro | Estado de selección: secciones por categoría, defaults pre-tildados, todos/ninguno, contadores, desglose para el bottom-sheet | R11.3, R11.4, R11.5, R11.7, R11.8 |
| `app/src/utils/bulk-idempotency.ts` | util puro | Clave idempotente (animal, tipo, fecha) + `id` UUIDv5 determinístico (solo ops de evento) | R6.1 |
| `app/src/utils/bulk-operations-plan.ts` (**AS-BUILT, Fase 3**) | util puro | **Núcleo PURO del service** (testeable sin SDK): `planVaccination`/`planWeaning`/`planCastration` (decide los statements por animal — 1 evento / 2 castración, idempotencia, batches) + `drainBulkPlan` (drenado independiente con writer inyectado, progreso + rechazos por animal). El service inyecta `runLocalWrite` + `InteractionManager`. Mismo patrón que `event-timeline.ts`↔`events.ts`. | R3.x, R6.1, R6.3, R10.2, R10.5 |
| `app/src/utils/castration-copy.ts` (**AS-BUILT, Fase 3**) | util puro | Fuente ÚNICA del copy es-AR de la observación (§3.5): "Castrado" / "Corrección: marcado como no castrado". Consumido por `setCastrated` (ficha) y `bulk-operations` (masiva) → el texto no diverge. | R13.7 |
| `app/src/services/bulk-operations.ts` | service | Genera/encola las N mutaciones locales en batch (eventos vía patrón `events.ts`; castración vía UPDATE `animal_profiles` **+ observación automática por animal, §3.5**); expone progreso "X de N" + rechazos. **AS-BUILT: wrapper de I/O sobre `bulk-operations-plan.ts`** (resuelve ids existentes/establishments del SQLite local + drena el plan vía `runLocalWrite`; `InteractionManager.runAfterInteractions` entre batches). | R3.x, R13.7, R10.1–R10.5 |
| `app/src/services/animals.ts` (**extensión**) | service | `setCastrated(profileId, value)` (ficha, R13.1 — **crea también la observación automática, §3.5**) + `setFutureBull(profileId, value)` (ficha, R12.2) — UPDATEs locales CRUD plano | R13.1, R13.4 (lado cliente), R13.7, R12.2, R12.4 |
| `app/src/services/events.ts` (**reuso**) | service | `addObservation`/`buildAddObservationInsert` as-built: la observación automática de castración entra por este mismo camino (INSERT plano `animal_events`, offline) — sin service nuevo | R13.7 |
| `app/app/animal/[id].tsx` (**extensión de la ficha as-built**) | route | Fila "Castrado Sí/No" editable + toggle ⭐ futuro torito + badge | R13.1, R13.2, R12.2, R12.3 |
| `app/src/utils/animal-category.ts` (**chunk C6, se cablea**) | util puro | El espejo recibe `is_castrated` REAL (de `animal_profiles` local) en vez de la inferencia RC6.2.1 | R13.6, R10.6 |
| `app/src/services/powersync/schema.ts` (**extensión**) | schema | Columnas nuevas en `animal_profiles` local: `is_castrated`, `future_bull` | R13.3, R12.1 |

> **AS-BUILT — chunk UI-A (nav + vista de grupo, 2026-06-11; T-UI.1/T-UI.2/T-UI.3).** Reconciliación de los archivos reales de este chunk (los nombres "propuestos" de arriba se materializaron así; los del próximo chunk —`seleccion-masiva`/`vacunacion-masiva` reales, ficha— siguen pendientes):
> - **Vista de grupo (T-UI.1):** `app/app/rodeo/[id].tsx` + `app/app/lote/[id].tsx` quedan FINAS sobre un scaffold presentacional compartido `app/src/components/GroupViewScreen.tsx` (+ `GroupViewBits.tsx`: `GroupMetaHeader`/`GroupAnimalsList`) y un hook `app/src/hooks/useGroupView.ts` (load + foco + sync-reload — los hooks orquestan services, architecture.md). El **gating** se partió en: util PURO `app/src/utils/group-actions.ts` (`resolveGroupActions`/`buildRodeoGating`/`isDataKeyEnabled`, fail-closed; lote cross-rodeo = "algún rodeo" — R7.1) + service `app/src/services/group-data.ts` (`fetchRodeoGroupActions`/`fetchLoteGroupActions`, cruza `field_definitions` data_key→field_id [`fetchFieldCatalog` as-built] con `rodeo_data_config` enabled [`fetchRodeoConfig` as-built], todo SQLite local). `GroupActionsBar.tsx` rinde las 3 acciones **outline** (orden Vacunar→Destetar→Castrar; ninguna primary — Castrar es deliberada, no la acción por defecto). La navegación a la selección/vacunación va por `app/src/utils/group-nav.ts` (`navigateToGroupAction`) a las **rutas STUB** `app/app/seleccion-masiva.tsx` + `app/app/vacunacion-masiva.tsx` (placeholders navegables; las pantallas reales son los chunks T-UI.4–T-UI.6). Rutas registradas en `app/app/_layout.tsx` (+ `GROUP_DESTINATIONS` en el RootGate para no expulsarlas en estado 'active').
> - **Inicio rodeo-céntrico (T-UI.2):** `(tabs)/index.tsx` gana secciones "Mis rodeos" (de `RodeoContext.available`) + "Lotes" (de `fetchManagementGroups`) con cards `app/src/components/GroupSummaryCard.tsx` (nombre + cabezas activas + chevron → vista de grupo). Conteos: builders nuevos `buildRodeoHeadCountsQuery`/`buildGroupHeadCountsQuery` (local-reads.ts; GROUP BY + UNION overlay + oculta exits) → `fetchRodeoHeadCounts`/`fetchGroupHeadCounts` (group-data.ts). El Stepper de onboarding queda DEBAJO (y se OCULTA cuando los 3 pasos de primeros-pasos están completos — `onboarding.ts`/`allOnboardingStepsDone`, iter2 2026-06-12). La **tab `Animales` NO se tocó** (R2.3). El **nombre del sistema productivo** de la card de rodeo (R2.1) SÍ se muestra ("Cría · N cabezas" vía el prop `meta` de `GroupSummaryCard`, alimentado por `fetchProductionSystems` del SQLite local; iter2 2026-06-12) — solo las cards de RODEO lo llevan, las de LOTE no (un lote no tiene sistema único). La **"señal de atención"** de la card (R2.1) se DIFIERE (deriva de reglas de negocio / analytics = feature 07). Íconos canónicos (iter2): **rodeo = `Boxes` (cubos), lote = `Layers` (pila)** — unificado en todo `app/` (incl. `mas.tsx` y la ficha del animal).
> - **AnimalRow compacto (T-UI.3):** `AnimalRow.tsx` gana props `compact`/`age`/`categoryCode`/`futureBull`/`checked`/`onToggle` (la fila grande default intacta — la tab Animales no cambia). Edad: util PURO `app/src/utils/animal-age.ts` (`formatAnimalAge` desde `animal_birth_date`). Badge ⭐ `FutureBullBadge` (terracota, helper exportado `shouldShowFutureBullBadge` — solo positivo + oculto en `toro`, R12.3). El `RowCheckbox` queda LISTO para la selección del próximo chunk (no se usa acá). Para alimentar la fila por animal, `AnimalListItem` ahora expone `animalBirthDate` + `futureBull`, y `LOCAL_LIST_SELECT` proyecta `future_bull` (synced `ap.future_bull`; overlay `0` — el alta nace sin flag) además del `animal_birth_date` que ya traía. *(Esto adelanta levemente lo que §4.4 anticipaba: `future_bull` ya no lo trae SOLO `fetchAnimalDetail` — también la lista, porque la fila compacta de la vista de grupo lo necesita por animal.)*

### 1.2 Backend (delta — TBD numeración, ver §9 D6)

| Migration (numeración TBD al implementar; as-built en disco llega a **0083** → usar la siguiente libre ≥0084, verificando también el remoto) | Qué hace | Cubre |
|---|---|---|
| `00NN_future_bull.sql` | `animal_profiles.future_bull` + trigger de normalización (solo machos; auto-clear al castrar) | R12.1, R12.4 |
| `00NN_denormalize_is_castrated.sql` | `animal_profiles.is_castrated` denormalizado: backfill + force-INSERT + propagación down + **write-through up** | R13.3, R13.4 |
| `00NN_castration_recompute_symmetric.sql` | Reemplaza el cuerpo de `tg_animals_apply_castration` (0064): actúa en **ambas** direcciones | R13.5 |
| `supabase/tests/rls/` (runners Node, ADR-012) | Tests RLS + comportamiento de los triggers nuevos + no-loop + tenant-safety | R9.2, R12.x, R13.x |

> **ELIMINADO respecto de la versión anterior** (Gate 0 v2 §Implicancias 1): el seed del data_key `castracion` en `field_definitions`/`system_default_fields`, la rama de castración en `tg_sanitary_events_gating` y el marcador `product_name='Castración'`. **No se toca** el trigger de gating de 0054 ni el catálogo. (Los findings H1/M1/L1 del Gate 1 s21 aplicaban a ese delta y quedan sin objeto.)

> **No hay tabla nueva, ni Edge Function, ni RPC invocable por clientes, ni policy RLS nueva.** Sí hay **funciones de trigger nuevas** (SECURITY DEFINER + `revoke execute`, patrón 0079/0055) — superficie que Gate 1 audita (§6).

---

## 2. Modelo de datos — destinos de escritura por operación

### 2.1 Tabla resumen (reconciliada)

| Operación | Mutación por animal | Tabla destino | Gating capa 1 (UI) | Gating capa 2 (DB, as-built) | Transición de categoría |
|---|---|---|---|---|---|
| **Vacunación masiva** | INSERT evento | `sanitary_events` (`event_type='vaccination'`, `campaign_id NULL`) | `vacunacion` | ✅ `tg_sanitary_events_gating` → `assert_data_keys_enabled(['vacunacion'])` (0054) | no aplica |
| **Destete masivo** | INSERT evento | `reproductive_events` (`event_type='weaning'`) | `destete` | ❌ **no existe rama as-built** para `weaning` (0054 solo gatea tacto/tacto_vaquillona/service-ai) — límite documentado, no se reabre | ✅ automática: 0063 → `compute_category` (0062): ternera→vaquillona, ternero→torito/novillito |
| **Castración masiva** | UPDATE estado | `animal_profiles.is_castrated = true` + `future_bull = false` (write-through a `animals.is_castrated`, §4.2) | sin gating (no es dato configurable) | no aplica (no es evento) | ✅ automática: 0064 **extendido a simétrico** (§4.3): torito→novillito, toro→novillo; revert: novillito→torito, novillo→toro |

### 2.2 Aclaración `sanitary_campaigns` (sin cambios)

Verificado contra 0026: **`sanitary_campaigns` NO existe** — `sanitary_events.campaign_id` es un `uuid` suelto. La vacunación masiva escribe `sanitary_events` directo con `campaign_id = NULL`. Si una feature futura introduce campañas, podrá poblarlo; no es requisito MVP.

### 2.3 Candidatos por operación (`bulk-candidates.ts`, util puro testeable)

```ts
// base común (R1.3): activos del grupo
base = profiles.filter(p => p.status === 'active' && p.deleted_at == null)
               .filter(byGroupScope(group))        // rodeo_id == group | management_group_id == group

// vacunación (R4.1, R4.3): base + filtro opcional categoría/sexo − skips(already_applied | rodeo_data_key_disabled)
// castración (R11.2 — D3):  base.filter(p => p.animal_sex === 'male' && !p.is_castrated)
//   defaults (R11.3 — D3/D6): preChecked = categoría 'ternero' && !p.future_bull
// destete    (R11.4 — D4):  base.filter(p => categoryCode(p) ∈ {'ternero','ternera'} && !hasWeaning(p))
//   defaults: TODOS pre-tildados. En lote cross-rodeo: excluir los de rodeo sin 'destete' enabled,
//   con contador "N excluidos por configuración del rodeo" (R7.2, criterio del autor).
```

Los inputs (`animal_sex`, `is_castrated`, `future_bull`, categoría, eventos `weaning`) están **todos en el SQLite local** post-denorm (0079 + §4.2) — el armado funciona 100% offline.

---

## 3. Lógica de cliente

### 3.1 Flujo vacunación masiva (modelo Gate 0 original — sin cambios)

```
Vista de grupo → "Vacunar" (gated R1.5/R1.6)
  → vacunacion-masiva: pre-config (product_name, fecha) + filtro opcional (R4.1)
  → preview: "N eventos sobre N animales" + "K saltados (motivos)" (R4.2, R4.3)
  → confirmar → N INSERTs locales batcheados (R10.1/R10.5), id UUIDv5 (R6.1)
  → progreso: "X de N sincronizados" + rechazos por animal (R10.3, R10.4)
```

### 3.2 Flujo castrar / destetar (selección explícita — Gate 0 v2)

```
Vista de grupo → "Castrar" | "Destetar" (verbo pelado, D1)
  → seleccion-masiva:
      header: título + contador vivo "12 seleccionados" (D6/D8)
      [búsqueda solo si candidatos > ~20 (D11)]
      Sección "Terneros" (castración: pre-tildados los comunes; ⭐ adentro sin tildar)  [D3/D6]
        ─ fila = AnimalRow compacto + checkbox (≥56px, orden por ID)                  [D11]
        ─ fila ⭐ tildada → resaltado terracota, SIN modal                              [D7]
        ─ "todos / ninguno" por sección                                                [D6]
      Sección "Adultos" (castración: torito/toro no castrados, sin tildar)             [D3]
      (destete: secciones Terneros / Terneras, TODOS pre-tildados; sin lógica ⭐)      [D4]
      CTA fijo abajo: "CASTRAR 12 ANIMALES" (vivo; disabled en 0)                      [D8]
  → tap CTA → bottom-sheet sobre la misma pantalla                                     [D9]
      desglose por categoría ("8 terneros · 3 toritos · 1 toro")
      "⚠ 2 futuros toritos incluidos" (solo castración, si aplica)                     [D7]
      "N con categoría fijada manual no van a cambiar de categoría" + revertir (R5.6)
      copy: "Podés corregirlo después desde la ficha de cada animal."  ← NUNCA amenazante
      [CONFIRMAR]  [Volver]
  → confirmar → N mutaciones locales batcheadas:
      castración: UPDATE animal_profiles SET is_castrated=1, future_bull=0 WHERE id=?
                  + INSERT animal_events 'observacion' ("Castrado") por animal (§3.5, R13.7)
                  → 2 CrudEntries/animal
      destete:    INSERT reproductive_events 'weaning' (patrón events.ts, id UUIDv5)
  → la lista/ficha reflejan la categoría nueva AL TOQUE, offline, vía espejo C6 con is_castrated real (R10.6)
  → progreso de sync: "X de N" + rechazos por animal (R10.3/R10.4)
```

### 3.3 Ficha del animal (D2 + D10)

- **"Castrado Sí/No"** (solo machos): fila editable con confirmación que anticipa el recálculo — el target se calcula localmente con el espejo C6 (`computeCategoryCode` con `isCastrated` invertido): "La categoría se recalcula: Novillito → Torito". Write = `setCastrated(profileId, value)` → UPDATE local de `animal_profiles.is_castrated` (+ `future_bull=0` si value=true) **+ observación automática (§3.5, 1+1 CrudEntries)** → sube por CRUD plano → write-through server (§4.2) → 0064 simétrico transiciona → history. **Sin evento tipado** (R13.2): el timeline muestra la **observación** en todos los casos (incluido `ternero` — LIM-1 mitigada, Puerta 1 2026-06-11) y además el cambio de categoría vía `animal_category_history` cuando hubo transición.
- **Toggle ⭐ "Futuro torito"** (solo machos, solo ficha, R12.2): UPDATE `future_bull`. Badge visible solo positivo; oculto si la categoría es `toro` (regla de display, cliente). Sin observación automática (no es castración).

### 3.4 Gating en cliente (capa 1)

- **Rodeo**: Vacunar si `vacunacion` enabled; Destetar si `destete` enabled (`rodeo-config.ts` as-built, cacheado offline). Castrar: siempre (R1.5).
- **Lote cross-rodeo**: ofrecer la op gateada si **algún** rodeo del lote la tiene (R7.1); al aplicar/listar, resolver el rodeo real por animal y saltar/excluir (R7.2).
- El cliente nunca es la única defensa donde existe capa 2 (vacunación); para destete la capa 1 es la única barrera **as-built** (límite documentado en R7.3 — no se inventa una rama nueva).

### 3.5 Observación automática de castración (R13.7 — LIM-1 mitigada, Puerta 1 2026-06-11)

Cada flip de `is_castrated` aplicado desde la app crea **client-side, junto al UPDATE**, una observación en `animal_events` — el rastro atribuible que D10 (sin evento tipado) no daba en `ternero`.

- **Camino**: reuso del as-built `addObservation`/`buildAddObservationInsert` (`events.ts`): INSERT plano local → upload queue (offline-safe, patrón spec 15). `event_type='observacion'` (Modelo Híbrido 0034, **sin gating** — `animal_events` no pasa por `rodeo_data_config`). `establishment_id` derivado del **perfil** (el trigger de 0034 valida coincidencia, 23514 si no). `author_id` **no se manda**: el trigger `animal_events_set_author_id` lo setea a `auth.uid()` del que sube = usuario actual (idéntico a una observación manual; localmente queda NULL hasta el sync-down — mismo comportamiento as-built, sin gap nuevo). `id` de cliente random (`crypto.randomUUID`, patrón R6.4 de spec 15) — **no** UUIDv5: la observación se crea exactamente una vez por apply local; el dedup determinístico cruzado entre dispositivos borraría la autoría de uno de los dos actores (micro-edge de doble observación entre dos dispositivos offline aceptado; el UPDATE en sí es idempotente por valor).
- **Copy es-AR** (funcional; ajuste menor de microcopy permitido, el contenido no): castrar → **"Castrado"**; revertir → **"Corrección: marcado como no castrado"**. El revert **también** deja observación (simetría — la corrección es tan auditable como el acto).
- **Cardinalidad**: masiva = N UPDATEs + N observaciones (2 CrudEntries/animal, batcheadas juntas); toggle de ficha = 1+1.
- **Independencia (residual aceptado)**: observación y UPDATE son CrudEntries independientes (R10.2, sin transacción) — un rechazo asimétrico de sync puede dejar flip sin observación o viceversa; visible vía R10.3. Coherente con el modelo N-mutaciones-independientes de toda la spec.
- **Atribución best-effort, NO tamper-evidence** (L5 del re-gate 2026-06-11): la observación es un rastro informativo — su `author_id` es default-if-null (0034, spoofeable intra-tenant, familia SEC-SPEC-03/D7) y su autor puede soft-deletearla en cualquier momento (`deleted_at` no está en los inmutables de `enforce_edit_window`). La verdad auditable del castrado es `is_castrated`; LIM-1 no promete auditoría inviolable.
- **Qué NO es**: ni un evento tipado CASTRAR (D10 firme), ni un trigger server-side (la DB no escribe observaciones — el flip server-side puro, p. ej. la propagación §4.2(4), no genera observación: solo los flips aplicados desde la app). Superficie de seguridad: **cero delta** — tabla, RLS, triggers y sync stream (`est_animal_events`) son as-built de 0034/spec 15.

---

## 4. Delta de backend (DB) — SCHEMA-SENSITIVE → Gate 1 re-corre

> Numeración **TBD al implementar**: as-built en disco llega a `0083_create_animal_rpc.sql`; usar las siguientes libres (≥0084) verificando disco + remoto al momento de aplicar. Tres migraciones (o una sola con las tres secciones — a criterio del implementer, manteniendo el orden de abajo: la denorm de §4.2 debe existir antes de cablear el cliente).
>
> **AS-BUILT (impl 2026-06-11) — números finales y ORDEN DE APLICACIÓN (reconciliación):** disco verificado = `0083`; remoto verificado vía Management API (la denorm `is_castrated`/`future_bull` NO existían; `animals.is_castrated` y `tg_animals_apply_castration` SÍ, cuerpo == cita de §4.3). Archivos: **`0084_denormalize_is_castrated.sql`** (§4.2), **`0085_future_bull.sql`** (§4.1), **`0086_castration_recompute_symmetric.sql`** (§4.3). ⚠ **La denorm (§4.2) se aplica ANTES que `future_bull` (§4.1)** — invirtiendo el §-orden presentacional del design — porque el trigger `animal_profiles_normalize_future_bull` de §4.1 **lee `new.is_castrated`**, columna que crea §4.2: dependencia real (un apply en el orden §4.1→§4.2 falla con `42703: column "is_castrated" does not exist`). El design dejaba la numeración "TBD" y solo exigía "la denorm debe existir antes de cablear el cliente"; aplicar la denorm primero también lo cumple. Las 3 migraciones traen su propio `begin;`/`commit;` (atomicidad por migración; requisito de `scripts/apply-migration.mjs`) y son **idempotentes** (`add column if not exists`, `create or replace function`, `drop trigger if exists`+`create trigger`, `revoke` re-emitible). Aplicadas vía `scripts/apply-migration.mjs` (Management API `database/query` — mismo mecanismo que 0068-0083; **no** toca el ledger de `apply_migration`). Schema verificado DESPUÉS: 2 columnas nuevas, 4 funciones de trigger nuevas con `revoke`/`SECURITY DEFINER`/`search_path`, recompute simétrico instalado, orden de triggers BEFORE correcto contra `pg_trigger`.

### 4.1 `future_bull` (R12.1, R12.4)

```sql
-- 00NN_future_bull.sql — flag "futuro torito" (Gate 0 v2 D2). Decisión de manejo per-perfil:
-- NO viaja en venta/transferencia (un perfil nuevo en otro campo arranca false).
alter table public.animal_profiles
  add column if not exists future_bull boolean not null default false;

comment on column public.animal_profiles.future_bull is
  'Futuro torito (spec 10, Gate 0 v2 D2). Decisión de manejo del campo: solo machos; se marca desde la ficha; auto-clear al castrar (trigger normalize). No viaja entre campos.';

-- Normalización (solo machos + auto-clear al castrar). SILENCIOSA (no raise): D2 define auto-clear
-- al castrar; para sexo no-macho se elige la misma semántica (un future_bull=true sobre hembra es
-- siempre un error de payload — se normaliza a false, fail-safe, sin romper flujos legítimos como
-- la corrección de sexo macho→hembra que propagaría 0079). [criterio del autor — validar Puerta 1]
--
-- ⚠ ORDEN DE TRIGGERS (BEFORE, alfabético): debe correr DESPUÉS de
-- animal_profiles_force_animal_identity (0079, fuerza animal_sex en INSERT) para leer el sexo ya
-- forzado. 'animal_profiles_normalize_future_bull' > 'animal_profiles_force_animal_identity'
-- alfabéticamente ('n' > 'f') → orden correcto. Gate 1 lo verifica.
create or replace function public.tg_normalize_future_bull ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.future_bull = true and (coalesce(new.animal_sex, '') <> 'male' or new.is_castrated = true) then
    new.future_bull := false;
  end if;
  return new;
end; $$;
revoke execute on function public.tg_normalize_future_bull () from public, authenticated, anon;

drop trigger if exists animal_profiles_normalize_future_bull on public.animal_profiles;
create trigger animal_profiles_normalize_future_bull
  before insert or update of future_bull, is_castrated, animal_sex on public.animal_profiles
  for each row execute function public.tg_normalize_future_bull();
```

*(Se descarta el CHECK declarativo `future_bull = false OR animal_sex = 'male'`: una corrección de sexo propagada por 0079 sobre un perfil con `future_bull=true` lo violaría y rompería la propagación; el trigger normaliza en vez de fallar — alternativa §8.D.)*

### 4.2 Denormalización de `is_castrated` (R13.3, R13.4) — patrón 0079, con write-through

```sql
-- 00NN_denormalize_is_castrated.sql — cierra el finding F1 de C6 (design-c6 §7):
-- animals está FUERA del sync set (ADR-026 b1) → ni la castración offline ni el espejo C6
-- tienen el dato sin esta denorm. Fuente de verdad física sigue siendo animals.is_castrated (0060).

-- (0) Columna espejo en animal_profiles (mismo tipo/default que animals, 0060).
alter table public.animal_profiles
  add column if not exists is_castrated boolean not null default false;
comment on column public.animal_profiles.is_castrated is
  'Denormalizado de animals.is_castrated (spec 10, estilo 0079/ADR-026). Mantenido por: force en INSERT (fiel a animals), propagación animals→profiles, y WRITE-THROUGH profiles→animals (es el write-path offline de la castración: animals no sincroniza). A diferencia de la identidad (0079), NO se fuerza en UPDATE: es editable por diseño (0060).';

-- (1) BACKFILL (idempotente). El AFTER UPDATE write-through que se crea en (3) queda guardado por
--     IS DISTINCT FROM → el backfill no rebota contra animals.
update public.animal_profiles ap
   set is_castrated = a.is_castrated
  from public.animals a
 where a.id = ap.animal_id
   and ap.is_castrated is distinct from a.is_castrated;

-- (2) FORCE en INSERT del perfil: copia desde animals (un perfil nuevo nace fiel; anti-spoof del alta).
--     SOLO INSERT: en UPDATE el cliente DEBE poder escribirla (write-path de castración) — ver header.
create or replace function public.tg_force_is_castrated_on_profile_insert ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select a.is_castrated into new.is_castrated
  from public.animals a where a.id = new.animal_id;
  new.is_castrated := coalesce(new.is_castrated, false);
  return new;
end; $$;
revoke execute on function public.tg_force_is_castrated_on_profile_insert () from public, authenticated, anon;
drop trigger if exists animal_profiles_force_is_castrated on public.animal_profiles;
create trigger animal_profiles_force_is_castrated
  before insert on public.animal_profiles
  for each row execute function public.tg_force_is_castrated_on_profile_insert();

-- (3) WRITE-THROUGH up (perfil → animal): el único write-path de la app es el UPDATE del perfil
--     (animal_profiles sincroniza; animals no). Guard IS DISTINCT FROM en ambos lados corta el ciclo.
--     El UPDATE a animals dispara: animals_apply_castration (0064→§4.3, recompute) y la
--     propagación down de (4) — que reescribe el MISMO valor en los perfiles → no-op → FIN del ciclo.
create or replace function public.tg_profile_is_castrated_writethrough ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_castrated is distinct from old.is_castrated then
    update public.animals
       set is_castrated = new.is_castrated
     where id = new.animal_id
       and is_castrated is distinct from new.is_castrated;
  end if;
  return new;
end; $$;
revoke execute on function public.tg_profile_is_castrated_writethrough () from public, authenticated, anon;
drop trigger if exists animal_profiles_is_castrated_writethrough on public.animal_profiles;
create trigger animal_profiles_is_castrated_writethrough
  after update of is_castrated on public.animal_profiles
  for each row execute function public.tg_profile_is_castrated_writethrough();

-- (4) PROPAGACIÓN down (animal → sus perfiles CON RODEO VIVO), estilo 0079(3). Mantiene fieles los
--     perfiles de TODOS los campos del animal (compartido, ADR-004). El guard evita UPDATEs no-op.
--     TOLERAR-Y-SALTEAR (LIM-2, decisión de Raf en Puerta 1 2026-06-11): el PRE-FILTRO espeja el
--     predicado EXACTO de tg_animal_profiles_rodeo_check (0021) para que ningún UPDATE anidado
--     pueda raisear por rodeo muerto y abortar la cadena — el perfil huérfano se SALTEA (queda
--     stale, inconsistencia aceptada) y se deja constancia en el log del servidor.
create or replace function public.tg_propagate_is_castrated_to_profiles ()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_skipped int;
begin
  update public.animal_profiles ap
     set is_castrated = new.is_castrated
   where ap.animal_id = new.id
     and ap.is_castrated is distinct from new.is_castrated
     and exists (                          -- pre-filtro = predicado exacto de rodeo_check (0021)
       select 1 from public.rodeos r
       where r.id = ap.rodeo_id
         and r.establishment_id = ap.establishment_id
         and r.active = true
         and r.deleted_at is null
     );
  -- Visibilidad mínima del skip (server-side; sin superficie cliente — ver análisis abajo):
  select count(*) into v_skipped
  from public.animal_profiles ap
  where ap.animal_id = new.id
    and ap.is_castrated is distinct from new.is_castrated;
  if v_skipped > 0 then
    raise log 'is_castrated propagation: skipped % orphan profile(s) of animal % (inactive/soft-deleted rodeo)',
      v_skipped, new.id;
  end if;
  return new;
end; $$;
revoke execute on function public.tg_propagate_is_castrated_to_profiles () from public, authenticated, anon;
drop trigger if exists animals_propagate_is_castrated on public.animals;
create trigger animals_propagate_is_castrated
  after update of is_castrated on public.animals
  for each row execute function public.tg_propagate_is_castrated_to_profiles();
```

**Por qué pre-filtro y no manejo de excepción (LIM-2, justificación):** (1) es **set-based** — un solo UPDATE, sin loop por perfil con sub-transacciones/savepoints (`BEGIN…EXCEPTION` por fila es caro y secuencial); (2) **espeja el predicado exacto** del check que abortaría (`rodeo_check`, 0021) — determinístico, sin adivinar errcodes; (3) un handler de excepción tendría que atrapar `23514` genérico y **enmascararía errores legítimos** de `identity_check`/`category_check` (mismo errcode), que acá deben seguir abortando: esos checks re-validan valores que la propagación no cambia, así que solo fallarían ante corrupción real — y eso queremos verlo, no tragarlo. **Visibilidad del skip**: `RAISE LOG` server-side por animal, **sin** skip-report en la UI de la masiva — el perfil huérfano es típicamente de **otro establecimiento** (animal compartido) y reportarlo filtraría info cross-tenant; además el flip del operario ya tuvo éxito (no hay canal de error que activar). **Reconciliación del huérfano**: sin job activo — el perfil stale converge en el próximo cambio de `is_castrated` del animal con su rodeo ya vivo (el guard `IS DISTINCT FROM` lo recoge); mientras tanto su `future_bull` tampoco se auto-limpia (el normalize de §4.1 corre vía el UPDATE que acá se saltea) — parte de la misma inconsistencia aceptada. El UPDATE **directo** del perfil propio (cliente) sigue sujeto a `rodeo_check` fail-closed — caso prácticamente inalcanzable desde la masiva (los candidatos salen de un grupo activo); si ocurre, visible vía R10.3.

**Análisis de no-loop (Gate 1 lo re-verifica):** UPDATE perfil (cliente) → (3) UPDATE `animals` (solo si distinto) → 0064/§4.3 recompute + (4) UPDATE de los perfiles (solo si distinto; el originante ya tiene el valor → no lo toca; los demás perfiles se actualizan y SUS write-through (3) encuentran `animals` ya igual → no-op). Cero recursión. La propagación de (4) además dispara el normalize de §4.1 (`OF is_castrated`) → `future_bull` se auto-limpia en **todos** los perfiles del animal castrado (defensa en profundidad de R12.4).

**Interacción con los checks always-on de 0021 (Gate 1 v2 M1 → resuelta por PRE-FILTRO, Puerta 1 2026-06-11):** `identity_check`/`rodeo_check`/`category_check` son `BEFORE INSERT OR UPDATE` **sin lista de columnas** → re-disparan en cada UPDATE de esta cadena (los N de la masiva y los anidados de la propagación). No escriben (el no-loop se sostiene). El punto de aborto que M1 señalaba (`rodeo_check` sobre un perfil con rodeo inactivo/soft-deleted) queda **neutralizado por el pre-filtro de (4)**: la propagación ya no alcanza a esos perfiles — los **saltea** (LIM-2 RESUELTA: tolerar-y-saltear, decisión de Raf). Detalle, justificación y semántica del skip arriba en (4) y en §6.1; caso testeado en T-DB.4(e).

**Análisis de poder (Gate 1):** el write-through permite que un UPDATE de `animal_profiles` (RLS: `has_role_in(establishment_id)` del perfil) termine escribiendo `animals.is_castrated`. **No es escalamiento**: la policy as-built `animals_update` (0022/0071) ya permite a ese mismo usuario el UPDATE directo de `animals` (caller con rol en cualquier campo con perfil del animal). El caso "animal compartido entre campos A y B": un user de A castra → afecta la categoría del perfil en B — **semánticamente correcto** (la castración es física, DD-2/0060) y es exactamente el acceso legítimo documentado en 0071. Sin cambio de frontera.

### 4.3 Recompute simétrico (R13.5) — fix exacto sobre 0064

Verificado contra `0064_castration_transition.sql`: el guard as-built (líneas 28–31) es

```sql
  if not (old.is_castrated = false and new.is_castrated = true) then
    return new;
  end if;
```

→ el revert `true → false` **no recalcula** (RT2.2.6 de spec 02 Tier 2, ahora superseded por D10). Fix: **reemplazar SOLO el cuerpo** de la función real `tg_animals_apply_castration` (CREATE OR REPLACE; el trigger `animals_apply_castration` AFTER UPDATE OF `is_castrated` de 0064 **no se re-crea**), cambiando el guard a dirección-agnóstico y conservando todo lo demás (perfil activo único, respeto de override, delegación a `compute_category`, `apply_auto_transition` + history):

```sql
-- 00NN_castration_recompute_symmetric.sql — D10: castrado es ESTADO editable y reversible →
-- el recompute debe ser SIMÉTRICO. Supersede RT2.2.6 ("true->false no revierte") de spec 02
-- Tier 2 — nota de reconciliación en esa spec la coordina el leader.
create or replace function public.tg_animals_apply_castration ()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_profile_id uuid;
  v_override boolean;
  v_current uuid;
  v_target uuid;
begin
  -- SIMÉTRICO (spec 10 R13.5): cualquier cambio real de is_castrated recalcula.
  -- false->true: torito->novillito / toro->novillo. true->false: novillito->torito / novillo->toro.
  if new.is_castrated is not distinct from old.is_castrated then
    return new;
  end if;
  select id, category_override, category_id
    into v_profile_id, v_override, v_current
  from public.animal_profiles
  where animal_id = new.id and status = 'active' and deleted_at is null
  limit 1;
  if v_profile_id is null then return new; end if;
  if v_override is null or v_override = true then return new; end if;  -- R4.9 / RT2.2.5

  v_target := public.compute_category(v_profile_id);   -- delega: consistencia con 0062 (RT2.10.1)
  if v_target is not null and v_target is distinct from v_current then
    perform public.apply_auto_transition(v_profile_id, v_target);      -- history auto_transition
  end if;
  return new;
end; $$;
-- revoke ya emitido en 0064; re-emitir idempotente (patrón 0055):
revoke execute on function public.tg_animals_apply_castration () from public, authenticated, anon;
```

`compute_category` (0062) ya maneja ambas direcciones sin tocarlo (rama macho: `is_castrated` decide novillito/novillo vs torito/toro). El cron 0066 no necesita cambios (su filtro targeted es de **edad**; el revert lo cubre este trigger on-change). En `ternero` el cambio de `is_castrated` no transiciona nada (compute devuelve `ternero` hasta destete/1 año) — correcto en ambas direcciones.

### 4.4 Cliente/sync — acompañamiento del delta

- `app/src/services/powersync/schema.ts`: declarar `is_castrated` y `future_bull` en la tabla local `animal_profiles`. **AS-BUILT (T-CL.12): hechas (`column.integer`); GUARD de `schema.test.ts` actualizado + test dedicado.**
- `sync-streams/rafaq.yaml`: `est_animal_profiles` ya hace `SELECT * FROM animal_profiles ...` → las columnas nuevas viajan sin tocar el YAML; **verificar al implementar** si el deploy de streams requiere re-publish para tomar columnas nuevas (nota operativa, no de diseño). **AS-BUILT: el YAML NO se tocó (SELECT *).**
- Espejo C6: pasar `isCastrated: profile.is_castrated` real; retirar (o degradar a fallback documentado) la inferencia `inferIsCastrated(storedCode)` de RC6.2.1 — coordinar la nota de reconciliación en los docs de C6 (leader). **AS-BUILT (T-CL.12 completa el cableado de T-CL.7): los SELECT de lista/detalle/búsqueda (`LOCAL_LIST_SELECT` + detail synced + `buildSearchUnion`) proyectan `ap.is_castrated`; las ramas overlay proyectan `0` constante (alta/ternero optimista nace entero). `computeMirrorOverrides` (animals.ts) pasa el `is_castrated` REAL (con `toBool`) a `computeDisplayOverrides`, que ya le da PRECEDENCIA sobre `inferIsCastrated` (la inferencia queda como fallback solo para filas que no lo proyecten). `AnimalDetail` expone `isCastrated`/`futureBull` (estado crudo para la ficha de Fase 4 — R13.1 toggle, R12.3 badge).**

---

## 5. RLS / seguridad — sin superficie de autorización nueva (pero con triggers nuevos)

**Roles (R9.1).** Vacunación/destete: N inserts que pasan uno a uno por las policies de INSERT as-built (`has_role_in(establishment_of_profile(animal_profile_id))`, spec 02 R6.8/R11.5) — cualquier rol activo. Castración: N UPDATEs que pasan por `animal_profiles_update` (`has_role_in(establishment_id)`, `using = with check`) — cualquier rol activo; equivalente en poder al UPDATE directo de `animals` que el as-built ya concede (0071). No hay endpoint "bulk" privilegiado.

**Aislamiento por animal (R9.2).** Cada mutación evalúa su RLS por fila. Lote cross-rodeo: todos los animales de un lote son del mismo establishment (spec 02 R2.14) — sin cruce posible. Animal compartido entre campos: ver §4.2 "análisis de poder".

**`created_by` (R9.3).** Solo aplica a las ops de evento; hereda `tg_set_created_by_auth_uid` (0024, solo-si-NULL, spoofeable intra-tenant — SEC-SPEC-03, condición sistémica documentada, fix transversal backlogged §9 D7). La castración no tiene `created_by`; la transición queda en `animal_category_history` como `auto_transition`.

**Funciones nuevas (R9.4).** Las 4 funciones de trigger de §4 son `SECURITY DEFINER` + `set search_path = public` + `revoke execute from public, authenticated, anon` — **no** invocables como RPC (lección SEC-HIGH-01/0055). Ninguna recibe parámetros del cliente: derivan todo de `NEW`/`OLD` de la fila que la RLS ya filtró (mismo argumento de seguridad que 0064/0079).

**Gating (R7.3).** Sin cambios sobre 0054: vacunación gateada por animal fail-closed; `weaning` sin rama (límite as-built documentado); castración no gateable. **No se modifica `tg_sanitary_events_gating`.**

---

## 6. Gate 1 (security_analyzer modo `spec`) — APLICA y DEBE RE-CORRERSE

El PASS del 2026-06-01 auditó el delta viejo (data_key + rama de gating) que ya no existe. Esta versión es SCHEMA-SENSITIVE por el delta de §4 (triggers SECURITY DEFINER sobre `animal_profiles`/`animals` + columna que alimenta la frontera de sync). Gate 1 debe verificar como mínimo:

> ⚠ **RE-CHEQUEO PUNTUAL PENDIENTE (lo lanza el leader):** el PASS del 2026-06-11 auditó la propagación de §4.2(4) **sin pre-filtro** (versión que abortaba fail-closed). El fold de LIM-2 (Puerta 1, 2026-06-11) cambió ese trigger: pre-filtro que espeja `rodeo_check` + `RAISE LOG`. Delta acotado a esa función — el re-chequeo puede ser puntual (ítem 1 abajo, actualizado). La observación automática de §3.5 NO agrega superficie (tabla/RLS/stream as-built de 0034).

1. **No-loop** del trío write-through/propagación/recompute (§4.2): guards `IS DISTINCT FROM` en ambos sentidos; cero recursión. **Interacción real con los triggers as-built de `animal_profiles`** *(prosa corregida por Gate 1 v2 M1 — la versión anterior afirmaba "sin interacción", falso)*: los de 0030 (history), 0040 (override) y 0054 (teeth-gating) no escuchan `OF is_castrated`/`future_bull`, y el 0079-force no incluye estas columnas; **pero los tres checks de 0021 (`animal_profiles_identity_check`, `animal_profiles_rodeo_check`, `animal_profiles_category_check`) son `BEFORE INSERT OR UPDATE` SIN lista de columnas → disparan en TODOS los UPDATEs de `is_castrated`/`future_bull`**, incluidos los N de la masiva y los anidados de la propagación (§4.2(4)). Son re-validaciones idempotentes que no escriben otras tablas → el no-loop se sostiene igual. El punto de aborto que esto creaba (`rodeo_check` exige `rodeos.active = true AND deleted_at IS NULL`) quedó **resuelto por decisión de Raf en Puerta 1 (2026-06-11): TOLERAR-Y-SALTEAR** — la propagación de §4.2(4) lleva un **pre-filtro** que espeja el predicado exacto de `rodeo_check`, de modo que los UPDATEs anidados nunca alcanzan un perfil con rodeo muerto: la castración aplica en el perfil propio + perfiles con rodeo vivo, saltea el huérfano (queda stale — inconsistencia aceptada, requirements §Limitaciones LIM-2) y deja `RAISE LOG`. **Verificar en el re-chequeo puntual**: que el pre-filtro espeja 0021 sin desviación (mismo predicado → mismo conjunto que NO abortaría), que el skip no abre escritura sobre perfiles que la versión anterior tampoco tocaba con éxito, y que el `RAISE LOG` no filtra datos sensibles cross-tenant (solo ids + count). Caso testeado en T-DB.4(e).
2. **Análisis de poder del write-through** (§4.2): que el UPDATE perfil→animals no exceda lo que `animals_update` (0071) ya concede; nuance del animal compartido documentada y aceptada.
3. **Orden alfabético de triggers BEFORE** en `animal_profiles` (normalize de §4.1 después del force de 0079) — que la suposición se sostenga con los nombres finales.
4. `revoke execute` en las 4 funciones nuevas (no exponer RPCs); `SECURITY DEFINER` + `search_path` fijo.
5. Que **no** se haya tocado `tg_sanitary_events_gating` ni el catálogo (la eliminación del delta viejo es completa), y que la vacunación masiva siga cayendo en la rama as-built fail-closed.
6. `future_bull`/`is_castrated` en el wire de sync (`est_animal_profiles SELECT *`): no exponen datos de otro tenant (columnas de la propia fila per-establishment) — ADR-025.
7. El reemplazo de `tg_animals_apply_castration` conserva: respeto de override, perfil activo único, `apply_auto_transition` (revocada de clientes, 0042), y no introduce camino cross-tenant (deriva de `NEW.id` de la fila real).

---

## 7. Offline-first, idempotencia y performance

**Todo offline (R10.1).** Armado + selección/preview + aplicar corren sobre SQLite local. Las N mutaciones usan el camino as-built de feature 15: `runLocalWrite` (CRUD plano) → CrudEntry → `uploadData` al reconectar (RLS + triggers re-validan). Sin canal especial "bulk". La castración escribe `animal_profiles` (sincronizada) — **nunca** `animals` (fuera del sync set): por eso existe el write-through de §4.2.

**Independientes, no atómicas (R10.2).** Cada mutación es una CrudEntry; sin rollback de exitosas.

**Idempotencia (R6.x).**
- *Ops de evento* (vacunación, destete): dos barreras — (1) exclusión local de ya-procesados (skip `already_applied` / lista de candidatos); (2) **id UUIDv5 determinístico obligatorio** sobre `(animal_profile_id, tipo, fecha)` → colisión en PK ante syncs concurrentes, dedup a nivel DB sin constraint nuevo (M2 Gate 1 s21, conservado). Límite consciente: dos vacunas legítimas el mismo día se cargan por el flujo individual (id random) — sin falsos positivos.
- *Castración*: idempotente por semántica (estado absoluto; re-UPDATE = no-op por valor; guards `IS DISTINCT FROM` evitan triggers de gusto; 0064 solo transiciona si target ≠ actual). Los ya castrados no son candidatos (D3).

**Transiciones visibles offline (R10.6).** El espejo C6 con `is_castrated` real + eventos locales muestra la categoría nueva al instante (castración: novillito; destete: vaquillona/torito) sin esperar el recálculo server ni el sync-down. Display-only; converge al sincronizar (misma semántica que C6).

**Volumen (R10.5).** Batches (~100) con `InteractionManager`/idle para no bloquear UI; progreso "generando N…" + "X de N sincronizados"; upload incremental nativo de PowerSync.

**Rechazos por animal (R10.3).** Reusa el canal de status/error de `uploadData` (spec 15 R8.1: el rechazo permanente se descarta del queue y se superficia); la pantalla de progreso lo agrega por animal con motivo. Nada en silencio.

---

## 8. Alternativas descartadas

**A. Evento colectivo único — DESCARTADA** (sin cambios): rompe corrección individual, cronología por animal, transiciones por evento; tabla+RLS nuevas. El context lo prohíbe.

**B. RPC `SECURITY DEFINER` bulk transaccional — DESCARTADA** (sin cambios): rompe offline-first; todo-o-nada es peor offline; superficie definer nueva; duplica gating/RLS.

**C. Castración como evento sanitario con marcador (`event_type='treatment'` + `product_name='Castración'`) — el diseño ANTERIOR de esta misma spec, DESCARTADA por Gate 0 v2 (D10).** Motivos: (1) doble fuente de verdad (evento + `is_castrated`) con drift posible; (2) exigía data_key + rama de gating + normalización de marcador (los findings H1/M1/L1 del Gate 1 s21 fueron costo directo de esa complejidad); (3) "des-castrar" no tiene evento natural → la corrección quedaba asimétrica; (4) la historia ya queda en `animal_category_history` (origen del timeline) sin ruido. El estado editable es más simple, reversible y honesto con el modelo físico (0060).

**D. CHECK declarativo para `future_bull` solo-machos — DESCARTADA** a favor del trigger de normalización (§4.1): un CHECK sobre `animal_sex` denormalizado haría fallar la propagación de identidad de 0079 ante una corrección de sexo sobre un perfil con `future_bull=true`; el trigger normaliza silencioso (fail-safe) y además implementa el auto-clear al castrar en el mismo lugar.

**E. Sincronizar `animals` (stream `est_animals`) en vez de denormalizar `is_castrated` — DESCARTADA**: `animals` es global sin `establishment_id` único → no entra al modelo JOIN-free (ADR-026, PSYNC_S2305); reabriría la frontera de sync entera por una columna. La denorm 0079-style es el patrón ya validado.

**F. Forzar `is_castrated` también en UPDATE (0079 estricto) + write-path vía RPC/outbox — DESCARTADA**: mataría el único write-path offline simple (CRUD plano sobre la tabla sincronizada, patrón validado en feature 15) y obligaría a un outbox tipo `register_birth` para un UPDATE trivial. El force-en-UPDATE protege identidad inmutable; `is_castrated` es editable por diseño (0060) y su escritura ya está autorizada as-built (0071).

---

## 9. Decisiones abiertas / coordinación

| # | Tema | Estado / default | Quién confirma |
|---|---|---|---|
| D1 | Efecto de categoría de la castración | **CERRADO as-built** (0059/0062/0064: torito→novillito, toro→novillo, corte 730d) | cerrado (Facundo, sesión Tier 2 2026-06-03) |
| D2 | Transición de destete | **CERRADO as-built** (0062/0063: ternera→vaquillona, ternero→torito/novillito) | cerrado |
| D3 | Marca en la madre al destetar | Fuera de MVP de esta spec (`nursing` as-built 0061/0067 es de spec 02) | — |
| D4 | Marcador de castración | **ELIMINADO** (Gate 0 v2 D10 — alternativa §8.C) | cerrado |
| D5 | Idempotencia ops de evento | id UUIDv5 obligatorio (M2 s21, vigente para vacunación/destete) | cerrado |
| D6 | **Numeración de migraciones** | TBD al implementar: as-built en disco = 0083 → siguiente libre ≥0084, verificar también remoto/terminales paralelas | implementer + leader |
| D7 | `created_by` no-spoofeable en tablas de evento | BACKLOGGED transversal (SEC-SPEC-03) — sin cambios | Raf |
| D8 | Normalización silenciosa de `future_bull` (vs raise) | **VALIDADA tal cual** (Raf, Puerta 1 2026-06-11) | cerrado |
| D9 | Exclusión-de-lista como skip-equivalente en destete cross-rodeo (R7.2) + lista de destete = solo `ternero`/`ternera` sin weaning (R11.4) | **VALIDADA tal cual** (Raf, Puerta 1 2026-06-11) | cerrado |
| D10 | Nota de reconciliación en spec 02 Tier 2 (RT2.2.6 superseded por el recompute simétrico) | Pendiente — la coordina el leader al implementar (no se editan docs de spec 02 desde esta spec) | leader |
| D11 | Umbral de búsqueda (~20) y variante compacta de `AnimalRow` (≥56px) | Lockeado el patrón (Gate 0 v2 D11); constante exacta y tokens = design system | implementer/design system |
| D12 | LIM-1: observación automática al castrar/revertir (R13.7, §3.5; copy "Castrado" / "Corrección: marcado como no castrado") | **DECIDIDA por Raf** (Puerta 1 2026-06-11) | cerrado |
| D13 | LIM-2: propagación tolerar-y-saltear (pre-filtro espejo de `rodeo_check`, §4.2(4); `RAISE LOG`, sin skip-report UI) | **DECIDIDA por Raf** (Puerta 1 2026-06-11) — ⚠ re-chequeo puntual de Gate 1 pendiente (leader) | cerrado (Gate 1 puntual pendiente) |

---

## 10. Trazabilidad design → requirements

- §1.1 (cliente/rutas/componentes) → R1.x, R2.x, R11.x, R12.2–R12.3, R13.1
- §2 (destinos + candidatos) → R3.x, R1.3, R11.2, R11.4, R4.1
- §3.1 (vacunación) → R4.1–R4.4, R6.2
- §3.2 (selección explícita) → R11.1–R11.9, R5.6, R10.6
- §3.3 (ficha) → R13.1, R13.2, R12.2–R12.4
- §3.4 (gating capa 1) → R1.5, R1.6, R7.1, R7.2
- §3.5 (observación automática) → R13.7, R3.3, R13.2
- §4.1 (`future_bull`) → R12.1, R12.4
- §4.2 (denorm + write-through) → R13.3, R13.4, R9.2
- §4.3 (recompute simétrico) → R13.5, R5.7
- §4.4 (schema cliente + espejo) → R13.6, R10.6
- §5 (RLS/roles/created_by) → R9.1–R9.4
- §6 (Gate 1) → condición de Puerta 1
- §7 (offline/idempotencia/performance) → R6.x, R10.x
- §8/§9 (alternativas + abiertas) → R3.3, R3.4, R12.1, R13.4

---

## Changelog

- **2026-06-01 (s21)**: diseño original — castración como evento-marker + data_key `castracion` + rama de gating; transiciones TENTATIVAS pendientes de Facundo; archivos cliente sobre nombres especulativos (`AnimalListItem`, screens/), frontend de spec 02 "en vuelo".
- **2026-06-01 (s21, Gate 1 fix-loop)**: H1 (nombre real del trigger), H2 (`created_by` spoofeable, verdad documentada), M1 (marcador canónico robusto), M2 (UUIDv5 obligatorio), L1 (seed por `.code`).
- **2026-06-11 — RECONCILIACIÓN COMPLETA**: (a) **Gate 0 v2**: castración → estado editable sin evento (se eliminan data_key/gating/marcador — H1/M1/L1 sin objeto); pantalla de selección explícita (§3.2); `future_bull` (§4.1); denorm `is_castrated` + write-through (§4.2, cierra F1 de C6); recompute simétrico (§4.3); alternativas C–F nuevas. (b) **Staleness**: destete transiciona as-built (0062/0063); efecto de castración cerrado as-built (0059/0064); límite real del gating DB (0054 no gatea weaning); archivos/rutas reconciliados al as-built Expo Router + `AnimalRow`; C1–C4 DONE; offline reconciliado a spec 15 (CRUD plano, sync streams, canal de error de upload); numeración de migraciones ≥0084 TBD. Gate 1 y Puerta 1 reseteados.
- **2026-06-11 — Fix-loop Gate 1 v2 (PASS 0H/2M/3L — folds documentales)**: **M1** — corregida la afirmación falsa "sin interacción con triggers as-built" en §6.1 y §4.2 (los checks de 0021 son BEFORE sin lista de columnas, disparan en cada UPDATE; `rodeo_check` puede abortar fail-closed la propagación hacia un perfil con rodeo inactivo/soft-deleted); **M2** — §3.3 ya no afirma que el timeline muestra el cambio en `ternero` (sin transición no hay registro; limitación en requirements §Limitaciones); **L1** — aserción del orden de triggers contra `pg_trigger` agregada a T-DB.4(f). Sin cambios de diseño.
- **2026-06-11 — Fix-loop #2 (Puerta 1 APROBADA por Raf — LIM-1/LIM-2 foldeadas)**: **LIM-1 → observación automática** (nueva §3.5: reuso `addObservation` as-built, copy "Castrado" / "Corrección: marcado como no castrado", 2 CrudEntries/animal en la masiva, 1+1 en ficha, independencia sin atomicidad como residual; §1.1/§3.2/§3.3 actualizados; cero superficie de seguridad nueva). **LIM-2 → tolerar-y-saltear**: la propagación de §4.2(4) gana un **pre-filtro** que espeja el predicado exacto de `rodeo_check` (0021) — elegido sobre manejo de excepción por ser set-based, determinístico y no enmascarar otros 23514 legítimos; `RAISE LOG` server-side como visibilidad mínima (sin skip-report UI — cross-tenant); párrafo M1 de §4.2 y §6.1 reescritos a la semántica de skip; ⚠ banner de **re-chequeo puntual de Gate 1** agregado en §6 (lo lanza el leader). §9: D8/D9 validadas tal cual; D12/D13 nuevas (decisiones de Puerta 1).
