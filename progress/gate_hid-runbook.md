# Runbook del gate físico del HID (F0 / RBM8) — para correr con Raf

**Qué decide**: si el camino iOS-sin-MFi (`adapter-hid-wedge`) se implementa o se cierra. Está gateado desde
que se escribió ADR-024 §4 porque *"el Council fue enfático: no fijar arquitectura sobre un mecanismo no
ejecutado en hardware real"*. Hoy se puede correr con hardware propio.

**Qué NO decide**: que exista un bastón comercial con modo HID. El Gallagher HR0 sigue sin confirmar del
fabricante. Este gate mide **el lado del teléfono**. Dos incógnitas distintas.

**Costo**: 0 builds de EAS. ~20 minutos.

---

## Lo que hace falta

| | |
|---|---|
| iPhone | con la build de **TestFlight del 2026-08-11** (`testflight-dev`, commit `0273c43`). ⚠️ **Confirmar antes de medir**: el oráculo depende de las props de ese campo |
| ESP32 | flasheado en **`MODO_HID`** → se anuncia como teclado BLE con el nombre **`EMU-HID-380`** |
| PC | para mandarle comandos al ESP32 por COM7 |

**El flasheo ya está hecho (2026-08-16): el ESP32 de COM7 está en `MODO_HID` y listo.** Volver al banco
de SPP es el mismo comando con `MODO_SPP` (firmware respaldado en `firmware/backup/`).

> ⚠️ **Contexto que cambia cómo se lee un fallo.** `MODO_HID` **nunca se había ejecutado**: se había
> entregado verificando que *compilaba*. Se le encontraron **tres** bugs, uno por cada vez que se lo hizo
> correr un paso más lejos:
>
> 1. **Boot loop** (`LoadProhibited` inicializando el BLE HID) — jamás había anunciado nada.
>    `progress/impl_emulador-hid-crash.md`.
> 2. **Se quedaba invisible después de la primera desconexión** — si en (d) el iPhone corta el link al
>    mandar la app a background, habría fabricado un *"iOS no reconecta"* que era nuestro. Mismo informe.
> 3. **No emparejaba: el emulador nunca arrancaba la seguridad**, así que el host se conectaba, enumeraba
>    y **no recibía una sola tecla**, sin bond y sin ningún error a la vista.
>    `progress/impl_emulador-hid-bonding.md`.
>
> **Los tres están arreglados y medidos en hardware.** Hoy el banco **empareja de verdad y tipea**: se
> verificó contra Windows de punta a punta — bond con Secure Connections (`auth_mode=0x09`), driver HOGP
> cargado (*Dispositivo de teclado HID*), **el bond sobrevive al reboot del ESP32 y a un ciclo de la radio
> Bluetooth**, y los 15 dígitos + Enter/Tab aparecen escritos en una ventana de texto real. Lo que queda
> gated es **iOS**, no el emulador.
>
> Al terminar de medir se **desemparejó de Windows y se borró el bond del ESP32** para que no le robe la
> conexión al iPhone. Verificado al cerrar: `bonds=0`, Windows `paired=False`, y anunciándose.

> 🔎 **Lo primero que hay que mirar si el iPhone no tipea.** El `status` ahora trae una segunda línea en
> `MODO_HID` que separa las tres causas que antes se veían iguales:
>
> ```
> [emu] cifrado=SI cccd=suscripto auth_mode=0x9 bonds=1
> ```
>
> - `cifrado=no` → **no hubo emparejamiento**: el iPhone se conectó pero no pareó. No es la app.
> - `cifrado=NO (el pairing falló)` → hubo intento y falló; la línea `HID: el emparejamiento … FALLÓ`
>   dice el motivo con nombre (`SMP_PAIR_AUTH_FAIL` = iOS rechazó nuestros requisitos → tocar
>   `EMU_HID_AUTH`; `SMP_CONN_TOUT` = se cortó el link a mitad).
> - `cccd=apagado` con `cifrado=SI` → emparejó pero **no hay teclado del otro lado** (iOS no suscribió el
>   input report).
> - `bonds=0` después de emparejar → el bond no se guardó.
> - Todo en verde y el `TextInput` vacío → **ahí sí** el problema es de iOS o de la app, que es lo que el
>   gate quiere decidir.
>
> Y si el emulador **no** manda nada, lo dice: `HID: el host NO suscribió el input report`. Antes contaba
> `lecturas=1` igual — así fue como una medición anterior pareció "el emulador mandó y el iPhone no
> mostró" cuando en realidad no había salido nada del ESP32.

## Paso 0 — Emparejar (esto sí es tuyo)

Ajustes → Bluetooth en el iPhone → emparejar **`EMU-HID-380`**. Desde ese momento el iPhone lo trata como
un teclado físico.

