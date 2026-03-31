# Suggestions Panel - Behavior Specification

## Core Concept

- **1 sentence = 1 box**
- **1 box = 1 suggestion**
- All boxes are **independent** from each other

## Actions

| Action        | Popup State              | Document                   | AI                              | Notes                     |
| ------------- | ------------------------ | -------------------------- | ------------------------------- | ------------------------- |
| **Accept**    | **STAYS OPEN** + badge ✓ | Replaces with suggestion   | Done for this sentence          | Original saved for Switch |
| **Discard**   | **STAYS OPEN**           | Unchanged                  | New request for SAME sentence   | Regenerates suggestion    |
| **Switch**    | **STAYS OPEN**           | Toggle original↔suggestion | Done                            | Uses saved original       |
| **X (Close)** | **CLOSED**               | Unchanged                  | Done - AI forgets this sentence | Everything deleted        |

## AI Behavior

### Initial Analysis

- When user types `. ! ? :` followed by space
- AI analyzes ALL sentences in the document
- Creates ONE box per sentence with ONE initial suggestion
- AI stops after initial analysis

### Ongoing Interaction

- AI is **STOPPED** after initial analysis
- AI ONLY moves when user clicks **Discard** on a specific box
- **Discard** sends request for the SAME sentence only
- AI never re-analyzes a sentence unless user explicitly clicks Discard

## Switch Logic

After Accept:

- Document contains: **suggested text**
- Original text is **saved**

When user clicks Switch:

- If doc shows suggested → switch to original
- If doc shows original → switch to suggested
- Click again → toggles back

## Close (X) Behavior

- Deletes the box completely
- Removes all traces (original, suggestion, saved data)
- AI **forgets** this sentence forever
- AI **moves on** and never comes back to this sentence

## Queue System (NOT blocking)

- Multiple sentences can be queued for initial analysis
- But once a box is created for a sentence, it's **locked**
- Only Discard can trigger re-analysis on that specific box
- Accept/Close/Switch do NOT trigger new AI requests

## Data Structures

```typescript
interface SentenceSuggestion {
  id: string;
  sentenceTitle: string;
  original: string; // Original sentence from user
  suggested: string | null; // Current suggestion
  reason: string | null;
  timestamp: number;
  isExpanded: boolean;
  showingOriginal: boolean; // What is currently shown in doc
  isAccepted: boolean; // Has been accepted
  isCollapsed: boolean; // UI collapsed state
}

// Tracked data
acceptedOriginals: Map<id, original_text>; // Saved for Switch
finalizedSentences: Set<lowercase>; // Closed/forgotten sentences
```

## Rules to Remember (MUST NOT FORGET)

1. Accept does NOT close popup - stays open with badge
2. Discard does NOT close popup - stays open, regenerates
3. Switch does NOT close popup - stays open, toggles
4. Close (X) ONLY action that closes/closes popup
5. Close (X) deletes all data and AI forgets forever
6. AI is blocked after initial analysis - only Discard unblocks
7. One box per sentence - no duplicates
