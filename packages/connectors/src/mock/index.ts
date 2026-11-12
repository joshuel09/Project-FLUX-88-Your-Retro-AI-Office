import type { ConnectorAdapter, ConnectorProvider } from '../adapter.js';

function mockAdapter(provider: ConnectorProvider, label: string): ConnectorAdapter {
  return {
    provider,
    mode: 'read_only',
    health: () => ({
      status: 'mock',
      message: 'Local mock adapter is ready; no remote service was contacted.',
      checkedAt: new Date().toISOString(),
      simulated: true,
    }),
    readOverview: () => ({ provider, label, itemCount: 1, simulated: true }),
  };
}

export const MOCK_CONNECTOR_ADAPTERS: readonly ConnectorAdapter[] = [
  mockAdapter('github', 'Demo repository'),
  mockAdapter('discord', 'Demo channel'),
  mockAdapter('trello', 'Demo board'),
];

export function getMockConnectorAdapter(provider: string): ConnectorAdapter | undefined {
  return MOCK_CONNECTOR_ADAPTERS.find((adapter) => adapter.provider === provider);
}
