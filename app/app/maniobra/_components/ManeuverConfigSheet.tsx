// app/maniobra/_components/ManeuverConfigSheet.tsx — BOTTOM SHEET de preconfig de tanda de una maniobra
// (spec 03 M1.4, etapa 2; R1.7 preconfig de tanda + R1.8 autocompletar de valores usados antes).
//
// ITERACIÓN UX 3 (Raf, 2026-06-14): el preconfig de tanda dejó de vivir en la sección huérfana del
// fondo de la etapa 2 ("Detalle de la tanda" con un input suelto) y pasó a INLINE en la fila de la
// maniobra + ESTE sheet enfocado. Al tocar el cuerpo de una maniobra CONFIGURABLE (vacunación /
// inseminación) se abre este sheet: una decisión por pantalla, input GRANDE (manga-friendly) +
// autocompletar de valores usados antes.
//
// ── AUTO-GUARDADO (UX 4, Raf 2026-07-25): NO hay "Guardar" ni "Cancelar" ─────────────────────────────
// El sheet tiene CUATRO salidas (el CTA, la X del header, el tap en el scrim y el arrastre del shell).
// Con commit diferido, tres de ellas DESCARTABAN en silencio lo cargado: cuatro vacunas tipeadas se
// perdían de un roce del guante en el scrim, sin aviso (violación de Nielsen #5). Y "Guardar" pedía
// CONFIRMAR lo ya confirmado: "Agregar" (o Enter) ya ES el gesto de commit y el chip que aparece ya ES
// el feedback — un tap de más que en 🔴 manga se paga. Ahora:
//   · MULTI (vacunación): cada `addItem`/`removeItem` COMMITEA en el acto (`onCommit`). Quitar el último
//     chip commitea '' = borrar el preconfig (el caller borra la clave y la fila vuelve al hint) — el
//     borrado ya no necesita un "Guardar" habilitado con la lista vacía para ser expresable.
//   · SINGLE (inseminación): el input ES el valor → commitea en cada cambio (trim).
//   · TEXTO TIPEADO SIN AGREGAR: si al cerrar quedó algo en el input que no se agregó, se AGREGA
//     (regla `pendingCloseCommit`, pura). Vale para TODAS las vías de cierre porque el flush vive en el
//     `onClose` que se le pasa al shell — el shell rutea la X, el scrim y el arrastre por ahí.
//   · FOOTER: un único CTA primario full-width "Listo" que sólo CIERRA (mismo camino que la X).
// Auto-guardar acá es barato: el preconfig NO se escribe en la DB, sólo actualiza el estado del wizard;
// la persistencia real es la etapa 3 (`createSession`/`createPreset`), que ya es confirmación explícita.
// Aplica a los DOS modos a propósito: dos sheets abiertos desde la misma lista que se comportaran
// distinto sería peor (Nielsen #4, consistencia).
//
// MULTI vs ÚNICO:
//   - VACUNACIÓN: se pueden cargar VARIAS vacunas (texto libre). Cada una se agrega como un chip; el
//     valor persiste como las vacunas separadas por coma (round-trip con maneuverDetail, que ya muestra
//     un string tal cual). El input + "Agregar" suma una vacuna; tocar la × de un chip la quita.
//   - INSEMINACIÓN: UNA pajuela (texto libre). El input ES el valor.
//
// AUTOCOMPLETAR (R1.8): chips de sugerencias = valores históricos del campo (sembrados de los presets,
// DM1-UI-1) que matchean el prefijo tipeado, vía el helper PURO `filterAutocomplete`. Para vacunación
// se excluyen las que ya están agregadas (no re-sugerir lo puesto).
//
// ── SHELL: `BottomSheetShell` (primitivo del repo) ────────────────────────────────────────────────────
// El esqueleto (backdrop $scrim con el guard anti click-huérfano de web, header fijo / body scroll /
// footer fijo, maxHeight, safe-area) vive en el primitivo. Este archivo solo aporta el CONTENIDO. El
// primitivo además resuelve el BUG 🔴 MANGA que Raf cazó en iOS: con el teclado abierto el sheet quedaba
// TAPADO (solo se veía el título) → ahora SUBE por encima del teclado y CONDENSA (suelta la descripción;
// quedan chips + input + "Listo", y la X del header como salida). Este sheet ya NO le pasa
// `secondaryFooter` (no tiene CTA secundario) — los otros sheets del repo lo siguen usando.
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, TextInput } from 'react-native';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { Plus, X } from 'lucide-react-native';

