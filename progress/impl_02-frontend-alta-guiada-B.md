baseline_commit: 57ffe0903235eee1e885104b5a8ad5686dbc4a40

# Bitácora — Frontend spec 02: "alta guiada" sub-chunk B (datos por categoría)

> Implementer. Frontend PURO (todo el sustrato existe en la DB: `teeth_state_enum` 0020, columna
> `nursing` 0061, `birth_date` en `animals`, eventos repro 0045 + `addConditionScore`/`addTacto`).
> NO toca `supabase/`, NO migraciones, NO `feature_list.json`, NO commitear. Convierte el **paso 4
> "datos"** del wizard de A (hoy = form plano de C2) en un **form dinámico** que muestra SOLO los
> campos relevantes a (sexo, categoría) según la tabla §2 del dominio Facundo + el override refinado
> por preñez capturada.
>
> baseline_commit = el MISMO que A (`57ffe09`): es una feature multi-sesión y el baseline es el SHA
> previo a la primera task de "alta guiada". No se sobrescribe (regla 4 del implementer).

## Plan (T1..T6)

- **T1 — mapeo PURO + dientes**: `fieldsForCategory(sex, code)` + `TEETH_OPTIONS` (lista cerrada del enum).
- **T2 — override refinado**: `computeInitialCategoryCode`/`categoryOverrideFor` con preñez capturada.
- **T3 — service**: `createAnimal` (columnas `teeth_state` + `nursing`) + eventos post-create.
- **T4 — paso 4 dinámico** (`crear-animal.tsx`): form por categoría + año-only + selectores cerrados.
- **T5 — tests unit**: mapeo + override refinado + lista de dientes + año-only.
- **T6 — E2E**: multípara · ternero · vaquillona preñada.

## Qué se construyó

### T1 — mapeo PURO + dientes (`app/src/utils/animal-category-fields.ts`, NUEVO)
- `fieldsForCategory(sex, code)` → campos EXTRA (no-base) por categoría, HARDCODEADO (tabla §2):
  - recría (ternero/ternera/vaquillona/novillito/novillo/torito) → `['weight']`.
  - vaca_segundo_servicio / multipara → `['teeth','conditionScore','pregnancy','nursing']`.
  - toro → `['teeth','conditionScore']` (circ. escrotal DIFERIDA — no existe en DB).
  - vaquillona_prenada → `['pregnancy','conditionScore']`.
  - cut / vaca_cabana / code desconocido → `[]` (solo base; el picker tampoco los ofrece).
  - `categoryHasField(sex, code, field)` (azúcar para el render condicional).
- `TEETH_OPTIONS` — lista CERRADA del enum `teeth_state_enum` (0020) con labels de campo de Facundo
  (`sin_dientes`→"Sin dientes", `2d`→"2 dientes", `boca_llena`→"Boca llena", etc.), ordenada de menos
  boca a boca llena. + `isValidTeethState` (defensa). Fuente de verdad estilo `PREGNANCY_OPTIONS`.

### T2 — override refinado (`app/src/utils/animal-category.ts`)
- `computeInitialCategoryCode(sex, birthDate, opts)`: el 3er arg pasa a `CategoryComputeOpts`
  `{ today?, pregnant? }` (o un `Date` posicional legado, por compat con los tests de A). Si
  `pregnant=true` (solo hembra) → computa `vaquillona_prenada` (la preñez GANA al corte de edad: un
  tacto+ promueve y transiciona server-side). `pregnant` NO afecta al macho.
- `categoryOverrideFor(chosen, sex, birthDate, opts)`: misma firma de opciones. Resultado:
  `vaquillona_prenada` + preñez capturada → coincide → **override=false** (corrige el sobre-bloqueo de
  A); sin la preñez → computa `vaquillona`, difiere → override=true; multipara/vaca_segundo_servicio
  (no derivables del alta) → override=true siempre.
- `InitialCategoryCode` sumó `'vaquillona_prenada'`.

### T2b — año-only + helper de preñez (`app/src/utils/animal-birth-year.ts`, NUEVO)
- `sanitizeBirthYearInput` (4 dígitos en vivo) · `validateBirthYear` (vacío válido; 4 díg; no futuro;
  ≥1980) · `birthYearToDate(year, now)` → `AAAA-07-01` (mitad de año, mínimo sesgo de edad) **clampeado
  a no-futuro** (si `07-01` cae en el futuro del año en curso → `AAAA-01-01`) · `isPregnantStatus`
  (small/medium/large=true; empty/null=false). Re-exporta `PregnancyStatus`.

