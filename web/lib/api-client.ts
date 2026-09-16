export type ApiAccount = {
  id: string;
  email: string;
  displayName: string;
  emailVerifiedAt: string | null;
  createdAt: string;
};

export type ApiQrCode = {
  id: string;
  workspaceId: string;
  slug: string;
  kind: string;
  name: string;
  status: 'active' | 'paused' | 'expired' | 'archived';
  designJson: string;
  folderId: string | null;
  campaignId: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  destinationUrl?: string | null;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  let body: unknown = null;
  try { body = await response.json(); } catch { /* empty response, for example logout */ }
  if (!response.ok) {
    const code = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'networkError';
    throw new ApiError(response.status, code);
  }
  return body as T;
}

export function registerAccount(input: { email: string; password: string; displayName?: string }) {
  return request<{ account: ApiAccount }>('/api/auth/register', { method: 'POST', body: JSON.stringify(input) });
}

export function loginAccount(input: { email: string; password: string }) {
  return request<{ account: ApiAccount }>('/api/auth/login', { method: 'POST', body: JSON.stringify(input) });
}

export function currentAccount() {
  return request<{ account: ApiAccount | null }>('/api/auth/me');
}

export function logoutAccount() {
  return request<void>('/api/auth/logout', { method: 'POST' });
}

export function listRemoteQrCodes() {
  return request<{ workspace: { id: string; name: string }; qrCodes: ApiQrCode[] }>('/api/qr');
}

export function createRemoteQrCode(input: { slug: string; kind: string; name: string; destinationUrl?: string; designJson?: string }) {
  return request<{ qrCode: ApiQrCode }>('/api/qr', { method: 'POST', body: JSON.stringify(input) });
}

export function updateRemoteQrCode(id: string, input: { name?: string; status?: ApiQrCode['status']; destinationUrl?: string; designJson?: string }) {
  return request<{ qrCode: ApiQrCode }>(`/api/qr/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function archiveRemoteQrCode(id: string) {
  return request<void>(`/api/qr/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export type QrStatistics = {
  qrCodeId: string; from: string; to: string; total: number;
  daily: Array<{ day: string; scans: number; deviceMobile: number; deviceDesktop: number }>;
};

export function getQrStatistics(id: string, from: string, to: string) {
  const range = new URLSearchParams({ from, to });
  return request<QrStatistics>(`/api/qr/${encodeURIComponent(id)}/stats?${range}`);
}
