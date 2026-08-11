# Rebrand fase 1 — nombre visible "miTropero"

**Fecha**: 2026-08-10 · **Alcance**: SOLO el nombre visible al usuario en los 4 archivos indicados.
**Fuera de alcance por definición (fase 2)**: identificador de app (`ar.rafq.app`), `scheme: 'rafq'`,
`slug: 'rafaq-app'`, `owner: 'rafaqsorg'`, `projectId`, `eas.json`, `INVITE_BASE_URL`, defaults de
`APP_URL` de las Edge Functions, remitente de Resend, prefijos de storage `rafq.*`, header
`X-Rafaq-Actor`, GUCs `rafaq.*`, `sync-streams/rafaq.yaml`, env vars `RAFAQ_*`, assets, `progress/**`.

Baseline: `b4f25b7` (HEAD al arrancar). Trabajo sobre `main`, sin feature-branch.

---

## 1. Diff resumido por archivo

### `app/app.config.ts` (+7 / −3)
- L34: `name: isDev ? 'RAFAQ (Dev)' : 'RAFAQ'` → `'miTropero (Dev)' : 'miTropero'`.
- L4-5: los comentarios de cabecera que citaban los nombres viejos ahora citan los nuevos.
- L7-9 (nuevo): nota explícita de que el rebrand de fase 1 es SOLO el nombre visible y de por qué los
  identificadores siguen siendo `ar.rafq.app` / `rafaq-app` / `rafq` / `rafaqsorg` (consolas externas).
- **Sin tocar**: `APP_ID`, `slug`, `scheme`, `owner`, `extra.eas.projectId`, plugins, permisos, iconos.

### `app/app.config.test.ts` (+30 / −7)
- Los 3 tests de nombre (`R2.2/R2.4`, `R2.3` ausente, `R2.3` production) esperan ahora `'miTropero (Dev)'`
  / `'miTropero'`, y sus títulos dicen lo mismo que asertan.
- **Sin tocar**: las assertions de `bundleIdentifier`, `package`, `slug`, `scheme`, `owner`, `icon`,
  `favicon`, plugins, permisos, `extra` — siguen fijando `ar.rafq.app`, `rafaq-app`, `rafq`, `rafaqsorg`.
- **Test nuevo** — `rebrand fase 1: NINGUNA variante muestra el nombre viejo, y los ids NO se rebrandean`:
  guard sobre la AUSENCIA (barre `undefined` / `development` / `preview` / `production` y exige que ninguna
  variante contenga `/rafaq/i` en el nombre) + la contracara, que frena a quien "complete el rebrand"
  tocando bundleIdentifier/package/scheme/slug/owner sin pasar por la fase 2. Los asserts sueltos por
  variante no cubren un revert parcial de una sola rama del ternario ni una variante futura.

### `app/app/(tabs)/index.tsx` (+5 / −1)
- L150 (antes 146): wordmark del header de la Home `RAFAQ` → `miTropero`.
- Comentario de L136 actualizado: nombra el wordmark nuevo y deja escrito POR QUÉ el `lineHeight="$7"`
  ahora es obligatorio (el wordmark nuevo tiene descendente en la `p`, el viejo no tenía ninguno).
- **El `Text` ya tenía `lineHeight="$7"` matching el `fontSize="$7"`** → no hizo falta cambiar estilos.
  No tiene `numberOfLines`; conserva `flexShrink={0}` y `marginHorizontal="$2"`.

### `supabase/functions/_shared/email.ts` (+1 / −1)
- L78: `<p>— Equipo RAFAQ</p>` → `<p>— Equipo miTropero</p>`.
- **Sin tocar L21**: `Deno.env.get('RESEND_FROM_EMAIL') ?? 'RAFAQ <noreply@rafq.ar>'` — cambiar el
  remitente rompe el envío hasta que el dominio nuevo esté verificado en Resend (fase 2).

`git status` confirma que el working tree solo tiene esos 4 archivos modificados por esta tarea (lo demás
—`specs/active/10-...`, `docs/marketing/`— es de otra terminal, no lo toqué).

---

## 2. Verificación — salida literal

### `pnpm typecheck` (desde `app/`)

```
> rafaq-app@0.1.0 typecheck C:\DEV\RAFAQ\app-ganado\app
> tsc --noEmit

EXIT_TYPECHECK=0
```

### Tests unitarios que cubren lo tocado — `app/app.config.test.ts`

```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/ts-ext-resolver.mjs --test app/app.config.test.ts

✔ R2.2/R2.4: APP_VARIANT=development → "miTropero (Dev)" + ids ar.rafq.app.dev (2.5683ms)
✔ R2.3: APP_VARIANT ausente → "miTropero" + ids ar.rafq.app (0.2128ms)
✔ R2.3: APP_VARIANT != development (ej. production) → "miTropero" + ar.rafq.app (0.1091ms)
✔ rebrand fase 1: NINGUNA variante muestra el nombre viejo, y los ids NO se rebrandean (0.3624ms)
✔ R2.4: dev y prod tienen ids distintos → coexisten instalados en el mismo device (0.2328ms)
✔ R2.1: preserva slug/scheme/version/owner/eas.projectId (+ orientation/icon/web/permisos) (0.9228ms)
✔ R2.1: preserva plugins OAuth de la feature 19 + expo-sharing (Fase 0) + notifications/router/splash (0.2851ms)
✔ spec 04 / RMV5.8: el config plugin del bastón Bluetooth está enganchado (0.1825ms)
✔ spec 04 / R4.2: `expo-audio` NO se engancha como config plugin (sería pedir el micrófono) (0.3329ms)
✔ R2.5: extra.supabaseUrl eliminado (grep sin consumidores); extra.router/eas conservados (0.3317ms)
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 166.0733
EXIT_TEST=0
```

