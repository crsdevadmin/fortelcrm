const PREFIX = 'fortel_crm_draft_v1';

export function draftKey(type, parts = []) {
  return [PREFIX, type, ...parts].map(value => String(value ?? '')).join(':');
}

export function readDraft(key, maxAgeMs = 14 * 24 * 60 * 60 * 1000) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft?.savedAt || Date.now() - Number(draft.savedAt) > maxAgeMs) {
      localStorage.removeItem(key);
      return null;
    }
    return draft.data ?? null;
  } catch (_) {
    return null;
  }
}

export function writeDraft(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
    return true;
  } catch (_) {
    return false;
  }
}

export function removeDraft(key) {
  try {
    localStorage.removeItem(key);
  } catch (_) {
    // Draft cleanup must never block a successful server save.
  }
}
