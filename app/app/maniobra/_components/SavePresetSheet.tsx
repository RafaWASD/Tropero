// app/maniobra/_components/SavePresetSheet.tsx — BOTTOM SHEET de "Guardar como rutina" (spec 03 R2.1).
//
// Cierra el gap de R2.1: el servicio `createPreset` (maneuver-presets.ts) y el listado de presets del
// landing (maniobra.tsx "Tus rutinas" + loadPreset) ya existían, pero NO había forma de CREAR un preset
// desde la UI → "Tus rutinas" quedaba siempre vacío y el empty-state del landing prometía "guardala como
// rutina" sin esa acción. Este sheet la cablea desde la etapa 3 del wizard (jornada.tsx): toma la config
// ACTUAL de la jornada (las maniobras en su orden + la preconfig) + un nombre y crea el preset.
//
// GUARDAR ES INDEPENDIENTE DE ARRANCAR (decisión de diseño): podés guardar la rutina sin arrancar la
// jornada, o arrancar sin guardar. No se acoplan (no un checkbox "guardar al arrancar"). Por eso es una
// acción secundaria propia, no parte del CTA primario.
//
// NOMBRE: input grande (manga-friendly, $searchBarLg ≥56) + "Guardar" deshabilitado si el nombre es
// vacío/whitespace (el CHECK `maneuver_presets_name_not_empty` de 0051 lo exige; lo re-trimea createPreset).
// `maxLength` 60 (MAX_PRESET_NAME_LEN): tope sano para un nombre de rutina (no hay constante previa en el
// repo; un nombre de jornada es corto, "Tacto de otoño" ~14 chars → 60 sobra). El DB no tiene cap de
// longitud sobre `name` (solo no-vacío), así que el tope es de cliente — UX, no seguridad.
//
// FAIL-CLOSED: si createPreset devuelve ok:false, NO se cierra el sheet ni se pierde lo tipeado — se
// superficia un error accionable es-AR y se deja reintentar (mismo espíritu que ExitJornadaSheet).
//
// PATRÓN del sheet (idiom LOCKEADO de ManeuverConfigSheet / ExitJornadaSheet): backdrop $scrim tappable que
// descarta + sheet anclado abajo con grip + safe-area inferior.
//
// ⚠️ GUARD ANTI TAP-THROUGH (web táctil, regla del repo `reference_rn_web_pitfalls`): el scrim lleva el
// guard `readyToDismissRef` armado en el próximo frame (doble requestAnimationFrame + fallback
// setTimeout(0)), igual que ManeuverConfigSheet/ExitJornadaSheet — el `click` huérfano del open (touch→mouse
// emulado del tap que abrió el sheet) NO debe auto-cerrarlo (~1ms). Un tap DELIBERADO posterior SÍ cierra.
//
// RECORTE DE DESCENDENTES (regla dura): el título ("Guardar como rutina" trae g/p/j) y todo Text con
// numberOfLines llevan lineHeight matching. Cero hardcode (ADR-023 §4): tokens; lucide vía getTokenValue.
// es-AR voseo. Targets manga ≥$touchMin.

import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, Text, View, YStack } from 'tamagui';

import { Button } from '@/components';
import { buttonA11y, labelA11y } from '@/utils/a11y';

/** Tope de longitud del nombre de la rutina (cliente/UX; el DB solo exige no-vacío). */
export const MAX_PRESET_NAME_LEN = 60;

export type SavePresetSheetProps = {
  /**
   * Guardar la rutina con el nombre tipeado. Devuelve `null` al OK (→ feedback "Rutina guardada" + cierra)
   * o un mensaje de error es-AR al fallo (→ NO se cierra, se superficia + reintenta — fail-closed). El
   * caller envuelve createPreset({ establishmentId, name, config }) con la config ACTUAL de la jornada. */
  onSave: (name: string) => Promise<string | null>;
  /** Cerrar el sheet sin guardar (Cancelar / tap en el scrim). */
  onClose: () => void;
};

