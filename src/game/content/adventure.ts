import type { EnemyType } from "../simulation/types";

export interface AdventureStageDefinition {
  id: string;
  code: string;
  region: string;
  title: string;
  goal: string;
  enemies: EnemyType[];
  startMessage: string;
}

export const ADVENTURE_STAGES: AdventureStageDefinition[] = [
  {
    id: "1-1",
    code: "1-1",
    region: "루프시티",
    title: "루프시티 거리",
    goal: "러너 무리를 정화하세요",
    enemies: ["runner", "runner", "runner", "swarm", "swarm", "shooter"],
    startMessage: "AREA 1-1"
  },
  {
    id: "1-2",
    code: "1-2",
    region: "루프시티",
    title: "지하철 입구",
    goal: "슈터와 탱커의 봉쇄를 돌파하세요",
    enemies: ["runner", "runner", "shooter", "shooter", "tank", "swarm", "swarm"],
    startMessage: "AREA 1-2"
  },
  {
    id: "1-3",
    code: "1-3",
    region: "루프시티",
    title: "드럼 노이즈",
    goal: "리듬 탄막을 피하고 첫 보스를 쓰러뜨리세요",
    enemies: ["runner", "swarm", "shooter", "drum"],
    startMessage: "BOSS 1"
  },
  {
    id: "2-1",
    code: "2-1",
    region: "놀이공원",
    title: "고장난 놀이공원",
    goal: "몰려오는 스웜을 장판과 광역기로 처리하세요",
    enemies: ["swarm", "swarm", "swarm", "runner", "runner", "shooter", "tank"],
    startMessage: "AREA 2-1"
  },
  {
    id: "2-2",
    code: "2-2",
    region: "미러 타워",
    title: "미러 타워",
    goal: "거울 분신과 원거리 압박을 끊어내세요",
    enemies: ["runner", "shooter", "tank", "mirror", "swarm", "swarm"],
    startMessage: "AREA 2-2"
  },
  {
    id: "2-3",
    code: "2-3",
    region: "미러 타워",
    title: "아이리스, 거울의 마녀",
    goal: "복사 패턴을 다른 스킬로 깨뜨리세요",
    enemies: ["runner", "shooter", "mirror"],
    startMessage: "BOSS 2"
  },
  {
    id: "3-1",
    code: "3-1",
    region: "제로 존",
    title: "제로 존 진입",
    goal: "코어를 방해하는 노이즈를 빠르게 정리하세요",
    enemies: ["tank", "tank", "shooter", "shooter", "mirror", "runner", "swarm"],
    startMessage: "AREA 3-1"
  },
  {
    id: "3-2",
    code: "3-2",
    region: "제로 존",
    title: "제로 모션",
    goal: "움직임을 빼앗는 최종 보스를 정화하세요",
    enemies: ["runner", "shooter", "tank", "zero"],
    startMessage: "FINAL"
  }
];
