// The Blender license boundary, derived from the code: a Python file is Blender-API-coupled when it (or a sibling it
// imports) reaches the Blender Python API, independent when it provably does not, and review-required when the
// analysis cannot tell. The manifest never decides this; it can only agree with it.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { VIDEO_ROOT } from '../src/config/load.ts';
import { classifyPython, scanPython, stripPython } from '../src/rights/python-boundary.ts';

const classify = (files: Record<string, string>) => {
  const facts = Object.entries(files).map(([p, src]) => scanPython(p, src));
  return classifyPython(facts);
};
const kind = (files: Record<string, string>, p: string): string => classify(files).get(p)!.classification;

describe('stripping strings and comments before looking for imports', () => {
  test('comments, docstrings, and string literals are blanked, newlines kept', () => {
    const src = ['"""import bpy in a docstring"""', '# import bmesh in a comment', 's = "from mathutils import Vector"', "t = 'import gpu'", 'u = """', 'import blf', '"""', 'x = 1'].join('\n');
    const { code, unterminated } = stripPython(src);
    assert.equal(unterminated, false);
    assert.equal(code.split('\n').length, src.split('\n').length);
    assert.doesNotMatch(code, /bpy|bmesh|mathutils|gpu|blf/);
    assert.match(code, /x = 1/);
  });

  test('an escaped quote does not end a string early, and a raw string still ends at its quote', () => {
    const { code } = stripPython('a = "say \\" import bpy \\" now"\nb = r"C:\\x"\nimport os');
    assert.doesNotMatch(code, /bpy/);
    assert.match(code, /import os/);
  });

  test('an unterminated string is reported, never guessed around', () => {
    assert.equal(stripPython('x = "never closed\nimport os').unterminated, true);
    assert.equal(stripPython('x = """never closed\nimport os').unterminated, true);
  });
});

describe('direct use of the Blender Python API', () => {
  test('every import form that reaches Blender is coupled', () => {
    const forms = [
      'import bpy',
      'import bpy as b',
      'import numpy as np, bpy',
      'from bpy import ops',
      'from bpy.types import Operator',
      'import bpy.ops',
      'from mathutils import Vector',
      'import bmesh',
      'import gpu',
      'import blf',
      'import aud',
      'from bpy_extras.io_utils import ExportHelper',
      'import bl_ui',
      'import addon_utils',
      'import idprop',
      'from gpu_extras.batch import batch_for_shader',
      'import freestyle',
      'import imbuf',
      'import bgl',
    ];
    for (const form of forms) assert.equal(kind({ 'x.py': `${form}\n` }, 'x.py'), 'BLENDER_API_COUPLED', form);
  });

  test('an import hidden in a function, a try block, or after a semicolon still counts', () => {
    assert.equal(kind({ 'x.py': 'def f():\n    import gpu\n    return gpu\n' }, 'x.py'), 'BLENDER_API_COUPLED');
    assert.equal(kind({ 'x.py': 'try:\n    import bpy\nexcept ImportError:\n    bpy = None\n' }, 'x.py'), 'BLENDER_API_COUPLED');
    assert.equal(kind({ 'x.py': 'import os; import mathutils\n' }, 'x.py'), 'BLENDER_API_COUPLED');
    assert.equal(kind({ 'x.py': 'if True: import bpy\n' }, 'x.py'), 'BLENDER_API_COUPLED');
  });

  test('a Blender module named only in a comment, docstring, or string is not an import', () => {
    const src = '"""Pure mapping; mentions bpy and mathutils."""\n# import bpy\nNAME = "import bmesh"\nimport json\n';
    assert.equal(kind({ 'x.py': src }, 'x.py'), 'BLENDER_INDEPENDENT');
  });

  test('stdlib and third-party imports are not Blender', () => {
    assert.equal(kind({ 'x.py': 'import json, math\nimport numpy as np\nfrom pathlib import Path\n' }, 'x.py'), 'BLENDER_INDEPENDENT');
  });
});

