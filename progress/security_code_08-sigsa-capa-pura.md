# Security Gate 2 (modo code) — spec 08, chunk "capa pura SIGSA" (T8/T9/T10)

**Veredicto: PASS** (superficie de seguridad limitada por construcción — capa pura sin I/O).

Mismo criterio que el Gate 2 de la capa buildable-hoy de spec 04: módulos TypeScript puros,
sin I/O / red / DB / auth / filesystem / eval. No hay migraciones, RLS ni Edge Functions en
este chunk (diferidas/gateadas, fuera de alcance). No se encontró ningún finding HIGH ni MEDIUM.

## Baseline y alcance analizado

- `baseline_commit`: `6308ff5` (registrado por el implementer en `progress/impl_08-sigsa-capa-pura.md`).
- Cambios = archivos nuevos sin trackear + append a `scripts/run-tests.mjs` (no hay commits sobre el baseline).
- Archivos analizados (los 3 fuente en alcance):
  - `app/src/services/sigsa/types.ts` (T8 — tipos, sin lógica)
  - `app/src/services/sigsa/sigsa-txt-generator.ts` (T9 — generador del TXT)
  - `app/src/services/sigsa/sigsa-validator.ts` (T10 — validación pre-export)
- Dependencia reusada (revisada, no modificada): `app/src/utils/import/breed-senasa.ts` (`isKnownBreedCode`, catálogo de 32 códigos oficiales).
- Inverso de referencia (revisado para el análisis del round-trip y del tope): `app/src/utils/import/parse-sigsa-txt.ts`.
- Tests + `scripts/run-tests.mjs`: revisados (no son superficie de ataque; el append solo agrega los 2 archivos al final, sin reordenar el resto).

## Verificación corrida (sin tocar la DB)

- Unit tests nuevos: **32/32 pass** (16 generator + 16 validator, 0 fail).
  Comando del brief, EXIT 0.
- NO se corrió `node scripts/check.mjs` ni `supabase/tests/*` (terminal NO dueña; DB remota compartida; evita colisión y flake de rate-limit). Acordado por el brief.

## Findings HIGH de Sentry

**Ninguno.** La skill `sentry-skills:security-review` no aplica ninguno de sus catálogos a este
código: no hay sinks de `eval`/`new Function`/`exec`/`child_process` (grep confirmó 0; el único
`.exec(` es `ISO_DATE_RE.exec()`, un match de regex, no ejecución de comando), no hay SQL/NoSQL,
no hay DOM/`innerHTML`/`dangerouslySetInnerHTML`, no hay `fetch`/red, no hay filesystem, no hay
deserialización de input (el único `JSON.stringify` es en mensajes de `throw`, dirección segura),
no hay prototype pollution (los objetos de salida se construyen campo por campo, sin merge/spread
de objetos del usuario). No hay secrets ni claves.

## Findings RAFAQ-SPECIFIC

**Ninguno HIGH/MEDIUM.** Los tres vectores que pidió el brief se cierran:

### 1. Validación de input — autoritativa y fail-closed (OK)

El input crudo (`PendingAnimalInfo`) viene de la query de animales pendientes del **propio
establecimiento** del usuario (su inventario en la DB), no de un atacante externo. Aun así, la
validación es autoritativa en dos capas y falla cerrado:

- **Validador** (`sigsa-validator.ts`): RFID `/^\d{15}$/` (`:30`,`:61`); raza bloqueada si
  `breedId == null` o `breedCode` vacío (`:75-78`); fecha parseada de los componentes del string
  con rango de mes 01-12 (`:117-128`). Todo dato inválido cae en `incomplete` con su(s) razón(es)
  — nunca se emite. Nunca lanza (la UI necesita la lista de faltantes, no un crash).
- **Generador** (`sigsa-txt-generator.ts`): revalida defensivamente RFID (`:83`), `sex ∈ {M,H}`
  (`:90`), `isKnownBreedCode` (`:102`) y `MONTH_YEAR_RE` (`:111`), y **LANZA** ante cualquier
  dato inválido (`:85`,`:92`,`:100`,`:105`,`:113`) en vez de emitir un TXT mal-declarado. Este es
  el comportamiento correcto para una declaración regulatoria SENASA: una mis-declaración (raza/
  sexo/fecha errónea) es el "daño" relevante de esta capa, y fail-closed lo previene.

### 2. Inyección / corrupción del formato posicional — imposible por allow-list (OK)

El formato es posicional: campos separados por `-`, registros por `;`. El único riesgo sería un
`-` o `;` dentro de un campo. Tras la validación, ningún campo puede contenerlos:

| Campo | Restricción tras validar | ¿Puede tener `-` o `;`? |
|---|---|---|
| `rfid` | `/^\d{15}$/` → solo dígitos | No |
| `sex` | literal `'M'` o `'H'` | No |
| `breedCode` | debe estar en el catálogo de 32 (`isKnownBreedCode`) | No — revisé los 32: el único no-alfanumérico es `S/E` (barra `/`, no separador) |
| `birthMonthYear` | `/^(0[1-9]\|1[0-2])\/\d{4}$/` → dígitos y `/` | No |

Es el patrón allow-list de la referencia de injection aplicado correctamente (whitelist de regex
+ catálogo cerrado). El round-trip contra `parseSigsaTxt` (test `gotcha 2`) confirma que el wire
format se reproduce exacto. No hay vector de inyección de separadores.

### 3. DoS local por materialización — no es vector de seguridad (no-finding; nota de robustez)

El generador hace `records.map(...).join(';')` sin tope, a diferencia del parser inverso que sí
tiene `MAX_SIGSA_RECORDS = 5000` (`parse-sigsa-txt.ts:53`, anti-DoW). La asimetría es **justificada
en términos de seguridad**:

