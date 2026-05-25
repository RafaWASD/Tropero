# Setup — Frontend de RAFAQ

Guía paso a paso para instalar las MCPs, librerías y tools que decidimos en `docs/adr/ADR-013-frontend-stack.md`. Cada sección incluye **comandos concretos** para copy-paste.

> **Convenciones críticas en este entorno** (Windows + Cylance + Banco Patagonia network):
> - Working dir base: `C:\dev\RAFAQ\app-ganado`.
> - **NO usar `npx`** — npm está roto por Cylance (Z_DATA_ERROR / FETCH_ERROR / Unterminated JSON). Usar **`pnpm dlx`** en su lugar para ejecutables one-shot.
> - **En PowerShell**: `pnpm.cmd` (no `pnpm`) — Cylance Script Control bloquea `.ps1`. En Bash funciona `pnpm` directo.
> - Para MCPs de Claude Code que se spawnean automáticamente, usar `pnpm dlx` (sin `.cmd`) — la spawning library de Node resuelve el shim correcto.

---

## Parte 1 — MCPs para Claude Code (haceleo ahora)

Las MCPs son servidores que se conectan a Claude Code y le dan superpoderes. Una vez instaladas, Claude (yo) las uso transparentemente en sesiones futuras.

### 1.1 — Figma MCP

**Para qué**: Claude lee tus archivos de Figma y traduce designs a componentes RN con fidelidad alta. Pipeline: Raf diseña en Figma → comparte el link conmigo → yo implemento.

**Pre-requisito**: cuenta de Figma (free).

**Pasos**:

1. **Generar Figma Personal Access Token**:
   - Andá a https://www.figma.com/ → login.
   - Click avatar (arriba-der) → **Settings**.
   - Tab **Security** → scroll hasta **Personal access tokens**.
   - **Generate new token**:
     - Name: `claude-rafaq`
     - Expiration: **No expiration** (o el plazo que prefieras).
     - Scopes: tildá **File content** (read).
   - **Copialo inmediatamente** — Figma lo muestra una sola vez.

2. **Registrar el MCP en Claude Code** (bash, no PowerShell — `claude mcp add` con `--scope user` funciona desde bash):

   ```bash
   claude mcp add figma --scope user -e FIGMA_API_KEY=TU_FIGMA_TOKEN_AQUI -- pnpm dlx figma-developer-mcp --stdio
   ```

   Reemplazá `TU_FIGMA_TOKEN_AQUI` con el token que copiaste.

   - `--scope user` hace que esté disponible en todos tus proyectos, no solo este.
   - `-e FIGMA_API_KEY=...` pasa el token como env var (el MCP server lo lee de ahí).
   - **Usamos `pnpm dlx` en lugar de `npx`** porque npx está roto en este entorno (Cylance/proxy). pnpm dlx resuelve el binario y lo ejecuta sin pasar por npm.
   - El `--stdio` flag le dice al MCP server que se comunique via stdin/stdout (lo que Claude Code espera).

3. **Verificá** con:

   ```powershell
   claude mcp list
   ```

   Deberías ver `figma` en la lista. Si dice `failed`, revisá el token.

4. **Probalo**: en una sesión nueva de Claude Code, pasame un link de Figma (ej: `https://www.figma.com/file/XXX/Tu-Diseño`) y pedime "leé esto y describime los componentes". Si funciona, todo OK.

**Costo**: $0. Free para uso personal con cuenta Figma free.

---

### 1.2 — Supabase MCP

**Para qué**: Claude consulta tu DB directamente. Debugging de RLS, verificar datos en vivo, ejecutar queries de exploración sin pedirte que vayas al dashboard.

**Pre-requisito**: `SUPABASE_ACCESS_TOKEN` (ya lo tenés en `.env.local`).

**Pasos**:

1. **Registrar el MCP** (bash):

   ```bash
   cd C:/dev/RAFAQ/app-ganado
   set -a && . ./.env.local && set +a
   claude mcp add supabase --scope user -e SUPABASE_ACCESS_TOKEN="$SUPABASE_ACCESS_TOKEN" -- pnpm dlx "@supabase/mcp-server-supabase" --read-only --project-ref="$SUPABASE_PROJECT_REF"
   ```

   - `set -a && . ./.env.local && set +a` carga las vars de `.env.local` en la shell (necesario porque ya tenés el token ahí).
   - El flag `--read-only` es crítico: bloquea cualquier operación de write desde Claude. Solo SELECT y EXPLAIN. **Defensa importante para no romper la DB de producción accidentalmente.**
   - `--project-ref=xrhlxxdnfzvdnztacofj` lo scopea a tu proyecto RAFAQ específicamente.
   - **`pnpm dlx` en lugar de `npx`**: npm está roto en este entorno por Cylance. pnpm dlx esquiva el problema.

2. **Verificá**:

   ```bash
   claude mcp list
   ```

   Debería mostrar `supabase` con `✓ Connected`.

3. **Probalo**: en una sesión nueva, pedime "consultá la tabla `users` y mostrame cuántas filas hay".

**Costo**: $0. Usa el plan free de Supabase ya existente.

**Si más adelante querés write access** (para que yo pueda aplicar migrations directamente), remové `--read-only` del comando y re-registrá. Pero **arrancá con read-only** — es la postura defensiva correcta.

---

## Parte 2 — Librerías del proyecto (agregar antes de empezar Fase 3)

Estas se agregan al `app/package.json` con `pnpm.cmd add ...`. **NO las agregues ahora** — las agregamos cuando arranque el frontend del spec 01. Las listo para referencia.

### 2.1 — Design system + theming

