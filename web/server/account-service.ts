import {
  hashPassword,
  normalizeEmail,
  type PasswordDigest,
  type RegistrationInput,
  validateRegistration,
  verifyPassword,
} from '../lib/account.ts';

export type AccountRecord = {
  id: string;
  email: string;
  displayName: string;
  password: PasswordDigest;
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicAccount = Pick<AccountRecord, 'id' | 'email' | 'displayName' | 'emailVerifiedAt' | 'createdAt'>;

export type AccountStore = {
  findByEmail(email: string): Promise<AccountRecord | null>;
  create(account: AccountRecord): Promise<void>;
  findById?(id: string): Promise<AccountRecord | null>;
};

export type AccountError = 'emailInvalid' | 'passwordInvalid' | 'emailTaken' | 'invalidCredentials';

export class AccountServiceError extends Error {
  readonly code: AccountError;

  constructor(code: AccountError) {
    super(code);
    this.name = 'AccountServiceError';
    this.code = code;
  }
}

function publicAccount(account: AccountRecord): PublicAccount {
  const { password: _password, ...safe } = account;
  return safe;
}

export async function registerAccount(
  store: AccountStore,
  input: RegistrationInput,
  options: { id?: string; now?: Date } = {},
): Promise<PublicAccount> {
  const validation = validateRegistration(input);
  if (!validation.data) throw new AccountServiceError(validation.error as AccountError);
  const email = validation.data.email;
  if (await store.findByEmail(email)) throw new AccountServiceError('emailTaken');
  const now = (options.now ?? new Date()).toISOString();
  const account: AccountRecord = {
    id: options.id ?? crypto.randomUUID(),
    email,
    displayName: validation.data.displayName,
    password: await hashPassword(input.password),
    emailVerifiedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await store.create(account);
  return publicAccount(account);
}

export async function authenticateAccount(store: AccountStore, emailInput: string, password: string): Promise<PublicAccount> {
  const account = await store.findByEmail(normalizeEmail(emailInput));
  if (!account || !(await verifyPassword(password, account.password))) {
    throw new AccountServiceError('invalidCredentials');
  }
  return publicAccount(account);
}
