# Build Plan: Multi-Agent Claude Discord Infrastructure + React Dashboard (TypeScript/Node.js)

## 1. Overview
This plan details how to build a modular, scalable, multi-agent Discord infrastructure using **Anthropic TypeScript SDK (Claude Messages API)**, **TypeScript**, **Node.js**, **Redis**, and **Docker**, with a **React + Vite dashboard** for real-time monitoring and management. The system follows a configuration-driven pipeline where agents are deployed as containerized services, coordinated via Redis, and monitored through a live web dashboard.

---

## 2. Project Structure

```
agentbase/
├── backend/
│   ├── src/
│   │   ├── agent.ts              # Main agent wrapper
│   │   ├── discord-handler.ts    # Discord bot logic
│   │   ├── coordinator.ts        # Redis coordination
│   │   ├── metrics-api.ts        # Express API for metrics
│   │   └── index.ts              # Agent entrypoint
│   ├── examples/
│   │   └── sample-workforce/
│   │       ├── agent-denver/
│   │       │   └── CLAUDE.md    # System prompt
│   │       ├── agent-phoenix/
│   │       │   └── CLAUDE.md
│   │       ├── agent-sierra/
│   │       │   └── CLAUDE.md
│   │       └── workforce.yaml   # Team config
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── package.json
├── dashboard/
│   ├── src/
│   │   ├── App.tsx              # Main React app
│   │   ├── components/
│   │   │   ├── AgentCard.tsx    # Individual agent display
│   │   │   ├── MetricsOverview.tsx
│   │   │   ├── ActivityLogs.tsx
│   │   │   └── SystemHealth.tsx
│   │   ├── hooks/
│   │   │   ├── useWebSocket.ts  # WebSocket connection
│   │   │   └── useMetrics.ts    # Fetch metrics from API
│   │   └── main.tsx             # Entry point
│   ├── public/
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
└── README.md
```

---

## 3. Backend Build Steps

### Step 1: Dependencies
Install core packages:
```bash
cd backend
npm install typescript @types/node discord.js @anthropic-ai/sdk redis @modelcontextprotocol/sdk express cors ws js-yaml
npm install -D @types/express @types/cors @types/ws
```

### Step 2: Agent Definition
- Create `CLAUDE.md` system prompts for each agent (denver, phoenix, sierra)
- Define team configuration in `workforce.yaml`:
  - Agent names, config paths, environment variables
  - Discord bot tokens, Claude API keys
  - Volume mounts for workspace and sessions

### Step 3: Configuration Parser
Parse `workforce.yaml` and generate Docker Compose services:
```typescript
// src/config-parser.ts
import yaml from 'js-yaml';
import fs from 'fs';

interface AgentConfig {
  name: string;
  config_path: string;
  env: Record<string, string>;
  volumes: { workspace: string; sessions: string };
}

export function parseWorkforceConfig(yamlPath: string) {
  const content = fs.readFileSync(yamlPath, 'utf8');
  return yaml.load(content);
}
```

### Step 4: Agent Wrapper Class
Combine Claude SDK + Discord.js + Redis:
```typescript
// src/agent.ts
import { ClaudeSDKClient } from '@anthropic-ai/sdk';
import { Client, GatewayIntentBits } from 'discord.js';
import { createClient } from 'redis';

export class DiscordAgent {
  private claudeClient: ClaudeSDKClient;
  private discordClient: Client;
  private redis: ReturnType<typeof createClient>;
  private agentId: string;
  
  constructor(agentId: string, systemPrompt: string) {
    this.agentId = agentId;
    this.redis = createClient({ url: process.env.REDIS_URL });
    
    // Initialize the Anthropic TypeScript SDK (Claude Messages API)
    this.claudeClient = new ClaudeSDKClient({
      apiKey: process.env.ANTHROPIC_API_KEY,
      systemPrompt,
      workingDirectory: '/agent-workspace'
    });
    
    // Initialize Discord
    this.discordClient = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });
  }
  
  async start() {
    await this.redis.connect();
    await this.discordClient.login(process.env.DISCORD_BOT_TOKEN);
    this.setupEventHandlers();
  }
  
  private setupEventHandlers() {
    this.discordClient.on('messageCreate', async (msg) => {
      if (msg.author.bot) return;
      
      // Process with Claude
      const response = await this.claudeClient.query({
        messages: [{ role: 'user', content: msg.content }]
      });
      
      // Publish activity to Redis for dashboard
      await this.redis.publish('agent-activity', JSON.stringify({
        agentId: this.agentId,
        timestamp: Date.now(),
        action: 'message_processed',
        content: msg.content.substring(0, 100)
      }));
      
      await msg.reply(response.content);
    });
  }
}
```

