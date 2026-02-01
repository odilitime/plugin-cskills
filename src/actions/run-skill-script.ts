import type {
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
  ActionResult,
} from '@elizaos/core';
import type { ClawHubService } from '../services/clawhub';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Run Skill Script Action
 * 
 * Executes scripts that come bundled with ClawHub skills.
 * Only runs scripts from installed skills (security).
 */
export const runSkillScriptAction: Action = {
  name: 'RUN_SKILL_SCRIPT',
  similes: [
    'EXECUTE_SKILL',
    'USE_SKILL',
    'SKILL_COMMAND',
    'RUN_SCRIPT',
  ],
  description: 'Run a script from an installed ClawHub skill. Use when you need to execute a skill command like checking balance, trading, posting, etc.',

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

      // Parse the command from message
      // Expected formats:
      // - "run babylon balance"
      // - "babylon balance"
      // - "use babylon to check balance"
      // - "execute babylon-client balance"
      const text = message.content?.text || '';
      const parsed = parseSkillCommand(text, service);

      if (!parsed) {
        const installed = service.getLoadedSkills().map(s => s.slug).join(', ');
        const errorText = `I couldn't parse a skill command from that. Please specify like: "run [skill] [command] [args]"\n\nInstalled skills: ${installed || 'none'}`;
        if (callback) await callback({ text: errorText });
        return { success: false, error: new Error('Could not parse skill command') };
      }

      const { skill, scriptFile, args } = parsed;
      runtime.logger.info(`ClawHub: Running ${skill.slug} script: ${scriptFile} ${args.join(' ')}`);

      // Verify the script exists
      const skillsDir = runtime.getSetting('CLAWHUB_SKILLS_DIR') || './skills';
      const scriptPath = path.join(skillsDir, skill.slug, 'scripts', scriptFile);

      if (!fs.existsSync(scriptPath)) {
        const errorText = `Script "${scriptFile}" not found in skill "${skill.slug}".\n\nAvailable scripts: ${skill.scripts?.join(', ') || 'none'}`;
        if (callback) await callback({ text: errorText });
        return { success: false, error: new Error('Script not found') };
      }

      // Check for required env vars mentioned in skill description
      const missingKeys = checkRequiredEnvVars(skill.description, runtime);
      if (missingKeys.length > 0) {
        const errorText = `Missing required environment variables: ${missingKeys.join(', ')}\n\nPlease add these to your .env file before using this skill.`;
        if (callback) await callback({ text: errorText });
        return { success: false, error: new Error('Missing required env vars') };
      }

      // Determine how to run the script
      const ext = path.extname(scriptFile).toLowerCase();
      let cmd: string[];

      if (ext === '.ts') {
        // TypeScript - use bun or ts-node
        cmd = ['bun', 'run', scriptPath, ...args];
      } else if (ext === '.js' || ext === '.mjs') {
        // JavaScript - use bun or node
        cmd = ['bun', 'run', scriptPath, ...args];
      } else if (ext === '.sh') {
        // Shell script
        cmd = ['bash', scriptPath, ...args];
      } else {
        const errorText = `Unsupported script type: ${ext}. Supported: .ts, .js, .mjs, .sh`;
        if (callback) await callback({ text: errorText });
        return { success: false, error: new Error('Unsupported script type') };
      }

      // Execute with timeout (default 2 minutes, configurable)
      const timeoutMs = parseInt(runtime.getSetting('CLAWHUB_SCRIPT_TIMEOUT') || '120000', 10);
      const result = await executeCommand(cmd, {
        cwd: path.join(skillsDir, skill.slug),
        timeout: timeoutMs,
        env: {
          ...process.env,
          SKILL_NAME: skill.slug,
          SKILL_DIR: path.join(skillsDir, skill.slug),
        },
      });

      // Format output
      let responseText = `**${skill.name}** - \`${args[0] || 'run'}\`\n\n`;

      if (result.success) {
        responseText += result.stdout || '_No output_';
      } else {
        // Check if error mentions missing API keys
        const errorOutput = result.stderr || result.error || 'Unknown error';
        const apiKeyMentioned = /api[_\s-]?key|token|secret|auth/i.test(errorOutput);

        responseText += `**Error:**\n\`\`\`\n${errorOutput}\n\`\`\``;

        if (apiKeyMentioned) {
          responseText += `\n\n💡 This might be an authentication issue. Check that required API keys are set in your .env file.`;
        }
      }

      // Truncate if too long
      if (responseText.length > 3500) {
        responseText = responseText.substring(0, 3400) + '\n\n...[output truncated]';
      }

      if (callback) {
        await callback({ text: responseText, actions: ['RUN_SKILL_SCRIPT'] });
      }

      return {
        success: result.success,
        text: responseText,
        values: {
          skill: skill.slug,
          command: args[0],
          exitCode: result.exitCode,
        },
        data: {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        },
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      runtime.logger.error(`ClawHub: Script execution error: ${errorMsg}`);
      if (callback) {
        await callback({ text: `Script execution failed: ${errorMsg}` });
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
        content: { text: 'run babylon balance' },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '**Babylon Prediction Markets** - `balance`\n\nBalance: $1,234.56\nPnL: +$89.12',
          actions: ['RUN_SKILL_SCRIPT'],
        },
      },
    ],
    [
      {
        name: '{{userName}}',
        content: { text: 'babylon markets' },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '**Babylon Prediction Markets** - `markets`\n\n1. Will BTC hit $100k? - YES: 0.65\n2. ETH merge successful? - YES: 0.89',
          actions: ['RUN_SKILL_SCRIPT'],
        },
      },
    ],
  ],
};

