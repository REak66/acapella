'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Loader2, CheckCircle2, Music, Brain, Sparkles } from 'lucide-react';
import type { ProcessingProgress } from '@/lib/audio-engine';

interface ProcessingStatusProps {
  progress: ProcessingProgress | null;
}

const STAGE_CONFIG = {
  loading: { icon: Music, label: 'Loading Model', color: 'text-blue-400' },
  decoding: { icon: Music, label: 'Decoding Audio', color: 'text-amber-400' },
  analyzing: { icon: Brain, label: 'Analyzing Pitch', color: 'text-purple-400' },
  postprocessing: { icon: Sparkles, label: 'Extracting Notes', color: 'text-green-400' },
  done: { icon: CheckCircle2, label: 'Complete', color: 'text-green-400' },
};

export function ProcessingStatus({ progress }: ProcessingStatusProps) {
  if (!progress) return null;

  const config = STAGE_CONFIG[progress.stage];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {progress.stage === 'done' ? (
          <CheckCircle2 className="w-5 h-5 text-green-400" />
        ) : (
          <Loader2 className="w-5 h-5 text-green-400 animate-spin" />
        )}
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-white/80">
              {config.label}
            </span>
            <span className="text-xs text-white/40 font-mono">
              {progress.percent}%
            </span>
          </div>
          <p className="text-xs text-white/40 mt-0.5">
            {progress.message}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{
            background: progress.stage === 'done'
              ? 'linear-gradient(90deg, #22c55e, #34d399)'
              : 'linear-gradient(90deg, #22c55e, #16a34a)',
          }}
          initial={{ width: 0 }}
          animate={{ width: `${progress.percent}%` }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        />
      </div>

      {/* Stage indicators */}
      <div className="flex gap-2">
        {Object.entries(STAGE_CONFIG).map(([stage, cfg]) => {
          const stageOrder = ['loading', 'decoding', 'analyzing', 'postprocessing', 'done'];
          const currentIdx = stageOrder.indexOf(progress.stage);
          const thisIdx = stageOrder.indexOf(stage);
          const isComplete = thisIdx < currentIdx;
          const isCurrent = stage === progress.stage;

          return (
            <div
              key={stage}
              className={`
                flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium
                transition-all duration-300
                ${isComplete ? 'bg-green-400/10 text-green-400' :
                  isCurrent ? 'bg-white/10 text-white/80' :
                  'bg-transparent text-white/20'}
              `}
            >
              <div className={`
                w-1.5 h-1.5 rounded-full
                ${isComplete ? 'bg-green-400' :
                  isCurrent ? 'bg-white/60 animate-pulse' :
                  'bg-white/10'}
              `} />
              {cfg.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
