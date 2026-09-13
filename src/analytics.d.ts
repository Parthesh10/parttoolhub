/**
 * The site's one analytics entry point, defined inline by Base.astro (see
 * docs/ANALYTICS.md). Tool client scripts call `window.pth?.track(...)`; the
 * optional chaining means a page with analytics disabled, or a blocked GA
 * script, never throws. Parameters are restricted to primitives on purpose —
 * never pass user text, only slugs, action names, control ids and buckets.
 */
interface PthAnalytics {
  track(name: string, params?: Record<string, string | number | boolean>): void;
}

interface Window {
  pth?: PthAnalytics;
}
