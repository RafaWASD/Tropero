# Review — 03-modo-maniobras / M6-C.1 (Circunferencia escrotal — cliente)

Reviewer: reviewer (Opus 4.8). Fecha: 2026-06-18.
Alcance: cableado de la maniobra CE al flujo real (3 modulos puros + write-path + dispatcher + componente + e2e).

## Veredicto: CHANGES_REQUESTED

Motivo dominante: node scripts/check.mjs ROJO por una regresion REAL (no el flake documentado). El delta de M6-C.1 en si esta bien hecho y con trazabilidad completa; el bloqueo es la suite de DB spec-02 que el seed de M6 (R14.18) rompio y no se reconcilio.

## Bloqueante — check.mjs rojo: 5 asserts deterministas 27 != 26 (regresion, NO flake)

La migracion 0099_scrotal_data_key_and_seed.sql (M6, ya live) agrega circunferencia_escrotal habilitado por defecto en cria (R14.18) -> la plantilla de cria crece 26 -> 27 filas. supabase/tests/animal/run.cjs sigue hardcodeando 26 y falla en:
- run.cjs:275 (T2.1 setup) 27 != 26
- run.cjs:621 (T2.9) 27 != 26
- run.cjs:891 (T2.16 plantilla) 27 != 26
- run.cjs:2513 (create_rodeo caso 1) 27 != 26
- run.cjs:2554 (create_rodeo caso 2) 27 != 26
Asserts 26 del mismo origen a actualizar tambien: lineas 902, 917, 960 + comentarios 270, 617, 914, 2510, 2654.

Esto NO es el flake animals_tag_unique 23505 (ese aparece en 1 solo test, R2 INPUT-1 CHECK, por terminales paralelas). Los 5 27!=26 son deterministas, causados por el seed R14.18 de esta feature.
Falla de reconciliacion (feedback_correcciones_en_specs): impl_03-m6-c1.md:8 solo reconocio el flake y se perdio estas 5 regresiones.

### Cambio requerido
Actualizar en supabase/tests/animal/run.cjs las count-assertions de la plantilla de cria de 26 -> 27 (275, 621, 891, 902, 917, 960, 2513, 2554 + comentarios), con nota +1 por circunferencia_escrotal (spec 03 R14.18, seed 0099). Re-correr check.mjs hasta verde. Lo arregla el implementer.

## Lo verificado OK (no bloqueante)

### Trazabilidad R<n> <-> test
- R14.1 maneuver-gating.test.ts:47,51-67 + e2e :126-127
- R14.2 maneuver-applicability.test.ts:199-220 + e2e :168-243
- R14.3 maneuver-applicability.test.ts:223-224 + e2e :246-250
- R14.4 maneuver-applicability.test.ts:235-247 + e2e secuencia vacia
- R14.5 wheel-picker.test.ts:37-55,142-189 + local-reads.test.ts:1174 + e2e :130-147
- R14.6 wheel-picker.test.ts (prefillAgeMonths) + e2e :132-135
- R14.7 e2e :250-258 + maneuver-event-query.test.ts:276-277
- R14.8 maneuver-sequence.test.ts:252-257 + e2e :164,268
- R14.9 maneuver-event-query.test.ts:263-268 + local-reads.test.ts:1138-1142 + e2e oraculo :160-163
- R14.10 local-reads.test.ts:1138,1174 + node:sqlite real event-query.test.ts:359-367 + e2e
- R14.17 maneuver-event-query.test.ts:284-287 + local-reads.test.ts:1162

### Aplicabilidad correcta
BULL_ENTIRE_CATEGORY_CODES {torito,toro} correcto vs animal-category.ts (enteros torito/toro, castrados novillito/novillo). categoryCode in {torito,toro} AND isCastrated !== true; null castracion -> incluye (R14.3); null categoria -> saltea. No incluye castrado ni excluye entero valido.

### Sin regresion
ALL_MANEUVERS -> 13; StepKind rueda factory-only (solo desde circunferencia_escrotal; custom cae por ui_component); case rueda en carga.tsx:864-884 aislado; toApplicabilityInfo suma isCastrated.

### Write-path / tokens
addScrotalMeasurement espeja events.ts; buildUpdateManeuverScrotal sigue R5.9 (UPDATE por id, filtra deleted_at); oraculo e2e verifica fila server con session_id + establishment_id/recorded_by forzados. Cero hardcode; foco verde por borderColor + supresion outline UA web-only (CircunferenciaEscrotalStep.tsx:283-297).

## Tasks completas: SI (M6-C.1 [x], tasks.md:512). M6-C.2 fuera de chunk.

## CHECKPOINTS
C1 [ ] check.mjs exit 0 -> ROJO (bloqueante). C2 [x]. C3 [x] (menor: header CircunferenciaEscrotalStep.tsx:3-6 quedo viejo, dice NO cableado). C4 [x]. C6 [x]. C7 [x] (backend scrotal 12/12). C8 [x].

## Checklist RAFAQ
A RLS [x] (backend M6, write-path no manda establishment_id). B Offline-first [x]. C BLE N/A. D UI campo [x] (touchMin, densidad 81,3%, una decision/pantalla). E Edge Functions N/A.

## Exactitud specs
design 12.1/12.2/12.4 + requirements R14.x consistentes con as-built. Gap: seed R14.18 cambio plantilla 26->27 y las count-assertions de animal/run.cjs quedaron viejas -> reconciliar a 27 (parte del fix).

## Resumen
Cliente de M6-C.1 solido. No se aprueba: check.mjs rojo por regresion determinista (5 asserts 27!=26 en supabase/tests/animal/run.cjs) del seed M6 R14.18 no reconciliada. Subir esas assertions a 27 + check.mjs verde -> pasa.
