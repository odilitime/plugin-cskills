/**
 * ClawHub Plugin for elizaOS
 * 
 * Seamless access to ClawHub's skill library with:
 * - Intelligent caching (notOlderThan freshness control)
 * - Background catalog sync
 * - Multi-resolution providers (low/med/high)
 * - Auto-install on demand
 * 
 * @see https://clawhub.ai
 */

export { clawHubPlugin, default } from './plugin';

// Service
export { ClawHubService } from './services/clawhub';
export type {
    Skill,
    SkillSearchResult,
    SkillDetails,
    SkillCatalogEntry,
} from './services/clawhub';

// Actions
export { searchSkillsAction } from './actions/search-skills';
export { getSkillDetailsAction } from './actions/get-skill-details';
export { getSkillGuidanceAction } from './actions/get-skill-guidance';
export { syncCatalogAction } from './actions/sync-catalog';
export { runSkillScriptAction } from './actions/run-skill-script';

// Providers
export {
    skillsOverviewProvider,
    skillsSummaryProvider,
    skillInstructionsProvider,
    catalogAwarenessProvider,
    skillsProvider, // Alias for skillsSummaryProvider
} from './providers/skills';

// Tasks
export { syncCatalogTask, startSyncTask } from './tasks/sync-catalog';
