// The Blender license boundary, derived from the code itself (docs/LICENSING.md). Blender's FAQ ties the GNU GPL to
// "Python scripts ... if they use Blender Python API calls", and leaves software that operates outside Blender, uses no
// Blender source or API calls, produces data for Blender, and executes Blender free to choose its own license. So a
// Python file is classified here, from its imports and not from its name or its own description:
//
//   BLENDER_API_COUPLED   it, or a repository file it imports, reaches the Blender Python API
//   BLENDER_INDEPENDENT   it provably does not (it may still be loaded by coupled files, and says so)
//   REVIEW_REQUIRED       the analysis cannot decide: a dynamic import it cannot read, the API named without an import,
//                         source it cannot read faithfully. Never read as independent.
//
// A tokenizer-level analysis, not a Python parser, and it fails closed. Strings and comments are blanked first (so a
// docstring that mentions `bpy` is not an import), f-string expressions are read as code, and imports are parsed by
// hand in one linear pass (no backtracking, so hostile input cannot stall the check). Anything the analysis cannot read
// faithfully (dynamic imports other than a string literal, non-ASCII outside strings and comments, a non-UTF-8 source
// cookie, an unterminated string) is REVIEW_REQUIRED rather than a guess. No I/O, no environment, no network.

const BLENDER_EXACT: readonly string[] = [
  // Built into Blender's interpreter, and the modules and add-ons it ships (Blender 5.2: scripts/modules, scripts/startup).
  '_bpy', 'addon_utils', 'aud', 'bgl', 'bl_math', 'blend_render_info', 'blf', 'bmesh', 'bpy', 'bpy_extras', 'bpy_restrict_state', 'bpy_types', 'cycles', 'freestyle', 'gpu', 'gpu_extras',
  'idprop', 'imbuf', 'keyingsets_builtins', 'manta', 'mathutils', 'nodeitems_builtins', 'nodeitems_utils', 'rna_info', 'rna_keymap_ui', 'rna_prop_ui', 'rna_xml',
];
export const BLENDER_MODULE_ROOTS: ReadonlySet<string> = new Set(BLENDER_EXACT);
/** Blender 5.2 names its internals with a leading underscore (`_bpy_types`, `_bl_ui_utils`, `_rna_info`), and its UI, operators, and I/O add-ons by prefix. */
const BLENDER_PREFIXES: readonly string[] = ['bl_', '_bl_', 'bpy', '_bpy', 'rna_', '_rna_', '_console_', '_graphviz_', '_keyingsets_', '_animsys_', '_blendfile_', 'io_scene_', 'io_anim_', 'io_curve_', 'io_mesh_', 'io_shape_'];

/** Whether a (possibly dotted) module is part of Blender's Python API. */
export function isBlenderModule(module: string): boolean {
  const root = module.split('.')[0] ?? '';
  return BLENDER_MODULE_ROOTS.has(root) || BLENDER_PREFIXES.some((p) => root.startsWith(p));
}

export type PythonClassificationKind = 'BLENDER_API_COUPLED' | 'BLENDER_INDEPENDENT' | 'REVIEW_REQUIRED';

export interface PythonImport {
  /** The dotted module, without leading dots (empty for `from . import x`). */
  module: string;
  /** Names imported with `from module import a, b` (empty for a plain `import`). */
  names: string[];
  /** Leading dots of a relative import (0 for an absolute one). */
  level: number;
  line: number;
}

export interface PythonFacts {
  path: string;
  imports: PythonImport[];
  /** Blender API modules this file imports itself, as written. */
  blenderImports: { module: string; line: number }[];
  /** Why the analysis cannot decide this file (empty when it can). */
  reviewReasons: string[];
  /** Whether the file changes sys.path, so it may reach a module of another directory by name. */
  usesSysPath: boolean;
  header: { licenses: string[]; copyrights: string[] };
}

export interface PythonClassification {
  classification: PythonClassificationKind;
  /** Coupled: where the API is reached. Review required: what cannot be decided. Independent: empty. */
  reasons: string[];
  /** Coupled files that import this one (the files that load it inside Blender), sorted. */
  loadedBy: string[];
  header: PythonFacts['header'];
}

