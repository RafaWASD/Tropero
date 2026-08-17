# Rebrand fase 3 — PowerSync: `sync-streams/rafaq.yaml` → `sync-streams/mitropero.yaml`

**2026-08-16** · Base: HEAD `c055e6e` (fase 2 commiteada). Alcance: renombrar el archivo fuente de las
sync streams y **todas** sus referencias. Sin deploy (ver §5).

---

## 1. Baseline de atribución (medido ANTES de tocar nada, contra `c055e6e`)

`node scripts/check.mjs` **no llega al backend**: `scripts/run-tests.mjs` usa `execSync` sin `try` y el
stage de unit del cliente está rojo por el fallo conocido del guard de marca (spec 23,
`'X-Rafaq-Request-Id'`), así que las 17 suites backend nunca corren. Por eso las tres suites afectadas se
corrieron a mano, secuencialmente (una sola terminal, para no provocar el flake de rate-limit de auth).

| Suite | Comando | Resultado en HEAD |
|---|---|---|
| sync_streams | `node --test supabase/tests/sync_streams/run.cjs` | `tests 25 · pass 25 · fail 0` · exit 0 |
| audit | `node --test supabase/tests/audit/run.cjs` | `tests 15 · pass 15 · fail 0` · exit 0 |
| reports | `node --test supabase/tests/reports/run.cjs` | `tests 36 · pass 36 · fail 0` · exit 0 |

Ninguna estaba roja en HEAD. No hubo que descartar flakes.

`node scripts/check.mjs` **corrido en HEAD antes de tocar nada** (no leído del plan): `pass 3115 / fail
1`, exit 1. El único rojo es `✖ A — ninguna pantalla de app/app + app/src muestra el nombre VIEJO de la
marca` (`app/src/utils/brand-name-guard.test.ts:472`), con las tres líneas de siempre:
`account.ts:127` · `members.ts:152` · `push-notifications.ts:88`, todas
`headers: { 'X-Rafaq-Request-Id': … }`. Lo cierra la fase 5.

---

## 2. Inventario (`git grep -n "rafaq\.yaml"` en HEAD)

**322 ocurrencias en total**: **154 en 57 archivos tracked fuera de `progress/`** (las de esta fase) y
**168 en 63 archivos de `progress/`**, que se dejan como historial (decisión ya tomada en
`docs/rebrand-mitropero-plan.md` §3: los logs de sesión son historia fiel, igual que los mensajes de
commit).

### 2.1 Lo que ROMPE si no se actualiza — código real que abre el archivo por path

| Archivo:línea | Qué hace |
|---|---|
| `supabase/tests/sync_streams/run.cjs:414` | `readFileSync(path.join(REPO_ROOT,'sync-streams','rafaq.yaml'))` |
| `supabase/tests/sync_streams/run.cjs:557` | idem |
| `supabase/tests/audit/run.cjs:305` | idem (TA.11 — guard de ausencia de `audit.*` en las streams) |
| `supabase/tests/reports/run.cjs:2344` | idem (TR.19 — guard de ausencia de las 3 tablas de campañas) |
| `scripts/powersync-deploy.sh:76` | `cp sync-streams/rafaq.yaml powersync/sync-config.yaml` |

Los cuatro `readFileSync` son **guards de ausencia**: leen el YAML y assertan que tal tabla NO aparece.
Si el path no existe, `readFileSync` tira `ENOENT` y el test falla ruidoso — no falla silencioso en
verde. Verificado leyendo el cuerpo de los cuatro (no hay `try/catch` ni `existsSync` que los deje
pasar). Aun así, no me quedé con la lectura: se falsificó corriéndolo (§4-bis).

### 2.2 El YAML mismo

Una sola mención al nombre viejo adentro: el comentario de la línea 1. Los nombres de streams
(`catalog_species`, `self_user_private`, `est_establishments`, …, 33 en total) **no llevan marca** —
re-verificado con `grep -nE "^\s{2}[a-z_]+:"`. No hay re-sync de devices.

