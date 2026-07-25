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
// ── SHELL: `BottomSheetShell` (primitivo del repo) ────────────────────────────────────────────────────
// El esqueleto (backdrop $scrim tappable con el GUARD anti tap-through de web táctil —doble rAF, regla
// `reference_rn_web_pitfalls`—, header fijo / body scroll / footer fijo, safe-area) vive en el primitivo.
// Este sheet es el caso más expuesto al BUG 🔴 del teclado: `autoFocus` abre el teclado AL MONTAR, así que
// sin keyboard-avoidance el input y el CTA nacían tapados. El primitivo lo sube por encima del teclado y
// condensa (suelta la descripción y el "Cancelar"; la X del header queda como salida).
//
// RECORTE DE DESCENDENTES (regla dura): el título ("Guardar como rutina" trae g/p/j) lo maneja el shell con
// lineHeight matching; todo Text con numberOfLines de acá también. Cero hardcode (ADR-023 §4): tokens;
// lo que cruza a APIs no-Tamagui vía getTokenValue. es-AR voseo. Targets manga ≥$touchMin.

import { useState } from 'react';
import { Platform, TextInput } from 'react-native';
import { getTokenValue, Text, View } from 'tamagui';

import { BottomSheetShell, Button } from '@/components';
import { labelA11y } from '@/utils/a11y';

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
  /**
   * Valor inicial del nombre (spec 03 M7, R2.7 — RENOMBRAR precarga el nombre actual de la rutina). Default
   * '' (crear una rutina nueva = el flujo original de R2.1). */
  initialName?: string;
  /** Título del sheet. Default "Guardar como rutina" (crear). Renombrar pasa "Renombrar la rutina". */
  title?: string;
  /** Sub-línea de ayuda. Default la de crear. */
  description?: string;
  /** Label del CTA primario. Default "Guardar". */
  ctaLabel?: string;
};

export function SavePresetSheet({
  onSave,
  onClose,
  initialName = '',
  title = 'Guardar como rutina',
  description = 'Guardás esta combinación de maniobras para reusarla en otra jornada.',
  ctaLabel = 'Guardar',
}: SavePresetSheetProps) {
  const [name, setName] = useState(initialName);
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

  return (
    <BottomSheetShell
      title={title}
      description={description}
      onClose={onClose}
      testID="save-preset-sheet"
      scrimTestID="save-preset-scrim"
      scrimA11yLabel="Cancelar"
      footer={
        <Button variant="primary" fullWidth disabled={!canSave} onPress={() => void handleSave()}>
          {saving ? 'Guardando…' : ctaLabel}
        </Button>
      }
      secondaryFooter={
        <Button variant="secondary" fullWidth onPress={onClose}>
          Cancelar
        </Button>
      }
    >
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
        // UN solo valor a cargar → Enter GUARDA y baja el teclado (blurAndSubmit, default de un input de
        // una línea). No es el caso multi-carga del sheet de vacunas.
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
    </BottomSheetShell>
  );
}
