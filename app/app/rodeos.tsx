// app/rodeos.tsx — RodeosScreen: gestión de rodeos del campo activo (spec 02 frontend, C1 / T4.3).
//
// Accesible desde "Más" (sección "Campo activo"). Owner gestiona; field_operator/veterinarian ven
// la lista read-only (R2.3).
//   - Lista de rodeos ACTIVOS del establishment activo (nombre + estado). El conteo de animales se
//     difiere (C2 trae animales; mostrar 0 a ciegas hoy sería engañoso) — anotado.
//   - Owner: CTA "Crear rodeo" (→ /crear-rodeo) + por rodeo: "Editar plantilla" (→ /editar-plantilla)
//     y "Eliminar" (soft-delete con confirmación, R2.5).
//   - No-owner: lista read-only + InfoNote ("solo el dueño gestiona los rodeos").
//
// Fuente: RodeoContext (estado del rodeo activo) para reflejar cambios sin re-fetch redundante; el
// set completo de rodeos sale de RodeoContext.available cuando hay rodeos. Tras crear/eliminar,
// refreshRodeos() actualiza el contexto.
//
// Cero hardcode (ADR-023 §4): tokens + componentes de la librería. Voseo argentino.

import { useCallback, useRef, useState } from 'react';
import { Alert, Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Layers,
  Plus,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react-native';

import { Button, Card, InfoNote } from '@/components';
import { useEstablishment, useRodeo } from '@/contexts';
import { softDeleteRodeo, type Rodeo } from '@/services/rodeos';
import { describeServicePeriod } from '@/utils/service-months';
import { buttonA11y } from '@/utils/a11y';

const OFFLINE_COPY = 'Necesitás conexión para esto. Conectate a internet y volvé a intentar.';

export default function RodeosScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state: estState } = useEstablishment();
  const { state: rodeoState, refreshRodeos } = useRodeo();

  const isOwner = estState.status === 'active' && estState.role === 'owner';
  // Importar rodeo: owner + veterinario (R2.4 spec 12). field_operator NO (el RPC ya lo bloquea a
  // nivel DB; esto es la barrera de UX). El wizard /import-rodeo re-valida el rol adentro.
  const canImport =
    estState.status === 'active' &&
    (estState.role === 'owner' || estState.role === 'veterinarian');
  const hasRodeos = rodeoState.status === 'active' && rodeoState.available.length > 0;
  const muted = getTokenValue('$textMuted', 'color');
  const primary = getTokenValue('$primary', 'color');
  const terracota = getTokenValue('$terracota', 'color');

  // El set de rodeos viene del RodeoContext (ya cargado, scope del campo activo).
  const rodeos: Rodeo[] = rodeoState.status === 'active' ? rodeoState.available : [];
  const activeRodeoId = rodeoState.status === 'active' ? rodeoState.current.id : null;

  // Re-entrancy guard del soft-delete (un doble-tap no dispara dos borrados).
  const busyRef = useRef(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Refrescamos al enfocar (volver del wizard / editar plantilla) para reflejar altas/cambios.
  useFocusEffect(
    useCallback(() => {
      void refreshRodeos();
    }, [refreshRodeos]),
  );

  const onDeleteRodeo = useCallback(
    async (rodeo: Rodeo) => {
      if (busyRef.current) return;
      // No permitimos quedarse sin rodeos desde acá: si es el único, avisamos (el bloqueo total
      // del RootGate volvería al wizard; mejor que el usuario lo entienda).
      if (rodeos.length <= 1) {
        Alert.alert(
          'No se puede eliminar',
          'Es el único rodeo del campo. Creá otro antes de eliminar este (sin rodeos no podés cargar animales).',
        );
        return;
      }
      busyRef.current = true;
      const confirmed = await confirmDestructive(
        'Eliminar rodeo',
        `Vas a eliminar "${rodeo.name}". Esta acción no se puede deshacer. ¿Eliminarlo?`,
        'Eliminar',
      );
      if (!confirmed) {
        busyRef.current = false;
        return;
      }
      setDeletingId(rodeo.id);
      const result = await softDeleteRodeo(rodeo.id);
      setDeletingId(null);
      busyRef.current = false;
      if (!result.ok) {
        Alert.alert(
          'No se pudo eliminar',
          result.error.kind === 'network' ? OFFLINE_COPY : result.error.message,
        );
        return;
      }
      await refreshRodeos();
    },
    [rodeos.length, refreshRodeos],
  );

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      {/* Header con back (pantalla pusheable desde "Más"). */}
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" gap="$2" paddingVertical="$3">
          <Pressable
            hitSlop={8}
            onPress={() => router.back()}
            {...buttonA11y(Platform.OS, { label: 'Volver' })}
          >
            <ChevronLeft size={28} color={muted} strokeWidth={2} />
          </Pressable>
          <Text fontFamily="$body" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary">
            Rodeos
          </Text>
        </XStack>
      </YStack>

      <ScrollView
        flex={1}
        width="100%"
        maxWidth="100%"
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          paddingBottom: insets.bottom + getTokenValue('$6', 'space'),
          width: '100%',
          maxWidth: '100%',
        }}
        showsHorizontalScrollIndicator={false}
      >
        {rodeoState.status === 'loading' ? (
          <InfoNote>Cargando rodeos…</InfoNote>
        ) : rodeos.length === 0 ? (
          <InfoNote>Este campo todavía no tiene rodeos.</InfoNote>
        ) : (
          <YStack gap="$3" marginTop="$2">
            {rodeos.map((r) => (
              <RodeoCard
                key={r.id}
                rodeo={r}
                isActive={r.id === activeRodeoId}
                isOwner={isOwner}
                deleting={deletingId === r.id}
                primary={primary}
                muted={muted}
                terracota={terracota}
                onEditTemplate={() =>
                  router.push({ pathname: '/editar-plantilla', params: { rodeoId: r.id, name: r.name } })
                }
                onEditService={() =>
                  router.push({ pathname: '/editar-servicio', params: { rodeoId: r.id, name: r.name } })
                }
                onDelete={() => void onDeleteRodeo(r)}
              />
            ))}
          </YStack>
        )}

        {/* CTA crear (owner-only, R2.3). */}
        {isOwner ? (
          <YStack marginTop="$5">
            <Button variant="primary" fullWidth onPress={() => router.push('/crear-rodeo')}>
              Crear rodeo
            </Button>
          </YStack>
        ) : (
          <YStack marginTop="$5">
            <InfoNote>
              Solo el dueño del campo puede crear o editar rodeos. Vos sos miembro de este campo.
            </InfoNote>
          </YStack>
        )}

        {/* CTA importar rodeo (owner/vet, R1.1/R2.4 spec 12). Re-ejecutable. Solo con ≥1 rodeo
            (el wizard también bloquea sin rodeo, R1.4; acá ni lo ofrecemos para no confundir).
            Fila de acción icono+texto (el Button canónico es solo-texto; este patrón es el mismo
            de las acciones de RodeoCard — manga-friendly, $touchMin). */}
        {canImport && hasRodeos ? (
          <YStack marginTop="$3">
            <Pressable
              onPress={() => router.push('/import-rodeo')}
              {...buttonA11y(Platform.OS, { label: 'Importar rodeo desde un archivo' })}
            >
              <XStack
                alignItems="center"
                gap="$3"
                minHeight="$touchMin"
                paddingHorizontal="$4"
                borderRadius="$pill"
                borderWidth={2}
                borderColor="$primary"
                pressStyle={{ backgroundColor: '$surface' }}
              >
                <Upload size={20} color={primary} strokeWidth={2} />
                <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$primary">
                  Importar rodeo
                </Text>
              </XStack>
            </Pressable>
          </YStack>
        ) : null}

        {/* Lotes (spec 02 C4, ADR-020, D2: la gestión de lotes vive JUNTO a Rodeos). Visible a
            TODOS los roles: la lista es read-only para no-owners (la gestión es owner-only adentro);
            asignar animales a un lote (cualquier rol) pasa por la ficha. Separador + fila de acción
            icono+texto, mismo patrón que "Importar rodeo". */}
        <View height={1} backgroundColor="$divider" marginVertical="$4" />
        <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted" marginBottom="$2">
          Otros grupos del campo
        </Text>
        <Pressable
          onPress={() => router.push('/lotes')}
          {...buttonA11y(Platform.OS, { label: 'Ver y gestionar los lotes del campo' })}
        >
          <XStack
            alignItems="center"
            gap="$3"
            minHeight="$touchMin"
            paddingHorizontal="$4"
            borderRadius="$pill"
            borderWidth={2}
            borderColor="$primary"
            pressStyle={{ backgroundColor: '$surface' }}
          >
            <Layers size={20} color={primary} strokeWidth={2} />
            <Text flex={1} minWidth={0} fontFamily="$body" fontSize="$5" fontWeight="600" color="$primary">
              Lotes
            </Text>
            <ChevronRight size={20} color={muted} strokeWidth={2} />
          </XStack>
        </Pressable>
      </ScrollView>
    </YStack>
  );
}

