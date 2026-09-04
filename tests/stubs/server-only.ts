/**
 * `server-only` is resolved internally by Next.js and is not an installed
 * package. Vitest runs outside the Next.js bundler, so it needs this stand-in to
 * import modules that declare themselves server-only.
 */
export {};
