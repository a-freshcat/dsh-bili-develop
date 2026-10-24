# 第三方与许可

本项目原创代码以 GPL-3.0-or-later 发布，完整条款见[LICENSE](LICENSE)。版权：2026 a-freshcat。本项目与 B站、DeepSeek 或所参考项目无隶属或官方认证关系。

## 运行依赖

依赖通过各自的包管理器安装，不在发行包中捆绑其源码、模型权重或二进制。使用及再分发依赖时应同时遵守各自许可。

| 依赖 | 版本 | 上游许可 / 来源 |
| --- | --- | --- |
| bilibili-api-python | 17.4.2 | [GPL-3.0-or-later](https://github.com/Nemo2011/bilibili-api) |
| httpx | 0.28.1 | [BSD-3-Clause](https://github.com/encode/httpx) |
| qrcode | 8.2 | [BSD](https://github.com/lincolnloop/python-qrcode) |
| Brotli | 1.2.1 | [MIT](https://github.com/google/brotli) |
| faster-whisper（可选） | 1.2.1 | [MIT](https://github.com/SYSTRAN/faster-whisper) |

其他传递依赖以安装版本的发行元数据为准。DSH、Node.js、Python及可选模型权重由用户单独取得，各自许可不因本项目而改变。GPL全文来自GNU发布的标准文本。

## 设计参考

用户指定以下项目用于研究交互和接入思路；发行目录不包含这些仓库的克隆、账号数据或运行产物：

- [adoresever/bilibili-mcp](https://github.com/adoresever/bilibili-mcp)
- [namchengwuqiu/bilibili_autopilot](https://github.com/namchengwuqiu/bilibili_autopilot)
- [c1overzz/dsh-bili-scroll](https://github.com/c1overzz/dsh-bili-scroll)
- [ovo-arron/short-form-natural-zh](https://github.com/ovo-arron/short-form-natural-zh)：参考其短回复表达方法，核对版本0.1.0、提交`9029fdeb574b846cb8e34cfa86d4ff2eb3e430bf`，上游许可为AGPL-3.0-only，版权2026 ovo-arron and contributors。本项目“自然中文短回复”包是独立编写的简短表达建议，默认关闭；未捆绑上游SKILL、示例、第三方材料或执行脚本。直接分发上游文本及后续衍生内容时需另行核对许可义务。

客户端小电视图标由内联矢量路径绘制，用于标识B站相关功能；相关品牌与商标权属于其权利人。
