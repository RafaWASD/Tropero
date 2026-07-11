# powersync/ — config del PowerSync CLI

Directorio de config del [PowerSync CLI](https://docs.powersync.com/tools/cli) (linkeado a la
instancia **Development** de PowerSync Cloud). Reemplaza el paso manual de pegar sync rules en el
dashboard: los deploys de sync streams se hacen con `bash scripts/powersync-deploy.sh`.

## Archivos

| Archivo | Qué es | Git |
|---|---|---|
| `cli.yaml` | Link a la instancia (org/project/instance IDs, no secretos) | committeado |
| `service.yaml` | Config del service (conexión de replicación, client auth). La password de la DB queda como `secret_ref` server-side — **no hay secretos en texto plano** | committeado |
| `sync-config.yaml` | **Artefacto generado** — el deploy script lo copia de `sync-streams/rafaq.yaml` | gitignoreado |

**La fuente canónica de las sync streams es `sync-streams/rafaq.yaml`** (la audita Gate 1; la
referencian specs y tests). No editar `sync-config.yaml` a mano.

## Deploy

```bash
bash scripts/powersync-deploy.sh                  # valida + deploya
bash scripts/powersync-deploy.sh --validate-only  # solo valida
```

El script copia `sync-streams/rafaq.yaml` → `sync-config.yaml`, corre `powersync validate`
(schema + test de conexión + sync config contra la instancia) y después `powersync deploy sync-config`
(deploya SOLO sync streams, no toca la config del service).

## Token (setup una vez por máquina)

1. Crear un Personal Access Token en <https://dashboard.powersync.com/account/access-tokens>.
2. Persistirlo a nivel usuario: `setx PS_ADMIN_TOKEN "<token>"` (queda en `HKCU\Environment`;
   el script lo lee de ahí — no hace falta reiniciar terminales). En CI: env var `PS_ADMIN_TOKEN`.

El token es de management de TODA la cuenta — no committearlo nunca; se revoca desde el dashboard.

## Gotchas de esta máquina (Windows + corporativo)

- `powersync login` interactivo **no funciona**: no hay keychain disponible en esta plataforma y el
  prompt de fallback muere sin TTY real (`ExitPromptError`). Por eso el token va por env var/registro.
- Cylance bloquea PowerShell para correr `pnpm dlx` → usar **Git Bash** para el CLI.
- En Git Bash, `reg query ... /v NOMBRE` falla (MSYS convierte `/v` en path) — el script filtra la
  línea con `sed`.
- El CLI está en **beta** con breaking changes recientes (0.8 → 0.9) → versión pinneada en el script.

## Estado de las instancias (2026-07-11)

- **Development** (`6a260fd035ca576ca0dad778`): provisionada, es la que usa la app. Linkeada acá.
- **Production** (`6a260fd10ef84ed6719fd6bf`): existe pero sin provisionar — fuera de alcance por ahora.

Las 4 warnings de `validate` (`AS id, *` puede pisar el alias si la fila trae columna `id`) son las
mismas que muestra el dashboard (`docs/powersync-warnings.png`) — pre-existentes, no bloquean.
