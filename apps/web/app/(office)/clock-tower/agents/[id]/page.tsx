'use client';

import { use, useEffect, useState, type FormEvent } from 'react';

import { api, ApiRequestError } from '../../../../../lib/api';
import type { AgentSummary } from '../../../../../lib/types';
import { StatusBadge } from '../../../../../components/simulated-badge';

/** Agent detail: permissions/rules viewer + presentation editor (T019). */
export default function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [agent, setAgent] = useState<AgentSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [personality, setPersonality] = useState('');

  useEffect(() => {
    api
      .get<AgentSummary>(`/api/v1/agents/${id}`)
      .then((a) => {
        setAgent(a);
        setPersonality(a.personality);
      })
      .catch(() => setError('Unknown agent.'));
  }, [id]);

  async function savePresentation(e: FormEvent) {
    e.preventDefault();
    setNotice(null);
    try {
      const updated = await api.patch<AgentSummary>(`/api/v1/agents/${id}/config`, { personality });
      setAgent(updated);
      setNotice('Saved.');
    } catch (err) {
      setNotice(err instanceof ApiRequestError ? err.message : 'Save failed.');
    }
  }

  if (error) return <p role="alert" className="text-magenta-soft">{error}</p>;
  if (!agent) return <p role="status" className="text-sm text-amber-warm">Loading agent…</p>;

  return (
    <section aria-labelledby="agent-title" className="flex flex-col gap-6">
      <header>
        <div className="flex items-center gap-3">
          <h1 id="agent-title" className="neon-glow text-2xl font-bold text-cyan-neon">
            {agent.displayName}
          </h1>
          <StatusBadge status={agent.status} />
        </div>
        <p className="mt-1 text-sm text-cyan-soft">{agent.roleSummary}</p>
      </header>

      <form onSubmit={savePresentation} className="flex flex-col gap-2">
        <label htmlFor="personality" className="text-sm uppercase tracking-widest text-amber-warm">
          Personality (presentation only — never affects permissions)
        </label>
        <textarea
          id="personality"
          value={personality}
          onChange={(e) => setPersonality(e.target.value)}
          rows={2}
          className="border border-navy-700 bg-navy-950 p-2 text-sm text-cyan-soft focus:border-cyan-neon focus:outline-none"
        />
        <div className="flex items-center gap-3">
          <button type="submit" className="w-fit border border-cyan-neon px-3 py-1 text-sm text-cyan-neon hover:bg-navy-800">
            Save
          </button>
          {notice && <p role="status" className="text-xs text-amber-warm">{notice}</p>}
        </div>
      </form>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <RuleList title="Allowed tools" items={agent.config.allowedTools} tone="cyan" />
        <RuleList title="Data scopes" items={agent.config.dataScopes} tone="cyan" />
        <RuleList title="Prohibited operations" items={agent.config.prohibitedOps} tone="magenta" />
        <RuleList title="Handoff targets" items={agent.config.handoffTargets} tone="cyan" />
        <RuleList title="Approval required for" items={agent.config.escalation.approvalRequired} tone="amber" />
        <RuleList title="Escalates when" items={agent.config.escalation.criteria} tone="amber" />
        <RuleList title="Memory read" items={agent.config.memory.read} tone="cyan" />
        <RuleList title="Memory write" items={agent.config.memory.write} tone="cyan" />
      </div>

      <section aria-labelledby="budget-title" className="border border-navy-700 p-3">
        <h2 id="budget-title" className="text-sm uppercase tracking-widest text-amber-warm">
          Budgets
        </h2>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          <BudgetItem label="Tokens / run" value={agent.config.budgets.maxTokensPerRun.toLocaleString()} />
          <BudgetItem label="Runtime" value={`${agent.config.budgets.maxRuntimeMs / 1000}s`} />
          <BudgetItem label="Retries" value={String(agent.config.budgets.maxRetries)} />
          <BudgetItem label="Daily cost" value={`¢${agent.config.budgets.maxDailyCostCents}`} />
        </dl>
      </section>

      <p className="border border-dashed border-navy-700 p-3 text-xs text-cyan-soft/80">
        Changing tools, scopes, prohibited operations, handoffs, memory access or budgets requires
        an approval request (constitution I) — that flow arrives with the approvals slice.
      </p>
    </section>
  );
}

function RuleList({ title, items, tone }: { title: string; items: string[]; tone: 'cyan' | 'magenta' | 'amber' }) {
  const toneClass = { cyan: 'text-cyan-soft', magenta: 'text-magenta-soft', amber: 'text-amber-warm' }[tone];
  return (
    <section className="border border-navy-700 p-3">
      <h2 className="text-sm uppercase tracking-widest text-amber-warm">{title}</h2>
      <ul className={`mt-2 flex flex-col gap-1 text-sm ${toneClass}`}>
        {items.length === 0 && <li className="text-cyan-soft/60">— none —</li>}
        {items.map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
    </section>
  );
}

function BudgetItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-cyan-soft/70">{label}</dt>
      <dd className="text-cyan-neon">{value}</dd>
    </div>
  );
}
