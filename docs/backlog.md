# Backlog

Overflow de scope: ítems que aparecieron durante una sesión pero exceden su objetivo. Se anotan acá para no perderse y se procesan después como feature nueva, ADR, spec o nota informativa.

No es un sustituto de `feature_list.json` ni de los ADRs — es la antesala donde se acumulan cosas pendientes de clasificar.

## Formato

````
## YYYY-MM-DD — <título corto>

**Origen**: sesión X, mientras se trabajaba en Y.
**Qué**: descripción breve.
**Por qué importa**: 1-2 líneas.
**Próximo paso sugerido**: feature nueva en `feature_list.json` / ADR / spec / nada (info).
````

## Ítems pendientes

## 2026-06-04 — ⏰ Keep-alive ping para evitar la pausa por inactividad de Supabase free (HACER PRONTO)

**Origen**: sesión 22, charla de infra al decidir las transiciones por edad (Raf preguntó cómo evitar la pausa).
**Qué**: un proyecto Supabase **free** se **pausa tras 7 días sin requests externos** (los datos quedan; se despausa con un click, pero la app no anda mientras tanto). El `pg_cron` interno **NO** cuenta como actividad. Solución: un **request externo programado** cada 2-3 días que le pegue a un endpoint del proyecto y resetee el timer.
**Por qué importa**: durante dev + beta temprano, evita que el proyecto se pause de la nada (testing de Raf/Facundo). NO reemplaza los backups (eso es Pro, US$25/mes, cuando haya datos de cliente que no se pueden perder).
**Próximo paso sugerido (concreto, listo para ejecutar)**:
- **GitHub Actions** (recomendado): `.github/workflows/keepalive.yml` con `on: schedule: - cron: '0 6 */2 * *'` (cada 2 días) que hace `curl -s "$SUPABASE_URL/rest/v1/<tabla_chica>?select=id&limit=1" -H "apikey: $SUPABASE_ANON_KEY"`. La **anon key** ya es pública (viaja en la app) → no expone secreto; igual conviene meterla como secret del repo. El request cuenta como actividad aunque RLS devuelva 0 filas.
- Alternativa cero-código: `cron-job.org` / UptimeRobot pegándole a la misma URL.
- El leader puede armar el workflow cuando Raf lo pida (es de ~5 líneas). **Marcado "hacer hoy más tarde" por Raf (2026-06-04).**

## 2026-05-28 — Pesaje de ternero: peso al pie vs peso al destete

**Origen**: sesión 15, refinamiento de contexto (Gate 0) de spec 03 MODO MANIOBRAS.
**Qué**: en MVP, pesaje de ternero = pesaje adulto + autocompleta categoría ternero/ternera (vínculo con la madre ya viene de `reproductive_events.calf_id`). Falta modelar peso al pie (lactancia) vs peso al destete como pesajes tipados distintos.
**Por qué importa**: son métricas productivas distintas para analítica de cría; pero la distinción no está validada con Facundo y modelarla a ciegas arriesga rehacer schema.
**Próximo paso sugerido**: refinar con Facundo post-MVP; si se confirma, agregar tipo/contexto al pesaje (posible data_key o columna de contexto en `weight_events`) vía migration, sin reabrir spec 03.

## 2026-05-29 — Estrategia de testing en device real (dev-build) — gap de Expo Go para SDK 56

**Origen**: sesión 17, intento de correr la app en el teléfono de Raf.
**Qué**: el proyecto está en Expo SDK 56 (salió 21-may-2026). Expo Go para SDK 56 **no está en App Store ni Play Store** (sin fecha) → la Expo Go de tienda (SDK 54) no carga el proyecto. Para device real hay 3 opciones: (a) sideload del APK Expo Go SDK 56 en **Android** (vía Expo CLI / expo.dev/go); (b) **iOS** vía TestFlight beta o `eas go` (necesita cuenta Apple Developer US$99/año); (c) **dev-build propio** (expo-dev-client + EAS build o build local) — el camino "correcto" para una app real, no Expo Go.
**Por qué importa**: el veredicto de "primer try" en hardware real (manga, sol, guante) es clave para RAFAQ, y el peón usa Android probablemente. Pero NO bloquea iterar diseño (eso va por web ahora).
**Próximo paso sugerido**: cuando importe device real, decidir entre dev-build (recomendado para app seria, alineado con ADR-013/EAS) vs sideload Android. Por ahora: **web** (`pnpm.cmd web`) para diseño. Sub-decisión latente: ¿quedarse en SDK 56 bleeding-edge o alinear a un SDK con Expo Go en tiendas? (rework si se baja).

## 2026-05-29 — Rollup de resumen por establecimiento (stats de la card "Mis campos")

**Origen**: sesión 17, diseño de la card `EstablishmentCard` (R6.6.2 de spec 01).
**Qué**: la card de cada campo muestra contadores (animales, rodeos) + métrica hero (% preñez último tacto, etc.). Calcularlos en vivo para N campos en el landing es costoso y poco offline-friendly.
**Por qué importa**: con pocos campos beta se computa en vivo sin problema; cuando un vet tenga 15-20 campos, N agregaciones en el landing = lento + mal offline.
**Próximo paso sugerido**: cuando escale, agregar un agregado cacheado por establecimiento (vista materializada o tabla de resumen), refrescado al cerrar una maniobra. No MVP.

