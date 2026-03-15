// Shadow Collective - Mission Control
// Cyberpunk HQ dashboard with 19 agents, state polling, activity board

// ─── Agent Registry ───────────────────────────────────────────
const AGENTS = {
  shadow:   { room: "ceo-suite",      x: 180,  y: 200, color: 0xf59e0b, phase: 1 },
  nexus:    { room: "chief-of-staff", x: 420,  y: 200, color: 0xf59e0b, phase: 1 },
  forge:    { room: "operations",     x: 660,  y: 200, color: 0xef4444, phase: 1 },
  warden:   { room: "operations",     x: 780,  y: 200, color: 0xef4444, phase: 1 },
  stack:    { room: "operations",     x: 900,  y: 200, color: 0xef4444, phase: 1 },
  atlas:    { room: "intelligence",   x: 1100, y: 200, color: 0x22d3ee, phase: 1 },
  ink:      { room: "creative",       x: 1500, y: 200, color: 0x22d3ee, phase: 1 },
  canvas:   { room: "creative",       x: 1660, y: 200, color: 0xa855f7, phase: 2 },
  ledger:   { room: "business",       x: 180,  y: 600, color: 0x10b981, phase: 2 },
  wire:     { room: "external",       x: 660,  y: 600, color: 0x3b82f6, phase: 2 },
  juris:    { room: "governance",     x: 900,  y: 600, color: 0x94a3b8, phase: 2 },
  diplomat: { room: "external",       x: 780,  y: 600, color: 0x3b82f6, phase: 2 },
  ryder:    { room: "personal",       x: 1200, y: 600, color: 0xf97316, phase: 2 },
  oracle:   { room: "intelligence",   x: 1260, y: 200, color: 0x22d3ee, phase: 3 },
  apex:     { room: "business",       x: 300,  y: 600, color: 0x10b981, phase: 3 },
  foundry:  { room: "business",       x: 420,  y: 600, color: 0x10b981, phase: 3 },
  merchant: { room: "business",       x: 540,  y: 600, color: 0x10b981, phase: 3 },
  harmony:  { room: "people",         x: 1500, y: 600, color: 0xec4899, phase: 4 },
  archive:  { room: "people",         x: 1660, y: 600, color: 0xec4899, phase: 4 },
};

const AGENT_NAMES = Object.keys(AGENTS);

// ─── State config ─────────────────────────────────────────────
const POLL_INTERVAL = 2000;
const WORLD_W = 2048;
const WORLD_H = 1152;
const CAM_SPEED = 6;

// ─── Runtime objects ──────────────────────────────────────────
let agentSprites = {};     // name -> { sprite, label, placeholder }
let agentServerState = {}; // name -> last known server state
let activityEntries = [];  // last 20 activity log entries
let offlineMode = false;
let errorTextObj = null;
let activityTexts = [];
let lastPollTime = 0;
let cursors = null;
let dragging = false;
let dragStart = { x: 0, y: 0 };
let camStart = { x: 0, y: 0 };