describe('coupling travels through sibling imports', () => {
  test('a file that only imports a coupled sibling is coupled (a "pure mapping" that imports the rig is not pure)', () => {
    const files = { 'lane/rig.py': 'import bpy\n', 'lane/controls.py': 'from rig import bone_depth\n', 'lane/top.py': 'import controls as C\n' };
    const result = classify(files);
    assert.equal(result.get('lane/rig.py')!.classification, 'BLENDER_API_COUPLED');
    assert.equal(result.get('lane/controls.py')!.classification, 'BLENDER_API_COUPLED');
    assert.equal(result.get('lane/top.py')!.classification, 'BLENDER_API_COUPLED');
    assert.match(result.get('lane/controls.py')!.reasons.join(' '), /rig/);
  });

  test('a helper that coupled files import, but that imports nothing from Blender, stays independent and says who loads it', () => {
    const files = { 'lane/common.py': 'import json\nUNITS = 0.01\n', 'lane/rig.py': 'import bpy\nfrom common import UNITS\n' };
    const result = classify(files);
    assert.equal(result.get('lane/common.py')!.classification, 'BLENDER_INDEPENDENT');
    assert.deepEqual(result.get('lane/common.py')!.loadedBy, ['lane/rig.py']);
    assert.deepEqual(result.get('lane/rig.py')!.loadedBy, []);
  });

  test('coupling does not leak backwards: importing an independent helper never couples a file', () => {
    const files = { 'a/helper.py': 'import math\n', 'a/launcher.py': 'import subprocess, json\nfrom helper import f\n' };
    assert.equal(kind(files, 'a/launcher.py'), 'BLENDER_INDEPENDENT');
  });

  test('a module of another directory is found by name when it is not a sibling (sys.path tricks cannot hide coupling)', () => {
    const files = { 'lane/rig.py': 'import bpy\n', 'elsewhere/tool.py': 'import sys\nsys.path.insert(0, "../lane")\nimport rig\n' };
    assert.equal(kind(files, 'elsewhere/tool.py'), 'BLENDER_API_COUPLED');
  });

  test('a cycle between coupled siblings terminates', () => {
    const files = { 'l/a.py': 'import b\n', 'l/b.py': 'import a\nimport bpy\n' };
    assert.equal(kind(files, 'l/a.py'), 'BLENDER_API_COUPLED');
    assert.equal(kind(files, 'l/b.py'), 'BLENDER_API_COUPLED');
  });
});

describe('pure external launchers', () => {
  test('a script that writes a job file and runs Blender as a subprocess uses no Blender API: independent', () => {
    const src = ['import json, subprocess, sys', 'def run(exe, job):', '    json.dump({"job": job}, open("job.json", "w"))', '    subprocess.run([exe, "--background", "--python", "lane/render.py", "--", "--job", "job.json"], check=True)'].join('\n');
    const result = classify({ 'tools/launch.py': src });
    assert.equal(result.get('tools/launch.py')!.classification, 'BLENDER_INDEPENDENT');
    assert.deepEqual(result.get('tools/launch.py')!.reasons, []);
  });
});

