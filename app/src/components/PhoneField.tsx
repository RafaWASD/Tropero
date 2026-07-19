// PhoneField — el ÚNICO input de teléfono de RAFAQ (spec 01, delta TELÉFONO / RTEL.3.1).
//
// Por qué existe: el teléfono se capturaba en DOS pantallas con dos configuraciones distintas de
// FormField, y apenas se tocó una las dos divergieron (en `crear-campo` se podían tipear letras y el
// campo no tenía tope). La causa raíz no era que faltaran dos props: era que no había un componente
// compartido. La paridad ahora es por CONSTRUCCIÓN — un solo componente, no dos configuraciones que
// puedan separarse. El guard `phone-field-guard.test.ts` impide que aparezca una tercera copia.
//
// Compone `FormField` usando su contrato público (RTEL.3.8: NO se agrega `inputMode`). El label del
// grupo se dibuja acá con `FieldLabel` y el interno del `FormField` se apaga con `hideLabel` — ver la
// nota de layout abajo (ADR-027).
//
// Capas (architecture.md): components → utils. NO importa de services. ✅

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Text, XStack, YStack } from 'tamagui';

import { FieldLabel, FormField } from './FormField';
import { buttonA11y } from '../utils/a11y';
import {
  EMPTY_PHONE_INPUT,
  PHONE_AR_COUNTRY,
  PHONE_MAX_LENGTH,
  maskArPhone,
  phoneDiagnosis,
  phoneInputChange,
  phoneInputFromValue,
  phoneValueFrom,
  renderPhoneInput,
  samePhoneValue,
  type PhoneInputState,
  type PhoneValue,
} from '../utils/phone';

export type { PhoneValue } from '../utils/phone';

export type PhoneFieldProps = {
  /** Label visible sobre el input. Default "Teléfono". */
  label?: string;
  value: PhoneValue;
  /**
   * Se invoca en CADA cambio del valor — incluidas las transiciones `valid → incomplete` y
   * `valid → empty` (RTEL.3.1.2). Ver la nota L-2 en `commit`.
   */
  onChangeValue: (next: PhoneValue) => void;
  /**
   * Prende el error de validación DERIVADO del contenido. El caller lo activa al intentar guardar, no
   * mientras se tipea (no se reta al usuario a mitad del número).
   */
  showError?: boolean;
  /** El teléfono es obligatorio (gate de alta de campo, R3.8): vacío cuenta como error. */
  required?: boolean;
  /** Error EXTERNO del campo (si viene, gana sobre el derivado). */
  error?: string | null;
  editable?: boolean;
  testID?: string;
};

