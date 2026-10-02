import globals from "globals";

export default [
  { ignores: ["**/node_modules/**", "**/artifacts/**"] },
  {
    files: ["web/**/*.js", "**/*.js", "**/*.mjs", "**/*.cjs"],
    languageOptions: { ecmaVersion: "latest" },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["web/**/*.js"],
    languageOptions: { globals: { ...globals.browser, ...globals.serviceworker } },
  },
  { files: ["**/*.mjs", "**/*.cjs"], languageOptions: { globals: globals.node } },
  {
    files: ["test/browser*.cjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
