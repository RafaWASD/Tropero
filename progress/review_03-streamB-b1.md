# Review - spec 03 Stream B / B1 (CABLEADO del selector de meses de servicio)

Reviewer: reviewer (Opus 4.8). Fecha: 2026-06-23.
Diff revisado: working tree vs HEAD (sin commitear), 13 archivos MOD + 2 NEW (editar-servicio.tsx, maniobra-servicio-rodeo.spec.ts).
Ledger del implementer: progress/impl_03-streamB-b1-wiring.md.
Contra: requirements-puesta-en-servicio-cliente.md (RPSC.2/RPSC.3/RPSC.8) + design (sec 1/5, DD-PSC-4, DD-PSC-5) + patron as-built set_rodeo_config/enqueueSetRodeoConfig + CHECKPOINTS + checklist RAFAQ.

## Veredicto: APPROVED

Cableado correcto, fiel al molde set_rodeo_config; offline-first real (alta + edicion); multi-tenant sin hardcode; idempotente; specs reconciliadas; check.mjs verde; trazabilidad completa con asserts reales. Cero hallazgos bloqueantes. El e2e maniobra-servicio-rodeo.spec.ts lo corre el leader aparte (env-baking); no bloquea este review (codigo + unit revisados).

## Trazabilidad RPSC.n -> test (completa)

| Requisito | Test concreto (archivo:linea) | Estado |
|---|---|---|
| RPSC.2.1 selector 12 meses en alta | crear-rodeo.tsx:335-341 paso 4 + e2e:74 (service-months-grid) | OK |
| RPSC.2.2 primavera pre-tildada alta | crear-rodeo.tsx:95 [...SPRING_DEFAULT] + e2e:75-81 (resumen Oct->Dic, chips 10/12 aria-pressed=true, chip-1=false) | OK |
| RPSC.2.3/.8/.9 un periodo contiguo+wrap por construccion | service-months.test.ts (isContiguousWrap/buildContiguousRun/nextRangeSelection/serviceRunBounds) | OK |
| RPSC.2.4 manda p_service_months por outbox->create_rodeo | rodeos.ts:277 + upload.test.ts:57 (mapIntentToRpc create_rodeo passthrough) + e2e oraculo waitForServerRodeoServiceMonths(rodeoId,[10,11,12]):126 | OK |
| RPSC.2.5 no tocar el paso -> primavera default | crear-rodeo.tsx:213 + rodeos.ts:262-263 (hasServiceMonths incluye la key) + e2e:97-127 | OK |
| RPSC.2.6 array 1-12 unico en rango | service-months.test.ts toServiceMonthsArray + editar-servicio.tsx:74 (sanea antes de mandar) | OK |
| RPSC.3.1 superficie ver/editar meses | rodeos.tsx:316-334 (RodeoCard fila Meses de servicio) + editar-servicio.tsx + e2e:167-173 | OK |
| RPSC.3.2 sin configurar != no hace servicio; sin pre-tildar | ServiceMonthsSelector.tsx:272-287 (banner service-months-unconfigured en edicion+null) + activeShortcutId(null)->null (service-months.ts:284) + e2e:178-179 | OK |
| RPSC.3.3 guardar -> set_rodeo_service_months por outbox | rodeos.ts:321 + outbox.ts:258 + upload.test.ts:104 + e2e edicion offline:193-216 | OK |
| RPSC.3.4 optimista en el lugar | local-reads.ts:177-182 (COALESCE) + local-reads.test.ts:318 (la EDICION optimista PISA service_months) + e2e:197-203 (overlay Jun->Jul sin red) | OK |
| RPSC.3.5 idempotente sin client_op_id | outbox.ts:258-276 + upload.test.ts:116 (set_rodeo_service_months SIN p_client_op_id) + e2e:218-228 (re-guardar mismo periodo -> sigue {6,7}) | OK |
| RPSC.3.6 P0002 rodeo borrado -> revertir overlay | upload.ts:203-205 + upload.test.ts:287-297 | OK |
| RPSC.3.7 parseo tolerante TEXT + schema.text | schema.ts:160 (column.text) + schema.test.ts:218 (GUARD) + rodeos.ts:134 toRodeo->parseServiceMonths + service-months.test.ts (null/corrupto/literal) | OK |
| RPSC.8.1 multi-tenant no hardcode est | rodeos.ts (createRodeo usa contexto activo; setRodeoServiceMonths solo manda p_rodeo_id, la RPC deriva el est) + grep uuid literal: 0 hits | OK |
| RPSC.8.2 offline-first B1 | outbox.ts (overlay + clasificacion) + e2e edicion OFFLINE (setOffline(true):176, optimista:197, drena al reconectar:206-216) | OK |

