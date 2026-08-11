# Review — Rebrand fase 1 "miTropero" (working tree, sin commitear)

**Reviewer**: agente revisor · **Fecha**: 2026-08-10 · **Baseline del diff**: `3406605`
**Unidad**: rebrand fase 1 (nombre visible), vueltas 1 + 2 · **Reporte del implementer**: `progress/rebrand-fase1-nombre.md`

## Veredicto

**APPROVED**

Verificado contra el diff real y contra el árbol, no contra el reporte. Los 4 puntos de riesgo que pidió
el gate —lista dura intacta, completitud, guard no-decorativo, `lineHeight`— se sostienen. Las
observaciones de la sección 7 son no bloqueantes y quedan anotadas para el cierre/backlog.

---

## 1. Alcance real del diff (vs `3406605`)

```
app/app.config.test.ts                 | 35 ++++++++++---
app/app.config.ts                      | 10 +++--
app/app/(tabs)/index.tsx               |  8 ++--
app/app/invite.tsx                     |  2 +-
app/src/components/AuthScreenShell.tsx | 12 ++++--
app/src/utils/invite.test.ts           | 14 +++++
app/src/utils/invite.ts                |  2 +-
scripts/run-tests.mjs                  | 10 ++++
supabase/functions/_shared/email.ts    |  7 ++--
NUEVOS (untracked): app/src/utils/brand-name-guard.test.ts
                    app/e2e/captures/rebrand-wordmark.capture.ts
```

`git diff --stat` == `git diff -w --stat` → **sin churn de CRLF**.

**Ajenos a esta unidad** (otra terminal, presentes desde antes): `specs/active/10-operaciones-rodeo/requirements.md`
(reconciliación as-built de `todayIsoLocal`, sin relación con la marca) y `docs/marketing/kit-capturas.zip`.

---

## 2. Lista dura — ¿se tocó algo prohibido?

Verificado sobre el **diff real** + grep del árbol, no sobre el reporte. **Ninguna violación.**

| Ítem prohibido | Estado en el árbol | Evidencia |
|---|---|---|
| `APP_ID` / `bundleIdentifier` / `package` | `ar.rafq.app` | `app/app.config.ts:26,43,54` |
| `scheme` | `'rafq'` | `app/app.config.ts:36` |
| `slug` | `'rafaq-app'` | `app/app.config.ts:35` |
| `owner` | `'rafaqsorg'` | `app/app.config.ts:117` |
| `projectId` | `d8cf3a19-…` | `app/app.config.ts:114` |
| `eas.json` | **no aparece en el diff** | `git diff --stat 3406605 -- app/eas.json eas.json` → vacío |
| `INVITE_BASE_URL` | `'https://app.rafq.ar'` | `app/src/services/members.ts:45` |
| defaults de `APP_URL` | `'https://app.rafq.ar'` | `invite_user/index.ts:156`, `resend_invitation/index.ts:81` |
| **dirección `noreply@rafq.ar`** | intacta; **solo cambió el display name** | `_shared/email.ts:24` |
| placeholder `app.rafq.ar` de `/invite` | intacto | `app/app/invite.tsx:257` |
| prefijos de storage `rafq.*` | 9 claves intactas | `feedback-pref.ts`, `establishment-store.ts`, `last-rodeo.ts`, `lockout-store.ts`, `pending-invitation.ts`, `rodeo-store.ts`, `remembered-device.ts` |
| header `X-Rafaq-Actor` | intacto | `_shared/supabase.ts:25`, `0124_audit_log.sql:107` |
| GUCs `rafaq.*` | intactas | `rafaq.is_auto_transition`, `rafaq.is_transfer` |
| `sync-streams/rafaq.yaml` | **no aparece en el diff** | `git diff --stat -- sync-streams/` vacío |
| env vars `RAFAQ_*` / flags `__RAFAQ_*` | intactas | `RAFAQ_ENV`, `RAFAQ_CONFIRM_PROD`, `RAFAQ_E2E_BASE_URL`, `__RAFAQ_*__`, `__rafaqBle` |
| assets | no aparecen en el diff | además el icono es el template de Expo, no tiene wordmark |
| `specs/**` | no tocado por esta unidad | el único `M` es de la otra terminal |
| `progress/**` | solo el reporte propio | `progress/rebrand-fase1-nombre.md` |

