baseline_commit: 57ffe0903235eee1e885104b5a8ad5686dbc4a40

# Bitácora — Frontend spec 02: "alta guiada" sub-chunk A (wizard de selección + override + RT2.20)

> Implementer. Frontend PURO (todo el sustrato existe en la DB). NO toca `supabase/`, NO migraciones,
> NO `feature_list.json`, NO commitear. Convierte el form plano de C2 (`crear-animal.tsx`) en un
> **wizard guiado de 4 pasos** (rodeo → sexo → categoría → datos) + lógica de override + alinea el
> espejo cliente `computeInitialCategoryCode` (RT2.20).

## Plan (T1..T5)

- **T1 — RT2.20**: reescribir `app/src/utils/animal-category.ts::computeInitialCategoryCode` a la rama
  "sin eventos" del backend (`compute_category` 0062, `is_castrated=false` en el alta):
  - macho: `<1 año` → ternero · `1–2 años` → torito · `≥2 años` → toro · null → torito.
  - hembra: `<1 año` → ternera · `≥1 año` / null → vaquillona.
  - Agregar `novillito`/`novillo` al type `InitialCategoryCode` (para cuando exista el toggle de
    castración; en el alta `is_castrated=false` → no se computan, pero el type los contempla).
  - Actualizar `animal-category.test.ts` (corte de 2 años macho + resto).
- **T2 — override puro**: helper `categoryOverrideFor(chosen, sex, birthDate)` (coincide→false,
  difiere→true) + tests.
- **T3 — service**: `fetchSystemCategories(systemId)` (code+name de `categories_by_system` del sistema
  del rodeo) para el picker; extender `createAnimal` para recibir `categoryCode` (la elegida) +
  `categoryOverride` y resolver `category_id` por code, seteando `category_override` en el insert.
- **T4 — wizard**: reescribir `crear-animal.tsx` en 4 pasos (header "Creando: [id]" + progreso
  "Paso N de 4" + back paso a paso + CTA fijo abajo). El find-or-create NO cambia.
- **T5 — E2E**: `animals.spec.ts` — alta vía wizard con override (Multípara, fecha vieja → computada
  vaquillona → override) + caso coincidente (ternera <1 año → sin override).

## Qué se reorganizó / construyó

- **T1 — RT2.20** (`app/src/utils/animal-category.ts`): `computeInitialCategoryCode` reescrita a la rama
  "sin eventos" de `compute_category` (0062) con `is_castrated=false` (el alta no tiene toggle aún):
  - macho: `<365` → ternero · `365–729` → torito · `≥730` → **toro** (corte de 2 años, lo que el
    espejo viejo NO distinguía) · null → torito.
  - hembra: `<365` → ternera · `≥365` / null → vaquillona.
  - `InitialCategoryCode` ampliado con `toro`/`novillito`/`novillo`. La rama de castración del espejo
    (novillito/novillo) queda DOCUMENTADA y contemplada en el type pero NO se computa en este chunk (el
    alta entra todo entero; se completará con el toggle de castración / op masiva spec 10).
- **T2 — override puro** (`app/src/utils/animal-category.ts`): `categoryOverrideFor(chosen, sex, birthDate, today?)`
  → `chosen.trim() !== computeInitialCategoryCode(...)`. Coincide → false (auto-transiciona); difiere →
  true (preserva la elección, A5 "vaca comprada").
- **T3 — service** (`app/src/services/animals.ts`):
  - `fetchSystemCategories(systemId)` (code+name de `categories_by_system` del sistema del rodeo,
    `active=true`, order `sort_order`) — catálogo del picker cerrado.
  - `createAnimal` extendido: recibe `categoryCode` (la ELEGIDA) + `categoryOverride` en vez de computar
    la categoría. Resuelve `category_id` por `(systemId, code)` y setea `category_override` en el insert
    del perfil. (Verificado: el trigger `tg_animal_profiles_set_override_on_manual` 0021 es BEFORE
    UPDATE OF category_id → NO pisa el override en INSERT; el valor del cliente se respeta.)
  - El import de `computeInitialCategoryCode` se sacó de `animals.ts` (la categoría ya no se computa acá).
- **T4 — picker puro** (`app/src/utils/animal-category-picker.ts`): `categoriesForSex(categories, sex)` +
  `MALE_CATEGORY_CODES`/`FEMALE_CATEGORY_CODES`. Filtra el catálogo por el mapeo conocido por code
  (macho = ternero/torito/toro/novillito/novillo; hembra = ternera/vaquillona/vaquillona_prenada/
  vaca_segundo_servicio/multipara). Deja AFUERA `cut` (marca ortogonal por dientes) y `vaca_cabana`
  (fuera del MVP de cría). Preserva el orden de entrada (sort_order). Defensivo: un code desconocido no
  se ofrece a ningún sexo.
