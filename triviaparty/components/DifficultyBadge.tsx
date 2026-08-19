import React from 'react';
import { Difficulty } from '../types';
import { DIFFICULTY_COLORS, DIFFICULTY_LABELS } from '../constants';

interface DifficultyBadgeProps {
  difficulty: Difficulty;
}

export const DifficultyBadge: React.FC<DifficultyBadgeProps> = ({ difficulty }) => {
  return (
    <div className={`px-4 py-1.5 rounded-full text-sm font-bold tracking-wide border ${DIFFICULTY_COLORS[difficulty]} transition-colors duration-500`}>
      {DIFFICULTY_LABELS[difficulty].toUpperCase()}
    </div>
  );
};