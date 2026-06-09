import Constants from 'expo-constants';

import { resolveEnv, type EnvReader, type RequiredEnv } from './env-resolve';

const readPublicEnv: EnvReader = (name) => {
  const fromProcess = (process.env as Record<string, string | undefined>)[name];
  if (fromProcess && fromProcess.length > 0) return fromProcess;
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const fromExtra = extra[name];
  return typeof fromExtra === 'string' && fromExtra.length > 0 ? fromExtra : undefined;
};

export function getEnv(): RequiredEnv {
  return resolveEnv(readPublicEnv);
}
