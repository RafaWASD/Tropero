# Impl — Delta %PARICIÓN fix del 0% + lógica de meses de parto (#8) sobre spec 07

baseline_commit: ce51ab3bcbf66b4dea39b6a5025c55474375c318

**Feature**: `specs/active/07-reportes-basicos/{requirements,design,tasks,context}-paricion-fix.md` (`RPF.<n>`).
**Delta Nivel B (ADR-028) · CON BACKEND (RPC `rodeo_calving_kpi`) · Gate 1 PASS · Deploy autorizado (lo aplica el leader por MCP).**
**Estado**: in_progress (spec 07 baseline `done`; delta activo). **NO se marca `done` acá — lo cierra el leader tras Puerta 2.**

> **Nota de continuidad**: el implementer anterior fue frenado por accidente al ~90% (backend + frontend hechos y verificados; migración `0117` aplicada al remoto por el leader). Esta sesión ACOTADA completó el Gate 2.5 (capture file), cerró una brecha de test que encontró en la autorrevisión (T11 sin cobertura de `calvingCardView`), reconció los specs al as-built, y cerró el reporte. NO se re-hizo backend ni los componentes de frontend.

---

## Tasks (T1..T19) — as-built

**Backend (migración `0117_calving_kpi_status.sql`) — hecho por el implementer anterior, migración aplicada por el leader:**
- [x] **T1** — cuerpo vigente verificado (`0106:285-343`, único lugar de `rodeo_calving_kpi`).
- [x] **T2** — `0117_calving_kpi_status.sql` (DROP+CREATE con `status`/`pending_pregnant`).
- [x] **T3** — `calved`/`pregnant` sin cambios de conteo (set-membership concepción−9, incl. wrap).
- [x] **T4** — `pending_pregnant` (D4): preñadas vigentes sin parto contado.
- [x] **T5** — `status` con precedencia (`no_service_months`→`not_applicable_12m`→`not_calving_season`→`ok`).
- [x] **T6** — re-`revoke`/`grant` + smoke-check fail-closed + `notify pgrst`.
- [x] **T7** — solo `rodeo_calving_kpi` en la migración (las otras 8 RPC + Stream A intactas).

**Backend tests (`supabase/tests/reports/run.cjs`):**
- [x] **T8** — TR.4b: los 4 estados + `pending_pregnant`, fechas relativas a `new Date()`; TR.4 conservado (wrap `calved=2`, `pregnant≥calved`, serviced=0 sin NaN, IDOR 42501). **Verde (reports suite 15/15 post-apply).**

**Frontend (datos + presentación pura):**
- [x] **T9** — `reports.ts`: `CalvingRow`/`CalvingKpi` += `status`/`pendingPregnant`; `fetchCalvingKpi` mapea con default defensivo (`asCalvingStatus`, pending→0).
- [x] **T10** — `reports-format.ts`: `type CalvingStatus`, `asCalvingStatus`, `CALVING_PENDING_LEGEND`, `calvingCardView` (tabla design §3.2).
- [x] **T11** — `reports-format.test.ts`: **cerrado en esta sesión** (ver Autorrevisión §Brecha). 8 casos de `calvingCardView` + `asCalvingStatus`. Suite 42/42.

**Frontend (pantalla + spike):**
- [x] **T12** — `(tabs)/reportes.tsx` `ReproSection`: la card de Parición usa `calvingCardView(calv)` + leyenda D4 vía `InfoNote`.
- [x] **T13** — `reportes-spike.tsx`: 5 variantes `paricion-*` (reusan `calvingCardView`+`KpiCard`+`InfoNote`).
- [x] **T14** — anti-recorte/es-AR/tokens en los textos nuevos.

