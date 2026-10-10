/**
 * Handsfree Typed Local AI Client
 * Connects to local Qwen2.5-1.5B-Instruct running via Ollama or llama.cpp (OpenAI-compatible server).
 * Enforces strict JSON schema validation, timeout handling, cancellation, and prompt-injection defense.
 */

import { ActionPlan, LocalAIConfig, PageAccessibilityContext } from '../../types/ai';
import { ActionPlanValidator } from './ActionPlanSchema';
import { QwenPromptBuilder } from './QwenPromptBuilder';

export interface LocalAIClientResponse {
  success: boolean;
  plan?: ActionPlan;
  error?: string;
  source: 'LOCAL_QWEN' | 'RULE_FALLBACK';
  latencyMs: number;
}

export class LocalAIClient {
  private static instance: LocalAIClient | null = null;
  private currentAbortController: AbortController | null = null;
  private isProcessing: boolean = false;
  private lastExecutedUtterance: string = '';
  private lastExecutionTime: number = 0;

  private constructor() {}

  public static getInstance(): LocalAIClient {
    if (!LocalAIClient.instance) {
      LocalAIClient.instance = new LocalAIClient();
    }
    return LocalAIClient.instance;
  }

  public getIsProcessing(): boolean {
    return this.isProcessing;
  }

  /**
   * Cancel any in-flight local AI generation request
   */
  public cancelActiveRequest(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
    this.isProcessing = false;
  }

  /**
   * Query Qwen2.5-1.5B-Instruct to convert voice instruction + page context into a validated ActionPlan
   */
  public async generateActionPlan(
    userInstruction: string,
    context?: PageAccessibilityContext,
    config?: LocalAIConfig
  ): Promise<LocalAIClientResponse> {
    const startTime = performance.now();
    const cleanInstruction = userInstruction.trim();

    if (!cleanInstruction) {
      return {
        success: false,
        error: 'Empty voice instruction.',
        source: 'RULE_FALLBACK',
        latencyMs: 0,
      };
    }

    // Prevent immediate duplicate executions within 800ms
    const now = Date.now();
    if (
      this.lastExecutedUtterance.toLowerCase() === cleanInstruction.toLowerCase() &&
      now - this.lastExecutionTime < 800
    ) {
      return {
        success: false,
        error: 'Duplicate command ignored.',
        source: 'RULE_FALLBACK',
        latencyMs: performance.now() - startTime,
      };
    }

    // Cancel any previous in-flight request
    this.cancelActiveRequest();
    this.currentAbortController = new AbortController();
    this.isProcessing = true;

    const activeConfig: LocalAIConfig = config || {
      enabled: true,
      provider: 'OLLAMA',
      endpoint: 'http://localhost:11434',
      model: 'qwen2.5:1.5b',
      temperature: 0.1,
      maxTokens: 512,
      timeoutMs: 8000,
    };

    const timeoutMs = activeConfig.timeoutMs || 8000;
    const timeoutTimer = setTimeout(() => {
      if (this.currentAbortController) {
        this.currentAbortController.abort();
      }
    }, timeoutMs);

    try {
      const rawText = await this.dispatchToEndpoint(
        cleanInstruction,
        context,
        activeConfig,
        this.currentAbortController.signal
      );
      clearTimeout(timeoutTimer);

      this.lastExecutedUtterance = cleanInstruction;
      this.lastExecutionTime = Date.now();

      // Safely parse JSON from LLM output (repairing markdown fences if present)
      const parsedJson = this.extractAndRepairJson(rawText);
      if (!parsedJson) {
        return {
          success: false,
          error: 'Model did not return valid JSON action plan.',
          source: 'LOCAL_QWEN',
          latencyMs: performance.now() - startTime,
        };
      }

      // Validate against strict Zod ActionPlanSchema
      const validation = ActionPlanValidator.safeValidate(parsedJson);
      if (!validation.success || !validation.plan) {
        return {
          success: false,
          error: `Schema validation error: ${validation.error}`,
          source: 'LOCAL_QWEN',
          latencyMs: performance.now() - startTime,
        };
      }

      return {
        success: true,
        plan: validation.plan,
        source: 'LOCAL_QWEN',
        latencyMs: performance.now() - startTime,
      };
    } catch (err: any) {
      clearTimeout(timeoutTimer);
      const isAborted = err.name === 'AbortError' || this.currentAbortController?.signal.aborted;
      const errorMsg = isAborted
        ? `Request timed out after ${timeoutMs}ms or was cancelled.`
        : `Local AI request failed: ${err.message || String(err)}`;

      return {
        success: false,
        error: errorMsg,
        source: 'RULE_FALLBACK',
        latencyMs: performance.now() - startTime,
      };
    } finally {
      this.isProcessing = false;
      this.currentAbortController = null;
    }
  }

  /**
   * Dispatch HTTP request to either Ollama or OpenAI-compatible (llama-server) endpoint
   */
  private async dispatchToEndpoint(
    instruction: string,
    context: PageAccessibilityContext | undefined,
    config: LocalAIConfig,
    signal: AbortSignal
  ): Promise<string> {
    const base = config.endpoint.replace(/\/+$/, '');
    const userPrompt = QwenPromptBuilder.buildUserPrompt(instruction, context);
    const systemPrompt = QwenPromptBuilder.getSystemPrompt();

    // Check if endpoint is Ollama native API
    if (config.provider === 'OLLAMA' || base.includes('11434')) {
      return await this.callOllamaApi(base, config.model, systemPrompt, userPrompt, config, signal);
    }

    // Default to OpenAI-compatible endpoint (llama-server or v1/chat/completions)
    return await this.callOpenAiCompatibleApi(base, config.model, systemPrompt, userPrompt, config, signal);
  }

