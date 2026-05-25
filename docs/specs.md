# Spec Driven Development (SDD) — Proceso

> Flujo Kiro-style: requirements → design → tasks → code. El código no se escribe hasta que el spec está aprobado por un humano.

## Estructura

Cada feature `"sdd": true` tiene `specs/active/<feature-name>/` con tres archivos:

- `requirements.md` — QUÉ se construye (EARS)
- `design.md` — CÓMO se construye
- `tasks.md` — PASOS concretos

`<feature-name>` = campo `name` de `feature_list.json` (ej: `01-identity-multitenancy`).

## Estados

```
pending → [spec_author] → spec_ready → ⏸ HUMANO APRUEBA → in_progress → [implementer → reviewer] → done
```

## La puerta de aprobación humana

El flujo se detiene **una sola vez**: cuando `spec_author` termina los 3 archivos, marca `spec_ready` y para. El humano lee `specs/active/<feature>/` y dice "aprobado" (o pide cambios). Solo entonces el leader hace `spec_ready → in_progress` y lanza al implementer.

## requirements.md — EARS estricto (español)

Cada requirement es un párrafo numerado (`R1`, `R2`, ...) con uno de estos patrones:

| Patrón | Plantilla |
|---|---|
| Ubicuo | `El sistema deberá <acción>.` |
| Evento | `Cuando <disparador>, el sistema deberá <acción>.` |
| Estado | `Mientras <estado>, el sistema deberá <acción>.` |
| Opcional | `Donde <feature opcional>, el sistema deberá <acción>.` |
| No deseado | `Si <evento no deseado>, entonces el sistema deberá <acción>.` |

Reglas:
- ID estable (no reordenar después de aprobar).
- Cada `R<n>` verificable por ≥1 test.
- No mezclar varios "deberá" en un mismo requirement.
- Solo `deberá`/`no deberá` (nada de "podría", "soporta", "permitiría").

## design.md — decisiones técnicas

Antes de tocar código documentás:
- Archivos a crear o modificar.
- Si toca DB: schema SQL completo + RLS policies + helpers usados.
- Si toca offline-sync: buckets de PowerSync + estrategia de conflictos.
- Si toca BLE: protocolo + ventana de correlación + fallback manual.
- Si toca Edge Functions: input/output + validaciones de auth.
- **Mínimo una alternativa descartada con su porqué.**

Apoyate en `architecture.md` y `conventions.md`. Documentá solo donde la feature roza la frontera de esas reglas.

## tasks.md — checklist ejecutable

Pasos discretos en orden, cada uno con checkbox y los `R<n>` que cubre:

```
- [ ] T1 — Migration SQL: crear tabla users con FK a auth.users. Cubre: R1.1, R2.3.
- [ ] T2 — Test: insertar en auth.users dispara trigger a public.users. Cubre: R1.1.
- [ ] T3 — Pantalla SignUp con validación de email. Cubre: R1.1.
```

El implementer marca `[x]`. El reviewer rechaza si queda `[ ]` sin justificación documentada.

## Trazabilidad (regla dura)

Cada test mapea a un `R<n>`; cada `R<n>` tiene ≥1 test. El reviewer lo comprueba. El implementer documenta el mapa `R<n> → archivo:test` en `progress/impl_<name>.md`.

## Cuándo NO aplica SDD

Features sin `"sdd": true` no tienen spec. SDD aplica solo hacia adelante: si una feature ya `done` no la tiene, no se reescribe retroactivamente.
