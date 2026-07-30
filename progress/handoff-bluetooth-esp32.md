# Handoff — Bluetooth del bastón + ESP32 como banco de pruebas

**Escrito**: 2026-07-29, al cierre de la sesión que puso el bastón a funcionar en Android.
**Para**: una terminal Claude Code limpia que continúe las pruebas de Bluetooth.
**No es** un `HANDOFF-*.md` en el sentido de `CLAUDE.md` (esos son bajadas de claude.ai y se borran).
Este vive en `progress/` y es material de referencia: se actualiza o se borra cuando el bastón esté
cerrado en las dos plataformas.

---

## Prompt para arrancar la terminal limpia

```
Seguís el trabajo de Bluetooth del bastón. Antes de tocar nada:

1. Protocolo de arranque de CLAUDE.md (AGENTS.md, `node scripts/check.mjs`, progress/current.md,
   progress/plan.md, feature_list.json).
2. Leé progress/handoff-bluetooth-esp32.md completo — es el estado de esta línea de trabajo, con lo
   que está verificado en device y lo que solo está leído.
3. Leé specs/active/04-bluetooth-baston/context-multivendor.md (matriz de transportes) y
   firmware/baston-emulator/README.md (el banco de pruebas).

El bastón funciona en Android por SPP Classic (commit dad711f) pero NUNCA leyó una trama real: no hay
lector físico. El ESP32 está listo para emular uno y el firmware está commiteado (89e8d2d), pero NO
está flasheado — flashearlo requiere que Raf esté presente y su OK (§7).

Primera tarea sugerida, en este orden:
  a) La review adversarial del camino SPP, que quedó sin correr (§3). Es read-only: reviewer, no
     implementer.
  b) Con Raf presente: flashear MODO_SPP y correr el banco contra el APK que ya está instalado (§4).

Actuás como `leader` (CLAUDE.md): descomponés y coordinás, no editás código de app ni tests.
```

---

## 1. Qué funciona hoy y cómo se verificó

Distinción que importa: **"lo leí"** (deduje del código) vs **"lo corrí y lo vi"** (evidencia
empírica). En esta sesión confundí las dos varias veces y salió caro.

| commit | qué hizo | verificación |
|---|---|---|
| `4f1f86b` | aire entre CTA/navbar y la barra del sistema (Android edge-to-edge) | ✅ **device** (Raf, screenshots) |
| `eabfd00` | primitivo `KeyboardAvoidingShell` + variante `.android.tsx` con `useAnimatedKeyboard` | ✅ **device** |
| `56beff3` | barrida de las 23 superficies con input **sin** mecanismo de teclado | ✅ **device** |
| `615328d` | abrir un sheet baja el teclado (el diálogo de salir quedaba tapado) | ✅ **device** (Raf: "salió perfecto") |
| `69ce945` | sin transporte, el chip de bastón deja de prometer conexión | ✅ **device** |
| `dad711f` | **el bastón en Android por SPP Classic**: dep nativa + 3 bugfixes + permisos + config plugin | ⚠️ **parcial** — ver abajo |
| `16cf880` | respaldo del firmware que el ESP32 tenía antes | ✅ volcado + sha verificado |
| `89e8d2d` | emulador de bastones (3 modos) | ⚠️ compilado y tramas validadas contra el parser; **no flasheado** |

**Puerta 2 cerrada** para toda la serie teclado+aire, verificada en device (Android).

### Qué está verificado del bastón en Android (`dad711f`)

Con el APK instalado por `adb` en el Android de Raf, cada eslabón menos el último:

- la app **bootea** con la dep nativa `react-native-bluetooth-classic` adentro (no crashea);
- `BluetoothAdapter()` **se instancia** (la dep resuelve en runtime, no es solo un import muerto);
- los permisos runtime **pasan** (`BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT`, Android 12+);
- `getBondedDevices()` **se consulta** y devuelve;
- la pantalla renderiza el **empty state honesto** ("no hay bastones emparejados"), no una promesa falsa.

**Lo que NO está verificado: que llegue y se parsee una trama real.** No hay RS420 físico. Ese es
exactamente el hueco que tapa el ESP32.

---

## 2. Arquitectura del Bluetooth (lo que hay que respetar)

