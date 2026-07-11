// app/maniobra/_components/ExitJornadaSheet.tsx — BOTTOM SHEET de SALIDA de la jornada (spec 03 M2.1,
// surfacing de R10.7 closeSession + salir reanudable R10.5/R10.6).
//
// El botón ‹ del header de sesión (SpikeSessionHeader) abre ESTE sheet en vez de navegar para atrás
// directo: el operario no está "yendo atrás", está CERRANDO una jornada que SIEMPRE hay que cerrar en
// algún momento — el sheet es el lugar del cierre (decisión de Raf). Contexto arriba ("Llevás N animales
// hoy") para una decisión INFORMADA (Nielsen #1: visibilidad del estado del sistema). Tres acciones, una
// columna, targets manga ≥56:
//   1) TERMINAR JORNADA (primaria, verde botella $primary) → closeSession(sessionId) (R10.7, UPDATE
//      offline). Al OK → paso de CONFIRMACIÓN dentro del sheet ("Jornada terminada · Procesaste N
//      animales", un único "Listo") → navegar FUERA del flujo de maniobra (onExit). Si closeSession
//      devuelve ok:false → NO se navega: se superficia un error accionable es-AR y se deja reintentar
//      (fail-closed, mismo espíritu que ManeuverErrorBanner de carga.tsx).
//   2) SALIR SIN TERMINAR (secundaria, outline) → navega FUERA SIN cerrar la sesión (queda activa y
//      REANUDABLE, R10.5/R10.6) (onExit).
//   3) SEGUIR EN LA JORNADA (terciario / cancelar) → cierra el sheet, no hace nada. También se cierra
//      tocando el scrim.
//
// NADA es ROJO: no hay acción destructiva. Los eventos ya están guardados; terminar solo marca la jornada
// cerrada; salir la deja reanudable. Rojo señalaría un peligro que no existe (decidido con Raf). Verde
// primaria / outline secundaria / texto terciario.
//
// PATRÓN del sheet (idiom lockeado de ManeuverConfigSheet / OtherRodeoSheet): backdrop $scrim tappable que
// descarta + sheet anclado abajo con grip + safe-area inferior.
//
// ⚠️ GUARD ANTI TAP-THROUGH (web táctil, regla del repo `reference_rn_web_pitfalls`): el scrim lleva el
// guard `readyToDismissRef` armado en el próximo frame (doble requestAnimationFrame + fallback
// setTimeout(0)), igual que ManeuverConfigSheet — el `click` huérfano del open (touch→mouse emulado del
// tap que abrió el sheet) NO debe cerrarlo al instante. Un tap DELIBERADO posterior SÍ cierra.
//
// RECORTE DE DESCENDENTES (regla dura): título ("Terminar la jornada"/"Jornada terminada" traen j) y todo
// Text con numberOfLines llevan lineHeight matching. Cero hardcode (ADR-023 §4): tokens; lucide vía
// getTokenValue. es-AR voseo.

import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, Text, View, YStack } from 'tamagui';
import { Check } from 'lucide-react-native';

import { Button } from '@/components';
import { buttonA11y, labelA11y } from '@/utils/a11y';

export type ExitJornadaSheetProps = {
  /** Cantidad de animales procesados hoy (N) — contexto arriba + cierre de confirmación. */
  animalCount: number;
  /**
   * Terminar la jornada (R10.7): cierra la sesión. Devuelve true al OK (→ paso de confirmación), false al
   * fallo (→ NO se navega, se superficia el error y se deja reintentar — fail-closed). El caller envuelve
   * closeSession(sessionId). */
  onTerminar: () => Promise<boolean>;
  /** Navegar FUERA del flujo de maniobra (terminar tras confirmar / salir sin terminar). */
  onExit: () => void;
  /** Cerrar el sheet sin hacer nada (seguir en la jornada / tap en el scrim). */
  onClose: () => void;
  /**
   * Delta lotes-venta (RLV.10/RLV.10.2): cantidad de VACÍAS de la sesión (tacto 'empty'). Si > 0, la fase
   * 'terminated' ofrece agregarlas a un lote (sugerencia saltable) en vez de solo "Listo". Default 0 (sin
   * sugerencia). El caller lo calcula con fetchSessionEmptyFemales solo si la jornada incluyó tacto (RLV.15).
   */
  emptyCount?: number;
  /** Delta lotes-venta (RLV.10): el usuario acepta la sugerencia → abrir el picker de lote (SugerenciaVaciasSheet). */
  onElegirLote?: () => void;
};

