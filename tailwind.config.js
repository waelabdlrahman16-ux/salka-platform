/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Salka — teal, silver & gold (warm neutrals, cool teal accent — updated Aug 2026)
        // Rationale: the palette read as cold since every neutral had a cool teal-grey
        // undertone. Kept the teal brand color exactly as-is; warmed every neutral around
        // it instead, so teal now stands out as the one cool-toned element rather than
        // blending into a cool-grey family.
        night: '#FBF7F1',     // page background — warm ivory (was #F4F7F7, cool silver)
        shell: '#FFFFFF',     // card background
        shellup: '#F4EEE3',   // elevated surface (header, active tab, thumbnails) — warm tint (was #EAF1F0)
        line: '#E8E1D6',      // borders — warm light grey (was #E1E8E7, cool silver)
        sea: '#0A5F5E',       // brand primary — unchanged, matches the real logo teal exactly
        seadeep: '#063A39',   // primary hover/pressed — unchanged
        sand: '#B8934A',      // secondary/accent — DECORATIVE ONLY: star icons, tinted backgrounds.
                              // 2.69:1 on night and 2.87:1 on shell, so it must never carry text.
        sandink: '#6E572B',   // the same hue and saturation, darker — this is the one for gold TEXT.
                              // 6.43:1 on night, 6.86:1 on shell, 5.94:1 on shellup. All pass AA.
        linestrong: '#A3875C',// form-control borders only. `line` is 1.30:1 against a card, which is
                              // fine for decorative card edges but fails WCAG 1.4.11's 3:1 for the
                              // boundary of an input. This is 3.40:1 on shell, 3.19:1 on night.
        foam: '#231F1A',      // primary text — warm near-black (was #17302E, cool teal-black)
        mist: '#6E655C'       // secondary/muted text — warm grey (was #64716F, cool silver-gray)
      },
      fontFamily: { arabic: ['"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'] }
    }
  },
  plugins: []
}
