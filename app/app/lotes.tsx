// app/lotes.tsx — LotesScreen: gestión de lotes del campo activo (spec 02 frontend, C4 / T3.7).
//
// Lote = tercer eje de organización (ADR-020): agrupación de manejo libre, scope establishment
// (cruza rodeos), exclusiva + nullable + manual. La gestión (crear/renombrar/borrar) vive JUNTO a
// Rodeos (D2 del context-c4-lotes: "configuro los grupos de mi campo"). La asignación día-a-día
// pasa por la ficha del animal (no hace falta entrar acá).
//
// Anatomía:
//   - Lista de lotes ACTIVOS del establishment activo. Owner: por lote, renombrar (inline) + borrar
//     (con confirmación destructiva, copy D1). Tap en un lote → ver sus miembros (lista de animales
//     activos reusando AnimalRow de C2).
//   - Owner: CTA "Crear lote" (form inline). No-owner: lista read-only + InfoNote (la RLS es la
//     barrera autoritativa; la UI solo evita ofrecer botones muertos).
//
// Multi-tenant (CLAUDE.md ppio 6): NUNCA se hardcodea establishment_id — viene del contexto activo.
// Online-first (C5 = PowerSync). Cero hardcode (ADR-023 §4): tokens + componentes; íconos lucide con
// getTokenValue. a11y por helper (utils/a11y). Voseo es-AR.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react-native';

import { AnimalRow, Button, Card, FormError, FormField, InfoNote } from '@/components';
import { LoteIcon } from '@/theme/icons';
import { useEstablishment } from '@/contexts';
import {
  createManagementGroup,
  fetchGroupMembers,
  fetchManagementGroups,
  renameManagementGroup,
  softDeleteManagementGroup,
  type ManagementGroup,
} from '@/services/management-groups';
import type { AnimalListItem } from '@/services/animals';
import { canManageGroups, validateGroupName } from '@/utils/management-group';
import { hasDuplicateName } from '@/utils/establishment';
import { buttonA11y } from '@/utils/a11y';
import { backOr } from '@/utils/nav';

const OFFLINE_COPY = 'Necesitás conexión para esto. Conectate a internet y volvé a intentar.';

