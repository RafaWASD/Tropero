// Persistencia del token de invitación pendiente (spec 01, R5.13).
//
// R5.13: cuando un destinatario aún no logueado abre/pega un link de invitación,
// el token se persiste en almacenamiento seguro (expo-secure-store) para sobrevivir
// signup + verificación de email + un posible kill de la app. Al pasar el gate de
// verificación, el cliente lee este store y re-rutea a AcceptInvitation; tras
// consumir el token (aceptación OK o error terminal) lo borra.
//
// ESTADO B.1.1: la pantalla AcceptInvitation y el flujo de deep-link se construyen
// en la Fase 5 (B.1.3). Acá dejamos el SEAM: el store (read/write/clear) ya
// funciona, y el gate de verificación (EmailVerificationGate) lo CONSULTA. El
// re-ruteo a AcceptInvitation queda como TODO B.1.3 documentado en el gate.
//
// Web: expo-secure-store es solo-native; en web caemos a localStorage (mismo patrón
// que el storage adapter de auth). Se aísla acá para no acoplar al cliente Supabase.

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const PENDING_INVITATION_KEY = 'rafq.pending_invitation_token';

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

export async function setPendingInvitationToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (hasLocalStorage()) window.localStorage.setItem(PENDING_INVITATION_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(PENDING_INVITATION_KEY, token);
}

export async function getPendingInvitationToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return hasLocalStorage() ? window.localStorage.getItem(PENDING_INVITATION_KEY) : null;
  }
  return SecureStore.getItemAsync(PENDING_INVITATION_KEY);
}

export async function clearPendingInvitationToken(): Promise<void> {
  if (Platform.OS === 'web') {
    if (hasLocalStorage()) window.localStorage.removeItem(PENDING_INVITATION_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(PENDING_INVITATION_KEY);
}
