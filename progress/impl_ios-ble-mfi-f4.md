# impl — delta `ios-ble-mfi` · **Fase F4**: selección, prioridad por plataforma y el driver del emulador

baseline_commit: e0a32ad815d23c77ee953f4b2bf37a57acfd8ccd

> `e0a32ad` = HEAD al arrancar la fase (F1/F2 en `3272227`, F3 en `a9d81ff`, más dos commits de la
> **otra terminal** — rebrand de prosa `f18b8aa` y la auditoría de claves de storage `e0a32ad`). Es el
> punto desde el cual el Gate 2 calcula el diff de ESTA fase. Cada fase se despacha y se audita por
> separado (ADR-028 Nivel B), así que no se re-usa el baseline de F3.
> **NO se sobreescribió**: esta fase la retomó un tercer agente (los dos primeros murieron mid-tarea) y
> el baseline es el SHA previo a la primera task de la fase, no al último relanzamiento.

**Fecha**: 2026-08-17. **Spec**: `specs/active/04-bluetooth-baston/{requirements,design,tasks}-ios-ble-mfi.md`.
**Alcance**: **solo Fase F4** (T4.1–T4.9 + el fix-loop del review: T4.10–T4.12). F1/F2/F3 no se tocan
(commiteadas). F5 (`adapter-mfi-ios`), F6 (banco en device) y F7 (HID) quedan fuera por contrato.

> **§11 = FIX-LOOP del review** (`progress/review_ios-ble-mfi-f4.md`, CHANGES_REQUESTED). Todo lo de las
> secciones 1–10 es la primera pasada y sigue vigente salvo donde el §11 diga lo contrario.

**`progress/current.md` NO se toca** (lo está editando la otra terminal — regla de terminales paralelas
del leader). El plan y el estado de esta fase viven acá.

---

## 1. Plan (tasks de la fase)

| Task | Qué | Estado |
|---|---|---|
| T4.1 | `selection-priority.ts`: prioridad iOS `['mfi','ble-gatt','ble-hid']`; `adapterForTransport` += `ble-gatt` (iOS+Android) y `mfi`+iOS → `mfi-ios` | ✅ |
| T4.2 | `ea-protocols.ts` (PURO): `declaredEaProtocols()` + `mfiAvailability()`; `BindingEnv` gana la lista inyectable | ✅ |
| T4.3 | `driver-esp32-gatt.ts`: `ESP32_GATT_DRIVER` (NUS de ADR-003, match SOLO por nombre) + registro | ✅ |
| T4.4 | Test del anti-colisión con el bridge de la balanza Vesta (mismos UUID NUS) | ✅ |
| T4.5 | `remembered-device.ts` → `{deviceId, vendorId?, adapterKind?}` leyendo el formato viejo | ✅ |
| T4.6 | `SelectionEnv.preferredAdapter` + rama en `selectTransportAdapter`; piso de iOS → `ble-gatt`; hidratación en el provider | ✅ |
| T4.7 | `selection-priority.test.ts` + `wiring.test.ts`: los 9 casos, determinismo, `available` de MFi, regresión | ✅ |
| T4.8 | `connection-view.ts` + `StickConnectionScreen.tsx`: `BUILT_ADAPTERS`, ramas BLE y MFi | ✅ (con desviación declarada) |
| T4.9 | `connection-view.test.ts`: copy por transporte y por `reason` + el invariante de tono | ✅ |

**Verificación**: `tsc --noEmit` rc=0 · suites BLE + `ble-stick` + `app.config` + guards de iOS:
**689 pass / 0 fail** (al arrancar esta sesión: 654 / 7). `node scripts/check.mjs`: ver §8.

---

## 2. Los 7 rojos que dejó el agente caído: veredicto uno por uno

El encargo era **demostrar de qué lado está cada uno**, no ponerlos en verde. El leader había contado 6;
el séptimo estaba en `wiring.test.ts` (misma causa que el 6º). Ninguno resultó ser una regresión, y la
diferencia entre "obsoleto" y "regresión" se decidió **midiendo qué cambió exactamente en el valor**, no
leyendo el título del test.

| # | Test | Diagnóstico MEDIDO | Veredicto |
|---|---|---|---|
| 1 | `RMV6.2/6.3: ble-gatt y mfi no tienen adapter buildable (null)` | `adapterForTransport('ble-gatt','ios')` devuelve `'ble-gatt'` | **Obsoleto a propósito** — RBM5.2 los mapea, **RBM7.1** declara que RMV6.2/6.3 dejan de ser "fuera del delta" |
| 2 | `RMV6.1/6.2: driver mfi-only en iOS → binding null` | ahora `{mfi-ios, mfi, available:false, 'build-sin-protocolos'}` | **Obsoleto a propósito** — RBM4.4/4.5 + RBM5.5 cablean el binding |
| 3 | `RMV2.3/2.4: RS420 en android` | `adapterKind` y `transportKind` **IDÉNTICOS** (`spp-android`/`spp`); la ÚNICA diferencia es la clave nueva `unavailableReason:'adapter-no-construido'` | **NO es regresión de RBM5.4** — la prioridad de Android no se movió. Cambio de FORMA del binding, autorizado por RBM4.5 + RBM5.14 |
| 4 | `RMV2.2/2.4: driver solo-HID en android` | ídem #3 (`hid-wedge`/`ble-hid` idénticos) | ídem #3 |
| 5 | `RMV2.2/2.4: driver HID genérico en iOS` | ídem #3. La sospecha del leader ("si declara SOLO `ble-hid`, el orden no debería cambiar su resultado") era **correcta**: no cambió | ídem #3 |
| 6 | 🔴 `RMV2.7 regresión: selectTransportAdapter(...) EXACTAMENTE lo de antes` | de las 8 aserciones falla **UNA**: `ios/auto` → `'ble-gatt'` en vez de `'manual'`. **Android sigue en `spp-android`, web en `web-serial`, los tres modos intactos** | **NO es violación de RBM5.9** — RBM5.9 congela `auto` *"en Android y en web"*, y el design §6.2 dice literal *"iOS pasa de 'manual' a 'ble-gatt' como piso"*. Es el único cambio autorizado, y se partió en dos tests para que quede legible |
| 7 | `R7: en iOS (auto) sigue sin haber transporte alcanzable → piso manual` | misma causa que #6 | Obsoleto por RBM5.6; **R7 se mantiene por otros tres mecanismos**, aserrados en el test nuevo |

**La sospecha concreta que el leader pasó quedó FALSIFICADA con evidencia**: *"si el bastón recordado está
ausente, la selección tiene que caer al piso por plataforma — o sea `spp` en Android"*. Es exactamente lo
que hace: `selectTransportAdapter({platformOS:'android', mode:'auto'})` → `'spp-android'` y
`{..., preferredAdapter: undefined}` → `'spp-android'`. La rama de la preferencia va **después** de
`mock`/`demo`/`manual` y **solo** se honra si el kind es usable en la plataforma. Hay tests de las dos
cosas y el mutante que mueve la rama al principio **muere**.

### Sobre el punto 3/4/5, que es el que podía irse en silencio

El requisito **no dice** que `unavailableReason` sea solo de MFi, pero tampoco lo pedía para los demás. La
decisión as-built (que **mantuve**, no que heredé sin pensar) es que **todo** binding `available:false`
trae motivo. El argumento: si `available:false` significara "MFi sin protocolo" cuando hay motivo y
"cualquier otra cosa" cuando no lo hay, ese significado sería **implícito** — y es exactamente el mecanismo
por el que la UI terminaría diciendo *"todavía no lo soportamos"* sobre un bastón al que solo le falta la
autorización del fabricante, que es lo que RBM4.5/RBM5.14 vinieron a impedir. Se agregó el **invariante de
forma** como test propio (matriz completa, no un caso elegido) y se reconcilió `requirements` (nota bajo
RBM4.5) + `design §6.1`. Los tres `deepEqual` viejos se actualizaron conservando intactas sus tres
aserciones originales.

---

## 3. Trazabilidad `RBM<n>` → test

