baseline_commit: acf1d3dbde8bab8a5944a2695d09f4ecfcc7cd41

# impl — spec 02 frontend · C1 RODEOS (crear rodeo)

Feature en curso: **02-modelo-animal** (frontend, chunk C1). Primer módulo de `app/src/features/`.
Backend done (migrations 0013-0042 al remoto). Frontend only, services swappables (PowerSync = C5).

## Plan (tasks de este run)

- **T1 — Lógica pura `utils/rodeo-template.ts`** (+ tests node:test): agrupar `field_definitions`
  por categoría con orden por `sort_order`, armar el estado inicial de toggles desde
  `system_default_fields`, y computar el **diff** de toggles del usuario contra los defaults
  (lo que persiste sobre `rodeo_data_config` tras crear el rodeo). Sin red/RN → testeable.
- **T2 — Service `services/rodeo-config.ts`** (T3.6): `fetchFieldCatalog`, `fetchSystemDefaults`,
  `fetchRodeoConfig`, `toggleRodeoField`, `enableNonDefaultField`. `Result<T, AppError>`.
- **T3 — Service `services/rodeos.ts`** (nuevo): `fetchRodeos`, `createRodeo` (split insert+select,
  lookup species/system by code, aplica el diff de toggles tras crear), `softDeleteRodeo`,
  `fetchActiveSystems`. `Result<T, AppError>`.
- **T4 — `contexts/RodeoContext.tsx`** (T3.1): estado loading/no_rodeos/active, auto-select del
  único rodeo activo, persistencia por establishment (patrón establishment-store), deps primitivas.
- **T5 — Componente `components/FieldTemplateToggleList.tsx`** (reusable: wizard paso 3 + editar
  plantilla): lista agrupada por categoría con headers de sección + filas label/desc/switch.
- **T6 — Wizard `app/crear-rodeo.tsx`** (3 pasos: sistema → nombre → plantilla) + empty-state copy.
- **T7 — `app/rodeos.tsx`** (RodeosScreen: lista + CTA crear owner-only + editar plantilla) +
  enganche desde `mas.tsx`.
- **T8 — Empty-state de bloqueo total en RootGate** (`_layout.tsx`): chequeo de rodeo DESPUÉS del
  gating de establecimiento (auth → email → token → establecimiento → **rodeo**).
- **T9 — Montar RodeoProvider** dentro de EstablishmentProvider (`_layout.tsx` + contexts/index).

## Estado: COMPLETO (esperando reviewer + Gate 2). check.mjs verde.

T1..T9 hechas. `node scripts/check.mjs` verde:
- anti-hardcode 0 · typecheck OK · client unit **146/146** (128 previos + 18 nuevos de rodeo-template)
- RLS 17 · Edge 36 · Animal 28 · Maniobras 13 (backend intacto — frontend only)

## Archivos creados/modificados

**Creados:**
- `app/src/utils/rodeo-template.ts` — lógica pura (agrupar/ordenar por categoría, armar toggles, diff).
- `app/src/utils/rodeo-template.test.ts` — 18 tests node:test (enganchados en run-tests.mjs).
- `app/src/services/rodeo-config.ts` (T3.6) — `fetchFieldCatalog`/`fetchSystemDefaults`/`fetchRodeoConfig`/`toggleRodeoField`/`enableNonDefaultField`.
- `app/src/services/rodeos.ts` — `fetchProductionSystems`/`fetchRodeos`/`createRodeo`/`softDeleteRodeo`.
- `app/src/services/rodeo-store.ts` — persistencia del rodeo activo por (usuario, campo).
- `app/src/contexts/RodeoContext.tsx` (T3.1) — estado loading/no_rodeos/active, auto-select, deps primitivas.
- `app/src/components/FieldTemplateToggleList.tsx` — lista agrupada de toggles (reusable: wizard + editar).
- `app/app/crear-rodeo.tsx` (T4.3) — wizard 3 pasos + empty-state bloqueo total.
- `app/app/rodeos.tsx` (T4.3) — RodeosScreen (lista + crear/editar/eliminar owner-only).
- `app/app/editar-plantilla.tsx` (T4.3) — editar plantilla del rodeo (owner; habilitar no-default).

**Modificados:**
- `app/app/_layout.tsx` — montar `RodeoProvider` dentro de EstablishmentProvider; gate de rodeo (bloqueo total R2.6) DESPUÉS del de establecimiento; registrar 3 rutas nuevas en el Stack.
- `app/src/contexts/index.ts` — export RodeoProvider/useRodeo.
- `app/src/components/index.ts` — export FieldTemplateToggleList.
- `app/app/(tabs)/mas.tsx` — fila "Rodeos" en la sección "Campo activo" (todos los roles; gestión owner-only en pantalla).
- `app/tamagui.config.ts` — tokens JIT: `toggleTrack`/`toggleThumb`/`toggleKnob`/`progressTrack`.
- `scripts/run-tests.mjs` — engancha `rodeo-template.test.ts`.
- `progress/current.md` — nota de arranque de C1.

