import path from "node:path";

const config = {
  plugins: {
    "@tailwindcss/postcss": { base: path.resolve("src") },
  },
};

export default config;
