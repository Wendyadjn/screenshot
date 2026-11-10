# SnapSort / Mac Desktop Screenshot Butler

## 本地控制面板（推荐）

从空白终端逐行执行：

```sh
cd /Users/jianrunlu/Documents/ChatGPT/screenshot
npm install
npm test
npm run dashboard
```

预期测试 `pass 7`、`fail 0`。服务启动后，在 Safari 或 Chrome 地址栏输入 `http://127.0.0.1:3210`。保持终端运行；Control+C 停止服务。如果提示端口已占用，先使用已经运行的面板，或在原终端停止旧服务。

### 第一次面板测试

1. 监听/扫描目录填写 `/Users/jianrunlu/Documents/ChatGPT/screenshot/demo/dashboard-input`，目标目录填写 `/Users/jianrunlu/Documents/ChatGPT/screenshot/demo/dashboard-output`。这些目录和一张绿色测试图已在开发验证时创建。也可以使用之前的 `demo/Desktop` 与 `demo/Archive`。
2. 点击“保存设置”，再点击“扫描并预览”。测试图带 `lecture`，应该归入“学习”，并显示缩略图。
3. 点击“确认复制全部”，先点“取消”，确认没有新增日志或副本。再点击一次并在弹窗中点击“开始复制”。
4. 活动日志应显示成功。Finder 按 Command+Shift+G，打开目标目录；确认副本存在、原图仍在源目录。开发验证已生成过副本，因此再次测试出现编号属于正常行为。
5. 再扫描，修改分类规则；未保存前扫描和复制应禁用。保存后旧预览失效，需重新扫描。
6. 点击“开始监听”，应出现“正在监听”，设置暂时禁用。在 Finder 中复制一张图片到输入目录，确保文件名以 `Screenshot` 或 `截图` 开头，使用新的文件名。等待约两秒，日志应显示重命名及归档结果；副本使用设置中的目标格式。
7. 点击“停止监听”，状态应恢复“监听已停止”，设置恢复可编辑。

“选择…”按钮会弹出 macOS 文件夹选择窗口，也可直接粘贴绝对路径。取消选择不会修改输入框。浏览器在 `127.0.0.1` 打开面板；不要改用 `localhost`。

面板始终保留源文件；批量模式保留名称和格式，监听模式使用命名与转换设置。分类规则仅用于批量模式。配置保存在 `dashboard.config.json`（已从 Git 排除），与命令行的 `config.json` 分开；日志仅在内存保留最近 100 条，约每 1.5 秒刷新。没有新增 npm 依赖。

面板文件：`src/server.js` 提供本地 HTTP API，`public/index.html`、`public/style.css`、`public/app.js` 提供界面，`test/server.test.js` 验证配置、预览、复制和请求来源限制。服务仅绑定本机地址，不支持远程或局域网访问。

## 合并后的两种使用方式

- `npm start`：原有新增截图监听，支持格式转换和自动归档，默认保留源文件。
- `npm run sort`：SnapSort 批量整理。扫描已有截图，显示分类预览，输入 `COPY` 才复制。始终保留原图和文件名，不转换格式，不受 `keepOriginal: false` 影响。

批量模式按“分类/YYYY-MM/原文件名”复制，文件名关键词首次匹配生效；无法匹配进入“其他”。优先使用文件名有效日期，否则使用修改时间。源目录和目标目录必须互不包含；修改过的源文件需要重新扫描。同名加编号，重复执行会产生额外副本。批量与监听不要同时处理同一目录。

### 从空白终端测试批量模式

逐行运行：

```sh
cd /Users/jianrunlu/Documents/ChatGPT/screenshot
npm install
npm test
mkdir -p demo/Desktop demo/Archive
node --input-type=module -e 'import fs from "node:fs"; const c=JSON.parse(fs.readFileSync("config.json","utf8")); c.watchDir=process.cwd()+"/demo/Desktop"; c.archiveDir=process.cwd()+"/demo/Archive"; fs.writeFileSync("demo/config.json", JSON.stringify(c,null,2));'
node --input-type=module -e 'import sharp from "sharp"; await sharp({create:{width:64,height:64,channels:3,background:"blue"}}).png().toFile("demo/Desktop/Screenshot 2026-10-27 lecture.png");'
npm run sort -- ./demo/config.json
```

预览中应显示 `学习/2026-10/Screenshot 2026-10-27 lecture.png`。先输入 `no` 回车取消，确认 Archive 中无新增图片。再次运行最后一条命令，输入大写 `COPY` 回车。Finder 中用 Command+Shift+G 打开 `/Users/jianrunlu/Documents/ChatGPT/screenshot/demo`，应看到源图仍在 Desktop，Archive/学习/2026-10 中有副本。重复执行会创建 ` (1)` 副本。

可选自定义规则：创建 UTF-8 文本文件，每行例如 `学习=lecture,course,课程`，然后执行 `npm run sort -- ./demo/config.json ./rules.txt`。本版分类仅依据文件名，没有 OCR。Python/PySide6 界面未移植；现已提供基于 Node 的本地 Web 面板。

本地 Node.js ESM 工具，只依赖 chokidar（文件监听）和 sharp（图片转换）。建议 Node.js 24 LTS；package.json 固定使用 chokidar 5 系列。面板使用 Node 内置 HTTP 服务和原生 HTML/CSS/JS，以定时轮询刷新日志，不需要 React、Vite 或 Express。

## 运行

从空白 macOS 终端开始，先进入项目目录：

```sh
cd /Users/jianrunlu/Documents/ChatGPT/screenshot
node --version
npm --version
npm install
npm test
```

测试应显示 `pass 7`、`fail 0`。如果提示找不到 node 或 npm，请先安装 Node.js（建议 24 LTS），重新打开终端后再执行这些命令。