- **T5 — wizard** (`app/app/crear-animal.tsx`): form plano → wizard de 4 pasos:
  - **Paso 1 RODEO**: 1 rodeo → fijo read-only + **auto-avanza** (one-shot ref) al paso 2; ≥2 → selector
    vertical full-width (`OptionRows`) + "Continuar". Reusa la resolución de default async (R6) + el fix
    de carrera del rodeo-default (C3.2b).
  - **Paso 2 SEXO**: 2 cards grandes Macho/Hembra full-screen (una decisión por pantalla); cambiar de
    sexo LIMPIA la categoría elegida (un code de un sexo no aplica al otro).
  - **Paso 3 CATEGORÍA**: `OptionRows` cerrado, filtrado por `categoriesForSex(catálogo del sistema, sexo)`.
    Estados loading/error/empty. Carga el catálogo por `systemId` (dep primitiva; se recarga si cambia el
    rodeo → sistemas distintos).
  - **Paso 4 DATOS**: el form de C2 (identificación recomendada + fecha nac/raza/pelaje/ingreso/peso/lote)
    MENOS rodeo y sexo (ahora pasos 1/2). CTA "Crear animal" acá.
  - **Header**: back paso a paso (2→1, 3→2, 4→3; en paso 1 → backOr a la lista) + "Creando: [id]" + barra
    de progreso "Paso N de 4" (`StepIndicator`). CTA fijo abajo (zona pulgar): "Continuar" pasos 1–3,
    "Crear animal" paso 4. Gating: no se avanza incompleto (rodeo/sexo/categoría requeridos por paso).
  - El **find-or-create NO cambia**: el id precargado read-only se mantiene (en el paso 4 + en el header).
- **Wiring**: `animal-category-picker.test.ts` enganchado en `scripts/run-tests.mjs`.

## Mapa de trazabilidad (R → test)

