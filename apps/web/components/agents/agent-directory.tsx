'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { api } from '../../lib/api';
import { DEPARTMENT_LABELS, type AgentSummary } from '../../lib/types';
import { EmptyState } from '../empty-states/empty-state';
import { StatusBadge } from '../simulated-badge';

const DEPARTMENT_ORDER: AgentSummary['department'][] = [
  'management',
  'design',
  'engineering',
  'content_business',
];

/** Live agent directory grouped by department (T016, FR-051). */
export function AgentDirectory({ areaFilter }: { areaFilter?: string }) {
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ items: AgentSummary[] }>('/api/v1/agents')
      .then((res) => setAgents(res.items))
      .catch(() => setError('Could not load the agent roster.'));
  }, []);

  if (error) {
    return (
      <p role="alert" className="border border-magenta-neon p-3 text-sm text-magenta-soft">
        {error}
      </p>
    );
  }
  if (!agents) {
    return (
      <p role="status" className="text-sm text-amber-warm">
        Loading roster…
      </p>
    );
  }

  const visible = areaFilter ? agents.filter((a) => a.officeArea === areaFilter) : agents;
  if (areaFilter) {
    return <AgentGrid agents={visible} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {DEPARTMENT_ORDER.map((dept) => {
        const members = visible.filter((a) => a.department === dept);
        if (members.length === 0) return null;
        return (
          <section key={dept} aria-labelledby={`dept-${dept}`}>
            <h2 id={`dept-${dept}`} className="mb-2 text-sm uppercase tracking-widest text-amber-warm">
              {DEPARTMENT_LABELS[dept]} ({members.length})
            </h2>
            <AgentGrid agents={members} />
          </section>
        );
      })}
      {visible.length === 0 && <EmptyState title="No agents found" description="No agents are assigned to this area yet." />}
    </div>
  );
}

function AgentGrid({ agents }: { agents: AgentSummary[] }) {
  if (agents.length === 0) {
    return <EmptyState title="No agents found" description="No agents are assigned to this area yet." />;
  }
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="agent-grid">
      {agents.map((agent) => (
        <li key={agent.id}>
          <Link
            href={`/clock-tower/agents/${agent.id}`}
            className="flex h-full flex-col gap-1 border border-navy-700 p-3 hover:border-cyan-neon"
            data-testid="agent-card"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="neon-glow font-bold text-cyan-neon">{agent.displayName}</span>
              <StatusBadge status={agent.status} />
            </span>
            <span className="text-xs text-cyan-soft">{agent.roleSummary}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
