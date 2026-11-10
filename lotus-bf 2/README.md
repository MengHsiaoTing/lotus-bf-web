# LoTUS-BF：自己的網站部署版

這份是完整專案，不是只替換一個檔案。保留你上傳的最新版介面，以自己的 Flask 後端連接上週的 Neurosynth PostgreSQL 資料庫。瀏覽器不再向老師的伺服器送出請求。

## 先做這件事

將這個資料夾的內容放進一個**新的 GitHub repository**（例如 `lotus-bf-web`）。不要覆蓋你上週交作業的 repository，也不必刪除原本的 Render 服務。

上傳的是解壓縮後的檔案，不是把 ZIP 本身放進 GitHub。Repository 首頁應直接看到 `Dockerfile`、`app.py`、`package.json`、`src` 和 `public`，不要多包一層資料夾。

已排除 node_modules、舊 dist、憑證、資料庫密碼和原始大型 parquet。`public` 裡的兩個腦影像與 `terms.json` 必須一起上傳。

## Render 設定（同一個服務供應網頁與 API）

1. 開啟 Render，選 **New → Web Service**，連接新的 GitHub repository。不要選 Static Site。
2. Runtime／Language 選 **Docker**。本專案的 Dockerfile 會自動安裝套件、建置網頁，再啟動後端。
3. Name 可用 `lotus-bf-web`。Region 選與你原本 PostgreSQL 資料庫**相同的區域**。Instance Type 選 **Free**（依帳戶可用選項）。
4. Root Directory：若 repository 首頁已直接看到 Dockerfile，就留空。
5. Dockerfile Path：使用預設 `./Dockerfile`。Docker Command 留空，使用檔案中的啟動指令。不用另外填 npm 的 Build／Start Command。
6. Environment 新增 **`DB_URL`**，值貼上你自己的 PostgreSQL 連線網址：
   - 若與資料庫在相同 workspace、相同 region，使用該資料庫的 **Internal Database URL**。
   - 不確定時，可先核對你原本 `neurosynth-api-4jti` 服務所用的 DB_URL。不能貼老師的連線字串。
   - 值只填進 Render 的環境變數欄位，**不要寫入 GitHub，也不用貼到聊天**。
7. Health Check Path 設 `/health`（若介面提供此欄位）。按 Create／Deploy，等待建置完成。
8. 開啟 Render 顯示的新網址，會自動進入 `/lotus-bf/`。這個網址可交給別人的手機或電腦開啟。

`render.yaml` 是相同設定的 Blueprint 版本；依上述方式手動建立即可，不需要再建立第二次。

## 部署後，只檢查這幾項

把以下路徑接在你的新 Render 網址後面：

- `/health`：應顯示 `ok: true`。只檢查網站服務是否啟動，不代表資料庫可查詢。
- `/health/db`：應顯示 `ok: true`，且 tables、populated、fts、postgis 全部為 true。只讀檢查，不會修改或匯入資料。
- `/lotus-bf/`：確認首頁、大腦、兩個入口按鈕正常。
- 詞彙搜尋：先測 `memory`，再測 `memory AND attention`、`memory NOT attention`，點文章標題確認連到 PubMed。
- 座標搜尋：測 `X=-22, Y=0, Z=-20`。預設搜尋距離小於 6 mm 的研究，資料版本可能導致結果不同。
- 結果頁：確認下一頁、年份排序、腦圖縮放與放大功能。

若 `/health/db` 失敗，先核對原本資料庫是否仍存在、DB_URL 是否正確、資料是否已匯入。**不要直接重跑 create_db.py**；其預設流程包含刪除／重建資料表。先保留錯誤結果，確認後再決定是否需要修復資料。

如果 Render 啟動時顯示找不到 Dockerfile，檢查 repository 是否多包一層資料夾；若有，修正 Root Directory 即可。

## 免費方案的實際限制

服務閒置後可能休眠，第一次開啟要等待喚醒。本版搜尋等待 60 秒後會顯示可重試的訊息；伺服器 SQL 設有 25 秒逾時，避免卡住。這不代表查詢一定能在免費方案的資源內完成，仍需用真實資料測試。

免費 PostgreSQL 與免費網站服務是不同資源；Render 官方說明免費 PostgreSQL 會在建立 30 天後到期，請檢查你上週資料庫的到期時間。新建此網站不會延長資料庫期限。

官方說明：
- https://render.com/docs/docker
- https://render.com/docs/web-services
- https://render.com/docs/free
- https://render.com/docs/tls

## 本機繼續修改（Mac）

前端與後端各開一個終端機。Python 建議 3.12，Node 使用 22.12 以上。

終端機一，在這個資料夾執行：

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

設定自己的 DB_URL 後啟動（本機需用資料庫的 **External Database URL**；Internal URL 通常只能在 Render 內使用）。以下方式不會將密碼直接寫入命令歷史：

```bash
printf '貼上自己的 External Database URL：'
read -rs DB_URL
export DB_URL
printf '\n'
python -m flask --app app run --host 127.0.0.1 --port 5000
```

