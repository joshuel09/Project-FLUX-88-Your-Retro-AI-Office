/** API response shapes used by the dashboard (contracts/api.md). */

export interface AgentSummary {
  id: string;
  displayName: string;
  department: 'management' | 'design' | 'engineering' | 'content_business';
  officeArea: string;
  roleSummary: string;
  personality: string;
  enabled: boolean;
  status: 'idle' | 'running' | 'blocked';
  config: {
    allowedTools: string[];
    dataScopes: string[];
    prohibitedOps: string[];
    handoffTargets: string[];
    escalation: { criteria: string[]; approvalRequired: string[] };
    memory: { read: string[]; write: string[] };
    budgets: {
      maxTokensPerRun: number;
      maxRuntimeMs: number;
      maxRetries: number;
      maxDailyCostCents: number;
    };
    objectives: string[];
  };
}

export const DEPARTMENT_LABELS: Record<AgentSummary['department'], string> = {
  management: 'Management & Operations',
  design: 'Design — The Arcade',
  engineering: 'Engineering — The Garage',
  content_business: 'Content & Business',
};
