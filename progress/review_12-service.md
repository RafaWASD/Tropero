# Review - Feature 12 (Importacion masiva de rodeo), Fase 3 SERVICE (T3.1-T3.5)

Reviewer: reviewer agent. Fecha: 2026-06-06 (sesion 23).
Alcance: capa I/O del import (services/import-rodeo.ts) + logica pura (utils/import/import-write.ts)
+ suite pura (utils/import/import-write.test.ts, 32 tests). Contra specs/active/12-import-rodeo.

## Veredicto: APPROVED

Fase 3 cumple el contrato de la spec, el split puro/I-O es correcto y coherente con el patron del repo,
los 32 tests asertan de verdad, check.mjs verde end-to-end (incluye suite backend del RPC, 25 tests,
con aislamiento cross-tenant). No hay tasks vacias de Fase 3 sin justificacion. Sin cambios requeridos.

---

## Trazabilidad R a test (Fase 3)

- R3.1 guard de tamano ANTES de parsear: checkFileSize. Tests: tope ok / borde / +1 byte rechazado / NaN-negativo / char-flood 50MB se ataja por TAMANO no por filas.
- R3.5 metacaracteres en filtros: escapeIlike (espejo F1-1). Tests: neutraliza comodines y coma / valor normal intacto.
- R3.6 parse falla a abortar: el parse vive en el hook (Fase 4); el service no escribe sin candidatas. Justificado en bitacora; cubre Fase 4.
- R7.2 dedup idv contra animal_profiles activos: dedupAgainstExisting + mergeDedupAgainstExisting. Test: idv existe a saltada (duplicate_idv_existing); I/O run.cjs.
- R7.3 reportar saltadas distinguiendo motivo: ExistingDuplicate.reason. Test: skipped lleva reason+value.
- R7.4 TAG no reusable a siempre skip prioridad TAG: merge chequea TAG antes que idv. Tests: TAG existe a duplicate_tag_existing nunca reasignacion / colision tag+idv reporta una vez prioridad TAG.
- R8.1 escritura en lote animals+profiles: writeInChunks a RPC. I/O run.cjs.
- R8.2 import parcial: writeInChunks por-chunk + accumulateChunk. Tests + I/O run.cjs (TAG dup se saltea, resto entra).
- R8.4 carrera unique server-side: RPC saltea unique_violation por fila; accumulateChunk mapea row_index a index. I/O run.cjs.
- R9.1 establishment del contexto: confirmImport recibe establishmentId; p_rows NO lo incluye. Test: keys prohibidas.
- R9.2 rodeo en establishment: RPC deriva est del rodeo. I/O run.cjs (p_rodeo_id otro est RECHAZADO).
- R9.3 autoria forzada: insertImportLog omite imported_by (trigger 0073). Test keys prohibidas + I/O run.cjs.
- R10.3 categoria columna a code+override true: resolveCategory. Tests.
- R10.4 lote por nombre a id no crear: resolveLotes (solo SELECT) + normalizeLoteName. Tests.
- R10.5 sin columna a placeholder no inferir: resolveCategory(null) a code null+override false; RPC pone placeholder por sexo. Tests.
- R11.1 import_log con conteos+detalle: insertImportLog. I/O run.cjs.
- R11.5 acotar error_details bajo CHECK octet_length: summarizeErrorDetails. Test CRITICO 5000 errores sqlerrm largos unicos nunca supera presupuesto + byteLengthUtf8 cuenta bytes.
- R12.2 offline a informar NO encolar: confirmImport resolveOnline corre antes de tocar la DB (lineas 311-321).
- R5.6 0 validas a no log de exito vacio: confirmImport con 0 candidatas inserta log imported_ok=0.
- T3.1 dedup EN LOTE URL-safe: 2 queries in() partidas con chunkRows(DEDUP_IN_CHUNK=500). Tests.
- T3.3 chunks bajo tope RPC 5000: chunkRows(CHUNK_ROWS=150). Tests.

