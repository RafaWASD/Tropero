// IdentifierAssignRow — afordancia INLINE para ASIGNAR un identificador vacío (NULL→valor) desde la sección
// "Identificación" de la ficha (delta spec 02 caravana-ficha, RCF.1/RCF.2/RCF.3/RCF.4).
//
// Una fila por identificador VACÍO (caravana electrónica `tag` | caravana visual `idv`). Patrón:
//   colapsada  → label muted (rima con los AttributeRow vecinos) + CTA "Agregar caravana …" (Plus + primary,
//                target ≥ $touchMin → Fitts, manga-friendly, una sola decisión por afordancia, RCF.4.2).
//   expandida  → FormField numérico (sanitiza en vivo) + Confirmar/Cancelar (espejo inline de CutRow).
//                Validación INLINE: borde rojo + mensaje en el propio campo (FormField `error`), sin banner
//                global que tape el título (RCF.4.3). El campo queda en vista al expandirse → el MUST de
//                "scroll-al-campo en validación" se satisface trivialmente.
//
// Agnóstico del contenedor (el contrato `onConfirm`/`validate` no cambia si en review se prefiere un sheet,
// design §2). Cero hardcode (tokens + getTokenValue para el ícono lucide); a11y por los helpers de utils/a11y;
// el CTA "Agregar caravana …" tiene descendente (g) → lineHeight matcheando el fontSize (RCF.4.4). Toda la
// copy en español (voseo). La validación semántica (15 díg / no-vacío / dup) la inyecta el host vía `validate`
// + `onConfirm`; este componente NO conoce el dominio (es presentación pura + estado de UI).

import { useCallback, useState } from 'react';
import { Platform, Pressable, type TextInputProps } from 'react-native';
import { getTokenValue, Text, XStack, YStack } from 'tamagui';
import { Plus } from 'lucide-react-native';

import { Button } from './Button';
import { FormField } from './FormField';
import { buttonA11y } from '@/utils/a11y';

export type IdentifierAssignRowProps = {
  /** Qué identificador asigna esta fila: caravana electrónica (`tag`) o caravana visual (`idv`). */
  kind: 'tag' | 'idv';
  /** Label muted de la fila + label del FormField al expandir (ej. "Caravana electrónica" / "Caravana visual"). */
  label: string;
  /** Placeholder del input al expandir. */
  placeholder?: string;
  /** Teclado del input (number-pad para identificadores de máquina, RCF.4.5). */
  keyboardType?: TextInputProps['keyboardType'];
  /** Sanitiza la entrada EN VIVO (solo dígitos + tope de largo). Se aplica en cada onChangeText. */
  sanitize: (raw: string) => string;
  /** Tope nativo de caracteres tipeables (belt-and-suspenders del sanitize). Opcional. */
  maxLength?: number;
  /**
   * Validación al CONFIRMAR: devuelve el mensaje de error es-AR si el valor no es válido, o null si lo es.
   * (15 díg para tag, no-vacío para idv — RCF.2.2/RCF.3.2). Si devuelve error, NO se llama onConfirm.
   */
  validate: (value: string) => string | null;
  /**
   * Ejecuta la asignación (encolar RPC del tag / UPDATE local del idv + pre-check de dup). Devuelve ok=false
   * con un mensaje accionable si falla (dup / encolado / write) → se muestra inline y la afordancia queda
   * abierta para reintentar (RCF.2.6/RCF.3.6).
   */
  onConfirm: (value: string) => Promise<{ ok: boolean; error?: string }>;
};

export function IdentifierAssignRow({
  kind,
  label,
  placeholder,
  keyboardType = 'number-pad',
  sanitize,
  maxLength,
  validate,
  onConfirm,
}: IdentifierAssignRowProps) {
  const primary = getTokenValue('$primary', 'color');
  const [expanded, setExpanded] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // CTA derivada del tipo (RCF.1.1/RCF.1.3) — la copy exacta del context #1.
  const ctaLabel = kind === 'tag' ? 'Agregar caravana electrónica' : 'Agregar caravana visual';

  const startAssign = useCallback(() => {
    setExpanded(true);
    setValue('');
    setError(null);
  }, []);

  const cancel = useCallback(() => {
    setExpanded(false);
    setValue('');
    setError(null);
  }, []);

  const handleChange = useCallback(
    (raw: string) => {
      setValue(sanitize(raw));
      // Limpiamos el error al re-tipear (el campo deja de estar "en rojo" mientras corrige).
      if (error) setError(null);
    },
    [sanitize, error],
  );

  const handleConfirm = useCallback(async () => {
    if (busy) return;
    // 1) Validación de FORMA (15 díg / no-vacío) — inline, sin invocar nada (RCF.2.2/RCF.3.2).
    const validationError = validate(value);
    if (validationError) {
      setError(validationError);
      return;
    }
    // 2) Asignación real (dup pre-check + encolar/UPDATE). El optimismo en sitio lo hace el host.
    setBusy(true);
    setError(null);
    const r = await onConfirm(value);
    setBusy(false);
    if (!r.ok) {
      // Error accionable inline; la afordancia queda ABIERTA para reintentar (RCF.2.6/RCF.3.6).
      setError(r.error ?? 'No se pudo guardar el cambio.');
      return;
    }
    // Éxito: el host ya reflejó el valor con optimismo en sitio → al re-render la fila pasa a solo-lectura
    // (canAssign* deja de ofrecerla). Cerramos por las dudas (si el padre no desmontara de inmediato).
    setExpanded(false);
    setValue('');
  }, [busy, validate, value, onConfirm]);

  // ── Colapsada: label muted (rima con los AttributeRow) + CTA "Agregar caravana …". ──
  if (!expanded) {
    return (
      <YStack gap="$1">
        <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
          {label}
        </Text>
        <XStack
          testID={`assign-${kind}-cta`}
          minHeight="$touchMin"
          alignItems="center"
          gap="$2"
          alignSelf="flex-start"
          pressStyle={{ opacity: 0.6 }}
          onPress={startAssign}
          {...buttonA11y(Platform.OS, { label: ctaLabel })}
        >
          <Plus size={18} color={primary} strokeWidth={2.5} />
          <Text
            fontFamily="$body"
            fontSize="$5"
            lineHeight="$5"
            fontWeight="700"
            color="$primary"
            numberOfLines={1}
          >
            {ctaLabel}
          </Text>
        </XStack>
      </YStack>
    );
  }

  // ── Expandida: FormField numérico (sanitiza en vivo + error inline) + Confirmar/Cancelar. ──
  return (
    <YStack gap="$3">
      <FormField
        label={label}
        value={value}
        onChangeText={handleChange}
        error={error}
        placeholder={placeholder}
        keyboardType={keyboardType}
        maxLength={maxLength}
        autoCapitalize="none"
        returnKeyType="done"
        onSubmitEditing={() => void handleConfirm()}
      />
      <XStack gap="$2">
        <YStack flex={1}>
          <Button variant="secondary" fullWidth disabled={busy} onPress={cancel}>
            Cancelar
          </Button>
        </YStack>
        <YStack flex={1}>
          <Button
            testID={`assign-${kind}-confirm`}
            variant="primary"
            fullWidth
            disabled={busy}
            onPress={() => void handleConfirm()}
          >
            {busy ? 'Guardando…' : 'Confirmar'}
          </Button>
        </YStack>
      </XStack>
    </YStack>
  );
}
