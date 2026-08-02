import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        facet: {
          who: "#7c5cff",
          where: "#0e9f6e",
          when: "#f05252",
          topic: "#6b7280",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
