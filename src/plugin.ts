import type { Plugin, Service, Action, Provider, IAgentRuntime } from '@elizaos/core';

// Services
import { ClawHubService } from './services/clawhub';

// Actions
import { getSkillGuidanceAction } from './actions/get-skill-guidance';

// Providers (low → high resolution)
import {
  skillsOverviewProvider,    // Low: just counts and examples
  skillsSummaryProvider,     // Medium: installed skills with descriptions
  skillInstructionsProvider, // High: full instructions for matched skill
  catalogAwarenessProvider,  // Dynamic: shows catalog when asked about capabilities
} from './providers/skills';

// Background task
import { startSyncTask } from './tasks/sync-catalog';

const ALL_SERVICES: (typeof Service)[] = [ClawHubService];

const ALL_ACTIONS: Action[] = [
  getSkillGuidanceAction,  // The only action - auto-finds, installs, returns instructions
];

const ALL_PROVIDERS: Provider[] = [
  // skillsOverviewProvider,   // Low-res (dynamic, opt-in)
  skillsSummaryProvider,       // Medium-res (default) - installed skills
  skillInstructionsProvider,   // High-res - active skill instructions
  catalogAwarenessProvider,    // Dynamic - catalog awareness
];

// Track cleanup function for background task
let cleanupSyncTask: (() => void) | null = null;

/**
 * ClawHub Plugin for elizaOS
 * 
 * Provides seamless access to ClawHub's skill library with intelligent caching
 * and background syncing.
 * 
 * ## Architecture:
 * 
 * **Service (ClawHubService)**
 * - All I/O goes through the service with built-in caching
 * - `notOlderThan` option for cache freshness control
 * - Catalog, search results, and skill details are cached
 * 
 * **Background Task**
 * - Syncs skill catalog hourly
 * - Keeps agent aware of new skills without blocking requests
 * 
 * **Providers (Resolution Levels)**
 * - Low: Just skill counts and examples (minimal context)
 * - Medium: Installed skills with descriptions (default)
 * - High: Full instructions for contextually matched skills
 * 
 * **Action**
 * - GET_SKILL_GUIDANCE: The single action that finds, installs, and returns skill instructions
 * 
 * ## Configuration:
 * - CLAWHUB_SKILLS_DIR: Skill cache directory (default: ./skills)
 * - CLAWHUB_AUTO_LOAD: Load cached skills on startup (default: true)
 * - CLAWHUB_REGISTRY: Custom registry URL (default: https://clawhub.ai)
 */
export const clawHubPlugin: Plugin = {
  name: '@elizaos/plugin-clawhub',
  description: 'Seamless ClawHub skills with caching and background sync',

  services: ALL_SERVICES,
  actions: ALL_ACTIONS,
  providers: ALL_PROVIDERS,

  evaluators: [],
  routes: [],

  // Initialize background task when plugin loads
  init: async (_config: Record<string, string>, runtime: IAgentRuntime) => {
    // Start background catalog sync
    cleanupSyncTask = startSyncTask(runtime);
    runtime.logger.info('ClawHub: Background sync task started');
  },
};

export default clawHubPlugin;
