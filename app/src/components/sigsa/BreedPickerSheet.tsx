// app/src/components/sigsa/BreedPickerSheet.tsx — BOTTOM SHEET para elegir la RAZA del catálogo SENASA
// controlado (spec 08, T13 / R1.4 UX, R8.3). El catálogo (breed_catalog) es la fuente del código RAZA del
// TXT SIGSA (R5.2); elegir una raza setea `animal_profiles.breed_id`. Es la puerta de "completar la raza
// para poder exportar a SIGSA".
//
// Lista (helper PURO breedPickerOptions): PRIMERO "Sin raza — a completar" (selecciona null → el animal
// queda "a completar", R8.2), luego las 32... bueno, las BOVINAS ACTIVAS del catálogo ordenadas por
// sort_order (pampeanas primero). Cada fila muestra el CÓDIGO SENASA (chip) + el NOMBRE. `OR` (Otra Raza) NO
// se promueve (decisión 1 del leader: queda en su sort_order natural 28, no flotado al tope). `S/E` y las
// bubalinas quedan FUERA (las filtra el helper).
//
// BÚSQUEDA: como hay ~28 razas, un campo de búsqueda arriba (filtra por nombre o código, helper PURO
// filterBreedOptions) — bajo el header fijo, sobre el body scrolleable. "Sin raza" sobrevive siempre al
// filtro (es la salida para "no sé la raza").
//
// PATRÓN canónico de sheet (regla de la skill design-review, idéntico a LotePickerSheet): backdrop $scrim
// tappable (con GUARD anti tap-through web — doble-rAF, reference_rn_web_pitfalls) + sheet anclado abajo con
// grip + maxHeight → HEADER FIJO (flexShrink:0, título "Elegir raza" + el campo de búsqueda que NUNCA se
// recortan al crecer la lista) + BODY SCROLLEABLE (ScrollView flex:1, la lista de razas scrollea adentro, no
// tapa el título ni la búsqueda) + FOOTER FIJO (Cancelar).
//
// RECORTE DE DESCENDENTES (memoria): los nombres de raza no tienen descendentes problemáticos hoy, pero todo
// Text con numberOfLines lleva lineHeight matching por regla dura. Cero hardcode (ADR-023 §4): tokens; lo que
// cruza a APIs no-Tamagui (lucide, TextInput) vía getTokenValue. es-AR voseo.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { Check, Search } from 'lucide-react-native';

import { buttonA11y } from '../../utils/a11y';
import {
  breedPickerOptions,
  filterBreedOptions,
  type BreedCatalogEntry,
  type BreedPickerOption,
} from '../../utils/breed-picker';

export type BreedPickerSheetProps = {
  /** ¿El sheet está abierto? (montaje controlado por el form). */
  open: boolean;
  /** Cerrar sin elegir (tap en el scrim o "Cancelar"). */
  onClose: () => void;
  /** Catálogo de razas (offline, fetchBreedCatalog). El helper filtra bovine+active. Puede estar vacío. */
  breeds: BreedCatalogEntry[];
  /** El código SENASA ACTUAL del animal (breed_catalog.senasa_code vía breed_id), o null si sin raza. */
  selectedCode: string | null;
  /**
   * Elegir una raza: `(id, senasaCode)` con id = breed_catalog.id (lo que se guarda en breed_id) y el código
   * para el resumen. "Sin raza" → `(null, null)` (deja breed_id null). El form persiste + cierra.
   */
  onSelect: (breedId: string | null, senasaCode: string | null) => void;
};

