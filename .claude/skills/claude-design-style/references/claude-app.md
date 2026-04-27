# Claude App UI Patterns

Design patterns specific to Claude's chat interface (claude.ai and desktop/mobile apps). Use these when building AI chat interfaces, conversational UIs, or Claude-style applications.

## Chat Layout

```
Desktop (>= 1024px):
┌──────────┬──────────────────────────────────────┐
│ Sidebar  │  Chat Area                           │
│ (260px)  │  ┌────────────────────────────────┐  │
│          │  │ Messages (max-w: 768px, center) │  │
│          │  │                                 │  │
│          │  │                                 │  │
│          │  └────────────────────────────────┘  │
│          │  ┌────────────────────────────────┐  │
│          │  │ Input Area (bottom, sticky)     │  │
│          │  └────────────────────────────────┘  │
└──────────┴──────────────────────────────────────┘

With Artifacts (>= 1280px):
┌──────────┬────────────────────┬─────────────────┐
│ Sidebar  │  Chat Area         │  Artifact Panel  │
│ (260px)  │  (flex: 1)         │  (flex: 1)       │
│          │  max-w: 640px      │                   │
└──────────┴────────────────────┴─────────────────┘
```

### Key Values

```css
--sidebar-width: 260px;
--sidebar-width-collapsed: 48px;
--sidebar-padding: 16px;
--chat-max-width: 768px;
--chat-padding: 32px;
--header-height: var(--nav-height, 68px); /* inherits from layout.md --nav-height */
--input-min-height: 56px;
--input-max-height: 200px;
```

## Message Bubbles

### AI Message (Claude)

```css
.message-ai {
  display: flex;
  gap: 16px;
  padding: 20px 0;
  max-width: var(--chat-max-width);
  margin: 0 auto;
}

.message-ai .avatar {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  flex-shrink: 0;
  /* Claude star icon on clay background */
  background: #d97757;
  display: flex;
  align-items: center;
  justify-content: center;
}

.message-ai .content {
  flex: 1;
  font-family: var(--font-serif); /* serif for reading */
  font-size: 17px;
  line-height: 1.6;
  color: var(--text-primary);
  /* No bubble background — text sits directly on page bg */
}
```

### User Message

```css
.message-user {
  display: flex;
  gap: 16px;
  padding: 20px 0;
  max-width: var(--chat-max-width);
  margin: 0 auto;
}

.message-user .content {
  flex: 1;
  background: var(--bg-muted); /* subtle background distinction */
  padding: 16px 20px;
  border-radius: 12px;
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.5;
  color: var(--text-primary);
}
```

### Message Separator

```css
.message + .message {
  border-top: 1px solid var(--border-section);
}
```

## Chat Input Area

```css
.chat-input-container {
  position: sticky;
  bottom: 0;
  padding: 16px 32px 24px;
  background: var(--bg-primary);
}

.chat-input {
  min-height: 56px;
  max-height: 200px;
  padding: 16px 52px 16px 16px; /* right space for send button */
  border: 1px solid var(--border-default);
  border-radius: 12px; /* slightly larger radius for input */
  background: var(--bg-card);
  font-size: 15px;
  font-family: var(--font-sans);
  line-height: 1.5;
  color: var(--text-primary);
  resize: none;
  transition:
    border-color 200ms ease,
    box-shadow 200ms ease;
}

.chat-input:focus {
  outline: none;
  border-color: var(--text-tertiary);
  box-shadow: 0 0 0 2px var(--ring-color);
}

.chat-input::placeholder {
  color: var(--text-tertiary);
}

/* Send button (inside input) */
.chat-send {
  position: absolute;
  right: 12px;
  bottom: 12px;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: none;
  background: var(--bg-button);
  color: var(--text-on-button);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 200ms ease;
}
.chat-send:hover {
  transform: scale(1.05);
}
.chat-send:active {
  transform: scale(0.98);
}
.chat-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

## Sidebar

### Structure

```css
.sidebar {
  width: var(--sidebar-width);
  height: 100vh;
  border-right: 1px solid var(--border-section);
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* New chat button */
.sidebar-new-chat {
  margin: 16px;
  padding: 10px 16px;
  border-radius: 7.5px;
  border: 1px solid var(--border-default);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: all 200ms ease;
}
.sidebar-new-chat:hover {
  background: var(--bg-hover);
}

/* Search */
.sidebar-search {
  margin: 0 16px 8px;
  padding: 8px 12px 8px 36px; /* left space for search icon */
  border-radius: 7.5px;
  border: 1px solid var(--border-light);
  background: var(--bg-secondary);
  font-size: 14px;
  color: var(--text-primary);
}
.sidebar-search:focus {
  border-color: var(--text-tertiary);
}
```

### Conversation List

```css
.conv-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px;
}