Además hay **guard de la contracara**: `app/app.config.test.ts` fija `bundleIdentifier`/`package`/`scheme`/
`slug`/`owner`, para que "completar el rebrand" ahí nazca en rojo. Es la protección correcta.

---

## 3. Completitud — barrido independiente del árbol

Barrí yo `app/app`, `app/src`, `supabase/functions`, `supabase/migrations`, `app/plugins`,
`supabase/config.toml`, `app/e2e` y los assets. **Cero superficies cara al usuario dentro del repo dicen
el nombre viejo.** Lo que queda de "rafaq" en el código es, uno por uno:

- **Comentarios** (`index.tsx:1`, `mas.tsx:1`, `animal/[id].tsx` x6, `Button.tsx`, `Card.tsx`,
  `CategoryBadge.tsx`, `AnimalRow.tsx`, `_layout.tsx`, `nav.ts`, `schema.ts`, `local-reads.ts`,
  `supabase.ts`, `export-sigsa.tsx`, `TimelineEvent.tsx`, `FormField.tsx`, `PhoneField.tsx`, `Select.tsx`,
  `ExportAnimalRow.tsx`, `sigsa-export-service.ts`, `bulk-idempotency.ts`) — prohibidos en esta vuelta,
  cero impacto en usuario.
- **Identificadores internos**: flags `__RAFAQ_*__`, `__rafaqBle`, `rafaq.db`, header, GUCs, env vars.
- **Fase 2 declarada**: `slug`, `owner`, `ar.rafq.app`, `scheme`, `app.rafq.ar`, `noreply@rafq.ar`.

Superficies que verifiqué una por una además de las que lista el reporte (no me apoyé en su tabla):

- **Headers de navegación**: `headerShown:false` en `_layout.tsx`, `(tabs)/_layout.tsx`, `(auth)/_layout.tsx`.
- **Notificaciones push**: `push-notifications.ts` no tiene título hardcodeado; el canal se llama `default`.
- **Copy de error / vacío / loading**: cero menciones de marca en todo `app/app` + `app/src`.
- **Mails**: el ÚNICO módulo que compone copy de mail es `_shared/email.ts` (grep de
  `sendViaResend|html:|subject` sobre `supabase/functions/` devuelve solo ese archivo). `invite_user` no
  manda mail: devuelve `accept_url` y el cliente comparte por share sheet.
- **Migraciones**: cero literales de marca en mensajes SQL.
- **`app.json` residual**: no existe (migrado en spec 16) — nada pisa el `name` de `app.config.ts`.
- **Assets**: `icon.png` es el template de Expo (flecha azul), sin wordmark. Nada que rebrandear.
- **`supabase/config.toml`**: las plantillas de mail están comentadas, viven en el dashboard. Confirmado.
- **`app/e2e/`**: ningún spec asserta el texto del wordmark (solo flags `__rafaqBle` y dominios de test
  `@rafaq-e2e.test`). **Cero regresiones E2E por el cambio de string.**

**Fuera del repo — sigue diciendo el nombre viejo** (bien anotado por el implementer, verificado por mí):

1. `app/android/app/src/main/res/values/strings.xml` → `<string name="app_name">RAFAQ</string>`. Confirmado
   gitignored (`app/.gitignore:64:/android`) y **stale**: un `./gradlew assembleDebug` hoy instala con el
   nombre viejo en el launcher. Hay que re-prebuildear.
2. Plantillas de mail de Supabase Auth (DEV y PROD) — dashboard.
3. OAuth consent screen de Google — GCP.
4. App Store Connect / Play / TestFlight — fase 2.

