# Rebrand — preparación de las fases 3 (PowerSync), 4 (GUCs) y 5 (headers)

**2026-08-16** · Relevamiento read-only hecho mientras corría la fase 2. Tres correcciones al plan y una
decisión de diseño que el plan no resuelve. Se pliega a `docs/rebrand-mitropero-plan.md` al ejecutarlas.

---

## Fase 3 (PowerSync) — no necesita deploy, y no colisiona con la fase 2

`docs/rebrand-mitropero-plan.md` §4.E pide *"renombrar el archivo + todas las refs + **re-deploy de
PowerSync**"*, y avisa del riesgo de que los nombres de streams lleven "rafaq" y fuercen re-sync.

Dos cosas medidas:

**1. Los nombres de streams no llevan el nombre viejo.** Son `catalog_species`, `self_user_private`,
`est_establishments`, etc. La única mención adentro del YAML es el **comentario de la línea 1**. No hay
re-sync de devices.

**2. El nombre del archivo es local.** `scripts/powersync-deploy.sh:76` hace:

```
cp sync-streams/rafaq.yaml powersync/sync-config.yaml
```

Lo que se deploya es `sync-config.yaml`, un artefacto. Renombrar la fuente **no cambia nada de lo que
ve la instancia**. Lo único que cambia de contenido es el comentario de la línea 1.

**Consecuencia**: la fase 3 **no necesita Gate 1 ni deploy**. Es rename + refs. El deploy queda
pendiente como cosmético (un comentario) y viaja gratis con el próximo cambio real de sync rules —
gastar una autorización de deploy en un comentario no tiene sentido.

Refs a actualizar: `.gitignore` · `app/src/services/powersync/{local-reads,schema}.ts` ·
`feature_list.json` · `scripts/powersync-deploy.sh` · 4 migraciones (comentarios) ·
5 suites de `supabase/tests/*/run.cjs` · `powersync/README.md`.

**Sin colisión con la fase 2**: ninguno de esos archivos contiene globals `__rafaq*`. Verificado.

---

## Fase 4 (GUCs) — el plan sobreestima el riesgo

`docs/rebrand-mitropero-plan.md` §4.C dice que hay que cambiar *"TODOS los `set_config`/`current_setting`
en el cliente y en RPCs, **en sync**"*, y que *"el cliente setea `set_config('rafaq.is_auto_transition',
'on', true)`"*.

**Medido: el cliente no setea ninguna GUC.**

```
git grep -nE "set_config|current_setting" -- app supabase/functions
→ cero resultados
```

Las dos GUCs viven **enteramente dentro de Postgres**, en funciones `SECURITY DEFINER`:

| GUC | Se setea en | Se lee en |
|---|---|---|
| `rafaq.is_auto_transition` | `0031_category_transitions.sql:72,76` | `0021:70` · `0030:34` · `0040:22` |
| `rafaq.is_transfer` | `0087_transfer_animal_rpc.sql:213,217` · `0122:413,415` | `0088:41` · `0127:150` |

**Consecuencia**: no hay skew cliente/servidor posible. La fase 4 es **una migración atómica** que
re-crea las funciones con el nombre nuevo — no un deploy coordinado. Baja de 🔴 a 🟠.

**Sigue vigente** el cuidado de `reference_function_recreate_base`: moldear cada `CREATE OR REPLACE`
sobre el cuerpo **vigente en el remoto**, no sobre la migración que la spec cita. `transfer_animal` fue
redefinida en `0122` después de `0087`, y el trigger de `0127` lee la GUC además de `0088`.

### Y una tercera GUC que NO existe

`rafaq.actor_id` aparece en `specs/active/18-audit-log/requirements.md` y en `progress/current.md`, pero
**no está en ninguna migración**. Es una nota sobre una *divergencia de mecanismo* marcada para Gate 1,
no una GUC viva. No hay nada que renombrar.

---

## Fase 5 (headers) — el problema que el plan no resuelve

El plan dice: *"Backend (migración + funciones) junto o antes del OTA del frontend."* Eso alcanza para
la web (donde el skew rompe por CORS y se nota), pero **no para los clientes ya instalados**.

### El mapa completo

