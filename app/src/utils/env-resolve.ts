// Lógica PURA de resolución/validación de las variables de entorno públicas.
//
// SIN imports de RN/expo: testeable con node:test (mismo patrón que exit-animal.ts ↔
// animals.ts). La lectura real de las vars (process.env / Constants.expoConfig.extra)
// vive en env.ts, que importa expo-constants y NO carga bajo node:test. Acá: el ensamblado
// + la validación fail-closed con un mensaje accionable en español.

export type RequiredEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  powersyncUrl: string;
};

/** Lee el valor de una var pública por nombre. Devuelve undefined si no está o está vacía. */
export type EnvReader = (name: string) => string | undefined;

/**
 * Ensambla y valida el set de env requerido a partir de un reader. PURA (testeable): si falta
 * cualquiera de las tres, tira un Error con copy accionable en español (nunca un crash opaco, R1.3).
 * El mensaje nombra las tres vars y apunta a `.env.local`, igual que el error histórico de Supabase.
 */
export function resolveEnv(read: EnvReader): RequiredEnv {
  const supabaseUrl = read('EXPO_PUBLIC_SUPABASE_URL');
  const supabaseAnonKey = read('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  const powersyncUrl = read('EXPO_PUBLIC_POWERSYNC_URL');

  if (!supabaseUrl || !supabaseAnonKey || !powersyncUrl) {
    throw new Error(
      'Faltan variables de entorno EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY ' +
        'o EXPO_PUBLIC_POWERSYNC_URL. Asegurate de tener .env.local en la raíz del repo.',
    );
  }

  return { supabaseUrl, supabaseAnonKey, powersyncUrl };
}
