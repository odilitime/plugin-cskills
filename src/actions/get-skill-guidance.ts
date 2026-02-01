import type {
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
  ActionResult,
} from '@elizaos/core';
import type { ClawHubService, Skill } from '../services/clawhub';

/**
 * Get Skill Guidance Action
 * 
 * This is the main action for skill-powered assistance. When the agent needs
 * guidance on how to do something, it calls this action which:
 * 
 * 1. Checks if a matching skill is already installed (fast)
 * 2. If not, searches ClawHub for a relevant skill
 * 3. Auto-installs the best match if found
 * 4. Returns the skill instructions
 * 
 * This provides seamless access to ClawHub's entire skill library without
 * requiring the user to manually search or install anything.
 */
export const getSkillGuidanceAction: Action = {
  name: 'GET_SKILL_GUIDANCE',
  similes: [
    'FIND_SKILL',
    'SEARCH_SKILLS',
    'SEARCH_CLAWHUB',
    'SKILL_HELP',
    'HOW_TO',
    'GET_INSTRUCTIONS',
    'LEARN_SKILL',
    'LOOKUP_SKILL',
  ],
  description: 'Search for and get skill instructions from ClawHub. Use when user asks to find, search, or look up a skill, or when you need instructions for a capability.',

  validate: async (runtime: IAgentRuntime, _message: Memory): Promise<boolean> => {
    const service = runtime.getService<ClawHubService>('CLAWHUB_SERVICE');
    return !!service;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: unknown,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      const service = runtime.getService<ClawHubService>('CLAWHUB_SERVICE');
      if (!service) {
        throw new Error('ClawHubService not available');
      }

      const query = message.content?.text || '';
      if (!query || query.length < 3) {
        return { success: false, error: new Error('Query too short') };
      }

      // Extract meaningful search terms (skip common words)
      const searchTerms = extractSearchTerms(query);
      runtime.logger.info(`ClawHub: Searching for "${searchTerms}" (from: "${query.substring(0, 50)}...")`);

      // Step 1: Search ClawHub FIRST for best match
      const searchResults = await service.search(searchTerms, 5);

      // Step 2: Also check installed skills
      const installedSkills = service.getLoadedSkills();
      const localMatch = findBestLocalMatch(installedSkills, searchTerms);

      runtime.logger.info(`ClawHub: Found ${searchResults.length} remote results, local match: ${localMatch?.skill.slug || 'none'} (score: ${localMatch?.score || 0})`);

      // Step 3: Decide best option
      const bestRemote = searchResults.length > 0 ? searchResults[0] : null;

      // Remote score is 0-1, scale to comparable range (0-30)
      // Require high confidence from remote (score > 0.25 means relevant)
      const remoteScore = bestRemote ? bestRemote.score * 100 : 0;

      // Local requires name/slug match to be considered (score >= 8)
      // Just matching description words isn't enough
      const localIsStrong = localMatch && localMatch.score >= 8;

      if (!bestRemote || (bestRemote.score < 0.25 && !localIsStrong)) {
        // No good matches anywhere
        const text = `I couldn't find a specific skill for "${searchTerms}". I'll do my best with my general knowledge.`;
        if (callback) await callback({ text });
        return { success: true, text, data: { found: false, query: searchTerms } };
      }

      // Prefer remote if it's confident, unless local is a strong name match
      const useLocal = localIsStrong && (!bestRemote || localMatch!.score >= remoteScore);

      if (useLocal && localMatch) {
        runtime.logger.info(`ClawHub: Using local skill "${localMatch.skill.slug}"`);
        const instructions = service.getSkillInstructions(localMatch.skill.slug);
        return buildSuccessResult(localMatch.skill, instructions, 'local', callback);
      }

      if (!bestRemote) {
        const text = `I couldn't find a specific skill for "${searchTerms}". I'll do my best with my general knowledge.`;
        if (callback) await callback({ text });
        return { success: true, text, data: { found: false } };
      }

      // Step 4: Auto-install the best remote skill
      const alreadyInstalled = service.getLoadedSkill(bestRemote.slug);

      if (!alreadyInstalled) {
        // Install silently
        const installed = await service.install(bestRemote.slug);
        if (!installed) {
          // Installation failed - fall back to local or general knowledge
          if (localMatch) {
            const instructions = service.getSkillInstructions(localMatch.skill.slug);
            return buildSuccessResult(localMatch.skill, instructions, 'local', callback);
          }
          const text = `Found "${bestRemote.displayName}" skill but couldn't install it. I'll help with general knowledge.`;
          if (callback) await callback({ text });
          return { success: true, text, data: { found: true, installed: false } };
        }
      }

      // Step 5: Return the installed skill's instructions
      const skill = service.getLoadedSkill(bestRemote.slug);
      const instructions = skill ? service.getSkillInstructions(skill.slug) : null;

      return buildSuccessResult(
        skill || { slug: bestRemote.slug, name: bestRemote.displayName, description: bestRemote.summary, version: bestRemote.version },
        instructions,
        alreadyInstalled ? 'local' : 'installed',
        callback
      );

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (callback) {
        await callback({ text: `I encountered an issue finding skill guidance: ${errorMsg}` });
      }
      return {
        success: false,
        error: error instanceof Error ? error : new Error(errorMsg),
      };
    }
  },

  examples: [
    [
      {
        name: '{{userName}}',
        content: { text: 'How do I do verified calculations?' },
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'I found the **RLM** skill for verified calculations. Here\'s how to use it:\n\n# RLM - Recursive Language Models\n\nExecute tasks with **verified code execution**...',
          actions: ['GET_SKILL_GUIDANCE'],
        },
      },
    ],
    [
      {
        name: '{{userName}}',
        content: { text: 'I need help with browser automation' },
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'I found the **Agent Browser** skill. Here\'s the guidance:\n\n# Agent Browser\n\nAutomates browser interactions for web testing...',
          actions: ['GET_SKILL_GUIDANCE'],
        },
      },
    ],
  ],
};

