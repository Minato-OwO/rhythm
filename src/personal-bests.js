// 旧方式(v1/v2)の記録は残し、基本100万点＋PERFECT+方式を別に保存する。
const STORAGE_KEY = 'fourflow.personal-bests.v3';

function isRecord(value) {
  return value !== null && typeof value === 'object'
    && Number.isSafeInteger(value.score) && value.score >= 0
    && Number.isFinite(value.accuracy) && value.accuracy >= 0 && value.accuracy <= 100
    && (value.bonusAccuracy === undefined || Number.isFinite(value.bonusAccuracy) && value.bonusAccuracy >= 0 && value.bonusAccuracy <= 10)
    && Number.isSafeInteger(value.maxCombo) && value.maxCombo >= 0;
}

// 難易度IDごとに各項目の最高値を保存する。保存不可でも現在のセッションでは使える。
export class PersonalBests {
  constructor() {
    this.records = new Map();
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
      if (saved?.version !== 3 || !saved.charts || typeof saved.charts !== 'object' || Array.isArray(saved.charts)) return;
      for (const [id, value] of Object.entries(saved.charts)) {
        if (id && isRecord(value)) this.records.set(id, { score: value.score, accuracy: value.accuracy, bonusAccuracy: value.bonusAccuracy ?? 0, maxCombo: value.maxCombo });
      }
    } catch { /* 保存データを読めない場合は未プレイから開始する。 */ }
  }

  get(id) {
    return this.records.get(id) ?? null;
  }

  record(id, result) {
    if (typeof id !== 'string' || !id || !isRecord(result) || result.autoplay) return;
    const previous = this.get(id);
    const bonusAccuracy = result.bonusAccuracy ?? 0;
    const totalAccuracy = result.accuracy + bonusAccuracy;
    const previousTotalAccuracy = previous ? previous.accuracy + previous.bonusAccuracy : -1;
    // 精度の内訳は同じプレイの組で保存し、別々の最高値を合成しない。
    const replaceAccuracy = !previous || totalAccuracy > previousTotalAccuracy || totalAccuracy === previousTotalAccuracy && result.accuracy > previous.accuracy;
    const next = {
      score: Math.max(previous?.score ?? 0, result.score),
      accuracy: replaceAccuracy ? result.accuracy : previous.accuracy,
      bonusAccuracy: replaceAccuracy ? bonusAccuracy : previous.bonusAccuracy,
      maxCombo: Math.max(previous?.maxCombo ?? 0, result.maxCombo),
    };
    if (previous && previous.score === next.score && previous.accuracy === next.accuracy && previous.bonusAccuracy === next.bonusAccuracy && previous.maxCombo === next.maxCombo) return;
    this.records.set(id, next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 3, charts: Object.fromEntries(this.records) }));
    } catch { /* 永続保存できなくてもメモリー上の記録を保持する。 */ }
  }
}
