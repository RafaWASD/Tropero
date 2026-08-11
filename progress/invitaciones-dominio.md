# Dominio de los links de invitación: `app.rafq.ar` → `mitropero.com.ar`

**Fecha**: 2026-08-11 · `baseline_commit: 0ce691918669c74a57bd3d54738ee4fc36fe2b1d` (HEAD al arrancar).
Trabajo sobre `main`, sin feature-branch. **Nada desplegado** (ver §7).

> ⚠️ **Este documento tiene DOS vueltas.** Las §0-§8 son la vuelta 1, tal como se entregó al reviewer, y
> **contienen tres afirmaciones que el reviewer falsificó** (marcadas en el texto con ⛔). No las borré:
> quedan como registro, corregidas en **§9 «Vuelta 2»**, que es la que describe el estado final.

---

## 0. La premisa, verificada en vivo (no heredada del enunciado)

```
https://mitropero.com.ar/                                   → 200
https://mitropero.com.ar/invite?token=550e8400-…-446655440000 → 200   (sin -L: 200 directo, no redirige)
https://www.mitropero.com.ar/invite?token=x                  → 301 → https://mitropero.com.ar/invite?token=x
https://mitropero.com.ar/.well-known/apple-app-site-association → 302 (no sirve JSON)
https://mitropero.com.ar/.well-known/assetlinks.json            → 302 (no sirve JSON)
```

Tres consecuencias que decidieron el trabajo:

1. **El apex es el canónico**, no `www` (es `www` el que redirige al apex). Por eso el origen quedó
   `https://mitropero.com.ar` y no `https://www.…`.
2. La página **sí lee el token y ofrece abrir la app**: en el HTML servido está
   `new URL(window.location.href).searchParams…token…` y `rafq://invite?token=`. O sea que **el scheme
   `rafq` es un contrato vivo con la web publicada**: cambiarlo hoy rompería el botón "abrir la app" de
   la página. Refuerza que sea fase 2, no es solo prolijidad.
3. **La asociación universal-link NO está publicada** (los `.well-known/*` redirigen). Tocar el link
   sigue abriendo el navegador, no la app. Actualicé el comentario de `invite.tsx` que decía lo
   contrario ("el dominio no existe aún") con este estado real.

---

## 1. Los cambios, archivo por archivo

| # | Archivo | Qué |
|---|---|---|
| 1 | `app/src/services/members.ts:58` | `INVITE_BASE_URL = 'https://mitropero.com.ar'` |
| 2 | `supabase/functions/invite_user/index.ts:160` | default de `APP_URL` |
| 3 | `supabase/functions/resend_invitation/index.ts:83` | default de `APP_URL` |
| 4 | `app/src/services/members.ts:40-57` | el comentario, reescrito: nombra las **cuatro** puntas (incluida la de Supabase, que gana sobre 2 y 3) y **qué pasa si se desalinean** |
| 5 | `supabase/functions/{invite_user,resend_invitation}/index.ts` | 4+2 líneas de comentario que apuntan al comentario largo de `members.ts` (antes ninguna de las dos EFs decía que el valor estaba acoplado a otras tres puntas) |
| 6 | `app/app/invite.tsx:257` ⛔ es la **260** (la corrieron los comentarios de este mismo diff) | placeholder que ve el usuario |
| 7 | `app/app/invite.tsx:6-13` | el header decía "el dominio app.rafq.ar no existe aún" — hoy es **falso**. Ahora dice qué existe (la página) y qué sigue faltando (la asociación universal-link), con la fecha |
| 8 | `app/src/utils/invite.ts:12-15, 33-36` | los comentarios del formato canónico. **El scheme `rafq://` NO cambió**; le agregué la nota explícita de que no se rebrandeó, para que el próximo que pase no "complete" el rebrand |
| 9 | `app/src/utils/invite.test.ts` | los fixtures salen de una constante `HOST`, con la advertencia de que **no son el oráculo del dominio**; + un test nuevo de host-agnosticismo |
| 10 | `app/e2e/invitations.spec.ts:131` ⛔ es la **134** | mismo fixture muerto en el único test que simula el flujo real (ver §5, riesgo declarado) |
| 11 | `app/src/utils/brand-name-guard.test.ts` | **regla F** + F(bis) + su detector sintético (§3) |

`git diff --stat` == `git diff -w --stat` (8 archivos, 281/25) → **sin churn de CRLF**.

