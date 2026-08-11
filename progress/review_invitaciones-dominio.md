# Review — Dominio de los links de invitación: `app.rafq.ar` → `mitropero.com.ar`

**Reviewer**: agente revisor · **Fecha**: 2026-08-11
**Baseline del diff**: `0ce6919` · **Reporte del implementer**: `progress/invitaciones-dominio.md`
**Estado del árbol al cerrar**: idéntico byte a byte al que encontré (md5 verificado tras 4 mutantes).

## Veredicto

**CHANGES_REQUESTED**

Las tres puntas están bien alineadas, la lista dura está intacta, el guard nuevo es real (lo maté yo con
mutantes propios) y toda la verificación da verde, **incluido `node scripts/check.mjs` exit 0**. Rechazo
por **una sola cosa, y es del tipo que este repo ya se comió antes**: el barrido de superficies quedó
corto. Hay una **cuarta punta DENTRO del repo** que construye el mismo link con el origen hardcodeado —
`docs/marketing/landing-proximamente/invite.html:69`, la página publicada— y el reporte afirma
explícitamente que no existe ninguna. La regla F no la mira, el comentario de `members.ts` no la nombra,
y el `design.md` que se acaba de commitear dice "CUATRO lugares" cuando son cinco.

No es un bug vivo hoy (todas dicen lo mismo). Es el guard que no cubre la superficie que el invitado
efectivamente copia.

---

## 1. Alcance real del diff (working tree vs `0ce6919`)

```
app/app/invite.tsx                            |  15 +-
app/e2e/invitations.spec.ts                   |   5 +-
app/src/services/members.ts                   |  21 ++-
app/src/utils/brand-name-guard.test.ts        | 205 ++++++++++++++++-
app/src/utils/invite.test.ts                  |  40 +++-
app/src/utils/invite.ts                       |  10 +-
supabase/functions/invite_user/index.ts       |   6 +-
supabase/functions/resend_invitation/index.ts |   4 +-
8 archivos, 281 inserciones, 25 borrados
```

`git diff --stat` == `git diff -w --stat` → **sin churn de CRLF**. Confirmado.

**Ajenos a esta unidad**: `specs/active/10-operaciones-rodeo/requirements.md` y
`docs/marketing/kit-capturas.zip` (otra terminal, presentes desde antes).

⚠️ **El árbol se movió durante la review**: a mitad de la verificación aparecieron como `M`
`docs/adr/ADR-014`, `specs/active/01-identity-multitenancy/{design,requirements,tasks}.md` y
`specs/active/19-login-social/context.md`, y minutos después se commitearon como `0e7e1ca`
("docs: el link de invitacion pasa a mitropero.com.ar en specs y ADR"). **No son del implementer** (su
reporte §7.4 declara que no tocó `docs/**` ni `specs/**`, y es cierto): son la reconciliación del leader.
Los revisé igual porque el paso "código → spec" me obliga (§7 de esta review).

---

## 2. Las tres puntas dicen el mismo origen — verificado sobre el árbol

| Punta | Archivo:línea | Valor |
|---|---|---|
| 1. cliente | `app/src/services/members.ts:58` | `https://mitropero.com.ar` |
| 2. `invite_user` | `supabase/functions/invite_user/index.ts:160` | `https://mitropero.com.ar` |
| 3. `resend_invitation` | `supabase/functions/resend_invitation/index.ts:83` | `https://mitropero.com.ar` |

Idénticas, sin barra final, y las tres concatenan `/invite?token=` (`members.ts:62`,
`invite_user:161`, `resend_invitation:84`).

**Ninguna quedó con el dominio viejo.** `git grep "app\.rafq\.ar"` fuera de `*.md`/`docs`/`specs`/
`progress` devuelve **dos** líneas, las dos legítimas:

- `app/src/utils/invite.ts:34` — dentro del docblock que explica que el parser es host-agnóstico, nombrando
  el dominio como **legacy** ("los links viejos … tienen que seguir entrando").
- `app/src/utils/brand-name-guard.test.ts:511` — el propio detector falsificándose
  (`assert.ok(DEAD_ORIGIN.test('https://app.rafq.ar'))`).

> Nota: el reporte §2 dice "devuelve **una sola línea**". Son dos. La segunda es del guard y es correcta,
> pero la afirmación literal del reporte es inexacta.

---

## 3. Lista dura — nada prohibido se tocó

Verificado sobre el diff real + grep del árbol.

| Ítem | Estado | Evidencia |
|---|---|---|
| `scheme: 'rafq'` | intacto | `app/app.config.ts:36` · **`app.config.ts` no aparece en el diff** |
| `rafq://` en el parser | intacto | `invite.ts:31,52,68` + `invite.test.ts:48` (test vivo) |
| `rafq://` en la web publicada | intacto | `docs/marketing/landing-proximamente/invite.html:71` |
| identificador de la app | `ar.rafq.app` | `app.config.ts:26` |
| `slug` / `owner` / `projectId` | `rafaq-app` / `rafaqsorg` / `d8cf3a19-…` | `app.config.ts:35,117,114` |
| `eas.json` | no está en el diff | `git diff --stat 0ce6919 -- app/eas.json eas.json` vacío |
| `noreply@rafq.ar` | intacta | `_shared/email.ts` fuera del diff |
| storage `rafq.*` · `X-Rafaq-Actor` · GUCs · `RAFAQ_*` | intactos | cero líneas `+`/`-` que los toquen |
| `specs/**` · `docs/**` · `progress/**` | el implementer no los tocó | los `M` de docs/specs son de `0e7e1ca` (leader) |

Las únicas altas del diff que contienen `rafq` son **comentarios y fixtures que preservan el scheme
explícitamente** (`invite.ts:15`, `brand-name-guard.test.ts:609-611`, `invite.tsx:6-9`). El control
sintético del guard que antes usaba el placeholder viejo ahora usa `rafq://` — buen cambio: apunta a un
identificador vivo.

---

## 4. La regla F del guard — falsificada por mí, no leída del reporte

