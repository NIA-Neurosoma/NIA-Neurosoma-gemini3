# NIA-NeuroSoma — Gemini 3 Powered Neuro-Somatic Companion

NeuroSoma is a structured wellness application powered by Google Gemini 3, delivering guided neuro-somatic programs through a safe, context-aware AI companion.

---

## Core Idea

Instead of an open-ended AI chatbot, NeuroSoma uses Gemini 3 as a **bounded, safety-first integration agent** called **Nia (Neuro Integration Agent).**

The AI operates strictly within predefined program content and user context.

---

## Key Features

- Program-based daily flow (7-day and 21-day programs)
- AI assistant that understands program context
- Safe conversational boundaries
- No medical or therapeutic advice
- Structured somatic guidance
- FlutterFlow frontend + Firebase backend
- Gemini 3 API as core reasoning engine

---

## Technology Stack

| Layer | Technology |
|-----|-----|
| Frontend | FlutterFlow |
| Backend | Firebase Functions |
| Database | Firestore |
| AI Engine | Gemini 3 (gemini-3-flash-preview) |
| API Layer | Custom DMZ Proxy |
| Language | TypeScript / Dart |

---

## Architecture Overview

The system follows a strict layered architecture:

FlutterFlow App  
      ↓  
niaProxy (Firebase Cloud Function – DMZ Layer)  
      ↓  
Gemini 3 API (gemini-3-flash-preview)  
      ↓  
Validated & Structured Response  
      ↓  
User Interface

All AI communication is securely routed through the niaProxy layer to ensure API key protection and safety filtering.