Otros tests que tocan lo modificado: **ninguno**. Verificado por grep — no hay test (unitario ni E2E) que
asserte el texto del wordmark de la home (`e2e/helpers/ui.ts` lo menciona en un comentario pero ancla la
home al saludo `¡Hola …! 👋`), ni ninguno que asserte el HTML de `sendInvitationAcceptedEmail`.

### `node scripts/check-hardcode.mjs`

```
[OK]    Anti-hardcode (ADR-023 §4): 0 violaciones en app/app + app/src/components
EXIT_HARDCODE=0
```

### Extra — el artefacto buildeado ya sale con el nombre nuevo

`pnpm run e2e:build` (expo export web) → `app/dist/index.html` contiene `<title>miTropero</title>`, que
Expo deriva de `config.name`. Es la confirmación de que el cambio llega al build, no solo al test.

---

## 3. Verificación visual (el punto de riesgo real: la `p` con descendente)

No creé un `.capture.ts` nuevo (el alcance es duro: 4 archivos). Reusé el capture que ya cubre
exactamente esta superficie en su peor caso: **`app/e2e/captures/nombre-establecimiento-largo.capture.ts`**
(header de la home con el nombre de campo MÁS largo → es el escenario donde el wordmark más ancho podría
desbordar o empujar al vecino).

```
pnpm exec playwright test e2e/captures/nombre-establecimiento-largo.capture.ts --config playwright.capture.config.ts
  ok 1 [chromium] › capturas nombre-establecimiento-largo — switch/dropdown ellipsis + Mis campos/editar full @ 412px (9.1s)
  1 passed (13.4s)
```

