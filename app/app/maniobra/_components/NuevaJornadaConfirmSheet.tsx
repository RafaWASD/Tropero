// app/maniobra/_components/NuevaJornadaConfirmSheet.tsx — BOTTOM SHEET de confirmación de "Nueva jornada"
// CUANDO YA HAY UNA JORNADA ABIERTA (spec 03 M4, R10.5/R10.6).
//
// Decisión de Raf: UNA SOLA jornada activa por dispositivo (R10.6). Si el operario toca "Nueva jornada"
// teniendo una abierta, NO se arranca a ciegas (eso dejaría dos sesiones activas o pisaría la abierta sin
// aviso): se le pregunta. El landing (`maniobra.tsx`) abre este sheet en vez de ir directo al wizard.
//
// Contexto arriba (decisión informada, Nielsen #1): "Tenés la jornada de [rodeo] abierta con N animales.
// Si empezás una nueva, esa queda cerrada." Tres acciones, una columna, targets manga ≥56:
//   1) EMPEZAR UNA NUEVA (primaria, verde botella $primary) → closeSession(openSessionId) (R10.7, cierra la
//      abierta) y, AL OK, navega al wizard (onStartNew). Si closeSession devuelve ok:false → NO navega: se
//      superficia un error accionable es-AR y se deja reintentar (FAIL-CLOSED — no empezamos una nueva
//      dejando la vieja "a medio cerrar"). Mismo espíritu que ExitJornadaSheet.handleTerminar.
//   2) RETOMAR LA ABIERTA (secundaria, outline) → onResume → va a la identificación de la sesión abierta
//      (no cierra nada). Es el camino esperado la mayoría de las veces (el operario olvidó que la tenía).
//   3) CANCELAR (terciario / texto) / tap en el scrim → cierra el sheet, no hace nada.
//
// NADA es ROJO: cerrar la abierta NO es destructivo (sus eventos ya están persistidos; solo pasa a
// status='closed', sigue disponible para resumen/auditoría — igual que ExitJornadaSheet). Rojo señalaría un
// peligro que no existe.
//
// PATRÓN del sheet (idiom LOCKEADO de ManeuverConfigSheet / ExitJornadaSheet / SavePresetSheet): backdrop
// $scrim tappable que descarta + sheet anclado abajo con grip + safe-area inferior.
//
// ⚠️ GUARD ANTI TAP-THROUGH (web táctil, regla del repo `reference_rn_web_pitfalls`): el scrim lleva el
// guard `readyToDismissRef` armado en el próximo frame (doble requestAnimationFrame + fallback
// setTimeout(0)), igual que los otros sheets — el `click` huérfano del open (touch→mouse emulado del tap que
// abrió el sheet, "Nueva jornada") NO debe auto-cerrarlo (~1ms). Un tap DELIBERADO posterior SÍ cierra.
//
// RECORTE DE DESCENDENTES (regla dura): título ("Empezar una jornada nueva" trae j/p/g) y todo Text con
// numberOfLines llevan lineHeight matching. Cero hardcode (ADR-023 §4): tokens; es-AR voseo. Targets ≥$touchMin.

import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, Text, View, YStack } from 'tamagui';

import { Button } from '@/components';
import { buttonA11y, labelA11y } from '@/utils/a11y';

export type NuevaJornadaConfirmSheetProps = {
  /** Nombre del rodeo de la jornada abierta (resuelto por el caller via RodeoContext). '' si no resuelve. */
  rodeoName: string;
  /** Cantidad de animales procesados en la jornada abierta (N) — contexto de la decisión. */
  animalCount: number;
  /**
   * Cerrar la jornada abierta (R10.7) y empezar una nueva. Devuelve true al OK (→ el caller navega al
   * wizard), false al fallo (→ NO se navega, se superficia el error y se deja reintentar — fail-closed). El
   * caller envuelve closeSession(openSessionId) seguido de la navegación al wizard. */
  onStartNew: () => Promise<boolean>;
  /** Retomar la jornada abierta (→ identificación con esa sesión). NO cierra nada. */
  onResume: () => void;
  /** Cerrar el sheet sin hacer nada (Cancelar / tap en el scrim). */
  onClose: () => void;
};

