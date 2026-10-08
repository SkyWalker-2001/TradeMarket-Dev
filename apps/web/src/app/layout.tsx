import type { Metadata } from 'next';
import './globals.css';
import './routes.css';

export const metadata: Metadata = {
  title: 'Trade Market — Trade smarter',
  description: 'A paper trading and market insights demo.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