Baseline: `brand-name-guard.test.ts` **14/14 verde**. Puse **4 mutantes propios**, uno por vez,
restaurando con `cp` + `cmp` entre cada uno.

| # | Mutante mío | Resultado |
|---|---|---|
| **M1** | **solo** `INVITE_BASE_URL` → `https://mitropero.ar` | **ROJO 12/14**. F: `app/src/services/members.ts dice "https://mitropero.ar" y las otras dicen "https://mitropero.com.ar" — INVITE_BASE_URL — el CLIENTE reconstruye…`. **Nombra la que se movió**, no las dos sanas. F(bis) también cae. |
| **M2** | **solo** `resend_invitation`, con **barra final** | **ROJO 13/14**. F: `supabase/functions/resend_invitation/index.ts dice "https://mitropero.com.ar/" y las otras dicen "https://mitropero.com.ar" — default de APP_URL — … al REGENERAR el token` |
| **M3** | **las tres + el placeholder** → `https://app.rafq.ar` (el dominio muerto) | **ROJO 13/14** por el check (1) `DEAD_ORIGIN`, listando las tres. Confirma el M4 del reporte. |
| **M4** | **las tres + el placeholder** → `https://dominio-que-nunca-compramos.com` | 🔴 **VERDE 14/14** — y **verde 3052/3052 en la suite unitaria COMPLETA** |

Restaurado: `cmp` OK en los 4 archivos, md5 idéntico, `git status` idéntico al inicial.

**Conclusión sobre lo que se pidió verificar**: la regla F **sí** compara las tres puntas entre sí y **sí**
nombra cuál quedó distinta (M1, M2). El mutante "las tres al mismo valor viejo" **está cubierto**, pero
**no por la comparación entre sí**: lo caza el literal `DEAD_ORIGIN = /rafq\.ar/i`
(`brand-name-guard.test.ts:151`), que es un valor conocido-malo, no un oráculo.

### 4.1 El agujero, medido (respuesta a la pregunta explícita)

**Es un agujero, y no lo cubre ninguna otra regla.** Con las tres puntas + el placeholder movidos
coherentemente a cualquier dominio que **no** contenga `rafq.ar`, corrí la suite unitaria entera:
**`tests 3052 · pass 3052 · fail 0`**.

El reporte (§3, punto 2) vende la ausencia de literal como estrictamente superior: *"con un literal,
cambiar las tres puntas y 'actualizar el test' pasaría verde sin haber detectado nada"*. Es un
**trade-off, no una mejora neta**, y el lado no pagado es justo la forma del bug histórico: el bug real
nunca fue drift entre puntas — fue **las tres apuntando a un dominio que nunca se compró**. La regla F
cubre esa forma sólo para el string `rafq.ar`. Cualquier próximo dominio equivocado entra en verde.

Hay un oráculo independiente disponible dentro del repo y sin escribir un literal en el test:
`docs/marketing/landing-proximamente/index.html:9` → `<link rel="canonical" href="https://mitropero.com.ar/">`,
que es **el sitio publicado declarando su propio origen** (y el commit `0ce6919` garantiza que el archivo
del repo es byte a byte lo que sirve el Worker). Comparar las puntas contra ese canonical mata M4.

---

## 5. 🔴 LA CUARTA PUNTA DEL REPO — bloqueante

`docs/marketing/landing-proximamente/invite.html:69`:

```js
var linkCompleto = 'https://mitropero.com.ar/invite?token=' + enc;
```

Eso **no** sale de `window.location.origin`: es el origen **hardcodeado por cuarta vez en el repo**. Y no
es decorativo — es el string del botón **"Copiar el link"** (líneas 47-49, 70, 88), o sea **exactamente lo
que el invitado copia y pega en la pantalla de invitación de la app** cuando el `rafq://` no abre. El
commit `0ce6919` declara que el archivo del repo es byte a byte lo que sirve el Worker, así que es
producción.

**Tres afirmaciones quedan falsificadas por esa línea:**

1. **Reporte §8 (autorrevisión)**, textual: *"otras superficies que construyan `/invite?token=` (ninguna)"*.
   **Falso.** Un `git grep "invite?token=" -- docs/` la encuentra.
2. **`app/src/services/members.ts:41`**: *"EL MISMO ORIGEN SE ESCRIBE EN CUATRO LUGARES"*. Son **cinco**
   (4 en el repo + el secret de Supabase).
3. **`app/src/utils/brand-name-guard.test.ts:31`**: *"Las TRES puntas del repo que arman el link"*. Son
   cuatro.

Y la contradicción código↔spec: `specs/active/01-identity-multitenancy/design.md` (commiteado en `0e7e1ca`)
abre el box con **"El origen del link vive en CUATRO lugares que tienen que coincidir"** y enumera tres
del repo + el secret. Falta la página.

**Por qué bloquea**: el modo de falla que esta unidad existe para cerrar —el invitado recibe un link a un
dominio que no es el nuestro— sigue **completamente abierto** en la superficie más cercana al invitado, con
el guard en verde. Es el patrón que el repo ya tiene escrito como regla: *el guard se escribe sobre la
ausencia, no sobre las superficies que ya conocés*. Acá se enumeró desde el enunciado ("tres lugares") en
vez de desde el árbol.

**Nota de alcance**: la lista dura prohíbe **editar** `docs/**`. Agregar el archivo como cuarto sitio
**de lectura** en `INVITE_ORIGIN_SITES` no lo edita — la regla F ya lee `supabase/functions/**`, que
tampoco es `app/`.

---

## 6. El fixture E2E (`app/e2e/invitations.spec.ts:134`) — **inerte, no hace falta correr la suite**

Determinado por lectura, como se pidió. El literal:

