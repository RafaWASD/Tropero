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

## Comandos del stack

> Configurables en `.harness/config.json`. El `scripts/check.mjs` ejecuta `testCommand`.

| Concepto | Comando |
|---|---|
| Type-check | `npx tsc --noEmit` |
| Tests del cliente | `npm test -- --watchAll=false` |
| Lint | `npm run lint` |
| Tests SQL/RLS | `supabase db test` (cuando pgTAP esté setup) |
| Tests Edge Functions | `cd supabase/functions && deno test --allow-all` |

Durante bootstrap (sin código), `testCommand` queda vacío o el archivo `.harness/config.json` no existe. El check.mjs imprime `[WARN]` y sigue.

Cuando arranquemos a codear, crear `.harness/config.json`:

```json
{
  "testCommand": "npx tsc --noEmit && npm test -- --watchAll=false"
}
```

## Reglas duras de verificación

- **Sin mocks de RLS.** Los tests de seguridad usan Postgres real (Supabase local o branch).
- **Sin mocks de PowerSync.** Los tests de offline usan PowerSync real contra SQLite local.
- **Sin mocks de BLE en tests de unidad.** Mock solo si el test es de UI consumiendo eventos BLE — el motor de BLE se testea aparte con dispositivos reales o protocolo simulado por bytes.
- **Sin tests verdes con tasks `[ ]`.** El reviewer rechaza.