**Contrato transport-agnóstico** (ADR-024): la ingesta de lecturas no sabe de transporte. Hay un
registro de drivers (`driver-registry.ts`), selección por capacidad (`selection-priority.ts`) y
adapters intercambiables detrás de `contract.ts`. Agregar un transporte = agregar un adapter, no
tocar los consumidores.

**Selección de transporte** (`adapter-selection.ts:43-59`, leído y verificado):

```
mode='mock'   → mock          mode='demo' → simulator      mode='manual' → manual (transport=null)
web           → web-serial
android       → spp-android   ← desde 2026-07-29
iOS y resto   → manual        ← piso manual, la app funciona igual
```

Nunca elige `hid-wedge`: está GATED (R8.7) por falta de hardware BLE-HID. Ese gate es el que el
emulador destraba.

### Matriz de transportes (de `context-multivendor.md`, ya investigada)

| transporte | Android | iOS | necesita key privada |
|---|---|---|---|
| **BLE-HID** (teclado) | ✅ | ✅ | **no** |
| **Classic SPP** | ✅ | ⚠️ solo con MFi | no en Android |
| **MFi / External Accessory** | — | ✅ | **sí** (protocol string del fabricante) |
| BLE GATT abierto | — | — | ningún bastón de ganado lo expone |

**Regla de Raf, textual**: *"Para todos los bastones tenemos q disponibilizar. Vamos con los q se
pueda de entrada sin necesitar keys privadas, BLE, spp classic, etc"*. O sea: SPP y BLE-HID sí, MFi
queda para cuando haya relación con el fabricante.

Consecuencia: **BLE-HID es el único camino de iOS sin key**, y su único blocker era hardware. Con el
ESP32 en `MODO_HID` ese blocker desaparece — **cualquier teclado Bluetooth sirve para el primer
smoke test del wedge**, no hace falta ni el ESP32.

### ADR-003 no prohíbe SPP

Se corrigió el título en esta sesión (`docs/adr/ADR-003-ble-nordic-uart.md`). Decía *"(NO Bluetooth
Classic SPP)"* a secas y se leía como prohibición general. Gobierna **nuestro hardware** (el bridge
de la balanza Vesta), donde elegimos el protocolo. No aplica a lectores de terceros ni al ESP32
emulando bastones. Si alguien cita ADR-003 para bloquear SPP, está leyendo el título viejo.

---

## 3. El agujero de la review del SPP (empezá por acá)

`dad711f` **no pasó review adversarial**. Se commiteó con typecheck + unit verde + verificación en
device del wiring, pero sin un reviewer mirando el camino completo. Es la deuda más cara que queda.

**Lo que ya verifiqué a mano — no lo repitas:**

- Los **tres bugs** que arreglé los confirmé contra el **código Java nativo de la librería**
  (`react-native-bluetooth-classic@1.73.0-rc.17`), no contra mi intuición:
  1. **framing invertido** — `LineFramer` aplicado sobre un payload que la librería ya entrega
     delimitado → **cero lecturas** aun con el bastón enchufado;
  2. **`pairDevice()` en cada connect** — promesa que nunca resuelve → estado clavado en `connecting`;
  3. **el device objetivo se anotaba solo al conectar bien** → la cadena de reintentos moría tras el
     primer fallo.
- La librería es un **NativeModule legacy**: cero JSI, cero TurboModule, cero C++. Corre en la new
  arch por `useTurboModuleInterop()` (`ReactNativeNewArchitectureFeatureFlagsDefaults.kt:35-36`).
  **No es un riesgo de arquitectura**, ya lo descarté.
- El permiso `ACCESS_FINE_LOCATION` que la librería declara **sin tope** lo capé a
  `maxSdkVersion=30` con `tools:node="replace"` en `app/plugins/with-bluetooth-classic.js`.
  Verificado en el APK con `aapt2 dump permissions`.
- Los tests del adapter pasaron de 8 → 36 inyectando la I/O por `SppEnv`.

**Lo que falta revisar** (para el reviewer, read-only): la máquina de estados completa de
`adapter-spp-android.ts` (21.5 KB) — corte + backoff + reconexión, dedup bajo tramas partidas,
comportamiento en foreground/background, y qué pasa si el device desaparece a mitad de un read.

---

## 4. El ESP32 — dos roles