// ─── Scene ────────────────────────────────────────────────────
class MissionControlScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MissionControl' });
  }

  preload() {
    // Background
    this.load.image('hq_bg', '/static/assets/backgrounds/hq-bg.png');

    // Agent spritesheets (32x64 frames, 10 frames per strip)
    for (const name of AGENT_NAMES) {
      this.load.spritesheet(name, `/static/assets/sprites/${name}.png`, {
        frameWidth: 32,
        frameHeight: 64
      });
    }

    // Loading progress
    const loadingText = document.getElementById('loading-text');
    const loadingBar = document.getElementById('loading-progress-bar');
    this.load.on('progress', (val) => {
      if (loadingBar) loadingBar.style.width = Math.round(val * 100) + '%';
      if (loadingText) loadingText.textContent = `Initializing HQ systems... ${Math.round(val * 100)}%`;
    });
    this.load.on('complete', () => {
      const overlay = document.getElementById('loading-overlay');
      if (overlay) {
        overlay.style.transition = 'opacity 0.4s ease';
        overlay.style.opacity = '0';
        setTimeout(() => { overlay.style.display = 'none'; }, 420);
      }
    });
  }

  create() {
    // ── World & Background ──
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setBackgroundColor('#0a0e14');

    // Place background centered in world
    if (this.textures.exists('hq_bg')) {
      const bg = this.add.image(WORLD_W / 2, WORLD_H / 2, 'hq_bg');
      bg.setDepth(0);
    }

    // ── Create agent sprites ──
    for (const name of AGENT_NAMES) {
      this._createAgent(name);
    }

    // ── Create animations ──
    for (const name of AGENT_NAMES) {
      if (!this.textures.exists(name)) continue;
      this.anims.create({
        key: `${name}_idle`,
        frames: this.anims.generateFrameNumbers(name, { start: 0, end: 1 }),
        frameRate: 2,
        repeat: -1
      });
      this.anims.create({
        key: `${name}_working`,
        frames: this.anims.generateFrameNumbers(name, { start: 2, end: 5 }),
        frameRate: 4,
        repeat: -1
      });
      this.anims.create({
        key: `${name}_walking`,
        frames: this.anims.generateFrameNumbers(name, { start: 6, end: 9 }),
        frameRate: 6,
        repeat: -1
      });
    }

    // ── Error text (hidden by default) ──
    errorTextObj = this.add.text(WORLD_W / 2, 40, 'STATE UNAVAILABLE', {
      fontFamily: '"Press Start 2P", "Courier New", monospace',
      fontSize: '16px',
      color: '#ef4444',
      stroke: '#000',
      strokeThickness: 3,
      align: 'center'
    }).setOrigin(0.5).setDepth(1000).setScrollFactor(0).setVisible(false);

    // ── Activity board area ──
    this._createActivityBoard();

    // ── Camera controls ──
    cursors = this.input.keyboard.createCursorKeys();

    // Mouse drag to scroll
    this.input.on('pointerdown', (pointer) => {
      if (pointer.leftButtonDown()) {
        dragging = true;
        dragStart.x = pointer.x;
        dragStart.y = pointer.y;
        camStart.x = this.cameras.main.scrollX;
        camStart.y = this.cameras.main.scrollY;
      }
    });

    this.input.on('pointermove', (pointer) => {
      if (dragging && pointer.leftButtonDown()) {
        const dx = dragStart.x - pointer.x;
        const dy = dragStart.y - pointer.y;
        this.cameras.main.scrollX = camStart.x + dx;
        this.cameras.main.scrollY = camStart.y + dy;
      }
    });

    this.input.on('pointerup', () => {
      dragging = false;
    });

    // Center camera initially
    this.cameras.main.centerOn(WORLD_W / 2, WORLD_H / 2);

    // ── Initial poll ──
    this._pollState();
    this._pollActivity();
  }

  update(time) {
    // Keyboard camera scroll
    if (cursors) {
      if (cursors.left.isDown) this.cameras.main.scrollX -= CAM_SPEED;
      if (cursors.right.isDown) this.cameras.main.scrollX += CAM_SPEED;
      if (cursors.up.isDown) this.cameras.main.scrollY -= CAM_SPEED;
      if (cursors.down.isDown) this.cameras.main.scrollY += CAM_SPEED;
    }

    // Periodic polling
    if (time - lastPollTime > POLL_INTERVAL) {
      lastPollTime = time;
      this._pollState();
      this._pollActivity();
    }
  }

  // ── Agent creation ──────────────────────────────────────────
  _createAgent(name) {
    const cfg = AGENTS[name];
    const spriteExists = this.textures.exists(name);

    if (spriteExists) {
      const sprite = this.add.sprite(cfg.x, cfg.y, name, 0);
      sprite.setDepth(100);
      sprite.setInteractive({ useHandCursor: true });
      sprite.on('pointerdown', () => {
        this.cameras.main.pan(cfg.x, cfg.y, 400, 'Power2');
      });

      const label = this.add.text(cfg.x, cfg.y + 38, name.toUpperCase(), {
        fontFamily: '"Press Start 2P", "Courier New", monospace',
        fontSize: '7px',
        color: '#' + cfg.color.toString(16).padStart(6, '0'),
        stroke: '#0a0e14',
        strokeThickness: 2,
        align: 'center'
      }).setOrigin(0.5).setDepth(101);

      agentSprites[name] = { sprite, label, placeholder: null };
    } else {
      // Placeholder colored circle if sprite fails to load
      const gfx = this.add.circle(cfg.x, cfg.y, 16, cfg.color);
      gfx.setDepth(100);
      gfx.setInteractive({ useHandCursor: true });
      gfx.on('pointerdown', () => {
        this.cameras.main.pan(cfg.x, cfg.y, 400, 'Power2');
      });

      const label = this.add.text(cfg.x, cfg.y + 24, name.toUpperCase(), {
        fontFamily: '"Press Start 2P", "Courier New", monospace',
        fontSize: '7px',
        color: '#' + cfg.color.toString(16).padStart(6, '0'),
        stroke: '#0a0e14',
        strokeThickness: 2,
        align: 'center'
      }).setOrigin(0.5).setDepth(101);

      agentSprites[name] = { sprite: null, label, placeholder: gfx };
    }
  }

  // ── Update agent visual state ───────────────────────────────
  _updateAgent(name, serverData) {
    const cfg = AGENTS[name];
    const entry = agentSprites[name];
    if (!entry) return;

    const { sprite, label, placeholder } = entry;
    const state = serverData.state || 'idle';
    const active = serverData.active !== false;
    const phase = serverData.phase || cfg.phase;
    const room = serverData.room || cfg.room;

    // Determine target position - if room changed, fade and reposition
    // For now, agents stay at their assigned positions from the AGENTS config
    // Room changes would need a room->position mapping for the HQ layout

    // Progressive unlock: locked/inactive agents
    if (!active || state === 'locked') {
      if (sprite) {
        sprite.setAlpha(0.3);
        sprite.setTint(0x666666);
        sprite.anims.stop();
        sprite.setFrame(0);
      }
      if (placeholder) {
        placeholder.setAlpha(0.3);
        placeholder.fillColor = 0x666666;
      }
      if (label) {
        label.setAlpha(0.5);
      }
      return;
    }

    // Active agent
    if (sprite) {
      sprite.clearTint();
      sprite.setAlpha(1);

      // Pick animation based on state
      let animKey = `${name}_idle`;
      if (state === 'working' || state === 'thinking' || state === 'chatting' ||
          state === 'meeting' || state === 'executing' || state === 'writing' ||
          state === 'researching' || state === 'syncing' || state === 'approving') {
        animKey = `${name}_working`;
      } else if (state === 'walking') {
        animKey = `${name}_walking`;
      } else if (state === 'error') {
        animKey = `${name}_working`;
        sprite.setTint(0xff4444);
      } else if (state === 'sleeping') {
        sprite.anims.stop();
        sprite.setFrame(0);
        sprite.setAlpha(0.6);
        if (label) label.setAlpha(0.6);
        return;
      } else if (state !== 'idle') {
        console.warn(`Unknown agent state "${state}" for ${name}, treating as idle`);
        animKey = `${name}_idle`;
      }

      // Only change animation if different from current
      if (!sprite.anims.isPlaying || sprite.anims.currentAnim?.key !== animKey) {
        if (this.anims.exists(animKey)) {
          sprite.play(animKey, true);
        }
      }
    }

    if (placeholder) {
      placeholder.setAlpha(1);
      placeholder.fillColor = cfg.color;
    }
    if (label) {
      label.setAlpha(1);
    }
  }

  // ── State polling ───────────────────────────────────────────
  _pollState() {
    fetch('/status')
      .then(r => r.json())
      .then(data => {
        if (offlineMode) {
          offlineMode = false;
          if (errorTextObj) errorTextObj.setVisible(false);
        }

        if (data.agents && typeof data.agents === 'object') {
          for (const name of AGENT_NAMES) {
            const agentData = data.agents[name];
            if (agentData) {
              agentServerState[name] = agentData;
              this._updateAgent(name, agentData);
            }
          }
        }
      })
      .catch(err => {
        console.error('State poll failed:', err);
        offlineMode = true;
        if (errorTextObj) errorTextObj.setVisible(true);

        // Show all agents as idle with last known state
        for (const name of AGENT_NAMES) {
          if (!agentServerState[name]) {
            this._updateAgent(name, { state: 'idle', active: true });
          }
        }

        // Add OFFLINE marker to activity board
        this._setOfflineMarker(true);
      });
  }

  // ── Activity polling ────────────────────────────────────────
  _pollActivity() {
    fetch('/api/activity')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          activityEntries = data.slice(0, 20);
          this._renderActivityBoard();
        }
      })
      .catch(err => {
        console.error('Activity poll failed:', err);
      });
  }

  // ── Activity Board ──────────────────────────────────────────
  _createActivityBoard() {
    // Activity board rendered as text objects in the world
    // Positioned in the lower-center area of the HQ
    const boardX = 960;
    const boardY = 900;

    // Board title
    this.add.text(boardX, boardY - 30, '[ ACTIVITY LOG ]', {
      fontFamily: '"Press Start 2P", "Courier New", monospace',
      fontSize: '9px',
      color: '#22d3ee',
      stroke: '#000',
      strokeThickness: 2,
      align: 'center'
    }).setOrigin(0.5).setDepth(200);

    // Board background
    const boardBg = this.add.rectangle(boardX, boardY + 80, 500, 220, 0x0a0e14, 0.75);
    boardBg.setStrokeStyle(1, 0x22d3ee, 0.3);
    boardBg.setDepth(199);

    // Placeholder for activity text lines
    activityTexts = [];
    for (let i = 0; i < 12; i++) {
      const txt = this.add.text(boardX - 230, boardY + i * 16, '', {
        fontFamily: '"Courier New", monospace',
        fontSize: '9px',
        color: '#94a3b8',
        stroke: '#000',
        strokeThickness: 1,
        wordWrap: { width: 460 }
      }).setDepth(201);
      activityTexts.push(txt);
    }

    // Offline marker
    this._offlineMarker = this.add.text(boardX, boardY + 195, '', {
      fontFamily: '"Press Start 2P", "Courier New", monospace',
      fontSize: '8px',
      color: '#ef4444',
      stroke: '#000',
      strokeThickness: 2,
      align: 'center'
    }).setOrigin(0.5).setDepth(202);
  }

  _renderActivityBoard() {
    if (!activityTexts.length) return;

    for (let i = 0; i < activityTexts.length; i++) {
      if (i < activityEntries.length) {
        const entry = activityEntries[i];
        const agent = (entry.agent || 'SYSTEM').toUpperCase();
        const action = entry.action || '';
        const status = entry.status || 'pending';

        let color = '#f59e0b'; // pending = amber
        if (status === 'done') color = '#22c55e';
        if (status === 'error') color = '#ef4444';

        activityTexts[i].setText(`> ${agent}: ${action}`);
        activityTexts[i].setColor(color);
      } else {
        activityTexts[i].setText('');
      }
    }

    this._setOfflineMarker(false);
  }

  _setOfflineMarker(show) {
    if (this._offlineMarker) {
      this._offlineMarker.setText(show ? '[ OFFLINE ]' : '');
    }
  }
}

// ─── Phaser Config ────────────────────────────────────────────
const config = {
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  parent: 'game-container',
  pixelArt: true,
  backgroundColor: '#0a0e14',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 720
  },
  physics: {
    default: 'arcade',
    arcade: { gravity: { y: 0 }, debug: false }
  },
  scene: [MissionControlScene]
};

// ─── Launch ───────────────────────────────────────────────────
new Phaser.Game(config);