### El comentario de las cuatro puntas (punto 2 del pedido)

Dice, en `members.ts`: las cuatro puntas numeradas (cliente · `invite_user` · `resend_invitation` ·
secret `APP_URL` de Supabase **DEV y PROD**), que **la 4ª gana sobre los defaults de la 2 y la 3 y
ningún test ni typecheck puede verla**, y la consecuencia concreta del desalineamiento: el
`accept_url` que devuelve el backend y el link que la app **muestra** para esa misma invitación
apuntan a hosts distintos → el owner comparte uno de los dos sin saber cuál y **el fallo aparece
recién del lado del invitado**. Cierra diciendo quién cuida qué: las puntas 1-3 el guard, la 4 a mano.

---

## 2. Lo que NO toqué (lista dura, verificada sobre el diff)

Filtré el diff completo por `rafq|scheme|slug|owner|projectId|X-Rafaq|noreply|storage`: **todas las
líneas de `rafq` que aparecen son BAJAS** del dominio viejo, salvo tres altas que son menciones al
scheme en comentarios/fixtures y que lo **preservan** explícitamente.

`scheme: 'rafq'` · `rafq://` (ni el que arma la web ni el que parsea `invite.ts`) · `ar.rafq.app` ·
`slug` · `owner` · `projectId` · `eas.json` · `noreply@rafq.ar` · prefijos de storage `rafq.*` ·
`X-Rafaq-Actor` · GUCs · env vars `RAFAQ_*` · `specs/**` · `docs/**` · `progress/**` (salvo este
archivo). Ningún deploy, ningún secret, ninguna migración.

⛔ **Falso** (corregido en §9.1): devuelve **dos**. La segunda es `brand-name-guard.test.ts` falsificando
su propio detector (`DEAD_ORIGIN.test('https://app.rafq.ar')`), legítima pero no contada.

`git grep "app\.rafq\.ar"` fuera de `.md`/`docs`/`specs`/`progress` devuelve **una sola línea**, y es
deliberada: `app/src/utils/invite.ts:34`, dentro del docblock que explica por qué el parser es
host-agnóstico ("los links viejos (`app.rafq.ar`) tienen que seguir entrando"). Ahí el dominio muerto
está nombrado **como legacy**, que es justo lo contrario de documentarlo como formato canónico.

---

## 3. La regla F del guard

Vive en `app/src/utils/brand-name-guard.test.ts` (ya registrado en la lista explícita de
`scripts/run-tests.mjs`, así que corre en cada `check.mjs`). Tres tests:

**`F — las TRES puntas … dicen el MISMO origen (la 4ª vive en Supabase)`**. Extrae el origen de los
tres archivos con un regex por punta (sobre el texto **con los comentarios blanqueados**, para que un
literal comentado no lo engañe) y chequea cuatro cosas:

1. ninguna matchea `/rafq\.ar/i` — el único literal escrito a mano es el valor **conocido-malo**;
2. **las tres coinciden entre sí**. El oráculo son ellas mismas: la referencia es la **mayoría**, no
   la primera de la lista, para que el mensaje nombre *la que se movió* y no las dos que quedaron
   bien. No hay ningún origen "esperado" escrito en el test — con un literal, cambiar las tres puntas
   y "actualizar el test" pasaría verde sin detectar nada, que es exactamente el movimiento peligroso;
3. el origen es **puro** (esquema+host, sin barra final ni path): las tres le concatenan
   `/invite?token=`, así que una barra de más produce `//invite`;
4. **lo concatenan igual**: tres orígenes idénticos con paths distintos siguen dando links distintos.

Si un regex deja de matchear, `readOrigin` **tira** con un mensaje que pide actualizar el extractor en
el mismo commit. Un guard que no encuentra su entrada no puede reportar "cero violaciones".

**`F (bis) — el placeholder que ve el usuario muestra el MISMO origen que el link real`**. Cuarta
superficie *del repo* (no arma links, pero la lee un humano y la copia). Se ancla al origen leído de
`members.ts`, no a un literal. Exige exactamente 1 placeholder con URL en `invite.tsx` — si aparece
otro, el test pide sumarlo antes que dejarlo sin cubrir.

**`F — el detector de desalineamiento DETECTA (casos sintéticos)`**. El comparador se extrajo a una
función pura y se falsifica con orígenes inventados (`uno.example` / `dos.example`), incluyendo los
casos que un `includes`/`startsWith` dejaría pasar: barra final, mayúsculas, `http` vs `https`, y el
caso "la que se movió es la primera de la lista". Sin esto, la regla F podría estar comparando mal —o
nada— y verse igual: verde.

