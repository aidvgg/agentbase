# AgentBase

[![CI](https://github.com/aidvgg/agentbase/actions/workflows/ci.yml/badge.svg)](https://github.com/aidvgg/agentbase/actions/workflows/ci.yml)

Put AI coworkers in your Discord server. Each one has a role, its own workspace and its own tools.

You message an agent the way you would message a teammate. It reads the request, works in its own folder (files, git, shell commands), and replies in the channel. Each agent's role and rules live in one plain text file, so changing how it behaves means editing a document, not code. A web dashboard shows which agents are online and how many tasks each has handled.

Every agent runs in its own Docker container, so one agent's workspace is separate from the next.

Built with TypeScript, the Anthropic TypeScript SDK (Claude Messages API), Redis, Docker and a React dashboard.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Usage](#usage)
- [Development](#development)
- [API Endpoints](#api-endpoints)
- [Security model](#security-model)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Architecture Details](#architecture-details)
- [Contributing](#contributing)
- [License](#license)
- [Credits](#credits)

---

## Features

- **Multi-Agent Coordination**, deploy multiple specialized AI agents with unique personalities and capabilities.
- **Discord Integration**, each agent runs as a Discord bot, responding to mentions and direct messages.
- **Real-time Monitoring**, live dashboard showing agent status, metrics, and activity logs.
- **Containerized Deployment**, Docker-based architecture for easy scaling and isolation.
- **Redis Coordination**, inter-agent communication and metrics via Redis pub/sub.
- **TypeScript**, fully typed codebase for reliability and maintainability.

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                     React Dashboard                         │
│       (Real-time WebSocket + REST API for metrics)          │
└──────────────────────┬──────────────────────────────────────┘
                       │
              ┌────────▼─────────┐
              │   Metrics API    │
              │  (Express + WS)  │
              └────────┬─────────┘
                       │
              ┌────────▼─────────┐
              │      Redis       │
              │   Pub/Sub + KV   │
              └────────┬─────────┘
                       │
       ┌───────────────┼───────────────┐
       │               │               │
  ┌────▼────┐    ┌────▼────┐    ┌────▼────┐
  │  Agent  │    │  Agent  │    │  Agent  │
  │ Backend │    │ DevOps  │    │Frontend │
  └────┬────┘    └────┬────┘    └────┬────┘
       │              │              │
       └──────────────┼──────────────┘
                      │
             ┌────────▼─────────┐
             │     Discord      │
             └──────────────────┘
```

---

## Project Structure

```text
agentbase/
├── backend/
│   ├── src/
│   │   ├── agent.ts              # Main agent wrapper class
│   │   ├── config-parser.ts      # YAML config parser
│   │   ├── metrics-api.ts        # Express + WebSocket API
│   │   └── index.ts              # Agent entrypoint
│   ├── examples/
│   │   └── dev-workforce/
│   │       ├── agent-backend/    # Senior backend engineer
│   │       ├── agent-devops/     # Senior DevOps engineer
│   │       ├── agent-frontend/   # Senior frontend engineer
│   │       └── dev-workforce.yaml # Team configuration
│   ├── Dockerfile
│   ├── Dockerfile.metrics
│   ├── docker-compose.yml
│   └── package.json
├── dashboard/
│   ├── src/
│   │   ├── components/           # React components
│   │   ├── hooks/                # Custom hooks
│   │   ├── App.tsx               # Main app component
│   │   └── main.tsx              # Entry point
│   ├── package.json
│   └── vite.config.ts
└── README.md
```

---

## Quick Start

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- Discord bot tokens (one per agent)
- Anthropic API keys (one per agent)

### Step 1 - Set Up Discord Bots

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Create 3 applications (`backend`, `devops`, `frontend`).
3. For each application:
   - Open the **Bot** section and click **Add Bot**.
   - Copy the bot token.
   - Enable **Message Content Intent** under *Privileged Gateway Intents*.
   - Go to **OAuth2 → URL Generator**.
   - Select the `bot` scope and the `Send Messages` and `Read Messages/View Channels` permissions.
   - Use the generated URL to invite the bot to your server.

### Step 2 - Configure Environment Variables

```bash
cd backend
cp .env.example .env
```

Edit `.env` and add your API keys and bot tokens:

```env
BACKEND_API_KEY=sk-ant-api03-your-backend-key
BACKEND_DISCORD_TOKEN=your-backend-bot-token

DEVOPS_API_KEY=sk-ant-api03-your-devops-key
DEVOPS_DISCORD_TOKEN=your-devops-bot-token

FRONTEND_API_KEY=sk-ant-api03-your-frontend-key
FRONTEND_DISCORD_TOKEN=your-frontend-bot-token
```

### Step 3 - Start the Backend

```bash
cd backend

# Install dependencies
npm install

# Start with Docker Compose
docker-compose up --build
```

This will start:

| Service        | Port  |
| -------------- | ----- |
| Redis          | 6379  |
| Agent Backend  | n/a   |
| Agent DevOps   | n/a   |
| Agent Frontend | n/a   |
| Metrics API    | 3001  |

### Step 4 - Start the Dashboard

```bash
cd dashboard

# Install dependencies
npm install

# Start development server
npm run dev
```

The dashboard will be available at [http://localhost:5173](http://localhost:5173).

---

## Usage

### Interacting with Agents

In Discord, mention an agent or send it a direct message:

```text
@backend  Design a REST endpoint for user auth.
@devops   Help me set up a CI/CD pipeline.
@frontend What's the best way to optimize this React component?
```

### Customizing Agents

Each agent has its own system prompt at `backend/examples/dev-workforce/agent-{name}/CLAUDE.md`. Edit these files to customize agent behavior.

### Adding New Agents

1. Create a new directory: `backend/examples/dev-workforce/agent-{name}/`.
2. Add a `CLAUDE.md` file with the system prompt.
3. Add the agent to `dev-workforce.yaml`:

   ```yaml
   agents:
     - name: "yourname"
       config_path: "examples/dev-workforce/agent-yourname"
       env:
         ANTHROPIC_API_KEY: "${YOURNAME_API_KEY}"
         DISCORD_BOT_TOKEN: "${YOURNAME_DISCORD_TOKEN}"
       volumes:
         workspace: "/agent-workspace"
   ```

4. Add the agent service to `docker-compose.yml` (or regenerate using the config parser).
5. Update your `.env` file with the new credentials.

---

## Development

### Backend

```bash
cd backend

# Build TypeScript
npm run build

# Run in development mode
npm run dev

# Run metrics API separately
npm run metrics
```

### Dashboard

```bash
cd dashboard

# Start dev server with hot reload
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

---

## API Endpoints

### Metrics API

| Method | Endpoint                   | Description                  |
| ------ | -------------------------- | ---------------------------- |
| GET    | `/health`                  | Health check                 |
| GET    | `/api/metrics`             | Get all agent metrics        |
| GET    | `/api/metrics/:agentId`    | Get specific agent metrics   |
| GET    | `/api/stats`               | Get system statistics        |
| WS     | `ws://localhost:3001`      | Real-time updates            |

### Example Response

```json
{
  "totalAgents": 3,
  "activeAgents": 3,
  "agents": [
    {
      "agentId": "backend",
      "status": "online",
      "uptime": "2h 15m",
      "tasksCompleted": 42,
      "cpu": 12.5,
      "memory": 35.8,
      "lastUpdated": 1703123456789
    }
  ],
  "timestamp": 1703123456789
}
```

`cpu` and `memory` are process-level measurements taken inside each agent container. `cpu` is the percent of one CPU core the agent process used between the last two metric samples, derived from `process.cpuUsage()` over elapsed wall time. `memory` is the agent process resident set size as a percent of the total memory the container sees.

---

## Security model

Agents execute shell commands and git operations requested through Discord, inside their own container and workspace volume. Anyone who can message the bot can make it run commands as the agent. Run AgentBase only in a private server with members you trust, and give each agent credentials scoped to what it actually needs.

Limits that exist today:

- **Path guard**, the file tools (`read_file`, `write_file`, `list_directory`) and the git and shell working directories resolve inside the agent's workspace, and paths that escape it are rejected.
- **Exec timeout**, `bash_command` is killed after `BASH_TIMEOUT_MS` milliseconds (default 60000).
- **Turn cap**, each message stops after `MAX_TOOL_TURNS` tool turns (default 25), and the agent says so in the channel.
- **Container isolation**, each agent runs in its own container with its own workspace volume, so one agent's files are separate from the next.

There is no command allowlist and no sandbox inside the container. A command the agent runs can reach the network and anything else the container can reach.

---

## Deployment

### Production Deployment

1. **Backend**, deploy to any Docker-compatible platform (AWS ECS, Fly.io, Railway, etc.).
2. **Dashboard**, deploy to Vercel, Netlify, or any static hosting.
3. **Redis**, use a managed Redis service (Upstash, Redis Cloud, AWS ElastiCache).

### Environment-Specific Configuration

For production, update `docker-compose.yml` and environment variables accordingly.

---

## Troubleshooting

<details>
<summary><strong>Agents not connecting to Discord</strong></summary>

- Verify bot tokens are correct.
- Ensure **Message Content Intent** is enabled in the Discord Developer Portal.
- Check that bots are invited to your server.

</details>

<details>
<summary><strong>Dashboard not showing metrics</strong></summary>

- Ensure the Metrics API is running on port `3001`.
- Check CORS settings in `metrics-api.ts`.
- Verify Redis is accessible.

</details>

<details>
<summary><strong>WebSocket connection failed</strong></summary>

- Check firewall settings.
- Ensure `WS_URL` in the dashboard `.env` is correct.
- Verify the Metrics API is running.

</details>

---

## Architecture Details

### Agent Lifecycle

1. Agent initializes with the system prompt from `CLAUDE.md`.
2. Connects to Redis for coordination.
3. Logs into Discord.
4. Starts metrics reporting (every 10 seconds).
5. Listens for Discord messages.
6. Processes messages via the Claude API.
7. Publishes activity to Redis.
8. Updates metrics in Redis.

### Metrics Flow

1. Agents publish metrics to Redis (`agent:{id}:activity`).
2. Agents publish activities to Redis pub/sub (`agent-activity`).
3. Metrics API subscribes to Redis channels.
4. Metrics API broadcasts to WebSocket clients.
5. Dashboard receives real-time updates.

---

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

---

## License

MIT

---

## Credits

Built with:

- [Anthropic TypeScript SDK (Claude Messages API)](https://github.com/anthropics/anthropic-sdk-typescript)
- [Discord.js](https://discord.js.org/)
- [React](https://react.dev/)
- [Vite](https://vitejs.dev/)
- [Redis](https://redis.io/)
- [Docker](https://www.docker.com/)