/**
 * Extract meaningful search terms from a query
 * Removes common words like "search", "find", "skill", etc.
 */
function extractSearchTerms(query: string): string {
  // First, remove platform references like "on clawhub", "from clawhub", "in clawhub"
  // These indicate WHERE to search, not WHAT to search for
  let cleaned = query.toLowerCase()
    .replace(/\b(on|in|from|at)\s+clawhub\b/g, '')
    .replace(/\bclawhub\s+(registry|platform|site|website|catalog)\b/g, '');

  const stopWords = new Set([
    // Common verbs/questions
    'search', 'find', 'look', 'for', 'a', 'an', 'the', 'skill', 'skills',
    'please', 'can', 'you', 'help', 'me', 'with', 'how', 'to', 'do', 'i',
    'need', 'want', 'get', 'use', 'using', 'about', 'is', 'are', 'there',
    'any', 'some', 'show', 'list', 'give', 'tell', 'what', 'which',
  ]);

  const words = cleaned
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopWords.has(w));

  return words.join(' ') || query.toLowerCase();
}

/**
 * Find the best matching skill from installed skills
 * Only returns matches with name/slug match (strong matches)
 */
function findBestLocalMatch(skills: Skill[], query: string): { skill: Skill; score: number } | null {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
  let bestMatch: { skill: Skill; score: number } | null = null;

  for (const skill of skills) {
    let score = 0;
    const slugLower = skill.slug.toLowerCase();
    const nameLower = skill.name.toLowerCase();

    // Exact slug match in query - highest priority
    if (queryLower.includes(slugLower) || queryWords.some(w => slugLower.includes(w) && w.length > 3)) {
      score += 10;
    }

    // Name match - also high priority
    if (queryLower.includes(nameLower) || queryWords.some(w => nameLower.includes(w) && w.length > 3)) {
      score += 8;
    }

    // Only count description words if they're specific (not generic skill terms)
    const genericWords = new Set(['skill', 'agent', 'search', 'install', 'use', 'when', 'with', 'from', 'your']);
    const descWords = skill.description.toLowerCase().split(/\s+/);
    for (const word of descWords) {
      if (word.length > 5 && !genericWords.has(word) && queryWords.includes(word)) {
        score += 1;
      }
    }

    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { skill, score };
    }
  }

  return bestMatch;
}

/**
 * Build a success result with skill instructions
 */
async function buildSuccessResult(
  skill: Skill | { slug: string; name: string; description: string; version: string },
  instructions: string | null,
  source: 'local' | 'installed',
  callback?: HandlerCallback
): Promise<ActionResult> {
  let text = `## ${skill.name}\n\n`;

  if (source === 'installed') {
    text += `*Skill installed from ClawHub*\n\n`;
  }

  text += `${skill.description}\n\n`;

  if (instructions) {
    // Truncate if too long
    const maxLen = 3500;
    const truncated = instructions.length > maxLen
      ? instructions.substring(0, maxLen) + '\n\n...[See full skill for complete instructions]'
      : instructions;
    text += `### Instructions\n\n${truncated}`;
  }

  if (callback) {
    await callback({ text, actions: ['GET_SKILL_GUIDANCE'] });
  }

  return {
    success: true,
    text,
    values: {
      activeSkill: skill.slug,
      skillName: skill.name,
      skillSource: source,
    },
    data: {
      skill: {
        slug: skill.slug,
        name: skill.name,
        description: skill.description,
      },
      instructions,
      source,
    },
  };
}
