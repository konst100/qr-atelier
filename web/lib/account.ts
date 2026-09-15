export type UserRole = 'owner' | 'admin' | 'editor' | 'viewer';

export type RegistrationInput = {
  email: string;
  password: string;
  displayName?: string;
};

export type RegistrationData = {
  email: string;
  displayName: string;
};

export type PasswordDigest = {
  algorithm: 'PBKDF2-SHA-256';
  iterations: number;
  salt: string;
  hash: string;
};

export type SessionData = {
  tokenHash: string;
  userId: string;
  expiresAt: string;
};

const PASSWORD_ITERATIONS = 210_000;
const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function cryptoApi(): Crypto {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto API is required');
  return globalThis.crypto;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateRegistration(input: RegistrationInput): { data?: RegistrationData; error?: string } {
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { error: 'emailInvalid' };
  if (input.password.length < 12 || input.password.length > 256) return { error: 'passwordInvalid' };
  const displayName = (input.displayName ?? '').trim().slice(0, 80);
  return { data: { email, displayName } };
}

export async function hashPassword(password: string): Promise<PasswordDigest> {
  const api = cryptoApi();
  const salt = new Uint8Array(16);
  api.getRandomValues(salt);
  const key = await api.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await api.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PASSWORD_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  );
  return {
    algorithm: 'PBKDF2-SHA-256',
    iterations: PASSWORD_ITERATIONS,
    salt: toBase64Url(salt),
    hash: toBase64Url(new Uint8Array(bits)),
  };
}

export async function verifyPassword(password: string, digest: PasswordDigest): Promise<boolean> {
  if (digest.algorithm !== 'PBKDF2-SHA-256' || digest.iterations < 100_000) return false;
  const api = cryptoApi();
  const key = await api.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = fromBase64Url(digest.salt);
  const bits = await api.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: digest.iterations, hash: 'SHA-256' },
    key,
    256,
  );
  const actual = new Uint8Array(bits);
  const expected = fromBase64Url(digest.hash);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual[index] ^ expected[index];
  return difference === 0;
}

export async function hashSessionToken(token: string): Promise<string> {
  const api = cryptoApi();
  return toBase64Url(new Uint8Array(await api.subtle.digest('SHA-256', encoder.encode(token))));
}

export async function createSession(userId: string, lifetimeMs = 1000 * 60 * 60 * 24 * 30): Promise<{ token: string; data: SessionData }> {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(userId)) throw new Error('Invalid user id');
  const api = cryptoApi();
  const tokenBytes = new Uint8Array(32);
  api.getRandomValues(tokenBytes);
  const token = toBase64Url(tokenBytes);
  const tokenHash = await hashSessionToken(token);
  return { token, data: { tokenHash, userId, expiresAt: new Date(Date.now() + lifetimeMs).toISOString() } };
}
