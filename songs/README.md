# 曲フォルダ

曲ごとにサブフォルダを作り、`chart.json`と音声ファイルを入れてください。背景用GLBも同じ曲フォルダへ置けます。

```text
songs/
  neon-circuit/
    chart.json
    audio.wav
    night_sky_visible_spectrum_monochromatic.glb
  my-song/
    chart.json
    audio.ogg
    backgrounds/
      stage.glb
```

`chart.json`の`audio`には、同じフォルダの音声ファイル名を指定します。
曲一覧は起動中のサーバーが自動取得します。追加・編集後はゲーム内の「選曲 → 一覧を更新」を押してください。
Static Siteとして公開する場合は、プロジェクト直下の`npm run build`で曲一覧と公開ファイルを生成します。追加・編集後は再ビルドし、`dist/`の中身を公開し直してください。
新しい曲のひな形は`examples/song/chart.json`です。コピーして音声ファイルを追加してください。
`neon-circuit/audio.wav`は初回のサーバー起動時に生成されます。既存ファイルは上書きしません。
サンプル曲は、追加済みの夜空GLBを8拍目から表示する設定になっています。
背景GLBは`events`の`backgroundGLB`で、JSONからの相対パス・表示時刻・表示時間を指定します。
エディタでは「背景GLB」の段へ配置し、曲フォルダ内のファイルを選択できます。
譜面と演出の詳しい書式はプロジェクト直下のREADME.mdを参照してください。

