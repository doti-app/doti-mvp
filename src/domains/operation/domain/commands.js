// @ts-check

/** @param {any} state @param {string} action @param {string} detail @param {() => string} createId @param {() => string} now */
export function recordActivity(state, action, detail, createId, now) {
  state.activity.unshift({ id: createId(), action, detail, at: now() });
  state.activity = state.activity.slice(0, 50);
  return state;
}
