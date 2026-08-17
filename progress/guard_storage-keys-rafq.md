# Guard: las OCHO claves de storage `rafq.*` — 2026-08-17

Unidad acotada. **Cero cambios en código de producción.** Deliverables:

1. `app/src/services/storage-keys-guard.test.ts` (nuevo).
2. Una línea + un párrafo de comentario en `scripts/run-tests.mjs`.

## ⚠️ LO PRIMERO: mi hunk de `run-tests.mjs` ya está COMMITEADO, y el test NO

La otra terminal commiteó `scripts/run-tests.mjs` mientras yo trabajaba: mis dos hunks quedaron
**barridos adentro de `7f4a0bf`** (`feat(04): adapter-mfi-ios prearmado…`), junto con su propio stage
nuevo de `audit_query access helpers`. Verificado: `git show HEAD:scripts/run-tests.mjs` contiene mis dos
hunks intactos y el working tree no difiere de HEAD para ese archivo.

**Consecuencia que hay que cerrar ya**: `main` (HEAD) declara el stage
`app/src/services/storage-keys-guard.test.ts` en la lista explícita del stage `client unit tests`, pero
**el archivo está UNTRACKED**. En un clon limpio de HEAD ese `node --test` se cae por archivo
inexistente y el stage 3 de 22 sale rojo. Es exactamente la clase «verificar lo que quedó AFUERA»: el
typecheck y las suites miden el ÁRBOL, no el commit. **Commitear el `.test.ts` cuanto antes.**

## El problema

Ocho prefijos de `AsyncStorage`/`SecureStore`/`localStorage` arrancan con `rafq.` (la variante SIN la
"a"). Renombrarlas le borra el estado a **todo device ya instalado** — no hay OTA ni migración
automática. Nadie las había declarado, y `brand-name-guard.test.ts` sólo conoce `rafaq`: hoy renombrarlas
pasaba en verde por las 22 stages del check.

## Diseño

### El registro

`STORAGE_KEYS`: las ocho, cada una con (a) el **literal tal como aparece en el código** —para las claves
parametrizadas, el prefijo hasta la interpolación—, (b) la **forma completa** que termina en el device,
(c) el **módulo dueño**, y (d) **qué se pierde** si se renombra (texto real, no etiqueta; validado con
`length > 40`, patrón de las exenciones de `brand-name-guard`).

| Literal | Módulo dueño |
|---|---|
| `rafq.ble.beep_enabled` | `src/services/ble/feedback-pref.ts` |
| `rafq.ble.remembered_device` | `src/services/ble/remembered-device.ts` |
| `rafq.est_trail.` | `src/services/establishment-store.ts` |
| `rafq.banner_dismissed.` | `src/services/establishment-store.ts` |
| `rafq.lockout.` | `src/services/lockout-store.ts` |
| `rafq.active_rodeo.` | `src/services/rodeo-store.ts` |
| `rafq.last_rodeo.` | `src/services/last-rodeo.ts` |
| `rafq.pending_invitation_token` | `src/services/pending-invitation.ts` |

### Las reglas (8 tests)

- **ANTI-VACÍO** (va primero): el barrido devolvió ≥300 archivos (medido hoy: 406) y ≥8 literales. Los dos
  con el número a la vista. El mensaje nombra **las dos causas posibles** (una clave desapareció → lo dice
  la regla 2; o el escáner se rompió) para no mandar a buscar el problema equivocado.
- **AUTO-VERIFICACIÓN**: `assertScanCoverage` (piso de archivos + balance de llaves + retención), el
  mecanismo canónico del repo contra "el blanqueo se comió el archivo".
- **Regla 1 — ninguna clave sin declarar**: todo literal `rafq.*` del árbol (`app/app` + `app/src`, sin
  `.test.*`, comentarios blanqueados con `stripSourceComments`) tiene que estar en el registro.
- **Regla 2 — ninguna declaración huérfana**: cada clave declarada tiene que seguir existiendo. El mensaje
  dice **qué se pierde** y que el rename correcto es una **migración** (leer la vieja, escribir la nueva,
  borrar la vieja en el primer arranque), más la lista de archivos del árbol de `app/` que todavía nombran
  el literal (incluidas las specs de `app/e2e`), para que el rename incompleto se vea entero.
- **Regla 3 — un solo dueño**: cada clave vive en el módulo que declara el registro, y en ése.
- **Higiene del registro**: son 8 (conteo escrito, para que sacar una entrada no haga callar la regla 2),
  sin literales duplicados, cada motivo con sustancia, `shape` que arranca con el `literal`, y el módulo
  dueño **existe** en disco.
