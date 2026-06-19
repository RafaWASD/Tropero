// app/maniobra/_components/ManeuverConfigSheet.tsx — BOTTOM SHEET de preconfig de tanda de una maniobra
// (spec 03 M1.4, etapa 2; R1.7 preconfig de tanda + R1.8 autocompletar de valores usados antes).
//
// ITERACIÓN UX 3 (Raf, 2026-06-14): el preconfig de tanda dejó de vivir en la sección huérfana del
// fondo de la etapa 2 ("Detalle de la tanda" con un input suelto) y pasó a INLINE en la fila de la
// maniobra + ESTE sheet enfocado. Al tocar el cuerpo de una maniobra CONFIGURABLE (vacunación /
// inseminación) se abre este sheet: una decisión por pantalla, input GRANDE (manga-friendly) +
// autocompletar de valores usados antes.
//
// MULTI vs ÚNICO:
//   - VACUNACIÓN: se pueden cargar VARIAS vacunas (texto libre). Cada una se agrega como un chip; el
//     valor persiste como las vacunas separadas por coma (round-trip con maneuverDetail, que ya muestra
//     un string tal cual). El input + "Agregar" suma una vacuna; tocar la × de un chip la quita.
//   - INSEMINACIÓN: UNA pajuela (texto libre). El input ES el valor; "Guardar" lo persiste.
//
// AUTOCOMPLETAR (R1.8): chips de sugerencias = valores históricos del campo (sembrados de los presets,
// DM1-UI-1) que matchean el prefijo tipeado, vía el helper PURO `filterAutocomplete`. Para vacunación
// se excluyen las que ya están agregadas (no re-sugerir lo puesto).
//
// Modelado sobre el patrón as-built de bottom-sheet (BulkConfirmSheet): backdrop $scrim tappable que
// cierra + YStack anclado abajo con grip + safe-area inferior respetada. Cero hardcode (ADR-023 §4):
// tokens; lo que cruza a APIs no-Tamagui (lucide) vía getTokenValue. Targets manga ≥$touchMin.
//
// RECORTE DE DESCENDENTES (memoria, regla dura): los títulos ("Vacunación"/"Inseminación" traen g/j) y
// todo Text con numberOfLines llevan lineHeight matching.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { Plus, X } from 'lucide-react-native';

import { Button } from '@/components';
import { buttonA11y, labelA11y } from '@/utils/a11y';
import { filterAutocomplete, joinMultiPreconfig, splitMultiPreconfig } from '@/utils/maneuver-wizard';

// Forma del preconfig de UNA maniobra configurable. `multi` = vacunación (varias vacunas, persiste
// como coma-separado); `single` = inseminación (una pajuela). El título/placeholder/hint los provee
// el caller (FREE_TEXT_PRECONFIG en jornada.tsx) para no duplicar el catálogo de copys.
export type ManeuverConfigKind = 'multi' | 'single';

export type ManeuverConfigSheetProps = {
  /** Título del sheet = nombre de la maniobra (ej. "Vacunación"). */
  title: string;
  /** Multi (vacunación, varias) o single (inseminación, una). */
  kind: ManeuverConfigKind;
  /** Placeholder del input grande (ej. "Ej.: Brucelosis"). */
  placeholder: string;
  /** Valor ACTUAL persistido (string; multi = vacunas separadas por coma). '' = sin cargar. */
  value: string;
  /** Valores históricos del campo para el autocompletar (R1.8). */
  history: string[];
  /** Guardar: el caller persiste en config.preconfig[<maniobra>] el valor normalizado. */
  onSave: (value: string) => void;
  /** Cerrar sin guardar. */
  onClose: () => void;
};

