import { memo } from "react";

/**
 * Animated companion mascot ("Buzzy") for the empty workbench state.
 *
 * Vector SVG with smooth, hardware-accelerated CSS keyframe animations:
 * - Floating hover oscillation
 * - Natural eye blinking
 * - Antenna core aura glow
 * - Gentle wing tilt
 */
export const CreatureCompanion = memo(function CreatureCompanion() {
  return (
    <div className="relative mb-6 flex items-center justify-center">
      <style>{`
        @keyframes creature-float {
          0%, 100% {
            transform: translateY(0px) rotate(0deg);
          }
          50% {
            transform: translateY(-9px) rotate(1.5deg);
          }
        }
        @keyframes creature-blink {
          0%, 46%, 50%, 96%, 100% {
            transform: scaleY(1);
          }
          48%, 98% {
            transform: scaleY(0.08);
          }
        }
        @keyframes creature-pulse {
          0%, 100% {
            opacity: 0.45;
            transform: scale(1);
          }
          50% {
            opacity: 0.85;
            transform: scale(1.18);
          }
        }
        @keyframes wing-sway-left {
          0%, 100% {
            transform: rotate(-4deg);
          }
          50% {
            transform: rotate(6deg);
          }
        }
        @keyframes wing-sway-right {
          0%, 100% {
            transform: rotate(4deg);
          }
          50% {
            transform: rotate(-6deg);
          }
        }
        .animate-creature {
          animation: creature-float 4.2s ease-in-out infinite;
        }
        .animate-eye {
          animation: creature-blink 5.5s infinite;
          transform-origin: center;
        }
        .animate-core {
          animation: creature-pulse 2.8s ease-in-out infinite;
          transform-origin: center;
        }
        .animate-wing-left {
          animation: wing-sway-left 3.4s ease-in-out infinite;
          transform-origin: 38px 65px;
        }
        .animate-wing-right {
          animation: wing-sway-right 3.4s ease-in-out infinite;
          transform-origin: 82px 65px;
        }
      `}</style>

      {/* Background ambient glow */}
      <div className="absolute -inset-4 rounded-full bg-[var(--accent)]/12 blur-xl" />

      {/* The Creature SVG */}
      <svg
        width="130"
        height="130"
        viewBox="0 0 120 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="animate-creature relative z-10 drop-shadow-md select-none"
      >
        <defs>
          <linearGradient id="bodyGrad" x1="20" y1="20" x2="100" y2="100" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--accent)" stopOpacity="0.9" />
            <stop offset="0.5" stopColor="var(--bg-raised)" />
            <stop offset="1" stopColor="var(--bg-surface)" />
          </linearGradient>

          <linearGradient id="bellyGrad" x1="40" y1="50" x2="80" y2="90" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--bg-overlay)" stopOpacity="0.8" />
            <stop offset="1" stopColor="var(--bg-base)" stopOpacity="0.9" />
          </linearGradient>

          <radialGradient id="eyeGlow" cx="0.5" cy="0.5" r="0.5">
            <stop stopColor="var(--accent-fg)" />
            <stop offset="1" stopColor="var(--accent)" />
          </radialGradient>

          <radialGradient id="coreAura" cx="0.5" cy="0.5" r="0.5">
            <stop stopColor="var(--accent)" stopOpacity="0.9" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Pulsing Aura around antenna */}
        <circle cx="60" cy="18" r="14" fill="url(#coreAura)" className="animate-core" />

        {/* Antenna stem & bulb */}
        <path d="M60 22V32" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
        <circle cx="60" cy="18" r="4.5" fill="var(--accent)" />
        <circle cx="60" cy="18" r="2" fill="white" />

        {/* Wings / Thruster fins */}
        <g className="animate-wing-left">
          <path
            d="M38 62C24 55 18 68 22 75C26 82 36 78 38 72Z"
            fill="var(--accent)"
            fillOpacity="0.35"
            stroke="var(--accent)"
            strokeWidth="1.5"
          />
        </g>
        <g className="animate-wing-right">
          <path
            d="M82 62C96 55 102 68 98 75C94 82 84 78 82 72Z"
            fill="var(--accent)"
            fillOpacity="0.35"
            stroke="var(--accent)"
            strokeWidth="1.5"
          />
        </g>

        {/* Main Body */}
        <rect
          x="30"
          y="32"
          width="60"
          height="62"
          rx="24"
          fill="url(#bodyGrad)"
          stroke="var(--border-default)"
          strokeWidth="2"
        />

        {/* Visor Screen */}
        <rect
          x="37"
          y="42"
          width="46"
          height="28"
          rx="12"
          fill="url(#bellyGrad)"
          stroke="var(--border-subtle)"
          strokeWidth="1.5"
        />

        {/* Glowing Eyes */}
        <g className="animate-eye">
          {/* Left eye */}
          <circle cx="49" cy="56" r="4" fill="url(#eyeGlow)" />
          <circle cx="50.2" cy="54.8" r="1.3" fill="white" />

          {/* Right eye */}
          <circle cx="71" cy="56" r="4" fill="url(#eyeGlow)" />
          <circle cx="72.2" cy="54.8" r="1.3" fill="white" />
        </g>

        {/* Cheerful mouth curve */}
        <path
          d="M56 63C58.5 65 61.5 65 64 63"
          stroke="var(--accent)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />

        {/* Little chest badge */}
        <circle cx="60" cy="80" r="3" fill="var(--accent)" fillOpacity="0.7" />
        <circle cx="60" cy="80" r="1.2" fill="white" />
      </svg>
    </div>
  );
});