Cobertura completa. Cada R de Fase 3 tiene codigo + test (o justificacion para R3.6, cuyo parseo es del hook).

## Tasks completas

- T3.1 dedup contra existentes (LOTE, URL-safe, skip nunca update, TAG prioridad) - [x] hecha.
- T3.2 resolucion category_code + lote por nombre + raza texto libre - [x] hecha.
- T3.3 escritura batch via RPC en chunks, import parcial, shape p_rows - [x] hecha.
- T3.4 insert import_log acotado (tambien 0 escritas), imported_by omitido - [x] hecha.
- T3.5 guards de input (tamano antes de parsear, escapeIlike, offline sin encolar) - [x] hecha.

Todas las tasks de Fase 3 en [x] realmente hechas. Fases 4/5/6 (vacias) estan FUERA del alcance de este run
(UI/hook/entry point/enganche) - no son responsabilidad de Fase 3, documentado en la bitacora.

## CHECKPOINTS

- [x] C1 - node scripts/check.mjs exit 0 (verificado).
- [x] C2 - feature 12 unica in_progress; no se marca done (espera Gate 2 + Puerta final).
- [x] C3 - arquitectura: services (unica capa I/O) + utils (puro). Sin hardcode de establishment_id. Sin TODOs/logs sueltos.
- [x] C4 - verificacion real: 32 tests cliente verdes + 25 backend (RPC/RLS) verdes con fixtures reales (JWTs reales, NO mocks de I/O). Cross-tenant probado en run.cjs.
- [ ] C5 - N/A para este run (cierre de sesion lo hace el leader).
- [x] C6 - spec con 3 archivos; cada R de Fase 3 con al menos 1 test.
- [x] C7 - multi-tenant: import_log con establishment_id FK + RLS (0073); RPC re-valida owner/vet + rodeo en est. is_owner_of/has_role_in usados (vet inline justificado: no existe has_role generico en 0005). Test cross-tenant en run.cjs.
- [x] C8 - offline-first: import es de oficina (online por diseno R12.1/R12.2). confirmImport informa sin encolar si offline. N/A PowerSync.

## Checklist RAFAQ-especifico

### A. Tablas con establishment_id / RLS - N/A en Fase 3
import_log y sus policies son Fase 2 (0073, ya gateada). Fase 3 solo CONSUME via insertImportLog (omite imported_by, lo fuerza el trigger).
Cross-tenant cubierto por run.cjs (Fase 2). Sin schema nuevo. El service no bypassa RLS (cliente del usuario, no service-role).

### B. Carga/edicion de datos en campo (offline-first) - PARCIAL (aplica R12.2)
- [x] El import es online por diseno (setup/oficina, no carga de campo) - design 7, R12.1.
- [x] confirmImport informa offline y NO encola (R12.2) - resolveOnline corre ANTES de cualquier I/O (lineas 311-321). Probe inyectable.
- [x] Conflictos: dedup contra existentes es skip+report NUNCA update; carrera server-side (R8.4) la maneja el RPC por-fila. Explicito (no last-write-wins: el import jamas pisa un existente).
- [x] No hace requests sincronos desde pantalla: toda I/O en services/import-rodeo.ts; el hook (Fase 4) orquesta.

### C. BLE - N/A. Fase 3 no toca BLE.
### D. UI de campo - N/A. Fase 3 es I/O + logica pura; la UI es Fase 4 (vacia).
### E. Edge Functions - N/A. Sin Edge Functions. La escritura va por RPC import_rodeo_bulk (0074, Fase 2 gateada): valida auth.uid() + rol owner/vet + tope de filas - verificado en run.cjs.

