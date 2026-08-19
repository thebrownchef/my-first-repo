import React, { useRef, useLayoutEffect, useState } from 'react';

interface TextFitProps {
  text: string;
  minFontSize?: number;
  maxFontSize?: number;
  className?: string;
}

export const TextFit: React.FC<TextFitProps> = ({ 
  text, 
  minFontSize = 10, 
  maxFontSize = 40, 
  className = '' 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    let min = minFontSize;
    let max = maxFontSize;
    let bestFit = min;

    // reset first
    content.style.fontSize = `${max}px`;
    
    // allow a tiny bit of buffer
    if (content.scrollHeight <= container.clientHeight && content.scrollWidth <= container.clientWidth) {
      return; 
    }

    // binary search
    while (min <= max) {
      const mid = Math.floor((min + max) / 2);
      content.style.fontSize = `${mid}px`;
      
      const isOverflowing = content.scrollHeight > container.clientHeight || content.scrollWidth > container.clientWidth;
      
      if (isOverflowing) {
        max = mid - 1;
      } else {
        bestFit = mid;
        min = mid + 1;
      }
    }

    content.style.fontSize = `${bestFit}px`;
  }, [text, minFontSize, maxFontSize]);

  return (
    <div ref={containerRef} className={`w-full h-full flex items-center justify-center overflow-hidden ${className}`}>
      <div 
        ref={contentRef} 
        className="w-full text-center" 
        style={{ lineHeight: 1.2, wordWrap: 'break-word', overflowWrap: 'break-word' }}
      >
        {text}
      </div>
    </div>
  );
};
