// The pinned Blender toolchain: where the executable is, proof it is the build
// config/blender.json pins, and the one way this repository runs it.
//
// Blender is an external native tool with its own Python, so it is a new
// execution boundary. It is only ever started here, with a fixed argument list
// (factory settings, auto-run scripts disabled, offline), one of this lane's
// own entry scripts (blender/walletwallaby/*.py, never a path from content),
// and one job file that this process wrote inside dist/blender/jobs/. The child
// gets a minimal environment (no tokens, no credentials, no user profile), and
// its outputs are confined to dist/blender/out/. Nothing from a VideoSpec ever
// reaches an argument. Node-only.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { VIDEO_ROOT, readJson } from '../config/load.ts';
import { prettyJson } from '../core/canonical-json.ts';
import { contentAddress, sha256Hex } from '../core/hash.ts';
import { loadVisualConfig, type BlenderVisual } from './visual.ts';

export const BLENDER_CONFIG_REL = 'config/blender.json';
export const BLENDER_LANE_DIR = path.join(VIDEO_ROOT, 'blender', 'walletwallaby');
export const BLENDER_DIST = path.join(VIDEO_ROOT, 'dist', 'blender');
export const BLENDER_JOBS = path.join(BLENDER_DIST, 'jobs');
export const BLENDER_OUT = path.join(BLENDER_DIST, 'out');

/** The lane's entry scripts: the only Python this repository hands to Blender. */
export const BLENDER_ENTRIES = ['build.py', 'render.py'] as const;
export type BlenderEntry = (typeof BLENDER_ENTRIES)[number];

export interface BlenderConfig {
  schema: 'walletwall.blender-config/v1';
  blender: { version: string; buildHash: string; series: string; source: string; artifacts: Record<string, string>; args: string[] };
  render: { engine: string; resolution: [number, number]; fps: number; samples: number; [k: string]: unknown };
  /** config/blender-visual.json, resolved from the brand tokens (src/blender/visual.ts) and merged here so it is part of the config hash. */
  visual: Omit<BlenderVisual, 'flat'>;
  [k: string]: unknown;
}

export class BlenderToolchainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlenderToolchainError';
  }
}

/** The fixed flags every run uses, exactly: changing them is a config change (and a provenance change). */
export const REQUIRED_ARGS = ['--background', '--factory-startup', '--disable-autoexec', '--offline-mode', '--python-exit-code', '1'] as const;

export function loadBlenderConfig(): BlenderConfig {
  // The flat scenes' constants (visual.flat) do not change a Blender frame, so they stay out of the Blender config hash.
  const { flat: _flat, ...blenderVisual } = loadVisualConfig();
  const cfg = { ...readJson<Omit<BlenderConfig, 'visual'>>(path.join(VIDEO_ROOT, BLENDER_CONFIG_REL)), visual: blenderVisual } as BlenderConfig;
  if (cfg.schema !== 'walletwall.blender-config/v1') throw new BlenderToolchainError(`${BLENDER_CONFIG_REL} is not walletwall.blender-config/v1`);
  if (!/^\d+\.\d+\.\d+$/.test(cfg.blender.version) || !/^[0-9a-f]{12}$/.test(cfg.blender.buildHash)) throw new BlenderToolchainError('the config must pin an exact Blender version and build hash');
  if (JSON.stringify(cfg.blender.args) !== JSON.stringify(REQUIRED_ARGS)) throw new BlenderToolchainError(`blender.args must be exactly ${REQUIRED_ARGS.join(' ')}`);
  if (cfg.render.engine !== 'BLENDER_EEVEE') throw new BlenderToolchainError('the render engine is pinned to EEVEE');
  return cfg;
}

/** sha256 of the config's canonical form: what `blenderConfigSha256` records. */
export const blenderConfigSha256 = (cfg: BlenderConfig): string => contentAddress(cfg);

/** The lane's source files (the reviewable definition of the character, rig mapping, and renders), hashed in a fixed order. */
export function blenderSourceSha256(): { sha256: string; files: { file: string; sha256: string }[] } {
  const names = ['README.md', 'common.py', 'geometry.py', 'materials.py', 'rig.py', 'scene.py', 'controls.py', 'terrain.py', 'transition.py', 'build.py', 'render.py'];
  const files = names.map((n) => ({ file: `blender/walletwallaby/${n}`, sha256: sha256Hex(readFileSync(path.join(BLENDER_LANE_DIR, n))) }));
  return { sha256: contentAddress(files), files };
}

