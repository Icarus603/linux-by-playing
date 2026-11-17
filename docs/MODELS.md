# 內建的語言模型與授權

遊戲內建一個小型開源語言模型，讓 Pip 能用自然語言回答 Linux 問題。模型與推論引擎都在容器內本機執行，**不連外網、不傳送任何資料**。

| 元件 | 版本 | 授權 |
|---|---|---|
| 模型 Qwen3.5-4B（Q4_K_M 量化） | [Qwen/Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B)，GGUF 轉檔來自 [unsloth/Qwen3.5-4B-GGUF](https://huggingface.co/unsloth/Qwen3.5-4B-GGUF) | Apache-2.0 |
| 推論引擎 llama.cpp | [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp)（建置時從原始碼編譯） | MIT |

## 為什麼是 4B

在一台 Apple Silicon（10 核心、容器內純 CPU）上實測：

| | Qwen3.5-2B | Qwen3.5-4B |
|---|---|---|
| 檔案大小 | 1.2 GB | 2.6 GB |
| 提示詞處理 | 約 97 tok/s | 約 38 tok/s |
| 生成速度 | 約 32 tok/s | 約 24 tok/s |
| 沒有資料時的 Linux 問題 | 會編造（例如說 btrfs 不支援 RAID5） | 較準，沒把握時會坦白說 |
| 離題問題 | 角色不穩 | 會說「這不是我的專長，我是 Linux 專家」 |

2B 太容易瞎掰，所以選 4B。4B 的代價是提示詞處理慢，因此做了這些優化：
只附最相關的 2 條資料、高信心命中直接用審過的標準答案（不經過模型）、啟動後背景預熱固定提示詞前綴、
可用記憶體不足時自動退回離線知識庫。

## 記憶體

模型約需 3 GB 以上可用記憶體。可用記憶體不足時遊戲不會硬撐，會自動改用離線知識庫回答。

## 自行替換模型

```bash
docker build \
  --build-arg LLM_URL=<GGUF 檔案網址> \
  --build-arg LLM_SHA256=<sha256> \
  -t lbp:dev .
```

不想內建模型（映像檔約少 2.6GB）：`--build-arg WITH_LLM=0`。也可以在執行時用 `LBP_LLM_URL` 指向你自己的 OpenAI 相容伺服器。
