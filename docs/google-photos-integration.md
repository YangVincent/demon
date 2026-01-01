# Google Photos Integration (Future)

## Overview
Integration to select photos from Google Photos and extract text (OCR) using Claude's vision.

## Flow
1. User sends `/photos` to Telegram bot
2. Bot replies with link to web picker
3. User clicks link → Google OAuth → picks photos
4. Photos downloaded → sent to Claude vision API
5. Extracted text sent back to Telegram

## Requirements
- Google Cloud project with Photos Picker API enabled
- OAuth 2.0 credentials (web application type)
- Express web server for OAuth callback

## Implementation
See `/Users/vincentyang/.claude/plans/quiet-meandering-dawn.md` for detailed implementation steps.

## Why Web Picker?
Google deprecated direct library access in March 2025. The Picker API is now the only way to access user photos, and it requires a web UI for photo selection.
