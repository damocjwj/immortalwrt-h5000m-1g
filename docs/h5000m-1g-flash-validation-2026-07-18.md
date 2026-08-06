# H5000M 1G/8GB 实机烧录与验证记录

日期：2026-07-18。目标设备为 1 GiB DDR、`8GTF4R` eMMC，板型 ID
`hiveton,h5000m-1g`。本次现场仅有 SSH，无可用串口。

## 写入前保护

已备份 eMMC 首部 16 MiB、末尾 GPT、boot0、factory、FIP、旧 recovery
和旧 production。备份目录为：

`/home/damoc/wrts/backups/h5000m-1g-pre-migration-20260718`

factory 备份 SHA-256 为
`bb9f8df61474d25e71fa00722318cd387396ca1736605e1248821cc0de3d3af8`。
完整备份哈希见该目录的 `SHA256SUMS`。

## 烧录路径

1. 将新 recovery 写入旧 recovery 分区，读回比对一致。
2. 临时设置 recovery 优先的 U-Boot 启动顺序，重启进入 initramfs。
3. 在纯内存系统中先写 production、recovery、FIP 和 boot0 BL2，最后写
   备份 GPT 和主 GPT，避免提前切换分区视图。
4. 清除旧 env，从新 FIP 的 H5000M 1G 板级默认环境启动。
5. 发现 `fw_envtools` 在空 env 时显示通用 distro-boot 回退值后，在源码中
   加入板级环境清单和一次性初始化脚本，重新构建并刷入最终 recovery/
   production。最终 `fw_printenv` 与 U-Boot 实际启动路径一致。

## 关键区域回读

| 区域 | 最终 SHA-256 |
|---|---|
| BL2 | `509f8f5777a2a9154d169005c80cf5fae2284fa7a74c9924d2acfa99236a9d38` |
| FIP | `b95201d9283a1f4efab97fcc9c4d39c0bd0b614305a9c1dfcc00b55986bbeaa1` |
| 主 GPT | `481627ce0eb85b761a4e09925e7edd44fc79ddd63bc7e6e1100f510d9215c89d` |
| 备份 GPT | `cbdc899080d050c015c0ead3ad152612ca51e9ba7caad3120dc4b45e210d3fe6` |
| recovery | `a89318f57e390c5b14350aa971eedf30a2e348a47777afbd216d2ddc6f1541c1` |
| production 不可变 FIT 区（前 21,360,640 字节） | `b8d5bfb10c5f79f814ade0ace1cefaf4a7dbbaf1df8650bc8236d6e347605f37` |
| factory | `bb9f8df61474d25e71fa00722318cd387396ca1736605e1248821cc0de3d3af8` |

production 的 fwtool 尾部与 FIT 后续空间会被 fitblk/F2FS overlay 使用，因此
实机运行后不应对整个 production 分区与 sysupgrade 文件做全长哈希比较。
上表对不可变 FIT 区做定长比对，已通过。factory 写前写后哈希一致。

## 实机结果

- 内核 `6.6.94`，rootfs 为 squashfs，F2FS overlay 位于 `/dev/fitrw`；
  production 为 14,974,943 个扇区，overlay 约 7.1 GiB、可用约 6.9 GiB。
- recovery 固定为 262,144 个扇区（128 MiB）；无 data/p128 分区，无
  userdata 自动挂载配置。
- 持久 U-Boot env 为 `bootcmd=run boot_emmc`、`loadaddr=0x48000000`、
  `bootm_size=0x6000000`，production/recovery FIT 上限均为 `0x6000000`。
- `mtkhnat` hook 为 enabled，TurboACC RPC 返回 MediaTek HNAT 和 2 个 PPE；
  `nf_conntrack_nat_mode` 不存在，firewall Full-cone IPv4/IPv6 均为 0。
- TCP CCA 可用 `reno cubic bbr`，默认为 cubic。
- 2.4 GHz/5 GHz AP 均为 Master 并广播；LAN 为 1000 Mb/s full duplex；
  DNS/DHCP 正常监听。
