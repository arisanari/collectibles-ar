// Node module-resolution hook for the scripts/*.test.mjs unit tests: lets
// `node --experimental-strip-types` import the app's extensionless relative
// TypeScript modules (the Next.js convention) by retrying with ".ts".
export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-z]+$/i.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // fall through to the default resolution
    }
  }
  // `next/server`, `next/headers`: next's package has no "exports" map, so plain Node needs the ".js" the bundler adds.
  if (/^next\/[a-z]+$/.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.js`, context);
    } catch {
      // fall through to the default resolution
    }
  }
  return nextResolve(specifier, context);
}

// JSON imports in the app's modules (e.g. `import fixture from "../fixtures/demo/assets.json"`) have no import
// attribute because the Next.js bundler doesn't need one; add it so plain Node can load them.
export async function load(url, context, nextLoad) {
  if (url.endsWith(".json")) {
    return nextLoad(url, { ...context, importAttributes: { ...context.importAttributes, type: "json" } });
  }
  return nextLoad(url, context);
}