Raf compró un ESP32 para la balanza. Ahora tiene **dos roles**, y los dos están documentados en
ADR-003:

**Rol 1 (original)**: bridge BLE de la balanza Vesta 3516. Lee RS-232 por UART2 y reenvía por BLE
Nordic UART. **El código fuente se perdió** (nunca se guardó como archivo), pero el binario está
respaldado y el comportamiento está descrito lo suficiente para reescribirlo:

```
firmware/backup/esp32-original-2026-07-29.bin   4 MB, imagen cruda desde 0x0
sha256  1eb442fb810c512f79e04c2a7cc98a61172efe3bac1a08327e14ca4cf7319892
restaurar:  python -m esptool --port COM7 write-flash 0x0 <ese archivo>
```

Detalles y evidencia de identificación: `firmware/backup/README.md`.

**Rol 2 (nuevo)**: **emulador de bastones**, para probar los transportes sin lector físico.
`firmware/baston-emulator/` — un solo `.ino` con tres modos por flag de compilación:

| modo | qué valida |
|---|---|
| `MODO_SPP` | `adapter-spp-android.ts` **completo** — replica al RS420 en Android. Nombre `RS420-EMU`, PIN `1234`, matchea a propósito el `namePattern` del driver. |
| `MODO_HID` | el camino **iOS sin MFi**. Destraba el gate R8.7 de `adapter-hid-wedge.ts`. |
| `MODO_GATT` | BLE Nordic UART, trama partida en trozos de 20 bytes → ejercita `LineFramer` de verdad. |

Lo que lo hace útil no es emitir la trama feliz: es **provocar los estados que rompen**. Hay un
protocolo de control por serial a 115200 (`drop`, `flap`, `split`, `double`, `bad <9 variantes>`,
`burst`, `mute`, `same`, `stx`, `term`, `chunk`, …) — la lista completa está en el README del
emulador. Los tres bugs de arriba eran todos de máquina de estados; un emulador los muestra en
segundos.

### La trama RS420 (capturada en campo, no inventada)

```
[0x02 STX] + "1000000" + <EID: 15 dígitos> + <YYMMDDHHMMSS> + \n   (a veces \r\n)

\x021000000982000364696050260530101701\r\n
```

Fuente: `specs/active/04-bluetooth-baston/field-findings.md`. El emulador arranca en los valores
exactos de esa captura, así que la primera trama post-boot es byte-por-byte comparable.
**22 ok / 0 fail** pasando tramas del emulador por el `parser-rs420.ts` real.

### Flashear (NO hecho todavía)

```bash
CLI="$HOME/AppData/Local/Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe"
cd firmware/baston-emulator
"$CLI" compile --config-file "$HOME/.arduinoIDE/arduino-cli.yaml" \
  --fqbn esp32:esp32:esp32:UploadSpeed=115200 \
  --build-property build.defines=-DEMU_MODE=MODO_SPP \
  --upload --port COM7 .
```

- **COM7** = `Silicon Labs CP210x`. Puede cambiar: `Get-PnpDevice | ? { $_.FriendlyName -match 'CP210' }`.
- **Solo 115200.** El volcado falló a 921600 y a 460800 (`Packet content transfer stopped`).
- Los 3 stacks **caben en un binario** (1.113.523 B = 84% de 1.310.720; medido, no estimado). Se
  entregan 3 builds igual por RAM, deinit y `findDriverForDevice`.
- El emulador **no debe advertir como `VESTA_BRIDGE`** (ADR-003) — para no confundirse con el bridge.

---

## 5. Herramientas operativas ya montadas

**`adb` es un canal completo de verificación en device.** Esto saca a Raf del camino crítico para los
veredictos: ya no hace falta que instale y reporte a mano.

```bash
adb install -r <apk>                      # reinstalar sobre la app existente
adb exec-out screencap -p > shot.png      # captura de pantalla
adb logcat -s ReactNativeJS:V             # logs de JS
adb shell am start -a android.intent.action.VIEW -d "rafq://baston"   # deep-link directo
```

Para pasarle un APK a Raf: servidor HTTP local en la LAN (lo bajó por WiFi desde el celu). **No subir
el APK a servicios externos** — es su app privada.

**iOS**: bloqueado hasta **2026-08-01**, cuando se libera la cuota de EAS. Nada de iOS está
verificado en device, ni siquiera lo que ya funciona en Android.

