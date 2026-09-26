# 交接清单：Check Before Submit 只做 PDF，图片交给 Osmanth Image

- 写给：正在改 Check Before Submit（以下简称 CBS）的那个会话
- 写于：2026-09-21
- 依据代码：CBS 仓库 HEAD `6ac9f33`（"Finish the destination-first fix…"）。本清单只读了 CBS 的代码，没有改动其中任何文件。
- 决定人：项目负责人，2026-09-21 在 Osmanth Image 会话中确认

---

## 1. 决定是什么

| | Check Before Submit | Osmanth Image |
|---|---|---|
| 管什么 | **PDF** | **图片**（JPEG / PNG / WebP） |
| 做什么 | 检查 PDF：页面尺寸、出血、字体、颜色、加密、PDF 内嵌图片的清晰度 | 检查图片，并帮用户改好、生成可打印文件；Etsy / Printful / Printify |

**例外：Adobe Stock 三个工具留在 CBS。** 它们检查的是 JPEG，但用途是投稿检查，不是打印准备，不属于 Osmanth Image。具体是这三个页面：
- `/adobe-stock-submission-checker/`
- `/stock-photo-quality-checker/`
- `/stock-image-similarity-checker/`

**PDF 内嵌图片的分辨率检查留在 CBS。** 它属于 PDF 检查的一部分。

---

## 2. ⚠ 顺序要求：Osmanth Image 上线之前，不要删 CBS 的图片功能

截至本文写作时，**Osmanth Image 还没有部署**（域名已定：`osmanthimage.com`，正式地址为 `https://www.osmanthimage.com`，带 www；不带 www 的会 301 跳到带 www 的）。如果 CBS 先删掉图片入口，用户就无处可去，搜索排名也无法转移。

正确顺序：
1. Osmanth Image 部署上线，`https://www.osmanthimage.com/` 可以正常访问。
2. 确认 Osmanth Image 上与下表对应的页面可以访问。
3. CBS 再按第 3 节修改，并同时上线 301 跳转。

在第 1 步完成之前，CBS 最多可以做一件事：在图片结果旁加一句"想把图片改好？Osmanth Image 即将上线"——这句也可以不加。

---

## 3. CBS 需要改的地方

### 3.1 页面

| CBS 页面 | 现在 | 改成 |
|---|---|---|
| `/dpi-checker/` | 只收图片（`PrintApp` mode `dpi`） | **下线**，301 跳转到 `https://www.osmanthimage.com/300-dpi-image-checker/`（带结尾斜杠，避免多一次跳转） |
| `/`（首页，mode `home`） | 收 PDF 和图片 | **只收 PDF**；用户上传图片时提示并链接到 Osmanth Image |
| `/check/`（`CheckFlow`，默认 mode `home`） | 收 PDF 和图片 | 同上 |
| `/print-size-calculator/` | 不收文件，只做像素 ↔ 英寸 ↔ 厘米换算 | **保留**。它不处理文件，两边都用得上 |
| 其余 PDF 工具页 | 只收 PDF | 不变 |
| Adobe Stock 三个页面 | 收 JPEG | 不变（例外） |

### 3.2 代码位置（行号以 `6ac9f33` 为准）

`src/ui/print/PrintApp.tsx`
- 第 66–67 行：`acceptsPdf = mode !== "dpi"`、`acceptsImage = mode === "dpi" || mode === "home"`。改为 `home` 也不收图片；`dpi` mode 随页面一起删除。
- 第 100–101 行：拒收时的提示文案。用户上传图片时，提示改为类似 "Check Before Submit checks PDFs. To check and prepare an image for printing, use Osmanth Image."，并附上链接。
- 第 120–121 行：`accept` 属性和 "a PDF or an image" 文案，改为只说 PDF。
- 第 164 行：`loadedKind !== "image"` 这类分支，图片入口去掉后可以简化。

`src/ui/main.tsx`
- 第 15 行 `PRINT_PAGES` 里的 `dpi: "dpi"`：随 `/dpi-checker/` 一起删除。

`vite.config.ts`
- MPA 入口 `dpi: resolve(root, "dpi-checker/index.html")`：删除。

`src/print/image.ts`、`src/print/run.ts`（`imageFactsFromFile`、`sniffKind` 的 image 分支）
- 建议**先保留一个版本周期**再删。它们不影响用户，先删页面和入口，更容易回滚。

