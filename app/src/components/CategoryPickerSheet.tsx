// CategoryPickerSheet — BOTTOM SHEET para FIJAR A MANO la categoría de un animal desde la ficha
// (delta spec 02 `ficha-categoria-tacto`, RCM.3 / RCM.4 / RCM.5.3).
//
// Molde: `BreedPickerSheet` (la otra fila editable de "Datos del animal"), SIN buscador — son ≤ 5 opciones,
// un campo de búsqueda ahí sería ruido (y traería teclado a una pantalla que no lo necesita).
//
// ── SHELL: `BottomSheetShell` (regla dura de `docs/design-system.md` §6) ─────────────────────────────
// El scrim con guard anti tap-through de web, el arrastre para cerrar, el back de Android, la X y el
// esqueleto header-fijo / body-scroll / footer-fijo los aporta el primitivo. El consumidor MONTA y DESMONTA
// el shell con el estado de apertura (precondición 1 del contrato: el BackHandler se registra al montar).
// Precondición 2 (confirmar el cierre si hay texto tipeado) — EVALUADA Y DESCARTADA: este sheet no tiene
// ningún input, así que cerrar por cualquier vía cancela sin nada que perder (RCM.3.5).
//
// ── DOS FASES DENTRO DEL MISMO SHEET (RCM.3.3): `list` → `confirm` ──────────────────────────────────
// No navega ni abre un segundo overlay: la confirmación reemplaza el cuerpo. Motivo de UX: un cambio de
// categoría mueve el badge del hero, la card de fijación y —si la elegida es una categoría "probada"— el
// denominador de los reportes reproductivos; pedirlo en el mismo lugar donde se eligió mantiene el contexto
// (Nielsen #1 visibilidad, #5 prevención de error).
//
// El COPY de la consecuencia depende del EFECTO (`resolveCategoryPinEffect`, la misma regla que el write):
//   · `pin`   → "queda fijada a mano y deja de actualizarse sola" (RCM.4.2)
//   · `unpin` → "vuelve a actualizarse sola" (RCM.5.3)
//   · `noop`  → ni siquiera se llega a la confirmación: se cierra sin escribir (RCM.3.4)
// Y si la categoría elegida es INCOHERENTE con la edad, se suma el aviso de RCM.4.4 — que **NO bloquea**:
// `Confirmar` sigue habilitado (C1.2 del Gate 0).
//
// Cero hardcode (ADR-023 §4): tokens; lo que cruza a lucide, vía `getTokenValue`. a11y por los helpers.
// `lineHeight` matcheado en TODO `Text` (regla dura de recorte de descendentes: "Categoría", "Vaquillona
// preñada", "Por edad le corresponde…" traen g/q/p/j/y). Targets ≥ `$touchMin` (Fitts). es-AR voseo.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { Check, TriangleAlert } from 'lucide-react-native';

import { BottomSheetShell } from './BottomSheetShell';
import { Button } from './Button';
import { FormError } from './AuthBits';
import { buttonA11y, labelA11y } from '../utils/a11y';
import { formatAnimalAge } from '../utils/animal-age';
import { categoryAgeMismatch, resolveCategoryPinEffect } from '../utils/category-pin';
import type { AnimalSex } from '../utils/animal-category';
import type { SystemCategory } from '../services/animals';

export type CategoryPickerSheetProps = {
  /** ¿El sheet está abierto? El caller lo monta/desmonta con este flag (precondición 1 del shell). */
  open: boolean;
  /** Cerrar sin escribir (X, scrim, arrastre, back, "Cancelar" de la lista). */
  onClose: () => void;
  /** Categorías OFRECIBLES ya filtradas por sexo + castración (`pickableCategories`), en orden de catálogo. */
  options: readonly SystemCategory[];
  /** `code` de la categoría VIGENTE del animal (la del badge del hero / el espejo C6). */
  currentCode: string;
  /** `category_override` ACTUAL del perfil (decide el efecto y el copy). */
  currentOverride: boolean;
  /** `code` DERIVADO por el espejo, o null si no resuelve localmente. */
  derivedCode: string | null;
  /** Sexo, fecha de nacimiento y castración REALES — entradas del aviso de incoherencia etaria (RCM.4.3). */
  sex: AnimalSex;
  birthDate: string | null;
  isCastrated: boolean;
  /**
   * Confirmar la elección. El caller ejecuta `setCategoryManual` con optimismo EN SITIO y cierra el sheet en
   * caso de éxito; en error devuelve el mensaje es-AR, que se muestra INLINE (el sheet queda abierto para
   * reintentar, sin perder la elección).
   */
  onConfirm: (code: string) => Promise<{ ok: boolean; error?: string }>;
};

