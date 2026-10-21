import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const command = process.argv[2];
const label = 'com.jobpilot.local';
const project = path.resolve(import.meta.dirname, '..');
const agentDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
const plist = path.join(agentDir, `${label}.plist`);
const target = `gui/${process.getuid()}/${label}`;

function xml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

if (process.platform !== 'darwin') throw new Error('This background service uses macOS launchd.');
if (!['install', 'uninstall'].includes(command)) throw new Error('Use install or uninstall.');

if (command === 'install') {
  await access(path.join(project, '.next', 'BUILD_ID')).catch(() => { throw new Error('Run npm run build first.'); });
  const node = process.execPath;
  const next = path.join(project, 'node_modules', 'next', 'dist', 'bin', 'next');
  await access(next);
  await mkdir(agentDir, { recursive: true });
  await mkdir(path.join(project, 'data'), { recursive: true });
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>
    <string>${xml(node)}</string><string>${xml(next)}</string>
    <string>start</string><string>-H</string><string>127.0.0.1</string>
    <string>-p</string><string>3000</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(project)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(path.join(project, 'data', 'background.out.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(project, 'data', 'background.err.log'))}</string>
</dict></plist>
`;
  try { execFileSync('launchctl', ['bootout', target], { stdio: 'ignore' }); } catch { /* not loaded */ }
  await writeFile(plist, content, { mode: 0o600 });
  execFileSync('launchctl', ['bootstrap', `gui/${process.getuid()}`, plist], { stdio: 'inherit' });
  console.log(`JobPilot will run at login. Agent: ${plist}`);
} else {
  try { execFileSync('launchctl', ['bootout', target], { stdio: 'ignore' }); } catch { /* not loaded */ }
  await rm(plist, { force: true });
  console.log('JobPilot background service removed.');
}
