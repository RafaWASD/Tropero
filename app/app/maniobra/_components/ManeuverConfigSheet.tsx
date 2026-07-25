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
// ── SHELL: `BottomSheetShell` (primitivo del repo) ────────────────────────────────────────────────────
// El esqueleto (backdrop $scrim con el guard anti click-huérfano de web, header fijo / body scroll /
// footer fijo, maxHeight, safe-area) vive en el primitivo. Este archivo solo aporta el CONTENIDO. El
// primitivo además resuelve el BUG 🔴 MANGA que Raf cazó en iOS: con el teclado abierto el sheet quedaba
// TAPADO (solo se veía el título) → ahora SUBE por encima del teclado y CONDENSA (suelta la descripción y
// el "Cancelar"; quedan chips + input + "Guardar", y la X del header como salida).
//
// ── ORDEN DEL CUERPO: input PRIMERO, chips DEBAJO ────────────────────────────────────────────────────
// Con el teclado arriba el alto útil del body se parte al medio. Con los chips ARRIBA del input, cada
// vacuna agregada CRECÍA el contenido por encima del input y lo EMPUJABA hacia abajo (fuera del área
// visible tras 3-4 vacunas). Con el input primero: el input queda CLAVADO arriba del body (no se mueve al
// agregar), y el chip nuevo aparece JUSTO DEBAJO — el feedback cae donde ya está el ojo (proximidad
// Gestalt), sin scroll automático que pelee con el usuario. Las sugerencias ("Usadas antes") van al final.
//
// Cero hardcode (ADR-023 §4): tokens; lo que cruza a APIs no-Tamagui (lucide, TextInput) vía getTokenValue.
// Targets manga ≥$touchMin.
//
// RECORTE DE DESCENDENTES (memoria, regla dura): el título ("Vacunación"/"Inseminación" traen g/j) lo
// maneja el shell con lineHeight matching; todo Text con numberOfLines de acá también lo lleva.

import { useMemo, useState } from 'react';
import { Platform, Pressable, TextInput } from 'react-native';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { Plus, X } from 'lucide-react-native';

import { BottomSheetShell, Button } from '@/components';
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

  const WHITE = getTokenValue('$white', 'color');
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

  return (
    <BottomSheetShell
      title={title}
      description={
        kind === 'multi'
          ? 'Cargá una o varias vacunas para toda la tanda.'
          : 'Elegí la pajuela por defecto de la tanda.'
      }
      onClose={onClose}
      testID="maneuver-config-sheet"
      scrimTestID="maneuver-config-scrim"
      footer={
        <Button variant="primary" fullWidth onPress={handleSave}>
          Guardar
        </Button>
      }
      secondaryFooter={
        <Button variant="secondary" fullWidth onPress={onClose}>
          Cancelar
        </Button>
      }
    >
      {/* INPUT GRANDE (manga-friendly) + en multi, un botón "Agregar" al lado. Va PRIMERO: con el teclado
          arriba queda clavado en el tope del body y no lo empujan los chips que se van agregando. */}
      <XStack gap="$2" alignItems="center">
        <View flex={1}>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            placeholder={placeholder}
            placeholderTextColor={placeholderColor}
            autoCapitalize="sentences"
            // MULTI: Enter AGREGA y MANTIENE el teclado abierto (cargar 3 vacunas seguidas no puede
            // obligar a reabrir el teclado 3 veces — 🔴 manga). `submitBehavior='submit'` es la API de
            // RN 0.77+ (verificada en RN 0.85.3: TextInput.d.ts SubmitBehavior); `blurOnSubmit={false}`
            // queda como par para react-native-web, que todavía NO lee submitBehavior (su TextInput solo
            // conoce blurOnSubmit) — con blurOnSubmit=false rn-web igual dispara onSubmitEditing en un
            // input de una línea, pero no blurea. SINGLE (inseminación): Enter cierra el teclado (el
            // input ES el valor, no hay nada más que agregar) → comportamiento actual intacto.
            returnKeyType={kind === 'multi' ? 'next' : 'done'}
            submitBehavior={kind === 'multi' ? 'submit' : 'blurAndSubmit'}
            blurOnSubmit={kind !== 'multi'}
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

      {/* Chips de vacunas YA agregadas (solo multi), JUSTO DEBAJO del input: el chip nuevo aparece donde
          está el ojo. Tocar la × quita la vacuna. */}
      {kind === 'multi' && items.length > 0 ? (
        <XStack flexWrap="wrap" gap="$2">
          {items.map((it) => (
            <XStack
              key={it}
              backgroundColor="$primary"
              borderRadius="$pill"
              paddingLeft="$3"
              paddingRight="$2"
              paddingVertical="$2"
              alignItems="center"
              gap="$2"
              testID={`config-chip-${it}`}
            >
              <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$white" numberOfLines={1}>
                {it}
              </Text>
              <Pressable
                onPress={() => removeItem(it)}
                hitSlop={8}
                {...buttonA11y(Platform.OS, { label: `Quitar ${it}` })}
              >
                <X size={18} color={WHITE} strokeWidth={3} />
              </Pressable>
            </XStack>
          ))}
        </XStack>
      ) : null}

      {/* AUTOCOMPLETAR (R1.8): chips de valores usados antes que matchean lo tipeado. El shell pone
          keyboardShouldPersistTaps='handled' → con el teclado arriba se agregan al PRIMER toque. */}
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
    </BottomSheetShell>
  );
}
