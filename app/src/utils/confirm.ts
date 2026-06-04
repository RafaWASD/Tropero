// Confirmación multiplataforma para acciones que requieren un "¿seguro?" antes de proceder.
//
// Patrón ya usado en la app (mas.tsx#confirmDestructive): en native usamos Alert.alert con botones
// accionables (cancel + acción); en web (react-native-web) Alert.alert NO renderiza botones
// accionables, así que usamos window.confirm (síncrono, pero lo envolvemos en una promesa para una
// sola firma). El testing de Raf y la suite E2E corren en WEB → el camino web es el que importa.
//
// `confirmAction` generaliza ese helper a confirmaciones SUAVES (informativas, no destructivas): el
// aviso de "esta hembra no figura preñada, ¿registrar el parto igual?" es un confirm, no un error
// terracota. `destructive` (default false) solo afecta el estilo del botón en NATIVE (style:
// 'destructive' = rojo iOS); en web window.confirm no tiene estilos, el tono lo da el copy.

import { Alert, Platform } from 'react-native';

export type ConfirmActionOptions = {
  /** Título del diálogo (en web se antepone al mensaje, separado por un salto de línea doble). */
  title: string;
  /** Cuerpo del diálogo: la pregunta concreta (es-AR voseo). */
  message: string;
  /** Texto del botón que PROCEDE con la acción. Ej. "Registrar igual". */
  confirmLabel: string;
  /** Texto del botón que cancela. Default "Cancelar". */
  cancelLabel?: string;
  /** ¿Estilo destructivo del botón de acción en native? Default false (confirmación suave). */
  destructive?: boolean;
};

/**
 * Muestra una confirmación y resuelve `true` si el usuario confirmó, `false` si canceló (o si no hay
 * un mecanismo de confirm disponible, ej. SSR/headless — fail-closed: NO procede sin confirmación).
 */
export function confirmAction(opts: ConfirmActionOptions): Promise<boolean> {
  const cancelLabel = opts.cancelLabel ?? 'Cancelar';
  if (Platform.OS === 'web') {
    // window.confirm: bloqueante pero confiable en web. typeof guard por SSR/headless (sin window →
    // false: no procedemos sin confirmación explícita).
    const hasConfirm =
      typeof globalThis !== 'undefined' &&
      typeof (globalThis as { confirm?: unknown }).confirm === 'function';
    const ok = hasConfirm
      ? (globalThis as { confirm: (m?: string) => boolean }).confirm(`${opts.title}\n\n${opts.message}`)
      : false;
    return Promise.resolve(ok);
  }
  return new Promise((resolve) => {
    Alert.alert(opts.title, opts.message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      {
        text: opts.confirmLabel,
        style: opts.destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
  });
}
