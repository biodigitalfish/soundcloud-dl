/**
 * Main Vite config for building the extension.
 * This config handles all components: manifest, content scripts, background page, and settings page.
 * It builds browser-specific versions (Chrome/Firefox) based on the BROWSER environment variable.
 */

import { defineConfig } from "vite";
import path from "path";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { viteStaticCopy } from "vite-plugin-static-copy";

// Determine target browser from environment variable, default to firefox
const browser = process.env.BROWSER || "firefox";

// Manual manifest handling removed.
// The manifest will be copied by viteStaticCopy below.

const outputDir = path.resolve(__dirname, "dist", browser);

export default defineConfig({
    plugins: [
        wasm(),
        topLevelAwait(),
        viteStaticCopy({
            targets: [
                { src: "src/icons/*", dest: "icons" },
                { src: "node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js", dest: "ffmpeg-core" },
                { src: "node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm", dest: "ffmpeg-core" },
                // { src: 'node_modules/@ffmpeg/core-mt/dist/esm/ffmpeg-core.worker.js', dest: 'ffmpeg-core' }, // Uncomment if using multi-threaded version
                // Copy the correct manifest file based on the browser
                {
                    src: `src/manifests/manifest_${browser === "firefox" ? "build" : "chrome"}.json`,
                    dest: ".",
                    rename: "manifest.json"
                },
                // Copy background.html
                { src: "src/background.html", dest: "." },
                // Copy settings.html
                { src: "src/settings.html", dest: "." }
            ]
        }),
        // webExtension plugin removed for this test
        // zipPack plugin removed for this test
    ],
    optimizeDeps: {
        exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"]
    },
    server: { // Keep dev server settings if needed, ensure HMR port is unique if running multiple dev instances
        headers: {
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp"
        },
        hmr: {
            port: 5174 // Different port for HMR
        }
    },
    build: {
        outDir: outputDir,
        emptyOutDir: true, // Clean dist/${browser} before each build
        target: "es2022",
        sourcemap: true, // Consider 'hidden' for production or false to reduce size
        minify: false, // Set to true or 'terser' for production builds
        // Re-instating explicit rollupOptions with all manifest entries mapped.
        rollupOptions: {
            input: {
                // 'background.html': path.resolve(__dirname, 'src/background.html'), // No longer an input, will be copied
                // 'settings.html': path.resolve(__dirname, 'src/settings.html'),    // No longer an input, will be copied
                "js/background.js": path.resolve(__dirname, "src/background.ts"),
                "js/settings.js": path.resolve(__dirname, "src/settings.ts"),     // Added settings script
                "js/content.js": path.resolve(__dirname, "src/content.ts"),
                "js/bridge-content-script.js": path.resolve(__dirname, "src/bridge-content-script.ts"), // Added bridge script
                // "js/content_loader.js": path.resolve(__dirname, "src/content_loader.js"), // Removed from Vite build input, now handled by static copy
                "js/repostBlocker.js": path.resolve(__dirname, "src/repostBlocker.ts")
            },
            output: {
                format: "esm",
                entryFileNames: (chunkInfo) => {
                    if (chunkInfo.name.endsWith(".html")) {
                        return chunkInfo.name.replace(".html", ".js");
                    }
                    if (chunkInfo.name.startsWith("js/")) {
                        return chunkInfo.name;
                    }
                    return "js/[name].js";
                },
                chunkFileNames: "js/[name]-[hash].js",
                assetFileNames: "assets/[name]-[hash].[ext]"
            }
        }
    },
    resolve: {
        alias: {} // Keep if aliases are used
    }
}); 