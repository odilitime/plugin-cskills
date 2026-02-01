import { Service, type IAgentRuntime } from '@elizaos/core';
import * as fs from 'fs';
import * as path from 'path';

// ClawHub API base URL
const CLAWHUB_API = 'https://clawhub.ai';

// Cache TTL defaults (in milliseconds)
const CACHE_TTL = {
  CATALOG: 1000 * 60 * 60,        // 1 hour - list of all skills
  SKILL_DETAILS: 1000 * 60 * 30,  // 30 min - individual skill details
  SEARCH: 1000 * 60 * 5,          // 5 min - search results
};

// Types
export interface SkillSearchResult {
  score: number;
  slug: string;
  displayName: string;
  summary: string;
  version: string;
  updatedAt: number;
}

export interface SkillCatalogEntry {
  slug: string;
  displayName: string;
  summary: string | null;
  version: string;
  tags: Record<string, string>;
  stats: {
    downloads: number;
    stars: number;
  };
  updatedAt: number;
}

export interface SkillDetails {
  skill: {
    slug: string;
    displayName: string;
    summary: string;
    tags: Record<string, string>;
    stats: { downloads: number; stars: number; versions: number };
    createdAt: number;
    updatedAt: number;
  };
  latestVersion: { version: string; createdAt: number; changelog?: string };
  owner?: { handle: string; displayName: string; image?: string };
}

export interface Skill {
  slug: string;
  name: string;
  description: string;
  version: string;
  content?: string;
  scripts?: string[];
  references?: string[];
  cachedAt?: number;
}

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
}

interface CacheOptions {
  notOlderThan?: number; // Max age in ms, undefined = use default TTL
  forceRefresh?: boolean; // Bypass cache entirely
}

/**
 * Validate and sanitize a skill slug
 */
function sanitizeSlug(slug: string): string {
  const sanitized = slug.replace(/[^a-zA-Z0-9_-]/g, '');
  if (sanitized !== slug || sanitized.length === 0 || sanitized.length > 100) {
    throw new Error(`Invalid skill slug: ${slug}`);
  }
  return sanitized;
}

/**
 * ClawHub Service
 * 
 * Manages skill discovery, caching, and installation.
 * All I/O goes through this service with built-in caching.
 */
export class ClawHubService extends Service {
  static serviceType = 'CLAWHUB_SERVICE';
  capabilityDescription = 'ClawHub skill registry - automatic skill discovery and caching';

  private skillsDir: string;
  private cacheDir: string;
  private apiBase: string;

  // In-memory caches
  private loadedSkills: Map<string, Skill> = new Map();
  private catalogCache: CacheEntry<SkillCatalogEntry[]> | null = null;
  private searchCache: Map<string, CacheEntry<SkillSearchResult[]>> = new Map();
  private detailsCache: Map<string, CacheEntry<SkillDetails>> = new Map();

  constructor(protected runtime: IAgentRuntime) {
    super(runtime);
    this.skillsDir = runtime.getSetting('CLAWHUB_SKILLS_DIR') || './skills';
    this.cacheDir = path.join(this.skillsDir, '.clawhub', 'cache');
    this.apiBase = runtime.getSetting('CLAWHUB_REGISTRY') || CLAWHUB_API;
  }

  static async start(runtime: IAgentRuntime): Promise<ClawHubService> {
    const service = new ClawHubService(runtime);
    await service.initialize();
    return service;
  }

  static async stop(_runtime: IAgentRuntime): Promise<void> { }

  async stop(): Promise<void> {
    this.runtime.logger.info('ClawHub: Service stopping...');
    this.loadedSkills.clear();
    this.catalogCache = null;
    this.searchCache.clear();
    this.detailsCache.clear();
  }

