let file;
const QUESTIONS_PER_SESSION = 15;
let csvData = [];
let currentIndex = 0;
let judgments = [];
let indexArray = [];
let currentUser = ''; // ユーザー名を保存

// ユーザー名入力のイベントリスナーを追加
document.getElementById('userNameInput').addEventListener('input', function(e) {
  currentUser = e.target.value;
});

// データベースから問題データを読み込む関数
async function loadProblemsFromDatabase() {
  try {
    const response = await fetch('/api/problems?random=true&limit=100');
    if (!response.ok) {
      throw new Error('問題データの取得に失敗しました');
    }
    
    const problems = await response.json();
    console.log('取得したデータ:', problems); // デバッグ用ログ
    
    if (problems.length === 0) {
      throw new Error('データベースに問題データがありません');
    }
    
    // データを適切な形式に変換（id, strategy_text, sustainability_textを含む）
    csvData = problems.map(problem => {
      return {
        id: problem.problem_id, // ←ここをproblem_idに
        strategy: problem.strategy_text,
        sustainability: problem.sustainability_text,
        company_name: problem.company_name
      };
    });
    
    console.log('変換後のcsvData:', csvData); // デバッグ用ログ
    console.log(`データベースから${csvData.length}件の問題を読み込みました`);
    
    // インデックス配列を初期化してシャッフル
    indexArray = [...Array(csvData.length).keys()];
    shuffleArray(indexArray);
    currentIndex = 0;
    judgments = [];
    
    return true;
  } catch (error) {
    console.error('問題データ読み込みエラー:', error);
    alert(`問題データの読み込みに失敗しました: ${error.message}`);
    return false;
  }
}

