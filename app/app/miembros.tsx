// app/miembros.tsx — pantalla "Equipo" / Miembros (spec 01, Fase 5 / T5.1/T5.3/T5.5/T5.6).
//
// Ruta standalone (fuera de (tabs)) que gestiona el equipo del CAMPO ACTIVO:
//   - Lista de miembros activos (nombre + rol + marcador "vos"). T5.1 / R5.1.
//   - Owner: botón "Invitar" (→ /invitar, T5.2) + por fila "Cambiar rol" (T5.5) / "Remover" (T5.6),
//     NUNCA sobre sí mismo ni sobre el único owner.
//   - Owner: sección "Invitaciones pendientes" (T5.3 / R5.12) con Copiar/Compartir/Regenerar/Cancelar.
//   - No-owner: vista mínima — solo SU propia membresía + nota "Solo el dueño gestiona el equipo".
//
// HALLAZGO RLS #1 (owner-céntrico, no es bug): la policy user_roles_select (0008) deja al OWNER ver
// TODAS las filas de su campo; un NO-OWNER solo ve la SUYA. Por eso loadMembers le devuelve la lista
// completa al owner y {solo la suya} al no-owner — la pantalla se adapta a eso (no forzamos la lista
// completa para no-owner; sería un delta backend). HALLAZGO #2: el email del miembro NO se muestra
// (loadMembers solo trae id+name). HALLAZGO #3: el invitado no previsualiza la invitación (owner-only).
//
// 🟡 pantalla mixta (oficina + campo): filas ≥ $touchMin, targets grandes, voseo. Cero hardcode
// (ADR-023 §4): tokens; lo que cruza a lucide se lee con getTokenValue. confirmDestructive espeja el
// patrón de mas.tsx (window.confirm en web / Alert en native) — el testing de Raf es en web.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Platform, Pressable, Share } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import {
  ArrowLeft,
  Copy,
  MoreVertical,
  RefreshCw,
  Share2,
  UserPlus,
  X,
} from 'lucide-react-native';

import { Button, Card, FormError, InfoNote, RoleBadge } from '@/components';
import { useAuth, useEstablishment } from '@/contexts';
import {
  cancelInvitation,
  changeMemberRole,
  inviteUrlForToken,
  loadMembers,
  loadPendingInvitations,
  regenerateInvitation,
  removeMember,
  type InvitableRole,
  type Member,
  type PendingInvitation,
} from '@/services/members';
import { inviteErrorCopy } from '@/utils/invite';
import { roleLabel } from '@/utils/establishment';
import { formatDateCompactEsAr } from '@/utils/format-date-es-ar';
import type { UserRole } from '@/types';

const OFFLINE_COPY = 'Necesitás conexión para esto. Conectate a internet y volvé a intentar.';

// ─── confirmDestructive (espejo de mas.tsx) ──────────────────────────────────────