  /**
   * Ollama /api/chat or /api/generate
   */
  private async callOllamaApi(
    base: string,
    model: string,
    systemPrompt: string,
    userPrompt: string,
    config: LocalAIConfig,
    signal: AbortSignal
  ): Promise<string> {
    const url = `${base}/api/chat`;
    const messages = [
      { role: 'system', content: systemPrompt },
      ...QwenPromptBuilder.getFewShotMessages().slice(1), // user/assistant exemplars
      { role: 'user', content: userPrompt },
    ];

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        format: 'json', // Ollama native structured output
        stream: false,
        options: {
          temperature: config.temperature ?? 0.1,
          num_predict: config.maxTokens ?? 512,
        },
      }),
      signal,
    });

    if (!response.ok) {
      // Fallback to /api/generate if /api/chat is not supported
      if (response.status === 404) {
        return await this.callOllamaGenerateFallback(base, model, systemPrompt, userPrompt, config, signal);
      }
      const errBody = await response.text();
      throw new Error(`Ollama server returned status ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    return data.message?.content || data.response || '';
  }

  private async callOllamaGenerateFallback(
    base: string,
    model: string,
    systemPrompt: string,
    userPrompt: string,
    config: LocalAIConfig,
    signal: AbortSignal
  ): Promise<string> {
    const prompt = `${systemPrompt}\n\n${userPrompt}`;
    const response = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        format: 'json',
        stream: false,
        options: {
          temperature: config.temperature ?? 0.1,
          num_predict: config.maxTokens ?? 512,
        },
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama generate failed with status ${response.status}`);
    }
    const data = await response.json();
    return data.response || '';
  }

  /**
   * OpenAI-compatible API (/v1/chat/completions) as provided by llama-server
   */
  private async callOpenAiCompatibleApi(
    base: string,
    model: string,
    systemPrompt: string,
    userPrompt: string,
    config: LocalAIConfig,
    signal: AbortSignal
  ): Promise<string> {
    const url = `${base}/v1/chat/completions`;
    const messages = [
      { role: 'system', content: systemPrompt },
      ...QwenPromptBuilder.getFewShotMessages().slice(1),
      { role: 'user', content: userPrompt },
    ];

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: config.temperature ?? 0.1,
        max_tokens: config.maxTokens ?? 512,
        response_format: { type: 'json_object' },
      }),
      signal,
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`OpenAI-compatible server returned status ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    const messageContent = data.choices?.[0]?.message?.content;
    return messageContent || '';
  }

  /**
   * Safe JSON extraction and repair (handles markdown fences, trailing commas, etc.)
   */
  public extractAndRepairJson(raw: string): any | null {
    if (!raw || !raw.trim()) return null;

    let text = raw.trim();

    // Strip markdown code fences (```json ... ``` or ``` ...)
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch && fenceMatch[1]) {
      text = fenceMatch[1].trim();
    }

    // Try direct parse first
    try {
      return JSON.parse(text);
    } catch {
      // Continue to repair attempts
    }

    // Extract first outermost balanced JSON object { ... }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const candidate = text.substring(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        // Strip trailing commas before closing braces/brackets
        const cleaned = candidate
          .replace(/,\s*}/g, '}')
          .replace(/,\s*]/g, ']');
        try {
          return JSON.parse(cleaned);
        } catch {
          // Fall through
        }
      }
    }

    return null;
  }

  /**
   * Test connection to the local model runtime with detailed diagnostics
   */
  public async testConnection(config?: LocalAIConfig): Promise<{
    connected: boolean;
    models: string[];
    message: string;
    serverType?: 'OLLAMA' | 'LLAMA_CPP';
  }> {
    const activeConfig = config || {
      enabled: true,
      provider: 'OLLAMA',
      endpoint: 'http://localhost:11434',
      model: 'qwen2.5:1.5b',
      temperature: 0.1,
      maxTokens: 512,
      timeoutMs: 3000,
    };

    const base = activeConfig.endpoint.replace(/\/+$/, '');

    // 1. Try Ollama /api/tags
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(`${base}/api/tags`, { method: 'GET', signal: controller.signal });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        const models = (data.models || []).map((m: any) => m.name || m.model || '');
        const targetModel = activeConfig.model.toLowerCase();
        const found = models.some((m: string) => m.toLowerCase().includes(targetModel));

        return {
          connected: true,
          models,
          serverType: 'OLLAMA',
          message: found
            ? `Connected to Ollama! Model "${activeConfig.model}" is available and ready.`
            : `Connected to Ollama, but model "${activeConfig.model}" was not found. Available models: ${models.join(', ') || 'none'}. Run: ollama pull ${activeConfig.model}`,
        };
      }
    } catch {
      // Continue to OpenAI-compatible test
    }

    // 2. Try llama.cpp / OpenAI-compatible /v1/models
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(`${base}/v1/models`, { method: 'GET', signal: controller.signal });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        const models = (data.data || []).map((m: any) => m.id || '');
        return {
          connected: true,
          models,
          serverType: 'LLAMA_CPP',
          message: `Connected to llama.cpp / OpenAI-compatible server on ${activeConfig.endpoint}! Ready for Qwen2.5-1.5B-Instruct.`,
        };
      }
    } catch {
      // Failed
    }

    return {
      connected: false,
      models: [],
      message: `Could not connect to local AI at ${activeConfig.endpoint}. Ensure Ollama or local LLM (llama-server) is running on localhost. Hybrid neural rules will serve as fallback.`,
    };
  }
}