/** Whether a repository path is Python source for the boundary check (the extension is matched case-insensitively). */
export const isPythonPath = (p: string): boolean => /\.pyw?$/i.test(p);

/** Whether a file with no Python extension is a Python script by its first line. */
export const hasPythonShebang = (text: string): boolean => /^#!.*\bpython/.test(text.slice(0, 200).split('\n', 1)[0] ?? '');

function fStringExpressions(body: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < body.length) {
    if (body[i] === '{') {
      if (body[i + 1] === '{') {
        i += 2;
        continue;
      }
      let depth = 1;
      const start = ++i;
      while (i < body.length && depth > 0) {
        if (body[i] === '{') depth++;
        else if (body[i] === '}') depth--;
        i++;
      }
      out.push(body.slice(start, depth === 0 ? i - 1 : i));
    } else {
      i++;
    }
  }
  return out;
}

/** Whether the quote at `at` opens an f-string: its prefix (up to two letters, not part of a longer name) contains f. */
function opensFString(source: string, at: number): boolean {
  let j = at - 1;
  let prefix = '';
  while (j >= 0 && prefix.length < 3 && /[A-Za-z]/.test(source[j]!)) prefix = source[j--]! + prefix;
  if (prefix.length === 0 || prefix.length > 2 || (j >= 0 && /[A-Za-z0-9_]/.test(source[j]!))) return false;
  return /^(?:[rR][fF]|[fF][rR]|[fF])$/.test(prefix);
}

/**
 * Source with comments and string literals blanked (newlines kept, so offsets and line numbers stay valid). The
 * expressions inside f-strings are returned separately: they are code, and a dynamic import hidden in one must be seen.
 */
export function stripPython(source: string): { code: string; unterminated: boolean; fexprs: string; namesDynamicFacility: boolean } {
  const out: string[] = [];
  const fexprs: string[] = [];
  let namesDynamicFacility = false;
  const blank = (s: string): string => s.replace(/[^\r\n]/g, ' ');
  let unterminated = false;
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    if (c === '#') {
      let j = i;
      while (j < source.length && source[j] !== '\n' && source[j] !== '\r') j++;
      out.push(blank(source.slice(i, j)));
      i = j;
    } else if (c === '"' || c === "'") {
      const quote = source.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
      let j = i + quote.length;
      let closed = false;
      while (j < source.length) {
        if (source[j] === '\\') {
          j += 2;
        } else if (source.startsWith(quote, j)) {
          closed = true;
          break;
        } else if (quote.length === 1 && (source[j] === '\n' || source[j] === '\r')) {
          break;
        } else {
          j++;
        }
      }
      if (!closed) unterminated = true;
      const bodyEnd = Math.min(j, source.length);
      const body = source.slice(i + quote.length, bodyEnd);
      // A string that names a facility for loading code (getattr(x, "__import__")) is a lookup the blanking would hide.
      if (DYNAMIC_STRING_NAMES.test(body)) namesDynamicFacility = true;
      if (opensFString(source, i)) for (const expression of fStringExpressions(body)) fexprs.push(expression);
      const end = closed ? Math.min(j + quote.length, source.length) : bodyEnd;
      out.push(blank(source.slice(i, end)));
      i = end;
    } else {
      out.push(c);
      i++;
    }
  }
  return { code: out.join(''), unterminated, fexprs: fexprs.join('\n'), namesDynamicFacility };
}

const DYNAMIC_STRING_NAMES = /\b(?:__import__|import_module|__builtins__|__loader__)\b/;

const isIdStart = (c: string | undefined): boolean => c !== undefined && /[A-Za-z_]/.test(c);
const isIdChar = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_]/.test(c);