/**
 * Check if required env vars are present
 * Looks for patterns like "Requires SOME_API_KEY" in the description
 */
function checkRequiredEnvVars(description: string, runtime: IAgentRuntime): string[] {
  const missing: string[] = [];

  // Match patterns like:
  // - "Requires BABYLON_API_KEY"
  // - "Needs API_KEY and SECRET_KEY"
  // - "Required: FOO_KEY, BAR_TOKEN"
  const keyPattern = /(?:requires?|needs?|required)[\s:]+([A-Z_][A-Z0-9_]*(?:\s*(?:and|,)\s*[A-Z_][A-Z0-9_]*)*)/gi;
  const matches = description.matchAll(keyPattern);

  for (const match of matches) {
    // Extract individual key names
    const keysText = match[1];
    const keys = keysText.split(/[\s,]+(?:and\s+)?/).filter(k => k.length > 0);

    for (const key of keys) {
      const cleanKey = key.trim();
      if (cleanKey.length > 0 && !runtime.getSetting(cleanKey)) {
        missing.push(cleanKey);
      }
    }
  }

  return missing;
}

/**
 * Parse a skill command from user text
 */
function parseSkillCommand(
  text: string,
  service: ClawHubService
): { skill: ReturnType<ClawHubService['getLoadedSkill']> & object; scriptFile: string; args: string[] } | null {
  const textLower = text.toLowerCase();
  const installedSkills = service.getLoadedSkills();

  // Try to match a skill name
  let matchedSkill: ReturnType<ClawHubService['getLoadedSkill']> | undefined;

  for (const skill of installedSkills) {
    if (textLower.includes(skill.slug.toLowerCase()) ||
      textLower.includes(skill.name.toLowerCase())) {
      matchedSkill = skill;
      break;
    }
  }

  if (!matchedSkill) {
    return null;
  }

  // Extract the command/args after the skill name
  // Remove common prefixes and the skill name
  let remaining = text
    .replace(/^(run|execute|use|call)\s+/i, '')
    .replace(new RegExp(`\\b${matchedSkill.slug}\\b`, 'i'), '')
    .replace(new RegExp(`\\b${matchedSkill.name}\\b`, 'i'), '')
    .replace(/\s+(to|for|and)\s+/gi, ' ')
    .trim();

  // Split into args
  const args = remaining.split(/\s+/).filter(a => a.length > 0);

  // Find the main script file (usually named after the skill or is the only one)
  const scripts = matchedSkill.scripts || [];
  let scriptFile: string;

  if (scripts.length === 0) {
    return null; // No scripts available
  } else if (scripts.length === 1) {
    scriptFile = scripts[0];
  } else {
    // Look for a script that matches the skill name
    scriptFile = scripts.find(s =>
      s.toLowerCase().includes(matchedSkill!.slug.toLowerCase()) ||
      s.toLowerCase().includes('client') ||
      s.toLowerCase().includes('main') ||
      s.toLowerCase().includes('index')
    ) || scripts[0];
  }

  return {
    skill: matchedSkill,
    scriptFile,
    args,
  };
}

/**
 * Execute a command with timeout
 */
async function executeCommand(
  cmd: string[],
  options: { cwd: string; timeout: number; env?: NodeJS.ProcessEnv }
): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number; error?: string }> {
  const [executable, ...args] = cmd;

  try {
    const proc = Bun.spawn([executable, ...args], {
      cwd: options.cwd,
      env: options.env,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        proc.kill();
        reject(new Error(`Command timed out after ${Math.round(options.timeout / 1000)}s`));
      }, options.timeout);
    });

    // Wait for completion or timeout
    const exitCode = await Promise.race([proc.exited, timeoutPromise]);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    return {
      success: exitCode === 0,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode,
    };
  } catch (error) {
    return {
      success: false,
      stdout: '',
      stderr: '',
      exitCode: -1,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
