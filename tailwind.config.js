// tailwind.config.js
module.exports = {
  content: [
    "./index.html",
    "./**/*.{html,js}",
    "!./**/*.json",
    "!./node_modules/**",
    "!./output.css",
    "!./public/**"
  ],
  theme: {
    extend: {
      colors: {
        // 🎨 Brand Palette
        coral: "#F9A8D4",        // pastel pink
        pastelBlue: "#93C5FD",   // soft sky blue
        mint: "#86EFAC",         // mint green
        brandBg: "#F7F7F8",      // background tone
      },
      fontFamily: {
        // 🪶 Fonts
        body: ["Nunito", "ui-sans-serif", "system-ui"],
        header: ["Poppins", "ui-sans-serif", "system-ui"],
        message: ["Baloo 2", "cursive"],
      },
      backgroundImage: {
        // 🌈 Gradient utility
        "gradient-brand": "linear-gradient(90deg, #F9A8D4, #93C5FD, #86EFAC)",
      },
      backdropBlur: {
        // 💎 “Glass” look
        xs: "2px",
        sm: "4px",
        md: "8px",
        lg: "10px",
        xl: "16px",
      },
      borderRadius: {
        chip: "9999px",
      },
      fontSize: {
        badge: "11px",
      },

      /* ✅ Add these: dynamic viewport helpers */
      height: {
        'screen-dvh': '100dvh',
      },
      minHeight: {
        'screen-dvh': '100dvh',
      },
    },
  },
  plugins: [],
};
