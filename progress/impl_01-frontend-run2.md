# impl 01-frontend-run2 — pulido de B.1.2 (spec 01)

baseline_commit: 4728a7b42eae961fb13ab4d3b8260c8b3188dc5b

Feature: 01-identity-multitenancy (in_progress). Run 2 = pulido UX + 1 bug sobre código YA EXISTENTE de B.1.2 (Fase 4 establecimientos). NO es feature nueva. Diseño ya decidido (council + design-review); el implementer ejecuta con precisión + tests de lógica pura + autoverificación.

## Plan (6 puntos acotados)
- (a) Fix saludo: saveProfile también escribe auth.user_metadata.name vía updateUser → USER_UPDATED → AuthContext re-lee → home refleja sin reload. [BUG]
- (b) Pill activo del navbar (Material-3): NavTabIcon con fondo $greenLight cuando focused (forma+fondo además de color, WCAG 1.4.1).
- (c) Banner "establecimiento listo" per-campo + dismiss persistido per-usuario (establishment-store + helper shouldShowReadyBanner).
- (d) Micro-feedback al cambiar de campo: pulso ~450ms de fondo $greenLight en el chip del switch del header (sin skeleton, sin animación-dep).
- (e) Subtítulo localidad+rol en dropdown + localidad en EstablishmentCard (desambiguación de campos homónimos). Helpers localityOf + roleLabel.
- (f) Advertir (no bloquear) nombres duplicados al crear/editar campo. Helper hasDuplicateName.

---

## Bitácora por punto

### (a) Fix del saludo (greeting desync) [BUG]
- `app/src/services/establishments.ts` → `saveProfile`: además del UPDATE a `public.users`, ahora
  llama `supabase.auth.updateUser({ data: { name } })` → emite `USER_UPDATED` → el
  `onAuthStateChange` de AuthContext (ya escucha todos los eventos) re-lee `toAuthUser` → la home
  refleja el nombre nuevo SIN reload.
- **Orden decidido**: primero `public.users` (fuente persistente del perfil), después el metadata
  de Auth. Si el UPDATE a `public.users` falla → corto y devuelvo error (no toco Auth → no dejo
  fuentes desincronizadas con un nombre que no llegó a persistirse). Si `public.users` salió OK pero
  `updateUser` falla por red → NO rompo el guardado: devuelvo `ok` (el nombre quedó donde manda el
  perfil; el saludo se re-sincroniza en el próximo cold-start/refresh de sesión). Log de dev
  best-effort si falla (no en producción). Coherente con el `Result` ok/error del resto.
- `// TODO (post-MVP): consolidar fuente única de nombre en public.users vía ProfileContext` dejado
  en el JSDoc de `saveProfile`.
- NO toqué `AuthContext.tsx` — su listener ya maneja `USER_UPDATED` (confirmado leyéndolo). El
  guard `pushRegisteredForUser` evita re-registro de push ante el re-render por USER_UPDATED.
- **Test**: `saveProfile` requiere red (supabase) → no testeable bajo node sin harness. Typecheck
  pasa; lógica documentada. (Consistente con el resto de la capa de servicios.)

### (b) Pill activo del navbar (Material-3) [DISEÑO]
- `app/app/(tabs)/_layout.tsx`: nuevo sub-componente `NavTabIcon({ Icon, color, focused })` — `YStack`
  con `borderRadius="$pill"`, `paddingHorizontal="$3"` (13px), `paddingVertical="$1"` (2px),
  `backgroundColor={focused ? '$greenLight' : 'transparent'}`, ícono lucide a `$navIcon` (24) adentro.
  Los 4 items planos (index/animales/reportes/mas) pasan a `tabBarIcon: ({ color, focused }) =>
  <NavTabIcon .../>`. El FAB central NO se toca.
- **Padding decidido**: `$3` horizontal (pill ~50px ancho, NO 60px de `$4` que apretaría la celda a
  360px) + `$1` vertical (pill ~28px alto, crecimiento mínimo sobre el ícono de 24 → no empuja el
  label; nav content height = 60px tiene headroom). Conservador a propósito para no romper layout.
- Tipado: `color` viene como `ColorValue` del `tabBarIcon` de React Navigation (importé el tipo de
  `react-native`); lucide lo acepta. Comentario de cabecera del archivo actualizado (pill M3 + WCAG
  1.4.1 en vez de "verde vs gris").
- **PARA VETO VISUAL del leader (CDP 360 + 412)**: confirmar que (1) la pill no corta/empuja el label,
  (2) no hay overflow horizontal, (3) no compite con el halo $fabHalo del FAB. Usé `$greenLight`
  (secondary-container del DS) como indicó la spec; si compite con el halo, el leader decide.