export function CategoryPickerSheet({
  open,
  onClose,
  options,
  currentCode,
  currentOverride,
  derivedCode,
  sex,
  birthDate,
  isCastrated,
  onConfirm,
}: CategoryPickerSheetProps) {
  /** `null` = fase LISTA; un code = fase CONFIRMACIÓN de ese code. */
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Re-entrancy guard del CONFIRMAR: `busy` es estado de React y no está actualizado dentro del mismo tick,
  // así que dos taps muy juntos podrían pasar los dos por el `if (busy)`. El ref se setea SÍNCRONAMENTE,
  // antes de cualquier await → un doble-tap escribe UNA sola vez (mismo patrón que `busyRef` de la pantalla
  // de tacto y de `agregar-evento`). El estado `busy` se conserva solo para el disabled/label del botón.
  const busyRef = useRef(false);

  // Cada APERTURA arranca limpia (el sheet se monta/desmonta, pero el estado se resetea igual por si un
  // caller lo dejara montado: el shell se ARMA al montar, este efecto no depende de eso).
  useEffect(() => {
    if (!open) return;
    setPending(null);
    setBusy(false);
    busyRef.current = false;
    setError(null);
  }, [open]);

  // Aviso de incoherencia etaria de la categoría PENDIENTE (RCM.4.3/RCM.4.4). Se recomputa solo al cambiar
  // la elección: `new Date()` acá es "ahora" — la función pura recibe el instante y ancla el día LOCAL.
  const mismatch = useMemo(
    () => (pending == null ? null : categoryAgeMismatch({ chosen: pending, sex, birthDate, isCastrated })),
    [pending, sex, birthDate, isCastrated],
  );

  const pendingName = options.find((o) => o.code === pending)?.name ?? null;
  // Nombre legible de la categoría que le correspondería POR EDAD. Si no resuelve en el catálogo ofrecido,
  // el aviso DEGRADA a nombrar solo la edad (RCM.4.6) — nunca se muestra un `code` crudo.
  const expectedName = mismatch ? (options.find((o) => o.code === mismatch.expectedCode)?.name ?? null) : null;
  const ageLabel = mismatch ? formatAnimalAge(birthDate) : null;

  const effect = pending == null
    ? null
    : resolveCategoryPinEffect({ chosen: pending, currentCode, currentOverride, derivedCode });

  if (!open) return null;

  const onPickOption = (code: string) => {
    setError(null);
    // RCM.3.4 — elegir lo que ya está vigente, sin cambio de `override` que aplicar: no-op. Cerramos sin
    // escribir y sin pedir una confirmación que no confirmaría nada.
    if (resolveCategoryPinEffect({ chosen: code, currentCode, currentOverride, derivedCode }) === 'noop') {
      onClose();
      return;
    }
    setPending(code);
  };

  const onPressConfirm = async () => {
    if (busyRef.current || pending == null) return;
    busyRef.current = true; // ANTES de cualquier await (anti doble-tap)
    setBusy(true);
    setError(null);
    const r = await onConfirm(pending);
    if (!r.ok) {
      busyRef.current = false; // liberamos para reintentar
      setBusy(false);
      setError(r.error ?? 'No se pudo cambiar la categoría.');
      return;
    }
    // En éxito el caller cierra el sheet (desmonta el shell); no reseteamos `busy` para no parpadear.
  };

  return (
    <BottomSheetShell
      title={pending == null ? 'Elegir categoría' : 'Confirmar categoría'}
      onClose={onClose}
      testID="category-sheet"
      scrimTestID="category-sheet-scrim"
      contentGap="$2"
      // Footer FIJO: en la lista, solo la salida secundaria (el tap en una fila es la acción primaria);
      // en la confirmación, el par Cancelar / Confirmar (RCM.3.3).
      footer={
        pending != null ? (
          <Button variant="primary" fullWidth disabled={busy} onPress={() => void onPressConfirm()}>
            {busy ? 'Guardando…' : 'Confirmar'}
          </Button>
        ) : undefined
      }
      secondaryFooter={
        <View
          testID={pending == null ? 'category-sheet-cerrar' : 'category-sheet-cancelar'}
          minHeight="$touchMin"
          alignItems="center"
          justifyContent="center"
          pressStyle={{ opacity: 0.6 }}
          // En la CONFIRMACIÓN, "Cancelar" vuelve a la LISTA (el paso anterior), no cierra: cerrar del todo
          // ya está en la X / el scrim / el arrastre / el back. Así el operario que se equivocó de fila no
          // tiene que reabrir el sheet.
          onPress={() => {
            if (busy) return;
            if (pending != null) {
              setPending(null);
              setError(null);
              return;
            }
            onClose();
          }}
          {...buttonA11y(Platform.OS, { label: pending == null ? 'Cerrar' : 'Cancelar' })}
        >
          <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textMuted" numberOfLines={1}>
            {pending == null ? 'Cerrar' : 'Cancelar'}
          </Text>
        </View>
      }
    >
      {pending == null ? (
        <>
          {options.map((opt) => (
            <CategoryOption
              key={opt.code}
              testID={`category-option-${opt.code}`}
              name={opt.name}
              selected={opt.code === currentCode}
              onPress={() => onPickOption(opt.code)}
            />
          ))}
          {options.length === 0 ? (
            <Text
              fontFamily="$body"
              fontSize="$3"
              lineHeight="$3"
              fontWeight="500"
              color="$textFaint"
              numberOfLines={3}
              paddingHorizontal="$2"
              paddingTop="$1"
            >
              Las categorías de este rodeo todavía no se descargaron. Conectate un momento y volvé a
              intentar.
            </Text>
          ) : null}
        </>
      ) : (
        <YStack gap="$3" testID="category-sheet-confirm">
          {/* La PREGUNTA, nombrando la categoría elegida (RCM.4.1). */}
          <Text
            fontFamily="$body"
            fontSize="$6"
            lineHeight="$6"
            fontWeight="700"
            color="$textPrimary"
            testID="category-confirm-question"
          >
            {effect === 'unpin'
              ? `¿Volver la categoría a ${pendingName ?? 'la automática'}?`
              : `¿Fijar la categoría en ${pendingName ?? 'la elegida'}?`}
          </Text>

          {/* AVISO de incoherencia con la edad (RCM.4.4). NO bloquea: Confirmar sigue habilitado (C1.2).
              Ámbar (el token de "ojo con esto"), no terracota: no es un error, es un dato raro. */}
          {mismatch && ageLabel ? (
            <XStack
              testID="category-age-warning"
              gap="$2"
              alignItems="flex-start"
              backgroundColor="$cutBg"
              borderRadius="$card"
              paddingHorizontal="$3"
              paddingVertical="$3"
              {...labelA11y(
                Platform.OS,
                expectedName
                  ? `Atención: el animal tiene ${ageLabel}. Por edad le corresponde ${expectedName}.`
                  : `Atención: el animal tiene ${ageLabel}.`,
              )}
            >
              <TriangleAlert
                size={getTokenValue('$navIcon', 'size')}
                color={getTokenValue('$cutText', 'color')}
                strokeWidth={2.5}
              />
              <Text
                flex={1}
                minWidth={0}
                fontFamily="$body"
                fontSize="$4"
                lineHeight="$4"
                fontWeight="600"
                color="$cutText"
              >
                {expectedName
                  ? `El animal tiene ${ageLabel}. Por edad le corresponde ${expectedName}.`
                  : `El animal tiene ${ageLabel}, que no coincide con esa categoría.`}
              </Text>
            </XStack>
          ) : null}

          {/* CONSECUENCIA — se muestra SIEMPRE (RCM.4.2), con el texto del efecto real (RCM.5.3). No promete
              nada sobre el historial: el nodo `category_change` lo escribe el server al subir (RCM.8.4). */}
          <Text
            testID="category-confirm-consequence"
            fontFamily="$body"
            fontSize="$4"
            lineHeight="$4"
            fontWeight="500"
            color="$textMuted"
          >
            {effect === 'unpin'
              ? 'La categoría vuelve a actualizarse sola: el sistema la va a recalcular por la edad y por los eventos que cargues.'
              : 'La categoría queda fijada a mano: deja de actualizarse sola, ni por la edad ni por los eventos (parto, tacto, destete, castración). Podés quitar la fijación cuando quieras.'}
          </Text>

          {error ? <FormError message={error} /> : null}
        </YStack>
      )}
    </BottomSheetShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// OPCIÓN de categoría — fila tappable: NOMBRE + check si es la vigente. Alto ≥ `$touchMin` (Fitts) y
// borde `$primary` en la seleccionada (RCM.2.7, mismo lenguaje que `BreedPickerSheet`).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function CategoryOption({
  name,
  selected,
  onPress,
  testID,
}: {
  name: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
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
      {...buttonA11y(Platform.OS, { label: `Categoría ${name}`, selected })}
    >
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
