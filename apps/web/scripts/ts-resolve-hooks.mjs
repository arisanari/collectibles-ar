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
  return nextResolve(specifier, context);
}
