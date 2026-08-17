# Rebrand miTropero — fase 7 punto 3: las env vars (`RAFAQ_*` → `MITROPERO_*`)

**2026-08-17** · Último resto del rebrand fuera de lo diferido (fase 6 Expo, `rafaq-beta`, `design/**`).
Baseline: `0b3e358`, árbol verde (`check.mjs` RC=0, 22 stages).

**Regla de la sesión: CERO acciones externas.** No se setea ningún secret en Supabase, no se deploya
ninguna función, no se dispara ningún workflow. Todo lo de acá tiene que funcionar **con la
configuración externa de hoy, sin tocarla**.

---

## Inventario medido (`git grep` en `0b3e358`, sin `progress/`)

### `RAFAQ_ENV` — 1 archivo de código + 2 de spec

| Archivo | Líneas |
|---|---|
| `supabase/functions/health/index.ts` | 40 (comentario), 42 (`Deno.env.get`) |
| `specs/active/16-ambientes-y-release/design.md` | 374, 381, 459 |
| `specs/active/16-ambientes-y-release/tasks.md` | 233 |

El plan lo daba por **secret ya seteado en Supabase (DEV)**. **Falso, medido después** — ver «Hallazgo»
más abajo. No está en `.env.local`.

### `RAFAQ_CONFIRM_PROD` — 5 scripts + workflow + specs + README

| Archivo | Líneas |
|---|---|
| `scripts/lib/env-target.mjs` | 10, 13, 14, 17, 21, 80, 103 (**la única lectura real**: `:103`) |
| `scripts/lib/env-target.test.mjs` | 26, 38, 39, 48, 78, 106, 113 |
| `scripts/backup-db.mjs` | 12, 57 (**lectura real**), 59 |
| `scripts/apply-migration-mgmt.mjs` | 9, 45 (mensaje) |
| `scripts/apply-all-migrations.mjs` | 51 (mensaje) |
| `scripts/powersync-deploy.sh` | 15, 56, 61 (**lectura real**), 62 |
| `.github/workflows/backup-prod.yml` | 45 (comentario), 49 (**seteo real**) |
| `powersync/README.md` | 53 |
| `specs/active/16-ambientes-y-release/{context,requirements,design,tasks}.md` | 1 / 5 / 6 / 6 |

Hay **3 lecturas reales** (env-target, backup-db, powersync-deploy.sh) y **1 seteo** (el workflow).

### `RAFAQ_KNOWN_PROD_REFS` — 1 archivo + su test

| Archivo | Líneas |
|---|---|
| `scripts/lib/env-target.mjs` | 13 (comentario), 62, 68, 69 (**lectura real**) |
| `scripts/lib/env-target.test.mjs` | 83, 84, 131, 132 |

**No aparece en ninguna spec ni en el workflow.** No está en `.env.local` (verificado: el archivo no
tiene `CONFIRM_PROD`, ni `KNOWN_PROD_REFS`, ni `SUPABASE_PROJECT_REF_PROD`).

### Fuera de alcance (NO TOCAR, por consigna)

`__RAFAQ_PS__` (prosa histórica de instrumentación ya removida) · `rafaq-beta` · `design/**` ·
`rafaq.db` · `progress/` (salvo este archivo) · migraciones con `rafaq.is_` (ya renombradas en fase 4) ·
fase 6 (Expo). Y `app/src/services/ble/*`, `progress/current.md`, `specs/active/10-*` (otra terminal).

---

## Las tres no son la misma clase de problema

| Var | Modo de falla si el rename queda a medias | Forma del arreglo |
|---|---|---|
| `RAFAQ_ENV` | El secret existe con el nombre viejo. Leer sólo el nuevo → `health` reporta `env: "unknown"`. **Visible** en el monitor. | Lectura doble aditiva (`nuevo ?? viejo`). Sin deploy: el código nuevo entra con el próximo deploy de `health`. |
| `RAFAQ_CONFIRM_PROD` | La guarda **bloquea**. Dirección segura, pero corta el backup nocturno y rompe la memoria muscular de Raf, que la tipea a mano. | Rename **atómico** scripts+workflow, **aceptando los dos nombres**, con el mensaje de error nombrando el **nuevo**. |
| `RAFAQ_KNOWN_PROD_REFS` | 🔴 **Falla ABIERTA**: si el código lee sólo el nombre nuevo y nadie lo setea, la lista queda vacía y la guarda destino-aware pierde el refuerzo **sin ningún síntoma**. | **Unión** de los dos nombres + un **guard runtime que convierte la degradación en un bloqueo ruidoso**. |

