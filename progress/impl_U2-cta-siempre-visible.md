baseline_commit: 7477b21f022fdb5461b9a3e98676ba7792bbf98e

# U2 — CTA siempre visible (teclado + scroll)

Tanda `docs/plan-mejoras-2026-07-20.md`, Tier-3. Absorbe el "scroll affordance" pendiente de
`docs/plan-mejoras-ux-2026-07-18.md` §4. Enfoque aprobado por el leader (design-review): UN primitivo
reusable de **footer-fijo con CTA** (header-fijo / body-scroll / footer-fijo).

## Tasks

- [x] T1 — Util PURO `app/src/utils/footer-action.ts` + unit `footer-action.test.ts` (14 tests verdes).
      Registrado en `scripts/run-tests.mjs`.
- [x] T2 — Hook `app/src/hooks/useKeyboardVisible.ts` (RN Keyboard; iOS Will*, Android Did*, web = false).
- [x] T3 — Primitivo `app/src/components/FooterActionShell.tsx` + export en `components/index.ts`.
- [x] T4 — Aplicado a `app/app/maniobra/carga.tsx` (🔴): `bottomPad` keyboard-aware + robusto
      (initialWindowMetrics) + `KeyboardAvoidingView` alrededor del paso.
- [x] T5 — Aplicado a `app/app/crear-animal.tsx` (el alta): shell completo (header/body/footer + scrollViewRef).
- [x] T6 — Aplicado a `app/app/agregar-evento.tsx`: shell completo.
- [x] T7 — E2E `app/e2e/cta-siempre-visible.spec.ts` — VERDE (1 passed).
- [x] T8 — Capture `app/e2e/captures/cta-siempre-visible.capture.ts` — 2 passed, 6 shots generados.
- [x] T9 — `docs/design-system.md` reconciliado (primitivo canónico §6 + safe-areas §4) + autorrevisión.

## El primitivo — 4 responsabilidades (la lógica pura testeada)

`FooterActionShell` (componente) + `footer-action.ts` (lógica pura):
1. **CTA en footer FIJO** (fuera del scroll) → nunca scrollea.
2. **Sube sobre el teclado** (`KeyboardAvoidingView`: `padding` iOS / `adjustResize` Android) + **encoge la
   safe-area con el teclado abierto** (`resolveFooterPaddingBottom` → respiro chico, no reserva los ~34px
   que el teclado ya tapa).
3. **Scroll affordance** (fade + chevron + peek) ⟺ hay contenido bajo el fold (`shouldShowScrollPeek`,
   reusa la geometría de `scroll-affordance.ts` — una sola fuente de verdad).
4. **Reserva safe-area robusta** con blindaje frame-0 Android edge-to-edge (`computeSafeBottomInset` con
   `initialWindowMetrics`, mismo enfoque que U7 / `tab-bar-insets.ts`).

## Pantallas tocadas y por qué

| Pantalla | Criticidad | Problema que tenía | Qué se aplicó |
|---|---|---|---|
| `maniobra/carga.tsx` | 🔴 manga | Los pasos de TEXTO (producto/tubo/pajuela/fecha/dato custom) tenían el CTA gigante al fondo → el teclado lo tapaba en iOS; `bottomPad` colapsaba en frame-0 Android | `KeyboardAvoidingView` alrededor del paso + `bottomPad` keyboard-aware y robusto (initialWindowMetrics). Header/línea de maniobra/error quedan FIJOS arriba del KAV. Cero cambio a los componentes de paso. |
| `crear-animal.tsx` (alta) | 🔴/🟡 (alta en manga) | Footer fijo a mano (`paddingBottom insets.bottom+12`) tapado por el teclado en el paso 4 (año/día-mes/peso/pelaje) + sin affordance de scroll | Shell completo: header slot + body con affordance + footer keyboard-aware. `scrollViewRef` pasa-through (la validación scroll-al-campo intacta). |
| `agregar-evento.tsx` | 🟡 | Mismo footer-a-mano tapado por el teclado (fecha/notas/peso) | Shell completo (paso 2). El paso 1 = elección de tipo, sin footer. |

**NO tocadas (fuera de scope, decisión):** `crear-campo.tsx` + auth screens usan `AuthScreenShell` (CTA
in-flow dentro del scroll + `KeyboardAvoidingView` ya presente); la tanda anterior decidió que las auth
(🟡 mixtas) mantienen el CTA in-flow. Otros forms (`crear-rodeo`, `baja`, `editar-*`, `import`, `sigsa`)
quedan para una segunda pasada — se aplicó el primitivo **donde el problema del teclado/fold existe hoy**
(instrucción: no rehacer cada pantalla).

## Trazabilidad (requisito → test)

Sin `requirements.md` formal (delta de plan doc); se mapea contra las 4 responsabilidades del primitivo:

