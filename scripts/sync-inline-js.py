#!/usr/bin/env python3
"""Regenerate src/export/inline-js.ts from assets/export/inline.js.

The HTML export pipeline embeds the script as a string constant in
src/export/inline-js.ts (ADR-28 — mirrors the inline-css pattern exactly).
The asset file is the source of truth for human edits; this script keeps
the constant byte-identical to it.

The byte-identity contract is enforced by tests/unit/inline-js-sync.test.ts.

Usage:
    python3 scripts/sync-inline-js.py

After running, commit BOTH files (or commit nothing — the test will catch
drift on CI either way).
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JS = ROOT / "assets" / "export" / "inline.js"
OUT = ROOT / "src" / "export" / "inline-js.ts"


def main() -> int:
    content = JS.read_text(encoding="utf-8")

    # Escape characters that would otherwise be interpreted inside a JS
    # template literal: backslash first (so we don't double-escape), then
    # backtick, then ${ for interpolation.
    content = (
        content.replace("\\", "\\\\")
        .replace("`", "\\`")
        .replace("${", "\\${")
    )

    prelude = (
        '/**\n'
        ' * Inline JS constant for HTML export.\n'
        ' *\n'
        ' * ADR-28: the JS is embedded as a string constant here rather than\n'
        ' * loaded from assets/export/inline.js at runtime. This avoids\n'
        ' * bundle-time asset resolution complexity (CJS __dirname vs ESM\n'
        ' * import.meta.url vs tsup output layout).\n'
        ' *\n'
        ' * Synchronization contract: tests/unit/inline-js-sync.test.ts asserts\n'
        ' * that this constant is byte-identical to assets/export/inline.js. Any\n'
        ' * change to the JS must be applied to BOTH files. Regenerate with:\n'
        ' *   python3 scripts/sync-inline-js.py\n'
        ' *\n'
        ' * No external network calls, no eval, no dynamic import.\n'
        ' */\n'
        '\n'
        'export const INLINE_JS = `'
    )
    epilog = "`;\n"

    OUT.write_text(prelude + content + epilog, encoding="utf-8")
    print(f"Synced {OUT.relative_to(ROOT)} from {JS.relative_to(ROOT)} "
          f"({len(content)} chars).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