function skipBlank(s: string, i: number, newlines: boolean): number {
  while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\f' || (newlines && (s[i] === '\n' || s[i] === '\r')))) i++;
  return i;
}
function readName(s: string, i: number): [string, number] {
  const start = i;
  if (!isIdStart(s[i])) return ['', i];
  while (isIdChar(s[i])) i++;
  return [s.slice(start, i), i];
}
/** A dotted name; Python allows blanks around the dots (`import a . b`), so they are skipped. */
function readDotted(s: string, i: number): [string, number] {
  const [first, afterFirst] = readName(s, i);
  if (first === '') return ['', i];
  let name = first;
  i = afterFirst;
  for (;;) {
    const dot = skipBlank(s, i, false);
    if (s[dot] !== '.') break;
    const next = skipBlank(s, dot + 1, false);
    if (!isIdStart(s[next])) break;
    const [part, after] = readName(s, next);
    name += `.${part}`;
    i = after;
  }
  return [name, i];
}
const wordAt = (s: string, i: number, word: string): boolean => s.startsWith(word, i) && !isIdChar(s[i + word.length]);

/** `import a.b, c as d` -> the dotted modules, and where the statement ends. */
function readImportList(s: string, from: number): { modules: string[]; end: number } {
  const modules: string[] = [];
  let i = skipBlank(s, from, false);
  for (;;) {
    const [name, next] = readDotted(s, i);
    if (name === '') break;
    modules.push(name);
    i = skipBlank(s, next, false);
    if (wordAt(s, i, 'as')) {
      i = skipBlank(s, i + 2, false);
      i = readName(s, i)[1];
      i = skipBlank(s, i, false);
    }
    if (s[i] !== ',') break;
    i = skipBlank(s, i + 1, false);
  }
  return { modules, end: i };
}

/** `from <dots><module> import (a as b, c)` -> the imported names, and where the statement ends. */
function readFromNames(s: string, from: number): { names: string[]; end: number } {
  const names: string[] = [];
  let i = skipBlank(s, from, false);
  const parens = s[i] === '(';
  if (parens) i++;
  for (;;) {
    i = skipBlank(s, i, parens);
    if (s[i] === '*') {
      names.push('*');
      i++;
    } else {
      const [name, next] = readName(s, i);
      if (name === '') break;
      names.push(name);
      i = skipBlank(s, next, parens);
      if (wordAt(s, i, 'as')) {
        i = skipBlank(s, i + 2, parens);
        i = readName(s, i)[1];
        i = skipBlank(s, i, parens);
      }
    }
    i = skipBlank(s, i, parens);
    if (s[i] === ',') i++;
    else break;
  }
  if (parens) {
    i = skipBlank(s, i, true);
    if (s[i] === ')') i++;
  }
  return { names, end: i };
}

const KEYWORD = /\b(?:from|import)\b/g;

function scanImports(code: string, lineAt: (index: number) => number): { imports: PythonImport[]; spans: [number, number][] } {
  const imports: PythonImport[] = [];
  const spans: [number, number][] = [];
  let skipUntil = 0;
  KEYWORD.lastIndex = 0;
  for (let m = KEYWORD.exec(code); m !== null; m = KEYWORD.exec(code)) {
    if (m.index < skipUntil) continue;
    const start = m.index;
    let before = start - 1;
    while (before >= 0 && (code[before] === ' ' || code[before] === '\t')) before--;
    if (before >= 0 && code[before] === '.') continue;
    const after = start + m[0].length;
    if (m[0] === 'import') {
      const { modules, end } = readImportList(code, after);
      for (const module of modules) imports.push({ module, names: [], level: 0, line: lineAt(start) });
      spans.push([start, end]);
      skipUntil = end;
    } else {
      let i = skipBlank(code, after, false);
      let level = 0;
      while (code[i] === '.') {
        level++;
        i = skipBlank(code, i + 1, false);
      }
      // `from . import x` has no module name: the word after the dots is already the `import` keyword.
      const [module, afterModule] = wordAt(code, i, 'import') ? ['', i] : readDotted(code, i);
      i = skipBlank(code, afterModule, false);
      if (!wordAt(code, i, 'import')) continue; // `yield from x`, `raise A from B`
      const { names, end } = readFromNames(code, i + 'import'.length);
      imports.push({ module, names, level, line: lineAt(start) });
      spans.push([start, end]);
      skipUntil = end;
    }
  }
  return { imports, spans };
}

