import type {
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
  ActionResult,
} from '@elizaos/core';
import type { ClawHubService } from '../services/clawhub';

/**
 * Search Skills Action
 * 
 * Search ClawHub for available skills without installing them.
 * Returns a list of matching skills with brief descriptions.
 */
export const searchSkillsAction: Action = {
  name: 'SEARCH_CLAWHUB_SKILLS',
  similes: [
    'BROWSE_SKILLS',
    'LIST_SKILLS',
    'FIND_AVAILABLE_SKILLS',
    'WHAT_SKILLS',
    'SHOW_SKILLS',
  ],
  description: 'Search ClawHub for available skills. Use when user wants to browse, explore, or see what skills are available. Returns a list without installing.',

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

      // Extract search terms
      const searchTerms = extractSearchQuery(query);

      runtime.logger.info(`ClawHub: Searching catalog for "${searchTerms}"`);

      // If no specific query, show popular/recent skills
      if (!searchTerms || searchTerms.length < 2) {
        const catalog = await service.getCatalog();
        const topSkills = catalog
          .sort((a, b) => (b.stats.downloads || 0) - (a.stats.downloads || 0))
          .slice(0, 10);

        let text = `Top ${topSkills.length} popular skills (${catalog.length} total):\n\n`;
        text += `Slug, Name, Downloads, Stars, Description\n`;
        text += `---\n`;

        for (const skill of topSkills) {
          const summary = (skill.summary || 'No description').replace(/,/g, ';').substring(0, 60);
          text += `${skill.slug}, ${skill.displayName}, ${skill.stats.downloads || 0}, ${skill.stats.stars || 0}, ${summary}...\n`;
        }

        text += `\nSay "search [topic]" or "details [slug]" for more.`;

        if (callback) {
          await callback({ text, actions: ['SEARCH_CLAWHUB_SKILLS'] });
        }

        return {
          success: true,
          text,
          data: { skills: topSkills.map(s => ({ slug: s.slug, name: s.displayName })) },
        };
      }

      // Search for specific query
      const results = await service.search(searchTerms, 10);

      if (results.length === 0) {
        const text = `No skills found matching "${searchTerms}".\n\nTry browsing all skills with "list clawhub skills" or search for something else.`;
        if (callback) await callback({ text });
        return { success: true, text, data: { found: false, query: searchTerms } };
      }

      // Format results as CSV for token efficiency
      let text = `Found ${results.length} skills matching "${searchTerms}":\n\n`;
      text += `Slug, Name, Match%, Description\n`;
      text += `---\n`;

      for (const result of results) {
        const relevance = Math.round(result.score * 100);
        const summary = result.summary.replace(/,/g, ';').substring(0, 80);
        text += `${result.slug}, ${result.displayName}, ${relevance}%, ${summary}...\n`;
      }

      text += `\nSay "details [slug]" for more info or "install [slug]" to use.`;

      if (callback) {
        await callback({ text, actions: ['SEARCH_CLAWHUB_SKILLS'] });
      }

      return {
        success: true,
        text,
        data: {
          query: searchTerms,
          results: results.map(r => ({
            slug: r.slug,
            name: r.displayName,
            score: r.score,
            summary: r.summary,
          })),
        },
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      runtime.logger.error(`ClawHub: Search error: ${errorMsg}`);
      if (callback) {
        await callback({ text: `Search failed: ${errorMsg}` });
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
        content: { text: 'What skills are available?' },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '## Popular ClawHub Skills\n\n**Agent Browser** (`agent-browser`)\nAutomates browser interactions...\nDownloads: 1234 | Stars: 56\n\n**YouTube Watcher** (`youtube-watcher`)\nFetch and read transcripts...',
          actions: ['SEARCH_CLAWHUB_SKILLS'],
        },
      },
    ],
    [
      {
        name: '{{userName}}',
        content: { text: 'Search for trading skills' },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '## Skills matching "trading"\n\n**Babylon Prediction Markets** (`babylon`) - 85% match\nPlay prediction markets...\n\n**Polymarket Bot** (`polymarket`) - 72% match\nTrade on Polymarket...',
          actions: ['SEARCH_CLAWHUB_SKILLS'],
        },
      },
    ],
  ],
};

/**
 * Extract search query from user message
 */
function extractSearchQuery(text: string): string {
  // Remove common prefixes
  let cleaned = text.toLowerCase()
    .replace(/^(search|find|look|show|list|browse|what|get)\s+(for|me|available)?\s*/i, '')
    .replace(/\b(clawhub|claw|hub|skills?)\b/gi, '')
    .trim();

  // Remove question marks and extra spaces
  cleaned = cleaned.replace(/[?!.]+$/, '').trim();

  return cleaned;
}
