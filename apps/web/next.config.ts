import type { NextConfig } from 'next';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Same-origin proxy to the API so session cookies flow without CORS.
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` },
      { source: '/health', destination: `${API_ORIGIN}/health` },
    ];
  },
};

export default nextConfig;
