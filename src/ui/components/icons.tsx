import './icons.css';

/**
 * G4 (L-6): the mute disc and the tab gear draw these instead of the emoji
 * they used to print (🔊/🔇 and ⚙). An emoji is a picture in the platform's
 * own colours -- iOS painted the speaker grey and blue whatever the theme --
 * and its size and baseline vary by font. These are drawn in `currentColor`,
 * so they take the button's ink in every theme (and the muted state's red),
 * and they size with the button's font-size.
 *
 * Decorative only: the button carries the accessible name, so every icon is
 * aria-hidden and unfocusable.
 */

const common = {
  className: 'ui-icon',
  viewBox: '0 0 24 24',
  'aria-hidden': true,
  focusable: false,
} as const;

const SPEAKER = 'M3 9h4l5-4.5v15L7 15H3z';

export function SpeakerIcon() {
  return (
    <svg {...common} data-icon="speaker">
      <path d={SPEAKER} fill="currentColor" />
      <path
        d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9.5 9.5 0 0 1 0 13"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SpeakerMutedIcon() {
  return (
    <svg {...common} data-icon="speaker-muted">
      <path d={SPEAKER} fill="currentColor" />
      <path d="M16 9l6 6M22 9l-6 6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

const GEAR =
  'M9.77 4.32L9.87 1.72L14.13 1.72L14.23 4.32L15.85 4.99L17.76 3.22L20.78 6.24L19.01 8.15L19.68 9.77' +
  'L22.28 9.87L22.28 14.13L19.68 14.23L19.01 15.85L20.78 17.76L17.76 20.78L15.85 19.01L14.23 19.68' +
  'L14.13 22.28L9.87 22.28L9.77 19.68L8.15 19.01L6.24 20.78L3.22 17.76L4.99 15.85L4.32 14.23' +
  'L1.72 14.13L1.72 9.87L4.32 9.77L4.99 8.15L3.22 6.24L6.24 3.22L8.15 4.99Z' +
  // The hub, cut out (evenodd).
  'M15.2 12a3.2 3.2 0 1 0 -6.4 0a3.2 3.2 0 1 0 6.4 0Z';

export function GearIcon() {
  return (
    <svg {...common} data-icon="gear">
      <path d={GEAR} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