Capturas (gitignored, para el veto visual del Gate 2.5):
`C:\DEV\RAFAQ\app-ganado\app\e2e\captures\__shots__\nombre-establecimiento-largo\`
- `02-home-switch-ellipsis.png` — home con el wordmark nuevo + nombre de campo largo.
- `03-switch-dropdown-ellipsis.png` — con el dropdown del switch abierto.

**Lo que muestran (mirado a 4× sobre el PNG real, no deducido):**
- **Descendente OK.** La `p` de "miTropero" sale entera y redondeada, sin corte plano. Era el riesgo:
  `fontSize="$7"` (20px) con `lineHeight="$7"` (28px) da holgura de sobra, y el `Text` no está dentro de
  ningún contenedor con alto fijo ni `overflow:hidden`.
- **No desborda.** El avatar sigue completo contra el borde derecho a 412px, con el nombre de campo más
  largo del banco de pruebas. No hay scroll horizontal.
- **A quién le come espacio.** Medido con el Inter Bold real (700Bold.ttf) a 20px / letterSpacing 1:
  `RAFAQ` = **74,63px**, `miTropero` = **100,11px** → **+25,5px**. Ese ancho lo cede el chip del switch
  (`flexShrink:1` + `minWidth:0` + `numberOfLines={1}`), que es el comportamiento diseñado: el wordmark
  es identidad y no encoge. Efecto práctico: un nombre de campo largo trunca ~3-4 caracteres antes que
  con la marca vieja (en la captura: "nombre de campo…"). Un nombre corto no se ve afectado.
- **Sin riesgo de overflow en pantallas más angostas** (aritmética, no medición): piso del header =
  padding 2×16 + switch mínimo (ícono 20 + gaps 16 + chevron 18 + padding 16 ≈ 70, el texto puede ir a 0)
  + wordmark 100 + márgenes 16 + avatar 40 ≈ **258px**. Entra en 320px, el ancho de teléfono más chico.

---

## 4. Autorrevisión adversarial

**(a) ¿El test pasaría igual sin el cambio?** Falsificado de verdad, no razonado: puse el mutante
(`name: isDev ? 'RAFAQ (Dev)' : 'RAFAQ'`) y corrí la suite.

```
✖ R2.2/R2.4: APP_VARIANT=development → "miTropero (Dev)" + ids ar.rafq.app.dev
✖ R2.3: APP_VARIANT ausente → "miTropero" + ids ar.rafq.app
✖ R2.3: APP_VARIANT != development (ej. production) → "miTropero" + ar.rafq.app
✖ rebrand fase 1: NINGUNA variante muestra el nombre viejo, y los ids NO se rebrandean
ℹ tests 10 · pass 6 · fail 4     (EXIT=1)
```

El mutante mata 4 tests, incluido el guard nuevo. Después restauré el archivo desde una copia previa y
verifiqué que el diff quedó idéntico (`git diff --stat` = `git diff -w --stat` = 7 insertions / 3
deletions → sin churn de CRLF).

**(b) ¿Quedó algún `RAFAQ` que debería haber cambiado en los 4 archivos?** No. Lo que queda de "rafaq" en
esos archivos es, en todos los casos, fase 2 deliberada: `slug: 'rafaq-app'`, `owner: 'rafaqsorg'`,
`APP_ID = 'ar.rafq.app'`, `scheme: 'rafq'` (+ sus assertions) y el `RESEND_FROM_EMAIL` default de la L21
de `email.ts`.

**(c) ¿Toqué algo de la lista prohibida?** No. El `git diff` completo son 4 archivos y ninguna de las
líneas prohibidas aparece en él. Los shots del capture y `app/dist/` están gitignored (verificado con
`git check-ignore -v`), y correr el capture **no** dejó churn en `design/**/*.png`.

**(d) Otros vectores que busqué activamente:**
- Consumidores en runtime del nombre (`expoConfig.name`) que rompieran: no hay.
- Tests E2E que asserten el texto del wordmark: no hay (ancla el saludo). El capture, además, logueó y
  navegó de verdad → smoke test de que la home sigue renderizando.
- `app/app.json` residual que pisara el `name` de `app.config.ts`: no existe (migrado en spec 16).
- Test que snapshotee el HTML del mail: no hay; y el envío es best-effort (`no_key`), así que el cambio
  de la firma es inerte para la suite Edge.
- `numberOfLines` o contenedor de alto fijo que truncara el wordmark nuevo: no hay ninguno.

---

## 5. Reconciliación de specs

**Ya estaba hecha por otra terminal durante la sesión** (commit `3406605`, *"docs(marca): cierra el nombre
miTropero y reconcilia el estado de la toma de marca"*). Verifiqué que el código as-built coincide con lo
que dicen las specs, no al revés:

- `specs/active/16-ambientes-y-release/requirements.md` R2.2/R2.3 ya piden **"miTropero (Dev)"** /
  **"miTropero"** con id `ar.rafq.app`, + la nota de rebrand del 10/08/2026 que separa fase 1 de fase 2.
- `design.md` §57 ya muestra `name: IS_DEV ? 'miTropero (Dev)' : 'miTropero'` y la tabla de perfiles EAS.
- `tasks.md` tiene la nota *"Superado por el rebrand (10/08/2026)"* sobre el task original.

Mi implementación coincide literal con eso → **no hay spec que contradiga el código y no edité specs**
(regla de terminales paralelas: no toco archivos que otra terminal está escribiendo). Ninguna spec
documenta el wordmark de la home ni la firma del mail, así que no hay nada más que reconciliar.

---

## 6. Encontrado y NO tocado (queda fuera de alcance — decidir en fase 1b / fase 2)

Estas son las superficies donde el usuario **sigue leyendo "RAFAQ"** después de este cambio. Las dejo
anotadas, no las toqué:

1. 🔴 **`app/src/components/AuthScreenShell.tsx:69` — el wordmark de TODAS las pantallas de auth**
   (login, signup, reset, invitación). Es la primera pantalla del usuario nuevo: hoy queda "RAFAQ" en el
   login y "miTropero" en la home + en el ícono del launcher. Es la inconsistencia más visible del
   estado actual. **Trampa concreta cuando se haga**: ese `Text` tiene `fontSize="$7"` **sin
   `lineHeight`** (L61-70) → si se cambia el string sin agregar `lineHeight="$7"`, la `p` de "miTropero"
   se recorta (el bug recurrente; la home no lo sufre porque ya tenía el `lineHeight` matching).
2. 🟡 **`app/src/utils/invite.ts:134`** — el copy que el dueño manda por WhatsApp:
   `Te invito a sumarte a "<campo>" en RAFAQ. Abrí este link para aceptar: <url>`. Texto saliente,
   visible para el invitado.
3. 🟡 **`app/app/invite.tsx:227`** — subtítulo de la pantalla de invitación:
   `"Te invitaron a un campo en RAFAQ. Creá tu cuenta o iniciá sesión para aceptar."`.
4. 🟡 **`specs/active/19-login-social/external-setup-raf.md:26-27`** — la *OAuth consent screen* de Google
   está dada de alta con el nombre "RAFAQ": es lo que ve el usuario en el diálogo "Iniciar sesión con
   Google". Vive en una consola externa (GCP) → es fase 2 por naturaleza, pero es marca visible.
5. ⚪ **`supabase/functions/_shared/email.ts:21`** — remitente `RAFAQ <noreply@rafq.ar>`. Excluido a
   propósito (rompe el envío hasta verificar el dominio nuevo en Resend). Consecuencia hoy: el mail llega
   **de** "RAFAQ" y firma "— Equipo miTropero". Es feo pero es el trade-off elegido.
6. ⚪ **Comentarios de código** que dicen "RAFAQ" fuera de los 4 archivos (`_layout.tsx`, `animal/[id].tsx`,
   `Button.tsx`, `Card.tsx`, `CategoryBadge.tsx`, `AnimalRow.tsx`, `e2e/helpers/ui.ts`, `babel.config.js`,
   `metro.config.js`, `tamagui.config.ts`, `.npmrc`, …). Prohibidos explícitamente; cero impacto en usuario.
7. ⚪ **Identificadores internos correctamente intactos y que NO deberían cambiarse nunca "por prolijidad"**:
   `rafaq.db` (nombre del archivo SQLite local — cambiarlo le deja la base vieja huérfana a todo device ya
   instalado), `X-Rafaq-Actor`, flags `__RAFAQ_*__`, `RAFAQ_CONFIRM_PROD`, prefijos de storage.

**Recomendación**: la 1 y la 2/3 son fase 1b y son de una línea cada una (más el `lineHeight` de la 1).
Mientras no se hagan, el rebrand se ve a medias en el camino de alta de usuario, que es justo el que ve
alguien nuevo.

---
---

# Vuelta 2 — cerrar la incoherencia (login vs home)

**Fecha**: 2026-08-10 · **Baseline**: `34066055` (HEAD al arrancar; los cambios de la vuelta 1 seguían
sin commitear, así que los diffs de `email.ts` de abajo incluyen la firma del cuerpo que ya era de la
vuelta 1). Trabajo sobre `main`, sin feature-branch.

**Qué cerró**: los 4 puntos que la vuelta 1 dejó abiertos — el wordmark de auth (items 1 del §6), el
copy saliente de WhatsApp (2), el subtítulo de `/invite` (3) y el remitente del mail (5). Después de
esto, **cero superficies de la app dicen el nombre viejo**.

---

## 1. Diff por archivo

### `app/src/components/AuthScreenShell.tsx` (+9 / −3) — la que faltaba de verdad

```diff
-// UpdatePassword: safe-area, fondo $bg, scroll que respeta el teclado, wordmark
-// RAFAQ, título + subtítulo, y un slot para el contenido (form + CTAs). Cero
+// UpdatePassword: safe-area, fondo $bg, scroll que respeta el teclado, wordmark
+// miTropero, título + subtítulo, y un slot para el contenido (form + CTAs). Cero
@@
-            {/* Wordmark de marca (identidad consistente con la home). */}
+            {/* Wordmark de marca (identidad consistente con la home).
+                ⚠️ `lineHeight="$7"` es OBLIGATORIO y matchea el `fontSize="$7"`: "miTropero" tiene
+                DESCENDENTE (la `p`) y el wordmark viejo ("RAFAQ", todo mayúsculas) no tenía ninguno.
+                Tamagui NO aplica el lineHeight del token cuando solo se le da `fontSize` suelto → sin
+                esta línea la `p` sale recortada (el bug recurrente del repo). Mismo par que el
+                wordmark de la home. */}
             <Text
               fontFamily="$body"
               fontSize="$7"