### T3 — service (`app/src/services/animals.ts`)
- `CreateAnimalInput` sumó `teethState?: string | null` (columna `teeth_state`, enum) + `nursing?:
  boolean | null` (columna `nursing`). El insert los setea solo si vinieron (teeth limpio; nursing si
  no-null). Verificado: el trigger de `nursing` es AFTER INSERT sobre `reproductive_events`/
  `birth_calves`, NO sobre `animal_profiles` → NO pisa el `nursing` inicial del insert.
- Los EVENTOS (condición/preñez) NO van en `createAnimal`: se crean en el screen tras el create con
  `addConditionScore`/`addTacto` (ya existen en `events.ts`), para manejar su fallo por separado.

### T4 — paso 4 dinámico (`app/app/crear-animal.tsx`)
- El paso 4 muestra: BASE (identificación + AÑO de nacimiento + raza + pelaje + lote) + los EXTRA que
  `fieldsForCategory(sex, code)` devuelve (peso / dientes / condición / preñez / cría al pie). Selectores
  CERRADOS reusando el lenguaje de `agregar-evento`: `OptionRows` para dientes/preñez/cría al pie,
  `ScoreChips` (espejo del `ScoreSelector`) para condición. Se eliminó el form plano de C2 (sexo/rodeo ya
  son pasos 1/2; la "fecha completa" + "fecha de ingreso" se reemplazan por el año-only base).
- `onSubmit`: valida año (base) + peso (si recría) + caravana; deriva `birth_date` del año; computa el
  override refinado con `{pregnant}`; manda `teethState`/`nursing` (gateados por show*); tras el create
  llama a los eventos (condición / tacto si preñez POSITIVA).

## Cómo se CAPTURA cada dato (columnas vs eventos)
- **Columnas** (insert de `createAnimal`): `breed`, `coat_color`, `birth_date` (del año), `entry_weight`
  (peso, solo recría), `teeth_state` (dientes), `nursing` (cría al pie), `management_group_id` (lote).
- **Eventos** (post-create con el `profileId`, fechados HOY): condición corporal → `addConditionScore`;
  preñez POSITIVA → `addTacto` (small/medium/large). El tenant lo deriva la RLS (sin establishmentId).

## Decisiones (para el leader)
- **Año-only**: `birth_date = 'AAAA-07-01'` (mitad de año = mínimo sesgo de edad; 01-01 sobreestimaría
  ~1 año). **Clampeado a no-futuro**: si el año es el en curso y `07-01` aún no llegó → `AAAA-01-01`
  (autorrevisión: evitar que el server trate la fecha futura como edad desconocida). La fecha EXACTA
  (día) se edita desde la ficha (C3.3) — el alta manga-friendly pide solo el año (una decisión por campo).
- **"Vacía" en preñez**: si el alta captura preñez "Vacía" (empty) → NO se crea evento de tacto (no hay
  diagnóstico positivo que registrar en un animal recién creado; un tacto 'empty' solo ensuciaría el
  timeline). "Vacía" = no preñada = el default sin evento. Solo Cabeza/Cuerpo/Cola crean tacto+.
