import { Difficulty } from "./types";

export const GENRES = [
  "Random",
  "Geography",
  "Entertainment",
  "History",
  "Art & Literature",
  "Science & Nature",
  "Sports & Leisure"
];

export const DIFFICULTY_COLORS = {
  [Difficulty.EASY]: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  [Difficulty.MEDIUM]: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  [Difficulty.HARD]: "text-rose-500 bg-rose-500/10 border-rose-500/20"
};

export const DIFFICULTY_LABELS = {
  [Difficulty.EASY]: "Easy",
  [Difficulty.MEDIUM]: "Medium",
  [Difficulty.HARD]: "Hard"
};