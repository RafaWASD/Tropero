# Review — Spec 08 SIGSA, chunk "capa pura" (T8/T9/T10)

**Reviewer**: reviewer (terminal NO dueña, colisión-safe)
**Fecha**: 2026-06-13
**Veredicto**: APPROVED

## Alcance revisado (solo este chunk)
- `app/src/services/sigsa/types.ts` (T8)
- `app/src/services/sigsa/sigsa-txt-generator.ts` (T9)
- `app/src/services/sigsa/sigsa-validator.ts` (T10)
- `app/src/services/sigsa/sigsa-txt-generator.test.ts`
- `app/src/services/sigsa/sigsa-validator.test.ts`
- append de los 2 tests en `scripts/run-tests.mjs` (líneas 53)

NO revisado (diferido/gateado, fuera de este chunk): migraciones 0089-0094, PowerSync schema/sync-streams, pantallas, hook, servicio I/O (T1-T7, T11-T20).

## Verificación ejecutada
- Tests del chunk: **32/32 pass, 0 fail** (`sigsa-txt-generator.test.ts` + `sigsa-validator.test.ts`).
- Typecheck `tsc --noEmit` en `app/`: **limpio** (sin errores).
- NO se corrió `check.mjs` ni suites backend (terminal no dueña, evita colisión con DB remota compartida).

## Trazabilidad R ↔ test (de los R en alcance: R5, R6, R8)
| R | Test que lo verifica |
|---|---|
| R5.1 (formato registro 4 campos) | generator `R5.1/R6.1 T9-a` + `R5.5 — EXACTAMENTE 4 campos` |
| R5.2 (mapeo sex/breed/fecha) | validator `R5.2 — male→M, female→H` + `R8.1 T10-g` (normalizado) |
| R5.5 (solo 4 datos, sin RENSPA/especie) | generator `R5.5 — EXACTAMENTE 4 campos` |
| R5.6 (UTF-8 sin BOM) | generator `R5.6 T9-g — sin U+FEFF` |
| R6.1 (`{RFID}-{SEXO}-{RAZA}-{MM/AAAA}`) | generator `R5.1/R6.1 T9-a` |
| R6.2 (separador `;` sin espacios) | generator `R6.2 T9-b` |
| R6.3 (gate duro `;` final, default false) | generator `R6.2 T9-b` (sin trailing) + `R6.3 T9-c` (con trailing) |
| R6.4 (MM 2 dígitos) | generator `R6.4 T9-d` + validator `R6.4 — mes 2 dígitos` / `no corre por timezone` |
| R6.5 (códigos del catálogo, no inventar) | generator `R6.5 T9-f` (vacío) + `código NO en catálogo` + `acepta TODOS incl. S/E` |
| R8.1 (separar exportables/incompletos) | validator `R8.1 T10-g` + `R8.1 — lote mixto` |
| R8.2 (condiciones de bloqueo) | validator `R8.2 T10-a` (rfid null) / `T10-e` (birth null) / `T10-f` (breed null) |
| R8.3 (colecciona TODAS las razones) | validator `R8.3 — TODAS las razones` + `R8.3 — invalid_rfid Y missing_breed` |
| R8.6 (RFID 15 dígitos numéricos) | generator `R8.6 T9-e` + validator `R8.6 T10-b/c/d` |

Round-trip (gotcha 2): test `gotcha 2 — round-trip contra parse-sigsa-txt` prueba el inverso contra el **ejemplo literal del manual** (`032010000000000-M-H-08/2025;...`). PASS.

