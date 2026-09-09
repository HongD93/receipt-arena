import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const local = join(homedir(), '.foundry', 'bin', process.platform === 'win32' ? 'forge.exe' : 'forge');
const result = spawnSync(existsSync(local) ? local : 'forge', process.argv.slice(2), { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
