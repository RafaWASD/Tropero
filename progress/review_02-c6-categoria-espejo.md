# Review 02 - C6: espejo client-side de categoria (offline) + visibilidad del override

Reviewer: reviewer (Opus). Fecha: 2026-06-11. Baseline: b23c4cd.
Contexto: chunk implementado por un implementer que murio por session limit; un 2do implementer lo asseslo,
verifico (cero fixes) y cerro. Esta revision es la PRIMERA de punta a punta con contexto completo.

## Veredicto: APPROVED

Sin findings bloqueantes. Las 8 verificaciones obligatorias del brief pasan. Las specs reconcilian con el
as-built. El unico e2e rojo (test 639 / bug 0069) es PRE-EXISTENTE, out-of-scope y documentado; C6 no toca el
modulo del timeline (git status: event-timeline.ts intacto).

## Foco 1 - Fidelidad del espejo a 0062 (rama por rama)

Compare computeCategoryCode (animal-category.ts:220-261) contra compute_category (0062:46-101):
- Macho: >=730 a toro/novillo (0062:48 vs ts:231); hasWeaning o >=365 a torito/novillito (0062:51 vs ts:234);
  <365 a ternero (0062:54 vs ts:237); default torito/novillito (0062:59 vs ts:241). Identico.
- Hembra: births>=2 a multipara (0062:87 vs ts:253); births=1 a vaca_segundo_servicio (0062:89 vs ts:254);
  tacto+ a vaquillona_prenada (0062:91 vs ts:255); weaning o service o >=365 a vaquillona (0062:93 vs ts:256);
  <365 a ternera (0062:96 vs ts:259); default vaquillona (0062:99 vs ts:260). Identico.
- Conteo de partos: eventos birth distintos, NUNCA terneros (RT2.7.2); mellizos = 1 evento (fixture:306).
- tacto+ vigente (0062:70-83 vs hasPositiveTactoVigente ts:275-283): pregnancy_status no-nulo y no-vacio + sin
  abortion posterior por tupla (event_date, created_at). Equivalente exacto.
- knownAge (ts:226): birth_date null o futura a null a default por sexo, espeja el case de 0062:36.

Fixtures vs matriz server T2.21-T2.30: replican 1:1 INPUTS y OUTPUTS de run.cjs (mismos daysAgo
180/400/800/550/300/900/10/1; mismos pregnancy_status; mismas secuencias). NO es parafrasis (run.cjs:1455-1759
vs test:224-377).

Mutacion mental (precedencia): respondida por los tests RC6.1.2 load-bearing (test:382-440) que aislan el ORDEN:
1 birth GANA a tacto+ (test:382 a vaca_segundo_servicio), 2 births GANAN (test:393 a multipara), tacto+ GANA a
destete/servicio/edad (test:405 a prenada), corte 2 anios GANA al destete macho (test:432 a toro/novillo). Si
0062 reordenara, estos flippean. PASS.

## Foco 2 - Display write-free estructural (RC6.3.5)

computeDisplayOverrides (animal-category.ts:383-411) es PURO (sin I/O), estructuralmente incapaz de escribir.
computeMirrorOverrides (animals.ts:206-265) usa SOLO runLocalQuery (SELECT). El UNICO runLocalWrite de animals.ts
esta en revertCategoryOverride (animals.ts:927), FUERA del path de display. grep del diff confirma que no hay otro
write. Test SELECT-puro en local-reads.test.ts:584-598. PASS.

## Foco 3 - Revert (RC6.4.3-RC6.4.5)

buildRevertCategoryOverrideUpdate (local-reads.ts:1090-1097): UN solo statement
UPDATE animal_profiles SET category_override = 0, category_id = ? WHERE id = ? AND deleted_at IS NULL, una
CrudEntry, un solo UPDATE PostgREST: 0040 respeta el revert, 0030 graba revert_to_auto, 0021 re-valida.
revertCategoryOverride (animals.ts:861-931): offline-safe; derivada irresoluble aborta SIN write en 2 puntos
pre-write con error es-AR (877-880 sin system_id; 915-922 code sin fila). category_id resuelto por
(system_id, code) via buildCategoryIdByCodeQuery (local-reads.ts:342-345, active=1). PASS.

## Foco 4 - Inferencia is_castrated (RC6.2)

inferIsCastrated (animal-category.ts:323-325): true solo novillito/novillo, false el resto (incl.
null/undefined/vacio). Test exhaustivo animal-category.test.ts:507-518. Limitacion en el banner ANTI-DRIFT del
header (animal-category.ts:20-28). PASS.