### Por qué el oráculo propuesto en la consigna no alcanza tal cual

> *"que se ponga rojo si la lista de refs conocidos como PROD queda vacía teniendo
> `SUPABASE_PROJECT_REF_PROD` seteado"*

Eso es **inalcanzable por construcción**: `knownProdRefs()` mete `SUPABASE_PROJECT_REF_PROD` en el set
él mismo, así que teniéndolo seteado el set nunca queda vacío. Un guard sobre esa condición pasaría
siempre en verde — un test que no puede fallar.

**La degradación real es otra**: que exista en el ambiente una lista de refs que el código **no está
leyendo**. Ese es el oráculo que se implementa:

> Si `process.env` trae **cualquier** variable cuyo nombre termine en `_KNOWN_PROD_REFS` y alguno de los
> refs que declara **no está** en el set resuelto por `knownProdRefs()`, se corta con un error que nombra
> la variable ignorada.

Cubre las dos direcciones del skew y no depende de la lista de nombres que el código lee (la deriva del
ambiente, no de la constante) → un rename futuro a un tercer nombre también nace en rojo.

---

## Plan (T1..T8)

- **T1** — `supabase/functions/health/index.ts`: `Deno.env.get('MITROPERO_ENV') ?? Deno.env.get('RAFAQ_ENV') ?? 'unknown'`. Sin deploy.
- **T2** — `scripts/lib/env-target.mjs`: constantes de nombres (nuevo + legacy) para las dos vars,
  `prodConfirmedVia()` / `prodConfirmed()` / `legacyConfirmNotice()`, `knownProdRefs()` por **unión**, y
  `assertKnownProdRefsCoverage()` llamado desde `resolveTarget` (fail-closed). Mensajes con el nombre nuevo.
- **T3** — consumidores JS: `backup-db.mjs` (usa el helper en vez de leer `process.env` a mano),
  `apply-migration-mgmt.mjs`, `apply-all-migrations.mjs` (mensajes + aviso de nombre viejo).
- **T4** — `scripts/powersync-deploy.sh`: acepta los dos, mensaje con el nuevo, aviso si se usó el viejo.
- **T5** — `.github/workflows/backup-prod.yml`: setea `MITROPERO_CONFIRM_PROD` (atómico con T2/T3; y como
  los scripts aceptan los dos, ningún orden de merge rompe el backup).
- **T6** — tests: `env-target.test.mjs` actualizado + los guards nuevos (unión, cobertura, contrato con
  el `.sh`); `backup-ci-consistency.test.mjs` + el guard del contrato workflow↔script para el confirm.
  **No se toca `scripts/run-tests.mjs`**: los dos archivos ya corren en el stage «scripts unit tests».
- **T7** — docs/specs: `powersync/README.md`, `specs/active/16-ambientes-y-release/*` (reconciliación
  al as-built), `docs/backlog.md` (los pasos manuales que le quedan a Raf).
- **T8** — falsificación con mutantes + verificación (`node --test`, `check.mjs`, `pnpm -C app typecheck`).

---

---

# Ejecución (2026-08-17)

**Ninguna acción externa.** No se seteó ningún secret, no se deployó nada, no se disparó el workflow de
backup. Todo lo que sigue funciona con la configuración externa tal como está hoy.

## Lo que cambió, archivo por archivo

| Archivo | Qué |
|---|---|
| `supabase/functions/health/index.ts` | `MITROPERO_ENV ?? RAFAQ_ENV ?? 'unknown'`. **Sin deploy.** |
| `scripts/lib/env-target.mjs` | Constantes de nombres (nuevo + legacy) para las dos vars · `prodConfirmedVia`/`prodConfirmed`/`legacyConfirmNotice` · `knownProdRefs` por **unión** · `KnownProdRefsCoverageError` + `knownProdRefsCoverageGap`/`assertKnownProdRefsCoverage`, llamado desde `resolveTarget` · `resolveTarget` devuelve `confirmedVia`. |
| `scripts/backup-db.mjs` | Usa `prodConfirmedVia()` (dejó de leer `process.env` a mano) + imprime el aviso de deprecación a stderr. |
| `scripts/apply-migration-mgmt.mjs` · `scripts/apply-all-migrations.mjs` | Mensajes con el nombre nuevo (desde la constante) + aviso de deprecación. |
| `scripts/powersync-deploy.sh` | Acepta los dos nombres (`if`/`elif`), aborta nombrando el nuevo, avisa si se usó el viejo. |
| `.github/workflows/backup-prod.yml` | Setea `MITROPERO_CONFIRM_PROD: '1'`. |
| `scripts/lib/env-target.test.mjs` | Tests existentes actualizados + `GUARD-ENV-0..7` y `GUARD-ENV-SH`. |
| `scripts/lib/backup-ci-consistency.test.mjs` | `GUARD-BK-5` (el nombre que setea el CI lo acepta el script) · `GUARD-BK-6` (el script decide con el módulo compartido) · `GUARD-BK-7` (L6: ningún otro workflow confirma PROD). |
| `powersync/README.md` · `specs/active/16-ambientes-y-release/*` · `docs/backlog.md` | Reconciliación al as-built + los pasos manuales de Raf. |

