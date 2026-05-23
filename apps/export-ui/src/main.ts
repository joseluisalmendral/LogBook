/*
 * main.ts — Svelte 5 mount entry. Reads #app and instantiates <App>.
 *
 * Svelte 5's `mount` (not `new App(...)`) is the official entry shape for
 * Svelte 5 components. The bundle is consumed inside a single HTML file —
 * there is no router-level code-splitting, no SSR, no hydration.
 */

import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";

const target = document.getElementById("app");
if (!target) {
  // eslint-disable-next-line no-console
  console.error("LogBook export-ui: missing #app mount point in index.html");
} else {
  mount(App, { target });
}