**Sobre la cuarta punta**: está escrita en el docblock de cabecera, en el bloque de constantes y en el
mensaje de fallo. Dice, textual, que **este guard verde NO implica que el mail salga con el origen
correcto**, solo que las tres puntas del repo coinciden.

---

## 4. Falsificación — 8 mutantes, uno por vez, restaurando por `cmp` entre cada uno

| # | Mutante | Resultado |
|---|---|---|
| M1 | **solo** `INVITE_BASE_URL` → otro host | **ROJO**. F: `app/src/services/members.ts dice "https://mitropero.ar" y las otras dicen "https://mitropero.com.ar" — INVITE_BASE_URL — el CLIENTE reconstruye…` (+ F bis) |
| M2 | **solo** el default de `invite_user` | **ROJO**. F nombra `supabase/functions/invite_user/index.ts … — default de APP_URL — el accept_url que vuelve al CREAR la invitación` |
| M3 | **solo** `resend_invitation`, con **barra final** | **ROJO**. F nombra `resend_invitation … dice "https://mitropero.com.ar/"` |
| M4 | **revert completo**: las 3 puntas + el placeholder al dominio muerto | **ROJO**. F lista las tres con el mensaje de NXDOMAIN. ⛔ Lo caza el **literal `DEAD_ORIGIN`**, NO la comparación entre sí — y el mutante equivalente a un dominio **ajeno** (no `rafq.ar`) sobrevivía en verde. Ver §9.2 |
| M5 | `resend_invitation` arma `/aceptar?token=` (mismo origen, otro path) | **ROJO**. Check (4) |
| M6 | **solo** el placeholder queda viejo | **ROJO**. F(bis) muestra los dos strings enfrentados |
| M7 | el código cambia de forma (`INVITE_BASE_URL` pasa a template literal) → el extractor se queda ciego | **ROJO** con el mensaje `[F] no encontré el origen…`, **no verde** |
| M8 | el comparador se afloja (`filter(() => false)`) | **ROJO** por el test sintético |

Después de restaurar: `cmp` byte-a-byte OK en los 6 archivos tocados y **14/14 verde** en el guard.

### El hallazgo del M4 (lo pediste explícito)

Con **las tres puntas revertidas al dominio muerto**, `invite.test.ts` da **21/21 verde**. Es correcto
y es a propósito: `parseInviteToken` es host-agnóstico, así que sus fixtures **no pueden ser** el
detector del dominio — actualizarlos es higiene documental, nada más. El detector es la regla F, que
en ese mismo mutante se pone roja. Lo dejé escrito arriba de la constante `HOST` para que nadie lea
esos tests como una garantía que no dan.

---

## 5. El único riesgo que asumo: `e2e/invitations.spec.ts`

Cambié el fixture del host en el E2E (era el mismo dominio muerto, en el único test que simula el
flujo real de pegar el link) **y no lo corrí** — la instrucción era no correr la suite E2E, que
re-renderiza `design/**/*.png`. El cambio es inerte por construcción: el test llena el campo y
`parseInviteToken` no mira el host (probado en el test nuevo de host-agnosticismo, con 4 hosts
arbitrarios incluidos puerto, subdominio, acortador y `localhost`). `git status design/` quedó limpio.
Si preferís riesgo cero, revertir esa línea es un `git checkout` de un archivo y no afecta nada más.

---

## 6. Verificación — salida literal

### `pnpm typecheck` (desde `app/`)

```
> rafaq-app@0.1.0 typecheck C:\DEV\RAFAQ\app-ganado\app
> tsc --noEmit

EXIT_TYPECHECK=0
```

### Suite unitaria — `node scripts/run-tests.mjs` (corrida final, completa)

```
>>> client unit tests
ℹ tests 3052
ℹ suites 0
ℹ pass 3052
ℹ fail 0
<<< client unit tests OK
```

3048 → **3052**: +1 (host-agnóstico en `invite.test.ts`) y +3 (F, F bis, detector sintético). El resto
de los bloques del runner, sin rojos: scripts 33/33 · RLS 22/22 · Edge 47 (42 pass, 0 fail, 5 skips
por keys) · Animal 139/139 · Maneuvers 14/14 · Puesta-en-servicio 11/11 · Reports 36/36 · Custom 20/20
· Scrotal 12/12 · User_private 28/28 · Import 25/25 · Sync streams 25/25 · Audit · Health 5/5.