**`scripts/run-tests.mjs` NO se tocó.** Los dos archivos de test ya estaban registrados en el stage
«scripts unit tests», así que los guards nuevos corren sin agregar stage: siguen siendo **22**.
(El archivo figura como modificado en `git status`: es de la OTRA terminal — registró las suites del
delta `ios-ble-mfi`. No agregó ningún `run()`.)

## El punto 3, en detalle: por qué NO alcanzaba el oráculo propuesto

`knownProdRefs()` mete `SUPABASE_PROJECT_REF_PROD` en el set él mismo ⇒ «la lista queda vacía teniendo
`SUPABASE_PROJECT_REF_PROD` seteado» es **inalcanzable**: un test que no puede fallar. El oráculo
implementado es el **skew**:

> si `env` trae **cualquier** variable cuyo nombre matchee `/(?:^|_)KNOWN_PROD_REFS$/` y alguno de los
> refs que declara no quedó en el set resuelto, `resolveTarget` **corta** con `KnownProdRefsCoverageError`
> nombrando la variable ignorada.

Dos propiedades que lo hacen servir:
1. **No deriva de `ACCEPTED_KNOWN_PROD_REFS_ENVS`** (barre por FORMA del nombre). Si derivara de la misma
   constante que verifica, no podría ver el único bug que existe para ver. El mutante **M5** lo prueba.
2. **Bloquea, no avisa.** Verificado end-to-end contra un script real:
   `TROPERO_KNOWN_PROD_REFS=abc123 node scripts/apply-migration-mgmt.mjs <archivo>` → exit 2 **antes de
   cualquier fetch**, con el mensaje nombrando `TROPERO_KNOWN_PROD_REFS` y `MITROPERO_KNOWN_PROD_REFS`.

## Falsificación con mutantes (16 mutantes, ninguno pasó indebidamente)

| # | Mutación | Resultado |
|---|---|---|
| M1 | `knownProdRefs` deja de leer el nombre VIEJO | 🔴 GUARD-ENV-0 / -5 / -7 |
| M2 | …deja de leer el NUEVO | 🔴 B1(e) · `knownProdRefs` · GUARD-ENV-0 / -5 / -7 |
| M3 | unión → fallback (`nuevo ?? viejo`) | 🔴 GUARD-ENV-5 / -7 |
| M4 | `resolveTarget` deja de chequear cobertura | 🔴 GUARD-ENV-6 |
| M5 | el guard de cobertura DERIVA su patrón de la lista que verifica | 🔴 GUARD-ENV-6 |
| M6 | la confirmación deja de aceptar el nombre viejo | 🔴 GUARD-ENV-0 / -3 / -SH · (bktest verde, **correcto**: el CI usa el nuevo) |
| M7 | confirmación no estricta (cualquier truthy abre) | 🔴 GUARD-ENV-2 |
| M8 | el mensaje de la guarda nombra el nombre viejo | 🔴 GUARD-ENV-4 |
| M9 | `powersync-deploy.sh` deja de aceptar el viejo | 🔴 GUARD-ENV-SH |
| M10 | el workflow setea un nombre que el script no acepta | 🔴 GUARD-BK-5 / -7 |
| M11 | el workflow deja de setear la confirmación | 🔴 GUARD-BK-5 / -7 |
| M12 | `backup-db.mjs` vuelve a leer la env var a mano | 🔴 GUARD-BK-6 |
| M13 | otro workflow se auto-confirma destino PROD (L6) | 🔴 GUARD-BK-7 |
| M14 | `ACCEPTED_CONFIRM_PROD_ENVS = []` (vacuidad de los loops) | 🔴 7 tests + GUARD-BK-5 |
| M15 | `ACCEPTED_KNOWN_PROD_REFS_ENVS = []` | 🔴 GUARD-ENV-0 / -5 / -7 + 2 |
| M16 | el workflow vuelve al nombre VIEJO | 🟢 **verde a propósito** — los dos nombres valen; ése es el requisito, no un hueco |

