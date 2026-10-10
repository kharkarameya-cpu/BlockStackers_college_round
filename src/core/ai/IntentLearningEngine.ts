/**
 * Handsfree Intent Learning Engine
 * Manages accent-aware personal aliases, adaptive exemplar memory, and few-shot in-context learning.
 */

import { CommandAlias, LearnedIntentExemplar } from '../../types/ai';
import { ParsedVoiceCommand, VoiceCommandType } from '../../types/intent';
import { SettingsService } from '../storage/SettingsService';

export class IntentLearningEngine {
  private static instance: IntentLearningEngine | null = null;
  private exemplars: LearnedIntentExemplar[] = [];
  private aliases: CommandAlias[] = [];
  private isLoaded: boolean = false;

  public get isReady(): boolean {
    return this.isLoaded;
  }

  private constructor() {
    this.loadMemory();
  }

  public static getInstance(): IntentLearningEngine {
    if (!IntentLearningEngine.instance) {
      IntentLearningEngine.instance = new IntentLearningEngine();
    }
    return IntentLearningEngine.instance;
  }

  /**
   * Normalize sentence for consistent exact and fuzzy comparisons
   */
  public static normalize(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, '')
      .replace(/\s+/g, ' ');
  }

  /**
   * Load learned exemplars and aliases from persistent storage
   */
  public async loadMemory(): Promise<void> {
    try {
      this.exemplars = await SettingsService.getLearnedExemplars();
      this.aliases = await SettingsService.getCommandAliases();
      this.isLoaded = true;
    } catch (e) {
      console.warn('[Handsfree Learning] Error loading memory:', e);
    }
  }

  /**
   * Check for an exact personal command alias (e.g. "school down" -> SCROLL_DOWN)
   */
  public resolveExactAlias(rawText: string): ParsedVoiceCommand | null {
    const normalized = IntentLearningEngine.normalize(rawText);
    const found = this.aliases.find((a) => a.normalizedPhrase === normalized);
    if (!found) return null;

    found.usageCount++;
    found.updatedAt = Date.now();
    SettingsService.saveCommandAliases(this.aliases).catch(() => {});

    return {
      type: found.commandType,
      rawText,
      targetQuery: found.targetQuery,
      text: found.text,
      aliasPhrase: found.phrase,
      explanation: `Matched personal alias "${found.phrase}"`,
    };
  }

  /**
   * Check learned exemplar bank for high-confidence exact or fuzzy match
   */
  public findLearnedExemplar(rawText: string, threshold: number = 0.88): LearnedIntentExemplar | null {
    const normalized = IntentLearningEngine.normalize(rawText);
    if (!normalized) return null;

    // 1. Exact match
    const exact = this.exemplars.find(
      (e) => e.normalizedSentence === normalized && e.confidence >= 0.5
    );
    if (exact) {
      exact.timesUsed++;
      exact.lastUsedAt = Date.now();
      SettingsService.saveLearnedExemplars(this.exemplars).catch(() => {});
      return exact;
    }

    // 2. Token-level similarity for slight speech variations
    const queryTokens = new Set(normalized.split(' '));
    let bestScore = 0;
    let bestMatch: LearnedIntentExemplar | null = null;

    for (const exemplar of this.exemplars) {
      if (exemplar.confidence < 0.55) continue;
      const targetTokens = new Set(exemplar.normalizedSentence.split(' '));

      let intersection = 0;
      for (const tok of queryTokens) {
        if (targetTokens.has(tok)) intersection++;
      }

      const union = new Set([...queryTokens, ...targetTokens]).size;
      const jaccard = union > 0 ? intersection / union : 0;

      if (jaccard > bestScore) {
        bestScore = jaccard;
        bestMatch = exemplar;
      }
    }

    if (bestScore >= threshold && bestMatch) {
      bestMatch.timesUsed++;
      bestMatch.lastUsedAt = Date.now();
      SettingsService.saveLearnedExemplars(this.exemplars).catch(() => {});
      return bestMatch;
    }

    return null;
  }

  /**
   * Record positive learning when a complex sequence executes successfully
   */
  public async recordSuccess(
    rawSentence: string,
    actions: ParsedVoiceCommand[],
    source: LearnedIntentExemplar['source'] = 'LLM_DECOMPOSED'
  ): Promise<void> {
    const normalized = IntentLearningEngine.normalize(rawSentence);
    if (!normalized || actions.length === 0) return;

    const existing = this.exemplars.find((e) => e.normalizedSentence === normalized);
    if (existing) {
      existing.timesUsed++;
      existing.confidence = Math.min(1.0, existing.confidence + 0.1);
      existing.actions = actions;
      existing.lastUsedAt = Date.now();
    } else {
      const newExemplar: LearnedIntentExemplar = {
        id: `ex-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        rawSentence,
        normalizedSentence: normalized,
        actions,
        confidence: 0.8,
        timesUsed: 1,
        timesUndone: 0,
        source,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      };
      this.exemplars.push(newExemplar);
    }

    await SettingsService.saveLearnedExemplars(this.exemplars);
  }

  /**
   * Record negative feedback when user reverses or undoes an action
   */
  public async recordUndo(rawSentence: string): Promise<void> {
    const normalized = IntentLearningEngine.normalize(rawSentence);
    const existing = this.exemplars.find((e) => e.normalizedSentence === normalized);
    if (existing) {
      existing.timesUndone++;
      existing.confidence = Math.max(0.1, existing.confidence - 0.25);
      existing.lastUsedAt = Date.now();

      // If user repeatedly undid this interpretation, deactivate it
      if (existing.timesUndone >= 3 && existing.confidence < 0.4) {
        this.exemplars = this.exemplars.filter((e) => e.id !== existing.id);
      }

      await SettingsService.saveLearnedExemplars(this.exemplars);
    }
  }

  /**
   * Teach an explicit alias (per Section 7 correction workflow)
   */
  public async teachAlias(
    phrase: string,
    commandType: VoiceCommandType,
    targetQuery?: string,
    text?: string
  ): Promise<CommandAlias> {
    const cleanPhrase = phrase.trim();
    const normalized = IntentLearningEngine.normalize(cleanPhrase);

    // Remove any existing duplicate mapping for this phrase
    this.aliases = this.aliases.filter((a) => a.normalizedPhrase !== normalized);

    const alias: CommandAlias = {
      id: `alias-${Date.now()}`,
      phrase: cleanPhrase,
      normalizedPhrase: normalized,
      commandType,
      targetQuery,
      text,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
    };

    this.aliases.push(alias);
    await SettingsService.saveCommandAliases(this.aliases);

    // Also add to learned exemplars as a high-confidence mapping
    await this.recordSuccess(
      cleanPhrase,
      [{ type: commandType, rawText: cleanPhrase, targetQuery, text }],
      'TEACH_ALIAS'
    );

    return alias;
  }

  /**
   * Delete a learned exemplar by ID
   */
  public async deleteExemplar(id: string): Promise<void> {
    this.exemplars = this.exemplars.filter((e) => e.id !== id);
    await SettingsService.saveLearnedExemplars(this.exemplars);
  }

  /**
   * Delete an alias by ID
   */
  public async deleteAlias(id: string): Promise<void> {
    this.aliases = this.aliases.filter((a) => a.id !== id);
    await SettingsService.saveCommandAliases(this.aliases);
  }

  /**
   * Retrieve learned exemplars formatted as few-shot training prompts for Qwen / LLM
   */
  public getFewShotPromptExemplars(limit: number = 4): string {
    // Pick the most frequently and successfully used exemplars
    const sorted = [...this.exemplars]
      .filter((e) => e.confidence >= 0.6)
      .sort((a, b) => b.timesUsed - a.timesUsed)
      .slice(0, limit);

    if (sorted.length === 0) {
      return [
        'User: "scroll down and click on pricing"',
        'Output: [{"type":"SCROLL_DOWN"},{"type":"CLICK_TARGET","targetQuery":"pricing"}]',
        'User: "search for shoes and press enter"',
        'Output: [{"type":"FOCUS_INPUT","targetQuery":"search"},{"type":"TYPE_TEXT","text":"shoes"},{"type":"PRESS_ENTER"}]',
      ].join('\n');
    }

    return sorted
      .map(
        (e) =>
          `User: "${e.rawSentence}"\nOutput: ${JSON.stringify(
            e.actions.map((a) => ({
              type: a.type,
              ...(a.targetQuery ? { targetQuery: a.targetQuery } : {}),
              ...(a.text ? { text: a.text } : {}),
              ...(a.ordinalIndex !== undefined ? { ordinalIndex: a.ordinalIndex } : {}),
            }))
          )}`
      )
      .join('\n');
  }

  public getExemplars(): LearnedIntentExemplar[] {
    return this.exemplars;
  }

  public getAliases(): CommandAlias[] {
    return this.aliases;
  }
}
