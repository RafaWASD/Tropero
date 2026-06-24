# Review — spec 07-reportes-basicos · FRONTEND (Stream C)

Reviewer (agente). Alcance: SOLO el frontend de Stream C (online-only, consume las 9 RPC de 0106 ya
deployadas + Gate-2-aprobadas). El backend (RPC + suite) ya tiene su review APPROVED aparte
(progress/review_07-reportes-backend.md). Archivos auditados: reports.ts, reports-format.ts (+ .test.ts),
use-reports.ts, components/reports/*, pantallas reportes.tsx / sesiones / sesion[id] / comparar,
reportes-spike.tsx, _layout.tsx (rutas), e2e/captures/reportes-spike.capture.ts.

## Veredicto: APPROVED

---

## 1. Gates duros

- node scripts/check.mjs VERDE — exit 0 (All tests passed / Entorno listo). Incluye typecheck cliente +
  unit (reports-format.test.ts) + anti-hardcode + suite backend reports/run.cjs (hook DESCOMENTADO en
  run-tests.mjs:81 — 0106 aplicada al remoto 2026-06-24). Sin rojos.
- reports-format.test.ts 34/34 — corrido via el resolver del repo (--import ./scripts/ts-ext-resolver.mjs).
- Trazabilidad R7.x -> test: cada R de UI ligado (seccion 2).
- Tasks del frontend en [x]: T5.3-T7.3. Las [ ] restantes (T8.x) justificadas (seccion 3).
- design/requirements vs as-built: reconciliado en design.md seccion 12 (12.1-12.5); coincide con el
  codigo real (seccion 4). requirements.md sin tocar (EARS literal).
- No hardcode de establishment_id/rodeo_id: 0 literales; todo viene del caller (contexto/params).
- Gate 2 (code) PASS: progress/security_code_07-reportes-frontend.md (sin HIGH ni MEDIUM).

## 2. Trazabilidad R7.x <-> test (frontend)

Cobertura autoritativa = logica PURA (reports-format.test.ts, 34 tests) + veto visual (14 PNG) + las RPC
backend ya gateadas (computo/seguridad, suite reports/run.cjs). Los R de UI:

- R7.1.1/.2/.4 -> reportes.tsx (tab raiz reemplaza stub; scope establecimiento+rodeo; rodeo como unidad).
- R7.1.3 -> reportes.tsx useFocusEffect deps [rodeoId,year,establishmentId] + use-reports.ts (guard seqRef).
- R7.2.1 -> reports.ts (solo supabase.rpc; cero queries directas; no replica agregacion).
- R7.2.2 -> reports.ts assertOnline ANTES de la RPC -> kind offline; ReportOffline; captura offline-{w}.png.
- R7.2.3 -> NO implementado, OPCIONAL explicito (requirements R7.2.3 / design 12.5). NO bloqueante.
- R7.2.4 -> ReportError/ReportOffline con reintento; use-reports.ts reload.
- R7.3.1/.2/.5 -> sesion/[id].tsx (useSessionSummary + getSessionById local); empty si totalEvents===0.
- R7.3.6 -> sesiones.tsx (useRodeoSessions) + sessionRangeLabel.
- R7.4.1/.2/.3 -> comparar.tsx + compareSessions (test: delta B-A, kind faltante=0 no se omite, orden).
- R7.5.1/.3/.4/.5 -> ReproSection (safePercent(pregnant,serviced) base unica; absolutos; em-dash si 0) + tests.
- R7.5.6/R7.6.6 -> isConfigured===false -> Configura la estacion + CTA /editar-servicio; captura config-{w}.
- R7.5.7/.8 -> YearStepper + defaultCampaignYear (test: ultima con datos, no actual); tope ano+1; wrap server.
- R7.6.1/.3/.4/.5 -> reportes.tsx (safePercent(calved,serviced) base unica; absolutos paridas/servidas).
- R7.7.1-.5 -> CclBars + cclBarsForMonths->sizeBucketsForServiceMonths (FUENTE UNICA) — tests 1/12/0->[],
  3->tercios, 2->cabeza/cola pliega body, total0->0%.
- R7.8.1/.2/.3 -> CclBlock/CclBars (bornBars junto al tacto; degrada bornTotal===0 con nota).
- R7.9.1-.4 -> WeightSection (formatKgAR; nro animales r.nAnimals; em-dash sin peso) + tests.
- R7.9.5 -> comparar.tsx WeightCompare (compareWeights por sesiones, fetchWeightByCategory(rodeoId,sessionId)).
- R7.10.2/.4 -> OverdueSection + AlertList + empty positivo; captura alertas-{w}/vacio-{w}.
- R7.11.3/.5 -> UnweighedSection + daysSinceLabel (test null->Nunca pesado) + empty positivo.
- R7.12/R7.13 -> server-side (RPC gateadas), cubierto por suite backend reports/run.cjs.
- R7.14 -> as-built animal_timeline (no se reimplementa).

## 3. Tasks completas: si (frontend)

- T5.3, T5.4, T6.1-T6.8, T7.1, T7.2, T7.3 -> [x] (todas las del frontend), verificadas contra el codigo.
- [ ] restantes (T8.x) — JUSTIFICADAS, no son trabajo de implementacion del frontend pendiente:
  - T8.1 / T8.2 -> consistencia transversal de las RPC de rodeo (join animal_profiles + deleted_at/status)
    y ficha individual animal_timeline. Son del stream BACKEND, ya cubiertas y APPROVED en
    review_07-reportes-backend.md. Fuera del scope del frontend.
  - T8.3 -> veto design-review del leader (paso del leader ANTES de mostrar a Raf). No es tarea del
    implementer/reviewer. La captura del veto esta lista (2/2, 14 PNG en tests/stream-c/).
  - T8.4 -> autorrevision + mapa R->test + reconciliacion: EJECUTADA por el implementer (ledger
    impl_07-reportes-frontend.md). Box dejado para que el leader lo folde al cerrar.
  - T8.5 -> Gate 2: HECHO (security_code_07-reportes-frontend.md PASS + el backend).
  - T8.6 -> apply de migraciones + Puerta 2 humana: el apply de 0106 YA esta hecho (hook descomentado,
    check verde con la suite backend). La Puerta 2 humana la cierra Raf.

## 4. Exactitud de specs (codigo -> spec): OK

design.md seccion 12 (FRONTEND as-built) reconcilia las 5 desviaciones de empaquetado y coincide con el codigo:
- 12.1 logica pura en reports-format.ts (split SDK/puro) -> OK existe, 34 tests.
- 12.2 ReportError 5 kinds offline|network|server|forbidden|validation -> OK reports.ts:32-35; mapeo
  42501/P0002->forbidden, 22023->validation (mapRpcError).
- 12.3 sesiones.tsx (lista) + reportes-spike.tsx (mock dev) agregados -> OK existen; rutas en _layout.tsx.
- 12.4 stepper con defaultCampaignYear, tope ano+1 -> OK.
- 12.5 R7.2.3 NO implementado (limitacion conocida) -> OK coherente; NO se reclama cubierto.
requirements.md no contradice el as-built (EARS intactos; R7.2.3 marcado opcional). Sin specs viejas.

## 5. Arquitectura / convenciones

- Capas: services/reports.ts = unica I/O (supabase.rpc); reports-format.ts PURO (sin SDK/RN);
  use-reports.ts orquesta; components/reports/* SIN fetch; pantallas consumen hooks. Dependencias OK.
- Errores explicitos: ReportResult<T> tipado; mapRpcError sanea (no propaga error.message crudo a la UI).
- Anti-parpadeo (conventions.md UI): reportView (loading && data===null); refresh no blanquea + guard seqRef.
- es-AR: formatPercentAR/formatKgAR/formatKgDeltaAR (coma decimal, punto miles), testeado.

## 6. Checklist RAFAQ-especifico

### A. Multi-tenancy / RLS — N/A directo (cubierto server-side)
El frontend NO crea tablas ni RLS. La frontera de tenant la imponen las 9 RPC SECURITY DEFINER (gate
backend). El cliente pasa los ids como param (nunca hardcode) -> IDOR responde 42501 -> mapeado a forbidden
(no vacio silencioso, R7.12.3). Verificado en Gate 2 frontend.

### B. Offline-first — N/A (online-only por diseno, R7.2 / context.md 7)
- [x] Online-only es decision de spec (reportes no son dato de campo, no sincronizan). assertOnline detecta
  offline ANTES de llamar -> estado claro, no cuelga. Sin bucket PowerSync nuevo. No aplica conflict-res (read-only).

### C. BLE — N/A.

### D. UI de campo (manga) — N/A directo (densidad mixta oficina+campo, design 6)
- [x] Targets tactiles $chipMin/$animalRow/36px+ con buttonA11y. Anti-recorte de descendentes verificado
  (lineHeight matching en headings >=$6 + kpiValueFontToken length-aware web-safe; bug de truncado de
  82,6 % cazado y corregido en autorrevision). Loading visible, empty states calidos, error accionable.

### E. Edge Functions — N/A (design 3 descarto Edge a favor de RPC SQL; el frontend no toca Deno).

## 7. Observaciones menores (NO bloquean)

1. reportes.tsx:561 OverdueSection reusa sessionDateLabel(d.nextDoseDate) para la fecha de vencimiento de
   una dosis. Funcionalmente OK (es-AR date), nombre semanticamente raro. Cosmetico.
2. ReportStateCard (ReportStates.tsx:121-125): icon='error' cae al else que renderiza Inbox (bandeja) en
   vez de un icono de error; el color terracota lo distingue igual. Cosmetico.
3. comparar.tsx reloadPair usa setTimeout(...,0) + toggle null->valor para forzar el re-fetch. Fragil pero
   funcional (guard active evita set-state-after-unmount).
4. Ledger dice reports-format 33/33; el archivo real tiene 34 (34/34 verde). Subestima, no sobre-promete.

Ninguna afecta correctitud, seguridad ni trazabilidad.

## CHECKPOINTS

- C1 harness — [x]   - C2 estado coherente — [x]   - C3 arquitectura — [x] (sin hardcode/TODOs/logs).
- C4 verificacion real — [x] (34 tests puros + suite backend con fixtures; runner >0 verde).
- C5 sesion cerrada — [ ] (no aplica al reviewer del frontend; lo cierra el leader).
- C6 SDD — [x] (3 archivos spec; EARS; cada R con test; tasks frontend [x], [ ] justificadas).
- C7 multi-tenant — [x] (server-side por RPC; cliente sin hardcode; IDOR->forbidden).
- C8 offline-first — [x] (online-only justificado; sin bucket; sin conflict-res).
