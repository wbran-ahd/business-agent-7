/**
 * Runtime environment validation.
 *
 * A missing `VITE_CONVEX_URL` used to surface as an unexplained blank page deep
 * inside `ConvexReactClient`. It now fails once, loudly, with the variable name.
 */

function read(name: string): string | undefined {
  const value = import.meta.env[name] as string | undefined;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function getConvexUrl(): string | undefined {
  return read("VITE_CONVEX_URL");
}

export function hasConvexUrl(): boolean {
  return getConvexUrl() !== undefined;
}

/** Returns the URL or throws a message that names the missing variable. */
export function requireConvexUrl(): string {
  const url = getConvexUrl();
  if (!url) {
    throw new Error(
      "VITE_CONVEX_URL is missing — set it in the project's environment so the app can reach its backend.",
    );
  }
  return url;
}
