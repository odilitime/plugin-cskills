import type {
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
  ActionResult,
} from '@elizaos/core';
import type { ClawHubService } from '../services/clawhub';

export const searchSkillsAction: Action = {
  name: 'clawhub_search',
  similes: [
    'SEARCH_SKILLS',
    'FIND_SKILLS',
    'CLAWHUB_SEARCH',
    'LOOK_FOR_SKILLS',
  ],
  description: 'Search ClawHub for available skills. Use when the user wants to find new capabilities or skills to install.',
  
  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const service = runtime.getService<ClawHubService>('CLAWHUB_SERVICE');
    return !!service;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    _options: unknown,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      const service = runtime.getService<ClawHubService>('CLAWHUB_SERVICE');
      if (!service) {
        throw new Error('ClawHubService not available');
      }

      // Extract search query from message
      const content = message.content?.text || '';
      const query = content
        .replace(/^(?:search|find|look\s*for)?\s*(?:skills?|clawhub)?[:\s]*/i, '')
        .trim();

      if (!query || query.length < 2) {
        const errorMsg = 'Please provide a search query. Example: "search skills for weather"';
        if (callback) {
          await callback({ text: errorMsg, error: true });
        }
        return { success: false, error: new Error(errorMsg) };
      }

      const results = await service.search(query);

      if (results.length === 0) {
        const responseText = `No skills found for "${query}". Try a different search term.`;
        if (callback) {
          await callback({ text: responseText });
        }
        return { success: true, text: responseText, data: [] };
      }

      const resultsList = results
        .map((s, i) => `${i + 1}. **${s.name}** (\`${s.slug}\`)\n   ${s.description}\n   ⭐ ${s.stars} | 📥 ${s.downloads}`)
        .join('\n\n');

      const responseText = `Found ${results.length} skills for "${query}":\n\n${resultsList}\n\nUse \`install <slug>\` to install a skill.`;

      if (callback) {
        await callback({
          text: responseText,
          actions: ['clawhub_search'],
        });
      }

      return {
        success: true,
        text: responseText,
        data: results,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (callback) {
        await callback({ text: `Error searching skills: ${errorMsg}`, error: true });
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
        content: { text: 'Search for weather skills' },
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'Found 2 skills for "weather":\n\n1. **Weather** (`weather`)\n   Get current weather and forecasts\n   ⭐ 15 | 📥 120\n\nUse `install <slug>` to install a skill.',
          actions: ['clawhub_search'],
        },
      },
    ],
  ],
};