export default function LotesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state: estState } = useEstablishment();

  const establishmentId = estState.status === 'active' ? estState.current.id : null;
  const role = estState.status === 'active' ? estState.role : null;
  const isOwner = canManageGroups(role);

  const muted = getTokenValue('$textMuted', 'color');

  // `groups === null` = todavía no cargó (carga inicial: el blank "Cargando lotes…" se permite). Una vez
  // cargado, las acciones (crear/renombrar/borrar) mutan el array EN SITIO de forma optimista y reconcilian
  // con un refresh SILENCIOSO — nunca volvemos a `null` ni toggleamos `loading` (que blanquearía + resetearía
  // el scroll). Misma receta que `animal/[id].tsx` (load({silent}) + patch optimista + revert-si-falla).
  const [groups, setGroups] = useState<ManagementGroup[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Crear (form inline, owner-only).
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [submittingCreate, setSubmittingCreate] = useState(false);

  // Renombrar / borrar — id en curso (para mostrar el estado por fila).
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Ver miembros — id del lote expandido (acordeón: uno a la vez).
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Re-entrancy guard del borrado (un doble-tap no dispara dos).
  const busyRef = useRef(false);

  // `load` distingue CARGA INICIAL (puede blanquear: setea `loading`, que desmonta la lista y resetea el
  // scroll al tope) de REFRESH SILENCIOSO post-acción (`silent: true` — NO toca `loading`: la lista queda
  // montada, el scroll se mantiene). Las acciones de la pantalla (crear/renombrar/borrar lote) aplican el
  // cambio OPTIMISTA en sitio y luego reconcilian con `load({ silent: true })`, sin el parpadeo en blanco.
  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    const silent = opts.silent === true;
    if (!establishmentId) {
      setGroups([]);
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    setError(null);
    const r = await fetchManagementGroups(establishmentId);
    if (!silent) setLoading(false);
    if (!r.ok) {
      // En un refresh SILENCIOSO un fallo transitorio NO debe volar la lista ya montada (el cambio optimista
      // ya está reflejado); conservamos el estado actual y salimos. En la carga inicial sí mostramos el error.
      if (!silent) {
        setError(
          r.error.kind === 'network' ? 'Sin conexión: no pudimos cargar los lotes.' : 'No pudimos cargar los lotes.',
        );
        setGroups([]);
      }
      return;
    }
    setGroups(r.value);
  }, [establishmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Crear lote (owner) ──
  const dupWarning =
    newName.trim().length > 0 && hasDuplicateName(newName, groups ?? [])
      ? `Ya tenés un lote llamado «${newName.trim()}». Podés crearlo igual.`
      : null;

  const onSubmitCreate = useCallback(async () => {
    if (!establishmentId || submittingCreate) return;
    const valid = validateGroupName(newName);
    if (!valid.ok) {
      setCreateError(valid.error);
      return;
    }
    setSubmittingCreate(true);
    setCreateError(null);
    const r = await createManagementGroup(establishmentId, valid.value);
    setSubmittingCreate(false);
    if (!r.ok) {
      setCreateError(r.error.kind === 'network' ? OFFLINE_COPY : r.error.message);
      return;
    }
    // OPTIMISMO EN SITIO: agregamos el lote nuevo al final SIN blanquear la pantalla ni resetear el scroll.
    // createManagementGroup devuelve el id REAL (uuid de cliente, ya en SQLite local) + el nombre → no hace
    // falta re-leer para reconciliar el id (el create no falla en este punto: el return ya fue ok).
    setGroups((prev) => [...(prev ?? []), r.value]);
    setNewName('');
    setCreating(false);
  }, [establishmentId, newName, submittingCreate]);

  // ── Borrar lote (owner) — confirmación destructiva con copy D1 ──
  const onDelete = useCallback(
    async (group: ManagementGroup) => {
      if (busyRef.current) return;
      busyRef.current = true;
      // Contamos los miembros activos para el copy "sus N animales quedan sin lote" (D1).
      let count = 0;
      if (establishmentId) {
        const members = await fetchGroupMembers(establishmentId, group.id);
        if (members.ok) count = members.value.length;
      }
      const animalsPhrase =
        count === 0
          ? 'No tiene animales asignados.'
          : count === 1
            ? 'Su 1 animal queda sin lote (se agrupa por categoría).'
            : `Sus ${count} animales quedan sin lote (se agrupan por categoría).`;
      const confirmed = await confirmDestructive(
        'Eliminar lote',
        `Vas a borrar el lote «${group.name}». ${animalsPhrase}`,
        'Eliminar',
      );
      if (!confirmed) {
        busyRef.current = false;
        return;
      }
      setDeletingId(group.id);
      // OPTIMISMO EN SITIO: sacamos el lote de la lista YA (sin blanquear ni resetear el scroll) + cerramos
      // su acordeón si estaba abierto. Snapshot para revertir si el write falla (raro: el soft-delete encola
      // offline, pero el clear-NULL de miembros es un write local que podría fallar).
      const snapshot = groups;
      setGroups((prev) => (prev == null ? prev : prev.filter((g) => g.id !== group.id)));
      if (expandedId === group.id) setExpandedId(null);
      const r = await softDeleteManagementGroup(group.id);
      setDeletingId(null);
      busyRef.current = false;
      if (!r.ok) {
        setGroups(snapshot); // REVERT: el lote re-aparece si el borrado fue rechazado
        Alert.alert('No se pudo eliminar', r.error.kind === 'network' ? OFFLINE_COPY : r.error.message);
        return;
      }
      // Refresh SILENCIOSO para reconciliar con el SQLite local (sin parpadeo ni salto al tope).
      void load({ silent: true });
    },
    [establishmentId, expandedId, groups, load],
  );

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      {/* Header con back (pantalla pusheable desde "Más" / Rodeos). */}
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" gap="$2" paddingVertical="$3">
          <Pressable
            hitSlop={8}
            onPress={() => backOr(router, '/rodeos')}
            {...buttonA11y(Platform.OS, { label: 'Volver' })}
          >
            <ChevronLeft size={28} color={muted} strokeWidth={2} />
          </Pressable>
          <Text fontFamily="$body" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary">
            Lotes
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
        keyboardShouldPersistTaps="handled"
      >
        {/* Explicación corta del lote (ADR-020): por qué existe, ortogonal a rodeo/categoría. */}
        <YStack marginTop="$1" marginBottom="$2">
          <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted">
            Un lote agrupa animales por manejo (ej. «Otoño 2026», «Entore 1»), cruzando rodeos. Un
            animal sin lote se agrupa por su categoría.
          </Text>
        </YStack>

        {/* Blank "Cargando lotes…" SOLO en la carga inicial (groups === null): una vez montada la lista,
            las acciones la mutan en sitio + refrescan en silencio, sin volver nunca a este placeholder. */}
        {error && groups === null ? (
          <YStack gap="$2" marginTop="$2">
            <FormError message={error} />
            <Button variant="secondary" fullWidth onPress={() => void load()}>
              Reintentar
            </Button>
          </YStack>
        ) : loading && groups === null ? (
          <InfoNote>Cargando lotes…</InfoNote>
        ) : (groups ?? []).length === 0 ? (
          <InfoNote>
            {isOwner
              ? 'Este campo todavía no tiene lotes. Creá el primero abajo.'
              : 'Este campo todavía no tiene lotes. Pedíle al dueño que cree uno.'}
          </InfoNote>
        ) : (
          <YStack gap="$3" marginTop="$2">
            {(groups ?? []).map((g) => (
              <LoteCard
                key={g.id}
                group={g}
                isOwner={isOwner}
                establishmentId={establishmentId}
                groups={groups ?? []}
                expanded={expandedId === g.id}
                onToggleExpand={() => setExpandedId((id) => (id === g.id ? null : g.id))}
                renaming={renamingId === g.id}
                onStartRename={() => setRenamingId(g.id)}
                onCancelRename={() => setRenamingId(null)}
                onRenamed={(newName) => {
                  // OPTIMISMO EN SITIO: el write ya tuvo éxito en RenameForm → actualizamos el name del item
                  // en su lugar (sin blanquear ni resetear el scroll) y cerramos el form inline. Refresh
                  // silencioso para reconciliar con el SQLite local.
                  setGroups((prev) =>
                    prev == null ? prev : prev.map((it) => (it.id === g.id ? { ...it, name: newName } : it)),
                  );
                  setRenamingId(null);
                  void load({ silent: true });
                }}
                deleting={deletingId === g.id}
                onDelete={() => void onDelete(g)}
                onOpenAnimal={(profileId) =>
                  router.push({ pathname: '/animal/[id]', params: { id: profileId } })
                }
                muted={muted}
              />
            ))}
          </YStack>
        )}

        {/* CTA crear (owner-only, RLS lo fuerza igual). Form inline al expandir. */}
        {isOwner ? (
          <YStack marginTop="$5" gap="$3">
            {creating ? (
              <Card gap="$3">
                <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$textPrimary">
                  Nuevo lote
                </Text>
                <FormField
                  label="Nombre del lote"
                  value={newName}
                  onChangeText={(t) => {
                    setNewName(t);
                    if (createError) setCreateError(null);
                  }}
                  placeholder="Ej. Otoño 2026"
                  autoCapitalize="sentences"
                />
                {dupWarning ? <InfoNote>{dupWarning}</InfoNote> : null}
                {createError ? <FormError message={createError} /> : null}
                <XStack gap="$2">
                  <YStack flex={1}>
                    <Button
                      variant="secondary"
                      fullWidth
                      onPress={() => {
                        setCreating(false);
                        setNewName('');
                        setCreateError(null);
                      }}
                    >
                      Cancelar
                    </Button>
                  </YStack>
                  <YStack flex={1}>
                    <Button
                      variant="primary"
                      fullWidth
                      disabled={submittingCreate}
                      onPress={() => void onSubmitCreate()}
                    >
                      {submittingCreate ? 'Creando…' : 'Crear lote'}
                    </Button>
                  </YStack>
                </XStack>
              </Card>
            ) : (
              <Button variant="primary" fullWidth onPress={() => setCreating(true)}>
                Crear lote
              </Button>
            )}
          </YStack>
        ) : (
          <YStack marginTop="$5">
            <InfoNote>
              Solo el dueño del campo puede crear, renombrar o borrar lotes. Vos sí podés asignar
              animales a un lote desde la ficha de cada animal.
            </InfoNote>
          </YStack>
        )}
      </ScrollView>
    </YStack>
  );
}

