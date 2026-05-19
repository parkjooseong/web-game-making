import { REWARDS, rarityLabels } from "../../game/content/rewards";
import { ADVENTURE_STAGES } from "../../game/content/adventure";
import { CHARACTERS, getCharacter, getSkillsForCharacter, gradeLabels, type SkillDefinition, SKILLS } from "../../game/content/skills";
import type { SkillSlot } from "../../game/input/actions";
import {
  CORES,
  EFFECT_PALETTES,
  NOISE_CODEX,
  STORY_ENTRIES,
  getCoreDefinition,
  getSkinsForCharacter,
  type ProgressionStore,
  type ProgressSnapshot
} from "../../game/progression/progression";
import type { GameState, CastGrade, CharacterId, CharacterSkinId, CoreId, EffectPaletteId, GameMode, BossChallengeState } from "../../game/simulation/types";
import type { PoseStatus } from "../../game/pose/PoseService";

interface HudOptions {
  onEnableCamera: () => Promise<void>;
  onRewardSelected: (rewardId: string) => void;
  onRestart: () => void;
  onCharacterSelected: (characterId: CharacterId) => void;
  onModeSelected: (mode: GameMode) => void;
  onHubToggled: (visible: boolean) => void;
  onCoreSelected: (coreId: CoreId) => void;
  onSkinSelected: (characterId: CharacterId, skinId: CharacterSkinId) => void;
  onEffectPaletteSelected: (paletteId: EffectPaletteId) => void;
  onAdventureStageSelected: (stageId: string) => void;
  progression: ProgressionStore;
}

type SkillElements = Record<
  SkillSlot,
  {
    root: HTMLElement;
    cooldown: HTMLElement;
    gauge: HTMLElement;
  }
>;

export class Hud {
  private readonly root: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly shieldFill: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly brandName: HTMLElement;
  private readonly brandTitle: HTMLElement;
  private readonly waveText: HTMLElement;
  private readonly stageText: HTMLElement;
  private readonly enemyText: HTMLElement;
  private readonly scoreText: HTMLElement;
  private readonly comboText: HTMLElement;
  private readonly overdriveText: HTMLElement;
  private readonly gaugeText: HTMLElement;
  private readonly adventureBanner: HTMLElement;
  private readonly bossChallengePrompt: HTMLElement;
  private readonly trainingPanel: HTMLElement;
  private readonly castPrompt: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly cameraPanel: HTMLElement;
  private readonly cameraPreviewHost: HTMLElement;
  private readonly cameraFxLayer: HTMLElement;
  private readonly cameraStatus: HTMLElement;
  private readonly cameraButton: HTMLButtonElement;
  private readonly rewardsOverlay: HTMLElement;
  private readonly modalOverlay: HTMLElement;
  private readonly modalPanel: HTMLElement;
  private readonly hubOverlay: HTMLElement;
  private readonly hubButton: HTMLButtonElement;
  private readonly characterSwitch: HTMLElement;
  private readonly modeSwitch: HTMLElement;
  private readonly skillEls: SkillElements;
  private progressSnapshot: ProgressSnapshot;
  private latestState: GameState | null = null;
  private hubVisible = false;
  private hubRenderKey = "";
  private rewardKey = "";
  private modalKey = "";
  private toastTimer = 0;