### (c) Banner "establecimiento listo" per-campo + dismiss persistido [DISEÑO]
- `app/src/services/establishment-store.ts`: nuevas `loadDismissedBanners(userId)` /
  `addDismissedBanner(userId, establishmentId)` — misma mecánica que el trail (web→localStorage /
  native→SecureStore), key separada `rafq.banner_dismissed.<userId>` (factoricé `safeUser()` para no
  duplicar el saneo de la key). Read-modify-write best-effort, idempotente (no duplica).
- `app/src/utils/establishment.ts`: helper puro `shouldShowReadyBanner(activeId, dismissedIds)`
  (null-safe: sin activo → false; activo no descartado → true; descartado → false). Testeado.
- `app/app/(tabs)/index.tsx`: fuera el `useState(true)` local. Ahora: `dismissedBanners` en estado,
  cargado al montar por `userId` (efecto con cleanup). `bannerVisible = shouldShowReadyBanner(activeId,
  dismissedBanners)`. Al cerrar (✕), `dismissBanner()` persiste el id y actualiza el estado. Como el
  banner se evalúa contra el `activeId` vigente, cambiar de campo lo re-evalúa solo (descartar A no
  afecta B; volver a A no resucita porque está persistido).
- **Gate "solo si falta configurar"**: gateado SOLO por el set de descartados (no hay frontend de
  rodeos spec 02). `// TODO (spec 02 frontend): gatear además por rodeoCount === 0` en el JSDoc de
  `shouldShowReadyBanner`. NO inventé estado de rodeo.

### (d) Micro-feedback al cambiar de campo [DISEÑO]
- `app/app/(tabs)/index.tsx`: pulso de fondo `$greenLight` (~450ms) en el chip del switch del header.
  El chip (`XStack` dentro del `Pressable`) ganó `borderRadius="$pill"` + `paddingHorizontal="$2"` +
  `paddingVertical="$1"` (para que el realce se vea como pill, no bloque cuadrado) y
  `backgroundColor={highlight ? '$greenLight' : 'transparent'}`. El padding está SIEMPRE presente →
  el pulso no mueve el layout.
- **Disparo robusto**: `prevActiveIdRef` (ref con el activeId previo) en vez de un flag de montaje.
  Solo pulsa si `prev` y `activeId` son ambos reales y distintos → NO pulsa en el montaje inicial NI
  cuando el activo "aparece" por primera vez (null→id, carrera de render del contexto). El timeout se
  limpia en el cleanup del efecto.
- **Caso "Mis campos" → home documentado**: `onSelect` hace switch + `router.replace('/(tabs)')` → la
  home MONTA fresca; `prev` arranca null → sin pulso, y está BIEN (el cambio de pantalla completo ya
  es feedback). NO fuerzo el pulso cross-screen.
- **Sin driver de animación**: confirmé que `tamagui.config.ts` NO configura `animations` en
  `createTamagui` → uso el toggle de fondo con `setTimeout` (aparición/desaparición), NO agregué dep.

### (e) Subtítulo localidad+rol (desambiguación) [DISEÑO]
- `app/src/utils/establishment.ts`: `roleLabel(role)` (FUENTE ÚNICA de la etiqueta de rol) +
  `localityOf({ city, province })` (city si existe y no vacía, si no province, '' si ambas faltan).
  Ambos testeados.
- `app/src/components/EstablishmentSwitcherDropdown.tsx`: `SwitcherField` extendido con
  `locality?: string` + `role?: UserRole` (opcionales, no rompen llamadas). Nuevo helper exportado
  `switcherSubtitle(field)` → `"<localidad> · <rol>"`, sin "·" colgando si falta una parte. El `Row`
  pasó de label-1-línea a `YStack` con label + subtítulo opcional (`$3`/$textMuted/ellipsis); mantiene
  `minHeight="$touchMin"`. El activo y los visitados llevan subtítulo.
- `app/app/(tabs)/index.tsx`: el mapeo `recents.map(...)` y el `activeField` ahora incluyen
  `locality: localityOf(e)` + `role: e.role`.
- `app/src/components/EstablishmentCard.tsx`: NUEVA prop `locality?: string` → línea muted `$3` bajo
  el nombre, antes de los contadores, solo si viene (no duplica el rol, que ya está en el `RoleBadge`).
  Refactoricé el `ROLE_LABEL` local del card para que use `roleLabel` de utils (FUENTE ÚNICA, no
  diverge con el switch). `app/app/mis-campos.tsx` pasa `locality={localityOf(est)}`.

