import type { Plugin, Service, Action, Provider } from '@elizaos/core';

// Services
import { ClawHubService } from './services/clawhub';

// Actions
import { searchSkillsAction } from './actions/search-skills';
import { installSkillAction } from './actions/install-skill';
import { runSkillAction } from './actions/run-skill';

// Providers
import { skillsProvider, skillInstructionsProvider } from './providers/skills';

const ALL_SERVICES: (typeof Service)[] = [ClawHubService];

const ALL_ACTIONS: Action[] = [
  searchSkillsAction,
  installSkillAction,
  runSkillAction,
];

const ALL_PROVIDERS: Provider[] = [
  skillsProvider,
  skillInstructionsProvider,
];

/**
 * ClawHub Plugin for elizaOS
 * 
 * Enables agents to discover, install, and use skills from ClawHub (the OpenClaw skill registry).
 * 
 * Features:
 * - Search ClawHub for available skills
 * - Install skills from the registry
 * - Execute skill scripts
 * - Auto-inject skill instructions into agent context
 * 
 * Configuration:
 * - CLAWHUB_SKILLS_DIR: Directory to install skills (default: ./skills)
 * - CLAWHUB_AUTO_LOAD: Auto-load installed skills on startup (default: true)
 */
export const clawHubPlugin: Plugin = {
  name: '@elizaos/plugin-clawhub',
  description: 'ClawHub skills integration - search, install, and use OpenClaw skills',
  
  services: ALL_SERVICES,
  actions: ALL_ACTIONS,
  providers: ALL_PROVIDERS,
  
  // No evaluators or routes for now
  evaluators: [],
  routes: [],
};

export default clawHubPlugin;
