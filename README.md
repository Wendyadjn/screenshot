# Mac Desktop Screenshot Butler — Step 1

本地 Node.js ESM 工具，只依赖 chokidar（文件监听）和 sharp（图片转换）。建议 Node.js 24 LTS；package.json 固定使用 chokidar 5 系列。后续面板使用 Node 内置 HTTP 服务、Server-Sent Events 和原生 HTML/CSS/JS 即可，目前不需要 React、Vite 或 Express。

## 运行

从空白 macOS 终端开始，先进入项目目录：

```sh
cd /Users/jianrunlu/Documents/ChatGPT/screenshot
node --version
npm --version
npm install
npm test
```

测试应显示 `pass 3`、`fail 0`。如果提示找不到 node 或 npm，请先安装 Node.js（建议 24 LTS），重新打开终端后再执行这些命令。

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

日志含状态、原名、新名、源路径、目标路径、字节数和时间；失败带错误信息。`normalizeConfig()` 用于校验配置，`processScreenshot()` 可复用于后续批量处理；直接调用时需传入已规范化的配置。面板、缩略图接口、持久日志、自动标签与安装包尚未实现。

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
