// useHardwareBack — intercepta el BOTÓN ATRÁS DE HARDWARE (Android) mientras la pantalla está ENFOCADA.
//
// POR QUÉ (spec 03, flujo de MODO MANIOBRAS): sin esto, el back físico hace `pop` de la ruta sin pasar por
// ninguna guarda — destruye la config del wizard, saltea el `ExitJornadaSheet` de la jornada activa o
// abandona un animal con eventos ya persistidos. El handler que se pasa acá tiene que hacer lo MISMO que el
// chevron ‹ de la pantalla (ver `utils/maniobra-back.ts` para las decisiones puras).
//
// ── DOS INVARIANTES QUE SOSTIENEN EL DISEÑO (no tocar sin entenderlas) ───────────────────────────────
// 1. **SIEMPRE CONSUME** el evento (`return true`). El objetivo del hook es que el back NUNCA popee la ruta
//    por atrás de una guarda; si algún día hace falta dejarlo pasar, es una decisión explícita, no un
//    default silencioso.
// 2. **REGISTRO ESTABLE** (una vez por foco, `useCallback(..., [])`) + el handler vivo en un REF. Es una de
//    las dos condiciones de la PRECEDENCIA con los sheets (ver abajo): si el registro se rehiciera en cada
//    cambio de estado (deps no estables), la pantalla pasaría a registrarse ÚLTIMA y se comería el back del
//    sheet, que es justo lo que no queremos.
//
// `useFocusEffect` (no `useEffect`) porque las pantallas del stack quedan MONTADAS al navegar: sin acotar
// al foco, dos pantallas del flujo tendrían su listener vivo a la vez.
//
// ── PRECEDENCIA: LEÍDO EN LA FUENTE DE RN DE ESTE REPO, NO ASUMIDO ──────────────────────────────────
// `node_modules/react-native/Libraries/Utilities/BackHandler.android.js`: los handlers viven en un array al
// que `addEventListener` hace `push`, y el dispatcher itera `for (i = length - 1; i >= 0; i--)` devolviendo
// en el PRIMERO que retorna truthy. O sea: último registrado = primero en correr, y el que devuelve `true`
// corta la cadena (incluida la del navigation container, que es la que popearía la ruta). Por eso el
// listener del sheet (montado DESPUÉS que el de la pantalla) gana.
// Esto es lectura de código, no ejecución: la cadena real corriendo es **veredicto de device Android**.
//
// ── LA CONDICIÓN REAL SON DOS COSAS, NO UNA (no alcanza con el registro estable) ─────────────────────
// El sheet gana mientras: (i) el registro de la pantalla sea ESTABLE entre re-renders (invariante 2), **y**
// (ii) la pantalla NO se RE-ENFOQUE con un sheet ya montado. `useFocusEffect` de expo-router re-ejecuta su
// callback en CADA evento de `focus` (`node_modules/expo-router/build/useFocusEffect.js`), así que un
// re-foco RE-SUSCRIBE a la pantalla y la manda al FINAL del array → le roba la precedencia al sheet.
// Hoy (ii) es inalcanzable: la única pantalla con este hook que hospeda sheets del shell es el wizard de
// jornada, y ninguno de sus sheets navega a otra ruta. Pero alcanza **un solo `router.push` agregado
// adentro de cualquiera de ellos** para volverlo alcanzable, y el síntoma sería un BACK MUERTO invisible
// para web, E2E y unit. Por eso la decisión de la pantalla (`utils/maniobra-back.ts`) no da la precedencia
// por garantizada: cierra como último recurso los sheets que puede cerrar sin perder datos y AVISA en dev
// del único que no puede (el preconfig, cuyo cierre arrastra el flush del texto tipeado).
//
// ── PLATAFORMAS ──────────────────────────────────────────────────────────────────────────────────────
// El registro se gatea a Android con `shouldRegisterHardwareBack` (predicado PURO, testeado en Node —
// mismo patrón que `utils/a11y.ts`): es la única plataforma con botón atrás de hardware. En iOS no existe
// (el dismiss interactivo lo cubre `gestureEnabled:false` en el layout del stack) y en web tampoco.
//
// ALCANCE HONESTO DE LA VERIFICACIÓN (ADR-029): `BackHandler` no emite en web, así que la E2E **no puede
// ejercitar el back de hardware** — su comportamiento real es veredicto de device Android. Lo testeado en
// Node es la decisión pura (`utils/maniobra-back.test.ts`) y este gate de plataforma.
// *Nota de precisión (medida, no supuesta)*: react-native-web TRAE un stub de `BackHandler` cuyo
// `addEventListener` loguea un `console.error` (leído en `node_modules/react-native-web/dist/exports/
// BackHandler/index.js`), lo que en DEV montaría el LogBox y taparía la pantalla. PERO en el export web de
// este repo ese error **no se observa**: se probó sacando el gate y sondeando la consola con Playwright, y
// el `console.error` del stub nunca aparece (el probe sí) → en este build `BackHandler` no resuelve a ese
// stub. Así que el gate es CONTRATO DE PLATAFORMA (no registrar un listener que nunca puede disparar), no
// el arreglo de un bug de web observado.

import { useCallback, useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { shouldRegisterHardwareBack } from '../utils/maniobra-back';

export function useHardwareBack(onBack: () => void): void {
  // Ref al handler VIVO: el efecto de registro no puede depender de `onBack` (ver invariante 2).
  const handlerRef = useRef(onBack);
  useEffect(() => {
    handlerRef.current = onBack;
  });

  useFocusEffect(
    useCallback(() => {
      if (!shouldRegisterHardwareBack(Platform.OS)) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        handlerRef.current();
        return true;
      });
      return () => sub.remove();
    }, []),
  );
}
