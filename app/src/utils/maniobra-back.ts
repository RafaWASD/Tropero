// maniobra-back.ts — DECISIÓN PURA del BOTÓN ATRÁS DE HARDWARE (Android) en las 3 pantallas del flujo de
// MODO MANIOBRAS: el wizard de jornada, la identificación y la carga rápida.
//
// ── POR QUÉ EXISTE ────────────────────────────────────────────────────────────────────────────────────
// Hasta ahora la app NO interceptaba el back físico en ningún lado: hacía `pop` de la ruta sin pasar por
// ninguna guarda. En Android eso es grave porque no es un gesto que se descubre por accidente — es EL botón
// que el operario usa todo el tiempo:
//   · wizard (etapa 2/3) → el pop DESTRUÍA la configuración entera en vez de retroceder una etapa
//     (el chevron ‹ sí retrocede);
//   · identificación → el pop SALTEABA el `ExitJornadaSheet` (cierre guardado de la jornada, R10.7) con la
//     jornada ACTIVA;
//   · carga rápida → el pop abandonaba el animal SIN pasar por el `SkipAnimalSheet`, dejando las filas de
//     evento ya persistidas (R5.8, per-step) sin descartar.
// Regla: **el back de hardware hace EXACTAMENTE lo que el chevron ‹ de esa pantalla** (o, donde no hay
// chevron, lo que su salida guardada), nunca menos. Nunca puede saltear una confirmación.
//
// ── POR QUÉ ES UNA FUNCIÓN PURA ──────────────────────────────────────────────────────────────────────
// `BackHandler` no existe de verdad en react-native-web (react-native-web trae un stub que nunca emite) →
// el comportamiento real es **veredicto de device Android** (ADR-029) y la E2E no puede ejercitarlo. Lo que
// sí se puede blindar con tests es la PRECEDENCIA: qué gana sobre qué cuando hay un sheet abierto. Eso vive
// acá y se testea en Node.
//
// ── PRECEDENCIA CON LOS SHEETS, Y POR QUÉ NO SE DA POR GARANTIZADA ───────────────────────────────────
// Los sheets montados sobre `BottomSheetShell` registran su PROPIO handler de back (que llama a su
// `onClose`, así el flush del texto tipeado del preconfig sigue valiendo). `BackHandler` de RN corre los
// handlers en orden INVERSO de registro y frena en el primero que devuelve `true` → el del sheet (montado
// después que el de la pantalla) gana.
//
// Eso vale mientras se cumplan DOS condiciones, no una:
//   (i)  el registro de la pantalla es ESTABLE entre re-renders (de eso se ocupa `useHardwareBack` con su
//        `useCallback([])` + el handler en un ref), y
//   (ii) la pantalla NO se RE-ENFOCA con un sheet ya montado. `useFocusEffect` de expo-router re-ejecuta
//        su callback en CADA evento de `focus` (`node_modules/expo-router/build/useFocusEffect.js`), así
//        que un re-foco re-suscribe a la pantalla y la manda al FINAL del array → le roba la precedencia
//        al sheet. Hoy es inalcanzable (ninguno de los sheets del wizard navega a otra ruta), pero un solo
//        `router.push` agregado adentro de uno de ellos lo vuelve alcanzable.
// Por eso la decisión NO asume la precedencia: distingue el sheet que la pantalla NO puede cerrar (el
// preconfig, cuyo cierre arrastra el flush) de los que SÍ, y para el primero el caller avisa en dev en
// vez de quedarse mudo (un back muerto es invisible para web, E2E y unit).
//
// Los sheets SIN shell (confirmaciones propias de estas pantallas) no tienen handler propio → los cierra la
// decisión de la pantalla, siempre llamando al cierre que YA existe (el mismo del scrim / "Cancelar").

/**
 * ¿Corresponde registrar el listener de back de hardware en esta plataforma?
 *
 * Solo **Android** tiene botón atrás de hardware. En iOS no existe (el dismiss interactivo lo cubre
 * `gestureEnabled:false` en el layout del stack) y en web tampoco: `BackHandler` nunca emite. Registrar un
 * listener que no puede disparar es ruido, y el stub de `BackHandler` de react-native-web llega a loguear
 * un `console.error` en `addEventListener` (que en DEV monta el LogBox y tapa la pantalla — misma clase de
 * bug que documenta `utils/a11y.ts`). Predicado PURO para que el gate sea testeable en Node, igual que las
 * decisiones por plataforma de `a11y.ts`.
 */
export function shouldRegisterHardwareBack(platform: string): boolean {
  return platform === 'android';
}