/* Time group header */
.conv-group-label {
  padding: 8px 8px 4px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Conversation item */
.conv-item {
  padding: 8px 12px;
  border-radius: 7.5px;
  cursor: pointer;
  transition: background 150ms ease;
  display: flex;
  align-items: center;
  gap: 8px;
}
.conv-item:hover {
  background: var(--bg-hover);
}
.conv-item.active {
  background: var(--bg-muted);
  font-weight: 500;
}

.conv-item-title {
  flex: 1;
  font-size: 14px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conv-item-time {
  font-size: 12px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
```

## Model Selector

```css
.model-selector {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 7.5px;
  border: 1px solid var(--border-light);
  background: var(--bg-card);
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  cursor: pointer;
  transition: all 200ms ease;
}
.model-selector:hover {
  background: var(--bg-hover);
  border-color: var(--text-tertiary);
}

/* Model option in dropdown */
.model-option {
  padding: 10px 12px;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.model-option-name {
  font-size: 14px;
  font-weight: 500;
}
.model-option-desc {
  font-size: 12px;
  color: var(--text-tertiary);
}
.model-option.selected {
  background: var(--bg-muted);
}
```

## Thinking Indicator

```css
.thinking-block {
  margin: 12px 0;
  border-radius: 8px;
  background: var(--bg-secondary);
  overflow: hidden;
}

/* Collapsed state */
.thinking-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-secondary);
  transition: background 150ms ease;
}
.thinking-header:hover {
  background: var(--bg-hover);
}

.thinking-header .icon {
  width: 16px;
  height: 16px;
  color: var(--text-tertiary);
  transition: transform 200ms ease;
}
.thinking-header.open .icon {
  transform: rotate(90deg);
}

/* Expanded content */
.thinking-content {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 300ms cubic-bezier(0.4, 0, 0.2, 1);
}
.thinking-content.open {
  grid-template-rows: 1fr;
}
.thinking-content > div {
  overflow: hidden;
  padding: 0 16px;
}
.thinking-content.open > div {
  padding: 0 16px 16px;
}

.thinking-text {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-secondary);
  font-style: italic;
}
```

## Artifacts Panel

```css
.artifact-panel {
  flex: 1;
  border-left: 1px solid var(--border-section);
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
}

/* Artifact header */
.artifact-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-section);
}
.artifact-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

/* Code/Preview tabs */
.artifact-tabs {
  display: flex;
  border-bottom: 1px solid var(--border-section);
}
.artifact-tab {
  padding: 8px 16px;
  font-size: 13px;
  color: var(--text-secondary);
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: all 150ms ease;
}
.artifact-tab.active {
  color: var(--text-primary);
  border-bottom-color: var(--text-primary);
}

/* Resizable divider */
.resize-handle {
  width: 4px;
  cursor: col-resize;
  background: transparent;
  transition: background 200ms ease;
  position: relative;
}
.resize-handle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 1.5px;
  width: 1px;
  background: var(--border-section);
}
.resize-handle:hover {
  background: var(--text-tertiary);
}
.resize-handle:hover::after {
  background: var(--text-tertiary);
}
```

## Streaming / Loading States

```css
/* Streaming text cursor */
.streaming .message-ai .content::after {
  content: '';
  display: inline-block;
  width: 2px;
  height: 1.1em;
  background: var(--text-primary);
  border-radius: 1px;
  margin-left: 1px;
  vertical-align: text-bottom;
  animation: cursor-blink 1s ease-in-out infinite;
}

@keyframes cursor-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

/* Thinking dots (before response starts) */
.loading-dots {
  display: inline-flex;
  gap: 4px;
  padding: 8px 0;
}
.loading-dot {
  width: 6px;
  height: 6px;
  background: var(--text-tertiary);
  border-radius: 50%;
  animation: thinking-bounce 1.4s ease-in-out infinite;
}
.loading-dot:nth-child(2) {
  animation-delay: 0.16s;
}
.loading-dot:nth-child(3) {
  animation-delay: 0.32s;
}

