# Contexto — feature 20: reactividad de lecturas sincronizadas (Gate 0)

> **Estado**: ✅ **Gate 0 APROBADO por Raf (2026-07-19)** → `context_ready`. Próximo: `spec_author`.
> **Origen**: backlog `2026-07-18 — PowerSync no reconecta / no re-evalúa buckets nuevos sin reiniciar la app`.
> El título del backlog resultó **equivocado en su diagnóstico**; ver §1.

## 1. Qué pasa realmente (el reporte apuntaba al lugar equivocado)

**Síntoma reproducido por Raf** (Android A07, 2026-07-18): creó un campo server-side; con la app **viva, online y conectada**, el campo **no apareció**. Tampoco tras un toggle de modo avión. Solo apareció al **cerrar y reabrir** la app.

**El backlog lo atribuyó a que PowerSync no reconecta ni re-evalúa buckets. Es falso.** Verificado:

- PowerSync **sí** re-evalúa las parameter queries en caliente para conexiones ya establecidas. Documentado en `docs.powersync.com/architecture/powersync-service`: *"The Service then continuously monitors for buckets that are added or removed... and streams those changes"*. El mecanismo por-checkpoint y por-conexión-viva está descrito en `powersync-ja/powersync-service#200`.
- `org_scope` (`sync-streams/rafaq.yaml:33`) depende de `user_roles`, que **sí** se replica: la publication es `FOR ALL TABLES` (lo prueba el test `TA.11` de la suite de audit).
- Las 31 streams tienen `auto_subscribe: true` → no falta ninguna suscripción.

**Conclusión**: la fila del campo nuevo **estaba en el SQLite local todo el tiempo**. El bug es de **lectura**, no de sync. Lo que falla es que nadie la vuelve a leer.

## 2. Causa raíz (verificada en código)

`app/src/contexts/EstablishmentContext.tsx:333-350` — el único disparador reactivo de las membresías tiene un **latch de un solo disparo**:

```js
let lastHasSynced = db.currentStatus?.hasSynced === true;
const dispose = db.registerListener({
  statusChanged: (status) => {
    const nowSynced = status?.hasSynced === true;
    if (nowSynced && !lastHasSynced) { lastHasSynced = true; void refreshEstablishments(); }
    // No regresamos lastHasSynced a false
  },
});
```

Tras el primer sync, `lastHasSynced` queda en `true` para siempre en ese proceso → **todo `statusChanged` posterior es no-op**. El toggle de modo avión dispara el listener, pero `hasSynced` sigue `true` y el guard lo descarta. Reabrir la app re-corre el bootstrap: por eso "se arregla" reiniciando.

### 2.1 Tiene un gemelo, peor

`app/src/contexts/RodeoContext.tsx:154-168` — mismo latch **más un segundo candado**: `if (isWaitingRef.current)` (línea 163). Una vez que el contexto resolvió a `active`, el listener es no-op **garantizado** aunque `hasSynced` transicione. Efecto: un rodeo creado/borrado/renombrado por un coworker no aparece ni desaparece del selector mientras la app viva.

### 2.2 El fallback documentado no existe

`EstablishmentContext.tsx:331-332` afirma:

> *"La reactividad ante cambios de coworker (roles agregados/quitados tras el first-sync) queda DIFERIDA: la cubre el useFocusEffect / refresh manual existente de las pantallas."*

**Es falso y pasó review por eso.** `refreshEstablishments` tiene 5 llamadores reales (`editar-campo.tsx:134`, `invite.tsx:111`, `mas.tsx:633`, `mas.tsx:888`, `EstablishmentContext.tsx:273`) y **los cinco son post-acción-del-propio-usuario** — justo el caso que no necesita reactividad. Ninguno es un `useFocusEffect`. El gap que el comentario declara cubierto está abierto.

(Para `RodeoContext` la promesa **sí** se cumple parcialmente: `rodeos.tsx:67-70` tiene un `useFocusEffect` real, pero solo en `/rodeos`; el selector de la home sigue viejo.)

## 3. El fix ya está en el repo, seis veces