### Step 5: Metrics API (Express + WebSocket)
Real-time API for dashboard consumption:
```typescript
// src/metrics-api.ts
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { createClient } from 'redis';
import cors from 'cors';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const redis = createClient({ url: process.env.REDIS_URL });

app.use(cors());
app.use(express.json());

await redis.connect();

// REST endpoint for current metrics
app.get('/api/metrics', async (req, res) => {
  const agents = await redis.keys('agent:*:activity');
  const metrics = await Promise.all(
    agents.map(async (key) => {
      const data = await redis.hGetAll(key);
      return {
        agentId: key.split(':')[1],
        status: data.status || 'unknown',
        uptime: data.uptime || '0s',
        tasksCompleted: parseInt(data.tasks_completed || '0'),
        cpu: parseFloat(data.cpu || '0'),
        memory: parseFloat(data.memory || '0')
      };
    })
  );
  
  res.json({
    totalAgents: metrics.length,
    activeAgents: metrics.filter(m => m.status === 'online').length,
    agents: metrics,
    timestamp: Date.now()
  });
});

// WebSocket for real-time updates
wss.on('connection', (ws) => {
  console.log('Dashboard connected');
  
  // Subscribe to Redis pub/sub
  const subscriber = redis.duplicate();
  subscriber.connect();
  
  subscriber.subscribe('agent-activity', (message) => {
    ws.send(message);
  });
  
  ws.on('close', () => {
    subscriber.disconnect();
  });
});

server.listen(3001, () => {
  console.log('Metrics API running on port 3001');
});
```

### Step 6: Docker Setup
**Dockerfile for agents:**
```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/

RUN mkdir -p /agent-workspace && \
    chown -R node:node /agent-workspace

USER node

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
```

**docker-compose.yml:**
```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    container_name: agentbase-redis
    ports:
      - '6379:6379'
    networks:
      - agent-network
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]

  agent-denver:
    build:
      context: .
      args:
        AGENT_CONFIG_PATH: examples/sample-workforce/agent-denver
    container_name: agentbase-denver
    environment:
      - ANTHROPIC_API_KEY=${DENVER_API_KEY}
      - DISCORD_BOT_TOKEN=${DENVER_DISCORD_TOKEN}
      - REDIS_URL=redis://redis:6379
      - AGENT_ID=denver
    volumes:
      - denver-workspace:/agent-workspace
    networks:
      - agent-network
    depends_on:
      - redis

  # Repeat for phoenix, sierra...

  metrics-api:
    build:
      context: .
      dockerfile: Dockerfile.metrics
    container_name: agentbase-metrics
    ports:
      - '3001:3001'
    environment:
      - REDIS_URL=redis://redis:6379
    networks:
      - agent-network
    depends_on:
      - redis

volumes:
  denver-workspace:
  phoenix-workspace:
  sierra-workspace:

networks:
  agent-network:
    driver: bridge
```

---

## 4. Frontend Dashboard Build Steps

### Step 1: Initialize React + Vite + TypeScript
```bash
npm create vite@latest dashboard -- --template react-ts
cd dashboard
npm install
npm install axios ws recharts lucide-react
npm install -D @types/ws
```

### Step 2: WebSocket Hook for Real-Time Updates
```typescript
// src/hooks/useWebSocket.ts
import { useEffect, useState } from 'react';

export function useWebSocket(url: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<any>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);

  useEffect(() => {
    const socket = new WebSocket(url);

    socket.onopen = () => setIsConnected(true);
    socket.onclose = () => setIsConnected(false);
    socket.onmessage = (event) => {
      setLastMessage(JSON.parse(event.data));
    };

    setWs(socket);

    return () => {
      socket.close();
    };
  }, [url]);

  return { isConnected, lastMessage, ws };
}
```

