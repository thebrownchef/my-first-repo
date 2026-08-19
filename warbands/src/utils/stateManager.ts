import { PersistedState, SavedFighter, RosterEntry } from '../types';

const STORAGE_KEY = 'warbands_persisted_state';

export const loadState = (): PersistedState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Failed to load state', e);
  }
  return {
    p1Roster: [],
    p2Roster: [],
    customFighters: {},
    lockedRoster: null,
  };
};

export const saveState = (state: PersistedState) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save state', e);
  }
};

export const clearState = () => {
  localStorage.removeItem(STORAGE_KEY);
};