describe('what the analysis cannot decide is review-required, never independent', () => {
  test('the Blender API used with no import (injected builtins) needs review', () => {
    const result = classify({ 'x.py': 'bpy.ops.mesh.primitive_cube_add()\n' });
    assert.equal(result.get('x.py')!.classification, 'REVIEW_REQUIRED');
    assert.match(result.get('x.py')!.reasons.join(' '), /bpy/);
  });

  test('a dynamic import or code execution the analysis cannot read needs review', () => {
    for (const src of ['m = __import__(name)\n', 'import importlib\nm = importlib.import_module(name)\n', 'exec(open("x").read())\n', 'import runpy\nrunpy.run_path("x.py")\n', 'import sys\nm = sys.modules["bpy"]\n', 'import importlib.util\nspec = importlib.util.spec_from_file_location("a", "a.py")\n']) {
      assert.equal(kind({ 'x.py': src }, 'x.py'), 'REVIEW_REQUIRED', src);
    }
  });

  test('a dynamic import of a string literal is an ordinary import of that module: Blender couples, anything else does not', () => {
    assert.equal(kind({ 'x.py': "m = __import__('bpy')\n" }, 'x.py'), 'BLENDER_API_COUPLED');
    assert.equal(kind({ 'x.py': 'import importlib\nm = importlib.import_module("mathutils")\n' }, 'x.py'), 'BLENDER_API_COUPLED');
    assert.equal(kind({ 'x.py': 'import math\nv = __import__("math").log10(2.0)\n' }, 'x.py'), 'BLENDER_INDEPENDENT');
    assert.equal(kind({ 'x.py': 'import importlib.metadata\nv = importlib.metadata.version("x")\n' }, 'x.py'), 'BLENDER_INDEPENDENT', 'importlib.metadata only reads package metadata');
    // A literal import of a coupled sibling couples through the same edge as a plain import.
    assert.equal(kind({ 'l/rig.py': 'import bpy\n', 'l/top.py': 'r = __import__("rig")\n' }, 'l/top.py'), 'BLENDER_API_COUPLED');
  });

  test('a comment or string that merely looks like a dynamic import is ignored', () => {
    assert.equal(kind({ 'x.py': '# m = __import__(name)\nS = "exec(x)"\n' }, 'x.py'), 'BLENDER_INDEPENDENT');
  });

  test('a file the tokenizer cannot close needs review', () => {
    assert.equal(kind({ 'x.py': 'x = "open\nimport os\n' }, 'x.py'), 'REVIEW_REQUIRED');
  });

  test('a certainly coupled file stays coupled even when it also has something odd', () => {
    assert.equal(kind({ 'x.py': 'import bpy\nm = __import__("os")\n' }, 'x.py'), 'BLENDER_API_COUPLED');
  });
});

