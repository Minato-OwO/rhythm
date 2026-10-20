// 親画面で作った時計をiframeと共有する。子側のフレーム時刻・timeOriginを混ぜない。
export function createPreviewClock(audioManager, getRevision, getFrameTime = () => document.timeline.currentTime ?? performance.now()) {
  return Object.freeze({
    sample(result = {}) {
      result.time = audioManager.getCurrentTime(getFrameTime());
      result.playing = audioManager.isPlaying;
      result.revision = getRevision();
      return result;
    },
  });
}