---

## 6. Trampas del entorno (todas cobradas ya)

| trampa | qué hacer |
|---|---|
| Escribir archivos con Python en modo texto convierte LF→CRLF y reescribe el archivo entero | comparar `git diff --stat` vs `--stat -w` **antes** de commitear |
| `strings` no existe en este Git Bash; el manifiesto del APK es XML binario UTF-16 | `aapt2 dump permissions`, nunca grep |
| `check.mjs` RC=0 **no incluye Playwright** | `pnpm e2e` aparte (~38 min); baseline actual: 22 rojos preexistentes + una clase de 9 ("tacto no renderiza") |
| correr la suite E2E re-renderiza 40+ `design/**/*.png` con diffs espurios | revertir `design/` antes de commitear; **nunca** `git add -A` |
| Cylance bloquea `pnpm dlx` y scripts desde el tool de PowerShell (exit 34) | usar el tool de Bash |
| `eas-cli build:view` rechaza `--non-interactive`; `build:list` lo acepta | probar la query **una vez** antes de armar un watcher, y emitir también en el path de fallo |
| `run-tests.mjs` usa una **lista explícita** de archivos, no un glob | un test nuevo no corre hasta que se agrega a esa lista |
| pnpm, no npm/yarn | `node-linker=hoisted` lo requiere Metro |

---

## 7. Decisiones abiertas para Raf

1. **Flashear el ESP32 sin él presente** — hoy es no. El firmware está commiteado y listo; falta su
   OK para escribirle encima al bridge de la balanza (el respaldo está hecho y verificado, así que el
   riesgo es bajo, pero es su hardware).
2. **Commitear sin OK intermedio** durante corridas largas — su preferencia declarada es commitear
   por unidad terminada; queda por confirmar si eso aplica también cuando él no está mirando.
3. **Las puertas humanas del SDD no se saltan** — eso no es negociable por CLAUDE.md, así que
   cualquier corrida larga se detiene ahí por diseño.

---

## 8. Lo que queda, priorizado

1. **Review adversarial del camino SPP** (§3) — read-only, `reviewer`. La deuda más cara.
2. **Flashear `MODO_SPP` + correr el banco** contra el APK ya instalado (§4, con Raf). Es lo que
   convierte "el bastón está cableado" en "el bastón lee".
3. **BLE-HID**: smoke test del wedge con cualquier teclado Bluetooth (no hace falta el ESP32) →
   destrabar R8.7 → implementar el adapter.
4. **Verificación iOS de todo** (desde 2026-08-01).
5. **6 sheets hechos a mano sin `BackHandler`** — `FindOrCreateOverlay` es un overlay 🔴 manga global.
6. **La clase "reserva por ausencia"**: el guard hay que escribirlo sobre las superficies que **no**
   tienen el mecanismo, no sobre las que lo usan mal. Esa fue la lección de la barrida de teclado:
   declaré una clase de bug cerrada con 23 superficies rotas porque enumeré la población equivocada.
7. Contraste de `$textFaint` (60 usos), guard de registro de tests, rot de la suite E2E.
8. **Rebrand** — camino crítico, bloquea invitaciones, deep links y stores.

---

## 9. Lecciones de esta sesión que conviene no re-aprender

- **Un guard se escribe sobre la ausencia del mecanismo, no sobre su mal uso.** Si enumerás solo las
  superficies que usan mal el mecanismo, lo nuevo nace roto y en silencio.
- **Los números que reporta un subagente son afirmaciones, no datos.** Tres veces pasé cifras sin
  verificar ("1008 líneas invisibles en 57 archivos" → eran 556 en 6; "CTA a 24dp" → eran 32).
  Preguntá la métrica y el método antes de repetir un número.
- **Un documento que se skimea por el título tiene que decir la verdad en el título** (el caso de
  ADR-003).
- **`typecheck` + `unit` verde no confirma wiring.** Buscá imports muertos y leé el archivo de
  integración; `noUnusedLocals` **no** está habilitado, así que el typecheck no los caza.
- **Verificar es read-only.** Correr suites y diagnosticar es tarea de `reviewer` o `Explore`; un
  `implementer` contamina la señal editando hasta que dé verde.