---

## 4. El guard `brand-name-guard.test.ts` — ¿real o decorativo?

**Real.** No me quedé con los 8 mutantes que reporta el implementer: puse **5 míos** sobre el árbol real,
uno por uno, restaurando y verificando por md5 entre cada uno.

| # | Mutante que puse yo | Resultado |
|---|---|---|
| **R1** | dominio del remitente → `miTropero <noreply@mitropero.com.ar>` | **ROJO** — regla E (11 tests, pass 10, fail 1) |
| **R2** | saco `lineHeight="$7"` del wordmark de **auth** | **ROJO** — regla C + PROPIEDAD(control) + anti-vacío (pass 8, fail 3) |
| **R3** | saco `lineHeight="$7"` del wordmark de la **home** (mutante que el implementer NO hizo) | **ROJO** — regla C + PROPIEDAD(control) + anti-vacío (pass 8, fail 3) |
| **R4** | **archivo NUEVO** `app/app/acerca-de-mutante.tsx` con las 3 firmas juntas (nombre viejo en copy, grafía `Mi Tropero`, wordmark sin `lineHeight`) | **ROJO** — A + B + C, cada una nombrando el archivo nuevo con su línea |
| **R5** | revertir `name:` de `app.config.ts` al nombre viejo | **ROJO** — 4 tests de `app.config.test.ts` |

R4 es la prueba de la afirmación central del reporte —que el guard enumera el ÁRBOL y no una lista—, y
salió así:

```
A ... [A nombre viejo (app/acerca-de-mutante.tsx)] app/acerca-de-mutante.tsx:7  <Text>Version 0.1.0 de RAFAQ</Text>
B ... [B grafia "Mi Tropero" (la unica forma es miTropero)] app/acerca-de-mutante.tsx:8
C ... [C wordmark sin lineHeight matching (fontSize=$7, lineHeight=ausente)] app/acerca-de-mutante.tsx:6
```

Tras restaurar: md5 idéntico en los 5 archivos tocados, `git status` idéntico al inicial, 41/41 verde.

**Lo que además hace bien**: el oráculo de la PROPIEDAD sale de `git show 34066055:<archivo>` (no de la
memoria del autor); el anti-vacío impide que borrar los wordmarks deje A/B/C verdes para siempre; las
exenciones exigen motivo escrito y se caen si quedan huérfanas; y está **registrado en la lista explícita
de `scripts/run-tests.mjs`** (un guard que no corre es peor que no tenerlo).

**Gap medido (no bloqueante, sección 7.1)**: los `ROOTS` del guard son `app/app` + `app/src`; de
`supabase/functions/` solo mira `_shared/email.ts`. Lo falsifiqué: creé
`supabase/functions/mutante_test/index.ts` con el texto `Tu cuenta de RAFAQ fue creada.` y el guard dio
**11 tests, pass 11, fail 0**. Hoy es latente (ningún otro EF compone copy de usuario), pero está abierto.

---

## 5. El `lineHeight` de los dos wordmarks

**La conclusión del implementer se sostiene, y su honestidad es la parte correcta del trabajo.**

- Es cierto que **la foto web no puede probar el comportamiento nativo**: `react-native-web` deja
  `overflow: visible` (medido en la propia corrida:
  `{"lineHeight":"28px","clientHeight":28,"scrollHeight":28,"overflowY":"visible"}`), así que el glifo
  pinta fuera de su caja y el perfil de tinta es idéntico con y sin `lineHeight`. Un capture cuyo oráculo
  fuera el pixel habría dado **verde con el bug puesto** — exactamente el defecto recurrente de este repo.
  Reencuadrar el oráculo a la **métrica** (`line-height: 28px` vs `normal` → `parseFloat('normal')` = NaN
  → rojo) es la decisión correcta: deja el capture como evidencia y no como falsa prueba.
