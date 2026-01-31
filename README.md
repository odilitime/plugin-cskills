# @elizaos/plugin-clawhub

ClawHub skills integration for elizaOS. Enables agents to discover, install, and use skills from [ClawHub](https://clawhub.com) (the OpenClaw skill registry).

## Features

- 🔍 **Search** ClawHub for available skills
- 📦 **Install** skills from the registry
- ⚡ **Execute** skill scripts
- 🧠 **Auto-inject** skill instructions into agent context

## Installation

```bash
npm install @elizaos/plugin-clawhub
```

## Usage

Add the plugin to your elizaOS agent:

```typescript
import { clawHubPlugin } from '@elizaos/plugin-clawhub';

const agent = new Agent({
  plugins: [clawHubPlugin],
  // ...
});
```

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `CLAWHUB_SKILLS_DIR` | Directory to install skills | `./skills` |
| `CLAWHUB_AUTO_LOAD` | Auto-load installed skills on startup | `true` |

## Actions

### `clawhub_search`
Search ClawHub for available skills.

```
User: Search for weather skills
Agent: Found 2 skills for "weather":
       1. **Weather** (`weather`) - Get current weather and forecasts
```

### `clawhub_install`
Install a skill from ClawHub.

```
User: Install the babylon skill
Agent: ✅ Installed skill: **Babylon Prediction Markets**
```

### `clawhub_run`
Execute a script from an installed skill.

```
User: Run babylon balance
Agent: **babylon/babylon-client.ts** output:
       {"balance": "866.29", "lifetimePnL": "-10.20"}
```

## Providers

### `clawhub_skills`
Injects a summary of installed skills into the agent's context.

### `clawhub_skill_instructions`
Injects detailed instructions from relevant skills based on conversation context.

## Example: Using the Babylon Skill

```
User: Search for prediction market skills
Agent: Found 1 skill: **Babylon Prediction Markets** (`babylon`)

User: Install babylon
Agent: ✅ Installed skill: Babylon Prediction Markets

User: What's my Babylon balance?
Agent: [Uses skill instructions to know how to check balance]
       Run babylon balance
       Your balance is 866.29 points with a lifetime PnL of -10.20
```

## License

MIT
