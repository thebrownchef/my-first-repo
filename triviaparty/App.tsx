
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Difficulty, GameState, TriviaQuestion } from './types';
import { GENRES } from './constants';
import { generateTriviaQuestion, generateTriviaAudio, prefetchTriviaQuestion, exportHistory, importHistory, getConnectorAudio, getForTheWinAudio, getStoredApiKey, setStoredApiKey, clearStoredApiKey } from './services/geminiService';
import { Button } from './components/Button';
import { LoadingSpinner } from './components/LoadingSpinner';
import { DifficultyBadge } from './components/DifficultyBadge';
import { motion } from 'motion/react';
import confetti from 'canvas-confetti';
import { Trophy, Sparkles, Medal, Crown, Play, Music } from 'lucide-react';

interface LastTurnResult {
  isCorrect: boolean;
  correctAnswer: string;
  explanation: string;
}

const App: React.FC = () => {
  // Game State
  const [gameState, setGameState] = useState<GameState>(GameState.PLAYER_SETUP);
  const [difficulty, setDifficulty] = useState<Difficulty>(Difficulty.EASY);
  const [genre, setGenre] = useState<string>('');
  
  // Player State
  const [players, setPlayers] = useState<{id: number, name: string, score: number}[]>([]);
  const [topicPickerIndex, setTopicPickerIndex] = useState<number>(0);
  const [activePlayerIndex, setActivePlayerIndex] = useState<number>(0);
  const [availableOptions, setAvailableOptions] = useState<string[]>([]);
  const [playerNameAudios, setPlayerNameAudios] = useState<Record<string, string>>({});
  
  // Pipeline State
  const [bufferedQuestion, setBufferedQuestion] = useState<{ diff: Difficulty, q: TriviaQuestion } | null>(null);
  const [isGeneratingNext, setIsGeneratingNext] = useState<boolean>(false);
  const [fetchingDiff, setFetchingDiff] = useState<Difficulty | null>(null);
  
  // Current Question State
  const [question, setQuestion] = useState<TriviaQuestion | null>(null);
  const [userAnswer, setUserAnswer] = useState<string>('');
  const [isAnswerRevealed, setIsAnswerRevealed] = useState<boolean>(false);
  const [isCorrect, setIsCorrect] = useState<boolean>(false);
  const [currentQuestionAttempts, setCurrentQuestionAttempts] = useState<number>(0);
  const [attemptedPlayerIndices, setAttemptedPlayerIndices] = useState<number[]>([]);
  
  // History and Results
  const [lastTurnResult, setLastTurnResult] = useState<LastTurnResult | null>(null);
  const [customGenreInput, setCustomGenreInput] = useState<string>('');
  const [isMusicPlaying, setIsMusicPlaying] = useState<boolean>(false);

  // Refs
  const [currentQuestionAudio, setCurrentQuestionAudio] = useState<string | null>(null);
  const [isQuotaReached, setIsQuotaReached] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasCustomKey, setHasCustomKey] = useState<boolean>(() => !!getStoredApiKey());
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [apiKeyInputError, setApiKeyInputError] = useState<string>('');
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioRequestIdRef = useRef<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const fetchingRef = useRef<Set<Difficulty>>(new Set());

  const handleSaveApiKey = () => {
    if (!apiKeyInput.trim()) {
      setApiKeyInputError('Paste your Gemini API key to continue.');
      return;
    }
    setStoredApiKey(apiKeyInput);
    setHasCustomKey(true);
    setApiKeyInputError('');
    setIsQuotaReached(false);
  };

  const handleForgetApiKey = () => {
    clearStoredApiKey();
    setHasCustomKey(false);
    setApiKeyInput('');
  };

  // Prefetch player name audio once players are finalized
  useEffect(() => {
    if (gameState !== GameState.PLAYER_SETUP && gameState !== GameState.PLAYER_NAMING && players.length > 0 && !isQuotaReached) {
      players.forEach(async (p) => {
        if (p.name && !playerNameAudios[p.name]) {
          try {
            const { data } = await generateTriviaAudio(`Question for ${p.name}. `);
            if (data) {
              setPlayerNameAudios(prev => ({
                ...prev,
                [p.name]: data
              }));
            }
          } catch (e) {
            console.warn("Failed to prefetch player name audio:", e);
          }
        }
      });
    }
  }, [players, gameState, isQuotaReached]);

