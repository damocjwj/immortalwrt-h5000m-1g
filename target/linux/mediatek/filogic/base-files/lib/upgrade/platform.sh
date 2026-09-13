REQUIRE_IMAGE_METADATA=1
RAMFS_COPY_BIN='fitblk blkid dmsetup strings hexdump'

asus_initial_setup()
{
	# initialize UBI if it's running on initramfs
	[ "$(rootfs_type)" = "tmpfs" ] || return 0

	ubirmvol /dev/ubi0 -N rootfs
	ubirmvol /dev/ubi0 -N rootfs_data
	ubirmvol /dev/ubi0 -N jffs2
	ubimkvol /dev/ubi0 -N jffs2 -s 0x3e000
}

xiaomi_initial_setup()
{
	# initialize UBI and setup uboot-env if it's running on initramfs
	[ "$(rootfs_type)" = "tmpfs" ] || return 0

	local mtdnum="$( find_mtd_index ubi )"
	if [ ! "$mtdnum" ]; then
		echo "unable to find mtd partition ubi"
		return 1
	fi

	local kern_mtdnum="$( find_mtd_index ubi_kernel )"
	if [ ! "$kern_mtdnum" ]; then
		echo "unable to find mtd partition ubi_kernel"
		return 1
	fi

	ubidetach -m "$mtdnum"
	ubiformat /dev/mtd$mtdnum -y

	ubidetach -m "$kern_mtdnum"
	ubiformat /dev/mtd$kern_mtdnum -y

	if ! fw_printenv -n flag_try_sys2_failed &>/dev/null; then
		echo "failed to access u-boot-env. skip env setup."
		return 0
	fi

	fw_setenv -s - <<-EOF
		boot_wait on
		uart_en 1
		flag_boot_rootfs 0
		flag_last_success 1
		flag_boot_success 1
		flag_try_sys1_failed 8
		flag_try_sys2_failed 8
	EOF

	local board=$(board_name)
	case "$board" in
	xiaomi,mi-router-ax3000t|\
	xiaomi,mi-router-wr30u-stock)
		fw_setenv mtdparts "nmbm0:1024k(bl2),256k(Nvram),256k(Bdata),2048k(factory),2048k(fip),256k(crash),256k(crash_log),34816k(ubi),34816k(ubi1),32768k(overlay),12288k(data),256k(KF)"
		;;
	xiaomi,redmi-router-ax6000-stock)
		fw_setenv mtdparts "nmbm0:1024k(bl2),256k(Nvram),256k(Bdata),2048k(factory),2048k(fip),256k(crash),256k(crash_log),30720k(ubi),30720k(ubi1),51200k(overlay)"
		;;
	esac
}

# H5000M keeps a FIT plus its optional configuration archive in one GPT
# production partition.  The generic FIT helper does not know that partition's
# size, so reject a write before it can exceed the production volume.
h5000m_fit_capacity_check() {
	local part sectors fit_bytes fit_blocks backup_bytes backup_blocks wanted_blocks
	# The caller supplies the board-specific RAM loading boundary: 1 GiB for
	# the 4G model and 96 MiB for the 1G model.
	local boot_fit_max_bytes="${2:-1073741824}"

	export_fitblk_bootdev
	[ "$CI_METHOD" = "emmc" ] || {
		echo "H5000M: unable to identify the eMMC production partition" >&2
		return 1
	}
	[ -n "$EMMC_KERN_DEV" ] && [ -b "$EMMC_KERN_DEV" ] || {
		echo "H5000M: production partition is unavailable" >&2
		return 1
	}

	part="${EMMC_KERN_DEV##*/}"
	sectors="$(cat "/sys/class/block/$part/size" 2>/dev/null)"
	case "$sectors" in
		''|*[!0-9]*)
			echo "H5000M: cannot read production partition capacity" >&2
			return 1
			;;
	esac

	fit_bytes="$(get_image "$1" | fwtool -i /dev/null -T - | wc -c)"
	case "$fit_bytes" in
		''|*[!0-9]*)
			echo "H5000M: cannot measure FIT payload" >&2
			return 1
			;;
	esac
	fit_blocks=$(((fit_bytes + 511) / 512))
	[ "$fit_bytes" -le "$boot_fit_max_bytes" ] || {
		echo "H5000M: FIT is too large for the U-Boot RAM loading limit" >&2
		return 1
	}
	wanted_blocks="$fit_blocks"

	if [ -n "$UPGRADE_BACKUP" ]; then
		backup_bytes="$(wc -c < "$UPGRADE_BACKUP")"
		case "$backup_bytes" in
			''|*[!0-9]*)
				echo "H5000M: cannot measure configuration backup" >&2
				return 1
				;;
		esac
		backup_blocks=$(((backup_bytes + 511) / 512))
		wanted_blocks=$((wanted_blocks + backup_blocks))
	else
		# emmc_upgrade_fit clears eight sectors after a no-config upgrade.
		wanted_blocks=$((wanted_blocks + 8))
	fi

	[ "$wanted_blocks" -le "$sectors" ] || {
		echo "H5000M: FIT and configuration need $wanted_blocks sectors, production provides $sectors" >&2
		return 1
	}
}