  constructor(private readonly options: HudOptions) {
    const root = document.getElementById("hud-root");
    if (!root) {
      throw new Error("Missing #hud-root");
    }
    this.root = root;
    this.root.innerHTML = "";

    const topLeft = div("hud-cluster top-left");
    topLeft.innerHTML = `
      <div class="identity-row">
        <div class="character-portrait"><span></span><i></i></div>
        <div>
          <div class="brand-line">
            <span class="brand-mark"></span>
            <span class="brand-name">RIO</span>
          </div>
          <div class="brand-title"></div>
        </div>
      </div>
      <div class="bar-row">
        <span>HP</span>
        <div class="bar"><span class="bar-fill hp-fill"></span></div>
        <strong class="hp-text"></strong>
      </div>
      <div class="bar-row compact">
        <span>SH</span>
        <div class="bar shield"><span class="bar-fill shield-fill"></span></div>
      </div>
      <div class="combo-text"></div>
      <div class="overdrive-text"></div>
      <div class="character-switch"></div>
    `;

    const topRight = div("hud-cluster top-right");
    topRight.innerHTML = `
      <div class="wave-text"></div>
      <div class="stage-text"></div>
      <div class="enemy-text"></div>
      <div class="score-text"></div>
      <div class="mode-switch"></div>
    `;

    const skillDock = div("skill-dock");
    const skillEls = {} as SkillElements;
    for (const slot of Object.keys(SKILLS) as SkillSlot[]) {
      const skill = SKILLS[slot];
      const button = div("skill-slot");
      button.style.setProperty("--skill-color", skill.uiColor);
      button.innerHTML = `
        <b>${slot}</b>
        <span>${skill.name}</span>
        <i class="skill-gauge"></i>
        <em class="skill-cooldown"></em>
      `;
      skillDock.appendChild(button);
      skillEls[slot] = {
        root: button,
        cooldown: button.querySelector(".skill-cooldown") as HTMLElement,
        gauge: button.querySelector(".skill-gauge") as HTMLElement
      };
    }
    this.skillEls = skillEls;

    const gaugeChip = div("gauge-chip");
    gaugeChip.innerHTML = `<span>CORE</span><strong class="gauge-text"></strong>`;
    skillDock.appendChild(gaugeChip);

    const camera = div("camera-panel");
    camera.innerHTML = `
      <div class="camera-preview-wrap">
        <div class="silhouette">
          <span></span>
        </div>
        <div class="camera-fx-layer">
          <span class="camera-scanline"></span>
          <i></i>
        </div>
      </div>
      <div class="camera-copy">
        <strong>POSE CORE</strong>
        <p class="camera-status"></p>
      </div>
    `;
    this.cameraButton = document.createElement("button");
    this.cameraButton.type = "button";
    this.cameraButton.className = "camera-button";
    this.cameraButton.textContent = "카메라 켜기";
    this.cameraButton.addEventListener("click", () => {
      this.cameraButton.disabled = true;
      void this.options.onEnableCamera().finally(() => {
        this.cameraButton.disabled = false;
      });
    });
    camera.appendChild(this.cameraButton);

    this.adventureBanner = div("adventure-banner");
    this.bossChallengePrompt = div("boss-challenge-prompt");
    this.trainingPanel = div("training-panel");
    this.castPrompt = div("cast-prompt");
    this.toast = div("toast");
    this.hubOverlay = div("hub-overlay");
    this.rewardsOverlay = div("reward-overlay");
    this.modalOverlay = div("modal-overlay");
    this.modalPanel = div("modal-panel");
    this.modalOverlay.appendChild(this.modalPanel);

    this.root.append(
      topLeft,
      topRight,
      skillDock,
      camera,
      this.adventureBanner,
      this.bossChallengePrompt,
      this.trainingPanel,
      this.castPrompt,
      this.toast,
      this.hubOverlay,
      this.rewardsOverlay,
      this.modalOverlay
    );

    this.hpFill = topLeft.querySelector(".hp-fill") as HTMLElement;
    this.shieldFill = topLeft.querySelector(".shield-fill") as HTMLElement;
    this.hpText = topLeft.querySelector(".hp-text") as HTMLElement;
    this.brandName = topLeft.querySelector(".brand-name") as HTMLElement;
    this.brandTitle = topLeft.querySelector(".brand-title") as HTMLElement;
    this.waveText = topRight.querySelector(".wave-text") as HTMLElement;
    this.stageText = topRight.querySelector(".stage-text") as HTMLElement;
    this.enemyText = topRight.querySelector(".enemy-text") as HTMLElement;
    this.scoreText = topRight.querySelector(".score-text") as HTMLElement;
    this.comboText = topLeft.querySelector(".combo-text") as HTMLElement;
    this.overdriveText = topLeft.querySelector(".overdrive-text") as HTMLElement;
    this.gaugeText = gaugeChip.querySelector(".gauge-text") as HTMLElement;
    this.cameraPanel = camera;
    this.cameraPreviewHost = camera.querySelector(".camera-preview-wrap") as HTMLElement;
    this.cameraFxLayer = camera.querySelector(".camera-fx-layer") as HTMLElement;
    this.cameraStatus = camera.querySelector(".camera-status") as HTMLElement;
    this.characterSwitch = topLeft.querySelector(".character-switch") as HTMLElement;
    this.modeSwitch = topRight.querySelector(".mode-switch") as HTMLElement;
    this.hubButton = document.createElement("button");
    this.hubButton.type = "button";
    this.hubButton.className = "mode-button hub-button";
    this.hubButton.textContent = "허브";
    this.hubButton.addEventListener("click", () => this.toggleHub());
    this.characterSwitch.append(
      ...Object.values(CHARACTERS).map((character) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "character-button";
        button.textContent = character.name;
        button.style.setProperty("--character-color", character.uiColor);
        button.addEventListener("click", () => this.options.onCharacterSelected(character.id));
        return button;
      })
    );
    this.modeSwitch.append(
      ...[
        { mode: "story" as GameMode, label: "전투" },
        { mode: "adventure" as GameMode, label: "모험" },
        { mode: "survival" as GameMode, label: "생존" },
        { mode: "boss-rush" as GameMode, label: "보스" },
        { mode: "training" as GameMode, label: "훈련장" }
      ].map((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "mode-button";
        button.textContent = item.label;
        button.addEventListener("click", () => this.options.onModeSelected(item.mode));
        return button;
      })
    );
    this.modeSwitch.appendChild(this.hubButton);