```
All tests passed.
EXIT_SUITE=0
```

### `node scripts/check-hardcode.mjs`

```
[OK]    Anti-hardcode (ADR-023 §4): 0 violaciones en app/app + app/src/components
EXIT_HARDCODE=0
```

**No corrí la suite E2E** (instrucción) ni `check.mjs` como tal — `run-tests.mjs` es su comando de
tests y salió 0 con las suites de DB incluidas.

Ninguna suite backend asserta el **host** del `accept_url`: `supabase/tests/edge/run.cjs` y
`user_private/run.cjs` solo chequean que exista y que contenga el token (verificado por grep). O sea
que el cambio de dominio no podía romperlas — y tampoco lo habrían detectado.

---

## 7. Lo que queda pendiente y NO es código (bloquea el efecto real del cambio)

1. 🔴 **El secret `APP_URL` de Supabase, en DEV y en PROD.** No lo toqué ni intenté leerlo. **Si está
   seteado con el dominio viejo, este cambio no sirve para nada en producción**: gana el secret y el
   mail sigue mandando el link muerto, con el guard en verde. Es la única punta que decide el
   comportamiento real del backend.
2. 🔴 **Deploy de las dos Edge Functions.** Si el secret **no** está seteado, los defaults nuevos solo
   aplican después de `supabase functions deploy invite_user resend_invitation`. No deployé.
3. 🟡 **El cliente** (`INVITE_BASE_URL`) viaja en el bundle: aplica en el próximo build/OTA.
4. ⚪ **`docs/**` y `specs/**` siguen documentando `app.rafq.ar`** (los escribís vos, no los toqué):
   `docs/adr/ADR-014` (§24 y §103), `docs/backlog.md` (449, 1143, 1159-1160, 1531-1532),
   `docs/plan-mejoras-2026-07-20.md:133`, `specs/active/01-identity-multitenancy/{requirements:19,123,176,
   design:257,307,543,547, tasks:113,218,301}`, `specs/active/19-login-social/context.md:17`. La entrada
   del backlog «Las invitaciones NO funcionan» y la de deploy web (1143) quedaron **desactualizadas por
   este cambio**: su causa raíz (el dominio no existía) ya no aplica, aunque el universal-link sigue sin
   asociarse.
5. ⚪ **Universal links**: para que el link **abra la app** en vez del navegador hace falta publicar
   `apple-app-site-association` y `assetlinks.json` en el dominio nuevo (hoy 302) + config nativa. El
   `rafq://` de la página es el workaround actual y funciona.

---

## 8. Autorrevisión

- **¿Algún test que toqué pasaría igual con el cambio revertido?** Sí, y lo probé en vez de suponerlo:
  `invite.test.ts` da 21/21 con las tres puntas revertidas (M4). Está documentado en el propio archivo
  y arriba, en §4 — no lo convertí en un test de dominio porque el parser tiene que seguir aceptando
  cualquier host. Los tests que **no** sobreviven al revert son los tres de la regla F.
- **¿Quedó alguna de las tres puntas con el dominio viejo?** No: `git grep` fuera de docs deja una sola
  mención, en un comentario que la nombra como legacy. Y ahora hay un guard que lo vigila.
- **¿Toqué el scheme?** No. `scheme: 'rafq'`, el `rafq://` que parsea `invite.ts` y el que usa la
  página web están intactos; agregué comentarios que dicen explícitamente que no se rebrandean, y el
  control sintético del guard que antes usaba el placeholder viejo ahora usa `rafq://` (así el control
  sigue apuntando a un identificador vivo y no a un string que ya no existe en el árbol).
- **Otros vectores que busqué**: consumidores de `INVITE_BASE_URL` (`miembros.tsx`, vía
  `inviteUrlForToken` — no arma el link por su cuenta) · suites backend que asserten el host (ninguna) ·
  otras superficies que construyan `/invite?token=` (ninguna ⛔ **FALSO** — existe
  `docs/marketing/landing-proximamente/invite.html:69`, la página publicada, y es la superficie más
  cercana al invitado; ver §9.1) · que la regla B del guard no dispare con
  el dominio nuevo en minúscula (tiene carve-out de dominios; verde) · apex vs `www` · que el `.test.ts`
  no se auto-reporte en el escaneo del árbol (los `.test.*` están excluidos).
