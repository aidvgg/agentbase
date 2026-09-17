import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ToolExecutor } from "../src/tools.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentbase-test-"));
const workspace = path.join(root, "agent-workspace");
const sibling = path.join(root, "agent-workspace-evil");

await fs.mkdir(workspace);
await fs.mkdir(sibling);
await fs.writeFile(path.join(workspace, "inside.txt"), "inside", "utf-8");
await fs.writeFile(path.join(sibling, "secret.txt"), "secret", "utf-8");
await fs.writeFile(path.join(root, "escape.txt"), "escape", "utf-8");

const executor = new ToolExecutor(workspace);

test("reads a file inside the workspace", async () => {
  const result = await executor.executeTool("read_file", {
    path: "inside.txt",
  });
  assert.equal(result, "inside");
});

test("accepts the workspace root itself", async () => {
  const result = await executor.executeTool("list_directory", { path: "." });
  assert.match(result, /inside\.txt/);
});

test("rejects a parent directory escape", async () => {
  const result = await executor.executeTool("read_file", {
    path: "../escape.txt",
  });
  assert.match(result, /Path traversal outside workspace is not allowed/);
});

test("rejects a sibling directory that shares the workspace prefix", async () => {
  const result = await executor.executeTool("read_file", {
    path: "../agent-workspace-evil/secret.txt",
  });
  assert.match(result, /Path traversal outside workspace is not allowed/);
});

test("rejects an absolute path outside the workspace", async () => {
  const result = await executor.executeTool("read_file", {
    path: path.join(sibling, "secret.txt"),
  });
  assert.match(result, /Path traversal outside workspace is not allowed/);
});
