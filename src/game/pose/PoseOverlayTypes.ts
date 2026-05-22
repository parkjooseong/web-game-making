import type { NormalizedLandmark, PoseLandmarkerResult } from "@mediapipe/tasks-vision";

export type PoseStatus = "idle" | "starting" | "ready" | "permission-needed" | "unsupported" | "unstable" | "error";

export interface PoseOverlayFrame {
  landmarks: NormalizedLandmark[] | null;
  timestamp: number;
  status: PoseStatus;
}

export type PoseFrameListener = (frame: PoseOverlayFrame) => void;

export interface BufferedPoseFrame {
  result: PoseLandmarkerResult;
  timestamp: number;
}