## 2026-05-29 — Vista mapa de "Mis campos" (post-MVP)

**Origen**: sesión 17, diseño de "Mis campos".
**Qué**: los `establishments` ya tienen lat/long en el schema → vista mapa de los campos del usuario como alternativa a la lista.
**Por qué importa**: un vet que cubre una zona geográfica vería sus clientes en el mapa (UX potente para multi-campo). El dato ya existe.
**Próximo paso sugerido**: toggle lista/mapa en "Mis campos", post-MVP.

## 2026-05-29 — Benchmarking en la card de "Mis campos" (prender post-beta)

**Origen**: sesión 17, diseño de `EstablishmentCard`.
**Qué**: el slot de comparación ("% preñez 92% · +5 vs zona ▲") ya queda en el layout de la card (R6.6.2) pero VACÍO en MVP — requiere baseline (suficientes campos / datos de zona) que no existe con 1-3 campos beta.
**Por qué importa**: benchmarking es pilar de producto; para el vet con muchos campos, ver cada cliente vs promedio de zona es killer. Pero prometerlo sin datos sería humo.
**Próximo paso sugerido**: encender la comparación cuando haya baseline (post-beta). Posible vista derivada: "ranking de mis campos por % preñez vs zona" para el vet.

## 2026-05-29 — `entry_origin` como enum (analytics)

**Origen**: sesión 17, refi de edge cases de spec 02.
**Qué**: hoy `animal_profiles.entry_origin` es texto libre (ternero al pie usa `'born_here'` hardcodeado). Para analytics de "origen de ingreso" (compra vs nacido vs otro) conviene un enum consistente.
**Por qué importa**: analytics es pilar del producto; texto libre = estadísticas sucias. No bloquea MVP (cría-only, origen mayormente 'born_here' o compra).
**Próximo paso sugerido**: convertir a enum vía migration cuando se aborde el módulo de analytics/reportes (spec 07). NO tocar ahora. (Nota: `exit_reason` SÍ pasa a enum ya, por la decisión de baja/egreso de la misma refi — eso va en el delta backend de spec 02.)

## 2026-05-29 — Pantalla "Mis campos" + landing por rol (selección de establecimiento) — ✅ RESUELTO (misma sesión 17)

**Resolución (2026-05-29)**: Raf decidió la regla → landing por **cantidad de campos** (no por rol): ≥2 campos activos → pantalla "Mis campos" (selector, landing de vets y multi-campo); ==1 → home directa + "Mis campos" accesible vía switch del header. Folded en **spec 01** como `R6.6`–`R6.9` + flujo en `design.md`. No se creó ADR nuevo (es comportamiento de producto/navegación acoplado a la multi-tenancy de spec 01; realiza la mitigación que ADR-018 ya había anotado sobre el switch en el header). Memoria `project-mis-campos-landing` actualizada a "decidido". Se implementa en B.1 (frontend de spec 01).

**Origen**: sesión 17, design review de la home (Stitch). Al decidir reemplazar el menú hamburguesa por un switch de establecimiento en el header, Raf detectó que **nunca diseñamos ni pensamos la pantalla ANTERIOR a la home**: la que lista los establecimientos del usuario antes de entrar a uno.
**Qué**: definir (1) la pantalla **"Mis campos"** (listado de establecimientos donde el usuario tiene rol activo, multi-tenant de spec 01) y (2) **cuál es el landing por rol**:
- **Owner / dueño**: hipótesis = entrar directo a la home del **último campo abierto** (`last_establishment_opened`), con el switch en el header para ir a "Mis campos" manualmente. (Pocos campos, contexto estable.)
- **Veterinario**: hipótesis = el landing principal podría ser **"Mis campos"** directamente, porque probablemente tenga +10 campos para revisar. Pregunta abierta: ¿o también conviene abrirle el `last_establishment_opened` y que navegue al listado vía el switch?
**Por qué importa**: es un hueco de flujo de navegación de nivel app, no un detalle de UI. Afecta a spec 01 (multi-tenant / contexto activo) y al shell de navegación (ADR-018, que ya contempló "promover el switch de establecimiento al header de Inicio" como mitigación). Decidirlo mal obliga a rehacer el arranque de la app. Toca persistir `last_establishment_opened` por usuario.
**Próximo paso sugerido**: refinar en sesión dedicada (probable Gate 0 de contexto). Candidato a ajuste/extensión de spec 01 o nota en su design.md + posible actualización del shell de ADR-018. NO bloquea el design de la home actual: por ahora solo se implementa el **switch entre campos en el header** (reemplaza el hamburguesa); el switch además sirve de feedback de "en qué campo estás parado".

## 2026-05-30 — Stats reales de `EstablishmentCard` (hoy MOCK) + `last_establishment_opened` — backend

