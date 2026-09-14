# Hiveton H5000M 1G minimal

基于 ImmortalWrt MediaTek 私有驱动分支的非官方精简固件，适用于 **MT7987、
1 GiB 内存、8 GB eMMC 的 H5000M**。不适用于改装 4G/256GB 版本。
仓库只维护 `h5000m-1g-minimal` 分支；production 和 recovery 都使用 minimal 包集。

- [下载固件与 SHA256](https://github.com/damocjwj/immortalwrt-h5000m-1g/releases/tag/h5000m-1g-minimal-2026.09.14)
- [从原厂 kernel/rootfs 固件首次迁移](docs/h5000m-1g-install.md)
- [当前设计、保留功能与改动清单](docs/h5000m-1g.md)
- [本次构建与设备验证](docs/h5000m-1g-release-20260914.md)
- [固定源码与 feeds](config/h5000m-source.lock)

## 默认设置

| 项目 | 默认值 |
|---|---|
| LAN / LuCI / SSH | `192.168.1.1` |
| 用户名 / 密码 | `root` / `admin`（首次登录后修改） |
| WAN | DHCP |
| 根文件系统 | SquashFS + F2FS overlay |
| recovery / production FIT 上限 | 各 96 MiB |
| recovery 分区 | 128 MiB |
| production 分区 | eMMC 剩余空间，约 7.14 GiB |

已接入另一台 `192.168.1.1` 路由器时，先隔离网络再初始化。Wi-Fi 沿用板级
默认行为，没有默认强制关闭；通电前应正确连接天线。

## 下载文件如何选择

文件共同前缀：`immortalwrt-mediatek-filogic-hiveton-h5000m-1g`。

| 文件后缀 | 用途 |
|---|---|
| `-squashfs-sysupgrade.itb` | 已迁移到本项目布局的 production 升级 |
| `-initramfs-recovery.itb` | RAM 启动、救援系统及 recovery 分区更新 |
| `-emmc-gpt.bin` / `-emmc-gpt-backup.bin` | 首次迁移的主/备 GPT，不能作为固件上传 |
| `-emmc-preloader.bin` | 1G emmc-comb BL2，仅首次迁移/启动链恢复 |
| `-emmc-bl31-uboot.fip` | 1G BL31 + U-Boot，仅首次迁移/启动链恢复 |
| `.manifest` / `SHA256SUMS` | 完整软件包版本和工件完整性校验 |

**原厂独立 kernel/rootfs 布局不能直接上传本项目的 sysupgrade ITB，也不能
使用 `sysupgrade -F` 强制升级。** 首次迁移涉及分区及启动链，须阅读完整手册。
本项目 U-Boot 不保留原厂 Web 升级界面，使用串口菜单和 TFTP。

本次 production 启动和两个分区的回读已验证。新 BL2/FIP 经过构建与二进制
差异审查，未重新刷入设备；从所提供原厂版本出发的完整迁移仍未实测。
短时验证不能替代长期负载、Wi-Fi 射频、5G 和真实 WAN/HNAT 测试。

## 构建

在普通 Linux 用户下操作，安装 OpenWrt 构建依赖，工作路径不要含空格。
不要将旧树的 `build_dir`、`staging_dir`、`tmp` 或 feeds 软链接带入。

```sh
git clone -b h5000m-1g-minimal --single-branch https://github.com/damocjwj/immortalwrt-h5000m-1g.git
cd immortalwrt-h5000m-1g
./scripts/feeds update -a
./scripts/feeds install -a
cp config/h5000m-1g-minimal.config .config
make defconfig
./scripts/h5000m-1g-verify
make -j12 V=s
./scripts/h5000m-1g-verify --artifacts
```

`feeds.conf.default` 固定提交，不跟随 feeds 最新分支。选择的包均内置；不构建
全量 kmod。Argon 和 datconf 源码自包含，minimal 不依赖其他本地包仓库。
不要跨内核 ABI 强制安装 kmod；后续增包优先使用同一锁定源码重新构建。

## 来源

厂商基线：[padavanonly/immortalwrt-mt798x-6.6](https://github.com/padavanonly/immortalwrt-mt798x-6.6/tree/30fbc1d6deba23c0e850185021e9ee42214925eb)。
软件包继续遵循各自许可证；本仓库不代表 Hiveton、MediaTek 或 ImmortalWrt 官方维护。
`docs/` 中带日期的早期审计记录仅描述当时版本，当前有效设计以本页所链接的
手册和本次发布记录为准。

## 许可证

本仓库不是整体 MIT 项目。ImmortalWrt 基础遵循 [COPYING](COPYING) 中的
GPL-2.0-only，第三方代码、固件和依赖保留各自许可证与版权声明；基于上游的
修改继续遵守相应许可。

本项目明确列出的原创迁移手册、发布记录及许可说明额外提供 MIT 授权，
不扩展到上游代码、引用材料或 Release 固件。适用文件和边界见
[许可说明](docs/licensing.md)。公开仓库不代表替第三方代码重新授权。