**Un mutante mal escrito, corregido**: la primera versión de M5 usó `String.replace` con un `to` que
empezaba con `` $` `` → el reemplazo insertó basura y el archivo no parseaba. Rojo por SyntaxError con 0
tests corridos ≠ falsificación. Re-corrido con un replacer function: 23 pasan y cae **sólo GUARD-ENV-6**,
que es el oráculo que se quería probar.

## Autorrevisión adversarial

Qué busqué y qué salió:

- **Vacuidad de los guards.** Varios recorren `ACCEPTED_*_ENVS`: vaciar el array los volvería verdes sin
  mirar nada. Cerrado con `GUARD-ENV-0`, que compara contra los **literales hardcodeados en el test**
  (no derivados del módulo). M14/M15 lo confirman.
- **El guard derivado de lo que verifica.** El patrón de `knownProdRefsCoverageGap` se dejó independiente
  a propósito y se falsificó con M5.
- **Falsos positivos del guard nuevo** (que bloquee a alguien sin motivo). GUARD-ENV-7 cubre los tres
  casos vivos (sólo viejo / sólo nuevo / los dos), la lista vacía, la lista con separadores basura, el
  ambiente sin ninguna de las dos, y el caso «nombre ajeno pero cuyos refs YA están cubiertos por
  `SUPABASE_PROJECT_REF_PROD`» (no es degradación: esos refs se siguen tratando como PROD).
  Verificado además que `.env.local` **no** tiene ninguna de las dos vars ⇒ cero riesgo de bloquear el
  día a día. `check.mjs` ni siquiera llama a `resolveTarget`.
- **Copia en bash sin atar.** `powersync-deploy.sh` es la única copia del criterio fuera de JS: se ató
  con `GUARD-ENV-SH`, que exige que el `.sh` **condicione** sobre los nombres (una mención en un
  comentario no cuenta) y que no nombre ninguno que el módulo no acepte. Falsificado con M9.
- **R5.13 (no filtrar el token).** El error nuevo imprime nombres de variables y refs, nunca valores de
  secretos; el test de R5.13 sigue verde.
- **Orden del corte.** `assertKnownProdRefsCoverage` va **antes** de resolver refs y de la guarda de
  PROD: un `--env dev` con cobertura degradada es justamente el escenario a impedir, así que también
  corta ahí (verificado a mano contra `apply-migration-mgmt.mjs`).
- **Skew workflow↔script.** Renombrar de un solo lado corta el backup nocturno sin síntoma diurno: se
  ató con GUARD-BK-5 (deriva la respuesta de `prodConfirmed()`) y GUARD-BK-6 (ancla: el script tiene que
  usar el módulo). De paso, **L6 dejó de ser prosa**: GUARD-BK-7 barre TODOS los workflows.
- **Comentarios que mienten.** El comentario que escribí en `health/index.ts` afirmaba que el secret
  existía en Supabase. Lo medí, era falso, lo corregí (ver el hallazgo de abajo).

## 🟠 Hallazgo (no lo introdujo este trabajo): en DEV el secret de ambiente NO existe

`GET .../functions/v1/health` de DEV devuelve hoy:

```
{"ok":true,"schema_version":"unknown","env":"unknown"}
```

El plan de rebrand (y el `progress/impl_16-runC.md`) daban `RAFAQ_ENV` por **seteado**. No lo está —con
ninguno de los dos nombres— y el label de ambiente del monitor viene diciendo `unknown` desde que se
deployó. **Por qué no lo vio nadie**: la suite `health` valida el JUEGO DE CLAVES del body (R7.5), nunca
el VALOR de `env`. Es el mismo modo de falla silenciosa que este trabajo vino a cerrar en el punto 3,
sólo que en otra var.

No se tocó (setear un secret es una acción externa). Queda en `docs/backlog.md` con el oráculo sugerido
para cerrarlo cuando Raf setee `MITROPERO_ENV`: assertar en `supabase/tests/health/run.cjs` que
`env ∈ {development, production}`.

## Verificación (literal)

| Qué | Resultado |
|---|---|
| `node --test scripts/lib/env-target.test.mjs` | `ℹ tests 24 · pass 24 · fail 0` |
| `node --test scripts/lib/backup-ci-consistency.test.mjs` | `ℹ tests 8 · pass 8 · fail 0` |
| Los dos juntos, post-mutantes (tree restaurado) | `ℹ tests 32 · pass 32 · fail 0` |
| `node scripts/check.mjs` | **RC=0**, **22 stages** (`typecheck client`, `scripts unit tests`, `client unit tests`, `serve-log`, `request-headers`, `audit_query`, RLS, Edge, Animal, Maneuvers, Puesta-en-servicio, Reports, Custom, Scrotal, User_private, Import, Sync-streams, Operaciones-rodeo, SIGSA, Treatments, Audit, Health) |
| `pnpm -C app typecheck` | `tsc --noEmit` → exit 0 |
| `bash -n scripts/powersync-deploy.sh` | OK |
| `git grep RAFAQ_ENV\|RAFAQ_CONFIRM_PROD\|RAFAQ_KNOWN_PROD_REFS` | Fuera de `progress/`: sólo declaraciones de fallback, los guards que las afirman, y su documentación. |
| E2E | **NO se corrió** (no se tocó `app/`), y el workflow de backup **NO se disparó** (corre contra PROD). |

### Pruebas de comportamiento a mano (todas cortan antes de cualquier efecto externo)

```
node scripts/backup-db.mjs --env prod
  → ABORTADO: ... Exportá MITROPERO_CONFIRM_PROD=1 para confirmar.            exit 2
