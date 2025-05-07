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

# Zip Firefox build
echo "Creating Firefox zip..."
cd dist/firefox
# Zip contents of dist/firefox into dist/zips/SoundCloud-Downloader-Firefox.zip
# Exclude any previous zips or source maps if not desired in final package
zip -r "../../dist/zips/SoundCloud-Downloader-Firefox.zip" . -x "*.zip" -x "*.map"
cd ../.. # Back to project root

# Zip Chrome build
echo "Creating Chrome zip..."
cd dist/chrome
# Zip contents of dist/chrome into dist/zips/SoundCloud-Downloader-Chrome.zip
zip -r "../../dist/zips/SoundCloud-Downloader-Chrome.zip" . -x "*.zip" -x "*.map"
cd ../.. # Back to project root

# Archive source code
echo "Archiving source code..."
git archive --format zip --output "dist/zips/SoundCloud-Downloader-Source-Code.zip" HEAD

echo "Build process complete. Browser-specific zips and source code archive are in dist/zips/."