const BLENDER_STRONG_NAMES = /\b(bpy|bmesh|mathutils|bpy_extras|bpy_types|bl_math|idprop|freestyle)\b/g;
/** gpu, blf, and aud are ordinary words, so only attribute access on them counts as use of the module. */
const BLENDER_WEAK_NAMES = /\b(gpu|blf|aud)\b[ \t]*\./g;
// Dynamic imports and code execution the analysis cannot read. A string-literal `__import__("x")` or
// `importlib.import_module("x")` is read as an ordinary import of x; any other appearance of these names, with any prefix,
// alias, or reference, is undecidable.
const DYNAMIC_TOKENS = [
  /\b__import__\b/, /\bimport_module\b/, /\bbuiltins\b/, /\b__builtins__\b/, /\b__loader__\b/, /\brunpy\b/, /\bpkgutil\b/, /\bzipimport\b/, /\bmeta_path\b/, /\bsys[ \t]*\.[ \t]*modules\b/,
  /(?<![.\w])(?:exec|eval|compile)\b/,
  // Live namespaces and module dictionaries: the routes to a name that never appears as text.
  /(?<![.\w])(?:vars|globals|locals)\b/, /\b(?:__dict__|__globals__|__subclasses__)\b/,
];
const DYNAMIC_IMPORT_CALL = /(?<![.\w])(?:__import__|importlib\.import_module)[ \t]*\(/g;
const LITERAL_ARGUMENT = /^[ \t]*(['"])([A-Za-z_][\w.]*)\1[ \t]*[,)]/;
// Modules that execute or load code from text, bytes, a profile, a pickle, or a native library.
const DYNAMIC_MODULES: ReadonlySet<string> = new Set(['zipimport', 'runpy', 'pkgutil', 'imp', 'timeit', 'code', 'codeop', 'cProfile', 'profile', 'pdb', 'trace', 'doctest', 'pickle', 'marshal', 'shelve', 'ctypes', 'cffi']);
const IMPORTLIB_SAFE = /\bimportlib[ \t]*\.[ \t]*(?:metadata|resources)\b/g;

function leadingHeader(source: string): PythonFacts['header'] {
  const licenses: string[] = [];
  const copyrights: string[] = [];
  for (const raw of source.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    if (!line.startsWith('#')) break;
    const license = /^#\s*SPDX-License-Identifier:\s*(.+?)\s*$/.exec(line);
    if (license) licenses.push(license[1]!);
    const copyright = /^#\s*SPDX-FileCopyrightText:\s*(.+?)\s*$/.exec(line);
    if (copyright) copyrights.push(copyright[1]!);
  }
  return { licenses, copyrights };
}

/** What one Python file imports, and what makes it undecidable. `unreadable`: the caller could not read the file. */
export function scanPython(path: string, source: string, options: { unreadable?: boolean } = {}): PythonFacts {
  const reviewReasons: string[] = [];
  if (options.unreadable) reviewReasons.push('could not be read (it is missing, not a regular file, or larger than the bound), so nothing can be said about it');
  source = source.replace(/^﻿/, '');
  const { code, unterminated, fexprs, namesDynamicFacility } = stripPython(source);

  const newlines: number[] = [];
  for (let k = 0; k < code.length; k++) if (code[k] === '\n') newlines.push(k);
  const lineAt = (index: number): number => {
    let lo = 0;
    let hi = newlines.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (newlines[mid]! < index) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };

  // A backslash continuation would otherwise end an import list early; two spaces keep every offset valid.
  const joined = code.replace(/\\\r?\n/g, (m) => ' '.repeat(m.length));
  const { imports, spans } = scanImports(joined, lineAt);

  // Everything that remains once the import statements and the resolvable literal imports are taken out is what the
  // name and token checks look at.
  const scan = joined.split('');
  for (const [a, b] of spans) for (let k = a; k < b && k < scan.length; k++) if (scan[k] !== '\n' && scan[k] !== '\r') scan[k] = ' ';
  let literalFailed = false;
  for (const m of joined.matchAll(DYNAMIC_IMPORT_CALL)) {
    const literal = LITERAL_ARGUMENT.exec(source.slice(m.index! + m[0].length));
    if (literal) imports.push({ module: literal[2]!, names: [], level: 0, line: lineAt(m.index!) });
    else literalFailed = true;
    for (let k = m.index!; k < m.index! + m[0].length; k++) scan[k] = ' ';
  }
  let remaining = scan.join('');
  const tokenText = `${remaining}\n${fexprs}`;

  const blenderImports = imports.filter((i) => i.level === 0 && isBlenderModule(i.module)).map((i) => ({ module: i.module, line: i.line }));
  const importedRoots = new Set(imports.filter((i) => i.level === 0).map((i) => i.module.split('.')[0]!));
  const named = new Set<string>();
  for (const m of `${joined}\n${fexprs}`.matchAll(BLENDER_STRONG_NAMES)) named.add(m[1]!);
  for (const m of `${joined}\n${fexprs}`.matchAll(BLENDER_WEAK_NAMES)) named.add(m[1]!);
  for (const name of [...named].sort()) if (!importedRoots.has(name)) reviewReasons.push(`uses the Blender name ${name} without importing it`);

  remaining = tokenText.replace(IMPORTLIB_SAFE, ' ');
  // `sys` reached by any route (`from sys import modules`, `import sys as s`) makes the bare word `modules` a lookup of loaded modules.
  const importsSys = imports.some((i) => i.module.split('.')[0] === 'sys');
  if (literalFailed || namesDynamicFacility || (importsSys && /\bmodules\b/.test(remaining)) || DYNAMIC_TOKENS.some((re) => re.test(remaining)) || /\bimportlib\b/.test(remaining)) {
    reviewReasons.push('imports or executes code dynamically in a way the analysis cannot read (a computed __import__ or import_module, an alias of exec/eval/compile, importlib, builtins, runpy, sys.modules)');
  }
  for (const i of imports) {
    const root = i.module.split('.')[0]!;
    const importlibOk = root === 'importlib' && ((i.module === 'importlib' && i.names.length > 0 && i.names.every((n) => n === 'metadata' || n === 'resources')) || /^importlib\.(?:metadata|resources)(?:\.|$)/.test(i.module));
    if (DYNAMIC_MODULES.has(root) || (root === 'importlib' && !importlibOk)) {
      reviewReasons.push(`imports ${i.module}${i.names.length ? ` (${i.names.slice(0, 3).join(', ')})` : ''}, which loads code the analysis cannot follow`);
      break;
    }
  }
  if (unterminated) reviewReasons.push('has a string literal the tokenizer cannot close');
  if (source.includes('\u0000')) reviewReasons.push('contains a NUL byte');
  if (/[^\x00-\x7F]/.test(code)) reviewReasons.push('has non-ASCII characters outside strings and comments, which Python normalizes before it reads names');
  const cookie = /^[ \t\f]*#.*?coding[:=][ \t]*([-\w.]+)/m.exec(source.split(/\r?\n/, 2).join('\n'));
  if (cookie && !/^(?:utf-?8|ascii|us-ascii)$/i.test(cookie[1]!)) reviewReasons.push(`declares the source encoding ${cookie[1]}, so the text the analysis read is not the text Python reads`);

  return { path, imports, blenderImports, reviewReasons, usesSysPath: /\bsys[ \t]*\.[ \t]*path\b|\bPYTHONPATH\b/.test(code), header: leadingHeader(source) };
}

const posixDir = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const join = (...parts: string[]): string => parts.filter(Boolean).join('/');
const stemOf = (p: string): string => {
  const file = p.slice(p.lastIndexOf('/') + 1);
  if (file === '__init__.py') return posixDir(p).slice(posixDir(p).lastIndexOf('/') + 1);
  return file.replace(/\.pyw?$/i, '');
};

/** The repository files an import may name: relative to the file, from each ancestor as a package root, and (only if the file edits sys.path) by bare name anywhere. */
function resolveImport(from: string, imp: PythonImport, all: ReadonlySet<string>, byStem: ReadonlyMap<string, string[]>, usesSysPath: boolean): string[] {
  const parts = imp.module === '' ? [] : imp.module.split('.');
  const found = new Set<string>();
  const add = (p: string): void => void (all.has(p) && found.add(p));
  const forBase = (base: string): void => {
    for (let k = 1; k <= parts.length; k++) {
      const prefix = join(base, ...parts.slice(0, k));
      add(`${prefix}/__init__.py`);
      if (k === parts.length) add(`${prefix}.py`);
    }
    const module = join(base, ...parts);
    if (parts.length === 0) add(join(base, '__init__.py'));
    for (const name of imp.names) {
      add(`${join(module)}/${name}.py`);
      add(`${join(module)}/${name}/__init__.py`);
    }
  };
  if (imp.level > 0) {
    let base = posixDir(from);
    for (let k = 1; k < Math.min(imp.level, 64); k++) base = posixDir(base);
    forBase(base);
  } else {
    for (let base = posixDir(from); ; base = posixDir(base)) {
      forBase(base);
      if (base === '') break;
    }
    if (found.size === 0 && usesSysPath && parts.length > 0) for (const p of byStem.get(parts[0]!) ?? []) found.add(p);
  }
  found.delete(from);
  return [...found].sort();
}

/** Classify a set of Python files together, so coupling can travel through the imports between them. */
export function classifyPython(files: readonly PythonFacts[]): Map<string, PythonClassification> {
  const all = new Set(files.map((f) => f.path));
  const byStem = new Map<string, string[]>();
  for (const f of files) byStem.set(stemOf(f.path), [...(byStem.get(stemOf(f.path)) ?? []), f.path]);

  const edges = new Map<string, string[]>();
  for (const f of files) {
    const targets = new Set<string>();
    for (const imp of f.imports) if (imp.level > 0 || !isBlenderModule(imp.module)) for (const t of resolveImport(f.path, imp, all, byStem, f.usesSysPath)) targets.add(t);
    edges.set(f.path, [...targets].sort());
  }

  const coupled = new Set(files.filter((f) => f.blenderImports.length > 0).map((f) => f.path));
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of files) {
      if (coupled.has(f.path)) continue;
      if ((edges.get(f.path) ?? []).some((t) => coupled.has(t))) {
        coupled.add(f.path);
        changed = true;
      }
    }
  }

  const result = new Map<string, PythonClassification>();
  for (const f of files) {
    const loadedBy = files.filter((o) => o.path !== f.path && coupled.has(o.path) && (edges.get(o.path) ?? []).includes(f.path)).map((o) => o.path).sort();
    if (coupled.has(f.path)) {
      const reasons = [
        ...f.blenderImports.map((b) => `imports ${b.module} (line ${b.line})`),
        ...(edges.get(f.path) ?? []).filter((t) => coupled.has(t)).map((t) => `imports ${t.slice(t.lastIndexOf('/') + 1)}, which reaches the Blender API`),
      ];
      result.set(f.path, { classification: 'BLENDER_API_COUPLED', reasons, loadedBy, header: f.header });
    } else if (f.reviewReasons.length > 0) {
      result.set(f.path, { classification: 'REVIEW_REQUIRED', reasons: [...f.reviewReasons], loadedBy, header: f.header });
    } else {
      result.set(f.path, { classification: 'BLENDER_INDEPENDENT', reasons: [], loadedBy, header: f.header });
    }
  }
  return result;
}

const EMBEDDED_BLENDER_PYTHON = /(?:^|[\s"'`;(])(?:import|from)\s+(?:bpy|bmesh|mathutils|bpy_extras|gpu|blf)\b|\bbpy\s*\.\s*(?:ops|data|context|types|app)\b|--python-expr\b/m;

/** Blender API use inside a file that is not Python (a string a script hands to Blender), or null. */
export function embeddedBlenderPython(text: string): string | null {
  const m = EMBEDDED_BLENDER_PYTHON.exec(text);
  return m ? m[0].trim() : null;
}
