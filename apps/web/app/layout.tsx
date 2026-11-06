import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'FLUX-88',
  description: '18 Agents. One Command Center. You are in Control.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: 'ui-monospace, Menlo, monospace',
          background: '#0b1026',
          color: '#9ff0ff',
          minHeight: '100vh',
        }}
      >
        {children}
      </body>
    </html>
  );
}
