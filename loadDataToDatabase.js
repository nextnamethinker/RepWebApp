const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// データベース接続
const db = new sqlite3.Database('./judgments.db', (err) => {
  if (err) {
    console.error('データベース接続エラー:', err.message);
    process.exit(1);
  } else {
    console.log('SQLiteデータベースに接続しました');
  }
});

// 問題データテーブルを作成
function createProblemsTable() {
  return new Promise((resolve, reject) => {
    const sql = `CREATE TABLE IF NOT EXISTS problems (
      problem_id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      strategy_text TEXT NOT NULL,
      sustainability_text TEXT NOT NULL,
      date TEXT,
      usage_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`;
    
    db.run(sql, (err) => {
      if (err) {
        reject(err);
      } else {
        console.log('問題データテーブルを作成/確認しました');
        resolve();
      }
    });
  });
}

// CSVファイルを読み込んでデータベースに保存
function loadCSVToDatabase(csvFilePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(csvFilePath)) {
      reject(new Error(`CSVファイルが見つかりません: ${csvFilePath}`));
      return;
    }

    fs.readFile(csvFilePath, 'utf8', (err, data) => {
      if (err) {
        reject(err);
        return;
      }

      // CSVデータを解析（改行を含むクォートされたフィールドに対応）
      const records = parseCSVWithQuotes(data);

      console.log(`有効な${records.length}行のデータを読み込み中...`);

      if (records.length === 0) {
        reject(new Error('有効なデータが見つかりません'));
        return;
      }

      // ★ここから下の「既存のデータをクリア」は削除してください★
      // db.run('DELETE FROM problems', ... ) ← これを削除

      // 新しいデータを挿入
      const insertSQL = 'INSERT INTO problems (problem_id, company_name, strategy_text, sustainability_text, date, usage_count) VALUES (?, ?, ?, ?, ?, ?)';
      let insertedCount = 0;
      let errorCount = 0;
      const totalLines = records.length;

      if (totalLines === 0) {
        console.log('処理対象のデータがありません');
        resolve({ inserted: 0, errors: 0 });
        return;
      }

      records.forEach((columns, index) => {
        if (columns.length >= 4) {
          const originalId = columns[0] ? columns[0].trim() : ''; // ← CSVのid列
          const companyName = columns[1] ? columns[1].trim() : '';
          const strategyText = columns[2] ? columns[2].trim() : '';
          const sustainabilityText = columns[3] ? columns[3].trim() : '';
          const date = columns[4] ? columns[4].trim() : null;
          const usageCount = columns[5] ? parseInt(columns[5]) || 0 : 0;

          if (originalId && strategyText && sustainabilityText) {
            db.run(insertSQL, [originalId, companyName, strategyText, sustainabilityText, date, usageCount], function(err) {
              if (err) {
                console.error(`行${index + 1}の挿入エラー (ID: ${originalId}):`, err.message);
                errorCount++;
              } else {
                insertedCount++;
                if (insertedCount % 5 === 0) {
                  console.log(`${insertedCount}件処理済み...`);
                }
              }

              // 処理完了チェック
              if (insertedCount + errorCount === totalLines) {
                console.log(`データ挿入完了: 成功 ${insertedCount}件, エラー ${errorCount}件`);
                resolve({ inserted: insertedCount, errors: errorCount });
              }
            });
          } else {
            errorCount++;
            console.warn(`行${index + 1}: 必須データが不足 (ID: ${originalId})`);

            if (insertedCount + errorCount === totalLines) {
              console.log(`データ挿入完了: 成功 ${insertedCount}件, エラー ${errorCount}件`);
              resolve({ inserted: insertedCount, errors: errorCount });
            }
          }
        } else {
          errorCount++;
          console.warn(`行${index + 1}: 列数不足 (${columns.length}列)`);

          if (insertedCount + errorCount === totalLines) {
            console.log(`データ挿入完了: 成功 ${insertedCount}件, エラー ${errorCount}件`);
            resolve({ inserted: insertedCount, errors: errorCount });
          }
        }
      });
    });
  });
}