| Requisito | Test (archivo:nombre) |
|---|---|
| RBM4.2 | `ea-protocols.test.ts`: *build SIN protocolos → build-sin-protocolos* · *sin runtime de expo → []* |
| RBM4.4 | `ea-protocols.test.ts`: *build CON la cadena del driver → available* · `selection-priority.test.ts`: *driver mfi-only en iOS → binding mfi-ios* |
| RBM4.5 | `ea-protocols.test.ts`: *el driver declara una cadena que el build NO declara* · *la comparación es EXACTA* · *los TRES motivos son distintos* · `selection-priority.test.ts`: *TODO binding no disponible trae su motivo* · `connection-view.test.ts`: *el copy de MFi dice que falta la autorización DEL FABRICANTE* |
| RBM4.6 | `ea-protocols.test.ts`: *un driver que NO declara mfi → driver-sin-mfi* (sobre `RS420_DRIVER` real) · `selection-priority.test.ts`: *el RS420 REAL sigue sin declarar mfi* · `ea-protocols.test.ts`: *la config real da `[]`* |
| RBM4.7 | `ea-protocols.test.ts`: ***de punta a punta: la cadena puesta en la config REAL la levanta el camino de producción*** · *GUARD: la clave está en LA MISMA RUTA* · `wiring.test.ts`: *la pantalla pasa la lista REAL, no un `[]` literal* |
| RBM4.9 | `wiring.test.ts`: *`mfi-ios` tiene su PROPIO modelo de permiso (`ios-mfi`)* · `adapter-ingest-mode.test.ts` (recorre `ADAPTER_KINDS` → cubre la fila nueva) |
| RBM5.1 | `selection-priority.test.ts`: *la prioridad de iOS pasa a MFi > GATT > HID* |
| RBM5.2 | `selection-priority.test.ts`: *ble-gatt mapea en iOS Y Android, mfi SOLO en iOS* · *`isAdapterUsableOn` se DERIVA del mapeo* |
| RBM5.3 | ídem (`spp` fuera de Android → null; `mfi`/`ble-gatt` fuera de sus plataformas → null) |
| RBM5.4 | `selection-priority.test.ts`: *la prioridad de Android y de web NO cambia* · *RS420 en android → {spp-android, spp}* · `RBM5.9 regresión` |
| RBM5.5 | `selection-priority.test.ts`: *el `available` de mfi-ios es una CONJUNCIÓN — falla cualquiera de las dos mitades* (4 casos, incluido el ORDEN del chequeo) |
| RBM5.6 | `selection-priority.test.ts`: *la preferencia del bastón recordado le gana al piso* · *fail-closed: una preferencia que NO puede existir se ignora* · *una preferencia `hid-wedge` NUNCA se honra* · `wiring.test.ts`: *el piso de iOS pasa a ble-gatt* · *el provider HIDRATA la preferencia* · *el adapter escribe su `adapterKind`* |
| RBM5.7 | `remembered-format.test.ts`: *un valor VIEJO sigue dando el device, SIN preferencia* · *un id viejo que ES JSON válido pero NO un objeto* · `selection-priority.test.ts`: *sin preferencia se cae al piso* |
| RBM5.8 | `selection-priority.test.ts`: *la tabla del §6.1 es DETERMINÍSTICA y no depende del orden de declaración* · *`selectTransportAdapter` es determinístico sobre TODA la matriz* |
| RBM5.9 | `selection-priority.test.ts`: *mock/manual/demo y auto en Android/web → EXACTAMENTE lo de antes* · *la preferencia NO puede cambiar mock/manual/demo* (recorre todo el union) |
| RBM5.10 | `selection-priority.test.ts`: *RS420 en iOS → null* · *driver SPP-only en web → null* · `macos/otro → 'manual'` · `wiring.test.ts`: *R7 sigue en pie* (`blocksManualEntry` en los 5 estados) |
| RBM5.11 | `driver-registry.test.ts`: *el registro NO declara ningún lector comercial adivinado* · `adapter-ble-gatt.test.ts`: *GUARD: si el registro llega a declarar DOS drivers ble-gatt* |
| RBM5.12 | `driver-registry.test.ts`: *el emulador está en el registro y su displayName DICE que es un banco de pruebas* · *declara ble-gatt con los UUID NUS de ADR-003* · `connection-view.test.ts`: *la fila del bastón BLE dice "banco de pruebas"* |
| RBM5.13 | `driver-registry.test.ts`: *se reconoce por su NOMBRE anunciado* · ***el bridge de la balanza Vesta anuncia los MISMOS UUID NUS y NO se reconoce como bastón*** (con control positivo) · *el matcher NO declara advertisedServiceUuids* · *un device que anuncia NUS sin el nombre no se reconoce* |
| RBM5.14 | `connection-view.test.ts`: *cada clave de instrucción se alcanza, con cuerpo DISTINTO* · *REGRESIÓN: las cinco que ya existían* · *SIN transporte, ningún transporte da instrucciones de un pairing imposible* · *el copy de BLE GATT no promete un paso que el adapter NO tiene* · *en BLE GATT "conectar" es BUSCAR* · *REGRESIÓN: sin `transportKind` la card es IDÉNTICA* · *el TONO nunca contradice a la card* (matriz con `transportKind`) |
| RBM9.1/9.2 | §7 de este informe (verificación atribuible, sin `git diff`) |
| RBM9.4 | F4 no agrega I/O de red: las únicas entradas nuevas son `localStorage`/`SecureStore` (local, con techo en el borde) y `Constants.expoConfig` (manifiesto del build). `offline-noread.test.ts` sigue verde |
| RBM9.5 | `connection-view.test.ts`: el copy de las 3 ramas no disponibles ofrece la carga manual · `wiring.test.ts`: *NINGÚN estado bloquea la carga manual* · *un permiso denegado NUNCA bloquea* |
| RBM9.6 | Ningún método de `StickAdapter` cambió (solo el union de `kind`, aditivo, y el `driver` readonly que ya existía de F1). Cero archivos de `app/src/features/animals/*` tocados — ver §7 |
| R6.6 | `wiring.test.ts`: *el CTA de "olvidar" NO puede vivir adentro de una rama por transporte* (nuevo) + los dos guards que ya existían |
| R8.7 | `wiring.test.ts`: *nunca se elige hid-wedge, ni siquiera con la preferencia apuntándole* |

---

## 4. Mutantes: 22 corridos, **22 muertos**

Los backups de mutación vivieron en un directorio con **nombre propio** (`scratchpad/f4-fresh-backup/`) y
el revert se comparó contra **ese** backup por hash, no contra `git diff` (un agente anterior perdió
ediciones por un backup homónimo en el scratchpad compartido). Integridad post-mutación: **9/9 archivos
idénticos al backup**.

| # | Mutante | Requisito que vigila | Resultado |
|---|---|---|---|
| M1 | `deviceMatch` del emulador += `advertisedServiceUuids:[NUS]` | RBM5.13 (**el que el encargo pedía**) | ☠️ 3 tests |
| M2 | `displayName` del emulador → `'Lector Gallagher HR5 v3'` | RBM5.12 / ADR-010 | ☠️ 1 |
| M3 | `ble-gatt` mapea sin gate de plataforma | RBM5.2 (montable en web) | ☠️ 3 |
| M4 | `spp` mapea a `spp-android` en cualquier plataforma | RBM5.3 | ☠️ 4 |
| M5 | la rama de la preferencia se mueve ANTES de `mock` | RBM5.9 (las ~70 E2E) | ☠️ 1 |
| M6 | `honorsPreference` → `true` sin validar plataforma | RBM5.6 fail-closed | ☠️ 2 |
| M7 | `NOT_SELECTABLE_AS_PREFERENCE = []` | R8.7 (storage elige `hid-wedge`) | ☠️ 2 |
| M8 | el `available` de `mfi` ignora `mfiAvailability` | RBM5.5 | ☠️ 3 |
| M9 | comparación laxa de la `protocolString` (trim+lowercase) | RBM4.5 | ☠️ 1 |
| M10 | `available:false` sin `unavailableReason` | RBM4.5 / RBM5.14 | ☠️ 6 |
| M11 | el override de copy de GATT se aplica a TODOS los transportes | RBM5.14 (regresión del SPP) | ☠️ 1 |
| M12 | se pierde la rama del copy honesto de MFi | RBM4.5 | ☠️ 2 |
| M13 | prioridad de iOS vieja (`['ble-hid','ble-gatt','mfi']`) | RBM5.1 | ☠️ 3 |
| M14 | el formato viejo del bastón recordado → `null` | RBM5.7 (re-emparejar en la manga) | ☠️ 1 |
| M15 | el adapter BLE guarda el device **sin** su `adapterKind` | RBM5.6 (rama inalcanzable) | ☠️ 1 |
| M16 | la pantalla pasa `declaredEaProtocols: []` | RBM4.7 (muere en silencio) | ☠️ 1 |
| M17 | el provider no hidrata la preferencia | RBM5.6 (rama inalcanzable) | ☠️ 1 |
| M18 | el copy de MFi no nombra al fabricante ni ofrece manual | RBM4.5 / RBM9.5 | ☠️ 1 |
| M19a | el CTA de olvidar se gatea por transporte (`isSpp && …`) | R6.6 / RBM5.6 | ☠️ 1 |
| M19b | el CTA de olvidar vuelve adentro de la rama SPP | R6.6 / RBM5.6 | ☠️ 1 |
| M20 | la RUTA del lector del plist se mueve de rama | RBM4.7 | ☠️ 1 |
| M21 | la clave se mueve fuera de `ios.infoPlist` en `app.config.ts` | RBM4.7 / RBM4.3 | ☠️ 1 |
| M22 | un kind sale de `BUILT_ADAPTERS` sin pasar por el guard | el espejo `BUILT_TODAY` no puede driftar | ☠️ 1 |

