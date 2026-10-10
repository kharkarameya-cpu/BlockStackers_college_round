/**
 * Handsfree Intent Fusion Engine
 * Fuses pointer position, spoken intent, recent context, and safety rules to produce intent decisions.
 *
 * Outomes:
 * - EXECUTE: Unambiguous, low-risk action.
 * - CLARIFY: Multiple plausible targets requiring disambiguation.
 * - CONFIRM: Consequential / high-risk target requiring explicit confirmation.
 * - REJECT: No valid interpretation.
 * - PAUSE: Tracking or system paused.
 */

import { ActionableElement, IntentDecision, ParsedVoiceCommand } from '../../types/intent';
import { SemanticResolver } from '../semantic/SemanticResolver';
import { SafetyPolicy } from '../safety/SafetyPolicy';
import { IntentShadow } from './IntentShadow';

export interface FusionInputs {
  command?: ParsedVoiceCommand;
  cursorX: number;
  cursorY: number;
  isTrackingStable: boolean;
  trackingLost: boolean;
  isPaused: boolean;
  indexedElements: ActionableElement[];
  intentShadow: IntentShadow;
  pendingConfirmationTarget?: ActionableElement | null;
}

export class IntentFusionEngine {
  /**
   * Evaluates fused multimodal inputs and produces a safety-gated intent decision
   */
  public static fuse(inputs: FusionInputs): IntentDecision {
    // 1. Paused / Tracking Lost check
    if (inputs.isPaused) {
      return {
        outcome: 'PAUSE',
        riskLevel: 'LOW',
        confidence: 0,
        reason: 'Tracking is currently paused',
      };
    }

    if (inputs.trackingLost) {
      return {
        outcome: 'PAUSE',
        riskLevel: 'LOW',
        confidence: 0,
        reason: 'Head tracking lost',
      };
    }

    const cmd = inputs.command;
    if (!cmd) {
      return {
        outcome: 'REJECT',
        riskLevel: 'LOW',
        confidence: 0,
        reason: 'No command received',
      };
    }

    // 2. Pending Confirmation Check: User says "confirm" or "yes confirm"
    if (inputs.pendingConfirmationTarget) {
      if (cmd.type === 'CONFIRM') {
        const target = inputs.pendingConfirmationTarget;
        return {
          outcome: 'EXECUTE',
          target,
          command: cmd,
          riskLevel: SafetyPolicy.classifyRisk(target),
          confidence: 1.0,
          reason: 'User explicitly confirmed high-risk action',
        };
      } else if (cmd.type === 'CANCEL') {
        return {
          outcome: 'REJECT',
          command: cmd,
          riskLevel: 'LOW',
          confidence: 1.0,
          reason: 'User cancelled pending confirmation',
        };
      }
    }

    // 3. Navigation & Direct System Commands (Scroll, Back, Forward, Refresh, Cancel, Undo)
    if (
      cmd.type === 'SCROLL_UP' ||
      cmd.type === 'SCROLL_DOWN' ||
      cmd.type === 'SCROLL_TOP' ||
      cmd.type === 'SCROLL_BOTTOM' ||
      cmd.type === 'NAVIGATE_BACK' ||
      cmd.type === 'NAVIGATE_FORWARD' ||
      cmd.type === 'REFRESH_PAGE' ||
      cmd.type === 'UNDO' ||
      cmd.type === 'CANCEL' ||
      cmd.type === 'START_DICTATION' ||
      cmd.type === 'STOP_DICTATION' ||
      cmd.type === 'STOP_LISTENING' ||
      cmd.type === 'START_LISTENING'
    ) {
      return {
        outcome: 'EXECUTE',
        command: cmd,
        riskLevel: 'LOW',
        confidence: 1.0,
        reason: `Direct voice command: ${cmd.type}`,
      };
    }

    // 4. Contextual Resolution via IntentShadow ("that one", "click that")
    if (cmd.targetQuery) {
      const shadowTarget = inputs.intentShadow.resolveContextualTarget(cmd.targetQuery);
      if (shadowTarget) {
        const risk = SafetyPolicy.classifyRisk(shadowTarget);
        if (risk === 'HIGH') {
          return {
            outcome: 'CONFIRM',
            target: shadowTarget,
            command: cmd,
            riskLevel: 'HIGH',
            confidence: 0.95,
            reason: 'Contextual target resolved, but action is high-risk and requires confirmation',
          };
        }

        return {
          outcome: 'EXECUTE',
          target: shadowTarget,
          command: cmd,
          riskLevel: risk,
          confidence: 0.95,
          reason: `Resolved via recent interaction context ("${shadowTarget.accessibleName || shadowTarget.visibleText}")`,
        };
      }
    }

    // 5. Semantic Matching against DOM Elements
    const query = cmd.targetQuery || cmd.rawText;
    const matches = SemanticResolver.resolve(query, inputs.indexedElements, {
      superlative: cmd.superlative,
      ordinalIndex: cmd.ordinalIndex,
      cursorX: inputs.cursorX,
      cursorY: inputs.cursorY,
    });

    if (matches.length === 0) {
      return {
        outcome: 'REJECT',
        command: cmd,
        riskLevel: 'LOW',
        confidence: 0,
        reason: `No matching elements found for "${query}"`,
      };
    }

    // 6. Ambiguity Check: Do multiple top candidates compete?
    if (SemanticResolver.isAmbiguous(matches)) {
      const topCandidates = matches.slice(0, 3);
      // Register candidates in IntentShadow so user can say "the second one" or "first one"
      topCandidates.forEach((c) => {
        inputs.intentShadow.registerHypothesis(c.candidate, 'VOICE_CANDIDATE');
      });

      return {
        outcome: 'CLARIFY',
        candidates: topCandidates,
        command: cmd,
        riskLevel: 'LOW',
        confidence: topCandidates[0].score,
        reason: `Ambiguous match: multiple elements match "${query}". Please choose.`,
      };
    }

    // 7. Single Clear Candidate Match
    const topMatch = matches[0];
    const candidate = topMatch.candidate;
    const risk = SafetyPolicy.classifyRisk(candidate);

    // Register top candidate in IntentShadow
    inputs.intentShadow.registerHypothesis(candidate, 'VOICE_CANDIDATE');

    // 8. Risk Gate: Consequential actions require explicit CONFIRM
    if (risk === 'HIGH') {
      return {
        outcome: 'CONFIRM',
        target: candidate,
        command: cmd,
        riskLevel: 'HIGH',
        confidence: topMatch.score,
        reason: `High-risk action (${topMatch.explanation}): Requires explicit user confirmation`,
      };
    }

    // 9. Safe execution
    return {
      outcome: 'EXECUTE',
      target: candidate,
      command: cmd,
      riskLevel: risk,
      confidence: topMatch.score,
      reason: topMatch.explanation,
    };
  }
}