- **El riesgo real (nativo) lo cubre la regla C del guard, no la captura.** La regla codifica el fix
  conocido del repo (`feedback_descender_clipping`: `lineHeight="$N"` matching el `fontSize="$N"`), y la
  verifiqué contra los DOS wordmarks (mutantes R2 y R3). Es la protección estructural correcta: una
  pantalla futura con el wordmark nace en rojo si le falta el par.
- **Miré los PNG yo mismo**: en `02-login-wordmark-zoom.png` la `p` sale entera, con la panza cerrada y el
  asta bajando limpia; en `nombre-establecimiento-largo/02-home-switch-ellipsis.png` el wordmark de la home
  muestra la `p` completa y el chip del campo cede con ellipsis, tal como describe el reporte. Coincide con
  lo declarado — **en web**.
- **Residual explícito**: nadie vio "miTropero" renderizado en device. Queda para el QA del A07. No es
  bloqueante para fase 1 (no se está shipeando un build, y el prebuild de Android en disco está stale de
  todos modos), **pero no se puede declarar "el descendente está OK en nativo" hasta ese veto.**

---

## 6. Verificación independiente — salida literal

```
$ pnpm typecheck            (desde app/)
> rafaq-app@0.1.0 typecheck C:\DEV\RAFAQ\app-ganado\app
> tsc --noEmit
EXIT_TYPECHECK=0
```

```
$ <suite unitaria completa del cliente — lista explícita de scripts/run-tests.mjs>
tests 3048
suites 0
pass 3048
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 17752.7874
```

```
$ node scripts/check-hardcode.mjs
[OK]    Anti-hardcode (ADR-023 4): 0 violaciones en app/app + app/src/components
EXIT=0
```

Reproduce exactamente los números del reporte (3048/0). Corridos aparte, los tests de la unidad:
`brand-name-guard` + `invite` + `app.config` = **41 tests, pass 41, fail 0**.

**`node scripts/check.mjs` NO se corrió** — por instrucción del gate (no ensuciar el árbol, no colisionar
con la otra terminal, que escribe sobre la MISMA base DEV y está editando `specs/active/10-*` y
`docs/marketing/` en vivo). Justificación técnica de que no cambia el veredicto: el diff **no toca
migraciones, RPC, policies ni lógica de Edge Functions** (`_shared/email.ts` cambia 1 línea de string y 3
de comentario) y **ninguna suite de `supabase/tests/` asserta ese módulo** (verificado por grep sobre
`supabase/tests/edge/run.cjs`: cero referencias a `email.ts` / `FROM_DEFAULT` / `noreply`). El único
consumidor es `accept_invitation`, y el envío es best-effort (`no_key`). **Antes de commitear conviene
igual una corrida de `check.mjs` cuando la otra terminal libere la base.**

**Suite E2E**: no corrida, por instrucción (re-renderiza `design/**/*.png`). `git status design/` quedó
limpio después de toda mi verificación.

---

## 7. Observaciones — no bloqueantes, pero quedan escritas

1. **Gap de cobertura del guard: `supabase/functions/`.** Los `ROOTS` son `app/app` + `app/src`; del
   backend solo se mira `_shared/email.ts` (regla E). Falsificado: una Edge Function nueva con copy de
   marca pasa **verde**. Hoy es inocuo (ningún otro EF compone copy de usuario), pero el modo de falla que
   el guard existe para cerrar —"una superficie NO estaba en la lista"— sigue abierto de ese lado.
   Sugerencia: agregar `supabase/functions` a `ROOTS` en vez de apuntar a un archivo. No lo pido como
   condición de esta unidad.

