#!/bin/sh
# Builds a fresh linux/amd64 image (Airbase runs amd64; this Mac is arm64) and deploys it to Airbase.
# A new tag each time stops the Airbase CLI from re-deploying an older image.
set -e
cd "$(dirname "$0")"
TAG="local.airbase.sg/rectify-firebase:v$(date +%Y%m%d%H%M%S)"
docker build --platform linux/amd64 -t "$TAG" .
airbase deploy --yes --image "$TAG"