**Origen**: sesión 20, build del componente `EstablishmentCard` + preview "Mis campos" (frontend, spec 01 R6.6.2). La card ya está construida y vetada (ver `progress/impl_mis-campos-card.md`), pero alimentada con **mock data**.
**Qué**: la card consume hoy props con datos inventados. Necesitan venir del backend:
- **contadores**: `animalCount` (animales activos por establecimiento) + `rodeoCount` (rodeos por establecimiento).
- **métrica hero adaptativa**: `% de preñez` del último tacto (con período `mmm'aa`) · o `cabezas` + fecha de la última maniobra · o estado "vacío" (sin animales) → CTA. El cliente decide cuál mostrar según qué datos haya.
- **señal de atención** (ej. "tacto pendiente"): deriva de reglas de negocio del campo (tacto vencido, datos sin sincronizar).
- **`last_establishment_opened`** (R6.9, ya **requerido** en la spec): persistencia por usuario del último campo abierto + rastro de últimos visitados (alimenta orden de "Mis campos" R6.6.1, dropdown del switch R6.8.1, landing R6.7). El frontend del incremento 2 lo necesita.
**Por qué importa**: sin estas queries/rollup la card es una maqueta; con ellas es la pantalla de triage del vet multi-campo (pilar producto). Computar N campos en vivo en el landing no escala (ver entrada 2026-05-29 "Rollup de resumen por establecimiento" — misma raíz; este ítem es el corte concreto que la card destrabó).
**Próximo paso sugerido**: sub-tarea de la **terminal/backend** (otra terminal maneja supabase/). Definir la fuente de cada stat (query directa con pocos campos beta / rollup cacheado al escalar) + el almacenamiento de `last_establishment_opened` (columna por usuario o tabla de visitas). Frontend incremento 2 cablea la card a esos datos reemplazando los mocks de `app/app/mis-campos.tsx`.

## 2026-05-30 — Deuda de seguridad pre-existente: `soft_delete_event` omite `has_role_in` (L1)

**Origen**: sesión 20, Gate 1 (security modo spec) del delta Tier 1 de spec 02 (`progress/security_spec_02-modelo-animal.md`, anexo L1).
**Qué**: el RPC genérico `soft_delete_event` (`supabase/migrations/0041_soft_delete_rpcs.sql` ~l.110, **ya mergeado**) autoriza con `is_owner_of(v_est) or v_created_by = auth.uid()` — **omite** el `has_role_in(v_est)` que su hermano `soft_delete_animal_event` sí exige. Es la misma clase del finding SEC-SPEC-01 (autor cuyo rol fue desactivado sigue pudiendo borrar su evento). Quedó **fuera del alcance Tier 1** (no se reabre código ya cerrado en este fold), por eso se asienta acá.
**Por qué importa**: mismo-tenant authz: un usuario removido del establecimiento conserva la capacidad de soft-deletear los eventos que cargó. Bajo impacto (no cross-tenant, requiere haber tenido rol), pero inconsistente con el patrón canónico endurecido.
**Próximo paso sugerido**: al tocar `0041` o en un barrido de hardening, agregar `has_role_in(v_est) and (...)` a la guarda de `soft_delete_event` + test de no-bypass del autor-sin-rol (espejo de T2.18/T2.19). No urgente; no MVP-blocker.

## 2026-06-01 — Build web de producción no inyecta las env `EXPO_PUBLIC_*` (acceso dinámico) → pantalla en blanco

**Origen**: sesión 21, armado de la suite Playwright E2E (agente en worktree, `app/e2e/`). Al hacer `expo export -p web` para servir el estático, la app arrancaba en blanco.
**Qué**: `app/src/utils/env.ts → readPublicEnv(name)` lee `process.env[name]` de forma **dinámica** (índice por variable). `babel-preset-expo` solo **inlinea accesos ESTÁTICOS** (`process.env.EXPO_PUBLIC_FOO`) en el bundle exportado. Resultado: en el export web, `process.env[name]` queda `undefined` → `getEnv()` tira "Faltan variables EXPO_PUBLIC_*" → el cliente Supabase no se crea → **pantalla en blanco**. En `pnpm web` (dev) NO se nota porque ahí `process.env` está poblado en runtime. El harness E2E lo sortea con un `addInitScript` que define `globalThis.process.env.EXPO_PUBLIC_*` antes del bundle (NO toca código de la app).
**Por qué importa**: es un **bloqueante latente del deploy web real**. Y está ACOPLADO a las invitaciones: el `accept_url` apunta a `https://app.rafq.ar/invite?token=` — cuando ese dominio se hostee (build estático), si el bug sigue, el sitio queda en blanco y **los links de invitación no abren**. O sea: arreglar esto es prerequisito para que el deep-link/universal-link de spec 01 Fase 5 funcione en prod (hoy diferido).
**Próximo paso sugerido**: cuando se aborde el deploy web (o junto con el deep-link nativo de Fase 5), cambiar `env.ts` a accesos ESTÁTICOS (`process.env.EXPO_PUBLIC_SUPABASE_URL` etc., explícitos) o leer de `Constants.expoConfig.extra`. Cambio chico y aislado en `src/utils/env.ts` + verificar con `expo export -p web` + servir el estático. NO urgente para el MVP (se itera por `pnpm web` dev), pero NO olvidarlo antes de cualquier hosting web.

## 2026-06-01 — Type-check propio de la suite E2E (`app/e2e/`)

