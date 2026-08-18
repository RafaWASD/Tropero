# Rebrand miTropero — lo que queda, paso por paso

**2026-08-17.** Las fases 1 a 5 están hechas (ver `docs/rebrand-mitropero-plan.md`). Esto es el
inventario de lo que **no** está cerrado, con el paso concreto de cada cosa y **qué la desbloquea**.

Ordenado por bloqueo, no por importancia: primero lo que se puede hacer hoy.

| # | Qué | Quién | Bloqueado por |
|---|---|---|---|
| 1 | `MITROPERO_ENV=production` en PROD | Raf (necesita el ref) | nada |
| 2 | Migraciones `0132`+`0133` a PROD | leader, con OK de Raf | nada (salvo saber el estado de PROD) |
| 3 | Sacar el fallback `?? RAFAQ_ENV` | leader | el paso 1 |
| 4 | Sacar la lectura de `X-Rafaq-*` | leader | que no queden builds viejas instaladas **+ medición** |
| 5 | Bundle id + org + slug + scheme (fase 6) | Raf + leader | decisión de publicar en tiendas |
| 6 | Deep links (`.well-known`) | Raf + leader | el paso 5 |
| 7 | `noreply@rafq.ar` → dominio nuevo | Raf | verificar `mitropero.com.ar` en Resend |
| 8 | Logo y assets de `design/` | Raf / diseño | que exista un logo miTropero real |

---

## 1. `MITROPERO_ENV=production` en PROD

**Estado**: DEV hecho (2026-08-17, `health` devuelve `env:"development"`). PROD sin setear.

**Por qué no lo puedo hacer yo**: el ref de PROD **no está en `.env.local`**. Sale de la consola de
Supabase (es el subdominio de la URL del proyecto).

    npx supabase secrets set MITROPERO_ENV=production --project-ref <ref-prod>

⚠️ **Antes de redeployar nada a PROD, verificá qué hay.** En DEV el segundo paso fue
`functions deploy health`, pero no está confirmado que la EF `health` exista en PROD — si no existe,
eso sería un **primer deploy**, no un redeploy, y es otra decisión. El secret solo, sin redeploy, es
inofensivo: no lo lee nadie hasta que la función se despliegue.

**Cómo saber si quedó bien** (una vez que `health` exista en PROD):

    curl -s https://<ref-prod>.supabase.co/functions/v1/health
    # esperado: {"ok":true,"schema_version":"NNNN","env":"production"}

Si dice `env:"unknown"` el secret no llegó. Si dice `"development"`, apuntaste al proyecto equivocado.

---

## 2. Migraciones `0132` y `0133` a PROD

**Estado**: aplicadas **sólo a DEV**. PROD conserva las funciones con los nombres viejos.

**Esto NO está roto hoy**, y conviene entender por qué para no apurarlo mal: PROD es internamente
consistente — sus funciones escriben y leen la GUC `rafaq.*`, y su `resolve_actor` lee el header viejo.
Funciona. El riesgo es **futuro**: la primera migración que se escriba asumiendo el nombre nuevo va a
fallar o, peor, va a dejar la GUC sin efecto en silencio.

**Paso 0, obligatorio**: no aplicar a ciegas. Primero medir qué tiene PROD, porque no está verificado
que su esquema esté al día con el de DEV.

    # 1) qué versión de esquema reporta
    curl -s https://<ref-prod>.supabase.co/functions/v1/health

    # 2) qué funciones nombran todavía una GUC vieja (SQL, contra PROD)
    select p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.prosrc like '%rafaq.%';

Recién con eso se decide si esto es "aplicar dos migraciones" o "PROD está a N migraciones de distancia
y eso es otro problema".

⚠️ **Regla que ya mordió tres veces**: cada `CREATE OR REPLACE` se moldea sobre el cuerpo **vigente en
el remoto** (`pg_get_functiondef`), no sobre la migración que la spec cita. En PROD el cuerpo vigente
puede no ser el mismo que había en DEV.

---

## 3. Sacar el fallback `?? RAFAQ_ENV`