### Step 3: Metrics Hook for REST API
```typescript
// src/hooks/useMetrics.ts
import { useEffect, useState } from 'react';
import axios from 'axios';

interface AgentMetrics {
  agentId: string;
  status: string;
  uptime: string;
  tasksCompleted: number;
  cpu: number;
  memory: number;
}

interface SystemMetrics {
  totalAgents: number;
  activeAgents: number;
  agents: AgentMetrics[];
  timestamp: number;
}

export function useMetrics(apiUrl: string, refreshInterval = 5000) {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const response = await axios.get(`${apiUrl}/api/metrics`);
        setMetrics(response.data);
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch metrics:', error);
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, refreshInterval);

    return () => clearInterval(interval);
  }, [apiUrl, refreshInterval]);

  return { metrics, loading };
}
```

### Step 4: Dashboard Components

**MetricsOverview.tsx:**
```typescript
import React from 'react';

interface Props {
  totalAgents: number;
  activeAgents: number;
  completedToday: number;
  avgEfficiency: number;
  systemLoad: number;
  errorRate: number;
}

export function MetricsOverview({ 
  totalAgents, 
  activeAgents, 
  completedToday,
  avgEfficiency,
  systemLoad,
  errorRate 
}: Props) {
  return (
    <div className="metrics-grid">
      <MetricCard 
        title="TOTAL_AGENTS" 
        value={totalAgents} 
        status="OPERATIONAL" 
      />
      <MetricCard 
        title="ACTIVE_TASKS" 
        value={activeAgents} 
        status="PROCESSING" 
      />
      <MetricCard 
        title="COMPLETED_TODAY" 
        value={completedToday} 
        status="NOMINAL" 
      />
      <MetricCard 
        title="AVG_EFFICIENCY" 
        value={`${avgEfficiency}%`} 
        status="OPTIMAL" 
      />
      <MetricCard 
        title="SYSTEM_LOAD" 
        value={`${systemLoad}%`} 
        status="NORMAL" 
      />
      <MetricCard 
        title="ERROR_RATE" 
        value={`${errorRate}%`} 
        status="MINIMAL" 
      />
    </div>
  );
}
```

**AgentCard.tsx:**
```typescript
import React from 'react';

interface Agent {
  agentId: string;
  status: string;
  uptime: string;
  tasksCompleted: number;
  cpu: number;
  memory: number;
}

export function AgentCard({ agent }: { agent: Agent }) {
  const statusColor = agent.status === 'online' ? 'green' : 'red';
  
  return (
    <div className="agent-card">
      <div className="agent-header">
        <h3>{agent.agentId.toUpperCase()}</h3>
        <span className={`status-badge status-${statusColor}`}>
          {agent.status.toUpperCase()}
        </span>
      </div>
      
      <div className="agent-stats">
        <div className="stat">
          <span>CURRENT_TASK</span>
          <span>Idle</span>
        </div>
        <div className="stat">
          <span>UPTIME</span>
          <span>{agent.uptime}</span>
        </div>
        <div className="stat">
          <span>TASKS_COMPLETED</span>
          <span>{agent.tasksCompleted}</span>
        </div>
      </div>
      
      <div className="resource-usage">
        <div className="usage-bar">
          <label>CPU</label>
          <div className="bar">
            <div className="fill" style={{ width: `${agent.cpu}%` }} />
          </div>
          <span>{agent.cpu.toFixed(1)}%</span>
        </div>
        <div className="usage-bar">
          <label>MEMORY</label>
          <div className="bar">
            <div className="fill" style={{ width: `${agent.memory}%` }} />
          </div>
          <span>{agent.memory.toFixed(1)}%</span>
        </div>
      </div>
      
      <div className="agent-actions">
        <button>VIEW LOGS</button>
        <button>CONFIGURE</button>
        <button>⏻</button>
      </div>
    </div>
  );
}
```