## Mapa R→archivo:test (trazabilidad)

| R | Cubierto por | Verificación |
|---|---|---|
| **R2.2** (owner crea rodeo) | `services/rodeos.ts::createRodeo` (split insert+select, owner por RLS) + `crear-rodeo.tsx` | path SQL↔RLS idéntico ya verde en Animal T2.9 (owner crea OK); el service mirror-ea el helper probado |
| **R2.3** (field_op/vet NO crean/editan) | RLS server-side (rodeos_insert/update = is_owner_of) + UI: CTA "Crear rodeo"/editar/eliminar solo si `role==='owner'` (`rodeos.tsx`, `editar-plantilla.tsx`); `toggleRodeoField`/`softDeleteRodeo` reportan count=0 si RLS bloquea | Animal T2.9 (field_operator crea → falla RLS); T2.16 caso 5/6 (field_operator UPDATE/INSERT config → falla) |
| **R2.4** (solo (bovino,cría); resto inactivo) | `fetchProductionSystems` trae todos pero el wizard grisa los `active=false` con badge "Próximamente"; `createRodeo` resuelve system con `.eq('active',true)` (defensa pre-DB) + trigger DB re-valida | Animal T2.9 ((bovino,invernada) → 23514) |
| **R2.5** (soft-delete owner; rechaza con animales activos) | `services/rodeos.ts::softDeleteRodeo` (deleted_at, owner por RLS) + `rodeos.tsx` (confirmación; bloquea si es el único rodeo) | Animal T2.9 (soft-delete con/ sin animales) |
| **R2.6** (no rodeo default → wizard + empty-state bloqueo total) | RodeoContext estado `no_rodeos` + RootGate (`_layout.tsx`) rutea a `/crear-rodeo` y bloquea el resto; `crear-rodeo.tsx` modo bloqueo (sin "atrás", copy de bienvenida) | razonamiento de orden auth→est→rodeo (abajo); no hay trigger de auto-creación (Animal T2.9 = 0 rodeos al crear campo) |
| **R2.8** (catálogo global field_definitions, agrupado por categoría) | `fetchFieldCatalog` + `groupTogglesByCategory` (orden canónico + sort_order) + `FieldTemplateToggleList` (headers de sección) | `rodeo-template.test.ts` (groupTogglesByCategory: orden canónico + sort_order; categoría no prevista al final) |
| **R2.9** (system_default_fields: default/required por sistema) | `fetchSystemDefaults` + `buildWizardToggles` (enabled=default_enabled; required no destildable) | `rodeo-template.test.ts` (buildWizardToggles: default ON/OFF; required nunca emite op) |
| **R2.11** (trigger pre-pobla rodeo_data_config; el cliente diffea) | `createRodeo` confía en el trigger (0018) + aplica solo el diff (`computeConfigDiff`) | `rodeo-template.test.ts` (computeConfigDiff: sin cambios→0 ops; destildar→UPDATE; default OFF tildado→UPDATE; no-default→INSERT); Animal T2.9/T2.16 (trigger pre-pobla 26 filas, 23 ON) |
| **R2.12** (owner toggablea + habilita no-default; sin DELETE de cliente) | `toggleRodeoField` (UPDATE) + `enableNonDefaultField` (INSERT) + `editar-plantilla.tsx` (buildEditToggles muestra TODO el catálogo) | `rodeo-template.test.ts` (computeEditDiff: UPDATE/INSERT/no-op; re-habilitar no-default con fila→UPDATE no INSERT); Animal T2.16 caso 6 (owner INSERT no-default OK) |
| **R2.B** (las 3 tablas como sustrato) | services `rodeo-config.ts` (las 3 tablas) + lógica pura | unit + Animal T2.16 |

> **Nota de cobertura**: el path cliente↔RLS de `createRodeo` (split insert+select → evita el 403
> RLS-on-RETURNING) y de las mutaciones de `rodeo_data_config` (UPDATE/INSERT owner) está **probado
> contra el remoto** por la suite Animal (T2.9, T2.16), que autentica con anon-key + RLS exactamente
> igual que mis services y usa el MISMO patrón split insert+select de `createRodeo`. La lógica única
> de mi código (cómputo del diff + agrupado/orden) son las 18 unit. No se duplicó un test remoto
> redundante (lección: el gap de B.1.2 era un path NUNCA testeado; acá el path SÍ está cubierto).

## Autorrevisión adversarial (paso 8)

Busqué activamente, como revisor hostil:

