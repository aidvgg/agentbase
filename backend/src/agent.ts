import Anthropic from "@anthropic-ai/sdk";
import { Client, GatewayIntentBits, Message } from "discord.js";
import { createClient, RedisClientType } from "redis";
import fs from "fs";
import os from "os";
import { tools, ToolExecutor } from "./tools.js";

interface AgentConfig {
  agentId: string;
  systemPrompt: string;
  redisUrl?: string;
  discordToken: string;
  anthropicApiKey: string;
  workingDirectory?: string;
}

interface AgentActivity {
  agentId: string;
  timestamp: number;
  action: string;
  content: string;
  userId?: string;
  channelId?: string;
}

export class DiscordAgent {
  private claudeClient: Anthropic;
  private discordClient: Client;
  private redis: RedisClientType;
  private agentId: string;
  private systemPrompt: string;
  private _workingDirectory: string;
  private tasksCompleted: number = 0;
  private startTime: number;
  private toolExecutor: ToolExecutor;
  private lastCpuUsage: NodeJS.CpuUsage = process.cpuUsage();
  private lastCpuSampleAt: number = Date.now();

  constructor(config: AgentConfig) {
    this.agentId = config.agentId;
    this.systemPrompt = config.systemPrompt;
    this._workingDirectory = config.workingDirectory || "/agent-workspace";
    this.startTime = Date.now();

    this.redis = createClient({
      url: config.redisUrl || process.env.REDIS_URL || "redis://localhost:6379",
    });

    this.redis.on("error", (err) => {
      console.error(`[${this.agentId}] Redis error:`, err);
    });

    this.claudeClient = new Anthropic({
      apiKey: config.anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });

    this.discordClient = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.toolExecutor = new ToolExecutor(this._workingDirectory);
  }

  async start(): Promise<void> {
    try {
      await this.redis.connect();
      console.log(`[${this.agentId}] Connected to Redis`);

      this.startMetricsReporting();
      this.setupEventHandlers();
      await this.discordClient.login(process.env.DISCORD_BOT_TOKEN);
      console.log(`[${this.agentId}] Connected to Discord`);

      await this.updateStatus("online");
    } catch (error) {
      console.error(`[${this.agentId}] Failed to start:`, error);
      throw error;
    }
  }

  private setupEventHandlers(): void {
    this.discordClient.on("ready", () => {
      console.log(
        `[${this.agentId}] Discord bot ready as ${this.discordClient.user?.tag}`
      );
      this.publishActivity({
        agentId: this.agentId,
        timestamp: Date.now(),
        action: "bot_ready",
        content: `Agent ${this.agentId} is now online`,
      });
    });

    this.discordClient.on("messageCreate", async (message: Message) => {
      await this.handleMessage(message);
    });

    this.discordClient.on("error", (error) => {
      console.error(`[${this.agentId}] Discord error:`, error);
    });
  }

  private async handleMessage(message: Message): Promise<void> {
    // Ignore bot messages
    if (message.author.bot) return;

    // Check if bot is mentioned or it's a DM
    const isMentioned = message.mentions.has(this.discordClient.user!);
    const isDM = message.channel.isDMBased();

    if (!isMentioned && !isDM) return;

    try {
      console.log(
        `[${this.agentId}] Processing message from ${message.author.tag}`
      );

      // Show typing indicator
      if (message.channel.isSendable()) {
        await message.channel.sendTyping();
      }

      // Track start time
      const startTime = Date.now();

      // Process with Claude
      const { response, usage } = await this.processWithClaude(message.content);

      // Calculate metrics
      const responseTime = ((Date.now() - startTime) / 1000).toFixed(2);

      // Calculate cost (Claude Sonnet 4 pricing: $3/MTok input, $15/MTok output)
      const inputCost = (usage.input_tokens / 1_000_000) * 3;
      const outputCost = (usage.output_tokens / 1_000_000) * 15;
      const totalCost = inputCost + outputCost;

      // Format the response with metrics
      const formattedResponse = `${response}\n\n⏱️ ${responseTime}s • 💰 $${totalCost.toFixed(
        4
      )} • 🔄 ${usage.input_tokens + usage.output_tokens} tokens`;

      // Send response
      await message.reply(formattedResponse);

      // Update metrics
      this.tasksCompleted++;
      await this.updateMetrics();

      // Publish activity
      await this.publishActivity({
        agentId: this.agentId,
        timestamp: Date.now(),
        action: "message_processed",
        content: message.content.substring(0, 100),
        userId: message.author.id,
        channelId: message.channelId,
      });
    } catch (error) {
      console.error(`[${this.agentId}] Error processing message:`, error);
      await message.reply(
        "Sorry, I encountered an error processing your request."
      );
    }
  }