**Origen**: sesión 22, merge de la suite Playwright a main. Al traer `e2e/*` al árbol principal, el `tsc --noEmit` del app levantaba sus `.ts` (Node: `node:fs`/`__dirname`/`ws`/`node:crypto`) y fallaba.
**Qué**: se excluyó `e2e` + `playwright.config.ts` del `app/tsconfig.json` para que `check.mjs` quede verde sin meter `@types/node` en el árbol del app (al estar `node-linker=hoisted`, `@types/node` contaminaría el type-env del RN app y podría enmascarar usos de APIs de Node inexistentes en RN). Consecuencia: el código de los tests E2E hoy **no tiene type-check** (Playwright lo transpila en runtime sin chequear tipos).
**Por qué importa**: los helpers de e2e operan con `service_role` (admin) — un type bug ahí podría pasar silencioso. Bajo riesgo (suite chica + corre verde), pero RAFAQ apunta a "mejor en el primer try".
**Próximo paso sugerido**: agregar `app/e2e/tsconfig.json` con `types: ["node", "@playwright/test"]` (scopeado, sin filtrar a la app) + `@types/node`/`@types/ws` como devDeps + script `e2e:typecheck` (`tsc -p e2e/tsconfig.json --noEmit`). Opcional cablearlo a `check.mjs` (ojo: no debería pegarle a la red). Cuando se active `invitations.spec.ts` post-B.1.3 es buen momento.

## 2026-06-01 — Loop potencial al abrir `/invite?token=` con sesión iniciada (deep-link, DIFERIDO)

**Origen**: sesión 22, activación de `invitations.spec.ts` (E2E). Al hacer `page.goto('/invite?token=…')` (carga fresca) con un usuario ya logueado, el harness reprodujo un loop confirm→accept→confirm.
**Qué**: en una carga fresca, `AuthContext` arranca en `loading` → `invite.tsx` ve `isAuthed=false` → entra en `auth_required` y **persiste el token** (R5.13). Cuando auth resuelve, pasa a `confirm`; pero tras aceptar, el `RootGate` (re-ruteo centralizado R5.13) parece volver a `/invite` por el token persistido (timing del clear vs el guard) → loop. NO se reproduce por el flujo in-app (pegar link desde el wizard / "Pegar link de invitación") porque la sesión nunca cae a `loading` → va directo a `confirm`, sin persistir token. El E2E usa el flujo in-app (también un camino real) y queda verde.
**Por qué importa**: es un bug LATENTE del camino deep-link/universal-link con sesión activa — hoy DIFERIDO (sin dominio `app.rafq.ar`, device-blocked, scheme no asociado). No es MVP-blocker (el camino usable hoy es pegar el link, que anda). Pero hay que arreglarlo ANTES de habilitar deep-links de Fase 5.
**Próximo paso sugerido**: cuando se aborde el deep-link nativo/universal-link, revisar `invite.tsx` + el re-ruteo R5.13 del `RootGate`: no persistir el token si el estado es `loading` (esperar a que auth resuelva antes de decidir `auth_required`), o limpiar/guardar de forma que el accept no vuelva a disparar el re-ruteo. Reproducir con `goto('/invite?token=')` + sesión activa.

## 2026-06-01 — Cambio/verificación de email depende del envío de mails de Supabase (rate-limited) → SMTP propio para escala

**Origen**: sesión 22, E2E de cambio de email. `auth.updateUser({email})` contra el remoto devolvió `over_email_send_rate_limit` (429).
**Qué**: el cambio de email (R2.2) y la verificación de signup (R1.2) usan el **email built-in de Supabase Auth**, que tiene una cuota de envío baja (sin SMTP custom, ~2/hora por proyecto, compartida entre todos los flujos de auth). En el beta con pocos usuarios alcanza; a escala (o en ráfagas de testing) se satura → los usuarios no reciben el mail de verificación/cambio.
**Por qué importa**: el flujo de cambio de email y la verificación de signup son parte del producto; si el envío se rate-limitea, quedan rotos para el usuario final. Resend ya está configurado (notificación al owner, R5.10) pero NO como SMTP de Auth.
**Próximo paso sugerido**: antes de abrir a más usuarios, configurar **SMTP custom (Resend) en Supabase Auth** (Auth → SMTP settings) para que verificación + cambio de email + reset de password salgan por Resend (sin rate-limit del built-in). Cambio de config, sin código. Relacionado: testear el click del link de verificación en E2E necesita un inbox-tool (Inbucket/Mailosaur) — hoy el E2E solo verifica que el viejo email se mantiene (R2.2), no el click del link.

## 2026-06-01 — Mapear errores crudos del backend a copy genérico (cliente + edge functions)

**Origen**: Gate 2 de Fase 6 backend (edge `db_error` devuelve `err.message` de Postgres) y de C1 rodeos (errores `kind:'unknown'` muestran el `message` crudo de PostgREST en `crear-rodeo`/`rodeos`/`editar-plantilla`). LOW, no bloqueante, no explotable, pero es information disclosure de bajo impacto + UX pobre (el usuario ve jerga SQL).
**Qué**: dos clases del mismo patrón — (a) las 8 edge functions devuelven `err.message` crudo en el caso 500 `db_error`; (b) varios services del cliente clasifican errores no-red como `kind:'unknown'` con el `message` del server y la UI lo muestra tal cual.
**Por qué importa**: RAFAQ apunta a "mejor en el primer try" — un error con jerga de Postgres rompe la percepción de calidad. Riesgo de seguridad bajo (cliente autenticado, sin secretos en el message), pero conviene limpiar antes de beta real.
**Próximo paso sugerido**: en el cliente, mapear `kind:'unknown'` a copy genérico es-AR ("No pudimos completar la acción. Probá de nuevo.") en vez de pasar el `message` crudo; en las edge functions, devolver un code estable + copy genérico para 500 (loguear el detalle server-side, no exponerlo). Pasada transversal cuando se pula la capa de errores; no bloquea features nuevas.

