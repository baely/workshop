// Which interface this browser shows: the original, or the new one being tried out. Kept per browser, like the theme.
const KEY = 'workshop-interface';

export function usesNewInterface(): boolean {
  try {
    return localStorage.getItem(KEY) === 'next';
  } catch {
    return false;
  }
}

/** Switches interface and reloads, since each one is a separate bundle with its own styles. */
export function setNewInterface(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, 'next');
    else localStorage.removeItem(KEY);
  } catch {
    return; // private mode: the choice can't be kept, so stay put
  }
  window.location.assign(on ? '/' : '/settings');
}