- **Evento que falla NO rompe el animal**: si `createAnimal` OK pero un evento post-create falla, el
  animal YA EXISTE → guardamos su `profileId`, NO re-creamos (el CTA pasa a "Ver la ficha del animal" →
  evita un DUPLICADO si el operario re-toca) + aviso suave en el form ("el animal se creó, pero no
  pudimos guardar X; tocá Ver la ficha y agregalo desde ahí"). El happy-path navega solo.
- **Override refinado**: `vaquillona_prenada` + preñez → derivable → override=false (un parto futuro la
  transiciona a vaca); multipara/vaca_segundo_servicio → override=true (no derivable, owner gestiona).
- **Toro sin condición obligatoria**: el toro pide dientes+condición (la condición es opcional como todos
  los extra; Facundo dijo "no se scorea en cría en la práctica" pero la app la OFRECE). CE diferida (no DB).

## Mapa de trazabilidad (requisito → test)

| Requisito (context-alta-guiada §2 + brief B) | Test |
|---|---|
| Mapeo "datos por categoría" §2 (recría=peso; vacas=dientes/CC/preñez/cría; toro=dientes/CC; vaq.preñada=preñez/CC) | `animal-category-fields.test.ts` (recría / vacas / toro / vaq.preñada / cut-cabana-desconocido / espacios) |
| ternero NO pide dientes; multípara NO pide peso (anti-confusión del brief) | `animal-category-fields.test.ts` ("un ternero NUNCA pide dientes; una multípara NUNCA pide peso") |
| Lista de dientes (enum + labels de campo Facundo) | `animal-category-fields.test.ts` (TEETH_OPTIONS 8 valores / labels / isValidTeethState) |
| Override refinado: vaq.preñada + preñez → false | `animal-category.test.ts` (B: vaquillona_prenada + preñez → override=FALSE) + E2E "VAQUILLONA PREÑADA … badge SIN override" |
| Override refinado: multípara → true (no derivable) | `animal-category.test.ts` (B: multipara/vaca_segundo_servicio → override=TRUE) + E2E "MULTÍPARA … fijada manualmente" |
| Override: recría coincidente → false | `animal-category.test.ts` (B: recría coincidente) + E2E "COINCIDE → sin override (vaquillona sin año)" |
| computeInitialCategoryCode(hembra, pregnant) → vaquillona_prenada | `animal-category.test.ts` (B: computeInitialCategoryCode pregnant) |
| pregnant no afecta al macho | `animal-category.test.ts` (B: pregnant NO afecta al macho) |
| Año-only → AAAA-07-01 clampeado a no-futuro | `animal-birth-year.test.ts` (07-01 / clamp a 01-01 futuro / 07-01 ya pasado / null) |
| validación de año (vacío/formato/no-futuro/cota) | `animal-birth-year.test.ts` (vacío válido / válido / <4 díg / futuro / cota) |
| "Vacía" = no preñada (no crea tacto) | `animal-birth-year.test.ts` (isPregnantStatus empty/null → false) + lógica del screen (pregnantCaptured) |
| Form dinámico: multípara NO pide peso, SÍ dientes/CC/preñez/cría | E2E "B: MULTÍPARA" (peso count 0; labels visibles; dientes+CC+cría cargados; condición en Estado actual) |
| Form dinámico: ternero pide peso, NO dientes/preñez | E2E "B: TERNERO" |
| Vaq.preñada con "Cabeza" → estado reproductivo Preñada (cabeza) + badge SIN override | E2E "B: VAQUILLONA PREÑADA" |
| Validación robusta en vivo (caravana 15 díg, año 4 díg, peso) | E2E "FIX2 … LIMITA los inputs en vivo" (actualizado a año-only + peso de categoría) |

## Autorrevisión adversarial (paso 8 — pasada hostil, qué busqué/encontré/cerré)

- **Override en los 3 casos**: ¿el override sale bien para vaq.preñada (false), multípara (true) y
  recría coincidente (false)? Cubierto por 6 unit nuevos de B + 3 E2E que asertan el a11y label del
  badge ("fijada manualmente" presente para override, ausente para derivable) — aserción DIAGNÓSTICA (si
  el override fallara, el assert rompería). No es falso verde.
- **Campos correctos por categoría**: ¿una multípara pide peso por error? ¿un ternero pide dientes? Cerrado
  por el mapeo puro (8 unit) + E2E que asierta `getByLabel('Peso en kg').toHaveCount(0)` en multípara y
  `getByText('Dientes').toHaveCount(0)` en ternero. **Edge cazado**: si el usuario llena una categoría
  (multípara) y vuelve atrás a cambiarla (ternera), los estados stale (teethState/nursing/pregnancy)
  quedan seteados pero el `onSubmit` los GATEA por show* → NO se filtra un dato de la categoría vieja
  (verificado en la lógica: `teethState: showTeeth ? teethState : null`, etc.).
- **Evento que falla no rompe**: ¿si el tacto/condición post-create falla, se pierde el animal? **Edge
  cazado y cerrado**: el animal ya existe → guardo `createdProfileId`, el CTA pasa a "Ver la ficha"
  (NO re-crea → sin DUPLICADO) + aviso suave. Mi 1ra versión seteaba `formError` y navegaba inmediato
  (el aviso se perdía al desmontar) Y podía duplicar si el usuario re-tocaba — corregido.
- **Año-only futuro**: **edge cazado y cerrado** — `AAAA-07-01` del año en curso puede ser futuro
  (hoy 2026-06-05 → 2026-07-01 es futuro) → el server lo trataría como edad desconocida. Clampeé
  `birthYearToDate` a `01-01` cuando `07-01` es futuro (+ 1 unit del clamp). (También reformulé el E2E
  "coincide" de "ternera año reciente" — ambiguo por el mid-year — a "vaquillona sin año", determinista.)
- **"Vacía" no crea evento**: verificado en la lógica (`pregnantCaptured = showPregnancy &&
  isPregnantStatus(status)`; el `addTacto` se gatea por `pregnantCaptured`). "Vacía" → no tacto.
- **nursing en INSERT**: ¿el trigger de nursing pisa el valor inicial? Revisé 0061/0067 — los triggers
  son AFTER INSERT sobre `reproductive_events`/`birth_calves`, NO sobre `animal_profiles` → el `nursing`
  del insert se respeta (en el alta no hay parto aún → tampoco hay recompute que lo cambie).
- **Multi-tenant**: `addConditionScore`/`addTacto` SIN establishmentId (RLS deriva del profile);
  `createAnimal` scopeado; nada hardcodeado (codes del catálogo del rodeo). ✓
- **Tests que pasan por la razón equivocada**: el E2E de vaq.preñada asierta `Preñada (cabeza)` (prueba
  que el tacto+ se creó y `deriveCurrentState` lo deriva) + count 0 del label "fijada manualmente"
  (override=false real). El de multípara asierta `3 / 5` (prueba que el `addConditionScore` se ejecutó).
  Son aserciones del path real, no de presencia trivial.

## Conteos

- `node scripts/check.mjs`: **anti-hardcode 0**, typecheck OK, **client unit 364/364** (337 de A + 27
  nuevos), RLS 17/17, Edge 37 (36 pass / 0 fail / 1 skip preexistente), Maneuvers 13/13, user_private 19/19.
- `pnpm.cmd e2e`: **40 passed** (3 nuevos de B: MULTÍPARA / TERNERO / VAQUILLONA PREÑADA; + 2 ajustados:
  override multípara con año + coincide vaquillona; + FIX2 actualizado a año-only/peso de categoría).
  Estable en 2 corridas full (un deadlock transitorio de la DB compartida en una corrida intermedia se
  resolvió solo al re-correr — NO regresión: `events.spec.ts` no toca el alta guiada).

## ⚠️ FAIL del entorno (NO regresión mía) — suite Animal (spec 02) por la migración 0070 de feature 13

`check.mjs` da FAIL en la **suite Animal (spec 02)**: 43 tests, 35 pass, **7 fail** con error
`new row for relation "animals" violates check constraint "animals_tag_electronic_len_chk"`.

**Verificado empíricamente que NO es mío**: con MIS cambios STASHED (código baseline), la suite Animal
falla **idéntico** (mismo 7/7 fail, mismo error). Causa: la **migración 0070**
(`0070_check_text_length_caps.sql`, feature **13 hardening**, OTRA terminal) se aplicó al REMOTO durante
mi sesión, agregando `check (char_length(tag_electronic) <= 64)`. Los fixtures de
`supabase/tests/animal/run.cjs` usan caravanas con `RUN_TAG` largo (ej.
`animal_test_1780705011854_e4nko0_CALFTAG` > 64 chars) → violan el CHECK. Es una **colisión de
terminales paralelas** (feature 13 `in_progress` en `feature_list.json`).

- NO lo toqué (la suite animal es de otra feature; arreglar sus caravanas largas es de feature 13 / del
  leader que coordina el deploy de 0070). NO es del alta guiada (frontend; yo no inserto tags en backend).
- El `check.mjs` baseline al ABRIR mi sesión dio verde → 0070 se aplicó al remoto DESPUÉS (DB compartida
  que mutó entre corridas).
- **Mis suites (client unit + mis 40 E2E) están verdes.** El FAIL es ortogonal a mi entrega.

→ Para el leader: el deploy de 0070 (feature 13) rompe los fixtures de la suite animal — ajustar los
`RUN_TAG`/caravanas de `supabase/tests/animal/run.cjs` a ≤64 chars (o el techo de 0070) al integrar 13.

## Archivos tocados
- NUEVOS: `app/src/utils/animal-category-fields.ts` (+ `.test.ts`), `app/src/utils/animal-birth-year.ts`
  (+ `.test.ts`).
- MODIFICADOS: `app/src/utils/animal-category.ts` (+ `.test.ts`), `app/src/services/animals.ts`,
  `app/app/crear-animal.tsx`, `app/e2e/animals.spec.ts`, `scripts/run-tests.mjs` (engancha los 2 tests
  nuevos), `progress/current.md` + esta bitácora.

## SIN COMMITEAR
No commiteo. El árbol tiene trabajo AJENO de otra terminal (feature 13: migraciones 0070/0071/0072,
`security_code_13`, `context-alta-guiada` ajeno; spec 04 `field-findings`; los C3.2 sin commitear). El
`add` al commitear (cuando el leader lo decida) debe ser SELECTIVO — solo mis archivos de la alta guiada B.

## No marco `done` — espera reviewer + Gate 2 (code).