第一次手动验证建议使用隔离目录，不操作真实桌面：

```sh
mkdir -p "$PWD/demo/Desktop" "$PWD/demo/Archive"
node --input-type=module -e 'import fs from "node:fs"; const c=JSON.parse(fs.readFileSync("config.json","utf8")); c.watchDir=process.cwd()+"/demo/Desktop"; c.archiveDir=process.cwd()+"/demo/Archive"; fs.writeFileSync("demo/config.json", JSON.stringify(c,null,2));'
node src/cli.js ./demo/config.json
```

看到 `watching` 后保持该终端运行。按 Command+Shift+5，在“选项”中把截图保存位置设为项目的 `demo/Desktop` 文件夹，再截取一张图片。打开 Finder，用 Command+Shift+G 输入 `/Users/jianrunlu/Documents/ChatGPT/screenshot/demo/Archive`，应看到年月目录和转换后的 WebP。日志应出现 `success`，原截图应仍在 `demo/Desktop`。测试后将 macOS 截图保存位置改回原来的位置，再回终端按 Control+C 停止。

确认测试符合预期后，再运行下方 `npm start` 使用正式配置。

```sh
npm install
npm test
npm start
# 指定另一份配置：
node src/cli.js ./config.json
```

出现 `watching` JSON 日志后，使用 macOS 截图快捷键生成一张新截图。Ctrl+C 停止监听并等待当前队列完成。不会扫描处理启动前的旧截图，配置修改后需要重启。请先使用测试目录确认规则符合预期。

macOS 如提示桌面/图片文件夹访问权限，请允许实际运行 Node 的终端应用访问对应文件夹。程序不会绕过系统权限，也不需要管理员身份。

## 配置

| 字段 | 说明 |
| --- | --- |
| `watchDir` | `null` 时读取 `com.apple.screencapture location`，未设置则使用 `~/Desktop`；也可显式指定路径 |
| `archiveDir` | 输出目录，支持 `~/`；不能与监听目录相同 |
| `renameTemplate` | 文件名主体，不包含扩展名；支持 `{YYYY}` `{MM}` `{DD}` `{HH}` `{mm}` `{ss}`，使用文件创建时间与本地时区 |
| `format` | `webp` / `jpg` / `png` / `original`（保留原始字节） |
| `quality` | 1–100；作用于 WebP/JPG，不保证转换后一定更小 |
| `organizeBy` | `month`：YYYY-MM；`type`：扩展名；`none`：直接归档 |
| `keepOriginal` | 默认 `true` 保留原图；设为 `false` 在归档成功后删除源文件，实现移动 |

截图识别：文件名以 Screen Shot、Screenshot、截图、截圖、截屏、屏幕快照或螢幕快照开头，扩展名为 PNG/JPG/JPEG/WebP。仅监听指定目录的直接子文件，不递归、不跟随源符号链接。自定义为其他名称的截图不会自动识别；普通图片不会仅凭新增事件被转换。

文件大小稳定 1.5 秒后开始处理；任务串行执行。输出先写临时文件，再以不覆盖方式发布；同名自动追加 `_1`、`_2`。JPG 透明区域填白。保留原图时桌面文件仍存在；要自动清理桌面需明确设置 `keepOriginal: false`。有损转换不可还原，建议确认画质后再开启移动模式。归档目录必须支持硬链接（本地 APFS 支持）。

## 后续面板接口

```js
import { startWatching } from './src/butler.js';

const controller = await startWatching(config, event => {
  // 同步回调：将 JSON 日志转发给 SSE / 面板；回调自身应避免抛出异常。
  console.log(event);
});
await controller.stop();
```

日志含状态、原名、新名、源路径、目标路径、字节数和时间；失败带错误信息。`normalizeConfig()` 用于校验配置，`processScreenshot()` 可复用于后续批量处理；直接调用时需传入已规范化的配置。面板和缩略图接口已实现；持久日志、自动标签与安装包尚未实现。

## 文件

```text
.
├── config.json
├── package.json
├── package-lock.json
├── src/
│   ├── butler.js
│   └── cli.js
├── test/
│   └── butler.test.js
└── README.md
```

测试覆盖名称与配置校验、实际图片转换、重名不覆盖、移动原图、转换失败保留原图和真实新增文件监听，全部使用临时目录。

## 本轮验证与常见问题

- 自动测试使用临时目录，已验证通过面板 API 启动监听、转换新增 PNG 为 WebP、生成 JPEG 缩略图、停止监听；源 PNG 保留。
- 配置保存后，新的服务实例会恢复目录与分类规则；重启后监听仍默认关闭。
- 取消 macOS 目录选择应显示“已取消选择，目录保持不变”。若弹窗没有出现，可直接输入路径；本轮已在你的 Mac 上确认窗口正常弹出，取消后路径保持不变、按钮恢复可用。
- 页面提示连接中断时操作按钮会禁用。检查终端中的服务是否运行，再刷新页面。
- 修改代码后需在启动服务的终端按 Control+C，再运行 `npm run dashboard`；单纯刷新浏览器不会更新后端代码。
- 不要同时从两个面板操作同一批预览。复制确认绑定打开弹窗时的预览编号；另一页面重新扫描或修改配置后，旧确认将被拒绝，需要重新扫描。

从空白终端重新验证：

```sh
cd /Users/jianrunlu/Documents/ChatGPT/screenshot
npm install
npm test
npm run dashboard
```

浏览器打开 `http://127.0.0.1:3210`，使用上文 demo 目录。点击“开始监听”后，在 Finder 中复制一张测试图到输入目录并改为一个新的 `Screenshot` 开头文件名，等待约两秒。应看到成功日志和缩略图；归档内新增 WebP，输入目录仍保留 PNG。最后点击“停止监听”。
