#!/bin/bash

trap "exit 1" ERR

# npm install is typically run before this script, or as part of a CI step.
# If you need to ensure it runs every time, uncomment the next two lines:
# echo "Running npm install (if needed)..."
# npm install --if-present

# The vite builds (npm run build:firefox_core and npm run build:chrome_core)
# are now responsible for creating browser-specific builds in dist/chrome and dist/firefox,
# including their respective manifest.json files.

# This script now zips these pre-built directories and archives source code.

echo "Ensuring dist/zips directory exists for final zip files..."
mkdir -p dist/zips

# Ensure required tools are available
command -v zip >/dev/null 2>&1 || { echo >&2 "zip is required but not installed. Aborting."; exit 1; }
command -v find >/dev/null 2>&1 || { echo >&2 "find is required but not installed. Aborting."; exit 1; }

# Define directories
FIREFOX_DIR="dist/firefox"
CHROME_DIR="dist/chrome"

# --- Workaround for vite-plugin-static-copy issue with content-loader.js ---
# Manually copy content-loader.js into the build directories.
# This is necessary because the plugin fails to copy this specific file correctly.
if [ -f "src/content-loader.js" ]; then
    echo "Manually copying src/content-loader.js..."
    mkdir -p "${FIREFOX_DIR}/js"
    mkdir -p "${CHROME_DIR}/js"
    cp "src/content-loader.js" "${FIREFOX_DIR}/js/"
    cp "src/content-loader.js" "${CHROME_DIR}/js/"
    echo "Manual copy complete."
else
    echo "Warning: src/content-loader.js not found. Cannot manually copy."
fi
# --- End Workaround ---

# Create Firefox zip
echo "Creating Firefox distribution zip..."
cd $FIREFOX_DIR || exit
zip -r "../../dist/zips/soundcloud-dl-firefox.zip" ./*
cd - || exit
echo "Firefox zip created: dist/soundcloud-dl-firefox.zip"

# Create Chrome zip
echo "Creating Chrome distribution zip..."
cd $CHROME_DIR || exit
zip -r "../../dist/zips/soundcloud-dl-chrome.zip" ./*
cd - || exit
echo "Chrome zip created: dist/soundcloud-dl-chrome.zip"

# Archive source code
echo "Archiving source code..."
git archive --format zip --output "dist/zips/SoundCloud-Downloader-Source-Code.zip" HEAD

echo "Build process complete. Browser-specific zips and source code archive are in dist/zips/."