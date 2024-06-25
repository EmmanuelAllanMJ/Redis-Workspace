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
      },
    });

    await container.start();

    // Wait a moment for Redis to be ready
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

    // Check if the container is running, if not, start it
    const containerInfo = await container.inspect();
    if (!containerInfo.State.Running) {
      await container.start();
      // Wait a moment for Redis to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Check if the client is connected, if not, reconnect
    if (!client.isOpen) {
      await client.connect();
    }

    // Check if the command exists
    if (typeof client[command.toLowerCase()] !== 'function') {
      return res.status(400).json({ error: `Invalid Redis command: ${command}` });
    }

    // Execute the command with the provided arguments
    const result = await client[command.toLowerCase()](...args);

    res.json({ result });
  } catch (error) {
    console.error(`Error executing command ${command}:`, error);

    // Return the actual Redis error
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