---

## 5. Autorrevisión adversarial (qué busqué, qué encontré, cómo lo cerré)

**Qué busqué**: piezas a medio cablear (el agente murió mid-tarea y `tsc` verde no prueba cableado);
imports muertos; tests que pasan por la razón equivocada; requisitos cubiertos a medias; edge cases sin
test; caminos que un valor de **storage** puede secuestrar; y la diversidad de fixtures que F3 compró.

**Encontrado y cerrado:**

1. 🔴 **R6.6 se rompió por UBICACIÓN, y era una trampa que se cierra sola.** El CTA "Olvidar el bastón
   guardado" vivía adentro de `{isSpp ? …}`. Desde RBM5.6 el registro del bastón recordado **decide qué
   transporte se monta**, así que un teléfono que alguna vez conectó por BLE monta `ble-gatt` para siempre
   → `isSpp` false → **el único botón que puede borrar esa preferencia queda escondido por la preferencia
   misma**, y el RS420 por SPP se vuelve inalcanzable sin gesto posible. La salida que el design §6.2
   ofrecía ("cambiar de bastón = elegirlo en la pantalla") **no existe en BLE**: el adapter escanea y se
   conecta solo, y RBM9.6 no deja exponer el escaneo. → CTA movido afuera de las dos ramas + guard con
   **dos** mutantes (moverlo adentro / gatearlo por transporte en su propia condición). Reconciliado en
   `requirements` (RBM5.6) y `design §6.2`. **Es la captura 04 del Gate 2.5.**
2. 🟠 **El invariante de tono fila-vs-card no ejercitaba el `transportKind`.** El override de copy de BLE
   es nuevo y la matriz `ROW_ENVS` no lo tenía → el override podía contradecir a la fila con el test en
   verde. → 4 combinaciones agregadas a la matriz. (Y el mutante M11 —aplicar el override a todos los
   transportes— muere.)
