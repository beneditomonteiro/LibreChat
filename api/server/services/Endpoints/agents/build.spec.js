const mockLoadAgentFn = jest.fn();
const mockGetMCPServerTools = jest.fn();

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@librechat/api', () => ({
  loadAgent: (...args) => mockLoadAgentFn(...args),
}));

jest.mock('~/server/services/Config', () => ({
  getMCPServerTools: (...args) => mockGetMCPServerTools(...args),
}));

jest.mock('~/models', () => ({
  getAgent: jest.fn(),
}));

const { buildOptions } = require('./build');
const { Constants } = require('librechat-data-provider');

describe('agents buildOptions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadAgentFn.mockResolvedValue({ id: 'agent_123', provider: 'agents', model: 'qwen3:8b' });
  });

  it('falls back to the raw request agent_id when the parsed body omits it', async () => {
    const req = {
      body: {
        agent_id: 'agent_123',
        addedConvo: undefined,
      },
    };

    const result = buildOptions(
      req,
      'agents',
      {
        model: 'qwen3:8b',
        temperature: 0.2,
      },
      'agents',
    );

    expect(mockLoadAgentFn).toHaveBeenCalledWith(
      expect.objectContaining({
        req,
        endpoint: 'agents',
        agent_id: 'agent_123',
        model_parameters: expect.objectContaining({
          model: 'qwen3:8b',
          temperature: 0.2,
        }),
      }),
      expect.objectContaining({
        getAgent: expect.any(Function),
        getMCPServerTools: expect.any(Function),
      }),
    );

    expect(result.agent_id).toBe('agent_123');
    await expect(result.agent).resolves.toEqual({
      id: 'agent_123',
      provider: 'agents',
      model: 'qwen3:8b',
    });
  });

  it('keeps ephemeral agent ids for non-agents endpoints', async () => {
    const req = {
      body: {
        agent_id: 'agent_123',
      },
    };

    const result = buildOptions(
      req,
      'openai',
      {
        model: 'gpt-4o',
      },
      'openai',
    );

    expect(mockLoadAgentFn).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: Constants.EPHEMERAL_AGENT_ID,
        endpoint: 'openai',
      }),
      expect.any(Object),
    );
    expect(result.agent_id).toBe(Constants.EPHEMERAL_AGENT_ID);
  });
});