- **Dos tests de falsificación sintética**: el extractor sobre las formas reales + los cuatro `rafq`
  fuera de alcance + comentarios; y los predicados de las tres reglas sobre hits fabricados (incluido
  `mirrorsOf`, que si no se ejerce acá sale con la lista vacía justo el día que hace falta).

### Alcance declarado (escrito en el archivo)

La forma que aísla las claves es «comilla o backtick seguida INMEDIATAMENTE de `rafq.`». Los otros cuatro
usos de `rafq` del repo quedan **fuera a propósito**, y no por olvido sino **por forma** (van precedidos
de `.` o `@`, o no tienen punto después): `ar.rafq.app|dev|web` (bundle/Services ID), `rafq://` (scheme),
`noreply@rafq.ar` (remitente que la regla E de `brand-name-guard` EXIGE que siga) y `app.rafq.ar` (el
dominio muerto que aquel guard ya prohíbe). Está asertado con casos sintéticos que ninguno dispara.

Límite declarado: una clave **armada por concatenación** no la ve la regla 1. No es agujero para las ocho
que existen —reescribir una así la vuelve huérfana y la regla 2 se pone roja—; lo que podría entrar sin
declarar es una clave *nueva* construida a mano.

## Por qué se DESCARTÓ el `STORAGE_PREFIX` que proponía el backlog

Queda escrito en el header del archivo. Dos motivos:

1. **Centralizar el prefijo hace que la operación peligrosa cueste UNA línea.** Es al revés de lo que
   queremos. El riesgo no es la duplicación del literal —ocho duplicados no rompieron nada nunca— es que
   nadie había DECLARADO que estas claves viven en el device. Con el prefijo centralizado, renombrar las
   ocho de golpe es un diff de una línea que pasa desapercibido en un review. Con ocho literales + este
   registro, renombrar es ruidoso y caro. **La fricción es la defensa.**
2. **Rompería un guard vivo de otra unidad.** `app/src/services/ble/wiring.test.ts` exige que el literal
   del bastón recordado viva en exactamente un módulo, buscándolo **como literal**. Si
   `remembered-device.ts` pasara a construir su clave desde un prefijo compartido, ese literal desaparece
   y el guard de la otra terminal se pone rojo sin que se haya roto nada de lo que él cuida.

Nota de compatibilidad con ese guard: mi registro escribe los ocho literales COMPLETOS, incluido el del
bastón. No choca porque los escaneos de árbol del repo excluyen `.test.*` — evidencia dura: el propio
`wiring.test.ts:542` contiene ese literal en su código y se auto-reportaría si no fuera así (y tres
archivos de `app/e2e` también lo tienen).

## Falsificación: los 5 mutantes, puestos y sacados

Snapshot de bytes + `sha256sum -c` antes y después de cada uno (**nada de `git checkout`**: el árbol
tenía cambios sin commitear de la otra terminal). Los cuatro sha volvieron OK tras cada restauración.

| # | Mutante | Veredicto | Qué dijo |
|---|---|---|---|
| 1 | `rafq.lockout.` → `mitropero.lockout.` en `lockout-store.ts` | 🔴 6/8 | Regla 2: *"…AFLOJA UNA DEFENSA. El bloqueo se reinicia para todos a la vez, así que el rename le regala al atacante casual una tanda entera de intentos sin espera"* + la instrucción de migración. También ANTI-VACÍO (7 literales vs 8 declaradas). |
| 2 | `const K = 'rafq.algo_nuevo';` agregado a `tag-lookup.ts` | 🔴 7/8 | Regla 1: `src/services/tag-lookup.ts:105  const K = 'rafq.algo_nuevo';` |
| 3 | Borrada la entrada de `pending_invitation_token` del registro (clave viva) | 🔴 6/8 | Regla 1: `src/services/pending-invitation.ts:20  const PENDING_INVITATION_KEY = 'rafq.pending_invitation_token';` + higiene (`7 !== 8`) |
| 4 | 9ª entrada declarada (`rafq.legacy_wizard_draft`) sin clave en el código | 🔴 5/8 | Regla 2 la nombra como huérfana con su "SE PIERDE" + higiene (`9 !== 8`) |
| 5 | `ROOTS` apuntando a directorios inexistentes | 🔴 5/8 | ANTI-VACÍO: *"el barrido devolvió **0 archivos** y el piso es 300"* + `assertScanCoverage`: *"[storage-keys] escaneó 0 archivos y el piso es 300"*. **No verde.** Confirma el motivo del check: con el barrido roto, la regla 1 pasa en verde **vacuamente** (nada que rechazar). |

