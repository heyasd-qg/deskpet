# 第三方组件、外部工具与许可

本文件区分直接分发的代码、开发依赖和可选外部工具。版本按当前发布源码及开发依赖记录；未为本项目统一指定新的开源许可证。

## 随源码提供的组件

### PixiJS 6.5.10

- 项目：[pixijs/pixi.js](https://github.com/pixijs/pixi.js)
- 文件：`public/vendor/pixi.min.js`。
- 用途：WebGL 渲染。
- 许可：MIT；版权声明包含 Mathew Groves、Chad Engler。
- 原许可文本：[pixi.js-LICENSE.txt](third-party-licenses/pixi.js-LICENSE.txt)。保留原文件中的声明。

### pixi-live2d-display 0.4.0

- 项目：[guansss/pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)
- 文件：`public/vendor/cubism4.min.js`，当前文件与已安装的 0.4.0 包对应构建一致。
- 用途：Live2D 显示、动作和表情播放。
- 该项目自身许可：MIT；Copyright (c) 2020 Guan。
- 原许可文本：[pixi-live2d-display-LICENSE.txt](third-party-licenses/pixi-live2d-display-LICENSE.txt)。
- 该构建带入的 Cubism Web Framework 与另外加载的 Cubism Core 遵循各自的 Live2D 许可，不能一并视为 MIT。

### Cubism Web Framework

- 官方项目：[Live2D/CubismWebFramework](https://github.com/Live2D/CubismWebFramework)。
- 使用方式：由 `pixi-live2d-display` 的 Cubism 4 构建带入。
- 来源记录：`pixi-live2d-display` 的 `v0.4.0` 标签使用 `guansss/CubismWebFramework` 子模块，提交为 `1f9cdfd140e87ba0ae68a356bb5ec339a0e65f99`。
- 许可：Live2D Open Software License。
- 对应提交的官方许可索引：[CubismWebFramework-LICENSE.md](third-party-licenses/CubismWebFramework-LICENSE.md)。该文件包含官方协议及 SDK 发布许可说明的链接。
- 上游索引来源：<https://github.com/Live2D/CubismWebFramework/blob/1f9cdfd140e87ba0ae68a356bb5ec339a0e65f99/LICENSE.md>。

### Live2D Cubism Core

- 文件：`public/live2dcubismcore.min.js`。
- 用途：Live2D 底层模型运行库。
- 原文件保留 Live2D Inc. 的版权与许可声明，并标记其属于官方协议中的 Redistributable Code。
- 许可：[Live2D Proprietary Software License Agreement](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html)。Core 为独立许可组件，不属于上述 MIT 许可代码。
- 发布含 Live2D SDK 的应用时，还应核对官方 [Cubism SDK Release License](https://www.live2d.com/en/download/cubism-sdk/release-license/) 的适用条件。

## 开发与运行依赖

| 项目 | 当前版本 | 用途 | 许可与声明 |
|---|---|---|---|
| [Electron](https://github.com/electron/electron) | 44.7.0 | 桌面应用运行环境 | MIT，见 [Electron-LICENSE.txt](third-party-licenses/Electron-LICENSE.txt) |
| [Electron Packager](https://github.com/electron/packager) | 20.3.0 | 独立打包 | BSD-2-Clause，见 [electron-packager-LICENSE.txt](third-party-licenses/electron-packager-LICENSE.txt) |

Electron 的许可文本包含 Electron contributors 与 GitHub Inc. 的版权声明；Electron Packager 的文本包含 Max Ogden 及其他贡献者的声明。分发便携应用时，还应保留 Electron 运行目录中的 `LICENSE`、`LICENSES.chromium.html` 及相关声明。

## 可选外部工具：PSD2Live

- 项目：[tsunehimatoi/psd2live](https://github.com/tsunehimatoi/psd2live)。
- 使用方式：本项目提供外部程序／源码运行接口，不在公开源码中包含 PSD2Live 的源码或二进制。
- 上游应用整体采用 GPL-3.0，部分模块另有独立许可，应以所使用版本的 [LICENSE](https://github.com/tsunehimatoi/psd2live/blob/master/LICENSE)、模块声明及第三方说明为准。
- 如果之后将工具本体与本项目一起分发，应重新核对相应分发要求；本文件不对捆绑分发或衍生作品的许可作统一结论。

## 角色素材与本项目许可

程序源码目录不嵌入 MyGO!!!!!、Ave Mujica 的模型、语音、台词、对白资料或原内置测试图片。这些资料在本机独立保留，通过发布附件提供，不进入 Git 历史。角色素材与程序代码的授权是不同事项，发布资料、列出角色名称或致谢不会授予额外的素材再分发权。

本项目当前没有新增项目级 `LICENSE`。README 末尾的致谢用于说明来源，不替代任何组件要求保留的版权、许可证全文或其他发布义务。
