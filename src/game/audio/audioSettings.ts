export interface AudioSettings {
  soundEnabled: boolean;
}

const AUDIO_STORAGE_KEY = "movecasters.pose-break.audio.v1";
const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  soundEnabled: true
};

export function loadAudioSettings(): AudioSettings {
  if (typeof window === "undefined") {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }

  try {
    const raw = window.localStorage.getItem(AUDIO_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_AUDIO_SETTINGS };
    }
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      soundEnabled: parsed.soundEnabled ?? DEFAULT_AUDIO_SETTINGS.soundEnabled
    };
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

export function saveAudioSettings(settings: AudioSettings): AudioSettings {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Local storage can be unavailable in private or embedded contexts.
    }
  }
  return settings;
}

export function isSoundEnabled(): boolean {
  return loadAudioSettings().soundEnabled;
}

export function setSoundEnabled(soundEnabled: boolean): AudioSettings {
  return saveAudioSettings({ soundEnabled });
}

export function toggleSoundEnabled(): AudioSettings {
  return setSoundEnabled(!isSoundEnabled());
}