## El hunk de `scripts/run-tests.mjs` (ya en HEAD, dentro de `7f4a0bf`)

Hunk A — párrafo de comentario, insertado entre el de `brand-name-guard` y el de
`ios-purpose-strings-guard` (líneas 178-189 de HEAD):

```js
  // ⚠️ `app/src/services/storage-keys-guard.test.ts` es el guard de las OCHO claves de storage `rafq.*`
  // (auditoría del rebrand, 2026-08-17). Son prefijos de AsyncStorage/SecureStore/localStorage que YA
  // VIVEN EN LOS DEVICES INSTALADOS: renombrarlas borra el bastón recordado (hay que re-emparejar EN LA
  // MANGA), el rodeo activo, el rastro de campos, una invitación en curso, y REINICIA EL CONTADOR DE
  // LOCKOUT. No hay OTA ni migración automática, así que el daño es irreversible y silencioso — la app
  // arranca perfecta, sin estado. `brand-name-guard` no las ve (conoce `rafaq`, con "a"; estas dicen
  // `rafq`), así que hasta hoy renombrarlas pasaba VERDE por las 22 stages. El guard declara las ocho con
  // su módulo dueño y qué se pierde, y vigila las DOS direcciones: una clave nueva hardcodeada nace en
  // rojo, y una declarada que desaparece también (con el mensaje diciendo que el rename correcto es una
  // migración, no un swap de literal). Ninguna E2E puede ver esto: el device que pierde el estado es el
  // que YA tenía la app instalada, no el navegador que arranca limpio en cada corrida.
  //
```

Hunk B — un solo punto de la lista explícita del stage `client unit tests` (línea 244), insertado entre
`brand-name-guard.test.ts` y `classify-error.test.ts`:

```
-…app/src/utils/brand-name-guard.test.ts app/src/services/classify-error.test.ts…
+…app/src/utils/brand-name-guard.test.ts app/src/services/storage-keys-guard.test.ts app/src/services/classify-error.test.ts…
```

## Autorrevisión (antes de reportar)

Qué busqué y qué cerré:

- **Test que pasa por la razón equivocada** → los 5 mutantes, más dos tests sintéticos que ejercen los
  predicados y el extractor sin tocar el árbol.
- **Mensaje que manda a buscar lo que no es**: el ANTI-VACÍO decía sólo "el escáner dejó de ver el código
  real", y en el mutante 1 (un rename legítimo) eso es falso. **Corregido**: ahora nombra las dos causas y
  remite a la regla 2.
- **Helper sólo-para-mensajes sin ejercitar**: `mirrorsOf` únicamente corre cuando algo ya falló, así que
  podría estar roto y nadie enterarse. **Corregido**: asertado en el test sintético (encuentra el módulo
  real, y no inventa menciones para un literal que no existe).
- **Excepción que convierte una aserción con diagnóstico en un crash sin él**: `mirrorsOf` hacía
  `statSync`/`readFileSync` sin guarda. **Corregido** con try/catch acotado y comentado.
- **Registro que se pudre**: el módulo dueño se valida contra el disco (`statSync(...).isFile()`) y el
  `shape` tiene que arrancar con el `literal`.
- **Romper al vecino**: no toqué `wiring.test.ts` (ni para leerlo). Verifiqué por evidencia indirecta que
  los escaneos excluyen `.test.*`.
- **Typecheck**: `app/tsconfig.json` excluye `**/*.test.ts`, así que el archivo (que usa builtins de Node)
  no entra al stage fatal de typecheck. Mismo trato que `brand-name-guard`.

## Verde final

- `node --test app/src/services/storage-keys-guard.test.ts` (con el resolver de ts) → **8/8**.
- `node --test scripts/lib/stage-runner.test.mjs` → **27/27** (los guards estáticos sobre `run-tests.mjs`
  siguen verdes con mi hunk puesto).
- **NO** corrí `node scripts/check.mjs` ni `run-tests.mjs` completo (16 suites contra la DEV compartida,
  con otra terminal escribiendo). Lo corre el leader.

## Pendiente para el leader

1. **Commitear `app/src/services/storage-keys-guard.test.ts`** — HEAD ya lo referencia y todavía no
   existe en el índice.
2. Actualizar la entrada `[2026-08-17] 🔴 Ocho claves de storage rafq.*` de `docs/backlog.md`: el "fix
   propuesto" (`STORAGE_PREFIX`) quedó **descartado** y reemplazado por este guard, con los dos motivos.
