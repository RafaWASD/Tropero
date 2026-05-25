# ADR-011 — Package Manager: pnpm con `onlyBuiltDependencies`

**Status**: Accepted
**Fecha**: 2026-05-25
**Decisores**: Raf

## Contexto

Durante la implementación de la feature `01-identity-multitenancy` apareció un bloqueo de `npm install` con `Z_DATA_ERROR` causado por inspección SSL corporativa (probablemente Cylance Endpoint). En paralelo, Raf flagueó preocupación por los ataques recientes a la cadena de suministro de npm (familia `shai-hulud` worm de septiembre 2025, compromisos de paquetes populares como `@ctrl/tinycolor`, y otros).

El package manager elegido inicialmente (`npm`, por default de `create-expo-app`) presenta dos problemas:

1. **Modelo de seguridad permisivo**: instala todas las dependencias en un `node_modules/` plano que permite phantom dependencies (cualquier paquete puede `require` cualquier otro en el árbol, declarado o no), y ejecuta postinstall scripts por default para cualquier paquete sin opt-in explícito.
2. **Bloqueo operativo concreto**: el `Z_DATA_ERROR` impide avanzar la fase 0 del MVP.

El proyecto tiene un posicionamiento estratégico de "ser el mejor en el primer try" (ver memoria de proyecto y este ADR de positioning), por lo que la postura de seguridad importa más que la velocidad de scaffolding.

## Decisión

**Usamos `pnpm` como único package manager del proyecto.**

Configuración crítica en `app/.npmrc`:

- `node-linker=hoisted` — requerido por Metro/React Native. Sin esto, Metro choca con los symlinks de pnpm.

Configuración crítica en `app/package.json`:

- Bloque `pnpm.onlyBuiltDependencies` con whitelist explícita de los paquetes Expo que pueden ejecutar postinstall scripts. Inicial: `["expo", "expo-modules-core", "@expo/cli", "esbuild"]`. Cualquier dep nueva que necesite ejecutar scripts requiere agregar a esta lista conscientemente.

## Alternativas consideradas

### npm (default de create-expo-app)
- **Pros**: cero learning curve, máxima compatibilidad con tooling antiguo.
- **Contras**: defaults permisivos, phantom dependencies, postinstall scripts arbitrarios, lockfile menos determinístico, y bloqueo operativo concreto con `Z_DATA_ERROR` en este entorno.

### yarn (classic v1)
- **Pros**: alguna mejora sobre npm, lockfile más limpio.
- **Contras**: discontinuado en favor de yarn berry, comunidad migró mayoritariamente a pnpm. Mismo modelo de seguridad permisivo que npm.

### yarn berry (v3+) con Plug'n'Play
- **Pros**: modelo de seguridad estricto, performance.
- **Contras**: PnP rompe muchas herramientas de React Native (Metro, EAS Build). Requiere configuración compleja para compatibilidad. Riesgo operativo alto.

### Bun como package manager
- **Pros**: muy rápido, lockfile binario.
- **Contras**: aún experimental para React Native/Expo, soporte de scripts y compatibilidad menos probados en producción.

## Consecuencias

**Positivas**:

- **Aislamiento por dependencia**: pnpm genera un `node_modules/` (en modo hoisted) pero la store content-addressable garantiza que dependencias se materialicen una sola vez en disco. Para builds CI/CD esto reduce IO y tiempo significativamente.
- **Defensa contra postinstall malware**: `onlyBuiltDependencies` impide que un paquete malicioso ejecute scripts arbitrarios sin que un humano lo haya whitelisteado explícitamente. Cubre la superficie de ataque más común de las campañas tipo shai-hulud.
- **Lockfile estricto**: `pnpm-lock.yaml` es más determinístico que `package-lock.json` y menos vulnerable a lockfile poisoning.
- **Performance**: instalaciones más rápidas; especialmente notable en CI donde el cache compartido se reusa entre runs.
- **Compat con `Z_DATA_ERROR`**: pnpm negocia streams de manera levemente distinta a npm; en escenarios con proxies que reempacan gzip, suele esquivar el problema.

**Negativas**:

- **Toda dep que necesite postinstall script** (raro, casi solo Expo y compiladores nativos) hay que agregarla a mano al whitelist. Costo: 1 línea por dep, una vez.
- **Algunas tools de terceros asumen npm**. Cuando aparezca, se usa `pnpm dlx` (equivalente a `npx`) o se documenta el workaround.
- **Onboarding de futuros colaboradores**: hay que instalar pnpm (`npm install -g pnpm` o vía corepack). Una línea en el README cubre esto.

**Notas de implementación**:

- Todos los comandos del proyecto que mencionan `npm` en docs/specs/tasks deben usar `pnpm` en su lugar. Excepción: comandos `npx` que no usan el package manager local (ej: `npx create-expo-app`).
- El `.harness/config.json` `testCommand` usa `pnpm`.
- Si se agrega CI/CD: usar `pnpm/action-setup` en lugar de `setup-node` con cache de npm.
- Si en el futuro se evalúa un monorepo (ej: app móvil + app web admin + librería compartida), pnpm workspaces es el camino natural.