2. **`AuthScreenShell.tsx:79` y `:83` — el `lineHeight` que falta al lado del que se arregló.** El título
   (`fontSize="$8"`, línea 79) y el subtítulo (`fontSize="$5"`, línea 83) **no declaran `lineHeight`**. El
   título es un heading >= $6, que es exactamente la clase que describe `feedback_descender_clipping`, y
   renderiza strings con descendente ("Sumate al campo"). **No lo introdujo esta unidad** — esos textos ya
   tenían descendentes antes del rebrand ("campo", "aceptar") —, así que no es regresión y no bloquea. Pero
   el implementer declaró un "barrido de la ausencia" y esto quedó dos líneas debajo del `Text` que sí
   arregló. A `docs/backlog.md`, no a esta unidad.

3. **`docs/marketing/plan-toma-de-marca-mitropero.md` fue editado por el implementer** (marca la fase 1
   como hecha y lista los 3 pendientes de Raf). No está en la lista dura y el contenido es correcto, **pero
   ese archivo lo está escribiendo otra terminal en paralelo**: su diff creció de 12 a 21 líneas durante
   esta review. **Riesgo de colisión al commitear**: stagear selectivo, o reconciliar a mano.

4. **`progress/current.md` está stale** (última entrada 2026-08-07, unidad `ficha-categoria-tacto`). No
   describe esta unidad. Higiene de cierre del leader (CHECKPOINTS C5), no del implementer.

5. **Veto en device pendiente (A07)** + **re-prebuild de Android obligatorio** antes del próximo
   `./gradlew assembleDebug`, o la app se instala con el nombre viejo en el launcher.

6. **Ninguna afirmación del reporte resultó inflada.** Chequeé una por una las falsificables: 3048/0
   (reproducido), `<title>miTropero</title>` en el artefacto, `strings.xml` stale, plantillas de Supabase
   Auth comentadas en `config.toml`, cero E2E que asserten el wordmark, cero tests que asserten el HTML del
   mail, `__shots__` gitignored (`app/.gitignore:29`), `design/` sin churn, y la línea real de cada cambio.
   Todo verificado. La sección 3 del reporte ("HONESTIDAD SOBRE LO QUE ESTA CAPTURA NO PRUEBA") se
   auto-limita en vez de sobrevender: es el estándar que se quiere.

---

## 8. Trazabilidad R-a-test

El contrato vigente es `specs/active/16-ambientes-y-release/requirements.md` R2.2/R2.3 + la nota de rebrand
del 10/08/2026. **No hay `R<n>` nuevo** en esta unidad (es un delta de copy sobre R2.2/R2.3).

| Requisito | Texto de la spec | Test que lo verifica | Estado |
|---|---|---|---|
| **R2.2** | `APP_VARIANT=development` a "miTropero (Dev)" + `ar.rafq.app.dev` | `app/app.config.test.ts` — `R2.2/R2.4: APP_VARIANT=development ...` | verde · mutante R5 lo mata |
| **R2.3** | otro valor / ausente a "miTropero" + `ar.rafq.app` | `app.config.test.ts` — `R2.3: APP_VARIANT ausente ...` y `R2.3: APP_VARIANT != development (ej. production) ...` | verde · mutante R5 los mata |
| R2.2/R2.3 (ausencia) | ninguna variante muestra el nombre viejo; los ids NO se rebrandean | `app.config.test.ts` — `rebrand fase 1: NINGUNA variante muestra el nombre viejo, y los ids NO se rebrandean` | verde |
| R2.1 / R2.4 / R2.5 | preservación de slug/scheme/owner/projectId, coexistencia dev-prod, `extra` | los 4 tests preexistentes de `app.config.test.ts` | verdes, sin tocar |
| Nota de rebrand (fase 1 != fase 2) | el identificador sigue `ar.rafq.app` | `app.config.test.ts` (contracara) + regla E del guard (dominio del remitente) | verde · mutante R1 lo mata |
| Wordmark auth + home (as-built, sin `R<n>`) | — | `brand-name-guard.test.ts` reglas A/B/C + anti-vacío + `rebrand-wordmark.capture.ts` | verde · mutantes R2/R3/R4 los matan |
| Copy saliente de invitación (as-built, sin `R<n>`) | — | `invite.test.ts` — `inviteShareMessage: nombra la marca "miTropero" con la grafía exacta y NO dice el nombre viejo` | verde |
| Remitente + firma del mail (as-built, sin `R<n>`) | — | `brand-name-guard.test.ts` regla E (display name Y dominio Y firma) | verde · mutante R1 lo mata |

