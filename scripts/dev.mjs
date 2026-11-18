// Lance l'API et l'interface ensemble (`npm run dev`), sans dépendance supplémentaire.
import { spawn } from 'node:child_process';

const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --no-warnings=ExperimentalWarning`.trim() };
const procs = [
  ['api', ['run', 'dev:server']],
  ['web', ['run', 'dev:web']],
].map(([name, args]) => {
  const p = spawn('npm', args, { env, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const tag = name === 'api' ? '\x1b[38;5;208m[api]\x1b[0m' : '\x1b[38;5;111m[web]\x1b[0m';
  const out = (chunk) => chunk.toString().split('\n').filter(Boolean).forEach((l) => console.log(`${tag} ${l}`));
  p.stdout.on('data', out);
  p.stderr.on('data', out);
  p.on('exit', (code) => {
    console.log(`${tag} arrêté (code ${code})`);
    procs.forEach((q) => q.kill());
    process.exit(code ?? 0);
  });
  return p;
});
const stop = () => procs.forEach((p) => p.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