useEffect(() => {
    if (gameState === GameState.VICTORY) {
      const timerId = setTimeout(() => {
        const duration = 5 * 1000;
        const end = Date.now() + duration;

        const frame = () => {
          confetti({
            particleCount: 5,
            angle: 60,
            spread: 55,
            origin: { x: 0 },
            colors: ['#4f46e5', '#10b981', '#f59e0b']
          });
          confetti({
            particleCount: 5,
            angle: 120,
            spread: 55,
            origin: { x: 1 },
            colors: ['#4f46e5', '#10b981', '#f59e0b']
          });

          if (Date.now() < end) {
            requestAnimationFrame(frame);
          }
        };
        frame();
      }, 2000);

      // Autoplay attempt for victory audio
      setIsMusicPlaying(true);
      
      return () => clearTimeout(timerId);
    } else {
      setIsMusicPlaying(false);
    }
  }, [gameState, genre]);


  const getAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  };

  const stopAudio = (incrementId: boolean = true) => {
    if (incrementId) audioRequestIdRef.current += 1;
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.onended = null;
        currentSourceRef.current.stop();
      } catch (e) {}
      currentSourceRef.current = null;
    }
  };

  const decodePCM = (base64Data: string, ctx: AudioContext): AudioBuffer => {
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    const pcm16 = new Int16Array(bytes.buffer);
    const buffer = ctx.createBuffer(1, pcm16.length, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < pcm16.length; i++) channelData[i] = pcm16[i] / 32768.0;
    return buffer;
  };

  const playAudio = (base64Data: string, onEnded?: () => void): void => {
    if (!base64Data) {
      onEnded?.();
      return;
    }
    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') ctx.resume();
      stopAudio(false);
      const buffer = decodePCM(base64Data, ctx);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => {
        currentSourceRef.current = null;
        onEnded?.();
      };
      source.start(0);
      currentSourceRef.current = source;
    } catch (e) {
      console.error("Playback error", e);
      onEnded?.();
    }
  };

  const applyQuestion = useCallback((nextQ: TriviaQuestion) => {
    setQuestion(nextQ);
    setUserAnswer('');
    setIsAnswerRevealed(false);
    setIsCorrect(false);
    setCurrentQuestionAttempts(0);
    setAttemptedPlayerIndices([]);
    setAvailableOptions(nextQ.options || []);
    setCurrentQuestionAudio(null);

}, []);

  const fetchQuestion = useCallback(async (diff: Difficulty, currentGenre: string, applyImmediately: boolean) => {
    if (fetchingDiff) return; // Prevent concurrent fetches
    
    setIsGeneratingNext(true);
    setFetchingDiff(diff);
    setLoadError(null);

    try {
      const newQuestion = await generateTriviaQuestion(currentGenre, diff);
      
      const isQuotaNow = newQuestion.questionText.includes("429") || newQuestion.questionText.toLowerCase().includes("quota");
      if (isQuotaNow) {
         setIsQuotaReached(true);
         return;
      }

      let qAudio: { data: string | null, error?: string } = { data: null, error: "" };
      let aAudio: { data: string | null, error?: string } = { data: null, error: "" };
      
      if (!isQuotaReached) {
        const promises: Promise<any>[] = [];
        if (!newQuestion.questionAudio) {
          let qText = newQuestion.questionText;
          if (newQuestion.options && newQuestion.options.length > 0) {
            qText += " Is it: " + newQuestion.options.join(", ") + "?";
          }
          promises.push(generateTriviaAudio(qText).then(res => qAudio = res));
        }
        if (!newQuestion.answerAudio) {
          promises.push(generateTriviaAudio(`${newQuestion.correctAnswer}. ${newQuestion.explanation}`).then(res => aAudio = res));
        }
        if (promises.length > 0) {
          await Promise.allSettled(promises);
        }
      }

      if (qAudio.error === "QUOTA_EXCEEDED" || aAudio.error === "QUOTA_EXCEEDED") {
         setIsQuotaReached(true);
      }

      const questionWithAudio: TriviaQuestion = {
        ...newQuestion,
        questionAudio: newQuestion.questionAudio || qAudio.data || undefined,
        answerAudio: newQuestion.answerAudio || aAudio.data || undefined
      };
      
      if (applyImmediately) {
         applyQuestion(questionWithAudio);
      } else {
         setBufferedQuestion({ diff, q: questionWithAudio });
      }
    } catch (error: any) {
      console.error(`Failed to fetch ${diff} question:`, error);
      if (applyImmediately) {
         setLoadError(error?.message || "Couldn't load a question. Please try again.");
      }
    } finally {
      setIsGeneratingNext(false);
      setFetchingDiff(null);
    }
  }, [fetchingDiff, isQuotaReached, applyQuestion]);

  // Loading Pipeline Effect
  useEffect(() => {
    if (gameState === GameState.PLAYING && genre && !isQuotaReached) {
       if (!question) {
          if (bufferedQuestion && bufferedQuestion.diff === difficulty) {
             applyQuestion(bufferedQuestion.q);
             setBufferedQuestion(null);
          } else if (fetchingDiff !== difficulty) {
             fetchQuestion(difficulty, genre, true);
          }
       } else {
          let nextDiff: Difficulty | null = null;
          if (difficulty === Difficulty.EASY) nextDiff = Difficulty.MEDIUM;
          else if (difficulty === Difficulty.MEDIUM) nextDiff = Difficulty.HARD;
          
          if (nextDiff) { prefetchTriviaQuestion(genre, nextDiff); if (!bufferedQuestion || bufferedQuestion.diff !== nextDiff) {
             if (fetchingDiff !== nextDiff) {
                // Introduce a small delay to avoid spamming the API immediately after a question loads
                const timer = setTimeout(() => {
                  fetchQuestion(nextDiff, genre, false);
                }, 500);
                return () => clearTimeout(timer);
             }
          }
          }
       }
    }
  }, [gameState, genre, difficulty, question, bufferedQuestion, fetchingDiff, fetchQuestion, isQuotaReached, applyQuestion]);

  const startGame = async (selectedGenre: string) => {
    getAudioContext();
    setGenre(selectedGenre);
    setDifficulty(Difficulty.EASY);
    setActivePlayerIndex(topicPickerIndex);
    setGameState(GameState.PLAYING);
    setQuestion(null);
    setLastTurnResult(null);
    setBufferedQuestion(null);
    setFetchingDiff(null);
  };

  const handleSelectOption = async (selectedOption: string) => {
    if (isAnswerRevealed || !question) return;
    
    setLastTurnResult(null);
    stopAudio(); 
    setIsAnswerRevealed(true);
    setUserAnswer(selectedOption);
    
    const isMatch = selectedOption === question.correctAnswer;
    setIsCorrect(isMatch);
    
    const newOptions = availableOptions.filter(o => o !== selectedOption);
    let nextActiveIndex = (activePlayerIndex + 1) % players.length;
    let newAttempted: number[] = [];
    // Pre-calculate next player for use in proceed()
    if (!isMatch && newOptions.length > 1) {
       newAttempted = [...attemptedPlayerIndices, activePlayerIndex];
       const eligiblePlayers = players.map((p, i) => ({ p, i })).filter(({ i }) => !newAttempted.includes(i));
       if (eligiblePlayers.length > 0) {
         eligiblePlayers.sort((a, b) => a.p.score - b.p.score);
         nextActiveIndex = eligiblePlayers[0].i;
       }
    }

    const proceed = () => {
      if (isMatch || (difficulty === Difficulty.HARD) || (availableOptions.length <= 2 && !isMatch)) {
        setLastTurnResult({
          isCorrect: isMatch,
          correctAnswer: question.correctAnswer,
          explanation: question.explanation
        });
      } else {
         setLastTurnResult(null);
      }

      if (isMatch) {
        // Award points
        const basePoints = difficulty === Difficulty.EASY ? 3 : (difficulty === Difficulty.MEDIUM ? 4 : 5);
        const points = Math.max(1, basePoints - currentQuestionAttempts);
        const newPlayers = [...players];
        newPlayers[activePlayerIndex].score += points;
        
        if (newPlayers[activePlayerIndex].score >= 20) {
           setPlayers(newPlayers);
           setGameState(GameState.VICTORY);
           return;
        }

        if (difficulty === Difficulty.HARD) {
           // Turn over, next topic picker
           // Rearrange turn order every turn: least points to most points.
           // Move current picker to the end before sorting to cycle through ties fairly.
           let reordered = [...newPlayers];
           const currentPicker = reordered.splice(topicPickerIndex, 1)[0];
           reordered.push(currentPicker);
           reordered.sort((a, b) => a.score - b.score);
           
           setPlayers(reordered);
           setTopicPickerIndex(0);
           setGameState(GameState.WELCOME);
        } else {
           setPlayers(newPlayers);
           const nextDiff = difficulty === Difficulty.EASY ? Difficulty.MEDIUM : Difficulty.HARD;
           setDifficulty(nextDiff);
           setIsAnswerRevealed(false);
           setQuestion(null); // This triggers the pipeline effect to apply the buffered question or fetch a new one
        }
      } else {
        // Incorrect
        setCurrentQuestionAttempts(prev => prev + 1);
        
        if (newOptions.length <= 1) {
           // Only one option left, no one gets points, next topic picker
           // Rearrange turn order every turn: least points to most points.
           let reordered = [...players];
           const currentPicker = reordered.splice(topicPickerIndex, 1)[0];
           reordered.push(currentPicker);
           reordered.sort((a, b) => a.score - b.score);
           
           setPlayers(reordered);
           setTopicPickerIndex(0);
           setGameState(GameState.WELCOME);
        } else {
           // Pass to next player
           setAttemptedPlayerIndices(newAttempted);
           setAvailableOptions(newOptions);
           setActivePlayerIndex(nextActiveIndex);
           setIsAnswerRevealed(false);
        }
      }
    };

    const playAndProceed = (audio: string) => {
      playAudio(audio, () => {
        setTimeout(proceed, 800);
      });
    };

    if (isMatch || availableOptions.length <= 2) {
      if (question.answerAudio) {
        playAndProceed(question.answerAudio);
      } else if (isQuotaReached) {
        playAndProceed("");
      } else {
        const text = `${question.correctAnswer}. ${question.explanation}`;
        generateTriviaAudio(text).then(({ data, error }) => {
          if (error === "QUOTA_EXCEEDED") setIsQuotaReached(true);
          if (data) playAndProceed(data);
          else playAndProceed("");
        });
      }
    } else {
      proceed();
    }
  };



  // Audio for the question text
  useEffect(() => {
    if (question && gameState === GameState.PLAYING && !isAnswerRevealed && !isQuotaReached) {
      const timer = setTimeout(async () => {
        const requestId = ++audioRequestIdRef.current;
        
        const activePlayer = players[activePlayerIndex];
        const basePoints = difficulty === Difficulty.EASY ? 3 : (difficulty === Difficulty.MEDIUM ? 4 : 5);
        const possiblePoints = Math.max(1, basePoints - currentQuestionAttempts);
        const isForWin = activePlayer.score + possiblePoints >= 20;

        let nameAudio = playerNameAudios[activePlayer.name];
        if (!nameAudio) {
            try {
              const { data } = await generateTriviaAudio(`Question for ${activePlayer.name}. `);
              if (data) {
                setPlayerNameAudios(prev => ({ ...prev, [activePlayer.name]: data }));
                nameAudio = data;
              }
            } catch (e) {
               console.warn(e);
            }
        }
        
        if (requestId !== audioRequestIdRef.current) return;
        
        const seq: string[] = [];
        if (nameAudio) seq.push(nameAudio);
        
        if (isForWin) {
           const ftw = await getForTheWinAudio();
           if (ftw) seq.push(ftw);
        }
        
        if (question.questionStemAudio) {
           seq.push(question.questionStemAudio);
           if (question.optionAudios && availableOptions.length > 0) {
              const connector = await getConnectorAudio();
              availableOptions.forEach((opt, idx) => {
                const optAud = question.optionAudios![opt];
                if (optAud) {
                  seq.push(optAud);
                  if (idx < availableOptions.length - 1 && connector) {
                    seq.push(connector);
                  }
                }
              });
           }
        } else if (question.questionAudio) {
           // Fallback to legacy single clip if stem isn't present
           seq.push(question.questionAudio);
        }
        
        if (requestId !== audioRequestIdRef.current) return;
        
        let seqIndex = 0;
        const playNext = () => {
           if (requestId !== audioRequestIdRef.current) return;
           if (seqIndex < seq.length) {
             const audio = seq[seqIndex++];
             playAudio(audio, playNext);
           } else {
             if (inputRef.current) inputRef.current.focus();
           }
        };
        
        playNext();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [question, gameState, isAnswerRevealed, isQuotaReached, players, activePlayerIndex, availableOptions, difficulty, currentQuestionAttempts, playerNameAudios]);

  const restartGame = () => {
    stopAudio();
    setGameState(GameState.PLAYER_SETUP);
    setDifficulty(Difficulty.EASY);
    setQuestion(null);
    setLastTurnResult(null);
    setGenre('');
    setIsQuotaReached(false);
    setPlayers([]);
    setTopicPickerIndex(0);
    setActivePlayerIndex(0);
  };

  const handleExportHistory = async () => {
    try {
      const data = await exportHistory();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `trivia-history-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Failed to export history");
    }
  };

  const handleImportHistory = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const text = ev.target?.result as string;
        await importHistory(text);
        alert("History imported successfully!");
      } catch (err) {
        alert("Failed to import history. Make sure it's a valid JSON file.");
      }
      // Reset input
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  const Scoreboard = () => (
    <div className="flex flex-wrap justify-center gap-2 md:gap-4 mb-4 md:mb-8">
      {players.map((p, i) => {
        const isHigh = p.score >= 15;
        const isActive = (i === activePlayerIndex && gameState === GameState.PLAYING) || (i === topicPickerIndex && gameState === GameState.WELCOME);
        
        let boxClasses = 'border-white/20 bg-white/10 backdrop-blur-md';
        if (isHigh) {
          boxClasses = 'border-amber-400 bg-gradient-to-b from-amber-500/30 to-orange-600/30 shadow-[0_0_25px_rgba(245,158,11,0.5)]';
        } else if (isActive) {
          boxClasses = 'border-cyan-400 bg-cyan-400/20 shadow-[0_0_15px_rgba(34,211,238,0.4)]';
        }

        return (
          <motion.div 
            key={p.id} 
            animate={isHigh ? { y: [-4, 4, -4], rotate: [-3, 3, -3] } : isActive ? { scale: [1, 1.05, 1] } : {}}
            transition={isHigh ? { duration: 2.5, repeat: Infinity, ease: "easeInOut" } : isActive ? { duration: 1, repeat: Infinity } : {}}
            className={`px-3 py-2 md:px-5 md:py-3 rounded-xl border-2 transition-all ${boxClasses} relative overflow-hidden`}
          >
            {isHigh && <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/30 to-white/0 animate-[shimmer_2s_infinite] mix-blend-overlay"></div>}
            <div className="text-[10px] md:text-xs font-black text-white/80 uppercase flex items-center justify-center gap-1.5 relative z-10">
              {isHigh && <Crown className="w-3 h-3 md:w-4 md:h-4 text-amber-300 drop-shadow-[0_0_5px_rgba(251,191,36,0.8)]" />}
              {p.name}
            </div>
            <div className="text-xl md:text-2xl font-black text-white text-center drop-shadow-md relative z-10">{p.score} <span className="text-xs md:text-sm text-white/70">pts</span></div>
          </motion.div>
        );
      })}
    </div>
  );

  return (
    <div className="relative w-full min-h-screen font-sans bg-fuchsia-950 text-white selection:bg-pink-500/30">
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-900 via-purple-950 to-violet-950"></div>
        <div className="absolute top-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full bg-pink-500/30 blur-[120px] animate-pulse"></div>
        <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-orange-500/20 blur-[120px]"></div>
      </div>

      {!hasCustomKey ? (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 md:p-6 text-center max-w-xl mx-auto z-10 relative">
          <div className="glass-panel p-6 md:p-10 rounded-3xl md:rounded-[2.5rem] shadow-2xl border-white/5 w-full animate-[slideUp_0.6s_ease-out]">
            <h2 className="text-2xl md:text-3xl font-black text-white mb-3 tracking-tight">Enter Your Gemini API Key</h2>
            <p className="text-sm text-slate-400 mb-6 leading-relaxed">
              Trivia Party generates a fresh question and reads it aloud every round, so it needs a Gemini API key to run.
              Get a free one at <span className="text-pink-300 font-medium">aistudio.google.com</span> — it's saved only in this browser, never sent anywhere but Google.
            </p>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => { setApiKeyInput(e.target.value); setApiKeyInputError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveApiKey()}
              placeholder="Paste your API key..."
              autoFocus
              className="w-full bg-white/5 border-2 border-white/10 rounded-xl px-4 py-3 text-base text-white focus:outline-none focus:border-pink-500 transition-all mb-3"
            />
            {apiKeyInputError && <p className="text-rose-400 text-sm mb-3">{apiKeyInputError}</p>}
            <Button onClick={handleSaveApiKey} className="w-full py-4 text-lg font-bold rounded-2xl bg-pink-600 hover:bg-pink-500 text-white shadow-lg shadow-pink-500/20">
              Save & Continue
            </Button>
          </div>
        </div>
      ) : gameState === GameState.PLAYER_SETUP && (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 md:p-6 text-center max-w-2xl mx-auto z-10 relative">
          <div className="mb-8 md:mb-12 space-y-2 md:space-y-4 animate-[fadeIn_0.8s_ease-out]">
            <h1 className="text-5xl sm:text-7xl md:text-9xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-pink-200 drop-shadow-2xl">
              TRIVIA PARTY
            </h1>
            <p className="text-sm sm:text-xl text-pink-300 font-bold tracking-widest uppercase opacity-90 drop-shadow-md">
              The Ultimate Multiplayer Showdown
            </p>
          </div>
          <div className="glass-panel p-6 md:p-10 rounded-3xl md:rounded-[2.5rem] shadow-2xl border-white/5 w-full animate-[slideUp_0.6s_ease-out]">
            <h2 className="text-2xl md:text-4xl font-black text-white mb-6 md:mb-8 tracking-tight">How many players?</h2>
            <div className="flex flex-col sm:flex-row justify-center gap-4 mb-8">
              {[2, 3, 4].map(num => (
                <Button 
                  key={num} 
                  onClick={() => {
                    const newPlayers = Array.from({length: num}, (_, i) => ({ id: i + 1, name: '', score: 0 }));
                    setPlayers(newPlayers);
                    setTopicPickerIndex(0);
                    setGameState(GameState.PLAYER_NAMING);
                  }}
                  className="py-4 md:py-6 px-8 text-xl md:text-2xl font-bold rounded-2xl w-full sm:w-auto"
                >
                  {num} Players
                </Button>
              ))}
            </div>
            
            <div className="mt-8 flex flex-col sm:flex-row justify-center gap-4 border-t border-white/10 pt-8">
              <button onClick={handleExportHistory} className="text-sm text-pink-300 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-4 py-2 rounded-xl">
                Export History
              </button>
              <label className="text-sm text-pink-300 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-4 py-2 rounded-xl cursor-pointer">
                Import History
                <input type="file" accept=".json" onChange={handleImportHistory} className="hidden" />
              </label>
            </div>
          </div>
        </div>
      )}

      {gameState === GameState.PLAYER_NAMING && (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 md:p-6 text-center max-w-2xl mx-auto z-10 relative">
          <div className="glass-panel p-6 md:p-10 rounded-3xl md:rounded-[2.5rem] shadow-2xl border-white/5 w-full animate-[slideUp_0.6s_ease-out]">
            <h2 className="text-2xl md:text-4xl font-black text-white mb-6 md:mb-8 tracking-tight">Enter Player Names</h2>
            <div className="flex flex-col gap-4 mb-8">
              {players.map((p, i) => (
                <div key={p.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <span className="text-lg md:text-xl font-bold text-slate-400 sm:w-24 text-left sm:text-right">Player {i + 1}</span>
                  <input
                    type="text"
                    autoFocus={i === 0}
                    value={p.name}
                    onChange={(e) => {
                      const newPlayers = [...players];
                      newPlayers[i].name = e.target.value;
                      setPlayers(newPlayers);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && i === players.length - 1) {
                        const finalizedPlayers = players.map((p, j) => ({
                          ...p,
                          name: p.name.trim() || `Player ${j + 1}`
                        }));
                        setPlayers(finalizedPlayers);
                        setGameState(GameState.WELCOME);
                      }
                    }}
                    className="flex-1 bg-white/5 border-2 border-white/10 rounded-xl px-4 py-3 text-base md:text-lg text-white focus:outline-none focus:border-pink-500 transition-all"
                    placeholder="Enter name..."
                  />
                </div>
              ))}
            </div>
            <Button
              onClick={() => {
                const finalizedPlayers = players.map((p, i) => ({
                  ...p,
                  name: p.name.trim() || `Player ${i + 1}`
                }));
                setPlayers(finalizedPlayers);
                setGameState(GameState.WELCOME);
              }}
              className="w-full py-4 text-xl font-bold rounded-2xl bg-pink-600 hover:bg-pink-500 text-white shadow-lg shadow-pink-500/20"
            >
              LET'S GO!
            </Button>
          </div>
        </div>
      )}

      {gameState === GameState.WELCOME && (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 md:p-6 pb-32 text-center max-w-4xl mx-auto z-10 relative">
          <Scoreboard />

          <div className="w-full glass-panel p-6 md:p-10 rounded-3xl md:rounded-[2.5rem] shadow-2xl border-white/5 animate-[slideUp_0.6s_ease-out]">
            <div className="flex flex-col md:flex-row justify-between items-center mb-6 md:mb-8 gap-4">
              <h2 className="text-xl md:text-2xl font-bold text-white/90 text-center md:text-left">{players[topicPickerIndex]?.name}, Choose Your Realm</h2>
              <button
                onClick={handleForgetApiKey}
                className="text-[10px] font-black tracking-widest px-3 py-1.5 rounded-lg border transition-all shrink-0 bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
                title="Remove the saved key from this browser"
              >
                API KEY ACTIVE — CHANGE
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4 mb-8 md:mb-10">
              {GENRES.map((g) => {
                const isRandom = g === "Random";
                return (
                  <button 
                    key={g} 
                    onClick={() => startGame(g)} 
                    className={`group relative p-3 sm:p-5 rounded-xl sm:rounded-2xl transition-all duration-300 ${isRandom ? 'col-span-2 md:col-span-4 bg-pink-600 hover:bg-pink-500 text-white font-bold tracking-widest shadow-xl shadow-pink-500/20 active:scale-95 text-base sm:text-lg' : 'bg-white/5 hover:bg-white/10 border border-white/5 hover:border-pink-500/50'}`}
                  >
                    <span className={`relative z-10 ${isRandom ? '' : 'font-semibold text-slate-300 group-hover:text-white text-sm sm:text-base leading-tight block'}`}>{g}</span>
                  </button>
                );
              })}
            </div>

            <div className="pt-6 md:pt-8 border-t border-white/5">
              <div className="flex flex-col md:flex-row gap-3">
                <input type="text" value={customGenreInput} onChange={(e) => setCustomGenreInput(e.target.value)} placeholder="Specific Topic (e.g. Renaissance Art)" className="flex-1 bg-white/5 border border-white/10 rounded-xl sm:rounded-2xl px-4 py-3 sm:px-6 sm:py-4 text-sm sm:text-base text-white placeholder-white/50 focus:outline-none focus:border-pink-500 focus:bg-white/10 transition-all" onKeyDown={(e) => e.key === 'Enter' && customGenreInput.trim() && startGame(customGenreInput)} />
                <Button onClick={() => startGame(customGenreInput)} disabled={!customGenreInput.trim()} className="px-6 py-3 sm:px-10 rounded-xl sm:rounded-2xl w-full md:w-auto">Start</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {gameState === GameState.PLAYING && (
        <div className="min-h-screen flex flex-col items-center justify-center p-2 sm:p-4 md:p-8 max-w-3xl mx-auto w-full relative z-10">
          <div className="w-full flex flex-col sm:flex-row justify-between items-center mb-4 md:mb-6 bg-white/5 backdrop-blur-xl p-4 rounded-3xl border border-white/10 gap-4">
            <div className="flex items-center gap-4">
              <button onClick={restartGame} className="text-sm font-bold text-slate-500 hover:text-white transition-colors flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                ABORT
              </button>
              {isQuotaReached && (
                <div className="flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/20 rounded-full">
                  <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse"></div>
                  <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">Quota Reached</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-4">
              {currentQuestionAudio && (
                <button onClick={() => playAudio(currentQuestionAudio)} className="p-2.5 rounded-full text-indigo-400 bg-indigo-400/10 hover:bg-indigo-400/20 transition-colors" title="Replay question audio">
                  <Play className="w-5 h-5 fill-current" />
                </button>
              )}
              <div className="flex flex-col items-end">
                <DifficultyBadge difficulty={difficulty} />
                <span className="text-[8px] font-bold text-slate-500 mt-1 uppercase tracking-widest">
                  {difficulty === Difficulty.EASY ? 'Common Knowledge' : difficulty === Difficulty.MEDIUM ? 'Enthusiast' : 'Expert Niche'}
                </span>
              </div>
            </div>
          </div>

          {lastTurnResult && (
            <div className={`w-full mb-6 p-6 rounded-3xl border animate-[fadeIn_0.5s_ease-out] backdrop-blur-md ${lastTurnResult.isCorrect ? "bg-emerald-500/5 border-emerald-500/20" : "bg-rose-500/5 border-rose-500/20"}`}>
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-2 h-2 rounded-full ${lastTurnResult.isCorrect ? "bg-emerald-400" : "bg-rose-400"}`}></div>
                <span className={`font-bold text-xs uppercase tracking-[0.2em] ${lastTurnResult.isCorrect ? "text-emerald-400" : "text-rose-400"}`}>
                  {lastTurnResult.isCorrect ? "Validated" : "Incorrect"}
                </span>
                <span className="text-white/20">|</span>
                <span className="text-slate-300 text-sm font-medium">ANSWER: <span className="text-white font-bold">{lastTurnResult.correctAnswer}</span></span>
              </div>
              <p className="text-slate-400 text-sm leading-relaxed italic">"{lastTurnResult.explanation}"</p>
            </div>
          )}

          {!question ? (
            <div className="flex flex-col items-center py-20 text-center w-full">
              <Scoreboard />
              <div className="mt-12">
                {isQuotaReached ? (
                <>
                  <div className="mb-6 p-4 rounded-full bg-amber-500/10 text-amber-500">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">API Quota Reached</h3>
                  <p className="text-slate-400 max-w-md">The free tier API limits have been exhausted. Please wait a moment, or configure your own Gemini API key to continue without limits.</p>
                </>
              ) : loadError ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="mb-2 p-4 rounded-full bg-rose-500/10 text-rose-500">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  </div>
                  <h3 className="text-xl font-bold text-white">Something went wrong</h3>
                  <p className="text-slate-400 max-w-md text-center">{loadError}</p>
                  <Button onClick={() => fetchQuestion(difficulty, genre, true)} variant="primary" className="mt-4">
                    Retry
                  </Button>
                </div>
              ) : (
                <>
                  <LoadingSpinner />
                  <p className="mt-4 text-xs font-bold tracking-[0.3em] text-pink-400 uppercase animate-pulse">Formulating Question...</p>
                </>
              )}
              </div>
            </div>
          ) : (
            <div className="w-full space-y-4 md:space-y-6 animate-[fadeIn_0.4s_ease-out]">
              <div className="glass-panel p-6 md:p-10 rounded-[2rem] md:rounded-[3rem] shadow-2xl relative overflow-hidden border-white/5">
                <div className="absolute top-0 left-0 h-1.5 w-full bg-white/5">
                  <div className={`h-full transition-all duration-1000 ${difficulty === Difficulty.HARD ? 'bg-rose-500' : difficulty === Difficulty.MEDIUM ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: difficulty === Difficulty.HARD ? '100%' : difficulty === Difficulty.MEDIUM ? '66%' : '33%' }}></div>
                </div>
                
                <div className="mb-6 md:mb-8">
                   <Scoreboard />
                </div>

                <div className="mb-4 flex justify-between items-center">
                  <div className="flex items-center gap-2 md:gap-3 flex-wrap">
                    <span className="text-[10px] md:text-xs font-black tracking-[0.3em] text-cyan-400 uppercase">{genre} • {players[activePlayerIndex]?.name}'s Turn</span>
                    <span className="text-[10px] md:text-xs font-black tracking-[0.2em] text-amber-400 uppercase bg-amber-400/10 px-2 py-1 md:px-3 md:py-1 rounded-full">
                      {Math.max(1, (difficulty === Difficulty.EASY ? 3 : difficulty === Difficulty.MEDIUM ? 4 : 5) - currentQuestionAttempts)} PTS
                    </span>
                  </div>
                  {isGeneratingNext && <span className="text-[8px] md:text-[10px] font-bold text-slate-500 animate-pulse uppercase tracking-widest">Preparing Next...</span>}
                </div>
                <h2 className="text-xl sm:text-2xl md:text-4xl font-bold text-white leading-[1.3] md:leading-[1.2] mb-6 md:mb-10">{question.questionText}</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 mt-6 md:mt-8">
                  {availableOptions.map((opt, i) => (
                    <Button 
                      key={i} 
                      onClick={() => handleSelectOption(opt)} 
                      disabled={isAnswerRevealed} 
                      className={`p-4 md:p-6 text-base md:text-lg rounded-2xl transition-all ${
                        isAnswerRevealed 
                          ? (opt === userAnswer 
                              ? (isCorrect ? 'bg-emerald-500 border-emerald-400 shadow-lg' : 'bg-rose-500 border-rose-400 shadow-lg') 
                              : (isCorrect ? 'bg-white/5 border-white/10 opacity-50' : 'bg-white/5 border-white/10')) 
                          : 'bg-white/5 border-white/10 hover:border-pink-500 hover:bg-white/10'
                      }`}
                    >
                      {opt}
                    </Button>
                  ))}
                </div>
              </div>

              {isAnswerRevealed && (
                <div className={`p-8 rounded-[2.5rem] glass-panel border-l-4 transition-all duration-500 ${isCorrect ? 'border-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.1)]' : 'border-rose-500 shadow-[0_0_30px_rgba(244,63,94,0.1)]'}`}>
                  <div className="flex items-center gap-4 mb-4">
                    <span className={`text-sm font-black tracking-widest uppercase ${isCorrect ? 'text-emerald-400' : 'text-rose-400'}`}>{isCorrect ? 'Verified' : 'Incorrect'}</span>
                    {!isCorrect && availableOptions.length <= 2 && <span className="text-slate-300 font-medium">Correct: <span className="text-white font-bold">{question.correctAnswer}</span></span>}
                  </div>
                  
                  {isCorrect || availableOptions.length <= 2 ? (
                    <p className="text-lg text-slate-200 leading-relaxed font-medium">{question.explanation}</p>
                  ) : (
                    <p className="text-lg text-slate-200 leading-relaxed font-medium">Passing to the next player...</p>
                  )}
                  
                  <div className="mt-8 flex items-center gap-3">
                    <div className="flex gap-1">
                      <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce"></div>
                      <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                      <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                    </div>
                    <span className="text-[10px] font-black tracking-[0.3em] text-cyan-400 uppercase">
                      {isCorrect && difficulty === Difficulty.HARD ? 'Turn Over' : isCorrect ? 'Leveling Up' : availableOptions.length <= 2 ? 'Turn Over' : 'Switching Players'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {gameState === GameState.VICTORY && (
        <div className="min-h-screen flex flex-col items-center justify-center p-4 md:p-6 text-center z-10 relative">
          <motion.div 
            initial={{ scale: 0.8, opacity: 0, y: 50 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: "spring", bounce: 0.5, duration: 0.8 }}
            className="glass-panel p-8 md:p-16 rounded-[2rem] md:rounded-[4rem] shadow-[0_0_100px_rgba(79,70,229,0.2)] max-w-2xl border-white/10 w-full"
          >
            <motion.div 
              initial={{ scale: 0 }}
              animate={{ scale: 1, rotate: [0, -10, 10, -10, 10, 0] }}
              transition={{ delay: 0.3, duration: 1 }}
              className="mb-6 md:mb-8 inline-block p-4 md:p-6 rounded-full bg-emerald-500/20 text-emerald-400 border-4 border-emerald-500/30"
            >
              <Trophy className="w-12 h-12 md:w-20 md:h-20 text-yellow-300 drop-shadow-md" />
            </motion.div>
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="text-5xl md:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-pink-400 to-yellow-300 mb-4 md:mb-6 bg-[length:200%_auto] animate-[gradient_3s_linear_infinite]"
            >
              WINNER!
            </motion.h1>
            <motion.p 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.9 }}
              className="text-base md:text-xl text-white/90 mb-8 md:mb-12"
            >
              <strong className="text-white text-2xl md:text-4xl block mb-2 md:mb-3 font-black drop-shadow-[0_0_15px_rgba(255,255,255,0.4)]">{players.find(p => p.score >= 30)?.name} is the ultimate trivia champion!</strong>
              They dominated the category of <span className="text-cyan-400 font-bold">{genre}</span>.
            </motion.p>
            
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.0 }}
              className="mb-8 md:mb-12 w-full max-w-sm mx-auto bg-white/5 rounded-2xl p-4 md:p-6 border border-white/10"
            >
              <h3 className="text-sm font-bold tracking-[0.2em] text-pink-400 uppercase mb-4">Final Standings</h3>
              <div className="flex flex-col gap-3">
                {[...players].sort((a, b) => b.score - a.score).map((p, idx) => (
                  <div key={p.id} className="flex justify-between items-center bg-white/5 rounded-lg px-4 py-3">
                    <span className="font-bold text-white flex items-center gap-2">
                      <span className="text-white/50 text-xs w-4">{idx + 1}.</span> {p.name}
                    </span>
                    <span className="font-black text-cyan-400">{p.score} <span className="text-xs text-white/50">pts</span></span>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.2 }}
            >
              <Button onClick={restartGame} className="px-8 py-4 md:px-12 md:py-5 text-lg md:text-xl font-bold rounded-2xl shadow-pink-500/40 hover:shadow-pink-500/60 transition-all bg-pink-600 hover:bg-pink-500 text-white w-full sm:w-auto">PLAY AGAIN</Button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1.4 }}
              className="mt-6 flex flex-col items-center gap-3"
            >
              <button
                onClick={() => setIsMusicPlaying(!isMusicPlaying)}
                className="inline-flex items-center gap-2 bg-gradient-to-r from-pink-500/20 to-purple-500/20 hover:from-pink-500/35 hover:to-purple-500/35 border border-pink-500/30 px-5 py-2.5 rounded-full transition-all active:scale-95 text-white shadow-md shadow-pink-500/10"
              >
                <Music className={`w-4 h-4 text-pink-400 ${isMusicPlaying ? 'animate-bounce' : ''}`} />
                <span className="text-xs font-bold text-pink-300 tracking-wider uppercase">
                  {isMusicPlaying ? '🔊 Pause Victory Groove' : '🔇 Play Victory Groove'}
                </span>
              </button>
              <span className="text-[10px] font-medium text-white/40 uppercase tracking-widest">
                Now Playing: Sweet Victory
              </span>
            </motion.div>
            
            {isMusicPlaying && (
              <iframe 
                width="0" 
                height="0" 
                src="https://www.youtube.com/embed/GC5E8ie2pdM?autoplay=1&start=63" 
                frameBorder="0" 
                allow="autoplay" 
                className="hidden"
              />
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default App;
