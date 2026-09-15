export type QrStatus = 'active' | 'paused' | 'expired' | 'archived';

export type QrRecord = {
  id: string;
  workspaceId: string;
  slug: string;
  kind: string;
  name: string;
  status: QrStatus;
  designJson: string;
  folderId: string | null;
  campaignId: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type QrDestination = {
  id: string;
  qrCodeId: string;
  destinationUrl: string;
  startsAt: string;
  endsAt: string | null;
  createdAt: string;
};

export type QrStore = {
  createQr(record: QrRecord): Promise<void>;
  updateQr(record: QrRecord): Promise<void>;
  getQrInWorkspace(workspaceId: string, id: string): Promise<QrRecord | null>;
  getQrBySlug(slug: string): Promise<QrRecord | null>;
  listQrInWorkspace(workspaceId: string): Promise<QrRecord[]>;
  createDestination(destination: QrDestination): Promise<void>;
  listDestinations(qrCodeId: string): Promise<QrDestination[]>;
};

export type QrServiceErrorCode = 'invalidSlug' | 'invalidDestination' | 'qrNotFound' | 'invalidDates';

export class QrServiceError extends Error {
  readonly code: QrServiceErrorCode;

  constructor(code: QrServiceErrorCode) {
    super(code);
    this.name = 'QrServiceError';
    this.code = code;
  }
}

const slugPattern = /^[a-z0-9](?:[a-z0-9-]{4,62}[a-z0-9])?$/;

export function validateSlug(value: string): string {
  const slug = value.trim().toLowerCase();
  if (!slugPattern.test(slug)) throw new QrServiceError('invalidSlug');
  return slug;
}

export function validateDestination(value: string): string {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.href.length > 2048) {
      throw new Error('invalid');
    }
    return url.href;
  } catch {
    throw new QrServiceError('invalidDestination');
  }
}

export async function createQr(
  store: QrStore,
  input: { workspaceId: string; id?: string; slug: string; kind: string; name: string; designJson?: string },
  now = new Date(),
): Promise<QrRecord> {
  const slug = validateSlug(input.slug);
  const createdAt = now.toISOString();
  const record: QrRecord = {
    id: input.id ?? crypto.randomUUID(),
    workspaceId: input.workspaceId,
    slug,
    kind: input.kind,
    name: input.name.trim().slice(0, 120),
    status: 'active',
    designJson: input.designJson ?? '{}',
    folderId: null,
    campaignId: null,
    expiresAt: null,
    createdAt,
    updatedAt: createdAt,
  };
  await store.createQr(record);
  return record;
}

export async function addDestination(
  store: QrStore,
  workspaceId: string,
  input: { qrCodeId: string; id?: string; destinationUrl: string; startsAt?: Date; endsAt?: Date | null },
  now = new Date(),
): Promise<QrDestination> {
  const qr = await store.getQrInWorkspace(workspaceId, input.qrCodeId);
  if (!qr) throw new QrServiceError('qrNotFound');
  const startsAt = input.startsAt ?? now;
  const endsAt = input.endsAt ?? null;
  if (endsAt && endsAt <= startsAt) throw new QrServiceError('invalidDates');
  const destination: QrDestination = {
    id: input.id ?? crypto.randomUUID(),
    qrCodeId: qr.id,
    destinationUrl: validateDestination(input.destinationUrl),
    startsAt: startsAt.toISOString(),
    endsAt: endsAt?.toISOString() ?? null,
    createdAt: now.toISOString(),
  };
  await store.createDestination(destination);
  return destination;
}

export type ResolvedQr = { qr: QrRecord; destination: QrDestination };

export async function resolveQrTarget(store: QrStore, slugInput: string, now = new Date()): Promise<ResolvedQr | null> {
  const slug = validateSlug(slugInput);
  const qr = await store.getQrBySlug(slug);
  if (!qr || qr.status !== 'active' || (qr.expiresAt && new Date(qr.expiresAt) <= now)) return null;
  const destinations = await store.listDestinations(qr.id);
  const current = destinations
    .filter((destination) => new Date(destination.startsAt) <= now && (!destination.endsAt || new Date(destination.endsAt) > now))
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))[0];
  return current ? { qr, destination: current } : null;
}

export async function resolveDestination(store: QrStore, slugInput: string, now = new Date()): Promise<string | null> {
  return (await resolveQrTarget(store, slugInput, now))?.destination.destinationUrl ?? null;
}