- **Límite honesto**: nada de esto prueba que el link que recibe un invitado real hoy sea el correcto.
  Eso depende del punto 1 de §7, que vive fuera del repo.

---

# 9. Vuelta 2 — los dos defectos del review, cerrados

**Fecha**: 2026-08-11 · review de referencia: `progress/review_invitaciones-dominio.md`
(veredicto CHANGES_REQUESTED). Alcance: **sólo** los dos defectos. El resto de la vuelta 1 no se tocó.

Los dos son la misma falla de método, y es la que este repo ya tiene escrita como regla: **enumeré las
superficies desde el enunciado ("las tres puntas") en vez de desde el árbol**. Por eso quedaron afuera
la punta que el invitado efectivamente usa y el mutante que reproduce la forma del bug histórico.

## 9.1 Defecto 1 — la CUARTA punta: la página publicada

`docs/marketing/landing-proximamente/invite.html:69` arma el link con el origen **hardcodeado**:

```js
var linkCompleto = 'https://mitropero.com.ar/invite?token=' + enc;
```

No sale de `window.location.origin`. Es el string del botón "Copiar el link" — **lo que el invitado
copia y pega en la pantalla de Invitación de la app** cuando "Abrir en la app" no funciona (y hoy nunca
funciona por universal link: los `.well-known/*` siguen en 302, §0). Es la superficie **más cercana al
invitado** de las cuatro, y era la única sin guard.

**No lo heredé del mensaje de commit `0ce6919`: lo medí.** Bajé las dos páginas publicadas y comparé:

```
$ curl -s https://mitropero.com.ar/            -> http=200 bytes=3759
$ curl -s "https://mitropero.com.ar/invite?token=550e8400-…"  -> http=200 bytes=5591

index.html   servido=5652c23456482dcef0031c6ad73f5a9a  repo=5652c23456482dcef0031c6ad73f5a9a  IDÉNTICO
invite.html  servido=ac9318a0b10a565a94efdf2ae98d663d  repo=ac9318a0b10a565a94efdf2ae98d663d  IDÉNTICO
```

md5 exacto, sin normalizar fin de línea. O sea: el archivo del repo **es** producción, y el canonical que
uso de ancla (§9.2) es el que el sitio publica de verdad.

**Qué hice**

1. `invite.html` entra a `INVITE_ORIGIN_SITES` como **cuarto sitio de lectura**, con su `re` y su
   `build` propios (el origen y el path viven en el mismo literal: `re` captura lo que está antes de
   `/invite?token=`, así que un path de más lo rechaza `PURE_ORIGIN` en vez de pasar).
   `OriginSite` ganó un campo `strip?` opcional: para HTML se usa `stripHtmlComments`, que blanquea
   `<!-- … -->` **y después** los comentarios de JS/CSS (el `<script>` de la página es JavaScript, así
   que un literal comentado con `//` tampoco puede engañar al extractor).
   **El `.html` se LEE, no se edita** — quedó escrito en el propio site y en el header de la regla. Los
   dos `.html` están byte a byte como en `HEAD` (`git diff -- docs/marketing/landing-proximamente/`
   vacío; md5 verificado después de los 9 mutantes).
2. **Los conteos, corregidos donde se declaraban** — eran cuatro textos, no dos:
   - `app/src/services/members.ts` — "CUATRO lugares" → **CINCO** (cuatro en el repo + el secret), con
     la página enumerada como punta 4 y el secret movido a la 5. Suma quién es el ancla.
   - `app/src/utils/brand-name-guard.test.ts:31` — "las TRES puntas del repo" → **CUATRO**, con las
     cuatro nombradas y la quinta (el secret) marcada como invisible.
   - `supabase/functions/invite_user/index.ts` — decía "CUATRO puntas" y enumeraba tres + el secret →
     **CINCO**, con la página.
   - `supabase/functions/resend_invitation/index.ts` — enumeraba sin contar y sin la página; ahora la
     nombra.
3. **Y el conteo dejó de ser un comentario suelto**: un test nuevo (`F — el comentario que documenta las
   puntas las NOMBRA a todas`) exige que el comentario de `members.ts` mencione, **por path**, cada
   punta que la regla F realmente mira, más `APP_URL`, más el archivo del ancla. Más un anti-vacío
   (`INVITE_ORIGIN_SITES.length === 4`) para que sacar una punta de la lista no la saque del guard en
   silencio — que es exactamente cómo la página estuvo afuera. Los dos falsificados (M6, M7 abajo).

