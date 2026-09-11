import fs from 'node:fs';
import path from 'node:path';

const source = path.join('.js', 'plugins');
const destination = path.join('.js', 'src', 'plugins');

if (!fs.existsSync(source)) {
  console.error(`Missing ${source}; run "pnpm run build:compile" first.`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.rmSync(destination, { recursive: true, force: true });
fs.cpSync(source, destination, { recursive: true });

console.log(`Copied ${source} -> ${destination}`);
