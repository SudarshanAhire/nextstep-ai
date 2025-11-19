const config = {
  plugins: {
    "@tailwindcss/postcss": {
      onWarning: (warning) => {
        if (warning.text.includes("Attempting to parse an unsupported color function")) {
          return; // Suppress this specific warning
        }
      },
    },
  },
};

export default config;