describe('evasion forms the analysis must not read as independent (found by an independent review)', () => {
  const review = (src: string, label: string): void => assert.equal(kind({ 'l/x.py': src }, 'l/x.py'), 'REVIEW_REQUIRED', label);

  test('a dynamic import reached through any prefix, alias, or reference is review-required', () => {
    review('import builtins\nb = builtins.__import__("bpy")\n', 'builtins.__import__');
    review('import importlib as il\nm = il.import_module("bpy")\n', 'an aliased importlib');
    review('import importlib\nm = importlib.import_module\nm("bpy")\n', 'a reference to import_module');
    review('from importlib import import_module\nm = import_module("bpy")\n', 'import_module imported by name');
    review('run = exec\nrun("import bpy")\n', 'an alias of exec');
    review('f = eval\n', 'an alias of eval');
    review('g = compile\n', 'an alias of compile');
    review('import importlib\nm = getattr(importlib, "import_module")("bpy")\n', 'getattr on importlib');
    review('import builtins\nf = getattr(builtins, "__import__")\nf("bpy")\n', 'getattr on builtins (the only visible token is builtins)');
    review('import sys\nsys.meta_path.append(object())\n', 'a meta path hook');
    review('import zipimport\n', 'zipimport');
    // Each of these shows one token and nothing else the analysis would catch, so it is that token that must fire.
    review('from helper import import_module\nm = import_module(name)\n', 'import_module re-exported by a helper (the only visible token is import_module)');
    review('import builtins\nf = getattr(builtins, "__imp" + "ort__")\nf("bpy")\n', 'builtins reached with a computed attribute name (the only visible token is builtins)');
  });

  test('reaching sys.modules, a module dictionary, or a live namespace by any route is review-required (second review)', () => {
    review('from sys import modules\nm = modules["bpy"]\n', 'from sys import modules');
    review('import sys as s\nm = s.modules["bpy"]\n', 'an aliased sys');
    review('import importlib as il\nm = getattr(il, "import_module")("bpy")\n', 'getattr on an aliased importlib');
    review('import importlib\nm = getattr(importlib, "import_module")("bpy")\n', 'a bare importlib import');
    review('import os\nm = vars(os)["__builtins__"]["__import__"]("bpy")\n', 'vars()');
    review('import os\nm = os.__dict__["__builtins__"]\n', '__dict__');
    review('g = globals()\n', 'globals()');
    review('l = locals()\n', 'locals()');
    review('def f():\n    pass\nx = f.__globals__\n', '__globals__');
    review('x = ().__class__.__bases__[0].__subclasses__()\n', '__subclasses__');
    review('x = __loader__\n', '__loader__');
    review('import os\nf = getattr(os, "__import__")\n', 'a string that names __import__');
    review('import os\nf = getattr(os, "import_module")\n', 'a string that names import_module');
    review('x = {"k": "__builtins__"}\n', 'a string that names __builtins__');
  });

  test('stdlib modules that execute or load code from text, bytes, or a native library are review-required', () => {
    for (const m of ['timeit', 'code', 'codeop', 'cProfile', 'profile', 'pdb', 'trace', 'doctest', 'pickle', 'marshal', 'shelve', 'ctypes', 'cffi', 'imp', 'zipimport', 'runpy', 'pkgutil']) review(`import ${m}\n`, m);
    review('from ctypes import pythonapi\n', 'from ctypes import');
    review('import timeit\ntimeit.timeit("import bpy")\n', 'timeit running source text');
    // The modules a launcher legitimately uses are not on that list.
    assert.equal(kind({ 'l/x.py': 'import json, subprocess, hashlib, argparse, pathlib, shutil, tempfile\n' }, 'l/x.py'), 'BLENDER_INDEPENDENT');
  });

  test('blanks around the dots of a dotted import do not hide it (Python allows them)', () => {
    const files = { 'blender/lib2/core.py': 'import bpy\n', 'tools/a.py': 'from blender . lib2 . core import make\n', 'tools/b.py': 'import blender . lib2 . core\n', 'tools/c.py': 'from blender .lib2 import core\n' };
    const result = classify(files);
    for (const p of ['tools/a.py', 'tools/b.py', 'tools/c.py']) assert.equal(result.get(p)!.classification, 'BLENDER_API_COUPLED', p);
  });

  test('a byte-order mark at the start of a file is not mistaken for code', () => {
    assert.equal(kind({ 'l/x.py': '﻿import json\n' }, 'l/x.py'), 'BLENDER_INDEPENDENT');
    assert.equal(kind({ 'l/x.py': '﻿# SPDX-License-Identifier: MIT\nimport bpy\n' }, 'l/x.py'), 'BLENDER_API_COUPLED');
  });

  test('a hostile f-string does not crash the scan', () => {
    const t0 = performance.now();
    assert.doesNotThrow(() => scanPython('x.py', `print(f"${'{a}'.repeat(300_000)}")\n`));
    assert.ok(performance.now() - t0 < 3000);
  });

  test('an f-string that carries a dynamic import or a Blender name is read as code, not blanked', () => {
    review('print(f"{__import__(\'bpy\').data}")\n', 'an f-string with __import__');
    review('import os\nprint(f"{bpy.data}")\n', 'an f-string naming bpy without importing it');
    review('print(rf"{__import__(\'bpy\')}")\n', 'a raw f-string');
    // A plain string and an f-string with harmless expressions stay independent.
    assert.equal(kind({ 'l/x.py': 'name = "bpy"\nprint(f"{name} and {1 + 1}")\n' }, 'l/x.py'), 'BLENDER_INDEPENDENT');
    assert.equal(kind({ 'l/x.py': 'x = 1\nprint(f"{{literal}} {x!r:>8}")\n' }, 'l/x.py'), 'BLENDER_INDEPENDENT');
  });

  test('code the analysis cannot read faithfully is review-required: non-ASCII outside strings, NUL bytes, a non-UTF-8 source cookie', () => {
    review('import ｂｐｙ\n', 'full-width characters that Python normalizes to bpy');
    review('# coding: utf-7\nimport +AGIAcAB5- as b\n', 'a utf-7 source cookie');
    review('# -*- coding: utf-16 -*-\nimport os\n', 'a utf-16 cookie');
    review('import os\u0000\n', 'a NUL byte');
    // Non-ASCII in a comment or a string is fine, and so is an explicit utf-8 cookie.
    assert.equal(kind({ 'l/x.py': '# coding: utf-8\n# ── box ──\nS = "naïve"\nimport os\n' }, 'l/x.py'), 'BLENDER_INDEPENDENT');
  });

  test('a Blender module used through attribute access without an import is review-required, gpu, blf, and aud included', () => {
    review('x = gpu.state.blend_get()\n', 'gpu');
    review('blf.size(0, 12)\n', 'blf');
    review('aud.Device()\n', 'aud');
    // A variable that merely has one of those names is still reported rather than guessed at.
    review('gpu = 1\nprint(gpu.real)\n', 'a variable named gpu used with an attribute');
  });

  test('importlib.metadata and importlib.resources alone do not make a file undecidable', () => {
    assert.equal(kind({ 'l/x.py': 'import importlib.metadata\nv = importlib.metadata.version("x")\n' }, 'l/x.py'), 'BLENDER_INDEPENDENT');
    assert.equal(kind({ 'l/x.py': 'from importlib import metadata\nv = metadata.version("x")\n' }, 'l/x.py'), 'BLENDER_INDEPENDENT');
    review('import importlib.metadata\nimport importlib.util\n', 'util alongside metadata');
  });
});

