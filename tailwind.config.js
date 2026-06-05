/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Placeholder — the real palette/type scale is defined in specs/08-design-system.md
      // and applied during the design-polish phase.
      colors: {
        trail: {
          DEFAULT: "#2f6b3f",
        },
      },
    },
  },
  plugins: [],
};