## Foco 5 - Fail-safe (RC6.3.4)

deriveDisplayCategory (animal-category.ts:341-353): override=true o code sin fila a guardada.
computeDisplayOverrides (animal-category.ts:389-392): sin systemId a no entra al Map. computeMirrorOverrides
(animals.ts:225,247): lecturas locales que fallan a guardada. Nunca blanco, nunca crash. PASS.

## Foco 6 - Performance de la lista (N+1)

buildCategoryMirrorEventsQuery(profileIds) (local-reads.ts:714-727) toma TODOS los profileIds en UNA query (IN
synced UNION overlay). computeMirrorOverrides llama UNA vez por lista (no por fila) + 1 query de catalogo por
system_id distinto (MVP: 1). Sin N+1; aceptable para 300+ animales en SQLite local. PASS.

## Foco 7 - E2E + check.mjs (verificado por mi)

- node scripts/check.mjs exit 0 (corrido 2 veces). 820 unit pass / 0 fail (incl. fixtures C6 + builders + GUARD
  de schema que confirma que category_override/animal_birth_date/system_id son columnas declaradas en el
  AppSchema, no inventadas). Anti-hardcode 0 violaciones. Backend (RLS/Animal/Maneuvers/Import/Sync-streams) verde.
- pnpm e2e:build exporto dist OK.
- events.spec.ts (run aislado, workers=1): 12/13 pass. Los 2 C6 (744 espejo, 788 override+quitar fijacion) VERDES.
  Los 2 de transicion (190 tacto, 279 mellizos) VERDES. Unico rojo: 639 (orden timeline / bug 0069), PRE-EXISTENTE,
  out-of-scope, documentado. NOTA: una primera corrida back-to-back dio 4 rojos por COLISION de procesos en Windows
  (UV_HANDLE_CLOSING + tabs duplicadas bloquean PowerSync, gotcha del brief); el run aislado es el autoritativo.
  Re-corri 279+C6 aislados: 3/3 estables.
- animals-offline.spec.ts (run aislado): 8/8 pass. Sin regresion offline.

## Foco 8 - Checklist RAFAQ estandar

- Offline-first (C8): display 100% de SQLite local (RC6.3.6); revert CRUD plano offline-safe (RC6.4.4), mismo path
  que assignAnimalToGroup (spec 15). LWW heredado. PASS.
- UI de campo (D): CategoryOverrideCard ([id].tsx:551-651) usa touchMin=56px (tamagui.config.ts:103) en los tap
  targets (>=56); una decision por pantalla (confirmacion inline); loading visible (Quitando..., [id].tsx:616).
- es-AR voseo: Categoria fijada manualmente, Quitar fijacion, Si quitar, Conectate y volve a intentar.
- Anti-hardcode: 0 violaciones; cero establishment_id hardcodeado (viene por params). Tokens en todo el comp.
- Multi-tenant (C7): sin RLS nueva (frontend puro); el revert pasa por animal_profiles_update al subir.

## Verificacion Gate 1 N/A (frontend puro)

git status -- supabase/ vacio + git diff --stat solo toca app/ y specs/. CERO migraciones, SQL, RLS, triggers o
Edge Functions. Gate 1 N/A confirmado contra el diff real. PASS.

## Trazabilidad RC6.<n> a test (completa)