    this.progressSnapshot = this.options.progression.getSnapshot();
    this.options.progression.subscribe((snapshot) => {
      this.progressSnapshot = snapshot;
      this.hubRenderKey = "";
      this.renderHub();
    });
  }

  getCameraPreviewHost(): HTMLElement {
    return this.cameraPreviewHost;
  }

  toggleHub(force?: boolean): boolean {
    this.hubVisible = force ?? !this.hubVisible;
    this.hubOverlay.classList.toggle("is-visible", this.hubVisible);
    this.hubButton.classList.toggle("is-active", this.hubVisible);
    this.options.onHubToggled(this.hubVisible);
    this.renderHub();
    return this.hubVisible;
  }

  setCameraStatus(status: PoseStatus): void {
    const labels: Record<PoseStatus, string> = {
      idle: "대체 입력 준비",
      starting: "연결 중",
      ready: "준비됨",
      "permission-needed": "권한 필요",
      unsupported: "지원 안 됨",
      unstable: "인식 불안정",
      error: "오류"
    };
    this.cameraStatus.textContent = labels[status];
    this.root.dataset.camera = status;
    this.cameraPanel.classList.toggle("has-camera", status === "ready");
    this.cameraButton.textContent = status === "ready" ? "연결됨" : "카메라 켜기";
    this.cameraButton.disabled = status === "ready" || status === "starting";
  }

  update(state: GameState): void {
    this.latestState = state;
    this.hpFill.style.width = `${Math.max(0, (state.player.hp / state.player.maxHp) * 100)}%`;
    this.shieldFill.style.width = `${Math.min(100, (state.player.shield / 40) * 100)}%`;
    this.hpText.textContent = `${Math.ceil(state.player.hp)}/${state.player.maxHp}`;
    const character = getCharacter(state.characterId);
    const skills = getSkillsForCharacter(state.characterId);
    this.brandName.textContent = character.name;
    this.brandTitle.textContent = character.title;
    this.root.style.setProperty("--active-character", character.uiColor);
    this.root.dataset.character = state.characterId;
    this.root.dataset.mode = state.mode;
    this.root.querySelectorAll<HTMLButtonElement>(".character-button").forEach((button) => {
      button.classList.toggle("is-active", button.textContent === character.name);
    });
    this.root.querySelectorAll<HTMLButtonElement>(".mode-button").forEach((button) => {
      const labelByMode: Record<GameMode, string> = {
        story: "전투",
        adventure: "모험",
        survival: "생존",
        "boss-rush": "보스",
        training: "훈련장"
      };
      button.classList.toggle("is-active", button.textContent === labelByMode[state.mode]);
    });
    this.waveText.textContent = this.getModeTitle(state);
    this.stageText.textContent = state.stageName;
    this.enemyText.textContent =
      state.mode === "training"
        ? `${state.enemies.length} TARGETS`
        : state.mode === "boss-rush"
          ? `${state.enemies.length + state.spawnQueue.length} BOSS`
          : state.mode === "adventure"
            ? `${state.enemies.length + state.spawnQueue.length} LEFT`
          : `${state.enemies.length + state.spawnQueue.length} NOISE`;
    this.scoreText.textContent =
      state.mode === "training"
        ? "FREE CAST"
        : state.mode === "survival"
          ? `${Math.floor(Math.max(0, 600 - state.modeTime))}s LEFT`
          : state.mode === "adventure"
            ? `STAGE ${state.adventureStageIndex + 1}/${state.adventureStageTotal}`
          : `${state.player.score.toString().padStart(5, "0")} PTS`;
    this.comboText.textContent =
      state.player.comboPerfect > 1
        ? `Perfect x${state.player.comboPerfect}`
        : state.player.comboRangeBonusTime > 0
          ? "Range Boost"
          : "MoveCaster";
    this.overdriveText.textContent =
      state.player.overdriveTime > 0
        ? `OVERDRIVE ${state.player.overdriveTime.toFixed(1)}s`
        : state.player.shieldWallTime > 0
          ? `SHIELD WALL ${state.player.shieldWallTime.toFixed(1)}s`
          : `F: ${skills.F.name}`;
    this.gaugeText.textContent = `${Math.floor(state.player.gauge)}%`;
    this.hubButton.classList.toggle("is-active", this.hubVisible);

    for (const slot of Object.keys(SKILLS) as SkillSlot[]) {
      const skill = skills[slot];
      const elements = this.skillEls[slot];
      const cooldown = state.cooldowns[slot];
      const ready = cooldown <= 0 && state.player.gauge >= skill.gaugeCost;
      elements.root.style.setProperty("--skill-color", skill.uiColor);
      const label = elements.root.querySelector("span");
      if (label) {
        label.textContent = skill.name;
      }
      elements.root.classList.toggle("is-ready", ready);
      elements.root.classList.toggle("is-prepared", state.preparedSkill?.slot === slot);
      elements.cooldown.textContent = cooldown > 0 ? cooldown.toFixed(1) : "";
      elements.gauge.style.width = `${Math.min(100, (state.player.gauge / skill.gaugeCost) * 100)}%`;
    }

    this.renderRewards(state);
    this.renderModal(state);
    this.renderAdventureBanner(state);
    this.renderBossChallenge(state);
    this.renderTrainingPanel(state);
    this.renderHub();
    this.tickToast();
  }

  showCastPrompt(skill: SkillDefinition): void {
    this.castPrompt.innerHTML = `
      <strong>${skill.slot}: ${skill.name}</strong>
      <span>${skill.gestureLabel}</span>
      <small>1 / 2 / 3</small>
    `;
    this.castPrompt.style.setProperty("--prompt-color", skill.uiColor);
    this.castPrompt.classList.add("is-visible");
    this.cameraPanel.style.setProperty("--camera-fx-color", skill.uiColor);
    this.cameraFxLayer.querySelector("i")!.textContent = skill.shortName.toUpperCase();
    this.cameraPanel.classList.remove("grade-normal", "grade-great", "grade-perfect");
    this.cameraPanel.classList.add("is-capturing");
  }

  showCastResult(grade: CastGrade, line: string): void {
    this.castPrompt.innerHTML = `
      <strong>${gradeLabels[grade]}</strong>
      <span>${line}</span>
    `;
    this.castPrompt.classList.add("is-visible", `grade-${grade.toLowerCase()}`);
    this.cameraPanel.classList.remove("is-capturing", "grade-normal", "grade-great", "grade-perfect");
    if (grade !== "Miss") {
      this.cameraPanel.classList.add(`grade-${grade.toLowerCase()}`);
      window.setTimeout(() => {
        this.cameraPanel.classList.remove("grade-normal", "grade-great", "grade-perfect");
      }, 820);
    }
    window.setTimeout(() => {
      this.castPrompt.className = "cast-prompt";
    }, 720);
  }

  showBossChallengeCapture(challenge: BossChallengeState): void {
    const color =
      challenge.bossType === "drum"
        ? "#ffd166"
        : challenge.bossType === "mirror"
          ? "#48f7ff"
          : "#c7b8ff";
    this.cameraPanel.style.setProperty("--camera-fx-color", color);
    this.cameraFxLayer.querySelector("i")!.textContent = "BOSS";
    this.cameraPanel.classList.remove("grade-normal", "grade-great", "grade-perfect");
    this.cameraPanel.classList.add("is-capturing", "boss-capture");
  }

  showBossChallengeResult(grade: CastGrade, line: string): void {
    this.cameraPanel.classList.remove("is-capturing", "boss-capture", "grade-normal", "grade-great", "grade-perfect");
    if (grade !== "Miss") {
      this.cameraPanel.classList.add(`grade-${grade.toLowerCase()}`);
    }
    this.castPrompt.innerHTML = `
      <strong>${grade === "Miss" ? "BREAK FAIL" : `${gradeLabels[grade]} COUNTER`}</strong>
      <span>${line}</span>
    `;
    this.castPrompt.style.setProperty("--prompt-color", grade === "Perfect" ? "#ffd166" : "#48f7ff");
    this.castPrompt.classList.add("is-visible", `grade-${grade.toLowerCase()}`);
    window.setTimeout(() => {
      this.cameraPanel.classList.remove("grade-normal", "grade-great", "grade-perfect");
      this.castPrompt.className = "cast-prompt";
    }, 900);
  }

  showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.add("is-visible");
    this.toastTimer = window.setTimeout(() => {
      this.toast.classList.remove("is-visible");
    }, 1100);
  }

  private tickToast(): void {
    if (this.toastTimer === 0) {
      return;
    }
  }

  private getModeTitle(state: GameState): string {
    if (state.victory) {
      return "CLEAR";
    }
    if (state.mode === "training") {
      return "TRAINING";
    }
    if (state.mode === "survival") {
      const seconds = Math.floor(state.modeTime);
      const minutesText = Math.floor(seconds / 60)
        .toString()
        .padStart(2, "0");
      const secondsText = (seconds % 60).toString().padStart(2, "0");
      return `SURVIVAL ${minutesText}:${secondsText}`;
    }
    if (state.mode === "adventure") {
      return `AREA ${state.adventureStageCode}`;
    }
    if (state.mode === "boss-rush") {
      return `BOSS ${Math.min(state.waveIndex, 3)} / 3`;
    }
    return `WAVE ${Math.min(state.waveIndex, 5)} / 5`;
  }

  private renderAdventureBanner(state: GameState): void {
    if (state.mode !== "adventure" || state.victory || state.gameOver) {
      this.adventureBanner.classList.remove("is-visible");
      this.adventureBanner.innerHTML = "";
      return;
    }

    const remaining = state.spawnQueue.length + state.enemies.length;
    const total = Math.max(1, state.adventureStageEnemyTotal);
    const progress = Math.min(100, Math.max(0, ((total - remaining) / total) * 100));
    this.adventureBanner.classList.add("is-visible");
    this.adventureBanner.innerHTML = `
      <div>
        <strong>AREA ${state.adventureStageCode}</strong>
        <span>${state.stageName}</span>
      </div>
      <p>${state.adventureStageGoal}</p>
      <div class="adventure-progress"><i style="width:${progress}%"></i></div>
    `;
  }

  private renderBossChallenge(state: GameState): void {
    const challenge = state.bossChallenge;
    if (!challenge || state.victory || state.gameOver) {
      this.bossChallengePrompt.classList.remove("is-visible");
      this.bossChallengePrompt.innerHTML = "";
      return;
    }

    const remaining = Math.max(0, challenge.expiresAt - state.time);
    const progress = Math.max(0, Math.min(100, (remaining / 2.45) * 100));
    const bossLabel =
      challenge.bossType === "drum" ? "DRUM NOISE" : challenge.bossType === "mirror" ? "MIRROR WITCH" : "ZERO MOTION";
    this.bossChallengePrompt.dataset.boss = challenge.bossType;
    this.bossChallengePrompt.classList.add("is-visible");
    this.bossChallengePrompt.innerHTML = `
      <div class="boss-challenge-kicker">BOSS POSE BREAK</div>
      <strong>${bossLabel}</strong>
      <span>${challenge.prompt}</span>
      <p>${gestureLabel(challenge.requiredGesture)} · 1/2/3 테스트</p>
      <div class="boss-challenge-timer"><i style="width:${progress}%"></i></div>
    `;
  }

  private renderTrainingPanel(state: GameState): void {
    if (state.mode !== "training") {
      this.trainingPanel.classList.remove("is-visible");
      this.trainingPanel.innerHTML = "";
      return;
    }

    const training = state.training;
    const totalAttempts = training.missions.reduce((sum, mission) => sum + mission.attempts, 0);
    const totalPerfects = training.missions.reduce((sum, mission) => sum + mission.perfects, 0);
    const totalCompleted = training.missions.filter((mission) => mission.completed).length;
    const perfectRate = totalAttempts > 0 ? Math.round((totalPerfects / totalAttempts) * 100) : 0;
    const last = training.lastResult;
    const missionRows = training.missions
      .map((mission) => {
        const progress = Math.min(100, (mission.successes / mission.targetSuccesses) * 100);
        const missionPerfectRate = mission.attempts > 0 ? Math.round((mission.perfects / mission.attempts) * 100) : 0;
        return `
          <div class="training-mission ${mission.completed ? "is-complete" : ""}">
            <div>
              <strong>${mission.title}</strong>
              <span>${gestureLabel(mission.gestureId)} · ${mission.successes}/${mission.targetSuccesses}</span>
            </div>
            <p>${mission.prompt}</p>
            <div class="training-progress"><i style="width:${progress}%"></i></div>
            <small>${mission.completed ? "완료" : `Perfect ${missionPerfectRate}%`}</small>
          </div>
        `;
      })
      .join("");

    this.trainingPanel.classList.add("is-visible");
    this.trainingPanel.innerHTML = `
      <div class="training-header">
        <div>
          <p>POSE TRAINING</p>
          <strong>훈련장 미션</strong>
        </div>
        <span>${totalCompleted}/${training.missions.length} 완료</span>
      </div>
      <div class="training-summary">
        <div><span>Perfect 성공률</span><strong>${perfectRate}%</strong></div>
        <div><span>최근 점수</span><strong>${last ? Math.round(last.score) : "--"}</strong></div>
        <div><span>최근 등급</span><strong class="${last ? `grade-${last.grade.toLowerCase()}` : ""}">${last ? gradeLabels[last.grade] : "READY"}</strong></div>
      </div>
      <div class="training-last">
        <b>${last ? gestureLabel(last.gestureId) : "포즈 대기"}</b>
        <span>${last ? last.reason : "스킬 버튼을 누른 뒤 포즈를 취하거나, 1/2/3으로 다음 미션을 테스트하세요."}</span>
      </div>
      <div class="training-camera-guide">
        <strong>카메라 보정 팁</strong>
        <span>상반신, 양어깨, 양손목이 모두 화면에 들어오게 1m 정도 떨어져 앉으세요. 역광을 피하고 손이 얼굴 밖으로 지나갈 만큼 공간을 확보하세요. 포즈는 스킬 준비 후 약 1.2초 안에 끝내면 가장 안정적입니다.</span>
      </div>
      <div class="training-mission-list">${missionRows}</div>
      <div class="training-unlock-note">완료 키: ${training.completedRewardKeys.length > 0 ? training.completedRewardKeys.join(" / ") : "아직 없음"}</div>
    `;
  }

  private renderHub(): void {
    if (!this.hubVisible || !this.latestState) {
      return;
    }

    const state = this.latestState;
    const characterProgress = this.progressSnapshot.characters[state.characterId];
    const skills = Object.values(getSkillsForCharacter(state.characterId));
    const skillKey = skills
      .map((skill) => {
        const progress = this.progressSnapshot.skills[skill.id];
        return `${skill.id}:${progress?.uses ?? 0}:${progress?.perfects ?? 0}:${progress?.level ?? 1}`;
      })
      .join("|");
    const renderKey = [
      state.characterId,
      this.progressSnapshot.equippedCoreId,
      this.progressSnapshot.equippedSkins[state.characterId],
      this.progressSnapshot.equippedEffectPaletteId,
      this.progressSnapshot.unlockedSkinIds.join(","),
      this.progressSnapshot.discoveredEnemyTypes.join(","),
      this.progressSnapshot.selectedAdventureStageId,
      ADVENTURE_STAGES.map((stage) => {
        const progress = this.progressSnapshot.adventureStages[stage.id];
        return `${stage.id}:${progress?.clears ?? 0}:${progress?.bestGrade ?? "-"}:${progress?.bestScore ?? 0}`;
      }).join("|"),
      this.progressSnapshot.daily.dateKey,
      characterProgress.xp,
      characterProgress.level,
      skillKey
    ].join("::");

    if (renderKey === this.hubRenderKey) {
      return;
    }
    this.hubRenderKey = renderKey;

    const equippedCore = getCoreDefinition(this.progressSnapshot.equippedCoreId);
    const characterCards = Object.values(CHARACTERS)
      .map((character) => {
        const progress = this.progressSnapshot.characters[character.id];
        return `
          <div class="hub-mini-card ${character.id === state.characterId ? "is-active" : ""}">
            <strong>${character.name}</strong>
            <span>Lv.${progress.level} · XP ${progress.xp}</span>
            <small>${progress.victories}/${progress.runs} 승리</small>
          </div>
        `;
      })
      .join("");
    const skillRows = skills
      .map((skill) => {
        const progress = this.progressSnapshot.skills[skill.id] ?? { uses: 0, perfects: 0, level: 1 };
        return `
          <div class="hub-skill-row">
            <strong>${skill.slot} ${skill.name}</strong>
            <span>숙련도 ${progress.level}/5</span>
            <small>${progress.uses}회 사용 · Perfect ${progress.perfects}</small>
          </div>
        `;
      })
      .join("");
    const coreButtons = CORES.map((core) => {
      const equipped = core.id === this.progressSnapshot.equippedCoreId;
      return `
        <button class="core-card ${equipped ? "is-equipped" : ""}" data-core-id="${core.id}">
          <strong>${core.title}</strong>
          <span>${core.description}</span>
          <small>${equipped ? "장착 중" : "장착"}</small>
        </button>
      `;
    }).join("");
    const adventureCards = ADVENTURE_STAGES.map((stage, index) => {
      const progress = this.progressSnapshot.adventureStages[stage.id] ?? { clears: 0, bestScore: 0, bestSeconds: 0, bestGrade: null };
      const previousStage = ADVENTURE_STAGES[index - 1];
      const unlocked = index === 0 || (previousStage ? (this.progressSnapshot.adventureStages[previousStage.id]?.clears ?? 0) > 0 : false);
      const selected = this.progressSnapshot.selectedAdventureStageId === stage.id;
      const cleared = progress.clears > 0;
      return `
        <button class="adventure-stage-card ${selected ? "is-selected" : ""} ${cleared ? "is-cleared" : ""}" data-stage-id="${stage.id}" ${unlocked ? "" : "disabled"}>
          <i>${stage.code}</i>
          <strong>${stage.title}</strong>
          <span>${stage.region} · ${stage.goal}</span>
          <small>${
            unlocked
              ? cleared
                ? `BEST ${progress.bestGrade ?? "C"} · ${progress.bestScore}점 · ${Math.ceil(progress.bestSeconds)}초`
                : selected
                  ? "선택됨 · 첫 클리어 도전"
                  : "도전 가능"
              : "이전 단계를 클리어하면 해금"
          }</small>
        </button>
      `;
    }).join("");
    const selectedSkinId = this.progressSnapshot.equippedSkins[state.characterId];
    const skinCards = getSkinsForCharacter(state.characterId)
      .map((skin) => {
        const unlocked = this.progressSnapshot.unlockedSkinIds.includes(skin.id);
        const equipped = skin.id === selectedSkinId;
        return `
          <button class="skin-card ${equipped ? "is-equipped" : ""}" data-skin-id="${skin.id}" style="--skin-color:${skin.themeColor}" ${unlocked ? "" : "disabled"}>
            <i>${skin.shortLabel}</i>
            <strong>${skin.title}</strong>
            <span>${skin.description}</span>
            <small>${equipped ? "장착 중" : unlocked ? "장착" : "잠김"}</small>
          </button>
        `;
      })
      .join("");
    const effectCards = EFFECT_PALETTES.map((palette) => {
      const equipped = palette.id === this.progressSnapshot.equippedEffectPaletteId;
      const unlocked = this.progressSnapshot.unlockedEffectPaletteIds.includes(palette.id);
      return `
        <button class="effect-card ${equipped ? "is-equipped" : ""}" data-effect-id="${palette.id}" style="--effect-color:${palette.uiColor}" ${unlocked ? "" : "disabled"}>
          <i>${palette.shortLabel}</i>
          <strong>${palette.title}</strong>
          <span>${palette.description}</span>
          <small>${equipped ? "적용 중" : unlocked ? "적용" : "잠김"}</small>
        </button>
      `;
    }).join("");
    const storyCards = STORY_ENTRIES.filter((entry) => entry.characterId === state.characterId)
      .map((entry) => {
        const unlocked = characterProgress.level >= entry.requiredLevel;
        return `
          <div class="story-card ${unlocked ? "" : "is-locked"}">
            <strong>${entry.title}</strong>
            <span>${unlocked ? entry.body : `Lv.${entry.requiredLevel}에 해금됩니다.`}</span>
          </div>
        `;
      })
      .join("");
    const codexCards = NOISE_CODEX.map((entry) => {
      const discovered = this.progressSnapshot.discoveredEnemyTypes.includes(entry.enemyType);
      return `
        <div class="codex-card ${discovered ? "" : "is-locked"}" data-enemy-type="${entry.enemyType}">
          <strong>${discovered ? entry.title : "미발견 노이즈"}</strong>
          <span>${discovered ? `${entry.role} · 약점: ${entry.weakness}` : "전투에서 마주치면 정보가 기록됩니다."}</span>
          <small>${discovered ? entry.description : "???"}</small>
        </div>
      `;
    }).join("");

    this.hubOverlay.innerHTML = `
      <div class="hub-panel">
        <div class="hub-header">
          <div>
            <p>LOOP CITY HUB</p>
            <h2>루프시티 거점</h2>
          </div>
          <button class="hub-close" type="button">닫기</button>
        </div>
        <div class="hub-grid">
          <section class="hub-section hub-hero">
            <strong>${getCharacter(state.characterId).name} Lv.${characterProgress.level}</strong>
            <span>${getCharacter(state.characterId).title}</span>
            <div class="hub-xp"><i style="width:${Math.min(100, characterProgress.xp % 100)}%"></i></div>
            <small>Perfect Cast ${characterProgress.perfectCasts}회 · 장착 코어 ${equippedCore.title}</small>
          </section>
          <section class="hub-section">
            <strong>오늘의 데일리 챌린지</strong>
            <span>${this.progressSnapshot.daily.title}</span>
            <small>${this.progressSnapshot.daily.description}</small>
          </section>
          <section class="hub-section hub-facilities">
            <strong>시설</strong>
            <span>모션 연구소 · 캐릭터 라운지 · 코어 공방 · 훈련장 · 노이즈 도감 · 스타일 룸</span>
            <div class="hub-action-row">
              <button class="hub-training" type="button">훈련장</button>
              <button class="hub-adventure" type="button">모험 시작</button>
            </div>
          </section>
          <section class="hub-section hub-wide adventure-map-section">
            <strong>모험 지도</strong>
            <span>클리어한 단계는 기록되고, 다음 단계가 차례로 열립니다. 카드를 누르면 그 단계부터 바로 시작합니다.</span>
            <div class="adventure-map-grid">${adventureCards}</div>
          </section>
          <section class="hub-section hub-wide">
            <strong>스타일 룸</strong>
            <span>${getCharacter(state.characterId).name} 외형과 스킬 이펙트 팔레트를 고릅니다.</span>
            <div class="style-subtitle">캐릭터 스킨</div>
            <div class="style-grid">${skinCards}</div>
            <div class="style-subtitle">이펙트 스킨</div>
            <div class="effect-grid">${effectCards}</div>
          </section>
          <section class="hub-section hub-wide">
            <strong>캐릭터 라운지</strong>
            <span>플레이할수록 캐릭터 에피소드와 대사가 열립니다.</span>
            <div class="story-list">${storyCards}</div>
          </section>
          <section class="hub-section hub-wide">
            <strong>노이즈 도감</strong>
            <span>모험 중 마주친 적의 역할과 대응법을 기록합니다.</span>
            <div class="codex-grid">${codexCards}</div>
          </section>
          <section class="hub-section hub-wide">
            <strong>캐릭터 성장</strong>
            <div class="hub-card-grid">${characterCards}</div>
          </section>
          <section class="hub-section hub-wide">
            <strong>스킬 숙련도</strong>
            <div class="hub-skill-list">${skillRows}</div>
          </section>
          <section class="hub-section hub-wide">
            <strong>코어 공방</strong>
            <div class="core-grid">${coreButtons}</div>
          </section>
        </div>
      </div>
    `;

    this.hubOverlay.querySelector<HTMLButtonElement>(".hub-close")?.addEventListener("click", () => this.toggleHub(false));
    this.hubOverlay.querySelector<HTMLButtonElement>(".hub-training")?.addEventListener("click", () => {
      this.options.onModeSelected("training");
      this.toggleHub(false);
    });
    this.hubOverlay.querySelector<HTMLButtonElement>(".hub-adventure")?.addEventListener("click", () => {
      this.options.onModeSelected("adventure");
      this.toggleHub(false);
    });
    this.hubOverlay.querySelectorAll<HTMLButtonElement>(".adventure-stage-card").forEach((button) => {
      button.addEventListener("click", () => {
        const stageId = button.dataset.stageId;
        if (stageId) {
          this.options.onAdventureStageSelected(stageId);
          this.toggleHub(false);
        }
      });
    });
    this.hubOverlay.querySelectorAll<HTMLButtonElement>(".core-card").forEach((button) => {
      button.addEventListener("click", () => {
        const coreId = button.dataset.coreId as CoreId | undefined;
        if (coreId) {
          this.options.onCoreSelected(coreId);
          this.options.onHubToggled(true);
          this.hubRenderKey = "";
          this.renderHub();
        }
      });
    });
    this.hubOverlay.querySelectorAll<HTMLButtonElement>(".skin-card").forEach((button) => {
      button.addEventListener("click", () => {
        const skinId = button.dataset.skinId as CharacterSkinId | undefined;
        if (skinId) {
          this.options.onSkinSelected(state.characterId, skinId);
          this.options.onHubToggled(true);
          this.hubRenderKey = "";
          this.renderHub();
        }
      });
    });
    this.hubOverlay.querySelectorAll<HTMLButtonElement>(".effect-card").forEach((button) => {
      button.addEventListener("click", () => {
        const effectId = button.dataset.effectId as EffectPaletteId | undefined;
        if (effectId) {
          this.options.onEffectPaletteSelected(effectId);
          this.options.onHubToggled(true);
          this.hubRenderKey = "";
          this.renderHub();
        }
      });
    });
  }

  private renderRewards(state: GameState): void {
    const key = state.pendingRewardIds.join("|");
    if (key === this.rewardKey) {
      this.rewardsOverlay.classList.toggle("is-visible", state.pendingRewardIds.length > 0);
      return;
    }

    this.rewardKey = key;
    this.rewardsOverlay.innerHTML = "";
    if (state.pendingRewardIds.length === 0) {
      this.rewardsOverlay.classList.remove("is-visible");
      return;
    }

    const panel = div("reward-panel");
    const title = document.createElement("h2");
    title.textContent = state.mode === "adventure" ? `${state.adventureStageCode} Stage Clear` : "Motion Core Reward";
    panel.appendChild(title);

    const cards = div("reward-cards");
    for (const rewardId of state.pendingRewardIds) {
      const reward = REWARDS.find((item) => item.id === rewardId);
      if (!reward) {
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = `reward-card rarity-${reward.rarity}`;
      button.innerHTML = `
        <i class="reward-rarity">${rarityLabels[reward.rarity]}</i>
        <strong>${reward.title}</strong>
        <span>${reward.description}</span>
        <small>${reward.characterId ? `${getCharacter(reward.characterId).name} 전용` : "공용"} · ${reward.tags.join(" / ")}</small>
      `;
      button.addEventListener("click", () => this.options.onRewardSelected(reward.id));
      cards.appendChild(button);
    }
    panel.appendChild(cards);
    this.rewardsOverlay.appendChild(panel);
    this.rewardsOverlay.classList.add("is-visible");
  }

  private renderModal(state: GameState): void {
    if (this.hubVisible) {
      this.modalOverlay.classList.remove("is-visible");
      this.modalKey = "";
      return;
    }

    const stats = state.runStats;
    const key = [
      state.paused,
      state.gameOver,
      state.victory,
      state.mode,
      state.characterId,
      Math.floor(state.modeTime),
      state.player.score,
      stats.kills,
      stats.perfectCasts,
      stats.greatCasts,
      stats.normalCasts,
      stats.misses,
      stats.maxPerfectCombo,
      stats.damageTaken,
      stats.skillsUsed,
      stats.xpGained,
      stats.unlockedItems.map((item) => item.id).join(","),
      stats.rewardsChosen.join(",")
    ].join(":");
    if (key === this.modalKey) {
      return;
    }
    this.modalKey = key;

    if (state.victory || state.gameOver) {
      this.modalPanel.className = "modal-panel result-panel";
      const character = getCharacter(state.characterId);
      const nextStage = state.mode === "adventure" ? ADVENTURE_STAGES[state.adventureStageIndex + 1] : undefined;
      const rewardItems =
        stats.rewardsChosen.length > 0
          ? stats.rewardsChosen
              .map((rewardId) => REWARDS.find((reward) => reward.id === rewardId))
              .filter((reward): reward is NonNullable<typeof reward> => Boolean(reward))
              .map((reward) => `<li class="rarity-${reward.rarity}"><i>${rarityLabels[reward.rarity]}</i><span>${reward.title}</span></li>`)
              .join("")
          : `<li class="empty-result-reward"><span>선택한 보상 없음</span></li>`;
      const levelText =
        stats.levelAfter > stats.levelBefore
          ? `LV ${stats.levelBefore} → ${stats.levelAfter}`
          : `LV ${stats.levelAfter}`;
      const unlockItems =
        stats.unlockedItems.length > 0
          ? stats.unlockedItems
              .map(
                (item) => `
                  <li>
                    <i>${unlockTypeLabel(item.type)}</i>
                    <div>
                      <strong>${item.title}</strong>
                      <span>${item.description}</span>
                    </div>
                  </li>
                `
              )
              .join("")
          : `<li class="empty-unlock"><div><strong>새 해금 없음</strong><span>다음 판에서 조건을 노려보세요.</span></div></li>`;

      this.modalPanel.innerHTML = `
        <div class="result-header">
          <p>${state.victory ? "RUN CLEAR" : "RUN FAILED"}</p>
          <h1>${state.victory ? "Pose Break Result" : "Noise Overwhelmed"}</h1>
          <span>${character.name} · ${modeLabel(state.mode)} · ${state.stageName}</span>
        </div>
        <div class="result-summary-grid">
          ${resultStat("생존 시간", formatDuration(state.modeTime || state.time))}
          ${resultStat("점수", state.player.score.toLocaleString())}
          ${resultStat("처치 수", stats.kills.toLocaleString())}
          ${resultStat("획득 XP", `+${stats.xpGained.toLocaleString()}`)}
          ${resultStat("레벨", levelText)}
          ${resultStat("받은 피해", stats.damageTaken.toLocaleString())}
        </div>
        <div class="result-body-grid">
          <section class="result-section">
            <strong>Cast Grade</strong>
            <div class="cast-grade-grid">
              ${resultGrade("Perfect", stats.perfectCasts)}
              ${resultGrade("Great", stats.greatCasts)}
              ${resultGrade("Normal", stats.normalCasts)}
              ${resultGrade("Miss", stats.misses)}
            </div>
            <div class="result-combo-line">
              <span>최고 Perfect 콤보</span>
              <b>x${stats.maxPerfectCombo}</b>
            </div>
            <div class="result-combo-line">
              <span>스킬 사용</span>
              <b>${stats.skillsUsed}</b>
            </div>
          </section>
          <section class="result-section">
            <strong>Chosen Rewards</strong>
            <ul class="result-reward-list">${rewardItems}</ul>
          </section>
          <section class="result-section result-unlock-section">
            <strong>New Unlocks</strong>
            <ul class="result-unlock-list">${unlockItems}</ul>
          </section>
        </div>
        <div class="result-actions">
          <button class="result-button primary result-retry" type="button">다시 도전</button>
          <button class="result-button result-hub" type="button">허브 열기</button>
          <button class="result-button result-training" type="button">훈련장</button>
          <button class="result-button result-next-adventure" type="button" ${nextStage ? "" : "disabled"}>
            ${nextStage ? `다음 모험 스테이지` : "다음 모험 스테이지 없음"}
          </button>
        </div>
      `;

      this.modalOverlay.classList.add("is-visible");
      this.modalPanel.querySelector<HTMLButtonElement>(".result-retry")?.addEventListener("click", () => this.options.onRestart());
      this.modalPanel.querySelector<HTMLButtonElement>(".result-hub")?.addEventListener("click", () => this.toggleHub(true));
      this.modalPanel.querySelector<HTMLButtonElement>(".result-training")?.addEventListener("click", () => this.options.onModeSelected("training"));
      this.modalPanel.querySelector<HTMLButtonElement>(".result-next-adventure")?.addEventListener("click", () => {
        if (nextStage) {
          this.options.onAdventureStageSelected(nextStage.id);
        }
      });
    } else if (state.paused) {
      this.modalPanel.className = "modal-panel";
      this.modalPanel.innerHTML = `
        <h1 class="modal-title">Paused</h1>
        <p class="modal-text">숨을 고르고 다시 움직일 시간입니다.</p>
      `;
      this.modalOverlay.classList.add("is-visible");
    } else {
      this.modalOverlay.classList.remove("is-visible");
    }
  }
}

