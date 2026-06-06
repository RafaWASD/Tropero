# Review - Feature 12 (Import masivo de rodeo), Fase 1 UTILS PUROS (T1.1-T1.12)

Reviewer: reviewer (agente). Fecha: 2026-06-06.
Alcance: SOLO los utils puros de parseo/validacion en app/src/utils/import/ (T1.1-T1.12), EXCEPTO .xlsx (deferido a otro run, sin deps en este). Backend (Fase 2) y service (Fase 3) NO entran.
Bitacora del implementer: progress/impl_12-utils.md.

## Veredicto: APPROVED

72/72 tests node:test verdes; node scripts/check.mjs verde end-to-end (typecheck + 72 utils + suites backend 0073/0074); sin dependencias nuevas; cada R de Fase 1 cubierto por codigo + test por la razon correcta.

---

## Verificacion independiente (no me fie de la bitacora)

- Cap DURANTE la lectura (R3.3, anti-DoW): probe con input 10x el tope (50.000 filas CSV y 50.000 records SIGSA) -> rows.length === 5000, rowsExceeded === true, ~8 ms. El break/return temprano corta el scan y NO materializa el excedente. El punto clave anti-DoW esta bien.
- Reuso real del parser REAL (R4.5): normalize-row.ts linea 15 importa normalizeTag + isValidTag de ../../services/ble/parser-rs420. Usa el parser REAL, NO reimplementa la validacion de TAG.
- Topes de largo espejan 0070 (R3.4): FIELD_CAPS vs los CHECK reales de 0070_check_text_length_caps.sql -> espejo exacto: idv/visual/breed/coat/tag <=64, entry_origin <=120, notes <=4000.
- Parse posicional SIGSA (R6.2): test 032010000000004-H-H-01/2024 + lectura de parseRecord -> H en pos 2 = sexRaw (Hembra), H en pos 3 = breedCode (Hereford). Lee por ORDEN (parts[1]/parts[2]), nunca por contenido.
- 32 razas SENASA (R6.2): cotejo contra razas-senasa-codigos.md (Tabla 1) -> 32 codigos, grafias literales (AA->Aberdeen Angus, H->Hereford, OR->Otra Raza, S/E->Sin Especificar, HA->Holando Argentino, BO->Bosmara). Codigo desconocido se conserva tal cual (name ?? trimmed).
- Sin deps nuevas: git status de manifests + grep xlsx/sheetjs/papaparse en app/package.json -> sin cambios en package.json/lock; cero referencias a SheetJS/xlsx/papaparse. .xlsx correctamente deferido.
- Edges adversariales extra (probe ad-hoc): comilla CSV sin cerrar al EOF no throwea (texto literal acotado downstream). 13/2025 y 00/2025 -> null; 12/2025 -> 2025-12-01; anio <1900 o >2200 -> null; anio de 2 digitos -> null (conservador, no adivina siglo).

## Trazabilidad R<n> <-> test (Fase 1)

- R3.2 -> parse-csv.test.ts (> MAX_ROWS corta y senala; exactamente MAX_ROWS no excede) + parse-sigsa-txt.test.ts (> MAX_SIGSA_RECORDS corta y senala)
- R3.3 -> parse-csv.test.ts (cap de celdas; fila excedente sin newline final) + parse-sigsa-txt.test.ts (cap DURANTE el scan sin sep final) + probe 10x verificado
- R3.4 -> normalize-row.test.ts (campo > tope issue+null; exacto en el tope pasa) + validate-rows.test.ts (field_over_cap error)
- R3.5 -> parse-csv.test.ts (=cmd() se trata como TEXTO literal)
- R3.6 -> parse-sigsa-txt.test.ts (registro malformado error sin romper; RFID no-15-dig error; campos de mas error)
- R4.1 -> column-mapping.test.ts (headers conocidos mapeo; tildes/may/punt; ambiguo null; 2 headers mismo campo solo el 1ro)
- R4.2 -> column-mapping.test.ts (override respetado; reasigna limpia anterior; override a null; indice fuera de rango copia)
- R4.3 -> normalize-row.test.ts (sexo tolerante; basura/vacio null) + validate-rows.test.ts (sin sexo / no mapeable error)
- R4.4 -> normalize-row.test.ts (3 formatos ISO; invalida 13/13, 31/02, dia 32, mes 0 -> NULL sin romper)
- R4.5 -> normalize-row.test.ts (TAG valido 15 dig acepta; 14/16/no-num null)
- R5.1 -> validate-rows.test.ts (sin id error a completar; TAG/visual cuentan; TAG invalido sin otro id missing_identifier)
- R5.2 -> validate-rows.test.ts (sin sexo / no mapeable missing_sex)
- R6.1/R6.3 -> normalize-row.test.ts (breed >64 issue) + validate-rows no exige raza
- R6.2 -> breed-senasa.test.ts (AA/H/OR/S-E; fuera de tabla conserva; 32 codigos) + parse-sigsa-txt.test.ts (H por POSICION)
- R7.1 -> validate-rows.test.ts (mismo idv ambas conflicto; mismo tag conflicto; grupo de 3; idvs distintos no colisionan; errores no entran al dedup)
- R10.1 -> parse-sigsa-txt.test.ts (TXT del manual RFID/sexo/raza/fecha)

