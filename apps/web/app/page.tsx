import { AGENT_IDS, OFFICE_AREAS } from '@flux88/core';

export default function Home() {
  return (
    <main style={{ padding: '4rem 1rem', maxWidth: 720, margin: '0 auto' }}>
      <p
        style={{
          border: '1px solid #ff3df0',
          color: '#ff9df5',
          padding: '0.5rem 1rem',
          display: 'inline-block',
        }}
      >
        MOCK MODE — simulated activity only
      </p>
      <h1 style={{ color: '#5df3ff', textShadow: '0 0 12px #0ff' }}>FLUX-88</h1>
      <p>18 Agents. One Command Center. You&apos;re in Control.</p>
      <p style={{ color: '#ffd37a' }}>
        Phase 0b scaffold — {AGENT_IDS.length} agents registered, {OFFICE_AREAS.length} office
        areas planned. The dashboard arrives in Phase 1 (see
        specs/001-flux-88-platform/plan.md).
      </p>
    </main>
  );
}
