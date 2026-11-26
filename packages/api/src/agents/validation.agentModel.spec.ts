import type { TModelsConfig } from 'librechat-data-provider';
import { validateAgentModel } from './validation';

describe('validateAgentModel', () => {
  const req = {} as Parameters<typeof validateAgentModel>[0]['req'];
  const res = {} as Parameters<typeof validateAgentModel>[0]['res'];
  const logViolation = jest.fn();

  /** Builds getEndpointModels resolving to a catalog where 'agents' lists the given models. */
  const endpointModels = (agentsModels: string[]) =>
    jest.fn().mockResolvedValue({ agents: agentsModels } as TModelsConfig);

  beforeEach(() => {
    logViolation.mockReset();
  });

  it('accepts a top-level model on the agent', async () => {
    const result = await validateAgentModel({
      req,
      res,
      logViolation,
      getEndpointModels: endpointModels(['qwen3:8b', 'gpt-4o-mini']),
      agent: {
        id: 'agent_1',
        provider: 'agents',
        model: 'qwen3:8b',
      },
    } as unknown as Parameters<typeof validateAgentModel>[0]);

    expect(result.isValid).toBe(true);
  });

  it('falls back to model_parameters.model when model is missing', async () => {
    const result = await validateAgentModel({
      req,
      res,
      logViolation,
      getEndpointModels: endpointModels(['qwen3:8b', 'gpt-4o-mini']),
      agent: {
        id: 'agent_1',
        provider: 'agents',
        model_parameters: { model: 'qwen3:8b' },
      },
    } as unknown as Parameters<typeof validateAgentModel>[0]);

    expect(result.isValid).toBe(true);
  });

  it('still rejects agents with no resolvable model', async () => {
    const result = await validateAgentModel({
      req,
      res,
      logViolation,
      getEndpointModels: endpointModels(['qwen3:8b', 'gpt-4o-mini']),
      agent: {
        id: 'agent_1',
        provider: 'agents',
        model_parameters: { useResponsesApi: true },
      },
    } as unknown as Parameters<typeof validateAgentModel>[0]);

    expect(result.isValid).toBe(false);
    expect(result.error?.message).toContain('"type": "missing_model"');
    expect(result.error?.message).toContain('"info": "agents"');
    expect(logViolation).not.toHaveBeenCalled();
  });

  it('allows agents endpoint validation when the agent models list is not loaded', async () => {
    const result = await validateAgentModel({
      req,
      res,
      logViolation,
      // No 'agents' key at all, matching a genuinely unloaded models catalog
      // (an empty list would still be a defined, if empty, catalog entry).
      getEndpointModels: jest.fn().mockResolvedValue({}),
      agent: {
        id: 'document-analyst-001',
        provider: 'agents',
        model: 'qwen3:8b',
        model_parameters: { useResponsesApi: true },
      },
    } as unknown as Parameters<typeof validateAgentModel>[0]);

    expect(result.isValid).toBe(true);
  });
});