/* Tool use indicator */
.tool-indicator {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 7.5px;
  background: var(--bg-secondary);
  font-size: 13px;
  color: var(--text-secondary);
  margin: 8px 0;
}
.tool-indicator .spinner {
  width: 14px;
  height: 14px;
}
```

## Mobile Adaptations

```css
@media (max-width: 767px) {
  /* Sidebar becomes full-screen drawer */
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    width: min(80vw, 280px);
    transform: translateX(-100%);
    transition: transform 300ms cubic-bezier(0.4, 0, 0.2, 1);
    z-index: 1000;
  }
  .sidebar.open {
    transform: translateX(0);
  }

  /* Chat input fixed to bottom */
  .chat-input-container {
    padding: 8px 16px 16px;
    padding-bottom: calc(16px + env(safe-area-inset-bottom));
  }

  /* Larger touch targets */
  .conv-item {
    min-height: 44px;
  }
  .chat-send {
    width: 44px;
    height: 44px;
  }

  /* Input uses 16px to prevent iOS zoom */
  .chat-input {
    font-size: 16px;
  }

  /* Artifacts go full-screen */
  .artifact-panel {
    position: fixed;
    inset: 0;
    z-index: 900;
    border-left: none;
  }
}
```

## Keyboard Shortcuts UI

```css
.kbd {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-muted);
  border: 1px solid var(--border-light);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1;
}
```

## File Upload Area

```css
.upload-zone {
  border: 2px dashed var(--border-default);
  border-radius: 12px;
  padding: 32px;
  text-align: center;
  color: var(--text-tertiary);
  transition: all 200ms ease;
}
.upload-zone.dragging {
  border-color: var(--brand-clay);
  background: rgba(217, 119, 87, 0.05);
  color: var(--text-secondary);
}

.upload-file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 7.5px;
  background: var(--bg-secondary);
  font-size: 13px;
}
```

## Projects Feature UI

```css
/* Project card */
.project-card {
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: 12px;
  padding: 20px;
  cursor: pointer;
  transition: all 200ms ease;
}
.project-card:hover {
  border-color: var(--border-default);
  box-shadow: var(--shadow-sm);
}

.project-card-title {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.project-card-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 12px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.project-card-meta {
  font-size: 12px;
  color: var(--text-tertiary);
  display: flex;
  gap: 12px;
}

/* Project knowledge upload */
.project-knowledge {
  border: 2px dashed var(--border-default);
  border-radius: 12px;
  padding: 24px;
  text-align: center;
}

/* Custom instructions textarea */
.project-instructions {
  min-height: 120px;
  resize: vertical;
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.6;
}
```

## Interactive Charts (Artifacts)

```css
/* Chart artifact container */
.artifact-chart {
  padding: 24px;
  background: var(--bg-card);
  border-radius: 12px;
}

/* Chart uses warm color palette */
.chart-colors {
  --chart-1: #d97757; /* clay */
  --chart-2: #5d8ab0; /* muted blue */
  --chart-3: #7a9e5d; /* muted green */
  --chart-4: #8b6bb0; /* muted purple */
  --chart-5: #c47d52; /* warm orange */
  --chart-6: var(--text-tertiary);
}

/* Chart tooltip */
.chart-tooltip {
  background: var(--bg-button);
  color: var(--text-on-button);
  padding: 8px 12px;
  border-radius: 7.5px;
  font-size: 13px;
  box-shadow: var(--shadow-md);
}
```

## MCP Tool Permission Dialog

```css
.tool-permission {
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: 12px;
  padding: 20px;
  margin: 12px 0;
}

.tool-permission-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.tool-permission-name {
  font-family: var(--font-mono);
  font-size: 13px;
  background: var(--bg-muted);
  padding: 2px 8px;
  border-radius: 4px;
}

.tool-permission-params {
  font-family: var(--font-mono);
  font-size: 13px;
  background: var(--bg-muted);
  padding: 12px;
  border-radius: 8px;
  margin: 12px 0;
  line-height: 1.5;
}

.tool-permission-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
```

## Voice Mode Indicator (Mobile)

```css
.voice-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--bg-button);
  color: var(--text-on-button);
}

/* Pulsing ring during recording */
.voice-indicator.recording::after {
  content: '';
  position: absolute;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  border: 2px solid var(--brand-clay);
  animation: voice-pulse 1.5s ease-in-out infinite;
}

@keyframes voice-pulse {
  0% {
    transform: scale(1);
    opacity: 0.6;
  }
  100% {
    transform: scale(1.3);
    opacity: 0;
  }
}
```

## Button Size Scale

```css
/* Button size variants (from Claude app CSS) */
--size-button-xs-h: 1.375rem; /* 22px — tiny inline actions */
--size-button-sm-h: 2.125rem; /* 34px — compact buttons */
--size-button-md-h: 2.75rem; /* 44px — standard (matches touch target) */
--size-button-lg-h: 3.375rem; /* 54px — hero CTAs */
```
