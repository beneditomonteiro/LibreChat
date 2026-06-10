import { Constants } from 'librechat-data-provider';
import type { Agent, AgentModelParameters } from 'librechat-data-provider';
import { loadAgent } from './load';

jest.mock('~/app/config', () => ({
  getCustomEndpointConfig: jest.fn(),
}));

describe('loadAgent agent id resolution', () => {
  const getMCPServerTools = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    getMCPServerTools.mockResolvedValue(null);
  });

  it('loads a persisted agent even when its id does not use the agent_ prefix', async () => {
    const getAgent = jest.fn().mockResolvedValue({
      id: 'document-analyst-001',
      model: 'qwen3:8b',
      provider: 'agents',
      model_parameters: {
        useResponsesApi: true,
      },
    } as unknown as Agent);

    const result = await loadAgent(
      {
        req: { user: { id: 'user123' } } as never,
        agent_id: 'document-analyst-001',
        endpoint: 'agents',
        model_parameters: {
          useResponsesApi: true,
        } as unknown as AgentModelParameters,
      },
      {
        getAgent,
        getMCPServerTools,
      },
    );

    expect(getAgent).toHaveBeenCalledWith({ id: 'document-analyst-001' });
    expect(result).toEqual(
      expect.objectContaining({
        id: 'document-analyst-001',
        model: 'qwen3:8b',
        provider: 'agents',
      }),
    );
    expect(result?.model_parameters).toEqual(
      expect.objectContaining({
        useResponsesApi: true,
        model: 'qwen3:8b',
      }),
    );
  });

  it('still falls back to the ephemeral agent loader when no persisted agent exists', async () => {
    const getAgent = jest.fn().mockResolvedValue(null);

    const result = await loadAgent(
      {
        req: {
          user: { id: 'user123' },
          body: {
            promptPrefix: 'Test instructions',
            ephemeralAgent: {
              execute_code: false,
              web_search: false,
              mcp: [],
            },
          },
        } as never,
        agent_id: Constants.EPHEMERAL_AGENT_ID as string,
        endpoint: 'openai',
        model_parameters: {
          model: 'gpt-4',
        } as unknown as AgentModelParameters,
      },
      {
        getAgent,
        getMCPServerTools,
      },
    );

    expect(getAgent).toHaveBeenCalledWith({ id: Constants.EPHEMERAL_AGENT_ID });
    expect(result?.id).toBe('openai__gpt-4');
    expect(result?.provider).toBe('openai');
    expect(result?.model).toBe('gpt-4');
  });
});