### 2.3 Comentarios / prosa (el resto)

`.gitignore:14` · `app/src/services/powersync/local-reads.ts:227` ·
`app/src/services/powersync/schema.ts:4,12,130,165` · `docs/backlog.md:734,1281` ·
`docs/perf-escalabilidad-2026-06-13.md:11,47` · `feature_list.json:140,252,299,351` ·
`powersync/README.md:13,15,25,52` · `scripts/powersync-deploy.sh:4,6` ·
`supabase/migrations/{0097:7, 0124:10,11,14, 0127:17,63,67, 0128:10}` ·
`supabase/tests/{custom:238,251,261,474 · scrotal:255 · audit:20 · reports:54 · sync_streams:7,241}` ·
37 archivos de `specs/active/**` (02, 03, 07, 08, 10, 15, 16, 18, 20, 21, 22).

---

## 3. Cambios aplicados

### 3.1 El rename

`git mv sync-streams/rafaq.yaml sync-streams/mitropero.yaml`.

Git lo detecta como rename, no como delete+add: `git status --short` da
`RM sync-streams/rafaq.yaml -> sync-streams/mitropero.yaml` y `git diff HEAD --stat` lo muestra como
`sync-streams/{rafaq.yaml => mitropero.yaml} | 2 +-` con **similarity index 99%**. Con eso
`git log --follow` va a seguir el archivo *una vez commiteado* — hoy todavía no devuelve nada, porque el
nombre nuevo no existe en ningún commit. (Escribí lo contrario en el primer borrado de este archivo y lo
corrijo acá: lo verifiqué y no era cierto todavía.)

El `git mv` deja el rename **staged** en el índice. No se commiteó nada.

Línea 1 del YAML:

```
- # sync-streams/rafaq.yaml — Sync Streams de RAFAQ (spec 15). PASO 1 (JOIN-FREE) — 2026-06-09.
+ # sync-streams/mitropero.yaml — Sync Streams de miTropero (spec 15). PASO 1 (JOIN-FREE) — 2026-06-09.
```

Nada más adentro del archivo. `git diff -w` sobre él = ese único cambio.

### 3.2 Reemplazo textual `rafaq.yaml` → `mitropero.yaml`

**145 ocurrencias en 55 archivos** (uno de ellos es el YAML renombrado), por script Node
(`fs.readFileSync(f,'utf8')` → `replaceAll` → `writeFileSync(f,'utf8')`), que preserva los finales de
línea existentes. Sin churn de CRLF, verificado con la comparación que pide
[[reference_crlf_churn_windows]]:

```
git diff HEAD --shortstat     → 59 files changed, 260 insertions(+), 145 deletions(-)
git diff HEAD -w --shortstat  → 59 files changed, 260 insertions(+), 145 deletions(-)
diff <(git diff HEAD --numstat) <(git diff HEAD -w --numstat)  → idénticos
```

(Los 59 son mis 57 más `progress/current.md` y `progress/qa_maniobras-device.md`, que ya estaban
modificados en el árbol al empezar y **no** los toqué.)

⚠️ **`specs/active/10-operaciones-rodeo/` estaba siendo editado por otra terminal** (al arrancar tenía
`requirements.md` modificado sin commitear, y `design.md` apareció modificado entre el snapshot inicial y
mi primer `git status`). Esos tres archivos también caen en el rename, así que **ahí mi diff va mezclado
con el ajeno**: de los 8 renglones cambiados, 5 son míos (`rafaq.yaml`) y 3 son de la otra terminal (un
`RAFAQ`→`miTropero` en la línea de castración de `design.md` y un párrafo de reconciliación en
`requirements.md`). **Verificado que mi script no le pisó nada**: sus dos ediciones siguen presentes en
`git diff HEAD` después de mi corrida. Quien commitee tiene que decidir cómo separarlos.

