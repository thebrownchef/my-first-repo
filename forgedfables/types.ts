
export enum GamePhase {
  LOBBY = 'LOBBY',
  
  // Character Creation
  DRAFT_ARCHETYPE = 'DRAFT_ARCHETYPE',
  DRAFT_ADJECTIVE = 'DRAFT_ADJECTIVE',
  DRAFT_SUFFIX = 'DRAFT_SUFFIX',
  // DRAFT_NAME removed in favor of manual entry
  DRAFT_QUEST = 'DRAFT_QUEST',
  ENTER_NAME = 'ENTER_NAME', // Manual name entry phase
  GENERATING_PROFILE = 'GENERATING_PROFILE',
  LOADING_INTRO = 'LOADING_INTRO',
  
  // Game Loop
  ROUND_GENERATING = 'ROUND_GENERATING', // AI generating cards for the round
  ROUND_DRAFT_VERB = 'ROUND_DRAFT_VERB',
  ROUND_DRAFT_NOUN = 'ROUND_DRAFT_NOUN',
  
  READING_HISTORY = 'READING_HISTORY', // New phase for reading story before acting
  ROUND_END_REVIEW = 'ROUND_END_REVIEW', // Phase to review the round result before proceeding
  PLAYING = 'PLAYING',
  PROCESSING_TURN = 'PROCESSING_TURN',
  ENDING = 'ENDING',
  FINISHED = 'FINISHED'
}

export interface Player {
  id: string;
  playerName: string;
  name: string;
  shortName?: string;
  gender?: string;
  goal: string;
  score: number; // New field for competitive scoring
  scoreHistory: number[]; // Track score at end of each round
  conditions: string[]; // New field for status effects (e.g. "Dead", "Injured")
  avatarSeed: number;
  avatarUrl?: string;
  color: string;
  visualDescription?: string; // Consistent visual description for image generation
  draftParts?: {
    archetype?: string;
    adjective?: string;
    suffix?: string;
    name?: string;
    quest?: string;
    gender?: string;
  };
  hand: {
    verb: string | null;
    nouns: string[];
  };
}

export interface StorySegment {
  id: string;
  text: string;
  playerId?: string;
  characterName?: string;
  action?: string;
  isRoundEnd?: boolean;
  imageUrl?: string;
  audioData?: string; // Base64 raw audio data
  dialogueType?: string;
}

export interface WorldLocation {
  id: string;
  name: string;
  description: string;
  playerIds: string[];
  connectedLocationIds?: string[];
}

export interface GameState {
  phase: GamePhase;
  players: Player[];
  storyHistory: StorySegment[];
  currentPlayerIndex: number;
  round: number;
  winner?: Player | null;
  winReason?: string;
  storyTitle?: string;
  scenario: string;
  
  // Drafting State
  draftOptions: string[]; 
  draftRoundStartIndex: number;
  
  // Entity Tracking
  knownEntities: string[];
  usedNouns: string[]; // Track nouns already drafted to prevent repetition
  usedVerbs: string[]; // Track verbs already drafted to prevent repetition


  // Narrative Glue
  activeConflict?: string;
  currentLocation?: string;
  currentLocationDescription?: string;
  locationImageUrl?: string; // New field for the location image
  storyPhase?: 'The Hook' | 'Rising Action' | 'The Climax' | string;
  activeCharacterName?: string; // Tracks the last character mentioned to handle context for inanimate objects
  
  // Round Context
  roundSummaries: string[]; // Stores the narrative summary of previous rounds
  
  // Round Result
  roundResult?: {
    winnerId: string | null;
    reason: string;
  };
  
  // Ending
  victoryImageUrl?: string;
  balladAudioUrl?: string;
  balladLyrics?: string;
  isGeneratingBallad?: boolean;
}

// PIPELINE TYPES

export enum TurnStatus {
  PENDING = 'PENDING',               // Player submitted, waiting for processor
  GENERATING_TEXT = 'GENERATING_TEXT', // AI is writing the story
  TEXT_COMPLETE = 'TEXT_COMPLETE',     // Text done, ready for TTS/Image
  GENERATING_MEDIA = 'GENERATING_MEDIA', // Generating Audio/Image in background
  READY_TO_PLAY = 'READY_TO_PLAY',     // Fully loaded, waiting in line to be shown
  PLAYING = 'PLAYING',                 // Currently being shown/read to players
  COMPLETED = 'COMPLETED',             // Moved to permanent history
  FAILED = 'FAILED'
}

export interface ConditionUpdate {
    characterName: string;
    condition: string;
    type: 'add' | 'remove';
}

export interface QueuedTurn {
  id: string;
  playerId: string;
  playerName: string;
  action: string; // Display string "Thor swings hammer"
  
  // Structured Card Data (Critical for AI)
  cardSubject: string;
  cardVerb: string;
  cardObject: string;

  // Narrative Context snapshot at the moment of submission
  contextActiveCharacter?: string;

  status: TurnStatus;
  
  // Data gradually filled in by AI
  resultText?: string;
  audioData?: string; // Base64
  imageUrl?: string;
  
  // Map updates
  newEntities?: string[];
  removedEntities?: string[];
  
  // Condition updates
  conditionUpdates?: ConditionUpdate[];

  dialogueType?: string;

  // To handle errors gracefully
  error?: string;
  retryCount?: number;
}