// より堅牢なCSVパーサー（改行を含むクォートされたフィールドに対応）
function parseCSVWithQuotes(csvText) {
  const results = [];
  let current = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < csvText.length) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // エスケープされたクォート
        currentField += '"';
        i += 2;
      } else {
        // クォートの開始/終了
        inQuotes = !inQuotes;
        i++;
      }
    } else if (char === ',' && !inQuotes) {
      // フィールドの区切り
      current.push(currentField);
      currentField = '';
      i++;
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      // 行の終了（クォート外の改行）
      current.push(currentField);
      
      // 有効な行かチェック（空行やカンマのみの行を除外）
      if (current.length >= 4 && current[0] && current[2] && current[3]) {
        results.push(current);
      }
      
      current = [];
      currentField = '';
      
      // \r\nの場合は\nもスキップ
      if (char === '\r' && nextChar === '\n') {
        i += 2;
      } else {
        i++;
      }
    } else {
      // 通常の文字（クォート内の改行も含む）
      currentField += char;
      i++;
    }
  }

  // 最後のフィールドと行を処理
  if (currentField || current.length > 0) {
    current.push(currentField);
    if (current.length >= 4 && current[0] && current[2] && current[3]) {
      results.push(current);
    }
  }

  return results;
}

// データベース内の問題数を確認
function checkProblemCount() {
  return new Promise((resolve, reject) => {
    db.get('SELECT COUNT(*) as count FROM problems', (err, row) => {
      if (err) {
        reject(err);
      } else {
        console.log(`データベース内の問題数: ${row.count}件`);
        resolve(row.count);
      }
    });
  });
}

// CSV行をパースしてデータベースに挿入する関数
async function insertParsedData(parsedData) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare('INSERT INTO problems (strategy_text, sustainability_text) VALUES (?, ?)');
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const row of parsedData) {
      if (row.length >= 3) { // id, strategy_text, sustainability_text
        const id = row[0];
        const strategy_text = row[1];  // 2番目の列が戦略
        const sustainability_text = row[2];  // 3番目の列がサステナビリティ
        
        stmt.run(strategy_text, sustainability_text, (err) => {
          if (err) {
            console.error(`データ挿入エラー (ID: ${id}):`, err.message);
            errorCount++;
          } else {
            successCount++;
          }
        });
      }
    }
    
    stmt.finalize((err) => {
      if (err) {
        reject(err);
      } else {
        console.log(`データ挿入完了: 成功 ${successCount}件, エラー ${errorCount}件`);
        resolve({ successCount, errorCount });
      }
    });
  });
}

// メイン実行関数
async function main() {
  try {
    // コマンドライン引数からパスを取得
    const inputPath = process.argv[2];
    
    if (!inputPath) {
      console.log('使用方法: node loadDataToDatabase.js <CSVファイルまたはフォルダのパス>');
      process.exit(1);
    }

    // テーブル作成
    await createProblemsTable();

    let csvFiles = [];
    if (fs.statSync(inputPath).isDirectory()) {
      // フォルダの場合、すべての.csvファイルを対象に
      csvFiles = fs.readdirSync(inputPath)
        .filter(f => f.endsWith('.csv'))
        .map(f => path.join(inputPath, f));
      if (csvFiles.length === 0) {
        console.log('指定フォルダ内にCSVファイルがありません');
        process.exit(1);
      }
    } else {
      // ファイルの場合
      csvFiles = [inputPath];
    }

    // 既存データをクリア
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM problems', (err) => {
        if (err) {
          console.error('既存データクリアエラー:', err);
          reject(err);
        } else {
          console.log('既存の問題データをクリアしました');
          resolve();
        }
      });
    });

    // 各CSVファイルを順に読み込み
    let totalInserted = 0;
    let totalError = 0;
    for (const csvFilePath of csvFiles) {
      console.log(`CSVファイルを読み込み中: ${csvFilePath}`);
      const result = await loadCSVToDatabase(csvFilePath);
      totalInserted += result.inserted;
      totalError += result.errors;
    }

    // 結果確認
    await checkProblemCount();
    console.log(`全ファイルのデータベースへの読み込みが完了しました！（成功: ${totalInserted}件, エラー: ${totalError}件）`);
    
  } catch (error) {
    console.error('エラー:', error.message);
  } finally {
    // データベース接続を閉じる
    db.close((err) => {
      if (err) {
        console.error('データベース切断エラー:', err.message);
      } else {
        console.log('データベース接続を閉じました');
      }
    });
  }
}

// スクリプト実行
main();