## Checklist de foco (cuestionado, no pasamanos)
1. **Round-trip**: SÍ. `generateSigsaTxt` reproduce EXACTO el string que `parseSigsaTxt` lee, probado contra el ejemplo literal del manual (`trailingSemicolon: false`). Correcto.
2. **RFID genérico**: SÍ. Usa `/^\d{15}$/` (generator L35, validator L30) — el MISMO `RFID_RE` que `parse-sigsa-txt.ts` L55. NO usa `isValidTag` del RS420. Acepta prefijo 032. Tests con prefijo 032 en todos lados.
3. **Razas (R6.5)**: SÍ. Reusa `isKnownBreedCode` de `breed-senasa.ts` (generator L29/L102), no re-siembra ni inventa. Fail-closed: lanza ante código vacío (L98-100) y desconocido (L102-108). `breed-senasa.ts` tiene las 32 grafías literales incl. `OR` y `S/E`.
4. **Colección de razones (R8.3)**: SÍ. El validador acumula en `reasons[]` (L55) y solo separa al final (L80); junta todas. Test `R8.3` confirma 3 razones para un animal vacío.
5. **Mapeos**: SÍ. sex male→M/female→H (L108-109). birthDate ISO→MM/AAAA tomando los componentes del string vía `ISO_DATE_RE` SIN construir `Date` (L117-128) → sin corrimiento por timezone (test `R6.4 — ISO completo con hora`). Mes 2 dígitos garantizado por el regex + rango 01-12.
6. **Gate duro (R6.3)**: SÍ. `trailingSemicolon?: boolean` default false (generator L61), aislado en `SigsaTxtOptions`. UTF-8 sin BOM por construcción (string JS plano), documentado y testeado (L109-115).
7. **Pureza**: SÍ. Cero imports de PowerSync/Supabase/expo/react-native en los 3 módulos. Único import no-stdlib: `isKnownBreedCode` de `breed-senasa.ts`, que es puro (sin imports, objeto congelado). Grep confirmó: "expo" solo aparece en comentarios.
8. **Contrato**: SÍ. `AnimalExportRecord`/`SigsaTxtOptions` coinciden 1:1 con el design (design.md L382-399). `PendingAnimalInfo` modela exactamente lo que devuelve la query del flujo de datos (design.md L508-523: `ap.id, a.tag_electronic, a.sex, a.birth_date, bc.senasa_code, ap.breed_id`). El validador recibe crudo y emite limpio. Coherente.
9. **Edge cases**: TODOS cubiertos. Lista vacía (generator + validator), input no-array (generator lanza TypeError / validator devuelve vacío), fila null (validator `continue`), RFID 14/16/con-letras, breed_id presente pero senasa_code null (`missing_breed`), fecha basura/mes inválido/mes 13 (`missing_birth_date` fail-closed).

## Exactitud de specs (código → spec, paso 6)
- `design.md` describe el as-built: el generador tipado (L380-399), el flujo de query→validador→generador (L501-537), gate duro `trailingSemicolon` default false. NO quedó mintiendo.
- `requirements.md` R5/R6/R8 no contradicen el código. R8.2 lista 3 condiciones de bloqueo (rfid, birth_date, breed_id) — el validador implementa exactamente esas, más `invalid_rfid` como sub-caso de R8.6 (presente pero mal formado), que es refinamiento coherente, no contradicción.
- No hay reconciliación pendiente en este chunk.

## Tasks completas
- T8 (types): hecha. 4 tipos + `ExportValidationReason` y `PendingAnimalInfo` extra (soporte del bloque C/D). Coherente con design.
- T9 (generator): hecha. Criterios a-g del task todos cubiertos por tests.
- T10 (validator): hecha. Criterios a-g del task todos cubiertos por tests.
- Las tasks del archivo `tasks.md` figuran `[ ]` (T1-T20) pero eso es **justificado**: este es un chunk parcial de un spec mayor cuyo resto está DIFERIDO y gateado (Gate duro de formato + reconvergencia de terminales). El flip de estado de tasks lo hace la terminal dueña al reconverger. Fuera del alcance de esta review marcar tasks.

## CHECKPOINTS / Checklist RAFAQ-específico
- Secciones A (RLS), B (offline), C (BLE), E (Edge Functions): **N/A** para este chunk (capa pura, sin DB/I/O/BLE/Edge). Las RLS/PowerSync de spec 08 viven en T1-T7, diferidas.
- Sección D (UI de campo): **N/A** (no hay UI en este chunk).

## Nits (no bloqueantes)
- `sigsa-validator.ts` L108-109: `sexToSigsa` mapea cualquier `sex` que no sea `'male'` (incluido `null` o basura) a `'H'` (hembra) en lugar de bloquear. Está documentado como decisión deliberada (schema spec 02 garantiza `sex` NOT NULL; R8.2 no lista sex como condición de bloqueo) y no puede producir TXT inválido (el generador igual revalida `M`/`H`). Aceptable. Si en algún punto `sex` dejara de ser NOT NULL upstream, convendría agregar `'missing_sex'` a las razones. No bloquea.
- `breed-senasa.ts` header dice "spec 12" — es el origen del archivo (importador); se reusa correctamente en spec 08 vía `isKnownBreedCode`. Solo comentario, no afecta.

## Veredicto final
**APPROVED**. 32/32 tests verdes, typecheck limpio, pureza confirmada, round-trip contra el ejemplo literal del manual OK, RFID genérico (no isValidTag 982), razas reusando el catálogo sin inventar, R8.3 colecciona todas las razones, mapeos sin timezone-shift, gate duro aislado con default false. Todos los R en alcance (R5/R6/R8) tienen test. Specs coherentes con el as-built.
