const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const app = express();
const PORT = 3000;

// JSONパースのミドルウェア
app.use(express.json());

// 静的ファイルの提供（frontend フォルダ）
app.use(express.static(path.join(__dirname, 'frontend')));

// SQLiteデータベースの初期化
const db = new sqlite3.Database('./judgments.db', (err) => {
  if (err) {
    console.error('データベース接続エラー:', err.message);
  } else {
    console.log('SQLiteデータベースに接続しました');
    
    // テーブルが存在しない場合は作成
    db.run(`CREATE TABLE IF NOT EXISTS problems (
      problem_id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      strategy_text TEXT NOT NULL,
      sustainability_text TEXT NOT NULL,
      date TEXT,
      usage_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // 判定データテーブルを作成（idは自動連番、problem_idで問題IDを保存）
    db.run(`CREATE TABLE IF NOT EXISTS judgments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userName TEXT NOT NULL,
      strategyText TEXT NOT NULL,
      sustainabilityText TEXT NOT NULL,
      problem_id TEXT NOT NULL,
      score INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  }
});

// 判定結果を保存するAPI（idに問題IDを保存）
app.post('/api/judgments', (req, res) => {
  const { userName, strategyText, sustainabilityText, combinationId, score, timestamp } = req.body;
  
  // バリデーション
  if (!userName || !strategyText || !sustainabilityText || !combinationId || !score || !timestamp) {
    return res.status(400).json({ error: '必要なデータが不足しています' });
  }

  const sql = `INSERT INTO judgments (userName, strategyText, sustainabilityText, problem_id, score, timestamp) 
               VALUES (?, ?, ?, ?, ?, ?)`;
  
  db.run(sql, [userName, strategyText, sustainabilityText, combinationId, score, timestamp], function(err) {
    if (err) {
      console.error('判定結果保存エラー:', err.message);
      return res.status(500).json({ error: 'データベースエラー' });
    }
    res.json({ id: this.lastID, message: '判定結果が保存されました' });
  });
});

// 判定結果を取得するAPI
app.get('/api/judgments', (req, res) => {
  const { userName, limit = 1000 } = req.query;
  
  let sql = 'SELECT * FROM judgments';
  let params = [];
  
  if (userName) {
    sql += ' WHERE userName = ?';
    params.push(userName);
  }
  
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(parseInt(limit));
  
  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('判定結果取得エラー:', err.message);
      return res.status(500).json({ error: 'データベースエラー' });
    }
    
    res.json(rows);
  });
});

// 統計情報を取得するAPI
app.get('/api/stats', (req, res) => {
  const sql = `
    SELECT 
      COUNT(*) as total_judgments,
      COUNT(DISTINCT userName) as unique_users,
      AVG(score) as average_score,
      COUNT(DISTINCT combinationId) as unique_combinations
    FROM sorted
  `;
  
  db.get(sql, (err, row) => {
    if (err) {
      console.error('統計情報取得エラー:', err.message);
      return res.status(500).json({ error: 'データベースエラー' });
    }
    
    res.json(row);
  });
});

// 問題データを取得するAPI（要件に合わせて修正）
app.get('/api/problems', (req, res) => {
  const { userName, limit = 15 } = req.query;

  // usage_countが3未満、かつこのユーザーが未回答の問題のみ取得
  const sql = `
    SELECT * FROM problems
    WHERE usage_count < 3
      AND problem_id NOT IN (
        SELECT problem_id FROM judgments WHERE userName = ?
      )
    ORDER BY usage_count ASC, created_at ASC
  `;
  const params = [userName];

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('問題データ取得エラー:', err.message);
      return res.status(500).json({ error: 'データベースエラー' });
    }

    if (rows.length === 0) {
      return res.json([]);
    }

    // 会社ごとにグループ化
    const companyGroups = {};
    rows.forEach(row => {
      if (!companyGroups[row.company_name]) {
        companyGroups[row.company_name] = [];
      }
      companyGroups[row.company_name].push(row);
    });

    // usage_count合計が最も少ない会社を選ぶ
    let selectedCompany = null;
    let minUsage = Infinity;
    for (const company in companyGroups) {
      const usageSum = companyGroups[company].reduce((sum, r) => sum + (r.usage_count || 0), 0);
      if (usageSum < minUsage) {
        minUsage = usageSum;
        selectedCompany = company;
      }
    }

    // その会社の問題から最大15問を返す
    let problems = [];
    if (selectedCompany) {
      problems = companyGroups[selectedCompany].slice(0, parseInt(limit));
    }

    res.json(problems);
  });
});

// 使用回数を更新するAPI
app.post('/api/problems/:id/increment-usage', (req, res) => {
  const { id } = req.params;
  const sql = 'UPDATE problems SET usage_count = usage_count + 1 WHERE problem_id = ?';
  db.run(sql, [id], function(err) {
    if (err) {
      console.error('使用回数更新エラー:', err.message);
      return res.status(500).json({ error: 'データベースエラー' });
    }
    res.json({ message: '使用回数を更新しました', changes: this.changes });
  });
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`サーバーが http://localhost:${PORT} で起動しました`);
});

// プロセス終了時にデータベース接続を閉じる
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('データベース切断エラー:', err.message);
    } else {
      console.log('データベース接続を閉じました');
    }
    process.exit(0);
  });
});