**Cómo se sabe que emparejó de verdad** (y no que sólo se conectó, que es lo que pasaba antes):

1. Por el serie tiene que salir `HID: EMPAREJADO con <MAC del iPhone> — link CIFRADO (auth_mode=0x09
   bond=SI …)`. Si dice `bond=NO`, conectó pero no va a sobrevivir a nada.
2. `status` → `cifrado=SI cccd=suscripto bonds=1`.
3. El chequeo de Raf, que es el que descubrió el bug: **apagar y prender el Bluetooth del iPhone**. Si el
   device vuelve a *"Otros dispositivos"*, o si iOS no ofrece *"Olvidar este dispositivo"*, **no hay
   bond** y no tiene sentido seguir con (a)…(d) — parar y anotar.

Antes de arrancar, `bonds` tiene que dar **0**. Si hay uno viejo, `unbond` (y borrarlo también del lado
del iPhone: si el host se queda con su mitad, reconecta en loop con una clave que acá ya no existe).

## Paso 1 — Llegar al campo

App → **Modo maniobra** → *"¿Sin chip? Ingresá la caravana"* → aparece el input
(placeholder **"Número o caravana visual"**).

## Las cuatro mediciones

Yo mando los comandos por serie y vos mirás la pantalla. **Anotá lo que ves, no lo que esperás.**

### (a) ¿Tipea los 15 dígitos completos?
`hiddelay 12` (default, como un wedge real) → `read 1`. Repetir con `hiddelay 5` y `hiddelay 40`.
**Comparar carácter por carácter** contra el EID que imprime `status`. Un dígito perdido con delay bajo es
un resultado, no un error de medición.

### (b) ¿Emite terminador?
`hidterm enter` → ¿dispara la búsqueda sola? Después `hidterm tab` y `hidterm none`.
Se observa porque **busca** (o no). Esto le dice al adapter qué terminador soportar.

### (c) ¿La supresión del teclado en pantalla rompe la UX de manga?
Con el teclado BT emparejado, iOS **no** muestra el teclado en pantalla. Abrir el campo y **sacar captura**.
Mirar: ¿queda barra de sugerencias?, ¿queda un hueco muerto?, ¿el CTA sigue alcanzable con una mano?
**Impresión sin captura no cuenta.**

### (d) ¿Captura confiable con foco programático?
`read 20 1500` → 20 lecturas seguidas. En el medio: **mandar la app a background y volver**, y **rotar**.
Exigir **20/20 completas**, sin caracteres perdidos ni intercalados.

### Extra (no decide el gate)
`hidraw on` → ¿puede tipear la trama completa con el `STX`? Un teclado no puede tipear no-imprimibles, así
que lo más probable es que no. Informa si algún wedge podría entregar trama en vez de EID limpio.

---

## Los tres desenlaces — y por qué importa no mezclarlos

1. **Verde en (a)(b)(c)(d)** → se implementa el adapter (F7), con el terminador y los tiempos que el gate
   validó.
2. **Falla (c) o (d) por comportamiento de iOS** → el camino HID **se cierra con evidencia**. `adapter-hid-wedge.ts`
   queda como placeholder gateado y su binding en `available:false`. F7 **no se ejecuta**.
3. **Falla por una prop del `TextInput` de producción** → **desenlace distinto**. La consecuencia es ajustar
   el campo de scan (o darle uno dedicado al wedge) y **re-correr**, no cerrar el camino.

> Las props que forman parte del oráculo, anotadas **antes** de medir para poder atribuir un fallo:
> `maxLength = SEARCH_TERM_MAX_LENGTH`, `autoCapitalize="characters"`, `autoCorrect={false}`,
> `returnKeyType="search"`, `onSubmitEditing` → búsqueda, y **sin `keyboardType` explícito**.
> Sin esta lista, un fallo no se puede atribuir y se cierra por error una puerta que estaba abierta.

## Comandos del emulador que se usan

`status` / `st` (modo, nombre, EID, `lecturas=` que cuenta **lo que salió de verdad**, y la línea de
seguridad `cifrado=` / `cccd=` / `auth_mode=` / `bonds=`) · `selftest` · `read [n] [ms]` · `burst [n]` ·
`hidterm enter|tab|none` · `hiddelay <ms>` · `hidraw on|off` · **`bonds`** (lista los emparejamientos
guardados: es el oráculo de que el bond persiste) · **`unbond`** (los borra, para arrancar de cero).

⚠️ **Los comandos se mandan con `bench/run-bench.py`**, que abre el puerto con `dtr=False; rts=False`. Abrir
el COM a mano **resetea el ESP32** y devuelve un estado falso — ya pasó una vez y fabricó una conclusión
equivocada.

## Dónde queda el resultado

`progress/` con las capturas, los logs del emulador y los conteos. **Primera línea**: qué NO prueba el gate.
