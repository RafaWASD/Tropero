# Security gate (code) — Corrección #2: relabel de identificadores

**Modo**: `code` (Gate 2, ADR-019)
**Baseline**: `34856ca` → HEAD + working tree
**Veredicto**: **PASS** (0 HIGH, 0 MEDIUM)

## Alcance del cambio

Relabel de labels de UI (3 "caravanas" → 2 caravanas + nombre/seña) + 1 render condicional.
Frontend puro RN/Expo, capa de presentación. **`git diff 34856ca -- supabase/` vacío** (sin
migrations, RLS, Edge Functions, triggers ni config Auth tocados).

Archivos analizados:
- `app/app/animal/[id].tsx` — labels `"Caravana / IDV"`→`"Caravana visual"`, `"Identificación visual"`→`"Nombre / seña"`; `visual_id_alt` ahora render condicional (`!= null`).
- `app/app/crear-animal.tsx` — labels de FormField + texto del `formError`.
- `app/src/components/IdentifierAssignRow.tsx` — solo jsdoc (comentario del prop `label`).
- `app/e2e/*.spec.ts` (5 archivos) — expectativas de texto actualizadas al nuevo label.

## Findings HIGH (Sentry security-review)

Ninguno. La skill `sentry-skills:security-review` no identifica vulnerabilidades HIGH-confidence
en el diff. Único sink de dato tocado: `detail.visualIdAlt` pasado como prop `value` a
`<AttributeRow>` (RN `<Text>`, auto-escapado — sin HTML/`dangerouslySetInnerHTML`/`.raw`). No hay
input attacker-controlled que llegue a un sink peligroso.

## Findings RAFAQ-SPECIFIC

Ninguno.

### Verificación del render condicional (no es leak)
`visual_id_alt` pasó de renderizar siempre (`value={detail.visualIdAlt ?? '—'}`) a renderizar
**solo si `!= null`**. El cambio **reduce** la superficie de datos mostrada (oculta un campo vacío),
nunca la aumenta: cuando hay valor muestra el mismo `detail.visualIdAlt` de siempre, solo con label
distinto. El `detail` ya venía cargado por la query de detalle (scoping sin tocar). No expone ni
des-scopea nada. No es information disclosure.

### Relabel no cambia semántica de datos
Los labels renombran la presentación pero los campos siguen mapeando a las mismas columnas (`idv`,
`visual_id_alt`) con los mismos handlers (`onIdv`/`onVisual`), `keyboardType` y sanitizadores. No se
movió dato de una columna a otra ni se cambió qué se persiste.

## False positives descartados

N/A — la skill no levantó findings que requieran descarte.

## Tabla de inputs

| campo | límite | validación | OK? |
|---|---|---|---|
| idv (relabel "Caravana visual") | sin cambios vs baseline (`sanitizeIdvInput`, number-pad) | sin cambios (capa UX cliente; autoritativa server-side sin tocar) | sí (no modificado) |
| visual (relabel "Nombre / seña") | sin cambios vs baseline (`onVisual`, sentences) | sin cambios | sí (no modificado) |

Ningún campo de entrada fue creado ni se le modificó límite/validación. El diff solo cambia el
**texto del label** y la **condición de render**. La validación autoritativa server-side queda
exactamente como en el baseline (sin backend tocado).

## Tabla de rate limits

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| — | n.a. | — | — | El diff no toca ninguna acción abusable (sin Edge Functions, email/SMS, API externa, bulk/import ni buscadores). |

## Dominios revisados / excluidos

- **Revisados**: XSS/sink de render (B3/render path), information disclosure por el render condicional (B1/B3), semántica de campos tras relabel, inputs (validación), e2e (secrets hardcodeados — none).
- **Excluidos (justificación)**: A (service-role/mass assignment/IDOR), RLS, Edge Functions, triggers, secrets/config, C (offline/sync rules), E (abuso/rate), F (ingesta/SSRF), G (BLE), H (auth/sesión), I (compliance) — **ninguno tocado por el diff** (`supabase/` vacío, sin backend, sin nuevos inputs ni acciones).

## Cobertura indirecta de Deno / RLS / PowerSync

No aplica en este diff — no se modificaron Edge Functions (Deno), migrations/RLS ni sync rules
(PowerSync). Sin gap de cobertura: la superficie de seguridad del cambio es ~nula (relabel de UI +
render condicional que reduce exposición).
