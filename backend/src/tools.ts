import fs from "fs/promises";
import path from "path";
import { simpleGit, SimpleGit } from "simple-git";
import { exec } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);

export interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, any>;
    required: string[];
  };
}

export const tools: Tool[] = [
  {
    name: "read_file",
    description: "Read the contents of a file at the specified path",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file to read",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file at the specified path",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file to write",
        },
        content: {
          type: "string",
          description: "Content to write to the file",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_directory",
    description: "List files and directories in the specified directory",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the directory to list",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "git_clone",
    description: "Clone a Git repository to the workspace",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Git repository URL to clone",
        },
        directory: {
          type: "string",
          description: "Optional directory name for the cloned repo",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "git_status",
    description: "Get Git status of the repository",
    input_schema: {
      type: "object",
      properties: {
        repo_path: {
          type: "string",
          description: "Path to the Git repository",
        },
      },
      required: ["repo_path"],
    },
  },
  {
    name: "git_commit",
    description: "Commit changes to the Git repository",
    input_schema: {
      type: "object",
      properties: {
        repo_path: {
          type: "string",
          description: "Path to the Git repository",
        },
        message: {
          type: "string",
          description: "Commit message",
        },
        files: {
          type: "array",
          description: "Files to add and commit (or use '.' for all changes)",
          items: { type: "string" },
        },
      },
      required: ["repo_path", "message", "files"],
    },
  },
  {
    name: "git_push",
    description: "Push commits to remote repository",
    input_schema: {
      type: "object",
      properties: {
        repo_path: {
          type: "string",
          description: "Path to the Git repository",
        },
        branch: {
          type: "string",
          description: "Branch to push (defaults to current branch)",
        },
      },
      required: ["repo_path"],
    },
  },
  {
    name: "bash_command",
    description:
      "Execute a bash command in the workspace. Use for build tools, tests, etc.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Bash command to execute",
        },
        cwd: {
          type: "string",
          description: "Working directory for the command",
        },
      },
      required: ["command"],
    },
  },
];

export class ToolExecutor {
  private workingDirectory: string;
  private execTimeoutMs: number;

  constructor(workingDirectory: string, execTimeoutMs?: number) {
    this.workingDirectory = workingDirectory;
    this.execTimeoutMs =
      execTimeoutMs || Number(process.env.BASH_TIMEOUT_MS) || 60000;
  }

  private resolvePath(filePath: string): string {
    // Prevent path traversal outside workspace
    const resolved = path.resolve(this.workingDirectory, filePath);
    const relative = path.relative(this.workingDirectory, resolved);
    const escapes =
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative);
    if (escapes) {
      throw new Error("Path traversal outside workspace is not allowed");
    }
    return resolved;
  }

  async executeTool(
    toolName: string,
    toolInput: Record<string, any>
  ): Promise<string> {
    try {
      switch (toolName) {
        case "read_file":
          return await this.readFile(toolInput.path);

        case "write_file":
          return await this.writeFile(toolInput.path, toolInput.content);

        case "list_directory":
          return await this.listDirectory(toolInput.path);

        case "git_clone":
          return await this.gitClone(toolInput.url, toolInput.directory);

        case "git_status":
          return await this.gitStatus(toolInput.repo_path);

        case "git_commit":
          return await this.gitCommit(
            toolInput.repo_path,
            toolInput.message,
            toolInput.files
          );

        case "git_push":
          return await this.gitPush(toolInput.repo_path, toolInput.branch);

        case "bash_command":
          return await this.bashCommand(toolInput.command, toolInput.cwd);

        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }

  private async readFile(filePath: string): Promise<string> {
    const resolved = this.resolvePath(filePath);
    const content = await fs.readFile(resolved, "utf-8");
    return content;
  }

  private async writeFile(filePath: string, content: string): Promise<string> {
    const resolved = this.resolvePath(filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, "utf-8");
    return `Successfully wrote to ${filePath}`;
  }

  private async listDirectory(dirPath: string): Promise<string> {
    const resolved = this.resolvePath(dirPath);
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const formatted = entries
      .map((entry) => {
        const type = entry.isDirectory() ? "DIR " : "FILE";
        return `${type} ${entry.name}`;
      })
      .join("\n");
    return formatted || "Empty directory";
  }

  private async gitClone(url: string, directory?: string): Promise<string> {
    const git: SimpleGit = simpleGit(this.workingDirectory);
    const targetDir = directory || path.basename(url, ".git");
    await git.clone(url, targetDir);
    return `Successfully cloned ${url} to ${targetDir}`;
  }

  private async gitStatus(repoPath: string): Promise<string> {
    const resolved = this.resolvePath(repoPath);
    const git: SimpleGit = simpleGit(resolved);
    const status = await git.status();
    let result = `Branch: ${status.current}\n`;
    result += `Modified: ${status.modified.length} files\n`;
    result += `Untracked: ${status.not_added.length} files\n`;
    if (status.modified.length > 0) {
      result += `\nModified files:\n${status.modified.join("\n")}`;
    }
    if (status.not_added.length > 0) {
      result += `\nUntracked files:\n${status.not_added.join("\n")}`;
    }
    return result;
  }

  private async gitCommit(
    repoPath: string,
    message: string,
    files: string[]
  ): Promise<string> {
    const resolved = this.resolvePath(repoPath);
    const git: SimpleGit = simpleGit(resolved);

    // Add files
    await git.add(files);

    // Commit
    const result = await git.commit(message);
    return `Committed: ${result.commit} - ${message}`;
  }

  private async gitPush(
    repoPath: string,
    branch?: string
  ): Promise<string> {
    const resolved = this.resolvePath(repoPath);
    const git: SimpleGit = simpleGit(resolved);

    if (branch) {
      await git.push("origin", branch);
      return `Successfully pushed to ${branch}`;
    } else {
      await git.push();
      return `Successfully pushed to remote`;
    }
  }

  private async bashCommand(
    command: string,
    cwd?: string
  ): Promise<string> {
    const workDir = cwd ? this.resolvePath(cwd) : this.workingDirectory;
    const { stdout, stderr } = await execPromise(command, {
      cwd: workDir,
      maxBuffer: 1024 * 1024, // 1MB buffer
      timeout: this.execTimeoutMs,
    });
    return stdout + (stderr ? `\nStderr: ${stderr}` : "");
  }
}