- fancontrol 运行，状态只包含 CPU 温度/PWM；风扇接管和 CPU 曲线调速正常。
- Quectel `2c7c:0800` 5G 模组已枚举，完整蜂窝软件栈保留。
- LuCI 登录和“网络加速”页面返回正常，前端与构建产物一致；
  TurboACC 后端 RPC 方法均可用。
- 启动日志未发现 eMMC I/O 错误、kernel panic/oops/call trace、
  `nft_try_fullcone failed`、`bcm_nat` 或运行期无线重置。

## 未覆盖项

现场仅连接 LAN/SSH，因此未做实际 WAN 上网、蜂窝拨号/数据传输、客户端
DHCP 租约、持续双频流量和 24 小时压力测试。这些不影响本次对烧录完整性、
启动链、分区、本地服务和前后端的短时基线判定，但不能替代后续长时间
运行验证。

## Bridge netfilter 与运行配置更新

同日追加安装并纳入 production 的 `kmod-br-netfilter`，同时保留当前 Nikki
透明代理所需的 `dummy`、`inet-diag`、socket/tproxy、nft socket/tproxy 和
TUN 通用内核模块。用户态 Nikki/Mihomo、Subpipe、ByeDPI 和 FRPC 仍未进入
固件 manifest，升级后由已备份的同版本 IPK 恢复。更新前的配置、完整
`/etc/nikki`、`/etc/subpipe`、`/etc/frp`、opkg 状态和保留清单位于：

`/home/damoc/wrts/backups/h5000m-1g-pre-br-netfilter-20260718-201945`

最终实机 production sysupgrade SHA-256 为
`891036bb3bf001ce2e2d223f87f68306523dee411eeb1b28acc7c0289e6f01d3`；运行后
不可变的前 21,360,640 字节回读哈希为
`f11cc0b1abafefe78112d782e3b4cf59ab94eac40098668101b9128b2ad48348`，与构建
FIT 完全一致。BL2、FIP、factory 回读哈希均与上表锁定值相同，GPT、recovery
和启动链未刷写。

实机确认 `/etc/sysctl.d/11-br-netfilter.conf` 存在，arptables、IPv4 和 IPv6
三个 bridge hook 均为 0；HNAT hook 为 enabled。双频恢复为 `HHH-2.4G`/
`HHH-5G` WPA3 AP，F2FS overlay 约 7.1 GiB。Nikki、Subpipe、ByeDPI 同时运行，
内存 available 约 637 MiB；Subpipe 本地发布返回 HTTP 200，ByeDPI 节点恰好
1 个，11 个含 DIRECT 的规则组均恰好含一次 ByeDPI。FRPC 保持升级前的禁用
状态。上联要求的静态 IP 未配置，因此本轮不把外网访问作为通过条件。

现场连续重启均由 production 更新和验证命令主动触发；停止主动重启后，boot
ID 保持不变，日志未发现 OOM、watchdog、panic 或 eMMC I/O 错误。为避免再次
影响现场，只对配置恢复缺口安装了无需重启的升级脚本 hotfix。

## sysupgrade 配置恢复修复

两次更新都生成了正确的 sysupgrade 保留清单，但通用 eMMC FIT 路径把
`sysupgrade.tgz` 写在完整 FIT 填充末尾，落入 fitrw 起点之后，preinit 无法
识别；本轮已从独立备份显式恢复全部设置和数据。源码现从新镜像的 SquashFS
superblock 计算页面对齐后的 fitrw 起点，并将配置归档写到该扇区。修复后的
production 产物 SHA-256 为
`8de529d26eaeafef063bd53700651f61238c3b10d92f6c12e967f79757f6b58e`，计算出的
fitrw 起点为 41,808 扇区。该产物为避免增加一次重启未再次刷写；实机已安装
相同脚本的 overlay hotfix，SHA-256 为
`a5913a770217672993620d015fba3f9e478bb8055c074f1d48a13dc5e7429780`，对当前
镜像实测计算出 41,800 扇区，因此下一次 sysupgrade 会直接采用修复路径。