function confirmDestructive(title: string, message: string, confirmLabel: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    const ok =
      typeof globalThis !== 'undefined' &&
      typeof (globalThis as { confirm?: unknown }).confirm === 'function'
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

// ─── Pantalla ─────────────────────────────────────────────────────────────────

export default function MiembrosScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state: authState } = useAuth();
  const { state: estState } = useEstablishment();

  const userId = authState.status === 'authenticated' ? authState.user.id : null;

  // Campo activo + rol del usuario en él. La gestión vive sobre el campo ACTIVO (no hardcode).
  //
  // ⚠️ DEPENDENCIAS ESTABLES (fix loop de fetches): derivamos PRIMITIVOS (string | null) del
  // estado, NO un objeto. Un objeto `{ id, name, role }` se recrearía en CADA render (identidad
  // nueva) → cualquier useCallback/useEffect que dependa de él se re-dispararía cada render →
  // `load()` → setState → re-render → loop infinito de requests (ERR_INSUFFICIENT_RESOURCES en web).
  // Con primitivos, las deps solo cambian cuando el VALOR cambia, no la identidad.
  const activeId = estState.status === 'active' ? estState.current.id : null;
  const activeName = estState.status === 'active' ? estState.current.name : null;
  const activeRole = estState.status === 'active' ? estState.role : null;
  const hasActiveField = activeId !== null;
  const isOwner = activeRole === 'owner';

  const [members, setMembers] = useState<Member[] | null>(null);
  const [pending, setPending] = useState<PendingInvitation[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const primary = getTokenValue('$primary', 'color');

  // `load` depende SOLO de primitivos estables (activeId/activeRole/userId), nunca del objeto.
  const load = useCallback(async () => {
    if (!activeId || !userId) return;
    setLoading(true);
    setLoadError(null);

    const membersResult = await loadMembers(activeId, userId);
    if (!membersResult.ok) {
      setLoadError(membersResult.error.kind === 'network' ? OFFLINE_COPY : 'No pudimos cargar el equipo.');
      setLoading(false);
      return;
    }
    setMembers(membersResult.members);

    // Las invitaciones pendientes son owner-only (RLS): solo las pedimos si somos owner.
    if (activeRole === 'owner') {
      const pendingResult = await loadPendingInvitations(activeId);
      if (pendingResult.ok) {
        setPending(pendingResult.invitations);
      } else {
        // No tumbamos la pantalla por las pendientes: mostramos los miembros igual.
        setPending([]);
      }
    } else {
      setPending([]);
    }
    setLoading(false);
  }, [activeId, activeRole, userId]);

  // Re-fetch al RECUPERAR EL FOCO (no solo en mount). `/miembros` queda MONTADA en el stack al
  // navegar a `/invitar` y volver, así que un `useEffect([load])` solo correría una vez y mostraría la
  // lista vieja (la invitación recién creada no aparecía hasta salir/re-entrar a Equipo). `useFocusEffect`
  // re-corre `load` en cada evento de foco (entrar a Miembros, volver de Invitar). NO loopea: `load`
  // depende solo de primitivos estables (activeId/activeRole/userId) → identidad estable entre renders,
  // y el foco es un evento DISCRETO (no por render). NO dejamos un useEffect([load]) además (sería doble fetch).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      {/* Header: back + título "Equipo" + (owner) Invitar. */}
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" gap="$2" paddingVertical="$3">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Volver"
            hitSlop={8}
            onPress={() => router.back()}
          >
            <View width="$icon" height="$icon" alignItems="center" justifyContent="center">
              <ArrowLeft size={24} color={primary} strokeWidth={2.5} />
            </View>
          </Pressable>
          <Text
            flex={1}
            minWidth={0}
            fontFamily="$body"
            fontSize="$8"
            lineHeight="$8"
            fontWeight="700"
            color="$textPrimary"
            numberOfLines={1}
          >
            Equipo
          </Text>
          {isOwner ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Invitar miembro"
              onPress={() => router.push('/invitar')}
            >
              <XStack
                alignItems="center"
                gap="$1"
                backgroundColor="$primary"
                borderRadius="$pill"
                paddingHorizontal="$3"
                minHeight="$chipMin"
                pressStyle={{ backgroundColor: '$primaryPress' }}
              >
                <UserPlus size={18} color={getTokenValue('$white', 'color')} strokeWidth={2.5} />
                <Text fontFamily="$body" fontSize="$3" fontWeight="600" color="$white">
                  Invitar
                </Text>
              </XStack>
            </Pressable>
          ) : null}
        </XStack>
      </YStack>

      <ScrollView
        flex={1}
        width="100%"
        maxWidth="100%"
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          paddingBottom: getTokenValue('$8', 'space'),
          width: '100%',
          maxWidth: '100%',
        }}
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      >
        {!hasActiveField ? (
          <InfoNote>Elegí un campo activo para gestionar su equipo.</InfoNote>
        ) : loading && members === null ? (
          <InfoNote>Cargando el equipo…</InfoNote>
        ) : loadError ? (
          <YStack gap="$2">
            <FormError message={loadError} />
            <Button variant="secondary" fullWidth onPress={() => void load()}>
              Reintentar
            </Button>
          </YStack>
        ) : (
          <YStack width="100%" gap="$2" marginTop="$2">
            {/* Nombre del campo (contexto). */}
            <SectionTitle>{`Miembros de ${activeName ?? ''}`}</SectionTitle>

            <Card padding="$0" gap="$0" overflow="hidden">
              {(members ?? []).map((m, i) => (
                <View key={m.userId}>
                  {i > 0 ? (
                    <View height={1} backgroundColor="$divider" marginHorizontal="$4" />
                  ) : null}
                  <MemberRow
                    member={m}
                    canManage={Boolean(isOwner) && !m.isCurrentUser}
                    onChangeRole={() => void onChangeRole(m)}
                    onRemove={() => void onRemove(m)}
                  />
                </View>
              ))}
            </Card>

            {/* No-owner: vista mínima (RLS #1) — solo su fila + nota honesta. */}
            {!isOwner ? (
              <InfoNote>
                Solo el dueño del campo gestiona el equipo (invitar, cambiar roles, remover). Esta es
                tu membresía en este campo.
              </InfoNote>
            ) : null}

            {/* Owner: invitaciones pendientes (T5.3 / R5.12). */}
            {isOwner ? (
              <YStack width="100%" gap="$2">
                <SectionTitle>Invitaciones pendientes</SectionTitle>
                {pending.length === 0 ? (
                  <InfoNote>
                    No hay invitaciones pendientes. Tocá "Invitar" para sumar a alguien al equipo.
                  </InfoNote>
                ) : (
                  <YStack width="100%" gap="$3">
                    {pending.map((inv) => (
                      <PendingInvitationCard
                        key={inv.id}
                        invitation={inv}
                        establishmentName={activeName ?? ''}
                        onChanged={() => void load()}
                      />
                    ))}
                  </YStack>
                )}
              </YStack>
            ) : null}
          </YStack>
        )}
      </ScrollView>
    </YStack>
  );

  // ── Cambiar rol (T5.5) ──────────────────────────────────────────────────────────
  async function onChangeRole(member: Member) {
    if (!activeId) return;
    // El rol destino se elige con un picker (web/native): proponemos el "otro" rol invitable.
    // Owner→ no se ofrece degradar acá si es el único (el backend igual lo bloquea con last_owner).
    const target = await pickRole(member.role);
    if (!target) return;
    const result = await changeMemberRole({
      userId: member.userId,
      establishmentId: activeId,
      newRole: target,
    });
    if (result.ok) {
      await load();
    } else {
      Alert.alert(
        'No se pudo cambiar el rol',
        result.error.kind === 'network' ? OFFLINE_COPY : inviteErrorCopy(result.error.code),
      );
    }
  }

  // ── Remover (T5.6) ────────────────────────────────────────────────────────────
  async function onRemove(member: Member) {
    if (!activeId) return;
    const who = member.name?.trim() || 'este miembro';
    const confirmed = await confirmDestructive(
      'Remover del equipo',
      `${who} va a perder acceso a "${activeName ?? 'este campo'}". ¿Lo removés?`,
      'Remover',
    );
    if (!confirmed) return;
    const result = await removeMember({ userId: member.userId, establishmentId: activeId });
    if (result.ok) {
      await load();
    } else {
      Alert.alert(
        'No se pudo remover',
        result.error.kind === 'network' ? OFFLINE_COPY : inviteErrorCopy(result.error.code),
      );
    }
  }
}

