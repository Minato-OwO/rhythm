export const NOTE_KINDS = [
  ['tap', 'タップ'], ['hold', 'LN'], ['fakeTap', 'フェイクTAP'], ['fakeHold', 'フェイクLN'],
];

function kindFlags(kind) {
  if (!NOTE_KINDS.some(([value]) => value === kind)) throw new Error('ノーツの種類が不正です。');
  return { fake: kind === 'fakeTap' || kind === 'fakeHold', hold: kind === 'hold' || kind === 'fakeHold' };
}

export function getNoteKind(doc, item) {
  return item.data.fake ? doc.duration(item) > 0 ? 'fakeHold' : 'fakeTap' : doc.duration(item) > 0 ? 'hold' : 'tap';
}

export function createNoteData(doc, seconds, kind) {
  const { fake, hold } = kindFlags(kind);
  return {
    ...(fake ? { fake: true } : {}),
    ...(hold ? { endBeat: Number((doc.beat(seconds) + 1).toFixed(9)) } : {}),
  };
}

export function setNoteKind(doc, item, kind) {
  const { fake, hold } = kindFlags(kind);
  if (fake) item.data.fake = true; else delete item.data.fake;
  if (hold) {
    // 通常LN↔フェイクLNでは長さと個別SVを保持する。
    if (doc.duration(item) <= 0) doc.setEndTime(item, doc.time(item) + 60 / doc.metadata.bpm);
  } else { delete item.data.endTimeSeconds; delete item.data.endBeat; }
}