## 2026-06-01 — `accessibilityLabel` crudo filtra al DOM en TODAS las pantallas (warning de React en DEV)

**Origen**: fix-loop de C1 rodeos (BUG 2). La causa REAL del toggle que "no respondía" en `pnpm web` era un warning de React — "does not recognize the `accessibilityLabel` prop on a DOM element" — porque se pasaba `accessibilityLabel` crudo a un `Pressable`/`View` de react-native-web (que NO lo traduce a `aria-label` cuando ya hay props ARIA crudas spreadeadas). En DEV ese warning monta el error-overlay/LogBox de Expo, que puede cubrir la pantalla e interceptar toques. En el export de PRODUCCIÓN el overlay no existe → invisible (por eso la E2E, que corre el export, no lo atrapa).
**Qué**: el patrón correcto (web → `aria-label`; native → `accessibilityLabel`) ahora está centralizado en `app/src/utils/a11y.ts` (`switchA11y`/`buttonA11y`, con tests) y aplicado a la SUPERFICIE DE C1 (FieldTemplateToggleList, crear-rodeo, rodeos, editar-plantilla). PERO el mismo leak crudo persiste en muchas otras pantallas fuera de scope: `mas.tsx`, `miembros.tsx`, `mis-campos.tsx`, `invitar.tsx`, `AnimalRow.tsx`, `EstablishmentCard.tsx`, `ShareLink.tsx`, `AuthBits.tsx`, `(tabs)/animales.tsx`, `(tabs)/_layout.tsx`, `EstablishmentSwitcherDropdown.tsx`, `FormField.tsx`. Raf probó esas pantallas en dev y "funcionaban", así que el overlay ahí no bloquea de forma evidente (posición del badge / elementos que sí traducen), pero el warning igual se emite y es deuda real.
**Por qué importa**: un overlay de error en dev degrada el testing manual (fuente recurrente de "no había acción") y es ruido de consola en cada pantalla. Si en algún caso el badge se posiciona sobre un control, lo bloquea (lo que pasó con el toggle). Limpia la base de a11y multiplataforma de una.
**Próximo paso sugerido**: pasada transversal usando `app/src/utils/a11y.ts` (ya existe) en todas las pantallas/componentes listados — reemplazar el `accessibilityLabel`/`accessibilityRole`/`accessibilityState` crudo por `buttonA11y(Platform.OS, …)` / `switchA11y(…)` o el branch web/native. No bloquea features nuevas; ideal antes de beta real o cuando se retome el frontend de spec 09. Idealmente, un lint que prohíba `accessibilityLabel=` literal en `app/app/**`/`app/src/components/**` (análogo al anti-hardcode) para no reintroducirlo.

## 2026-06-01 — Forzar `created_by` no-spoofeable en las tablas de evento (deuda sistémica SEC-SPEC-03)

**Origen**: sesión 22, Gate 1 (security modo spec) de spec 10 (`progress/security_spec_10-operaciones-rodeo.md`, finding H2 / decisión D7). Resuelto en spec 10 vía Path A (corregir la afirmación), no arreglando el sistémico.
**Qué**: las tablas de evento (`sanitary_events` 0027, `reproductive_events` 0026, `weight_events` 0025, `condition_score_events` 0028, `lab_samples` 0029) usan el trigger `tg_set_created_by_auth_uid` (0024, "setea **solo si NULL**") → un cliente puede mandar `created_by` con el id de **otro usuario del mismo establishment** y queda persistido (spoofing **intra-tenant** de autoría). El trigger no-spoofeable `tg_force_created_by_auth_uid` (0043, sobreescribe siempre) existe y ya lo usan `animal_profiles`/`sessions`/`maneuver_presets`, pero las tablas de evento nunca lo adoptaron. La distinción está documentada literal en 0043 (SEC-SPEC-03).
**Por qué importa**: atribución de autoría en datos regulados SENASA — quién cargó cada evento. **NO es brecha cross-tenant** (la RLS sigue impidiendo escribir sobre otro establecimiento); es integridad de auditoría intra-campo. Bajo impacto, pero inconsistente con el patrón ya endurecido en otras tablas. Afecta transversalmente a specs 02/03/09/10 (todas escriben eventos).
**Próximo paso sugerido**: barrido de hardening — cambiar el trigger `BEFORE INSERT` de las 5 tablas de evento de `tg_set_created_by_auth_uid` a `tg_force_created_by_auth_uid` (vía migration nueva, sin reabrir las viejas) + test de no-spoof por tabla (espejo del de `animal_profiles`/sessions). Decisión arquitectónica de Raf (toca backend done de spec 02). NO urgente, NO MVP-blocker.