**App.tsx (Main Dashboard):**
```typescript
import { useMetrics } from './hooks/useMetrics';
import { useWebSocket } from './hooks/useWebSocket';
import { MetricsOverview } from './components/MetricsOverview';
import { AgentCard } from './components/AgentCard';
import { ActivityLogs } from './components/ActivityLogs';
import './App.css';

const API_URL = 'http://localhost:3001';
const WS_URL = 'ws://localhost:3001';

export function App() {
  const { metrics, loading } = useMetrics(API_URL);
  const { isConnected, lastMessage } = useWebSocket(WS_URL);

  if (loading) return <div>Loading...</div>;

  return (
    <div className="dashboard">
      <header>
        <h1>AGENTBASE WORKFORCE MANAGEMENT SYSTEM</h1>
        <div className="connection-status">
          <span className={isConnected ? 'connected' : 'disconnected'}>
            {isConnected ? '● CONNECTED' : '○ DISCONNECTED'}
          </span>
        </div>
      </header>

      <MetricsOverview
        totalAgents={metrics?.totalAgents || 0}
        activeAgents={metrics?.activeAgents || 0}
        completedToday={1}
        avgEfficiency={15.4}
        systemLoad={6}
        errorRate={0.2}
      />

      <div className="search-bar">
        <input type="text" placeholder="SEARCH AGENTS..." />
        <button>FILTER</button>
        <button>EXPORT</button>
        <button>REFRESH</button>
      </div>

      <section className="agent-roster">
        <h2>AGENT ROSTER</h2>
        <div className="agent-grid">
          {metrics?.agents.map(agent => (
            <AgentCard key={agent.agentId} agent={agent} />
          ))}
        </div>
      </section>

      {lastMessage && (
        <ActivityLogs activity={lastMessage} />
      )}
    </div>
  );
}
```

### Step 5: Styling (App.css)
Create a monospace, terminal-style UI matching the screenshot:
```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: 'Courier New', monospace;
}

.dashboard {
  background: #f5f5f5;
  min-height: 100vh;
  padding: 20px;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
}

header h1 {
  font-size: 20px;
  font-weight: bold;
}

.connected {
  color: green;
}

.disconnected {
  color: red;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 20px;
  margin-bottom: 30px;
}

.agent-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

.agent-card {
  background: white;
  border: 2px solid #e0e0e0;
  padding: 20px;
}

.status-badge {
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: bold;
}

.status-green {
  background: #e8f5e9;
  color: #2e7d32;
}

.usage-bar {
  margin: 10px 0;
}

.bar {
  width: 100%;
  height: 8px;
  background: #e0e0e0;
  position: relative;
}

.bar .fill {
  height: 100%;
  background: #2196f3;
}
```

### Step 6: Build & Deploy Dashboard
```bash
npm run build
# Serve static files via Express or deploy to Vercel/Netlify
```

---

## 5. Full System Deployment

1. **Configure environment variables** (`.env`):
   ```
   DENVER_API_KEY=sk-ant-...
   DENVER_DISCORD_TOKEN=...
   PHOENIX_API_KEY=...
   PHOENIX_DISCORD_TOKEN=...
   SIERRA_API_KEY=...
   SIERRA_DISCORD_TOKEN=...
   DISCORD_SERVER_ID=...
   ```

2. **Build and start backend:**
   ```bash
   cd backend
   docker-compose build
   docker-compose up -d
   ```

3. **Start dashboard:**
   ```bash
   cd dashboard
   npm run dev
   ```

4. **Access dashboard at:** `http://localhost:5173`

---

## 6. Key Features Implemented

✅ **Multi-agent orchestration** via Docker containers  
✅ **Redis pub/sub** for inter-agent coordination  
✅ **Real-time WebSocket** updates to dashboard  
✅ **REST API** for historical metrics  
✅ **React + TypeScript** modern UI  
✅ **Agent isolation** with dedicated resources  
✅ **Live activity logs** streaming  
✅ **System health monitoring** (CPU, memory, uptime)

---

## 7. Hosting & Cost Considerations

| Component | Service | Cost |
|-----------|---------|------|
| 3 Agents | Fly.io | $5.82/mo |
| Redis | Upstash Free | $0 |
| Metrics API | Railway | $5/mo |
| Dashboard | Vercel | $0 |
| **Total** | | **~$11/mo** |

---

## 8. Extensions & Next Steps

- Add agent configuration UI (edit system prompts)
- Implement agent start/stop controls from dashboard
- Add authentication (JWT + protected routes)
- Create historical analytics charts (recharts/chart.js)
- Implement log export functionality
- Add custom MCP tools via dashboard
- Multi-server orchestration for scaling
- Alert system for agent failures

---

## 9. References
- Anthropic TypeScript SDK (Claude Messages API) documentation
- Discord.js guide
- WebSocket with React/TypeScript
- Docker Compose best practices
- Real-time dashboard patterns