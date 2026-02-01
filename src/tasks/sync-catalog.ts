import type { IAgentRuntime } from '@elizaos/core';
import type { ClawHubService } from '../services/clawhub';

// Sync interval: 1 hour
const SYNC_INTERVAL_MS = 1000 * 60 * 60;

/**
 * Background task that periodically syncs the skill catalog from ClawHub.
 * 
 * This keeps the agent's knowledge of available skills fresh without
 * blocking any requests. The catalog is used by providers to show
 * what skills are available.
 */
export interface SyncCatalogTask {
  name: string;
  description: string;
  intervalMs: number;
  handler: (runtime: IAgentRuntime) => Promise<void>;
}

export const syncCatalogTask: SyncCatalogTask = {
  name: 'clawhub_sync_catalog',
  description: 'Periodically syncs the ClawHub skill catalog',
  intervalMs: SYNC_INTERVAL_MS,

  handler: async (runtime: IAgentRuntime): Promise<void> => {
    const service = runtime.getService<ClawHubService>('CLAWHUB_SERVICE');
    if (!service) {
      runtime.logger.warn('ClawHub: Sync task - service not available');
      return;
    }

    try {
      runtime.logger.debug('ClawHub: Starting catalog sync...');

      const result = await service.syncCatalog();
      const stats = service.getCatalogStats();

      runtime.logger.info(
        `ClawHub: Catalog synced - ${stats.total} skills available, ${stats.installed} installed`
      );

      if (result.added > 0) {
        runtime.logger.info(`ClawHub: ${result.added} new skills discovered`);
      }
    } catch (error) {
      runtime.logger.error(`ClawHub: Catalog sync failed: ${error}`);
    }
  },
};

/**
 * Start the background sync task
 * Returns a cleanup function to stop the task
 */
export function startSyncTask(runtime: IAgentRuntime): () => void {
  // Initial sync after a short delay
  const initialTimeout = setTimeout(() => {
    syncCatalogTask.handler(runtime);
  }, 5000);

  // Periodic sync
  const interval = setInterval(() => {
    syncCatalogTask.handler(runtime);
  }, syncCatalogTask.intervalMs);

  // Return cleanup function
  return () => {
    clearTimeout(initialTimeout);
    clearInterval(interval);
  };
}
