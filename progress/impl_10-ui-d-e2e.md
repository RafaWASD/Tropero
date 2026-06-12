baseline_commit: 3d763d88345d1940472eb944e72021636a394ecb

# impl 10 — chunk UI-D: E2E Playwright de las 3 operaciones masivas (T-UI.9/10/11)

> **TEST-ONLY.** NO se toca código de producto. Si un E2E falla por un BUG REAL del producto, PARO y reporto al leader (no parcheo).

## Feature en curso

Spec 10 (operaciones-rodeo) — chunk **UI-D** = la red de regresión end-to-end de las 3 operaciones masivas:
- **T-UI.9** — castración masiva (selección + defaults + ⭐ resaltado + bottom-sheet reversible + transición a novillito + observación + revert desde la ficha).
- **T-UI.10** — destete masivo (todos los terneros/as pre-tildados + mellizos + transición visible + override avisado sin transición).
- **T-UI.11** — vacunación masiva (preview "N eventos sobre M" + confirmar + re-ejecutar = 0 nuevos por idempotencia).

Todo el frontend de spec 10 (UI-A…UI-C) ya está implementado + gateado + commiteado. Estos E2E son la red de regresión.

## Plan (T-UI.9 → T-UI.10 → T-UI.11) — TODO HECHO

- [x] T-UI.9 — `app/e2e/operaciones-castracion.spec.ts`
- [x] T-UI.10 — `app/e2e/operaciones-destete.spec.ts`
- [x] T-UI.11 — `app/e2e/operaciones-vacunacion.spec.ts`
- [x] Helper de seed: extendido `seedAnimal` con `isCastrated`/`futureBull` (test-only, `e2e/helpers/admin.ts`).
- [x] Helper de nav: `gotoRodeoGroup` + `escapeRegExp` en `e2e/helpers/ui.ts` (Inicio rodeo-céntrico → vista de grupo).

## Specs creados (TEST-ONLY — cero cambio de producto)

| Spec | Qué cubre | R<n> |
|---|---|---|
| `app/e2e/operaciones-castracion.spec.ts` | castración masiva end-to-end: defaults (terneros comunes pre-tildados / ⭐+adultos no, vía contador) → tildar ⭐ resaltado sin modal → CTA con número → bottom-sheet (⚠ futuro torito + copy reversible + NO "no se puede deshacer") → confirmar → torito→Novillito (espejo C6 offline) + observación "Castrado" en timeline → REVERT desde la ficha → Torito + "Corrección: marcado como no castrado" | R11.1/3/5/6/7/8/9, R13.1, R13.5, R13.7, R10.6 |
| `app/e2e/operaciones-destete.spec.ts` | destete masivo: todos pre-tildados (R11.4) → bottom-sheet avisa override (R5.6) → confirmar → ternera→Vaquillona, mellizos→Torito (cada uno con su "Destete" en timeline, R3.5) → override sigue Ternera + "Categoría fijada manualmente" PERO con "Destete" aplicado (R5.6) | R11.4, R3.2, R3.5, R5.5, R5.6 |
| `app/e2e/operaciones-vacunacion.spec.ts` | vacunación masiva: producto + vía por chip → preview "3 eventos sobre 3 animales" (R4.2) → confirmar → "3 animales listos" (R3.1) → RE-EJECUTAR la misma → "Ningún animal nuevo" + "3 animales ya tienen esta vacunación cargada hoy" + CTA disabled (R6.3) | R3.1, R4.2, R6.3 |

## Trazabilidad R<n> → archivo:test (los E2E que ESTAS tasks cubren)