// ─── Card de un rodeo ──────────────────────────────────────────────────────────

function RodeoCard({
  rodeo,
  isActive,
  isOwner,
  deleting,
  primary,
  muted,
  terracota,
  onEditTemplate,
  onEditService,
  onDelete,
}: {
  rodeo: Rodeo;
  isActive: boolean;
  isOwner: boolean;
  deleting: boolean;
  primary: string;
  muted: string;
  terracota: string;
  onEditTemplate: () => void;
  onEditService: () => void;
  onDelete: () => void;
}) {
  // spec 03 Stream B / B1: descripción es-AR del período de servicio (RPSC.3.1/RPSC.3.2). null = "sin
  // configurar"; [] = "no hace servicio"; un run = "Oct → Dic". El array ya viene parseado tolerante (RPSC.3.7).
  const servicePeriod = describeServicePeriod(rodeo.serviceMonths);
  return (
    <Card gap="$3">
      <XStack alignItems="center" gap="$2">
        <Text flex={1} minWidth={0} numberOfLines={1} fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary">
          {rodeo.name}
        </Text>
        {isActive ? (
          <XStack alignItems="center" gap="$1" flexShrink={0}>
            <View width="$dot" height="$dot" borderRadius="$pill" backgroundColor="$primary" />
            <Text fontFamily="$body" fontSize="$2" fontWeight="600" color="$primary">
              Activo
            </Text>
          </XStack>
        ) : null}
      </XStack>

      {isOwner ? (
        <YStack gap="$2">
          <Pressable
            onPress={onEditTemplate}
            {...buttonA11y(Platform.OS, {
              label: `Editar la plantilla de datos de ${rodeo.name}`,
            })}
          >
            <XStack
              alignItems="center"
              gap="$3"
              minHeight="$chipMin"
              pressStyle={{ opacity: 0.6 }}
            >
              <SlidersHorizontal size={20} color={primary} strokeWidth={2} />
              <Text flex={1} minWidth={0} fontFamily="$body" fontSize="$4" fontWeight="500" color="$textPrimary">
                Editar plantilla de datos
              </Text>
              <ChevronRight size={20} color={muted} strokeWidth={2} />
            </XStack>
          </Pressable>
          <View height={1} backgroundColor="$divider" />
          {/* Meses de servicio (spec 03 Stream B / B1, RPSC.3.1): ver/editar la campaña reproductiva del
              rodeo. El subtexto muestra el período actual ("Oct → Dic" / "Sin configurar" / "No hace servicio").
              Mostrarlo NO depende del rol (la edición sí es owner-only, dentro de este bloque owner). */}
          <Pressable
            onPress={onEditService}
            {...buttonA11y(Platform.OS, {
              label: `Editar los meses de servicio de ${rodeo.name}. Actualmente: ${servicePeriod.text}`,
            })}
          >
            <XStack alignItems="center" gap="$3" minHeight="$chipMin" pressStyle={{ opacity: 0.6 }}>
              <CalendarRange size={20} color={primary} strokeWidth={2} />
              <YStack flex={1} minWidth={0}>
                <Text numberOfLines={1} fontFamily="$body" fontSize="$4" fontWeight="500" color="$textPrimary">
                  Meses de servicio
                </Text>
                <Text numberOfLines={1} fontFamily="$body" fontSize="$2" fontWeight="500" color="$textMuted">
                  {servicePeriod.text}
                </Text>
              </YStack>
              <ChevronRight size={20} color={muted} strokeWidth={2} />
            </XStack>
          </Pressable>
          <View height={1} backgroundColor="$divider" />
          <Pressable
            disabled={deleting}
            onPress={onDelete}
            {...buttonA11y(Platform.OS, {
              label: `Eliminar el rodeo ${rodeo.name} (acción destructiva)`,
              disabled: deleting,
            })}
          >
            <XStack
              alignItems="center"
              gap="$3"
              minHeight="$chipMin"
              opacity={deleting ? 0.5 : 1}
              pressStyle={{ opacity: 0.6 }}
            >
              <Trash2 size={20} color={terracota} strokeWidth={2} />
              <Text fontFamily="$body" fontSize="$4" fontWeight="500" color="$terracota">
                {deleting ? 'Eliminando…' : 'Eliminar rodeo'}
              </Text>
            </XStack>
          </Pressable>
        </YStack>
      ) : null}
    </Card>
  );
}

/**
 * Confirmación destructiva multiplataforma (mismo helper que mas.tsx). Native: Alert con botones;
 * web: window.confirm (el testing de Raf es en web). Devuelve true si confirmó.
 */
function confirmDestructive(title: string, message: string, confirmLabel: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    const ok =
      typeof globalThis !== 'undefined' && typeof (globalThis as { confirm?: unknown }).confirm === 'function'
        ? (globalThis as { confirm: (m?: string) => boolean }).confirm(`${title}\n\n${message}`)
        : false;
    return Promise.resolve(ok);
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}
