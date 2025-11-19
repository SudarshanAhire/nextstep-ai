const config = {
  plugins: {
    "@tailwindcss/postcss": {
      onWarning: (warning) => {
        if (warning.text.includes("Attempting to parse an unsupported color function")) {
          return; // Suppress this specific warning
        }
        // Log other warnings normally
        console.warn(warning.text);
      },
    },
  },
};

export default config;
