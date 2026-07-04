# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a `history.md`.
> Mientras trabajás, **mantenelo actualizado en tiempo real**, no al final.

**SESIÓN 2026-06-29/30 — CORRECCIONES DEL TESTEO EN VIVO CON FACUNDO (16) + CONVENCIÓN SDD PARA FIXES (ADR-028).**

## 🆕 2026-07-04 — FIX SUPERPOSICIÓN "Sin caravana" ↔ estado repro (Nivel A) — ✅
Raf mandó captura (`tests/tag_sin_caravana.png`): en la lista de Animales el chip "Sin caravana" se superponía con el estado repro ("Servida sin tacto") cuando la categoría es larga. Root cause: en `AnimalRow.tsx` la línea 2 tenía el badge de categoría + el chip repro como `flexShrink 0` → con categoría larga ("Vaca segundo servicio") desbordaban hacia la derecha y pisaban el `NoTagChip` (RN no clipea). **Fix (Nivel A, frontend-only)**: prioridad de degradación — categoría + "Sin caravana" siempre completos, el chip repro trunca ("Se…") como último recurso, el rodeo cede primero (flexShrink alto), + `overflow:hidden` de red de seguridad. Verificado con capture (oráculo `reproBox.x+w <= noTagBox.x`; caso normal 5501 intacto). ⚠ En el peor caso (categoría más larga + repro + sin caravana en 412px) el chip repro queda como "Se…" — a refinar si Raf prefiere dropear el chip o acortar el label de categoría.

## 🆕 2026-07-03 — REORDER CATEGORÍAS MACHO DEL ALTA (Nivel A) — ✅ APLICADO
Raf notó que las categorías macho del alta estaban desordenadas (Ternero → **Toro → Torito** → Novillito → Novillo, accidente del sort_order de siembra). Le di 3 opciones con preview y eligió la **A** (rama reproductiva primero). **Migración `0120`** (UPDATE `sort_order` del sistema cría: ternero=10 primero, torito=91, toro=92, novillito=93, novillo=94; scope join-by-code, sin tocar hembras/otros sistemas) **APLICADA** → orden nuevo **Ternero → Torito → Toro → Novillito → Novillo**. Frontend sin cambios (el picker ordena por `sort_order`). Nivel A (sin delta-spec); verificado por query al remoto + veto SQL. El implementer murió (ConnectionRefused) tras escribir el `.sql`; el leader lo recuperó/vetó/aplicó/verificó.

## 🆕 2026-07-03 — DELTA TAP-WHEEL (#16) — GATEADO, ⏸ Puerta 2
Tapear una celda visible de la rueda inercial (`WheelPicker.tsx`) la selecciona (anima+snap), no solo arrastrando. Un fix cubre los 2 wheels del paso de CE (circunferencia + edad en meses — ambos son instancias del componente). **Frontend-only** (Gate 1 N/A). Helper puro `tapTarget` + `WheelCell` tappable enganchado al lock determinístico (sync shared values antes del `scrollTo`, cancela settle, misma háptica). GATES: veto diseño + reviewer APPROVED (código impecable, cero regresión de drag — maquinaria de scroll byte-idéntica) + Gate 2 PASS + Gate 2.5 (6 capturas, veto visual PASS). typecheck + 38 unit + E2E táctil 1/1 + no-regresión drag 2/2.
- **Flake de check resuelto**: el reviewer marcó CHANGES_REQUESTED SOLO por `check.mjs` rojo = flake `animals_tag_unique` 23505 (leftover del tag fijo `'9'*64` de INPUT-1, NO del delta). El leader borró el fixture leftover por MCP (6 filas de test) → **animal suite 128/128**. Root-cause (INPUT-1 usa tag fijo → colisiona entre corridas) anotado en `docs/backlog.md`.
- **⏸ Puerta 2**: probar el tap en la rueda de CE (o mirar las 6 capturas). Folda al baseline al aprobar.

## 🆕 2026-07-01 — DELTA NOMBRE/APODO (#2, toggle) — GATEADO + DEPLOYED, ⏸ Puerta 2
Parte 2 de #2 (el relabel 3→2 ya estaba en a25e21f). Opción (b) de Raf: reusar el mecanismo de campos custom. **Migración `0119`** (backfill seed per-est del `field_definition` "apodo", deshabilitado) **APLICADA** (99/99 ests, custom suite 20/20). Frontend: sacado el "Nombre/seña" built-in del alta (ya no molesta por default); un rodeo habilita "apodo" en `editar-plantilla` → aparece en "Datos personalizados" del alta/ficha. La remoción forzó migrar ~17 fills en 4 specs e2e (58 tests compilan).
- **3 gotchas de DB cazados por los gates** (stress-test del pipeline): (1) seed global de `propiedad` = feature muerta (las queries filtran `establishment_id IS NOT NULL`) → per-est; (2) trigger `after insert on establishments` dependía del orden alfabético de disparo → rompería el onboarding (spec 01) → **diferido a backlog**; (3) `on conflict` moldeado sobre el índice de `0093` pero `0101` lo redefinió con `and deleted_at is null` → habría abortado con `42P10` → **Gate 1 lo cazó**, fix foldeado + verificado contra el remoto.
- **GATES**: veto SQL + aplicada + Gate 1 PASS (fix foldeado) + Puerta 1 + reviewer APPROVED + Gate 2 PASS 0 HIGH + **Gate 2.5** (4 capturas, veto visual PASS). ⏸ Puerta 2 (folda R6.2/R13.10 al aprobar). **DP2** (auto-seed ests futuros) → backlog (forma segura: foldear en `handle_new_establishment` 0011).

