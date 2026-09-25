/**
 * Puts a syntax-coloured <pre> under a JSON textarea (see the .hl-layer comment in global.css for
 * why a layer rather than replacing the textarea). The textarea must sit inside a .code-wrap.
 * Used by the JSON Formatter for its output and, with `live`, for its input.
 *
 * The layer holds one <div> per line, and an update recolours only the lines that changed since
 * the last one (JSON tokens never span a line, so per-line colouring is identical to colouring the
 * whole text). Rebuilding the whole layer measured 23 ms per update at 10k characters and 311 ms at
 * 99k; line-level updates cost ~1.5 ms at 99k, which is what makes colouring an input you type into
 * possible at all. JSON Diff carries its own copy of this (no shared JS across tools).
 */
import { highlightJsonHtml } from '../../lib/json-highlight';

/** Above this many characters colouring is skipped: plain text stays instant on huge pastes. */
const MAX_HIGHLIGHT_CHARS = 200_000;
/** An editable box repaints on every keystroke, so it stops colouring sooner. */
const MAX_LIVE_HIGHLIGHT_CHARS = 100_000;

export function attachJsonHighlight(textarea: HTMLTextAreaElement, { live = false } = {}) {
  const wrap = textarea.parentElement as HTMLElement;
  const layer = document.createElement('pre');
  layer.className = 'hl-layer';
  layer.setAttribute('aria-hidden', 'true');
  // First child, so the line-number gutter (a later sibling) still paints above it.
  wrap.insertBefore(layer, wrap.firstChild);
  if (live) wrap.classList.add('hl-input');
  const max = live ? MAX_LIVE_HIGHLIGHT_CHARS : MAX_HIGHLIGHT_CHARS;
  const tpl = document.createElement('template');
  let lines: string[] = [];
  let painted: string | null = null;

  const sync = () => {
    layer.scrollTop = textarea.scrollTop;
    layer.scrollLeft = textarea.scrollLeft;
  };
  textarea.addEventListener('scroll', sync);
  // The tool's Wrap/No-wrap button toggles .no-wrap on the textarea; the layer must wrap identically.
  new MutationObserver(() => layer.classList.toggle('no-wrap', textarea.classList.contains('no-wrap'))).observe(
    textarea,
    { attributes: true, attributeFilter: ['class'] },
  );

  // An empty line still takes one line of height, like the textarea's own empty line.
  const lineHtml = (line: string) => `<div>${line ? highlightJsonHtml(line) : '<br>'}</div>`;
  function update(enabled = true) {
    const text = textarea.value;
    const on = enabled && text.length > 0 && text.length <= max;
    const key = on ? text : null;
    if (key !== painted || !on) {
      painted = key;
      wrap.classList.toggle('has-hl', on);
      const next = on ? text.split('\n') : [];
      // Lines shared at the start and at the end are kept; only the span between is replaced.
      let start = 0;
      while (start < lines.length && start < next.length && lines[start] === next[start]) start++;
      let endOld = lines.length;
      let endNew = next.length;
      while (endOld > start && endNew > start && lines[endOld - 1] === next[endNew - 1]) {
        endOld--;
        endNew--;
      }
      if (endOld > start) {
        const range = document.createRange();
        range.setStartBefore(layer.children[start]);
        range.setEndAfter(layer.children[endOld - 1]);
        range.deleteContents();
      }
      if (endNew > start) {
        tpl.innerHTML = next.slice(start, endNew).map(lineHtml).join('');
        layer.insertBefore(tpl.content, layer.children[start] ?? null);
      }
      lines = next;
    }
    sync();
  }
  // A typed character must be coloured in the same task as the keystroke, never on a debounced
  // render, or it is invisible (the textarea's own text is transparent) until that render runs.
  if (live) textarea.addEventListener('input', () => update());

  return {
    /** Re-colour from the textarea's current value; `enabled: false` shows it as plain text. */
    update,
  };
}