**Gate 2.5 (capture) — hecho en esta sesión:**
- [x] **T15** — `app/e2e/captures/paricion-fix.capture.ts` (**molde ADR-029** `cria-al-pie-alta`/`parto-rodeo-caravana`; navega al spike; 5 capturas nombradas a `__shots__/paricion-fix/`).
- [x] **T16** — capture corrido (`--config playwright.capture.config.ts --workers=1`): **1 passed**, 5 PNGs generados; `design/**` limpio (no re-renderizó). Veto design-review (leader): PASS (ver §Veto).

**Cierre:**
- [x] **T17** — autorrevisión adversarial (§abajo) + este reporte con el mapa `RPF.<n> → archivo:test`.
- [x] **T18** — reconciliación de specs al as-built (§abajo).
- [ ] **T19** — Deploy/cierre (LEADER): la migración `0117` YA está aplicada al remoto (reports 15/15 verde incl. TR.4b); el cierre final / Puerta 2 / `node scripts/check.mjs` verde queda del leader. **Checkbox sin marcar: tarea del leader, no del implementer.**

---

## Trazabilidad — `RPF.<n> → archivo:test`

**Backend — `supabase/tests/reports/run.cjs` (suite Reports, verde post-apply):**
- **RPF.1.1** (`service_months` NULL/`{}` → `no_service_months`) → `run.cjs` TR.4b (asserts `dNull.status`/`dEmpty.status === 'no_service_months'`).
- **RPF.2.1/2.2** (ventana +9; `current_date < min(+9)` → `not_calving_season`) → `run.cjs` TR.4b (`dFut.status === 'not_calving_season'`, `service_months=[mesActual]`, `p_year=thisYear`).
- **RPF.2.3** (dentro/después de ventana → `ok` + `calved`) → `run.cjs` TR.4b (`dOk.status==='ok'`, `service_months=[1]`, parto Oct∈concepción Ene).
- **RPF.3.1/3.2** (12 meses → `not_applicable_12m`, precede a la ventana) → `run.cjs` TR.4b (`d12.status === 'not_applicable_12m'`).
- **RPF.4.1** (`pending_pregnant`) → `run.cjs` TR.4b (`pending_pregnant`=1 con 1 preñada sin parto; =0 al agregar el 2º parto).
- **RPF.5.1/5.2** (denominador + `calved` conservados) → `run.cjs` TR.4 (`calved` por concepción ∈ `service_months` + WRAP `calved=2`, `pregnant≥calved`).
- **RPF.5.3/5.4** (`SECURITY DEFINER`, guard fail-closed 42501) → `run.cjs` TR.4 IDOR (owner B → `42501`) + suite fail-closed (`anon`/ghost).
- **RPF.5.5** (`revoke`/`grant` + smoke) → migración `0117` smoke-check fail-closed + la suite corre como `authenticated`.
- **RPF.5.6** (otras 8 RPC intactas) → suite Reports completa verde (TR.1–TR.11 sin regresión).
- **RPF.8.1–8.6** → `run.cjs` TR.4b (8.1–8.5) + TR.4 (8.6: wrap/`pregnant≥calved`/serviced=0/IDOR).

**Frontend puro — `app/src/utils/reports-format.test.ts` (node:test, 42/42):**
- **RPF.6.1 / CD-6** (mapeo `status`→`CalvingStatus`, default defensivo) → test `asCalvingStatus: pasa los 4 estados válidos; ausente/desconocido → "ok"`.
- **RPF.6.2** (función pura `calvingCardView`) → los 8 tests `calvingCardView: …`.
- **RPF.2.5** (ok → % + "N paridas / M servidas") → test `calvingCardView: ok con servidas>0 → % es-AR + detalle`.
- **RPF.4.2/4.3** (leyenda D4 solo ok + pending>0) → tests `ok con pendingPregnant>0 → leyenda D4` y `ok con serviced=0` / `not_calving_season` (sin leyenda).
- **RPF.2.4** (`not_calving_season` → mensaje, no 0%) → test `not_calving_season → "—" + "todavía no es época de parición"`.
- **RPF.1.3** (`no_service_months` → mensaje) → test `no_service_months → "—" + "sin meses de servicio configurados"`.
- **RPF.3.3** (`not_applicable_12m` → mensaje) → test `not_applicable_12m → "—" + "no aplica (servicio todo el año)"`.
- **RPF.6.3** (es-AR coma decimal) → tests `formatPercentAR` + los valores "82,6 %"/"65,2 %" en los casos ok.