**Sin cobertura faltante.**

## 9. Tasks completas

**N/A con justificación.** No es una feature SDD con `tasks.md` propio: es un delta de copy sobre
`specs/active/16-ambientes-y-release`, cuyo `tasks.md` ya trae la nota "Superado por el rebrand
(10/08/2026)" sobre el task original (commit `3406605`). No quedaron `[ ]` sin justificar.

## 10. Exactitud de specs (código a spec)

**Coincide.** Verifiqué la dirección inversa (que el design no quedó mintiendo tras las dos vueltas):

- `requirements.md:29-30` piden literalmente "miTropero (Dev)" / "miTropero" con id `ar.rafq.app`, y el
  código dice exactamente eso (`app.config.ts:34`).
- `requirements.md:32` (nota de rebrand) separa fase 1 de fase 2 y explica por qué el identificador no se
  mueve, coincidiendo con el as-built y con el comentario nuevo de `app.config.ts:7-9`.
- `design.md` seccion 57 muestra el ternario con los nombres nuevos.
- Ninguna spec documenta el wordmark de `AuthScreenShell`, el subtítulo de `/invite`, el copy de la share
  sheet ni el remitente de Resend. El copy de invitación de `specs/active/01-identity-multitenancy/` está
  descrito por **estructura** (`inviteShareMessage(campo, accept_url)`, "el link sale una sola vez"), no
  por su texto literal, así que el cambio de marca no lo contradice. **No hay reconciliación pendiente.**

---

## 11. CHECKPOINTS.md

| # | Checkpoint | Estado |
|---|---|---|
| C1 | Harness completo, `check.mjs` exit 0 | `[x]` archivos y agentes presentes · **`[ ]` `check.mjs` no corrido** (justificado en la sección 6: colisión con la otra terminal sobre la DEV; el diff no toca DB ni lógica de EF, y ninguna suite `supabase/tests/` asserta el módulo cambiado). **Correrlo antes del commit.** |
| C2 | Estado coherente (max 1 `in_progress`) | `[x]` cero features en `in_progress`; la 16 sigue `blocked` |
| C3 | Código respeta la arquitectura | `[x]` solo screens/components/utils/config/functions-shared; sin deps nuevas; sin logs sueltos ni TODOs; cero `establishment_id` hardcodeado |
| C4 | Verificación real | `[x]` 3048/3048 + 11 tests nuevos de guard; 5 mutantes propios, 5 muertos; el oráculo sale de `git show`, no de mocks |
| C5 | Sesión cerrada bien | **`[ ]` `progress/current.md` no describe esta unidad** (obs. 4). `[x]` `__shots__`, `dist/`, `android/` gitignored; `design/` limpio |
| C6 | SDD | `[x]` no es feature nueva; R2.2/R2.3 cubiertos por test; specs al día (sección 10) |
| C7 | Multi-tenant | **N/A** — cero tablas, policies o migraciones en el diff |
| C8 | Offline-first | **N/A** — cero lectura/escritura de datos; solo strings de presentación |
| C9 | E2E + visual (ADR-029) | `[x]` capture file `rebrand-wordmark.capture.ts` con 4 estados clave (login, zoom del wordmark, sign-up, invite deslogueado) · `[x]` `__shots__` NO commiteados (`app/.gitignore:29`) · `[x]` capturas miradas por el reviewer (sección 5) · **`[ ]` suite E2E de regresión no corrida** (instrucción del gate; ningún spec E2E asserta el texto de marca, riesgo de regresión nulo por este diff) · **`[ ]` veto visual en device** (A07, obs. 5) |

---

