import type { Provider, IAgentRuntime, Memory, State, ProviderResult } from '@elizaos/core';
import type { ClawHubService, Skill, SkillCatalogEntry } from '../services/clawhub';

// ============================================================
// LOW RESOLUTION - Just names/slugs of available skills
// Fast, minimal context, good for awareness
// ============================================================

export const skillsOverviewProvider: Provider = {
  name: 'clawhub_skills_overview',
  description: 'Low-res list of all available skills (names only)',
  position: -20, // Very early
  dynamic: true, // Only include when explicitly requested or few skills

  get: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    const service = runtime.getService<ClawHubService>('CLAWHUB_SERVICE');
    if (!service) return { text: '' };

    const stats = service.getCatalogStats();
    const installed = service.getLoadedSkills();

    // Get catalog (from cache, no network call)
    const catalog = await service.getCatalog({ notOlderThan: Infinity }); // Use cache only

    const installedSlugs = new Set(installed.map(s => s.slug));
    const availableCount = catalog.length;

    // Just show counts and a few examples
    const examples = catalog.slice(0, 5).map(s => s.displayName).join(', ');

    const text = `**Skills:** ${stats.installed} installed, ${availableCount} available on ClawHub
Examples: ${examples}...
Use GET_SKILL_GUIDANCE to find skills for specific tasks.`;

    return {
      text,
      values: {
        installedCount: stats.installed,
        availableCount,
      },
      data: {
        installed: installed.map(s => s.slug),
        catalogSize: availableCount,
      },
    };
  },
};

// ============================================================
// MEDIUM RESOLUTION - Installed skills with summaries
// Good balance of context and size
// ============================================================

export const skillsSummaryProvider: Provider = {
  name: 'clawhub_skills',
  description: 'Medium-res list of installed skills with descriptions',
  position: -10, // Early, before action planning

  get: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    const service = runtime.getService<ClawHubService>('CLAWHUB_SERVICE');
    if (!service) return { text: '' };

    const skills = service.getLoadedSkills();

    if (skills.length === 0) {
      return {
        text: '**Skills:** None installed. Use GET_SKILL_GUIDANCE to find and install skills automatically.',
        values: { skillCount: 0 },
        data: { skills: [] },
      };
    }

    // Format installed skills with descriptions
    const skillList = skills.map((skill: Skill) => {
      const triggers = extractTriggers(skill.description);
      return `- **${skill.name}** (\`${skill.slug}\`): ${truncate(skill.description, 100)}${triggers ? ` [${triggers}]` : ''}`;
    }).join('\n');

    const text = `## Installed Skills (${skills.length})

${skillList}

*More skills available via GET_SKILL_GUIDANCE*`;

    return {
      text,
      values: {
        skillCount: skills.length,
        installedSkills: skills.map(s => s.slug).join(', '),
      },
      data: {
        skills: skills.map((s: Skill) => ({
          slug: s.slug,
          name: s.name,
          description: s.description,
          version: s.version,
        })),
      },
    };
  },
};

// ============================================================
// HIGH RESOLUTION - Full instructions for matched skills
// Only for highly relevant skills based on context
// ============================================================

export const skillInstructionsProvider: Provider = {
  name: 'clawhub_skill_instructions',
  description: 'High-res instructions from the most relevant skill',
  position: 5, // After context gathered

  get: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State
  ): Promise<ProviderResult> => {
    const service = runtime.getService<ClawHubService>('CLAWHUB_SERVICE');
    if (!service) return { text: '' };

    const skills = service.getLoadedSkills();
    if (skills.length === 0) return { text: '' };

    // Build context from message and recent history
    const messageText = (message.content?.text || '').toLowerCase();
    const recentContext = getRecentContext(state);
    const fullContext = `${messageText} ${recentContext}`.toLowerCase();

    // Score skills by relevance
    const scoredSkills = skills.map((skill: Skill) => ({
      skill,
      score: calculateSkillRelevance(skill, fullContext),
    })).filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scoredSkills.length === 0 || scoredSkills[0].score < 3) {
      return { text: '' };
    }

    const topSkill = scoredSkills[0];
    const instructions = service.getSkillInstructions(topSkill.skill.slug);

    if (!instructions) return { text: '' };

    // Truncate long instructions
    const maxLen = 4000;
    const truncatedInstructions = instructions.length > maxLen
      ? instructions.substring(0, maxLen) + '\n\n...[truncated]'
      : instructions;

    const text = `## Active Skill: ${topSkill.skill.name}

${truncatedInstructions}`;

    return {
      text,
      values: {
        activeSkill: topSkill.skill.slug,
        skillName: topSkill.skill.name,
        relevanceScore: topSkill.score,
      },
      data: {
        activeSkill: {
          slug: topSkill.skill.slug,
          name: topSkill.skill.name,
          score: topSkill.score,
        },
        otherMatches: scoredSkills.slice(1, 3).map(s => ({
          slug: s.skill.slug,
          score: s.score,
        })),
      },
    };
  },
};

// ============================================================
// CATALOG AWARENESS - Shows what's available on ClawHub
// Dynamic, only when relevant
// ============================================================

