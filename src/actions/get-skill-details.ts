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
 * Get Skill Details Action
 * 
 * Get detailed information about a specific skill including:
 * - Full description
 * - Version history
 * - Requirements (API keys, etc.)
 * - Available commands/scripts
 * - Installation status
 */
export const getSkillDetailsAction: Action = {
  name: 'GET_SKILL_DETAILS',
  similes: [
    'SKILL_INFO',
    'ABOUT_SKILL',
    'DESCRIBE_SKILL',
    'SKILL_DETAILS',
    'TELL_ME_ABOUT',
  ],
  description: 'Get detailed information about a specific ClawHub skill. Use when user asks about a particular skill by name.',

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

      const text = message.content?.text || '';

      // Extract skill slug/name from message
      const skillSlug = extractSkillSlug(text, service);

      if (!skillSlug) {
        const installed = service.getLoadedSkills().map(s => s.slug).join(', ');
        const errorText = `I couldn't identify which skill you're asking about. Please specify a skill name.\n\n${installed ? `Installed: ${installed}` : 'No skills installed yet.'}`;
        if (callback) await callback({ text: errorText });
        return { success: false, error: new Error('Could not identify skill') };
      }

      runtime.logger.info(`ClawHub: Getting details for "${skillSlug}"`);

      // Check if already installed
      const installedSkill = service.getLoadedSkill(skillSlug);

      // Get details from API
      const details = await service.getSkillDetails(skillSlug);

      if (!details) {
        const errorText = `Skill "${skillSlug}" not found on ClawHub.`;
        if (callback) await callback({ text: errorText });
        return { success: false, error: new Error('Skill not found') };
      }

      // Build compact response
      let responseText = `${details.skill.displayName} (${details.skill.slug})\n`;
      responseText += `Version: ${details.latestVersion.version} | Status: ${installedSkill ? 'Installed' : 'Not installed'}\n`;

      if (details.owner) {
        responseText += `Author: ${details.owner.displayName} (@${details.owner.handle})\n`;
      }

      responseText += `Stats: ${details.skill.stats.downloads || 0} downloads, ${details.skill.stats.stars || 0} stars\n\n`;
      responseText += `${details.skill.summary}\n`;

      // Tags
      if (details.skill.tags && Object.keys(details.skill.tags).length > 1) {
        const tags = Object.keys(details.skill.tags).filter(t => t !== 'latest');
        if (tags.length > 0) {
          responseText += `\nTags: ${tags.join(', ')}\n`;
        }
      }

      // Requirements
      const requirements = extractRequirements(details.skill.summary);
      if (requirements.length > 0) {
        responseText += `\nRequires:\n`;
        for (const req of requirements) {
          const isSet = !!runtime.getSetting(req);
          responseText += `- ${req}: ${isSet ? 'set' : 'NOT SET'}\n`;
        }
      }

      // Scripts
      if (installedSkill?.scripts && installedSkill.scripts.length > 0) {
        responseText += `\nCommands: ${installedSkill.scripts.join(', ')}\n`;
        responseText += `Run with: "run ${skillSlug} [command]"\n`;
      }

      // Changelog (truncated)
      if (details.latestVersion.changelog) {
        const changelog = details.latestVersion.changelog.substring(0, 150);
        responseText += `\nChangelog: ${changelog}${details.latestVersion.changelog.length > 150 ? '...' : ''}\n`;
      }

      // Action prompt
      if (!installedSkill) {
        responseText += `\nSay "install ${skillSlug}" to use.`;
      }

      if (callback) {
        await callback({ text: responseText, actions: ['GET_SKILL_DETAILS'] });
      }

      return {
        success: true,
        text: responseText,
        values: {
          slug: details.skill.slug,
          installed: !!installedSkill,
        },
        data: {
          skill: details.skill,
          installed: !!installedSkill,
          requirements,
        },
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      runtime.logger.error(`ClawHub: Get details error: ${errorMsg}`);
      if (callback) {
        await callback({ text: `Failed to get skill details: ${errorMsg}` });
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
        content: { text: 'Tell me about the babylon skill' },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '# Babylon Prediction Markets\n\n**Slug:** `babylon`\n**Version:** 1.0.0\n**Status:** ✅ Installed\n\n## Description\nPlay prediction markets...\n\n## Requirements\n- BABYLON_API_KEY: ✅ Set',
          actions: ['GET_SKILL_DETAILS'],
        },
      },
    ],
  ],
};

/**
 * Extract skill slug from user message
 */
function extractSkillSlug(text: string, service: ClawHubService): string | null {
  const textLower = text.toLowerCase();

  // Remove common prefixes
  const cleaned = textLower
    .replace(/^(tell me about|what is|describe|info on|details for|about)\s+/i, '')
    .replace(/\b(the|a|an)\s+/gi, '')
    .replace(/\b(skill|clawhub)\b/gi, '')
    .trim();

  // Try to match against installed skills first
  const installedSkills = service.getLoadedSkills();
  for (const skill of installedSkills) {
    if (cleaned.includes(skill.slug.toLowerCase()) ||
      cleaned.includes(skill.name.toLowerCase())) {
      return skill.slug;
    }
  }

  // Try to extract a slug-like pattern (lowercase with hyphens)
  const slugMatch = cleaned.match(/\b([a-z][a-z0-9-]+)\b/);
  if (slugMatch) {
    return slugMatch[1];
  }

  return null;
}

/**
 * Extract required env vars from description
 */
function extractRequirements(description: string): string[] {
  const requirements: string[] = [];
  const keyPattern = /(?:requires?|needs?|required)[\s:]+([A-Z_][A-Z0-9_]*(?:\s*(?:and|,)\s*[A-Z_][A-Z0-9_]*)*)/gi;
  const matches = description.matchAll(keyPattern);

  for (const match of matches) {
    const keysText = match[1];
    const keys = keysText.split(/[\s,]+(?:and\s+)?/).filter(k => k.length > 0);
    requirements.push(...keys.map(k => k.trim()));
  }

  return [...new Set(requirements)]; // Dedupe
}
