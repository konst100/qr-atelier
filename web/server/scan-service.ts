export type ScanDevice = 'mobile' | 'desktop';

export type ScanRecord = {
  qrCodeId: string;
  day: string;
  device: ScanDevice;
};

export type ScanStore = {
  record(scan: ScanRecord): Promise<void>;
  listDaily(qrCodeId: string, from: string, to: string): Promise<Array<{ day: string; scans: number; deviceMobile: number; deviceDesktop: number }>>;
};

export function scanDevice(userAgent: string | null): ScanDevice {
  return /android|iphone|ipad|ipod|mobile/i.test(userAgent ?? '') ? 'mobile' : 'desktop';
}

export function scanDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export async function recordScan(store: ScanStore | undefined, qrCodeId: string, request: Request, now: Date): Promise<void> {
  if (!store) return;
  await store.record({ qrCodeId, day: scanDay(now), device: scanDevice(request.headers.get('User-Agent')) });
}
