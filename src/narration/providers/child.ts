// How a local adapter runs its tool: one executable, an argument list (never a
// shell), a minimal environment (no tokens, no user profile beyond what the
// tool needs to find its own cache), a timeout, capped output capture, and an
// optional VRAM sample from nvidia-smi while it runs. The executable path is
// resolved here and never recorded anywhere. Node-only.

import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ChildResult, ChildRunner } from '../contract.ts';

const OUTPUT_CAP = 64 * 1024;

/** Enough environment for a GPU tool to start and find its own cache; nothing else. */
export function minimalEnv(extra: Record<string, string> = {}): Record<string, string> {
  const keep =
    process.platform === 'win32'
      ? ['SystemRoot', 'windir', 'TEMP', 'TMP', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'APPDATA']
      : ['HOME', 'TMPDIR', 'LANG', 'XDG_CACHE_HOME'];
  const env: Record<string, string> = {};
  for (const k of keep) if (process.env[k]) env[k] = process.env[k]!;
  env.PATH = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32') : '/usr/bin:/bin';
  return { ...env, ...extra };
}

/** Resolve a tool: an explicit path from the environment, else a plain name searched on this process's PATH. */
export function resolveExecutable(explicit: string | undefined, name: string): string | null {
  if (explicit) return existsSync(explicit) ? explicit : null;
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function nvidiaSmi(): string | null {
  if (process.platform === 'win32') {
    const p = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'nvidia-smi.exe');
    return existsSync(p) ? p : null;
  }
  return resolveExecutable(undefined, 'nvidia-smi');
}

function usedMiB(smi: string): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(smi, ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      const n = Number.parseInt(String(stdout).trim().split(/\r?\n/)[0] ?? '', 10);
      resolve(Number.isFinite(n) ? n : null);
    });
  });
}

export const runChild: ChildRunner = async (exe, args, opts) => {
  const smi = opts.sampleVram ? nvidiaSmi() : null;
  const baseline = smi ? await usedMiB(smi) : null;
  let peak = baseline;
  return new Promise<ChildResult>((resolve, reject) => {
    const t0 = performance.now();
    const child = spawn(exe, [...args], { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length < OUTPUT_CAP) stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < OUTPUT_CAP) stderr += d.toString('utf8');
    });
    const timer = setTimeout(() => child.kill(), opts.timeoutMs);
    let sampling = false;
    const sampler = smi
      ? setInterval(() => {
          if (sampling) return;
          sampling = true;
          void usedMiB(smi).then((v) => {
            if (v !== null && (peak === null || v > peak)) peak = v;
            sampling = false;
          });
        }, 250)
      : null;
    child.on('error', (err) => {
      clearTimeout(timer);
      if (sampler) clearInterval(sampler);
      reject(err);
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      if (sampler) clearInterval(sampler);
      resolve({ status, stdout, stderr, wallMs: performance.now() - t0, vramPeakMiB: peak !== null && baseline !== null ? Math.max(0, peak - baseline) : null });
    });
  });
};

/** `exe --version` style probe through the same runner (no VRAM sampling). */
export async function probeVersion(run: ChildRunner, exe: string, args: readonly string[], cwd: string, env: Record<string, string>): Promise<string | null> {
  try {
    const r = await run(exe, args, { cwd, env, timeoutMs: 60_000, sampleVram: false });
    return r.status === 0 ? r.stdout.trim() : null;
  } catch {
    return null;
  }
}