```powershell
cd app
pnpm.cmd add @tamagui/config tamagui @tamagui/animations-react-native
pnpm.cmd add -D @tamagui/babel-plugin
```

Configurar después según docs: https://tamagui.dev/docs/intro/installation

### 2.2 — Routing

```powershell
pnpm.cmd add expo-router
pnpm.cmd remove @react-navigation/native @react-navigation/native-stack react-native-screens react-native-safe-area-context
```

(Expo Router trae sus propias deps; las que están actualmente se reemplazan.)

Después: configurar entry point en `app.json` apuntando a `expo-router/entry` y mover pantallas a estructura `app/app/`.

### 2.3 — Animaciones

```powershell
pnpm.cmd add react-native-reanimated react-native-gesture-handler moti lottie-react-native
```

Configurar `babel.config.js` para incluir el plugin de Reanimated (al final del array).

### 2.4 — Manga-friendly

```powershell
pnpm.cmd add expo-haptics expo-speech expo-screen-orientation expo-keep-awake @react-native-voice/voice
```

### 2.5 — Observabilidad

```powershell
pnpm.cmd add @sentry/react-native posthog-react-native
```

(Configurar después con DSN/keys cuando creemos las cuentas.)

---

## Parte 3 — Servicios cloud (cuentas a crear cuando lleguemos)

No los crees ahora. Lista para tenerlos en mente.

### 3.1 — EAS Build + Update (Expo)

**Cuándo**: cuando necesitemos hacer el primer build nativo (típicamente Fase 4-5 del spec 01).

**Pre-requisito**: cuenta Expo (free) en https://expo.dev. **Ya creaste esta cuenta** cuando generaste `EXPO_ACCESS_TOKEN`.

**Pasos** (futuros):

```powershell
pnpm.cmd add -g eas-cli
eas login
cd app
eas build:configure
eas build --platform android --profile development
```

iOS requiere un Apple Developer Account ($99/año). Lo pateamos hasta que tengamos beta cerrada en Android primero.

**Costo**: free tier 30 builds/mes + updates ilimitados.

---

### 3.2 — Sentry (error tracking)

**Cuándo**: antes de la primera beta cerrada (~Fase 5 del spec 01).

**Pasos** (futuros):

1. Crear cuenta en https://sentry.io (free, soporta GitHub login).
2. New Project → React Native → name: `rafaq-mobile`.
3. Copiar el DSN.
4. Agregar `SENTRY_DSN` a `.env.local` y al config de `@sentry/react-native`.

**Costo**: free tier 5k events/mes.

---

### 3.3 — PostHog (analytics + session recordings)

**Cuándo**: cuando empecemos beta cerrada con usuario real (Fase 5+).

**Pasos** (futuros):

1. Crear cuenta en https://posthog.com (free, EU o US — recomiendo US).
2. New Project → React Native → name: `rafaq-mobile`.
3. Copiar el Project API Key.
4. Agregar `POSTHOG_API_KEY` a `.env.local` y al SDK setup.

**Importante**: configurar **mobile session replay** explícitamente. Es el feature killer para nuestro caso (ver al operario real en manga).

**Costo**: free tier 1M events + 5k recordings/mes. Suficiente para 1-3 campos beta.

---

### 3.4 — Maestro (E2E testing)

**Cuándo**: Fase 8 (QA) del spec 01.

**Instalación** (futuro, NO ahora):

```powershell
# Maestro CLI requiere instalación nativa (no npm).
# Descargar desde https://maestro.mobile.dev/getting-started/installing-maestro
# Para Windows: usar el installer .ps1 o WSL.
```

Maestro es un binario, no un paquete npm. Lo instalamos cuando lleguemos a QA.

**Costo**: $0 (open-source).

---

## Parte 4 — Skills custom de Claude Code (futuro)

Idea: skill `manga-ux-check` que valide cada pantalla nueva contra checklist:

- Botón primario mínimo 56×56dp (target táctil cómodo con guantes)
- Contraste WCAG AAA en textos críticos
- Font mínima 18sp en texto operativo
- Una decisión primaria por pantalla
- Haptic feedback en toda acción destructiva
- Loading state visible >300ms
- Error state con copy en español accionable

Esta skill la creamos cuando tengamos primeras pantallas codeadas para validar. La sintaxis es markdown con frontmatter — la armo cuando lleguemos.

---

## Checklist de instalación ahora

Cosas que conviene tildar HOY (paralelo a otras tareas):

- [ ] Generar Figma Personal Access Token
- [ ] `claude mcp add figma ...` con el token
- [ ] `claude mcp list` y verificar que `figma` aparece
- [ ] `claude mcp add supabase ...` con `--read-only`
- [ ] `claude mcp list` y verificar que `supabase` aparece
- [ ] Reiniciar Claude Code para que cargue las MCPs nuevas

Lo que NO se hace ahora:
- Instalar libs del stack (Tamagui, etc) → cuando arranque Fase 3 del spec 01
- Crear cuenta Sentry / PostHog → cuando lleguemos a Fase 5
- Instalar Maestro → cuando lleguemos a Fase 8

---

## Si algo sale mal

- **`claude mcp add` falla**: probablemente el binary `claude` no está en PATH. Probá `where claude` para encontrarlo, o usá la ruta absoluta.
- **MCP queda en `failed`**: típicamente token inválido o expirado. Re-generá y re-registrá.
- **Cylance bloquea la instalación de un npm package**: usar pnpm como ya configuramos (ADR-011). Si igual bloquea, pedir excepción para `registry.npmjs.org`.
- **Algún paquete del stack rompe con Expo SDK 56**: chequear versiones compatibles en docs del paquete. Si no hay versión compatible, evaluar alternativa (anotada en ADR-013 como negativa conocida).
