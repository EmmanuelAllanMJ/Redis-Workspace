const Docker = require('dockerode');
const docker = new Docker(); // Connects to Docker daemon

async function createRedisContainer() {
    const container = await docker.createContainer({
        Image: 'redis:latest',
        ExposedPorts: { '6379/tcp': {} },
        HostConfig: {
            PortBindings: { '6379/tcp': [{ HostPort: '6379' }] }
        }
    });
    await container.start();
    return container;
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

async function main() {
    try {
        const container = await createRedisContainer();
        console.log('Redis container started');

        // Wait a moment for Redis to be ready
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Test SET
        console.log('SET result:', await executeRedisCommand(container, 'SET', 'mykey', 'myvalue'));

        // Test GET
        console.log('GET result:', await executeRedisCommand(container, 'GET', 'mykey'));

        // Test SETEX
        console.log('SETEX result:', await executeRedisCommand(container, 'SETEX', 'mykey2', '60', 'value2'));

        // Test LPUSH
        console.log('LPUSH result:', await executeRedisCommand(container, 'LPUSH', 'mylist', 'value1', 'value2'));

        // Test LRANGE
        console.log('LRANGE result:', await executeRedisCommand(container, 'LRANGE', 'mylist', '0', '-1'));

        // Stop and remove the container when done
        await container.stop();
        await container.remove();
        console.log('Redis container stopped and removed');
    } catch (error) {
        console.error('An error occurred:', error);
    }
}

main();