// ─── Card de un lote ──────────────────────────────────────────────────────────────────

function LoteCard({
  group,
  isOwner,
  establishmentId,
  groups,
  expanded,
  onToggleExpand,
  renaming,
  onStartRename,
  onCancelRename,
  onRenamed,
  deleting,
  onDelete,
  onOpenAnimal,
  muted,
}: {
  group: ManagementGroup;
  isOwner: boolean;
  establishmentId: string | null;
  groups: ManagementGroup[];
  expanded: boolean;
  onToggleExpand: () => void;
  renaming: boolean;
  onStartRename: () => void;
  onCancelRename: () => void;
  /** El write ya tuvo éxito; recibe el nombre nuevo para el patch optimista en sitio. */
  onRenamed: (newName: string) => void;
  deleting: boolean;
  onDelete: () => void;
  onOpenAnimal: (profileId: string) => void;
  muted: string;
}) {
  const primary = getTokenValue('$primary', 'color');
  const terracota = getTokenValue('$terracota', 'color');

  return (
    <Card gap="$3">
      {renaming ? (
        <RenameForm
          group={group}
          groups={groups}
          onCancel={onCancelRename}
          onRenamed={onRenamed}
        />
      ) : (
        <>
          {/* Cabecera tappable: nombre + chevron → expande/colapsa los miembros (D3). */}
          <Pressable
            onPress={onToggleExpand}
            {...buttonA11y(Platform.OS, {
              label: `Ver los animales del lote ${group.name}`,
              selected: expanded,
            })}
          >
            <XStack alignItems="center" gap="$2" minHeight="$chipMin" pressStyle={{ opacity: 0.6 }}>
              <View
                width={28}
                height={28}
                borderRadius="$pill"
                backgroundColor="$greenLight"
                alignItems="center"
                justifyContent="center"
                flexShrink={0}
              >
                <LoteIcon size={16} color={primary} strokeWidth={2.5} />
              </View>
              <Text
                flex={1}
                minWidth={0}
                numberOfLines={1}
                fontFamily="$body"
                fontSize="$6" lineHeight="$6"
                fontWeight="600"
                color="$textPrimary"
              >
                {group.name}
              </Text>
              <ChevronRight
                size={20}
                color={muted}
                strokeWidth={2}
                style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}
              />
            </XStack>
          </Pressable>

          {/* Miembros del lote (acordeón inline, D3). */}
          {expanded ? (
            <GroupMembers establishmentId={establishmentId} groupId={group.id} onOpenAnimal={onOpenAnimal} />
          ) : null}

          {/* Acciones owner: renombrar + borrar. */}
          {isOwner ? (
            <YStack gap="$2">
              <View height={1} backgroundColor="$divider" />
              <Pressable
                onPress={onStartRename}
                {...buttonA11y(Platform.OS, { label: `Renombrar el lote ${group.name}` })}
              >
                <XStack alignItems="center" gap="$3" minHeight="$chipMin" pressStyle={{ opacity: 0.6 }}>
                  <Pencil size={20} color={primary} strokeWidth={2} />
                  <Text flex={1} minWidth={0} fontFamily="$body" fontSize="$4" fontWeight="500" color="$textPrimary">
                    Renombrar
                  </Text>
                </XStack>
              </Pressable>
              <View height={1} backgroundColor="$divider" />
              <Pressable
                disabled={deleting}
                onPress={onDelete}
                {...buttonA11y(Platform.OS, {
                  label: `Eliminar el lote ${group.name} (acción destructiva)`,
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
                    {deleting ? 'Eliminando…' : 'Eliminar lote'}
                  </Text>
                </XStack>
              </Pressable>
            </YStack>
          ) : null}
        </>
      )}
    </Card>
  );
}

// ─── Form de renombrar (inline, owner) ──────────────────────────────────────────────────

function RenameForm({
  group,
  groups,
  onCancel,
  onRenamed,
}: {
  group: ManagementGroup;
  groups: ManagementGroup[];
  onCancel: () => void;
  /** El write ya tuvo éxito; recibe el nombre nuevo (validado/trimeado) para el patch optimista del padre. */
  onRenamed: (newName: string) => void;
}) {
  const [name, setName] = useState(group.name);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Duplicado: excluye el propio lote (renombrarlo a su mismo nombre NO avisa).
  const dupWarning =
    name.trim().length > 0 && hasDuplicateName(name, groups, group.id)
      ? `Ya tenés otro lote llamado «${name.trim()}». Podés renombrarlo igual.`
      : null;

  const onSubmit = useCallback(async () => {
    if (submitting) return;
    const valid = validateGroupName(name);
    if (!valid.ok) {
      setError(valid.error);
      return;
    }
    setSubmitting(true);
    setError(null);
    const r = await renameManagementGroup(group.id, valid.value);
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error.kind === 'network' ? OFFLINE_COPY : r.error.message);
      return;
    }
    // Pasamos el nombre VALIDADO/TRIMEADO (el mismo que persistió el service) para el patch optimista del padre.
    onRenamed(valid.value);
  }, [group.id, name, submitting, onRenamed]);

  return (
    <YStack gap="$3">
      <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$textPrimary">
        Renombrar lote
      </Text>
      <FormField
        label="Nombre del lote"
        value={name}
        onChangeText={(t) => {
          setName(t);
          if (error) setError(null);
        }}
        placeholder="Ej. Otoño 2026"
        autoCapitalize="sentences"
      />
      {dupWarning ? <InfoNote>{dupWarning}</InfoNote> : null}
      {error ? <FormError message={error} /> : null}
      <XStack gap="$2">
        <YStack flex={1}>
          <Button variant="secondary" fullWidth onPress={onCancel}>
            Cancelar
          </Button>
        </YStack>
        <YStack flex={1}>
          <Button variant="primary" fullWidth disabled={submitting} onPress={() => void onSubmit()}>
            {submitting ? 'Guardando…' : 'Guardar'}
          </Button>
        </YStack>
      </XStack>
    </YStack>
  );
}