describe('Blender 5.2 modules', () => {
  test('every module the installed Blender provides is recognised, including its underscore-prefixed internals', () => {
    const modules = ['bpy', 'bpy.types', '_bpy', '_bpy_types', '_bpy_internal', '_bpy_restrict_state', 'bpy_extras', 'mathutils', 'bmesh', 'gpu', 'gpu_extras', 'blf', 'aud', 'bl_math', 'idprop', 'imbuf', 'manta', 'addon_utils', 'bl_app_override', 'bl_app_template_utils', 'bl_keymap_utils', 'bl_operators', 'bl_ui', '_bl_ui_utils', '_bl_rna_utils', '_bl_text_utils', '_bl_i18n_utils', '_bl_console_utils', '_bl_previews_utils', '_rna_info', '_rna_xml', '_rna_manual_reference', '_console_python', '_console_shell', '_graphviz_export', '_keyingsets_utils', '_animsys_refactor', '_blendfile_header', 'rna_keymap_ui', 'rna_prop_ui', 'nodeitems_utils', 'nodeitems_builtins', 'keyingsets_builtins', 'blend_render_info', 'bl_app_templates_system', 'freestyle', 'cycles', 'bgl', 'bpy_types', 'bpy_restrict_state', 'rna_info', 'io_scene_gltf2'];
    for (const m of modules) assert.equal(kind({ 'l/x.py': `import ${m}\n` }, 'l/x.py'), 'BLENDER_API_COUPLED', m);
    for (const m of ['json', 'numpy', 'build', 'blenderish', 'gpu_like', 'io_utils', 'rna', 'math']) assert.equal(kind({ 'l/x.py': `import ${m}\n` }, 'l/x.py'), 'BLENDER_INDEPENDENT', m);
  });
});

