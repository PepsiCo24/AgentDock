import { agentDiagnostics } from '../src/agents.mjs';

for (const d of agentDiagnostics()) {
  const info = d.installed ? (d.version || 'version unavailable') : 'not installed';
  console.log(`${d.id.padEnd(12)} ${info}`);
}
console.log('Presence/version only; authentication and end-to-end compatibility are not tested.');