| Punta | Archivo | Header |
|---|---|---|
| Cliente | `app/src/services/account.ts:127` · `members.ts:152` · `push-notifications.ts:88` | `X-Rafaq-Request-Id` |
| Admin client de las EF | `supabase/functions/_shared/supabase.ts:34,35` | los dos |
| Lector en la EF | `supabase/functions/_shared/serve.ts:30` | `X-Rafaq-Request-Id` |
| Allow-Headers de CORS | `supabase/functions/_shared/cors.ts:9` | `x-rafaq-request-id` |
| Lector en la DB | `0124_audit_log.sql:107` | `x-rafaq-actor` |
| Lector en la DB | `0131_audit_request_id.sql:40` | `x-rafaq-request-id` |
| Tests | `supabase/tests/audit/run.cjs:322,326,340,344` | `X-Rafaq-Actor` |

### Por qué el corte seco pierde datos

Hay **builds ya instaladas afuera** (TestFlight + el APK de los testers de Android). Un OTA no llega
instantáneamente y una build nativa no llega nunca sin que el tester actualice a mano. Con corte seco:

> cliente viejo manda `X-Rafaq-Request-Id` → servidor nuevo sólo mira `x-mitropero-request-id` → el
> `request_id` entra **NULL** en el audit log. No rompe nada visible: **la correlación se pierde en
> silencio**, que es el peor modo de falla para una feature de auditoría.

### La forma que lo evita: leer los dos, escribir uno

Rename de header en dos tiempos, sin ventana de pérdida:

1. **Servidor primero, tolerante**: `serve.ts` y las dos funciones SQL leen **el nombre nuevo y, si no
   está, el viejo**. `cors.ts` publica **los dos** en Allow-Headers. Deploy. En este punto los clientes
   viejos siguen andando exactamente igual.
2. **Clientes después**: pasan a escribir sólo el nombre nuevo.

   ⚠️ **Corrección a lo que escribí más arriba en este mismo documento**: hablé de "OTA + próxima build
   nativa". **No hay OTA.** `app/app.config.ts` no tiene bloque `updates` — expo-updates es trabajo de
   la Fase 0 y está pendiente. O sea que la ÚNICA forma de que un cliente instalado cambie de header es
   que el tester instale una build nueva a mano. Eso puede no pasar nunca.

   Lo cual no debilita el argumento del rename en dos tiempos: **lo vuelve obligatorio.** Con corte
   seco, el TestFlight y el APK que están hoy en la mano de los testers quedan escribiendo el header
   viejo por tiempo indefinido, y todo lo que hagan entra al audit sin `request_id`.
3. **Limpieza, cuando no queden clientes viejos**: se saca el fallback y el header viejo de CORS. Es una
   fase aparte, con su propio commit, y **no es urgente**.

El costo es un `??` en dos lugares y una entrada de más en CORS durante un tiempo. Lo que compra es que
**ningún orden de deploy pierda correlación**, que es justamente lo que el plan intenta conseguir
pidiendo un orden.

**Decisión**: se hace así salvo que Raf diga lo contrario. El paso 3 queda anotado en `docs/backlog.md`
al ejecutar el paso 1.

### Efecto colateral bueno

El árbol está rojo hoy **por estas tres líneas del cliente** (el guard de marca, regla A). El paso 2
las limpia y devuelve el baseline a verde. El paso 1 solo no alcanza para eso.

---

## Fase 6 (identidad Expo) — deja de ser una incógnita

El plan la marca 🔴 ALTO riesgo y pregunta *"¿renombrar la org en el dashboard, o crear proyecto
nuevo?"*. Con lo relevado, la pregunta se contesta casi sola.

### El proyecto está clavado por UUID, no por nombre

`app/app.config.ts:160` → `extra.eas.projectId: 'd8cf3a19-e8f7-4d7f-b417-54123e7f0d3e'`.

Builds, credenciales y updates cuelgan de **ese UUID**. `owner` y `slug` son metadata de display y
ruteo. Y la doc de Expo dice explícitamente que las credenciales de Android/iOS guardadas en sus
servidores sobreviven a un rename de cuenta.

**Conclusión: renombrar la org NO desvincula nada, y crear un proyecto nuevo sería tirar el historial
de builds y las credenciales a la basura para resolver un problema que no existe.** La opción "proyecto
nuevo" queda descartada.

Dos salvedades reales:
- Sólo el **Owner** puede renombrar, desde *Settings → Organization settings → Rename account*. Es
  trabajo de Raf en el dashboard; no lo puede hacer nadie más.
- Expo permite renombrar una cuenta **un número limitado de veces**. No es reversible a voluntad.

### El `scheme: 'rafq'` es otra cosa, y la recomendación es NO tocarlo

No es cosmético como `owner`/`slug`. Es el deep-link de OAuth de la feature 19, y además la página
publicada `invite.html` arma `rafq://invite?token=`. Cambiarlo obliga, todo junto: build nativa nueva,
editar el sitio publicado, y actualizar los redirect URIs de Apple y Google. Y como **no hay OTA**,
cualquier build ya instalada deja de responder al scheme nuevo.