RAFAQ_CONFIRM_PROD=1 node scripts/backup-db.mjs --env prod
  → AVISO: confirmaste con RAFAQ_CONFIRM_PROD (nombre PRE-rebrand, sigue funcionando)...
  → Falta SUPABASE_DB_URL_PROD ... Abortando SIN crear archivo de backup.     exit 2
MITROPERO_CONFIRM_PROD=1 node scripts/backup-db.mjs --env prod
  → (sin aviso) Falta SUPABASE_DB_URL_PROD ...                                exit 2
node scripts/apply-migration-mgmt.mjs --env prod <archivo>
  → ABORTADO: Destino PROD ... requiere MITROPERO_CONFIRM_PROD=1 ...          exit 2
TROPERO_KNOWN_PROD_REFS=abc123 node scripts/apply-migration-mgmt.mjs <archivo>
  → Cobertura de la guarda destino-aware DEGRADADA: ... TROPERO_KNOWN_PROD_REFS ...  exit 2
PS_ADMIN_TOKEN=fake bash scripts/powersync-deploy.sh --env prod --validate-only
  → ABORTADO: --env prod requiere MITROPERO_CONFIRM_PROD=1 ...                exit 2
(+ con RAFAQ_CONFIRM_PROD=1 y cli.prod.yaml escondido: imprime el AVISO y corta en el chequeo
   de cli.prod.yaml, exit 1 — sin llegar al cp ni al deploy. cli.prod.yaml restaurado.)
```

## Nota de entorno (rojo ajeno, NO arreglado)

La **primera** corrida de `check.mjs` se colgó en el stage `client unit tests`: 25+ minutos sin una línea
nueva y **0 CPU acumulada** (muestreado 3 veces a 15 s). En paralelo, un `node --test` de la OTRA
terminal (PID 33244, un subconjunto de `app/src/services/ble/*`, arrancado 8 minutos antes) estaba
congelado igual, también con 0 CPU. Los 6 archivos sospechosos corridos de a uno pasan (`rc=0`), y el
stage completo corrido **solo** pasa `3275/3275`. La segunda corrida completa dio **RC=0**. Conclusión:
**contención/cuelgue de entorno entre dos corridas simultáneas de `node --test`, no una regresión**. Se
mató únicamente el proceso propio (ninguna suite de DB había arrancado ⇒ sin fixtures huérfanos); el
proceso de la otra terminal **no se tocó**.

## Lo que le queda a Raf (todo en `docs/backlog.md`)

1. `supabase secrets set MITROPERO_ENV=development --project-ref <dev>` (y `=production` en PROD si
   corresponde). **Después** sacar el `?? RAFAQ_ENV` de `health/index.ts`.
2. Usar `MITROPERO_CONFIRM_PROD=1` de acá en más (el viejo sigue andando, con aviso). Cuando ya no lo
   tipee por costumbre: sacar el nombre viejo (2 líneas; `GUARD-ENV-0` nace en rojo pidiendo confirmación).
3. `MITROPERO_KNOWN_PROD_REFS`: nada que hacer. Si algún día la renombra, el guard corta en vez de
   degradarse en silencio.