  private async processWithClaude(userMessage: string): Promise<{
    response: string;
    usage: { input_tokens: number; output_tokens: number };
  }> {
    try {
      const messages: Anthropic.MessageParam[] = [
        {
          role: "user",
          content: userMessage,
        },
      ];

      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let finalResponse = "";
      let continueProcessing = true;

      // Agentic loop: allow Claude to use tools iteratively
      while (continueProcessing) {
        const apiResponse = await this.claudeClient.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: this.systemPrompt,
          tools: tools,
          messages: messages,
        });

        totalInputTokens += apiResponse.usage.input_tokens;
        totalOutputTokens += apiResponse.usage.output_tokens;

        // Check if Claude wants to use tools
        const toolUseBlocks = apiResponse.content.filter(
          (block) => block.type === "tool_use"
        );

        if (toolUseBlocks.length > 0) {
          // Execute tools
          const toolResults: Anthropic.MessageParam = {
            role: "user",
            content: [],
          };

          for (const toolBlock of toolUseBlocks) {
            if (toolBlock.type === "tool_use") {
              console.log(
                `[${this.agentId}] Executing tool: ${toolBlock.name}`
              );
              const result = await this.toolExecutor.executeTool(
                toolBlock.name,
                toolBlock.input as Record<string, any>
              );

              (toolResults.content as any[]).push({
                type: "tool_result",
                tool_use_id: toolBlock.id,
                content: result,
              });
            }
          }

          // Add assistant's response and tool results to conversation
          messages.push({
            role: "assistant",
            content: apiResponse.content,
          });
          messages.push(toolResults);
        } else {
          // No more tools to use, extract final response
          const textContent = apiResponse.content
            .filter((block) => block.type === "text")
            .map((block) => (block.type === "text" ? block.text : ""))
            .join("\n");

          finalResponse = textContent || "I processed your request but have no response.";
          continueProcessing = false;
        }
      }

      return {
        response: finalResponse,
        usage: {
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
        },
      };
    } catch (error) {
      console.error(`[${this.agentId}] Claude API error:`, error);
      throw error;
    }
  }

  private async publishActivity(activity: AgentActivity): Promise<void> {
    try {
      await this.redis.publish("agent-activity", JSON.stringify(activity));
    } catch (error) {
      console.error(`[${this.agentId}] Failed to publish activity:`, error);
    }
  }

  private async updateStatus(status: string): Promise<void> {
    try {
      await this.redis.hSet(`agent:${this.agentId}:activity`, "status", status);
    } catch (error) {
      console.error(`[${this.agentId}] Failed to update status:`, error);
    }
  }

  private async updateMetrics(): Promise<void> {
    try {
      const uptime = Math.floor((Date.now() - this.startTime) / 1000);
      const uptimeStr = this.formatUptime(uptime);

      await this.redis.hSet(`agent:${this.agentId}:activity`, {
        status: "online",
        uptime: uptimeStr,
        tasks_completed: this.tasksCompleted.toString(),
        cpu: this.sampleCpuPercent().toFixed(2),
        memory: ((process.memoryUsage().rss / os.totalmem()) * 100).toFixed(2),
        last_updated: Date.now().toString(),
      });
    } catch (error) {
      console.error(`[${this.agentId}] Failed to update metrics:`, error);
    }
  }

  // Percent of one CPU core used by this process since the previous sample.
  private sampleCpuPercent(): number {
    const now = Date.now();
    const used = process.cpuUsage(this.lastCpuUsage);
    const elapsedMs = now - this.lastCpuSampleAt;
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuSampleAt = now;
    if (elapsedMs <= 0) return 0;
    return ((used.user + used.system) / 1000 / elapsedMs) * 100;
  }

  private startMetricsReporting(): void {
    // Update metrics every 10 seconds
    setInterval(async () => {
      await this.updateMetrics();
    }, 10000);
  }

  private formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  async stop(): Promise<void> {
    console.log(`[${this.agentId}] Shutting down...`);
    await this.updateStatus("offline");
    this.discordClient.destroy();
    await this.redis.quit();
  }

  static loadSystemPrompt(promptPath: string): string {
    try {
      return fs.readFileSync(promptPath, "utf-8");
    } catch (error) {
      console.error(`Failed to load system prompt from ${promptPath}:`, error);
      return "You are a helpful AI assistant.";
    }
  }
}
