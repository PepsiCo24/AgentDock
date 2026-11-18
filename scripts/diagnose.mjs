import { agentDiagnostics } from '../src/agents.mjs';
const flags = process.argv.slice(2);
if (flags.some(flag => flag !== '--json')) {
  console.error('Usage: node scripts/diagnose.mjs [--json]');
  process.exitCode = 2;
} else {
  const agents = agentDiagnostics();
  if (flags.includes('--json')) {
    console.log(JSON.stringify({ schemaVersion: 1, platform: process.platform, arch: process.arch,
      nodeVersion: process.versions.node, authentication: 'not-checked', compatibility: 'not-verified', agents }, null, 2));
  } else {
    for (const d of agents) {
      const info = d.installed ? (d.version || 'version unavailable') : 'not installed';
      console.log(`${d.id.padEnd(12)} ${info}`);
    }
    console.log('Presence/version only; authentication and end-to-end compatibility are not tested.');
  }
}
