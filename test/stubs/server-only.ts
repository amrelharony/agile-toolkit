// Next.js provides "server-only" itself at build time, and it fails the build if
// a client bundle pulls it in. The package is not installed, so tests that render
// a page in jsdom resolve it to this empty file.
export {};
