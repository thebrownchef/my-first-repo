import React, { useState, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { GamePhase, Player, StorySegment, GameState, TurnStatus } from './types';
import { 
  generateGameContext, 
  determineWinner, 
  evaluateRound, 
  generateDraftOptions, 
  generateRoundOptions, 
  generateCharacterImage, 
  generateStoryImage, 
  generateVictoryImage,
  generateRoundSummary,
  generateBallad,
  getStoredApiKey,
  setStoredApiKey,
  clearStoredApiKey
} from './services/geminiService';
import { Button } from './components/Button';
import { PlayerCard } from './components/PlayerCard';
import { StoryBook } from './components/StoryBook';
import { TextFit } from './components/TextFit';
import { useTurnPipeline } from './hooks/useTurnPipeline';
import { set as idbSet, get as idbGet, del as idbDel } from 'idb-keyval';

const COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
const MAX_ROUNDS = 5;

const extractNounFromQuest = (quest: string): string => {
  if (!quest) return "";
  // Split by common passive voice markers (case-insensitive)
  const markerRegex = /\b(is|was|are|were|has\s+been|have\s+been|gets|get)\b/i;
  const parts = quest.split(markerRegex);
  if (parts.length > 1) {
    let subject = parts[0].trim();
    // Remove leading "the", "a", "an" (case-insensitive)
    subject = subject.replace(/^(the|a|an)\s+/i, '');
    return subject;
  }
  
  // Fallback: If it doesn't match the passive voice pattern, basic cleaning
  let cleaned = quest.trim();
  cleaned = cleaned.replace(/^(the|a|an)\s+/i, '');
  const words = cleaned.split(/\s+/);
  if (words.length > 1 && (words[words.length - 1].endsWith('ed') || words[words.length - 1].endsWith('en') || words[words.length - 1].endsWith('t'))) {
    words.pop();
    cleaned = words.join(' ');
  }
  return cleaned;
};

const playNotificationTone = () => {
    try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        
        const playNote = (freq: number, startTime: number, duration: number) => {
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(freq, startTime);
            
            gainNode.gain.setValueAtTime(0, startTime);
            gainNode.gain.linearRampToValueAtTime(0.2, startTime + 0.05);
            gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
            
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            oscillator.start(startTime);
            oscillator.stop(startTime + duration);
        };

        const now = audioCtx.currentTime;
        playNote(440, now, 0.3);       // A4
        playNote(659.25, now + 0.15, 0.4); // E5
    } catch (e) {
        console.error("Audio context failed", e);
    }
};

const getScenarioLoadingMessage = (msg: string, scenario: string): string => {
  if (!msg) return "";

  // Clean the scenario string by removing leading 'a', 'an', or 'the' (case-insensitive)
  // We keep the exact capitalization provided by the player.
  const cleanedScenario = scenario ? scenario.trim().replace(/^(the|a|an)\s+/i, '') : 'story';

  // Extract wait seconds if the message is "Narrator is thinking... (Xs)"
  const secondsMatch = msg.match(/\((\d+)s\)/);
  const secondsText = secondsMatch ? ` (${secondsMatch[1]}s)` : "";

  // Mapping array following the structure: [verb, noun]
  let action: [string, string] | null = null;

  if (msg.includes("Summoning archetypes"))        action = ["Weaving", "legends"];
  if (msg.includes("Drafting archetype"))         action = ["Sifting", "records"];
  if (msg.includes("Weaving new options"))        action = ["Aligning", "parameters"];
  if (msg.includes("Drafting"))                   action = ["Drafting", "possibilities"];
  if (msg.includes("Creating character profiles")) action = ["Forging", "personas"];
  if (msg.includes("Forging the world"))          action = ["Architecting", "environments"];
  if (msg.includes("Painting the scene"))         action = ["Manifesting", "atmospheres"];
  if (msg.includes("Consulting the oracles"))     action = ["Seeking", "truths"];
  if (msg.includes("Dealing destiny"))            action = ["Splitting", "paths"];
  if (msg.includes("Narrator is thinking"))       action = ["Whispering", `laws${secondsText}`];

  // Assemble the template: {present continuous verb} {scenario} {noun}...
  if (action) {
    const [verb, noun] = action;
    return `${verb} ${cleanedScenario} ${noun}...`;
  }

  return msg;
};

