// app/invite.tsx — Aceptar invitación (spec 01, Fase 5 / T5.4 / R5.4/R5.5/R5.6/R5.9/R5.13).
//
// Entradas:
//   1. Pegar link (wizard onboarding T4.3 + stub PasteInviteLink de mis-campos): se navega acá con
//      el token ya extraído (?token=...) o se pega acá mismo (input).
//   2. [DIFERIDO] deep link nativo rafq://invite?token= / universal link https://app.rafq.ar/invite:
//      device-blocked (Expo Go SDK 56 fuera de tiendas) + el dominio app.rafq.ar no existe aún. El
//      loop se prueba en WEB pegando el link manualmente. El scheme 'rafq' ya está en app.json y
//      expo-linking parsea ?token=; la asociación universal-link (apple-app-site-association /
//      assetlinks) + verificación on-device quedan como TODO (no testeable sin dev-build + dominio).
//
// Flujo:
//   - Si NO logueado: persistimos el token en almacenamiento seguro (R5.13, pending-invitation) y
//     ofrecemos Registrarme / Iniciar sesión. Tras verificar email, el SEAM de verify-email re-rutea
//     acá con el token persistido (ver verify-email.tsx) y se completa la aceptación.
//   - Si YA logueado: confirm GENÉRICO (sin preview — hallazgo RLS #3: el invitado no puede leer la
//     invitación antes de aceptar; previsualizar nombre/rol requeriría un edge público lookup-by-token,
//     fuera de scope MVP). Al aceptar OK mostramos a qué campo entró.
//   - Éxito → refreshEstablishments(establishment_id) → aterriza en la home del campo nuevo
//     (router.replace, sin dejar el accept en el back-stack). Limpia el token persistido (R5.13).
//   - Errores 404/409/410 → copy legible (inviteErrorCopy / alreadyMemberCopy).
//
// 🟡 mixta; voseo. Cero hardcode (ADR-023 §4).

import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { YStack } from 'tamagui';

import { AuthScreenShell, Button, FormField, FormError, InfoNote } from '@/components';
import { useAuth, useEstablishment } from '@/contexts';
import { acceptInvitation } from '@/services/members';
import { parseInviteToken, inviteErrorCopy, alreadyMemberCopy } from '@/utils/invite';
import {
  clearPendingInvitationToken,
  setPendingInvitationToken,
} from '@/services/pending-invitation';

type Phase =
  | { kind: 'paste' } // sin token: pedir que peguen el link
  | { kind: 'confirm'; token: string } // logueado: confirmar
  | { kind: 'auth_required'; token: string } // no logueado: registrarse / iniciar sesión
  | { kind: 'accepting'; token: string } // aceptando (transitorio; al ok → router.replace a la home)
  | { kind: 'error'; message: string; token: string | null };

