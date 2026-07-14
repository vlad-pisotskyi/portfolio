export type Theme = "light" | "dark";

/** localStorage key holding an explicit user override. Absent = dark default. */
export const THEME_STORAGE_KEY = "theme";

/** Class added to <html> for the dark palette. */
export const DARK_CLASS = "dark";

/**
 * Inline script injected into <head> and run before paint to prevent a
 * theme flash (FOUC). Reads an explicit override from localStorage;
 * without one, dark is the deliberate default (the site's copper-dark look
 * is the brand — OS `prefers-color-scheme` is intentionally not consulted).
 * Kept self-contained (no imports) because it executes as raw text.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var d=t?t==="dark":true;if(d)document.documentElement.classList.add(${JSON.stringify(
  DARK_CLASS,
)});}catch(e){}})();`;
