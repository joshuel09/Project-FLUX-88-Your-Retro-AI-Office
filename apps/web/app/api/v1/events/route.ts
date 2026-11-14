export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3001';

export async function GET(request: Request) {
  const upstream = await fetch(new URL('/api/v1/events', API_ORIGIN), {
    headers: { cookie: request.headers.get('cookie') ?? '' },
    cache: 'no-store',
    signal: request.signal,
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
