import { validateAgentModel } from './validation';

describe('validateAgentModel', () => {
  const req = {} as Parameters<typeof validateAgentModel>[0]['req'];
  const res = {} as Parameters<typeof validateAgentModel>[0]['res'];
  const logViolation = jest.fn();
  const modelsConfig = {
    agents: ['qwen3:8b', 'gpt-4o-mini'],
  } as Parameters<typeof validateAgentModel>[0]['modelsConfig'];

  beforeEach(() => {
    logViolation.mockReset();
  });

  it('accepts a top-level model on the agent', async () => {
    const result = await validateAgentModel({
      req,
      res,
      logViolation,
      modelsConfig,
      agent: {
        id: 'agent_1',
        provider: 'agents',
        model: 'qwen3:8b',
      },
    } as Parameters<typeof validateAgentModel>[0]);

    expect(result.isValid).toBe(true);
  });

  it('falls back to model_parameters.model when model is missing', async () => {
    const result = await validateAgentModel({
      req,
      res,
      logViolation,
      modelsConfig,
      agent: {
        id: 'agent_1',
        provider: 'agents',
        model_parameters: { model: 'qwen3:8b' },
      },
    } as Parameters<typeof validateAgentModel>[0]);

    expect(result.isValid).toBe(true);
  });

  it('still rejects agents with no resolvable model', async () => {
    const result = await validateAgentModel({
      req,
      res,
      logViolation,
      modelsConfig,
      agent: {
        id: 'agent_1',
        provider: 'agents',
        model_parameters: { useResponsesApi: true },
      },
    } as Parameters<typeof validateAgentModel>[0]);

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
      modelsConfig: {},
      agent: {
        id: 'document-analyst-001',
        provider: 'agents',
        model: 'qwen3:8b',
        model_parameters: { useResponsesApi: true },
      },
    } as Parameters<typeof validateAgentModel>[0]);

    expect(result.isValid).toBe(true);
  });
});