Como el resto del árbol: se corrió `git diff HEAD -U0` excluyendo los 4 archivos editados a mano y
`specs/active/10-*`, y se filtraron los renglones que contienen `rafaq.yaml`/`mitropero.yaml` →
**quedó vacío**. O sea que fuera de esos archivos no hay ni un renglón cambiado que no sea el rename.

### 3.3 Los dos archivos que NO se podían resolver con un swap de string

**`docs/rebrand-mitropero-plan.md`** — es el documento *sobre* el rename; la fase 1 lo excluyó entero
por eso mismo. Acá se aplicó el mismo criterio con una excepción:

- **Se actualizó** la fila del bloque "Estado de ejecución" (fase 3 → ✅ HECHA). Es el estado vivo del
  documento, no una descripción del pasado.
- **Se corrigió** de paso la fila de la fase 2, que seguía diciendo `⏳ pendiente` siendo que está
  commiteada en `c055e6e`. Descuido de la fase 2, no de esta.
- **NO se tocaron** §4.A:129, §4.E:176-177, ni las líneas 48 / 212 / 235 / 256 (§5, §6, §8): describen
  el estado *anterior* al rename y el plan tal como se escribió. Reescribirlas haría que el documento
  mienta sobre por qué existía la fase 3.

**`docs/marketing/plan-toma-de-marca-mitropero.md:425`** — decía, en la lista de *"lo que NO se toca en
ninguna fase, porque parece marca y son contratos internos"*: `el nombre del archivo
sync-streams/rafaq.yaml`. Un swap de string ahí produciría la frase absurda *"no se toca el nombre del
archivo `sync-streams/mitropero.yaml`"*. **La afirmación era falsa de origen**: el nombre del archivo
nunca fue un contrato — `scripts/powersync-deploy.sh` lo copia a `powersync/sync-config.yaml` y **eso**
es lo que ve la instancia. Se sacó el ítem de la lista y se anotó que la fase 3 lo renombró.

---

## 4. Autorrevisión adversarial

Qué busqué, y qué encontré:

1. **¿Quedó algún consumidor del path viejo?** `git grep -n "rafaq\.yaml"` → cero fuera de `progress/`.
   Además `git grep -n "sync-streams/"` para cazar referencias que nombren el directorio con otro
   filename, y `git grep -in "rafaq\.ya\?ml"` para variantes de caso (`RAFAQ.yaml`, `.yml`) → nada.
2. **¿Los guards de ausencia pueden pasar en verde con el archivo faltante?** Es el modo de falla que
   importa: un guard que "no encuentra la tabla en el YAML" porque no leyó ningún YAML. Falsificado a
   mano: con el archivo renombrado y los `readFileSync` todavía apuntando al nombre viejo, las tres
   suites fallan ruidosamente con `ENOENT`. Ver §4-bis.
3. **¿Hay algún glob / listado de directorio que tome el YAML sin nombrarlo?** `sync-streams/` tiene un
   solo archivo; nadie lo lee por `readdir`. `scripts/apply-all-migrations.mjs` hace `readdir` pero
   sobre `supabase/migrations`, no sobre `sync-streams`.
4. **¿`.gitignore` ignora el nombre nuevo?** No: la entrada real es `powersync/sync-config.yaml`; la
   línea 14 es sólo el comentario que la explica. `git status` ve `sync-streams/mitropero.yaml`.
5. **¿Algún test assertea sobre el texto de los `comment on` de las migraciones?** `git grep
   obj_description -- supabase/ scripts/` → cero. Editar el comentario de `0127` es inerte para los
   tests. Deja una divergencia cosmética documentada en §6.
6. **¿Colisión con la fase 2?** Ninguno de los 57 archivos contiene globals `__rafaq*`/`__mitropero*`
   que la fase 2 hubiera tocado en el mismo renglón.
7. **`feature_list.json` sigue siendo JSON válido** después del reemplazo (los 4 hits están dentro de
   strings `notes`): `node -e "JSON.parse(...)"` → ok.
8. **Frontera de sync intacta**: `git diff HEAD -- sync-streams/` = `similarity index 99%` + el
   comentario de la línea 1 y nada más. Cero cambios de predicado, de `SELECT`, de scope o de nombre de
   stream. Esta fase no toca la frontera de autorización, así que no reabre Gate 1.
9. **Las otras dos suites que toqué (`custom`, `scrotal`) no se corrieron, y el motivo no es "son
   comentarios" a ojo**: se leyó el diff completo de las dos. `custom/run.cjs` son 4 líneas `//` de
   prosa explicativa; `scrotal/run.cjs` es 1 línea `//`. Ninguna toca un `readFileSync`, un literal
   ejecutable ni un nombre de test. Correr la suite `custom` habría metido ruido del flake catalogado
   de orphans de `field_definitions` sin comprar información. Es un argumento estático, y lo declaro
   como tal.
