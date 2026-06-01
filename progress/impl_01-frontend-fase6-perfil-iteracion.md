baseline_commit: 063ab798ef21a76a93d7071e1a8fd860e351de85

# Implementación — Fase 6 perfil: iteración de UX (spec 01)

Feature: `01-identity-multitenancy` (in_progress). Iteración de UX + validación de la sección
**Perfil** de "Más" (Fase 6), a partir del feedback de Raf probando en web. **Frontend only** — el
backend (edge `delete_account`, RPC `delete_account_tx` migración 0058, deploy) está hecho y NO se
toca.

> Baseline Gate 2: `063ab79` (mismo SHA que los runs previos de Fase 6 — multi-sesión, NO se
> sobreescribe). Esta iteración es el delta de UX sobre la Fase 6 ya gateada.

## Los 4 fixes (decisiones de diseño dadas — fundamentadas en Mobbin)

### Fix 1 — Resetear la edición al salir de la pantalla
- `ProfileSection` (`mas.tsx`): `useFocusEffect` (de expo-router) con callback memoizado
  (`useCallback([])`) cuyo cleanup hace `setEditing(false)`. Al perder foco (blur — el tab queda
  montado), se descarta la edición sin guardar; al volver, modo lectura. El setter funcional sin
  dep de `editing` → el efecto no se re-suscribe en cada toggle. La pantalla de email es ruta aparte
  → se descarta sola (mount nuevo).

### Fix 2 — Validación profesional de teléfono y nombre (validadores PUROS + tests)
- `app/src/utils/validation.ts`:
  - `sanitizePhoneInput(raw)` — PURA: filtra a SOLO dígitos + separadores permitidos (`+ - ( ) ` y
    espacio) y recorta a `PHONE_MAX_LENGTH` (20). Las letras NO pueden quedar en el campo. Se engancha
    en el `onChangeText` del teléfono.
  - `phoneDigits(phone)` — PURA: extrae solo dígitos (base de la validación por largo).
  - `isValidPhone(phone)` — fortalecida: ahora exige **8 a 15 dígitos** (rango E.164), antes solo
    `>=8`. Sigue usándose en `crear-campo.tsx` (R3.8) — copy alineado a "8 a 15 dígitos".
  - `isValidPersonName(name)` — nueva: no vacío tras trim **y** `<= NAME_MAX_LENGTH` (80).
  - `validateProfile` — refactorizada: usa `isValidPersonName` (nombre req + max 80) +
    `isValidPhone` (8–15 díg si no-vacío; vacío = OK → null). Copy: "Ingresá tu nombre." /
    "Ingresá un teléfono válido (8 a 15 dígitos)."
  - `validateNewEmail({newEmail,currentEmail})` — nueva PURA: formato + distinto del actual
    (case/whitespace-insensible). La usa la pantalla de email.
- `app/src/components/FormField.tsx`: agregada prop `maxLength` (delega en el `maxLength` nativo del
  TextInput). Se usa en el nombre (80) y el teléfono (20) del perfil.
- `app/src/utils/validation.test.ts`: tests de los nuevos validadores (ver Trazabilidad). El archivo
  ya estaba enganchado en `scripts/run-tests.mjs` (client unit tests) — no hace falta tocar el runner.