+              lineHeight="$7"
               fontWeight="700"
@@
-              RAFAQ
+              miTropero
```

**Alcance real de este archivo**: NO es "la pantalla de login". `AuthScreenShell` lo componen **12
pantallas** — `(auth)/sign-in`, `(auth)/sign-up`, `(auth)/forgot-password`, `verify-email`,
`update-password`, `cambiar-email`, `invite`, `invitar`, `crear-campo`, `editar-campo`,
`campo-perdido`, `onboarding`. Una línea, doce superficies.

**Sobre el comentario de la L5**: describe literalmente el string que cambié y habría quedado
mintiendo. Lo actualicé (mismo criterio que la vuelta 1 en `app.config.ts` / `index.tsx`). NO hice
barrido de comentarios: los `RAFAQ` de `Button.tsx`, `Card.tsx`, `AnimalRow.tsx`, `_layout.tsx`, etc.
siguen intactos.

### `app/app/invite.tsx` (+1 / −1)

```diff
-        subtitle="Te invitaron a un campo en RAFAQ. Creá tu cuenta o iniciá sesión para aceptar."
+        subtitle="Te invitaron a un campo en miTropero. Creá tu cuenta o iniciá sesión para aceptar."
```
**Sin tocar la L257**: `placeholder="https://app.rafq.ar/invite?token=…"` (prohibido — es el host real
del link, fase 2).

### `app/src/utils/invite.ts` (+1 / −1)

```diff
-  return `Te invito a sumarte a "${establishmentName}" en RAFAQ. Abrí este link para aceptar: ${url}`;
+  return `Te invito a sumarte a "${establishmentName}" en miTropero. Abrí este link para aceptar: ${url}`;
```
Fuente única del texto de la share sheet (lo consumen `invitar.tsx` y `miembros.tsx`).

### `supabase/functions/_shared/email.ts` (+4 / −1 en esta vuelta)

```diff
+// SOLO el nombre para mostrar se rebrandea. La DIRECCIÓN sigue siendo `noreply@rafq.ar`: Resend
+// verifica el DOMINIO del remitente, no el display name — cambiar el nombre no rompe el envío,
+// cambiar el dominio lo rompería hasta verificar `mitropero.com.ar` en Resend (eso es fase 2).
 const FROM_DEFAULT =
-  Deno.env.get('RESEND_FROM_EMAIL') ?? 'RAFAQ <noreply@rafq.ar>';
+  Deno.env.get('RESEND_FROM_EMAIL') ?? 'miTropero <noreply@rafq.ar>';
```
**La dirección `noreply@rafq.ar` NO se tocó.** Con esto el mail deja de llegar "de RAFAQ firmado por
miTropero" (la L78 `— Equipo miTropero` ya venía de la vuelta 1).

### Tests (nuevos / tocados)

- **`app/src/utils/brand-name-guard.test.ts` (NUEVO, 11 tests)** — el guard sobre la AUSENCIA. Ver §4.
- **`app/src/utils/invite.test.ts` (+14)** — un test nuevo sobre el copy saliente: nombra `miTropero`
  con grafía exacta, NO dice el nombre viejo, y NO acepta `MiTropero` / `Mi Tropero` / `mitropero`.
- **`app/e2e/captures/rebrand-wordmark.capture.ts` (NUEVO)** — la captura del login. Ver §3.
- **`scripts/run-tests.mjs` (+10 / −1)** — registra el guard en la lista EXPLÍCITA (sin eso no corre
  nunca, y un guard que no corre da falsa confianza).

---

## 2. Verificación — salida literal

### `pnpm typecheck` (desde `app/`)

```
> rafaq-app@0.1.0 typecheck C:\DEV\RAFAQ\app-ganado\app
> tsc --noEmit

EXIT_TYPECHECK=0
```

### Tests unitarios que cubren lo tocado

```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/ts-ext-resolver.mjs --test \
  app/src/utils/brand-name-guard.test.ts app/src/utils/invite.test.ts