No hay que inventar nada ni migrar a `useQuery`. El patrón canónico —`useStatus()` de `@powersync/react` + `lastSyncedAt.getTime()` como dep **primitiva**, re-leyendo en **cada** avance de sync— ya está implementado en 6 lugares: `animales.tsx:196`, `(tabs)/index.tsx:472`, `ProfileContext.tsx:165`, `useGroupView.ts:342`, `useManeuverGating.ts:115`, `mas.tsx:127`. `ProfileContext.tsx:161` incluso se auto-documenta como *"mismo patrón canónico"*.

`EstablishmentContext` y `RodeoContext` son **los únicos dos** que quedaron con la variante rota. No es desconocimiento: es que estos dos no recibieron el tratamiento.

**Alcance del fix**: reemplazar los dos bloques `registerListener`/`lastHasSynced` por el patrón `lastSyncedMs`. Sin cambios de firma pública, sin migración de arquitectura.

## 4. Decisiones de Raf (Gate 0)

**D1 — Revocación en caliente**: si al usuario le revocan el acceso al campo que tiene abierto, **nunca se lo patea en medio de una maniobra**. Si hay maniobra en curso se respeta hasta terminarla y se avisa al cerrarla; fuera de maniobra, salida con aviso claro.

> **D1.1 — ACOTADO A NAVEGACIÓN (ratificado 2026-07-19, tras conocer E2).** D1 gobierna **la navegación y el aviso**, NO la preservación de los datos: no se saca al usuario de la pantalla y el aviso se difiere al cierre de la maniobra. Que las filas locales desaparezcan cuando PowerSync borra el bucket (E2) **queda fuera de esta feature**. Se acota así a propósito: prometer que la maniobra sobrevive entera sería mentir mientras E2 esté abierto.

> **D1.2 — ACOTADO A LA VIGENCIA DE LA SESIÓN (decisión de Raf, 2026-07-19, tras Gate 1 HIGH-1).**
> D1 tal como estaba redactado ("**nunca** se lo patea en medio de una maniobra") **no se puede cumplir entero**, y el motivo se verificó en código: `remove_member` no solo desactiva el rol — también llama a `revoke_user_sessions` (`supabase/functions/remove_member/index.ts:107`), que hace `delete from auth.sessions where user_id = target_uid` (`0072:46`). El access token vigente sigue sirviendo hasta `jwt_expiry = 3600` (`supabase/config.toml:160`), pero al vencer el refresh falla → `onAuthStateChange` emite `session = null` (`AuthContext.tsx:114-115`) → el `RootGate` rutea a login **con la maniobra abierta**. `EstablishmentContext` no puede evitarlo: auth vive por encima suyo.
>
> **`revoke_user_sessions` se queda como está** — matar la sesión al remover a alguien es correcto y fue una decisión deliberada (H1-1, tras revisión empírica). Lo que cambia es **la promesa**, que pasa a ser una garantía acotada:
>
> | Causa | Sesión | Ventana real del diferimiento |
> |---|---|---|
> | **Remoción de miembro** (`remove_member`) | revocada (`0072`) | ≤ `jwt_expiry` (3600 s, no lo controlamos nosotros). Termina en **login**, no en `/campo-perdido`. |
> | **Campo borrado** (trigger `0076`) | intacta | ilimitada: el diferimiento se cumple entero hasta que el usuario salga de la maniobra. |
>
> Consecuencias que la spec **debe** sostener: (a) nada puede prometer que la maniobra sobrevive a una remoción de miembro; (b) la pérdida de lo cargado y no subido cuando cae la sesión es **E2**, fuera de alcance por D3; (c) las dos causas de E5 siguen siendo indistinguibles **en la firma local**, pero **no** en la duración de la ventana — son cosas distintas y la spec las trata por separado.

**D2 — Alcance**: membresías (`EstablishmentContext`) **+ barrido del patrón**. El barrido ya se hizo; resultados en §5.

**D3 — E2 sale como feature aparte** (2026-07-19). Es pérdida de datos silenciosa: merece spec propia, Gate 1 propio y su propio diseño de recuperación. Meterla acá infla la feature y retrasa el fix del bug reportado. Queda en el backlog con toda la evidencia.

**D4 — `lotes.tsx` entra** (2026-07-19). Es el único **mount-only** del barrido (no se actualiza nunca, ni al re-enfocar): mismo fix, misma forma de testearlo, más barato adentro que como ticket suelto.

## 5. Qué queda FUERA de esta feature (al backlog)