## 2026-06-04 — `register_birth` sin tope superior de terneros (DoS intra-tenant) — Gate 2 de C3.2, VERIFY-001

**Origen**: Gate 2 (seguridad, modo code) del frontend C3.2 reproductivo (`progress/security_code_02-frontend-c3.2-reproductivo.md`, finding MEDIUM `VERIFY-001`). El frontend pasó PASS (0 HIGH); este es el único punto a verificar y vive en backend.
**Qué**: la RPC `register_birth` (migration `0045`) valida `jsonb_array_length(p_calves) >= 1` pero **no impone tope superior**, e itera el array completo creando `animals` + `animal_profiles` + `birth_calves` por cada elemento en una sola transacción. Un caller **autenticado y con rol** en el establishment podría mandar un `p_calves` gigante (miles de elementos) y forzar miles de inserts atómicos.
**Por qué importa**: es un **DoS intra-tenant** (no cross-tenant, no fuga de datos, no IDOR — la RLS y la derivación de tenant server-side siguen intactas). Bajo impacto real (requiere un caller ya autorizado actuando de mala fe dentro de su propio campo), pero el contrato de la RPC debería acotar el N. El form de C3.2 no es la barrera autoritativa (un atacante saltea la UI y llama la RPC directo).
**Próximo paso sugerido**: en la RPC `register_birth` (migration nueva, sin reabrir 0045), agregar `if v_count > 20 then raise exception ... using errcode='22023'; end if` (un parto de >20 terneros no existe biológicamente; 20 es holgado) + test. Owner del contrato `register_birth` = backend de spec 02. Opcional defensa-en-profundidad: cap blando en la lista de terneros del form (no autoritativo). NO urgente, NO MVP-blocker.

## 2026-06-04 — Barrido de "back robusto" (backOr) en el resto de las pantallas

**Origen**: fix del bug de navegación (`router.back()` con stack vacío) que Raf vio en `pnpm web`, mientras se blindaban las pantallas del flujo ficha/alta/evento (spec 02 frontend).
**Qué**: el helper `app/src/utils/nav.ts` `backOr(router, fallback)` (canGoBack ? back : replace(fallback)) se aplicó SOLO a las 3 pantallas del flujo (`agregar-evento`, `animal/[id]`, `crear-animal`). Quedan `router.back()` "pelados" en: `cambiar-email`, `editar-plantilla`, `editar-campo`, `invite`, `crear-campo`, `crear-rodeo` (back condicional), `maniobra` (modal), `invitar`, `miembros`, `rodeos`.
**Por qué importa**: el mismo escenario (web-refresh / hot-reload / deep-link / cold-start en una ruta profunda → stack vacío → `router.back()` falla silencioso) deja al usuario trabado en cualquiera de esas pantallas. Menos crítico que ficha/alta/evento (no son el flujo de campo más caliente) pero es la misma clase de bug. Nota: `maniobra` es `presentation:'modal'` → su back tiene semántica distinta (cerrar el modal), evaluar caso por caso.
**Próximo paso sugerido**: run chico de implementer — aplicar `backOr` con el fallback correcto por pantalla (la mayoría → `/(tabs)` home o la pantalla de origen lógica). El helper + sus tests ya existen. NO urgente, NO MVP-blocker.

## 2026-06-04 — Flag "Tuvo aborto" en la LISTA de animales (no solo en la ficha)

**Origen**: gating reproductivo C3.2 (frontend), tarea T3 (flag "marquita roja" A2 — dominio Facundo §1). El flag se implementó en la FICHA del animal (`animal/[id].tsx`, derivado de `hasAbortion(timeline)`), pero NO en la fila de la lista.
**Qué**: la fila de la lista (`AnimalRow`) la alimenta la query de la lista de animales (`services/animals.ts`), que hoy NO trae los eventos reproductivos de cada animal. Mostrar el flag "Tuvo aborto" en la lista requiere que la query del listado sepa, por animal, si tiene ≥1 evento `abortion` — un dato extra (subquery / flag agregado / join a `reproductive_events`).
**Por qué importa**: Facundo pidió la marquita roja "en la ficha/lista". En la ficha ya está (el timeline ya se carga); en la lista falta. Verla de un vistazo en la lista ayuda a identificar vacas problemáticas sin abrir cada ficha. No MVP-blocker (la ficha la cubre).
**Próximo paso sugerido**: extender la query de la lista con un flag `had_abortion` por animal (ej. `exists` sobre `reproductive_events` con `event_type='abortion'`, o un campo agregado en la vista/RPC del listado) + render del chip terracota en `AnimalRow` (reusar el patrón `AbortionFlag` de la ficha). Owner = frontend lista (C2) + posible delta de la query. NO urgente.

## 2026-06-04 — Baseline de seguridad: auditoría retroactiva contra el catálogo A–I (9 findings)