3. 🟠 **`declaredEaProtocols()` no tenía oráculo de la RUTA.** El test solo ejercitaba el camino
   fail-closed que node da gratis (`require('expo-constants')` tira). Mover la clave en `app.config.ts` o
   leer otra rama dejaba la lista en `[]` **para siempre** y RBM4.7 ("cero código el día que llegue el
   dato") era falso sin que nada se pusiera rojo. → la ruta se extrajo a `eaProtocolsFromExpoConfig` y se
   ejercita contra la **config real** con la cadena sintética agregada: el diff de ese día, ejecutado.
   Mutantes M20/M21 mueren.
4. 🟠 **El `[]` literal en el call site.** `BindingEnv.declaredEaProtocols` es requerida, pero el tipo
   acepta un `[]` y el gate de MFi quedaría clavado en `build-sin-protocolos`. El call site es un `.tsx`
   (no importable en node:test) → guard sobre la fuente, con la mitad de comportamiento cubierta aparte.
   Mutante M16 muere.
5. 🟠 **`autoConnect` "la implementa SOLO spp-android" era FALSO desde F3** y nada caía: el adapter BLE no
   estaba en la lista que la tabla recorría. Importa acá y no en F3 porque **F4 es lo que hace alcanzable
   ese `autoConnect` en producción** (el piso de iOS y la preferencia son las dos únicas formas de montar
   `ble-gatt`): desde este delta un iPhone arranca **escaneando sin gesto**. → tabla y comentario del
   provider corregidos, consecuencia declarada en `requirements` (RBM5.6, punto 3).
6. 🟡 **`permissionModelFor('mfi-ios')` no tenía test.** Si compartiera `{kind:'ble'}`, la UI mostraría
   `permission_denied` + "Reintentar" sobre algo que **ningún permiso puede arreglar** (en MFi lo que falta
   es un dato de BUILD). → test propio + la aserción de que los dos modelos son distintos.
7. 🟡 **Cuatro imports/fixtures muertos** en `selection-priority.test.ts` (`ESP32_GATT_DRIVER`,
   `isAdapterUsableOn`, `ADAPTER_KINDS`, `RS420_WITH_MFI`/`SYNTHETIC_PROTOCOL`): la huella exacta de dónde
   murió el agente (había preparado los fixtures de la tabla del §6.1 y no llegó a escribir los tests). Los
   consumen los tests nuevos. **`tsc` no los ve**: `app/tsconfig.json` excluye `**/*.test.ts`.
8. 🟡 **`TransportInstructionKey` no tenía ancla de exhaustividad.** Una clave nueva podía nacer sin
   oráculo y en verde. → `TRANSPORT_INSTRUCTION_KEYS` en el módulo (que el typecheck sí mira) + el test que
   exige un caso por clave: una rama de copy nueva **nace en rojo**.
9. ✅ **La diversidad de fixtures de F3 sigue intacta y verificada**: `DRIVER_PROFILES` sigue con **2**
   perfiles sin un parámetro en común y su test de anti-vacuidad (*"los dos juegos son DISTINTOS en los
   TRES campos"*, + que ninguno del alternativo colisione con los NUS) pasa. Mis tests que usan
   `ESP32_GATT_DRIVER` (UUID NUS) están en `selection-priority`/`connection-view`, donde los UUID **no
   participan de la decisión** — no reemplazan ni tocan los fixtures de `adapter-ble-gatt.test.ts`.
10. 🟡 **`BUILT_TODAY` (el juego "como en el build real" de los tests) era un espejo suelto** de
    `BUILT_ADAPTERS` de la pantalla, que es un `.tsx` y no se puede importar. Un espejo que puede driftar no
    prueba nada. → el guard de la pantalla ahora fija el **conjunto completo** (no solo los dos kinds que
    importan hoy) y valida que cada uno sea un `AdapterKind`; mutante M22 muere.
11. ✅ **El re-montaje del transporte no leakea**: el efecto de wiring tiene `transport?.disconnect()` en su
    cleanup y depende de `transport`, así que la hidratación que cambia el kind desconecta el anterior. Lo
    verifiqué leyendo el efecto (no lo asumí del design).

**Considerado y NO cambiado, con motivo:**

- **La fila corta de "Más" no conoce el transporte** → con GATT la card dice *"Buscando el bastón…"* y la
  fila dice *"Reintentando…"*. Unificarlo exige que "Más" calcule un binding (scope nuevo). Lo que el
  proyecto exige que no se contradiga —el **tono**— está aserrado. Declarado en RBM5.14.
- **Un valor de storage que sea un ARRAY JSON** se lee como "el id es el JSON crudo" → `connect()` contra un
  id inexistente. Solo alcanzable editando el storage a mano (nuestro escritor siempre escribe un objeto y
  el formato viejo era una MAC saneada). El fallback existe para las MAC que parsean como número.
- **`'mfi-ios'` fuera de `BUILT_ADAPTERS`**: desviación deliberada de T4.8 (ver su nota). Mantenida: es la
  opción que **no miente** en `available`.
- **La fila del bastón en iOS dice "Emulador ESP32 (banco de pruebas)"**: es la consecuencia de dos
  decisiones del design (el driver del banco en el registro de producción + la pantalla muestra el driver
  del transporte montado). Es lo que RBM5.12 pidió y lo que hace posible F6; queda **fijada por un test** y
  señalada al Gate 2.5 para que la decisión sea de Raf y no un drift.

---

## 6. Reconciliación de specs (as-built)

| Archivo | Qué se reconcilió |
|---|---|
| `requirements-ios-ble-mfi.md` | Nota bajo **RBM4.5** (el `unavailableReason` viaja en todos los bindings no disponibles, y por qué) · Nota bajo **RBM5.6** (3 puntos: el CTA de olvidar no puede depender del transporte; la preferencia es entrada de storage y se valida fail-closed; el `autoConnect` de BLE se vuelve alcanzable) · Nota bajo **RBM5.12** (la consecuencia visible en iOS) · Nota bajo **RBM5.14** (el flujo BLE **no** tiene "listar → elegir", y por qué; qué sí entró; los dos límites declarados) |
| `design-ios-ble-mfi.md` | **§6.1**: orden "construido primero", el reason en todas las filas `false`, la ruta del plist como función aparte, los dos oráculos extra de la tabla + la fila `emulador GATT \| web → null` · **§6.2**: los tres puntos del as-built · **§8**: la mudanza completa del copy, la ausencia de la lista en BLE, el override aditivo de la card, `BUILT_ADAPTERS`, y qué entregó el Gate 2.5 en web |
| `tasks-ios-ble-mfi.md` | T4.1–T4.9 en `[x]` con `(as-built)` cada una, incluida la **desviación declarada** de T4.8 y los dos hallazgos de la autorrevisión bajo T4.6 · **T8.7**: 4 de 6 suites registradas (`ea-protocols` la escribió F4, `remembered-format` no estaba en la lista del spec) |

---

## 7. Gate 1 (N/A) verificado de forma ATRIBUIBLE — RBM9.1/RBM9.2, T8.8

`git status --porcelain supabase/ sync-streams/` → **salida vacía**. No hay nada que atribuir: ni mío ni de
la otra terminal. (El oráculo NO es `git diff supabase/`: mide el árbol y es ciego a los untracked.)

> ⚠️ **ESTO CAMBIÓ durante el fix-loop y la atribución está en §11.8**: al cerrar, `supabase/` tiene tres
> entradas y **ninguna es mía** (son de la otra terminal, spec 16 / EF `health`). Mi changeset sigue sin tocar
> una línea de backend.

Archivos del árbol que **no son de esta fase** y quedan declarados para que el Gate 2 no los cuente:
`progress/current.md`, `specs/active/10-operaciones-rodeo/{design,requirements}.md`, `?? .wrangler/`,
`?? docs/marketing/kit-capturas.zip`, `?? docs/monitoreo-banco-vs-mitropero-2026-08-12.md` (otra terminal) y
`progress/estado_delta-ios-ble-mfi.md` (lo editó el leader; le agregué el veredicto de los 7 rojos).

**Los 27 archivos de esta fase** (para que el Gate 2 sepa qué es mío):

- **Nuevos (6)**: `app/src/services/ble/{driver-esp32-gatt.ts, ea-protocols.ts, ea-protocols.test.ts, remembered-format.ts, remembered-format.test.ts}` · `app/e2e/captures/baston-ios-ble-mfi-f4.capture.ts`
- **Código modificado (10)**: `app/src/services/ble/{selection-priority.ts, adapter-selection.ts, driver-registry.ts, remembered-device.ts, stick-adapter.ts, permissions.ts, adapter-ble-gatt.ts, adapter-spp-android.ts, BleStickListenerProvider.tsx}` · `app/src/features/ble-stick/connection-view.ts` · `app/src/features/ble-stick/screens/StickConnectionScreen.tsx`
- **Tests modificados (4)**: `selection-priority.test.ts`, `driver-registry.test.ts`, `wiring.test.ts`, `connection-view.test.ts`
- **Infra (1)**: `scripts/run-tests.mjs` (8 líneas, bloque del cliente)
- **Specs + progress (5)**: los tres del delta + `progress/impl_ios-ble-mfi-f4.md` + `progress/estado_delta-ios-ble-mfi.md`

**Límites del encargo, verificados:** `adapter-hid-wedge.ts` **no tocado** (F7) · cero dependencias
instaladas (`package.json` y el lockfile sin cambios) · cero builds de EAS (el `expo export -p web` es local
y gratis, y fue para el capture) · `feature_list.json`, `progress/current.md`, spec 09, `supabase/` y
`sync-streams/` **no tocados** · `design/**/*.png` **sin churn** (`git status design/` vacío después de la
corrida del capture) · **nada commiteado**.

**Otros invariantes heredados (T8.9), verificados y no asumidos:**
- Cero archivos de spec 09 tocados (`app/src/features/animals/*`, screens de find-or-create): confirmado en
  la lista de archivos.
- Ningún método de `StickAdapter` modificado: el diff de `stick-adapter.ts` es **solo** el union de `kind`
  (aditivo, `'mfi-ios'`).
- Multi-tenant: F4 no toca ningún camino con `establishment_id` (es selección de transporte, pura).
- Offline-first: cero red nueva.

---

## 8. Verificación

- `tsc --noEmit` (app) → **rc=0**.
- Suites BLE + `ble-stick` + `app.config` + guards iOS/plugin → **689 pass / 0 fail** (baseline al
  arrancar: 654 / 7).
- `node scripts/check.mjs` → **RC=0, "Entorno listo. Podés trabajar."** con TODOS los stages verdes
  (typecheck → scripts → client unit → los 4 guards de EF puros → las 17 suites de DB). La 1ª corrida había
  dado RC≠0 en el stage *User_private suite* por
  **un flake, no una regresión**, y se demostró en vez de suponerlo:
  - el test que falló es `T21 R8.3: invitar email de NO-miembro → invitación OK` — la Edge Function
    `invite_user` devolvió un non-2xx (el test anterior, `T21 R8.1`, había pasado con 2xx);
  - **re-corrida sola: 28/28 verde**, o sea no es determinista;
  - **estructuralmente no puede ser mía**: `git status --porcelain supabase/ sync-streams/` está **vacío**
    (F4 no toca una línea de backend) y esa EF corre **deployada en el remoto**, así que su comportamiento no
    depende de mi árbol de trabajo. El remoto es DEV **compartido con la otra terminal** (que está en el
    rebrand de headers/EFs) y el envío del mail de invitación depende de un secret todavía pendiente.
  - ⚠️ Cuando un stage se pone rojo, **los posteriores NO CORREN**, así que antes de re-lanzar el check
    completo los siete que habían quedado cortados se corrieron a mano y **todos verdes**: Import 25/25 ·
    Sync streams 25/25 · Operaciones-rodeo 22/22 · SIGSA 72/72 · Treatments 11/11 · Audit 21/21 ·
    Health EF 5/5. La 2ª corrida completa confirmó lo mismo de punta a punta.
- Suites nuevas registradas en `scripts/run-tests.mjs` (**8 líneas** de diff, todas dentro del bloque de
  tests del cliente): `ea-protocols.test.ts` + `remembered-format.test.ts`. **Verificado que el bloque de
  la otra terminal sigue intacto** (rebrand fase 5: `request-headers.test.ts`; rebrand Cat. H:
  `backup-ci-consistency.test.mjs`).

## 9. Gate 2.5 (ADR-029) — capture file

`app/e2e/captures/baston-ios-ble-mfi-f4.capture.ts` → **4 capturas generadas y verificadas** en
`__shots__/baston-ios-ble-mfi-f4/` (gitignored; el `.capture.ts` se commitea):

```
pnpm exec playwright test e2e/captures/baston-ios-ble-mfi-f4.capture.ts --config playwright.capture.config.ts
→ 1 passed (9.1s)
```

| Shot | Qué muestra |
|---|---|
| `01-sin-baston-guardado.png` | `/baston` completa sin bastón guardado (el CTA de olvidar NO está — sin afordancia muerta en la primera instalación; aserrado antes del shot) |
| `02-devices-instruccion-serial.png` | banda de "Dispositivos": fila + la instrucción del transporte `serial` — el copy que se mudó del JSX a la vista pura, para vetar que no cambió ni se convirtió en card |
| `03-con-baston-guardado.png` | `/baston` completa con el registro sembrado en el **formato nuevo** → aparece el CTA de olvidar |
| `04-cta-olvidar-fuera-de-spp.png` | banda del fix: el CTA visible en el camino **no-SPP**, sin pisarse con la fila ni con la instrucción, y el texto entero a 412 px |

**Declarado como N/A del E2E web, con motivo estructural (RBM9.7)**: las instrucciones de `ble-gatt` y de
`mfi`, y el copy "Buscando el bastón…" / "Buscar de nuevo", salen del `transportKind` del binding, y en web
`adapterForTransport('ble-gatt','web')` es `null` **a propósito** (fail-closed). Fotografiarlas exigiría
mockear `Platform.OS` o inyectar un binding falso — cambiar producción para sacar una foto. Están cubiertas
por `connection-view.test.ts` (copy, ícono, precedencia por `unavailableReason`, y que ninguna prometa un
paso que el adapter no tiene) y les corresponden las capturas **de device** de F6/T6.6. Es el precedente que
ya fijaron `T-MV.7.2` y `baston-spp-bloqueantes.capture.ts`.

**Para el veto visual del leader**, dos cosas que conviene mirar con intención:
1. el CTA de olvidar quedó pegado debajo de la nota de instrucciones, sin separador: se lee como parte de
   la sección "Dispositivos" (correcto: habla del bastón guardado), pero es una decisión de layout nueva;
2. el `lineHeight` del cuerpo de la card de instrucciones quedó en `$4` con `fontSize="$3"` — es el patrón
   que ya usaban otras dos cards de esta misma pantalla, y en la card del HID cambia 1 línea respecto del
   as-built (era `$3`/`$3`). Sin recorte de descendentes en ningún caso (verificado en la captura 04).

---

## 10. Lo que queda GATED (para que no se lea como olvido)

- **F5** (`adapter-mfi-ios`): al escribirlo hay que agregar `'mfi-ios'` a `BUILT_ADAPTERS` **y actualizar en
  el mismo diff** el guard que hoy verifica su ausencia (`wiring.test.ts`), y registrar
  `adapter-mfi-ios.test.ts` en `run-tests.mjs` (T8.7 quedaría 5 de 6... la sexta es esa).
- **F6** (banco en device): es lo único que valida el transporte de verdad. Incluye las capturas de las
  ramas BLE/MFi que web no puede dar, y el escenario `name` del emulador para ejercitar
  reconocido/no-reconocido (RBM5.13 en device).
- **La preferencia de transporte no está probada en device**: la hidratación asincrónica + el re-montaje se
  verifican por guard de fuente y por el efecto leído, no por comportamiento (el provider es `.tsx`). El
  banco de F6 en Android es donde se mide de verdad — y es el escenario que este delta agregó al banco:
  conectar por BLE, cerrar la app, reabrirla y ver que monta `ble-gatt` y no `spp-android`.
- **`pnpm e2e`** (regresión completa, ~38 min) **no se corrió**: `check.mjs` no incluye Playwright. F4 no
  toca ningún camino que la E2E ejercite en web salvo `/baston`, y el riesgo declarado es cero para las ~70
  specs porque corren en `mock` (la rama de la preferencia corta antes; hay test que lo recorre sobre todo
  el union de `AdapterKind`). El capture de esta fase sí corrió sobre el build fresco.

---

# 11. FIX-LOOP del review (CHANGES_REQUESTED) — 2026-08-17

Encargo: `progress/review_ios-ble-mfi-f4.md`. El reviewer confirmó que **no hay que rehacer nada** de la
primera pasada (check verde con los 22 stages, 3340/3340, trazabilidad completa, los 3 mutantes de F3 siguen
muriendo, 5 mutantes propios muertos) y pidió **tres desalineaciones** más dos 🟡 chicos. Se cerraron los
cinco que le corresponden al implementer; el 🟡-4 (declarar el veto visual como parcial) es del leader y acá
solo queda la evidencia que necesita para decidirlo.

## 11.1 🟠-1 — el arranque en frío de iOS construía el `CBCentralManager`, y el código decía que no

**El diagnóstico, ejecutado y no leído**: `isBleGattTransportAvailable()` llamaba a `loadBleManager()`, y eso
**construye** el client de `react-native-ble-plx` → del lado nativo se crea un `CBCentralManager`, que en iOS
es lo que dispara el diálogo de permiso de Bluetooth del SO. Ese camino corre en `instantiateTransport`, o sea
en el **primer render del provider**: un iPhone recién instalado podía recibir el diálogo **al abrir la app**,
sin un gesto (RBM3.8 incumplido). Y el comentario del adapter + la nota de T3.10 afirmaban lo contrario: eran
ciertos de `autoConnect()` (que sí tiene su gate de bastón recordado primero) y **falsos del sistema**, porque
el manager se construía una capa antes de todos los gates. Es la clase *"el comentario promete más que el
código"* que en esta unidad ya costó un 🔴.

**Cómo quedó** (`adapter-ble-gatt.ts`): el borde de la lib se partió en **dos operaciones con costos
distintos**, declaradas como tales en un entorno inyectable (`BleModuleEnv`):

| | qué hace | cuesta |
|---|---|---|
| `nativeModulePresent()` | lee `NativeModules.BlePlx` (lo mismo que `isSppNativeAvailable`) | nada: no construye ni toca la radio |
| `constructManager()` | `new BleManager()` → `BleModule.createClient(...)` | **crea el `CBCentralManager`** = primer uso de la radio |

`isBleGattTransportAvailable()` pregunta **solo lo primero**. La construcción quedó donde ya había gate:
`doConnect` (gesto o cadena con su `ConnectTrigger`) y `autoConnect` **después** de `readRemembered`. Con eso
la afirmación de las specs pasa a ser cierta **por construcción** y RBM3.8 se sostiene también en iOS.

**El oráculo es de comportamiento** (era la condición del encargo): el borde es inyectable y el test **cuenta
construcciones del manager**. Tres tests + un control positivo, y los dos mutantes que reintroducen la
construcción eager mueren:

| Test | Qué mide |
|---|---|
| *`isBleGattTransportAvailable` CONSULTA el módulo y NO construye* | 1 consulta, **0 construcciones**; y sin driver en el registro corta **antes** de consultar (el gate barato primero) |
| *un ARRANQUE EN FRÍO construye CERO managers* | la secuencia real de producción (disponibilidad + `new BleGattAdapter()` **con el env REAL** + `autoConnect()` sin bastón recordado) → **0** |
| *con un bastón recordado el manager SÍ se construye — y una sola vez* | **control positivo**: 1 construcción + cacheo (si "cero" fuera cierto siempre, el oráculo no probaría nada) |
| *sin el binario, ni disponibilidad ni manager* | 0 construcciones (construir tiraría: `BleModule === undefined`) |

**Lo que este fix NO prueba, dicho como límite**: qué hace iOS de verdad. Es un escenario nuevo de **T6.4**
(instalación limpia, sin bastón recordado, abrir la app y no tocar nada → el diálogo **no** debe aparecer), con
el siguiente sospechoso ya anotado en el design §13 (que leer `NativeModules.BlePlx` en bridgeless instancie
CoreBluetooth) y su mitigación.

## 11.2 🟠-2 — en Android `ble-gatt` era inalcanzable: ahora hay camino de ESCRITURA de la preferencia

**El bucle, medido**: la preferencia la escribe **el adapter al conectar**; en Android el adapter BLE solo se
monta si la preferencia ya dice `ble-gatt`. Huevo y gallina → el transporte BLE inalcanzable en producción en
la plataforma del productor, y **el banco de F6/T6.2 sin poder arrancar**. Mismo patrón que R6.6 con cero call
sites.

**La decisión de diseño que tomé, con lo que descarté y por qué** (el reviewer la había dejado como "scope
nuevo"; el leader pidió cablearla):

- ✅ **La sección "Dispositivos" ofrece los otros transportes alcanzables** (uno por lector), con la misma
  anatomía y las mismas vistas puras que la rama existente (fila + card de instrucción). Tocar uno **monta ese
  transporte y lo conecta**; al conectar, **el adapter** persiste el device que contestó con su `adapterKind`.
- ❌ **NO se agregó una lista de resultados de escaneo** (el *"listar → elegir"* literal de RBM5.14). Dos
  motivos, el segundo nuevo: (a) el `StickAdapter` no expone el escaneo y RBM9.6 prohíbe tocar su interfaz;
  (b) escanear por afuera del adapter sería una **segunda implementación de la misma operación de radio**
  —permisos, presupuesto, `stopDeviceScan`— y dos implementaciones de la misma verdad divergen: es el bug de
  clase de este camino (`isRawStream`, `BLE_OWNED_ROUTES`, las tres copias de `toneColorToken`). Además, con un
  solo driver `ble-gatt` en el registro (RBM5.11), esa lista tendría exactamente **una** fila que el adapter ya
  elige solo: teatro.
- ❌ **NO se persiste al elegir** (aunque el encargo decía *"elegir tiene que persistir el device elegido"*):
  se persiste al **conectar**, que es cuando se sabe el `deviceId` real (en BLE lo descubre el escaneo) y que
  funcionó. Persistir antes es literalmente MEDIUM-2 del Gate 2 y el bug del `vendorId`. La **forma** es la que
  el encargo exige (el id del **device**, no un `vendorId`), y hay guard sobre la ausencia.
- ❌ **NO se gateó la fila por `__DEV__`/demo**. Tentador para que el productor no vea el banco de pruebas,
  pero el build local de release (la única forma de probar en la manga) tiene `__DEV__ === false` y sin flag de
  demo → **habría escondido la fila justo en el build del banco**, o sea el mecanismo inalcanzable otra vez.
  La fila dice lo que es y funciona; esconderla, si Raf lo decide, es un `filter` de una línea (design §13).

**Las piezas** (y dónde vive cada decisión, para que nada quede solo en un `.tsx`):

| Pieza | Dónde | Por qué ahí |
|---|---|---|
| `transportChoices(env)` | `adapter-selection.ts` (puro) | qué transportes se pueden elegir, derivado de `selectReaderBinding` + `selectTransportAdapter` (no una segunda tabla). El **registro entra inyectado y sin default**: este módulo es una de las dos superficies **ciegas al fabricante** (RBM1.7) y el guard de `adapter-ingest-mode.test.ts` **me cazó** el `import { DRIVER_REGISTRY }` que había puesto |
| `mountActionFor(env)` | `adapter-selection.ts` (puro) | `'connect'` si el montaje lo pidió un gesto, `'autoconnect'` si es el arranque, `'none'` si el transporte no auto-conecta. Sin esto, elegir un transporte no hacía nada visible (el `autoConnect` corta en "¿hay bastón recordado?" y en este escenario justamente no hay) |
| `rememberedDeviceIdFor(...)` | `remembered-format.ts` (puro) | el id recordado **no se presta entre transportes**: ver 11.2.1 |
| `chooseTransport(kind)` + `providerMode` | `BleStickListenerProvider.tsx` | la única entrada por gesto a la preferencia; el modo viaja para que la pantalla sepa si ofrecer algo tiene sentido |
| la banda de filas | `StickConnectionScreen.tsx` | **afuera de las dos ramas** del ternario `isSpp`, misma trampa por ubicación que el CTA de olvidar |

### 11.2.1 Una consecuencia que el encargo no anticipaba y que había que cerrar

El registro guarda **UN** bastón (R6.7) con SU `adapterKind`. Mientras el transporte montado lo decidía ese
mismo registro, el id y el transporte **no podían divergir**. Desde que el operario puede elegir, sí: un
`connect()` sin id leía el id **del otro** transporte → RFCOMM contra un device que solo anuncia GATT, o
`connectToDevice()` contra una MAC de Classic. Y eso **no falla rápido: se queda esperando** (el síntoma más
caro de esta unidad). Ahora cada adapter toma el id solo si el registro es de su transporte; si no, escanea. El
formato viejo lo acepta **solo el SPP** —era su único escritor posible— y esa asimetría está reconciliada en
RBM5.7.

### 11.2.2 El guard sobre la ausencia (lo que el encargo pedía)

`wiring.test.ts`, *"🟠-2 GUARD SOBRE LA AUSENCIA"*: para cada plataforma y cada `AdapterKind`,

- si **no está construido** en este build → la preferencia **no puede honrarlo** (fail-closed: si no, un valor
  de storage le saca el piso al operario y lo deja sin transporte, en silencio);
- si está construido y es usable en esa plataforma y **no es el piso** → tiene que estar (a) honrado por
  `selectTransportAdapter`, (b) **ofrecido por la pantalla** (`transportChoices`) y (c) **escrito por alguien**
  (barrido del árbol). Con anti-vacuidad: hoy el único par no-piso es `ble-gatt`/Android, el que 🟠-2 destrabó.

**F5 nace en rojo**: al agregar `mfi-ios` a `BUILT_ADAPTERS` tiene que sacarlo de `NOT_SELECTABLE_AS_PREFERENCE`,
ofrecerlo y escribir su `adapterKind`, o el guard cae. Quedó escrito en T5.3.

## 11.3 🟡-1 · 🟡-2 · 🟡-3

- **🟡-1** — `'mfi-ios'` entra a `NOT_SELECTABLE_AS_PREFERENCE` hasta que F5 lo construya, y el criterio de esa
  lista quedó escrito como uno solo: *`AdapterKind` que `instantiateTransport` no puede construir hoy*.
  Falsificado (MUT-E: sacarlo mata 3 tests, incluido el guard de alcanzabilidad). Sale **en el mismo diff** que
  lo construya, y el guard lo exige.
- **🟡-2** — T5.3 reconciliada: las cuatro entradas las hizo F4 (con el motivo de compilación), y la task ahora
  **enumera lo que queda para F5** (adapter + `BUILT_ADAPTERS` + el gate + la fila/escritor + registrar su
  suite), para que el implementer de F5 no tenga que deducirlo.
- **🟡-3** — el guard de los escritores dejó de mirar **tres archivos nombrados**: barre `app/src` + `app/app`
  completas (sin tests), exige que la lista de módulos que llaman `writeRememberedDevice` sea **cerrada** (el
  borde + los dos adapters), que cada uno pase **su** `adapterKind`, y que el literal de la clave de storage
  viva en **un solo** módulo. `app/e2e` queda afuera con motivo escrito (ahí el registro se siembra como
  fixture). `docs/backlog.md` ⚪-K ítem 2 → **cerrado**, con las dos mitades documentadas.
- **🟡-4** — no es mío: es la decisión del leader de declarar el veto visual **parcial**. Lo que le dejo para
  decidir: la lista concreta de superficies sin evidencia visual quedó escrita en **T6.6** (la fila del banco en
  iOS, la banda de transportes en Android, el copy de `ble-gatt`) y el motivo estructural en el design §8.

## 11.4 Autorrevisión adversarial (qué busqué, qué encontré, cómo lo cerré)

**Qué busqué**: que el fix de 🟠-1 no se pase de conservador (que el arranque siga reconectando); afordancias
muertas en la banda nueva; qué pasa si el gesto y la hidratación corren juntos; si mi guard nuevo puede pasar
por vacuidad; si el probe de la pantalla puede driftar; regresión en las ~70 specs E2E; y si el registro del
bastón recordado alcanza para dos transportes.

**Encontrado y cerrado:**

1. 🔴 **La E2E del capture me cazó un bug de producción que mis tests puros no veían.** La oferta se derivaba
   con `mode: 'auto'` **hardcodeado**. En `mock`/`demo` —donde corren las ~70 specs— el kind montado NO es el
   piso de la plataforma, así que el piso aparecía como "alternativa": `/baston` renderizaba **DOS filas
   idénticas** ("Allflex RS420 · Tocá para conectar"), y tocar la segunda no podía montar nada porque esos modos
   ignoran la preferencia (RBM5.9). → el modo pasó a ser entrada **requerida** de `transportChoices`, viaja por
   el api del provider (`providerMode`), y hay test de los tres modos × plataformas × kinds montados + guard de
   fuente que prohíbe el `'auto'` literal. **Es el motivo por el que el capture no es decorativo**: el oráculo
   que lo cazó fue `expect(row).toHaveCount(1)`, agregado antes de sacar la foto.
2. 🟠 **La hidratación podía pisar el gesto.** La lectura del bastón recordado es asincrónica (techo de 2 s):
   un operario que elige otro transporte mientras está en vuelo veía el transporte elegido **desmontarse solo**
   dos segundos después. → el gesto le gana a la hidratación, con guard (MUT-J muere).
3. 🟠 **`adapter-selection.ts` no puede conocer el registro de drivers** (RBM1.7). Había puesto
   `registry = DRIVER_REGISTRY` como default y **el guard de ceguera al fabricante me lo tiró**: ese import es
   la puerta del `DRIVER_REGISTRY[0].frameParser` que el review de F1 falsificó. → el registro entra inyectado
   desde la pantalla (que sí conoce lectores porque muestra sus nombres). Es un guard existente haciendo
   exactamente su trabajo sobre código nuevo.
4. 🟠 **Una fila que ofrece un transporte que este build no puede montar** sería la afordancia muerta del
   bugfix del 2026-07-29. → `installable` entra por probe inyectada, la fila cae a *"todavía no disponible en
   esta versión"*, y el probe de la pantalla **no puede driftar** del de `instantiateTransport` (guard cruzado,
   MUT-L muere). Y esto **solo es posible gracias al fix de 🟠-1**: antes, preguntar por la disponibilidad del
   BLE construía el `CBCentralManager` — la pantalla no podía consultarlo sin tirar el diálogo del SO.
5. 🟠 **Ofrecer un transporte que la selección igual no honraría** (gateado, o imposible en la plataforma).
   → la oferta se **deriva** de `selectTransportAdapter`, no de una lista de kinds prohibidos: cuando un gate se
   abra, la fila aparece sin tocar `transportChoices`.
6. 🟡 **Dos filas del mismo transporte** si algún día hay dos drivers `ble-gatt`: el adapter usa **el primero**
   del registro, así que la segunda fila prometería un lector que no se va a usar. → una fila por
   `AdapterKind`, con el primer driver, y test que cruza el driver de la fila contra el del **adapter
   instanciado** (identidad, no nombre).
7. 🟡 **El barrido de escritores miraba solo tres carpetas** (`services/ble`, `features`, `app/app`) y se
   perdía `contexts/`, `hooks/`, `utils/`, el resto de `services/` — justo donde viven los otros dos
   consumidores del registro. → barre `app/src` + `app/app` completas.

**Considerado y NO cambiado, con motivo:**

- **El copy de la fila dice *"Tocá para conectar"* y tocarla además CAMBIA el transporte** (y baja el link
  vivo del otro, si había). Es la misma semántica que elegir otro emparejado en la lista del SPP —que ya dice
  eso— y lo que R6.7 implica (un bastón por dispositivo). Divergir el copy solo para esta fila rompería la
  consistencia de la sección; si en device se ve confuso, es un cambio de una cadena en la vista pura.
- **Elegir un transporte no deja evento en el log.** `logTransportEvent` tiene un union cerrado de kinds y
  agregar uno toca `logging.ts` + su test; el connect que sigue sí loguea, así que el cambio de transporte es
  inferible en logcat. Anotado como lo que es: si el banco de F6 lo necesita, es un `kind` nuevo.
- **Cuando el transporte no se pudo instanciar** (`transport === null`), la banda ofrece el kind resuelto con
  `installable:false` **y** la rama principal muestra su propia fila: dos filas con mensajes distintos sobre lo
  mismo. Solo pasa en un build sin el binario (pre-F2). Excluir el kind *resuelto* exigiría que la pantalla
  conozca `resolvedKind` (hoy solo ve `transport?.kind`), y prefiero la fuente honesta.
- **`'mfi-ios'` sigue fuera de `BUILT_ADAPTERS`** (desviación de T4.8 ya declarada en la primera pasada).

## 11.5 Trazabilidad del fix-loop (`RBM<n>` → test)

| Requisito | Test (archivo:nombre) |
|---|---|
| RBM3.8 (iOS) | `adapter-ble-gatt.test.ts`: *`isBleGattTransportAvailable` CONSULTA … y NO construye* · *un ARRANQUE EN FRÍO … construye CERO managers* · *con un bastón recordado el manager SÍ se construye* (control positivo) |
| RBM2.3 | `adapter-ble-gatt.test.ts`: *sin el binario en el build, ni disponibilidad ni manager* (y nunca se intenta construir) |
| RBM5.6 | `selection-priority.test.ts`: *en Android con el SPP montado, el BLE se puede ELEGIR* · *…con el BLE montado, el SPP se puede ELEGIR* · *TODA alternativa ofrecida se monta de verdad* · `wiring.test.ts`: *GUARD SOBRE LA AUSENCIA* · *la pantalla OFRECE los otros transportes, y NO desde adentro de una rama* · *el provider DERIVA la acción de montaje* · *un transporte montado POR GESTO se conecta* |
| RBM5.6 (fail-closed) | `selection-priority.test.ts`: *una preferencia `mfi-ios` no se honra hasta que F5 construya su adapter* (🟡-1) |
| RBM5.7 | `remembered-format.test.ts`: *cada transporte solo usa el id que ÉL recordó* · *el formato VIEJO lo acepta SOLO el SPP* · *el filtro es EXHAUSTIVO sobre `AdapterKind`* · `wiring.test.ts`: *cada adapter usa el bastón recordado SOLO si el registro es de SU transporte* |
| RBM5.9 | `selection-priority.test.ts`: *en `mock`, `demo` y `manual` NO se ofrece NINGÚN transporte* (con contraprueba en `auto`) · el capture: `expect(row).toHaveCount(1)` |
| RBM5.11 / RBM5.12 | `selection-priority.test.ts`: *la fila del transporte BLE dice que es un BANCO DE PRUEBAS* (y no nombra ningún lector comercial) |
| RBM5.14 | `selection-priority.test.ts` (las cinco de arriba) + `wiring.test.ts`: *el LECTOR que la fila promete es el que el adapter va a usar de verdad* |
| RBM1.7 | `adapter-ingest-mode.test.ts` (existente): *las superficies que CABLEAN un adaptador son CIEGAS AL FABRICANTE* — **me cazó** el import del registro |
| R8.7 | el guard de alcanzabilidad, rama "no construido → no se honra" (cubre `hid-wedge` en las 4 plataformas) |
| 🟡-3 | `wiring.test.ts`: *los módulos habilitados a ESCRIBIR el bastón recordado son una lista CERRADA* |

## 11.6 Mutantes del fix-loop: 12 corridos, **12 muertos**

Backup con nombre propio (`scratchpad/impl-f4b-backup-9dfa/`, con `apply` que **aborta si hay un backup
pendiente**) y revert verificado **por hash contra ese backup** — no con `git diff`, que compara contra HEAD y
con trabajo sin commitear encima no ve nada. Estado final: `limpio`.

| # | Mutante | Invariante que vigila | Resultado |
|---|---|---|---|
| MUT-A | `isBleGattTransportAvailable` vuelve a `loadBleManager() == null` | RBM3.8 (el arranque construye el manager) | ☠️ 2 |
| MUT-B | `loadManager()` **antes** del gate de bastón recordado en `autoConnect` | RBM3.8 (el gate barato primero) | ☠️ 1 (el pre-existente NO cae: su env no cuenta construcciones) |
| MUT-C | `transportChoices` devuelve siempre `[]` | 🟠-2 entero | ☠️ 8 |
| MUT-D | el adapter BLE escribe sin `adapterKind` | 🟡-3 + alcanzabilidad (sin escritor) | ☠️ 3 |
| MUT-E | `'mfi-ios'` sale de `NOT_SELECTABLE_AS_PREFERENCE` (el as-built de F4) | 🟡-1 / fail-closed | ☠️ 3 |
| MUT-F | la pantalla calcula las alternativas y **no** las renderiza | 🟠-2 (mecanismo sin superficie) | ☠️ 1 |
| MUT-G | las alternativas se mueven **adentro** de la rama no-SPP | 🟠-2 (la trampa por UBICACIÓN: Android las pierde) | ☠️ 1 |
| MUT-H | el BLE vuelve a tomar el `deviceId` crudo del registro | 11.2.1 (dialar el device del otro transporte) | ☠️ 1 |
| MUT-I | la pantalla vuelve a asumir `mode:'auto'` | el bug que cazó la E2E (fila duplicada en mock) | ☠️ 1 |
| MUT-J | la hidratación vuelve a pisar el gesto | la carrera de 11.4.2 | ☠️ 1 |
| MUT-K | `mountActionFor` ignora el gesto (siempre `autoconnect`) | elegir un transporte no haría nada | ☠️ 1 |
| MUT-L | el probe del BLE de la pantalla deja de ser el de `instantiateTransport` | dos respuestas de la misma verdad | ☠️ 1 |

## 11.7 Reconciliación de specs del fix-loop

| Archivo | Qué se reconcilió |
|---|---|
| `requirements-ios-ble-mfi.md` | Nota nueva bajo **RBM3.8** (el arranque en frío de iOS SÍ tocaba la radio; cómo quedó y qué falta medir en device) · nota bajo **RBM2.3** (el guard consulta, no construye) · nota bajo **RBM5.6** (el propósito no se cumplía en Android; las 5 piezas del camino de escritura + el guard sobre la ausencia + el límite del banco de pruebas en Android) · nota bajo **RBM5.7** (el formato viejo lo acepta solo el SPP, y por qué) · nota bajo **RBM5.14** (qué significa "elegir → conectar" en el as-built y por qué sigue sin haber lista de escaneo) |
| `design-ios-ble-mfi.md` | **§4** as-built punto 7 (el paso 2 del flujo es lo que construye el manager) · **§6.2** el bloque del camino de escritura, con el pseudocódigo de `transportChoices` y las cinco decisiones · **§8** la tabla de qué agrega la banda por plataforma + el límite de que web no la puede fotografiar · **§13** tres riesgos nuevos (el diálogo de iOS no verificado en device, la banda sin evidencia visual, la fila del banco visible en Android) |
| `tasks-ios-ble-mfi.md` | **T3.10**: corrección de la nota que afirmaba lo que 🟠-1 desmintió · **T4.10/T4.11/T4.12** (nuevas, `[x]`: el as-built de este fix-loop) · **T5.3** reconciliada (hecha en F4) + qué queda para F5 · **T6.2** cómo se arranca el banco de Android y los dos escenarios que el fix compra · **T6.4** el escenario de RBM3.8 en device (primero, antes de todo) · **T6.6** la lista de superficies sin evidencia visual · tabla de trazabilidad actualizada |
| `docs/backlog.md` | ⚪-K ítem 2 **cerrado** (las dos mitades: la escritura borrada y el guard sobre el invariante) |

## 11.8 Verificación del fix-loop

- `tsc --noEmit` (app) → **rc=0**. Con `--noUnusedLocals --noUnusedParameters`: los **dos** hits son los
  preexistentes que el reviewer ya catalogó (`adapter-ble-gatt.ts:402`, `adapter-spp-android.ts:280`, el param
  `ms`), ninguno de este fix-loop.
- Las 15 suites BLE + `ble-stick` sueltas: **451 pass / 0 fail**.
- `node scripts/check.mjs` sobre el árbol **FINAL** → **RC=0**, *"Entorno listo. Podés trabajar."*, con los
  **22 stages abiertos y los 22 cerrados con `OK`** (contados, no leídos de un resumen: ninguno quedó
  cortado). *client unit tests*: **3366 pass / 0 fail** (3340 + los 26 de este fix-loop).
  - ⚠️ **La corrida anterior dio RC≠0 y la causa se DEMOSTRÓ, no se supuso**: el stage 21 (*Audit suite,
    spec 18*) falló con `createUser(userD): fetch failed` en su `TA.1 setup` y la cascada habitual de
    `Cannot read properties of undefined (reading 'from')`. Es la clase catalogada de flake del remoto
    compartido (falla de red/auth admin API con dos terminales trabajando), y se descartó como regresión por
    tres vías: (a) **re-corrida sola: 21/21 verde**, o sea no es determinista; (b) **estructuralmente no
    puede ser mía**: `git status --porcelain supabase/` está vacío y esa suite corre contra la DB/EF
    **deployadas en el remoto**, así que su resultado no depende de mi árbol; (c) el stage había pasado en la
    corrida anterior con el mismo backend.
  - ⚠️ Como el check **muere en el primer stage rojo**, el único posterior que quedó cortado se corrió a
    mano en el momento: *Health EF suite (spec 16 Run C)* → **5/5 verde**. Después se re-lanzó el check
    completo (el que da el RC=0 de arriba), así que los 22 stages están corridos **en una sola pasada** y no
    reconstruidos a mano.
- **Capture del Gate 2.5 re-corrido** sobre un build fresco (`pnpm run e2e:build`): **1 passed**, 4 shots
  regenerados. El `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` del final es el crash de teardown de
  Node en Windows **después** de pasar (catalogado), no un fallo. Las capturas son **las mismas cuatro**: la
  banda nueva **no se puede fotografiar en web** (ahí la lista de alternativas es vacía por diseño), y eso
  quedó escrito en el design §8 y en T6.6. Lo que el capture sí agrega es un **oráculo de regresión**:
  `expect(row).toHaveCount(1)` — el que cazó el bug de la fila duplicada.
- `scripts/run-tests.mjs`: **no se tocó** en el fix-loop (cero suites nuevas: todo entró en suites ya
  registradas, a propósito, porque el archivo lo comparte otra terminal). Verificado que el bloque del rebrand
  fase 5 (`request-headers.test.ts`) y el de la Cat. H (`backup-ci-consistency.test.mjs`) siguen intactos.
- **Gate 1 (N/A) — atribución, que cambió durante el fix-loop y hay que decirla con precisión**: al abrir,
  `git status --porcelain supabase/ sync-streams/` estaba **vacío**; al cerrar tiene **tres entradas**, y
  **ninguna es mía**: `supabase/functions/health/index.ts`, `supabase/tests/health/run.cjs` y
  `?? supabase/tests/health/env-oracle.cjs` son de la **otra terminal** (spec 16 — ambientes/release; su
  `specs/active/16-ambientes-y-release/design.md` apareció en el mismo tramo). Mi changeset no toca una línea
  de `supabase/` ni de `sync-streams/`: es selección de transporte + UI local. Se puede verificar por lista de
  archivos (§11.8, arriba) y porque el delta entero no tiene una migración ni una EF.
  `git status design/` → **vacío** (sin churn de PNG, aunque corrí el capture). `package.json`/lockfile sin
  cambios. **Nada commiteado.**
- **Otros archivos del árbol que NO son de esta fase** (para que el Gate 2 no los cuente): `progress/current.md`
  y `progress/estado_delta-ios-ble-mfi.md`, `specs/active/10-operaciones-rodeo/{design,requirements}.md`,
  `specs/active/16-ambientes-y-release/design.md`, `.gitignore` (el `.wrangler/`),
  `?? docs/marketing/kit-capturas.zip`, `?? docs/monitoreo-banco-vs-mitropero-2026-08-12.md` y los tres de
  `supabase/` de arriba.

**Los archivos del fix-loop** (todos ya estaban en el changeset de F4 salvo los dos marcados):

- **Código**: `app/src/services/ble/{adapter-ble-gatt.ts, adapter-selection.ts, adapter-spp-android.ts, remembered-format.ts, BleStickListenerProvider.tsx}` · `app/src/features/ble-stick/screens/StickConnectionScreen.tsx`
- **Tests**: `app/src/services/ble/{adapter-ble-gatt.test.ts ← NUEVO en el changeset, selection-priority.test.ts, wiring.test.ts, remembered-format.test.ts}`
- **E2E**: `app/e2e/captures/baston-ios-ble-mfi-f4.capture.ts` (el oráculo nuevo)
- **Specs + docs**: los tres del delta + `docs/backlog.md` ← NUEVO en el changeset + este informe
  - ⚠️ `docs/backlog.md` lo está editando **también la otra terminal** (la entrada del secret
    `MITROPERO_ENV` de la EF `health`, spec 16). Mi cambio es **un solo bullet** —el `✅ CERRADO` del ítem 2
    de la entrada ⚪-K del 2026-07-30— y se aplicó anclado a su texto, así que las dos ediciones conviven
    (verificado: el diff del archivo tiene las dos). Si el Gate 2 mira ese archivo, esa es la línea de corte.

## 11.9 Lo que queda GATED después del fix-loop (para que no se lea como olvido)

- **La banda de transportes elegibles no tiene evidencia visual**: en web es vacía por diseño. Su veto visual
  es **T6.6** y el flujo entero **T6.2**. Riesgo residual declarado en el design §13: un error de render solo
  visible en device (el componente reusa `StickDeviceRow`/`TransportInstructions` con las mismas props que la
  rama existente, y el typecheck lo cubre, pero eso no es una foto).
- **RBM3.8 en iOS sigue sin medirse en device**: T6.4, primer escenario.
- **El filtro del id por transporte** (`rememberedDeviceIdFor`) está cableado en los `default*Env`, que ninguna
  suite ejerce (todas inyectan un env falso): guard **estático** + comportamiento en la capa pura, declarado
  como tal. El caso real se mide en T6.2 (elegir un transporte con el bastón del otro recordado → tiene que
  **escanear**, no quedarse "conectando").
- **`pnpm e2e` COMPLETO** (~38 min) **no se corrió**, igual que en la primera pasada. Pero el riesgo dejó de
  ser un argumento y pasó a ser una medición: en E2E el provider **nunca** corre en `mode:'auto'`
  (`_layout.tsx:729` → `demo`/`manual`/`mock`), en esos tres modos `transportChoices` devuelve `[]` por test, y
  **se corrieron las dos specs que viven en la superficie que toqué**:
  `e2e/baston-multivendor.spec.ts` + `e2e/baston-chip.spec.ts` → **8 passed** (38 s), cubriendo los tres modos
  que la E2E usa: **demo** (la pantalla `/baston` con la fila del RS420 + los controles de simulación),
  **mock** (la corrida no-demo) y **manual** (sin transporte: el chip que no existe y la fila de "Más" que dice
  "No disponible"). Cero filas nuevas, cero locators rotos. Sin churn de `design/**/*.png` después de correrlas
  (verificado con `git status design/`).
