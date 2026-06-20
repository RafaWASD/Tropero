// app/maniobra/_components/ConfirmDeleteSheet.tsx — DIÁLOGO de confirmación de BORRADO (spec 03 M7).
//
// Primitivo COMPARTIDO por M7-A (borrar rutina, R2.9) y M7-B (borrar dato custom, R13.31). Confirmación
// EXPLÍCITA sin "Deshacer" diferido (decisión #2 de Raf: el snackbar-undo expira sin verse en la manga; el
// diálogo es más seguro contra borrados accidentales). Puede mostrar la ADVERTENCIA del borrado (las líneas
// `impact`) — para el custom bajo Opción B (R13.30 MVP): "sus N cargas previas dejarán de verse + se quita de
// M rodeos". Para la rutina no hay impacto. Cierra con "Esta acción no se puede deshacer." (común a todos).
//
// FAIL-CLOSED: si onConfirm devuelve un mensaje de error es-AR (≠ null), NO se cierra el sheet — se
// superficia el error y se deja reintentar (mismo espíritu que ExitJornadaSheet / SavePresetSheet).
//
// NADA es ROJO destructivo agresivo: el CTA de confirmar es terracota (color de aviso del DS, no hay token
// de error) — comunica "ojo, esto borra" sin un rojo de pánico que no existe en la paleta. Cancelar es
// secundario (outline). Una columna, targets manga ≥$touchMin.
//
// PATRÓN del sheet (idiom LOCKEADO de ManeuverConfigSheet / ExitJornadaSheet / SavePresetSheet): backdrop
// $scrim tappable que descarta (= cancelar) + sheet anclado abajo con grip + safe-area inferior.
//
// ⚠️ GUARD ANTI TAP-THROUGH (web táctil, `reference_rn_web_pitfalls`): el scrim lleva el guard
// `readyToDismissRef` armado en el próximo frame (doble requestAnimationFrame + fallback setTimeout(0)) —
// el `click` huérfano del open (touch→mouse emulado del tap que abrió el sheet) NO debe auto-cerrarlo. Un
// tap DELIBERADO posterior SÍ cierra.
//
// RECORTE DE DESCENDENTES (regla dura): título + Text con numberOfLines llevan lineHeight matching. Cero
// hardcode (ADR-023 §4): tokens. es-AR voseo.

import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, Text, View, YStack } from 'tamagui';
import { AlertTriangle } from 'lucide-react-native';

import { Button } from '@/components';
import { buttonA11y, labelA11y } from '@/utils/a11y';

export type ConfirmDeleteSheetProps = {
  /** Título del diálogo (es-AR). Ej.: "¿Eliminar la rutina Tacto de otoño?". */
  title: string;
  /**
   * Líneas de ADVERTENCIA/cuerpo del borrado (es-AR), opcionales. Cada string es una línea. Para el custom bajo
   * Opción B: ["Sus 12 cargas previas dejarán de verse y no vas a poder recuperarlas desde la app.", "Se quita
   * de 3 rodeos donde está habilitado."]. Para la rutina puede ir vacío (solo el título). Se renderizan en
   * terracota (aviso destructivo). Recortan descendentes (lineHeight). El cierre "Esta acción no se puede
   * deshacer." lo agrega el sheet siempre (no va acá).
   */
  impact?: string[];
  /** Texto del CTA de confirmar (default "Eliminar"). */
  confirmLabel?: string;
  /**
   * Ejecuta el borrado. Devuelve null al OK (→ el caller cierra el sheet) o un mensaje es-AR al fallo (→ NO
   * se cierra, se superficia + reintenta — fail-closed). */
  onConfirm: () => Promise<string | null>;
  /** Cerrar sin borrar (Cancelar / tap en el scrim). */
  onClose: () => void;
  /** testID base del sheet (para el e2e). Ej. 'delete-preset' → 'delete-preset-sheet'/'-scrim'/'-confirm'. */
  testID: string;
};