**Origen**: sesión de ampliación del `security_analyzer` (Raf pidió cubrir validación de inputs + rate limits, y luego las 9 clases de defecto del nuevo Catálogo A–I). Auditoría one-off del código YA MERGEADO contra el catálogo → reporte completo en **`progress/security_baseline_shipped.md`** (3 HIGH / 6 MEDIUM / 4 LOW, con tablas de inputs/rate-limits/service-role). Los 3 HIGH fueron re-verificados por el leader contra el source.
**Qué (triage de los 9)**:
- **INPUT-1 (HIGH)** — ninguna columna de texto de usuario tiene tope server-side (`varchar(n)`/`CHECK char_length`); los topes viven solo en el cliente (UX, bypasseable vía PostgREST directo). → **spec 13 hardening**.
- **A1-1 (MEDIUM)** — `animals_update` con `with check (true)` (`0022_rls_animals_and_profiles.sql:34-40`) permite a un user del campo A reescribir `tag_electronic`/`sex`/etc. de un animal compartido con el campo B (integridad cross-tenant). → **spec 13 hardening**.
- **F1-1 (MEDIUM)** — buscador (`animals.ts:341` `escapeIlike`): no neutraliza `.():*` de `.or()` (PostgREST filter injection, intra-tenant) + término sin tope de largo. → **spec 13 hardening**.
- **H1-1 (MEDIUM)** — sesión/JWT no se invalida al remover/degradar miembro (sigue válido hasta `jwt_expiry=1h`; RLS lo corta igual, por eso MEDIUM). → **spec 13 hardening**.
- **B1-1 (MEDIUM)** — `err.message` crudo de Postgres al cliente (32 ocurrencias / 8 EFs + `_shared/auth.ts:44`). **YA ESTABA EN BACKLOG** (entrada 2026-06-01 "Mapear errores crudos del backend a copy genérico") — la auditoría lo cuantificó. → se procesa en **spec 13 hardening** (cierra esa entrada).
- **B3-1 (HIGH)** — PII de coworkers (phone+email) legible por cualquier miembro vía PostgREST directo (`0006_rls_users.sql:16-31`, RLS es row-level no column-level). **RESUELTO por LLM Council (2026-06-04, veredicto unánime)**: patrón **D — separar PII de contacto a tabla `user_private` self-only** (las views/RPC/column-grants no protegen el canal realtime/PowerSync; solo la separación física sí). → **feature 14 `14-pii-user-private`** (registrada, Gate 0 escrito en `specs/active/14-pii-user-private/context.md`, pendiente aprobación de Raf). PRIORIDAD: 2º HIGH explotable-hoy; conviene hacerlo ANTES de wire PowerSync (barato ahora, caro después).
- **H2-1 (HIGH→leader lo ve MEDIUM)** — `minimum_password_length = 6` en `config.toml:177` vs 8 en el cliente. → **fix de config** (propuesto a Raf; aplicar también en Auth del proyecto remoto).
- **E2-1 (MEDIUM, latente)** — Edge Functions custom sin rate limit propio; la cadena `invite→accept` dispara Resend+push (denial-of-wallet). Hoy latente (Resend sin `RESEND_API_KEY`); **sube a HIGH al configurar la key**. → candidato a spec 13 o spec propia (requiere tabla `rate_limits` + lógica).
- **E3-1 (MEDIUM)** — captcha OFF + `enable_confirmations=false` (`config.toml`): registro masivo + `requireUser` acepta email no verificado. → **decisión producto/seguridad** (captcha = setup con provider+key; email-confirmation = trade-off UX de campo).
- **E4-1 / I1-1 / C3-1 / CORS-1 (LOW)** — enumeration de membresía; retención/borrado Ley 25.326 sin flujo; tokens en localStorage solo en web (target de verificación); CORS `*` en EFs (cerrar pre-prod). → backlog, no urgentes.
**No auditable hoy (excluido, re-auditar al implementarse)**: C (PowerSync sync rules/Realtime/SQLite-at-rest, no wired), G (BLE spec 04 sin shippear), F2/F3 (import CSV / SSRF, spec 12 sin código). Cruza con las deudas authz ya en backlog (`soft_delete_event` L1 2026-05-30; `created_by` no-spoofeable SEC-SPEC-03 2026-06-01; `register_birth` sin tope VERIFY-001 2026-06-04) — candidatas a barrer en el mismo hardening.
**Por qué importa**: B3-1 e INPUT-1 son explotables HOY solo con un JWT de miembro (no requieren service-role) y son exactamente lo que muerde a una app multi-tenant con datos privados a escala. El resto es defensa en profundidad / pre-prod.
**Próximo paso sugerido**: **feature 13 `13-hardening-seguridad`** (registrada en `feature_list.json`, status `pending`) agrupa el cluster code/DB (INPUT-1, B1-1, A1-1, F1-1, H1-1) por el flujo SDD. B3-1 y E3-1 = decisiones de Raf antes de specear. H2-1/CORS = fix de config.

## 2026-06-04 — Residuales del Gate 1 de spec 13 (para confirmar en Puerta 1)