### Fix 3 — Pantalla DEDICADA de cambio de email (Mobbin CVS Health / Gopuff)
- `app/app/cambiar-email.tsx` (NUEVA ruta autenticada): título "Cambiar email", muestra el email
  actual (`useProfile().profile.email`), campo "Nuevo email" (valida con `validateNewEmail`), copy de
  verificación ANTES de enviar ("Te vamos a mandar un mail de verificación al nuevo. Tu email actual
  sigue activo hasta que lo confirmes."). Primario "Cambiar email" → `changeEmail()`; tras OK, estado
  de confirmación ("Te mandamos un mail a X. Confirmá desde ahí…") + "Volver". Secundario "Cancelar"
  → `router.back()`. Maneja `email_taken`/`invalid`/`network`/`unknown` reusando el reason tipado de
  `account-result.ts`. Reusa `AuthScreenShell` + `FormField` + `Button` + `FormError` + `InfoNote`.
- `app/app/_layout.tsx`: registrada `<Stack.Screen name="cambiar-email" />`. Como `editar-campo`, NO
  está en `strandedOnGatingRoute` → el gate no la expulsa a `(tabs)` mientras se cambia el email.
  Reachable solo desde `(tabs)` (estado `active`).
- `EmailChangeForm` (el form inline que vivía bajo el Guardar/Cancelar del perfil) **eliminado** de
  `mas.tsx`. Su lógica vive ahora en la pantalla dedicada (no duplicada).

### Fix 4 — IA de la vista de perfil (filas con acción; email en su fila → pantalla)
- `ProfileSection` (`mas.tsx`): modo lectura = filas Nombre / Email / Teléfono.
  - Nombre + Teléfono → se editan JUNTOS con "Editar perfil" (`ProfileEditForm`, ahora SIN email).
  - Email → `EmailRow` (componente nuevo en `mas.tsx`): label + valor a la izquierda, link "Cambiar"
    a la derecha (estilo "Update/Editar" de KOHO/Airbnb) que navega a `/cambiar-email`. NO form inline.
  - Badge "Verificado" (CheckCircle2 $primary) al lado del label del email cuando
    `useAuth().state.emailVerified` (Ubank/Acorns). Mini-chip, no recarga la fila.

## Archivos creados / modificados

### Creados
- `app/app/cambiar-email.tsx` — pantalla dedicada de cambio de email (Fix 3).

### Modificados
- `app/src/utils/validation.ts` — `sanitizePhoneInput`, `phoneDigits`, `isValidPersonName`,
  `validateNewEmail` (nuevos); `isValidPhone` fortalecida (8–15 díg); `validateProfile` refactorizada;
  constantes `PHONE_MIN_DIGITS`/`PHONE_MAX_DIGITS`/`PHONE_MAX_LENGTH`/`NAME_MAX_LENGTH`.
- `app/src/utils/validation.test.ts` — tests de los validadores nuevos/fortalecidos (Fix 2).
- `app/src/components/FormField.tsx` — prop `maxLength` (delega en el TextInput nativo).
- `app/app/(tabs)/mas.tsx` — Fix 1 (reset-on-blur con useFocusEffect), Fix 4 (EmailRow + IA),
  ProfileEditForm sin email + phone sanitizado + maxLength; eliminado `EmailChangeForm`; imports
  ajustados (sale `changeEmail`/`isValidEmail`, entra `useFocusEffect`/`CheckCircle2`/`sanitizePhoneInput`/
  `NAME_MAX_LENGTH`/`PHONE_MAX_LENGTH`).
- `app/app/_layout.tsx` — registrada `<Stack.Screen name="cambiar-email" />`.
- `app/app/crear-campo.tsx` — copy del error de teléfono alineado a "8 a 15 dígitos" (semántica nueva
  de `isValidPhone`). Sin cambio de comportamiento más allá del tope superior ya cubierto por el util.

## Verificación

- `cd app && pnpm.cmd typecheck` → **OK** (limpio).
- `node scripts/check-hardcode.mjs` → **OK** (0 violaciones en app/app + app/src/components).
- `node scripts/check.mjs` COMPLETO → **TODO VERDE**: anti-hardcode 0 · client unit **128/128**
  (incluye los nuevos de validación) · RLS 17/17 · Edge 36/36 · Animal 28/28 · Maniobras 13/13.

## Trazabilidad (R<n> → archivo:test)

- **R2.1 (editar nombre, teléfono; email)** →
  - Nombre/teléfono: `validation.test.ts::"R2.1 validateProfile…"` (nombre req + max 80; teléfono
    opcional 8–15 díg; bordes <8/>15) · `"R2.1 isValidPersonName…"` (vacío/solo-espacios/max 80) ·
    `"R3.8/R2.1 isValidPhone…"` (8/15/16 díg, letras→0, formato AR) · `"R2.1 phoneDigits…"` ·
    `"R2.1 sanitizePhoneInput…"` (letras descartadas al tipear, separadores conservados, recorte a
    max). UI: `mas.tsx` ProfileEditForm (sanitize en onChangeText + maxLength) + EmailRow.
  - Email editable (acción "Cambiar"): `validation.test.ts::"R2.1/R2.2 validateNewEmail…"` (formato +
    distinto del actual) + `account-result.test.ts::"changeEmail error: …"` (5 casos del clasificador) +
    `mas.tsx` EmailRow → `cambiar-email.tsx`.
- **R2.2 (cambio de email → verificación, mantener viejo hasta confirmar)** →
  `cambiar-email.tsx` (dispara `changeEmail` = `auth.updateUser({email})` = doble-confirmación nativa;
  el display lee `profile.email` = session = viejo hasta confirmar; copy explícito antes y después del
  envío) + `account-result.test.ts` (clasificación de errores). Comportamiento "mantener viejo" es
  nativo de Supabase — verificado por razonamiento del flujo (igual que el run previo).

> Cobertura: los validadores son lógica PURA testeada con node:test. La UI con estado (reset-on-blur,
> navegación a la pantalla de email, render del badge) se verifica por razonamiento del flujo + el
> oráculo de Raf en web (patrón del proyecto para flujos de render). No hay infra de render-testing.

## Autorrevisión adversarial (paso 8)

Pasada crítica buscando desviaciones del spec, bugs/edge-cases, gaps de seguridad/multi-tenant y tests
que pasan por la razón equivocada.

1. **¿El teléfono rechaza letras AL TIPEAR?** — `onChangeText={(t)=>setPhone(sanitizePhoneInput(t))}`:
   `sanitizePhoneInput` filtra a `[\d+\-() ]` antes de tocar el state → las letras NUNCA quedan en el
   campo (no solo en el submit). Cubre paste (ej. "tel: abc123" → "123"). Test dedicado. ✓
2. **¿El reset-on-blur descarta sin loops?** — `useFocusEffect(useCallback(()=>()=>setEditing(false),
   []))`: callback estable (dep `[]`) → no re-suscribe; cleanup en blur; setter funcional → no-op si ya
   false (React bailout). El cleanup NO corre en el primer focus (solo en blur/unmount). Hook llamado
   incondicionalmente dentro de ProfileSection (rules-of-hooks OK; ProfileSection se monta solo con
   userId, pero el hook está dentro, no condicionado). ✓
3. **¿La pantalla de email valida y maneja todos los errores?** — `validateNewEmail` (formato +
   distinto del actual, antes de pegar a red) + mapeo de `email_taken`/`invalid`/`network`/`unknown`
   (mismo reason tipado que el form viejo). Submit deshabilitado con campo vacío. Tras OK → estado de
   confirmación + volver. ✓
4. **¿La fila de email navega bien y la ruta está en el gate?** — `router.push('/cambiar-email')` →
   `<Stack.Screen name="cambiar-email" />` registrada. No está en `strandedOnGatingRoute` (active) →
   el gate no la expulsa. Reachable solo desde `(tabs)` (active). Edge: si cae `active_lost` estando en
   la pantalla, el gate rutea a `/campo-perdido` (igual que editar-campo) — aceptable, no regresión. ✓
5. **¿Quedó hardcode?** — Lint anti-hardcode 0. Los `size`/`strokeWidth` de los íconos lucide
   (CheckCircle2 14) son API no-Tamagui, NO flagueados por diseño. Colores via token / getTokenValue. ✓
6. **¿Saqué EmailChangeForm sin dejar referencias colgadas?** — grep `EmailChangeForm`/`isValidEmail`/
   `changeEmail` en mas.tsx → 0 matches. `changeEmail` ahora solo lo consume `cambiar-email.tsx`. ✓
7. **¿Rompí crear-campo (R3.8) al endurecer isValidPhone?** — `isValidPhone` ahora también capa a 15
   díg (era solo `>=8`). crear-campo lo usa para el teléfono OBLIGATORIO; un teléfono real cae en 8–15,
   así que es estrictamente mejor (rechaza basura larga). Copy alineado. Test cubre el borde 16. ✓
8. **¿El nombre se guarda con espacios sobrantes?** — `saveProfile(userId,{name:name.trim(),…})`: el
   saludo no arrastra espacios. La validación ya usa trim. ✓
9. **Tests que pasan por la razón equivocada** — `sanitizePhoneInput` se asierta con letras reales
   (descarta) y separadores (conserva) + recorte a max; `validateNewEmail` verifica el reject del
   igual-al-actual (no solo el formato); `isValidPhone` verifica AMBOS bordes (7/8 y 15/16). Ejercen
   el path real. ✓
10. **Multi-tenant / identidad** — Sin cambios de I/O sensible: el cambio de email sale del JWT
    (`auth.updateUser`, sin user_id); no hardcodeo establishment_id/user_id en ningún lado nuevo. ✓

### Edge conocido (documentado, NO bug)
- `active_lost` mientras se está en `/cambiar-email` expulsa a `/campo-perdido` (mismo camino que
  `editar-campo`). Es un estado de mayor prioridad (perdiste el campo activo, R6.10); el cambio de
  email no se concretó (no se llamó `changeEmail` aún o, si se llamó y dio OK, el mail ya salió y se
  confirma fuera de la app). Aceptable para MVP.

## Estado final
- Los 4 fixes implementados, verificados (check.mjs todo verde). Esperando reviewer + Gate 2 (NO marco
  done yo). NO se cambió el estado de ninguna feature en feature_list.json ni tasks.md.