| R<n> | E2E |
|---|---|
| R11.1/R11.5/R11.6/R11.7/R11.9 (selección, defaults, ⭐ sin modal, CTA vivo, fila compacta) | `operaciones-castracion.spec.ts` |
| R11.3 (defaults castración: comunes pre-tildados, ⭐/adultos no) | `operaciones-castracion.spec.ts` (vía contador 2→3→4) |
| R11.4 (destete: todos pre-tildados) | `operaciones-destete.spec.ts` |
| R11.8 / R5.6 (bottom-sheet: ⚠ + copy reversible / aviso override) | `operaciones-castracion.spec.ts` (⚠+copy), `operaciones-destete.spec.ts` (override) |
| R13.1 (Castrado Sí/No editable en ficha + confirmación anticipa recálculo) | `operaciones-castracion.spec.ts` (revert) |
| R13.5 (recompute simétrico: torito↔novillito) | `operaciones-castracion.spec.ts` (castrar→Novillito, revert→Torito) |
| R13.7 (observación automática "Castrado" / "Corrección…") | `operaciones-castracion.spec.ts` |
| R10.6 (transición offline vía espejo C6) | `operaciones-castracion.spec.ts` + `operaciones-destete.spec.ts` |
| R3.2 / R3.5 (destete = 1 weaning por ternero; mellizos) | `operaciones-destete.spec.ts` |
| R5.5 (weaning transiciona la categoría) | `operaciones-destete.spec.ts` |
| R3.1 (vacunación = 1 sanitary_event por animal) | `operaciones-vacunacion.spec.ts` |
| R4.2 (preview obligatorio + confirmación explícita) | `operaciones-vacunacion.spec.ts` |
| R6.3 (re-ejecutar ⇒ 0 nuevos, idempotencia) | `operaciones-vacunacion.spec.ts` |

## Resultado de las corridas (anti-flake)

- **Individuales**: castración OK (13.6s), destete OK (10.6s, con asserts reforzados), vacunación OK (9.6s).
- **Combinada `--repeat-each=3` (9 corridas = 3 specs × 3)**: **9/9 verde** (~1.7m). Sin flake, sin interferencia
  cruzada en la DB beta compartida (datos namespaced por RUN_TAG, aserción solo sobre datos propios).
- **Combinada `--repeat-each=2` (6 corridas) tras los asserts reforzados**: **6/6 verde** (~1.1m).
- Auto-descubiertos por el glob `**/*.spec.ts` (`playwright test --list` los lista → 3; sin registro manual).
- Nota: el "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" que imprime Node DESPUÉS de "N passed" es
  ruido de teardown de libuv en Windows (cierre de handles del runner), NO un fallo de test — todas las corridas
  reportan "passed".

## BUGS REALES del producto encontrados

NINGUNO funcional que impida los E2E. UNA observación de a11y NO-bloqueante (NO se parcheó — es test-only):
- **`AnimalRow` compacto no emite `aria-checked`**: el checkbox de la fila de selección masiva pasa
  `accessibilityState={{checked}}` crudo al `Pressable` y react-native-web NO lo traduce a `aria-checked` en el
  DOM del export de prod (`role="checkbox"` y `aria-label` SÍ aparecen). NO es un bug funcional (la selección
  opera bien; el contador/CTA/resaltado ⭐ son correctos) — por eso los E2E verifican los defaults por el
  CONTADOR, no por `aria-checked`. Gap de a11y de lectores de pantalla (no anuncian tildado/destildado). Anotado
  en `docs/backlog.md` (2026-06-12) + design §UI-D AS-BUILT. Cierre sugerido: emitir el estado vía helper tipo
  `switchA11y` en `RowCheckbox`/`AnimalRow` (toca producto → fuera del alcance test-only de UI-D; lo decide el leader).

## Autorrevisión adversarial (qué busqué, qué encontré, cómo lo cerré)

Pasada hostil sobre mis propios E2E ANTES de reportar — no soy pasamanos de mi propio trabajo:
1. **Tests que pasan por la razón equivocada.** El "0 nuevos" de la re-vacunación: ¿podría pasar si la 1ra corrida
   NO creó eventos? NO — si la 1ra no creara eventos, la 2da mostraría "3 eventos sobre 3 animales" y el test
   FALLARÍA en "Ningún animal nuevo". El skip-report "3 animales ya tienen esta vacunación cargada hoy" prueba que
   los 3 están presentes Y se saltan → ejercita el path real de idempotencia (R6.3). OK.
2. **Observación de castración: ¿count=2 prueba la del timeline?** "Castrado" aparece en (a) la label de Manejo y
   (b) el detalle de la observación. count=2 ⇒ la observación EXISTE (si no, sería 1 = solo Manejo). El test pasa
   con 2 → cubre R13.7 de verdad. + asertamos "Observación" (título que SOLO está en el timeline). OK.
