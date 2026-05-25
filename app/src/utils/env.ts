import Constants from 'expo-constants';

type RequiredEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

function readPublicEnv(name: string): string | undefined {
  const fromProcess = (process.env as Record<string, string | undefined>)[name];
  if (fromProcess && fromProcess.length > 0) return fromProcess;
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const fromExtra = extra[name];
  return typeof fromExtra === 'string' && fromExtra.length > 0 ? fromExtra : undefined;
}

export function getEnv(): RequiredEnv {
  const supabaseUrl = readPublicEnv('EXPO_PUBLIC_SUPABASE_URL');
  const supabaseAnonKey = readPublicEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Faltan variables de entorno EXPO_PUBLIC_SUPABASE_URL o EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Asegurate de tener .env.local en la raíz del repo.',
    );
  }

  return { supabaseUrl, supabaseAnonKey };
}