```ts
const inviteLink = `https://mitropero.com.ar/invite?token=${encodeURIComponent(token)}`;
```

- **No se navega**: no hay `page.goto(inviteLink)`. Se hace `fill()` en el input `Link de invitación`
  (línea 136) y se toca "Continuar" (137).
- **Su único consumidor es `parseInviteToken`** (`app/app/invite.tsx:115`), que **nunca mira el host**:
  `tokenFromUrl` (`invite.ts:67-83`) sólo hace `new URL(raw)` + `url.searchParams.get('token')`. No hay
  comparación de dominio en ninguna rama.
- **Ninguna aserción del spec toca el host**: las que siguen son `Aceptar invitación` (140), `waitForHome`
  (146) y el nombre del campo (148). `git grep` sobre `app/e2e/` confirma que línea 134 es la **única**
  mención de un dominio en toda la carpeta.

**Riesgo de romper el spec: nulo.** Correcto no haber corrido la suite (habría re-renderizado
`design/**/*.png`). `git status design/` quedó limpio también después de toda mi verificación.

---

## 7. Exactitud de specs (código → spec)

Tras el commit `0e7e1ca` del leader, `ADR-014`, `specs/active/01-identity-multitenancy/*` y
`specs/active/19-login-social/context.md` reflejan el as-built. **Dos excepciones**:

1. **`specs/active/01-identity-multitenancy/design.md`** — el box "CUATRO lugares" está **incompleto**
   (falta `invite.html`, ver §5). Es la misma inexactitud que el comentario de `members.ts`.
2. **`specs/active/01-identity-multitenancy/tasks.md:113`** — dice
   `Deno.env.get('PUBLIC_APP_URL')`. **Esa env var no existe**: `git grep PUBLIC_APP_URL -- supabase/ app/`
   devuelve **cero**. El código usa `APP_URL`. La reconciliación de `0e7e1ca` actualizó el **valor** por
   defecto en esa misma línea y dejó el **nombre de la variable** mal. Pre-existente, no del implementer,
   pero queda mintiendo justo en la línea que se acaba de tocar.

El resto coincide: `requirements.md` R5.2/R6.5, `design.md:257,307`, `tasks.md:218,301`, `ADR-014`
(decisión + la nota de dominio del 11/08) y `19-login-social/context.md:17`.

---

## 8. Trazabilidad `R<n>` ↔ test

No hay feature `in_progress` (`feature_list.json` → 0). Es un **delta de mantenimiento** sobre
`specs/active/01-identity-multitenancy`, sin `R<n>` nuevo. Los requisitos vigentes que el cambio toca:

| Requisito | Qué exige | Test que lo verifica | Estado |
|---|---|---|---|
| **R5.2** | `accept_url` = universal link `<origen>/invite?token=XXX` | `brand-name-guard.test.ts:418` regla F, checks (2)(3)(4) sobre `invite_user` y `resend_invitation` | verde · **M1/M2/M3 lo matan** |
| **R5.8** (regeneración) | mismo `accept_url` al regenerar | misma regla F, punta 3 | verde · **M2 lo mata** |
| **R6.5** | input de pegar link acepta `https://…/invite?token=` y `rafq://…` | `invite.test.ts` (`URL universal https`, `deep-link rafq://`, `acepta CUALQUIER host`, `params extra`, `percent-encoded`, `garbage → null`) | verde |
| **R6.5** (placeholder) | el ejemplo que ve el usuario es el link real | `brand-name-guard.test.ts:459` F(bis) | verde · **M1 lo mata** |
| as-built: las puntas no drift-ean | las 3 del repo coinciden entre sí | F check (2) + `brand-name-guard.test.ts:479` (detector sintético) | verde · **M1/M2 lo matan** |
| as-built: parser host-agnóstico | cualquier host entra | `invite.test.ts` `acepta CUALQUIER host` (4 hosts: subdominio+puerto+path, acortador, localhost) | verde · test nuevo, correcto |

**Sin cobertura faltante para lo que se pidió.** El agujero de §4.1 y la punta de §5 no son "un `R<n>` sin
test": son **cobertura del guard sobre el as-built**, y por eso van como cambios requeridos y no acá.

---

## 9. Tasks completas

**N/A con justificación.** No es una feature SDD con `tasks.md` propio. `tasks.md` de la spec 01 no ganó
tasks nuevas; sus T2.1/T4.3/T5.x se actualizaron por reconciliación de dominio (`0e7e1ca`). Cero `[ ]` sin
justificar introducidos por esta unidad.

---

## 10. Verificación independiente — salida literal

```
$ pnpm typecheck            (desde app/)
> rafaq-app@0.1.0 typecheck C:\DEV\RAFAQ\app-ganado\app
> tsc --noEmit
EXIT_TYPECHECK=0
```

```
$ node --test <lista explícita de scripts/run-tests.mjs, 163 archivos>
ℹ tests 3052
ℹ suites 0
ℹ pass 3052
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 14522.6957
EXIT_UNIT=0
```

Reproduce el 3052/0 del reporte (era 3048 antes: +1 host-agnóstico, +3 de la regla F).

```
$ node scripts/check-hardcode.mjs
[OK]    Anti-hardcode (ADR-023 §4): 0 violaciones en app/app + app/src/components
EXIT_HARDCODE=0
```

```
$ node scripts/check.mjs          ← el reporte NO lo corrió; lo corrí yo, completo
-- 1. Archivos base del harness ----------------------
-- 2. Validando feature_list.json y specs ------------
-- 2b. Higiene de progress/current.md ----------------
-- 2c. Lint anti-hardcode (ADR-023 §4) ---------------
-- 3. Ejecutando tests -------------------------------
    … scripts · RLS · Edge 47 (42 pass, 0 fail, 5 skip por keys) · Animal · Maneuvers ·
      Puesta-en-servicio · Reports · Custom · Scrotal · User_private · Import ·
      Sync streams · spec 11 · spec 09 · spec 02 Δ15 · Audit 15/15 · Health 5/5
All tests passed.
[OK]    Tests verdes
-- 4. Resumen ----------------------------------------
[OK]    Entorno listo. Podés trabajar.
EXIT_CHECK=0
```

Suite E2E **no corrida** (instrucción; re-renderiza `design/**/*.png`). `git status design/` limpio.
Ninguna suite backend asserta el host del `accept_url` — verificado: `supabase/tests/edge/run.cjs:227-230,
247-250, 337-340` y `user_private/run.cjs:740` sólo chequean que exista y contenga el token. El reporte
acierta.

---

## 11. CHECKPOINTS.md

| # | Checkpoint | Estado |
|---|---|---|
| C1 | Harness completo · `check.mjs` exit 0 | **`[x]`** — corrido entero por mí, exit 0 |
| C2 | Estado coherente (≤1 `in_progress`) | `[x]` — cero features `in_progress` |
| C3 | Código respeta la arquitectura | `[x]` — services/utils/screens/functions; cero deps nuevas; cero logs sueltos; cero `establishment_id` hardcodeado |
| C4 | Verificación real | `[x]` — 3052/3052 + 4 mutantes míos (3 muertos, **1 sobreviviente documentado en §4.1**); el oráculo de F son las puntas entre sí, no un mock |
| C5 | Sesión cerrada bien | **`[ ]`** — `progress/current.md` no describe esta unidad (higiene del leader). `[x]` `design/` limpio, sin artefactos sin trackear |
| C6 | Spec Driven Development | **`[ ]`** — `design.md` de la spec 01 contradice el as-built (§5 / §7.1) y `tasks.md:113` nombra una env var inexistente (§7.2) |
| C7 | Multi-tenant | **N/A** — cero tablas, policies o migraciones (`git diff 0ce6919 -- supabase/migrations/` vacío) |
| C8 | Offline-first | **N/A** — cero lectura/escritura de datos de campo; sólo una constante de presentación y dos defaults de EF |
| C9 | E2E + visual (ADR-029) | `[x]` sin cambio visual real (el único pixel es el placeholder del input, ya cubierto por `invite-fixes.capture.ts` y `rebrand-wordmark.capture.ts:100`) · `[x]` `__shots__` no commiteados · **`[ ]`** suite E2E no corrida — **justificado**: el único fixture tocado es inerte por construcción (§6) y correrla re-renderiza `design/**/*.png` |

---

## 12. Checklist RAFAQ-específico

### A. Tablas con `establishment_id` / RLS — **N/A**
Cero migraciones, tablas o policies en el diff.

### B. Offline-first — **N/A**
No toca repositorios, PowerSync, sync buckets ni resolución de conflictos. `INVITE_BASE_URL` es una
constante de bundle; las invitaciones son operación **online por spec** (`R9.2`).

### C. BLE — **N/A**

### D. UI de campo — **aplica mínimamente** (un placeholder, no es flujo de manga)
- [x] Botones ≥ 60dp — sin cambios, no se tocó ningún control.
- [x] Fuente ≥ 18pt — sin cambios tipográficos.
- [x] Una decisión por pantalla — sin cambios estructurales.
- [x] Loading visible — sin cambios de máquina de estados.
- [x] El placeholder nuevo no es más largo que el viejo en términos de riesgo de desborde del input de
  `/invite`; cero regresión de layout.

### E. Edge Functions — **aplica, sin cambio de comportamiento**
`invite_user` y `resend_invitation`: **1 línea de valor por default + comentario** cada una.
- [x] `auth.uid()` al inicio — intacto, fuera del diff (el diff arranca en las líneas 153/78, muy después
  del gate de auth).
- [x] Permisos vía `user_roles` — intacto, fuera del diff.
- [x] Códigos HTTP + mensaje claro — el contrato `{invitation_id, token, accept_url, expires_at}` no cambió.
- [x] Test verde — **`deno test` es N/A en este repo** (no hay infra deno; las suites de EF son node).
  `supabase/tests/edge/run.cjs` corrió verde dentro de `check.mjs` (47 tests, 42 pass, 0 fail, 5 skip por
  keys). **No asserta el host** (§10), así que la cobertura efectiva del cambio es la regla F.
- 🔴 **Sin deployar.** El default nuevo **no aplica** hasta `supabase functions deploy invite_user
  resend_invitation`, y **ni siquiera entonces** si el secret `APP_URL` está seteado con el host viejo:
  gana el secret. Correctamente declarado por el implementer en §7.1-7.2; queda como acción de Raf/leader.

---

## 13. Cambios requeridos (concretos)

1. 🔴 **`app/src/utils/brand-name-guard.test.ts:125` (`INVITE_ORIGIN_SITES`) — sumar la cuarta punta del
   repo**: `docs/marketing/landing-proximamente/invite.html`, extrayendo el origen de la línea 69
   (`var linkCompleto = '<origen>/invite?token=' + enc;`) con su `build` correspondiente. Es **lectura**,
   no edición de `docs/**`. Sin esto, el string que el invitado copia puede apuntar a otro dominio con el
   guard verde — el bug exacto que la unidad dice cerrar.
2. 🔴 **Corregir el conteo en las tres superficies que lo declaran** (hoy dicen "cuatro"/"tres"; son
   cinco/cuatro):
   - `app/src/services/members.ts:41` — "EL MISMO ORIGEN SE ESCRIBE EN CUATRO LUGARES" + la lista 1-4.
   - `app/src/utils/brand-name-guard.test.ts:31` — "Las TRES puntas del repo".
   - `specs/active/01-identity-multitenancy/design.md`, box "El origen del link vive en CUATRO lugares"
     (commiteado en `0e7e1ca`; lo reconcilia el leader, no el implementer).
3. 🟡 **Resolver explícitamente el agujero del M4** (§4.1): o se ancla el origen contra
   `docs/marketing/landing-proximamente/index.html:9` (`<link rel="canonical">`, oráculo independiente y no
   un literal del test), o se **escribe en el header de la regla F** que "todas las puntas se mueven juntas
   a un dominio ajeno" es un caso **conscientemente no cubierto**. Hoy el header (líneas 31-37) sugiere lo
   contrario. Recomiendo el canonical: mata el mutante y no introduce el literal que el implementer
   —con razón— quería evitar.
4. 🟡 **`progress/invitaciones-dominio.md` — corregir las afirmaciones falsificadas**, para que el reporte
   no quede como precedente:
   - §8: *"otras superficies que construyan `/invite?token=` (ninguna)"* → existe, `invite.html:69`.
   - §2: *"devuelve una sola línea"* → son dos (`invite.ts:34` y `brand-name-guard.test.ts:511`).
   - §4 tabla M4: aclarar que lo caza el literal `DEAD_ORIGIN`, **no** la comparación entre sí, y anotar el
     mutante sobreviviente de §4.1.
5. ⚪ **`specs/active/01-identity-multitenancy/tasks.md:113`**: `PUBLIC_APP_URL` → `APP_URL` (esa env var
   no existe en el código; `git grep` → cero). Pre-existente, del leader.
6. ⚪ **Números de línea del reporte §1**: el placeholder está en `app/app/invite.tsx:260` (no 257) y el
   fixture E2E en `app/e2e/invitations.spec.ts:134` (no 131) — los corrieron los comentarios que el mismo
   diff agregó.
7. ⚪ **Antes de commitear**: actualizar `progress/current.md` (C5) y **no stagear**
   `specs/active/10-operaciones-rodeo/requirements.md` ni `docs/marketing/kit-capturas.zip` (otra terminal).
8. 🔴 **Fuera del código, bloquea el efecto real** (correctamente declarado, queda para Raf/leader):
   leer/alinear el secret `APP_URL` en Supabase **DEV y PROD**, y **redesplegar** `invite_user` +
   `resend_invitation`. Hasta entonces el mail sigue mandando el link viejo con todo en verde.

---

## 14. Lo que el reporte afirmó y **se sostiene** (chequeado una por una)

- 3052/3052 y typecheck 0 → **reproducidos exactamente**.
- Los mutantes M1/M2/M3 del reporte (una punta movida, barra final, revert al dominio muerto) → **los
  volví a poner yo y dan rojo, con el mensaje que describe**.
- `invite.test.ts` da verde con el dominio revertido y **está declarado en el propio archivo** (líneas
  17-23) — la honestidad de no vender esos fixtures como detector es correcta y es lo que se quiere.
- Ninguna suite backend asserta el host → **verificado por grep**, cierto.
- El scheme `rafq://` intacto en el parser, en la config y en la web publicada → **cierto**.
- `git diff --stat` == `-w` → **cierto**, sin churn de CRLF.
- El guard está registrado en la lista explícita de `scripts/run-tests.mjs:130` → **cierto**, corre en cada
  `check.mjs`.
- El árbol quedó byte a byte como estaba tras mis 4 mutantes (md5 + `cmp` + `git status`).

---

# RE-REVIEW (vuelta 2) — los dos defectos, verificados con mutantes propios

**Reviewer**: agente revisor · **Fecha**: 2026-08-11 · **Alcance**: acotado a los dos defectos del §13.
**Commits nuevos desde la vuelta 1**: `0e7e1ca`, `b8e410b`, `eb6642e` (docs, del leader) + `753afb0`
(e2e `waitForHome` 45s, ajeno). **El código sigue sin commitear.**
**Estado del árbol al cerrar**: idéntico byte a byte al que encontré — `cmp` OK en los 7 archivos tocados
después de **cada uno de los 13 mutantes**, `git status` idéntico, `design/` limpio.

## Veredicto

**APPROVED**

Los dos defectos están cerrados y lo verifiqué falsificando, no leyendo. Lo decisivo: **con el check del
ancla neutralizado, el mutante que antes sobrevivía vuelve a pasar en verde** — o sea que el ancla no es
decorativa, es lo único que ata las puntas a la realidad publicada.

Queda **una inexactitud residual de conteo en dos docs del leader** (§R4), que no bloquea el código pero
**hay que corregir antes de commitear**: son las dos únicas superficies del repo que todavía dicen "las
tres puntas".

---

## R1. Defecto 1 — la cuarta punta

### R1.1 La regla LEE el `.html` (M5 / M5-bis)

`INVITE_ORIGIN_SITES` (`brand-name-guard.test.ts:174-186`) tiene la cuarta entrada, con su `re`, su
`build` propio y `strip: stripHtmlComments`.

| # | Mutante mío | Resultado |
|---|---|---|
| **M5** | **sólo** `invite.html:69` cambia a `https://app.rafq.ar` | **ROJO 14/15**, check (1): `actual: [ 'docs/marketing/landing-proximamente/invite.html -> https://app.rafq.ar' ]` |
| **M5-bis** | **sólo** `invite.html:69` cambia a `https://otro-dominio-neutro.com` | **ROJO 14/15**, check (2): `'docs/.../invite.html dice "https://otro-dominio-neutro.com" — la PÁGINA PUBLICADA — el link que el invitado COPIA Y PEGA...'` |

M5-bis importa más que M5: prueba que la punta se lee **de verdad** y no que la caza el literal
`DEAD_ORIGIN`. Un cambio **sólo ahí** pone la regla roja **nombrando el archivo**. OK.

### R1.2 El `.html` NO se editó — verificado contra el repo Y contra el sitio

```
git diff --stat HEAD -- docs/marketing/landing-proximamente/   -> vacío
git status --porcelain docs/marketing/landing-proximamente/    -> vacío

                worktree                          HEAD                              0ce6919
index.html   5652c23456482dcef0031c6ad73f5a9a  5652c23456482dcef0031c6ad73f5a9a  5652c23456482dcef0031c6ad73f5a9a
invite.html  ac9318a0b10a565a94efdf2ae98d663d  ac9318a0b10a565a94efdf2ae98d663d  ac9318a0b10a565a94efdf2ae98d663d
```

Y **no me quedé en el repo**: bajé las dos páginas publicadas ahora mismo.

```
$ curl -s https://mitropero.com.ar/                           -> http=200 bytes=3759  md5 5652c23456482dcef0031c6ad73f5a9a
$ curl -s "https://mitropero.com.ar/invite?token=550e8400-..." -> http=200 bytes=5591  md5 ac9318a0b10a565a94efdf2ae98d663d
```

**Repo == servido, byte a byte.** El archivo entra al guard como sitio de **lectura** y el propio código
lo declara (`brand-name-guard.test.ts:175-177`, `members.ts:53-54`). Sin desincronización. OK.

### R1.3 Los textos de conteo — eran cuatro, y confirmo los cuatro

| Superficie | Antes | Ahora | Estado |
|---|---|---|---|
| `app/src/services/members.ts:44` | "CUATRO LUGARES" | **"CINCO LUGARES... cuatro en el repo y uno afuera"** + enumeración 1-5 con la página como 4 | OK |
| `app/src/utils/brand-name-guard.test.ts:31` y `:114` | "las TRES puntas" / "CUATRO lugares" | **"Las CUATRO puntas del repo"** / **"CUATRO lugares del repo"** | OK |
| `supabase/functions/invite_user/index.ts:156` | "CUATRO puntas", enumeraba 3 + secret | **"CINCO puntas"**, con la página | OK |
| `supabase/functions/resend_invitation/index.ts:81` | enumeraba sin la página | nombra la página + el secret | OK |
| `specs/active/01-identity-multitenancy/design.md:549` (leader, `eb6642e`) | "CUATRO lugares" | **"CINCO lugares"**, punta 4 = la página, punta 5 = el secret | OK |

`docs/adr/ADR-014` no declara conteo — coherente, no hace falta tocarlo.
**Pero quedaron dos más que el implementer no contó** -> §R4.

### R1.4 El test de documentación — falsificado, no es cosmético

`F — el comentario que documenta las puntas las NOMBRA a todas` (`:580-605`) itera
`INVITE_ORIGIN_SITES` y exige `doc.includes(s.file)` por **path**, mas `APP_URL` y `CANONICAL_FILE`.
Le saqué una punta por vez:

| # | Mutante mío | Resultado |
|---|---|---|
| **M7a** | el comentario deja de nombrar `.../invite.html` | **ROJO**, `actual: [ 'docs/marketing/landing-proximamente/invite.html' ]` |
| **M7b** | deja de nombrar `supabase/functions/invite_user/index.ts` | **ROJO**, `actual: [ 'supabase/functions/invite_user/index.ts' ]` |
| **M7c** | deja de nombrar el ancla (`.../index.html`) | **ROJO**, "tiene que nombrar el ancla" |
| **M7d** | deja de nombrar `APP_URL` (el secret invisible) | **ROJO**, "la punta que vive FUERA del repo" |
| **M6** | **borro la 4ta entrada entera** de `INVITE_ORIGIN_SITES` (queda en 3) | **ROJO**, anti-vacío: `actual: 3, expected: 4` |

El M6 es el que cierra el círculo: sin él, sacar la punta de la lista también la sacaría del test de
enumeración (que itera esa misma lista) y todo quedaría verde — el agujero exacto de la vuelta 1.
**El test de documentación no es fácil de escribir mal acá: lo maté cuatro veces por caminos distintos.**

---

## R2. Defecto 2 — el ancla contra el canonical

### R2.1 M4-bis, y el aislamiento que lo hace concluyente

| # | Mutante mío | Resultado |
|---|---|---|
| **M4-bis** | **las CUATRO** puntas + el placeholder a `https://dominio-que-nunca-compramos.com`, canonical intacto | **ROJO 14/15 por el check (2)**, listando las cuatro contra `"https://mitropero.com.ar"` |
| **M4-bis-b** | ídem, **más neutralizo el ancla** (`sites.filter((s) => s.origin !== canonical)` pasa a `sites.filter(() => false)`) | **VERDE 15/15** |

**M4-bis-b es la prueba, no M4-bis.** Que el test se ponga rojo no dice quién lo puso rojo; apagando
sólo el ancla, el mutante vuelve a pasar. Ninguna otra regla lo ve. El ancla es load-bearing y cierra
exactamente el agujero medido en §4.1 de la vuelta 1.

### R2.2 El razonamiento sobre el M4 original — **es correcto**, y lo medí

El implementer sostiene que el M4 del pedido (tres puntas) ya no aísla nada. Lo verifiqué con el ancla
apagada: **mover tres puntas da ROJO igual, por el check (3) "entre sí"**, con el mensaje
`docs/.../invite.html dice "https://mitropero.com.ar" y las otras dicen "https://dominio-que-nunca-compramos.com"`.
Con cuatro puntas, mover tres deja una en minoría -> hay discrepancia -> el comparador lo caza sin ancla.
Sólo moviendo **las cuatro** el comparador queda mudo. El razonamiento se sostiene y la elección del
mutante es la correcta.

### R2.3 La normalización de la barra final no abre agujero — cuatro sondas

`canonicalOrigin` (`:205-207`) saca **una** barra y se aplica **sólo al canonical**, nunca a las puntas.
La comparación es desigualdad estricta, sin `startsWith` ni `includes`.

| # | Sonda mía | Esperado | Resultado |
|---|---|---|---|
| **N1** | canonical **sin** barra (`href="https://mitropero.com.ar"`), puntas intactas | verde (se tratan igual) | **VERDE 15/15** |
| **N3** | las cuatro puntas a `https://mitropero.com.ar.evil.com`, canonical intacto | rojo | **ROJO 14/15** por el ancla |
| **N4** | `members.ts` a `https://mitropero.com.ar/` (barra final en una PUNTA) | rojo | **ROJO 13/15** (F y F bis) |
| **N5** | canonical secuestrado a `https://mitropero.com.ar.evil.com/`, puntas intactas | rojo | **ROJO 14/15**, y el mensaje dice `hoy vale "https://mitropero.com.ar.evil.com"` |

`https://mitropero.com.ar` equivale a `https://mitropero.com.ar/` (N1) pero
`https://mitropero.com.ar.evil.com` **no pasa** (N3), en las dos direcciones (N5).
**Sin confusión de prefijo ni de sufijo.**

Fail-closed del ancla, verificado aparte:

| # | Mutante mío | Resultado |
|---|---|---|
| **M8** | borro el `<link rel="canonical">` de la landing | **ROJO**, `[F] no encontré el <link rel="canonical"> ... Ese tag es EL ANCLA` |
| **M8b** | dejo el canonical **comentado** en HTML | **ROJO**, mismo throw — `stripHtmlComments` no lo deja engañar |

No degrada a "comparar entre sí": tira.

### R2.4 El header dice la verdad sobre lo que NO protege

`brand-name-guard.test.ts:37-47`, textual, tres viñetas:

- **SÍ**: que ninguna punta se separe de las otras ni del canonical.
- **NO**: "mover TODO junto —las cuatro puntas Y el canonical— a un dominio ajeno sigue pasando en
  verde. Es un límite consciente: nada dentro del repo puede saber qué dominio se compró de verdad."
- **NO**: "la QUINTA punta ... el secret `APP_URL` ... Si está seteado, GANA sobre los defaults ... este
  guard puede estar verde y el mail salir con otro origen igual."

Los dos casos que pedí declarar están declarados, y el mensaje de fallo del check (2) los repite in-situ
(`:545-546`) para el que nunca lea el header.

---

## R3. Verificación — salida literal

```
$ pnpm typecheck            (desde app/)
> rafaq-app@0.1.0 typecheck C:\DEV\RAFAQ\app-ganado\app
> tsc --noEmit
EXIT_TYPECHECK=0
```

```
$ node --disable-warning=... --import ./scripts/ts-ext-resolver.mjs --test [162 archivos de run-tests.mjs]
ℹ tests 3053
ℹ suites 0
ℹ pass 3053
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 14500.4081
EXIT_UNIT=0
```

3052 -> **3053** (mas 1, el test de enumeración). Reproduce el número del reporte §9.5.

```
$ node scripts/check-hardcode.mjs
[OK]    Anti-hardcode (ADR-023 §4): 0 violaciones en app/app + app/src/components
EXIT_HARDCODE=0
```

```
$ node scripts/check.mjs         (lo corrí completo: mi regla dura, no estaba en el pedido)
-- 1. Archivos base del harness ----------------------   [OK] x16
-- 2. Validando feature_list.json y specs ------------
[OK]    feature_list.json válido (22 features)
[OK]    context.md presente en context_ready; specs presentes en spec_ready+
-- 2b. Higiene de progress/current.md ----------------
[WARN]  current.md parece inflado (1 bloque(s) de sesión, 1283 líneas). ...
-- 2c. Lint anti-hardcode (ADR-023 §4) ---------------
[OK]    Anti-hardcode (ADR-023 §4): 0 violaciones en app/app + app/src/components
-- 3. Ejecutando tests -------------------------------
All tests passed.
[OK]    Tests verdes
-- 4. Resumen ----------------------------------------
[OK]    Entorno listo. Podés trabajar.
EXIT_CHECK=0
```

El único `[WARN]` es el de `current.md` (C5, higiene del leader, pre-existente) — no es un fallo.

Guard solo: **15/15** antes y después de los 13 mutantes.
**Suite E2E NO corrida** (instrucción). `git status design/` limpio.
`git diff --stat HEAD` igual a `git diff -w --stat HEAD` (9 archivos, 471/25) -> **sin churn de CRLF**.

---

## R4. Lo que quedó abierto: dos textos de conteo que todavía mienten

El implementer dijo "eran cuatro". **Eran seis.** Los cuatro de código están bien (§R1.3); faltan dos, y
los dos son del leader (commit `0e7e1ca`, que `eb6642e` no alcanzó):

1. **`docs/backlog.md:1545`** — "Las **tres** puntas del repo (`INVITE_BASE_URL` y los defaults de
   `invite_user` y `resend_invitation`) apuntan al dominio nuevo, con una regla en
   `brand-name-guard.test.ts` que las compara **entre sí**." Son **cuatro**, y la regla ya no las compara
   sólo entre sí: las ancla al canonical.
2. **`docs/backlog.md:1546`** — "La **cuarta** punta es el secret `APP_URL`". Es la **quinta**. Esta es la
   peor de las dos: es la línea que va a leer quien vaya a setear el secret, y **reproduce literalmente el
   miscount que causó el defecto** (la página no cuenta como punta).
3. **`docs/marketing/plan-toma-de-marca-mitropero.md:392`** — "las **tres** puntas del repo apuntan al
   dominio nuevo". Cuatro.

**Por qué no bloquea**: no es código, no es `design.md` ni `requirements.md` (los dos quedaron correctos:
`design.md:549-556` enumera las cinco y nombra el ancla), y `docs/**` está en la lista dura que el
implementer **tiene prohibido tocar** — no puedo rechazarlo por algo que no puede editar y que mi §13 no
le pidió. Es reconciliación del leader, **antes de commitear**.

---

## R5. Lista dura — nada prohibido se tocó (re-verificado sobre el diff de hoy)

| Ítem | Estado | Evidencia |
|---|---|---|
| `scheme: 'rafq'` | intacto | `app.config.ts:36` y `git diff --stat HEAD -- app/app.config.ts` **vacío** |
| identificador `ar.rafq.app` | intacto | `app.config.ts:4-7` |
| `slug` / `owner` / `projectId` | `rafaq-app` / `rafaqsorg` / `d8cf3a19-...` | `app.config.ts:35,117,114` |
| `eas.json` | intacto | fuera del diff |
| `noreply@rafq.ar` | intacta | `_shared/email.ts:24`, fuera del diff |
| prefijos `rafq.*`, `X-Rafaq-Actor`, GUCs, `RAFAQ_*` | intactos | grep sobre las líneas de alta y baja del diff: **cero** |
| `docs/**` (incluidos los dos `.html`) | **sólo lectura** | md5 idéntico a `HEAD`, a `0ce6919` y al servido |

Todas las líneas de baja con `rafq` son del **dominio muerto**; todas las de alta con `rafq` preservan el
**scheme** explícitamente (`invite.ts:14`, `brand-name-guard.test.ts`, `invite.tsx:6`).

Ajenos a esta unidad y **que no se deben stagear**: `specs/active/10-operaciones-rodeo/requirements.md`
y `docs/marketing/kit-capturas.zip` (otra terminal).

---

## R6. CHECKPOINTS.md

| # | Checkpoint | Estado |
|---|---|---|
| C1 | Harness completo, `check.mjs` exit 0 | **`[x]`** — corrido entero por mí, `EXIT_CHECK=0` |
| C2 | Estado coherente (máximo 1 `in_progress`) | `[x]` — cero features `in_progress` |
| C3 | Código respeta la arquitectura | `[x]` — sin cambios estructurales desde la vuelta 1 |
| C4 | Verificación real | **`[x]`** — 3053/3053 y **13 mutantes míos, 13 muertos**; el sobreviviente de la vuelta 1 (M4) ahora muere, y probé que **muere por el ancla** (M4-bis-b) |
| C5 | Sesión cerrada bien | **`[ ]`** — `progress/current.md` sigue describiendo la unidad del 07/08 (`[WARN]` de `check.mjs`). Higiene del leader, pre-commit. `[x]` `design/` limpio |
| C6 | Spec Driven Development | **`[x]`** — `design.md:549-556` y `tasks.md` reconciliados en `eb6642e` (`PUBLIC_APP_URL` pasó a `APP_URL`); `ADR-014` coherente. Pendiente sólo el drift de `docs/backlog.md` (§R4), que no es spec |
| C7 | Multi-tenant | **N/A** — cero migraciones y policies |
| C8 | Offline-first | **N/A** — cero lectura o escritura de datos de campo |
| C9 | E2E + visual (ADR-029) | `[x]` sin cambio visual nuevo en esta vuelta (el único pixel sigue siendo el placeholder) · `[x]` `__shots__` no commiteados · **`[ ]`** E2E no corrida — **justificado**: instrucción explícita y el único fixture tocado es inerte (§6 de la vuelta 1, sin cambios) |

---

## R7. Checklist RAFAQ-específico

### A. RLS / `establishment_id` — **N/A** · B. Offline-first — **N/A** · C. BLE — **N/A**

Sin migraciones, tablas ni policies; sin repositorios ni PowerSync; sin BLE. Idéntico a la vuelta 1.

### D. UI de campo — **aplica mínimamente** (un placeholder, sin cambios en esta vuelta)

- [x] Botones >= 60dp · [x] Fuente >= 18pt · [x] Una decisión por pantalla · [x] Loading visible — cero
  cambios de control, tipografía, estructura o máquina de estados respecto de la vuelta 1.

### E. Edge Functions — **aplica; esta vuelta sólo tocó COMENTARIOS**

El diff de `invite_user` y `resend_invitation` en la vuelta 2 son **6 y 3 líneas de comentario**; el valor
del default ya estaba.

- [x] `auth.uid()` al inicio — intacto, fuera del diff (empieza en `:156` y `:81`, muy después del gate).
- [x] Permisos vía `user_roles` — intacto, fuera del diff.
- [x] Códigos HTTP y mensaje claro — contrato `{invitation_id, token, accept_url, expires_at}` sin cambios.
- [x] Test verde — `deno test` **N/A** (no hay infra deno; las suites de EF son node). Edge suite dentro
  de `check.mjs`: **47 tests, 42 pass, 0 fail, 5 skip por keys**.
- **Sin deployar, y el secret manda** — declarado por el implementer (§7.1-7.2) y repetido en el header
  del guard, en `members.ts:55-58` y en `design.md:560`. **No es un defecto del código: es acción de
  Raf/leader** y sigue bloqueando el efecto real.

---

## R8. Cambios requeridos — ninguno bloqueante. Antes de commitear (leader):

1. `docs/backlog.md:1545` — "las tres puntas del repo" pasa a **cuatro**, y "que las compara entre sí"
   pasa a "que las compara entre sí **y contra el `<link rel="canonical">` del sitio publicado**".
2. `docs/backlog.md:1546` — "La **cuarta** punta es el secret `APP_URL`" pasa a **quinta**. Es la línea que
   va a leer quien setee el secret.
3. `docs/marketing/plan-toma-de-marca-mitropero.md:392` — "las tres puntas del repo" pasa a **cuatro**.
4. `progress/current.md` (C5): describir esta unidad y desinflar el bloque viejo (`[WARN]` de `check.mjs`).
5. **No stagear** `specs/active/10-operaciones-rodeo/requirements.md` ni `docs/marketing/kit-capturas.zip`.
6. **Fuera del repo, sigue en pie**: alinear el secret `APP_URL` en Supabase **DEV y PROD** y
   **redesplegar** `invite_user` y `resend_invitation`. Hasta entonces el mail sale con el origen viejo
   con todo el repo en verde — y ahora el guard lo dice en cuatro lugares distintos.

---

## R9. Lo que el reporte §9 afirmó y se sostiene (chequeado uno por uno)

- Los `.html` sólo se leen, md5 contra `HEAD` **y contra el sitio servido** -> **cierto, lo re-medí con curl**.
- M4-bis muere **y sólo por el ancla** -> **cierto, y lo aislé apagando el check (2)**, cosa que el reporte
  no hizo: sin ese paso, "M4-bis da rojo" no probaba que el ancla sirviera para algo.
- "El M4 original ya no aísla nada" -> **cierto, medido** (rojo por el check (3) con el ancla apagada).
- M5, M6, M7 y M8 -> **los volví a poner y dan rojo con el mensaje que describe**.
- 3053/3053, typecheck 0, hardcode 0 -> **reproducidos exactamente**.
- Barrido de superficies §9.4 (`git grep "invite?token="`) -> **verificado, la clasificación es completa**;
  el `og:url` de `index.html:14` correctamente dejado afuera (coherencia interna del sitio, no una punta).
- El conteo "eran cuatro textos" -> **incompleto: son seis** (§R4). Es la única afirmación del §9 que no se
  sostiene, y otra vez por el mismo motivo: enumeró las superficies de código y no barrió `docs/`.
