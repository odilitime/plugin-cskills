# @elizaos/plugin-clawhub

Seamless ClawHub skills integration for elizaOS with intelligent caching and background sync.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      ClawHubService                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Catalog   │  │   Search    │  │   Skill Details     │  │
│  │   Cache     │  │   Cache     │  │   Cache             │  │
│  │  (1 hour)   │  │  (5 min)    │  │   (30 min)          │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                                                              │
│  notOlderThan: ms | forceRefresh: bool                      │
└─────────────────────────────────────────────────────────────┘
         ↑                    ↑                    ↑
    Background            Actions              Providers
      Task                (network)            (cache only)
```

## How It Works

**Users don't need to know about ClawHub.** Skills are discovered and installed automatically:

```
User: "Help me with browser automation"
Agent: [GET_SKILL_GUIDANCE → searches → installs agent-browser → returns instructions]
```

### Service Layer
All I/O goes through `ClawHubService` with built-in caching:

```typescript
// Use cache (default TTL)
await service.getCatalog();

// Force fresh data
await service.getCatalog({ forceRefresh: true });

// Cache only (no network)
await service.getCatalog({ notOlderThan: Infinity });

// Custom TTL
await service.getCatalog({ notOlderThan: 1000 * 60 * 5 }); // 5 min
```

### Background Task
Syncs the skill catalog hourly, keeping the agent aware of new skills without blocking requests.

### Providers (Resolution Levels)

| Provider | Resolution | Position | Content |
|----------|------------|----------|---------|
| `skillsOverviewProvider` | Low | -20 | Counts + examples |
| `skillsSummaryProvider` | Medium | -10 | Installed skills + descriptions |
| `skillInstructionsProvider` | High | 5 | Full instructions for matched skill |
| `catalogAwarenessProvider` | Dynamic | 10 | Categorized catalog (when asked) |

**Providers never make network calls** - they only read from cache.

## Installation

```bash
bun add @elizaos/plugin-clawhub
```

## Usage

```typescript
import { clawHubPlugin } from '@elizaos/plugin-clawhub';

const agent = new Agent({
  plugins: [clawHubPlugin],
});
```

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `CLAWHUB_SKILLS_DIR` | Skill cache directory | `./skills` |
| `CLAWHUB_AUTO_LOAD` | Load cached skills on startup | `true` |
| `CLAWHUB_REGISTRY` | Custom registry URL | `https://clawhub.ai` |

## Performance

| Operation | Time |
|-----------|------|
| Catalog (first fetch) | ~10-20s (paginating 2000+ skills) |
| Catalog (cached) | <5ms |
| Search (cached) | <5ms |
| Provider execution | <10ms |
| Skill install | 1-3s |

## Action

### `GET_SKILL_GUIDANCE`
The single action that handles everything:
1. Checks installed skills (fast local lookup)
2. Searches ClawHub if no match found
3. Auto-installs best result
4. Returns instructions for the agent to follow

```
User: "Help with browser automation"
Agent: [GET_SKILL_GUIDANCE] → finds agent-browser → installs → follows instructions
```

No manual search/install actions needed - the plugin handles it all.

## Cache Management

The service caches:
- **Catalog**: Full list of all skills (TTL: 1 hour)
- **Search results**: By query (TTL: 5 min)
- **Skill details**: By slug (TTL: 30 min)

Catalog is also persisted to disk at `./skills/.clawhub/cache/catalog.json`.

## API

Uses ClawHub v1 API:
- `GET /api/v1/skills?limit=100&cursor=...` - Paginated catalog
- `GET /api/v1/search?q=<query>` - Vector search
- `GET /api/v1/skills/<slug>` - Skill details
- `GET /api/v1/download?slug=<slug>&version=<ver>` - Download

## Security

- No script execution (instructions only)
- Path traversal protection
- 10MB package size limit
- Network calls only in actions/tasks, never providers

## License

MIT
