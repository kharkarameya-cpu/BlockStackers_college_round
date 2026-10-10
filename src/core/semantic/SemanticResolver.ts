/**
 * Handsfree Semantic Resolver
 * Matches natural-language requests and queries to actionable DOM elements.
 */

import { ActionableElement, SemanticMatch } from '../../types/intent';

export class SemanticResolver {
  /**
   * Resolves a spoken query against indexed DOM elements
   */
  public static resolve(
    query: string,
    elements: ActionableElement[],
    options: {
      superlative?: 'CHEAPEST' | 'FIRST' | 'LAST';
      ordinalIndex?: number;
      cursorX?: number;
      cursorY?: number;
    } = {}
  ): SemanticMatch[] {
    if (!elements || elements.length === 0) return [];

    // Filter out disabled or stale elements
    const validElements = elements.filter(
      (el) => !el.isDisabled && SemanticResolver.isElementValid(el)
    );

    // 1. Superlative Mode: "choose the cheapest option"
    if (options.superlative === 'CHEAPEST') {
      const pricedElements = validElements.filter((el) => el.price !== undefined);
      if (pricedElements.length > 0) {
        pricedElements.sort((a, b) => (a.price || 0) - (b.price || 0));
        return pricedElements.map((candidate, idx) => ({
          candidate,
          score: idx === 0 ? 0.95 : Math.max(0.4, 0.9 - idx * 0.15),
          matchType: 'SUPERLATIVE',
          explanation: `Priced at $${candidate.price} (${idx === 0 ? 'lowest price' : 'higher option'})`,
        }));
      }
    }

    // 2. Ordinal Mode: "the second result" or "number 3"
    if (options.ordinalIndex !== undefined && options.ordinalIndex >= 0) {
      if (options.ordinalIndex < validElements.length) {
        const target = validElements[options.ordinalIndex];
        return [
          {
            candidate: target,
            score: 0.96,
            matchType: 'ORDINAL',
            explanation: `Selected item #${options.ordinalIndex + 1} from page list`,
          },
        ];
      }
    }

    // 3. Natural-Language Semantic Matching
    const normalizedQuery = SemanticResolver.normalizeText(query);
    if (!normalizedQuery) return [];

    const matches: SemanticMatch[] = [];

    for (const el of validElements) {
      const accName = SemanticResolver.normalizeText(el.accessibleName);
      const ariaLabel = SemanticResolver.normalizeText(el.ariaLabel);
      const visibleText = SemanticResolver.normalizeText(el.visibleText);
      const role = SemanticResolver.normalizeText(el.role);
      const container = SemanticResolver.normalizeText(el.containerContext || '');

      let score = 0;
      let matchType: SemanticMatch['matchType'] = 'FUZZY';
      let explanation = '';

      // Direct exact match
      if (accName === normalizedQuery || ariaLabel === normalizedQuery || visibleText === normalizedQuery) {
        score = 0.98;
        matchType = 'EXACT';
        explanation = `Exact match on "${el.accessibleName || el.visibleText}"`;
      }
      // Query is prefix or contains full name
      else if (accName.startsWith(normalizedQuery) || visibleText.startsWith(normalizedQuery)) {
        score = 0.88;
        matchType = 'FUZZY';
        explanation = `Prefix match on "${el.accessibleName || el.visibleText}"`;
      }
      // Query is substring
      else if (accName.includes(normalizedQuery) || visibleText.includes(normalizedQuery)) {
        score = 0.82;
        matchType = 'FUZZY';
        explanation = `Substring match on "${el.accessibleName || el.visibleText}"`;
      } else {
        // Token overlap similarity (Jaccard similarity)
        const tokenScore = SemanticResolver.computeTokenOverlap(normalizedQuery, `${accName} ${ariaLabel} ${visibleText} ${role} ${container}`);
        if (tokenScore > 0.35) {
          score = Math.min(0.78, 0.45 + tokenScore * 0.4);
          matchType = 'FUZZY';
          explanation = `Keyword overlap (${Math.round(tokenScore * 100)}%) on "${el.accessibleName || el.visibleText}"`;
        }
      }

      // Proximity boost if cursor position is provided (pointer + voice fusion)
      if (score > 0.4 && options.cursorX !== undefined && options.cursorY !== undefined) {
        const dist = Math.hypot(el.centerX - options.cursorX, el.centerY - options.cursorY);
        // Elements within 150px get up to +0.10 boost
        const proximityBoost = Math.max(0, (150 - dist) / 150) * 0.10;
        score = Math.min(1.0, score + proximityBoost);
      }

      if (score >= 0.45) {
        matches.push({
          candidate: el,
          score,
          matchType,
          explanation,
        });
      }
    }

    // Sort descending by score
    matches.sort((a, b) => b.score - a.score);
    return matches;
  }

  /**
   * Evaluates if candidate element is still connected, visible, and active in the DOM
   */
  public static isElementValid(element: ActionableElement): boolean {
    if (!element || !element.element) return false;
    if (typeof document !== 'undefined' && !document.contains(element.element)) {
      return false;
    }
    const rect = element.element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    return true;
  }

  /**
   * Determine if top candidates are ambiguous (requires CLARIFY)
   */
  public static isAmbiguous(matches: SemanticMatch[]): boolean {
    if (matches.length < 2) return false;
    const top = matches[0];
    const second = matches[1];

    // If top match is overwhelmingly confident (> 0.92) and second is lower by 0.15+, not ambiguous
    if (top.score >= 0.92 && top.score - second.score >= 0.15) {
      return false;
    }

    // If both have high confidence and are close within 0.12, it is ambiguous
    return top.score >= 0.65 && second.score >= 0.60 && Math.abs(top.score - second.score) < 0.12;
  }

  public static normalizeText(text: string): string {
    return (text || '')
      .toLowerCase()
      .replace(/[^\w\s$€£]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private static computeTokenOverlap(query: string, target: string): number {
    const qTokens = new Set(query.split(' ').filter((w) => w.length > 1));
    const tTokens = new Set(target.split(' ').filter((w) => w.length > 1));
    if (qTokens.size === 0 || tTokens.size === 0) return 0;

    let overlap = 0;
    qTokens.forEach((token) => {
      if (tTokens.has(token)) overlap++;
    });

    const union = new Set([...qTokens, ...tTokens]).size;
    return overlap / union;
  }
}
