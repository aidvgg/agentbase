import dotenv from 'dotenv';
import { DiscordAgent } from './agent.js';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const agentId = process.env.AGENT_ID;
  const configPath = process.env.AGENT_CONFIG_PATH;

  if (!agentId) {
    console.error('AGENT_ID environment variable is required');
    process.exit(1);
  }

  if (!configPath) {
    console.error('AGENT_CONFIG_PATH environment variable is required');
    process.exit(1);
  }

  console.log(`Starting agent: ${agentId}`);
  console.log(`Config path: ${configPath}`);

  try {
    // Load system prompt - resolve from app root
    // In Docker, working directory is /app
    // Examples are at /app/examples
    const promptPath = path.resolve('/app', configPath, 'CLAUDE.md');

    console.log(`Looking for CLAUDE.md at: ${promptPath}`);
    const systemPrompt = DiscordAgent.loadSystemPrompt(promptPath);

    // Create and start agent
    const agent = new DiscordAgent({
      agentId,
      systemPrompt,
      discordToken: process.env.DISCORD_BOT_TOKEN!,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
      redisUrl: process.env.REDIS_URL,
      workingDirectory: process.env.WORKING_DIRECTORY || '/agent-workspace'
    });

    await agent.start();

    console.log(`Agent ${agentId} is now running`);

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log(`\nShutting down agent ${agentId}...`);
      await agent.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log(`\nShutting down agent ${agentId}...`);
      await agent.stop();
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start agent:', error);
    process.exit(1);
  }
}

main().catch(console.error);
