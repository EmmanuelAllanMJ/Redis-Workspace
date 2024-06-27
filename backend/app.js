const express = require("express");
const Docker = require("dockerode");
const redis = require("redis");
const { promisify } = require("util");
const yaml = require("js-yaml");
const fs = require("fs-extra");

const app = express();
const docker = new Docker();

app.use(express.json());

const sessions = new Map();

async function loadSessionConfig() {
  const file = await fs.readFile("redis-session.yaml", "utf8");
  return yaml.load(file);
}

async function executeRedisCommand(container, command, ...args) {
  const exec = await container.exec({
      Cmd: ['redis-cli', command, ...args],
      AttachStdout: true,
      AttachStderr: true
  });
  
  const stream = await exec.start();
  return new Promise((resolve, reject) => {
      let output = '';
      stream.on('data', (chunk) => {
          output += chunk.toString();
      });
      stream.on('end', () => {
          resolve(output.trim());
      });
      stream.on('error', reject);
  });
}


app.post("/start-session", async (req, res) => {
  try {
    const sessionId = Math.random().toString(36).substring(7);
    const containerName = `redis-session-${sessionId}`;

    const container = await docker.createContainer({
      Image: "redis:latest",
      name: containerName,
      ExposedPorts: {
        "6379/tcp": {},
      },
      HostConfig: {
        PortBindings: {
          "6379/tcp": [{ HostPort: "0" }],
        },
        Memory: 80 * 1024 * 1024, 
        MemorySwap: 80 * 1024 * 1024, 
      },
    });

    await container.start();

    await new Promise(resolve => setTimeout(resolve, 1000));

    const containerInfo = await container.inspect();
    const port = containerInfo.NetworkSettings.Ports["6379/tcp"][0].HostPort;

    const client = redis.createClient({
      url: `redis://localhost:${port}`,
      socket: {
        connectTimeout: 10000,
      },
    });

    await client.connect();

    const sessionConfig = await loadSessionConfig();

    sessions.set(sessionId, {
      container,
      client,
      config: sessionConfig,
      currentStep: 0,
    });

    res.json({
      sessionId,
      message: "Session started",
      name: sessionConfig.name,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to start session" });
  }
});

app.post("/execute-command/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const { command, args } = req.body;

  if (!command) {
    return res.status(400).json({ error: "Command is required" });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  try {
    const { client, container } = session;

    const containerInfo = await container.inspect();
    if (!containerInfo.State.Running) {
      await container.start();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (!client.isOpen) {
      await client.connect();
    }
    const result = await executeRedisCommand(container, command, ...args)

    res.json({ result: result });
  } catch (error) {
    console.error(`Error executing command ${command}:`, error);

    return res.status(400).json({ 
      error: error.message,
      command: command,
      args: args
    });
  }
});

app.post("/end-session/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  try {
    await session.client.quit();
    await session.container.stop();
    await session.container.remove();
    sessions.delete(sessionId);
    res.json({ message: "Session ended" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to end session" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
