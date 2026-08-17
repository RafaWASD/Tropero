# powersync/ — config del PowerSync CLI

Directorio de config del [PowerSync CLI](https://docs.powersync.com/tools/cli) (linkeado a la
instancia **Development** de PowerSync Cloud). Reemplaza el paso manual de pegar sync rules en el
dashboard: los deploys de sync streams se hacen con `bash scripts/powersync-deploy.sh`.

## Archivos

| Archivo | Qué es | Git |
|---|---|---|
| `cli.yaml` | Link a la instancia (org/project/instance IDs, no secretos) | committeado |
| `service.yaml` | Config del service (conexión de replicación, client auth). La password de la DB queda como `secret_ref` server-side — **no hay secretos en texto plano** | committeado |
| `sync-config.yaml` | **Artefacto generado** — el deploy script lo copia de `sync-streams/mitropero.yaml` | gitignoreado |

**La fuente canónica de las sync streams es `sync-streams/mitropero.yaml`** (la audita Gate 1; la
referencian specs y tests). No editar `sync-config.yaml` a mano.

## Deploy

```bash
bash scripts/powersync-deploy.sh                  # valida + deploya
bash scripts/powersync-deploy.sh --validate-only  # solo valida
```

El script copia `sync-streams/mitropero.yaml` → `sync-config.yaml`, corre `powersync validate`
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

## Estado de las instancias (2026-07-16)

- **Development** (`6a260fd035ca576ca0dad778`): provisionada, es la que usa la app en dev. Linkeada por
  `cli.yaml`. Conexión → `db.xrhlxxdnfzvdnztacofj.supabase.co`.
- **Production** (`6a260fd10ef84ed6719fd6bf`): **provisionada y replicando** (Run F, 2026-07-16).
  Conexión → `db.bcrsgekkfcdpwvkebsqe.supabase.co` (`Status: connected`, initial replication done,
  lag 0). Sync streams canónicas (`mitropero.yaml`) deployadas. Linkeada por `cli.prod.yaml`; deploy con
  `bash scripts/powersync-deploy.sh --env prod` (exige `MITROPERO_CONFIRM_PROD=1`; el nombre PRE-rebrand
  `RAFAQ_CONFIRM_PROD` se sigue aceptando con un aviso — ver `docs/backlog.md`).

### `--env prod` saltea el connection-test de `validate` (a propósito)

`powersync validate` prueba la conexión descrita en `service.yaml` **local**, que apunta a la DB de
**dev** (`db.xrhlxxdnfzvdnztacofj`). Con `--env prod` el CLI resuelve el secret `default_password` de la
instancia prod pero lo probaría contra ese host de dev → falso "password authentication failed for user
powersync_role". Por eso el deploy script corre `validate --skip-validations=connections` en prod (sigue
validando schema + sync-config). **La conexión de prod se gestiona en el dashboard de PowerSync** (este
script solo deploya sync-config, nunca service-config) y se valida aparte con
`pnpm dlx powersync@0.10.0 status --instance-id 6a260fd10ef84ed6719fd6bf` → `Status: connected`.

Las 4 warnings de `validate` (`AS id, *` puede pisar el alias si la fila trae columna `id`) son las
mismas que muestra el dashboard (`docs/powersync-warnings.png`) — pre-existentes, no bloquean.
