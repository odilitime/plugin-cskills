import type {
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
  ActionResult,
} from '@elizaos/core';
import type { ClawHubService } from '../services/clawhub';

export const installSkillAction: Action = {
  name: 'clawhub_install',
  similes: [
    'INSTALL_SKILL',
    'ADD_SKILL',
    'CLAWHUB_INSTALL',
    'GET_SKILL',
  ],
  description: 'Install a skill from ClawHub. Use when the user wants to add new capabilities.',
  
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

      // Extract skill slug from message
      const content = message.content?.text || '';
      const match = content.match(/(?:install|add|get)\s+(?:skill\s+)?(\S+)/i);
      const slug = match?.[1]?.toLowerCase();

      if (!slug) {
        const errorMsg = 'Please specify a skill to install. Example: "install babylon"';
        if (callback) {
          await callback({ text: errorMsg, error: true });
        }
        return { success: false, error: new Error(errorMsg) };
      }

      // Check if already installed
      const existing = service.getLoadedSkill(slug);
      if (existing) {
        const responseText = `Skill "${slug}" is already installed.`;
        if (callback) {
          await callback({ text: responseText });
        }
        return { success: true, text: responseText };
      }

      // Install the skill
      const success = await service.install(slug);

      if (!success) {
        const errorMsg = `Failed to install skill "${slug}". It may not exist on ClawHub.`;
        if (callback) {
          await callback({ text: errorMsg, error: true });
        }
        return { success: false, error: new Error(errorMsg) };
      }

      const skill = service.getLoadedSkill(slug);
      const responseText = `✅ Installed skill: **${skill?.name || slug}**\n\n${skill?.description || ''}\n\nThe skill is now available.`;

      if (callback) {
        await callback({
          text: responseText,
          actions: ['clawhub_install'],
        });
      }

      return {
        success: true,
        text: responseText,
        data: skill,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (callback) {
        await callback({ text: `Error installing skill: ${errorMsg}`, error: true });
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
        content: { text: 'Install the babylon skill' },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '✅ Installed skill: **Babylon Prediction Markets**\n\nPlay prediction markets, trade YES/NO shares, post to feed.\n\nThe skill is now available.',
          actions: ['clawhub_install'],
        },
      },
    ],
  ],
};