import { BottomSheetShell, Button } from '@/components';
import { buttonA11y, labelA11y } from '@/utils/a11y';
import {
  addMultiPreconfigItem,
  filterAutocomplete,
  joinMultiPreconfig,
  pendingCloseCommit,
  splitMultiPreconfig,
} from '@/utils/maneuver-wizard';

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
  /**
   * COMMIT del preconfig (AUTO-GUARDADO): el caller persiste en config.preconfig[<maniobra>] el valor
   * normalizado. Se dispara N veces mientras el sheet está abierto (una por cada agregar/quitar/tipear)
   * y **NO cierra el sheet** — el cierre es `onClose`, una sola vez. `''` = borrar el preconfig.
   */
  onCommit: (value: string) => void;
  /** Cerrar el sheet. Lo dispara el CTA "Listo", la X del header, el scrim y el arrastre del shell. */
  onClose: () => void;
};

export function ManeuverConfigSheet({
  title,
  kind,
  placeholder,
  value,
  history,
  onCommit,
  onClose,
}: ManeuverConfigSheetProps) {
  // Estado del input grande (lo que se está tipeando).
  const [typed, setTyped] = useState(kind === 'single' ? value : '');
  // Vacunas YA agregadas (solo multi). Arranca de lo persistido (split del string coma-separado).
  const [items, setItems] = useState<string[]>(kind === 'multi' ? splitMultiPreconfig(value) : []);
  // Espejo síncrono de `items` para el auto-guardado: dos taps en el MISMO frame (React batchea) leerían
  // el mismo `items` de render y el segundo pisaría al primero. El ref se actualiza en el acto y es
  // también la lista que lee el flush del cierre.
  const itemsRef = useRef(items);
  // Espejo de lo TIPEADO, para que `handleClose` pueda ser estable (ver su comentario).
  const typedRef = useRef(typed);
  useEffect(() => {
    typedRef.current = typed;
  });

  // Sugerencias del autocompletar (R1.8): históricas que matchean el prefijo tipeado. En multi,
  // excluimos las ya agregadas (no re-sugerir lo puesto).
  const itemsLower = useMemo(() => new Set(items.map((i) => i.toLowerCase())), [items]);
  const suggestions = useMemo(() => {
    const base = filterAutocomplete(history, typed, 6);
    return kind === 'multi' ? base.filter((s) => !itemsLower.has(s.toLowerCase())) : base;
  }, [history, typed, kind, itemsLower]);

  const trimmed = typed.trim();

  // MULTI: escribe la lista nueva y la COMMITEA en el acto. Lista vacía → '' = borrar el preconfig.
  const commitItems = (next: string[]) => {
    itemsRef.current = next;
    setItems(next);
    onCommit(joinMultiPreconfig(next));
  };

  // MULTI: agrega la vacuna tipeada al set de chips (sin duplicar) y limpia el input.
  const addItem = (raw: string) => {
    if (raw.trim().length === 0) return;
    setTyped('');
    const next = addMultiPreconfigItem(itemsRef.current, raw);
    if (next === null) return; // duplicado: el input se limpia, la lista no cambia (nada que commitear).
    commitItems(next);
  };

  const removeItem = (target: string) => {
    commitItems(itemsRef.current.filter((p) => p !== target));
  };

  // SINGLE: el input ES el valor → cada cambio commitea (trim). Vacío → '' = borrar el preconfig.
  const setSingleValue = (raw: string) => {
    setTyped(raw);
    onCommit(raw.trim());
  };

  // SINGLE: tocar una sugerencia llena el input directamente (es el valor).
  const pickSuggestion = (s: string) => {
    if (kind === 'multi') addItem(s);
    else setSingleValue(s);
  };

  // CIERRE (única vía: la usan el CTA "Listo", la X del header, el scrim y el arrastre del shell). Antes
  // de cerrar, FLUSHEA el texto tipeado que el operario no llegó a "Agregar" — si no, cerrar sería una
  // trampa nueva justo donde sacamos el "Guardar". La regla vive en `pendingCloseCommit` (pura).
  //
  // MEMOIZADO a propósito: el shell lo recibe como `onClose` y lo mete en los `useMemo` de sus gestos; sin
  // memoizar, esos gestos se reconstruían en CADA render — o sea por tecla en modo `single`. Por eso lo
  // tipeado se lee de un REF (si `typed` fuera dep, la identidad cambiaría igual en cada tecla).
  const handleClose = useCallback(() => {
    const pending = pendingCloseCommit(kind, itemsRef.current, typedRef.current);
    if (pending !== null) onCommit(pending);
    onClose();
  }, [kind, onCommit, onClose]);

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
  const removeIcon = getTokenValue('$navIcon', 'size');
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
      onClose={handleClose}
      testID="maneuver-config-sheet"
      scrimTestID="maneuver-config-scrim"
      footer={
        <Button variant="primary" fullWidth onPress={handleClose}>
          Listo
        </Button>
      }
    >
      {/* INPUT GRANDE (manga-friendly) + en multi, un botón "Agregar" al lado. Va PRIMERO: con el teclado
          arriba queda clavado en el tope del body y no lo empujan los chips que se van agregando. */}
      <XStack gap="$2" alignItems="center">
        <View flex={1}>
          <TextInput
            value={typed}
            onChangeText={kind === 'multi' ? setTyped : setSingleValue}
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
          está el ojo. Tocar la × quita la vacuna EN EL ACTO (auto-guardado).

          ALTO = `$4` (44) — JERARQUÍA, no capricho (veto visual del leader). Con el auto-guardado la × pasó
          a ser la ÚNICA acción destructiva y su efecto es INMEDIATO, así que su área tocable tiene que
          llegar a ≥44 (antes: ícono de 18 + hitSlop ≈ 34). Un primer pase la subió a `$touchMin` (56), pero
          eso infló el CHIP ENTERO al alto del botón primario y con el mismo relleno `$primary`: con 3-4
          vacunas quedaban cuatro bloques verdes pesados apilados justo arriba del "Listo" (también verde) y
          el ojo dejaba de distinguir cuál era la acción — jerarquía aplanada (Nielsen #8). Fitts pide ÁREA
          TÁCTIL ≥44, no un pill visual de 56. Ahora el pill mide 44 y la × ocupa TODO su alto con
          `minWidth` 44 → los 44×44 de área se conservan sin que el chip compita con el CTA. El verde se
          queda: verde = "elegido" es el lenguaje ya establecido (la fila de maniobra seleccionada es
          verde). */}
      {kind === 'multi' && items.length > 0 ? (
        <XStack flexWrap="wrap" gap="$2">
          {items.map((it) => (
            <XStack
              key={it}
              backgroundColor="$primary"
              borderRadius="$pill"
              height="$4"
              paddingLeft="$3"
              alignItems="center"
              maxWidth="100%"
              testID={`config-chip-${it}`}
            >
              <Text
                fontFamily="$body"
                fontSize="$4"
                lineHeight="$4"
                fontWeight="600"
                color="$white"
                flexShrink={1}
                numberOfLines={1}
              >
                {it}
              </Text>
              {/* La × va como pieza Tamagui con onPress (NO un Pressable de RN envolviendo un Tamagui con
                  pressStyle: en nativo new-arch eso roba el responder y el onPress no dispara). Llena el
                  alto del pill (`height="100%"`) y reserva `minWidth` 44 → 44×44 de área tocable. */}
              <View
                height="100%"
                minWidth="$4"
                borderRadius="$pill"
                alignItems="center"
                justifyContent="center"
                flexShrink={0}
                pressStyle={{ backgroundColor: '$primaryPress' }}
                onPress={() => removeItem(it)}
                testID={`config-chip-remove-${it}`}
                {...buttonA11y(Platform.OS, { label: `Quitar ${it}` })}
              >
                <X size={removeIcon} color={WHITE} strokeWidth={3} />
              </View>
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