Todos los R de Fase 1 con >=1 test concreto por la razon correcta. Sin R sin cobertura.

## Tasks completas

Si. T1.1-T1.12 todas [x] y realmente hechas (6 modulos + 6 suites verificados). El .xlsx (parse-xlsx.ts) esta fuera de este run con justificacion documentada (necesita SheetJS vetada R3.8, este run no agrega deps): NO es una task de Fase 1 incompleta sino una exclusion declarada en el alcance del run y en tasks.md (nota del Run 1). T1.1-T1.12 no incluyen .xlsx. T6.1 (enganche en run-tests.mjs) es del leader y ya esta hecho (6 suites enganchadas en client unit tests); lo verifique corriendo check.mjs.

## CHECKPOINTS (aplicables a esta capa)

- [x] C1 - node scripts/check.mjs exit 0 (verde end-to-end).
- [x] C3 - Capas previstas: todo en utils/ (helpers puros, sin I/O - correcto per architecture.md). Sin deps externas nuevas. Sin logs de debug ni TODOs sueltos. No se hardcodea establishment_id (N/A a esta capa).
- [x] C4 - >=1 test por modulo con logica (6/6 con suite); fixtures reales (ejemplo literal del manual SIGSA, TAGs reales del campo); runner muestra 72 tests verdes.
- [x] C6 - Cada R<n> de Fase 1 cubierto por >=1 test concreto.
- [ ] C2/C5/C7/C8 - N/A a este run: C2/C5 son de cierre de sesion; C7 (RLS cross-tenant) y C8 (offline/PowerSync) no aplican (utils PUROS sin DB, sin red, sin establishment_id). El cross-tenant + RLS se cubre en review_12-backend.md y el service Fase 3.

## Checklist RAFAQ-especifico

- A. Multi-tenancy / RLS - N/A: utils puros, sin tablas, sin establishment_id, sin SQL.
- B. Offline-first - N/A: parseo/validacion local sin I/O; import online-por-diseno (R12.1).
- C. BLE - N/A a la capa, pero normalize-row.ts REUSA normalizeTag/isValidTag del parser BLE REAL (parser-rs420.ts) en vez de reimplementar (verificado, R4.5).
- D. UI de campo - N/A: sin UI en este run (screens son Fase 4).
- E. Edge Functions - N/A: sin Edge Functions en este run.

## Calidad de los tests (no verde-falso)

Los tests asertan de verdad (assert.deepEqual/assert.equal sobre output real, no smoke vacios). Cubren los negativos exigidos: sexo basura -> null/error; fecha invalida (13/13, 31/02, dia 32, mes 0) -> NULL; TAG invalido (14/16/no-num) -> null; campo > tope -> error de fila; dedup intra-archivo (idv, tag, grupo de 3); fila ya errada NO se doble-reporta como dup; bordes (input no-string, vacio, comilla sin cerrar, lineas en blanco, separador final, campos de mas en SIGSA).

## Cambios requeridos

Ninguno.

## Notas no bloqueantes (runs siguientes, NO afectan la aprobacion)

1. Sinonimos de column-mapping.ts TENTATIVOS (R4.1): ya con disclaimer; se afinan con planilla real / Facundo. Red de seguridad = override manual (R4.2).
2. Anio de 2 digitos en fecha -> NULL (no adivina siglo): conservador y defendible. Reevaluar en Fase 3/4 con archivo real si aparece. No bloquea.
3. normalizeSex acepta nombres de categoria (ternero/vaca/novillo...) como tolerancia a columna sucia: superset seguro. Documentado. OK.
4. El service (Fase 3) DEBE consumir rowsExceeded/recordsExceeded/cellsExceeded para rechazar-y-reportar (R3.2) en vez de truncar; el contrato esta expuesto.

## Estado

APPROVED. NO marco la feature done (regla del leader); falta Fase 3/4/5 + Gate 2 (code).
