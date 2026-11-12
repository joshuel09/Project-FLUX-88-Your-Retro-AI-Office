export type ConnectorProvider = 'github' | 'discord' | 'trello';

export interface ConnectorHealth {
  status: 'mock';
  message: string;
  checkedAt: string;
  simulated: true;
}

export interface ConnectorOverview {
  provider: ConnectorProvider;
  label: string;
  itemCount: number;
  simulated: true;
}

/** Read-only contract; write operations are intentionally absent. */
export interface ConnectorAdapter {
  readonly provider: ConnectorProvider;
  readonly mode: 'read_only';
  health(): ConnectorHealth;
  readOverview(): ConnectorOverview;
}