**Gate 2.5 — `app/e2e/captures/paricion-fix.capture.ts` (1 passed, 5 PNGs):**
- **RPF.7.1** (5 estados) → capturas `01-ok-con-porcentaje`, `02-not-calving-season`, `03-no-service-months`, `04-not-applicable-12m`, `05-ok-con-leyenda`.
- **RPF.7.2** (anti-recorte descendentes) → `assertTextNotClipped` sobre "Parición", "todavía no es época de parición", "sin meses de servicio configurados", y la leyenda D4.

> **RPF.6.4** (no romper otras secciones) — cubierto por la suite E2E de regresión de reportes existente + el spike (variante `kpis` sigue renderizando preñez/CCL/cruce/peso); la card de Parición es el único cambio de render en `ReproSection`.

---

## Veto design-review (Gate 2.5) — PASS

Inspección visual de las 5 capturas (`__shots__/paricion-fix/`, 412×915):
- **01** — "82,6 %" (verde, no muted) + "38 paridas / 46 servidas". El bug del "0 %" no aparece.
- **02/03/04** — valor muted "—" (guion, visualmente distinto del %) + el mensaje accionable correcto ("todavía no es época de parición" / "sin meses de servicio configurados" / "no aplica (servicio todo el año)"). **Ningún "0 %" engañoso.**
- **05** — "65,2 %" + "30 paridas / 46 servidas" + la leyenda D4 en un `InfoNote` (tono terracota/aviso) bajo la fila Preñez|Parición.
- **Anti-recorte**: "Parición" (con descendente "ó") y los mensajes con descendentes ("época", "parición", "servicio", "aplica") sin clip. Layout Preñez|Parición en fila de dos, idéntico a la tab real.

---

## Autorrevisión adversarial (paso 8)

**Qué busqué (revisor hostil):** (a) que el capture cubra genuinamente los 5 estados y no pase por la razón equivocada; (b) anti-recorte real en "Parición"/mensajes con descendentes; (c) que el frontend consuma bien `status` (no un 0% colado); (d) que la trazabilidad no sea un mapa mentiroso; (e) unused imports / código muerto; (f) desviaciones spec↔as-built sin reconciliar; (g) que el capture sea determinista sin seed/red.

**Brecha encontrada y CERRADA — T11 sin cobertura (crítica):** `reports-format.test.ts` **importaba** `calvingCardView`/`asCalvingStatus`/`CALVING_PENDING_LEGEND` (líneas 25-27) pero **NO tenía ningún test que los ejercitara** — el implementer anterior fue frenado antes de escribir los casos de T11. Efectos: (1) imports sin uso; (2) RPF.6.2/RPF.1.3/2.4/2.5/3.3/4.2/4.3 sin cobertura frontend real → el mapa de trazabilidad habría sido falso ("inventar verde"). **Cierre:** agregué 8 tests (`calvingCardView` × 7 estados + `asCalvingStatus` normalizer) modelados sobre la tabla design §3.2, con valores concretos ("82,6 %", "65,2 %", leyenda D4, "—"+mensaje por estado, `null`, y CD-6 ausente/desconocido→'ok'). Suite: **34 → 42/42 verde**. `pnpm typecheck` limpio. (No re-hice el componente ni el service — solo completé el test faltante, que ya tenía los imports listos.)

