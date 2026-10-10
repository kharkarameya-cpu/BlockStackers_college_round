/**
 * Handsfree Local AI Engine
 * Decomposes complex natural language sentences into structured browser actions using local models (e.g. Qwen via Ollama)
 * with continuous in-context learning and zero-downtime hybrid rule fallback.
 */

import { ActionPlan, ComplexParseResult, LocalAIConfig, PageAccessibilityContext } from '../../types/ai';
import { ParsedVoiceCommand } from '../../types/intent';
import { SpeechController } from '../speech/SpeechController';
import { SettingsService } from '../storage/SettingsService';
import { IntentLearningEngine } from './IntentLearningEngine';
import { LocalAIClient } from './LocalAIClient';

export class LocalAIEngine {
  private static instance: LocalAIEngine | null = null;
  private config: LocalAIConfig | null = null;
  private learningEngine: IntentLearningEngine;

  private constructor() {
    this.learningEngine = IntentLearningEngine.getInstance();
  }

  public static getInstance(): LocalAIEngine {
    if (!LocalAIEngine.instance) {
      LocalAIEngine.instance = new LocalAIEngine();
    }
    return LocalAIEngine.instance;
  }

  public async getConfig(): Promise<LocalAIConfig> {
    if (!this.config) {
      this.config = await SettingsService.getLocalAIConfig();
    }
    return this.config;
  }

  public async updateConfig(newConfig: LocalAIConfig): Promise<void> {
    this.config = newConfig;
    await SettingsService.saveLocalAIConfig(newConfig);
  }

  /**
   * Test connection to local Ollama / Qwen server
   */
  public async testConnection(config?: LocalAIConfig): Promise<{
    connected: boolean;
    models: string[];
    message: string;
  }> {
    const activeConfig = config || (await this.getConfig());
    return await LocalAIClient.getInstance().testConnection(activeConfig);
  }

  /**
   * Main entry point: Parse complex or compound sentence into sequential actions
   */
  public async parseComplexSentence(
    text: string,
    context?: PageAccessibilityContext
  ): Promise<ComplexParseResult> {
    const startTime = performance.now();
    const cleanText = text.trim();

    if (!cleanText) {
      return {
        actions: [],
        confidence: 0,
        source: 'HYBRID_RULE',
        explanation: 'Empty utterance',
        latencyMs: 0,
      };
    }

    // Step 1: Check Exact Personal Alias (e.g. "school down" -> SCROLL_DOWN)
    const exactAlias = this.learningEngine.resolveExactAlias(cleanText);
    if (exactAlias) {
      return {
        actions: [exactAlias],
        confidence: 1.0,
        source: 'EXACT_ALIAS',
        explanation: exactAlias.explanation || `Matched personal alias for "${cleanText}"`,
        latencyMs: performance.now() - startTime,
      };
    }

    // Step 2: Check Learned Exemplar Bank (<2ms)
    const learned = this.learningEngine.findLearnedExemplar(cleanText);
    if (learned && learned.actions.length > 0) {
      return {
        actions: learned.actions,
        confidence: learned.confidence,
        source: 'LEARNED_EXEMPLAR',
        explanation: `Recalled from user experience (${learned.timesUsed} prior uses)`,
        latencyMs: performance.now() - startTime,
      };
    }

    // Step 3: Try Local Qwen / Ollama Model via LocalAIClient if enabled
    const config = await this.getConfig();
    if (config.enabled) {
      try {
        const clientRes = await LocalAIClient.getInstance().generateActionPlan(
          cleanText,
          context,
          config
        );
        if (clientRes.success && clientRes.plan) {
          const convertedActions = LocalAIEngine.convertPlanToVoiceCommands(
            clientRes.plan,
            cleanText
          );
          if (convertedActions.length > 0) {
            return {
              actions: convertedActions,
              actionPlan: clientRes.plan,
              confidence: 0.95,
              source: 'LOCAL_QWEN',
              explanation: clientRes.plan.reason || `Interpreted by Qwen (${config.model})`,
              latencyMs: clientRes.latencyMs,
            };
          }
        }
      } catch (e) {
        console.warn('[Handsfree AI] Local Qwen query skipped or timed out, using hybrid fallback:', e);
      }
    }

    // Step 4: Hybrid Rule & Conjunction Decomposition Fallback
    const hybridActions = this.decomposeWithHybridRules(cleanText);
    return {
      actions: hybridActions,
      confidence: 0.85,
      source: 'HYBRID_RULE',
      explanation: 'Parsed with hybrid multi-clause intent analyzer',
      latencyMs: performance.now() - startTime,
    };
  }