  async initialize(): Promise<void> {
    this.runtime.logger.info('ClawHub: Service initializing...');

    // Ensure directories exist
    for (const dir of [this.skillsDir, this.cacheDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Load installed skills
    const autoLoad = this.runtime.getSetting('CLAWHUB_AUTO_LOAD') !== 'false';
    if (autoLoad) {
      await this.loadInstalledSkills();
    }

    // Load cached catalog from disk
    this.loadCatalogFromDisk();

    this.runtime.logger.info(`ClawHub: Initialized with ${this.loadedSkills.size} installed skills`);
  }

  // ============================================================
  // CATALOG OPERATIONS (with caching)
  // ============================================================

  /**
   * Get the full skill catalog from ClawHub
   */
  async getCatalog(options: CacheOptions = {}): Promise<SkillCatalogEntry[]> {
    const ttl = options.notOlderThan ?? CACHE_TTL.CATALOG;

    // Check cache
    if (!options.forceRefresh && this.catalogCache) {
      const age = Date.now() - this.catalogCache.cachedAt;
      if (age < ttl) {
        return this.catalogCache.data;
      }
    }

    // Fetch from API
    try {
      const entries: SkillCatalogEntry[] = [];
      let cursor: string | undefined;

      // Paginate through all skills
      do {
        const url = `${this.apiBase}/api/v1/skills?limit=100${cursor ? `&cursor=${cursor}` : ''}`;
        const response = await fetch(url, { headers: { 'Accept': 'application/json' } });

        if (!response.ok) {
          throw new Error(`Catalog fetch failed: ${response.status}`);
        }

        const data = await response.json() as { items: SkillCatalogEntry[]; nextCursor?: string };
        entries.push(...data.items);
        cursor = data.nextCursor;
      } while (cursor);

      // Update cache
      this.catalogCache = { data: entries, cachedAt: Date.now() };
      this.saveCatalogToDisk();

      return entries;
    } catch (error) {
      this.runtime.logger.error(`ClawHub: Catalog fetch error: ${error}`);
      // Return stale cache if available
      return this.catalogCache?.data || [];
    }
  }

  /**
   * Get catalog entries as low-resolution list (just slugs and names)
   */
  async getCatalogLowRes(options: CacheOptions = {}): Promise<Array<{ slug: string; name: string }>> {
    const catalog = await this.getCatalog(options);
    return catalog.map(s => ({ slug: s.slug, name: s.displayName }));
  }

  /**
   * Get catalog entries as medium-resolution list (with summaries)
   */
  async getCatalogMedRes(options: CacheOptions = {}): Promise<Array<{ slug: string; name: string; summary: string }>> {
    const catalog = await this.getCatalog(options);
    return catalog.map(s => ({
      slug: s.slug,
      name: s.displayName,
      summary: s.summary || 'No description',
    }));
  }

  // ============================================================
  // SEARCH OPERATIONS (with caching)
  // ============================================================

  /**
   * Search ClawHub for skills
   */
  async search(query: string, limit = 10, options: CacheOptions = {}): Promise<SkillSearchResult[]> {
    const cacheKey = `${query}:${limit}`;
    const ttl = options.notOlderThan ?? CACHE_TTL.SEARCH;

    // Check cache
    if (!options.forceRefresh) {
      const cached = this.searchCache.get(cacheKey);
      if (cached && (Date.now() - cached.cachedAt) < ttl) {
        return cached.data;
      }
    }

    // Fetch from API
    try {
      const url = `${this.apiBase}/api/v1/search?q=${encodeURIComponent(query)}&limit=${limit}`;
      const response = await fetch(url, { headers: { 'Accept': 'application/json' } });

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }

      const data = await response.json() as { results: SkillSearchResult[] };
      const results = data.results || [];

      // Update cache
      this.searchCache.set(cacheKey, { data: results, cachedAt: Date.now() });

      return results;
    } catch (error) {
      this.runtime.logger.error(`ClawHub: Search error: ${error}`);
      // Return stale cache if available
      return this.searchCache.get(cacheKey)?.data || [];
    }
  }

  // ============================================================
  // SKILL DETAILS OPERATIONS (with caching)
  // ============================================================

  /**
   * Get skill details from ClawHub
   */
  async getSkillDetails(slug: string, options: CacheOptions = {}): Promise<SkillDetails | null> {
    const safeSlug = sanitizeSlug(slug);
    const ttl = options.notOlderThan ?? CACHE_TTL.SKILL_DETAILS;

    // Check cache
    if (!options.forceRefresh) {
      const cached = this.detailsCache.get(safeSlug);
      if (cached && (Date.now() - cached.cachedAt) < ttl) {
        return cached.data;
      }
    }

    // Fetch from API
    try {
      const url = `${this.apiBase}/api/v1/skills/${safeSlug}`;
      const response = await fetch(url, { headers: { 'Accept': 'application/json' } });

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`Details fetch failed: ${response.status}`);
      }

      const details = await response.json() as SkillDetails;

      // Update cache
      this.detailsCache.set(safeSlug, { data: details, cachedAt: Date.now() });

      return details;
    } catch (error) {
      this.runtime.logger.error(`ClawHub: Details fetch error: ${error}`);
      return this.detailsCache.get(safeSlug)?.data || null;
    }
  }

  // ============================================================
  // INSTALLATION OPERATIONS
  // ============================================================

  /**
   * Install a skill from ClawHub
   */
  async install(slug: string, version = 'latest'): Promise<boolean> {
    try {
      const safeSlug = sanitizeSlug(slug);
      this.runtime.logger.info(`ClawHub: Installing ${safeSlug}@${version}...`);

      // Get skill details
      const details = await this.getSkillDetails(safeSlug);
      if (!details) {
        throw new Error(`Skill "${safeSlug}" not found`);
      }

      const resolvedVersion = version === 'latest'
        ? details.latestVersion.version
        : version;

      // Download
      const downloadUrl = `${this.apiBase}/api/v1/download?slug=${safeSlug}&version=${resolvedVersion}`;
      const response = await fetch(downloadUrl);

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }

      const zipBuffer = await response.arrayBuffer();
      if (zipBuffer.byteLength > 10 * 1024 * 1024) {
        throw new Error('Package too large (max 10MB)');
      }

      // Extract
      const skillDir = path.join(this.skillsDir, safeSlug);
      if (!fs.existsSync(skillDir)) {
        fs.mkdirSync(skillDir, { recursive: true });
      }

      await this.extractZip(new Uint8Array(zipBuffer), skillDir);

      // Update lockfile
      this.updateLockfile(safeSlug, resolvedVersion);

      // Load the skill
      await this.loadSkill(safeSlug);

      this.runtime.logger.info(`ClawHub: Installed ${safeSlug}@${resolvedVersion}`);
      return true;
    } catch (error) {
      this.runtime.logger.error(`ClawHub: Install error: ${error}`);
      return false;
    }
  }

  // ============================================================
  // LOCAL SKILL OPERATIONS
  // ============================================================

  /**
   * Load all installed skills from disk
   */
  async loadInstalledSkills(): Promise<void> {
    if (!fs.existsSync(this.skillsDir)) return;

    const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        try {
          await this.loadSkill(entry.name);
        } catch (error) {
          this.runtime.logger.warn(`ClawHub: Failed to load ${entry.name}: ${error}`);
        }
      }
    }
  }

  /**
   * Load a single skill from disk
   */
  async loadSkill(slug: string): Promise<Skill | null> {
    const safeSlug = sanitizeSlug(slug);
    const skillDir = path.join(this.skillsDir, safeSlug);
    const skillMdPath = path.join(skillDir, 'SKILL.md');

    if (!fs.existsSync(skillMdPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(skillMdPath, 'utf-8');
      const { name, description } = this.parseFrontmatter(content);

      const scripts: string[] = [];
      const references: string[] = [];

      const scriptsDir = path.join(skillDir, 'scripts');
      if (fs.existsSync(scriptsDir)) {
        scripts.push(...fs.readdirSync(scriptsDir).filter(f => !f.startsWith('.')));
      }

      const refsDir = path.join(skillDir, 'references');
      if (fs.existsSync(refsDir)) {
        references.push(...fs.readdirSync(refsDir).filter(f => !f.startsWith('.')));
      }

      const lockVersion = this.getLockfileVersion(safeSlug);

      const skill: Skill = {
        slug: safeSlug,
        name: name || safeSlug,
        description: description || '',
        version: lockVersion || 'local',
        content,
        scripts,
        references,
        cachedAt: Date.now(),
      };

      this.loadedSkills.set(safeSlug, skill);
      return skill;
    } catch (error) {
      this.runtime.logger.error(`ClawHub: Load error for ${safeSlug}: ${error}`);
      return null;
    }
  }

  /**
   * Get all loaded (installed) skills
   */
  getLoadedSkills(): Skill[] {
    return Array.from(this.loadedSkills.values());
  }

  /**
   * Get a specific loaded skill
   */
  getLoadedSkill(slug: string): Skill | undefined {
    try {
      return this.loadedSkills.get(sanitizeSlug(slug));
    } catch {
      return undefined;
    }
  }

  /**
   * Get skill instructions (body without frontmatter)
   */
  getSkillInstructions(slug: string): string | null {
    try {
      const skill = this.loadedSkills.get(sanitizeSlug(slug));
      if (!skill?.content) return null;
      return skill.content.replace(/^---[\s\S]*?---\n*/, '').trim();
    } catch {
      return null;
    }
  }

  /**
   * Check if a skill is installed
   */
  isInstalled(slug: string): boolean {
    try {
      return this.loadedSkills.has(sanitizeSlug(slug));
    } catch {
      return false;
    }
  }

  // ============================================================
  // SYNC OPERATIONS (for background task)
  // ============================================================

  /**
   * Sync the skill catalog from ClawHub
   * Called by background task to keep catalog fresh
   */
  async syncCatalog(): Promise<{ added: number; updated: number }> {
    const oldCount = this.catalogCache?.data.length || 0;
    await this.getCatalog({ forceRefresh: true });
    const newCount = this.catalogCache?.data.length || 0;

    return {
      added: Math.max(0, newCount - oldCount),
      updated: newCount,
    };
  }

  /**
   * Get catalog stats for logging
   */
  getCatalogStats(): { total: number; installed: number; cachedAt: number | null; categories: string[] } {
    const categories = new Set<string>();
    if (this.catalogCache?.data) {
      for (const skill of this.catalogCache.data) {
        if (skill.tags) {
          for (const tag of Object.keys(skill.tags)) {
            if (tag !== 'latest') categories.add(tag);
          }
        }
      }
    }
    return {
      total: this.catalogCache?.data.length || 0,
      installed: this.loadedSkills.size,
      cachedAt: this.catalogCache?.cachedAt || null,
      categories: Array.from(categories).slice(0, 20),
    };
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  private async extractZip(zipBuffer: Uint8Array, targetDir: string): Promise<void> {
    const { unzipSync } = await import('fflate');
    const files = unzipSync(zipBuffer);

    for (const [fileName, data] of Object.entries(files)) {
      if (fileName.endsWith('/')) continue;

      const safeName = fileName.split('/').filter((p: string) => p && p !== '..' && p !== '.').join('/');
      if (!safeName) continue;

      const filePath = path.join(targetDir, safeName);
      const fileDir = path.dirname(filePath);

      if (!fs.existsSync(fileDir)) {
        fs.mkdirSync(fileDir, { recursive: true });
      }

      fs.writeFileSync(filePath, data);
    }
  }

  private parseFrontmatter(content: string): { name?: string; description?: string } {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};

    const yaml = match[1];
    const name = yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const description = yaml.match(/^description:\s*(.+)$/m)?.[1]?.trim();

    return { name, description };
  }

  private getLockfileVersion(slug: string): string | null {
    const lockfilePath = path.join(this.skillsDir, '.clawhub', 'lock.json');
    if (!fs.existsSync(lockfilePath)) return null;

    try {
      const lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf-8'));
      return lockfile[slug]?.version || null;
    } catch {
      return null;
    }
  }

  private updateLockfile(slug: string, version: string): void {
    const lockfilePath = path.join(this.skillsDir, '.clawhub', 'lock.json');
    const lockDir = path.dirname(lockfilePath);

    if (!fs.existsSync(lockDir)) {
      fs.mkdirSync(lockDir, { recursive: true });
    }

    let lockfile: Record<string, { version: string; installedAt: string }> = {};
    if (fs.existsSync(lockfilePath)) {
      try {
        lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf-8'));
      } catch { }
    }

    lockfile[slug] = { version, installedAt: new Date().toISOString() };
    fs.writeFileSync(lockfilePath, JSON.stringify(lockfile, null, 2));
  }

  private loadCatalogFromDisk(): void {
    const catalogPath = path.join(this.cacheDir, 'catalog.json');
    if (!fs.existsSync(catalogPath)) return;

    try {
      const cached = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
      if (cached.data && cached.cachedAt) {
        this.catalogCache = cached;
        this.runtime.logger.debug(`ClawHub: Loaded catalog cache (${cached.data.length} skills)`);
      }
    } catch { }
  }

  private saveCatalogToDisk(): void {
    if (!this.catalogCache) return;

    const catalogPath = path.join(this.cacheDir, 'catalog.json');
    try {
      fs.writeFileSync(catalogPath, JSON.stringify(this.catalogCache, null, 2));
    } catch { }
  }
}
