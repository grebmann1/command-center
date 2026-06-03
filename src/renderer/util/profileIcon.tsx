import { Sparkles, Zap, History, Play } from 'lucide-react';
import type { LaunchProfileId } from '@shared/types';

export function profileIcon(profile: LaunchProfileId, size = 11) {
  switch (profile) {
    case 'claude':
      return <Sparkles size={size} />;
    case 'claude-yolo':
      return <Zap size={size} />;
    case 'claude-resume':
      return <History size={size} />;
    case 'shell':
      return <Play size={size} />;
  }
}
