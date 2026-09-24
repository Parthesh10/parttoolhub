/**
 * Puts a syntax-coloured <pre> under a read-only JSON output textarea (see the .hl-layer comment in
 * global.css for why a layer rather than replacing the textarea). The textarea must sit inside a
 * .code-wrap. Call update() whenever the textarea's value changes.
 */
import { highlightJsonHtml } from '../../lib/json-highlight';

/** Above this many characters colouring is skipped: plain text stays instant on huge pastes. */
const MAX_HIGHLIGHT_CHARS = 200_000;

export function attachJsonHighlight(textarea: HTMLTextAreaElement) {
  const wrap = textarea.parentElement as HTMLElement;
  const layer = document.createElement('pre');
  layer.className = 'hl-layer';
  layer.setAttribute('aria-hidden', 'true');
  // First child, so the line-number gutter (a later sibling) still paints above it.
  wrap.insertBefore(layer, wrap.firstChild);

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

  return {
    /** Re-colour from the textarea's current value; `enabled: false` shows it as plain text. */
    update(enabled = true) {
      const text = textarea.value;
      const on = enabled && text.length > 0 && text.length <= MAX_HIGHLIGHT_CHARS;
      wrap.classList.toggle('has-hl', on);
      // The trailing newline matches the extra line a textarea leaves after a final line break,
      // keeping the two scroll heights equal.
      layer.innerHTML = on ? highlightJsonHtml(text) + '\n' : '';
      sync();
    },
  };
}
