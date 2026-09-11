import argon2 from 'argon2';

/**
 * Argon2id mit bewusst gesetzten Parametern (nicht den Library-Defaults),
 * damit eine spaetere Library-Aktualisierung die Kosten nicht still veraendert.
 * Richtwerte laut OWASP Password Storage Cheat Sheet.
 */
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, HASH_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // Kaputter oder fremdformatiger Hash darf keinen 500er ausloesen.
    return false;
  }
}

/**
 * Verbrennt bei unbekanntem Benutzernamen dieselbe Rechenzeit wie ein echter
 * Verify-Vorgang. Ohne das laesst sich ueber die Antwortzeit herausfinden,
 * welche Benutzernamen existieren (User Enumeration).
 */
const DUMMY_HASH = argon2.hash('dummy-password-for-timing-equalisation', HASH_OPTIONS);

export async function burnTiming(): Promise<void> {
  await argon2.verify(await DUMMY_HASH, 'wrong-password');
}