Cero R-n sin test.

## Tasks completas: SI

T1-T9 todas en [x] en el impl ledger. Verificadas contra el codigo:
- T1 (schema.ts): rodeos.service_months + pending_rodeos.service_months + tabla pending_rodeo_service_months (localOnly) en Schema({}) + PENDING_OVERLAY_TABLES.
- T2 (local-reads.ts): buildRodeosQuery COALESCE + pr.service_months; buildPendingRodeoInsert 8 placeholders; buildPendingRodeoServiceMonthsInsert/buildDeletePendingRodeoServiceMonths (DELETE-PRIOR).
- T3 (outbox.ts): enqueueCreateRodeo lleva serviceMonths; enqueueSetRodeoServiceMonths (DELETE-PRIOR + INSERT, sin client_op_id).
- T4 (upload.ts): set_rodeo_service_months en RPC_OP_TYPES + P0002->permanent_reject compartido con set_rodeo_config.
- T5 (rodeos.ts): Rodeo.serviceMonths, toRodeo, createRodeo+serviceMonths, setRodeoServiceMonths.
- T6 (crear-rodeo.tsx): paso 4, TOTAL_STEPS=4, ProgressBar, primavera default.
- T7 (editar-servicio.tsx + rodeos.tsx): pantalla dedicada + entrada RodeoCard owner-only.
- T8 (e2e): maniobra-servicio-rodeo.spec.ts (alta + edicion offline) + helpers oraculo en admin.ts.
- T9: check.mjs + autorrevision + reconciliacion.

Ninguna task [ ] sin justificacion.

## CHECKPOINTS

- C1 (harness): [x] check.mjs exit 0 (Entorno listo).
- C2 (estado coherente): [x] (feature 03 done; Stream B por dispatch).
- C3 (arquitectura): [x] solo capas previstas; sin deps nuevas; sin logs debug (grep 0 console.* en archivos de produccion B1); sin hardcode establishment_id (grep uuid literal 0 hits).
- C4 (verificacion real): [x] test por modulo con logica (service-months/local-reads/upload/schema) con fixtures reales (node:sqlite); runner >0 verde; B1 no toca RLS (cross-tenant de C4 vive en Stream A).
- C5 (cierre): [x] sin artefactos temporales nuevos.
- C6 (SDD): [x] los 3 docs presentes; EARS estricto (RPSC.x); cada RPSC con >=1 test.
- C7 (multi-tenant): [x] parcial: B1 NO crea tabla con establishment_id (service_months vive en rodeos, pre-existente con RLS de Stream A); el cliente no hardcodea est; la RPC owner-only (Stream A, Gate 1 PASS) es la barrera; no se abre camino de escritura que saltee la RPC. El test cross-tenant real vive en Stream A (security_spec_02).
- C8 (offline-first): [x] alta + edicion offline (outbox + overlay); bucket correcto (est_rodeos SELECT *); conflict resolution last-write-wins explicito (UPDATE idempotente de la RPC, DD-PSC-4).

Sin boxes vacios en checkpoints aplicables.

## Checklist RAFAQ-especifico

A. Tablas con establishment_id (RLS): N/A para el cableado. B1 NO crea ni altera tablas ni policies: la columna rodeos.service_months (0102) y las RPC owner-only (0103) son as-built de Stream A (Gate 1 PASS). schema.ts es el schema CLIENTE de PowerSync (TS), no migracion. CASO A verificado: sync-streams/rafaq.yaml UNTOUCHED (git diff vacio) -> est_rodeos = SELECT * -> la columna fluye sola.