export function NuevaJornadaConfirmSheet({
  rodeoName,
  animalCount,
  onStartNew,
  onResume,
  onClose,
}: NuevaJornadaConfirmSheetProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, getTokenValue('$navBottomMin', 'size'));

  // ── GUARD del backdrop contra el "click huérfano" del tap que abrió el sheet (BUG web táctil) ──
  // Idéntico a ManeuverConfigSheet/ExitJornadaSheet/SavePresetSheet: el botón "Nueva jornada" abre el sheet
  // con un onPress; en web táctil el browser emula touch→mouse→click ~20ms después y ese click cae sobre el
  // scrim recién montado → lo cerraría a ~1ms. El scrim ignora presses hasta estar "listo para descartar"
  // (armado en el PRÓXIMO frame vía doble rAF). Para entonces el click huérfano del open ya pasó, pero un
  // tap DELIBERADO posterior del usuario SÍ cierra. Ref (no estado): el scrim lo lee sin re-render.
  const readyToDismissRef = useRef(false);
  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      readyToDismissRef.current = true;
    };
    if (typeof requestAnimationFrame === 'function') {
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(arm);
      });
    } else {
      timer = setTimeout(arm, 0);
    }
    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      if (timer) clearTimeout(timer);
    };
  }, []);

  const onBackdropPress = () => {
    if (!readyToDismissRef.current) return;
    onClose();
  };

  // ¿Cerrando la abierta en vuelo? (deshabilita el botón para no disparar dos closeSession).
  const [starting, setStarting] = useState(false);
  // Error de cierre (fail-closed): closeSession devolvió ok:false → NO se navega, se superficia + reintenta.
  const [error, setError] = useState<string | null>(null);

  const handleStartNew = async () => {
    if (starting) return;
    setStarting(true);
    setError(null);
    const ok = await onStartNew();
    setStarting(false);
    // ok:true → el caller ya navegó al wizard (este sheet se desmonta). Si false: fail-closed.
    if (!ok) {
      setError(
        'No se pudo cerrar la jornada abierta. Tocá de nuevo para reintentar; si sigue fallando, revisá la conexión con la app.',
      );
    }
  };

  // Contexto "con N animales" — pluralización es-AR (1 → "animal").
  const animalsWord = animalCount === 1 ? 'animal' : 'animales';

  return (
    // Backdrop $scrim que cubre la pantalla + sheet anclado abajo. El backdrop cierra (= cancelar).
    <View
      position="absolute"
      top="$0"
      left="$0"
      right="$0"
      bottom="$0"
      backgroundColor="$scrim"
      justifyContent="flex-end"
    >
      <Pressable
        style={{ flex: 1, width: '100%' }}
        onPress={onBackdropPress}
        testID="nueva-jornada-scrim"
        {...buttonA11y(Platform.OS, { label: 'Cancelar' })}
      />

      <YStack
        width="100%"
        backgroundColor="$bg"
        borderTopLeftRadius="$card"
        borderTopRightRadius="$card"
        paddingHorizontal="$4"
        paddingTop="$4"
        paddingBottom={bottomPad}
        gap="$4"
        testID="nueva-jornada-sheet"
      >
        {/* Grip visual del sheet. */}
        <View
          alignSelf="center"
          width={getTokenValue('$icon', 'size')}
          height={getTokenValue('$progressTrack', 'size')}
          borderRadius="$pill"
          backgroundColor="$divider"
        />

        {/* CONTEXTO arriba: qué pasa si empieza una nueva (decisión informada, Nielsen #1). */}
        <YStack gap="$2">
          <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" numberOfLines={2}>
            Ya tenés una jornada abierta
          </Text>
          <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="500" color="$textMuted" numberOfLines={3}>
            {rodeoName ? (
              <>
                Tenés la jornada de <Text fontWeight="700" color="$textPrimary">{rodeoName}</Text> abierta con{' '}
                <Text fontWeight="700" color="$textPrimary">{animalCount}</Text> {animalsWord}. Si empezás una nueva, esa queda cerrada.
              </>
            ) : (
              <>
                Tenés una jornada abierta con <Text fontWeight="700" color="$textPrimary">{animalCount}</Text> {animalsWord}. Si empezás una nueva, esa queda cerrada.
              </>
            )}
          </Text>
        </YStack>

        {/* ERROR de cierre (fail-closed): closeSession falló → NO se navegó. Accionable es-AR + reintentar.
            Terracota (color de aviso del DS, no hay token de error). Recorte de descendentes: lineHeight. */}
        {error ? (
          <View
            testID="nueva-jornada-error"
            backgroundColor="$surface"
            borderWidth={1}
            borderColor="$terracota"
            borderRadius="$card"
            paddingHorizontal="$4"
            paddingVertical="$3"
            {...labelA11y(Platform.OS, error)}
          >
            <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="700" color="$terracota" numberOfLines={3}>
              {error}
            </Text>
          </View>
        ) : null}

        {/* ACCIONES — una columna, NADA rojo. Primaria verde / outline secundaria / texto terciario. */}
        <YStack gap="$3">
          <Button
            variant="primary"
            fullWidth
            disabled={starting}
            onPress={() => void handleStartNew()}
          >
            {starting ? 'Cerrando la abierta…' : 'Empezar una nueva'}
          </Button>
          <Button variant="secondary" fullWidth onPress={onResume}>
            Retomar la abierta
          </Button>
          {/* Terciario (texto): cancelar. Target ≥touchMin (guante, Fitts). */}
          <View
            testID="nueva-jornada-cancelar"
            minHeight="$touchMin"
            alignItems="center"
            justifyContent="center"
            pressStyle={{ opacity: 0.6 }}
            onPress={onClose}
            {...buttonA11y(Platform.OS, { label: 'Cancelar' })}
          >
            <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textMuted" numberOfLines={1}>
              Cancelar
            </Text>
          </View>
        </YStack>
      </YStack>
    </View>
  );
}
