'use client';

import { useEffect, useState } from 'react';

import { api } from '../../../../lib/api';
import type { AgentSummary } from '../../../../lib/types';
import { EmptyState } from '../../../../components/empty-states/empty-state';

function samplePercent(agentId: string) {
  return 15 + [...agentId].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 70;
}

export default function BudgetsPage() {
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get<{ items: AgentSummary[] }>('/api/v1/agents')
      .then(({ items }) => setAgents(items))
      .catch(() => setError(true));
  }, []);

  return (
    <section aria-labelledby="budgets-title">
      <h1 id="budgets-title" className="neon-glow text-2xl font-bold text-amber-warm">
        Agent Budgets
      </h1>
      <p className="mb-6 mt-1 text-sm text-cyan-soft">
        Sample usage against each agent’s configured limits. Usage figures are simulated, not live billing data.
      </p>

      {error && <p role="alert" className="border border-magenta-neon p-3 text-sm text-magenta-soft">Could not load agent budgets.</p>}
      {!error && !agents && <p role="status" className="text-sm text-amber-warm">Loading budgets…</p>}
      {agents && agents.length === 0 && <EmptyState title="No agent budgets" description="Add agents to see their configured limits and simulated usage." />}
      {agents && agents.length > 0 && (
        <div className="overflow-x-auto border border-navy-700">
          <table className="w-full min-w-[38rem] text-left text-sm">
            <caption className="sr-only">Simulated budget usage for all agents</caption>
            <thead className="border-b border-navy-700 text-xs uppercase tracking-widest text-amber-warm">
              <tr>
                <th scope="col" className="p-3">Agent</th>
                <th scope="col" className="p-3">Sample daily spend</th>
                <th scope="col" className="p-3">Sample run tokens</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => {
                const percent = samplePercent(agent.id);
                const dailySpend = Math.floor(agent.config.budgets.maxDailyCostCents * percent / 100);
                const runTokens = Math.floor(agent.config.budgets.maxTokensPerRun * percent / 100);
                return (
                  <tr key={agent.id} className="border-b border-navy-800 last:border-0">
                    <th scope="row" className="p-3 font-medium text-cyan-neon">
                      {agent.displayName}<span className="ml-2 text-xs text-cyan-soft/60">{agent.id}</span>
                    </th>
                    <td className="p-3 text-cyan-soft">
                      <div>¢{dailySpend.toLocaleString()} / ¢{agent.config.budgets.maxDailyCostCents.toLocaleString()} per day</div>
                      <div className="mt-2 h-2 bg-navy-800" role="meter" aria-label={`${agent.displayName} sample daily budget use`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                        <div className="h-full bg-cyan-neon" style={{ width: `${percent}%` }} />
                      </div>
                    </td>
                    <td className="p-3 text-cyan-soft">
                      <div>{runTokens.toLocaleString()} / {agent.config.budgets.maxTokensPerRun.toLocaleString()} tokens per run</div>
                      <div className="mt-2 h-2 bg-navy-800" role="meter" aria-label={`${agent.displayName} sample run token use`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                        <div className="h-full bg-magenta-neon" style={{ width: `${percent}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