## 9.2 Defecto 2 — el mutante que sobrevivía: anclar al canonical

El reviewer lo midió: con **las tres puntas movidas juntas** a `https://dominio-que-nunca-compramos.com`
el guard daba **14/14 verde** y la suite entera **3052/3052 verde**. La comparación entre sí no puede
verlo por construcción, y lo único que atajaba el dominio viejo era el literal `/rafq\.ar/i`. Y esa es
**la forma exacta del bug histórico**: las puntas coherentes entre sí, apuntando a un dominio que nunca
se compró.

**Ancla nueva**: `docs/marketing/landing-proximamente/index.html:9` →
`<link rel="canonical" href="https://mitropero.com.ar/">`. No es un literal escrito a mano en el test:
es **el sitio publicado declarando su propio origen** (y §9.1 prueba que el archivo del repo es lo que
el Worker sirve). La regla F ahora tiene un check (2) que compara **cada punta contra ese canonical**.
La barra final del canonical de la raíz se normaliza con una función pura (`canonicalOrigin`) que saca
**una** barra y nada más — cualquier otra forma la rechaza `PURE_ORIGIN`, fail-closed.

**Qué protege y qué no** — escrito en el header de la regla F, no sólo acá:

- **SÍ**: que ninguna punta se separe de las otras ni del origen que el sitio publicado declara.
- **NO**: mover **todo junto** —las cuatro puntas *y* el canonical— a un dominio ajeno sigue pasando en
  verde. Es un límite consciente: nada dentro del repo puede saber qué dominio se compró. Lo único que
  ataja el dominio muerto concreto sigue siendo el literal `DEAD_ORIGIN`.
- **NO**: la quinta punta, el secret `APP_URL` de Supabase (DEV y PROD), que gana sobre los defaults de
  las dos Edge Functions. Este guard verde **no** dice nada sobre el link que sale por mail.

Si el ancla desaparece (alguien borra el canonical), el guard **tira** en vez de degradarse a la
comparación entre sí (M8).

## 9.3 Falsificación — 10 mutantes, uno por vez, restaurando y verificando md5

Runner en el scratchpad (no se commitea): muta → corre el guard → restaura por copia binaria → compara
md5 de los **7** archivos involucrados. Baseline sin mutar: **15/15 verde** (era 14/14; +1 el test del
conteo).

| # | Mutante | Antes | Ahora | Qué check lo mata |
|---|---|---|---|---|
| **M1** | **sólo** `INVITE_BASE_URL` → `https://mitropero.ar` | rojo | **ROJO 13/15** | (2) canonical, nombrando `members.ts`; + F(bis) |
| **M2** | **sólo** `resend_invitation`, con **barra final** | rojo | **ROJO 14/15** | (2), `dice "https://mitropero.com.ar/"` |
| **M3** | las tres + el placeholder → `https://app.rafq.ar` | rojo | **ROJO 14/15** | (1) `DEAD_ORIGIN`, listando las tres |
| **M4** | las tres + el placeholder → `https://dominio-que-nunca-compramos.com` | 🔴 **VERDE 14/14** | **ROJO 14/15** | (2) canonical, listando las tres |
| **M4-bis** | **las CUATRO** + el placeholder, juntas, al mismo dominio ajeno (canonical intacto) | 🔴 verde | **ROJO 14/15** | (2) **y sólo (2)**: el check "entre sí" queda mudo porque las cuatro coinciden |
| **M5** | **sólo** `invite.html` → el dominio viejo | 🔴 **ni siquiera se miraba** | **ROJO 14/15**, `docs/marketing/landing-proximamente/invite.html → https://app.rafq.ar` | (1) |
| **M6** | sacar la punta de la página de `INVITE_ORIGIN_SITES` | 🔴 verde | **ROJO**, `actual: 3, expected: 4` | anti-vacío |
| **M7** | el comentario de `members.ts` deja de nombrar la página | 🔴 verde | **ROJO**, `actual: ['docs/…/invite.html']` | test de enumeración |
| **M8** | borrar el `<link rel="canonical">` de la landing | 🔴 verde | **ROJO**, `[F] no encontré el <link rel="canonical">` | `readCanonicalOrigin` tira |
| **M9** | la página deja de concatenar el token (`+ enc` → `+ token`) | 🔴 verde | **ROJO**, nombrando el `.html` y el regex esperado | (5) `build` — o sea que el check del path no es vacuo sobre el HTML |