export function BreedPickerSheet({ open, onClose, breeds, selectedCode, onSelect }: BreedPickerSheetProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, getTokenValue('$navBottomMin', 'size'));
  const muted = getTokenValue('$textMuted', 'color');
  const placeholderColor = getTokenValue('$textMuted', 'color');

  const [query, setQuery] = useState('');

  // ── GUARD del backdrop contra el "click huérfano" del tap que abrió el sheet (BUG web táctil) ──
  // Idéntico a LotePickerSheet: el tap que abre este sheet (la afordancia "Elegir raza" del form) deja, en
  // web táctil, un `click` emulado (touch→mouse) ~20ms después que caería sobre el scrim recién montado → lo
  // cerraría a ~1ms. El scrim ignora presses hasta estar "listo para descartar" (armado en el PRÓXIMO frame
  // vía doble rAF). Se RE-ARMA cada vez que se abre (open en deps). Ref (no estado): el scrim lo lee sin re-render.
  const readyToDismissRef = useRef(false);
  useEffect(() => {
    if (!open) {
      readyToDismissRef.current = false;
      return;
    }
    // Cada vez que se ABRE, limpiamos la búsqueda previa (el form reabre el picker "fresco").
    setQuery('');
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
  }, [open]);

  // Opciones (helper PURO): "Sin raza" + bovinas activas ordenadas; luego el filtro de búsqueda. Memo por
  // (breeds, selectedCode, query) — la lista no se recomputa en cada keystroke salvo que cambie la query.
  const options = useMemo(() => breedPickerOptions(breeds, selectedCode), [breeds, selectedCode]);
  const filtered = useMemo(() => filterBreedOptions(options, query), [options, query]);
  // ¿Hay razas en el catálogo (post-filtro bovine+active del helper)? options[0] es siempre "Sin raza".
  const hasBreeds = options.length > 1;

  if (!open) return null;

  const onBackdropPress = () => {
    if (!readyToDismissRef.current) return;
    onClose();
  };

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
        testID="breed-sheet-scrim"
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
        testID="breed-sheet"
      >
        {/* ── HEADER FIJO (grip + título + búsqueda). flexShrink:0 → no se recorta al crecer la lista. ── */}
        <YStack flexShrink={0} gap="$3">
          {/* Grip visual del sheet. */}
          <View
            alignSelf="center"
            width={getTokenValue('$icon', 'size')}
            height={getTokenValue('$progressTrack', 'size')}
            borderRadius="$pill"
            backgroundColor="$divider"
          />
          <YStack gap="$1">
            {/* Título $7 con lineHeight matcheado (regla de recorte). */}
            <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" numberOfLines={1}>
              Elegir raza
            </Text>
            <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color="$textMuted" numberOfLines={2}>
              La raza se usa para declarar el animal en SIGSA. Buscá por nombre o código.
            </Text>
          </YStack>

          {/* Campo de BÚSQUEDA — input pill con ícono (filtra nombre/código). En el header fijo → siempre
              visible mientras se scrollea la lista. */}
          {hasBreeds ? (
            <XStack
              width="100%"
              alignItems="center"
              gap="$2"
              minHeight="$chipMin"
              paddingHorizontal="$3"
              borderRadius="$pill"
              backgroundColor="$surface"
              borderWidth={1}
              borderColor="$divider"
            >
              <Search size={18} color={muted} strokeWidth={2} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Buscar raza…"
                placeholderTextColor={placeholderColor}
                autoCapitalize="none"
                autoCorrect={false}
                testID="breed-sheet-search"
                style={{
                  flex: 1,
                  minWidth: 0,
                  paddingVertical: getTokenValue('$2', 'space'),
                  fontFamily: 'Inter',
                  // ⚠ El font-size del TextInput va en PX, leído del token de fuente de INPUT (mismo que
                  // FormField: $inputText=16). `getTokenValue('$4','size')` leería el token de TAMAÑO global
                  // (no el de fuente) → fuente gigante (bug detectado en el veto run 2). $inputText es 16px.
                  fontSize: getTokenValue('$inputText', 'size'),
                  color: getTokenValue('$textPrimary', 'color'),
                }}
                {...(Platform.OS === 'web'
                  ? { 'aria-label': 'Buscar raza por nombre o código' }
                  : { accessibilityLabel: 'Buscar raza por nombre o código' })}
              />
            </XStack>
          ) : null}
        </YStack>

        {/* ── CUERPO scrolleable (flex:1 + minHeight:0 web) → la lista crece adentro, no tapa el header. ── */}
        <ScrollView
          flex={1}
          style={{ minHeight: 0 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: getTokenValue('$2', 'space') }}
        >
          {filtered.map((opt) => (
            <BreedOption
              key={opt.id ?? 'none'}
              testID={opt.id === null ? 'breed-option-none' : `breed-option-${opt.senasaCode}`}
              option={opt}
              onPress={() => onSelect(opt.id, opt.id === null ? null : opt.senasaCode)}
            />
          ))}

          {/* Empty-state del FILTRO: la búsqueda no matcheó ninguna raza (pero "Sin raza" sigue arriba). */}
          {hasBreeds && filtered.filter((o) => o.id !== null).length === 0 ? (
            <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color="$textFaint" numberOfLines={2} paddingHorizontal="$2" paddingTop="$1">
              No encontramos esa raza. Probá con otro nombre o código, o elegí "Sin raza".
            </Text>
          ) : null}

          {/* Empty-state del CATÁLOGO: aún no sincronizó (no debería: la stream lo baja al primer login). */}
          {!hasBreeds ? (
            <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color="$textFaint" numberOfLines={3} paddingHorizontal="$2" paddingTop="$1">
              El catálogo de razas todavía no se descargó. Conectate un momento y volvé a intentar.
            </Text>
          ) : null}
        </ScrollView>

        {/* ── FOOTER FIJO (Cancelar). flexShrink:0 → siempre abajo. Tap en una opción ya cierra; este es la
              salida sin elegir (espejo del scrim, accesible sin apuntar al borde). ── */}
        <YStack flexShrink={0}>
          <View
            testID="breed-sheet-cancelar"
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// OPCIÓN de raza — fila tappable: chip del CÓDIGO SENASA + NOMBRE + check si seleccionada. Alto ≥$touchMin
// (Fitts). "Sin raza" no tiene chip de código (senasaCode vacío) → solo el nombre. Tap = elige y cierra.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function BreedOption({
  option,
  onPress,
  testID,
}: {
  option: BreedPickerOption;
  onPress: () => void;
  testID: string;
}) {
  const { senasaCode, name, selected, id } = option;
  const isNone = id === null;
  return (
    <XStack
      testID={testID}
      minHeight="$touchMin"
      alignItems="center"
      gap="$3"
      backgroundColor="$surface"
      borderWidth={1}
      borderColor={selected ? '$primary' : '$divider'}
      borderRadius="$card"
      paddingHorizontal="$4"
      paddingVertical="$3"
      pressStyle={{ backgroundColor: '$greenLight' }}
      onPress={onPress}
      {...buttonA11y(Platform.OS, {
        label: isNone ? 'Sin raza, a completar' : `Raza ${name}, código ${senasaCode}`,
        selected,
      })}
    >
      {/* Chip del código SENASA (slot de ancho fijo → los nombres quedan alineados). "Sin raza" no lo lleva. */}
      {!isNone ? (
        <View
          minWidth="$icon"
          height="$chipMin"
          paddingHorizontal="$2"
          borderRadius="$pill"
          backgroundColor={selected ? '$primary' : '$greenLight'}
          alignItems="center"
          justifyContent="center"
          flexShrink={0}
        >
          <Text
            fontFamily="$body"
            fontSize="$3"
            lineHeight="$3"
            fontWeight="700"
            color={selected ? '$white' : '$primary'}
            numberOfLines={1}
          >
            {senasaCode}
          </Text>
        </View>
      ) : null}

      <Text
        flex={1}
        minWidth={0}
        fontFamily="$body"
        fontSize="$5"
        lineHeight="$5"
        fontWeight={selected ? '700' : '600'}
        color="$textPrimary"
        numberOfLines={1}
      >
        {name}
      </Text>
      {selected ? (
        <Check size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$primary', 'color')} strokeWidth={2.5} />
      ) : null}
    </XStack>
  );
}
