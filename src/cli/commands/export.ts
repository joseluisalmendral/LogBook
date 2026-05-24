/**
 * logbook export — parent command with format subcommands.
 *
 * Slice 19: instructor-pack and pdf subcommands deleted along with the
 * legacy export shell (src/export/build-html-document.ts + 5 sibling files).
 * Only the interactive HTML export from the slice-10 rewrite remains; users
 * who need a PDF can print-to-PDF from the new HTML in any browser.
 */

import { defineCommand } from "citty";
import html from "./export/html.js";

export default defineCommand({
  meta: {
    name: "export",
    description: "Export LogBook docs to interactive HTML",
  },
  subCommands: {
    html,
  },
});