export const catalogAwarenessProvider: Provider = {
  name: 'clawhub_catalog',
  description: 'Awareness of skills available on ClawHub',
  position: 10,
  dynamic: true, // Only when asked about capabilities
  private: true, // Not included by default

  get: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    const service = runtime.getService<ClawHubService>('CLAWHUB_SERVICE');
    if (!service) return { text: '' };

    // Only activate if message seems to be about capabilities
    const text = (message.content?.text || '').toLowerCase();
    const capabilityKeywords = ['what can you', 'what skills', 'capabilities', 'what do you know', 'help with'];

    if (!capabilityKeywords.some(kw => text.includes(kw))) {
      return { text: '' };
    }

    // Get catalog summaries (from cache)
    const catalog = await service.getCatalogMedRes({ notOlderThan: Infinity });

    if (catalog.length === 0) return { text: '' };

    // Group by common categories (simple heuristic)
    const categories = groupByCategory(catalog);

    let categoryText = '';
    for (const [category, skills] of Object.entries(categories).slice(0, 8)) {
      const skillNames = skills.slice(0, 3).map(s => s.name).join(', ');
      const more = skills.length > 3 ? ` +${skills.length - 3} more` : '';
      categoryText += `- **${category}**: ${skillNames}${more}\n`;
    }

    return {
      text: `## Available Skill Categories

${categoryText}
Use GET_SKILL_GUIDANCE to find and use any skill.`,
      data: { categories },
    };
  },
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

function extractTriggers(description: string): string {
  const triggerMatch = description.match(/Triggers?:\s*([^.]+)/i);
  if (triggerMatch) return triggerMatch[1].trim();

  const useMatch = description.match(/Use (?:when|for|to)\s+([^.]+)/i);
  if (useMatch) return useMatch[1].trim();

  return '';
}

function getRecentContext(state: State): string {
  const recentMessages = state.recentMessages || state.recentMessagesData || [];
  if (Array.isArray(recentMessages)) {
    return recentMessages
      .slice(-5)
      .map((m: Memory | { content?: { text?: string } }) => m.content?.text || '')
      .join(' ');
  }
  return '';
}

function calculateSkillRelevance(skill: Skill, context: string): number {
  let score = 0;
  const contextLower = context.toLowerCase();

  // Exact slug match
  if (contextLower.includes(skill.slug.toLowerCase())) score += 10;

  // Exact name match
  if (contextLower.includes(skill.name.toLowerCase())) score += 8;

  // Keyword matches
  const keywords = extractKeywords(skill);
  for (const keyword of keywords) {
    if (contextLower.includes(keyword.toLowerCase())) score += 2;
  }

  // Trigger word matches
  const triggers = extractTriggers(skill.description);
  if (triggers) {
    const triggerWords = triggers.split(/[,;]/).map(t => t.trim().toLowerCase());
    for (const trigger of triggerWords) {
      if (trigger && contextLower.includes(trigger)) score += 3;
    }
  }

  return score;
}

function extractKeywords(skill: Skill): string[] {
  const keywords: string[] = [];

  // From name
  const nameWords = skill.name.split(/[\s-_]+/).filter(w => w.length > 3);
  keywords.push(...nameWords);

  // From description (filter stopwords)
  const stopwords = new Set([
    'the', 'and', 'for', 'with', 'this', 'that', 'from', 'will', 'can', 'are',
    'use', 'when', 'how', 'what', 'your', 'you', 'our', 'has', 'have', 'been',
  ]);

  const descWords = skill.description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 4 && !stopwords.has(w));

  keywords.push(...descWords);

  return [...new Set(keywords)];
}

function groupByCategory(
  skills: Array<{ slug: string; name: string; summary: string }>
): Record<string, Array<{ slug: string; name: string }>> {
  const categories: Record<string, Array<{ slug: string; name: string }>> = {};

  // Simple keyword-based categorization
  const categoryKeywords: Record<string, string[]> = {
    'AI & Models': ['ai', 'llm', 'model', 'gpt', 'claude', 'openai', 'anthropic'],
    'Browser & Web': ['browser', 'web', 'scrape', 'chrome', 'selenium'],
    'Code & Dev': ['code', 'python', 'javascript', 'typescript', 'git', 'dev'],
    'Data & Analytics': ['data', 'analytics', 'csv', 'json', 'database'],
    'Finance & Trading': ['trading', 'finance', 'crypto', 'market', 'prediction'],
    'Communication': ['email', 'slack', 'discord', 'telegram', 'chat'],
    'Productivity': ['calendar', 'task', 'todo', 'note', 'document'],
    'Other': [],
  };

  for (const skill of skills) {
    const text = `${skill.name} ${skill.summary}`.toLowerCase();
    let assigned = false;

    for (const [category, keywords] of Object.entries(categoryKeywords)) {
      if (category === 'Other') continue;
      if (keywords.some(kw => text.includes(kw))) {
        if (!categories[category]) categories[category] = [];
        categories[category].push({ slug: skill.slug, name: skill.name });
        assigned = true;
        break;
      }
    }

    if (!assigned) {
      if (!categories['Other']) categories['Other'] = [];
      categories['Other'].push({ slug: skill.slug, name: skill.name });
    }
  }

  return categories;
}

// Legacy export for backwards compatibility
export const skillsProvider = skillsSummaryProvider;