A cambio de qué: **de nada visible.** Ningún usuario ve un URL scheme.

**Recomendación: `rafq://` se queda hasta que la app esté en las tiendas**, y se cambia junto con el
bundle id, en el único momento en que sale gratis. Anotarlo en `docs/backlog.md`, no ejecutarlo ahora.

### Lo que queda para Raf, entonces

Una sola pregunta, no dos: **¿renombramos `rafaqsorg` → `mitropero` en el dashboard de Expo ahora**
(sabiendo que el cupo de renames es limitado), **o lo dejamos para cuando se toque el bundle id?**
Es interno y no lo ve nadie; la única razón para hacerlo ahora es no dejar el rebrand a medias.

---

## Fase 7 — los restos que NINGUNA fase del plan cubre (medido en `80c7022`)

Auditando lo que queda de "rafaq" fuera de `progress/`, aparecieron **152 archivos** y varias clases que
el plan de 6 fases **no le asignó a ninguna**. No es que estén mal hechas: nunca estuvieron agendadas.

### 1. `@rafaq-test.local` — 43 ocurrencias, y la fase 2 no las podía tomar

El plan puso los fixtures en la Cat. G, dentro de la fase 2, pero acotó la categoría a *"los
helpers/fixtures de `app/e2e/`"*. La fase 2 renombró `rafaq-e2e.test` y dejó `@rafaq-test.local`, que
vive en **20 suites backend + `scripts/seed-facundina.mjs`**, o sea fuera de `app/`.

Riesgo: bajo (es un dominio de fixture), pero hay un efecto de segundo orden ya anotado por la fase 2 en
`docs/backlog.md`: el purgado manual del remoto enumeraba **un** dominio y ahora conviven **tres**
(`@rafaq-test.local` vivo, `@mitropero-e2e.test` nuevo, `@rafaq-e2e.test` residuo). El teardown de la
E2E no barre por dominio (usa ids trackeados + `RUN_TAG`), así que no hay barrido roto — pero el
purgado a mano sí quedó desactualizado.

### 2. Directorio de backups — Cat. H del plan, sin fase asignada

`~/.rafaq-backups/` y el prefijo `rafaq-prod-<ISO>.sql.gz` (14 + 16 ocurrencias) en
`scripts/backup-db.mjs`, `.gitignore` y `.github/workflows/backup-prod.yml`. El plan la marca 🟡 BAJO y
la describe, pero la lista de fases del §5 **no la incluye**. Los backups ya existentes se quedan donde
están: no se migran, son locales.

### 3. Env vars y secrets — acoplamiento externo, hay que ordenarlas

- `RAFAQ_ENV` es un **secret ya seteado en Supabase**. Renombrarlo exige setear el nuevo **antes** de
  deployar el código que lo lee, o las funciones se quedan sin ambiente. Mismo patrón de dos tiempos que
  la fase 5.
- `RAFAQ_CONFIRM_PROD` y `RAFAQ_KNOWN_PROD_REFS` son guardas que **Raf tipea a mano** y que además usa
  `.github/workflows/backup-prod.yml`. Renombrarlas rompe su memoria muscular y el workflow a la vez.

### 4. `rafaq-beta` — el nombre de la instancia de PowerSync

7 ocurrencias. Es un recurso **externo**, en el dashboard de PowerSync. Mismo tipo de decisión que la org
de Expo: lo ve nadie, y renombrarlo puede tocar la URL de la instancia. **Recomendación: dejarlo**, y si
se hace, con el mismo criterio que Expo (junto a otro cambio que ya obligue a tocar la config).

### 5. Assets de diseño — Cat. I, bloqueada de verdad

`design/**` con 73 ocurrencias, incluidos los PNG `07-inicio-rafaq.png`, `09-rafaq-logo.png`,
`09b-rafaq-logo-v2.png`. **Bloqueada por el logo real de miTropero**, que todavía no llegó. Renombrar los
PNG es cosmético; el asset visual es trabajo de diseño.

### Qué haría, en orden

1. **`@rafaq-test.local` en las suites backend** — es lo único de esta lista que es puro texto sin
   acoplamiento externo, y es el grupo más grande. Verificable corriendo las suites.
2. **Directorio de backups** — chico, y hay que tocar el workflow de CI junto con el script.
3. **Env vars** — con el mismo cuidado de dos tiempos que la fase 5, y coordinando con Raf porque las
   tipea él.
4. **`rafaq-beta` y los assets** — no ahora.
