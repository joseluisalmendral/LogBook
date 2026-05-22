#!/usr/bin/env python3
"""Regenerate src/export/inline-css.ts from assets/export/styles.css.

The HTML export pipeline embeds the stylesheet as a string constant in
src/export/inline-css.ts (Decision T12.D1 — avoids bundle-time asset
resolution complexity). The asset file is the source of truth for human
edits; this script keeps the constant byte-identical to it.

The byte-identity contract is enforced by tests/unit/inline-css-sync.test.ts.

Usage:
    python3 scripts/sync-inline-css.py

After running, commit BOTH files (or commit nothing — the test will catch
drift on CI either way).
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / "assets" / "export" / "styles.css"
OUT = ROOT / "src" / "export" / "inline-css.ts"


def main() -> int:
    content = CSS.read_text(encoding="utf-8")

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
        ' * Inline CSS constant for HTML export.\n'
        ' *\n'
        ' * Decision T12.D1: the CSS is embedded as a string constant here rather\n'
        ' * than loaded from assets/export/styles.css at runtime. This avoids\n'
        ' * bundle-time asset resolution complexity (CJS __dirname vs ESM\n'
        ' * import.meta.url vs tsup output layout).\n'
        ' *\n'
        ' * Synchronization contract: tests/unit/inline-css-sync.test.ts asserts\n'
        ' * that this constant is byte-identical to assets/export/styles.css. Any\n'
        ' * change to the CSS must be applied to BOTH files. Regenerate with:\n'
        ' *   python3 scripts/sync-inline-css.py\n'
        ' *\n'
        ' * No external fonts, no CDN references, no http(s) URLs.\n'
        ' */\n'
        '\n'
        'export const INLINE_CSS = `'
    )
    epilog = "`;\n"

    OUT.write_text(prelude + content + epilog, encoding="utf-8")
    print(f"Synced {OUT.relative_to(ROOT)} from {CSS.relative_to(ROOT)} "
          f"({len(content)} chars).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
