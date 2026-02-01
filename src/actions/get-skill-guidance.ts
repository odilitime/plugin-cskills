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
    'SKILL_HELP',
    'HOW_TO',
    'GET_INSTRUCTIONS',
    'LEARN_SKILL',
  ],
  description: 'Get guidance on how to accomplish a task. Automatically finds and uses the best skill from ClawHub. Use when you need instructions for a specific capability.',

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

      // Step 1: Check installed skills first (fast path)
      const installedSkills = service.getLoadedSkills();
      const localMatch = findBestLocalMatch(installedSkills, query);

      if (localMatch && localMatch.score >= 5) {
        // Good local match - use it
        const instructions = service.getSkillInstructions(localMatch.skill.slug);
        return buildSuccessResult(localMatch.skill, instructions, 'local', callback);
      }

      // Step 2: Search ClawHub for a better match
      const searchResults = await service.search(query, 5);

      if (searchResults.length === 0) {
        // No results - return local match if any, or nothing
        if (localMatch) {
          const instructions = service.getSkillInstructions(localMatch.skill.slug);
          return buildSuccessResult(localMatch.skill, instructions, 'local', callback);
        }

        const text = `I couldn't find a specific skill for "${query}". I'll do my best with my general knowledge.`;
        if (callback) await callback({ text });
        return { success: true, text, data: { found: false } };
      }

      // Step 3: Check if best remote result is better than local
      const bestRemote = searchResults[0];
      const remoteScore = bestRemote.score * 30; // Normalize ClawHub scores (0-1 range) to our scale

      if (localMatch && localMatch.score >= remoteScore) {
        // Local is good enough
        const instructions = service.getSkillInstructions(localMatch.skill.slug);
        return buildSuccessResult(localMatch.skill, instructions, 'local', callback);
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
 * Find the best matching skill from installed skills
 */
function findBestLocalMatch(skills: Skill[], query: string): { skill: Skill; score: number } | null {
  const queryLower = query.toLowerCase();
  let bestMatch: { skill: Skill; score: number } | null = null;

  for (const skill of skills) {
    let score = 0;

    // Slug match
    if (queryLower.includes(skill.slug.toLowerCase())) {
      score += 10;
    }

    // Name match
    if (queryLower.includes(skill.name.toLowerCase())) {
      score += 8;
    }

    // Keyword matches from description
    const words = skill.description.toLowerCase().split(/\s+/);
    for (const word of words) {
      if (word.length > 4 && queryLower.includes(word)) {
        score += 2;
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
