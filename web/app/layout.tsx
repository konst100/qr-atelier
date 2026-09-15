import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'QR Atelier — QR-коды / QR-Codes',
  description: 'QR-коды для ссылок, текста, Wi-Fi и контактов. QR-Codes gestalten und herunterladen.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ru"><body>{children}</body></html>;
}

