// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/*.tsbuildinfo",
      // Isolated, temporary architecture spikes — never part of the production lint graph.
      "spikes/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      // Unused values are a defect signal, but allow the `_`-prefix escape hatch.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Floating promises silently swallow failures in the worker loop.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      // Prefer explicit narrowing over `any` leaking through boundaries.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": ["error", { allow: ["error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },

  // React / Next.js surface only.
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  // Tests may assert on non-null values and use looser typing.
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },

  // Config files are not part of a tsconfig project graph.
  {
    files: ["**/*.config.{js,mjs,ts}", "eslint.config.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      "no-console": "off",
    },
  },
);