  /**
   * Convert validated ActionPlan into ParsedVoiceCommand array for compatibility
   */
  public static convertPlanToVoiceCommands(
    plan: ActionPlan,
    rawText: string
  ): ParsedVoiceCommand[] {
    const commands: ParsedVoiceCommand[] = [];

    for (const step of plan.steps) {
      switch (step.action) {
        case 'navigate':
          commands.push({
            type: 'CLICK_TARGET',
            rawText,
            targetQuery: step.url,
          });
          break;

        case 'click':
          commands.push({
            type: 'CLICK_TARGET',
            rawText,
            targetQuery: step.target.name || step.target.id || step.target.role,
            ordinalIndex: step.target.ordinalIndex,
          });
          break;

        case 'fill':
          commands.push({
            type: 'FOCUS_INPUT',
            rawText,
            targetQuery: step.target.name || step.target.id || step.target.role,
          });
          commands.push({
            type: 'TYPE_TEXT',
            rawText,
            text: step.text,
          });
          break;

        case 'press_key':
          if (step.key.toLowerCase() === 'enter') {
            commands.push({ type: 'PRESS_ENTER', rawText });
          }
          break;

        case 'scroll':
          if (step.direction === 'down') commands.push({ type: 'SCROLL_DOWN', rawText });
          else if (step.direction === 'up') commands.push({ type: 'SCROLL_UP', rawText });
          else if (step.direction === 'top') commands.push({ type: 'SCROLL_TOP', rawText });
          else if (step.direction === 'bottom') commands.push({ type: 'SCROLL_BOTTOM', rawText });
          break;

        case 'go_back':
          commands.push({ type: 'NAVIGATE_BACK', rawText });
          break;

        case 'clarify':
          commands.push({
            type: 'CANCEL',
            rawText,
            explanation: step.question,
          });
          break;
      }
    }

    return commands;
  }

  /**
   * Deterministic clause decomposition and intent extraction
   * Breaks compound sentences like:
   * "scroll down a little and click pricing"
   * "search for flights to Mumbai and press enter"
   * "focus search bar, type mechanical keyboards, and hit enter"
   */
  public decomposeWithHybridRules(sentence: string): ParsedVoiceCommand[] {
    const clean = sentence.trim();
    if (!clean) return [];

    // Split compound sentence by clause delimiters
    const clauses = clean
      .split(/\s+(?:and\s+then|after\s+that|then|and|also)\s+|[;,]+/i)
      .map((c) => c.trim())
      .filter(Boolean);

    const actions: ParsedVoiceCommand[] = [];

    for (const clause of clauses) {
      const lower = clause.toLowerCase();

      // Check for search + type pattern: "search for shoes", "search shoes"
      const searchMatch = clause.match(/^(?:search\s+for|look\s+up|google)\s+(.+)$/i);
      if (searchMatch && searchMatch[1]) {
        actions.push({
          type: 'FOCUS_INPUT',
          rawText: clause,
          targetQuery: 'search',
        });
        actions.push({
          type: 'TYPE_TEXT',
          rawText: clause,
          text: searchMatch[1].trim(),
        });
        continue;
      }

      // Check for type/insert pattern: "type hello world", "write my email"
      const typeMatch = clause.match(/^(?:type|write|enter|input)\s+(.+)$/i);
      if (typeMatch && typeMatch[1]) {
        actions.push({
          type: 'TYPE_TEXT',
          rawText: clause,
          text: typeMatch[1].trim(),
        });
        continue;
      }

      // Check for enter key: "press enter", "hit enter", "submit form"
      if (lower.includes('press enter') || lower.includes('hit enter') || lower === 'enter') {
        actions.push({
          type: 'PRESS_ENTER',
          rawText: clause,
        });
        continue;
      }

      // Check for tab controls: "open new tab", "close tab", "next tab"
      if (lower === 'new tab' || lower === 'open new tab') {
        actions.push({ type: 'NEW_TAB', rawText: clause });
        continue;
      }
      if (lower === 'close tab') {
        actions.push({ type: 'CLOSE_TAB', rawText: clause });
        continue;
      }
      if (lower === 'next tab') {
        actions.push({ type: 'NEXT_TAB', rawText: clause });
        continue;
      }
      if (lower === 'previous tab' || lower === 'prev tab') {
        actions.push({ type: 'PREVIOUS_TAB', rawText: clause });
        continue;
      }
      if (lower.includes('settings') || lower === 'open settings') {
        actions.push({ type: 'OPEN_SETTINGS', rawText: clause });
        continue;
      }

      // Use standard grammar parser for the clause
      const parsed = SpeechController.parseCommand(clause);
      if (parsed.type !== 'UNKNOWN') {
        actions.push(parsed);
      } else {
        // Fallback target action
        actions.push({
          type: 'CLICK_TARGET',
          rawText: clause,
          targetQuery: clause,
        });
      }
    }

    return actions.length > 0 ? actions : [SpeechController.parseCommand(sentence)];
  }
}