function div(className: string): HTMLElement {
  const element = document.createElement("div");
  element.className = className;
  return element;
}

function resultStat(label: string, value: string): string {
  return `
    <div class="result-stat">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function resultGrade(label: CastGrade, value: number): string {
  return `
    <div class="result-grade grade-${label.toLowerCase()}">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutesText = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const secondsText = (total % 60).toString().padStart(2, "0");
  return `${minutesText}:${secondsText}`;
}

function modeLabel(mode: GameMode): string {
  const labels: Record<GameMode, string> = {
    story: "전투",
    adventure: "모험",
    survival: "생존",
    "boss-rush": "보스 러시",
    training: "훈련장"
  };
  return labels[mode];
}

function unlockTypeLabel(type: "core" | "skin" | "effect"): string {
  const labels: Record<"core" | "skin" | "effect", string> = {
    core: "CORE",
    skin: "SKIN",
    effect: "FX"
  };
  return labels[type];
}

function gestureLabel(gesture: BossChallengeState["requiredGesture"]): string {
  const labels: Record<BossChallengeState["requiredGesture"], string> = {
    slash: "슬래시",
    thrust: "팜 스러스트",
    rise: "라이즈",
    "open-arms": "오픈 암",
    "cross-guard": "크로스 가드",
    "palm-push": "팜 푸시",
    "ground-slam": "그라운드 슬램",
    point: "포인트",
    circle: "서클",
    wave: "웨이브",
    spread: "스프레드",
    heart: "하트",
    "focus-triangle": "포커스 트라이앵글"
  };
  return labels[gesture];
}