## 12. Checklist RAFAQ-específico

### A. Tablas con `establishment_id` / RLS — **N/A**
El diff no crea ni modifica tablas, policies ni migraciones. `git diff 3406605 -- supabase/migrations/` vacío.

### B. Carga/edición de datos en campo (offline-first) — **N/A**
Cambio puramente de presentación (strings + un `lineHeight`). No toca repositorios, PowerSync, sync buckets
ni resolución de conflictos.

### C. BLE — **N/A**
Los únicos "RAFAQ" cercanos al BLE son los flags de E2E/demo, **explícitamente preservados** y eximidos en
el guard con motivo escrito.

### D. UI de campo — **aplica parcialmente** (es UI, pero no es un flujo de manga)
- [x] Botones >= 60dp — **sin cambios**: no se tocó ningún control. Verificado en `04-invite-auth-required.png`.
- [x] Fuente >= 18pt — **sin cambios**; el wordmark es `$7` (20px) y el título `$8`, ambos por encima del piso.
- [x] Una decisión por pantalla — **sin cambios** en la estructura de ninguna pantalla.
- [x] Estado de loading visible — **sin cambios**; no se tocó ninguna máquina de estados.
- [x] Regresión de layout por el nombre más largo: "miTropero" (100,11px) es +25,5px vs el wordmark viejo
  (74,63px). Ese ancho lo cede el chip del campo (flexShrink 1 + ellipsis), no el avatar. **Verificado a
  ojo** en `02-home-switch-ellipsis.png` con el nombre de campo más largo del banco a 412px: no desborda,
  no hay scroll horizontal, el avatar entra entero.

### E. Edge Functions — **aplica formalmente, sin cambio de comportamiento**
El único archivo bajo `supabase/functions/` es `_shared/email.ts`: 1 línea de string + 3 de comentario.
- [x] `auth.uid()` al inicio — **sin cambios**; `_shared/email.ts` no es un handler HTTP, no tiene
  entrypoint ni auth.
- [x] Permisos vía `user_roles` — **sin cambios**; el único consumidor (`accept_invitation`) conserva su
  gate intacto (fuera del diff).
- [x] Códigos HTTP + mensaje claro — **sin cambios**; el contrato `EmailResult` (no_key / api_error) no se
  tocó.
- [x] Test verde — **deno test es N/A en este repo**: no hay infraestructura de deno test (la búsqueda de
  archivos de test bajo `supabase/` no devuelve nada); las suites de EF son node
  (`supabase/tests/edge/run.cjs`) y **ninguna asserta este módulo**. La cobertura efectiva del cambio es la
  **regla E del guard**, que sí lo asserta en sus dos mitades (display name rebrandeado Y dominio intacto)
  y que maté con el mutante R1.
- [x] El cambio no rompe el envío: Resend verifica el **dominio** de la dirección, no el display name. La
  dirección no se movió.

---

## 13. Cambios requeridos

**Ninguno bloqueante.** Para el cierre/commit, en este orden:

1. Correr `node scripts/check.mjs` cuando la otra terminal libere la base DEV (C1).
2. Actualizar `progress/current.md` con esta unidad (C5).
3. Al stagear: **excluir `docs/marketing/plan-toma-de-marca-mitropero.md` o reconciliarlo a mano**, porque
   la otra terminal lo está escribiendo (obs. 3). Y no incluir
   `specs/active/10-operaciones-rodeo/requirements.md` ni `docs/marketing/kit-capturas.zip`, que son suyos.
4. A `docs/backlog.md`: el `lineHeight` ausente en `AuthScreenShell.tsx:79` (título `$8`) y `:83`
   (subtítulo `$5`) — obs. 2. Y el `ROOTS` del guard, que deja `supabase/functions/` afuera — obs. 1.
5. A los pendientes de Raf: plantillas de Supabase Auth (DEV **y** PROD), consent screen de Google,
   re-prebuild de Android, y el veto del wordmark en el A07.
