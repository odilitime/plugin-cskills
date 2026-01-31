/**
 * ClawHub Plugin for elizaOS
 * 
 * Enables elizaOS agents to use skills from ClawHub (OpenClaw skill registry).
 */

export { clawHubPlugin, default } from './plugin';

// Export service
export { ClawHubService } from './services/clawhub';
export type { Skill, SkillSearchResult } from './services/clawhub';

// Export actions
export { searchSkillsAction } from './actions/search-skills';
export { installSkillAction } from './actions/install-skill';
export { runSkillAction } from './actions/run-skill';

// Export providers
export { skillsProvider, skillInstructionsProvider } from './providers/skills';