type Phase = 'actions' | 'terminated';

export function ExitJornadaSheet({
  animalCount,
  onTerminar,
  onExit,
  onClose,
  emptyCount = 0,
  onElegirLote,
}: ExitJornadaSheetProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, getTokenValue('$navBottomMin', 'size'));

  // ── GUARD del backdrop contra el "click huérfano" del tap que abrió el sheet (BUG web táctil) ──
  // Idéntico al de ManeuverConfigSheet: el ‹ abre el sheet con un onPress de Tamagui; en web táctil el
  // browser emula touch→mouse→click ~20ms después y ese click cae sobre el scrim recién montado (un
  // Pressable con onPress=onClose que cubre la pantalla) → lo cerraría a ~1ms. El scrim ignora presses
  // hasta estar "listo para descartar" (armado en el PRÓXIMO frame vía doble requestAnimationFrame). Para
  // entonces el click huérfano del open ya pasó, pero un tap DELIBERADO posterior del usuario SÍ cierra.
  // Ref (no estado): el scrim lo lee en el onPress sin re-render. Fallback setTimeout(0) sin DOM.
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

  // Fase del sheet: las 3 acciones, o el cierre de confirmación tras terminar.
  const [phase, setPhase] = useState<Phase>('actions');
  // ¿Terminar en vuelo? (deshabilita el botón para no disparar dos closeSession).
  const [terminating, setTerminating] = useState(false);
  // Error de cierre (fail-closed): closeSession devolvió ok:false → NO se navega, se superficia + reintenta.
  const [error, setError] = useState<string | null>(null);

  // Tap en el scrim: en 'actions' = seguir en la jornada (cierra el sheet); en 'terminated' la jornada YA
  // está cerrada → quedarse en la identificación no tiene sentido → navegar fuera (igual que "Listo"). El
  // guard tap-through cubre el click huérfano del open en ambas fases.
  const onBackdropPress = () => {
    if (!readyToDismissRef.current) return;
    if (phase === 'terminated') onExit();
    else onClose();
  };

  const handleTerminar = async () => {
    if (terminating) return;
    setTerminating(true);
    setError(null);
    const ok = await onTerminar();
    setTerminating(false);
    if (ok) {
      setPhase('terminated');
      return;
    }
    // Fail-closed: el cierre no se pudo guardar → no navegamos, dejamos reintentar (R10.7 / espíritu R10.8).
    setError('No se pudo terminar la jornada. Tocá de nuevo para reintentar; si sigue fallando, revisá la conexión con la app.');
  };

  // Contexto "Llevás N animales hoy" — pluralización es-AR (1 → "animal").
  const animalsWord = animalCount === 1 ? 'animal' : 'animales';

  return (
    // Backdrop $scrim que cubre la pantalla + sheet anclado abajo. El backdrop cierra (= seguir en la jornada).
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
        testID="exit-jornada-scrim"
        {...buttonA11y(Platform.OS, { label: 'Seguir en la jornada' })}
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
        testID="exit-jornada-sheet"
      >
        {/* Grip visual del sheet. */}
        <View
          alignSelf="center"
          width={getTokenValue('$icon', 'size')}
          height={getTokenValue('$progressTrack', 'size')}
          borderRadius="$pill"
          backgroundColor="$divider"
        />

        {phase === 'actions' ? (
          <>
            {/* CONTEXTO arriba: qué está por cerrar (decisión informada, Nielsen #1). */}
            <YStack gap="$2">
              <Text fontFamily="$heading" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary" numberOfLines={1}>
                Terminar la jornada
              </Text>
              <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="500" color="$textMuted" numberOfLines={2}>
                Llevás <Text fontWeight="700" color="$textPrimary">{animalCount}</Text> {animalsWord} hoy.
              </Text>
            </YStack>

            {/* ERROR de cierre (fail-closed): closeSession falló → NO se navegó. Accionable es-AR + reintentar.
                Terracota (color de aviso del DS, no hay token de error). Recorte de descendentes: lineHeight. */}
            {error ? (
              <View
                testID="exit-jornada-error"
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
                disabled={terminating}
                onPress={() => void handleTerminar()}
              >
                {terminating ? 'Terminando…' : 'Terminar jornada'}
              </Button>
              <Button variant="secondary" fullWidth onPress={onExit}>
                Salir sin terminar
              </Button>
              {/* Terciario (texto): seguir en la jornada. Target ≥touchMin (guante, Fitts). */}
              <View
                testID="exit-jornada-seguir"
                minHeight="$touchMin"
                alignItems="center"
                justifyContent="center"
                pressStyle={{ opacity: 0.6 }}
                onPress={onClose}
                {...buttonA11y(Platform.OS, { label: 'Seguir en la jornada' })}
              >
                <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textMuted" numberOfLines={1}>
                  Seguir en la jornada
                </Text>
              </View>
            </YStack>
          </>
        ) : (
          // ── CIERRE CLARO tras terminar: "Jornada terminada · Procesaste N animales" + un único "Listo". ──
          <>
            <YStack alignItems="center" gap="$3" paddingTop="$2">
              <View
                width={getTokenValue('$icon', 'size')}
                height={getTokenValue('$icon', 'size')}
                borderRadius="$pill"
                backgroundColor="$greenLight"
                alignItems="center"
                justifyContent="center"
                {...labelA11y(Platform.OS, 'Jornada terminada')}
              >
                <Check size={getTokenValue('$heroIcon', 'size') * 0.5} color={getTokenValue('$primary', 'color')} strokeWidth={3} />
              </View>
              <YStack alignItems="center" gap="$2">
                <Text fontFamily="$heading" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary" textAlign="center" numberOfLines={1}>
                  Jornada terminada
                </Text>
                <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="500" color="$textMuted" textAlign="center" numberOfLines={2}>
                  Procesaste <Text fontWeight="700" color="$textPrimary">{animalCount}</Text> {animalsWord}.
                </Text>
              </YStack>
            </YStack>

            {/* Delta lotes-venta (RLV.10/RLV.11): si la jornada dejó ≥1 vacía, sugerencia SALTABLE de agregarlas
                a un lote. "Elegir lote" abre el picker (onElegirLote); "Ahora no" sale del flujo (onExit). Sin
                vacías → solo "Listo". */}
            {emptyCount > 0 && onElegirLote ? (
              <YStack gap="$3" testID="sugerencia-vacias">
                <YStack
                  width="100%"
                  backgroundColor="$surface"
                  borderWidth={1}
                  borderColor="$divider"
                  borderRadius="$card"
                  paddingHorizontal="$4"
                  paddingVertical="$3"
                  gap="$1"
                >
                  <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="700" color="$textPrimary" numberOfLines={2}>
                    Encontramos <Text color="$primary">{emptyCount}</Text> {emptyCount === 1 ? 'vaca vacía' : 'vacías'}
                  </Text>
                  <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="500" color="$textMuted" numberOfLines={2}>
                    ¿Las agregás a un lote para venderlas o descartarlas después?
                  </Text>
                </YStack>
                <Button variant="primary" fullWidth onPress={onElegirLote}>
                  Elegir lote
                </Button>
                <View
                  testID="sugerencia-vacias-ahora-no"
                  minHeight="$touchMin"
                  alignItems="center"
                  justifyContent="center"
                  pressStyle={{ opacity: 0.6 }}
                  onPress={onExit}
                  {...buttonA11y(Platform.OS, { label: 'Ahora no' })}
                >
                  <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textMuted" numberOfLines={1}>
                    Ahora no
                  </Text>
                </View>
              </YStack>
            ) : (
              <Button variant="primary" fullWidth onPress={onExit}>
                Listo
              </Button>
            )}
          </>
        )}
      </YStack>
    </View>
  );
}
