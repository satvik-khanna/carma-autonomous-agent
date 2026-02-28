#!/usr/bin/env bash
set -e

# Install Node dependencies and build Next.js
npm install
npm run build

# Install Python dependencies for the pipeline
python3 -m pip install --upgrade pip
python3 -m pip install -r requirements.txt
