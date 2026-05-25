import { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export type AuthUser = {
  id: string;
  email: string;
};

// Extrae el user del JWT del request. Tira si no hay sesión o no hay email.
export async function requireUser(
  userClient: SupabaseClient,
): Promise<AuthUser> {
  const { data, error } = await userClient.auth.getUser();
  if (error || !data?.user) {
    throw new HttpError(401, 'unauthorized', 'Sesión inválida o ausente.');
  }
  const email = data.user.email ?? '';
  if (!email) {
    throw new HttpError(
      401,
      'unauthorized',
      'Usuario sin email confirmado.',
    );
  }
  return { id: data.user.id, email: email.toLowerCase() };
}

// Verifica que el user actual sea owner activo del establishment.
// Usa el admin client para no depender de la RLS del caller (lo cual nos
// daría 0 filas en lugar de un diagnóstico claro).
export async function requireOwnerOf(
  adminClient: SupabaseClient,
  userId: string,
  establishmentId: string,
): Promise<void> {
  const { data, error } = await adminClient
    .from('user_roles')
    .select('id')
    .eq('user_id', userId)
    .eq('establishment_id', establishmentId)
    .eq('role', 'owner')
    .eq('active', true)
    .maybeSingle();
  if (error) {
    throw new HttpError(500, 'db_error', error.message);
  }
  if (!data) {
    throw new HttpError(
      403,
      'forbidden',
      'No tenés permisos de owner sobre este establecimiento.',
    );
  }
}

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
