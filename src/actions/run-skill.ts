import type {
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
  ActionResult,
} from '@elizaos/core';
import type { ClawHubService } from '../services/clawhub';

export const runSkillAction: Action = {
  name: 'clawhub_run',
  similes: [
    'RUN_SKILL',
    'EXECUTE_SKILL',
    'USE_SKILL',
    'CLAWHUB_RUN',
  ],
  description: 'Execute a script from an installed skill. Use when the user wants to run a specific skill script.',
  
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

      // Parse: run <skill> <script> [args...]
      const content = message.content?.text || '';
      const match = content.match(/(?:run|execute|use)\s+(\S+)\s+(\S+)(?:\s+(.+))?/i);
      
      if (!match) {
        const errorMsg = 'Usage: run <skill-slug> <script-name> [args...]\nExample: run babylon balance';
        if (callback) {
          await callback({ text: errorMsg, error: true });
        }
        return { success: false, error: new Error(errorMsg) };
      }

      const [, slug, script, argsStr] = match;
      const args = argsStr ? argsStr.split(/\s+/) : [];

      // Check if skill is installed
      const skill = service.getLoadedSkill(slug);
      if (!skill) {
        const errorMsg = `Skill "${slug}" is not installed. Use "install ${slug}" first.`;
        if (callback) {
          await callback({ text: errorMsg, error: true });
        }
        return { success: false, error: new Error(errorMsg) };
      }

      // Find matching script
      const scriptFile = skill.scripts?.find(s => 
        s.startsWith(script) || s.replace(/\.[^.]+$/, '') === script
      );

      if (!scriptFile) {
        const available = skill.scripts?.join(', ') || 'none';
        const errorMsg = `Script "${script}" not found in ${slug}. Available: ${available}`;
        if (callback) {
          await callback({ text: errorMsg, error: true });
        }
        return { success: false, error: new Error(errorMsg) };
      }

      // Execute the script
      const output = await service.executeScript(slug, scriptFile, args);

      const responseText = `**${slug}/${scriptFile}** output:\n\`\`\`\n${output.trim()}\n\`\`\``;

      if (callback) {
        await callback({
          text: responseText,
          actions: ['clawhub_run'],
        });
      }

      return {
        success: true,
        text: responseText,
        data: { output },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (callback) {
        await callback({ text: `Error running script: ${errorMsg}`, error: true });
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
        content: { text: 'Run babylon balance' },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '**babylon/babylon-client.ts** output:\n```\n{"balance": "866.29", "lifetimePnL": "-10.20"}\n```',
          actions: ['clawhub_run'],
        },
      },
    ],
  ],
};