- RC6.1.1/.2/.3 (espejo 0062): fixtures T2.21-T2.30 + precedencia load-bearing -> animal-category.test.ts:224-440
- RC6.1.4 (tie-break createdAt null): 4 tests (presente/null/doble-null) -> animal-category.test.ts:443-504
- RC6.1.5 (delegacion sin 3ra copia): suite B previa verde sin tocarse -> animal-category.test.ts:28-187
- RC6.1.6 (fixtures espejo matriz): T2.21-T2.26/T2.29/T2.30 1:1 con run.cjs -> animal-category.test.ts:224-377
- RC6.2.1 (inferencia is_castrated): inferIsCastrated true solo novillito/novillo -> animal-category.test.ts:507-518
- RC6.2.2 (limitacion documentada): banner ANTI-DRIFT -> animal-category.ts:20-28
- RC6.3.1 (ficha derivada local): unit computeDisplayOverrides + e2e -> animal-category.test.ts:591 + events.spec.ts:744
- RC6.3.2 (lista/busqueda derivada): unit batch + cableado -> animal-category.test.ts:644 + animals.ts:305,418
- RC6.3.3 (override=true a guardada): unit deriveDisplayCategory/computeDisplayOverrides -> animal-category.test.ts:539,600
- RC6.3.4 (irresoluble a fail-safe): code sin fila / catalogo vacio / sin system_id -> animal-category.test.ts:549-620
- RC6.3.5 (display NO escribe): test SELECT-puro builders + pureza estructural -> local-reads.test.ts:584-598
- RC6.3.6 (sin red, SQLite local): builder eventos + e2e tacto offline -> local-reads.test.ts:526-570 + events.spec.ts:744
- RC6.4.1 (indicador fijada manual): e2e override (texto + a11y sufijo) -> events.spec.ts:818-821
- RC6.4.2 (accion gating activo+rol): e2e quita fijacion + gating canRevertOverride -> events.spec.ts:824 + [id].tsx:230
- RC6.4.3 (UPDATE unico override+id): builder revert + e2e revert->derivada -> local-reads.test.ts:574-582 + events.spec.ts:824-833
- RC6.4.4 (revert offline): UPDATE local CRUD plano + e2e -> animals.ts:927 + events.spec.ts:788
- RC6.4.5 (irresoluble a no write + error es-AR): guardas pre-write -> animals.ts:877-880,915-922
- RC6.5.1 (nota anti-drift header TS): banner del modulo -> animal-category.ts:4-18
- RC6.5.2 (nota anti-drift design): nota aditiva 3.1 -> design-tier2-categorias.md

Cada RC6.<n> tiene >=1 test concreto. NINGUNO sin cobertura.

## Tasks completas: SI

Todas las tasks de tasks-c6-categoria-espejo.md (T1.1-T4.5) en [x]. Verificadas contra el codigo real (no solo
marcadas). Ninguna [ ].

## Exactitud de specs (codigo a spec): reconciliada

Las notas as-built describen el codigo tal cual quedo:
- requirements-c6:29 (RC6.1.4 desempate por indice doble-null) vs animal-category.ts:298-310 isAfter(a,ai,b,bi).
- design-c6:86 (computeMirrorOverrides/computeDisplayOverrides reales) vs animals.ts:206.
- design-c6:99 (CategoryOverrideCard, primary no terracota, Pin) vs [id].tsx:551-651.
- design-tier2-categorias.md 3.1 nota anti-drift presente.
NO hay specs que contradigan el as-built. Nada pendiente de reconciliar.

## CHECKPOINTS

- C6 (SDD): [x] 3 archivos spec; [x] requirements EARS; [x] tasks [x]; [x] cada R<n> con test.
- C3 (arquitectura): [x] capas previstas (utils/services/screens); [x] sin deps externas nuevas; [x] sin
  logs/TODOs sueltos; [x] sin establishment_id hardcodeado.
- C4 (verificacion): [x] test por modulo con logica; [x] fixtures reales (matriz server, SQLite in-memory);
  [x] runner >0 tests verde (820 unit); RLS N/A (frontend puro).
- C8 (offline-first): [x] funciona sin conexion; [x] bucket correcto (spec 15); [x] LWW heredado documentado.
- C7 (multi-tenant): N/A tablas nuevas (no hay); el revert pasa por RLS existente. [x] sin SQL inline duplicado.

## Checklist RAFAQ-especifico

- A (multi-tenancy/RLS): N/A - no toca tablas nuevas ni RLS (el revert usa animal_profiles_update existente).
- B (offline-first): [x] funciona offline; [x] sync bucket correcto; [x] LWW heredado; [x] no hace requests
  sincronos a Supabase desde la pantalla (usa repos que tocan SQLite local).
- C (BLE): N/A - no toca BLE.
- D (UI de campo): [x] tap targets >=56dp (touchMin); fuente: la card reusa tokens de cuerpo existentes, no
  introduce texto operativo nuevo bajo 18pt; [x] una decision por pantalla (confirmacion inline); [x] loading
  visible (Quitando...).
- E (Edge Functions): N/A - no toca Edge Functions.

## Cambios requeridos: ninguno

## Nota informativa (no bloqueante)

El test 639 (bug 0069 orden timeline) y el 509 (deriveCurrentState UUID-tiebreak offline) NO son del scope de C6,
estan en el set de 8 e2e rojos PRE-EXISTENTES, y estan documentados en docs/backlog.md (2026-06-11) con repro y
fix sugerido. C6 no toca event-timeline.ts ni el render del timeline, no son regresion. Finding backend para el
leader (ya en design 7 + header): denormalizar is_castrated sobre animal_profiles cuando aterrice el toggle de
castracion (spec 10 v2); hoy la inferencia espeja al server en todos los casos productivos.