1. **Empty-state bloquea de verdad sin romper spec 01** ✅. El gate de rodeo vive DENTRO de la rama
   `est.status === 'active'`, DESPUÉS de los gates de spec 01 (auth → email → token invitación →
   establecimiento). Orden razonado: sin campo activo, RodeoContext queda en `loading` y no fetcha
   (no decide nada); recién con `est: active` el gate consulta rodeo. `no_rodeos` → `/crear-rodeo`
   y bloquea todo lo demás (incluido (tabs)/mis-campos), solo deja pasar el propio wizard.
   `rodeo: loading` → mantiene splash (igual que est loading), NO afirma bloqueo a ciegas. No toqué
   los gates de spec 01 (auth/est/token siguen idénticos). Los destinos de rodeo (rodeos/editar-
   plantilla/crear-rodeo) NO se de-strand de (tabs) cuando hay rodeo activo (navegación legítima del
   owner). Salida del bloqueo: tras crear, `refreshRodeos()` → rodeo `active` → el wizard hace
   `router.replace('/(tabs)')`; el gate no pelea (top sigue en RODEO_DESTINATIONS ese tick).
2. **Loop de fetch (deps por objeto)** ✅. RodeoContext: deps PRIMITIVAS (`userId`, `establishmentId`
   strings) en el efecto de carga; `load`←`applyRodeos`(useCallback []) estables. El efecto de
   persistencia depende de `currentId` (string). ProfileContext/miembros.tsx lesson aplicada. RootGate
   depende de `rodeo` (objeto de estado, igual patrón que `est`/`auth` ya existentes — re-corre al
   cambiar estado, que es lo querido, NO un loop).
3. **RLS / field_operator NO crea rodeo (R2.3)** ✅. La UI oculta los CTA a no-owners (rol del
   EstablishmentContext); la RLS es la barrera real (is_owner_of). `toggleRodeoField`/`softDeleteRodeo`
   usan count:'exact' → si RLS bloquea (count=0) devuelven error accionable, no falso OK. La lista de
   rodeos SÍ es read-only para todos los roles (R2.3 permite ver), gestión solo owner.
4. **Split insert+select evita 403 RLS-on-RETURNING** ✅. `createRodeo` inserta SIN `.select()` y
   recupera el id diffeando el set antes/después (robusto ante nombres duplicados, igual que
   `createEstablishment` de spec 01). Mismo patrón probado por Animal T2.9. Idem `enableNonDefaultField`
   (INSERT sin select), `toggleRodeoField`/`softDeleteRodeo` (UPDATE sin select + count).
5. **El diff de toggles persiste bien** ✅. computeConfigDiff (wizard, contra defaults) y
   computeEditDiff (editar, contra estado efectivo) cubiertos por unit con edge cases: sin cambios→0
   ops, default ON/OFF, no-default INSERT vs no-op, required nunca apaga, re-habilitar no-default con
   fila→UPDATE (no INSERT, evita choque de PK). El wizard solo muestra defaults → solo UPDATEs (el
   trigger ya pre-pobló). Tras guardar en editar-plantilla, re-leo el estado efectivo del server
   (reloadBaseOnly) para que el próximo diff sea contra la verdad (no recompute frágil).
6. **Hardcode** ✅. 0 violaciones. Tokens nuevos JIT en config (toggle*, progressTrack). Los
   contentContainerStyle de ScrollView usan `getTokenValue('$4','space')` (no literales), igual que mas.tsx.
7. **Edge cases cerrados**: nombre vacío/largo (validación trim+máx 60); sistema no-MVP grisado +
   `createRodeo` rechaza inactivo; eliminar el único rodeo bloqueado (avisa); fallo de red en cada
   carga → copy accionable + reintentar, NO falso `no_rodeos` (sería un falso bloqueo total → dejo
   `loading`+error). Persistencia best-effort (si falla el storage, auto-select sigue andando).

### Limitaciones conocidas (no bloqueantes, anotadas)
- Conteo de animales por rodeo: diferido a C2 (mostrar 0 a ciegas hoy sería engañoso; no hay animales aún).
- Fallo de red al cargar rodeos en cold-start deja el splash hasta el fallback de 5s y luego sin
  reroute explícito (mismo borde que `est: loading`); reintentable on-focus. Aceptable MVP.
- "Editar plantilla" (R2.12.1 aviso de N eventos al destildar un data_key con historial): el aviso
  exacto es de C3 (necesita el timeline/conteo de eventos). Acá el header ya explica que destildar no
  borra el historial; el conteo puntual se suma cuando exista la cronología.
- Render/UX final lo veta el leader vía Playwright (login). Dejé accessibilityLabel/textos claros
  (cards de sistema, toggles role=switch, barra de progreso role=progressbar, CTAs).
