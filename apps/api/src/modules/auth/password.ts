import argon2 from 'argon2';

/**
 * Argon2id: the current OWASP recommendation for password storage (memory-hard,
 * so GPU cracking is expensive). Parameters are argon2's defaults, which meet
 * OWASP's minimums; the salt and parameters are encoded in the hash string, so
 * they can be raised later without breaking existing hashes.
 */
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false; // malformed hash
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns the same CPU time as a real check. Used when the email doesn't exist, so
 * response timing doesn't reveal which emails have accounts (user enumeration).
 */
export async function verifyAgainstDummy(plain: string): Promise<false> {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalisation');
  await verifyPassword(await dummyHash, plain);
  return false;
}
