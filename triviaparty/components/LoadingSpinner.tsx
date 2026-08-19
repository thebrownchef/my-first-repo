import React from 'react';

export const LoadingSpinner: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center space-y-4 animate-pulse">
      <div className="relative w-16 h-16">
        <div className="absolute top-0 left-0 w-full h-full rounded-full border-4 border-indigo-500/30"></div>
        <div className="absolute top-0 left-0 w-full h-full rounded-full border-4 border-t-indigo-500 animate-spin"></div>
      </div>
    </div>
  );
};