- El **parser** procesa un archivo **externo** (attacker-controlled: un TXT que el usuario sube,
  donde alguien podría inyectar millones de registros) → necesita el cap.
- El **generador** procesa el **inventario propio** del usuario (acotado por la cantidad de
  animales de su establecimiento, leídos de su propia DB), corre en el cliente, y el peor caso
  degrada la memoria de su propio dispositivo. No es attacker-controlled en sentido de seguridad,
  no es DoS remoto, no cruza tenants.

→ No es finding de seguridad (HIGH/MEDIUM). A lo sumo robustez/UX (ver Anexo LOW).

### 4. Fugas (PII / secrets) — no aplican (OK)

No hay secrets ni claves. Los mensajes de `throw` incluyen `JSON.stringify(rec.rfid)` y
`rec.breedCode` (`generator:86,93,106,114`): el RFID es un identificador de dispositivo (no PII
sensible de persona), y el `throw` NO viaja al cliente por red (módulo puro, sin capa de
respuesta). El patrón B1 del catálogo (`err.message` crudo devuelto al cliente) **no aplica** acá
porque no hay capa de red/Edge en este chunk. Es trazabilidad de debug correcta.

## False positives descartados (trazabilidad)

- **`.exec(` en `sigsa-validator.ts:121`** → es `ISO_DATE_RE.exec(trimmed)` (match de regex sobre
  una fecha ISO), NO `child_process.exec` ni ejecución de comando. Descartado.
- **`JSON.stringify(...)` en mensajes de `throw`** → serialización para un mensaje de error de
  debug, dirección segura (no es `JSON.parse` de input del usuario). Descartado.
- **Non-null assertion `birthMonthYear as string` (`validator:92`)** → seguro por la guarda
  `reasons.length > 0` que hace `continue` antes (`:80-83`): si `monthYearFromIso` devolvió null,
  ya hay una razón y el animal no llega a la rama de exportable. No es vuln. Descartado.
- **`sexToSigsa` default 'H' ante valor inesperado (`validator:108-109`)** → no es bloqueante por
  R8.2 (schema spec 02 garantiza `sex` NOT NULL). No introduce mis-declaración explotable: un
  animal solo llega a `exportable` tras pasar RFID+fecha+raza, y `sex` viene de un enum de la DB
  propia. Documentado por el implementer; aceptable. No es finding de seguridad.

## Tabla de inputs (campos que terminan en el TXT de declaración)

| campo | límite | validación | OK? |
|---|---|---|---|
| RFID (`rfid`) | exacto 15 dígitos numéricos `/^\d{15}$/` | server-equivalente (capa pura autoritativa): validador bloquea (`invalid_rfid`/`missing_rfid`) + generador LANZA | Sí |
| sexo (`sex`) | enum `male`/`female` → `M`/`H` | validador mapea; generador exige `'M'\|'H'` o lanza | Sí |
| raza (`breedCode`) | debe estar en el catálogo oficial de 32 (`isKnownBreedCode`) | validador bloquea si null/vacío; generador LANZA si desconocido (no inventa códigos, R6.5) | Sí |
| fecha (`birthMonthYear`) | ISO→`MM/AAAA`, mes 01-12, año 4 dígitos | validador parsea por componentes (sin Date, sin TZ shift) y bloquea malos; generador exige `MONTH_YEAR_RE` o lanza | Sí |

Nota: "server" en sentido estricto no aplica (no hay servidor en este chunk). La validación es
**autoritativa dentro de la capa pura** y NO depende de un sanitizador de form bypasseable: vive
en el módulo de export, fail-closed. La autoridad server-side real (DB constraints / Edge) llega
en las capas diferidas/gateadas de spec 08 — fuera de alcance.

## Tabla de rate limits

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| generar TXT SIGSA | n.a. | n.a. | n.a. | Función pura local, sin red/email/SMS/API externa ni operación cara. No es acción abusable a escala (no toca infraestructura compartida). El rate limiting de la subida real a SIGSA, si la hubiera, pertenece a la capa de I/O diferida — fuera de alcance. |
| validar pre-export | n.a. | n.a. | n.a. | Función pura local. Idem. |

## Cobertura indirecta de Deno / RLS / PowerSync / BLE

- **RLS / Edge / migrations**: no hay en este chunk (diferidas/gateadas). El aislamiento
  multi-tenant del export depende de la **query de pendientes** (que vive fuera de esta capa pura
  y NO está en alcance) — debe scopear por `establishment_id` activo cuando se implemente. Lo dejo
  anotado para el Gate 2 de esa capa, no es deuda de este chunk.
- **PowerSync / Deno / BLE**: no aplican a estos 3 módulos.
- La skill de Sentry no cubre Deno/RLS/PowerSync, pero ninguno está presente en el código revisado,
  así que no hay zona ciega relevante para este chunk.

## Anexo LOW (no bloqueante)

- **Sin tope de registros en el generador** (robustez, no seguridad). Por simetría con
  `MAX_SIGSA_RECORDS=5000` del parser inverso y para acotar la materialización del string en
  dispositivos modestos, se podría agregar un cap defensivo o paginar el export cuando el N de
  animales sea muy grande. No es explotable (input es el inventario propio del usuario, corre en
  su cliente). Sugerencia para la capa de UI/I/O de export, no para este chunk puro.

---

**Resumen**: capa pura, fail-closed, allow-list en cada campo que llega al TXT regulatorio,
imposible inyectar separadores, sin sinks peligrosos, sin secrets, sin fuga explotable, sin
acciones abusables a escala. 32/32 tests verdes. **PASS.**
