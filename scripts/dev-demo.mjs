import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '0.0.0.0'], {
  stdio: 'inherit', env: { ...process.env, APP_BASE_URL: process.env.APP_BASE_URL || 'http://localhost:3000', DEMO_MODE: 'true', MOCK_META_ENABLED: 'true' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 1; });