# fitblk maps fitrw immediately after the page-aligned SquashFS sub-image, not
# after the padded end of the complete FIT.  Generic emmc_copy_config uses the
# latter and would place sysupgrade.tgz inside the new F2FS area, so preinit
# could not restore it.  Derive the actual fitrw start from the new image's
# SquashFS superblock and use that sector for configuration restore.
h5000m_fit_overlay_blocks() {
	local image="$1" fit_tmp="/tmp/h5000m-upgrade-fit.$$"
	local fit_bytes squashfs_offset bytes_used bytes_used_low bytes_used_high
	local rootfs_end version

	get_image "$image" | fwtool -i /dev/null -T - > "$fit_tmp" || {
		rm -f "$fit_tmp"
		return 1
	}
	fit_bytes="$(wc -c < "$fit_tmp")"

	for squashfs_offset in $(strings -t d "$fit_tmp" | awk '$2 ~ /^hsqs/ { print $1 }'); do
		case "$squashfs_offset" in
			''|*[!0-9]*) continue ;;
		esac
		version="$(dd if="$fit_tmp" bs=1 skip=$((squashfs_offset + 28)) count=4 2>/dev/null | \
			hexdump -v -e '2/2 "%u "')"
		[ "$version" = "4 0" ] || continue
		set -- $(dd if="$fit_tmp" bs=1 skip=$((squashfs_offset + 40)) count=8 2>/dev/null | \
			hexdump -v -e '2/4 "%u "')
		bytes_used_low="$1"
		bytes_used_high="$2"
		case "$bytes_used_low:$bytes_used_high" in
			*[!0-9:]*|:|*:|0:0) continue ;;
		esac
		bytes_used=$((bytes_used_low + bytes_used_high * 4294967296))
		rootfs_end=$((((squashfs_offset + bytes_used + 4095) / 4096) * 4096))
		[ "$rootfs_end" -le "$fit_bytes" ] || continue
		rm -f "$fit_tmp"
		echo $((rootfs_end / 512))
		return 0
	done

	echo "H5000M: cannot locate the SquashFS end in the new FIT" >&2
	rm -f "$fit_tmp"
	return 1
}

h5000m_fit_do_upgrade() {
	local overlay_blocks
	# Clear at the actual fitrw boundary below, not the padded FIT length.
	local EMMC_NO_KERNEL_CLEAR=1

	export_fitblk_bootdev
	[ "$CI_METHOD" = "emmc" ] || return 1
	h5000m_fit_capacity_check "$1" "$2" || return 1
	overlay_blocks="$(h5000m_fit_overlay_blocks "$1")" || return 1
	[ -e /dev/fit0 ] && fitblk /dev/fit0
	[ -e /dev/fitrw ] && fitblk /dev/fitrw
	emmc_do_upgrade "$1" || return 1
	export EMMC_KERNEL_BLOCKS="$overlay_blocks"
	if [ -z "$UPGRADE_BACKUP" ]; then
		dd if=/dev/zero of="$EMMC_KERN_DEV" bs=512 seek="$EMMC_KERNEL_BLOCKS" count=8 || return 1
	fi
	return 0
}