// 評価開始関数
async function startEvaluation() {
  // ユーザー名が入力されているかチェック
  if (!currentUser || currentUser.trim() === '') {
    alert('ユーザー名を入力してください');
    return;
  }

  // 確認ポップアップ
  const confirmStart = confirm(`${currentUser}として開始します、よろしいですか？`);
  if (!confirmStart) {
    return;
  }

  // ユーザー名入力欄を無効化
  document.getElementById('userNameInput').disabled = true;

  // 開始ボタンを無効化
  const startButton = document.getElementById('startButton');
  startButton.disabled = true;
  startButton.textContent = '読み込み中...';

  // データベースから問題を読み込み
  const success = await loadProblemsFromDatabase();

  if (success) {
    // UI更新
    startButton.style.display = 'none';
    document.getElementById('exitButton').style.display = 'inline'; // ←ここで表示
    updateProgressBar();
    showNextPair();
  } else {
    // エラーの場合はボタンを再度有効化
    startButton.disabled = false;
    startButton.textContent = '評価を開始';
    document.getElementById('userNameInput').disabled = false;
  }
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function showNextPair() {
  updateProgressBar();
  // 最大15問で終了
  if (currentIndex >= csvData.length || currentIndex >= 15) {
    document.getElementById('comparisonArea').style.display = 'none';
    askToContinue(); // 15問到達時に終了確認
    return;
  }
  const rowIndex = indexArray[currentIndex];
  const problemData = csvData[rowIndex];

  // 戦略部分にstrategy_text、取り組み部分にsustainability_textを表示
  document.getElementById('strategyText').textContent = problemData.strategy;
  document.getElementById('sustainabilityText').textContent = problemData.sustainability;
  document.getElementById('comparisonArea').style.display = 'block';
}

function recordJudgment(level) {
  if (!currentUser || currentUser.trim() === '') {
    alert('ユーザー名を入力してください');
    return;
  }

  const rowIndex = indexArray[currentIndex];
  const problemData = csvData[rowIndex];

  // 判定データを配列に保存（送信はしない）
  judgments.push({
    userName: currentUser,
    strategyText: problemData.strategy,
    sustainabilityText: problemData.sustainability,
    combinationId: problemData.id,
    score: level,
    timestamp: new Date().toISOString()
  });

  // 使用回数インクリメントは即時でOK
  incrementProblemUsage(problemData.id);

  currentIndex++;
  updateProgressBar();

  // 最大15問で終了
  if (currentIndex >= csvData.length || currentIndex >= 15) {
    askToContinue();
  } else {
    showNextPair();
  }
}

// 問題の使用回数をインクリメントする関数
async function incrementProblemUsage(problemId) {
  try {
    const response = await fetch(`/api/problems/${encodeURIComponent(problemId)}/increment-usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.warn(`使用回数の更新に失敗しました (ID: ${problemId})`);
    } else {
      const result = await response.json();
      console.log(`問題 ${problemId} の使用回数を更新しました:`, result);
    }
  } catch (error) {
    console.error('使用回数更新エラー:', error);
    // エラーでも処理は継続する
  }
}

// データベースに判定結果を保存する関数
async function saveJudgmentToDatabase(strategyText, sustainabilityText, score, originalId) {
  try {
    const judgmentData = {
      userName: currentUser,
      strategyText: strategyText,
      sustainabilityText: sustainabilityText,
      combinationId: originalId, // 元のID（S100TWSV1など）をproblem_idとして使用
      score: score,
      timestamp: new Date().toISOString()
    };

    const response = await fetch('/api/judgments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(judgmentData)
    });

    if (!response.ok) {
      throw new Error('データベースへの保存に失敗しました');
    }

    const result = await response.json();
    console.log('判定結果が保存されました:', result);
    return true;
  } catch (error) {
    console.error('データベース保存エラー:', error);
    // エラーの場合はローカルストレージに一時保存
    saveToLocalStorage({
      userName: currentUser,
      strategyText: strategyText,
      sustainabilityText: sustainabilityText,
      combinationId: originalId,
      score: score,
      timestamp: new Date().toISOString()
    });
    return false;
  }
}

// 組み合わせIDを生成する関数
function generateCombinationId(strategy, sustainability) {
  const combined = strategy + sustainability;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 32bit整数に変換
  }
  return Math.abs(hash).toString(36);
}

// ローカルストレージに一時保存する関数
function saveToLocalStorage(judgmentData) {
  const stored = JSON.parse(localStorage.getItem('pendingJudgments') || '[]');
  stored.push(judgmentData);
  localStorage.setItem('pendingJudgments', JSON.stringify(stored));
  console.log('ローカルストレージに一時保存しました');
}

function updateProgressBar() {
  const maxQuestions = 15;
  const progress = (currentIndex / maxQuestions) * 100;
  document.getElementById('progressBar').style.width = progress + '%';
  document.getElementById('progressText').textContent = 
    `${currentIndex} / ${maxQuestions} (${Math.round(progress)}%)`;
}

// 継続確認
function askToContinue() {
  // 追加：アンケート終了確認のポップアップ
  const confirmEnd = confirm('全てのアンケートを終了します、よろしいですか？');
  if (!confirmEnd) {
    // キャンセルした場合は一つ前の設問に戻る
    goBack();
    return;
  }

  // 完了画面を表示
  showCompletionScreen();
}

function showCompletionScreen() {
  // 既存の要素を非表示
  document.getElementById('progressBarContainer').style.display = 'none';
  document.querySelector('div').style.display = 'none'; // ユーザー名入力div
  document.getElementById('comparisonArea').style.display = 'none';
  
  // 「途中で終了する」ボタンを非表示または削除
  const exitButton = document.getElementById('exitButton');
  if (exitButton) {
    exitButton.style.display = 'none';
  }

  // h2タイトルを書き換え
  const h2 = document.querySelector('h2');
  if (h2) {
    h2.textContent = '全ての作業が完了しました';
  }

  // 完了メッセージ（必要なら追加で表示）
  let completeDiv = document.getElementById('completionMessage');
  if (!completeDiv) {
    completeDiv = document.createElement('div');
    completeDiv.id = 'completionMessage';
    completeDiv.style.textAlign = 'center';
    completeDiv.style.marginTop = '100px';
    completeDiv.innerHTML = `<p style="font-size:1.3em;">ご協力ありがとうございました。</p>`;
    document.body.appendChild(completeDiv);
  } else {
    completeDiv.style.display = '';
  }

  // 「続けて回答する」ボタンを毎回再表示
  let continueBtn = document.getElementById('continueButton');
  if (!continueBtn) {
    continueBtn = document.createElement('button');
    continueBtn.id = 'continueButton';
    continueBtn.textContent = '続けて回答する';
    continueBtn.style.marginTop = '30px';
    continueBtn.style.fontSize = '1.1em';
    completeDiv.appendChild(continueBtn);
  }
  continueBtn.style.display = '';
  continueBtn.onclick = async function() {
    completeDiv.style.display = 'none';
    continueBtn.style.display = 'none';

    // UIを初期状態に戻す
    document.getElementById('progressBarContainer').style.display = '';
    document.querySelector('div').style.display = ''; // ユーザー名入力div
    document.getElementById('comparisonArea').style.display = 'none';
    const h2 = document.querySelector('h2');
    if (h2) {
      h2.textContent = '整合性があるかどうかを判断してください。';
    }

    // 新しい問題セットを取得して再開
    const success = await loadProblemsFromDatabase();
    if (success) {
      updateProgressBar();
      showNextPair();
    } else {
      alert('新しい問題データの取得に失敗しました');
    }
  };

  sendAllJudgments(); // ここでまとめて送信
}

// データベースから結果をダウンロードする関数
async function downloadDatabaseResults() {
  try {
    const response = await fetch(`/api/judgments?userName=${encodeURIComponent(currentUser)}`);
    if (!response.ok) {
      throw new Error('データベースからのデータ取得に失敗しました');
    }
    
    const data = await response.json();
    
    // CSVフォーマットに変換（idが問題IDになる）
    const csvContent = [
      ['問題ID', 'ユーザー名', '経営戦略', 'サステナビリティ', 'スコア', '回答日時', '作成日時'],
      ...data.map(row => [
        row.id, // idが問題ID（S100TWSV1など）
        row.userName,
        `"${row.strategyText.replace(/"/g, '""')}"`,
        `"${row.sustainabilityText.replace(/"/g, '""')}"`,
        row.score,
        row.timestamp,
        row.created_at
      ])
    ].map(row => row.join(',')).join('\n');

    // ダウンロード
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8-sig;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `evaluation_results_${currentUser}_${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
  } catch (error) {
    console.error('データベース結果ダウンロードエラー:', error);
    alert('データベースからの結果取得に失敗しました。ローカルデータをダウンロードします。');
    downloadCSV(); // フォールバック
  }
}

// 従来のCSVダウンロード関数（フォールバック用）
function downloadCSV() {
  if (judgments.length === 0) {
    alert('評価データがありません');
    return;
  }

  const csvContent = judgments.map((judgment, index) => {
    const rowIndex = indexArray[index];
    const [strategy, sustainability] = csvData[rowIndex];
    return `"${strategy.replace(/"/g, '""')}","${sustainability.replace(/"/g, '""')}",${judgment}`;
  }).join('\n');

  const header = '経営戦略,サステナビリティ,整合性スコア\n';
  const blob = new Blob([header + csvContent], { type: 'text/csv;charset=utf-8-sig;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `evaluation_results_local_${new Date().toISOString().slice(0,10)}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 評価履歴CSVダウンロード（すべてのユーザーのデータ）
async function downloadLogCSV() {
  try {
    const response = await fetch('/api/judgments?limit=1000');
    if (!response.ok) {
      throw new Error('データベースからのデータ取得に失敗しました');
    }
    
    const data = await response.json();
    
    if (data.length === 0) {
      alert('データベースにデータがありません');
      return;
    }
    
    const csvContent = [
      ['問題ID', 'ユーザー名', '経営戦略', 'サステナビリティ', 'スコア', '回答日時', '作成日時'],
      ...data.map(row => [
        row.id, // idが問題ID（S100TWSV1など）
        row.userName,
        `"${row.strategyText.replace(/"/g, '""')}"`,
        `"${row.sustainabilityText.replace(/"/g, '""')}"`,
        row.score,
        row.timestamp,
        row.created_at
      ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8-sig;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `all_evaluation_results_${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
  } catch (error) {
    console.error('評価履歴ダウンロードエラー:', error);
    alert('データベースからのデータ取得に失敗しました');
  }
}

// 戻る機能
function goBack() {
  if (currentIndex > 0) {
    currentIndex--;
    judgments.pop(); // 直前の回答を削除
    showNextPair();
  }
}

// ページロード時に未送信データをチェック
document.addEventListener('DOMContentLoaded', function() {
  // 未送信のデータがある場合は再送信を試行
  retryPendingJudgments();

  // データベースの問題統計を表示（オプション）
  loadProblemStats();

  // 「途中で終了する」ボタンのイベント
  const exitButton = document.getElementById('exitButton');
  if (exitButton) {
    exitButton.addEventListener('click', function() {
      const confirmExit = confirm('回答の途中で終了しますか？');
      if (confirmExit) {
        savePartialDataAndExit();
      }
    });
  }
});

// 問題統計を読み込む関数（オプション）
async function loadProblemStats() {
  try {
    const response = await fetch('/api/problems/stats');
    if (response.ok) {
      const stats = await response.json();
      console.log(`データベース内の問題数: ${stats.total_problems}件`);
    }
  } catch (error) {
    console.error('問題統計取得エラー:', error);
  }
}

// 途中までのデータを保存して終了画面を表示
function savePartialDataAndExit() {
  // 必要に応じて途中までのデータを保存（例：ローカルストレージやサーバー送信）
  // ここではローカルストレージに保存する例
  localStorage.setItem('partialJudgments', JSON.stringify(judgments));

  sendAllJudgments(); // ここでまとめて送信
  // 完了画面を表示
  showCompletionScreen();
}

// 未送信データの再送信を試行
async function retryPendingJudgments() {
  const pending = JSON.parse(localStorage.getItem('pendingJudgments') || '[]');
  if (pending.length === 0) return;

  console.log(`${pending.length}件の未送信データを再送信中...`);

  for (let i = pending.length - 1; i >= 0; i--) {
    try {
      const response = await fetch('/api/judgments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(pending[i])
      });

      if (response.ok) {
        pending.splice(i, 1); // 送信成功したら配列から削除
        console.log('未送信データの再送信に成功しました');
      }
    } catch (error) {
      console.error('再送信エラー:', error);
    }
  }

  localStorage.setItem('pendingJudgments', JSON.stringify(pending));
  
  if (pending.length === 0) {
    console.log('すべての未送信データの再送信が完了しました');
  }
}

// すべての判定結果を送信する関数
async function sendAllJudgments() {
  if (judgments.length === 0) return;

  for (let i = 0; i < judgments.length; i++) {
    try {
      const response = await fetch('/api/judgments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(judgments[i])
      });
      if (!response.ok) {
        throw new Error('送信失敗');
      }
    } catch (error) {
      // 失敗時はローカルストレージに保存
      saveToLocalStorage(judgments[i]);
    }
  }
  judgments = [];
}