export function SavePresetSheet({ onSave, onClose }: SavePresetSheetProps) {
  const insets = useSafeAreaInsets();

  // ── GUARD del backdrop contra el "click huérfano" del tap que abrió el sheet (BUG web táctil) ──
  // Idéntico a ManeuverConfigSheet/ExitJornadaSheet: el botón "Guardar como rutina" abre el sheet con un
  // onPress; en web táctil el browser emula touch→mouse→click ~20ms después y ese click cae sobre el scrim
  // recién montado (un Pressable con onPress=onClose que cubre la pantalla) → lo cerraría a ~1ms. El scrim
  // ignora presses hasta estar "listo para descartar" (armado en el PRÓXIMO frame vía doble rAF). Para
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

  const onBackdropPress = () => {
    if (!readyToDismissRef.current) return;
    onClose();
  };

  const [name, setName] = useState('');
  // ¿Guardar en vuelo? Deshabilita el botón para no disparar dos createPreset.
  const [saving, setSaving] = useState(false);
  // Error (fail-closed): createPreset devolvió ok:false → NO se cierra, se superficia + reintenta, sin
  // perder lo tipeado (el `name` queda en el input).
  const [error, setError] = useState<string | null>(null);

  // "Guardar" deshabilitado si el nombre es vacío/whitespace (el CHECK no-vacío lo exige) o si está en vuelo.
  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const err = await onSave(trimmed);
    setSaving(false);
    if (err == null) {
      // OK: el caller ya mostró el feedback "Rutina guardada" y cierra el sheet.
      return;
    }
    // Fail-closed: la rutina no se pudo guardar → no cerramos, dejamos reintentar sin perder lo tipeado.
    setError(err);
  };

  const placeholderColor = getTokenValue('$textMuted', 'color');
  const textColor = getTokenValue('$textPrimary', 'color');
  const borderColor = getTokenValue('$divider', 'color');
  const surfaceColor = getTokenValue('$white', 'color');
  const inputFontSize = getTokenValue('$inputText', 'size');
  // Input GRANDE (manga-friendly): mismo pill XL ≥56 del buscador de manga / ManeuverConfigSheet.
  const inputMinHeight = getTokenValue('$searchBarLg', 'size');
  const radius = getTokenValue('$card', 'radius');
  const padH = getTokenValue('$4', 'space');
  const bottomPad = Math.max(insets.bottom, getTokenValue('$navBottomMin', 'size'));

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
        testID="save-preset-scrim"
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
        testID="save-preset-sheet"
      >
        {/* Grip visual del sheet. */}
        <View
          alignSelf="center"
          width={getTokenValue('$icon', 'size')}
          height={getTokenValue('$progressTrack', 'size')}
          borderRadius="$pill"
          backgroundColor="$divider"
        />

        {/* Título + ayuda. lineHeight matching ("Guardar como rutina" trae g/p). */}
        <YStack gap="$1">
          <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" numberOfLines={1}>
            Guardar como rutina
          </Text>
          <Text fontFamily="$body" fontSize="$3" lineHeight="$3" color="$textMuted" numberOfLines={2}>
            Guardás esta combinación de maniobras para reusarla en otra jornada.
          </Text>
        </YStack>

        {/* ERROR (fail-closed): createPreset falló → NO se cerró. Accionable es-AR + reintentar, sin perder
            lo tipeado. Terracota (color de aviso del DS). Recorte de descendentes: lineHeight. */}
        {error ? (
          <View
            testID="save-preset-error"
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

        {/* INPUT GRANDE del nombre. */}
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Ej.: Tacto de otoño"
          placeholderTextColor={placeholderColor}
          autoCapitalize="sentences"
          autoFocus
          maxLength={MAX_PRESET_NAME_LEN}
          returnKeyType="done"
          onSubmitEditing={() => void handleSave()}
          testID="save-preset-input"
          style={{
            minHeight: inputMinHeight,
            borderRadius: radius,
            borderWidth: 1,
            borderColor,
            backgroundColor: surfaceColor,
            paddingHorizontal: padH,
            fontSize: inputFontSize,
            fontFamily: 'Inter',
            color: textColor,
          }}
          {...labelA11y(Platform.OS, 'Nombre de la rutina')}
        />

        {/* Acciones: Guardar (primary, deshabilitado si vacío/whitespace) / Cancelar (secondary). */}
        <YStack gap="$2">
          <Button variant="primary" fullWidth disabled={!canSave} onPress={() => void handleSave()}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
          <Button variant="secondary" fullWidth onPress={onClose}>
            Cancelar
          </Button>
        </YStack>
      </YStack>
    </View>
  );
}