platform_do_upgrade() {
	local board=$(board_name)

	case "$board" in
	mediatek,mt7981-rfb)
		[ -e /dev/dm-0 ] && dmsetup remove_all
		[ -e /dev/fit0 ] && fitblk /dev/fit0
		[ -e /dev/fitrw ] && fitblk /dev/fitrw
		export_fitblk_bootdev
		case "$CI_METHOD" in
		emmc)
			mmc_do_upgrade "$1"
			;;
		default)
			default_do_upgrade "$1"
			;;
		ubi)
			CI_KERNPART="firmware"
			ubi_do_upgrade "$1"
			;;
		*)
			if grep \"rootfs_data\" /proc/mtd; then
				default_do_upgrade "$1"
			fi
			;;
		esac
		;;
	hiveton,h5000m)
		h5000m_fit_do_upgrade "$1" 1073741824 || exit 1
		;;
	hiveton,h5000m-1g)
		h5000m_fit_do_upgrade "$1" 100663296 || exit 1
		;;
	abt,asr3000|\
	bananapi,bpi-r3|\
	bananapi,bpi-r3-mini|\
	cmcc,a10-ubootmod|\
	cmcc,rax3000m|\
	gatonetworks,gdsp|\
	h3c,magic-nx30-pro|\
	jcg,q30-pro|\
	jdcloud,re-cp-03|\
	mediatek,mt7981-rfb|\
	mercusys,mr90x-v1-ubi|\
	netis,nx31|\
	nokia,ea0326gmp|\
	openwrt,one|\
	netcore,n60|\
	qihoo,360t7|\
	routerich,ax3000-ubootmod|\
	tplink,tl-xdr4288|\
	tplink,tl-xdr6086|\
	tplink,tl-xdr6088|\
	tplink,tl-xtr8488|\
	xiaomi,mi-router-ax3000t-ubootmod|\
	xiaomi,redmi-router-ax6000-ubootmod|\
	xiaomi,mi-router-wr30u-ubootmod|\
	zyxel,ex5601-t0-ubootmod)
		fit_do_upgrade "$1"
		;;
	acer,predator-w6|\
	acer,predator-w6d|\
	acer,vero-w6m|\
	glinet,gl-mt2500|\
	glinet,gl-mt6000|\
	glinet,gl-x3000|\
	glinet,gl-xe3000|\
	huasifei,wh3000|\
	mediatek,mt7987a|\
	smartrg,sdg-8612|\
	smartrg,sdg-8614|\
	smartrg,sdg-8622|\
	smartrg,sdg-8632)
		CI_KERNPART="kernel"
		CI_ROOTPART="rootfs"
		emmc_do_upgrade "$1"
		;;
	asus,rt-ax52|\
	asus,rt-ax59u|\
	asus,tuf-ax4200|\
	asus,tuf-ax6000)
		CI_UBIPART="UBI_DEV"
		CI_KERNPART="linux"
		nand_do_upgrade "$1"
		;;
	cudy,re3000-v1|\
	cudy,wr3000-v1|\
	yuncore,ax835|\
	wavlink,wl-wn573hx3)
		default_do_upgrade "$1"
		;;
	dlink,aquila-pro-ai-m30-a1|\
	dlink,aquila-pro-ai-m60-a1)
		fw_setenv sw_tryactive 0
		nand_do_upgrade "$1"
		;;
	mercusys,mr80x-v3|\
	mercusys,mr90x-v1|\
	tplink,re6000xd)
		CI_UBIPART="ubi0"
		nand_do_upgrade "$1"
		;;
	ubnt,unifi-6-plus)
		CI_KERNPART="kernel0"
		EMMC_ROOT_DEV="$(cmdline_get_var root)"
		emmc_do_upgrade "$1"
		;;
	unielec,u7981-01*)
		local rootdev="$(cmdline_get_var root)"
		rootdev="${rootdev##*/}"
		rootdev="${rootdev%p[0-9]*}"
		case "$rootdev" in
		mmc*)
			CI_ROOTDEV="$rootdev"
			CI_KERNPART="kernel"
			CI_ROOTPART="rootfs"
			emmc_do_upgrade "$1"
			;;
		*)
			CI_KERNPART="fit"
			nand_do_upgrade "$1"
			;;
		esac
		;;
	xiaomi,mi-router-ax3000t|\
	xiaomi,mi-router-wr30u-stock|\
	xiaomi,redmi-router-ax6000-stock)
		CI_KERN_UBIPART=ubi_kernel
		CI_ROOT_UBIPART=ubi
		nand_do_upgrade "$1"
		;;
	*)
		nand_do_upgrade "$1"
		;;
	esac
}

PART_NAME=firmware

platform_check_image() {
	local board=$(board_name)
	local magic="$(get_magic_long "$1")"

	[ "$#" -gt 1 ] && return 1

	case "$board" in
	mediatek,mt7981-rfb|\
	bananapi,bpi-r3|\
	bananapi,bpi-r3-mini|\
	cmcc,rax3000m)
		magic="$(dd if="$1" bs=1 skip=257 count=5 2>/dev/null)"

		[ "$magic" != "ustar" ] && {
			echo "Invalid image type."
			return 1
		}

		return 0
		;;
	hiveton,h5000m)
		fit_check_image "$1" || return $?
		h5000m_fit_capacity_check "$1" 1073741824
		return $?
		;;
	hiveton,h5000m-1g)
		fit_check_image "$1" || return $?
		h5000m_fit_capacity_check "$1" 100663296
		return $?
		;;

	*)
		nand_do_platform_check "$board" "$1"
		return $?
		;;
	esac

	return 0
}

platform_copy_config() {
	case "$(board_name)" in
	mediatek,mt7981-rfb|\
	bananapi,bpi-r3|\
	bananapi,bpi-r3-mini|\
	hiveton,h5000m|\
	hiveton,h5000m-1g|\
	cmcc,rax3000m)
		if [ "$CI_METHOD" = "emmc" ]; then
			emmc_copy_config
		fi
		;;
	acer,predator-w6|\
	acer,predator-w6d|\
	acer,vero-w6m|\
	glinet,gl-mt2500|\
	glinet,gl-mt6000|\
	glinet,gl-x3000|\
	glinet,gl-xe3000|\
	huasifei,wh3000|\
	mediatek,mt7987a|\
	jdcloud,re-cp-03|\
	smartrg,sdg-8612|\
	smartrg,sdg-8614|\
	smartrg,sdg-8622|\
	smartrg,sdg-8632|\
	ubnt,unifi-6-plus)
		emmc_copy_config
		;;
	esac
}

platform_pre_upgrade() {
	local board=$(board_name)

	case "$board" in
	asus,rt-ax52|\
	asus,rt-ax59u|\
	asus,tuf-ax4200|\
	asus,tuf-ax6000)
		asus_initial_setup
		;;
	xiaomi,mi-router-ax3000t|\
	xiaomi,mi-router-wr30u-stock|\
	xiaomi,redmi-router-ax6000-stock)
		xiaomi_initial_setup
		;;
	esac
}