**M4-bis es el que justifica el cambio**, más que el M4 del pedido: con sólo las tres movidas, el check
"entre sí" ya se pone rojo (3 contra 1) y no probaría que el ancla hizo algo. Con las **cuatro** movidas
juntas, "entre sí" está mudo y **el único que dispara es el canonical**. El mensaje de fallo lo confirma:
lista las cuatro puntas contra `"https://mitropero.com.ar"`.

**Restauración**: md5 de los 7 archivos idéntico al inicial después de cada mutante y al final. Los dos
`.html` verificados aparte contra `git show HEAD:` — `ac9318a0…` y `5652c234…`, sin cambios.

## 9.4 Barrido de superficies — ahora desde el árbol, no desde el enunciado

`git grep -n -I -E "invite\?token=" -- . ':!*.md'` sobre **todo el repo**. Clasificación completa:

| Clase | Dónde | Cubierto por |
|---|---|---|
| **Puntas que ARMAN el link** (4) | `members.ts:72` · `invite_user:163` · `resend_invitation:85` · `invite.html:69` | regla F, checks (1)-(5) |
| **Muestra el origen, no arma link** (1) | `app/app/invite.tsx:260` (placeholder) | F(bis) |
| **Ancla** | `index.html:9` (`<link rel="canonical">`) | `readCanonicalOrigin`, M8 |
| **Fixtures que NO son oráculo** (2) | `app/e2e/invitations.spec.ts:134` · `app/src/utils/invite.test.ts:23` | ninguno, **a propósito**: el parser es host-agnóstico, así que acoplarlos al origen de producción los volvería un oráculo falso. Los dos lo declaran en su propio archivo |
| **Comentarios / deep-link `rafq://`** | `_layout.tsx:223`, `invite.ts:13,15`, capturas E2E, etc. | N/A (no arman el link de producción) |
| **Fuera del repo** (1) | el secret `APP_URL` de Supabase, DEV y PROD | **nada** — a mano, §7.1 |

`index.html:14` también tiene el origen en un `og:url`. No lo sumé al guard: es coherencia interna del
sitio, no una punta del link de invitación, y el `.html` no se edita desde acá.

## 9.5 Verificación — salida literal

```
$ pnpm typecheck            (desde app/)
> rafaq-app@0.1.0 typecheck C:\DEV\RAFAQ\app-ganado\app
> tsc --noEmit
EXIT_TYPECHECK=0
```

```
$ node --disable-warning=… --import ./scripts/ts-ext-resolver.mjs --test <163 archivos de run-tests.mjs>
ℹ tests 3053
ℹ suites 0
ℹ pass 3053
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 13898.1071
EXIT_UNIT=0
```

3052 → **3053**: +1, el test del conteo/enumeración.

```
$ node scripts/check-hardcode.mjs
[OK]    Anti-hardcode (ADR-023 §4): 0 violaciones en app/app + app/src/components
EXIT_HARDCODE=0
```

Guard solo: **15/15**. Suite **E2E no corrida** (instrucción; re-renderiza `design/**/*.png`).
`git diff --stat` == `git diff -w --stat` → **sin churn de CRLF**.

## 9.6 Lo que NO toqué en esta vuelta

`scheme: 'rafq'` · `ar.rafq.app` · `slug`/`owner`/`projectId` · `eas.json` · `noreply@rafq.ar` · los
prefijos `rafq.*` · `X-Rafaq-Actor` · las GUCs · las env vars `RAFAQ_*` · `specs/**` · `docs/**` (los
dos `.html` **sólo se leen**, md5 verificado) · `progress/**` salvo este archivo. **Ningún deploy.**

Los ítems 5, 6.a (líneas del reporte: corregidas acá) y 7 del §13 del review son del leader:
`specs/active/01-identity-multitenancy/design.md` (el box "CUATRO lugares", que ahora también tiene que
decir cinco y nombrar la página), `tasks.md:113` (`PUBLIC_APP_URL` → `APP_URL`, esa env var no existe) y
`progress/current.md`. Y sigue en pie el bloqueante de §7: **el secret `APP_URL` en DEV y PROD + el
redeploy de las dos Edge Functions**, sin lo cual el mail sigue saliendo con el origen viejo y todo esto
en verde.
