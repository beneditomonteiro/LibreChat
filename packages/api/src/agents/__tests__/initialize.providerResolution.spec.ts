const mockGetProviderConfig = jest.fn();
const mockExtractLibreChatParams = jest.fn();
const mockGetModelMaxTokens = jest.fn();
const mockOptionalChainWithEmptyCheck = jest.fn();
const mockGetThreadData = jest.fn();

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@librechat/agents', () => ({
  Providers: {
    OPENAI: 'openAI',
    AZURE: 'azureOpenAI',
    ANTHROPIC: 'anthropic',
    GOOGLE: 'google',
  },
  Constants: {
    NO_PARENT: 'NO_PARENT',
    TOOL_SEARCH: 'tool_search',
    SKILL_TOOL: 'skill',
  },
  CODE_EXECUTION_TOOLS: new Set(['execute_code', 'bash_tool', 'read_file']),
  BashExecutionToolDefinition: {
    name: 'bash_tool',
    schema: { type: 'object', properties: {} },
  },
  ReadFileToolDefinition: {
    name: 'read_file',
    description: 'read file',
    parameters: { type: 'object', properties: {} },
    responseFormat: 'content',
  },
  SkillToolDefinition: {
    name: 'skill',
    description: 'skill',
    parameters: { type: 'object', properties: {} },
  },
  buildBashExecutionToolDescription: jest.fn(() => 'bash'),
  formatSkillCatalog: jest.fn(() => []),
}));

jest.mock('@librechat/agents/langchain/messages', () => ({
  HumanMessage: class HumanMessage {
    constructor(init?: Record<string, unknown>) {
      Object.assign(this, init);
    }
  },
}));

jest.mock('~/endpoints', () => ({
  getProviderConfig: (...args: unknown[]) => mockGetProviderConfig(...args),
}));

jest.mock('~/utils', () => ({
  extractLibreChatParams: (...args: unknown[]) => mockExtractLibreChatParams(...args),
  getModelMaxTokens: (...args: unknown[]) => mockGetModelMaxTokens(...args),
  optionalChainWithEmptyCheck: (...args: unknown[]) => mockOptionalChainWithEmptyCheck(...args),
  getThreadData: (...args: unknown[]) => mockGetThreadData(...args),
}));

jest.mock('~/files', () => ({
  filterFilesByEndpointConfig: jest.fn(() => []),
}));

jest.mock('~/prompts', () => ({
  generateArtifactsPrompt: jest.fn(() => null),
}));

jest.mock('../resources', () => ({
  primeResources: jest.fn().mockResolvedValue({
    attachments: [],
    tool_resources: undefined,
  }),
}));

import { Providers } from '@librechat/agents';
import { EModelEndpoint } from 'librechat-data-provider';
import type { ServerRequest } from '~/types';
import { initializeAgent } from '../initialize';

describe('initializeAgent provider resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockExtractLibreChatParams.mockReturnValue({
      resendFiles: false,
      maxContextTokens: 1000,
      modelOptions: { model: 'qwen3:8b' },
    });
    mockGetModelMaxTokens.mockReturnValue(200000);
    mockOptionalChainWithEmptyCheck.mockImplementation((...values: unknown[]) =>
      values.find((value) => value !== undefined && value !== null),
    );
    mockGetProviderConfig.mockImplementation(({ provider }: { provider: string }) => ({
      getOptions: jest.fn().mockResolvedValue({
        llmConfig: { model: 'qwen3:8b', maxTokens: 4096 },
        endpointTokenConfig: undefined,
      }),
      overrideProvider: provider,
    }));
    mockGetThreadData.mockReturnValue({ fileIds: [] });
  });

  it('maps a persisted agents record to the configured backend provider before provider lookup', async () => {
    const req = {
      user: { id: 'user-1' },
      config: {
        endpoints: {
          agents: {
            allowedProviders: [Providers.OPENAI],
          },
          openAI: {
            modelNames: ['qwen3:8b'],
          },
        },
      },
      body: {},
    } as unknown as ServerRequest;

    const res = {} as unknown as import('express').Response;
    const agent = {
      id: 'document-analyst-001',
      provider: EModelEndpoint.agents,
      model: 'qwen3:8b',
      model_parameters: { useResponsesApi: true, model: 'qwen3:8b' },
      tools: [],
    } as unknown as import('librechat-data-provider').Agent;

    const loadTools = jest.fn().mockResolvedValue({
      tools: [],
      toolContextMap: {},
      dynamicToolContextMap: {},
      userMCPAuthMap: undefined,
      toolDefinitions: [],
      hasDeferredTools: false,
      actionsEnabled: false,
    });

    const db = {
      getFiles: jest.fn().mockResolvedValue([]),
      getConvoFiles: jest.fn().mockResolvedValue([]),
      updateFilesUsage: jest.fn().mockResolvedValue([]),
      getToolFilesByIds: jest.fn().mockResolvedValue([]),
    };

    await initializeAgent(
      {
        req,
        res,
        agent,
        loadTools,
        endpointOption: { endpoint: EModelEndpoint.agents },
        allowedProviders: new Set([Providers.OPENAI]),
        isInitialAgent: true,
      },
      db as never,
    );

    expect(mockGetProviderConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: Providers.OPENAI,
        appConfig: req.config,
      }),
    );
    expect(agent.provider).toBe(Providers.OPENAI);
    expect(agent.endpoint).toBe(Providers.OPENAI);
  });
});