B. Carga/edicion offline (offline-first): APLICA, todo [x]:
- [x] Funciona offline: alta y edicion van por outbox + overlay optimista; e2e edicion con setOffline(true):176 + optimista:197.
- [x] Sync bucket correcto: est_rodeos scoped por establishment (Stream A); la columna baja por SELECT *.
- [x] Conflict resolution: last-write-wins explicito (UPDATE idempotente de set_rodeo_service_months, DD-PSC-4; sin client_op_id, RPSC.3.5).
- [x] No hace requests sincronos a Supabase desde la pantalla: editar-servicio.tsx/crear-rodeo.tsx consumen el repo (rodeos.ts) que toca SQLite local + outbox; el RodeoContext provee el rodeo ya sincronizado.

C. BLE: N/A (no toca BLE).

D. UI de campo (manga): APLICA (selector enchufado), [x]:
- [x] Targets >= touchMin (chips minHeight=$touchMin, ServiceMonthsSelector.tsx:108; filas RodeoCard $chipMin). Selector ya vetado por el leader en el spike.
- [x] Fuente legible (chips fontSize $6, resumen $7).
- [x] Una decision por pantalla (paso 4 = solo meses; pantalla dedicada editar-servicio.tsx).
- [x] Loading visible: crear-rodeo.tsx Creando...; editar-servicio.tsx Guardando...
- Nota: el design-spike del selector ya paso el veto del leader; este chunk es el cableado, no redisena la UI.

E. Edge Functions: N/A (no toca Edge Functions; las RPC son de Stream A).

## Exactitud de specs (codigo -> spec, paso 6)

Reconciliacion correcta, sin specs viejas:
- design sec 1 (lineas 57-64): la NOTA AS-BUILT del CABLEADO de B1 describe exactamente lo construido (4 pasos en crear-rodeo; createRodeo+p_service_months; pantalla dedicada editar-servicio.tsx; overlay pending_rodeo_service_months gemelo de pending_rodeo_data_config; COALESCE; upload P0002->permanent_reject; ruta en _layout.tsx).
- design sec 5 (linea 260): la NOTA CASO A verificada contra el repo (rafaq.yaml untouched).
- DD-PSC-4 (RPC dedicada por outbox) y DD-PSC-5 (componente reutilizable + util puro) cumplidos.
- requirements: el QUE (RPSC.2/RPSC.3) no cambio; el cableado implementa los EARS al pie; sin contradiccion con el as-built. Nada que mienta.

## Verificacion ejecutada

- node scripts/check.mjs -> VERDE (typecheck + anti-hardcode 0 violaciones + client unit incl. powersync + backend suites; Entorno listo).
- Suite powersync: builders nuevos cubiertos con asserts reales: upload.test.ts (mapIntentToRpc set_rodeo_service_months SIN p_client_op_id; classify P0002/42501/23514->permanent_reject, red->transient), local-reads.test.ts (COALESCE proyeccion + comportamiento sobre node:sqlite: overlay PISA, doble-edicion->1 fila, buildPendingRodeoInsert 8 placeholders, los 2 builders nuevos, PENDING_OVERLAY_TABLES 8, clearOverlay del nuevo overlay), schema.test.ts (38 tablas, pending_rodeo_service_months en PENDING_TABLES, service_months en rodeos/pending_rodeos, GUARDs de columnas).
- Anti-recurrencia: titulos con lineHeight matching (ServiceMonthsSelector.tsx:261/97, editar-servicio.tsx:97); sin recorte de descendentes en el titulo con interrogacion/g/q/j.

## Cambios requeridos

Ninguno. Observaciones menores NO bloqueantes (no requieren accion): el comentario crear-rodeo.tsx:253 dice barra de progreso (3 pasos) pero TOTAL_STEPS=4 (cosmetico); el helper e2e admin.ts suma 2 oraculos no listados en el dispatch pero in-scope de T8.

---

APPROVED -> pendiente del leader: re-correr el e2e maniobra-servicio-rodeo.spec.ts con el env-baking arreglado (no bloquea este review) + Gate 2.
