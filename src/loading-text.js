let pending;

// フォント本体は配布せず、指定フォントで描画した文字画像だけを読み込む。
export function loadLoadingText() {
  if (!pending) {
    const load = filename => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('ローディング文字を読み込めません: ' + filename));
      image.src = new URL('../assets/' + filename, import.meta.url).href;
    });
    pending = Promise.all([load('loading-status.png'), load('loading-word.png')])
      .then(([atlas, word]) => ({ atlas, word }))
      .catch(error => { pending = undefined; throw error; });
  }
  return pending;
}