/** A minimal environment for the child: enough for Windows/Linux to start a GUI-less GPU process, nothing else. */
function childEnv(): Record<string, string> {
  const keep = process.platform === 'win32' ? ['SystemRoot', 'windir', 'TEMP', 'TMP', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE'] : ['TMPDIR', 'DISPLAY', 'XDG_RUNTIME_DIR', 'WAYLAND_DISPLAY', 'LIBGL_ALWAYS_SOFTWARE'];
  const env: Record<string, string> = {};
  for (const k of keep) if (process.env[k]) env[k] = process.env[k]!;
  env.PATH = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32') : '/usr/bin:/bin';
  return env;
}

/**
 * The Blender executable: `WALLETWALL_BLENDER` (a path) or `blender` on PATH. Refused unless `--version` reports
 * exactly the pinned version and build hash. The path itself never leaves this process (provenance records only
 * the version and hash).
 */
export function findBlender(cfg: BlenderConfig): { exe: string; version: string; buildHash: string } {
  const candidates = [process.env.WALLETWALL_BLENDER, 'blender'].filter((c): c is string => Boolean(c));
  for (const exe of candidates) {
    if (exe !== 'blender' && !existsSync(exe)) continue;
    const r = spawnSync(exe, ['--factory-startup', '--version'], { encoding: 'utf8', env: childEnv(), timeout: 60_000, shell: false });
    if (r.status !== 0 || typeof r.stdout !== 'string') continue;
    const version = /^Blender (\d+\.\d+\.\d+)/m.exec(r.stdout)?.[1];
    const buildHash = /build hash: ([0-9a-f]+)/.exec(r.stdout)?.[1];
    if (version !== cfg.blender.version || buildHash !== cfg.blender.buildHash) {
      throw new BlenderToolchainError(`Blender at ${exe === 'blender' ? 'PATH' : 'WALLETWALL_BLENDER'} is ${version ?? '?'} (${buildHash ?? '?'}); ${BLENDER_CONFIG_REL} pins ${cfg.blender.version} (${cfg.blender.buildHash})`);
    }
    return { exe, version, buildHash };
  }
  throw new BlenderToolchainError(`no Blender found: install the official ${cfg.blender.version} build (${cfg.blender.series}) and set WALLETWALL_BLENDER to its executable`);
}

const JOB_NAME = /^[a-z0-9][a-z0-9.-]{0,80}$/;

/** Write a job file (data only) inside dist/blender/jobs/ and return its path. */
export function writeJob(name: string, job: object): string {
  if (!JOB_NAME.test(name)) throw new BlenderToolchainError(`job name ${JSON.stringify(name)} is not a plain id`);
  mkdirSync(BLENDER_JOBS, { recursive: true });
  const file = path.join(BLENDER_JOBS, `${name}.json`);
  writeFileSync(file, prettyJson(job));
  return file;
}

/** Run one lane entry on one job. Inherits stdout/stderr for progress; throws on any non-zero exit. */
export function runBlender(blender: { exe: string }, cfg: BlenderConfig, entry: BlenderEntry, jobFile: string, opts: { timeoutMs?: number } = {}): { ms: number } {
  if (!BLENDER_ENTRIES.includes(entry)) throw new BlenderToolchainError(`${entry} is not a lane entry`);
  const rel = path.relative(BLENDER_JOBS, jobFile);
  if (rel.startsWith('..') || path.isAbsolute(rel) || !jobFile.endsWith('.json')) throw new BlenderToolchainError('the job file must be inside dist/blender/jobs');
  mkdirSync(BLENDER_OUT, { recursive: true });
  const args = [...cfg.blender.args, '--python', path.join(BLENDER_LANE_DIR, entry), '--', '--job', jobFile];
  const t0 = performance.now();
  const r = spawnSync(blender.exe, args, { stdio: ['ignore', 'inherit', 'inherit'], env: childEnv(), cwd: BLENDER_DIST, timeout: opts.timeoutMs ?? 6 * 3600_000, shell: false });
  const ms = performance.now() - t0;
  if (r.error) throw new BlenderToolchainError(`blender ${entry}: ${r.error.message}`);
  if (r.status !== 0) throw new BlenderToolchainError(`blender ${entry} exited with ${r.status ?? r.signal}`);
  return { ms };
}

/**
 * A file's text in one read, or null when it does not exist (any other error is thrown). Callers never test for a
 * file and then open it: what was checked is exactly what is used.
 */
export function readIfPresent(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** A file Blender wrote, by its path relative to dist/blender/out. */
export const outFile = (rel: string): string => path.join(BLENDER_OUT, ...rel.split('/'));