export function ConfirmDeleteSheet({
  title,
  impact = [],
  confirmLabel = 'Eliminar',
  onConfirm,
  onClose,
  testID,
}: ConfirmDeleteSheetProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, getTokenValue('$navBottomMin', 'size'));

  // ── GUARD del backdrop contra el "click huérfano" del tap que abrió el sheet (BUG web táctil) ──
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

  // ¿Confirmar en vuelo? (deshabilita el botón para no disparar dos borrados).
  const [deleting, setDeleting] = useState(false);
  // Error (fail-closed): onConfirm devolvió un mensaje → NO se cierra, se superficia + reintenta.
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    const err = await onConfirm();
    setDeleting(false);
    if (err == null) {
      // OK: el caller cierra el sheet (y refresca la lista). No cerramos acá para que el caller controle.
      return;
    }
    setError(err);
  };

  const TERRACOTA = getTokenValue('$terracota', 'color');

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
        testID={`${testID}-scrim`}
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
        testID={`${testID}-sheet`}
      >
        {/* Grip visual del sheet. */}
        <View
          alignSelf="center"
          width={getTokenValue('$icon', 'size')}
          height={getTokenValue('$progressTrack', 'size')}
          borderRadius="$pill"
          backgroundColor="$divider"
        />

        {/* Encabezado: ícono de aviso + título. lineHeight matching (los títulos traen g/j/p). */}
        <YStack gap="$3">
          <View
            width={48}
            height={48}
            borderRadius="$pill"
            backgroundColor="$surface"
            borderWidth={2}
            borderColor="$terracota"
            alignItems="center"
            justifyContent="center"
          >
            <AlertTriangle size={getTokenValue('$icon', 'size') * 0.55} color={TERRACOTA} />
          </View>
          <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" numberOfLines={3}>
            {title}
          </Text>

          {/* ADVERTENCIA/IMPACTO del borrado (es-AR) + "Esta acción no se puede deshacer" siempre al final.
              El cuerpo de la advertencia va en $terracota (aviso destructivo, jerarquía clara) cuando hay
              líneas de impacto; el cierre "no se puede deshacer" queda en terracota bold (sin un rojo de pánico
              inexistente en la paleta). Para el borrado de RUTINA (impact vacío) solo queda el cierre. */}
          <YStack gap="$2">
            {impact.map((line, i) => (
              <Text key={i} fontFamily="$body" fontSize="$5" lineHeight="$6" fontWeight="600" color="$terracota" numberOfLines={4}>
                {line}
              </Text>
            ))}
            <Text fontFamily="$body" fontSize="$4" lineHeight="$5" fontWeight="700" color="$terracota" numberOfLines={1}>
              Esta acción no se puede deshacer.
            </Text>
          </YStack>
        </YStack>

        {/* ERROR (fail-closed): el borrado no se pudo encolar → no cerramos, dejamos reintentar. Terracota. */}
        {error ? (
          <View
            testID={`${testID}-error`}
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

        {/* ACCIONES — una columna. Confirmar = terracota (aviso, no rojo de pánico); Cancelar = outline. */}
        <YStack gap="$2">
          <Pressable
            onPress={deleting ? undefined : () => void handleConfirm()}
            testID={`${testID}-confirm`}
            {...buttonA11y(Platform.OS, { label: confirmLabel, disabled: deleting })}
          >
            <View
              backgroundColor="$terracota"
              borderRadius="$pill"
              minHeight="$touchMin"
              alignItems="center"
              justifyContent="center"
              opacity={deleting ? 0.5 : 1}
              pressStyle={{ opacity: 0.85 }}
            >
              <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$white" numberOfLines={1}>
                {deleting ? 'Eliminando…' : confirmLabel}
              </Text>
            </View>
          </Pressable>
          <Button variant="secondary" fullWidth disabled={deleting} onPress={onClose}>
            Cancelar
          </Button>
        </YStack>
      </YStack>
    </View>
  );
}