**Desbloquea**: el paso 1, en los **dos** ambientes.

Un solo lugar, `supabase/functions/health/index.ts:58`:

    env: Deno.env.get('MITROPERO_ENV') ?? Deno.env.get('RAFAQ_ENV') ?? 'unknown',

Pasos: sacar el `?? Deno.env.get('RAFAQ_ENV')` → redeploy de `health` en DEV y en PROD → verificar que
**los dos** siguen devolviendo su `env` correcto. Si alguno vuelve a `"unknown"`, el secret nuevo no
estaba puesto ahí y el fallback lo estaba tapando: revertir y volver al paso 1.

**Aparte, y no urgente**: `MITROPERO_CONFIRM_PROD` y `MITROPERO_KNOWN_PROD_REFS` ya son los nombres
canónicos, y los viejos se siguen aceptando con un aviso por stderr (`scripts/lib/env-target.mjs`). No
hay nada que deployar: alcanza con que empieces a tipear el nombre nuevo. Los `LEGACY_*` se sacan
recién cuando estés seguro de que no queda ningún script tuyo ni ninguna nota con el viejo.

---

## 4. Sacar la lectura del header viejo `X-Rafaq-*`

**Este es el que NO hay que apurar.** El rename se hizo en dos tiempos a propósito: el servidor lee los
dos nombres, el cliente escribe sólo el nuevo.

**Las dos condiciones que lo habilitan** (las dos, no una):

1. **No quedan builds instaladas escribiendo el nombre viejo.** Hoy hay TestFlight + el APK de los
   testers de Android, y **no hay OTA** (`app.config.ts` no tiene bloque `updates`). La única forma de
   que un cliente instalado cambie de header es que alguien instale una build nueva a mano.
2. **Medido, no supuesto**: cero tráfico nuevo con el header viejo. La columna no guarda cuál de los
   dos nombres llegó, así que la forma barata es mirar los logs de las Edge Functions antes de sacar
   el fallback.

**Cuando se cumplan, todo junto en un commit**:

- `supabase/functions/_shared/request-headers.ts` → borrar `LEGACY_ACTOR_HEADER`,
  `LEGACY_REQUEST_ID_HEADER` y su entrada en `ACCEPTED_REQUEST_ID_HEADERS`. Con eso `cors.ts` deja de
  publicar el header viejo solo (lo deriva de esa lista).
- Migración nueva que re-CREE `audit.resolve_actor()` y `audit.resolve_request_id()` sin el fallback,
  moldeada sobre el cuerpo vigente en el remoto.
- Los tests que hoy **exigen** la tolerancia: `request-headers.test.ts` y `supabase/tests/audit/run.cjs`
  TA.17 y TA.19. Están escritos para ponerse rojos si alguien limpia antes de tiempo — **ese rojo es la
  pregunta "¿ya no quedan clientes viejos?", no un test desactualizado.**

**Por qué esperar sale barato**: un cliente viejo contra un servidor sin fallback escribe `request_id`
**NULL** en el audit. No rompe nada visible — la correlación se pierde **en silencio**, que para una
feature de auditoría es el peor modo de falla posible. El costo de esperar es un `if` de más en dos
funciones SQL y una entrada de más en `Access-Control-Allow-Headers`.

---

## 5. Fase 6 — bundle id, org, slug y scheme (las cuatro JUNTAS)

**Estado hoy** (`app/app.config.ts`): `APP_ID = 'ar.rafq.app'`, `slug: 'rafaq-app'`,
`scheme: 'rafq'`, `owner: 'rafaqsorg'`.

**El momento es uno solo: antes de publicar en las tiendas.** Un bundle id no se puede cambiar después
de publicar, y ése es el único instante en que las otras tres salen gratis.

**Por qué van juntas y no de a una**:

- El **bundle id** es irreversible una vez publicado.
- El **rename de org** de Expo está **limitado en cantidad por cuenta**: gastar uno en algo que no ve
  ningún usuario es tirarlo. Sólo el Owner puede hacerlo, en *Settings → Organization settings → Rename
  account*. El proyecto está clavado por UUID (`extra.eas.projectId`), así que **renombrar no
  desvincula nada**: builds y credenciales sobreviven.
