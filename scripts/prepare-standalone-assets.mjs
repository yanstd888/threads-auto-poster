import { access, cp, mkdir, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const standalone = join(root, '.next', 'standalone');
const staticSource = join(root, '.next', 'static');
const publicSource = join(root, 'public');

for (const path of [standalone, staticSource, publicSource]) await access(path, constants.R_OK);

await rm(join(standalone, '.next', 'static'), { recursive: true, force: true });
await rm(join(standalone, 'public'), { recursive: true, force: true });
await mkdir(join(standalone, '.next'), { recursive: true });
await cp(staticSource, join(standalone, '.next', 'static'), { recursive: true });
await cp(publicSource, join(standalone, 'public'), { recursive: true });
