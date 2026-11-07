/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Trail / forest palette (spec 08). Primary brand green.
        trail: {
          50: "#f0f7f1",
          100: "#dceee0",
          200: "#bcdcc4",
          300: "#90c2a0",
          400: "#5fa177",
          500: "#3f8359",
          600: "#2f6b3f",
          DEFAULT: "#2f6b3f",
          700: "#275638",
          800: "#21452f",
          900: "#1c3927",
        },
        // Difficulty tokens — must match src/lib/difficulty.ts.
        difficulty: {
          easy: "#2e7d32",
          moderate: "#b45309", // AA on white; matches src/lib/difficulty.ts
          hard: "#c62828",
          discovery: "#64748b",
        },
      },
      fontFamily: {
        // Inter second: Bricolage's latin-ext lacks the dot-below letters of
        // Indic transliteration (ṭ ṇ ḍ ṣ ṛ), and a heading should borrow
        // them from the body face, not from a system font (spec 08).
        display: ['"Bricolage Grotesque"', '"Inter"', "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ['"Inter"', "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
