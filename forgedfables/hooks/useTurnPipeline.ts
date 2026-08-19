
import React, { useState, useEffect, useRef } from 'react';
import { QueuedTurn, TurnStatus, StorySegment, Player, ConditionUpdate } from '../types';
import { generateTurnResult, generateSpeech, generateStoryImage, playRawAudio } from '../services/geminiService';
import { v4 as uuidv4 } from 'uuid';

export const useTurnPipeline = (
  players: Player[],
  setPlayers: React.Dispatch<React.SetStateAction<Player[]>>,
  storyHistory: StorySegment[],
  setStoryHistory: React.Dispatch<React.SetStateAction<StorySegment[]>>,
  knownEntities: string[],
  setKnownEntities: React.Dispatch<React.SetStateAction<string[]>>,
  scenario: string,
  currentLocation: string | undefined,
  currentLocationDescription: string | undefined,
  activeConflict: string | undefined,
  storyPhase: string,
  roundSummaries: string[]
) => {
  const [queue, setQueue] = useState<QueuedTurn[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Refs for async context to avoid stale closures
  const historyRef = useRef(storyHistory);
  historyRef.current = storyHistory;
  
  const playersRef = useRef(players);
  playersRef.current = players;
  
  const roundSummariesRef = useRef(roundSummaries);
  useEffect(() => {
      roundSummariesRef.current = roundSummaries;
  }, [roundSummaries]);

  // --- 1. QUEUE MANAGER ---
  useEffect(() => {
    // SEQUENTIAL TEXT GENERATION:
    // Only process a PENDING turn if all turns before it have generated their text.
    // This allows the AI to see the "future" history of unplayed turns.

    const pendingIndex = queue.findIndex(t => t.status === TurnStatus.PENDING);
    if (pendingIndex !== -1) {
        const turnToProcess = queue[pendingIndex];
        
        // Check previous turn status
        const prevTurn = pendingIndex > 0 ? queue[pendingIndex - 1] : null;
        
        // We can proceed if:
        // 1. There is no previous turn in queue (it's the head)
        // 2. OR The previous turn has finished text generation (resultText exists)
        // 3. OR The previous turn FAILED (so we don't block the line)
        const isReadyToProcess = !prevTurn || (
            (prevTurn.resultText || prevTurn.status === TurnStatus.FAILED) && 
            prevTurn.status !== TurnStatus.GENERATING_TEXT &&
            prevTurn.status !== TurnStatus.PENDING
        );

        if (isReadyToProcess) {
            // Build projected history: Committed History + Text from queued items before this one
            // Exclude FAILED items from history context
            const queuedHistorySegments: StorySegment[] = queue
                .slice(0, pendingIndex)
                .filter(t => t.status !== TurnStatus.FAILED) 
                .map(t => ({
                    id: t.id,
                    text: t.resultText || "",
                    playerId: t.playerId,
                    action: t.action,
                    dialogueType: t.dialogueType,
                    // Mock other fields
                } as StorySegment));
            
            processTextGeneration(turnToProcess, queuedHistorySegments);
        }
    }

    // Media generation can happen as soon as text is ready
    queue.forEach(turn => {
      if (turn.status === TurnStatus.TEXT_COMPLETE) {
        processMediaGeneration(turn);
      }
    });
  }, [queue]); // Depend on queue changes

  // --- 2. PLAYBACK MANAGER ---
  // The playback manager no longer plays automatically.
  // We expose playTurn for manual triggering from the UI.
  
  // --- PROCESSING LOGIC ---

  const addTurn = (player: Player, subject: string, verb: string, object: string, contextActiveCharacter?: string) => {
    const newTurn: QueuedTurn = {
      id: uuidv4(),
      playerId: player.id,
      playerName: player.playerName,
      action: `${subject} ${verb} ${object}`,
      cardSubject: subject,
      cardVerb: verb,
      cardObject: object,
      contextActiveCharacter: contextActiveCharacter, // SNAPSHOT the active character
      status: TurnStatus.PENDING,
      retryCount: 0
    };
    setQueue(prev => [...prev, newTurn]);
  };

  const updateTurnStatus = (id: string, updates: Partial<QueuedTurn>) => {
    setQueue(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const processTextGeneration = async (turn: QueuedTurn, projectedQueueHistory: StorySegment[]) => {
    updateTurnStatus(turn.id, { status: TurnStatus.GENERATING_TEXT, error: undefined });

    try {
      const player = playersRef.current.find(p => p.id === turn.playerId)!;
      
      const subject = turn.cardSubject || turn.action.split(' ')[0];
      const verb = turn.cardVerb || turn.action.split(' ')[1];
      const object = turn.cardObject || turn.action.split(' ').slice(2).join(' ');

      const fullContextHistory = [...historyRef.current, ...projectedQueueHistory];

      const previousSummary = roundSummariesRef.current.length > 0 
          ? roundSummariesRef.current.join("\n") 
          : undefined;

      const result = await generateTurnResult(
        fullContextHistory,
        player,
        subject,
        verb,
        object,
        playersRef.current, 
        scenario,
        currentLocation,
        activeConflict,
        storyPhase,
        turn.contextActiveCharacter,
        previousSummary
      );

      updateTurnStatus(turn.id, { 
        status: TurnStatus.TEXT_COMPLETE,
        resultText: result.text,
        newEntities: result.newEntities,
        removedEntities: result.removedEntities,
        conditionUpdates: result.conditionUpdates,
        dialogueType: result.dialogueType
      });
    } catch (e: any) {
      console.error("Text Gen Failed", e);
      const newRetryCount = (turn.retryCount || 0) + 1;
      const errorMessage = e.message || "Unknown error";
      
      if (newRetryCount > 3) {
          // Permanently Failed
          updateTurnStatus(turn.id, { 
             status: TurnStatus.FAILED, 
             error: `Failed: ${errorMessage}` 
          });
          
          // Remove from queue after delay so user can read error
          setTimeout(() => {
              setQueue(prev => prev.filter(t => t.id !== turn.id));
          }, 8000); 

      } else {
          // Retry Logic
          // Reset to PENDING to retry after a short delay
          setTimeout(() => {
              updateTurnStatus(turn.id, { 
                  status: TurnStatus.PENDING,
                  retryCount: newRetryCount,
                  error: `Retrying (${newRetryCount}/3)... ${errorMessage.substring(0, 30)}`
              });
          }, 2000);
      }
    }
  };

  const processMediaGeneration = async (turn: QueuedTurn) => {
    updateTurnStatus(turn.id, { status: TurnStatus.GENERATING_MEDIA });

    let audioData: string | undefined;
    let imageUrl: string | undefined;

    try {
        // Always attempt image generation as it uses a different quota
        const imagePromise = generateStoryImage(
            turn.resultText!, 
            scenario, 
            currentLocationDescription, 
            playersRef.current // Use ref so we always have the latest array of players
        );
        
        // Generate audio and image
        const audioPromise = generateSpeech(turn.resultText!);
        
        const [imageResult, audioResult] = await Promise.allSettled([imagePromise, audioPromise]);
        
        if (imageResult.status === 'fulfilled') imageUrl = imageResult.value;
        if (audioResult.status === 'fulfilled') audioData = audioResult.value;
    } catch (e) {
        console.warn("Media generation partial failure");
    }

    updateTurnStatus(turn.id, {
      status: TurnStatus.READY_TO_PLAY,
      audioData,
      imageUrl
    });
  };

  const playTurn = async (turn: QueuedTurn) => {
    setIsPlaying(true);
    updateTurnStatus(turn.id, { status: TurnStatus.PLAYING });

    // 1. Add to visible story history
    const player = playersRef.current.find(p => p.id === turn.playerId);
    const newSegment: StorySegment = {
        id: turn.id,
        text: turn.resultText!,
        action: turn.action,
        playerId: turn.playerId,
        characterName: player ? player.name : 'Narrator',
        imageUrl: turn.imageUrl,
        audioData: turn.audioData,
        dialogueType: turn.dialogueType
    };
    
    setStoryHistory(prev => [...prev, newSegment]);

    // 2. Commit Game State Changes (Entities)
    if (turn.newEntities || turn.removedEntities) {
        const destroyedSet = new Set(
             (turn.removedEntities || [])
                .filter(e => e && typeof e === 'string')
                .map(e => e.toLowerCase().trim())
        );
        
        setKnownEntities(prev => {
             const cleanPrev = prev.map(s => s.trim()).filter(s => s.length > 0);
             const cleanNew = (turn.newEntities || []).map(s => s.trim()).filter(s => s.length > 0);
             const combined = [...cleanPrev, ...cleanNew];
             const seen = new Set<string>();
             const unique: string[] = [];
             
             combined.forEach(item => {
                 const lower = item.toLowerCase();
                 if (!seen.has(lower) && !destroyedSet.has(lower)) {
                     seen.add(lower);
                     unique.push(item);
                 }
             });
             
             return unique;
        });
    }

    // 3. Commit Player Conditions
    if (turn.conditionUpdates && turn.conditionUpdates.length > 0) {
        setPlayers(currentPlayers => {
            return currentPlayers.map(p => {
                // Defensive filtering
                const updates = turn.conditionUpdates?.filter(u => {
                    if (!u || !u.characterName) return false;
                    const uName = String(u.characterName).toLowerCase();
                    const pName = p.name ? p.name.toLowerCase() : '';
                    const pShort = p.shortName ? p.shortName.toLowerCase() : '';

                    return (pName && uName.includes(pName)) ||
                           (pShort && uName.includes(pShort));
                });

                if (!updates || updates.length === 0) return p;

                let currentConditions = [...(p.conditions || [])];
                updates.forEach(u => {
                    if (!u.condition) return;
                    if (u.type === 'add') {
                        // Check if the condition is already in the list (case-insensitive)
                        const condLower = String(u.condition).toLowerCase();
                        const exists = currentConditions.some(c => String(c).toLowerCase() === condLower);
                        if (!exists) {
                            // Enforce maximum of 3 conditions.
                            // If they already have 3 conditions, remove the oldest one (index 0).
                            if (currentConditions.length >= 3) {
                                currentConditions.shift();
                            }
                            currentConditions.push(u.condition);
                        }
                    } else if (u.type === 'remove') {
                        const uCond = String(u.condition).toLowerCase();
                        currentConditions = currentConditions.filter(existing => {
                            const exLower = String(existing).toLowerCase();
                            return !(exLower.includes(uCond) || uCond.includes(exLower));
                        });
                    }
                });

                return { ...p, conditions: currentConditions };
            });
        });
    }

    // 4. Handle Playback Timing
    if (turn.audioData) {
      try {
        await playRawAudio(turn.audioData);
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (e) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } else {
      const wordCount = (turn.resultText || "").split(' ').length;
      const readingTime = Math.max(2000, Math.min(8000, wordCount * 200)); 
      await new Promise(resolve => setTimeout(resolve, readingTime));
    }

    // 5. Cleanup
    updateTurnStatus(turn.id, { status: TurnStatus.COMPLETED });
    setQueue(prev => prev.filter(t => t.id !== turn.id)); 
    setIsPlaying(false); 
  };

  return { addTurn, queue, isPlaying, playTurn };
};
