/* 描画前に配色を決めて “ちらつき” を防ぐ（Undercurrent 本体と同じ保存キー） */
(function () {
  try {
    var t = JSON.parse(localStorage.getItem('uc.theme') || 'null');
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch (e) {
    /* 保存領域が使えない環境では OS の設定に従う */
  }
})();