終端機二，在同一個資料夾執行：

```bash
npm ci
npm run dev
```

開啟 http://127.0.0.1:3000/lotus-bf/ 。本機 Vite 會把 API 請求交給本機 5000 的 Flask，不再交給老師。

若只看介面，可以只開前端；文獻與座標查詢需要後端和資料庫一起連通。

## 這次改了哪些地方

- `app.py`：沿用你上週的作業後端，加入新版接口並供應編譯後的網頁。支援 `DB_URL` 或 `DATABASE_URL`。連線池與資料庫逾時已限制。
- `lotus_api.py`：新增文獻、座標及 NIfTI API，不會建立、刪除或修改資料表。
- `src/components/Studies.jsx`：每頁只讀 20 篇，總數與排序由後端處理，保留 PubMed 連結。
- `src/api.js`：統一處理查詢逾時與後端錯誤。
- `BrainViewer.jsx`：使用自己的影像 API，無可顯示座標時只保留底圖並提示。
- `SearchBox.jsx`：保留你最新的詞彙排序、左右滑動與點選追加，移除已不使用的跑馬燈動畫程式與重複清單。
- `vite.config.js`：本機開發指向本機 Flask。
- `Dockerfile`、`render.yaml`、`requirements.txt`：部署設定。
- `public`：保留原本兩份腦影像和 3,168 個詞彙。

## 查詢規則與資料相容性

資料庫預期為你提供的 `create_db.py` 所建立的結構：`ns.metadata`（包含 fts）、`ns.coordinates`（POINTZ geom）、`ns.annotations_terms`。不需要額外建立可選的 `annotations_json`。

- 詞彙搜尋沿用老師 `/query` 的 metadata 全文檢索方向，使用 PostgreSQL 英文斷詞／詞幹；並非只比對 annotations 的單字是否存在。
- `NOT` 優先於 `AND`，`AND` 優先於 `OR`。支援括號。
- 兩個以空格分開的詞彙預設為 AND；例如 `memory attention` 等同 `memory AND attention`。雙引號表示連續詞組，例如 `"working memory"`。這個空格行為已明確化，可能不同於老師版本自動把相鄰詞合併成詞組的做法。
- 支援 `memory AND [-22,0,-20]` 等混合查詢；AND、OR、NOT 保留原本括號的集合邏輯。
- 座標搜尋使用 MNI 毫米、3D 歐氏距離嚴格小於 r（預設 6）。不會自動把 Talairach 座標轉換成 MNI。
- NIfTI 顯示的是「符合研究的所有報告座標」經 10 mm FWHM 高斯平滑的計數分布，不是統計顯著性、效應量或單一搜尋球體。
- 影像使用與畫面底圖相同的 `mni_2mm.nii.gz` affine／網格，避免左右或座標錯位。
- 本機 terms.json 是你提供的 annotations.parquet 版本，不保證與老師線上資料版本相同。

接口：

| 路徑 | 回傳 |
| --- | --- |
| `/query/memory/studies?limit=20&offset=0&sort=desc` | `results`、`total`、`count`、`limit`、`offset` |
| `/query/[-22,0,-20]/locations?r=6` | 座標列表，預設 1000 筆，可用 limit/offset 分頁 |
| `/query/memory/nii?r=6&fwhm=10&kernel=gauss` | gzip NIfTI；使用全部符合研究的座標，非單頁結果 |
| `/terms` | 隨專案附帶的詞彙 JSON |

## 上週作業保留方式

- `/dissociate/terms/<A>/<B>` 與 `/dissociate/locations/<A>/<B>` 原邏輯保留。
- 舊首頁移到 `/assignment`，新首頁顯示這次網站。
- 舊 `/terms/<term>/studies`、`/locations/<coords>/studies` 保留原先示範行為，新網頁使用新增的 `/query/...`。
- 上傳的 ZIP 未含上週 `amygdala.gif`。若要保留 `/img` 展示，將原檔放入 `legacy-assets/amygdala.gif` 後重新部署即可；這不影響新版 3D 大腦。

## 已驗證與待確認

- 前端 production build 通過，修改的 JSX／JS 通過 ESLint。
- 39 項 Python 測試通過：布林邏輯與優先序、輸入檢查、SQL 綁定參數、分頁回傳契約、資料庫錯誤訊息、NIfTI 世界座標及重複點計數、平滑／空影像、靜態檔案與原接口保留。
- 資料庫回傳測試使用受控測試資料；**尚未連上你的真實 PostgreSQL，不能視為真實搜尋結果已驗證**。
- 執行環境無 Docker daemon，尚未執行完整 Docker image build；瀏覽器在此環境啟動受限，未完成此次瀏覽器實測。
- 尚未上傳 GitHub／部署 Render；需要你在 Render 設定自己的 DB_URL，按上面的部署後檢查步驟確認。

本機跑後端測試（先 `npm run build`）：

```bash
pip install pytest
python -m pytest -q
```