- El **scheme `rafq`** no es cosmético: es el deep-link de OAuth de la feature 19 y lo usa la página
  publicada `invite.html` (`rafq://invite?token=`). Cambiarlo obliga, todo junto, a build nativa nueva
  + editar el sitio publicado + actualizar los redirect URIs de Apple **y** de Google. Y como no hay
  OTA, **cualquier build ya instalada deja de responder al scheme nuevo y no hay forma de arreglarla
  remotamente**.

**Orden cuando se haga**:

1. Raf renombra la org en el dashboard de Expo.
2. `app.config.ts`: `APP_ID` → `com.mitropero.app`, más `slug`, `owner` y `scheme`.
3. Actualizar los redirect URIs en Apple y en Google (OAuth de la feature 19).
4. Editar la página publicada `invite.html` para el scheme nuevo.
5. Regenerar credenciales y build nativa nueva. ⚠️ **Build de EAS = OK explícito y por plataforma.**
6. Recién ahí, el paso 6.

---

## 6. Deep links y `.well-known`

**Depende del paso 5**: los dos archivos se firman contra el **bundle id final**. Hacerlos antes es
trabajo tirado.

1. En `app.config.ts`: `ios.associatedDomains: ['applinks:mitropero.com.ar']` +
   `android.intentFilters` con `autoVerify` para `https://mitropero.com.ar/invite`. Hoy **no están**.
2. Servir `/.well-known/apple-app-site-association` (appID `<TeamID>.<bundle>`, Team `5C9KYFJCU5`).
3. Servir `/.well-known/assetlinks.json` (package + el SHA-256 que sale de `eas credentials`).
4. Página de fallback (redirect al scheme + instrucciones).
5. Rebuild y verificación **en device** — esto no se puede verificar desde web.

⚠️ **El agujero mayor sigue siendo otro**: la app **no está en las tiendas**. La página le sirve a quien
ya la tiene instalada; al que no, todavía no hay de dónde bajarla.

---

## 7. `noreply@rafq.ar`

**No es un olvido, y hay un guard que lo protege**: la regla E de `brand-name-guard.test.ts` **exige**
que la dirección siga como está. Resend verifica el **dominio**, no el display name — que ya dice
"miTropero" (`supabase/functions/_shared/email.ts`).

**Pasos**: verificar `mitropero.com.ar` en Resend (registros DNS) → recién entonces cambiar la
dirección, actualizar la regla E del guard, y mandar un mail de prueba real.

Si se cambia **antes** de verificar el dominio, los mails dejan de salir: invitaciones caídas, en
silencio.

---

## 8. Logo y assets de `design/`

`design/stitch-iter-1/09-rafaq-logo.png` y compañía (~15 archivos) son el **logo RAFAQ**. Renombrar los
PNG es cosmético; lo que falta es el **asset visual de miTropero**, que es trabajo de diseño y no de
rename.

El wordmark de la app **ya dice "miTropero"** (`AuthScreenShell.tsx`), con su `lineHeight` explícito
porque "miTropero" tiene descendente (la `p`) y "RAFAQ" no tenía ninguna.

---

## Lo que SIGUE diciendo "rafaq" a propósito

Para no volver a auditarlo: las migraciones históricas (son append-only, registran lo que se aplicó ese
día), `rafaq.db` (la SQLite local de PowerSync — renombrarla deja huérfana la base de todo device
instalado, y está declarada como exención en `brand-name-guard.test.ts`), `rafaq-beta` (instancia de
PowerSync), `progress/` (historial), y los paths `C:\DEV\RAFAQ\`.

Las **ocho claves de storage `rafq.*`** ya tienen su propio guard declarado
(`app/src/services/storage-keys-guard.test.ts`): renombrar cualquiera nace en rojo, con el motivo
escrito. No entran en este rebrand — su rename correcto es una migración de claves, no un swap de
literal.
