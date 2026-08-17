# `check.mjs` / `run-tests.mjs` — el primer rojo apaga los 21 stages siguientes

**Fecha**: 2026-08-17 · **Baseline**: `76e4eb2` · **Backlog**: entrada `[2026-08-17] 🔴 check.mjs deja de
correr el backend en cuanto un stage anterior se pone rojo`.

Unidad de tooling acotada (no es una feature del `feature_list.json`, no hay spec en `specs/active/`).
Encargo del leader, con su propia falsificación exigida.

---

## 1. El defecto, exacto

`scripts/run-tests.mjs`, línea 43-48:

```js
function run(label, cmd) {
  console.log(`\n>>> ${label}`);
  console.log(`    ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: repoRoot, env: { ...process.env, TZ } });
  console.log(`<<< ${label} OK`);
}
```

`execSync` **tira** cuando el comando devuelve ≠ 0. No hay `try`. El módulo es top-level: la excepción
sube, mata el proceso con código ≠ 0, y **ninguna de las llamadas a `run()` que vienen después se
ejecuta**.

El modo de falla no es "el check está rojo". Es **silencio con forma de señal conocida**: se ve UN
fallo que ya tiene explicación ("es el guard de marca, no es regresión"), se concluye que el resto está
sano, y el resto **no corrió**. Con el stage `client unit tests` en la posición 3 de 22, un rojo ahí
apaga las 16 suites de backend — que son las únicas que ven RLS, tenant-isolation, audit y drift de
migraciones contra el remoto.

Pasó de verdad y durante días (spec 23 metió `X-Rafaq-Request-Id`, el guard de marca lo cazó).

---

## 2. Inventario: los 22 stages declarados, en orden

| #  | Label                                            | Qué corre                                   | Necesita DB remota |
|----|--------------------------------------------------|---------------------------------------------|--------------------|
| 1  | `typecheck client`                               | `cd app && pnpm typecheck` (tsc --noEmit)   | no |
| 2  | `scripts unit tests (spec 16 Run B)`             | 4 `.test.mjs` de `scripts/lib`              | no |
| 3  | `client unit tests`                              | ~170 `.test.ts` de `app/` (lista explícita) | no |
| 4  | `serve-log no-leak guard (spec 23)`              | `supabase/functions/_shared/serve-log.test.ts` | no |
| 5  | `request-headers rename guard (rebrand fase 5)`  | `supabase/functions/_shared/request-headers.test.ts` | no |
| 6  | `audit_query pure helpers (spec 24)`             | `supabase/functions/audit_query/query.test.ts` | no |
| 7  | `RLS suite`                                      | `supabase/tests/rls/run.cjs`                | **sí** |
| 8  | `Edge Functions suite`                           | `supabase/tests/edge/run.cjs`               | **sí** |
| 9  | `Animal suite (spec 02)`                         | `supabase/tests/animal/run.cjs`             | **sí** |
| 10 | `Maneuvers suite (spec 03)`                      | `supabase/tests/maneuvers/run.cjs`          | **sí** |
| 11 | `Puesta-en-servicio suite (spec 02 Stream A)`    | `supabase/tests/puesta-en-servicio/run.cjs` | **sí** |
| 12 | `Reports suite (spec 07 Stream C)`               | `supabase/tests/reports/run.cjs`            | **sí** |
| 13 | `Custom suite (spec 03 M5)`                      | `supabase/tests/custom/run.cjs`             | **sí** |
| 14 | `Scrotal/CE suite (spec 03 M6)`                  | `supabase/tests/scrotal/run.cjs`            | **sí** |
| 15 | `User_private suite (spec 14 + delta TELÉFONO)`  | `supabase/tests/user_private/run.cjs`       | **sí** |
| 16 | `Import suite (spec 12)`                         | `supabase/tests/import/run.cjs`             | **sí** |
| 17 | `Sync streams no-bypass suite (spec 15)`         | `supabase/tests/sync_streams/run.cjs`       | **sí** |
| 18 | `Operaciones-rodeo suite (spec 10 Fase 1)`       | `supabase/tests/operaciones_rodeo/run.cjs`  | **sí** |
| 19 | `SIGSA suite (spec 08 capa DB)`                  | `supabase/tests/sigsa/run.cjs`              | **sí** |
| 20 | `Treatments suite (spec 02 delta tratamientos)`  | `supabase/tests/treatments/run.cjs`         | **sí** |
| 21 | `Audit suite (spec 18)`                          | `supabase/tests/audit/run.cjs`              | **sí** |
| 22 | `Health EF suite (spec 16 Run C)`                | `supabase/tests/health/run.cjs`             | **sí** |

6 stages locales + 16 contra la base DEV compartida.

### Consumidores de `run-tests.mjs` (el contrato que NO se puede romper)

| Consumidor | Cómo lo invoca | Qué espera |
|---|---|---|
| `scripts/check.mjs` §3 | `execSync(testCommand, { stdio:'inherit' })` desde `.harness/config.json` | **RC=0 verde / RC≠0 rojo.** Nada más: no parsea la salida |
| `.github/workflows/ci.yml` | `node scripts/check.mjs`, **sin** `SUPABASE_SERVICE_ROLE_KEY` | los 16 de DB se saltean y el job queda **VERDE** |
| `.github/workflows/ci-db.yml` (nightly) | `node scripts/run-tests.mjs` **con** keys | RC≠0 ante cualquier rojo |

Consecuencia dura para el diseño: **`skipped` por falta de keys NO puede volver roja la corrida** (rompería
`ci.yml` en cada push), pero **sí tiene que gritar** en el resumen.

---

## 3. Decisiones (y por qué)

### D1 — Los stages de TEST acumulan; el `typecheck` CORTA

`typecheck client` queda marcado `fatal: true`. El resto (21) acumula.

- **Por qué el typecheck corta**: si el árbol no compila, el veredicto del check ya es "no" — no se
  commitea igual. Las 16 suites de backend cuestan minutos, escriben fixtures en la base DEV
  **compartida** y suman un escritor concurrente (el flake de rate-limit de auth con dos terminales está
  catalogado). Gastar eso sobre un árbol a medio editar es puro costo.
- **Por qué eso NO reintroduce el defecto**: ver D2. El defecto no era *cortar*, era *callar*.
- **Escape hatch**: `--keep-going` ignora los `fatal` y barre todo. Es el caso "quiero señal de backend
  mientras arreglo un error de tipos que dejó la otra terminal".

### D2 — El resumen es TOTAL: todo stage declarado sale nombrado, incluso el que no corrió

Ésta es la decisión que cierra el agujero de verdad. Un stage que no se ejecutó se imprime
`NO CORRIÓ (abortado tras 'X')`, no desaparece de la salida. Nadie puede volver a leer "un solo rojo
conocido" y concluir "el resto está sano": el resumen dice, con nombre y apellido, cuáles no corrieron.

Con eso, abortar deja de ser peligroso y pasa a ser sólo una decisión de costo (D1).

### D3 — La lista de skips por falta de keys se DERIVA de los call sites

Hoy el `else` del gate imprime un texto a mano que ya está **desactualizado**: nombra 10 suites de las 16
(le faltan Reports, SIGSA, Treatments, Audit, Health y Puesta-en-servicio). Es la misma clase de bug que
estamos cerrando: una lista paralela que se pudre. Se reemplaza por un wrapper `db()` que registra el
SKIP con el label real de cada call site.

### D4 — Flags

- `--fail-fast`: comportamiento viejo (corta en el primer rojo, sea cual sea). Para loops cortos.
- `--keep-going`: ignora `fatal`. Corre los 22 pase lo que pase.
- Mutuamente excluyentes → error de uso, RC=2.

### D5 — `process.exitCode`, no `process.exit()`

En Windows, `stdout` a un pipe es asíncrono: `process.exit()` puede **truncar el resumen** justo cuando
más importa. Se setea `process.exitCode` y se deja terminar el loop de eventos. Queda como guard estático.

### D6 — Diff mínimo, porque hay otra terminal editando este archivo

La otra terminal edita `scripts/run-tests.mjs` (agrega tests de BLE a la lista gigante de la línea 180).
Para que los hunks separen limpio:

- **NO** se convierte el archivo a una lista declarativa de stages (habría reescrito todo).
- **NO** se re-indenta el bloque de backend (por eso el gate `if (KEY) {` pasa a un **bloque desnudo** `{`
  con el wrapper `db`: cambian 16 líneas de `run(` → `db(` y ninguna de las ~60 de comentario).
- Los 22 call sites quedan en el mismo orden y las mismas líneas.
- La lógica nueva vive en `scripts/lib/stage-runner.mjs` (módulo nuevo, sin conflicto posible).

---

## 4. Plan de tasks

- **T1** — `scripts/lib/stage-runner.mjs`: `createStageRunner({ exec, log, failFast, keepGoing })` con
  `run(label, cmd, {fatal})`, estados `pass|fail|skipped|not-run`, `summary()`, `exitCode`.
- **T2** — `scripts/lib/stage-runner.test.mjs`: comportamiento (acumula, no corta, `fatal` corta y marca
  los siguientes como `not-run`, `--keep-going` los corre, skip no ensucia el RC, RC≠0 con cualquier rojo)
  **+ guards estáticos sobre `scripts/run-tests.mjs`** (un solo `execSync`, cero `process.exit(`, usa el
  runner). Se engancha al stage 2 (lista explícita de `scripts/lib`).
- **T3** — `scripts/run-tests.mjs`: cablear el runner, marcar `fatal` el typecheck, wrapper `db()`,
  resumen + `process.exitCode` al final.
- **T4** — `scripts/check.mjs`: el `[FAIL] Tests rojos` apunta al resumen (no dice cuál stage; el resumen
  sí, y va por `stdio:'inherit'` justo arriba). Cambio de una línea, sin tocar el contrato.
- **T5** — Falsificación (§5).
- **T6** — Cerrar la entrada del backlog.

---

## 5. Falsificación — protocolo

Orden importante: la corrida "ANTES" se toma **con el script viejo**, así que va primero.

1. Romper `app/src/utils/strip-comments.test.ts` (stage 3, local, no toca la DB, no es de la otra
   terminal).
2. `node scripts/run-tests.mjs` con el script **viejo** → esperado: muere en el stage 3, **cero** stages de
   backend en la salida, RC≠0.
3. Aplicar T1-T4.
4. `node scripts/run-tests.mjs` con el test **todavía roto** → esperado: los 22 stages en la salida, el
   resumen nombra los 16 de backend, `client unit tests` FAIL, RC≠0.
5. Restaurar el test (`git checkout --`).
6. `node scripts/check.mjs` → RC=0, 22/22 PASS.

Flakes catalogados a descartar antes de concluir: rate-limit de auth de Supabase (dos terminales) y
orphans de `field_definitions` en la Custom suite. Ante sospecha, re-correr la suite sola.

---

## 6. Bitácora de ejecución

(Se completa abajo a medida que avanzan las tasks.)

---

### 2026-08-17 — Falso negativo del guard `db()` (unidad de tooling acotada)

**Archivo tocado: uno solo, `scripts/lib/stage-runner.test.mjs`.** `scripts/run-tests.mjs` se modificó
*temporalmente* para la falsificación y se restauró **byte a byte** (ver "Restauración" al final).

#### El defecto

El guard `TODO stage que pega contra la DB remota pasa por db(), nunca por run()` filtraba **línea por
línea**: exigía que la MISMA línea empezara con `run(`/`db(` **y** contuviera `supabase/tests/`. Un call
site multilínea parte eso en dos y el guard no ve nada — y la forma multilínea **ya se usa** en el archivo
para los stages 2 a 6, así que el copy-paste más probable era justo el que se le escapaba. Consecuencia
concreta: `ci.yml` corre `check.mjs` **sin** `SUPABASE_SERVICE_ROLE_KEY` en cada push; una suite de DB
colada por `run(` se ejecutaría igual, fallaría por credenciales y dejaría el badge en rojo permanente.

#### Falsificación — paso 1: el falso negativo, demostrado

Mutante pegado en `scripts/run-tests.mjs`, adentro del bloque de las 16 suites de DB:

```js
  // MUTANTE TEMPORAL (falsificación del guard) — sacar antes de commitear.
  run(
    'Nueva suite (spec NN)',
    `node --test supabase/tests/loquesea/run.cjs`,
  );
```

`node --test scripts/lib/stage-runner.test.mjs` **con el guard viejo**:

```
✔ GUARD: no se perdieron stages — siguen declarados al menos los 22 conocidos (0.0773ms)
✔ GUARD: las 16 suites de DB se saltean UNA POR UNA (nada de listas paralelas escritas a mano) (0.0656ms)
✔ GUARD: TODO stage que pega contra la DB remota pasa por `db()`, nunca por `run()` (0.1423ms)
ℹ tests 26
ℹ pass 26
ℹ fail 0
```

26/26 en verde con el agujero abierto. Eso es el falso negativo.

#### El cambio

El guard dejó de razonar por líneas. Tres helpers nuevos en el mismo archivo de test
(`endOfString` / `endOfCall` / `stageCallSites`) extraen **call sites completos**: se localiza el nombre
(`run` / `db` / `runner.run`, con lookbehind para no cazar un `.run` de otro objeto ni un `run` que sea
parte de otra palabra) y se avanza hasta el paréntesis que lo cierra contando paréntesis y **saltando
strings** — imprescindible, porque los labels tienen paréntesis adentro (`'Animal suite (spec 02)'`) y los
comandos son template literals.

Con eso, la regla se **ancló en la MENCIÓN del path, no en la forma de la llamada**: toda aparición de
`supabase/tests/…` en el código tiene que caer DENTRO de un call site de `db()`. Es más fuerte que lo
pedido y cubre tres evasiones en vez de una: `run(` de una línea, `run(` multilínea, y `runner.run(`
(que saltea el alias `run`). Una mención **suelta** (una constante, un array de suites armado aparte)
también se pone roja: si el archivo cambia de forma, que el guard exija una decisión explícita.

El test trae además un **sanity del propio escáner** antes del veredicto (`≥16` menciones, `≥22` call
sites). Sin eso, un desbalanceo dejaría `offenders` vacío y el guard sería un verde automático — un test
que no puede fallar.

Límite conocido y documentado en el código: no se interpretan literales de regex ni templates anidados.
Hoy no hay ninguno adentro de un call site; si aparecen, el balanceo puede desincronizar y el guard se
pone **rojo** (dirección segura: pide mirada humana, no regala un verde).

#### Falsificación — paso 3: el mismo mutante, ahora rojo

```
✖ GUARD: TODO stage que pega contra la DB remota pasa por `db()`, nunca por `run()` (1.9705ms)
ℹ tests 26
ℹ pass 25
ℹ fail 1

✖ failing tests:
✖ GUARD: TODO stage que pega contra la DB remota pasa por `db()`, nunca por `run()`
  AssertionError [ERR_ASSERTION]: Estas suites de DB no están gateadas por `db()`. Sin keys se
  ejecutarían igual y romperían ci.yml. (Si lo que aparece es prosa y no una llamada, va en una línea
  de comentario propia: este guard escanea el código con los comentarios de línea enteros ya descartados.)
  + actual - expected
  + [
  +   "run('Nueva suite (spec NN)') → supabase/tests/loquesea/run.cjs"
  + ]
  - []
```

El mensaje **nombra la suite infractora** (label + path).

#### Falsificación — el resto de la matriz

Cada variante se pegó sola en `run-tests.mjs`, se corrió el test y se restauró el archivo:

| # | mutante | esperado | obtenido |
|---|---|---|---|
| 1 | `run(` **multilínea** → `supabase/tests/loquesea` | ROJO | ROJO (paso 3) |
| 2 | `run('X', …)` **una línea** (la cobertura que ya había) | ROJO | ROJO |
| A | `runner.run(` multilínea (saltea el alias `run`) | ROJO | ROJO — `runner.run('Colada por runner.run') → supabase/tests/colada/run.cjs` |
| B | mención **suelta** (`const SUITE_CMD = …` fuera de todo call site) | ROJO | ROJO — `supabase/tests/suelta/run.cjs — mencionada FUERA de todo call site de stage` |
| C | `db(` **multilínea** legítimo | VERDE | VERDE (sin falso positivo) |
| D | `run(` multilínea contra `supabase/functions/…` (los stages 4-6) | VERDE | VERDE |
| E | label con apóstrofe en comillas dobles (`"Suite d'algo"`) — rompe-escáner | VERDE | VERDE |

#### Los otros guards estáticos: revisados, sin cambios

Coincido con la lectura previa de Raf, y lo verifiqué guard por guard:

- **`fatal: true`** — es línea-por-línea, pero falla en la **dirección segura**: un `{ fatal: true }` en su
  propia línea no dice "typecheck" ⇒ rojo. Falso positivo, nunca falso negativo.
- **≥22 call sites** y **≥16 `db(`** — cuentan bien el estilo multilínea, porque el `run(`/`db(` igual
  **abre en su propia línea**. Un subconteo da rojo (dirección segura). No los migré a `stageCallSites`
  a propósito: ese extractor devuelve 23 (incluye el `runner.run(...)` del alias), y contar el alias como
  stage sería peor que la cuenta actual.
- **`execSync` único** y **`process.exit()`** — no son línea-por-línea (cuentan/indexan sobre el texto
  entero). Sin agujero de esta clase.

Observación **fuera del alcance de esta unidad** (no la toqué, queda a criterio): el guard del `execSync`
único vigila ese nombre exacto. Un `spawnSync`/`execFileSync` suelto ejecutaría un comando por fuera del
runner sin que ningún guard lo vea. Es otra clase de agujero (nombre, no forma), no el que vine a cerrar.

#### Restauración y alcance

`scripts/run-tests.mjs` **no** se pudo restaurar con `git checkout --`: el archivo ya estaba **modificado
respecto de HEAD** (la unidad del stage-runner todavía no está commiteada, +129 líneas), así que un
checkout habría borrado ese trabajo. Se restauró desde un snapshot de bytes tomado **antes** de tocarlo:

```
$ diff scripts/run-tests.mjs <snapshot pre-mutante>
run-tests.mjs: IDENTICO al snapshot pre-mutante
$ grep -c "loquesea\|MUTANTE" scripts/run-tests.mjs
0
$ sha256sum scripts/run-tests.mjs
65952327e2da97e2c7b64f2e8f3385b3076a2ced6d94cfc0f7bb563ff69d0436   (== hash pre-mutante)
```

Verde final, sin mutante:

```
$ node --test scripts/lib/stage-runner.test.mjs      → 26/26 pass, exit 0
$ node --test <los 5 unit .mjs del stage 2 completo> → 76/76 pass
```

Los 22 stages siguen declarados (el guard de ≥22 pasa). No se corrió `check.mjs` ni `run-tests.mjs`
completos: las 16 suites de backend pegan contra la DEV compartida y hay otra terminal escribiendo.
Line endings del archivo editado: LF, sin churn.

---

### 2026-08-17 — Agujero de NOMBRE del guard del `execSync`: anclado en el import

Continuación de la entrada anterior, mismo alcance: **un solo archivo tocado,
`scripts/lib/stage-runner.test.mjs`**. `run-tests.mjs` se mutó y se restauró desde snapshot de bytes.

#### El agujero

El guard `run-tests.mjs ejecuta comandos por UN SOLO punto` cuenta apariciones de `execSync(`: vigila un
**nombre**. Un `spawnSync` / `execFileSync` / `exec` suelto ejecutaría un comando por fuera del runner —
fuera del `try`, fuera del resumen total, y si tira vuelve a matar el proceso apagando los stages
siguientes en silencio— sin que ningún guard lo viera.

#### La forma elegida: anclar en la IMPORTACIÓN, no en una lista de nombres

Enumerar los nombres prohibidos sería otra **lista que se pudre** (la misma clase de bug que este archivo
viene cerrando: la lista de skips escrita a mano nombraba 10 de 16 suites). En Node, **toda** primitiva de
ejecución de comandos —`exec`, `execFile`, `execSync`, `execFileSync`, `spawn`, `spawnSync`, `fork`— sale
de `node:child_process`. Así que el guard nuevo no conoce nombres; conoce **la puerta de entrada**:

1. `child_process` se nombra **UNA sola vez** en todo el código del archivo (cierra la puerta de atrás:
   `require('node:child_process')` y `await import('node:child_process')` esquivan el import estático);
2. esa única mención es el import estático con nombre exacto `'node:child_process'`;
3. la lista de bindings importados es **exactamente** `['execSync']`.

Cualquier primitiva nueva, se llame como se llame, **obliga** a tocar esa línea — y ahí nace en rojo. El
guard viejo (`execSync(` exactamente una vez) se conserva: sigue cazando un segundo call site de la misma
primitiva, que el import no ve.

#### Falsificación — 6 mutantes, todos en rojo

Cada mutante se pegó solo en `run-tests.mjs`, se corrió `node --test scripts/lib/stage-runner.test.mjs` y
se restauró el archivo. Salida real (nombres de test y primera línea del `AssertionError`):

```
OK  esperado=RED   obtenido=RED    1. spawnSync sumado al import existente
       rojo -> GUARD: la única primitiva de ejecución que ENTRA al archivo es `execSync`
       AssertionError: El import de `node:child_process` trae algo más que `execSync`. …
OK  esperado=RED   obtenido=RED    2. import cambiado a execFileSync (y usado)
       rojo -> GUARD: run-tests.mjs ejecuta comandos por UN SOLO punto
       rojo -> GUARD: la única primitiva de ejecución que ENTRA al archivo es `execSync`
OK  esperado=RED   obtenido=RED    3. await import('node:child_process') dinámico
       rojo -> GUARD: la única primitiva de ejecución que ENTRA al archivo es `execSync`
       AssertionError: `child_process` se nombra 2 vece(s) en el código. Tiene que ser UNA sola: la del
       import estático de arriba de todo. …
OK  esperado=RED   obtenido=RED    4. require('node:child_process') (puerta de atrás CJS)
       rojo -> GUARD: la única primitiva de ejecución que ENTRA al archivo es `execSync`
       AssertionError: `child_process` se nombra 2 vece(s) en el código. …
OK  esperado=RED   obtenido=RED    5. import DEFAULT del módulo (namespace cp.execSync)
       rojo -> GUARD: la única primitiva de ejecución que ENTRA al archivo es `execSync`
       AssertionError: El único acceso permitido a child_process es
       `import { execSync } from 'node:child_process';`. …
OK  esperado=RED   obtenido=RED    6. import sin el prefijo node: ('child_process')
       rojo -> GUARD: la única primitiva de ejecución que ENTRA al archivo es `execSync`
       AssertionError: El único acceso permitido a child_process es
       `import { execSync } from 'node:child_process';`. …

restaurado: True 65952327e2da97e2c7b64f2e8f3385b3076a2ced6d94cfc0f7bb563ff69d0436
```

Los tres pedidos en el brief son los mutantes 1, 2 y 3. Los otros tres (4, 5, 6) los agregué porque son
las formas vecinas de entrar al mismo módulo, y un guard que sólo cubre las tres que alguien se acordó de
escribir es la lista-que-se-pudre otra vez, disfrazada.

Detalle del mutante 2: **caen los dos guards**, el viejo y el nuevo. El viejo cae porque el conteo de
`execSync(` pasa a 0 — correcto en el veredicto, pero su mensaje dice *"apareció un `execSync(` fuera del
runner"*, que describe el caso contrario (sobra), no el que se dio (falta). Imprecisión menor de un guard
que el brief pidió no tocar: la dejo anotada y **sin cambiar** (el rojo igual llega con el mensaje preciso
del guard nuevo, y el diff de la aserción muestra `0 !== 1`).

#### Verde final y alcance

```
$ node --test scripts/lib/stage-runner.test.mjs      → 27/27 pass, exit 0   (26 + el guard nuevo)
$ node --test <los 5 unit .mjs del stage 2 completo> → 77/77 pass
$ git diff --stat -- scripts/run-tests.mjs
 scripts/run-tests.mjs | 129 +++++++++++++++++++++++++++++-------------
 1 file changed, 96 insertions(+), 33 deletions(-)      ← el número exacto de referencia
$ sha256sum scripts/run-tests.mjs
65952327e2da97e2c7b64f2e8f3385b3076a2ced6d94cfc0f7bb563ff69d0436   (== hash pre-mutantes)
```

Los 22 stages siguen declarados (el guard de ≥22 y el de ≥16 `db(` pasan). Sin `git checkout` en ningún
momento: la restauración fue por snapshot de bytes, con `sha256` de control. No se corrió `check.mjs` ni
`run-tests.mjs` completos (DEV compartida, otra terminal escribiendo).

---

### 2026-08-17 — El guard del `execSync` diagnosticaba mal: el mensaje ahora deriva del caso

Cierre de la unidad. Mismo alcance: **un solo archivo tocado, `scripts/lib/stage-runner.test.mjs`**.

#### Qué estaba mal

`assert.equal(execSyncCalls.length, 1, msg)` tiene **dos** modos de falla opuestos, y el mensaje asumía
siempre el primero: *"Apareció un `execSync(` fuera del runner"*. Con conteo 0 —la primitiva se renombró y
el runner se quedó sin `exec`— ese texto manda a buscar exactamente lo que **no** está. Es deuda de la
misma familia que veníamos cerrando: el que lo lee a las 3 de la mañana se guía por esa línea, no por el
código del test.

#### El cambio

El mensaje se construye a partir del conteo real, con dos ramas y el número adentro:

- `found > 1` → **SOBRA**: cuántos call sites hay, cuántos están de más, y por qué duele (fuera del `try`,
  fuera del resumen, y si tiran vuelven a matar el proceso). Manda a `runner.run()`.
- `found === 0` → **FALTA**: no hay ninguno, el runner se quedó sin `exec`; recuerda que el `exec`
  inyectado TIENE que tirar con exit ≠0 (de eso vive la acumulación) y remite al guard del import.

(La rama del `else` sólo puede darse con 0: con 1 la aserción no falla y el mensaje no se usa.)

#### Falsificación — los dos textos, con el mutante que corresponde a cada uno

**Mutante SOBRA** — un segundo `execSync(` suelto, fuera del runner (el defecto original tal cual):

```
✖ GUARD: run-tests.mjs ejecuta comandos por UN SOLO punto (el `exec` inyectado en el runner)
  AssertionError [ERR_ASSERTION]: SOBRA: hay 2 call sites de `execSync(` y el runner usa UNO SOLO, así
  que 1 ejecuta(n) comandos por fuera del `exec` inyectado: quedan fuera del `try`, fuera del resumen
  total, y si tiran vuelven a matar el proceso apagando los stages siguientes SIN DECIRLO. Ese es
  EXACTAMENTE el defecto que cerramos el 2026-08-17. Pasá esos comandos por `runner.run()`.

  2 !== 1
```

**Mutante FALTA** — `execSync` renombrado a `execFileSync` (conteo 0):

```
✖ GUARD: run-tests.mjs ejecuta comandos por UN SOLO punto (el `exec` inyectado en el runner)
  AssertionError [ERR_ASSERTION]: FALTA: no hay NINGÚN `execSync(` en el archivo (0 call sites). El
  comando que el runner recibe como `exec` desapareció o cambió de nombre — y el runner sin `exec` no
  ejecuta nada. Si lo reemplazaste por otra primitiva, no la dejes suelta: el `exec` inyectado TIENE que
  tirar cuando el comando devuelve ≠0 (de eso vive la acumulación de fallos y el resumen total). Mirá
  también el guard del import de `node:child_process`, que es por donde tiene que entrar.

  0 !== 1
```

En el mutante FALTA caen **dos** guards (`fail 2`): éste y el del import, que dice por dónde tiene que
entrar la primitiva nueva. En el mutante SOBRA cae **sólo** éste (`fail 1`): el import sigue intacto,
que es justamente la distinción que los dos guards existen para hacer.

```
restaurado: True 65952327e2da97e2c7b64f2e8f3385b3076a2ced6d94cfc0f7bb563ff69d0436
```

#### Verde final y alcance (cierre de la unidad)

```
$ node --test scripts/lib/stage-runner.test.mjs      → 27/27 pass, exit 0
$ node --test <los 5 unit .mjs del stage 2 completo> → 77/77 pass
$ git diff --stat -- scripts/run-tests.mjs
 1 file changed, 96 insertions(+), 33 deletions(-)      ← el número exacto de referencia
$ sha256sum scripts/run-tests.mjs
65952327e2da97e2c7b64f2e8f3385b3076a2ced6d94cfc0f7bb563ff69d0436   (== hash pre-mutantes)
```

Los 22 stages y las 16 `db(` intactos. Único archivo modificado en las tres entradas:
`scripts/lib/stage-runner.test.mjs` (LF, sin churn). Queda para el leader: `check.mjs` completo con keys
+ commit.
