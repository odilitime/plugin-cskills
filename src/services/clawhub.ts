import { Service, type IAgentRuntime } from '@elizaos/core';
import * as fs from 'fs';
import * as path from 'path';

const CLAWHUB_API = 'https://www.clawhub.com';

export interface Skill {
  slug: string;
  name: string;
  description: string;
  version: string;
  content?: string; // SKILL.md content
  scripts?: string[];
  references?: string[];
}

export interface SkillSearchResult {
  slug: string;
  name: string;
  description: string;
  version: string;
  stars: number;
  downloads: number;
}

/**
 * ClawHub Service - Manages skill discovery, installation, and loading
 */
export class ClawHubService extends Service {
  static serviceType = 'CLAWHUB_SERVICE';
  capabilityDescription = 'ClawHub skill registry integration - search, install, and use OpenClaw skills';

  private skillsDir: string;
  private loadedSkills: Map<string, Skill> = new Map();

  constructor(protected runtime: IAgentRuntime) {
    super(runtime);
    this.skillsDir = runtime.getSetting('CLAWHUB_SKILLS_DIR') || './skills';
  }

  static async start(runtime: IAgentRuntime): Promise<ClawHubService> {
    const service = new ClawHubService(runtime);
    await service.initialize();
    return service;
  }

  static async stop(runtime: IAgentRuntime): Promise<void> {
    // Cleanup if needed
  }

  async initialize(): Promise<void> {
    this.runtime.logger.info('ClawHub: Service initializing...');

    // Ensure skills directory exists
    if (!fs.existsSync(this.skillsDir)) {
      fs.mkdirSync(this.skillsDir, { recursive: true });
    }

    // Auto-load installed skills
    const autoLoad = this.runtime.getSetting('CLAWHUB_AUTO_LOAD') !== 'false';
    if (autoLoad) {
      await this.loadInstalledSkills();
    }

    this.runtime.logger.info(`ClawHub: Initialized with ${this.loadedSkills.size} skills`);
  }

