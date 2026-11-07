import { AgentDirectory } from '../../../../components/agents/agent-directory';

export const metadata = { title: 'Agent Directory — FLUX-88' };

export default function AgentDirectoryPage() {
  return (
    <section aria-labelledby="directory-title">
      <h1 id="directory-title" className="neon-glow text-2xl font-bold text-amber-warm">
        Agent Directory
      </h1>
      <p className="mb-6 mt-1 text-sm text-cyan-soft">
        All 18 specialists, grouped by department. Select an agent to inspect its permissions and
        rules.
      </p>
      <AgentDirectory />
    </section>
  );
}