## 🆕 2026-07-01 — DELTA %DESTETE (#10) — GATEADO + DEPLOYED, ⏸ Puerta 2
RPC **nueva** `rodeo_weaning_kpi` (migración `0118`, CREATE) — cierra el ciclo servida→parida→**destetada**. **%destete = terneros destetados / servidas**, imputado por **año de servicio** (Raf lo corrigió: #10 NO depende de #7; #7 = solo el peso al destetar). Vínculo: servida→parto(concepción ∈ campaña)→`birth_calves`→cría→evento `weaning`. `status`: no_service_months / not_applicable_12m / **not_weaning_season** (`weaned=0`, data-driven — el destete no tiene ventana determinística) / ok + leyenda de destete parcial. **APLICADA por el leader por MCP** (deploy autorizado) — reports suite **16/16** (TR.11 nuevo: 4 estados + mellizos + wrap + IDOR; TR.10 = 10 RPC). Frontend: card **Destete** nueva (2º KpiRow full-width, CD-3). `weaningCardView` puro con 9 tests reales (51/51 — lección #8 de imports muertos cerrada). GATES: veto SQL + aplicada + Gate 1 PASS + Puerta 1 + reviewer APPROVED + Gate 2 PASS 0 HIGH + Gate 2.5 (5 capturas, veto visual PASS). ⏸ Puerta 2 (folda R7.6 + feature 07 → done al aprobar).

## 🆕 2026-07-01 — DELTA %PARICIÓN-FIX (#8) — GATEADO + DEPLOYED, ⏸ Puerta 2
El KPI `rodeo_calving_kpi` daba **0% con `service_months` vacío** (rompía la confianza). Fix + lógica ya decidida por Raf: **migración `0117`** (DROP+CREATE, agrega `status` [`no_service_months`/`not_calving_season`/`not_applicable_12m`/`ok`] + `pending_pregnant`; el conteo `calved` NO cambia). **APLICADA al remoto por el leader por MCP** (deploy autorizado por Raf) — reports suite **15/15** (TR.4b nuevo + TR.4 sin regresión + grants + IDOR). Frontend: `calvingCardView` puro (la card muestra "—" + mensaje accionable en vez del 0%, % real en ok, leyenda D4 si quedan preñadas sin parir).
- **Recuperación**: el 1er implementer lo frenó Raf sin querer → el 2º cazó que `reports-format.test.ts` importaba `calvingCardView` SIN testearlo (imports muertos, "34/34" falso) → agregó 8 tests reales (42/42). Lección `reference_crashed_agent_recovery` en vivo otra vez.
- **GATES**: veto SQL leader (moldeado sobre el remoto, sin drift) + migración aplicada + Gate 1 PASS + Puerta 1 + reviewer APPROVED + Gate 2 PASS 0 HIGH + **Gate 2.5** (5 capturas, veto visual PASS).
- **⏸ Puerta 2 de Raf** (con las 5 capturas): confirmar los estados de la card. Se folda al baseline (R7.6) al aprobar; feature 07 vuelve a `done`.

## 🆕 2026-06-30 — DELTA PARTO-RODEO-CARAVANA (#4/#1a) — GATEADO, ⏸ Puerta 2
Al registrar un **parto** (`agregar-evento.tsx`) ahora se elige el **rodeo del ternero** (picker preseleccionado al de la madre + leyenda "(Mismo rodeo que la madre)", editable al mismo sistema, aplica a toda la camada → `calfRodeoId`) y la **caravana visual (idv)** del ternero **solo cuando hay 1 ternero** (con mellizos: oculto + nota a la ficha — consecuencia de `p_calf_idv` escalar). **Frontend-only** (`register_birth` 6-arg de #15 ya deployado; `git diff supabase/` vacío → **Gate 1 N/A**).
- **Read local del rodeo de la madre** (`fetchMotherRodeoContext`, cubre todo caller offline). Descubrimiento del implementer: el **único caller de parto es la ficha** (la maniobra NO rutea a parto) → el punto de vet "ambos entry points" quedó moot. Matiz cazado: `system_id` es catálogo **global** → filtro por sistema solo no alcanza; guard `canEditCalfRodeo` + scope por campo activo (`useRodeo().available`) cierran el tenant-scoping.
- **GATES**: veto diseño leader (Puerta 1) PASS + Gate 2 PASS 0 HIGH + reviewer APPROVED + **Gate 2.5** (4 capturas: single rodeo+idv / mellizos sin idv+nota / picker abierto / rodeo cambiado; **veto visual PASS**). typecheck + 17 unit helpers + E2E regresión verdes. `git diff supabase/` vacío.
- **⏸ Puerta 2 post-hoc de Raf** (con las 4 capturas): confirmar el flujo + la decisión de layout (caravana visual a nivel parto vs. dentro de la card del ternero). Se folda al baseline al aprobar.

## 2026-06-30 — DELTA CRÍA-AL-PIE-ALTA (#15) — ✅ DONE + PUERTA 2 APROBADA (Raf)
Al dar de alta una vaca con cría al pie (`nursing=true`) → **prompt saltable** "¿Vincular su cría al pie?" → caravana del ternero (find-or-create) → **vincular** existente (RPC nueva `link_calf_to_mother`) o **crear+vincular** nuevo (`register_birth` 6-arg con rodeo del ternero editable + leyenda "Mismo rodeo que la madre"). Delta Nivel B CON BACKEND (Gate 1 obligatorio; deploy autorizado por Raf en Gate 0).
- **BACKEND commiteado `70c2efd`**: 0114 (RPC nuevo, 8 guards anti-IDOR/idempotencia) + 0115/0116 (`register_birth` extendido; **0116 fix Gate 2 HIGH** = restaura herencia `breed_id` madre→ternero que 0115 había borrado al moldearse sobre 0075 en vez del as-built 0109 — SIGSA R1.7). Aplicadas al remoto. 200/200 backend (animal + SIGSA). Plumbing outbox/upload/events. Memoria `reference_function_recreate_base`.
- **FRONTEND (este commit)**: `LinkCalfPrompt.tsx` (bottom-sheet 3 fases ask→found→create, molde `BreedPickerSheet`) + `link-calf-query.ts` (clasificador puro EID/IDV) + wiring `crear-animal.tsx`. **Veto de diseño del leader**: re-iteré para agregar la affordance "← Cambiar caravana" (control&freedom Nielsen #3 — un mistype en la manga no debe forzar abandonar ni crear un ternero bogus). Gate 2 PASS 0 HIGH + reviewer APPROVED (tras fix de 1 aserción E2E mal escrita = bug de test, no de producto). typecheck + 12 unit + E2E (#15 6/6 + back round-trip + RCAP.4.2) verdes. Specs reconciliadas (T1-T21 [x]).
- **Gate 2.5 (ADR-029 — verificación E2E + visual, PRIMER CASO)**: capture file `app/e2e/captures/cria-al-pie-alta.capture.ts` → 10 capturas nombradas (412×915), 2/2 tests verdes. **Veto visual del leader: PASS** (anti-recorte, sheet anatomy, manga-friendly, validación inline, es-AR, flujo de la spec). 2 observaciones menores no bloqueantes (nombre de rodeo del seed de test; 2da opción del picker bajo el fold con scroll-fade). Capturas adjuntadas a la Puerta 2.
- **✅ Puerta 2 APROBADA (Raf, 2026-06-30)** mirando las 10 capturas del Gate 2.5. Foldeado al baseline (`design.md` índice Deltas posteriores) + T22 [x]. Commits: backend `70c2efd`, frontend `c2fcebc`, capture `d577a64`, cierre `<este>`.

## Resumen
Raf + Facundo testearon la app en vivo (PRE-campo, sin datos reales, bastón no probado) → 16 correcciones. El leader hizo el triage (`docs/correcciones-prueba-en-vivo-2026-06-27.md`), formalizó la convención de delta-specs (ADR-028), y cerró 6 correcciones en 4 deltas. Las últimas 2 en **modo autónomo** ("hacé todo lo que puedas, no necesites nada de mí").

## ✅ Cerrado + commiteado (6/16)
| Corrección | Delta | Commit | Puerta 2 |
|---|---|---|---|
| #9 KPIs→Datos · #11 circunferencia escrotal · #12 dientes | Fase 1 (Nivel A) | `2009104`+`d67ea3e` | ✅ Raf (presente) |
| #5 badge repro · #6 prompt aptitud alta · #1b inseminación | `aptitud-reproductiva` | `0d447cd`+`b7c2554` | ✅ Raf (presente) |
| #3 fecha dd/mm · #13 condición stepper · #14 destildar | `alta-form-refinamiento` | `8926e16` | ⏸ **post-hoc (Raf)** |
| #6 caravana manual (electrónica+visual desde ficha) | `caravana-ficha` | `19f89bd` | ⏸ **post-hoc (Raf)** |

Todos frontend puro → Gate 1 N/A. Gates automáticos (veto leader + Gate 2 + reviewer) verdes en los 4.
**Commits locales en `main`, NO pusheados** (Raf pushea cuando quiera).

## E2E en vivo (2026-06-29, red recuperada) — corrida + arreglos
Suite completa: **176 passed / 10 failed** (1ra corrida en vivo de los e2e de los 4 deltas, antes solo estáticos). Arreglos (`impl_e2e-fixes-2026-06-29.md`):
- **5 e2e nuevos de los deltas** → TEST (sufijos de etiqueta truncados por `VISUAL_MAX_LENGTH=30`; `.filter({visible:true})`). Producto OK (screenshots). Verdes.
- **2 inseminación** (`maniobra-sanitaria`) → TEST setup (`categoryOverride` para que el animal sea apta) → **confirma que #1b es CORRECTO**. Verdes.
- **1 BUG DE PRODUCTO REAL** (no de los deltas; el alta lo destapó) → `setCustomAttribute` decidía UPDATE/INSERT por `rowsAffected` (no confiable sobre VIEW de PowerSync) → colisión de PK. **Fix frontend** (SELECT de existencia determinista) + test de regresión. **Cierra el backlog 2026-06-20.** Verde.
- **2 flakes pre-existentes** (NO tocados por los deltas, confirmados aislado): `events:282` mellizos · `maniobra-single-active:68` sesiones.
**GATEADO + COMMITEADO** (`4504cbe`, enmendado para sacar 41 `design/*.png` espurios que el e2e re-renderizó — memoria `reference_e2e_design_png_rerender`): veto leader PASS + Gate 2 PASS 0 HIGH + reviewer APPROVED. Los 8 fixes verdes (animals 28/28, maniobra-sanitaria 6/6, custom-render 3/3); 2 flakes pre-existentes documentados. **`check.mjs` completo VERDE end-to-end (exit 0)** — entorno validado (backend + unit + typecheck), red recuperada. **Los 4 deltas quedaron validados E2E en vivo, no solo unit.**

## ⏸ ESPERAN A RAF (su vuelta)
1. **Puertas 2 post-hoc** de `alta-form-refinamiento` + `caravana-ficha` (revisar los 2 commits autónomos; defaults del leader documentados en cada `design-*.md` §decisiones de criterio propio).
2. **Mirar en la app**: badge reproductivo (tradeoff de truncado del rodeo) · stepper/DD-MM del alta · afordancia de caravana en la ficha.
3. **Re-correr `check.mjs` completo** cuando la red a Supabase se estabilice (ver ⚠ abajo).

## ⏳ PENDIENTE — necesitan Raf / Facundo / deploy / hardware (NO autónomo)
- **#8 %parición** + **#10 %destete** → tocan RPC `0106` (Gate 1 + **deploy a la DB compartida, gateado a Raf**). #10 además gatea **peso de destete** (a charlar con Facundo, en `docs/backlog.md`).
- **A cluster ternero** (#7/#4/#15/#1a) → `register_birth` RPC + migración weaning_weight (deploy) + peso destete (Facundo).
- **#2 nombre/apodo** → toca `rodeo_data_config` (probablemente DB/deploy).
- **#6-bastoneo** → hardware (dev build Android + bastón spp-android, no probado; feature 04).
- **#16 tapear wheels** → Raf dijo "hacer después".

## ⚠ Incidencias de la sesión (no bloquean el frontend)
- **Red a Supabase inestable** (connect timeouts `UND_ERR_CONNECT_TIMEOUT`) → `check.mjs` completo falló en una suite backend (spec 10, NO tocada) = flake de red, no regresión. Re-correr cuando se estabilice.
- **3 subagentes murieron mid-run** (2× proceso/CLI exit, 1× error de API) — el trabajo aterrizó intacto las 3 veces (recuperado + re-verificado). **Lección**: typecheck+unit verde NO basta para confirmar wiring de un agente muerto (caso #6: imports muertos pasaban typecheck) → memoria `reference_crashed_agent_recovery`; el reviewer es el oráculo de completitud.

## Otro estado (no de esta sesión)
- **Spec 08 (SIGSA)** → `blocked` (status corregido in_progress→blocked esta sesión): espera (a) deploy YAML PowerSync [Raf] + (b) upload formato SIGSA [Facundo].
- Spec 02 → `in_progress` (#15 cría-al-pie-alta ✅ DONE/Puerta 2 aprobada 2026-06-30; arrancando el delta `parto-rodeo-caravana` #4/#1a — frontend-only, backend ya deployado). `alta-form-refinamiento` + `caravana-ficha` ⏸ Puerta 2 pendiente. Resto de deltas previos done.
