import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        ...globals.browser,
        ...globals.es2022,
        EventListener: "readonly",
        NodeListOf: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-undef": "error",
      "no-unused-vars": "off",
    },
  },
  {
    // Format converters inherently use `any` to traverse untyped ProseMirror JSON.
    // Typing every accessor would be high cost / low value.
    files: ["src/formats/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Model listing handles untyped HTTP responses from 6 different providers.
    files: ["src/ai-panel/model-listing.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Test files use `any` extensively for ProseMirror JSON traversal.
    files: ["src/editor/walk-images.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // ProseMirror plugin internals — plugin/view/DecorationSet types are
    // intricate and using `any` here is the pragmatic choice.
    files: ["src/editor/suggestions-marker-plugin.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Project panel exposes debug globals via (window as any).* assignments.
    // These are intentional debug hooks consumed by DevTools / test panels.
    files: ["src/editor/project-panel.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // main.ts wires the app together and exposes several debug globals
    // (auraTest, auraProject, auraSection, auraDocument, __aurawrite_loading,
    // updateWordCount) for cross-module access and DevTools inspection.
    files: ["src/main.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