/** Acción del back de hardware en el wizard de jornada (`app/maniobra/jornada.tsx`). */
export type JornadaBackAction =
  /**
   * `ManeuverConfigSheet` montado: la pantalla NO lo cierra. Su cierre arrastra el flush del texto tipeado
   * (As-built v8) y desde acá no hay forma de ejecutarlo → cerrarlo perdería datos. Lo cierra SU handler.
   * Si aun así se llega acá, la precedencia falló: el caller lo AVISA en dev (no se queda mudo).
   */
  | 'defer-to-preconfig-sheet'
  /**
   * `SavePresetSheet` / `CustomFieldSheet` montados: también tienen su handler (y normalmente ganan), pero
   * su cierre es un reset de estado sin nada que perder → la pantalla puede cerrarlos como ÚLTIMO RECURSO.
   * En el camino feliz esta rama no se ejecuta; existe para que un desliz de precedencia degrade en un
   * cierre correcto en vez de en un botón muerto.
   */
  | 'close-shell-sheet'
  /** `TactoConfigSheet` abierto (sin shell) → cerrarlo, igual que su scrim/"Cancelar". */
  | 'close-tacto-config'
  /** Nada abierto → lo mismo que el chevron ‹: retroceder de etapa (o salir del wizard en la etapa 1). */
  | 'screen-back';

export type JornadaBackState = {
  /**
   * ¿`ManeuverConfigSheet` **MONTADO**? Ojo: montado, no "la bandera está prendida". El render está
   * gateado por `configManeuver && FREE_TEXT_PRECONFIG[configManeuver]`, así que la bandera y la guarda de
   * render tienen que salir del MISMO booleano — si divergen, el back defiere a un sheet que no está en
   * pantalla y queda muerto.
   */
  preconfigSheetOpen: boolean;
  /**
   * ¿`SavePresetSheet` o `CustomFieldSheet` **MONTADOS**? Mismo cuidado: el custom se renderiza bajo
   * `isOwner && customSheetOpen`, no bajo `customSheetOpen` a secas.
   */
  otherShellSheetOpen: boolean;
  /** ¿`TactoConfigSheet` abierto? (sin shell). */
  tactoConfigOpen: boolean;
};

export function jornadaBackAction(state: JornadaBackState): JornadaBackAction {
  if (state.preconfigSheetOpen) return 'defer-to-preconfig-sheet';
  if (state.otherShellSheetOpen) return 'close-shell-sheet';
  if (state.tactoConfigOpen) return 'close-tacto-config';
  return 'screen-back';
}

/** Acción del back de hardware en la identificación (`app/maniobra/identificar.tsx`). */
export type IdentifyBackAction =
  /** `SugerenciaVaciasSheet` abierto → su propio cierre (saltear la sugerencia y salir del flujo). */
  | 'close-sugerencia'
  /** `ExitJornadaSheet` abierto → cerrarlo (seguir en la jornada). */
  | 'close-exit'
  /** `CandidatePicker` (R4.2) u `OtherRodeoSheet` (R4.4) abiertos → volver a escuchar (su escape). */
  | 'back-to-listening'
  /** Nada abierto → lo mismo que el chevron ‹: abrir el `ExitJornadaSheet` (cierre guardado, R10.7). */
  | 'open-exit';

export type IdentifyBackState = {
  sugerenciaOpen: boolean;
  exitOpen: boolean;
  /** `OtherRodeoSheet` montado (R4.4). */
  otherRodeoOpen: boolean;
  /** `CandidatePicker` montado = outcome ambiguo (R4.2). */
  ambiguousOpen: boolean;
};

export function identifyBackAction(state: IdentifyBackState): IdentifyBackAction {
  // Orden = orden de apilado real: la sugerencia se abre DESDE el exit sheet (que se cierra al abrirla),
  // y los sheets de identidad (R4.2/R4.4) viven por debajo de una salida de jornada.
  if (state.sugerenciaOpen) return 'close-sugerencia';
  if (state.exitOpen) return 'close-exit';
  if (state.otherRodeoOpen || state.ambiguousOpen) return 'back-to-listening';
  return 'open-exit';
}

/** Acción del back de hardware en la carga rápida (`app/maniobra/carga.tsx`). */
export type CargaBackAction =
  /** `SkipAnimalSheet` abierto → cerrarlo (seguir con el animal). */
  | 'close-skip-sheet'
  /** `LotePickerSheet` abierto → cerrarlo (el lote es opcional, R9.1/R9.3). */
  | 'close-lote-sheet'
  /**
   * Nada abierto → la SALIDA GUARDADA del frame: el `SkipAnimalSheet` (R5.15). Esta pantalla NO tiene
   * chevron ‹ a propósito; abandonar el animal pasa por esa confirmación, que además DESCARTA las filas
   * de evento ya persistidas. Un pop pelado las dejaría huérfanas — es justo lo que hay que evitar.
   */
  | 'open-skip-sheet';

export type CargaBackState = {
  skipSheetOpen: boolean;
  loteSheetOpen: boolean;
};

export function cargaBackAction(state: CargaBackState): CargaBackAction {
  if (state.skipSheetOpen) return 'close-skip-sheet';
  if (state.loteSheetOpen) return 'close-lote-sheet';
  return 'open-skip-sheet';
}