El barrido encontró más superficies con lectura imperativa, pero **no todas son de esta feature**:

| Lugar | Qué no se ve | Decisión |
|---|---|---|
| `RodeoContext.tsx:154` | rodeos creados/borrados por coworkers | **DENTRO** (mismo bug, mismo fix) |
| `lotes.tsx:115` | lotes de otros — es **mount-only**, ni siquiera focus | **DENTRO** (D4: único mount-only; mismo fix) |
| `miembros.tsx:142`, `use-reports.ts:111`, `animal/[id].tsx:274`, `export-sigsa.tsx:86`, `maniobra.tsx:97` | cambios de coworkers; se corrigen al re-enfocar | **backlog** (focus-only es degradado, no roto) |

**Deuda de arquitectura, explícitamente NO en scope**: la app tiene **cero** watched queries reales (`useQuery`/`db.watch`); toda la reactividad es una emulación manual sobre la señal de status. Es deuda **deliberada y ya documentada** (`design.md:712`, `backlog.md:417` desde 2026-06-09). Esta feature **no** la salda — solo arregla los dos contextos que quedaron con la variante rota del patrón vigente. Migrar a watched queries es una decisión de arquitectura aparte (ADR).

## 6. Edge cases a resolver en la spec

**E1 — Falso `active_lost` por sync parcial.** Es la razón por la que el latch existe ("evitamos falsos active_lost por downloads parciales"). Al re-leer en cada avance de sync, hay que garantizar que un estado transitorio no se interprete como "perdiste acceso". A favor: los checkpoints de PowerSync son consistentes (`lastSyncedAt` avanza al aplicar un checkpoint completo, no a mitad). **La spec debe demostrarlo, no asumirlo** — y distinguir "lista vacía" (probablemente transitorio) de "lista poblada sin el campo activo" (revocación real).

**E2 — ⛔ FUERA DE SCOPE (D3): pérdida silenciosa de writes al revocarse el acceso.** Cuando `org_scope` deja de incluir el campo, **PowerSync borra el bucket** → las filas locales **desaparecen del SQLite**. Peor: los writes ya encolados en el outbox se suben igual y **rebotan por RLS** (42501 → rechazo permanente → `rollbackOverlay`) → **se pierde el trabajo cargado por el operario**, hoy en silencio.
  Escenario raro (te tienen que revocar el acceso justo mientras cargás) pero con el peor modo de falla posible para este producto: el peón cargó veinte animales en la manga y desaparecen sin que nadie le avise.
  **Sale como feature propia** (ver backlog). Esta feature NO lo resuelve; por eso D1 se acotó a navegación (D1.1). La spec de la 20 **no debe** prometer preservación de datos ante revocación.

**E3 — Loop de re-lectura.** La dep tiene que ser un primitivo (ms), no el objeto de status. Ya resuelto y documentado en el patrón canónico (`ProfileContext.tsx:162`).

**E4 — Offline puro.** Sin ningún sync, `lastSyncedMs === 0` → el efecto no dispara. El patrón canónico ya lo contempla (`ProfileContext.tsx:167`).

**E5 — Campo activo borrado (no revocado).** ¿Mismo tratamiento que la revocación, o distinto? Un borrado es definitivo; una revocación puede revertirse.

## 7. Gates

- **Gate 1 (spec, seguridad)**: **probablemente sí**. D1 implica que un usuario sigue viendo datos de un campo al que ya no tiene acceso durante una ventana acotada. La frontera de autorización real (RLS + streams) no se toca, pero la decisión es de control de acceso y merece revisión.
- **Gate 2.5 (E2E + capturas)**: sí, hay UI (aviso de revocación, aparición en caliente del campo/rodeo).
- **E2E**: es testeable — crear la membresía server-side a mitad de test y assertear que la UI se actualiza **sin reiniciar**.

## 8. Reconciliación de specs al cerrar

- `specs/active/01-identity-multitenancy/` — `EstablishmentContext` y el gate `active_lost`.
- `specs/active/15-powersync/design.md:712` — la nota de "reactividad diferida" hay que acotarla: sigue siendo cierta como deuda, pero deja de aplicar a estos dos contextos.
- El comentario mentiroso de `EstablishmentContext.tsx:331-332` se corrige junto con el código.