// ─── Selector de rol destino (web prompt vs native Alert) ──────────────────────────
//
// Roles destino invitables: Operario / Veterinario (R4.5; owner no se asigna acá). Ofrecemos el
// "otro" rol invitable respecto del actual. Si el actual es owner, ofrecemos ambos (degradar). El
// backend bloquea degradar al único owner (last_owner) → el copy del error lo explica.
function pickRole(current: UserRole): Promise<InvitableRole | null> {
  const options: InvitableRole[] = (['field_operator', 'veterinarian'] as InvitableRole[]).filter(
    (r) => r !== current,
  );
  // Si current ya es uno de los dos, queda 1 opción; si es owner, quedan las 2.
  if (Platform.OS === 'web') {
    const labels = options.map((r, i) => `${i + 1}. ${roleLabel(r)}`).join('\n');
    const raw =
      typeof globalThis !== 'undefined' &&
      typeof (globalThis as { prompt?: unknown }).prompt === 'function'
        ? (globalThis as { prompt: (m?: string) => string | null }).prompt(
            `Nuevo rol (escribí el número):\n${labels}`,
          )
        : null;
    if (raw == null) return Promise.resolve(null);
    const idx = parseInt(raw.trim(), 10) - 1;
    return Promise.resolve(options[idx] ?? null);
  }
  return new Promise((resolve) => {
    Alert.alert('Cambiar rol', 'Elegí el nuevo rol', [
      ...options.map((r) => ({ text: roleLabel(r), onPress: () => resolve(r) })),
      { text: 'Cancelar', style: 'cancel' as const, onPress: () => resolve(null) },
    ]);
  });
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: string }) {
  return (
    <Text fontFamily="$body" fontSize="$3" fontWeight="600" color="$textMuted" marginTop="$4" marginBottom="$1">
      {children}
    </Text>
  );
}

