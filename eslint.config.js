// ESLint 9 flat config, tuned for bugs rather than style.
// ESLint 9 (not 10) because eslint-plugin-react 7.37 does not support ESLint 10 yet.
// Run: npx eslint .
import js from "@eslint/js"
import globals from "globals"
import react from "eslint-plugin-react"
import reactHooks from "eslint-plugin-react-hooks"

export default [
  { ignores: ["dist/**", "build/**", "node_modules/**", "coverage/**", "**/*.min.js", ".bughunt-report/**"] },
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      // Crashes and dead logic
      "no-undef": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "no-unsafe-optional-chaining": "error",
      "no-cond-assign": "error",
      "no-self-compare": "error",
      "no-constant-binary-expression": "error",
      "react/jsx-no-undef": "error",
      "react/jsx-uses-vars": "error",
      // A hook called after an early return crashes when the data shows up later.
      "react-hooks/rules-of-hooks": "error",
      // Stale closures in effects and intervals.
      "react-hooks/exhaustive-deps": "warn",
      // Warn only: it also flags JSX kept in data tuples that is never rendered as a list.
      // React's own runtime warning (caught by the UI tests) is the real check.
      "react/jsx-key": "warn",
    },
  },
]