✔ A — ninguna pantalla de app/app + app/src muestra el nombre VIEJO de la marca (339.6678ms)
✔ B — el nombre nuevo se escribe SIEMPRE "miTropero" (mi minúscula, pegado, T mayúscula) (328.4139ms)
✔ C — el wordmark declara lineHeight matching su fontSize (la `p` tiene descendente) (331.7905ms)
✔ E — el remitente de los mails muestra el nombre nuevo y NO rebrandea el dominio (fase 2) (0.8667ms)
✔ PROPIEDAD — revertir CUALQUIERA de las superficies a su forma pre-rebrand pone el guard en ROJO (367.2263ms)
✔ PROPIEDAD (control) — el árbol de HOY no dispara sobre esas mismas superficies (2.1387ms)
✔ el wordmark existe en las DOS superficies de identidad (auth + home), y dice el nombre nuevo (1.5441ms)
✔ AuthScreenShell es el wordmark de TODAS las pantallas de auth (no una copia por pantalla) (229.5615ms)
✔ el guard DETECTA las firmas (no pasa verde por no estar mirando nada) (1.0506ms)
✔ las EXENCIONES son mínimas, están justificadas y siguen VIVAS (88.6201ms)
✔ AUTO-VERIFICACIÓN: el guard escaneó todo el árbol, y los archivos ENTEROS (426.8656ms)
✔ inviteShareMessage: la URL aparece EXACTAMENTE una vez en el mensaje
✔ inviteShareMessage: incluye el nombre del campo y es es-AR (voseo, invitación)
✔ inviteShareMessage: nombra la marca "miTropero" con la grafía exacta y NO dice el nombre viejo
✔ inviteShareMessage: termina con la URL (sink limpio para la share sheet)
ℹ tests 31
ℹ pass 31
ℹ fail 0
```

### Suite unitaria COMPLETA del cliente (la lista explícita de `run-tests.mjs`)

```
ℹ tests 3048
ℹ suites 0
ℹ pass 3048
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 16934.4572
```

### `node scripts/check-hardcode.mjs`

```
[OK]    Anti-hardcode (ADR-023 §4): 0 violaciones en app/app + app/src/components
EXIT_HARDCODE=0
```

### Extra — el artefacto buildeado

`pnpm run e2e:build` → `dist/index.html` contiene `<title>miTropero</title>`. No se genera manifest PWA
(Expo web export no lo emite acá), así que el `<title>` es la única superficie de marca del documento.

### Churn de CRLF

`git diff --stat` == `git diff -w --stat` en los 6 archivos modificados (39 insertions / 8 deletions).
Sin reescritura de líneas.

---

## 3. Captura del login — LO QUE VI, no lo que deduje

Capture nuevo: **`app/e2e/captures/rebrand-wordmark.capture.ts`** (`.capture.ts` se commitea; los
`__shots__/*.png` están gitignored — `app/.gitignore:29`).

```
pnpm exec playwright test e2e/captures/rebrand-wordmark.capture.ts --config playwright.capture.config.ts

[wordmark] {"text":"miTropero","fontSize":20,"lineHeight":"28px","clientHeight":28,"scrollHeight":28,"overflowY":"visible"}
  ok 1 [chromium] › capturas rebrand — el wordmark "miTropero" en auth, con la `p` entera @ 412px (3.6s)
  1 passed (6.4s)
```

Shots en `app/e2e/captures/__shots__/rebrand-wordmark/`, a **deviceScaleFactor 4** (densidad, no zoom:
el layout sigue siendo 412 CSS px):
- `01-login.png` — el login entero.
- `02-login-wordmark-zoom.png` — el wordmark recortado, ~4x.
- `03-sign-up.png` — sign-up con la misma shell.
- `04-invite-auth-required.png` — `/invite?token=…` deslogueado: wordmark + subtítulo rebrandeado.

**Lo que vi mirando los PNG (no deducido):**
- **`01-login.png`**: arriba, centrado y en verde `$primary`, dice **miTropero**. Debajo "Iniciar
  sesión" / "Ingresá con tu email y contraseña." / los dos campos / el CTA verde / el divisor "o" /
  Google + Apple / "Olvidé mi contraseña" / "No tengo cuenta · Registrarme". Ya no queda nada del
  nombre viejo en la pantalla.
- **`02-login-wordmark-zoom.png`**: la **`p` sale entera**. Se ve la panza cerrada y el asta bajando
  por debajo de la línea de base, terminando limpia. No hay corte plano ni pixeles pegados al borde.
- **`04-invite-auth-required.png`**: "Sumate al campo" + "Te invitaron a un campo en **miTropero**.
  Creá tu cuenta o iniciá sesión para aceptar." Envuelve en dos líneas y no se recorta nada.

**Medición de pixeles del recorte** (perfil de filas con tinta del PNG real, umbral de luminancia 180):

```
{"width":500,"height":176,"firstInkRow":55,"lastInkRow":131,"cleanRowsBelow":44}
últimas filas con tinta (y:pixelesOscuros):
108:226 109:224 110:216 111:210 112:202 113:189 114:179 115:159 116:49
117:12 118:12 119:12 120:12 121:12 122:12 123:12 124:12 125:12 126:12 127:12 128:12 129:12 130:12 131:12
```

Se lee así: la línea de base está en y≈116 (el conteo cae de 159 a 49). De ahí para abajo quedan **15
filas con exactamente 12 pixeles** — eso ES el asta de la `p` (12 px a 4x = 3 CSS px, el grosor de un
asta bold a 20 px), y después **44 filas limpias**. El descendente existe, es completo y no toca ningún
borde.

### ⚠️ HONESTIDAD SOBRE LO QUE ESTA CAPTURA **NO** PRUEBA

Falsifiqué el `lineHeight` de verdad (lo saqué, rebuildeé el bundle, re-capturé) y **en WEB el recorte
NO se reproduce**:

| | `lineHeight="$7"` | sin `lineHeight` |
|---|---|---|
| `line-height` resuelto | `28px` | `normal` |
| caja del texto | 28 px | 24 px |
| filas con tinta del glifo | 55→131 (77) | 47→123 (77) |
| descendente | completo | **completo también** |

El perfil de tinta es **idéntico**: `react-native-web` deja `overflow: visible`, así que el glifo pinta
fuera de su caja y no se corta. O sea: **la foto web no puede probar el comportamiento nativo**. Lo que
sí prueban esta captura y su oráculo numérico es que **el token de `lineHeight` está efectivamente
aplicado** (28 px > 20 px de `fontSize`, en vez de `normal`) — que es la condición que en Hermes/Tamagui
decide si la `p` se recorta. El mutante pone el test en **ROJO** (`parseFloat('normal')` → NaN), así que
la captura no es decorativa; simplemente su oráculo es la métrica, no el pixel.

La protección real contra la regresión nativa son las dos juntas: esta métrica + la **regla C** del
guard estático. El veto definitivo en device queda para el QA en el A07 (fuera de esta unidad).

---

## 4. El guard sobre la AUSENCIA (`app/src/utils/brand-name-guard.test.ts`)

La vuelta 1 se hizo **por grep de los archivos que alguien recordó**, y por eso se escapó
`AuthScreenShell`. Un grep enumera lo que ya sabés que existe; el guard enumera el **árbol**. Escanea
los ~370 `.ts`/`.tsx` de `app/app` + `app/src` (blanqueando comentarios con el escáner con estado
compartido `stripSourceComments`), más `supabase/functions/_shared/email.ts`.

| Regla | Qué exige |
|---|---|
| **A** | el nombre VIEJO no aparece en código. Excepciones declaradas con motivo: flags globales `__RAFAQ_*__` de E2E/demo, y `rafaq.db` (archivo SQLite local — renombrarlo deja la base vieja huérfana en todo device instalado). |
| **B** | el nombre nuevo se escribe SIEMPRE `miTropero`. Ni `MiTropero`, ni `Mi Tropero`, ni `mitropero`. Carve-out declarado: un DOMINIO en minúscula (`mitropero.com.ar`) está exento — lo pide el DNS. |
| **C** | el wordmark (`>miTropero<` como texto de un JSX) declara `lineHeight` matching su `fontSize`. **Es la trampa de este rebrand hecha regla permanente.** |
| **E** | el remitente del mail muestra el nombre nuevo **Y** sigue apuntando a `noreply@rafq.ar`. Las dos mitades: la segunda frena a quien "complete el rebrand" cambiando el dominio antes de verificarlo en Resend. |

Además trae, siguiendo el patrón de `today-iso-guard`:
- **PROPIEDAD** — el oráculo **sale del git**, no de la memoria: `git show 34066055:<archivo>` trae el
  cuerpo LITERAL pre-rebrand de las 4 superficies y exige que cada una dispare. Si alguien afloja una
  regla, el cuerpo histórico deja de disparar y el test cae.
- **PROPIEDAD (control)** — la versión arreglada no puede disparar (si no, la regla sería trivial).
- **Anti-vacío** — las dos superficies de identidad (auth + home) tienen que renderizar el wordmark
  exactamente una vez, con `fontSize` y `lineHeight`. Sin esto, borrar los dos wordmarks dejaría A/B/C
  verdes para siempre: prohíben decirlo mal, no obligan a decirlo.
- **AUTO-VERIFICACIÓN** (`assertScanCoverage`) — piso de archivos + balance de llaves + retención, para
  que el guard no pase verde por haberse quedado sin entrada.
- Válvula de escape por línea con razón obligatoria: `brand-name-disable-line -- <razón>`.

Registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs` (con el comentario de por qué existe).

---

## 5. Barrido de la AUSENCIA — todas las superficies que pueden mostrar el nombre

No solo las que decían el nombre viejo: la lista es de **dónde puede aparecer el nombre cara al
usuario**, con veredicto por cada una.

### Dentro de la app (código de este repo)

| # | Superficie | Dónde | Veredicto |
|---|---|---|---|
| 1 | **Wordmark de auth** (12 pantallas: sign-in, sign-up, forgot-password, verify-email, update-password, cambiar-email, invite, invitar, crear-campo, editar-campo, campo-perdido, onboarding) | `src/components/AuthScreenShell.tsx:69` | **Decía el viejo → ARREGLADO** (+ `lineHeight`) |
| 2 | **Wordmark del header de la home** | `app/(tabs)/index.tsx:150` | Dice el nuevo — ya estaba bien (vuelta 1) |
| 3 | **Subtítulo de `/invite`** (fase `auth_required`) | `app/invite.tsx:227` | **Decía el viejo → ARREGLADO** |
| 4 | **Copy saliente por WhatsApp/mail/SMS** | `src/utils/invite.ts:134` | **Decía el viejo → ARREGLADO** |
| 5 | **Remitente del mail transaccional** | `supabase/functions/_shared/email.ts:24` | **Decía el viejo → ARREGLADO** (solo el display name) |
| 6 | **Firma del cuerpo del mail** | `email.ts:81` | Dice el nuevo — ya estaba bien (vuelta 1) |
| 7 | **Nombre de la app en el launcher** + `<title>` del build web | `app.config.ts:34` → `dist/index.html` | Dice el nuevo — ya estaba bien (vuelta 1). Verificado en el artefacto: `<title>miTropero</title>` |
| 8 | **Headers de navegación** (Stack/Tabs) | `_layout.tsx`, `(tabs)/_layout.tsx`, `(auth)/_layout.tsx` | **No lo dice**: `headerShown: false` en los tres. Los `title` de las tabs son secciones ("Inicio", "Animales", "Reportes", "Más"), no marca |
| 9 | **Canal de notificaciones push** (Android) | `src/services/push-notifications.ts:17` | **No lo dice**: el canal se llama `'default'`. Sin título de notificación hardcodeado en el cliente |
| 10 | **Share sheet del export SIGSA** (`dialogTitle`) | `src/services/sigsa/sigsa-export-service.ts:176` | **No lo dice**: `'Compartir archivo SIGSA'` — nombra el sistema destino, no nuestra marca. Correcto así |
| 11 | **Nombre del archivo exportado** | `src/hooks/useExportSigsa.ts:119` | **No lo dice**: `sigsa_<slug>_<AAAAMMDD_HHMMSS>.txt`. El slug es del campo, no de la marca |
| 12 | **Estados vacío / loading / error** de toda la app | barrido completo de `app/app` + `app/src` | **No lo dicen**: cero menciones de marca en copy de error/vacío (verificado por el guard, que escanea el árbol entero) |
| 13 | **Pantalla "Más" / settings** (candidata natural a un "Acerca de") | `app/(tabs)/mas.tsx` | **No lo dice** — y hoy no hay pantalla de "Acerca de"/versión. Cuando exista, nace en rojo si escribe el nombre mal |
| 14 | **Onboarding / bienvenida** | `app/onboarding.tsx:39` | **No lo dice**: "¡Bienvenido, <nombre>!". La marca la pone la shell (#1) |
| 15 | **PWA / manifest web** | `dist/` | **No existe**: Expo web export no emite manifest. Nada que rebrandear |
| 16 | **Suite E2E** (¿algún test asserta el wordmark?) | `e2e/**` | **No**: ningún spec asserta el texto de marca. `helpers/ui.ts` lo menciona en un comentario pero ancla la home al saludo. **Cero regresiones E2E por el cambio de string** |

### Fuera del repo (no tocable acá — se anota, no se arregla)

| # | Superficie | Estado |
|---|---|---|
| 17 | **`app/android/app/src/main/res/values/strings.xml`** → `<string name="app_name">RAFAQ</string>` | **Dice el viejo, pero es artefacto GENERADO y gitignored** (`app/.gitignore:64 /android`). Se regenera de `app.config.ts` en el próximo `expo prebuild`. **Consecuencia práctica hoy**: un `./gradlew assembleDebug` sobre el prebuild que está en disco instala la app con el nombre VIEJO en el launcher. Hay que re-prebuildear antes del próximo build local/QA en device |
| 18 | **OAuth consent screen de Google** (el diálogo "Iniciar sesión con Google") | Dice el viejo. Vive en GCP → fase 2. Ya anotado en la vuelta 1 |
| 19 | **Plantillas de mail de Supabase Auth** (confirmar cuenta, reset de contraseña) | Viven en el dashboard de Supabase, no en el repo (`supabase/config.toml` las tiene comentadas). **Hay que revisarlas a mano**: son mails que recibe todo usuario nuevo. No estaban en la lista de la vuelta 1 |
| 20 | **Listado de App Store / Play / TestFlight** | Externo, fase 2 |
| 21 | **Host del link de invitación** `https://app.rafq.ar/invite?token=…` | Visible para el invitado dentro del mensaje de WhatsApp. **Prohibido en esta vuelta** (`INVITE_BASE_URL` / defaults de `APP_URL`) — fase 2 |

### La quinta superficie que apareció

**Sí, apareció una: la #19 (plantillas de mail de Supabase Auth).** No la pude arreglar desde el repo
(viven en la consola de Supabase, no hay archivo que editar), así que queda **anotada como acción de
Raf**, no como código pendiente. Es la única superficie de marca cara-al-usuario que sigue diciendo el
nombre viejo y que un usuario nuevo ve seguro (el mail de confirmación de cuenta).

Las #17/#18/#20/#21 no son "nuevas": son las que la vuelta 1 ya había clasificado como fase 2 o como
artefacto generado. La #17 sí trae un dato operativo nuevo (hay que re-prebuildear antes del próximo
build Android local).

---

## 6. Autorrevisión adversarial — falsificado, no razonado

### (a) ¿Algún test pasaría igual CON EL BUG PUESTO?

Puse **8 mutantes** en el árbol real, uno por uno, y corrí los tests. Cada mutante se restauró desde
una copia byte-a-byte (`diff -q` contra el backup: OK en los 4 archivos).

| Mutante | Qué se rompió | Resultado |
|---|---|---|
| M1 | wordmark de auth vuelve al nombre viejo | **ROJO** — regla A + PROPIEDAD(control) + anti-vacío (3 fallos) |
| M2 | se saca el `lineHeight="$7"` del wordmark de auth | **ROJO** — regla C + PROPIEDAD(control) + anti-vacío (3 fallos) |
| M3 | grafía `Mi Tropero` en el wordmark | **ROJO** — regla B + PROPIEDAD(control) + anti-vacío (3 fallos) |
| M4 | subtítulo de `/invite` vuelve al nombre viejo | **ROJO** — regla A + PROPIEDAD(control) (2 fallos) |
| M5 | copy de WhatsApp vuelve al nombre viejo | **ROJO** — regla A + PROPIEDAD(control) + `inviteShareMessage: nombra la marca…` (3 fallos) |
| M6 | remitente del mail vuelve al nombre viejo | **ROJO** — regla E |
| M7 | alguien "completa el rebrand" y cambia el DOMINIO a `noreply@mitropero.com.ar` | **ROJO** — regla E (es el guard de fase 2: rompería el envío hasta verificar el dominio en Resend) |
| M8 | se borra la firma `— Equipo miTropero` del cuerpo | **ROJO** — regla E |

Y el mutante del `lineHeight` **también** pone en rojo el capture (`line-height: normal` →
`parseFloat` NaN), como está documentado en §3.

Ninguno de los 8 sobrevivió. Después de restaurar: **31/31 verde**.

### (b) ¿Quedó alguna pantalla diciendo el nombre viejo que un usuario pueda ver?

**Dentro de la app, no.** Verificado por barrido del árbol (regla A del guard sobre los ~370 archivos de
`app/app` + `app/src`, con comentarios blanqueados), no por grep de una lista. Lo que queda de "rafaq"
en el código son, uno por uno:

- `__RAFAQ_BLE_E2E__`, `__RAFAQ_BLE_DEMO__`, `__RAFAQ_BLE_DEMO_ALLOW_E2E__`, `__RAFAQ_E2E__`,
  `__RAFAQ_E2E_MANUAL__`, `__RAFAQ_MANEUVER_FAULT__`, `__RAFAQ_SYNC_REJECT_E2E__`, `__rafaqBle` —
  marcas globales que pone Playwright antes del bundle. Invisibles.
- `rafaq.db` — archivo SQLite local. Renombrarlo deja la base vieja huérfana en todo device instalado.
- Comentarios de código (prohibidos en esta vuelta; blanqueados por el escáner del guard).
- `slug: 'rafaq-app'` / `owner: 'rafaqsorg'` / `ar.rafq.app` / `scheme: 'rafq'` en `app.config.ts`
  (fuera de los roots escaneados, y con su propio guard en `app.config.test.ts` que exige que NO se
  rebrandeen).

**Fuera de la app, sí**: la #19 (mails de Supabase Auth) y la #18 (consent screen de Google). Ver §5.

### (c) ¿Toqué algo de la lista prohibida?

**No.** `git diff` completo = 6 archivos modificados + 2 nuevos. Ninguna de estas líneas aparece en él:
`APP_ID` / `bundleIdentifier` / `package` · `scheme: 'rafq'` · `slug` · `owner` · `projectId` ·
`eas.json` · `INVITE_BASE_URL` · los defaults de `APP_URL` de las dos Edge Functions · el placeholder de
`invite.tsx:257` · los prefijos de storage · `X-Rafaq-Actor` · las GUCs `rafaq.*` ·
`sync-streams/rafaq.yaml` · las env vars `RAFAQ_*` / flags `__RAFAQ_*` · los assets · `progress/**`
(salvo este reporte) · `specs/**`.

Los `__shots__/*.png` y `app/dist/` están gitignored (verificado con `git check-ignore -v`). **No hubo
churn en `design/**/*.png`** (`pnpm e2e:build` solo — no corrí la suite E2E de regresión, que es la que
re-renderiza esos PNG).

### (d) Otros vectores que busqué activamente

- **¿El capture prueba lo que dice que prueba?** No del todo — lo medí y lo documenté en §3 en vez de
  dejarlo implícito. Es el hallazgo incómodo de esta vuelta.
- **¿Algún test E2E de regresión asserta el texto del wordmark?** No (grep sobre `e2e/**`): el cambio de
  string no rompe la suite. `helpers/ui.ts` ancla la home al saludo, no a la marca.
- **¿El guard se auto-reporta?** No: los `.test.*` están excluidos del escaneo, y el nombre viejo se
  arma por concatenación con dos partiduras distintas (+ assert de igualdad), así que un grep de
  aceptación sobre el árbol sigue dando cero.
- **¿El guard puede quedarse ciego?** `assertScanCoverage` (piso de 300 archivos + balance de llaves +
  retención) lo pone rojo si el listado se rompe o si el blanqueo se come archivos.
- **¿Hay un consumidor en runtime del `name` de la config que rompa?** No.
- **¿Se rompe el envío de mails?** No: solo cambió el display name. La dirección y el dominio verificado
  en Resend son los mismos, y la EF es best-effort (`no_key`) mientras no haya key.

---

## 7. Reconciliación de specs

**Nada que reconciliar en `specs/**`, y no las toqué** (otra terminal las está escribiendo):

- `specs/active/16-ambientes-y-release/{requirements,design,tasks}.md` ya están al día con el nombre
  visible (commit `3406605`) y siguen fijando los identificadores de fase 2. Mi implementación coincide.
- Ninguna spec documenta el wordmark de `AuthScreenShell`, el subtítulo de `/invite`, el copy de la
  share sheet ni el remitente de Resend. El copy de invitación que sí aparece en
  `specs/active/01-identity-multitenancy/{design,tasks}.md` está descrito por su ESTRUCTURA
  (`inviteShareMessage(campo, accept_url)`, "el link sale una sola vez"), no por su texto literal → el
  cambio de marca no lo contradice.

---

## 8. Estado del rebrand fase 1 después de esta vuelta

**Cerrado dentro del repo.** Todo lo que la app renderiza, manda o exporta dice `miTropero`, y hay un
guard que escanea el árbol para que la próxima pantalla que lo escriba mal nazca en rojo.

**Queda para Raf (fuera del repo, no es código):**
1. 🔴 **Plantillas de mail de Supabase Auth** (confirmar cuenta / reset de contraseña) — dashboard de
   Supabase. Es la última superficie que ve seguro todo usuario nuevo y sigue diciendo el nombre viejo.
2. 🟡 **OAuth consent screen de Google** — consola de GCP.
3. 🟡 **Re-prebuild de Android** antes del próximo `./gradlew assembleDebug`: el `strings.xml` que hay en
   disco todavía tiene el `app_name` viejo (es generado y gitignored, pero está stale).

**Fase 2 (sin tocar, a propósito):** `ar.rafq.app`, `scheme: 'rafq'`, `slug: 'rafaq-app'`,
`owner: 'rafaqsorg'`, `projectId`, `eas.json`, el host `app.rafq.ar` de los links de invitación, el
dominio `noreply@rafq.ar` de Resend, los prefijos de storage, `X-Rafaq-Actor`, las GUCs `rafaq.*`,
`sync-streams/rafaq.yaml`, las env vars `RAFAQ_*`, `rafaq.db` y los assets.
