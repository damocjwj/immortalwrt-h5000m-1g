<!-- SPDX-License-Identifier: MIT -->

# H5000M 1G：首次迁移与日常升级

原创文字 Copyright (c) 2026 damocjwj，额外按 [MIT](LICENSE.MIT) 授权；
范围和第三方材料除外条款见[许可说明](licensing.md)。

## 先确认适用范围

本指南对应 [2026.09.14 Release](https://github.com/damocjwj/immortalwrt-h5000m-1g/releases/tag/h5000m-1g-minimal-2026.09.14)，
仅适用 1 GiB 内存、15,269,888 个 512 字节扇区的 H5000M。
**首次迁移会破坏旧系统布局和设置，操作错误或断电可能导致无法启动。**
本次已验证同布局 production 升级和 recovery 写入回读；从以下原厂样本出发
的完整首次迁移、以及本次新 BL2/FIP 的实机启动尚未验证。
以下首次迁移是带停止条件的工程流程，不是已在所有原厂设备验证的一键教程。

必须具备串口监控、完整离机备份、稳定供电以及启动链损坏后的硬件恢复手段。
没有这些条件，请停留在原厂系统；不要先刷 FIP“试试看”。原厂 Web 救援依赖
原 FIP，本项目新 FIP 不含该 Web 界面，不能把它当成刷写失败后的永久兜底。

## 原厂资料与样本分析

厂商[更新系统说明](https://wiki.hiveton.com/project/h5000m/gengxinxitong)介绍了
原系统网页升级以及按键进入 `192.168.1.1` U-Boot 网页的方法。
[厂商 U-Boot 更新说明](https://hiveton.com/project/h5000m/chapter-mmunjfbunvrk8j)
描述的是其配套 FIP/Web 升级流程，并提醒非必要不更新。该说明中的原系统
`192.168.88.1:8080` 不是本固件默认地址；原厂 `dd ... mmcblk0p3` 操作也不能
替代本项目的新布局迁移。不同原厂批次的地址、命令和布局必须以实机为准。

用户提供的文件仅作为分析样本，未重新分发，也不据此证明所有批次一致：

| 文件 | 字节数 | SHA256 |
|---|---:|---|
| `immortalwrt-hiveton-h5000m-20251231.bin` | 67205948 | `b0fc95098351b28354a6acbe5c0a96b87985210585b92c41fe95678358902768` |
| `fip.bin` | 1219568 | `53cf637909095e1990462149a845b6a4c1120009ae7fedb359bfcaa83aaf28f5` |

系统样本包含 tar 路径 `sysupgrade-hiveton,h5000m/` 下的 CONTROL、kernel、root。
升级脚本检查 `ustar`，分别写 `kernel` 和 `rootfs`；板型为 `hiveton,h5000m`。
其中 kernel 为 FIT（4,597,372 B），root 为独立 SquashFS（62,600,192 B）。
系统自报 `24.10-SNAPSHOT r33418-34bb738192`、Linux 6.6.94。

FIP 字符串为 U-Boot 2025.07，构建时间 2025-08-18，并包含 Web/mtkupgrade、
tftpboot、bootm 等命令字符串；这**不能证明**该二进制可以加载本项目的 FIT，
也不能证明其最大解压尺寸、运行时环境或实际 GPT。样本没有提供完整 eMMC 镜像。

新系统板型为 `hiveton,h5000m-1g`，采用 recovery/production FIT 和 F2FS overlay。
**禁止在旧网页中直接上传新 ITB，禁止使用 `sysupgrade -F` 绕过机型/格式检查。**

## 一、准备与原系统只读检查

准备 Linux 电脑（至少 16 GB 空闲空间，建议更大）、有线直连、TFTP 服务、
正确电平的 USB-TTL 串口、稳定电源。串口通常使用 115200 8N1、无流控；
引脚和电平先按板卡资料/测量确认，不猜测引脚，不接适配器供电脚，不用 RS-232 电平。
连接天线，避免初始化无线时无负载发射。记录整个串口日志并妥善保存，不公开设备标识。

从 Release 下载全部七个工件及 `SHA256SUMS`，在电脑执行：

```sh
sha256sum -c SHA256SUMS
```

每项必须为 OK。TFTP 目录只放本次公开工件，不放账号备份、factory 或原厂镜像。
电脑为隔离网段 `192.168.1.254/24`，不要同时连接另一个同网段的路由器。

在原系统通过 SSH/串口读取（没有某个命令时停止补充检查，不能猜测结果）：

```sh
ubus call system board
cat /proc/meminfo
cat /sys/class/block/mmcblk0/size
cat /proc/partitions
cat /proc/mounts
cat /proc/swaps
for p in /sys/class/block/mmcblk0p*; do
    echo "$p"
    cat "$p/start" "$p/size" "$p/uevent"
done
cat /etc/fw_env.config
fw_printenv
```

核对内存约 1 GiB（MemTotal 会扣除保留内存）、磁盘扇区数 **15269888**、
factory 的名称/起点/大小及环境位置。用可用的只读 GPT 工具校验主备表 CRC/GUID。
eMMC 工具可用时保存 `mmc extcsd read /dev/mmcblk0`，重点记录
PARTITION_CONFIG 的 boot partition enable、boot bus、boot0/boot1 容量与写保护。
本安装方案要求启动来自 **boot0**；若为 boot1、user area 或无法判定，停止，
不要照抄 `mmc partconf` 更改选区。

本指南的写入模板要求旧 factory 已位于 **9216 起、8192 扇区长**。
若不相同，必须先制定独立校准数据迁移方案，不能执行下面的偏移写入。
同样核对新 ubootenv/FIP 区域没有需要另行保留的原厂数据。

## 二、离机备份：必须在任何写入前完成

在电脑设置 `OLD_IP` 为实测原系统地址。以下在 Linux/POSIX shell 执行，
不使用旧版 PowerShell 的文本重定向处理二进制，不使用 SSH `-t`：

```sh
OLD_IP=192.168.88.1  # 示例，先改为实际地址
mkdir -m 700 stock-backup
ssh root@"$OLD_IP" 'dd if=/dev/mmcblk0 bs=1048576' > stock-backup/emmc-user.bin
ssh root@"$OLD_IP" 'dd if=/dev/mmcblk0boot0 bs=1048576' > stock-backup/boot0.bin
ssh root@"$OLD_IP" 'dd if=/dev/mmcblk0boot1 bs=1048576' > stock-backup/boot1.bin
ssh root@"$OLD_IP" 'fw_printenv' > stock-backup/environment.txt
ssh root@"$OLD_IP" 'cat /etc/fw_env.config; cat /proc/partitions' > stock-backup/layout.txt
sha256sum stock-backup/*.bin
wc -c stock-backup/*.bin
```

每次 SSH 必须成功退出，user 镜像必须为 **7818182656** 字节，boot 镜像长度
必须等于实机对应 `/sys/class/block/mmcblk0boot*/size × 512`。
此外按**检查得到的真实位置**单独读取 factory、环境区域、原 FIP、主备 GPT，
保存 EXT_CSD、分区 GUID 和原系统配置；不能把示例分区编号当作实测结果。
校验电脑文件与设备相同区域的 SHA256。先停止业务写入；运行中的旧 rootfs 备份
可能不一致，因此这份在线备份不作为完整回退保证。进入下节受控 RAM 环境后，
在任何写入前重做/核对静态整盘备份；无法取得一致备份则停止迁移。

备份至少另存一份到独立介质。完整原盘含用户密码、订阅与校准数据，**不得上传 GitHub**。
本 Release 的 BL2/FIP 不能替代原机启动链备份，`sysupgrade -b` 也不是整盘备份。

## 三、验证原 U-Boot，并只启动 RAM recovery

重启并用串口中断倒计时。先读取 `version`、`bdinfo`、`printenv`、`mmc info`、
`mmc part`，用 `help tftpboot`、`help iminfo`、`help bootm` 确认命令真实存在。
记录原环境；不要执行 `saveenv`、`mtkupgrade` 或会自动写盘的菜单项。
确认 RAM 地址范围以及 FIT/解压支持后，才使用下列**待原厂实机验证**的示例：

```text
setenv ipaddr 192.168.1.1
setenv serverip 192.168.1.254
tftpboot 0x48000000 immortalwrt-mediatek-filogic-hiveton-h5000m-1g-initramfs-recovery.itb
iminfo 0x48000000
```

预期传输 **18677760** 字节，FIT 校验通过，配置名 `config-1`。
若传输失败、FIT 不识别、地址重叠或解压上限不能确认，**停止，不先更新启动链**。

注意：initramfs 不自动等于“绝不写盘”。本系统有板级环境初始化，普通启动
还可能探测 overlay。首次迁移应先绕过常规 init，例如确认原 U-Boot 能传递
bootargs 后，使用独立的 RAM shell：

```text
setenv bootargs console=ttyS0,115200n1 rdinit=/bin/sh
bootm 0x48000000#config-1
```

这一步尚未在所提供原 FIP 上实测。必须从串口确认 PID 1 是 `/bin/sh`，而不是
procd，内核命令行确含 `rdinit=/bin/sh`；若参数被覆盖、进入普通系统或不能启动，
停止排查，不能继续刷写。不要执行 `/sbin/init` 或 uci-defaults 来绕过此门槛。

在 RAM shell 里只挂 proc/sysfs 和 RAM 临时目录（已挂载者不重复挂）：

```sh
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t tmpfs tmpfs /tmp
cat /proc/cmdline
cat /proc/1/comm
cat /proc/mounts
cat /proc/swaps
cat /sys/class/block/mmcblk0/size
```

不得有 mmc/fit/dm 设备用于根、`/overlay`、其他挂载或 swap。应为 RAM rootfs，
不是 eMMC 的 SquashFS/F2FS。设备节点缺失时按 `/sys/class/block/名称/dev` 的
实际 major:minor 创建，**不猜设备号**。网络可用性同样需要实测；eth0 是本板 LAN：

```sh
ip link set eth0 up
ip addr add 192.168.1.1/24 dev eth0
```

若驱动、链路、文件传输工具或风扇控制不可用，停止；不可为继续教程而启动整套
系统服务。手动 RAM 环境没有风扇守护进程，应监控温度并按核实的 PWM 节点
保持散热。通过可用的 BusyBox TFTP/受控 SSH 将工件放到 `/tmp`，逐个 SHA256
校验；不要将备份或工件暂存在待重分区的 eMMC 上。
在此静态环境重新备份整盘/boot 分区到电脑，可使用已确认可用的二进制传输
工具；传输环境没准备好就是停止条件。本手册不假定原厂或单用户环境自带 SSH。

## 四、首次写入：仅限全部检查通过后的维护窗口

以下是**审阅用写入模板，不要整段盲贴**。它只适用于上面完全匹配的磁盘。
保持纯 RAM 环境，不重载 GPT、不重启，直到所有写入和回读成功。
旧分区视图可能仍叫 kernel/rootfs，下面使用整盘绝对偏移而不是 `/dev/mmcblk0pN`。
对 factory **不执行任何写入**。

先进入存放 Release 工件的 RAM 目录，设置共同前缀并校验：

```sh
cd /tmp
P=immortalwrt-mediatek-filogic-hiveton-h5000m-1g
sha256sum -c SHA256SUMS
fwtool -i /dev/null -T "$P-squashfs-sysupgrade.itb" > production.fit
wc -c production.fit
```

本次去掉 fwtool 元数据后的 FIT 应为 **21561344** 字节。
任一步返回非零、长度不符或缺少工具均停止；原始 ITB 保持不变。
先把系统放到目标偏移，使用每条命令的返回值和后续回读判断成功：

```sh
dd if="$P-initramfs-recovery.itb" of=/dev/mmcblk0 bs=512 seek=32768 conv=notrunc
dd if=production.fit of=/dev/mmcblk0 bs=512 seek=294912 conv=notrunc
# 仅适用于本次镜像：新 fitrw 起点为 production 内的 41888 扇区。
# 初始化 overlay，不沿用原盘恰好落在此处的签名或配置。
dd if=/dev/zero of=/dev/mmcblk0 bs=512 seek=336800 count=8 conv=notrunc
sync
```

清零覆盖 FIT 的可写填充区，因此 production 全文件 SHA 不再相同。回读 recovery
的 36,480 扇区，与发布 SHA 比较；production 回读前 **41888** 扇区不可变部分，
SHA 应为 `b4be09b15861b859e4473e2b88014c1da9b8319ea6bddff80a221b749c995875`。
清零处八扇区必须全零：

```sh
dd if=/dev/mmcblk0 bs=512 skip=32768 count=36480 | sha256sum
dd if=/dev/mmcblk0 bs=512 skip=294912 count=41888 | sha256sum
dd if=/dev/mmcblk0 bs=512 skip=336800 count=8 | hexdump -C
```

仍须分别检查 dd 返回/读取字节数；管道末尾 sha256sum 成功不代表前面没有 I/O 错误。
这里为不保留设置迁移，不手工 mkfs 整个 production，不复制旧 overlay。

接下来是不可掉电的启动链/GPT 写入窗口。只有静态整盘备份和 boot0 启动选择
已确认，才临时解除 **boot0** 写保护并写 BL2：

```sh
echo 0 > /sys/class/block/mmcblk0boot0/force_ro
dd if="$P-emmc-preloader.bin" of=/dev/mmcblk0boot0 bs=512 conv=notrunc
sync
echo 1 > /sys/class/block/mmcblk0boot0/force_ro
dd if="$P-emmc-bl31-uboot.fip" of=/dev/mmcblk0 bs=512 seek=17408 conv=notrunc
sync
```

BL2 非整扇区长度，以前 **250544** 字节回读；FIP 以前 **676056** 字节回读。
可读入 `/tmp` 再 `head -c` 取准确长度计算 SHA256；不得只看 dd 退出值。
例如 `dd if=/dev/mmcblk0 bs=512 skip=17408 count=1321` 覆盖足够 FIP 字节，
但多余字节不纳入 FIP SHA。两者必须等于 Release 对应值，否则不继续。
不要变更 boot bus/boot partition 配置，也不写 boot1。

清空新位置两个冗余环境副本，再写备份 GPT、主 GPT：

```sh
dd if=/dev/zero of=/dev/mmcblk0 bs=512 seek=8192 count=1024 conv=notrunc
dd if="$P-emmc-gpt-backup.bin" of=/dev/mmcblk0 bs=512 seek=15269855 conv=notrunc
dd if="$P-emmc-gpt.bin" of=/dev/mmcblk0 bs=512 seek=0 conv=notrunc
sync
```

清空环境会暂时使两个 CRC 无效，新 U-Boot 从内置 H5000M 环境启动；第一次正常
Linux 启动时 `97-h5000m-1g-uboot-env` 写入板级持久环境，不能沿用旧厂商环境。
不要在仍使用旧 GPT 的 RAM 系统里调用 `fw_setenv`，其路径可能指向错误分区。

回读磁盘前 34 扇区、最后 33 扇区，分别匹配 GPT SHA；用只读 GPT 校验工具
检查 CRC、GUID、起止位置。factory 原位置 8192 扇区的 SHA 必须等于离机备份，
环境 1024 扇区为零，boot0 强制只读已恢复。所有确认完成后才受控重启。
若失败，保持 RAM 系统和电源，通过已审核的备份恢复方案处理，不反复尝试启动。

## 五、首次启动验收

串口应显示本项目 1G U-Boot 菜单，生产 FIT 启动；系统默认
`192.168.1.1`、`root/admin`，WAN DHCP。电脑改回同网段，首次登录修改密码。
检查 `ubus call system board` 为 `hiveton,h5000m-1g`，内存/eMMC/五分区正确，
无 p6/data，SquashFS + F2FS overlay 正常；`fw_printenv` 的 FIT 上限为
`6000000`，不是 4G 的 1 GiB。验证风扇、EEPROM、MAC、网络接口和日志。

用串口菜单 **Boot recovery system from eMMC** 验证救援启动，再返回 production。
本次发布没有重新启动新版 recovery 的实机记录，使用者必须补做此项，不能仅凭
分区回读一致断言可启动。启动错误、F2FS 错误、异常温度或反复重启时停止上线。

## 六、同布局日常升级（不改启动链）

仅在已经使用本项目板型、GPT 和启动链的系统中使用 sysupgrade ITB。
先把镜像放到 RAM `/tmp` 并对照 Release SHA256，再检查：

```sh
sysupgrade -T /tmp/immortalwrt-mediatek-filogic-hiveton-h5000m-1g-squashfs-sysupgrade.itb
```

返回非零就停止，不使用 `-F`。不保留设置：

```sh
sysupgrade -n /tmp/immortalwrt-mediatek-filogic-hiveton-h5000m-1g-squashfs-sysupgrade.itb
```

需要保留配置时，先运行 `sysupgrade -b /tmp/settings.tar.gz` 并下载备份，再执行
不带 `-n` 的正常 sysupgrade。只适合同代兼容设置；不导入原厂 kernel/rootfs 系统
备份或另一板型备份。后装包不会随配置备份变成内置包，需要同 ABI 包重新安装。
LuCI“保留设置”与上述选择对应。SSH 断开不等于写入失败，等待串口启动结果。
日常更新**不写 GPT、BL2、FIP、环境或 factory**。

### 单独更新 recovery

只有确认新 GPT 中 p4 名称为 recovery、起点 32768、长度 262144 扇区，且当前
运行的是 production、p4 未挂载时，才能在 production 写 p4。上传 recovery 到
`/tmp` 校验 SHA/96 MiB FIT 上限后：

```sh
dd if=/tmp/immortalwrt-mediatek-filogic-hiveton-h5000m-1g-initramfs-recovery.itb of=/dev/mmcblk0p4 bs=65536 conv=notrunc
sync
dd if=/dev/mmcblk0p4 bs=65536 count=285 | sha256sum
```

`285` 只适用于本次 18,677,760 B 工件；以后按实际大小取准确字节回读。
不得用 sysupgrade ITB 代替 recovery，也不要在旧原厂布局复用 p4 命令。

### 恢复默认、地址冲突及回退

- 恢复默认设置可使用 LuCI 恢复功能或重新 `sysupgrade -n`；默认地址回到
  `192.168.1.1`，先与同地址上级路由隔离。不要把手动改成的 `192.168.6.1`
  误认为固件默认地址。
- 新 U-Boot 的 TFTP 示例为设备 `192.168.1.1`、电脑 `192.168.1.254`，
  使用 Release 的完整文件名。串口菜单区分 RAM 启动和“load then write”；
  救援检查时只选 RAM 启动项，不选写入项。
- 回退原厂需要原机完整一致的 user/boot0/boot1、环境、校准数据和 boot 配置。
  必须从独立 RAM 恢复环境按原布局恢复并回读核对；仅上传提供的原厂 tar 或
  `fip.bin` 不能恢复新 GPT 及被覆盖的原厂系统。没有完整备份不能承诺可回退。
- 本项目不提供包含原厂二进制、账户、factory 或其他设备校准数据的恢复包。