## Dedup (R7) - verificacion del brief
- Por LOTE no N queries: OK. 2 queries base partidas en sub-lotes DEDUP_IN_CHUNK=500 (~10 queries para 5000 ids).
- Skip + report NUNCA update: OK. mergeDedupAgainstExisting solo particiona; las saltadas no van al RPC. Ningun update en el modulo.
- TAG no reusable (prioridad): OK. chequea existingTags antes de existingIdvs; colision doble reporta una vez prioridad TAG.
- IN-list partida no pierde filas: VERIFICADO. Las queries por sub-lote ACUMULAN en Sets; merge se llama UNA vez con la lista completa contra los Sets completos (union de sub-lotes). La particion es de la lista de consulta, no de las candidatas. Correcto.

## Escritura (R8) - verificacion del brief
- Chunks bajo el tope: OK. CHUNK_ROWS=150 bajo 5000. El RPC enforca su tope de 5000 server-side (run.cjs: borde 5000 + mayor a 5000 rechazado entero).
- Import parcial: OK. writeInChunks itera; un chunk con error de transporte reporta sus filas y sigue (salvo primer chunk con red caida y nada escrito a propaga offline real). El RPC hace import parcial por-fila adentro.
- p_rows con shape del header 0074: OK. buildRpcRow arma EXACTAMENTE los 10 campos (verificado contra la migracion linea a linea); test enumera keys prohibidas y FALLA si aparecen.

## import_log (R11.5) - verificacion del brief
- error_details acotado: OK. summarizeErrorDetails presupuesta 200KB (bajo CHECK 262144 de 0073); recorta sample y by_reason en ultima instancia. Test CRITICO 5000 errores sqlerrm largos unicos nunca supera. byteLengthUtf8 cuenta bytes UTF-8 (alineado a octet_length).
- imported_by omitido: OK. insertImportLog no lo manda; lo fuerza el trigger 0073. file_name recortado a 255 (espejo del CHECK).

## Split puro/I-O - verificacion del brief
OK. Coherente con el patron del repo. La logica testeable vive en import-write.ts SIN imports RN/expo/supabase (testeable node:test).
La I/O (dedup, RPC, insert del log, confirmImport) vive en import-rodeo.ts (importa supabase). EXACTAMENTE el patron
establishment-store.ts (I/O, importa expo-secure-store) frente a utils/establishment.ts (puro) - verificado por lectura.
El service re-exporta funciones puras para el hook, igual que establishment-store.ts re-exporta promoteInTrail.

## Tests reales (no verde-falso) - verificacion del brief
OK. Los 32 asertan de verdad. Cubren: peor caso de error_details (5000 errores sqlerrm largos unicos, 177ms reales);
guard de tamano (borde, +1 byte, NaN, char-flood 50MB); dedup (idv/tag existente, prioridad TAG, sub-lotes URL-safe);
shape de p_rows sin campos forzados (assert por keys prohibidas). Suite enganchada en run-tests.mjs linea 53 (client unit tests) - corre en check.mjs.

## Reconciliacion spec a codigo (regla dura)
OK. La bitacora documenta desviaciones menores: DEDUP_IN_CHUNK=500 (default menor, con comentario); confirmImport orquestacion
en el service (justificado, I/O-orchestration); refactor a import-write.ts por bloqueo de expo-secure-store bajo node:test.
design 1.1 y tasks T3.1-T3.5 reconciliados ANTES de este run (as-built de import-write.ts, DEDUP_IN_CHUNK, resolveLotes I/O,
shape category_code server-side ya figuran en la spec marcados as-built). requirements/design/tasks coherentes con el codigo. Sin contradicciones.

---

## Notas para el leader (no bloqueantes)
1. Fallback sex por defecto female en buildRpcRow (import-write.ts:222): defensa pura. validateRows garantiza sex no-null para toda candidata (R5.2, validate-rows.ts:91-95); si disparara, el RPC re-CHECKea el enum. Solido.
2. R3.6 sin test directo en Fase 3: correcto - el parseo y su fallo viven en el hook (Fase 4); el service no escribe sin candidatas. T4.x debe cubrir parse-falla a abortar. Dependencia de Fase 4, no hueco de Fase 3.
3. .xlsx (R3.8) sigue diferido (no es Fase 3). Recordar para el cierre de la feature.
