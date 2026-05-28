# Verificación — Cómo demostrar que funciona

> El agente no dice que funciona, lo demuestra.

## Niveles

### N1 — Tests unitarios
- Cubren camino feliz + ≥1 caso de error por unidad con lógica.
- Servicios: tests aislados con dependencias inyectadas.
- Hooks: tests con `renderHook` de Testing Library.
- Componentes: tests con `render` + queries por rol/text, no por `testID` salvo necesario.

### N2 — Tests de integración
- Atraviesan ≥2 capas reales (ej: service → PowerSync local → assert en SQLite).
- Edge Functions: `deno test` con Supabase test container o stub local.
- RLS: tests SQL que validan policies con JWT mockeado de distintos users.

### N3 — Smoke end-to-end
- Opcional. Solo en features críticas (auth, sync).
- Detox o Maestro contra build de desarrollo.

### N4 — Trazabilidad `R<n> ↔ test` (obligatorio para SDD)
- El implementer documenta en `progress/impl_<name>.md` el mapa requirement → test concreto (archivo + nombre).
- El reviewer rechaza si algún `R<n>` queda sin test.

## Áreas con testing obligatorio (no negociables)

En estas áreas el reviewer rechaza implementaciones sin tests N1+N2:

- **Correlación temporal BLE** — Vesta ↔ Allflex, ventanas de correlación, fallback manual.
- **Sincronización offline y resolución de conflictos** — PowerSync, colas, last-write-wins y estrategias custom.
- **Cálculos de KPIs y analítica** — métricas que se muestran al usuario o se exportan.
- **Importación de archivos de laboratorio** — parsers configurables (ADR-007).
- **Transiciones automáticas de categoría** — lógica de ADR-008.
- **Lógica de billing y planes** — cuando se active (ADR-009).

En el resto del código los tests son recomendables pero no obligatorios al implementar. Vale la pena agregarlos cuando aparece el primer bug en esa zona.

## Comandos del stack

> Configurables en `.harness/config.json`. El `scripts/check.mjs` ejecuta `testCommand`.

| Concepto | Comando |
|---|---|
| Type-check | `cd app && pnpm.cmd typecheck` (corre `tsc --noEmit`) |
| Tests del cliente | `cd app && pnpm.cmd test` (Jest + RNTL, cuando se setee) |
| Lint | `cd app && pnpm.cmd lint` (cuando se setee) |
| Tests SQL/RLS | `node --test supabase/tests/rls/run.cjs` (Node nativo contra DB remota — NO pgTAP, Docker bloqueado; ver ADR-012) |
| Tests Edge Functions | `node --test supabase/tests/edge/run.cjs` (Node nativo vía `supabase-js` + `functions.invoke`, NO `deno test`) |

> `npx`/`npm` están rotos en este entorno (Cylance MITM); el proyecto usa `pnpm.cmd` en PowerShell. Ver ADR-011. Lo de arriba lo orquesta `scripts/run-tests.mjs`, que es lo que `check.mjs` ejecuta como `testCommand`.

Durante bootstrap (sin código), `testCommand` queda vacío o el archivo `.harness/config.json` no existe. El check.mjs imprime `[WARN]` y sigue.

Ya hay código, así que `.harness/config.json` está configurado con:

```json
{
  "testCommand": "node scripts/run-tests.mjs"
}
```

`run-tests.mjs` corre, en orden: typecheck del cliente → suite RLS → suite Edge Functions. La suite RLS/Edge toca DB remota y requiere `.env.local` con `SUPABASE_SERVICE_ROLE_KEY`; si falta, se saltea con warning.

## Reglas duras de verificación

- **Sin mocks de RLS.** Los tests de seguridad usan Postgres real (Supabase local o branch).
- **Sin mocks de PowerSync.** Los tests de offline usan PowerSync real contra SQLite local.
- **Sin mocks de BLE en tests de unidad.** Mock solo si el test es de UI consumiendo eventos BLE — el motor de BLE se testea aparte con dispositivos reales o protocolo simulado por bytes.
- **Sin tests verdes con tasks `[ ]`.** El reviewer rechaza.
