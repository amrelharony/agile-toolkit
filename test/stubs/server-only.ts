/**
 * Test stub for the `server-only` package.
 *
 * `server-only` ships a module that throws unless imported under the bundler's
 * `react-server` condition — its job is to fail the build if a server module is
 * pulled into a client bundle. Under vitest (plain Node/jsdom) that condition
 * isn't set, so importing any module that does `import "server-only"` would
 * throw at load time. Aliasing the package to this empty module (see
 * vitest.config.ts) lets server-only modules be unit-tested while preserving
 * the real guard in the actual Next build.
 */
export {};