| Req | Test |
|---|---|
| P1 — CTA en footer fijo, visible sin scrollear + tras scrollear al fondo | `e2e/cta-siempre-visible.spec.ts` (pasos 1 + 4: `footer-action` visible, `Crear animal` visible antes y después de `wheel(0,4000)`) + capture `06-alta-scrolleado-footer-fijo` |
| P2 — safe-area encoge con teclado abierto (no deja hueco) | `footer-action.test.ts` › `resolveFooterPaddingBottom` (teclado abierto → gap; cerrado → safeInset). Lift sobre teclado = device-only (rn-web no monta teclado) → capturas 02/05 + device Raf |
| P3 — affordance de peek ⟺ contenido bajo el fold | `footer-action.test.ts` › `shouldShowScrollPeek` (4 casos) + `e2e` (peek visible con form largo, `toHaveCount(0)` al fondo) + capture `04-alta-footer-fijo-peek` |
| P4 — reserva safe-area robusta (frame-0 Android) | `footer-action.test.ts` › `computeSafeBottomInset` (Android live=0/init=48 → 48, no colapsa; web → mínimo; NaN/neg → mínimo) |

## Verificación corrida (acotada, por instrucción del leader)

- **Unit**: `node --test app/src/utils/footer-action.test.ts` → **14/14 verde**.
- **E2E**: `playwright test e2e/cta-siempre-visible.spec.ts` → **1 passed** (alta: footer fijo + CTA
  visible/tappable + peek on→off + tap dispara el alta).
- **Capture (Gate 2.5)**: `playwright ... cta-siempre-visible.capture.ts --config playwright.capture.config.ts`
  → **2 passed**, 6 shots en `app/e2e/captures/__shots__/cta-siempre-visible/` (gitignored). Auto-veto del
  implementer: CTA en thumb-zone, sin recorte de descendentes ("Antiparasitario"/"aplicaste"/"preñez"),
  peek visible/apagado correcto, footer no tapa el último campo (capture 06 muestra el último campo íntegro
  arriba del footer), sin overflow horizontal a 412.
- **tsc**: `pnpm typecheck` → **exit 0** (toda la app).
- NO se corrió `check.mjs` full ni suites remotas (instrucción).

## Autorrevisión adversarial

Busqué y verifiqué:
- **¿El footer tapa el último campo?** No: el body es un ScrollView con `paddingBottom` peek ($6) y el
  footer vive FUERA del scroll → el último campo se scrollea íntegro sobre el footer (capture 06 lo confirma).
- **¿KeyboardAvoiding anda en iOS Y Android?** iOS `behavior='padding'`; Android `undefined` + `adjustResize`
  (default de Expo `softwareKeyboardLayoutMode`, no hay override en `app.config.ts`) — MISMO patrón que
  `AuthScreenShell` ya en producción. El encoje de safe-area con teclado abierto evita el hueco de ~34px.
- **¿El peek confunde?** Solo aparece con overflow real (`shouldShowScrollPeek`), se apaga al fondo; fade+chevron
  estándar (idéntico idiom al de la lista de maniobra). Verificado on/off en E2E + capturas.
- **¿Rompí los pasos de maniobra SIN teclado?** No: `keyboardVisible=false` → `bottomPad` pleno; el
  `KeyboardAvoidingView` con teclado cerrado es no-op. Capturas 01/03 (maniobra) renderizan full-height OK.
- **¿La validación scroll-al-campo del alta sigue?** Sí: el shell relaya `scrollViewRef` al mismo ScrollView
  Tamagui → `scrollRef.current.scrollTo()` intacto; los `onLayout` de campo viven en los hijos (independientes
  del `onScroll` del affordance que el shell posee).
- **Imports muertos**: removido `ScrollView` de tamagui en `crear-animal` y `agregar-evento` (ya no lo usan).
- **Multi-tenant / offline**: N/A (UI pura, sin datos ni `establishment_id`).

## Reconciliación de specs

No hay `specs/active/U2/` (delta de plan doc, flujo lite implementer→reviewer). La documentación canónica
afectada se reconcilió al as-built: `docs/design-system.md` §6 (nuevo primitivo `FooterActionShell`) y §4
(patrón de safe-area robusto + caso teclado). No hay EARS que contradecir.

## Aviso al leader

- `pnpm e2e:build` corrió (necesario para E2E/capturas). Chequeé `git status design/` → **0 cambios**
  (no churneó los `design/*.png` esta vez). Los `__shots__/*.png` quedan gitignored (NO se `git add`).
- Las capturas son a **412px** (viewport del `playwright.capture.config.ts`). Falta el par a **360px**
  (convenio del repo) — el layout es fluido/token, sin anchos fijos; a completar en el veto del leader.
</content>
