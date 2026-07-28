// useDismissKeyboardOnOpen — ABRIR UN SHEET BAJA EL TECLADO.
//
// ── EL BUG 🔴 QUE CIERRA (Raf, device Android, APK a3b8d804 / commit 56beff3) ────────────────────────
// En `maniobra/identificar`, con el input de caravana ENFOCADO y el teclado ABIERTO, tocar la ‹ del
// header —que abre el `ExitJornadaSheet` para terminar o abandonar la jornada— dejaba el teclado arriba
// y del sheet solo asomaba una franja de ~25px por encima de él: los dos botones ("Terminar jornada" /
// "Salir sin terminar") quedaban TAPADOS. Un diálogo de decisión inoperable, en un flujo 🔴 de manga.
//
// ── LA CONDUCTA, Y POR QUÉ ES LA CORRECTA (razón de producto, no un parche) ──────────────────────────
// Abrir un sheet es SALIR DEL CONTEXTO DE ESCRITURA: el input que sostenía el teclado queda detrás de un
// scrim, inalcanzable, y no hay ningún motivo para que su teclado sobreviva a la transición. Es lo que
// hacen las dos plataformas (ley de Jakob) y lo que Raf esperaba textualmente ("el teclado no se
// cierra"). El razonamiento largo, con el contrato de la transición, vive en la decisión PURA
// `shouldDismissKeyboardOnOpen` (`utils/sheet-shell.ts`), que es la que está testeada.
//
// ── POR QUÉ NO ALCANZABA CON ARREGLAR EL LIFT ────────────────────────────────────────────────────────
// `KeyboardAvoidingShell` sube las superficies por encima del teclado, pero tiene un límite declarado en
// su header: si MONTA con el teclado ya abierto arranca en 0 hasta el próximo evento de insets (ni el
// `KeyboardAnimationManager` de Android ni el `keyboardWillChangeFrame` de iOS le reproducen el estado
// actual a un listener nuevo). Y —más de fondo— el `ExitJornadaSheet` del reporte **no monta el shell**:
// no tiene ningún campo de texto, así que el guard del teclado no se lo exige y nunca lo tuvo. Para él
// el lift no existe. Bajar el teclado lo arregla sin agregarle un mecanismo que no necesita, y de paso
// vuelve inalcanzable-por-esta-vía el límite del montaje para TODOS los sheets.
//
// ── DÓNDE VA (y por qué no en un solo shell) ─────────────────────────────────────────────────────────
// El invariante es de la CLASE "overlay modal con scrim", que en este repo NO tiene un primitivo único:
// hay 4 sheets sobre `BottomSheetShell` y ~21 hechos a mano (algunos con `KeyboardAvoidingShell`, otros
// sin nada). Ponerlo en `BottomSheetShell` cubriría 4; ponerlo en `KeyboardAvoidingShell` cubriría otros
// pocos y además alcanzaría a las PANTALLAS, que no son overlays. Así que vive acá, en un hook que
// llaman `BottomSheetShell` y cada sheet a mano, y lo sostiene el guard estático
// `components/sheet-keyboard-dismiss-guard.test.ts`: todo archivo que dibuje un scrim tiene que llamarlo
// (o montar `BottomSheetShell`, que ya lo llama).
//
// ── ⚠️ NADA DE WORKLETS ACÁ ──────────────────────────────────────────────────────────────────────────
// Esto es un efecto de MONTAJE en el hilo de JS. `Keyboard.dismiss()` se llama directo, nunca desde un
// worklet ni vía `runOnJS(Keyboard.dismiss)`: ese patrón CRASHEÓ la app en device (SIGABRT sin redbox —
// el serializador convierte la instancia de clase `KeyboardImpl` en un Proxy que tira al primer acceso, y
// en release no hay `callGuard`). Ver el bloque `dismissKeyboard` de `BottomSheetShell.tsx` y el guard
// `components/worklet-callbacks-guard.test.ts`.
//
// ── QUÉ HACE EN CADA PLATAFORMA ──────────────────────────────────────────────────────────────────────
//   · Android / iOS → `Keyboard.dismiss()` blurea el input enfocado y baja el IME. Es el fix.
//   · WEB           → react-native-web implementa `Keyboard.dismiss()` como
//     `TextInputState.blurTextInput(currentlyFocusedField())`: no hay teclado virtual que bajar, pero SÍ
//     blurea el `<input>` del DOM que estuviera enfocado. Es coherente (el input quedó detrás del scrim) y
//     es la única parte de esta conducta que la E2E puede ver; el veredicto del bug en sí es DEVICE.

import { useEffect, useRef } from 'react';
import { Keyboard } from 'react-native';

import { shouldDismissKeyboardOnOpen } from '../utils/sheet-shell';

/**
 * Baja el teclado cuando el sheet PASA a estar abierto.
 *
 * @param open ¿El sheet está a la vista? Default `true` — el caso de los sheets que se MONTAN al abrirse
 *   (el consumidor los renderiza condicionalmente). Los que viven siempre montados detrás de una prop
 *   (`LotePickerSheet`, `MarkDeclaredSheet`, `SugerenciaVaciasSheet`) tienen que pasar **su** `open`: si
 *   no, el flanco sería el del montaje de la PANTALLA y el sheet nunca bajaría el teclado al abrirse.
 *
 * Dispara SOLO en el flanco cerrado→abierto (ver `shouldDismissKeyboardOnOpen`). Nunca mientras el sheet
 * ya está abierto: si no, un sheet con input propio cerraría su propio teclado en cada tecla.
 */
export function useDismissKeyboardOnOpen(open: boolean = true): void {
  // El estado del render anterior vive en un ref, no en estado: no queremos re-renders y el efecto ya
  // corre solo cuando `open` cambia.
  const wasOpenRef = useRef(false);

  useEffect(() => {
    const dismiss = shouldDismissKeyboardOnOpen({ wasOpen: wasOpenRef.current, isOpen: open });
    wasOpenRef.current = open;
    if (dismiss) Keyboard.dismiss();
  }, [open]);
}