10. **El guard de marca nunca miró estos comentarios, ni antes ni ahora — y pasa por la razón
    equivocada.** `rafaq.yaml` vivía en `app/src/services/powersync/{schema,local-reads}.ts`, que la
    regla A sí escanea, y aun así el árbol daba 3115/1. El motivo está en
    `brand-name-guard.test.ts:391`: el carve-out de DOMINIO es `/^\.[a-z]/` (punto + minúscula), así
    que `rafaq.yaml` matcheaba por el `.y` — igual que `mitropero.yaml` matchea ahora bajo la regla B.
    Es exactamente el accidente que el plan ya anotó para las GUCs de la fase 4. No lo arreglo acá (no
    es de esta fase y el neto es cero), pero queda dicho: **el verde de estas líneas no significa que
    el guard las esté cuidando**.

### 4-bis. Falsificación de los guards (que el cambio de path sea *necesario*)

No alcanza con que las suites den verde después: hay que ver que dan **rojo** si el rename se hace a
medias. Entre el `git mv` y el swap de strings se corrieron las tres suites con los `readFileSync`
todavía apuntando al nombre viejo:

| Suite | Con el path viejo y el archivo ya renombrado | Falla |
|---|---|---|
| sync_streams | `tests 25 · pass 22 · fail 3` · exit 1 | `animals (T9.7)` y `c2 (T9.7)` (+ la suite padre) |
| audit | `tests 15 · pass 13 · fail 2` · exit 1 | `TA.11` (+ la suite padre) |
| reports | `tests 36 · pass 34 · fail 2` · exit 1 | `TR.19` (+ la suite padre) |

Las cuatro fallan con `Error: ENOENT: no such file or directory, open
'C:\DEV\RAFAQ\app-ganado\sync-streams\rafaq.yaml'`.

Confirmado: los cuatro `readFileSync` son consumidores reales, no decorativos, y **el guard falla
ruidoso, no en verde**, si el YAML no está donde dice. Que es el modo de falla que importaba descartar
en un guard de AUSENCIA (`assert.ok(!yaml.includes(tbl))` con `yaml = ''` habría pasado en verde
mintiendo).

---

## 5. Por qué NO se deploya PowerSync

`docs/rebrand-mitropero-plan.md` §4.E pide *"re-deploy de PowerSync"* al renombrar el YAML. No aplica:

- `scripts/powersync-deploy.sh:76` copia la fuente a `powersync/sync-config.yaml` (gitignoreado) y
  deploya **ese** artefacto. El nombre del archivo fuente es **local al repo**; la instancia no lo ve.
- El único cambio de contenido de esta fase es el comentario de la línea 1.

Gastar una autorización de deploy en un comentario no tiene sentido. El comentario nuevo viaja gratis
con el próximo cambio real de sync rules. (Mismo razonamiento que ya había dejado
`progress/rebrand-fases-4-5-preparacion.md` §Fase 3.)

