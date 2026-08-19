export enum Difficulty {
  EASY = 'EASY',
  MEDIUM = 'MEDIUM',
  HARD = 'HARD'
}

export enum GameState {
  PLAYER_SETUP = 'PLAYER_SETUP',
  PLAYER_NAMING = 'PLAYER_NAMING',
  WELCOME = 'WELCOME',
  PLAYING = 'PLAYING',
  VICTORY = 'VICTORY',
  GAME_OVER = 'GAME_OVER'
}

export interface Player {
  id: number;
  name: string;
  score: number;
}

export interface TriviaQuestion {
  questionText: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  questionAudio?: string;
  answerAudio?: string;
  questionStemAudio?: string;
  optionAudios?: Record<string, string>;
}

export interface HistoryItem {
  q: string;
  a: string;
  t: number;
}

export interface GameStatus {
  state: GameState;
  difficulty: Difficulty;
  genre: string;
  score: number;
  streak: number;
}