export function ManeuverConfigSheet({
  title,
  kind,
  placeholder,
  value,
  history,
  onSave,
  onClose,
}: ManeuverConfigSheetProps) {
  const insets = useSafeAreaInsets();

  // ── GUARD del backdrop contra el "click huérfano" del tap que abrió el sheet (BUG web, Raf) ──
  // El sheet se monta porque el cuerpo de la fila se tocó vía un `Gesture.Tap()` de gesture-handler
  // (ManeuverReorderList: bodyTap → runOnJS(onOpenConfig) → setConfigManeuver → este sheet monta un
  // tick después). En WEB, ese tap deja un `click` DOM nativo que se dispara DESPUÉS del pointerup y
  // cae sobre el scrim RECIÉN montado (un Pressable con onPress=onClose que cubre la pantalla) → lo
  // cierra al instante (~1ms). En NATIVE el gesto consume el touch y no hay click suelto → por eso solo
  // se ve en web. Fix: el scrim ignora presses hasta estar "listo para descartar". Arranca false al
  // montar y se activa en el PRÓXIMO frame (doble requestAnimationFrame): para entonces el click
  // huérfano del open ya pasó, pero un tap DELIBERADO posterior del usuario SÍ cierra (no rompe la
  // salida por backdrop, R3/UX). El guard es SOLO para el scrim; Cancelar/Guardar/chips/sugerencias
  // andan desde el 1er tick (no pasan por acá). Usamos un ref (no estado): el scrim lo lee en el onPress,
  // sin re-render. Fallback setTimeout(0) por si rAF no está disponible (entornos sin DOM).
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

  // Cierre por backdrop gateado: ignora el press si el guard todavía no se armó (click huérfano del open).
  const onBackdropPress = () => {
    if (!readyToDismissRef.current) return;
    onClose();
  };

  // Estado del input grande (lo que se está tipeando).
  const [typed, setTyped] = useState(kind === 'single' ? value : '');
  // Vacunas YA agregadas (solo multi). Arranca de lo persistido (split del string coma-separado).
  const [items, setItems] = useState<string[]>(kind === 'multi' ? splitMultiPreconfig(value) : []);

  // Sugerencias del autocompletar (R1.8): históricas que matchean el prefijo tipeado. En multi,
  // excluimos las ya agregadas (no re-sugerir lo puesto).
  const itemsLower = useMemo(() => new Set(items.map((i) => i.toLowerCase())), [items]);
  const suggestions = useMemo(() => {
    const base = filterAutocomplete(history, typed, 6);
    return kind === 'multi' ? base.filter((s) => !itemsLower.has(s.toLowerCase())) : base;
  }, [history, typed, kind, itemsLower]);

  const trimmed = typed.trim();

  // MULTI: agrega la vacuna tipeada al set de chips (sin duplicar) y limpia el input.
  const addItem = (raw: string) => {
    const v = raw.trim();
    if (v.length === 0) return;
    setItems((prev) => (prev.some((p) => p.toLowerCase() === v.toLowerCase()) ? prev : [...prev, v]));
    setTyped('');
  };

  const removeItem = (target: string) => {
    setItems((prev) => prev.filter((p) => p !== target));
  };

  // SINGLE: tocar una sugerencia llena el input directamente (es el valor).
  const pickSuggestion = (s: string) => {
    if (kind === 'multi') addItem(s);
    else setTyped(s);
  };

  // Guardar: multi = chips unidos por coma (incluye lo tipeado sin agregar, si quedó algo); single =
  // el input tal cual (trim). Guardar SIN nada (multi sin chips ni texto / single con input vacío)
  // persiste '' = limpiar el preconfig: el caller borra la clave (la fila vuelve al hint). Por eso
  // "Guardar" está SIEMPRE habilitado en ambos modos — sin él no habría forma de BORRAR una vacuna ya
  // configurada en multi (quitar el último chip dejaría items=[] sin poder confirmar el vacío).
  const handleSave = () => {
    if (kind === 'multi') {
      const pending = trimmed.length > 0 && !items.some((p) => p.toLowerCase() === trimmed.toLowerCase());
      const all = pending ? [...items, trimmed] : items;
      onSave(joinMultiPreconfig(all));
    } else {
      onSave(trimmed);
    }
  };

  const PRIMARY = getTokenValue('$primary', 'color');
  const FAINT = getTokenValue('$textFaint', 'color');
  const placeholderColor = getTokenValue('$textMuted', 'color');
  const textColor = getTokenValue('$textPrimary', 'color');
  const borderColor = getTokenValue('$divider', 'color');
  const surfaceColor = getTokenValue('$white', 'color');
  const inputFontSize = getTokenValue('$inputText', 'size');
  // Input GRANDE (manga-friendly): pill XL ≥56px del patrón de buscador de manga ($searchBarLg) para
  // tipear con una mano a pleno sol (mismo token que el buscador de Animales, R1.2 de spec 09).
  const inputMinHeight = getTokenValue('$searchBarLg', 'size');
  const radius = getTokenValue('$card', 'radius');
  const padH = getTokenValue('$4', 'space');
  // Respeta la safe-area inferior (el sheet llega al borde de la pantalla).
  const bottomPad = Math.max(insets.bottom, getTokenValue('$4', 'space'));

  return (
    // Backdrop $scrim que cubre la pantalla + sheet anclado abajo. El backdrop cierra (Pressable).
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
        testID="maneuver-config-scrim"
        {...buttonA11y(Platform.OS, { label: 'Cerrar' })}
      />

      <YStack
        width="100%"
        maxHeight="85%"
        backgroundColor="$bg"
        borderTopLeftRadius="$card"
        borderTopRightRadius="$card"
        paddingHorizontal="$4"
        paddingTop="$4"
        paddingBottom={bottomPad}
        gap="$4"
        testID="maneuver-config-sheet"
      >
        {/* ── HEADER FIJO (grip + título). flexShrink:0 → el título nunca se recorta al crecer el cuerpo. ── */}
        <YStack flexShrink={0} gap="$4">
          {/* Grip visual del sheet. */}
          <View
            alignSelf="center"
            width={getTokenValue('$icon', 'size')}
            height={getTokenValue('$progressTrack', 'size')}
            borderRadius="$pill"
            backgroundColor="$divider"
          />

          {/* Título = nombre de la maniobra. lineHeight matching (Vacunación/Inseminación: g/j). */}
          <YStack gap="$1">
            <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" numberOfLines={1}>
              {title}
            </Text>
            <Text fontFamily="$body" fontSize="$3" lineHeight="$3" color="$textMuted" numberOfLines={2}>
              {kind === 'multi'
                ? 'Cargá una o varias vacunas para toda la tanda.'
                : 'Elegí la pajuela por defecto de la tanda.'}
            </Text>
          </YStack>
        </YStack>

        {/* ── CUERPO scrolleable (flex:1 + minHeight:0 web) → absorbe el alto, scrollea INTERNO. ── */}
        <ScrollView flex={1} style={{ minHeight: 0 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: getTokenValue('$3', 'space') }}>
          {/* Chips de vacunas YA agregadas (solo multi). Tocar la × quita la vacuna. */}
          {kind === 'multi' && items.length > 0 ? (
            <XStack flexWrap="wrap" gap="$2">
              {items.map((it) => (
                <XStack
                  key={it}
                  backgroundColor="$greenLight"
                  borderRadius="$pill"
                  paddingLeft="$3"
                  paddingRight="$2"
                  paddingVertical="$2"
                  alignItems="center"
                  gap="$2"
                  testID={`config-chip-${it}`}
                >
                  <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$primary" numberOfLines={1}>
                    {it}
                  </Text>
                  <Pressable
                    onPress={() => removeItem(it)}
                    hitSlop={8}
                    {...buttonA11y(Platform.OS, { label: `Quitar ${it}` })}
                  >
                    <X size={18} color={PRIMARY} strokeWidth={3} />
                  </Pressable>
                </XStack>
              ))}
            </XStack>
          ) : null}

          {/* INPUT GRANDE (manga-friendly) + en multi, un botón "Agregar" al lado. */}
          <XStack gap="$2" alignItems="center">
            <View flex={1}>
              <TextInput
                value={typed}
                onChangeText={setTyped}
                placeholder={placeholder}
                placeholderTextColor={placeholderColor}
                autoCapitalize="sentences"
                returnKeyType="done"
                // En multi, Enter agrega la vacuna tipeada como chip (sin cerrar el sheet).
                onSubmitEditing={kind === 'multi' ? () => addItem(typed) : undefined}
                testID="maneuver-config-input"
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
                {...labelA11y(Platform.OS, title)}
              />
            </View>
            {kind === 'multi' ? (
              <Pressable
                onPress={() => addItem(typed)}
                disabled={trimmed.length === 0}
                {...buttonA11y(Platform.OS, { label: 'Agregar vacuna', disabled: trimmed.length === 0 })}
              >
                <View
                  width={inputMinHeight}
                  height={inputMinHeight}
                  borderRadius="$card"
                  alignItems="center"
                  justifyContent="center"
                  backgroundColor={trimmed.length === 0 ? '$surface' : '$primary'}
                  borderWidth={1}
                  borderColor={trimmed.length === 0 ? '$divider' : '$primary'}
                >
                  <Plus size={24} color={trimmed.length === 0 ? FAINT : surfaceColor} strokeWidth={3} />
                </View>
              </Pressable>
            ) : null}
          </XStack>

          {/* AUTOCOMPLETAR (R1.8): chips de valores usados antes que matchean lo tipeado. */}
          {suggestions.length > 0 ? (
            <YStack gap="$2">
              <Text fontFamily="$body" fontSize="$3" lineHeight="$3" color="$textMuted" numberOfLines={1}>
                Usadas antes
              </Text>
              <XStack flexWrap="wrap" gap="$2">
                {suggestions.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => pickSuggestion(s)}
                    {...buttonA11y(Platform.OS, { label: `Usar ${s}` })}
                  >
                    <View
                      backgroundColor="$surface"
                      borderRadius="$pill"
                      borderWidth={1}
                      borderColor="$divider"
                      paddingHorizontal="$3"
                      paddingVertical="$2"
                      testID={`config-suggestion-${s}`}
                    >
                      <Text fontFamily="$body" fontSize="$4" lineHeight="$4" color="$textPrimary" numberOfLines={1}>
                        {s}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </XStack>
            </YStack>
          ) : null}
        </ScrollView>

        {/* ── FOOTER FIJO (Guardar/Cancelar). flexShrink:0 → siempre abajo, nunca empujado fuera. ── */}
        <YStack flexShrink={0} gap="$2">
          <Button variant="primary" fullWidth onPress={handleSave}>
            Guardar
          </Button>
          <Button variant="secondary" fullWidth onPress={onClose}>
            Cancelar
          </Button>
        </YStack>
      </YStack>
    </View>
  );
}