`powersync/sync-config.yaml` (el artefacto local, gitignoreado, del 16/07) sigue teniendo la cabecera
vieja. Es correcto: lo pisa el próximo `bash scripts/powersync-deploy.sh`.

Tampoco se corrió la suite E2E: esta fase no toca nada que el E2E ejerza (comentarios y un path de
archivo que sólo abren tres suites de Node). Ningún archivo de `app/e2e/` cambió.

---

## 6. Lo que queda afuera, y por qué

| Qué | Por qué |
|---|---|
| `progress/**` (168 ocurrencias, 63 archivos) | Historial de sesiones. Decisión ya tomada (plan §3). |
| `docs/rebrand-mitropero-plan.md` líneas 48, 129, 176, 177, 212, 235, 256 (§4.A, §4.E, §5, §6, §8) | 7 ocurrencias: describen el estado ANTES del rename y el plan tal como se escribió. La 8va está en la fila de estado que escribí yo (`rafaq.yaml → mitropero.yaml`), que nombra el rename. |
| `docs/marketing/plan-toma-de-marca-mitropero.md:427` | 1 ocurrencia, en la nota de corrección que escribí: **tiene que** nombrar el archivo viejo para decir qué se corrigió. |
| El comentario **deployado** de `0127` en la DB dev | La migración ya está aplicada; editar el `.sql` no re-ejecuta el `comment on`. El comentario en la DB sigue diciendo `rafaq.yaml` hasta que alguien reconstruya la base desde cero. Es cosmético y no lo lee ningún test. |
| GUCs `rafaq.is_*`, headers `X-Rafaq-*`, `rafaq-app`/`rafaqsorg`/`scheme: 'rafq'`, `RAFAQ_*`, `rafaq.db`, `@rafaq-test.local` | Fases 4, 5 y 6. |
| `docs/marketing/plan-toma-de-marca-mitropero.md:425` dice `las GUCs mitropero.*` | **Es falso hoy**: las GUCs siguen siendo `rafaq.is_transfer` / `rafaq.is_auto_transition`. Lo dejó así el `sed` de la fase 1 (su protección por forma era `rafaq\.[a-z_]+`, que no matchea `rafaq.*` con asterisco). No es de esta fase — lo tiene que arreglar la **fase 4**, que es la que vuelve esa frase verdadera. Anotado acá para que no se pierda. |

---

## 7. Verificación (después del cambio)

| Check | Baseline (HEAD `c055e6e`) | Después del cambio |
|---|---|---|
| `node --test supabase/tests/sync_streams/run.cjs` | `tests 25 · pass 25 · fail 0` · exit 0 | **`tests 25 · pass 25 · fail 0` · exit 0** |
| `node --test supabase/tests/audit/run.cjs` | `tests 15 · pass 15 · fail 0` · exit 0 | **`tests 15 · pass 15 · fail 0` · exit 0** |
| `node --test supabase/tests/reports/run.cjs` | `tests 36 · pass 36 · fail 0` · exit 0 | **`tests 36 · pass 36 · fail 0` · exit 0** |
| `pnpm -C app typecheck` | — | **0 errores** (`tsc --noEmit`, exit 0) |
| `node scripts/check.mjs` | `pass 3115 / fail 1` (regla A, 3 líneas `X-Rafaq-Request-Id`) | **`pass 3115 / fail 1`** — el mismo fallo, las mismas 3 líneas, ninguno nuevo |
| `git grep -o "rafaq\.yaml"` | 322 ocurrencias (154 fuera de `progress/`) | 177 ocurrencias: **168 en `progress/`** + las **9** de los 2 docs excluidos a propósito (§6). **Cero** en código, scripts, tests, migraciones, specs y el resto de `docs/`. |
| `git diff HEAD --shortstat` vs `-w` | — | **idénticos** — sin churn de CRLF |

Cero flakes: ninguna suite necesitó re-corrida. Las tres coinciden con su baseline test por test.

**No se commiteó nada.** El `git mv` dejó el rename staged; el resto está en el árbol de trabajo.
