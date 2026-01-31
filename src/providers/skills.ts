import type { Provider, IAgentRuntime, Memory, State } from '@elizaos/core';
import type { ClawHubService } from '../services/clawhub';

/**
 * Provider that injects installed skill instructions into agent context
 */
export const skillsProvider: Provider = {
  name: 'clawhub_skills',
  description: 'Provides context about installed ClawHub skills and their capabilities',

  get: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State
  ): Promise<string> => {
    const service = runtime.getService<ClawHubService>('CLAWHUB_SERVICE');
    if (!service) {
      return '';
    }

    const skills = service.getLoadedSkills();
    if (skills.length === 0) {
      return '';
    }

    // Build context string with skill summaries
    const skillSummaries = skills.map(skill => {
      const scripts = skill.scripts?.length 
        ? `\n  Scripts: ${skill.scripts.join(', ')}` 
        : '';
      const refs = skill.references?.length 
        ? `\n  References: ${skill.references.join(', ')}` 
        : '';
      
      return `- **${skill.name}** (\`${skill.slug}\`): ${skill.description}${scripts}${refs}`;
    }).join('\n');

    return `## Installed Skills

The following ClawHub skills are available:

${skillSummaries}

Use "run <skill> <script> [args]" to execute skill scripts.
`;
  },
};

/**
 * Provider that gives detailed instructions for a specific skill when relevant
 */
export const skillInstructionsProvider: Provider = {
  name: 'clawhub_skill_instructions',
  description: 'Provides detailed instructions from relevant skills based on conversation context',

  get: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State
  ): Promise<string> => {
    const service = runtime.getService<ClawHubService>('CLAWHUB_SERVICE');
    if (!service) {
      return '';
    }

    const skills = service.getLoadedSkills();
    if (skills.length === 0) {
      return '';
    }

    const messageText = (message.content?.text || '').toLowerCase();
    
    // Find skills that might be relevant based on message content
    const relevantSkills = skills.filter(skill => {
      const name = skill.name.toLowerCase();
      const desc = skill.description.toLowerCase();
      const slug = skill.slug.toLowerCase();
      
      return messageText.includes(slug) ||
             messageText.includes(name) ||
             // Check for keyword overlap
             desc.split(/\s+/).some(word => 
               word.length > 4 && messageText.includes(word)
             );
    });

    if (relevantSkills.length === 0) {
      return '';
    }

    // Include full instructions for the most relevant skill
    const skill = relevantSkills[0];
    const instructions = service.getSkillInstructions(skill.slug);
    
    if (!instructions) {
      return '';
    }

    return `## Skill Instructions: ${skill.name}

${instructions}
`;
  },
};