  /**
   * Search ClawHub for skills
   */
  async search(query: string, limit = 10): Promise<SkillSearchResult[]> {
    try {
      const response = await fetch(`${CLAWHUB_API}/api/skills/search?q=${encodeURIComponent(query)}&limit=${limit}`);
      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }
      const data = await response.json();
      return data.skills || [];
    } catch (error) {
      this.runtime.logger.error(`ClawHub search error: ${error}`);
      return [];
    }
  }

  /**
   * Get skill details from ClawHub
   */
  async getSkill(slug: string, version = 'latest'): Promise<Skill | null> {
    try {
      const response = await fetch(`${CLAWHUB_API}/api/skills/${slug}?version=${version}`);
      if (!response.ok) {
        return null;
      }
      return await response.json();
    } catch (error) {
      this.runtime.logger.error(`ClawHub getSkill error: ${error}`);
      return null;
    }
  }

  /**
   * Install a skill from ClawHub
   */
  async install(slug: string, version = 'latest'): Promise<boolean> {
    try {
      this.runtime.logger.info(`ClawHub: Installing ${slug}@${version}...`);

      // Download skill zip
      const response = await fetch(`${CLAWHUB_API}/api/skills/${slug}/download?version=${version}`);
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }

      const zipBuffer = await response.arrayBuffer();
      const skillDir = path.join(this.skillsDir, slug);

      // Extract zip (simplified - in production use a proper unzip library)
      // For now, fetch the skill content directly
      const skillData = await this.getSkill(slug, version);
      if (!skillData) {
        throw new Error('Could not fetch skill data');
      }

      // Create skill directory
      if (!fs.existsSync(skillDir)) {
        fs.mkdirSync(skillDir, { recursive: true });
      }

      // Write SKILL.md
      if (skillData.content) {
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillData.content);
      }

      // Update lockfile
      this.updateLockfile(slug, version);

      // Load the skill
      await this.loadSkill(slug);

      this.runtime.logger.info(`ClawHub: Installed ${slug}@${version}`);
      return true;
    } catch (error) {
      this.runtime.logger.error(`ClawHub install error: ${error}`);
      return false;
    }
  }

  /**
   * Load all installed skills from disk
   */
  async loadInstalledSkills(): Promise<void> {
    if (!fs.existsSync(this.skillsDir)) return;

    const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await this.loadSkill(entry.name);
      }
    }
  }

  /**
   * Load a single skill from disk
   */
  async loadSkill(slug: string): Promise<Skill | null> {
    const skillDir = path.join(this.skillsDir, slug);
    const skillMdPath = path.join(skillDir, 'SKILL.md');

    if (!fs.existsSync(skillMdPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(skillMdPath, 'utf-8');
      const { name, description } = this.parseFrontmatter(content);

      // Find scripts and references
      const scripts: string[] = [];
      const references: string[] = [];

      const scriptsDir = path.join(skillDir, 'scripts');
      if (fs.existsSync(scriptsDir)) {
        scripts.push(...fs.readdirSync(scriptsDir));
      }

      const refsDir = path.join(skillDir, 'references');
      if (fs.existsSync(refsDir)) {
        references.push(...fs.readdirSync(refsDir));
      }

      const skill: Skill = {
        slug,
        name: name || slug,
        description: description || '',
        version: 'local',
        content,
        scripts,
        references,
      };

      this.loadedSkills.set(slug, skill);
      this.runtime.logger.debug(`ClawHub: Loaded skill ${slug}`);
      return skill;
    } catch (error) {
      this.runtime.logger.error(`ClawHub: Error loading skill ${slug}: ${error}`);
      return null;
    }
  }

  /**
   * Get all loaded skills
   */
  getLoadedSkills(): Skill[] {
    return Array.from(this.loadedSkills.values());
  }

  /**
   * Get a specific loaded skill
   */
  getLoadedSkill(slug: string): Skill | undefined {
    return this.loadedSkills.get(slug);
  }

  /**
   * Get skill instructions for agent context
   */
  getSkillInstructions(slug: string): string | null {
    const skill = this.loadedSkills.get(slug);
    if (!skill?.content) return null;

    // Remove frontmatter, return just the instructions
    return skill.content.replace(/^---[\s\S]*?---\n*/, '').trim();
  }

  /**
   * Execute a skill script
   */
  async executeScript(slug: string, scriptName: string, args: string[] = []): Promise<string> {
    const skillDir = path.join(this.skillsDir, slug);
    const scriptPath = path.join(skillDir, 'scripts', scriptName);

    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Script not found: ${slug}/scripts/${scriptName}`);
    }

    const { spawn } = await import('child_process');
    
    return new Promise((resolve, reject) => {
      const ext = path.extname(scriptPath);
      let cmd: string;
      let cmdArgs: string[];

      if (ext === '.ts') {
        cmd = 'npx';
        cmdArgs = ['ts-node', scriptPath, ...args];
      } else if (ext === '.py') {
        cmd = 'python3';
        cmdArgs = [scriptPath, ...args];
      } else if (ext === '.sh') {
        cmd = 'bash';
        cmdArgs = [scriptPath, ...args];
      } else {
        cmd = 'node';
        cmdArgs = [scriptPath, ...args];
      }

      const child = spawn(cmd, cmdArgs, {
        cwd: skillDir,
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => { stdout += data; });
      child.stderr?.on('data', (data) => { stderr += data; });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Script exited with code ${code}`));
        }
      });

      child.on('error', reject);
    });
  }

  /**
   * Parse YAML frontmatter from SKILL.md
   */
  private parseFrontmatter(content: string): { name?: string; description?: string } {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};

    const yaml = match[1];
    const name = yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const description = yaml.match(/^description:\s*(.+)$/m)?.[1]?.trim();

    return { name, description };
  }

  /**
   * Update the lockfile with installed skill info
   */
  private updateLockfile(slug: string, version: string): void {
    const lockfilePath = path.join(this.skillsDir, '.clawhub', 'lock.json');
    const lockDir = path.dirname(lockfilePath);

    if (!fs.existsSync(lockDir)) {
      fs.mkdirSync(lockDir, { recursive: true });
    }

    let lockfile: Record<string, any> = {};
    if (fs.existsSync(lockfilePath)) {
      lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf-8'));
    }

    lockfile[slug] = {
      version,
      installedAt: new Date().toISOString(),
    };

    fs.writeFileSync(lockfilePath, JSON.stringify(lockfile, null, 2));
  }
}