// ─── Miembros del lote (ver-miembros, D3) ───────────────────────────────────────────────

function GroupMembers({
  establishmentId,
  groupId,
  onOpenAnimal,
}: {
  establishmentId: string | null;
  groupId: string;
  onOpenAnimal: (profileId: string) => void;
}) {
  const [members, setMembers] = useState<AnimalListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setMembers(null);
    setError(null);
    if (!establishmentId) {
      setError('No pudimos cargar los animales del lote.');
      return;
    }
    (async () => {
      const r = await fetchGroupMembers(establishmentId, groupId);
      if (!active) return;
      if (!r.ok) {
        setError(
          r.error.kind === 'network'
            ? 'Sin conexión: no pudimos cargar los animales.'
            : 'No pudimos cargar los animales del lote.',
        );
        return;
      }
      setMembers(r.value);
    })();
    return () => {
      active = false;
    };
  }, [establishmentId, groupId]);

  if (error) {
    return <FormError message={error} />;
  }
  if (members == null) {
    return <InfoNote>Cargando animales…</InfoNote>;
  }
  if (members.length === 0) {
    return <InfoNote>Este lote todavía no tiene animales. Asignalos desde la ficha de cada animal.</InfoNote>;
  }

  return (
    <YStack
      width="100%"
      borderRadius="$card"
      borderWidth={1}
      borderColor="$divider"
      overflow="hidden"
    >
      {members.map((a) => (
        <AnimalRow
          key={a.profileId}
          idv={a.idv ?? undefined}
          apodo={a.apodo}
          rodeoUsesApodo={a.rodeoUsesApodo}
          tagElectronic={a.tagElectronic}
          category={a.categoryName || a.categoryCode}
          sex={a.sex}
          rodeo={a.rodeoName}
          onPress={() => onOpenAnimal(a.profileId)}
        />
      ))}
    </YStack>
  );
}

/**
 * Confirmación destructiva multiplataforma (mismo helper que rodeos.tsx / mas.tsx). Native: Alert
 * con botones; web: window.confirm (el testing de Raf es en web). Devuelve true si confirmó.
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
