# Cómo probar la puerta BLE de BUSCAR ANIMAL en web (con el bastón Allflex RS420)

> Guía para cuando tengas el bastón físico. Hoy (2026-06-13) el chunk "BLE global" de spec 09 está
> implementado y gateado, pero se validó con el **mock** (E2E `app/e2e/baston.spec.ts`, 4/4) + renders.
> Esta guía es para la prueba **manual con hardware real** vía Web Serial, que es el camino de dev/test
> en `pnpm web` (el adapter Android nativo `spp-android` y el iOS `hid-wedge` son otra etapa, gated).

## Qué vas a probar
Bastonear una caravana desde **cualquier pantalla** abre el overlay (bottom-sheet) con el EID leído arriba
y resuelve en uno de 3 modos:
- **Editar** — el animal ya existe en el campo activo → "Ver ficha".
- **Alta** — caravana nueva → "Dar de alta" (con el TAG precargado).
- **Transferir** — el animal está activo en otro campo tuyo → "Transferir a este campo" (online).

## Requisitos
- **Chrome o Edge de escritorio** (la Web Serial API NO existe en Firefox/Safari ni en mobile). Es solo
  para probar en `pnpm web`; en el celular real va el adapter nativo, no esto.
- El **Allflex RS420** emparejado con la PC. El RS420 es **Bluetooth Classic SPP** (no BLE) → al emparejarlo
  por el Bluetooth de Windows queda expuesto como un **puerto COM** (p. ej. `COM5`). Ese COM es el que abre
  Web Serial. (Alternativamente, conectado por USB si el modelo lo permite → también es un COM.)
  - Windows: Configuración → Bluetooth y dispositivos → emparejar el RS420 → anotá el COM que le asigna
    (Administrador de dispositivos → Puertos (COM y LPT)).

## Pasos
1. **Levantá la web**: en una terminal, `cd app` y `pnpm.cmd web` (o `pnpm web`). Abrí el `localhost:<port>`
   que imprime, en Chrome/Edge.
2. **Logueate** y entrá a un campo con al menos un rodeo (estado `active` + rodeo activo — si no, el listener
   no se arma a propósito: no hay sobre qué crear).
3. **Conectá el bastón**: andá a la tab **Animales**. En el header, arriba a la derecha, está el chip de
   estado del bastón (dice "Bastón" / "Bastón desconectado"). **Tocá el chip** → Chrome abre el diálogo de
   **puertos serie** → elegí el COM del RS420 → el chip pasa a "Bastón conectado" (verde).
   - Si no aparece el diálogo: el tap necesita ser un gesto tuyo (lo es); si igual falla, revisá que el COM
     exista y no esté tomado por otra app (cerrá cualquier software del fabricante que tenga el puerto).
4. **Bastoneá una caravana** (FDX-B, 15 dígitos, ISO 11784/11785). El overlay sube desde abajo con el EID
   formateado arriba ("Caravana leída · 982 …") y:
   - Si la caravana **existe** en el campo → card del animal + **"Ver ficha"**.
   - Si es **nueva** → "Animal nuevo" + **"Dar de alta"** (el alta arranca con el TAG ya cargado, no lo
     re-tipeás).
   - Si está en **otro campo tuyo** → "Está en otro campo [nombre]" + **"Transferir a este campo"** (necesita
     internet; sin red el botón queda deshabilitado con el aviso).
5. **Ritmo de manga (live-rescan)**: con el overlay abierto, bastoneá OTRA caravana distinta → el overlay se
   actualiza al animal nuevo sin que tengas que cerrar (escanear-escanear-escanear). La misma caravana dentro
   de ~3s se ignora (anti-doble-lectura).
6. **Anti-stacking**: si abrís el form de **alta** o la **ficha** (o "agregar evento") y bastoneás, NO se abre
   un overlay encima (el listener se suspende mientras hay un form abierto). Cerrás el form y el listener
   vuelve solo.

## Qué mirar (criterios de campo)
- El EID se lee y se confirma en pantalla en **<1s**, legible (es la confirmación de que leíste la caravana
  correcta — importa para la declaración SENASA).
- El CTA primario es **grande** y se llega con el pulgar (tercio inferior).
- Si el bastón se **desconecta**, la app y la **carga manual** (tab Animales, tipear el número) siguen
  funcionando — el bastón nunca bloquea nada (manual-first).
- Vibración/beep al leer (el beep se puede apagar; en web la vibración puede no estar disponible según el
  navegador).

## Harness de bajo nivel (opcional)
Si querés probar el **adapter** crudo (parsear el stream del RS420, ver EIDs sin la lógica de find-or-create),
está la pantalla de dev **`/baston-test`** (web-only, sin pasar por login). Sirve para validar que el RS420
habla con el `adapter-web-serial`; el flujo de producto (overlay + find-or-create) es el de arriba.

## Lo que NO prueba esta guía (gated por hardware/plataforma)
- **Android nativo** (`spp-android`): el bastón por Bluetooth Classic SPP en la app real necesita el **dev
  build de Android** (el teléfono que vas a comprar). Web Serial es solo para la PC.
- **iOS** (`hid-wedge`): el camino BLE-HID keyboard-wedge para iPhone sin MFi está GATED por validación física
  (ADR-024 §4).
- **Dedup de caravanas** (asignar caravana a animales sin TAG, masivo): es el **chunk siguiente** de spec 09,
  todavía no implementado.

## Si algo falla
- El overlay no aparece al bastonear pero el chip dice conectado → revisá que estés en estado `active` con
  rodeo (sin rodeo el listener está apagado a propósito), y que no tengas un form abierto (busyMode).
- "Transferir" deshabilitado → es online-only; revisá la conexión.
- El COM no abre → cerrá apps del fabricante que lo tengan tomado; reemparejá el RS420.
