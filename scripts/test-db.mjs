// Runs the full test suite including the real-PostgreSQL suites (*.int.test.ts).
// Uses TEST_ADMIN_DATABASE_URL, defaulting to the docker-compose database server.
// The suites create and drop their own scratch databases.
import { spawnSync } from 'node:child_process';

const env = {
  ...process.env,
  TEST_ADMIN_DATABASE_URL:
    process.env.TEST_ADMIN_DATABASE_URL ?? 'postgresql://wallet:wallet@localhost:5432/postgres',
};
const result = spawnSync('npm', ['test'], { stdio: 'inherit', env, shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