**Otras verificaciones (sin hallazgos):**
- **Capture no pasa por la razón equivocada**: cada estado assertea el TEXTO específico visible ANTES del `shot` (82,6 %/65,2 %/detalle, y el mensaje exacto por estado); el 01 assertea explícitamente que la leyenda D4 NO aparece (`toHaveCount(0)`), y el 05 que SÍ. No hay screenshot a ciegas.
- **Determinismo / offline-del-harness**: el capture navega al SPIKE (`?variant=paricion-*`, DEV_WEB_ROUTES, datos MOCK) — sin login, sin seed, sin RPC, sin depender de la fecha del CI. Los estados temporales (`not_calving_season`, ventana +9) los fuerza el mock, no una siembra frágil. La `page` fixture aplica el env-shim sola.
- **Anti-recorte**: `assertTextNotClipped` mide `scrollHeight ≤ clientHeight+1` en los nodos hoja; corre en los 3 textos con descendentes exigidos por RPF.7.2 (+ la leyenda). Verde.
- **Consumo del `status` en el frontend**: `calvingCardView` (verificado por unit) es la única fuente de la presentación; la card real (`reportes.tsx`) y el spike la reusan → lo vetado en la captura ES lo de producción. El default defensivo (`asCalvingStatus` ausente→'ok') evita romper si el cliente corre contra una DB sin `0117` (CD-6), testeado.
- **Multi-tenant / seguridad**: sin cambios en esta sesión — el `status`/`pending_pregnant` scopean por el conjunto servidas (tenant re-guardado) como el `calved`/`pregnant` vigentes; guard `has_role_in` fail-closed 42501 conservado (TR.4b/TR.4). Nada nuevo que exponer.
- **`git add` disciplina**: `__shots__/*.png` gitignored (`app/.gitignore:29`) → NO se commitean; `design/**` revertido tras el `e2e:build` (`reference_e2e_design_png_rerender`); el `.capture.ts` SÍ se commitea.

---

## Reconciliación de specs (regla `feedback_correcciones_en_specs`)

Reconcilié el as-built ANTES de reportar (el implementer anterior dejó los specs sin actualizar):

1. **Número de migración `0107` → `0117`** (design-paricion-fix.md + tasks-paricion-fix.md). Motivo: `0107` ya estaba ocupado por `0107_breed_catalog.sql` (SIGSA); la migración real del delta es `0117_calving_kpi_status.sql` (siguiente libre, ya aplicada). Agregué una nota de reconciliación en design §1. `requirements-paricion-fix.md` **no cita** número de migración → sin cambios (verificado). `reports.ts` ya citaba `0117` correcto.
2. **Convención del capture (Gate 2.5) → ADR-029** (design §4 + tasks T15). El borrador apuntaba al molde `reportes-spike.capture.ts` (context `hasTouch`/`isMobile`, anchos 360/412, salida `tests/stream-c/paricion-<variant>-<w>.png`). El as-built adopta el estándar **ADR-029** vigente: molde `cria-al-pie-alta`/`parto-rodeo-caravana`, capturas nombradas por estado a `__shots__/paricion-fix/<NN>-<estado>.png`, un solo viewport mobile 412×915. Documenté el cambio-vs-borrador en design §4.
3. **T15** reescrita al as-built; **T1–T18** en `[x]`; **T19** anotada (migración aplicada por el leader; cierre pendiente del leader).

No quedan specs que contradigan el código. La reconciliación de cierre al baseline (puntero bajo R7.6 en `requirements.md` + bloque "Deltas posteriores" en `design.md` baseline, ADR-028) es parte de la Puerta 2 del leader.

---

## Verificación final

- `app/e2e/captures/paricion-fix.capture.ts` → **1 passed** (`--config playwright.capture.config.ts --workers=1`); 5 PNGs en `app/e2e/captures/__shots__/paricion-fix/` (`01-ok-con-porcentaje`, `02-not-calving-season`, `03-no-service-months`, `04-not-applicable-12m`, `05-ok-con-leyenda`).
- `app/src/utils/reports-format.test.ts` → **42/42** (con los 8 tests nuevos de T11).
- `pnpm typecheck` → **limpio**.
- `design/**` → sin diffs espurios (revertido tras `e2e:build`); `__shots__/*.png` NO stageados (gitignored).
