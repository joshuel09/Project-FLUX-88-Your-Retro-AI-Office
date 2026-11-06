import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'FLUX-88',
  description: '18 Agents. One Command Center. You are in Control.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="crt-overlay" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
