import { AgentDirectory } from '../../../components/agents/agent-directory';
import { MemoryVault } from '../../../components/memory/memory-vault';

export const metadata = { title: 'The Memory Vault — FLUX-88' };

/** Dedicated Memory Vault area page (T037) — overrides the generic [area] route. */
export default function MemoryVaultPage() {
  return (
    <section aria-labelledby="area-title" className="flex flex-col gap-6">
      <header>
        <h1 id="area-title" className="neon-glow text-2xl font-bold text-cyan-neon">
          The Memory Vault
        </h1>
        <p className="mt-1 text-sm text-cyan-soft">
          Searchable knowledge hub — every entry carries its author, source and verification status.
        </p>
      </header>

      <MemoryVault />

      <section aria-labelledby="area-agents">
        <h2 id="area-agents" className="mb-2 text-sm uppercase tracking-widest text-amber-warm">
          Stationed agents
        </h2>
        <AgentDirectory areaFilter="memory-vault" />
      </section>
    </section>
  );
}