**Origen**: Gate 1 (security_analyzer modo spec) de la feature 13 (`progress/security_spec_13-hardening-seguridad.md`). El veredicto fue NEEDS_CLARIFICATION por un solo bloqueante (SPEC-HIGH-1, INPUT-1 incompleto → resuelto por el leader vía Path A: ampliar R1 a las ~14 columnas faltantes en el mismo barrido). Estos dos son residuales MEDIUM que la propia spec ya reconoce/escala — NO bloquean Gate 1, pero la Puerta 1 humana los confirma.
**Qué**:
- **A1-1-resto (SPEC-MED-1)**: el fix de `animals_update` (re-validar `has_role_in` en el `with check`) + el trigger 0036 cierran el caso explotable-hoy (animal mono-perfil) y blindan el EID/IDV. Queda un residual: con un animal COMPARTIDO entre campos (perfil en A y en B), un co-tenant de A puede reescribir `sex`/`birth_date`/`breed`/`coat_color` de la fila global que el campo B también ve (acceso legítimo por rol en A; no lo bloquea ninguna policy). Requeriría **column-level write authz** sobre `animals`/`animal_profiles` — scope nuevo, NO se mete en spec 13.
- **H1-1-API (SPEC-MED-2)**: H1-1 (invalidar sesión del target al remover/degradar miembro) depende de que `auth.admin.signOut(userId, scope)` por user-id exista en la versión de `@supabase/supabase-js@2`/GoTrue del proyecto. La spec lo marca como incógnita a verificar al implementar (T16) con escalado obligatorio si no existe (no aceptar el fallback `active:false`-solo sin decisión de Raf).
**Por qué importa**: A1-1-resto es bajo impacto en MVP single-beta (no hay animales compartidos entre tenants aún); sube si se habilita la transferencia (feature 11). H1-1-API puede convertir H1-1 en un blocker de implementación si la API por-user-id no existe.
**Próximo paso sugerido**: A1-1-resto → barrido futuro de column-level write authz (junto con las otras deudas authz: L1, SEC-SPEC-03) cuando se aborde la transferencia o un hardening profundo. H1-1-API → **RESUELTO (2026-06-05)**: `signOut(userId)` no existe en supabase-js@2 y el ban finito se probó empíricamente inefectivo (no revoca el refresh token persistente); se implementó el RPC `revoke_user_sessions` (migración 0072, `DELETE FROM auth.sessions WHERE user_id=target` = signOut-global por user-id, verificado a mano). Queda solo el residual de que el access-token vive ~1h (stateless) cubierto por RLS — aceptable para MEDIUM.

## 2026-06-05 — Limpiar la data de e2e de producción antes del beta de Chascomús (HACER ANTES DE ONBOARDEAR)

**Origen**: deploy de feature 13 (INPUT-1). Al aplicar el CHECK de `tag_electronic` (tope 32), el pre-check encontró 179 animales con tags > 32 chars; resultaron ser fixtures de e2e (`animal_test_<ts>_<rand>_<SUFFIX>`, ej. `animal_test_1780000540101_s33chk_DUPCALF`, y un `120321...` de 36 díg sintético).
**Qué**: el proyecto Supabase **remoto** (prod) tiene ~**1800 `animals` + 747 `animal_profiles` + cientos de eventos de TEST** (de las corridas e2e/seed acumuladas), con tags basura. No es data real. Cuando se onboardee el beta de Chascomús (Facundo + el campo del padre), el cliente arrancaría con su data mezclada con basura de test.
**Por qué importa**: data sucia en prod = analytics sucio (pilar del producto), confusión, y riesgo de que el cliente vea animales fantasma. RAFAQ apunta a "el mejor en el primer try". Además, por culpa de esos tags largos, 2 columnas (`animals.tag_electronic`, `reproductive_events.calf_tag_electronic`) quedaron con su CHECK en `NOT VALID` sin `VALIDATE` (grandfather) y con tope 64 en vez de 32 — una limpieza permitiría validar el constraint y bajar el tope al valor real (15 díg FDX-B + holgura).
**Próximo paso sugerido**: antes del beta real, purgar la data de e2e del remoto (identificable por el prefijo `animal_test_` / emails `@rafaq-test.local` / `bantest_` etc.) con un script de limpieza cuidadoso (respetando FKs: events → profiles → animals → users). Después, opcionalmente, `VALIDATE CONSTRAINT` de los 2 tags + bajar el tope a 32. Coordinar con la suite e2e (que debe limpiar lo suyo; ver si el cleanup de los helpers está fallando y dejando residuo).

## 2026-06-05 — Sumar `deno check` de las Edge Functions al pipeline (`check.mjs`)

**Origen**: Gate 2 de feature 13. Un `serverError` se llamaba sin importar en 2 EFs (`invite_user`/`accept_invitation`) → `ReferenceError` en runtime en todo path 5xx. El bug llegó hasta el Gate 2 (en vez de fallar local) porque **`check.mjs` type-checkea solo el cliente (RN/TS), nunca las Edge Functions Deno**.
**Qué**: las EFs (`supabase/functions/**/index.ts` + `_shared/*`) son Deno/TS y NO tienen type-check en el pipeline. Un import faltante, un símbolo mal escrito o un type error solo se descubre al deployar o en runtime.
**Por qué importa**: las EFs corren con `service_role` (admin) y son la capa de auth/invitaciones — un type bug ahí es serio. Hoy la única red es el Gate 2 (tarde) o el runtime (peor).
**Próximo paso sugerido**: instalar `deno` localmente y sumar `deno check supabase/functions/**/index.ts` a `scripts/check.mjs` (y quizás al hook Stop si es rápido). Ojo: `deno` no estaba en el PATH de la máquina de Raf al cierre de esta sesión — requiere instalarlo. Cazaría imports/símbolos faltantes antes del deploy.
