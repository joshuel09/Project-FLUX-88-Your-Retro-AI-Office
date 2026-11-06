import { hash, verify } from '@node-rs/argon2';

/** Argon2id per constitution Security Requirements (OWASP-recommended params). */
const ARGON2_OPTIONS = {
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

/**
 * Fixed hash of a random throwaway value: verified against on UNKNOWN emails so
 * response timing cannot reveal whether the owner email exists (CHK020).
 */
export const DUMMY_HASH_PROMISE = hashPassword('flux88-timing-equalizer-dummy');