export default function InviteScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const { state: authState } = useAuth();
  const { refreshEstablishments } = useEstablishment();

  const isAuthed = authState.status === 'authenticated';
  const userId = isAuthed ? authState.user.id : null;

  // Token inicial: del query param (?token=) si vino. Lo parseamos por las dudas (también acepta
  // un link completo pasado como param).
  const initialToken = typeof params.token === 'string' ? parseInviteToken(params.token) : null;

  const [phase, setPhase] = useState<Phase>(() =>
    initialToken
      ? isAuthed
        ? { kind: 'confirm', token: initialToken }
        : { kind: 'auth_required', token: initialToken }
      : { kind: 'paste' },
  );
  const [pasteInput, setPasteInput] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);

  // R5.13: SIEMPRE que estemos en auth_required con un token, lo persistimos en almacenamiento
  // seguro. Cubre ambas entradas a esa fase: el paste logueado-fuera (onSubmitPaste ya lo hace) y
  // el deep-link con ?token= estando logueado-fuera (fase inicial, donde onSubmitPaste no corrió).
  // Así el token sobrevive signup + verificación + kill de la app, y verify-email/onboarding lo
  // recuperan para re-rutear acá. Idempotente (sobrescribe con el mismo valor).
  useEffect(() => {
    if (phase.kind === 'auth_required') {
      void setPendingInvitationToken(phase.token);
    }
  }, [phase]);

  // Re-evalúa el gate de auth: si el usuario se loguea/verifica con un token pendiente, pasamos a
  // confirmar. Evita quedar trabado en auth_required tras volver del flujo de signup.
  const lastAuthed = useRef(isAuthed);
  useEffect(() => {
    if (isAuthed && !lastAuthed.current) {
      // Recién autenticado: si estábamos esperando auth con un token, vamos a confirmar.
      setPhase((p) => (p.kind === 'auth_required' ? { kind: 'confirm', token: p.token } : p));
    }
    lastAuthed.current = isAuthed;
  }, [isAuthed]);

  // ── Pegar link (entrada manual) ────────────────────────────────────────────────
  function onSubmitPaste() {
    setPasteError(null);
    const token = parseInviteToken(pasteInput);
    if (!token) {
      setPasteError('Ese link no parece una invitación válida. Pegá el link completo que te pasaron.');
      return;
    }
    // El token se persiste (R5.13) en el efecto al entrar a auth_required; acá solo decidimos fase.
    setPhase(isAuthed ? { kind: 'confirm', token } : { kind: 'auth_required', token });
  }

  // ── Aceptar (logueado) ──────────────────────────────────────────────────────────
  async function onAccept(token: string) {
    setPhase({ kind: 'accepting', token });
    const result = await acceptInvitation(token);
    if (result.ok) {
      // R5.13: consumido OK → borramos el token persistido para no re-disparar el flujo.
      await clearPendingInvitationToken();
      // Re-leemos memberships fijando el campo nuevo como activo (mismo patrón que crear-campo) y
      // aterrizamos en su home. router.replace: no dejamos el accept en el back-stack.
      await refreshEstablishments(result.value.establishmentId);
      router.replace('/(tabs)');
      return;
    }
    // Error: copy legible. already_member nombra el rol actual del usuario si lo conocemos.
    let message: string;
    if (result.error.kind === 'network') {
      message = 'Necesitás conexión para aceptar la invitación. Conectate y volvé a intentar.';
    } else if (result.error.code === 'already_member') {
      // No conocemos el rol actual del usuario en el campo destino (el 409 no trae el
      // establishment_id ni el rol) → copy genérico de already_member. Si el edge lo expusiera a
      // futuro, se pasaría el rol acá. alreadyMemberCopy(null) === inviteErrorCopy('already_member').
      message = alreadyMemberCopy(null);
    } else {
      message = inviteErrorCopy(result.error.code);
    }
    // R5.13: error TERMINAL (no recuperable con este token) → borramos el token persistido para no
    // re-disparar el flujo en cada arranque. Los códigos terminales: expired/not_found/invalid_state/
    // already_member. La red NO es terminal (reintentar sirve), así que ahí lo conservamos.
    if (result.error.kind === 'fn') {
      void clearPendingInvitationToken();
    }
    setPhase({ kind: 'error', message, token });
  }

  // ── Render por fase ───────────────────────────────────────────────────────────
  if (phase.kind === 'accepting') {
    return (
      <AuthScreenShell title="Aceptando…" subtitle="Un momento, te estamos sumando al campo.">
        <YStack gap="$4" marginTop="$2">
          <InfoNote>Procesando la invitación…</InfoNote>
        </YStack>
      </AuthScreenShell>
    );
  }

  if (phase.kind === 'error') {
    return (
      <AuthScreenShell title="No se pudo aceptar" subtitle="Revisá el detalle y probá de nuevo.">
        <YStack gap="$4" marginTop="$2">
          <FormError message={phase.message} />
          {phase.token ? (
            <Button variant="primary" fullWidth onPress={() => void onAccept(phase.token!)}>
              Reintentar
            </Button>
          ) : null}
          <Button variant="secondary" fullWidth onPress={() => router.replace('/(tabs)')}>
            Volver
          </Button>
        </YStack>
      </AuthScreenShell>
    );
  }

  if (phase.kind === 'confirm') {
    return (
      <AuthScreenShell
        title="¿Aceptar esta invitación?"
        subtitle="Al aceptar, te sumás al campo con el rol que te asignaron. Vas a ver sus animales y datos."
      >
        <YStack gap="$4" marginTop="$2">
          {/* Confirm GENÉRICO (sin preview): el invitado no puede leer la invitación antes de
              aceptar (hallazgo RLS #3). Recién al aceptar OK mostramos a qué campo entró. */}
          <InfoNote>
            Por seguridad no mostramos los datos del campo hasta que aceptes. Si el link te lo pasó
            alguien de confianza, dale aceptar.
          </InfoNote>
          <Button variant="primary" fullWidth onPress={() => void onAccept(phase.token)}>
            Aceptar invitación
          </Button>
          <Button variant="secondary" fullWidth onPress={() => router.replace('/(tabs)')}>
            Ahora no
          </Button>
        </YStack>
      </AuthScreenShell>
    );
  }

  if (phase.kind === 'auth_required') {
    return (
      <AuthScreenShell
        title="Sumate al campo"
        subtitle="Te invitaron a un campo en RAFAQ. Creá tu cuenta o iniciá sesión para aceptar."
      >
        <YStack gap="$4" marginTop="$2">
          <InfoNote>
            Guardamos tu invitación. Después de crear la cuenta o entrar, la aceptás automáticamente.
          </InfoNote>
          {/* El token ya quedó persistido (R5.13); las pantallas de auth no necesitan recibirlo:
              al verificar, el SEAM de verify-email re-rutea acá con el token guardado. */}
          <Button variant="primary" fullWidth onPress={() => router.replace('/(auth)/sign-up')}>
            Registrarme
          </Button>
          <Button variant="secondary" fullWidth onPress={() => router.replace('/(auth)/sign-in')}>
            Ya tengo cuenta · Iniciar sesión
          </Button>
        </YStack>
      </AuthScreenShell>
    );
  }

  // phase.kind === 'paste'
  return (
    <AuthScreenShell
      title="Pegá tu invitación"
      subtitle="¿Te invitaron a un campo? Pegá acá el link que te pasaron por WhatsApp, mail o donde sea."
    >
      <YStack gap="$4" marginTop="$2">
        <FormField
          label="Link de invitación"
          value={pasteInput}
          onChangeText={setPasteInput}
          placeholder="https://app.rafq.ar/invite?token=…"
          autoCapitalize="none"
          autoComplete="off"
          error={pasteError}
        />
        <Button variant="primary" fullWidth onPress={onSubmitPaste}>
          Continuar
        </Button>
        <Button variant="secondary" fullWidth onPress={() => router.back()}>
          Cancelar
        </Button>
      </YStack>
    </AuthScreenShell>
  );
}
