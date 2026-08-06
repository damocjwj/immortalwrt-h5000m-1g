# H5000M 1G/8GB 构建产物评审

评审日期：2026-07-18。源码分支为 `h5000m-1g`，基线为
`h5000m-stable-2026.07.17`。该仓库只导出 1G/8GB 设备、`emmc-comb`
BL2 和 1G U-Boot 目标；未生成 4G H5000M 产物。

## 最终产物

| 产物 | 字节数 | SHA-256 |
|---|---:|---|
| eMMC BL2 | 250,544 | `509f8f5777a2a9154d169005c80cf5fae2284fa7a74c9924d2acfa99236a9d38` |
| BL31 + U-Boot FIP | 676,056 | `b95201d9283a1f4efab97fcc9c4d39c0bd0b614305a9c1dfcc00b55986bbeaa1` |
| 主 GPT | 17,408 | `481627ce0eb85b761a4e09925e7edd44fc79ddd63bc7e6e1100f510d9215c89d` |
| 备份 GPT | 16,896 | `cbdc899080d050c015c0ead3ad152612ca51e9ba7caad3120dc4b45e210d3fe6` |
| initramfs recovery | 18,677,760 | `3f5859f3226bb438808a35129d4a68ac6ff101d091fd8f7db51ca8ea453164f4` |
| production sysupgrade | 21,562,163 | `8de529d26eaeafef063bd53700651f61238c3b10d92f6c12e967f79757f6b58e` |
| package manifest | 7,561 | `4af12c4a6436c878cd7049457ba9a36df8079bcfbfae4be359fe38f749c87b45` |

production 去除 fwtool 尾部元数据后的 FIT 为 21,561,344 字节；recovery 和
production 均远小于 96 MiB 上限。FIT 中 kernel load 为 `0x40000000`，DTB
load 为 `0x4ff00000`。编译后的 U-Boot 确认为：

- `CONFIG_SYS_BOOTM_LEN=0x6000000`
- `CONFIG_SYS_LOAD_ADDR=0x48000000`
- `CONFIG_DEFAULT_DEVICE_TREE="mt7987a-hiveton-h5000m-1g-emmc"`
- eMMC 环境和冗余环境启用；EXT4、UBI 命令未启用。

## 与旧 1G 版本比较

| 项目 | 旧版 | 新稳定精简版 | 变化原因 |
|---|---:|---:|---|
| BL2 | 250,544 B | 250,544 B | 均为 `emmc-comb` 和同一 ATF 提交；新产物采用稳定基线锁定的构建时间/源码封装，版本字符串时间及镜像校验随之变化。 |
| FIP | 1,176,520 B | 676,056 B | 使用正式化、精简后的独立 H5000M U-Boot；加入固定 GPT、96 MiB FIT 上限、自动启动和 recovery 回退，删除无关命令。 |
| recovery | 39,059,456 B | 18,677,760 B | 软件包裁剪和 release 内核配置生效；保留 bridge netfilter 和透明代理所需通用 kmod 后仍远低于 96 MiB。 |
| production | 48,497,474 B | 21,562,163 B | 同上；overlay 可用容量由新 production 分区提供，不靠扩大 FIT。 |
| manifest | 373 包 | 253 包 | 删除代理、Full-cone、VPN/容器、MTD/UBI、ext4/data 管理及无用诊断依赖；新增标准 `wpad-openssl`/`hostapd-common`，保留 `kmod-br-netfilter` 及当前 Nikki 运行配置所需的 7 个通用 kmod，但不包含 Nikki/Mihomo 等用户态程序。 |

旧 BL2/FIP SHA-256 分别为 `0e088251cf8195acaec17983bd52b42dbac37e66f9eea4422d7ca1c18dd9835b`
和 `14b85a201fffd7cca407898e13608e47433889a5b3b13a2e2c54aadc413862d1`。
旧 GPT 只有主表产物，且 recovery/production 仍为 48/160 MiB；新 GPT 改为
128 MiB recovery、其余空间全部归 production，生成并校验设备末尾的备份表。

## 校验结论

`h5000m-1g-verify --artifacts` 已通过以下检查：GPT 主备表 CRC、GUID、类型、
扇区边界，FIT 结构/地址/尺寸，U-Boot 最终配置和环境，启动链锁定哈希，软件包
保留/排除列表，以及 BCM/XT/nft Full-cone 清理。最终内核关闭
`DEBUG_KERNEL`、DWARF/BTF 调试信息、ftrace、kprobes 和 perf，保留 MTK HWIFI
实际需要的 debugfs；BBR 可用，默认 CCA 仍为 cubic。

本次网络路径收尾确认：在 HNAT 与 Nikki Fake-IP/透明代理同时开启时，若
`bridge-nf-call-iptables`/`ip6tables` 为 1，无线桥流量会进入额外的 bridge
netfilter 路径并失效。镜像现已正式保留 `kmod-br-netfilter`，采用其 OpenWrt
标准配置把 arptables、IPv4 和 IPv6 bridge hook 默认设为 0；未引入 iptables
用户态、防火墙规则或通用 Full-cone。

首次实机完整烧录还发现：清空 env 后，Linux `fw_envtools` 会报告自身的通用
distro-boot 默认值，而 U-Boot 实际使用 FIP 内置的 H5000M 默认值。源码已加入
1G 板级持久环境清单和一次性初始化脚本，保证后续 `fw_printenv/fw_setenv` 与
U-Boot 启动路径一致。

初始稳定产物已于 2026-07-18 写入实机。因当时仅有 SSH，本次使用旧 U-Boot
的 recovery 回退路径先进入 initramfs，再从内存系统中完整写入 BL2、FIP、
主/备 GPT、recovery 和 production。factory 写前写后 SHA-256 一致。该流程是针对
已确认旧启动链能力的受控迁移，不改变“不能从旧 GPT 直接执行普通
sysupgrade”的限制。回读哈希和实机功能结果见
`docs/h5000m-1g-flash-validation-2026-07-18.md`。

后续 production 更新实测发现，通用 `emmc_copy_config` 将配置归档写到完整
FIT 的填充末尾，而 fitblk 的 F2FS 区实际从页面对齐后的 SquashFS 末尾开始，
两者相差约 156 KiB，导致 sysupgrade 虽生成归档却无法在 preinit 恢复。最终
源码已从新 FIT 的 SquashFS superblock 计算 fitrw 起始扇区；本产物计算结果为
41,808 个扇区，并已通过主机和设备 BusyBox 两套解析测试。为避免继续重启现场
设备，修复后的 production 未再次刷写，等效升级脚本已以 overlay hotfix 方式
安装到实机；下次正常 sysupgrade 会直接使用该修复。
