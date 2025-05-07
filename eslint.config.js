// eslint.config.js
import globals from "globals";
import tseslintParser from "@typescript-eslint/parser";
import tseslintPlugin from "@typescript-eslint/eslint-plugin";
import js from "@eslint/js"; // For ESLint's recommended rules
import eslintPluginJest from "eslint-plugin-jest"; // <-- IMPORT JEST PLUGIN

export default [
    {
        // Global ignores
        ignores: ["dist/", "build/", "node_modules/", "*.min.js", "**/*.d.ts"],
    },
    js.configs.recommended, // ESLint's recommended rules for all files
    {
        // Base configuration for all JS/TS files
        files: ["**/*.{js,mjs,cjs,ts}"],
        languageOptions: {
            parser: tseslintParser, // Use the imported parser for all
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.webextensions,
                ...globals.node,
                ParentNode: "readonly",
                BlobPropertyBag: "readonly",
            },
        },
        plugins: {
            "@typescript-eslint": tseslintPlugin,
        },
        linterOptions: {
            reportUnusedDisableDirectives: "error",
        },
        rules: {
            // Common rules for JS and TS can go here, or override from recommended
            "semi": ["warn", "always"],
            "quotes": ["warn", "double"],
            // It's good to turn off the base ESLint rule for no-unused-vars
            // if you're using the TypeScript version.
            "no-unused-vars": "off",
            "no-explicit-any": "off",
        },
    },
    {
        // TypeScript specific configurations
        files: ["**/*.ts"],
        rules: {
            // Apply TypeScript recommended rules.
            // tseslintPlugin.configs.recommended already includes rules that extend eslint:recommended
            // and provides TypeScript-specific versions.
            ...tseslintPlugin.configs.recommended.rules,
            // You might also consider 'recommended-type-checking' if you have tsconfig.json setup for ESLint
            // ...tseslintPlugin.configs["recommended-type-checking"].rules,

            // Add or override TS rules here
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unused-vars": ["off", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
        },
        // If using type-checking rules, you'd configure languageOptions.parserOptions.project here
        // languageOptions: {
        //   parserOptions: {
        //     project: "./tsconfig.json", // Or appropriate tsconfig path
        //   },
        // },
    },
    // ---- ADD THIS SECTION FOR JEST FILES ----
    {
        files: ["**/*.spec.ts", "**/*.test.ts"], // Target your test files
        plugins: {
            jest: eslintPluginJest,
        },
        languageOptions: {
            globals: {
                ...globals.jest,
            },
        },
        rules: {
            ...eslintPluginJest.configs.recommended.rules,
            // You can add/override Jest specific rules here
        },
    }
    // -----------------------------------------
]; 