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
command -v zip >/dev/null 2>&1 || { echo >&2 "Error: zip is required but not installed. Aborting."; exit 1; }
command -v find >/dev/null 2>&1 || { echo >&2 "Error: find is required but not installed. Aborting."; exit 1; }

# Define directories
FIREFOX_DIR="dist/firefox"
CHROME_DIR="dist/chrome"

# --- Workaround for vite-plugin-static-copy issue with content-loader.js ---
# Manually copy content-loader.js into the build directories.
# This is necessary because the plugin fails to copy this specific file correctly.
if [ -f "src/content/content-loader.js" ]; then
    echo "Manually copying src/content/content-loader.js..."
    mkdir -p "${FIREFOX_DIR}/js"
    mkdir -p "${CHROME_DIR}/js"
    cp "src/content/content-loader.js" "${FIREFOX_DIR}/js/"
    cp "src/content/content-loader.js" "${CHROME_DIR}/js/"
    echo "Manual copy complete."
else
    echo "Error: src/content/content-loader.js not found. Cannot manually copy. Aborting."
    exit 1
fi
# --- End Workaround ---

# Check if Firefox directory exists and is not empty
if [ ! -d "$FIREFOX_DIR" ] || [ -z "$(ls -A $FIREFOX_DIR)" ]; then
    echo "Error: Firefox distribution directory '$FIREFOX_DIR' is missing or empty. Build might have failed. Aborting."
    exit 1
fi

# Create Firefox zip
echo "Creating Firefox distribution zip..."
cd $FIREFOX_DIR || { echo "Error: Failed to change directory to $FIREFOX_DIR. Aborting."; exit 1; }
zip -r "../../dist/zips/soundcloud-dl-firefox.zip" ./*
cd - || { echo "Error: Failed to change back from $FIREFOX_DIR. Aborting."; exit 1; }
echo "Firefox zip created: dist/zips/soundcloud-dl-firefox.zip"

# Check if Chrome directory exists and is not empty
if [ ! -d "$CHROME_DIR" ] || [ -z "$(ls -A $CHROME_DIR)" ]; then
    echo "Error: Chrome distribution directory '$CHROME_DIR' is missing or empty. Build might have failed. Aborting."
    exit 1
fi

# Create Chrome zip
echo "Creating Chrome distribution zip..."
cd $CHROME_DIR || { echo "Error: Failed to change directory to $CHROME_DIR. Aborting."; exit 1; }
zip -r "../../dist/zips/soundcloud-dl-chrome.zip" ./*
cd - || { echo "Error: Failed to change back from $CHROME_DIR. Aborting."; exit 1; }
echo "Chrome zip created: dist/zips/soundcloud-dl-chrome.zip"

# Archive source code
echo "Archiving source code..."
git archive --format zip --output "dist/zips/SoundCloud-Downloader-Source-Code.zip" HEAD || { echo "Error: Failed to archive source code. Aborting."; exit 1; }

echo "Build process complete. Browser-specific zips and source code archive are in dist/zips/."