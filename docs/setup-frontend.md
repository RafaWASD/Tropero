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

### 1.3 — Mobbin MCP (research de UI/UX patterns reales)

**Para qué**: acceso directo desde Claude Code a la biblioteca de **621.500+ screens + 142.200+ flows** de apps reales que cura Mobbin. Lanzado oficialmente el 12 de mayo de 2026, en beta. Sin esto: vos curás manualmente en el browser y yo leo screenshots descargados. Con esto: yo busco/comparo patterns en vivo durante la sesión.

**Pre-requisito**: suscripción Mobbin paga activa (Pro $40/seat/mes anual, o superior). El MCP está en **todos los planes pagos**, no requiere Enterprise.

**Pasos**:

1. **Registrar el MCP** (bash, no PowerShell — mismo motivo que Figma/Supabase):

   ```bash
   claude mcp add mobbin --scope user --transport http https://api.mobbin.com/mcp
   ```

   Diferencias importantes vs los otros MCPs:
   - **`--transport http`** (no `stdio`). El server corre en la nube de Mobbin, no como subprocess local.
   - **No requiere `-e TOKEN=...`** ni env vars. La autorización es **OAuth** al primer uso.
   - No usa `pnpm dlx` — el server no corre localmente, no hay binary que ejecutar.

2. **Verificá**:

   ```bash
   claude mcp list
   ```

   Debería mostrar `mobbin`. Probablemente con estado `pending auth` hasta el primer uso real.

3. **Primera autorización** (OAuth):
   - Reiniciá Claude Code para que cargue el MCP nuevo.
   - En una sesión nueva, cuando Claude (yo) llame al primer tool de Mobbin, **se abre el browser automáticamente**.
   - Login con tu cuenta Mobbin Pro → autorizar acceso del MCP → token persistido localmente.
   - A partir de ahí no te lo pide más.

4. **Probalo**: pedime en una sesión nueva "mostrame onboardings de B2B mobile en Mobbin". Si funciona, ves screens reales descritos. Si dice `unauthorized`, repetí el flujo OAuth.

**Tools que expone el MCP** (subject to change, está en beta):
- Búsqueda de screens por keyword, app, flow type, industry.
- Acceso a flows enteros (multi-screen).
- Patterns library agrupada.
- Imágenes en alta resolución descargables.

**Costo**: $0 adicional sobre tu suscripción Pro existente.

**Workflow recomendado en RAFAQ**:
- Vos hacés primera pasada solo en Mobbin browser (calibrar tu ojo).
- Sesión conjunta: yo traigo screens via MCP, comparamos, vos guardás los que valen en tu Project + descargás los esenciales a `design/inspiration/`.
- Síntesis: yo leo todo (MCP + repo) y propongo direcciones contrastadas.

---

### 1.4 — Tokens Studio for Figma (plugin, no MCP) — **PENDIENTE de cerrar design system**

> ⚠ **SECCIÓN HISTÓRICA — superada por ADR-023 (sesión 20).** Describe un workflow de importar `design/tokens.json` a Figma (Tokens Studio) que **ya no aplica**: ADR-023 demotó las herramientas de diseño a inspiración y fijó **el código como fuente única** (`app/tamagui.config.ts`; ver `docs/design-system.md`). El `tokens.json` de "Campo Profundo" se archivó en `design/explorations/` y **no se mantiene un `tokens.json` paralelo**. Se conserva esto solo como referencia del formato Tokens Studio, por si a futuro se sincroniza con Figma (se generaría desde el config). Las instrucciones de abajo apuntan a un archivo que ya no vive en `design/tokens.json`.

**Para qué (cuando llegue el momento)**: importar `design/tokens.json` como Variables nativas de Figma, en una sola operación. Sin esto tendrías que typear cientos de tokens a mano — paleta light + dark, escala tipográfica, spacing, radius, sombras.

**Pre-requisito**: cuenta Figma activa, archivo `RAFAQ Design System` creado (vacío por ahora).

**Pasos**:

1. **Instalar el plugin** dentro de Figma:
   - Abrí Figma → en el archivo `RAFAQ Design System` → menú `Plugins` → `Find plugins` → buscar **"Tokens Studio for Figma"** (autor: Jan Six / Figma Tokens) → **Run**.
   - La primera vez te pide aceptar permisos. Es free para uso personal.

2. **Importar el JSON del repo**:
   - Con el plugin abierto en Figma, pestaña `Tools` → `Load from local file`.
   - Seleccioná `C:\DEV\RAFAQ\app-ganado\design\tokens.json`.
   - El plugin te muestra los token sets detectados: `global`, `light`, `dark`.
   - Confirmá el import.

3. **Activar themes**:
   - En el plugin, pestaña `Themes` (arriba a la derecha) → deberías ver `Campo Profundo · Light` y `Campo Profundo · Dark` ya configurados (vienen en el JSON via `$themes`).
   - Activá uno por vez según diseñes la pantalla light o dark.

4. **Sincronizar con Figma Variables**:
   - Pestaña `Settings` del plugin → activá `Update Figma styles on token change` y `Update Figma variables on token change`.
   - Run `Apply to selection` o `Apply to document` para crear las Variables nativas de Figma con los nombres de tokens.

5. **Workflow ongoing**:
   - **Si cambia un token**: editás `design/tokens.json` en el repo → en Figma `Tools → Load from local file` re-importa → `Apply to document`.
   - **Nunca edites tokens directamente en Figma**. El JSON del repo es la fuente única de verdad para mantener paridad con código (Tamagui también lo va a consumir).

**Costo**: $0 para uso personal. (Hay tier paid para sync con GitHub/GitLab automático — innecesario en MVP.)

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

- [x] Generar Figma Personal Access Token
- [x] `claude mcp add figma ...` con el token
- [x] `claude mcp list` y verificar que `figma` aparece
- [x] `claude mcp add supabase ...` con `--read-only`
- [x] `claude mcp list` y verificar que `supabase` aparece
- [x] Reiniciar Claude Code para que cargue las MCPs nuevas
- [ ] `claude mcp add mobbin --scope user --transport http https://api.mobbin.com/mcp`
- [ ] Reiniciar Claude Code → primer uso dispara OAuth flow → autorizar con cuenta Mobbin Pro
- [ ] `claude mcp list` y verificar que `mobbin` aparece como `connected`
- [ ] (FUTURO, cuando design system esté cerrado) Crear archivo Figma `RAFAQ Design System`
- [ ] (FUTURO) Instalar plugin **Tokens Studio for Figma** dentro del archivo
- [ ] (FUTURO) Importar `design/tokens.json` vía `Tools → Load from local file`
- [ ] (FUTURO) Activar themes light/dark del sistema definitivo
- [ ] (FUTURO) `Apply to document` para generar las Figma Variables

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
