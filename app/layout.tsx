import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'PrimeCapture Connect', description: 'A calmer control room. Secure Page connections and production-safe broadcast preparation.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
