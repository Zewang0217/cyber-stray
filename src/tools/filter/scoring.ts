import { consola } from '../../logger.js';
import type { SearchResult, AgentState } from '../../types.js';

const logger = consola.withTag('filter-scoring');

export interface ScoringResult extends SearchResult {
  score: number;
  reason: string;
}

function textMatchesKeywords(text: string, keywords: string[]): boolean {
  const lowerText = text.toLowerCase();
  return keywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
}

export function calculateScore(
  result: SearchResult,
  state: AgentState,
  topic?: string,
): ScoringResult {
  let score = 0.5;
  const reasons: string[] = [];

  if (state.userLikes.length > 0) {
    const titleMatch = textMatchesKeywords(result.title, state.userLikes);
    const contentMatch = textMatchesKeywords(result.content, state.userLikes);

    if (titleMatch || contentMatch) {
      score += 0.3;
      reasons.push('匹配用户喜好');
    }
  }

  if (state.userDislikes.length > 0) {
    const titleMatch = textMatchesKeywords(result.title, state.userDislikes);
    const contentMatch = textMatchesKeywords(result.content, state.userDislikes);

    if (titleMatch || contentMatch) {
      score -= 0.5;
      reasons.push('匹配用户不喜欢');
    }
  }

  if (result.content.length < 50) {
    score -= 0.2;
    reasons.push('内容过短');
  } else if (result.content.length > 200) {
    score += 0.1;
    reasons.push('内容丰富');
  }

  if (topic) {
    const topicInTitle = result.title.toLowerCase().includes(topic.toLowerCase());
    const topicInContent = result.content.toLowerCase().includes(topic.toLowerCase());

    if (topicInTitle) {
      score += 0.2;
      reasons.push('标题匹配话题');
    }
    if (topicInContent) {
      score += 0.1;
      reasons.push('内容匹配话题');
    }
  }

  score = Math.max(0, Math.min(1, score));

  return {
    ...result,
    score,
    reason: reasons.length > 0 ? reasons.join('; ') : '基础评分',
  };
}

export function scoreResults(
  results: SearchResult[],
  state: AgentState,
  topic?: string,
): ScoringResult[] {
  const scored = results.map(result => calculateScore(result, state, topic));

  const highScoreCount = scored.filter(r => r.score >= 0.5).length;
  const lowScoreCount = scored.filter(r => r.score < 0.3).length;

  logger.debug('评分完成', {
    total: results.length,
    highScore: highScoreCount,
    lowScore: lowScoreCount,
    averageScore: scored.length > 0 ? scored.reduce((sum, r) => sum + r.score, 0) / scored.length : 0,
  });

  return scored;
}