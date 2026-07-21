baseline_commit: d4d513f4d0cf38a74dd75174440b15440349d531

# U8b — El link de invitación por WhatsApp salía DUPLICADO

Tanda `docs/plan-mejoras-2026-07-20.md`, Tier-1. Bugfix delegado por el leader (no es feature SDD full).

## Diagnóstico — dónde se duplicaba

La URL de invitación se compartía DOS veces en iOS. Causa raíz en dos capas que se sumaban:

1. **El texto del mensaje ya incluía la URL.** Se armaba inline y DUPLICADO en dos archivos:
   - `app/app/invitar.tsx:77` — `shareMessage={`…Abrí este link para aceptar: ${created.acceptUrl}`}` (pasado a `<ShareLink>`).
   - `app/app/miembros.tsx:513` — `const shareMessage = `…Abrí este link para aceptar: ${url}`` (para el `onShare` de `PendingInvitationCard`).

2. **Y además se pasaba el `url` suelto a `Share.share` en iOS:**
   - `app/src/components/ShareLink.tsx:58` (as-was) — `Platform.OS === 'ios' ? { url, message: shareMessage ?? url } : { message: shareMessage ?? url }`.
   - `app/app/miembros.tsx:529` (as-was) — `Platform.OS === 'ios' ? { url, message: shareMessage } : { message: shareMessage }`.

En iOS, `Share.share({ url, message })` entrega `url` y `message` como items separados; WhatsApp/Mail/Notes **concatenan** el texto del mensaje y la URL → el link aparecía DOS veces (una embebida en el texto + una del item `url`). En Android solo se pasaba `message`, así que ahí no duplicaba, pero el síntoma reportado (WhatsApp) es el path iOS.

Nota: el bug alcanzaba **incluso el caso default** de ShareLink (sin `shareMessage`): `{ url, message: url }` → URL dos veces también.

**Línea exacta de la duplicación**: `app/src/components/ShareLink.tsx:58` (iOS `{ url, message }` con message que ya trae el link) y su espejo `app/app/miembros.tsx:529`. El texto que ya incluía la URL: `invitar.tsx:77` y `miembros.tsx:513`.

## Fix — una sola fuente de la URL (el mensaje)

Regla dura: la URL vive **solo en el texto del mensaje**; `Share.share` comparte **únicamente** `message`, nunca también el `url` suelto.

1. **`app/src/utils/invite.ts`** (fuente única, pura y testeable): nueva `inviteShareMessage(establishmentName, url)` que devuelve el texto es-AR/voseo con el link UNA vez. Reemplaza los dos template literals inline duplicados.
2. **`app/src/components/ShareLink.tsx`** — `onShare` ahora hace `Share.share({ message: shareMessage ?? url })` en TODAS las plataformas (se eliminó la rama iOS que pasaba `url`). Sin `shareMessage`, `message = url` → sigue saliendo una vez.
3. **`app/app/invitar.tsx`** — usa `inviteShareMessage(activeField.name, created.acceptUrl)` en vez del literal inline.
4. **`app/app/miembros.tsx`** — usa `inviteShareMessage(establishmentName, url)`; `onShare` → `Share.share({ message: shareMessage })` (se eliminó la rama iOS con `url`). Dep array del callback ajustada a `[shareMessage]`.

Lo que NO se tocó: generación/validación del token (`inviteUrlForToken`, edges) — fuera de scope (U9 en paralelo, read-only). `Clipboard.setStringAsync(url)` de Copiar sigue copiando el `accept_url` crudo (no cambió). BLE no tocado.

## Verificación

- **(a) Inspección de código**: los tres sinks de share ahora reciben SOLO `message`; el único portador de la URL es el texto de `inviteShareMessage`. Grep confirmó que no quedan otros `Share.share` de invitación (solo ShareLink.tsx + miembros.tsx) y ningún `{ url, message }` residual.
- **(b) Unit test de la función pura** (`app/src/utils/invite.test.ts`, +3 tests):
  - `inviteShareMessage: la URL aparece EXACTAMENTE una vez` — cuenta ocurrencias del link completo (`split(url).length - 1 === 1`). Este es el oráculo directo del bug.
  - `inviteShareMessage: incluye el nombre del campo y es es-AR (voseo)`.
  - `inviteShareMessage: termina con la URL` (sink limpio).
  - Resultado: `node --test src/utils/invite.test.ts` → **14 pass / 0 fail** (11 previos + 3 nuevos).
- **Typecheck**: `npx tsc --noEmit -p tsconfig.json` → **exit 0**.
- Share nativo no es E2E-able (native); por eso la cobertura es la función pura + inspección. No se corrió check.mjs full ni suites remotas (restricción del task).

## Trazabilidad

- Bug U8b (link duplicado) → `invite.test.ts::inviteShareMessage: la URL aparece EXACTAMENTE una vez`.
- Mensaje limpio es-AR / nombre del campo → `invite.test.ts::inviteShareMessage: incluye el nombre del campo y es es-AR`.
- Cobertura de R5.3 (compartir) intacta: ShareLink + invitar.tsx + PendingInvitationCard siguen compartiendo, ahora sin dup.

## Autorrevisión adversarial

- **¿Regresión por quitar el `url` de iOS?** No relevante: el `url` servía para previews/link-only en algunos targets, pero como el `message` contiene la URL, WhatsApp/iOS siguen generando el preview a partir del link en el texto. El fix es el patrón correcto y conocido de RN. Copiar sigue dando el `accept_url` crudo.
- **¿Otros sitios de share de invitación?** Grep exhaustivo: solo ShareLink.tsx y miembros.tsx. Ambos corregidos. No hay un tercer path.
- **¿Caso default de ShareLink (sin shareMessage)?** También estaba duplicando en iOS (`{ url, message: url }`) y quedó cubierto: ahora `{ message: url }` → una vez.
- **¿Test que pasa por la razón equivocada?** El test cuenta ocurrencias del link exacto; si el template repitiera la URL (el bug), `split().length - 1` daría 2 y fallaría. Ejerce el defecto real.
- **¿Imports huérfanos tras el cambio?** `Platform` sigue usándose en ambos archivos (buttonA11y / confirmDestructive) — verificado por grep. `Share` sigue usado. Sin imports muertos.
- **¿es-AR / voseo?** "Te invito a sumarte a "<campo>" en RAFAQ. Abrí este link para aceptar: <url>" — voseo, limpio, un solo link. Nombre del campo preservado.

## Reconciliación de specs

El spec 01 documentaba el patrón buggy `Share.share({ message: accept_url, url: accept_url })`:
- `specs/active/01-identity-multitenancy/design.md:310` — reconciliado al as-built (share solo `message` vía `inviteShareMessage`, con nota de por qué se quita el `url` en iOS).
- `specs/active/01-identity-multitenancy/tasks.md:265` — misma reconciliación.

## Archivos tocados

- `app/src/utils/invite.ts` (+`inviteShareMessage`)
- `app/src/utils/invite.test.ts` (+3 tests)
- `app/src/components/ShareLink.tsx` (onShare: solo `message`)
- `app/app/invitar.tsx` (usa `inviteShareMessage`)
- `app/app/miembros.tsx` (usa `inviteShareMessage`; onShare: solo `message`)
- `specs/active/01-identity-multitenancy/design.md` + `tasks.md` (reconciliación)

No commiteado (leader coordina).
