# Gate 2 (security_analyzer modo code) — spec 02 C3.3 "Dar de baja / egreso de animal"

**Veredicto: PASS** — sin findings HIGH. (2026-06-07)

> El agente corrió la skill `sentry-skills:security-review` sobre el changeset de C3.3. El backend
> (RPC `exit_animal_profile`, `0044`, SECURITY DEFINER) NO se tocó en este chunk y ya pasó Gate 1
> (SEC-SPEC-01). Reporte persistido por el leader (el subagente no escribe archivos de findings).

## Alcance auditado
Nuevos: `app/app/animal/baja.tsx`, `app/src/services/exit-animal.ts`, `app/src/services/exit-animal.test.ts`.
Modificados: `app/src/services/animals.ts` (`exitAnimalProfile` + `fetchAnimalDetail` extendido), `app/app/animal/[id].tsx` (gating `canExit` + modo archivada), `app/app/_layout.tsx`, `app/e2e/animals.spec.ts`.

## Resultados por foco

### 1. Authz / IDOR — OK
- El write va 100% por `supabase.rpc('exit_animal_profile', …)`. NO hay `.update()`/`.insert()` directo sobre `animal_profiles` desde el cliente → la baja no puede saltear el RPC.
- El RPC re-valida `has_role_in(v_est) AND (is_owner_of(v_est) OR v_creator = auth.uid())` con el `establishment_id` del **propio animal** (`0044`:38-51), no con el del cliente → un `profileId` de otro tenant (param de ruta, attacker-controlled) recibe `42501`.
- El gating de cliente `canExit` es conservador: si el animal es de otro campo (`detail.establishmentId !== activeEstId`) NO usa el owner-flag del contexto activo, habilita solo por `createdBy === userId`. No es barrera de seguridad y no se presenta como tal.
- Sin leak por el gating: decide con datos que el usuario ya ve de SU animal; `createdBy` se usa solo en `=== userId`, no se renderiza.

### 2. Leak de errores — OK
`classifyExitError` (`exit-animal.ts`:94-111) mapea los 5 paths (network/42501/23503/23514/unknown) a **constantes** de `COPY`; nunca devuelve `error.message`/`sqlerrm`. `baja.tsx`:171 renderiza siempre una de esas constantes. `exit-animal.test.ts` aserta explícitamente que el sqlerrm crudo no se filtra. Sin `console.log`/Sentry del error crudo.

### 3. Input validation — OK
| campo | límite | validación |
|---|---|---|
| Peso (kg) | live ≤4 díg + 1 sep; submit `>0` y `<10000`; server `numeric` | server (tipo) + cliente |
| Precio ($) | live ≤13 chars + 1 sep; submit `>0` y `<1e9`; server `numeric` | server (tipo) + cliente |
| Fecha | live mask `AAAA-MM-DD`; submit formato+rango+no-futura; server `date` | server (tipo) + cliente |

ReDoS descartado empíricamente: las regex (`^\d+(\.\d+)?$`, alternación de network) son lineales (<0.4ms con inputs patológicos de 50k–200k chars).

### 4. Idempotencia / abuso — OK
La baja es un `UPDATE` no-destructivo e idempotente. Doble-tap cubierto por `busyRef` (guard sincrónico ANTES del primer `await`) + botón `disabled`. Mutación autenticada, barata, no manda email/SMS ni pega a API externa ni es bulk → no requiere rate-limit propio.

## MEDIUM (anotado, NO bloquea — al backlog)
- **MED-01** — `exit_weight`/`exit_price` sin `CHECK > 0` a nivel DB (el único backstop server es el tipo `numeric`). Un valor negativo/absurdo pegado directo al RPC (saltando el validador de cliente) se persistiría, pero solo ensucia analytics del **propio** tenant (no cruza frontera de seguridad). No es de este chunk (backend no se tocó). → `docs/backlog.md` 2026-06-07.

## LOW
- `archivedBadgeLabel` interpola `exitDate` ISO crudo en el badge — dato del propio tenant ya validado como `date` por el server; `Text` de Tamagui no interpreta markup → sin riesgo de inyección. Formateo bonito = refinamiento UX.

**Conclusión**: `PASS → security_code_02-c3.3-baja`. Combinado con el reviewer (pendiente al escribir esto) y el check verde, el chunk queda listo para la puerta de código humana.
