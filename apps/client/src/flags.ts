import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill';
import flagFont from 'country-flag-emoji-polyfill/dist/TwemojiCountryFlags.woff2?url';

/**
 * Windows ships no colour flag emoji, so Chrome and Edge there show "CN" instead of a flag.
 * Where flags are missing, load a small self-hosted flag-only font (Twemoji art, CC-BY 4.0);
 * elsewhere nothing is loaded and the system emoji are used. The font name leads every
 * font-family stack in theme.css and only covers the flag code points.
 */
export const FLAG_FONT = 'Twemoji Country Flags';
export const flagsPolyfilled = polyfillCountryFlagEmojis(FLAG_FONT, flagFont);