/** Fila de un miembro: nombre + "vos" + RoleBadge + (owner, no-self) menú de acciones. */
function MemberRow({
  member,
  canManage,
  onChangeRole,
  onRemove,
}: {
  member: Member;
  canManage: boolean;
  onChangeRole: () => void;
  onRemove: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const muted = getTokenValue('$textMuted', 'color');
  const name = member.name?.trim() || 'Sin nombre';

  return (
    <YStack width="100%">
      <XStack
        width="100%"
        alignItems="center"
        gap="$3"
        minHeight="$touchMin"
        paddingHorizontal="$4"
        paddingVertical="$2"
      >
        <YStack flex={1} minWidth={0} gap="$1">
          <XStack alignItems="center" gap="$2" minWidth={0}>
            <Text
              flexShrink={1}
              minWidth={0}
              numberOfLines={1}
              fontFamily="$body"
              fontSize="$5"
              fontWeight="600"
              color="$textPrimary"
            >
              {name}
            </Text>
            {member.isCurrentUser ? (
              <View
                backgroundColor="$greenLight"
                borderRadius="$pill"
                paddingHorizontal="$2"
                flexShrink={0}
              >
                <Text fontFamily="$body" fontSize="$2" fontWeight="600" color="$primary">
                  vos
                </Text>
              </View>
            ) : null}
          </XStack>
        </YStack>
        <RoleBadge role={member.role} />
        {canManage ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Acciones para ${name}`}
            hitSlop={8}
            onPress={() => setMenuOpen((o) => !o)}
          >
            <View width="$icon" height="$touchMin" alignItems="center" justifyContent="center">
              {menuOpen ? (
                <X size={20} color={muted} strokeWidth={2} />
              ) : (
                <MoreVertical size={20} color={muted} strokeWidth={2} />
              )}
            </View>
          </Pressable>
        ) : null}
      </XStack>

      {/* Acciones inline (owner, no-self): cambiar rol / remover. */}
      {canManage && menuOpen ? (
        <XStack width="100%" gap="$3" paddingHorizontal="$4" paddingBottom="$3">
          <Button
            variant="secondary"
            onPress={() => {
              setMenuOpen(false);
              onChangeRole();
            }}
          >
            Cambiar rol
          </Button>
          <RemoveButton
            onPress={() => {
              setMenuOpen(false);
              onRemove();
            }}
          />
        </XStack>
      ) : null}
    </YStack>
  );
}

/** Botón "Remover" destructivo (outline terracota). */
function RemoveButton({ onPress }: { onPress: () => void }) {
  const terracota = getTokenValue('$terracota', 'color');
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Remover del equipo" onPress={onPress}>
      <XStack
        alignItems="center"
        justifyContent="center"
        minHeight="$touchMin"
        borderWidth={2}
        borderColor="$terracota"
        borderRadius="$pill"
        paddingHorizontal="$5"
        pressStyle={{ backgroundColor: '$surface' }}
      >
        <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$terracota">
          Remover
        </Text>
      </XStack>
    </Pressable>
  );
}

/**
 * Card de una invitación pendiente (T5.3): rol + fechas + email-anotación + acciones (Copiar /
 * Compartir / Regenerar / Cancelar). El accept_url se reconstruye del token (inviteUrlForToken).
 * Tras regenerar/cancelar refresca la lista (onChanged). Copiar/Compartir feedback efímero.
 */
function PendingInvitationCard({
  invitation,
  establishmentName,
  onChanged,
}: {
  invitation: PendingInvitation;
  establishmentName: string;
  onChanged: () => void;
}) {
  const muted = getTokenValue('$textMuted', 'color');
  const primary = getTokenValue('$primary', 'color');
  const terracota = getTokenValue('$terracota', 'color');

  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);

  // El link vigente: si recién regeneramos, mostramos el nuevo; si no, el reconstruido del token.
  const [url, setUrl] = useState(() => inviteUrlForToken(invitation.token));
  // Re-sincroniza si la prop cambia (la lista se recarga con el token nuevo tras regenerar).
  useEffect(() => {
    setUrl(inviteUrlForToken(invitation.token));
  }, [invitation.token]);

  const shareMessage = `Te invito a sumarte a "${establishmentName}" en RAFAQ. Abrí este link para aceptar: ${url}`;

  const onCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(url);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      /* portapapeles no disponible */
    }
  }, [url]);

  const onShare = useCallback(async () => {
    try {
      await Share.share(
        Platform.OS === 'ios' ? { url, message: shareMessage } : { message: shareMessage },
      );
    } catch {
      /* cancelado / sin share sheet */
    }
  }, [url, shareMessage]);

  const onRegenerate = useCallback(async () => {
    if (busyRef.current) return;
    const confirmed = await confirmDestructive(
      'Regenerar link',
      'Se genera un link nuevo y el actual deja de funcionar. Útil si lo compartiste por error. ¿Regenerar?',
      'Regenerar',
    );
    if (!confirmed) return;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    const result = await regenerateInvitation(invitation.id);
    busyRef.current = false;
    setBusy(false);
    if (result.ok) {
      setUrl(result.value.acceptUrl);
      onChanged();
    } else {
      setActionError(result.error.kind === 'network' ? OFFLINE_COPY : inviteErrorCopy(result.error.code));
    }
  }, [invitation.id, onChanged]);

  const onCancel = useCallback(async () => {
    if (busyRef.current) return;
    const confirmed = await confirmDestructive(
      'Cancelar invitación',
      'El link deja de funcionar y la invitación se cancela. ¿Cancelarla?',
      'Cancelar invitación',
    );
    if (!confirmed) return;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    const result = await cancelInvitation(invitation.id);
    busyRef.current = false;
    setBusy(false);
    if (result.ok) {
      onChanged();
    } else {
      setActionError(result.error.kind === 'network' ? OFFLINE_COPY : inviteErrorCopy(result.error.code));
    }
  }, [invitation.id, onChanged]);

  return (
    <Card gap="$3">
      {/* Encabezado: rol + email-anotación. */}
      <YStack gap="$1">
        <XStack alignItems="center" gap="$2">
          <RoleBadge role={invitation.role} />
          {invitation.email ? (
            <Text
              flex={1}
              minWidth={0}
              numberOfLines={1}
              ellipsizeMode="middle"
              fontFamily="$body"
              fontSize="$3"
              fontWeight="400"
              color="$textMuted"
            >
              {invitation.email}
            </Text>
          ) : null}
        </XStack>
        <Text fontFamily="$body" fontSize="$2" fontWeight="400" color="$textFaint">
          Creada {formatDateCompactEsAr(invitation.createdAt)} · vence{' '}
          {formatDateCompactEsAr(invitation.expiresAt)}
        </Text>
      </YStack>

      {/* El link reconstruido — seleccionable, con guard de overflow. */}
      <View
        width="100%"
        maxWidth="100%"
        overflow="hidden"
        backgroundColor="$bg"
        borderRadius="$card"
        borderWidth={1}
        borderColor="$divider"
        paddingHorizontal="$3"
        paddingVertical="$2"
      >
        <Text
          fontFamily="$body"
          fontSize="$3"
          fontWeight="400"
          color="$textMuted"
          numberOfLines={1}
          ellipsizeMode="middle"
          selectable
        >
          {url}
        </Text>
      </View>

      {actionError ? <FormError message={actionError} /> : null}

      {/* Acciones: Copiar / Compartir (primarias) + Regenerar / Cancelar (secundarias). */}
      <XStack width="100%" gap="$2" flexWrap="wrap">
        <ActionPill
          icon={<Copy size={16} color={primary} strokeWidth={2.5} />}
          label={copied ? 'Copiado' : 'Copiar'}
          onPress={() => void onCopy()}
        />
        <ActionPill
          icon={<Share2 size={16} color={primary} strokeWidth={2.5} />}
          label="Compartir"
          onPress={() => void onShare()}
        />
        <ActionPill
          icon={<RefreshCw size={16} color={muted} strokeWidth={2.5} />}
          label={busy ? '…' : 'Regenerar'}
          tone="muted"
          disabled={busy}
          onPress={() => void onRegenerate()}
        />
        <ActionPill
          icon={<X size={16} color={terracota} strokeWidth={2.5} />}
          label="Cancelar"
          tone="destructive"
          disabled={busy}
          onPress={() => void onCancel()}
        />
      </XStack>
    </Card>
  );
}

/** Chip de acción (≥ $chipMin) para las invitaciones pendientes. tone cambia el color del texto. */
function ActionPill({
  icon,
  label,
  tone = 'primary',
  disabled = false,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  tone?: 'primary' | 'muted' | 'destructive';
  disabled?: boolean;
  onPress: () => void;
}) {
  const color = tone === 'destructive' ? '$terracota' : tone === 'muted' ? '$textMuted' : '$primary';
  const borderColor = tone === 'destructive' ? '$terracota' : tone === 'muted' ? '$divider' : '$primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
    >
      <XStack
        alignItems="center"
        gap="$1"
        minHeight="$chipMin"
        backgroundColor="$surface"
        borderWidth={1}
        borderColor={borderColor}
        borderRadius="$pill"
        paddingHorizontal="$3"
        opacity={disabled ? 0.5 : 1}
        pressStyle={{ backgroundColor: '$bg' }}
      >
        {icon}
        <Text fontFamily="$body" fontSize="$3" fontWeight="600" color={color}>
          {label}
        </Text>
      </XStack>
    </Pressable>
  );
}