describe('resolving imports between repository files', () => {
  test('relative imports are followed, including parent levels and submodule names', () => {
    const files = { 'pkg/rig.py': 'import bpy\n', 'pkg/sub/top.py': 'from .. import rig\n', 'pkg/same.py': 'from .rig import f\n', 'pkg/also.py': 'from . import rig\n', 'pkg/lone.py': 'from . import nothing\n' };
    const result = classify(files);
    for (const p of ['pkg/sub/top.py', 'pkg/same.py', 'pkg/also.py']) assert.equal(result.get(p)!.classification, 'BLENDER_API_COUPLED', p);
    assert.equal(result.get('pkg/lone.py')!.classification, 'BLENDER_INDEPENDENT', 'a relative import of something that is not a repository file is not Blender');
  });

  test('a from-import of a submodule resolves to that submodule, and a dotted import resolves through package roots', () => {
    const files = { 'tools/lib2/core.py': 'import bpy\n', 'tools/a.py': 'from lib2 import core\n', 'tools/b.py': 'import lib2.core\n', 'blender/lib2/core.py': 'import bpy\n', 'tools/c.py': 'from blender.lib2 import core\n', 'tools/d.py': 'import blender.lib2.core as c\n' };
    const result = classify(files);
    for (const p of ['tools/a.py', 'tools/b.py', 'tools/c.py', 'tools/d.py']) assert.equal(result.get(p)!.classification, 'BLENDER_API_COUPLED', p);
  });

  test('a package __init__ that reaches Blender couples whatever imports the package', () => {
    const files = { 'p/pkg/__init__.py': 'import bpy\n', 'p/pkg/leaf.py': 'x = 1\n', 'p/user.py': 'import pkg.leaf\n' };
    assert.equal(classify(files).get('p/user.py')!.classification, 'BLENDER_API_COUPLED');
  });

  test('a library import that merely shares a name with a file elsewhere in the repository does not couple', () => {
    // tools/launch/pkgtool.py imports the PyPA "build" package; blender/lane/build.py is an unrelated file of the same name.
    const files = { 'blender/lane/build.py': 'import bpy\n', 'tools/launch/pkgtool.py': 'import build\nimport subprocess\n' };
    assert.equal(classify(files).get('tools/launch/pkgtool.py')!.classification, 'BLENDER_INDEPENDENT');
  });

  test('a file that changes sys.path may reach any module of the repository by name', () => {
    const files = { 'blender/lane/build.py': 'import bpy\n', 'tools/launch/pkgtool.py': 'import sys\nsys.path.insert(0, "../../blender/lane")\nimport build\n' };
    assert.equal(classify(files).get('tools/launch/pkgtool.py')!.classification, 'BLENDER_API_COUPLED');
  });
});

describe('hostile input stays linear', () => {
  const timed = (src: string): number => {
    const t0 = performance.now();
    scanPython('x.py', src);
    return performance.now() - t0;
  };

  test('very long whitespace runs around an import keyword do not backtrack', () => {
    assert.ok(timed(`from${' '.repeat(40_000)}x`) < 1500, 'from + spaces');
    assert.ok(timed(`from ${' '.repeat(40_000)} import${' '.repeat(40_000)}`) < 1500, 'from + import + spaces');
    assert.ok(timed(`import${' '.repeat(40_000)}`) < 1500, 'import + spaces');
    assert.ok(timed(`from .${'.'.repeat(40_000)} import x`) < 1500, 'many dots');
    assert.ok(timed(`import a${', a'.repeat(30_000)}`) < 1500, 'a long import list');
    assert.ok(timed(`from x import (${'a, '.repeat(30_000)})`) < 1500, 'a long from-import list');
  });

  test('a large file of many imports is scanned in time proportional to its size', () => {
    assert.ok(timed('import os\n'.repeat(60_000)) < 2500, '60k import lines');
    assert.ok(timed('from a import b\n'.repeat(40_000)) < 2500, '40k from-import lines');
    assert.ok(timed(`x = "${'from '.repeat(100_000)}"\n`) < 1500, 'a string full of keywords');
    assert.ok(timed('import os; '.repeat(60_000)) < 2500, 'one long line of statements');
  });
});

