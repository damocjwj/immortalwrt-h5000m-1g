<!-- SPDX-License-Identifier: MIT -->

# 许可说明 / Licensing

Copyright (c) 2026 damocjwj

## 基础项目和第三方内容

本仓库是 ImmortalWrt 的下游适配，不是单一 MIT 许可证的软件集合。
根目录 [COPYING](../COPYING) 保留原有 GPL-2.0-only 声明，许可证全文位于
[LICENSES/GPL-2.0](../LICENSES/GPL-2.0)。其他组件仍可适用不同许可证。

Linux、U-Boot、ATF、MediaTek 驱动/固件、LuCI、软件包、构建工具及其修改，
均须按相应文件、组件及上游的许可要求使用和分发。不得因为本仓库公开，或本目录
存在 MIT 许可证，就移除第三方版权声明、将 GPL 衍生代码改标 MIT，或将固件
二进制整体宣称为 MIT。公开源码和提供下载不替代各组件的源码提供及通知等义务。

现有独立组件已经声明的 MIT 或其他许可证保持不变；本次没有改动其作者归属，
也没有为许可不明的第三方内容补写授权。

## 原创文档的 MIT 授权范围

仓库维护者对以下文件中由本项目原创、可独立授权的文字额外提供
[MIT 授权](LICENSE.MIT)：

- [h5000m-1g-install.md](h5000m-1g-install.md)：首次迁移与日常升级手册。
- [h5000m-1g-release-20260914.md](h5000m-1g-release-20260914.md)：本次发布说明。
- [licensing.md](licensing.md)：本许可说明。

该明确清单不自动覆盖 `docs/` 的其他文件、源代码、补丁、固件、商标、引用的
第三方材料或链接目标。已有上游许可要求不受影响。未来新增文件需要单独确认
来源并明确声明许可，不因为放入这个目录而自动获得 MIT 授权。

复制上述原创文档时保留版权与 MIT 许可声明。文档中的操作存在风险，其测试
范围和停止条件仍有效；MIT 许可不构成硬件兼容、刷写成功或技术支持保证。

## English summary

This repository is an ImmortalWrt derivative, not an MIT-only distribution.
The upstream GPL-2.0-only notice in `COPYING` remains unchanged. Third-party
code, firmware, packages, and modifications remain subject to their respective
licenses. Making the repository public does not relicense these components.

An additional MIT grant covers only the project's independently licensable,
original text in the three documents explicitly listed above. It does not cover
third-party quotations, linked material, source code, patches, trademarks, or
Release firmware. Existing copyright notices and license obligations remain
in force. See `LICENSE.MIT` for the full grant and warranty disclaimer.
