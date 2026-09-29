/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1C2430",
        brand: "#16324F",
        canvas: "#F4F6F8",
        ok: "#166534",
        danger: "#9A3412",
        warn: "#B45309",
        mute: "#6B7280",
      },
      boxShadow: {
        card: "0 1px 2px rgba(22, 50, 79, 0.06), 0 4px 12px rgba(22, 50, 79, 0.04)",
      },
    },
  },
  plugins: [],
};