describe('a Python file the check cannot read', () => {
  test('a source that could not be read is review-required, never an empty independent file', () => {
    const facts = scanPython('x.py', '', { unreadable: true });
    assert.equal(classifyPython([facts]).get('x.py')!.classification, 'REVIEW_REQUIRED');
  });
});

describe('the SPDX header', () => {
  test('identifiers and copyright lines come from the leading comment block only', () => {
    const src = ['# SPDX-License-Identifier: GPL-3.0-or-later', '# SPDX-FileCopyrightText: 2026 WalletWall', '', '"""Doc."""', '# SPDX-License-Identifier: MIT', 'import os'].join('\n');
    const header = scanPython('x.py', src).header;
    assert.deepEqual(header.licenses, ['GPL-3.0-or-later']);
    assert.deepEqual(header.copyrights, ['2026 WalletWall']);
  });

  test('a tag inside the docstring is not a header', () => {
    const src = '"""\nSPDX-License-Identifier: GPL-3.0-or-later\n"""\nimport os\n';
    assert.deepEqual(scanPython('x.py', src).header.licenses, []);
  });

  test('a shebang or an encoding line before the header is allowed; two identifiers are both reported', () => {
    const src = '#!/usr/bin/env python3\n# -*- coding: utf-8 -*-\n# SPDX-License-Identifier: MIT\n# SPDX-License-Identifier: GPL-3.0-or-later\nimport os\n';
    assert.deepEqual(scanPython('x.py', src).header.licenses, ['MIT', 'GPL-3.0-or-later']);
  });

  test('CRLF line endings do not hide a header', () => {
    assert.deepEqual(scanPython('x.py', '# SPDX-License-Identifier: MIT\r\nimport os\r\n').header.licenses, ['MIT']);
  });
});

describe('this repository', () => {
  const read = (rel: string): string => readFileSync(path.join(VIDEO_ROOT, ...rel.split('/')), 'utf8');
  const lane = readdirSync(path.join(VIDEO_ROOT, 'blender', 'walletwallaby')).filter((f) => f.endsWith('.py')).sort();
  const result = classifyPython([...lane.map((f) => `blender/walletwallaby/${f}`), 'tools/chatterbox/synthesize.py'].map((p) => scanPython(p, read(p))));

  test('the Blender lane splits exactly as traced: eight files reach the API, two helpers do not', () => {
    const by = (c: string): string[] => [...result].filter(([, v]) => v.classification === c).map(([p]) => path.posix.basename(p)).sort();
    assert.deepEqual(by('BLENDER_API_COUPLED'), ['build.py', 'controls.py', 'materials.py', 'render.py', 'rig.py', 'scene.py', 'terrain.py', 'transition.py']);
    assert.deepEqual(by('BLENDER_INDEPENDENT'), ['common.py', 'geometry.py', 'synthesize.py']);
    assert.deepEqual(by('REVIEW_REQUIRED'), []);
  });

  test('controls.py calls itself a pure mapping but imports mathutils and the rig, and render.py imports gpu inside a function', () => {
    assert.match(result.get('blender/walletwallaby/controls.py')!.reasons.join(' '), /mathutils/);
    assert.match(result.get('blender/walletwallaby/render.py')!.reasons.join(' '), /\bgpu\b/);
  });

  test('the two independent helpers are loaded inside Blender by coupled files', () => {
    assert.ok(result.get('blender/walletwallaby/common.py')!.loadedBy.length >= 6);
    assert.ok(result.get('blender/walletwallaby/geometry.py')!.loadedBy.includes('blender/walletwallaby/build.py'));
    assert.deepEqual(result.get('tools/chatterbox/synthesize.py')!.loadedBy, []);
  });
});