`src/print/destinations.ts`
- `download` 这个去向的 blurb 写着 "An Etsy download…"。在"只做 PDF"的分工下，这里指 **PDF 形式**的下载品，可以保留；建议在 `limitations` 里加一句："图片形式的 Etsy 打印文件，请用 Osmanth Image 准备。"

### 3.3 站内链接和 SEO 数据

以下 HTML 文件里有指向 `/dpi-checker/` 的链接（数字是出现次数）。需要删除这些链接，或改成指向 Osmanth Image：

```
404.html 2 · adobe-stock-submission-checker 1 · bleed-trim-checker 2 · book-cover-size-calculator 1
check 2 · dpi-checker 2 · font-embedding-checker 1 · index.html 2 · pdf-page-size-checker 1
print-ready-pdf-checker 2 · print-size-calculator 2 · rgb-cmyk-checker 2 · specialized-checks 1
stock-image-similarity-checker 1 · stock-photo-quality-checker 1 · tools 3 · trust 1
```

其中需要特别注意的三处：
- `index.html` 第 31 行 lede "Drop a PDF or an image…"：改成只说 PDF。
- 首页 "What gets checked" 里的 "Images: pixel size…" 那一段：删除，或改成一句指向 Osmanth Image 的说明。
- `tools/index.html` 第 15 行的 JSON-LD `ItemList` 里有 DPI Checker 条目：删除，后面各项的 `position` 要重新编号。提交记录里写的 "all 11 checks" 会变成 10 个。

sitemap 由 `scripts/build/postbuild.mjs` 生成。页面入口删掉后，sitemap 应该会自动去掉 `/dpi-checker/`，但需要确认一下。

### 3.4 301 跳转

CBS 部署在 Cloudflare Pages（`postbuild.mjs` 会写出 `_headers`）。Cloudflare Pages 支持在 `_redirects` 文件里写跨域 301，建议由 `postbuild.mjs` 一并生成：

```
/dpi-checker/   https://www.osmanthimage.com/300-dpi-image-checker/   301
/dpi-checker    https://www.osmanthimage.com/300-dpi-image-checker/   301
```

跳转目标选 `/300-dpi-image-checker`，是因为它和 CBS DPI Checker 的搜索意图最接近（"文件里的 DPI 不决定清晰度，要看像素"）。Osmanth Image 的其他图片入口也可以作为站内交叉链接的目标：

| 用途 | Osmanth Image 路径 |
|---|---|
| 通用"能不能印" | `/can-i-print-this` |
| 能印多大 | `/photo-print-size-checker` |
| 把图片改好 | `/make-image-print-ready` |
| Etsy 打印套装 | `/etsy-printable-pack` |

---

## 4. Osmanth Image 这边已经做好的

- 用户上传 PDF 时，提示 "Osmanth Image prepares image files (JPEG, PNG, WebP). To check a PDF before printing, use Check Before Submit."，并附链接 `https://checkbeforesubmit.com/`，在新标签页打开。
- Osmanth Image 不含任何 PDF 功能，也不打算做。
- AI 放大已移除，站点是纯静态的，没有任何服务端接口。
- Osmanth Image 的测试 `tests/scope.test.ts` 锁定了"PDF 指向 CBS"和"没有 AI"这两条。

---

## 5. CBS 改完后的验收

1. `ALLOW_NO_ORIGIN=1 npm run verify`（lint + typecheck + 测试 + 构建）全部通过。
   - 删掉 `dpi` mode 后，只测 DPI 页面的测试会失效。**只删掉这部分，并在提交说明里逐条列出**；PDF 相关测试一条都不能改。
2. 在首页和 `/check/` 上传一张 JPEG：出现指向 Osmanth Image 的提示，且不崩溃。
3. 上传 PDF：结果和改之前完全一致（可以用 V3.1 的 engine parity harness 对比）。
4. 用生产构建访问 `/dpi-checker/`：返回 301，`Location` 指向 Osmanth Image。
5. 在构建产物里搜索 `/dpi-checker/`：除 `_redirects` 外，不应再出现。
6. Adobe Stock 三个页面照常工作。

---

## 6. 不要做的事

- Osmanth Image 上线之前，不要删除图片入口（见第 2 节）。
- 不要把 Adobe Stock 工具移出 CBS。
- 不要删除 PDF 内嵌图片的分辨率检查。
- 不要为了这次分工修改任何 PDF 检查的阈值或判定逻辑。
