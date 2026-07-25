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
// ── SHELL: `BottomSheetShell` (primitivo del repo) ────────────────────────────────────────────────────
// El patrón canónico de sheet (backdrop $scrim tappable con GUARD anti tap-through web —doble-rAF,
// reference_rn_web_pitfalls—, sheet anclado abajo con grip + maxHeight, HEADER FIJO que no se recorta al
// crecer la lista, BODY scrolleable, FOOTER FIJO) ya NO se copia a mano acá: vive en el primitivo, que
// además es KEYBOARD-AWARE. Este sheet lo necesita: al tipear en el buscador, el teclado tapaba la lista de
// resultados y el "Cancelar" (BUG 🔴 de clase, Raf en iOS) → ahora el sheet SUBE por encima del teclado.
// El campo de BÚSQUEDA va como primer hijo del BODY (no en el header fijo): con el teclado arriba el alto
// útil se parte al medio, y un header con 3 bloques fijos (título + descripción + buscador) se comía casi
// todo lo que queda para los resultados. Al ir en el body, el buscador scrollea con la lista pero arranca
// SIEMPRE a la vista (es el primer elemento) y la lista conserva alto útil para ~3-4 razas.
//
// RECORTE DE DESCENDENTES (memoria): los nombres de raza no tienen descendentes problemáticos hoy, pero todo
// Text con numberOfLines lleva lineHeight matching por regla dura. Cero hardcode (ADR-023 §4): tokens; lo que
// cruza a APIs no-Tamagui (lucide, TextInput) vía getTokenValue. es-AR voseo.

import { useEffect, useMemo, useState } from 'react';
import { Platform, TextInput } from 'react-native';
import { getTokenValue, Text, View, XStack } from 'tamagui';
import { Check, Search } from 'lucide-react-native';

import { BottomSheetShell } from '../BottomSheetShell';
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
  const muted = getTokenValue('$textMuted', 'color');
  const placeholderColor = getTokenValue('$textMuted', 'color');

  const [query, setQuery] = useState('');

  // El GUARD anti "click huérfano" del backdrop (doble rAF) vive en el primitivo y se ARMA al montar: acá
  // el shell monta/desmonta con `open` (early return abajo), así que se re-arma en cada apertura — mismo
  // comportamiento que el guard a mano que tenía este archivo.
  // Cada vez que se ABRE limpiamos la búsqueda previa (el form reabre el picker "fresco").
  useEffect(() => {
    if (!open) return;
    setQuery('');
  }, [open]);

  // Opciones (helper PURO): "Sin raza" + bovinas activas ordenadas; luego el filtro de búsqueda. Memo por
  // (breeds, selectedCode, query) — la lista no se recomputa en cada keystroke salvo que cambie la query.
  const options = useMemo(() => breedPickerOptions(breeds, selectedCode), [breeds, selectedCode]);
  const filtered = useMemo(() => filterBreedOptions(options, query), [options, query]);
  // ¿Hay razas en el catálogo (post-filtro bovine+active del helper)? options[0] es siempre "Sin raza".
  const hasBreeds = options.length > 1;

  if (!open) return null;

  return (
    <BottomSheetShell
      title="Elegir raza"
      description="La raza se usa para declarar el animal en SIGSA. Buscá por nombre o código."
      onClose={onClose}
      testID="breed-sheet"
      scrimTestID="breed-sheet-scrim"
      contentGap="$2"
      // Tap en una opción ya cierra; el secundario es la salida sin elegir (espejo del scrim, accesible sin
      // apuntar al borde). Con el teclado del buscador ARRIBA se condensa y lo reemplaza la X del header.
      secondaryFooter={
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
      }
    >
      {/* Campo de BÚSQUEDA — input pill con ícono (filtra nombre/código). Primer elemento del cuerpo: se ve
          siempre al abrir y NO consume alto fijo con el teclado arriba (ver cabecera). */}
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
    </BottomSheetShell>
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
