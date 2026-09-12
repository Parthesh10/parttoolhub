/**
 * Hand text from one tool page to another via sessionStorage.
 * Stays on-device (never a URL param), survives the navigation, and is
 * consumed once so a later visit to the page starts blank.
 */
const KEY = 'devtools-hub:transfer';

export function sendToTool(text: string, path: string): void {
  try {
    sessionStorage.setItem(KEY, text);
  } catch {
    /* storage blocked — the user just lands on an empty tool */
  }
  window.location.href = path;
}

export function receiveTransfer(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    if (v !== null) sessionStorage.removeItem(KEY);
    return v;
  } catch {
    return null;
  }
}