const App: React.FC = () => {
  const handleErrorFeedback = (e: any, fallback: string) => {
    let msg = e?.message || fallback;
    try {
      let jsonStr = msg;
      if (msg.includes('ApiError:')) {
        jsonStr = msg.split('ApiError: ')[1];
      }
      const parsed = JSON.parse(jsonStr);
      if (parsed.error && parsed.error.message) {
        msg = parsed.error.message;
      }
    } catch(err) {}
    setGlobalError(msg);
  };

  const [gameState, setGameState] = useState<GameState>({
    phase: GamePhase.LOBBY,
    players: [],
    storyHistory: [],
    currentPlayerIndex: 0,
    round: 1,
    draftOptions: [],
    draftRoundStartIndex: 0,
    knownEntities: [],
    usedNouns: [],
    usedVerbs: [],
    scenario: 'General Fiction',
    storyPhase: 'Introduction',
    activeConflict: '',
    currentLocation: '',
    currentLocationDescription: '',
    activeCharacterName: undefined, // Initialize empty
    roundSummaries: []
  });

  const [hasCustomKey, setHasCustomKey] = useState<boolean>(() => !!getStoredApiKey());
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [apiKeyInputError, setApiKeyInputError] = useState<string>('');

  const handleSaveApiKey = () => {
    if (!apiKeyInput.trim()) {
      setApiKeyInputError('Paste your Gemini API key to continue.');
      return;
    }
    setStoredApiKey(apiKeyInput);
    setHasCustomKey(true);
    setApiKeyInputError('');
  };

  const handleForgetApiKey = () => {
    clearStoredApiKey();
    setHasCustomKey(false);
    setApiKeyInput('');
  };

  const [newPlayerName, setNewPlayerName] = useState('');
  const [scenarioInput, setScenarioInput] = useState('');
  const [draftInputName, setDraftInputName] = useState('');
  const [draftGender, setDraftGender] = useState<string>('Male');
  const [nameError, setNameError] = useState<string | null>(null); 
  const [isGenerating, setIsGenerating] = useState(false);
  const [rawLoadingMessage, setLoadingMessageState] = useState<string>('');
  const loadingMessage = rawLoadingMessage;
  const setLoadingMessage = (msg: string | ((prev: string) => string)) => {
    if (typeof msg === 'function') {
      setLoadingMessageState(msg);
    } else {
      const scenario = gameState.scenario || scenarioInput || 'General Fiction';
      setLoadingMessageState(getScenarioLoadingMessage(msg, scenario));
    }
  };
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [viewingPlayer, setViewingPlayer] = useState<Player | null>(null);
  const [viewingStory, setViewingStory] = useState(false);
  const [roundReviewRevealed, setRoundReviewRevealed] = useState(false);
  const [viewingOverview, setViewingOverview] = useState(false);
  const [viewingLocation, setViewingLocation] = useState(false);
  
  const [hasAutoSave, setHasAutoSave] = useState(false);

  useEffect(() => {
    idbGet('forged_fables_autosave').then((saved) => {
      if (saved) {
        setHasAutoSave(true);
      }
    }).catch(console.warn);
  }, []);

  const loadAutoSave = async () => {
    try {
      const saved = await idbGet('forged_fables_autosave');
      if (saved) {
        setGameState(saved);
      }
    } catch (e) {
      console.error("Failed to load auto-save", e);
      setGlobalError("Failed to load saved game. Data might be corrupted.");
    }
  };

  useEffect(() => {
    if (gameState.phase === GamePhase.ROUND_END_REVIEW || gameState.phase === GamePhase.FINISHED) {
      try {
        idbSet('forged_fables_autosave', gameState).then(() => {
            setHasAutoSave(true);
        }).catch(e => {
            console.warn("Failed to auto-save game state to IndexedDB", e);
        });
      } catch (e) {
        console.warn("Failed to initiate auto-save", e);
      }
    }
  }, [gameState]);

  
  // New Ref to hold background calculation promise
  const roundCalculationPromise = useRef<Promise<{evaluation: any, summary: string}> | null>(null);

  const [sentence, setSentence] = useState<{subject: string | null, verb: string | null, object: string | null}>({
    subject: null,
    verb: null,
    object: null
  });

  const getStoryPhase = (round: number): string => {
    switch (round) {
      case 1: return 'Introduction';
      case 2: return 'Rising Action';
      case 3: return 'The Climax';
      case 4: return 'Resolution';
      case 5: return 'Epilogue';
      default: return 'Epilogue';
    }
  };

  // --- PIPELINE INTEGRATION ---
  // This hook manages the background processing of turns (Text -> Image/Audio -> Playback)
  const { addTurn, queue, isPlaying, playTurn } = useTurnPipeline(
    gameState.players,
    (val) => setGameState(prev => ({ ...prev, players: typeof val === 'function' ? val(prev.players) : val })),
    gameState.storyHistory,
    (val) => setGameState(prev => ({ ...prev, storyHistory: typeof val === 'function' ? val(prev.storyHistory) : val })),
    gameState.knownEntities,
    (val) => setGameState(prev => ({ ...prev, knownEntities: typeof val === 'function' ? val(prev.knownEntities) : val })),
    gameState.scenario,
    gameState.currentLocation,
    gameState.currentLocationDescription,
    gameState.activeConflict,
    getStoryPhase(gameState.round),
    gameState.roundSummaries
  );

  // --- SOUND NOTIFICATION ---
  const previousLoadingState = useRef(false);

  useEffect(() => {
    const isCurrentlyLoading = isGenerating || 
                               gameState.phase === GamePhase.ROUND_GENERATING || 
                               gameState.phase === GamePhase.GENERATING_PROFILE || 
                               gameState.phase === GamePhase.LOADING_INTRO ||
                               !!rawLoadingMessage ||
                               gameState.phase === GamePhase.PROCESSING_TURN; // Treating processing turn as a loading state
    
    if (previousLoadingState.current === true && isCurrentlyLoading === false) {
       // Check if the current phase requires interaction
       if ([
          GamePhase.LOADING_INTRO, GamePhase.DRAFT_ARCHETYPE, GamePhase.DRAFT_ADJECTIVE, GamePhase.DRAFT_SUFFIX, GamePhase.DRAFT_QUEST,
          GamePhase.ENTER_NAME, GamePhase.ROUND_DRAFT_VERB, GamePhase.ROUND_DRAFT_NOUN, GamePhase.PLAYING,
          GamePhase.ROUND_END_REVIEW, GamePhase.FINISHED
       ].includes(gameState.phase)) {
           playNotificationTone();
       }
    }
    previousLoadingState.current = isCurrentlyLoading;
  }, [isGenerating, gameState.phase, rawLoadingMessage]);

  // Auto-select verb if in PLAYING phase and player has one
  useEffect(() => {
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    const initialVerb = (gameState.phase === GamePhase.PLAYING && currentPlayer?.hand?.verb) 
      ? currentPlayer.hand.verb 
      : null;

    setSentence({ subject: null, verb: initialVerb, object: null });
  }, [gameState.currentPlayerIndex, gameState.phase, gameState.players]);

  // --- BACKGROUND CALCULATION LOGIC ---

  // Clear promise when phase changes away from processing/review
  useEffect(() => {
     if (gameState.phase !== GamePhase.PROCESSING_TURN && gameState.phase !== GamePhase.ROUND_END_REVIEW) {
         roundCalculationPromise.current = null;
     }
  }, [gameState.phase]);

  // Trigger background generation when all text is ready
  useEffect(() => {
    if (gameState.phase === GamePhase.PROCESSING_TURN && !roundCalculationPromise.current) {
        // Can trigger as soon as all queued turns have finished text generation
        // (i.e. no turns are in PENDING or GENERATING_TEXT status)
        const allTextGenerated = queue.every(t => t.status !== TurnStatus.PENDING && t.status !== TurnStatus.GENERATING_TEXT);
        if (allTextGenerated) {
            triggerRoundCalculations();
        }
    }
  }, [gameState.phase, queue, isPlaying]);

  const triggerRoundCalculations = () => {
      // 1. Construct Projected History (Committed + Queued)
      const queuedSegments = queue.map(t => ({
          id: t.id,
          text: t.resultText || "",
          playerId: t.playerId,
          action: t.action
      }));
      
      const fullHistory = [...gameState.storyHistory, ...queuedSegments];
      
      // SAFETY CHECK: Ensure we actually have segments to evaluate
      if (fullHistory.length === 0) {
          console.warn("No history to evaluate for round end.");
          return;
      }

      const roundSegments = fullHistory.slice(-(gameState.players.length));
      const currentPhase = getStoryPhase(gameState.round);

      console.log("Starting background round evaluation...", roundSegments);

      roundCalculationPromise.current = (async () => {
          // Run Evaluation and Summary Generation in Parallel
          const [evaluation, summary] = await Promise.all([
              evaluateRound(roundSegments, gameState.players, gameState.scenario, currentPhase, gameState.activeConflict),
              generateRoundSummary(roundSegments, gameState.scenario)
          ]);

          console.log("Background evaluation complete.", evaluation);
          return { evaluation, summary };
      })();
  };

  // --- Lobby Handlers ---
  
  const addPlayer = () => {
    if (!newPlayerName.trim()) return;
    if (gameState.players.length >= 6) return; 

    const newPlayer: Player = {
      id: uuidv4(),
      playerName: newPlayerName.trim(),
      name: 'Unknown Character', 
      goal: 'Pending...',
      score: 0,
      scoreHistory: [],
      conditions: [], 
      avatarSeed: Math.floor(Math.random() * 1000),
      color: COLORS[gameState.players.length % COLORS.length],
      draftParts: {},
      hand: { verb: null, nouns: [] }
    };

    setGameState(prev => ({
      ...prev,
      players: [...prev.players, newPlayer]
    }));
    setNewPlayerName('');
  };

  const removePlayer = (id: string) => {
    setGameState(prev => ({
      ...prev,
      players: prev.players.filter(p => p.id !== id)
    }));
  };

  const startCharacterDraft = async () => {
    if (gameState.players.length < 2) return;
    setIsGenerating(true);
    setLoadingMessage("Summoning archetypes...");
    const selectedScenario = scenarioInput.trim() || 'General Fiction';
    
    try {
        const options = await generateDraftOptions('archetype', gameState.players.length + 1, selectedScenario, gameState.players, (msg) => setLoadingMessage(msg));
        setGameState(prev => ({
          ...prev,
          scenario: selectedScenario,
          phase: GamePhase.DRAFT_ARCHETYPE,
          draftOptions: options,
          currentPlayerIndex: 0,
          draftRoundStartIndex: 0,
        }));
    } catch (e: any) {
        handleErrorFeedback(e, "Failed to start draft. Please try again.");
    } finally {
        setIsGenerating(false);
        setLoadingMessage('');
    }
  };

  // --- Character Drafting Logic ---

  const handleCharacterDraftPick = async (option: string) => {
    if (isGenerating) return; 

    // --- SANITIZATION LOGIC ---
    let cleanOption = option.trim();

    // 1. Fix "The The" Bug: Remove leading "The" from Archetypes
    if (gameState.phase === GamePhase.DRAFT_ARCHETYPE) {
        cleanOption = cleanOption.replace(/^The\s+/i, ''); // "The Warrior" -> "Warrior"
        cleanOption = cleanOption.replace(/\.$/, '');      // Remove trailing periods
    }

    // 2. Fix Nonsense Suffixes: Turn "-weave" into "of the Weave"
    if (gameState.phase === GamePhase.DRAFT_SUFFIX) {
        // Remove leading hyphens
        cleanOption = cleanOption.replace(/^-+\s*/, ''); 
        
        // If it doesn't start with a preposition, add "of"
        const lower = cleanOption.toLowerCase();
        if (!lower.startsWith('of') && !lower.startsWith('from') && !lower.startsWith('with') && !lower.startsWith('the')) {
            cleanOption = `of ${cleanOption}`;
        }
    }

    const currentPlayerId = gameState.players[gameState.currentPlayerIndex].id;
    const updatedPlayers = gameState.players.map(p => {
      if (p.id === currentPlayerId) {
        const parts = { ...p.draftParts };
        if (gameState.phase === GamePhase.DRAFT_ARCHETYPE) parts.archetype = cleanOption;
        if (gameState.phase === GamePhase.DRAFT_ADJECTIVE) parts.adjective = cleanOption;
        if (gameState.phase === GamePhase.DRAFT_SUFFIX) parts.suffix = cleanOption;
        if (gameState.phase === GamePhase.DRAFT_QUEST) parts.quest = cleanOption;
        return { ...p, draftParts: parts };
      }
      return p;
    });

    // Use splice to safely remove one instance
    const remainingOptions = [...gameState.draftOptions];
    const pickIndex = remainingOptions.indexOf(option);
    if (pickIndex > -1) remainingOptions.splice(pickIndex, 1);
    
    if (remainingOptions.length === 1) {
      await advanceCharacterDraftPhase(updatedPlayers);
    } else {
      const nextIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
      setGameState(prev => ({
        ...prev,
        players: updatedPlayers,
        draftOptions: remainingOptions,
        currentPlayerIndex: nextIndex
      }));
    }
  };

  const advanceCharacterDraftPhase = async (currentPlayers: Player[]) => {
    setIsGenerating(true);
    setLoadingMessage("Weaving new options...");
    let nextPhase: GamePhase | null = null;
    let category: 'adjective' | 'suffix' | 'name' | 'quest' | null = null;
    let nextStartPlayerIndex = (gameState.draftRoundStartIndex + 1) % currentPlayers.length;

    if (gameState.phase === GamePhase.DRAFT_ARCHETYPE) { 
        nextPhase = GamePhase.DRAFT_ADJECTIVE; 
        category = 'adjective'; 
    }
    else if (gameState.phase === GamePhase.DRAFT_ADJECTIVE) { 
        nextPhase = GamePhase.DRAFT_SUFFIX; 
        category = 'suffix'; 
    }
    else if (gameState.phase === GamePhase.DRAFT_SUFFIX) { 
        nextPhase = GamePhase.DRAFT_QUEST; 
        category = 'quest'; 
    }
    else if (gameState.phase === GamePhase.DRAFT_QUEST) { 
        nextPhase = GamePhase.ENTER_NAME; 
        category = null; 
    } 
    else { 
        nextPhase = GamePhase.GENERATING_PROFILE; 
    }

    if (nextPhase === GamePhase.ENTER_NAME) {
       setGameState(prev => ({
        ...prev,
        players: currentPlayers,
        phase: GamePhase.ENTER_NAME,
        draftOptions: [],
        currentPlayerIndex: nextStartPlayerIndex,
        draftRoundStartIndex: nextStartPlayerIndex
      }));
    } else if (category && nextPhase) {
      try {
        const options = await generateDraftOptions(category, currentPlayers.length + 1, gameState.scenario, currentPlayers, (msg) => setLoadingMessage(msg));
        setGameState(prev => ({
            ...prev,
            players: currentPlayers,
            phase: nextPhase as GamePhase,
            draftOptions: options,
            currentPlayerIndex: nextStartPlayerIndex,
            draftRoundStartIndex: nextStartPlayerIndex
        }));
      } catch (e: any) {
         handleErrorFeedback(e, "Generation failed. Please try again.");
      }
    } else {
      finalizeCharacters(currentPlayers);
    }
    setIsGenerating(false);
    setLoadingMessage('');
  };
  
  const submitCharacterName = () => {
    if (isGenerating) return;
    const nameToSubmit = draftInputName.trim();
    if (!nameToSubmit) return;
    const isPlayerName = gameState.players.some(p => p.playerName.toLowerCase() === nameToSubmit.toLowerCase());
    if (isPlayerName) {
        setNameError("Namesake forbidden. Your character must have a unique identity distinct from the players.");
        return;
    }
    
    const currentPlayerId = gameState.players[gameState.currentPlayerIndex].id;
    const updatedPlayers = gameState.players.map(p => {
        if (p.id === currentPlayerId) {
            return { 
                ...p, 
                gender: draftGender,
                draftParts: { 
                    ...p.draftParts, 
                    name: nameToSubmit,
                    gender: draftGender
                } 
            };
        }
        return p;
    });

    setDraftInputName('');
    setNameError(null);
    setDraftGender('Male');

    const nextIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
    
    if (nextIndex === gameState.draftRoundStartIndex) {
        finalizeCharacters(updatedPlayers);
    } else {
        setGameState(prev => ({ ...prev, players: updatedPlayers, currentPlayerIndex: nextIndex }));
    }
  };

  const finalizeCharacters = async (players: Player[]) => {
    setGameState(prev => ({ ...prev, phase: GamePhase.GENERATING_PROFILE, players }));
    setLoadingMessage("Forging the world & characters...");
    
    try {
        let finalizedPlayers = players.map(p => ({
          ...p,
          name: `${p.draftParts?.name} the ${p.draftParts?.adjective} ${p.draftParts?.archetype} ${p.draftParts?.suffix}`,
          shortName: p.draftParts?.name,
          goal: p.draftParts?.quest || "Complete your objective"
        }));

        const contextData = await generateGameContext(finalizedPlayers, gameState.scenario, (msg) => setLoadingMessage(msg));
        
        finalizedPlayers = finalizedPlayers.map((p, i) => ({
            ...p,
            visualDescription: contextData.playerAppearances[i]
        }));
        
        setLoadingMessage("Painting character portraits...");

        const imagePromises = finalizedPlayers.map(p => 
            generateCharacterImage(p, gameState.scenario).catch(() => undefined)
        );
        const imagesResults = await Promise.all(imagePromises);
        finalizedPlayers = finalizedPlayers.map((p, i) => ({
          ...p,
          avatarUrl: imagesResults[i] || `https://picsum.photos/seed/${p.avatarSeed}/200`
        }));

        const locName = contextData.locationName;
        const locDesc = contextData.locationDescription;
        const locConflict = contextData.conflict;

        // Generate an image for the location immediately
        let locationImage = undefined;
        try {
            setLoadingMessage("Painting the scene...");
            if (locDesc) {
                // Combine Name and Description for a better prompt
                const imagePrompt = `${locName}. ${locDesc}`;
                locationImage = await generateStoryImage(imagePrompt, gameState.scenario);
            }
        } catch (e) {
            console.warn("Location image failed", e);
        }

        setGameState(prev => ({ 
          ...prev, 
          players: finalizedPlayers, 
          phase: GamePhase.LOADING_INTRO,
          currentLocation: locName,
          currentLocationDescription: locDesc,
          locationImageUrl: locationImage,
          activeConflict: locConflict,
          storyPhase: 'Introduction',
          // INITIALIZATION: Start with a random player's character as Active Character
          activeCharacterName: finalizedPlayers[Math.floor(Math.random() * finalizedPlayers.length)]?.name
        }));
    } catch (error: any) {
        console.error("Finalization failed:", error);
        handleErrorFeedback(error, "Failed to start the game. The narrator is confused.");
        setGameState(prev => ({ ...prev, phase: GamePhase.LOBBY }));
    } finally {
        setLoadingMessage('');
    }
  };

  // --- Round Drafting Logic ---

  const startRoundDraft = async (
    players: Player[], 
    overrideLocation?: string,
    overrideConflict?: string
  ) => {
    let currentHistory = gameState.storyHistory;
    const location = overrideLocation || gameState.currentLocation;
    const conflict = overrideConflict || gameState.activeConflict;
    
    try {
        const playersReset = players.map(p => ({ ...p, hand: { verb: null, nouns: [] } }));
        const nextRound = gameState.round;
        const currentStoryPhase = getStoryPhase(nextRound);

        setGameState(prev => ({ 
          ...prev, 
          players: playersReset,
          storyHistory: currentHistory,
          phase: GamePhase.ROUND_GENERATING,
          roundResult: undefined, 
          storyPhase: currentStoryPhase
        }));

        const numPlayers = players.length;
        const verbsNeeded = numPlayers + 1;
        
        // REQUEST A LARGER BATCH TO FILL THE POOL
        const nounsToRequest = 20;

        setLoadingMessage("Consulting the oracles...");
        
        const generated = await generateRoundOptions(
          currentHistory, verbsNeeded, nounsToRequest, gameState.scenario,
          gameState.players, nextRound, location, conflict, currentStoryPhase,
          gameState.usedNouns || [],
          gameState.usedVerbs || [],
          (msg) => setLoadingMessage(msg)
        );
        
        // --- STRICT DEDUPLICATION LOGIC ---
        // 1. Identify all protected names (Full names + Short names)
        const protectedNames = new Set<string>();
        const protectedNamesArray: string[] = [];
        players.forEach(p => {
            if (p.name) {
                const lower = p.name.toLowerCase();
                protectedNames.add(lower);
                protectedNamesArray.push(lower);
            }
            if (p.shortName) {
                const lower = p.shortName.toLowerCase();
                protectedNames.add(lower);
                protectedNamesArray.push(lower);
            }
            if (p.playerName) {
                const lower = p.playerName.toLowerCase();
                protectedNames.add(lower);
                protectedNamesArray.push(lower);
            }
        });

        const isDoubleUp = (entity: string) => {
            const eLower = entity.toLowerCase();
            if (protectedNames.has(eLower)) return true;
            for (const pName of protectedNamesArray) {
                if (pName.length > 2 && eLower.includes(pName)) {
                    // Escape regex special characters in pName just in case
                    const escaped = pName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp(`\\b${escaped}\\b`);
                    if (regex.test(eLower)) return true;
                }
            }
            return false;
        };

        // 2. Filter new nouns from AI to exclude protected names AND verbs
        const currentVerbsSet = new Set(generated.verbs.map(v => v.toLowerCase()));
        
        const cleanNewNouns = generated.nouns.filter(n => 
            !isDoubleUp(n) && 
            !currentVerbsSet.has(n.toLowerCase())
        );

        // 3. Merge with existing known entities and deduplicate
        const mergedPool = [...gameState.knownEntities, ...cleanNewNouns];
        const uniquePool: string[] = [];
        const seen = new Set<string>();

        mergedPool.forEach(item => {
            const lower = item.trim().toLowerCase();
            // Double check protection, duplicates AND verbs
            if (lower && !seen.has(lower) && !isDoubleUp(item) && !currentVerbsSet.has(lower)) {
                seen.add(lower);
                uniquePool.push(item.trim());
            }
        });
        
        setGameState(prev => ({
          ...prev,
          phase: GamePhase.ROUND_DRAFT_VERB,
          draftOptions: generated.verbs,
          players: playersReset,
          currentPlayerIndex: prev.draftRoundStartIndex % numPlayers,
          draftRoundStartIndex: prev.draftRoundStartIndex,
          storyHistory: currentHistory,
          knownEntities: uniquePool // Set clean pool
        }));
    } catch (error: any) {
        console.error("Failed to start round draft", error);
        handleErrorFeedback(error, "The AI narrator is struggling to form the world. Please wait a moment and try again.");
    } finally {
        setLoadingMessage('');
    }
  };

  const handleRoundDraftPick = (option: string) => {
    const currentPlayerId = gameState.players[gameState.currentPlayerIndex].id;
    let nextPhase = gameState.phase;
    
    // CHANGED: Use splice to remove only the picked instance, safely handling duplicates
    let nextDraftOptions = [...gameState.draftOptions];
    const pickIndex = nextDraftOptions.indexOf(option);
    if (pickIndex > -1) {
        nextDraftOptions.splice(pickIndex, 1);
    }
    
    const updatedPlayers = gameState.players.map(p => {
      if (p.id === currentPlayerId) {
        const hand = { ...p.hand };
        if (gameState.phase === GamePhase.ROUND_DRAFT_VERB) {
          hand.verb = option;
        } else if (gameState.phase === GamePhase.ROUND_DRAFT_NOUN) {
          hand.nouns = [...hand.nouns, option];
        }
        return { ...p, hand };
      }
      return p;
    });

    if (gameState.phase === GamePhase.ROUND_DRAFT_VERB) {
        if (nextDraftOptions.length <= 1) {
            nextPhase = GamePhase.ROUND_DRAFT_NOUN;
            
            // GENERATE NOUN DRAFT OPTIONS FROM POOL
            // Rule: Pool = [Player Names] + [Random selection from Known Entities]
            
            // Filter out killed or dead players from the direct draftable player names list
            const activePlayers = updatedPlayers.filter(p => {
                const isDead = p.conditions?.some(c => 
                    c && typeof c === 'string' && (
                        c.toLowerCase().includes('dead') || 
                        c.toLowerCase().includes('deceased') || 
                        c.toLowerCase().includes('killed') || 
                        c.toLowerCase().includes('slain')
                    )
                );
                return !isDead;
            });
            const playerNames = activePlayers.map(p => p.shortName || p.name);

            // Extract nouns from quests during Rising Action (Round 2) — guaranteed introduction round.
            // After this round, quest nouns are no longer force-injected here; they instead flow
            // naturally through gameState.knownEntities (having been added as "new entities" once
            // introduced), so they compete equally with everything else in later rounds.
            const questNouns: string[] = [];
            const isRisingActionRound = gameState.round === 2 || gameState.storyPhase === 'Rising Action';
            if (isRisingActionRound) {
                updatedPlayers.forEach(p => {
                    if (p.goal) {
                        const qNoun = extractNounFromQuest(p.goal);
                        if (qNoun && qNoun.trim().length > 0) {
                            questNouns.push(qNoun.trim());
                        }
                    }
                });
            }
            
            // Build guaranteed items first (names + quest nouns), deduped, so we know
            // their TRUE combined size before calculating how many random fillers we need.
            const guaranteedSeen = new Set<string>();
            const guaranteedItems: string[] = [];
            const addGuaranteed = (item: string) => {
                const lower = item.toLowerCase().trim();
                if (lower && !guaranteedSeen.has(lower)) {
                    guaranteedSeen.add(lower);
                    guaranteedItems.push(item.trim());
                }
            };
            playerNames.forEach(addGuaranteed);
            questNouns.forEach(addGuaranteed);

            // Small safety buffer for Rising Action: quest-noun text can't be guaranteed unique in
            // advance, so pad target size by 1 to absorb an accidental collision without shorting
            // the last player's choice.
            const targetPoolSize = (2 * updatedPlayers.length) + 1 + (isRisingActionRound ? 1 : 0);
            
            // Filter player names AND real life names out of known entities one more time for safety
            const namesToExclude = [
                ...updatedPlayers.map(p => p.shortName || p.name),
                ...updatedPlayers.map(p => p.playerName)
            ];
            const namesToExcludeLowerArray = namesToExclude.filter(Boolean).map(n => n.toLowerCase());
            const namesToExcludeLower = new Set(namesToExcludeLowerArray);
            
            const usedNounsLower = new Set((gameState.usedNouns || []).map(n => n.toLowerCase()));
            const questNounsLower = new Set(questNouns.map(q => q.toLowerCase().trim()));
            const availableEntities = gameState.knownEntities.filter(e => {
                const eLower = e.toLowerCase();
                if (namesToExcludeLower.has(eLower) || usedNounsLower.has(eLower) || questNounsLower.has(eLower)) return false;
                
                // Eliminate double-ups where the entity contains a protected name
                for (const pName of namesToExcludeLowerArray) {
                    if (pName.length > 2 && eLower.includes(pName)) {
                        const escaped = pName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const regex = new RegExp(`\\b${escaped}\\b`);
                        if (regex.test(eLower)) {
                            return false;
                        }
                    }
                }
                return true;
            });
            
            // Size the random fill off the ACTUAL deduped guaranteed count, not the raw sum.
            const entitiesNeeded = Math.max(0, targetPoolSize - guaranteedItems.length);
            
            const shuffledEntities = [...availableEntities].sort(() => Math.random() - 0.5);
            let poolEntities = shuffledEntities.slice(0, entitiesNeeded);
            
            // Fallback: If AI returned nothing (rare), pad with generic items
            while (poolEntities.length < entitiesNeeded) {
                 const fallbacks = ["Mysterious Object", "Important Document", "Valuable Item", "Lost Artifact", "Strange Device", "Personal Belonging"];
                 const nextFallback = fallbacks.find(f => !poolEntities.includes(f) && !playerNames.includes(f) && !questNouns.includes(f)) || `Mystery Item ${poolEntities.length}`;
                 poolEntities.push(nextFallback);
            }

            // Combine and Shuffle guaranteed items with random entities
            const uniquePool: string[] = [];
            const seenItems = new Set<string>();

            const addToPool = (item: string) => {
                const lower = item.toLowerCase().trim();
                if (lower && !seenItems.has(lower)) {
                    seenItems.add(lower);
                    uniquePool.push(item.trim());
                }
            };

            // 1. Add guaranteed items
            guaranteedItems.forEach(addToPool);

            // 2. Add random entities
            poolEntities.forEach(addToPool);

            // Ensure the size of pool is at least targetPoolSize, preserving all guaranteed nouns
            const poolSizeToUse = Math.max(targetPoolSize, uniquePool.length);
            nextDraftOptions = uniquePool.slice(0, poolSizeToUse);
            
            setGameState(prev => ({
                ...prev,
                players: updatedPlayers,
                phase: nextPhase,
                draftOptions: nextDraftOptions,
                currentPlayerIndex: prev.draftRoundStartIndex
            }));
            return;
        }
    } else if (gameState.phase === GamePhase.ROUND_DRAFT_NOUN) {
        const allPlayersHaveTwoNouns = updatedPlayers.every(p => p.hand.nouns.length >= 2);
        if (allPlayersHaveTwoNouns) {
             setGameState(prev => ({
              ...prev,
              players: updatedPlayers,
              phase: GamePhase.PLAYING,
              currentPlayerIndex: prev.draftRoundStartIndex
            }));
            return;
        }
    }

    setGameState(prev => ({
      ...prev,
      players: updatedPlayers,
      draftOptions: nextDraftOptions,
      currentPlayerIndex: (prev.currentPlayerIndex + 1) % prev.players.length
    }));
  };

  // --- Gameplay Handlers ---

  const toggleCard = (type: 'verb' | 'noun', value: string) => {
    // Handle deselecting first (strictly by type)
    if (type === 'verb') {
        if (sentence.verb === value) {
            setSentence(prev => ({ ...prev, verb: null }));
            return;
        }
    } else if (type === 'noun') {
        if (sentence.subject === value) {
            setSentence(prev => ({ ...prev, subject: null }));
            return;
        }
        if (sentence.object === value) {
            setSentence(prev => ({ ...prev, object: null }));
            return;
        }
    }

    // Handle Selection
    if (type === 'verb') {
      setSentence(prev => ({ ...prev, verb: value }));
    } else {
      if (!sentence.subject) {
        setSentence(prev => ({ ...prev, subject: value }));
      } else if (!sentence.object) {
        setSentence(prev => ({ ...prev, object: value }));
      }
    }
  };

  const handleNextRoundClick = () => {
    if (gameState.round > MAX_ROUNDS) {
      setGameState(prev => ({ ...prev, phase: GamePhase.ENDING }));
      endGame(gameState.storyHistory, gameState.players);
    } else {
      startRoundDraft(gameState.players);
    }
  };

  // REFACTORED: Non-blocking turn submission using Pipeline
  const submitTurn = async () => {
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    const { subject, verb, object } = sentence;
    if (!subject || !verb || !object) return;

    // --- ACTIVE CHARACTER LOGIC ---
    
    const subjectLower = subject.toLowerCase().trim();
    const objectLower = object.toLowerCase().trim();
    
    // Helper to identify if a string is a player character
    const findMatchingPlayer = (text: string) => {
         return gameState.players.find(p => 
            (p.name && p.name.toLowerCase() === text) || 
            (p.shortName && p.shortName.toLowerCase() === text)
        );
    };

    const subjectPlayer = findMatchingPlayer(subjectLower);
    const objectPlayer = findMatchingPlayer(objectLower);

    // Set used nouns and verbs
    setGameState(prev => ({
        ...prev,
        usedNouns: [...(prev.usedNouns || []), subject, object],
        usedVerbs: [...(prev.usedVerbs || []), verb]
    }));

    // 1. Determine who is performing THIS action (The Narrative Context)
    // If the subject is a player, they are the actor.
    // If the subject is an object, the actor is the PREVIOUS active character.
    let actorForNarrative = gameState.activeCharacterName;
    if (subjectPlayer) {
        actorForNarrative = subjectPlayer.name;
    }

    // 2. Determine who becomes the Active Character for the NEXT turn (The State Update)
    // Rule: Object Priority > Subject Priority > No Change
    let nextActiveChar = gameState.activeCharacterName;
    
    if (objectPlayer) {
        nextActiveChar = objectPlayer.name;
    } else if (subjectPlayer) {
        nextActiveChar = subjectPlayer.name;
    }

    // Update state immediately so subsequent turns use the new context
    if (nextActiveChar !== gameState.activeCharacterName) {
        setGameState(prev => ({ ...prev, activeCharacterName: nextActiveChar }));
    }

    // 3. Add to Pipeline using the NARRATIVE ACTOR

    addTurn(currentPlayer, subject, verb, object, actorForNarrative);

    // 4. Logic for next player or wait
    const nextPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
    const roundStartedByIndex = gameState.draftRoundStartIndex % gameState.players.length;
    const isRoundSubmitted = nextPlayerIndex === roundStartedByIndex;

    if (isRoundSubmitted) {
        // Everyone submitted. Now we wait for the pipeline to drain.
        setGameState(prev => ({ ...prev, phase: GamePhase.PROCESSING_TURN }));
    } else {
        // Pass control to next player immediately (Non-blocking)
        setGameState(prev => ({ 
            ...prev, 
            currentPlayerIndex: nextPlayerIndex,
            phase: GamePhase.PLAYING // Explicitly keep in PLAYING
        }));
    }
    
    // Reset inputs
    setSentence({ subject: null, verb: null, object: null });
  };
  
  // Watch for Pipeline completion to trigger Round End
  useEffect(() => {
    if (gameState.phase === GamePhase.PROCESSING_TURN) {
        // We are waiting for turns to finish.
        if (queue.length === 0 && !isPlaying) {
            // Pipeline drained. Evaluate round.
            completeRound();
        }
    }
  }, [gameState.phase, queue.length, isPlaying]);

  const completeRound = async () => {
     let results;
     
     // Ensure promise exists (safety check)
     if (!roundCalculationPromise.current) {
        triggerRoundCalculations();
     }

     try {
         results = await roundCalculationPromise.current;
     } catch (e) {
         console.warn("Round calculation failed. Retrying in 2s...", e);
         await new Promise(resolve => setTimeout(resolve, 2000));
         triggerRoundCalculations(); // Spawn new promise
         return completeRound(); // Recursive wait
     }

     const { evaluation, summary } = results!; // Force unwrap as we handled retry

     let updatedPlayers = [...gameState.players];
     const currentPhase = getStoryPhase(gameState.round);

     if (evaluation.winnerId) {
          const pointsAwarded = currentPhase === 'The Climax' ? 2 : 1;
          updatedPlayers = updatedPlayers.map(p => 
              p.id === evaluation.winnerId ? { ...p, score: p.score + pointsAwarded } : p
          );
     }

     // Update Score History for all players (to track progression)
     updatedPlayers = updatedPlayers.map(p => ({
         ...p,
         scoreHistory: [...(p.scoreHistory || []), p.score]
     }));

     setGameState(prev => ({
          ...prev,
          players: updatedPlayers,
          round: prev.round + 1,
          storyPhase: getStoryPhase(prev.round + 1 > MAX_ROUNDS ? MAX_ROUNDS : prev.round + 1),
          draftRoundStartIndex: (prev.draftRoundStartIndex + 1) % prev.players.length,
          phase: GamePhase.ROUND_END_REVIEW,
          // Store the generated summary in the game state
          roundSummaries: [...prev.roundSummaries, summary],
          roundResult: { 
            winnerId: evaluation.winnerId, 
            reason: evaluation.reason || "The narrative shifts in unexpected ways."
          }
      }));
     setRoundReviewRevealed(false);
  };

  const endGame = async (history: StorySegment[], players: Player[]) => {
    try {
        const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
        const topScore = sortedPlayers[0].score;
        const tiedWinners = sortedPlayers.filter(p => p.score === topScore);
        
        // Strictly determine winner by score first
        // If there is a tie, we pick the first one (or could ask AI to break tie, but simple is better for consistency)
        const winner = tiedWinners[0];

        // Pass this pre-determined winner to the AI to generate the narrative explanation
        const result = await determineWinner(history, players, gameState.scenario, winner);
        
        setGameState(prev => ({
          ...prev,
          phase: GamePhase.FINISHED,
          winner: winner,
          winReason: result.reason,
          storyTitle: result.title
        }));

        if (winner) {
            generateVictoryImage(winner.name, result.reason, gameState.scenario, winner.visualDescription, winner.conditions, winner.gender)
            .then(url => {
                if (url) {
                    setGameState(prev => ({ ...prev, victoryImageUrl: url }));
                }
            })
            .catch(e => console.error("Victory image gen failed", e));
        }

        // Generate the ballad in the background
        setGameState(prev => ({ ...prev, isGeneratingBallad: true }));
        generateBallad(gameState.scenario, history, winner)
            .then(balladData => {
                if (balladData) {
                    setGameState(prev => ({ 
                        ...prev, 
                        balladAudioUrl: balladData.audioUrl,
                        balladLyrics: balladData.lyrics,
                        isGeneratingBallad: false,
                        storyHistory: [
                          ...prev.storyHistory,
                          {
                            id: crypto.randomUUID(),
                            text: "The Bards Sing:\n" + balladData.lyrics,
                            audioData: balladData.audioUrl,
                          }
                        ]
                    }));
                } else {
                    setGameState(prev => ({ ...prev, isGeneratingBallad: false }));
                }
            })
            .catch(e => {
                console.error("Ballad gen failed", e);
                setGameState(prev => ({ ...prev, isGeneratingBallad: false }));
            });
    } catch (error) {
        console.error("End game calculation failed, retrying...", error);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return endGame(history, players); // Recursive retry
    }
  };

  const resetGame = () => {
    setGlobalError(null);
    try {
      idbDel('forged_fables_autosave').then(() => {
        setHasAutoSave(false);
      }).catch(console.warn);
    } catch (e) {
      console.warn("Failed to clear auto-save", e);
    }
    setGameState({
      phase: GamePhase.LOBBY,
      players: [],
      storyHistory: [],
      currentPlayerIndex: 0,
      round: 1,
      draftOptions: [],
      draftRoundStartIndex: 0,
      knownEntities: [],
      scenario: 'General Fiction',
      storyPhase: 'Introduction',
      activeConflict: '',
      currentLocation: '',
      currentLocationDescription: '',
      activeCharacterName: undefined,
      roundSummaries: []
    });
    setNewPlayerName('');
    setDraftInputName('');
    setNameError(null);
    setViewingPlayer(null);
    setViewingLocation(false);
    setDraftGender('Male');
    setScenarioInput('');
    setRoundReviewRevealed(false);
  };
  
  const printStory = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const storyContent = gameState.storyHistory.map(seg => `
      <div class="segment">
        ${seg.playerId ? `<div class="action-header" style="color:${gameState.players.find(p => p.id === seg.playerId)?.color}"><strong>${gameState.players.find(p => p.id === seg.playerId)?.playerName}</strong> played: "<em>${seg.action}</em>"</div>` : ''}
        <p style="white-space: pre-wrap;">${seg.text}</p>
        ${seg.imageUrl ? `<img src="${seg.imageUrl}" />` : ''}
      </div>
    `).join('');

    const endingContent = gameState.phase === GamePhase.FINISHED || gameState.phase === GamePhase.ENDING ? `
      <div style="margin-top: 40px; text-align: center; border-top: 2px solid #ccc; padding-top: 20px; page-break-inside: avoid;">
        <h2>The End</h2>
        ${gameState.winner ? `<h3>Victor: ${gameState.winner.name}</h3>` : ''}
        <p><em>"${gameState.winReason || ''}"</em></p>
        ${gameState.balladLyrics ? `<div style="margin-top: 20px; font-style: italic; white-space: pre-wrap; font-family: serif;"><strong>The Ballad of ${gameState.winner?.name}</strong><br/><br/>${gameState.balladLyrics}</div>` : ''}
        ${gameState.victoryImageUrl ? `<img src="${gameState.victoryImageUrl}" style="margin-top: 20px; border-radius: 8px;" />` : ''}
      </div>
    ` : '';

    const html = `<html><head><title>${gameState.storyTitle || "Chronicle"}</title><style>body{font-family:'Georgia';padding:40px;max-width:800px;margin:auto;}img{width:100%;}.segment{margin-bottom:20px;}</style></head><body><h1>${gameState.storyTitle || "The Chronicle"}</h1>${storyContent}${endingContent}</body></html>`;
    printWindow.document.write(html);
    printWindow.document.close();
  };

  // --- Renderers ---

  const renderQueueStatus = () => {
    if (queue.length === 0) return null;
    return (
      <div className="bg-gray-900/90 border border-amber-500/30 p-4 rounded-xl shadow-2xl backdrop-blur-md w-full animate-fade-in flex-shrink-0">
        <h4 className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
            Narrative Pipeline
        </h4>
        <div className="space-y-2 max-h-48 overflow-y-auto scrollbar-hide">
            {queue.map(turn => (
                <div key={turn.id} className="flex flex-col border-b border-gray-800 pb-2 last:border-0 last:pb-0">
                    <div className="flex items-center justify-between text-sm group">
                        <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-gray-700 overflow-hidden border border-gray-600">
                            <img src={gameState.players.find(p => p.id === turn.playerId)?.avatarUrl} className="w-full h-full object-cover" />
                            </div>
                            <span className="text-gray-300 font-bold text-xs truncate max-w-[80px]">{turn.playerName}</span>
                        </div>
                        <div className="text-xs font-mono">
                            {turn.status === TurnStatus.PENDING && <span className="text-gray-500">Wait...</span>}
                            {turn.status === TurnStatus.GENERATING_TEXT && <span className="text-blue-400 animate-pulse">Writing</span>}
                            {turn.status === TurnStatus.TEXT_COMPLETE && <span className="text-purple-400">Media</span>}
                            {turn.status === TurnStatus.GENERATING_MEDIA && <span className="text-purple-400 animate-pulse">Painting</span>}
                            {turn.status === TurnStatus.READY_TO_PLAY && <span className="text-green-400">Ready</span>}
                            {turn.status === TurnStatus.PLAYING && <span className="text-green-400 font-bold">▶ Live</span>}
                            {turn.status === TurnStatus.FAILED && <span className="text-red-500 font-bold animate-pulse">FAILED</span>}
                        </div>
                    </div>
                    {/* Error Message Display */}
                    {turn.error && (
                         <div className="text-[10px] text-red-400 mt-1 pl-8 pr-1 break-words font-mono bg-red-950/20 rounded p-1">
                             {turn.error}
                         </div>
                    )}
                </div>
            ))}
        </div>
      </div>
    );
  };

  const renderCharacterModal = () => {
    if (!viewingPlayer) return null;
    return (
      <div className="fixed inset-0 z-50 flex flex-col p-4 bg-black/80 backdrop-blur-sm animate-fade-in overflow-y-auto" onClick={() => setViewingPlayer(null)}>
        <div className="my-auto m-auto bg-gray-900 border-2 border-amber-500/50 rounded-2xl max-w-2xl w-full p-6 relative shrink-0" onClick={e => e.stopPropagation()}>
          <button onClick={() => setViewingPlayer(null)} className="absolute top-4 right-4 text-gray-400 hover:text-white text-2xl">✕</button>
          <div className="flex flex-col md:flex-row gap-8 items-center md:items-start">
             <div className="w-48 h-48 md:w-64 md:h-64 landscape:w-48 landscape:h-48 rounded-xl overflow-hidden border-4 border-gray-700 shadow-2xl flex-shrink-0 relative mx-auto md:mx-0">
                <img src={viewingPlayer.avatarUrl} className="w-full h-full object-cover" />
             </div>
             <div className="flex-1 w-full">
                <h2 className="text-3xl font-display text-white" style={{color: viewingPlayer.color}}>{viewingPlayer.name}</h2>
                <p className="text-amber-100 font-serif italic text-xl mt-4">"{viewingPlayer.goal}"</p>
                {/* Conditions in Modal */}
                <div className="mt-6 flex flex-wrap gap-2">
                    {viewingPlayer.conditions?.map((c, i) => (
                        <span key={i} className="bg-gray-800 border border-gray-600 px-3 py-1 rounded-full text-sm font-bold uppercase tracking-wider text-gray-300">
                            {c}
                        </span>
                    ))}
                </div>
             </div>
          </div>
        </div>
      </div>
    );
  };

  const renderStoryModal = () => {
    if (!viewingStory) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-fade-in" onClick={() => setViewingStory(false)}>
         <div className="w-full max-w-4xl h-full max-h-[80vh] flex flex-col relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setViewingStory(false)} className="absolute -top-10 right-0 text-gray-400 hover:text-white">✕ Close</button>
            {/* StoryBook in modal does NOT auto play, preventing double audio */}
            <StoryBook segments={gameState.storyHistory} players={gameState.players} autoPlayNewSegments={false} />
         </div>
      </div>
    );
  };

  const renderDraft = () => {
    const activePlayer = gameState.players[gameState.currentPlayerIndex];
    const isCharacterDraft = [GamePhase.DRAFT_ARCHETYPE, GamePhase.DRAFT_ADJECTIVE, GamePhase.DRAFT_SUFFIX, GamePhase.DRAFT_QUEST, GamePhase.ENTER_NAME].includes(gameState.phase);
    const isRoundDraft = [GamePhase.ROUND_DRAFT_VERB, GamePhase.ROUND_DRAFT_NOUN].includes(gameState.phase);

    let title = "";
    if (gameState.phase === GamePhase.DRAFT_ARCHETYPE) title = "Class";
    else if (gameState.phase === GamePhase.DRAFT_ADJECTIVE) title = "Trait";
    else if (gameState.phase === GamePhase.DRAFT_SUFFIX) title = "Origin";
    else if (gameState.phase === GamePhase.ENTER_NAME) title = "Identity";
    else if (gameState.phase === GamePhase.DRAFT_QUEST) title = "Goal"; // Changed from Quest to Goal
    else if (gameState.phase === GamePhase.ROUND_DRAFT_VERB) title = "Action";
    else if (gameState.phase === GamePhase.ROUND_DRAFT_NOUN) title = "Subject";

    if (isGenerating || gameState.phase === GamePhase.ROUND_GENERATING || gameState.phase === GamePhase.GENERATING_PROFILE) {
       return (
           <div className="flex flex-col justify-center h-64 items-center gap-4">
               <div className="animate-spin h-16 w-16 border-4 border-purple-500 rounded-full border-t-transparent"></div>
               {loadingMessage && <div className="text-amber-200 animate-pulse text-lg">{loadingMessage}</div>}
           </div>
       );
    }
    
    const handler = isCharacterDraft && gameState.phase !== GamePhase.ENTER_NAME ? handleCharacterDraftPick : handleRoundDraftPick;

    return (
      <div className="max-w-4xl m-auto w-full p-4 animate-fade-in relative flex-1 min-h-0 overflow-y-auto">
        <h2 className="text-4xl font-display text-amber-200 mb-8 text-center">{title}</h2>
        
        {/* Active Player Banner */}
        <div 
          onClick={() => setViewingPlayer(activePlayer)}
          className="bg-gray-800/80 p-6 rounded-2xl border border-gray-600 mb-8 flex flex-col items-center cursor-pointer hover:bg-gray-700 transition-colors"
        >
            <div className="flex items-center gap-4">
                <img src={activePlayer.avatarUrl || `https://picsum.photos/seed/${activePlayer.avatarSeed}/100`} className="w-12 h-12 rounded-full border-2" style={{borderColor: activePlayer.color}}/>
                <h3 className="text-2xl font-bold text-white">{activePlayer.playerName}</h3>
            </div>
             {/* Draft Preview Logic (Character) */}
             {isCharacterDraft && (
                 <div className="text-2xl mt-4 font-serif text-gray-300">
                    {activePlayer.draftParts?.name || (gameState.phase === GamePhase.ENTER_NAME ? (draftInputName || "___") : "___")} the {activePlayer.draftParts?.adjective || "___"} {activePlayer.draftParts?.archetype || "___"} {activePlayer.draftParts?.suffix || "___"}
                 </div>
             )}

             {/* Draft Preview Logic (Round) */}
             {isRoundDraft && (
                 <div className="mt-6 flex flex-col items-center gap-2 w-full animate-fade-in">
                    <div className="w-full h-px bg-gradient-to-r from-transparent via-gray-500 to-transparent mb-2"></div>
                    <div className="text-xs text-gray-400 font-sans uppercase tracking-[0.2em] mb-2">Current Hand</div>
                    <div className="flex gap-4 flex-wrap justify-center items-center">
                        {/* Verb Slot */}
                        <div className={`px-5 py-3 rounded-lg border-2 font-display font-bold tracking-wider ${activePlayer.hand.verb ? 'bg-red-900/40 border-red-500 text-red-100 shadow-[0_0_15px_rgba(239,68,68,0.3)]' : 'bg-gray-800/50 border-gray-600 border-dashed text-gray-600 opacity-50'}`}>
                             {activePlayer.hand.verb || "ACTION"}
                        </div>
                        
                        {/* Divider */}
                         <div className="text-gray-600 text-xl"> + </div>

                        {/* Noun Slots */}
                        {activePlayer.hand.nouns.map((n, i) => (
                            <div key={i} className="px-5 py-3 rounded-lg border-2 bg-blue-900/40 border-blue-500 text-blue-100 font-display font-bold tracking-wider shadow-[0_0_15px_rgba(59,130,246,0.3)]">
                                {n}
                            </div>
                        ))}
                        
                        {/* Placeholder for Noun if currently drafting nouns */}
                        {gameState.phase === GamePhase.ROUND_DRAFT_NOUN && (
                             <div className="px-5 py-3 rounded-lg border-2 bg-gray-800/50 border-gray-600 border-dashed text-gray-500 font-display font-bold tracking-wider opacity-50 animate-pulse">
                                SUBJECT...
                            </div>
                        )}
                    </div>
                 </div>
             )}
        </div>

        {gameState.phase === GamePhase.ENTER_NAME ? (
           <div className="flex flex-col gap-4 max-w-lg mx-auto">
             <div className="flex gap-2">
               {['Male', 'Female', 'Non-binary'].map(g => (
                 <button key={g} onClick={() => setDraftGender(g)} className={`flex-1 p-2 rounded border ${draftGender === g ? 'bg-amber-600 border-amber-400' : 'bg-gray-800 border-gray-600'}`}>{g}</button>
               ))}
             </div>
             <input 
               type="text" value={draftInputName} onChange={(e) => setDraftInputName(e.target.value)} 
               placeholder="Enter Name" className="bg-gray-900 border border-amber-500 rounded p-4 text-center text-xl text-white"
               onKeyDown={(e) => e.key === 'Enter' && submitCharacterName()} autoFocus
             />
             {nameError && <div className="text-red-400 text-center">{nameError}</div>}
             <Button onClick={submitCharacterName}>Confirm</Button>
           </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {gameState.draftOptions.map((option, idx) => (
              <button key={idx} onClick={() => handler(option)} className="h-32 bg-paper text-ink rounded shadow-xl hover:scale-105 transition-all p-4 font-display font-bold">
                <TextFit text={option} maxFontSize={24} minFontSize={12} />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderGame = () => {
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    const isProcessing = gameState.phase === GamePhase.PROCESSING_TURN || gameState.phase === GamePhase.ENDING;
    const isClimax = gameState.storyPhase === 'The Climax';
    
    return (
      <div className={`w-full max-w-7xl mx-auto flex flex-1 flex-col md:flex-row gap-6 h-full min-h-0 transition-all duration-1000 p-4 rounded-xl ${isClimax ? 'bg-red-950/40 border-4 border-red-500' : ''}`}>
        <div className="w-full md:w-64 flex-shrink-0 flex flex-col gap-4 overflow-y-auto pr-2 pb-4 min-h-0">
           {renderQueueStatus()}
           <div className="p-4 rounded-lg bg-gray-900/90 border border-gray-700 text-center flex-shrink-0">
             <span className="text-xs text-gray-400 block mb-1">{getStoryPhase(gameState.round)}</span>
             <div className="text-3xl font-display text-amber-500">Round {gameState.round}</div>
             {isClimax && (
                <div className="mt-2 text-red-400 text-[10px] font-bold uppercase tracking-widest animate-pulse border border-red-500/30 rounded p-1 bg-red-950/30">
                   Double Points!
                </div>
             )}
           </div>
           
           <div 
             onClick={() => setViewingLocation(true)}
             className="relative rounded-lg bg-gray-900 border border-gray-700 text-center shadow-lg overflow-hidden group flex flex-col justify-between cursor-pointer hover:border-amber-500/50 hover:shadow-amber-500/10 transition-all duration-300 animate-fade-in flex-shrink-0"
           >
             {/* Location Image Header - showing the whole image */}
             {gameState.locationImageUrl ? (
                <div className="w-full h-24 lg:h-32 bg-slate-950 flex items-center justify-center overflow-hidden border-b border-gray-800 relative">
                     <img src={gameState.locationImageUrl} alt="Location" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                </div>
             ) : (
                <div className="w-full h-12 bg-gray-800 flex items-center justify-center border-b border-gray-700">
                     <span className="text-[10px] text-gray-500 font-mono tracking-wider">NO PREVIEW AVAILABLE</span>
                </div>
             )}

             <div className="p-4 relative">
                  <div className="text-[10px] text-amber-500 uppercase tracking-widest mb-1 font-bold">Location</div>
                  <div className="font-display font-bold text-base text-white leading-tight mb-2 drop-shadow-md line-clamp-2">
                     {gameState.currentLocation || "Unknown"}
                  </div>
                  <div className="text-xs text-gray-400 font-serif italic leading-relaxed line-clamp-3">
                     "{gameState.currentLocationDescription}"
                  </div>
                  <div className="mt-2 text-[10px] text-amber-500 font-mono opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                     Click to Zoom
                  </div>
             </div>
           </div>

           {gameState.players.map((p, idx) => (
             <PlayerCard key={p.id} player={p} isActive={(idx === gameState.currentPlayerIndex && gameState.phase === GamePhase.PLAYING)} onClick={() => setViewingPlayer(p)} />
           ))}
        </div>

        <div className="flex-1 flex flex-col gap-4 min-h-0">
          <StoryBook segments={gameState.storyHistory} players={gameState.players} isLoading={isProcessing && queue.length === 0} autoPlayNewSegments={false} />
          
          <div className="bg-gray-900/90 p-4 rounded-xl border border-gray-700 shadow-2xl relative z-10 flex flex-col justify-center flex-shrink min-h-0 overflow-y-auto">

            {gameState.phase === GamePhase.ROUND_END_REVIEW && (
               <div className="text-center w-full">
                 <h3 className="text-3xl font-display text-white mb-6">The Dust Settles</h3>
                 
                 {!roundReviewRevealed ? (
                   <div className="animate-fade-in py-2">
                      <p className="text-gray-400 mb-6 italic">The narrator has adjudicated the phase...</p>
                      <Button onClick={() => setRoundReviewRevealed(true)} className="mx-auto text-xl py-3 px-8 shadow-amber-500/20 border-amber-500/50">
                        Reveal Round Results
                      </Button>
                   </div>
                 ) : (
                   <div className="animate-fade-in space-y-6">
                      
                      {gameState.roundResult?.winnerId ? (
                        (() => {
                            const winner = gameState.players.find(p => p.id === gameState.roundResult?.winnerId);
                            if (!winner) {
                                return (
                                    <div className="py-6 px-8 rounded-xl bg-gray-950/40 border border-gray-800 max-w-3xl mx-auto text-center shadow-lg animate-fade-in">
                                        <div className="text-gray-500 text-xs font-bold uppercase tracking-[0.2em] mb-2 font-sans">Adjudication</div>
                                        <p className="text-gray-300 italic font-serif text-sm md:text-base">
                                            {gameState.roundResult?.reason || "The round concludes without a clear victor."}
                                        </p>
                                    </div>
                                );
                            }
                            const justCompletedRound = gameState.round - 1;
                            const completedPhase = getStoryPhase(justCompletedRound > 0 ? justCompletedRound : 1);
                            const pointsAwarded = completedPhase === 'The Climax' ? 2 : 1;
                            return (
                                <div className="py-6 flex flex-col items-center justify-center gap-3 bg-gradient-to-b from-amber-950/20 via-gray-900/40 to-transparent rounded-xl border border-amber-500/10 px-8 max-w-3xl mx-auto shadow-2xl animate-fade-in">
                                    <div className="flex items-center gap-2">
                                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                                        <div className="text-amber-500 text-xs font-bold uppercase tracking-[0.25em] font-sans">Quest Progressed</div>
                                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                                    </div>

                                    <div className="text-xl md:text-2xl font-display text-center leading-tight">
                                        <span style={{ color: winner.color }} className="font-semibold">{winner.name}</span>
                                        <span className="text-gray-400 text-base block mt-1 font-sans font-medium tracking-wide">
                                            the {winner.draftParts?.adjective || ''} {winner.draftParts?.archetype || ''} {winner.draftParts?.suffix || ''}
                                        </span>
                                    </div>

                                    <div className="py-3 px-5 bg-gray-950/60 rounded-lg border border-gray-800 text-center max-w-2xl">
                                        <div className="text-[10px] text-gray-500 uppercase tracking-wider font-mono mb-1">Personal Quest</div>
                                        <div className="text-white font-medium italic text-sm md:text-base">"{winner.goal}"</div>
                                    </div>
                                    
                                    <div className="text-amber-200/90 text-sm md:text-base leading-relaxed text-center mt-3 max-w-xl font-serif">
                                        <div className="text-[10px] text-amber-500/80 uppercase tracking-widest font-mono mb-2">Narrator's Adjudication</div>
                                        "{gameState.roundResult?.reason}"
                                    </div>
                                </div>
                            );
                        })()
                      ) : (
                        <div className="py-6 px-8 rounded-xl bg-gray-950/40 border border-gray-800 max-w-3xl mx-auto text-center shadow-lg animate-fade-in">
                            <div className="text-gray-500 text-xs font-bold uppercase tracking-[0.2em] mb-2 font-sans">Adjudication</div>
                            <p className="text-gray-300 italic font-serif text-sm md:text-base">
                                {gameState.roundResult?.reason || "The round concludes without a clear victor."}
                            </p>
                        </div>
                      )}

                      {/* Compact Scoreboard / Standings */}
                      <div className="max-w-3xl mx-auto pt-4 border-t border-gray-800/60">
                          <div className="text-[10px] text-gray-500 uppercase tracking-widest font-mono text-center mb-4">Current Standings</div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 justify-center">
                              {gameState.players.map((p) => {
                                  const isWinner = p.id === gameState.roundResult?.winnerId;
                                  const justCompletedRound = gameState.round - 1;
                                  const completedPhase = getStoryPhase(justCompletedRound > 0 ? justCompletedRound : 1);
                                  const pointsAwarded = completedPhase === 'The Climax' ? 2 : 1;
                                  return (
                                      <div 
                                          key={p.id}
                                          className={`relative p-3 rounded-lg border transition-all duration-300 flex items-center justify-between gap-3 ${
                                              isWinner 
                                                  ? 'bg-amber-950/10 border-amber-500/30 shadow-lg shadow-amber-500/5' 
                                                  : 'bg-gray-950/30 border-gray-800'
                                          }`}
                                          style={{ borderLeftColor: p.color, borderLeftWidth: '4px' }}
                                      >
                                          <div className="text-left min-w-0">
                                              <div className="font-sans font-semibold text-sm text-white truncate">{p.name}</div>
                                              <div className="font-mono text-[10px] text-gray-500 truncate capitalize">{p.draftParts?.archetype || 'Hero'}</div>
                                          </div>
                                          <div className="flex items-center gap-1.5 shrink-0">
                                              {isWinner && (
                                                  <span className="text-[10px] font-bold bg-amber-500 text-black px-1.5 py-0.5 rounded animate-bounce font-mono">
                                                      +{pointsAwarded}
                                                  </span>
                                              )}
                                              <span className="text-white font-mono font-bold text-lg">{p.score}</span>
                                          </div>
                                      </div>
                                  );
                              })}
                          </div>
                      </div>

                      <div className="flex justify-center pt-2">
                        <Button onClick={handleNextRoundClick} variant="secondary" className="w-full md:w-auto px-12">
                            {gameState.round > MAX_ROUNDS ? "Conclude Story" : "Begin Next Phase"}
                        </Button>
                      </div>
                   </div>
                 )}
               </div>
            )}

            {gameState.phase === GamePhase.PROCESSING_TURN && (
                <div className="flex flex-col items-center justify-center h-full">
                    {!isPlaying && queue.some(t => t.status === TurnStatus.READY_TO_PLAY) ? (
                        <div className="flex flex-col items-center animate-fade-in">
                            <Button 
                                onClick={() => {
                                    const nextReady = queue.find(t => t.status === TurnStatus.READY_TO_PLAY);
                                    if (nextReady) playTurn(nextReady);
                                }}
                                className="bg-green-600 hover:bg-green-500 text-white px-8 py-4 text-xl rounded-full shadow-[0_0_20px_rgba(34,197,94,0.4)]"
                            >
                                ▶ Play Next Action
                            </Button>
                            <p className="text-gray-400 text-sm mt-4">
                                {queue.length} actions remaining in narrative queue.
                            </p>
                        </div>
                    ) : (
                        <>
                            <div className="flex space-x-2 mb-4">
                                <div className="w-3 h-3 bg-purple-500 rounded-full animate-bounce"></div>
                                <div className="w-3 h-3 bg-purple-500 rounded-full animate-bounce delay-75"></div>
                                <div className="w-3 h-3 bg-purple-500 rounded-full animate-bounce delay-150"></div>
                            </div>
                            <p className="text-purple-200 font-display text-xl animate-pulse">
                                Weaving Destiny...
                            </p>
                            <p className="text-gray-400 text-sm mt-2">
                                {queue.length} actions remaining in narrative queue.
                            </p>
                        </>
                    )}
                </div>
            )}

            {gameState.phase === GamePhase.PLAYING && (
              <div className="flex flex-col gap-6 animate-fade-in w-full">
                <div className="flex justify-between items-end border-b border-gray-700 pb-2">
                  <h3 className="text-xl text-white font-display"><span style={{ color: currentPlayer.color }}>{currentPlayer.playerName}</span>'s Hand</h3>
                  <div className="text-amber-100 text-sm italic">{currentPlayer.goal}</div>
                </div>

                {isClimax && (
                   <div className="bg-red-900/40 border border-red-500/50 text-red-200 p-3 rounded-md text-center text-sm font-bold uppercase tracking-wider animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.2)]">
                      The Climax: Double Points Rewarded This Round!
                   </div>
                )}

                <div className="flex items-center justify-center gap-2 md:gap-4 my-2">
                   
                   {/* Card Slots */}
                   <div onClick={() => sentence.subject && toggleCard('noun', sentence.subject)} className={`h-24 md:h-32 flex-1 border-2 border-dashed rounded flex flex-col items-center justify-center cursor-pointer p-2 ${sentence.subject ? 'border-blue-400 bg-blue-900/40 text-blue-100 font-bold' : 'border-gray-600 text-gray-500'}`}>
                       <TextFit text={sentence.subject || "Subject"} maxFontSize={24} minFontSize={10} />
                   </div>
                   <div onClick={() => sentence.verb && toggleCard('verb', sentence.verb)} className={`h-24 md:h-32 flex-1 border-2 border-dashed rounded flex flex-col items-center justify-center cursor-pointer p-2 ${sentence.verb ? 'border-red-400 bg-red-900/40 text-red-100 font-bold' : 'border-gray-600 text-gray-500'}`}>
                       <TextFit text={sentence.verb || "Action"} maxFontSize={24} minFontSize={10} />
                   </div>
                   <div onClick={() => sentence.object && toggleCard('noun', sentence.object)} className={`h-24 md:h-32 flex-1 border-2 border-dashed rounded flex flex-col items-center justify-center cursor-pointer p-2 ${sentence.object ? 'border-blue-400 bg-blue-900/40 text-blue-100 font-bold' : 'border-gray-600 text-gray-500'}`}>
                       <TextFit text={sentence.object || "Target"} maxFontSize={24} minFontSize={10} />
                   </div>
                </div>
                
                <div className="flex flex-wrap justify-center gap-3">
                    {currentPlayer.hand.verb && !sentence.verb && (
                        <button onClick={() => toggleCard('verb', currentPlayer.hand.verb!)} className="h-24 w-24 md:h-32 md:w-32 bg-red-900/20 border-2 border-red-500 rounded text-red-200 font-bold hover:scale-105 transition-all p-2">
                            <TextFit text={currentPlayer.hand.verb} maxFontSize={20} minFontSize={10} />
                        </button>
                    )}
                    {currentPlayer.hand.nouns.map((noun, i) => {
                       if (sentence.subject === noun || sentence.object === noun) return null;
                       return (
                           <button key={i} onClick={() => toggleCard('noun', noun)} className="h-24 w-24 md:h-32 md:w-32 bg-blue-900/20 border-2 border-blue-500 rounded text-blue-300 font-bold hover:scale-105 transition-all p-2">
                               <TextFit text={noun} maxFontSize={20} minFontSize={10} />
                           </button>
                       );
                    })}
                </div>

                <Button onClick={submitTurn} disabled={!sentence.subject || !sentence.verb || !sentence.object} className="w-full mt-2">Execute Move</Button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };
  
  const renderLocationModal = () => {
    if (!viewingLocation) return null;
    return (
      <div 
        className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in" 
        onClick={() => setViewingLocation(false)}
      >
        <div 
          className="bg-gray-900 border-2 border-amber-500/50 rounded-2xl max-w-2xl w-full p-6 relative shadow-2xl overflow-y-auto max-h-[90vh]" 
          onClick={e => e.stopPropagation()}
        >
          <button 
            onClick={() => setViewingLocation(false)} 
            className="absolute top-4 right-4 text-gray-400 hover:text-white text-2xl transition-colors"
          >
            ✕
          </button>
          
          <div className="flex flex-col gap-6 items-center">
             <h2 className="text-3xl font-display text-amber-200 text-center border-b border-gray-800 pb-2 w-full">
                {gameState.currentLocation || "Unknown Lands"}
             </h2>

             {gameState.locationImageUrl && (
                <div className="flex justify-center relative shadow-lg mx-auto">
                    <img 
                      src={gameState.locationImageUrl} 
                      alt="Location" 
                      className="w-auto h-auto max-w-full max-h-[45vh] md:max-h-[50vh] landscape:max-h-[45vh] object-contain rounded-xl border border-gray-800" 
                      referrerPolicy="no-referrer"
                    />
                </div>
             )}

             <div className="space-y-4 text-center w-full">
                 <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                    Description
                 </div>
                 <p className="text-base text-gray-300 font-serif leading-relaxed italic max-w-xl mx-auto">
                    "{gameState.currentLocationDescription}"
                 </p>

                 {gameState.activeConflict && (
                     <div className="pt-4 border-t border-gray-800/80">
                         <div className="text-[10px] text-amber-500 uppercase tracking-widest font-bold mb-2">
                            Active Conflict
                         </div>
                         <p className="text-sm text-amber-100 font-serif leading-relaxed max-w-xl mx-auto">
                            {gameState.activeConflict}
                         </p>
                     </div>
                 )}
             </div>
             
             <Button onClick={() => setViewingLocation(false)} className="mt-2 px-8">
                Return to Game
             </Button>
          </div>
        </div>
      </div>
    );
  };

  const renderOverviewModal = () => {
    if (!viewingOverview) return null;
    return (
      <div className="fixed inset-0 z-50 flex flex-col p-4 bg-black/90 backdrop-blur-md animate-fade-in overflow-y-auto" onClick={() => setViewingOverview(false)}>
         <div className="my-auto m-auto w-full max-w-2xl bg-gray-900 border border-amber-500/50 rounded-2xl p-8 relative shadow-2xl shrink-0" onClick={e => e.stopPropagation()}>
            <button onClick={() => setViewingOverview(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white text-2xl">✕</button>
            <h2 className="text-3xl font-display text-amber-500 mb-6 border-b border-gray-700 pb-2">How to Play Forged Fables</h2>
            <div className="space-y-4 text-gray-300">
                <p>Welcome to <strong>Forged Fables</strong>, a collaborative storytelling game powered by AI.</p>
                <ul className="list-disc pl-5 space-y-2 mb-4">
                    <li><strong>Gather Players:</strong> Add 2 to 6 players and pick a scenario for your story.</li>
                    <li><strong>Draft Characters:</strong> Each player crafts a character by selecting an Archetype, Adjective, Origin, Quest, and Name.</li>
                    <li><strong>Play Your Hand:</strong> During your turn, construct a sentence using your hand of noun and verb cards to describe the action of the <strong>active character</strong>. The active character is the one most recently acting or mentioned in the story. At the start of the game, the active character is chosen at random. Note that the active character you are instructing to act may not necessarily be your own character. The AI as Narrative Director will resolve your action and generate a new piece of the story.</li>
                    <li><strong>The Climax:</strong> The third round is the Climax! Points awarded during this critical moment are doubled.</li>
                    <li><strong>Reach the Goal:</strong> Guide the story toward your character's personal Goal to claim victory at the end of the Epilogue! You can achieve this world state through your own actions, environmental factors, or even the actions of other players.</li>
                </ul>
                <p className="italic text-sm text-amber-200 mt-4">May your story become legendary!</p>
            </div>
            <div className="mt-8 flex justify-center">
                <Button onClick={() => setViewingOverview(false)}>Ready to Play</Button>
            </div>
         </div>
      </div>
    );
  };

  const renderLobby = () => (
    <div className="max-w-2xl m-auto w-full p-8 bg-gray-900/80 rounded-2xl border border-gray-700 animate-fade-in flex-1 min-h-0 overflow-y-auto">
      <h1 className="text-5xl font-display text-center text-amber-200 mb-8">Forged Fables</h1>
      <div className="space-y-6">
             <input type="text" placeholder="Scenario" value={scenarioInput} onChange={(e) => setScenarioInput(e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded px-4 py-3 text-white"/>
             <div className="flex gap-4"><input type="text" placeholder="Player Name" value={newPlayerName} onChange={(e) => setNewPlayerName(e.target.value)} className="flex-1 bg-gray-900 border border-gray-600 rounded px-4 py-3 text-white" onKeyDown={(e) => e.key === 'Enter' && addPlayer()}/> <Button onClick={addPlayer} disabled={gameState.players.length >= 6}>Join</Button></div>
        <div className="grid grid-cols-2 gap-3">{gameState.players.map((p) => (<div key={p.id} className="flex justify-between bg-gray-800 p-3 rounded border border-gray-700 text-white"><span>{p.playerName}</span><button onClick={() => removePlayer(p.id)} className="text-red-400">✕</button></div>))}</div>
        <div className="flex flex-col gap-4 pt-4 border-t border-gray-800">
            {hasAutoSave && (
                <Button onClick={loadAutoSave} className="w-full text-lg py-3 bg-blue-700 hover:bg-blue-600 border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.3)]">
                    Continue Last Game
                </Button>
            )}
            <Button onClick={() => setViewingOverview(true)} variant="secondary" className="w-full text-lg py-3 border-amber-500/30 text-amber-200 hover:bg-amber-900/20">How to Play</Button>
            <Button onClick={startCharacterDraft} disabled={gameState.players.length < 2 || isGenerating} className="w-full text-lg py-4 shadow-[0_0_15px_rgba(245,158,11,0.3)]">Begin Character Draft</Button>
        </div>
      </div>
    </div>
  );

  const renderLocationIntro = () => {
    return (
      <div className="max-w-4xl m-auto w-full p-4 py-8 animate-fade-in relative flex-1 min-h-0 overflow-y-auto flex flex-col">
        <div className="my-auto w-full flex flex-col items-center">
          <h2 className="text-5xl font-display text-amber-200 mb-6 text-center pt-2">{gameState.currentLocation || "Unknown Lands"}</h2>
          
          {gameState.locationImageUrl && (
            <div className="flex justify-center mb-8 relative shrink-0 mx-auto group">
              <img src={gameState.locationImageUrl} alt="Location Background" className="w-auto h-auto max-w-full max-h-[45vh] md:max-h-[50vh] landscape:max-h-[45vh] object-contain rounded-2xl shadow-2xl border-2 border-amber-900/50" referrerPolicy="no-referrer" />
              <div className="absolute inset-0 z-20 bg-gradient-to-t from-gray-900 via-transparent to-transparent opacity-80 pointer-events-none rounded-2xl" />
            </div>
          )}
          
        <div className="max-w-2xl text-center mb-12">
            <p className="text-xl text-gray-300 leading-relaxed mb-6 font-serif">
                {gameState.currentLocationDescription}
            </p>
            {gameState.activeConflict && (
                <p className="text-xl text-amber-100 leading-relaxed font-serif border-t border-amber-900/30 pt-6">
                    <span className="block text-sm text-amber-500 uppercase tracking-widest font-bold mb-2">The Setup</span>
                    {gameState.activeConflict}
                </p>
            )}
          </div>

          <Button 
             className="text-2xl px-12 py-6 bg-amber-700 hover:bg-amber-600 border-amber-500 text-white rounded-full shadow-[0_0_20px_rgba(217,119,6,0.3)] hover:shadow-[0_0_40px_rgba(217,119,6,0.5)] transition-all font-display tracking-wider"
             onClick={() => startRoundDraft(gameState.players)}
          >
             Begin The Tale
          </Button>
        </div>
      </div>
    );
  };

  const renderFinished = () => (
    <div className="max-w-4xl m-auto w-full p-8 md:p-12 bg-gray-900/95 rounded-2xl border-2 border-amber-500 text-center animate-fade-in flex-1 min-h-0 overflow-y-auto shadow-2xl relative">
      <h1 className="text-2xl font-display text-amber-500 mb-2 tracking-widest uppercase">The End</h1>
      <h2 className="text-4xl md:text-5xl font-serif text-white mb-10 leading-tight border-b border-gray-700 pb-8">{gameState.storyTitle}</h2>
      
      {gameState.winner && (
        <div className="mb-12">
            <h3 className="text-lg text-amber-200/60 uppercase tracking-widest mb-1">Victor</h3>
            <h2 className="text-3xl font-display text-white mb-8">{gameState.winner.name}</h2>
            
            <div className="relative">
                <span className="absolute -top-6 left-0 text-6xl text-gray-700 opacity-50 font-serif">"</span>
                <p className="text-lg md:text-xl text-gray-300 font-serif leading-relaxed italic max-w-3xl mx-auto z-10 relative mt-4">
                    {gameState.winReason}
                </p>
                <span className="absolute -bottom-8 right-0 text-6xl text-gray-700 opacity-50 font-serif">"</span>
            </div>
        </div>
      )}

      {/* Scoreboard */}
      <div className="bg-gray-800/80 p-6 rounded-xl mb-12 text-left w-full max-w-2xl mx-auto border border-gray-700">
          <h3 className="text-xl font-display text-amber-500 mb-4 border-b border-gray-700 pb-2">Final Scoreboard</h3>
          <div className="space-y-4">
            {gameState.players.sort((a,b) => b.score - a.score).map((p, i) => (
              <div key={p.id} className="flex items-center justify-between">
                 <div className="flex items-center gap-4">
                    <span className="text-gray-500 font-mono w-4 font-bold">{i+1}.</span>
                    <span className="text-white font-serif md:text-lg">{p.name} <span className="text-gray-500 text-sm ml-2 font-sans truncate hidden sm:inline-block max-w-[200px]">({p.playerName})</span></span>
                 </div>
                 <div className="flex items-center gap-6">
                    <div className="flex gap-2">
                        {p.scoreHistory?.map((s, idx) => (
                            <span key={idx} className="text-xs text-gray-500 w-4 text-center border-b border-gray-700 pb-1" title={`Round ${idx+1}`}>{s}</span>
                        ))}
                    </div>
                    <span className="text-accent font-bold text-2xl w-8 text-right drop-shadow-md">{p.score}</span>
                 </div>
              </div>
            ))}
          </div>
      </div>

      {gameState.isGeneratingBallad && !gameState.balladAudioUrl && !gameState.balladLyrics && (
        <div className="bg-gray-800/80 p-6 rounded-xl mb-12 text-center w-full max-w-2xl mx-auto border border-gray-700 animate-pulse mt-auto">
           <h3 className="text-xl font-display text-amber-500 mb-2">Composing the Ballad of {gameState.winner?.name}...</h3>
           <p className="text-gray-400 italic font-serif">The bards are singing the tale into existence.</p>
        </div>
      )}

      {(gameState.balladAudioUrl || gameState.balladLyrics) && (
        <div className="bg-gray-800/80 p-6 rounded-xl mb-12 text-center w-full max-w-2xl mx-auto border border-gray-700 mt-auto">
           <h3 className="text-xl font-display text-amber-500 mb-4">The Ballad of {gameState.winner?.name}</h3>
           {gameState.balladAudioUrl && (
               <audio controls src={gameState.balladAudioUrl} className="w-full mb-4" />
           )}
           {gameState.balladLyrics && (
               <div className="text-gray-300 italic whitespace-pre-wrap font-serif text-sm border-t border-gray-700 pt-4">
                   {gameState.balladLyrics}
               </div>
           )}
        </div>
      )}

      {gameState.victoryImageUrl && (
          <div className="flex justify-center mb-12 relative mx-auto w-full max-w-2xl">
              <img src={gameState.victoryImageUrl} alt="Victory" className="w-auto h-auto max-w-full max-h-[45vh] md:max-h-[50vh] landscape:max-h-[45vh] object-contain rounded-xl border-4 border-amber-500/30 shadow-[0_0_30px_rgba(245,158,11,0.15)]" />
          </div>
      )}

      <div className="flex gap-6 justify-center mt-auto pb-4">
        <Button onClick={printStory} variant="secondary" className="px-8 py-3 text-lg border-amber-500/50">Print Legend</Button>
        <Button onClick={resetGame} className="px-8 py-3 text-lg">Begin Anew</Button>
      </div>
    </div>
  );

  if (!hasCustomKey) {
    return (
      <div className="h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-gray-800 via-gray-900 to-black p-4 md:p-8 flex flex-col items-center justify-center overflow-hidden">
        <div className="w-full max-w-xl bg-gray-900/70 border border-amber-500/20 rounded-2xl p-8 md:p-10 shadow-2xl text-center">
          <h2 className="text-2xl md:text-3xl font-black text-amber-100 mb-3 tracking-tight">Enter Your Gemini API Key</h2>
          <p className="text-sm text-gray-400 mb-6 leading-relaxed">
            Forged Fables writes your story, illustrates it, and reads it aloud as you play, so it needs a Gemini API key to run.
            Get a free one at <span className="text-amber-300 font-medium">aistudio.google.com</span> — it's saved only in this browser, never sent anywhere but Google.
          </p>
          <input
            type="password"
            value={apiKeyInput}
            onChange={(e) => { setApiKeyInput(e.target.value); setApiKeyInputError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && handleSaveApiKey()}
            placeholder="Paste your API key..."
            autoFocus
            className="w-full bg-black/30 border-2 border-amber-500/20 rounded-xl px-4 py-3 text-base text-white focus:outline-none focus:border-amber-500 transition-all mb-3"
          />
          {apiKeyInputError && <p className="text-red-400 text-sm mb-3">{apiKeyInputError}</p>}
          <Button onClick={handleSaveApiKey} className="w-full py-4 text-lg">Save &amp; Continue</Button>
          <p className="text-xs text-gray-500 mt-4">
            Note: Lyria (the victory ballad music) needs a paid Gemini tier — everything else works on a free key.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-gray-800 via-gray-900 to-black p-4 md:p-8 flex flex-col overflow-hidden">
      {globalError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-red-900 border border-red-500 text-red-100 px-6 py-3 rounded-lg shadow-2xl flex items-center gap-4 animate-fade-in">
          <span>{globalError}</span>
          <button onClick={() => setGlobalError(null)} className="text-red-300 hover:text-white font-bold ml-2 text-xl">&times;</button>
        </div>
      )}
      
      {renderCharacterModal()}
      {renderStoryModal()}
      {renderOverviewModal()}
      {renderLocationModal()}
      {gameState.phase === GamePhase.LOBBY && renderLobby()}
      {([GamePhase.DRAFT_ARCHETYPE, GamePhase.DRAFT_ADJECTIVE, GamePhase.DRAFT_SUFFIX, GamePhase.DRAFT_QUEST, GamePhase.ENTER_NAME, GamePhase.ROUND_DRAFT_VERB, GamePhase.ROUND_DRAFT_NOUN, GamePhase.ROUND_GENERATING, GamePhase.GENERATING_PROFILE].includes(gameState.phase)) && renderDraft()}
      {gameState.phase === GamePhase.LOADING_INTRO && renderLocationIntro()}
      {(gameState.phase === GamePhase.PLAYING || gameState.phase === GamePhase.READING_HISTORY || gameState.phase === GamePhase.PROCESSING_TURN || gameState.phase === GamePhase.ENDING || gameState.phase === GamePhase.ROUND_END_REVIEW) && renderGame()}
      {gameState.phase === GamePhase.FINISHED && renderFinished()}
    </div>
  );
};

export default App;