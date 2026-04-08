'use client';

export interface FoxTailLogoProps {
  size?: number;
  animated?: boolean;
  glowing?: boolean;
}

export default function FoxTailLogo({
  size = 120,
  animated = false,
  glowing = false,
}: FoxTailLogoProps) {
  const filter = glowing ? 'url(#senkoGlow)' : undefined;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      aria-hidden
      className={animated ? 'origin-bottom animate-[wag_2s_ease-in-out_infinite]' : ''}
      style={
        glowing
          ? { filter: 'drop-shadow(0 0 12px rgba(255,107,43,0.65))' }
          : undefined
      }
    >
      <defs>
        <linearGradient id="tailGrad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FF8C42" />
          <stop offset="50%" stopColor="#FF6B2B" />
          <stop offset="100%" stopColor="#E85D04" />
        </linearGradient>
        <filter id="senkoGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter={filter}>
        <path
          d="M15 105 C35 70 25 45 40 30 C55 15 75 10 90 18 C100 25 105 40 98 52 C92 62 78 68 70 78 C62 90 58 100 52 108 C48 112 42 115 35 112 C28 108 22 100 15 105 Z"
          fill="url(#tailGrad)"
          stroke="#CC4E10"
          strokeWidth="1.2"
        />
        <ellipse cx="88" cy="22" rx="14" ry="10" fill="white" opacity="0.92" />
        <path
          d="M45 55 Q55 50 65 58 M38 72 Q48 68 58 75 M52 88 Q62 85 70 92"
          stroke="#FFD4B8"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
      </g>
      <style>{`
        @keyframes wag {
          0%, 100% { transform: rotate(-5deg); }
          50% { transform: rotate(5deg); }
        }
      `}</style>
    </svg>
  );
}