export function PhoneField({
  label = 'Teléfono',
  value,
  onChangeValue,
  showError = false,
  required = false,
  error = null,
  editable = true,
  testID,
}: PhoneFieldProps) {
  const [state, setState] = useState<PhoneInputState>(() => phoneInputFromValue(value));
  // Último valor emitido al caller. Es la referencia para decidir si un `value` entrante es un cambio
  // GENUINO del caller (reset del form) o el eco de lo que acabamos de emitir → evita el loop de
  // re-seed que tendría un efecto que comparara contra el estado interno.
  const lastEmittedRef = useRef<PhoneValue>(phoneValueFrom(state.digits, state.intl));

  useEffect(() => {
    if (samePhoneValue(lastEmittedRef.current, value)) return;
    lastEmittedRef.current = value;
    setState(phoneInputFromValue(value));
  }, [value]);

  const commit = useCallback(
    (next: { state: PhoneInputState; value: PhoneValue }) => {
      setState(next.state);
      lastEmittedRef.current = next.value;
      // ⚠️ L-2 (RTEL.3.1.2) — SE EMITE SIEMPRE, no solo al alcanzar `valid`. El porqué está en
      // `phoneInputChange` (utils/phone.ts), donde además se testea.
      onChangeValue(next.value);
    },
    [onChangeValue],
  );

  const onChangeText = useCallback(
    (incoming: string) => commit(phoneInputChange(state, incoming)),
    [commit, state],
  );

  const applySuggestion = useCallback(
    (suggestion: string) => {
      // RTEL.6.9 — el valor aceptado vuelve a entrar por el CAMINO NORMAL: la misma transición que un
      // pegado (phoneInputChange → normalizePhone → PhoneValue → re-normalización del service →
      // CHECK). No hay atajo de escritura: `detectArTrunkPrefix` propuso, el usuario confirmó, y el
      // valor se valida igual que cualquier otro.
      commit(phoneInputChange(EMPTY_PHONE_INPUT, suggestion));
    },
    [commit],
  );

  // Callejón sin salida del valor GUARDADO: el caller nos pasa `incomplete` (un teléfono legacy que no
  // normaliza, pre-`0126`) pero no hay dígitos con los que rehidratar el campo — solo `valid` transporta
  // contenido. Sin esto, el form bloquea el guardado con el campo vacío, sin borde ni mensaje. Se apaga
  // solo: apenas el usuario tipea un dígito, `state.digits` deja de estar vacío.
  const unreadableStored = value.kind === 'incomplete' && state.digits.length === 0;

  const diagnosis = phoneDiagnosis(state.digits, {
    intl: state.intl,
    required,
    unreadableStored,
  });
  const shownError =
    error ?? (showError || unreadableStored ? (diagnosis?.message ?? null) : null);
  // ⚠️ La SUGERENCIA no espera a `showError`, a diferencia del mensaje de error. No son lo mismo: el
  // mensaje RETA ("faltan dígitos") y por eso se guarda para el intento de guardado; la sugerencia
  // AYUDA, y llega tarde si aparece recién después de que el usuario tocó "Continuar". Es el punto del
  // tope de 12: quien tipea su celular con el 15 ve "¿Quisiste decir …?" al terminar de tipearlo. No
  // puede molestar a mitad del número — `detectArTrunkPrefix` exige los 12 dígitos exactos con el 15 en
  // el offset del código de área, y desaparece sola en cuanto el valor pasa a `valid`.
  const suggestion = diagnosis?.suggestion ?? null;

  return (
    <YStack width="100%" gap="$2">
      {/* ⚠️ El label etiqueta el GRUPO (chip `+54` + input), y por eso se dibuja ACÁ y no adentro del
          `FormField` (`hideLabel`).
          Antes vivía dentro de la columna del input: quedaba sangrado el ancho del chip (~75px), la
          columna de labels del formulario se veía DENTADA contra sus hermanos (en el perfil, `Nombre`
          arrancaba en x=37 y `Teléfono` en x=112) y encima el label SALTABA ~76px al pasar a modo
          internacional, cuando el chip desaparece. Es exactamente la clase de bug de ADR-027: una
          decoración lateral corriendo el layout de un elemento que debería estar anclado al contenedor
          (y su regla 2: el estado de la decoración no debe recorrer el layout). Anclado al grupo, el
          label es indiferente a que el chip esté o no.
          El estilo lo comparte con los labels hermanos POR CONSTRUCCIÓN: es el MISMO `FieldLabel` que
          usa `FormField` adentro, no una copia que pueda divergir. */}
      <FieldLabel>{label}</FieldLabel>

      <XStack width="100%" gap="$2" alignItems="flex-start">
        {/* Adorno +54 NO EDITABLE (RTEL.4.1): el usuario tipea los 10 dígitos nacionales. Se oculta en
            modo internacional (RTEL.4.7). Va como caja hermana del FormField porque su contrato no
            expone prefijos y este delta NO lo amplía (RTEL.3.8). Con el label afuera de la fila, el
            chip y el input arrancan los dos en el tope y quedan alineados por su `minHeight`
            compartido ($touchMin) — ya no hace falta el spacer que simulaba el alto del label. */}
        {!state.intl ? (
          <XStack
            flexShrink={0}
            minHeight="$touchMin"
            alignItems="center"
            paddingHorizontal="$4"
            borderRadius="$card"
            borderWidth={1}
            borderColor="$divider"
            backgroundColor="$white"
            testID={testID ? `${testID}-prefix` : undefined}
          >
            <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="500" color="$textMuted">
              {`+${PHONE_AR_COUNTRY}`}
            </Text>
          </XStack>
        ) : null}

        <YStack flex={1} minWidth={0}>
          <FormField
            label={label}
            hideLabel
            value={renderPhoneInput(state)}
            onChangeText={onChangeText}
            // ⚠️ El prefijo "Ej." NO es adorno: es lo que impide que el placeholder se lea como un valor
            // YA CARGADO. Un teléfono de ejemplo ocupa la misma posición y tiene la misma pinta que uno
            // real, así que sin el "Ej." la única señal de "campo vacío" queda siendo el color — y en el
            // gate de `R3.8`, que BLOQUEA la creación del campo, leerlo mal cuesta un rechazo seco al
            // tocar Continuar (peor todavía a pleno sol, en la manga). El color es la otra mitad del fix
            // y vive en `FormField` (placeholder = $textFaint, no $textMuted). El as-built previo a
            // `PhoneField` ya usaba "Ej. …" en las dos pantallas; el componente lo había perdido al
            // unificarlas — esto lo restituye.
            placeholder={state.intl ? 'Ej. +34 600 123 456' : 'Ej. 11 2345-6789'}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            maxLength={PHONE_MAX_LENGTH}
            editable={editable}
            error={shownError}
            testID={testID}
          />
        </YStack>
      </XStack>

      {/* DP4 (opción D) — sugerencia CONFIRMABLE ante el prefijo 15: se muestra FORMATEADA y se aplica
          solo tras un tap explícito (RTEL.6.7). La detección PROPONE, nunca escribe (RTEL.6.8). */}
      {suggestion ? (
        <XStack
          alignSelf="flex-start"
          alignItems="center"
          minHeight="$chipMin"
          paddingHorizontal="$3"
          paddingVertical="$2"
          borderRadius="$pill"
          borderWidth={1}
          borderColor="$primary"
          backgroundColor="$surface"
          hitSlop={8}
          pressStyle={{ opacity: 0.6 }}
          onPress={() => applySuggestion(suggestion)}
          testID={testID ? `${testID}-suggestion` : undefined}
          {...buttonA11y(Platform.OS, { label: `Usar el teléfono ${maskArPhone(suggestion)}` })}
        >
          <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$primary">
            {`¿Quisiste decir ${maskArPhone(suggestion)}?`}
          </Text>
        </XStack>
      ) : null}
    </YStack>
  );
}
