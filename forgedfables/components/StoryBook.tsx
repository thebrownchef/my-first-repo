import React, { useEffect, useRef, useState } from 'react';
import { StorySegment, Player } from '../types';
import { generateSpeech, playRawAudio } from '../services/geminiService';

interface StoryBookProps {
  segments: StorySegment[];
  players: Player[];
  isLoading?: boolean;
  autoPlayNewSegments?: boolean;
}

export const StoryBook: React.FC<StoryBookProps> = ({ segments, players, isLoading, autoPlayNewSegments = false }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const lastPlayedSegmentIdRef = useRef<string | null>(
    segments.length > 0 ? segments[segments.length - 1].id : null
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [segments, isLoading]);

  const getPlayerColor = (id: string) => {
    const p = players.find(pl => pl.id === id);
    return p ? p.color : '#888'; 
  };

  const getPlayerName = (id: string) => {
    return players.find(p => p.id === id)?.playerName || 'Unknown Player';
  };

  const handlePlayAudio = async (text: string, id: string, existingAudioData?: string) => {
    if (playingId) return; 

    setErrorId(null);
    setErrorMessage(null);
    setPlayingId(id);

    try {
      if (existingAudioData) {
          // Play pre-generated audio from pipeline
          await playRawAudio(existingAudioData);
      } else {
          // Generate on demand (legacy/fallback)
          const base64Audio = await generateSpeech(text);
          if (base64Audio) {
            await playRawAudio(base64Audio);
          } else {
            throw new Error("No audio returned");
          }
      }
    } catch (e: any) {
      console.error("Audio playback failed:", e);
      setErrorId(id);
      
      const isQuota = e.message?.includes("429") || e.message?.includes("quota");
      const isServerErr = e.message?.includes("500") || e.message?.includes("INTERNAL");

      if (isQuota) setErrorMessage("Daily TTS quota exceeded.");
      else if (isServerErr) setErrorMessage("Server error.");
      else setErrorMessage("Audio failed.");
    } finally {
      setPlayingId(null);
    }
  };

  // Auto-play logic for new segments
  useEffect(() => {
    if (!autoPlayNewSegments) return;
    
    if (segments.length > 0) {
        const lastSegment = segments[segments.length - 1];
        
        if (lastSegment.id !== lastPlayedSegmentIdRef.current) {
            lastPlayedSegmentIdRef.current = lastSegment.id;
            // Attempt auto-play. Browser may block if no interaction.
            handlePlayAudio(lastSegment.text, lastSegment.id, lastSegment.audioData).catch(() => {
              console.log("Auto-play blocked by browser");
            });
        }
    }
  }, [segments, autoPlayNewSegments]);

  return (
    <div className="w-full flex-1 flex flex-col min-h-0 bg-paper text-ink rounded-lg shadow-2xl overflow-hidden relative border-[8px] border-gray-800">
      <div className="absolute inset-0 pointer-events-none opacity-10 bg-[url('https://www.transparenttextures.com/patterns/aged-paper.png')]"></div>
      
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 md:px-6 pt-6 pb-2 font-serif text-lg md:text-xl leading-relaxed scroll-smooth flex flex-col"
      >
        <h1 className="text-3xl font-display text-center mb-8 border-b-2 border-ink/20 pb-4">The Chronicle</h1>
        
        {segments.map((segment, idx) => (
          <div key={segment.id} className={`animate-fade-in group ${idx === segments.length - 1 ? 'mb-2' : 'mb-10'}`}>
            <div className="flex justify-between items-start mb-2">
               {segment.playerId ? (
                 <div className="flex items-center gap-2 text-sm font-bold font-sans uppercase tracking-widest opacity-70"
                      style={{ color: getPlayerColor(segment.playerId) }}>
                   <span>✦ {getPlayerName(segment.playerId)}'s Action:</span>
                   <span className="italic normal-case font-serif opacity-100 text-ink">"{segment.action}"</span>
                 </div>
               ) : <span></span>}
               
               <div className="flex flex-col items-end">
                   <button 
                     onClick={() => handlePlayAudio(segment.text, segment.id, segment.audioData)}
                     disabled={!!playingId}
                     className={`ml-2 p-1 rounded-full transition-all ${playingId === segment.id ? 'text-accent animate-pulse' : 'text-ink/30 hover:text-accent hover:bg-ink/5'}`}
                     title="Read Aloud"
                   >
                     {playingId === segment.id ? (
                       <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                         <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.414z" clipRule="evenodd" />
                       </svg>
                     ) : (
                       <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                         <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                       </svg>
                     )}
                   </button>
                   {errorId === segment.id && (
                       <span className="text-[10px] text-danger font-sans bg-danger/10 px-1 rounded mt-1 whitespace-nowrap">
                           ⚠️ {errorMessage}
                       </span>
                   )}
               </div>
            </div>
            
            <p className={`text-lg md:text-xl whitespace-pre-wrap ${segment.playerId ? 'pl-4 border-l-4' : ''}`}
               style={{ borderColor: segment.playerId ? getPlayerColor(segment.playerId) : 'transparent' }}>
               {segment.text}
            </p>

            {segment.imageUrl && (
              <div className="mt-4 flex justify-center animate-fade-in transition-transform hover:scale-[1.01] duration-500 relative mx-auto">
                 <img 
                   src={segment.imageUrl} 
                   alt="Scene illustration" 
                   className="w-auto h-auto max-w-full max-h-[45vh] md:max-h-[50vh] landscape:max-h-[45vh] object-contain rounded-xl shadow-xl border border-gray-700" 
                   referrerPolicy="no-referrer"
                   onLoad={() => {
                     if (scrollRef.current) {
                       scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                     }
                   }}
                 />
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-center p-6">
            <div className="flex space-x-2">
              <div className="w-3 h-3 bg-ink/40 rounded-full animate-bounce delay-0"></div>
              <div className="w-3 h-3 bg-ink/40 rounded-full animate-bounce delay-150"></div>
              <div className="w-3 h-3 bg-ink/40 rounded-full animate-bounce delay-300"></div>
            </div>
            <p className="ml-3 text-ink/50 italic font-serif">The ink is drying...</p>
          </div>
        )}
      </div>
    </div>
  );
};