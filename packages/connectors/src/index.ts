export type {
  ConnectorAdapter,
  ConnectorHealth,
  ConnectorOverview,
  ConnectorProvider,
  GitHubFeedback,
  GitHubFeedbackPage,
  GitHubFeedbackReader,
  GitHubFeedbackType,
  GitHubRateLimit,
  GitHubSyncRequest,
} from './adapter.js';
export { getMockConnectorAdapter, MOCK_CONNECTOR_ADAPTERS } from './mock/index.js';
export {
  GITHUB_FEEDBACK_MOCK_FIXTURES,
  MAX_GITHUB_FEEDBACK_EXCERPT_LENGTH,
} from './mock/index.js';
export type { GitHubFeedbackMockFixture, GitHubFeedbackMockScenario } from './mock/index.js';
