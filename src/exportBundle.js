// Inlines an ES module and its relative imports into one classic-script body,
// so the standalone HTML export runs the same source as the app instead of a
// hand-maintained copy. Dependency-free: it only understands the plain
// `import { a } from "./x.js"` and `export function|const|let|class` forms this
// codebase uses, and throws on anything else rather than emitting a bad file.
//
// `readText` takes an absolute URL string and resolves to that file's source,
// so the browser can pass a fetch and tests can pass a file read.

const IMPORT_PATTERN = /^import\s[\s\S]*?\sfrom\s+["']([^"']+)["'];?[ \t]*$/gm;
const EXPORT_PATTERN = /^export\s+(?=(?:async\s+)?function\b|const\b|let\b|class\b)/gm;
const UNSUPPORTED_EXPORT_PATTERN = /^export\s+(?:default\b|\{|\*)/m;
const TOP_LEVEL_NAME_PATTERN = /^(?:(?:async\s+)?function\s*\*?\s*|const\s+|let\s+|class\s+)([A-Za-z_$][\w$]*)/gm;

export async function bundleModules(entryUrl, readText) {
  const ordered = [];
  const visited = new Set();

  await visit(entryUrl);

  const seenNames = new Map();
  const parts = ordered.map(({ url, code }) => {
    for (const [, name] of code.matchAll(TOP_LEVEL_NAME_PATTERN)) {
      if (seenNames.has(name)) {
        throw new Error(`Export bundle: "${name}" is declared in both ${seenNames.get(name)} and ${url}.`);
      }
      seenNames.set(name, url);
    }
    return `// ${url.split("/").pop()}\n${code.trim()}\n`;
  });

  // "</script" inside the inlined source would end the export's <script> early.
  return `(function () {\n"use strict";\n\n${parts.join("\n")}})();\n`.replaceAll("</script", "<\\/script");

  async function visit(url) {
    if (visited.has(url)) return;
    visited.add(url);

    const source = await readText(url);
    if (UNSUPPORTED_EXPORT_PATTERN.test(source)) {
      throw new Error(`Export bundle: ${url} uses an export form the bundler does not support.`);
    }

    const dependencies = [...source.matchAll(IMPORT_PATTERN)].map((match) => new URL(match[1], url).href);
    for (const dependency of dependencies) {
      await visit(dependency);
    }

    ordered.push({
      url,
      code: source.replace(IMPORT_PATTERN, "").replace(EXPORT_PATTERN, "")
    });
  }
}
