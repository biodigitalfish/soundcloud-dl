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
import zipPack from "vite-plugin-zip-pack";

// Determine target browser from environment variable, default to firefox
const browser = process.env.BROWSER || "firefox";

// Manual manifest handling removed.
// The manifest will be copied by viteStaticCopy below.

const outputDir = path.resolve(__dirname, "dist", browser);
const zipOutputDir = path.resolve(__dirname, "dist", "zips");
const fileNameSuffix = "-scdl";

export default defineConfig({
    plugins: [
        wasm(),
        topLevelAwait(),
        viteStaticCopy({
            targets: [
                { src: "src/ui/icons/*", dest: "icons" },
                { src: "node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js", dest: "ffmpeg-core" },
                { src: "node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm", dest: "ffmpeg-core" },
                { src: "node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js", dest: "ffmpeg-core" },
                {
                    src: `src/manifests/manifest_${browser === "firefox" ? "firefox" : "chrome"}.json`,
                    dest: ".",
                    rename: "manifest.json"
                },
                // Copy background.html
                { src: "src/background/background.html", dest: "." },
                // Copy settings.html
                { src: "src/settings/settings.html", dest: "." },
                // Copy popup files
                { src: "src/popup/queue.html", dest: "src/popup" }, // Copies to dist/{browser}/src/popup/queue.html
                { src: "src/popup/queue.css", dest: "src/popup" },  // Copies to dist/{browser}/src/popup/queue.css
                // Copy content-loader.js and rename it
                {
                    src: "src/content/content-loader.js",
                    dest: "js",
                    rename: "content-loader-scdl.js"
                }
            ]
        }),
        zipPack({
            inDir: outputDir,
            outDir: zipOutputDir,
            outFileName: `soundcloud-dl-${browser}.zip`,
            enableLogging: true
        })
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
        emptyOutDir: true,
        target: "es2022",
        sourcemap: false,
        minify: true,
        rollupOptions: {
            input: {
                "js/background.js": path.resolve(__dirname, "src/background/background.ts"),
                "js/settings.js": path.resolve(__dirname, "src/settings/settings.ts"),     // Added settings script
                "js/content.js": path.resolve(__dirname, "src/content/content.ts"),
                "js/bridge-content-script.js": path.resolve(__dirname, "src/content/bridge-content-script.ts"), // Added bridge script
                "js/repostBlocker.js": path.resolve(__dirname, "src/content/repostBlocker.ts"),
                "src/popup/queue.js": path.resolve(__dirname, "src/popup/queue.ts") // Added popup script
            },
            output: {
                format: "esm",
                entryFileNames: (chunkInfo) => {
                    // Handles input keys like "js/background.js" -> "js/background-scdl.js"
                    // Handles input keys like "src/popup/queue.js" -> "src/popup/queue-scdl.js"
                    if ((chunkInfo.name.startsWith("js/") || chunkInfo.name.startsWith("src/popup/")) && chunkInfo.name.endsWith(".js")) {
                        const prefix = chunkInfo.name.startsWith("js/") ? "js/" : "src/popup/";
                        const baseName = chunkInfo.name.slice(prefix.length, -3); // Removes prefix and ".js"
                        return `${prefix}${baseName}${fileNameSuffix}.js`;
                    }
                    // Handles input keys like "js/repostBlocker" (if it were without .js in map) or other js files
                    if (chunkInfo.name.startsWith("js/")) {
                        const baseName = chunkInfo.name.slice(3).replace(/\.js$/, ""); // Removes "js/" and optional ".js"
                        return `js/${baseName}${fileNameSuffix}.js`;
                    }
                    // Fallback for entries not starting with "js/" or "src/popup/", if any
                    const nameWithoutExtension = chunkInfo.name.replace(/\.[^/.]+$/, "");
                    return `js/${nameWithoutExtension}${fileNameSuffix}.js`; // Default to js/ prefix if not matched
                },
                chunkFileNames: `js/[name]${fileNameSuffix}-[hash].js`,
                assetFileNames: `assets/[name]${fileNameSuffix}-[hash].[ext]`
            }
        }
    },
    resolve: {
        alias: {} // Keep if aliases are used
    }
}); 