3. **Transición castración sobre `ternero`.** El task pedía "el ternero castrado pasa a novillito" — FALSO as-built:
   un `ternero` castrado NO transiciona (0062, sigue ternero). Corregí el diseño del test: la transición se prueba
   sobre el TORITO adulto (torito→novillito), que SÍ transiciona; los terneros comunes igual reciben la observación
   "Castrado". Esto respeta el spec real (R3.3/R5.7/R13.5) en vez de asertar una transición inexistente.
4. **Mellizos: ¿se prueba "1 weaning c/u"?** Reforcé: además de las 2 transiciones a Torito, abro la ficha de un
   mellizo y verifico "Destete" en su timeline (evento por ternero, R3.5).
5. **Override: ¿se aplicó el weaning?** Reforcé: la ficha del animal con override tiene "Destete" en el timeline
   (el weaning SÍ se aplicó, R5.6 "la mutación igual se aplica") PERO "Categoría fijada manualmente" + Ternera (no
   transicionó). Antes solo verificaba que no transicionara.
6. **Doble botón "CTA" con el sheet abierto.** El bottom-sheet repite el label del CTA ("Castrar/Destetar N
   animales") → strict-mode violation. Resuelto: `.first()` abre el sheet, `.last()` (el del sheet, último en el
   árbol) confirma. Documentado en cada spec.
7. **Navegación post-masiva.** Descubrí que "Listo" hace `router.back()` → vuelve a la VISTA DE GRUPO (no a home).
   Ajusté: abro las fichas desde las filas del grupo (que se recargan con `useFocusEffect`), no por la tab Animales
   (que no existe en la pantalla pushada). La re-vacunación se dispara desde el grupo donde ya estoy.
8. **Aislamiento multi-tenant / DB compartida.** Datos namespaced (RUN_TAG); aserto SOLO sobre mis idv (regex por
   idv único); cleanup en afterAll + barrido del global-teardown. `--repeat-each=3` confirma que no hay colisión
   ni dependencia de estado global (la beta está contaminada por el testing manual de Raf).
9. **Flake vs fallo real de mi test.** Las 15 corridas (9+6) verdes con tiempos estables (~8–14s c/u) descartan
   flake. Los timeouts generosos (20–30s) absorben el first-sync de PowerSync (los animales seedeados bajan al
   cliente) sin enmascarar un fallo real (la transición/observación son LOCALES e instantáneas — si no ocurrieran,
   el wait expiraría). Ningún flake de infra (statement timeouts de la beta) apareció en las corridas.

## Reconciliación de specs al as-built

- `tasks.md`: T-UI.9/10/11 marcados `[x]` con su nota AS-BUILT (archivo + qué verifica + resultado de corridas).
- `design.md`: agregada la sección **AS-BUILT — chunk UI-D** (los 3 specs + la observación a11y NO-bloqueante).
- `requirements.md`: SIN cambios — los E2E confirman el comportamiento ya specceado (selección, defaults, bottom-sheet,
  transiciones, idempotencia); ningún `R<n>` cambió de *qué* → no hay nota de reconciliación de requirements.
- `docs/backlog.md`: anotado el gap de a11y de `AnimalRow` (no test-only-fixeable, toca producto).
- El único "desvío" del task fue de DISEÑO DEL TEST (transición sobre torito, no ternero) — alineado con el spec
  real, no con la imprecisión del brief. No contradice ningún doc.

## Verificación

1. `pnpm.cmd typecheck` → **verde** (sin errores).
2. `pnpm run e2e:build` → **OK** (`dist` exportado) + 3 specs corridos: **9/9 (`--repeat-each=3`)** + **6/6
   (`--repeat-each=2`)** verde.
3. `node scripts/check.mjs` → **exit 0** (typecheck + 192+ unit + backend suites incl. spec 10 Fase 1 22/22; los
   E2E NO corren en check.mjs, se corrieron aparte con Playwright).
4. Auto-descubrimiento confirmado (`playwright test --list` → los 3 specs). Sin registro manual.

## NO marqué la feature `done`

Queda el review final del leader + la presentación a Raf (per el mandato).
