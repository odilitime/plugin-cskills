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
 * Sync Catalog Action
 * 
 * Manually triggers a sync of the ClawHub skill catalog.
 * Useful for refreshing the available skills list.
 */
export const syncCatalogAction: Action = {
  name: 'SYNC_CLAWHUB_CATALOG',
  similes: [
    'REFRESH_SKILLS',
    'UPDATE_CATALOG',
    'SYNC_SKILLS',
    'REFRESH_CLAWHUB',
  ],
  description: 'Sync the ClawHub skill catalog to get the latest available skills. Use when skills seem outdated or missing.',

  validate: async (runtime: IAgentRuntime, _message: Memory): Promise<boolean> => {
    const service = runtime.getService<ClawHubService>('CLAWHUB_SERVICE');
    return !!service;
  },

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options: unknown,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      const service = runtime.getService<ClawHubService>('CLAWHUB_SERVICE');
      if (!service) {
        throw new Error('ClawHubService not available');
      }

      runtime.logger.info('ClawHub: Manual catalog sync triggered');

      // Force refresh the catalog
      const catalog = await service.getCatalog({ forceRefresh: true });
      const stats = service.getCatalogStats();

      const text = `Synced ClawHub catalog: **${catalog.length} skills** available.\n\nInstalled locally: ${stats.installed}\nCategories: ${stats.categories.slice(0, 5).join(', ')}${stats.categories.length > 5 ? '...' : ''}`;

      if (callback) {
        await callback({ text, actions: ['SYNC_CLAWHUB_CATALOG'] });
      }

      return {
        success: true,
        text,
        values: { skillCount: catalog.length, installedCount: stats.installed },
        data: { catalog: catalog.map(s => ({ slug: s.slug, name: s.displayName })) },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      runtime.logger.error(`ClawHub: Sync failed: ${errorMsg}`);
      if (callback) {
        await callback({ text: `Failed to sync catalog: ${errorMsg}` });
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
        content: { text: 'Sync the clawhub catalog' },
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'Synced ClawHub catalog: **24 skills** available.\n\nInstalled locally: 2\nCategories: automation, social, trading...',
          actions: ['SYNC_CLAWHUB_CATALOG'],
        },
      },
    ],
  ],
};