### (f) Advertir (no bloquear) nombres duplicados [DISEÑO]
- `app/src/utils/establishment.ts`: `hasDuplicateName(name, existing, excludeId?)` — compara
  trimmed + case + acento-insensitive (`toLocaleLowerCase('es-AR')` + NFD `\p{Diacritic}`); `excludeId`
  excluye el propio campo en edición; nombre vacío → false. Testeado (exacto, case, acentos, trim,
  vacío, lista vacía, excludeId, otro homónimo).
- `app/app/crear-campo.tsx`: `CreateForm` lee `recents` (set accesible) de `useEstablishment()`. Hint
  `InfoNote` (no `FormError` rojo) bajo el FormField de nombre si `hasDuplicateName(name, recents)`.
  Submit NO bloqueado. Copy: "Ya tenés un campo con este nombre. Podés crearlo igual."
- `app/app/editar-campo.tsx`: `EditForm` igual, pero `hasDuplicateName(name, recents, detail.id)`
  (excluye el propio). Copy "...Podés guardarlo igual." En vivo mientras tipea.

---

## Autorrevisión adversarial (paso 8)
Busqué activamente, como revisor hostil:
- **Literales de color/spacing escapados**: lint anti-hardcode 0 violaciones. Todo via tokens
  ($pill/$greenLight/$3/$2/$1) o `getTokenValue` (NavTabIcon lee $navIcon). El `color` de NavTabIcon
  cruza a lucide vía la prop (no es un literal).
- **Edge null/vacío**: `shouldShowReadyBanner` null-safe (sin activo → false); `localityOf` defiende
  null/vacío/espacios y devuelve '' (caller chequea `hasLocality`/`hasSubtitle` → no renderiza "·"
  colgando); `hasDuplicateName('')` → false; dropdown `Row` oculta el subtítulo si viene vacío;
  `EstablishmentCard` oculta la línea de localidad si vacía.
- **Pulso**: limpia su timeout en el cleanup. Reescrito para NO disparar en montaje inicial ni en
  null→id (encontré ESTE bug en la 1ª versión que usaba `didMount` flag — un mount con activeId que
  resuelve un tick tarde habría disparado un pulso espurio; lo cerré comparando contra el activeId
  previo real con un ref).
- **Banner persiste y no resucita**: `addDismissedBanner` es idempotente + persistido per-usuario
  per-campo; el efecto de carga tiene guard `active` para no setear tras unmount; descartar A no toca
  B (test).
- **updateUser no rompe el guardado**: si falla por red, `saveProfile` igual devuelve `ok` (el nombre
  quedó en public.users); orden documentado.
- **Consistencia de rol**: encontré que el card tenía su propio `ROLE_LABEL` → riesgo de divergencia
  con el switch. Lo cerré: card y switch usan `roleLabel` de utils (FUENTE ÚNICA).
- **Tests que pasan por la razón correcta**: los tests de `hasDuplicateName` ejercen exacto/case/
  acento/exclusión real; `shouldShowReadyBanner` verifica el reject (descartado → false) y el per-campo.

## Resultado de check.mjs
`node scripts/check.mjs` VERDE:
- Anti-hardcode (ADR-023 §4): 0 violaciones.
- typecheck client OK.
- Tests: 80 + 17 + 26 + 28 (animal) + 13 (maneuvers) — All tests passed. La suite de utils
  establishment subió de 23 → 41 tests (18 nuevos: roleLabel, localityOf×4, hasDuplicateName×8,
  shouldShowReadyBanner×4). 0 fail.
- "Entorno listo."

## TODOs dejados
- `// TODO (post-MVP): consolidar fuente única de nombre en public.users vía ProfileContext`
  (establishments.ts / saveProfile).
- `// TODO (spec 02 frontend): gatear además por rodeoCount === 0` (utils / shouldShowReadyBanner).

## Para el veto VISUAL del leader (CDP, no lo corro yo)
- (b) Pill del navbar a 360 y 412: que NO corte/empuje el label, sin overflow horizontal, sin
  competir con el halo $fabHalo del FAB. Padding `$3`/`$1` elegido conservador; si a 360 empuja el
  label, prioridad = label no cortado.
- (d) Pulso del chip del switch: que se vea como realce pill prolijo (no bloque cuadrado) y se
  desvanezca limpio a ~450ms.
- (e) Subtítulo del dropdown: que la 2da línea no rompa el target ≥$touchMin ni desalinee el ícono.

## Archivos NO míos (parallel terminals — NO tocar)
`scripts/check.mjs`, `.claude/settings.json`, `progress/current.md`, `specs/active/04-*` aparecen
como `M` en git pero NO los edité (modificaciones de otra terminal / leader). Mi cambio es solo el
código de los 6 puntos + tests + esta bitácora.
