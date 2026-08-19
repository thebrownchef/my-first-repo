import { useEffect, useRef } from 'react';
import { Player } from '../types';

interface Props {
  messages: string[];
  player1?: Player;
  player2?: Player;
}

export default function Log({ messages, player1, player2 }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="bg-transparent border-0 p-4 h-full flex flex-col shadow-inner">
      <h3 className="text-[11px] uppercase tracking-[0.2em] text-[#8a7a60] mb-3">Battle Journal</h3>
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-2 text-[11px] font-mono text-[#8a7a60] min-h-0"
      >
        {messages.length === 0 && <span className="text-gray-500 italic">The battle begins...</span>}
        {messages.map((m, i) => {
          let style: React.CSSProperties = { color: "#d4c5a9" };
          let isBold = false;
          
          if (player2 && m.includes(player2.name)) {
             style = { color: player2.color };
          } else if (player1 && m.includes(player1.name)) {
             style = { color: player1.color };
          }
          
          if (m.includes('Hit!') || m.includes('damage') || m.includes('removed')) {
             style = { color: "white" };
             isBold = true;
          }
          
          return (
            <div key={i} style={style} className={isBold ? "font-bold" : ""}>
              <span className="text-gray-500 mr-2">&gt;</span>
              {m}
            </div>
          );
        })}
      </div>
    </div>
  );
}