| Requisito (context-alta-guiada / RT2.20) | Test |
|---|---|
| RT2.20 macho ternero/torito/**toro** (corte 2 años) + null→torito | `app/src/utils/animal-category.test.ts` (RT2.20 macho < 1 año / 1–2 años / ≥ 2 años / borde 729-730 / sin fecha) |
| RT2.20 hembra ternera/vaquillona + null→vaquillona | `animal-category.test.ts` (RT2.20 hembra < 1 año / ≥ 1 año / sin fecha / borde 1 año) |
| #4 override = false (coincide) | `animal-category.test.ts` (override=false ternero / ternera; toro coincide ≥2 años) + E2E `animals.spec.ts` "COINCIDE → sin override (ternera <1 año)" |
| #4 override = true (difiere, A5 vaca comprada) | `animal-category.test.ts` (override=true multipara / toro <1 año / novillito/novillo) + E2E `animals.spec.ts` "DIFIERE → override (Multípara con fecha vieja)" |
| Categoría filtrada por (sistema, sexo) | `animal-category-picker.test.ts` (macho/hembra disjuntos, sin cut/vaca_cabana, code desconocido) + E2E "Multípara" solo en Hembra |
| Wizard rodeo→sexo→categoría→datos + find-or-create intacto | E2E `animals.spec.ts` "alta guiada desde empty → wizard" + "INEXISTENTE → CREATE con id precargado" (Creando: 77123, read-only) |
| Validación robusta en vivo (paso 4) | E2E `animals.spec.ts` "FIX2: el alta LIMITA los inputs en vivo … y rechaza submit inválido" |

## Autorrevisión adversarial

Pasada hostil sobre el propio trabajo (no pasamanos). Qué busqué y qué encontré:

- **Override en los dos sentidos**: ¿el override se setea bien cuando coincide Y cuando difiere?
  Verificado por unit (5 casos: multipara→true, ternera/vaquillona→false, toro coincide→false, toro
  <1año→true, novillito/novillo→true) + E2E real contra el remoto (Multípara queda Multípara con badge,
  "Vaquillona" count 0; Ternera coincide se crea sin drama). **Riesgo descartado**: ¿un trigger server
  pisa el override en INSERT? Revisé `tg_animal_profiles_set_override_on_manual` (0021) — es BEFORE
  **UPDATE OF category_id**, NO dispara en INSERT → el `category_override` del cliente se honra.
  `tg_reproductive_events_recompute_on_change` (0046) solo dispara sobre `reproductive_events` y respeta
  override=true. El cron (0066) es nocturno, targetea solo cría por edad y skipea override. → el alta
  con override=true NO se revierte. Confirmado empíricamente por la E2E.
- **Categoría inválida por sexo**: ¿se puede elegir "toro" para una hembra? No — `categoriesForSex` filtra
  por listas disjuntas por code; el picker solo ofrece las del sexo elegido. Además, al cambiar de sexo
  se LIMPIA la categoría elegida (`onSelectSex`) → no queda un code macho pegado a una hembra. Probado en
  unit (disjunción) + E2E (Multípara solo en Hembra).
- **Back paso a paso**: ¿el back salta bien y el auto-advance no re-salta? `goBack` decrementa el step;
  el `autoAdvancedRef` one-shot evita que volver al paso 1 (con 1 rodeo) re-salte a sexo (el usuario
  puede quedarse a revisar el rodeo). En el paso 1, backOr a la lista (no se rompe con stack vacío).
- **Find-or-create intacto**: el id precargado read-only + idv/visual editables + heurística R1.4 no
  cambian. El "Creando: [id]" en el header lo surfacea en todos los pasos. E2E "INEXISTENTE" verde.
- **novillito/novillo en el type sin romper**: typecheck OK; `computeInitialCategoryCode` nunca los
  arroja en el alta (entero); el type los contempla para el override y el futuro toggle. La rama de
  castración del espejo queda documentada como follow-up (no en este chunk).
- **Edge: catálogo no carga / sistema sin categorías**: el paso 3 tiene estados loading/error/empty
  (InfoNote) → no se traba ni avanza sin categoría (CTA gateado por `canContinueStep3`).
- **Edge: 0 rodeos**: el `InfoNote` de "creá un rodeo" + sin CTA (el RootGate de C1 ya bloquea la app sin
  rodeo, pero el guard se conserva por robustez del cold-start).
- **Tests que pasan por la razón equivocada**: el test de override aserta el badge de la categoría ELEGIDA
  Y `toHaveCount(0)` de la computada (vaquillona) — si el override fallara, el server dejaría vaquillona y
  el assert de count 0 rompería. No es un falso verde.
- **Multi-tenant**: el systemId/los codes salen del rodeo activo (no hardcode); `fetchSystemCategories`
  scopea por systemId; RLS es la barrera. `createAnimal` deriva todo del input/rodeo, sin ids hardcodeados.

No quedó nada abierto: lo que busqué o ya estaba cubierto o lo cerré antes de reportar.

## Conteos

- `node scripts/check.mjs` COMPLETO: **OK / Entorno listo**. anti-hardcode **0 violaciones**; typecheck OK;
  **client unit 337** (315 previas + 22 nuevas: 16 RT2.20/override en animal-category + 6 del picker);
  RLS 17; Edge 37 (skipped 1, fail 0); Animal 28 (skipped 1, fail 0 — preexistente); Maniobras 13;
  user_private 19. **fail 0** en todas las suites.
- `pnpm.cmd e2e`: **37 passed** (3 nuevas de alta guiada: wizard desde empty / override Multípara /
  coincidencia Ternera + las E2E de C2 adaptadas al wizard: INEXISTENTE precargado, FIX2 límites en vivo).

## Decisiones / notas para el leader

- **`cut` y `vaca_cabana` quedan AFUERA del picker de alta** (consistente con context: CUT es marca
  ortogonal por dientes, no estado a elegir; `vaca_cabana` es de cabaña, fuera del MVP de cría). El mapeo
  por code es CERRADO: un code nuevo no mapeado no se ofrece (defensivo).
- **Rama de castración del espejo (novillito/novillo) DIFERIDA** a cuando exista el toggle de
  `is_castrated` (ficha / op masiva spec 10). El type ya los contempla; el alta entra todo entero.
- **`feature_list.json` aparece modificado en el working tree pero NO lo toqué** — es un cambio de
  coordinación de otra terminal/leader (01 in_progress→deferred, 13 spec_ready→in_progress). Lo dejo como
  está. (Por eso el check ahora da OK en one_feature_at_a_time, no por mí.)
- **Sub-chunk B** (datos por categoría: el form dinámico que muestra solo los campos relevantes por
  categoría, hardcodeado §2) NO se tocó — el paso 4 dejó el form de datos de C2 tal cual (menos rodeo/sexo).
- **SIN COMMITEAR** (no commiteo). El árbol tiene trabajo ajeno de otras terminales (spec 04, impl_02
  C3.2 sin commitear) → el `add` al commitear debe ser SELECTIVO.
